import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { Hocuspocus } from '@hocuspocus/server';
import { WebSocketServer } from 'ws';
import * as http from 'http';
import * as Y from 'yjs';
import { randomBytes } from 'crypto';
import { db } from './db';
import { users, groups, groupMembers, nodes, permissions, sessions, notifications, invitations, auditLog, settings, tasks, taskProjects, taskSections, taskLabels, taskLabelLinks, taskComments, nodeStars, chatRooms, chatMembers, messages, chatReactions } from './db/schema';
import { eq, and, or, inArray, isNull, desc, like } from 'drizzle-orm';
import { storage } from './storage';
import {
  requireUser,
  resolveUserId,
  findUserByEmail,
  verifyPassword,
  hashPassword,
  createSession,
  destroySession,
} from './auth';
import { generateSecret, otpauthURL, verifyTOTP } from './totp';
import { registerChatRoutes, handleChatSocket } from './chat';

const fastify = Fastify({ logger: true });
// Allow all methods — the default only permits GET/HEAD/POST, which silently
// blocks every browser PUT/PATCH/DELETE at the CORS preflight (e.g. rename).
fastify.register(cors, {
  origin: '*',
  methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Authorization', 'Content-Type'],
});
fastify.register(multipart, { limits: { fileSize: 1024 * 1024 * 1024 } }); // 1 GiB

// Chat REST routes (the live WS gateway is wired in the start() block below).
registerChatRoutes(fastify);

// ==========================================
// Rights Management (Unified ACL with Inheritance)
// ==========================================
const ROLE_HIERARCHY = { viewer: 1, commenter: 2, editor: 3, manager: 4 };

async function getHighestRole(userId: string, nodeId: string): Promise<number> {
  const user = await db.select().from(users).where(eq(users.id, userId)).get();
  if (user?.globalRole === 'admin') return ROLE_HIERARCHY.manager;

  // 1. Resolve Bottom-Up Org Chart (All groups the user belongs to, plus their ancestors)
  const memberships = await db.select().from(groupMembers).where(eq(groupMembers.userId, userId));
  const groupIds = new Set<string>();

  for (const m of memberships) {
    let currentGroupId: string | null = m.groupId;
    while (currentGroupId) {
      groupIds.add(currentGroupId);
      const groupNode = await db.select().from(groups).where(eq(groups.id, currentGroupId)).get();
      currentGroupId = groupNode?.parentId || null;
    }
  }

  const resolvedGroupIds = Array.from(groupIds);
  let highestRole = 0;
  let currentNodeId: string | null = nodeId;

  // 2. Traverse up the Node tree
  while (currentNodeId) {
    const conditions: any[] = [and(eq(permissions.granteeType, 'user'), eq(permissions.granteeId, userId))];
    if (resolvedGroupIds.length > 0) {
      conditions.push(and(eq(permissions.granteeType, 'group'), inArray(permissions.granteeId, resolvedGroupIds)));
    }
    // General access: 'workspace' (anyone signed in) and 'public' (anyone with the link)
    // grant their role to every authenticated user.
    conditions.push(eq(permissions.granteeType, 'workspace'));
    conditions.push(eq(permissions.granteeType, 'public'));

    const perms = await db.select().from(permissions)
      .where(and(eq(permissions.nodeId, currentNodeId), or(...conditions)));

    for (const p of perms) {
      const roleLevel = ROLE_HIERARCHY[p.role as keyof typeof ROLE_HIERARCHY];
      if (roleLevel > highestRole) highestRole = roleLevel;
    }
    if (highestRole === ROLE_HIERARCHY.manager) break;

    const node = await db.select().from(nodes).where(eq(nodes.id, currentNodeId)).get();
    currentNodeId = node?.parentId || null;
  }
  return highestRole;
}

// Shared helper: can this user at least view this node?
async function canAccess(userId: string, node: { ownerId: string, id: string }, min = ROLE_HIERARCHY.viewer) {
  if (node.ownerId === userId) return true;
  return (await getHighestRole(userId, node.id)) >= min;
}

// Ensure a user has at least `role` on a node (used when @mentioning grants access).
// No-op if they're the owner or already have an equal/higher effective role.
async function ensureCollaborator(nodeId: string, targetId: string, role: 'viewer' | 'commenter' | 'editor' | 'manager' = 'editor') {
  const node = await db.select().from(nodes).where(eq(nodes.id, nodeId)).get();
  if (!node || node.ownerId === targetId) return;
  if ((await getHighestRole(targetId, nodeId)) >= ROLE_HIERARCHY[role]) return;
  const existing = await db.select().from(permissions)
    .where(and(eq(permissions.nodeId, nodeId), eq(permissions.granteeType, 'user'), eq(permissions.granteeId, targetId))).get();
  if (existing) await db.update(permissions).set({ role }).where(eq(permissions.id, existing.id));
  else await db.insert(permissions).values({ id: `perm-${Date.now()}-${randomBytes(3).toString('hex')}`, nodeId, granteeType: 'user', granteeId: targetId, role });
}

// ==========================================
// Auth Routes
// ==========================================
fastify.post('/api/auth/login', async (request, reply) => {
  const { email, password, code } = request.body as { email: string, password: string, code?: string };
  const user = await findUserByEmail(email);
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    return reply.status(401).send({ error: 'Invalid email or password' });
  }
  if (user.status === 'suspended') {
    return reply.status(403).send({ error: 'Your account has been suspended. Contact your administrator.' });
  }
  // Two-factor: after the password checks out, require a valid TOTP code.
  if (user.totpEnabled && user.totpSecret) {
    if (!code) return reply.status(401).send({ twoFactorRequired: true });
    if (!verifyTOTP(code, user.totpSecret)) return reply.status(401).send({ twoFactorRequired: true, error: 'Invalid authentication code' });
  }
  const token = await createSession(user.id);
  return { token, user: { id: user.id, name: user.name, email: user.email, globalRole: user.globalRole } };
});

// Invite info for the accept screen (public).
fastify.get('/api/auth/invite/:token', async (request, reply) => {
  const { token } = request.params as { token: string };
  const inv = await db.select().from(invitations).where(eq(invitations.token, token)).get();
  if (!inv || inv.status !== 'pending' || inv.expiresAt.getTime() < Date.now()) {
    return reply.status(404).send({ error: 'This invitation is invalid or has expired.' });
  }
  return { email: inv.email, role: inv.role };
});

// Accept an invitation -> create the user and sign them in (public).
fastify.post('/api/auth/accept-invite', async (request, reply) => {
  const { token, name, password } = request.body as { token: string, name: string, password: string };
  const inv = await db.select().from(invitations).where(eq(invitations.token, token)).get();
  if (!inv || inv.status !== 'pending' || inv.expiresAt.getTime() < Date.now()) {
    return reply.status(404).send({ error: 'This invitation is invalid or has expired.' });
  }
  if (!name?.trim() || !password || password.length < 6) {
    return reply.status(400).send({ error: 'Name and a password of at least 6 characters are required.' });
  }
  const existing = await findUserByEmail(inv.email);
  if (existing) return reply.status(409).send({ error: 'An account with this email already exists.' });

  const id = `user-${Date.now()}-${randomBytes(3).toString('hex')}`;
  await db.insert(users).values({
    id, name: name.trim(), email: inv.email, passwordHash: await hashPassword(password),
    globalRole: inv.role, status: 'active', createdAt: new Date(),
  });
  const groupIds: string[] = inv.groupIds ? JSON.parse(inv.groupIds) : [];
  for (const gid of groupIds) {
    await db.insert(groupMembers).values({ groupId: gid, userId: id }).onConflictDoNothing();
  }
  await db.update(invitations).set({ status: 'accepted', acceptedUserId: id }).where(eq(invitations.id, inv.id));
  const sessionToken = await createSession(id);
  return { token: sessionToken, user: { id, name: name.trim(), email: inv.email, globalRole: inv.role } };
});

// Public workspace branding for login/header.
fastify.get('/api/workspace', async () => {
  const rows = await db.select().from(settings);
  const kv: Record<string, string> = {};
  for (const r of rows) if (r.value != null) kv[r.key] = r.value;
  return { name: kv.workspaceName || 'OneFeather', logo: kv.workspaceLogo || '' };
});

fastify.post('/api/auth/logout', async (request, reply) => {
  const header = request.headers['authorization'];
  if (header?.startsWith('Bearer ')) await destroySession(header.slice('Bearer '.length));
  return { success: true };
});

fastify.get('/api/auth/me', async (request, reply) => {
  const userId = await resolveUserId(request);
  if (!userId) return reply.status(401).send({ error: 'Not authenticated' });
  const user = await db.select().from(users).where(eq(users.id, userId)).get();
  if (!user) return reply.status(401).send({ error: 'Not authenticated' });
  return {
    id: user.id, name: user.name, email: user.email, globalRole: user.globalRole,
    hasAvatar: !!user.avatarKey, twoFactorEnabled: user.totpEnabled,
  };
});

// ==========================================
// REST API (Profile / Account self-service)
// ==========================================
// Avatars are served publicly so plain <img> tags (which can't send an auth header)
// can render them in mentions, notifications, shares, presence, etc.
fastify.get('/api/users/:id/avatar', async (request, reply) => {
  const { id } = request.params as { id: string };
  const u = await db.select().from(users).where(eq(users.id, id)).get();
  if (!u?.avatarKey) return reply.status(404).send({ error: 'No avatar' });
  reply.header('Content-Type', u.avatarMime || 'image/png');
  reply.header('Cache-Control', 'no-cache');
  return reply.send(storage.get(u.avatarKey));
});

fastify.post('/api/me/avatar', async (request, reply) => {
  const userId = await requireUser(request, reply);
  if (!userId) return;
  const data = await request.file();
  if (!data) return reply.status(400).send({ error: 'No file provided' });
  const key = `avatar-${userId}-${Date.now()}`;
  await storage.put(key, data.file);
  const old = await db.select().from(users).where(eq(users.id, userId)).get();
  if (old?.avatarKey) await storage.delete(old.avatarKey);
  await db.update(users).set({ avatarKey: key, avatarMime: data.mimetype }).where(eq(users.id, userId));
  return { success: true };
});

fastify.delete('/api/me/avatar', async (request, reply) => {
  const userId = await requireUser(request, reply);
  if (!userId) return;
  const u = await db.select().from(users).where(eq(users.id, userId)).get();
  if (u?.avatarKey) await storage.delete(u.avatarKey);
  await db.update(users).set({ avatarKey: null, avatarMime: null }).where(eq(users.id, userId));
  return { success: true };
});

fastify.post('/api/me/password', async (request, reply) => {
  const userId = await requireUser(request, reply);
  if (!userId) return;
  const { currentPassword, newPassword } = request.body as { currentPassword: string, newPassword: string };
  const u = await db.select().from(users).where(eq(users.id, userId)).get();
  if (!u || !(await verifyPassword(currentPassword, u.passwordHash))) {
    return reply.status(400).send({ error: 'Your current password is incorrect.' });
  }
  if (!newPassword || newPassword.length < 6) return reply.status(400).send({ error: 'New password must be at least 6 characters.' });
  await db.update(users).set({ passwordHash: await hashPassword(newPassword) }).where(eq(users.id, userId));
  return { success: true };
});

// Sign out of all other sessions (keep the current one).
fastify.post('/api/me/revoke-other-sessions', async (request, reply) => {
  const userId = await requireUser(request, reply);
  if (!userId) return;
  const header = request.headers['authorization'] || '';
  const current = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
  const mine = await db.select().from(sessions).where(eq(sessions.userId, userId));
  for (const s of mine) if (s.token !== current) await db.delete(sessions).where(eq(sessions.token, s.token));
  return { success: true };
});

// ---- Two-factor auth (TOTP) ----
fastify.post('/api/me/2fa/setup', async (request, reply) => {
  const userId = await requireUser(request, reply);
  if (!userId) return;
  const u = await db.select().from(users).where(eq(users.id, userId)).get();
  if (!u) return reply.status(404).send({ error: 'Not found' });
  const secret = generateSecret();
  await db.update(users).set({ totpSecret: secret, totpEnabled: false }).where(eq(users.id, userId));
  return { secret, otpauth: otpauthURL(u.email, secret) };
});

fastify.post('/api/me/2fa/enable', async (request, reply) => {
  const userId = await requireUser(request, reply);
  if (!userId) return;
  const { code } = request.body as { code: string };
  const u = await db.select().from(users).where(eq(users.id, userId)).get();
  if (!u?.totpSecret) return reply.status(400).send({ error: 'Start 2FA setup first.' });
  if (!verifyTOTP(code, u.totpSecret)) return reply.status(400).send({ error: 'That code is incorrect. Try again.' });
  await db.update(users).set({ totpEnabled: true }).where(eq(users.id, userId));
  return { success: true };
});

fastify.post('/api/me/2fa/disable', async (request, reply) => {
  const userId = await requireUser(request, reply);
  if (!userId) return;
  const { code } = request.body as { code: string };
  const u = await db.select().from(users).where(eq(users.id, userId)).get();
  if (!u) return reply.status(404).send({ error: 'Not found' });
  if (u.totpEnabled && u.totpSecret && !verifyTOTP(code, u.totpSecret)) {
    return reply.status(400).send({ error: 'Enter a valid code to disable 2FA.' });
  }
  await db.update(users).set({ totpEnabled: false, totpSecret: null }).where(eq(users.id, userId));
  return { success: true };
});

// ==========================================
// REST API (Nodes / Drive)
// ==========================================
fastify.get('/api/nodes', async (request, reply) => {
  const userId = await requireUser(request, reply);
  if (!userId) return;
  const { parentId, view } = request.query as { parentId?: string, view?: 'home' | 'my-drive' | 'shared-with-me' | 'trash' };

  const myStars = await db.select().from(nodeStars).where(eq(nodeStars.userId, userId));
  const starredIds = new Set(myStars.map(s => s.nodeId));

  let query;
  if (view === 'trash') {
    const trashed = await db.select().from(nodes).where(eq(nodes.ownerId, userId));
    return decorate(trashed.filter(n => n.deletedAt));
  } else if (parentId) {
    query = db.select().from(nodes).where(eq(nodes.parentId, parentId));
  } else if (view === 'my-drive') {
    query = db.select().from(nodes).where(and(eq(nodes.ownerId, userId), isNull(nodes.parentId)));
  } else if (view === 'starred') {
    query = starredIds.size ? db.select().from(nodes).where(inArray(nodes.id, Array.from(starredIds))) : null as any;
  } else if (view === 'recent' || view === 'folders') {
    query = db.select().from(nodes); // filtered below
  } else {
    // 'home' or 'shared-with-me' base queries
    query = db.select().from(nodes).where(or(
      eq(nodes.type, 'drive'),
      and(eq(nodes.type, 'folder'), isNull(nodes.parentId)),
      and(eq(nodes.type, 'document'), isNull(nodes.parentId)),
      and(eq(nodes.type, 'file'), isNull(nodes.parentId))
    ));
  }

  // owner-name lookup for display
  const allUsers = await db.select().from(users);
  const ownerName = (id: string) => allUsers.find(u => u.id === id)?.name || id;
  function decorate(list: any[]) {
    return list.map(n => ({ ...n, starred: starredIds.has(n.id), ownerName: ownerName(n.ownerId) }));
  }

  const allNodes = query ? await query : [];
  let accessibleNodes = [];
  for (const node of allNodes) {
    if (node.deletedAt) continue; // hide trashed items from normal views
    if (view === 'recent' && node.type !== 'document' && node.type !== 'file') continue;
    if (view === 'folders' && node.type !== 'folder' && node.type !== 'drive') continue;
    if (node.ownerId === userId) {
      if (view !== 'shared-with-me') accessibleNodes.push(node);
      continue;
    }
    const roleLevel = await getHighestRole(userId, node.id);
    if (roleLevel >= ROLE_HIERARCHY.viewer) {
      if (view !== 'my-drive') accessibleNodes.push(node);
    }
  }

  if (view === 'home' || view === 'recent') {
    accessibleNodes.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }
  if (view === 'recent') accessibleNodes = accessibleNodes.slice(0, 50);

  return decorate(accessibleNodes);
});

// Ancestor chain (root -> this node) for showing/changing a document's location.
fastify.get('/api/nodes/:id/path', async (request, reply) => {
  const userId = await requireUser(request, reply);
  if (!userId) return;
  const { id } = request.params as { id: string };
  const chain: { id: string, name: string, type: string }[] = [];
  let cur: string | null = id;
  let guard = 0;
  while (cur && guard++ < 50) {
    const n = await db.select().from(nodes).where(eq(nodes.id, cur)).get();
    if (!n) break;
    chain.unshift({ id: n.id, name: n.name, type: n.type });
    cur = n.parentId || null;
  }
  return chain; // includes the node itself as the last element
});

fastify.get('/api/nodes/:id', async (request, reply) => {
  const userId = await requireUser(request, reply);
  if (!userId) return;
  const { id } = request.params as { id: string };
  const node = await db.select().from(nodes).where(eq(nodes.id, id)).get();
  if (!node) return reply.status(404).send({ error: 'Not found' });
  if (!(await canAccess(userId, node))) return reply.status(403).send({ error: 'Access denied' });
  return node;
});

fastify.post('/api/nodes', async (request, reply) => {
  const userId = await requireUser(request, reply);
  if (!userId) return;
  const { name, type, parentId } = request.body as { name: string, type: 'folder' | 'document', parentId?: string };

  if (parentId) {
    const roleLevel = await getHighestRole(userId, parentId);
    if (roleLevel < ROLE_HIERARCHY.editor) {
      return reply.status(403).send({ error: 'Access denied.' });
    }
  }

  const id = `node-${Date.now()}`;
  await db.insert(nodes).values({ id, name, type, parentId: parentId || null, ownerId: userId, createdAt: new Date() });

  if (!parentId) {
    await db.insert(permissions).values({
      id: `perm-${Date.now()}`, nodeId: id, granteeType: 'user', granteeId: userId, role: 'manager'
    });
  }
  return { id, name, type };
});

fastify.put('/api/nodes/:id', async (request, reply) => {
  const userId = await requireUser(request, reply);
  if (!userId) return;
  const { id } = request.params as { id: string };
  const body = request.body as { name?: string, icon?: string | null, coverKey?: string | null };

  const node = await db.select().from(nodes).where(eq(nodes.id, id)).get();
  if (!node) return reply.status(404).send({ error: 'Not found' });
  if (!(await canAccess(userId, node, ROLE_HIERARCHY.editor))) return reply.status(403).send({ error: 'Access denied' });

  const patch: any = {};
  for (const k of ['name', 'icon', 'coverKey'] as const) if (body[k] !== undefined) patch[k] = body[k];
  if (Object.keys(patch).length) await db.update(nodes).set(patch).where(eq(nodes.id, id));
  return { success: true };
});

// Soft-delete: move to Trash (manager required, matching the old hard-delete bar).
fastify.delete('/api/nodes/:id', async (request, reply) => {
  const userId = await requireUser(request, reply);
  if (!userId) return;
  const { id } = request.params as { id: string };

  const node = await db.select().from(nodes).where(eq(nodes.id, id)).get();
  if (!node) return reply.status(404).send({ error: 'Not found' });
  if (!(await canAccess(userId, node, ROLE_HIERARCHY.manager))) return reply.status(403).send({ error: 'Must be manager to delete' });

  await db.update(nodes).set({ deletedAt: new Date() }).where(eq(nodes.id, id));
  return { success: true };
});

// Restore from Trash.
fastify.post('/api/nodes/:id/restore', async (request, reply) => {
  const userId = await requireUser(request, reply);
  if (!userId) return;
  const { id } = request.params as { id: string };
  const node = await db.select().from(nodes).where(eq(nodes.id, id)).get();
  if (!node) return reply.status(404).send({ error: 'Not found' });
  if (!(await canAccess(userId, node, ROLE_HIERARCHY.manager))) return reply.status(403).send({ error: 'Access denied' });
  await db.update(nodes).set({ deletedAt: null }).where(eq(nodes.id, id));
  return { success: true };
});

// Permanent delete (only from Trash). Cleans up permissions + stored blob.
fastify.delete('/api/nodes/:id/permanent', async (request, reply) => {
  const userId = await requireUser(request, reply);
  if (!userId) return;
  const { id } = request.params as { id: string };
  const node = await db.select().from(nodes).where(eq(nodes.id, id)).get();
  if (!node) return reply.status(404).send({ error: 'Not found' });
  if (!(await canAccess(userId, node, ROLE_HIERARCHY.manager))) return reply.status(403).send({ error: 'Access denied' });

  if (node.storageKey) await storage.delete(node.storageKey);
  await db.delete(permissions).where(eq(permissions.nodeId, id));
  await db.delete(nodes).where(eq(nodes.id, id));
  return { success: true };
});

// ==========================================
// REST API (File upload / download)
// ==========================================
fastify.post('/api/nodes/upload', async (request, reply) => {
  const userId = await requireUser(request, reply);
  if (!userId) return;

  const data = await request.file();
  if (!data) return reply.status(400).send({ error: 'No file provided' });

  const parentId = (data.fields?.parentId as any)?.value as string | undefined;
  if (parentId) {
    const roleLevel = await getHighestRole(userId, parentId);
    if (roleLevel < ROLE_HIERARCHY.editor) return reply.status(403).send({ error: 'Access denied.' });
  }

  const id = `node-${Date.now()}`;
  const storageKey = `${id}-${data.filename}`;
  await storage.put(storageKey, data.file);

  await db.insert(nodes).values({
    id,
    type: 'file',
    parentId: parentId || null,
    name: data.filename,
    storageKey,
    mimeType: data.mimetype,
    size: data.file.bytesRead,
    ownerId: userId,
    createdAt: new Date(),
  });

  if (!parentId) {
    await db.insert(permissions).values({
      id: `perm-${Date.now()}`, nodeId: id, granteeType: 'user', granteeId: userId, role: 'manager'
    });
  }
  return { id, name: data.filename, type: 'file' };
});

fastify.get('/api/nodes/:id/download', async (request, reply) => {
  const userId = await requireUser(request, reply);
  if (!userId) return;
  const { id } = request.params as { id: string };
  const node = await db.select().from(nodes).where(eq(nodes.id, id)).get();
  if (!node || !node.storageKey) return reply.status(404).send({ error: 'Not found' });
  if (!(await canAccess(userId, node))) return reply.status(403).send({ error: 'Access denied' });

  reply.header('Content-Type', node.mimeType || 'application/octet-stream');
  reply.header('Content-Disposition', `attachment; filename="${node.name}"`);
  return reply.send(storage.get(node.storageKey));
});

// Inline file serving for the in-app viewer (image/pdf/video/audio/text), with HTTP Range
// support. Auth via Bearer header OR ?token= (so <img>/<video>/<iframe> can load it).
fastify.get('/api/nodes/:id/raw', async (request, reply) => {
  const { id } = request.params as { id: string };
  const { token } = request.query as { token?: string };
  let userId = await resolveUserId(request);
  if (!userId && token) {
    const s = await db.select().from(sessions).where(eq(sessions.token, token)).get();
    if (s && s.expiresAt.getTime() > Date.now()) userId = s.userId;
  }
  if (!userId) return reply.status(401).send({ error: 'Authentication required' });

  const node = await db.select().from(nodes).where(eq(nodes.id, id)).get();
  if (!node || !node.storageKey) return reply.status(404).send({ error: 'Not found' });
  if (!(await canAccess(userId, node))) return reply.status(403).send({ error: 'Access denied' });

  const total = node.size ?? storage.stat(node.storageKey).size;
  reply.header('Content-Type', node.mimeType || 'application/octet-stream');
  reply.header('Content-Disposition', `inline; filename="${node.name}"`);
  reply.header('Accept-Ranges', 'bytes');
  reply.header('Cache-Control', 'private, max-age=60');

  const rangeHeader = request.headers['range'];
  if (rangeHeader) {
    const m = /bytes=(\d*)-(\d*)/.exec(rangeHeader);
    let start = m && m[1] ? parseInt(m[1], 10) : 0;
    let end = m && m[2] ? parseInt(m[2], 10) : total - 1;
    if (isNaN(start) || start < 0) start = 0;
    if (isNaN(end) || end >= total) end = total - 1;
    if (start > end) return reply.status(416).header('Content-Range', `bytes */${total}`).send();
    reply.status(206);
    reply.header('Content-Range', `bytes ${start}-${end}/${total}`);
    reply.header('Content-Length', String(end - start + 1));
    return reply.send(storage.stream(node.storageKey, { start, end }));
  }
  reply.header('Content-Length', String(total));
  return reply.send(storage.stream(node.storageKey));
});

// Is `maybeAncestorId` an ancestor of (or equal to) `nodeId`? (cycle guard for move)
async function isAncestorOf(maybeAncestorId: string, nodeId: string): Promise<boolean> {
  let cur: string | null = nodeId;
  while (cur) {
    if (cur === maybeAncestorId) return true;
    const n = await db.select().from(nodes).where(eq(nodes.id, cur)).get();
    cur = n?.parentId || null;
  }
  return false;
}

fastify.post('/api/nodes/:id/move', async (request, reply) => {
  const userId = await requireUser(request, reply);
  if (!userId) return;
  const { id } = request.params as { id: string };
  const { parentId } = request.body as { parentId: string | null };
  const node = await db.select().from(nodes).where(eq(nodes.id, id)).get();
  if (!node) return reply.status(404).send({ error: 'Not found' });
  if (!(await canAccess(userId, node, ROLE_HIERARCHY.editor))) return reply.status(403).send({ error: 'Access denied' });
  if (parentId) {
    const dest = await db.select().from(nodes).where(eq(nodes.id, parentId)).get();
    if (!dest) return reply.status(404).send({ error: 'Destination not found' });
    if (!(await canAccess(userId, dest, ROLE_HIERARCHY.editor))) return reply.status(403).send({ error: 'No access to destination' });
    if (await isAncestorOf(id, parentId)) return reply.status(400).send({ error: "Can't move a folder into itself." });
  } else if (node.ownerId !== userId) {
    return reply.status(403).send({ error: 'Only the owner can move this to the top level.' });
  }
  await db.update(nodes).set({ parentId: parentId || null }).where(eq(nodes.id, id));
  return { success: true };
});

// Recursively copy a node (+ blob/content/children). Returns the new node id.
async function copyNode(srcId: string, newParentId: string | null, ownerId: string, rename = false): Promise<string> {
  const src = await db.select().from(nodes).where(eq(nodes.id, srcId)).get();
  if (!src) throw new Error('not found');
  const id = `node-${Date.now()}-${randomBytes(3).toString('hex')}`;
  let storageKey = src.storageKey;
  if (src.storageKey) { storageKey = `${id}-${src.name}`; await storage.copy(src.storageKey, storageKey); }
  await db.insert(nodes).values({
    id, type: src.type, parentId: newParentId, name: rename ? `Copy of ${src.name}` : src.name,
    content: src.content, storageKey, mimeType: src.mimeType, size: src.size, ownerId, createdAt: new Date(),
  });
  // Recurse into children (folders/drives).
  const children = await db.select().from(nodes).where(eq(nodes.parentId, srcId));
  for (const c of children) if (!c.deletedAt) await copyNode(c.id, id, ownerId, false);
  return id;
}

fastify.post('/api/nodes/:id/copy', async (request, reply) => {
  const userId = await requireUser(request, reply);
  if (!userId) return;
  const { id } = request.params as { id: string };
  const { parentId } = request.body as { parentId?: string | null };
  const node = await db.select().from(nodes).where(eq(nodes.id, id)).get();
  if (!node) return reply.status(404).send({ error: 'Not found' });
  if (!(await canAccess(userId, node))) return reply.status(403).send({ error: 'Access denied' });
  const dest = parentId || node.parentId || null;
  const newId = await copyNode(id, dest, userId, true);
  if (!dest) await db.insert(permissions).values({ id: `perm-${Date.now()}`, nodeId: newId, granteeType: 'user', granteeId: userId, role: 'manager' });
  return { id: newId };
});

fastify.post('/api/nodes/:id/star', async (request, reply) => {
  const userId = await requireUser(request, reply);
  if (!userId) return;
  const { id } = request.params as { id: string };
  const existing = await db.select().from(nodeStars).where(and(eq(nodeStars.userId, userId), eq(nodeStars.nodeId, id))).get();
  if (!existing) await db.insert(nodeStars).values({ userId, nodeId: id });
  return { success: true };
});
fastify.delete('/api/nodes/:id/star', async (request, reply) => {
  const userId = await requireUser(request, reply);
  if (!userId) return;
  const { id } = request.params as { id: string };
  await db.delete(nodeStars).where(and(eq(nodeStars.userId, userId), eq(nodeStars.nodeId, id)));
  return { success: true };
});

// ==========================================
// REST API (Admin Settings & Rights UI)
// ==========================================
async function requireAdmin(request: any, reply: any): Promise<string | null> {
  const userId = await requireUser(request, reply);
  if (!userId) return null;
  const user = await db.select().from(users).where(eq(users.id, userId)).get();
  if (user?.globalRole !== 'admin') {
    reply.status(403).send({ error: 'Admin only' });
    return null;
  }
  return userId;
}

async function logAudit(actorId: string, action: string, targetType?: string, targetId?: string, detail?: any) {
  await db.insert(auditLog).values({
    id: `audit-${Date.now()}-${randomBytes(3).toString('hex')}`,
    actorId, action, targetType: targetType || null, targetId: targetId || null,
    detail: detail ? JSON.stringify(detail) : null, createdAt: new Date(),
  });
}

// Is `candidateParentId` the group itself or a descendant of `groupId`? (used to reject reparent cycles)
async function wouldCreateCycle(groupId: string, candidateParentId: string | null): Promise<boolean> {
  let cur: string | null = candidateParentId;
  while (cur) {
    if (cur === groupId) return true;
    const g = await db.select().from(groups).where(eq(groups.id, cur)).get();
    cur = g?.parentId || null;
  }
  return false;
}

// ---- Users ----
fastify.get('/api/admin/users', async (request, reply) => {
  if (!(await requireAdmin(request, reply))) return;
  const { search } = request.query as { search?: string };
  const base = search
    ? await db.select().from(users).where(or(like(users.name, `%${search}%`), like(users.email, `%${search}%`)))
    : await db.select().from(users);
  const allMembers = await db.select().from(groupMembers);
  return base.map(({ passwordHash, ...u }) => ({
    ...u,
    groupIds: allMembers.filter(m => m.userId === u.id).map(m => m.groupId),
  }));
});

fastify.get('/api/admin/users/:id', async (request, reply) => {
  if (!(await requireAdmin(request, reply))) return;
  const { id } = request.params as { id: string };
  const u = await db.select().from(users).where(eq(users.id, id)).get();
  if (!u) return reply.status(404).send({ error: 'Not found' });
  const mem = await db.select().from(groupMembers).where(eq(groupMembers.userId, id));
  const sess = await db.select().from(sessions).where(eq(sessions.userId, id));
  const { passwordHash, ...safe } = u;
  return { ...safe, groupIds: mem.map(m => m.groupId), activeSessions: sess.length };
});

fastify.patch('/api/admin/users/:id', async (request, reply) => {
  const actor = await requireAdmin(request, reply);
  if (!actor) return;
  const { id } = request.params as { id: string };
  const body = request.body as { name?: string, email?: string, globalRole?: 'admin' | 'member', status?: 'active' | 'suspended' };
  const target = await db.select().from(users).where(eq(users.id, id)).get();
  if (!target) return reply.status(404).send({ error: 'Not found' });

  // Guard: don't allow removing the last admin (by demotion or suspension).
  const losingAdmin = (body.globalRole && body.globalRole !== 'admin' && target.globalRole === 'admin')
    || (body.status === 'suspended' && target.globalRole === 'admin');
  if (losingAdmin) {
    const admins = await db.select().from(users).where(and(eq(users.globalRole, 'admin'), eq(users.status, 'active')));
    if (admins.length <= 1) return reply.status(400).send({ error: 'Cannot remove the last active admin.' });
  }

  const patch: any = {};
  for (const k of ['name', 'email', 'globalRole', 'status'] as const) if (body[k] !== undefined) patch[k] = body[k];
  await db.update(users).set(patch).where(eq(users.id, id));
  // Suspending also revokes active sessions immediately.
  if (body.status === 'suspended') await db.delete(sessions).where(eq(sessions.userId, id));
  await logAudit(actor, 'user.update', 'user', id, patch);
  return { success: true };
});

fastify.delete('/api/admin/users/:id', async (request, reply) => {
  const actor = await requireAdmin(request, reply);
  if (!actor) return;
  const { id } = request.params as { id: string };
  if (id === actor) return reply.status(400).send({ error: "You can't delete your own account." });
  const target = await db.select().from(users).where(eq(users.id, id)).get();
  if (!target) return reply.status(404).send({ error: 'Not found' });
  if (target.globalRole === 'admin') {
    const admins = await db.select().from(users).where(and(eq(users.globalRole, 'admin'), eq(users.status, 'active')));
    if (admins.length <= 1) return reply.status(400).send({ error: 'Cannot delete the last active admin.' });
  }
  // Content stays orphaned (nodes keep ownerId). Clean up references that would break.
  await db.delete(sessions).where(eq(sessions.userId, id));
  await db.delete(groupMembers).where(eq(groupMembers.userId, id));
  await db.delete(notifications).where(eq(notifications.userId, id));
  await db.delete(users).where(eq(users.id, id));
  await logAudit(actor, 'user.delete', 'user', id, { email: target.email });
  return { success: true };
});

fastify.post('/api/admin/users/:id/reset-password', async (request, reply) => {
  const actor = await requireAdmin(request, reply);
  if (!actor) return;
  const { id } = request.params as { id: string };
  const { password } = request.body as { password: string };
  if (!password || password.length < 6) return reply.status(400).send({ error: 'Password must be at least 6 characters.' });
  await db.update(users).set({ passwordHash: await hashPassword(password) }).where(eq(users.id, id));
  await db.delete(sessions).where(eq(sessions.userId, id)); // force re-login with the new password
  await logAudit(actor, 'user.reset_password', 'user', id);
  return { success: true };
});

fastify.post('/api/admin/users/:id/revoke-sessions', async (request, reply) => {
  const actor = await requireAdmin(request, reply);
  if (!actor) return;
  const { id } = request.params as { id: string };
  await db.delete(sessions).where(eq(sessions.userId, id));
  await logAudit(actor, 'user.revoke_sessions', 'user', id);
  return { success: true };
});

// ---- Invitations ----
fastify.get('/api/admin/invitations', async (request, reply) => {
  if (!(await requireAdmin(request, reply))) return;
  return await db.select().from(invitations).orderBy(desc(invitations.createdAt));
});

fastify.post('/api/admin/invitations', async (request, reply) => {
  const actor = await requireAdmin(request, reply);
  if (!actor) return;
  const { email, role, groupIds } = request.body as { email: string, role?: 'admin' | 'member', groupIds?: string[] };
  if (!email?.includes('@')) return reply.status(400).send({ error: 'A valid email is required.' });
  // Enforce allowed invite domains if configured.
  const dom = await db.select().from(settings).where(eq(settings.key, 'allowedDomains')).get();
  if (dom?.value?.trim()) {
    const allowed = dom.value.split(',').map(d => d.trim().toLowerCase()).filter(Boolean);
    const emailDomain = email.split('@')[1]?.toLowerCase();
    if (allowed.length && !allowed.includes(emailDomain)) {
      return reply.status(400).send({ error: `Email domain must be one of: ${allowed.join(', ')}` });
    }
  }
  if (await findUserByEmail(email)) return reply.status(409).send({ error: 'A user with this email already exists.' });

  const token = randomBytes(24).toString('hex');
  const id = `inv-${Date.now()}-${randomBytes(3).toString('hex')}`;
  await db.insert(invitations).values({
    id, email, role: role || 'member', token, status: 'pending',
    groupIds: groupIds && groupIds.length ? JSON.stringify(groupIds) : null,
    createdAt: new Date(), expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7), // 7 days
  });
  await logAudit(actor, 'invite.create', 'invitation', id, { email, role: role || 'member' });
  return { id, token };
});

fastify.delete('/api/admin/invitations/:id', async (request, reply) => {
  const actor = await requireAdmin(request, reply);
  if (!actor) return;
  const { id } = request.params as { id: string };
  await db.update(invitations).set({ status: 'revoked' }).where(eq(invitations.id, id));
  await logAudit(actor, 'invite.revoke', 'invitation', id);
  return { success: true };
});

// ---- Groups / Org units ----
fastify.get('/api/admin/groups', async (request, reply) => {
  if (!(await requireUser(request, reply))) return;
  const gs = await db.select().from(groups);
  const mem = await db.select().from(groupMembers);
  return gs.map(g => ({ ...g, memberCount: mem.filter(m => m.groupId === g.id).length }));
});

fastify.post('/api/admin/groups', async (request, reply) => {
  const actor = await requireAdmin(request, reply);
  if (!actor) return;
  const { name, parentId } = request.body as { name: string, parentId?: string };
  if (!name?.trim()) return reply.status(400).send({ error: 'Name is required.' });
  const id = `group-${Date.now()}-${randomBytes(3).toString('hex')}`;
  await db.insert(groups).values({ id, name: name.trim(), parentId: parentId || null });
  await logAudit(actor, 'group.create', 'group', id, { name });
  return { id };
});

fastify.patch('/api/admin/groups/:id', async (request, reply) => {
  const actor = await requireAdmin(request, reply);
  if (!actor) return;
  const { id } = request.params as { id: string };
  const { name, parentId } = request.body as { name?: string, parentId?: string | null };
  if (parentId !== undefined && parentId && await wouldCreateCycle(id, parentId)) {
    return reply.status(400).send({ error: 'That move would create a cycle in the org chart.' });
  }
  const patch: any = {};
  if (name !== undefined) patch.name = name.trim();
  if (parentId !== undefined) patch.parentId = parentId || null;
  await db.update(groups).set(patch).where(eq(groups.id, id));
  await logAudit(actor, 'group.update', 'group', id, patch);
  return { success: true };
});

fastify.delete('/api/admin/groups/:id', async (request, reply) => {
  const actor = await requireAdmin(request, reply);
  if (!actor) return;
  const { id } = request.params as { id: string };
  const g = await db.select().from(groups).where(eq(groups.id, id)).get();
  if (!g) return reply.status(404).send({ error: 'Not found' });
  // Reparent children to this group's parent so they aren't orphaned.
  await db.update(groups).set({ parentId: g.parentId || null }).where(eq(groups.parentId, id));
  await db.delete(groupMembers).where(eq(groupMembers.groupId, id));
  // Remove any ACL grants made to this group.
  await db.delete(permissions).where(and(eq(permissions.granteeType, 'group'), eq(permissions.granteeId, id)));
  await db.delete(groups).where(eq(groups.id, id));
  await logAudit(actor, 'group.delete', 'group', id, { name: g.name });
  return { success: true };
});

fastify.get('/api/admin/groups/:id/members', async (request, reply) => {
  if (!(await requireAdmin(request, reply))) return;
  const { id } = request.params as { id: string };
  const mem = await db.select().from(groupMembers).where(eq(groupMembers.groupId, id));
  const ids = mem.map(m => m.userId);
  if (ids.length === 0) return [];
  const us = await db.select().from(users).where(inArray(users.id, ids));
  return us.map(({ passwordHash, ...u }) => u);
});

fastify.post('/api/admin/groups/:id/members', async (request, reply) => {
  const actor = await requireAdmin(request, reply);
  if (!actor) return;
  const { id } = request.params as { id: string };
  const { userId } = request.body as { userId: string };
  await db.insert(groupMembers).values({ groupId: id, userId }).onConflictDoNothing();
  await logAudit(actor, 'group.add_member', 'group', id, { userId });
  return { success: true };
});

fastify.delete('/api/admin/groups/:id/members/:userId', async (request, reply) => {
  const actor = await requireAdmin(request, reply);
  if (!actor) return;
  const { id, userId } = request.params as { id: string, userId: string };
  await db.delete(groupMembers).where(and(eq(groupMembers.groupId, id), eq(groupMembers.userId, userId)));
  await logAudit(actor, 'group.remove_member', 'group', id, { userId });
  return { success: true };
});

// Shared folders for an org unit: nodes that have a permission granted to this group.
fastify.get('/api/admin/groups/:id/resources', async (request, reply) => {
  if (!(await requireAdmin(request, reply))) return;
  const { id } = request.params as { id: string };
  const grants = await db.select().from(permissions)
    .where(and(eq(permissions.granteeType, 'group'), eq(permissions.granteeId, id)));
  const out: any[] = [];
  for (const p of grants) {
    const node = await db.select().from(nodes).where(eq(nodes.id, p.nodeId)).get();
    if (node && !node.deletedAt) out.push({ id: node.id, name: node.name, type: node.type, role: p.role, permId: p.id });
  }
  return out;
});

// Create a shared folder for this org unit and grant the whole group access at a role.
fastify.post('/api/admin/groups/:id/folder', async (request, reply) => {
  const actor = await requireAdmin(request, reply);
  if (!actor) return;
  const { id } = request.params as { id: string };
  const { name, role } = request.body as { name: string, role: 'viewer' | 'commenter' | 'editor' | 'manager' };
  const group = await db.select().from(groups).where(eq(groups.id, id)).get();
  if (!group) return reply.status(404).send({ error: 'Org unit not found' });

  const nodeId = `node-${Date.now()}-${randomBytes(3).toString('hex')}`;
  await db.insert(nodes).values({
    id: nodeId, type: 'folder', parentId: null, name: name?.trim() || `${group.name} Shared`,
    ownerId: actor, createdAt: new Date(),
  });
  // The creating admin manages it; the group gets the chosen role.
  await db.insert(permissions).values({ id: `perm-${Date.now()}-a`, nodeId, granteeType: 'user', granteeId: actor, role: 'manager' });
  await db.insert(permissions).values({ id: `perm-${Date.now()}-g`, nodeId, granteeType: 'group', granteeId: id, role: role || 'editor' });
  await logAudit(actor, 'group.create_folder', 'group', id, { nodeId, role: role || 'editor' });
  return { id: nodeId };
});

// ---- Audit / Settings / Stats ----
fastify.get('/api/admin/audit', async (request, reply) => {
  if (!(await requireAdmin(request, reply))) return;
  const { limit } = request.query as { limit?: string };
  return await db.select().from(auditLog).orderBy(desc(auditLog.createdAt)).limit(Number(limit) || 100);
});

fastify.get('/api/admin/settings', async (request, reply) => {
  if (!(await requireAdmin(request, reply))) return;
  const rows = await db.select().from(settings);
  const kv: Record<string, string> = {};
  for (const r of rows) if (r.value != null) kv[r.key] = r.value;
  return kv;
});

fastify.put('/api/admin/settings', async (request, reply) => {
  const actor = await requireAdmin(request, reply);
  if (!actor) return;
  const body = request.body as Record<string, string>;
  for (const [key, value] of Object.entries(body)) {
    await db.insert(settings).values({ key, value }).onConflictDoUpdate({ target: settings.key, set: { value } });
  }
  await logAudit(actor, 'settings.update', 'settings', undefined, Object.keys(body));
  return { success: true };
});

fastify.get('/api/admin/stats', async (request, reply) => {
  if (!(await requireAdmin(request, reply))) return;
  const allUsers = await db.select().from(users);
  const allNodes = await db.select().from(nodes);
  const invs = await db.select().from(invitations);
  const gs = await db.select().from(groups);
  const recent = await db.select().from(auditLog).orderBy(desc(auditLog.createdAt)).limit(8);
  const byType = (t: string) => allNodes.filter(n => n.type === t && !n.deletedAt).length;
  return {
    users: allUsers.length,
    activeUsers: allUsers.filter(u => u.status === 'active').length,
    suspendedUsers: allUsers.filter(u => u.status === 'suspended').length,
    pendingInvites: invs.filter(i => i.status === 'pending').length,
    groups: gs.length,
    nodes: { drive: byType('drive'), folder: byType('folder'), document: byType('document'), file: byType('file') },
    storageBytes: allNodes.reduce((sum, n) => sum + (n.size || 0), 0),
    recentActivity: recent,
  };
});

fastify.get('/api/admin/nodes', async (request, reply) => {
  if (!(await requireAdmin(request, reply))) return;
  return await db.select().from(nodes).where(or(eq(nodes.type, 'drive'), eq(nodes.type, 'folder')));
});

// List users + groups for the share dialog (any authenticated user may pick grantees).
fastify.get('/api/directory', async (request, reply) => {
  if (!(await requireUser(request, reply))) return;
  const us = await db.select().from(users);
  const gs = await db.select().from(groups);
  return { users: us.map(({ passwordHash, ...u }) => u), groups: gs };
});

fastify.get('/api/nodes/:nodeId/permissions', async (request, reply) => {
  const userId = await requireUser(request, reply);
  if (!userId) return;
  const { nodeId } = request.params as { nodeId: string };
  const node = await db.select().from(nodes).where(eq(nodes.id, nodeId)).get();
  if (!node) return reply.status(404).send({ error: 'Not found' });
  if (!(await canAccess(userId, node, ROLE_HIERARCHY.manager))) return reply.status(403).send({ error: 'Access denied' });
  return await db.select().from(permissions).where(eq(permissions.nodeId, nodeId));
});

fastify.post('/api/nodes/:nodeId/permissions', async (request, reply) => {
  const userId = await requireUser(request, reply);
  if (!userId) return;
  const { nodeId } = request.params as { nodeId: string };
  const { granteeType, granteeId, role } = request.body as any;
  const node = await db.select().from(nodes).where(eq(nodes.id, nodeId)).get();
  if (!node) return reply.status(404).send({ error: 'Not found' });
  if (!(await canAccess(userId, node, ROLE_HIERARCHY.manager))) return reply.status(403).send({ error: 'Must be manager to share' });

  // Upsert-ish: if a grant for this grantee already exists, update its role.
  const existing = await db.select().from(permissions)
    .where(and(eq(permissions.nodeId, nodeId), eq(permissions.granteeType, granteeType), eq(permissions.granteeId, granteeId))).get();
  if (existing) {
    await db.update(permissions).set({ role }).where(eq(permissions.id, existing.id));
    return { success: true, id: existing.id };
  }
  const id = `perm-${Date.now()}`;
  await db.insert(permissions).values({ id, nodeId, granteeType, granteeId, role });
  return { success: true, id };
});

// @mentioning a person grants them access to the page. The caller only needs edit
// rights on the node (anyone editing the doc can pull collaborators in).
fastify.post('/api/nodes/:nodeId/grant-collaborator', async (request, reply) => {
  const userId = await requireUser(request, reply);
  if (!userId) return;
  const { nodeId } = request.params as { nodeId: string };
  const { userId: targetId, role } = request.body as { userId: string, role?: 'viewer' | 'commenter' | 'editor' | 'manager' };
  const node = await db.select().from(nodes).where(eq(nodes.id, nodeId)).get();
  if (!node) return reply.status(404).send({ error: 'Not found' });
  if (!(await canAccess(userId, node, ROLE_HIERARCHY.editor))) return reply.status(403).send({ error: 'You need edit access to add collaborators.' });
  await ensureCollaborator(nodeId, targetId, role || 'editor');
  return { success: true };
});

fastify.delete('/api/permissions/:id', async (request, reply) => {
  const userId = await requireUser(request, reply);
  if (!userId) return;
  const { id } = request.params as { id: string };
  const perm = await db.select().from(permissions).where(eq(permissions.id, id)).get();
  if (!perm) return reply.status(404).send({ error: 'Not found' });
  const node = await db.select().from(nodes).where(eq(nodes.id, perm.nodeId)).get();
  if (!node || !(await canAccess(userId, node, ROLE_HIERARCHY.manager))) return reply.status(403).send({ error: 'Access denied' });
  await db.delete(permissions).where(eq(permissions.id, id));
  return { success: true };
});

// ==========================================
// REST API (Notifications)
// ==========================================
fastify.get('/api/notifications', async (request, reply) => {
  const userId = await requireUser(request, reply);
  if (!userId) return;
  const rows = await db.select().from(notifications)
    .where(eq(notifications.userId, userId))
    .orderBy(desc(notifications.createdAt));
  const actors = await db.select().from(users);
  return rows.map(n => ({ ...n, actorName: actors.find(a => a.id === n.actorId)?.name || n.actorId }));
});

fastify.post('/api/notifications', async (request, reply) => {
  const actorId = await requireUser(request, reply);
  if (!actorId) return;
  const { userId, type, nodeId, message } = request.body as any;
  if (!userId || userId === actorId) return { success: true }; // don't notify yourself / no recipient
  const id = `notif-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  await db.insert(notifications).values({
    id, userId, actorId, type: type || 'mention', nodeId: nodeId || null, message: message || '', read: false, createdAt: new Date(),
  });
  return { success: true, id };
});

fastify.post('/api/notifications/:id/read', async (request, reply) => {
  const userId = await requireUser(request, reply);
  if (!userId) return;
  const { id } = request.params as { id: string };
  await db.update(notifications).set({ read: true }).where(and(eq(notifications.id, id), eq(notifications.userId, userId)));
  return { success: true };
});

fastify.post('/api/notifications/read-all', async (request, reply) => {
  const userId = await requireUser(request, reply);
  if (!userId) return;
  await db.update(notifications).set({ read: true }).where(eq(notifications.userId, userId));
  return { success: true };
});

// Dismiss a single notification.
fastify.delete('/api/notifications/:id', async (request, reply) => {
  const userId = await requireUser(request, reply);
  if (!userId) return;
  const { id } = request.params as { id: string };
  await db.delete(notifications).where(and(eq(notifications.id, id), eq(notifications.userId, userId)));
  return { success: true };
});

// Clear all of my notifications.
fastify.delete('/api/notifications', async (request, reply) => {
  const userId = await requireUser(request, reply);
  if (!userId) return;
  await db.delete(notifications).where(eq(notifications.userId, userId));
  return { success: true };
});

// ==========================================
// REST API (Tasks — personal task manager)
// ==========================================
const tid = (p: string) => `${p}-${Date.now()}-${randomBytes(3).toString('hex')}`;

function nextOccurrence(from: Date, rule: string): Date {
  const d = new Date(from.getTime());
  const bump = () => {
    if (rule === 'daily') d.setDate(d.getDate() + 1);
    else if (rule === 'weekly') d.setDate(d.getDate() + 7);
    else if (rule === 'monthly') d.setMonth(d.getMonth() + 1);
    else if (rule === 'weekday') { do { d.setDate(d.getDate() + 1); } while (d.getDay() === 0 || d.getDay() === 6); }
    else d.setDate(d.getDate() + 1);
  };
  bump();
  // Ensure the next occurrence is in the future (cap iterations).
  let guard = 0;
  while (d.getTime() <= Date.now() && guard++ < 400) bump();
  return d;
}

// Attach labels + subtask counts to a set of tasks.
async function decorateTasks(rows: any[]) {
  if (rows.length === 0) return [];
  const ids = rows.map(t => t.id);
  const links = await db.select().from(taskLabelLinks).where(inArray(taskLabelLinks.taskId, ids));
  const labelIds = Array.from(new Set(links.map(l => l.labelId)));
  const labels = labelIds.length ? await db.select().from(taskLabels).where(inArray(taskLabels.id, labelIds)) : [];
  const allChildren = await db.select().from(tasks).where(inArray(tasks.parentTaskId, ids));
  return rows.map(t => ({
    ...t,
    labels: links.filter(l => l.taskId === t.id).map(l => labels.find(x => x.id === l.labelId)).filter(Boolean),
    subtaskCount: allChildren.filter(c => c.parentTaskId === t.id).length,
    subtaskDone: allChildren.filter(c => c.parentTaskId === t.id && c.status === 'done').length,
  }));
}

fastify.get('/api/tasks', async (request, reply) => {
  const userId = await requireUser(request, reply);
  if (!userId) return;
  const { view, projectId, label } = request.query as { view?: string, projectId?: string, label?: string };
  let rows = await db.select().from(tasks).where(eq(tasks.ownerId, userId));
  // Only top-level tasks in list views (subtasks are nested under their parent in the UI).
  rows = rows.filter(t => !t.parentTaskId);
  const startToday = new Date(); startToday.setHours(0, 0, 0, 0);
  const endToday = new Date(startToday.getTime() + 86400000);
  if (view === 'today') rows = rows.filter(t => t.status === 'open' && t.dueAt && t.dueAt.getTime() < endToday.getTime());
  else if (view === 'upcoming') rows = rows.filter(t => t.status === 'open' && t.dueAt && t.dueAt.getTime() >= endToday.getTime());
  else if (view === 'inbox') rows = rows.filter(t => !t.projectId);
  else if (view === 'delegated') rows = rows.filter(t => t.createdBy !== userId);
  if (projectId) rows = rows.filter(t => t.projectId === projectId);
  if (label) {
    const links = await db.select().from(taskLabelLinks).where(eq(taskLabelLinks.labelId, label));
    const set = new Set(links.map(l => l.taskId));
    rows = rows.filter(t => set.has(t.id));
  }
  rows.sort((a, b) => a.order - b.order || a.createdAt.getTime() - b.createdAt.getTime());
  return await decorateTasks(rows);
});

fastify.get('/api/tasks/badge', async (request, reply) => {
  const userId = await requireUser(request, reply);
  if (!userId) return;
  const rows = await db.select().from(tasks).where(and(eq(tasks.ownerId, userId), eq(tasks.status, 'open')));
  const endToday = new Date(); endToday.setHours(0, 0, 0, 0); const end = endToday.getTime() + 86400000;
  let today = 0, overdue = 0;
  for (const t of rows) {
    if (!t.dueAt) continue;
    if (t.dueAt.getTime() < Date.now()) overdue++;
    else if (t.dueAt.getTime() < end) today++;
  }
  return { today, overdue };
});

// Lightweight summary for a task link chip in a page (any authenticated user can read it,
// since a task may be owned by someone else but linked in a shared page).
fastify.get('/api/tasks/:id/summary', async (request, reply) => {
  const userId = await requireUser(request, reply);
  if (!userId) return;
  const { id } = request.params as { id: string };
  const t = await db.select().from(tasks).where(eq(tasks.id, id)).get();
  if (!t) return reply.status(404).send({ error: 'Not found' });
  const owner = await db.select().from(users).where(eq(users.id, t.ownerId)).get();
  return { id: t.id, title: t.title, status: t.status, priority: t.priority, dueAt: t.dueAt, ownerId: t.ownerId, ownerName: owner?.name || t.ownerId };
});

// Subtasks of a task (owner-scoped).
fastify.get('/api/tasks/:id/subtasks', async (request, reply) => {
  const userId = await requireUser(request, reply);
  if (!userId) return;
  const { id } = request.params as { id: string };
  const rows = await db.select().from(tasks).where(and(eq(tasks.parentTaskId, id), eq(tasks.ownerId, userId)));
  rows.sort((a, b) => a.order - b.order);
  return rows;
});

fastify.post('/api/tasks', async (request, reply) => {
  const userId = await requireUser(request, reply);
  if (!userId) return;
  const b = request.body as any;
  const id = tid('task');
  await db.insert(tasks).values({
    id, ownerId: userId, title: b.title || 'Untitled', description: b.description || null,
    status: 'open', priority: b.priority || 4,
    dueAt: b.dueAt ? new Date(b.dueAt) : null, dueHasTime: !!b.dueHasTime,
    projectId: b.projectId || null, sectionId: b.sectionId || null, parentTaskId: b.parentTaskId || null,
    order: b.order ?? Date.now(), recurrence: b.recurrence || null, createdBy: userId,
    sourceNodeId: null, sourceBlockId: null, reminderSent: false, completedAt: null, createdAt: new Date(),
  });
  if (Array.isArray(b.labelIds)) for (const lid of b.labelIds) await db.insert(taskLabelLinks).values({ taskId: id, labelId: lid });
  return { id };
});

fastify.patch('/api/tasks/:id', async (request, reply) => {
  const userId = await requireUser(request, reply);
  if (!userId) return;
  const { id } = request.params as { id: string };
  const t = await db.select().from(tasks).where(and(eq(tasks.id, id), eq(tasks.ownerId, userId))).get();
  if (!t) return reply.status(404).send({ error: 'Not found' });
  const b = request.body as any;
  const patch: any = {};
  for (const k of ['title', 'description', 'priority', 'projectId', 'sectionId', 'order', 'recurrence'] as const)
    if (b[k] !== undefined) patch[k] = b[k];
  if (b.dueAt !== undefined) { patch.dueAt = b.dueAt ? new Date(b.dueAt) : null; patch.reminderSent = false; }
  if (b.dueHasTime !== undefined) patch.dueHasTime = !!b.dueHasTime;
  if (Object.keys(patch).length) await db.update(tasks).set(patch).where(eq(tasks.id, id));
  if (Array.isArray(b.labelIds)) {
    await db.delete(taskLabelLinks).where(eq(taskLabelLinks.taskId, id));
    for (const lid of b.labelIds) await db.insert(taskLabelLinks).values({ taskId: id, labelId: lid });
  }
  return { success: true };
});

fastify.post('/api/tasks/:id/complete', async (request, reply) => {
  const userId = await requireUser(request, reply);
  if (!userId) return;
  const { id } = request.params as { id: string };
  const t = await db.select().from(tasks).where(and(eq(tasks.id, id), eq(tasks.ownerId, userId))).get();
  if (!t) return reply.status(404).send({ error: 'Not found' });
  if (t.recurrence && t.dueAt) {
    // Recurring: reschedule to the next occurrence instead of closing.
    await db.update(tasks).set({ dueAt: nextOccurrence(t.dueAt, t.recurrence), reminderSent: false }).where(eq(tasks.id, id));
  } else {
    await db.update(tasks).set({ status: 'done', completedAt: new Date() }).where(eq(tasks.id, id));
  }
  return { success: true };
});

fastify.post('/api/tasks/:id/reopen', async (request, reply) => {
  const userId = await requireUser(request, reply);
  if (!userId) return;
  const { id } = request.params as { id: string };
  await db.update(tasks).set({ status: 'open', completedAt: null }).where(and(eq(tasks.id, id), eq(tasks.ownerId, userId)));
  return { success: true };
});

fastify.delete('/api/tasks/:id', async (request, reply) => {
  const userId = await requireUser(request, reply);
  if (!userId) return;
  const { id } = request.params as { id: string };
  const t = await db.select().from(tasks).where(and(eq(tasks.id, id), eq(tasks.ownerId, userId))).get();
  if (!t) return reply.status(404).send({ error: 'Not found' });
  const subs = await db.select().from(tasks).where(eq(tasks.parentTaskId, id));
  for (const s of [...subs.map(s => s.id), id]) {
    await db.delete(taskLabelLinks).where(eq(taskLabelLinks.taskId, s));
    await db.delete(taskComments).where(eq(taskComments.taskId, s));
    await db.delete(tasks).where(eq(tasks.id, s));
  }
  return { success: true };
});

// ---- Projects / Sections / Labels / Comments ----
fastify.get('/api/task-projects', async (request, reply) => {
  const userId = await requireUser(request, reply);
  if (!userId) return;
  const projects = await db.select().from(taskProjects).where(eq(taskProjects.ownerId, userId));
  projects.sort((a, b) => a.order - b.order);
  const projIds = projects.map(p => p.id);
  const sections = projIds.length ? await db.select().from(taskSections).where(inArray(taskSections.projectId, projIds)) : [];
  return projects.map(p => ({ ...p, sections: sections.filter(s => s.projectId === p.id).sort((a, b) => a.order - b.order) }));
});
fastify.post('/api/task-projects', async (request, reply) => {
  const userId = await requireUser(request, reply);
  if (!userId) return;
  const b = request.body as any; const id = tid('proj');
  await db.insert(taskProjects).values({ id, ownerId: userId, name: b.name || 'New Project', color: b.color || '#0b57d0', order: b.order ?? Date.now(), createdAt: new Date() });
  return { id };
});
fastify.patch('/api/task-projects/:id', async (request, reply) => {
  const userId = await requireUser(request, reply);
  if (!userId) return;
  const { id } = request.params as { id: string }; const b = request.body as any;
  const patch: any = {}; for (const k of ['name', 'color', 'order'] as const) if (b[k] !== undefined) patch[k] = b[k];
  await db.update(taskProjects).set(patch).where(and(eq(taskProjects.id, id), eq(taskProjects.ownerId, userId)));
  return { success: true };
});
fastify.delete('/api/task-projects/:id', async (request, reply) => {
  const userId = await requireUser(request, reply);
  if (!userId) return;
  const { id } = request.params as { id: string };
  await db.update(tasks).set({ projectId: null, sectionId: null }).where(and(eq(tasks.projectId, id), eq(tasks.ownerId, userId)));
  await db.delete(taskSections).where(eq(taskSections.projectId, id));
  await db.delete(taskProjects).where(and(eq(taskProjects.id, id), eq(taskProjects.ownerId, userId)));
  return { success: true };
});
fastify.post('/api/task-sections', async (request, reply) => {
  const userId = await requireUser(request, reply);
  if (!userId) return;
  const b = request.body as any; const id = tid('sec');
  await db.insert(taskSections).values({ id, projectId: b.projectId, name: b.name || 'New Section', order: b.order ?? Date.now() });
  return { id };
});
fastify.patch('/api/task-sections/:id', async (request, reply) => {
  const userId = await requireUser(request, reply);
  if (!userId) return;
  const { id } = request.params as { id: string }; const b = request.body as any;
  const patch: any = {}; for (const k of ['name', 'order'] as const) if (b[k] !== undefined) patch[k] = b[k];
  await db.update(taskSections).set(patch).where(eq(taskSections.id, id));
  return { success: true };
});
fastify.delete('/api/task-sections/:id', async (request, reply) => {
  const userId = await requireUser(request, reply);
  if (!userId) return;
  const { id } = request.params as { id: string };
  await db.update(tasks).set({ sectionId: null }).where(eq(tasks.sectionId, id));
  await db.delete(taskSections).where(eq(taskSections.id, id));
  return { success: true };
});
fastify.get('/api/task-labels', async (request, reply) => {
  const userId = await requireUser(request, reply);
  if (!userId) return;
  return await db.select().from(taskLabels).where(eq(taskLabels.ownerId, userId));
});
fastify.post('/api/task-labels', async (request, reply) => {
  const userId = await requireUser(request, reply);
  if (!userId) return;
  const b = request.body as any; const id = tid('lbl');
  await db.insert(taskLabels).values({ id, ownerId: userId, name: b.name || 'label', color: b.color || '#5f6368' });
  return { id };
});
fastify.delete('/api/task-labels/:id', async (request, reply) => {
  const userId = await requireUser(request, reply);
  if (!userId) return;
  const { id } = request.params as { id: string };
  await db.delete(taskLabelLinks).where(eq(taskLabelLinks.labelId, id));
  await db.delete(taskLabels).where(and(eq(taskLabels.id, id), eq(taskLabels.ownerId, userId)));
  return { success: true };
});
fastify.get('/api/tasks/:id/comments', async (request, reply) => {
  const userId = await requireUser(request, reply);
  if (!userId) return;
  const { id } = request.params as { id: string };
  const rows = await db.select().from(taskComments).where(eq(taskComments.taskId, id)).orderBy(taskComments.createdAt);
  const us = await db.select().from(users);
  return rows.map(c => ({ ...c, authorName: us.find(u => u.id === c.authorId)?.name || c.authorId }));
});
fastify.post('/api/tasks/:id/comments', async (request, reply) => {
  const userId = await requireUser(request, reply);
  if (!userId) return;
  const { id } = request.params as { id: string }; const { text } = request.body as any;
  const cid = tid('tc');
  await db.insert(taskComments).values({ id: cid, taskId: id, authorId: userId, text: text || '', createdAt: new Date() });
  return { id: cid };
});

// ---- Checklist <-> task integration ----
// Assign a task to someone from a page (reminder node): like from-checklist but with a due date.
fastify.post('/api/tasks/assign', async (request, reply) => {
  const actor = await requireUser(request, reply);
  if (!actor) return;
  const { assigneeId, title, dueAt, sourceNodeId } = request.body as any;
  const owner = assigneeId || actor;
  const id = tid('task');
  await db.insert(tasks).values({
    id, ownerId: owner, title: title || 'Reminder', description: null, status: 'open', priority: 4,
    dueAt: dueAt ? new Date(dueAt) : null, dueHasTime: !!dueAt, projectId: null, sectionId: null, parentTaskId: null,
    order: Date.now(), recurrence: null, createdBy: actor, sourceNodeId: sourceNodeId || null, sourceBlockId: null,
    reminderSent: false, completedAt: null, createdAt: new Date(),
  });
  if (sourceNodeId && owner !== actor) await ensureCollaborator(sourceNodeId, owner, 'editor');
  if (owner !== actor) {
    const me = await db.select().from(users).where(eq(users.id, actor)).get();
    await db.insert(notifications).values({
      id: tid('notif'), userId: owner, actorId: actor, type: 'task', nodeId: sourceNodeId || null,
      message: `${me?.name || 'Someone'} set you a reminder: ${title || ''}`.trim(), read: false, createdAt: new Date(),
    });
  }
  return { id };
});

fastify.post('/api/tasks/from-checklist', async (request, reply) => {
  const actor = await requireUser(request, reply);
  if (!actor) return;
  const { assigneeId, title, sourceNodeId, sourceBlockId } = request.body as any;
  if (!assigneeId || !sourceBlockId) return reply.status(400).send({ error: 'Missing fields' });
  // Idempotent: one task per (block, assignee).
  const existing = await db.select().from(tasks).where(and(eq(tasks.sourceBlockId, sourceBlockId), eq(tasks.ownerId, assigneeId))).get();
  if (existing) {
    if (title && title !== existing.title) await db.update(tasks).set({ title }).where(eq(tasks.id, existing.id));
    return { id: existing.id, existed: true };
  }
  const id = tid('task');
  await db.insert(tasks).values({
    id, ownerId: assigneeId, title: title || 'Task from page', description: null, status: 'open', priority: 4,
    dueAt: null, dueHasTime: false, projectId: null, sectionId: null, parentTaskId: null, order: Date.now(),
    recurrence: null, createdBy: actor, sourceNodeId: sourceNodeId || null, sourceBlockId, reminderSent: false,
    completedAt: null, createdAt: new Date(),
  });
  // The assignee must be able to open the page (and tick the box), so grant access.
  if (sourceNodeId) await ensureCollaborator(sourceNodeId, assigneeId, 'editor');
  if (assigneeId !== actor) {
    const me = await db.select().from(users).where(eq(users.id, actor)).get();
    await db.insert(notifications).values({
      id: tid('notif'), userId: assigneeId, actorId: actor, type: 'task', nodeId: sourceNodeId || null,
      message: `${me?.name || 'Someone'} assigned you a task: ${title || ''}`.trim(), read: false, createdAt: new Date(),
    });
  }
  return { id };
});

// Page -> task: toggling the checklist box updates the linked task (any page viewer).
fastify.post('/api/tasks/sync-checklist', async (request, reply) => {
  const userId = await requireUser(request, reply);
  if (!userId) return;
  const { sourceBlockId, checked } = request.body as { sourceBlockId: string, checked: boolean };
  const linked = await db.select().from(tasks).where(eq(tasks.sourceBlockId, sourceBlockId));
  for (const t of linked) {
    if (checked && t.status !== 'done') await db.update(tasks).set({ status: 'done', completedAt: new Date() }).where(eq(tasks.id, t.id));
    if (!checked && t.status === 'done') await db.update(tasks).set({ status: 'open', completedAt: null }).where(eq(tasks.id, t.id));
  }
  return { success: true, count: linked.length };
});

// Editor mapping: minimal info about tasks linked to a page (any owner).
fastify.get('/api/tasks/by-source', async (request, reply) => {
  const userId = await requireUser(request, reply);
  if (!userId) return;
  const { sourceNodeId } = request.query as { sourceNodeId: string };
  const rows = await db.select().from(tasks).where(eq(tasks.sourceNodeId, sourceNodeId));
  return rows.map(t => ({ id: t.id, sourceBlockId: t.sourceBlockId, status: t.status }));
});

// ==========================================
// Hocuspocus (Document Sync)
// ==========================================
const hocuspocus = new Hocuspocus({
  // Gate document access on a real session + node ACL (token sent by the client provider).
  async onAuthenticate(data) {
    const session = data.token
      ? await db.select().from(sessions).where(eq(sessions.token, data.token)).get()
      : null;
    if (!session || session.expiresAt.getTime() < Date.now()) throw new Error('Unauthorized');
    const node = await db.select().from(nodes).where(eq(nodes.id, data.documentName)).get();
    if (!node) throw new Error('Document not found');
    const allowed = node.ownerId === session.userId || (await getHighestRole(session.userId, node.id)) >= ROLE_HIERARCHY.viewer;
    if (!allowed) throw new Error('Unauthorized');
    // Viewers connect read-only.
    const editable = node.ownerId === session.userId || (await getHighestRole(session.userId, node.id)) >= ROLE_HIERARCHY.editor;
    if (!editable) data.connection.readOnly = true;
    return { userId: session.userId };
  },
  async onLoadDocument(data) {
    const doc = await db.select().from(nodes).where(eq(nodes.id, data.documentName)).get();
    if (doc?.content && doc.content.length > 0) {
      Y.applyUpdate(data.document, new Uint8Array(doc.content));
    }
    return data.document;
  },
  async onStoreDocument(data) {
    // Encode the live Y.Doc to its binary state. (The previous code read a
    // non-existent `data.state`, so nothing was ever persisted.)
    const state = Y.encodeStateAsUpdate(data.document);
    await db.update(nodes)
      .set({ content: Buffer.from(state) })
      .where(eq(nodes.id, data.documentName));
  }
});

// ==========================================
// Startup & WebSocket Attachments
// ==========================================
// Periodically notify users about tasks that have come due.
async function scanTaskReminders() {
  const due = await db.select().from(tasks)
    .where(and(eq(tasks.status, 'open'), eq(tasks.reminderSent, false)));
  const now = Date.now();
  for (const t of due) {
    if (!t.dueAt || t.dueAt.getTime() > now) continue;
    await db.insert(notifications).values({
      id: tid('notif'), userId: t.ownerId, actorId: t.ownerId, type: 'task', nodeId: t.sourceNodeId || null,
      message: `Task due: ${t.title}`, read: false, createdAt: new Date(),
    });
    await db.update(tasks).set({ reminderSent: true }).where(eq(tasks.id, t.id));
  }
}

const start = async () => {
  try {
    await fastify.listen({ port: 3001, host: '0.0.0.0' });
    console.log(`Server listening on ${fastify.server.address()}`);

    setInterval(() => { scanTaskReminders().catch(err => fastify.log.error(err)); }, 60_000);

    const wss = new WebSocketServer({ server: fastify.server as http.Server });

    wss.on('connection', (ws, req) => {
      if (req.url?.startsWith('/collaboration')) {
        // Hocuspocus v4 no longer binds socket listeners itself; the
        // integration must forward message/close events to the connection.
        const connection = hocuspocus.handleConnection(ws, req);
        ws.on('message', (data: Buffer) => connection.handleMessage(data));
        ws.on('close', (code: number, reason: Buffer) => connection.handleClose({ code, reason: reason?.toString() }));
      } else if (req.url?.startsWith('/chat')) {
        const token = new URLSearchParams((req.url.split('?')[1] || '')).get('token') || undefined;
        handleChatSocket(ws, token);
      }
    });
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();

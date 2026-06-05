import type { FastifyInstance } from 'fastify';
import { randomBytes } from 'crypto';
import { eq, and, or, inArray, desc, lt, like } from 'drizzle-orm';
import { db } from './db';
import { users, sessions, chatRooms, chatMembers, messages, chatReactions } from './db/schema';
import { requireUser } from './auth';

const cid = (p: string) => `${p}-${Date.now()}-${randomBytes(3).toString('hex')}`;

// ---- in-memory socket registry (live presence + fan-out) ----
const socketsByUser = new Map<string, Set<any>>();
const userBySocket = new Map<any, string>();

function addSocket(userId: string, ws: any) {
  if (!socketsByUser.has(userId)) socketsByUser.set(userId, new Set());
  socketsByUser.get(userId)!.add(ws);
  userBySocket.set(ws, userId);
}
function removeSocket(ws: any): string | null {
  const userId = userBySocket.get(ws);
  if (!userId) return null;
  userBySocket.delete(ws);
  const set = socketsByUser.get(userId);
  set?.delete(ws);
  if (set && set.size === 0) { socketsByUser.delete(userId); return userId; } // last socket gone
  return null;
}
function isOnline(userId: string) { return socketsByUser.has(userId); }
function sendToUser(userId: string, payload: any) {
  const data = JSON.stringify(payload);
  socketsByUser.get(userId)?.forEach(ws => { try { if (ws.readyState === 1) ws.send(data); } catch {} });
}
async function memberIds(roomId: string): Promise<string[]> {
  return (await db.select().from(chatMembers).where(eq(chatMembers.roomId, roomId))).map(m => m.userId);
}
async function fanout(roomId: string, payload: any, exceptUser?: string) {
  for (const id of await memberIds(roomId)) if (id !== exceptUser) sendToUser(id, payload);
}
// users who share at least one room with me (for presence broadcasts)
async function peerIds(userId: string): Promise<string[]> {
  const mine = (await db.select().from(chatMembers).where(eq(chatMembers.userId, userId))).map(m => m.roomId);
  if (mine.length === 0) return [];
  const others = await db.select().from(chatMembers).where(inArray(chatMembers.roomId, mine));
  return Array.from(new Set(others.map(m => m.userId))).filter(id => id !== userId);
}

async function userFromToken(token?: string): Promise<string | null> {
  if (!token) return null;
  const s = await db.select().from(sessions).where(eq(sessions.token, token)).get();
  if (!s || s.expiresAt.getTime() < Date.now()) return null;
  return s.userId;
}

// ---- WS gateway (called from index.ts for /chat connections) ----
export async function handleChatSocket(ws: any, token?: string) {
  const userId = await userFromToken(token);
  if (!userId) { try { ws.close(); } catch {} return; }
  addSocket(userId, ws);
  // tell my peers I'm online (only if this is my first socket)
  if (socketsByUser.get(userId)!.size === 1) {
    const u = await db.select().from(users).where(eq(users.id, userId)).get();
    for (const pid of await peerIds(userId)) sendToUser(pid, { t: 'presence', userId, online: true, status: u?.chatStatus || 'active' });
  }
  ws.on('message', async (raw: Buffer) => {
    let msg: any; try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (msg.t === 'typing' && msg.roomId) {
      fanout(msg.roomId, { t: 'typing', roomId: msg.roomId, userId }, userId);
    } else if (msg.t === 'read' && msg.roomId) {
      await db.update(chatMembers).set({ lastReadAt: new Date(msg.lastReadAt || Date.now()) }).where(and(eq(chatMembers.roomId, msg.roomId), eq(chatMembers.userId, userId)));
      fanout(msg.roomId, { t: 'read', roomId: msg.roomId, userId, at: msg.lastReadAt || Date.now() }, userId);
    }
  });
  ws.on('close', async () => {
    const wentOffline = removeSocket(ws);
    if (wentOffline) for (const pid of await peerIds(wentOffline)) sendToUser(pid, { t: 'presence', userId: wentOffline, online: false });
  });
}

// ---- decoration helpers ----
async function decorate(rows: any[], me: string) {
  if (rows.length === 0) return [];
  const us = await db.select().from(users);
  const name = (id: string) => us.find(u => u.id === id)?.name || id;
  const ids = rows.map(r => r.id);
  const reacts = await db.select().from(chatReactions).where(inArray(chatReactions.messageId, ids));
  // reply counts for these messages (top-level → number of children)
  const children = await db.select().from(messages).where(inArray(messages.parentId, ids));
  return rows.map(m => {
    const rx = reacts.filter(r => r.messageId === m.id);
    const byEmoji = new Map<string, { emoji: string, count: number, me: boolean }>();
    for (const r of rx) { const e = byEmoji.get(r.emoji) || { emoji: r.emoji, count: 0, me: false }; e.count++; if (r.userId === me) e.me = true; byEmoji.set(r.emoji, e); }
    return {
      ...m,
      senderName: name(m.senderId),
      text: m.deletedAt ? '' : m.text,
      deleted: !!m.deletedAt,
      refs: m.refs ? JSON.parse(m.refs) : null,
      attachments: m.attachments ? JSON.parse(m.attachments) : [],
      reactions: Array.from(byEmoji.values()),
      replyCount: children.filter(c => c.parentId === m.id && !c.deletedAt).length,
    };
  });
}

async function roomSummary(room: any, me: string) {
  const mems = await db.select().from(chatMembers).where(eq(chatMembers.roomId, room.id));
  const us = await db.select().from(users);
  const meMem = mems.find(m => m.userId === me);
  const memberUsers = mems.map(m => { const u = us.find(x => x.id === m.userId); return { id: m.userId, name: u?.name || m.userId, online: isOnline(m.userId), status: u?.chatStatus || 'active' }; });
  const other = room.type === 'direct' ? memberUsers.find(m => m.id !== me) : null;
  const last = await db.select().from(messages).where(eq(messages.roomId, room.id)).orderBy(desc(messages.createdAt)).limit(1).get();
  const since = meMem?.lastReadAt ? meMem.lastReadAt.getTime() : 0;
  const allMsgs = await db.select().from(messages).where(eq(messages.roomId, room.id));
  const unread = allMsgs.filter(m => m.senderId !== me && !m.deletedAt && m.createdAt.getTime() > since).length;
  return {
    id: room.id, type: room.type, name: room.name, topic: room.topic, visibility: room.visibility,
    members: memberUsers, other,
    title: room.type === 'direct' ? (other?.name || 'Direct message') : (room.name || 'Group'),
    lastMessage: last ? { text: last.deletedAt ? 'Message deleted' : last.text, senderId: last.senderId, createdAt: last.createdAt } : null,
    unread, muted: !!meMem?.muted, starred: !!meMem?.starred,
  };
}

// ---- REST routes ----
export function registerChatRoutes(fastify: FastifyInstance) {
  // List my rooms (DMs, groups, spaces I joined)
  fastify.get('/api/chat/rooms', async (request, reply) => {
    const me = await requireUser(request, reply); if (!me) return;
    const myMems = await db.select().from(chatMembers).where(eq(chatMembers.userId, me));
    const roomIds = myMems.map(m => m.roomId);
    if (roomIds.length === 0) return [];
    const rooms = await db.select().from(chatRooms).where(inArray(chatRooms.id, roomIds));
    const out = await Promise.all(rooms.map(r => roomSummary(r, me)));
    out.sort((a, b) => (b.lastMessage?.createdAt?.getTime?.() || 0) - (a.lastMessage?.createdAt?.getTime?.() || 0));
    return out;
  });

  // Find or create a 1:1 DM
  fastify.post('/api/chat/dm', async (request, reply) => {
    const me = await requireUser(request, reply); if (!me) return;
    const { userId } = request.body as { userId: string };
    if (!userId || userId === me) return reply.status(400).send({ error: 'Pick another person.' });
    const mine = (await db.select().from(chatMembers).where(eq(chatMembers.userId, me))).map(m => m.roomId);
    const theirs = (await db.select().from(chatMembers).where(eq(chatMembers.userId, userId))).map(m => m.roomId);
    const shared = mine.filter(id => theirs.includes(id));
    for (const rid of shared) { const r = await db.select().from(chatRooms).where(eq(chatRooms.id, rid)).get(); if (r?.type === 'direct') return { id: rid }; }
    const id = cid('room');
    await db.insert(chatRooms).values({ id, name: null, type: 'direct', visibility: 'private', createdBy: me, createdAt: new Date() });
    await db.insert(chatMembers).values({ roomId: id, userId: me, role: 'admin', joinedAt: new Date() });
    await db.insert(chatMembers).values({ roomId: id, userId, role: 'member', joinedAt: new Date() });
    return { id };
  });

  // Create a group DM or a Space
  fastify.post('/api/chat/rooms', async (request, reply) => {
    const me = await requireUser(request, reply); if (!me) return;
    const { type, name, memberIds: mids, visibility, topic } = request.body as any;
    const id = cid('room');
    await db.insert(chatRooms).values({ id, name: name || (type === 'space' ? 'New Space' : 'Group'), type: type === 'space' ? 'space' : 'group', topic: topic || null, visibility: visibility || (type === 'space' ? 'public' : 'private'), createdBy: me, createdAt: new Date() });
    await db.insert(chatMembers).values({ roomId: id, userId: me, role: 'admin', joinedAt: new Date() });
    for (const uid of (mids || [])) if (uid !== me) await db.insert(chatMembers).values({ roomId: id, userId: uid, role: 'member', joinedAt: new Date() }).onConflictDoNothing();
    return { id };
  });

  fastify.get('/api/chat/rooms/:id', async (request, reply) => {
    const me = await requireUser(request, reply); if (!me) return;
    const { id } = request.params as { id: string };
    const room = await db.select().from(chatRooms).where(eq(chatRooms.id, id)).get();
    if (!room) return reply.status(404).send({ error: 'Not found' });
    return roomSummary(room, me);
  });

  fastify.patch('/api/chat/rooms/:id', async (request, reply) => {
    const me = await requireUser(request, reply); if (!me) return;
    const { id } = request.params as { id: string };
    const b = request.body as any; const patch: any = {};
    for (const k of ['name', 'topic', 'visibility'] as const) if (b[k] !== undefined) patch[k] = b[k];
    if (Object.keys(patch).length) await db.update(chatRooms).set(patch).where(eq(chatRooms.id, id));
    fanout(id, { t: 'room', roomId: id });
    return { success: true };
  });

  // My membership flags (mute / star)
  fastify.patch('/api/chat/rooms/:id/me', async (request, reply) => {
    const me = await requireUser(request, reply); if (!me) return;
    const { id } = request.params as { id: string };
    const b = request.body as any; const patch: any = {};
    if (b.muted !== undefined) patch.muted = !!b.muted;
    if (b.starred !== undefined) patch.starred = !!b.starred;
    await db.update(chatMembers).set(patch).where(and(eq(chatMembers.roomId, id), eq(chatMembers.userId, me)));
    return { success: true };
  });

  fastify.post('/api/chat/rooms/:id/read', async (request, reply) => {
    const me = await requireUser(request, reply); if (!me) return;
    const { id } = request.params as { id: string };
    await db.update(chatMembers).set({ lastReadAt: new Date() }).where(and(eq(chatMembers.roomId, id), eq(chatMembers.userId, me)));
    return { success: true };
  });

  // Public spaces I can browse/join
  fastify.get('/api/chat/spaces', async (request, reply) => {
    const me = await requireUser(request, reply); if (!me) return;
    const spaces = await db.select().from(chatRooms).where(and(eq(chatRooms.type, 'space'), eq(chatRooms.visibility, 'public')));
    const myRooms = new Set((await db.select().from(chatMembers).where(eq(chatMembers.userId, me))).map(m => m.roomId));
    const counts = await db.select().from(chatMembers);
    return spaces.map(s => ({ id: s.id, name: s.name, topic: s.topic, members: counts.filter(c => c.roomId === s.id).length, joined: myRooms.has(s.id) }));
  });
  fastify.post('/api/chat/rooms/:id/join', async (request, reply) => {
    const me = await requireUser(request, reply); if (!me) return;
    const { id } = request.params as { id: string };
    await db.insert(chatMembers).values({ roomId: id, userId: me, role: 'member', joinedAt: new Date() }).onConflictDoNothing();
    return { success: true };
  });
  fastify.post('/api/chat/rooms/:id/leave', async (request, reply) => {
    const me = await requireUser(request, reply); if (!me) return;
    const { id } = request.params as { id: string };
    await db.delete(chatMembers).where(and(eq(chatMembers.roomId, id), eq(chatMembers.userId, me)));
    return { success: true };
  });
  fastify.post('/api/chat/rooms/:id/members', async (request, reply) => {
    const me = await requireUser(request, reply); if (!me) return;
    const { id } = request.params as { id: string };
    const { userId } = request.body as { userId: string };
    await db.insert(chatMembers).values({ roomId: id, userId, role: 'member', joinedAt: new Date() }).onConflictDoNothing();
    fanout(id, { t: 'room', roomId: id });
    return { success: true };
  });
  fastify.delete('/api/chat/rooms/:id/members/:userId', async (request, reply) => {
    const me = await requireUser(request, reply); if (!me) return;
    const { id, userId } = request.params as { id: string, userId: string };
    await db.delete(chatMembers).where(and(eq(chatMembers.roomId, id), eq(chatMembers.userId, userId)));
    return { success: true };
  });

  // Message history (paginated; thread via parentId)
  fastify.get('/api/chat/rooms/:id/messages', async (request, reply) => {
    const me = await requireUser(request, reply); if (!me) return;
    const { id } = request.params as { id: string };
    const { before, parentId } = request.query as { before?: string, parentId?: string };
    const conds: any[] = [eq(messages.roomId, id)];
    if (before) conds.push(lt(messages.createdAt, new Date(before)));
    let rows = await db.select().from(messages).where(and(...conds)).orderBy(desc(messages.createdAt)).limit(60);
    rows = rows.filter(m => parentId ? m.parentId === parentId : !m.parentId);
    rows.reverse();
    return decorate(rows, me);
  });

  // Thread replies
  fastify.get('/api/chat/messages/:id/replies', async (request, reply) => {
    const me = await requireUser(request, reply); if (!me) return;
    const { id } = request.params as { id: string };
    const rows = await db.select().from(messages).where(eq(messages.parentId, id)).orderBy(messages.createdAt);
    return decorate(rows, me);
  });

  // Send a message
  fastify.post('/api/chat/rooms/:id/messages', async (request, reply) => {
    const me = await requireUser(request, reply); if (!me) return;
    const { id } = request.params as { id: string };
    const { text, parentId, refs, attachments } = request.body as any;
    const member = await db.select().from(chatMembers).where(and(eq(chatMembers.roomId, id), eq(chatMembers.userId, me))).get();
    if (!member) return reply.status(403).send({ error: 'You are not a member of this conversation.' });
    const msgId = cid('msg');
    await db.insert(messages).values({
      id: msgId, roomId: id, senderId: me, text: text || '', parentId: parentId || null,
      refs: refs ? JSON.stringify(refs) : null, attachments: attachments && attachments.length ? JSON.stringify(attachments) : null,
      createdAt: new Date(),
    });
    await db.update(chatMembers).set({ lastReadAt: new Date() }).where(and(eq(chatMembers.roomId, id), eq(chatMembers.userId, me)));
    const [decorated] = await decorate([await db.select().from(messages).where(eq(messages.id, msgId)).get()], me);
    await fanout(id, { t: 'message', roomId: id, message: decorated });
    return decorated;
  });

  fastify.patch('/api/chat/messages/:id', async (request, reply) => {
    const me = await requireUser(request, reply); if (!me) return;
    const { id } = request.params as { id: string };
    const { text, refs } = request.body as any;
    const m = await db.select().from(messages).where(eq(messages.id, id)).get();
    if (!m || m.senderId !== me) return reply.status(403).send({ error: 'You can only edit your own messages.' });
    await db.update(messages).set({ text: text ?? m.text, refs: refs ? JSON.stringify(refs) : m.refs, editedAt: new Date() }).where(eq(messages.id, id));
    const [d] = await decorate([await db.select().from(messages).where(eq(messages.id, id)).get()], me);
    await fanout(m.roomId, { t: 'message:edit', roomId: m.roomId, message: d });
    return d;
  });

  fastify.delete('/api/chat/messages/:id', async (request, reply) => {
    const me = await requireUser(request, reply); if (!me) return;
    const { id } = request.params as { id: string };
    const m = await db.select().from(messages).where(eq(messages.id, id)).get();
    if (!m || m.senderId !== me) return reply.status(403).send({ error: 'You can only delete your own messages.' });
    await db.update(messages).set({ deletedAt: new Date() }).where(eq(messages.id, id));
    await fanout(m.roomId, { t: 'message:delete', roomId: m.roomId, messageId: id });
    return { success: true };
  });

  // Toggle a reaction
  fastify.post('/api/chat/messages/:id/react', async (request, reply) => {
    const me = await requireUser(request, reply); if (!me) return;
    const { id } = request.params as { id: string };
    const { emoji } = request.body as { emoji: string };
    const m = await db.select().from(messages).where(eq(messages.id, id)).get();
    if (!m) return reply.status(404).send({ error: 'Not found' });
    const existing = await db.select().from(chatReactions).where(and(eq(chatReactions.messageId, id), eq(chatReactions.userId, me), eq(chatReactions.emoji, emoji))).get();
    if (existing) await db.delete(chatReactions).where(and(eq(chatReactions.messageId, id), eq(chatReactions.userId, me), eq(chatReactions.emoji, emoji)));
    else await db.insert(chatReactions).values({ messageId: id, userId: me, emoji });
    const [d] = await decorate([m], me);
    await fanout(m.roomId, { t: 'reaction', roomId: m.roomId, messageId: id, reactions: d.reactions });
    return { reactions: d.reactions };
  });

  // @mentions of me, across my rooms (chat-only, separate from the notification bell)
  fastify.get('/api/chat/mentions', async (request, reply) => {
    const me = await requireUser(request, reply); if (!me) return;
    const roomIds = (await db.select().from(chatMembers).where(eq(chatMembers.userId, me))).map(m => m.roomId);
    if (roomIds.length === 0) return [];
    const rows = (await db.select().from(messages).where(inArray(messages.roomId, roomIds)).orderBy(desc(messages.createdAt)).limit(200))
      .filter(m => !m.deletedAt && m.senderId !== me && m.refs && (JSON.parse(m.refs).users || []).includes(me));
    const dec = await decorate(rows.slice(0, 50), me);
    const rooms = await db.select().from(chatRooms);
    return dec.map(m => ({ ...m, roomName: rooms.find(r => r.id === m.roomId)?.name || 'Direct message' }));
  });

  fastify.get('/api/chat/search', async (request, reply) => {
    const me = await requireUser(request, reply); if (!me) return;
    const { q } = request.query as { q: string };
    if (!q?.trim()) return [];
    const roomIds = (await db.select().from(chatMembers).where(eq(chatMembers.userId, me))).map(m => m.roomId);
    if (roomIds.length === 0) return [];
    const rows = await db.select().from(messages).where(and(inArray(messages.roomId, roomIds), like(messages.text, `%${q}%`))).orderBy(desc(messages.createdAt)).limit(40);
    return decorate(rows.filter(m => !m.deletedAt), me);
  });

  // Total unread for the header badge
  fastify.get('/api/chat/badge', async (request, reply) => {
    const me = await requireUser(request, reply); if (!me) return;
    const myMems = await db.select().from(chatMembers).where(eq(chatMembers.userId, me));
    let unread = 0, mentions = 0;
    for (const mem of myMems) {
      const since = mem.lastReadAt ? mem.lastReadAt.getTime() : 0;
      const msgs = await db.select().from(messages).where(eq(messages.roomId, mem.roomId));
      for (const m of msgs) {
        if (m.senderId === me || m.deletedAt || m.createdAt.getTime() <= since) continue;
        if (!mem.muted) unread++;
        if (m.refs && (JSON.parse(m.refs).users || []).includes(me)) mentions++;
      }
    }
    return { unread, mentions };
  });

  // Presence status (active / away / dnd)
  fastify.post('/api/chat/status', async (request, reply) => {
    const me = await requireUser(request, reply); if (!me) return;
    const { status, statusText } = request.body as any;
    await db.update(users).set({ chatStatus: status || 'active', chatStatusText: statusText ?? null }).where(eq(users.id, me));
    for (const pid of await peerIds(me)) sendToUser(pid, { t: 'presence', userId: me, online: isOnline(me), status: status || 'active' });
    return { success: true };
  });
}

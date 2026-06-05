import { sqliteTable, text, integer, blob, real } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  // scrypt hash in the form `salt:hash` (both hex). Null until a password is set.
  passwordHash: text('password_hash'),
  globalRole: text('global_role', { enum: ['admin', 'member'] }).notNull().default('member'),
  // Suspended users keep their data but cannot sign in.
  status: text('status', { enum: ['active', 'suspended'] }).notNull().default('active'),
  createdAt: integer('created_at', { mode: 'timestamp' }),
  // Profile picture (blob store key + mime). Null = use initials avatar.
  avatarKey: text('avatar_key'),
  avatarMime: text('avatar_mime'),
  // TOTP two-factor auth. Secret is set during setup; enabled once a code is verified.
  totpSecret: text('totp_secret'),
  totpEnabled: integer('totp_enabled', { mode: 'boolean' }).notNull().default(false),
  // Chat presence status (manual). Live online/offline is tracked in-memory by the WS gateway.
  chatStatus: text('chat_status', { enum: ['active', 'away', 'dnd'] }).notNull().default('active'),
  chatStatusText: text('chat_status_text'),
});

// Server-side sessions. The token is an opaque random string presented as
// `Authorization: Bearer <token>`; we look up the user from it on every request.
export const sessions = sqliteTable('sessions', {
  token: text('token').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
});

export const groups = sqliteTable('groups', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  parentId: text('parent_id'), // Self-referential for Org Chart
});

export const groupMembers = sqliteTable('group_members', {
  groupId: text('group_id').notNull().references(() => groups.id),
  userId: text('user_id').notNull().references(() => users.id),
});

export const nodes = sqliteTable('nodes', {
  id: text('id').primaryKey(),
  type: text('type', { enum: ['drive', 'folder', 'document', 'file'] }).notNull(),
  parentId: text('parent_id'), // Self-referential
  name: text('name').notNull().default('Untitled'),
  content: blob('content', { mode: 'buffer' }), // Yjs binary state for documents
  // For uploaded files: key into the blob store + metadata. Null for non-file nodes.
  storageKey: text('storage_key'),
  mimeType: text('mime_type'),
  size: integer('size'),
  ownerId: text('owner_id').notNull().references(() => users.id), // The creator
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  // Soft-delete: when set, the node is in Trash. Null means active.
  deletedAt: integer('deleted_at', { mode: 'timestamp' }),
  // Page cover/icon (documents): emoji icon + uploaded cover-image storage key.
  icon: text('icon'),
  coverKey: text('cover_key'),
});

// Personal stars/favorites on nodes (per user).
export const nodeStars = sqliteTable('node_stars', {
  userId: text('user_id').notNull().references(() => users.id),
  nodeId: text('node_id').notNull().references(() => nodes.id),
});

export const permissions = sqliteTable('permissions', {
  id: text('id').primaryKey(),
  nodeId: text('node_id').notNull().references(() => nodes.id),
  granteeType: text('grantee_type', { enum: ['user', 'group', 'workspace', 'public'] }).notNull(),
  granteeId: text('grantee_id').notNull(), // User ID, Group ID, or 'all'
  role: text('role', { enum: ['viewer', 'commenter', 'editor', 'manager'] }).notNull(),
});

export const chatRooms = sqliteTable('chat_rooms', {
  id: text('id').primaryKey(),
  name: text('name'),
  type: text('type', { enum: ['direct', 'group', 'space'] }).notNull(),
  topic: text('topic'),
  visibility: text('visibility', { enum: ['public', 'private'] }).notNull().default('private'),
  createdBy: text('created_by'),
  createdAt: integer('created_at', { mode: 'timestamp' }),
});

export const chatMembers = sqliteTable('chat_members', {
  roomId: text('room_id').notNull().references(() => chatRooms.id),
  userId: text('user_id').notNull().references(() => users.id),
  role: text('role', { enum: ['member', 'admin'] }).notNull().default('member'),
  lastReadAt: integer('last_read_at', { mode: 'timestamp' }),
  muted: integer('muted', { mode: 'boolean' }).notNull().default(false),
  starred: integer('starred', { mode: 'boolean' }).notNull().default(false),
  joinedAt: integer('joined_at', { mode: 'timestamp' }),
});

export const messages = sqliteTable('messages', {
  id: text('id').primaryKey(),
  roomId: text('room_id').notNull().references(() => chatRooms.id),
  senderId: text('sender_id').notNull().references(() => users.id),
  text: text('text').notNull(),
  parentId: text('parent_id'), // thread root; null = top-level
  refs: text('refs'),           // JSON: { users:[], pages:[], files:[], tasks:[] }
  attachments: text('attachments'), // JSON: array of file node ids
  editedAt: integer('edited_at', { mode: 'timestamp' }),
  deletedAt: integer('deleted_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

export const chatReactions = sqliteTable('chat_reactions', {
  messageId: text('message_id').notNull().references(() => messages.id),
  userId: text('user_id').notNull().references(() => users.id),
  emoji: text('emoji').notNull(),
});

// In-app notifications (e.g. when someone @mentions you in a Page or comment).
export const notifications = sqliteTable('notifications', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id), // recipient
  actorId: text('actor_id').notNull().references(() => users.id), // who triggered it
  type: text('type', { enum: ['mention', 'comment', 'task'] }).notNull(),
  nodeId: text('node_id'), // the page/document referenced
  message: text('message').notNull(),
  read: integer('read', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

// Pending invitations. The token is shared as a link; accepting it creates the user.
export const invitations = sqliteTable('invitations', {
  id: text('id').primaryKey(),
  email: text('email').notNull(),
  role: text('role', { enum: ['admin', 'member'] }).notNull().default('member'),
  token: text('token').notNull().unique(),
  status: text('status', { enum: ['pending', 'accepted', 'revoked'] }).notNull().default('pending'),
  groupIds: text('group_ids'), // JSON array of group ids to add the user to on accept
  acceptedUserId: text('accepted_user_id'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
});

// Admin audit trail — who did what, when.
export const auditLog = sqliteTable('audit_log', {
  id: text('id').primaryKey(),
  actorId: text('actor_id').notNull(),
  action: text('action').notNull(),
  targetType: text('target_type'),
  targetId: text('target_id'),
  detail: text('detail'), // JSON
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

// Workspace settings as a simple key/value store (org name, logo, default role, allowed domains).
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value'),
});

// ===== Tasks (personal task manager) =====
export const taskProjects = sqliteTable('task_projects', {
  id: text('id').primaryKey(),
  ownerId: text('owner_id').notNull().references(() => users.id),
  name: text('name').notNull(),
  color: text('color').notNull().default('#0b57d0'),
  order: real('order').notNull().default(0),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

export const taskSections = sqliteTable('task_sections', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => taskProjects.id),
  name: text('name').notNull(),
  order: real('order').notNull().default(0),
});

export const tasks = sqliteTable('tasks', {
  id: text('id').primaryKey(),
  ownerId: text('owner_id').notNull().references(() => users.id), // whose task list it lives in
  title: text('title').notNull(),
  description: text('description'),
  status: text('status', { enum: ['open', 'done'] }).notNull().default('open'),
  priority: integer('priority').notNull().default(4), // 1 = urgent .. 4 = none
  dueAt: integer('due_at', { mode: 'timestamp' }),
  dueHasTime: integer('due_has_time', { mode: 'boolean' }).notNull().default(false),
  projectId: text('project_id'), // null = Inbox
  sectionId: text('section_id'),
  parentTaskId: text('parent_task_id'), // null = top-level; else a subtask
  order: real('order').notNull().default(0),
  recurrence: text('recurrence'), // null | 'daily' | 'weekday' | 'weekly' | 'monthly'
  createdBy: text('created_by').notNull(),
  sourceNodeId: text('source_node_id'), // page the checklist lives in (if any)
  sourceBlockId: text('source_block_id'), // checklist block id, for page->task sync
  reminderSent: integer('reminder_sent', { mode: 'boolean' }).notNull().default(false),
  completedAt: integer('completed_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

export const taskLabels = sqliteTable('task_labels', {
  id: text('id').primaryKey(),
  ownerId: text('owner_id').notNull().references(() => users.id),
  name: text('name').notNull(),
  color: text('color').notNull().default('#5f6368'),
});

export const taskLabelLinks = sqliteTable('task_label_links', {
  taskId: text('task_id').notNull().references(() => tasks.id),
  labelId: text('label_id').notNull().references(() => taskLabels.id),
});

export const taskComments = sqliteTable('task_comments', {
  id: text('id').primaryKey(),
  taskId: text('task_id').notNull().references(() => tasks.id),
  authorId: text('author_id').notNull().references(() => users.id),
  text: text('text').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

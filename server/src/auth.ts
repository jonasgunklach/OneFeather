import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'crypto';
import { promisify } from 'util';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { eq } from 'drizzle-orm';
import { db } from './db';
import { users, sessions } from './db/schema';

const scrypt = promisify(scryptCb);
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

// Password hashing via Node's built-in scrypt (no native deps). Stored as `salt:hash`.
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `${salt.toString('hex')}:${derived.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored || !stored.includes(':')) return false;
  const [saltHex, hashHex] = stored.split(':');
  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(hashHex, 'hex');
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

export async function createSession(userId: string): Promise<string> {
  const token = randomBytes(32).toString('hex');
  const now = new Date();
  await db.insert(sessions).values({
    token,
    userId,
    createdAt: now,
    expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
  });
  return token;
}

export async function destroySession(token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.token, token));
}

// Resolve the authenticated user id from the Bearer token, or null.
export async function resolveUserId(request: FastifyRequest): Promise<string | null> {
  const header = request.headers['authorization'];
  if (!header || !header.startsWith('Bearer ')) return null;
  const token = header.slice('Bearer '.length);
  const session = await db.select().from(sessions).where(eq(sessions.token, token)).get();
  if (!session) return null;
  if (session.expiresAt.getTime() < Date.now()) {
    await destroySession(token);
    return null;
  }
  return session.userId;
}

// Require auth; sends 401 and returns null if missing. Otherwise returns the user id.
export async function requireUser(request: FastifyRequest, reply: FastifyReply): Promise<string | null> {
  const userId = await resolveUserId(request);
  if (!userId) {
    reply.status(401).send({ error: 'Authentication required' });
    return null;
  }
  return userId;
}

export async function findUserByEmail(email: string) {
  return db.select().from(users).where(eq(users.email, email)).get();
}

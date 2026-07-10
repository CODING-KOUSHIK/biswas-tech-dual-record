// lib/redis.ts — Upstash Redis wrapper with typed helpers

import { Redis } from '@upstash/redis';
import type { AppUser, InviteRecord } from '@/types';

// Lazy-initialize Redis so missing env vars don't crash the entire app at startup.
// Individual function calls will throw if Redis is unconfigured.
function getRedis(): Redis {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    throw new Error(
      'UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN must be set in environment variables.'
    );
  }

  return new Redis({ url, token });
}

// ─── User operations ─────────────────────────────────────────

const userKey = (userId: string) => `user:${userId}`;
const USERS_SET = 'users:all';

export async function getUser(userId: string): Promise<AppUser | null> {
  return getRedis().get<AppUser>(userKey(userId));
}

export async function createUser(user: AppUser): Promise<void> {
  const r = getRedis();
  await r.set(userKey(user.userId), user);
  await r.sadd(USERS_SET, user.userId);
}

export async function listUsers(): Promise<AppUser[]> {
  const r = getRedis();
  const ids = await r.smembers(USERS_SET);
  if (!ids || ids.length === 0) return [];
  const users = await Promise.all(
    ids.map((id) => r.get<AppUser>(userKey(String(id))))
  );
  return users.filter((u): u is AppUser => u !== null);
}

export async function deleteUser(userId: string): Promise<void> {
  const r = getRedis();
  await r.del(userKey(userId));
  await r.srem(USERS_SET, userId);
}

// ─── Device lock: one device per account ─────────────────────

const deviceLockKey = (userId: string) => `device:${userId}`;

export async function getLockedDevice(userId: string): Promise<string | null> {
  return getRedis().get<string>(deviceLockKey(userId));
}

export async function setLockedDevice(userId: string, deviceId: string): Promise<void> {
  await getRedis().set(deviceLockKey(userId), deviceId);
}

export async function resetLockedDevice(userId: string): Promise<void> {
  await getRedis().del(deviceLockKey(userId));
}

// ─── Invite operations ───────────────────────────────────────

const inviteKey = (token: string) => `invite:${token}`;
const INVITE_TTL = 7 * 24 * 60 * 60; // 7 days in seconds

export async function getInvite(token: string): Promise<InviteRecord | null> {
  return getRedis().get<InviteRecord>(inviteKey(token));
}

export async function createInvite(invite: InviteRecord): Promise<void> {
  await getRedis().set(inviteKey(invite.token), invite, { ex: INVITE_TTL });
}

export async function updateInvite(
  token: string,
  updates: Partial<InviteRecord>
): Promise<void> {
  const existing = await getInvite(token);
  if (!existing) throw new Error('Invite not found');
  await getRedis().set(inviteKey(token), { ...existing, ...updates }, { ex: INVITE_TTL });
}

// ─── Rate limiting (fixed window) ────────────────────────────

export async function checkRateLimit(
  identifier: string,
  maxRequests: number,
  windowSeconds: number
): Promise<boolean> {
  const r = getRedis();
  const window = Math.floor(Date.now() / (windowSeconds * 1000));
  const key = `ratelimit:${identifier}:${window}`;
  const count = await r.incr(key);
  if (count === 1) {
    await r.expire(key, windowSeconds);
  }
  return count <= maxRequests;
}

export default getRedis;

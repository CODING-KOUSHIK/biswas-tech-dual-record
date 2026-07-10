// lib/redis.ts — Upstash Redis wrapper with typed helpers
// Replaces the deprecated @vercel/kv package.

import { Redis } from '@upstash/redis';
import type { AppUser, InviteRecord } from '@/types';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

// ─── User operations ─────────────────────────────────────────

const userKey = (userId: string) => `user:${userId}`;
const USERS_SET = 'users:all';

export async function getUser(userId: string): Promise<AppUser | null> {
  return redis.get<AppUser>(userKey(userId));
}

export async function createUser(user: AppUser): Promise<void> {
  await redis.set(userKey(user.userId), user);
  await redis.sadd(USERS_SET, user.userId);
}

export async function listUsers(): Promise<AppUser[]> {
  const ids = await redis.smembers(USERS_SET);
  if (!ids || ids.length === 0) return [];
  const users = await Promise.all(ids.map((id) => redis.get<AppUser>(userKey(String(id)))));
  return users.filter((u): u is AppUser => u !== null);
}

export async function deleteUser(userId: string): Promise<void> {
  await redis.del(userKey(userId));
  await redis.srem(USERS_SET, userId);
}

// ─── Device lock: one device per account ─────────────────────

const deviceLockKey = (userId: string) => `device:${userId}`;

export async function getLockedDevice(userId: string): Promise<string | null> {
  return redis.get<string>(deviceLockKey(userId));
}

export async function setLockedDevice(userId: string, deviceId: string): Promise<void> {
  await redis.set(deviceLockKey(userId), deviceId);
}

export async function resetLockedDevice(userId: string): Promise<void> {
  await redis.del(deviceLockKey(userId));
}

// ─── Invite operations ───────────────────────────────────────

const inviteKey = (token: string) => `invite:${token}`;
const INVITE_TTL = 7 * 24 * 60 * 60; // 7 days in seconds

export async function getInvite(token: string): Promise<InviteRecord | null> {
  return redis.get<InviteRecord>(inviteKey(token));
}

export async function createInvite(invite: InviteRecord): Promise<void> {
  await redis.set(inviteKey(invite.token), invite, { ex: INVITE_TTL });
}

export async function updateInvite(
  token: string,
  updates: Partial<InviteRecord>
): Promise<void> {
  const existing = await getInvite(token);
  if (!existing) throw new Error('Invite not found');
  await redis.set(inviteKey(token), { ...existing, ...updates }, { ex: INVITE_TTL });
}

// ─── Rate limiting (fixed window) ────────────────────────────

/**
 * Returns true if the request is allowed, false if rate limited.
 */
export async function checkRateLimit(
  identifier: string,
  maxRequests: number,
  windowSeconds: number
): Promise<boolean> {
  const window = Math.floor(Date.now() / (windowSeconds * 1000));
  const key = `ratelimit:${identifier}:${window}`;
  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, windowSeconds);
  }
  return count <= maxRequests;
}

export default redis;

// lib/redis.ts — Upstash Redis client for invite management
import 'server-only';
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

export interface InviteRecord {
  code: string;             // 8-char invite code
  pairId: string;           // 5-digit pair ID
  roomId: string;           // LiveKit room name
  hostDeviceId: string;
  hostName: string;
  hostLanguage: string;
  hostGender: string;
  partnerGender: string;    // expected partner gender
  boundPartnerDeviceId: string | null; // null until first device joins
  createdAt: number;
}

const INVITE_TTL = 60 * 60 * 24 * 7; // 7 days
const KEY = (code: string) => `btd:invite:${code}`;

export async function createInvite(invite: InviteRecord): Promise<void> {
  await redis.set(KEY(invite.code), JSON.stringify(invite), { ex: INVITE_TTL });
}

export async function getInvite(code: string): Promise<InviteRecord | null> {
  const raw = await redis.get<string>(KEY(code));
  if (!raw) return null;
  try {
    return typeof raw === 'string' ? JSON.parse(raw) : (raw as InviteRecord);
  } catch {
    return null;
  }
}

/** Attempt to bind a partner device to an invite.
 *  Returns the invite if allowed, null if rejected (already bound to different device). */
export async function bindPartner(
  code: string,
  partnerDeviceId: string
): Promise<InviteRecord | null> {
  const invite = await getInvite(code);
  if (!invite) return null;

  // Reject host using guest link
  if (invite.hostDeviceId === partnerDeviceId) return null;

  // Already bound to this device — OK (returning partner)
  if (invite.boundPartnerDeviceId === partnerDeviceId) return invite;

  // Already bound to DIFFERENT device — reject
  if (invite.boundPartnerDeviceId !== null) return null;

  // First time — bind
  const updated: InviteRecord = { ...invite, boundPartnerDeviceId: partnerDeviceId };
  await redis.set(KEY(code), JSON.stringify(updated), { ex: INVITE_TTL });
  return updated;
}

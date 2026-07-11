// lib/invite-token.ts — Self-contained signed invite tokens (server-only)
// No Redis needed. All invite data is embedded and signed in the token itself.
// Token is URL-safe and verifiable on any server restart.

import 'server-only';
import { SignJWT, jwtVerify } from 'jose';
import type { Gender } from '@/types';

export interface InvitePayload {
  roomId: string;
  partnerGender: Gender;
  hostId: string;
}

const INVITE_TTL_DAYS = 7;

function getKey(): Uint8Array {
  // Use SESSION_SECRET if available, otherwise use a stable default for bypass mode
  const secret =
    process.env.SESSION_SECRET ??
    process.env.LIVEKIT_API_SECRET ??
    'biswas-tech-invite-signing-key-stable-32ch';
  return new TextEncoder().encode(secret);
}

/**
 * Create a self-contained signed invite token.
 * The token encodes roomId, partnerGender, and hostId.
 * No database storage required.
 */
export async function createInviteToken(payload: InvitePayload): Promise<string> {
  const jwt = await new SignJWT(payload as unknown as Record<string, unknown>)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${INVITE_TTL_DAYS}d`)
    .sign(getKey());

  // Replace dots with tildes so the JWT is safe as a URL path segment
  // (some proxies treat path segments with dots as file extensions)
  return jwt.replace(/\./g, '~');
}

/**
 * Verify and decode a self-contained invite token.
 * Returns null if invalid or expired.
 */
export async function verifyInviteToken(token: string): Promise<InvitePayload | null> {
  try {
    // Restore dots that were replaced with tildes
    const jwt = token.replace(/~/g, '.');
    const { payload } = await jwtVerify(jwt, getKey(), { algorithms: ['HS256'] });
    const p = payload as unknown as InvitePayload;
    if (!p.roomId || !p.partnerGender || !p.hostId) return null;
    return p;
  } catch {
    return null;
  }
}

/**
 * Check if a string looks like a self-contained invite token.
 * Self-contained tokens contain tildes (replacing JWT dots).
 */
export function isSelfContainedToken(token: string): boolean {
  return token.includes('~');
}

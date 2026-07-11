// lib/session.ts — Server-only JWT session management using jose

import 'server-only';
import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import type { SessionPayload } from '@/types';

const SESSION_COOKIE = 'btd_session';

// ─── Bypass mode ─────────────────────────────────────────────
// When AUTH_BYPASS=true, all requests are treated as host.
// TODO: Remove this and set AUTH_BYPASS=false for real auth.

const BYPASS_SESSION: SessionPayload = {
  userId: 'host',
  role: 'host',
  gender: 'MALE',
  language: 'EN',
  deviceId: 'AUTO',
};

function isAuthBypassed(): boolean {
  return process.env.AUTH_BYPASS === 'true';
}

// ─── Key ─────────────────────────────────────────────────────

function getKey(): Uint8Array {
  const secretKey = process.env.SESSION_SECRET;
  if (!secretKey || secretKey.length < 16) {
    // In bypass mode, use a dummy key
    if (isAuthBypassed()) {
      return new TextEncoder().encode('bypass-mode-dummy-secret-key-32chars!!');
    }
    throw new Error('SESSION_SECRET env var must be at least 32 characters');
  }
  return new TextEncoder().encode(secretKey);
}

// ─── Encrypt / Decrypt ───────────────────────────────────────

export async function encrypt(payload: SessionPayload): Promise<string> {
  return new SignJWT(payload as unknown as Record<string, unknown>)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('24h')
    .sign(getKey());
}

export async function decrypt(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getKey(), {
      algorithms: ['HS256'],
    });
    return payload as unknown as SessionPayload;
  } catch {
    return null;
  }
}

// ─── Session operations ───────────────────────────────────────

export async function createSession(payload: SessionPayload): Promise<void> {
  const token = await encrypt(payload);
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const cookieStore = await cookies();

  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    expires: expiresAt,
    path: '/',
  });
}

/**
 * Get current session. Returns bypass session if AUTH_BYPASS=true.
 * Returns null only when auth is enforced and no valid session exists.
 */
export async function getSession(): Promise<SessionPayload | null> {
  // Bypass mode: always return host session
  if (isAuthBypassed()) {
    return BYPASS_SESSION;
  }

  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return decrypt(token);
}

/**
 * Get current session, falling back to bypass session if none.
 * Use this in API routes and pages when auth is temporarily disabled.
 */
export async function getSessionOrBypass(): Promise<SessionPayload> {
  return (await getSession()) ?? BYPASS_SESSION;
}

export async function deleteSession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
}

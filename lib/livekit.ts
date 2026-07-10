// lib/livekit.ts — LiveKit token generation (server-only)
// API Secret is NEVER exposed to the browser.

import 'server-only';
import { AccessToken, VideoGrant } from 'livekit-server-sdk';
import type { UserRole } from '@/types';

// ─── Token TTL ───────────────────────────────────────────────
const TOKEN_TTL_SECONDS = 3600; // 1 hour as required

// ─── Internal app token (dual-recording flow) ────────────────

interface InternalTokenOptions {
  identity: string;
  roomId: string;
  role: UserRole;
  metadata?: string;
}

export async function generateLiveKitToken({
  identity,
  roomId,
  role,
  metadata,
}: InternalTokenOptions): Promise<string> {
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;

  if (!apiKey || !apiSecret) {
    throw new Error('LIVEKIT_API_KEY or LIVEKIT_API_SECRET is not configured');
  }

  void role; // role is stored in metadata; grants are uniform for all participants

  const at = new AccessToken(apiKey, apiSecret, {
    identity,
    ttl: TOKEN_TTL_SECONDS,
    metadata,
  });

  const grant: VideoGrant = {
    roomJoin: true,
    room: roomId,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
  };

  at.addGrant(grant);

  return at.toJwt();
}

// ─── Public join token (API-spec compliant) ──────────────────
// Used by /api/livekit/token POST endpoint.
// Accepts roomName, participantIdentity, participantName.

export interface JoinTokenOptions {
  roomName: string;
  participantIdentity: string;
  participantName?: string;
}

export async function generateJoinToken({
  roomName,
  participantIdentity,
  participantName,
}: JoinTokenOptions): Promise<string> {
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;

  if (!apiKey || !apiSecret) {
    throw new Error('LIVEKIT_API_KEY or LIVEKIT_API_SECRET is not configured');
  }

  const at = new AccessToken(apiKey, apiSecret, {
    identity: participantIdentity,
    name: participantName,
    ttl: TOKEN_TTL_SECONDS,
  });

  const grant: VideoGrant = {
    roomJoin: true,
    room: roomName,
    canPublish: true,       // publish audio
    canSubscribe: true,     // subscribe to audio
    canPublishData: true,   // data channel for WAV transfer
  };

  at.addGrant(grant);

  return at.toJwt();
}

// ─── Utilities ───────────────────────────────────────────────

/**
 * Generate a common 5-digit pair ID for a recording session.
 */
export function generatePairId(): string {
  return String(Math.floor(10000 + Math.random() * 90000));
}

/**
 * Build a LiveKit room name from host user ID and pair ID.
 */
export function buildRoomName(hostUserId: string, pairId: string): string {
  return `btd_${hostUserId}_${pairId}`;
}

/**
 * Generate a cryptographically random 8-character invite token.
 */
export function generateInviteToken(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let token = '';
  const array = new Uint8Array(8);
  crypto.getRandomValues(array);
  for (const byte of array) {
    token += chars[byte % chars.length];
  }
  return token;
}

/**
 * Return the LiveKit server URL from environment variables.
 * Used server-side only; never expose API_SECRET alongside this.
 */
export function getLiveKitUrl(): string {
  const url = process.env.LIVEKIT_URL;
  if (!url) throw new Error('LIVEKIT_URL is not configured');
  return url;
}

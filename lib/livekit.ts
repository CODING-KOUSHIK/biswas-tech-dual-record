// lib/livekit.ts — Server-only LiveKit token generation
import 'server-only';
import { AccessToken, VideoGrant } from 'livekit-server-sdk';

export function getLiveKitUrl(): string {
  const url = process.env.LIVEKIT_URL;
  if (!url) throw new Error('LIVEKIT_URL env var is not set');
  return url;
}

export async function generateToken(opts: {
  roomId: string;
  identity: string;
  name: string;
  metadata?: string;
}): Promise<string> {
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  if (!apiKey || !apiSecret) throw new Error('LIVEKIT_API_KEY or LIVEKIT_API_SECRET not set');

  const at = new AccessToken(apiKey, apiSecret, {
    identity: opts.identity,
    name: opts.name,
    ttl: 14400, // 4 hours
    metadata: opts.metadata,
  });

  const grant: VideoGrant = {
    roomJoin: true,
    room: opts.roomId,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
  };

  at.addGrant(grant);
  return at.toJwt();
}

// app/api/livekit/token/route.ts — LiveKit token generation
// Open API — no auth required. Credentials stay server-side.
//
// GET  ?roomId=xxx&name=xxx&gender=xxx         — host/guest direct join
// GET  ?roomId=xxx&inviteToken=xxx&name=xxx    — guest via invite link
// POST { roomName, participantIdentity, participantName } — spec-compliant

import { NextRequest, NextResponse } from 'next/server';
import { generateLiveKitToken, generateJoinToken, getLiveKitUrl } from '@/lib/livekit';
import { verifyInviteToken } from '@/lib/invite-token';

// ─── GET ─────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const roomId = searchParams.get('roomId') ?? '';
    const name = (searchParams.get('name') ?? 'user').replace(/[^a-zA-Z0-9_\- ]/g, '').trim().slice(0, 32) || 'user';
    const gender = searchParams.get('gender') ?? 'MALE';
    const inviteToken = searchParams.get('inviteToken') ?? '';

    if (!roomId) {
      return NextResponse.json({ success: false, error: 'roomId is required' }, { status: 400 });
    }

    const livekitUrl = getLiveKitUrl();

    // ── Guest path: verify invite token ──────────────────────────
    if (inviteToken) {
      const invite = await verifyInviteToken(inviteToken);
      if (!invite) {
        return NextResponse.json(
          { success: false, error: 'Invite link expired or invalid. Ask the host for a new link.' },
          { status: 401 }
        );
      }
      if (invite.roomId !== roomId) {
        return NextResponse.json(
          { success: false, error: 'Room ID does not match invite token.' },
          { status: 403 }
        );
      }
    }

    // ── Generate token ────────────────────────────────────────────
    const identity = `${name.replace(/\s+/g, '_')}_${Date.now().toString(36)}`;
    const token = await generateLiveKitToken({
      identity,
      roomId,
      role: inviteToken ? 'guest' : 'host',
      metadata: JSON.stringify({ name, gender, role: inviteToken ? 'guest' : 'host' }),
    });

    return NextResponse.json({ success: true, data: { token, url: livekitUrl } });
  } catch (error) {
    console.error('[GET /api/livekit/token]', error);
    const msg = error instanceof Error ? error.message : 'Token generation failed';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

// ─── POST ────────────────────────────────────────────────────────────────────
// Spec-compliant: { roomName, participantIdentity, participantName }

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
    }

    const roomName = String(body.roomName ?? '').trim();
    const participantIdentity = String(body.participantIdentity ?? '').trim();
    const participantName = String(body.participantName ?? '').trim();

    if (!roomName || !participantIdentity) {
      return NextResponse.json(
        { success: false, error: 'roomName and participantIdentity are required' },
        { status: 400 }
      );
    }

    const token = await generateJoinToken({ roomName, participantIdentity, participantName: participantName || undefined });
    const url = getLiveKitUrl();
    return NextResponse.json({ success: true, data: { token, url } });
  } catch (error) {
    console.error('[POST /api/livekit/token]', error);
    const msg = error instanceof Error ? error.message : 'Token generation failed';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

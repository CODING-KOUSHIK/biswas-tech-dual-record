// app/api/livekit/token/route.ts — LiveKit JWT token generation
//
// POST — Spec-compliant: { roomName, participantIdentity, participantName? }
// GET  — Internal: session auth OR self-contained invite token (guest)

import { NextRequest, NextResponse } from 'next/server';
import { generateLiveKitToken, generateJoinToken, getLiveKitUrl } from '@/lib/livekit';
import { getSession, getSessionOrBypass } from '@/lib/session';
import { verifyInviteToken } from '@/lib/invite-token';
import { sanitizeString, isValidDeviceId } from '@/lib/validation';

// ─── POST /api/livekit/token ─────────────────────────────────
// Spec-compliant endpoint: accepts roomName, participantIdentity, participantName.

export async function POST(request: NextRequest) {
  try {
    // Use bypass session if auth is disabled
    const session = await getSessionOrBypass();

    const body = await request.json().catch(() => null);
    if (!body) {
      return NextResponse.json(
        { success: false, error: 'Invalid JSON body' },
        { status: 400 }
      );
    }

    const roomName = sanitizeString(body.roomName ?? '', 80);
    const participantIdentity = sanitizeString(body.participantIdentity ?? '', 80);
    const participantName = sanitizeString(body.participantName ?? '', 80);

    if (!roomName) {
      return NextResponse.json(
        { success: false, error: 'roomName is required' },
        { status: 400 }
      );
    }
    if (!participantIdentity) {
      return NextResponse.json(
        { success: false, error: 'participantIdentity is required' },
        { status: 400 }
      );
    }

    void session;

    const token = await generateJoinToken({
      roomName,
      participantIdentity,
      participantName: participantName || undefined,
    });

    const url = getLiveKitUrl();
    return NextResponse.json({ success: true, data: { token, url } });
  } catch (error) {
    console.error('[POST /api/livekit/token] error:', error);
    const message = error instanceof Error ? error.message : 'Token generation failed';
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}

// ─── GET /api/livekit/token ──────────────────────────────────
// Internal endpoint: session auth OR self-contained invite token (guest)

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const roomId = sanitizeString(searchParams.get('roomId') ?? '');
    const inviteToken = searchParams.get('inviteToken') ?? '';
    const deviceId = sanitizeString(searchParams.get('deviceId') ?? '').toUpperCase();

    if (!roomId) {
      return NextResponse.json(
        { success: false, error: 'roomId is required' },
        { status: 400 }
      );
    }

    const livekitUrl = getLiveKitUrl();

    // ── Authenticated user path ───────────────────────────────
    const session = await getSession();
    if (session) {
      const token = await generateLiveKitToken({
        identity: `${session.userId}_${session.deviceId}`,
        roomId,
        role: session.role,
        metadata: JSON.stringify({
          userId: session.userId,
          role: session.role,
          gender: session.gender,
          language: session.language,
          deviceId: session.deviceId,
        }),
      });
      return NextResponse.json({ success: true, data: { token, url: livekitUrl } });
    }

    // ── Guest path via self-contained invite token ────────────
    if (!inviteToken) {
      return NextResponse.json(
        { success: false, error: 'Authentication required — provide an invite token' },
        { status: 401 }
      );
    }

    // Validate device ID
    if (deviceId && !isValidDeviceId(deviceId)) {
      return NextResponse.json(
        { success: false, error: 'Invalid device ID format' },
        { status: 400 }
      );
    }

    // Verify self-contained invite token (no Redis needed)
    const invite = await verifyInviteToken(inviteToken);
    if (!invite) {
      return NextResponse.json(
        { success: false, error: 'Invite link expired or invalid. Ask the host for a new link.' },
        { status: 401 }
      );
    }

    // Verify room matches what's in the token
    if (invite.roomId !== roomId) {
      return NextResponse.json(
        { success: false, error: 'Room ID does not match invite' },
        { status: 403 }
      );
    }

    const guestDeviceId = deviceId || 'GUEST';
    const token = await generateLiveKitToken({
      identity: `guest_${guestDeviceId}`,
      roomId,
      role: 'guest',
      metadata: JSON.stringify({
        role: 'guest',
        gender: invite.partnerGender,
        language: 'EN',
        deviceId: guestDeviceId,
        inviteToken,
      }),
    });

    return NextResponse.json({ success: true, data: { token, url: livekitUrl } });
  } catch (error) {
    console.error('[GET /api/livekit/token] error:', error);
    const message = error instanceof Error ? error.message : 'Token generation failed';
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}

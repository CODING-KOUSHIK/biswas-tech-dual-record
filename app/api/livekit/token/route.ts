// app/api/livekit/token/route.ts — LiveKit JWT token generation
//
// TWO endpoints:
//   GET  — Internal app use (session-authenticated or invite-token guest)
//   POST — Public spec-compliant endpoint:
//          Body: { roomName, participantIdentity, participantName? }
//          Response: { token, url }

import { NextRequest, NextResponse } from 'next/server';
import { generateLiveKitToken, generateJoinToken, getLiveKitUrl } from '@/lib/livekit';
import { getSession, getSessionOrBypass } from '@/lib/session';
import { getInvite, updateInvite } from '@/lib/redis';
import {
  sanitizeString,
  isValidInviteToken,
  isValidDeviceId,
} from '@/lib/validation';

// ─── POST /api/livekit/token ─────────────────────────────────
// Spec-compliant endpoint: accepts roomName, participantIdentity, participantName.
// Requires authenticated session (host or registered user).
// Returns token + LiveKit URL so the client never needs the API secret.

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

    const token = await generateJoinToken({
      roomName,
      participantIdentity,
      participantName: participantName || undefined,
    });

    const url = getLiveKitUrl();

    return NextResponse.json({
      success: true,
      data: { token, url },
    });
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
// Internal app endpoint: session auth OR invite-token guest.
// Query params: roomId, inviteToken (guest only), deviceId (guest only)

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const roomId = sanitizeString(searchParams.get('roomId') ?? '');
    const inviteToken = sanitizeString(searchParams.get('inviteToken') ?? '');
    const deviceId = sanitizeString(searchParams.get('deviceId') ?? '').toUpperCase();

    if (!roomId) {
      return NextResponse.json(
        { success: false, error: 'roomId is required' },
        { status: 400 }
      );
    }

    const session = await getSession();
    const livekitUrl = getLiveKitUrl();

    // ── Authenticated user path ──────────────────────────────
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

    // ── Guest path (invite token) ────────────────────────────
    if (!inviteToken || !isValidInviteToken(inviteToken)) {
      return NextResponse.json(
        { success: false, error: 'Authentication required — provide a valid invite token' },
        { status: 401 }
      );
    }
    if (!isValidDeviceId(deviceId)) {
      return NextResponse.json(
        { success: false, error: 'Valid deviceId (4 uppercase alphanumeric) is required' },
        { status: 400 }
      );
    }

    const invite = await getInvite(inviteToken);
    if (!invite) {
      return NextResponse.json(
        { success: false, error: 'Invite not found or expired' },
        { status: 404 }
      );
    }

    // Enforce device binding
    if (invite.deviceId && invite.deviceId !== deviceId) {
      return NextResponse.json(
        { success: false, error: 'This invite link is bound to a different device' },
        { status: 403 }
      );
    }

    // Verify room matches invite
    if (invite.roomId !== roomId) {
      return NextResponse.json(
        { success: false, error: 'Room ID does not match invite' },
        { status: 403 }
      );
    }

    // Bind device on first use
    if (!invite.deviceId) {
      await updateInvite(inviteToken, { deviceId, status: 'used' });
    }

    const token = await generateLiveKitToken({
      identity: `guest_${deviceId}`,
      roomId,
      role: 'guest',
      metadata: JSON.stringify({
        role: 'guest',
        gender: invite.partnerGender,
        language: 'EN',
        deviceId,
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

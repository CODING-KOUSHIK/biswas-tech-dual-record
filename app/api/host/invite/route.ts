// app/api/host/invite/route.ts — Generate invite URLs (host only)

import { NextRequest, NextResponse } from 'next/server';
import { getSessionOrBypass } from '@/lib/session';
import { createInvite } from '@/lib/redis';
import { generateInviteToken, generatePairId } from '@/lib/livekit';
import { sanitizeString, isValidGender } from '@/lib/validation';
import type { InviteRecord, Gender } from '@/types';

// POST /api/host/invite
export async function POST(request: NextRequest) {
  try {
    const session = await getSessionOrBypass();

    if (session.role !== 'host') {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const partnerGender = sanitizeString(body.partnerGender ?? '').toUpperCase();

    if (!isValidGender(partnerGender)) {
      return NextResponse.json(
        { success: false, error: 'Partner gender must be MALE or FEMALE' },
        { status: 400 }
      );
    }

    const token = generateInviteToken();
    const pairId = generatePairId();
    const roomId = `btd_${session.userId}_${pairId}`;

    const invite: InviteRecord = {
      token,
      partnerGender: partnerGender as Gender,
      status: 'pending',
      deviceId: null,
      createdAt: new Date().toISOString(),
      roomId,
    };

    await createInvite(invite);

    // Build the invite URL from the request host (works on any domain/Vercel preview)
    const host = request.headers.get('host') ?? 'localhost:3000';
    const protocol = host.includes('localhost') ? 'http' : 'https';
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? `${protocol}://${host}`;
    const inviteUrl = `${baseUrl}/invite/${token}`;

    return NextResponse.json(
      { success: true, data: { inviteUrl, token, pairId, roomId } },
      { status: 201 }
    );
  } catch (error) {
    console.error('Create invite error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

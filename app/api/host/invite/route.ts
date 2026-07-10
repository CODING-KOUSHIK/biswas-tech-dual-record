// app/api/host/invite/route.ts — Host-only: generate invite URLs

import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { createInvite, checkRateLimit } from '@/lib/redis';
import { generateInviteToken, generatePairId } from '@/lib/livekit';
import { sanitizeString, isValidGender, getClientIp } from '@/lib/validation';
import type { InviteRecord, Gender } from '@/types';

// POST /api/host/invite
export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session || session.role !== 'host') {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    // Rate limit: 10 invites per minute
    const ip = getClientIp(request);
    const allowed = await checkRateLimit(`invite:${ip}`, 10, 60);
    if (!allowed) {
      return NextResponse.json({ success: false, error: 'Too many requests' }, { status: 429 });
    }

    const body = await request.json();
    const partnerGender = sanitizeString(body.partnerGender).toUpperCase();

    if (!isValidGender(partnerGender)) {
      return NextResponse.json({ success: false, error: 'Partner gender must be MALE or FEMALE' }, { status: 400 });
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

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? `https://${request.headers.get('host')}`;
    const inviteUrl = `${baseUrl}/invite/${token}`;

    return NextResponse.json({ success: true, data: { inviteUrl, token, pairId, roomId } }, { status: 201 });
  } catch (error) {
    console.error('Create invite error:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

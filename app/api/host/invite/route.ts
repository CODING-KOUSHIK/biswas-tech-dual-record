// app/api/host/invite/route.ts — Generate self-contained invite URLs (no Redis needed)

import { NextRequest, NextResponse } from 'next/server';
import { getSessionOrBypass } from '@/lib/session';
import { createInviteToken } from '@/lib/invite-token';
import { generatePairId } from '@/lib/livekit';
import { sanitizeString, isValidGender } from '@/lib/validation';
import type { Gender } from '@/types';

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

    const pairId = generatePairId();
    const roomId = `btd_${session.userId}_${pairId}`;

    // Self-contained token — no Redis needed
    const token = await createInviteToken({
      roomId,
      partnerGender: partnerGender as Gender,
      hostId: session.userId,
    });

    // Build invite URL from request host (works on localhost + Vercel)
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
      { success: false, error: 'Failed to generate invite link. Check server logs.' },
      { status: 500 }
    );
  }
}

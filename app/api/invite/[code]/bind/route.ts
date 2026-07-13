// app/api/invite/[code]/bind/route.ts — Bind partner device to invite

import { NextRequest, NextResponse } from 'next/server';
import { bindPartner } from '@/lib/redis';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    const { code } = await params;
    const { partnerDeviceId } = await request.json();

    if (!partnerDeviceId) {
      return NextResponse.json({ success: false, error: 'partnerDeviceId is required' }, { status: 400 });
    }

    const invite = await bindPartner(code, partnerDeviceId);
    if (!invite) {
      return NextResponse.json(
        { success: false, error: 'This invite link is already used by another device.' },
        { status: 403 }
      );
    }

    return NextResponse.json({
      success: true,
      invite: {
        code: invite.code,
        pairId: invite.pairId,
        roomId: invite.roomId,
        hostName: invite.hostName,
        hostLanguage: invite.hostLanguage,
        partnerGender: invite.partnerGender,
      },
    });
  } catch (err) {
    console.error('[invite/[code]/bind]', err);
    return NextResponse.json({ success: false, error: 'Server error' }, { status: 500 });
  }
}

// app/api/invite/[code]/route.ts — Get invite info (public, no device binding)

import { NextRequest, NextResponse } from 'next/server';
import { getInvite } from '@/lib/redis';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    const { code } = await params;
    const invite = await getInvite(code);

    if (!invite) {
      return NextResponse.json({ success: false, error: 'Invite not found or expired' }, { status: 404 });
    }

    // Return only what the client needs — no sensitive fields
    return NextResponse.json({
      success: true,
      invite: {
        code: invite.code,
        pairId: invite.pairId,
        roomId: invite.roomId,
        hostName: invite.hostName,
        hostLanguage: invite.hostLanguage,
        hostGender: invite.hostGender,
        partnerGender: invite.partnerGender,
        boundPartnerDeviceId: invite.boundPartnerDeviceId,
      },
    });
  } catch (err) {
    console.error('[invite/[code] GET]', err);
    return NextResponse.json({ success: false, error: 'Server error' }, { status: 500 });
  }
}

// app/api/invite/create/route.ts — Create new invite and store in Redis

import { NextRequest, NextResponse } from 'next/server';
import { createInvite, InviteRecord } from '@/lib/redis';

function randomCode(len: number, chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789') {
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => chars[b % chars.length]).join('');
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { hostDeviceId, hostName, hostLanguage, hostGender, partnerGender } = body;

    if (!hostDeviceId || !hostName || !hostLanguage || !hostGender || !partnerGender) {
      return NextResponse.json({ success: false, error: 'Missing required fields' }, { status: 400 });
    }

    const code = randomCode(8);
    const pairId = randomCode(5, '0123456789');
    const roomId = `btd_${pairId}`;

    const invite: InviteRecord = {
      code,
      pairId,
      roomId,
      hostDeviceId,
      hostName,
      hostLanguage,
      hostGender,
      partnerGender,
      boundPartnerDeviceId: null,
      createdAt: Date.now(),
    };

    await createInvite(invite);

    const origin = request.headers.get('origin') ?? `https://${request.headers.get('host')}`;
    const inviteUrl = `${origin}/invite/${code}`;

    return NextResponse.json({ success: true, code, pairId, roomId, inviteUrl });
  } catch (err) {
    console.error('[invite/create]', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Failed to create invite' },
      { status: 500 }
    );
  }
}

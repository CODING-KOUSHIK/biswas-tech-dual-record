// app/api/host/room/route.ts — Host creates a new recording room

import { NextRequest, NextResponse } from 'next/server';
import { getSessionOrBypass } from '@/lib/session';
import { generatePairId } from '@/lib/livekit';

export async function POST(request: NextRequest) {
  try {
    void request;
    const session = await getSessionOrBypass();

    if (session.role !== 'host') {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const pairId = generatePairId();
    const roomId = `btd_${session.userId}_${pairId}`;

    return NextResponse.json({ success: true, data: { roomId, pairId } });
  } catch (error) {
    console.error('Create room error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// app/api/host/room/route.ts — Host starts a new recording session (creates room)

import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { generatePairId } from '@/lib/livekit';

export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session || session.role !== 'host') {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    void request; // no body needed

    const pairId = generatePairId();
    const roomId = `btd_${session.userId}_${pairId}`;

    return NextResponse.json({ success: true, data: { roomId, pairId } });
  } catch (error) {
    console.error('Create room error:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

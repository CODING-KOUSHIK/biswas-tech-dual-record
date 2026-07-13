// app/api/livekit/token/route.ts — Generate LiveKit access token
// Open endpoint — identity comes from query params (no server-side session)

import { NextRequest, NextResponse } from 'next/server';
import { generateToken, getLiveKitUrl } from '@/lib/livekit';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const roomId = searchParams.get('roomId') ?? '';
    const identity = searchParams.get('identity') ?? '';
    const name = searchParams.get('name') ?? 'User';
    const metadata = searchParams.get('metadata') ?? '';

    if (!roomId || !identity) {
      return NextResponse.json({ success: false, error: 'roomId and identity are required' }, { status: 400 });
    }

    const token = await generateToken({ roomId, identity, name, metadata });
    const url = getLiveKitUrl();

    return NextResponse.json({ success: true, token, url });
  } catch (err) {
    console.error('[livekit/token]', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Token generation failed' },
      { status: 500 }
    );
  }
}

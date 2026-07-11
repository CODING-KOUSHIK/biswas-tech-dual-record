// app/api/auth/autologin/route.ts — Temporary auto-login bypass
// TODO: Remove this before adding real authentication.

import { NextResponse } from 'next/server';
import { createSession } from '@/lib/session';

export async function GET() {
  try {
    await createSession({
      userId: 'host',
      role: 'host',
      gender: 'MALE',
      language: 'EN',
      deviceId: 'AUTO',
    });
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ success: false, error: 'Auto-login failed' }, { status: 500 });
  }
}

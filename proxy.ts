// proxy.ts — Auth BYPASSED (temporary)
// TODO: Re-enable authentication before production use.

import { NextRequest, NextResponse } from 'next/server';

// All routes are publicly accessible — no session required.
export async function proxy(_request: NextRequest) {
  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|worklets/).*)',
  ],
};

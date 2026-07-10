// proxy.ts — Route protection using JWT session cookies
// Next.js 16: this file replaces middleware.ts. Export must be named "proxy".

import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';

const SESSION_COOKIE = 'btd_session';

// Routes accessible without authentication
const PUBLIC_ROUTES = [
  '/login',
  '/invite',
  '/api/auth/login',
];

function getKey(): Uint8Array {
  const secret = process.env.SESSION_SECRET ?? '';
  return new TextEncoder().encode(secret);
}

async function verifySession(token: string) {
  try {
    const { payload } = await jwtVerify(token, getKey(), {
      algorithms: ['HS256'],
    });
    return payload;
  } catch {
    return null;
  }
}

// ─── Must be named "proxy" in Next.js 16 ─────────────────────

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow public paths (no auth required)
  if (PUBLIC_ROUTES.some((route) => pathname.startsWith(route))) {
    return NextResponse.next();
  }

  // /api/livekit/token GET allows guests via invite token — handled in the route
  if (pathname === '/api/livekit/token') {
    return NextResponse.next();
  }

  const sessionToken = request.cookies.get(SESSION_COOKIE)?.value;

  if (!sessionToken) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }
    return NextResponse.redirect(new URL('/login', request.url));
  }

  const payload = await verifySession(sessionToken);

  if (!payload) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json(
        { success: false, error: 'Session expired' },
        { status: 401 }
      );
    }
    const response = NextResponse.redirect(new URL('/login', request.url));
    response.cookies.delete(SESSION_COOKIE);
    return response;
  }

  // Host-only routes
  if (
    pathname.startsWith('/dashboard') ||
    pathname.startsWith('/api/host/')
  ) {
    if (payload.role !== 'host') {
      if (pathname.startsWith('/api/')) {
        return NextResponse.json(
          { success: false, error: 'Forbidden' },
          { status: 403 }
        );
      }
      return NextResponse.redirect(new URL('/login', request.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Run on all routes except static assets and Next.js internals
    '/((?!_next/static|_next/image|favicon.ico|worklets/).*)',
  ],
};

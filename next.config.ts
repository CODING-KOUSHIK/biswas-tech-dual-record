import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,

  // ── Security & AudioWorklet headers ───────────────────────────
  // NOTE: COEP is intentionally REMOVED — it blocks LiveKit's WebSocket
  // connection on Chrome/Android. SharedArrayBuffer is not used by this app.
  // COOP same-origin is kept for basic cross-origin isolation.
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin-allow-popups' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ];
  },
};

export default nextConfig;

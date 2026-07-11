'use client';

// app/login/page.tsx — BYPASSED: auto-logs in and redirects to dashboard
// TODO: Restore real login form when auth is re-enabled.

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const router = useRouter();

  useEffect(() => {
    fetch('/api/auth/autologin')
      .then(() => router.replace('/dashboard'))
      .catch(() => router.replace('/dashboard'));
  }, [router]);

  return (
    <div className="min-h-screen bg-[#0A0F1E] flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-white mb-2">Biswas Tech</h1>
        <p className="text-gray-400 text-sm">Loading…</p>
      </div>
    </div>
  );
}

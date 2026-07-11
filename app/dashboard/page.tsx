import type { Metadata } from 'next';
import { getSession } from '@/lib/session';
import { DashboardClient, DashboardClientContent } from './DashboardClient';

export const metadata: Metadata = {
  title: 'Dashboard — Biswas Tech',
};

// Fallback session used when auth is bypassed
const BYPASS_SESSION = {
  userId: 'host',
  role: 'host' as const,
  gender: 'MALE' as const,
  language: 'EN',
  deviceId: 'AUTO',
};

export default async function DashboardPage() {
  // Try to get real session; fall back to bypass session if none
  const session = (await getSession()) ?? BYPASS_SESSION;

  return (
    <div className="min-h-screen bg-[#0A0F1E]">
      {/* Header */}
      <header className="border-b border-white/10 px-4 py-4">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-white">Biswas Tech</h1>
            <p className="text-xs text-gray-500">
              Host: {session.userId} · Device: {session.deviceId}
            </p>
          </div>
          <DashboardClient />
        </div>
      </header>

      {/* Main */}
      <main className="max-w-2xl mx-auto p-4">
        <DashboardClientContent />
      </main>
    </div>
  );
}

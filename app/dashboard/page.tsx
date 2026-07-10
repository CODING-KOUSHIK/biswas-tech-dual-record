import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { DashboardClient, DashboardClientContent } from './DashboardClient';

export const metadata: Metadata = {
  title: 'Dashboard — Biswas Tech',
};

export default async function DashboardPage() {
  const session = await getSession();

  if (!session || session.role !== 'host') {
    redirect('/login');
  }

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

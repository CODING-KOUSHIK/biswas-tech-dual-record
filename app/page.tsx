'use client';
// app/page.tsx — Entry: check profile → /setup or /home

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { loadProfile } from '@/lib/profile';

export default function RootPage() {
  const router = useRouter();

  useEffect(() => {
    const profile = loadProfile();
    router.replace(profile ? '/home' : '/setup');
  }, [router]);

  return (
    <div className="min-h-screen bg-white flex items-center justify-center">
      <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

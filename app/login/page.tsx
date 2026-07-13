'use client';

// app/login/page.tsx — Redirect to / (setup) or /home
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const router = useRouter();
  useEffect(() => {
    const name = localStorage.getItem('btd_name');
    const gender = localStorage.getItem('btd_gender');
    if (name && gender) {
      router.replace('/home');
    } else {
      router.replace('/');
    }
  }, [router]);

  return (
    <div className="min-h-screen bg-[#0A0F1E] flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

'use client';

// app/page.tsx — Landing / Setup page
// First visit: ask name + gender → save to localStorage → go to /home
// Return visits: redirect to /home immediately

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

type Gender = 'MALE' | 'FEMALE';

export default function LandingPage() {
  const router = useRouter();
  const [checked, setChecked] = useState(false);
  const [name, setName] = useState('');
  const [gender, setGender] = useState<Gender | ''>('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const savedName = localStorage.getItem('btd_name');
    const savedGender = localStorage.getItem('btd_gender');
    if (savedName && savedGender) {
      router.replace('/home');
    } else {
      setChecked(true);
    }
  }, [router]);

  const handleSave = () => {
    if (!name.trim() || !gender) return;
    setSaving(true);
    localStorage.setItem('btd_name', name.trim());
    localStorage.setItem('btd_gender', gender);
    router.replace('/home');
  };

  if (!checked) {
    return (
      <div className="min-h-screen bg-[#0A0F1E] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0A0F1E] flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-white">Biswas Tech</h1>
          <p className="text-gray-500 text-sm mt-1">Dual Recording Studio</p>
        </div>

        {/* Setup card */}
        <div className="bg-white/5 border border-white/10 rounded-2xl p-6 space-y-5">
          <div>
            <h2 className="text-white font-semibold mb-1">Setup your profile</h2>
            <p className="text-gray-500 text-xs">This is used in your recording file names.</p>
          </div>

          {/* Name */}
          <div>
            <label className="block text-sm text-gray-400 mb-1">Your Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSave()}
              placeholder="Enter your name"
              maxLength={32}
              className="w-full bg-white/8 border border-white/15 rounded-lg px-4 py-3 text-white placeholder-gray-600 text-sm outline-none focus:border-blue-500 transition-colors"
            />
          </div>

          {/* Gender */}
          <div>
            <label className="block text-sm text-gray-400 mb-2">Your Gender</label>
            <div className="grid grid-cols-2 gap-3">
              {(['MALE', 'FEMALE'] as Gender[]).map((g) => (
                <button
                  key={g}
                  onClick={() => setGender(g)}
                  className={[
                    'py-3 rounded-lg border-2 font-medium text-sm transition-colors',
                    gender === g
                      ? 'border-blue-500 bg-blue-600/20 text-white'
                      : 'border-white/15 text-gray-400 hover:border-white/30',
                  ].join(' ')}
                >
                  {g === 'MALE' ? '♂ Male' : '♀ Female'}
                </button>
              ))}
            </div>
          </div>

          {/* Continue */}
          <button
            onClick={handleSave}
            disabled={!name.trim() || !gender || saving}
            className="w-full py-3 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold text-sm transition-colors"
          >
            Continue →
          </button>
        </div>
      </div>
    </div>
  );
}

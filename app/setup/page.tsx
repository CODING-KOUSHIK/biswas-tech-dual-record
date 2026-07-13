'use client';
// app/setup/page.tsx — First-visit setup: Name + Gender + Language

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { saveProfile } from '@/lib/profile';
import { getDeviceId } from '@/lib/device';
import { LANGUAGES } from '@/lib/languages';

type Gender = 'MALE' | 'FEMALE';

export default function SetupPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [gender, setGender] = useState<Gender | ''>('');
  const [language, setLanguage] = useState('');
  const [saving, setSaving] = useState(false);

  const canContinue = name.trim().length > 0 && gender !== '' && language !== '';

  const handleContinue = () => {
    if (!canContinue || saving) return;
    setSaving(true);
    getDeviceId(); // initialize device ID
    saveProfile({ name: name.trim(), gender: gender as Gender, language });
    router.replace('/home');
  };

  return (
    <div className="min-h-screen bg-white flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-slate-900">Biswas Tech</h1>
          <p className="text-slate-500 text-sm mt-1">Dual Recording Studio</p>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-5">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Welcome! Set up your profile</h2>
            <p className="text-slate-500 text-sm mt-1">This is saved on your device and used in recording file names.</p>
          </div>

          {/* Name */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Your Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && canContinue && handleContinue()}
              placeholder="Enter your full name"
              maxLength={40}
              autoFocus
              className="w-full border border-slate-300 rounded-lg px-4 py-3 text-slate-900 placeholder-slate-400 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
          </div>

          {/* Gender */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">Gender</label>
            <div className="grid grid-cols-2 gap-3">
              {(['MALE', 'FEMALE'] as Gender[]).map((g) => (
                <button
                  key={g}
                  onClick={() => setGender(g)}
                  className={[
                    'py-3 rounded-xl border-2 font-medium text-sm transition-all',
                    gender === g
                      ? 'border-blue-500 bg-blue-50 text-blue-700'
                      : 'border-slate-200 text-slate-600 hover:border-slate-300',
                  ].join(' ')}
                >
                  {g === 'MALE' ? '♂ Male' : '♀ Female'}
                </button>
              ))}
            </div>
          </div>

          {/* Language */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Language</label>
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-4 py-3 text-slate-900 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 bg-white"
            >
              <option value="">Select your language</option>
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>{l.label}</option>
              ))}
            </select>
          </div>

          {/* Continue */}
          <button
            onClick={handleContinue}
            disabled={!canContinue || saving}
            className="w-full py-3.5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold text-sm transition-colors"
          >
            {saving ? 'Saving…' : 'Continue →'}
          </button>
        </div>
      </div>
    </div>
  );
}

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

  const handleContinue = async () => {
    if (!canContinue || saving) return;
    setSaving(true);

    try {
      // Prompt for microphone permission immediately
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop()); // close the temporary stream
    } catch (err) {
      alert("Microphone permission is required to use this application. Please allow microphone access in your browser settings to continue.");
      setSaving(false);
      return;
    }

    getDeviceId(); // initialize device ID
    saveProfile({ name: name.trim(), gender: gender as Gender, language });
    router.replace('/home');
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-5" style={{ background: 'var(--bg-primary)' }}>
      <div className="w-full max-w-md fade-in">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl mx-auto mb-4 flex items-center justify-center text-2xl font-extrabold text-white" style={{ background: 'var(--accent-gradient)' }}>
            BT
          </div>
          <h1 className="text-2xl font-bold text-white">Biswas Tech</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>Dual Recording Studio</p>
        </div>

        <div className="glass-card p-6 space-y-6">
          <div>
            <h2 className="text-lg font-semibold text-white">Set up your profile</h2>
            <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>Saved locally on your device for recording file names.</p>
          </div>

          {/* Name */}
          <div>
            <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>Your Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && canContinue && handleContinue()}
              placeholder="Enter your full name"
              maxLength={40}
              autoFocus
              className="input-dark"
            />
          </div>

          {/* Gender */}
          <div>
            <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>Gender</label>
            <div className="grid grid-cols-2 gap-3">
              {(['MALE', 'FEMALE'] as Gender[]).map((g) => (
                <button
                  key={g}
                  onClick={() => setGender(g)}
                  className={`gender-toggle ${gender === g ? 'active' : ''}`}
                >
                  {g === 'MALE' ? '♂ Male' : '♀ Female'}
                </button>
              ))}
            </div>
          </div>

          {/* Language */}
          <div>
            <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>Language</label>
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              className="select-dark"
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
            className="btn btn-primary w-full text-base disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {saving ? (
              <>
                <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                Setting up…
              </>
            ) : 'Continue →'}
          </button>
        </div>

        <p className="text-center text-xs mt-6" style={{ color: 'var(--text-muted)' }}>
          Microphone access is required to continue
        </p>
      </div>
    </div>
  );
}

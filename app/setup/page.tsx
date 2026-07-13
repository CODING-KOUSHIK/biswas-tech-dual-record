'use client';
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

  const ok = name.trim().length > 0 && gender !== '' && language !== '';

  const handleContinue = async () => {
    if (!ok || saving) return;
    setSaving(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(t => t.stop());
    } catch {
      alert("Microphone permission is required.");
      setSaving(false);
      return;
    }
    getDeviceId();
    saveProfile({ name: name.trim(), gender: gender as Gender, language });
    router.replace('/home');
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-5 py-8 bg-[#0f172a]">
      <div className="w-full max-w-md fade-in">
        {/* Logo */}
        <div className="text-center mb-10">
          <div className="w-16 h-16 rounded-2xl mx-auto mb-4 flex items-center justify-center text-xl font-extrabold text-white shadow-lg shadow-indigo-500/25"
            style={{ background: 'linear-gradient(135deg, #4f46e5, #7c3aed)' }}>
            BT
          </div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Biswas Tech</h1>
          <p className="text-[13px] text-slate-500 mt-1">Dual Recording Studio</p>
        </div>

        <div className="bg-[#1e293b] border border-white/[0.06] rounded-2xl p-6 space-y-6">
          <div>
            <h2 className="text-base font-semibold text-white">Set up your profile</h2>
            <p className="text-[13px] text-slate-500 mt-1">Saved locally on your device.</p>
          </div>

          {/* Name */}
          <div>
            <label className="block text-[13px] font-medium text-slate-400 mb-2">Your Name</label>
            <input type="text" value={name} onChange={e => setName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && ok && handleContinue()}
              placeholder="Enter your full name" maxLength={40} autoFocus
              className="w-full bg-[#0f172a]/60 border border-slate-700 rounded-xl px-4 py-3.5 text-white text-[15px] placeholder-slate-600 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-all" />
          </div>

          {/* Gender */}
          <div>
            <label className="block text-[13px] font-medium text-slate-400 mb-2">Gender</label>
            <div className="grid grid-cols-2 gap-3">
              {(['MALE', 'FEMALE'] as Gender[]).map(g => (
                <button key={g} onClick={() => setGender(g)}
                  className={`py-3.5 rounded-xl text-[14px] font-semibold transition-all active:scale-95 ${
                    gender === g
                      ? 'bg-gradient-to-r from-indigo-600 to-purple-600 text-white shadow-lg shadow-indigo-500/25'
                      : 'border-2 border-slate-700 text-slate-400 hover:border-slate-600'
                  }`}>
                  {g === 'MALE' ? '♂ Male' : '♀ Female'}
                </button>
              ))}
            </div>
          </div>

          {/* Language */}
          <div>
            <label className="block text-[13px] font-medium text-slate-400 mb-2">Language</label>
            <select value={language} onChange={e => setLanguage(e.target.value)}
              className="w-full bg-[#0f172a]/60 border border-slate-700 rounded-xl px-4 py-3.5 text-white text-[15px] outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 appearance-none transition-all"
              style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath d='M6 8L1 3h10z' fill='%2364748b'/%3E%3C/svg%3E\")", backgroundRepeat: 'no-repeat', backgroundPosition: 'right 16px center' }}>
              <option value="" className="bg-[#1e293b]">Select your language</option>
              {LANGUAGES.map(l => <option key={l.code} value={l.code} className="bg-[#1e293b]">{l.label}</option>)}
            </select>
          </div>

          {/* Continue */}
          <button onClick={handleContinue} disabled={!ok || saving}
            className="w-full py-3.5 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 text-white font-semibold text-[15px] disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.97] transition-transform shadow-lg shadow-indigo-500/25 flex items-center justify-center gap-2">
            {saving ? (
              <><span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />Setting up…</>
            ) : 'Continue →'}
          </button>
        </div>

        <p className="text-center text-[11px] text-slate-600 mt-6">Microphone access is required to continue</p>
      </div>
    </div>
  );
}

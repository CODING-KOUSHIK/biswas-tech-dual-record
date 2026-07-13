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
    <div className="min-h-screen flex flex-col justify-between px-6 py-10 bg-[#0f172a] text-white">
      <div className="w-full max-w-lg mx-auto flex-1 flex flex-col justify-center gap-8 fade-in">
        {/* Header */}
        <div className="text-center">
          <div className="w-20 h-20 rounded-3xl mx-auto mb-5 flex items-center justify-center text-3xl font-black text-white shadow-xl shadow-indigo-500/20"
            style={{ background: 'linear-gradient(135deg, #4f46e5, #7c3aed)' }}>
            🎙️
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight">Biswas Tech</h1>
          <p className="text-[14px] text-slate-400 mt-2">Professional Dual Recording Platform</p>
        </div>

        {/* Inputs */}
        <div className="space-y-6">
          {/* Name input */}
          <div className="space-y-2">
            <label className="block text-[14px] font-semibold text-slate-300">What is your name?</label>
            <input 
              type="text" 
              value={name} 
              onChange={e => setName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && ok && handleContinue()}
              placeholder="Enter your name" 
              maxLength={40} 
              autoFocus
              className="w-full h-14 bg-[#1e293b]/60 border border-slate-700/80 rounded-2xl px-5 text-white text-[16px] placeholder-slate-500 outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 transition-all font-medium" 
            />
          </div>

          {/* Gender */}
          <div className="space-y-2">
            <label className="block text-[14px] font-semibold text-slate-300">Gender</label>
            <div className="grid grid-cols-2 gap-4">
              {(['MALE', 'FEMALE'] as Gender[]).map(g => (
                <button 
                  key={g} 
                  type="button"
                  onClick={() => setGender(g)}
                  className={`h-14 rounded-2xl text-[15px] font-bold tracking-wide transition-all active:scale-[0.97] ${
                    gender === g
                      ? 'bg-gradient-to-r from-indigo-600 to-purple-600 text-white shadow-lg shadow-indigo-500/20 border-transparent'
                      : 'border-2 border-slate-700 text-slate-400 hover:border-slate-600 bg-[#1e293b]/40'
                  }`}
                >
                  {g === 'MALE' ? '♂ Male' : '♀ Female'}
                </button>
              ))}
            </div>
          </div>

          {/* Language selection */}
          <div className="space-y-2">
            <label className="block text-[14px] font-semibold text-slate-300">Select Language</label>
            <div className="relative">
              <select 
                value={language} 
                onChange={e => setLanguage(e.target.value)}
                className="w-full h-14 bg-[#1e293b]/60 border border-slate-700/80 rounded-2xl px-5 text-white text-[16px] outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 appearance-none transition-all font-medium cursor-pointer"
                style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E\")", backgroundRepeat: 'no-repeat', backgroundPosition: 'right 20px center' }}
              >
                <option value="" className="bg-[#0f172a]">Select native language</option>
                {LANGUAGES.map(l => (
                  <option key={l.code} value={l.code} className="bg-[#0f172a]">{l.label}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Continue button */}
        <div className="pt-4">
          <button 
            type="button"
            onClick={handleContinue} 
            disabled={!ok || saving}
            className="w-full h-15 rounded-2xl bg-gradient-to-r from-indigo-600 to-purple-600 text-white font-extrabold text-[16px] tracking-wide disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.97] transition-all shadow-xl shadow-indigo-600/20 flex items-center justify-center gap-3"
          >
            {saving ? (
              <>
                <span className="w-5 h-5 border-3 border-white/40 border-t-white rounded-full animate-spin" />
                Initializing Studio…
              </>
            ) : (
              'Start Setup'
            )}
          </button>
        </div>
      </div>

      {/* Footer message */}
      <div className="w-full text-center mt-8">
        <p className="text-[12px] text-slate-500 max-w-xs mx-auto leading-relaxed">
          * Note: Microphone permission is required to perform dual high-quality voice recordings.
        </p>
      </div>
    </div>
  );
}

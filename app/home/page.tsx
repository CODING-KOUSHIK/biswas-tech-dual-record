'use client';

// app/home/page.tsx — Main page after setup
// Host: generate invite + immediately enter room when link is copied
// All identity from localStorage (name, gender) — no auth required

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';

type Gender = 'MALE' | 'FEMALE';

export default function HomePage() {
  const router = useRouter();
  const [userName, setUserName] = useState('');
  const [userGender, setUserGender] = useState<Gender>('MALE');

  // Invite flow state
  const [step, setStep] = useState<'idle' | 'select-gender' | 'link-ready'>('idle');
  const [partnerGender, setPartnerGender] = useState<Gender>('MALE');
  const [inviteUrl, setInviteUrl] = useState('');
  const [roomId, setRoomId] = useState('');
  const [generating, setGenerating] = useState(false);
  const [copied, setCopied] = useState(false);
  const linkRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const name = localStorage.getItem('btd_name');
    const gender = localStorage.getItem('btd_gender') as Gender | null;
    if (!name || !gender) {
      router.replace('/');
      return;
    }
    setUserName(name);
    setUserGender(gender);
  }, [router]);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const res = await fetch('/api/host/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ partnerGender }),
      });
      const data = await res.json();
      if (data.success) {
        setInviteUrl(data.data.inviteUrl);
        setRoomId(data.data.roomId);
        setStep('link-ready');
      } else {
        alert('Failed: ' + (data.error ?? 'unknown error'));
      }
    } catch {
      alert('Network error. Try again.');
    } finally {
      setGenerating(false);
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(inviteUrl);
    } catch {
      linkRef.current?.select();
      document.execCommand('copy');
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 3000);
  };

  const handleJoinRoom = () => {
    if (!roomId) return;
    router.push(`/room/${encodeURIComponent(roomId)}`);
  };

  if (!userName) return null; // wait for localStorage

  return (
    <div className="min-h-screen bg-[#0A0F1E] flex flex-col">
      {/* Header */}
      <header className="border-b border-white/10 px-4 py-4">
        <div className="max-w-sm mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-white font-bold">Biswas Tech</h1>
            <p className="text-gray-500 text-xs">{userName} · {userGender}</p>
          </div>
          <button
            onClick={() => { localStorage.clear(); router.replace('/'); }}
            className="text-xs text-gray-600 hover:text-gray-400 transition-colors"
          >
            Reset
          </button>
        </div>
      </header>

      {/* Main */}
      <main className="flex-1 flex flex-col items-center justify-center p-4">
        <div className="w-full max-w-sm space-y-4">

          {step === 'idle' && (
            <button
              onClick={() => setStep('select-gender')}
              className="w-full py-5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold text-base transition-colors flex items-center justify-center gap-2"
            >
              🔗 Invite Partner
            </button>
          )}

          {step === 'select-gender' && (
            <div className="bg-white/5 border border-white/10 rounded-2xl p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-white font-semibold">Partner&apos;s Gender</h2>
                <button onClick={() => setStep('idle')} className="text-gray-500 hover:text-white text-sm">✕</button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {(['MALE', 'FEMALE'] as Gender[]).map((g) => (
                  <button
                    key={g}
                    onClick={() => setPartnerGender(g)}
                    className={[
                      'py-4 rounded-lg border-2 font-medium text-sm transition-colors',
                      partnerGender === g
                        ? 'border-blue-500 bg-blue-600/20 text-white'
                        : 'border-white/15 text-gray-400 hover:border-white/30',
                    ].join(' ')}
                  >
                    {g === 'MALE' ? '♂ Male' : '♀ Female'}
                  </button>
                ))}
              </div>
              <button
                onClick={handleGenerate}
                disabled={generating}
                className="w-full py-3 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-semibold text-sm transition-colors"
              >
                {generating ? 'Generating…' : 'Generate Link'}
              </button>
            </div>
          )}

          {step === 'link-ready' && (
            <div className="bg-white/5 border border-white/10 rounded-2xl p-5 space-y-4">
              <h2 className="text-white font-semibold text-center">Invite Link Ready</h2>

              {/* Compact link display */}
              <div className="bg-black/40 border border-white/10 rounded-lg px-3 py-2 flex items-center gap-2">
                <input
                  ref={linkRef}
                  readOnly
                  value={inviteUrl}
                  className="flex-1 bg-transparent text-blue-400 text-xs font-mono outline-none truncate"
                />
              </div>

              {/* Copy button */}
              <button
                onClick={handleCopy}
                className={[
                  'w-full py-3 rounded-lg font-semibold text-sm transition-colors',
                  copied
                    ? 'bg-green-600 text-white'
                    : 'bg-white/10 hover:bg-white/15 text-white border border-white/15',
                ].join(' ')}
              >
                {copied ? '✓ Copied!' : '📋 Copy Link'}
              </button>

              {/* Join Room button */}
              <button
                onClick={handleJoinRoom}
                className="w-full py-4 rounded-xl bg-green-600 hover:bg-green-500 text-white font-bold text-base transition-colors flex items-center justify-center gap-2"
              >
                🎙️ Enter Recording Room
              </button>

              <p className="text-gray-600 text-xs text-center">
                Send the link to your partner first, then enter the room.
              </p>

              <button
                onClick={() => { setStep('idle'); setInviteUrl(''); setRoomId(''); }}
                className="w-full text-xs text-gray-600 hover:text-gray-400 transition-colors"
              >
                Start over
              </button>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

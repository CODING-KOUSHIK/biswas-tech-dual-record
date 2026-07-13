'use client';

// app/invite/[token]/InviteJoin.tsx
// Guest opens invite link:
// 1. If no name/gender in localStorage → quick setup form
// 2. Get mic permission
// 3. Fetch LiveKit token → enter room immediately

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { RoomClient } from '@/components/room/RoomClient';

type Gender = 'MALE' | 'FEMALE';

interface Props {
  token: string;
  roomId: string;
  partnerGender: Gender;
}

export function InviteJoin({ token, roomId, partnerGender }: Props) {
  const router = useRouter();
  const [phase, setPhase] = useState<'setup' | 'connecting' | 'ready' | 'error'>('setup');
  const [name, setName] = useState('');
  const [gender, setGender] = useState<Gender>(partnerGender); // pre-fill with partner's gender
  const [livekitToken, setLivekitToken] = useState('');
  const [livekitUrl, setLivekitUrl] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  // Check if already set up
  useEffect(() => {
    const savedName = localStorage.getItem('btd_name');
    const savedGender = localStorage.getItem('btd_gender') as Gender | null;
    if (savedName && savedGender) {
      setName(savedName);
      setGender(savedGender);
      setPhase('connecting');
    }
    // else: stay on setup phase
  }, []);

  // When phase = connecting, fetch token and enter room
  useEffect(() => {
    if (phase !== 'connecting' || !name) return;

    const connect = async () => {
      try {
        // Request mic permission first (silent — browser handles the prompt)
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          stream.getTracks().forEach((t) => t.stop());
        } catch {
          setErrorMsg('Microphone access is required. Please allow microphone and refresh.');
          setPhase('error');
          return;
        }

        // Fetch LiveKit token
        const params = new URLSearchParams({ roomId, inviteToken: token, name, gender });
        const res = await fetch(`/api/livekit/token?${params}`);
        const data = await res.json();

        if (data.success) {
          setLivekitToken(data.data.token);
          setLivekitUrl(data.data.url);
          setPhase('ready');
        } else {
          setErrorMsg(data.error ?? 'Failed to join. Ask the host for a new link.');
          setPhase('error');
        }
      } catch {
        setErrorMsg('Network error. Check your connection and refresh.');
        setPhase('error');
      }
    };

    connect();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const handleSetupDone = () => {
    if (!name.trim() || !gender) return;
    localStorage.setItem('btd_name', name.trim());
    localStorage.setItem('btd_gender', gender);
    setPhase('connecting');
  };

  // ── Setup form ───────────────────────────────────────────────
  if (phase === 'setup') {
    return (
      <div className="min-h-screen bg-[#0A0F1E] flex items-center justify-center p-4">
        <div className="w-full max-w-sm">
          <div className="text-center mb-6">
            <div className="text-3xl mb-2">🎙️</div>
            <h1 className="text-white font-bold text-xl">Join Session</h1>
            <p className="text-gray-500 text-sm mt-1">Enter your details to join the recording</p>
          </div>

          <div className="bg-white/5 border border-white/10 rounded-2xl p-5 space-y-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1">Your Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSetupDone()}
                placeholder="Enter your name"
                maxLength={32}
                autoFocus
                className="w-full bg-white/8 border border-white/15 rounded-lg px-4 py-3 text-white placeholder-gray-600 text-sm outline-none focus:border-blue-500 transition-colors"
              />
            </div>

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

            <button
              onClick={handleSetupDone}
              disabled={!name.trim() || !gender}
              className="w-full py-3 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white font-semibold text-sm transition-colors"
            >
              Join Recording →
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Connecting ───────────────────────────────────────────────
  if (phase === 'connecting') {
    return (
      <div className="min-h-screen bg-[#0A0F1E] flex items-center justify-center">
        <div className="text-center">
          <div className="w-10 h-10 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-white font-medium">Joining session…</p>
          <p className="text-gray-500 text-xs mt-1">Allow microphone when prompted</p>
        </div>
      </div>
    );
  }

  // ── Error ────────────────────────────────────────────────────
  if (phase === 'error') {
    return (
      <div className="min-h-screen bg-[#0A0F1E] flex items-center justify-center p-4">
        <div className="text-center max-w-sm">
          <div className="text-4xl mb-3">⚠️</div>
          <h1 className="text-white font-bold mb-2">Cannot Join</h1>
          <p className="text-gray-400 text-sm mb-4">{errorMsg}</p>
          <button
            onClick={() => router.replace('/')}
            className="px-4 py-2 rounded-lg bg-white/10 text-white text-sm hover:bg-white/15"
          >
            Go Home
          </button>
        </div>
      </div>
    );
  }

  // ── Ready: full-screen room ──────────────────────────────────
  return (
    <RoomClient
      roomId={roomId}
      livekitToken={livekitToken}
      livekitUrl={livekitUrl}
      userInfo={{
        userId: name.replace(/\s+/g, '_').toLowerCase(),
        role: 'guest',
        gender,
        language: 'EN',
        deviceId: name.replace(/\s+/g, '_').slice(0, 8).toUpperCase(),
      }}
    />
  );
}

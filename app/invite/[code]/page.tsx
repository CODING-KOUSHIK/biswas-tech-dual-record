'use client';
// app/invite/[code]/page.tsx — Guest invite entry

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { loadGuestProfile, saveGuestProfile } from '@/lib/profile';
import { getDeviceId } from '@/lib/device';

type Phase = 'loading' | 'setup' | 'joining' | 'error';
type Gender = 'MALE' | 'FEMALE';

interface InviteInfo {
  pairId: string;
  roomId: string;
  hostName: string;
  hostLanguage: string;
  hostGender: string;
  partnerGender: string;
}

export default function InvitePage() {
  const { code } = useParams<{ code: string }>();
  const router = useRouter();

  const [phase, setPhase] = useState<Phase>('loading');
  const [invite, setInvite] = useState<InviteInfo | null>(null);
  const [error, setError] = useState('');

  // Guest profile fields
  const [name, setName] = useState('');
  const [gender, setGender] = useState<Gender>('MALE');
  const [hasProfile, setHasProfile] = useState(false);

  useEffect(() => {
    const init = async () => {
      const deviceId = getDeviceId();
      const profile = loadGuestProfile();

      // 1. Fetch invite info
      const res = await fetch(`/api/invite/${code}`).catch(() => null);
      if (!res || !res.ok) {
        const msg = res ? (await res.json()).error : 'Network error';
        setError(msg ?? 'Invite not found or expired');
        setPhase('error');
        return;
      }
      const data = await res.json();
      const inv = data.invite as InviteInfo;
      setInvite(inv);

      // 2. Bind device to invite
      const bindRes = await fetch(`/api/invite/${code}/bind`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ partnerDeviceId: deviceId }),
      });
      const bindData = await bindRes.json();
      if (!bindData.success) {
        setError(bindData.error ?? 'Access denied');
        setPhase('error');
        return;
      }

      // 3. Check if guest profile exists
      if (profile) {
        setName(profile.name);
        setGender(profile.gender);
        setHasProfile(true);
        // Pre-set gender from invite if no profile
      } else {
        // Pre-fill gender from invite expected partner gender
        setGender((inv.partnerGender as Gender) ?? 'MALE');
      }

      setPhase(profile ? 'joining' : 'setup');
    };

    init().catch((err) => {
      setError(String(err));
      setPhase('error');
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  // Auto-join when profile is ready
  useEffect(() => {
    if (phase === 'joining' && invite && name) {
      const deviceId = getDeviceId();
      router.replace(
        `/room/${encodeURIComponent(invite.roomId)}?role=GUEST&pairId=${invite.pairId}&partnerName=${encodeURIComponent(invite.hostName)}&partnerGender=${invite.hostGender ?? 'MALE'}&language=${invite.hostLanguage}&guestName=${encodeURIComponent(name)}&guestGender=${gender}&deviceId=${deviceId}`
      );
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, invite]);

  const handleJoin = () => {
    if (!name.trim()) return;
    saveGuestProfile(name.trim(), gender);
    setName(name.trim());
    setPhase('joining');
  };

  if (phase === 'loading') return (
    <div className="min-h-screen bg-white flex items-center justify-center">
      <div className="text-center">
        <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
        <p className="text-slate-500 text-sm">Verifying invite…</p>
      </div>
    </div>
  );

  if (phase === 'error') return (
    <div className="min-h-screen bg-white flex items-center justify-center p-4">
      <div className="text-center max-w-sm">
        <div className="text-5xl mb-4">🚫</div>
        <h1 className="text-xl font-bold text-slate-900 mb-2">Cannot Join</h1>
        <p className="text-slate-500 text-sm mb-6">{error}</p>
        <button onClick={() => router.replace('/')} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium">
          Go Home
        </button>
      </div>
    </div>
  );

  if (phase === 'joining') return (
    <div className="min-h-screen bg-white flex items-center justify-center">
      <div className="text-center">
        <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
        <p className="text-slate-600 font-medium">Joining session…</p>
        <p className="text-slate-400 text-sm mt-1">Allow microphone when prompted</p>
      </div>
    </div>
  );

  // Setup form
  return (
    <div className="min-h-screen bg-white flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <div className="text-4xl mb-2">🎙️</div>
          <h1 className="text-xl font-bold text-slate-900">Join Recording Session</h1>
          {invite && (
            <p className="text-slate-500 text-sm mt-1">
              Invited by <strong>{invite.hostName}</strong> · Language: {invite.hostLanguage}
            </p>
          )}
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Your Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && name.trim() && handleJoin()}
              placeholder="Enter your name"
              maxLength={40}
              autoFocus
              className="w-full border border-slate-300 rounded-lg px-4 py-3 text-slate-900 placeholder-slate-400 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">Your Gender</label>
            <div className="grid grid-cols-2 gap-3">
              {(['MALE', 'FEMALE'] as Gender[]).map((g) => (
                <button key={g} onClick={() => setGender(g)}
                  className={['py-3 rounded-xl border-2 font-medium text-sm transition-all',
                    gender === g ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-600 hover:border-slate-300',
                  ].join(' ')}>
                  {g === 'MALE' ? '♂ Male' : '♀ Female'}
                </button>
              ))}
            </div>
          </div>

          {!hasProfile && (
            <p className="text-xs text-slate-400">
              Your name and gender will be remembered for future sessions on this device.
            </p>
          )}

          <button onClick={handleJoin} disabled={!name.trim()}
            className="w-full py-3.5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white font-semibold text-sm">
            Join Recording →
          </button>
        </div>
      </div>
    </div>
  );
}

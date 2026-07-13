'use client';
// app/room/[roomId]/RoomParamsReader.tsx
// Reads URL params and loads token, then renders RecordingRoom

import { useState, useEffect } from 'react';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import { loadProfile } from '@/lib/profile';
import { getDeviceId } from '@/lib/device';
import { RecordingRoom } from '@/components/room/RecordingRoom';

export default function RoomParamsReader() {
  const rawRoomId = useParams<{ roomId: string }>().roomId;
  const roomId = decodeURIComponent(rawRoomId);
  const sp = useSearchParams();
  const router = useRouter();

  const role = (sp.get('role') ?? 'HOST') as 'HOST' | 'GUEST';
  const pairId = sp.get('pairId') ?? '';

  const [token, setToken] = useState('');
  const [lkUrl, setLkUrl] = useState('');
  const [error, setError] = useState('');

  // Session info — built from URL params + stored profile
  const [session, setSession] = useState<{
    myName: string;
    myGender: string;
    myDeviceId: string;
    myLanguage: string;
    partnerName: string;
    partnerGender: string;
    role: 'HOST' | 'GUEST';
    pairId: string;
  } | null>(null);

  useEffect(() => {
    const deviceId = sp.get('deviceId') ?? getDeviceId();

    // Get my identity
    let myName = '';
    let myGender = '';
    let myLanguage = '';
    let partnerName = '';
    let partnerGender = '';

    if (role === 'HOST') {
      const profile = loadProfile();
      if (!profile) { router.replace('/setup'); return; }
      myName = profile.name;
      myGender = profile.gender;
      myLanguage = profile.language;
      partnerName = 'Partner';
      partnerGender = sp.get('partnerGender') ?? 'MALE';
    } else {
      // GUEST — info passed in URL
      myName = sp.get('guestName') ?? loadProfile()?.name ?? 'Guest';
      myGender = sp.get('guestGender') ?? loadProfile()?.gender ?? 'MALE';
      myLanguage = sp.get('language') ?? '';
      partnerName = sp.get('partnerName') ?? 'Host';
      partnerGender = sp.get('partnerGender') ?? 'MALE';
    }

    const identity = `${deviceId}_${role}`;
    const metadata = JSON.stringify({ name: myName, gender: myGender, role, language: myLanguage });

    setSession({ myName, myGender, myDeviceId: deviceId, myLanguage, partnerName, partnerGender, role, pairId });

    // Fetch LiveKit token
    const params = new URLSearchParams({ roomId, identity, name: myName, metadata });
    fetch(`/api/livekit/token?${params}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.success) {
          setToken(data.token);
          setLkUrl(data.url);
        } else {
          setError(data.error ?? 'Failed to get connection token');
        }
      })
      .catch(() => setError('Network error — check your connection'));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (error) return (
    <div className="min-h-screen bg-white flex items-center justify-center p-4">
      <div className="text-center max-w-sm">
        <div className="text-4xl mb-3">⚠️</div>
        <h1 className="text-xl font-bold text-slate-900 mb-2">Connection Error</h1>
        <p className="text-slate-500 text-sm mb-4">{error}</p>
        <button onClick={() => router.replace('/home')} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium">
          Go Home
        </button>
      </div>
    </div>
  );

  if (!token || !lkUrl || !session) return (
    <div className="min-h-screen bg-white flex items-center justify-center">
      <div className="text-center">
        <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
        <p className="text-slate-600 font-medium">Connecting…</p>
        <p className="text-slate-400 text-sm mt-1">Allow microphone when prompted</p>
      </div>
    </div>
  );

  return (
    <RecordingRoom
      roomId={roomId}
      livekitToken={token}
      livekitUrl={lkUrl}
      session={session}
    />
  );
}

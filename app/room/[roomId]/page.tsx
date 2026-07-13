'use client';

// app/room/[roomId]/page.tsx — Recording room (client-side, no server session)
// Reads name + gender from localStorage. Fetches LiveKit token via API.
// Works for both host and guest (guest arrives via invite link).

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { RoomClient } from '@/components/room/RoomClient';

type Gender = 'MALE' | 'FEMALE';

export default function RoomPage() {
  const params = useParams();
  const router = useRouter();
  const roomId = decodeURIComponent(params.roomId as string);

  const [livekitToken, setLivekitToken] = useState<string | null>(null);
  const [livekitUrl, setLivekitUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [userName, setUserName] = useState('');
  const [userGender, setUserGender] = useState<Gender>('MALE');

  useEffect(() => {
    const name = localStorage.getItem('btd_name') ?? '';
    const gender = (localStorage.getItem('btd_gender') ?? 'MALE') as Gender;

    if (!name) {
      router.replace('/');
      return;
    }

    setUserName(name);
    setUserGender(gender);

    // Fetch LiveKit token — server generates it using LIVEKIT_API_KEY/SECRET
    const fetchToken = async () => {
      try {
        const params = new URLSearchParams({
          roomId,
          name,
          gender,
        });
        const res = await fetch(`/api/livekit/token?${params}`);
        const data = await res.json();
        if (data.success) {
          setLivekitToken(data.data.token);
          setLivekitUrl(data.data.url);
        } else {
          setError(data.error ?? 'Failed to get connection token');
        }
      } catch {
        setError('Network error — check your connection and reload');
      }
    };

    fetchToken();
  }, [roomId, router]);

  if (error) {
    return (
      <div className="min-h-screen bg-[#0A0F1E] flex items-center justify-center p-4">
        <div className="text-center max-w-sm">
          <div className="text-4xl mb-3">⚠️</div>
          <h1 className="text-white font-bold mb-2">Connection Error</h1>
          <p className="text-gray-400 text-sm mb-4">{error}</p>
          <button
            onClick={() => router.replace('/home')}
            className="px-4 py-2 rounded-lg bg-white/10 text-white text-sm hover:bg-white/15 transition-colors"
          >
            Go Back
          </button>
        </div>
      </div>
    );
  }

  if (!livekitToken || !livekitUrl || !userName) {
    return (
      <div className="min-h-screen bg-[#0A0F1E] flex items-center justify-center">
        <div className="text-center">
          <div className="w-10 h-10 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-white text-sm font-medium">Connecting…</p>
        </div>
      </div>
    );
  }

  return (
    <RoomClient
      roomId={roomId}
      livekitToken={livekitToken}
      livekitUrl={livekitUrl}
      userInfo={{
        userId: userName.replace(/\s+/g, '_').toLowerCase(),
        role: 'host',
        gender: userGender,
        language: 'EN',
        deviceId: userName.replace(/\s+/g, '_').slice(0, 8).toUpperCase(),
      }}
    />
  );
}

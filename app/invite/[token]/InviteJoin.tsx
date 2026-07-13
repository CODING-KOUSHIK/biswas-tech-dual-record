'use client';

// app/invite/[token]/InviteJoin.tsx
// Guest joins room directly — fetches LiveKit token then renders full-screen room.
// Same layout as host. No intermediate screens after token is received.

import { useEffect, useState } from 'react';
import { useDeviceId } from '@/hooks/useDeviceId';
import { RoomClient } from '@/components/room/RoomClient';
import type { Gender } from '@/types';

interface InviteJoinProps {
  token: string;
  roomId: string;
  partnerGender: Gender;
}

export function InviteJoin({ token, roomId, partnerGender }: InviteJoinProps) {
  const deviceId = useDeviceId();
  const [livekitToken, setLivekitToken] = useState<string | null>(null);
  const [livekitUrl, setLivekitUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!deviceId) return;

    const fetchToken = async () => {
      try {
        const params = new URLSearchParams({ roomId, inviteToken: token, deviceId });
        const res = await fetch(`/api/livekit/token?${params.toString()}`);
        const data = await res.json();

        if (data.success) {
          setLivekitToken(data.data.token);
          setLivekitUrl(data.data.url);
        } else {
          setError(data.error ?? 'Failed to join session');
        }
      } catch {
        setError('Network error — please check your connection and refresh.');
      }
    };

    fetchToken();
  }, [deviceId, token, roomId]);

  // ── Error state ─────────────────────────────────────────────
  if (error) {
    return (
      <div className="min-h-screen bg-[#0A0F1E] flex items-center justify-center p-4">
        <div className="text-center max-w-sm">
          <div className="text-4xl mb-4">⚠️</div>
          <h1 className="text-xl font-bold text-white mb-2">Unable to Join</h1>
          <p className="text-gray-400 text-sm mb-3">{error}</p>
          <p className="text-gray-600 text-xs">Ask the host to send you a new invite link.</p>
        </div>
      </div>
    );
  }

  // ── Loading: fetching token ──────────────────────────────────
  if (!deviceId || !livekitToken || !livekitUrl) {
    return (
      <div className="min-h-screen bg-[#0A0F1E] flex items-center justify-center">
        <div className="text-center">
          <div className="w-10 h-10 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-white text-sm font-medium">Joining session…</p>
          <p className="text-gray-500 text-xs mt-1">Setting up your recording room</p>
        </div>
      </div>
    );
  }

  // ── Connected: full-screen room (identical to host experience) ─
  return (
    <RoomClient
      roomId={roomId}
      livekitToken={livekitToken}
      livekitUrl={livekitUrl}
      userInfo={{
        userId: `guest_${deviceId}`,
        role: 'guest',
        gender: partnerGender,
        language: 'EN',
        deviceId,
      }}
    />
  );
}

'use client';

// app/invite/[token]/InviteJoin.tsx — Guest joins room via invite token
// Fetches LiveKit token + URL from the API, then renders RoomClient.

import { useEffect, useState } from 'react';
import { useDeviceId } from '@/hooks/useDeviceId';
import { RoomClient } from '@/components/room/RoomClient';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
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
          // Server returns the LiveKit URL — no NEXT_PUBLIC env var required
          setLivekitUrl(data.data.url);
          // Hint cookie for server-side device binding check on next load
          document.cookie = `btd_invite_${token}=${deviceId}; path=/; max-age=${7 * 24 * 60 * 60}; SameSite=Lax`;
        } else {
          setError(data.error ?? 'Failed to join session');
        }
      } catch {
        setError('Network error. Please check your connection and refresh.');
      }
    };

    fetchToken();
  }, [deviceId, token, roomId]);

  if (error) {
    return (
      <div className="text-center max-w-sm mx-auto">
        <div className="text-4xl mb-4">⚠️</div>
        <h1 className="text-xl font-bold text-white mb-2">Unable to Join</h1>
        <p className="text-gray-400 text-sm">{error}</p>
      </div>
    );
  }

  if (!deviceId || !livekitToken || !livekitUrl) {
    return (
      <div className="text-center">
        <LoadingSpinner size="lg" label="Joining session…" />
      </div>
    );
  }

  return (
    <div className="w-full">
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
    </div>
  );
}

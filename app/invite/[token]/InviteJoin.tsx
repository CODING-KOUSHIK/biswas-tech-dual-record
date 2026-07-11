'use client';

// app/invite/[token]/InviteJoin.tsx
// Guest joins room using a self-contained invite token.
// No Redis. Token contains roomId + partnerGender, verified on server.

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
        const params = new URLSearchParams({
          roomId,
          inviteToken: token,
          deviceId,
        });
        const res = await fetch(`/api/livekit/token?${params.toString()}`);
        const data = await res.json();

        if (data.success) {
          setLivekitToken(data.data.token);
          setLivekitUrl(data.data.url);
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
        <p className="text-gray-400 text-sm mb-4">{error}</p>
        <p className="text-gray-600 text-xs">Ask the host to send you a new invite link.</p>
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

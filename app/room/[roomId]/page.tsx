import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { generateLiveKitToken, getLiveKitUrl } from '@/lib/livekit';
import { RoomPageClient } from './RoomPageClient';

export const metadata: Metadata = {
  title: 'Recording Room — Biswas Tech',
};

interface Props {
  params: Promise<{ roomId: string }>;
}

// Fallback session used when auth is bypassed
const BYPASS_SESSION = {
  userId: 'host',
  role: 'host' as const,
  gender: 'MALE' as const,
  language: 'EN',
  deviceId: 'AUTO',
};

export default async function RoomPage({ params }: Props) {
  const session = (await getSession()) ?? BYPASS_SESSION;
  const { roomId } = await params;

  if (!roomId || roomId.length < 5 || roomId.length > 80) {
    redirect('/dashboard');
  }

  let livekitToken: string;
  let livekitUrl: string;

  try {
    livekitUrl = getLiveKitUrl();
    livekitToken = await generateLiveKitToken({
      identity: `${session.userId}_${session.deviceId}`,
      roomId,
      role: session.role,
      metadata: JSON.stringify({
        userId: session.userId,
        role: session.role,
        gender: session.gender,
        language: session.language,
        deviceId: session.deviceId,
      }),
    });
  } catch (err) {
    console.error('RoomPage: failed to generate LiveKit token', err);
    redirect('/dashboard');
  }

  return (
    <RoomPageClient
      roomId={roomId}
      livekitToken={livekitToken}
      livekitUrl={livekitUrl}
      userInfo={{
        userId: session.userId,
        role: session.role,
        gender: session.gender,
        language: session.language,
        deviceId: session.deviceId,
      }}
    />
  );
}

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

export default async function RoomPage({ params }: Props) {
  const session = await getSession();
  if (!session) {
    redirect('/login');
  }

  const { roomId } = await params;

  if (!roomId || roomId.length < 5 || roomId.length > 80) {
    redirect('/dashboard');
  }

  // Generate LiveKit token + resolve URL entirely server-side.
  // The API secret and LIVEKIT_URL never reach the browser.
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

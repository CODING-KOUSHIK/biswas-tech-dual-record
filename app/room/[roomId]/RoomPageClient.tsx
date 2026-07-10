'use client';

// app/room/[roomId]/RoomPageClient.tsx — Thin client wrapper for RoomClient

import { RoomClient } from '@/components/room/RoomClient';
import type { Gender, UserRole } from '@/types';

interface UserInfo {
  userId: string;
  role: UserRole;
  gender: Gender;
  language: string;
  deviceId: string;
}

interface RoomPageClientProps {
  roomId: string;
  livekitToken: string;
  livekitUrl: string;
  userInfo: UserInfo;
}

export function RoomPageClient({
  roomId,
  livekitToken,
  livekitUrl,
  userInfo,
}: RoomPageClientProps) {
  return (
    <RoomClient
      roomId={roomId}
      livekitToken={livekitToken}
      livekitUrl={livekitUrl}
      userInfo={userInfo}
    />
  );
}

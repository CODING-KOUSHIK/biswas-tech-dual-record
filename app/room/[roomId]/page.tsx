'use client';
// app/room/[roomId]/page.tsx — Recording room page
// Reads session info from URL params (passed by host/guest entry points)

import { Suspense } from 'react';
import { RecordingRoom } from '@/components/room/RecordingRoom';
import RoomParamsReader from './RoomParamsReader';

export default function RoomPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    }>
      <RoomParamsReader />
    </Suspense>
  );
}

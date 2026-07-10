'use client';

// components/room/RecordingTimer.tsx — Live recording duration display

import { useEffect, useRef, useState } from 'react';

interface RecordingTimerProps {
  isRunning: boolean;
}

export function RecordingTimer({ isRunning }: RecordingTimerProps) {
  const [elapsed, setElapsed] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const startRef = useRef<number>(0);

  useEffect(() => {
    if (isRunning) {
      startRef.current = Date.now();
      intervalRef.current = setInterval(() => {
        setElapsed(Date.now() - startRef.current);
      }, 500);
    } else {
      clearInterval(intervalRef.current);
      setElapsed(0);
    }
    return () => clearInterval(intervalRef.current);
  }, [isRunning]);

  const format = (ms: number) => {
    const total = Math.floor(ms / 1000);
    const h = Math.floor(total / 3600).toString().padStart(2, '0');
    const m = Math.floor((total % 3600) / 60).toString().padStart(2, '0');
    const s = (total % 60).toString().padStart(2, '0');
    return `${h}:${m}:${s}`;
  };

  return (
    <div className="flex items-center gap-2">
      {isRunning && (
        <span className="relative flex h-2.5 w-2.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75" />
          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-600" />
        </span>
      )}
      <span className="font-mono text-2xl font-bold text-white tabular-nums">
        {format(elapsed)}
      </span>
    </div>
  );
}

'use client';
// hooks/useWakeLock.ts — Prevent screen sleep during recording

import { useCallback, useEffect, useRef } from 'react';

export function useWakeLock() {
  const lockRef = useRef<WakeLockSentinel | null>(null);

  const acquire = useCallback(async () => {
    if (!('wakeLock' in navigator)) return;
    try {
      if (lockRef.current) return;
      lockRef.current = await navigator.wakeLock.request('screen');
    } catch {
      // not available or denied — silent fail
    }
  }, []);

  const release = useCallback(async () => {
    if (lockRef.current) {
      await lockRef.current.release().catch(() => {});
      lockRef.current = null;
    }
  }, []);

  useEffect(() => {
    // Acquire lock immediately on mount
    acquire();
    
    const handleVisibilityChange = async () => {
      if (document.visibilityState === 'visible' && !lockRef.current) {
        await acquire();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [acquire]);

  return { acquire, release };
}

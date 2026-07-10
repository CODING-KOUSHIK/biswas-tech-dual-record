'use client';

// hooks/useBeforeUnload.ts — Warn user before closing/refreshing during recording

import { useEffect } from 'react';

export function useBeforeUnload(isActive: boolean) {
  useEffect(() => {
    if (!isActive) return;

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Modern browsers show their own message; returning a string triggers the dialog
      return (e.returnValue = 'Recording is running. Are you sure you want to leave?');
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isActive]);
}

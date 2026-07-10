'use client';

// hooks/useDeviceId.ts — Persistent device ID hook

import { useState, useEffect } from 'react';
import { getOrCreateDeviceId } from '@/lib/device-id';

export function useDeviceId(): string {
  const [deviceId, setDeviceId] = useState<string>('');

  useEffect(() => {
    setDeviceId(getOrCreateDeviceId());
  }, []);

  return deviceId;
}

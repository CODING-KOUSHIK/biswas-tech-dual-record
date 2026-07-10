'use client';

// hooks/useSingleTab.ts — Ensures only one active tab per browser session.
// When a new tab opens, the previous one disconnects and redirects to /login.

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

const CHANNEL_NAME = 'btd_single_tab';

export function useSingleTab() {
  const router = useRouter();

  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;

    const channel = new BroadcastChannel(CHANNEL_NAME);

    // Announce this tab is active
    channel.postMessage({ type: 'TAB_OPENED' });

    channel.onmessage = (event) => {
      if (event.data?.type === 'TAB_OPENED') {
        // Another tab opened — this tab must disconnect
        channel.postMessage({ type: 'TAB_CLOSING' });
        router.replace('/login?reason=duplicate_tab');
      }
    };

    return () => {
      channel.close();
    };
  }, [router]);
}

'use client';

// components/room/SignalStrength.tsx — Connection quality display

import type { ConnectionQuality } from '@/types';

interface SignalStrengthProps {
  quality: ConnectionQuality;
}

const qualityConfig: Record<ConnectionQuality, { label: string; color: string; bars: number }> = {
  excellent: { label: 'Excellent', color: 'text-emerald-400', bars: 4 },
  good:      { label: 'Good',      color: 'text-blue-400',    bars: 3 },
  weak:      { label: 'Weak',      color: 'text-amber-400',   bars: 2 },
  poor:      { label: 'Poor',      color: 'text-red-400',     bars: 1 },
  unknown:   { label: 'Connecting', color: 'text-gray-400',   bars: 0 },
};

export function SignalStrength({ quality }: SignalStrengthProps) {
  const config = qualityConfig[quality];
  const heights = ['h-2', 'h-3', 'h-4', 'h-5'];

  return (
    <div className="flex items-center gap-2">
      <div className="flex items-end gap-0.5 h-5">
        {heights.map((h, i) => (
          <div
            key={i}
            className={[
              'w-1.5 rounded-sm',
              h,
              i < config.bars ? config.color.replace('text-', 'bg-') : 'bg-gray-700',
            ].join(' ')}
          />
        ))}
      </div>
      <span className={`text-xs font-medium ${config.color}`}>{config.label}</span>
    </div>
  );
}

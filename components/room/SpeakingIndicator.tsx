'use client';

// components/room/SpeakingIndicator.tsx — Animated speaking status circle

interface SpeakingIndicatorProps {
  label: string;
  isSpeaking: boolean;
  color: 'green' | 'blue';
}

export function SpeakingIndicator({ label, isSpeaking, color }: SpeakingIndicatorProps) {
  const colorMap = {
    green: {
      ring: 'bg-emerald-500',
      pulse: 'bg-emerald-400',
      text: 'text-emerald-400',
      idle: 'bg-gray-600',
    },
    blue: {
      ring: 'bg-blue-500',
      pulse: 'bg-blue-400',
      text: 'text-blue-400',
      idle: 'bg-gray-600',
    },
  };
  const c = colorMap[color];

  return (
    <div className="flex items-center gap-3">
      <div className="relative flex h-4 w-4 shrink-0">
        {isSpeaking ? (
          <>
            <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${c.pulse} opacity-60`} />
            <span className={`relative inline-flex rounded-full h-4 w-4 ${c.ring}`} />
          </>
        ) : (
          <span className={`relative inline-flex rounded-full h-4 w-4 ${c.idle}`} />
        )}
      </div>
      <span className={`text-sm font-medium ${isSpeaking ? c.text : 'text-gray-500'}`}>
        {label}
      </span>
    </div>
  );
}

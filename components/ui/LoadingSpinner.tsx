'use client';

// components/ui/LoadingSpinner.tsx — Simple accessible spinner

interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  label?: string;
}

const sizeMap = { sm: 'w-4 h-4', md: 'w-8 h-8', lg: 'w-12 h-12' };

export function LoadingSpinner({ size = 'md', label = 'Loading…' }: SpinnerProps) {
  return (
    <div role="status" aria-label={label} className="flex flex-col items-center gap-3">
      <svg
        className={`animate-spin text-blue-500 ${sizeMap[size]}`}
        viewBox="0 0 24 24"
        fill="none"
      >
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
      </svg>
      {size !== 'sm' && <p className="text-gray-400 text-sm">{label}</p>}
    </div>
  );
}

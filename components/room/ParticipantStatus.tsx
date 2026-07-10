'use client';

// components/room/ParticipantStatus.tsx — Shows host and partner connection status

interface ParticipantStatusProps {
  role: 'host' | 'guest';
  partnerConnected: boolean;
  partnerName?: string;
}

export function ParticipantStatus({ role, partnerConnected, partnerName }: ParticipantStatusProps) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {/* Self */}
      <div className="bg-white/5 border border-white/10 rounded-lg p-3 flex items-center gap-3">
        <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 shrink-0" />
        <div>
          <p className="text-xs text-gray-400">You</p>
          <p className="text-sm font-medium text-white capitalize">{role}</p>
        </div>
        <span className="ml-auto text-xs text-emerald-400">Connected</span>
      </div>

      {/* Partner */}
      <div className={`border rounded-lg p-3 flex items-center gap-3 ${partnerConnected ? 'bg-white/5 border-white/10' : 'bg-white/[0.02] border-white/5'}`}>
        <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${partnerConnected ? 'bg-blue-500' : 'bg-gray-600'}`} />
        <div>
          <p className="text-xs text-gray-400">Partner</p>
          <p className="text-sm font-medium text-white">{partnerName ?? 'Unknown'}</p>
        </div>
        <span className={`ml-auto text-xs ${partnerConnected ? 'text-blue-400' : 'text-gray-500'}`}>
          {partnerConnected ? 'Connected' : 'Waiting…'}
        </span>
      </div>
    </div>
  );
}

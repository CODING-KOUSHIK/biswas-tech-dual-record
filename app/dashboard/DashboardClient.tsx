'use client';

// app/dashboard/DashboardClient.tsx — Interactive dashboard components

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { InviteModal } from '@/components/host/InviteModal';
import { CreateUserModal } from '@/components/host/CreateUserModal';
import { RecordingList } from '@/components/host/RecordingList';
import { useToast } from '@/components/ui/Toast';

// Header action: logout button
export function DashboardClient() {
  const router = useRouter();
  const { showToast } = useToast();
  const [loading, setLoading] = useState(false);

  const handleLogout = async () => {
    setLoading(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      router.push('/login');
    } catch {
      showToast('Logout failed', 'error');
      setLoading(false);
    }
  };

  return (
    <Button variant="ghost" size="sm" onClick={handleLogout} loading={loading}>
      Sign Out
    </Button>
  );
}

// Main dashboard content
export function DashboardClientContent() {
  const router = useRouter();
  const { showToast } = useToast();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [createUserOpen, setCreateUserOpen] = useState(false);
  const [showRecordings, setShowRecordings] = useState(false);
  const [enteringRoom, setEnteringRoom] = useState(false);

  const handleEnterRoom = async () => {
    setEnteringRoom(true);
    try {
      const res = await fetch('/api/host/room', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        router.push(`/room/${encodeURIComponent(data.data.roomId)}`);
      } else {
        showToast(data.error ?? 'Failed to create room', 'error');
        setEnteringRoom(false);
      }
    } catch {
      showToast('Network error', 'error');
      setEnteringRoom(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Action buttons */}
      <div className="grid grid-cols-2 gap-3">
        <Button
          id="btn-invite-user"
          size="lg"
          variant="primary"
          onClick={() => setInviteOpen(true)}
          className="flex-col h-20 gap-1"
        >
          <span className="text-xl">🔗</span>
          <span>Invite User</span>
        </Button>

        <Button
          id="btn-create-user"
          size="lg"
          variant="ghost"
          onClick={() => setCreateUserOpen(true)}
          className="flex-col h-20 gap-1"
        >
          <span className="text-xl">➕</span>
          <span>Create User</span>
        </Button>
      </div>

      {/* Enter room */}
      <Button
        id="btn-enter-room"
        size="lg"
        variant="success"
        loading={enteringRoom}
        onClick={handleEnterRoom}
        className="w-full"
      >
        🎙️ Enter Recording Room
      </Button>

      {/* Recordings section */}
      <div>
        <button
          onClick={() => setShowRecordings((v) => !v)}
          className="w-full bg-white/5 hover:bg-white/8 border border-white/10 rounded-lg p-4 flex items-center justify-between text-left transition-colors"
        >
          <div className="flex items-center gap-3">
            <span className="text-xl">🎙️</span>
            <span className="font-medium text-white">Recording Files</span>
          </div>
          <svg
            className={`w-4 h-4 text-gray-400 transition-transform ${showRecordings ? 'rotate-180' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {showRecordings && (
          <div className="mt-3">
            <RecordingList isHost={true} />
          </div>
        )}
      </div>

      {/* Modals */}
      <InviteModal isOpen={inviteOpen} onClose={() => setInviteOpen(false)} />
      <CreateUserModal isOpen={createUserOpen} onClose={() => setCreateUserOpen(false)} />
    </div>
  );
}

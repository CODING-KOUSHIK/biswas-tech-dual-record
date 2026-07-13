'use client';

// components/host/InviteModal.tsx
// After generating invite link:
// - Shows link + Copy button
// - Shows "Join Room" button to enter the linked room
// - Shows "Waiting for partner" note

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import type { Gender } from '@/types';

interface InviteModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface InviteResult {
  inviteUrl: string;
  roomId: string;
  token: string;
}

export function InviteModal({ isOpen, onClose }: InviteModalProps) {
  const router = useRouter();
  const { showToast } = useToast();
  const [partnerGender, setPartnerGender] = useState<Gender | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<InviteResult | null>(null);
  const [copied, setCopied] = useState(false);

  const handleGenerate = async () => {
    if (!partnerGender) return;
    setLoading(true);
    try {
      const response = await fetch('/api/host/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ partnerGender }),
      });
      const data = await response.json();
      if (data.success) {
        setResult({
          inviteUrl: data.data.inviteUrl,
          roomId: data.data.roomId,
          token: data.data.token,
        });
      } else {
        showToast(data.error ?? 'Failed to create invite', 'error');
      }
    } catch {
      showToast('Network error', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    if (!result?.inviteUrl) return;
    try {
      await navigator.clipboard.writeText(result.inviteUrl);
      setCopied(true);
      showToast('Invite link copied!', 'success', 2000);
      setTimeout(() => setCopied(false), 3000);
    } catch {
      showToast('Copy failed — select and copy manually', 'warning');
    }
  };

  const handleJoinRoom = () => {
    if (!result?.roomId) return;
    onClose();
    router.push(`/room/${encodeURIComponent(result.roomId)}`);
  };

  const handleClose = () => {
    setPartnerGender(null);
    setResult(null);
    setCopied(false);
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Invite Partner" size="sm">
      {!result ? (
        /* ── Step 1: Select gender ── */
        <div className="space-y-5">
          <p className="text-sm text-gray-400">Select the partner&apos;s gender:</p>
          <div className="grid grid-cols-2 gap-3">
            {(['MALE', 'FEMALE'] as Gender[]).map((g) => (
              <button
                key={g}
                onClick={() => setPartnerGender(g)}
                className={[
                  'py-4 rounded-lg border-2 font-semibold text-sm transition-colors',
                  partnerGender === g
                    ? 'border-blue-500 bg-blue-600/20 text-white'
                    : 'border-white/15 text-gray-400 hover:border-white/30 hover:text-white',
                ].join(' ')}
              >
                {g === 'MALE' ? '♂ Male' : '♀ Female'}
              </button>
            ))}
          </div>
          <Button
            onClick={handleGenerate}
            loading={loading}
            disabled={!partnerGender}
            className="w-full"
            size="lg"
          >
            Generate Invite Link
          </Button>
        </div>
      ) : (
        /* ── Step 2: Share link + Join Room ── */
        <div className="space-y-4">
          {/* Invite link */}
          <div>
            <p className="text-sm text-gray-400 mb-2">Share this link with your partner:</p>
            <div className="bg-black/30 border border-white/10 rounded-lg p-3">
              <p className="text-xs font-mono text-blue-400 break-all leading-relaxed">
                {result.inviteUrl}
              </p>
            </div>
          </div>

          {/* Copy button */}
          <Button
            onClick={handleCopy}
            variant={copied ? 'success' : 'primary'}
            size="md"
            className="w-full"
          >
            {copied ? '✓ Copied!' : '📋 Copy Invite Link'}
          </Button>

          {/* Divider */}
          <div className="flex items-center gap-3">
            <div className="flex-1 border-t border-white/10" />
            <span className="text-xs text-gray-500">Then</span>
            <div className="flex-1 border-t border-white/10" />
          </div>

          {/* Join Room button */}
          <div className="bg-white/5 border border-white/10 rounded-lg p-4">
            <p className="text-xs text-gray-400 mb-3 text-center">
              After sharing the link, join the room and wait for your partner to connect.
            </p>
            <Button
              id="btn-join-room-from-invite"
              onClick={handleJoinRoom}
              variant="success"
              size="lg"
              className="w-full"
            >
              🎙️ Join Room &amp; Wait for Partner
            </Button>
          </div>

          {/* Start over */}
          <button
            onClick={handleClose}
            className="w-full text-xs text-gray-500 hover:text-gray-300 transition-colors py-1"
          >
            Cancel
          </button>
        </div>
      )}
    </Modal>
  );
}

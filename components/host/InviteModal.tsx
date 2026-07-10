'use client';

// components/host/InviteModal.tsx — Host generates invite URL for partner

import { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import type { Gender } from '@/types';

interface InviteModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function InviteModal({ isOpen, onClose }: InviteModalProps) {
  const { showToast } = useToast();
  const [partnerGender, setPartnerGender] = useState<Gender | null>(null);
  const [loading, setLoading] = useState(false);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
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
        setInviteUrl(data.data.inviteUrl);
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
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      showToast('Invite link copied!', 'success', 2000);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      showToast('Copy failed — select and copy manually', 'warning');
    }
  };

  const handleClose = () => {
    setPartnerGender(null);
    setInviteUrl(null);
    setCopied(false);
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Invite Partner" size="sm">
      {!inviteUrl ? (
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
        <div className="space-y-4">
          <p className="text-sm text-gray-400">Share this link with your partner:</p>
          <div className="bg-black/30 border border-white/10 rounded-lg p-3">
            <p className="text-xs font-mono text-blue-400 break-all">{inviteUrl}</p>
          </div>
          <div className="flex gap-3">
            <Button onClick={handleCopy} variant={copied ? 'success' : 'primary'} size="md" className="flex-1">
              {copied ? '✓ Copied!' : 'Copy Link'}
            </Button>
            <Button onClick={handleClose} variant="ghost" size="md">
              Done
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

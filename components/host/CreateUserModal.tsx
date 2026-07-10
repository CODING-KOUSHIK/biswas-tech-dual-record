'use client';

// components/host/CreateUserModal.tsx — Host creates new user accounts

import { useState, useId } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import type { Gender } from '@/types';

interface CreateUserModalProps {
  isOpen: boolean;
  onClose: () => void;
  onUserCreated?: () => void;
}

const LANGUAGE_OPTIONS = [
  { value: 'EN', label: 'English' },
  { value: 'HI', label: 'Hindi' },
  { value: 'BN', label: 'Bengali' },
  { value: 'TA', label: 'Tamil' },
  { value: 'TE', label: 'Telugu' },
  { value: 'MR', label: 'Marathi' },
  { value: 'GU', label: 'Gujarati' },
  { value: 'KN', label: 'Kannada' },
  { value: 'ML', label: 'Malayalam' },
  { value: 'PA', label: 'Punjabi' },
];

export function CreateUserModal({ isOpen, onClose, onUserCreated }: CreateUserModalProps) {
  const { showToast } = useToast();
  const [userId, setUserId] = useState('');
  const [password, setPassword] = useState('');
  const [gender, setGender] = useState<Gender>('MALE');
  const [language, setLanguage] = useState('EN');
  const [loading, setLoading] = useState(false);

  const userIdId = useId();
  const passwordId = useId();
  const languageId = useId();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const response = await fetch('/api/host/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: userId.trim(), password, gender, language }),
      });
      const data = await response.json();
      if (data.success) {
        showToast(`User "${userId}" created successfully`, 'success');
        setUserId('');
        setPassword('');
        setGender('MALE');
        setLanguage('EN');
        onUserCreated?.();
        onClose();
      } else {
        showToast(data.error ?? 'Failed to create user', 'error');
      }
    } catch {
      showToast('Network error', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Create User">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor={userIdId} className="block text-sm font-medium text-gray-300 mb-1.5">
            User ID
          </label>
          <input
            id={userIdId}
            type="text"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            required
            placeholder="e.g. speaker001"
            autoCapitalize="none"
            className="w-full px-3 py-2.5 bg-white/5 border border-white/15 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 text-sm"
          />
        </div>

        <div>
          <label htmlFor={passwordId} className="block text-sm font-medium text-gray-300 mb-1.5">
            Password
          </label>
          <input
            id={passwordId}
            type="text"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            placeholder="Min. 6 characters"
            className="w-full px-3 py-2.5 bg-white/5 border border-white/15 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 text-sm"
          />
        </div>

        <div>
          <p className="block text-sm font-medium text-gray-300 mb-2">Gender</p>
          <div className="grid grid-cols-2 gap-2">
            {(['MALE', 'FEMALE'] as Gender[]).map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => setGender(g)}
                className={[
                  'py-2.5 rounded-lg border text-sm font-medium transition-colors',
                  gender === g
                    ? 'border-blue-500 bg-blue-600/20 text-white'
                    : 'border-white/15 text-gray-400 hover:text-white hover:border-white/30',
                ].join(' ')}
              >
                {g === 'MALE' ? '♂ Male' : '♀ Female'}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label htmlFor={languageId} className="block text-sm font-medium text-gray-300 mb-1.5">
            Language
          </label>
          <select
            id={languageId}
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            className="w-full px-3 py-2.5 bg-[#0A0F1E] border border-white/15 rounded-lg text-white focus:outline-none focus:border-blue-500 text-sm"
          >
            {LANGUAGE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label} ({opt.value})</option>
            ))}
          </select>
        </div>

        <div className="flex gap-3 pt-1">
          <Button type="submit" loading={loading} disabled={!userId || !password} className="flex-1">
            Create User
          </Button>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Modal>
  );
}

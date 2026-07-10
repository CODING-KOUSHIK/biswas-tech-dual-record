'use client';

// components/auth/LoginForm.tsx — User ID + Password login form

import { useState, useId } from 'react';
import { useRouter } from 'next/navigation';
import { useDeviceId } from '@/hooks/useDeviceId';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';

export function LoginForm() {
  const router = useRouter();
  const deviceId = useDeviceId();
  const { showToast } = useToast();

  const [userId, setUserId] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const userIdId = useId();
  const passwordId = useId();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!deviceId) {
      showToast('Device initialization failed. Refresh and try again.', 'error');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: userId.trim(), password, deviceId }),
      });

      const data = await response.json();

      if (data.success) {
        showToast('Login successful', 'success');
        if (data.data.role === 'host') {
          router.push('/dashboard');
        } else {
          router.push('/room');
        }
      } else {
        if (response.status === 409) {
          showToast('This account is active on another device.', 'error', 5000);
        } else if (response.status === 429) {
          showToast('Too many login attempts. Wait a moment.', 'warning', 5000);
        } else {
          showToast(data.error ?? 'Login failed', 'error');
        }
      }
    } catch {
      showToast('Network error. Check your connection.', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5" noValidate>
      <div>
        <label htmlFor={userIdId} className="block text-sm font-medium text-gray-300 mb-1.5">
          User ID
        </label>
        <input
          id={userIdId}
          type="text"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          required
          placeholder="Enter your user ID"
          className="w-full px-4 py-3 bg-white/5 border border-white/15 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 text-base"
        />
      </div>

      <div>
        <label htmlFor={passwordId} className="block text-sm font-medium text-gray-300 mb-1.5">
          Password
        </label>
        <div className="relative">
          <input
            id={passwordId}
            type={showPassword ? 'text' : 'password'}
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            placeholder="Enter your password"
            className="w-full px-4 py-3 pr-12 bg-white/5 border border-white/15 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 text-base"
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white p-1"
          >
            {showPassword ? (
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
              </svg>
            ) : (
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {deviceId && (
        <p className="text-xs text-gray-500">
          Device ID: <span className="font-mono text-gray-400">{deviceId}</span>
        </p>
      )}

      <Button
        type="submit"
        size="lg"
        loading={loading}
        disabled={!userId || !password || !deviceId}
        className="w-full"
      >
        Sign In
      </Button>
    </form>
  );
}

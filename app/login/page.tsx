import type { Metadata } from 'next';
import { LoginForm } from '@/components/auth/LoginForm';

export const metadata: Metadata = {
  title: 'Sign In — Biswas Tech Recording Studio',
};

export default function LoginPage() {
  return (
    <div className="min-h-screen bg-[#0A0F1E] flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Logo / Brand */}
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-white tracking-tight">Biswas Tech</h1>
          <p className="text-sm text-gray-400 mt-1">Dual Recording Studio</p>
        </div>

        {/* Card */}
        <div className="bg-[#1B2538] border border-white/10 rounded-xl p-6">
          <h2 className="text-lg font-semibold text-white mb-5">Sign In</h2>
          <LoginForm />
        </div>

        <p className="text-center text-xs text-gray-600 mt-6">
          Access restricted. Contact your host for credentials.
        </p>
      </div>
    </div>
  );
}

import type { Metadata } from 'next';
import { verifyInviteToken } from '@/lib/invite-token';
import { InviteJoin } from './InviteJoin';

export const metadata: Metadata = {
  title: 'Joining Session — Biswas Tech',
};

interface Props {
  params: Promise<{ token: string }>;
}

export default async function InvitePage({ params }: Props) {
  const { token } = await params;

  if (!token || token.length < 10) {
    return (
      <div className="min-h-screen bg-[#0A0F1E] flex items-center justify-center p-4">
        <div className="text-center">
          <div className="text-4xl mb-4">🔗</div>
          <h1 className="text-xl font-bold text-white mb-2">Invalid Invite</h1>
          <p className="text-gray-400 text-sm">This invite link is missing or malformed.</p>
        </div>
      </div>
    );
  }

  // Verify the self-contained signed token — no Redis lookup needed
  const invite = await verifyInviteToken(token);

  if (!invite) {
    return (
      <div className="min-h-screen bg-[#0A0F1E] flex items-center justify-center p-4">
        <div className="text-center">
          <div className="text-4xl mb-4">⏰</div>
          <h1 className="text-xl font-bold text-white mb-2">Invite Expired or Invalid</h1>
          <p className="text-gray-400 text-sm">
            This invite link has expired (7 days) or is invalid.<br />
            Ask the host to generate a new invite link.
          </p>
        </div>
      </div>
    );
  }

  // Render directly — InviteJoin handles full-screen room layout
  return (
    <InviteJoin
      token={token}
      roomId={invite.roomId}
      partnerGender={invite.partnerGender}
    />
  );
}

import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getInvite } from '@/lib/redis';
import { cookies } from 'next/headers';
import { InviteJoin } from './InviteJoin';

export const metadata: Metadata = {
  title: 'Joining Session — Biswas Tech',
};

interface Props {
  params: Promise<{ token: string }>;
}

export default async function InvitePage({ params }: Props) {
  const { token } = await params;

  if (!token || !/^[a-zA-Z0-9]{8}$/.test(token)) {
    redirect('/login');
  }

  const invite = await getInvite(token);
  if (!invite) {
    return (
      <div className="min-h-screen bg-[#0A0F1E] flex items-center justify-center p-4">
        <div className="text-center">
          <h1 className="text-xl font-bold text-white mb-2">Invalid Invite</h1>
          <p className="text-gray-400 text-sm">This invite link has expired or is invalid.</p>
        </div>
      </div>
    );
  }

  // Check device cookie binding
  const cookieStore = await cookies();
  const boundDevice = cookieStore.get(`btd_invite_${token}`)?.value;
  const deviceMismatch = boundDevice !== undefined && invite.deviceId !== null && boundDevice !== invite.deviceId;

  if (deviceMismatch) {
    return (
      <div className="min-h-screen bg-[#0A0F1E] flex items-center justify-center p-4">
        <div className="text-center">
          <h1 className="text-xl font-bold text-white mb-2">Access Denied</h1>
          <p className="text-gray-400 text-sm">This invite link is bound to a different device.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0A0F1E] flex items-center justify-center p-4">
      <InviteJoin
        token={token}
        roomId={invite.roomId}
        partnerGender={invite.partnerGender}
      />
    </div>
  );
}

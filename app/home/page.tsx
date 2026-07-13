'use client';
// app/home/page.tsx — Main home page with 3 cards

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { loadProfile, clearProfile } from '@/lib/profile';
import { getDeviceId } from '@/lib/device';
import { getAllRecordings, deleteRecording, RecordingRecord } from '@/lib/db';
import { downloadRecordingPair, downloadAllRecordings } from '@/lib/zip';

type Gender = 'MALE' | 'FEMALE';
type View = 'home' | 'invite' | 'recordings';

function formatDuration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function HomePage() {
  const router = useRouter();
  const [view, setView] = useState<View>('home');
  const [profile, setProfile] = useState<ReturnType<typeof loadProfile>>(null);
  const [deviceId, setDeviceId] = useState('');

  // Invite state
  const [partnerGender, setPartnerGender] = useState<Gender>('FEMALE');
  const [generating, setGenerating] = useState(false);
  const [inviteResult, setInviteResult] = useState<{ url: string; pairId: string; roomId: string } | null>(null);
  const [copied, setCopied] = useState(false);

  // Recordings state
  const [recordings, setRecordings] = useState<RecordingRecord[]>([]);
  const [loadingRecs, setLoadingRecs] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [downloadingAll, setDownloadingAll] = useState(false);

  useEffect(() => {
    const p = loadProfile();
    if (!p) { router.replace('/setup'); return; }
    setProfile(p);
    setDeviceId(getDeviceId());
  }, [router]);

  // Load recordings when switching to that view
  useEffect(() => {
    if (view === 'recordings') {
      setLoadingRecs(true);
      getAllRecordings().then((recs) => {
        setRecordings(recs);
        setLoadingRecs(false);
      });
    }
  }, [view]);

  const handleGenerateInvite = async () => {
    if (!profile || generating) return;
    setGenerating(true);
    setInviteResult(null);
    try {
      const res = await fetch('/api/invite/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hostDeviceId: deviceId,
          hostName: profile.name,
          hostLanguage: profile.language,
          hostGender: profile.gender,
          partnerGender,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setInviteResult({ url: data.inviteUrl, pairId: data.pairId, roomId: data.roomId });
      } else {
        alert('Failed: ' + data.error);
      }
    } catch {
      alert('Network error. Try again.');
    } finally {
      setGenerating(false);
    }
  };

  const handleCopy = async () => {
    if (!inviteResult) return;
    try { await navigator.clipboard.writeText(inviteResult.url); }
    catch { /* fallback: select input */ }
    setCopied(true);
    setTimeout(() => setCopied(false), 3000);
  };

  const handleEnterRoom = () => {
    if (!inviteResult) return;
    router.push(`/room/${encodeURIComponent(inviteResult.roomId)}?role=HOST&pairId=${inviteResult.pairId}`);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this recording? This cannot be undone.')) return;
    setDeletingId(id);
    await deleteRecording(id);
    setRecordings((prev) => prev.filter((r) => r.id !== id));
    setDeletingId(null);
  };

  const handleDownloadAll = async () => {
    if (recordings.length === 0) return;
    setDownloadingAll(true);
    await downloadAllRecordings(recordings).catch(console.error);
    setDownloadingAll(false);
  };

  if (!profile) return (
    <div className="min-h-screen bg-white flex items-center justify-center">
      <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  // ── Home view ──────────────────────────────────────────────────────────────
  if (view === 'home') return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <header className="bg-white border-b border-slate-200 px-4 py-4">
        <div className="max-w-lg mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-slate-900">Biswas Tech</h1>
            <p className="text-xs text-slate-500">{profile.name} · {deviceId} · {profile.language}</p>
          </div>
          <button onClick={() => { clearProfile(); router.replace('/setup'); }}
            className="text-xs text-slate-400 hover:text-slate-600 px-2 py-1">Reset</button>
        </div>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center p-4 gap-4 max-w-lg mx-auto w-full">
        {/* Card 1: Invite Partner */}
        <button onClick={() => { setView('invite'); setInviteResult(null); }}
          className="w-full bg-blue-600 hover:bg-blue-700 active:scale-95 text-white rounded-2xl p-6 text-left transition-all shadow-sm">
          <div className="text-3xl mb-3">🔗</div>
          <h2 className="text-xl font-bold">Invite Partner</h2>
          <p className="text-blue-200 text-sm mt-1">Generate a meeting link to record with a partner</p>
        </button>

        {/* Card 2: Previous Recordings */}
        <button onClick={() => setView('recordings')}
          className="w-full bg-white hover:bg-slate-50 active:scale-95 text-slate-900 rounded-2xl p-6 text-left transition-all shadow-sm border border-slate-200">
          <div className="text-3xl mb-3">🎙️</div>
          <h2 className="text-xl font-bold">Previous Recordings</h2>
          <p className="text-slate-500 text-sm mt-1">View and download your saved recordings</p>
        </button>

        {/* Card 3: Download All */}
        <button onClick={() => { setView('recordings'); setTimeout(() => handleDownloadAll(), 300); }}
          className="w-full bg-white hover:bg-slate-50 active:scale-95 text-slate-900 rounded-2xl p-6 text-left transition-all shadow-sm border border-slate-200">
          <div className="text-3xl mb-3">📦</div>
          <h2 className="text-xl font-bold">Download All Files</h2>
          <p className="text-slate-500 text-sm mt-1">Download all recordings in one ZIP file</p>
        </button>
      </main>
    </div>
  );

  // ── Invite view ────────────────────────────────────────────────────────────
  if (view === 'invite') return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <header className="bg-white border-b border-slate-200 px-4 py-4">
        <div className="max-w-lg mx-auto flex items-center gap-3">
          <button onClick={() => setView('home')} className="text-slate-500 hover:text-slate-900 text-lg">←</button>
          <h1 className="text-lg font-bold text-slate-900">Invite Partner</h1>
        </div>
      </header>

      <main className="flex-1 p-4 max-w-lg mx-auto w-full space-y-4 pt-6">
        {!inviteResult ? (
          <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-5">
            <div>
              <h2 className="font-semibold text-slate-900">Partner&apos;s Gender</h2>
              <p className="text-slate-500 text-sm mt-1">Used for recording file naming</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {(['MALE', 'FEMALE'] as Gender[]).map((g) => (
                <button key={g} onClick={() => setPartnerGender(g)}
                  className={['py-4 rounded-xl border-2 font-medium text-sm transition-all',
                    partnerGender === g ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-600 hover:border-slate-300',
                  ].join(' ')}>
                  {g === 'MALE' ? '♂ Male' : '♀ Female'}
                </button>
              ))}
            </div>
            <button onClick={handleGenerateInvite} disabled={generating}
              className="w-full py-3.5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold text-sm">
              {generating ? 'Generating…' : 'Generate Invite Link'}
            </button>
          </div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-4">
            <div className="text-center">
              <div className="text-4xl mb-2">✅</div>
              <h2 className="font-bold text-slate-900 text-lg">Invite Ready!</h2>
              <p className="text-slate-500 text-sm">Pair ID: <span className="font-mono font-bold text-blue-600">{inviteResult.pairId}</span></p>
            </div>

            {/* Link display */}
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
              <p className="text-xs text-slate-500 mb-1">Invite Link</p>
              <p className="text-blue-600 text-xs font-mono break-all">{inviteResult.url}</p>
            </div>

            <button onClick={handleCopy}
              className={['w-full py-3 rounded-xl font-semibold text-sm transition-all',
                copied ? 'bg-green-600 text-white' : 'bg-slate-100 hover:bg-slate-200 text-slate-900',
              ].join(' ')}>
              {copied ? '✓ Copied!' : '📋 Copy Link'}
            </button>

            <button onClick={handleEnterRoom}
              className="w-full py-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-base transition-colors">
              🎙️ Enter Recording Room
            </button>

            <button onClick={() => setInviteResult(null)} className="w-full text-sm text-slate-400 hover:text-slate-600 py-2">
              Generate new link
            </button>
          </div>
        )}
      </main>
    </div>
  );

  // ── Recordings view ────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <header className="bg-white border-b border-slate-200 px-4 py-4">
        <div className="max-w-lg mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => setView('home')} className="text-slate-500 hover:text-slate-900 text-lg">←</button>
            <h1 className="text-lg font-bold text-slate-900">Previous Recordings</h1>
          </div>
          {recordings.length > 0 && (
            <button onClick={handleDownloadAll} disabled={downloadingAll}
              className="text-sm bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg font-medium disabled:opacity-50">
              {downloadingAll ? '…' : '📦 All'}
            </button>
          )}
        </div>
      </header>

      <main className="flex-1 p-4 max-w-lg mx-auto w-full">
        {loadingRecs ? (
          <div className="flex justify-center pt-12">
            <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : recordings.length === 0 ? (
          <div className="text-center pt-16 text-slate-400">
            <div className="text-5xl mb-3">🎙️</div>
            <p className="font-medium">No recordings yet</p>
            <p className="text-sm mt-1">Start a session from the home page</p>
          </div>
        ) : (
          <div className="space-y-3 pt-2">
            {recordings.map((rec) => (
              <div key={rec.id} className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-xs font-semibold text-slate-800 break-all">{rec.fileName}</p>
                    <p className="text-[10px] text-slate-400 font-mono mt-0.5">ID: {rec.id}</p>
                    <p className="text-xs text-slate-500 mt-1">{formatDate(rec.createdAt)}</p>
                    <div className="flex flex-wrap gap-2 mt-2">
                      <span className="text-[11px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full font-medium">{rec.role}</span>
                      <span className="text-[11px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full font-medium">{rec.language}</span>
                      <span className="text-[11px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full font-medium">{formatDuration(rec.durationSec)}</span>
                    </div>
                    <p className="text-xs text-slate-400 mt-1.5">Partner: {rec.partnerName} ({rec.partnerGender})</p>
                  </div>
                  <div className="flex flex-col gap-2 shrink-0">
                    <button onClick={() => downloadRecordingPair(rec)}
                      className="text-xs bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg font-medium">
                      Download
                    </button>
                    <button onClick={() => handleDelete(rec.id)} disabled={deletingId === rec.id}
                      className="text-xs bg-red-50 hover:bg-red-100 text-red-600 px-3 py-1.5 rounded-lg font-medium border border-red-200 disabled:opacity-50">
                      {deletingId === rec.id ? '…' : 'Delete'}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

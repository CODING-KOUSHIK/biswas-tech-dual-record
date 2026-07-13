'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { loadProfile, clearProfile } from '@/lib/profile';
import { getDeviceId } from '@/lib/device';
import { getAllRecordings, deleteRecording, RecordingRecord, markRecordingAsUploaded } from '@/lib/db';
import { downloadRecordingPair, downloadAllRecordings, getIndividualFilenames } from '@/lib/zip';

type Gender = 'MALE' | 'FEMALE';
type View = 'home' | 'invite' | 'recordings';

function fmtDur(s: number) {
  const m = Math.floor(s / 60), sec = s % 60;
  return `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
}
function fmtDate(ts: number) {
  return new Date(ts).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
}

export default function HomePage() {
  const router = useRouter();
  const [view, setView] = useState<View>('home');
  const [profile, setProfile] = useState<ReturnType<typeof loadProfile>>(null);
  const [deviceId, setDeviceId] = useState('');
  const [partnerGender, setPartnerGender] = useState<Gender>('FEMALE');
  const [generating, setGenerating] = useState(false);
  const [inviteResult, setInviteResult] = useState<{ url: string; pairId: string; roomId: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [recordings, setRecordings] = useState<RecordingRecord[]>([]);
  const [loadingRecs, setLoadingRecs] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [downloadingAll, setDownloadingAll] = useState(false);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    const p = loadProfile();
    if (!p) { router.replace('/setup'); return; }
    setProfile(p);
    setDeviceId(getDeviceId());
    navigator.mediaDevices.getUserMedia({ audio: true })
      .then(s => s.getTracks().forEach(t => t.stop()))
      .catch(() => alert("Microphone permission is required."));
  }, [router]);

  useEffect(() => {
    if (view === 'recordings') {
      setLoadingRecs(true);
      getAllRecordings().then(r => { setRecordings(r); setLoadingRecs(false); });
    }
  }, [view]);

  const handleUploadToDrive = async (rec: RecordingRecord) => {
    const scriptUrl = process.env.NEXT_PUBLIC_GOOGLE_APPS_SCRIPT_URL || "https://script.google.com/macros/s/AKfycbzVi_ocA-WRgWpN5RFv26JX3doyYTYAh8eMCq6gK8RcYq8rNnkzk2_gaUV3mEOX5ow3/exec";
    try {
      setUploadingId(rec.id); setUploadProgress(0);
      const { hostName, guestName, hostBlob, guestBlob } = getIndividualFilenames(rec);
      const toB64 = (b: Blob): Promise<string> => new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res((r.result as string).split(',')[1]);
        r.onerror = () => rej(new Error("Read fail"));
        r.readAsDataURL(b);
      });
      const [hb, gb] = await Promise.all([toB64(hostBlob), toB64(guestBlob)]);
      const payload = JSON.stringify({ files: [
        { filename: hostName, mimeType: 'audio/wav', base64: hb },
        { filename: guestName, mimeType: 'audio/wav', base64: gb }
      ]});
      const xhr = new XMLHttpRequest();
      xhr.open('POST', scriptUrl, true);
      xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.upload.onprogress = (e) => { if (e.lengthComputable) setUploadProgress(Math.round((e.loaded / e.total) * 100)); };
      xhr.onload = async () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try { const r = JSON.parse(xhr.responseText); if (r.success) { await markRecordingAsUploaded(rec.id); const recs = await getAllRecordings(); setRecordings(recs); alert("Uploaded!"); } else alert(`Failed: ${r.error}`); }
          catch { await markRecordingAsUploaded(rec.id); const recs = await getAllRecordings(); setRecordings(recs); alert("Upload sent!"); }
        } else alert(`Failed: ${xhr.status}`);
        setUploadingId(null);
      };
      xhr.onerror = () => { alert("Network error."); setUploadingId(null); };
      xhr.send(payload);
    } catch (err) { alert("Error: " + String(err)); setUploadingId(null); }
  };

  const handleGenerateInvite = async () => {
    if (!profile || generating) return;
    setGenerating(true); setInviteResult(null);
    try {
      const res = await fetch('/api/invite/create', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hostDeviceId: deviceId, hostName: profile.name, hostLanguage: profile.language, hostGender: profile.gender, partnerGender }) });
      const d = await res.json();
      if (d.success) setInviteResult({ url: d.inviteUrl, pairId: d.pairId, roomId: d.roomId });
      else alert('Failed: ' + d.error);
    } catch { alert('Network error.'); } finally { setGenerating(false); }
  };

  const handleCopy = async () => {
    if (!inviteResult) return;
    try { await navigator.clipboard.writeText(inviteResult.url); } catch {}
    setCopied(true); setTimeout(() => setCopied(false), 3000);
  };

  const handleEnterRoom = () => {
    if (!inviteResult) return;
    router.push(`/room/${encodeURIComponent(inviteResult.roomId)}?role=HOST&pairId=${inviteResult.pairId}`);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this recording?')) return;
    setDeletingId(id); await deleteRecording(id);
    setRecordings(p => p.filter(r => r.id !== id)); setDeletingId(null);
  };

  const handleDownloadAll = async () => {
    if (recordings.length === 0) return;
    setDownloadingAll(true); await downloadAllRecordings(recordings).catch(console.error); setDownloadingAll(false);
  };

  const handleReset = () => {
    if (!confirm('Delete ALL recordings and reset profile? This cannot be undone.')) return;
    setResetting(true);
    // Clear everything synchronously and redirect immediately
    try { localStorage.clear(); sessionStorage.clear(); } catch {}
    try { document.cookie.split(";").forEach(c => { document.cookie = c.replace(/^ +/, "").replace(/=.*/, "=;expires=" + new Date().toUTCString() + ";path=/"); }); } catch {}
    // Delete IndexedDB in background — don't wait for it
    try { indexedDB.deleteDatabase('btd-recordings'); } catch {}
    router.replace('/setup');
  };

  if (!profile) return (
    <div className="min-h-screen flex items-center justify-center bg-[#0f172a]">
      <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  // ── HOME ──
  if (view === 'home') return (
    <div className="min-h-screen flex flex-col bg-[#0f172a]">
      <header className="bg-[#0f172a]/90 backdrop-blur-md border-b border-white/[0.06] px-5 py-4 sticky top-0 z-10">
        <div className="max-w-lg mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-[17px] font-bold text-white tracking-tight">Biswas Tech</h1>
            <p className="text-[11px] text-slate-500 mt-0.5">{profile.name} · {profile.language}</p>
          </div>
          <button onClick={handleReset} disabled={resetting}
            className="text-[11px] text-slate-500 hover:text-red-400 border border-slate-700 hover:border-red-500/30 rounded-lg px-3 py-1.5 font-medium transition-colors active:scale-95">
            {resetting ? '…' : 'Reset'}
          </button>
        </div>
      </header>

      <main className="flex-1 flex flex-col justify-center px-5 py-8 gap-4 max-w-lg mx-auto w-full fade-in">
        <button onClick={() => { setView('invite'); setInviteResult(null); }}
          className="w-full rounded-2xl p-5 text-left active:scale-[0.97] transition-transform"
          style={{ background: 'linear-gradient(135deg, #4f46e5, #7c3aed)', boxShadow: '0 8px 32px rgba(79, 70, 229, 0.35)' }}>
          <p className="text-2xl mb-3">🔗</p>
          <h2 className="text-lg font-bold text-white">Invite Partner</h2>
          <p className="text-indigo-200 text-[13px] mt-1">Generate a meeting link to record together</p>
        </button>

        <button onClick={() => setView('recordings')}
          className="w-full bg-[#1e293b] border border-white/[0.06] rounded-2xl p-5 text-left active:scale-[0.97] transition-transform">
          <p className="text-2xl mb-3">🎙️</p>
          <h2 className="text-lg font-bold text-white">Previous Recordings</h2>
          <p className="text-slate-500 text-[13px] mt-1">View and download saved recordings</p>
        </button>

        <button onClick={() => { setView('recordings'); setTimeout(() => handleDownloadAll(), 300); }}
          className="w-full bg-[#1e293b] border border-white/[0.06] rounded-2xl p-5 text-left active:scale-[0.97] transition-transform">
          <p className="text-2xl mb-3">📦</p>
          <h2 className="text-lg font-bold text-white">Download All</h2>
          <p className="text-slate-500 text-[13px] mt-1">Download all recordings as ZIP</p>
        </button>
      </main>
    </div>
  );

  // ── INVITE ──
  if (view === 'invite') return (
    <div className="min-h-screen flex flex-col bg-[#0f172a]">
      <header className="bg-[#0f172a]/90 backdrop-blur-md border-b border-white/[0.06] px-5 py-4 sticky top-0 z-10">
        <div className="max-w-lg mx-auto flex items-center gap-3">
          <button onClick={() => setView('home')} className="w-8 h-8 bg-slate-800 hover:bg-slate-700 rounded-lg flex items-center justify-center text-slate-400 text-sm">←</button>
          <h1 className="text-[17px] font-bold text-white">Invite Partner</h1>
        </div>
      </header>

      <main className="flex-1 px-5 py-6 max-w-lg mx-auto w-full fade-in">
        {!inviteResult ? (
          <div className="bg-[#1e293b] border border-white/[0.06] rounded-2xl p-6 space-y-6">
            <div>
              <h2 className="text-base font-semibold text-white">Partner&apos;s Gender</h2>
              <p className="text-[13px] text-slate-500 mt-1">Used for file naming</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {(['MALE', 'FEMALE'] as Gender[]).map(g => (
                <button key={g} onClick={() => setPartnerGender(g)}
                  className={`py-3.5 rounded-xl text-[14px] font-semibold transition-all active:scale-95 ${
                    partnerGender === g
                      ? 'bg-gradient-to-r from-indigo-600 to-purple-600 text-white shadow-lg shadow-indigo-500/25'
                      : 'border-2 border-slate-700 text-slate-400 hover:border-slate-600'
                  }`}>
                  {g === 'MALE' ? '♂ Male' : '♀ Female'}
                </button>
              ))}
            </div>
            <button onClick={handleGenerateInvite} disabled={generating}
              className="w-full py-3.5 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 text-white font-semibold text-[15px] disabled:opacity-50 active:scale-[0.97] transition-transform shadow-lg shadow-indigo-500/25">
              {generating ? 'Generating…' : 'Generate Invite Link'}
            </button>
          </div>
        ) : (
          <div className="bg-[#1e293b] border border-white/[0.06] rounded-2xl p-6 space-y-5">
            <div className="text-center">
              <div className="w-14 h-14 rounded-full mx-auto mb-3 bg-green-500/10 flex items-center justify-center text-xl">✅</div>
              <h2 className="text-lg font-bold text-white">Invite Ready!</h2>
              <p className="text-[13px] text-slate-400 mt-1">Pair: <span className="font-mono font-bold text-indigo-400">{inviteResult.pairId}</span></p>
            </div>

            <div className="bg-slate-800/60 border border-white/[0.06] rounded-xl p-4">
              <p className="text-[11px] text-slate-500 mb-1.5">Invite Link</p>
              <p className="text-[12px] font-mono text-indigo-400 break-all leading-relaxed">{inviteResult.url}</p>
            </div>

            <button onClick={handleCopy}
              className={`w-full py-3 rounded-xl font-semibold text-[14px] transition-all active:scale-[0.97] ${
                copied ? 'bg-green-600 text-white' : 'bg-slate-800 border border-white/[0.06] text-white hover:bg-slate-700'
              }`}>
              {copied ? '✓ Copied!' : '📋 Copy Link'}
            </button>

            <button onClick={handleEnterRoom}
              className="w-full py-4 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 text-white font-bold text-[16px] active:scale-[0.97] transition-transform shadow-lg shadow-indigo-500/25">
              🎙️ Enter Recording Room
            </button>

            <button onClick={() => setInviteResult(null)} className="w-full text-[13px] text-slate-500 hover:text-slate-400 py-2 text-center">
              Generate new link
            </button>
          </div>
        )}
      </main>
    </div>
  );

  // ── RECORDINGS ──
  return (
    <div className="min-h-screen flex flex-col bg-[#0f172a]">
      <header className="bg-[#0f172a]/90 backdrop-blur-md border-b border-white/[0.06] px-5 py-4 sticky top-0 z-10">
        <div className="max-w-lg mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => setView('home')} className="w-8 h-8 bg-slate-800 hover:bg-slate-700 rounded-lg flex items-center justify-center text-slate-400 text-sm">←</button>
            <h1 className="text-[17px] font-bold text-white">Recordings</h1>
          </div>
          {recordings.length > 0 && (
            <button onClick={handleDownloadAll} disabled={downloadingAll}
              className="text-[12px] bg-indigo-600 hover:bg-indigo-700 text-white px-3.5 py-2 rounded-lg font-semibold disabled:opacity-50 active:scale-95 transition-transform">
              {downloadingAll ? '…' : '📦 All'}
            </button>
          )}
        </div>
      </header>

      <main className="flex-1 px-5 py-4 max-w-lg mx-auto w-full fade-in">
        {loadingRecs ? (
          <div className="flex justify-center pt-20">
            <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : recordings.length === 0 ? (
          <div className="text-center pt-24">
            <div className="w-20 h-20 rounded-full mx-auto mb-5 bg-slate-800 flex items-center justify-center text-3xl">🎙️</div>
            <p className="font-semibold text-white text-[15px]">No recordings yet</p>
            <p className="text-[13px] text-slate-500 mt-1.5">Start a session from the home page</p>
          </div>
        ) : (
          <div className="space-y-3 pt-1">
            {recordings.map(rec => (
              <div key={rec.id} className="bg-[#1e293b] border border-white/[0.06] rounded-xl p-4">
                <p className="font-mono text-[11px] font-medium text-slate-300 break-all leading-relaxed">{rec.fileName}</p>
                <p className="text-[11px] text-slate-600 mt-1">{fmtDate(rec.createdAt)}</p>
                <div className="flex flex-wrap gap-1.5 mt-2.5">
                  <span className="text-[10px] bg-slate-800 text-slate-400 px-2 py-0.5 rounded-full font-medium">{rec.role}</span>
                  <span className="text-[10px] bg-slate-800 text-slate-400 px-2 py-0.5 rounded-full font-medium">{rec.language}</span>
                  <span className="text-[10px] bg-slate-800 text-slate-400 px-2 py-0.5 rounded-full font-medium">{fmtDur(rec.durationSec)}</span>
                  {rec.role === 'HOST' && rec.uploaded && (
                    <span className="text-[10px] bg-green-500/10 text-green-400 px-2 py-0.5 rounded-full font-medium">✓ Uploaded</span>
                  )}
                </div>
                <p className="text-[11px] text-slate-600 mt-2">Partner: {rec.partnerName}</p>
                <div className="flex gap-2 mt-3 flex-wrap">
                  <button onClick={() => downloadRecordingPair(rec)}
                    className="text-[11px] bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-lg font-semibold active:scale-95 transition-transform">
                    Download ZIP
                  </button>
                  {rec.role === 'HOST' && !rec.uploaded && (
                    uploadingId === rec.id ? (
                      <div className="flex items-center gap-2">
                        <div className="progress-bar w-16"><div className="progress-fill" style={{ width: `${uploadProgress}%` }} /></div>
                        <span className="text-[10px] text-indigo-400">{uploadProgress}%</span>
                      </div>
                    ) : (
                      <button onClick={() => handleUploadToDrive(rec)}
                        className="text-[11px] bg-slate-800 hover:bg-slate-700 text-slate-300 border border-white/[0.06] px-3 py-1.5 rounded-lg font-medium active:scale-95 transition-transform">
                        Upload
                      </button>
                    )
                  )}
                  <button onClick={() => handleDelete(rec.id)} disabled={deletingId === rec.id}
                    className="text-[11px] bg-red-500/10 text-red-400 px-3 py-1.5 rounded-lg font-medium disabled:opacity-40 active:scale-95 transition-transform">
                    {deletingId === rec.id ? '…' : 'Delete'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

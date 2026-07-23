'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { loadProfile } from '@/lib/profile';
import { getDeviceId } from '@/lib/device';
import { getAllRecordings, deleteRecording, markRecordingAsUploaded, RecordingRecord } from '@/lib/db';
import JSZip from 'jszip';

type Gender = 'MALE' | 'FEMALE';
type View = 'home' | 'invite' | 'recordings';

function fmtDur(s: number) {
  const m = Math.floor(s / 60), sec = s % 60;
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}
function fmtDate(ts: number) {
  return new Date(ts).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function HomePage() {
  const router = useRouter();
  const [view, setView] = useState<View>('home');

  const shareNative = async (rec: RecordingRecord) => {
    if (isProcessing) return;
    try {
      if (navigator.share) {
        setIsProcessing(true);
        setSharingId(rec.id);
        
        // Step 1: Force download to device first (instant from memory)
        downloadSingleBlob(rec.blob, rec.fileName);
        
        // Step 2: Artificial delay so user sees the "Downloading..." animation
        await new Promise(resolve => setTimeout(resolve, 1500));

        const file = new File([rec.blob], rec.fileName, { type: 'audio/wav' });
        await navigator.share({
          files: [file],
          title: rec.fileName,
        });
      } else {
        alert('Native sharing is not supported on this browser.');
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') console.error('Share failed:', err);
    } finally {
      setIsProcessing(false);
      setSharingId(null);
    }
  };

  const navigateToView = (newView: View) => {
    setView(newView);
    window.history.pushState({ view: newView }, '', `#${newView}`);
  };

  useEffect(() => {
    const handlePopState = (e: PopStateEvent) => {
      if (e.state && e.state.view) {
        setView(e.state.view);
      } else {
        setView('home');
      }
    };
    // Initialize base history state
    window.history.replaceState({ view: 'home' }, '', '#home');
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);
  const [profile, setProfile] = useState<ReturnType<typeof loadProfile>>(null);
  const [deviceId, setDeviceId] = useState('');
  const [partnerGender, setPartnerGender] = useState<Gender>('FEMALE');
  const [isProcessing, setIsProcessing] = useState(false);
  const [sharingId, setSharingId] = useState<string | null>(null);
  const [isZipping, setIsZipping] = useState(false);
  const [zipProgress, setZipProgress] = useState(0);
  const [generating, setGenerating] = useState(false);
  const [inviteResult, setInviteResult] = useState<{ url: string; pairId: string; roomId: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [recordings, setRecordings] = useState<RecordingRecord[]>([]);
  const [loadingRecs, setLoadingRecs] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
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



  const handleGenerateInvite = async () => {
    if (!profile || generating) return;
    setGenerating(true); setInviteResult(null);
    try {
      const res = await fetch('/api/invite/create', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hostDeviceId: deviceId, hostName: profile.name, hostLanguage: profile.language, hostGender: profile.gender, partnerGender })
      });
      const d = await res.json();
      if (d.success) setInviteResult({ url: d.inviteUrl, pairId: d.pairId, roomId: d.roomId });
      else alert('Failed: ' + d.error);
    } catch { alert('Network error.'); } finally { setGenerating(false); }
  };

  const handleCopy = async () => {
    if (!inviteResult) return;
    try { await navigator.clipboard.writeText(inviteResult.url); } catch { }
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

  const downloadSingleBlob = (blob: Blob, fileName: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 5000);
  };

  const downloadAllZip = async () => {
    if (recordings.length === 0 || isProcessing) return;
    setIsProcessing(true);
    setIsZipping(true);
    setZipProgress(0);

    try {
      const zip = new JSZip();
      recordings.forEach((rec) => {
        zip.file(rec.fileName, rec.blob);
      });

      const zipBlob = await zip.generateAsync({ type: 'blob' }, (metadata) => {
        setZipProgress(Math.floor(metadata.percent));
      });

      downloadSingleBlob(zipBlob, `BiswasTech_Recordings_${Date.now()}.zip`);
    } catch (err) {
      console.error('Failed to create ZIP:', err);
      alert('Failed to create ZIP file.');
    } finally {
      setIsZipping(false);
      setIsProcessing(false);
      setZipProgress(0);
    }
  };

  const handleDownloadWav = (rec: RecordingRecord) => {
    downloadSingleBlob(rec.blob, rec.fileName);
  };



  const handleReset = () => {
    if (!confirm('Delete ALL recordings and reset profile? This cannot be undone.')) return;
    setResetting(true);
    // Clear everything synchronously and redirect immediately
    try { localStorage.clear(); sessionStorage.clear(); } catch { }
    try { document.cookie.split(";").forEach(c => { document.cookie = c.replace(/^ +/, "").replace(/=.*/, "=;expires=" + new Date().toUTCString() + ";path=/"); }); } catch { }
    // Delete IndexedDB in background — don't wait for it
    try { indexedDB.deleteDatabase('btd-recordings'); } catch { }
    router.replace('/setup');
  };

  if (!profile) return (
    <div className="min-h-screen flex items-center justify-center bg-[#0f172a]">
      <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );  // ── HOME ──
  if (view === 'home') return (
    <div className="min-h-screen flex flex-col bg-[#0f172a] text-white">
      <header className="bg-[#0f172a]/95 backdrop-blur-md border-b border-white/[0.06] px-5 py-4 sticky top-0 z-10">
        <div className="max-w-lg mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-[18px] font-bold tracking-tight">Biswas Tech</h1>
            <p className="text-[12px] text-slate-500 mt-0.5">{profile.name} · {profile.language}</p>
          </div>
          <button onClick={handleReset} disabled={resetting}
            className="text-[12px] text-slate-400 hover:text-red-400 border border-slate-700 hover:border-red-500/30 rounded-xl px-4 py-2 font-semibold transition-colors active:scale-95">
            {resetting ? '…' : 'Reset'}
          </button>
        </div>
      </header>

      <main className="flex-1 flex flex-col justify-center px-6 py-10 gap-5 max-w-lg mx-auto w-full fade-in">
        {/* Invite Partner Card */}
        <button onClick={() => { navigateToView('invite'); setInviteResult(null); }}
          className="w-full rounded-2xl p-6 text-left active:scale-[0.98] transition-all flex flex-col justify-between h-36"
          style={{ background: 'linear-gradient(135deg, #4f46e5, #7c3aed)', boxShadow: '0 8px 32px rgba(79, 70, 229, 0.25)' }}>
          <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center text-xl">🔗</div>
          <div>
            <h2 className="text-xl font-extrabold text-white">Invite Partner</h2>
            <p className="text-indigo-100 text-[13px] mt-1 font-medium">Generate a dual-session recording room link</p>
          </div>
        </button>

        {/* Previous Recordings Card */}
        <button onClick={() => navigateToView('recordings')}
          className="w-full bg-[#1e293b] border border-white/[0.06] rounded-2xl p-6 text-left active:scale-[0.98] transition-all flex flex-col justify-between h-36">
          <div className="w-10 h-10 bg-slate-800 rounded-xl flex items-center justify-center text-xl">🎙️</div>
          <div>
            <h2 className="text-xl font-extrabold text-white">Previous Recordings</h2>
            <p className="text-slate-400 text-[13px] mt-1 font-medium">View and download your localized wav files</p>
          </div>
        </button>


      </main>
    </div>
  );

  // ── INVITE ──
  if (view === 'invite') return (
    <div className="min-h-screen flex flex-col bg-[#0f172a] text-white">
      <header className="bg-[#0f172a]/90 backdrop-blur-md border-b border-white/[0.06] px-5 py-4.5 sticky top-0 z-10">
        <div className="max-w-lg mx-auto flex items-center gap-3">
          <button onClick={() => window.history.back()} className="w-10 h-10 bg-slate-800 hover:bg-slate-700 rounded-xl flex items-center justify-center text-slate-350 text-base font-bold active:scale-95 transition-transform">←</button>
          <h1 className="text-[18px] font-bold">Invite Partner</h1>
        </div>
      </header>

      <main className="flex-1 px-6 py-8 max-w-lg mx-auto w-full fade-in flex flex-col justify-center">
        {!inviteResult ? (
          <div className="bg-[#1e293b] border border-white/[0.06] rounded-2xl p-6 space-y-6">
            <div>
              <h2 className="text-[17px] font-bold text-white">Partner&apos;s Gender</h2>
              <p className="text-[13px] text-slate-400 mt-1">Used automatically for file metadata and sequence naming</p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              {(['MALE', 'FEMALE'] as Gender[]).map(g => (
                <button key={g} onClick={() => setPartnerGender(g)}
                  className={`h-14 rounded-2xl text-[15px] font-bold tracking-wide transition-all active:scale-95 ${partnerGender === g
                      ? 'bg-gradient-to-r from-indigo-600 to-purple-600 text-white shadow-lg shadow-indigo-500/25 border-transparent'
                      : 'border-2 border-slate-700 text-slate-400 hover:border-slate-650'
                    }`}>
                  {g === 'MALE' ? '♂ Male' : '♀ Female'}
                </button>
              ))}
            </div>
            <button onClick={handleGenerateInvite} disabled={generating}
              className="w-full h-14 rounded-2xl bg-gradient-to-r from-indigo-600 to-purple-600 text-white font-extrabold text-[15px] tracking-wide disabled:opacity-50 active:scale-[0.98] transition-all shadow-lg shadow-indigo-500/25 flex items-center justify-center gap-2">
              {generating ? (
                <><span className="w-5 h-5 border-3 border-white/40 border-t-white rounded-full animate-spin" />Generating Link…</>
              ) : 'Generate Invite Link'}
            </button>
          </div>
        ) : (
          <div className="bg-[#1e293b] border border-white/[0.06] rounded-2xl p-6 space-y-6">
            <div className="text-center">
              <div className="w-16 h-16 rounded-full mx-auto mb-4 bg-green-500/10 flex items-center justify-center text-2xl">✅</div>
              <h2 className="text-xl font-extrabold text-white">Invite Link Created</h2>
              <p className="text-[14px] text-slate-400 mt-1">Pair ID: <span className="font-mono font-bold text-indigo-400">{inviteResult.pairId}</span></p>
            </div>

            <div className="bg-slate-800/60 border border-white/[0.06] rounded-2xl p-4">
              <p className="text-[11px] text-slate-500 font-semibold mb-1">Room Access Url</p>
              <p className="text-[13px] font-mono text-indigo-300 break-all leading-relaxed">{inviteResult.url}</p>
            </div>

            <div className="space-y-3">
              <button onClick={handleCopy}
                className={`w-full h-14 rounded-2xl font-bold text-[14px] transition-all active:scale-[0.98] ${copied ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-500/20' : 'bg-slate-800 border border-white/[0.06] text-white hover:bg-slate-700'
                  }`}>
                {copied ? '✓ Link Copied to Clipboard!' : '📋 Copy Invite Link'}
              </button>

              <button onClick={handleEnterRoom}
                className="w-full h-15 rounded-2xl bg-gradient-to-r from-indigo-600 to-purple-600 text-white font-extrabold text-[16px] active:scale-[0.98] transition-all shadow-lg shadow-indigo-500/20">
                🎙️ Enter Recording Room
              </button>
            </div>

            <button onClick={() => setInviteResult(null)} className="w-full text-[13px] text-slate-500 hover:text-slate-300 font-medium py-2 text-center">
              Create New Invite Link
            </button>
          </div>
        )}
      </main>
    </div>
  );

  // ── RECORDINGS ──
  return (
    <div className="min-h-screen flex flex-col bg-[#0f172a] text-white">
      <header className="bg-[#0f172a]/90 backdrop-blur-md border-b border-white/[0.06] px-5 py-4 sticky top-0 z-10">
        <div className="max-w-lg mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => window.history.back()} className="w-10 h-10 bg-slate-800 hover:bg-slate-700 rounded-xl flex items-center justify-center text-slate-400 text-base font-bold active:scale-95 transition-transform">←</button>
            <h1 className="text-[18px] font-bold">Recordings</h1>
          </div>

        </div>
      </header>

      <main className="flex-1 px-5 py-6 max-w-lg mx-auto w-full fade-in">
        {loadingRecs ? (
          <div className="flex justify-center pt-20">
            <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : recordings.length === 0 ? (
          <div className="text-center pt-24">
            <div className="w-20 h-20 rounded-full mx-auto mb-5 bg-slate-800 flex items-center justify-center text-3xl">🎙️</div>
            <p className="font-semibold text-white text-[16px]">No recordings yet</p>
            <p className="text-[13px] text-slate-500 mt-1.5">Start a session from the home page</p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-[14px] font-bold text-slate-450">All Your Recordings</h2>
              <button onClick={downloadAllZip} disabled={isProcessing}
                className={`px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-white rounded-lg font-bold text-[11px] active:scale-95 transition-all flex items-center gap-1.5 ${isProcessing ? 'opacity-50' : ''}`}>
                {isZipping ? `⏳ Zipping ${zipProgress}%` : '📦 Download All (ZIP)'}
              </button>
            </div>
            {recordings.map((rec, index) => {
              const recNumber = recordings.length - index;
              return (
                <div key={rec.id + rec.createdAt} className="bg-[#1e293b] border border-white/[0.06] rounded-2xl p-4.5 space-y-3.5">
                  <div className="flex items-center justify-between">
                    <p className="text-[13px] font-bold text-white flex-1 mr-3">Recording {recNumber}</p>
                    <span className="text-[10px] bg-slate-850 text-slate-450 px-2 py-0.5 rounded-md font-semibold shrink-0">{rec.durationSec}s</span>
                  </div>
                  <p className="text-[10px] font-mono text-slate-500 break-all leading-relaxed">{rec.fileName}</p>
                  
                  <div className="flex flex-wrap gap-2">
                    <span className="text-[10px] bg-slate-800/80 text-slate-400 px-2.5 py-1 rounded-md font-semibold">{rec.role}</span>
                    <span className="text-[10px] bg-slate-800/80 text-slate-400 px-2.5 py-1 rounded-md font-semibold">{rec.language}</span>
                    <span className="text-[10px] bg-slate-800/80 text-slate-400 px-2.5 py-1 rounded-md font-semibold">{fmtDate(rec.createdAt)}</span>
                  </div>
                  <p className="text-[11px] text-slate-500">Partner: {rec.partnerName}</p>

                  <div className="grid grid-cols-2 gap-2.5 w-full pt-1.5">
                    <button onClick={() => handleDownloadWav(rec)} disabled={isProcessing}
                      className={`col-span-2 h-12 bg-gradient-to-r from-indigo-500 to-indigo-600 hover:from-indigo-600 hover:to-indigo-700 text-white rounded-[14px] font-extrabold text-[14px] shadow-lg shadow-indigo-500/25 active:scale-95 transition-all flex items-center justify-center gap-2 ${isProcessing ? 'opacity-50' : ''}`}>
                      <span className="text-[16px]">📥</span> Download WAV
                    </button>

                    <button onClick={() => shareNative(rec)} disabled={isProcessing}
                      className={`h-12 bg-[#24A1DE]/15 hover:bg-[#24A1DE]/25 text-[#24A1DE] border border-[#24A1DE]/20 rounded-[14px] font-bold text-[13px] active:scale-95 transition-all flex items-center justify-center gap-1.5 shadow-sm ${isProcessing ? 'opacity-50' : ''}`}>
                      {sharingId === rec.id ? (
                        <><span className="w-4 h-4 border-2 border-[#24A1DE]/30 border-t-[#24A1DE] rounded-full animate-spin" /> Downloading...</>
                      ) : (
                        <><span className="text-[15px]">📤</span> Share</>
                      )}
                    </button>
                    
                    <button onClick={() => handleDelete(rec.id)} disabled={isProcessing}
                      className={`h-12 bg-red-500/15 hover:bg-red-500/25 text-red-500 border border-red-500/20 rounded-[14px] font-bold text-[13px] active:scale-95 transition-all flex items-center justify-center gap-1.5 shadow-sm ${isProcessing ? 'opacity-50' : ''}`}>
                      <span className="text-[15px]">🗑️</span> {deletingId === rec.id ? '…' : 'Delete'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

      </main>
    </div>
  );
}

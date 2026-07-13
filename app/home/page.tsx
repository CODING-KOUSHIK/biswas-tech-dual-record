'use client';
// app/home/page.tsx — Main home page with 3 views: home, invite, recordings

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { loadProfile, clearProfile } from '@/lib/profile';
import { getDeviceId } from '@/lib/device';
import { getAllRecordings, deleteRecording, RecordingRecord, markRecordingAsUploaded } from '@/lib/db';
import { downloadRecordingPair, downloadAllRecordings, getIndividualFilenames, getRecordingZipBlob } from '@/lib/zip';

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

  const driveLink = process.env.NEXT_PUBLIC_GOOGLE_DRIVE_LINK;
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number>(0);

  useEffect(() => {
    const p = loadProfile();
    if (!p) { router.replace('/setup'); return; }
    setProfile(p);
    setDeviceId(getDeviceId());

    // Prompt for microphone permission on landing
    navigator.mediaDevices.getUserMedia({ audio: true })
      .then((stream) => {
        stream.getTracks().forEach((track) => track.stop());
      })
      .catch(() => {
        alert("Microphone permission is required to use this application. Please allow microphone access in your browser settings to continue.");
      });
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

  const handleUploadToDrive = async (rec: RecordingRecord) => {
    const scriptUrl = process.env.NEXT_PUBLIC_GOOGLE_APPS_SCRIPT_URL || "https://script.google.com/macros/s/AKfycbzVi_ocA-WRgWpN5RFv26JX3doyYTYAh8eMCq6gK8RcYq8rNnkzk2_gaUV3mEOX5ow3/exec";

    try {
      setUploadingId(rec.id);
      setUploadProgress(0);

      const { hostName, guestName, hostBlob, guestBlob } = getIndividualFilenames(rec);

      const toBase64 = (blob: Blob): Promise<string> => {
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve((reader.result as string).split(',')[1]);
          reader.onerror = () => reject(new Error("Failed to read file"));
          reader.readAsDataURL(blob);
        });
      };

      const [hostBase64, guestBase64] = await Promise.all([
        toBase64(hostBlob),
        toBase64(guestBlob)
      ]);

      const payload = JSON.stringify({
        files: [
          { filename: hostName, mimeType: 'audio/wav', base64: hostBase64 },
          { filename: guestName, mimeType: 'audio/wav', base64: guestBase64 }
        ]
      });

      const xhr = new XMLHttpRequest();
      xhr.open('POST', scriptUrl, true);
      xhr.setRequestHeader('Content-Type', 'application/json');

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          const percent = Math.round((e.loaded / e.total) * 100);
          setUploadProgress(percent);
        }
      };

      xhr.onload = async () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const res = JSON.parse(xhr.responseText);
            if (res.success) {
              await markRecordingAsUploaded(rec.id);
              const recs = await getAllRecordings();
              setRecordings(recs);
              alert("Audio files uploaded successfully to Google Drive!");
            } else {
              alert(`Upload failed: ${res.error || 'Unknown error'}`);
            }
          } catch {
            await markRecordingAsUploaded(rec.id);
            const recs = await getAllRecordings();
            setRecordings(recs);
            alert("Audio files upload request sent to Google Drive!");
          }
        } else {
          alert(`Upload failed with server status: ${xhr.status}`);
        }
        setUploadingId(null);
      };

      xhr.onerror = () => {
        alert("Network error occurred during upload.");
        setUploadingId(null);
      };

      xhr.send(payload);

    } catch (err) {
      alert("Error preparing files for upload: " + String(err));
      setUploadingId(null);
    }
  };

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

  const handleResetAppData = async () => {
    if (!confirm('WARNING: Are you sure you want to delete all recordings and reset all profile settings? This cannot be undone.')) {
      return;
    }

    try {
      const req = indexedDB.deleteDatabase('btd-recordings');
      await new Promise<void>((resolve, reject) => {
        req.onsuccess = () => resolve();
        req.onerror = () => reject(new Error('IndexedDB deletion failed'));
        req.onblocked = () => resolve();
      });

      localStorage.clear();
      sessionStorage.clear();

      document.cookie.split(";").forEach((c) => {
        document.cookie = c
          .replace(/^ +/, "")
          .replace(/=.*/, "=;expires=" + new Date().toUTCString() + ";path=/");
      });

      alert('App reset successful. Redirecting to setup...');
      router.replace('/setup');
    } catch (err) {
      alert('Error during reset: ' + String(err));
    }
  };

  if (!profile) return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--bg-primary)' }}>
      <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  // ── Home view ──────────────────────────────────────────────────────────────
  if (view === 'home') return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--bg-primary)' }}>
      {/* Header */}
      <header className="glass-header px-4 py-4">
        <div className="max-w-lg mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-white">Biswas Tech</h1>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{profile.name} · {profile.language}</p>
          </div>
          <button onClick={handleResetAppData}
            className="btn-ghost text-xs">
            Reset
          </button>
        </div>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center p-5 gap-4 max-w-lg mx-auto w-full fade-in">
        {/* Card 1: Invite Partner */}
        <button onClick={() => { setView('invite'); setInviteResult(null); }}
          className="w-full rounded-2xl p-6 text-left transition-all active:scale-[0.97]"
          style={{ background: 'var(--accent-gradient)', boxShadow: '0 8px 30px rgba(59, 130, 246, 0.25)' }}>
          <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center text-xl mb-4">🔗</div>
          <h2 className="text-xl font-bold text-white">Invite Partner</h2>
          <p className="text-white/60 text-sm mt-1">Generate a meeting link to record with a partner</p>
        </button>

        {/* Card 2: Previous Recordings */}
        <button onClick={() => setView('recordings')}
          className="w-full glass-card p-6 text-left transition-all active:scale-[0.97]">
          <div className="w-12 h-12 rounded-xl flex items-center justify-center text-xl mb-4" style={{ background: 'var(--bg-elevated)' }}>🎙️</div>
          <h2 className="text-xl font-bold text-white">Previous Recordings</h2>
          <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>View and download your saved recordings</p>
        </button>

        {/* Card 3: Download All */}
        <button onClick={() => { setView('recordings'); setTimeout(() => handleDownloadAll(), 300); }}
          className="w-full glass-card p-6 text-left transition-all active:scale-[0.97]">
          <div className="w-12 h-12 rounded-xl flex items-center justify-center text-xl mb-4" style={{ background: 'var(--bg-elevated)' }}>📦</div>
          <h2 className="text-xl font-bold text-white">Download All Files</h2>
          <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>Download all recordings in one ZIP file</p>
        </button>
      </main>
    </div>
  );

  // ── Invite view ────────────────────────────────────────────────────────────
  if (view === 'invite') return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--bg-primary)' }}>
      <header className="glass-header px-4 py-4">
        <div className="max-w-lg mx-auto flex items-center gap-3">
          <button onClick={() => setView('home')} className="text-white/60 hover:text-white text-lg w-8 h-8 flex items-center justify-center rounded-lg" style={{ background: 'var(--bg-elevated)' }}>←</button>
          <h1 className="text-lg font-bold text-white">Invite Partner</h1>
        </div>
      </header>

      <main className="flex-1 p-5 max-w-lg mx-auto w-full space-y-4 pt-6 fade-in">
        {!inviteResult ? (
          <div className="glass-card p-6 space-y-6">
            <div>
              <h2 className="font-semibold text-white text-lg">Partner&apos;s Gender</h2>
              <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>Used for recording file naming</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {(['MALE', 'FEMALE'] as Gender[]).map((g) => (
                <button key={g} onClick={() => setPartnerGender(g)}
                  className={`gender-toggle ${partnerGender === g ? 'active' : ''}`}>
                  {g === 'MALE' ? '♂ Male' : '♀ Female'}
                </button>
              ))}
            </div>
            <button onClick={handleGenerateInvite} disabled={generating}
              className="btn btn-primary w-full text-base disabled:opacity-50">
              {generating ? (
                <>
                  <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                  Generating…
                </>
              ) : 'Generate Invite Link'}
            </button>
          </div>
        ) : (
          <div className="glass-card p-6 space-y-5">
            <div className="text-center">
              <div className="w-16 h-16 rounded-full mx-auto mb-3 flex items-center justify-center text-2xl" style={{ background: 'var(--success-soft)' }}>✅</div>
              <h2 className="font-bold text-white text-lg">Invite Ready!</h2>
              <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
                Pair ID: <span className="font-mono font-bold gradient-text">{inviteResult.pairId}</span>
              </p>
            </div>

            {/* Link display */}
            <div className="rounded-xl p-4" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}>
              <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Invite Link</p>
              <p className="text-xs font-mono break-all" style={{ color: 'var(--accent-blue)' }}>{inviteResult.url}</p>
            </div>

            <button onClick={handleCopy}
              className={`btn w-full text-sm ${copied ? 'btn-primary' : 'btn-secondary'}`}>
              {copied ? '✓ Copied!' : '📋 Copy Link'}
            </button>

            <button onClick={handleEnterRoom}
              className="btn btn-primary w-full text-base font-bold" style={{ minHeight: '56px' }}>
              🎙️ Enter Recording Room
            </button>

            <button onClick={() => setInviteResult(null)}
              className="w-full text-sm py-2 text-center" style={{ color: 'var(--text-muted)' }}>
              Generate new link
            </button>
          </div>
        )}
      </main>
    </div>
  );

  // ── Recordings view ────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--bg-primary)' }}>
      <header className="glass-header px-4 py-4">
        <div className="max-w-lg mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => setView('home')} className="text-white/60 hover:text-white text-lg w-8 h-8 flex items-center justify-center rounded-lg" style={{ background: 'var(--bg-elevated)' }}>←</button>
            <h1 className="text-lg font-bold text-white">Recordings</h1>
          </div>
          {recordings.length > 0 && (
            <button onClick={handleDownloadAll} disabled={downloadingAll}
              className="btn btn-primary btn-sm disabled:opacity-50">
              {downloadingAll ? '…' : '📦 All'}
            </button>
          )}
        </div>
      </header>

      <main className="flex-1 p-4 max-w-lg mx-auto w-full fade-in">
        {loadingRecs ? (
          <div className="flex justify-center pt-16">
            <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : recordings.length === 0 ? (
          <div className="text-center pt-20">
            <div className="w-20 h-20 rounded-full mx-auto mb-4 flex items-center justify-center text-3xl" style={{ background: 'var(--bg-elevated)' }}>🎙️</div>
            <p className="font-semibold text-white">No recordings yet</p>
            <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>Start a session from the home page</p>
          </div>
        ) : (
          <div className="space-y-3 pt-2">
            {recordings.map((rec) => (
              <div key={rec.id} className="glass-card-solid p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-xs font-semibold text-white/90 break-all leading-relaxed">{rec.fileName}</p>
                    <p className="text-xs mt-1.5" style={{ color: 'var(--text-muted)' }}>{formatDate(rec.createdAt)}</p>
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      <span className="badge badge-muted">{rec.role}</span>
                      <span className="badge badge-muted">{rec.language}</span>
                      <span className="badge badge-muted">{formatDuration(rec.durationSec)}</span>
                      {rec.role === 'HOST' && rec.uploaded && (
                        <span className="badge badge-success">✓ Uploaded</span>
                      )}
                    </div>
                    <p className="text-xs mt-2" style={{ color: 'var(--text-muted)' }}>Partner: {rec.partnerName} ({rec.partnerGender})</p>
                  </div>
                  <div className="flex flex-col gap-1.5 shrink-0">
                    {rec.role === 'HOST' ? (
                      <>
                        <button onClick={() => downloadRecordingPair(rec)}
                          className="btn btn-primary btn-xs">
                          Download ZIP
                        </button>
                        {!rec.uploaded && (
                          uploadingId === rec.id ? (
                            <div>
                              <div className="progress-bar w-full mb-1">
                                <div className="progress-fill" style={{ width: `${uploadProgress}%` }} />
                              </div>
                              <p className="text-[10px] text-center" style={{ color: 'var(--accent-blue)' }}>{uploadProgress}%</p>
                            </div>
                          ) : (
                            <button onClick={() => handleUploadToDrive(rec)}
                              className="btn btn-secondary btn-xs">
                              Upload Drive
                            </button>
                          )
                        )}
                      </>
                    ) : (
                      <button onClick={() => downloadRecordingPair(rec)}
                        className="btn btn-primary btn-xs">
                        Download ZIP
                      </button>
                    )}
                    <button onClick={() => handleDelete(rec.id)} disabled={deletingId === rec.id}
                      className="btn btn-xs disabled:opacity-50" style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}>
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

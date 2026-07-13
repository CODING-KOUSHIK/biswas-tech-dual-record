'use client';
// components/room/RecordingRoom.tsx
// Core room component with single-mic capture, Host/Guest sync, and WhatsApp sharing

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Room,
  RoomEvent,
  RoomOptions,
  LocalParticipant,
  RemoteParticipant,
  Participant,
  ConnectionQuality,
  Track,
  DisconnectReason,
  RemoteTrack,
} from 'livekit-client';
import { encodeWav, mergeChunks, downsampleBuffer } from '@/lib/wav';
import { saveRecording, buildRecordingId, buildFileName, getRecordingSequence, getAllRecordings, RecordingRecord, markRecordingAsUploaded } from '@/lib/db';
import { downloadRecordingPair, getIndividualFilenames, getRecordingZipBlob } from '@/lib/zip';
import { useWakeLock } from '@/hooks/useWakeLock';
import JSZip from 'jszip';

interface Session {
  myName: string;
  myGender: string;
  myDeviceId: string;
  myLanguage: string;
  partnerName: string;
  partnerGender: string;
  role: 'HOST' | 'GUEST';
  pairId: string;
}

interface Props {
  roomId: string;
  livekitToken: string;
  livekitUrl: string;
  session: Session;
}

type ConnState = 'connecting' | 'waiting' | 'ready' | 'recording' | 'stopping' | 'done' | 'disconnected' | 'error';
type Signal = 'excellent' | 'good' | 'poor' | 'unknown';

interface AudioCapture {
  ctx: AudioContext;
  localChunks: Float32Array[];
  remoteChunks: Float32Array[];
  localProc: ScriptProcessorNode;
  remoteProc?: ScriptProcessorNode;
  startTime: number;
}

export function RecordingRoom({ roomId, livekitToken, livekitUrl, session }: Props) {
  const router = useRouter();
  const { acquire: acquireWakeLock, release: releaseWakeLock } = useWakeLock();
  const driveLink = process.env.NEXT_PUBLIC_GOOGLE_DRIVE_LINK;

  const roomRef = useRef<Room | null>(null);
  const captureRef = useRef<AudioCapture | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const connectedRef = useRef(false);
  const partnerDeviceIdRef = useRef<string>('unknown');
  const isLocalStreamFallbackRef = useRef<boolean>(false);
  const playCtxRef = useRef<AudioContext | null>(null);

  const [connState, setConnState] = useState<ConnState>('connecting');
  const [errorMsg, setErrorMsg] = useState('');
  const [partnerConnected, setPartnerConnected] = useState(false);
  const [partnerName, setPartnerName] = useState(session.partnerName);
  const [mySignal, setMySignal] = useState<Signal>('unknown');

  // Debounced speak state variables
  const [iAmSpeaking, setIAmSpeaking] = useState(false);
  const [partnerSpeaking, setPartnerSpeaking] = useState(false);
  const localSpeechTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const partnerSpeechTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [recSeconds, setRecSeconds] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [recCount, setRecCount] = useState(0);

  // Saved recordings in the current session
  const [currentRecordings, setCurrentRecordings] = useState<RecordingRecord[]>([]);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number>(0);

  // ─── STALE CLOSURE PREVENTION REFS ───────────────────────────────────────
  const startRecordingRef = useRef<() => Promise<void>>(async () => {});
  const stopRecordingRef = useRef<() => Promise<void>>(async () => {});
  const setConnStateRef = useRef(setConnState);

  // ─── DATA CHANNEL SEND HELPER ───────────────────────────────────────────
  const sendData = useCallback(async (msg: { type: string }) => {
    const room = roomRef.current;
    if (!room) return;
    try {
      const payload = new TextEncoder().encode(JSON.stringify(msg));
      await room.localParticipant.publishData(payload, { reliable: true });
      console.log('[Room] Sent sync data:', msg.type);
    } catch (e) {
      console.error('[Room] Failed to publish sync data:', e);
    }
  }, []);

  // ─── START RECORDING ──────────────────────────────────────────────────────
  const startRecording = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;

    try {
      // 1. Get mic track from LiveKit to avoid opening the mic twice (prevents clicks/"bod bod" sound)
      let localMicTrack: MediaStreamTrack | null = null;
      let isFallback = false;

      for (const pub of room.localParticipant.trackPublications.values()) {
        if (pub.kind === Track.Kind.Audio && pub.track && pub.track.mediaStreamTrack) {
          localMicTrack = pub.track.mediaStreamTrack;
          break;
        }
      }

      // Fallback only if LiveKit mic is not found (should not happen)
      if (!localMicTrack) {
        console.warn('[Room] LiveKit local mic track not found. Using fallback getUserMedia.');
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: false },
        });
        localMicTrack = stream.getAudioTracks()[0];
        isFallback = true;
      }

      isLocalStreamFallbackRef.current = isFallback;
      const localStream = new MediaStream([localMicTrack]);
      localStreamRef.current = localStream;

      const ctx = new AudioContext(); // Use native hardware sample rate to avoid resampler clicking noises
      const localChunks: Float32Array[] = [];
      const remoteChunks: Float32Array[] = [];
      const bufSize = 4096;

      // Connect script processors to a silent gain node to prevent speaker feedback loop
      const silence = ctx.createGain();
      silence.gain.value = 0;
      silence.connect(ctx.destination);

      // Local mic capture
      const localSrc = ctx.createMediaStreamSource(localStream);
      const localProc = ctx.createScriptProcessor(bufSize, 1, 1);
      localProc.onaudioprocess = (e) => localChunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
      localSrc.connect(localProc);
      localProc.connect(silence);

      // Remote partner audio from LiveKit
      let remoteProc: ScriptProcessorNode | undefined;
      const remotes = Array.from(room.remoteParticipants.values());
      if (remotes.length > 0) {
        for (const pub of remotes[0].trackPublications.values()) {
          if (pub.kind === Track.Kind.Audio && pub.track) {
            const remoteSrc = ctx.createMediaStreamSource(new MediaStream([pub.track.mediaStreamTrack]));
            remoteProc = ctx.createScriptProcessor(bufSize, 1, 1);
            remoteProc.onaudioprocess = (e) => remoteChunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
            remoteSrc.connect(remoteProc);
            remoteProc.connect(silence);
            break;
          }
        }
      }

      captureRef.current = { ctx, localChunks, remoteChunks, localProc, remoteProc, startTime: Date.now() };
      setRecSeconds(0);
      timerRef.current = setInterval(() => setRecSeconds((s) => s + 1), 1000);
      setConnState('recording');
      await acquireWakeLock();

      // Host notifies guest to start
      if (session.role === 'HOST') {
        await sendData({ type: 'START_REC' });
      }
    } catch (err) {
      alert('Could not start recording: ' + (err instanceof Error ? err.message : String(err)));
    }
  }, [acquireWakeLock, session.role, sendData]);

  // ─── STOP RECORDING ───────────────────────────────────────────────────────
  const stopRecording = useCallback(async () => {
    const cap = captureRef.current;
    if (!cap) return;

    setConnState('stopping');
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    await releaseWakeLock();

    cap.localProc.disconnect();
    cap.remoteProc?.disconnect();
    await cap.ctx.close();

    // CRITICAL: Only stop fallback stream tracks. Keep LiveKit mic track active for voice call.
    if (isLocalStreamFallbackRef.current) {
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
    }
    localStreamRef.current = null;
    captureRef.current = null;

    const durationSec = Math.round((Date.now() - cap.startTime) / 1000);
    const nativeSampleRate = cap.ctx.sampleRate;

    const localMerged = mergeChunks(cap.localChunks);
    const localWav = encodeWav(localMerged, nativeSampleRate);

    const remoteWav = cap.remoteChunks.length > 0
      ? encodeWav(mergeChunks(cap.remoteChunks), nativeSampleRate)
      : new Blob([], { type: 'audio/wav' });

    // Calculate dynamic sequence naming and build output filenames
    const { pairSeq, recSeq } = await getRecordingSequence(session.pairId);
    const fileName = buildFileName(session.myDeviceId, session.myLanguage, session.myGender, session.role, pairSeq, recSeq, session.myName);
    const id = `${session.pairId}_${session.role}_${recSeq}`; // unique id for multiple recordings in same pair

    await saveRecording({
      id,
      pairId: session.pairId,
      deviceId: session.myDeviceId,
      role: session.role,
      language: session.myLanguage,
      gender: session.myGender,
      partnerName,
      partnerGender: session.partnerGender,
      partnerDeviceId: partnerDeviceIdRef.current,
      durationSec,
      createdAt: Date.now(),
      fileName,
      localBlob: localWav,
      remoteBlob: remoteWav,
    });

    setRecCount((c) => c + 1);
    setConnState('done');

    // Host notifies guest to stop
    if (session.role === 'HOST') {
      await sendData({ type: 'STOP_REC' });
    }
  }, [session, partnerName, releaseWakeLock, sendData]);

  // Keep callback refs updated to prevent stale closures
  useEffect(() => {
    startRecordingRef.current = startRecording;
    stopRecordingRef.current = stopRecording;
    setConnStateRef.current = setConnState;
  }, [startRecording, stopRecording]);

  // Load recordings in current session on load or update
  useEffect(() => {
    getAllRecordings().then((recs) => {
      const filtered = recs.filter((r) => r.pairId === session.pairId);
      setCurrentRecordings(filtered);
    });
  }, [session.pairId, recCount]);

  // ─── CONNECT (runs exactly once per token/url) ────────────────────────────
  useEffect(() => {
    if (connectedRef.current) return;
    connectedRef.current = true;

    const options: RoomOptions = {
      adaptiveStream: true,
      dynacast: true,
      audioCaptureDefaults: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: false, // Prevents phone from boosting distant room noise
      },
    };

    const room = new Room(options);
    roomRef.current = room;

    const updatePartners = () => {
      const remotes = Array.from(room.remoteParticipants.values());
      const has = remotes.length > 0;

      if (has) {
        const p = remotes[0];
        const parts = p.identity.split('_');
        const remoteDeviceId = parts[0];
        const remoteRole = parts[1];
        partnerDeviceIdRef.current = remoteDeviceId;

        // Host device binding validation
        if (session.role === 'HOST' && remoteRole === 'GUEST') {
          const boundKey = `btd_bound_guest_${session.pairId}`;
          const existingBoundId = localStorage.getItem(boundKey);
          if (!existingBoundId) {
            localStorage.setItem(boundKey, remoteDeviceId);
          } else if (existingBoundId !== remoteDeviceId) {
            console.warn('[Room] Rejecting connection: different partner device', remoteDeviceId);
            setConnStateRef.current('error');
            setErrorMsg('Access denied. This invite link has already been used by another device.');
            room.disconnect();
            return;
          }
        }

        try {
          const meta = JSON.parse(p.metadata ?? '{}') as { name?: string };
          setPartnerName(meta.name ?? p.identity ?? session.partnerName);
        } catch {
          setPartnerName(p.identity ?? session.partnerName);
        }
      }

      setPartnerConnected(has);
      setConnStateRef.current((cur) => {
        if (cur === 'recording' || cur === 'stopping' || cur === 'done' || cur === 'error') return cur;
        return has ? 'ready' : 'waiting';
      });
    };

    room
      .on(RoomEvent.Connected, () => {
        console.log('[Room] Connected ✓', roomId);
        setConnStateRef.current('waiting');
        updatePartners();
      })
      .on(RoomEvent.Disconnected, (reason?: DisconnectReason) => {
        if (reason === DisconnectReason.CLIENT_INITIATED) return;
        console.log('[Room] Disconnected', reason);
        setConnStateRef.current('disconnected');
        setErrorMsg('Disconnected. Check your internet connection.');
      })
      .on(RoomEvent.Reconnecting, () => setConnStateRef.current('connecting'))
      .on(RoomEvent.Reconnected, () => updatePartners())
      .on(RoomEvent.ParticipantConnected, (p: RemoteParticipant) => {
        console.log('[Room] Partner joined:', p.identity);
        updatePartners();
      })
      .on(RoomEvent.ParticipantDisconnected, () => updatePartners())
      .on(RoomEvent.ConnectionQualityChanged, (q: ConnectionQuality, p: Participant) => {
        if (p instanceof LocalParticipant) {
          setMySignal(q === ConnectionQuality.Excellent ? 'excellent' : q === ConnectionQuality.Good ? 'good' : 'poor');
        }
      })
      .on(RoomEvent.ActiveSpeakersChanged, (speakers: Participant[]) => {
        const isLocalActive = speakers.some((s) => s instanceof LocalParticipant);
        const isRemoteActive = speakers.some((s) => s instanceof RemoteParticipant);

        // --- Local Indicator (Debounced by 10s silent window) ---
        if (isLocalActive) {
          if (localSpeechTimeoutRef.current) {
            clearTimeout(localSpeechTimeoutRef.current);
            localSpeechTimeoutRef.current = null;
          }
          setIAmSpeaking(true);
        } else {
          if (!localSpeechTimeoutRef.current) {
            localSpeechTimeoutRef.current = setTimeout(() => {
              setIAmSpeaking(false);
              localSpeechTimeoutRef.current = null;
            }, 10000);
          }
        }

        // --- Partner Indicator (Debounced by 10s silent window) ---
        if (isRemoteActive) {
          if (partnerSpeechTimeoutRef.current) {
            clearTimeout(partnerSpeechTimeoutRef.current);
            partnerSpeechTimeoutRef.current = null;
          }
          setPartnerSpeaking(true);
        } else {
          if (!partnerSpeechTimeoutRef.current) {
            partnerSpeechTimeoutRef.current = setTimeout(() => {
              setPartnerSpeaking(false);
              partnerSpeechTimeoutRef.current = null;
            }, 10000);
          }
        }
      })
      .on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
        // PLAY incoming remote audio tracks in browser speakers
        if (track.kind === Track.Kind.Audio) {
          const element = track.attach();
          document.body.appendChild(element);
          console.log('[Room] Playing remote audio track');
        }
      })
      .on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
        if (track.kind === Track.Kind.Audio) {
          track.detach().forEach((el: HTMLElement) => el.remove());
        }
      })
      .on(RoomEvent.DataReceived, (payload: Uint8Array) => {
        try {
          const text = new TextDecoder().decode(payload);
          const msg = JSON.parse(text);
          console.log('[Room] Data channel event:', msg.type);

          if (msg.type === 'START_REC') {
            startRecordingRef.current();
          } else if (msg.type === 'STOP_REC') {
            stopRecordingRef.current();
          } else if (msg.type === 'NEW_SESSION') {
            setConnStateRef.current('ready');
          }
        } catch (e) {
          console.error('[Room] Failed parsing sync message:', e);
        }
      });

    console.log('[Room] Connecting to', livekitUrl, '| room:', roomId);
    room.connect(livekitUrl, livekitToken, { autoSubscribe: true })
      .then(async () => {
        // Automatically publish microphone audio track
        try {
          await room.localParticipant.setMicrophoneEnabled(true);
          console.log('[Room] Local microphone published');
        } catch (micErr) {
          console.error('[Room] Failed to publish microphone:', micErr);
        }
      })
      .catch((err: Error) => {
        console.error('[Room] Connection failed:', err);
        setConnStateRef.current('error');
        setErrorMsg(`Connection failed: ${err.message}`);
      });

    return () => {
      console.log('[Room] Unmount — disconnecting');
      room.disconnect();
      // Remove any leftover audio tags
      document.querySelectorAll('audio').forEach((el) => el.remove());
      if (playCtxRef.current) {
        playCtxRef.current.close().catch(() => {});
        playCtxRef.current = null;
      }
      if (localSpeechTimeoutRef.current) clearTimeout(localSpeechTimeoutRef.current);
      if (partnerSpeechTimeoutRef.current) clearTimeout(partnerSpeechTimeoutRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── LEAVE WARNING ────────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      return (e.returnValue = 'Refreshing will disconnect you from the recording session. Are you sure you want to leave?');
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);

  const fmtTime = (s: number) => `${String(Math.floor(s/3600)).padStart(2,'0')}:${String(Math.floor((s%3600)/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;
  const sigLabel = { excellent: '● Excellent', good: '● Good', poor: '● Weak', unknown: '○ --' }[mySignal];
  const sigColor = { excellent: 'text-green-600', good: 'text-blue-600', poor: 'text-yellow-600', unknown: 'text-slate-400' }[mySignal];

  const handleStartNewSession = () => {
    setConnState('ready');
    sendData({ type: 'NEW_SESSION' });
  };

  // ─── WHATSAPP SHARE ZIP HELPER ───────────────────────────────────────────
  const shareFile = (rec: RecordingRecord) => {
    const text = `Hi, I have completed the recording for Pair ${rec.pairId}.\n\n` +
      `File: ${rec.fileName}\n` +
      `Duration: ${rec.durationSec}s\n` +
      `Language: ${rec.language}\n` +
      `Role: ${rec.role}\n` +
      `Device ID: ${rec.deviceId}\n` +
      `Gender: ${rec.gender}\n` +
      `Partner: ${rec.partnerName}`;

    window.open(`https://api.whatsapp.com/send?phone=919093847448&text=${encodeURIComponent(text)}`, '_blank');
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
              // Save to IndexedDB as uploaded
              await markRecordingAsUploaded(rec.id);
              // Force reload of recordings
              setRecCount((c) => c + 1);
              alert("Audio files uploaded successfully to Google Drive!");
            } else {
              alert(`Upload failed: ${res.error || 'Unknown error'}`);
            }
          } catch {
            // Apps Script redirects or empty responses can happen, but if status is 200, try to mark as uploaded
            await markRecordingAsUploaded(rec.id);
            setRecCount((c) => c + 1);
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

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--bg-primary)' }}>
      {/* Header */}
      <header className="glass-header px-4 py-3">
        <div className="max-w-lg mx-auto flex items-center justify-between">
          <div>
            <h1 className="font-bold text-white text-base">Biswas Tech</h1>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="font-mono text-xs px-2 py-0.5 rounded-md" style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}>
                {session.pairId}
              </span>
              <span className="badge badge-muted">{session.role}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className={`text-xs font-semibold ${sigColor}`}>{sigLabel}</span>
            <button onClick={() => {
              if (connState === 'recording' && !confirm('Recording in progress. Leave?')) return;
              roomRef.current?.disconnect();
              router.replace('/home');
            }} className="btn-ghost">
              Leave
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center p-5 max-w-lg mx-auto w-full gap-4 fade-in">

        {/* Connecting */}
        {connState === 'connecting' && (
          <div className="text-center">
            <div className="w-14 h-14 border-2 border-t-transparent rounded-full animate-spin mx-auto mb-4" style={{ borderColor: 'var(--accent-blue)', borderTopColor: 'transparent' }} />
            <p className="font-semibold text-white text-lg">Connecting to room…</p>
            <p className="text-sm mt-2" style={{ color: 'var(--text-muted)' }}>Please allow microphone access</p>
          </div>
        )}

        {/* Error */}
        {(connState === 'error' || connState === 'disconnected') && (
          <div className="text-center max-w-sm">
            <div className="w-16 h-16 rounded-full mx-auto mb-4 flex items-center justify-center text-2xl" style={{ background: connState === 'error' ? 'var(--danger-soft)' : 'var(--bg-elevated)' }}>
              {connState === 'error' ? '⚠️' : '🔌'}
            </div>
            <h2 className="font-bold text-white text-lg mb-2">{connState === 'error' ? 'Connection Failed' : 'Disconnected'}</h2>
            <p className="text-sm mb-5" style={{ color: 'var(--text-muted)' }}>{errorMsg}</p>
            <button onClick={() => router.replace('/home')} className="btn btn-primary">Go Home</button>
          </div>
        )}

        {/* Room UI */}
        {['waiting', 'ready', 'recording', 'stopping', 'done'].includes(connState) && (
          <>
            {/* Participant cards */}
            <div className="grid grid-cols-2 gap-3 w-full">
              {/* Me */}
              <div className="glass-card p-4 text-center">
                <div className={`w-16 h-16 rounded-full mx-auto mb-3 flex items-center justify-center text-2xl transition-all ${iAmSpeaking ? 'speak-pulse' : ''}`}
                  style={{ background: iAmSpeaking ? 'linear-gradient(135deg, rgba(59,130,246,0.3), rgba(139,92,246,0.3))' : 'var(--bg-elevated)' }}>
                  🎙️
                </div>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>You</p>
                <p className="font-bold text-white text-sm truncate mt-0.5">{session.myName}</p>
                <div className="flex items-center justify-center gap-1 mt-1.5">
                  <span className="w-2 h-2 rounded-full" style={{ background: 'var(--success)' }} />
                  <span className="text-xs font-medium" style={{ color: 'var(--success)' }}>Connected</span>
                </div>
              </div>

              {/* Partner */}
              <div className={`glass-card p-4 text-center ${!partnerConnected ? 'opacity-60' : ''}`} style={{ borderStyle: partnerConnected ? 'solid' : 'dashed' }}>
                <div className={`w-16 h-16 rounded-full mx-auto mb-3 flex items-center justify-center text-2xl transition-all ${partnerSpeaking && partnerConnected ? 'speak-pulse' : ''}`}
                  style={{ background: partnerSpeaking && partnerConnected ? 'linear-gradient(135deg, rgba(59,130,246,0.3), rgba(139,92,246,0.3))' : 'var(--bg-elevated)' }}>
                  {partnerConnected ? '🎙️' : '⏳'}
                </div>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Partner</p>
                <p className="font-bold text-white text-sm truncate mt-0.5">{partnerName}</p>
                <div className="flex items-center justify-center gap-1 mt-1.5">
                  <span className="w-2 h-2 rounded-full" style={{ background: partnerConnected ? 'var(--success)' : 'var(--text-muted)' }} />
                  <span className="text-xs font-medium" style={{ color: partnerConnected ? 'var(--success)' : 'var(--text-muted)' }}>
                    {partnerConnected ? 'Connected' : 'Waiting…'}
                  </span>
                </div>
              </div>
            </div>

            {/* Status: Waiting */}
            {connState === 'waiting' && (
              <div className="w-full glass-card p-4 text-center">
                <p className="font-medium text-sm" style={{ color: 'var(--accent-blue)' }}>Waiting for partner to connect…</p>
                <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>Share the invite link with your partner</p>
              </div>
            )}

            {/* Status: Done */}
            {connState === 'done' && (
              <div className="w-full rounded-xl p-4 text-center" style={{ background: 'var(--success-soft)', border: '1px solid rgba(34, 197, 94, 0.2)' }}>
                <p className="font-semibold" style={{ color: 'var(--success)' }}>✓ Recording #{recCount} saved!</p>
                {session.role === 'GUEST' ? (
                  <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>Waiting for host to start new recording…</p>
                ) : (
                  <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>You can start another recording without reconnecting</p>
                )}
              </div>
            )}

            {/* Timer */}
            {connState === 'recording' && (
              <div className="w-full glass-card p-6 text-center rec-glow">
                <div className="flex items-center justify-center gap-2 mb-2">
                  <span className="w-3 h-3 rounded-full rec-blink" style={{ background: 'var(--danger)' }} />
                  <span className="font-semibold text-sm uppercase tracking-wider" style={{ color: 'var(--danger)' }}>
                    {session.role === 'HOST' ? 'Recording' : 'Recording (Host Control)'}
                  </span>
                </div>
                <p className="font-mono text-5xl font-bold text-white tracking-wider mb-3">{fmtTime(recSeconds)}</p>
                {/* Waveform bars */}
                <div className="wave-bars mx-auto">
                  <div className="wave-bar" />
                  <div className="wave-bar" />
                  <div className="wave-bar" />
                  <div className="wave-bar" />
                  <div className="wave-bar" />
                </div>
              </div>
            )}

            {/* Stopping */}
            {connState === 'stopping' && (
              <div className="w-full glass-card p-5 text-center">
                <div className="w-6 h-6 border-2 border-t-transparent rounded-full animate-spin mx-auto mb-2" style={{ borderColor: 'var(--text-secondary)', borderTopColor: 'transparent' }} />
                <p className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>Saving recording…</p>
              </div>
            )}

            {/* Action buttons (HOST controls all; GUEST wait states) */}
            {session.role === 'HOST' ? (
              <>
                {connState === 'ready' && (
                  <button onClick={startRecording}
                    className="btn btn-danger w-full text-lg font-bold" style={{ minHeight: '60px', boxShadow: '0 8px 30px rgba(239, 68, 68, 0.3)' }}>
                    ● Start Recording
                  </button>
                )}
                {connState === 'recording' && (
                  <button onClick={stopRecording}
                    className="btn btn-secondary w-full text-lg font-bold" style={{ minHeight: '60px', background: 'rgba(30, 41, 59, 0.8)', border: '2px solid var(--border-medium)' }}>
                    ■ Stop Recording
                  </button>
                )}
                {connState === 'done' && (
                  <button onClick={handleStartNewSession}
                    className="btn btn-primary w-full text-lg font-bold" style={{ minHeight: '60px' }}>
                    ● Start New Recording
                  </button>
                )}
              </>
            ) : (
              <>
                {connState === 'ready' && (
                  <div className="w-full glass-card p-4 text-center">
                    <p className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>⏳ Waiting for Host to start recording…</p>
                  </div>
                )}
              </>
            )}

            {/* Session Recordings List */}
            {currentRecordings.length > 0 && (
              <div className="w-full pt-4 mt-2 space-y-2" style={{ borderTop: '1px solid var(--border-subtle)' }}>
                <h3 className="font-semibold text-sm text-white/80">Session Recordings</h3>
                <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                  {currentRecordings.map((rec) => {
                    const { hostName, guestName, hostBlob, guestBlob } = getIndividualFilenames(rec);
                    const isUploading = uploadingId === rec.id;

                    return (
                      <div key={rec.id + rec.createdAt} className="glass-card-solid p-3 space-y-2">
                        <div className="flex items-center justify-between">
                          <p className="text-xs font-mono text-white/70 break-all leading-relaxed flex-1 mr-2">{rec.fileName}</p>
                          <span className="badge badge-muted shrink-0">{rec.durationSec}s</span>
                        </div>

                        {session.role === 'HOST' && rec.uploaded && (
                          <span className="badge badge-success">✓ Uploaded</span>
                        )}

                        <div className="flex gap-2 flex-wrap">
                          {session.role === 'HOST' ? (
                            <>
                              <button onClick={() => downloadRecordingPair(rec)}
                                className="btn btn-primary btn-xs">
                                Download ZIP
                              </button>
                              <button onClick={() => shareFile(rec)}
                                className="btn btn-xs" style={{ background: 'rgba(34, 197, 94, 0.15)', color: 'var(--success)' }}>
                                WhatsApp
                              </button>
                              {!rec.uploaded && (
                                isUploading ? (
                                  <div className="flex items-center gap-2">
                                    <div className="progress-bar w-16">
                                      <div className="progress-fill" style={{ width: `${uploadProgress}%` }} />
                                    </div>
                                    <span className="text-[10px]" style={{ color: 'var(--accent-blue)' }}>{uploadProgress}%</span>
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
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <p className="text-center text-xs" style={{ color: 'var(--text-muted)' }}>
              {session.myDeviceId} · {session.myLanguage} · {session.myGender}
            </p>
          </>
        )}
      </main>
    </div>
  );
}

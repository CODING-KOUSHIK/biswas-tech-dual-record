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
import { encodeWav, encodeStereoWav, mergeChunks, downsampleBuffer } from '@/lib/wav';
import { saveRecording, buildRecordingId, buildFileName, getRecordingSequence, getAllRecordings, markRecordingAsUploaded, RecordingRecord, deleteRecording } from '@/lib/db';
import JSZip from 'jszip';
import { useWakeLock } from '@/hooks/useWakeLock';

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
  const isLeavingRef = useRef(false);
  const audioCtxsRef = useRef<Map<string, AudioContext>>(new Map());

  const [connState, setConnState] = useState<ConnState>('connecting');
  const [errorMsg, setErrorMsg] = useState('');
  const [partnerConnected, setPartnerConnected] = useState(false);
  const [partnerName, setPartnerName] = useState(session.partnerName);
  const [partnerGender, setPartnerGender] = useState(session.partnerGender);
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
  const [allRecordings, setAllRecordings] = useState<RecordingRecord[]>([]);
  
  // Zipping state
  const [isZipping, setIsZipping] = useState(false);
  const [zipProgress, setZipProgress] = useState(0);

  // ─── STALE CLOSURE PREVENTION REFS ───────────────────────────────────────
  const startRecordingRef = useRef<() => Promise<void>>(async () => {});
  const stopRecordingRef = useRef<() => Promise<void>>(async () => {});
  const setConnStateRef = useRef(setConnState);

  // ─── DATA CHANNEL SEND HELPER ───────────────────────────────────────────
  const sendData = useCallback(async (msg: { type: string; [key: string]: any }) => {
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
    const remoteMerged = cap.remoteChunks.length > 0 ? mergeChunks(cap.remoteChunks) : new Float32Array(0);
    const stereoBlob = encodeStereoWav(localMerged, remoteMerged, nativeSampleRate);

    // Calculate dynamic sequence naming and build output filenames
    const { pairSeq, recSeq } = await getRecordingSequence(session.pairId);
    const fileName = buildFileName(
      session.myDeviceId, 
      session.myLanguage, 
      session.myGender, 
      session.role, 
      pairSeq, 
      recSeq, 
      session.myName, 
      session.pairId,
      partnerDeviceIdRef.current,
      partnerGender,
      partnerName
    );
    const id = `${session.pairId}_${session.role}_${recSeq}`; // unique id for multiple recordings in same pair

    await saveRecording({
      id,
      pairId: session.pairId,
      deviceId: session.myDeviceId,
      role: session.role,
      language: session.myLanguage,
      gender: session.myGender,
      partnerName,
      partnerGender,
      partnerDeviceId: partnerDeviceIdRef.current,
      durationSec,
      createdAt: Date.now(),
      fileName,
      blob: stereoBlob,
    });

    setRecCount((c) => c + 1);
    setConnState('done');

    // Host notifies guest to stop
    if (session.role === 'HOST') {
      await sendData({ type: 'STOP_REC' });
    }
  }, [session, partnerName, partnerGender, releaseWakeLock, sendData]);

  // Keep callback refs updated to prevent stale closures
  useEffect(() => {
    startRecordingRef.current = startRecording;
    stopRecordingRef.current = stopRecording;
    setConnStateRef.current = setConnState;
  }, [startRecording, stopRecording]);

  // Load recordings in current session on load or update
  useEffect(() => {
    getAllRecordings().then((recs) => {
      setAllRecordings(recs);
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
        sendData({ type: 'SYNC_INFO', gender: session.myGender });
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
          element.setAttribute('playsinline', 'true');
          element.setAttribute('webkit-playsinline', 'true');
          document.body.appendChild(element);
          console.log('[Room] Playing remote audio track');

          // Web Audio API routing to force loudspeaker output (media channel)
          try {
            const AudioCtxClass = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
            if (AudioCtxClass) {
              const audioCtx = new AudioCtxClass();
              const source = audioCtx.createMediaStreamSource(new MediaStream([track.mediaStreamTrack]));
              source.connect(audioCtx.destination);
              
              // Handle autoplay block
              if (audioCtx.state === 'suspended') {
                const resume = () => {
                  audioCtx.resume().catch(() => {});
                };
                window.addEventListener('click', resume, { once: true });
                window.addEventListener('touchstart', resume, { once: true });
              }
              const id = track.sid || track.mediaStreamTrack.id;
              audioCtxsRef.current.set(id, audioCtx);
            }
          } catch (err) {
            console.warn('[Room] Web Audio loudspeaker routing failed:', err);
          }
        }
      })
      .on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
        if (track.kind === Track.Kind.Audio) {
          track.detach().forEach((el: HTMLElement) => el.remove());
          const id = track.sid || track.mediaStreamTrack.id;
          const audioCtx = audioCtxsRef.current.get(id);
          if (audioCtx) {
            try {
              audioCtx.close();
            } catch {}
            audioCtxsRef.current.delete(id);
          }
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
          } else if (msg.type === 'SYNC_INFO' && msg.gender) {
            setPartnerGender(msg.gender);
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

    const currentCtxs = audioCtxsRef.current;
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

      // Clean up Web Audio loudspeaker contexts
      currentCtxs.forEach((ctx) => {
        try {
          ctx.close();
        } catch {}
      });
      currentCtxs.clear();
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

  // ─── PHONE BACK BUTTON INTERCEPTION ───────────────────────────────────────
  useEffect(() => {
    // Push extra state for back button interception
    window.history.pushState({ noBack: true }, '');

    const handlePopState = () => {
      if (isLeavingRef.current) return;
      const confirmLeave = window.confirm("Are you sure you want to leave the recording session?");
      if (confirmLeave) {
        isLeavingRef.current = true;
        roomRef.current?.disconnect();
        router.replace('/home');
      } else {
        // Restore the blocked state so back button interceptor remains active
        window.history.pushState({ noBack: true }, '');
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, [router]);

  // ─── MOUNT WAKE LOCK (SCREEN ALWAYS ON) ───────────────────────────────────
  useEffect(() => {
    acquireWakeLock();
    return () => {
      releaseWakeLock();
    };
  }, [acquireWakeLock, releaseWakeLock]);

  const fmtTime = (s: number) => `${String(Math.floor(s/3600)).padStart(2,'0')}:${String(Math.floor((s%3600)/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;
  const sigLabel = { excellent: '● Excellent', good: '● Good', poor: '● Weak', unknown: '○ --' }[mySignal];
  const sigColor = { excellent: 'text-green-600', good: 'text-blue-600', poor: 'text-yellow-600', unknown: 'text-slate-400' }[mySignal];

  const handleStartNewSession = () => {
    setConnState('ready');
    sendData({ type: 'NEW_SESSION' });
  };

  // ─── HANDLERS FOR DOWNLOAD, DELETE, SHARE & ZIP ─────────────────────────
  const handleDownloadWav = (rec: RecordingRecord) => {
    downloadSingleBlob(rec.blob, rec.fileName);
  };

  const handleDelete = async (rec: RecordingRecord) => {
    if (isZipping) return;
    const ok = window.confirm('Are you sure you want to permanently delete this recording?');
    if (!ok) return;
    await deleteRecording(rec.id);
    setRecCount((c) => c + 1); // trigger reload
  };

  const shareNative = async (rec: RecordingRecord) => {
    try {
      if (navigator.share) {
        const file = new File([rec.blob], rec.fileName, { type: 'audio/wav' });
        await navigator.share({
          files: [file],
          title: rec.fileName,
        });
      } else {
        alert('Native sharing is not supported on this browser. Please download the file manually.');
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        console.error('Share failed:', err);
      }
    }
  };

  const downloadAllZip = async () => {
    if (allRecordings.length === 0 || isZipping) return;
    setIsZipping(true);
    setZipProgress(0);

    try {
      const zip = new JSZip();
      allRecordings.forEach((rec) => {
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
      setZipProgress(0);
    }
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

  const renderRecording = (rec: RecordingRecord) => (
    <div key={rec.id + rec.createdAt} className="bg-[#1e293b] border border-white/[0.06] rounded-2xl p-4.5 space-y-3.5">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-mono text-slate-350 break-all leading-relaxed flex-1 mr-3">{rec.fileName}</p>
        <span className="text-[10px] bg-slate-850 text-slate-450 px-2 py-0.5 rounded-md font-semibold shrink-0">{rec.durationSec}s</span>
      </div>

      <div className="grid grid-cols-2 gap-2.5 w-full pt-1.5">
        <button onClick={() => handleDownloadWav(rec)} disabled={isZipping}
          className={`col-span-2 h-12 bg-gradient-to-r from-indigo-500 to-indigo-600 hover:from-indigo-600 hover:to-indigo-700 text-white rounded-[14px] font-extrabold text-[14px] shadow-lg shadow-indigo-500/25 active:scale-95 transition-all flex items-center justify-center gap-2 ${isZipping ? 'opacity-50' : ''}`}>
          <span className="text-[16px]">📥</span> Download WAV
        </button>

        <button onClick={() => shareNative(rec)} disabled={isZipping}
          className={`h-12 bg-[#24A1DE]/15 hover:bg-[#24A1DE]/25 text-[#24A1DE] border border-[#24A1DE]/20 rounded-[14px] font-bold text-[13px] active:scale-95 transition-all flex items-center justify-center gap-1.5 shadow-sm ${isZipping ? 'opacity-50' : ''}`}>
          <span className="text-[15px]">📤</span> Share
        </button>
        
        <button onClick={() => handleDelete(rec)} disabled={isZipping}
          className={`h-12 bg-red-500/15 hover:bg-red-500/25 text-red-500 border border-red-500/20 rounded-[14px] font-bold text-[13px] active:scale-95 transition-all flex items-center justify-center gap-1.5 shadow-sm ${isZipping ? 'opacity-50' : ''}`}>
          <span className="text-[15px]">🗑️</span> Delete
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen flex flex-col bg-[#0f172a]">
      {/* Header */}
      <header className="bg-[#0f172a]/90 backdrop-blur-md border-b border-white/[0.06] px-4 py-3.5 sticky top-0 z-10">
        <div className="max-w-lg mx-auto flex items-center justify-between">
          <div>
            <h1 className="font-bold text-white text-[16px] tracking-tight">Biswas Tech</h1>
            <div className="flex items-center gap-2 mt-1">
              <span className="font-mono text-[10px] bg-slate-800 text-slate-400 px-2 py-0.5 rounded">
                Pair: {session.pairId}
              </span>
              <span className="text-[10px] bg-indigo-500/10 text-indigo-400 px-2 py-0.5 rounded font-semibold">
                {session.role}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className={`text-[12px] font-semibold ${sigColor}`}>{sigLabel}</span>
            <button onClick={() => {
              if (confirm('Are you sure you want to leave the recording session?')) {
                isLeavingRef.current = true;
                roomRef.current?.disconnect();
                router.replace('/home');
              }
            }} className="text-[12px] text-slate-400 hover:text-red-400 border border-slate-700 hover:border-red-500/30 rounded-lg px-3 py-1.5 font-medium transition-colors active:scale-95">
              Leave
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 flex flex-col justify-center p-5 max-w-lg mx-auto w-full gap-5 fade-in">

        {/* Connecting */}
        {connState === 'connecting' && (
          <div className="text-center py-10">
            <div className="w-12 h-12 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <p className="font-semibold text-white text-[16px]">Connecting to room…</p>
            <p className="text-[13px] text-slate-500 mt-1.5">Please allow microphone access</p>
          </div>
        )}

        {/* Error */}
        {(connState === 'error' || connState === 'disconnected') && (
          <div className="text-center py-8 px-4 bg-[#1e293b] border border-white/[0.06] rounded-2xl max-w-sm mx-auto">
            <div className="w-14 h-14 rounded-full mx-auto mb-4 bg-red-500/10 flex items-center justify-center text-xl">
              {connState === 'error' ? '⚠️' : '🔌'}
            </div>
            <h2 className="font-bold text-white text-[16px] mb-2">{connState === 'error' ? 'Connection Failed' : 'Disconnected'}</h2>
            <p className="text-[13px] text-slate-400 mb-5 leading-relaxed">{errorMsg}</p>
            <button onClick={() => router.replace('/home')} 
              className="w-full py-3 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 text-white font-semibold text-[14px] active:scale-95 transition-transform">
              Go Home
            </button>
          </div>
        )}

        {/* Room UI */}
        {['waiting', 'ready', 'recording', 'stopping', 'done'].includes(connState) && (
          <>
            {/* Participant cards */}
            <div className="grid grid-cols-2 gap-3 w-full">
              {/* Me */}
              <div className="bg-[#1e293b] border border-white/[0.06] rounded-2xl p-4 text-center">
                <div className={`w-14 h-14 rounded-full mx-auto mb-3 flex items-center justify-center text-xl transition-all ${iAmSpeaking ? 'bg-indigo-500/20 speak-pulse ring-2 ring-indigo-500' : 'bg-slate-800'}`}>
                  🎙️
                </div>
                <p className="text-[11px] text-slate-500">You</p>
                <p className="font-bold text-white text-[14px] truncate mt-0.5">{session.myName}</p>
                <div className="flex items-center justify-center gap-1.5 mt-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  <span className="text-[11px] font-semibold text-emerald-400">Connected</span>
                </div>
              </div>

              {/* Partner */}
              <div className={`bg-[#1e293b] border rounded-2xl p-4 text-center transition-all ${partnerConnected ? 'border-white/[0.06]' : 'border-dashed border-slate-700 opacity-65'}`}>
                <div className={`w-14 h-14 rounded-full mx-auto mb-3 flex items-center justify-center text-xl transition-all ${partnerSpeaking && partnerConnected ? 'bg-indigo-500/20 speak-pulse ring-2 ring-indigo-500' : 'bg-slate-800'}`}>
                  {partnerConnected ? '🎙️' : '⏳'}
                </div>
                <p className="text-[11px] text-slate-500">Partner</p>
                <p className="font-bold text-white text-[14px] truncate mt-0.5">{partnerName || 'Waiting…'}</p>
                <div className="flex items-center justify-center gap-1.5 mt-2">
                  <span className={`w-1.5 h-1.5 rounded-full ${partnerConnected ? 'bg-emerald-500' : 'bg-slate-600'}`} />
                  <span className={`text-[11px] font-semibold ${partnerConnected ? 'text-emerald-400' : 'text-slate-500'}`}>
                    {partnerConnected ? 'Connected' : 'Waiting…'}
                  </span>
                </div>
              </div>
            </div>

            {/* Status: Waiting */}
            {connState === 'waiting' && (
              <div className="w-full bg-indigo-500/10 border border-indigo-500/20 rounded-xl p-4 text-center">
                <p className="font-semibold text-[13px] text-indigo-400">Waiting for partner to connect…</p>
                <p className="text-[11px] text-slate-500 mt-1">Share the invite link with your partner to start.</p>
              </div>
            )}

            {/* Status: Done */}
            {connState === 'done' && (
              <div className="w-full bg-emerald-500/10 border border-emerald-500/25 rounded-xl p-4 text-center">
                <p className="font-bold text-[14px] text-emerald-400">✓ Recording #{recCount} saved!</p>
                {session.role === 'GUEST' ? (
                  <p className="text-[11px] text-slate-500 mt-1">Waiting for host to start a new recording…</p>
                ) : (
                  <p className="text-[11px] text-slate-500 mt-1">You can start another recording right away.</p>
                )}
              </div>
            )}

            {/* Timer */}
            {connState === 'recording' && (
              <div className="w-full bg-[#1e293b] border border-red-500/20 rounded-2xl p-6 text-center rec-glow">
                <div className="flex items-center justify-center gap-2 mb-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-red-500 rec-blink" />
                  <span className="font-semibold text-[12px] uppercase tracking-wider text-red-500">
                    {session.role === 'HOST' ? 'Recording' : 'Recording (Host Control)'}
                  </span>
                </div>
                <p className="font-mono text-5xl font-bold text-white tracking-wider mb-4">{fmtTime(recSeconds)}</p>
                
                {/* Waveform Animation */}
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
              <div className="w-full bg-[#1e293b] border border-white/[0.06] rounded-xl p-5 text-center">
                <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto mb-2.5" />
                <p className="text-[13px] font-medium text-slate-400">Saving audio files securely…</p>
              </div>
            )}

            {/* Action buttons (HOST controls all; GUEST wait states) */}
            {session.role === 'HOST' ? (
              <div className="w-full">
                {connState === 'ready' && (
                  <button onClick={startRecording}
                    className="w-full h-14 rounded-2xl bg-gradient-to-r from-red-650 to-rose-650 hover:from-red-600 hover:to-rose-600 text-white font-extrabold text-[16px] tracking-wide active:scale-[0.98] transition-all shadow-lg shadow-red-600/20">
                    🔴 Start Recording
                  </button>
                )}
                {connState === 'recording' && (
                  <button onClick={stopRecording}
                    className="w-full h-14 rounded-2xl bg-slate-800 border border-slate-700 hover:bg-slate-750 text-white font-extrabold text-[16px] tracking-wide active:scale-[0.98] transition-all">
                    ⬛ Stop Recording
                  </button>
                )}
                {connState === 'done' && (
                  <button onClick={handleStartNewSession}
                    className="w-full h-14 rounded-2xl bg-gradient-to-r from-indigo-600 to-purple-600 text-white font-extrabold text-[16px] tracking-wide active:scale-[0.98] transition-all shadow-lg shadow-indigo-650/20">
                    🔴 Start New Recording
                  </button>
                )}
              </div>
            ) : (
              <div className="w-full">
                {connState === 'ready' && (
                  <div className="w-full bg-[#1e293b] border border-white/[0.06] rounded-2xl py-4.5 text-center">
                    <p className="text-[14px] font-bold text-slate-400">⏳ Waiting for Host to start recording…</p>
                  </div>
                )}
              </div>
            )}

            {/* Session Recordings List */}
            {currentRecordings.length > 0 && (
              <div className="w-full pt-4 mt-2 space-y-3.5" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                <h3 className="font-bold text-[14px] text-slate-450">Current Session Recordings</h3>
                <div className="space-y-3 max-h-60 overflow-y-auto pr-1">
                  {currentRecordings.map(renderRecording)}
                </div>
              </div>
            )}

            {/* Previous Recordings List */}
            {allRecordings.length > 0 && (
              <div className="w-full pt-4 mt-4 space-y-3.5" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-[14px] text-slate-450">All Recordings</h3>
                  <button onClick={downloadAllZip} disabled={isZipping}
                    className={`px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-white rounded-lg font-bold text-[11px] active:scale-95 transition-all flex items-center gap-1.5 ${isZipping ? 'opacity-50' : ''}`}>
                    {isZipping ? `⏳ Zipping ${zipProgress}%` : '📦 Download All (ZIP)'}
                  </button>
                </div>
                <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
                  {allRecordings.map(renderRecording)}
                </div>
              </div>
            )}

            <p className="text-center text-[10px] text-slate-600 mt-2">
              {session.myDeviceId} · {session.myLanguage} · {session.myGender}
            </p>
          </>
        )}
      </main>
    </div>
  );

}

'use client';
// components/room/RecordingRoom.tsx
// Core room component with audio loopback silencing & Host/Guest sync controls

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
import { encodeWav, mergeChunks } from '@/lib/wav';
import { saveRecording, buildRecordingId, buildFileName, getRecordingSequence } from '@/lib/db';
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

  const roomRef = useRef<Room | null>(null);
  const captureRef = useRef<AudioCapture | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const connectedRef = useRef(false);
  const partnerDeviceIdRef = useRef<string>('unknown');

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
      const localStream = await navigator.mediaDevices.getUserMedia({
        audio: { sampleRate: 44100, channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
      localStreamRef.current = localStream;

      const ctx = new AudioContext({ sampleRate: 44100 });
      const localChunks: Float32Array[] = [];
      const remoteChunks: Float32Array[] = [];
      const bufSize = 4096;

      // CRITICAL FIX: Connect script processors to a silent gain node to prevent speaker feedback loop
      const silence = ctx.createGain();
      silence.gain.value = 0;
      silence.connect(ctx.destination);

      // Local mic
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
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    captureRef.current = null;

    const durationSec = Math.round((Date.now() - cap.startTime) / 1000);
    const localWav = encodeWav(mergeChunks(cap.localChunks));
    const remoteWav = cap.remoteChunks.length > 0
      ? encodeWav(mergeChunks(cap.remoteChunks))
      : new Blob([], { type: 'audio/wav' });

    // Calculate dynamic sequence naming and build output filenames
    const { pairSeq, recSeq } = await getRecordingSequence(session.pairId);
    const fileName = buildFileName(session.myDeviceId, session.myLanguage, session.myGender, session.role, pairSeq, recSeq, session.myName);
    const id = buildRecordingId(session.pairId, session.role);

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
        autoGainControl: true,
        sampleRate: 44100,
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
      if (localSpeechTimeoutRef.current) clearTimeout(localSpeechTimeoutRef.current);
      if (partnerSpeechTimeoutRef.current) clearTimeout(partnerSpeechTimeoutRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── LEAVE WARNING ────────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (connState === 'recording') {
        e.preventDefault();
        return (e.returnValue = 'Recording is in progress. Are you sure you want to leave?');
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [connState]);

  const fmtTime = (s: number) => `${String(Math.floor(s/3600)).padStart(2,'0')}:${String(Math.floor((s%3600)/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;
  const sigLabel = { excellent: '● Excellent', good: '● Good', poor: '● Weak', unknown: '○ --' }[mySignal];
  const sigColor = { excellent: 'text-green-600', good: 'text-blue-600', poor: 'text-yellow-600', unknown: 'text-slate-400' }[mySignal];

  const handleStartNewSession = () => {
    setConnState('ready');
    sendData({ type: 'NEW_SESSION' });
  };

  return (
    <div className="min-h-screen bg-white flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 px-4 py-3">
        <div className="max-w-lg mx-auto flex items-center justify-between">
          <div>
            <h1 className="font-bold text-slate-900">Biswas Tech</h1>
            <p className="text-xs text-slate-400">Room #{session.pairId} · {session.role}</p>
          </div>
          <div className="flex items-center gap-3">
            <span className={`text-xs font-medium ${sigColor}`}>{sigLabel}</span>
            <button onClick={() => {
              if (connState === 'recording' && !confirm('Recording in progress. Leave?')) return;
              roomRef.current?.disconnect();
              router.replace('/home');
            }} className="text-xs bg-slate-100 hover:bg-red-100 hover:text-red-700 text-slate-600 px-3 py-1.5 rounded-lg font-medium">
              Leave
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center p-4 max-w-lg mx-auto w-full gap-4">

        {/* Connecting */}
        {connState === 'connecting' && (
          <div className="text-center">
            <div className="w-10 h-10 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <p className="font-semibold text-slate-900">Connecting to room…</p>
            <p className="text-slate-500 text-sm mt-1">Please allow microphone access</p>
          </div>
        )}

        {/* Error */}
        {(connState === 'error' || connState === 'disconnected') && (
          <div className="text-center max-w-sm">
            <div className="text-5xl mb-4">{connState === 'error' ? '⚠️' : '🔌'}</div>
            <h2 className="font-bold text-slate-900 text-lg mb-2">{connState === 'error' ? 'Connection Failed' : 'Disconnected'}</h2>
            <p className="text-slate-500 text-sm mb-4">{errorMsg}</p>
            <button onClick={() => router.replace('/home')} className="px-5 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium">Go Home</button>
          </div>
        )}

        {/* Room UI */}
        {['waiting', 'ready', 'recording', 'stopping', 'done'].includes(connState) && (
          <>
            {/* Participant cards */}
            <div className="grid grid-cols-2 gap-3 w-full">
              <div className="bg-white border border-slate-200 rounded-2xl p-4 text-center shadow-sm">
                <div className={`w-16 h-16 rounded-full mx-auto mb-2 flex items-center justify-center text-3xl ${iAmSpeaking ? 'bg-green-100 speak-pulse ring-2 ring-green-400' : 'bg-slate-100'}`}>
                  🎙️
                </div>
                <p className="text-xs text-slate-400">You</p>
                <p className="font-bold text-slate-900 text-sm truncate">{session.myName}</p>
                <p className="text-xs text-green-600 font-medium mt-0.5">● Connected</p>
              </div>

              <div className={`bg-white border rounded-2xl p-4 text-center shadow-sm ${partnerConnected ? 'border-slate-200' : 'border-dashed border-slate-300'}`}>
                <div className={`w-16 h-16 rounded-full mx-auto mb-2 flex items-center justify-center text-3xl ${partnerSpeaking && partnerConnected ? 'bg-green-100 speak-pulse ring-2 ring-green-400' : 'bg-slate-100'}`}>
                  {partnerConnected ? '🎙️' : '⏳'}
                </div>
                <p className="text-xs text-slate-400">Partner</p>
                <p className="font-bold text-slate-900 text-sm truncate">{partnerName}</p>
                <p className={`text-xs font-medium mt-0.5 ${partnerConnected ? 'text-green-600' : 'text-slate-400'}`}>
                  {partnerConnected ? '● Connected' : 'Waiting…'}
                </p>
              </div>
            </div>

            {/* Status */}
            {connState === 'waiting' && (
              <div className="w-full bg-blue-50 border border-blue-200 rounded-xl p-4 text-center">
                <p className="text-blue-800 font-medium text-sm">Waiting for partner to connect…</p>
                <p className="text-blue-500 text-xs mt-1">Share the invite link with your partner</p>
              </div>
            )}

            {connState === 'done' && (
              <div className="w-full bg-green-50 border border-green-200 rounded-xl p-4 text-center">
                <p className="text-green-800 font-semibold">✅ Recording #{recCount} saved!</p>
                {session.role === 'GUEST' ? (
                  <p className="text-green-600 text-xs mt-1">Waiting for host to start new recording…</p>
                ) : (
                  <p className="text-green-600 text-xs mt-1">You can start another recording without reconnecting</p>
                )}
              </div>
            )}

            {/* Timer */}
            {connState === 'recording' && (
              <div className="w-full bg-red-50 border border-red-200 rounded-2xl p-5 text-center">
                <div className="flex items-center justify-center gap-2 mb-1">
                  <span className="w-3 h-3 bg-red-500 rounded-full rec-blink" />
                  <span className="text-red-600 font-semibold text-sm uppercase tracking-wide">
                    {session.role === 'HOST' ? 'Recording' : 'Recording (Host Control)'}
                  </span>
                </div>
                <p className="font-mono text-5xl font-bold text-slate-900 tracking-wider">{fmtTime(recSeconds)}</p>
              </div>
            )}

            {connState === 'stopping' && (
              <div className="w-full bg-slate-50 border border-slate-200 rounded-xl p-4 text-center">
                <div className="w-5 h-5 border-2 border-slate-400 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                <p className="text-slate-600 text-sm font-medium">Saving recording…</p>
              </div>
            )}

            {/* Action buttons (HOST controls all; GUEST wait states) */}
            {session.role === 'HOST' ? (
              <>
                {connState === 'ready' && (
                  <button onClick={startRecording}
                    className="w-full py-5 rounded-2xl bg-red-600 hover:bg-red-700 active:scale-95 text-white font-bold text-xl transition-all shadow-md">
                    🔴 Start Recording
                  </button>
                )}
                {connState === 'recording' && (
                  <button onClick={stopRecording}
                    className="w-full py-5 rounded-2xl bg-slate-800 hover:bg-slate-900 active:scale-95 text-white font-bold text-xl transition-all shadow-md">
                    ⬛ Stop Recording
                  </button>
                )}
                {connState === 'done' && (
                  <button onClick={handleStartNewSession}
                    className="w-full py-5 rounded-2xl bg-blue-600 hover:bg-blue-700 active:scale-95 text-white font-bold text-lg transition-all shadow-md">
                    🔴 Start New Recording
                  </button>
                )}
              </>
            ) : (
              <>
                {connState === 'ready' && (
                  <div className="w-full bg-slate-50 border border-slate-200 rounded-xl p-4 text-center">
                    <p className="text-slate-600 font-medium text-sm">⏳ Waiting for Host to start recording…</p>
                  </div>
                )}
              </>
            )}

            <p className="text-center text-xs text-slate-400">
              {session.myDeviceId} · {session.myLanguage} · {session.myGender}
            </p>
          </>
        )}
      </main>
    </div>
  );
}

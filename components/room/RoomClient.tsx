'use client';

// components/room/RoomClient.tsx — Core LiveKit room component
// Handles: connection, mic permission check, recording, data channel WAV
// transfer, speaking detection, auto-reconnect, meaningful error messages.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Room,
  RoomEvent,
  Participant,
  RemoteParticipant,
  ConnectionQuality as LKConnectionQuality,
  Track,
  LocalParticipant,
  ConnectionState as LKConnectionState,
} from 'livekit-client';
import { useAudioRecorder } from '@/hooks/useAudioRecorder';
import { useWakeLock } from '@/hooks/useWakeLock';
import { useBeforeUnload } from '@/hooks/useBeforeUnload';
import { useSingleTab } from '@/hooks/useSingleTab';
import { saveRecording, updateRecordingWithRemote } from '@/lib/indexeddb';
import { buildFilename } from '@/lib/zip';
import { RecordingTimer } from './RecordingTimer';
import { SpeakingIndicator } from './SpeakingIndicator';
import { SignalStrength } from './SignalStrength';
import { ParticipantStatus } from './ParticipantStatus';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import type {
  ConnectionQuality,
  Gender,
  RecordingMetadata,
  DataChannelMessage,
  WavMetaMessage,
  WavDoneMessage,
} from '@/types';

// ─── Types ────────────────────────────────────────────────────

interface UserInfo {
  userId: string;
  role: 'host' | 'guest';
  gender: Gender;
  language: string;
  deviceId: string;
}

interface RoomClientProps {
  roomId: string;
  livekitToken: string;
  /** LiveKit WebSocket URL — resolved server-side, never from NEXT_PUBLIC env. */
  livekitUrl: string;
  userInfo: UserInfo;
}

type ConnectionState =
  | 'checking-mic'    // verifying microphone permission
  | 'mic-denied'      // microphone denied
  | 'connecting'      // connecting to LiveKit
  | 'connected'       // connected and ready
  | 'reconnecting'    // auto-reconnecting
  | 'disconnected'    // permanently disconnected
  | 'error';          // non-recoverable error

type ErrorKind =
  | 'mic-denied'
  | 'livekit-unavailable'
  | 'network'
  | 'invalid-room'
  | 'token-expired'
  | 'unknown';

interface WavBuffer {
  meta: WavMetaMessage;
  chunks: Map<number, Uint8Array>;
  totalChunks: number;
}

const CHUNK_SIZE = 15000; // bytes per data channel message

// ─── Error message map ────────────────────────────────────────

function describeError(kind: ErrorKind): string {
  switch (kind) {
    case 'mic-denied':
      return 'Microphone access was denied. Please allow microphone access in your browser settings and reload.';
    case 'livekit-unavailable':
      return 'Could not reach the LiveKit server. Check your internet connection or try again later.';
    case 'network':
      return 'Network connection lost. The app will try to reconnect automatically.';
    case 'invalid-room':
      return 'This room is invalid or no longer exists.';
    case 'token-expired':
      return 'Your session has expired. Please return to the dashboard and try again.';
    default:
      return 'An unexpected error occurred. Please reload the page.';
  }
}

// ─── Mic permission check ─────────────────────────────────────

async function checkMicrophonePermission(): Promise<'granted' | 'denied' | 'unavailable'> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    // Immediately stop — we just want to verify access
    stream.getTracks().forEach((t) => t.stop());
    return 'granted';
  } catch (err) {
    const name = (err as DOMException)?.name ?? '';
    if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
      return 'denied';
    }
    return 'unavailable';
  }
}

// ─── Component ───────────────────────────────────────────────

export function RoomClient({ roomId, livekitToken, livekitUrl, userInfo }: RoomClientProps) {
  const router = useRouter();
  const { showToast } = useToast();

  // Single tab enforcement
  useSingleTab();

  // Connection / error state
  const [connectionState, setConnectionState] = useState<ConnectionState>('checking-mic');
  const [errorKind, setErrorKind] = useState<ErrorKind | null>(null);

  // Room state
  const [partnerConnected, setPartnerConnected] = useState(false);
  const [partnerName, setPartnerName] = useState<string>('');
  const [quality, setQuality] = useState<ConnectionQuality>('unknown');
  const [isLocalSpeaking, setIsLocalSpeaking] = useState(false);
  const [isRemoteSpeaking, setIsRemoteSpeaking] = useState(false);

  // Recording state
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDone, setRecordingDone] = useState(false);
  const [pairId, setPairId] = useState<string>('');
  const [guestDeviceId, setGuestDeviceId] = useState<string>('');
  const [guestGender, setGuestGender] = useState<Gender>('MALE');
  const [guestLanguage, setGuestLanguage] = useState<string>('EN');
  const [transferring, setTransferring] = useState(false);

  // Refs
  const roomRef = useRef<Room | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const wavBufferRef = useRef<WavBuffer | null>(null);
  const micGrantedRef = useRef(false);

  // Hooks
  const {
    state: recState,
    startRecording,
    stopRecording,
    reset: resetRecorder,
  } = useAudioRecorder({
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: false,
    sampleRate: 44100,
  });
  const { requestWakeLock, releaseWakeLock } = useWakeLock();
  useBeforeUnload(isRecording);

  // ─── Microphone permission check ─────────────────────────────

  useEffect(() => {
    let cancelled = false;

    checkMicrophonePermission().then((result) => {
      if (cancelled) return;
      if (result === 'granted') {
        micGrantedRef.current = true;
        setConnectionState('connecting');
      } else {
        setConnectionState('mic-denied');
        setErrorKind('mic-denied');
      }
    });

    return () => { cancelled = true; };
  }, []);

  // ─── LiveKit connection (only after mic is confirmed) ─────────

  const getRemoteStream = useCallback(() => {
    const room = roomRef.current;
    if (!room) return null;
    for (const participant of room.remoteParticipants.values()) {
      for (const pub of participant.trackPublications.values()) {
        if (pub.track?.kind === Track.Kind.Audio && pub.track.mediaStream) {
          return pub.track.mediaStream;
        }
      }
    }
    return null;
  }, []);

  const sendData = useCallback((msg: DataChannelMessage) => {
    const room = roomRef.current;
    if (!room || room.state !== LKConnectionState.Connected) return;
    const encoded = new TextEncoder().encode(JSON.stringify(msg));
    room.localParticipant.publishData(encoded, { reliable: true });
  }, []);

  const sendWavToPartner = useCallback(
    async (wavBlob: Blob, meta: Omit<WavMetaMessage, 'type'>) => {
      const arrayBuffer = await wavBlob.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      const totalChunks = Math.ceil(bytes.length / CHUNK_SIZE);

      sendData({ type: 'WAV_META', ...meta });

      for (let i = 0; i < totalChunks; i++) {
        const chunk = bytes.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
        sendData({ type: 'WAV_CHUNK', chunkIndex: i, totalChunks, data: Array.from(chunk) });
        if (i % 10 === 9) await new Promise((r) => setTimeout(r, 0));
      }

      sendData({ type: 'WAV_DONE', pairId: meta.pairId, totalChunks });
    },
    [sendData]
  );

  const handleDataReceived = useCallback(
    async (payload: Uint8Array) => {
      try {
        const msg: DataChannelMessage = JSON.parse(new TextDecoder().decode(payload));

        if (msg.type === 'PAIR_ID') {
          setPairId(msg.pairId);
        } else if (msg.type === 'GUEST_DEVICE_INFO') {
          setGuestDeviceId(msg.deviceId);
          setGuestGender(msg.gender);
          setGuestLanguage(msg.language);
        } else if (msg.type === 'WAV_META') {
          wavBufferRef.current = { meta: msg, chunks: new Map(), totalChunks: 0 };
        } else if (msg.type === 'WAV_CHUNK') {
          wavBufferRef.current?.chunks.set(msg.chunkIndex, new Uint8Array(msg.data));
        } else if (msg.type === 'WAV_DONE') {
          const buf = wavBufferRef.current;
          if (!buf) return;
          buf.totalChunks = msg.totalChunks;

          const parts: Uint8Array[] = [];
          for (let i = 0; i < buf.totalChunks; i++) {
            const c = buf.chunks.get(i);
            if (c) parts.push(c);
          }
          const totalLength = parts.reduce((s, p) => s + p.length, 0);
          const merged = new Uint8Array(totalLength);
          let offset = 0;
          for (const part of parts) { merged.set(part, offset); offset += part.length; }

          const guestWavBlob = new Blob([merged], { type: 'audio/wav' });
          try {
            await updateRecordingWithRemote(msg.pairId, guestWavBlob);
            showToast('Partner recording received ✓', 'success');
          } catch (err) {
            console.error('Failed to store guest WAV:', err);
          }
          wavBufferRef.current = null;
          setTransferring(false);
        }
      } catch {
        // Ignore malformed messages
      }
    },
    [showToast]
  );

  // ─── Connect to LiveKit room ──────────────────────────────────

  useEffect(() => {
    if (connectionState !== 'connecting') return;

    const room = new Room({
      adaptiveStream: true,
      dynacast: true,
      audioCaptureDefaults: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: false,
        sampleRate: 44100,
      },
    });
    roomRef.current = room;

    const updatePartnerState = () => {
      const partners = Array.from(room.remoteParticipants.values()) as RemoteParticipant[];
      setPartnerConnected(partners.length > 0);
      if (partners.length > 0) setPartnerName(partners[0].identity ?? 'Partner');
      else setPartnerName('');
    };

    const mapQuality = (q: LKConnectionQuality): ConnectionQuality => {
      switch (q) {
        case LKConnectionQuality.Excellent: return 'excellent';
        case LKConnectionQuality.Good: return 'good';
        case LKConnectionQuality.Poor: return 'poor';
        default: return 'unknown';
      }
    };

    room
      .on(RoomEvent.Connected, () => {
        setConnectionState('connected');
        setErrorKind(null);
        if (userInfo.role === 'host') {
          const newPairId = String(Math.floor(10000 + Math.random() * 90000));
          setPairId(newPairId);
          sendData({ type: 'PAIR_ID', pairId: newPairId, roomId });
        } else {
          sendData({
            type: 'GUEST_DEVICE_INFO',
            deviceId: userInfo.deviceId,
            gender: userInfo.gender,
            language: userInfo.language,
          });
        }
      })
      .on(RoomEvent.Reconnecting, () => {
        setConnectionState('reconnecting');
        showToast('Connection lost — reconnecting…', 'warning', 5000);
      })
      .on(RoomEvent.Reconnected, () => {
        setConnectionState('connected');
        showToast('Reconnected ✓', 'success', 2000);
      })
      .on(RoomEvent.Disconnected, (reason) => {
        const reasonStr = reason ? String(reason) : '';
        if (reasonStr.includes('token') || reasonStr.includes('401')) {
          setErrorKind('token-expired');
        } else if (reasonStr.includes('room') || reasonStr.includes('404')) {
          setErrorKind('invalid-room');
        } else {
          setErrorKind('network');
        }
        setConnectionState('disconnected');
      })
      .on(RoomEvent.ParticipantConnected, updatePartnerState)
      .on(RoomEvent.ParticipantDisconnected, updatePartnerState)
      .on(RoomEvent.ConnectionQualityChanged, (q: LKConnectionQuality, p: Participant) => {
        if (p instanceof LocalParticipant) setQuality(mapQuality(q));
      })
      .on(RoomEvent.ActiveSpeakersChanged, (speakers: Participant[]) => {
        setIsLocalSpeaking(speakers.some((s) => s instanceof LocalParticipant));
        setIsRemoteSpeaking(speakers.some((s) => s instanceof RemoteParticipant));
      })
      .on(RoomEvent.DataReceived, (payload: Uint8Array) => {
        handleDataReceived(payload);
      })
      .on(RoomEvent.TrackSubscribed, () => {
        remoteStreamRef.current = getRemoteStream();
      });

    // Connect with auto-reconnect enabled (LiveKit client handles retries internally)
    room.connect(livekitUrl, livekitToken, { autoSubscribe: true }).catch((err: unknown) => {
      console.error('LiveKit connect error:', err);
      const msg = err instanceof Error ? err.message : '';
      if (msg.includes('network') || msg.includes('WebSocket') || msg.includes('ECONNREFUSED')) {
        setErrorKind('livekit-unavailable');
      } else if (msg.includes('token') || msg.includes('401')) {
        setErrorKind('token-expired');
      } else if (msg.includes('room') || msg.includes('404')) {
        setErrorKind('invalid-room');
      } else {
        setErrorKind('unknown');
      }
      setConnectionState('error');
      showToast('Failed to connect to room', 'error');
    });

    return () => {
      room.disconnect();
      roomRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionState === 'connecting', livekitToken, livekitUrl]);

  // ─── Recording handlers ───────────────────────────────────────

  const handleStartRecording = useCallback(async () => {
    await requestWakeLock();
    const remoteStream = remoteStreamRef.current ?? getRemoteStream();
    await startRecording(remoteStream);
    setIsRecording(true);
    setRecordingDone(false);
    sendData({ type: 'RECORDING_START' });
  }, [requestWakeLock, startRecording, sendData, getRemoteStream]);

  const handleStopRecording = useCallback(async () => {
    setIsRecording(false);
    sendData({ type: 'RECORDING_STOP' });

    try {
      const result = await stopRecording();
      await releaseWakeLock();

      const currentPairId = pairId || String(Math.floor(10000 + Math.random() * 90000));

      const hostDeviceId = userInfo.role === 'host' ? userInfo.deviceId : guestDeviceId;
      const actualGuestDeviceId = userInfo.role === 'guest' ? userInfo.deviceId : guestDeviceId;
      const hostFilename = buildFilename(
        hostDeviceId,
        userInfo.role === 'host' ? userInfo.language : guestLanguage,
        userInfo.role === 'host' ? userInfo.gender : guestGender,
        'HOST',
        currentPairId
      );
      const guestFilename = buildFilename(
        actualGuestDeviceId,
        userInfo.role === 'guest' ? userInfo.language : guestLanguage,
        userInfo.role === 'guest' ? userInfo.gender : guestGender,
        'GUEST',
        currentPairId
      );

      const metadata: RecordingMetadata = {
        pairId: currentPairId,
        date: new Date().toISOString(),
        durationMs: result.durationMs,
        partnerGender: userInfo.role === 'host' ? guestGender : userInfo.gender,
        language: userInfo.language,
        hostDeviceId,
        guestDeviceId: actualGuestDeviceId,
        hostFilename,
        guestFilename,
        hasGuestRecording: userInfo.role !== 'host',
      };

      await saveRecording(
        metadata,
        result.localBlob,
        userInfo.role === 'host' ? null : result.remoteBlob
      );

      if (userInfo.role === 'guest') {
        setTransferring(true);
        const guestMeta: Omit<WavMetaMessage, 'type'> = {
          pairId: currentPairId,
          deviceId: userInfo.deviceId,
          gender: userInfo.gender,
          language: userInfo.language,
          durationMs: result.durationMs,
          filename: guestFilename,
        };
        await sendWavToPartner(result.localBlob, guestMeta);
      }

      setRecordingDone(true);
      showToast('Recording saved successfully', 'success');
    } catch (err) {
      showToast('Recording failed to save', 'error');
      console.error(err);
    }
  }, [
    stopRecording,
    releaseWakeLock,
    pairId,
    userInfo,
    guestDeviceId,
    guestGender,
    guestLanguage,
    sendData,
    sendWavToPartner,
    showToast,
  ]);

  const handleLeave = useCallback(async () => {
    if (isRecording) await handleStopRecording();
    roomRef.current?.disconnect();
    router.push(userInfo.role === 'host' ? '/dashboard' : '/');
  }, [isRecording, handleStopRecording, router, userInfo.role]);

  // ─── Error / special states ───────────────────────────────────

  if (connectionState === 'checking-mic') {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-6 text-center">
        <div className="text-3xl mb-3">🎙️</div>
        <p className="text-white font-medium mb-1">Checking microphone access…</p>
        <p className="text-gray-400 text-sm">Please allow microphone access if prompted.</p>
      </div>
    );
  }

  if (connectionState === 'mic-denied' || connectionState === 'error') {
    const kind = errorKind ?? (connectionState === 'mic-denied' ? 'mic-denied' : 'unknown');
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-6 text-center max-w-sm mx-auto">
        <div className="text-4xl mb-4">{kind === 'mic-denied' ? '🎙️' : '⚠️'}</div>
        <h1 className="text-lg font-bold text-white mb-3">
          {kind === 'mic-denied' ? 'Microphone Access Denied' : 'Connection Error'}
        </h1>
        <p className="text-gray-400 text-sm mb-6">{describeError(kind)}</p>
        <Button
          onClick={() => router.push(userInfo.role === 'host' ? '/dashboard' : '/')}
          variant="ghost"
        >
          Return Home
        </Button>
      </div>
    );
  }

  if (connectionState === 'disconnected') {
    const kind = errorKind ?? 'network';
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-6 text-center max-w-sm mx-auto">
        <div className="text-4xl mb-4">📡</div>
        <h1 className="text-lg font-bold text-white mb-3">Disconnected</h1>
        <p className="text-gray-400 text-sm mb-6">{describeError(kind)}</p>
        <Button
          onClick={() => router.push(userInfo.role === 'host' ? '/dashboard' : '/')}
        >
          Return Home
        </Button>
      </div>
    );
  }

  const canRecord = partnerConnected && connectionState === 'connected';

  return (
    <div className="min-h-screen bg-[#0A0F1E] flex flex-col">
      {/* Header */}
      <header className="border-b border-white/10 px-4 py-3 flex items-center justify-between">
        <div>
          <h1 className="text-sm font-semibold text-white">Biswas Tech</h1>
          <p className="text-xs text-gray-500">Room: {roomId.slice(-12)}</p>
        </div>
        <div className="flex items-center gap-3">
          <SignalStrength quality={quality} />
          {connectionState === 'reconnecting' && (
            <span className="text-xs text-amber-400 animate-pulse">Reconnecting…</span>
          )}
          {connectionState === 'connecting' && (
            <span className="text-xs text-blue-400 animate-pulse">Connecting…</span>
          )}
        </div>
      </header>

      {/* Main */}
      <main className="flex-1 flex flex-col gap-5 p-4 max-w-lg mx-auto w-full">

        <ParticipantStatus
          role={userInfo.role}
          partnerConnected={partnerConnected}
          partnerName={partnerName}
        />

        <div className="bg-white/5 border border-white/10 rounded-lg p-4 space-y-3">
          <SpeakingIndicator label="You" isSpeaking={isLocalSpeaking} color="green" />
          <div className="border-t border-white/5" />
          <SpeakingIndicator label="Partner" isSpeaking={isRemoteSpeaking} color="blue" />
        </div>

        {(isRecording || recState === 'processing') && (
          <div className="bg-red-600/10 border border-red-600/30 rounded-lg p-4 flex items-center justify-between">
            <RecordingTimer isRunning={isRecording} />
            <span className="text-xs text-red-400">
              {recState === 'processing' ? 'Saving…' : 'Recording'}
            </span>
          </div>
        )}

        {transferring && (
          <div className="bg-blue-600/10 border border-blue-500/30 rounded-lg p-3 text-xs text-blue-400 text-center">
            Sending recording to partner…
          </div>
        )}

        {!partnerConnected && connectionState === 'connected' && (
          <div className="text-center py-6 text-gray-500 text-sm">
            Waiting for partner to connect…
          </div>
        )}

        {/* LiveKit not yet connected notice */}
        {connectionState === 'connecting' && (
          <div className="text-center py-6 text-gray-500 text-sm">
            Connecting to room…
          </div>
        )}

        {canRecord && !isRecording && !recordingDone && (
          <Button
            id="btn-start-recording"
            size="lg"
            variant="success"
            onClick={handleStartRecording}
            disabled={recState === 'processing'}
            className="w-full"
          >
            ● Start Recording
          </Button>
        )}

        {isRecording && (
          <Button
            id="btn-stop-recording"
            size="lg"
            variant="danger"
            onClick={handleStopRecording}
            disabled={recState === 'processing'}
            className="w-full"
          >
            ■ Stop Recording
          </Button>
        )}

        {recordingDone && (
          <Button
            id="btn-new-recording"
            size="lg"
            variant="primary"
            onClick={() => {
              resetRecorder();
              setRecordingDone(false);
              setPairId('');
            }}
            className="w-full"
          >
            + Start New Recording
          </Button>
        )}

        <div className="text-xs text-gray-600 text-center">
          {userInfo.deviceId} · {userInfo.language} · {userInfo.gender}
        </div>
      </main>

      <footer className="p-4 border-t border-white/10">
        <Button
          id="btn-leave"
          variant="ghost"
          size="md"
          onClick={handleLeave}
          className="w-full"
        >
          Leave Room
        </Button>
      </footer>
    </div>
  );
}

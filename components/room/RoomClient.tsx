'use client';

// components/room/RoomClient.tsx — Core LiveKit room component

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Room,
  RoomEvent,
  RoomOptions,
  Participant,
  RemoteParticipant,
  ConnectionQuality as LKConnectionQuality,
  Track,
  LocalParticipant,
  ConnectionState as LKConnectionState,
  DisconnectReason,
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
  livekitUrl: string;
  userInfo: UserInfo;
}

type UIState =
  | 'checking-mic'
  | 'mic-denied'
  | 'connecting'
  | 'waiting'      // connected to LiveKit, waiting for partner
  | 'ready'        // partner connected, ready to record
  | 'recording'
  | 'processing'
  | 'done'
  | 'reconnecting'
  | 'disconnected'
  | 'error';

interface WavBuffer {
  meta: WavMetaMessage;
  chunks: Map<number, Uint8Array>;
  totalChunks: number;
}

const CHUNK_SIZE = 15000;

// ─── Mic permission ───────────────────────────────────────────

async function checkMic(): Promise<boolean> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    stream.getTracks().forEach((t) => t.stop());
    return true;
  } catch {
    return false;
  }
}

// ─── Component ───────────────────────────────────────────────

export function RoomClient({ roomId, livekitToken, livekitUrl, userInfo }: RoomClientProps) {
  const router = useRouter();
  const { showToast } = useToast();

  useSingleTab();

  const [uiState, setUiState] = useState<UIState>('checking-mic');
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [quality, setQuality] = useState<ConnectionQuality>('unknown');
  const [partnerConnected, setPartnerConnected] = useState(false);
  const [partnerName, setPartnerName] = useState('');
  const [isLocalSpeaking, setIsLocalSpeaking] = useState(false);
  const [isRemoteSpeaking, setIsRemoteSpeaking] = useState(false);
  const [pairId, setPairId] = useState('');
  const [guestDeviceId, setGuestDeviceId] = useState('');
  const [guestGender, setGuestGender] = useState<Gender>('MALE');
  const [guestLanguage, setGuestLanguage] = useState('EN');
  const [transferring, setTransferring] = useState(false);

  const roomRef = useRef<Room | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const wavBufferRef = useRef<WavBuffer | null>(null);
  const connectedOnce = useRef(false);

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
  useBeforeUnload(uiState === 'recording');

  // ─── Step 1: Mic check ──────────────────────────────────────

  useEffect(() => {
    checkMic().then((ok) => {
      if (ok) {
        setUiState('connecting');
      } else {
        setUiState('mic-denied');
        setErrorMsg(
          'Microphone access denied. Please allow microphone access in your browser settings and reload this page.'
        );
      }
    });
  }, []);

  // ─── Helpers ─────────────────────────────────────────────────

  const getRemoteStream = useCallback(() => {
    const room = roomRef.current;
    if (!room) return null;
    for (const p of room.remoteParticipants.values()) {
      for (const pub of p.trackPublications.values()) {
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
    room.localParticipant.publishData(new TextEncoder().encode(JSON.stringify(msg)), { reliable: true });
  }, []);

  const sendWavToPartner = useCallback(
    async (blob: Blob, meta: Omit<WavMetaMessage, 'type'>) => {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const totalChunks = Math.ceil(bytes.length / CHUNK_SIZE);
      sendData({ type: 'WAV_META', ...meta });
      for (let i = 0; i < totalChunks; i++) {
        sendData({ type: 'WAV_CHUNK', chunkIndex: i, totalChunks, data: Array.from(bytes.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE)) });
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
          for (let i = 0; i < buf.totalChunks; i++) { const c = buf.chunks.get(i); if (c) parts.push(c); }
          const merged = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
          let off = 0; for (const p of parts) { merged.set(p, off); off += p.length; }
          try {
            await updateRecordingWithRemote(msg.pairId, new Blob([merged], { type: 'audio/wav' }));
            showToast('Partner recording received ✓', 'success');
          } catch (e) { console.error('Failed to store guest WAV:', e); }
          wavBufferRef.current = null;
          setTransferring(false);
        }
      } catch { /* ignore malformed */ }
    },
    [showToast]
  );

  // ─── Step 2: Connect to LiveKit ──────────────────────────────

  useEffect(() => {
    if (uiState !== 'connecting') return;

    // Validate inputs before attempting connection
    if (!livekitUrl || !livekitToken) {
      setUiState('error');
      setErrorMsg('LiveKit configuration is missing. Check LIVEKIT_URL is set in Vercel environment variables.');
      return;
    }

    const options: RoomOptions = {
      adaptiveStream: true,
      dynacast: true,
      audioCaptureDefaults: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: false,
        sampleRate: 44100,
      },
    };

    const room = new Room(options);
    roomRef.current = room;

    const updatePartners = () => {
      const partners = Array.from(room.remoteParticipants.values());
      const hasPartner = partners.length > 0;
      setPartnerConnected(hasPartner);
      if (hasPartner) setPartnerName(partners[0].identity ?? 'Partner');
      else setPartnerName('');
      // Update UI state based on partner presence
      if (connectedOnce.current) {
        setUiState(hasPartner ? 'ready' : 'waiting');
      }
    };

    room
      .on(RoomEvent.Connected, () => {
        connectedOnce.current = true;
        setUiState('waiting'); // connected but no partner yet
        setErrorMsg('');
        if (userInfo.role === 'host') {
          const newPairId = String(Math.floor(10000 + Math.random() * 90000));
          setPairId(newPairId);
          sendData({ type: 'PAIR_ID', pairId: newPairId, roomId });
        } else {
          sendData({ type: 'GUEST_DEVICE_INFO', deviceId: userInfo.deviceId, gender: userInfo.gender, language: userInfo.language });
        }
        // Check if partner already in room
        updatePartners();
      })
      .on(RoomEvent.Reconnecting, () => {
        setUiState('reconnecting');
        showToast('Connection lost — reconnecting…', 'warning', 5000);
      })
      .on(RoomEvent.Reconnected, () => {
        setUiState(partnerConnected ? 'ready' : 'waiting');
        showToast('Reconnected ✓', 'success', 2000);
      })
      .on(RoomEvent.Disconnected, (reason?: DisconnectReason) => {
        const r = reason ?? 0;
        if (r === DisconnectReason.DUPLICATE_IDENTITY || r === DisconnectReason.CLIENT_INITIATED) {
          return; // intentional disconnect, don't show error
        }
        setUiState('disconnected');
        if (r === DisconnectReason.PARTICIPANT_REMOVED || r === DisconnectReason.USER_REJECTED) {
          setErrorMsg('Access denied. Your token may have expired. Return to dashboard and try again.');
        } else if (r === DisconnectReason.ROOM_DELETED || r === DisconnectReason.ROOM_CLOSED) {
          setErrorMsg('The room was closed.');
        } else if (r === DisconnectReason.JOIN_FAILURE) {
          setErrorMsg('Failed to join room. Check your LiveKit credentials in Vercel environment variables.');
        } else {
          setErrorMsg('Disconnected from the room. Check your internet connection.');
        }
      })
      .on(RoomEvent.ParticipantConnected, () => {
        updatePartners();
        showToast('Partner connected!', 'success', 2000);
      })
      .on(RoomEvent.ParticipantDisconnected, () => {
        updatePartners();
        showToast('Partner disconnected', 'warning', 3000);
      })
      .on(RoomEvent.ConnectionQualityChanged, (q: LKConnectionQuality, p: Participant) => {
        if (p instanceof LocalParticipant) {
          setQuality(q === LKConnectionQuality.Excellent ? 'excellent' : q === LKConnectionQuality.Good ? 'good' : 'poor');
        }
      })
      .on(RoomEvent.ActiveSpeakersChanged, (speakers: Participant[]) => {
        setIsLocalSpeaking(speakers.some((s) => s instanceof LocalParticipant));
        setIsRemoteSpeaking(speakers.some((s) => s instanceof RemoteParticipant));
      })
      .on(RoomEvent.DataReceived, (payload: Uint8Array) => handleDataReceived(payload))
      .on(RoomEvent.TrackSubscribed, () => { remoteStreamRef.current = getRemoteStream(); });

    console.log('[RoomClient] Connecting to', livekitUrl);
    room.connect(livekitUrl, livekitToken, { autoSubscribe: true }).catch((err: unknown) => {
      console.error('[RoomClient] Connection failed:', err);
      const msg = err instanceof Error ? err.message : String(err);
      setUiState('error');
      if (msg.includes('403') || msg.includes('not allowed') || msg.includes('unauthorized')) {
        setErrorMsg('Token rejected by LiveKit. Verify LIVEKIT_API_KEY and LIVEKIT_API_SECRET are correct in Vercel.');
      } else if (msg.includes('404') || msg.includes('room')) {
        setErrorMsg('Room not found. Return to dashboard and create a new room.');
      } else if (msg.includes('websocket') || msg.includes('WebSocket') || msg.includes('network') || msg.includes('ECONNREFUSED')) {
        setErrorMsg('Cannot reach LiveKit server. Check LIVEKIT_URL in Vercel environment variables.');
      } else {
        setErrorMsg(`Connection failed: ${msg || 'Unknown error'}. Check Vercel logs for details.`);
      }
    });

    return () => {
      room.disconnect();
      roomRef.current = null;
      connectedOnce.current = false;
    };
    // Only re-run if the token or URL changes (not on every state change)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [livekitToken, livekitUrl, uiState === 'connecting']);

  // ─── Recording ───────────────────────────────────────────────

  const handleStartRecording = useCallback(async () => {
    await requestWakeLock();
    const remoteStream = remoteStreamRef.current ?? getRemoteStream();
    await startRecording(remoteStream);
    setUiState('recording');
    sendData({ type: 'RECORDING_START' });
  }, [requestWakeLock, startRecording, sendData, getRemoteStream]);

  const handleStopRecording = useCallback(async () => {
    setUiState('processing');
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
        'HOST', currentPairId
      );
      const guestFilename = buildFilename(
        actualGuestDeviceId,
        userInfo.role === 'guest' ? userInfo.language : guestLanguage,
        userInfo.role === 'guest' ? userInfo.gender : guestGender,
        'GUEST', currentPairId
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

      await saveRecording(metadata, result.localBlob, userInfo.role === 'host' ? null : result.remoteBlob);

      if (userInfo.role === 'guest') {
        setTransferring(true);
        await sendWavToPartner(result.localBlob, {
          pairId: currentPairId,
          deviceId: userInfo.deviceId,
          gender: userInfo.gender,
          language: userInfo.language,
          durationMs: result.durationMs,
          filename: guestFilename,
        });
      }

      setUiState('done');
      showToast('Recording saved ✓', 'success');
    } catch (err) {
      showToast('Recording failed to save', 'error');
      console.error(err);
      setUiState('ready');
    }
  }, [stopRecording, releaseWakeLock, pairId, userInfo, guestDeviceId, guestGender, guestLanguage, sendData, sendWavToPartner, showToast]);

  const handleLeave = useCallback(async () => {
    if (uiState === 'recording') await handleStopRecording();
    roomRef.current?.disconnect();
    router.push(userInfo.role === 'host' ? '/dashboard' : '/');
  }, [uiState, handleStopRecording, router, userInfo.role]);

  // ─── Render ──────────────────────────────────────────────────

  if (uiState === 'checking-mic') {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-6 text-center">
        <div className="text-3xl mb-3">🎙️</div>
        <p className="text-white font-medium mb-1">Checking microphone…</p>
        <p className="text-gray-500 text-sm">Please allow microphone access if prompted.</p>
      </div>
    );
  }

  if (uiState === 'connecting') {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-6 text-center">
        <div className="animate-spin text-3xl mb-3">⏳</div>
        <p className="text-white font-medium mb-1">Connecting to room…</p>
        <p className="text-gray-500 text-sm">Establishing LiveKit connection</p>
      </div>
    );
  }

  if (uiState === 'mic-denied' || uiState === 'error') {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-6 text-center max-w-md mx-auto">
        <div className="text-4xl mb-4">{uiState === 'mic-denied' ? '🎙️' : '⚠️'}</div>
        <h1 className="text-lg font-bold text-white mb-3">
          {uiState === 'mic-denied' ? 'Microphone Access Denied' : 'Connection Error'}
        </h1>
        <p className="text-gray-400 text-sm mb-6 leading-relaxed">{errorMsg}</p>
        <Button onClick={() => router.push(userInfo.role === 'host' ? '/dashboard' : '/')} variant="ghost">
          Return Home
        </Button>
      </div>
    );
  }

  if (uiState === 'disconnected') {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-6 text-center max-w-md mx-auto">
        <div className="text-4xl mb-4">📡</div>
        <h1 className="text-lg font-bold text-white mb-3">Disconnected</h1>
        <p className="text-gray-400 text-sm mb-6 leading-relaxed">{errorMsg}</p>
        <Button onClick={() => router.push(userInfo.role === 'host' ? '/dashboard' : '/')}>
          Return Home
        </Button>
      </div>
    );
  }

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
          {uiState === 'reconnecting' && (
            <span className="text-xs text-amber-400 animate-pulse">Reconnecting…</span>
          )}
        </div>
      </header>

      {/* Main */}
      <main className="flex-1 flex flex-col gap-4 p-4 max-w-lg mx-auto w-full">

        {/* Partner status */}
        <ParticipantStatus
          role={userInfo.role}
          partnerConnected={partnerConnected}
          partnerName={partnerName}
        />

        {/* Waiting for partner */}
        {!partnerConnected && (
          <div className="bg-white/5 border border-white/10 rounded-lg p-5 text-center">
            <div className="text-2xl mb-2 animate-pulse">⏳</div>
            <p className="text-white font-medium text-sm mb-1">Waiting for partner to connect…</p>
            <p className="text-gray-500 text-xs">
              {userInfo.role === 'host'
                ? 'Share the invite link with your partner. Recording will be enabled once they join.'
                : 'The host will start the session shortly.'}
            </p>
          </div>
        )}

        {/* Speaking indicators — only when partner is connected */}
        {partnerConnected && (
          <div className="bg-white/5 border border-white/10 rounded-lg p-4 space-y-3">
            <SpeakingIndicator label="You" isSpeaking={isLocalSpeaking} color="green" />
            <div className="border-t border-white/5" />
            <SpeakingIndicator label="Partner" isSpeaking={isRemoteSpeaking} color="blue" />
          </div>
        )}

        {/* Recording status */}
        {uiState === 'recording' && (
          <div className="bg-red-600/10 border border-red-600/30 rounded-lg p-4 flex items-center justify-between">
            <RecordingTimer isRunning={true} />
            <span className="text-xs text-red-400">Recording</span>
          </div>
        )}
        {uiState === 'processing' && (
          <div className="bg-amber-600/10 border border-amber-600/30 rounded-lg p-4 text-center text-xs text-amber-400">
            Saving recording…
          </div>
        )}

        {/* WAV transfer */}
        {transferring && (
          <div className="bg-blue-600/10 border border-blue-500/30 rounded-lg p-3 text-xs text-blue-400 text-center">
            Sending recording to partner…
          </div>
        )}

        {/* Controls */}
        {uiState === 'ready' && (
          <Button id="btn-start-recording" size="lg" variant="success" onClick={handleStartRecording} className="w-full">
            ● Start Recording
          </Button>
        )}
        {uiState === 'recording' && (
          <Button id="btn-stop-recording" size="lg" variant="danger" onClick={handleStopRecording} className="w-full">
            ■ Stop Recording
          </Button>
        )}
        {uiState === 'done' && (
          <Button
            id="btn-new-recording"
            size="lg"
            variant="primary"
            onClick={() => { resetRecorder(); setUiState('ready'); setPairId(''); }}
            className="w-full"
          >
            + Start New Recording
          </Button>
        )}

        {/* Device info */}
        <div className="text-xs text-gray-600 text-center">
          {userInfo.deviceId} · {userInfo.language} · {userInfo.gender}
        </div>
      </main>

      {/* Footer */}
      <footer className="p-4 border-t border-white/10">
        <Button id="btn-leave" variant="ghost" size="md" onClick={handleLeave} className="w-full">
          Leave Room
        </Button>
      </footer>
    </div>
  );
}

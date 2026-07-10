'use client';

// hooks/useAudioRecorder.ts — Core dual-track PCM recording engine
// Records local mic and remote audio separately via AudioWorklet.
// Both tracks start at the same timestamp and are trimmed to identical duration on stop.

import { useRef, useCallback, useState } from 'react';
import { encodeWAV, matchDuration } from '@/lib/wav-encoder';

export type RecordingState = 'idle' | 'recording' | 'processing' | 'done' | 'error';

export interface RecordingResult {
  localBlob: Blob;
  remoteBlob: Blob;
  durationMs: number;
}

interface AudioRecorderOptions {
  sampleRate?: number;
  echoCancellation?: boolean;
  noiseSuppression?: boolean;
  autoGainControl?: boolean;
}

const WORKLET_URL = '/worklets/pcm-processor.js';

export function useAudioRecorder(options: AudioRecorderOptions = {}) {
  const {
    sampleRate = 44100,
    echoCancellation = true,
    noiseSuppression = true,
    autoGainControl = false,
  } = options;

  const [state, setState] = useState<RecordingState>('idle');
  const [error, setError] = useState<string | null>(null);

  // Audio context refs
  const localContextRef = useRef<AudioContext | null>(null);
  const remoteContextRef = useRef<AudioContext | null>(null);

  // PCM chunk collections
  const localChunksRef = useRef<Float32Array[]>([]);
  const remoteChunksRef = useRef<Float32Array[]>([]);

  // Worklet nodes
  const localWorkletRef = useRef<AudioWorkletNode | null>(null);
  const remoteWorkletRef = useRef<AudioWorkletNode | null>(null);

  // Media stream refs (for cleanup)
  const localStreamRef = useRef<MediaStream | null>(null);

  // Timing
  const startTimeRef = useRef<number>(0);

  const startRecording = useCallback(async (remoteStream: MediaStream | null) => {
    try {
      setState('recording');
      setError(null);

      // ── 1. Local microphone capture ──────────────────────────────
      const localStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation,
          noiseSuppression,
          autoGainControl,
          sampleRate,
          channelCount: 1,
        },
        video: false,
      });
      localStreamRef.current = localStream;

      const localCtx = new AudioContext({ sampleRate });
      localContextRef.current = localCtx;
      await localCtx.audioWorklet.addModule(WORKLET_URL);

      const localSource = localCtx.createMediaStreamSource(localStream);
      const localWorklet = new AudioWorkletNode(localCtx, 'pcm-processor');
      localWorkletRef.current = localWorklet;

      localChunksRef.current = [];
      localWorklet.port.onmessage = (e) => {
        if (e.data?.type === 'chunk') {
          localChunksRef.current.push(new Float32Array(e.data.samples));
        }
      };

      localSource.connect(localWorklet);
      localWorklet.connect(localCtx.destination); // connect to hear self (required for some browsers)

      // ── 2. Remote audio capture ──────────────────────────────────
      if (remoteStream && remoteStream.getAudioTracks().length > 0) {
        const remoteCtx = new AudioContext({ sampleRate });
        remoteContextRef.current = remoteCtx;
        await remoteCtx.audioWorklet.addModule(WORKLET_URL);

        const remoteSource = remoteCtx.createMediaStreamSource(remoteStream);
        const remoteWorklet = new AudioWorkletNode(remoteCtx, 'pcm-processor');
        remoteWorkletRef.current = remoteWorklet;

        remoteChunksRef.current = [];
        remoteWorklet.port.onmessage = (e) => {
          if (e.data?.type === 'chunk') {
            remoteChunksRef.current.push(new Float32Array(e.data.samples));
          }
        };

        remoteSource.connect(remoteWorklet);
        // Don't connect to destination (we don't want feedback)

        // Start both simultaneously
        startTimeRef.current = Date.now();
        localWorklet.port.postMessage('start');
        remoteWorklet.port.postMessage('start');
      } else {
        // No remote stream yet — still start local
        startTimeRef.current = Date.now();
        localWorklet.port.postMessage('start');
      }

    } catch (err) {
      console.error('startRecording error:', err);
      setError(err instanceof Error ? err.message : 'Recording failed');
      setState('error');
    }
  }, [echoCancellation, noiseSuppression, autoGainControl, sampleRate]);

  const stopRecording = useCallback((): Promise<RecordingResult> => {
    return new Promise((resolve, reject) => {
      setState('processing');
      const durationMs = Date.now() - startTimeRef.current;

      let localDone = false;
      let remoteDone = !remoteWorkletRef.current; // if no remote worklet, skip waiting

      const tryFinalize = () => {
        if (!localDone || !remoteDone) return;

        try {
          const { chunksA: trimmedLocal, chunksB: trimmedRemote } = matchDuration(
            localChunksRef.current,
            remoteChunksRef.current.length > 0 ? remoteChunksRef.current : [new Float32Array(0)]
          );

          const localBlob = encodeWAV(trimmedLocal, 44100);
          const remoteBlob = encodeWAV(
            remoteChunksRef.current.length > 0 ? trimmedRemote : [new Float32Array(0)],
            44100
          );

          cleanup();
          setState('done');
          resolve({ localBlob, remoteBlob, durationMs });
        } catch (err) {
          cleanup();
          setState('error');
          reject(err);
        }
      };

      // Stop local worklet
      if (localWorkletRef.current) {
        localWorkletRef.current.port.onmessage = (e) => {
          if (e.data?.type === 'chunk') {
            localChunksRef.current.push(new Float32Array(e.data.samples));
          } else if (e.data?.type === 'done') {
            localDone = true;
            tryFinalize();
          }
        };
        localWorkletRef.current.port.postMessage('stop');
      } else {
        localDone = true;
      }

      // Stop remote worklet
      if (remoteWorkletRef.current) {
        remoteWorkletRef.current.port.onmessage = (e) => {
          if (e.data?.type === 'chunk') {
            remoteChunksRef.current.push(new Float32Array(e.data.samples));
          } else if (e.data?.type === 'done') {
            remoteDone = true;
            tryFinalize();
          }
        };
        remoteWorkletRef.current.port.postMessage('stop');
      } else {
        remoteDone = true;
        tryFinalize();
      }
    });
  }, []);

  const cleanup = useCallback(() => {
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;

    localContextRef.current?.close();
    localContextRef.current = null;

    remoteContextRef.current?.close();
    remoteContextRef.current = null;

    localWorkletRef.current = null;
    remoteWorkletRef.current = null;

    localChunksRef.current = [];
    remoteChunksRef.current = [];
  }, []);

  const reset = useCallback(() => {
    cleanup();
    setState('idle');
    setError(null);
  }, [cleanup]);

  return {
    state,
    error,
    startRecording,
    stopRecording,
    reset,
  };
}

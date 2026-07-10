// types/index.ts — Shared TypeScript types for the entire app

export type UserRole = 'host' | 'guest';
export type Gender = 'MALE' | 'FEMALE';
export type ConnectionQuality = 'excellent' | 'good' | 'weak' | 'poor' | 'unknown';

// ─── User ────────────────────────────────────────────────────
export interface AppUser {
  userId: string;
  passwordHash: string;
  gender: Gender;
  language: string; // e.g. "EN", "HI", "BN"
  createdAt: string;
}

// ─── Session ─────────────────────────────────────────────────
export interface SessionPayload {
  userId: string;
  role: UserRole;
  gender: Gender;
  language: string;
  deviceId: string;
  iat?: number;
  exp?: number;
}

// ─── Invite ──────────────────────────────────────────────────
export interface InviteRecord {
  token: string;
  partnerGender: Gender;
  status: 'pending' | 'used';
  deviceId: string | null;
  createdAt: string;
  roomId: string;
}

// ─── Recording ───────────────────────────────────────────────
export interface RecordingMetadata {
  pairId: string;
  date: string;
  durationMs: number;
  partnerGender: Gender;
  language: string;
  hostDeviceId: string;
  guestDeviceId: string;
  hostFilename: string;
  guestFilename: string;
  hasGuestRecording: boolean;
}

// ─── LiveKit ─────────────────────────────────────────────────
export interface LiveKitTokenRequest {
  roomId: string;
  identity: string;
  role: UserRole;
  metadata?: string;
}

// ─── Data channel messages ───────────────────────────────────
export type DataChannelMessageType =
  | 'RECORDING_START'
  | 'RECORDING_STOP'
  | 'WAV_CHUNK'
  | 'WAV_DONE'
  | 'WAV_META'
  | 'PAIR_ID'
  | 'GUEST_DEVICE_INFO';

export interface WavChunkMessage {
  type: 'WAV_CHUNK';
  chunkIndex: number;
  totalChunks: number;
  data: number[];
}

export interface WavMetaMessage {
  type: 'WAV_META';
  pairId: string;
  deviceId: string;
  gender: Gender;
  language: string;
  durationMs: number;
  filename: string;
}

export interface WavDoneMessage {
  type: 'WAV_DONE';
  pairId: string;
  totalChunks: number;
}

export interface PairIdMessage {
  type: 'PAIR_ID';
  pairId: string;
  roomId: string;
}

export interface GuestDeviceInfoMessage {
  type: 'GUEST_DEVICE_INFO';
  deviceId: string;
  gender: Gender;
  language: string;
}

export type DataChannelMessage =
  | WavChunkMessage
  | WavMetaMessage
  | WavDoneMessage
  | PairIdMessage
  | GuestDeviceInfoMessage
  | { type: 'RECORDING_START' }
  | { type: 'RECORDING_STOP' };

// ─── API Responses ───────────────────────────────────────────
export interface ApiSuccess<T = unknown> {
  success: true;
  data: T;
}

export interface ApiError {
  success: false;
  error: string;
  code?: string;
}

export type ApiResponse<T = unknown> = ApiSuccess<T> | ApiError;

// ─── UI ──────────────────────────────────────────────────────
export type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface ToastItem {
  id: string;
  type: ToastType;
  message: string;
  duration?: number;
}

// lib/db.ts — IndexedDB recording storage using idb

import { openDB, DBSchema, IDBPDatabase } from 'idb';

export interface RecordingMeta {
  pairId: string;
  deviceId: string;
  role: 'HOST' | 'GUEST';
  language: string;
  gender: string;
  partnerName: string;
  partnerGender: string;
  durationSec: number;
  createdAt: number; // timestamp
  fileName: string;  // e.g. A4F9_ENGLISH_MALE_HOST_58261.wav
}

export interface RecordingRecord extends RecordingMeta {
  id: string;       // `${pairId}_${role}`
  localBlob: Blob;  // own microphone WAV
  remoteBlob: Blob; // partner audio WAV
}

interface BTDSchema extends DBSchema {
  recordings: {
    key: string;
    value: RecordingRecord;
    indexes: { by_pairId: string; by_createdAt: number };
  };
}

let dbPromise: Promise<IDBPDatabase<BTDSchema>> | null = null;

function getDB() {
  if (!dbPromise) {
    dbPromise = openDB<BTDSchema>('btd-recordings', 1, {
      upgrade(db) {
        const store = db.createObjectStore('recordings', { keyPath: 'id' });
        store.createIndex('by_pairId', 'pairId');
        store.createIndex('by_createdAt', 'createdAt');
      },
    });
  }
  return dbPromise;
}

export async function saveRecording(record: RecordingRecord): Promise<void> {
  const db = await getDB();
  await db.put('recordings', record);
}

export async function getAllRecordings(): Promise<RecordingRecord[]> {
  const db = await getDB();
  const all = await db.getAllFromIndex('recordings', 'by_createdAt');
  return all.reverse(); // newest first
}

export async function getRecording(id: string): Promise<RecordingRecord | undefined> {
  const db = await getDB();
  return db.get('recordings', id);
}

export async function deleteRecording(id: string): Promise<void> {
  const db = await getDB();
  await db.delete('recordings', id);
}

export function buildRecordingId(pairId: string, role: 'HOST' | 'GUEST'): string {
  return `${pairId}_${role}`;
}

export function buildFileName(
  deviceId: string,
  language: string,
  gender: string,
  role: 'HOST' | 'GUEST',
  pairId: string
): string {
  return `${deviceId}_${language}_${gender}_${role}_${pairId}.wav`;
}

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
  partnerDeviceId: string;
  durationSec: number;
  createdAt: number; // timestamp
  fileName: string;  // e.g. A4F9_ENGLISH_MALE_HOST_58261.wav
}

export interface RecordingRecord extends RecordingMeta {
  id: string;       // `${pairId}_${role}`
  blob: Blob;       // single stereo WAV (Mic=Left, Partner=Right)
  uploaded?: boolean; // Track if uploaded to Google Drive
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
    dbPromise = openDB<BTDSchema>('btd-recordings', 3, {
      upgrade(db) {
        if (db.objectStoreNames.contains('recordings')) {
          db.deleteObjectStore('recordings');
        }
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

export async function markRecordingAsUploaded(id: string): Promise<void> {
  const db = await getDB();
  const rec = await db.get('recordings', id);
  if (rec) {
    rec.uploaded = true;
    await db.put('recordings', rec);
  }
}

export async function getRecordingSequence(currentPairId: string): Promise<{ pairSeq: number; recSeq: number }> {
  const db = await getDB();
  const all = await db.getAll('recordings');
  
  // Chronological sort to assign PAIR numbers sequentially
  const sorted = [...all].sort((a, b) => a.createdAt - b.createdAt);
  const uniquePairs: string[] = [];
  for (const rec of sorted) {
    if (!uniquePairs.includes(rec.pairId)) {
      uniquePairs.push(rec.pairId);
    }
  }

  let pIdx = uniquePairs.indexOf(currentPairId);
  if (pIdx === -1) {
    uniquePairs.push(currentPairId);
    pIdx = uniquePairs.length - 1;
  }
  const pairSeq = pIdx + 1;

  // Count existing recordings for this pairId
  const count = all.filter((rec) => rec.pairId === currentPairId).length;
  const recSeq = count + 1;

  return { pairSeq, recSeq };
}

export function buildRecordingId(pairId: string, role: 'HOST' | 'GUEST'): string {
  return `${pairId}_${role}`;
}

export function buildFileName(
  deviceId: string,
  language: string,
  gender: string,
  role: 'HOST' | 'GUEST',
  pairSeq: number,
  recSeq: number,
  speakerName: string,
  pairId?: string,
  partnerDeviceId?: string,
  partnerGender?: string,
  partnerName?: string
): string {
  const langLower = language.toLowerCase();
  const roleLower = role.toLowerCase();
  const devLower = deviceId.toLowerCase();
  const genLower = gender.toLowerCase();
  
  const partnerRole = role === 'HOST' ? 'guest' : 'host';
  const partnerDevLower = partnerDeviceId ? partnerDeviceId.toLowerCase() : 'unknown';
  const partnerGenLower = partnerGender ? partnerGender.toLowerCase() : 'unknown';
  const withPartnerStr = `_WITH_${partnerRole}_${partnerDevLower}_${partnerGenLower}`;
  
  const pairPadded = String(pairSeq).padStart(3, '0');
  const recPadded = String(recSeq).padStart(3, '0');
  
  const nameClean = speakerName.trim().replace(/\s+/g, '_');
  const partnerNameClean = partnerName ? partnerName.trim().replace(/\s+/g, '_') : 'unknown';
  const namesStr = `${nameClean}_AND_${partnerNameClean}`;
  
  const meetingTag = pairId ? `_Meeting_${pairId}` : '';

  return `${langLower}_${roleLower}_${devLower}_${genLower}${withPartnerStr}${meetingTag}_PAIR${pairPadded} - ${recPadded}(${namesStr}).wav`;
}

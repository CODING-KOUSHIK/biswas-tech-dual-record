// lib/indexeddb.ts — IndexedDB wrapper using the idb library
// Stores recording metadata and WAV blobs locally on device.

import { openDB, type IDBPDatabase } from 'idb';
import type { RecordingMetadata } from '@/types';

const DB_NAME = 'biswas-tech-recordings';
const DB_VERSION = 1;
const METADATA_STORE = 'metadata';
const BLOBS_STORE = 'blobs';

interface BlobRecord {
  pairId: string;
  localBlob: Blob;  // This device's recording
  remoteBlob: Blob | null; // Partner's recording (received via data channel)
}

async function getDb(): Promise<IDBPDatabase> {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(METADATA_STORE)) {
        const store = db.createObjectStore(METADATA_STORE, { keyPath: 'pairId' });
        store.createIndex('date', 'date');
      }
      if (!db.objectStoreNames.contains(BLOBS_STORE)) {
        db.createObjectStore(BLOBS_STORE, { keyPath: 'pairId' });
      }
    },
  });
}

export async function saveRecording(
  metadata: RecordingMetadata,
  localBlob: Blob,
  remoteBlob: Blob | null
): Promise<void> {
  const db = await getDb();
  const tx = db.transaction([METADATA_STORE, BLOBS_STORE], 'readwrite');

  await tx.objectStore(METADATA_STORE).put(metadata);
  await tx.objectStore(BLOBS_STORE).put({
    pairId: metadata.pairId,
    localBlob,
    remoteBlob,
  } satisfies BlobRecord);

  await tx.done;
}

export async function updateRecordingWithRemote(
  pairId: string,
  remoteBlob: Blob
): Promise<void> {
  const db = await getDb();
  const tx = db.transaction([METADATA_STORE, BLOBS_STORE], 'readwrite');

  const existing = await tx.objectStore(BLOBS_STORE).get(pairId) as BlobRecord | undefined;
  if (!existing) throw new Error(`Recording ${pairId} not found`);

  await tx.objectStore(BLOBS_STORE).put({
    ...existing,
    remoteBlob,
  });

  const meta = await tx.objectStore(METADATA_STORE).get(pairId) as RecordingMetadata | undefined;
  if (meta) {
    await tx.objectStore(METADATA_STORE).put({ ...meta, hasGuestRecording: true });
  }

  await tx.done;
}

export async function getRecordings(): Promise<RecordingMetadata[]> {
  const db = await getDb();
  const all = await db.getAll(METADATA_STORE) as RecordingMetadata[];
  // Sort by date descending
  return all.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

export async function getRecordingBlobs(pairId: string): Promise<BlobRecord | null> {
  const db = await getDb();
  return (await db.get(BLOBS_STORE, pairId) as BlobRecord | undefined) ?? null;
}

export async function deleteRecording(pairId: string): Promise<void> {
  const db = await getDb();
  const tx = db.transaction([METADATA_STORE, BLOBS_STORE], 'readwrite');
  await tx.objectStore(METADATA_STORE).delete(pairId);
  await tx.objectStore(BLOBS_STORE).delete(pairId);
  await tx.done;
}

export async function getAllRecordingsWithBlobs(): Promise<
  Array<{ metadata: RecordingMetadata; blobs: BlobRecord }>
> {
  const db = await getDb();
  const allMeta = await db.getAll(METADATA_STORE) as RecordingMetadata[];
  const results: Array<{ metadata: RecordingMetadata; blobs: BlobRecord }> = [];

  for (const meta of allMeta) {
    const blobs = await db.get(BLOBS_STORE, meta.pairId) as BlobRecord | undefined;
    if (blobs) results.push({ metadata: meta, blobs });
  }

  return results;
}

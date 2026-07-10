// lib/zip.ts — JSZip helpers for downloading recording pairs and all recordings

import JSZip from 'jszip';
import type { RecordingMetadata } from '@/types';

interface BlobPair {
  localBlob: Blob;
  remoteBlob: Blob | null;
  metadata: RecordingMetadata;
  isHost: boolean;
}

function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  return blob.arrayBuffer();
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Download a ZIP containing the pair's Host.wav and Guest.wav
 */
export async function downloadPairZip({
  localBlob,
  remoteBlob,
  metadata,
  isHost,
}: BlobPair): Promise<void> {
  const zip = new JSZip();
  const folder = zip.folder(`Meeting_${metadata.pairId}`)!;

  const hostFilename = metadata.hostFilename;
  const guestFilename = metadata.guestFilename;

  if (isHost) {
    folder.file(hostFilename, await blobToArrayBuffer(localBlob));
    if (remoteBlob) {
      folder.file(guestFilename, await blobToArrayBuffer(remoteBlob));
    }
  } else {
    folder.file(guestFilename, await blobToArrayBuffer(localBlob));
    if (remoteBlob) {
      folder.file(hostFilename, await blobToArrayBuffer(remoteBlob));
    }
  }

  // Add metadata JSON
  folder.file('metadata.json', JSON.stringify(metadata, null, 2));

  const content = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  triggerDownload(content, `Meeting_${metadata.pairId}.zip`);
}

/**
 * Download a single ZIP containing all recordings.
 */
export async function downloadAllZip(
  recordings: Array<{ metadata: RecordingMetadata; localBlob: Blob; remoteBlob: Blob | null; isHost: boolean }>
): Promise<void> {
  const zip = new JSZip();

  for (const rec of recordings) {
    const folder = zip.folder(`Meeting_${rec.metadata.pairId}`)!;

    if (rec.isHost) {
      folder.file(rec.metadata.hostFilename, await blobToArrayBuffer(rec.localBlob));
      if (rec.remoteBlob) {
        folder.file(rec.metadata.guestFilename, await blobToArrayBuffer(rec.remoteBlob));
      }
    } else {
      folder.file(rec.metadata.guestFilename, await blobToArrayBuffer(rec.localBlob));
      if (rec.remoteBlob) {
        folder.file(rec.metadata.hostFilename, await blobToArrayBuffer(rec.remoteBlob));
      }
    }

    folder.file('metadata.json', JSON.stringify(rec.metadata, null, 2));
  }

  const content = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  const date = new Date().toISOString().split('T')[0];
  triggerDownload(content, `BiwasTech_Recordings_${date}.zip`);
}

/**
 * Build the WAV filename according to the spec.
 * Format: {deviceId}_{language}_{gender}_{role}_{pairId}.wav
 */
export function buildFilename(
  deviceId: string,
  language: string,
  gender: string,
  role: 'HOST' | 'GUEST',
  pairId: string
): string {
  return `${deviceId}_${language}_${gender}_${role}_${pairId}.wav`;
}

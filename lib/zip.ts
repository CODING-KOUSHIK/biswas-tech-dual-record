// lib/zip.ts — Create ZIP from recordings using JSZip

import JSZip from 'jszip';
import { RecordingRecord } from './db';

export async function downloadRecordingPair(record: RecordingRecord): Promise<void> {
  const zip = new JSZip();
  const folder = zip.folder(`Meeting_${record.pairId}`)!;

  folder.file(record.fileName, record.localBlob);
  folder.file(record.fileName.replace('_HOST_', '_REMOTE_HOST_').replace('_GUEST_', '_REMOTE_GUEST_'), record.remoteBlob);

  // Determine host/guest filenames
  const role = record.role;
  const localName = record.fileName;
  const remoteSuffix = role === 'HOST' ? 'GUEST' : 'HOST';
  const remoteFileName = `PARTNER_${remoteSuffix}_${record.pairId}.wav`;

  const folder2 = new JSZip().folder(`Meeting_${record.pairId}`)!;
  const zip2 = new JSZip();
  const f = zip2.folder(`Meeting_${record.pairId}`)!;
  f.file(localName, record.localBlob);
  f.file(remoteFileName, record.remoteBlob);

  const metadata = {
    pairId: record.pairId,
    createdAt: new Date(record.createdAt).toISOString(),
    durationSeconds: record.durationSec,
    language: record.language,
    role: record.role,
    deviceId: record.deviceId,
    gender: record.gender,
    partnerName: record.partnerName,
    partnerGender: record.partnerGender,
    files: [localName, remoteFileName],
  };
  f.file('metadata.json', JSON.stringify(metadata, null, 2));

  void folder; void folder2; // suppress unused warnings

  const blob = await zip2.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  triggerDownload(blob, `Meeting_${record.pairId}.zip`);
}

export async function downloadAllRecordings(records: RecordingRecord[]): Promise<void> {
  const zip = new JSZip();

  for (const record of records) {
    const folder = zip.folder(`Meeting_${record.pairId}`)!;
    folder.file(record.fileName, record.localBlob);
    const remoteSuffix = record.role === 'HOST' ? 'GUEST' : 'HOST';
    folder.file(`PARTNER_${remoteSuffix}_${record.pairId}.wav`, record.remoteBlob);

    const metadata = {
      pairId: record.pairId,
      createdAt: new Date(record.createdAt).toISOString(),
      durationSeconds: record.durationSec,
      language: record.language,
      role: record.role,
      deviceId: record.deviceId,
      gender: record.gender,
      partnerName: record.partnerName,
      partnerGender: record.partnerGender,
    };
    folder.file('metadata.json', JSON.stringify(metadata, null, 2));
  }

  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  const date = new Date().toISOString().slice(0, 10);
  triggerDownload(blob, `BTD_All_Recordings_${date}.zip`);
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

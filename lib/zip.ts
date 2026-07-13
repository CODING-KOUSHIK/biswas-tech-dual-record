// lib/zip.ts — Create ZIP from recordings using JSZip

import JSZip from 'jszip';
import { RecordingRecord } from './db';

export async function downloadRecordingPair(record: RecordingRecord): Promise<void> {
  const zip = new JSZip();
  const f = zip.folder(`Meeting_${record.pairId}`)!;

  const localName = record.fileName;

  // Extract sequence values from local fileName (e.g. PAIR001 - 001)
  const match = record.fileName.match(/_PAIR(\d+)\s*-\s*(\d+)\(/);
  const pairPadded = match ? match[1] : '001';
  const recPadded = match ? match[2] : '001';

  const remoteRole = record.role === 'HOST' ? 'guest' : 'host';
  const remoteDeviceId = (record as any).partnerDeviceId ? (record as any).partnerDeviceId.toLowerCase() : 'unknown';
  const remoteGender = record.partnerGender.toLowerCase();
  const remoteLanguage = record.language.toLowerCase();
  const remoteSpeakerName = record.partnerName.trim().replace(/\s+/g, '_');

  const remoteName = `${remoteLanguage}_${remoteRole}_${remoteDeviceId}_${remoteGender}_PAIR${pairPadded} - ${recPadded}(${remoteSpeakerName}).wav`;

  f.file(localName, record.localBlob);
  f.file(remoteName, record.remoteBlob);

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
    files: [localName, remoteName],
  };
  f.file('metadata.json', JSON.stringify(metadata, null, 2));

  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  triggerDownload(blob, `Meeting_${record.pairId}.zip`);
}

export async function downloadAllRecordings(records: RecordingRecord[]): Promise<void> {
  const zip = new JSZip();

  for (const record of records) {
    const folder = zip.folder(`Meeting_${record.pairId}`)!;
    
    const localName = record.fileName;

    const match = record.fileName.match(/_PAIR(\d+)\s*-\s*(\d+)\(/);
    const pairPadded = match ? match[1] : '001';
    const recPadded = match ? match[2] : '001';

    const remoteRole = record.role === 'HOST' ? 'guest' : 'host';
    const remoteDeviceId = (record as any).partnerDeviceId ? (record as any).partnerDeviceId.toLowerCase() : 'unknown';
    const remoteGender = record.partnerGender.toLowerCase();
    const remoteLanguage = record.language.toLowerCase();
    const remoteSpeakerName = record.partnerName.trim().replace(/\s+/g, '_');

    const remoteName = `${remoteLanguage}_${remoteRole}_${remoteDeviceId}_${remoteGender}_PAIR${pairPadded} - ${recPadded}(${remoteSpeakerName}).wav`;

    folder.file(localName, record.localBlob);
    folder.file(remoteName, record.remoteBlob);

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

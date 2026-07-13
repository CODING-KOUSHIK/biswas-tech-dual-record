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

  const metaText = `Pair ID: ${record.pairId}
Date: ${new Date(record.createdAt).toISOString()}
Duration: ${record.durationSec} seconds
Language: ${record.language}
Role: ${record.role}
Device ID: ${record.deviceId}
Gender: ${record.gender}
Partner Name: ${record.partnerName}
Partner Gender: ${record.partnerGender}
Partner Device ID: ${(record as any).partnerDeviceId || 'unknown'}
Files:
- ${localName}
- ${remoteName}`;

  f.file('metadata.txt', metaText);

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

    const metaText = `Pair ID: ${record.pairId}
Date: ${new Date(record.createdAt).toISOString()}
Duration: ${record.durationSec} seconds
Language: ${record.language}
Role: ${record.role}
Device ID: ${record.deviceId}
Gender: ${record.gender}
Partner Name: ${record.partnerName}
Partner Gender: ${record.partnerGender}
Partner Device ID: ${(record as any).partnerDeviceId || 'unknown'}
Files:
- ${localName}
- ${remoteName}`;

    folder.file('metadata.txt', metaText);
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

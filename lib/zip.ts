// lib/zip.ts — Create ZIP from recordings using JSZip

import JSZip from 'jszip';
import { RecordingRecord } from './db';

export function getIndividualFilenames(record: RecordingRecord) {
  const match = record.fileName.match(/_PAIR(\d+)\s*-\s*(\d+)\(/);
  const pairPadded = match ? match[1] : '001';
  const recPadded = match ? match[2] : '001';

  // Guarantee Meeting ID tag is present in local filename
  let localName = record.fileName;
  if (!localName.includes(`_Meeting_${record.pairId}`)) {
    localName = localName.replace(/_PAIR/, `_Meeting_${record.pairId}_PAIR`);
  }

  const remoteRole = record.role === 'HOST' ? 'guest' : 'host';
  const remoteDeviceId = (record as any).partnerDeviceId ? (record as any).partnerDeviceId.toLowerCase() : 'unknown';
  const remoteGender = record.partnerGender.toLowerCase();
  const remoteLanguage = record.language.toLowerCase();
  const remoteSpeakerName = record.partnerName.trim().replace(/\s+/g, '_');

  const remoteName = `${remoteLanguage}_${remoteRole}_${remoteDeviceId}_${remoteGender}_Meeting_${record.pairId}_PAIR${pairPadded} - ${recPadded}(${remoteSpeakerName}).wav`;

  const hostName = record.role === 'HOST' ? localName : remoteName;
  const guestName = record.role === 'HOST' ? remoteName : localName;

  const hostBlob = record.role === 'HOST' ? record.localBlob : record.remoteBlob;
  const guestBlob = record.role === 'HOST' ? record.remoteBlob : record.localBlob;

  return { hostName, guestName, hostBlob, guestBlob };
}

export async function getRecordingZipBlob(
  record: RecordingRecord,
  onProgress?: (percent: number) => void
): Promise<{ blob: Blob; filename: string }> {
  const zip = new JSZip();
  const f = zip.folder(`Meeting_${record.pairId}`)!;

  const { hostName, guestName, hostBlob, guestBlob } = getIndividualFilenames(record);

  f.file(hostName, hostBlob);
  f.file(guestName, guestBlob);

  const metaText = `Meeting / Pair ID: ${record.pairId}
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
- Host Audio: ${hostName}
- Guest Audio: ${guestName}`;

  f.file('metadata.txt', metaText);

  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' }, (metadata) => {
    if (onProgress) {
      onProgress(Math.min(100, Math.max(0, Math.round(metadata.percent))));
    }
  });

  const match = record.fileName.match(/_PAIR(\d+)\s*-\s*(\d+)\(/);
  const pairPadded = match ? match[1] : '001';
  const recPadded = match ? match[2] : '001';

  return { blob, filename: `Meeting_${record.pairId}_PAIR${pairPadded}_Rec${recPadded}.zip` };
}

export async function downloadRecordingPair(
  record: RecordingRecord,
  onProgress?: (percent: number) => void
): Promise<void> {
  const { blob, filename } = await getRecordingZipBlob(record, onProgress);
  triggerDownload(blob, filename);
}

export async function downloadAllRecordings(
  records: RecordingRecord[],
  onProgress?: (percent: number) => void
): Promise<void> {
  const zip = new JSZip();

  for (const record of records) {
    const folder = zip.folder(`Meeting_${record.pairId}`)!;
    const { hostName, guestName, hostBlob, guestBlob } = getIndividualFilenames(record);

    folder.file(hostName, hostBlob);
    folder.file(guestName, guestBlob);

    const metaText = `Meeting / Pair ID: ${record.pairId}
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
- Host Audio: ${hostName}
- Guest Audio: ${guestName}`;

    folder.file('metadata.txt', metaText);
  }

  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' }, (metadata) => {
    if (onProgress) {
      onProgress(Math.min(100, Math.max(0, Math.round(metadata.percent))));
    }
  });

  const date = new Date().toISOString().slice(0, 10);
  triggerDownload(blob, `BTD_All_Recordings_${date}.zip`);
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 5000);
}

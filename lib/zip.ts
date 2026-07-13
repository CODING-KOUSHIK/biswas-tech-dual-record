// lib/zip.ts — Create ZIP from recordings using JSZip

import JSZip from 'jszip';
import { RecordingRecord } from './db';

export function getIndividualFilenames(record: RecordingRecord) {
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

  const hostName = record.role === 'HOST' ? localName : remoteName;
  const guestName = record.role === 'HOST' ? remoteName : localName;

  const hostBlob = record.role === 'HOST' ? record.localBlob : record.remoteBlob;
  const guestBlob = record.role === 'HOST' ? record.remoteBlob : record.localBlob;

  return { hostName, guestName, hostBlob, guestBlob };
}

export async function getRecordingZipBlob(record: RecordingRecord): Promise<{ blob: Blob; filename: string }> {
  const zip = new JSZip();
  const f = zip.folder(`Meeting_${record.pairId}`)!;

  const { hostName, guestName, hostBlob, guestBlob } = getIndividualFilenames(record);

  f.file(hostName, hostBlob);
  f.file(guestName, guestBlob);

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
- ${hostName}
- ${guestName}`;

  f.file('metadata.txt', metaText);

  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  const match = record.fileName.match(/_PAIR(\d+)\s*-\s*(\d+)\(/);
  const pairPadded = match ? match[1] : '001';
  const recPadded = match ? match[2] : '001';

  return { blob, filename: `Meeting_${record.pairId}_PAIR${pairPadded}_Rec${recPadded}.zip` };
}

export async function downloadRecordingPair(record: RecordingRecord): Promise<void> {
  const { blob, filename } = await getRecordingZipBlob(record);
  triggerDownload(blob, filename);
}

export async function downloadAllRecordings(records: RecordingRecord[]): Promise<void> {
  const zip = new JSZip();

  for (const record of records) {
    const folder = zip.folder(`Meeting_${record.pairId}`)!;
    const { hostName, guestName, hostBlob, guestBlob } = getIndividualFilenames(record);

    folder.file(hostName, hostBlob);
    folder.file(guestName, guestBlob);

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
- ${hostName}
- ${guestName}`;

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
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 5000);
}

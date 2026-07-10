'use client';

// components/host/RecordingList.tsx — Displays all recordings stored in IndexedDB

import { useCallback, useEffect, useState } from 'react';
import { getRecordings, getRecordingBlobs, deleteRecording, getAllRecordingsWithBlobs } from '@/lib/indexeddb';
import { downloadPairZip, downloadAllZip } from '@/lib/zip';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import type { RecordingMetadata } from '@/types';

export function RecordingList({ isHost }: { isHost: boolean }) {
  const { showToast } = useToast();
  const [recordings, setRecordings] = useState<RecordingMetadata[]>([]);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [downloadingAll, setDownloadingAll] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const list = await getRecordings();
    setRecordings(list);
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const handleDownloadPair = async (pairId: string) => {
    setLoadingId(pairId);
    try {
      const blobs = await getRecordingBlobs(pairId);
      const meta = recordings.find((r) => r.pairId === pairId);
      if (!blobs || !meta) {
        showToast('Recording not found', 'error');
        return;
      }
      await downloadPairZip({
        localBlob: blobs.localBlob,
        remoteBlob: blobs.remoteBlob,
        metadata: meta,
        isHost,
      });
    } catch (err) {
      showToast('Download failed', 'error');
      console.error(err);
    } finally {
      setLoadingId(null);
    }
  };

  const handleDownloadAll = async () => {
    setDownloadingAll(true);
    try {
      const allData = await getAllRecordingsWithBlobs();
      await downloadAllZip(
        allData.map(({ metadata, blobs }) => ({
          metadata,
          localBlob: blobs.localBlob,
          remoteBlob: blobs.remoteBlob,
          isHost,
        }))
      );
    } catch {
      showToast('Download all failed', 'error');
    } finally {
      setDownloadingAll(false);
    }
  };

  const handleDelete = async (pairId: string) => {
    try {
      await deleteRecording(pairId);
      setDeleteTarget(null);
      showToast('Recording deleted', 'success');
      await reload();
    } catch {
      showToast('Delete failed', 'error');
    }
  };

  const formatDuration = (ms: number) => {
    const total = Math.floor(ms / 1000);
    const h = Math.floor(total / 3600).toString().padStart(2, '0');
    const m = Math.floor((total % 3600) / 60).toString().padStart(2, '0');
    const s = (total % 60).toString().padStart(2, '0');
    return `${h}:${m}:${s}`;
  };

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

  if (recordings.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500 text-sm">
        No recordings yet. Start a session to record.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-400">{recordings.length} recording{recordings.length !== 1 ? 's' : ''}</p>
        <Button
          size="sm"
          variant="ghost"
          onClick={handleDownloadAll}
          loading={downloadingAll}
        >
          Download All
        </Button>
      </div>

      <div className="space-y-3">
        {recordings.map((rec) => (
          <div
            key={rec.pairId}
            className="bg-white/5 border border-white/10 rounded-lg p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-mono bg-blue-600/20 text-blue-400 px-2 py-0.5 rounded">
                    #{rec.pairId}
                  </span>
                  <span className={`text-xs px-2 py-0.5 rounded ${rec.partnerGender === 'MALE' ? 'bg-sky-600/20 text-sky-400' : 'bg-pink-600/20 text-pink-400'}`}>
                    Partner: {rec.partnerGender}
                  </span>
                  <span className="text-xs bg-white/10 text-gray-300 px-2 py-0.5 rounded">
                    {rec.language}
                  </span>
                  {!rec.hasGuestRecording && (
                    <span className="text-xs bg-amber-600/20 text-amber-400 px-2 py-0.5 rounded">
                      Awaiting guest
                    </span>
                  )}
                </div>
                <p className="text-sm text-white">{formatDate(rec.date)}</p>
                <p className="text-xs text-gray-500">Duration: {formatDuration(rec.durationMs)}</p>
              </div>

              <div className="flex gap-2 shrink-0">
                <Button
                  size="sm"
                  onClick={() => handleDownloadPair(rec.pairId)}
                  loading={loadingId === rec.pairId}
                  title="Download pair ZIP"
                >
                  ↓ Pair
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => setDeleteTarget(rec.pairId)}
                  title="Delete recording"
                >
                  Delete
                </Button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Delete confirmation dialog */}
      <Modal
        isOpen={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title="Delete Recording?"
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-300">
            This will permanently delete recording <span className="font-mono text-white">#{deleteTarget}</span> from this device. This action cannot be undone.
          </p>
          <div className="flex gap-3">
            <Button
              variant="danger"
              onClick={() => deleteTarget && handleDelete(deleteTarget)}
              className="flex-1"
            >
              Delete
            </Button>
            <Button variant="ghost" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

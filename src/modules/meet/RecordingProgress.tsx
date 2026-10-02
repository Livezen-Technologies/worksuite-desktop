import { useQuery, useQueryClient } from '@tanstack/react-query';
import { downloadStatus, localRecordingStatus, serverRecordingStatus } from '@shared/recording-status';
import type { LocalRecording } from '@shared/types';
import { apiGet, apiPost } from '../../core/api';
import { call, errorMessage } from '../../core/bridge';
import { useTab } from '../../core/tab-context';
import { toast } from '../../core/toasts';
import { useNow } from '../calls/parts';
import type { Recording } from './api';
import { DownloadStatusView, RecordingStatusView } from './RecordingStatus';
import { transferAct, useLocalRecordings, useRecordingDownloads, useTransfers } from './recordings';

export function useServerRecordings() {
  return useQuery({
    queryKey: ['meet', 'recordings'],
    queryFn: ({ signal }) => apiGet<{ recordings: Recording[] }>('/api/meet/recordings', undefined, signal),
    refetchOnMount: 'always',
    refetchInterval: (q) => q.state.data?.recordings.some(r => r.status && !['ready', 'failed'].includes(r.status)) ? 10_000 : 60_000,
  });
}

/** Use the recorder's measured transfer state when this computer owns the capture. */
export function RecordingProgress({ recording, local: supplied }: { recording?: Omit<Recording, 'status'> & { status?: string }; local?: LocalRecording }) {
  const local = useLocalRecordings();
  const transfers = useTransfers();
  const downloads = useRecordingDownloads();
  const now = useNow(1_000);
  const qc = useQueryClient();
  const { navigate } = useTab();
  const mine = supplied ?? local.find(r => r.id === recording?.client_id || (!!recording?.drive_file_id && r.driveFileId === recording.drive_file_id));
  const transfer = mine?.transferId ? transfers.find(t => t.id === mine.transferId) : undefined;
  const status = mine ? localRecordingStatus(mine, transfer, now) : serverRecordingStatus(recording ?? {});
  const downloadId = (recording ? downloads[String(recording.id)] : undefined) ?? transfers.find(t => t.direction === 'download' && t.state !== 'cancelled' && t.fileId === String(mine?.driveFileId ?? recording?.drive_file_id))?.id;
  const downloaded = downloadStatus(transfers.find(t => t.id === downloadId), now);
  const run = (fn: () => Promise<unknown>) => () => void fn().catch(e => toast('error', errorMessage(e)));
  const fileId = mine?.driveFileId ?? recording?.drive_file_id;
  return <>
    <RecordingStatusView status={status} on={{
      ...(mine ? { retry: run(() => call('meetrec:retry', { id: mine.id })), reveal: run(() => call('meetrec:reveal', { id: mine.id })) } : recording ? { retry: run(async () => { await apiPost(`/api/meet/recordings/${recording.id}/retry`); await qc.invalidateQueries({ queryKey: ['meet'] }); await qc.invalidateQueries({ queryKey: ['meetings'] }); }) } : {}),
      ...(mine?.transferId ? { pause: transferAct('transfers:pause', mine.transferId), resume: transferAct('transfers:resume', mine.transferId), cancel: transferAct('transfers:cancel', mine.transferId) } : {}),
      ...(fileId ? { play: () => navigate(`/files?file=${fileId}&play=1`), openInDrive: () => navigate(`/files?file=${fileId}`) } : mine ? { play: run(() => call('meetrec:open', { id: mine.id })) } : {}),
    }} />
    {downloaded && downloadId ? <DownloadStatusView status={downloaded} on={{
      pause: transferAct('transfers:pause', downloadId), resume: transferAct('transfers:resume', downloadId), cancel: transferAct('transfers:cancel', downloadId), retry: transferAct('transfers:retry', downloadId), open: transferAct('transfers:open', downloadId), reveal: transferAct('transfers:reveal', downloadId),
    }} /> : null}
  </>;
}

/** Pending captures have no Drive file yet, so show them on Drive Home too. */
export function DriveRecordings({ fileId }: { fileId?: number }) {
  const q = useServerRecordings();
  const local = useLocalRecordings();
  const rows = (q.data?.recordings ?? []).filter(r => fileId ? r.drive_file_id === fileId : true);
  const ordered = [...rows.filter(r => r.status !== 'ready'), ...rows.filter(r => r.status === 'ready')];
  const pending = fileId ? [] : local.filter(r => r.state !== 'ready' && !rows.some(s => s.client_id === r.id || (!!s.drive_file_id && s.drive_file_id === r.driveFileId)));
  if (!rows.length && !pending.length) return null;
  return <section aria-label="Meeting recordings" className="flex flex-col gap-3 rounded-xl border border-line p-3">
    <h2 className="text-sm font-bold text-ink">Meeting recordings</h2>
    {pending.map(r => <div key={r.id} className="flex flex-col gap-1"><b className="text-sm text-ink">{r.title}</b><RecordingProgress local={r} /></div>)}
    {(fileId ? ordered : ordered.slice(0, 6)).map(r => <div key={r.id} className="flex flex-col gap-1"><b className="text-sm text-ink">{r.title}</b><RecordingProgress recording={r} /></div>)}
  </section>;
}

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { app } from '../../core/app-state';
import { useStore } from '../../core/store';
import { bytes } from '../../core/time';
import { FileBadge } from '../../components/ui';
import { acknowledgeMedia, cancelMedia, outgoing, outgoingForRoom, retryMedia, type MediaPhase, type OutgoingMedia } from './outgoing';
import type { ChatMessage } from './types';
import { errorMessage } from '../../core/bridge';
import { toast } from '../../core/toasts';

const labels: Record<MediaPhase, string> = { preparing: 'Preparing…', queued: 'Queued…', uploading: 'Uploading…', processing: 'Processing…', sending: 'Sending…', sent: 'Sent', failed: 'Failed', cancelled: 'Cancelled' };
export function useOutgoingMedia(roomId: string, messages: ChatMessage[]) {
  const transfers = useStore(app, (s) => s.transfers);
  useStore(outgoing, (s) => s.jobs);
  const ids = new Set(messages.flatMap((m) => m.client_message_id ? [m.client_message_id] : []));
  const jobs = outgoingForRoom(roomId, transfers).filter((j) => !ids.has(j.id));
  const confirmed = messages.map((m) => m.client_message_id).join(',');
  useEffect(() => { acknowledgeMedia(new Set(confirmed.split(','))); }, [confirmed]);
  return jobs;
}

export function OutgoingMediaBubbles({ roomId, messages }: { roomId: string; messages: ChatMessage[] }) {
  const jobs = useOutgoingMedia(roomId, messages);
  return <>{jobs.map((j) => <OutgoingMediaBubble key={j.id} job={j} />)}</>;
}
export function OutgoingMediaBubble({ job: j }: { job: OutgoingMedia }) {
  return <div className="mt-3 flex flex-col items-end gap-1" aria-label={`Outgoing ${j.name}`}>
    <div className="max-w-[84%] rounded-[12px] border border-line bg-selection p-2 text-ink">
      {j.preview ? (j.target.voice || /^audio\//.test(j.mime) ? <audio src={j.preview} controls preload="metadata" /> : /^video\//.test(j.mime) ? <video src={j.preview} muted preload="metadata" className="max-h-48 max-w-64 rounded" /> : <img src={j.preview} alt={j.name} className="max-h-48 max-w-64 rounded" />) : <FileBadge name={j.name} />}
      <p className="m-0 text-[12px] font-semibold">{j.name} · {bytes(j.size)}</p>
      {j.target.caption ? <p className="m-0 whitespace-pre-wrap text-[13px]">{j.target.caption}</p> : null}
      <div role="status" className="flex items-center gap-1 text-[11px]">
        {['preparing', 'processing', 'sending'].includes(j.phase) ? <span aria-hidden="true" className="h-3 w-3 animate-spin rounded-full border-2 border-primary border-t-transparent" /> : null}
        {labels[j.phase]}{j.phase === 'uploading' && j.progress !== null ? ` ${Math.round(j.progress * 100)}%` : ''}
      </div>
      {j.phase === 'uploading' && j.progress !== null ? <progress aria-label={`Upload ${j.name}`} max={1} value={j.progress} className="w-full" /> : null}
      {j.error ? <p role="alert" className="m-0 text-[12px] text-danger">{j.error}</p> : null}
      {['failed', 'cancelled'].includes(j.phase) ? <button type="button" onClick={() => void retryMedia(j).catch((e) => toast('error', errorMessage(e)))} className="mr-2 text-[12px] font-semibold text-primary">Retry</button> : null}
      {!['sent', 'failed', 'cancelled'].includes(j.phase) ? <button type="button" onClick={() => void cancelMedia(j).catch((e) => toast('error', errorMessage(e)))} className="text-[12px] font-semibold text-primary">Cancel</button> : null}
    </div>
  </div>;
}

/** Lives above modules/drawers: transfers continue and confirmation refreshes even after switching screens. */
export function ChatSendingStatus() {
  const qc = useQueryClient();
  const transfers = useStore(app, (s) => s.transfers);
  useStore(outgoing, (s) => s.jobs);
  const rooms = [...new Set(transfers.filter((t) => t.chat).map((t) => t.chat!.roomId))];
  const fingerprint = transfers.filter((t) => t.chat).map((t) => `${t.id}:${t.state}`).join(',');
  useEffect(() => {
    for (const room of rooms) void qc.invalidateQueries({ queryKey: ['chat', 'messages', room] });
    void qc.invalidateQueries({ queryKey: ['chat', 'rooms'] });
    // The fingerprint changes on registration/confirmation/failure, rather than every progress tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fingerprint, qc]);
  const localRooms = outgoing.get().jobs.map((j) => j.roomId);
  const jobs = [...new Set([...rooms, ...localRooms])].flatMap((room) => outgoingForRoom(room, transfers));
  const active = jobs.filter((j) => !['sent', 'cancelled', 'failed'].includes(j.phase));
  if (!active.length) return null;
  return <div role="status" aria-label="Chat sending status" className="no-drag fixed right-4 bottom-3 z-40 rounded-full border border-line bg-surface px-3 py-1 text-[11px] text-ink shadow">Sending… {active.length} attachment{active.length === 1 ? '' : 's'}</div>;
}

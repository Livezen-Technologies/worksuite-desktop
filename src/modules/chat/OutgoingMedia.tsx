import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { app } from '../../core/app-state';
import { useStore } from '../../core/store';
import { bytes, timeLabel } from '../../core/time';
import { Icon } from '../../components/Icon';
import { FileBadge, cx } from '../../components/ui';
import { bubbleTone } from './kit/MessageBubble';
import type { Look } from './kit/MessageAttachment';
import { knownVoice } from './kit/voice';
import { voiceBubbleShown } from './kit/voiceMetrics';
import { VoiceMessage, type VoiceUpload } from './kit/VoiceMessage';
import { acknowledgeMedia, cancelMedia, outgoing, outgoingForRoom, retryMedia, sendShare, type MediaPhase, type OutgoingMedia } from './outgoing';
import type { ChatMessage } from './types';
import { errorMessage } from '../../core/bridge';
import { toast } from '../../core/toasts';

// What each step is called on the bubble: the server's check reads as what it is, not a bare "Processing".
const labels: Record<MediaPhase, string> = { preparing: 'Preparing…', queued: 'Waiting to send…', uploading: 'Uploading', processing: 'Checking the file…', sending: 'Posting…', sent: 'Sent', failed: 'Failed', cancelled: 'Cancelled' };
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
export function OutgoingMediaBubble({ job: j, look = 'page' }: { job: OutgoingMedia; look?: Look }) {
  if (j.target.voice) return <OutgoingVoice job={j} look={look} />;
  return <div className="mt-3 flex flex-col items-end gap-1" aria-label={`Outgoing ${j.name}`}>
    <div className="max-w-[84%] rounded-[12px] border border-line bg-selection p-2 text-ink">
      {j.preview ? (/^audio\//.test(j.mime) ? <audio src={j.preview} controls preload="metadata" /> : /^video\//.test(j.mime) ? <video src={j.preview} muted preload="metadata" className="max-h-48 max-w-64 rounded" /> : <img src={j.preview} alt={j.name} className="max-h-48 max-w-64 rounded" />) : <FileBadge name={j.name} />}
      <p className="m-0 text-[12px] font-semibold">{j.name} · {bytes(j.size)}</p>
      {j.target.caption ? <p className="m-0 whitespace-pre-wrap text-[13px]">{j.target.caption}</p> : null}
      {['sent', 'failed', 'cancelled'].includes(j.phase) ? <div role="status" className="text-[11px]">{labels[j.phase]}</div> : <SendProgress job={j} />}
      {j.error ? <p role="alert" className="m-0 text-[12px] text-danger">{j.error}</p> : null}
      {['failed', 'cancelled'].includes(j.phase) ? <button type="button" onClick={() => void retryMedia(j).catch((e) => toast('error', errorMessage(e)))} className="mr-2 text-[12px] font-semibold text-primary">Retry</button> : null}
    </div>
  </div>;
}

/**
 * How sending goes, as one bar that fills once from Preparing to Posting (sendShare): the bytes fill most of it with
 * how much has gone and how fast, and a step with no measure of its own (the server checking the file) shimmers.
 */
function SendProgress({ job: j }: { job: OutgoingMedia }) {
  const { share, moving } = sendShare(j.phase, j.progress);
  const counting = j.phase === 'uploading' && j.progress !== null;
  const detail = counting ? [`${bytes(j.sent ?? Math.round((j.progress ?? 0) * j.size))} of ${bytes(j.size)}`, j.speed ? `${bytes(j.speed)}/s` : null].filter(Boolean).join(' · ') : null;
  return (
    <div className="mt-1 flex min-w-[200px] flex-col gap-1">
      <div className="flex items-center gap-2 text-[11.5px]">
        <span role="status" className="shrink-0 font-medium">{labels[j.phase]}{counting ? ` ${Math.round(j.progress! * 100)}%` : ''}</span>
        <span className="ml-auto min-w-0 truncate text-ink-3 tabular-nums">{detail}</span>
        <button type="button" aria-label="Cancel" title="Cancel sending" onClick={() => void cancelMedia(j).catch((e) => toast('error', errorMessage(e)))} className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-ink-3 hover:bg-primary/10 hover:text-ink">
          <Icon name="x" size={12} />
        </button>
      </div>
      <span role="progressbar" aria-label={`Sending ${j.name}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(share * 100)} aria-valuetext={labels[j.phase]} className="relative h-1.5 overflow-hidden rounded-full bg-primary/15">
        <span className="absolute inset-y-0 left-0 rounded-full bg-primary transition-[width] duration-300 ease-out" style={{ width: `${share * 100}%` }} />
        {moving ? null : <span aria-hidden="true" className="absolute inset-y-0 w-1/3 rounded-full bg-gradient-to-r from-transparent via-white/50 to-transparent motion-safe:animate-[ws-indeterminate_1.2s_ease-in-out_infinite]" />}
      </span>
    </div>
  );
}

/**
 * A voice message on its way (#285, #300): the voice player at once, with the length and loudness measured while it
 * was recorded, playing its copy on this computer. Under it, how sending goes in words — "Sending…" (with how much
 * has gone), "Retrying in 15 s" between automatic tries, and "Sent" only once the server has confirmed it — and the
 * ring on the play button says the same, with ✕ on it to stop. When it did not go: "Not sent", Retry on the ring and
 * Cancel beside it, which takes the bubble and the recording away. No file name, size or "Processing…".
 */
function OutgoingVoice({ job: j, look }: { job: OutgoingMedia; look: Look }) {
  const failed = j.phase === 'failed' || j.phase === 'cancelled';
  const fail = (e: unknown) => toast('error', errorMessage(e));
  // Painted: the Send → bubble time (#300).
  useEffect(() => {
    const id = j.id;
    const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(() => voiceBubbleShown(id)) : (voiceBubbleShown(id), 0);
    return () => { if (raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf); };
  }, [j.id]);
  const upload: VoiceUpload = {
    progress: j.phase === 'uploading' ? j.progress : null,
    failed,
    error: j.error,
    onRetry: () => void retryMedia(j).catch(fail),
    onCancel: failed || j.phase === 'sent' ? undefined : () => void cancelMedia(j).catch(fail),
  };
  const known = knownVoice(j.id);
  const file = { url: null, download_url: null, size: j.size, duration_ms: j.target.durationMs ?? known?.ms ?? null, waveform: j.target.waveform ?? known?.peaks ?? null };
  const player = <VoiceMessage file={file} own look={look} src={j.preview ?? null} upload={upload} />;
  const meta = (
    <span className="inline-flex items-center gap-1 text-[11px] text-ink-3">
      {failed ? (
        <>
          <b className="font-semibold text-danger" title={j.error ?? undefined}>{j.phase === 'cancelled' ? 'Cancelled' : 'Not sent'}</b>
          <button type="button" aria-label="Discard the voice message" title="Cancel: remove this voice message" onClick={() => void cancelMedia(j).catch(fail)} className="font-semibold text-ink-2 hover:text-danger hover:underline">
            Cancel
          </button>
        </>
      ) : (
        <span role="status" data-voice-status={j.phase === 'sent' ? 'sent' : 'sending'}>
          <VoiceStatus job={j} />
        </span>
      )}
      {timeLabel(j.createdAt)}
      {failed ? null : j.phase === 'sent' ? <Icon name="check" size={11} label="Sent" /> : <Icon name="clock" size={11} label="Sending" />}
    </span>
  );
  return look === 'drawer' ? (
    <div data-outgoing-voice className="mt-2.5 flex justify-end">
      <div className={cx('flex max-w-[84%] flex-col items-end rounded-[10px] p-1 text-[13px] text-ink shadow-[0_1px_1px_rgb(var(--ws-shadow-rgb)/.1)]', bubbleTone({ own: true, author: { role: 'self' } }, 'drawer'))}>
        {player}
        <span className="px-1.5 pb-0.5">{meta}</span>
      </div>
    </div>
  ) : (
    <div data-outgoing-voice className="mt-3 flex flex-col items-end gap-1">
      {player}
      {meta}
    </div>
  );
}

/** "Sending…", "Sending… 40%", "Retrying in 15 s", "Sent" (#300). */
export function voiceStatusText(j: Pick<OutgoingMedia, 'phase' | 'progress' | 'retryAt'>, now = Date.now()): string {
  if (j.phase === 'sent') return 'Sent';
  if (j.retryAt) {
    const s = Math.max(1, Math.ceil((Date.parse(j.retryAt) - now) / 1000));
    if (Number.isFinite(s)) return `Retrying in ${s} s`;
  }
  if (j.phase === 'uploading' && j.progress !== null) return `Sending… ${Math.round(Math.min(1, Math.max(0, j.progress)) * 100)}%`;
  return 'Sending…';
}

function VoiceStatus({ job: j }: { job: OutgoingMedia }) {
  // The retry countdown moves once a second; nothing else needs a clock.
  const [, tick] = useState(0);
  useEffect(() => {
    if (!j.retryAt) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [j.retryAt]);
  return <>{voiceStatusText(j)}</>;
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
  // The bar sums every file by its size, so a large one weighs as much as it takes.
  const total = active.reduce((n, j) => n + Math.max(1, j.size), 0);
  const share = active.reduce((n, j) => n + sendShare(j.phase, j.progress).share * Math.max(1, j.size), 0) / total;
  const pct = Math.round(share * 100);
  const checking = active.every((j) => j.phase === 'processing' || j.phase === 'sending');
  return (
    <div role="status" aria-label="Chat sending status" className="no-drag fixed right-4 bottom-3 z-40 flex items-center gap-2 rounded-full border border-line bg-surface py-1 pr-3 pl-2.5 text-[11px] text-ink shadow">
      <span aria-hidden="true" className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      <span>
        {checking ? 'Finishing' : 'Sending'} {active.length} attachment{active.length === 1 ? '' : 's'}
      </span>
      <span className="relative h-1 w-14 overflow-hidden rounded-full bg-primary/15">
        <span className="absolute inset-y-0 left-0 rounded-full bg-primary transition-[width] duration-300 ease-out" style={{ width: `${pct}%` }} />
      </span>
      <span className="w-7 text-right text-ink-3 tabular-nums">{pct}%</span>
    </div>
  );
}

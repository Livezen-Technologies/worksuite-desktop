import { useId, useState, type ReactNode } from 'react';
import type { RecordingPhase, RecordingStatus } from '@shared/recording-status';
import type { LocalRecording } from '@shared/types';
import { bytes, dateLabel, timeLabel } from '../../core/time';
import { Icon } from '../../components/Icon';
import { Button, cx } from '../../components/ui';
import { mediaUrl } from '../files/api';
import type { Recording } from './api';
import { ProgressBar } from './RecordingStatus';

/**
 * One card per recording (worksuite-desktop#240). A recording made here used to be listed twice — once in a
 * full-width processing card from this computer's ledger and again in the grid from the server's list — so the
 * two are joined into one item first, and the item's own card says how it stands: one status pill, one line of
 * progress, the error on one line with Details, the one action that fits now, and everything else in ⋯.
 */

/** A recording as listed: the server's row, this computer's ledger entry, or both when they are the same recording. */
export interface RecordingItem {
  key: string;
  server?: Recording;
  local?: LocalRecording;
}

/** This computer's ledger entry for a server row: the same client id, or the same file in Drive. */
export function localFor(r: Recording, local: LocalRecording[]): LocalRecording | undefined {
  return local.find((x) => (!!r.client_id && x.id === r.client_id) || (!!r.drive_file_id && x.driveFileId === r.drive_file_id));
}

/**
 * Every recording once (#240): the server's rows, each with this computer's entry when it made it, and before them
 * the ones made here that the server does not list yet. A finished one only the ledger knows stays out: the server
 * has it, or it was removed from the list.
 */
export function recordingItems(rows: Recording[], local: LocalRecording[]): RecordingItem[] {
  const listed = rows.map((r) => ({ key: `s:${r.id}`, server: r, local: localFor(r, local) }));
  const claimed = new Set(listed.map((x) => x.local?.id).filter(Boolean));
  const pending = local.filter((x) => x.state !== 'ready' && !claimed.has(x.id)).map((x) => ({ key: `l:${x.id}`, local: x }));
  return [...pending, ...listed];
}

export type Pill = 'Recording' | 'Finishing' | 'Uploading' | 'Ready' | 'Failed';

const PILL_OF: Record<RecordingPhase, Pill> = {
  starting: 'Recording',
  recording: 'Recording',
  stopping: 'Finishing',
  finalizing: 'Finishing',
  processing: 'Finishing',
  queued: 'Uploading',
  uploading: 'Uploading',
  paused: 'Uploading',
  ready: 'Ready',
  failed: 'Failed',
};

/** The one status pill: Recording · Finishing · Uploading · Ready · Failed. */
export function pillOf(status: RecordingStatus): Pill {
  return PILL_OF[status.phase];
}

const PILL_TONE: Record<Pill, string> = {
  Recording: 'bg-danger-bg text-danger',
  Finishing: 'bg-primary/15 text-primary',
  Uploading: 'bg-primary/15 text-primary',
  Ready: 'bg-success-bg text-success',
  Failed: 'bg-danger-bg text-danger',
};

/** "Finishing… 40%", "Uploading 2.0 MB of 5.0 MB", from what was measured only; null when there is nothing to say. */
export function progressLine(status: RecordingStatus): string | null {
  const p = status.progress;
  const pct = p?.percent !== null && p?.percent !== undefined ? `${p.percent}%` : null;
  const of = p && p.done !== null && p.total !== null ? `${bytes(p.done)} of ${bytes(p.total)}` : null;
  switch (status.phase) {
    case 'starting':
      return 'Starting…';
    case 'recording':
      return p?.done ? `Recording… ${bytes(p.done)}` : 'Recording…';
    case 'stopping':
    case 'finalizing':
    case 'processing':
      return pct ? `Finishing… ${pct}` : 'Finishing…';
    case 'queued':
      return of ? `Waiting to upload · ${of}` : 'Waiting to upload…';
    case 'paused':
      return of ? `Paused · ${of}` : 'Paused';
    case 'uploading':
      return of ? `Uploading ${of}${pct ? ` · ${pct}` : ''}` : pct ? `Uploading… ${pct}` : 'Uploading…';
    default:
      return null;
  }
}

/** The card's one main action, when there is one that can work now. */
export type MainAction = 'play' | 'fixPermission' | 'retryUpload' | 'retry' | 'resume' | 'delete';

export function mainActionOf(status: RecordingStatus, item: RecordingItem): MainAction | null {
  if (status.playable && status.actions.includes('play')) return 'play';
  if (status.actions.includes('fixPermission')) return 'fixPermission';
  if (status.phase === 'paused' && status.actions.includes('resume')) return 'resume';
  if (status.actions.includes('retry')) {
    const failedAt = item.local?.failedAt;
    // A failed upload (or filing in Drive) can be tried again; so can finishing that stopped on an error here.
    return !item.local || failedAt === 'uploading' || failedAt === 'registering' ? 'retryUpload' : 'retry';
  }
  if (status.actions.includes('delete')) return 'delete';
  return null;
}

const MAIN_LABEL: Record<MainAction, string> = {
  play: 'Play',
  fixPermission: 'Fix permission',
  retryUpload: 'Retry upload',
  retry: 'Try again',
  resume: 'Resume upload',
  delete: 'Delete',
};

function duration(seconds: number | null | undefined): string | null {
  if (!seconds || seconds <= 0) return null;
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** Title, then date and time · duration · size · where it is saved. */
export function recordingMeta(item: RecordingItem): string {
  const r = item.server;
  const l = item.local;
  const at = r?.created_at ?? l?.startedAt ?? null;
  const secs = r?.duration ?? (l?.durationMs ? l.durationMs / 1000 : null);
  const size = r?.size ?? (l?.bytes || null);
  const uploaded = !!(r?.drive_file_id ?? l?.driveFileId);
  const where = uploaded ? 'Uploaded' : l?.fileName ? 'This computer' : null;
  const when = at ? [dateLabel(at).replace(/, \d{4}$/, ''), timeLabel(at)].filter(Boolean).join(', ') : null;
  return [when, duration(secs), size ? bytes(size) : null, where].filter(Boolean).join(' · ');
}

/** ⓘ beside a heading: what would otherwise be a paragraph, shown on hover or focus. */
export function InfoTip({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <span className="relative inline-flex" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button
        type="button"
        aria-label={label}
        aria-describedby={open ? id : undefined}
        aria-expanded={open}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
        className="flex h-6 w-6 items-center justify-center rounded-full text-ink-3 hover:bg-subtle hover:text-ink"
      >
        <Icon name="info" size={14} />
      </button>
      {open ? (
        <span id={id} role="tooltip" className="absolute left-0 top-7 z-30 w-[280px] rounded-[10px] border border-line bg-surface p-2.5 text-[12px] font-normal text-ink-2 shadow-lg">
          {children}
        </span>
      ) : null}
    </span>
  );
}

export interface RecordingCardProps {
  item: RecordingItem;
  status: RecordingStatus;
  /** The download of this recording to this computer, shown apart from whether it is ready to play. */
  download?: ReactNode;
  onPlay: () => void;
  onMain: (a: MainAction) => void;
  /** Opens the ⋯ menu under the given button. */
  onMore: (button: HTMLElement) => void;
  moreLabel: string;
}

export function RecordingCard({ item, status, download, onPlay, onMain, onMore, moreLabel }: RecordingCardProps) {
  const [details, setDetails] = useState(false);
  const name = item.server?.title || item.local?.title || 'Meeting recording';
  const pill = pillOf(status);
  const line = status.phase === 'ready' || status.phase === 'failed' ? null : progressLine(status);
  const main = mainActionOf(status, item);
  const failed = status.phase === 'failed';
  const problem = failed || status.stalled;
  const thumb = item.server?.thumbnail_url && status.playable ? mediaUrl(item.server.thumbnail_url) : null;
  return (
    <div data-recording={item.key} data-phase={status.phase} className="flex min-w-0 flex-col gap-2 rounded-[12px] border border-line p-2.5">
      <div className="flex min-w-0 items-start gap-3">
        <button
          type="button"
          disabled={!status.playable}
          aria-label={`Play ${name}`}
          title={status.playable ? 'Play' : pill}
          onClick={onPlay}
          className="relative flex h-[60px] w-[96px] shrink-0 flex-col items-center justify-center gap-0.5 overflow-hidden rounded-[9px] bg-[#D8E4F6] text-[#24365F] disabled:cursor-default dark:bg-selection dark:text-ink"
        >
          {thumb ? <img src={thumb} alt="" className="absolute inset-0 h-full w-full object-cover" onError={(e) => { e.currentTarget.style.display = 'none'; }} /> : null}
          {failed ? (
            <>
              <Icon name="video-off" size={18} className="relative" />
              <span className="relative text-[10.5px] font-semibold">No video</span>
            </>
          ) : (
            <Icon name={status.playable ? 'play' : pill === 'Recording' ? 'video' : 'clock'} size={20} className="relative" />
          )}
        </button>
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex min-w-0 items-center gap-1.5">
            <b className="min-w-0 flex-1 truncate text-[13.5px] text-ink" title={name}>{name}</b>
            <span data-testid="recording-pill" className={cx('shrink-0 rounded-full px-2 py-px text-[11px] font-bold', status.stalled && !failed ? 'bg-warning-bg text-warning' : PILL_TONE[pill])}>{pill}</span>
          </span>
          <span className="truncate text-[12px] text-ink-3">{recordingMeta(item)}</span>
        </span>
        <button type="button" aria-label={moreLabel} title={moreLabel} aria-haspopup="menu" onClick={(e) => onMore(e.currentTarget)} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] text-ink-2 hover:bg-subtle hover:text-ink">
          <Icon name="more-vertical" size={16} />
        </button>
      </div>
      {line && status.progress ? (
        <div className="flex flex-col gap-1">
          <span className="text-[11.5px] text-ink-2 tabular-nums">{line}</span>
          <ProgressBar progress={status.progress} label={pill} />
        </div>
      ) : null}
      {status.note ? (
        <div className={cx('flex min-w-0 items-start gap-1.5 text-[12px]', failed ? 'text-danger' : status.stalled ? 'text-[#9A4A06] dark:text-warning' : 'text-ink-3')}>
          <span role={problem ? 'alert' : 'status'} className={cx('min-w-0 flex-1', details ? 'whitespace-normal' : 'truncate')} title={details ? undefined : status.note}>
            {status.note}
          </span>
          {problem ? (
            <button type="button" aria-expanded={details} onClick={() => setDetails(!details)} className="shrink-0 font-semibold text-primary hover:underline">
              {details ? 'Less' : 'Details'}
            </button>
          ) : null}
        </div>
      ) : null}
      {main ? (
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" variant={main === 'delete' ? 'secondary' : 'primary'} onClick={() => (main === 'play' ? onPlay() : onMain(main))}>
            {MAIN_LABEL[main]}
          </Button>
          {/* An empty recording: Delete beside Fix permission (#240), never Try again. */}
          {main === 'fixPermission' && status.actions.includes('delete') ? <Button size="sm" onClick={() => onMain('delete')}>Delete</Button> : null}
        </div>
      ) : null}
      {download}
    </div>
  );
}

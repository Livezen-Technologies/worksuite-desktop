import type { DownloadAction, DownloadStatus, MeasuredProgress, RecordingAction, RecordingStatus } from '@shared/recording-status';
import { etaLabel } from '@shared/recording-status';
import { bytes } from '../../core/time';
import { Button, cx } from '../../components/ui';

/**
 * A recording's status where it is listed (worksuite-desktop#89): what step it is at, how far, where it is kept,
 * what to do when it is stuck or failed, and the actions that make sense now. The words and the actions come from
 * `@shared/recording-status`; this only shows them.
 */

const ACTION_LABEL: Record<RecordingAction, string> = {
  retry: 'Try again',
  pause: 'Pause',
  resume: 'Resume',
  cancel: 'Cancel transfer',
  play: 'Play',
  openInDrive: 'Open in Drive',
  reveal: 'Show the file',
  fixPermission: 'Fix permission',
  delete: 'Delete',
};

const DOWNLOAD_LABEL: Record<DownloadAction, string> = {
  pause: 'Pause',
  resume: 'Resume',
  cancel: 'Cancel transfer',
  retry: 'Try again',
  open: 'Open',
  reveal: 'Show in folder',
};

const TONE: Record<RecordingStatus['tone'], string> = {
  progress: 'bg-primary/15 text-primary',
  success: 'bg-success-bg text-success',
  warning: 'bg-warning-bg text-warning-ink dark:bg-warning-bg dark:text-warning',
  danger: 'bg-danger-bg text-danger',
};

/** "42% · 120 MB of 300 MB · about 3 min left", from what was measured only. */
export function progressText(p: MeasuredProgress): string {
  return [
    p.percent !== null ? `${p.percent}%` : null,
    p.done !== null && p.total !== null ? `${bytes(p.done)} of ${bytes(p.total)}` : p.done ? bytes(p.done) : null,
    p.etaSeconds !== null ? etaLabel(p.etaSeconds) || null : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** A bar for what was measured, and one that moves without a number for what cannot be. */
export function ProgressBar({ progress, label }: { progress: MeasuredProgress; label: string }) {
  const text = progressText(progress);
  return (
    <span
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={progress.percent ?? undefined}
      aria-valuetext={text || `${label}…`}
      data-indeterminate={progress.percent === null ? 'true' : undefined}
      className="relative block h-1.5 overflow-hidden rounded-full bg-subtle"
    >
      {progress.percent === null ? (
        <span className="absolute inset-y-0 w-1/3 rounded-full bg-primary/70 motion-safe:animate-[ws-indeterminate_1.2s_ease-in-out_infinite]" />
      ) : (
        <span className="absolute inset-y-0 left-0 rounded-full bg-primary transition-[width] duration-300" style={{ width: `${progress.percent}%` }} />
      )}
    </span>
  );
}

export function RecordingStatusView({ status, on, compact }: { status: RecordingStatus; on: Partial<Record<RecordingAction, () => void>>; compact?: boolean }) {
  const actions = status.actions.filter((a) => on[a]);
  const text = status.progress ? progressText(status.progress) : '';
  return (
    <div className="flex min-w-0 flex-col gap-1.5" data-phase={status.phase}>
      <div className="flex flex-wrap items-center gap-1.5 text-[11.5px]">
        <span className={cx('rounded-full px-2 py-px font-bold', TONE[status.tone])}>{status.label}</span>
        {status.savedLocally ? <span className="rounded-full bg-subtle px-2 py-px font-semibold text-ink-2">Saved locally</span> : null}
        {status.savedToDrive ? <span className="rounded-full bg-subtle px-2 py-px font-semibold text-ink-2">Saved to Drive</span> : null}
        {text ? <span className="text-ink-3">{text}</span> : null}
      </div>
      {status.progress && (!compact || !status.playable) ? <ProgressBar progress={status.progress} label={status.label} /> : null}
      {status.note ? (
        <span role={status.tone === 'danger' || status.stalled ? 'alert' : 'status'} className={cx('text-[12px]', status.tone === 'danger' ? 'text-danger' : status.stalled ? 'text-warning-ink dark:text-warning' : 'text-ink-2')}>
          {status.note}
        </span>
      ) : null}
      {actions.length ? (
        <div className="flex flex-wrap gap-1.5">
          {actions.map((a) => (
            <Button key={a} size="sm" variant={a === 'retry' || a === 'play' || a === 'fixPermission' ? 'primary' : 'secondary'} onClick={on[a]}>
              {ACTION_LABEL[a]}
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** A recording's download to this computer: Downloading, then Downloaded with Open and Show in folder. */
export function DownloadStatusView({ status, on }: { status: DownloadStatus; on: Partial<Record<DownloadAction, () => void>> }) {
  const actions = status.actions.filter((a) => on[a]);
  const text = status.progress ? progressText(status.progress) : '';
  return (
    <div className="flex min-w-0 flex-col gap-1" data-download={status.phase}>
      <div className="flex flex-wrap items-center gap-1.5 text-[11.5px]">
        <span className={cx('font-bold', status.phase === 'downloaded' ? 'text-success' : status.phase === 'failed' ? 'text-danger' : 'text-ink-2')}>{status.label}</span>
        {text ? <span className="text-ink-3">{text}</span> : null}
        {actions.map((a) => (
          <button key={a} type="button" onClick={on[a]} className="font-bold text-primary hover:underline">
            {DOWNLOAD_LABEL[a]}
          </button>
        ))}
      </div>
      {status.progress && status.phase !== 'downloaded' ? <ProgressBar progress={status.progress} label={status.label} /> : null}
      {status.note ? (
        <span role={status.phase === 'failed' || status.stalled ? 'alert' : 'status'} className={cx('text-[11.5px]', status.phase === 'failed' ? 'text-danger' : 'text-ink-2')}>
          {status.note}
        </span>
      ) : null}
    </div>
  );
}

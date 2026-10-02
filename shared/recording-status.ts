import type { LocalRecording, Transfer } from './types';

/**
 * How a meeting recording stands, in one place (worksuite-desktop#89): the same words, progress and actions in Meet,
 * in a meeting's details and wherever else a recording is listed, whether it was recorded on this computer (the
 * recorder's ledger and its upload in the transfer queue) or by the media server (the server's row).
 *
 * Progress is only ever what was measured: a step nobody can measure (finishing the file, the media server's
 * processing) has no percentage, and the screens show it moving without one. Downloading a recording is told
 * apart from it being ready to play: one is about the copy on this computer, the other about the recording.
 */

export type RecordingPhase = 'starting' | 'stopping' | 'recording' | 'finalizing' | 'queued' | 'processing' | 'uploading' | 'ready' | 'paused' | 'failed';
export type RecordingAction = 'retry' | 'pause' | 'resume' | 'cancel' | 'play' | 'openInDrive' | 'reveal';
export type DownloadAction = 'pause' | 'resume' | 'cancel' | 'retry' | 'open' | 'reveal';

export interface MeasuredProgress {
  /** Null when it cannot be measured: shown moving, never as a made-up number. */
  percent: number | null;
  done: number | null;
  total: number | null;
  /** Seconds left at the speed it is going, when there is one. */
  etaSeconds: number | null;
}

export interface RecordingStatus {
  phase: RecordingPhase;
  label: string;
  tone: 'progress' | 'success' | 'warning' | 'danger';
  progress: MeasuredProgress | null;
  savedLocally: boolean;
  savedToDrive: boolean;
  /** Ready to play: the video was checked to be whole, and it is in Drive. */
  playable: boolean;
  /** Gone on far longer than the step takes: `note` says what to do. */
  stalled: boolean;
  note: string | null;
  actions: RecordingAction[];
}

export interface DownloadStatus {
  phase: 'queued' | 'downloading' | 'paused' | 'failed' | 'downloaded';
  label: string;
  progress: MeasuredProgress | null;
  stalled: boolean;
  note: string | null;
  actions: DownloadAction[];
}

export const PHASE_LABEL: Record<RecordingPhase, string> = {
  starting: 'Starting Recording…',
  stopping: 'Stopping Recording…',
  recording: 'Recording',
  finalizing: 'Finalizing',
  queued: 'Queued',
  processing: 'Processing',
  uploading: 'Uploading to Drive',
  ready: 'Ready to play',
  paused: 'Paused',
  failed: 'Failed',
};

/** Finishing a recording here takes seconds to a few minutes; past this it is stuck. */
export const FINALIZE_STALL_MS = 10 * 60_000;
/** A transfer that has moved nothing for this long has stopped, whatever it says. */
export const TRANSFER_STALL_MS = 5 * 60_000;

/**
 * Why a transfer is paused, waiting or failed, as a sentence that says what to do: a lost connection, a full disk
 * here, a full Drive. Anything else is said as the transfer said it.
 */
export function explainTransferProblem(error: string | null | undefined, held?: Transfer['held']): string | null {
  if (held === 'connection') return 'Waiting for the connection. It carries on by itself as soon as WorkSuite is back online.';
  if (held === 'metered') return 'Waiting: transfers are set to wait while this computer is on a metered connection (Drive › Settings).';
  if (!error) return null;
  if (/ENOSPC|no space left|disk (is )?full/i.test(error)) return "This computer's disk is full. Free up space, then try again — it carries on from where it stopped.";
  if (/\b507\b|quota|insufficient storage|not enough (storage|space)|storage (limit|is full|space)|out of (storage|space)/i.test(error)) {
    return 'Your Drive is out of storage space. Free up space in Drive, or ask your administrator for more, then try again.';
  }
  if (/connection was lost|offline|network|ECONN|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|ENETUNREACH|fetch failed|socket|timed? ?out|unreachable/i.test(error)) {
    return "The connection was lost. Resume when you're back online — it carries on from where it stopped.";
  }
  return error;
}

/** "about 3 min left", from seconds. */
export function etaLabel(seconds: number): string {
  if (!(seconds > 0) || !Number.isFinite(seconds)) return '';
  if (seconds < 60) return 'less than a minute left';
  const min = Math.round(seconds / 60);
  if (min < 60) return `about ${min} min left`;
  const h = Math.floor(min / 60);
  return `about ${h} h${min % 60 ? ` ${min % 60} min` : ''} left`;
}

/** A transfer's progress as measured: a percentage only when its size is known. */
export function transferProgress(t: Pick<Transfer, 'bytes' | 'total' | 'speed' | 'state'>): MeasuredProgress {
  const known = t.total > 0;
  const percent = known ? Math.min(100, Math.floor((t.bytes / t.total) * 100)) : null;
  const eta = known && t.state === 'running' && t.speed > 0 && t.bytes < t.total ? (t.total - t.bytes) / t.speed : null;
  return { percent, done: t.bytes, total: known ? t.total : null, etaSeconds: eta };
}

function since(at: string | null | undefined, now: number): number | null {
  const t = at ? Date.parse(at) : NaN;
  return Number.isFinite(t) ? now - t : null;
}

/** Still moving bytes? A running transfer that has moved nothing for a while has stopped. */
export function transferStalled(t: Pick<Transfer, 'state' | 'movedAt'>, now: number): boolean {
  if (t.state !== 'running') return false;
  const idle = since(t.movedAt, now);
  return idle !== null && idle >= TRANSFER_STALL_MS;
}

function waitingNote(t: Transfer, now: number): string | null {
  const held = explainTransferProblem(null, t.held);
  if (held) return held;
  const retry = since(t.retryAt, now);
  if (t.retryAt && retry !== null && retry < 0) {
    const s = Math.ceil(-retry / 1000);
    return `${explainTransferProblem(t.error) ?? 'It stopped for a moment.'} Trying again ${s < 60 ? `in ${s} s` : `in about ${Math.round(s / 60)} min`}${t.attempts ? ` (attempt ${t.attempts + 1})` : ''}.`;
  }
  return t.position ? `Waiting its turn: number ${t.position} in the transfer queue.` : null;
}

const STALLED_UPLOAD = 'Nothing has been uploaded for more than 5 minutes. Check your connection, then Pause and Resume to start it moving again — or Cancel the transfer: the recording stays on this computer.';

/** A recording made on this computer, with its upload in the transfer queue when it has one. */
export function localRecordingStatus(r: LocalRecording, t: Transfer | null | undefined, now: number = Date.now()): RecordingStatus {
  const local = !!r.fileName;
  const base = { savedLocally: local, savedToDrive: !!r.driveFileId, playable: false, stalled: false, note: null as string | null, progress: null as MeasuredProgress | null };
  const out = (phase: RecordingPhase, tone: RecordingStatus['tone'], actions: RecordingAction[], patch: Partial<RecordingStatus> = {}): RecordingStatus => ({ ...base, phase, label: PHASE_LABEL[phase], tone, actions, ...patch });

  if (r.state === 'starting') return out('starting', 'progress', [], { progress: { percent: null, done: null, total: null, etaSeconds: null } });
  if (r.state === 'recording') return out('recording', 'progress', [], { progress: { percent: null, done: r.bytes, total: null, etaSeconds: null } });

  if (r.state === 'processing') {
    const took = since(r.stepAt ?? r.endedAt, now);
    const stalled = took !== null && took >= FINALIZE_STALL_MS;
    return out('finalizing', stalled ? 'warning' : 'progress', local ? ['reveal'] : [], {
      progress: { percent: null, done: null, total: null, etaSeconds: null },
      stalled,
      note: stalled
        ? 'Finishing this recording is taking much longer than it should. It is safe on this computer: Show the file to check it is there, then restart WorkSuite to finish it again.'
        : r.recovered
          ? 'WorkSuite closed while this was recording. What was recorded until then is kept and is being finished.'
          : null,
    });
  }

  if (r.state === 'uploading') {
    if (!t) {
      const stalled = (since(r.stepAt ?? r.endedAt, now) ?? 0) >= FINALIZE_STALL_MS;
      return out('queued', stalled ? 'warning' : 'progress', local ? ['reveal'] : [], { progress: { percent: null, done: null, total: null, etaSeconds: null }, stalled, note: stalled ? 'The upload has not entered the transfer queue. Check your connection and restart WorkSuite to recover it; the recording stays on this computer.' : null });
    }
    const progress = transferProgress(t);
    if (t.state === 'queued') return out(t.held ? 'paused' : 'queued', t.held ? 'warning' : 'progress', ['pause', 'cancel'], { progress: progress.done ? progress : null, note: waitingNote(t, now) });
    if (t.state === 'paused') {
      return out('paused', 'warning', ['resume', 'cancel'], { progress, note: explainTransferProblem(t.error) ?? 'Paused. Resume to carry on from where it stopped; the recording stays on this computer.' });
    }
    if (t.state === 'failed' || t.state === 'cancelled') return out('failed', 'danger', ['retry'], { progress, note: explainTransferProblem(t.error) ?? 'The upload stopped. The recording stays on this computer; try again.' });
    if (t.state === 'done') return out('uploading', 'progress', [], { progress: { ...progress, percent: 100, etaSeconds: null }, note: 'Checking the copy in Drive…' });
    const stalled = transferStalled(t, now);
    return out('uploading', stalled ? 'warning' : 'progress', ['pause', 'cancel'], { progress, stalled, note: stalled ? STALLED_UPLOAD : null });
  }

  if (r.state === 'ready') {
    const actions: RecordingAction[] = ['play', ...(r.driveFileId ? (['openInDrive'] as const) : []), ...(local ? (['reveal'] as const) : [])];
    return out('ready', 'success', actions, { playable: true });
  }

  const note = r.failedAt === 'uploading' ? explainTransferProblem(r.error) : r.error;
  return out('failed', 'danger', ['retry', ...(local ? (['reveal'] as const) : [])], { note });
}

/** What a recording in the server's list (the media server's, or one a desktop is uploading) says about itself. */
export interface ServerRecordingLike {
  status?: string | null;
  ready?: boolean;
  method?: string | null;
  error?: string | null;
  drive_file_id?: number | null;
  stalled?: boolean;
  guidance?: string | null;
  playable?: boolean;
}

export function serverRecordingStatus(r: ServerRecordingLike): RecordingStatus {
  const status = r.status ?? (r.ready ? 'ready' : 'processing');
  const local = r.method === 'local';
  const drive = !!r.drive_file_id;
  const moving = { percent: null, done: null, total: null, etaSeconds: null };
  const base = { savedLocally: false, savedToDrive: drive, playable: false, stalled: !!r.stalled, note: r.stalled ? (r.guidance ?? null) : null, progress: null as MeasuredProgress | null };
  const out = (phase: RecordingPhase, tone: RecordingStatus['tone'], actions: RecordingAction[], patch: Partial<RecordingStatus> = {}): RecordingStatus => ({
    ...base,
    phase,
    label: PHASE_LABEL[phase],
    tone: base.stalled && tone === 'progress' ? 'warning' : tone,
    actions,
    ...patch,
  });

  switch (status) {
    case 'starting':
    case 'stopping':
      return out(status, 'progress', [], { progress: moving });
    case 'recording':
      return out('recording', 'progress', [], { progress: moving });
    case 'processing':
      // A desktop's recording is finished on that computer; the media server's is processed there.
      return out(local ? 'finalizing' : 'processing', 'progress', [], { progress: moving });
    case 'uploading':
      return out('uploading', 'progress', [], { progress: moving });
    case 'failed':
      // The server can file one of its own again while it still has the whole file; a desktop's is retried there.
      return out('failed', 'danger', [...(local ? [] : (['retry'] as const)), ...(drive ? (['openInDrive'] as const) : [])], { note: r.error ?? 'The recording could not be finished.' });
    case 'ready': {
      // A Drive ID proves storage, not that the recording has been verified.
      const playable = r.playable === true || (r.playable === undefined && r.ready === true);
      if (!playable) return out('processing', 'progress', drive ? ['openInDrive'] : [], { progress: moving, note: 'Saved, but playback has not been verified yet.' });
      return out('ready', 'success', ['play', ...(drive ? (['openInDrive'] as const) : [])], { playable: true, stalled: false, note: null });
    }
    default:
      return out('processing', 'warning', drive ? ['openInDrive'] : [], { progress: moving, note: 'The recording service reported an unknown state. Refresh or ask your administrator to check the recording service.' });
  }
}

/** A recording's download to this computer, told apart from whether the recording is ready to play. */
export function downloadStatus(t: Transfer | null | undefined, now: number = Date.now()): DownloadStatus | null {
  if (!t || t.state === 'cancelled') return null;
  const progress = transferProgress(t);
  switch (t.state) {
    case 'queued':
      return { phase: t.held ? 'paused' : 'queued', label: t.held ? 'Download paused' : 'Download queued', progress: progress.done ? progress : null, stalled: false, note: waitingNote(t, now), actions: ['pause', 'cancel'] };
    case 'paused':
      return { phase: 'paused', label: 'Download paused', progress, stalled: false, note: explainTransferProblem(t.error), actions: ['resume', 'cancel'] };
    case 'failed':
      return { phase: 'failed', label: 'Download failed', progress: null, stalled: false, note: explainTransferProblem(t.error) ?? 'The download did not finish.', actions: ['retry'] };
    case 'done':
      return { phase: 'downloaded', label: 'Downloaded', progress: null, stalled: false, note: null, actions: ['open', 'reveal'] };
    default: {
      const stalled = transferStalled(t, now);
      return {
        phase: 'downloading',
        label: 'Downloading',
        progress,
        stalled,
        note: stalled ? 'Nothing has arrived for more than 5 minutes. Check your connection, then Pause and Resume, or Cancel the transfer.' : null,
        actions: ['pause', 'cancel'],
      };
    }
  }
}

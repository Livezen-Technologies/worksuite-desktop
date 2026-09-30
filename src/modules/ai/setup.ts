import type { LocalAIHardware, LocalModelView } from '@shared/local-ai';

/**
 * First-use Local AI setup (worksuite-desktop#49), as data: which model to offer and whether this computer can take
 * it, the stage a setup is at, what went wrong and what to do about it, and the time left. LocalSetup draws it.
 */

/** What a download needs free besides the file itself (the model manager refuses a download without it). */
export const STORAGE_MARGIN = 512 * 1024 * 1024;

export type Stage = 'downloading' | 'verifying' | 'preparing' | 'ready';
export const STAGES: Array<{ id: Stage; label: string }> = [
  { id: 'downloading', label: 'Downloading' },
  { id: 'verifying', label: 'Verifying' },
  { id: 'preparing', label: 'Preparing AI' },
  { id: 'ready', label: 'Ready' },
];

/** A model on this computer that can answer now: installed, and it passed (or predates) the readiness check. */
export function usableModel(models: LocalModelView[] | undefined): LocalModelView | null {
  return (models ?? []).find((m) => m.model.purpose === 'chat' && m.state === 'installed' && (m.readiness === 'ready' || m.readiness === 'untested')) ?? null;
}

/** The model whose setup is under way (or stopped part-way), so its progress stays in view until it is done. */
export function inProgress(models: LocalModelView[] | undefined): LocalModelView | null {
  return (
    (models ?? []).find(
      (m) => m.model.purpose === 'chat' && (m.state === 'downloading' || m.state === 'verifying' || m.state === 'paused' || m.state === 'failed' || (m.state === 'installed' && (m.readiness === 'testing' || m.readiness === 'failed'))),
    ) ?? null
  );
}

/** Where a setup stands: its stage, and whether that stage stopped (paused, or failed). */
export function stageOf(v: LocalModelView): { stage: Stage; stopped: 'paused' | 'failed' | null } {
  if (v.state === 'downloading') return { stage: 'downloading', stopped: null };
  if (v.state === 'paused') return { stage: 'downloading', stopped: 'paused' };
  if (v.state === 'verifying') return { stage: 'verifying', stopped: null };
  if (v.state === 'failed') return { stage: /match|checksum|larger than/i.test(v.error ?? '') ? 'verifying' : 'downloading', stopped: 'failed' };
  if (v.state === 'installed') {
    if (v.readiness === 'testing') return { stage: 'preparing', stopped: null };
    if (v.readiness === 'failed') return { stage: 'preparing', stopped: 'failed' };
    return { stage: 'ready', stopped: null };
  }
  return { stage: 'downloading', stopped: null };
}

export type ProblemKind = 'connection' | 'storage' | 'mismatch' | 'setup' | 'other';

/** What kind of trouble a message describes, so the person is told what to do, not only what happened. */
export function problemKind(message: string | null | undefined, readiness = false): ProblemKind {
  const m = message ?? '';
  if (readiness) return 'setup';
  if (/free space|disk|ENOSPC|storage/i.test(m)) return 'storage';
  if (/does not match|larger than the catalog|checksum/i.test(m)) return 'mismatch';
  if (/net::|fetch failed|failed to fetch|network|ENOTFOUND|ECONN|EAI_AGAIN|timed? ?out|connection|offline|\((5\d\d|429|408)\)/i.test(m)) return 'connection';
  return 'other';
}

/** The sentence that says what to do next for a kind of trouble. */
export const PROBLEM_ADVICE: Record<ProblemKind, string> = {
  connection: 'The connection dropped. Check you are online, then resume — the download carries on from where it stopped.',
  storage: 'There is not enough free space on this computer. Free some up, then try again.',
  mismatch: 'The downloaded file was not the one WorkSuite named, so it was thrown away. Try again to download it afresh.',
  setup: 'The model downloaded but would not run on this computer. Test it again, or choose another model in Settings → Local AI.',
  other: 'Something stopped the setup. Try again, or look in Settings → Local AI.',
};

/** Free space the rest of a download needs. */
export function storageNeeded(v: Pick<LocalModelView, 'received' | 'model'>): number {
  return Math.max(0, v.model.bytes - v.received) + STORAGE_MARGIN;
}

/**
 * Whether this computer can take the model: `storage` blocks the download (the manager would refuse it anyway);
 * `slow` is a warning, since a model that needs more memory than there is still runs, slowly.
 */
export function compatibility(v: LocalModelView, hw: LocalAIHardware | null | undefined): { storage: boolean; slow: boolean; free: number | null } {
  const free = hw?.freeDiskBytes ?? null;
  return { storage: free !== null && free < storageNeeded(v), slow: !v.fits, free };
}

/** The offer to show: the model being set up if there is one, else a suggestion, unless something already answers. */
export function firstUseOffer(models: LocalModelView[] | undefined, suggested: LocalModelView | null): LocalModelView | null {
  if (usableModel(models)) return null;
  return inProgress(models) ?? suggested;
}

/** Time left at the speed the download has gone lately (measured in the main process); null until it can tell. */
export function secondsLeft(v: Pick<LocalModelView, 'received' | 'model' | 'bytesPerSecond'>): number | null {
  if (!v.bytesPerSecond || v.bytesPerSecond <= 0) return null;
  return Math.max(0, Math.round((v.model.bytes - v.received) / v.bytesPerSecond));
}

export function timeLeftLabel(s: number | null): string | null {
  if (s === null) return null;
  if (s < 60) return 'less than a minute left';
  if (s < 3600) return `about ${Math.round(s / 60)} min left`;
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  return `about ${h} h${m ? ` ${m} min` : ''} left`;
}

import type { BandwidthLimit, DrivePrefs, Transfer } from './types';

/**
 * The transfer queue's shared rules (worksuite-desktop#94, #95): the defaults
 * for Drive › Settings, what a bandwidth cap comes to in bytes a second, and
 * how the Transfers panel groups and sums up what is moving.
 */

/** Default and hard ceiling across every module and direction. */
export const DEFAULT_CONCURRENT = 2;
/** The most the overall limit may be set to. */
export const MAX_CONCURRENT = 2;

export function defaultDrivePrefs(): DrivePrefs {
  return {
    maxConcurrent: DEFAULT_CONCURRENT,
    maxUploads: null,
    maxDownloads: null,
    uploadLimit: { on: false, value: 1, unit: 'MB' },
    downloadLimit: { on: false, value: 5, unit: 'MB' },
    autoRetry: true,
    autoResume: true,
    metered: 'limit',
    meteredConnection: false,
    askWhereToSave: false,
    conflict: 'ask',
    notifyComplete: false,
    notifyFailed: true,
  };
}

/** A saved value made whole and kept in range: a field added later takes its default. */
export function normalizeDrivePrefs(p: Partial<DrivePrefs> | undefined): DrivePrefs {
  const d = defaultDrivePrefs();
  const v = { ...d, ...p, uploadLimit: { ...d.uploadLimit, ...p?.uploadLimit }, downloadLimit: { ...d.downloadLimit, ...p?.downloadLimit } };
  const clamp = (n: unknown, lo: number, hi: number, fallback: number) => (typeof n === 'number' && Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : fallback);
  v.maxConcurrent = clamp(v.maxConcurrent, 1, MAX_CONCURRENT, DEFAULT_CONCURRENT);
  // A limit for one direction is within the overall one.
  v.maxUploads = v.maxUploads === null ? null : clamp(v.maxUploads, 1, v.maxConcurrent, v.maxConcurrent);
  v.maxDownloads = v.maxDownloads === null ? null : clamp(v.maxDownloads, 1, v.maxConcurrent, v.maxConcurrent);
  return v;
}

/** A cap in bytes a second; null when it is off (Unlimited) or makes no sense. */
export function bytesPerSecond(limit: BandwidthLimit | undefined): number | null {
  if (!limit?.on || !(limit.value > 0)) return null;
  return Math.round(limit.value * (limit.unit === 'MB' ? 1024 * 1024 : 1024));
}

/** Transfers by the panel's sections: moving now, waiting their turn, and the ones that have ended. */
export function transferSections(list: Transfer[]): { active: Transfer[]; queued: Transfer[]; paused: Transfer[]; finished: Transfer[] } {
  const active = list.filter((t) => t.state === 'running');
  const queued = list.filter((t) => t.state === 'queued').sort((a, b) => (a.position ?? Number.MAX_SAFE_INTEGER) - (b.position ?? Number.MAX_SAFE_INTEGER));
  const paused = list.filter((t) => t.state === 'paused');
  const finished = list.filter((t) => t.state === 'done' || t.state === 'failed' || t.state === 'cancelled');
  return { active, queued, paused, finished };
}

/** "2 transferring · 8 queued", or null when nothing is moving or waiting. */
export function transferSummary(list: Transfer[]): string | null {
  const { active, queued, paused } = transferSections(list);
  const parts: string[] = [];
  if (active.length) parts.push(`${active.length} transferring`);
  if (queued.length) parts.push(`${queued.length} queued`);
  if (paused.length) parts.push(`${paused.length} paused`);
  return parts.length ? parts.join(' · ') : null;
}

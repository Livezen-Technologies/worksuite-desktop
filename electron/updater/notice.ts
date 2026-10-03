import type { UpdateStatus } from '@shared/types';

/** A system notification about a new version: `key` names the version and stage, so each is said once. */
export interface UpdateNotice {
  key: string;
  title: string;
  body: string;
  /** A critical or security update: the notification stays until dismissed. */
  critical?: boolean;
}

/**
 * What a new version tells the person outside the window, beside the title-bar icon (Settings › Desktop › Updates):
 * "available" while it waits for their Download (updates do not download by themselves here, or this build cannot
 * install them), and "ready" once it is downloaded and waits for a restart. One that downloads by itself says nothing
 * until it is ready. A required update says it is required; a security update says so (worksuite-desktop#205).
 */
export function updateNotice(s: UpdateStatus, autoDownload: boolean): UpdateNotice | null {
  const v = s.availableVersion;
  if (!v) return null;
  if (s.state === 'STAGED') {
    if (s.required) return { key: `ready:${v}`, title: 'Update required', body: `WorkSuite ${v} is ready. Restart WorkSuite to install it; this version is no longer supported.`, critical: true };
    if (s.security) return { key: `ready:${v}`, title: 'Security update ready', body: `WorkSuite ${v} is ready. Restart to update.`, critical: true };
    return { key: `ready:${v}`, title: 'Update ready', body: `WorkSuite ${v} is ready. Restart to update.` };
  }
  if (s.state !== 'AVAILABLE') return null;
  if (s.installBlockedReason) return { key: `available:${v}`, title: 'Update available', body: `WorkSuite ${v} is available. ${s.installBlockedReason}` };
  // It is downloading by itself, and says so once it is ready.
  if (autoDownload || s.critical || s.required) return null;
  return { key: `available:${v}`, title: 'Update available', body: `WorkSuite ${v} is available. Click to download it.` };
}

export interface AnnounceDeps {
  /** Settings › Desktop › Download updates automatically. */
  autoDownload: boolean;
  /** A meeting, call, screen share or remote control is going on: wait, and try again when it ends. */
  held: () => boolean;
  /** Quiet hours, paused notifications, or a development build: say nothing now (the next status tries again). */
  silent: () => boolean;
  /** Notifications on, Update notifications on, and the system supports them. */
  systemEnabled: () => boolean;
  /** The keys already said (kept across restarts). */
  told: { get: () => string[]; set: (keys: string[]) => void };
  show: (n: UpdateNotice) => void;
  /** The entry in the notifications bell. */
  bell: (n: UpdateNotice) => void;
}

/**
 * The one notification path for updates: exactly once per version and stage, a system notification (when
 * Update notifications is on) and an entry in the bell. Held during a meeting, call, screen share or remote
 * control and silent in quiet hours or paused notifications — in both cases nothing is recorded, so it is said
 * when the status is next announced (the end of the meeting, or the next check).
 */
export function announce(s: UpdateStatus, deps: AnnounceDeps): 'shown' | 'held' | 'silent' | 'none' {
  const notice = updateNotice(s, deps.autoDownload);
  if (!notice) return 'none';
  const told = deps.told.get();
  if (told.includes(notice.key)) return 'none';
  if (deps.held()) return 'held';
  if (deps.silent()) return 'silent';
  deps.told.set([...told, notice.key].slice(-10));
  deps.bell(notice);
  if (deps.systemEnabled()) deps.show(notice);
  return 'shown';
}

import type { UpdateStatus } from '@shared/types';

/** A system notification about a new version: `key` names the version and stage, so each is said once. */
export interface UpdateNotice {
  key: string;
  title: string;
  body: string;
}

/**
 * What a new version tells the person outside the window, beside the title-bar icon (Settings › Desktop › Updates):
 * "available" while it waits for their Download (updates do not download by themselves here, or this build cannot
 * install them), and "ready" once it is downloaded and waits for a restart. One that downloads by itself says nothing
 * until it is ready. A required update says it is required.
 */
export function updateNotice(s: UpdateStatus, autoDownload: boolean): UpdateNotice | null {
  const v = s.availableVersion;
  if (!v) return null;
  if (s.state === 'STAGED') {
    return s.required
      ? { key: `ready:${v}`, title: 'Update required', body: `WorkSuite ${v} is ready. Restart WorkSuite to install it; this version is no longer supported.` }
      : { key: `ready:${v}`, title: 'Update ready', body: `WorkSuite ${v} is ready. Restart WorkSuite to finish updating.` };
  }
  if (s.state !== 'AVAILABLE') return null;
  if (s.installBlockedReason) return { key: `available:${v}`, title: 'Update available', body: `WorkSuite ${v} is available. ${s.installBlockedReason}` };
  // It is downloading by itself, and says so once it is ready.
  if (autoDownload || s.critical || s.required) return null;
  return { key: `available:${v}`, title: 'Update available', body: `WorkSuite ${v} is available. Click to download it.` };
}

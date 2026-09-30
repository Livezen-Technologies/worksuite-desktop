import { pmsFilePath, type PmsDownloadInput } from '@shared/pms-files';
import type { Transfer } from '@shared/types';
import { DesktopError } from '../main/errors';

/**
 * Hotel PMS files saved on this computer (`pms:download`, shared/pms-files.ts).
 * The channel already asks for `desktop.downloads`; the policy is checked
 * again here, at the moment of saving, so a policy that changed while the
 * screen was open (or a page that skips its own check) cannot save around
 * it. The address is built here from what the page names, never taken from
 * it, and the download manager fetches it signed in and audits it.
 */
export interface PmsDownloadDeps {
  /** The organization's `desktop.downloads` for this person on this device (policy and trust included). */
  mayDownload: () => boolean;
  download: (apiPath: string, name: string, open: boolean, fileId: string | null) => Promise<Transfer>;
}

export function pmsDownload(d: PmsDownloadDeps, input: PmsDownloadInput): Promise<Transfer> {
  if (!d.mayDownload()) throw new DesktopError('POLICY_DENIED', 'Your organization does not allow saving WorkSuite files on this computer.');
  return d.download(pmsFilePath(input.file), input.name, !!input.open, null);
}

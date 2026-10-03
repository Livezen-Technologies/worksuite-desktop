import { execFile } from 'node:child_process';
import { writeFile } from 'node:fs/promises';

/**
 * Marks a file saved from mail as coming from the internet (ENH-MAIL-03
 * DMO-SEC-04): the quarantine attribute on macOS and the Mark of the Web on
 * Windows, so Gatekeeper, SmartScreen and Office's Protected View treat it
 * as they would a download from a browser. Linux has no such mark.
 *
 * Best effort: a file system that cannot hold the mark (FAT, a network
 * share) keeps the file, unmarked.
 */
export async function markFromInternet(
  path: string,
  platform: NodeJS.Platform = process.platform,
  run: (cmd: string, args: string[]) => Promise<void> = (cmd, args) => new Promise((resolve) => execFile(cmd, args, () => resolve())),
  write: (p: string, data: string) => Promise<void> = (p, data) => writeFile(p, data, 'utf8'),
): Promise<boolean> {
  try {
    if (platform === 'win32') {
      await write(`${path}:Zone.Identifier`, '[ZoneTransfer]\r\nZoneId=3\r\nReferrerUrl=about:internet\r\n');
      return true;
    }
    if (platform === 'darwin') {
      // 0083: downloaded, user-approved later; the agent name shows in the warning.
      await run('/usr/bin/xattr', ['-w', 'com.apple.quarantine', `0083;${Math.floor(Date.now() / 1000).toString(16)};WorkSuite;`, path]);
      return true;
    }
  } catch {
    // Unmarked, but saved.
  }
  return false;
}

import { execFile } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { app, systemPreferences } from 'electron';
import { homedir } from 'node:os';
import { MAC_HELPER } from './accessibility';
import { accessibility } from './host';
import { bundleOf, isTranslocated, readSigning, redactPath } from './signing';

/**
 * Only binary identity and permission results; no captured screens, window titles or input.
 * Running path, bundle ID, Team ID and signing identity of the app and of its input helper (worksuite-desktop#147).
 */
export async function accessibilityDiagnostics() {
  const permission = await accessibility.refresh();
  if (process.platform !== 'darwin') return { permission };
  const realPath = (path: string) => { try { return realpathSync(path); } catch { return path; } };
  const home = homedir();
  const executable = realPath(process.execPath);
  const bundle = bundleOf(executable);
  const [signing, helperSigning] = await Promise.all([readSigning(bundle), readSigning(MAC_HELPER)]);
  const installed = '/Applications/WorkSuite.app';
  const otherInstalledCopy = existsSync(installed) && realPath(installed) !== bundle;
  const signingVerification = await new Promise<'valid' | 'invalid' | 'unable_to_verify'>((resolve) => {
    execFile('/usr/bin/codesign', ['--verify', '--strict', bundle], { timeout: 4_000, shell: false }, (error) => resolve(!error ? 'valid' : typeof error.code === 'number' ? 'invalid' : 'unable_to_verify'));
  });
  let screenRecording = 'unknown';
  try { screenRecording = systemPreferences.getMediaAccessStatus('screen'); } catch { /* Keep verification errors distinct from denial. */ }
  let packaged: boolean | null = null;
  try { packaged = app.isPackaged; } catch { /* Unknown outside Electron. */ }
  const fields = (s: typeof signing) => s && { Identifier: s.identifier, TeamIdentifier: s.teamId, Authority: s.authority, CDHash: s.cdhash, adhoc: s.adhoc, hardenedRuntime: s.hardenedRuntime };
  return {
    permission, screenRecording,
    app: { executable: redactPath(executable, home), bundle: redactPath(bundle, home), pid: process.pid, packaged, signing: fields(signing) },
    helper: {
      executable: MAC_HELPER, ownerPid: process.pid, signing: fields(helperSigning),
      launch: 'direct child of the WorkSuite main process (no shell, launchd or open), so macOS counts WorkSuite as responsible for it',
      permissionCheck: 'AXIsProcessTrusted and CGPreflightPostEventAccess, asked of the running helper over its pipe, or of a new helper process',
    },
    otherInstalledCopy,
    translocated: isTranslocated(executable),
    signingVerification,
  };
}

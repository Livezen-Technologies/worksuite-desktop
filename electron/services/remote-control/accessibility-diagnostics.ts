import { execFile } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { systemPreferences } from 'electron';
import { homedir } from 'node:os';
import { accessibility } from './host';

/** Only binary identity and permission results; no captured screens, window titles or input. */
export async function accessibilityDiagnostics() {
  const permission = await accessibility.refresh();
  if (process.platform !== 'darwin') return { permission };
  const realPath = (path: string) => { try { return realpathSync(path); } catch { return path; } };
  const executable = realPath(process.execPath);
  const bundle = executable.match(/^.*?\.app(?=\/)/)?.[0] ?? executable;
  const redactPath = (path: string) => path.replace(homedir(), '~').replace(/\/Users\/[^/]+\//g, '/Users/~/');
  const signing = await new Promise<Record<string, string> | null>((resolve) => {
    execFile('/usr/bin/codesign', ['-d', '--verbose=4', bundle], { timeout: 4_000 }, (error, _out, stderr) => {
      if (error) return resolve(null);
      const fields: Record<string, string> = {};
      for (const line of stderr.split('\n')) {
        const match = /^(Identifier|TeamIdentifier|CDHash)=(.*)$/.exec(line);
        if (match) fields[match[1]!] = match[2]!;
      }
      resolve(fields);
    });
  });
  const installed = '/Applications/WorkSuite.app';
  const otherInstalledCopy = existsSync(installed) && realPath(installed) !== bundle;
  const signingVerification = await new Promise<'valid' | 'invalid' | 'unable_to_verify'>((resolve) => {
    execFile('/usr/bin/codesign', ['--verify', '--strict', bundle], { timeout: 4_000 }, (error) => resolve(!error ? 'valid' : typeof error.code === 'number' ? 'invalid' : 'unable_to_verify'));
  });
  let screenRecording = 'unknown';
  try { screenRecording = systemPreferences.getMediaAccessStatus('screen'); } catch { /* Keep verification errors distinct from denial. */ }
  return {
    permission, screenRecording,
    app: { executable: redactPath(executable), bundle: redactPath(bundle), pid: process.pid, signing },
    helper: { executable: '/usr/bin/osascript', ownerPid: process.pid, permissionCheck: 'AXIsProcessTrusted and CGPreflightPostEventAccess; same launch context as the input injector' },
    otherInstalledCopy,
    translocated: bundle.includes('/AppTranslocation/'),
    signingVerification,
  };
}

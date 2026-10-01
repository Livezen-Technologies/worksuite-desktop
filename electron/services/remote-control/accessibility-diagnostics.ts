import { execFile } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { accessibility } from './host';

/** Only binary identity and permission results; no captured screens, window titles or input. */
export async function accessibilityDiagnostics() {
  const permission = await accessibility.refresh();
  if (process.platform !== 'darwin') return { permission };
  const executable = realpathSync(process.execPath);
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
  const otherInstalledCopy = existsSync(installed) && realpathSync(installed) !== bundle;
  return {
    permission,
    app: { executable: redactPath(executable), bundle: redactPath(bundle), pid: process.pid, signing },
    helper: { executable: '/usr/bin/osascript', ownerPid: process.pid, permissionCheck: 'CGPreflightPostEventAccess (AXIsProcessTrusted on older macOS)' },
    otherInstalledCopy,
    translocated: bundle.includes('/AppTranslocation/'),
    signingVerification: signing ? 'available' : 'unable_to_verify',
  };
}

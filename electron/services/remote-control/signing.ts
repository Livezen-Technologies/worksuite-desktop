import { execFile } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';

/**
 * Who macOS thinks the running WorkSuite is (worksuite-desktop#147).
 *
 * The Accessibility list stores a code requirement, not a path. A Developer ID
 * build's requirement is "this bundle ID, signed by this Team ID", which every
 * update keeps. An ad-hoc (unsigned) build's requirement is the hash of that
 * exact binary: after an update — or with a second copy — the old entry still
 * shows as enabled but no longer matches, and every check reads Denied. These
 * fields make that visible on screen and in diagnostics.
 */
export interface SigningInfo {
  identifier: string | null;
  teamId: string | null;
  /** The leaf signing identity, e.g. "Developer ID Application: … (TEAMID)". */
  authority: string | null;
  adhoc: boolean;
  cdhash: string | null;
  hardenedRuntime: boolean;
}

export interface RunningIdentity {
  /** Redacted path of the running executable and of its .app bundle. */
  executable: string;
  bundle: string;
  bundleId: string | null;
  teamId: string | null;
  authority: string | null;
  adhoc: boolean;
  /** Gatekeeper is running this copy from a randomized read-only location (it was opened where it was downloaded). */
  translocated: boolean;
  /** A different WorkSuite.app is in /Applications: its Accessibility entry is not this one's. */
  otherInstalledCopy: boolean;
  /** Not a packaged app (a development Electron): macOS attributes permission to Electron or the terminal. */
  development: boolean;
  /** No answer from codesign (timed out, missing). */
  signingUnavailable: boolean;
}

/**
 * The leaf signing identity, kept only when it names an organization or Apple: a Developer ID ("Developer ID
 * Application: Company (TEAMID)") or Apple's own "Software Signing". A personal development certificate names a
 * person, so only its kind is kept.
 */
export function publicAuthority(value: string): string {
  if (/^Developer ID Application: /.test(value) || value === 'Software Signing') return value;
  const kind = /^([^:]{1,60}):/.exec(value)?.[1];
  return kind ? `${kind}: (name withheld)` : '(withheld)';
}

/** codesign -dv writes its fields to stderr, one `Key=value` per line. Only these fields are kept. */
export function parseCodesign(output: string): SigningInfo {
  let identifier: string | null = null;
  let teamId: string | null = null;
  let authority: string | null = null;
  let cdhash: string | null = null;
  let adhoc = false;
  let hardenedRuntime = false;
  for (const raw of output.split('\n')) {
    const line = raw.trim();
    // "CodeDirectory v=20500 size=… flags=0x10000(runtime) …" has no '=' right after its name.
    const m = line.startsWith('CodeDirectory ') ? ['', 'CodeDirectory', line.slice(14)] : /^([A-Za-z]+)=(.*)$/.exec(line);
    if (!m) continue;
    const [, key, value] = m as unknown as [string, string, string];
    if (key === 'Identifier') identifier = value;
    else if (key === 'TeamIdentifier') teamId = value === 'not set' || value === '' ? null : value;
    else if (key === 'Authority' && authority === null) authority = publicAuthority(value);
    else if (key === 'CDHash') cdhash = value;
    else if (key === 'Signature' && value === 'adhoc') adhoc = true;
    else if (key === 'CodeDirectory') {
      // "CodeDirectory v=20500 size=… flags=0x10002(adhoc,runtime) hashes=…"
      const flags = /flags=0x[0-9a-f]+\(([^)]*)\)/i.exec(value)?.[1]?.split(',') ?? [];
      if (flags.includes('adhoc') || flags.includes('linker-signed')) adhoc = true;
      if (flags.includes('runtime')) hardenedRuntime = true;
    }
  }
  return { identifier, teamId, authority, adhoc: adhoc || (identifier !== null && authority === null && teamId === null), cdhash, hardenedRuntime };
}

export function isTranslocated(path: string): boolean {
  return path.includes('/AppTranslocation/');
}

/** The .app that holds an executable, or the executable itself outside a bundle. */
export function bundleOf(executable: string): string {
  return executable.match(/^.*?\.app(?=\/)/)?.[0] ?? executable;
}

export function redactPath(path: string, home: string = homedir()): string {
  return (home ? path.replace(home, '~') : path).replace(/\/Users\/[^/]+\//g, '/Users/~/');
}

type ExecFile = typeof execFile;

/** `codesign -dv --verbose=4 <path>`: no shell, bounded, null when it cannot tell. */
export function readSigning(path: string, run: ExecFile = execFile, timeoutMs = 4_000): Promise<SigningInfo | null> {
  return new Promise((resolve) => {
    try {
      run('/usr/bin/codesign', ['-d', '--verbose=4', path], { timeout: timeoutMs, shell: false }, (error, _stdout, stderr) => {
        const out = String(stderr ?? '');
        // An unsigned file is reported as an error with "code object is not signed at all".
        if (/not signed at all/.test(out)) return resolve({ identifier: null, teamId: null, authority: null, adhoc: true, cdhash: null, hardenedRuntime: false });
        if (error) return resolve(null);
        resolve(parseCodesign(out));
      });
    } catch {
      resolve(null);
    }
  });
}

export interface IdentityDeps {
  platform: string;
  execPath: string;
  packaged: boolean;
  exists?: (path: string) => boolean;
  realpath?: (path: string) => string;
  run?: ExecFile;
  home?: string;
}

export async function runningIdentity(deps: IdentityDeps): Promise<RunningIdentity | null> {
  if (deps.platform !== 'darwin') return null;
  const exists = deps.exists ?? existsSync;
  const real = (p: string) => { try { return (deps.realpath ?? realpathSync)(p); } catch { return p; } };
  const executable = real(deps.execPath);
  const bundle = bundleOf(executable);
  const signing = await readSigning(bundle, deps.run);
  const installed = '/Applications/WorkSuite.app';
  const home = deps.home ?? homedir();
  return {
    executable: redactPath(executable, home),
    bundle: redactPath(bundle, home),
    bundleId: signing?.identifier ?? null,
    teamId: signing?.teamId ?? null,
    authority: signing?.authority ?? null,
    adhoc: signing?.adhoc ?? false,
    translocated: isTranslocated(executable),
    otherInstalledCopy: exists(installed) && real(installed) !== bundle,
    development: !deps.packaged,
    signingUnavailable: signing === null,
  };
}

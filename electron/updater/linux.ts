import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * How this copy of WorkSuite was installed on Linux, and how such a copy updates (worksuite-desktop#345).
 *
 *   appimage  `$APPIMAGE` is set: the image is replaced in place (no password).
 *   deb, rpm  electron-builder writes `resources/package-type`: the matching package is downloaded, checked against
 *             the Update Center's signed answer (Ed25519) and its SHA-256, and installed with the system's package
 *             manager behind one password prompt (pkexec). Without pkexec, or when the prompt is refused, it is opened
 *             in the desktop's software installer instead.
 *
 * Asking the Update Center for this exact type is what keeps a .deb install from being offered an AppImage, and the
 * reverse.
 */
export type LinuxInstallKind = 'appimage' | 'deb' | 'rpm';

export function linuxInstallKind(env: NodeJS.ProcessEnv = process.env, resources: string = process.resourcesPath ?? '', read: (p: string) => string = (p) => readFileSync(p, 'utf8')): LinuxInstallKind | null {
  if (env.APPIMAGE) return 'appimage';
  try {
    const t = read(join(resources, 'package-type')).trim().toLowerCase();
    if (t === 'deb' || t === 'rpm') return t;
  } catch {
    // No marker: run from an unpacked directory or a package type WorkSuite does not ship.
  }
  return null;
}

/** "Installed as" in words, for Settings › Updates and Diagnostics. */
export const INSTALL_KIND_LABEL: Record<string, string> = {
  appimage: 'AppImage',
  deb: '.deb package',
  rpm: '.rpm package',
  exe: 'Windows installer',
  dmg: 'macOS app',
};

/** The first program found in the system directories, or null. */
export function findProgram(names: string[], exists: (p: string) => boolean = existsSync): string | null {
  for (const n of names) {
    for (const dir of ['/usr/bin', '/bin', '/usr/sbin', '/sbin', '/usr/local/bin']) {
      if (exists(`${dir}/${n}`)) return `${dir}/${n}`;
    }
  }
  return null;
}

/**
 * The command that installs a downloaded package with one password prompt, or null when this computer has no pkexec
 * or no package manager for it. apt-get installs a local file given by path (and pulls its dependencies); dnf, then
 * zypper, then yum for an .rpm.
 */
export function packageInstallCommand(kind: 'deb' | 'rpm', file: string, exists: (p: string) => boolean = existsSync): { cmd: string; args: string[] } | null {
  const pkexec = findProgram(['pkexec'], exists);
  if (!pkexec) return null;
  if (kind === 'deb') {
    const apt = findProgram(['apt-get'], exists);
    if (apt) return { cmd: pkexec, args: [apt, 'install', '-y', '--allow-downgrades', file] };
    const dpkg = findProgram(['dpkg'], exists);
    return dpkg ? { cmd: pkexec, args: [dpkg, '-i', file] } : null;
  }
  const dnf = findProgram(['dnf'], exists);
  if (dnf) return { cmd: pkexec, args: [dnf, 'install', '-y', file] };
  const zypper = findProgram(['zypper'], exists);
  if (zypper) return { cmd: pkexec, args: [zypper, '--non-interactive', 'install', '--allow-unsigned-rpm', file] };
  const yum = findProgram(['yum'], exists);
  return yum ? { cmd: pkexec, args: [yum, 'install', '-y', file] } : null;
}

export type PackageInstallResult = { ok: true } | { ok: false; reason: 'no-pkexec' | 'cancelled' | 'failed'; detail: string };

/**
 * Runs the install. pkexec exits 126 when the person dismisses the prompt and 127 when it could not authorise; both
 * read as "cancelled", which falls back to the software installer rather than failing the update.
 */
export function installPackage(kind: 'deb' | 'rpm', file: string, exec: typeof execFile = execFile, exists: (p: string) => boolean = existsSync): Promise<PackageInstallResult> {
  const c = packageInstallCommand(kind, file, exists);
  if (!c) return Promise.resolve({ ok: false, reason: 'no-pkexec', detail: 'pkexec or a package manager is not installed' });
  return new Promise((resolve) => {
    exec(c.cmd, c.args, { timeout: 15 * 60_000, env: { ...process.env, DEBIAN_FRONTEND: 'noninteractive' } }, (err, _stdout, stderr) => {
      if (!err) return resolve({ ok: true });
      const code = Number((err as unknown as { code?: number | string }).code);
      if (code === 126 || code === 127) return resolve({ ok: false, reason: 'cancelled', detail: 'The password prompt was closed' });
      resolve({ ok: false, reason: 'failed', detail: String(stderr || err.message).trim().split('\n').slice(-3).join(' ').slice(0, 400) });
    });
  });
}

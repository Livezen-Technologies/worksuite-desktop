import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { UpdateChannel, UpdateDiagnosticCheck } from '@shared/types';
import { compareVersions } from '@shared/version';
import { findProgram, runAsRoot, type PackageInstallResult } from './linux';

/**
 * The WorkSuite APT and DNF repositories (worksuite-desktop#351): a .deb or .rpm install that also lists
 * download.worksuitecloud.com as a package source gets WorkSuite updates with the system's own updates.
 *
 * Off unless the build turned it on. Adding a package source before the repository is live would break `apt update`
 * on every computer, so only a build made with WORKSUITE_LINUX_REPO=1 (build/linux-repo.cjs) carries
 * `resources/linux-repo` (the repository's address and the build's channel), the repository's public key and the
 * root-side helper `resources/worksuite-repo`. Without that marker every function here answers "not set up" and
 * changes nothing: no package source, no channel rewrite, no apt-based Update now.
 *
 * Root-side writes all go through the helper (the package's install scripts call it, the app calls it through
 * pkexec); the generators below produce byte-for-byte the files it writes, which is what Diagnostics compares
 * against (tests run the helper and check it).
 *
 *   .deb  /usr/share/keyrings/worksuite.gpg + /etc/apt/sources.list.d/worksuite.sources (deb822), Suites = channel
 *   .rpm  /etc/pki/rpm-gpg/RPM-GPG-KEY-worksuite + /etc/yum.repos.d/worksuite.repo, baseurl …/rpm/<channel>
 */

export type RepoSuite = 'stable' | 'beta' | 'dev';
export type RepoKind = 'deb' | 'rpm';

export const REPO_PATHS = {
  aptSources: '/etc/apt/sources.list.d/worksuite.sources',
  aptKeyring: '/usr/share/keyrings/worksuite.gpg',
  yumRepo: '/etc/yum.repos.d/worksuite.repo',
  rpmKey: '/etc/pki/rpm-gpg/RPM-GPG-KEY-worksuite',
} as const;

/** The first line of every file WorkSuite writes; removal on uninstall only touches files that carry it. */
export const REPO_HEADER = '# Written by WorkSuite (worksuite-desktop#351). Changing the update channel in WorkSuite rewrites this file.';

/** The repository suite (APT) or directory (DNF) for an update channel. The organisation's channel follows Stable. */
export function repoSuite(channel: UpdateChannel | string): RepoSuite {
  return channel === 'beta' || channel === 'dev' ? channel : 'stable';
}

/** /etc/apt/sources.list.d/worksuite.sources, deb822. */
export function debSources(url: string, suite: RepoSuite): string {
  return [REPO_HEADER, 'Types: deb', `URIs: ${url}/apt`, `Suites: ${suite}`, 'Components: main', `Signed-By: ${REPO_PATHS.aptKeyring}`, ''].join('\n');
}

/**
 * /etc/yum.repos.d/worksuite.repo. The repository metadata (repomd.xml) is signed; the packages are the same bytes
 * the Update Center vouches for by SHA-256, which the signed metadata lists, so they are not re-signed.
 */
export function yumRepo(url: string, suite: RepoSuite): string {
  return [
    REPO_HEADER,
    '[worksuite]',
    `name=WorkSuite Desktop (${suite})`,
    `baseurl=${url}/rpm/${suite}`,
    'enabled=1',
    'gpgcheck=0',
    'repo_gpgcheck=1',
    `gpgkey=file://${REPO_PATHS.rpmKey}`,
    'metadata_expire=6h',
    '',
  ].join('\n');
}

export function repoFile(kind: RepoKind, url: string, suite: RepoSuite): { path: string; text: string; key: string } {
  return kind === 'deb' ? { path: REPO_PATHS.aptSources, text: debSources(url, suite), key: REPO_PATHS.aptKeyring } : { path: REPO_PATHS.yumRepo, text: yumRepo(url, suite), key: REPO_PATHS.rpmKey };
}

/** The suite a source file names (`Suites:` for APT, the baseurl's last part for DNF), or null. */
export function parseRepoSuite(kind: RepoKind, text: string): string | null {
  const m = kind === 'deb' ? /^Suites:[ \t]*([^\s#]+)/m.exec(text) : /^baseurl[ \t]*=[ \t]*\S*\/rpm\/([A-Za-z0-9_-]+)\/?[ \t]*$/m.exec(text);
  return m ? m[1]! : null;
}

export interface RepoMarker {
  /** The download host, without a trailing slash: https://download.worksuitecloud.com */
  url: string;
  /** The channel the build was made for (its pre-release tag), the suite a fresh install starts on. */
  channel: RepoSuite;
}

/** resources/linux-repo (`url=…`, `channel=…`), or null when this build does not use the repository. */
export function readRepoMarker(resources: string, read: (p: string) => string = (p) => readFileSync(p, 'utf8')): RepoMarker | null {
  let text: string;
  try {
    text = read(join(resources, 'linux-repo'));
  } catch {
    return null;
  }
  const value = (k: string) => new RegExp(`^${k}=(.*)$`, 'm').exec(text)?.[1]?.trim() ?? '';
  const url = value('url').replace(/\/+$/, '');
  if (!/^https:\/\/[A-Za-z0-9.-]+(:\d+)?(\/[A-Za-z0-9._~/-]*)?$/.test(url)) return null;
  return { url, channel: repoSuite(value('channel')) };
}

/** A Debian/RPM package version as the app writes its own (`0.2.249~beta.1-1` → `0.2.249-beta.1`). */
export function packageVersion(v: string): string {
  return v
    .trim()
    .replace(/^\d+:/, '')
    .replace(/-\d+(\.[A-Za-z0-9_]+)*$/, '')
    .replace(/~/g, '-');
}

/** `apt-cache policy worksuite`: what is installed, what apt would install, and whether the repository offers it. */
export function parseAptPolicy(out: string, url: string): { installed: string | null; candidate: string | null; fromRepo: boolean } {
  const field = (k: string) => {
    const v = new RegExp(`^\\s*${k}:\\s*(\\S+)`, 'm').exec(out)?.[1] ?? null;
    return v && v !== '(none)' ? packageVersion(v) : null;
  };
  return { installed: field('Installed'), candidate: field('Candidate'), fromRepo: out.includes(`${url}/apt`) };
}

export interface RepoState {
  kind: RepoKind;
  /** Null: this build does not use the repository (the switch is off). */
  marker: RepoMarker | null;
  expected: RepoSuite;
  file: { path: string; exists: boolean; suite: string | null; url: boolean };
  key: { path: string; present: boolean };
}

/** What the package manager knows of WorkSuite: null when it could not be asked. */
export interface RepoPolicy {
  installed: string | null;
  candidate: string | null;
  fromRepo: boolean;
}

export interface LinuxRepoDeps {
  resources?: string;
  read?: (p: string) => string;
  exists?: (p: string) => boolean;
  exec?: typeof execFile;
}

export class LinuxRepo {
  private readonly resources: string;
  private readonly read: (p: string) => string;
  private readonly exists: (p: string) => boolean;
  private readonly exec: typeof execFile;

  constructor(d: LinuxRepoDeps = {}) {
    this.resources = d.resources ?? process.resourcesPath ?? '';
    this.read = d.read ?? ((p) => readFileSync(p, 'utf8'));
    this.exists = d.exists ?? existsSync;
    this.exec = d.exec ?? execFile;
  }

  marker(): RepoMarker | null {
    return readRepoMarker(this.resources, this.read);
  }

  /** The switch: a build made with WORKSUITE_LINUX_REPO=1 that also carries its helper. */
  enabled(): boolean {
    return !!this.marker() && this.exists(this.helper());
  }

  helper(): string {
    return join(this.resources, 'worksuite-repo');
  }

  state(kind: RepoKind, channel: UpdateChannel): RepoState {
    const marker = this.enabled() ? this.marker() : null;
    const f = repoFile(kind, marker?.url ?? '', repoSuite(channel));
    let text: string | null = null;
    try {
      text = this.read(f.path);
    } catch {
      text = null;
    }
    return {
      kind,
      marker,
      expected: repoSuite(channel),
      file: { path: f.path, exists: text !== null, suite: text === null ? null : parseRepoSuite(kind, text), url: !!marker && text !== null && text.includes(kind === 'deb' ? `${marker.url}/apt` : `${marker.url}/rpm/`) },
      key: { path: f.key, present: this.exists(f.key) },
    };
  }

  /** `apt-cache policy worksuite` (.deb) or `dnf repoquery` (.rpm), without a password. */
  policy(kind: RepoKind): Promise<RepoPolicy | null> {
    const marker = this.marker();
    if (!marker) return Promise.resolve(null);
    const cmd = kind === 'deb' ? findProgram(['apt-cache'], this.exists) : findProgram(['dnf', 'yum'], this.exists);
    if (!cmd) return Promise.resolve(null);
    const args = kind === 'deb' ? ['policy', 'worksuite'] : ['repoquery', '--cacheonly', '--quiet', '--repo', 'worksuite', '--latest-limit', '1', '--queryformat', '%{version}\\n', 'worksuite'];
    return new Promise((resolve) => {
      this.exec(cmd, args, { timeout: 30_000, env: { ...process.env, LC_ALL: 'C' } }, (err, stdout) => {
        if (err) return resolve(kind === 'deb' ? null : { installed: null, candidate: null, fromRepo: false });
        const out = String(stdout);
        if (kind === 'deb') return resolve(parseAptPolicy(out, marker.url));
        const v = out.split('\n').map((l) => l.trim().replace(/\\n$/, '')).find((l) => /^\d/.test(l)) ?? null;
        resolve({ installed: null, candidate: v ? packageVersion(v) : null, fromRepo: !!v });
      });
    });
  }

  /**
   * Writes the key and the source file for `channel` behind one password prompt (the channel switch, and
   * Diagnostics › Fix); `refresh` also reads the repository's package lists, so apt and dnf see its newest version.
   */
  setup(kind: RepoKind, channel: UpdateChannel, refresh = false): Promise<PackageInstallResult> {
    if (!this.enabled()) return Promise.resolve({ ok: false, reason: 'failed', detail: 'This build does not use the WorkSuite package repository' });
    const pkexec = findProgram(['pkexec'], this.exists);
    if (!pkexec) return Promise.resolve({ ok: false, reason: 'no-pkexec', detail: 'pkexec is not installed' });
    return runAsRoot({ cmd: pkexec, args: [this.helper(), 'setup', kind, repoSuite(channel), ...(refresh ? ['--refresh'] : [])] }, this.exec);
  }

  /** Update now from the repository: `pkexec apt-get install --only-upgrade -y worksuite`. */
  aptUpgrade(): Promise<PackageInstallResult> {
    const pkexec = findProgram(['pkexec'], this.exists);
    const apt = findProgram(['apt-get'], this.exists);
    if (!pkexec || !apt) return Promise.resolve({ ok: false, reason: 'no-pkexec', detail: 'pkexec or apt-get is not installed' });
    return runAsRoot({ cmd: pkexec, args: [apt, 'install', '--only-upgrade', '-y', 'worksuite'] }, this.exec);
  }
}

/** Whether the configured repository is ready to install exactly `version` (Update now through apt). */
export function repoOffers(state: RepoState, policy: RepoPolicy | null, version: string): boolean {
  if (!state.marker || !state.file.exists || !state.file.url || state.file.suite !== state.expected || !state.key.present) return false;
  return !!policy?.fromRepo && !!policy.candidate && compareVersions(policy.candidate, version) === 0;
}

const NOT_SET_UP = 'Not set up yet — this build does not use the WorkSuite package repository';

/**
 * Settings › Updates › Diagnostics, a .deb or .rpm install: the source file and its suite, the signing key, and
 * whether the package manager sees the newest version. Each problem carries the Fix action (the helper through
 * pkexec). With the switch off the three read "Not set up yet" and are skipped, never failed.
 */
export function repoChecks(state: RepoState, policy: RepoPolicy | null, latest: string | null): UpdateDiagnosticCheck[] {
  const tool = state.kind === 'deb' ? 'apt-cache policy' : 'dnf repoquery';
  if (!state.marker) {
    return [
      { id: 'repo-file', label: 'Package repository', status: 'skip', detail: NOT_SET_UP },
      { id: 'repo-key', label: 'Repository signing key', status: 'skip', detail: 'Not set up yet' },
      { id: 'repo-version', label: 'Repository version', status: 'skip', detail: 'Not set up yet' },
    ];
  }
  const fix = { action: 'fix-repo' as const };
  const word = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const f = state.file;
  const file: UpdateDiagnosticCheck = !f.exists
    ? { id: 'repo-file', label: 'Package repository', status: 'fail', detail: `${f.path} is missing`, fix: 'Select Fix to add the WorkSuite package source (asks for your password).', ...fix }
    : !f.url
      ? { id: 'repo-file', label: 'Package repository', status: 'fail', detail: `${f.path} does not point at ${state.marker.url}`, fix: 'Select Fix to rewrite the WorkSuite package source (asks for your password).', ...fix }
      : f.suite !== state.expected
        ? { id: 'repo-file', label: 'Package repository', status: 'fail', detail: `${f.path} follows ${f.suite ?? 'no suite'}, the channel is ${word(state.expected)}`, fix: `Select Fix to switch the package source to ${word(state.expected)} (asks for your password).`, ...fix }
        : { id: 'repo-file', label: 'Package repository', status: 'pass', detail: `${f.path} · ${f.suite}` };
  const key: UpdateDiagnosticCheck = state.key.present
    ? { id: 'repo-key', label: 'Repository signing key', status: 'pass', detail: state.key.path }
    : { id: 'repo-key', label: 'Repository signing key', status: 'fail', detail: `${state.key.path} is missing`, fix: 'Select Fix to put the WorkSuite signing key back (asks for your password).', ...fix };
  let version: UpdateDiagnosticCheck;
  if (!f.exists) version = { id: 'repo-version', label: 'Repository version', status: 'skip', detail: 'No package source to ask' };
  else if (!policy) version = { id: 'repo-version', label: 'Repository version', status: 'skip', detail: `${tool} could not be run` };
  else if (!policy.fromRepo || !policy.candidate) {
    version = { id: 'repo-version', label: 'Repository version', status: 'fail', detail: `${tool} does not list WorkSuite from ${state.marker.url}`, fix: 'Select Fix to read the repository again (asks for your password).', ...fix };
  } else if (latest && compareVersions(policy.candidate, latest) < 0) {
    version = { id: 'repo-version', label: 'Repository version', status: 'low', detail: `${tool}: ${policy.candidate}, the newest is ${latest}`, fix: 'The package lists are out of date. Select Fix to read the repository again (asks for your password).', ...fix };
  } else {
    version = { id: 'repo-version', label: 'Repository version', status: 'pass', detail: `${tool}: ${policy.candidate}${policy.installed ? ` · installed ${policy.installed}` : ''}` };
  }
  return [file, key, version];
}

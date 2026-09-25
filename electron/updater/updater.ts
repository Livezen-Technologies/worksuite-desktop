import { app } from 'electron';
import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync } from 'node:fs';
import { chmod, copyFile, mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { canonicalJson } from '@shared/canonical-json';
import { channelAccepts, DEADLINE_WARNINGS_MS, installableKinds, isNewer, manifestSchema, resolveArtifactUrl, selectArtifact, type ReleaseArtifact, type ReleaseManifest } from '@shared/release';
import type { Arch, BusyReport, Platform, UpdateChannel, UpdateStatus } from '@shared/types';
import { compareVersions, isBelowMinimum } from '@shared/version';
import { createPublicKey, verify } from 'node:crypto';
import { logger } from '../main/log';
import type { FetchLike } from '../services/http';

const log = logger('updater');
const run = promisify(execFile);

/**
 * DesktopUpdaterService (FR-UPD-01..05, WF-25/26).
 *
 *   IDLE → CHECKING → AVAILABLE → DOWNLOADING → VERIFIED → STAGED → INSTALLING
 *
 * Trust chain, in order, and each step fails closed:
 *  1. the manifest's Ed25519 signature against the pinned release key;
 *  2. the artifact's SHA-256 and size against the signed manifest;
 *  3. the operating system's code signature on the new build, from the same
 *     publisher as the running one (macOS Developer ID team, Windows
 *     Authenticode signer). An unsigned running build cannot establish a
 *     publisher and therefore never installs updates itself.
 *
 * Before restarting it asks what would be interrupted (uploads, queued
 * changes, drafts, a call) and offers Restart later / Review activity. A
 * critical update installs at its deadline (default 24 h) after warnings at
 * 4 h, 1 h and 10 min. The previous version is kept until the new one has
 * started successfully.
 */

export interface UpdaterDeps {
  fetch: FetchLike;
  platform: Platform;
  arch: Arch;
  publicKeyPem: string;
  feedUrl: (channel: UpdateChannel) => string | null;
  channel: () => UpdateChannel;
  busy: () => BusyReport;
  deadlineHours: () => number;
  allowInsecure: boolean;
  updatesDir: string;
  onStatus: (s: UpdateStatus) => void;
  onWarning: (text: string) => void;
  beforeQuit: () => Promise<void>;
}

export function verifyManifestSignature(raw: Record<string, unknown>, publicKeyPem: string): boolean {
  const { signature, ...rest } = raw;
  if (typeof signature !== 'string') return false;
  try {
    return verify(null, Buffer.from(canonicalJson(rest), 'utf8'), createPublicKey(publicKeyPem), Buffer.from(signature, 'base64'));
  } catch {
    return false;
  }
}

function bundlePath(): string | null {
  // …/WorkSuite.app/Contents/MacOS/WorkSuite → …/WorkSuite.app
  const m = /^(.*?\.app)\//.exec(process.execPath);
  return m ? m[1]! : null;
}

async function macTeamId(appPath: string): Promise<string | null> {
  try {
    const { stderr } = await run('/usr/bin/codesign', ['-dv', '--verbose=2', appPath], { timeout: 20_000 });
    const m = /TeamIdentifier=([A-Z0-9]+)/.exec(stderr);
    return m ? m[1]! : null;
  } catch (e) {
    const stderr = String((e as { stderr?: string }).stderr ?? '');
    const m = /TeamIdentifier=([A-Z0-9]+)/.exec(stderr);
    return m ? m[1]! : null;
  }
}

async function winSigner(file: string): Promise<{ valid: boolean; subject: string | null }> {
  const ps = `$s = Get-AuthenticodeSignature -LiteralPath '${file.replace(/'/g, "''")}'; Write-Output ($s.Status.ToString() + '|' + $s.SignerCertificate.Subject)`;
  try {
    const { stdout } = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { timeout: 30_000, windowsHide: true });
    const [status, subject] = stdout.trim().split('|');
    return { valid: status === 'Valid', subject: subject || null };
  } catch {
    return { valid: false, subject: null };
  }
}

export class UpdaterService {
  private status: UpdateStatus;
  private manifest: ReleaseManifest | null = null;
  private artifact: ReleaseArtifact | null = null;
  private stagedPath: string | null = null;
  private minimum: string | null = null;
  private checkTimer: NodeJS.Timeout | null = null;
  private deadlineTimers: NodeJS.Timeout[] = [];
  private checking: Promise<UpdateStatus> | null = null;
  private laterUntil = 0;

  constructor(private readonly deps: UpdaterDeps) {
    this.status = {
      state: 'IDLE',
      channel: deps.channel(),
      currentVersion: app.getVersion(),
      availableVersion: null,
      minimumVersion: null,
      required: false,
      critical: false,
      progress: 0,
      error: null,
      lastCheckedAt: null,
      deadline: null,
      signatureVerified: false,
      notesUrl: null,
      installSupported: false,
      installBlockedReason: null,
    };
  }

  get(): UpdateStatus {
    return { ...this.status, channel: this.deps.channel() };
  }

  private set(patch: Partial<UpdateStatus>): void {
    this.status = { ...this.status, ...patch, channel: this.deps.channel() };
    this.deps.onStatus(this.get());
  }

  /** Records a minimum supported version from any source (bootstrap, policy, directive). */
  setMinimum(version: string | null): void {
    if (!version) return;
    if (this.minimum && compareVersions(version, this.minimum) <= 0) return;
    this.minimum = version;
    const required = isBelowMinimum(app.getVersion(), version);
    this.set({ minimumVersion: version, required });
    if (required) {
      log.warn('installed version is below the minimum', { installed: app.getVersion(), minimum: version });
      void this.check();
    }
  }

  /** A directive from the administrator: this build must update before use. */
  requireUpdate(version: string | null): void {
    if (version) {
      this.setMinimum(version);
      return;
    }
    this.set({ required: true });
    void this.check();
  }

  start(): void {
    // Startup check a little after launch, then every 4 hours (WF-25 triggers).
    setTimeout(() => void this.check(), 30_000).unref?.();
    this.checkTimer = setInterval(() => void this.check(), 4 * 3600_000);
    this.checkTimer.unref?.();
    void this.cleanupAfterUpdate();
  }

  stop(): void {
    if (this.checkTimer) clearInterval(this.checkTimer);
    for (const t of this.deadlineTimers) clearTimeout(t);
    this.deadlineTimers = [];
  }

  check(): Promise<UpdateStatus> {
    if (this.checking) return this.checking;
    this.checking = this.doCheck().finally(() => {
      this.checking = null;
    });
    return this.checking;
  }

  private async doCheck(): Promise<UpdateStatus> {
    if (['DOWNLOADING', 'INSTALLING'].includes(this.status.state)) return this.get();
    if (this.status.state === 'STAGED') return this.get();
    const channel = this.deps.channel();
    const url = this.deps.feedUrl(channel);
    if (!url) {
      this.set({ state: 'IDLE', error: 'No update feed is configured.', lastCheckedAt: new Date().toISOString() });
      return this.get();
    }
    this.set({ state: 'CHECKING', error: null });
    try {
      const res = await this.deps.fetch(url, { method: 'GET', headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(30_000) });
      if (res.status === 404) {
        this.set({ state: 'IDLE', lastCheckedAt: new Date().toISOString(), error: null });
        return this.get();
      }
      if (!res.ok) throw new Error(`update feed answered ${res.status}`);
      const raw = (await res.json()) as Record<string, unknown>;
      if (!verifyManifestSignature(raw, this.deps.publicKeyPem)) {
        // Fail closed: an unverifiable manifest is ignored entirely.
        log.error('release manifest signature invalid; ignoring it');
        this.set({ state: 'FAILED', error: 'The update could not be verified and was ignored.', signatureVerified: false, lastCheckedAt: new Date().toISOString() });
        return this.get();
      }
      const parsed = manifestSchema.safeParse(raw);
      if (!parsed.success) throw new Error('release manifest is malformed');
      const m = parsed.data;
      if (m.minimum_version) this.setMinimum(m.minimum_version);
      if (!channelAccepts(channel, m.channel) || !isNewer(m.version, app.getVersion())) {
        this.set({ state: 'IDLE', availableVersion: null, lastCheckedAt: new Date().toISOString(), signatureVerified: true });
        return this.get();
      }
      const kinds = installableKinds(this.deps.platform, !!process.env.APPIMAGE);
      const artifact = selectArtifact(m, this.deps.platform, this.deps.arch, kinds);
      this.manifest = m;
      this.artifact = artifact;
      const blocked = await this.installBlockedReason(artifact);
      this.set({
        state: 'AVAILABLE',
        availableVersion: m.version,
        critical: m.critical,
        notesUrl: m.notes_url ?? null,
        signatureVerified: true,
        installSupported: blocked === null,
        installBlockedReason: blocked,
        lastCheckedAt: new Date().toISOString(),
      });
      if (blocked === null && artifact) await this.download(artifact, url);
      return this.get();
    } catch (e) {
      log.info('update check failed', { error: String((e as Error).message ?? e) });
      this.set({ state: 'IDLE', error: 'Could not check for updates.', lastCheckedAt: new Date().toISOString() });
      return this.get();
    }
  }

  private async installBlockedReason(artifact: ReleaseArtifact | null): Promise<string | null> {
    if (!app.isPackaged) return 'Development builds do not install updates.';
    if (!artifact) {
      if (this.deps.platform === 'linux' && !process.env.APPIMAGE) return 'WorkSuite was installed from a package; update it with your package manager.';
      return 'No installer for this computer is included in the release.';
    }
    if (this.deps.platform === 'macos') {
      const bundle = bundlePath();
      if (!bundle) return 'The application bundle could not be located.';
      if (!(await macTeamId(bundle))) return 'This build is not code-signed, so it cannot verify updates. Install new versions manually.';
    }
    if (this.deps.platform === 'windows') {
      const me = await winSigner(process.execPath);
      if (!me.valid) return 'This build is not code-signed, so it cannot verify updates. Install new versions manually.';
    }
    return null;
  }

  private async download(artifact: ReleaseArtifact, manifestUrl: string): Promise<void> {
    const url = resolveArtifactUrl(artifact.url, manifestUrl, this.deps.allowInsecure);
    if (!url) {
      this.set({ state: 'FAILED', error: 'The update is not served over HTTPS.' });
      return;
    }
    const dir = join(this.deps.updatesDir, this.manifest!.version);
    await mkdir(dir, { recursive: true });
    const name = url.split('/').pop()?.split('?')[0]?.replace(/[^A-Za-z0-9._-]/g, '_') || `update-${artifact.kind}`;
    const final = join(dir, name);
    const partial = `${final}.partial`;
    this.set({ state: 'DOWNLOADING', progress: 0 });
    const res = await this.deps.fetch(url, { method: 'GET', signal: AbortSignal.timeout(2 * 3600_000) });
    if (!res.ok || !res.body) {
      this.set({ state: 'FAILED', error: `Download failed (${res.status}).` });
      return;
    }
    const hash = createHash('sha256');
    const out = createWriteStream(partial, { mode: 0o600 });
    let bytes = 0;
    const reader = res.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        hash.update(value);
        if (!out.write(value)) await new Promise<void>((r) => out.once('drain', () => r()));
        bytes += value.byteLength;
        if (bytes > artifact.size) throw new Error('update larger than announced');
        this.set({ progress: Math.round((bytes / artifact.size) * 100) });
      }
    } finally {
      await new Promise<void>((r) => out.end(() => r()));
    }
    const digest = hash.digest('hex');
    if (bytes !== artifact.size || digest !== artifact.sha256) {
      await rm(partial, { force: true });
      log.error('update checksum mismatch', { expected: artifact.sha256, got: digest, bytes });
      this.set({ state: 'FAILED', error: 'The downloaded update did not match its checksum and was deleted.' });
      return;
    }
    await rename(partial, final);
    this.set({ state: 'VERIFIED', progress: 100 });
    const staged = await this.stage(final, artifact, dir);
    if (!staged) return;
    this.stagedPath = staged;
    const deadline = this.manifest?.critical || this.status.required ? new Date(Date.now() + this.deps.deadlineHours() * 3600_000).toISOString() : null;
    this.set({ state: 'STAGED', deadline });
    if (deadline) this.armDeadline(new Date(deadline).getTime());
  }

  /** Step 3 of the trust chain: the OS code signature, same publisher as us. */
  private async stage(file: string, artifact: ReleaseArtifact, dir: string): Promise<string | null> {
    try {
      if (this.deps.platform === 'macos') {
        const target = join(dir, 'staged');
        await rm(target, { recursive: true, force: true });
        await mkdir(target, { recursive: true });
        await run('/usr/bin/ditto', ['-x', '-k', file, target], { timeout: 10 * 60_000 });
        const appName = (await readdir(target)).find((n) => n.endsWith('.app'));
        if (!appName) throw new Error('the update archive contains no application');
        const newApp = join(target, appName);
        await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', newApp], { timeout: 5 * 60_000 });
        const mine = await macTeamId(bundlePath() ?? '');
        const theirs = await macTeamId(newApp);
        if (!mine || mine !== theirs) throw new Error('the update is signed by a different publisher');
        return newApp;
      }
      if (this.deps.platform === 'windows') {
        const mine = await winSigner(process.execPath);
        const theirs = await winSigner(file);
        if (!theirs.valid || !mine.subject || mine.subject !== theirs.subject) throw new Error('the installer is not signed by the same publisher');
        return file;
      }
      // Linux AppImage: the signed manifest and its SHA-256 are the trust.
      await chmod(file, 0o755);
      void artifact;
      return file;
    } catch (e) {
      log.error('update failed code-signature verification', { error: String((e as Error).message ?? e) });
      this.set({ state: 'FAILED', error: 'The update failed signature verification and was not installed.' });
      return null;
    }
  }

  private armDeadline(at: number): void {
    for (const t of this.deadlineTimers) clearTimeout(t);
    this.deadlineTimers = [];
    for (const before of DEADLINE_WARNINGS_MS) {
      const when = at - before - Date.now();
      if (when > 0) {
        const mins = Math.round(before / 60_000);
        const label = mins >= 60 ? `${mins / 60} hour${mins === 60 ? '' : 's'}` : `${mins} minutes`;
        const t = setTimeout(() => this.deps.onWarning(`WorkSuite will restart to install a required update in ${label}. Your work is saved.`), when);
        t.unref?.();
        this.deadlineTimers.push(t);
      }
    }
    const t = setTimeout(() => void this.install(true), Math.max(0, at - Date.now()));
    t.unref?.();
    this.deadlineTimers.push(t);
  }

  restartLater(): UpdateStatus {
    this.laterUntil = Date.now() + 3600_000;
    return this.get();
  }

  /** WF-26: refuses to restart over pending work unless forced (deadline, or the user insists). */
  async install(force = false): Promise<{ started: boolean; busy: BusyReport | null; message: string | null }> {
    if (this.status.state !== 'STAGED' || !this.stagedPath) {
      return { started: false, busy: null, message: this.status.installBlockedReason ?? 'No update is ready to install.' };
    }
    const busy = this.deps.busy();
    const isBusy = busy.uploads > 0 || busy.downloads > 0 || busy.pendingMutations > 0 || busy.activeCall;
    if (isBusy && !force) return { started: false, busy, message: 'WorkSuite is busy.' };
    void this.laterUntil;
    this.set({ state: 'INSTALLING' });
    try {
      await this.deps.beforeQuit();
      await this.launchInstaller(this.stagedPath);
      return { started: true, busy, message: null };
    } catch (e) {
      log.error('install failed', { error: String((e as Error).message ?? e) });
      this.set({ state: 'FAILED', error: 'The update could not be installed. The current version keeps running.' });
      return { started: false, busy, message: 'The update could not be installed.' };
    }
  }

  private async launchInstaller(path: string): Promise<void> {
    if (this.deps.platform === 'windows') {
      const child = spawn(path, ['/S', '--updated', '--force-run'], { detached: true, stdio: 'ignore', windowsHide: true });
      child.unref();
      app.quit();
      return;
    }
    if (this.deps.platform === 'macos') {
      const target = bundlePath();
      if (!target) throw new Error('bundle path unknown');
      const backup = join(this.deps.updatesDir, 'rollback', 'WorkSuite.app');
      await mkdir(dirname(backup), { recursive: true });
      const script = join(this.deps.updatesDir, 'swap.sh');
      await writeFile(
        script,
        [
          '#!/bin/sh',
          'PID="$1"; TARGET="$2"; NEW="$3"; BACKUP="$4"',
          'while kill -0 "$PID" 2>/dev/null; do sleep 0.5; done',
          'rm -rf "$BACKUP"',
          'mv "$TARGET" "$BACKUP" || { open "$TARGET"; exit 1; }',
          'if mv "$NEW" "$TARGET"; then open "$TARGET" --args --updated; else mv "$BACKUP" "$TARGET"; open "$TARGET"; fi',
          '',
        ].join('\n'),
        { mode: 0o700 },
      );
      const child = spawn('/bin/sh', [script, String(process.pid), target, path, backup], { detached: true, stdio: 'ignore' });
      child.unref();
      app.quit();
      return;
    }
    // Linux AppImage: replace the image in place, keep the old one until the new one starts.
    const current = process.env.APPIMAGE;
    if (!current) throw new Error('not running as an AppImage');
    await copyFile(current, `${current}.previous`);
    await copyFile(path, `${current}.new`);
    await chmod(`${current}.new`, 0o755);
    await rename(`${current}.new`, current);
    app.relaunch({ execPath: current, args: ['--updated'] });
    app.exit(0);
  }

  /** After a successful start of a new version, the kept previous version goes (NFR-REL-03). */
  private async cleanupAfterUpdate(): Promise<void> {
    if (!process.argv.includes('--updated')) return;
    setTimeout(async () => {
      try {
        await rm(join(this.deps.updatesDir, 'rollback'), { recursive: true, force: true });
        if (process.env.APPIMAGE && existsSync(`${process.env.APPIMAGE}.previous`)) await rm(`${process.env.APPIMAGE}.previous`, { force: true });
        for (const entry of await readdir(this.deps.updatesDir)) {
          if (entry !== 'rollback' && (await stat(join(this.deps.updatesDir, entry))).isDirectory()) {
            await rm(join(this.deps.updatesDir, entry), { recursive: true, force: true });
          }
        }
        log.info('update confirmed; previous version removed');
      } catch (e) {
        log.warn('post-update cleanup failed', { error: String(e) });
      }
    }, 60_000).unref?.();
  }
}

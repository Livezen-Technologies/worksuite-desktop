import { app } from 'electron';
import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { chmod, mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { canonicalJson } from '@shared/canonical-json';
import { DEADLINE_WARNINGS_MS, isNewer, resolveArtifactUrl } from '@shared/release';
import type { Arch, BusyReport, Platform, ReleaseNotes, UpdateActivity, UpdateChannel, UpdateStatus } from '@shared/types';
import { CHANNEL_INFO, acceptsVersion, channelChange, waitingFor, type LaterChoice } from '@shared/updates';
import { compareVersions, isBelowMinimum } from '@shared/version';
import { createPublicKey, verify } from 'node:crypto';
import { logger } from '../main/log';
import type { FetchLike } from '../services/http';
import { acceptUpdateResponse, isRequired, isSecurityRelease, isTestChannel, ucInstallType, type UcPackage } from './update-center';
import { linuxWatchdogScript, macRestoreScript, macSwapScript, UpdateScheduler, type UpdateHealth, type UpdateHistory, type UpdateNotifier } from './update-flow';

const log = logger('updater');
const run = promisify(execFile);

/**
 * DesktopUpdaterService (FR-UPD-01..05, WF-25/26, worksuite-desktop#205).
 *
 *   IDLE → CHECKING → AVAILABLE → DOWNLOADING → VERIFIED → STAGED → INSTALLING
 *
 * It asks the WorkSuite Update Center (update-center.ts). Trust chain, in
 * order, and each step fails closed:
 *  1. the update response's Ed25519 signature against the pinned Update
 *     Center response key — for this app, this version, and not expired;
 *  2. the package's SHA-256 and size against that signed response;
 *  3. the operating system's code signature on the new build, from the same
 *     publisher as the running one (macOS Developer ID team, Windows
 *     Authenticode signer). An unsigned running build cannot establish a
 *     publisher, so it installs updates itself only from a test channel
 *     (BETA, DEV, INTERNAL), where steps 1 and 2 are the trust — as they are
 *     for a Linux AppImage. A signed build never takes an unsigned update.
 *
 * Channels (#205): Stable takes no pre-release version, Beta takes beta ones,
 * Dev takes everything; a version is never taken backwards except by an
 * explicit "Reinstall …", which asks the Update Center with allow_downgrade.
 * Checks run at launch, every 4 hours and after the computer wakes
 * (UpdateScheduler); downloads run by themselves unless Settings › About ›
 * Updates turns that off (a required or security update downloads anyway).
 *
 * Before restarting it asks what would be interrupted (uploads, queued
 * changes, drafts, a call) and offers Restart later / Review activity. A
 * critical update installs at its deadline (default 24 h) after warnings at
 * 4 h, 1 h and 10 min, or at the next launch once it has been put off twice.
 * The previous version is kept until the new one has started successfully
 * (UpdateHealth), and put back if it does not (macOS, Linux AppImage).
 */

export interface UpdaterDeps {
  fetch: FetchLike;
  platform: Platform;
  arch: Arch;
  /** Pinned Update Center response keys, key_id → base64url raw Ed25519. */
  responseKeys: Readonly<Record<string, string>>;
  /** The update check for this channel, or null when no Update Center is configured. */
  updateUrl: (channel: UpdateChannel, opts?: { allowDowngrade?: boolean }) => string | null;
  channel: () => UpdateChannel;
  busy: () => BusyReport;
  deadlineHours: () => number;
  allowInsecure: boolean;
  updatesDir: string;
  onStatus: (s: UpdateStatus) => void;
  onWarning: (text: string) => void;
  beforeQuit: () => Promise<void>;
  /** Settings › About › Updates › Download updates automatically (default on). */
  autoDownload?: () => boolean;
  /** Settings › About › Updates › Install when quitting (default on). */
  installOnQuit?: () => boolean;
  /** The channels this computer may follow, and why it may not choose (organisation policy). */
  channels?: () => { allowed: UpdateChannel[]; lockReason: string | null };
  /** The channel the person picked (saved), which policy may no longer allow. */
  savedChannel?: () => UpdateChannel;
  /** Saves drafts and the open tabs in every window before WorkSuite restarts. */
  prepareRestart?: () => Promise<void>;
  /** A meeting, call, screen share or remote control in progress. */
  activity?: () => UpdateActivity;
  history?: UpdateHistory;
  health?: UpdateHealth;
  notifier?: UpdateNotifier;
}

/** What the Update Center offered: the version, and the package for this computer. */
interface Offer {
  version: string;
  critical: boolean;
  pkg: UcPackage;
  checkUrl: string;
  /** The channel the Update Center answered from (signed), lower case. */
  channel: string;
  notes: ReleaseNotes | null;
  downgrade: boolean;
}

/** Downloaded and verified, kept on disk so a critical update put off twice can install at the next launch. */
interface StagedRecord {
  version: string;
  file: string;
  offer: Omit<Offer, 'checkUrl'>;
}

/** A self-hosted manifest's signature (the feed before the Update Center; kept for its tests). */
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

async function sha256Of(file: string): Promise<{ digest: string; bytes: number }> {
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of createReadStream(file)) {
    hash.update(chunk as Buffer);
    bytes += (chunk as Buffer).byteLength;
  }
  return { digest: hash.digest('hex'), bytes };
}

const errorText = (e: unknown) => String((e as Error)?.message ?? e);

export class UpdaterService {
  private status: UpdateStatus;
  private offer: Offer | null = null;
  private stagedPath: string | null = null;
  private minimum: string | null = null;
  private deadlineTimers: NodeJS.Timeout[] = [];
  private checking: Promise<UpdateStatus> | null = null;
  private downloading: Promise<void> | null = null;
  /** "Reinstall Stable now": the next check may offer an older build. */
  private allowDowngrade = false;
  private scheduler: UpdateScheduler | null = null;
  private quitInstallTried = false;

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
      notes: null,
      security: false,
      downgrade: false,
      rollback: null,
    };
  }

  get(): UpdateStatus {
    const channel = this.deps.channel();
    const ch = this.deps.channels?.() ?? { allowed: [channel], lockReason: null };
    const n = this.deps.notifier;
    const ahead = waitingFor(channel, app.getVersion());
    const notice = this.deps.health?.notice() ?? null;
    return {
      ...this.status,
      channel,
      allowedChannels: ch.allowed,
      channelLockReason: ch.lockReason,
      snoozedUntil: n?.snoozedUntil() ?? null,
      postponed: this.status.availableVersion && n ? n.postponed(this.status.availableVersion) : 0,
      installOnNextLaunch: !!this.status.availableVersion && n?.installAtLaunch() === this.status.availableVersion,
      waitingForChannel: ahead && !this.status.availableVersion ? { channel: ahead, version: app.getVersion() } : null,
      justUpdated: notice && notice.version === app.getVersion() ? { version: notice.version, notesUrl: notice.notesUrl ?? null } : null,
      quietReason: n?.quietReason() ?? null,
      channelFallback: this.fallback(channel, ch),
    };
  }

  /** The person's channel is no longer allowed: this computer follows `to` instead (no downgrade). */
  private fallback(channel: UpdateChannel, ch: { allowed: UpdateChannel[]; lockReason: string | null }): { from: UpdateChannel; to: UpdateChannel } | null {
    const saved = this.deps.savedChannel?.();
    if (!saved || ch.lockReason || saved === channel || ch.allowed.includes(saved)) return null;
    return { from: saved, to: channel };
  }

  /** Says once (per change) that the organisation no longer allows this computer's channel. */
  private tellFallback(): void {
    const ch = this.deps.channels?.() ?? null;
    if (!ch) return;
    const f = this.fallback(this.deps.channel(), ch);
    if (!f || !this.deps.notifier?.once(`channel-fallback:${f.from}>${f.to}`)) return;
    const name = (c: UpdateChannel) => CHANNEL_INFO[c].label;
    this.record('channel-fallback', `${f.from} → ${f.to}`, null);
    this.deps.onWarning(`Your organisation no longer allows the ${name(f.from)} channel. WorkSuite now follows ${name(f.to)} and moves to it with the next ${name(f.to)} release that is newer — nothing is downgraded.`);
  }

  private set(patch: Partial<UpdateStatus>): void {
    this.status = { ...this.status, ...patch, channel: this.deps.channel() };
    this.deps.onStatus(this.get());
  }

  /** Tells every window again (the notifier's snooze or quiet state changed). */
  publish(): void {
    this.deps.onStatus(this.get());
  }

  private record(event: string, detail?: string | null, version?: string | null): void {
    this.deps.history?.add(event, { version: version ?? this.offer?.version ?? null, channel: this.deps.channel(), detail: detail ?? null });
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
    this.afterLaunch();
    // At launch (a little after), every 4 hours, and after the computer wakes (wake()).
    this.scheduler = new UpdateScheduler({
      check: (reason) => {
        this.record('check-scheduled', reason, null);
        void this.check();
      },
      setTimeout: (fn, ms) => {
        const t = setTimeout(fn, ms);
        t.unref?.();
        return t;
      },
      setInterval: (fn, ms) => {
        const t = setInterval(fn, ms);
        t.unref?.();
        return t;
      },
      clear: (h) => clearTimeout(h as NodeJS.Timeout),
    });
    this.scheduler.start();
    void this.installAtLaunch();
  }

  /** powerMonitor `resume`. */
  wake(): void {
    this.scheduler?.wake();
  }

  stop(): void {
    this.scheduler?.stop();
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

  /**
   * Settings › About › Channel. Refuses a channel the organisation does not allow; moving to a less stable one
   * needs `confirmed` (Settings asks first). Moving to a more stable one waits for it to catch up.
   */
  async setChannel(to: UpdateChannel, confirmed: boolean, save: (c: UpdateChannel) => void): Promise<UpdateStatus> {
    const from = this.deps.channel();
    const ch = this.deps.channels?.() ?? { allowed: [from, to], lockReason: null };
    const change = channelChange(from, to, ch.allowed, ch.lockReason);
    if (!change.ok) throw Object.assign(new Error(change.reason), { code: 'POLICY_DENIED' });
    if (change.confirm && !confirmed) throw Object.assign(new Error(change.confirm), { code: 'CONFIRMATION_REQUIRED' });
    save(to);
    this.record('channel', `${from} → ${to}`, null);
    log.info('update channel changed', { from, to });
    if (change.direction !== 'same' && this.status.state !== 'INSTALLING') this.forgetOffer();
    return this.check();
  }

  /** "Reinstall Stable now": the channel's current build, even if older (an explicit downgrade). */
  async reinstall(): Promise<UpdateStatus> {
    this.forgetOffer();
    this.allowDowngrade = true;
    this.record('reinstall-requested', this.deps.channel(), null);
    try {
      const s = await this.check();
      if (!this.offer?.downgrade && s.state !== 'FAILED') {
        this.set({ error: `The Update Center did not offer a ${this.deps.channel()} build to reinstall. WorkSuite stays on ${app.getVersion()}.` });
      }
      return this.get();
    } finally {
      this.allowDowngrade = false;
    }
  }

  private forgetOffer(): void {
    if (this.status.state === 'DOWNLOADING' || this.status.state === 'INSTALLING') return;
    if (this.offer) this.deps.notifier?.clear();
    this.offer = null;
    this.stagedPath = null;
    for (const t of this.deadlineTimers) clearTimeout(t);
    this.deadlineTimers = [];
    this.set({ state: 'IDLE', availableVersion: null, notes: null, notesUrl: null, deadline: null, downgrade: false, critical: false, security: false, error: null, progress: 0 });
  }

  private async doCheck(): Promise<UpdateStatus> {
    if (['DOWNLOADING', 'INSTALLING'].includes(this.status.state)) return this.get();
    if (this.status.state === 'STAGED') return this.get();
    const channel = this.deps.channel();
    const downgrade = this.allowDowngrade;
    const url = this.deps.updateUrl(channel, downgrade ? { allowDowngrade: true } : undefined);
    if (!url) {
      this.set({ state: 'IDLE', error: 'No update feed is configured.', lastCheckedAt: new Date().toISOString() });
      return this.get();
    }
    this.tellFallback();
    this.set({ state: 'CHECKING', error: null });
    this.record('check', downgrade ? 'reinstall' : null, null);
    try {
      const res = await this.deps.fetch(url, { method: 'GET', headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(30_000) });
      if (!res.ok) throw new Error(`update center answered ${res.status}`);
      const raw = (await res.json()) as Record<string, unknown>;
      const accepted = acceptUpdateResponse(raw, this.deps.responseKeys, app.getVersion());
      if (!accepted.ok) {
        // Fail closed: an answer that does not verify is ignored entirely.
        log.error('update response refused; ignoring it', { reason: accepted.reason });
        this.record('check-refused', accepted.reason, null);
        this.set({ state: 'FAILED', error: 'The update could not be verified and was ignored.', signatureVerified: false, lastCheckedAt: new Date().toISOString() });
        return this.get();
      }
      const r = accepted.response;
      if (r.effective_minimum) this.setMinimum(r.effective_minimum);
      if (isRequired(r)) this.set({ required: true });
      const pkg = r.package ?? null;
      const version = r.latest_version ?? null;
      // The signed answer's channel wins (a tenant policy at the Update Center), else the one asked for.
      const answered = r.channel.toLowerCase();
      const effective: UpdateChannel = answered === 'stable' || answered === 'beta' || answered === 'dev' ? answered : channel;
      const wanted = !!version && (isNewer(version, app.getVersion()) || (downgrade && compareVersions(version, app.getVersion()) < 0));
      if (version && pkg && wanted && !acceptsVersion(effective, version)) {
        log.warn('update refused: pre-release on a channel that does not take one', { version, channel: effective });
        this.record('check-result', `refused ${version}: not a ${effective} version`, version);
        this.offer = null;
        this.set({ state: 'IDLE', availableVersion: null, error: null, lastCheckedAt: new Date().toISOString(), signatureVerified: true });
        return this.get();
      }
      if ((r.status === 'CURRENT' && !downgrade) || !pkg || !version || !wanted) {
        this.offer = null;
        this.record('check-result', `up to date (${r.status.toLowerCase()})`, version);
        this.set({ state: 'IDLE', availableVersion: null, notes: null, error: r.status === 'CURRENT' ? null : r.message ?? null, lastCheckedAt: new Date().toISOString(), signatureVerified: true });
        return this.get();
      }
      const security = isSecurityRelease(r);
      const highlights = (r.highlights ?? []).filter((h) => h.trim()).slice(0, 8);
      const notes: ReleaseNotes = { version, summary: r.summary ?? highlights[0] ?? null, highlights, url: r.release_notes_url ?? null };
      const isDowngrade = compareVersions(version, app.getVersion()) < 0;
      this.offer = { version, critical: security, pkg, checkUrl: url, channel: answered, notes, downgrade: isDowngrade };
      const blocked = await this.installBlockedReason(this.offer);
      this.record('check-result', `${version} offered${security ? ' (security)' : ''}${isDowngrade ? ' (reinstall)' : ''}`, version);
      this.set({
        state: 'AVAILABLE',
        availableVersion: version,
        critical: security,
        security,
        notes,
        downgrade: isDowngrade,
        notesUrl: r.release_notes_url ?? null,
        signatureVerified: true,
        installSupported: blocked === null,
        installBlockedReason: blocked,
        lastCheckedAt: new Date().toISOString(),
      });
      // In the background, unless downloads are left to the person — a required or security update downloads anyway,
      // and so does a reinstall the person just asked for.
      const auto = this.deps.autoDownload?.() ?? true;
      if (blocked === null && (auto || security || this.status.required || isDowngrade)) await this.download();
      return this.get();
    } catch (e) {
      log.info('update check failed', { error: errorText(e) });
      this.record('check-failed', errorText(e), null);
      this.set({ state: 'FAILED', error: 'Could not check for updates.', lastCheckedAt: new Date().toISOString() });
      return this.get();
    }
  }

  /** An unsigned build may take an update only from a test channel, and only when this computer asked for one. */
  private unsignedAllowed(offer: Pick<Offer, 'channel'>): boolean {
    return isTestChannel(offer.channel) && this.deps.channel() !== 'stable';
  }

  private async installBlockedReason(offer: Offer): Promise<string | null> {
    const { pkg } = offer;
    if (!app.isPackaged) return 'Development builds do not install updates.';
    const wanted = ucInstallType(this.deps.platform, !!process.env.APPIMAGE);
    if (this.deps.platform === 'linux' && !wanted) return 'WorkSuite was installed from a package; update it with your package manager.';
    if (pkg.type !== wanted) return 'No installer for this computer is included in the release.';
    if (this.deps.platform === 'macos') {
      const bundle = bundlePath();
      if (!bundle) return 'The application bundle could not be located.';
      if (!(await macTeamId(bundle)) && !this.unsignedAllowed(offer)) return 'This build is not code-signed, so it cannot verify updates. Install new versions manually.';
    }
    if (this.deps.platform === 'windows') {
      const me = await winSigner(process.execPath);
      if (!me.valid && !this.unsignedAllowed(offer)) return 'This build is not code-signed, so it cannot verify updates. Install new versions manually.';
    }
    return null;
  }

  /** Downloads the update on offer (Settings › About › Download, when automatic downloads are off). */
  download(): Promise<void> {
    if (this.downloading) return this.downloading;
    const offer = this.offer;
    if (!offer || this.status.state !== 'AVAILABLE' || !this.status.installSupported) return Promise.resolve();
    this.downloading = this.doDownload(offer)
      .catch((e) => {
        log.error('update download failed', { error: errorText(e) });
        this.record('download-failed', errorText(e), offer.version);
        this.set({ state: 'FAILED', error: 'The update could not be downloaded.' });
      })
      .finally(() => {
        this.downloading = null;
      });
    return this.downloading;
  }

  private async doDownload(offer: Offer): Promise<void> {
    const { pkg } = offer;
    const url = resolveArtifactUrl(pkg.download_url, offer.checkUrl, this.deps.allowInsecure);
    if (!url) {
      this.record('download-failed', 'not https', offer.version);
      this.set({ state: 'FAILED', error: 'The update is not served over HTTPS.' });
      return;
    }
    const dir = join(this.deps.updatesDir, offer.version);
    await mkdir(dir, { recursive: true });
    const name = pkg.file_name.replace(/[^A-Za-z0-9._-]/g, '_') || `update-${pkg.type}`;
    const final = join(dir, name);
    const partial = `${final}.partial`;
    this.set({ state: 'DOWNLOADING', progress: 0 });
    this.record('download-start', `${pkg.size} bytes`, offer.version);
    let res = await this.deps.fetch(url, { method: 'GET', signal: AbortSignal.timeout(2 * 3600_000) });
    if (!res.ok && pkg.download_grant) {
      // The signed URL lasts 15 minutes; the grant buys a fresh one for the same file.
      const fresh = await this.redeemGrant(pkg.download_grant, offer.checkUrl);
      if (fresh) res = await this.deps.fetch(fresh, { method: 'GET', signal: AbortSignal.timeout(2 * 3600_000) });
    }
    if (!res.ok || !res.body) {
      this.record('download-failed', `HTTP ${res.status}`, offer.version);
      this.set({ state: 'FAILED', error: `Download failed (${res.status}).` });
      return;
    }
    const hash = createHash('sha256');
    const out = createWriteStream(partial, { mode: 0o600 });
    let bytes = 0;
    let shown = -1;
    const reader = res.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        hash.update(value);
        if (!out.write(value)) await new Promise<void>((r) => out.once('drain', () => r()));
        bytes += value.byteLength;
        if (bytes > pkg.size) throw new Error('update larger than announced');
        const pct = Math.round((bytes / pkg.size) * 100);
        if (pct !== shown) {
          shown = pct;
          this.set({ progress: pct });
        }
      }
    } finally {
      await new Promise<void>((r) => out.end(() => r()));
    }
    const digest = hash.digest('hex');
    if (bytes !== pkg.size || digest !== pkg.sha256) {
      await rm(partial, { force: true });
      log.error('update checksum mismatch', { expected: pkg.sha256, got: digest, bytes });
      this.record('download-failed', 'checksum mismatch', offer.version);
      this.set({ state: 'FAILED', error: 'The downloaded update did not match its checksum and was deleted.' });
      return;
    }
    await rename(partial, final);
    this.record('download-done', 'sha256 verified', offer.version);
    this.set({ state: 'VERIFIED', progress: 100 });
    const staged = await this.stage(final, dir, offer);
    if (!staged) return;
    this.stagedPath = staged;
    await this.saveStaged({ version: offer.version, file: final, offer: { version: offer.version, critical: offer.critical, pkg: offer.pkg, channel: offer.channel, notes: offer.notes, downgrade: offer.downgrade } });
    const deadline = offer.critical || this.status.required ? new Date(Date.now() + this.deps.deadlineHours() * 3600_000).toISOString() : null;
    this.record('staged', deadline ? `installs by ${deadline}` : null, offer.version);
    this.set({ state: 'STAGED', deadline });
    if (deadline) this.armDeadline(new Date(deadline).getTime());
    this.deps.notifier?.onReady({ version: offer.version, critical: offer.critical, summary: offer.notes?.summary ?? null });
  }

  private stagedFile(): string {
    return join(this.deps.updatesDir, 'staged.json');
  }

  private async saveStaged(r: StagedRecord): Promise<void> {
    try {
      await writeFile(this.stagedFile(), JSON.stringify(r), { mode: 0o600 });
    } catch (e) {
      log.warn('could not record the staged update', { error: errorText(e) });
    }
  }

  private readStaged(): StagedRecord | null {
    try {
      return existsSync(this.stagedFile()) ? (JSON.parse(readFileSync(this.stagedFile(), 'utf8')) as StagedRecord) : null;
    } catch {
      return null;
    }
  }

  /** POST /api/v1/downloads/grant → a fresh signed URL, still checked against the signed SHA-256. */
  private async redeemGrant(grant: string, checkUrl: string): Promise<string | null> {
    try {
      const res = await this.deps.fetch(new URL('/api/v1/downloads/grant', checkUrl).toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ grant }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { download_url?: unknown };
      return typeof data.download_url === 'string' ? resolveArtifactUrl(data.download_url, checkUrl, this.deps.allowInsecure) : null;
    } catch {
      return null;
    }
  }

  /** Copies the .app out of a downloaded disk image (read-only, never shown in Finder). */
  private async extractFromDmg(dmg: string, target: string, dir: string): Promise<void> {
    const mount = join(dir, 'mnt');
    await rm(mount, { recursive: true, force: true });
    await mkdir(mount, { recursive: true });
    await run('/usr/bin/hdiutil', ['attach', '-nobrowse', '-readonly', '-noautoopen', '-mountpoint', mount, dmg], { timeout: 5 * 60_000 });
    try {
      const appName = (await readdir(mount)).find((n) => n.endsWith('.app'));
      if (!appName) throw new Error('the disk image contains no application');
      await run('/usr/bin/ditto', [join(mount, appName), join(target, appName)], { timeout: 10 * 60_000 });
    } finally {
      await run('/usr/bin/hdiutil', ['detach', mount, '-force'], { timeout: 60_000 }).catch(() => undefined);
    }
  }

  /** Step 3 of the trust chain: the OS code signature, same publisher as us (an unsigned build on a test channel: steps 1–2 only). */
  private async stage(file: string, dir: string, offer: Pick<Offer, 'channel'>): Promise<string | null> {
    try {
      if (this.deps.platform === 'macos') {
        const target = join(dir, 'staged');
        await rm(target, { recursive: true, force: true });
        await mkdir(target, { recursive: true });
        if (file.toLowerCase().endsWith('.dmg')) await this.extractFromDmg(file, target, dir);
        else await run('/usr/bin/ditto', ['-x', '-k', file, target], { timeout: 10 * 60_000 });
        const appName = (await readdir(target)).find((n) => n.endsWith('.app'));
        if (!appName) throw new Error('the update archive contains no application');
        const newApp = join(target, appName);
        await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', newApp], { timeout: 5 * 60_000 });
        // Even ad hoc, the bundle must be intact (codesign above). A signed build
        // needs the same team; an unsigned one may go on only from a test channel.
        const mine = await macTeamId(bundlePath() ?? '');
        const theirs = await macTeamId(newApp);
        if (mine ? mine !== theirs : !this.unsignedAllowed(offer)) throw new Error('the update is signed by a different publisher');
        return newApp;
      }
      if (this.deps.platform === 'windows') {
        const mine = await winSigner(process.execPath);
        if (!mine.valid && this.unsignedAllowed(offer)) return file;
        const theirs = await winSigner(file);
        if (!theirs.valid || !mine.subject || mine.subject !== theirs.subject) throw new Error('the installer is not signed by the same publisher');
        return file;
      }
      // Linux AppImage: the signed update response and its SHA-256 are the trust.
      await chmod(file, 0o755);
      return file;
    } catch (e) {
      log.error('update failed code-signature verification', { error: errorText(e) });
      this.record('verify-failed', errorText(e), null);
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

  /** Later: In 1 hour, Tonight, or On next app launch. */
  later(choice: LaterChoice = 'hour'): UpdateStatus {
    const r = this.deps.notifier?.later(choice);
    this.record('later', `${choice}${r?.installOnNextLaunch ? ' (installs at next launch)' : ''}`, this.status.availableVersion);
    this.publish();
    return this.get();
  }

  /** The older IPC name for Later (one hour). */
  restartLater(): UpdateStatus {
    return this.later('hour');
  }

  /**
   * WF-26: refuses to restart over pending work unless forced (deadline, or the user insists). Drafts and the
   * open tabs are saved first; the same tabs and windows come back after the restart.
   */
  async install(force = false, opts: { relaunch?: boolean } = {}): Promise<{ started: boolean; busy: BusyReport | null; message: string | null }> {
    const relaunch = opts.relaunch ?? true;
    if (this.status.state !== 'STAGED' || !this.stagedPath) {
      return { started: false, busy: null, message: this.status.installBlockedReason ?? 'No update is ready to install.' };
    }
    const busy = this.deps.busy();
    const a = busy.activity;
    const isBusy = busy.uploads > 0 || busy.downloads > 0 || busy.pendingMutations > 0 || busy.activeCall || !!(a && (a.meeting || a.call || a.screenShare || a.remoteControl));
    if (isBusy && !force) return { started: false, busy, message: 'WorkSuite is busy.' };
    const version = this.status.availableVersion ?? this.offer?.version ?? 'unknown';
    this.set({ state: 'INSTALLING' });
    this.record('install', `${relaunch ? 'restart' : 'on quit'}${force ? ', forced' : ''}`, version);
    try {
      if (relaunch) await this.deps.prepareRestart?.().catch((e) => log.warn('saving before the restart did not finish', { error: errorText(e) }));
      await this.deps.beforeQuit();
      const rollbackPossible = this.deps.platform !== 'windows';
      this.deps.health?.beforeInstall(app.getVersion(), version, rollbackPossible, relaunch, this.status.notes?.url ?? this.status.notesUrl);
      if (relaunch) this.deps.health?.requestSessionRestore();
      this.deps.notifier?.doneWith(version);
      this.launchInstaller(this.stagedPath, version, relaunch);
      return { started: true, busy, message: null };
    } catch (e) {
      log.error('install failed', { error: errorText(e) });
      this.record('install-failed', errorText(e), version);
      this.set({ state: 'FAILED', error: 'The update could not be installed. The current version keeps running.' });
      return { started: false, busy, message: 'The update could not be installed.' };
    }
  }

  /**
   * Install when quitting (Settings › About › Updates). Runs inside `before-quit`, which cannot wait, so every step
   * here is synchronous: the installer (or the macOS swap script) starts and carries on after WorkSuite has gone.
   * It does not reopen WorkSuite; the next launch checks the new version's health.
   */
  installOnQuitSync(): boolean {
    if (this.quitInstallTried) return false;
    this.quitInstallTried = true;
    if (this.status.state !== 'STAGED' || !this.stagedPath || !(this.deps.installOnQuit?.() ?? false)) return false;
    const version = this.status.availableVersion ?? this.offer?.version ?? 'unknown';
    try {
      this.record('install', 'on quit', version);
      this.deps.health?.beforeInstall(app.getVersion(), version, this.deps.platform !== 'windows', false, this.status.notes?.url ?? this.status.notesUrl);
      this.deps.notifier?.doneWith(version);
      this.launchInstaller(this.stagedPath, version, false);
      this.status = { ...this.status, state: 'INSTALLING' };
      return true;
    } catch (e) {
      log.error('install on quit failed', { error: errorText(e) });
      this.record('install-failed', errorText(e), version);
      return false;
    }
  }

  private launchInstaller(path: string, version: string, relaunch: boolean): void {
    const health = this.deps.health;
    if (this.deps.platform === 'windows') {
      const child = spawn(path, relaunch ? ['/S', '--updated', '--force-run'] : ['/S'], { detached: true, stdio: 'ignore', windowsHide: true });
      child.unref();
      if (relaunch) app.quit();
      return;
    }
    if (this.deps.platform === 'macos') {
      const target = bundlePath();
      if (!target) throw new Error('bundle path unknown');
      const backup = join(this.deps.updatesDir, 'rollback', 'WorkSuite.app');
      mkdirSync(dirname(backup), { recursive: true });
      const script = join(this.deps.updatesDir, 'swap.sh');
      writeFileSync(script, macSwapScript(), { mode: 0o700 });
      const child = spawn(
        '/bin/sh',
        [script, String(process.pid), target, path, backup, health?.healthFile(version) ?? join(this.deps.updatesDir, 'health.ok'), health?.rolledBackPath ?? join(this.deps.updatesDir, 'rolled-back.json'), version, relaunch ? '1' : '0'],
        { detached: true, stdio: 'ignore' },
      );
      child.unref();
      if (relaunch) app.quit();
      return;
    }
    // Linux AppImage: replace the image in place, keep the old one until the new one starts.
    const current = process.env.APPIMAGE;
    if (!current) throw new Error('not running as an AppImage');
    copyFileSync(current, `${current}.previous`);
    copyFileSync(path, `${current}.new`);
    chmodSync(`${current}.new`, 0o755);
    renameSync(`${current}.new`, current);
    if (!relaunch) return;
    if (health) {
      const script = join(this.deps.updatesDir, 'watchdog.sh');
      writeFileSync(script, linuxWatchdogScript(), { mode: 0o700 });
      spawn('/bin/sh', [script, current, health.healthFile(version), health.rolledBackPath, version], { detached: true, stdio: 'ignore' }).unref();
    }
    app.relaunch({ execPath: current, args: ['--updated'] });
    app.exit(0);
  }

  /**
   * At start: what happened to the last update. A version that keeps failing to start is rolled back where the
   * platform allows; a rollback the watchdog did is reported; "Updated to X" waits for the window (healthy()).
   */
  private afterLaunch(): void {
    const health = this.deps.health;
    if (!health) {
      if (process.argv.includes('--updated')) setTimeout(() => void this.cleanupAfterUpdate(), 60_000).unref?.();
      return;
    }
    const v = health.onLaunch(app.getVersion());
    if (v.kind === 'normal') return;
    if (v.kind === 'verifying') {
      this.record('first-run', `attempt ${v.marker.attempts} of ${v.marker.to}`, v.marker.to);
      return;
    }
    if (v.kind === 'rolled-back' || v.kind === 'not-installed') {
      this.record(v.kind, v.reason, v.failedVersion);
      log.error('the last update did not take', { kind: v.kind, failed: v.failedVersion, reason: v.reason });
      const restored = v.kind === 'rolled-back';
      this.set({
        rollback: {
          failedVersion: v.failedVersion,
          restored,
          message: restored ? `WorkSuite ${v.failedVersion} did not start, so the previous version was put back. ${v.reason}` : `WorkSuite ${v.failedVersion} did not install. ${v.reason}`,
        },
      });
      return;
    }
    // Rollback: this version started too many times without becoming healthy.
    this.record('rollback', `${v.marker.to} failed to start ${v.marker.attempts - 1} times`, v.marker.to);
    log.error('the new version keeps failing to start; rolling back', { to: v.marker.to, from: v.marker.from });
    void this.rollBack(v.marker.to, v.marker.from);
  }

  /** Puts the previous version back from inside a new version that keeps failing (macOS, Linux AppImage). */
  private async rollBack(failed: string, previous: string): Promise<void> {
    const health = this.deps.health;
    const report = (restored: boolean, message: string) => this.set({ rollback: { failedVersion: failed, restored, message } });
    try {
      if (this.deps.platform === 'macos') {
        const target = bundlePath();
        const backup = join(this.deps.updatesDir, 'rollback', 'WorkSuite.app');
        if (target && existsSync(backup)) {
          await writeFile(join(this.deps.updatesDir, 'rolled-back.json'), JSON.stringify({ failed, reason: `WorkSuite ${failed} failed to start more than once.` }), { mode: 0o600 });
          const script = join(this.deps.updatesDir, 'restore.sh');
          await writeFile(script, macRestoreScript(), { mode: 0o700 });
          spawn('/bin/sh', [script, String(process.pid), target, backup], { detached: true, stdio: 'ignore' }).unref();
          app.quit();
          return;
        }
      }
      if (this.deps.platform === 'linux' && process.env.APPIMAGE && existsSync(`${process.env.APPIMAGE}.previous`)) {
        const img = process.env.APPIMAGE;
        await writeFile(join(this.deps.updatesDir, 'rolled-back.json'), JSON.stringify({ failed, reason: `WorkSuite ${failed} failed to start more than once.` }), { mode: 0o600 });
        await rename(`${img}.previous`, img);
        await chmod(img, 0o755);
        app.relaunch({ execPath: img });
        app.exit(0);
        return;
      }
      health?.markHealthy(failed);
      health?.dismissNotice();
      report(false, `WorkSuite ${failed} had trouble starting, and the previous version (${previous}) cannot be put back automatically on this computer. Install it again from the Update Center if problems continue.`);
    } catch (e) {
      log.error('rollback failed', { error: errorText(e) });
      this.record('rollback-failed', errorText(e), failed);
      report(false, `WorkSuite ${failed} had trouble starting and the previous version could not be put back.`);
    }
  }

  /** The main window loaded: the new version is healthy. Cleans up the kept previous version. */
  healthy(): void {
    const v = this.deps.health?.markHealthy(app.getVersion());
    if (v) {
      this.record('healthy', null, v);
      log.info('update confirmed', { version: v });
      setTimeout(() => void this.cleanupAfterUpdate(), 60_000).unref?.();
      this.publish();
    }
  }

  dismissNotice(): UpdateStatus {
    this.deps.health?.dismissNotice();
    this.set({ rollback: null });
    return this.get();
  }

  /** The restart was an update's: the tabs come back even when Settings would not restore them. */
  sessionRestorePending(): boolean {
    return this.deps.health?.peekSessionRestore() ?? false;
  }

  /** Restore the tabs after an update's restart even when Settings would not (consumed once). */
  takeSessionRestore(): boolean {
    return this.deps.health?.takeSessionRestore() ?? false;
  }

  /** A critical update put off more than once installs now, as WorkSuite starts. */
  private async installAtLaunch(): Promise<void> {
    const version = this.deps.notifier?.installAtLaunch();
    if (!version) return;
    const staged = this.readStaged();
    if (!staged || staged.version !== version || !isNewer(version, app.getVersion()) || !existsSync(staged.file)) {
      this.deps.notifier?.doneWith(version);
      return;
    }
    try {
      const { digest, bytes } = await sha256Of(staged.file);
      if (digest !== staged.offer.pkg.sha256 || bytes !== staged.offer.pkg.size) throw new Error('the kept update no longer matches its checksum');
      const path = await this.stage(staged.file, dirname(staged.file), staged.offer);
      if (!path) return;
      this.offer = { ...staged.offer, checkUrl: '' };
      this.stagedPath = path;
      this.set({ state: 'STAGED', availableVersion: version, critical: staged.offer.critical, security: staged.offer.critical, notes: staged.offer.notes, installSupported: true, installBlockedReason: null });
      this.record('install-at-launch', 'security update put off more than once', version);
      await this.install(true);
    } catch (e) {
      this.record('install-at-launch-failed', errorText(e), version);
      this.deps.notifier?.doneWith(version);
    }
  }

  /** After a successful start of a new version, the kept previous version goes (NFR-REL-03). */
  private async cleanupAfterUpdate(): Promise<void> {
    try {
      await rm(join(this.deps.updatesDir, 'rollback'), { recursive: true, force: true });
      if (process.env.APPIMAGE && existsSync(`${process.env.APPIMAGE}.previous`)) await rm(`${process.env.APPIMAGE}.previous`, { force: true });
      for (const entry of await readdir(this.deps.updatesDir)) {
        if (entry !== 'rollback' && (await stat(join(this.deps.updatesDir, entry))).isDirectory()) {
          await rm(join(this.deps.updatesDir, entry), { recursive: true, force: true });
        }
      }
      await rm(this.stagedFile(), { force: true });
      log.info('update confirmed; previous version removed');
    } catch (e) {
      log.warn('post-update cleanup failed', { error: String(e) });
    }
  }
}

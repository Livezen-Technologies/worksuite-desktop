import { app } from 'electron';
import { execFile, spawn } from 'node:child_process';
import { chmodSync, constants as fsConstants, copyFileSync, createReadStream, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { access, chmod, mkdir, readdir, rename, rm, stat, statfs, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { canonicalJson } from '@shared/canonical-json';
import { DEADLINE_WARNINGS_MS, isNewer, resolveArtifactUrl } from '@shared/release';
import type { Arch, BusyReport, MandatoryUpdate, PipelineStep, PipelineStepId, Platform, ReleaseInfo, ReleaseNotes, UpdateActivity, UpdateChannel, UpdateDiagnosticCheck, UpdateFailure, UpdateStatus } from '@shared/types';
import { CHANNEL_INFO, DEFAULT_MAX_DEFERRALS, acceptsVersion, channelChange, failureRef, laterUntil, mandatoryView, restartImpact, restartWaits, waitingFor, type LaterChoice } from '@shared/updates';
import { compareVersions, isBelowMinimum } from '@shared/version';
import { createHash, createPublicKey, verify } from 'node:crypto';
import { logger } from '../main/log';
import type { FetchLike } from '../services/http';
import { DEFAULT_GRACE_MINUTES, acceptUpdateResponse, isCriticalRelease, isRequired, isSecurityRelease, isTestChannel, ucInstallType, type UcPackage } from './update-center';
import { ResumableDownload } from './downloader';
import { installPackage, linuxInstallKind, type LinuxInstallKind, type PackageInstallResult } from './linux';
import { LinuxRepo, repoChecks, repoOffers, repoSuite } from './linux-repo';
import type { UpdateProbe } from './diagnostics';
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
 * A new version downloads by itself unless the person turned that off in
 * Settings › Desktop (and their organization lets them): then it stays
 * AVAILABLE until they press Download. A critical or required one downloads
 * either way.
 *
 * Channels (#205): Stable takes no pre-release version, Beta takes beta ones,
 * Dev takes everything; a version is never taken backwards except by an
 * explicit "Reinstall …", which asks the Update Center with allow_downgrade.
 * Checks run at launch, every 4 hours and after the computer wakes
 * (UpdateScheduler).
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
  /** Linux: how this copy was installed (tests); otherwise read from $APPIMAGE and resources/package-type. */
  linuxKind?: () => LinuxInstallKind | null;
  /** Linux .deb/.rpm: installs the package behind a password prompt (tests replace it). */
  installPackage?: typeof installPackage;
  /** Linux .deb/.rpm: the WorkSuite package repository, off unless the build turned it on (worksuite-desktop#351). */
  linuxRepo?: LinuxRepo;
  /** Opens a file in its desktop handler (shell.openPath): '' when it opened. */
  openPath?: (path: string) => Promise<string>;
  /** Pinned Update Center response keys, key_id → base64url raw Ed25519. */
  responseKeys: Readonly<Record<string, string>>;
  /** The update check for this channel, or null when no Update Center is configured. */
  updateUrl: (channel: UpdateChannel, opts?: { allowDowngrade?: boolean }) => string | null;
  channel: () => UpdateChannel;
  /**
   * Whether a new version downloads by itself (Settings › Updates). Off, it is offered and waits for the
   * person's Download; a critical or required update downloads either way.
   */
  autoDownload: () => boolean;
  busy: () => BusyReport;
  deadlineHours: () => number;
  allowInsecure: boolean;
  updatesDir: string;
  onStatus: (s: UpdateStatus) => void;
  onWarning: (text: string) => void;
  beforeQuit: () => Promise<void>;
  /** Settings › Updates › Install when quitting (default on). */
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
  /** The local database's schema before and after this start's migrations ("What's New" after an update). */
  schema?: () => { from: number; to: number } | null;
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
  release?: ReleaseInfo;
  /** A critical release: installs after this many minutes. */
  graceMinutes?: number | null;
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
  /** The download in progress, for Pause and Cancel. */
  private job: ResumableDownload | null = null;
  private partialPath: string | null = null;
  private graceTimer: NodeJS.Timeout | null = null;
  private freeTimer: NodeJS.Timeout | null = null;
  private linuxRepo: LinuxRepo | null = null;

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
      release: null,
      download: null,
      pipeline: null,
      mandatory: null,
      failure: null,
      restartWhenFree: false,
      immediate: null,
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
      snoozedUntil: n?.snoozedUntil(this.laterKey()) ?? null,
      postponed: this.laterKey() && n ? n.postponed(this.laterKey()!) : 0,
      installOnNextLaunch: !!this.status.availableVersion && n?.installAtLaunch() === this.status.availableVersion,
      waitingForChannel: ahead && !this.status.availableVersion ? { channel: ahead, version: app.getVersion() } : null,
      justUpdated: notice && notice.version === app.getVersion() ? { version: notice.version, notesUrl: notice.notesUrl ?? null } : null,
      quietReason: n?.quietReason() ?? null,
      channelFallback: this.fallback(channel, ch),
      nextCheckAt: this.scheduler?.nextAt()?.toISOString() ?? null,
      justUpdatedNotes: notice && notice.version === app.getVersion() ? { highlights: notice.highlights ?? [], summary: notice.summary ?? null, schema: this.deps.schema?.() ?? null } : null,
      installKind: ucInstallType(this.deps.platform, this.linuxKind()),
    };
  }

  // ── The verification pipeline and failures (Settings › Updates) ───────────

  private static readonly STEPS: PipelineStepId[] = ['manifest', 'download', 'sha256', 'codesign', 'stage'];

  private freshPipeline(manifestDetail: string): PipelineStep[] {
    return UpdaterService.STEPS.map((id) => (id === 'manifest' ? { id, state: 'done', detail: manifestDetail } : { id, state: 'pending', detail: 'Pending' }));
  }

  private step(id: PipelineStepId, state: PipelineStep['state'], detail: string): void {
    const pipeline = (this.status.pipeline ?? this.freshPipeline('Signature valid')).map((p) => (p.id === id ? { id, state, detail } : p));
    this.set({ pipeline });
  }

  /** A failed update: the state, the message people already see, and a code and reference for support. */
  private fail(code: string, error: string, extra: Partial<UpdateFailure> = {}, patch: Partial<UpdateStatus> = {}): void {
    const failure: UpdateFailure = { code, message: error, version: this.offer?.version ?? this.status.availableVersion, rollback: 'none', ref: failureRef(), at: new Date().toISOString(), ...extra };
    this.record('failure', `${code} ${failure.ref}`, failure.version);
    this.set({ state: 'FAILED', error, failure, download: null, ...patch });
  }

  /** A failed install (rolled back or not) stays on show until dismissed; a failed check or download goes with the next good check. */
  private keptFailure(): UpdateFailure | null {
    const f = this.status.failure ?? null;
    return f && f.code === 'UPDATE_INSTALL_FAILED' ? f : null;
  }

  // ── Required updates: since when, and by when ──────────────────────────────

  private requiredFile(): string {
    return join(this.deps.updatesDir, 'required.json');
  }

  /**
   * This version has to go. The clock starts the first time that is known for this minimum (or release) and
   * survives restarts; the deadline is that plus the policy's forced_update_deadline_hours, or the release's own
   * `required_by`. The server refusing this version locks modules at once.
   */
  private markRequired(reason: MandatoryUpdate['reason'], opts: { requiredBy?: string | null; maxDeferrals?: number | null } = {}): void {
    const key = reason === 'server' ? `server:${app.getVersion()}` : `${this.minimum ?? this.offer?.version ?? 'release'}`;
    let rec: { key: string; since: string } | null = null;
    try {
      rec = existsSync(this.requiredFile()) ? (JSON.parse(readFileSync(this.requiredFile(), 'utf8')) as { key: string; since: string }) : null;
    } catch {
      rec = null;
    }
    const prev = this.status.mandatory ?? null;
    if (!rec || (rec.key !== key && reason !== 'server')) {
      rec = { key, since: prev?.since ?? new Date().toISOString() };
      try {
        mkdirSync(this.deps.updatesDir, { recursive: true });
        writeFileSync(this.requiredFile(), JSON.stringify(rec), { mode: 0o600 });
      } catch {
        /* the deadline then counts from this start */
      }
    }
    const own = opts.requiredBy && Number.isFinite(Date.parse(opts.requiredBy)) ? new Date(opts.requiredBy).toISOString() : null;
    const deadline = own ?? prev?.deadline ?? new Date(Date.parse(rec.since) + this.deps.deadlineHours() * 3600_000).toISOString();
    const mandatory: MandatoryUpdate = {
      reason: prev?.reason === 'server' ? 'server' : reason,
      requiredVersion: this.minimum ?? prev?.requiredVersion ?? null,
      since: rec.since,
      deadline,
      serverRejected: !!prev?.serverRejected || reason === 'server',
      maxDeferrals: opts.maxDeferrals ?? prev?.maxDeferrals ?? DEFAULT_MAX_DEFERRALS,
    };
    if (mandatory.reason !== prev?.reason || mandatory.deadline !== prev?.deadline) this.record('required', `${mandatory.reason}, install by ${deadline}`, this.offer?.version ?? null);
    this.set({ required: true, mandatory });
  }

  /** The server refused this version on a business API (UPDATE_REQUIRED, VERSION_UNSUPPORTED): lock modules now. */
  serverRejected(): void {
    this.markRequired('server');
    void this.check();
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
    this.set({ minimumVersion: version, required: required || this.status.required });
    if (required) {
      log.warn('installed version is below the minimum', { installed: app.getVersion(), minimum: version });
      this.markRequired('minimum');
      void this.check();
    }
  }

  /** A directive from the administrator: this build must update before use. */
  requireUpdate(version: string | null): void {
    if (version) {
      this.setMinimum(version);
      return;
    }
    this.serverRejected();
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
      now: () => Date.now(),
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
    if (this.graceTimer) clearTimeout(this.graceTimer);
    this.graceTimer = null;
    if (this.freeTimer) clearInterval(this.freeTimer);
    this.freeTimer = null;
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
    if (change.direction !== 'same') void this.syncRepoChannel();
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
    this.set({ state: 'IDLE', availableVersion: null, notes: null, notesUrl: null, deadline: null, downgrade: false, critical: false, security: false, error: null, progress: 0, release: null, pipeline: null, download: null, immediate: null });
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
        this.fail('UPDATE_SIGNATURE_INVALID', 'The update could not be verified and was ignored.', { version: null }, {
          signatureVerified: false,
          lastCheckedAt: new Date().toISOString(),
          pipeline: UpdaterService.STEPS.map((id) => (id === 'manifest' ? { id, state: 'failed' as const, detail: `Signature not valid (${accepted.reason})` } : { id, state: 'pending' as const, detail: 'Pending' })),
        });
        return this.get();
      }
      const r = accepted.response;
      if (r.effective_minimum) this.setMinimum(r.effective_minimum);
      if (isRequired(r)) this.markRequired('release', { requiredBy: r.required_by ?? null, maxDeferrals: r.max_deferrals ?? null });
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
        this.set({ state: 'IDLE', availableVersion: null, error: null, lastCheckedAt: new Date().toISOString(), signatureVerified: true, release: null, pipeline: null, failure: this.keptFailure() });
        return this.get();
      }
      if ((r.status === 'CURRENT' && !downgrade) || !pkg || !version || !wanted) {
        this.offer = null;
        this.record('check-result', `up to date (${r.status.toLowerCase()})`, version);
        this.set({ state: 'IDLE', availableVersion: null, notes: null, error: r.status === 'CURRENT' ? null : r.message ?? null, lastCheckedAt: new Date().toISOString(), signatureVerified: true, release: null, pipeline: null, failure: this.keptFailure() });
        return this.get();
      }
      const security = isSecurityRelease(r);
      const highlights = (r.highlights ?? []).filter((h) => h.trim()).slice(0, 8);
      const notes: ReleaseNotes = { version, summary: r.summary ?? highlights[0] ?? null, highlights, url: r.release_notes_url ?? null };
      const isDowngrade = compareVersions(version, app.getVersion()) < 0;
      const release: ReleaseInfo = {
        buildNumber: r.build_number ?? null,
        publishedAt: r.published_at ?? null,
        releaseType: r.release_type ?? null,
        channel: answered,
        packageType: pkg.type,
        packageSize: pkg.size,
        keyId: r.key_id,
        publisher: r.publisher ?? null,
        securityFixes: r.security_fixes ?? null,
        knownIssues: (r.known_issues ?? []).filter((k) => k.trim()),
      };
      const graceMinutes = isCriticalRelease(r) ? (r.grace_minutes ?? DEFAULT_GRACE_MINUTES) : null;
      this.offer = { version, critical: security, pkg, checkUrl: url, channel: answered, notes, downgrade: isDowngrade, release, graceMinutes };
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
        release,
        failure: null,
        pipeline: this.freshPipeline(`Ed25519 signature valid · key ${r.key_id}`),
      });
      // In the background, unless downloads are left to the person — a required or critical update downloads anyway,
      // and so does a reinstall the person just asked for.
      if (blocked === null && (this.deps.autoDownload() || security || this.status.required || isDowngrade)) await this.download();
      return this.get();
    } catch (e) {
      log.info('update check failed', { error: errorText(e) });
      this.record('check-failed', errorText(e), null);
      // A check that failed is not a download that failed: nothing stays on offer until the next check answers.
      this.offer = null;
      this.fail('UPDATE_CHECK_FAILED', 'Could not check for updates.', { version: null }, { availableVersion: null, notes: null, lastCheckedAt: new Date().toISOString(), release: null, pipeline: null });
      return this.get();
    }
  }

  /**
   * The person's Download: fetches the offered version now (asking the Update Center first when nothing current is
   * on offer) and stages it, for Restart to update. A build that cannot install updates, or nothing newer, leaves the
   * status as it is.
   */
  async downloadNow(): Promise<UpdateStatus> {
    if (this.checking) await this.checking;
    if (this.status.state !== 'AVAILABLE' || !this.offer) await this.check();
    if (this.status.state !== 'AVAILABLE' || !this.offer || this.status.installBlockedReason) return this.get();
    await this.download();
    return this.get();
  }

  /** How this copy was installed on Linux (AppImage, .deb, .rpm), or null elsewhere (worksuite-desktop#345). */
  private linuxKind(): LinuxInstallKind | null {
    return this.deps.platform === 'linux' ? (this.deps.linuxKind?.() ?? linuxInstallKind()) : null;
  }

  /** A .deb or .rpm install: the system's package manager installs the update, behind one password prompt. */
  private systemPackage(): 'deb' | 'rpm' | null {
    const k = this.linuxKind();
    return k === 'deb' || k === 'rpm' ? k : null;
  }

  /** An unsigned build may take an update only from a test channel, and only when this computer asked for one. */
  private unsignedAllowed(offer: Pick<Offer, 'channel'>): boolean {
    return isTestChannel(offer.channel) && this.deps.channel() !== 'stable';
  }

  private async installBlockedReason(offer: Offer): Promise<string | null> {
    const { pkg } = offer;
    if (!app.isPackaged) return 'Development builds do not install updates.';
    const wanted = ucInstallType(this.deps.platform, this.linuxKind());
    if (this.deps.platform === 'linux' && !wanted) return 'This copy of WorkSuite was not installed from a WorkSuite AppImage, .deb or .rpm, so it cannot update itself. Install the latest package from the download page.';
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

  /** Downloads the update on offer (Settings › Updates › Download, when automatic downloads are off), or resumes a paused one. */
  download(): Promise<void> {
    if (this.downloading) return this.downloading;
    const offer = this.offer;
    const resuming = this.status.state === 'DOWNLOADING' && !!this.status.download?.paused;
    if (!offer || !(this.status.state === 'AVAILABLE' || resuming) || !this.status.installSupported) return Promise.resolve();
    this.downloading = this.doDownload(offer)
      .catch((e) => {
        log.error('update download failed', { error: errorText(e) });
        this.record('download-failed', errorText(e), offer.version);
        this.fail('UPDATE_DOWNLOAD_FAILED', 'The update could not be downloaded.');
      })
      .finally(() => {
        this.downloading = null;
        this.job = null;
      });
    return this.downloading;
  }

  // ── The WorkSuite package repository (worksuite-desktop#351) ───────────────

  private repo(): LinuxRepo {
    return this.deps.linuxRepo ?? (this.linuxRepo ??= new LinuxRepo());
  }

  /**
   * The channel changed: a .deb/.rpm install whose package source follows another suite is rewritten to this one
   * (pkexec). Only where the build uses the repository and the source file is there; a missing file is left to
   * Diagnostics › Fix rather than asking for a password here. A closed prompt leaves the channel changed.
   */
  private async syncRepoChannel(): Promise<void> {
    const kind = this.systemPackage();
    const repo = this.repo();
    if (!kind || !repo.enabled()) return;
    const channel = this.deps.channel();
    const st = repo.state(kind, channel);
    if (!st.file.exists || st.file.suite === st.expected) return;
    const r = await repo.setup(kind, channel);
    this.record('repo-channel', r.ok ? `${st.file.suite ?? 'none'} → ${st.expected}` : `${st.expected}: ${r.reason} (${r.detail})`, null);
    if (!r.ok) this.deps.onWarning(`The WorkSuite package source still follows ${st.file.suite ?? 'another channel'}. Settings › Updates › Diagnostics can switch it to ${st.expected}.`);
  }

  /** Diagnostics' three package repository checks on a .deb/.rpm install; none elsewhere. */
  async repoDiagnostics(latest: string | null): Promise<UpdateDiagnosticCheck[]> {
    const kind = this.systemPackage();
    if (!kind) return [];
    const repo = this.repo();
    const st = repo.state(kind, this.deps.channel());
    return repoChecks(st, st.marker && st.file.exists ? await repo.policy(kind) : null, latest);
  }

  /** Diagnostics › Fix: the key and the source file for this channel, and fresh package lists, behind one prompt. */
  async fixRepo(): Promise<{ ok: boolean; message: string }> {
    const kind = this.systemPackage();
    const repo = this.repo();
    if (!kind || !repo.enabled()) return { ok: false, message: 'The WorkSuite package repository is not set up in this build.' };
    const r = await repo.setup(kind, this.deps.channel(), true);
    this.record('repo-fix', r.ok ? repoSuite(this.deps.channel()) : `${r.reason} (${r.detail})`, null);
    if (r.ok) return { ok: true, message: `The WorkSuite package source follows ${repoSuite(this.deps.channel())}.` };
    return { ok: false, message: r.reason === 'cancelled' ? 'The password prompt was closed; nothing was changed.' : r.reason === 'no-pkexec' ? 'This computer has no pkexec to ask for your password.' : `The package source could not be written: ${r.detail}` };
  }

  /**
   * Update now on a .deb (worksuite-desktop#351): when the repository is set up for this channel and apt already
   * offers exactly `version` from it, `pkexec apt-get install --only-upgrade -y worksuite`. Null when it is not, and
   * the downloaded package is installed as before.
   */
  private async installFromRepo(version: string): Promise<PackageInstallResult | null> {
    const repo = this.repo();
    if (!repo.enabled()) return null;
    const st = repo.state('deb', this.deps.channel());
    if (!st.marker || !st.file.exists) return null;
    const policy = await repo.policy('deb').catch(() => null);
    if (!repoOffers(st, policy, version)) return null;
    const r = await repo.aptUpgrade();
    if (!r.ok) log.warn('apt-get from the WorkSuite repository did not install the update', { reason: r.reason, detail: r.detail });
    return r;
  }

  // ── Diagnostics (Settings › Updates › Diagnostics) ─────────────────────────

  /**
   * Asks the Update Center once, without changing anything: how long it took, whether the answer verifies, and
   * whether the package's download URL answers (one byte, by Range).
   */
  async probe(): Promise<UpdateProbe> {
    const url = this.deps.updateUrl(this.deps.channel());
    const none: UpdateProbe = { reached: false, ms: 0, status: null, verified: null, keyId: null, reason: 'no update service is configured', pkg: null, download: null };
    if (!url) return none;
    const t0 = Date.now();
    let res: Response;
    try {
      res = await this.deps.fetch(url, { method: 'GET', headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15_000) });
    } catch (e) {
      return { ...none, reason: errorText(e) };
    }
    const ms = Date.now() - t0;
    if (!res.ok) return { ...none, reached: true, ms, status: res.status, reason: `HTTP ${res.status}` };
    let raw: Record<string, unknown>;
    try {
      raw = (await res.json()) as Record<string, unknown>;
    } catch {
      return { ...none, reached: true, ms, status: res.status, verified: false, reason: 'malformed' };
    }
    const accepted = acceptUpdateResponse(raw, this.deps.responseKeys, app.getVersion());
    const keyId = typeof raw.key_id === 'string' ? raw.key_id : null;
    if (!accepted.ok) return { reached: true, ms, status: res.status, verified: false, keyId, reason: accepted.reason, pkg: null, download: null };
    const pkg = accepted.response.package ?? null;
    const latest = accepted.response.latest_version ?? null;
    if (!pkg || !latest || !isNewer(latest, app.getVersion())) return { reached: true, ms, status: res.status, verified: true, keyId, reason: null, pkg: null, download: null, latest };
    const dl = resolveArtifactUrl(pkg.download_url, url, this.deps.allowInsecure);
    let download: UpdateProbe['download'] = { ok: false, status: null };
    if (dl) {
      try {
        const r = await this.deps.fetch(dl, { method: 'GET', headers: { Range: 'bytes=0-0' }, signal: AbortSignal.timeout(15_000) });
        download = { ok: r.ok, status: r.status };
        await r.body?.cancel().catch(() => undefined);
      } catch {
        download = { ok: false, status: null };
      }
    }
    return { reached: true, ms, status: res.status, verified: true, keyId, reason: null, pkg: { size: pkg.size }, download, latest };
  }

  /** Free space where updates are downloaded. */
  async freeBytes(): Promise<number | null> {
    try {
      await mkdir(this.deps.updatesDir, { recursive: true });
      const s = await statfs(this.deps.updatesDir);
      return Number(s.bavail) * Number(s.bsize);
    } catch {
      return null;
    }
  }

  /** Whether this copy can replace itself where it is installed (no elevation needed), or null when it does not update itself. */
  async installWritable(): Promise<{ ok: boolean; detail: string } | null> {
    if (!app.isPackaged) return null;
    const where = this.deps.platform === 'macos' ? (bundlePath() ? dirname(bundlePath()!) : null) : this.deps.platform === 'linux' ? (process.env.APPIMAGE ? dirname(process.env.APPIMAGE) : null) : dirname(process.execPath);
    if (!where) return null;
    try {
      await access(where, fsConstants.W_OK);
      return { ok: true, detail: this.deps.platform === 'windows' ? 'Per-user install · no elevation needed' : `${where} is writable · no elevation needed` };
    } catch {
      return { ok: false, detail: `${where} is not writable by you` };
    }
  }

  /** Pause: what has arrived is kept, and Resume carries on from there (HTTP Range). */
  async pauseDownload(): Promise<UpdateStatus> {
    if (this.job && this.status.state === 'DOWNLOADING') {
      this.job.pause();
      await this.downloading;
    }
    return this.get();
  }

  async resumeDownload(): Promise<UpdateStatus> {
    if (this.status.state === 'DOWNLOADING' && this.status.download?.paused) void this.download();
    return this.get();
  }

  /** Cancel: what has arrived is deleted, and the version stays on offer. */
  async cancelDownload(): Promise<UpdateStatus> {
    if (this.status.state !== 'DOWNLOADING') return this.get();
    if (this.job) {
      this.job.cancel();
      await this.downloading;
    } else {
      if (this.partialPath) await rm(this.partialPath, { force: true });
      this.afterCancel();
    }
    return this.get();
  }

  private afterCancel(): void {
    this.record('download-cancelled', null, this.offer?.version ?? null);
    const pipeline = (this.status.pipeline ?? []).map((p) => (p.id === 'manifest' ? p : { ...p, state: 'pending' as const, detail: 'Pending' }));
    this.set({ state: 'AVAILABLE', progress: 0, download: null, pipeline });
  }

  private async doDownload(offer: Offer): Promise<void> {
    const { pkg } = offer;
    const url = resolveArtifactUrl(pkg.download_url, offer.checkUrl, this.deps.allowInsecure);
    if (!url) {
      this.record('download-failed', 'not https', offer.version);
      this.fail('UPDATE_DOWNLOAD_FAILED', 'The update is not served over HTTPS.');
      return;
    }
    const dir = join(this.deps.updatesDir, offer.version);
    await mkdir(dir, { recursive: true });
    const name = pkg.file_name.replace(/[^A-Za-z0-9._-]/g, '_') || `update-${pkg.type}`;
    const final = join(dir, name);
    const partial = `${final}.partial`;
    this.partialPath = partial;
    const already = await stat(partial).then((st) => Math.min(st.size, pkg.size), () => 0);
    const resumable = already > 0;
    this.set({
      state: 'DOWNLOADING',
      progress: Math.floor((already / pkg.size) * 100),
      download: { received: already, total: pkg.size, bytesPerSecond: 0, secondsLeft: null, paused: false, retrying: false, resumable },
    });
    this.step('download', 'active', resumable ? `Resuming at ${Math.floor((already / pkg.size) * 100)}%` : 'Starting');
    this.record(resumable ? 'download-resume' : 'download-start', `${resumable ? `${already} of ` : ''}${pkg.size} bytes`, offer.version);
    const job = new ResumableDownload(
      { fetch: this.deps.fetch },
      {
        url,
        partial,
        size: pkg.size,
        // The signed URL lasts 15 minutes; the grant buys a fresh one for the same file.
        refresh: pkg.download_grant ? () => this.redeemGrant(pkg.download_grant!, offer.checkUrl) : undefined,
        onProgress: (p) => {
          const pct = Math.min(100, Math.floor((p.received / p.total) * 100));
          this.status = { ...this.status, progress: pct, download: { ...p, paused: false } };
          this.step('download', 'active', p.retrying ? 'Network lost · retrying' : `${p.resumable ? 'Resumable · ' : ''}${pct}%`);
        },
      },
    );
    this.job = job;
    const r = await job.run();
    this.job = null;
    if (!r.ok) {
      if (r.reason === 'paused') {
        this.record('download-paused', null, offer.version);
        this.step('download', 'active', 'Paused');
        this.set({ download: { ...(this.status.download ?? { received: 0, total: pkg.size, bytesPerSecond: 0, secondsLeft: null, resumable: false }), paused: true, retrying: false, bytesPerSecond: 0, secondsLeft: null } });
        return;
      }
      if (r.reason === 'cancelled') {
        this.afterCancel();
        return;
      }
      this.step('download', 'failed', r.reason === 'http' ? `HTTP ${r.status}` : r.reason === 'too-large' ? 'Larger than announced' : 'Network lost');
      this.record('download-failed', r.reason === 'http' ? `HTTP ${r.status}` : r.reason, offer.version);
      this.fail('UPDATE_DOWNLOAD_FAILED', r.reason === 'http' ? `Download failed (${r.status}).` : 'The update could not be downloaded.');
      return;
    }
    this.step('download', 'done', 'Downloaded');
    if (r.bytes !== pkg.size || r.sha256 !== pkg.sha256) {
      await rm(partial, { force: true });
      log.error('update checksum mismatch', { expected: pkg.sha256, got: r.sha256, bytes: r.bytes });
      this.record('download-failed', 'checksum mismatch', offer.version);
      this.step('sha256', 'failed', 'Did not match the signed checksum');
      this.fail('UPDATE_CHECKSUM_MISMATCH', 'The downloaded update did not match its checksum and was deleted.');
      return;
    }
    await rename(partial, final);
    this.partialPath = null;
    this.record('download-done', 'sha256 verified', offer.version);
    this.status = { ...this.status, pipeline: (this.status.pipeline ?? []).map((p) => (p.id === 'sha256' ? { id: p.id, state: 'done', detail: 'Matches the signed answer' } : p)) };
    this.set({ state: 'VERIFIED', progress: 100, download: null });
    const staged = await this.stage(final, dir, offer);
    if (!staged) return;
    this.stagedPath = staged;
    this.status = { ...this.status, pipeline: (this.status.pipeline ?? []).map((p) => (p.id === 'stage' ? { id: p.id, state: 'done', detail: 'Ready to install' } : p)) };
    await this.saveStaged({ version: offer.version, file: final, offer: { version: offer.version, critical: offer.critical, pkg: offer.pkg, channel: offer.channel, notes: offer.notes, downgrade: offer.downgrade } });
    const required = this.status.required ? (this.status.mandatory?.deadline ?? null) : null;
    const deadline = required ?? (offer.critical || this.status.required ? new Date(Date.now() + this.deps.deadlineHours() * 3600_000).toISOString() : null);
    this.record('staged', deadline ? `installs by ${deadline}` : null, offer.version);
    this.set({ state: 'STAGED', deadline });
    if (deadline) this.armDeadline(new Date(deadline).getTime());
    this.deps.notifier?.onReady({ version: offer.version, critical: offer.critical, summary: offer.notes?.summary ?? null });
    if (offer.graceMinutes) void this.startGrace(offer.version, offer.graceMinutes);
  }

  /**
   * A critical release: everything is saved now (drafts, tabs; the offline queue is already on disk), and it installs
   * when the grace period ends — a call or meeting then ends too, which the modal says.
   */
  private async startGrace(version: string, minutes: number): Promise<void> {
    const ends = Date.now() + minutes * 60_000;
    const base = { version, graceMinutes: minutes, graceEndsAt: new Date(ends).toISOString() };
    this.record('critical-grace', `${minutes} min`, version);
    this.set({ immediate: { ...base, saved: null } });
    let flushed = false;
    if (this.deps.prepareRestart) {
      try {
        await this.deps.prepareRestart();
        flushed = true;
      } catch (e) {
        log.warn('saving before a critical update did not finish', { error: errorText(e) });
      }
    }
    const b = this.deps.busy();
    if (this.status.state !== 'STAGED') return;
    this.set({ immediate: { ...base, saved: { flushed, drafts: b.drafts, pendingMutations: b.pendingMutations } } });
    if (this.graceTimer) clearTimeout(this.graceTimer);
    this.graceTimer = setTimeout(() => void this.install(true), Math.max(0, ends - Date.now()));
    this.graceTimer.unref?.();
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
    this.step('codesign', 'active', 'Checking');
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
        this.step('codesign', mine ? 'done' : 'skipped', mine ? `Developer ID · team ${theirs}` : 'Unsigned build on a test channel');
        return newApp;
      }
      if (this.deps.platform === 'windows') {
        const mine = await winSigner(process.execPath);
        if (!mine.valid && this.unsignedAllowed(offer)) {
          this.step('codesign', 'skipped', 'Unsigned build on a test channel');
          return file;
        }
        const theirs = await winSigner(file);
        if (!theirs.valid || !mine.subject || mine.subject !== theirs.subject) throw new Error('the installer is not signed by the same publisher');
        this.step('codesign', 'done', 'Authenticode valid');
        return file;
      }
      // Linux: the Update Center's Ed25519-signed answer names the package and its SHA-256, which matched above.
      if (!this.systemPackage()) await chmod(file, 0o755);
      this.step('codesign', 'done', 'Ed25519-signed answer · SHA-256 matched');
      return file;
    } catch (e) {
      log.error('update failed code-signature verification', { error: errorText(e) });
      this.record('verify-failed', errorText(e), null);
      this.step('codesign', 'failed', 'Not signed by the same publisher');
      this.fail('UPDATE_CODESIGN_FAILED', 'The update failed signature verification and was not installed.');
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

  /** What Later puts off: the version on offer, or a required update that has nothing on offer yet. */
  private laterKey(): string | null {
    return this.status.availableVersion ?? (this.status.required ? `required:${this.status.minimumVersion ?? 'server'}` : null);
  }

  /**
   * Later: in 1 hour, 4 hours, tomorrow (Tonight and the next launch for older callers). A required update may be put
   * off only until its deadline, and only as often as the release allows.
   */
  later(choice: LaterChoice = 'hour'): UpdateStatus {
    if (this.status.required) {
      const now = new Date();
      const m = mandatoryView(this.get(), now);
      const until = laterUntil(choice, now);
      const refuse = m.locked
        ? 'The deadline for this update has passed.'
        : m.deferralsLeft <= 0
          ? 'This update cannot be put off again.'
          : !until || (m.deadline && until.getTime() > m.deadline.getTime())
            ? 'That is after the deadline for this update.'
            : null;
      if (refuse) throw Object.assign(new Error(refuse), { code: 'POLICY_DENIED' });
    }
    const r = this.deps.notifier?.later(choice, this.laterKey());
    this.record('later', `${choice}${r?.installOnNextLaunch ? ' (installs at next launch)' : ''}`, this.status.availableVersion);
    this.publish();
    return this.get();
  }

  /**
   * "Restart when work finishes": WorkSuite restarts as soon as nothing would be interrupted — no call, meeting,
   * screen share or remote control, and no transfer still running. Drafts and the offline queue are kept either way.
   */
  installWhenFree(): UpdateStatus {
    if (this.status.state !== 'STAGED') return this.get();
    this.record('restart-when-free', null, this.status.availableVersion);
    this.set({ restartWhenFree: true });
    if (!this.freeTimer) {
      this.freeTimer = setInterval(() => void this.workChanged(), 30_000);
      this.freeTimer.unref?.();
    }
    void this.workChanged();
    return this.get();
  }

  /** A call, meeting, share or transfer ended (and every 30 s while waiting): restart if that was all. */
  async workChanged(): Promise<void> {
    if (!this.status.restartWhenFree || this.status.state !== 'STAGED') return;
    if (restartWaits(restartImpact(this.deps.busy()))) return;
    if (this.freeTimer) clearInterval(this.freeTimer);
    this.freeTimer = null;
    this.set({ restartWhenFree: false });
    await this.install(true);
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
      // A system package is installed while WorkSuite still runs (the password prompt needs it); it quits afterwards.
      if (!this.systemPackage()) await this.deps.beforeQuit();
      const rollbackPossible = this.deps.platform !== 'windows' && !this.systemPackage();
      this.deps.health?.beforeInstall(app.getVersion(), version, rollbackPossible, relaunch, this.status.notes?.url ?? this.status.notesUrl, new Date(), { highlights: this.status.notes?.highlights, summary: this.status.notes?.summary });
      if (relaunch) this.deps.health?.requestSessionRestore();
      this.deps.notifier?.doneWith(version);
      const pkgKind = this.systemPackage();
      if (pkgKind) return await this.installSystemPackage(pkgKind, this.stagedPath, version, relaunch, busy);
      this.launchInstaller(this.stagedPath, version, relaunch);
      return { started: true, busy, message: null };
    } catch (e) {
      log.error('install failed', { error: errorText(e) });
      this.record('install-failed', errorText(e), version);
      this.fail('UPDATE_INSTALL_FAILED', 'The update could not be installed. The current version keeps running.', { version });
      return { started: false, busy, message: 'The update could not be installed.' };
    }
  }

  /**
   * Install when quitting (Settings › Updates). Runs inside `before-quit`, which cannot wait, so every step
   * here is synchronous: the installer (or the macOS swap script) starts and carries on after WorkSuite has gone.
   * It does not reopen WorkSuite; the next launch checks the new version's health.
   */
  installOnQuitSync(): boolean {
    if (this.quitInstallTried) return false;
    this.quitInstallTried = true;
    if (this.status.state !== 'STAGED' || !this.stagedPath || !(this.deps.installOnQuit?.() ?? false)) return false;
    // A .deb or .rpm needs its password prompt answered, which cannot happen after WorkSuite has gone.
    if (this.systemPackage()) return false;
    const version = this.status.availableVersion ?? this.offer?.version ?? 'unknown';
    try {
      this.record('install', 'on quit', version);
      this.deps.health?.beforeInstall(app.getVersion(), version, this.deps.platform !== 'windows', false, this.status.notes?.url ?? this.status.notesUrl, new Date(), { highlights: this.status.notes?.highlights, summary: this.status.notes?.summary });
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

  /**
   * A .deb or .rpm (worksuite-desktop#345): the system's package manager installs the downloaded package behind one
   * password prompt, then WorkSuite restarts on the new version. No pkexec, or the prompt closed: the package opens in
   * the desktop's software installer instead, and WorkSuite keeps running until the person installs it there.
   */
  private async installSystemPackage(kind: 'deb' | 'rpm', path: string, version: string, relaunch: boolean, busy: BusyReport): Promise<{ started: boolean; busy: BusyReport | null; message: string | null }> {
    // From the WorkSuite repository when apt already offers this version there (#351); a closed prompt stays closed,
    // anything else falls back to the downloaded, checked package.
    const viaRepo = kind === 'deb' ? await this.installFromRepo(version) : null;
    const r = viaRepo && (viaRepo.ok || viaRepo.reason === 'cancelled') ? viaRepo : await (this.deps.installPackage ?? installPackage)(kind, path);
    if (r.ok) {
      this.record('install', r === viaRepo ? 'deb installed from the WorkSuite repository (apt-get)' : `${kind} installed by the package manager`, version);
      if (relaunch) {
        await this.deps.beforeQuit();
        app.relaunch({ args: ['--updated'] });
        app.exit(0);
      }
      return { started: true, busy, message: null };
    }
    this.record('install-failed', `${kind}: ${r.reason} (${r.detail})`, version);
    if (r.reason === 'failed') {
      this.fail('UPDATE_INSTALL_FAILED', `The package manager could not install WorkSuite ${version}: ${r.detail}`, { version, rollback: 'not-possible' });
      return { started: false, busy, message: 'The update could not be installed.' };
    }
    // No pkexec, or the password prompt was closed: hand the package to the software installer.
    const opened = (await (this.deps.openPath?.(path) ?? Promise.resolve('no opener'))) === '';
    this.set({ state: 'STAGED' });
    const how = opened ? 'It is open in your software installer: choose Install there, then restart WorkSuite.' : `Install it from ${path} with your software installer, or run: sudo ${kind === 'deb' ? 'apt install' : 'dnf install'} "${path}"`;
    return { started: false, busy, message: `${r.reason === 'cancelled' ? 'The password prompt was closed.' : 'This computer has no pkexec to ask for your password.'} ${how}` };
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
      const message = restored ? `WorkSuite ${v.failedVersion} did not start, so the previous version was put back. ${v.reason}` : `WorkSuite ${v.failedVersion} did not install. ${v.reason}`;
      this.set({ rollback: { failedVersion: v.failedVersion, restored, message } });
      this.fail('UPDATE_INSTALL_FAILED', message, { version: v.failedVersion, rollback: restored ? 'ok' : 'none' }, { state: this.status.state, error: this.status.error });
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
    const report = (restored: boolean, message: string) => {
      this.set({ rollback: { failedVersion: failed, restored, message } });
      this.fail('UPDATE_INSTALL_FAILED', message, { version: failed, rollback: this.deps.platform === 'windows' ? 'not-possible' : 'failed' }, { state: this.status.state, error: this.status.error });
    };
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
    this.set({ rollback: null, failure: null });
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

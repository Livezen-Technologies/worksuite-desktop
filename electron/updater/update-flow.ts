import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { UpdateActivity } from '@shared/types';
import { laterUntil, quietReason, type LaterChoice } from '@shared/updates';
import { compareVersions } from '@shared/version';

/**
 * The parts of updating around the updater itself (worksuite-desktop#205): when to check, when and how to tell
 * the person an update is ready, the history kept for Diagnostics, and the first-run health check that rolls a
 * failed update back. None of it touches Electron directly, so each piece is tested on its own.
 */

// ── History (Diagnostics) ─────────────────────────────────────────────────

export interface HistoryEntry {
  t: string;
  event: string;
  version?: string | null;
  channel?: string | null;
  detail?: string | null;
}

/** Every check, download, install and rollback, kept in `history.jsonl` (the last 300) and in the support report. */
export class UpdateHistory {
  private static readonly KEEP = 300;
  private readonly file: string;

  constructor(dir: string, private readonly now: () => Date = () => new Date()) {
    this.file = join(dir, 'history.jsonl');
  }

  add(event: string, fields: Omit<HistoryEntry, 't' | 'event'> = {}): HistoryEntry {
    const entry: HistoryEntry = { t: this.now().toISOString(), event, ...fields };
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      appendFileSync(this.file, JSON.stringify(entry) + '\n', { mode: 0o600 });
      const lines = readFileSync(this.file, 'utf8').split('\n').filter(Boolean);
      if (lines.length > UpdateHistory.KEEP * 1.5) writeFileSync(this.file, lines.slice(-UpdateHistory.KEEP).join('\n') + '\n', { mode: 0o600 });
    } catch {
      /* the history is a help, never a reason to fail */
    }
    return entry;
  }

  entries(): HistoryEntry[] {
    try {
      return readFileSync(this.file, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as HistoryEntry)
        .slice(-UpdateHistory.KEEP);
    } catch {
      return [];
    }
  }
}

// ── When to check ─────────────────────────────────────────────────────────

export interface SchedulerDeps {
  check: (reason: 'launch' | 'interval' | 'wake') => void;
  setTimeout: (fn: () => void, ms: number) => unknown;
  setInterval: (fn: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
}

export const CHECK_AFTER_LAUNCH_MS = 30_000;
export const CHECK_EVERY_MS = 4 * 3600_000;
/** After waking, the network needs a moment. */
export const CHECK_AFTER_WAKE_MS = 15_000;

/** At launch (shortly after), every 4 hours, and after the computer wakes. */
export class UpdateScheduler {
  private handles: unknown[] = [];
  private wakeTimer: unknown = null;

  constructor(private readonly deps: SchedulerDeps) {}

  start(): void {
    this.stop();
    this.handles.push(this.deps.setTimeout(() => this.deps.check('launch'), CHECK_AFTER_LAUNCH_MS));
    this.handles.push(this.deps.setInterval(() => this.deps.check('interval'), CHECK_EVERY_MS));
  }

  /** powerMonitor `resume`: one check a little later (several wakes in a row make one check). */
  wake(): void {
    if (this.wakeTimer) this.deps.clear(this.wakeTimer);
    this.wakeTimer = this.deps.setTimeout(() => {
      this.wakeTimer = null;
      this.deps.check('wake');
    }, CHECK_AFTER_WAKE_MS);
  }

  stop(): void {
    for (const h of this.handles) this.deps.clear(h);
    this.handles = [];
    if (this.wakeTimer) this.deps.clear(this.wakeTimer);
    this.wakeTimer = null;
  }
}

// ── Telling the person ────────────────────────────────────────────────────

export interface KeyValue {
  get<T>(key: string): T | undefined;
  set(key: string, value: unknown): void;
}

export interface ReadyUpdate {
  version: string;
  critical: boolean;
  summary: string | null;
}

export interface NotifierDeps {
  store: KeyValue;
  now: () => Date;
  /** A meeting, call, screen share or remote control in progress. */
  activity: () => UpdateActivity;
  /** Settings › About › Updates › Show a notification when an update is ready. */
  notifyEnabled: () => boolean;
  /** The desktop notification ("WorkSuite X is ready. Restart to update."). */
  desktop: (title: string, body: string, critical: boolean) => void;
  /** The entry in the notifications bell. */
  bell: (id: string, title: string, body: string) => void;
  setTimeout: (fn: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
  onChange: () => void;
}

interface NotifierState {
  /** Versions whose desktop notification and bell entry went out (once each). */
  notified: string[];
  /** Times each version was put off with Later. */
  postponed: Record<string, number>;
  /** Later: the reminder comes back at (ms). */
  snoozedUntil: Record<string, number>;
  /** A critical update put off more than once: installs at the next launch. */
  installOnNextLaunch: string | null;
}

const STATE_KEY = 'updates:notices';

/**
 * Once an update is downloaded: the "Update ready" pill, a desktop notification and a bell entry — each once per
 * version, never during a meeting, call, screen share or remote control (they wait until it ends). Later puts the
 * pill and reminder off for an hour, until tonight or until the next launch. A critical update put off more than
 * once installs by itself when WorkSuite next starts.
 */
export class UpdateNotifier {
  private ready: ReadyUpdate | null = null;
  private pending = false;
  private timer: unknown = null;
  /** "On next app launch" lasts for this run only. */
  private untilNextLaunch = new Set<string>();

  constructor(private readonly deps: NotifierDeps) {}

  private state(): NotifierState {
    const s = this.deps.store.get<Partial<NotifierState>>(STATE_KEY) ?? {};
    return { notified: s.notified ?? [], postponed: s.postponed ?? {}, snoozedUntil: s.snoozedUntil ?? {}, installOnNextLaunch: s.installOnNextLaunch ?? null };
  }

  private save(s: NotifierState): void {
    this.deps.store.set(STATE_KEY, { ...s, notified: s.notified.slice(-20) });
  }

  /** The updater staged a version: tell the person, now or when what they are doing ends. */
  onReady(u: ReadyUpdate): void {
    this.ready = u;
    this.pending = true;
    this.flush();
    this.deps.onChange();
  }

  /** Nothing is ready any more (installed, failed, replaced). */
  clear(): void {
    this.ready = null;
    this.pending = false;
    if (this.timer) this.deps.clear(this.timer);
    this.timer = null;
  }

  /** Call when a meeting, call, share or remote control starts or ends. */
  activityChanged(): void {
    this.flush();
    this.deps.onChange();
  }

  quietReason(): string | null {
    return quietReason(this.deps.activity());
  }

  private flush(): void {
    const u = this.ready;
    if (!u || !this.pending) return;
    if (this.quietReason()) return;
    if (this.snoozed(u.version)) return;
    this.pending = false;
    const s = this.state();
    if (s.notified.includes(u.version)) return;
    s.notified.push(u.version);
    this.save(s);
    const title = u.critical ? `Security update: WorkSuite ${u.version}` : `WorkSuite ${u.version} is ready`;
    const body = `WorkSuite ${u.version} is ready. Restart to update.`;
    if (this.deps.notifyEnabled()) this.deps.desktop(title, body, u.critical);
    this.deps.bell(`update:${u.version}`, title, u.summary ? `${body} ${u.summary}` : body);
  }

  private snoozed(version: string): boolean {
    if (this.untilNextLaunch.has(version)) return true;
    const until = this.state().snoozedUntil[version];
    return typeof until === 'number' && until > this.deps.now().getTime();
  }

  /** Whether the "Update ready" pill shows: an update is ready, it is not put off, and nothing must not be interrupted. */
  pillVisible(): boolean {
    return !!this.ready && !this.snoozed(this.ready.version) && !this.quietReason();
  }

  /** Later: returns when the reminder comes back (null: next launch). */
  later(choice: LaterChoice): { until: Date | null; installOnNextLaunch: boolean } {
    const u = this.ready;
    if (!u) return { until: null, installOnNextLaunch: false };
    const s = this.state();
    s.postponed[u.version] = (s.postponed[u.version] ?? 0) + 1;
    const until = laterUntil(choice, this.deps.now());
    if (until) s.snoozedUntil[u.version] = until.getTime();
    else this.untilNextLaunch.add(u.version);
    // A critical or security update may be put off once; after that it installs when WorkSuite next starts.
    if (u.critical && s.postponed[u.version]! > 1) s.installOnNextLaunch = u.version;
    this.save(s);
    if (this.timer) this.deps.clear(this.timer);
    this.timer = until
      ? this.deps.setTimeout(() => {
          this.timer = null;
          this.deps.onChange();
        }, Math.max(0, until.getTime() - this.deps.now().getTime()))
      : null;
    this.deps.onChange();
    return { until, installOnNextLaunch: s.installOnNextLaunch === u.version };
  }

  snoozedUntil(): string | null {
    const u = this.ready;
    if (!u) return null;
    if (this.untilNextLaunch.has(u.version)) return 'next-launch';
    const until = this.state().snoozedUntil[u.version];
    return typeof until === 'number' && until > this.deps.now().getTime() ? new Date(until).toISOString() : null;
  }

  postponed(version: string): number {
    return this.state().postponed[version] ?? 0;
  }

  /** True the first time `key` is asked about, then never again (a notice shown once). */
  once(key: string): boolean {
    const shown = this.deps.store.get<string[]>('updates:once') ?? [];
    if (shown.includes(key)) return false;
    this.deps.store.set('updates:once', [...shown, key].slice(-50));
    return true;
  }

  /** The version to install as WorkSuite starts (a critical update put off more than once), or null. */
  installAtLaunch(): string | null {
    return this.state().installOnNextLaunch;
  }

  /** Installed (or no longer wanted): forget the version's launch install. */
  doneWith(version: string): void {
    const s = this.state();
    if (s.installOnNextLaunch === version) s.installOnNextLaunch = null;
    delete s.snoozedUntil[version];
    delete s.postponed[version];
    this.save(s);
  }
}

// ── First run after an update: health check, rollback, "Updated to X" ─────

export interface InstallMarker {
  from: string;
  to: string;
  at: string;
  /** Launches of `to` that have not reached a healthy start yet. */
  attempts: number;
  /** The previous version can be put back (macOS app bundle, Linux AppImage). */
  rollbackPossible: boolean;
  /** Restore the same tabs and windows after the restart. */
  restoreSession: boolean;
  /** The release notes, for "Updated to X · What's new". */
  notesUrl?: string | null;
}

export type LaunchVerdict =
  | { kind: 'normal' }
  | { kind: 'verifying'; marker: InstallMarker }
  | { kind: 'rollback'; marker: InstallMarker }
  | { kind: 'rolled-back'; failedVersion: string; restored: true; reason: string }
  | { kind: 'not-installed'; failedVersion: string; reason: string };

/** Launches of a new version that may fail before it counts as broken (the third one rolls back). */
export const MAX_UNHEALTHY_LAUNCHES = 2;

/**
 * The marker written before installing, and what the next start makes of it:
 *  - the new version started: count the attempt; once its window has loaded it is healthy, the marker goes and
 *    "Updated to X · What's new" is shown once;
 *  - the new version started more than MAX_UNHEALTHY_LAUNCHES times without becoming healthy: roll back;
 *  - the old version started (the swap failed, or the watchdog put it back): report what happened.
 * `health-<version>.ok` is the file the macOS and Linux watchdog scripts wait for.
 */
export class UpdateHealth {
  readonly markerPath: string;
  readonly rolledBackPath: string;
  readonly noticePath: string;

  constructor(private readonly dir: string) {
    this.markerPath = join(dir, 'install-marker.json');
    this.rolledBackPath = join(dir, 'rolled-back.json');
    this.noticePath = join(dir, 'updated-notice.json');
  }

  healthFile(version: string): string {
    return join(this.dir, `health-${version.replace(/[^0-9A-Za-z.-]/g, '_')}.ok`);
  }

  private read<T>(path: string): T | null {
    try {
      return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as T) : null;
    } catch {
      return null;
    }
  }

  private write(path: string, v: unknown): void {
    mkdirSync(this.dir, { recursive: true });
    writeFileSync(path, JSON.stringify(v), { mode: 0o600 });
  }

  marker(): InstallMarker | null {
    return this.read<InstallMarker>(this.markerPath);
  }

  beforeInstall(from: string, to: string, rollbackPossible: boolean, restoreSession: boolean, notesUrl: string | null = null, now = new Date()): InstallMarker {
    const m: InstallMarker = { from, to, at: now.toISOString(), attempts: 0, rollbackPossible, restoreSession, notesUrl };
    rmSync(this.healthFile(to), { force: true });
    rmSync(this.rolledBackPath, { force: true });
    this.write(this.markerPath, m);
    return m;
  }

  onLaunch(current: string): LaunchVerdict {
    const m = this.marker();
    const rolled = this.read<{ failed: string; reason?: string }>(this.rolledBackPath);
    if (rolled) {
      rmSync(this.rolledBackPath, { force: true });
      rmSync(this.markerPath, { force: true });
      return { kind: 'rolled-back', failedVersion: rolled.failed, restored: true, reason: rolled.reason ?? 'WorkSuite did not start.' };
    }
    if (!m) return { kind: 'normal' };
    if (current === m.to) {
      const next = { ...m, attempts: m.attempts + 1 };
      this.write(this.markerPath, next);
      return next.attempts > MAX_UNHEALTHY_LAUNCHES ? { kind: 'rollback', marker: next } : { kind: 'verifying', marker: next };
    }
    rmSync(this.markerPath, { force: true });
    // Still (or again) the version it was updating from: the new one never took over.
    if (compareVersions(current, m.to) !== 0) return { kind: 'not-installed', failedVersion: m.to, reason: 'The update was downloaded but did not install.' };
    return { kind: 'normal' };
  }

  /** The new version's window loaded: it is healthy. Returns the version it updated to, once. */
  markHealthy(current: string): string | null {
    const m = this.marker();
    if (!m || m.to !== current) return null;
    try {
      writeFileSync(this.healthFile(current), new Date().toISOString(), { mode: 0o600 });
    } catch {
      /* the watchdog then rolls back; better than not knowing */
    }
    rmSync(this.markerPath, { force: true });
    this.write(this.noticePath, { version: current, notesUrl: m.notesUrl ?? null, at: new Date().toISOString() });
    return current;
  }

  /** "Updated to X": shown once, until dismissed. */
  notice(): { version: string; notesUrl?: string | null } | null {
    return this.read<{ version: string; notesUrl?: string | null }>(this.noticePath);
  }

  dismissNotice(): void {
    rmSync(this.noticePath, { force: true });
  }

  /** Consumed once by tab restore: the restart was an update's, so the same tabs and windows come back. */
  takeSessionRestore(): boolean {
    const path = join(this.dir, 'restore-session.json');
    const v = existsSync(path);
    if (v) rmSync(path, { force: true });
    return v;
  }

  peekSessionRestore(): boolean {
    return existsSync(join(this.dir, 'restore-session.json'));
  }

  requestSessionRestore(): void {
    this.write(join(this.dir, 'restore-session.json'), { at: new Date().toISOString() });
  }
}

/** How long the watchdog waits for the new version to say it is healthy. */
export const WATCHDOG_SECONDS = 180;

/**
 * macOS: after WorkSuite quits, move the running app aside (kept as the rollback copy), put the new one in its
 * place and open it — then wait for it to report a healthy start. If it does not within WATCHDOG_SECONDS, quit
 * it, put the previous app back, record why, and open that.
 *
 * Arguments: PID TARGET NEW BACKUP HEALTH ROLLEDBACK VERSION RELAUNCH(1|0)
 */
export function macSwapScript(): string {
  return [
    '#!/bin/sh',
    'PID="$1"; TARGET="$2"; NEW="$3"; BACKUP="$4"; HEALTH="$5"; ROLLED="$6"; VERSION="$7"; RELAUNCH="$8"',
    'while kill -0 "$PID" 2>/dev/null; do sleep 0.5; done',
    'rm -rf "$BACKUP"',
    'mv "$TARGET" "$BACKUP" || { [ "$RELAUNCH" = 1 ] && open "$TARGET"; exit 1; }',
    'if ! mv "$NEW" "$TARGET"; then mv "$BACKUP" "$TARGET"; [ "$RELAUNCH" = 1 ] && open "$TARGET"; exit 1; fi',
    // Installed on quit: nobody is waiting for it to start, so the next launch checks it (install-marker.json).
    '[ "$RELAUNCH" = 1 ] || exit 0',
    'open "$TARGET" --args --updated',
    `i=0; while [ $i -lt ${WATCHDOG_SECONDS} ]; do [ -f "$HEALTH" ] && exit 0; sleep 1; i=$((i+1)); done`,
    'pkill -f "$TARGET/Contents/MacOS/" 2>/dev/null; sleep 2',
    'rm -rf "$TARGET.failed"; mv "$TARGET" "$TARGET.failed" && mv "$BACKUP" "$TARGET"',
    'printf \'{"failed":"%s","reason":"WorkSuite %s did not start within %s seconds."}\' "$VERSION" "$VERSION" ' + WATCHDOG_SECONDS + ' > "$ROLLED"',
    'rm -rf "$TARGET.failed"',
    'open "$TARGET"',
    '',
  ].join('\n');
}

/**
 * Linux AppImage: the image is replaced in place (the previous one kept as `.previous`) and relaunched; this
 * watches for the healthy start and otherwise puts the previous image back.
 *
 * Arguments: APPIMAGE HEALTH ROLLEDBACK VERSION
 */
export function linuxWatchdogScript(): string {
  return [
    '#!/bin/sh',
    'IMG="$1"; HEALTH="$2"; ROLLED="$3"; VERSION="$4"',
    `i=0; while [ $i -lt ${WATCHDOG_SECONDS} ]; do [ -f "$HEALTH" ] && exit 0; sleep 1; i=$((i+1)); done`,
    '[ -f "$IMG.previous" ] || exit 1',
    'pkill -f "$IMG" 2>/dev/null; sleep 2',
    'mv -f "$IMG.previous" "$IMG" && chmod 755 "$IMG"',
    'printf \'{"failed":"%s","reason":"WorkSuite %s did not start within %s seconds."}\' "$VERSION" "$VERSION" ' + WATCHDOG_SECONDS + ' > "$ROLLED"',
    'nohup "$IMG" >/dev/null 2>&1 &',
    '',
  ].join('\n');
}

/** macOS: put the kept previous app back from inside a version that keeps failing (it quits, then the swap runs). */
export function macRestoreScript(): string {
  return [
    '#!/bin/sh',
    'PID="$1"; TARGET="$2"; BACKUP="$3"',
    'while kill -0 "$PID" 2>/dev/null; do sleep 0.5; done',
    '[ -d "$BACKUP" ] || { open "$TARGET"; exit 1; }',
    'rm -rf "$TARGET.failed"; mv "$TARGET" "$TARGET.failed" && mv "$BACKUP" "$TARGET" && rm -rf "$TARGET.failed"',
    'open "$TARGET"',
    '',
  ].join('\n');
}

/** What each platform can do when the new version fails to start (Settings › About and the release notes say so). */
export function rollbackSupport(platform: 'windows' | 'macos' | 'linux'): { automatic: boolean; how: string } {
  switch (platform) {
    case 'macos':
      return { automatic: true, how: 'The previous app is kept until the new one starts; a watchdog puts it back if the new one does not start within 3 minutes, or after it fails to start twice.' };
    case 'linux':
      return { automatic: true, how: 'The previous AppImage is kept until the new one starts; a watchdog puts it back if the new one does not start within 3 minutes, or after it fails to start twice.' };
    case 'windows':
      return { automatic: false, how: 'The Windows installer replaces the previous version, so it cannot be put back automatically. A failed start is reported, Safe Mode follows repeated crashes, and the previous installer can be reinstalled from the Update Center.' };
  }
}

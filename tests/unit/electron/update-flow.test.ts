import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UpdateActivity } from '../../../shared/types';
import {
  CHECK_AFTER_LAUNCH_MS,
  CHECK_AFTER_WAKE_MS,
  CHECK_EVERY_MS,
  MAX_UNHEALTHY_LAUNCHES,
  UpdateHealth,
  UpdateHistory,
  UpdateNotifier,
  UpdateScheduler,
  WATCHDOG_SECONDS,
  linuxWatchdogScript,
  macSwapScript,
  rollbackSupport,
  type NotifierDeps,
} from '../../../electron/updater/update-flow';

const dir = () => mkdtempSync(join(tmpdir(), 'ws-update-'));

describe('the check schedule (worksuite-desktop#205)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function scheduler() {
    const reasons: string[] = [];
    const s = new UpdateScheduler({
      check: (r) => reasons.push(r),
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      setInterval: (fn, ms) => setInterval(fn, ms),
      clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    });
    return { s, reasons };
  }

  it('checks shortly after launch, then every 4 hours', () => {
    const { s, reasons } = scheduler();
    s.start();
    vi.advanceTimersByTime(CHECK_AFTER_LAUNCH_MS - 1);
    expect(reasons).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(reasons).toEqual(['launch']);
    vi.advanceTimersByTime(CHECK_EVERY_MS);
    expect(reasons).toEqual(['launch', 'interval']);
    vi.advanceTimersByTime(CHECK_EVERY_MS);
    expect(reasons).toEqual(['launch', 'interval', 'interval']);
    expect(CHECK_EVERY_MS).toBe(4 * 3600_000);
    s.stop();
  });

  it('checks once after the computer wakes, however many wake events come', () => {
    const { s, reasons } = scheduler();
    s.wake();
    s.wake();
    vi.advanceTimersByTime(CHECK_AFTER_WAKE_MS);
    expect(reasons).toEqual(['wake']);
  });

  it('stops', () => {
    const { s, reasons } = scheduler();
    s.start();
    s.wake();
    s.stop();
    vi.advanceTimersByTime(CHECK_EVERY_MS * 2);
    expect(reasons).toEqual([]);
  });
});

describe('telling the person an update is ready', () => {
  function notifier(over: Partial<NotifierDeps> = {}) {
    const values = new Map<string, unknown>();
    const store = { get: <T,>(k: string) => values.get(k) as T | undefined, set: (k: string, v: unknown) => void values.set(k, structuredClone(v)) };
    const activity: UpdateActivity = { meeting: false, call: false, screenShare: false, remoteControl: false };
    const desktop = vi.fn();
    const bell = vi.fn();
    let now = new Date(2026, 9, 3, 10, 0);
    const timers: Array<{ fn: () => void; at: number }> = [];
    const deps: NotifierDeps = {
      store,
      now: () => now,
      activity: () => activity,
      notifyEnabled: () => true,
      desktop,
      bell,
      setTimeout: (fn, ms) => {
        const t = { fn, at: now.getTime() + ms };
        timers.push(t);
        return t;
      },
      clear: (h) => {
        const i = timers.indexOf(h as never);
        if (i >= 0) timers.splice(i, 1);
      },
      onChange: vi.fn(),
      ...over,
    };
    const n = new UpdateNotifier(deps);
    const advance = (ms: number) => {
      now = new Date(now.getTime() + ms);
      for (const t of [...timers]) if (t.at <= now.getTime()) t.fn();
    };
    return { n, desktop, bell, activity, store, deps, advance, values };
  }

  it('shows a desktop notification and a bell entry once per version', () => {
    const { n, desktop, bell } = notifier();
    n.onReady({ version: '0.2.127', critical: false, summary: 'Faster mail search.' });
    n.onReady({ version: '0.2.127', critical: false, summary: 'Faster mail search.' });
    expect(desktop).toHaveBeenCalledTimes(1);
    expect(desktop).toHaveBeenCalledWith('WorkSuite 0.2.127 is ready', 'WorkSuite 0.2.127 is ready. Restart to update.', false);
    expect(bell).toHaveBeenCalledTimes(1);
    expect(bell).toHaveBeenCalledWith('update:0.2.127', 'WorkSuite 0.2.127 is ready', 'WorkSuite 0.2.127 is ready. Restart to update. Faster mail search.');
    n.onReady({ version: '0.2.128', critical: false, summary: null });
    expect(desktop).toHaveBeenCalledTimes(2);
    expect(n.pillVisible()).toBe(true);
  });

  it('remembers what it told across restarts', () => {
    const first = notifier();
    first.n.onReady({ version: '0.2.127', critical: false, summary: null });
    const again = notifier({ store: first.deps.store });
    again.n.onReady({ version: '0.2.127', critical: false, summary: null });
    expect(again.desktop).not.toHaveBeenCalled();
    expect(again.bell).not.toHaveBeenCalled();
  });

  it('keeps the bell entry but no desktop notification when that setting is off', () => {
    const { n, desktop, bell } = notifier({ notifyEnabled: () => false });
    n.onReady({ version: '0.2.127', critical: false, summary: null });
    expect(desktop).not.toHaveBeenCalled();
    expect(bell).toHaveBeenCalledTimes(1);
  });

  it.each([['meeting'], ['call'], ['screenShare'], ['remoteControl']] as const)('never interrupts during a %s, and notifies after it ends', (what) => {
    const { n, desktop, bell, activity } = notifier();
    activity[what] = true;
    n.onReady({ version: '0.2.127', critical: false, summary: null });
    expect(desktop).not.toHaveBeenCalled();
    expect(bell).not.toHaveBeenCalled();
    expect(n.pillVisible()).toBe(false);
    expect(n.quietReason()).toBeTruthy();
    activity[what] = false;
    n.activityChanged();
    expect(desktop).toHaveBeenCalledTimes(1);
    expect(bell).toHaveBeenCalledTimes(1);
    expect(n.pillVisible()).toBe(true);
  });

  it('Later in 1 hour hides the pill until then', () => {
    const { n, advance, deps } = notifier();
    n.onReady({ version: '0.2.127', critical: false, summary: null });
    const r = n.later('hour');
    expect(r.until).toEqual(new Date(2026, 9, 3, 11, 0));
    expect(n.pillVisible()).toBe(false);
    expect(n.snoozedUntil()).toBe(new Date(2026, 9, 3, 11, 0).toISOString());
    advance(3600_000);
    expect(n.pillVisible()).toBe(true);
    expect(deps.onChange).toHaveBeenCalled();
  });

  it('Later tonight waits until 8 pm', () => {
    const { n, advance } = notifier();
    n.onReady({ version: '0.2.127', critical: false, summary: null });
    expect(n.later('tonight').until).toEqual(new Date(2026, 9, 3, 20, 0));
    advance(9 * 3600_000);
    expect(n.pillVisible()).toBe(false);
    advance(3600_000);
    expect(n.pillVisible()).toBe(true);
  });

  it('Later on next app launch lasts for this run only', () => {
    const first = notifier();
    first.n.onReady({ version: '0.2.127', critical: false, summary: null });
    expect(first.n.later('next-launch').until).toBeNull();
    expect(first.n.snoozedUntil()).toBe('next-launch');
    first.advance(48 * 3600_000);
    expect(first.n.pillVisible()).toBe(false);
    const next = notifier({ store: first.deps.store });
    next.n.onReady({ version: '0.2.127', critical: false, summary: null });
    expect(next.n.pillVisible()).toBe(true);
  });

  it('a critical update put off more than once installs at the next launch', () => {
    const { n, desktop } = notifier();
    n.onReady({ version: '0.2.127', critical: true, summary: null });
    expect(desktop).toHaveBeenCalledWith('Security update: WorkSuite 0.2.127', 'WorkSuite 0.2.127 is ready. Restart to update.', true);
    expect(n.later('hour').installOnNextLaunch).toBe(false);
    expect(n.installAtLaunch()).toBeNull();
    expect(n.later('hour').installOnNextLaunch).toBe(true);
    expect(n.installAtLaunch()).toBe('0.2.127');
    expect(n.postponed('0.2.127')).toBe(2);
    n.doneWith('0.2.127');
    expect(n.installAtLaunch()).toBeNull();
  });

  it('an ordinary update is never installed at launch however often it is put off', () => {
    const { n } = notifier();
    n.onReady({ version: '0.2.127', critical: false, summary: null });
    n.later('hour');
    n.later('hour');
    n.later('tonight');
    expect(n.installAtLaunch()).toBeNull();
  });
});

describe('the first run after an update', () => {
  it('counts launches of the new version and is healthy once its window loads', () => {
    const h = new UpdateHealth(dir());
    h.beforeInstall('0.2.126', '0.2.127', true, true, 'https://notes/0.2.127');
    expect(h.onLaunch('0.2.127')).toMatchObject({ kind: 'verifying', marker: { attempts: 1, from: '0.2.126', to: '0.2.127' } });
    expect(h.markHealthy('0.2.127')).toBe('0.2.127');
    expect(existsSync(h.healthFile('0.2.127'))).toBe(true);
    expect(h.marker()).toBeNull();
    expect(h.notice()).toMatchObject({ version: '0.2.127', notesUrl: 'https://notes/0.2.127' });
    expect(h.markHealthy('0.2.127')).toBeNull();
    h.dismissNotice();
    expect(h.notice()).toBeNull();
    expect(h.onLaunch('0.2.127')).toEqual({ kind: 'normal' });
  });

  it('rolls back after the new version fails to start more than twice', () => {
    const h = new UpdateHealth(dir());
    h.beforeInstall('0.2.126', '0.2.127', true, true);
    for (let i = 1; i <= MAX_UNHEALTHY_LAUNCHES; i++) expect(h.onLaunch('0.2.127').kind).toBe('verifying');
    expect(h.onLaunch('0.2.127')).toMatchObject({ kind: 'rollback', marker: { from: '0.2.126', to: '0.2.127' } });
  });

  it('reports a rollback the watchdog did, once', () => {
    const d = dir();
    const h = new UpdateHealth(d);
    h.beforeInstall('0.2.126', '0.2.127', true, true);
    writeFileSync(h.rolledBackPath, JSON.stringify({ failed: '0.2.127', reason: 'WorkSuite 0.2.127 did not start within 180 seconds.' }));
    expect(h.onLaunch('0.2.126')).toEqual({ kind: 'rolled-back', failedVersion: '0.2.127', restored: true, reason: 'WorkSuite 0.2.127 did not start within 180 seconds.' });
    expect(h.onLaunch('0.2.126')).toEqual({ kind: 'normal' });
  });

  it('reports an update that never took over', () => {
    const h = new UpdateHealth(dir());
    h.beforeInstall('0.2.126', '0.2.127', false, true);
    expect(h.onLaunch('0.2.126')).toMatchObject({ kind: 'not-installed', failedVersion: '0.2.127' });
    expect(h.marker()).toBeNull();
  });

  it('restores the session once after an update restart', () => {
    const h = new UpdateHealth(dir());
    expect(h.peekSessionRestore()).toBe(false);
    h.requestSessionRestore();
    expect(h.peekSessionRestore()).toBe(true);
    expect(h.takeSessionRestore()).toBe(true);
    expect(h.takeSessionRestore()).toBe(false);
  });

  it('watchdog scripts wait for the health file, then put the previous version back', () => {
    const mac = macSwapScript();
    expect(mac).toContain(`-lt ${WATCHDOG_SECONDS}`);
    expect(mac).toContain('[ -f "$HEALTH" ] && exit 0');
    expect(mac).toContain('mv "$BACKUP" "$TARGET"');
    expect(mac).toContain('> "$ROLLED"');
    expect(mac).toContain('[ "$RELAUNCH" = 1 ] || exit 0');
    const linux = linuxWatchdogScript();
    expect(linux).toContain('mv -f "$IMG.previous" "$IMG"');
    expect(linux).toContain('[ -f "$HEALTH" ] && exit 0');
  });

  it('says what each platform can do', () => {
    expect(rollbackSupport('macos').automatic).toBe(true);
    expect(rollbackSupport('linux').automatic).toBe(true);
    expect(rollbackSupport('windows').automatic).toBe(false);
  });
});

describe('the update history (Diagnostics)', () => {
  it('records events with time, version and channel, and keeps the last 300', () => {
    const d = dir();
    const h = new UpdateHistory(d, () => new Date('2026-10-03T10:00:00Z'));
    h.add('check', { channel: 'beta' });
    h.add('download-done', { version: '0.2.127-beta.1', channel: 'beta', detail: 'sha256 verified' });
    expect(h.entries()).toEqual([
      { t: '2026-10-03T10:00:00.000Z', event: 'check', channel: 'beta' },
      { t: '2026-10-03T10:00:00.000Z', event: 'download-done', version: '0.2.127-beta.1', channel: 'beta', detail: 'sha256 verified' },
    ]);
    for (let i = 0; i < 500; i++) h.add('check');
    expect(h.entries()).toHaveLength(300);
    expect(readFileSync(join(d, 'history.jsonl'), 'utf8').split('\n').filter(Boolean).length).toBeLessThanOrEqual(450);
  });
});

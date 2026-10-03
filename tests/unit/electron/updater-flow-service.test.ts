import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ChildProcessModule from 'node:child_process';

const appMock = vi.hoisted(() => ({ version: '0.2.126', relaunch: vi.fn(), exit: vi.fn(), quit: vi.fn() }));
vi.mock('electron', () => ({
  app: { getPath: () => tmpdir(), getVersion: () => appMock.version, isPackaged: true, relaunch: appMock.relaunch, exit: appMock.exit, quit: appMock.quit },
}));
const spawned = vi.hoisted(() => [] as Array<{ cmd: string; args: string[] }>);
vi.mock('node:child_process', async (orig) => ({
  ...(await orig<typeof ChildProcessModule>()),
  spawn: (cmd: string, args: string[]) => {
    spawned.push({ cmd, args });
    return { unref: () => undefined };
  },
}));

import { ucCanonicalJson } from '../../../electron/updater/update-center';
import { UpdaterService, type UpdaterDeps } from '../../../electron/updater/updater';
import { UpdateHealth, UpdateHistory, UpdateNotifier } from '../../../electron/updater/update-flow';
import type { FetchLike } from '../../../electron/services/http';
import type { BusyReport, UpdateChannel } from '../../../shared/types';

/**
 * The updater with channels, background downloads, Later, the restart and the first-run check
 * (worksuite-desktop#205), on Linux's AppImage path — the one that needs no operating-system signature tools.
 */

const PACKAGE = Buffer.from('#!/bin/sh\necho WorkSuite\n');
const SHA = createHash('sha256').update(PACKAGE).digest('hex');

function signer() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const raw = (publicKey.export({ format: 'jwk' }) as { x: string }).x;
  const signDoc = (doc: Record<string, unknown>): Record<string, unknown> => {
    const body = { ...doc, key_id: 'test-resp' };
    return { ...body, signature: sign(null, Buffer.from(ucCanonicalJson(body)), privateKey).toString('base64url') };
  };
  return { keys: { 'test-resp': raw }, signDoc };
}

function answer(over: Record<string, unknown> = {}) {
  const now = Date.now();
  return {
    status: 'UPDATE_RECOMMENDED',
    app_id: 'lk.worksuite.desktop',
    channel: 'stable',
    current_version: appMock.version,
    latest_version: '0.2.127',
    release_type: 'RECOMMENDED',
    release_notes_url: 'https://download.worksuitecloud.com/apps/desktop/releases/0.2.127',
    highlights: ['Faster mail search', 'Calendar week numbers'],
    package: { id: 'pkg', type: 'appimage', size: PACKAGE.length, sha256: SHA, file_name: 'WorkSuite-0.2.127-x86_64.AppImage', download_url: 'https://cdn.example/WorkSuite.AppImage' },
    issued_at: new Date(now).toISOString(),
    expires_at: new Date(now + 15 * 60_000).toISOString(),
    ...over,
  };
}

function setup(opts: { channel?: UpdateChannel; saved?: UpdateChannel; allowed?: UpdateChannel[]; lockReason?: string | null; autoDownload?: boolean; answer?: Record<string, unknown>; busy?: Partial<BusyReport> } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ws-updater-'));
  const { keys, signDoc } = signer();
  let current = opts.answer ?? answer();
  let channel: UpdateChannel = opts.channel ?? 'stable';
  const urls: string[] = [];
  const fetch = vi.fn(async (url: string) => {
    if (url.startsWith('https://uc.test')) return new Response(JSON.stringify(signDoc(current)), { status: 200 });
    return new Response(new Blob([PACKAGE]).stream(), { status: 200 });
  }) as unknown as FetchLike;
  const values = new Map<string, unknown>();
  const notifier = new UpdateNotifier({
    store: { get: <T,>(k: string) => values.get(k) as T | undefined, set: (k, v) => void values.set(k, structuredClone(v)) },
    now: () => new Date(),
    activity: () => ({ meeting: false, call: false, screenShare: false, remoteControl: false }),
    announce: vi.fn(),
    setTimeout: () => null,
    clear: () => undefined,
    onChange: () => undefined,
  });
  const history = new UpdateHistory(dir);
  const health = new UpdateHealth(dir);
  const states: string[] = [];
  const warnings: string[] = [];
  const prepareRestart = vi.fn(async () => undefined);
  const deps: UpdaterDeps = {
    fetch,
    platform: 'linux',
    arch: 'x64',
    responseKeys: keys,
    updateUrl: (_c, o) => {
      const u = `https://uc.test/api/v1/desktop/update?channel=${channel}${o?.allowDowngrade ? '&allow_downgrade=1' : ''}`;
      urls.push(u);
      return u;
    },
    channel: () => channel,
    channels: () => ({ allowed: opts.allowed ?? ['stable', 'beta', 'dev'], lockReason: opts.lockReason ?? null }),
    busy: () => ({ uploads: 0, downloads: 0, pendingMutations: 0, drafts: 0, activeCall: false, ...opts.busy }),
    deadlineHours: () => 24,
    allowInsecure: false,
    updatesDir: dir,
    onStatus: (s) => states.push(s.state),
    onWarning: (w) => void warnings.push(w),
    savedChannel: () => opts.saved ?? channel,
    beforeQuit: async () => undefined,
    autoDownload: () => opts.autoDownload ?? true,
    installOnQuit: () => true,
    prepareRestart,
    history,
    health,
    notifier,
  };
  const updater = new UpdaterService(deps);
  return {
    updater,
    dir,
    urls,
    states,
    history,
    health,
    notifier,
    prepareRestart,
    warnings,
    fetch,
    setAnswer: (a: Record<string, unknown>) => void (current = a),
    setChannelValue: (c: UpdateChannel) => void (channel = c),
  };
}

let appImage: string;
beforeEach(() => {
  appMock.version = '0.2.126';
  spawned.length = 0;
  appImage = join(mkdtempSync(join(tmpdir(), 'ws-appimage-')), 'WorkSuite.AppImage');
  writeFileSync(appImage, 'old build');
  process.env.APPIMAGE = appImage;
});
afterEach(() => {
  delete process.env.APPIMAGE;
  vi.clearAllMocks();
});

describe('the update state machine', () => {
  it('checks, downloads in the background, verifies and stages: IDLE → CHECKING → AVAILABLE → DOWNLOADING → VERIFIED → STAGED', async () => {
    const t = setup();
    const s = await t.updater.check();
    expect(s).toMatchObject({ state: 'STAGED', availableVersion: '0.2.127', progress: 100, signatureVerified: true });
    expect([...new Set(t.states)]).toEqual(['CHECKING', 'AVAILABLE', 'DOWNLOADING', 'VERIFIED', 'STAGED']);
    expect(s.notes).toEqual({ version: '0.2.127', summary: 'Faster mail search', highlights: ['Faster mail search', 'Calendar week numbers'], url: 'https://download.worksuitecloud.com/apps/desktop/releases/0.2.127' });
    expect(t.notifier.pillVisible()).toBe(true);
  });

  it('leaves the download to the person when automatic downloads are off', async () => {
    const t = setup({ autoDownload: false });
    expect(await t.updater.check()).toMatchObject({ state: 'AVAILABLE', installSupported: true });
    await t.updater.download();
    expect(t.updater.get().state).toBe('STAGED');
  });

  it('downloads a security update even with automatic downloads off, and marks it', async () => {
    const t = setup({ autoDownload: false, answer: answer({ release_type: 'SECURITY' }) });
    expect(await t.updater.check()).toMatchObject({ state: 'STAGED', security: true, critical: true });
  });

  it('fails visibly when the check cannot reach the Update Center', async () => {
    const t = setup();
    (t.fetch as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('offline'));
    expect(await t.updater.check()).toMatchObject({ state: 'FAILED', error: 'Could not check for updates.' });
  });

  it('logs every check, download and install for Diagnostics', async () => {
    const t = setup();
    await t.updater.check();
    const events = t.history.entries().map((e) => e.event);
    expect(events).toEqual(['check', 'check-result', 'download-start', 'download-done', 'staged']);
    await t.updater.install(true);
    expect(t.history.entries().at(-1)).toMatchObject({ event: 'install', version: '0.2.127', detail: 'restart, forced' });
  });
});

describe('channels and versions', () => {
  it('never takes a pre-release on Stable (allowPrerelease off)', async () => {
    const t = setup({ answer: answer({ latest_version: '0.2.127-beta.1' }) });
    expect(await t.updater.check()).toMatchObject({ state: 'IDLE', availableVersion: null });
    expect(t.history.entries().at(-1)?.detail).toBe('refused 0.2.127-beta.1: not a stable version');
  });

  it('takes a beta version on Beta', async () => {
    const t = setup({ channel: 'beta', answer: answer({ channel: 'beta', latest_version: '0.2.127-beta.1' }) });
    expect(await t.updater.check()).toMatchObject({ state: 'STAGED', availableVersion: '0.2.127-beta.1' });
  });

  it('never goes backwards on its own', async () => {
    appMock.version = '0.2.127-beta.1';
    const t = setup({ answer: answer({ current_version: '0.2.127-beta.1', latest_version: '0.2.126', status: 'CURRENT' }) });
    expect(await t.updater.check()).toMatchObject({ state: 'IDLE', availableVersion: null, waitingForChannel: { channel: 'stable', version: '0.2.127-beta.1' } });
  });

  it('downgrades only on an explicit reinstall, which asks with allow_downgrade', async () => {
    appMock.version = '0.2.127-beta.1';
    const t = setup({ answer: answer({ current_version: '0.2.127-beta.1', latest_version: '0.2.126', status: 'UPDATE_AVAILABLE' }) });
    expect((await t.updater.check()).availableVersion).toBeNull();
    const s = await t.updater.reinstall();
    expect(t.urls.at(-1)).toContain('allow_downgrade=1');
    expect(s).toMatchObject({ state: 'STAGED', availableVersion: '0.2.126', downgrade: true });
    // The next ordinary check does not ask for a downgrade again.
    expect(t.urls.filter((u) => u.includes('allow_downgrade')).length).toBe(1);
  });

  it('says so when there is nothing to reinstall', async () => {
    appMock.version = '0.2.127-beta.1';
    const t = setup({ answer: answer({ current_version: '0.2.127-beta.1', latest_version: null, package: null, status: 'CURRENT' }) });
    const s = await t.updater.reinstall();
    expect(s.state).toBe('IDLE');
    expect(s.error).toMatch(/did not offer a stable build to reinstall/);
  });

  it('asks before a less stable channel, and refuses one the organisation does not allow', async () => {
    const t = setup({ allowed: ['stable', 'beta'] });
    const save = vi.fn((c: UpdateChannel) => t.setChannelValue(c));
    await expect(t.updater.setChannel('beta', false, save)).rejects.toMatchObject({ code: 'CONFIRMATION_REQUIRED' });
    expect(save).not.toHaveBeenCalled();
    await expect(t.updater.setChannel('dev', true, save)).rejects.toMatchObject({ code: 'POLICY_DENIED' });
    t.setAnswer(answer({ channel: 'beta', latest_version: '0.2.127-beta.1' }));
    await t.updater.setChannel('beta', true, save);
    expect(save).toHaveBeenCalledWith('beta');
    expect(t.history.entries().find((e) => e.event === 'channel')?.detail).toBe('stable → beta');
  });

  it('falls back to the most stable allowed channel at the next check, says so once, and never downgrades', async () => {
    appMock.version = '0.2.127-beta.1';
    const t = setup({ channel: 'stable', saved: 'beta', allowed: ['stable'], answer: answer({ current_version: '0.2.127-beta.1', latest_version: '0.2.126', status: 'CURRENT' }) });
    expect(t.updater.get().channelFallback).toEqual({ from: 'beta', to: 'stable' });
    const s = await t.updater.check();
    expect(s).toMatchObject({ state: 'IDLE', availableVersion: null, waitingForChannel: { channel: 'stable', version: '0.2.127-beta.1' } });
    expect(t.warnings).toEqual(['Your organisation no longer allows the Beta channel. WorkSuite now follows Stable and moves to it with the next Stable release that is newer — nothing is downgraded.']);
    await t.updater.check();
    expect(t.warnings).toHaveLength(1);
    expect(t.history.entries().filter((e) => e.event === 'channel-fallback')).toHaveLength(1);
  });

  it('refuses any change while the organisation enforces the channel', async () => {
    const t = setup({ allowed: ['stable'], lockReason: 'Your organization chooses the update channel.' });
    await expect(t.updater.setChannel('beta', true, vi.fn())).rejects.toMatchObject({ code: 'POLICY_DENIED', message: 'Your organization chooses the update channel.' });
    expect(t.updater.get()).toMatchObject({ allowedChannels: ['stable'], channelLockReason: 'Your organization chooses the update channel.' });
  });

  it('moves to a more stable channel without asking, forgetting the less stable build it had', async () => {
    const t = setup({ channel: 'beta', answer: answer({ channel: 'beta', latest_version: '0.2.127-beta.1' }) });
    await t.updater.check();
    expect(t.updater.get().state).toBe('STAGED');
    t.setAnswer(answer({ status: 'CURRENT', latest_version: null, package: null }));
    const s = await t.updater.setChannel('stable', false, (c) => t.setChannelValue(c));
    expect(s).toMatchObject({ state: 'IDLE', availableVersion: null, channel: 'stable' });
  });
});

describe('Update & restart', () => {
  it('waits for pending work unless the person insists', async () => {
    const t = setup({ busy: { pendingMutations: 3 } });
    await t.updater.check();
    expect(await t.updater.install(false)).toMatchObject({ started: false, message: 'WorkSuite is busy.', busy: { pendingMutations: 3 } });
    expect(t.prepareRestart).not.toHaveBeenCalled();
  });

  it('treats a meeting, screen share or remote control as busy too', async () => {
    const t = setup({ busy: { activity: { meeting: true, call: false, screenShare: false, remoteControl: false } } });
    await t.updater.check();
    expect((await t.updater.install(false)).started).toBe(false);
  });

  it('saves drafts and tabs, writes the first-run marker and asks for the session back, then relaunches', async () => {
    const t = setup();
    await t.updater.check();
    const r = await t.updater.install(true);
    expect(r.started).toBe(true);
    expect(t.prepareRestart).toHaveBeenCalledTimes(1);
    expect(t.health.marker()).toMatchObject({ from: '0.2.126', to: '0.2.127', attempts: 0, rollbackPossible: true, restoreSession: true, notesUrl: 'https://download.worksuitecloud.com/apps/desktop/releases/0.2.127' });
    expect(t.health.peekSessionRestore()).toBe(true);
    expect(readFileSync(appImage, 'utf8')).toBe(PACKAGE.toString());
    expect(readFileSync(`${appImage}.previous`, 'utf8')).toBe('old build');
    expect(spawned.some((s) => s.args.includes(t.health.healthFile('0.2.127')))).toBe(true);
    expect(appMock.relaunch).toHaveBeenCalledWith({ execPath: appImage, args: ['--updated'] });
  });

  it('installs when quitting, without relaunching or asking for the session back', async () => {
    const t = setup();
    await t.updater.check();
    expect(t.updater.installOnQuitSync()).toBe(true);
    expect(t.updater.installOnQuitSync()).toBe(false);
    expect(t.health.marker()).toMatchObject({ to: '0.2.127', restoreSession: false });
    expect(t.health.peekSessionRestore()).toBe(false);
    expect(appMock.relaunch).not.toHaveBeenCalled();
    expect(t.prepareRestart).not.toHaveBeenCalled();
  });

  it('Later is recorded, and a critical update put off twice installs at the next launch', async () => {
    const t = setup({ answer: answer({ release_type: 'CRITICAL' }) });
    await t.updater.check();
    t.updater.later('hour');
    expect(t.updater.get()).toMatchObject({ postponed: 1, installOnNextLaunch: false });
    t.updater.later('tonight');
    expect(t.updater.get()).toMatchObject({ postponed: 2, installOnNextLaunch: true });
    expect(t.history.entries().filter((e) => e.event === 'later').map((e) => e.detail)).toEqual(['hour', 'tonight (installs at next launch)']);
    // The next launch: the kept download is checked again and installed.
    const next = new UpdaterService({ ...(t.updater as unknown as { deps: UpdaterDeps }).deps });
    await (next as unknown as { installAtLaunch: () => Promise<void> }).installAtLaunch();
    expect(t.health.marker()).toMatchObject({ to: '0.2.127' });
    expect(t.history.entries().some((e) => e.event === 'install-at-launch')).toBe(true);
  });
});

describe('after the restart', () => {
  it('says "Updated to X" once the new version is healthy, and only once', async () => {
    const t = setup();
    await t.updater.check();
    await t.updater.install(true);
    appMock.version = '0.2.127';
    const next = new UpdaterService({ ...(t.updater as unknown as { deps: UpdaterDeps }).deps });
    (next as unknown as { afterLaunch: () => void }).afterLaunch();
    expect(next.get().justUpdated).toBeNull();
    next.healthy();
    expect(next.get().justUpdated).toEqual({ version: '0.2.127', notesUrl: 'https://download.worksuitecloud.com/apps/desktop/releases/0.2.127' });
    expect(existsSync(t.health.healthFile('0.2.127'))).toBe(true);
    next.dismissNotice();
    expect(next.get().justUpdated).toBeNull();
  });

  it('rolls an AppImage back after the new version fails to start repeatedly, and reports it', async () => {
    const t = setup();
    await t.updater.check();
    await t.updater.install(true);
    appMock.version = '0.2.127';
    const deps = (t.updater as unknown as { deps: UpdaterDeps }).deps;
    for (let i = 0; i < 2; i++) (new UpdaterService(deps) as unknown as { afterLaunch: () => void }).afterLaunch();
    appMock.relaunch.mockClear();
    (new UpdaterService(deps) as unknown as { afterLaunch: () => void }).afterLaunch();
    await vi.waitFor(() => expect(appMock.relaunch).toHaveBeenCalledWith({ execPath: appImage }));
    expect(readFileSync(appImage, 'utf8')).toBe('old build');
    // The previous version starts and says what happened.
    appMock.version = '0.2.126';
    const back = new UpdaterService(deps);
    (back as unknown as { afterLaunch: () => void }).afterLaunch();
    expect(back.get().rollback).toMatchObject({ failedVersion: '0.2.127', restored: true });
    expect(t.history.entries().some((e) => e.event === 'rollback')).toBe(true);
  });

  it('restores the tabs after an update restart even when tab restore is off', async () => {
    const t = setup();
    await t.updater.check();
    await t.updater.install(true);
    expect(t.updater.sessionRestorePending()).toBe(true);
    expect(t.updater.takeSessionRestore()).toBe(true);
    expect(t.updater.sessionRestorePending()).toBe(false);
  });
});

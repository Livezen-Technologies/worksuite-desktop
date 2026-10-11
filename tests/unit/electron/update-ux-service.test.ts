import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ChildProcessModule from 'node:child_process';

const appMock = vi.hoisted(() => ({ version: '2.6.1', relaunch: vi.fn(), exit: vi.fn(), quit: vi.fn() }));
vi.mock('electron', () => ({
  app: { getPath: () => tmpdir(), getVersion: () => appMock.version, isPackaged: true, relaunch: appMock.relaunch, exit: appMock.exit, quit: appMock.quit },
}));
vi.mock('node:child_process', async (orig) => ({
  ...(await orig<typeof ChildProcessModule>()),
  spawn: () => ({ unref: () => undefined }),
}));

import { ucCanonicalJson } from '../../../electron/updater/update-center';
import { UpdaterService, type UpdaterDeps } from '../../../electron/updater/updater';
import { UpdateHistory, UpdateNotifier, UpdateScheduler, CHECK_AFTER_LAUNCH_MS, CHECK_EVERY_MS } from '../../../electron/updater/update-flow';
import { runUpdateDiagnostics, spaceNeeded, type UpdateDiagnosticsDeps } from '../../../electron/updater/diagnostics';
import { noticeText, updateNotice } from '../../../electron/updater/notice';
import type { FetchLike } from '../../../electron/services/http';
import type { BusyReport, UpdateStatus } from '../../../shared/types';

/**
 * The updater behind the Updates & License screens: what the signed answer adds (build, date, publisher), the
 * verification pipeline, failures with a code and reference, mandatory deadlines and deferrals, the server refusing
 * this version, Restart when work finishes, a critical release's grace period, Pause and Cancel, and Diagnostics.
 */

const PACKAGE = Buffer.from('#!/bin/sh\necho WorkSuite 2.7.0\n');
const SHA = createHash('sha256').update(PACKAGE).digest('hex');

function signer() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const raw = (publicKey.export({ format: 'jwk' }) as { x: string }).x;
  const signDoc = (doc: Record<string, unknown>): Record<string, unknown> => {
    const body = { ...doc, key_id: 'ws-uc-test' };
    return { ...body, signature: sign(null, Buffer.from(ucCanonicalJson(body)), privateKey).toString('base64url') };
  };
  return { keys: { 'ws-uc-test': raw }, signDoc };
}

function answer(over: Record<string, unknown> = {}) {
  const now = Date.now();
  return {
    status: 'UPDATE_RECOMMENDED',
    app_id: 'lk.worksuite.desktop',
    channel: 'stable',
    current_version: appMock.version,
    latest_version: '2.7.0',
    release_type: 'RECOMMENDED',
    release_notes_url: 'https://download.worksuitecloud.com/apps/desktop/releases/2.7.0',
    highlights: ['Faster Mail loading', 'Improved Desktop File Sync'],
    build_number: 27001,
    published_at: '2026-09-24T08:00:00Z',
    publisher: 'The publisher on the certificate',
    security_fixes: 1,
    known_issues: [],
    package: { id: 'pkg', type: 'appimage', size: PACKAGE.length, sha256: SHA, file_name: 'WorkSuite-2.7.0-x86_64.AppImage', download_url: 'https://cdn.example/WorkSuite.AppImage' },
    issued_at: new Date(now).toISOString(),
    expires_at: new Date(now + 15 * 60_000).toISOString(),
    ...over,
  };
}

let dirs: string[] = [];
const env = process.env.APPIMAGE;

function setup(opts: { answer?: Record<string, unknown>; busy?: () => Partial<BusyReport>; autoDownload?: boolean; deadlineHours?: number; dir?: string; body?: Buffer; deps?: Partial<UpdaterDeps> } = {}) {
  const dir = opts.dir ?? mkdtempSync(join(tmpdir(), 'ws-ux-'));
  dirs.push(dir);
  process.env.APPIMAGE = join(dir, 'WorkSuite.AppImage');
  writeFileSync(process.env.APPIMAGE, '#!/bin/sh\necho WorkSuite 2.6.1\n');
  const { keys, signDoc } = signer();
  const current = opts.answer ?? answer();
  const fetch = vi.fn(async (url: string) => {
    if (url.startsWith('https://uc.test')) return new Response(JSON.stringify(signDoc(current)), { status: 200 });
    return new Response(new Blob([new Uint8Array(opts.body ?? PACKAGE)]).stream(), { status: 200 });
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
  const prepareRestart = vi.fn(async () => undefined);
  const deps: UpdaterDeps = {
    fetch,
    platform: 'linux',
    arch: 'x64',
    responseKeys: keys,
    updateUrl: () => 'https://uc.test/api/v1/desktop/update',
    channel: () => 'stable',
    busy: () => ({ uploads: 0, downloads: 0, pendingMutations: 0, drafts: 0, activeCall: false, ...opts.busy?.() }),
    deadlineHours: () => opts.deadlineHours ?? 24,
    allowInsecure: false,
    updatesDir: dir,
    onStatus: () => undefined,
    onWarning: () => undefined,
    beforeQuit: async () => undefined,
    autoDownload: () => opts.autoDownload ?? true,
    installOnQuit: () => true,
    prepareRestart,
    history,
    notifier,
    ...opts.deps,
  };
  return { updater: new UpdaterService(deps), dir, history, prepareRestart, fetch };
}

beforeEach(() => {
  appMock.version = '2.6.1';
  appMock.quit.mockReset();
  appMock.relaunch.mockReset();
  appMock.exit.mockReset();
});
afterEach(() => {
  if (env === undefined) delete process.env.APPIMAGE;
  else process.env.APPIMAGE = env;
  vi.useRealTimers();
  dirs = [];
});

describe('the signed answer and the pipeline', () => {
  it('carries build, date, type, package and publisher, and every step of the pipeline', async () => {
    const t = setup();
    const s = await t.updater.check();
    expect(s.state).toBe('STAGED');
    expect(s.release).toEqual({
      buildNumber: 27001,
      publishedAt: '2026-09-24T08:00:00Z',
      releaseType: 'RECOMMENDED',
      channel: 'stable',
      packageType: 'appimage',
      packageSize: PACKAGE.length,
      keyId: 'ws-uc-test',
      publisher: 'The publisher on the certificate',
      securityFixes: 1,
      knownIssues: [],
    });
    expect(s.pipeline?.map((p) => [p.id, p.state])).toEqual([
      ['manifest', 'done'],
      ['download', 'done'],
      ['sha256', 'done'],
      // Linux (worksuite-desktop#345): no code signature; the signed answer naming the package's SHA-256 is the check.
      ['codesign', 'done'],
      ['stage', 'done'],
    ]);
    expect(s.pipeline?.find((p) => p.id === 'codesign')?.detail).toBe('Ed25519-signed answer · SHA-256 matched');
    expect(s.pipeline?.[0]?.detail).toBe('Ed25519 signature valid · key ws-uc-test');
    expect(s.download).toBeNull();
  });

  it('a checksum mismatch fails with a code and a reference, kept in the history', async () => {
    const t = setup({ body: Buffer.from('#!/bin/sh\necho tampered!!!!!!!\n') });
    const s = await t.updater.check();
    expect(s).toMatchObject({ state: 'FAILED', error: 'The downloaded update did not match its checksum and was deleted.' });
    expect(s.failure).toMatchObject({ code: 'UPDATE_CHECKSUM_MISMATCH', version: '2.7.0', rollback: 'none' });
    expect(s.failure!.ref).toMatch(/^UA-[0-9A-F]{4}-[0-9A-F]{2}$/);
    expect(s.pipeline?.find((p) => p.id === 'sha256')?.state).toBe('failed');
    expect(t.history.entries().some((e) => e.event === 'failure' && e.detail === `UPDATE_CHECKSUM_MISMATCH ${s.failure!.ref}`)).toBe(true);
  });

  it('pauses and cancels a download it does not have (nothing to do), and Cancel puts the version back on offer', async () => {
    const t = setup({ autoDownload: false });
    expect((await t.updater.check()).state).toBe('AVAILABLE');
    expect((await t.updater.pauseDownload()).state).toBe('AVAILABLE');
    // A paused download (as after Pause): Cancel deletes it and offers the version again.
    (t.updater as unknown as { status: UpdateStatus }).status = { ...t.updater.get(), state: 'DOWNLOADING', download: { received: 5, total: PACKAGE.length, bytesPerSecond: 0, secondsLeft: null, paused: true, retrying: false, resumable: true } };
    expect(await t.updater.cancelDownload()).toMatchObject({ state: 'AVAILABLE', download: null, progress: 0 });
    expect(t.history.entries().some((e) => e.event === 'download-cancelled')).toBe(true);
  });
});

describe('a mandatory update', () => {
  it('below the policy minimum: required, with a deadline from forced_update_deadline_hours that survives a restart', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-26T18:00:00Z'));
    const t = setup({ autoDownload: false, deadlineHours: 24 });
    t.updater.setMinimum('2.7.0');
    const s = t.updater.get();
    expect(s.required).toBe(true);
    expect(s.mandatory).toMatchObject({ reason: 'minimum', requiredVersion: '2.7.0', since: '2026-09-26T18:00:00.000Z', deadline: '2026-09-27T18:00:00.000Z', serverRejected: false, maxDeferrals: 3 });
    // Started again a few hours later: the clock did not restart.
    vi.setSystemTime(new Date('2026-09-27T09:00:00Z'));
    const again = setup({ autoDownload: false, deadlineHours: 24, dir: t.dir });
    again.updater.setMinimum('2.7.0');
    expect(again.updater.get().mandatory?.deadline).toBe('2026-09-27T18:00:00.000Z');
  });

  it('the release says required: its own required_by and max_deferrals', async () => {
    const t = setup({ autoDownload: false, answer: answer({ status: 'UPDATE_REQUIRED', mandatory: true, required_by: '2026-10-05T09:00:00Z', max_deferrals: 2 }) });
    const s = await t.updater.check();
    expect(s.mandatory).toMatchObject({ reason: 'release', deadline: '2026-10-05T09:00:00.000Z', maxDeferrals: 2 });
  });

  it('may be put off only before the deadline, and only as often as allowed', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 8, 27, 15, 46));
    const t = setup({ autoDownload: false, answer: answer({ status: 'UPDATE_REQUIRED', required_by: new Date(2026, 8, 27, 18, 0).toISOString(), max_deferrals: 1 }) });
    await t.updater.check();
    expect(() => t.updater.later('four-hours')).toThrow('That is after the deadline for this update.');
    expect(t.updater.later('hour').postponed).toBe(1);
    expect(() => t.updater.later('hour')).toThrow('This update cannot be put off again.');
  });

  it('the server refusing this version locks modules at once', () => {
    const t = setup();
    t.updater.serverRejected();
    expect(t.updater.get()).toMatchObject({ required: true, mandatory: { reason: 'server', serverRejected: true } });
    expect(() => t.updater.later('hour')).toThrow();
  });
});

describe('Restart when work finishes, and a critical release', () => {
  it('waits while an upload runs, then restarts once it is done', async () => {
    let uploads = 1;
    const t = setup({ busy: () => ({ uploads, pendingMutations: 3 }) });
    await t.updater.check();
    expect(t.updater.installWhenFree().restartWhenFree).toBe(true);
    await t.updater.workChanged();
    expect(t.updater.get().state).toBe('STAGED');
    uploads = 0;
    await t.updater.workChanged();
    expect(t.updater.get()).toMatchObject({ state: 'INSTALLING', restartWhenFree: false });
    t.updater.stop();
  });

  it('a CRITICAL release saves everything and installs after its grace period', async () => {
    const t = setup({ answer: answer({ release_type: 'CRITICAL', grace_minutes: 5 }), busy: () => ({ drafts: 1, pendingMutations: 14 }) });
    const before = Date.now();
    await t.updater.check();
    await vi.waitFor(() => expect(t.updater.get().immediate?.saved).toBeTruthy());
    const im = t.updater.get().immediate!;
    expect(im).toMatchObject({ version: '2.7.0', graceMinutes: 5, saved: { flushed: true, drafts: 1, pendingMutations: 14 } });
    expect(Date.parse(im.graceEndsAt) - before).toBeGreaterThanOrEqual(5 * 60_000 - 1000);
    expect(t.prepareRestart).toHaveBeenCalled();
    t.updater.stop();
  });
});

describe('the check schedule', () => {
  it('knows when the next check runs', () => {
    let now = 1_000_000;
    const s = new UpdateScheduler({ check: () => undefined, setTimeout: () => null, setInterval: () => null, clear: () => undefined, now: () => now });
    expect(s.nextAt()).toBeNull();
    s.start();
    expect(s.nextAt()?.getTime()).toBe(1_000_000 + CHECK_AFTER_LAUNCH_MS);
    now += CHECK_EVERY_MS + 5;
    expect(s.nextAt()?.getTime()).toBe(1_000_000 + 2 * CHECK_EVERY_MS);
  });
});

describe('notices', () => {
  const base = (over: Partial<UpdateStatus>): UpdateStatus => ({
    state: 'AVAILABLE',
    channel: 'stable',
    currentVersion: '2.6.1',
    availableVersion: '2.7.0',
    minimumVersion: null,
    required: false,
    critical: false,
    progress: 0,
    error: null,
    lastCheckedAt: null,
    deadline: null,
    signatureVerified: true,
    notesUrl: null,
    installSupported: true,
    installBlockedReason: null,
    ...over,
  });

  it("says what's new under the body, with Update Now", () => {
    const n = updateNotice(base({ notes: { version: '2.7.0', summary: null, highlights: ['Improved Mail performance', 'File Sync fixes', 'Meet improvements', 'More'], url: null } }), false)!;
    expect(n).toMatchObject({ key: 'available:2.7.0', action: 'update' });
    expect(noticeText(n)).toBe("WorkSuite 2.7.0 is available. Click to download it.\nWhat's new:\n• Improved Mail performance\n• File Sync fixes\n• Meet improvements");
  });

  it('says once that a required update has a deadline', () => {
    const n = updateNotice(base({ required: true, mandatory: { reason: 'release', requiredVersion: null, since: '2026-10-04T09:00:00Z', deadline: '2026-10-05T09:00:00Z', serverRejected: false, maxDeferrals: 3 } }), true)!;
    expect(n).toMatchObject({ key: 'required:2.7.0', title: 'Update required', critical: true });
    expect(n.body).toMatch(/^WorkSuite 2\.7\.0 must be installed by /);
  });
});

describe('Update diagnostics', () => {
  const deps = (over: Partial<UpdateDiagnosticsDeps> = {}): UpdateDiagnosticsDeps => ({
    now: () => new Date('2026-09-27T09:41:00Z'),
    host: 'download.worksuitecloud.com',
    probe: async () => ({ reached: true, ms: 84, status: 200, verified: true, keyId: 'ws-uc-resp-1', reason: null, pkg: { size: 320 * 1024 ** 2 }, download: { ok: true, status: 206 } }),
    version: '2.6.1',
    platform: 'windows',
    arch: 'x64',
    installType: 'NSIS per-user',
    required: null,
    channel: { label: 'Stable', source: 'Set by organization policy', fallback: false },
    freeBytes: async () => 1.5 * 1024 ** 3,
    installWritable: async () => ({ ok: true, detail: 'Per-user install · no elevation needed' }),
    database: () => ({ result: 'ok', schema: 43 }),
    license: () => ({ signedIn: true, offline: false, lastVerifiedAt: '2026-09-27T08:00:00Z' }),
    ...over,
  });

  it('runs the nine checks: reachable, version, channel, signature, download, disk, permissions, database, license', async () => {
    const r = await runUpdateDiagnostics(deps());
    expect(r.checks.map((c) => [c.id, c.status])).toEqual([
      ['service', 'pass'],
      ['version', 'pass'],
      ['channel', 'pass'],
      ['signature', 'pass'],
      ['download', 'pass'],
      ['disk', 'low'],
      ['permissions', 'pass'],
      ['database', 'pass'],
      ['license', 'pass'],
    ]);
    expect(r.checks[0]!.detail).toBe('download.worksuitecloud.com · 84 ms');
    expect(r.checks[3]!.detail).toBe('Ed25519 · key ws-uc-resp-1');
    expect(r.checks[5]!.detail).toBe('1.5 GB free — 640 MB needed');
  });

  it('fails what is wrong, and skips what does not apply', async () => {
    const r = await runUpdateDiagnostics(
      deps({
        probe: async () => ({ reached: false, ms: 0, status: null, verified: null, keyId: null, reason: 'unreachable', pkg: null, download: null }),
        platform: 'macos',
        freeBytes: async () => 200 * 1024 ** 2,
        installWritable: async () => null,
        database: () => ({ result: 'database disk image is malformed', schema: null }),
        license: () => ({ signedIn: true, offline: true, lastVerifiedAt: '2026-09-24T09:00:00Z' }),
      }),
    );
    const by = Object.fromEntries(r.checks.map((c) => [c.id, c]));
    expect(by.service).toMatchObject({ status: 'fail', detail: 'download.worksuitecloud.com · not reachable' });
    expect(by.signature!.status).toBe('skip');
    expect(by.download).toMatchObject({ status: 'skip', detail: 'No update on offer' });
    expect(by.disk).toMatchObject({ status: 'low', detail: '200 MB free' });
    expect(by.permissions!.status).toBe('skip');
    expect(by.database).toMatchObject({ status: 'fail', detail: 'database disk image is malformed' });
    expect(by.license).toMatchObject({ status: 'low', detail: 'Offline · last verified 3 days ago' });
  });

  it('counts the rollback copy in the space needed where one is kept', () => {
    expect(spaceNeeded('macos', 100)).toEqual({ bytes: 300, withRollback: true });
    expect(spaceNeeded('linux', 100)).toEqual({ bytes: 200, withRollback: true });
    expect(spaceNeeded('windows', 100)).toEqual({ bytes: 200, withRollback: false });
  });

  it('probes the Update Center without changing where updates stand', async () => {
    const t = setup({ autoDownload: false });
    const p = await t.updater.probe();
    expect(p).toMatchObject({ reached: true, status: 200, verified: true, keyId: 'ws-uc-test', pkg: { size: PACKAGE.length }, download: { ok: true, status: 200 } });
    expect(t.updater.get().state).toBe('IDLE');
  });
});

describe('a .deb or .rpm install updates itself (worksuite-desktop#345)', () => {
  const debAnswer = () => answer({ package: { id: 'pkg', type: 'deb', size: PACKAGE.length, sha256: SHA, file_name: 'WorkSuite-2.7.0-amd64.deb', download_url: 'https://cdn.example/WorkSuite-2.7.0-amd64.deb' } });
  const asDeb = (over: Partial<UpdaterDeps> = {}) => {
    const t = setup({ answer: debAnswer(), deps: { linuxKind: () => 'deb', ...over } });
    delete process.env.APPIMAGE;
    return t;
  };

  it('is offered the .deb, not refused as "update it with your package manager", and installs it behind one prompt', async () => {
    const installPackage = vi.fn(async () => ({ ok: true as const }));
    const t = asDeb({ installPackage });
    const s = await t.updater.check();
    expect(s.installBlockedReason).toBeNull();
    expect(s.installKind).toBe('deb');
    await vi.waitFor(() => expect(t.updater.get().state).toBe('STAGED'));
    const r = await t.updater.install(true);
    expect(r.started).toBe(true);
    expect(installPackage).toHaveBeenCalledWith('deb', expect.stringMatching(/WorkSuite-2\.7\.0-amd64\.deb$|2\.7\.0/));
    expect(appMock.relaunch).toHaveBeenCalledWith({ args: ['--updated'] });
    expect(appMock.exit).toHaveBeenCalledWith(0);
  });

  it('closing the password prompt opens the package in the software installer and keeps WorkSuite running', async () => {
    const openPath = vi.fn(async () => '');
    const t = asDeb({ installPackage: vi.fn(async () => ({ ok: false as const, reason: 'cancelled' as const, detail: 'closed' })), openPath });
    await t.updater.check();
    await vi.waitFor(() => expect(t.updater.get().state).toBe('STAGED'));
    const r = await t.updater.install(true);
    expect(r.started).toBe(false);
    expect(r.message).toMatch(/password prompt was closed.*software installer/);
    expect(openPath).toHaveBeenCalled();
    expect(appMock.exit).not.toHaveBeenCalled();
    expect(t.updater.get().state).toBe('STAGED');
  });

  it('a copy installed some other way says how to get the update instead of naming a package manager', async () => {
    const t = setup({ answer: debAnswer(), deps: { linuxKind: () => null } });
    delete process.env.APPIMAGE;
    const s = await t.updater.check();
    expect(s.installKind).toBeNull();
    expect(s.installBlockedReason).toMatch(/not installed from a WorkSuite AppImage, \.deb or \.rpm/);
  });

  it('never installs on quit, where nobody could answer the password prompt', async () => {
    const t = asDeb({ installPackage: vi.fn(async () => ({ ok: true as const })) });
    await t.updater.check();
    await vi.waitFor(() => expect(t.updater.get().state).toBe('STAGED'));
    expect(t.updater.installOnQuitSync()).toBe(false);
  });
});

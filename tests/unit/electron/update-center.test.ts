import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from 'electron';
import type { UpdateStatus } from '../../../shared/types';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('electron', () => ({
  app: { getPath: () => tmpdir(), getVersion: () => '0.2.123', isPackaged: false },
}));

import {
  acceptUpdateResponse,
  deviceRef,
  isTestChannel,
  ucCanonicalJson,
  ucInstallType,
  updateCheckUrl,
  UPDATE_CENTER_RESPONSE_KEYS,
  verifyUcDocument,
} from '../../../electron/updater/update-center';
import { UpdaterService, type UpdaterDeps } from '../../../electron/updater/updater';
import { updateNotice } from '../../../electron/updater/notice';
import type { FetchLike } from '../../../electron/services/http';

/** A real answer from download.worksuitecloud.com, signed with ws-uc-resp-1. */
const live = JSON.parse(readFileSync(join(__dirname, '../../fixtures/update-center-response.json'), 'utf8')) as Record<string, unknown>;
const liveNow = Date.parse(String(live.issued_at));

function signer() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const raw = (publicKey.export({ format: 'jwk' }) as { x: string }).x;
  const keys = { 'test-resp': raw };
  const signDoc = (doc: Record<string, unknown>): Record<string, unknown> => {
    const body = { ...doc, key_id: 'test-resp' };
    return { ...body, signature: sign(null, Buffer.from(ucCanonicalJson(body)), privateKey).toString('base64url') };
  };
  return { keys, signDoc };
}

const now = new Date();
const base = {
  status: 'UPDATE_RECOMMENDED',
  app_id: 'lk.worksuite.desktop',
  channel: 'beta',
  current_version: '0.2.123',
  latest_version: '0.2.124',
  build: 124,
  release_id: 'rel_x',
  release_type: 'RECOMMENDED',
  mandatory: false,
  mandatory_after: null,
  grace_minutes: null,
  minimum_supported_version: null,
  effective_minimum: null,
  rollout: { stage: null, percentage: 100, in_cohort: true },
  supersedes: [],
  release_notes_url: 'https://download.worksuitecloud.com/apps/desktop/releases/0.2.124',
  highlights: ['Updates come from the Update Center'],
  package: {
    id: 'pkg_1',
    revision_id: 'rev_1',
    type: 'dmg',
    size: 1234,
    sha256: 'a'.repeat(64),
    min_os: null,
    signer: 'Livezen Technologies',
    file_name: 'WorkSuite-0.2.124-universal.dmg',
    download_url: 'https://cdn.example/WorkSuite-0.2.124-universal.dmg?sig=x',
    download_grant: 'grant_x.y',
    expires_at: now.toISOString(),
  },
  release_manifest_url: '/api/v1/releases/rel_x/manifest',
  message: null,
  tenant_policy: 'absent',
  issued_at: now.toISOString(),
  expires_at: new Date(now.getTime() + 15 * 60_000).toISOString(),
};

describe('Update Center responses', () => {
  it('verifies a live answer with the pinned response key', () => {
    expect(verifyUcDocument(live, UPDATE_CENTER_RESPONSE_KEYS)).toBe(true);
    expect(acceptUpdateResponse(live, UPDATE_CENTER_RESPONSE_KEYS, '0.2.123', liveNow)).toMatchObject({ ok: true });
  });

  it('refuses any change after signing, an unknown key id, and no signature', () => {
    expect(verifyUcDocument({ ...live, status: 'UPDATE_REQUIRED' }, UPDATE_CENTER_RESPONSE_KEYS)).toBe(false);
    expect(verifyUcDocument({ ...live, key_id: 'ws-uc-resp-9' }, UPDATE_CENTER_RESPONSE_KEYS)).toBe(false);
    const { signature: _sig, ...unsigned } = live;
    expect(verifyUcDocument(unsigned, UPDATE_CENTER_RESPONSE_KEYS)).toBe(false);
  });

  it('signs over PHP canonical JSON, which escapes U+2028 and U+2029', () => {
    expect(ucCanonicalJson({ b: 'x\u2028y', a: '/é' })).toBe('{"a":"/é","b":"x\\u2028y"}');
    const { keys, signDoc } = signer();
    expect(verifyUcDocument(signDoc({ ...base, message: 'line\u2029break' }), keys)).toBe(true);
  });

  it('refuses an answer for another version or app, or one long expired', () => {
    const { keys, signDoc } = signer();
    expect(acceptUpdateResponse(signDoc(base), keys, '0.2.123')).toMatchObject({ ok: true });
    expect(acceptUpdateResponse(signDoc(base), keys, '0.2.100')).toEqual({ ok: false, reason: 'mismatch' });
    expect(acceptUpdateResponse(signDoc({ ...base, app_id: 'lk.worksuite.other' }), keys, '0.2.123')).toEqual({ ok: false, reason: 'mismatch' });
    expect(acceptUpdateResponse(signDoc(base), keys, '0.2.123', now.getTime() + 2 * 86400_000)).toEqual({ ok: false, reason: 'expired' });
    expect(acceptUpdateResponse(live, keys, '0.2.123', liveNow)).toEqual({ ok: false, reason: 'signature' });
  });
});

describe('the update check', () => {
  it('asks for this app, version, computer and package type, without the install id', () => {
    const url = new URL(
      updateCheckUrl({ base: 'https://download.worksuitecloud.com', version: '0.2.123', platform: 'macos', arch: 'arm64', installType: 'dmg', channel: 'beta', installId: 'install-42', osVersion: '15.4' }),
    );
    expect(url.pathname).toBe('/api/v1/desktop/update');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      app_id: 'lk.worksuite.desktop',
      current_version: '0.2.123',
      platform: 'macos',
      architecture: 'arm64',
      install_type: 'dmg',
      channel: 'BETA',
      device_id: deviceRef('install-42'),
      os_version: '15.4',
    });
    expect(url.toString()).not.toContain('install-42');
    expect(deviceRef('install-42')).toMatch(/^hmac:[a-f0-9]{32}$/);
  });

  it('leaves the organisation channel to the tenant policy', () => {
    const url = new URL(updateCheckUrl({ base: 'https://uc.test', version: '1.0.0', platform: 'windows', arch: 'x64', installType: 'exe', channel: 'org', installId: 'unknown', osVersion: null }));
    expect(url.searchParams.has('channel')).toBe(false);
    expect(url.searchParams.has('device_id')).toBe(false);
  });

  it('lets unsigned builds update themselves from test channels only', () => {
    expect(['beta', 'BETA', 'dev', 'internal'].map(isTestChannel)).toEqual([true, true, true, true]);
    expect(['stable', 'STABLE', 'custom', ''].map(isTestChannel)).toEqual([false, false, false, false]);
  });

  it('installs the exe on Windows, the dmg on a Mac, and only an AppImage on Linux', () => {
    expect(ucInstallType('windows', false)).toBe('exe');
    expect(ucInstallType('macos', false)).toBe('dmg');
    expect(ucInstallType('linux', true)).toBe('appimage');
    expect(ucInstallType('linux', false)).toBeNull();
  });
});

describe('UpdaterService against the Update Center', () => {
  function service(answer: Record<string, unknown>, keys: Record<string, string>) {
    const statuses: string[] = [];
    const fetch = vi.fn(async () => new Response(JSON.stringify(answer), { status: 200 })) as unknown as FetchLike;
    const deps: UpdaterDeps = {
      fetch,
      platform: 'macos',
      arch: 'arm64',
      responseKeys: keys,
      updateUrl: () => 'https://download.worksuitecloud.com/api/v1/desktop/update?app_id=lk.worksuite.desktop',
      channel: () => 'beta',
      autoDownload: () => true,
      busy: () => ({ uploads: 0, downloads: 0, pendingMutations: 0, drafts: 0, activeCall: false }),
      deadlineHours: () => 24,
      allowInsecure: false,
      updatesDir: tmpdir(),
      onStatus: (s) => statuses.push(s.state),
      onWarning: () => undefined,
      beforeQuit: async () => undefined,
    };
    return { updater: new UpdaterService(deps), fetch, statuses };
  }

  it('offers a newer signed release, and a development build does not download it', async () => {
    const { keys, signDoc } = signer();
    const { updater, fetch } = service(signDoc(base), keys);
    const s = await updater.check();
    expect(s).toMatchObject({ state: 'AVAILABLE', availableVersion: '0.2.124', signatureVerified: true, installSupported: false, notesUrl: base.release_notes_url });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('stays idle when current', async () => {
    const { keys, signDoc } = signer();
    const { updater } = service(signDoc({ ...base, status: 'CURRENT', latest_version: null, package: null }), keys);
    expect(await updater.check()).toMatchObject({ state: 'IDLE', availableVersion: null, error: null, signatureVerified: true });
  });

  it('marks a required update, and takes the effective minimum', async () => {
    const { keys, signDoc } = signer();
    const { updater } = service(signDoc({ ...base, status: 'UPDATE_REQUIRED', release_type: 'CRITICAL', effective_minimum: '0.2.124' }), keys);
    expect(await updater.check()).toMatchObject({ state: 'AVAILABLE', required: true, critical: true, minimumVersion: '0.2.124' });
  });

  it('ignores an answer that does not verify', async () => {
    const { signDoc } = signer();
    const { updater } = service(signDoc(base), UPDATE_CENTER_RESPONSE_KEYS);
    expect(await updater.check()).toMatchObject({ state: 'FAILED', availableVersion: null, signatureVerified: false });
  });
});

describe('Downloading by itself, or on the person\'s Download (Settings › Desktop › Updates)', () => {
  // A packaged AppImage: the one build these tests can install into, with the signed answer and its SHA-256 as the trust.
  const bytes = Buffer.from('#!/bin/sh\necho WorkSuite 0.2.124\n');
  const appImage = {
    ...base.package,
    type: 'appimage',
    size: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    file_name: 'WorkSuite-0.2.124-x86_64.AppImage',
    download_url: 'https://cdn.example/WorkSuite-0.2.124-x86_64.AppImage?sig=x',
  };
  let dir = '';
  const env = process.env.APPIMAGE;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ws-updates-'));
    (app as { isPackaged: boolean }).isPackaged = true;
    process.env.APPIMAGE = join(dir, 'WorkSuite.AppImage');
  });
  afterEach(() => {
    (app as { isPackaged: boolean }).isPackaged = false;
    if (env === undefined) delete process.env.APPIMAGE;
    else process.env.APPIMAGE = env;
    rmSync(dir, { recursive: true, force: true });
  });

  function service(answer: Record<string, unknown>, keys: Record<string, string>, auto: boolean) {
    const fetch = vi.fn(async (url: string) =>
      url.includes('/api/v1/desktop/update') ? new Response(JSON.stringify(answer), { status: 200 }) : new Response(bytes, { status: 200 }),
    ) as unknown as FetchLike;
    const updater = new UpdaterService({
      fetch,
      platform: 'linux',
      arch: 'x64',
      responseKeys: keys,
      updateUrl: () => 'https://download.worksuitecloud.com/api/v1/desktop/update?app_id=lk.worksuite.desktop',
      channel: () => 'beta',
      autoDownload: () => auto,
      busy: () => ({ uploads: 0, downloads: 0, pendingMutations: 0, drafts: 0, activeCall: false }),
      deadlineHours: () => 24,
      allowInsecure: false,
      updatesDir: dir,
      onStatus: () => undefined,
      onWarning: () => undefined,
      beforeQuit: async () => undefined,
    });
    const downloads = () => (fetch as unknown as { mock: { calls: string[][] } }).mock.calls.filter(([u]) => u!.startsWith('https://cdn.example/')).length;
    return { updater, downloads };
  }

  it('downloads and stages a new version by itself when that is on', async () => {
    const { keys, signDoc } = signer();
    const { updater, downloads } = service(signDoc({ ...base, package: appImage }), keys, true);
    expect(await updater.check()).toMatchObject({ state: 'STAGED', availableVersion: '0.2.124', installSupported: true, progress: 100 });
    expect(downloads()).toBe(1);
  });

  it('turned off, offers the version and waits; Download fetches and stages it', async () => {
    const { keys, signDoc } = signer();
    const { updater, downloads } = service(signDoc({ ...base, package: appImage }), keys, false);
    expect(await updater.check()).toMatchObject({ state: 'AVAILABLE', availableVersion: '0.2.124', installSupported: true, installBlockedReason: null });
    expect(downloads()).toBe(0);
    expect(await updater.downloadNow()).toMatchObject({ state: 'STAGED', availableVersion: '0.2.124' });
    expect(downloads()).toBe(1);
  });

  it('turned off, still downloads a critical update', async () => {
    const { keys, signDoc } = signer();
    const { updater, downloads } = service(signDoc({ ...base, release_type: 'CRITICAL', package: appImage }), keys, false);
    expect(await updater.check()).toMatchObject({ state: 'STAGED', critical: true });
    expect(downloads()).toBe(1);
  });

  it('Download with nothing newer on offer asks the Update Center and leaves it at that', async () => {
    const { keys, signDoc } = signer();
    const { updater, downloads } = service(signDoc({ ...base, status: 'CURRENT', latest_version: null, package: null }), keys, false);
    expect(await updater.downloadNow()).toMatchObject({ state: 'IDLE', availableVersion: null });
    expect(downloads()).toBe(0);
  });
});

describe('What a new version tells the person outside the window', () => {
  const status = (patch: Partial<UpdateStatus>): UpdateStatus => ({
    state: 'IDLE',
    channel: 'stable',
    currentVersion: '0.2.131',
    availableVersion: '0.2.132',
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
    ...patch,
  });

  it('says a downloaded version is ready, once per version', () => {
    expect(updateNotice(status({ state: 'STAGED' }), true)).toEqual({ key: 'ready:0.2.132', title: 'Update ready', body: 'WorkSuite 0.2.132 is ready. Restart WorkSuite to finish updating.' });
    expect(updateNotice(status({ state: 'STAGED', required: true }), true)?.title).toBe('Update required');
  });

  it('says nothing while a version downloads by itself', () => {
    expect(updateNotice(status({ state: 'AVAILABLE' }), true)).toBeNull();
    expect(updateNotice(status({ state: 'DOWNLOADING' }), false)).toBeNull();
    expect(updateNotice(status({ state: 'AVAILABLE', critical: true }), false)).toBeNull();
  });

  it('offers a version that waits for the person, or that this build cannot install', () => {
    expect(updateNotice(status({ state: 'AVAILABLE' }), false)).toEqual({ key: 'available:0.2.132', title: 'Update available', body: 'WorkSuite 0.2.132 is available. Click to download it.' });
    expect(updateNotice(status({ state: 'AVAILABLE', installSupported: false, installBlockedReason: 'WorkSuite was installed from a package; update it with your package manager.' }), true)?.body).toBe(
      'WorkSuite 0.2.132 is available. WorkSuite was installed from a package; update it with your package manager.',
    );
  });

  it('has nothing to say without a newer version', () => {
    expect(updateNotice(status({ availableVersion: null, state: 'IDLE' }), false)).toBeNull();
  });
});

import { describe, expect, it, vi } from 'vitest';
import { generateKeyPairSync, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
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

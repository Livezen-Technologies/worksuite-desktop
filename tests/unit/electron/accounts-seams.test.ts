import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const electron = vi.hoisted(() => ({ fromPartition: vi.fn(), writeText: vi.fn(), openExternal: vi.fn(async () => undefined) }));
vi.mock('electron', () => ({
  app: { getVersion: () => '0.2.252', isPackaged: false, isDefaultProtocolClient: () => false, getPath: () => '/tmp' },
  BrowserWindow: { getAllWindows: () => [], getFocusedWindow: () => null },
  clipboard: { writeText: electron.writeText },
  session: { fromPartition: electron.fromPartition },
  shell: { openExternal: electron.openExternal },
}));

const { errorFromResponse } = await import('../../../electron/services/http');
const { BootstrapService, licenseDetailsOf } = await import('../../../electron/services/bootstrap');
const { Database } = await import('../../../electron/services/db');
const { Vault } = await import('../../../electron/services/vault');
const { parseEd25519Key, livezenKeyring } = await import('../../../electron/services/discovery/keys');
const { licenceFromClaims } = await import('../../../electron/services/cloud/entitlements');
const { stageFor } = await import('../../../electron/services/cloud/provisioning');
const { installAccounts, cloudOrigin } = await import('../../../electron/main/accounts-wiring');
import type { HttpClient } from '../../../electron/services/http';
import type { IpcRouter } from '../../../electron/ipc/router';
import type { AppContext } from '../../../electron/main/context';

/**
 * Connection & Startup's seams (WP0): the gateway codes Cloud answers, the bootstrap's licence hook (Cloud's signed
 * entitlements before the server's own licence), the key formats discovery accepts, and the one call index.ts makes.
 */
describe('Cloud gateway codes', () => {
  it.each(['QUOTA_EXCEEDED', 'ORG_SUSPENDED', 'ORG_NOT_FOUND'] as const)('%s keeps its code', (code) => {
    const e = errorFromResponse(code === 'QUOTA_EXCEEDED' ? 507 : 403, { status: 'error', code, message: 'Nope.' } as never, null);
    expect(e.code).toBe(code);
    expect(e.message).toBe('Nope.');
  });

  it('still maps an unknown code by status', () => {
    expect(errorFromResponse(403, { status: 'error', code: 'SOMETHING_ELSE', message: 'x' } as never, null).code).toBe('PERMISSION_DENIED');
  });
});

describe('BootstrapService licence source', () => {
  const user = { id: 7, name: 'Nuwan', email: 'n@ws.example' };
  const routes: Record<string, unknown> = {
    '/api/auth/me': { user, permissions: ['*'], apps: '*' },
    '/api/system/entitlements': { license: { status: 'GRACE', edition: 'Enterprise', license_key_masked: 'WS-****-1234', grace_days: 7 }, apps: [{ app: 'payroll', entitled: false, locked: true }] },
  };
  const http = { get: async (path: string) => { if (path in routes) return routes[path]; throw new Error(`no ${path}`); } } as unknown as HttpClient;
  const service = () => new BootstrapService(new Database(':memory:'), () => new Vault(Vault.generateKey()), http, null);

  it('uses the server licence when no source is set (as before)', async () => {
    const b = await service().fetch('core');
    expect(b.lockedApps).toEqual(['payroll']);
    expect(b.license).toMatchObject({ status: 'GRACE', edition: 'Enterprise', keyMasked: 'WS-****-1234', graceDays: 7, expiresAt: null });
  });

  it('takes the source first: Cloud entitlements replace the server licence', async () => {
    const s = service();
    s.setLicenceSource(async () => ({ entitlements: { crm: false, mail: true }, locked: ['crm'] }));
    const b = await s.fetch('core');
    expect(b.license).toBeNull();
    expect(b.lockedApps).toEqual(['crm']);
    expect(b.entitlements).toMatchObject({ crm: false, mail: true });
  });

  it('falls back to the server licence when the source has nothing or fails, and can be taken away', async () => {
    const s = service();
    s.setLicenceSource(async () => null);
    expect((await s.fetch('core')).lockedApps).toEqual(['payroll']);
    s.setLicenceSource(async () => { throw new Error('offline'); });
    expect((await s.fetch('core')).lockedApps).toEqual(['payroll']);
    s.setLicenceSource(async () => ({ entitlements: {}, locked: ['crm'] }));
    s.setLicenceSource(null);
    expect((await s.fetch('core')).lockedApps).toEqual(['payroll']);
  });

  it('ignores malformed display values and never forwards raw activation credentials', () => {
    expect(licenseDetailsOf(null)).toBeNull();
    expect(licenseDetailsOf([])).toBeNull();
    const details = licenseDetailsOf({ status: 42, edition: {}, grace_days: -1, max_activations: 0, license_key: 'secret' });
    expect(details).toMatchObject({ status: null, edition: null, graceDays: null, maxActivations: 0 });
    expect(details).not.toHaveProperty('license_key');
  });

  it('turns verified claims into a licence', () => {
    const claims = JSON.parse(readFileSync(join(__dirname, '../../fixtures/cloud/entitlements-claims.json'), 'utf8'));
    const lic = licenceFromClaims(claims);
    expect(lic.locked.sort()).toEqual(['crm', 'payroll']);
    expect(lic.entitlements.mail).toBe(true);
  });
});

describe('discovery keys', () => {
  const keys = JSON.parse(readFileSync(join(__dirname, '../../fixtures/discovery/keys.json'), 'utf8')) as { discovery_key: string; raw: string };

  it('reads Core’s ed25519:<SPKI> and the raw base64url form as the same key', () => {
    const a = parseEd25519Key(keys.discovery_key);
    const b = parseEd25519Key(keys.raw);
    expect(a?.asymmetricKeyType).toBe('ed25519');
    expect(a?.export({ type: 'spki', format: 'der' }).equals(b!.export({ type: 'spki', format: 'der' }))).toBe(true);
  });

  it('refuses anything else without throwing', () => {
    for (const bad of ['', 'ed25519:', 'ed25519:AAAA', 'rsa:abc', 'x'.repeat(42), keys.raw.slice(1), keys.raw + 'AA']) expect(parseEd25519Key(bad)).toBeNull();
  });

  it('never lets a rotated key replace a pinned one', () => {
    expect(livezenKeyring('discovery', { k1: 'abc' })).toEqual({ k1: 'abc' });
  });
});

describe('Cloud account stages', () => {
  it.each([
    ['EMAIL_VERIFICATION_PENDING', 'verify-email'],
    ['VERIFIED', 'provisioning'],
    ['PROVISIONING_FAILED', 'provisioning'],
    ['ACTIVE', 'ready'],
    ['SUSPENDED', 'ready'],
  ] as const)('%s → %s', (state, stage) => {
    expect(stageFor({ account_state: state })).toBe(stage);
  });
});

describe('installAccounts', () => {
  it('registers the browser sign-in and Cloud channels (WP3); the others still answer UNSUPPORTED', () => {
    const handle = vi.fn();
    const setLicenceSource = vi.fn();
    const w = installAccounts({ router: { handle } as unknown as IpcRouter, ctx: { http: {}, bootstrap: { setLicenceSource } } as unknown as AppContext });
    const names = handle.mock.calls.map(([ch]) => String(ch));
    expect(names.filter((ch) => ch.startsWith('connect:') || ch === 'accounts:rediscover').sort()).toEqual(['accounts:rediscover', 'connect:cancel', 'connect:confirm', 'connect:copyDetails', 'connect:get', 'connect:parseSetup', 'connect:start']);
    const cloudChannels = handle.mock.calls.map(([ch]) => String(ch)).filter((ch) => ch.startsWith('signin:') || ch.startsWith('cloud:'));
    expect(cloudChannels.sort()).toEqual(['cloud:openWeb', 'cloud:plans', 'cloud:refresh', 'cloud:resendVerification', 'cloud:retryProvisioning', 'cloud:status', 'cloud:storage', 'signin:cancel', 'signin:copyLink', 'signin:reopen', 'signin:start']);
    expect(w.handleAuthCallback('worksuite://auth/callback?code=1&state=2')).toBe(false);
    expect(w.discovery.pinsFor('ws.example')).toBeNull();
    expect(w.cloud.status()).toBeNull();
    w.dispose();
  });

  it('with the accounts runtime (WP1), registers every accounts:* channel but rediscover (discovery’s) and routes the legacy server step', async () => {
    const handle = vi.fn();
    const service = { setServer: vi.fn(async () => ({ stage: 'signed-out' })), forgetServer: vi.fn(() => ({ stage: 'no-server' })), existing: () => null };
    const ctx = { http: {}, bootstrap: { setLicenceSource: vi.fn() } } as unknown as AppContext;
    const w = installAccounts({
      router: { handle } as unknown as IpcRouter,
      ctx,
      accounts: { service, registry: { get: () => null, active: () => null }, trusted: () => ({}), sessionFor: vi.fn(), connectPartition: 'persist:ws-connect', fetchFor: vi.fn(), acceptTokens: vi.fn() } as never,
    });
    const names = handle.mock.calls.map((c) => c[0] as string);
    for (const c of ['accounts:state', 'accounts:switch', 'accounts:startupChoice', 'accounts:setChooser', 'accounts:unsynced', 'accounts:syncNow', 'accounts:exportUnsynced', 'accounts:signOut', 'accounts:remove', 'accounts:health', 'accounts:addStart', 'accounts:addCancel']) expect(names).toContain(c);
    expect(names.filter((n) => n === 'accounts:rediscover')).toHaveLength(1);
    await ctx.accounts!.setServer('ws.example');
    expect(service.setServer).toHaveBeenCalledWith('ws.example');
    w.dispose();
  });

  it('honours WS_CLOUD_ORIGIN only in unpackaged builds', () => {
    expect(cloudOrigin(false, { WS_CLOUD_ORIGIN: 'https://localhost:8443/x' })).toBe('https://localhost:8443');
    expect(cloudOrigin(true, { WS_CLOUD_ORIGIN: 'https://localhost:8443' })).toBe('https://worksuitecloud.com');
    expect(cloudOrigin(false, { WS_CLOUD_ORIGIN: 'not a url' })).toBe('https://worksuitecloud.com');
    expect(cloudOrigin(false, {})).toBe('https://worksuitecloud.com');
  });
});

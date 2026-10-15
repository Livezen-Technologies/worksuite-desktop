import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: () => tmpdir(), getVersion: () => '0.2.0', isPackaged: false },
  powerMonitor: { isOnBatteryPower: () => false, on: () => undefined },
  systemPreferences: { canPromptTouchID: () => false },
}));

import { AuthService } from '../../../electron/services/auth';
import { Database } from '../../../electron/services/db';
import { DeviceService } from '../../../electron/services/device';
import type { HttpClient } from '../../../electron/services/http';
import { LockService } from '../../../electron/services/lock';
import {
  BROKER_REFRESH_PREFIX,
  BrokerTokenEndpoint,
  OS_DEVICE_STATUS,
  OS_DEVICE_TOKEN,
  brokerAccounts,
  chooseOsAccount,
  connectOsAccount,
  createBrokerCall,
  osDeviceServer,
  parseBrokerReply,
  readOsDevice,
  startOsSession,
  type BrokerCall,
  type BrokerReply,
  type OsSessionDeps,
} from '../../../electron/services/os-mode';
import type { SecureStore } from '../../../electron/services/secure-store';

function memoryStore(): SecureStore {
  const m = new Map<string, string>();
  return {
    get: (k: string) => m.get(k) ?? null,
    set: (k: string, v: string) => void m.set(k, v),
    delete: (k: string) => void m.delete(k),
    deletePrefix: (p: string) => {
      for (const k of [...m.keys()]) if (k.startsWith(p)) m.delete(k);
    },
  } as unknown as SecureStore;
}

/** A broker that answers from a table, recording every call. */
function fakeBroker(answers: Record<string, BrokerReply | ((params: Record<string, unknown>) => BrokerReply)>) {
  const calls: { method: string; params: Record<string, unknown>; timeoutMs?: number }[] = [];
  const call: BrokerCall = async (method, params = {}, timeoutMs) => {
    calls.push({ method, params, timeoutMs });
    const a = answers[method];
    if (!a) return { ok: false, error: 'unknown_method' };
    return typeof a === 'function' ? a(params) : a;
  };
  return { call, calls };
}

const ACME = { id: 'acct-1', server_url: 'https://work.acme.example/', name: 'Ann', state: 'signed_in' };

describe('the credentials broker protocol', () => {
  it('parses replies the way the broker writes them', () => {
    expect(parseBrokerReply('{"id":null,"result":"tok","expires_at":1700000000000}')).toEqual({ ok: true, value: 'tok', expiresAt: 1700000000000 });
    expect(parseBrokerReply('{"id":null,"error":"sign_in_required"}')).toEqual({ ok: false, error: 'sign_in_required' });
    expect(parseBrokerReply('not json')).toEqual({ ok: false, error: 'bad_reply' });
  });

  it('keeps only https accounts with an id', () => {
    expect(brokerAccounts([ACME, { id: 'x', server_url: 'http://evil.example' }, { server_url: 'https://a.example' }, null])).toEqual([{ ...ACME }]);
    expect(brokerAccounts('nope')).toEqual([]);
  });

  it('talks line-delimited JSON over the Unix socket', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wsos-'));
    const path = join(dir, 'credentials.sock');
    const seen: unknown[] = [];
    const server = createServer((s) => {
      s.setEncoding('utf8');
      s.on('data', (line: string) => {
        seen.push(JSON.parse(line.trim()));
        s.write(JSON.stringify({ id: null, result: 'access-1', expires_at: 42 }) + '\n');
      });
    });
    await new Promise<void>((r) => server.listen(path, r));
    try {
      const call = createBrokerCall(path);
      expect(await call('GetAccessToken', { account_id: 'a', force_refresh: false })).toEqual({ ok: true, value: 'access-1', expiresAt: 42 });
      expect(seen).toEqual([{ method: 'GetAccessToken', params: { account_id: 'a', force_refresh: false } }]);
      expect(await createBrokerCall(join(dir, 'missing.sock'))('Status')).toEqual({ ok: false, error: 'broker_unavailable' });
    } finally {
      server.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('choosing and signing in the OS account', () => {
  it('prefers the account on the enrolled organisation’s server', () => {
    const cloud = { id: 'c', server_url: 'https://worksuitecloud.com/', name: null, state: 'signed_in' };
    const work = { id: 'w', server_url: 'https://work.acme.example/', name: null, state: 'signed_in' };
    expect(chooseOsAccount([cloud, work], 'https://work.acme.example/')?.id).toBe('w');
    expect(chooseOsAccount([cloud, work], null)?.id).toBe('c');
    expect(chooseOsAccount([], null)).toBeNull();
  });

  it('uses the signed-in account without opening the browser', async () => {
    const b = fakeBroker({ Status: { ok: true, value: [ACME] } });
    const browser = vi.fn();
    const r = await connectOsAccount(b.call, null, browser);
    expect(r).toEqual({ ok: true, account: ACME });
    expect(browser).not.toHaveBeenCalled();
    expect(b.calls.map((c) => c.method)).toEqual(['Status']);
  });

  it('signs in through the broker (system browser) to the enrolled server when nobody is signed in', async () => {
    const b = fakeBroker({
      Status: { ok: true, value: [] },
      SignIn: (p) => ({ ok: true, value: { id: 'new', name: 'Ann', server_url: p.server_url } }),
    });
    const browser = vi.fn();
    const r = await connectOsAccount(b.call, 'https://work.acme.example/', browser);
    expect(browser).toHaveBeenCalledOnce();
    expect(b.calls[1]).toMatchObject({ method: 'SignIn', params: { server_url: 'https://work.acme.example/', mode: 'enterprise' } });
    expect(b.calls[1]!.timeoutMs).toBeGreaterThanOrEqual(5 * 60_000);
    expect(r).toEqual({ ok: true, account: { id: 'new', name: 'Ann', server_url: 'https://work.acme.example/', state: 'signed_in' } });
  });

  it('signs a signed-out account in again on its own server, and WorkSuite Cloud in personal mode', async () => {
    const b = fakeBroker({
      Status: { ok: true, value: [{ id: 'c', server_url: 'https://worksuitecloud.com/', state: 'refresh_failed' }] },
      SignIn: (p) => ({ ok: true, value: { id: 'c', server_url: p.server_url } }),
    });
    await connectOsAccount(b.call, null);
    expect(b.calls[1]!.params).toEqual({ server_url: 'https://worksuitecloud.com/', mode: 'personal' });
  });

  it('says why when the broker is locked or not there', async () => {
    expect(await connectOsAccount(fakeBroker({ Status: { ok: true, value: [{ ...ACME, state: 'locked' }] } }).call, null)).toEqual({ ok: false, error: 'locked' });
    expect(await connectOsAccount(fakeBroker({ Status: { ok: false, error: 'broker_unavailable' } }).call, null)).toEqual({ ok: false, error: 'broker_unavailable' });
  });
});

describe('BrokerTokenEndpoint', () => {
  it('maps GetAccessToken onto a token answer, with a marker in place of a refresh token', async () => {
    const b = fakeBroker({ GetAccessToken: { ok: true, value: 'at-1', expiresAt: 1_000_000 + 900_000 } });
    const ep = new BrokerTokenEndpoint(b.call, 'acct-1', () => 1_000_000);
    expect(await ep.token()).toEqual({ status: 'ok', tokens: { access_token: 'at-1', refresh_token: BROKER_REFRESH_PREFIX + 'acct-1', expires_in: 900 } });
    expect(b.calls[0]!.params).toEqual({ account_id: 'acct-1', force_refresh: false });
    await ep.refresh();
    expect(b.calls[1]!.params).toEqual({ account_id: 'acct-1', force_refresh: true });
  });

  it('a grant the broker lost ends the session; a locked or absent broker does not', async () => {
    expect((await new BrokerTokenEndpoint(fakeBroker({ GetAccessToken: { ok: false, error: 'sign_in_required' } }).call, 'a').refresh()).status).toBe('refused');
    expect((await new BrokerTokenEndpoint(fakeBroker({ GetAccessToken: { ok: false, error: 'locked' } }).call, 'a').refresh()).status).toBe('offline');
    expect((await new BrokerTokenEndpoint(fakeBroker({ GetAccessToken: { ok: false, error: 'broker_unavailable' } }).call, 'a').refresh()).status).toBe('offline');
  });

  it('AuthService refreshes through it and never revokes the OS session', async () => {
    let n = 0;
    const b = fakeBroker({ GetAccessToken: () => ({ ok: true, value: `at-${++n}`, expiresAt: Date.now() + 900_000 }) });
    const fetch = vi.fn(async () => new Response('{}'));
    const db = new Database(':memory:');
    const auth = new AuthService(db, memoryStore(), fetch as never, () => ({}));
    auth.setServer({ origin: 'https://work.acme.example', name: 'acme', api: 'desktop-v1', minimumVersion: null, locked: false } as never);
    const ep = new BrokerTokenEndpoint(b.call, 'acct-1');
    auth.setTokenEndpoint(ep);
    const first = await ep.token();
    if (first.status !== 'ok') throw new Error('no token');
    auth.acceptTokens(first.tokens);
    expect(auth.accessToken()).toBe('at-1');
    expect(auth.tokenEndpointKind()).toBe('broker');
    expect(await auth.refresh()).toBe('ok');
    expect(auth.accessToken()).toBe('at-2');
    await auth.signOut();
    expect(fetch).not.toHaveBeenCalled();
    expect(auth.hasRefreshToken()).toBe(false);
  });
});

describe('the OS device enrolment', () => {
  const files = (status: unknown, token: string | null) => (p: string) => {
    if (p === OS_DEVICE_STATUS) return JSON.stringify(status);
    if (p === OS_DEVICE_TOKEN && token !== null) return token + '\n';
    throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
  };
  const enrolled = { managed: true, device_id: 'dev-9', server: 'work.acme.example', org_name: 'Acme' };

  it('reads the agent’s status and device credential', () => {
    expect(readOsDevice(files(enrolled, 'cred-xyz'))).toEqual({ id: 'dev-9', credential: 'cred-xyz', server: 'https://work.acme.example/', orgName: 'Acme' });
    expect(osDeviceServer(files(enrolled, null))).toBe('https://work.acme.example/');
  });

  it('is nothing when the computer is not enrolled, was wiped, or the credential is gone', () => {
    expect(readOsDevice(files({ managed: false }, 'c'))).toBeNull();
    expect(readOsDevice(files({ ...enrolled, wiped: true }, 'c'))).toBeNull();
    expect(readOsDevice(files(enrolled, null))).toBeNull();
    expect(readOsDevice(files(enrolled, 'two words'))).toBeNull();
    expect(osDeviceServer(files({ managed: true, server: 'evil.example/path' }, null))).toBeNull();
  });

  it('DeviceService uses it instead of registering, and sends its credential as X-WS-Device', async () => {
    const http = { post: vi.fn(async () => ({})), get: vi.fn(async () => ({})) } as unknown as HttpClient;
    const device = new DeviceService(new Database(':memory:'), memoryStore(), http);
    device.osEnrolment = () => ({ id: 'dev-9', credential: 'cred-xyz', server: null, orgName: 'Acme' });
    const rec = await device.ensureRegistered('7', 'desktop-v1');
    expect(rec).toMatchObject({ id: 'dev-9', token: 'cred-xyz' });
    expect(device.headerValue()).toBe('cred-xyz');
    expect(device.isOsEnrolled()).toBe(true);
    expect(device.getTrust()).toBe('TRUSTED');
    expect(await device.heartbeat()).toEqual({ kind: 'none', allowOffline: true });
    await expect(device.reenrol('7', 'desktop-v1')).rejects.toMatchObject({ code: 'DEVICE_NOT_REGISTERED' });
    expect(http.post).not.toHaveBeenCalled();
  });

  it('a WorkSuite OS computer that is not enrolled registers as before', async () => {
    const http = { post: vi.fn(async () => ({ device: { id: 55 }, token: 't' })), get: vi.fn(async () => ({})) } as unknown as HttpClient;
    const device = new DeviceService(new Database(':memory:'), memoryStore(), http);
    device.osEnrolment = () => null;
    expect((await device.ensureRegistered('7', 'desktop-v1')).id).toBe('55');
    expect(device.headerValue()).toBe('55');
    expect(http.post).toHaveBeenCalledWith('/desktop/v1/devices/register', expect.anything());
  });
});

describe('the app lock in OS mode', () => {
  it('never engages: not on a timer, not with the system, not when asked', () => {
    const lock = new LockService();
    lock.enabled = () => true;
    lock.disabled = true;
    expect(lock.lock('manual').locked).toBe(false);
    expect(lock.lock('system').locked).toBe(false);
    expect(lock.isLocked()).toBe(false);
  });
});

describe('startOsSession', () => {
  function deps(over: Partial<OsSessionDeps> & { broker: BrokerCall }) {
    const stages: [string, string | null | undefined][] = [];
    const d: OsSessionDeps = {
      call: over.broker,
      deviceServer: () => null,
      currentOrigin: () => null,
      setServer: vi.fn(async () => undefined),
      useEndpoint: vi.fn(),
      acceptTokens: vi.fn(),
      hasPreviousUser: () => false,
      resume: vi.fn(async () => undefined),
      acceptSession: vi.fn(async () => undefined),
      setStage: (s, m) => void stages.push([s, m]),
      ...over,
    };
    return { d, stages };
  }
  const tokenBroker = (status: unknown[]) => fakeBroker({ Status: { ok: true, value: status }, GetAccessToken: { ok: true, value: 'at', expiresAt: Date.now() + 900_000 } }).call;

  afterEach(() => vi.restoreAllMocks());

  it('first time: the account’s server, the broker as token endpoint, the token, then the session', async () => {
    const { d } = deps({ broker: tokenBroker([ACME]) });
    expect(await startOsSession(d)).toEqual({ ok: true });
    expect(d.setServer).toHaveBeenCalledWith('https://work.acme.example/');
    expect(vi.mocked(d.useEndpoint).mock.calls[0]![0]).toBeInstanceOf(BrokerTokenEndpoint);
    expect(d.acceptTokens).toHaveBeenCalledWith({ access_token: 'at', refresh_token: BROKER_REFRESH_PREFIX + 'acct-1', expires_in: expect.any(Number) });
    expect(d.acceptSession).toHaveBeenCalledOnce();
    expect(d.resume).not.toHaveBeenCalled();
  });

  it('after that: the same server is kept and the session resumes (offline from the cache if need be)', async () => {
    const { d } = deps({ broker: tokenBroker([ACME]), currentOrigin: () => 'https://work.acme.example', hasPreviousUser: () => true });
    await startOsSession(d);
    expect(d.setServer).not.toHaveBeenCalled();
    expect(d.resume).toHaveBeenCalledOnce();
  });

  it('a broker it cannot use ends on the OS sign-in screen with the reason, never a password prompt', async () => {
    const { d, stages } = deps({ broker: fakeBroker({ Status: { ok: false, error: 'broker_unavailable' } }).call });
    expect(await startOsSession(d)).toEqual({ ok: false, error: 'broker_unavailable' });
    expect(stages.at(-1)![0]).toBe('signed-out');
    expect(stages.at(-1)![1]).toMatch(/sign-in service/);
    expect(d.acceptTokens).not.toHaveBeenCalled();
  });

  it('shows the browser stage while the broker signs in', async () => {
    const broker = fakeBroker({
      Status: { ok: true, value: [] },
      SignIn: { ok: true, value: ACME },
      GetAccessToken: { ok: true, value: 'at', expiresAt: Date.now() + 900_000 },
    }).call;
    const { d, stages } = deps({ broker });
    await startOsSession(d);
    expect(stages.map((s) => s[0])).toContain('browser');
  });
});

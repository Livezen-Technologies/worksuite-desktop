import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const electron = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('electron', () => ({ net: { request: electron.request } }));

import { EMPTY_TRUSTED_CONFIG, type TrustedConfig } from '@shared/trusted-config';
import type { ConnectRun } from '@shared/discovery';
import type { IpcRouter } from '../../../../electron/ipc/router';
import { EventEmitter } from 'node:events';
import { netFetchWithRedirects, registerDiscoveryHandlers, runDetails, type DiscoveryDeps } from '../../../../electron/services/discovery/handlers';
import { chromiumLikeFetch, discoveryDoc, makePki, makeSetupLink, startServer, TEST_KEYS, type TestPki, type TestServer } from './tls-server';

/** The connect:* channels over the pipeline, and the handle WP1 uses (pinsFor). */

let pki: TestPki;
let server: TestServer;

beforeAll(async () => {
  pki = makePki();
  server = await startServer(pki.leaf.cert, pki.leaf.key, pki.caCert);
  server.routes['/.well-known/worksuite'] = { body: JSON.stringify(discoveryDoc(server.origin)) };
  server.routes['/api/health'] = { body: '{}' };
}, 30_000);

afterAll(async () => {
  await server?.close();
  pki?.cleanup();
});

type H = (input: unknown, ctx?: unknown) => unknown;

function setup(over: Partial<DiscoveryDeps> = {}, trustedCa: string | null = null) {
  const handlers = new Map<string, H>();
  const router = { handle: (c: string, h: H) => handlers.set(c, h) } as unknown as IpcRouter;
  const events: ConnectRun[] = [];
  const createAccount = vi.fn(async () => ({ id: 'acc_aaaaaaaaaaaaaaaaaaaa' }) as never);
  const copyText = vi.fn();
  const trusted: TrustedConfig = { ...EMPTY_TRUSTED_CONFIG, spkiPins: [] };
  const deps: DiscoveryDeps = {
    emit: (_c, run) => events.push(run),
    sessionFor: () => {
      throw new Error('tests use fetchFor');
    },
    partitionFor: () => 'persist:test-net',
    trusted: () => trusted,
    rotatedKeys: () => ({}),
    existingAccount: () => null,
    createAccount,
    accountServer: (id) => (id === 'acc_bbbbbbbbbbbbbbbbbbbb' ? { input: server.origin, target: 'enterprise' } : null),
    copyText,
    appVersion: '0.3.0',
    platform: 'linux',
    isPackaged: false,
    cloudOrigin: 'https://worksuitecloud.com',
    ...over,
  };
  const fetchFor = () => chromiumLikeFetch({ trustedCa: trustedCa ?? pki.caCert, pinsFor: (h) => handle.pinsFor(h) });
  const handle = registerDiscoveryHandlers(router, deps, { fetchFor, pipeline: { lookup: async () => ({ address: '127.0.0.1' }) } });
  const call = async (c: string, input: unknown) => handlers.get(c)!(input, {});
  const until = async (runId: string) => {
    for (let i = 0; i < 200; i++) {
      const r = (await call('connect:get', { runId })) as ConnectRun;
      if (r.state !== 'running') return r;
      await new Promise((res) => setTimeout(res, 10));
    }
    throw new Error('run did not finish');
  };
  return { handlers, call, until, events, createAccount, copyText, handle, deps };
}

describe('connect:* handlers', () => {
  it('registers the connect channels and accounts:rediscover', () => {
    const { handlers, handle } = setup();
    expect([...handlers.keys()].sort()).toEqual(['accounts:rediscover', 'connect:cancel', 'connect:confirm', 'connect:copyDetails', 'connect:get', 'connect:parseSetup', 'connect:start']);
    expect(handle.health).toBeNull();
    handle.dispose();
  });

  it('start → progress → get → confirm creates the account once', async () => {
    const { call, until, events, createAccount } = setup();
    const { runId } = (await call('connect:start', { input: server.origin, target: 'enterprise' })) as { runId: string };
    const run = await until(runId);
    expect(run.state).toBe('ok');
    expect(events.length).toBeGreaterThan(7);
    expect(events.every((e) => e.runId === runId)).toBe(true);
    await call('connect:confirm', { runId });
    expect(createAccount).toHaveBeenCalledWith(expect.objectContaining({ origin: server.origin }), 'enterprise', null);
    await expect(call('connect:confirm', { runId })).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('a failed run cannot be confirmed; copyDetails copies the details for IT', async () => {
    const { call, until, copyText } = setup({}, '');
    const { runId } = (await call('connect:start', { input: server.origin, target: 'enterprise' })) as { runId: string };
    const run = await until(runId);
    expect(run.failure?.code).toBe('TLS_UNTRUSTED');
    await expect(call('connect:confirm', { runId })).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await call('connect:copyDetails', { runId })).toBe(true);
    const text = copyText.mock.calls[0]![0] as string;
    expect(text).toContain('Error: TLS_UNTRUSTED');
    expect(text).toContain(`SPKI: ${pki.leaf.pin}`);
    expect(text).toContain('CN=WS Test CA');
    expect(text).toContain(`Request ID: ${runId}`);
  });

  it('cancel stops a run; a new start cancels the previous one', async () => {
    server.routes['/.well-known/worksuite'] = { ...server.routes['/.well-known/worksuite']!, delayMs: 500 };
    try {
      const { call, until } = setup();
      const a = (await call('connect:start', { input: server.origin, target: 'enterprise' })) as { runId: string };
      const b = (await call('connect:start', { input: server.origin, target: 'enterprise' })) as { runId: string };
      expect((await until(a.runId)).state).toBe('cancelled');
      await call('connect:cancel', { runId: b.runId });
      expect((await until(b.runId)).state).toBe('cancelled');
      await expect(call('connect:get', { runId: '00000000-0000-0000-0000-000000000000' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    } finally {
      delete server.routes['/.well-known/worksuite']!.delayMs;
    }
  });

  it('parseSetup: verifies a v2 link’s signature, and refuses expired and malformed links', async () => {
    const { call } = setup();
    const payload = { v: 2, server_url: server.origin, server_id: 'x', name: 'L', exp: 4102444800, iat: 1, discovery_key: TEST_KEYS.discovery_key };
    expect(await call('connect:parseSetup', { link: makeSetupLink(payload) })).toMatchObject({ payload: { name: 'L', v: 2 } });
    await expect(call('connect:parseSetup', { link: makeSetupLink({ ...payload, exp: 1700000000 }) })).rejects.toMatchObject({ code: 'SETUP_LINK_EXPIRED' });
    await expect(call('connect:parseSetup', { link: 'worksuite://setup?d=abc&s=def' })).rejects.toMatchObject({ code: 'SETUP_LINK_INVALID' });
    const forged = makeSetupLink(payload).replace(/&s=[^&]+$/, `&s=${encodeURIComponent(Buffer.alloc(64, 2).toString('base64'))}`);
    await expect(call('connect:parseSetup', { link: forged })).rejects.toMatchObject({ code: 'SETUP_LINK_INVALID' });
  });

  it('pinsFor: managed pins allow; a running setup link’s and accounts’ pins only restrict', () => {
    const managed = { ...EMPTY_TRUSTED_CONFIG, source: 'registry' as const, serverUrl: 'https://ws.corp.example', spkiPins: ['sha256/A'] };
    const { handle } = setup({ trusted: () => managed, accountPins: (h) => (h === 'kept.example' ? ['sha256/K'] : []) });
    expect(handle.pinsFor('ws.corp.example')).toEqual({ pins: ['sha256/A'], managed: true });
    expect(handle.pinsFor('kept.example')).toEqual({ pins: ['sha256/K'], managed: false });
    expect(handle.pinsFor('other.example')).toBeNull();
  });

  it('accounts:rediscover runs again without ACCOUNT_EXISTS, and never interrupts a connect', async () => {
    const { call } = setup({ existingAccount: () => 'acc_bbbbbbbbbbbbbbbbbbbb' });
    const run = (await call('accounts:rediscover', { accountId: 'acc_bbbbbbbbbbbbbbbbbbbb' })) as ConnectRun;
    expect(run.state).toBe('ok');
    await expect(call('connect:confirm', { runId: run.runId })).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(call('accounts:rediscover', { accountId: 'acc_cccccccccccccccccccc' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('builds the health monitor when given its deps', () => {
    const { handle } = setup({ health: { healthUrl: () => null, fetch: async () => new Response(), internetOnline: () => true, onChange: () => undefined } });
    expect(handle.health?.state().state).toBe('ok');
    handle.dispose();
  });

  it('runDetails without a failure lists the checks', () => {
    const text = runDetails({ runId: 'r', input: 'x', target: 'enterprise', host: 'h', candidates: [], steps: [{ id: 'dns', status: 'ok', ms: 3, note: null }], state: 'ok', server: null, failure: null }, '0.3.0');
    expect(text).toContain('Address found (DNS): ok (3 ms)');
  });
});

describe('Chromium net adapter', () => {
  it('never lets Chromium follow a redirect: manual gets the 3xx with its Location, error mode an error', async () => {
    const options: Array<Record<string, unknown>> = [];
    electron.request.mockImplementation((o: Record<string, unknown>) => {
      options.push(o);
      const cr = Object.assign(new EventEmitter(), {
        setHeader: () => undefined,
        abort: vi.fn(),
        end: () => setImmediate(() => cr.emit('redirect', 301, 'GET', 'https://ws.example.com/api/auth/config/', {})),
      });
      return cr;
    });
    const f = netFetchWithRedirects({} as never);
    const res = await f('https://ws.example.com/api/auth/config', { method: 'GET', redirect: 'manual' });
    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe('https://ws.example.com/api/auth/config/');
    await expect(f('https://ws.example.com/x', { method: 'GET', redirect: 'error' })).rejects.toThrow(/redirect mode is set to error/);
    expect(options.every((o) => o.redirect === 'manual')).toBe(true);
  });
});

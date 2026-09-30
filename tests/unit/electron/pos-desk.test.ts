import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { getPath: () => '/tmp', getVersion: () => '0.1.0' }, safeStorage: {} }));

import { isProxyPathAllowed } from '../../../electron/services/api-proxy';
import { PosDesk, terminalOf, tillPrefix } from '../../../electron/services/pos-desk';

const TOKEN = `wsp_7_${'a1'.repeat(32)}`;
const TERMINAL = { id: 7, code: 'front-01', name: 'Front till', org_id: 3, org_name: 'Acme', branch_name: 'Colombo', warehouse_id: 4, warehouse_name: 'Shop floor', in_use: false, device_name: null };

/* The OS credential store, as a map. */
function secrets() {
  const m = new Map<string, string>();
  return {
    m,
    get: (k: string) => m.get(k) ?? null,
    set: (k: string, v: string) => void m.set(k, v),
    delete: (k: string) => void m.delete(k),
    deletePrefix: (p: string) => {
      let n = 0;
      for (const k of [...m.keys()]) if (k.startsWith(p) && m.delete(k)) n++;
      return n;
    },
  };
}

function desk(over: { request?: (...a: unknown[]) => Promise<unknown>; raw?: (...a: unknown[]) => Promise<Response>; origin?: () => string | null } = {}) {
  const s = secrets();
  const request = vi.fn(over.request ?? (async () => ({ token: TOKEN, expires_at: '2026-12-29 10:00:00', terminal: TERMINAL })));
  const raw = vi.fn(over.raw ?? (async () => new Response(JSON.stringify({ status: 'success', message: 'OK', terminal: { ...TERMINAL, warehouse_name: 'Back store' } }), { headers: { 'Content-Type': 'application/json' } })));
  const d = new PosDesk({
    secrets: s,
    http: { request, raw, url: (p: string) => `https://ws.example${p}` } as never,
    origin: over.origin ?? (() => 'https://ws.example'),
    installId: () => 'install-1',
    device: () => ({ name: 'COUNTER-PC', info: 'WorkSuite Desktop on windows' }),
    appVersion: '0.2.64',
    now: () => Date.parse('2026-09-30T08:00:00Z'),
  });
  return { d, s, request, raw };
}

describe('POS till: the credential stays in the main process', () => {
  it('pairs through the staff API and keeps the credential in the OS store, handing back only the till', async () => {
    const { d, s, request } = desk();
    const r = await d.pair(7, false);

    expect(request).toHaveBeenCalledWith('POST', '/api/pos/terminals/7/pair', {
      body: { device_name: 'COUNTER-PC', device_info: 'WorkSuite Desktop on windows', app_version: 'desktop 0.2.64', take_over: false },
    });
    expect(r.message).toBe('This computer is now Front till.');
    expect(JSON.stringify(r)).not.toContain(TOKEN);
    expect(JSON.stringify(d.pairing())).not.toContain('a1a1');
    expect(d.pairing()).toMatchObject({ terminal: { id: 7, name: 'Front till', warehouse_id: 4 }, state: 'paired', usable: true, prefix: tillPrefix('front-01', 7, 'install-1', '2026-09-30T08:00:00.000Z') });
    // Filed under the server that issued it, in the credential store — nowhere else.
    expect([...s.m.keys()]).toEqual(['pos-till:https://ws.example']);
    expect(s.m.get('pos-till:https://ws.example')).toContain(TOKEN);
  });

  it('refuses a pairing answered without a usable credential, and keeps nothing', async () => {
    for (const token of [undefined, 'wsp_7_short', `wsp_8_${'b2'.repeat(32)}`, `${TOKEN}\n`]) {
      const { d, s } = desk({ request: async () => ({ token, terminal: TERMINAL }) });
      await expect(d.pair(7, false)).rejects.toMatchObject({ code: 'SERVER_ERROR' });
      expect(s.m.size).toBe(0);
    }
  });

  it('asks the server to take a till over only when told to', async () => {
    const { d, request } = desk();
    await d.pair(7, true);
    expect((request.mock.calls[0]![2] as { body: { take_over: boolean } }).body.take_over).toBe(true);
  });

  it('gives each pairing a receipt prefix of its own', () => {
    const a = tillPrefix('front-01', 7, 'install-1', '2026-09-30T08:00:00.000Z');
    const b = tillPrefix('front-01', 7, 'install-1', '2026-09-30T09:00:00.000Z');
    const c = tillPrefix('front-01', 7, 'install-2', '2026-09-30T08:00:00.000Z');
    expect(a).toMatch(/^FRONT01-[0-9A-F]{6}$/);
    expect(new Set([a, b, c]).size).toBe(3);
    expect(tillPrefix('ටිල්', 9, 'x', 'y')).toMatch(/^T9-[0-9A-F]{6}$/);
  });

  it('calls the device door with the till credential, never the session', async () => {
    const { d, raw } = desk();
    await d.pair(7, false);
    const a = await d.heartbeat(3);

    expect(a.status).toBe(200);
    const [method, url, init] = raw.mock.calls[0] as [string, string, RequestInit & { auth?: boolean }];
    expect(method).toBe('POST');
    expect(url).toBe('https://ws.example/api/pos/device/heartbeat');
    expect(init.auth).toBe(false);
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
    expect(JSON.parse(String(init.body))).toEqual({ app_version: 'desktop 0.2.64', pending_count: 3 });
    // The heartbeat's answer updates what the till is (its warehouse was changed on the web).
    expect(d.pairing()?.terminal.warehouse_name).toBe('Back store');
  });

  it('drops a credential the server refuses, keeping which till it was', async () => {
    const { d, s } = desk({ raw: async () => new Response(JSON.stringify({ status: 'error', message: 'Sign in and pair it again.', reauth: true }), { status: 401, headers: { 'Content-Type': 'application/json' } }) });
    await d.pair(7, false);
    expect((await d.device('sales', { sales: [] })).status).toBe(401);
    expect(d.pairing()).toMatchObject({ state: 'revoked', usable: false, terminal: { id: 7 } });
    expect(s.m.get('pos-till:https://ws.example')).not.toContain(TOKEN);
    await expect(d.device('heartbeat', {})).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('says POS is off while the server answers 503, and paired again once it answers', async () => {
    let code = 503;
    const { d } = desk({ raw: async () => new Response('{}', { status: code, headers: { 'Content-Type': 'application/json' } }) });
    await d.pair(7, false);
    await d.device('heartbeat', {});
    expect(d.pairing()?.state).toBe('pos_off');
    code = 200;
    await d.device('heartbeat', {});
    expect(d.pairing()?.state).toBe('paired');
  });

  it('files the till under the server, and forgets it on request or at a wipe', async () => {
    let origin = 'https://ws.example';
    const { d, s } = desk({ origin: () => origin });
    await d.pair(7, false);
    origin = 'https://other.example';
    expect(d.pairing()).toBeNull();
    origin = 'https://ws.example';
    d.forget();
    expect(d.pairing()).toBeNull();
    await d.pair(7, false);
    expect(d.forgetAll()).toBe(1);
    expect(s.m.size).toBe(0);
  });

  it('reads a till the server described, and nothing else', () => {
    expect(terminalOf({ id: '5', org_id: 2, code: 'T5' })).toMatchObject({ id: 5, org_id: 2, name: 'T5' });
    expect(terminalOf({ id: 5 })).toBeNull();
    expect(terminalOf(null)).toBeNull();
  });

  it('keeps pages away from the pairing and the device door', () => {
    expect(isProxyPathAllowed('/api/pos/terminals/7/pair', 'POST')).toBe(false);
    expect(isProxyPathAllowed('/api/pos/device/sales', 'POST')).toBe(false);
    expect(isProxyPathAllowed('/api/pos/device/heartbeat', 'POST')).toBe(false);
    expect(isProxyPathAllowed('/api/pos/setup')).toBe(true);
    expect(isProxyPathAllowed('/api/pos/sessions/12/close', 'POST')).toBe(true);
  });
});

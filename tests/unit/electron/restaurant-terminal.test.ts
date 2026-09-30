import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { getPath: () => '/tmp', getVersion: () => '0.1.0' }, safeStorage: {}, BrowserWindow: class {} }));

import { contract } from '@shared/ipc/contract';
import { isRestaurantPath, restaurantMainOnly } from '@shared/restaurant';
import { parseDeepLink } from '@shared/deeplink';
import { isProxyPathAllowed } from '../../../electron/services/api-proxy';
import { RestaurantTerminal } from '../../../electron/services/restaurant/terminal';

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

const KEY = `rt_${'ab'.repeat(24)}`;
const TERMINALS = [
  { id: 7, branch_id: 3, name: 'Till 1', code: 'T1', mode: 'pos', station_id: null, area_id: 2, counter_id: null, pos_register_id: 11, active: true, paired: false },
  { id: 8, branch_id: 3, name: 'Grill screen', code: 'K1', mode: 'kds', station_id: 5, area_id: null, counter_id: null, pos_register_id: null, active: true, paired: false },
  { id: 9, branch_id: 4, name: 'Other branch', code: 'T9', mode: 'pos', active: true },
];

function server(over: { key?: unknown; terminals?: unknown[] } = {}) {
  return vi.fn(async (method: string, path: string, _opts?: unknown) => {
    if (method === 'GET' && path === '/api/restaurant/v1/structure') return { terminals: over.terminals ?? TERMINALS };
    if (method === 'POST' && /\/terminals\/\d+\/pair$/.test(path)) return { device_key: over.key === undefined ? KEY : over.key };
    if (method === 'POST' && /\/terminals\/\d+\/revoke$/.test(path)) return {};
    throw new Error(`unexpected ${method} ${path}`);
  });
}

describe('restaurant terminal: the key stays in the main process', () => {
  it('reads the terminal back from the server, pairs it, keeps the key and gives back only the terminal', async () => {
    const s = secrets();
    const request = server();
    const t = new RestaurantTerminal(s, { request } as never, () => 'https://ws.example', () => Date.parse('2026-09-30T10:00:00Z'));

    const r = await t.pair({ org_id: 17, branch_id: 3, terminal_id: 7 });

    expect(request).toHaveBeenNthCalledWith(1, 'GET', '/api/restaurant/v1/structure', { query: { org: 17, branch_id: 3 } });
    expect(request).toHaveBeenNthCalledWith(2, 'POST', '/api/restaurant/v1/terminals/7/pair', { query: { org: 17 }, body: {} });
    expect(r.pairing).toEqual({ terminal_id: 7, org_id: 17, branch_id: 3, name: 'Till 1', code: 'T1', mode: 'pos', station_id: null, area_id: 2, counter_id: null, pos_register_id: 11, paired_at: '2026-09-30T10:00:00.000Z' });
    expect(JSON.stringify(r)).not.toContain(KEY);
    expect(JSON.stringify(t.pairing())).not.toContain(KEY);
    expect([...s.m.values()][0]).toContain(KEY);
  });

  it('refuses a terminal of another branch, and keeps nothing', async () => {
    const s = secrets();
    const t = new RestaurantTerminal(s, { request: server() } as never, () => 'https://ws.example');
    await expect(t.pair({ org_id: 17, branch_id: 3, terminal_id: 9 })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(s.m.size).toBe(0);
  });

  it('refuses a pairing answered without a proper key', async () => {
    const s = secrets();
    const t = new RestaurantTerminal(s, { request: server({ key: 'short' }) } as never, () => 'https://ws.example');
    await expect(t.pair({ org_id: 17, branch_id: 3, terminal_id: 7 })).rejects.toMatchObject({ code: 'SERVER_ERROR' });
    expect(s.m.size).toBe(0);
  });

  it('hands the key only to the Restaurant API, and only on the server it came from', async () => {
    let origin = 'https://ws.example';
    const t = new RestaurantTerminal(secrets(), { request: server() } as never, () => origin);
    await t.pair({ org_id: 17, branch_id: 3, terminal_id: 8 });

    expect(t.keyFor('/api/restaurant/v1/kitchen?branch_id=3')).toBe(KEY);
    expect(t.keyFor('/api/restaurant/v1/orders/5/items')).toBe(KEY);
    expect(t.keyFor('/api/restaurant/v10/anything')).toBeNull();
    expect(t.keyFor('/api/pos/sales')).toBeNull();
    expect(t.pairing()?.station_id).toBe(5);

    origin = 'https://other.example';
    expect(t.pairing()).toBeNull();
    expect(t.keyFor('/api/restaurant/v1/kitchen')).toBeNull();
  });

  it('unpairs: revokes on the server when asked, and forgets the key either way', async () => {
    const s = secrets();
    const request = server();
    const t = new RestaurantTerminal(s, { request } as never, () => 'https://ws.example');
    await t.pair({ org_id: 17, branch_id: 3, terminal_id: 7 });

    expect(await t.unpair(true)).toEqual({ revoked: true, message: null });
    expect(request).toHaveBeenLastCalledWith('POST', '/api/restaurant/v1/terminals/7/revoke', { query: { org: 17 }, body: {} });
    expect(t.pairing()).toBeNull();

    await t.pair({ org_id: 17, branch_id: 3, terminal_id: 7 });
    request.mockImplementationOnce(async () => {
      throw new Error('You do not have permission to do that');
    });
    expect(await t.unpair(true)).toEqual({ revoked: false, message: 'You do not have permission to do that' });
    expect(s.m.size).toBe(0);
  });

  it('forgets every terminal on a wipe', async () => {
    const s = secrets();
    s.set('other-secret', 'x');
    const t = new RestaurantTerminal(s, { request: server() } as never, () => 'https://ws.example');
    await t.pair({ org_id: 17, branch_id: 3, terminal_id: 7 });
    expect(t.forgetAll()).toBe(1);
    expect(s.m.has('other-secret')).toBe(true);
  });
});

describe('restaurant terminal: what a page may call', () => {
  it('keeps pairing, playback, the heartbeat and the print agent to the main process', () => {
    expect(isProxyPathAllowed('/api/restaurant/v1/terminals/7/pair', 'POST')).toBe(false);
    expect(isProxyPathAllowed('/api/restaurant/v1/sync', 'POST')).toBe(false);
    expect(isProxyPathAllowed('/api/restaurant/v1/sync/heartbeat', 'POST')).toBe(false);
    expect(isProxyPathAllowed('/api/restaurant/v1/print-jobs/claim', 'POST')).toBe(false);
    expect(isProxyPathAllowed('/api/restaurant/v1/print-jobs/12/printed', 'POST')).toBe(false);
    expect(isProxyPathAllowed('/api/restaurant/v1/print-jobs/12/failed', 'POST')).toBe(false);
  });

  it('leaves the till, the kitchen, reprints and conflicts to the screens', () => {
    expect(isProxyPathAllowed('/api/restaurant/v1/orders', 'POST')).toBe(true);
    expect(isProxyPathAllowed('/api/restaurant/v1/kitchen/tickets/4/bump', 'POST')).toBe(true);
    expect(isProxyPathAllowed('/api/restaurant/v1/print-jobs?branch_id=3', 'GET')).toBe(true);
    expect(isProxyPathAllowed('/api/restaurant/v1/print-jobs/12/reprint', 'POST')).toBe(true);
    expect(isProxyPathAllowed('/api/restaurant/v1/sync/conflicts?branch_id=3', 'GET')).toBe(true);
    expect(isProxyPathAllowed('/api/restaurant/v1/sync/conflicts/2/resolve', 'POST')).toBe(true);
    expect(isProxyPathAllowed('/api/restaurant/v1/terminals/7/revoke', 'POST')).toBe(true);
    expect(restaurantMainOnly('/api/restaurant/v1/sync', 'GET')).toBe(false);
    expect(isRestaurantPath('/api/restaurant/v1')).toBe(true);
    expect(isRestaurantPath('/api/restaurant/v1x')).toBe(false);
  });

  it('declares the channels, and never takes a key from a page', () => {
    expect(contract['restaurant:pair'].input.safeParse({ org_id: 1, branch_id: 2, terminal_id: 3 }).success).toBe(true);
    expect(contract['restaurant:pair'].input.parse({ org_id: 1, branch_id: 2, terminal_id: 3, key: KEY })).not.toHaveProperty('key');
    expect(contract['restaurant:pair'].sensitive).toBe(true);
    expect(contract['restaurant:openDrawer'].sensitive).toBe(true);
    expect(contract['restaurant:outboxAdd'].input.safeParse({ op: 'send', label: 'x', data: {} }).success).toBe(false);
  });

  it('opens the order and the kitchen from a link', () => {
    const o = parseDeepLink('worksuite://restaurant/orders/41');
    expect(o.ok && o.link.route).toBe('/restaurant/orders/41');
    const k = parseDeepLink('worksuite://restaurant/kitchen');
    expect(k.ok && k.link.route).toBe('/restaurant/kitchen');
  });
});

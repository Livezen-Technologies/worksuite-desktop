import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { getPath: () => '/tmp', getVersion: () => '0.1.0' }, safeStorage: {} }));

import type { PosCatalogue } from '@shared/pos';
import { DesktopError } from '../../../electron/main/errors';
import { Database } from '../../../electron/services/db';
import type { DeviceAnswer, PosPairing } from '../../../electron/services/pos-desk';
import { LOW_DISK, PosThumbs } from '../../../electron/services/pos-thumbs';
import { PosTill } from '../../../electron/services/pos-till';
import { Vault } from '../../../electron/services/vault';

/**
 * worksuite-desktop#296: the till's catalogue copy a product a row — read whole a page at a time, then only what
 * changed since; a copy kept the old way split into rows; the till's status without decrypting a product; the
 * catalogue brought up to date on reconnect, on Sync now and on its interval; and the pictures kept for offline.
 */

type Row = { id: string; code: string; barcode: string; name: string; category: string; category_id: string; price: number; discount_pct: number; tax_rate: number; image_url?: string | null };

/** A WorkSuite that answers `catalogue/changes` the way `Catalogue::changes` does, from a list it can be told to change. */
function server(n: number) {
  const rows = new Map<number, Row>();
  const log: Array<{ rev: number; id: number; gone: boolean }> = [];
  let rev = 0;
  let resetNext = false;
  let failAt: number | null = null;
  const put = (id: number, over: Partial<Row> = {}) => {
    rows.set(id, { id: String(id), code: `P-${id}`, barcode: `479${String(id).padStart(10, '0')}`, name: `Product ${id}`, category: id % 2 ? 'Tea' : 'Rice', category_id: id % 2 ? '1' : '2', price: 100 + id, discount_pct: 0, tax_rate: 0, ...over });
    log.push({ rev: ++rev, id, gone: false });
  };
  for (let i = 1; i <= n; i++) put(i);
  const pagesAsked: string[] = [];
  const answer = (since: string | undefined, limit: number): Record<string, unknown> => {
    pagesAsked.push(since ?? '(none)');
    let full = !since || resetNext;
    const reset = !!since && resetNext;
    resetNext = false;
    let from = 0;
    if (since?.startsWith('f:')) [full, from] = [true, Number(since.slice(2))];
    const extras = { version: `v${rev}`, currency: 'LKR', category_tree: [{ id: '1', name: 'Tea', parent_id: null, product_count: 1, children: [] }], favourites: [] };
    if (full) {
      const all = [...rows.values()];
      const page = all.slice(from, from + limit);
      const more = from + limit < all.length;
      if (failAt !== null && from >= failAt) throw new DesktopError('NETWORK_UNREACHABLE', 'Cannot reach WorkSuite server.');
      return { status: 'success', mode: 'full', reset, products: page, deleted: [], has_more: more, next: more ? `f:${from + limit}` : `d:${rev}`, ...(more ? {} : { total: rows.size, ...extras }) };
    }
    const after = Number(since!.slice(2));
    const changed = log.filter((l) => l.rev > after);
    const ids = [...new Set(changed.map((c) => c.id))];
    return {
      status: 'success',
      mode: 'delta',
      reset: false,
      products: ids.filter((id) => rows.has(id)).map((id) => rows.get(id)),
      deleted: ids.filter((id) => !rows.has(id)).map(String),
      has_more: false,
      next: `d:${rev}`,
      total: rows.size,
      ...(ids.length ? extras : { unchanged: true }),
    };
  };
  return {
    rows,
    pagesAsked,
    put,
    remove: (id: number, quietly = false) => {
      rows.delete(id);
      if (!quietly) log.push({ rev: ++rev, id, gone: true });
    },
    reset: () => (resetNext = true),
    failFrom: (offset: number | null) => (failAt = offset),
    answer,
  };
}

function till(o: { srv?: ReturnType<typeof server>; keep?: boolean; door?: (method: string, path: string, q?: Record<string, unknown>) => Promise<DeviceAnswer>; thumbs?: PosThumbs; offline?: () => boolean; db?: Database } = {}) {
  const db = o.db ?? new Database(':memory:');
  const vault = new Vault(Vault.generateKey());
  let now = Date.parse('2026-10-07T08:00:00Z');
  const pairing: PosPairing = { terminal: { id: 7, code: 'T1', name: 'Front till', org_id: 3, org_name: null, branch_name: null, warehouse_id: 4, warehouse_name: null }, paired_at: '2026-10-07T07:00:00Z', prefix: 'T1-AAAAAA', state: 'paired', usable: true };
  const down = () => o.offline?.() === true;
  const door = vi.fn(async (method: 'GET' | 'POST', path: string, opt?: { query?: Record<string, unknown> }): Promise<DeviceAnswer> => {
    if (down()) throw new DesktopError('NETWORK_UNREACHABLE', 'Cannot reach WorkSuite server.');
    if (o.door) return o.door(method, path, opt?.query);
    if (path === 'catalogue/changes' && o.srv) return { status: 200, body: o.srv.answer(opt?.query?.since as string | undefined, Number(opt?.query?.limit ?? 500)) };
    return { status: 404, body: null };
  });
  const device = vi.fn(async (path: 'heartbeat' | 'sales', _body?: unknown): Promise<DeviceAnswer> => {
    if (down()) throw new DesktopError('NETWORK_UNREACHABLE', 'Cannot reach WorkSuite server.');
    return path === 'heartbeat' ? { status: 200, body: { status: 'success' } } : { status: 200, body: { results: [] } };
  });
  const t = new PosTill({
    db,
    vault: () => vault,
    http: { request: vi.fn(async () => ({})) } as never,
    desk: { pairing: () => pairing, device, heartbeat: (pending: number, extra?: unknown) => device('heartbeat', { pending, ...(extra as object) } as never), door: door as never },
    origin: () => 'https://ws.example',
    caps: () => ({ offlineCache: o.keep ?? true, offlineQueue: 'allowed' }),
    changed: vi.fn(),
    now: () => now,
    ...(o.thumbs ? { thumbs: o.thumbs } : {}),
  });
  const asked = () => door.mock.calls.filter((c) => c[1] === 'catalogue/changes').length;
  return { db, vault, till: t, door, device, asked, tick: (ms: number) => (now += ms) };
}

describe('POS catalogue copy, a product a row', () => {
  it('reads the copy whole a page at a time, seals each product, and counts it without decrypting one', async () => {
    const srv = server(1200);
    const s = till({ srv });
    await s.till.sync();
    expect(srv.pagesAsked).toEqual(['(none)', 'f:500', 'f:1000']);
    expect(s.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM pos_products')!.n).toBe(1200);
    // The codes a scan looks up are plain; the product itself is not.
    expect(JSON.stringify(s.db.all('SELECT payload FROM pos_products LIMIT 5'))).not.toContain('Product');
    expect(s.db.get('SELECT barcode, code FROM pos_products WHERE product_id = 9')).toEqual({ barcode: '4790000000009', code: 'P-9' });
    const decrypt = vi.spyOn(s.vault, 'decrypt');
    const st = s.till.status();
    expect(st.catalogue).toMatchObject({ products: 1200, version: 'v1200', source: 'pos', stale: false, error: null });
    expect(decrypt.mock.calls.length).toBeLessThanOrEqual(2);
    const c = s.till.catalogue()!;
    expect(c.products).toHaveLength(1200);
    expect(c.products[0]).toMatchObject({ id: 1, name: 'Product 1', category: 'Tea', category_id: '1' });
    expect(c.categories).toEqual(['Rice', 'Tea']);
    expect(c.category_tree?.[0]?.name).toBe('Tea');
    // Read again: the same object, assembled once until the copy changes.
    expect(s.till.catalogue()).toBe(c);
  });

  it('applies only what changed since — an edit, a deletion — without reading the rest again', async () => {
    const srv = server(30);
    const s = till({ srv });
    await s.till.sync();
    const before = s.till.catalogue()!;
    srv.put(5, { name: 'Ceylon tea 400g', price: 1450 });
    srv.remove(6);
    s.tick(31 * 60_000);
    await s.till.sync();
    expect(srv.pagesAsked.at(-1)).toBe('d:30');
    const c = s.till.catalogue()!;
    expect(c).not.toBe(before);
    expect(c.products).toHaveLength(29);
    expect(c.products.find((p) => p.id === 5)).toMatchObject({ name: 'Ceylon tea 400g', price: 1450 });
    expect(c.products.some((p) => p.id === 6)).toBe(false);
    // Nothing changed: one short answer, the copy as it was, its time moved on.
    s.tick(31 * 60_000);
    await s.till.sync();
    expect(s.till.catalogue()!.products).toHaveLength(29);
    expect(s.till.status().catalogue!.fetched_at).toBe('2026-10-07T09:02:00.000Z');
  });

  it('reads the copy whole again when WorkSuite cannot continue from the cursor, and drops what it no longer sends', async () => {
    const srv = server(10);
    const s = till({ srv });
    await s.till.sync();
    srv.remove(3, true);
    srv.reset();
    s.tick(31 * 60_000);
    await s.till.sync();
    const ids = s.till.catalogue()!.products.map((p) => p.id);
    expect(ids).toHaveLength(9);
    expect(ids).not.toContain(3);
    expect(s.db.all<{ gen: number }>('SELECT DISTINCT gen FROM pos_products')).toEqual([{ gen: 2 }]);
  });

  it('reads the copy whole when it no longer adds up to WorkSuite’s count (a product removed outright)', async () => {
    const srv = server(10);
    const s = till({ srv });
    await s.till.sync();
    srv.remove(4, true);
    srv.put(2, { name: 'Renamed' });
    s.tick(31 * 60_000);
    await s.till.sync();
    expect(srv.pagesAsked.slice(-2)).toEqual(['d:10', '(none)']);
    expect(s.till.catalogue()!.products.map((p) => p.id)).not.toContain(4);
  });

  it('keeps selling from the copy it has when a download stops half way, and says why', async () => {
    const srv = server(1200);
    const s = till({ srv });
    await s.till.sync();
    srv.reset();
    srv.failFrom(500);
    s.tick(31 * 60_000);
    await s.till.sync();
    expect(s.till.catalogue()!.products).toHaveLength(1200);
    expect(s.till.status().catalogue!.error).toMatch(/Cannot reach/);
    expect(s.till.status().catalogue!.version).toBe('v1200');
    // Asked again in two minutes, not half an hour.
    srv.failFrom(null);
    s.tick(3 * 60_000);
    await s.till.sync();
    expect(s.till.status().catalogue!.error).toBeNull();
    expect(s.till.status().catalogue!.products).toBe(1200);
    // The next whole download takes what the stopped one left, too.
    srv.reset();
    srv.remove(1, true);
    s.tick(31 * 60_000);
    await s.till.sync();
    expect(s.db.all<{ gen: number }>('SELECT DISTINCT gen FROM pos_products')).toEqual([{ gen: 3 }]);
    expect(s.till.status().catalogue!.products).toBe(1199);
  });

  it('splits a copy kept the old way — one sealed blob — into rows the first time it is read', () => {
    const s = till();
    const old: PosCatalogue = {
      version: 'old1',
      fetched_at: '2026-10-06T08:00:00.000Z',
      currency: 'LKR',
      source: 'pos',
      categories: ['Tea'],
      products: [
        { id: 9, code: 'TEA-1', barcode: '4790001', name: 'Ceylon tea', unit: 'pkt', category: 'Tea', price: 450, discount_pct: 0, tax_rate: 18 },
        { id: 10, code: 'TEA-2', barcode: null, name: 'Green tea', unit: null, category: 'Tea', price: 300, discount_pct: 0, tax_rate: 18 },
      ],
      truncated: false,
    };
    s.db.run('INSERT INTO pos_catalogue (origin, terminal_id, version, payload, fetched_at) VALUES (?, ?, ?, ?, ?)', 'https://ws.example', 7, 'old1', s.vault.encrypt(old), old.fetched_at);
    expect(s.till.status().catalogue).toMatchObject({ version: 'old1', products: 2 });
    expect(s.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM pos_products')!.n).toBe(2);
    // The head keeps no products (an older version reading it sees an empty copy, and reads the catalogue again).
    expect(s.vault.decrypt<Record<string, unknown>>(s.db.get<{ payload: string }>('SELECT payload FROM pos_catalogue')!.payload)).toMatchObject({ version: 'old1', products: [], gen: 1 });
    expect(s.till.catalogue()).toMatchObject({ version: 'old1', categories: ['Tea'], products: [{ id: 9 }, { id: 10 }] });
  });

  it('keeps the copy in memory only where the policy keeps nothing on disk, changes and all', async () => {
    const srv = server(20);
    const s = till({ srv, keep: false });
    await s.till.sync();
    srv.remove(1);
    s.tick(31 * 60_000);
    await s.till.sync();
    expect(s.db.all('SELECT * FROM pos_products')).toEqual([]);
    expect(s.db.all('SELECT * FROM pos_catalogue')).toEqual([]);
    expect(s.till.catalogue()!.products).toHaveLength(19);
    expect(s.till.status().catalogue!.products).toBe(19);
  });

  it('hands the screens 20,000 products fast enough to keep the whole array (measured)', async () => {
    const srv = server(20_000);
    const s = till({ srv });
    let t = performance.now();
    await s.till.sync();
    const synced = performance.now() - t;
    // Cold: every row decrypted and sorted, as after a start-up.
    s.till.store.touch({ origin: 'https://ws.example', terminal: 7 });
    t = performance.now();
    const c = s.till.catalogue()!;
    const read = performance.now() - t;
    t = performance.now();
    s.till.status();
    const status = performance.now() - t;
    console.info(`[pos catalogue] 20000 products: whole download ${synced.toFixed(0)} ms, first read ${read.toFixed(0)} ms, status ${status.toFixed(1)} ms`);
    expect(c.products).toHaveLength(20_000);
    expect(read).toBeLessThan(5000);
    expect(status).toBeLessThan(200);
  }, 60_000);

  it('forgets the copy with the till', async () => {
    const s = till({ srv: server(5) });
    await s.till.sync();
    s.till.forgetTill('https://ws.example', 7);
    expect(s.db.all('SELECT * FROM pos_products')).toEqual([]);
    expect(s.till.catalogue()).toBeNull();
  });
});

describe('POS catalogue: when it is brought up to date', () => {
  it('on its interval, at once when WorkSuite answers again, and on Sync now', async () => {
    let down = false;
    const srv = server(3);
    const s = till({ srv, offline: () => down });
    await s.till.sync();
    expect(s.asked()).toBe(1);
    s.tick(60_000);
    await s.till.sync();
    expect(s.asked()).toBe(1);
    // Out of reach, then back: the catalogue at once, not half an hour later.
    down = true;
    s.tick(61_000);
    await s.till.sync();
    expect(s.till.status().reachable).toBe(false);
    down = false;
    s.tick(61_000);
    await s.till.sync();
    expect(s.asked()).toBe(2);
    // Sync now: both.
    await s.till.sync(true, { catalogue: true });
    expect(s.asked()).toBe(3);
    // The interval is the till's setting.
    s.till.setSettings({ catalogue_minutes: 5 });
    s.tick(6 * 60_000);
    await s.till.sync();
    expect(s.asked()).toBe(4);
  });

  it('stamps the last sync only when it went through', async () => {
    let down = false;
    const s = till({ srv: server(1), offline: () => down });
    await s.till.sync();
    const first = s.till.status().last_sync;
    expect(first).toBe('2026-10-07T08:00:00.000Z');
    down = true;
    s.tick(61_000);
    await s.till.sync();
    expect(s.till.status().last_sync).toBe(first);
  });

  it('says the copy is stale after two of its intervals without a sync', async () => {
    let down = false;
    const s = till({ srv: server(1), offline: () => down });
    await s.till.sync();
    expect(s.till.status().catalogue!.stale).toBe(false);
    down = true;
    s.tick(61 * 60_000);
    await s.till.sync();
    expect(s.till.status().catalogue!.stale).toBe(true);
  });

  it('keeps the till’s own settings: no card offline unless the shop says so', () => {
    const s = till();
    expect(s.till.settings()).toEqual({ card_offline: false, catalogue_minutes: 30, thumbs_mb: 200 });
    expect(s.till.setSettings({ card_offline: true }).card_offline).toBe(true);
    expect(() => s.till.setSettings({ catalogue_minutes: 1 })).toThrow();
  });
});

describe('POS pictures kept for offline', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  const jpeg = (n: number) => Buffer.alloc(n, 7);

  function thumbs(o: { free?: number | null; fetch?: (id: number) => Promise<{ status: number; type: string | null; bytes: Buffer | null }> } = {}) {
    const dir = mkdtempSync(join(tmpdir(), 'pos-thumbs-'));
    dirs.push(dir);
    const db = new Database(':memory:');
    const fetch = vi.fn(o.fetch ?? (async () => ({ status: 200, type: 'image/jpeg', bytes: jpeg(300 * 1024) })));
    let now = Date.parse('2026-10-07T08:00:00Z');
    const t = new PosThumbs({ db, dir: () => dir, fetch, free: async () => (o.free === undefined ? 10 * LOW_DISK : o.free), now: () => now });
    return { t, db, dir, fetch, tick: (ms: number) => (now += ms) };
  }
  const scope = { origin: 'https://ws.example', terminal: 7 };
  const rows = (ids: number[], at = '2026-10-07T08:00:00.000Z') => ids.map((id) => ({ id, updated_at: at, image: true }));

  it('fetches what the copy lacks within the room, serves it, and fetches again only a changed product’s', async () => {
    const s = thumbs();
    expect(await s.t.fill(scope, rows([1, 2, 3, 4]), 1)).toBe(3);
    expect(s.t.ids(scope)).toEqual(new Set([1, 2, 3]));
    expect(s.t.usage(scope)).toEqual({ count: 3, bytes: 3 * 300 * 1024 });
    const r = await s.t.serve(scope, '/pos-thumb/2');
    expect([r.status, r.headers.get('content-type')]).toEqual([200, 'image/jpeg']);
    expect((await s.t.serve(scope, '/pos-thumb/4')).status).toBe(404);
    expect((await s.t.serve(null, '/pos-thumb/2')).status).toBe(404);
    expect((await s.t.serve(scope, '/pos-thumb/../x')).status).toBe(404);
    s.fetch.mockClear();
    // The room is full: nothing more, and nothing dropped to make room (it would only be fetched again).
    expect(await s.t.fill(scope, rows([1, 2, 3, 4]), 1)).toBe(0);
    expect(s.fetch.mock.calls.map((c) => c[0])).toEqual([4]);
    s.fetch.mockClear();
    await s.t.fill(scope, [...rows([1, 3]), ...rows([2], '2026-10-07T09:00:00.000Z')], 10);
    expect(s.fetch.mock.calls.map((c) => c[0])).toEqual([2]);
    expect(s.t.ids(scope)).toEqual(new Set([1, 2, 3]));
  });

  it('drops the least recently shown first when the room shrinks, and every one when the disk runs low', async () => {
    const s = thumbs();
    await s.t.fill(scope, rows([1, 2, 3]), 10);
    s.tick(2 * 3_600_000);
    await s.t.serve(scope, '/pos-thumb/1');
    expect(await s.t.evict(0.5)).toBe(2);
    expect(s.t.ids(scope)).toEqual(new Set([1]));
    const low = thumbs({ free: LOW_DISK - 1 });
    await low.t.fill(scope, rows([1]), 10);
    expect(low.fetch).not.toHaveBeenCalled();
  });

  it('stops at an answer that is not a picture the door could give, and forgets them all with the till', async () => {
    const s = thumbs({ fetch: async (id) => (id === 2 ? { status: 503, type: 'application/json', bytes: null } : { status: 200, type: 'image/png', bytes: jpeg(10) }) });
    await s.t.fill(scope, rows([1, 2, 3, 4, 5, 6]), 10);
    expect(s.t.ids(scope).has(5)).toBe(false);
    s.t.forget(scope.origin, scope.terminal);
    expect(s.t.usage(scope).count).toBe(0);
    await new Promise((r) => setTimeout(r, 20));
    expect(readdirSync(s.dir)).toEqual([]);
  });

  it('are fetched after a catalogue sync where the policy keeps data, and marked on the products', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pos-thumbs-'));
    dirs.push(dir);
    const srv = server(3);
    srv.put(2, { image_url: '/api/pos/device/products/2/image' });
    const db = new Database(':memory:');
    const pt = new PosThumbs({ db, dir: () => dir, fetch: async () => ({ status: 200, type: 'image/jpeg', bytes: jpeg(100) }), free: async () => null });
    const s = till({ srv, thumbs: pt, db });
    await s.till.sync();
    await vi.waitFor(() => expect(s.till.catalogue()!.products.find((p) => p.id === 2)?.thumb).toBe(true));
    expect(s.till.catalogue()!.products.find((p) => p.id === 1)?.thumb).toBeUndefined();
    expect(s.till.status().catalogue!.thumbs).toEqual({ count: 1, bytes: 100 });
  });
});

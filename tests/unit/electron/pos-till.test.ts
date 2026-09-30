import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { getPath: () => '/tmp', getVersion: () => '0.1.0' }, safeStorage: {} }));

import type { PosSale, PosSellInput } from '@shared/pos';
import { formatReceipt, posContract, saleFlags } from '@shared/pos';
import { DesktopError } from '../../../electron/main/errors';
import { Database } from '../../../electron/services/db';
import { apply, batch, nextSequence, readAnswer, saleBody, sequenceOf, type Queued } from '../../../electron/services/pos-outbox';
import type { DeviceAnswer, PosPairing } from '../../../electron/services/pos-desk';
import { catalogueOf, doorError, PosTill, productFromInventory, productFromPos, receiptOf, returnRef } from '../../../electron/services/pos-till';
import { Vault } from '../../../electron/services/vault';

const input = (over: Partial<PosSellInput> = {}): PosSellInput => ({
  session_id: 41,
  register_id: 3,
  currency: 'LKR',
  customer: { name: 'Nimal Perera', email: 'nimal@example.com' },
  lines: [{ product_id: 9, code: 'TEA-1', name: 'Ceylon tea 100g', quantity: 2, unit_price: 450, discount_pct: 0, tax_rate: 0, net: 900, tax: 0, total: 900 }],
  discount_pct: 0,
  totals: { subtotal: 900, discount: 0, tax: 0, total: 900 },
  tenders: [{ method: 'cash', amount: 1000 }],
  change_given: 100,
  priced_by: 'server',
  catalogue_version: 'v1',
  ...over,
});

let n = 0;
const queued = (over: Partial<PosSale> = {}): Queued => {
  n++;
  return { seq: n, sale: { ...input(), ref: `T1-AAAAAA-${String(n).padStart(6, '0')}`, created_at: '2026-09-30T08:00:00.000Z', terminal_id: 7, cashier_id: 5, cashier_name: 'Kasun', state: 'waiting', number: null, message: null, attempts: 0, sent_at: null, ...over } };
};

describe('POS outbox rules', () => {
  it('sends the till’s sale under its receipt number, with what the register half will need', () => {
    const q = queued();
    const b = saleBody(q.sale);
    expect(b).toMatchObject({
      ref: q.sale.ref,
      paid: true,
      currency: 'LKR',
      customer: { name: 'Nimal Perera', email: 'nimal@example.com' },
      subtotal: 900,
      total: 900,
      cashier_id: 5,
      session_id: 41,
      register_id: 3,
      tenders: [{ method: 'cash', amount: 1000 }],
      change_given: 100,
      offline: false,
    });
    expect((b.lines as unknown[])[0]).toEqual({ description: 'Ceylon tea 100g', sku: 'TEA-1', product_id: 9, quantity: 2, unit_price: 450, discount_pct: 0, tax_rate: 0, net: 900, tax: 0, total: 900 });
    expect(saleBody(queued({ customer: null, priced_by: 'estimate' }).sale)).toMatchObject({ offline: true });
    expect('customer' in saleBody(queued({ customer: null }).sale)).toBe(false);
  });

  it('sends waiting sales oldest first, a batch at a time, past a refused one', () => {
    const items = [queued(), queued({ state: 'refused' }), queued(), queued({ state: 'sent' }), ...Array.from({ length: 30 }, () => queued())];
    const b = batch([...items].reverse());
    expect(b).toHaveLength(25);
    expect(b[0]!.seq).toBe(items[0]!.seq);
    expect(b[1]!.seq).toBe(items[2]!.seq);
    expect(b.every((q) => q.sale.state === 'waiting')).toBe(true);
  });

  it('reads the device door’s codes', () => {
    expect(readAnswer(401, { message: 'Pair again.' })).toEqual({ kind: 'reauth', message: 'Pair again.' });
    expect(readAnswer(503, null).kind).toBe('off');
    // Where POS is switched on — WorkSuite's own sentence first, when it gives one.
    expect(readAnswer(503, null)).toEqual({ kind: 'off', message: 'POS is switched off on WorkSuite. An administrator turns it on in Admin Centre → Apps → POS.' });
    expect(readAnswer(503, { message: 'POS is switched off. An administrator turns it on in Admin Centre → Apps → POS.' })).toEqual({ kind: 'off', message: 'POS is switched off. An administrator turns it on in Admin Centre → Apps → POS.' });
    expect(doorError({ status: 503, body: null }, 'x').message).toMatch(/Admin Centre → Apps → POS/);
    expect(doorError({ status: 503, body: { message: 'Off here.' } }, 'x').message).toBe('Off here.');
    expect(readAnswer(500, null).kind).toBe('retry');
    expect(readAnswer(429, null).kind).toBe('retry');
    expect(readAnswer(413, { message: 'Too many.' })).toEqual({ kind: 'bad', message: 'Too many.' });
    expect(readAnswer(422, { results: [{ ref: 'A', status: 'rejected', message: 'No cashier.' }, { nope: 1 }] })).toEqual({ kind: 'results', results: [{ ref: 'A', status: 'rejected', number: null, message: 'No cashier.' }] });
  });

  it('folds the answers in: created and already-had are sent, refused keep the reason, unmentioned wait', () => {
    const [a, b, c, d] = [queued(), queued(), queued(), queued()];
    const r = apply(
      [a!, b!, c!, d!],
      [
        { ref: a!.sale.ref, status: 'created', number: 'SO-100', message: null },
        { ref: b!.sale.ref, status: 'duplicate', number: 'SO-99', message: null },
        { ref: c!.sale.ref, status: 'rejected', number: null, message: 'The cashier on this sale may not sell on POS.' },
      ],
      '2026-09-30T09:00:00Z',
    );
    expect(r.created).toBe(1);
    expect(r.duplicates).toBe(1);
    expect(r.updated.map((q) => q.sale.state)).toEqual(['sent', 'sent', 'refused', 'waiting']);
    expect(r.updated[0]!.sale).toMatchObject({ number: 'SO-100', sent_at: '2026-09-30T09:00:00Z' });
    expect(r.refused[0]!.message).toBe('The cashier on this sale may not sell on POS.');
    expect(r.updated[3]!.sale.attempts).toBe(1);
  });

  it('numbers receipts past anything already used', () => {
    expect(formatReceipt('T1-AAAAAA', 42)).toBe('T1-AAAAAA-000042');
    expect(nextSequence(0, 0)).toBe(1);
    expect(nextSequence(12, 3)).toBe(13);
    expect(nextSequence(2, 40)).toBe(41);
    expect(sequenceOf('T1-AAAAAA-000042', 'T1-AAAAAA')).toBe(42);
    expect(sequenceOf('T2-BBBBBB-000042', 'T1-AAAAAA')).toBe(0);
  });

  it('refuses a sale that names a price nowhere near a number, and any field it does not know', () => {
    expect(posContract['pos:sell'].input.safeParse(input()).success).toBe(true);
    expect(posContract['pos:sell'].input.safeParse({ ...input(), cashier_id: 1 }).success).toBe(false);
    expect(posContract['pos:sell'].input.safeParse({ ...input(), lines: [] }).success).toBe(false);
    expect(posContract['pos:sell'].input.safeParse({ ...input(), tenders: [{ method: 'cheque', amount: 5 }] }).success).toBe(false);
  });
});

/* ── The service ───────────────────────────────────────────────────────── */

type Door = (path: 'heartbeat' | 'sales', body: unknown) => Promise<DeviceAnswer>;
type AnyDoor = (method: 'GET' | 'POST', path: string, o?: { body?: unknown; query?: Record<string, unknown> }) => Promise<DeviceAnswer>;

function service(o: { door?: Door; other?: AnyDoor; request?: (m: string, p: string, opts?: unknown) => Promise<unknown>; keep?: boolean; queue?: 'allowed' | 'disabled'; usable?: boolean } = {}) {
  const db = new Database(':memory:');
  const vault = new Vault(Vault.generateKey());
  const sent: Array<{ path: string; body: { sales?: Array<{ ref: string }> } }> = [];
  let now = Date.parse('2026-09-30T08:00:00Z');
  const pairing: PosPairing = { terminal: { id: 7, code: 'T1', name: 'Front till', org_id: 3, org_name: null, branch_name: null, warehouse_id: 4, warehouse_name: null }, paired_at: '2026-09-30T07:00:00Z', prefix: 'T1-AAAAAA', state: 'paired', usable: o.usable ?? true };
  const created: Door = async (path, body) => {
    const b = body as { sales?: Array<{ ref: string }> };
    return path === 'heartbeat' ? { status: 200, body: { status: 'success' } } : { status: 200, body: { results: (b.sales ?? []).map((s, i) => ({ ref: s.ref, status: 'created', number: `SO-${i + 1}`, message: null })) } };
  };
  const door = vi.fn(async (path: 'heartbeat' | 'sales', body: unknown) => {
    sent.push({ path, body: body as never });
    return (o.door ?? created)(path, body);
  });
  const changed = vi.fn();
  // The door's other calls (catalogue, receipt, refund, void, e-mail); an older server has none of them.
  const other = vi.fn(o.other ?? (async () => ({ status: 404, body: { message: 'Not found' } })));
  const till = new PosTill({
    db,
    vault: () => vault,
    http: { request: vi.fn(o.request ?? (async () => ({}))) } as never,
    desk: { pairing: () => pairing, device: door, heartbeat: (pending: number) => door('heartbeat', { pending_count: pending }), door: other as never },
    origin: () => 'https://ws.example',
    caps: () => ({ offlineCache: o.keep ?? true, offlineQueue: o.queue ?? 'allowed' }),
    changed,
    now: () => now,
  });
  return { db, vault, till, sent, door, other, changed, tick: (ms: number) => (now += ms) };
}

const cashier = { id: 5, name: 'Kasun' };
const offline: Door = async () => {
  throw new DesktopError('NETWORK_UNREACHABLE', 'Cannot reach WorkSuite server.');
};

describe('POS till: selling, keeping and sending', () => {
  it('numbers each sale, seals it, and sends it at once', async () => {
    const { till, db, sent } = service();
    const a = await till.sell(input(), cashier);
    const b = await till.sell(input(), cashier);

    expect(a.sale.ref).toBe('T1-AAAAAA-000001');
    expect(b.sale.ref).toBe('T1-AAAAAA-000002');
    expect(a).toMatchObject({ queued: false, sale: { state: 'sent', number: 'SO-1', cashier_id: 5, cashier_name: 'Kasun', terminal_id: 7 } });
    expect(sent.filter((s) => s.path === 'sales').map((s) => s.body.sales!.map((x) => x.ref))).toEqual([['T1-AAAAAA-000001'], ['T1-AAAAAA-000002']]);
    // What was sold, and to whom, is ciphertext on disk.
    const raw = JSON.stringify(db.all('SELECT * FROM pos_sales'));
    expect(raw).not.toContain('Nimal');
    expect(raw).not.toContain('Ceylon tea');
    expect(till.sales().map((s) => s.ref)).toEqual(['T1-AAAAAA-000002', 'T1-AAAAAA-000001']);
  });

  it('keeps selling with WorkSuite out of reach, and sends in order, once, when it is back', async () => {
    let door: Door = offline;
    const s = service({ door: (p, b) => door(p, b) });
    const first = await s.till.sell(input(), cashier);
    const second = await s.till.sell(input({ priced_by: 'estimate' }), cashier);
    expect(first).toMatchObject({ queued: true, sale: { state: 'waiting' } });
    expect(second.queued).toBe(true);
    expect(s.till.status()).toMatchObject({ waiting: 2, reachable: false });

    // Back: the first answer is lost after WorkSuite recorded the sales, so they go again and come back "already had".
    let calls = 0;
    door = async (path, body) => {
      if (path === 'heartbeat') return { status: 200, body: {} };
      calls++;
      const refs = (body as { sales: Array<{ ref: string }> }).sales.map((x) => x.ref);
      if (calls === 1) throw new DesktopError('NETWORK_UNREACHABLE', 'lost');
      return { status: 200, body: { results: refs.map((ref) => ({ ref, status: 'duplicate', number: 'SO-7', message: null })) } };
    };
    await s.till.sync();
    expect(s.till.status().waiting).toBe(2);
    await s.till.sync();
    expect(s.till.status()).toMatchObject({ waiting: 0, refused: 0, reachable: true });
    const batches = s.sent.filter((x) => x.path === 'sales' && x.body.sales).map((x) => x.body.sales!.map((y) => y.ref));
    expect(batches.at(-1)).toEqual(['T1-AAAAAA-000001', 'T1-AAAAAA-000002']);
  });

  it('takes back a sale WorkSuite refuses while the customer is still there', async () => {
    const { till } = service({ door: async (p, b) => (p === 'heartbeat' ? { status: 200, body: {} } : { status: 422, body: { results: [{ ref: (b as { sales: Array<{ ref: string }> }).sales[0]!.ref, status: 'rejected', message: 'The cashier on this sale may not sell on POS.' }] } }) });
    await expect(till.sell(input(), cashier)).rejects.toMatchObject({ code: 'CONFLICT', message: 'The cashier on this sale may not sell on POS.' });
    expect(till.sales()).toEqual([]);
    // The number is not used again.
    await expect(till.sell(input(), cashier)).rejects.toBeInstanceOf(DesktopError);
    expect((till as unknown as { d: { db: Database } }).d.db.get<{ last: number }>('SELECT last FROM pos_counters')?.last).toBe(2);
  });

  it('keeps a sale refused later with the reason, to send again or drop', async () => {
    let door: Door = offline;
    const s = service({ door: (p, b) => door(p, b) });
    const { sale } = await s.till.sell(input(), cashier);
    door = async (p, b) => (p === 'heartbeat' ? { status: 200, body: {} } : { status: 422, body: { results: (b as { sales: Array<{ ref: string }> }).sales.map((x) => ({ ref: x.ref, status: 'rejected', message: 'That register was closed.' })) } });
    await s.till.sync();
    expect(s.till.sale(sale.ref)).toMatchObject({ state: 'refused', message: 'That register was closed.' });
    expect(s.till.status().refused).toBe(1);

    door = async (p, b) => (p === 'heartbeat' ? { status: 200, body: {} } : { status: 200, body: { results: (b as { sales: Array<{ ref: string }> }).sales.map((x) => ({ ref: x.ref, status: 'created', number: 'SO-3' })) } });
    await s.till.resolve(sale.ref, 'retry');
    expect(s.till.sale(sale.ref)).toMatchObject({ state: 'sent', number: 'SO-3' });
    await expect(s.till.resolve(sale.ref, 'drop')).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('keeps a sale refused for its drawer with the code, and sends it again only into the register open now', async () => {
    let door: Door = offline;
    const s = service({ door: (p, b) => door(p, b) });
    const { sale } = await s.till.sell(input(), cashier);
    const closed = 'That register was closed before this sale was made. Open a register and send the sale again, or record it on the web.';
    door = async (p, b) => (p === 'heartbeat' ? { status: 200, body: {} } : { status: 422, body: { results: (b as { sales: Array<{ ref: string }> }).sales.map((x) => ({ ref: x.ref, status: 'rejected', code: 'drawer_closed', message: closed })) } });
    await s.till.sync();
    expect(s.till.sale(sale.ref)).toMatchObject({ state: 'refused', code: 'drawer_closed', message: closed, session_id: 41 });

    // Without a register open here, sending it again would only be refused again.
    await expect(s.till.resolve(sale.ref, 'retry')).rejects.toMatchObject({ code: 'CONFLICT', message: expect.stringMatching(/Open the register/) });

    door = async (p, b) => (p === 'heartbeat' ? { status: 200, body: {} } : { status: 200, body: { results: (b as { sales: Array<{ ref: string }> }).sales.map((x) => ({ ref: x.ref, status: 'created', number: 'SO-4' })) } });
    await s.till.resolve(sale.ref, 'retry', 52);
    const last = s.sent.filter((x) => x.path === 'sales').at(-1)!.body.sales![0] as unknown as { session_id: number };
    expect(last.session_id).toBe(52);
    expect(s.till.sale(sale.ref)).toMatchObject({ state: 'sent', number: 'SO-4', session_id: 52, code: null });
    expect(s.till.sales({ session_id: 52 }).map((x) => x.ref)).toEqual([sale.ref]);
  });

  it('drops a sale refused because its session is another till’s', async () => {
    let door: Door = offline;
    const s = service({ door: (p, b) => door(p, b) });
    const { sale } = await s.till.sell(input(), cashier);
    door = async (p, b) => (p === 'heartbeat' ? { status: 200, body: {} } : { status: 422, body: { results: (b as { sales: Array<{ ref: string }> }).sales.map((x) => ({ ref: x.ref, status: 'rejected', code: 'session_not_here', message: 'The register session this sale names is not at this till.' })) } });
    await s.till.sync();
    expect(s.till.sale(sale.ref)).toMatchObject({ state: 'refused', code: 'session_not_here' });
    await s.till.resolve(sale.ref, 'drop');
    expect(s.till.sale(sale.ref)).toBeNull();
  });

  it('stops sending when the credential is refused, and loses nothing', async () => {
    let door: Door = offline;
    const s = service({ door: (p, b) => door(p, b) });
    await s.till.sell(input(), cashier);
    door = async () => ({ status: 401, body: { message: 'Pair again.', reauth: true } });
    await s.till.sync();
    expect(s.till.status().waiting).toBe(1);
  });

  it('refuses to sell for a till WorkSuite no longer accepts, and offline where the policy keeps nothing', async () => {
    await expect(service({ usable: false }).till.sell(input(), cashier)).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    const s = service({ door: offline, queue: 'disabled' });
    // The first sale finds WorkSuite gone: it is kept (money was taken), never thrown away.
    expect((await s.till.sell(input(), cashier)).queued).toBe(true);
    await expect(s.till.sell(input(), cashier)).rejects.toMatchObject({ code: 'POLICY_DENIED' });
  });

  it('never reuses a receipt number, even after sales are removed', async () => {
    const s = service();
    await s.till.sell(input(), cashier);
    await s.till.sell(input(), cashier);
    s.db.run('DELETE FROM pos_sales');
    expect((await s.till.sell(input(), cashier)).sale.ref).toBe('T1-AAAAAA-000003');
    s.db.run('DELETE FROM pos_counters');
    expect((await s.till.sell(input(), cashier)).sale.ref).toBe('T1-AAAAAA-000004');
  });

  it('lists a session’s sales, and forgets a till’s sales and copy', async () => {
    const s = service();
    await s.till.sell(input({ session_id: 1 }), cashier);
    await s.till.sell(input({ session_id: 2 }), cashier);
    expect(s.till.sales({ session_id: 2 })).toHaveLength(1);
    s.till.forgetTill('https://ws.example', 7);
    expect(s.till.sales()).toEqual([]);
  });
});

describe('POS till: the catalogue', () => {
  const posAnswer = { version: 'abc', currency: 'LKR', truncated: false, categories: [{ id: '2', name: 'Tea' }], products: [{ id: '9', code: 'TEA-1', barcode: '4790001', name: 'Ceylon tea', unit: 'pkt', category_id: '2', price: 450, discount_pct: 5, tax_rate: 18 }] };

  it('reads WorkSuite’s till catalogue, keeps it sealed, and asks with its version next time', async () => {
    const request = vi.fn(async (_m: string, _p: string, opts?: unknown) => ((opts as { query: { since_version?: string } }).query.since_version === 'abc' ? { version: 'abc', unchanged: true } : posAnswer));
    const s = service({ request });
    const c = await s.till.refreshCatalogue();
    expect(c).toMatchObject({ version: 'abc', source: 'pos', currency: 'LKR', categories: ['Tea'] });
    expect(c.products[0]).toEqual({ id: 9, code: 'TEA-1', barcode: '4790001', name: 'Ceylon tea', unit: 'pkt', category: 'Tea', price: 450, discount_pct: 5, tax_rate: 18 });
    expect(JSON.stringify(s.db.all('SELECT * FROM pos_catalogue'))).not.toContain('Ceylon');
    s.tick(60_000);
    const again = await s.till.refreshCatalogue();
    // The till's company, and the version it holds; POS's own catalogue needs no Inventory permission.
    expect(request.mock.calls[0]![2]).toEqual({ query: { org: 3, since_version: undefined } });
    expect(request.mock.calls[1]![2]).toEqual({ query: { org: 3, since_version: 'abc' } });
    expect(again.products).toHaveLength(1);
    expect(again.fetched_at).toBe('2026-09-30T08:01:00.000Z');
  });

  it('falls back to Inventory’s list where the server has no till catalogue', async () => {
    const request = vi.fn(async (_m: string, path: string) => {
      if (path === '/api/pos/catalogue') throw new DesktopError('NOT_FOUND', 'Not found', 404);
      return { total: 2, products: [{ id: 3, code: 'A', barcode: null, name: 'Mug', variant_label: 'Blue', unit_price: 1200, tax_rate: 0, kind: 'product', active: true, category: 'Kitchen' }, { id: 4, name: 'Shirt', kind: 'variable' }] };
    });
    const c = await service({ request }).till.refreshCatalogue();
    expect(c).toMatchObject({ source: 'inventory', truncated: false, categories: ['Kitchen'] });
    expect(c.products).toEqual([{ id: 3, code: 'A', barcode: null, name: 'Mug — Blue', unit: null, category: 'Kitchen', price: 1200, discount_pct: 0, tax_rate: 0 }]);
  });

  it('goes straight to Inventory on a server that says it has no till catalogue, and never there on one that has', async () => {
    const request = vi.fn(async (_m: string, path: string) => {
      if (path === '/api/pos/catalogue') throw new DesktopError('NOT_FOUND', 'Not found', 404);
      return { total: 1, products: [{ id: 3, name: 'Mug', unit_price: 5, kind: 'product' }] };
    });
    const s = service({ request });
    expect((await s.till.refreshCatalogue(false)).source).toBe('inventory');
    expect(request.mock.calls.map((c) => c[1])).toEqual(['/api/inventory/products']);
    await expect(s.till.refreshCatalogue(true)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('refreshes through the till’s door in the background, with nobody signed in, every half hour', async () => {
    const other = vi.fn<AnyDoor>(async (_m, path, o) => (path === 'catalogue' ? { status: 200, body: o?.query?.since_version === 'abc' ? { status: 'success', version: 'abc', unchanged: true } : { status: 'success', ...posAnswer } } : { status: 404, body: null }));
    const request = vi.fn(async () => {
      throw new DesktopError('NOT_SIGNED_IN', 'No session');
    });
    const s = service({ other, request });
    await s.till.sync();
    expect(s.till.catalogue()).toMatchObject({ version: 'abc', source: 'pos', products: [{ id: 9, category: 'Tea' }] });
    expect(request).not.toHaveBeenCalled();
    await s.till.sync();
    expect(other).toHaveBeenCalledTimes(1);
    s.tick(31 * 60_000);
    await s.till.sync();
    expect(other).toHaveBeenCalledTimes(2);
    expect(other.mock.calls[1]![2]).toEqual({ query: { since_version: 'abc' } });
    expect(s.till.catalogue()?.fetched_at).toBe('2026-09-30T08:31:00.000Z');
  });

  it('leaves the copy alone where the door has no catalogue (an older server)', async () => {
    const s = service({ request: async () => posAnswer });
    await s.till.refreshCatalogue();
    await s.till.sync();
    expect(s.till.catalogue()?.version).toBe('abc');
    expect(catalogueOf({ unchanged: true, version: 'x' }, null, 'now')).toBeNull();
  });

  it('says so when neither is readable', async () => {
    const request = vi.fn(async (_m: string, path: string) => {
      throw path === '/api/pos/catalogue' ? new DesktopError('NOT_FOUND', 'x', 404) : new DesktopError('PERMISSION_DENIED', 'x', 403);
    });
    await expect(service({ request }).till.refreshCatalogue()).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('keeps it in memory only where the policy keeps nothing on disk', async () => {
    const s = service({ request: async () => posAnswer, keep: false });
    await s.till.refreshCatalogue();
    expect(s.db.all('SELECT * FROM pos_catalogue')).toEqual([]);
    expect(s.till.catalogue()?.products).toHaveLength(1);
  });

  it('maps both shapes, and skips what cannot be sold', () => {
    expect(productFromPos({ id: 'x' }, new Map())).toBeNull();
    expect(productFromInventory({ id: 1, name: 'Gone', active: false })).toBeNull();
  });
});

describe('POS till: after the sale', () => {
  const sold = async (other?: AnyDoor) => {
    const s = service({ other });
    const { sale } = await s.till.sell(input({ lines: [...input().lines, { product_id: 3, code: 'MUG', name: 'Mug', quantity: 1, unit_price: 100, discount_pct: 0, tax_rate: 0, net: 100, tax: 0, total: 100 }] }), cashier);
    return { ...s, sale };
  };
  const refundAnswer = (ref: string, over: Record<string, unknown> = {}) => ({
    status: 201,
    body: {
      status: 'success',
      message: 'Refunded.',
      refund: { ref, kind: 'refund', status: 'done', amount: 900, cash_out: 900, restocked: true, lines: [{ line_id: 1, product_id: 9, quantity: 2 }], tenders: [{ method: 'cash', amount: 900 }], credit_note: { number: 'CN-4', status: 'issued' }, reason: 'Damaged', session_id: 41, created_at: '2026-09-30 08:05:00', ...over },
      sale: { id: 12, ref: 'x', total: 1000, voided: false, review: null },
    },
  });

  it('keeps WorkSuite’s total and its review flag on a sale it priced differently', () => {
    const v = readAnswer(200, { results: [{ ref: 'A', status: 'created', number: 'SO-1', total: 880, review: 'The till charged 900.00; WorkSuite priced it 880.00.' }] });
    expect(v).toMatchObject({ kind: 'results', results: [{ ref: 'A', total: 880, review: 'The till charged 900.00; WorkSuite priced it 880.00.' }] });
    const q = queued();
    const r = apply([q], [{ ref: q.sale.ref, status: 'created', number: 'SO-1', message: null, total: 880, review: 'Differs' }], 'now');
    expect(r.updated[0]!.sale).toMatchObject({ state: 'sent', server_total: 880, review: 'Differs' });
  });

  it('keeps WorkSuite’s flags on a sale — a late one, one with its payment missing — and drops codes it does not know', () => {
    const v = readAnswer(200, { results: [{ ref: 'A', status: 'created', number: 'SO-1', review: 'Sold while register session 41 was open.', flags: ['late', 'late', 'nonsense', 3] }] });
    expect(v).toMatchObject({ kind: 'results', results: [{ ref: 'A', flags: ['late'] }] });
    const q = queued();
    const r = apply([q], [{ ref: q.sale.ref, status: 'created', number: 'SO-1', message: null, review: 'Payment missing.', flags: ['payment_missing'] }], 'now');
    expect(r.updated[0]!.sale).toMatchObject({ state: 'sent', flags: ['payment_missing'], code: null });
    expect(saleFlags(r.updated[0]!.sale)).toEqual(['payment_missing']);
    // An older server said only `review`: that was the price.
    expect(saleFlags({ review: 'Differs' })).toEqual(['price_differs']);
    expect(saleFlags({})).toEqual([]);
    expect(readAnswer(422, { results: [{ ref: 'B', status: 'rejected', code: 'drawer_closed', message: 'No register is open here.' }] })).toEqual({
      kind: 'results',
      results: [{ ref: 'B', status: 'rejected', number: null, message: 'No register is open here.', code: 'drawer_closed' }],
    });
  });

  it('reads a receipt WorkSuite recorded with its payment missing', () => {
    const r = receiptOf({ receipt_no: 'T1-AAAAAA-000001', lines: [], totals: { total: 450 }, status: 'payment_missing', payment_missing: true });
    expect(r).toMatchObject({ status: 'payment_missing', payment_missing: true });
    expect(receiptOf({ receipt_no: 'T1-AAAAAA-000001', lines: [], status: 'paid' })).toMatchObject({ payment_missing: false });
  });

  it('refunds some lines through the door with the cashier named, under the till’s own number, and keeps the answer', async () => {
    const other = vi.fn<AnyDoor>(async (_m, _p, o) => refundAnswer(String((o?.body as { ref: string }).ref)));
    const s = await sold(other);
    const r = await s.till.giveBack({ ref: s.sale.ref, kind: 'refund', reason: 'Damaged', lines: [{ product_id: 9, quantity: 2 }] }, { id: 5 });
    expect(other.mock.calls[0]!.slice(0, 2)).toEqual(['POST', `sales/${s.sale.ref}/refund`]);
    expect(other.mock.calls[0]![2]).toEqual({ body: { ref: `${s.sale.ref}-R1`, cashier_id: 5, reason: 'Damaged', lines: [{ product_id: 9, quantity: 2 }] } });
    expect(r.refund).toMatchObject({ ref: `${s.sale.ref}-R1`, amount: 900, cash_out: 900, tenders: [{ method: 'cash', amount: 900 }], credit_note: 'CN-4', lines: [{ product_id: 9, quantity: 2 }] });
    expect(s.till.sale(s.sale.ref)).toMatchObject({ returns: [{ ref: `${s.sale.ref}-R1` }], voided: false, server_total: 1000 });
    // The next refund is a new one.
    await s.till.giveBack({ ref: s.sale.ref, kind: 'refund', reason: 'Changed mind' }, { id: 5 });
    expect((other.mock.calls[1]![2]!.body as { ref: string; lines?: unknown }).ref).toBe(`${s.sale.ref}-R2`);
    expect('lines' in (other.mock.calls[1]![2]!.body as object)).toBe(false);
  });

  it('sends a refund whose answer was lost again as the same refund', async () => {
    let lose = true;
    const other = vi.fn<AnyDoor>(async (_m, _p, o) => {
      if (lose) {
        lose = false;
        throw new DesktopError('NETWORK_UNREACHABLE', 'lost');
      }
      return refundAnswer(String((o?.body as { ref: string }).ref));
    });
    const s = await sold(other);
    await expect(s.till.giveBack({ ref: s.sale.ref, kind: 'refund', reason: 'Damaged' }, { id: 5 })).rejects.toMatchObject({ code: 'NETWORK_UNREACHABLE' });
    await s.till.giveBack({ ref: s.sale.ref, kind: 'refund', reason: 'Damaged' }, { id: 5 });
    expect(other.mock.calls.map((c) => (c[2]!.body as { ref: string }).ref)).toEqual([`${s.sale.ref}-R1`, `${s.sale.ref}-R1`]);
    expect(s.till.sale(s.sale.ref)?.returns).toHaveLength(1);
  });

  it('voids in the sale’s session, and refuses what WorkSuite refuses, with its sentence', async () => {
    const answers: DeviceAnswer[] = [
      { status: 403, body: { status: 'error', message: 'Kasun may not void a sale.' } },
      { status: 422, body: { status: 'error', message: 'That session has closed; refund the sale instead.', code: 'session_closed' } },
      { status: 201, body: { status: 'success', message: 'Voided.', refund: { ref: 'x-V', kind: 'void', amount: 1000, cash_out: 1000, tenders: [{ method: 'cash', amount: 1000 }], lines: [] }, sale: { voided: true, total: 1000 } } },
    ];
    const other = vi.fn<AnyDoor>(async () => answers.shift()!);
    const s = await sold(other);
    await expect(s.till.giveBack({ ref: s.sale.ref, kind: 'void', reason: 'Wrong till' }, { id: 5 })).rejects.toMatchObject({ code: 'PERMISSION_DENIED', message: 'Kasun may not void a sale.' });
    await expect(s.till.giveBack({ ref: s.sale.ref, kind: 'void', reason: 'Wrong till' }, { id: 5 })).rejects.toMatchObject({ code: 'CONFLICT', message: 'That session has closed; refund the sale instead.' });
    const r = await s.till.giveBack({ ref: s.sale.ref, kind: 'void', reason: 'Wrong till', lines: [{ product_id: 9, quantity: 1 }] }, { id: 5 });
    expect(other.mock.calls[2]![2]).toEqual({ body: { ref: `${s.sale.ref}-V`, cashier_id: 5, reason: 'Wrong till' } });
    expect(r.sale.voided).toBe(true);
    await expect(s.till.giveBack({ ref: s.sale.ref, kind: 'refund', reason: 'Again' }, { id: 5 })).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('gives nothing back for a sale WorkSuite does not have yet', async () => {
    const s = service({ door: offline });
    const { sale } = await s.till.sell(input(), cashier);
    await expect(s.till.giveBack({ ref: sale.ref, kind: 'refund', reason: 'Damaged' }, { id: 5 })).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(s.till.serverReceipt(sale.ref)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(returnRef({ ...sale, returns: [] }, 'refund')).toBe(`${sale.ref}-R1`);
  });

  it('reads WorkSuite’s receipt and e-mails it through the door', async () => {
    const receipt = { receipt_no: 'T1-AAAAAA-000001', order_number: 'SO-1', invoice_number: 'INV-9', company: { name: 'Acme' }, cashier: 'Kasun', at: '2026-09-30 13:30', currency: 'LKR', lines: [{ description: 'Ceylon tea', quantity: 2, unit_price: 440, discount_pct: 0, amount: 880, tax: 0, total: 880 }], taxes: [], totals: { subtotal: 880, discount: 0, tax: 0, total: 880 }, tenders: [{ method: 'cash', label: 'Cash', amount: 880 }], change: 120, refunds: [], refunded: 0, status: 'paid', footer: 'Thank you' };
    const other = vi.fn<AnyDoor>(async (_m, path) => (path.endsWith('/receipt') ? { status: 200, body: { status: 'success', receipt } } : { status: 200, body: { status: 'success', message: 'The receipt was sent to nimal@example.com.' } }));
    const s = await sold(other);
    expect(await s.till.serverReceipt(s.sale.ref)).toMatchObject({ receipt_no: 'T1-AAAAAA-000001', invoice_number: 'INV-9', totals: { total: 880 }, tenders: [{ label: 'Cash', amount: 880 }], change: 120 });
    expect(await s.till.email(s.sale.ref, 'nimal@example.com')).toEqual({ message: 'The receipt was sent to nimal@example.com.' });
    expect(other.mock.calls[1]).toEqual(['POST', `sales/${s.sale.ref}/email`, { body: { email: 'nimal@example.com' } }]);
    expect(receiptOf({ lines: [] })).toBeNull();
  });
});

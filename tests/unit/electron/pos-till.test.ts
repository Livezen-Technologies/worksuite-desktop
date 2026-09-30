import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { getPath: () => '/tmp', getVersion: () => '0.1.0' }, safeStorage: {} }));

import type { PosSale, PosSellInput } from '@shared/pos';
import { formatReceipt, posContract } from '@shared/pos';
import { DesktopError } from '../../../electron/main/errors';
import { Database } from '../../../electron/services/db';
import { apply, batch, nextSequence, readAnswer, saleBody, sequenceOf, type Queued } from '../../../electron/services/pos-outbox';
import type { DeviceAnswer, PosPairing } from '../../../electron/services/pos-desk';
import { PosTill, productFromInventory, productFromPos } from '../../../electron/services/pos-till';
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

function service(o: { door?: Door; request?: (m: string, p: string, opts?: unknown) => Promise<unknown>; keep?: boolean; queue?: 'allowed' | 'disabled'; usable?: boolean } = {}) {
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
  const till = new PosTill({
    db,
    vault: () => vault,
    http: { request: vi.fn(o.request ?? (async () => ({}))) } as never,
    desk: { pairing: () => pairing, device: door, heartbeat: (pending: number) => door('heartbeat', { pending_count: pending }) },
    origin: () => 'https://ws.example',
    caps: () => ({ offlineCache: o.keep ?? true, offlineQueue: o.queue ?? 'allowed' }),
    changed,
    now: () => now,
  });
  return { db, vault, till, sent, door, changed, tick: (ms: number) => (now += ms) };
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
    const request = vi.fn(async (_m: string, _p: string, opts?: unknown) => ((opts as { query: { version?: string } }).query.version === 'abc' ? { version: 'abc', unchanged: true } : posAnswer));
    const s = service({ request });
    const c = await s.till.refreshCatalogue();
    expect(c).toMatchObject({ version: 'abc', source: 'pos', currency: 'LKR', categories: ['Tea'] });
    expect(c.products[0]).toEqual({ id: 9, code: 'TEA-1', barcode: '4790001', name: 'Ceylon tea', unit: 'pkt', category: 'Tea', price: 450, discount_pct: 5, tax_rate: 18 });
    expect(JSON.stringify(s.db.all('SELECT * FROM pos_catalogue'))).not.toContain('Ceylon');
    s.tick(60_000);
    const again = await s.till.refreshCatalogue();
    expect(request.mock.calls[1]![2]).toEqual({ query: { version: 'abc' } });
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

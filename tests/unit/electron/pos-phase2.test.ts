import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { getPath: () => '/tmp', getVersion: () => '0.1.0' }, safeStorage: {}, BrowserWindow: class {} }));

import { posContract, receiptTemplateOf, tenderOptionsOf, type PosReceiptTemplate, type PosSale, type PosSellInput, type PosServerReceipt } from '@shared/pos';
import { Database } from '../../../electron/services/db';
import type { DeviceAnswer, PosPairing } from '../../../electron/services/pos-desk';
import { apply, phase2Pricing, readAnswer, saleBody, type Queued } from '../../../electron/services/pos-outbox';
import { COLUMNS, docOfSale, escpos, fillFields, paperOf, PosPrint, qrBytes, receiptRows, serverReceiptRows, templateRows } from '../../../electron/services/pos-print';
import { catalogueOf, deskCall, PosTill } from '../../../electron/services/pos-till';
import { Vault } from '../../../electron/services/vault';

/* ── What the till sends ─────────────────────────────────────────────── */

const input = (over: Partial<PosSellInput> = {}): PosSellInput => ({
  session_id: 41,
  register_id: 3,
  currency: 'LKR',
  customer: null,
  lines: [{ product_id: 9, code: 'TEA-1', name: 'Ceylon tea 100g', quantity: 2, unit_price: 450, discount_pct: 0, tax_rate: 0, net: 900, tax: 0, total: 900 }],
  discount_pct: 0,
  totals: { subtotal: 900, discount: 0, tax: 0, total: 900 },
  tenders: [{ method: 'cash', amount: 1000 }],
  change_given: 100,
  priced_by: 'server',
  catalogue_version: 'v1',
  ...over,
});

const sale = (over: Partial<PosSale> = {}): PosSale => ({ ...input(), ref: 'T1-AAAAAA-000001', created_at: '2026-09-30T08:00:00.000Z', terminal_id: 7, cashier_id: 5, cashier_name: 'Kasun', state: 'waiting', number: null, message: null, attempts: 0, sent_at: null, ...over });

describe('POS phase 2: what a sale says of its pricing', () => {
  it('sends nothing new for a sale that carries nothing new (an older server reads exactly what it did)', () => {
    const b = saleBody(sale());
    for (const k of ['customer_id', 'apply_promotions', 'promotion_ids', 'coupon_code', 'redeem_points', 'approval_id', 'discount_pct']) expect(k in b).toBe(false);
  });

  it('priced offline: the promotions the till applied, none — never "apply", a coupon or points', () => {
    const s = sale({ priced_by: 'estimate', promotion_ids: [], apply_promotions: true, coupon_code: 'POYA15', redeem_points: 50, customer_id: 42 });
    expect(phase2Pricing(s)).toEqual({ promotion_ids: [] });
    expect(saleBody(s)).toMatchObject({ offline: true, promotion_ids: [], customer_id: 42 });
    expect('apply_promotions' in saleBody(s)).toBe(false);
    expect('redeem_points' in saleBody(s)).toBe(false);
  });

  it('priced by WorkSuite: its promotions asked for, the coupon, the points of the named customer, the approval', () => {
    const s = sale({ apply_promotions: true, coupon_code: 'POYA15', redeem_points: 50, customer_id: 42, approval_id: 'apv_0123456789abcdef', customer: { id: 42, name: 'Ruwan', tier: 'Gold', points: 2340, phone: '0771234567' } });
    expect(saleBody(s)).toMatchObject({ apply_promotions: true, coupon_code: 'POYA15', redeem_points: 50, customer_id: 42, approval_id: 'apv_0123456789abcdef' });
    // The discount is the whole deduction (promotions, points): the cashier's percentage is said outright.
    expect(saleBody({ ...s, discount_pct: 5, totals: { subtotal: 1350, discount: 217.5, tax: 0, total: 1132.5 } })).toMatchObject({ discount_pct: 5, discount: 217.5 });
    // The customer named as before — the tier and points are the screen's, not WorkSuite's.
    expect(saleBody(s).customer).toEqual({ name: 'Ruwan', phone: '0771234567' });
    expect(phase2Pricing({ ...s, customer_id: undefined })).not.toHaveProperty('redeem_points');
  });

  it('checks the new fields at the IPC door', () => {
    const sell = posContract['pos:sell'].input;
    expect(sell.safeParse(input({ promotion_ids: [], customer_id: 42, approval_id: 'apv_0123456789abcdef' })).success).toBe(true);
    expect(sell.safeParse(input({ approval_id: 'not-a-token' })).success).toBe(false);
    expect(sell.safeParse(input({ tenders: [{ method: 'voucher', amount: 900, reference: 'GV-AB12' }] })).success).toBe(true);
    expect(posContract['pos:approve'].input.safeParse({ approver_id: 3, pin: '4821', action: 'discount', amount: 15 }).success).toBe(true);
    expect(posContract['pos:approve'].input.safeParse({ approver_id: 3, pin: '48', action: 'discount', amount: 15 }).success).toBe(false);
    expect(posContract['pos:desk'].input.safeParse({ op: 'park', lines: [{ product_id: 9, quantity: 1 }], cashier_id: 1 }).success).toBe(false);
  });

  it('reads an approval asked for, and the points, from the door’s answer; a sale taken keeps no approval', () => {
    const v = readAnswer(422, { results: [{ ref: 'A', status: 'rejected', message: 'A discount of 15% needs a manager’s approval (over 10%).', code: 'approval_required', approval: { action: 'discount', amount: 15, threshold: 10, subject: 'A' } }] });
    expect(v).toEqual({ kind: 'results', results: [{ ref: 'A', status: 'rejected', number: null, message: 'A discount of 15% needs a manager’s approval (over 10%).', code: 'approval_required', approval: { action: 'discount', amount: 15, threshold: 10, subject: 'A' } }] });
    const q: Queued = { seq: 1, sale: sale({ approval_id: 'apv_0123456789abcdef', customer_id: 42, customer: { id: 42, name: 'Ruwan', points: 2340, tier: 'Gold' } }) };
    const done = apply([q], [{ ref: q.sale.ref, status: 'created', number: 'SO-1', message: null, loyalty: { customer_id: 42, earned: 16, redeemed: 100 } }], '2026-09-30T08:00:01Z');
    // The balance after it: the card's, less what was spent, plus what was earned; the tier the card said.
    expect(done.updated[0]!.sale).toMatchObject({ state: 'sent', loyalty: { customer_id: 42, earned: 16, redeemed: 100, balance: 2256, tier: 'Gold' } });
    expect(done.updated[0]!.sale.approval_id).toBeUndefined();
  });
});

/* ── The door ─────────────────────────────────────────────────────────── */

type AnyDoor = (method: 'GET' | 'POST', path: string, o?: { body?: unknown; query?: Record<string, unknown> }) => Promise<DeviceAnswer>;

function service(o: { sales?: (body: { sales: Array<Record<string, unknown>> }) => DeviceAnswer; other?: AnyDoor } = {}) {
  const db = new Database(':memory:');
  const vault = new Vault(Vault.generateKey());
  const cfg = new Map<string, unknown>();
  const pairing: PosPairing = { terminal: { id: 7, code: 'T1', name: 'Front till', org_id: 3, org_name: 'Acme', branch_name: null, warehouse_id: 4, warehouse_name: null }, paired_at: '2026-09-30T07:00:00Z', prefix: 'T1-AAAAAA', state: 'paired', usable: true };
  const sent: Array<Record<string, unknown>> = [];
  const device = vi.fn(async (path: 'heartbeat' | 'sales', body: unknown) => {
    if (path === 'heartbeat') return { status: 200, body: { status: 'success' } };
    const b = body as { sales: Array<Record<string, unknown>> };
    sent.push(...b.sales);
    return o.sales ? o.sales(b) : { status: 200, body: { results: b.sales.map((s) => ({ ref: s.ref, status: 'created', number: 'SO-1', message: null })) } };
  });
  const other = vi.fn(o.other ?? (async () => ({ status: 404, body: null })));
  const till = new PosTill({
    db,
    vault: () => vault,
    http: { request: vi.fn(async () => ({})) } as never,
    desk: { pairing: () => pairing, device, heartbeat: () => device('heartbeat', {}), door: other as never },
    origin: () => 'https://ws.example',
    caps: () => ({ offlineCache: true, offlineQueue: 'allowed' }),
    changed: () => undefined,
    config: { getConfig: <T>(k: string) => cfg.get(k) as T | undefined, setConfig: (k, v) => void cfg.set(k, JSON.parse(JSON.stringify(v))), deleteConfig: (k) => void cfg.delete(k) },
    now: () => Date.parse('2026-09-30T08:00:00Z'),
  });
  return { till, sent, other, db };
}

describe('POS phase 2: a manager’s approval, and the sale sent again with it', () => {
  it('a discount past the cashier’s rights comes back as what to ask for — nothing sold — and the next try carries the approval', async () => {
    let asked = 0;
    const s = service({
      sales: (b) => {
        asked++;
        const one = b.sales[0]!;
        return one.approval_id
          ? { status: 200, body: { results: [{ ref: one.ref, status: 'created', number: 'SO-7', message: null }] } }
          : { status: 422, body: { results: [{ ref: one.ref, status: 'rejected', message: 'A discount of 15% needs a manager’s approval (over 10%).', code: 'approval_required', approval: { action: 'discount', amount: 15, threshold: 10, subject: one.ref } }] } };
      },
    });
    const first = await s.till.sell(input({ discount_pct: 15 }), { id: 5, name: 'Kasun' });
    expect(first).toEqual({ needs: { code: 'approval_required', message: 'A discount of 15% needs a manager’s approval (over 10%).', ask: { action: 'discount', amount: 15, threshold: 10, subject: null } } });
    expect(s.till.sales()).toEqual([]);
    const second = await s.till.sell(input({ discount_pct: 15, approval_id: 'apv_0123456789abcdef' }), { id: 5, name: 'Kasun' });
    expect('sale' in second && second.sale.state).toBe('sent');
    expect(asked).toBe(2);
    expect(s.sent[1]).toMatchObject({ approval_id: 'apv_0123456789abcdef' });
    expect(s.sent[0]).not.toHaveProperty('approval_id');
    // Kept on this computer without the approval: it was spent.
    expect('sale' in second && second.sale.approval_id).toBeUndefined();
  });

  it('a refund past the company’s figure: asked for, then sent again under the same refund number with the approval', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const s = service({
      other: async (_m, path, o) => {
        if (!path.endsWith('/refund')) return { status: 404, body: null };
        const b = o!.body as Record<string, unknown>;
        bodies.push(b);
        if (!b.approval_id) return { status: 403, body: { status: 'error', message: 'A refund of 3,250.00 needs a manager’s approval (over 3,000.00).', code: 'approval_required', approval: { action: 'refund', amount: 3250, threshold: 3000, subject: 'T1-AAAAAA-000001' } } };
        return { status: 201, body: { status: 'success', message: 'Refunded.', refund: { ref: b.ref, kind: 'refund', amount: 3250, cash_out: 0, refund_to: 'store_credit', tenders: [{ method: 'card', amount: 3250, to: 'credit' }], lines: [] }, sale: {} } };
      },
    });
    const made = await s.till.sell(input(), { id: 5, name: 'Kasun' });
    const ref = 'sale' in made ? made.sale.ref : '';
    const r1 = await s.till.giveBack({ ref, kind: 'refund', reason: 'Faulty', refund_to: 'store_credit', lines: [{ product_id: 9, quantity: 1, condition: 'faulty' }] }, { id: 5 });
    expect(r1).toEqual({ needs: { code: 'approval_required', message: 'A refund of 3,250.00 needs a manager’s approval (over 3,000.00).', ask: { action: 'refund', amount: 3250, threshold: 3000, subject: 'T1-AAAAAA-000001' } } });
    const r2 = await s.till.giveBack({ ref, kind: 'refund', reason: 'Faulty', refund_to: 'store_credit', lines: [{ product_id: 9, quantity: 1, condition: 'faulty' }], approval_id: 'apv_0123456789abcdef' }, { id: 5 });
    expect('refund' in r2 && r2.refund).toMatchObject({ refund_to: 'store_credit', tenders: [{ method: 'card', amount: 3250, to: 'credit' }] });
    expect(bodies[0]).toEqual({ ref: `${ref}-R1`, cashier_id: 5, reason: 'Faulty', lines: [{ product_id: 9, quantity: 1, condition: 'faulty' }], refund_to: 'store_credit' });
    expect(bodies[1]).toMatchObject({ ref: `${ref}-R1`, approval_id: 'apv_0123456789abcdef' });
  });

  it('maps the counter’s operations to the door, the cashier named by the main process', () => {
    const me = () => 5;
    expect(deskCall({ op: 'park', lines: [{ product_id: 9, quantity: 2 }], note: 'Fetching his card' }, me)).toEqual({ method: 'POST', path: 'held', body: { cashier_id: 5, lines: [{ product_id: 9, quantity: 2 }], note: 'Fetching his card' } });
    expect(deskCall({ op: 'recall', id: 12 }, me)).toEqual({ method: 'POST', path: 'held/12/recall', body: { cashier_id: 5 } });
    expect(deskCall({ op: 'voucher', code: 'gv-ab12-cd34' }, me)).toEqual({ method: 'GET', path: 'vouchers/GV-AB12-CD34' });
    expect(deskCall({ op: 'request', id: 77 }, me)).toEqual({ method: 'GET', path: 'approval-requests/77', query: { cashier_id: 5 } });
    expect(deskCall({ op: 'customers', q: '077 123' }, me)).toEqual({ method: 'GET', path: 'customers', query: { q: '077 123' } });
    expect(deskCall({ op: 'report' }, me)).toEqual({ method: 'GET', path: 'session/report' });
    expect(deskCall({ op: 'report', session_id: 41 }, me)).toEqual({ method: 'GET', path: 'sessions/41/report' });
  });

  it('passes a manager’s PIN once to the door, with the cashier, and keeps nothing of it', async () => {
    const s = service({ other: async (_m, path) => (path === 'approvals' ? { status: 201, body: { approval_id: 'apv_0123456789abcdef', expires_at: '2026-09-30 08:05:00', approver: { id: 3, name: 'Dilini W.' } } } : { status: 404, body: null }) });
    const a = await s.till.approve({ approver_id: 3, pin: '482193', action: 'discount', amount: 15 }, { id: 5 });
    expect(a.status).toBe(201);
    expect(s.other).toHaveBeenCalledWith('POST', 'approvals', { body: { cashier_id: 5, approver_id: 3, pin: '482193', action: 'discount', amount: 15 } });
    expect(JSON.stringify(s.db.all('SELECT * FROM pos_sales'))).not.toContain('482193');
  });
});

describe('POS phase 2: the catalogue’s new parts', () => {
  const answer = {
    version: 'v2',
    categories: [{ id: '1', name: 'Stationery', parent_id: null }, { id: '7', name: 'Notebooks', parent_id: '1' }],
    category_tree: [{ id: '1', name: 'Stationery', parent_id: null, product_count: 2, children: [{ id: '7', name: 'Notebooks', parent_id: '1', product_count: 1, children: [] }] }],
    favourites: ['12'],
    tenders: [{ kind: 'cash', name: 'Cash' }, { kind: 'qr', name: 'LankaQR', offline: false }, { kind: 'voucher', name: 'Gift voucher', needs_reference: true }, { kind: 'cheque', name: 'Nope' }],
    products: [
      { id: '12', name: 'A5 notebook', category_id: '7', price: 450, stock_state: 'low', stock_available: 3, image_url: '/api/pos/device/products/12/image', promo_label: '3 for 1,200', favourite: true },
      { id: '13', name: 'Pen', category_id: '1', price: 50, stock_state: 'out', stock_available: 0, image_url: null },
    ],
  };

  it('reads the groups, favourites, tenders, stock, pictures and promotion badges', () => {
    const c = catalogueOf(answer, null, '2026-09-30T08:00:00Z')!;
    expect(c.category_tree?.[0]).toMatchObject({ id: '1', children: [{ id: '7', name: 'Notebooks' }] });
    expect(c.favourites).toEqual([12]);
    expect(c.tenders?.map((t) => t.kind)).toEqual(['cash', 'qr', 'voucher']);
    expect(c.products[0]).toMatchObject({ id: 12, category: 'Notebooks', category_id: '7', stock_state: 'low', stock_available: 3, image: true, promo_label: '3 for 1,200', favourite: true });
    expect(c.products[1]).toMatchObject({ stock_state: 'out', stock_available: 0 });
    expect(c.products[1]!.image).toBeUndefined();
  });

  it('reads an older catalogue exactly as before', () => {
    const c = catalogueOf({ version: 'v1', categories: [{ id: '2', name: 'Tea' }], products: [{ id: '9', name: 'Tea', category_id: '2', price: 450 }] }, null, 'x')!;
    expect(c.products[0]).toEqual({ id: 9, code: null, barcode: null, name: 'Tea', unit: null, category: 'Tea', price: 450, discount_pct: 0, tax_rate: 0 });
    expect('category_tree' in c || 'favourites' in c || 'tenders' in c).toBe(false);
  });

  it('keeps tenders sensible: cash and card only offline, the customer-bound ones marked', () => {
    const t = tenderOptionsOf([{ kind: 'store_credit', name: 'Credit', offline: true }, { kind: 'card', name: 'Visa / Master' }, { kind: 'account', active: false }])!;
    expect(t).toEqual([
      { kind: 'store_credit', name: 'Credit', opens_drawer: false, offline: false, needs_customer: true, needs_reference: false },
      { kind: 'card', name: 'Visa / Master', opens_drawer: false, offline: true, needs_customer: false, needs_reference: false },
    ]);
    expect(tenderOptionsOf(undefined)).toBeNull();
  });

  it('keeps the company’s receipt template from the door, and forgets it when there is none', async () => {
    let published = true;
    const s = service({ other: async (_m, path) => (path === 'receipt-template' ? { status: 200, body: { template: published ? { id: 4, version: 2, paper: '58mm', blocks: [{ type: 'details', on: true }], vars: {} } : null } } : { status: 404, body: null }) });
    expect(await s.till.refreshTemplate()).toMatchObject({ version: 2, paper: '58mm' });
    expect(s.till.template()?.blocks).toEqual([{ type: 'details', on: true }]);
    published = false;
    expect(await s.till.refreshTemplate()).toBeNull();
  });
});

/* ── The receipt by the company's template ────────────────────────────── */

const printed: PosSale = sale({
  ref: 'T1-AAAAAA-000042',
  created_at: '2026-09-30T08:15:00.000Z',
  state: 'sent',
  number: 'SO-2026-0100',
  customer: { id: 42, name: 'Ruwan Jayasuriya', tier: 'Gold' },
  discount_pct: 10,
  totals: { subtotal: 900, discount: 90, tax: 0, total: 810 },
  change_given: 190,
  loyalty: { customer_id: 42, earned: 8, redeemed: 0, balance: 2348, tier: 'Gold' },
});

const template: PosReceiptTemplate = receiptTemplateOf({
  id: 4,
  version: 3,
  paper: '58mm',
  vars: { return_days: 14 },
  blocks: [
    { type: 'company', on: true, show_address: true },
    { type: 'header', on: true, lines: ['Returns within {return_days} days', 'Receipt {receipt_no}'] },
    { type: 'logo', on: true },
    { type: 'details', on: true, show_till: true, show_cashier: false },
    { type: 'customer', on: true },
    { type: 'lines', on: true },
    { type: 'totals', on: true },
    { type: 'payments', on: true },
    { type: 'points', on: true },
    { type: 'refunds', on: false },
    { type: 'footer', on: true, text: { en: 'Thank you, {customer}', si: 'ස්තූතියි' } },
    { type: 'barcode', on: true, format: 'qr', value: 'receipt_no' },
  ],
})!;

describe('POS phase 2: the receipt by the company’s template', () => {
  it('walks the blocks in their order with their options, the fields filled', () => {
    const rows = templateRows(docOfSale(printed, { company: 'Acme Stores', header: 'Acme Stores\nGalle Road', till: { code: 'T1', name: 'Front till' } }), template, { latin: true });
    const all = rows.map((r) => (r.kind === 'text' ? r.text : r.kind === 'pair' ? `${r.left}|${r.right}` : r.kind === 'qr' ? `QR ${r.text}` : r.kind));
    // The date is the computer's local time: there, but not compared.
    expect(all.filter((w) => w.startsWith('Date|'))).toHaveLength(1);
    const words = all.filter((w) => !w.startsWith('Date|'));
    expect(words).toEqual([
      'Acme Stores',
      'Acme Stores, Galle Road',
      'Returns within 14 days',
      'Receipt T1-AAAAAA-000042',
      'rule',
      'Receipt|T1-AAAAAA-000042',
      'Order|SO-2026-0100',
      'Till|T1',
      'Customer|Ruwan Jayasuriya · Gold',
      'rule',
      'Ceylon tea 100g',
      '  2 x 450.00|900.00',
      'rule',
      'Subtotal|900.00',
      'Discount|-90.00',
      'TOTAL LKR|810.00',
      'Cash|810.00',
      'Tendered|1,000.00',
      'Change|190.00',
      'Points earned|8',
      'Points balance|2348',
      'rule',
      'Thank you, Ruwan Jayasuriya',
      'QR T1-AAAAAA-000042',
    ]);
    // The cashier is left out, as the template says; the Sinhala footer does not go to an ESC/POS code page.
    expect(words.some((w) => w.startsWith('Cashier'))).toBe(false);
    expect(words.join('\n')).not.toContain('ස්තූතියි');
    expect(templateRows(docOfSale(printed, { company: 'Acme', header: '', till: null }), template, { latin: false }).some((r) => r.kind === 'text' && r.text === 'ස්තූතියි')).toBe(true);
  });

  it('prints a field the receipt does not have as nothing, never as its name', () => {
    const doc = docOfSale(sale({ customer: null }), { company: 'Acme', header: '', till: null });
    expect(fillFields('{customer}|{points}|{invoice_no}|{nope}', doc, { return_days: null })).toBe('|||{nope}');
  });

  it('prints at the template’s paper width, and the QR code in the printer’s own commands', async () => {
    const raw = vi.fn(async (_p: string, _b: Buffer) => ({ ok: true as const }));
    const cfg = new Map<string, unknown>([['pos-print', { 'https://ws.example': { receipt_printer: 'Thermal', paper: '80mm', mode: 'escpos' } }]]);
    const p = new PosPrint({ config: { getConfig: <T>(k: string) => cfg.get(k) as T | undefined, setConfig: (k, v) => void cfg.set(k, v), deleteConfig: (k) => void cfg.delete(k) }, origin: () => 'https://ws.example', raw, template: () => template });
    await p.receipt(printed, ['Thermal'], { till: 'Front till', company: 'Acme Stores', code: 'T1' });
    const bytes = raw.mock.calls[0]![1];
    expect(paperOf(template, '80mm')).toBe('58mm');
    // A rule runs the 58 mm roll's 32 characters, not 80 mm's 48.
    expect(bytes.includes(Buffer.from(`${'-'.repeat(COLUMNS['58mm'])}\n`, 'latin1'))).toBe(true);
    expect(bytes.includes(Buffer.from(`${'-'.repeat(COLUMNS['80mm'])}\n`, 'latin1'))).toBe(false);
    expect(bytes.includes(Buffer.from(qrBytes('T1-AAAAAA-000042', COLUMNS['58mm'])))).toBe(true);
    expect(qrBytes('T1', 48).slice(3, 12)).toEqual([0x1d, 0x28, 0x6b, 4, 0, 0x31, 0x41, 0x32, 0]);
    expect(paperOf({ ...template, paper: 'a4' }, '80mm')).toBe('80mm');
  });

  it('without a template, prints exactly what it always printed, byte for byte', async () => {
    const plainSale = sale({ ref: 'T1-AAAAAA-000042', customer: { name: 'Nimal' }, discount_pct: 10, totals: { subtotal: 900, discount: 90, tax: 0, total: 810 }, change_given: 190 });
    const run = async (tpl?: () => PosReceiptTemplate | null) => {
      const raw = vi.fn(async (_p: string, _b: Buffer) => ({ ok: true as const }));
      const cfg = new Map<string, unknown>([['pos-print', { 'https://ws.example': { receipt_printer: 'Thermal', mode: 'escpos', header: 'Acme Stores' } }]]);
      const p = new PosPrint({ config: { getConfig: <T>(k: string) => cfg.get(k) as T | undefined, setConfig: () => undefined, deleteConfig: () => undefined }, origin: () => 'https://ws.example', raw, ...(tpl ? { template: tpl } : {}) });
      await p.receipt(plainSale, ['Thermal'], { till: 'Front till' });
      return raw.mock.calls[0]![1];
    };
    const before = await run();
    expect((await run(() => null)).equals(before)).toBe(true);
    // And it is the layout of old: the till's rows, at the printer's paper.
    expect(before.equals(escpos(receiptRows(plainSale, { header: 'Acme Stores', footer: 'Thank you' }, { till: 'Front till' }), COLUMNS['80mm'], { copies: 1 }))).toBe(true);
  });

  it('follows the template a server receipt carries, and WorkSuite’s own layout when it carries none', () => {
    const r: PosServerReceipt = {
      company: { name: 'Acme', address: null, phone: null, tax_number: 'TAX-1' },
      receipt_no: 'T1-AAAAAA-000042',
      order_number: null,
      invoice_number: 'INV-9',
      register: null,
      cashier: 'Kasun',
      customer: null,
      at: '2026-09-30 13:45',
      currency: 'LKR',
      lines: [],
      taxes: [],
      totals: { subtotal: 0, discount: 0, tax: 0, total: 0 },
      tenders: [],
      change: 0,
      refunds: [],
      refunded: 0,
      status: 'voided',
      void_reason: null,
      footer: 'Thank you',
    };
    const t = receiptTemplateOf({ blocks: [{ type: 'tax_numbers', on: true, label: 'VAT no.' }, { type: 'details', on: true }, { type: 'barcode', on: true }] })!;
    const rows = templateRows({ ...docOfSale(sale(), { company: null, header: '', till: null }), ...{} }, t);
    expect(rows.some((x) => x.kind === 'barcode')).toBe(true);
    const server = serverReceiptRows(r, { header: '', footer: '' });
    expect(server.some((x) => x.kind === 'text' && x.text === '*** VOIDED ***')).toBe(true);
  });
});

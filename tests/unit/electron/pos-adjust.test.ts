import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { getPath: () => '/tmp', getVersion: () => '0.1.0' }, safeStorage: {}, BrowserWindow: class {} }));

import { posCartsSchema, posSellSchema, type PosSale, type PosServerReceipt } from '@shared/pos';
import { saleBody } from '../../../electron/services/pos-outbox';
import { docOfSale, receiptRows, serverReceiptRows, templateRows } from '../../../electron/services/pos-print';
import { receiptOf } from '../../../electron/services/pos-till';

/**
 * #293 in the main process: the sale the till keeps and sends with a fixed discount, its reason and the coupon; the
 * receipt — the till's own and WorkSuite's — printing the coupon, the discount and its reason as separate lines; and the
 * open sales kept with a fixed amount.
 */
const sale: PosSale = {
  ref: 'T1-AAAAAA-000293',
  created_at: '2026-10-07T08:15:00.000Z',
  terminal_id: 7,
  cashier_id: 5,
  cashier_name: 'Kasun',
  state: 'waiting',
  number: null,
  message: null,
  attempts: 0,
  sent_at: null,
  session_id: 41,
  register_id: 3,
  currency: 'LKR',
  customer: null,
  lines: [{ product_id: 9, code: 'TEA', name: 'Ceylon tea', quantity: 1, unit_price: 1450, discount_pct: 0, tax_rate: 18, net: 1450, tax: 216, total: 1416 }],
  discount_pct: 8.046,
  totals: { subtotal: 1450, discount: 250, tax: 216, total: 1416 },
  tenders: [{ method: 'voucher', amount: 500, reference: 'GV-2930-0001' }, { method: 'cash', amount: 1000 }],
  change_given: 84,
  priced_by: 'server',
  catalogue_version: 'v1',
  apply_promotions: true,
  coupon_code: 'TEA10',
  coupon: { code: 'TEA10', amount: 145 },
  discount_type: 'amount',
  discount_value: 105,
  discount_reason: 'Damaged box',
};

const text = (rows: ReturnType<typeof receiptRows>) => rows.map((x) => (x.kind === 'rule' ? '---' : x.kind === 'pair' ? `${x.left}|${x.right}` : x.kind === 'text' ? x.text : x.kind)).join('\n');

describe('the sale with a discount, a coupon and a gift voucher', () => {
  it('is a sale the till may keep', () => {
    const { ref: _r, created_at: _c, terminal_id: _t, cashier_id: _ci, cashier_name: _cn, state: _s, number: _n, message: _m, attempts: _a, sent_at: _sa, ...input } = sale;
    expect(posSellSchema.safeParse(input).success).toBe(true);
    expect(posSellSchema.safeParse({ ...input, discount_type: 'fixed' }).success).toBe(false);
  });

  it('goes to WorkSuite with the amount, its reason, the share it came to and the coupon', () => {
    expect(saleBody(sale)).toMatchObject({ discount_type: 'amount', discount_value: 105, discount_reason: 'Damaged box', discount_pct: 8.046, coupon_code: 'TEA10', tenders: [{ method: 'voucher', amount: 500, reference: 'GV-2930-0001' }, { method: 'cash', amount: 1000 }] });
    const plain = saleBody({ ...sale, discount_type: undefined, discount_value: undefined, discount_reason: undefined, apply_promotions: undefined, coupon_code: undefined, coupon: undefined });
    expect('discount_type' in plain || 'discount_reason' in plain || 'discount_pct' in plain).toBe(false);
  });

  it('prints the coupon, the discount and its reason on their own lines, and the voucher as a payment', () => {
    const t = text(receiptRows(sale, { header: '', footer: '' }, { till: null }));
    expect(t).toContain('Subtotal|1,450.00\nCoupon TEA10|-145.00\nDiscount|-105.00\n  Damaged box');
    expect(t).toContain('Gift voucher (GV-2930-0001)|500.00');
    expect(docOfSale(sale, { company: 'Acme', header: '', till: null }).reductions).toEqual([
      { label: 'Coupon TEA10', amount: 145, note: null },
      { label: 'Discount', amount: 105, note: 'Damaged box' },
    ]);
  });

  it('keeps an open sale with a fixed amount and its reason', () => {
    const carts = { sales: [{ id: 's1', cart: { lines: [{ product_id: 9, quantity: 1 }], customer: null, discount: '1250.50', discount_type: 'amount', discount_reason: 'Damaged box', coupon: 'TEA10' }, started_at: '2026-10-07T08:00:00.000Z' }], active: 's1', held: [] };
    expect(posCartsSchema.safeParse(carts).success).toBe(true);
  });
});

describe('WorkSuite’s receipt', () => {
  const r: PosServerReceipt = {
    company: { name: 'Acme Stores', address: null, phone: null, tax_number: null },
    receipt_no: 'T1-AAAAAA-000293',
    order_number: 'SO-9',
    invoice_number: 'INV-9',
    register: 'Front (R1)',
    cashier: 'Kasun',
    customer: null,
    at: '2026-10-07 13:45',
    currency: 'LKR',
    lines: [{ description: 'Ceylon tea', quantity: 1, unit_price: 1450, discount_pct: 0, amount: 1450, tax: 216, total: 1416 }],
    taxes: [{ name: 'VAT 18%', amount: 216 }],
    totals: { subtotal: 1450, discount: 250, tax: 216, total: 1416 },
    tenders: [{ label: 'Gift voucher', amount: 500, reference: 'GV-2930-0001' }, { label: 'Cash', amount: 916, reference: null }],
    change: 84,
    refunds: [],
    refunded: 0,
    status: 'paid',
    void_reason: null,
    footer: '',
    promotions: [],
    adjustments: { coupon: { code: 'TEA10', amount: 145 }, discount: { type: 'amount', value: 105, amount: 105, reason: 'Damaged box' } },
  };

  it('reads the parts WorkSuite kept', () => {
    const read = receiptOf({ ...r, adjustments: { coupon: { code: 'TEA10', amount: '145.00' }, discount: { type: 'amount', value: 105, amount: 105, reason: 'Damaged box', approved_by: 8 } } });
    expect(read?.adjustments).toEqual(r.adjustments);
    const { adjustments: _a, ...older } = r;
    expect('adjustments' in (receiptOf(older) ?? {})).toBe(false);
  });

  it('prints them as separate lines, on the plain receipt and by a template', () => {
    expect(text(serverReceiptRows(r, { header: '', footer: '' }))).toContain('Subtotal|1,450.00\nCoupon TEA10|-145.00\nDiscount|-105.00\n  Damaged box\nTax VAT 18%|216.00');
    const tpl = { id: 1, version: 1, paper: '80mm' as const, vars: { return_days: null }, blocks: [{ type: 'totals' as const, on: true }] };
    expect(text(templateRows(docOfSale(sale, { company: 'Acme', header: '', till: null }), tpl))).toContain('Coupon TEA10|-145.00\nDiscount|-105.00\n  Damaged box');
  });
});

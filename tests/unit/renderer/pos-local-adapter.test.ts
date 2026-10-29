import { describe, expect, it } from 'vitest';
import type { PosSellInput } from '@shared/pos';
import type { LocalProduct, TillSettings } from '@shared/pos-local-sale';
import { catalogueFromLocal, OFFLINE_CAPS, productFromLocal, saleFromLocal, sellToLocal, sessionFromLocal, tillFromLocal, toCents, toMajor } from '../../../src/modules/pos/local/adapter';

/*
 * The offline till wears the POS module's screens, so everything crossing that boundary has to arrive in the
 * shapes those screens expect — and come back in whole cents, which is what the till actually writes.
 */
const product = (over: Partial<LocalProduct> = {}): LocalProduct => ({ id: 'posp_1', n: 1, sku: 'TEA', barcode: '500100', name: 'Tea 400g', price: 1150, taxRate: 15, stock: 7, active: true, ...over });
const settings: TillSettings = { code: 'T1', taxMode: 'inclusive', rounding: 1, currency: 'LKR' };
const state = { empty: false, signedIn: { id: 'posu_1', username: 'sunil', displayName: 'Sunil', role: 'manager' as const, suspended: false, createdAt: '', lastSignInAt: null, lockedUntil: null }, mustChangePassword: false, permissions: ['sell', 'discount'] };

describe('the offline till, as the POS screens see it', () => {
  it('turns cents into the major units the screens count in, and back', () => {
    expect(toMajor(1150)).toBe(11.5);
    expect(toMajor(5)).toBe(0.05);
    expect(toCents(11.5)).toBe(1150);
    /* The round trip is exact: a price typed on a screen is the same cents that are written. */
    for (const cents of [0, 1, 99, 100, 1150, 999_99]) expect(toCents(toMajor(cents))).toBe(cents);
  });

  it('gives a product the number the screens key a line by', () => {
    const p = productFromLocal(product({ n: 42 }));
    expect(p.id).toBe(42);
    expect(p.price).toBe(11.5);
    expect(p.code).toBe('TEA');
    expect(p.barcode).toBe('500100');
    expect(p.tax_rate).toBe(15);
  });

  it('leaves stock off a product that is not counted', () => {
    expect('stock' in productFromLocal(product({ stock: null }))).toBe(false);
    expect(productFromLocal(product({ stock: 3 })).stock).toBe(3);
  });

  it('builds a catalogue the counter can draw', () => {
    const c = catalogueFromLocal([product(), product({ id: 'posp_2', n: 2, name: 'Bag', price: 500, taxRate: 0 })], settings);
    expect(c.products).toHaveLength(2);
    expect(c.currency).toBe('LKR');
    expect(c.truncated).toBe(false);
  });

  it('says plainly what an offline till cannot do', () => {
    /* The screens hide what is off; offering a button with nothing behind it is the thing to avoid. */
    expect(OFFLINE_CAPS.price).toBe(false);
    expect(OFFLINE_CAPS.lookup).toBe(false);
    expect(OFFLINE_CAPS.refund).toBe(false);
    expect(OFFLINE_CAPS.email_receipt).toBe(false);
    /* …and what it does: a sale needs an open drawer, and a mistake is voided. */
    expect(OFFLINE_CAPS.drawer_required).toBe(true);
    expect(OFFLINE_CAPS.void).toBe(true);
  });

  it('shows the open register as a session, with the float in major units', () => {
    const s = sessionFromLocal({ id: 'posr_1', openedAt: '2026-10-29T08:00:00Z', openedBy: 'posu_1', float: 10_000 }, settings, 'Sunil');
    expect(s).toMatchObject({ status: 'open', opening_float: 100, cashier: 'Sunil', currency: 'LKR' });
    expect(sessionFromLocal(null, settings, 'Sunil')).toBeNull();
  });

  it('lets a manager discount and a cashier not', () => {
    const go = () => undefined;
    const params = new URLSearchParams();
    expect(tillFromLocal({ state, register: null, settings, params, go }).discount.allowed).toBe(true);
    const cashier = { ...state, permissions: ['sell'] };
    expect(tillFromLocal({ state: cashier, register: null, settings, params, go }).discount.allowed).toBe(false);
  });

  it('converts a sale the payment panel made into what the till writes', () => {
    const input = {
      lines: [{ product_id: 1, code: 'TEA', name: 'Tea 400g', quantity: 2, unit_price: 11.5, discount_pct: 0, tax_rate: 15, net: 20, tax: 3, total: 23 }],
      tenders: [{ method: 'cash', amount: 25 }],
      customer: { name: 'Nimali' },
    } as unknown as PosSellInput;
    const out = sellToLocal(input, new Map([[1, product()]]));
    expect(out.lines[0]).toMatchObject({ productId: 'posp_1', qty: 2 });
    expect(out.tenders[0]).toEqual({ kind: 'cash', amount: 2500, reference: null });
    expect(out.customer).toBe('Nimali');
  });

  it('keeps a line the catalogue does not know as an open line, priced by hand', () => {
    const input = { lines: [{ product_id: 999, code: null, name: 'Repair', quantity: 1, unit_price: 25, discount_pct: 0, tax_rate: 0, net: 25, tax: 0, total: 25 }], tenders: [{ method: 'cash', amount: 25 }] } as unknown as PosSellInput;
    const out = sellToLocal(input, new Map());
    expect(out.lines[0]).toMatchObject({ productId: null, name: 'Repair', unitPrice: 2500, qty: 1 });
  });

  it('maps the tenders a screen offers onto the four the till keeps', () => {
    const kinds = (methods: string[]) =>
      sellToLocal({ lines: [], tenders: methods.map((method) => ({ method, amount: 1 })) } as unknown as PosSellInput, new Map()).tenders.map((t) => t.kind);
    expect(kinds(['cash', 'card', 'credit_card', 'gift_voucher', 'bank_transfer'])).toEqual(['cash', 'card', 'card', 'voucher', 'other']);
  });

  it('answers a finished sale as a sale, going nowhere', () => {
    const input = { lines: [], tenders: [], totals: { subtotal: 0, discount: 0, tax: 0, total: 23 } } as unknown as PosSellInput;
    const sale = saleFromLocal(input, { ref: 'T1-20261029-0001', soldAt: '2026-10-29T08:30:00Z', change: 200 }, 'Sunil');
    expect(sale).toMatchObject({ ref: 'T1-20261029-0001', state: 'sent', number: null, cashier_name: 'Sunil', change_given: 200 });
    /* Nothing is waiting to be sent, so the till bar has nothing to report. */
    expect(sale.attempts).toBe(0);
  });
});

import { describe, expect, it } from 'vitest';
import type { PosProduct, PosSale } from '@shared/pos';
import { discountRights, findInCatalogue, mayGiveBack } from '../../../src/modules/pos/api';
import { WedgeDetector } from '../../../src/modules/pos/barcode';
import { addLine, discountPct, EMPTY_CART, itemCount, removeLine, setCustomer, setDiscount, setQty } from '../../../src/modules/pos/cart';
import { translate } from '../../../src/modules/pos/i18n';
import { posRoute } from '../../../src/modules/pos/parts';
import { allocate, allowedTenders, countBody, countTotal, estimateCart, quickCash, settle, settles, variance } from '../../../src/modules/pos/pricing';
import { canStillRefund, refundable, refundLines, returned } from '../../../src/modules/pos/returns';
import { closeBody, needsReason, salesSummary, xReport, zReport } from '../../../src/modules/pos/shift';
import { buildSale, remaining, tendersOf } from '../../../src/modules/pos/tender';
import type { PosSession } from '../../../src/modules/pos/api';

const product = (over: Partial<PosProduct>): PosProduct => ({ id: 1, code: null, barcode: null, name: 'x', unit: null, category: null, price: 0, discount_pct: 0, tax_rate: 0, ...over });
const tea = product({ id: 9, code: 'TEA-1', barcode: '4790001000011', name: 'Ceylon tea', price: 450 });
const mug = product({ id: 3, code: 'MUG', name: 'Mug', price: 1200, discount_pct: 10, tax_rate: 18 });
const products = new Map([tea, mug].map((p) => [p.id, p] as const));

describe('the cart', () => {
  it('adds, counts up, sets and removes quantities', () => {
    let c = addLine(EMPTY_CART, 9);
    c = addLine(c, 9, 2);
    c = addLine(c, 3);
    expect(c.lines).toEqual([
      { product_id: 9, quantity: 3 },
      { product_id: 3, quantity: 1 },
    ]);
    expect(itemCount(c)).toBe(4);
    expect(setQty(c, 9, 0.25).lines[0]).toEqual({ product_id: 9, quantity: 0.25 });
    expect(setQty(c, 9, 0).lines).toEqual([{ product_id: 3, quantity: 1 }]);
    expect(setQty(c, 9, 10_000_000).lines[0]!.quantity).toBe(100_000);
    expect(removeLine(c, 3).lines).toHaveLength(1);
  });

  it('keeps only what was typed of the customer', () => {
    expect(setCustomer(EMPTY_CART, { name: '  Nimal ', phone: '', email: undefined }).customer).toEqual({ name: 'Nimal' });
    expect(setCustomer(EMPTY_CART, { name: ' ' }).customer).toBeNull();
  });

  it('takes a discount only where the cashier may give one, and never past 100', () => {
    expect(setDiscount(EMPTY_CART, '1a2.5.5%').discount).toBe('12.55');
    expect(setDiscount(EMPTY_CART, '250').discount).toBe('100');
    expect(discountPct(setDiscount(EMPTY_CART, '10'), true)).toBe(10);
    expect(discountPct(setDiscount(EMPTY_CART, '10'), false)).toBe(0);
  });

  it('caps the discount at the cashier’s ceiling', () => {
    expect(setDiscount(EMPTY_CART, '25', 10).discount).toBe('10');
    expect(setDiscount(EMPTY_CART, '8', 10).discount).toBe('8');
    expect(discountPct({ ...EMPTY_CART, discount: '40' }, true, 15)).toBe(15);
    expect(discountPct({ ...EMPTY_CART, discount: '40' }, true, null)).toBe(40);
  });

  it('offers a discount by WorkSuite’s word only: the right, the ceiling, the override', () => {
    const can = { sell: true, open: true, close: true, cash_in: true, cash_out: true, view_all: false, settings: false, terminals: false };
    // An older server that says nothing: no discount (no stand-in for the permission).
    expect(discountRights(can)).toEqual({ allowed: false, ceiling: null });
    expect(discountRights({ ...can, discount: true, max_discount_pct: 10 })).toEqual({ allowed: true, ceiling: 10 });
    expect(discountRights({ ...can, discount: true, max_discount_pct: null })).toEqual({ allowed: true, ceiling: null });
    expect(discountRights({ ...can, discount: true, max_discount_pct: 0 })).toEqual({ allowed: false, ceiling: null });
    expect(discountRights({ ...can, discount: true, discount_override: true, max_discount_pct: 10 })).toEqual({ allowed: true, ceiling: null });
    expect(discountRights({ ...can, discount: false, max_discount_pct: 50 })).toEqual({ allowed: false, ceiling: null });
  });
});

describe('the preview price', () => {
  it('prices the cart as WorkSuite would from the catalogue: list discounts, the cashier’s spread over the lines, tax after', () => {
    const e = estimateCart([{ product_id: 9, quantity: 2 }, { product_id: 3, quantity: 1 }], products, 10, null, 'LKR');
    expect(e.error).toBeNull();
    // Tea 900; mug 1200 − 10% = 1080. Subtotal 1980; 10% off = 198, spread 90 / 108; tax 18% on the mug's 972 = 174.96.
    expect(e.cart).toMatchObject({ subtotal: 1980, line_discount: 120, discount: 198, tax: 174.96, total: 1956.96 });
    expect(e.cart.lines.map((l) => [l.product_id, l.net, l.tax, l.total])).toEqual([
      [9, 900, 0, 810],
      [3, 1080, 174.96, 1146.96],
    ]);
  });

  it('says so when the discount passes the company’s ceiling', () => {
    expect(estimateCart([{ product_id: 3, quantity: 1 }], products, 20, 15, 'LKR').error).toBe('That would take 28.0% off this sale, and 15% is the most allowed.');
  });

  it('splits cents exactly', () => {
    expect(allocate(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocate(0, [0, 0])).toEqual([0, 0]);
  });
});

describe('the tender', () => {
  it('gives change only from cash, and refuses a card for more than the sale', () => {
    expect(settle(1956.96, [{ method: 'cash', amount: 2000 }])).toEqual({ cash: 2000, other: 0, change: 43.04, paid: 1956.96, due: 0, overCharged: false });
    expect(settle(1000, [{ method: 'card', amount: 600 }, { method: 'cash', amount: 500 }])).toMatchObject({ change: 100, due: 0 });
    expect(settle(1000, [{ method: 'card', amount: 1200 }])).toMatchObject({ change: 0, overCharged: true });
    expect(settles(1000, [{ method: 'cash', amount: 999.99 }])).toBe(false);
  });

  it('offers the notes a customer is likely to hand over', () => {
    expect(quickCash(6262.9, [5000, 1000, 500, 100, 50, 20, 10, 5, 2, 1])).toEqual([6262.9, 6500, 7000, 10000]);
    expect(quickCash(12.3, [100, 50, 20, 10, 5, 1])).toEqual([12.3, 13, 15, 20]);
  });

  it('takes only cash and the shop’s own card machine with WorkSuite out of reach', () => {
    expect(allowedTenders(true)).toEqual(['cash', 'card', 'bank_transfer', 'wallet']);
    expect(allowedTenders(false)).toEqual(['cash', 'card']);
  });

  it('builds the sale from WorkSuite’s cart and the payments, with the change', () => {
    const cart = estimateCart([{ product_id: 9, quantity: 2 }], products, 0, null, 'LKR').cart;
    const rows = [
      { method: 'card' as const, amount: '400', reference: ' 4242 ' },
      { method: 'cash' as const, amount: '1,000', reference: 'ignored' },
    ];
    expect(tendersOf(rows)).toEqual([{ method: 'card', amount: 400, reference: '4242' }, { method: 'cash', amount: 1000 }]);
    expect(remaining(900, rows, 1)).toBe(500);
    const sale = buildSale({ session_id: 41, register_id: 3, currency: 'LKR', customer: null, cart, source: 'server', catalogue_version: 'v1' }, rows);
    expect(sale).toMatchObject({ session_id: 41, register_id: 3, totals: { total: 900 }, change_given: 500, priced_by: 'server', tenders: [{ method: 'card', amount: 400 }, { method: 'cash', amount: 1000 }] });
    expect(buildSale({ session_id: 41, register_id: 3, currency: 'LKR', customer: null, cart, source: 'estimate', catalogue_version: null }, [{ method: 'cash', amount: '800', reference: '' }])).toEqual({ error: '100.00 is still due.' });
    expect(buildSale({ session_id: 41, register_id: 3, currency: '', customer: null, cart, source: 'server', catalogue_version: null }, rows)).toHaveProperty('error');
  });
});

describe('closing the drawer', () => {
  const session: PosSession = {
    id: 41,
    org_id: 3,
    register_id: 3,
    register: 'Front',
    register_code: 'R1',
    terminal_id: 7,
    currency: 'LKR',
    status: 'open',
    opening_float: 5000,
    opened_at: '2026-09-30 02:00:00',
    cashier: 'Kasun',
    closed_at: null,
    closed_by_name: null,
    expected_cash: null,
    counted_cash: null,
    variance: null,
    variance_reason: null,
    note: null,
    blind: false,
    takings: { cash_in: 3000, cash_change: 200, moved_in: 0, moved_out: 1000, expected: 6800 },
  };

  it('sends the notes and coins counted, or one figure, and the reason', () => {
    const counts = [
      { value: 5000, count: 1 },
      { value: 1000, count: 1 },
      { value: 100, count: 7 },
      { value: 50, count: 0 },
    ];
    expect(countTotal(counts)).toBe(6700);
    expect(countBody(counts)).toHaveLength(3);
    expect(closeBody(counts, '', ' short, a refund ')).toEqual({ denominations: countBody(counts), variance_reason: 'short, a refund' });
    expect(closeBody([], '6,700.50', '')).toEqual({ counted_cash: 6700.5 });
    expect(closeBody([], '', '')).toEqual({ error: 'Count the drawer: the notes and coins, or what it holds.' });
    // Where the company counts note by note, one figure is not enough.
    expect(closeBody([], '6,700.50', '', { count_to_close: true })).toEqual({ error: 'This company counts the drawer note by note before it closes.' });
    expect(closeBody(counts, '', '', { count_to_close: true })).toEqual({ denominations: countBody(counts) });
    expect(variance(6700, 6800)).toBe(-100);
    // Blind: nothing to compare against on this computer.
    expect(variance(6700, null)).toBeNull();
  });

  it('asks why only past the company’s tolerance, and never under a blind close', () => {
    expect(needsReason(-100, 0, false)).toBe(true);
    expect(needsReason(-100, 100, false)).toBe(false);
    expect(needsReason(100.5, 100, false)).toBe(true);
    expect(needsReason(0.004, 0, false)).toBe(false);
    expect(needsReason(-100, 0, true)).toBe(false);
    expect(needsReason(null, 0, false)).toBe(false);
  });

  it('prints the X report without the expected figure under a blind close, and the Z with WorkSuite’s', () => {
    const sale = (over: Partial<PosSale>): PosSale => ({ ref: 'A', created_at: '', terminal_id: 7, cashier_id: 5, cashier_name: null, state: 'sent', number: null, message: null, attempts: 0, sent_at: null, session_id: 41, register_id: 3, currency: 'LKR', customer: null, lines: [], discount_pct: 0, totals: { subtotal: 0, discount: 0, tax: 0, total: 900 }, tenders: [{ method: 'cash', amount: 1000 }], change_given: 100, priced_by: 'server', catalogue_version: null, ...over });
    const sum = salesSummary([sale({}), sale({ state: 'waiting', totals: { subtotal: 0, discount: 0, tax: 0, total: 500 }, tenders: [{ method: 'card', amount: 500 }], change_given: 0 }), sale({ state: 'refused' })]);
    expect(sum).toEqual({ count: 2, total: 1400, refunded: 0, byTender: { cash: 900, card: 500 }, waiting: 1, refused: 1 });
    // A refund WorkSuite recorded comes off the total and the tender it went back on.
    const back = salesSummary([sale({ returns: [{ ref: 'A-R1', kind: 'refund', status: 'done', amount: 300, cash_out: 300, tenders: [{ method: 'cash', amount: 300 }], lines: [], reason: null, credit_note: null, at: null }] })]);
    expect(back).toMatchObject({ count: 1, total: 600, refunded: 300, byTender: { cash: 600 } });
    expect(xReport(session, back, [], 'now').rows).toContainEqual({ label: 'Refunded (in the total)', value: '-300.00' });
    const x = xReport(session, sum, [], 'now');
    expect(x.rows.some((r) => 'label' in r && r.label === 'Drawer should hold')).toBe(true);
    const blind = xReport({ ...session, blind: true, takings: { ...session.takings!, expected: null } }, sum, [], 'now');
    expect(blind.rows.some((r) => 'label' in r && r.label === 'Drawer should hold')).toBe(false);
    const z = zReport({ ...session, status: 'closed', expected_cash: 6800, counted_cash: 6700, variance: -100, variance_reason: 'refund' }, sum);
    expect(z.rows).toContainEqual({ label: 'Difference', value: 'LKR -100.00', strong: true });
  });
});

describe('the scanner and the catalogue', () => {
  it('tells a scanner from a person typing', () => {
    const d = new WedgeDetector();
    let at = 1000;
    for (const k of '4790001000011') expect(d.key(k, (at += 8))).toBeNull();
    expect(d.key('Enter', (at += 8))).toBe('4790001000011');

    const person = new WedgeDetector();
    at = 5000;
    for (const k of 'tea') person.key(k, (at += 180));
    expect(person.key('Enter', (at += 150))).toBeNull();
    expect(d.key('Shift', at)).toBeNull();
  });

  it('finds a product by barcode, then code', () => {
    expect(findInCatalogue([tea, mug], '4790001000011')).toBe(tea);
    expect(findInCatalogue([tea, mug], 'mug')).toBe(mug);
    expect(findInCatalogue([tea, mug], ' ')).toBeNull();
  });

  it('speaks the cashier’s language, English where it has no word yet', () => {
    expect(translate('si', 'pos.pay')).toBe('ගෙවන්න');
    expect(translate('ta', 'pos.pay')).toBe('செலுத்து');
    expect(translate('si', 'pos.pairTitle')).toBe('Make this computer a till');
    expect(translate('en', 'pos.waiting', { n: 3 })).toBe('3 sale(s) waiting to reach WorkSuite');
  });

  it('keeps its address as plain path characters', () => {
    expect(posRoute('sales', { sale: 'T1-AB/1 x' })).toBe('/pos?view=sales&sale=T1-AB%2F1%20x');
  });
});

describe('refunds and voids', () => {
  const sale = (over: Partial<PosSale> = {}): PosSale => ({
    ref: 'T1-AAAAAA-000001', created_at: '', terminal_id: 7, cashier_id: 5, cashier_name: null, state: 'sent', number: 'SO-1', message: null, attempts: 1, sent_at: null, session_id: 41, register_id: 3, currency: 'LKR', customer: null,
    lines: [
      { product_id: 9, code: 'TEA', name: 'Ceylon tea', quantity: 3, unit_price: 450, discount_pct: 0, tax_rate: 0, net: 1350, tax: 0, total: 1350 },
      { product_id: 3, code: 'MUG', name: 'Mug', quantity: 1, unit_price: 1200, discount_pct: 0, tax_rate: 0, net: 1200, tax: 0, total: 1200 },
    ],
    discount_pct: 0, totals: { subtotal: 2550, discount: 0, tax: 0, total: 2550 }, tenders: [{ method: 'cash', amount: 3000 }], change_given: 450, priced_by: 'server', catalogue_version: null, ...over,
  });
  const refund = (lines: Array<{ product_id: number; quantity: number }>, amount: number) => ({ ref: 'x', kind: 'refund' as const, status: 'done', amount, cash_out: amount, tenders: [{ method: 'cash', amount }], lines, reason: null, credit_note: null, at: null });

  it('knows what is left to give back, by line', () => {
    const s = sale({ returns: [refund([{ product_id: 9, quantity: 2 }], 900)] });
    expect(refundable(s).map((l) => l.left)).toEqual([1, 1]);
    expect(canStillRefund(s)).toBe(true);
    expect(canStillRefund(sale({ returns: [refund([{ product_id: 9, quantity: 3 }, { product_id: 3, quantity: 1 }], 2550)] }))).toBe(false);
    expect(canStillRefund(sale({ voided: true }))).toBe(false);
    expect(returned(s)).toEqual({ amount: 900, cash: 900 });
  });

  it('asks for everything left, or the quantities picked within what is left', () => {
    const s = sale({ returns: [refund([{ product_id: 9, quantity: 2 }], 900)] });
    expect(refundLines(s, 'all')).toBeUndefined();
    expect(refundLines(s, { 9: 5, 3: 0 })).toEqual([{ product_id: 9, quantity: 1 }]);
    expect(refundLines(s, { 9: 0 })).toBeNull();
  });

  it('offers them only where the server does them and the person may', () => {
    const can = { sell: true, open: true, close: true, cash_in: true, cash_out: true, view_all: false, settings: false, terminals: false, refund: true, void: false };
    expect(mayGiveBack({ refund: true, void: true }, can, 'refund')).toBe(true);
    expect(mayGiveBack({ refund: true, void: true }, can, 'void')).toBe(false);
    expect(mayGiveBack({}, can, 'refund')).toBe(false);
    expect(mayGiveBack({ refund: true }, null, 'refund')).toBe(false);
  });
});

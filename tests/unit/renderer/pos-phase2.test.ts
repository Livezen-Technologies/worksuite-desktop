import { describe, expect, it } from 'vitest';
import type { PosCategoryNode, PosProduct, PosSale, PosTenderOption } from '@shared/pos';
import { pricedOf, pricingBody } from '../../../src/modules/pos/api';
import { covers, discountNeedsApproval, moneyNeedsApproval, saleDiscount } from '../../../src/modules/pos/approval';
import { EMPTY_CART, redeemOf, setCustomer, setRedeem } from '../../../src/modules/pos/cart';
import { categoryLabel, FAVOURITES, favouritesOf, inCategory } from '../../../src/modules/pos/catalog';
import { approvalOf, cardOf, crmCustomerOf, heldOf, maxRedeem, needFromStaff, requestOf, sessionReportOf, stockOf, voucherOf } from '../../../src/modules/pos/desk';
import { cartOfHeld } from '../../../src/modules/pos/OpenSales';
import { allowedMethods, allowedTenders, estimateCart, withDiscount } from '../../../src/modules/pos/pricing';
import { refundCalls, refundToOptions } from '../../../src/modules/pos/returns';
import { buildSale, phase2Of, tenderProblem, type TenderRow } from '../../../src/modules/pos/tender';

const product = (over: Partial<PosProduct>): PosProduct => ({ id: 1, code: null, barcode: null, name: 'x', unit: null, category: null, price: 0, discount_pct: 0, tax_rate: 0, ...over });
const products = new Map([product({ id: 9, name: 'Tea', price: 450 }), product({ id: 3, name: 'Mug', price: 1200, tax_rate: 18 })].map((p) => [p.id, p] as const));
const cart = estimateCart([{ product_id: 9, quantity: 2 }], products, 0, null, 'LKR').cart;
const ctx = { session_id: 41, register_id: 3, currency: 'LKR', customer: null, cart, source: 'server' as const, catalogue_version: 'v1' };
const row = (method: TenderRow['method'], amount: string, reference = ''): TenderRow => ({ method, amount, reference });
const opt = (kind: PosTenderOption['kind'], over: Partial<PosTenderOption> = {}): PosTenderOption => ({ kind, name: kind, opens_drawer: kind === 'cash', offline: kind === 'cash' || kind === 'card', needs_customer: kind === 'store_credit' || kind === 'account', needs_reference: kind === 'voucher', ...over });

describe('capability gating', () => {
  it('asks WorkSuite for nothing new where it announces nothing (an older server prices exactly as before)', () => {
    expect(pricingBody({}, { customer_id: 42, coupon_code: 'POYA15', redeem_points: 100 })).toEqual({});
    expect(pricingBody({ price: true, catalogue: true }, { customer_id: 42 })).toEqual({});
  });

  it('asks for each part the server announces, and only those', () => {
    expect(pricingBody({ promotions: true }, {})).toEqual({ apply_promotions: true });
    expect(pricingBody({ promotions: true, customers: true, coupons: true, loyalty: true }, { customer_id: 42, coupon_code: 'POYA15', redeem_points: 100 })).toEqual({ apply_promotions: true, customer_id: 42, coupon_code: 'POYA15', redeem_points: 100 });
    // Points need a named customer.
    expect(pricingBody({ loyalty: true, customers: true }, { redeem_points: 100 })).toEqual({});
  });

  it('offers the four tenders of old where none are configured; the company’s, in its order, where they are', () => {
    expect(allowedMethods(true, null)).toEqual(['cash', 'card', 'bank_transfer', 'wallet']);
    const configured = [opt('cash'), opt('qr', { name: 'LankaQR' }), opt('voucher'), opt('card'), opt('account')];
    expect(allowedMethods(true, configured)).toEqual(['cash', 'qr', 'voucher', 'card', 'account']);
    expect(allowedMethods(false, configured), 'offline: cash only (worksuite-desktop#296)').toEqual(['cash']);
    expect(allowedMethods(false, configured, true), 'a card too, where the till accepts one offline').toEqual(['cash', 'card']);
    expect(allowedTenders(true, configured)[1]!.name).toBe('LankaQR');
  });

  it('reads WorkSuite’s cart with its promotions, points and deduction — and an older answer as before', () => {
    const old = pricedOf({ lines: [], subtotal: 900, discount: 0, tax: 0, total: 900 }, 'LKR', 0);
    expect('deduction' in old || 'promotions' in old).toBe(false);
    const p = pricedOf({ lines: [], subtotal: 1350, discount: 0, tax: 0, total: 1150, promotion_discount: 150, points_discount: 50, points_redeemed: 50, deduction: 200, promotions: [{ id: 3, label: '3 for 1,200', amount: 150 }], pricing_notes: ['The coupon X is not usable here.'] }, 'LKR', 0);
    expect(p).toMatchObject({ deduction: 200, promotion_discount: 150, points_redeemed: 50, promotions: [{ id: 3, label: '3 for 1,200', amount: 150 }], notes: ['The coupon X is not usable here.'] });
  });
});

describe('a manager’s approval', () => {
  const rights = { allowed: true, ceiling: 10 };
  it('knows a discount past the cashier’s rights, and a sum past the company’s figure', () => {
    expect(discountNeedsApproval(10, rights)).toBe(false);
    expect(discountNeedsApproval(15, rights)).toBe(true);
    expect(discountNeedsApproval(5, { allowed: false, ceiling: null })).toBe(true);
    expect(discountNeedsApproval(50, { allowed: true, ceiling: null })).toBe(false);
    expect(moneyNeedsApproval(3250, 3000)).toBe(true);
    expect(moneyNeedsApproval(3000, 3000)).toBe(false);
    expect(moneyNeedsApproval(3250, 0)).toBe(false);
    expect(moneyNeedsApproval(3250, 3000, true)).toBe(false);
  });

  it('gives the sale its discount once approved — and only the cashier’s own until then; exactly the old rule without approvals', () => {
    const c = { discount: '15' };
    expect(saleDiscount(c, rights, false, null)).toEqual({ pct: 10, approved: null, needs: false });
    expect(saleDiscount(c, rights, true, null)).toEqual({ pct: 10, approved: null, needs: true });
    const a = { id: 'apv_0123456789abcdef', action: 'discount' as const, amount: 15, approver: 'Dilini', expires_at: '2026-09-30 08:05:00' };
    expect(saleDiscount(c, rights, true, a, Date.parse('2026-09-30T08:01:00Z'))).toEqual({ pct: 15, approved: 15, needs: false });
    // Lapsed, or for less than asked: asked again.
    expect(saleDiscount(c, rights, true, a, Date.parse('2026-09-30T08:06:00Z')).needs).toBe(true);
    expect(saleDiscount({ discount: '20' }, rights, true, a, Date.parse('2026-09-30T08:01:00Z')).needs).toBe(true);
    expect(covers({ ...a, action: 'refund' }, 'discount', 15)).toBe(false);
  });

  it('reads the approval, a request’s state and a staff refusal', () => {
    const ask = { action: 'discount' as const, amount: 15, threshold: 10, subject: null };
    expect(approvalOf({ approval_id: 'apv_0123456789abcdef', expires_at: 'x', approver: { name: 'Dilini' } }, ask)).toMatchObject({ id: 'apv_0123456789abcdef', approver: 'Dilini', amount: 15 });
    expect(approvalOf({ approval_id: 'nope' }, ask)).toBeNull();
    expect(requestOf({ id: 77, status: 'pending' }, ask)).toMatchObject({ status: 'pending', approval: null });
    expect(requestOf({ id: 77, status: 'approved', approval_id: 'apv_0123456789abcdef', decided_by_name: 'Ishara' }, ask)).toMatchObject({ status: 'approved', decided_by: 'Ishara', approval: { id: 'apv_0123456789abcdef' } });
    expect(needFromStaff({ code: 'approval_required', message: 'Taking 9,000.00 out needs a manager.', details: { approval: { action: 'cash_out', amount: 9000, threshold: 5000 } } }, 'cash_out', 9000)).toEqual({ code: 'approval_required', message: 'Taking 9,000.00 out needs a manager.', ask: { action: 'cash_out', amount: 9000, threshold: 5000, subject: null } });
    expect(needFromStaff({ code: 'forbidden', message: 'No.' }, 'cash_out', 1)).toBeNull();
  });

  it('prices an approved discount the way WorkSuite does: off the goods after promotions, spread before tax', () => {
    const c = estimateCart([{ product_id: 3, quantity: 1 }, { product_id: 9, quantity: 2 }], products, 0, null, 'LKR').cart;
    const local = estimateCart([{ product_id: 3, quantity: 1 }, { product_id: 9, quantity: 2 }], products, 25, null, 'LKR').cart;
    expect(withDiscount(c, 25)).toMatchObject({ discount: local.discount, tax: local.tax, total: local.total, discount_pct: 25 });
    const promo = { ...c, promotion_discount: 100, deduction: 100, total: c.total - 100 };
    expect(withDiscount(promo, 10).discount).toBe(200);
    expect(withDiscount(promo, 10).deduction).toBe(300);
  });
});

describe('tenders', () => {
  const offered = [opt('cash'), opt('card'), opt('voucher'), opt('store_credit'), opt('account'), opt('qr')];
  const balances = { vouchers: { 'GV-AB12': { balance: 500, usable: true }, 'GV-DEAD': { balance: 0, usable: false } }, credit: 300 };
  const named = { id: 42, name: 'Ruwan' };

  it('checks a voucher’s code and balance, store credit and an account for a named customer', () => {
    const p = (rows: TenderRow[], customer: typeof named | null = named, online = true) => tenderProblem(rows, { offered, customer, balances, online });
    expect(p([row('cash', '900')])).toBeNull();
    expect(p([row('voucher', '400', '')])).toMatch(/code/);
    expect(p([row('voucher', '400', 'GV-NEW1')])).toMatch(/balance first/);
    expect(p([row('voucher', '400', 'gv-ab12')])).toBeNull();
    expect(p([row('voucher', '600', 'GV-AB12')])).toMatch(/holds 500.00/);
    expect(p([row('voucher', '100', 'GV-DEAD')])).toMatch(/cannot be used/);
    expect(p([row('store_credit', '300')])).toBeNull();
    expect(p([row('store_credit', '301')])).toMatch(/300.00 in store credit/);
    expect(p([row('account', '900')], null)).toMatch(/attach the customer/);
    expect(p([row('qr', '900')], named, false)).toMatch(/Only cash is taken/);
    expect(p([row('card', '900')], named, false), 'a card offline only where the till accepts one').toMatch(/Only cash is taken/);
    expect(tenderProblem([row('card', '900')], { offered, customer: named, balances, online: false, cardOffline: true })).toBeNull();
    expect(tenderProblem([row('qr', '900')], { offered, customer: named, balances, online: false, cardOffline: true })).toMatch(/Only cash and card/);
    expect(tenderProblem([row('qr', '900')], { offered: [opt('cash')], customer: null, balances, online: true })).toMatch(/not taken here/);
  });

  it('sends the voucher’s code as its reference', () => {
    const s = buildSale(ctx, [row('voucher', '900', 'gv-ab12')]);
    expect('tenders' in s && s.tenders).toEqual([{ method: 'voucher', amount: 900, reference: 'GV-AB12' }]);
  });
});

describe('promotions in a sale, online and offline', () => {
  it('priced offline: says it applied none (`promotion_ids: []`) — never asks WorkSuite to apply them, nor spends points', () => {
    expect(phase2Of({ ...ctx, source: 'estimate', promotions: true, redeem: 50, coupon: 'POYA15', customer: { id: 42, name: 'Ruwan' } })).toEqual({ customer_id: 42, promotion_ids: [] });
  });

  it('priced by WorkSuite: asks for its promotions, the coupon and the points; carries what they took off', () => {
    const priced = { ...cart, promotions: [{ id: 3, label: '3 for 1,200', amount: 150 }], points_discount: 50, points_redeemed: 50, deduction: 200 };
    const s = buildSale({ ...ctx, cart: priced, promotions: true, coupon: 'POYA15', redeem: 50, customer: { id: 42, name: 'Ruwan' }, approval_id: 'apv_0123456789abcdef' }, [row('cash', '1000')]);
    expect(s).toMatchObject({ apply_promotions: true, coupon_code: 'POYA15', redeem_points: 50, customer_id: 42, approval_id: 'apv_0123456789abcdef', promotions: [{ label: '3 for 1,200', amount: 150 }], points: { redeemed: 50, discount: 50 }, totals: { discount: 200 } });
    expect('promotion_ids' in s).toBe(false);
  });

  it('says nothing of promotions where the server has none', () => {
    const s = buildSale({ ...ctx, source: 'estimate' }, [row('cash', '900')]);
    for (const k of ['promotion_ids', 'apply_promotions', 'customer_id', 'approval_id', 'promotions', 'points']) expect(k in s).toBe(false);
  });
});

describe('customers and loyalty', () => {
  it('reads a customer, their card, and what they may spend', () => {
    expect(crmCustomerOf({ id: 42, name: 'Ruwan', phone: '0771234567', email: null, customer_group: 'Trade', points_balance: 2340, store_credit: null })).toEqual({ id: 42, name: 'Ruwan', phone: '0771234567', email: null, group: 'Trade', points: 2340, store_credit: null });
    const card = cardOf({ id: 42, name: 'Ruwan', points_balance: 2340, spend_12m: 184300, visits_12m: 37, tier: { name: 'Gold', multiplier: 1.5 }, next_tier: null, loyalty: { enabled: true, point_value: 1, points_value: 2340, min_redeem: 100, max_redeem_pct: 50 }, last_purchases: [{ ref: 'KOL-1', at: '2026-09-12 10:00:00', total: 4430, items: ['keyboard', 'pens'] }] })!;
    expect(card).toMatchObject({ tier: 'Gold', spend_12m: 184300, visits_12m: 37, last: [{ ref: 'KOL-1', items: ['keyboard', 'pens'] }] });
    expect(maxRedeem(2340, card.loyalty, 1000)).toBe(500);
    expect(maxRedeem(2340, card.loyalty, 100)).toBe(0); // 50 points, under the 100 least
    expect(maxRedeem(2340, { ...card.loyalty!, enabled: false }, 1000)).toBe(0);
  });

  it('keeps the CRM id and points with the customer; another customer spends none of the last one’s points', () => {
    let c = setCustomer(EMPTY_CART, { id: 42, name: ' Ruwan ', points: 2340, tier: 'Gold' });
    expect(c.customer).toEqual({ id: 42, name: 'Ruwan', points: 2340, tier: 'Gold' });
    c = setRedeem(c, '5000');
    expect(c.redeem).toBe('2340');
    expect(redeemOf(c)).toBe(2340);
    c = setCustomer(c, { name: 'Walk-in Nimal' });
    expect(redeemOf(c)).toBe(0);
    expect(c.redeem).toBeUndefined();
  });
});

describe('held sales on WorkSuite', () => {
  it('reads a held sale and brings it back as a cart, the CRM customer with it', () => {
    const h = heldOf({ id: 12, label: 'Kasun', note: 'Card', lines: [{ product_id: 12, quantity: 2, name: 'Ink' }, { product_id: 0, quantity: 1 }], discount_pct: 5, customer: { name: 'Kasun', phone: '077', email: 'bad', client_id: '31' }, total: 9340, held_at: '2026-10-06 13:42:00' })!;
    expect(h.lines).toEqual([{ product_id: 12, quantity: 2, name: 'Ink' }]);
    expect(cartOfHeld(h)).toEqual({ lines: [{ product_id: 12, quantity: 2 }], customer: { name: 'Kasun', phone: '077', id: 31 }, discount: '5' });
    expect(heldOf({ id: 'x' })).toBeNull();
  });
});

describe('the catalogue’s groups and favourites', () => {
  const tree: PosCategoryNode[] = [{ id: '1', name: 'Stationery', parent_id: null, product_count: 2, children: [{ id: '7', name: 'Notebooks', parent_id: '1', product_count: 1, children: [] }] }];
  const pen = product({ id: 1, category: 'Stationery', category_id: '1' });
  const book = product({ id: 2, category: 'Notebooks', category_id: '7', favourite: true });
  const mug = product({ id: 3, category: 'Kitchen' });

  it('a group holds everything below it; a plain category is matched by name, as before', () => {
    expect([pen, book, mug].filter((p) => inCategory(p, '#1', tree, undefined)).map((p) => p.id)).toEqual([1, 2]);
    expect([pen, book, mug].filter((p) => inCategory(p, '#7', tree, undefined)).map((p) => p.id)).toEqual([2]);
    expect([pen, book, mug].filter((p) => inCategory(p, 'Kitchen', undefined, undefined)).map((p) => p.id)).toEqual([3]);
    expect([pen, book, mug].filter((p) => inCategory(p, FAVOURITES, tree, [3])).map((p) => p.id)).toEqual([2, 3]);
    expect(favouritesOf([pen, book, mug], [3]).map((p) => p.id)).toEqual([3, 2]);
    expect(categoryLabel('#7', tree, 'Favourites')).toBe('Notebooks');
    expect(categoryLabel(FAVOURITES, tree, 'Favourites')).toBe('Favourites');
  });

  it('reads stock levels and a voucher', () => {
    expect([...stockOf({ items: [{ product_id: '12', stock_state: 'low', stock_available: 3 }, { product_id: '13', out_of_stock: true, stock_available: 0 }] })]).toEqual([
      [12, { state: 'low', available: 3 }],
      [13, { state: 'out', available: 0 }],
    ]);
    expect(voucherOf({ code: 'GV-AB12', balance: 1250, status: 'spent', usable: false })).toMatchObject({ balance: 1250, usable: false });
  });
});

describe('returns: refund-to and each line’s condition', () => {
  const sold: PosSale = {
    ref: 'T1-AAAAAA-000001', created_at: '2026-09-30T08:00:00Z', terminal_id: 7, cashier_id: 5, cashier_name: 'Kasun', state: 'sent', number: 'SO-1', message: null, attempts: 1, sent_at: null,
    session_id: 41, register_id: 3, currency: 'LKR', customer: null, discount_pct: 0, totals: { subtotal: 1350, discount: 0, tax: 0, total: 1350 }, tenders: [{ method: 'cash', amount: 1350 }], change_given: 0, priced_by: 'server', catalogue_version: 'v1',
    lines: [
      { product_id: 9, code: null, name: 'Tea', quantity: 2, unit_price: 450, discount_pct: 0, tax_rate: 0, net: 900, tax: 0, total: 900 },
      { product_id: 3, code: null, name: 'Mug', quantity: 1, unit_price: 450, discount_pct: 0, tax_rate: 0, net: 450, tax: 0, total: 450 },
    ],
  };

  it('one refund with each line’s condition where the server takes it; two (restocked, not) where it does not', () => {
    const picks = { 9: { quantity: 1, condition: 'opened' as const }, 3: { quantity: 1, condition: 'faulty' as const } };
    expect(refundCalls(sold, picks, { reason: 'Faulty', conditions: true, refund_to: 'cash' })).toEqual([
      { ref: sold.ref, kind: 'refund', reason: 'Faulty', refund_to: 'cash', lines: [{ product_id: 3, quantity: 1, condition: 'faulty' }, { product_id: 9, quantity: 1, condition: 'opened' }] },
    ]);
    expect(refundCalls(sold, picks, { reason: 'Faulty', conditions: false })).toEqual([
      { ref: sold.ref, kind: 'refund', reason: 'Faulty', lines: [{ product_id: 9, quantity: 1 }] },
      { ref: sold.ref, kind: 'refund', reason: 'Faulty', lines: [{ product_id: 3, quantity: 1 }], restock: false },
    ]);
  });

  it('offers store credit only for a named customer, and no choice where the server has none', () => {
    expect(refundToOptions(sold, false)).toEqual(['original']);
    expect(refundToOptions(sold, true)).toEqual(['original', 'cash']);
    expect(refundToOptions({ ...sold, customer_id: 42 }, true)).toEqual(['original', 'cash', 'store_credit']);
  });
});

describe('the drawer’s X report from WorkSuite', () => {
  it('turns it into rows, a blind drawer’s money hidden', () => {
    const r = sessionReportOf(
      {
        kind: 'x',
        title: 'X report',
        hidden: true,
        sales: { transactions: 12, items: 30, gross: null, discounts: null, tax: null, refund_count: 1, refunds: 450, void_count: 0, voids: 0, net: null },
        tenders: null,
        drawer: { opening_float: 5000, moved_in: 0, moved_out: 1000, refund_cash: null, expected: null, counted: null, variance: null },
      },
      'LKR',
    )!;
    expect(r).toMatchObject({ kind: 'x', title: 'X report', hidden: true });
    expect(r.rows).toContainEqual({ label: 'Sales', value: '12' });
    expect(r.rows).toContainEqual({ label: 'Gross', value: '—' });
    expect(r.rows).toContainEqual({ label: 'Expected LKR', value: '—', strong: true });
    expect(sessionReportOf(null, 'LKR')).toBeNull();
  });
});

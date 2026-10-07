import { describe, expect, it } from 'vitest';
import { saleReductions, serverReductions, type PosProduct, type PosTenderOption } from '@shared/pos';
import { checkDiscount, couponCode, couponMessage, couponReasonKey, discountNeed, draftOf, expiryOf, tenderTiles } from '../../../src/modules/pos/adjust';
import { discountBody, pricedOf, pricingBody } from '../../../src/modules/pos/api';
import { amountDiscount, saleDiscount } from '../../../src/modules/pos/approval';
import { applyDiscount, clearDiscount, discountAmount, discountPct, EMPTY_CART, setDiscount } from '../../../src/modules/pos/cart';
import { translate } from '../../../src/modules/pos/i18n';
import { discountBase, estimateCart, shareOf, withDiscount } from '../../../src/modules/pos/pricing';
import { buildSale, discountOf, phase2Of, tenderProblem, type TenderRow } from '../../../src/modules/pos/tender';

/**
 * #293 — discount, coupon and gift voucher on the payment screen, as rules: the shared discount editor's checks
 * (percentage or fixed amount, never more than the sale, the cashier's ceiling, a manager past it), the coupon's
 * refusals in the cashier's words, the gift voucher's tile, and what the sale and its receipt carry.
 */
const t = (k: Parameters<typeof translate>[1], v?: Record<string, string | number>) => translate('en', k, v);
const product = (over: Partial<PosProduct>): PosProduct => ({ id: 1, code: null, barcode: null, name: 'x', unit: null, category: null, price: 0, discount_pct: 0, tax_rate: 0, ...over });
const products = new Map([product({ id: 9, name: 'Tea', price: 1450, tax_rate: 18 })].map((p) => [p.id, p] as const));
const opt = (kind: PosTenderOption['kind']): PosTenderOption => ({ kind, name: kind, opens_drawer: kind === 'cash', offline: kind === 'cash' || kind === 'card', needs_customer: false, needs_reference: kind === 'voucher' });

describe('the discount editor’s rules (both entry points)', () => {
  const rights = { allowed: true, ceiling: 10 };

  it('takes a percentage as the bottom bar always did: cut to the ceiling where nobody can approve, asked of a manager where one can', () => {
    expect(checkDiscount({ type: 'pct', value: '15' }, 1450, rights, false)).toEqual({ pct: 10, amount: null, error: null, needsApproval: false });
    expect(checkDiscount({ type: 'pct', value: '15' }, 1450, rights, true)).toEqual({ pct: 15, amount: null, error: null, needsApproval: true });
    expect(checkDiscount({ type: 'pct', value: '8' }, 1450, rights, true).needsApproval).toBe(false);
    expect(checkDiscount({ type: 'pct', value: '5' }, 1450, { allowed: false, ceiling: null }, false).error).toBeTruthy();
  });

  it('measures a fixed amount as the share it is of what it comes off, never more than the sale', () => {
    expect(shareOf(105, 1305)).toBe(8.046);
    expect(checkDiscount({ type: 'amount', value: '105' }, 1305, rights, true)).toEqual({ pct: 8.046, amount: 105, error: null, needsApproval: false });
    expect(checkDiscount({ type: 'amount', value: '200' }, 1305, rights, true)).toMatchObject({ amount: 200, needsApproval: true });
    expect(checkDiscount({ type: 'amount', value: '200' }, 1305, rights, false).error).toBe('That would take 15.3% off this sale, and 10% is the most allowed.');
    expect(checkDiscount({ type: 'amount', value: '1305.01' }, 1305, { allowed: true, ceiling: null }, false).error).toBe('A discount cannot be more than the sale comes to (1,305.00).');
    expect(checkDiscount({ type: 'amount', value: '1305' }, 1305, { allowed: true, ceiling: null }, false).error).toBeNull();
  });

  it('asks the manager for the percentage a fixed amount comes to', () => {
    const need = discountNeed(t, { pct: 15.3257, amount: 200 }, rights, (n) => n.toFixed(2));
    expect(need.ask).toEqual({ action: 'discount', amount: 15.3257, threshold: 10, subject: null });
    expect(need.message).toBe('200.00 off (15.3257%) is past what you may give here (10%).');
  });

  it('keeps the discount on the sale as given — percentage or amount, with its reason — and takes it off whole', () => {
    const pct = applyDiscount(EMPTY_CART, { type: 'pct', value: '12.5', reason: ' Loyal customer ' });
    expect(pct).toMatchObject({ discount: '12.5', discount_reason: 'Loyal customer' });
    expect(pct.discount_type).toBeUndefined();
    const amt = applyDiscount(pct, { type: 'amount', value: '1,250.50', reason: 'Damaged box' });
    expect(amt).toMatchObject({ discount: '1250.50', discount_type: 'amount', discount_reason: 'Damaged box' });
    expect(discountAmount(amt)).toBe(1250.5);
    expect(discountPct(amt, true, null)).toBe(0);
    expect(draftOf(amt)).toEqual({ type: 'amount', value: '1250.50', reason: 'Damaged box' });
    const cleared = clearDiscount(amt);
    expect(cleared).toEqual({ ...EMPTY_CART, discount: '' });
    expect(applyDiscount(amt, { type: 'amount', value: '0' }).discount_type).toBeUndefined();
    // The old percentage path forgets an amount.
    expect(setDiscount(amt, '5').discount_type).toBeUndefined();
  });

  it('gives the sale its fixed amount within the cashier’s rights, and waits for a manager past them', () => {
    const c = { discount: '200', discount_type: 'amount' as const };
    expect(saleDiscount(c, rights, true, null, undefined, 1305)).toEqual({ pct: 0, approved: null, needs: true });
    expect(saleDiscount({ ...c, discount: '100' }, rights, true, null, undefined, 1305)).toEqual({ pct: 7.6628, approved: null, needs: false, amount: 100 });
    const a = { id: 'apv_0123456789abcdef', action: 'discount' as const, amount: 15.3257, approver: 'Dilini', expires_at: null };
    expect(amountDiscount(200, rights, true, a, Date.now(), 1305)).toEqual({ pct: 15.3257, approved: 15.3257, needs: false, amount: 200 });
    expect(saleDiscount(c, { allowed: false, ceiling: null }, false, null, undefined, 1305)).toEqual({ pct: 0, approved: null, needs: false });
  });

  it('prices a fixed amount offline the way WorkSuite does: after the line discounts, before the tax', () => {
    const e = estimateCart([{ product_id: 9, quantity: 1 }], products, 0, null, 'LKR', 250);
    expect(e.error).toBeNull();
    expect(e.cart).toMatchObject({ subtotal: 1450, discount: 250, tax: 216, total: 1416, discount_type: 'amount', discount_value: 250 });
    expect(estimateCart([{ product_id: 9, quantity: 1 }], products, 0, null, 'LKR', 1500).error).toBe('A discount cannot be more than the sale comes to (1,450.00).');
  });

  it('takes an approved amount off WorkSuite’s cart after its promotions, as the server will', () => {
    const plain = pricedOf({ lines: [{ product_id: 9, quantity: 1, unit_price: 1450, discount_pct: 0, tax_rate: 18, net: 1450, tax: 235.53, total: 1540.53 }], subtotal: 1450, discount: 0, tax: 235.53, total: 1540.53, promotion_discount: 145, deduction: 145 }, 'LKR', 0);
    expect(discountBase(plain)).toBe(1305);
    const w = withDiscount(plain, 0, 105);
    expect(w).toMatchObject({ discount: 105, deduction: 250, tax: 216, total: 1416, discount_type: 'amount', discount_pct: 8.046 });
  });

  it('sends a fixed amount only to a server that takes one; the percentage otherwise', () => {
    expect(discountBody({ discount_amount: true }, 8.046, 105)).toEqual({ discount_type: 'amount', discount_value: 105 });
    expect(discountBody({}, 8.046, 105)).toEqual({ discount_pct: 8.046 });
    expect(discountBody({ discount_amount: true }, 10, null)).toEqual({ discount_pct: 10 });
  });
});

describe('coupons', () => {
  it('asks WorkSuite to say why a coupon does not apply only where it can', () => {
    expect(pricingBody({ promotions: true, coupons: true }, { coupon_code: 'TEA10' })).toEqual({ apply_promotions: true, coupon_code: 'TEA10' });
    expect(pricingBody({ promotions: true, coupons: true, coupon_validate: true }, { coupon_code: 'TEA10' })).toEqual({ apply_promotions: true, coupon_code: 'TEA10', coupon_report: true });
  });

  it('reads the coupon on WorkSuite’s cart: what it took off, or why not', () => {
    const p = pricedOf({ lines: [], subtotal: 1450, discount: 0, tax: 0, total: 1305, coupon_discount: 145, promotions: [{ id: 7, label: 'Tea 10%', amount: 145, coupon: true }], coupon: { code: 'TEA10', amount: 145, valid: true, reason: null } }, 'LKR', 0);
    expect(p.coupon).toEqual({ code: 'TEA10', amount: 145, valid: true, reason: null, message: null });
    expect(p.promotions).toEqual([{ id: 7, label: 'Tea 10%', amount: 145, coupon: true }]);
    const off = pricedOf({ lines: [], subtotal: 180, discount: 0, tax: 0, total: 180, coupon: { code: 'TEA10', amount: 0, valid: false, reason: 'not_applicable', message: 'That coupon is not valid for the items in this sale.' } }, 'LKR', 0);
    expect(off.coupon).toMatchObject({ valid: false, reason: 'not_applicable' });
  });

  it('says each refusal in the cashier’s words, WorkSuite’s own where it carries the figures', () => {
    for (const r of ['not_found', 'paused', 'expired', 'not_yet', 'used_up', 'customer_limit', 'needs_customer', 'min_spend', 'not_applicable']) expect(couponReasonKey(r)).toBe(`pos.cpn.reason.${r}`);
    expect(couponReasonKey('something_new')).toBeNull();
    expect(couponMessage(t, 'used_up', 'That coupon has been used as many times as it can be.')).toBe('That coupon has already been used as often as it can be.');
    expect(couponMessage(t, 'min_spend', 'Spend at least 2,000.00 to use that coupon; this sale comes to 1,450.00.')).toBe('Spend at least 2,000.00 to use that coupon; this sale comes to 1,450.00.');
    expect(couponMessage(t, 'not_applicable', null)).toBe('That coupon is not valid for these items.');
    expect(couponMessage(t, 'something_new', 'WorkSuite says no.')).toBe('WorkSuite says no.');
    expect(couponCode(' tea 10! ')).toBe('TEA10');
  });
});

describe('the gift voucher', () => {
  const caps = { vouchers: true, voucher_accept: true };

  it('is offered where WorkSuite takes vouchers but sent no list of tenders', () => {
    expect(tenderTiles(true, null, caps, null).map((x) => x.kind)).toEqual(['cash', 'card', 'bank_transfer', 'wallet', 'voucher']);
    expect(tenderTiles(true, null, { vouchers: true }, null).map((x) => x.kind)).not.toContain('voucher');
    expect(tenderTiles(true, null, {}, null).map((x) => x.kind)).toEqual(['cash', 'card', 'bank_transfer', 'wallet']);
  });

  it('follows the company’s own list, and is not offered to somebody who may not take one, nor offline', () => {
    expect(tenderTiles(true, [opt('cash'), opt('card')], caps, null).map((x) => x.kind)).toEqual(['cash', 'card']);
    expect(tenderTiles(true, [opt('cash'), opt('voucher')], caps, { voucher: false }).map((x) => x.kind)).toEqual(['cash']);
    expect(tenderTiles(false, null, caps, null).map((x) => x.kind)).toEqual(['cash', 'card']);
  });

  it('shows its expiry, and is not taken for more than it holds', () => {
    expect(expiryOf('2026-12-31')).toBe('31 Dec 2026');
    expect(expiryOf(null)).toBeNull();
    const rows: TenderRow[] = [{ method: 'voucher', amount: '600', reference: 'gv-1' }];
    const balances = { vouchers: { 'GV-1': { balance: 500, usable: true, expires_on: '2026-12-31' } }, credit: null };
    expect(tenderProblem(rows, { offered: [opt('voucher')], customer: null, balances, online: true })).toBe('The gift voucher GV-1 holds 500.00.');
  });
});

describe('what the sale and its receipt carry', () => {
  const cart = {
    ...pricedOf({ lines: [{ product_id: 9, name: 'Tea', quantity: 1, unit_price: 1450, discount_pct: 0, tax_rate: 18, net: 1450, tax: 216, total: 1416 }], subtotal: 1450, discount: 105, discount_pct: 8.046, discount_type: 'amount', discount_value: 105, tax: 216, total: 1416, promotion_discount: 145, coupon_discount: 145, deduction: 250, promotions: [{ id: 7, label: 'Tea 10%', amount: 145, coupon: true }], coupon: { code: 'TEA10', amount: 145, valid: true } }, 'LKR', 0),
  };
  const ctx = { session_id: 41, register_id: 3, currency: 'LKR', customer: null, cart, source: 'server' as const, catalogue_version: 'v1', promotions: true, coupon: 'TEA10', discount: { type: 'amount' as const, value: 105, reason: 'Damaged box' } };

  it('states the fixed amount, its reason and the coupon; the coupon is not among the promotions again', () => {
    const sale = buildSale(ctx, [{ method: 'cash', amount: '1416', reference: '' }]);
    expect('error' in sale).toBe(false);
    expect(sale).toMatchObject({ discount_pct: 8.046, discount_type: 'amount', discount_value: 105, discount_reason: 'Damaged box', coupon_code: 'TEA10', coupon: { code: 'TEA10', amount: 145 }, totals: { discount: 250, total: 1416 } });
    expect(phase2Of(ctx).promotions).toBeUndefined();
    expect(discountOf({ cart: { ...cart, discount: 0 }, discount: ctx.discount })).toEqual({});
  });

  it('prints the coupon, the promotions, the points and the discount with its reason, each on its own line', () => {
    const sale = buildSale(ctx, [{ method: 'cash', amount: '1416', reference: '' }]);
    if ('error' in sale) throw new Error(sale.error);
    expect(saleReductions(sale)).toEqual([
      { label: 'Coupon TEA10', amount: 145, note: null },
      { label: 'Discount', amount: 105, note: 'Damaged box' },
    ]);
    expect(saleReductions({ totals: { subtotal: 900, discount: 90, tax: 0, total: 810 }, discount_pct: 10 })).toEqual([{ label: 'Discount 10%', amount: 90, note: null }]);
  });

  it('prints WorkSuite’s parts where it kept them, and its one Discount line where it did not', () => {
    const totals = { subtotal: 1450, discount: 310, tax: 0, total: 1140 };
    expect(serverReductions({ totals, promotions: [{ label: 'Tea week', amount: 60 }], adjustments: { coupon: { code: 'TEA10', amount: 145 }, discount: { type: 'pct', value: 7.5, amount: 105, reason: 'Loyal' } } })).toEqual([
      { label: 'Coupon TEA10', amount: 145, note: null },
      { label: 'Discount 7.5%', amount: 105, note: 'Loyal' },
      { label: 'Tea week', amount: 60, note: null },
    ]);
    expect(serverReductions({ totals: { ...totals, discount: 60 }, promotions: [{ label: 'Tea week', amount: 60 }] })).toEqual([
      { label: 'Discount', amount: 60, note: null },
      { label: '  Tea week', amount: 60, note: null },
    ]);
  });
});

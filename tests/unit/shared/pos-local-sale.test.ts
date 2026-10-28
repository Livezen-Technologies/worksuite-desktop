import { describe, expect, it } from 'vitest';
import { expectedCash, lineParts, receiptRef, settle, tenderProblem, totalsOf, variance, type CartLine } from '@shared/pos-local-sale';

const line = (over: Partial<CartLine> = {}): CartLine => ({ productId: 'p1', name: 'Tea', unitPrice: 1000, qty: 1, taxRate: 0, discount: 0, ...over });

describe('what an offline sale comes to', () => {
  it('takes the tax out of a shelf price that already has it in', () => {
    expect(lineParts(1150, 15, 'inclusive')).toEqual({ net: 1000, tax: 150 });
    expect(lineParts(1000, 15, 'exclusive')).toEqual({ net: 1000, tax: 150 });
    expect(lineParts(1000, 0, 'inclusive')).toEqual({ net: 1000, tax: 0 });
  });

  it('adds up a plain sale', () => {
    const t = totalsOf([line({ qty: 2 }), line({ productId: 'p2', unitPrice: 250 })], { mode: 'exclusive' });
    expect(t.gross).toBe(2250);
    expect(t.net).toBe(2250);
    expect(t.tax).toBe(0);
    expect(t.total).toBe(2250);
  });

  it('keeps the tax lines adding up to the total when a sale discount is spread', () => {
    const lines = [line({ unitPrice: 1000, taxRate: 15 }), line({ productId: 'p2', unitPrice: 333, taxRate: 8 }), line({ productId: 'p3', unitPrice: 667, taxRate: 15 })];
    const t = totalsOf(lines, { mode: 'exclusive', saleDiscount: 500 });
    expect(t.net + t.tax).toBe(t.total);
    expect(t.taxLines.reduce((n, l) => n + l.net, 0)).toBe(t.net);
    expect(t.taxLines.reduce((n, l) => n + l.tax, 0)).toBe(t.tax);
    /* The discount is spread, not dropped: the net is the goods less the discount. */
    expect(t.net).toBe(1000 + 333 + 667 - 500);
  });

  it('never loses a cent of a discount that does not divide', () => {
    const lines = [line({ unitPrice: 333 }), line({ productId: 'p2', unitPrice: 333 }), line({ productId: 'p3', unitPrice: 334 })];
    const t = totalsOf(lines, { mode: 'exclusive', saleDiscount: 100 });
    expect(t.net).toBe(900);
    expect(t.discount).toBe(100);
  });

  it('will not discount more than the sale is worth', () => {
    const t = totalsOf([line({ unitPrice: 500 })], { mode: 'exclusive', saleDiscount: 900 });
    expect(t.net).toBe(0);
    expect(t.total).toBe(0);
  });

  it('rounds cash to the nearest five, and says what that did', () => {
    const t = totalsOf([line({ unitPrice: 1003, taxRate: 0 })], { mode: 'exclusive', rounding: 5 });
    expect(t.total).toBe(1005);
    expect(t.rounding).toBe(2);
    const down = totalsOf([line({ unitPrice: 1002 })], { mode: 'exclusive', rounding: 5 });
    expect(down.total).toBe(1000);
    expect(down.rounding).toBe(-2);
  });

  it('gives change out of cash only', () => {
    expect(settle(1000, [{ kind: 'cash', amount: 2000 }])).toEqual({ paid: 2000, due: 0, change: 1000 });
    expect(settle(1000, [{ kind: 'card', amount: 600 }, { kind: 'cash', amount: 500 }])).toEqual({ paid: 1100, due: 0, change: 100 });
    expect(settle(1000, [{ kind: 'card', amount: 400 }])).toEqual({ paid: 400, due: 600, change: 0 });
  });

  it('refuses a card for more than is due, because there is no change to give', () => {
    expect(tenderProblem(1000, [], { kind: 'card', amount: 1500 })).toMatch(/Only cash/);
    expect(tenderProblem(1000, [], { kind: 'cash', amount: 1500 })).toBeNull();
    expect(tenderProblem(1000, [], { kind: 'cash', amount: 0 })).toMatch(/Enter an amount/);
  });

  it('numbers a receipt so a person can read it back', () => {
    expect(receiptRef('t1', '2026-10-29', 7)).toBe('T1-20261029-0007');
  });

  it('says what the drawer should hold, and by how much it is out', () => {
    const expected = expectedCash({ float: 10_000, cashSales: 25_000, cashRefunds: 1_500, paidIn: 2_000, paidOut: 500, change: 4_000 });
    expect(expected).toBe(31_000);
    expect(variance(30_500, expected)).toBe(-500);
    expect(variance(31_200, expected)).toBe(200);
  });
});

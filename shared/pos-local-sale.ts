/**
 * Selling on an offline till (ENH-POS-01 §1, phase 2): what a sale comes to, what the drawer should hold, and how
 * a receipt is numbered — as rules with no database in them.
 *
 * Money is whole minor units (cents) throughout. An offline till is the system of record for its own sales: there
 * is no server to price them again, so a rounding difference here is a real one in somebody's drawer at the end of
 * the day. Floating point never touches a total.
 */

/** A product as the offline till keeps it. Prices are minor units; `taxRate` is a percentage, 15 for 15 %. */
export interface LocalProduct {
  id: string;
  sku: string;
  barcode: string | null;
  name: string;
  /** One unit, in minor units. Tax-inclusive or not, as the till is set (`PosLocalTaxMode`). */
  price: number;
  taxRate: number;
  /** Null for something not counted, such as a service. */
  stock: number | null;
  active: boolean;
}

/** Whether the price on the shelf already has the tax in it. A shop is one or the other, never both. */
export type PosLocalTaxMode = 'inclusive' | 'exclusive';

export interface CartLine {
  productId: string;
  name: string;
  unitPrice: number;
  qty: number;
  taxRate: number;
  /** Taken off this line before tax, in minor units. */
  discount: number;
}

export interface SaleTotals {
  /** The lines before any discount, as they are priced on the shelf. */
  gross: number;
  /** Line discounts plus the sale's own. */
  discount: number;
  /** What the goods come to, with tax out of it. */
  net: number;
  tax: number;
  /** What the customer pays, after rounding. */
  total: number;
  /** What rounding added or took off (cash rounding to the nearest 5 or 10 minor units). */
  rounding: number;
  /** Per rate, for the receipt's tax lines. */
  taxLines: Array<{ rate: number; net: number; tax: number }>;
}

/** Cash rounding: 1 keeps the cent, 5 rounds to the nearest five, 10 to the nearest ten. */
export type CashRounding = 1 | 5 | 10;

const roundHalfUp = (n: number): number => Math.sign(n) * Math.round(Math.abs(n));

/** Splits a line into net and tax, from a price that may or may not have the tax in it. */
export function lineParts(amount: number, taxRate: number, mode: PosLocalTaxMode): { net: number; tax: number } {
  if (!taxRate) return { net: amount, tax: 0 };
  if (mode === 'inclusive') {
    const net = roundHalfUp((amount * 100) / (100 + taxRate));
    return { net, tax: amount - net };
  }
  return { net: amount, tax: roundHalfUp((amount * taxRate) / 100) };
}

/**
 * What a sale comes to. The sale's own discount is spread across the lines in proportion to what each contributes,
 * with the remainder going to the largest line, so the tax per rate still adds up to the total the customer pays.
 */
export function totalsOf(lines: CartLine[], opts: { mode: PosLocalTaxMode; saleDiscount?: number; rounding?: CashRounding }): SaleTotals {
  const mode = opts.mode;
  const gross = lines.reduce((n, l) => n + l.unitPrice * l.qty, 0);
  const lineDiscounts = lines.reduce((n, l) => n + l.discount, 0);
  const afterLines = lines.map((l) => ({ line: l, amount: l.unitPrice * l.qty - l.discount }));
  const base = afterLines.reduce((n, a) => n + a.amount, 0);
  const saleDiscount = Math.max(0, Math.min(opts.saleDiscount ?? 0, base));

  /* Spread the sale's discount by share, then give the remainder to the biggest line: no cent goes missing. */
  const shares = afterLines.map((a) => (base > 0 ? Math.floor((saleDiscount * a.amount) / base) : 0));
  let left = saleDiscount - shares.reduce((n, s) => n + s, 0);
  if (left > 0 && afterLines.length) {
    const biggest = afterLines.reduce((best, a, i) => (a.amount > afterLines[best]!.amount ? i : best), 0);
    shares[biggest] = (shares[biggest] ?? 0) + left;
    left = 0;
  }

  const byRate = new Map<number, { net: number; tax: number }>();
  for (const [i, a] of afterLines.entries()) {
    const amount = a.amount - (shares[i] ?? 0);
    const { net, tax } = lineParts(amount, a.line.taxRate, mode);
    const at = byRate.get(a.line.taxRate) ?? { net: 0, tax: 0 };
    byRate.set(a.line.taxRate, { net: at.net + net, tax: at.tax + tax });
  }

  const net = [...byRate.values()].reduce((n, v) => n + v.net, 0);
  const tax = [...byRate.values()].reduce((n, v) => n + v.tax, 0);
  const beforeRounding = net + tax;
  const step = opts.rounding ?? 1;
  const total = step === 1 ? beforeRounding : roundHalfUp(beforeRounding / step) * step;

  return {
    gross,
    discount: lineDiscounts + saleDiscount,
    net,
    tax,
    total,
    rounding: total - beforeRounding,
    taxLines: [...byRate.entries()].sort((a, b) => a[0] - b[0]).map(([rate, v]) => ({ rate, net: v.net, tax: v.tax })),
  };
}

export type TenderKind = 'cash' | 'card' | 'voucher' | 'other';

export interface Tender {
  kind: TenderKind;
  /** What was handed over, in minor units. Cash may be more than the total; the difference is change. */
  amount: number;
  reference?: string | null;
}

export interface Settlement {
  paid: number;
  /** What is still owed. Zero when the sale is settled. */
  due: number;
  /** Change out of the drawer. Only cash gives change. */
  change: number;
}

/** What is paid, owed and given back. Only cash over the total becomes change; anything else is refused by `tenderProblem`. */
export function settle(total: number, tenders: Tender[]): Settlement {
  const paid = tenders.reduce((n, t) => n + t.amount, 0);
  const cash = tenders.filter((t) => t.kind === 'cash').reduce((n, t) => n + t.amount, 0);
  const over = Math.max(0, paid - total);
  return { paid, due: Math.max(0, total - paid), change: Math.min(over, cash) };
}

/** Why this tender cannot be taken, or null. */
export function tenderProblem(total: number, tenders: Tender[], next: Tender): string | null {
  if (next.amount <= 0) return 'Enter an amount.';
  const { paid } = settle(total, tenders);
  const over = paid + next.amount - total;
  if (over > 0 && next.kind !== 'cash') return 'Only cash can be more than the amount due — the rest would have no change.';
  return null;
}

/**
 * A receipt number: the till's own letters, the day, and a number that starts again each day — `T1-20261029-0007`.
 * It is what identifies the sale everywhere, including to WorkSuite when the till is connected later, so it has to
 * be unique on this till for ever and readable to a person reading a paper receipt.
 */
export function receiptRef(tillCode: string, day: string, seq: number): string {
  return `${tillCode.toUpperCase()}-${day.replace(/-/g, '')}-${String(seq).padStart(4, '0')}`;
}

export interface DrawerCount {
  /** What the drawer started with. */
  float: number;
  cashSales: number;
  cashRefunds: number;
  paidIn: number;
  paidOut: number;
  change: number;
}

/** What the drawer should hold now. Change given is money that left it. */
export function expectedCash(c: DrawerCount): number {
  return c.float + c.cashSales + c.paidIn - c.cashRefunds - c.paidOut - c.change;
}

/** Counted minus expected: positive is over, negative is short. */
export function variance(counted: number, expected: number): number {
  return counted - expected;
}

/** A shop decides what difference is worth a word. Anything above this is said plainly at close. */
export const VARIANCE_NOTE = 100;

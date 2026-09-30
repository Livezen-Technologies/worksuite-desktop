import { saleFlags, type PosReport, type PosSale, type PosSaleFlag } from '@shared/pos';
import type { CloseBody, PosMovement, PosSession } from './api';
import { countBody, formatMoney, parseAmount, type CountLine } from './pricing';

/**
 * The shift's rules the screens apply before asking WorkSuite, and the X and Z reports. The figures are WorkSuite's
 * (the session: float, what moved in and out, what the drawer should hold, the variance); what this till sold comes
 * from its own record of its sales, shown beside them. Pure, so they are tested without a screen.
 */

/**
 * Which sales the history shows, as WorkSuite's review filter (`GET sales?review=1|price_differs|payment_missing|late`)
 * reads them — here from this till's own record: every sale, those flagged at all, or those with one flag.
 */
export type ReviewFilter = 'all' | 'review' | PosSaleFlag;

export function filterSales(sales: PosSale[], f: ReviewFilter): PosSale[] {
  if (f === 'all') return sales;
  return sales.filter((s) => {
    const flags = saleFlags(s);
    return f === 'review' ? flags.length > 0 : flags.includes(f);
  });
}

/** What closing sends: the notes and coins counted, or one figure (not where the company counts note by note), and why it is different when it is. */
export function closeBody(counts: CountLine[], counted: string, reason: string, rules: { count_to_close?: boolean } = {}): CloseBody | { error: string } {
  const piles = countBody(counts);
  const body: CloseBody = {};
  if (piles.length) body.denominations = piles;
  else if (rules.count_to_close) return { error: 'This company counts the drawer note by note before it closes.' };
  else {
    const v = parseAmount(counted);
    if (!Number.isFinite(v) || v < 0) return { error: 'Count the drawer: the notes and coins, or what it holds.' };
    body.counted_cash = Math.round(v * 100) / 100;
  }
  if (reason.trim()) body.variance_reason = reason.trim().slice(0, 300);
  return body;
}

/**
 * Whether the difference must be explained before the drawer closes — WorkSuite's rule (`Registers::needsReason`):
 * a cent or more out, and past the company's tolerance. Under a blind close the cashier never saw the figure, so none
 * is asked for (and the difference is unknown here anyway).
 */
export function needsReason(diff: number | null, tolerance: number | null | undefined, blind: boolean): boolean {
  if (blind || diff == null) return false;
  return Math.abs(diff) >= 0.01 && Math.abs(diff) > (tolerance ?? 0) + 0.001;
}

export interface SalesSummary {
  count: number;
  total: number;
  /** Given back by WorkSuite (refunds and voids), already taken off the total and the tenders. */
  refunded: number;
  /** What each tender took, cash net of the change given. */
  byTender: Record<string, number>;
  waiting: number;
  refused: number;
}

/** What this till sold: sales WorkSuite refused are not counted, those still on their way are. */
export function salesSummary(sales: PosSale[]): SalesSummary {
  const out: SalesSummary = { count: 0, total: 0, refunded: 0, byTender: {}, waiting: 0, refused: 0 };
  for (const s of sales) {
    if (s.state === 'refused') {
      out.refused++;
      continue;
    }
    if (s.state === 'waiting') out.waiting++;
    out.count++;
    out.total += s.totals.total;
    for (const t of s.tenders) out.byTender[t.method] = (out.byTender[t.method] ?? 0) + t.amount;
    if (s.change_given) out.byTender.cash = (out.byTender.cash ?? 0) - s.change_given;
    for (const r of s.returns ?? []) {
      out.refunded += r.amount;
      out.total -= r.amount;
      for (const t of r.tenders) out.byTender[t.method] = (out.byTender[t.method] ?? 0) - t.amount;
    }
  }
  out.total = Math.round(out.total * 100) / 100;
  out.refunded = Math.round(out.refunded * 100) / 100;
  for (const k of Object.keys(out.byTender)) out.byTender[k] = Math.round(out.byTender[k]! * 100) / 100;
  return out;
}

const METHOD: Record<string, string> = { cash: 'Cash', card: 'Card', bank_transfer: 'Bank transfer', wallet: 'Wallet' };

function salesRows(sum: SalesSummary, currency: string): PosReport['rows'] {
  const rows: PosReport['rows'] = [
    { label: 'Sales at this till', value: String(sum.count) },
    { label: 'Sales total', value: formatMoney(sum.total, currency), strong: true },
  ];
  for (const [m, v] of Object.entries(sum.byTender)) rows.push({ label: `  ${METHOD[m] ?? m}`, value: formatMoney(v) });
  if (sum.refunded) rows.push({ label: 'Refunded (in the total)', value: formatMoney(-sum.refunded) });
  if (sum.waiting) rows.push({ label: 'Not yet at WorkSuite', value: String(sum.waiting) });
  if (sum.refused) rows.push({ label: 'Refused by WorkSuite', value: String(sum.refused) });
  return rows;
}

/** The X report: the shift so far, the drawer open. Under a blind close the expected cash is not printed. */
export function xReport(session: PosSession, sum: SalesSummary, movements: PosMovement[], now: string): PosReport {
  const c = session.currency;
  const rows: PosReport['rows'] = [
    { label: 'Register', value: session.register_code ?? session.register ?? String(session.register_id) },
    { label: 'Cashier', value: session.cashier ?? '' },
    { label: 'Opened', value: session.opened_at ?? '' },
    { rule: true },
    { label: 'Opening float', value: formatMoney(session.opening_float) },
    ...salesRows(sum, c),
    { rule: true },
    { label: 'Cash put in', value: formatMoney(session.takings?.moved_in ?? movements.filter((m) => m.direction === 'in').reduce((a, m) => a + m.amount, 0)) },
    { label: 'Cash taken out', value: formatMoney(session.takings?.moved_out ?? movements.filter((m) => m.direction === 'out').reduce((a, m) => a + m.amount, 0)) },
  ];
  if (!session.blind && session.takings?.expected != null) rows.push({ label: 'Drawer should hold', value: formatMoney(session.takings.expected, c), strong: true });
  return { title: 'X report', subtitle: `Shift ${session.id} · ${now}`, rows };
}

/** The Z report: the shift closed, WorkSuite's expected, counted and variance. */
export function zReport(session: PosSession, sum: SalesSummary): PosReport {
  const c = session.currency;
  const rows: PosReport['rows'] = [
    { label: 'Register', value: session.register_code ?? session.register ?? String(session.register_id) },
    { label: 'Cashier', value: session.cashier ?? '' },
    { label: 'Opened', value: session.opened_at ?? '' },
    { label: 'Closed', value: session.closed_at ?? '' },
    { rule: true },
    { label: 'Opening float', value: formatMoney(session.opening_float) },
    ...salesRows(sum, c),
    { rule: true },
    { label: 'Expected in drawer', value: formatMoney(session.expected_cash) },
    { label: 'Counted', value: formatMoney(session.counted_cash) },
    { label: 'Difference', value: formatMoney(session.variance, c), strong: true },
  ];
  if (session.variance_reason) rows.push({ label: 'Reason', value: session.variance_reason.slice(0, 40) });
  if (session.closed_by_name) rows.push({ label: 'Closed by', value: session.closed_by_name });
  return { title: 'Z report', subtitle: `Shift ${session.id}`, rows };
}

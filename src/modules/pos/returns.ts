import type { PosGiveBack, PosLineCondition, PosRefundTo, PosSale } from '@shared/pos';

/**
 * Refunds and voids of this till's sales, as rules with no screen in them. WorkSuite decides — what may go back, on
 * which tenders, how much cash leaves the drawer — and answers with it; these only say what is still there to give
 * back (what was sold less what WorkSuite already took back, by product) and what a refund of some lines asks for.
 */
export interface Refundable {
  product_id: number;
  name: string;
  sold: number;
  returned: number;
  left: number;
}

const round4 = (n: number) => Math.round(n * 10_000) / 10_000;

/** Each line of the sale with what is left to refund. */
export function refundable(sale: PosSale): Refundable[] {
  const back = new Map<number, number>();
  for (const r of sale.returns ?? []) for (const l of r.lines) if (l.product_id) back.set(l.product_id, (back.get(l.product_id) ?? 0) + l.quantity);
  return sale.lines.map((l) => {
    const returned = Math.min(l.quantity, back.get(l.product_id) ?? 0);
    return { product_id: l.product_id, name: l.name, sold: l.quantity, returned, left: round4(Math.max(0, l.quantity - returned)) };
  });
}

/** Whether anything is left to give back: not voided, and not every line already refunded. */
export function canStillRefund(sale: PosSale): boolean {
  return !sale.voided && refundable(sale).some((l) => l.left > 0);
}

/**
 * What a refund asks for: nothing named (every line left) when all is refunded, else the quantities picked, each
 * within what is left. Null when nothing was picked.
 */
export function refundLines(sale: PosSale, picks: Record<number, number> | 'all'): Array<{ product_id: number; quantity: number }> | undefined | null {
  if (picks === 'all') return undefined;
  const left = new Map(refundable(sale).map((l) => [l.product_id, l.left] as const));
  const out = Object.entries(picks)
    .map(([id, q]) => ({ product_id: Number(id), quantity: round4(Math.min(left.get(Number(id)) ?? 0, Math.max(0, q || 0))) }))
    .filter((l) => l.quantity > 0);
  return out.length ? out : null;
}

/** How much WorkSuite has given back on the sale, and the cash of it that left the drawer. */
export function returned(sale: PosSale): { amount: number; cash: number } {
  let amount = 0;
  let cash = 0;
  for (const r of sale.returns ?? []) {
    amount += r.amount;
    cash += r.cash_out;
  }
  return { amount: Math.round(amount * 100) / 100, cash: Math.round(cash * 100) / 100 };
}

/**
 * The refunds a return asks for. With each line's condition (`capabilities.line_condition`): one refund, every line
 * with its condition — WorkSuite restocks resaleable and opened goods, not damaged or faulty ones. On an older server:
 * one refund of the goods to sell again and one, not restocked, of the damaged ones. `refund_to` only where the person
 * chose other than "as paid" (`capabilities.refund_to`).
 */
export function refundCalls(
  sale: PosSale,
  picks: Record<number, { quantity: number; condition: 'resell' | 'damaged' | PosLineCondition }>,
  o: { reason: string; conditions: boolean; refund_to?: PosRefundTo },
): PosGiveBack[] {
  const base = { ref: sale.ref, kind: 'refund' as const, reason: o.reason, ...(o.refund_to && o.refund_to !== 'original' ? { refund_to: o.refund_to } : {}) };
  if (o.conditions) {
    const lines = refundLines(sale, Object.fromEntries(Object.entries(picks).map(([id, p]) => [id, p.quantity])));
    if (!lines) return [];
    const cond = (id: number): PosLineCondition => {
      const c = picks[id]?.condition;
      return c === 'resell' || !c ? 'resaleable' : c === 'damaged' ? 'damaged' : c;
    };
    return [{ ...base, lines: lines.map((l) => ({ ...l, condition: cond(l.product_id) })) }];
  }
  const out: PosGiveBack[] = [];
  for (const restock of [true, false]) {
    const chosen = Object.entries(picks).filter(([, p]) => (p.condition === 'damaged' || p.condition === 'faulty') !== restock);
    const lines = refundLines(sale, Object.fromEntries(chosen.map(([id, p]) => [id, p.quantity])));
    if (lines) out.push({ ...base, lines, ...(restock ? {} : { restock: false }) });
  }
  return out;
}

/** Where a refund's money may go: as paid always; cash and store credit where WorkSuite takes the choice — credit only for a named customer. */
export function refundToOptions(sale: PosSale, supported: boolean): PosRefundTo[] {
  if (!supported) return ['original'];
  return sale.customer_id || sale.customer?.id ? ['original', 'cash', 'store_credit'] : ['original', 'cash'];
}

/** What a quantity of one line comes to, as the till charged it (an estimate: WorkSuite works out the refund). */
export function estimateLine(sale: PosSale, productId: number, quantity: number): number {
  const l = sale.lines.find((x) => x.product_id === productId);
  return l && l.quantity > 0 ? Math.round((l.total / l.quantity) * quantity * 100) / 100 : 0;
}

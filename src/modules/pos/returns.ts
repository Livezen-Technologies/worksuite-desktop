import type { PosSale } from '@shared/pos';

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

import type { PosApprovalAsk } from '@shared/pos';
import { createStore, useStore } from '../../core/store';
import type { CartState } from './cart';
import type { Approval } from './desk';
import { shareOf } from './pricing';

/**
 * A manager's approval at the counter, as rules with no screen in them (D09). WorkSuite decides who must ask: a
 * discount past the cashier's own rights (`can.discount`, `max_discount_pct`), and a refund, void or cash out past the
 * company's figure (`approvals.manager_above_amount`). The till asks before it sends where it knows the rule (a
 * discount, a figure), and otherwise when WorkSuite answers `approval_required`. An approval is a short-lived token
 * (five minutes, spent once) kept in this window's memory only — never with a sale on disk, never a PIN.
 */

export interface DiscountRights {
  allowed: boolean;
  ceiling: number | null;
}

/** Whether this percentage off is past what the cashier may give (`Approvals::needed` for `discount`). */
export function discountNeedsApproval(pct: number, rights: DiscountRights): boolean {
  if (!(pct > 0)) return false;
  if (!rights.allowed) return true;
  return rights.ceiling !== null && rights.ceiling > 0 && pct > rights.ceiling + 0.0001;
}

/** Whether a refund, void or cash out of this much needs a manager (the company's figure; 0 or unknown: nobody). */
export function moneyNeedsApproval(amount: number, above: number | null | undefined, mayApprove = false): boolean {
  return !mayApprove && typeof above === 'number' && above > 0 && Math.round(amount * 100) / 100 > above + 0.005;
}

/** Whether an approval still covers this: the same action, at least this much, and not lapsed. */
export function covers(a: Approval | null | undefined, action: PosApprovalAsk['action'], amount: number, now = Date.now()): boolean {
  if (!a || a.action !== action || a.amount + 0.0001 < amount) return false;
  if (!a.expires_at) return true;
  const at = Date.parse(a.expires_at.includes('T') || a.expires_at.endsWith('Z') ? a.expires_at : `${a.expires_at.replace(' ', 'T')}Z`);
  return !Number.isFinite(at) || at > now;
}

/**
 * The discount a sale carries, with approvals in play (`capabilities.approvals`): what was typed when the cashier may
 * give it, or a manager approved it; otherwise only what the cashier may give, and `needs` says a manager is wanted.
 * Without approvals on the server, exactly the old rule: never past the cashier's ceiling, none without the right.
 */
export function saleDiscount(
  c: Pick<CartState, 'discount' | 'discount_type'>,
  rights: DiscountRights,
  approvals: boolean,
  approval: Approval | null | undefined,
  now = Date.now(),
  /** What a fixed amount comes off (`discountBase`): it is measured as the percentage it is of that (#293). */
  base: number | null = null,
): { pct: number; approved: number | null; needs: boolean; amount?: number } {
  if (c.discount_type === 'amount') return amountDiscount(Number(c.discount) || 0, rights, approvals, approval, now, base);
  const typed = Math.max(0, Math.min(100, Number(c.discount) || 0));
  const own = !rights.allowed ? 0 : rights.ceiling !== null && rights.ceiling > 0 ? Math.min(typed, rights.ceiling) : typed;
  if (!approvals || !discountNeedsApproval(typed, rights)) return { pct: own, approved: null, needs: false };
  if (covers(approval, 'discount', typed, now)) return { pct: typed, approved: typed, needs: false };
  return { pct: own, approved: null, needs: true };
}

/**
 * A fixed amount off (#293), held to the same rights as a percentage: its share of what it comes off (`shareOf`) is
 * what the cashier's ceiling and a manager's approval measure. Within the cashier's rights (or with no approvals on the
 * server, where WorkSuite refuses what is past them) the amount stands; past them it waits for a manager — and the
 * sale carries no discount until one approves at least that share.
 */
export function amountDiscount(value: number, rights: DiscountRights, approvals: boolean, approval: Approval | null | undefined, now = Date.now(), base: number | null = null): { pct: number; approved: number | null; needs: boolean; amount?: number } {
  const amount = Math.round(Math.max(0, value) * 100) / 100;
  if (!(amount > 0)) return { pct: 0, approved: null, needs: false };
  const pct = base === null ? 0 : shareOf(amount, base);
  if (!approvals || !discountNeedsApproval(base === null ? 0.0001 : pct, rights)) {
    return rights.allowed ? { pct, approved: null, needs: false, amount } : { pct: 0, approved: null, needs: false };
  }
  if (base !== null && covers(approval, 'discount', pct, now)) return { pct, approved: pct, needs: false, amount };
  return { pct: 0, approved: null, needs: true };
}

/** The approvals given on this till's open sales (by sale id): in memory, gone with the window. */
export const saleApprovals = createStore<{ bySale: Record<string, Approval> }>({ bySale: {} });

export const approvalActions = {
  set: (saleId: string, a: Approval) => saleApprovals.set((m) => ({ bySale: { ...m.bySale, [saleId]: a } })),
  drop: (saleId: string) =>
    saleApprovals.set((m) => {
      if (!(saleId in m.bySale)) return m;
      const { [saleId]: _gone, ...rest } = m.bySale;
      return { bySale: rest };
    }),
  get: (saleId: string): Approval | null => saleApprovals.get().bySale[saleId] ?? null,
};

export function useSaleApproval(saleId: string): Approval | null {
  return useStore(saleApprovals, (m) => m.bySale[saleId] ?? null);
}

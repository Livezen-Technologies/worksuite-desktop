import type { PosApprovalAsk } from '@shared/pos';
import { createStore, useStore } from '../../core/store';
import type { CartState } from './cart';
import type { Approval } from './desk';

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
export function saleDiscount(c: Pick<CartState, 'discount'>, rights: DiscountRights, approvals: boolean, approval: Approval | null | undefined, now = Date.now()): { pct: number; approved: number | null; needs: boolean } {
  const typed = Math.max(0, Math.min(100, Number(c.discount) || 0));
  const own = !rights.allowed ? 0 : rights.ceiling !== null && rights.ceiling > 0 ? Math.min(typed, rights.ceiling) : typed;
  if (!approvals || !discountNeedsApproval(typed, rights)) return { pct: own, approved: null, needs: false };
  if (covers(approval, 'discount', typed, now)) return { pct: typed, approved: typed, needs: false };
  return { pct: own, approved: null, needs: true };
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

import type { PosApprovalNeed, PosTenderOption } from '@shared/pos';
import { OFFLINE_TENDERS } from '@shared/pos';
import type { PosCan, PosCapabilities } from './api';
import { discountNeedsApproval, type DiscountRights } from './approval';
import type { CartState } from './cart';
import type { PosKey } from './i18n';
import { allowedTenders, ceilingMessage, overMessage, shareOf } from './pricing';

/**
 * The payment screen's adjustments (#293), as rules with no screen in them: the cashier's discount — a percentage or a
 * fixed amount, with a reason — as the shared editor checks it, the coupon's refusals in the cashier's words, and the
 * gift voucher's tile. Both ways to a discount (the bottom bar's Discount and the payment screen's Add discount) go
 * through `checkDiscount`, so they give the same result. WorkSuite checks all of it again when it prices the cart and
 * when the sale arrives.
 */

export type DiscountKind = 'pct' | 'amount';

export interface DiscountDraft {
  type: DiscountKind;
  /** As typed on the pad. */
  value: string;
  reason: string;
}

/** The discount on the sale, as the editor starts from it. */
export function draftOf(c: Pick<CartState, 'discount' | 'discount_type' | 'discount_reason'>): DiscountDraft {
  return { type: c.discount_type === 'amount' ? 'amount' : 'pct', value: c.discount, reason: c.discount_reason ?? '' };
}

export interface DiscountCheck {
  /** The percentage it comes to (an amount: its share of `base`). */
  pct: number;
  /** The money, for a fixed amount. */
  amount: number | null;
  /** Why it cannot be given as it stands (past the sale; past the cashier's rights where nobody can approve). */
  error: string | null;
  /** Past the cashier's own rights, where a manager can approve (`capabilities.approvals`). */
  needsApproval: boolean;
}

/**
 * A discount as typed, against what it comes off (`base`: the goods after their list discounts and the promotions) and
 * the cashier's rights. A percentage past the ceiling is cut to it where nobody can approve (as the bottom bar always
 * did); an amount cannot be cut, so it is refused with WorkSuite's own sentence. Never more than the sale.
 */
export function checkDiscount(d: Pick<DiscountDraft, 'type' | 'value'>, base: number, rights: DiscountRights, approvals: boolean): DiscountCheck {
  const v = Math.max(0, Number(d.value) || 0);
  if (d.type === 'pct') {
    let pct = Math.min(100, v);
    if (!approvals && rights.ceiling != null && rights.ceiling > 0) pct = Math.min(pct, rights.ceiling);
    const needs = approvals && discountNeedsApproval(pct, rights);
    const error = !approvals && pct > 0 && !rights.allowed ? 'You may not give a discount at the till here.' : null;
    return { pct, amount: null, error, needsApproval: needs };
  }
  const amount = Math.round(v * 100) / 100;
  if (amount > base + 0.004) return { pct: 100, amount, error: overMessage(base), needsApproval: false };
  const pct = shareOf(amount, base);
  const past = discountNeedsApproval(pct, rights);
  if (past && !approvals) {
    return { pct, amount, error: rights.allowed && rights.ceiling != null ? ceilingMessage(pct, rights.ceiling) : 'You may not give a discount at the till here.', needsApproval: false };
  }
  return { pct, amount: amount > 0 ? amount : null, error: null, needsApproval: approvals && past };
}

/** What the manager is asked to approve for a discount: its percentage (an amount: the share it comes to). */
export function discountNeed(t: (k: PosKey, v?: Record<string, string | number>) => string, check: Pick<DiscountCheck, 'pct' | 'amount'>, rights: DiscountRights, money: (n: number) => string): PosApprovalNeed {
  const max = rights.allowed ? (rights.ceiling ?? 100) : 0;
  return {
    code: 'approval_required',
    message: check.amount !== null ? t('pos.ovr.amountAsk', { n: money(check.amount), pct: check.pct, max }) : t('pos.ovr.discountAsk', { n: check.pct, max }),
    ask: { action: 'discount', amount: check.pct, threshold: rights.allowed ? rights.ceiling : 0, subject: null },
  };
}

/* ── Coupons ─────────────────────────────────────────────────────────── */

const COUPON_REASONS = ['not_found', 'paused', 'expired', 'not_yet', 'used_up', 'customer_limit', 'needs_customer', 'min_spend', 'not_applicable'] as const;

/** The till's words for why a coupon is refused (`Coupons::REASONS`), or null for a reason it does not know (WorkSuite's sentence is shown). */
export function couponReasonKey(reason: string | null | undefined): PosKey | null {
  return reason && (COUPON_REASONS as readonly string[]).includes(reason) ? (`pos.cpn.reason.${reason}` as PosKey) : null;
}

/**
 * Why a coupon was refused, as the cashier reads it: WorkSuite's own sentence where it carries the figures (a minimum
 * spend, the date it ran out), else the till's words for the reason.
 */
export function couponMessage(t: (k: PosKey, v?: Record<string, string | number>) => string, reason: string | null | undefined, message: string | null | undefined): string {
  const key = couponReasonKey(reason);
  if (message && (reason === 'min_spend' || reason === 'expired' || reason === 'not_yet' || !key)) return message;
  return key ? t(key) : (message ?? t('pos.cpn.reason.not_applicable'));
}

/** A coupon code as typed or scanned: upper case, letters, digits, - and _, at most 40. */
export function couponCode(typed: string): string {
  return typed.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 40);
}

/* ── Gift vouchers ───────────────────────────────────────────────────── */

/**
 * The tender tiles: the company's (or the four every server takes), and — #293 — the gift voucher where WorkSuite takes
 * one but sent no list (`capabilities.vouchers` and `voucher_accept`, online). A company that listed its tenders without
 * a voucher does not take one (WorkSuite would refuse it), and a person without `can.voucher` is not offered it.
 */
export function tenderTiles(online: boolean, configured: PosTenderOption[] | null | undefined, caps: PosCapabilities, can: Pick<PosCan, 'voucher'> | null | undefined): PosTenderOption[] {
  let list = allowedTenders(online, configured);
  if (online && !configured?.length && caps.vouchers && caps.voucher_accept && !list.some((x) => x.kind === 'voucher')) {
    list = [...list, { kind: 'voucher', name: '', opens_drawer: false, offline: false, needs_customer: false, needs_reference: true }];
  }
  if (can?.voucher === false) list = list.filter((x) => x.kind !== 'voucher');
  return list.filter((x) => online || OFFLINE_TENDERS.has(x.kind));
}

/** A voucher's expiry as the till shows it ("31 Dec 2026"), or null. */
export function expiryOf(on: string | null | undefined): string | null {
  if (!on || !/^\d{4}-\d{2}-\d{2}/.test(on)) return null;
  const d = new Date(`${on.slice(0, 10)}T00:00:00`);
  return Number.isNaN(d.getTime()) ? on.slice(0, 10) : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

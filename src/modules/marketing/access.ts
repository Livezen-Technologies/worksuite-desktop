import { app } from '../../core/app-state';
import { useStore } from '../../core/store';

/**
 * Who may do what in Marketing (WS-MKT-SRS-001 §2.3). The baseline has 23 `marketing.*` permissions; the server
 * enforces every one of them (its route filters answer 403), so the desktop keeps out of the way only where a
 * screen is useless without a permission:
 *
 *   marketing.call.make   — work a call queue (MKT-CAL-02). Nobody holds it until B-5 is cleared, so My call
 *                           queue says why instead of offering a Next contact that can only be refused.
 *
 * Everything else is shown to whoever may open Marketing and refused by the server, with its own words, when the
 * person may not. `*` is a super-admin.
 */
export const CALL_PERMISSION = 'marketing.call.make';

export function can(perms: readonly string[] | null | undefined, p: string): boolean {
  return !!perms && (perms.includes('*') || perms.includes(p));
}

export interface MarketingAccess {
  /** Holds marketing.call.make: may claim from a call queue. */
  call: boolean;
}

export function marketingAccess(perms: readonly string[] | null | undefined): MarketingAccess {
  return { call: can(perms, CALL_PERMISSION) };
}

export function useMarketingAccess(): MarketingAccess {
  const perms = useStore(app, (s) => s.bootstrap?.permissions);
  return marketingAccess(perms);
}

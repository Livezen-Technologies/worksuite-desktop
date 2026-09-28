import { apiGet, apiPost } from '../../core/api';
import { money as financeMoney } from '../finance/api';

/**
 * Expenses (the server's `/api/expense`): claims, advances, cards, petty cash,
 * reimbursements, budgets, policies and subscriptions, per company.
 *
 * READS MAY COVER SEVERAL COMPANIES, WRITES HAPPEN IN ONE. The switcher selects
 * any number of companies; a read sends them as `org` ('' for every company
 * the person can see, '1,3' for two). The dashboard and the claim lists add
 * them up, because the server was built to. Everything that writes — filing a
 * claim, a budget, a payment run — happens in exactly one company, and a
 * screen that needs one says so rather than guessing which of several.
 *
 * Every query key carries the selection (`org`) or the one company, so a
 * switch never shows the previous company's figures under the new heading.
 *
 * MONEY STAYS A STRING. The server sends DECIMAL strings; they are grouped
 * for reading and summed, where the screen must, in cents (finance/api).
 *
 * REFUSALS ARE SENTENCES. The policy and budget engines write the rule and
 * both figures ("the monthly cap for Travel is LKR 50,000 and this takes you
 * to LKR 61,200"); the screens show that sentence unchanged.
 */

export const can = (perms: readonly string[] | undefined, slug: string) => !!perms && (perms.includes('*') || perms.includes(slug));

export interface Org {
  id: number;
  name: string;
  slug: string;
  role: 'member' | 'approver' | 'finance' | 'admin' | null;
  /** False for a company visible only through consolidated reporting. */
  member: boolean;
  /** May act here: membership, or the super-admin grant. Gate writes on this, never on `member`. */
  can_act?: boolean;
  currency: string;
  favourite: boolean;
}

export const canAct = (o: Org) => o.can_act ?? o.member;

export const K = {
  all: ['expenses'] as const,
  orgs: (uid: string) => ['expenses', 'orgs', uid] as const,
  areas: (org: string) => ['expenses', 'areas', org] as const,
  /** Everything about a selection ('' = every company). */
  scope: (org: string) => ['expenses', 's', org] as const,
  dashboard: (org: string) => ['expenses', 's', org, 'dashboard'] as const,
  queue: ['expenses', 'queue'] as const,
  /** Everything about one company. */
  one: (orgId: number) => ['expenses', 'o', orgId] as const,
};

/** The server's DECIMAL string grouped for reading; a dash where there is no figure. */
export function money(amount: string | number | null | undefined, currency = ''): string {
  if (amount === null || amount === undefined || amount === '') return '—';
  return financeMoney(amount, currency);
}

// ── the selection ────────────────────────────────────────────────────────

/** "1,3" → [1, 3]; anything else is dropped. '' is every company. */
export function parseSelection(v: string | null | undefined): number[] {
  return [...new Set((v ?? '').split(',').map((s) => s.trim()).filter((s) => /^\d+$/.test(s)).map(Number))];
}

export const selectionParam = (ids: number[]) => [...ids].sort((a, b) => a - b).join(',');

/**
 * The selection this tab is on: the route's, else the remembered one, else
 * the server's current company — each id kept only if the person still sees
 * it. An empty list means every company.
 */
export function resolveSelection(orgs: Org[], fromRoute: string | null, fromMemory: string | null, current: number | null): number[] {
  const known = (ids: number[]) => ids.filter((id) => orgs.some((o) => o.id === id));
  if (fromRoute !== null) {
    if (fromRoute === 'all') return [];
    const r = known(parseSelection(fromRoute));
    if (r.length) return r;
  }
  if (fromMemory !== null) {
    if (fromMemory === 'all') return [];
    const m = known(parseSelection(fromMemory));
    if (m.length) return m;
  }
  if (current !== null && orgs.some((o) => o.id === current)) return [current];
  return orgs[0] ? [orgs[0].id] : [];
}

export const fetchOrgs = (signal?: AbortSignal) => apiGet<{ items: Org[]; current: number | null; empty_reason: string | null }>('/api/expense/organizations', undefined, signal);

export const toggleFavourite = (id: number) => apiPost<{ favourite: boolean }>(`/api/expense/organizations/${id}/favourite`, {});

/**
 * Which screens this person may open, asked of the same resolver the route
 * filters use, over every company selected (an item shows when it is allowed
 * in any of them; the screen scopes per company). "Every company" is asked as
 * all of them — asking for none is refused, and would hide half the rail.
 */
export const fetchAreas = (orgIds: number[], signal?: AbortSignal) =>
  apiGet<{ areas: Array<{ key: string; visible: boolean }> }>('/api/module-areas/expense', { org: selectionParam(orgIds) }, signal).then((r) => {
    const out: Record<string, boolean> = {};
    for (const a of r.areas ?? []) out[a.key] = !!a.visible;
    return out;
  });

/** The dashboard's counts, which the rail badges and the quick bar read too. */
export interface DashboardCounts {
  cards_unmatched?: { count: number } | null;
  my_unpaid?: { count: number } | null;
  advances?: { count: number } | null;
  subscriptions_due?: number | null;
  [key: string]: unknown;
}

export const fetchDashboard = <T = DashboardCounts>(org: string, signal?: AbortSignal) => apiGet<T>('/api/expense/dashboard2', org ? { org } : undefined, signal);

export const fetchQueueTotal = (signal?: AbortSignal) => apiGet<{ total?: number | string }>('/api/expense/approvals', undefined, signal).then((r) => Number(r.total ?? 0) || 0);

/** A count the server may send as a string or leave out. */
export const count = (v: unknown): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
};

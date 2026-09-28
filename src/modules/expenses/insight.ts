import { apiGet } from '../../core/api';
import { fromCents } from '../finance/api';
import { count, K, money } from './api';

/**
 * Insight: the dashboard, the named reports, the classic claims summary and
 * the view across every company — their fetchers, and the arithmetic their
 * screens must not do inline.
 *
 * EVERY COLUMN MAY ARRIVE AS A STRING. PHP sends `"0"` for a false flag as
 * readily as `false`, and `"12"` for a count; each is converted once, here,
 * and never trusted raw on a screen — `"0"` is truthy in JavaScript.
 *
 * NEVER ONE FIGURE ACROSS CURRENCIES. A total is per currency, in cents; a
 * selection whose companies keep books in different currencies gets counts
 * (which do add) and a figure per currency (which is honest), never a sum of
 * rupees and dirhams printed as if it were a quantity. Bars and chart heights
 * are the one place a figure goes through Number(); the labels are the
 * server's strings, grouped.
 */

// ── coercion ─────────────────────────────────────────────────────────────

/** A flag as PHP may send it. "0", "", "false" and null are false; "0" is never true. */
export function flag(v: unknown): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') return v === '1' || v.toLowerCase() === 'true';
  return false;
}

/** A positive integer id, or null. */
export function idOf(v: unknown): number | null {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** Text, or '' for nothing. */
const text = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

/** Text, or null for nothing. */
const textOrNull = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v));

/** A decimal as the server wrote it; '0.00' where it sent nothing. */
const decimal = (v: unknown): string => (v === null || v === undefined || v === '' ? '0.00' : String(v));

/** A number that may honestly be absent (a percentage with no budget behind it). */
export function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** A figure's magnitude, for a bar or a chart height only — never for a label. */
export function num(v: unknown): number {
  const n = Number(String(v ?? '0').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

/**
 * A decimal as integer cents, sign kept, rounded half away from zero past the
 * second place. Sums happen here rather than in floats, so twelve months of
 * 0.10 come to 1.20 and not 1.2000000000000002.
 */
export function toCents(v: unknown): number {
  const s = String(v ?? '')
    .trim()
    .replace(/,/g, '');
  const m = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(s);
  if (!m || (m[2] === '' && (m[3] ?? '') === '')) return 0;
  const frac = (m[3] ?? '') + '000';
  let c = Number(m[2] || '0') * 100 + Number(frac.slice(0, 2));
  if (Number(frac[2]) >= 5) c += 1;
  return m[1] === '-' ? -c : c;
}

/** "3 claims", "1 claim". */
export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// ── the area map, for acts a rail cannot show ────────────────────────────

/**
 * What this person may do in one company, act by act — `analytics.metrics.export`
 * and the like, as the route filters name them. The rail's map keeps only
 * which screens show; an export button needs the verb. Asked of the same
 * resolver the route's `area:` filter uses, so the button and the refusal
 * cannot disagree.
 */
export const fetchActs = (orgId: number, signal?: AbortSignal) =>
  apiGet<{ areas?: Array<{ key?: unknown; components?: Array<{ key?: unknown; verbs?: Array<{ verb?: unknown; allowed?: unknown }> }> }> }>('/api/module-areas/expense', { org: orgId }, signal).then((r) => {
    const out: Record<string, boolean> = {};
    for (const a of r.areas ?? []) for (const c of a.components ?? []) for (const v of c.verbs ?? []) out[`${text(a.key)}.${text(c.key)}.${text(v.verb)}`] = flag(v.allowed);
    return out;
  });

/**
 * May the button be drawn? Not while the map is loading (a button that
 * appears and is then taken away reads as a glitch); yes when the map could
 * not be read at all, because the server checks again and says why; and
 * otherwise what the map says.
 */
export function mayDo(acts: Record<string, boolean> | undefined, failed: boolean, act: string): boolean {
  if (failed) return true;
  if (!acts) return false;
  return acts[act] !== false;
}

export const IK = {
  acts: (orgId: number) => [...K.one(orgId), 'insight', 'acts'] as const,
  catalogue: (orgId: number) => [...K.one(orgId), 'insight', 'catalogue'] as const,
  report: (orgId: number, report: string, from: string, to: string) => [...K.one(orgId), 'insight', 'report', report, from, to] as const,
  classic: (orgId: number, f: ClassicFilters) => [...K.one(orgId), 'insight', 'classic', f.from, f.to, f.status, f.category, f.currency] as const,
  categories: (orgId: number) => [...K.one(orgId), 'insight', 'categories'] as const,
  consolidated: (from: string, to: string) => [...K.all, 'insight', 'consolidated', from, to] as const,
};

// ── the dashboard ────────────────────────────────────────────────────────

export interface DashOrg {
  id: number | null;
  name: string;
  currency: string;
  role: string | null;
}

export interface TrendMonth {
  /** "2026-09". */
  month: string;
  label: string;
  total: string;
  count: number;
}

export interface CategoryTotal {
  id: number | null;
  name: string;
  count: number;
  total: string;
}

/** An approval routed to a step that resolves to nobody. */
export interface Stalled {
  entityType: string;
  entityId: number | null;
  label: string;
  daysWaiting: number;
  orgId: number | null;
  orgName: string | null;
}

/** An advance paid out over thirty days ago and not settled. */
export interface Overdue {
  id: number | null;
  number: string;
  claimant: string;
  amount: string;
  paidOut: string;
  orgId: number | null;
  orgName: string | null;
}

export interface BudgetLine {
  id: number | null;
  name: string;
  currency: string;
  amount: string;
  used: string;
  remaining: string;
  pct: number | null;
  hardStop: boolean;
  period: string;
  forecast: { amount: string; basis: string } | null;
  orgName: string | null;
}

export interface Renewal {
  id: number | null;
  name: string;
  vendor: string | null;
  category: string | null;
  amount: string;
  currency: string;
  renewsOn: string;
  daysUntil: number;
  autoRenew: boolean;
  orgName: string | null;
}

export interface Fund {
  id: number | null;
  name: string;
  currency: string;
  balance: string;
  needsRefill: boolean;
}

/** `dashboard2`, shaped once. */
export interface Dash {
  consolidated: boolean;
  /** Whose spending: the company's (finance and admin), your own, or several companies' (each by your role there). */
  scope: 'organization' | 'mine' | 'consolidated';
  orgs: DashOrg[];
  /** The one currency every figure is in, or null when the companies differ. */
  currency: string | null;
  mixed: boolean;
  /** This month, one figure per currency — the honest total when they differ. */
  monthByCurrency: Array<{ currency: string; total: string }>;
  note: string | null;
  fiscalYear: { label: string; start: string; end: string } | null;
  month: { label: string; total: string; lastMonth: string; changePct: number | null };
  awaitingMe: number;
  myUnpaid: { count: number; total: string };
  advances: { count: number; total: string };
  budgets: BudgetLine[];
  cardsUnmatched: { count: number; value: string };
  subscriptionsDue: number;
  renewals: Renewal[];
  duplicates: number;
  stalled: Stalled[];
  overdue: Overdue[];
  byCategory: CategoryTotal[];
  trend: TrendMonth[];
  bands: { categories: string[]; cells: Record<string, Record<string, number>> };
  funds: Fund[];
}

type Raw = Record<string, unknown>;
const obj = (v: unknown): Raw => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Raw) : {});
const list = (v: unknown): Raw[] => (Array.isArray(v) ? v.map(obj) : []);

function dashOrg(v: unknown): DashOrg {
  const o = obj(v);
  return { id: idOf(o.id), name: text(o.name), currency: text(o.currency), role: textOrNull(o.role) };
}

/**
 * The dashboard payload, as the rail and this screen both read it. The raw
 * answer stays in the cache (the shell's badges read it); this is applied as
 * the screen's `select`.
 */
export function shapeDashboard(raw: unknown): Dash {
  const d = obj(raw);
  const consolidated = flag(d.consolidated);
  const orgs = consolidated ? list(d.organizations).map(dashOrg) : [dashOrg(d.organization)];
  const currency = consolidated ? textOrNull(d.currency) : orgs[0]?.currency || null;
  const mixed = consolidated && (flag(d.mixed_currency) || currency === null);
  const m = obj(d.month);
  const fy = obj(d.fiscal_year);
  const tc = obj(d.trend_categories);
  const cells: Record<string, Record<string, number>> = {};
  for (const [mk, row] of Object.entries(obj(tc.cells))) {
    cells[mk] = {};
    for (const [c, v] of Object.entries(obj(row))) cells[mk][c] = num(v);
  }
  const byCur = obj(d.totals_by_currency);
  const monthByCurrency = consolidated
    ? Object.entries(byCur)
        .map(([c, t]) => ({ currency: c, total: decimal(t) }))
        .sort((a, b) => a.currency.localeCompare(b.currency))
    : [{ currency: currency ?? '', total: decimal(m.total) }];
  const scope = text(d.scope);
  const cards = obj(d.cards_unmatched);
  const petty = d.petty_cash ? obj(d.petty_cash) : null;

  return {
    consolidated,
    scope: consolidated ? 'consolidated' : scope === 'organization' ? 'organization' : 'mine',
    orgs,
    currency: mixed ? null : currency,
    mixed,
    monthByCurrency,
    note: textOrNull(d.note),
    fiscalYear: d.fiscal_year ? { label: text(fy.label), start: text(fy.start), end: text(fy.end) } : null,
    month: { label: text(m.label), total: decimal(m.total), lastMonth: decimal(m.last_month), changePct: numOrNull(m.change_pct) },
    awaitingMe: count(d.awaiting_me),
    myUnpaid: { count: count(obj(d.my_unpaid).count), total: decimal(obj(d.my_unpaid).total) },
    advances: { count: count(obj(d.advances).count), total: decimal(obj(d.advances).total) },
    budgets: list(d.budgets).map((b) => {
      const f = b.forecast ? obj(b.forecast) : null;
      return {
        id: idOf(b.id),
        name: text(b.name),
        currency: text(b.currency),
        amount: decimal(b.amount),
        used: decimal(b.used),
        remaining: decimal(b.remaining),
        pct: numOrNull(b.pct),
        hardStop: flag(b.hard_stop),
        period: text(b.period),
        forecast: f ? { amount: decimal(f.amount), basis: text(f.basis) } : null,
        orgName: textOrNull(b.org_name),
      };
    }),
    cardsUnmatched: { count: count(cards.count), value: decimal(cards.value) },
    subscriptionsDue: count(d.subscriptions_due),
    renewals: list(d.subscriptions_upcoming).map((r) => ({
      id: idOf(r.id),
      name: text(r.name),
      vendor: textOrNull(r.vendor),
      category: textOrNull(r.category),
      amount: decimal(r.amount),
      currency: text(r.currency),
      renewsOn: text(r.renews_on),
      daysUntil: Math.max(0, Math.trunc(num(r.days_until))),
      autoRenew: flag(r.auto_renew),
      orgName: textOrNull(r.org_name),
    })),
    duplicates: count(d.duplicates_open),
    stalled: list(d.stalled).map((s) => ({
      entityType: text(s.entity_type),
      entityId: idOf(s.entity_id),
      label: text(s.label),
      daysWaiting: count(s.days_waiting),
      orgId: idOf(s.org_id),
      orgName: textOrNull(s.org_name),
    })),
    overdue: list(d.overdue_advances).map((a) => ({
      id: idOf(a.id),
      number: text(a.advance_no),
      claimant: text(a.claimant),
      amount: decimal(a.base_amount),
      paidOut: text(a.disbursed_at).slice(0, 10),
      orgId: idOf(a.org_id),
      orgName: textOrNull(a.org_name),
    })),
    byCategory: list(d.by_category).map((c) => ({ id: idOf(c.id), name: text(c.name) || 'Uncategorised', count: count(c.n), total: decimal(c.t) })),
    trend: list(d.trend).map((r) => ({ month: text(r.month), label: text(r.label), total: decimal(r.total), count: count(r.count) })),
    bands: { categories: Array.isArray(tc.categories) ? tc.categories.map(text) : [], cells },
    funds: petty
      ? list(petty.funds).map((f) => ({ id: idOf(f.id), name: text(f.name), currency: text(f.currency), balance: decimal(f.balance), needsRefill: flag(f.needs_refill) }))
      : [],
  };
}

/** The page's name: one company, two by name, or how many. */
export function dashTitle(d: Dash): string {
  if (!d.consolidated) return d.orgs[0]?.name || 'Dashboard';
  const names = d.orgs.map((o) => o.name).filter(Boolean);
  return names.length <= 2 ? names.join(' and ') : `${names.length} companies`;
}

/**
 * The companies in a consolidated selection where this person sees only
 * their own claims. Each company is asked its own question by role, so the
 * figures are a sum of "everything" in some and "yours" in others — which the
 * page has to say, or the total reads as the whole group's.
 */
export const narrowIn = (d: Dash): string[] => (d.consolidated ? d.orgs.filter((o) => o.role !== 'finance' && o.role !== 'admin').map((o) => o.name) : []);

/** "Livezen and CreativeFx", "A, B and C". */
export function andList(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** Stalled approvals, in words — claims, advances, or both. */
export function stalledText(rows: Stalled[]): string {
  const advances = rows.filter((r) => r.entityType === 'advance').length;
  const claims = rows.length - advances;
  const what = advances === 0 ? plural(claims, 'claim', 'claims') : claims === 0 ? plural(advances, 'advance', 'advances') : `${plural(claims, 'claim', 'claims')} and ${plural(advances, 'advance', 'advances')}`;
  return `${what} ${rows.length === 1 ? 'has' : 'have'} nobody able to approve ${rows.length === 1 ? 'it' : 'them'}`;
}

/** The distinct company names a list of problems belongs to, for a consolidated page. */
export const whereFrom = (rows: Array<{ orgName: string | null }>): string[] => [...new Set(rows.map((r) => r.orgName).filter((n): n is string => !!n))];

/** "LKR 1,200.00" of a budget over its limit, from the signed remaining. */
export const overBy = (remaining: string) => remaining.trim().replace(/^-/, '');

// ── the trend ────────────────────────────────────────────────────────────

/**
 * A step somebody can hold in their head: 1, 2, 2.5 or 5 of a power of ten
 * (whole numbers only, for counts). The chart's ceiling is four of them, so
 * the gridlines fall on round figures instead of 1,534,331.89.
 */
export function niceStep(raw: number, whole: boolean): number {
  if (!(raw > 0)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const steps = whole && p < 10 ? [1, 2, 5, 10] : [1, 2, 2.5, 5, 10];
  const s = steps.find((k) => k * p >= raw) ?? 10;
  return Math.max(whole ? 1 : 0, s * p);
}

/** The top gridline: four nice steps, never below the tallest bar. */
export function ceilingOf(values: number[], whole: boolean): number {
  const max = Math.max(0, ...values);
  if (max <= 0) return whole ? 4 : 1;
  return niceStep(max / 4, whole) * 4;
}

/**
 * The mean of the months that had any spending. Empty months are skipped: six
 * months of data in a twelve-month window would otherwise report an average
 * half the true one, drawn below every bar that made it.
 */
export function meanOfSpent(values: number[]): number {
  const spent = values.filter((v) => v > 0);
  return spent.length ? spent.reduce((a, b) => a + b, 0) / spent.length : 0;
}

/**
 * This month against the one before, in the unit shown: an amount (in cents,
 * so the difference is exact) or a count. Null when there was nothing before
 * to compare with.
 */
export function monthDelta(rows: TrendMonth[], mode: 'money' | 'count'): { more: boolean; diff: string } | null {
  const last = rows[rows.length - 1];
  const prev = rows[rows.length - 2];
  if (!last || !prev) return null;
  if (mode === 'count') {
    if (prev.count <= 0) return null;
    return { more: last.count >= prev.count, diff: String(Math.abs(last.count - prev.count)) };
  }
  const a = toCents(last.total);
  const b = toCents(prev.total);
  if (b <= 0) return null;
  return { more: a >= b, diff: fromCents(Math.abs(a - b)) };
}

/**
 * The stacked-bar palette, the web's and validated rather than chosen by eye:
 * every check passes against both the light and the dark surface (worst
 * adjacent pair ΔE 10.2 under deuteranopia, 24.3 for normal vision, all above
 * 3:1). Assigned by a category's place in the legend, never by rank, so a
 * month that lacks one category does not repaint the rest. "Other" is not in
 * it: a residual is drawn grey (the ink token) so it does not read as a thing.
 */
export const BANDS = ['#2563eb', '#e11d48', '#0d9488', '#d97706', '#7c3aed', '#16a34a'];

export const bandColour = (categories: string[], c: string): string | null => (c === 'Other' ? null : (BANDS[Math.max(0, categories.indexOf(c)) % BANDS.length] ?? BANDS[0]!));

/** The chart's short labels: 1.5M, 250K, 12. */
export function axisShort(v: number): string {
  const a = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  const cut = (x: number) => x.toFixed(1).replace(/\.0$/, '');
  if (a >= 1e9) return `${sign}${cut(a / 1e9)}B`;
  if (a >= 1e6) return `${sign}${cut(a / 1e6)}M`;
  if (a >= 1e3) return `${sign}${cut(a / 1e3)}K`;
  return `${sign}${Number.isInteger(a) ? a : a.toFixed(1)}`;
}

// ── the named reports (reports2) ─────────────────────────────────────────

export interface Catalogue {
  catalogue: Array<{ key: string; title: string }>;
  fiscalYear: { label: string; start: string; end: string } | null;
}

export const fetchCatalogue = (orgId: number, signal?: AbortSignal) =>
  apiGet<Raw>('/api/expense/reports2', { org: orgId }, signal).then((r): Catalogue => {
    const fy = r.fiscal_year ? obj(r.fiscal_year) : null;
    return {
      catalogue: list(r.catalogue)
        .map((c) => ({ key: text(c.key), title: text(c.title) }))
        .filter((c) => /^[a-z_]{1,32}$/.test(c.key)),
      fiscalYear: fy ? { label: text(fy.label), start: text(fy.start), end: text(fy.end) } : null,
    };
  });

export interface Report {
  title: string;
  period: string | null;
  currency: string;
  columns: string[];
  rows: string[][];
  total: string | null;
  note: string | null;
}

/** The query a named report is run and exported with — the same keys, so the CSV is what was on screen. */
export function reportQuery(orgId: number, report: string, from: string, to: string): Record<string, string> {
  const q: Record<string, string> = { org: String(orgId), report };
  if (from) q.from = from;
  if (to) q.to = to;
  return q;
}

export const fetchReport = (orgId: number, report: string, from: string, to: string, signal?: AbortSignal) =>
  apiGet<Raw>('/api/expense/reports2', reportQuery(orgId, report, from, to), signal).then(
    (r): Report => ({
      title: text(r.title),
      period: textOrNull(r.period),
      currency: text(r.currency),
      columns: Array.isArray(r.columns) ? r.columns.map(text) : [],
      rows: Array.isArray(r.rows) ? r.rows.map((row) => (Array.isArray(row) ? row.map((c) => (c === null || c === undefined || c === '' ? '—' : String(c))) : [])) : [],
      total: textOrNull(r.total),
      note: textOrNull(r.note),
    }),
  );

/**
 * One cell of a report, as the server wrote it. A two-decimal figure is
 * grouped for reading (the column heading carries the currency); a whole
 * number is a count. Both sit right-aligned; everything else is words.
 */
export function reportCell(v: string): { text: string; numeric: boolean } {
  if (/^-?\d+\.\d{2}$/.test(v)) return { text: money(v), numeric: true };
  if (/^-?\d+$/.test(v)) return { text: v, numeric: true };
  return { text: v, numeric: false };
}

/**
 * The report's total, or null when there is no honest one. Petty cash funds
 * may each be in their own currency, and the server's total adds them anyway;
 * a report with a Currency column naming more than one gets no total.
 */
export function reportTotal(r: Report): string | null {
  if (!r.total) return null;
  const at = r.columns.findIndex((c) => c.toLowerCase() === 'currency');
  if (at >= 0 && new Set(r.rows.map((row) => row[at])).size > 1) return null;
  return r.total;
}

/** The grouped reports draw bars of their Total column — the shape is the point. */
export function reportBars(r: Report): Array<{ label: string; value: string; share: number }> | null {
  if (!r.columns[2]?.startsWith('Total') || r.rows.length === 0) return null;
  const rows = r.rows.slice(0, 12);
  const top = Math.max(1, ...r.rows.map((row) => Math.abs(num(row[2]))));
  return rows.map((row) => ({ label: row[0] ?? '', value: row[2] ?? '0.00', share: Math.min(100, (Math.abs(num(row[2])) / top) * 100) }));
}

// ── the classic claims summary (reports) ─────────────────────────────────

export interface ClassicFilters {
  from: string;
  to: string;
  status: string;
  category: string;
  currency: string;
}

export interface Classic {
  byStatus: Record<string, { count: number; total: string }>;
  byCategory: Array<{ name: string; count: number; total: string }>;
  byMonth: Array<{ month: string; total: string }>;
  topVendors: Array<{ vendor: string; total: string }>;
  outstanding: { count: number; total: string };
  unavailable: string[];
}

/** The classic summary's query — also the export's, so the file holds the claims the page summed. */
export function classicQuery(orgId: number, f: ClassicFilters): Record<string, string> {
  const q: Record<string, string> = { org: String(orgId) };
  if (f.from) q.from = f.from;
  if (f.to) q.to = f.to;
  if (f.status) q.status = f.status;
  if (f.category) q.category_id = f.category;
  if (f.currency) q.currency = f.currency;
  return q;
}

export const fetchClassic = (orgId: number, f: ClassicFilters, signal?: AbortSignal) =>
  apiGet<Raw>('/api/expense/reports', classicQuery(orgId, f), signal).then((r): Classic => {
    const byStatus: Classic['byStatus'] = {};
    for (const [k, v] of Object.entries(obj(r.by_status))) byStatus[k] = { count: count(obj(v).count), total: decimal(obj(v).total) };
    return {
      byStatus,
      byCategory: list(r.by_category).map((c) => ({ name: text(c.category) || 'Uncategorised', count: count(c.n), total: decimal(c.total) })),
      byMonth: list(r.by_month).map((m) => ({ month: text(m.month), total: decimal(m.total) })),
      topVendors: list(r.top_vendors).map((v) => ({ vendor: text(v.vendor), total: decimal(v.total) })),
      outstanding: { count: count(obj(r.outstanding).count), total: decimal(obj(r.outstanding).total) },
      unavailable: Array.isArray(r.unavailable) ? r.unavailable.map((u) => text(u).replace(/_/g, ' ')) : [],
    };
  });

/**
 * Everything claimed, not counting what was rejected — a rejected claim was
 * never spending the company accepted. Summed in cents.
 */
export function classicTotal(byStatus: Classic['byStatus']): { total: string; rejected: number } {
  let c = 0;
  for (const [k, v] of Object.entries(byStatus)) if (k !== 'rejected') c += toCents(v.total);
  return { total: fromCents(c), rejected: byStatus.rejected?.count ?? 0 };
}

export const fetchCategories = (orgId: number, signal?: AbortSignal) =>
  apiGet<unknown>('/api/expense/categories', { org: orgId }, signal).then((r) =>
    list(r)
      .map((c) => ({ id: idOf(c.id), name: text(c.name) }))
      .filter((c): c is { id: number; name: string } => c.id !== null && c.name !== ''),
  );

export const CLASSIC_STATUSES: Array<{ value: string; label: string }> = [
  { value: '', label: 'Any status' },
  { value: 'submitted', label: 'Submitted' },
  { value: 'approved', label: 'Approved' },
  { value: 'processing', label: 'Processing' },
  { value: 'paid', label: 'Paid' },
  { value: 'rejected', label: 'Rejected' },
];

// ── every company (consolidated) ────────────────────────────────────────

export interface ConsolidatedRow {
  orgId: number | null;
  name: string;
  currency: string;
  canAct: boolean;
  claims: number;
  total: string;
  pending: string;
  owed: string;
  paid: string;
}

export interface ConsolidatedData {
  from: string;
  to: string;
  rows: ConsolidatedRow[];
  totals: Array<{ currency: string; total: string }>;
  note: string | null;
}

export const fetchConsolidated = (from: string, to: string, signal?: AbortSignal) =>
  apiGet<Raw>('/api/expense/consolidated', { from, to }, signal).then((r): ConsolidatedData => {
    const p = obj(r.period);
    return {
      from: text(p.from),
      to: text(p.to),
      rows: list(r.organizations).map((o) => ({
        orgId: idOf(o.org_id),
        name: text(o.name),
        currency: text(o.currency),
        // Consolidated reporting grants sight, not authority.
        canAct: o.can_act === undefined || o.can_act === null ? flag(o.member) : flag(o.can_act),
        claims: count(o.claims),
        total: decimal(o.total),
        pending: decimal(o.pending),
        owed: decimal(o.owed),
        paid: decimal(o.paid),
      })),
      totals: list(r.totals).map((t) => ({ currency: text(t.currency), total: decimal(t.total) })),
      note: textOrNull(r.note),
    };
  });

export type ConsolidatedSort = 'total' | 'name' | 'claims' | 'pending' | 'owed' | 'paid';

export const CONSOLIDATED_SORTS: Array<{ value: ConsolidatedSort; label: string }> = [
  { value: 'total', label: 'Sort: Total' },
  { value: 'name', label: 'Sort: Organization' },
  { value: 'claims', label: 'Sort: Claims' },
  { value: 'pending', label: 'Sort: Awaiting approval' },
  { value: 'owed', label: 'Sort: Approved, unpaid' },
  { value: 'paid', label: 'Sort: Paid' },
];

/** Search by name or currency; keep the companies you can act in, or only those you can read. */
export function filterConsolidated(rows: ConsolidatedRow[], q: string, access: '' | 'act' | 'read'): ConsolidatedRow[] {
  const needle = q.trim().toLowerCase();
  return rows.filter((r) => {
    if (access === 'act' && !r.canAct) return false;
    if (access === 'read' && r.canAct) return false;
    return !needle || `${r.name} ${r.currency}`.toLowerCase().includes(needle);
  });
}

/**
 * Sorted — and a sort by an amount ranks within each currency. LKR 100,000
 * above USD 5,000 is not "more"; the currencies are kept together, in
 * alphabetical order, and ordered by the figure inside each.
 */
export function sortConsolidated(rows: ConsolidatedRow[], sort: ConsolidatedSort, dir: 'asc' | 'desc'): ConsolidatedRow[] {
  const sign = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (sort === 'name') return sign * a.name.localeCompare(b.name);
    if (sort === 'claims') return sign * (a.claims - b.claims) || a.name.localeCompare(b.name);
    return a.currency.localeCompare(b.currency) || sign * (toCents(a[sort]) - toCents(b[sort])) || a.name.localeCompare(b.name);
  });
}

/** A total per currency of the rows given, in cents — never one figure across two currencies. */
export function totalsByCurrency(rows: ConsolidatedRow[]): Array<{ currency: string; total: string }> {
  const by = new Map<string, number>();
  for (const r of rows) by.set(r.currency, (by.get(r.currency) ?? 0) + toCents(r.total));
  return [...by.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([currency, c]) => ({ currency, total: fromCents(c) }));
}

/** The largest total in each currency: a company's bar is measured against its own currency's largest, never another's. */
export function topByCurrency(rows: ConsolidatedRow[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) out[r.currency] = Math.max(out[r.currency] ?? 0, Math.abs(num(r.total)));
  return out;
}

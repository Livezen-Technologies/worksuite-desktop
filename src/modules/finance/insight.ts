import { apiGet, apiPost } from '../../core/api';
import { addMonths, can, isNegative, isZero, money, MONTHS } from './api';

/**
 * The reading screens: the financial overview, the cash flow overview and its
 * forecast, budget against actual, and every company side by side.
 *
 * NOTHING HERE WRITES TO THE BOOKS. These are the ledger arranged over time,
 * and every figure is the posted ledger — the server says so in the payload
 * and the screens repeat it where somebody stops reading footnotes.
 *
 * A TRANSLATED FIGURE LOOKS LIKE AN UNTRANSLATED ONE. The only thing between
 * "25.4M rupees" and "25.4M dollars" is the label, so the label is always the
 * currency the server says the figures are IN — never the one that was asked
 * for. A missing rate is refused by the server and said by the screen; it is
 * never taken to be one.
 *
 * PERMISSIONS ARE THE ROUTE FILTERS', SLUG FOR SLUG. `PermissionFilter`
 * requires every slug it names, so each gate below is an AND of the same
 * slugs, and a button is offered only where the route would let it through.
 */

// ── payloads ─────────────────────────────────────────────────────────────

/** What a presentation translation did, or why it could not happen. */
export interface FxBlock {
  ok: boolean;
  translated: boolean;
  base: string;
  /** The currency the figures are IN: the base unless a translation succeeded. */
  currency: string;
  requested?: string;
  rate?: string;
  method?: string;
  rate_date?: string;
  inverted?: boolean;
  note?: string;
  caveat?: string | null;
  why?: string;
}

export interface CurrencyOption {
  code: string;
  name: string;
  symbol: string | null;
  decimals: number;
}

export interface KpiCard {
  key: string;
  label: string;
  value: string;
  /** Null for a position (a balance on a date), which has no window to compare. */
  previous: string | null;
  /** Null where the previous figure was zero: a change from nothing is undefined, not 100%. */
  change_pct: string | null;
  basis?: 'flow' | 'position';
}

export interface AccountSeriesRow {
  account_id: number;
  code: string;
  name: string;
  type: string;
  months: Record<string, string>;
  total: string;
}

export interface CostVarianceRow {
  account_id: number;
  code: string;
  name: string;
  current: string;
  previous: string;
  change: string;
  change_pct: string | null;
}

export interface DimensionRow {
  key: string;
  name: string;
  total: string;
}

export interface Dimension {
  dimension: string;
  label: string;
  rows: DimensionRow[];
  total: string;
  attributed: string;
  unattributed: string;
  coverage_pct: string | null;
  /** Whether anything was posted at all, as against nothing being stamped. */
  has_activity: boolean;
  available: boolean;
  why: string | null;
}

export interface FinancialOverview {
  company: { id: number; name: string };
  currency: string;
  base_currency: string;
  fx: FxBlock;
  /** The closing-date rate the balance cards take. */
  position_fx?: FxBlock;
  currencies: CurrencyOption[];
  from: string;
  to: string;
  previous: { from: string; to: string };
  kpis: KpiCard[];
  months: string[];
  series: Record<string, Record<string, string>>;
  profitability: {
    subtotals: Record<string, string>;
    net_profit: string;
    margins: { gross: string | null; operating: string | null; net: string | null };
  };
  costs: { months: string[]; accounts: AccountSeriesRow[] };
  cost_dimensions: Dimension[];
  revenue: { months: string[]; accounts: AccountSeriesRow[] };
  variance: CostVarianceRow[];
  health: Array<{ level: string; text: string }>;
  basis: string;
  /** The documents raised and not posted — a list, or a keyed map on an older server. */
  unposted: unknown[] | Record<string, unknown> | null;
}

export interface CashBucket {
  category: string;
  amount: string;
  entries: number;
  accounts: Array<{ account_id: number; code: string; name: string }>;
}

export interface CashAccountRow {
  account_id: number;
  code: string;
  name: string;
  currency: string;
  reconcilable: boolean;
  opening: string;
  in: string;
  out: string;
  net: string;
  closing: string;
}

export interface CashOverview {
  company: { id: number; name: string };
  currency: string;
  base_currency: string;
  fx: FxBlock;
  position_fx?: FxBlock;
  currencies: CurrencyOption[];
  from: string;
  to: string;
  summary: { opening: string; inflows: string; outflows: string; net: string; closing: string; transfers: string };
  inflows: CashBucket[];
  outflows: CashBucket[];
  monthly: Record<string, { in: string; out: string; net: string }>;
  accounts: CashAccountRow[];
  statement: { currency: string; movement: string; derived: string; reconciles: boolean };
  agrees: boolean;
  note: string | null;
}

export interface ForecastMonth {
  month: string;
  revenue: string;
  expenses: string;
  profit: string;
  closing_cash: string;
  estimated: boolean;
  basis: { scheduled_in: string; scheduled_out: string; extrapolated_in: string; extrapolated_out: string; method: string };
}

export interface Forecast {
  currency: string;
  base_currency?: string;
  fx?: FxBlock;
  estimated?: boolean;
  method: string;
  confidence: string;
  history_months: number;
  months: ForecastMonth[];
  risks: Array<{ month: string; expected_closing: string; shortfall: string; scheduled_out: string; why: string }>;
  note: string;
  max_months: number;
}

export interface VarianceRow {
  account_id: number;
  code: string;
  name: string;
  type: string;
  is_income: boolean;
  budget: string;
  actual: string;
  variance: string;
  variance_pct: string | null;
  /** The server's judgement, per row: over plan is good on income and bad on cost. */
  favourable: boolean | null;
  unbudgeted: boolean;
}

export interface VarianceSide {
  budget: string;
  actual: string;
  variance: string;
  favourable: boolean | null;
  remaining_plan: string;
}

export interface BudgetVariance {
  ok: boolean;
  message?: string;
  year?: number;
  currency: string;
  budget?: { id: number; name: string; year: number; status: string };
  from?: string;
  to?: string;
  months_elapsed?: string[];
  rows?: VarianceRow[];
  partial_month?: { month: string; days_elapsed: number; days_in_month: number; fraction: string } | null;
  totals?: { income: VarianceSide; cost: VarianceSide; profit: { budget: string; actual: string; variance: string } };
  note?: string;
}

export interface ConsolidatedRow {
  company: { id: number; name: string };
  has_books: boolean;
  currency?: string;
  /** Always the company's own figures, in its own currency. */
  own?: Record<string, string>;
  /** Null when the company could not be translated. */
  translated?: Record<string, string> | null;
  fx?: { ok: boolean; translated: boolean; currency?: string; why?: string; flow_rate?: string | null; position_rate?: string | null; position_date?: string | null };
}

export interface Untranslated {
  company: string;
  currency: string;
  why: string;
}

export interface Consolidated {
  from: string;
  to: string;
  rows: ConsolidatedRow[];
  currencies: string[];
  currency_options: CurrencyOption[];
  mixed_currency: boolean;
  presentation_currency: string | null;
  total:
    | (Record<string, string | number | boolean | null> & {
        currency: string | null;
        companies_counted: number;
        companies_with_books: number;
        complete: boolean;
      })
    | null;
  untranslated: Untranslated[];
  note: string;
}

// ── keys and reads ───────────────────────────────────────────────────────

/** Under the company, as every Finance key is; the consolidation is the one read that is not about one company. */
export const IK = {
  overview: (c: number, from: string, to: string, cur: string) => ['finance', 'c', c, 'financial-overview', from, to, cur] as const,
  cash: (c: number, from: string, to: string, cur: string) => ['finance', 'c', c, 'cash-overview', from, to, cur] as const,
  forecast: (c: number, months: number, cur: string) => ['finance', 'c', c, 'forecast', months, cur] as const,
  variance: (c: number, year: number) => ['finance', 'c', c, 'budget-variance', year] as const,
  consolidated: (from: string, to: string, cur: string) => ['finance', 'consolidated', from, to, cur] as const,
};

export const fetchFinancialOverview = (company: number, from: string, to: string, currency: string, signal?: AbortSignal) =>
  apiGet<FinancialOverview>('/api/finance/overview/financial', { company, from, to, currency: currency || undefined }, signal);

export const fetchCashOverview = (company: number, from: string, to: string, currency: string, signal?: AbortSignal) =>
  apiGet<CashOverview>('/api/finance/overview/cash-flow', { company, from, to, currency: currency || undefined }, signal);

/**
 * The forecast follows the page's currency. The web's screen did not send it,
 * so a page translated into dollars carried a forecast in rupees under the
 * dollar heading; the server has read `?currency=` here all along.
 */
export const fetchForecast = (company: number, months: number, currency: string, signal?: AbortSignal) =>
  apiGet<Forecast>('/api/finance/overview/forecast', { company, months, currency: currency || undefined }, signal);

export const fetchBudgetVariance = (company: number, year: number, signal?: AbortSignal) =>
  apiGet<BudgetVariance>('/api/finance/overview/budget-variance', { company, year }, signal);

export const fetchConsolidated = (from: string, to: string, currency: string, signal?: AbortSignal) =>
  apiGet<Consolidated>('/api/finance/overview/consolidated', { from, to, currency: currency || undefined }, signal);

// ── getting a report out ─────────────────────────────────────────────────

export type FinanceReport = 'financial-overview' | 'cash-flow' | 'budget-variance' | 'profit-and-loss';

/**
 * The export slug each report's route carries (Routes.php: the two dashboards
 * have their own, the rest the general one). The web checked the general one
 * for every report, and so offered Export on the financial overview to people
 * the server then refused.
 */
export const EXPORT_SLUG: Record<FinanceReport, string> = {
  'financial-overview': 'finance.financial_overview.export',
  'cash-flow': 'finance.cashflow.export',
  'budget-variance': 'finance.reports.export',
  'profit-and-loss': 'finance.reports.export',
};

/** Which of the four acts the routes would let through: each is `finance.reports.view` AND its own slug. */
export function reportGates(perms: readonly string[] | undefined, report: FinanceReport) {
  const figures = can(perms, 'finance.reports.view');
  return {
    export: figures && can(perms, EXPORT_SLUG[report]),
    lines: figures && can(perms, 'finance.reports.download'),
    print: figures && can(perms, 'finance.reports.print'),
    share: figures && can(perms, 'finance.reports.share'),
  };
}

/** What each screen's route requires, all of it. */
export const SCREEN_SLUGS = {
  overview: ['finance.reports.view', 'finance.financial_overview.view'],
  cash: ['finance.reports.view', 'finance.cashflow.view'],
  forecast: ['finance.reports.view', 'finance.forecast.view'],
  variance: ['finance.reports.view'],
  consolidated: ['finance.reports.view', 'finance.consolidated.view'],
} as const;

/** The slugs a person lacks, of those a route names. */
export const missingSlugs = (perms: readonly string[] | undefined, slugs: readonly string[]) => slugs.filter((s) => !can(perms, s));

/** The horizons the forecast route will answer: three months for anyone, up to twelve with `finance.forecast.manage`. */
export const horizons = (perms: readonly string[] | undefined): number[] => (can(perms, 'finance.forecast.manage') ? [3, 6, 12] : [3]);

/** The web's print page for a report, opened in the browser (the path the main process accepts: no percent-encoding). */
export function printPath(report: FinanceReport, company: number, from: string, to: string, currency?: string): string {
  return `/finance/print/${report}?company=${company}&from=${from}&to=${to}${currency ? `&currency=${currency}` : ''}`;
}

/** A share link: the server answers a path, and the link is that path on the server the app is signed in to. */
export function shareLink(origin: string | null | undefined, path: string): string | null {
  if (!origin || !path) return null;
  return `${origin.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

export const createShareLink = (report: FinanceReport, company: number, from: string, to: string) =>
  apiPost<{ id?: number; url?: string; expires_at?: string }>(`/api/finance/export/${report}/share`, { days: 7 }, { company, from, to });

// ── periods ──────────────────────────────────────────────────────────────

export type PeriodKey = 'this_year' | 'twelve' | 'this_quarter' | 'this_month' | 'last_month' | 'last_year';

export const PERIODS: Array<{ id: PeriodKey; label: string }> = [
  { id: 'this_year', label: 'This year' },
  { id: 'twelve', label: 'Last 12 months' },
  { id: 'this_quarter', label: 'This quarter' },
  { id: 'this_month', label: 'This month' },
  { id: 'last_month', label: 'Last month' },
  { id: 'last_year', label: 'Last year' },
];

/** The last day of a month, from its digits. */
function monthEnd(y: number, m: number): string {
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${y}-${String(m).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
}

/**
 * The dates a named period resolves to, from today's date on the reader's
 * calendar — as digits, never through `toISOString()`, which converts to UTC
 * first and so started and ended every period a day early east of Greenwich.
 */
export function periodRange(key: PeriodKey, today: string): { from: string; to: string } {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  const first = `${today.slice(0, 7)}-01`;
  switch (key) {
    case 'this_month':
      return { from: first, to: today };
    case 'last_month': {
      const from = addMonths(first, -1);
      return { from, to: monthEnd(Number(from.slice(0, 4)), Number(from.slice(5, 7))) };
    }
    case 'this_quarter':
      return { from: `${y}-${String(Math.floor((m - 1) / 3) * 3 + 1).padStart(2, '0')}-01`, to: today };
    case 'last_year':
      return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31` };
    case 'twelve':
      return { from: addMonths(first, -11), to: today };
    default:
      return { from: `${y}-01-01`, to: today };
  }
}

/** What the server would refuse about a window, said before asking. */
export function rangeProblem(r: { from: string; to: string }): string | null {
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  if (!iso.test(r.from) || !iso.test(r.to)) return 'Give both dates.';
  if (r.from > r.to) return 'The start of the period is after its end.';
  return null;
}

// ── figures ──────────────────────────────────────────────────────────────

/** How many decimals a currency has, from the payload — a yen figure is whole units, a dinar has three. */
export const decimalsOf = (options: CurrencyOption[] | undefined, code: string | null | undefined): number => options?.find((o) => o.code === code)?.decimals ?? 2;

/** An amount with its sign always written: "LKR +400,000.00", "LKR -1,250.00", "LKR 0.00". */
export function signedMoney(v: string | null | undefined, currency: string, decimals = 2): string {
  const body = money(v, '', decimals);
  const plus = !isZero(v) && !isNegative(v) ? '+' : '';
  return `${currency} ${plus}${body}`.trim();
}

/** A percentage change as text, or null when there is none to show. A ratio, so Number() is fine. */
export function pctText(v: string | null | undefined): string | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return `${n > 0 ? '+' : ''}${n.toFixed(1)}%`;
}

export type Tone = 'good' | 'bad' | 'flat' | 'none';

/**
 * The colour of a change. The arrow shows the direction of the number; only
 * the colour carries the judgement — and for a cost, up is bad.
 */
export function deltaTone(pct: string | null | undefined, invert = false): Tone {
  const t = pctText(pct);
  if (t === null) return 'none';
  const n = Number(pct);
  if (n === 0) return 'flat';
  return (n > 0) !== invert ? 'good' : 'bad';
}

/** Budget colour comes from the server's `favourable`, never from the sign. */
export const favourTone = (favourable: boolean | null | undefined): Tone => (favourable === null || favourable === undefined ? 'none' : favourable ? 'good' : 'bad');

/** Profit has no `favourable` of its own: more profit than planned is good whichever side it came from. */
export const profitTone = (variance: string | null | undefined): Tone => (isZero(variance) ? 'flat' : isNegative(variance) ? 'bad' : 'good');

export const TONE_TEXT: Record<Tone, string> = {
  good: 'text-success',
  bad: 'text-danger',
  flat: 'text-ink-3',
  none: 'text-ink-3',
};

/** A value as a number, for a bar's length only — never for a figure anybody reads. */
export function num(v: string | number | null | undefined): number {
  const n = Number(String(v ?? '0').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

/** One value's share of a total, 0–100, by magnitude. */
export function shareOf(value: string | number | null | undefined, total: string | number | null | undefined): number {
  const v = Math.abs(num(value));
  const t = Math.abs(num(total));
  return t > 0 ? Math.min(100, (v / t) * 100) : 0;
}

/** The sum of magnitudes, for scaling bars against each other. */
export const magnitude = (values: Array<string | null | undefined>) => values.reduce((a, v) => a + Math.abs(num(v)), 0);

/** Compact axis labels — 1.2M rather than 1,200,000, which will not fit under a bar. */
export function axisShort(v: number): string {
  const a = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (a >= 1e9) return `${sign}${(a / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${sign}${(a / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${sign}${(a / 1e3).toFixed(0)}K`;
  return `${sign}${a.toFixed(0)}`;
}

/**
 * The span a chart has to draw: from the true minimum to the true maximum,
 * zero always inside it — so a loss hangs below the line rather than being a
 * short bar pointing up. A flat-zero chart gets one unit of span.
 */
export function chartScale(series: string[][]): { max: number; min: number; span: number } {
  const all = series.flat().map(num);
  const max = Math.max(0, ...all);
  const min = Math.min(0, ...all);
  return { max, min, span: max - min || 1 };
}

/** "2026-09" as "Sep", or "Sep 26" when a chart spans years. */
export function monthShort(ym: string, withYear = false): string {
  const y = ym.slice(2, 4);
  const m = Number(ym.slice(5, 7));
  const name = MONTHS[m - 1]?.slice(0, 3) ?? ym;
  return withYear ? `${name} ${y}` : name;
}

/** "2026-09" as "September 2026". */
export function monthLong(ym: string): string {
  const m = Number(ym.slice(5, 7));
  return MONTHS[m - 1] ? `${MONTHS[m - 1]} ${ym.slice(0, 4)}` : ym;
}

/** How many documents are raised and not in the ledger. */
export function unpostedCount(u: FinancialOverview['unposted']): number {
  if (Array.isArray(u)) return u.length;
  if (u && typeof u === 'object') {
    const c = (u as { count?: unknown }).count;
    return typeof c === 'number' ? c : Object.keys(u).length;
  }
  return 0;
}

// ── currency presentation ────────────────────────────────────────────────

/**
 * What the page is showing:
 *  - `base`: the books' own currency, nothing asked for;
 *  - `translated`: every figure in the chosen currency;
 *  - `refused`: no rate for what was asked, so still the base, and said;
 *  - `mixed`: a rate for amounts earned and spent but none for balances on the
 *    closing date. The server then translates some figures and not others
 *    under one label, so the page must not show them as though it had.
 */
export type FxState = 'base' | 'translated' | 'refused' | 'mixed';

export function fxState(fx?: FxBlock | null, position?: FxBlock | null): FxState {
  if (!fx) return 'base';
  if (!fx.ok) return 'refused';
  if (!fx.translated) return 'base';
  if (position && !position.ok) return 'mixed';
  return 'translated';
}

/** How a rate was arrived at, in words that do not claim more than the data has. */
export function methodWords(method?: string, over = 'this period'): string {
  if (method === 'average') return `the day-weighted average for ${over}`;
  if (method === 'single') return `the one rate in force for ${over}`;
  if (method === 'closing') return 'the nearest rate available';
  return '';
}

// ── cost dimensions ──────────────────────────────────────────────────────

/** Best coverage first, and a dimension whose column does not exist last — not level with a genuine 0%. */
export function rankDimensions(dims: Dimension[]): Dimension[] {
  const rank = (d: Dimension) => (!d.available ? -2 : d.coverage_pct === null ? -1 : num(d.coverage_pct));
  return [...dims].sort((a, b) => rank(b) - rank(a));
}

// ── the consolidation ────────────────────────────────────────────────────

export const CONSOLIDATED_FIGURES: Array<[string, string]> = [
  ['revenue', 'Revenue'],
  ['expenses', 'Expenses'],
  ['gross_profit', 'Gross profit'],
  ['net_profit', 'Net profit'],
  ['cash', 'Cash'],
];

/**
 * One company's row: the translated figures where they exist, its own where
 * they do not, and always which — plus whether it is in the total, which the
 * server says by naming it in `untranslated`.
 */
export function companyRow(r: ConsolidatedRow, untranslated: Untranslated[]): { figures: Record<string, string>; currency: string; counted: boolean; notes: string[] } {
  const own = r.own ?? {};
  const figures = r.translated ?? own;
  const currency = r.translated ? (r.fx?.currency ?? r.currency ?? '') : (r.currency ?? '');
  const counted = !untranslated.some((u) => u.company === r.company.name);
  const notes = [`Books in ${r.currency ?? '—'}`];
  if (r.translated && r.currency !== currency) notes.push(`shown in ${currency}`);
  if (r.fx && !r.fx.ok) notes.push('not translated');
  if (!counted) notes.push('not in the total');
  return { figures, currency, counted, notes };
}

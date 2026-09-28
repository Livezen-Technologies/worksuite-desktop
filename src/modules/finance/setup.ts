import { ApiError, apiDelete, apiGet, apiPost, apiPut } from '../../core/api';
import { addDays, dayKey, parseTs } from '../../core/time';
import { cents, shortDate } from './api';

/**
 * Finance setup: exchange rates, share links, tax codes, the account
 * mappings behind fixed assets and purchases, depreciation, the accounting
 * profile and area access — the typed calls, their keys, and the rules the
 * screens say before the server has to.
 *
 * RATES ARE TEXT. An exchange rate is DECIMAL(18,8) and a tax rate
 * DECIMAL(9,4); both are checked, compared and trimmed as the strings they
 * are. `Number("312.55000001")` is fine and `Number("0.1") * 3` is not, and a
 * screen that sometimes goes through a float is a screen nobody can say is
 * right.
 *
 * THE SAME RULES, NOT THE AUTHORITY. Each check here mirrors one the server
 * makes (FxController::create, Tax::setRate, FinancePermissionService::set)
 * so a refusal is said while it is typed; the server checks all of them again.
 */

// ── keys ─────────────────────────────────────────────────────────────────

/**
 * Every company-scoped key sits under `['finance','c', company, …]`, so one
 * invalidation of the company refreshes all of it. Exchange rates are the one
 * installation-wide list; they are keyed by person instead, because who may
 * edit them and which base currencies are named depend on who is asking.
 */
export const KS = {
  fx: (uid: string) => ['finance', 'fx', uid] as const,
  shares: (c: number) => ['finance', 'c', c, 'shares'] as const,
  tax: (c: number) => ['finance', 'c', c, 'tax'] as const,
  taxAsOf: (c: number, asOf: string) => ['finance', 'c', c, 'tax', 'codes', asOf] as const,
  taxHistory: (c: number, id: number) => ['finance', 'c', c, 'tax', 'history', id] as const,
  assetAccounts: (c: number) => ['finance', 'c', c, 'asset-accounts'] as const,
  depreciation: (c: number) => ['finance', 'c', c, 'depreciation'] as const,
  depreciationFor: (c: number, period: string) => ['finance', 'c', c, 'depreciation', period] as const,
  purchaseAccounts: (c: number) => ['finance', 'c', c, 'purchase-accounts'] as const,
  settings: (c: number) => ['finance', 'c', c, 'settings'] as const,
  members: (c: number) => ['finance', 'c', c, 'access-members'] as const,
};

/** What the server calls its per-area envelope. It has no `allowed` — the web read one that never existed. */
export interface Envelope {
  view?: boolean;
  edit?: boolean;
  manage?: boolean;
  level?: string;
}

/**
 * A refusal the server meant, said as it said it — a 403 is "not yours" and
 * names why, which is different from "could not be loaded".
 */
export function forbiddenWhy(e: unknown): string | null {
  return e instanceof ApiError && e.status === 403 ? e.message : null;
}

/** Ids from `getResultArray()` rows arrive as strings; ids from mapped rows as numbers. Compared as text. */
export const sameId = (a: number | string | null | undefined, b: number | string | null | undefined) => a !== null && a !== undefined && b !== null && b !== undefined && String(a) === String(b);

// ── decimals as text ─────────────────────────────────────────────────────

/**
 * Trailing zeros off a decimal string, keeping at least `keep` places:
 * "312.55000000" → "312.55", "15.0000" with keep 2 → "15.00". Text in, text
 * out; anything that is not a plain decimal comes back as it was.
 */
export function trimDecimals(v: string | number | null | undefined, keep = 0): string {
  const s = String(v ?? '').trim();
  const m = /^(-?\d+)(?:\.(\d*))?$/.exec(s);
  if (!m) return s;
  let frac = (m[2] ?? '').replace(/0+$/, '');
  if (frac.length < keep) frac = frac + '0'.repeat(keep - frac.length);
  return frac ? `${m[1]}.${frac}` : m[1]!;
}

/** Whether a plain decimal string is above zero, read from its digits. */
function positive(s: string): boolean {
  return /[1-9]/.test(s);
}

// ── exchange rates ───────────────────────────────────────────────────────

export interface FxRate {
  id: number;
  from: string;
  to: string;
  /** DECIMAL(18,8), as sent: "312.55000000". */
  rate: string;
  effective_on: string;
  source: string | null;
}

export interface FxPayload {
  rows: FxRate[];
  currencies: Array<{ code: string; name: string }>;
  base_currencies: string[];
  can_edit: boolean;
  note: string;
}

export const fetchRates = (signal?: AbortSignal) => apiGet<FxPayload>('/api/finance/exchange-rates', undefined, signal);

export const saveRate = (r: { from: string; to: string; rate: string; effective_on: string }) => apiPost<{ id?: number }>('/api/finance/exchange-rates', r);

export const removeRate = (id: number) => apiDelete<{ id?: number }>(`/api/finance/exchange-rates/${id}`);

/**
 * What the server would refuse in a typed exchange rate, or null: a positive
 * number with at most eight decimal places — how many `to` one `from` buys.
 * An empty box is not a problem yet, only not ready.
 */
export function fxRateProblem(rate: string, from = '', to = ''): string | null {
  const s = rate.trim();
  if (s === '') return null;
  if (s.includes(',')) return 'Write the rate as digits and a decimal point, without commas.';
  if (!/^\d+(\.\d{1,8})?$/.test(s) || !positive(s)) {
    return `The rate must be a positive number with up to eight decimal places${from && to ? ` — how many ${to} one ${from} buys` : ''}.`;
  }
  return null;
}

/** The rate already stored for a pair on a day — saving replaces it rather than adding a second. */
export const existingRate = (rows: FxRate[], from: string, to: string, on: string) => rows.find((r) => r.from === from && r.to === to && r.effective_on === on) ?? null;

// ── share links ──────────────────────────────────────────────────────────

export interface ShareRow {
  id: number;
  report: string;
  from: string;
  to: string;
  expires_at: string;
  revoked_at: string | null;
  views: number;
  max_views: number;
  last_seen_at: string | null;
  live: boolean;
  why_dead: string | null;
}

export interface SharesPayload {
  rows: ShareRow[];
  reports: Record<string, string>;
  scope: 'all' | 'mine';
  note: string;
}

export const fetchShares = (company: number, signal?: AbortSignal) => apiGet<SharesPayload>('/api/finance/export/shares', { company }, signal);

/** The route reads the company from the query string, as the web sends it. */
export const revokeShare = (company: number, id: number) => apiDelete<{ id?: number }>(`/api/finance/export/shares/${id}?company=${company}`);

// ── tax ──────────────────────────────────────────────────────────────────

/** `finance_tax_rates` marks the rate still in force with this date, not NULL — a NULL in a UNIQUE key enforces nothing. */
export const OPEN_ENDED = '9999-12-31';

export interface TaxCode {
  id: number;
  code: string;
  name: string;
  treatment: string;
  direction: 'output' | 'input' | string;
  status: string;
  note: string | null;
  /** Null means NO RATE IS CONFIGURED for the date asked about. Not zero. */
  rate: string | null;
  rate_from: string | null;
  rate_to: string | null;
  configured: boolean;
}

export interface TaxPayload {
  codes: TaxCode[];
  can?: Envelope;
  treatments: Record<string, string>;
  empty_note: string | null;
  unconfigured: number;
}

/** One row of a code's history, raw from the table (ids and figures may be strings). */
export interface TaxRate {
  id: number | string;
  rate: string;
  starts_on: string;
  ends_on: string | null;
  note?: string | null;
}

export const isOpenRate = (r: TaxRate) => r.ends_on === null || r.ends_on >= OPEN_ENDED;

/** Treatments that have no rate by definition — "not set" would be wrong for them. */
export const RATELESS = ['exempt', 'out_of_scope'];

export const fetchTaxCodes = (company: number, asOf: string, signal?: AbortSignal) => apiGet<TaxPayload>('/api/finance/tax-codes', { company, as_of: asOf }, signal);

export const fetchTaxHistory = (company: number, id: number, signal?: AbortSignal) => apiGet<{ rates: TaxRate[] }>(`/api/finance/tax-codes/${id}/history`, { company }, signal).then((r) => r.rates ?? []);

export const createTaxCode = (company: number, f: { code: string; name: string; treatment: string; direction: string; note: string }) => apiPost<{ id?: number }>('/api/finance/tax-codes', { company_id: company, ...f });

export const setTaxRate = (company: number, id: number, r: { rate: string; from: string; note: string }) => apiPost(`/api/finance/tax-codes/${id}/rate`, { company_id: company, ...r });

export const archiveTaxCode = (company: number, id: number) => apiPost(`/api/finance/tax-codes/${id}/archive`, { company_id: company });

/**
 * What the server would refuse in a typed tax rate, or null. A percentage
 * from 0 to 200 with at most four decimals. 200 is a typo guard, not a
 * statutory judgement: 100% is possible, 2,500% is an amount typed into the
 * rate box. Compared as digits.
 */
export function taxRateProblem(rate: string): string | null {
  const s = rate.trim();
  if (s === '') return null;
  if (s.startsWith('-')) return 'A tax rate cannot be negative.';
  if (!/^\d+(\.\d{1,4})?$/.test(s)) return 'Enter the rate as a plain percentage with at most four decimal places — 15 or 12.5, without the % sign.';
  const [whole = '0', frac = ''] = s.split('.');
  const w = whole.replace(/^0+(?=\d)/, '');
  const over = w.length > 3 || Number(w) > 200 || (Number(w) === 200 && /[1-9]/.test(frac));
  if (over) return `${s}% is not a plausible tax rate. Enter it as a percentage, not a multiplier.`;
  return null;
}

/**
 * What recording a new rate from `from` does to the history: which rate it
 * closes and on what day, or why it would be refused. Rates are never edited
 * — a new one closes whatever was open the day before it starts.
 *
 * A start on or before the open rate's own start is refused here: the same
 * day is the server's own refusal, and an earlier day would not close the open
 * rate at all, so the insert collides with it and fails as a database error
 * (Tax::setRate only closes a rate that starts before the new one).
 */
export function rateChange(history: TaxRate[], from: string, code = ''): { closes: TaxRate | null; closesOn: string | null; problem: string | null } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) return { closes: null, closesOn: null, problem: 'Choose the day the rate comes into force.' };
  if (history.some((r) => r.starts_on === from)) {
    return { closes: null, closesOn: null, problem: `A rate for ${code || 'this code'} already starts on ${shortDate(from)}. Rates are never edited — start a new one from a later date, so the change stays visible.` };
  }
  const open = history.find(isOpenRate) ?? null;
  if (open && from < open.starts_on) {
    return { closes: null, closesOn: null, problem: `The rate in force started on ${shortDate(open.starts_on)}. A new rate has to start after it — rates are added going forward, never slotted in behind the current one.` };
  }
  return open ? { closes: open, closesOn: addDays(from, -1), problem: null } : { closes: null, closesOn: null, problem: null };
}

// ── fixed-asset accounts ─────────────────────────────────────────────────

export interface AssetCategory {
  id: number;
  name: string;
  account_id: number | null;
  asset_count: number;
  /** How many of its assets are already in the books under the current mapping. */
  capitalised: number;
  total: string;
}

export interface MappingAccount {
  id: number | string;
  code: string;
  name: string;
  type?: string;
}

export interface AssetAccountsPayload {
  categories: AssetCategory[];
  accounts: MappingAccount[];
  unavailable?: string;
  can?: Envelope;
}

export const fetchAssetAccounts = (company: number, signal?: AbortSignal) => apiGet<AssetAccountsPayload>('/api/finance/asset-accounts', { company }, signal);

/** The route resolves the company from the query string before the body; both are sent, as the web does. */
export const saveAssetAccounts = (company: number, map: Record<number, number | null>) => apiPut(`/api/finance/asset-accounts?company=${company}`, { company_id: company, map });

/**
 * Only what changed, as the category → account map the server takes (null
 * clears one). Sending the untouched rows too would rewrite them and count
 * them as "mapped" in the answer.
 */
export function mappingChanges(cats: AssetCategory[], draft: Record<number, number | null>): Record<number, number | null> {
  const out: Record<number, number | null> = {};
  for (const c of cats) {
    if (!(c.id in draft)) continue;
    const want = draft[c.id] ?? null;
    if (!sameId(want, c.account_id) && !(want === null && c.account_id === null)) out[c.id] = want;
  }
  return out;
}

// ── depreciation ─────────────────────────────────────────────────────────

export interface DepRun {
  id: number | string;
  period: string;
  charged_on: string;
  asset_count: number | string;
  total: string;
  status: string;
  journal_id?: number | string | null;
  journal_no: string | null;
  note: string | null;
}

export interface DepRow {
  asset_id: number;
  asset_code: string | null;
  name: string | null;
  amount: string;
}

export interface DepPreview {
  ok: boolean;
  period: string;
  charged_on: string;
  posted: boolean;
  journal_no: string | null;
  considered: number;
  rows: DepRow[];
  total: string;
  skipped: number;
  reasons: Record<string, number>;
  why?: string | null;
}

export interface OpeningAsset {
  id: number;
  asset_code: string | null;
  name: string | null;
  cost: string;
  status: string | null;
  /** Null until somebody records this asset's share of the brought-forward figure. */
  opening_accumulated: string | null;
}

export interface Opening {
  expected: string;
  entered: string;
  difference: string;
  ties: boolean;
  missing: number;
  posted: boolean;
  assets: OpeningAsset[];
}

export interface DepPayload {
  runs: DepRun[];
  preview: DepPreview;
  opening: Opening;
  /** Built on an area the server does not have ('post'), so it always says no. Not read — see Depreciation. */
  can?: Envelope;
}

export const fetchDepreciation = (company: number, period: string, signal?: AbortSignal) => apiGet<DepPayload>('/api/finance/depreciation', { company, period }, signal);

export const chargeMonth = (company: number, period: string) => apiPost<{ id?: number; journal_no?: string }>('/api/finance/depreciation', { company_id: company, period });

export const saveOpeningDepreciation = (company: number, assets: Record<number, string>) => apiPut<{ written?: number }>('/api/finance/depreciation/opening', { company_id: company, assets });

/** The month before a day, YYYY-MM — the one somebody almost always wants to charge. */
export function previousMonth(today: string): string {
  const [y, m] = today.split('-').map(Number);
  if (!y || !m) return today.slice(0, 7);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

/**
 * A typed split of the brought-forward depreciation, checked as the server
 * checks it: each figure a positive amount no larger than the asset's cost,
 * and the pieces together no more than the opening balance brought in. The
 * total counts what is already recorded for the assets not being changed.
 */
export function openingSplit(opening: Opening, typed: Record<number, string>): { send: Record<number, string>; total: number; expected: number; problems: string[] } {
  const send: Record<number, string> = {};
  const problems: string[] = [];
  let total = 0;
  for (const a of opening.assets) {
    const code = a.asset_code ?? `Asset ${a.id}`;
    const raw = (typed[a.id] ?? '').trim();
    const was = a.opening_accumulated;
    if (raw === '' || raw === was || (was !== null && cents(raw) === cents(was))) {
      total += was === null ? 0 : (cents(was) ?? 0);
      continue;
    }
    if (raw.startsWith('-')) {
      problems.push(`${code}: depreciation is stated as a positive figure, the way the trial balance carries it.`);
      continue;
    }
    const c = cents(raw);
    if (c === null) {
      problems.push(`${code}: not an amount. Use digits and at most two decimal places.`);
      continue;
    }
    const cost = cents(a.cost) ?? 0;
    if (c > cost) {
      problems.push(`${code}: more depreciation than its cost of ${a.cost}. An asset cannot be written down past what it cost.`);
      continue;
    }
    send[a.id] = raw.replace(/,/g, '');
    total += c;
  }
  const expected = cents(opening.expected) ?? 0;
  if (opening.posted && total > expected) {
    problems.push('Those figures come to more than the opening balance brought in for the whole company. The parts cannot come to more than the whole — one of the two has been read off the wrong line.');
  }
  return { send, total, expected, problems };
}

// ── purchase accounts ────────────────────────────────────────────────────

export interface Fallback {
  id: number | string;
  code: string;
  name: string;
}

export interface CategoryMapping {
  category_id: number;
  name: string;
  depth: number;
  account_id: number | null;
  code: string | null;
  account_name: string | null;
  revenue_account_id: number | null;
  revenue_code: string | null;
  revenue_name: string | null;
}

export interface VendorMapping {
  vendor_id: number;
  name: string;
  status: string | null;
  account_id: number | null;
  code: string | null;
  account_name: string | null;
}

export interface PurchasePayload {
  categories: CategoryMapping[];
  vendors: VendorMapping[];
  accounts: MappingAccount[];
  revenue_accounts: MappingAccount[];
  fallback: Fallback | null;
  revenue_fallback: Fallback | null;
  can?: Envelope;
}

export const fetchPurchaseAccounts = (company: number, signal?: AbortSignal) => apiGet<PurchasePayload>('/api/finance/purchase-accounts', { company }, signal);

export type MappingKind = 'cost' | 'vendor' | 'revenue';

const MAP_PATH: Record<MappingKind, string> = {
  cost: '/api/finance/purchase-accounts',
  vendor: '/api/finance/purchase-accounts/vendor',
  revenue: '/api/finance/purchase-accounts/revenue',
};

/** One row's account, or null for the default. A vendor is named by `vendor_id`, a category by `category_id`. */
export const saveMapping = (company: number, kind: MappingKind, id: number, account: number | null) =>
  apiPut(MAP_PATH[kind], { company_id: company, [kind === 'vendor' ? 'vendor_id' : 'category_id']: id, account_id: account });

/** "5100 Product Cost", or a phrase for a role nobody has nominated. */
export const accountLabel = (a: { code: string; name: string } | null | undefined, otherwise: string) => (a ? `${a.code} ${a.name}` : otherwise);

// ── the accounting profile ───────────────────────────────────────────────

export interface ProfileField {
  key: string;
  label: string;
  value: string | number | null;
  editable: boolean;
  why: string | null;
}

export interface SettingsPayload {
  company: { id: number; name: string; has_books: boolean };
  profile: ProfileField[];
  counts: { accounts?: number; journals?: number; posted?: number; tax_codes?: number; years?: number };
  roles: Array<{ role: string; label: string; code: string | null; name: string | null; mapped: boolean }>;
  can?: Envelope;
}

export const fetchSettings = (company: number, signal?: AbortSignal) => apiGet<SettingsPayload>('/api/finance/settings', { company }, signal);

// ── area access ──────────────────────────────────────────────────────────

export type Level = 'none' | 'view' | 'edit' | 'manage';
export const LEVELS: Level[] = ['none', 'view', 'edit', 'manage'];
export const rank = (l: string | null | undefined) => Math.max(0, LEVELS.indexOf((l ?? 'none') as Level));

export interface AccessCell {
  level: string;
  ceiling: string;
  /** 'company-grant' when narrowed here, 'suspended' when the membership is. */
  via: string;
  /** What was set here, or null when nothing was and the role decides ("inherit"). */
  granted: string | null;
  note: string | null;
  /** Present only while the restriction is in force. A UTC stamp. */
  expires_at: string | null;
}

export interface Member {
  user_id: number;
  name: string;
  email: string | null;
  company_role: string;
  modules: Record<string, AccessCell>;
  /** The preset the stored rows currently amount to — worked out on every read, never stored. */
  preset: string | null;
}

export interface Area {
  key: string;
  label: string;
  note: string | null;
}

export interface Preset {
  key: string;
  label: string;
  hint: string;
}

export interface MembersPayload {
  company: { id: number; name: string };
  members: Member[];
  matrix: { levels?: string[]; modules: Area[]; presets: Preset[] };
}

export const fetchMembers = (company: number, signal?: AbortSignal) => apiGet<MembersPayload>('/api/finance/access/members', { company }, signal);

export const setArea = (company: number, userId: number, v: { module: string; level: string; expires_at: string | null }) =>
  apiPut<{ module?: string; before?: string; after?: string }>(`/api/finance/access/members/${userId}?company=${company}`, v);

export const applyPreset = (company: number, userId: number, preset: string) =>
  apiPost<{ applied?: string[]; skipped?: Array<{ module: string; why: string }> }>(`/api/finance/access/members/${userId}/preset`, { preset }, { company });

/**
 * The choices for one cell: inherit, then the four levels weakest first.
 * Levels above the ceiling are offered disabled with the reason, not hidden —
 * somebody who cannot see that "manage" exists will go looking for it.
 */
export function levelChoices(ceiling: string): Array<{ value: string; label: string; disabled?: boolean }> {
  return [
    { value: 'inherit', label: `Inherit (${ceiling})` },
    ...LEVELS.map((l) => {
      const tooHigh = l !== 'none' && rank(l) > rank(ceiling);
      return { value: l, label: `${l.charAt(0).toUpperCase()}${l.slice(1)}${tooHigh ? ' — above their role' : ''}`, ...(tooHigh ? { disabled: true } : {}) };
    }),
  ];
}

/**
 * What each preset sets, mirrored from FinancePermissionService::PRESETS so
 * the confirmation can say what will happen to each area. The server applies
 * the preset and is the authority; a preset this list does not know is
 * previewed as nothing rather than guessed.
 */
export const PRESET_LEVELS: Record<string, Record<string, string>> = {
  unrestricted: { '*': 'inherit' },
  'read-only': { '*': 'view' },
  bookkeeper: { '*': 'view', journals: 'edit', accounts: 'edit' },
};

/**
 * A preset spelled out for one person: each area's level, clamped to what
 * their role reaches the way the server clamps it — a level above the ceiling
 * becomes the ceiling, or inherit where the role reaches nothing.
 */
export function expandPreset(preset: string, member: Pick<Member, 'modules'>, areas: string[]): Record<string, string> | null {
  const p = PRESET_LEVELS[preset];
  if (!p) return null;
  const out: Record<string, string> = {};
  for (const a of areas) {
    let want = p[a] ?? p['*'] ?? 'inherit';
    const ceiling = member.modules[a]?.ceiling ?? 'none';
    if (want !== 'inherit' && want !== 'none' && rank(want) > rank(ceiling)) want = ceiling === 'none' ? 'inherit' : ceiling;
    out[a] = want;
  }
  return out;
}

/** Nothing to narrow: the role reaches no area of Finance in this company. */
export const reachesNothing = (m: Member, areas: string[]) => areas.every((a) => (m.modules[a]?.ceiling ?? 'none') === 'none');

/** An end date as the server wants it: the end of that day on the setter's calendar, so "until the 5th" includes the 5th. */
export const endOfDay = (ymd: string) => `${ymd} 23:59:59`;

/** A stored instant (an end date, a link's expiry) as the day it falls on the reader's calendar. */
export function calendarDay(stamp: string | null | undefined): string {
  if (!stamp) return '';
  const d = parseTs(stamp);
  return Number.isNaN(d.getTime()) ? stamp.slice(0, 10) : dayKey(d);
}

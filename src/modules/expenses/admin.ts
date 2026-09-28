import { ApiError, apiGet, request } from '../../core/api';
import { K } from './api';

/**
 * Expenses' administration: the settings screen's own sections and setting
 * up a company (the web's `pages/expense/Admin.tsx`, drawn inside the
 * standard settings shell).
 *
 * TWO STORES, AND THE SCREEN SHOWS BOTH. The General section writes the
 * installation-wide `expense` settings group (`/api/module-settings/expense`,
 * three fields, read by the original claim endpoint). Company rules writes
 * `expense_org_settings` (`/api/expense/settings2`), which the newer claim
 * endpoint numbers from. Both are live, so neither is dropped.
 *
 * EVERY COLUMN MAY ARRIVE AS A STRING. `getResultArray()` hands back ids,
 * flags and counts as text, and `"0"` is truthy — so each row is converted
 * once, here, and the screens never test a raw column.
 *
 * RATES STAY TEXT. A mileage rate has four decimals, an exchange rate up to
 * eight; they are validated as text and sent as typed, never through a float.
 *
 * Writes go through `request` rather than `apiPost`, because the server's
 * own sentence ("1 USD = 301.25 LKR from 1 Oct 2026. Claims dated before then
 * keep whatever rate applied at the time.") is the confirmation worth showing.
 */

// ── keys: everything about one company ───────────────────────────────────

export const KA = {
  /** The standard shell's payload. Installation-wide values, but asked per company so a switch never shows stale sections. */
  moduleSettings: (orgId: number) => [...K.one(orgId), 'module-settings'] as const,
  rules: (orgId: number) => [...K.one(orgId), 'company-rules'] as const,
  centres: (orgId: number) => [...K.one(orgId), 'cost-centres'] as const,
  members: (orgId: number) => [...K.one(orgId), 'members'] as const,
  categories: (orgId: number) => [...K.one(orgId), 'categories'] as const,
  rates: (orgId: number) => [...K.one(orgId), 'rates'] as const,
  access: (orgId: number) => [...K.one(orgId), 'my-access'] as const,
  events: (orgId: number) => [...K.one(orgId), 'notifications'] as const,
  activity: (orgId: number) => [...K.one(orgId), 'activity'] as const,
  /** Every user's company list, whatever the uid — invalidated when a company is created or renamed. */
  orgLists: ['expenses', 'orgs'] as const,
};

// ── columns as values ────────────────────────────────────────────────────

/** A flag from a column: 1, '1', true, 'true'. Never `"0"`. */
export const flag = (v: unknown): boolean => v === true || v === 1 || v === '1' || v === 'true';

/** A positive id, or null for 0, '', null and anything that is not a whole number. */
export function idOf(v: unknown): number | null {
  const s = String(v ?? '').trim();
  return /^\d+$/.test(s) && Number(s) > 0 ? Number(s) : null;
}

/** A whole number from a column, or the fallback. */
export function intOf(v: unknown, fallback = 0): number {
  const s = String(v ?? '').trim();
  return /^-?\d+$/.test(s) ? Number(s) : fallback;
}

const text = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
const textOrNull = (v: unknown): string | null => {
  const s = text(v).trim();
  return s === '' ? null : s;
};

/** The server's refusal sentence when it is one — not a member, not allowed, pick one company — else null (a failed read). */
export function refusedWhy(e: unknown): string | null {
  return e instanceof ApiError && (e.status === 403 || e.status === 409) ? e.message : null;
}

/** A write, returning the server's own sentence. */
async function send<T = unknown>(method: 'POST' | 'PUT' | 'DELETE', path: string, orgId: number | null, body?: unknown): Promise<{ data: T; message: string | null }> {
  const r = await request<T>(method, path, { query: orgId === null ? undefined : { org: orgId }, body: body ?? {} });
  return { data: r.data, message: r.message ?? null };
}

// ── decimals as text ─────────────────────────────────────────────────────

/** A number greater than zero with at most `dp` decimals, read as text: "12.5", not "12.", "-1", "1e3" or "0.00". */
export function positiveDecimal(v: string, dp: number): boolean {
  const s = v.trim();
  return new RegExp(`^\\d+(\\.\\d{1,${dp}})?$`).test(s) && /[1-9]/.test(s);
}

/** "12.5000" → "12.50", "0.1250" stays: trailing zeros past two decimals dropped, by text. */
export function rateText(v: string | null | undefined): string {
  const s = text(v).trim();
  const m = /^(\d+)\.(\d+)$/.exec(s);
  if (!m) return s;
  const frac = m[2]!.replace(/0+$/, '');
  return `${m[1]}.${frac.length >= 2 ? frac : (frac + '00').slice(0, 2)}`;
}

const isDay = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v.trim());
const isCurrency = (v: string) => /^[A-Z]{3}$/.test(v.trim());

// ── the settings shell ───────────────────────────────────────────────────

/** What `/api/module-settings/expense` answers, as far as this screen reads it. */
export interface SettingsShow {
  label?: string;
  sections?: Record<string, string>;
  extra_sections?: Array<{ key: string; label: string }>;
  advanced_open?: boolean;
  can_edit?: boolean;
  note?: string | null;
  spec?: { unavailable?: Record<string, string> } | null;
}

export const fetchModuleSettings = (signal?: AbortSignal) => apiGet<SettingsShow>('/api/module-settings/expense', undefined, signal);

/** Where a section is drawn: here, or in the installation's settings shell in the browser. */
export interface SectionItem {
  key: string;
  label: string;
  native: boolean;
  /** Settings' own group, or the history link. */
  group: 'standard' | 'module' | 'history';
}

/** The sections this client draws itself; any other key the server lists is said, not blank. */
export const NATIVE_EXTRAS = ['company', 'centres', 'categories', 'rates', 'myaccess', 'events', 'activity', 'companies'];

const STANDARD: Array<[string, string, boolean]> = [
  ['general', 'General', true],
  ['access', 'User Access', false],
  ['screens', 'Screens & components', false],
  ['organization', 'Organization', false],
  ['notifications', 'Notifications', false],
  ['advanced', 'Advanced', true],
];

/**
 * The web shell's section list: the six standard ones in their order
 * (Advanced only for those who may open it), then the module's own, appended
 * and never interleaved, then the change log. The server has already narrowed
 * the module's own to the ones this person may open.
 *
 * Without the shell (it refused: this person does not administer Expenses),
 * My access alone — it answers "what may I do", which is the question of
 * somebody who cannot open the rest.
 */
export function sectionList(show: SettingsShow | null | undefined): SectionItem[] {
  const mine: SectionItem = { key: 'myaccess', label: 'My access', native: true, group: 'module' };
  if (!show) return [mine];
  const out: SectionItem[] = STANDARD.filter(([k]) => k !== 'advanced' || show.advanced_open === true).map(([key, label, native]) => ({ key, label: show.sections?.[key] ?? label, native, group: 'standard' }));
  // A section the server is ahead of this app with opens where it is drawn, marked, rather than as a blank panel.
  for (const x of show.extra_sections ?? []) out.push({ key: x.key, label: x.label, native: NATIVE_EXTRAS.includes(x.key), group: 'module' });
  if (!out.some((s) => s.key === 'myaccess')) out.push(mine);
  out.push({ key: 'history', label: 'Change log', native: false, group: 'history' });
  return out;
}

/** The browser address of a section drawn by the installation's shell. */
export const browserPath = (key: string) => (key === 'history' ? '/module-settings?module=expense' : `/module-settings?module=expense&section=${encodeURIComponent(key)}`);

// ── company rules (expense_org_settings) ─────────────────────────────────

export interface CompanyRules {
  name: string;
  currency: string;
  fiscalStartMonth: number;
  claimPrefix: string;
  advancePrefix: string;
  numberPad: number;
  glPrefix: string;
  requireCostCentre: boolean;
  requireProject: boolean;
  allowSelfApproval: boolean;
  /** Not drawn here, and sent back unchanged: the save writes every column, so leaving one out would clear it. */
  defaultCostCentreId: number | null;
  taxRateId: number | null;
  fiscalYear: { start: string; end: string; label: string } | null;
  role: string | null;
  receiptReading: { ok: boolean; message: string; engine: string | null; version: string | null } | null;
}

interface RawRules {
  organization?: { name?: unknown } | null;
  settings?: Record<string, unknown> | null;
  fiscal_year?: { start?: unknown; end?: unknown; label?: unknown } | null;
  role?: unknown;
  receipt_reading?: { ok?: unknown; message?: unknown; engine?: unknown; version?: unknown } | null;
}

export function toRules(r: RawRules): CompanyRules {
  const s = r.settings ?? {};
  return {
    name: text(r.organization?.name),
    currency: text(s.currency || 'LKR').toUpperCase(),
    fiscalStartMonth: Math.min(12, Math.max(1, intOf(s.fiscal_start_month, 1))),
    claimPrefix: text(s.claim_prefix ?? 'EXP'),
    advancePrefix: text(s.advance_prefix ?? 'ADV'),
    numberPad: intOf(s.number_pad, 4),
    glPrefix: text(s.gl_prefix),
    requireCostCentre: flag(s.require_cost_centre),
    requireProject: flag(s.require_project),
    allowSelfApproval: flag(s.allow_self_approval),
    defaultCostCentreId: idOf(s.default_cost_centre_id),
    taxRateId: idOf(s.tax_rate_id),
    fiscalYear: r.fiscal_year ? { start: text(r.fiscal_year.start), end: text(r.fiscal_year.end), label: text(r.fiscal_year.label) } : null,
    role: textOrNull(r.role),
    receiptReading: r.receipt_reading ? { ok: flag(r.receipt_reading.ok), message: text(r.receipt_reading.message), engine: textOrNull(r.receipt_reading.engine), version: textOrNull(r.receipt_reading.version) } : null,
  };
}

export const fetchRules = (orgId: number, signal?: AbortSignal) => apiGet<RawRules>('/api/expense/settings2', { org: orgId }, signal).then(toRules);

/** The form as typed: every field text, so a half-typed "1" is not coerced. */
export interface RulesDraft {
  name: string;
  currency: string;
  fiscalStartMonth: string;
  claimPrefix: string;
  advancePrefix: string;
  numberPad: string;
  glPrefix: string;
  requireCostCentre: boolean;
  requireProject: boolean;
  allowSelfApproval: boolean;
}

export const rulesDraft = (r: CompanyRules): RulesDraft => ({
  name: r.name,
  currency: r.currency,
  fiscalStartMonth: String(r.fiscalStartMonth),
  claimPrefix: r.claimPrefix,
  advancePrefix: r.advancePrefix,
  numberPad: String(r.numberPad),
  glPrefix: r.glPrefix,
  requireCostCentre: r.requireCostCentre,
  requireProject: r.requireProject,
  allowSelfApproval: r.allowSelfApproval,
});

/** What the server would clamp or refuse, said before it is sent. */
export function rulesProblems(d: RulesDraft): string[] {
  const out: string[] = [];
  if (!d.name.trim()) out.push('Give the organization a name.');
  if (!isCurrency(d.currency)) out.push('Give the currency as a three-letter code.');
  if (!/^\d+$/.test(d.numberPad.trim()) || Number(d.numberPad) < 1 || Number(d.numberPad) > 10) out.push('A claim number has between 1 and 10 digits.');
  if (d.claimPrefix.trim().length > 12 || d.advancePrefix.trim().length > 12) out.push('A prefix is at most 12 characters.');
  if (d.glPrefix.trim().length > 20) out.push('The account code prefix is at most 20 characters.');
  return out;
}

/** Every column the save writes — the two not drawn here carried over, so saving does not clear them. */
export function rulesBody(r: CompanyRules, d: RulesDraft) {
  return {
    name: d.name.trim(),
    currency: d.currency.trim().toUpperCase(),
    fiscal_start_month: Number(d.fiscalStartMonth) || 1,
    claim_prefix: d.claimPrefix.trim(),
    advance_prefix: d.advancePrefix.trim(),
    number_pad: Number(d.numberPad),
    gl_prefix: d.glPrefix.trim(),
    require_cost_centre: d.requireCostCentre ? 1 : 0,
    require_project: d.requireProject ? 1 : 0,
    allow_self_approval: d.allowSelfApproval ? 1 : 0,
    default_cost_centre_id: r.defaultCostCentreId,
    tax_rate_id: r.taxRateId,
  };
}

export const saveRules = (orgId: number, body: ReturnType<typeof rulesBody>) => send('PUT', '/api/expense/settings2', orgId, body);

// ── cost centres ─────────────────────────────────────────────────────────

export interface CostCentre {
  id: number;
  code: string;
  name: string;
  kind: 'cost' | 'profit';
  manager: string | null;
  managerId: number | null;
  glCode: string | null;
  status: 'active' | 'archived';
  spend: string;
  claims: number;
  /** Carried back on a save: it writes every column. */
  parentId: number | null;
  branchId: number | null;
  departmentId: number | null;
}

export interface CentreList {
  items: CostCentre[];
  yearLabel: string;
  currency: string;
}

export function toCentre(r: Record<string, unknown>): CostCentre {
  return {
    id: idOf(r.id) ?? 0,
    code: text(r.code),
    name: text(r.name),
    kind: r.kind === 'profit' ? 'profit' : 'cost',
    manager: textOrNull(r.manager),
    managerId: idOf(r.manager_id),
    glCode: textOrNull(r.gl_code),
    status: r.status === 'archived' ? 'archived' : 'active',
    spend: text(r.spend || '0.00'),
    claims: Math.max(0, intOf(r.claims)),
    parentId: idOf(r.parent_id),
    branchId: idOf(r.branch_id),
    departmentId: idOf(r.department_id),
  };
}

export const fetchCentres = (orgId: number, signal?: AbortSignal) =>
  apiGet<{ items?: Array<Record<string, unknown>>; fiscal_year?: { label?: unknown } | null; currency?: unknown }>('/api/expense/cost-centres', { org: orgId }, signal).then(
    (r): CentreList => ({ items: (r.items ?? []).map(toCentre), yearLabel: text(r.fiscal_year?.label), currency: text(r.currency) }),
  );

/** Who a cost centre can name as its owner: the company's members. */
export const fetchMembers = (orgId: number, signal?: AbortSignal) =>
  apiGet<{ items?: Array<{ user_id?: unknown; name?: unknown; role?: unknown }> }>('/api/expense/members', { org: orgId }, signal).then((r) =>
    (r.items ?? []).map((m) => ({ userId: idOf(m.user_id) ?? 0, name: text(m.name), role: text(m.role) })).filter((m) => m.userId > 0),
  );

export interface CentreDraft {
  code: string;
  name: string;
  kind: 'cost' | 'profit';
  glCode: string;
  managerId: string;
  status: 'active' | 'archived';
}

export const centreDraft = (c: CostCentre | null): CentreDraft =>
  c ? { code: c.code, name: c.name, kind: c.kind, glCode: c.glCode ?? '', managerId: c.managerId ? String(c.managerId) : '', status: c.status } : { code: '', name: '', kind: 'cost', glCode: '', managerId: '', status: 'active' };

export function centreProblems(d: CentreDraft): string[] {
  const out: string[] = [];
  if (!d.code.trim() || !d.name.trim()) out.push('A cost centre needs both a code and a name.');
  if (d.code.trim().length > 30) out.push('The code is at most 30 characters.');
  if (d.glCode.trim().length > 40) out.push('The GL code is at most 40 characters.');
  return out;
}

/** The whole row, because the save writes every column: the parent, branch and department this screen does not draw go back as they were. */
export function centreBody(d: CentreDraft, was: CostCentre | null) {
  return {
    code: d.code.trim().toUpperCase(),
    name: d.name.trim(),
    kind: d.kind,
    gl_code: d.glCode.trim(),
    manager_id: idOf(d.managerId),
    status: d.status,
    parent_id: was?.parentId ?? null,
    branch_id: was?.branchId ?? null,
    department_id: was?.departmentId ?? null,
  };
}

export const saveCentre = (orgId: number, body: ReturnType<typeof centreBody>, id: number | null) =>
  id === null ? send<{ id: number }>('POST', '/api/expense/cost-centres', orgId, body) : send<{ id: number }>('PUT', `/api/expense/cost-centres/${id}`, orgId, body);

export const removeCentre = (orgId: number, id: number) => send('DELETE', `/api/expense/cost-centres/${id}`, orgId);

// ── categories ───────────────────────────────────────────────────────────

export interface Category {
  id: number;
  name: string;
  code: string | null;
  glCode: string | null;
  requiresReceipt: boolean;
  /** Belongs to every company (`org_id` 0) — changing it needs expense.admin. */
  shared: boolean;
  status: 'active' | 'archived';
  /** Carried back on a save. */
  taxRateId: number | null;
  parentId: number | null;
  sort: number;
}

export function toCategory(r: Record<string, unknown>): Category {
  return {
    id: idOf(r.id) ?? 0,
    name: text(r.name),
    code: textOrNull(r.code),
    glCode: textOrNull(r.gl_code),
    requiresReceipt: flag(r.requires_receipt),
    // The server sends `shared` as a real boolean; the column is the fallback.
    shared: r.shared === undefined ? intOf(r.org_id, -1) === 0 : flag(r.shared),
    status: r.status === 'archived' ? 'archived' : 'active',
    taxRateId: idOf(r.tax_rate_id),
    parentId: idOf(r.parent_id),
    sort: intOf(r.sort),
  };
}

export const fetchCategories = (orgId: number, signal?: AbortSignal) =>
  apiGet<{ items?: Array<Record<string, unknown>> }>('/api/expense/categories2', { org: orgId }, signal).then((r) => (r.items ?? []).map(toCategory));

export interface CategoryDraft {
  name: string;
  code: string;
  glCode: string;
  requiresReceipt: boolean;
  shared: boolean;
  status: 'active' | 'archived';
}

export const categoryDraft = (c: Category | null): CategoryDraft =>
  c ? { name: c.name, code: c.code ?? '', glCode: c.glCode ?? '', requiresReceipt: c.requiresReceipt, shared: c.shared, status: c.status } : { name: '', code: '', glCode: '', requiresReceipt: false, shared: false, status: 'active' };

export function categoryProblems(d: CategoryDraft): string[] {
  const out: string[] = [];
  if (!d.name.trim()) out.push('Give the category a name.');
  if (d.name.trim().length > 100) out.push('The name is at most 100 characters.');
  if (d.code.trim().length > 20) out.push('The short code is at most 20 characters.');
  return out;
}

export function categoryBody(d: CategoryDraft, was: Category | null) {
  return {
    name: d.name.trim(),
    code: d.code.trim(),
    gl_code: d.glCode.trim(),
    requires_receipt: d.requiresReceipt ? 1 : 0,
    status: d.status,
    tax_rate_id: was?.taxRateId ?? null,
    parent_id: was?.parentId ?? null,
    sort: was?.sort ?? 0,
    // Only a new category can be shared; the server ignores it without expense.admin.
    ...(was ? {} : { shared: d.shared }),
  };
}

export const saveCategory = (orgId: number, body: ReturnType<typeof categoryBody>, id: number | null) =>
  id === null ? send<{ id: number }>('POST', '/api/expense/categories2', orgId, body) : send<{ id: number }>('PUT', `/api/expense/categories2/${id}`, orgId, body);

// ── rates ────────────────────────────────────────────────────────────────

export interface MileageRate {
  id: number;
  vehicle: string;
  unit: 'km' | 'mile';
  rate: string;
  thresholdUnits: string | null;
  rateAfter: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
}

export interface PerDiemRate {
  id: number;
  country: string | null;
  city: string | null;
  dailyRate: string;
  currency: string;
  firstLastPct: number;
  effectiveFrom: string;
}

export interface FxRate {
  id: number;
  currency: string;
  rate: string;
  effectiveOn: string;
  source: string | null;
}

export interface RatesData {
  currency: string;
  mileage: MileageRate[];
  perDiem: PerDiemRate[];
  fx: FxRate[];
  note: string;
  /** An administrator of this company: `OrgContext::canAct(admin)`. */
  canEdit: boolean;
}

type Row = Record<string, unknown>;

export function toRates(r: { currency?: unknown; mileage?: Row[]; per_diem?: Row[]; fx?: Row[]; note?: unknown; can_edit?: unknown }): RatesData {
  return {
    currency: text(r.currency),
    mileage: (r.mileage ?? []).map((m) => ({
      id: idOf(m.id) ?? 0,
      vehicle: text(m.vehicle),
      unit: m.unit === 'mile' ? 'mile' : 'km',
      rate: text(m.rate),
      thresholdUnits: textOrNull(m.threshold_units),
      rateAfter: textOrNull(m.rate_after),
      effectiveFrom: text(m.effective_from),
      effectiveTo: textOrNull(m.effective_to),
    })),
    perDiem: (r.per_diem ?? []).map((p) => ({
      id: idOf(p.id) ?? 0,
      country: textOrNull(p.country),
      city: textOrNull(p.city),
      dailyRate: text(p.daily_rate),
      currency: text(p.currency),
      firstLastPct: intOf(p.first_last_pct, 100),
      effectiveFrom: text(p.effective_from),
    })),
    fx: (r.fx ?? []).map((f) => ({ id: idOf(f.id) ?? 0, currency: text(f.currency), rate: text(f.rate), effectiveOn: text(f.effective_on), source: textOrNull(f.source) })),
    note: text(r.note),
    canEdit: flag(r.can_edit),
  };
}

export const fetchRates = (orgId: number, signal?: AbortSignal) => apiGet<Parameters<typeof toRates>[0]>('/api/expense/rates', { org: orgId }, signal).then(toRates);

export interface MileageDraft {
  vehicle: string;
  unit: 'km' | 'mile';
  rate: string;
  thresholdUnits: string;
  rateAfter: string;
  effectiveFrom: string;
}

export const mileageDraft = (today: string): MileageDraft => ({ vehicle: 'car', unit: 'km', rate: '', thresholdUnits: '', rateAfter: '', effectiveFrom: today });

/** Rates.php's own rules, said before sending: the rate to four decimals, a tier whole or not at all, a start date. */
export function mileageProblems(d: MileageDraft): string[] {
  const out: string[] = [];
  if (!positiveDecimal(d.rate, 4)) out.push('The rate has to be a number greater than zero, with up to four decimals.');
  const tier = d.thresholdUnits.trim();
  const after = d.rateAfter.trim();
  if ((tier === '') !== (after === '')) out.push('A tier needs both a threshold and the rate that applies above it.');
  else if (tier !== '') {
    if (!positiveDecimal(tier, 2)) out.push('The threshold has to be a distance greater than zero, with up to two decimals.');
    if (!positiveDecimal(after, 4)) out.push('The rate after the threshold has to be a number greater than zero, with up to four decimals.');
  }
  if (!isDay(d.effectiveFrom)) out.push('A rate has to say when it takes effect, so historic claims keep the rate they were paid at.');
  if (d.vehicle.trim().length > 60) out.push('The vehicle is at most 60 characters.');
  return out;
}

export const mileageBody = (d: MileageDraft) => ({
  vehicle: d.vehicle.trim() || 'car',
  unit: d.unit,
  rate: d.rate.trim(),
  threshold_units: d.thresholdUnits.trim(),
  rate_after: d.rateAfter.trim(),
  effective_from: d.effectiveFrom.trim(),
});

export interface PerDiemDraft {
  country: string;
  city: string;
  dailyRate: string;
  firstLastPct: string;
  effectiveFrom: string;
}

export const perDiemDraft = (today: string): PerDiemDraft => ({ country: '', city: '', dailyRate: '', firstLastPct: '100', effectiveFrom: today });

export function perDiemProblems(d: PerDiemDraft): string[] {
  const out: string[] = [];
  if (!positiveDecimal(d.dailyRate.replace(/,/g, ''), 2)) out.push('The daily rate has to be an amount greater than zero.');
  const pct = d.firstLastPct.trim();
  if (!/^\d{1,3}$/.test(pct) || Number(pct) > 100) out.push('The first and last day are paid at a whole percentage, 0 to 100.');
  if (!isDay(d.effectiveFrom)) out.push('A rate has to say when it takes effect.');
  return out;
}

export const perDiemBody = (d: PerDiemDraft) => ({
  country: d.country.trim(),
  city: d.city.trim(),
  daily_rate: d.dailyRate.trim().replace(/,/g, ''),
  first_last_pct: Number(d.firstLastPct.trim()),
  effective_from: d.effectiveFrom.trim(),
});

export interface FxDraft {
  currency: string;
  rate: string;
  effectiveOn: string;
}

export const fxDraft = (today: string): FxDraft => ({ currency: '', rate: '', effectiveOn: today });

export function fxProblems(d: FxDraft, base: string): string[] {
  const out: string[] = [];
  const cur = d.currency.trim().toUpperCase();
  if (!isCurrency(cur)) out.push('Give the currency as a three-letter code.');
  else if (cur === base.toUpperCase()) out.push(`${base} is this organization's own currency, so its rate is always 1.`);
  if (!positiveDecimal(d.rate.replace(/,/g, ''), 8)) out.push('The rate has to be a number greater than zero, with up to eight decimals.');
  if (!isDay(d.effectiveOn)) out.push('Give the date the rate applies from.');
  return out;
}

export const fxBody = (d: FxDraft) => ({ currency: d.currency.trim().toUpperCase(), rate: d.rate.trim().replace(/,/g, ''), effective_on: d.effectiveOn.trim() });

export const addMileage = (orgId: number, body: ReturnType<typeof mileageBody>) => send('POST', '/api/expense/rates/mileage', orgId, body);
export const addPerDiem = (orgId: number, body: ReturnType<typeof perDiemBody>) => send('POST', '/api/expense/rates/per-diem', orgId, body);
export const addFx = (orgId: number, body: ReturnType<typeof fxBody>) => send('POST', '/api/expense/rates/fx', orgId, body);

// ── my access ────────────────────────────────────────────────────────────

export interface ScopeRow {
  allowed: boolean;
  why: string;
}

export interface MyAccess {
  role: string | null;
  viaStar: boolean;
  posting: { branch: string | null; department: string | null; costCentre: string | null };
  /** Whether a posting can be recorded at all — none defined is not the same as not recorded. */
  configurable: { branch: boolean; department: boolean };
  personalLimit: string | null;
  scopes: Record<string, ScopeRow>;
  permissions: Array<{ slug: string; name: string; held: boolean }>;
}

interface RawAccess {
  role?: unknown;
  via_star?: unknown;
  posting?: { branch?: unknown; department?: unknown; cost_centre?: unknown } | null;
  configurable?: { branch?: unknown; department?: unknown } | null;
  personal_limit?: unknown;
  scopes?: Record<string, { allowed?: unknown; why?: unknown }> | null;
  permissions?: Array<{ slug?: unknown; name?: unknown; held?: unknown }> | null;
}

export function toAccess(r: RawAccess): MyAccess {
  const scopes: Record<string, ScopeRow> = {};
  for (const [k, s] of Object.entries(r.scopes ?? {})) scopes[k] = { allowed: flag(s?.allowed), why: text(s?.why) };
  // A limit of "0.00" or none is no ceiling of one's own.
  const limit = textOrNull(r.personal_limit);
  return {
    role: textOrNull(r.role),
    viaStar: flag(r.via_star),
    posting: { branch: textOrNull(r.posting?.branch), department: textOrNull(r.posting?.department), costCentre: textOrNull(r.posting?.cost_centre) },
    configurable: { branch: flag(r.configurable?.branch), department: flag(r.configurable?.department) },
    personalLimit: limit && /[1-9]/.test(limit) ? limit : null,
    scopes,
    permissions: (r.permissions ?? []).map((p) => ({ slug: text(p.slug), name: text(p.name), held: flag(p.held) })).filter((p) => p.slug !== ''),
  };
}

export const fetchAccess = (orgId: number, signal?: AbortSignal) => apiGet<RawAccess>('/api/expense/access', { org: orgId }, signal).then(toAccess);

/** The claim lists in the order they widen. */
export const SCOPE_ORDER: Array<[string, string]> = [
  ['mine', 'My expenses'],
  ['team', 'Team'],
  ['department', 'Department'],
  ['branch', 'Branch'],
  ['organization', 'Organization'],
];

// ── who gets told ────────────────────────────────────────────────────────

export interface EventRow {
  slug: string;
  label: string;
  when: string;
  who: string;
  warning: boolean;
}

export interface Catalogue {
  events: EventRow[];
  roles: { admin: number; finance: number; approver: number; member: number };
  delivery: string;
}

export function toCatalogue(r: { events?: Row[]; roles?: Record<string, unknown> | null; delivery?: unknown }): Catalogue {
  const n = (v: unknown) => Math.max(0, intOf(v));
  return {
    events: (r.events ?? []).map((e) => ({ slug: text(e.slug), label: text(e.label), when: text(e.when), who: text(e.who), warning: e.level === 'warning' })),
    roles: { admin: n(r.roles?.admin), finance: n(r.roles?.finance), approver: n(r.roles?.approver), member: n(r.roles?.member) },
    delivery: text(r.delivery),
  };
}

export const fetchCatalogue = (orgId: number, signal?: AbortSignal) => apiGet<Parameters<typeof toCatalogue>[0]>('/api/expense/notifications', { org: orgId }, signal).then(toCatalogue);

export const ROLE_WORDS: Array<[keyof Catalogue['roles'], string]> = [
  ['admin', 'Administrators'],
  ['finance', 'Finance'],
  ['approver', 'Approvers'],
  ['member', 'Members'],
];

/** "administrators, finance": the roles nobody holds here, which is why an event addressed to them reaches no one. */
export const silentRoles = (roles: Catalogue['roles']) => ROLE_WORDS.filter(([k]) => roles[k] === 0).map(([, l]) => l.toLowerCase());

// ── activity ─────────────────────────────────────────────────────────────

export interface ActivityRow {
  entity: string;
  action: string;
  summary: string;
  at: string;
  /** Null when the system acted — a scheduled job settling a run has no person. */
  actor: string | null;
}

export const fetchActivity = (orgId: number, signal?: AbortSignal) =>
  apiGet<{ items?: Row[] }>('/api/expense/activity', { org: orgId }, signal).then((r) =>
    (r.items ?? []).map((a): ActivityRow => ({ entity: text(a.entity_type), action: text(a.action), summary: text(a.summary), at: text(a.created_at), actor: textOrNull(a.actor) })),
  );

// ── set up a company ─────────────────────────────────────────────────────

export interface OrgDraft {
  name: string;
  currency: string;
  fiscalStartMonth: string;
}

export const orgDraft = (): OrgDraft => ({ name: '', currency: 'LKR', fiscalStartMonth: '1' });

export function orgProblems(d: OrgDraft): string[] {
  const out: string[] = [];
  if (!d.name.trim()) out.push('Give the organization a name.');
  if (d.name.trim().length > 150) out.push('The name is at most 150 characters.');
  if (!isCurrency(d.currency.toUpperCase())) out.push('Give the currency as a three-letter code.');
  return out;
}

export const createOrg = (d: OrgDraft) =>
  send<{ id: number; name: string }>('POST', '/api/expense/organizations', null, { name: d.name.trim(), currency: d.currency.trim().toUpperCase(), fiscal_start_month: Number(d.fiscalStartMonth) || 1 });

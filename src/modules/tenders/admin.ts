import { apiDelete, apiGet, apiPost, apiPut } from '../../core/api';
import { addDays } from '../../core/time';
import type { CurrencyTotal } from './api';

/**
 * Tenders' company-wide screens (the server's `/api/tender/…`): the document
 * library — the company's own certificates, which checklist lines are
 * satisfied from — the reports, and the settings: scoring rules, where
 * tenders come from, and the module's switches. Reading needs `tender.view`;
 * the library is kept on `tender.manage`; rules and sources on
 * `tender.settings`.
 *
 * A LIBRARY DOCUMENT AND A RULE ARE SAVED WHOLE. The server writes every
 * field it is given and blanks the ones it is not, so an edit always sends
 * the whole form — never a patch — and names the document's own company.
 */

const int = (v: unknown): number | null => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Math.trunc(Number(v)));
const str = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v));

export const KA = {
  library: (org: string) => ['tenders', 'library', org] as const,
  report: (org: string, from: string, to: string) => ['tenders', 'report', org, from, to] as const,
  rules: (org: string) => ['tenders', 'rules', org] as const,
  sources: (org: string) => ['tenders', 'sources', org] as const,
  runs: (id: number) => ['tenders', 'source-runs', id] as const,
  settings: ['tenders', 'module-settings'] as const,
};

// ── the library ─────────────────────────────────────────────────────────

export const LIBRARY_KINDS: Array<[string, string]> = [
  ['registration', 'Registration'],
  ['tax', 'Tax'],
  ['financial', 'Financial'],
  ['insurance', 'Insurance'],
  ['certification', 'Certification'],
  ['reference', 'Reference'],
  ['other', 'Other'],
];
export const libraryKind = (k: string) => LIBRARY_KINDS.find(([v]) => v === k)?.[1] ?? k.replace(/_/g, ' ');

export interface LibraryDoc {
  id: number;
  org_id: number | null;
  name: string;
  kind: string;
  reference: string | null;
  file: { id: number; name: string | null } | null;
  issued_on: string | null;
  expires_on: string | null;
  days_left: number | null;
  state: 'valid' | 'expiring' | 'expired';
  note: string | null;
}

export interface Library {
  items: LibraryDoc[];
  summary: { total: number; expired: number; expiring: number };
}

export async function fetchLibrary(org: string, signal?: AbortSignal): Promise<Library> {
  const d = await apiGet<{ items?: Array<Record<string, unknown>>; summary?: Library['summary'] }>('/api/tender/library', org ? { org } : undefined, signal);
  return {
    items: (d.items ?? []).map((r) => {
      const f = r.file as { id?: unknown; name?: unknown } | null;
      return {
        id: int(r.id) ?? 0,
        org_id: int(r.org_id),
        name: String(r.name ?? ''),
        kind: String(r.kind ?? 'other'),
        reference: str(r.reference),
        file: f && int(f.id) ? { id: int(f.id)!, name: str(f.name) } : null,
        issued_on: str(r.issued_on),
        expires_on: str(r.expires_on),
        days_left: int(r.days_left),
        state: (['valid', 'expiring', 'expired'].includes(String(r.state)) ? r.state : 'valid') as LibraryDoc['state'],
        note: str(r.note),
      };
    }),
    summary: d.summary ?? { total: 0, expired: 0, expiring: 0 },
  };
}

export type LibraryFilter = 'all' | 'expired' | 'expiring' | 'valid' | 'nofile';
export function filterLibrary(items: LibraryDoc[], f: LibraryFilter, q: string): LibraryDoc[] {
  const t = q.trim().toLowerCase();
  return items.filter((d) => (f === 'all' || (f === 'nofile' ? !d.file : d.state === f)) && (!t || [d.name, d.reference, libraryKind(d.kind), d.note].some((x) => (x ?? '').toLowerCase().includes(t))));
}

export interface LibraryDraft {
  name: string;
  kind: string;
  reference: string;
  issued_on: string;
  expires_on: string;
  note: string;
  file: { id: number; name: string | null } | null;
}

export const libraryDraft = (d: LibraryDoc | null): LibraryDraft => ({
  name: d?.name ?? '',
  kind: d?.kind ?? 'registration',
  reference: d?.reference ?? '',
  issued_on: d?.issued_on ?? '',
  expires_on: d?.expires_on ?? '',
  note: d?.note ?? '',
  file: d?.file ?? null,
});

/** The whole document, in the server's spelling, for the one company it belongs to. */
export function libraryBody(d: LibraryDraft, org: number | null): { body: Record<string, string | number | null> | null; error: string | null } {
  if (!d.name.trim()) return { body: null, error: 'The document needs a name.' };
  if (d.issued_on && d.expires_on && d.expires_on < d.issued_on) return { body: null, error: 'It cannot expire before it was issued.' };
  return {
    body: {
      name: d.name.trim(),
      kind: d.kind,
      reference: d.reference.trim(),
      issued_on: d.issued_on,
      expires_on: d.expires_on,
      note: d.note.trim(),
      file_id: d.file?.id ?? null,
      ...(org ? { org: String(org) } : {}),
    },
    error: null,
  };
}

export const saveLibraryDoc = (body: Record<string, string | number | null>, id: number | null) => (id ? apiPut<{ id: number }>(`/api/tender/library/${id}`, body) : apiPost<{ id: number }>('/api/tender/library', body));
export const removeLibraryDoc = (id: number) => apiDelete(`/api/tender/library/${id}`);
export const removeLibraryDocs = (ids: number[], org: string) => apiPost<{ done: Array<{ id: number }>; failed: Array<{ id: number; why: string }> }>('/api/tender/library/bulk', { action: 'remove', ids, ...(org ? { org } : {}) });

// ── reports ─────────────────────────────────────────────────────────────

export type PeriodPreset = 'month' | 'quarter' | 'year' | '12m' | 'all' | 'custom';
export const PERIODS: Array<[PeriodPreset, string]> = [
  ['month', 'This month'],
  ['quarter', 'This quarter'],
  ['year', 'This year'],
  ['12m', 'The last 12 months'],
  ['all', 'All time'],
  ['custom', 'Between…'],
];

/** A preset's days on the reader's calendar, from today (YYYY-MM-DD); '' for no bound. */
export function periodOf(p: PeriodPreset, today: string, custom: { from: string; to: string } = { from: '', to: '' }): { from: string; to: string } {
  const [y, m] = today.split('-').map(Number) as [number, number];
  const pad = (n: number) => String(n).padStart(2, '0');
  if (p === 'month') return { from: `${y}-${pad(m)}-01`, to: today };
  if (p === 'quarter') return { from: `${y}-${pad(Math.floor((m - 1) / 3) * 3 + 1)}-01`, to: today };
  if (p === 'year') return { from: `${y}-01-01`, to: today };
  if (p === '12m') return { from: addDays(`${y - 1}-${today.slice(5)}`, 1), to: today };
  if (p === 'custom') return custom;
  return { from: '', to: '' };
}

export interface Report {
  total: number;
  open: number;
  won: number;
  lost: number;
  cancelled: number;
  win_rate: number | null;
  awarded_by_currency: CurrencyTotal[];
  by_industry: Record<string, number>;
  by_sector: Record<string, number>;
  loss_analysis: {
    lost: number;
    by_reason: Record<string, number>;
    by_competitor: Record<string, number>;
    price_gap: { samples: number; median: number; note: string } | null;
    note: string;
  };
  note: string;
}

const counts = (v: unknown): Record<string, number> => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, n]) => [k, Number(n)])) : {});

export async function fetchReport(org: string, from: string, to: string, signal?: AbortSignal): Promise<Report> {
  const d = await apiGet<Partial<Report> & { loss_analysis?: Partial<Report['loss_analysis']> }>('/api/tender/reports', { ...(org ? { org } : {}), ...(from ? { from } : {}), ...(to ? { to } : {}) }, signal);
  const l: Partial<Report['loss_analysis']> = d.loss_analysis ?? {};
  return {
    total: Number(d.total ?? 0),
    open: Number(d.open ?? 0),
    won: Number(d.won ?? 0),
    lost: Number(d.lost ?? 0),
    cancelled: Number(d.cancelled ?? 0),
    win_rate: d.win_rate ?? null,
    awarded_by_currency: d.awarded_by_currency ?? [],
    by_industry: counts(d.by_industry),
    by_sector: counts(d.by_sector),
    loss_analysis: { lost: Number(l.lost ?? 0), by_reason: counts(l.by_reason), by_competitor: counts(l.by_competitor), price_gap: l.price_gap ?? null, note: l.note ?? '' },
    note: d.note ?? '',
  };
}

/** Counts as bars, largest first, each as a share of the largest. */
export function bars(c: Record<string, number>, limit = 8): Array<{ label: string; n: number; pct: number }> {
  const list = Object.entries(c)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const top = list[0]?.[1] ?? 0;
  return list.slice(0, limit).map(([label, n]) => ({ label, n, pct: top ? Math.round((n / top) * 100) : 0 }));
}

// ── scoring rules ───────────────────────────────────────────────────────

export type Factor = 'industry' | 'category' | 'sector' | 'country' | 'budget' | 'client_history' | 'certifications' | 'lead_time' | 'owner_load';
export type Operator = 'equals' | 'in' | 'between' | 'gte' | 'lte' | 'has_all' | 'has_any';

export const NUMERIC: Factor[] = ['budget', 'client_history', 'lead_time', 'owner_load'];

/** The comparisons a factor can ever match — the server refuses the rest. */
export function operatorsFor(f: Factor): Operator[] {
  if (f === 'certifications') return ['has_all', 'has_any'];
  return NUMERIC.includes(f) ? ['gte', 'lte', 'equals', 'between', 'in'] : ['equals', 'in'];
}

export const OPERATOR_WORDS: Record<Operator, string> = {
  gte: 'is at least',
  lte: 'is at most',
  equals: 'is',
  between: 'is between',
  in: 'is one of',
  has_all: 'are all held',
  has_any: 'are not all held',
};

export interface Rule {
  id: number;
  org_id: number | null;
  name: string;
  factor: Factor;
  operator: Operator;
  value: string;
  points: number;
  reason: string;
  enabled: boolean;
  sort_order: number;
}

export interface Rules {
  rules: Rule[];
  factors: Record<string, string>;
  note: string;
}

export async function fetchRules(org: string, signal?: AbortSignal): Promise<Rules> {
  const d = await apiGet<{ rules?: Array<Record<string, unknown>>; factors?: Record<string, string>; note?: string }>('/api/tender/rules', org ? { org } : undefined, signal);
  return {
    rules: (d.rules ?? []).map((r) => ({
      id: int(r.id) ?? 0,
      org_id: int(r.org_id),
      name: String(r.name ?? ''),
      factor: String(r.factor) as Factor,
      operator: String(r.operator) as Operator,
      value: String(r.value ?? ''),
      points: int(r.points) ?? 0,
      reason: String(r.reason ?? ''),
      enabled: r.enabled === true || String(r.enabled) === '1',
      sort_order: int(r.sort_order) ?? 0,
    })),
    factors: d.factors ?? {},
    note: d.note ?? '',
  };
}

/** A rule as a sentence: "Published budget ceiling is at least 1,000,000". */
export function ruleSentence(r: Pick<Rule, 'factor' | 'operator' | 'value'>, factors: Record<string, string>): string {
  const what = factors[r.factor] ?? r.factor.replace(/_/g, ' ');
  if (r.factor === 'certifications') return r.operator === 'has_all' ? 'Every mandatory requirement is met' : 'A mandatory requirement is outstanding';
  const num = (v: string) => (/^-?\d+(\.\d+)?$/.test(v.trim()) ? Number(v).toLocaleString() : v.trim());
  const parts = r.value
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
  const val = r.operator === 'between' ? parts.map(num).join(' and ') : r.operator === 'in' ? parts.map(num).join(', ') : num(r.value);
  return `${what} ${OPERATOR_WORDS[r.operator]} ${val}`;
}

export interface RuleDraft {
  name: string;
  factor: Factor;
  operator: Operator;
  value: string;
  points: string;
  reason: string;
  enabled: boolean;
}

export const ruleDraft = (r: Rule | null): RuleDraft => ({
  name: r?.name ?? '',
  factor: r?.factor ?? 'industry',
  operator: r?.operator ?? 'equals',
  value: r?.value ?? '',
  points: r ? String(r.points) : '10',
  reason: r?.reason ?? '',
  enabled: r?.enabled ?? true,
});

/** The whole rule, checked the way the server checks it, so a rule that could never fire is not sent. */
export function ruleBody(d: RuleDraft, sortOrder: number, org: number | null): { body: Record<string, string | number> | null; error: string | null } {
  if (!d.name.trim()) return { body: null, error: 'Give the rule a name — it is what appears next to the score.' };
  if (!operatorsFor(d.factor).includes(d.operator)) return { body: null, error: 'That comparison never matches this factor.' };
  const parts = d.value
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
  if (d.factor !== 'certifications') {
    if (!parts.length) return { body: null, error: 'The rule needs a value to compare with.' };
    if (NUMERIC.includes(d.factor) && parts.some((v) => !/^-?\d+(\.\d+)?$/.test(v))) return { body: null, error: 'This factor is a number, so the value has to be one (or numbers separated by commas).' };
    if (d.operator === 'between' && (parts.length !== 2 || Number(parts[0]) > Number(parts[1]))) return { body: null, error: 'Between takes two numbers, the lower first: 10, 30.' };
    if (['gte', 'lte', 'equals'].includes(d.operator) && parts.length !== 1) return { body: null, error: 'That comparison takes one value.' };
  }
  const points = Number(d.points);
  if (!Number.isInteger(points) || points < -100 || points > 100 || points === 0) return { body: null, error: 'Points are a whole number from -100 to 100, and not 0 — a rule that moves nothing does nothing.' };
  return {
    body: {
      name: d.name.trim(),
      factor: d.factor,
      operator: d.operator,
      value: d.factor === 'certifications' ? '' : parts.join(', '),
      points,
      reason: d.reason.trim(),
      enabled: d.enabled ? 1 : 0,
      sort_order: sortOrder,
      ...(org ? { org: String(org) } : {}),
    },
    error: null,
  };
}

/** A rule saved whole with only its switch changed. */
export const toggledRuleBody = (r: Rule, org: number | null) => ({
  name: r.name,
  factor: r.factor,
  operator: r.operator,
  value: r.value,
  points: r.points,
  reason: r.reason,
  enabled: r.enabled ? 0 : 1,
  sort_order: r.sort_order,
  ...(org ? { org: String(org) } : {}),
});

export const saveRule = (body: Record<string, string | number>, id: number | null) => (id ? apiPut(`/api/tender/rules/${id}`, body) : apiPost<{ id: number }>('/api/tender/rules', body));
export const deleteRule = (id: number, org: string) => apiDelete(`/api/tender/rules/${id}${org ? `?org=${encodeURIComponent(org)}` : ''}`);
export const rescoreOpen = (org: string) => apiPost<{ rescored: number }>('/api/tender/rescore', org ? { org } : {});

// ── where tenders come from ─────────────────────────────────────────────

export interface Sources {
  drivers: Array<{ key: string; label: string; usable: { ok: boolean; why: string } }>;
  sources: Array<{ id: number; org_id: number | null; name: string; driver: string; enabled: boolean; last_run_at: string | null; last_status: string | null; usable: { ok: boolean; why: string } }>;
}

export async function fetchSources(org: string, signal?: AbortSignal): Promise<Sources> {
  const d = await apiGet<{ drivers?: Sources['drivers']; sources?: Array<Record<string, unknown>> }>('/api/tender/sources', org ? { org } : undefined, signal);
  return {
    drivers: d.drivers ?? [],
    sources: (d.sources ?? []).map((s) => ({
      id: int(s.id) ?? 0,
      org_id: int(s.org_id),
      name: String(s.name ?? ''),
      driver: String(s.driver ?? 'manual'),
      enabled: s.enabled === true || String(s.enabled) === '1',
      last_run_at: str(s.last_run_at),
      last_status: str(s.last_status),
      usable: (s.usable as Sources['sources'][number]['usable']) ?? { ok: false, why: '' },
    })),
  };
}

export interface Run {
  id: number;
  started_at: string | null;
  finished_at: string | null;
  ok: boolean;
  seen: number;
  imported: number;
  duplicates: number;
  rejected: number;
  message: string | null;
}

export const fetchRuns = (id: number, signal?: AbortSignal) =>
  apiGet<{ runs: Array<Record<string, unknown>> }>(`/api/tender/sources/${id}/runs`, undefined, signal).then((d) =>
    (d.runs ?? []).map((r): Run => ({
      id: int(r.id) ?? 0,
      started_at: str(r.started_at),
      finished_at: str(r.finished_at),
      ok: r.ok === true || String(r.ok) === '1',
      seen: int(r.seen) ?? 0,
      imported: int(r.imported) ?? 0,
      duplicates: int(r.duplicates) ?? 0,
      rejected: int(r.rejected) ?? 0,
      message: str(r.message),
    })),
  );

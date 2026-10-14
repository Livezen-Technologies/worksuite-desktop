import { ApiError } from '../../core/api';

/**
 * The CRM screens' small rules that are not drawing: where a record opens,
 * what a list's paging and tallies are (the server's `meta`, or the older
 * top-level fields), what a search answered, how a bulk action went, and the
 * checks the pipeline editor shows before the server is asked. Nothing here
 * works out business figures: totals, scores and probabilities are the
 * server's.
 */

export type RecordType = 'lead' | 'deal' | 'account' | 'contact' | 'quote';

/** A record somebody can open: a search hit, a follow-up's subject. */
export interface RecordRef {
  type: string;
  id: number;
  label?: string | null;
  /** A contact opens the account it belongs to. */
  account_id?: number | null;
}

/** The desktop route a CRM record opens at — the same addresses deep links and notifications use. */
export function crmRoute(r: RecordRef): string {
  switch (r.type) {
    case 'lead':
      return `/crm/leads/${r.id}`;
    case 'deal':
      return `/crm?tab=pipe&deal=${r.id}`;
    case 'account':
      return `/crm?tab=acc&account=${r.id}`;
    case 'quote':
      return `/crm?tab=quotes&quote=${r.id}`;
    case 'contact':
      return r.account_id ? `/crm?tab=acc&account=${r.account_id}` : `/crm?tab=acc${r.label ? `&q=${encodeURIComponent(r.label)}` : ''}`;
    default:
      return '/crm';
  }
}

/** The company scope as a list asks for it: `org_id` (and `org`, which servers before it read); nothing for all. */
export function scopeParams(orgId: number | null): { org_id?: number; org?: number } {
  return orgId ? { org_id: orgId, org: orgId } : {};
}

/** An endpoint this server does not have yet (an older WorkSuite), as opposed to a refusal or a record not found. */
export function isMissing(e: unknown): boolean {
  if (!(e instanceof ApiError)) return false;
  return e.code === 'not_supported' || e.status === 404 || e.status === 405 || e.status === 501;
}

// ── paging ──────────────────────────────────────────────────────────────

export interface PageMeta {
  total: number;
  page: number;
  per_page?: number;
  has_more: boolean;
  /** The StatusBar tallies: leads {new, no_followup, unassigned}, follow-ups {overdue, today, upcoming}, quotes per status, accounts per type. */
  counts?: Record<string, number>;
}

interface Paged {
  meta?: Partial<PageMeta> | null;
  total?: number | string;
  page?: number | string;
  has_more?: boolean;
  views?: Record<string, number> | null;
  counts?: Record<string, number> | null;
}

const n = (v: unknown, d = 0) => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? d : Number(v));

/** One page's paging, from `meta` when the server sends it, else the fields it sent before. */
export function pageOf(resp: Paged | null | undefined, rows = 0): PageMeta {
  const m = resp?.meta ?? {};
  const total = n(m.total ?? resp?.total, rows);
  const page = n(m.page ?? resp?.page, 1);
  const per = m.per_page !== undefined ? n(m.per_page) : undefined;
  const has_more = typeof m.has_more === 'boolean' ? m.has_more : typeof resp?.has_more === 'boolean' ? resp.has_more : per ? page * per < total : false;
  const raw = m.counts ?? resp?.counts ?? resp?.views ?? undefined;
  const counts = raw ? Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, n(v)])) : undefined;
  return { total, page, ...(per !== undefined ? { per_page: per } : {}), has_more, ...(counts ? { counts } : {}) };
}

/** "300 leads · 60 new · 41 with no follow-up · 12 unassigned" — a list's StatusBar, from the tallies the server gave. */
export function statusLine(noun: [string, string], meta: PageMeta | null, parts: Array<[string, string]> = []): string {
  if (!meta) return '';
  const out = [`${meta.total} ${meta.total === 1 ? noun[0] : noun[1]}`];
  for (const [key, label] of parts) {
    const v = meta.counts?.[key];
    if (v) out.push(`${v} ${label}`);
  }
  return out.join(' · ');
}

// ── search ──────────────────────────────────────────────────────────────

export interface Hit extends RecordRef {
  title: string;
  sub: string | null;
}

export interface HitGroup {
  type: RecordType | string;
  label: string;
  hits: Hit[];
}

const GROUPS: Array<[RecordType, string, string]> = [
  ['lead', 'leads', 'Leads'],
  ['deal', 'deals', 'Deals'],
  ['account', 'accounts', 'Accounts'],
  ['contact', 'contacts', 'Contacts'],
  ['quote', 'quotes', 'Quotes'],
];

type RawHit = { id: number | string; type?: string; label?: string; title?: string; sub?: string | null; subtitle?: string | null; meta?: string | null; account_id?: number | string | null };

function hitOf(x: RawHit, type: string): Hit {
  return {
    type: x.type ?? type,
    id: Number(x.id),
    title: String(x.label ?? x.title ?? ''),
    sub: [x.sub ?? x.subtitle, x.meta].filter(Boolean).join(' · ') || null,
    label: String(x.label ?? x.title ?? ''),
    account_id: x.account_id ? Number(x.account_id) : null,
  };
}

/**
 * What "Search the CRM" answered, grouped: the grouped answer
 * (`{leads, accounts, contacts, deals, quotes}`), or the older flat
 * `{results: [...]}` grouped here by type.
 */
export function normaliseSearch(data: unknown): HitGroup[] {
  if (!data || typeof data !== 'object') return [];
  const d = data as Record<string, unknown>;
  const flat = Array.isArray(d.results) ? (d.results as RawHit[]).map((x) => hitOf(x, String(x.type ?? ''))) : null;
  const out: HitGroup[] = [];
  for (const [type, key, label] of GROUPS) {
    const hits = flat ? flat.filter((h) => h.type === type) : Array.isArray(d[key]) ? (d[key] as RawHit[]).map((x) => hitOf(x, type)) : [];
    if (hits.length) out.push({ type, label, hits });
  }
  if (flat) {
    const other = flat.filter((h) => !GROUPS.some(([t]) => t === h.type));
    if (other.length) out.push({ type: 'other', label: 'Other', hits: other });
  }
  return out;
}

// ── bulk ────────────────────────────────────────────────────────────────

export interface BulkAnswer {
  results: Array<{ id: number; ok: boolean; code?: string; message?: string }>;
  done: number;
  refused: number;
}

/** "3 leads done · 1 refused — Converted leads cannot be reassigned." */
export function bulkSummary(r: BulkAnswer, noun: [string, string] = ['lead', 'leads']): { tone: 'success' | 'warning' | 'error'; text: string } {
  const done = r.done ?? r.results.filter((x) => x.ok).length;
  const refused = r.refused ?? r.results.filter((x) => !x.ok).length;
  const why = r.results.find((x) => !x.ok && x.message)?.message;
  const head = `${done} ${done === 1 ? noun[0] : noun[1]} done`;
  if (!refused) return { tone: 'success', text: `${head}.` };
  return { tone: done ? 'warning' : 'error', text: `${head} · ${refused} refused${why ? ` — ${why}` : '.'}` };
}

// ── follow-ups ──────────────────────────────────────────────────────────

/** "12 min late", "2 h 10 m late", "3 days late"; null when it is not late. */
export function lateLabel(minutes: number | null | undefined): string | null {
  if (!minutes || minutes <= 0) return null;
  if (minutes < 60) return `${minutes} min late`;
  if (minutes < 1440) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m ? `${h} h ${m} m late` : `${h} h late`;
  }
  const d = Math.floor(minutes / 1440);
  return `${d} ${d === 1 ? 'day' : 'days'} late`;
}

/** What a follow-up is about: the server's `subject`, or (servers before it) its lead. */
export function subjectOf(f: { subject?: unknown; lead_id: number | null; lead: string | null; company?: string | null }): RecordRef | null {
  const s = f.subject;
  if (s && typeof s === 'object' && 'type' in s && 'id' in s) {
    const o = s as { type: string; id: number | string; label?: string | null };
    return { type: o.type, id: Number(o.id), label: o.label ?? null };
  }
  return f.lead_id ? { type: 'lead', id: f.lead_id, label: f.lead } : null;
}

/** What a follow-up is for: `subject` when it is text (servers before subjects), else `title`. */
export function whatFor(f: { subject?: unknown; title?: string | null }): string | null {
  return typeof f.subject === 'string' ? f.subject || null : (f.title ?? null);
}

// ── board ───────────────────────────────────────────────────────────────

/** The board's StatusBar: the server's `meta` when it sends one, else the open columns' own totals. */
export function boardTotals(board: { meta?: { deals?: number; open_value?: number; weighted?: number } | null; columns: Array<{ kind: string; count: number; total: number; weighted: number }> } | null | undefined) {
  const cols = board?.columns ?? [];
  const open = cols.filter((c) => c.kind === 'open');
  const m = board?.meta;
  return {
    deals: m?.deals ?? cols.reduce((a, c) => a + n(c.count), 0),
    open: m?.open_value ?? open.reduce((a, c) => a + n(c.total), 0),
    weighted: m?.weighted ?? open.reduce((a, c) => a + n(c.weighted), 0),
  };
}

// ── pipelines editor ────────────────────────────────────────────────────

export interface StageDraft {
  id?: number;
  name: string;
  kind: 'open' | 'won' | 'lost';
  probability: number;
  colour?: string;
}

/** What the server would refuse, said before asking it: a pipeline keeps one won and one lost stage. */
export function stageProblems(stages: StageDraft[]): string[] {
  const out: string[] = [];
  if (!stages.some((s) => s.kind === 'won')) out.push('A pipeline needs a Won stage.');
  if (!stages.some((s) => s.kind === 'lost')) out.push('A pipeline needs a Lost stage.');
  if (stages.some((s) => !s.name.trim())) out.push('Every stage needs a name.');
  if (stages.some((s) => !Number.isFinite(s.probability) || s.probability < 0 || s.probability > 100)) out.push('Probability is between 0 and 100.');
  return out;
}

/** The list with item `i` moved one place up (-1) or down (+1); unchanged at either end. */
export function moveItem<T>(list: readonly T[], i: number, dir: -1 | 1): T[] {
  const j = i + dir;
  if (i < 0 || i >= list.length || j < 0 || j >= list.length) return [...list];
  const out = [...list];
  [out[i], out[j]] = [out[j]!, out[i]!];
  return out;
}

// ── CSV ─────────────────────────────────────────────────────────────────

/** Rows as a CSV, quoting what needs it; a cell starting = + - @ is prefixed so a spreadsheet does not run it. */
export function toCsv(rows: Array<Array<string | number | null | undefined>>): string {
  const cell = (v: string | number | null | undefined) => {
    let s = v === null || v === undefined ? '' : String(v);
    if (typeof v === 'string' && /^[=+\-@]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map((r) => r.map(cell).join(',')).join('\n');
}

/** "leads-2026-10-14.csv" — a name the save dialog accepts. */
export function csvName(what: string, day: string): string {
  return `${what.replace(/[^A-Za-z0-9 ._-]/g, '').slice(0, 60)}-${day}.csv`;
}

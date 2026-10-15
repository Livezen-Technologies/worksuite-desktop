import { app } from '../../core/app-state';
import { useStore } from '../../core/store';
import { ApiError } from '../../core/api';
import { pageOf, type PageMeta } from './logic';

/**
 * Proposals and estimates (CRM SRS v1.3 §17) as the desktop reads them: the
 * shapes the server's contract gives, and the small rules the screens and the
 * "customer is reading" alert follow — what a record offers, how a list's
 * answer is read, durations as the designs write them, and which viewing
 * sessions have already been announced. Figures are the server's; nothing
 * here works one out.
 */

export interface Can {
  edit?: boolean;
  send?: boolean;
  approve?: boolean;
  withdraw?: boolean;
  accept?: boolean;
  delete?: boolean;
  convert?: boolean;
}

export interface Approval {
  required: boolean;
  status: 'none' | 'pending' | 'approved' | 'sent_back';
  rules: Array<{ id: number; label: string }>;
  note: string | null;
  decided_by: { id: number; name: string } | string | null;
}

export interface Engagement {
  opens: number;
  last_opened_at: string | null;
  viewing_now: boolean;
  time_seconds: number;
  questions_open: number;
}

export type ProposalStatus = 'draft' | 'pending_approval' | 'approved' | 'sent' | 'viewed' | 'accepted' | 'declined' | 'expired' | 'withdrawn';

export interface Proposal {
  id: number;
  number: string;
  org_id: number | null;
  title: string;
  status: ProposalStatus;
  deal: { id: number; name: string; stage?: string | null } | null;
  account: { id: number; name: string } | null;
  contact: { id: number; name: string; email: string | null } | null;
  template_id: number | null;
  owner: { id: number; name: string } | null;
  currency: string;
  total: number | null;
  valid_until: string | null;
  current_version: number | null;
  sent_version: number | null;
  sent_at: string | null;
  accepted_at: string | null;
  engagement: Engagement | null;
  approval: Approval | null;
  estimate_id: number | null;
  quote_id: number | null;
  can: Can | null;
}

export interface Section {
  id: number;
  kind: string;
  title: string | null;
  body: unknown;
  locked?: boolean;
  hidden?: boolean;
  sort?: number;
  ai_drafted?: boolean;
}

export interface ProposalDetail extends Proposal {
  sections?: Section[];
  versions?: Array<{ version: number; sent_at: string | null; sent_by: string | { name: string } | null; approved_by: string | { name: string } | null; pdf_url: string | null }>;
  share_url?: string | null;
}

export interface ProposalEvents {
  events: Array<{ id: number; kind: string; version: number | null; viewer: string | null; meta: unknown; at: string }>;
  sections_time: Array<{ section_id: number; title: string; seconds: number }>;
  viewers: Array<{ viewer: string; device: string | null; location: string | null; opens: number; last_at: string | null }>;
  questions: Array<{ id: number; body: string; viewer: string | null; at: string; replies: Array<{ id: number; body: string; by: string | null; at: string }> }>;
}

export type EstimateStatus = 'draft' | 'pending_approval' | 'sent' | 'approved' | 'declined' | 'expired' | 'converted';

export interface Estimate {
  id: number;
  number: string;
  org_id: number | null;
  title: string;
  mode: 'items' | 'range' | 'packages';
  status: EstimateStatus;
  subject: { type: 'lead' | 'deal' | 'account'; id: number; label: string | null } | null;
  currency: string;
  range_from: number | null;
  range_to: number | null;
  confidence_pct: number | null;
  mid: number | null;
  assumptions: string | null;
  valid_until: string | null;
  owner: { id: number; name: string } | null;
  total: number | null;
  cost?: number | null;
  margin?: number | null;
  margin_pct?: number | null;
  converted: { type: 'quote' | 'proposal'; id: number; number: string } | null;
  revision: number | null;
  approval: Approval | null;
  can: Can | null;
  created_at?: string | null;
}

export interface EstimateDetail extends Estimate {
  lines?: Array<{ id: number; package: string | null; description: string; qty: number; unit_price: number; unit_cost?: number | null; discount_pct: number; tax_rate: number; optional: boolean; line_total: number; margin?: number | null }>;
  packages?: Array<{ key: string; name: string; default: boolean; total: number; margin?: number | null }>;
  photos?: Array<{ id: number; url: string; name: string }>;
  share_url?: string | null;
}

/** One row of the approver's queue (`GET approvals?status=pending`). */
export interface PendingApproval {
  id: number;
  doc: 'estimate' | 'proposal';
  doc_id: number;
  number: string;
  title: string;
  value: number | null;
  currency?: string | null;
  rule: { id?: number; label?: string } | string | null;
  requested_by: { id: number; name: string } | string | null;
  requested_at: string | null;
}

/** Somebody reading a proposal right now (`GET proposals/live`). */
export interface LiveViewing {
  proposal_id: number;
  number: string;
  title: string | null;
  account: string | { name: string } | null;
  viewer: string | null;
  section: string | null;
  since: string | null;
}

// ── statuses ────────────────────────────────────────────────────────────

export const PROPOSAL_STATUSES: Array<[ProposalStatus, string]> = [
  ['draft', 'Draft'],
  ['pending_approval', 'Awaiting approval'],
  ['approved', 'Approved'],
  ['sent', 'Sent'],
  ['viewed', 'Viewed'],
  ['accepted', 'Accepted'],
  ['declined', 'Declined'],
  ['expired', 'Expired'],
  ['withdrawn', 'Withdrawn'],
];

export const ESTIMATE_STATUSES: Array<[EstimateStatus, string]> = [
  ['draft', 'Draft'],
  ['pending_approval', 'Awaiting approval'],
  ['sent', 'Sent'],
  ['approved', 'Approved'],
  ['declined', 'Declined'],
  ['expired', 'Expired'],
  ['converted', 'Converted'],
];

const LABELS: Record<string, string> = Object.fromEntries([...PROPOSAL_STATUSES, ...ESTIMATE_STATUSES]);

export function statusLabel(s: string): string {
  return LABELS[s] ?? s.replace(/_/g, ' ');
}

// ── reading answers ─────────────────────────────────────────────────────

/** A list's rows: the bare array, or under its own key, `items` or `data`. */
export function rowsOf<T>(data: unknown, key: string): T[] {
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === 'object') {
    const d = data as Record<string, unknown>;
    for (const k of [key, 'items', 'data']) if (Array.isArray(d[k])) return d[k] as T[];
  }
  return [];
}

/** A list's paging and tallies: `meta` inside `data`, or beside it in the envelope. */
export function listMeta(data: unknown, envelopeMeta: unknown, rows: number): PageMeta & { kpi?: Record<string, number | null> } {
  const inner = data && typeof data === 'object' && !Array.isArray(data) ? ((data as { meta?: unknown }).meta as Record<string, unknown> | undefined) : undefined;
  const meta = (inner ?? envelopeMeta ?? null) as (Partial<PageMeta> & { kpi?: Record<string, number | null> }) | null;
  return { ...pageOf({ meta }, rows), ...(meta?.kpi ? { kpi: meta.kpi } : {}) };
}

/** One record: `{proposal: {...}}` or the record itself. */
export function recordOf<T>(data: unknown, key: string): T | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  const inner = d[key];
  return (inner && typeof inner === 'object' ? inner : d) as T;
}

export function nameOf(v: string | { name?: string | null } | null | undefined): string | null {
  if (!v) return null;
  return typeof v === 'string' ? v : (v.name ?? null);
}

// ── what a record offers ────────────────────────────────────────────────

/**
 * What a proposal's preview offers. The server's `can` decides; the status
 * only narrows it (a reminder for one that is out, approval while waiting
 * for it). Nothing here works without WorkSuite, so offline everything that
 * writes is off — opening it on the web too.
 */
export function proposalActions(p: Pick<Proposal, 'status' | 'can' | 'approval'> | null, opts: { online: boolean; manage: boolean }) {
  const s = p?.status;
  const can = p?.can ?? {};
  const live = opts.online && !!p;
  const out = s === 'sent' || s === 'viewed';
  return {
    remind: live && out && can.send !== false,
    withdraw: live && !!can.withdraw && s !== 'withdrawn' && s !== 'accepted' && s !== 'declined',
    duplicate: live && opts.manage,
    approve: live && s === 'pending_approval' && !!can.approve,
    sendBack: live && s === 'pending_approval' && !!can.approve,
    web: opts.online && !!p,
    edit: !!can.edit,
  };
}

export function estimateActions(e: Pick<Estimate, 'status' | 'can' | 'converted'> | null, opts: { online: boolean }) {
  const s = e?.status;
  const can = e?.can ?? {};
  const live = opts.online && !!e;
  return {
    send: live && !!can.send && (s === 'draft' || s === 'pending_approval' || s === 'sent'),
    convert: live && !!can.convert && !e?.converted && s !== 'declined' && s !== 'expired',
    approve: live && s === 'pending_approval' && !!can.approve,
    web: opts.online && !!e,
    edit: !!can.edit,
  };
}

/** The web's address for one, which is what "Open in web" opens (the web's `/crm?view=…` grammar). */
export const proposalWebPath = (id: number) => `/crm?view=proposals&proposal=${id}`;
export const estimateWebPath = (id: number) => `/crm?view=estimates&estimate=${id}`;

/** Where the desktop opens one. */
export const proposalRoute = (id: number) => `/crm?tab=proposals&proposal=${id}`;
export const estimateRoute = (id: number) => `/crm?tab=estimates&estimate=${id}`;

/** Whether WorkSuite can be reached; every proposal and estimate action needs it. */
export function useOnline(): boolean {
  return useStore(app, (s) => s.status?.network !== 'OFFLINE');
}

export const OFFLINE_HINT = 'Needs a connection to WorkSuite.';

// ── display ─────────────────────────────────────────────────────────────

/** "12m 30s", "6m 12s", "50s", "1h 04m" — time spent reading, as the designs write it. */
export function readingTime(seconds: number | null | undefined): string {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m) return `${m}m ${String(r).padStart(2, '0')}s`;
  return `${r}s`;
}

/** A pricing section's packages and optional lines, as the server stored them; totals only where it gave them. */
export function pricingOf(body: unknown): { packages: Array<{ key: string; name: string; total: number | null; default: boolean }>; lines: number; optional: number } {
  const b = (body && typeof body === 'object' ? body : {}) as { packages?: unknown; lines?: unknown; optional?: unknown };
  const packages = Array.isArray(b.packages)
    ? (b.packages as Array<Record<string, unknown>>).map((p, i) => ({ key: String(p.key ?? i), name: String(p.name ?? p.key ?? `Package ${i + 1}`), total: p.total === undefined || p.total === null ? null : Number(p.total), default: !!p.default }))
    : [];
  return { packages, lines: Array.isArray(b.lines) ? b.lines.length : 0, optional: Array.isArray(b.optional) ? b.optional.length : 0 };
}

/** A text section's words: `{html}` as the server stores it, or a plain string. */
export function sectionHtml(body: unknown): string {
  if (typeof body === 'string') return body;
  if (body && typeof body === 'object' && typeof (body as { html?: unknown }).html === 'string') return (body as { html: string }).html;
  return '';
}

// ── the "customer is reading" alert ─────────────────────────────────────

/** "Asanka Dias is reading PRP-0021 — Pricing". */
export function liveText(v: LiveViewing): string {
  const who = v.viewer?.trim() || nameOf(v.account) || 'Your customer';
  return `${who} is reading ${v.number}${v.section ? ` — ${v.section}` : ''}`;
}

/**
 * Which viewing sessions are new. A session is the proposal and the moment
 * its viewer arrived (`since`); each is announced once, however many polls
 * see it. A session is forgotten once it has been out of the answer for
 * `forgetMs`, so the same proposal opened again later is a new session —
 * while a heartbeat missed between two polls is not.
 */
export class LiveWatcher {
  private seen = new Map<string, number>();
  constructor(private readonly forgetMs = 5 * 60_000) {}

  static keyOf(v: Pick<LiveViewing, 'proposal_id' | 'since'>): string {
    return `${v.proposal_id}:${v.since ?? ''}`;
  }

  /** The viewings to announce now; remembers them all. */
  update(viewing: LiveViewing[], now = Date.now()): LiveViewing[] {
    const fresh: LiveViewing[] = [];
    const here = new Set<string>();
    for (const v of viewing) {
      const key = LiveWatcher.keyOf(v);
      if (here.has(key)) continue;
      here.add(key);
      if (!this.seen.has(key)) fresh.push(v);
      this.seen.set(key, now);
    }
    for (const [key, at] of this.seen) if (!here.has(key) && now - at > this.forgetMs) this.seen.delete(key);
    return fresh;
  }

  reset(): void {
    this.seen.clear();
  }
}

export const LIVE_POLL_MS = 30_000;

/**
 * How long until the next `proposals/live` poll: every 30 s while the window
 * is seen, every 2 minutes while it is hidden, not at all offline (the poll
 * resumes when the connection is back), and doubling after each failure up
 * to 10 minutes. A server without the endpoint is asked again after an hour.
 */
export function nextLiveDelay(s: { visible: boolean; online: boolean; failures: number; missing?: boolean }): number | null {
  if (!s.online) return null;
  if (s.missing) return 60 * 60_000;
  const base = s.visible ? LIVE_POLL_MS : 4 * LIVE_POLL_MS;
  return Math.min(10 * 60_000, base * 2 ** Math.min(5, Math.max(0, s.failures)));
}

/** An answer that says this server has no `proposals/live`, or that the person may not see proposals. */
export function liveUnavailable(e: unknown): boolean {
  return e instanceof ApiError && (e.status === 403 || e.status === 404 || e.status === 405 || e.status === 501 || e.code === 'not_supported');
}

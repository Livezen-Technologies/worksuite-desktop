import { apiDelete, apiGet, apiPost, apiPut, request } from '../../core/api';
import { addDays, dayKey, dayWords, monthWords, parseTs } from '../../core/time';

/**
 * Sales & Orders part 2: the activity feed, reports, coupons, approval rules,
 * settings (with the sales channels) and My access. Everything here is read
 * and written through `/api/oms/*`, as the web's Orders screens do; the
 * sentences that describe a rule, a coupon's state and a report's basis come
 * from the server so the two apps cannot describe one thing differently.
 */

const withOrg = (org: string, rest: Record<string, string | number | undefined> = {}) => ({ ...(org ? { org } : {}), ...rest });

export const KM = {
  activity: (org: string, f: object) => ['sales', 'activity', org, f] as const,
  report: (report: string, params: object) => ['sales', 'report', report, params] as const,
  coupons: (org: string) => ['sales', 'coupons', org] as const,
  rules: (org: string) => ['sales', 'rules', org] as const,
  settings: ['sales', 'module-settings'] as const,
  access: ['sales', 'access'] as const,
  moduleAccess: ['sales', 'module-access'] as const,
  channels: (org: string) => ['sales', 'channels', org] as const,
  channel: (id: number) => ['sales', 'channel', id] as const,
  channelLogs: (id: number) => ['sales', 'channel', id, 'logs'] as const,
  syncs: (id: number) => ['sales', 'channel', id, 'syncs'] as const,
};

// ── activity ────────────────────────────────────────────────────────────

export interface OmsEvent {
  id: number;
  order_id?: number;
  number?: string | null;
  client?: string | null;
  type: string;
  source: string | null;
  user: string | null;
  description: string | null;
  reference?: string | null;
  at: string | null;
}

export interface Feed {
  rows: OmsEvent[];
  total: number;
  page: number;
  pages: number;
  types: Array<{ value: string; count: number }>;
  actors: Array<{ id: string; name: string; count: number }>;
}

export const fetchActivity = (org: string, f: { type: string; actor: string; q: string; page: number }, signal?: AbortSignal) =>
  apiGet<Feed>('/api/oms/activity', withOrg(org, { type: f.type || undefined, actor: f.actor || undefined, q: f.q.trim() || undefined, page: f.page }), signal);

/** How an event is named, as the web names it; a type nobody listed yet shows as its own words. */
const EVENTS: Record<string, string> = {
  created: 'Created',
  submitted: 'Submitted',
  approval_step: 'Approval step',
  approved: 'Approved',
  rejected: 'Rejected',
  assigned: 'Assigned',
  unassigned: 'Unassigned',
  status: 'Status changed',
  priority: 'Priority',
  deleted: 'Deleted',
  copied: 'Copied',
  printed: 'Printed',
  pdf: 'PDF downloaded',
  emailed: 'Emailed',
  whatsapp: 'Sent on WhatsApp',
  chat_shared: 'Shared in chat',
};

export function eventName(type: string): string {
  return EVENTS[type] ?? type.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

/** The chip colour for an event: approvals amber, decisions green or red, the rest plain. */
export function eventTone(type: string): string {
  if (type === 'approved') return 'bg-[#E4F4EA] text-[#145C39] dark:bg-success-bg dark:text-success';
  if (type === 'rejected' || type === 'deleted') return 'bg-[#FCE9E4] text-[#8C2A14] dark:bg-danger-bg dark:text-danger';
  if (type === 'approval_step' || type === 'submitted') return 'bg-[#FFF4E0] text-[#9A4A06] dark:bg-warning-bg dark:text-warning';
  if (type === 'status' || type === 'assigned') return 'bg-[#EEF1FC] text-[#23349E] dark:bg-selection dark:text-primary';
  return 'bg-subtle text-ink-2';
}

/**
 * The feed grouped by the day each event happened on the reader's clock —
 * the stamps are true UTC, so an evening event in Colombo belongs to that
 * evening, not the next day. Keyed (never run-length), so a day cannot
 * appear twice when the rows are not perfectly in order; newest day first.
 */
export function byDay(rows: OmsEvent[], today: string): Array<{ key: string; label: string; rows: OmsEvent[] }> {
  const days = new Map<string, OmsEvent[]>();
  for (const r of rows) {
    const d = r.at ? parseTs(r.at) : null;
    const key = d && !Number.isNaN(d.getTime()) ? dayKey(d) : 'undated';
    days.set(key, [...(days.get(key) ?? []), r]);
  }
  return [...days.entries()]
    .sort(([a], [b]) => (a === 'undated' ? 1 : b === 'undated' ? -1 : b.localeCompare(a)))
    .map(([key, list]) => ({
      key,
      label: key === 'undated' ? 'Undated' : key === today ? 'Today' : key === addDays(today, -1) ? 'Yesterday' : dayWords(key, { weekday: true, long: true, year: true }),
      rows: list,
    }));
}

// ── reports ─────────────────────────────────────────────────────────────

export type ReportKind = 'summary' | 'sales' | 'status' | 'payment' | 'aging' | 'returns' | 'coupons';

export const REPORTS: Array<{ id: ReportKind; label: string }> = [
  { id: 'summary', label: 'Summary' },
  { id: 'sales', label: 'Sales performance' },
  { id: 'status', label: 'Order status' },
  { id: 'payment', label: 'Payment' },
  { id: 'aging', label: 'Order ageing' },
  { id: 'returns', label: 'Returns' },
  { id: 'coupons', label: 'Coupon usage' },
];

/** Team and branch are left out: nothing records them, so they would read as "no orders". */
export const GROUPS: Array<{ id: string; label: string }> = [
  { id: 'month', label: 'By month' },
  { id: 'day', label: 'By day' },
  { id: 'client', label: 'By customer' },
  { id: 'user', label: 'By salesperson' },
  { id: 'assignee', label: 'By assignee' },
  { id: 'org', label: 'By organisation' },
  { id: 'source', label: 'By source' },
  { id: 'product', label: 'By product' },
  { id: 'category', label: 'By category' },
  { id: 'status', label: 'By status' },
  { id: 'type', label: 'By order type' },
  { id: 'priority', label: 'By priority' },
];

/** A sales row's period in words: "2026-09" is "September 2026", "2026-09-14" is "14 Sep 2026"; any other name as given. */
export function periodLabel(label: string, group: string): string {
  if (group === 'month' && /^\d{4}-\d{2}$/.test(label)) return monthWords(label);
  if (group === 'day' && /^\d{4}-\d{2}-\d{2}$/.test(label)) return dayWords(label, { year: true });
  return label;
}

export type RangePreset = 'today' | 'yesterday' | 'this_week' | 'last_week' | 'this_month' | 'last_month' | 'this_quarter' | 'this_year' | 'last_year' | 'last_30' | 'custom';

export const RANGES: Array<{ id: RangePreset; label: string }> = [
  { id: 'this_month', label: 'This month' },
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: 'this_week', label: 'This week' },
  { id: 'last_week', label: 'Last week' },
  { id: 'last_month', label: 'Last month' },
  { id: 'this_quarter', label: 'This quarter' },
  { id: 'this_year', label: 'This year' },
  { id: 'last_year', label: 'Last year' },
  { id: 'last_30', label: 'Last 30 days' },
  { id: 'custom', label: 'Custom range' },
];

const ymd = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const lastOf = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/**
 * A preset as the two dates it covers, counted from `today` (a date on the
 * WorkSuite clock). Weeks start on Monday. "Custom" has no dates of its own.
 */
export function rangeOf(preset: RangePreset, today: string): { from: string; to: string } | null {
  const [y, m] = [Number(today.slice(0, 4)), Number(today.slice(5, 7))];
  const weekday = (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7; // Monday 0
  switch (preset) {
    case 'today':
      return { from: today, to: today };
    case 'yesterday':
      return { from: addDays(today, -1), to: addDays(today, -1) };
    case 'this_week':
      return { from: addDays(today, -weekday), to: addDays(today, 6 - weekday) };
    case 'last_week':
      return { from: addDays(today, -weekday - 7), to: addDays(today, -weekday - 1) };
    case 'this_month':
      return { from: ymd(y, m, 1), to: ymd(y, m, lastOf(y, m)) };
    case 'last_month': {
      const [py, pm] = m === 1 ? [y - 1, 12] : [y, m - 1];
      return { from: ymd(py, pm, 1), to: ymd(py, pm, lastOf(py, pm)) };
    }
    case 'this_quarter': {
      const q = Math.floor((m - 1) / 3) * 3 + 1;
      return { from: ymd(y, q, 1), to: ymd(y, q + 2, lastOf(y, q + 2)) };
    }
    case 'this_year':
      return { from: ymd(y, 1, 1), to: ymd(y, 12, 31) };
    case 'last_year':
      return { from: ymd(y - 1, 1, 1), to: ymd(y - 1, 12, 31) };
    case 'last_30':
      return { from: addDays(today, -29), to: today };
    default:
      return null;
  }
}

export interface ReportParams {
  report: ReportKind;
  from: string;
  to: string;
  org: string;
  group?: string;
}

/* The reports' answers are wide and differ per report; each screen reads the fields it draws. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ReportData = Record<string, any> & { from: string; to: string; basis?: string };

export const fetchReport = (p: ReportParams, signal?: AbortSignal) =>
  apiGet<ReportData>(`/api/oms/reports/${p.report}`, withOrg(p.org, { from: p.from, to: p.to, group: p.report === 'sales' ? p.group : undefined }), signal);

// ── coupons ─────────────────────────────────────────────────────────────

export interface Coupon {
  id: number;
  org_id: number;
  code: string;
  name: string;
  description: string | null;
  kind: 'percent' | 'amount';
  value: number;
  min_order_value: number | null;
  max_discount: number | null;
  starts_at: string | null;
  ends_at: string | null;
  usage_limit: number;
  per_customer_limit: number;
  redeemed_count: number;
  status: 'active' | 'inactive';
  /** Worked out by the server: ticked Active with its end date gone is not live. */
  state: 'live' | 'scheduled' | 'expired' | 'inactive';
}

export const fetchCoupons = (org: string, signal?: AbortSignal) => apiGet<{ rows: Coupon[] }>('/api/oms/coupons', withOrg(org), signal).then((r) => r.rows ?? []);
export const saveCoupon = (org: string, c: Partial<Coupon>) => (c.id ? apiPut(`/api/oms/coupons/${c.id}`, c) : apiPost('/api/oms/coupons', c, withOrg(org)));
export const removeCoupon = (id: number) => apiDelete(`/api/oms/coupons/${id}`);

const num = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });

/** "20% · max 50,000", "LKR 5,000" — what the coupon takes off. */
export function couponWorth(c: Pick<Coupon, 'kind' | 'value' | 'max_discount'>, currency?: string | null): string {
  const worth = c.kind === 'percent' ? `${num(Number(c.value))}%` : `${currency ? `${currency} ` : ''}${num(Number(c.value))}`;
  return c.max_discount !== null && c.max_discount !== undefined && Number(c.max_discount) > 0 ? `${worth} · max ${num(Number(c.max_discount))}` : worth;
}

/** "1 Sep → 30 Sep", "1 Jan → no end". */
export function couponRuns(c: Pick<Coupon, 'starts_at' | 'ends_at'>): string {
  const year = String(new Date().getFullYear());
  const day = (s: string | null) => (s ? dayWords(s.slice(0, 10), { year: s.slice(0, 4) !== year }) : null);
  return `${day(c.starts_at) ?? 'Now'} → ${day(c.ends_at) ?? 'no end'}`;
}

/** "38 / 100", "112 / ∞". */
export const couponUsed = (c: Pick<Coupon, 'redeemed_count' | 'usage_limit'>) => `${c.redeemed_count} / ${c.usage_limit > 0 ? c.usage_limit : '∞'}`;

export const COUPON_STATE: Record<Coupon['state'], { label: string; chip: string }> = {
  live: { label: 'Live', chip: 'bg-[#E4F4EA] text-[#145C39] dark:bg-success-bg dark:text-success' },
  scheduled: { label: 'Scheduled', chip: 'bg-[#EEF1FC] text-[#23349E] dark:bg-selection dark:text-primary' },
  expired: { label: 'Expired', chip: 'bg-[#FCE9E4] text-[#8C2A14] dark:bg-danger-bg dark:text-danger' },
  inactive: { label: 'Inactive', chip: 'bg-subtle text-ink-2' },
};

// ── approval rules ──────────────────────────────────────────────────────

export interface Rule {
  id: number;
  org_id: number | null;
  org_name: string | null;
  name: string;
  step: number;
  subject: string;
  operator: string;
  threshold: number;
  text_value: string | null;
  permission: string;
  is_active: boolean;
  /** The rule as a sentence, from the class that evaluates it. */
  reads: string;
}

export interface Rules {
  rules: Rule[];
  subjects: Record<string, { label: string; kind: 'money' | 'percent' | 'text' }>;
  operators: Record<string, string>;
}

export const fetchRules = (org: string, signal?: AbortSignal) => apiGet<Rules>('/api/oms/settings/rules', withOrg(org), signal);
export const saveRule = (r: Partial<Rule>) => (r.id ? apiPut(`/api/oms/settings/rules/${r.id}`, r) : apiPost('/api/oms/settings/rules', r));
export const removeRule = (id: number) => apiDelete(`/api/oms/settings/rules/${id}`);

/** The list's second line: the sentence, who approves, and which company. */
export const ruleLine = (r: Pick<Rule, 'reads' | 'permission' | 'org_name'>) => `${r.reads} → needs ${r.permission} · ${r.org_name ?? 'every company'}`;

// ── my access ───────────────────────────────────────────────────────────

export interface Access {
  companies: Array<{ id: number; name: string; currency: string | null; role: string | null }>;
  scoped: string[];
  unscoped: string[];
  unassigned: Record<string, number>;
  why: string;
  boundary_note: string;
}

export interface ModuleAccess {
  label: string;
  permissions: Array<{ slug: string; name: string; held: boolean }>;
  held: number;
  of: number;
  why: string;
}

export const fetchAccess = (signal?: AbortSignal) => apiGet<{ access: Access }>('/api/oms/access', undefined, signal).then((r) => r.access);
export const fetchModuleAccess = (signal?: AbortSignal) => apiGet<ModuleAccess>('/api/access/module/Oms', undefined, signal);

// ── sales channels ──────────────────────────────────────────────────────

export type ChannelStatus = 'connected' | 'not_connected' | 'pending' | 'syncing' | 'error' | 'disabled';

export interface Channel {
  id: number;
  kind: string;
  name: string;
  org_id: number;
  org: string | null;
  ref_id: number | null;
  ref_table: string | null;
  status: ChannelStatus;
  status_label: string;
  tone: string;
  detail: string;
  configured: boolean;
  stored_status: string;
  last_error: string | null;
  mappings: Record<string, string>;
  auto_sync: boolean;
  last_sync_at: string | null;
  last_sync_ok: boolean | null;
  imported: number;
  updated: number;
  failed: number;
  enabled: boolean;
  created_at: string | null;
}

export interface ChannelKind {
  kind: string;
  label: string;
  blurb: string;
  note: string;
  ref_table: string | null;
  needs_ref: boolean;
  /** Where a record of this kind is made; absent means Billing. */
  made_in?: string;
  channels: Channel[];
  count: number;
  status: ChannelStatus;
  available: Array<{ id: number; name: string; detail: string | null; org_id: number | null }>;
}

export type Abilities = Partial<Record<'view' | 'create' | 'edit' | 'delete' | 'connect' | 'disconnect' | 'sync' | 'view_logs' | 'manage_api', boolean>>;

export interface ChannelDetail {
  channel: Channel;
  webhook: string | null;
  auth_method: { method: string; prefix: string | null; issued: string | null; scope: string | null } | null;
  describe: { label: string; blurb: string; note: string };
  /** Whether "Sync now" fetches orders (a run to drive) or only checks the connection. */
  pull?: boolean;
  mappings: Array<{ key: string; label: string; help: string; options: Array<{ value: string; label: string }> }>;
  can?: Abilities;
}

export interface ChannelLog {
  id: number;
  at: string | null;
  action: string;
  status: string;
  imported: number;
  updated: number;
  failed: number;
  error: string | null;
  user: string | null;
}

export interface SyncRun {
  id: number;
  channel_id: number;
  status: 'running' | 'done' | 'failed' | 'cancelled';
  interrupted: boolean;
  window_from: string;
  page: number;
  pages: number | null;
  total: number | null;
  seen: number;
  created: number;
  duplicate: number;
  skipped: number;
  refused: number;
  customers_new: number;
  customers_matched: number;
  lines: number;
  problems: Array<{ ref: string; why: string }>;
  error: string | null;
  started_at: string | null;
  connected_at: string | null;
  finished_at: string | null;
  elapsed: number;
  eta: number | null;
}

export interface Syncs {
  supported: boolean;
  current: SyncRun | null;
  last: SyncRun | null;
  last_done_at: string | null;
}

export const fetchChannels = (org: string, signal?: AbortSignal) =>
  apiGet<{ catalogue: ChannelKind[]; orgs: Array<{ id: number; name: string }>; can: Abilities }>('/api/oms/channels', withOrg(org), signal);
export const fetchChannel = (id: number, org: string, signal?: AbortSignal) => apiGet<ChannelDetail>(`/api/oms/channels/${id}`, withOrg(org), signal);
export const fetchChannelLogs = (id: number, signal?: AbortSignal) => apiGet<{ rows: ChannelLog[]; total: number }>(`/api/oms/channels/${id}/logs`, undefined, signal);
export const addChannel = (body: { kind: string; name: string; ref_id: number | null; org_id: number }) => apiPost<{ id: number }>('/api/oms/channels', body);
export const updateChannel = (id: number, body: Record<string, unknown>) => apiPut(`/api/oms/channels/${id}`, body);
export const removeChannel = (id: number, org: string) => request('DELETE', `/api/oms/channels/${id}`, { query: withOrg(org) });
/** Test, or a plain sync; the server's sentence says what it found. */
export const channelAct = (id: number, what: 'test' | 'sync') => request<{ ok?: boolean }>('POST', `/api/oms/channels/${id}/${what}`, { body: {} });
export const fetchSyncs = (id: number, signal?: AbortSignal) => apiGet<Syncs>(`/api/oms/channels/${id}/syncs`, undefined, signal);
export const startSync = (id: number) => apiPost<{ run: SyncRun }>(`/api/oms/channels/${id}/syncs`, {}).then((r) => r.run);
export const stepSync = (id: number, run: number) => apiPost<{ run: SyncRun }>(`/api/oms/channels/${id}/syncs/${run}/step`, {}).then((r) => r.run);
export const cancelSync = (id: number, run: number) => apiPost<{ run: SyncRun }>(`/api/oms/channels/${id}/syncs/${run}/cancel`, {}).then((r) => r.run);

/** A card's dot and chip, from the status the driver reports now (not the stored one). */
export function channelTone(s: ChannelStatus | string): 'ok' | 'bad' | 'warn' | 'busy' | 'idle' {
  return s === 'connected' || s === 'ok' ? 'ok' : s === 'error' || s === 'bad' ? 'bad' : s === 'pending' || s === 'warn' ? 'warn' : s === 'syncing' || s === 'busy' ? 'busy' : 'idle';
}

export const TONE_CHIP: Record<ReturnType<typeof channelTone>, string> = {
  ok: 'bg-[#E4F4EA] text-[#145C39] dark:bg-success-bg dark:text-success',
  bad: 'bg-[#FCE9E4] text-[#8C2A14] dark:bg-danger-bg dark:text-danger',
  warn: 'bg-[#FFF4E0] text-[#9A4A06] dark:bg-warning-bg dark:text-warning',
  busy: 'bg-[#EEF1FC] text-[#23349E] dark:bg-selection dark:text-primary',
  idle: 'bg-subtle text-ink-2',
};

export const statusWords = (s: ChannelStatus) => (s === 'not_connected' ? 'Not connected' : s.charAt(0).toUpperCase() + s.slice(1));

/** 204 → "3 min 24 s"; under a minute, seconds alone. */
export function span(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
}

/** "12 Sep" from the shop's own date, without moving it across a timezone. */
export const shopDay = (d: string) => (/^\d{4}-\d{2}-\d{2}$/.test(d) ? dayWords(d) : d);

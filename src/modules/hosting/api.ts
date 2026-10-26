import { apiDelete, apiGetMeta, apiPost, apiPut, type Query } from '../../core/api';
import { createStore, useStore } from '../../core/store';

/**
 * Hosting & Domains on the desktop (Hosting & Domains SRS v1.0 §4.15 HDM-DSK-01…05, screens D-01…D-08) over the
 * server's `/api/hosting` (§7.1).
 *
 * THE SERVER IS AUTHORITATIVE. Days left, monthly costs, uptime and every total are what the server sent. The routes
 * the SRS adds (overview, one domain / server / certificate, activity, live lookup, RDAP, renew, auto-renew, lock,
 * auth code, server actions, snapshots, metrics, monitors, incidents, costs, reports, export, bulk, account
 * schedule) may not be on the server this computer talks to: `orNull` turns their 404 into the "needs a server
 * update" state, and the screens fall back to the built lists where they can.
 */

export const BASE = '/api/hosting';

/** A 404 or 405 — an endpoint this server does not have yet — as null; anything else is thrown. */
export async function orNull<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (e) {
    if ([404, 405].includes((e as { status?: number }).status ?? 0)) return null;
    throw e;
  }
}

/** The register's "as of" time (HDM-DSK-05): the oldest saved answer shown since the connection went. */
export const asOf = createStore<{ at: string | null }>({ at: null });
export const useAsOf = () => useStore(asOf, (s) => s.at);
function noteCached(at: string | null): void {
  if (!at) return;
  const cur = asOf.get().at;
  if (!cur || at < cur) asOf.set({ at });
}

/** A GET whose saved copy, offline, says when it was saved. */
async function get<T>(path: string, query?: Query, signal?: AbortSignal): Promise<{ data: T; meta: unknown }> {
  const r = await apiGetMeta<T>(`${BASE}${path}`, query, signal);
  if (r.offline) noteCached(r.cachedAt);
  return { data: r.data, meta: r.meta };
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  per_page: number;
}

/** A list as the server sends it: a bare array, `{data|items|<key>: []}`, with paging in the body or in `meta`. */
export function pageOf<T>(data: unknown, meta: unknown, key: string): Page<T> {
  const d = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  const raw = Array.isArray(data) ? data : [d[key], d.data, d.items].find(Array.isArray) ?? [];
  const m = { ...((meta && typeof meta === 'object' ? meta : {}) as Record<string, unknown>), ...(Array.isArray(data) ? {} : d) };
  const n = (v: unknown, f: number) => (typeof v === 'number' && Number.isFinite(v) ? v : f);
  return { items: raw as T[], total: n(m.total, raw.length), page: n(m.page ?? m.current_page, 1), per_page: n(m.per_page, raw.length || 50) };
}

export interface ListQuery {
  page?: number;
  per_page?: number;
  sort?: string;
  q?: string;
  org?: number;
  status?: string;
  provider?: string;
  client_id?: number;
  project_id?: number;
  tag?: string;
  expires_within?: number;
}

const clean = (q: ListQuery | undefined): Query => Object.fromEntries(Object.entries(q ?? {}).filter(([, v]) => v !== undefined && v !== '' && v !== 0)) as Query;

// ── shapes ───────────────────────────────────────────────────────────────

export interface Org {
  id: number;
  name: string;
}

export interface Domain {
  id: number;
  name: string;
  provider?: string | null;
  account_id?: number | null;
  registrar?: string | null;
  registered_on?: string | null;
  expires_on?: string | null;
  days_left?: number | null;
  auto_renew?: boolean | null;
  locked?: boolean | null;
  status?: string | null;
  nameservers?: string[] | string | null;
  dns_provider?: string | null;
  dns_editable?: boolean | null;
  dns_readonly_reason?: string | null;
  dns_count?: number | null;
  client?: string | null;
  client_id?: number | null;
  project?: string | null;
  server?: string | null;
  server_id?: number | null;
  org_id?: number | null;
  company?: string | null;
  tags?: string[] | null;
  source?: 'sync' | 'manual' | string | null;
  synced_at?: string | null;
  notes?: string | null;
  renew_price?: string | null;
  renew_currency?: string | null;
  tls?: { status?: string | null; days_left?: number | null } | null;
  monitor?: { state?: string | null; ms?: number | null } | null;
}

export interface DnsRecord {
  id: number | string;
  type: string;
  name: string;
  content: string;
  ttl?: number | null;
  priority?: number | null;
  synced_at?: string | null;
  readonly_reason?: string | null;
}

export interface Certificate {
  id: number;
  domain_id?: number | null;
  host: string;
  port?: number | null;
  common_name?: string | null;
  sans?: string[] | string | null;
  issuer?: string | null;
  serial?: string | null;
  fingerprint?: string | null;
  server?: string | null;
  server_id?: number | null;
  issued_on?: string | null;
  expires_on?: string | null;
  days_left?: number | null;
  status?: string | null;
  checked_at?: string | null;
  check_error?: string | null;
  protocol?: string | null;
}

export interface Server {
  id: number;
  name: string;
  provider?: string | null;
  kind?: string | null;
  location?: string | null;
  os?: string | null;
  plan?: string | null;
  cpu?: string | number | null;
  ram?: string | number | null;
  storage?: string | number | null;
  ipv4?: string | null;
  ipv6?: string | null;
  status?: string | null;
  expires_on?: string | null;
  cost_amount?: string | null;
  cost_currency?: string | null;
  cost_period?: string | null;
  monthly?: string | null;
  client?: string | null;
  project?: string | null;
  notes?: string | null;
  domains_count?: number | null;
  domains?: Array<{ id: number; name: string }> | null;
  certificates?: Array<{ id: number; host: string }> | null;
  cpu_pct?: number | null;
  disk_pct?: number | null;
  /** What this server's adapter can do (HDM-PRV-02); absent on an older server. */
  supports?: string[] | null;
  synced_at?: string | null;
}

export interface Monitor {
  id: number;
  kind: string;
  name?: string | null;
  target: string;
  interval_s?: number | null;
  last_state?: string | null;
  last_checked_at?: string | null;
  ms?: number | null;
  uptime_24h?: number | string | null;
  uptime_30d?: number | string | null;
  /** Recent checks, oldest first: true up, false down. */
  recent?: boolean[] | null;
  incident_id?: number | null;
  last_error?: string | null;
  enabled?: boolean | null;
}

export interface Incident {
  id: number;
  monitor_id: number;
  monitor?: string | null;
  opened_at: string;
  closed_at?: string | null;
  first_error?: string | null;
  acknowledged_by?: string | null;
}

export interface Account {
  id: number;
  provider: string;
  name: string;
  org_id?: number | null;
  company?: string | null;
  status?: string | null;
  last_ok_at?: string | null;
  last_error?: string | null;
  last_error_at?: string | null;
  key_hint?: string | null;
  domains_count?: number | null;
  servers_count?: number | null;
  dns_editable?: boolean | null;
  sync_schedule?: 'off' | 'nightly' | '6h' | string | null;
  paused_at?: string | null;
}

export interface SyncRun {
  id: number;
  account_id?: number | null;
  account?: string | null;
  provider?: string | null;
  kind?: string | null;
  ok: boolean | number;
  added?: number | null;
  updated?: number | null;
  failed?: number | null;
  message?: string | null;
  created_at: string;
}

export interface Overview {
  kpi?: { domains?: number; expiring_30?: number; certs_at_risk?: number; servers?: number; monitors_down?: number; monthly?: string | null; monthly_currency?: string | null };
  renewals?: Array<{ kind: 'domain' | 'certificate' | 'server' | string; id: number; name: string; expires_on?: string | null; days_left?: number | null; note?: string | null }>;
  attention?: Array<{ title: string; detail?: string | null; tone?: 'red' | 'amber' | string; link?: string | null }>;
  synced_at?: string | null;
  orgs?: string[];
}

export interface Costs {
  currency?: string | null;
  totals?: Array<{ currency: string; monthly: string }>;
  by?: Array<{ group: string; label: string; amount: string; currency: string }>;
  months?: Array<{ month: string; amount: string; currency: string }>;
}

export interface Activity {
  id: number | string;
  at: string;
  what: string;
  who?: string | null;
}

// ── reads ────────────────────────────────────────────────────────────────

export const K = {
  all: ['hosting'] as const,
  orgs: ['hosting', 'orgs'] as const,
  overview: (org: number) => ['hosting', 'overview', org] as const,
  domains: (q: ListQuery) => ['hosting', 'domains', q] as const,
  domain: (id: number) => ['hosting', 'domain', id] as const,
  dns: (id: number) => ['hosting', 'dns', id] as const,
  certificates: (q: ListQuery) => ['hosting', 'certificates', q] as const,
  certificate: (id: number) => ['hosting', 'certificate', id] as const,
  servers: (q: ListQuery) => ['hosting', 'servers', q] as const,
  server: (id: number) => ['hosting', 'server', id] as const,
  monitors: (q: ListQuery) => ['hosting', 'monitors', q] as const,
  incidents: ['hosting', 'incidents'] as const,
  accounts: ['hosting', 'accounts'] as const,
  runs: (q: ListQuery) => ['hosting', 'runs', q] as const,
  costs: (org: number) => ['hosting', 'costs', org] as const,
  activity: (id: number) => ['hosting', 'activity', id] as const,
};

export const fetchOrgs = async (signal?: AbortSignal) => pageOf<Org>((await get('/organizations', undefined, signal)).data, null, 'organizations').items;
export const fetchOverview = (org: number, signal?: AbortSignal) => orNull(get<Overview>('/overview', clean({ org }), signal).then((r) => r.data));
export async function fetchDomains(q: ListQuery, signal?: AbortSignal): Promise<Page<Domain>> {
  const r = await get('/domains', clean(q), signal);
  return pageOf<Domain>(r.data, r.meta, 'domains');
}
/** One domain: `domains/{id}` where the server has it, else the row from the list. */
export async function fetchDomain(id: number, signal?: AbortSignal): Promise<Domain | null> {
  const one = await orNull(get<Domain | { domain: Domain }>(`/domains/${id}`, undefined, signal));
  if (one) return 'domain' in one.data && one.data.domain ? one.data.domain : (one.data as Domain);
  const all = await fetchDomains({ per_page: 200 }, signal);
  return all.items.find((d) => d.id === id) ?? null;
}
export async function fetchDns(id: number, signal?: AbortSignal): Promise<{ records: DnsRecord[]; editable: boolean | null; reason: string | null; readAt: string | null }> {
  const r = await get<unknown>(`/domains/${id}/dns`, undefined, signal);
  const d = (r.data && typeof r.data === 'object' && !Array.isArray(r.data) ? r.data : {}) as Record<string, unknown>;
  return {
    records: pageOf<DnsRecord>(r.data, r.meta, 'records').items,
    editable: typeof d.editable === 'boolean' ? d.editable : null,
    reason: typeof d.reason === 'string' ? d.reason : typeof d.readonly_reason === 'string' ? d.readonly_reason : null,
    readAt: typeof d.synced_at === 'string' ? d.synced_at : null,
  };
}
export async function fetchCertificates(q: ListQuery, signal?: AbortSignal): Promise<Page<Certificate>> {
  const r = await get('/certificates', clean(q), signal);
  return pageOf<Certificate>(r.data, r.meta, 'certificates');
}
export const fetchCertificate = (id: number, signal?: AbortSignal) => orNull(get<Certificate | { certificate: Certificate }>(`/certificates/${id}`, undefined, signal).then((r) => ('certificate' in r.data && r.data.certificate ? r.data.certificate : (r.data as Certificate))));
export async function fetchServers(q: ListQuery, signal?: AbortSignal): Promise<Page<Server>> {
  const r = await get('/servers', clean(q), signal);
  return pageOf<Server>(r.data, r.meta, 'servers');
}
export async function fetchServer(id: number, signal?: AbortSignal): Promise<Server | null> {
  const one = await orNull(get<Server | { server: Server }>(`/servers/${id}`, undefined, signal));
  if (one) return 'server' in one.data && one.data.server ? one.data.server : (one.data as Server);
  return (await fetchServers({ per_page: 200 }, signal)).items.find((s) => s.id === id) ?? null;
}
export const fetchMetrics = (id: number, range: '24h' | '7d', signal?: AbortSignal) =>
  orNull(apiGetMeta<{ cpu?: number[]; network?: number[]; disk?: number[] }>(`${BASE}/servers/${id}/metrics`, { range }, signal).then((r) => r.data));
export const fetchSnapshots = (id: number, signal?: AbortSignal) =>
  orNull(apiGetMeta<unknown>(`${BASE}/servers/${id}/snapshots`, undefined, signal).then((r) => pageOf<{ id: number | string; name?: string; created_at?: string; size?: string | null; kind?: string | null }>(r.data, r.meta, 'snapshots').items));
export const fetchMonitors = (q: ListQuery, signal?: AbortSignal) => orNull(get('/monitors', clean(q), signal).then((r) => pageOf<Monitor>(r.data, r.meta, 'monitors')));
export const fetchIncidents = (signal?: AbortSignal) => orNull(get('/incidents', { open: 1 }, signal).then((r) => pageOf<Incident>(r.data, r.meta, 'incidents').items));
export const fetchAccounts = async (signal?: AbortSignal) => {
  const r = await get('/accounts', undefined, signal);
  return pageOf<Account>(r.data, r.meta, 'accounts').items;
};
export async function fetchRuns(q: ListQuery, signal?: AbortSignal): Promise<Page<SyncRun>> {
  const r = await get('/sync-runs', clean(q), signal);
  return pageOf<SyncRun>(r.data, r.meta, 'runs');
}
export const fetchCosts = (org: number, signal?: AbortSignal) => orNull(get<Costs>('/costs', clean({ org }), signal).then((r) => r.data));
export const fetchActivity = (id: number, signal?: AbortSignal) => orNull(get(`/domains/${id}/activity`, undefined, signal).then((r) => pageOf<Activity>(r.data, r.meta, 'activity').items));
export const fetchLookup = (id: number, host: string, type: string) => orNull(apiGetMeta<{ answers?: Array<{ resolver: string; values: string[] }> }>(`${BASE}/domains/${id}/lookup`, { host, type }).then((r) => r.data));

// ── changes (never offline: every one needs the server) ─────────────────

export interface NewDomain {
  name: string;
  org_id?: number | null;
  registrar?: string | null;
  expires_on?: string | null;
  auto_renew?: boolean;
  notes?: string | null;
}
export const addDomain = (d: NewDomain) => apiPost<Domain>(`${BASE}/domains`, d);
export const removeDomain = (id: number) => apiDelete(`${BASE}/domains/${id}`);

export interface RecordInput {
  type: string;
  name: string;
  content: string;
  ttl?: number | null;
  priority?: number | null;
}
export const saveRecord = (domain: number, rec: RecordInput, id?: number | string | null) =>
  id !== null && id !== undefined ? apiPut<DnsRecord>(`${BASE}/domains/${domain}/dns/${id}`, rec) : apiPost<DnsRecord>(`${BASE}/domains/${domain}/dns`, rec);
export const deleteRecord = (domain: number, id: number | string) => apiDelete(`${BASE}/domains/${domain}/dns/${id}`);
export const refreshDns = (domain: number) => apiPost(`${BASE}/domains/${domain}/dns/refresh`);

export const renewDomain = (id: number, years: number) => orNull(apiPost<{ message?: string }>(`${BASE}/domains/${id}/renew`, { years }));
export const setAutoRenew = (id: number, on: boolean) => orNull(apiPost(`${BASE}/domains/${id}/auto-renew`, { auto_renew: on }));
export const setLock = (id: number, on: boolean) => orNull(apiPost(`${BASE}/domains/${id}/lock`, { locked: on }));
export const authCode = (id: number) => orNull(apiPost<{ code?: string; auth_code?: string }>(`${BASE}/domains/${id}/auth-code`));
export const rdapCheck = (id: number) => orNull(apiGetMeta(`${BASE}/domains/${id}/rdap`).then((r) => r.data));

export type PowerAction = 'power_on' | 'power_off' | 'reboot' | 'rescue';
export const serverAction = (id: number, action: PowerAction, confirm?: string) => orNull(apiPost(`${BASE}/servers/${id}/actions`, { action, ...(confirm ? { confirm } : {}) }));
export const takeSnapshot = (id: number, name?: string) => orNull(apiPost(`${BASE}/servers/${id}/snapshots`, name ? { name } : {}));

export const checkCertificate = (id: number) => apiPost<Certificate>(`${BASE}/certificates/${id}/check`);
export const watchHost = (host: string, port: number) => apiPost<Certificate>(`${BASE}/certificates`, { host, port });

export const testAccount = (id: number) => apiPost<{ ok?: boolean; message?: string }>(`${BASE}/accounts/${id}/test`);
export const syncAccount = (id: number) => apiPost<{ message?: string }>(`${BASE}/accounts/${id}/sync`);
export const setSchedule = (id: number, schedule: 'off' | 'nightly' | '6h', paused?: boolean) => orNull(apiPut(`${BASE}/accounts/${id}/schedule`, { schedule, ...(paused === undefined ? {} : { paused }) }));

export const ackIncident = (id: number) => orNull(apiPost(`${BASE}/incidents/${id}/ack`));
export interface MonitorInput {
  kind: 'http' | 'ping' | 'tcp' | 'dns';
  target: string;
  interval_s: number;
  keyword?: string | null;
  expect_status?: number | null;
  domain_id?: number | null;
  server_id?: number | null;
}
export const addMonitor = (m: MonitorInput) => orNull(apiPost<Monitor>(`${BASE}/monitors`, m));

/**
 * HDM-AI-01: explain a DNS record or a failed certificate check in plain words. The server's AI route; null where the
 * server has none (the "Explain" button is then hidden for the session).
 */
export const explain = (kind: 'certificate' | 'dns', id: number | string, domain?: number) =>
  orNull(apiPost<{ text?: string; explanation?: string }>(kind === 'certificate' ? `${BASE}/certificates/${id}/explain` : `${BASE}/domains/${domain}/dns/${id}/explain`).then((r) => r.text ?? r.explanation ?? ''));

// ── DNS record form: type-aware checks before anything is sent (the server checks again) ───────

export const RECORD_TYPES = ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'SRV', 'CAA'] as const;
const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
const HOST = /^(?=.{1,253}\.?$)(?:(?!-)[a-z0-9_-]{1,63}(?<!-)\.)*(?!-)[a-z0-9_-]{1,63}(?<!-)\.?$/i;

function ipv6(v: string): boolean {
  if (!/^[0-9a-f:]+$/i.test(v) || (v.match(/::/g) ?? []).length > 1) return false;
  const parts = v.split(':');
  return v.includes('::') ? parts.length <= 8 : parts.length === 8 && parts.every((p) => p.length >= 1 && p.length <= 4);
}

/** What is wrong with a record, or null. Also refuses a CNAME beside other records on the same host (HDM-DNS-03). */
export function recordProblem(r: RecordInput, others: DnsRecord[] = []): string | null {
  const name = r.name.trim() || '@';
  const v = r.content.trim();
  if (!v) return 'Enter a value.';
  if (name !== '@' && !/^[a-z0-9_*.-]+$/i.test(name)) return 'The host may use letters, digits, -, _, * and dots.';
  if (r.ttl !== null && r.ttl !== undefined && (!Number.isInteger(r.ttl) || r.ttl < 60 || r.ttl > 604_800)) return 'TTL is between 60 and 604800 seconds.';
  switch (r.type) {
    case 'A':
      if (!IPV4.test(v)) return 'An A record points at an IPv4 address, like 203.0.113.10.';
      break;
    case 'AAAA':
      if (!ipv6(v)) return 'An AAAA record points at an IPv6 address, like 2001:db8::1.';
      break;
    case 'CNAME':
    case 'NS':
      if (!HOST.test(v)) return 'Enter a host name, like portal.example.com.';
      if (r.type === 'CNAME' && name === '@') return 'The apex (@) cannot be a CNAME.';
      break;
    case 'MX':
      if (!HOST.test(v)) return 'Enter the mail server’s host name.';
      if (r.priority === null || r.priority === undefined || !Number.isInteger(r.priority) || r.priority < 0 || r.priority > 65_535) return 'An MX record needs a priority from 0 to 65535.';
      break;
    case 'SRV':
      if (!/^\d+ \d+ \d+ \S+$/.test(v)) return 'An SRV value is "weight port target", like 5 443 mail.example.com.';
      break;
    case 'CAA':
      if (!/^\d+ (issue|issuewild|iodef) "?[^"]*"?$/.test(v)) return 'A CAA value is like 0 issue "letsencrypt.org".';
      break;
  }
  const same = others.filter((o) => (o.name || '@').toLowerCase() === name.toLowerCase());
  if (r.type === 'CNAME' && same.length) return 'A CNAME must be the only record on its host.';
  if (r.type !== 'CNAME' && same.some((o) => o.type === 'CNAME')) return 'This host has a CNAME; it cannot have other records.';
  return null;
}

/** Days left as the server sent them, or counted from the expiry date. */
export function daysLeft(x: { days_left?: number | null; expires_on?: string | null }, now = new Date()): number | null {
  if (typeof x.days_left === 'number') return x.days_left;
  if (!x.expires_on) return null;
  const t = Date.parse(x.expires_on.slice(0, 10));
  if (!Number.isFinite(t)) return null;
  return Math.round((t - Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())) / 86_400_000);
}

/** red ≤ 7 days, amber ≤ 30, grey ≤ 90, green beyond (D-01, D-02). */
export function urgency(days: number | null): 'red' | 'amber' | 'grey' | 'green' {
  if (days === null) return 'grey';
  return days <= 7 ? 'red' : days <= 30 ? 'amber' : days <= 90 ? 'grey' : 'green';
}

/** Whether the typed confirmation matches the server's name exactly (SRV-04): spaces around it do not count. */
export const confirmsName = (typed: string, name: string) => typed.trim() === name;

export const nameservers = (v: string[] | string | null | undefined): string[] => (Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[\s,]+/).filter(Boolean) : []);

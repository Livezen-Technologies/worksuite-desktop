import { ApiError, apiDelete, apiGetMeta, apiPost, apiPut, apiUrl, request, type Query } from '../../core/api';
import { createStore, useStore } from '../../core/store';

/**
 * Hosting & Domains on the desktop (Hosting & Domains SRS v1.0 §4.15 HDM-DSK-01…05, screens D-01…D-08) over the
 * server's `/api/hosting` (app/Modules/Hosting in the server repo, Config/Routes.php).
 *
 * The envelope is `{status, message, data}`. A list answers `{<key>: [...], summary?, meta: {total, page, per_page,
 * pages, sort}}` inside `data` — `domains`, `servers`, `certificates`, `monitors`, `incidents`, `runs` — and the
 * screens read those shapes as the controllers write them (DomainController::shape, Servers::shape,
 * Certificates::shape, Monitors::shape, Overview::build).
 *
 * THE SERVER IS AUTHORITATIVE. Days left, monthly costs, uptime and every total are what the server sent. A route an
 * older server does not have (404/405) is null through `orNull`, which the screens show as "needs a server update".
 * Renew, the transfer code, register and power off answer 428 `errors.step_up` until the same request carries the
 * proof (`current_password` or `totp_code`): `withStepUp` (StepUp.tsx) asks for it and sends the request again.
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

export interface Page<T, S = Record<string, unknown>> {
  items: T[];
  total: number;
  page: number;
  per_page: number;
  pages: number;
  sort: string | null;
  /** The list's own counts over the whole filtered set (not the page): `summary` beside the rows. */
  summary: Partial<S>;
}

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/**
 * A list as the server sends it: `{<key>: [...], summary, meta}` in `data` (Hosting's ListQuery::meta). A bare array,
 * `data`/`items`, or paging in the envelope's `meta` are read too, so a cached answer of an older shape still opens.
 */
export function pageOf<T, S = Record<string, unknown>>(data: unknown, meta: unknown, key: string): Page<T, S> {
  const d = obj(data);
  const raw = (Array.isArray(data) ? data : [d[key], d.items, d.data].find(Array.isArray) ?? []) as T[];
  const m = { ...obj(meta), ...d, ...obj(d.meta) };
  const n = (v: unknown, f: number) => (typeof v === 'number' && Number.isFinite(v) ? v : f);
  const per = n(m.per_page, raw.length || 50);
  const total = n(m.total, raw.length);
  return { items: raw, total, page: n(m.page ?? m.current_page, 1), per_page: per, pages: n(m.pages, Math.max(1, Math.ceil(total / Math.max(1, per)))), sort: typeof m.sort === 'string' ? m.sort : null, summary: obj(d.summary) as Partial<S> };
}

/** The list request every Hosting list takes (HDM-UI-02, the server's ListQuery::parse). */
export interface ListQuery {
  page?: number;
  per_page?: number;
  sort?: string;
  q?: string;
  org?: number;
  status?: string;
  state?: string;
  kind?: string;
  provider?: string;
  source?: 'manual' | 'sync';
  client_id?: number | 'none';
  project_id?: number | 'none';
  owner?: number | 'none';
  server_id?: number;
  domain_id?: number;
  account_id?: number;
  domain?: number;
  tag?: string;
  group?: string;
  expires_within?: number;
  trash?: 1;
  open?: 1;
}

export const clean = (q: ListQuery | Query | undefined): Query => Object.fromEntries(Object.entries(q ?? {}).filter(([, v]) => v !== undefined && v !== null && v !== '' && v !== 0)) as Query;

// ── shapes, as the controllers write them ───────────────────────────────

export interface Org {
  id: number;
  name: string;
}

/** A row's tone as the server colours it (DomainExpiry::tone). */
export type Tone = 'red' | 'amber' | 'grey' | 'green' | 'unknown' | string;

/** DomainController::shape. */
export interface Domain {
  id: number;
  org_id?: number;
  name: string;
  source?: 'sync' | 'manual' | null;
  provider?: string | null;
  provider_label?: string | null;
  account_id?: number | null;
  account_name?: string | null;
  registrar?: string | null;
  registered_on?: string | null;
  expires_on?: string | null;
  days_left?: number | null;
  tone?: Tone | null;
  left?: string | null;
  auto_renew?: boolean | null;
  locked?: boolean | null;
  status?: string | null;
  nameservers?: string[] | string | null;
  client_id?: number | null;
  client?: string | null;
  project_id?: number | null;
  project?: string | null;
  server_id?: number | null;
  server?: string | null;
  owner_user_id?: number | null;
  owner?: string | null;
  tags?: string[] | null;
  group?: string | null;
  notes?: string | null;
  renew_price?: string | null;
  renew_currency?: string | null;
  renew_years?: number | null;
  renew_monthly?: number | null;
  dns_provider?: string | null;
  dns_account_id?: number | null;
  synced_at?: string | null;
  updated_at?: string | null;
  rdap_checked_at?: string | null;
  removed_at?: string | null;
  /** What the registrar's API can do for this domain (HDM-PRV-02): renew, auto_renew, lock, auth_code, dns… */
  supports?: string[] | null;
}

/** One cost paid (Costs::history). */
export interface CostEntry {
  id: number;
  amount: string;
  currency: string;
  period_start?: string | null;
  period_end?: string | null;
  source?: string | null;
  note?: string | null;
}

/** One registrar or server action attempted (Actions::history). */
export interface ActionEntry {
  id: number;
  action: string;
  status: string;
  result?: string | null;
  by?: string | null;
  at?: string | null;
}

/** `GET domains/{id}`: the row and what its page shows. */
export interface DomainDetail extends Domain {
  certificates?: Certificate[];
  monitors?: Monitor[];
  costs?: CostEntry[];
  actions?: ActionEntry[];
  tasks_available?: boolean;
  dns?: DnsCopy;
}

/** DnsRecords::shape: `host` is relative to the domain (`@`, `www`), `name` the full name. */
export interface DnsRecord {
  id: number | string;
  type: string;
  host?: string | null;
  name: string;
  content: string;
  ttl?: number | null;
  priority?: number | null;
  proxied?: boolean | null;
  editable?: boolean | null;
  synced_at?: string | null;
}

/** DomainController::dnsCopy. */
export interface DnsCopy {
  records: DnsRecord[];
  refreshed_at: string | null;
  source: 'manual' | 'sync' | null;
  readable: boolean;
  can_refresh: boolean;
  can_edit: boolean;
}

/** Certificates::shape. */
export interface Certificate {
  id: number;
  org_id?: number;
  host: string;
  port?: number | null;
  label?: string | null;
  domain_id?: number | null;
  domain?: string | null;
  common_name?: string | null;
  sans?: string[] | string | null;
  issuer?: string | null;
  serial?: string | null;
  fingerprint?: string | null;
  issued_on?: string | null;
  expires_on?: string | null;
  days_left?: number | null;
  tone?: Tone | null;
  left?: string | null;
  status?: string | null;
  status_words?: string | null;
  /** The last check's error, in the server's words. */
  problem?: string | null;
  key_type?: string | null;
  key_bits?: number | null;
  protocol?: string | null;
  warnings?: string[] | null;
  server_id?: number | null;
  checked_at?: string | null;
}

/** Servers::shape. `domains` is how many domains point here; the detail's `domains_list` names them. */
export interface Server {
  id: number;
  org_id?: number;
  name: string;
  kind?: string | null;
  kind_label?: string | null;
  provider?: string | null;
  provider_label?: string | null;
  source?: 'manual' | 'sync' | null;
  account_id?: number | null;
  account_name?: string | null;
  ipv4?: string | null;
  ipv6?: string | null;
  location?: string | null;
  os?: string | null;
  plan?: string | null;
  cpu?: string | null;
  ram?: string | null;
  storage?: string | null;
  status?: string | null;
  status_label?: string | null;
  expires_on?: string | null;
  days_left?: number | null;
  tone?: Tone | null;
  left?: string | null;
  cost_amount?: string | null;
  cost_currency?: string | null;
  cost_period?: string | null;
  cost_monthly?: number | null;
  client_id?: number | null;
  client?: string | null;
  project_id?: number | null;
  project?: string | null;
  owner_user_id?: number | null;
  owner?: string | null;
  tags?: string[] | null;
  group?: string | null;
  notes?: string | null;
  domains?: number | null;
  /** What this server's adapter can do (HDM-PRV-02): server_actions, snapshots, metrics. */
  supports?: string[] | null;
  synced_at?: string | null;
}

export interface ServerDetail extends Server {
  domains_list?: Array<{ id: number; name: string; expires_on?: string | null }>;
  certificates?: Certificate[];
  monitors?: Monitor[];
  costs?: CostEntry[];
  actions?: ActionEntry[];
  tasks_available?: boolean;
  ssh?: { available: boolean; host_id: number | null; why: string } | null;
}

/** Monitors::shape. */
export interface Monitor {
  id: number;
  org_id?: number;
  kind: string;
  name?: string | null;
  target: string;
  interval_s?: number | null;
  keyword?: string | null;
  expect_status?: number | null;
  domain_id?: number | null;
  server_id?: number | null;
  enabled?: boolean | null;
  state?: string | null;
  last_ms?: number | null;
  last_error?: string | null;
  last_checked_at?: string | null;
  uptime_24h?: number | null;
  uptime_30d?: number | null;
}

export interface MonitorCheck {
  ok: boolean;
  ms: number | null;
  code: number | null;
  error: string | null;
  at: string | null;
}

/** Monitors::incident. */
export interface Incident {
  id: number;
  monitor_id: number;
  monitor?: string | null;
  target?: string | null;
  opened_at: string;
  closed_at?: string | null;
  open?: boolean;
  first_error?: string | null;
  acknowledged_by?: number | null;
  acknowledged_by_name?: string | null;
  acknowledged_at?: string | null;
  duration_s?: number | null;
}

/** ProviderAccountController::index — the mask, never the key. */
export interface Account {
  id: number;
  org_id?: number;
  provider: string;
  label?: string | null;
  connectable?: boolean;
  name: string;
  environment?: string | null;
  status?: string | null;
  key?: string | null;
  last_ok_at?: string | null;
  last_error?: string | null;
  last_error_at?: string | null;
  sync_schedule?: 'off' | 'nightly' | '6h' | string | null;
  paused?: boolean;
  paused_at?: string | null;
  last_sync_at?: string | null;
  supports?: string[] | null;
}

/** DomainController::runs. */
export interface SyncRun {
  id: number;
  account_id?: number | null;
  account_name?: string | null;
  provider?: string | null;
  kind?: string | null;
  ok: boolean;
  added?: number | null;
  updated?: number | null;
  failed?: number | null;
  message?: string | null;
  started_by?: string | null;
  at: string | null;
}

export interface Renewal {
  kind: 'domain' | 'certificate' | 'server' | string;
  id: number;
  name: string;
  expires_on?: string | null;
  days_left?: number | null;
  tone?: Tone | null;
  auto_renew?: boolean | null;
  cost?: { amount: string; currency: string } | null;
}

export interface Attention {
  kind: 'account' | 'incident' | 'certificate' | 'domain' | string;
  id: number;
  title: string;
  detail?: string | null;
  severity?: 'error' | 'warning' | string;
}

export interface CostGroup {
  key: string;
  label: string;
  monthly: number;
  items: number;
  domains: number;
  servers: number;
}

/** Overview::build (+ the controller's `core_domains`, `currencies`). */
export interface Overview {
  as_of?: string | null;
  currency?: string | null;
  domains?: { total?: number; synced?: number; manual?: number; expired?: number; within_30?: number; within_60?: number; within_90?: number; renew_off_30?: number; unassigned?: number };
  certificates?: { total?: number; at_risk?: number; within_14?: number; problems?: number };
  servers?: { total?: number; running?: number; stopped?: number; cancelled?: number; by_provider?: Array<{ provider: string; count: number }> };
  monitors?: { total?: number; down?: number; open_incidents?: number };
  cost?: { monthly?: number; currency?: string; by_provider?: CostGroup[]; unconverted?: Array<{ currency: string; monthly: number }> };
  sync_failures?: Array<{ account_id: number; name: string; provider: string; why?: string | null; at?: string | null }>;
  renewals?: Renewal[];
  attention?: Attention[];
  currencies?: string[];
}

/** OverviewController::costs. */
export interface Costs {
  currency?: string;
  total?: number;
  groups?: CostGroup[];
  unconverted?: Array<{ currency: string; monthly: number }>;
  by?: 'client' | 'project' | 'provider';
  by_month?: Array<{ month: string; amount: number }>;
  currencies?: string[];
}

/** Timeline::for. */
export interface Activity {
  at: string | null;
  kind?: string | null;
  action?: string | null;
  text: string;
  by?: string | null;
}

/** DomainController::lookup: the copy against what public resolvers say now (HDM-DNS-06). */
export interface LiveAnswer {
  type: string;
  stored: string[];
  resolvers: Record<string, { ok: boolean; why: string; values: string[] }>;
  compare: { match: boolean; missing: string[]; extra: string[] };
}

/** HostingController::lookupsFor: what a row of ONE company can be linked to. */
export interface Lookups {
  clients: Org[];
  projects: Org[];
  people: Org[];
  servers: Org[];
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
  monitor: (id: number) => ['hosting', 'monitor', id] as const,
  incidents: ['hosting', 'incidents'] as const,
  accounts: ['hosting', 'accounts'] as const,
  runs: (q: ListQuery) => ['hosting', 'runs', q] as const,
  costs: (org: number, by: string, currency: string) => ['hosting', 'costs', org, by, currency] as const,
  activity: (id: number) => ['hosting', 'activity', id] as const,
  lookups: (scope: string) => ['hosting', 'lookups', scope] as const,
  report: (name: string, q: Query) => ['hosting', 'report', name, q] as const,
};

export const fetchOrgs = async (signal?: AbortSignal) => pageOf<Org>((await get('/organizations', undefined, signal)).data, null, 'items').items;
export const fetchOverview = (org: number, signal?: AbortSignal) => orNull(get<Overview>('/overview', clean({ org }), signal).then((r) => r.data));

export interface DomainSummary {
  total: number;
  expired: number;
  within_7: number;
  within_30: number;
  renew_off_soon: number;
}
export async function fetchDomains(q: ListQuery, signal?: AbortSignal): Promise<Page<Domain, DomainSummary>> {
  const r = await get('/domains', clean(q), signal);
  return pageOf<Domain, DomainSummary>(r.data, r.meta, 'domains');
}
export const fetchDomain = (id: number, signal?: AbortSignal) => orNull(get<DomainDetail>(`/domains/${id}`, undefined, signal).then((r) => r.data));

/** `GET domains/{id}/dns` (DomainController::dnsCopy). */
export function dnsCopyOf(v: unknown): DnsCopy {
  const d = obj(v);
  return {
    records: (Array.isArray(d.records) ? d.records : []) as DnsRecord[],
    refreshed_at: typeof d.refreshed_at === 'string' ? d.refreshed_at : null,
    source: d.source === 'manual' || d.source === 'sync' ? d.source : null,
    readable: d.readable !== false,
    can_refresh: d.can_refresh === true,
    can_edit: d.can_edit === true,
  };
}
export const fetchDns = async (id: number, signal?: AbortSignal): Promise<DnsCopy> => dnsCopyOf((await get(`/domains/${id}/dns`, undefined, signal)).data);

export interface CertificateSummary {
  total: number;
  expired: number;
  within_14: number;
  problems: number;
}
export async function fetchCertificates(q: ListQuery, signal?: AbortSignal): Promise<Page<Certificate, CertificateSummary> & { acme: { available: boolean; why: string } | null }> {
  const r = await get('/certificates', clean(q), signal);
  const acme = obj(obj(r.data).acme);
  return { ...pageOf<Certificate, CertificateSummary>(r.data, r.meta, 'certificates'), acme: 'available' in acme ? { available: acme.available === true, why: String(acme.why ?? '') } : null };
}
export const fetchCertificate = (id: number, signal?: AbortSignal) => orNull(get<Certificate & { activity?: Activity[] }>(`/certificates/${id}`, undefined, signal).then((r) => r.data));

export interface ServerSummary {
  total: number;
  within_30: number;
  expired: number;
  costs: Array<{ currency: string; monthly: number }>;
}
export async function fetchServers(q: ListQuery, signal?: AbortSignal): Promise<Page<Server, ServerSummary>> {
  const r = await get('/servers', clean(q), signal);
  return pageOf<Server, ServerSummary>(r.data, r.meta, 'servers');
}
export const fetchServer = (id: number, signal?: AbortSignal) => orNull(get<ServerDetail>(`/servers/${id}`, undefined, signal).then((r) => r.data));

/** `GET servers/{id}/metrics?range=24h|7d`: `series` is name → [[unix, value], …] (cpu, network_in/out, disk_read/write). */
export interface Metrics {
  available: boolean;
  why: string;
  range: '24h' | '7d';
  series: Record<string, Array<[number, number]>>;
}
export const fetchMetrics = (id: number, range: '24h' | '7d', signal?: AbortSignal) => orNull(apiGetMeta<Metrics>(`${BASE}/servers/${id}/metrics`, { range }, signal).then((r) => r.data));

export interface Snapshot {
  id: string;
  name?: string | null;
  kind?: string | null;
  created_at?: string | null;
  size_gb?: number | null;
}
export const fetchSnapshots = (id: number, signal?: AbortSignal) =>
  orNull(apiGetMeta<{ available?: boolean; why?: string; items?: Snapshot[] }>(`${BASE}/servers/${id}/snapshots`, undefined, signal).then((r) => ({ available: r.data?.available !== false, why: r.data?.why ?? '', items: r.data?.items ?? [] })));

export const fetchMonitors = (q: ListQuery, signal?: AbortSignal) => orNull(get('/monitors', clean(q), signal).then((r) => pageOf<Monitor, { total: number; down: number }>(r.data, r.meta, 'monitors')));
export const fetchMonitor = (id: number, signal?: AbortSignal) => orNull(get<Monitor & { checks?: MonitorCheck[] }>(`/monitors/${id}`, undefined, signal).then((r) => r.data));
export const fetchIncidents = (signal?: AbortSignal) => orNull(get('/incidents', { open: 1 }, signal).then((r) => pageOf<Incident>(r.data, r.meta, 'incidents').items));
export const fetchAccounts = async (signal?: AbortSignal) => pageOf<Account>((await get('/accounts', undefined, signal)).data, null, 'accounts').items;
export async function fetchRuns(q: ListQuery, signal?: AbortSignal): Promise<Page<SyncRun>> {
  const r = await get('/sync-runs', clean(q), signal);
  return pageOf<SyncRun>(r.data, r.meta, 'runs');
}
export const fetchCosts = (org: number, by: 'client' | 'project' | 'provider', currency: string, signal?: AbortSignal) => orNull(get<Costs>('/costs', clean({ org, by, currency }), signal).then((r) => r.data));
export const fetchActivity = (id: number, signal?: AbortSignal) => orNull(get(`/domains/${id}/activity`, undefined, signal).then((r) => pageOf<Activity>(r.data, r.meta, 'items').items));
export const fetchServerActivity = (id: number, signal?: AbortSignal) => orNull(get(`/servers/${id}/activity`, undefined, signal).then((r) => pageOf<Activity>(r.data, r.meta, 'items').items));

/** `GET domains/{id}/lookup?host=&type=` — never cached: it is what resolvers say now. */
export const fetchLookup = (id: number, host: string, types: string[]) =>
  orNull(apiGetMeta<{ host?: string; types?: LiveAnswer[] }>(`${BASE}/domains/${id}/lookup`, { host: host || '@', type: types.join(',') }).then((r) => ({ host: r.data?.host ?? host, types: r.data?.types ?? [] })));

/** `GET domains/lookups?domain=|org_id=` — customers, projects, people and servers of the row's own company (AC-01). */
export function fetchLookups(scope: { domain: number } | { org_id: number }, signal?: AbortSignal): Promise<Lookups | null> {
  return orNull(
    apiGetMeta<Partial<Lookups>>(`${BASE}/domains/lookups`, scope as unknown as Query, signal).then((r) => ({
      clients: r.data?.clients ?? [],
      projects: r.data?.projects ?? [],
      people: r.data?.people ?? [],
      servers: r.data?.servers ?? [],
    })),
  );
}

/** `GET reports/{name}` (HDM-RPT-02). */
export type ReportName = 'renewals' | 'cost-by-client' | 'provider-spend' | 'uptime';
export const fetchReport = <T = Record<string, unknown>>(name: ReportName, q: Query, signal?: AbortSignal) => orNull(get<T>(`/reports/${name}`, clean(q), signal).then((r) => r.data));

// ── step-up (HDM-SEC-05) ─────────────────────────────────────────────────

/** What the person gave to confirm it is them; sent in the same request's body. */
export interface StepUpProof {
  current_password?: string;
  totp_code?: string;
}

/** The server asks for a fresh check of who is at the keyboard: 428 with `errors.step_up` (ReAuth::require). */
export function needsStepUp(e: unknown): boolean {
  if (!(e instanceof ApiError) && !(e && typeof e === 'object' && 'status' in e)) return false;
  const x = e as { status?: number; data?: unknown };
  return x.status === 428 || obj(x.data).step_up === true;
}

/** The ways the server offers (`errors.methods`), password first. */
export function stepUpMethods(e: unknown): Array<'password' | 'totp'> {
  const m = obj((e as { data?: unknown })?.data).methods;
  const list = Array.isArray(m) ? m.map(String) : [];
  const out: Array<'password' | 'totp'> = [];
  if (!list.length || list.includes('password')) out.push('password');
  if (list.some((x) => x === 'totp' || x === 'authenticator' || x === 'code')) out.push('totp');
  return out.length ? out : ['password'];
}

// ── changes (never offline: every one needs the server) ─────────────────

export interface NewDomain {
  name: string;
  org_id: number;
  registrar?: string | null;
  expires_on?: string | null;
  auto_renew?: boolean | null;
  notes?: string | null;
  client_id?: number | null;
  project_id?: number | null;
  server_id?: number | null;
}
export const addDomain = (d: NewDomain) => apiPost<Domain>(`${BASE}/domains`, d);
export const removeDomain = (id: number) => apiDelete<{ restorable_until?: string }>(`${BASE}/domains/${id}`);
export const restoreDomain = (id: number) => apiPost<Domain>(`${BASE}/domains/${id}/restore`);

/** What `PUT domains/{id}` takes. On a synced domain the registrar's own fields are refused, so they are left out. */
export interface DomainEdit {
  client_id?: number | null;
  project_id?: number | null;
  server_id?: number | null;
  owner_user_id?: number | null;
  tags?: string[];
  group?: string | null;
  notes?: string | null;
  renew_price?: string | null;
  renew_currency?: string | null;
  registrar?: string | null;
  expires_on?: string | null;
  auto_renew?: boolean | null;
}
export const updateDomain = (id: number, edit: DomainEdit) => apiPut<Domain & { notice?: string }>(`${BASE}/domains/${id}`, edit);

/** What the record form edits. `host` is relative (`@`, `www`), as DnsRecordInput reads it. */
export interface RecordInput {
  type: string;
  host: string;
  content: string;
  ttl?: number | null;
  priority?: number | null;
  proxied?: boolean | null;
}
/** The record as it was seen, so a change made meanwhile at the provider is not overwritten (DnsRecords::target). */
export const wasOf = (r: Pick<DnsRecord, 'type' | 'name' | 'content'>) => ({ type: r.type, name: r.name, content: r.content });
export const createRecord = async (domain: number, rec: RecordInput) => dnsCopyOf(await apiPost(`${BASE}/domains/${domain}/dns`, rec));
export const changeRecord = async (domain: number, was: DnsRecord, rec: RecordInput) => dnsCopyOf(await apiPut(`${BASE}/domains/${domain}/dns/${was.id}`, { ...rec, was: wasOf(was) }));
export const deleteRecord = async (domain: number, was: DnsRecord) => dnsCopyOf(await apiDelete(`${BASE}/domains/${domain}/dns/${was.id}`, { was: wasOf(was) }));
export const refreshDns = async (domain: number) => dnsCopyOf(await apiPost(`${BASE}/domains/${domain}/dns/refresh`));
/** A refused DNS write sends the fresh copy in `errors.dns`, so the editor shows what is really there. */
export const refusedCopy = (e: unknown): DnsCopy | null => {
  const d = obj(obj((e as { data?: unknown })?.data).dns);
  return Array.isArray(d.records) ? dnsCopyOf(d) : null;
};

export const renewDomain = (id: number, years: number, proof?: StepUpProof) => apiPost<{ expires_on?: string | null }>(`${BASE}/domains/${id}/renew`, { years, ...proof });
export const setAutoRenew = (id: number, on: boolean, proof?: StepUpProof) => apiPost(`${BASE}/domains/${id}/auto-renew`, { on, ...proof });
export const setLock = (id: number, locked: boolean, proof?: StepUpProof) => apiPost(`${BASE}/domains/${id}/lock`, { locked, ...proof });
export const authCode = (id: number, proof?: StepUpProof) => apiPost<{ code?: string | null }>(`${BASE}/domains/${id}/auth-code`, { ...proof });
export const rdapApply = (id: number) => orNull(request<Domain>('POST', `${BASE}/domains/${id}/rdap`).then((r) => ({ domain: r.data, message: r.message ?? null })));
export const domainTask = (id: number) => orNull(request<{ task_id?: number }>('POST', `${BASE}/domains/${id}/task`, { body: {} }).then((r) => r.message ?? null));
export const serverTask = (id: number) => orNull(request<{ task_id?: number }>('POST', `${BASE}/servers/${id}/task`, { body: {} }).then((r) => r.message ?? null));

/** Registration (HDM-DOM-09): every registrar account of the company that can search. */
export interface SearchResult {
  account_id: number;
  org_id?: number;
  account: string;
  provider: string;
  available: boolean;
  price?: string | null;
  currency?: string | null;
  can_register: boolean;
  why?: string | null;
}
export const searchDomain = (name: string, org?: number) => apiGetMeta<{ name?: string; results?: SearchResult[]; why?: string }>(`${BASE}/register/search`, clean({ name, org })).then((r) => ({ name: r.data?.name ?? name, results: r.data?.results ?? [], why: r.data?.why ?? '' }));
export const registerDomain = (account_id: number, name: string, years: number, proof?: StepUpProof) => request<{ id: number }>('POST', `${BASE}/register`, { body: { account_id, name, years, ...proof } }).then((r) => ({ id: r.data?.id ?? null, message: r.message ?? null }));

export type PowerAction = 'power_on' | 'power_off' | 'reboot' | 'rescue';
/** `POST servers/{id}/actions {action, confirm}` → `{status, detail}` (power off: the name typed, and a step-up). */
export const serverAction = (id: number, action: PowerAction, confirm?: string, proof?: StepUpProof) =>
  request<{ status?: string | null; detail?: unknown }>('POST', `${BASE}/servers/${id}/actions`, { body: { action, ...(confirm ? { confirm } : {}), ...proof } }).then((r) => ({ status: r.data?.status ?? null, detail: r.data?.detail ?? null, message: r.message ?? null }));
export const takeSnapshot = (id: number) => orNull(apiPost<{ status?: string | null }>(`${BASE}/servers/${id}/snapshots`, {}));

/** What `POST servers` / `PUT servers/{id}` take (Servers::validate + links). */
export interface ServerInput {
  org_id?: number;
  name?: string;
  kind?: string;
  status?: string;
  provider?: string | null;
  ipv4?: string | null;
  ipv6?: string | null;
  location?: string | null;
  os?: string | null;
  plan?: string | null;
  cpu?: string | null;
  ram?: string | null;
  storage?: string | null;
  expires_on?: string | null;
  cost_amount?: string | null;
  cost_currency?: string | null;
  cost_period?: string | null;
  notes?: string | null;
  client_id?: number | null;
  project_id?: number | null;
  owner_user_id?: number | null;
  tags?: string[];
  group?: string | null;
}
/** A synced server's fields that belong to its provider (ServerSync::PROVIDER_OWNED + provider): refused on edit. */
export const PROVIDER_OWNED = ['name', 'kind', 'status', 'ipv4', 'ipv6', 'location', 'os', 'plan', 'cpu', 'ram', 'storage', 'cost_amount', 'cost_currency', 'cost_period', 'provider'] as const;
export const SERVER_KINDS: Array<[string, string]> = [['vps', 'VPS'], ['dedicated', 'Dedicated server'], ['cloud', 'Cloud instance'], ['shared', 'Shared hosting'], ['reseller', 'Reseller hosting'], ['other', 'Other']];
export const SERVER_STATUSES: Array<[string, string]> = [['active', 'Running'], ['stopped', 'Stopped'], ['cancelled', 'Cancelled']];
export const COST_PERIODS: Array<[string, string]> = [['monthly', 'Monthly'], ['quarterly', 'Quarterly'], ['semiannual', 'Every six months'], ['annual', 'Yearly'], ['biennial', 'Every two years'], ['triennial', 'Every three years']];
export const addServer = (s: ServerInput) => apiPost<Server>(`${BASE}/servers`, s);
export const updateServer = (id: number, s: ServerInput) => apiPut<Server>(`${BASE}/servers/${id}`, s);
export const removeServer = (id: number) => apiDelete(`${BASE}/servers/${id}`);

export const checkCertificate = (id: number) => request<Certificate>('POST', `${BASE}/certificates/${id}/check`).then((r) => ({ certificate: r.data, message: r.message ?? null }));
export const watchHost = (org_id: number, host: string, port: number) => apiPost<Certificate>(`${BASE}/certificates`, { org_id, host, port });
export const unwatchCertificate = (id: number) => apiDelete(`${BASE}/certificates/${id}`);

/** `POST accounts/{id}/test` answers 200 with `{ok, why}` either way. */
export const testAccount = (id: number) => apiPost<{ ok?: boolean; why?: string | null }>(`${BASE}/accounts/${id}/test`);
/** `POST accounts/{id}/sync` (ProviderSync::run) answers 200 with `{ok, added, updated, failed, why}` either way. */
export const syncAccount = (id: number) => apiPost<{ ok?: boolean; added?: number; updated?: number; failed?: number; why?: string | null }>(`${BASE}/accounts/${id}/sync`);
export const setSchedule = (id: number, change: { schedule?: 'off' | 'nightly' | '6h'; paused?: boolean }) => orNull(apiPut<{ sync_schedule?: string; paused?: boolean }>(`${BASE}/accounts/${id}/schedule`, change));

export const ackIncident = (id: number) => orNull(apiPost(`${BASE}/incidents/${id}/ack`));
export interface MonitorInput {
  org_id: number;
  kind: 'http' | 'ping' | 'tcp' | 'dns';
  target: string;
  name?: string | null;
  interval_s: 60 | 300 | 900;
  keyword?: string | null;
  expect_status?: number | null;
  domain_id?: number | null;
  server_id?: number | null;
}
export const addMonitor = (m: MonitorInput) => orNull(apiPost<Monitor>(`${BASE}/monitors`, m));
export const checkMonitor = (id: number) => request<Monitor>('POST', `${BASE}/monitors/${id}/check`).then((r) => ({ monitor: r.data, message: r.message ?? null }));

/**
 * HDM-AI-01: a DNS record or a failed certificate check in plain words — `GET certificates/{id}/explain` and
 * `GET domains/{id}/explain?record=` → `{text, ai}`; `ai` false is the server's own plain explanation. Null where the
 * server has neither (the "Explain" button is then hidden for the session).
 */
export const explain = (kind: 'certificate' | 'dns', id: number | string, domain?: number) =>
  orNull(
    apiGetMeta<{ text?: string; ai?: boolean }>(kind === 'certificate' ? `${BASE}/certificates/${id}/explain` : `${BASE}/domains/${domain}/explain`, kind === 'certificate' ? undefined : { record: String(id) }).then((r) => ({
      text: r.data?.text ?? '',
      ai: r.data?.ai === true,
    })),
  );

// ── bulk (HDM-UI-04) ─────────────────────────────────────────────────────

export type BulkKind = 'domains' | 'servers' | 'certificates';
export type BulkAction =
  | { action: 'link'; client_id?: number | null; project_id?: number | null }
  | { action: 'tag'; add?: string[]; remove?: string[] }
  | { action: 'owner'; owner_user_id: number | null }
  | { action: 'recheck' }
  | { action: 'remove' };
/** `POST bulk`: each row is checked on its own; the ones refused say why and the rest go ahead. */
export const bulk = (kind: BulkKind, ids: number[], a: BulkAction) =>
  request<{ done?: number; refused?: Array<{ id: number; why: string }> }>('POST', `${BASE}/bulk`, { body: { kind, ids: ids.slice(0, 500), ...a } }).then((r) => ({ done: r.data?.done ?? 0, refused: r.data?.refused ?? [], message: r.message ?? null }));
/** What each kind allows (BulkController::run). */
export const BULK_ACTIONS: Record<BulkKind, Array<BulkAction['action']>> = { domains: ['link', 'tag', 'owner', 'remove'], servers: ['link', 'tag', 'owner'], certificates: ['recheck', 'remove'] };

// ── import with a dry run (HDM-IMP-02) ───────────────────────────────────

export type ImportKind = 'domain' | 'server';
export interface ImportRow {
  line: number;
  action: 'add' | 'update' | 'skip' | 'error';
  name: string;
  fields: Record<string, unknown>;
  why: string;
}
export interface ImportPreview {
  headers: string[];
  /** Column index → field. */
  map: Record<string, string>;
  fields: string[];
  counts: { add: number; update: number; skip: number; error: number };
  rows: ImportRow[];
}
export interface ImportResult {
  added: number;
  updated: number;
  failed: number;
  skipped: number;
  errors: number;
  error_csv: string | null;
  message: string | null;
}
/** PHP sends a map with keys 0…n as a list and one with gaps as an object; both are column index → field here. */
export function mapOf(v: unknown): Record<string, string> {
  if (Array.isArray(v)) return Object.fromEntries(v.map((f, i) => [String(i), String(f)] as const).filter(([, f]) => f && f !== 'null'));
  return Object.fromEntries(Object.entries(obj(v)).filter(([, f]) => typeof f === 'string' && f).map(([k, f]) => [k, f as string]));
}
function importForm(file: { name: string; text: string }, kind: ImportKind, orgId: number, map?: Record<string, string>): FormData {
  const f = new FormData();
  f.append('file', new Blob([file.text], { type: 'text/csv' }), file.name);
  f.append('kind', kind);
  f.append('org_id', String(orgId));
  if (map && Object.keys(map).length) f.append('map', JSON.stringify(map));
  return f;
}
export async function importPreview(file: { name: string; text: string }, kind: ImportKind, orgId: number, map?: Record<string, string>): Promise<ImportPreview> {
  const r = await request<Record<string, unknown>>('POST', `${BASE}/import/preview`, { body: importForm(file, kind, orgId, map) });
  const d = obj(r.data);
  const c = obj(d.counts);
  const n = (v: unknown) => (typeof v === 'number' ? v : 0);
  return {
    headers: (Array.isArray(d.headers) ? d.headers : []).map(String),
    map: mapOf(d.map),
    fields: (Array.isArray(d.fields) ? d.fields : []).map(String),
    counts: { add: n(c.add), update: n(c.update), skip: n(c.skip), error: n(c.error) },
    rows: (Array.isArray(d.rows) ? d.rows : []) as ImportRow[],
  };
}
export async function importApply(file: { name: string; text: string }, kind: ImportKind, orgId: number, map?: Record<string, string>): Promise<ImportResult> {
  const r = await request<Record<string, unknown>>('POST', `${BASE}/import/apply`, { body: importForm(file, kind, orgId, map) });
  const d = obj(r.data);
  const n = (v: unknown) => (typeof v === 'number' ? v : 0);
  return { added: n(d.added), updated: n(d.updated), failed: n(d.failed), skipped: n(d.skipped), errors: n(d.errors), error_csv: typeof d.error_csv === 'string' ? d.error_csv : null, message: r.message ?? null };
}

// ── export, reports and print (HDM-IMP-01/03, HDM-RPT-02) ───────────────

export type ExportKind = 'domains' | 'servers' | 'certificates' | 'renewals';
/** The export's URL: the list's own filters, as a file. */
export const exportUrl = (kind: ExportKind, format: 'csv' | 'xlsx', q: Query = {}) => apiUrl(`${BASE}/export/${kind}`, { ...clean(q), format });
/** The file name the server gives (`Content-Disposition`), or one made the same way. */
export function fileNameOf(disposition: string | null, kind: string, format: string, today: string): string {
  const m = disposition ? /filename="?([^";]+)"?/i.exec(disposition) : null;
  const name = (m?.[1] ?? `hosting-${kind}-${today}.${format}`).replace(/[^A-Za-z0-9 ._-]/g, '-').slice(0, 80);
  return name;
}
/** Fetch an export: its bytes, its name and whether it is text (CSV) or a workbook. Errors say the server's sentence. */
export async function fetchExport(kind: ExportKind, format: 'csv' | 'xlsx', q: Query, today: string): Promise<{ name: string; csv: string | null; bytes: Uint8Array<ArrayBuffer> | null }> {
  const res = await fetch(exportUrl(kind, format, q), { headers: { Accept: format === 'csv' ? 'text/csv' : 'application/octet-stream' } });
  const type = res.headers.get('content-type') ?? '';
  if (!res.ok || type.includes('json')) {
    let message = `The server answered ${res.status}.`;
    try {
      const j = (await res.json()) as { message?: string };
      if (j?.message) message = j.message;
    } catch {
      /* not JSON */
    }
    throw new ApiError(res.status, res.status === 403 ? 'You may not export from Hosting. Ask for Hosting export.' : message, null);
  }
  const name = fileNameOf(res.headers.get('content-disposition'), kind, format, today);
  // The server sends CSV when it cannot build a workbook: the name it gives says which it is.
  if (type.includes('csv') || name.endsWith('.csv')) return { name: name.endsWith('.csv') ? name : `${name.replace(/\.[a-z]+$/i, '')}.csv`, csv: (await res.text()).replace(/^\uFEFF/, ''), bytes: null };
  return { name, csv: null, bytes: new Uint8Array(await res.arrayBuffer()) };
}
/** `GET print/renewals?days=` — a page that prints itself; the desktop prints it with its own dialog. */
export async function fetchPrintRenewals(days: number, org?: number): Promise<string> {
  const res = await fetch(apiUrl(`${BASE}/print/renewals`, clean({ days, org })), { headers: { Accept: 'text/html' } });
  if (!res.ok) throw new ApiError(res.status, res.status === 403 ? 'You may not print from Hosting. Ask for Hosting export.' : `The server answered ${res.status}.`, null);
  return printable(await res.text());
}
/** The server's print page without its own `onload` print and scripts: the desktop's print dialog prints it. */
export const printable = (html: string) => html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/\son[a-z]+="[^"]*"/gi, '');

// ── DNS record form: type-aware checks before anything is sent (the server checks again) ───────

export const RECORD_TYPES = ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'SRV', 'CAA'] as const;
const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
const HOST = /^(?=.{1,253}\.?$)(?:(?!-)[a-z0-9_-]{1,63}(?<!-)\.)*(?!-)[a-z0-9_-]{1,63}(?<!-)\.?$/i;

function ipv6(v: string): boolean {
  if (!/^[0-9a-f:]+$/i.test(v) || (v.match(/::/g) ?? []).length > 1) return false;
  const parts = v.split(':');
  return v.includes('::') ? parts.length <= 8 : parts.length === 8 && parts.every((p) => p.length >= 1 && p.length <= 4);
}

/** A record's host relative to the domain (`@`, `www`): the server's `host`, or worked out from the full name. */
export function hostOf(r: Pick<DnsRecord, 'host' | 'name'>, domain?: string): string {
  if (r.host) return r.host;
  const name = (r.name ?? '').replace(/\.$/, '').toLowerCase();
  if (!name || name === '@') return '@';
  if (!domain) return name;
  const d = domain.replace(/\.$/, '').toLowerCase();
  return name === d ? '@' : name.endsWith(`.${d}`) ? name.slice(0, -(d.length + 1)) : name;
}

/** What is wrong with a record, or null. Also refuses a CNAME beside other records on the same host (HDM-DNS-03). */
export function recordProblem(r: RecordInput, others: DnsRecord[] = [], domain?: string): string | null {
  const name = r.host.trim() || '@';
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
      if (!/^\d+ \d+ \d+ \S+$/.test(v)) return 'An SRV value is "priority weight port target", like 0 5 443 mail.example.com.';
      break;
    case 'CAA':
      if (!/^\d+ (issue|issuewild|iodef) "?[^"]*"?$/.test(v)) return 'A CAA value is like 0 issue "letsencrypt.org".';
      break;
  }
  const same = others.filter((o) => hostOf(o, domain).toLowerCase() === name.toLowerCase());
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
export const confirmsName = (typed: string, name: string) => typed !== '' && typed.trim() === name.trim();

export const nameservers = (v: string[] | string | null | undefined): string[] => (Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[\s,]+/).filter(Boolean) : []);

/** Whether the provider's API offers this (the row's `supports`). An empty list: nothing — a manual row. */
export const offers = (x: { supports?: string[] | null }, capability: string) => (x.supports ?? []).includes(capability);

/** "12.50" for a number the server sent; money is the server's, this only formats it. */
export const money = (amount: number | string | null | undefined, currency?: string | null) => {
  if (amount === null || amount === undefined || amount === '') return '—';
  const n = typeof amount === 'number' ? amount : Number(amount);
  const v = Number.isFinite(n) ? n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : String(amount);
  return `${currency ?? ''} ${v}`.trim();
};

/** Tags as typed: "client, internal" → ['client', 'internal']. */
export const tagsOf = (v: string) => [...new Set(v.split(/[,\n]/).map((t) => t.trim()).filter(Boolean))];

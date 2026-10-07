import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { apiDelete, apiGet, apiPost, apiPut, ApiError, request, type Query } from '../../core/api';

/**
 * The Phone module's server side: WorkSuite's Voip module at `/api/voip` (WS-VOIP-SRS-001 §3.5, 60 routes).
 *
 * Two kinds of endpoint live here, kept apart on purpose:
 *
 *  - **Built** — on every server with the Voip module today. Answers are typed exactly as the controllers write
 *    them (`CallController::history`, `ServerController::index`, …).
 *  - **Proposed** — what the SRS asks the server to add (G-03 trunks, routes, gateways, queues, ring groups, IVR;
 *    G-05 inbound routes; VOIP-RPT-05 supervision; VOIP-FWD-05 DND; VOIP-CTL-06 wrap-up; VOIP-HIS-07 call path;
 *    VOIP-EXT-09 provisioning…). The contract is in docs/BACKEND.md § Phone. They are asked through `optional()`:
 *    a server that has no such route answers 404/405/501, and the screen says plainly that this WorkSuite server
 *    does not offer it yet instead of pretending (NFR-10, "honest degradation").
 *
 * Stamps are UTC without a zone (`2026-10-02 10:41:00`); read them with `parseStamp` in lib/format.
 */

const V = '/api/voip';

/* ======================================================================== *
 * Optional endpoints
 * ======================================================================== */

export type Optional<T> = { offered: true; data: T } | { offered: false; message: string };

export const NOT_OFFERED = 'This WorkSuite server does not offer this yet. It needs a newer Voip module on the server.';

/** True when the server has no such route (as opposed to refusing, or a record that is missing). */
export function isNotOffered(e: unknown): boolean {
  return e instanceof ApiError && (e.status === 404 || e.status === 405 || e.status === 501) && (e.code === null || /route|not.?found|unknown|implement/i.test(`${e.code} ${e.message}`));
}

export async function optional<T>(p: Promise<T>): Promise<Optional<T>> {
  try {
    return { offered: true, data: await p };
  } catch (e) {
    if (isNotOffered(e)) return { offered: false, message: NOT_OFFERED };
    throw e;
  }
}

/** A list from an optional endpoint: the rows, or [] with `offered: false`. */
export function rowsOf<T>(o: Optional<T[]> | undefined): T[] {
  return o && o.offered ? o.data : [];
}

/* ======================================================================== *
 * Status, dashboard, softphone
 * ======================================================================== */

export interface Status {
  pbx: { ok: boolean; message?: string | null; version?: string | null; latency_ms?: number | null };
  counts: { extensions: number; trunks: number; gateways: number; queues: number };
  secrets: boolean;
  websocket: { path: string; domain: string };
  message: string | null;
}

export interface Channel {
  channel: string;
  state: string;
  caller: string;
  caller_name: string;
  connected: string;
  exten: string;
  context: string;
  duration: number;
  uniqueid: string;
  linkedid: string;
}

export interface Dashboard {
  active_calls: number;
  channels: Channel[];
  pbx_online: boolean;
  today: { total: number; answered: number; missed: number; avg_talk_seconds: number };
  extensions: { total: number; online: number };
  trunks: Array<{ id: number; name: string; status: string; kind: string }>;
  gateways: Array<{ id: number; name: string; status: string; channels: number }>;
  voicemail_unheard: number;
  sms_queued: number;
  low_balance_sims: number;
}

export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

/** GET /softphone — the caller's own SIP credentials (VOIP-SP-02). The secret never leaves memory. */
export interface SoftphoneCredentials {
  extension: string;
  name: string;
  secret: string;
  domain: string;
  ws_uri: string;
  ice: IceServer[];
  /** Proposed (G-02/G-06): the server the extension lives on, and when TURN credentials expire. */
  server?: { id: number; name: string } | null;
  ice_expires_at?: string | null;
}

/* ======================================================================== *
 * Extensions
 * ======================================================================== */

export type DeviceType = 'webrtc' | 'sip' | 'both';
export type RecordPolicy = 'never' | 'inbound' | 'outbound' | 'always';
export type Presence = 'offline' | 'online' | 'busy' | 'away' | 'in_meeting' | 'dnd';

export interface Extension {
  id: number;
  extension: string;
  name: string;
  user_id: number | null;
  user_name: string | null;
  caller_id: string | null;
  email: string | null;
  device_type: DeviceType;
  presence: Presence;
  dnd: boolean;
  forward_to: string | null;
  record_calls: RecordPolicy;
  voicemail: boolean;
  enabled: boolean;
  branch: string | null;
  has_secret: boolean;
  created_at: string | null;
  /** Present on servers with multi-PBX (migration …121) and the proposed shape. */
  server_id?: number | null;
  server?: string | null;
  department_id?: number | null;
  department?: string | null;
  max_contacts?: number;
  holder_kind?: 'owner' | 'shared' | 'hotdesk' | null;
  registration?: Registration | null;
  missing_on_pbx?: boolean;
}

export interface ExtensionInput {
  extension?: string;
  name?: string;
  user_id?: number | null;
  department_id?: number | null;
  caller_id?: string | null;
  email?: string | null;
  device_type?: DeviceType;
  voicemail_enabled?: boolean;
  record_calls?: RecordPolicy;
  branch?: string | null;
  enabled?: boolean;
  dnd?: boolean;
  forward_to?: string | null;
  server_id?: number | null;
  max_contacts?: number;
}

export interface CreatedExtension {
  extension: Extension;
  sip_secret: string;
  note: string;
}

export interface Registration {
  id?: number;
  extension_id: number | null;
  aor: string | null;
  contact: string | null;
  user_agent: string | null;
  ip: string | null;
  transport: string | null;
  rtt_ms: number | null;
  seen_at: string | null;
}

export interface Provisioning {
  /** A short-lived link a desk phone or SIP app reads its settings from (VOIP-EXT-09). */
  url: string;
  expires_at: string;
  username: string;
  domain: string;
  port?: number | null;
  transport?: string | null;
  ws_uri?: string | null;
}

/* ======================================================================== *
 * Calls
 * ======================================================================== */

export interface CallRow {
  id: number;
  direction: 'inbound' | 'outbound' | 'internal';
  from: string | null;
  to: string | null;
  extension: string | null;
  agent: string | null;
  queue: string | null;
  disposition: string;
  ring: number;
  talk: number;
  cost: number;
  recording_id: number | null;
  started_at: string | null;
  ended_at: string | null;
  notes: string | null;
  /** Proposed additions. */
  contact?: { id: number; name: string } | null;
  linked?: { kind: string; id: number; label: string } | null;
  trunk?: string | null;
  rated?: boolean;
  wrapup_code?: string | null;
}

export interface CallPage {
  calls: CallRow[];
  page: number;
  per_page: number;
  total: number;
}

export interface CallFilters {
  page?: number;
  per_page?: number;
  direction?: string;
  disposition?: string;
  extension_id?: number | string;
  server_id?: number | string;
  queue_id?: number | string;
  from?: string;
  to?: string;
  q?: string;
}

/** The raw call row `CallController::show` returns. */
export interface CallRecord {
  id: number;
  uniqueid: string | null;
  linkedid: string | null;
  direction: 'inbound' | 'outbound' | 'internal';
  from_number: string | null;
  to_number: string | null;
  extension_id: number | null;
  user_id: number | null;
  trunk_id: number | null;
  queue_id: number | null;
  contact_id: number | null;
  disposition: string;
  ring_seconds: number | string;
  talk_seconds: number | string;
  cost: number | string | null;
  recording_id: number | null;
  hangup_cause: string | null;
  quality_mos: number | string | null;
  started_at: string | null;
  answered_at: string | null;
  ended_at: string | null;
  notes: string | null;
  server_id?: number | null;
  wrapup_code?: string | null;
}

export interface CallNote {
  id: number;
  body: string;
  author: string | null;
  at_second: number | null;
  created_at: string;
}

export interface ScreenPop {
  number: string;
  matched: boolean;
  confidence: 'none' | 'contact' | 'account' | 'lead' | 'internal' | 'withheld';
  contact: { id: number; name: string; company: string | null; job_title: string | null; email: string | null; phone: string | null; customer_id: number | null; colour: string | null } | null;
  account: { id: number; name: string; contact: string | null; email: string | null; phone: string | null; status: string | null; industry: string | null; health: string | null } | null;
  lead: { id: number; name: string; company?: string | null; status?: string | null } | null;
  deals: Array<{ id: number; name: string; amount: number; currency: string; stage: string; close_date: string | null; open: boolean }>;
  quotes: Array<{ id: number; number: string; status: string; total: number; currency: string; valid_until: string | null }>;
  invoices: Array<{ id: number; number: string; status: string; total: number; outstanding: number; currency: string; due_date: string | null; overdue: boolean }>;
  tasks: Array<{ id: number; title: string; status: string; due: string | null }>;
  meetings: Array<{ id: number; title: string; starts: string | null }>;
  calls: Array<{ id: number; direction: string; disposition: string; seconds: number; at: string | null; agent: string | null; extension: string | null }>;
  unavailable?: string[];
}

export interface CallDetail {
  call: CallRecord;
  context: ScreenPop;
  notes: CallNote[];
}

export interface CallEvent {
  at: string;
  event: string;
  text: string;
  detail?: string | null;
}

export interface WrapupCode {
  code: string;
  label: string;
}

export type ControlAction = 'hangup' | 'transfer' | 'complete_transfer' | 'record' | 'pause_recording' | 'resume_recording' | 'stop_recording' | 'park' | 'conference';

export interface ControlResult {
  ok: boolean;
  message?: string;
  slot?: string | null;
  [k: string]: unknown;
}

/* ======================================================================== *
 * Forwarding, short codes, hot desk
 * ======================================================================== */

export type ForwardCondition = 'always' | 'busy' | 'unavailable' | 'no_answer' | 'time' | 'holiday';
export type ForwardKind = 'extension' | 'external' | 'mobile' | 'voicemail' | 'queue' | 'ring_group' | 'ivr';

export interface ForwardRule {
  id: number;
  extension_id: number | null;
  department_id: number | null;
  condition: ForwardCondition;
  destination_kind: ForwardKind;
  destination: string | null;
  ring_seconds: number;
  time_spec: string | null;
  priority: number;
  enabled: boolean;
  summary: string;
  /** Proposed: whether the rule is on the switch yet. */
  pending?: boolean;
  date_from?: string | null;
  date_to?: string | null;
}

export interface ForwardInput {
  extension_id?: number | null;
  department_id?: number | null;
  condition: ForwardCondition;
  destination_kind: ForwardKind;
  destination?: string;
  ring_seconds?: number;
  time_spec?: string;
  date_from?: string | null;
  date_to?: string | null;
  priority?: number;
}

export interface ShortCode {
  id: number;
  code: string;
  label: string | null;
  target_kind: string;
  target_id: number | null;
  target_value: string | null;
  department: string | null;
  branch: string | null;
  server: string | null;
  server_id: number | null;
  generated: boolean;
  enabled: boolean;
  resolves: boolean;
  problem: string | null;
  /** Proposed: whether the code is on the switch yet. */
  pending?: boolean;
}

export interface ShortCodeCheck {
  free: boolean;
  used_by?: string;
  what?: string;
}

/** GET /me (proposed): the person's own telephone identity in one place (W01, W07). */
export interface MyPhone {
  extensions: Extension[];
  devices: Registration[];
  caller_ids: Array<{ value: string; label: string }>;
  caller_id: string | null;
  dnd: boolean;
  sync_presence: boolean;
  presence: Presence;
  hotdesk: { extension_id: number; extension: string; since: string | null } | null;
  shared_phones: Array<{ id: number; extension: string; name: string; branch: string | null }>;
  /** Proposed with the status menu (#288): the number Away forwards calls to, when the switch knows it. */
  away_forward_to?: string | null;
}

/**
 * PUT /me/dnd (proposed, VOIP-FWD-05): Do not disturb on the switch, linked to the WorkSuite status or not. The status
 * menu (#288) also sends the status itself and when a Do not disturb ends; a server that keeps them answers them back
 * (`status`, `until`), one that keeps only Do not disturb answers `dnd`.
 */
export interface CallStatusInput {
  dnd: boolean;
  sync_presence: boolean;
  status: 'available' | 'busy' | 'dnd' | 'away';
  /** ISO, UTC; null for "until I turn it off". */
  until: string | null;
}

export interface SpeedDial {
  id: number;
  label: string;
  number: string;
  slot: number | null;
  contact_id: number | null;
  presence?: Presence | null;
}

/* ======================================================================== *
 * Recordings, voicemail, intelligence
 * ======================================================================== */

export interface Recording {
  id: number;
  kind: 'call' | 'voicemail';
  call_id: number | null;
  file_id: number | null;
  extension: string | null;
  agent: string | null;
  direction: string | null;
  from: string | null;
  to: string | null;
  category: string | null;
  duration: number;
  bytes: number;
  listened: boolean;
  retain_until: string | null;
  created_at: string;
  /** Proposed: the shared mailbox a voicemail landed in. */
  mailbox?: string | null;
}

export interface RecordingPage {
  recordings: Recording[];
  page: number;
  per_page: number;
  total: number;
  retention_note: string;
}

export interface IngestResult {
  imported: number;
  skipped: number;
  failed: number;
  detail: string[];
}

export interface RetentionResult {
  due: number;
  deleted: number;
  detail: string[];
  message: string;
}

export interface IntelligenceStatus {
  available: boolean;
  provider: string;
  reason: string | null;
  missing: string[];
}

export type AnalysisKind = 'transcript' | 'summary' | 'sentiment' | 'classification' | 'action_items' | 'keywords' | 'quality' | 'compliance';

export interface IntelligenceJob {
  kind: AnalysisKind;
  state: 'unavailable' | 'queued' | 'running' | 'done' | 'failed';
  result: string | null;
  score: number | null;
  error: string | null;
}

/* ======================================================================== *
 * PBX servers, sync
 * ======================================================================== */

export type ServerStatus = 'unknown' | 'online' | 'degraded' | 'offline' | 'maintenance' | 'disabled';

export interface Health {
  reachable: boolean;
  cpu_pct: number | null;
  memory_pct: number | null;
  disk_pct: number | null;
  active_calls: number;
  registered: number;
  endpoints_total: number;
  trunks_up: number;
  trunks_total: number;
  queued_callers: number;
  latency_ms: number | null;
  uptime_seconds: number | null;
  note: string | null;
  sampled_at: string;
}

export interface PbxServer {
  id: number;
  name: string;
  description: string | null;
  driver: 'asterisk' | 'freepbx';
  hostname: string | null;
  public_ip: string | null;
  private_ip: string | null;
  sip_domain: string | null;
  api_base: string | null;
  auth_kind: 'none' | 'oauth_client' | 'api_key' | 'basic' | 'jwt';
  client_id: string | null;
  api_user: string | null;
  ami_host: string | null;
  ami_port: number;
  ami_user: string | null;
  ari_host: string | null;
  ari_port: number;
  ari_user: string | null;
  ari_app: string | null;
  ws_url: string | null;
  stun_url: string | null;
  turn_url: string | null;
  turn_user: string | null;
  timezone: string | null;
  region: string | null;
  asterisk_version: string | null;
  freepbx_version: string | null;
  status: ServerStatus;
  status_message: string | null;
  last_seen_at: string | null;
  last_sync_at?: string | null;
  enabled: boolean;
  maintenance: boolean;
  is_default: boolean;
  sync_interval: number;
  driver_verified: boolean;
  owns_configuration: boolean;
  has_client_secret: boolean;
  has_api_key: boolean;
  has_api_password: boolean;
  has_jwt: boolean;
  has_ami_secret: boolean;
  has_ari_secret: boolean;
  has_turn_secret: boolean;
  health?: Health | null;
  extensions?: number;
}

export type ServerInput = Partial<Omit<PbxServer, 'id' | 'health' | 'extensions' | 'status' | 'status_message' | 'last_seen_at' | 'driver_verified' | 'owns_configuration' | `has_${string}`>> & {
  client_secret?: string | null;
  api_key?: string | null;
  api_password?: string | null;
  jwt?: string | null;
  ami_secret?: string | null;
  ari_secret?: string | null;
  turn_secret?: string | null;
};

export interface Mapping {
  id: number;
  scope: 'organisation' | 'branch' | 'department';
  scope_id: number | null;
  label: string | null;
  range_from: number | null;
  range_to: number | null;
  prefix: string | null;
  priority: number;
  server_id?: number;
  server?: string;
}

export interface ServerDetail {
  server: PbxServer;
  mappings: Mapping[];
  health: Array<{ sampled_at: string; reachable: boolean; active_calls: number; registered: number; latency_ms: number | null }>;
}

export interface ServerList {
  servers: PbxServer[];
  notes: { freepbx: string; secrets: string | null };
}

export interface TestResult {
  ok: boolean;
  message: string;
  channels: Array<{ channel?: string; name?: string; ok: boolean; message: string }> | Record<string, { ok: boolean; message: string }>;
  versions: { asterisk: string; freepbx: string };
}

export interface SyncRun {
  id: number;
  server: string | null;
  server_id: number;
  kind: string;
  trigger: 'manual' | 'scheduled' | 'event';
  state: 'running' | 'ok' | 'partial' | 'failed';
  examined: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  by: string | null;
  started_at: string | null;
  ended_at: string | null;
  has_detail: boolean;
}

export interface SyncRunDetail {
  run: Pick<SyncRun, 'id' | 'kind' | 'state' | 'examined' | 'created' | 'updated' | 'skipped' | 'started_at' | 'ended_at'>;
  detail: string[];
}

/* ======================================================================== *
 * Trunks, routes, gateways, SIMs, SMS (G-03, G-18 — proposed)
 * ======================================================================== */

export interface Trunk {
  id: number;
  name: string;
  provider: string | null;
  kind: 'sip' | 'gsm';
  host: string | null;
  port: number;
  username: string | null;
  has_secret: boolean;
  from_domain: string | null;
  from_user: string | null;
  registers: boolean;
  codecs: string | null;
  caller_id: string | null;
  transport: 'udp' | 'tcp' | 'tls';
  max_channels: number;
  priority: number;
  cost_per_min: number | null;
  currency?: string | null;
  gateway_id: number | null;
  status: 'unknown' | 'registered' | 'unreachable' | 'disabled';
  status_at: string | null;
  enabled: boolean;
  server_id?: number | null;
  channels_in_use?: number | null;
  calls_today?: number | null;
}

export interface OutboundRoute {
  id: number;
  name: string;
  pattern: string;
  trunk_id: number | null;
  failover_trunk_id: number | null;
  strip_digits: number;
  prepend: string | null;
  priority: number;
  kind: 'local' | 'mobile' | 'international' | 'emergency' | 'other';
  enabled: boolean;
  server_id?: number | null;
}

export interface Gateway {
  id: number;
  name: string;
  vendor: string | null;
  model: string | null;
  ip: string | null;
  port: number;
  channels: number;
  firmware: string | null;
  imei: string | null;
  status: 'unknown' | 'online' | 'offline' | 'error';
  last_seen_at: string | null;
  enabled: boolean;
  notes: string | null;
  /** Proposed (G-18): polled from the gateway's own HTTP API / status page. */
  adapter?: 'dinstar' | 'grandstream' | null;
  via?: string | null;
}

export interface SimCard {
  id: number;
  gateway_id: number | null;
  channel: number | null;
  msisdn: string | null;
  iccid: string | null;
  imsi: string | null;
  operator: string | null;
  has_pin: boolean;
  has_puk: boolean;
  balance: number | null;
  currency: string | null;
  expires_on: string | null;
  signal_dbm: number | null;
  status: 'unknown' | 'ready' | 'no_sim' | 'pin_required' | 'no_signal' | 'error';
  department_id: number | null;
  monthly_limit: number | null;
  enabled: boolean;
  last_seen_at: string | null;
}

export interface Sms {
  id: number;
  direction: 'in' | 'out';
  to_number: string | null;
  from_number: string | null;
  body: string;
  state: 'queued' | 'sending' | 'sent' | 'delivered' | 'failed' | 'received';
  error: string | null;
  contact_id: number | null;
  created_at: string;
}

export interface RouteTest {
  steps: Array<{ text: string; tone?: 'ok' | 'warn' | 'fail' }>;
  route_id: number | null;
  trunk_id: number | null;
  cost_per_min: number | null;
}

/* ======================================================================== *
 * Inbound, IVR, queues, ring groups (G-03, G-05 — proposed)
 * ======================================================================== */

export interface Destination {
  kind: 'extension' | 'queue' | 'ring_group' | 'ivr' | 'voicemail' | 'external' | 'announcement' | 'hangup';
  value: string | null;
  label?: string | null;
  /** The server says when the target no longer exists ("Ring group 640 (missing)"). */
  missing?: boolean;
}

export interface InboundRoute {
  id: number;
  did: string;
  server_id: number | null;
  trunk?: string | null;
  open_dest: Destination | null;
  closed_dest: Destination | null;
  holiday_dest: Destination | null;
  hours: string | null;
  calendar_id: number | null;
  open_now?: boolean | null;
  enabled: boolean;
}

export interface IvrFlow {
  id: number;
  name: string;
  number: string | null;
  greeting: string | null;
  greeting_file_id: number | null;
  greeting_file?: string | null;
  /** key → destination: `1`…`9`, `0`, `*`, `#`. */
  nodes: Record<string, Destination>;
  timeout: number;
  repeat?: number;
  direct_dial?: boolean;
  invalid_to: string | null;
  timeout_to: string | null;
  hours: string | null;
  enabled: boolean;
}

export interface Queue {
  id: number;
  name: string;
  number: string;
  strategy: 'ringall' | 'leastrecent' | 'fewestcalls' | 'random' | 'rrmemory' | 'linear';
  timeout: number;
  max_wait: number;
  max_callers: number;
  announce_position: boolean;
  music_class: string | null;
  overflow_to: string | null;
  sla_seconds: number;
  department_id: number | null;
  department?: string | null;
  enabled: boolean;
  wrapup_seconds?: number;
  callback_after?: number | null;
  record?: boolean;
  agents?: QueueAgent[];
  server_id?: number | null;
}

export interface QueueAgent {
  id: number;
  queue_id: number;
  extension_id: number;
  extension?: string;
  name?: string;
  penalty: number;
  skill: string | null;
  paused: boolean;
  calls_today?: number;
  talk_today?: number;
  state?: string | null;
}

export interface RingGroup {
  id: number;
  name: string;
  number: string;
  strategy: 'ringall' | 'hunt' | 'memoryhunt';
  members: string;
  timeout: number;
  fallback_to: string | null;
  enabled: boolean;
  server_id?: number | null;
}

/* ======================================================================== *
 * Reports, supervision
 * ======================================================================== */

export interface Coverage {
  known: boolean;
  samples?: number;
  reachable_pct?: number;
  message: string;
}

export interface ReportSummary {
  range: { from: string; to: string };
  totals: {
    calls: number;
    inbound: number;
    outbound: number;
    internal: number;
    answered: number;
    unanswered: number;
    answer_rate: number | null;
    talk_seconds: number;
    ring_seconds: number;
    avg_talk_seconds: number | null;
  };
  cost: { total: number; calls_priced: number } | null;
  coverage: Coverage;
}

export interface ReportVolume {
  range: { from: string; to: string };
  daily: Array<{ date: string; total: number; inbound: number; outbound: number; answered: number }>;
  hourly: Array<{ hour: number; total: number; answered: number }>;
  /** Proposed: weekday × hour for the heat map. */
  heat?: Array<{ dow: number; hour: number; total: number }>;
}

export interface ReportAgent {
  extension: string;
  name: string;
  department: string | null;
  calls: number;
  answered: number;
  inbound: number;
  outbound: number;
  talk_seconds: number;
  avg_talk_seconds: number | null;
  avg_ring_seconds: number | null;
  answer_rate: number | null;
}

export interface ReportQueue {
  name: string;
  number: string;
  calls: number;
  answered: number;
  abandoned: number;
  avg_wait_seconds: number | null;
  max_wait_seconds: number;
  sla_seconds: number;
  sla_rate: number | null;
  live: { waiting: number; holdtime: number; members: number } | null;
}

export interface ReportDepartment {
  department: string | null;
  calls: number;
  answered: number;
  talk_seconds: number;
  cost: number | null;
}

export interface LiveServer {
  server_id: number;
  server: string;
  ok: boolean;
  message: string | null;
  channels: Channel[];
}

export type AgentState = 'free' | 'on_call' | 'ringing' | 'wrapup' | 'paused' | 'offline';

/** GET /supervisor/board (proposed, VOIP-RPT-05). */
export interface Board {
  queues: Array<{ id: number; name: string; number: string; strategy: string; agents: number; waiting: number; longest_wait: number; free: number; logged_in: number; sla_rate: number | null; sla_seconds: number }>;
  agents: Array<{ extension_id: number; extension: string; name: string; state: AgentState; since_seconds: number; detail: string | null; queue: string | null }>;
  calls: Array<{ channel: string; started_seconds: number; agent: string | null; extension: string | null; other: string; queue: string | null; direction: string }>;
  totals: { calls_now: number; external: number; internal: number; waiting: number; longest_wait: number; agents_free: number; agents_total: number; agents_paused: number; answered_today: number; answer_rate: number | null; abandoned_today: number; avg_abandon_wait: number | null };
}

export type SuperviseMode = 'listen' | 'whisper' | 'barge';

/* ======================================================================== *
 * Settings
 * ======================================================================== */

export type Settings = Record<string, string>;

/* ======================================================================== *
 * Fetchers
 * ======================================================================== */

export const phoneApi = {
  /* status */
  status: (signal?: AbortSignal) => apiGet<Status>(`${V}/status`, undefined, signal),
  dashboard: (signal?: AbortSignal) => apiGet<Dashboard>(`${V}/dashboard`, undefined, signal),
  softphone: (signal?: AbortSignal) => apiGet<SoftphoneCredentials>(`${V}/softphone`, undefined, signal),

  /* me (proposed) */
  me: (signal?: AbortSignal) => optional(apiGet<MyPhone>(`${V}/me`, undefined, signal)),
  setCallStatus: (input: CallStatusInput) => apiPut<{ dnd: boolean; status?: string | null; until?: string | null; message?: string }>(`${V}/me/dnd`, input),
  setCallerId: (value: string) => apiPut<{ caller_id: string }>(`${V}/me/caller-id`, { caller_id: value }),
  speedDials: (signal?: AbortSignal) => optional(apiGet<{ speed_dials: SpeedDial[] }>(`${V}/speed-dials`, undefined, signal).then((r) => r.speed_dials)),
  addSpeedDial: (input: Omit<SpeedDial, 'id' | 'presence'>) => apiPost<{ id: number }>(`${V}/speed-dials`, input),
  deleteSpeedDial: (id: number) => apiDelete(`${V}/speed-dials/${id}`),

  /* extensions */
  extensions: (signal?: AbortSignal) => apiGet<{ extensions: Extension[] }>(`${V}/extensions`, undefined, signal).then((r) => r.extensions),
  createExtension: (input: ExtensionInput) => apiPost<CreatedExtension>(`${V}/extensions`, input),
  updateExtension: (id: number, input: ExtensionInput) => apiPut<{ extension: Extension }>(`${V}/extensions/${id}`, input),
  deleteExtension: (id: number) => apiDelete<{ deleted: boolean }>(`${V}/extensions/${id}`),
  regenerateSecret: (id: number) => apiPost<{ sip_secret: string; note: string }>(`${V}/extensions/${id}/secret`),
  assign: (id: number, userId: number | null, kind: 'owner' | 'shared' | 'hotdesk') => apiPost<{ message: string }>(`${V}/extensions/${id}/assign`, { user_id: userId, kind }),
  allocate: (input: { server_id?: number | null; department_id?: number | null; branch?: string | null }) => apiPost<{ extension: string }>(`${V}/extensions/allocate`, input),
  hotdesk: (extensionId: number) => apiPost<{ message: string }>(`${V}/hotdesk`, { extension_id: extensionId }),
  hotdeskLogout: () => apiPost<{ message: string }>(`${V}/hotdesk`, { logout: true }),
  provisioning: (id: number) => apiPost<Provisioning>(`${V}/extensions/${id}/provisioning`),
  setupEmail: (id: number) => apiPost<{ message: string }>(`${V}/extensions/${id}/setup-email`),
  importExtensions: (rows: ExtensionInput[]) => apiPost<{ created: number; skipped: number; detail: string[] }>(`${V}/extensions/import`, { rows }),
  registrations: (signal?: AbortSignal) => optional(apiGet<{ registrations: Registration[] }>(`${V}/registrations`, undefined, signal).then((r) => r.registrations)),
  hrProvision: () => apiPost<{ created: number; message: string }>(`${V}/extensions/provision-hr`),

  /* calls */
  dial: (number: string, context?: { contact_id?: number; record_type?: string; record_id?: number; caller_id?: string }) =>
    apiPost<{ call_id: number; message: string; channel: string; context: ScreenPop }>(`${V}/call`, { number, ...context }),
  control: (action: ControlAction, input: { channel?: string; to?: string; with?: string; channels?: string[]; name?: string; beep?: boolean }) =>
    apiPost<ControlResult>(`${V}/calls/control`, { action, ...input }),
  screenPop: (number: string, signal?: AbortSignal) => apiGet<{ context: ScreenPop }>(`${V}/screen-pop`, { number }, signal).then((r) => r.context),
  history: (f: CallFilters, signal?: AbortSignal) => apiGet<CallPage>(`${V}/calls`, f as Query, signal),
  call: (id: number, signal?: AbortSignal) => apiGet<CallDetail>(`${V}/calls/${id}`, undefined, signal),
  addNote: (id: number, body: string, atSecond?: number | null) => apiPost<{ id: number }>(`${V}/calls/${id}/notes`, { body, at_second: atSecond ?? undefined }),
  events: (id: number, signal?: AbortSignal) => optional(apiGet<{ events: CallEvent[] }>(`${V}/calls/${id}/events`, undefined, signal).then((r) => r.events)),
  wrapupCodes: (signal?: AbortSignal) => optional(apiGet<{ codes: WrapupCode[] }>(`${V}/wrapup-codes`, undefined, signal).then((r) => r.codes)),
  wrapup: (id: number, code: string) => apiPost<{ message?: string }>(`${V}/calls/${id}/wrapup`, { code }),
  live: (signal?: AbortSignal) => apiGet<{ servers: LiveServer[] }>(`${V}/live`, undefined, signal).then((r) => r.servers),

  /* forwarding, short codes */
  forwards: (extensionId?: number | null, signal?: AbortSignal) =>
    apiGet<{ forwards: ForwardRule[] }>(`${V}/forwards`, extensionId ? { extension_id: extensionId } : undefined, signal).then((r) => r.forwards),
  createForward: (input: ForwardInput) => apiPost<{ id: number; message: string }>(`${V}/forwards`, input),
  deleteForward: (id: number) => apiDelete<{ deleted: boolean }>(`${V}/forwards/${id}`),
  updateForward: (id: number, input: Partial<ForwardInput> & { enabled?: boolean }) => apiPut<{ message?: string }>(`${V}/forwards/${id}`, input),
  shortCodes: (signal?: AbortSignal) => apiGet<{ short_codes: ShortCode[] }>(`${V}/short-codes`, undefined, signal).then((r) => r.short_codes),
  checkShortCode: (code: string, serverId?: number | null, signal?: AbortSignal) => apiGet<ShortCodeCheck>(`${V}/short-codes/check`, { code, server_id: serverId ?? undefined }, signal),
  createShortCode: (input: { code?: string; prefix?: string; width?: number; label?: string; target_kind: string; target_id?: number | null; target_value?: string | null; server_id?: number | null; department_id?: number | null }) =>
    apiPost<{ id: number; code: string; message: string }>(`${V}/short-codes`, input),
  updateShortCode: (id: number, input: Partial<{ code: string; label: string | null; target_kind: string; target_id: number | null; target_value: string | null; enabled: boolean }>) =>
    apiPut<{ message: string }>(`${V}/short-codes/${id}`, input),
  deleteShortCode: (id: number) => apiDelete<{ deleted: boolean }>(`${V}/short-codes/${id}`),

  /* recordings, voicemail, intelligence */
  recordings: (q: { kind?: 'call' | 'voicemail'; page?: number; per_page?: number; category?: string; unlinked?: boolean; mailbox?: string }, signal?: AbortSignal) =>
    apiGet<RecordingPage>(`${V}/recordings`, q as Query, signal),
  play: (id: number) => apiGet<{ url: string; duration: number }>(`${V}/recordings/${id}/play`),
  ingest: () => apiPost<IngestResult>(`${V}/recordings/ingest`),
  retention: (confirm: boolean) => apiPost<RetentionResult>(`${V}/recordings/retention`, confirm ? { confirm: 'delete' } : {}),
  markHeard: (id: number, heard = true) => apiPost<{ listened: boolean }>(`${V}/voicemail/${id}/heard`, { heard }),
  deleteRecording: (id: number) => apiDelete<{ deleted: boolean }>(`${V}/recordings/${id}`),
  forwardVoicemail: (id: number, extensionId: number) => apiPost<{ message: string }>(`${V}/voicemail/${id}/forward`, { extension_id: extensionId }),
  intelligenceStatus: (signal?: AbortSignal) => apiGet<IntelligenceStatus>(`${V}/intelligence/status`, undefined, signal),
  intelligence: (callId: number, signal?: AbortSignal) => apiGet<{ status: IntelligenceStatus; jobs: IntelligenceJob[] }>(`${V}/calls/${callId}/intelligence`, undefined, signal),
  analyse: (callId: number, kind: AnalysisKind) => apiPost<{ ok: boolean; state: string; message?: string; jobs: IntelligenceJob[] }>(`${V}/calls/${callId}/analyse`, { kind }),

  /* servers */
  servers: (signal?: AbortSignal) => apiGet<ServerList>(`${V}/servers`, undefined, signal),
  server: (id: number, signal?: AbortSignal) => apiGet<ServerDetail>(`${V}/servers/${id}`, undefined, signal),
  createServer: (input: ServerInput) => apiPost<{ server: PbxServer }>(`${V}/servers`, input),
  updateServer: (id: number, input: ServerInput) => apiPut<{ server: PbxServer }>(`${V}/servers/${id}`, input),
  deleteServer: (id: number) => apiDelete<{ deleted: boolean; detached: number; message: string }>(`${V}/servers/${id}`),
  testServer: (id: number) => apiPost<TestResult>(`${V}/servers/${id}/test`),
  sampleHealth: (id: number) => apiPost<{ sample: Health }>(`${V}/servers/${id}/health`),
  applyServer: (id: number) => apiPost<{ ok: boolean; message: string; detail: string[] }>(`${V}/servers/${id}/apply`),
  maintenance: (id: number, on: boolean) => apiPost<{ maintenance: boolean; message: string }>(`${V}/servers/${id}/maintenance`, { on }),
  addMapping: (id: number, input: Omit<Mapping, 'id' | 'server_id' | 'server'>) => apiPost<{ id: number }>(`${V}/servers/${id}/mappings`, input),
  deleteMapping: (id: number) => apiDelete<{ deleted: boolean }>(`${V}/mappings/${id}`),
  mappings: (signal?: AbortSignal) => optional(apiGet<{ mappings: Mapping[] }>(`${V}/mappings`, undefined, signal).then((r) => r.mappings)),

  /* sync */
  sync: (serverId: number, kind = 'full') => apiPost<{ run_id?: number; state: string; counts?: Record<string, number>; detail?: string[]; message?: string }>(`${V}/servers/${serverId}/sync`, { kind }),
  syncRuns: (serverId?: number | null, signal?: AbortSignal) => apiGet<{ runs: SyncRun[] }>(`${V}/sync-runs`, serverId ? { server_id: serverId } : undefined, signal).then((r) => r.runs),
  syncRun: (id: number, signal?: AbortSignal) => apiGet<SyncRunDetail>(`${V}/sync-runs/${id}`, undefined, signal),
  syncDue: () => apiPost<{ ran: number; message: string }>(`${V}/sync/due`),

  /* config */
  config: (serverId?: number | null, signal?: AbortSignal) =>
    apiGet<{ files: Record<string, string>; applied?: Record<string, string> | null; pending?: number | null; applied_at?: string | null }>(`${V}/config`, serverId ? { server_id: serverId } : undefined, signal),
  applyConfig: () => apiPost<{ written: string[]; reloaded: boolean; message: string }>(`${V}/config/apply`),
  settings: (signal?: AbortSignal) => apiGet<{ settings: Settings }>(`${V}/settings`, undefined, signal).then((r) => r.settings),
  saveSettings: (s: Settings) => apiPut<{ saved: boolean; pbx: { ok: boolean; message?: string } }>(`${V}/settings`, s),

  /* reports */
  summary: (range: { from: string; to: string; org_id?: number | null }, signal?: AbortSignal) => apiGet<ReportSummary>(`${V}/reports/summary`, range, signal),
  volume: (range: { from: string; to: string; org_id?: number | null }, signal?: AbortSignal) => apiGet<ReportVolume>(`${V}/reports/volume`, range, signal),
  agents: (range: { from: string; to: string; org_id?: number | null }, signal?: AbortSignal) => apiGet<{ agents: ReportAgent[] }>(`${V}/reports/agents`, range, signal).then((r) => r.agents),
  queues: (range: { from: string; to: string; org_id?: number | null }, signal?: AbortSignal) => apiGet<{ queues: ReportQueue[] }>(`${V}/reports/queues`, range, signal).then((r) => r.queues),
  departments: (range: { from: string; to: string; org_id?: number | null }, signal?: AbortSignal) =>
    apiGet<{ departments: ReportDepartment[] }>(`${V}/reports/departments`, range, signal).then((r) => r.departments),

  /* supervision (proposed) */
  board: (serverId?: number | null, signal?: AbortSignal) => optional(apiGet<Board>(`${V}/supervisor/board`, serverId ? { server_id: serverId } : undefined, signal)),
  supervise: (channel: string, mode: SuperviseMode) => apiPost<{ ok: boolean; message: string; session_id?: string }>(`${V}/supervise`, { channel, mode }),
  stopSupervising: (sessionId?: string | null) => apiPost<{ ok: boolean }>(`${V}/supervise/stop`, { session_id: sessionId ?? undefined }),
  pauseAgent: (queueId: number | null, extensionId: number, paused: boolean, reason?: string) =>
    apiPost<{ ok: boolean; message?: string }>(`${V}/queues/${queueId ?? 'all'}/pause`, { extension_id: extensionId, paused, reason }),

  /* trunks, routes, gateways, SIMs, SMS (proposed) */
  trunks: (signal?: AbortSignal) => optional(apiGet<{ trunks: Trunk[] }>(`${V}/trunks`, undefined, signal).then((r) => r.trunks)),
  saveTrunk: (id: number | null, input: Partial<Trunk> & { secret?: string | null }) => (id ? apiPut<{ trunk: Trunk }>(`${V}/trunks/${id}`, input) : apiPost<{ trunk: Trunk }>(`${V}/trunks`, input)),
  deleteTrunk: (id: number) => apiDelete(`${V}/trunks/${id}`),
  routes: (signal?: AbortSignal) => optional(apiGet<{ routes: OutboundRoute[] }>(`${V}/routes`, undefined, signal).then((r) => r.routes)),
  saveRoute: (id: number | null, input: Partial<OutboundRoute>) => (id ? apiPut<{ route: OutboundRoute }>(`${V}/routes/${id}`, input) : apiPost<{ route: OutboundRoute }>(`${V}/routes`, input)),
  deleteRoute: (id: number) => apiDelete(`${V}/routes/${id}`),
  reorderRoutes: (ids: number[]) => apiPost(`${V}/routes/order`, { ids }),
  testRoute: (number: string, extension?: string | null) => optional(apiPost<RouteTest>(`${V}/routes/test`, { number, extension: extension ?? undefined })),
  gateways: (signal?: AbortSignal) => optional(apiGet<{ gateways: Gateway[] }>(`${V}/gateways`, undefined, signal).then((r) => r.gateways)),
  saveGateway: (id: number | null, input: Partial<Gateway> & { admin_password?: string | null }) =>
    id ? apiPut<{ gateway: Gateway }>(`${V}/gateways/${id}`, input) : apiPost<{ gateway: Gateway }>(`${V}/gateways`, input),
  pollGateway: (id: number) => apiPost<{ gateway: Gateway; sims: SimCard[]; message?: string }>(`${V}/gateways/${id}/poll`),
  deleteGateway: (id: number) => apiDelete(`${V}/gateways/${id}`),
  sims: (signal?: AbortSignal) => optional(apiGet<{ sims: SimCard[] }>(`${V}/sim-cards`, undefined, signal).then((r) => r.sims)),
  saveSim: (id: number | null, input: Partial<SimCard> & { pin?: string | null; puk?: string | null }) =>
    id ? apiPut<{ sim: SimCard }>(`${V}/sim-cards/${id}`, input) : apiPost<{ sim: SimCard }>(`${V}/sim-cards`, input),
  sms: (q: { contact_id?: number; page?: number } = {}, signal?: AbortSignal) => optional(apiGet<{ messages: Sms[] }>(`${V}/sms`, q as Query, signal).then((r) => r.messages)),
  sendSms: (to: string, body: string, simId?: number | null, contactId?: number | null) => apiPost<{ sms: Sms }>(`${V}/sms`, { to, body, sim_id: simId ?? undefined, contact_id: contactId ?? undefined }),

  /* inbound, IVR, queues, ring groups (proposed except the lists sync fills) */
  inbound: (signal?: AbortSignal) => optional(apiGet<{ routes: InboundRoute[] }>(`${V}/inbound-routes`, undefined, signal).then((r) => r.routes)),
  saveInbound: (id: number | null, input: Partial<InboundRoute>) =>
    id ? apiPut<{ route: InboundRoute }>(`${V}/inbound-routes/${id}`, input) : apiPost<{ route: InboundRoute }>(`${V}/inbound-routes`, input),
  deleteInbound: (id: number) => apiDelete(`${V}/inbound-routes/${id}`),
  ivrs: (signal?: AbortSignal) => optional(apiGet<{ flows: IvrFlow[] }>(`${V}/ivr-flows`, undefined, signal).then((r) => r.flows)),
  saveIvr: (id: number | null, input: Partial<IvrFlow>) => (id ? apiPut<{ flow: IvrFlow }>(`${V}/ivr-flows/${id}`, input) : apiPost<{ flow: IvrFlow }>(`${V}/ivr-flows`, input)),
  deleteIvr: (id: number) => apiDelete(`${V}/ivr-flows/${id}`),
  queuesList: (signal?: AbortSignal) => optional(apiGet<{ queues: Queue[] }>(`${V}/queues`, undefined, signal).then((r) => r.queues)),
  saveQueue: (id: number | null, input: Partial<Queue>) => (id ? apiPut<{ queue: Queue }>(`${V}/queues/${id}`, input) : apiPost<{ queue: Queue }>(`${V}/queues`, input)),
  deleteQueue: (id: number) => apiDelete(`${V}/queues/${id}`),
  addQueueAgent: (queueId: number, input: { extension_id: number; penalty?: number; skill?: string | null }) => apiPost<{ agent: QueueAgent }>(`${V}/queues/${queueId}/agents`, input),
  updateQueueAgent: (queueId: number, agentId: number, input: Partial<Pick<QueueAgent, 'penalty' | 'skill' | 'paused'>>) => apiPut(`${V}/queues/${queueId}/agents/${agentId}`, input),
  removeQueueAgent: (queueId: number, agentId: number) => apiDelete(`${V}/queues/${queueId}/agents/${agentId}`),
  ringGroups: (signal?: AbortSignal) => optional(apiGet<{ ring_groups: RingGroup[] }>(`${V}/ring-groups`, undefined, signal).then((r) => r.ring_groups)),
  saveRingGroup: (id: number | null, input: Partial<RingGroup>) =>
    id ? apiPut<{ ring_group: RingGroup }>(`${V}/ring-groups/${id}`, input) : apiPost<{ ring_group: RingGroup }>(`${V}/ring-groups`, input),
  deleteRingGroup: (id: number) => apiDelete(`${V}/ring-groups/${id}`),
};

/** The server's own sentence about what it did ("Saved. Apply the configuration to make it live."), when it sent one. */
export async function withMessage<T>(method: 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown): Promise<{ data: T; message: string | null }> {
  const r = await request<T>(method, path, { body });
  const inner = (r.data as { message?: unknown } | null)?.message;
  return { data: r.data, message: typeof inner === 'string' ? inner : (r.message ?? null) };
}

/* ======================================================================== *
 * Query keys and hooks
 * ======================================================================== */

export const PK = {
  all: ['phone'] as const,
  status: ['phone', 'status'] as const,
  dashboard: ['phone', 'dashboard'] as const,
  me: ['phone', 'me'] as const,
  speedDials: ['phone', 'speed-dials'] as const,
  extensions: ['phone', 'extensions'] as const,
  registrations: ['phone', 'registrations'] as const,
  history: (f: CallFilters) => ['phone', 'calls', f] as const,
  call: (id: number) => ['phone', 'call', id] as const,
  events: (id: number) => ['phone', 'call', id, 'events'] as const,
  intelligence: (id: number) => ['phone', 'call', id, 'intelligence'] as const,
  wrapupCodes: ['phone', 'wrapup-codes'] as const,
  forwards: (ext: number | null | undefined) => ['phone', 'forwards', ext ?? 'all'] as const,
  shortCodes: ['phone', 'short-codes'] as const,
  recordings: (q: object) => ['phone', 'recordings', q] as const,
  intelligenceStatus: ['phone', 'intelligence-status'] as const,
  servers: ['phone', 'servers'] as const,
  server: (id: number) => ['phone', 'server', id] as const,
  mappings: ['phone', 'mappings'] as const,
  syncRuns: (s: number | null | undefined) => ['phone', 'sync-runs', s ?? 'all'] as const,
  syncRun: (id: number) => ['phone', 'sync-run', id] as const,
  config: (s: number | null | undefined) => ['phone', 'config', s ?? 'all'] as const,
  settings: ['phone', 'settings'] as const,
  report: (kind: string, range: object) => ['phone', 'report', kind, range] as const,
  live: ['phone', 'live'] as const,
  board: (s: number | null | undefined) => ['phone', 'board', s ?? 'all'] as const,
  trunks: ['phone', 'trunks'] as const,
  routes: ['phone', 'routes'] as const,
  gateways: ['phone', 'gateways'] as const,
  sims: ['phone', 'sims'] as const,
  inbound: ['phone', 'inbound'] as const,
  ivrs: ['phone', 'ivrs'] as const,
  queues: ['phone', 'queues'] as const,
  ringGroups: ['phone', 'ring-groups'] as const,
  screenPop: (n: string) => ['phone', 'screen-pop', n] as const,
};

export function invalidatePhone(qc: QueryClient, ...keys: Array<readonly unknown[]>): void {
  for (const k of keys.length ? keys : [PK.all]) void qc.invalidateQueries({ queryKey: k });
}

export function useInvalidate(): (...keys: Array<readonly unknown[]>) => void {
  const qc = useQueryClient();
  return (...keys) => invalidatePhone(qc, ...keys);
}

/** Is there a phone system at all? Asked first; everything else depends on it (VOIP-SP-05). */
export function useStatus() {
  return useQuery({ queryKey: PK.status, queryFn: ({ signal }) => phoneApi.status(signal), staleTime: 30_000, refetchInterval: 60_000 });
}

export function useDashboard() {
  return useQuery({ queryKey: PK.dashboard, queryFn: ({ signal }) => phoneApi.dashboard(signal), staleTime: 15_000, refetchInterval: 30_000 });
}

export function useMe() {
  return useQuery({ queryKey: PK.me, queryFn: ({ signal }) => phoneApi.me(signal), staleTime: 30_000 });
}

export function useSpeedDials() {
  return useQuery({ queryKey: PK.speedDials, queryFn: ({ signal }) => phoneApi.speedDials(signal), staleTime: 60_000 });
}

export function useExtensions() {
  return useQuery({ queryKey: PK.extensions, queryFn: ({ signal }) => phoneApi.extensions(signal), staleTime: 30_000 });
}

export function useRegistrations() {
  return useQuery({ queryKey: PK.registrations, queryFn: ({ signal }) => phoneApi.registrations(signal), staleTime: 30_000 });
}

export function useHistory(f: CallFilters) {
  return useQuery({ queryKey: PK.history(f), queryFn: ({ signal }) => phoneApi.history(f, signal), placeholderData: (prev) => prev });
}

export function useCall(id: number | null) {
  return useQuery({ queryKey: PK.call(id ?? 0), queryFn: ({ signal }) => phoneApi.call(id!, signal), enabled: !!id });
}

export function useCallEvents(id: number | null) {
  return useQuery({ queryKey: PK.events(id ?? 0), queryFn: ({ signal }) => phoneApi.events(id!, signal), enabled: !!id });
}

export function useCallIntelligence(id: number | null) {
  return useQuery({ queryKey: PK.intelligence(id ?? 0), queryFn: ({ signal }) => phoneApi.intelligence(id!, signal), enabled: !!id });
}

export function useWrapupCodes() {
  return useQuery({ queryKey: PK.wrapupCodes, queryFn: ({ signal }) => phoneApi.wrapupCodes(signal), staleTime: 5 * 60_000 });
}

export function useForwards(extensionId: number | null | undefined, enabled = true) {
  return useQuery({ queryKey: PK.forwards(extensionId), queryFn: ({ signal }) => phoneApi.forwards(extensionId, signal), enabled });
}

export function useShortCodes() {
  return useQuery({ queryKey: PK.shortCodes, queryFn: ({ signal }) => phoneApi.shortCodes(signal) });
}

export function useRecordings(q: { kind?: 'call' | 'voicemail'; page?: number; per_page?: number; unlinked?: boolean; mailbox?: string }) {
  return useQuery({ queryKey: PK.recordings(q), queryFn: ({ signal }) => phoneApi.recordings(q, signal), placeholderData: (prev) => prev });
}

export function useIntelligenceStatus() {
  return useQuery({ queryKey: PK.intelligenceStatus, queryFn: ({ signal }) => phoneApi.intelligenceStatus(signal), staleTime: 5 * 60_000 });
}

export function useServers(enabled = true) {
  return useQuery({ queryKey: PK.servers, queryFn: ({ signal }) => phoneApi.servers(signal), enabled, refetchInterval: 60_000 });
}

export function useServer(id: number | null) {
  return useQuery({ queryKey: PK.server(id ?? 0), queryFn: ({ signal }) => phoneApi.server(id!, signal), enabled: !!id });
}

export function useSyncRuns(serverId?: number | null) {
  return useQuery({ queryKey: PK.syncRuns(serverId), queryFn: ({ signal }) => phoneApi.syncRuns(serverId, signal), refetchInterval: 30_000 });
}

export function useSyncRun(id: number | null) {
  return useQuery({ queryKey: PK.syncRun(id ?? 0), queryFn: ({ signal }) => phoneApi.syncRun(id!, signal), enabled: !!id });
}

export function useConfig(serverId?: number | null) {
  return useQuery({ queryKey: PK.config(serverId), queryFn: ({ signal }) => phoneApi.config(serverId, signal) });
}

export function useSettings(enabled = true) {
  return useQuery({ queryKey: PK.settings, queryFn: ({ signal }) => phoneApi.settings(signal), enabled });
}

export function useLive(enabled = true) {
  return useQuery({ queryKey: PK.live, queryFn: ({ signal }) => phoneApi.live(signal), enabled, refetchInterval: 2_000 });
}

export function useBoard(serverId?: number | null) {
  return useQuery({ queryKey: PK.board(serverId), queryFn: ({ signal }) => phoneApi.board(serverId, signal), refetchInterval: 2_000 });
}

export function useTrunks() {
  return useQuery({ queryKey: PK.trunks, queryFn: ({ signal }) => phoneApi.trunks(signal) });
}

export function useRoutes() {
  return useQuery({ queryKey: PK.routes, queryFn: ({ signal }) => phoneApi.routes(signal) });
}

export function useGateways() {
  return useQuery({ queryKey: PK.gateways, queryFn: ({ signal }) => phoneApi.gateways(signal), refetchInterval: 60_000 });
}

export function useSims() {
  return useQuery({ queryKey: PK.sims, queryFn: ({ signal }) => phoneApi.sims(signal), refetchInterval: 60_000 });
}

export function useInbound() {
  return useQuery({ queryKey: PK.inbound, queryFn: ({ signal }) => phoneApi.inbound(signal) });
}

export function useIvrs() {
  return useQuery({ queryKey: PK.ivrs, queryFn: ({ signal }) => phoneApi.ivrs(signal) });
}

export function useQueues() {
  return useQuery({ queryKey: PK.queues, queryFn: ({ signal }) => phoneApi.queuesList(signal) });
}

export function useRingGroups() {
  return useQuery({ queryKey: PK.ringGroups, queryFn: ({ signal }) => phoneApi.ringGroups(signal) });
}

export function useScreenPop(number: string | null | undefined) {
  const n = (number ?? '').trim();
  return useQuery({ queryKey: PK.screenPop(n), queryFn: ({ signal }) => phoneApi.screenPop(n, signal), enabled: n.length >= 3, staleTime: 60_000 });
}

export type ReportRange = { from: string; to: string; org_id?: number | null };

export function useSummary(range: ReportRange, enabled = true) {
  return useQuery({ queryKey: PK.report('summary', range), queryFn: ({ signal }) => phoneApi.summary(range, signal), enabled });
}

export function useVolume(range: ReportRange, enabled = true) {
  return useQuery({ queryKey: PK.report('volume', range), queryFn: ({ signal }) => phoneApi.volume(range, signal), enabled });
}

export function useAgentReport(range: ReportRange, enabled = true) {
  return useQuery({ queryKey: PK.report('agents', range), queryFn: ({ signal }) => phoneApi.agents(range, signal), enabled });
}

export function useQueueReport(range: ReportRange, enabled = true) {
  return useQuery({ queryKey: PK.report('queues', range), queryFn: ({ signal }) => phoneApi.queues(range, signal), enabled });
}

export function useDepartmentReport(range: ReportRange, enabled = true) {
  return useQuery({ queryKey: PK.report('departments', range), queryFn: ({ signal }) => phoneApi.departments(range, signal), enabled });
}

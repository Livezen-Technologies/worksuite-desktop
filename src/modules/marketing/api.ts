import { useQuery } from '@tanstack/react-query';
import { ApiError, apiDelete, apiGet, apiPost, apiPut, apiUrl, request, type Query } from '../../core/api';
import { useMarketingOrg } from './org';

/**
 * The Marketing module's server side: WorkSuite's Marketing module (`app/Modules/Marketing`) at `/api/marketing`
 * (WS-MKT-SRS-001 v1.1 §7.1 — the Audience, Consent, Email and Calls API groups, 91 authenticated routes).
 *
 * Two kinds of endpoint live here, kept apart on purpose:
 *
 *  - **Built** — the SRS's "Built" requirements (contacts, lists, segments, import, consent ledger, suppression,
 *    topics, campaigns, content, checks, tests, scheduling, reports, call campaigns, the queue, scripts, settings).
 *  - **Target** — what the SRS asks the server to add (MKT-DSH-02 readiness, MKT-AUD-08/09 merge and erase,
 *    MKT-SEG-08 snapshots, MKT-IMP-04/06 rejected rows and background import, MKT-CON-07 ledger export,
 *    MKT-SUP-05 removal with a reason, MKT-EDT-06 versions, MKT-ABT-03 click winner, MKT-CAL-12/15 callbacks
 *    and the live board, MKT-ANL-01 analytics, MKT-AUT-* journeys). They are asked through `optional()`: a server
 *    that has no such route answers 404/405/501, and the screen says plainly that this WorkSuite server does not
 *    offer it yet instead of pretending.
 *
 * The contract, with the answers' shapes, is in docs/BACKEND.md § Marketing. Every read names the company (`org`)
 * as the web does; the server scopes to the session's company anyway and answers 404 for a record outside it
 * (constraint C5). Stamps are UTC without a zone (`2026-10-02 10:41:00`); read them with `parseStamp` in lib/format.
 */

export const M = '/api/marketing';

/* ======================================================================== *
 * Optional endpoints and pages
 * ======================================================================== */

export type Optional<T> = { offered: true; data: T } | { offered: false; message: string };

export const NOT_OFFERED = 'This WorkSuite server does not offer this yet. It needs a newer Marketing module on the server.';

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

/** A page of rows, whatever paginator shape the server used. */
export interface Page<T> {
  rows: T[];
  total: number;
  page: number;
  pages: number;
  perPage: number;
  /** Counts the list answers alongside its rows (campaigns by status, suppressions by type). */
  counts: Record<string, number>;
}

const num = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : d);

/**
 * Laravel's paginator (`{data, current_page, last_page, per_page, total}`), a `{items|rows|data, meta}` answer, or
 * a bare array (one page with everything).
 */
export function pageOf<T>(raw: unknown): Page<T> {
  if (Array.isArray(raw)) return { rows: raw as T[], total: raw.length, page: 1, pages: 1, perPage: raw.length, counts: {} };
  const o = (raw ?? {}) as Record<string, unknown>;
  const rows = (Array.isArray(o.data) ? o.data : Array.isArray(o.items) ? o.items : Array.isArray(o.rows) ? o.rows : []) as T[];
  const meta = (o.meta && typeof o.meta === 'object' ? o.meta : o) as Record<string, unknown>;
  const perPage = num(meta.per_page, rows.length || 25);
  const total = num(meta.total, rows.length);
  const counts: Record<string, number> = {};
  const c = (o.counts ?? meta.counts) as Record<string, unknown> | undefined;
  if (c && typeof c === 'object') for (const [k, v] of Object.entries(c)) counts[k] = num(v);
  return {
    rows,
    total,
    page: num(meta.current_page, 1),
    pages: Math.max(1, num(meta.last_page, perPage > 0 ? Math.ceil(total / perPage) : 1)),
    perPage,
    counts,
  };
}

const withOrg = (org: string, q: Query = {}): Query => (org ? { org, ...q } : q);

/* ======================================================================== *
 * Shared shapes
 * ======================================================================== */

export interface Ref {
  id: number;
  name: string;
}

/** Email consent, derived from the latest ledger row (SRS §6.3). `pending` is double opt-in (Target). */
export type EmailConsent = 'unknown' | 'pending' | 'subscribed' | 'unsubscribed' | 'bounced';
/** Phone consent. Do-not-call is a suppression, shown with it. */
export type PhoneConsent = 'unknown' | 'consented' | 'withdrawn';
export type Channel = 'email' | 'phone';
/** A lawful basis recorded with a consent change (WF-05). */
export type Basis = 'consent' | 'legitimate_interest' | 'contract' | 'existing_customer' | 'verbal' | 'web_form' | 'import' | 'preference_centre' | 'unknown';

/* ======================================================================== *
 * Dashboard and readiness (MKT-DSH-01/02)
 * ======================================================================== */

export interface Dashboard {
  contacts: { total: number; added_this_month: number };
  email_subscribed: { count: number; share: number | null };
  /** Human opens over delivered, machine opens excluded (MKT-TRK-02). 0..100. */
  human_open_rate: number | null;
  bounce_rate: number | null;
  bounce_guard_threshold: number;
  weekly: Array<{ week: string; delivered: number; human_opens: number }>;
  recent_campaigns: Campaign[];
  calls: { in_queue: number; claimed_now: number; callbacks_due_today: number; reached_30d: number; interested_30d: number };
  consent: { email_recorded: number; phone_recorded: number; suppressed_email: number; do_not_call: number; total: number };
  /** How mail leaves: the relay route, priority and pace (the rail's foot). */
  sending?: SendingSummary | null;
}

export interface SendingSummary {
  route: string;
  priority: number;
  hourly_pace: number;
  /** Through CoreMailInfrastructureService's marketing route (MKT-SND-10) rather than the plain relay. */
  control_plane?: boolean;
}

/** One go-live item (B-1..B-5, §3.2). */
export interface ReadinessItem {
  code: string;
  title: string;
  owner: string;
  area: string;
  open: boolean;
  /** Where to fix it: a WorkSuite web path (`/admin/apps`) or a desktop route. */
  fix?: string | null;
}

export interface Readiness {
  items: ReadinessItem[];
  open: number;
}

/* ======================================================================== *
 * Contacts and organisations (MKT-AUD)
 * ======================================================================== */

export interface Contact {
  id: number;
  name: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  /** Masked for someone without contact-edit permission (MKT-AUD-07, Target). */
  phone_masked?: boolean;
  organisation_id: number | null;
  organisation: string | null;
  job_title: string | null;
  tags: string[];
  owner: Ref | null;
  source: string | null;
  time_zone: string | null;
  email_consent: EmailConsent;
  phone_consent: PhoneConsent;
  /** The email key is suppressed for the company (unsubscribe, bounce, complaint, manual). */
  email_suppressed: boolean;
  /** The phone key is on the do-not-call list. */
  do_not_call: boolean;
  lists?: Ref[];
  segments?: Ref[];
  topics?: Array<Ref & { subscribed: boolean }>;
  crm_lead?: { id: number; number: string } | null;
  last_activity?: { kind: string; text: string; at: string } | null;
  archived_at?: string | null;
  created_at: string | null;
  updated_at?: string | null;
}

export interface ContactFilters {
  q?: string;
  list_id?: number | null;
  segment_id?: number | null;
  email_consent?: EmailConsent | '';
  source?: string;
  tag?: string;
  organisation_id?: number | null;
  archived?: boolean;
  page?: number;
  per_page?: number;
}

export interface ContactInput {
  first_name?: string | null;
  last_name?: string | null;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  organisation_id?: number | null;
  organisation?: string | null;
  job_title?: string | null;
  tags?: string[];
  owner_id?: number | null;
  source?: string | null;
  time_zone?: string | null;
  /** First consent per channel, with its basis (WF-02 step 6); `unknown` is allowed. */
  consent?: { email?: { state: EmailConsent; basis: Basis; evidence?: string | null }; phone?: { state: PhoneConsent; basis: Basis; evidence?: string | null } };
}

/** What dedupe found for a new contact (MKT-AUD-02): the key it matched on, and the record. */
export interface MatchResult {
  key: 'email_key' | 'phone_key' | 'name_org' | null;
  contact: Contact | null;
}

export type BulkAction = 'add_to_list' | 'remove_from_list' | 'tag' | 'untag' | 'handover' | 'suppress_email' | 'do_not_call' | 'archive';

export interface TimelineEntry {
  id: string | number;
  kind: 'send' | 'open' | 'click' | 'call' | 'consent' | 'import' | 'handover' | 'created' | 'unsubscribe' | 'bounce' | 'note' | string;
  title: string;
  detail: string | null;
  at: string;
  actor?: string | null;
}

export interface LedgerEntry {
  id: number;
  at: string;
  contact?: Ref | null;
  channel: Channel | 'topic';
  /** granted, withdrawn, opt-in, opt-out, bounced, complained, pending, confirmed. */
  change: string;
  topic?: string | null;
  basis: string | null;
  evidence: string | null;
  actor: { kind: 'user' | 'contact' | 'system'; name: string | null };
}

export interface ContactCampaignRow {
  campaign: Ref;
  status: string;
  sent_at: string | null;
  opened: boolean;
  clicked: boolean;
  unsubscribed: boolean;
  bounced: boolean;
}

export interface CallAttempt {
  id: number;
  campaign: Ref;
  agent: string | null;
  outcome: Outcome | null;
  notes: string | null;
  at: string;
  attempt: number;
}

export interface Handover {
  lead_id: number;
  lead_number: string;
  /** False when LeadWriter found the person and added an activity instead (MKT-CRM-03). */
  created: boolean;
}

export interface Organisation {
  id: number;
  name: string;
  industry: string | null;
  country: string | null;
  website: string | null;
  phone?: string | null;
  contacts_count: number;
  subscribed_count?: number;
  last_activity_at: string | null;
}

/* ======================================================================== *
 * Lists and segments (MKT-LST, MKT-SEG)
 * ======================================================================== */

export interface MList {
  id: number;
  name: string;
  description: string | null;
  members_count: number;
  /** Members with recorded email consent (MKT-LST-02). */
  email_subscribed_count?: number | null;
  phone_consented_count?: number | null;
  last_used_at?: string | null;
  created_at: string | null;
}

export type MatchMode = 'all' | 'any';

export interface Rule {
  field: string;
  op: string;
  value: string;
}

export interface Segment {
  id: number;
  name: string;
  match: MatchMode;
  rules: Rule[];
  count?: number | null;
  last_used_at?: string | null;
  updated_at: string | null;
}

export interface SegmentPreview {
  count: number;
  /** Everyone in the company, for "12.7% of 4,812". */
  total: number;
  /** Matching but suppressed or unsubscribed: still excluded at send (MKT-SEG-04). */
  excluded?: number;
  sample: Contact[];
}

/** One snapshot schedule of a segment into a list (MKT-SEG-08, Target). */
export interface Snapshot {
  id: number;
  list: Ref;
  every: 'day' | 'week' | 'month';
  next_at: string | null;
  last_at: string | null;
}

/* ======================================================================== *
 * Import and export (MKT-IMP)
 * ======================================================================== */

export interface ImportUpload {
  id: number;
  file: string;
  size: number;
  rows: number;
  headers: string[];
  sample: string[][];
  /** The mapping the server remembers for this header set (WF-03 step 2). */
  mapping: Record<string, string>;
  has_consent_column: boolean;
}

export type ImportResult = 'new' | 'update' | 'merged' | 'rejected';

export interface ImportPreviewRow {
  row: number;
  name: string | null;
  email: string | null;
  phone: string | null;
  match: 'email_key' | 'phone_key' | 'name_org' | 'in_file' | null;
  result: ImportResult;
  reason?: string | null;
  merged_into?: number | null;
  suppressed?: boolean;
}

export interface ImportPreview {
  new: number;
  updated: number;
  duplicates_in_file: number;
  rejected: number;
  suppressed?: number;
  has_consent_column: boolean;
  rows: ImportPreviewRow[];
}

export interface ImportCommit {
  consent: { email: { state: EmailConsent; basis: Basis }; phone: { state: PhoneConsent; basis: Basis } } | null;
  list_ids: number[];
  new_list?: string | null;
  tags: string[];
}

export interface ImportStatus {
  id: number;
  status: 'queued' | 'running' | 'done' | 'failed';
  progress: number;
  created: number;
  updated: number;
  merged: number;
  rejected: number;
  message?: string | null;
}

/* ======================================================================== *
 * Consent, suppression and topics (MKT-CON, MKT-SUP)
 * ======================================================================== */

export type SuppressionReason = 'unsubscribe' | 'hard_bounce' | 'complaint' | 'manual' | 'do_not_call';

export interface Suppression {
  id: number;
  /** The email address, or the phone key shown as "…4468 (last 9)". */
  key: string;
  type: Channel;
  reason: SuppressionReason;
  source: string | null;
  since: string;
  scope: string | null;
  note?: string | null;
  contact?: Ref | null;
}

export interface Topic {
  id: number;
  name: string;
  description: string | null;
  subscribers_count: number;
  /** Shown in the preference centre. */
  public: boolean;
  created_at?: string | null;
}

/* ======================================================================== *
 * Email campaigns (MKT-EML, MKT-EDT, MKT-CHK, MKT-SND, MKT-ABT, MKT-TRK)
 * ======================================================================== */

export type CampaignStatus = 'draft' | 'scheduled' | 'sending' | 'paused' | 'sent' | 'cancelled';

export interface AbSettings {
  enabled: boolean;
  /** Share of the audience in the test, 10..50 (MKT-ABT-01). */
  test_share: number;
  /** Hours before the winner is chosen, 1..72 (MKT-ABT-02). */
  window_hours: number;
  /** `opens` (human opens) today; `clicks` is MKT-ABT-03 (Target). */
  metric: 'opens' | 'clicks';
  /** What the test varies: the subject line, or the content. */
  kind: 'subject' | 'content';
  subject_b: string | null;
  winner?: 'A' | 'B' | null;
  decided_at?: string | null;
}

export interface Campaign {
  id: number;
  name: string;
  status: CampaignStatus;
  topic: Ref | null;
  lists: Ref[];
  segments: Ref[];
  /** "Customers (list)", "Engaged vendors (segment)". */
  audience_label?: string | null;
  from_name: string | null;
  from_email: string | null;
  reply_to: string | null;
  subject: string | null;
  preview_text: string | null;
  ab: AbSettings | null;
  local_time: boolean;
  scheduled_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  recipients_count: number;
  sent_count: number;
  delivered_count: number;
  human_opens: number;
  clicks: number;
  unsubscribes: number;
  bounces: number;
  bounce_rate: number | null;
  /** 0..100 while sending. */
  progress: number | null;
  paused_reason: 'bounce_guard' | 'manual' | 'failed' | null;
  tests_sent: number;
  owner: Ref | null;
  content_saved_at: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface CampaignInput {
  name?: string;
  topic_id?: number | null;
  list_ids?: number[];
  segment_ids?: number[];
  from_name?: string | null;
  from_email?: string | null;
  reply_to?: string | null;
  subject?: string | null;
  preview_text?: string | null;
  ab?: Partial<AbSettings> | null;
  local_time?: boolean;
}

/** A block of the email editor (MKT-EDT-01). */
export type Block =
  | { id: string; type: 'text'; html: string }
  | { id: string; type: 'image'; src: string | null; alt: string; link: string | null; width: 'full' | 'half' | 'auto' }
  | { id: string; type: 'button'; label: string; url: string; align: 'left' | 'center' }
  | { id: string; type: 'columns'; left: string; right: string }
  | { id: string; type: 'divider' }
  | { id: string; type: 'footer'; html: string };

export interface Content {
  blocks: Block[];
  plain_text: string | null;
  /** Bumps on every save; a save with an older one is refused (two editors). */
  version: number;
  saved_at: string | null;
}

export interface ContentVersion {
  version: number;
  saved_at: string;
  by: string | null;
}

export interface Template {
  id: number;
  name: string;
  kind: 'starter' | 'saved';
  blocks: Block[];
  updated_at: string | null;
}

export interface LibraryImage {
  id: number;
  url: string;
  name: string;
  width: number | null;
  height: number | null;
}

export interface MergeTag {
  tag: string;
  label: string;
  /** The footer must carry it (company address, unsubscribe). */
  required: boolean;
  fallback: boolean;
}

export interface Check {
  code: string;
  title: string;
  detail: string | null;
}

export interface CheckResult {
  blockers: Check[];
  warnings: Check[];
  passed: Check[];
}

export interface AudienceSummary {
  recipients: number;
  sources: Array<{ kind: 'list' | 'segment' | 'topic'; id: number; name: string; count: number }>;
  duplicates_removed: number;
  suppressed: number;
  unsubscribed: number;
  not_in_topic: number;
  no_consent: number;
  /** Recipients outside the company's zone when local-time sending is on. */
  other_zones?: number;
}

export interface ScheduleInput {
  /** UTC stamp, or null for now. */
  send_at: string | null;
  local_time: boolean;
}

export interface Report {
  sent: number;
  delivered: number;
  human_opens: number;
  machine_opens: number;
  unique_clickers: number;
  clicks: number;
  unsubscribes: number;
  unsubscribe_sources: { one_click: number; footer: number; preference_centre: number };
  bounces: { hard: number; soft: number };
  complaints: number;
  open_quality: { apple_mpp: number; scanner: number; image_cache: number; human: number };
  top_links: Array<{ url: string; unique_clicks: number; share: number }>;
  bounce_guard: { triggered: boolean; rate: number | null; threshold: number };
  ab: null | {
    metric: 'opens' | 'clicks';
    winner: 'A' | 'B' | null;
    decided_at: string | null;
    variants: Array<{ key: 'A' | 'B'; subject: string | null; recipients: number; human_open_rate: number | null; click_rate: number | null }>;
  };
}

/* ======================================================================== *
 * Calls (MKT-CAL)
 * ======================================================================== */

/** The ten outcomes (MKT-CAL-04). */
export type Outcome = 'interested' | 'callback' | 'not_interested' | 'no_answer' | 'busy' | 'voicemail' | 'wrong_number' | 'not_decision_maker' | 'bad_number' | 'do_not_call';

export type CallCampaignStatus = 'draft' | 'running' | 'paused' | 'finished';

export interface CallAgent {
  user_id: number;
  name: string;
  status: 'on_call' | 'wrap_up' | 'idle' | 'offline';
  idle_minutes?: number | null;
  calls_today: number;
  reached: number;
  interested: number;
  avg_seconds: number | null;
  /** Holds marketing.call.make (MKT-CAL-02; B-5 while nobody does). */
  can_call: boolean;
}

export interface CallCampaign {
  id: number;
  name: string;
  status: CallCampaignStatus;
  audience: { kind: 'list' | 'segment'; id: number; name: string } | null;
  contacts_count: number;
  in_queue: number;
  claimed_now: number;
  reached: number;
  interested: number;
  callbacks_due: number;
  excluded_no_consent: number;
  excluded_dnc?: number;
  requires_phone_consent: boolean;
  hours: { from: string; to: string; contact_local: boolean };
  retries: { max_attempts: number; delay_hours: number };
  /** The claim's idle release, 20 minutes (MKT-CAL-03). */
  claim_release_minutes: number;
  script: (Ref & { version: number }) | null;
  agents: CallAgent[];
  outcomes: Partial<Record<Outcome, number>>;
  created_at: string | null;
}

export interface CallCampaignInput {
  name?: string;
  audience?: { kind: 'list' | 'segment'; id: number } | null;
  hours?: { from: string; to: string; contact_local: boolean };
  retries?: { max_attempts: number; delay_hours: number };
  script_id?: number | null;
  agent_ids?: number[];
}

export interface QueueItem {
  id: number;
  contact: Pick<Contact, 'id' | 'name' | 'organisation' | 'phone'>;
  campaign: Ref;
  attempt: number;
  max_attempts: number;
  /** New, Retry · no answer, Callback, Quote follow-up. */
  reason: string;
  due_at: string | null;
}

export interface Claim {
  id: number;
  campaign: Ref;
  contact: Contact;
  attempt: number;
  max_attempts: number;
  last_outcome: Outcome | null;
  claimed_at: string;
  /** When an idle claim goes back to the queue (MKT-CAL-03). */
  release_at: string;
  script: Script | null;
  callback_note?: string | null;
}

export interface MyQueue {
  waiting: number;
  campaigns: Array<Ref & { waiting: number }>;
  items: QueueItem[];
  claim: Claim | null;
}

export interface OutcomeInput {
  outcome: Outcome;
  notes: string;
  /** UTC stamp, for `callback`. */
  callback_at?: string | null;
  handover?: boolean;
  handover_notes?: string | null;
  follow_up_template_id?: number | null;
}

export interface OutcomeResult {
  saved: boolean;
  lead?: { id: number; number: string; created: boolean } | null;
  task_id?: number | null;
  next_attempt_at?: string | null;
}

/** A callback booked for the person (MKT-CAL-06/12). */
export interface Callback {
  id: number;
  queue_item_id: number;
  contact: Pick<Contact, 'id' | 'name' | 'organisation' | 'phone'>;
  campaign: Ref;
  due_at: string;
  note: string | null;
  task_id: number | null;
}

export type ScriptSection = 'opening' | 'reason' | 'qualify' | 'pitch' | 'objections' | 'close';

export interface Script {
  id: number;
  name: string;
  version: number;
  sections: Record<ScriptSection, string>;
  campaigns_count?: number;
  updated_at: string | null;
}

/* ======================================================================== *
 * Settings (MKT-SET)
 * ======================================================================== */

export interface MarketingSettings {
  sending: {
    route: string;
    routes: Array<{ id: string; label: string; transactional?: boolean }>;
    hourly_pace: number;
    relay_priority: number;
    bounce_guard_percent: number;
    max_test_recipients: number;
    default_time_zone: string;
    postal_address?: string | null;
  };
  calls: { hours_from: string; hours_to: string; contact_local: boolean; max_attempts: number; retry_delay_hours: number; claim_release_minutes: number };
  consent: { require_phone_consent: boolean; double_opt_in: boolean; held_back?: number | null };
  policies: { detect_machine_opens: boolean; one_click_unsubscribe: boolean; notify_owner: boolean };
  can_edit: boolean;
}

export interface Journey {
  id: number;
  name: string;
  status: 'draft' | 'active' | 'paused';
  trigger: string;
  steps: Array<{ id: string; kind: string; title: string; detail: string | null }>;
  enrolled?: number;
}

export interface Analytics {
  period: { from: string; to: string };
  campaigns: number;
  sent: number;
  human_open_rate: number | null;
  click_rate: number | null;
  unsubscribe_rate: number | null;
  by_topic: Array<{ topic: string; sent: number; human_open_rate: number | null; click_rate: number | null }>;
  new_contacts: Array<{ month: string; added: number; subscribed: number }>;
}

/* ======================================================================== *
 * Query keys
 * ======================================================================== */

export const MK = {
  all: ['marketing'] as const,
  dashboard: (org: string) => ['marketing', 'dashboard', org] as const,
  readiness: (org: string) => ['marketing', 'readiness', org] as const,
  contacts: (org: string, f: ContactFilters) => ['marketing', 'contacts', org, f] as const,
  contact: (org: string, id: number) => ['marketing', 'contact', org, id] as const,
  timeline: (org: string, id: number) => ['marketing', 'contact', org, id, 'timeline'] as const,
  ledger: (org: string, id: number) => ['marketing', 'contact', org, id, 'ledger'] as const,
  contactCampaigns: (org: string, id: number) => ['marketing', 'contact', org, id, 'campaigns'] as const,
  contactCalls: (org: string, id: number) => ['marketing', 'contact', org, id, 'calls'] as const,
  tags: (org: string) => ['marketing', 'tags', org] as const,
  sources: (org: string) => ['marketing', 'sources', org] as const,
  organisations: (org: string, q: string, page: number) => ['marketing', 'organisations', org, q, page] as const,
  organisation: (org: string, id: number) => ['marketing', 'organisation', org, id] as const,
  lists: (org: string) => ['marketing', 'lists', org] as const,
  listMembers: (org: string, id: number, page: number) => ['marketing', 'lists', org, id, 'members', page] as const,
  segments: (org: string) => ['marketing', 'segments', org] as const,
  segment: (org: string, id: number) => ['marketing', 'segment', org, id] as const,
  snapshots: (org: string, id: number) => ['marketing', 'segment', org, id, 'snapshots'] as const,
  suppressions: (org: string, f: object) => ['marketing', 'suppressions', org, f] as const,
  consentLedger: (org: string, f: object) => ['marketing', 'consent-ledger', org, f] as const,
  topics: (org: string) => ['marketing', 'topics', org] as const,
  campaigns: (org: string, f: object) => ['marketing', 'campaigns', org, f] as const,
  campaign: (org: string, id: number) => ['marketing', 'campaign', org, id] as const,
  content: (org: string, id: number) => ['marketing', 'campaign', org, id, 'content'] as const,
  versions: (org: string, id: number) => ['marketing', 'campaign', org, id, 'versions'] as const,
  check: (org: string, id: number) => ['marketing', 'campaign', org, id, 'check'] as const,
  audience: (org: string, id: number) => ['marketing', 'campaign', org, id, 'audience'] as const,
  report: (org: string, id: number) => ['marketing', 'campaign', org, id, 'report'] as const,
  templates: (org: string) => ['marketing', 'templates', org] as const,
  images: (org: string) => ['marketing', 'images', org] as const,
  mergeTags: (org: string) => ['marketing', 'merge-tags', org] as const,
  callCampaigns: (org: string) => ['marketing', 'call-campaigns', org] as const,
  callCampaign: (org: string, id: number) => ['marketing', 'call-campaign', org, id] as const,
  queue: (org: string) => ['marketing', 'queue', org] as const,
  callbacks: (org: string) => ['marketing', 'callbacks', org] as const,
  scripts: (org: string) => ['marketing', 'scripts', org] as const,
  agents: (org: string) => ['marketing', 'agents', org] as const,
  settings: (org: string) => ['marketing', 'settings', org] as const,
  moduleSettings: ['marketing', 'module-settings'] as const,
  access: ['marketing', 'access'] as const,
  journeys: (org: string) => ['marketing', 'journeys', org] as const,
  analytics: (org: string, from: string, to: string) => ['marketing', 'analytics', org, from, to] as const,
};

/* ======================================================================== *
 * Dashboard
 * ======================================================================== */

export const fetchDashboard = (org: string, signal?: AbortSignal) => apiGet<Dashboard>(`${M}/dashboard`, withOrg(org), signal);
/** MKT-DSH-02 (Target). */
export const fetchReadiness = (org: string, signal?: AbortSignal) => optional(apiGet<Readiness>(`${M}/readiness`, withOrg(org), signal));

/* ======================================================================== *
 * Contacts
 * ======================================================================== */

function contactQuery(f: ContactFilters): Query {
  return {
    q: f.q || undefined,
    list_id: f.list_id ?? undefined,
    segment_id: f.segment_id ?? undefined,
    email_consent: f.email_consent || undefined,
    source: f.source || undefined,
    tag: f.tag || undefined,
    organisation_id: f.organisation_id ?? undefined,
    archived: f.archived ? 1 : undefined,
    page: f.page ?? 1,
    per_page: f.per_page ?? 50,
  };
}

export const fetchContacts = async (org: string, f: ContactFilters, signal?: AbortSignal) => pageOf<Contact>(await apiGet<unknown>(`${M}/contacts`, withOrg(org, contactQuery(f)), signal));
export const fetchContact = (org: string, id: number, signal?: AbortSignal) => apiGet<Contact>(`${M}/contacts/${id}`, withOrg(org), signal);
/**
 * Dedupe before saving (WF-02 step 4): email key, then phone key (last 9 digits), then name at organisation — so the
 * author sees the existing record and confirms an update. A server without the check answers "no match" here and
 * dedupes on create itself (MKT-AUD-02 is the server's).
 */
export async function matchContact(org: string, input: Pick<ContactInput, 'email' | 'phone' | 'name' | 'first_name' | 'last_name' | 'organisation' | 'organisation_id'>): Promise<MatchResult> {
  const r = await optional(apiPost<MatchResult>(`${M}/contacts/match`, input, withOrg(org)));
  return r.offered && r.data ? r.data : { key: null, contact: null };
}
export const createContact = (org: string, input: ContactInput) => apiPost<Contact>(`${M}/contacts`, input, withOrg(org));
export const updateContact = (id: number, input: ContactInput) => apiPut<Contact>(`${M}/contacts/${id}`, input);
export const archiveContact = (id: number, archived = true) => apiPost<Contact>(`${M}/contacts/${id}/${archived ? 'archive' : 'restore'}`);
export const bulkContacts = (org: string, action: BulkAction, ids: number[], extra: { list_id?: number; tag?: string; notes?: string; owner_id?: number | null } = {}) =>
  apiPost<{ affected: number; skipped?: number; message?: string | null }>(`${M}/contacts/bulk`, { action, ids, ...extra }, withOrg(org));
export const fetchTimeline = (id: number, signal?: AbortSignal) => apiGet<TimelineEntry[]>(`${M}/contacts/${id}/timeline`, undefined, signal);
export const fetchContactLedger = (id: number, signal?: AbortSignal) => apiGet<LedgerEntry[]>(`${M}/contacts/${id}/consent`, undefined, signal);
export const recordConsent = (id: number, input: { channel: Channel; change: 'granted' | 'withdrawn'; basis: Basis; evidence: string | null }) => apiPost<LedgerEntry>(`${M}/contacts/${id}/consent`, input);
export const fetchContactCampaigns = (id: number, signal?: AbortSignal) => apiGet<ContactCampaignRow[]>(`${M}/contacts/${id}/campaigns`, undefined, signal);
export const fetchContactCalls = (id: number, signal?: AbortSignal) => apiGet<CallAttempt[]>(`${M}/contacts/${id}/calls`, undefined, signal);
/** CRM hand-over through LeadWriter, channel `marketing` (MKT-CRM-01..03). */
export const handOver = (id: number, input: { notes: string | null; owner_id: number | null; campaign_id?: number | null }) => apiPost<Handover>(`${M}/contacts/${id}/handover`, input);
/** MKT-AUD-08 (Target). */
export const mergeContacts = (keep: number, other: number) => optional(apiPost<Contact>(`${M}/contacts/${keep}/merge`, { other_id: other }));
/** MKT-AUD-09 (Target): erase, keeping a hashed suppression key. */
export const eraseContact = (id: number, reason: string) => optional(apiPost<{ erased: boolean }>(`${M}/contacts/${id}/erase`, { reason }));
/** The tags and sources in use, for the filters; none from a server that does not list them. */
export async function fetchTags(org: string, signal?: AbortSignal): Promise<string[]> {
  const r = await optional(apiGet<string[]>(`${M}/tags`, withOrg(org), signal));
  return r.offered && Array.isArray(r.data) ? r.data : [];
}
export async function fetchSources(org: string, signal?: AbortSignal): Promise<string[]> {
  const r = await optional(apiGet<string[]>(`${M}/sources`, withOrg(org), signal));
  return r.offered && Array.isArray(r.data) ? r.data : [];
}

/* ======================================================================== *
 * Organisations
 * ======================================================================== */

export const fetchOrganisations = async (org: string, q: string, page: number, signal?: AbortSignal) => pageOf<Organisation>(await apiGet<unknown>(`${M}/organisations`, withOrg(org, { q: q || undefined, page, per_page: 50 }), signal));
export const fetchOrganisation = (org: string, id: number, signal?: AbortSignal) => apiGet<Organisation & { contacts: Contact[]; activity: TimelineEntry[] }>(`${M}/organisations/${id}`, withOrg(org), signal);
export const saveOrganisation = (org: string, id: number | null, input: Partial<Pick<Organisation, 'name' | 'industry' | 'country' | 'website' | 'phone'>>) =>
  id ? apiPut<Organisation>(`${M}/organisations/${id}`, input) : apiPost<Organisation>(`${M}/organisations`, input, withOrg(org));

/* ======================================================================== *
 * Lists and segments
 * ======================================================================== */

export const fetchLists = async (org: string, signal?: AbortSignal) => pageOf<MList>(await apiGet<unknown>(`${M}/lists`, withOrg(org, { per_page: 200 }), signal)).rows;
export const saveList = (org: string, id: number | null, input: { name: string; description?: string | null }) => (id ? apiPut<MList>(`${M}/lists/${id}`, input) : apiPost<MList>(`${M}/lists`, input, withOrg(org)));
export const deleteList = (id: number) => apiDelete<void>(`${M}/lists/${id}`);
export const fetchListMembers = async (id: number, page: number, signal?: AbortSignal) => pageOf<Contact>(await apiGet<unknown>(`${M}/lists/${id}/members`, { page, per_page: 50 }, signal));
export const removeListMembers = (id: number, contactIds: number[]) => apiDelete<{ affected: number }>(`${M}/lists/${id}/members`, { contact_ids: contactIds });

export const fetchSegments = async (org: string, signal?: AbortSignal) => pageOf<Segment>(await apiGet<unknown>(`${M}/segments`, withOrg(org, { per_page: 200 }), signal)).rows;
export const fetchSegment = (id: number, signal?: AbortSignal) => apiGet<Segment>(`${M}/segments/${id}`, undefined, signal);
/** Live count and a sample while editing (MKT-SEG-03; NFR-03 2 s for 50,000 contacts). */
export const previewSegment = (org: string, input: { match: MatchMode; rules: Rule[] }, signal?: AbortSignal) =>
  request<SegmentPreview>('POST', `${M}/segments/preview`, { body: input, query: withOrg(org), signal }).then((r) => r.data);
export const saveSegment = (org: string, id: number | null, input: { name: string; match: MatchMode; rules: Rule[] }) => (id ? apiPut<Segment>(`${M}/segments/${id}`, input) : apiPost<Segment>(`${M}/segments`, input, withOrg(org)));
export const deleteSegment = (id: number) => apiDelete<void>(`${M}/segments/${id}`);
/** MKT-SEG-05: save once as a static list. */
export const segmentToList = (id: number, name: string) => apiPost<MList>(`${M}/segments/${id}/to-list`, { name });
/** MKT-SEG-08 (Target). */
export const fetchSnapshots = (id: number, signal?: AbortSignal) => optional(apiGet<Snapshot[]>(`${M}/segments/${id}/snapshots`, undefined, signal));
export const scheduleSnapshot = (id: number, input: { list_name: string; every: Snapshot['every'] }) => optional(apiPost<Snapshot>(`${M}/segments/${id}/snapshots`, input));

/* ======================================================================== *
 * Import and export
 * ======================================================================== */

export function uploadImport(org: string, file: File): Promise<ImportUpload> {
  const fd = new FormData();
  fd.append('file', file, file.name);
  return request<ImportUpload>('POST', `${M}/imports`, { body: fd, query: withOrg(org) }).then((r) => r.data);
}
export const previewImport = (id: number, mapping: Record<string, string>) => apiPost<ImportPreview>(`${M}/imports/${id}/preview`, { mapping });
export const commitImport = (id: number, input: ImportCommit) => apiPost<ImportStatus>(`${M}/imports/${id}/commit`, input);
/** MKT-IMP-06 (Target): progress of a background import. */
export const fetchImport = (id: number, signal?: AbortSignal) => optional(apiGet<ImportStatus>(`${M}/imports/${id}`, undefined, signal));
/** MKT-IMP-04 (Target): the rejected rows with reasons, as CSV. */
export const rejectedRowsCsv = (id: number) => optional(fetchCsv(`${M}/imports/${id}/rejected`));

/**
 * A CSV the server builds (contacts, list members, a segment's matches, the ledger, a report — MKT-IMP-05, audited
 * there). Read as text and saved with `files:saveText`.
 */
export async function fetchCsv(path: string, query?: Query): Promise<string> {
  let res: Response;
  try {
    res = await fetch(apiUrl(path, query), { headers: { Accept: 'text/csv, application/json' } });
  } catch {
    throw new ApiError(0, 'WorkSuite Desktop could not complete the request.', 'INTERNAL');
  }
  const type = res.headers.get('content-type') ?? '';
  if (!res.ok || type.includes('json')) {
    let message = `The server answered ${res.status}.`;
    let code: string | null = null;
    try {
      const j = (await res.json()) as { message?: string; code?: string; data?: { csv?: string } };
      if (res.ok && typeof j?.data?.csv === 'string') return j.data.csv;
      if (typeof j?.message === 'string') message = j.message;
      if (typeof j?.code === 'string') code = j.code;
    } catch {
      /* not JSON */
    }
    throw new ApiError(res.ok ? 500 : res.status, message, code);
  }
  return res.text();
}

export const exportContactsCsv = (org: string, f: ContactFilters) => fetchCsv(`${M}/contacts/export`, withOrg(org, { ...contactQuery(f), page: undefined, per_page: undefined }));
export const exportListCsv = (id: number) => fetchCsv(`${M}/lists/${id}/export`);
export const exportSegmentCsv = (id: number) => fetchCsv(`${M}/segments/${id}/export`);

/* ======================================================================== *
 * Consent, suppression, topics
 * ======================================================================== */

export interface SuppressionFilters {
  type?: Channel | '';
  reason?: SuppressionReason | '';
  q?: string;
  page?: number;
}

export const fetchSuppressions = async (org: string, f: SuppressionFilters, signal?: AbortSignal) =>
  pageOf<Suppression>(await apiGet<unknown>(`${M}/suppressions`, withOrg(org, { type: f.type || undefined, reason: f.reason || undefined, q: f.q || undefined, page: f.page ?? 1, per_page: 50 }), signal));
export const addSuppression = (org: string, input: { type: Channel; value: string; reason: 'manual' | 'do_not_call'; note: string | null }) => apiPost<Suppression>(`${M}/suppressions`, input, withOrg(org));
/** MKT-SUP-05 (Target): removal needs a reason, and is audited. */
export const removeSuppression = (id: number, reason: string) => optional(apiDelete<void>(`${M}/suppressions/${id}`, { reason }));

export interface LedgerFilters {
  channel?: Channel | 'topic' | '';
  from?: string;
  to?: string;
  q?: string;
  page?: number;
}

export const fetchLedger = async (org: string, f: LedgerFilters, signal?: AbortSignal) =>
  pageOf<LedgerEntry>(await apiGet<unknown>(`${M}/consent-ledger`, withOrg(org, { channel: f.channel || undefined, from: f.from || undefined, to: f.to || undefined, q: f.q || undefined, page: f.page ?? 1, per_page: 50 }), signal));
/** MKT-CON-07 (Target). */
export const exportLedgerCsv = (org: string, f: LedgerFilters) => optional(fetchCsv(`${M}/consent-ledger/export`, withOrg(org, { channel: f.channel || undefined, from: f.from || undefined, to: f.to || undefined })));

export const fetchTopics = async (org: string, signal?: AbortSignal) => pageOf<Topic>(await apiGet<unknown>(`${M}/topics`, withOrg(org), signal)).rows;
export const saveTopic = (org: string, id: number | null, input: { name: string; description: string | null; public: boolean }) => (id ? apiPut<Topic>(`${M}/topics/${id}`, input) : apiPost<Topic>(`${M}/topics`, input, withOrg(org)));
export const deleteTopic = (id: number) => apiDelete<void>(`${M}/topics/${id}`);

/* ======================================================================== *
 * Email campaigns
 * ======================================================================== */

export interface CampaignFilters {
  status?: CampaignStatus | '';
  q?: string;
  page?: number;
}

export const fetchCampaigns = async (org: string, f: CampaignFilters, signal?: AbortSignal) =>
  pageOf<Campaign>(await apiGet<unknown>(`${M}/campaigns`, withOrg(org, { status: f.status || undefined, q: f.q || undefined, page: f.page ?? 1, per_page: 50 }), signal));
export const fetchCampaign = (id: number, signal?: AbortSignal) => apiGet<Campaign>(`${M}/campaigns/${id}`, undefined, signal);
export const createCampaign = (org: string, input: CampaignInput & { template_id?: number | null; starter?: string | null }) => apiPost<Campaign>(`${M}/campaigns`, input, withOrg(org));
export const updateCampaign = (id: number, input: CampaignInput) => apiPut<Campaign>(`${M}/campaigns/${id}`, input);
export const duplicateCampaign = (id: number) => apiPost<Campaign>(`${M}/campaigns/${id}/duplicate`);
export const deleteCampaign = (id: number) => apiDelete<void>(`${M}/campaigns/${id}`);

export const fetchContent = (id: number, signal?: AbortSignal) => apiGet<Content>(`${M}/campaigns/${id}/content`, undefined, signal);
export const saveContent = (id: number, input: { blocks: Block[]; plain_text: string | null; version: number }) => apiPut<{ version: number; saved_at: string }>(`${M}/campaigns/${id}/content`, input);
/** MKT-EDT-06 (Target). */
export const fetchVersions = (id: number, signal?: AbortSignal) => optional(apiGet<ContentVersion[]>(`${M}/campaigns/${id}/versions`, undefined, signal));
export const restoreVersion = (id: number, version: number) => optional(apiPost<Content>(`${M}/campaigns/${id}/versions/${version}/restore`));

export const fetchTemplates = async (org: string, signal?: AbortSignal) => pageOf<Template>(await apiGet<unknown>(`${M}/templates`, withOrg(org), signal)).rows;
export const saveTemplate = (org: string, id: number | null, input: { name: string; blocks: Block[] }) => (id ? apiPut<Template>(`${M}/templates/${id}`, input) : apiPost<Template>(`${M}/templates`, input, withOrg(org)));
export const deleteTemplate = (id: number) => apiDelete<void>(`${M}/templates/${id}`);

export const fetchImages = async (org: string, signal?: AbortSignal) => pageOf<LibraryImage>(await apiGet<unknown>(`${M}/images`, withOrg(org), signal)).rows;
export function uploadImage(org: string, file: File): Promise<LibraryImage> {
  const fd = new FormData();
  fd.append('image', file, file.name);
  return request<LibraryImage>('POST', `${M}/images`, { body: fd, query: withOrg(org) }).then((r) => r.data);
}
/** The closed merge-tag list (MKT-EDT-04); null from a server that does not list it (the editor uses its own). */
export async function fetchMergeTags(org: string, signal?: AbortSignal): Promise<MergeTag[] | null> {
  const r = await optional(apiGet<MergeTag[]>(`${M}/merge-tags`, withOrg(org), signal));
  return r.offered && Array.isArray(r.data) ? r.data : null;
}

/** The pre-send check (MKT-CHK-01/02; NFR-02 3 s for 50,000). */
export const runCheck = (id: number) => apiPost<CheckResult>(`${M}/campaigns/${id}/check`);
/** Up to five tests with a chosen contact's merge values (MKT-CHK-03). */
export const sendTests = (id: number, input: { emails: string[]; contact_id: number | null }) => apiPost<{ sent: number; remaining: number }>(`${M}/campaigns/${id}/tests`, input);
export const fetchAudience = (id: number, signal?: AbortSignal) => apiGet<AudienceSummary>(`${M}/campaigns/${id}/audience`, undefined, signal);
export const scheduleCampaign = (id: number, input: ScheduleInput) => apiPost<Campaign>(`${M}/campaigns/${id}/schedule`, input);
export const unscheduleCampaign = (id: number) => apiPost<Campaign>(`${M}/campaigns/${id}/unschedule`);
export const pauseCampaign = (id: number) => apiPost<Campaign>(`${M}/campaigns/${id}/pause`);
export const resumeCampaign = (id: number) => apiPost<Campaign>(`${M}/campaigns/${id}/resume`);
export const cancelCampaign = (id: number) => apiPost<Campaign>(`${M}/campaigns/${id}/cancel`);
export const fetchReport = (id: number, signal?: AbortSignal) => apiGet<Report>(`${M}/campaigns/${id}/report`, undefined, signal);
export const exportReportCsv = (id: number) => fetchCsv(`${M}/campaigns/${id}/report/export`);
/** MKT-EML-05 (Target): approval before scheduling for authors without send permission. */
export const requestApproval = (id: number, note: string | null) => optional(apiPost<{ requested: boolean }>(`${M}/campaigns/${id}/approval`, { note }));

/* ======================================================================== *
 * Calls
 * ======================================================================== */

export const fetchCallCampaigns = async (org: string, signal?: AbortSignal) => pageOf<CallCampaign>(await apiGet<unknown>(`${M}/call-campaigns`, withOrg(org), signal)).rows;
export const fetchCallCampaign = (id: number, signal?: AbortSignal) => apiGet<CallCampaign>(`${M}/call-campaigns/${id}`, undefined, signal);
export const saveCallCampaign = (org: string, id: number | null, input: CallCampaignInput) => (id ? apiPut<CallCampaign>(`${M}/call-campaigns/${id}`, input) : apiPost<CallCampaign>(`${M}/call-campaigns`, input, withOrg(org)));
/** Starting builds the queue (WF-12 step 8). */
export const setCallCampaignState = (id: number, to: 'start' | 'pause' | 'resume' | 'finish') => apiPost<CallCampaign>(`${M}/call-campaigns/${id}/${to}`);
/** People who may be assigned: those holding marketing.call.make, and who does not (B-5). */
export const fetchAgents = (org: string, signal?: AbortSignal) => apiGet<Array<{ user_id: number; name: string; can_call: boolean }>>(`${M}/agents`, withOrg(org), signal);
/** MKT-CAL-15 (Partial): the supervisor's live view, refreshed. */
export const fetchCallLive = (id: number, signal?: AbortSignal) => optional(apiGet<{ agents: CallAgent[]; in_queue: number; claimed_now: number }>(`${M}/call-campaigns/${id}/live`, undefined, signal));

export const fetchQueue = (org: string, signal?: AbortSignal) => apiGet<MyQueue>(`${M}/queue`, withOrg(org), signal);
/** The atomic claim (CAS; MKT-CAL-03, NFR-08, AC-08): one item for this agent, or null when the queue is empty. */
export const claimNext = (org: string, campaignId: number | null) => apiPost<Claim | null>(`${M}/queue/next`, { campaign_id: campaignId }, withOrg(org));
export const releaseClaim = (claimId: number) => apiPost<void>(`${M}/queue/${claimId}/release`);
export const skipClaim = (claimId: number) => apiPost<void>(`${M}/queue/${claimId}/skip`);
/** Idempotent per claim (§7.1). */
export const saveOutcome = (claimId: number, input: OutcomeInput) => apiPost<OutcomeResult>(`${M}/queue/${claimId}/outcome`, input);
/** The person's callbacks (MKT-CAL-12 desktop reminders read the same list). */
export const fetchCallbacks = (org: string, signal?: AbortSignal) => optional(apiGet<Callback[]>(`${M}/queue/callbacks`, withOrg(org), signal));

export const fetchScripts = async (org: string, signal?: AbortSignal) => pageOf<Script>(await apiGet<unknown>(`${M}/scripts`, withOrg(org), signal)).rows;
/** Saving an existing script makes a new version (MKT-CAL-07). */
export const saveScript = (org: string, id: number | null, input: { name: string; sections: Record<ScriptSection, string> }) => (id ? apiPut<Script>(`${M}/scripts/${id}`, input) : apiPost<Script>(`${M}/scripts`, input, withOrg(org)));
export const fetchScriptVersions = (id: number, signal?: AbortSignal) => optional(apiGet<Script[]>(`${M}/scripts/${id}/versions`, undefined, signal));

/* ======================================================================== *
 * Settings, journeys, analytics
 * ======================================================================== */

export const fetchSettings = (org: string, signal?: AbortSignal) => apiGet<MarketingSettings>(`${M}/settings`, withOrg(org), signal);
export const saveSettings = (org: string, patch: { sending?: Partial<MarketingSettings['sending']>; calls?: Partial<MarketingSettings['calls']>; consent?: Partial<MarketingSettings['consent']>; policies?: Partial<MarketingSettings['policies']> }) =>
  request<MarketingSettings>('PUT', `${M}/settings`, { body: patch, query: withOrg(org) }).then((r) => r.data);
/** MKT-AUT-* (Target, phase 4). */
export const fetchJourneys = (org: string, signal?: AbortSignal) => optional(apiGet<Journey[]>(`${M}/journeys`, withOrg(org), signal));
/** MKT-ANL-01 (Target, phase 3). */
export const fetchAnalytics = (org: string, from: string, to: string, signal?: AbortSignal) => optional(apiGet<Analytics>(`${M}/analytics`, withOrg(org, { from, to }), signal));

/* ======================================================================== *
 * Hooks used across screens
 * ======================================================================== */

export function useDashboard() {
  const org = useMarketingOrg();
  return useQuery({ queryKey: MK.dashboard(org), queryFn: ({ signal }) => fetchDashboard(org, signal), refetchInterval: 60_000 });
}

export function useReadiness() {
  const org = useMarketingOrg();
  return useQuery({ queryKey: MK.readiness(org), queryFn: ({ signal }) => fetchReadiness(org, signal), staleTime: 60_000 });
}

export function useLists() {
  const org = useMarketingOrg();
  return useQuery({ queryKey: MK.lists(org), queryFn: ({ signal }) => fetchLists(org, signal), staleTime: 30_000 });
}

export function useSegments() {
  const org = useMarketingOrg();
  return useQuery({ queryKey: MK.segments(org), queryFn: ({ signal }) => fetchSegments(org, signal), staleTime: 30_000 });
}

export function useTopics() {
  const org = useMarketingOrg();
  return useQuery({ queryKey: MK.topics(org), queryFn: ({ signal }) => fetchTopics(org, signal), staleTime: 60_000 });
}

export function useTemplates() {
  const org = useMarketingOrg();
  return useQuery({ queryKey: MK.templates(org), queryFn: ({ signal }) => fetchTemplates(org, signal), staleTime: 60_000 });
}

export function useScripts() {
  const org = useMarketingOrg();
  return useQuery({ queryKey: MK.scripts(org), queryFn: ({ signal }) => fetchScripts(org, signal), staleTime: 60_000 });
}

export function useSettings() {
  const org = useMarketingOrg();
  return useQuery({ queryKey: MK.settings(org), queryFn: ({ signal }) => fetchSettings(org, signal), staleTime: 60_000 });
}

/** The agent's queue; refreshed often while open, since others claim from it too. */
export function useQueue(enabled = true) {
  const org = useMarketingOrg();
  return useQuery({ queryKey: MK.queue(org), queryFn: ({ signal }) => fetchQueue(org, signal), enabled, refetchInterval: 20_000 });
}

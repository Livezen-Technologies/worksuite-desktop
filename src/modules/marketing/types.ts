import { ApiError } from '../../core/api';

/**
 * What the Marketing screens are given, and the few words they share —
 * copied from the web client's `pages/marketing/types.ts` (itself written from
 * the server's controllers), so a field that is null on the server is null here
 * too. Every field a later part of the server added is optional, so a server a
 * part behind still renders.
 *
 * Every figure and every rule is the server's: who is a duplicate, what a
 * consent word in a spreadsheet means, who is subscribed, who may be called.
 * The screens show what they were sent and send back what was typed; none of
 * them decides who may be marketed to.
 */

export interface Pair { value: string; label: string }
export interface Person { id: number; name: string }
export interface Named { id: number; name: string | null }

export interface Can {
  dashboard: boolean; view: boolean; create: boolean; edit: boolean; delete: boolean; import: boolean; export: boolean;
  convert: boolean; lists: boolean; segments: boolean; suppression: boolean; settings: boolean;
  /* Email campaigns. Optional: a server a phase behind sends none of them, and absent is "may not". */
  campaigns?: boolean; campaign_create?: boolean; campaign_edit?: boolean; campaign_launch?: boolean; campaign_pause?: boolean;
  templates?: boolean; analytics?: boolean;
  /* Calls (phase 3): see campaigns, run them, make calls. Optional for the same reason. */
  calls?: boolean; call_manage?: boolean; call_make?: boolean;
}

export interface Company { id: number; name: string; can: Can; people: Person[] }

export interface FieldOp { key: string; label: string; bare: boolean }

export interface SegmentField {
  key: string;
  label: string;
  type: 'choice' | 'country' | 'text' | 'user' | 'tag' | 'list' | 'days' | 'number' | 'none';
  ops: FieldOp[];
  choices: Pair[] | null;
}

export interface Options {
  companies: Company[];
  statuses: Pair[];
  sources: Pair[];
  channels: Pair[];
  reasons: Pair[];
  consent_sources: Pair[];
  segment_fields: SegmentField[];
  import_targets: Pair[];
  import_existing: Pair[];
  import_limits: { rows: number; bytes: number };
  merge_tags?: Pair[];
  template_categories?: Pair[];
  campaign_statuses?: Pair[];
  image_limit?: number;
  /* Email campaigns, part 2. */
  campaign_types?: Pair[];
  ab_metrics?: Pair[];
  ab_limits?: { share_min: number; share_max: number; share: number; hours_max: number; hours: number };
  /* Go-live: how mail leaves, and the ten ways a call can end. */
  sending?: Sending;
  call_outcomes?: Pair[];
}

export type Channel = 'email' | 'phone' | 'whatsapp';
export type ConsentWord = 'granted' | 'withdrawn' | null;

export interface Contact {
  id: number;
  org_id: number;
  name: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  whatsapp: string | null;
  job_title: string | null;
  company: Named | null;
  country: string | null;
  country_name: string | null;
  city: string | null;
  industry: string | null;
  language: string | null;
  status: string;
  status_label: string;
  source: string;
  source_label: string;
  owner: Named | null;
  score: number;
  tags: string[];
  consent: Record<Channel, ConsentWord>;
  suppressed: Array<{ channel: Channel; reason: string }>;
  crm_lead_id: number | null;
  in_address_book: boolean;
  last_contacted_at: string | null;
  next_follow_up_at: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface ConsentEntry {
  id: number;
  channel: Channel;
  status: 'granted' | 'withdrawn';
  source: string;
  source_label: string;
  source_ref: string | null;
  note: string | null;
  by: string | null;
  at: string | null;
}

export interface TimelineEntry {
  id: number;
  kind: string;
  title: string;
  meta: Record<string, unknown> | null;
  ref_type: string | null;
  ref_id: number | null;
  at: string | null;
  actor: string | null;
}

/** A company's email topic, as one address chose it. */
export interface TopicChoice { id: number; name: string; description: string | null; receives: boolean }

export interface ContactDetail extends Contact {
  source_detail: Record<string, string>;
  custom: Record<string, string>;
  lists: Array<{ id: number; name: string; archived: boolean }>;
  consent_history: ConsentEntry[];
  /* Absent from a server a part behind. */
  topics?: TopicChoice[];
  timeline: TimelineEntry[];
  address_book: { id: number; name: string } | null;
  crm_lead: { id: number; number: string | null; status: string | null } | null;
  can: { edit: boolean; delete: boolean; convert: boolean; lists: boolean };
}

export interface MarketingCompany {
  id: number;
  org_id: number;
  name: string;
  domain: string | null;
  industry: string | null;
  country: string | null;
  country_name: string | null;
  city: string | null;
  phone: string | null;
  website: string | null;
  owner: Named | null;
  client_id: number | null;
  contacts: number;
  created_at: string | null;
}

export interface MarketingList {
  id: number;
  org_id: number;
  name: string;
  description: string | null;
  owner: Named | null;
  members: number;
  /* Who on it may be emailed now, and when a campaign last used it (MKT-LST-02). Absent from a server a part behind. */
  subscribed?: number;
  last_used_at?: string | null;
  archived: boolean;
  created_at: string | null;
  updated_at: string | null;
}

export interface Rule { field: string; op: string; value: unknown }

export interface Segment {
  id: number;
  org_id: number;
  name: string;
  description: string | null;
  match: 'all' | 'any';
  rules: Rule[];
  members: number | null;
  owner: Named | null;
  updated_at: string | null;
}

export interface Suppressed {
  id: number;
  org_id: number;
  channel: Channel;
  value: string;
  reason: string;
  reason_label: string;
  contact: { id: number; name: string } | null;
  note: string | null;
  by: string | null;
  created_at: string | null;
}

export interface ImportCounts {
  rows: number; new: number; existing: number; duplicates: number; refused: number;
  invalid_emails: number; invalid_phones: number; suppressed: number; missing_consent: number;
  created?: number; updated?: number;
}

export interface ImportRow {
  line: number;
  label: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  outcome: 'new' | 'existing' | 'duplicate' | 'refused';
  flags: string[];
  why: string | null;
  /* Which key matched, and the line a duplicate merges into. Absent from a server a part behind. */
  match?: MatchKey | null;
  merged_into?: number | null;
}

export interface ImportPreview {
  file_name: string;
  org_id: number;
  columns: string[];
  mapping: string[];
  rows: number;
  counts: ImportCounts | null;
  sample: ImportRow[];
  message?: string;
}

export interface ImportRecord {
  id: number;
  org_id: number;
  file_name: string;
  rows: number;
  created: number;
  updated: number;
  skipped: number;
  stats: ImportCounts | null;
  status: 'running' | 'done' | 'failed';
  list: Named | null;
  by: string | null;
  created_at: string | null;
}

export interface DashboardData {
  days: number;
  totals: {
    contacts: number; active: number; new: number; qualified: number; subscribed: number;
    crm_leads: number; unsubscribes: number; suppressed: number;
  };
  growth: Array<{ day: string; contacts: number }>;
  statuses: Array<{ key: string; label: string; contacts: number }>;
  sources: Array<{ key: string; label: string; contacts: number }>;
  recent_imports: ImportRecord[];
}

export const CHANNEL_WORD: Record<Channel, string> = { email: 'Email', phone: 'Calls', whatsapp: 'WhatsApp' };

/** The companies where the reader may do one thing. */
export function companiesWhere(options: Options | undefined, can: keyof Can): Company[] {
  return (options?.companies ?? []).filter((c) => c.can[can]);
}

/** The people who may own a record in a company, for a picker. */
export function peopleOf(options: Options | undefined, orgId: number | null): Pair[] {
  const co = (options?.companies ?? []).find((c) => c.id === orgId);

  return (co?.people ?? []).map((p) => ({ value: String(p.id), label: p.name }));
}

/* ------------------------------------------------------------------ *
 * Email campaigns
 * ------------------------------------------------------------------ */

export type CampaignStatus = 'draft' | 'scheduled' | 'sending' | 'paused' | 'sent' | 'cancelled';

/** What a company's emails are about, as its preferences page offers them. */
export interface Topic {
  id: number;
  org_id: number;
  name: string;
  description: string | null;
  position: number;
  archived: boolean;
  opted_out: number;
  campaigns: number;
  updated_at: string | null;
}

export type Version = 'a' | 'b';

/** An A/B test as the campaign holds it. */
export interface AbSettings {
  share: number;
  metric: 'opens' | 'clicks';
  hours: number;
  winner: Version | null;
  ends_at: string | null;
  decided_at: string | null;
  decided_by_person: boolean;
}

export interface Audience { lists: number[]; segments: number[]; exclude_lists: number[]; exclude_segments: number[] }

export interface CampaignStats {
  recipients: number; sent: number; bounced: number; opened: number; clicked: number; unsubscribed: number;
  /** Copies opened by a person, not an image proxy or a scanner. Absent from a server a part behind. */
  human?: number;
}

export interface Campaign {
  id: number;
  org_id: number;
  name: string;
  objective: string | null;
  /* Part 2; optional, as a server a part behind sends none of them. */
  type?: string | null;
  type_label?: string | null;
  tags?: string[];
  topic?: { id: number; name: string } | null;
  /** A wall-clock time in no zone — "09:00 wherever each recipient is". Never parse it as UTC. */
  local_at?: string | null;
  local_time?: boolean;
  ab?: AbSettings | null;
  b?: { subject: string | null; preheader: string | null; from_name: string | null };
  status: CampaignStatus;
  status_label: string;
  status_note: string | null;
  owner: Named | null;
  subject: string | null;
  preheader: string | null;
  from_name: string | null;
  from_email: string | null;
  reply_to: string | null;
  audience: Audience;
  track_opens: boolean;
  track_clicks: boolean;
  pace_per_hour: number | null;
  scheduled_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  recipients: number;
  created_at: string | null;
  updated_at: string | null;
  stats: CampaignStats | null;
}

export interface CampaignDetail extends Campaign {
  body_html: string;
  /** Version B's own content; null is "the same as A". */
  b_body_html?: string | null;
  can: { edit: boolean; launch: boolean; pause: boolean; create: boolean; results: boolean; templates: boolean };
}

export interface CampaignCheck {
  blockers: string[];
  warnings: string[];
  /** What was checked and is fine, in words. Absent from a server a part behind. */
  passed?: string[];
  test_limit?: number;
  audience: {
    named: number; no_email: number; no_consent: number; suppressed: number; opted_out?: number; bounced: number; final: number;
    missing: Record<string, number>; sample: number | null;
  };
  pace: number;
  capacity: { ok: boolean; left: number | null; scope: string; message: string };
  /** How an A/B test would divide the list; null without one. */
  ab?: { a: number; b: number; rest: number } | null;
}

/** One version's figures in an A/B test. */
export interface VersionTally { recipients: number; sent: number; reached: number; opened: number; clicked: number; rate: number | null; subject: string; from_name: string }

export interface Senders { domains: Array<{ domain: string; ok: boolean; reason: string | null }>; default: { from_name: string; from_email: string } }

export interface Report {
  quality?: ReportQuality;
  deliverability?: ReportDeliverability;
  counts: Record<string, number>;
  rates: { reached: number; opened: number | null; clicked: number | null; unsubscribed: number | null; bounced: number | null };
  links: Array<{ id: number; url: string; clicks: number; unique_clicks: number }>;
  activity: { unit: 'hour' | 'day'; points: Array<{ at: string; opens: number; clicks: number }> };
  ab?: {
    metric: 'opens' | 'clicks'; share: number; hours: number; ends_at: string | null; winner: Version | null; decided_at: string | null;
    decided_by: string | null; versions: Record<Version, VersionTally>;
  } | null;
}

export interface CampaignRecipient {
  id: number;
  contact_id: number;
  email: string;
  name: string | null;
  status: string;
  reason: string | null;
  bounce: string | null;
  variant?: Version | null;
  opens: number;
  human_opens: number;
  clicks: number;
  sent_at: string | null;
  first_open_at: string | null;
  first_click_at: string | null;
  unsubscribed_at: string | null;
}

export interface Template {
  id: number;
  org_id: number;
  name: string;
  category: string;
  category_label: string;
  subject: string | null;
  preheader: string | null;
  body_html: string;
  updated_at: string | null;
}

export interface Starter { key: string; name: string; category: string; subject: string; preheader: string; body_html: string }

export interface EmailImage { id: number; org_id: number; name: string; url: string; width: number | null; height: number | null; bytes: number; created_at: string | null }

/* ------------------------------------------------------------------ *
 * Go-live, the dashboard's wider figures, and the rail's counts
 * ------------------------------------------------------------------ */

/** How bulk mail leaves: the relay route Marketing resolves to, its priority, and the company's pace. */
export interface Sending {
  route: 'module' | 'organization' | 'global' | 'none';
  route_label: string;
  priority: number;
  pace: number;
  bounce_guard: number;
  test_limit: number;
}

export type ReadinessKey = 'app_enabled' | 'send_cron' | 'mail_route' | 'sending_domain' | 'bounce_reports' | 'call_agents' | 'footer_address';

/** One thing that has to be true before sending is safe, who fixes it, and where. */
export interface ReadinessItem {
  key: ReadinessKey;
  ok: boolean;
  title: string;
  detail: string;
  owner: string;
  fix: { label: string; href: string } | null;
}

export interface Readiness { live: boolean; open: number; items: ReadinessItem[] }

export interface DashboardEmail {
  sent: number;
  delivered: number;
  human_open_rate: number | null;
  bounce_rate: number | null;
  bounce_guard: number;
  weekly: Array<{ week: string; delivered: number; human_opens: number }>;
}

export interface DashboardCalls { in_queue: number; claimed_now: number; callbacks_today: number; reached: number; interested_to_crm: number }

export interface DashboardConsent { contacts: number; email_granted: number; phone_granted: number; email_suppressed: number; do_not_call: number }

export type StatusCounts = Partial<Record<CampaignStatus | 'all', number>>;

/** The dashboard as a server a part ahead sends it: every addition optional, so an older one still renders. */
export interface DashboardWide extends DashboardData {
  readiness?: Readiness;
  email?: DashboardEmail;
  campaigns?: { recent: Campaign[]; counts: StatusCounts };
  calls?: DashboardCalls | null;
  consent?: DashboardConsent;
  sending?: Sending;
}

/** Counts cheap enough to ask for on every screen: the rail's badges, the desktop's tray. */
export interface Pulse {
  queue: { waiting: number; callbacks_today: number; held: number | null } | null;
  sending: Array<{ id: number; name: string; sent: number; recipients: number }>;
  contacts: number;
  drafts: number;
}

/** What the contact list adds to a contact: the last thing that happened, and whether the number was masked. */
export interface ContactRow extends Contact {
  last_activity?: { title: string; at: string | null } | null;
  phone_masked?: boolean;
}

/** One campaign a contact was in, as their copy went. */
export interface ContactCampaign {
  campaign_id: number;
  name: string;
  status: string;
  sent_at: string | null;
  opened: boolean;
  clicked: boolean;
  unsubscribed: boolean;
  bounced: boolean;
}

/** A row of the consent ledger, across contacts. Never edited: a correction is a new row. */
export interface LedgerEntry extends ConsentEntry {
  org_id: number;
  contact: { id: number; name: string } | null;
}

export interface SegmentSample { id: number; name: string; company: string | null; last_open_at: string | null }

/** Which key matched an existing contact, or an earlier row of the same file. */
export type MatchKey = 'email_key' | 'phone_key' | 'name_org';

/** Open quality and deliverability, as a report a part ahead sends them. */
export interface ReportQuality { human: number; machine_total: number; machine: Array<{ client: string; opens: number }> }

export interface ReportDeliverability {
  hard: number; soft: number; complaints: number; suppressed: number;
  guard: { threshold: number; rate: number | null; triggered: boolean };
}

export const MATCH_WORD: Record<MatchKey, string> = { email_key: 'email_key', phone_key: 'phone_key', name_org: 'name@org' };

/** What a refusal said, or a sentence that is still true when it said nothing. */
export function refusal(e: unknown, fallback = 'That could not be done. Try again.'): string {
  return e instanceof ApiError && e.message ? e.message : fallback;
}

/** The field errors of a refusal, by field. */
export function fieldErrors(e: unknown): Record<string, string> {
  const d = e instanceof ApiError ? e.data : null;

  return d && typeof d === 'object' && !Array.isArray(d) ? (d as Record<string, string>) : {};
}

/** A share as a whole percentage, or a dash when there is nothing to share out. */
export function percent(part: number, whole: number): string {
  return whole > 0 ? `${Math.round((part / whole) * 100)}%` : '—';
}

/** A wall-clock time in no zone ("09:00 wherever each recipient is"), as it was written: never read as an instant. */
export function wallLabel(stamp: string | null | undefined): string {
  if (!stamp || !/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(stamp)) return '—';

  return `${stamp.slice(0, 10)}, ${stamp.slice(11, 16)}`;
}

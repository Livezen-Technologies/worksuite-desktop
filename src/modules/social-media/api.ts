import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { apiDelete, apiGet, apiPost, apiPut, ApiError, type Query } from '../../core/api';
import type { CapabilitySet, InboxKind, MediaKind, Network, PostKind } from './lib/networks';
import type { AccountStatus, AttemptOutcome, CampaignStatus, ErrorClass, PostStatus, TargetStatus, ThreadStatus } from './lib/status';
import type { Issue } from './lib/validate';

/**
 * Social Media Manager's server side: WorkSuite's `app/Modules/SocialMedia` at `/api/social-media` (WS-SMM-SRS-001
 * §15, about fifty routes), the optional app `worksuite.social-media`.
 *
 * The SRS was written against the server branch `mail-task-details-ui`, which could not be fetched; the module is new
 * there too. Every call is therefore asked through `optional()`: a server without the module (or without one route of
 * it) answers 404/405/501, and the screen says plainly that this WorkSuite server does not offer it yet instead of
 * pretending — the Phone module's rule (NFR-10 "honest degradation"). The contract the desktop expects is written out
 * in docs/SOCIAL_MEDIA.md; shapes follow the data model (§12) with the server's usual snake_case.
 *
 * Times are UTC ISO-8601 (`2026-10-09T05:00:00Z`) or the server's UTC stamp without a zone; read them with
 * `parseTs`. Tokens never reach the desktop (NFR-04): an account carries only what was granted, never a secret.
 */

const V = '/api/social-media';

/* ======================================================================== *
 * Optional endpoints
 * ======================================================================== */

export type Optional<T> = { offered: true; data: T } | { offered: false; message: string };

export const NOT_OFFERED = 'This WorkSuite server does not have Social Media Manager yet. An administrator installs the module (app worksuite.social-media) on the server.';

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

/** A list from an optional endpoint: the rows, or [] when not offered. */
export function rowsOf<T>(o: Optional<T[]> | undefined): T[] {
  return o && o.offered ? o.data : [];
}

export function dataOf<T>(o: Optional<T> | undefined): T | null {
  return o && o.offered ? o.data : null;
}

/** A write the server does not offer yet: said in words, so the toast is honest. */
export async function write<T>(p: Promise<T>): Promise<T> {
  try {
    return await p;
  } catch (e) {
    if (isNotOffered(e)) throw new Error(NOT_OFFERED);
    throw e;
  }
}

/* ======================================================================== *
 * People, brands, module status
 * ======================================================================== */

export interface Person {
  id: number;
  name: string;
  avatar_url?: string | null;
}

export type AccessLevel = 'use' | 'publish' | 'manage';

export interface Brand {
  id: number;
  name: string;
  /** The brand's colour (#rrggbb). */
  color: string;
  /** IANA zone the brand posts in (NFR-10; Asia/Colombo by default for Livezen organisations). */
  timezone: string;
  approval_policy_id: number | null;
  approval_policy?: { id: number; name: string; steps: number } | null;
  /** Where uploads from the composer land in Drive (SMM-MED-001; "Social/" by default). */
  drive_folder?: { id: number; path: string } | null;
  accounts_count?: number;
  /** IANA zone, slots and the minimum gap the queue uses by default (SMM-ACC-010). */
  min_gap_minutes?: number | null;
}

/**
 * GET /status — proposed (G-01): the module at a glance, for the rail's badges, the kill switch banner and the
 * organisation's settings that change what the composer offers.
 */
export interface ModuleStatus {
  /** "Pause all publishing" (SMM-SCH-008, WF-16). */
  paused_all: boolean;
  paused_at?: string | null;
  paused_by?: Person | null;
  /** AI for Social is on for this organisation (SMM-AI-001). */
  ai_enabled: boolean;
  /** Alt text is required on every picture (SMM-ADM-003). */
  alt_text_required: boolean;
  default_timezone: string;
  /** Default brand for new posts. */
  default_brand_id: number | null;
  counts: {
    accounts: number;
    brands: number;
    accounts_attention: number;
    approvals_waiting: number;
    inbox_open: number;
    inbox_assigned_to_me: number;
    failed_7d: number;
    held: number;
  };
  /** The caller's social.* permissions as the server resolved them (§14), when it sends them. */
  permissions?: string[] | null;
}

/* ======================================================================== *
 * Accounts
 * ======================================================================== */

export interface Account {
  id: number;
  brand_id: number | null;
  network: Network;
  external_id: string;
  /** "@techhubiz.lk", "facebook.com/techhubiz.lk". */
  handle: string | null;
  display_name: string;
  /** "Page", "Professional", "Channel", "Location"… */
  account_type: string | null;
  avatar_url: string | null;
  status: AccountStatus;
  /** What was granted, in words ("Publish", "Inbox", "Insights") — never a scope string or a token. */
  granted: string[];
  /** Features missing because a scope or API tier was not granted (Limited). */
  missing?: string[];
  capabilities?: Partial<CapabilitySet> | null;
  token_expires_at: string | null;
  quota?: { label: string; used: number; limit: number; period: string } | null;
  webhook_state?: 'subscribed' | 'failed' | 'polling' | 'none' | null;
  last_sync_at: string | null;
  last_error_code?: string | null;
  last_error_message?: string | null;
  connected_by?: Person | null;
  connected_at?: string | null;
  /** Per-account pause (SMM-PUB-010). */
  paused?: boolean;
  /** Posts on hold because of this account (expired access, pause). */
  held_posts?: number;
  /** The caller's level on this account (SMM-ACC-011). */
  my_level?: AccessLevel | null;
}

export interface AccessEntry {
  principal_type: 'user' | 'team' | 'role';
  principal_id: number;
  name: string;
  level: AccessLevel;
}

export interface ConnectStart {
  /** The network's consent page (own app) or the WorkSuite Cloud relay (shared mode) — opened in the browser. */
  redirect_url: string;
  state_expires_at?: string | null;
}

/** After the browser comes back: the pages, profiles, channels or locations the user may add (WF-01 step 5). */
export interface ConnectableAsset {
  external_id: string;
  network: Network;
  display_name: string;
  handle: string | null;
  account_type: string | null;
  avatar_url?: string | null;
  already_connected: boolean;
  missing?: string[];
}

/* ======================================================================== *
 * Posts and targets
 * ======================================================================== */

export interface PostMedia {
  id?: number;
  /** The Drive file (CoreFileReference); media never live outside Drive (SMM-MED-001). */
  file_id: number;
  name: string;
  kind: MediaKind;
  mime?: string | null;
  width?: number | null;
  height?: number | null;
  duration_seconds?: number | null;
  bytes?: number | null;
  alt_text?: string | null;
  /** A small preview the server makes; absent for files without one. */
  thumb_url?: string | null;
  crop?: { ratio: string } | null;
  sort?: number;
}

export interface TargetOptions {
  first_comment?: string | null;
  thread_parts?: string[] | null;
  title?: string | null;
  privacy?: 'public' | 'unlisted' | 'private' | null;
  board?: string | null;
  cta?: { type: string; url?: string | null } | null;
  offer?: { starts_on?: string | null; ends_on?: string | null; coupon?: string | null } | null;
  post_kind?: PostKind | null;
}

export interface Target {
  id: number;
  account_id: number;
  network: Network;
  /** Edited away from the Original (SMM-CMP-002). */
  customised: boolean;
  text: string | null;
  media?: PostMedia[] | null;
  options: TargetOptions;
  status: TargetStatus;
  run_at: string | null;
  published_at: string | null;
  external_post_id?: string | null;
  permalink: string | null;
  error_class?: ErrorClass | null;
  error_message?: string | null;
  attempts?: number;
  is_manual_reminder?: boolean;
  hold_reason?: string | null;
  metrics?: { reach: number | null; impressions: number | null; engagements: number | null; clicks: number | null } | null;
}

export interface ApprovalStep {
  index: number;
  label: string;
  kind: 'user' | 'role' | 'team' | 'external';
  approvers: Person[];
  external_name?: string | null;
  state: 'waiting' | 'current' | 'approved' | 'changes_requested' | 'rejected' | 'skipped';
  decided_by?: Person | null;
  decided_at?: string | null;
  comment?: string | null;
  reply_due_at?: string | null;
  /** "you" — the caller decides this step. */
  mine?: boolean;
}

export interface Approval {
  request_id: number;
  state: 'pending' | 'approved' | 'changes_requested' | 'rejected';
  current_step: number;
  steps: ApprovalStep[];
  submitted_by?: Person | null;
  submitted_at?: string | null;
  /** The caller may decide the current step. */
  can_decide: boolean;
}

export interface PostLink {
  url: string;
  tracking: boolean;
  short_url?: string | null;
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
}

export type ScheduleMode = 'now' | 'at' | 'queue' | 'best';

export interface Post {
  id: number;
  brand_id: number | null;
  campaign_id: number | null;
  campaign?: { id: number; name: string } | null;
  internal_title?: string | null;
  base_text: string;
  status: PostStatus;
  schedule_mode: ScheduleMode | null;
  scheduled_at: string | null;
  entered_timezone: string | null;
  approval?: Approval | null;
  owner?: Person | null;
  created_by?: Person | null;
  labels: string[];
  evergreen?: boolean;
  recurrence_rule?: string | null;
  source?: 'composer' | 'csv' | 'api' | 'module';
  /** Optimistic version (SMM-CMP-011). */
  version: number;
  media: PostMedia[];
  targets: Target[];
  first_comment?: string | null;
  link?: PostLink | null;
  created_at?: string | null;
  updated_at?: string | null;
  /** "Publish when approved" if the time passes while in review (WF-04 step 5). */
  publish_when_approved?: boolean;
}

/** What the composer sends: the Original plus one variant per chosen account. */
export interface PostInput {
  brand_id: number | null;
  campaign_id?: number | null;
  internal_title?: string | null;
  base_text: string;
  media: PostMedia[];
  labels: string[];
  first_comment?: string | null;
  link?: PostLink | null;
  targets: Array<{ account_id: number; customised: boolean; text: string | null; media?: PostMedia[] | null; options: TargetOptions }>;
  version?: number;
}

export interface PostEvent {
  id: number;
  type: 'created' | 'edited' | 'status' | 'approval' | 'publish' | 'comment' | 'ai_used';
  actor?: Person | null;
  target_id?: number | null;
  text: string;
  created_at: string;
}

export interface PostComment {
  id: number;
  author?: Person | null;
  /** An external reviewer's name (WF-14). */
  reviewer_name?: string | null;
  body: string;
  created_at: string;
  edited_at?: string | null;
}

export interface ReviewLink {
  id: number;
  url: string;
  reviewer_name: string | null;
  reviewer_email: string | null;
  expires_at: string;
  revoked_at?: string | null;
  last_used_at?: string | null;
  access_code?: string | null;
}

export interface PostFilters {
  from?: string;
  to?: string;
  brand_id?: number | null;
  account_id?: number | null;
  network?: string | null;
  status?: string | null;
  label?: string | null;
  campaign_id?: number | null;
  owner_id?: number | null;
  /** Unscheduled drafts (SMM-SCH-005). */
  unscheduled?: boolean;
  q?: string | null;
  limit?: number;
}

/** The server refused a save because someone else saved first (SMM-CMP-011). */
export interface VersionConflict {
  current: Post;
  by?: Person | null;
}

/* ======================================================================== *
 * Queue, slots, blackouts
 * ======================================================================== */

export interface QueueSlot {
  id?: number;
  /** 1 = Monday … 7 = Sunday. */
  weekday: number;
  /** "09:00" on the brand's clock. */
  local_time: string;
  enabled: boolean;
  /** One of the best hours of the last 90 days (W04 star). */
  best?: boolean;
}

export interface QueueItem {
  target_id: number;
  post_id: number;
  account_id: number;
  network: Network;
  excerpt: string;
  run_at: string | null;
  status: TargetStatus;
}

export interface QueueInfo {
  brand_id: number | null;
  account_id: number | null;
  timezone: string;
  min_gap_minutes: number;
  paused: boolean;
  slots: QueueSlot[];
  next: QueueItem[];
  queued_total: number;
  /** Queued posts fill slots until this day. */
  fills_until?: string | null;
  blackouts_count: number;
  evergreen: { reshare: boolean; skip_days: number; ai_rewrite: boolean; pool: number };
}

export interface Blackout {
  id: number;
  brand_id: number | null;
  starts_at: string;
  ends_at: string;
  mode: 'hold' | 'skip';
  reason: string | null;
  created_by?: Person | null;
}

export interface NextTimes {
  /** Per account: the next free queue slot, or the best time in the next 7 days. */
  times: Array<{ account_id: number; at: string | null; label?: string | null }>;
  /** "10:00–11:00" — the design's "each account's best time is …". */
  window?: string | null;
}

/* ======================================================================== *
 * Inbox
 * ======================================================================== */

export interface ThreadRow {
  id: number;
  account_id: number;
  network: Network;
  kind: InboxKind;
  participant: { name: string; handle?: string | null; avatar_url?: string | null };
  excerpt: string;
  status: ThreadStatus;
  assignee?: { type: 'user' | 'team'; id: number; name: string } | null;
  sentiment?: 'positive' | 'neutral' | 'negative' | null;
  intent?: 'sales' | 'support' | 'spam' | 'other' | null;
  language?: string | null;
  rating?: number | null;
  unread: boolean;
  last_message_at: string;
  reply_due_at?: string | null;
  has_crm_contact?: boolean;
}

export interface InboxMessage {
  id: number;
  direction: 'in' | 'out' | 'note';
  author: { name: string; handle?: string | null; user_id?: number | null };
  body: string;
  attachments?: Array<{ name: string; url?: string | null; kind?: string | null }>;
  hidden?: boolean;
  deleted_remote?: boolean;
  ai_used?: boolean;
  created_at: string;
}

export interface Thread extends ThreadRow {
  post?: { id: number; target_id: number; excerpt: string; permalink?: string | null } | null;
  crm?: { contact_id: number; name: string; company?: string | null; deals: Array<{ id: number; name: string; amount: number | null; currency: string | null; stage: string | null }> } | null;
  ticket?: { id: number; number: string; status: string } | null;
  /** Colleagues who have it open (collision lock, SMM-INB-005). */
  viewing?: Person[];
  /** The network's reply window ends (SMM-INB-012); sending after it is refused. */
  window_ends_at?: string | null;
  /** What the network lets WorkSuite do here (SMM-INB-004). */
  actions: { reply: boolean; like: boolean; hide: boolean; delete: boolean };
  messages: InboxMessage[];
}

export interface InboxCounts {
  all_open: number;
  assigned_to_me: number;
  unassigned: number;
  comment: number;
  message: number;
  mention: number;
  review: number;
  closed_today: number;
}

export interface InboxFilters {
  view?: 'open' | 'mine' | 'unassigned' | 'closed_today' | null;
  kind?: InboxKind | null;
  account_id?: number | null;
  brand_id?: number | null;
  sentiment?: string | null;
  language?: string | null;
  has_crm?: boolean | null;
  q?: string | null;
}

export interface SavedReply {
  id: number;
  brand_id: number | null;
  name: string;
  shortcut: string | null;
  body: string;
}

export interface InboxRule {
  id: number;
  priority: number;
  name: string;
  /** In words ("Messages on TechHubiz Sri Lanka containing 'price'"). */
  summary: string;
  enabled: boolean;
}

export interface AiReply {
  reply: string;
  sentiment?: string | null;
  intent?: string | null;
  language?: string | null;
  summary?: string | null;
}

/* ======================================================================== *
 * Analytics
 * ======================================================================== */

export interface Kpi {
  /** null = not measured (a missing scope), never a zero (WF-12). */
  value: number | null;
  /** Change against the previous period. */
  delta: number | null;
  /** The delta is in points (a rate), not a percentage. */
  delta_kind?: 'pct' | 'pt' | 'abs' | 'min';
}

export interface AnalyticsOverview {
  range: { from: string; to: string };
  previous: { from: string; to: string };
  kpis: { followers: Kpi; reach: Kpi; impressions: Kpi; engagement_rate: Kpi; link_clicks: Kpi; median_reply_minutes: Kpi };
  series: Array<{ date: string; reach: number | null; engagements: number | null }>;
  by_account: Array<{ account_id: number; network: Network; name: string; posts: number; reach: number | null; engagement_rate: number | null; clicks: number | null; followers_delta: number | null }>;
  /** Per network and metric, the network's own definition (SMM-ANL-008). */
  definitions?: Partial<Record<Network, Record<string, string>>>;
  /** Metrics added up across networks that define them differently: shown with a warning. */
  mixed_definitions?: string[];
}

export interface PostPerformance {
  target_id: number;
  post_id: number;
  account_id: number;
  network: Network;
  account: string;
  excerpt: string;
  published_at: string;
  reach: number | null;
  impressions: number | null;
  engagements: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  clicks: number | null;
  video_views: number | null;
  labels?: string[];
  campaign?: string | null;
}

export interface Heatmap {
  timezone: string;
  days: number;
  /** 7 rows (Mon…Sun) × 24 hours, engagement per post published in that hour; null where there is too little data. */
  cells: Array<Array<number | null>>;
  best?: Array<{ weekday: number; hour: number }>;
}

export interface InboxMetrics {
  volume: number;
  median_first_reply_minutes: number | null;
  median_resolution_minutes: number | null;
  by_agent: Array<{ name: string; replies: number; median_first_reply_minutes: number | null }>;
  by_brand: Array<{ name: string; volume: number; median_first_reply_minutes: number | null }>;
}

export interface ReportSchedule {
  id: number;
  name: string;
  frequency: 'daily' | 'weekly' | 'monthly';
  format: 'pdf' | 'xlsx';
  recipients: string[];
  next_run_at: string | null;
}

export interface AnalyticsQuery {
  from: string;
  to: string;
  brand_id?: number | null;
  account_id?: number | null;
}

/* ======================================================================== *
 * Library and campaigns
 * ======================================================================== */

export type LibraryKind = 'media' | 'template' | 'caption' | 'hashtag_set' | 'evergreen';

export interface LibraryItem {
  id: number;
  brand_id: number | null;
  kind: LibraryKind;
  name: string;
  /** The text of a template, caption or hashtag set. */
  text?: string | null;
  tags: string[];
  usage_count: number;
  last_used_at?: string | null;
  created_by?: Person | null;
  media?: (PostMedia & { drive_path?: string | null; fits?: Network[]; licence?: string | null; licence_expired?: boolean }) | null;
}

export interface Campaign {
  id: number;
  brand_id: number | null;
  brand?: string | null;
  name: string;
  goal: string | null;
  starts_on: string | null;
  ends_on: string | null;
  owner?: Person | null;
  utm: { campaign: string | null; medium: string | null; source?: string | null };
  short_domain?: string | null;
  status: CampaignStatus;
  budget_note?: string | null;
  posts_planned: number;
  posts_published: number;
  clicks: number | null;
  crm_leads: number | null;
  results?: { reach: number | null; engagements: number | null; clicks: number | null; form_submissions: number | null; crm_leads: number | null } | null;
}

export type CampaignInput = Partial<Pick<Campaign, 'brand_id' | 'name' | 'goal' | 'starts_on' | 'ends_on' | 'short_domain' | 'status' | 'budget_note'>> & { owner_id?: number | null; utm?: Campaign['utm'] };

/* ======================================================================== *
 * Publishing log and settings
 * ======================================================================== */

export interface Attempt {
  id: number;
  job_id: number;
  target_id: number;
  post_id: number;
  post_excerpt: string;
  account_id: number;
  network: Network;
  account: string;
  started_at: string;
  finished_at: string | null;
  outcome: AttemptOutcome;
  http_status?: number | null;
  provider_code?: string | null;
  error_class?: ErrorClass | null;
  /** The redacted detail (SMM-AUD-004): never a token or a full message body. */
  detail?: string | null;
  permalink?: string | null;
  attempt: number;
  max_attempts: number;
  reminder_to?: Person | null;
}

export interface PublishLog {
  attempts: Attempt[];
  totals: { jobs: number; first_try_rate: number | null; retried_then_succeeded: number; failed: number; failed_note?: string | null };
  counts: { failed: number; manual: number; retrying: number };
  next_cursor?: string | null;
}

export type SettingsSection = 'general' | 'access' | 'permissions' | 'organization' | 'providers' | 'publishing' | 'approvals' | 'inbox' | 'notifications' | 'advanced';

export type SettingValue = string | number | boolean | null | string[];

export interface SettingsPage {
  section: SettingsSection;
  values: Record<string, SettingValue>;
}

export interface ProviderApp {
  network: 'meta' | 'linkedin' | 'x' | 'youtube' | 'tiktok' | 'google_business' | 'pinterest';
  label: string;
  product: string;
  covers: string;
  mode: 'shared' | 'own';
  enabled: boolean;
  client_id: string | null;
  has_secret: boolean;
  secret_set_at: string | null;
  status: 'live' | 'approved' | 'limited' | 'review_pending' | 'audit_pending' | 'not_configured';
  status_note?: string | null;
  tier?: string | null;
  webhook?: 'subscribed' | 'failed' | 'none' | null;
}

export interface ProviderApps {
  redirect_uri: string;
  apps: ProviderApp[];
}

export interface BulkRow {
  row: number;
  text: string;
  accounts: string[];
  at: string | null;
  issues: Issue[];
}

/* ======================================================================== *
 * The client
 * ======================================================================== */

type S = AbortSignal | undefined;
const q = (f: object): Query => Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined && v !== null && v !== '')) as Query;

export const socialApi = {
  /* module */
  status: (signal?: S) => optional(apiGet<ModuleStatus>(`${V}/status`, undefined, signal)),
  pauseAll: (paused: boolean, reason?: string) => write(apiPost<{ paused_all: boolean }>(`${V}/pause-all`, { paused, reason })),

  /* brands */
  brands: (signal?: S) => optional(apiGet<{ brands: Brand[] }>(`${V}/brands`, undefined, signal).then((r) => r.brands)),
  saveBrand: (b: Partial<Brand> & { name: string }) => write(b.id ? apiPut<{ brand: Brand }>(`${V}/brands/${b.id}`, b) : apiPost<{ brand: Brand }>(`${V}/brands`, b)),

  /* accounts */
  accounts: (signal?: S) => optional(apiGet<{ accounts: Account[] }>(`${V}/accounts`, undefined, signal).then((r) => r.accounts)),
  connect: (network: Network, brandId: number | null) => write(apiPost<ConnectStart>(`${V}/accounts/connect`, { network, brand_id: brandId, client: 'desktop' })),
  connectable: (signal?: S) => optional(apiGet<{ assets: ConnectableAsset[] }>(`${V}/accounts/connect/assets`, undefined, signal).then((r) => r.assets)),
  addAssets: (externalIds: string[], brandId: number | null) => write(apiPost<{ accounts: Account[] }>(`${V}/accounts/connect/assets`, { external_ids: externalIds, brand_id: brandId })),
  reconnect: (id: number) => write(apiPost<ConnectStart>(`${V}/accounts/${id}/reconnect`, { client: 'desktop' })),
  disconnect: (id: number, futurePosts: 'cancel' | 'hold') => write(apiDelete(`${V}/accounts/${id}`, { future_posts: futurePosts })),
  access: (id: number, signal?: S) => optional(apiGet<{ access: AccessEntry[] }>(`${V}/accounts/${id}/access`, undefined, signal).then((r) => r.access)),
  saveAccess: (id: number, entries: AccessEntry[]) => write(apiPut(`${V}/accounts/${id}/access`, { entries })),
  updateAccount: (id: number, patch: { brand_id?: number | null; paused?: boolean }) => write(apiPut<{ account: Account }>(`${V}/accounts/${id}`, patch)),

  /* posts */
  posts: (f: PostFilters, signal?: S) => optional(apiGet<{ posts: Post[] }>(`${V}/posts`, q(f), signal).then((r) => r.posts)),
  post: (id: number, signal?: S) => optional(apiGet<{ post: Post; events?: PostEvent[] }>(`${V}/posts/${id}`, undefined, signal)),
  createPost: (p: PostInput) => write(apiPost<{ post: Post }>(`${V}/posts`, p)),
  updatePost: (id: number, p: PostInput) => write(apiPut<{ post: Post }>(`${V}/posts/${id}`, p)),
  validate: (id: number) => write(apiPost<{ issues: Array<Issue & { target_id?: number | null }> }>(`${V}/posts/${id}/validate`)),
  schedule: (id: number, body: { mode: ScheduleMode; at?: string | null; timezone: string; publish_when_approved?: boolean }) => write(apiPost<{ post: Post }>(`${V}/posts/${id}/schedule`, body)),
  submit: (id: number, body: { publish_when_approved?: boolean } = {}) => write(apiPost<{ post: Post }>(`${V}/posts/${id}/submit`, body)),
  decide: (id: number, decision: 'approve' | 'changes' | 'reject', comment?: string) => write(apiPost<{ post: Post }>(`${V}/posts/${id}/decision`, { decision, comment })),
  cancel: (id: number) => write(apiPost<{ post: Post }>(`${V}/posts/${id}/cancel`)),
  duplicate: (id: number) => write(apiPost<{ post: Post }>(`${V}/posts/${id}/duplicate`)),
  deletePost: (id: number) => write(apiDelete(`${V}/posts/${id}`)),
  comments: (id: number, signal?: S) => optional(apiGet<{ comments: PostComment[] }>(`${V}/posts/${id}/comments`, undefined, signal).then((r) => r.comments)),
  addComment: (id: number, body: string, mentions: number[] = []) => write(apiPost<{ comment: PostComment }>(`${V}/posts/${id}/comments`, { body, mentions })),
  reviewLinks: (id: number, signal?: S) => optional(apiGet<{ links: ReviewLink[] }>(`${V}/posts/${id}/review-links`, undefined, signal).then((r) => r.links)),
  createReviewLink: (id: number, body: { reviewer_name?: string; reviewer_email?: string; expires_in_days: number; access_code?: boolean }) => write(apiPost<{ link: ReviewLink }>(`${V}/posts/${id}/review-links`, body)),
  revokeReviewLink: (postId: number, linkId: number) => write(apiDelete(`${V}/posts/${postId}/review-links/${linkId}`)),

  /* targets */
  retry: (targetId: number) => write(apiPost(`${V}/targets/${targetId}/retry`)),
  markPosted: (targetId: number, permalink?: string | null) => write(apiPost(`${V}/targets/${targetId}/mark-posted`, { permalink: permalink || null })),
  deleteRemote: (targetId: number) => write(apiDelete(`${V}/targets/${targetId}/remote`)),

  /* media */
  renditions: (fileIds: number[], accountIds: number[]) => write(apiPost<{ media: PostMedia[] }>(`${V}/media/renditions`, { file_ids: fileIds, account_ids: accountIds })),

  /* AI (CoreAIService; always a suggestion, SMM-AI-004) */
  aiCompose: (body: { action: 'write' | 'rewrite' | 'shorten' | 'tone' | 'translate' | 'hashtags' | 'alt_text'; text?: string; network?: string | null; tone?: string | null; language?: string | null; brief?: string | null; file_id?: number | null }) =>
    write(apiPost<{ suggestion: string; options?: string[] }>(`${V}/ai/compose`, body)),

  /* queue */
  queue: (scope: { brand_id?: number | null; account_id?: number | null }, signal?: S) => optional(apiGet<QueueInfo>(`${V}/queue/slots`, q(scope), signal)),
  saveSlots: (scope: { brand_id?: number | null; account_id?: number | null }, body: { slots: QueueSlot[]; min_gap_minutes?: number }) => write(apiPut<QueueInfo>(`${V}/queue/slots`, { ...q(scope), ...body })),
  reorderQueue: (scope: { brand_id?: number | null; account_id?: number | null }, body: { target_ids?: number[]; shuffle?: boolean }) => write(apiPost(`${V}/queue/reorder`, { ...q(scope), ...body })),
  pauseQueue: (scope: { brand_id?: number | null; account_id?: number | null }, paused: boolean) => write(apiPost(`${V}/queue/pause`, { ...q(scope), paused })),
  saveEvergreen: (scope: { brand_id?: number | null }, body: QueueInfo['evergreen']) => write(apiPut(`${V}/queue/evergreen`, { ...q(scope), ...body })),
  nextTimes: (accountIds: number[], mode: 'queue' | 'best', signal?: S) => optional(apiGet<NextTimes>(`${V}/queue/next`, { account_ids: accountIds.join(','), mode }, signal)),
  blackouts: (signal?: S) => optional(apiGet<{ blackouts: Blackout[] }>(`${V}/blackouts`, undefined, signal).then((r) => r.blackouts)),
  addBlackout: (b: Omit<Blackout, 'id' | 'created_by'>) => write(apiPost<{ blackout: Blackout }>(`${V}/blackouts`, b)),
  deleteBlackout: (id: number) => write(apiDelete(`${V}/blackouts/${id}`)),

  /* bulk (WF-15) */
  bulkPreview: (fileId: number) => write(apiPost<{ rows: BulkRow[] }>(`${V}/bulk/preview`, { file_id: fileId })),
  bulkCommit: (fileId: number, skipRows: number[]) => write(apiPost<{ created: number }>(`${V}/bulk/commit`, { file_id: fileId, skip_rows: skipRows })),

  /* library */
  library: (f: { kind: LibraryKind; brand_id?: number | null; q?: string | null; type?: string | null; fits?: string | null }, signal?: S) =>
    optional(apiGet<{ items: LibraryItem[]; counts?: Partial<Record<LibraryKind, number>> }>(`${V}/library`, q(f), signal)),
  saveLibraryItem: (item: Partial<LibraryItem> & { kind: LibraryKind; name: string }) =>
    write(item.id ? apiPut<{ item: LibraryItem }>(`${V}/library/${item.id}`, item) : apiPost<{ item: LibraryItem }>(`${V}/library`, item)),
  deleteLibraryItem: (id: number) => write(apiDelete(`${V}/library/${id}`)),
  addMediaFromDrive: (fileIds: number[], brandId: number | null) => write(apiPost<{ items: LibraryItem[] }>(`${V}/library`, { kind: 'media', file_ids: fileIds, brand_id: brandId })),

  /* campaigns */
  campaigns: (signal?: S) => optional(apiGet<{ campaigns: Campaign[] }>(`${V}/campaigns`, undefined, signal).then((r) => r.campaigns)),
  campaign: (id: number, signal?: S) => optional(apiGet<{ campaign: Campaign; posts?: Post[] }>(`${V}/campaigns/${id}`, undefined, signal)),
  saveCampaign: (id: number | null, c: CampaignInput) => write(id ? apiPut<{ campaign: Campaign }>(`${V}/campaigns/${id}`, c) : apiPost<{ campaign: Campaign }>(`${V}/campaigns`, c)),

  /* inbox */
  threads: (f: InboxFilters, signal?: S) => optional(apiGet<{ threads: ThreadRow[]; counts: InboxCounts; next_cursor?: string | null }>(`${V}/inbox/threads`, q(f), signal)),
  thread: (id: number, signal?: S) => optional(apiGet<{ thread: Thread }>(`${V}/inbox/threads/${id}`, undefined, signal).then((r) => r.thread)),
  reply: (id: number, body: string, opts: { close?: boolean; ai_used?: boolean } = {}) => write(apiPost<{ message: InboxMessage }>(`${V}/inbox/threads/${id}/reply`, { body, ...opts })),
  note: (id: number, body: string) => write(apiPost<{ message: InboxMessage }>(`${V}/inbox/threads/${id}/note`, { body })),
  assign: (id: number, to: { type: 'user' | 'team'; id: number } | null) => write(apiPost(`${V}/inbox/threads/${id}/assign`, { assignee: to })),
  setThreadStatus: (id: number, status: 'closed' | 'open' | 'spam' | 'hidden') => write(apiPost(`${V}/inbox/threads/${id}/status`, { status })),
  convert: (id: number, to: 'crm_lead' | 'ticket', fields: Record<string, string>) => write(apiPost<{ crm?: Thread['crm']; ticket?: Thread['ticket'] }>(`${V}/inbox/threads/${id}/convert`, { to, fields })),
  suggestReply: (id: number) => write(apiPost<AiReply>(`${V}/inbox/threads/${id}/suggest`)),
  savedReplies: (signal?: S) => optional(apiGet<{ replies: SavedReply[] }>(`${V}/inbox/saved-replies`, undefined, signal).then((r) => r.replies)),
  saveSavedReply: (r: Partial<SavedReply> & { name: string; body: string }) =>
    write(r.id ? apiPut<{ reply: SavedReply }>(`${V}/inbox/saved-replies/${r.id}`, r) : apiPost<{ reply: SavedReply }>(`${V}/inbox/saved-replies`, r)),
  deleteSavedReply: (id: number) => write(apiDelete(`${V}/inbox/saved-replies/${id}`)),
  rules: (signal?: S) => optional(apiGet<{ rules: InboxRule[] }>(`${V}/inbox/rules`, undefined, signal).then((r) => r.rules)),
  saveRules: (rules: Array<Pick<InboxRule, 'id' | 'priority' | 'enabled'>>) => write(apiPut(`${V}/inbox/rules`, { rules })),

  /* analytics */
  overview: (f: AnalyticsQuery, signal?: S) => optional(apiGet<AnalyticsOverview>(`${V}/analytics/overview`, q(f), signal)),
  postPerformance: (f: AnalyticsQuery & { sort?: string; network?: string | null; label?: string | null; campaign_id?: number | null }, signal?: S) =>
    optional(apiGet<{ posts: PostPerformance[] }>(`${V}/analytics/posts`, q(f), signal).then((r) => r.posts)),
  heatmap: (f: Partial<AnalyticsQuery>, signal?: S) => optional(apiGet<Heatmap>(`${V}/analytics/heatmap`, q(f), signal)),
  inboxMetrics: (f: AnalyticsQuery, signal?: S) => optional(apiGet<InboxMetrics>(`${V}/analytics/inbox`, q(f), signal)),
  exportAnalytics: (f: AnalyticsQuery & { format: 'pdf' | 'xlsx' }) => write(apiPost<{ job_id: number; file_id?: number | null; message?: string | null }>(`${V}/analytics/export`, f)),
  reportSchedules: (signal?: S) => optional(apiGet<{ schedules: ReportSchedule[] }>(`${V}/reports/schedules`, undefined, signal).then((r) => r.schedules)),
  saveReportSchedule: (s: Omit<ReportSchedule, 'id' | 'next_run_at'>) => write(apiPost<{ schedule: ReportSchedule }>(`${V}/reports/schedules`, s)),

  /* log */
  log: (f: { outcome?: string | null; from?: string; to?: string; cursor?: string | null }, signal?: S) => optional(apiGet<PublishLog>(`${V}/log`, q(f), signal)),

  /* settings */
  settings: (section: SettingsSection, signal?: S) => optional(apiGet<SettingsPage>(`${V}/settings/${section}`, undefined, signal)),
  saveSettings: (section: SettingsSection, values: Record<string, SettingValue>) => write(apiPut<SettingsPage>(`${V}/settings/${section}`, { values })),
  providerApps: (signal?: S) => optional(apiGet<ProviderApps>(`${V}/settings/provider-apps`, undefined, signal)),
  saveProviderApp: (network: ProviderApp['network'], body: { mode: 'shared' | 'own'; enabled: boolean; client_id?: string | null; secret?: string | null; tier?: string | null }) =>
    write(apiPut<{ app: ProviderApp }>(`${V}/settings/provider-apps/${network}`, body)),
};

/* ======================================================================== *
 * Query keys and hooks
 * ======================================================================== */

export const SK = {
  all: ['social'] as const,
  status: ['social', 'status'] as const,
  brands: ['social', 'brands'] as const,
  accounts: ['social', 'accounts'] as const,
  connectable: ['social', 'connectable'] as const,
  access: (id: number) => ['social', 'access', id] as const,
  posts: (f: PostFilters) => ['social', 'posts', f] as const,
  postsAll: ['social', 'posts'] as const,
  post: (id: number) => ['social', 'post', id] as const,
  comments: (id: number) => ['social', 'comments', id] as const,
  reviewLinks: (id: number) => ['social', 'review-links', id] as const,
  queue: (s: { brand_id?: number | null; account_id?: number | null }) => ['social', 'queue', s.brand_id ?? null, s.account_id ?? null] as const,
  queueAll: ['social', 'queue'] as const,
  nextTimes: (ids: number[], mode: string) => ['social', 'next', mode, ids.join(',')] as const,
  blackouts: ['social', 'blackouts'] as const,
  library: (f: object) => ['social', 'library', f] as const,
  libraryAll: ['social', 'library'] as const,
  campaigns: ['social', 'campaigns'] as const,
  campaign: (id: number) => ['social', 'campaign', id] as const,
  threads: (f: InboxFilters) => ['social', 'threads', f] as const,
  threadsAll: ['social', 'threads'] as const,
  thread: (id: number) => ['social', 'thread', id] as const,
  savedReplies: ['social', 'saved-replies'] as const,
  rules: ['social', 'rules'] as const,
  overview: (f: AnalyticsQuery) => ['social', 'analytics', 'overview', f] as const,
  postPerformance: (f: object) => ['social', 'analytics', 'posts', f] as const,
  heatmap: (f: object) => ['social', 'analytics', 'heatmap', f] as const,
  inboxMetrics: (f: AnalyticsQuery) => ['social', 'analytics', 'inbox', f] as const,
  reportSchedules: ['social', 'report-schedules'] as const,
  log: (f: object) => ['social', 'log', f] as const,
  settings: (s: SettingsSection) => ['social', 'settings', s] as const,
  providerApps: ['social', 'provider-apps'] as const,
};

export function invalidateSocial(qc: QueryClient, ...keys: Array<readonly unknown[]>): void {
  for (const k of keys.length ? keys : [SK.all]) void qc.invalidateQueries({ queryKey: k });
}

export function useInvalidate(): (...keys: Array<readonly unknown[]>) => void {
  const qc = useQueryClient();
  return (...keys) => invalidateSocial(qc, ...keys);
}

export function useModuleStatus() {
  return useQuery({ queryKey: SK.status, queryFn: ({ signal }) => socialApi.status(signal), staleTime: 30_000, refetchInterval: 60_000 });
}

export function useBrands() {
  return useQuery({ queryKey: SK.brands, queryFn: ({ signal }) => socialApi.brands(signal), staleTime: 60_000 });
}

export function useAccounts() {
  return useQuery({ queryKey: SK.accounts, queryFn: ({ signal }) => socialApi.accounts(signal), staleTime: 30_000, refetchInterval: 120_000 });
}

export function useAccess(id: number | null) {
  return useQuery({ queryKey: SK.access(id ?? 0), queryFn: ({ signal }) => socialApi.access(id!, signal), enabled: !!id });
}

export function usePosts(f: PostFilters, enabled = true) {
  return useQuery({ queryKey: SK.posts(f), queryFn: ({ signal }) => socialApi.posts(f, signal), enabled, staleTime: 15_000 });
}

export function usePost(id: number | null) {
  return useQuery({ queryKey: SK.post(id ?? 0), queryFn: ({ signal }) => socialApi.post(id!, signal), enabled: !!id });
}

export function useComments(id: number | null) {
  return useQuery({ queryKey: SK.comments(id ?? 0), queryFn: ({ signal }) => socialApi.comments(id!, signal), enabled: !!id });
}

export function useReviewLinks(id: number | null) {
  return useQuery({ queryKey: SK.reviewLinks(id ?? 0), queryFn: ({ signal }) => socialApi.reviewLinks(id!, signal), enabled: !!id });
}

export function useQueue(scope: { brand_id?: number | null; account_id?: number | null }) {
  return useQuery({ queryKey: SK.queue(scope), queryFn: ({ signal }) => socialApi.queue(scope, signal) });
}

export function useNextTimes(accountIds: number[], mode: 'queue' | 'best', enabled = true) {
  return useQuery({ queryKey: SK.nextTimes(accountIds, mode), queryFn: ({ signal }) => socialApi.nextTimes(accountIds, mode, signal), enabled: enabled && accountIds.length > 0, staleTime: 60_000 });
}

export function useBlackouts() {
  return useQuery({ queryKey: SK.blackouts, queryFn: ({ signal }) => socialApi.blackouts(signal) });
}

export function useLibrary(f: { kind: LibraryKind; brand_id?: number | null; q?: string | null; type?: string | null; fits?: string | null }) {
  return useQuery({ queryKey: SK.library(f), queryFn: ({ signal }) => socialApi.library(f, signal) });
}

export function useCampaigns() {
  return useQuery({ queryKey: SK.campaigns, queryFn: ({ signal }) => socialApi.campaigns(signal) });
}

export function useCampaign(id: number | null) {
  return useQuery({ queryKey: SK.campaign(id ?? 0), queryFn: ({ signal }) => socialApi.campaign(id!, signal), enabled: !!id });
}

export function useThreads(f: InboxFilters) {
  return useQuery({ queryKey: SK.threads(f), queryFn: ({ signal }) => socialApi.threads(f, signal), refetchInterval: 30_000 });
}

export function useThread(id: number | null) {
  return useQuery({ queryKey: SK.thread(id ?? 0), queryFn: ({ signal }) => socialApi.thread(id!, signal), enabled: !!id, refetchInterval: 20_000 });
}

export function useSavedReplies() {
  return useQuery({ queryKey: SK.savedReplies, queryFn: ({ signal }) => socialApi.savedReplies(signal), staleTime: 120_000 });
}

export function useInboxRules(enabled = true) {
  return useQuery({ queryKey: SK.rules, queryFn: ({ signal }) => socialApi.rules(signal), enabled });
}

export function useOverview(f: AnalyticsQuery) {
  return useQuery({ queryKey: SK.overview(f), queryFn: ({ signal }) => socialApi.overview(f, signal), staleTime: 300_000 });
}

export function usePostPerformance(f: AnalyticsQuery & { sort?: string; network?: string | null; label?: string | null; campaign_id?: number | null }) {
  return useQuery({ queryKey: SK.postPerformance(f), queryFn: ({ signal }) => socialApi.postPerformance(f, signal), staleTime: 300_000 });
}

export function useHeatmap(f: Partial<AnalyticsQuery>) {
  return useQuery({ queryKey: SK.heatmap(f), queryFn: ({ signal }) => socialApi.heatmap(f, signal), staleTime: 3_600_000 });
}

export function useInboxMetrics(f: AnalyticsQuery, enabled = true) {
  return useQuery({ queryKey: SK.inboxMetrics(f), queryFn: ({ signal }) => socialApi.inboxMetrics(f, signal), enabled, staleTime: 300_000 });
}

export function useReportSchedules(enabled = true) {
  return useQuery({ queryKey: SK.reportSchedules, queryFn: ({ signal }) => socialApi.reportSchedules(signal), enabled });
}

export function useLog(f: { outcome?: string | null; from?: string; to?: string }) {
  return useQuery({ queryKey: SK.log(f), queryFn: ({ signal }) => socialApi.log(f, signal), refetchInterval: 60_000 });
}

export function useSettings(section: SettingsSection, enabled = true) {
  return useQuery({ queryKey: SK.settings(section), queryFn: ({ signal }) => socialApi.settings(section, signal), enabled });
}

export function useProviderApps(enabled = true) {
  return useQuery({ queryKey: SK.providerApps, queryFn: ({ signal }) => socialApi.providerApps(signal), enabled });
}

/** An account by id, from the accounts list. */
export function accountById(accounts: Account[], id: number | null | undefined): Account | undefined {
  return id ? accounts.find((a) => a.id === id) : undefined;
}

/** A brand by id. */
export function brandById(brands: Brand[], id: number | null | undefined): Brand | undefined {
  return id ? brands.find((b) => b.id === id) : undefined;
}

/** The networks a post goes to, once each, in the order its targets are. */
export function postNetworks(p: Pick<Post, 'targets'>): Network[] {
  const out: Network[] = [];
  for (const t of p.targets) if (!out.includes(t.network)) out.push(t.network);
  return out;
}

/** When a post goes out: its own time, else its first target's. */
export function postWhen(p: Pick<Post, 'scheduled_at' | 'targets'>): string | null {
  if (p.scheduled_at) return p.scheduled_at;
  const times = p.targets.map((t) => t.published_at ?? t.run_at).filter((x): x is string => !!x).sort();
  return times[0] ?? null;
}

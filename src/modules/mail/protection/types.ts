/**
 * Mail protection (ENH-MAIL-04): every shape this app reads from or sends to the WorkSuite server's protection API,
 * in one place. The server is the Mail module's Protection service (`/api/mail/...` for the person,
 * `/api/admin/mail/...` for the Admin Center); the answers come in the usual `{status, message, data}` envelope and
 * these are their `data`.
 *
 * Honesty rules the screens keep (spec §1, MPR-SVC-06, AC-MPR-04/16): an engine error or timeout is UNSCANNED, never
 * CLEAN; "Not scanned" is never shown as scanned; MALWARE is never released by anyone, so no screen offers a Release
 * for it; a silent drop is never an action.
 */

/** CHECKING is a display state only: no verdict yet. The server never stores it as a result. */
export type Verdict = 'CLEAN' | 'BULK' | 'SPAM' | 'HIGH_SPAM' | 'PHISH' | 'SPOOF' | 'MALWARE' | 'POLICY' | 'UNSCANNED' | 'CHECKING';

export type ProtectionAction = 'deliver' | 'tag' | 'junk' | 'quarantine' | 'reject' | 'strip_attachment' | 'hold';

export type ProtectionPath = 'gateway' | 'post' | 'outbound';

/** Who may let it out: the person themselves (spam), an admin on request (phish, spoof, policy), or nobody (malware). */
export type ReleaseRule = 'self' | 'request' | 'never';

export type AttachmentStatus = 'scanned' | 'checking' | 'blocked' | 'unscanned';

/** A reason in plain words: "The sender's domain failed DMARC (p=reject)". */
export interface Reason {
  code: string;
  text: string;
}

export type BannerAction = 'junk' | 'not_junk' | 'release' | 'request_release' | 'report_phish' | 'trust_sender' | 'block_sender' | 'scan_now' | 'headers';

export interface ProtectionBanner {
  tone: 'info' | 'warn' | 'danger' | 'neutral';
  title: string;
  text: string;
  actions: BannerAction[];
}

export interface AttachmentScan {
  /** The attachment's part, as the message's attachments name it (`ref`). */
  id: string;
  name: string;
  size: number;
  sha256: string | null;
  status: AttachmentStatus;
  threat: string | null;
  reason: string | null;
}

/** GET /api/mail/messages/{id}/protection */
export interface MessageProtection {
  verdict: Verdict;
  score: number | null;
  path: ProtectionPath | null;
  action: ProtectionAction | null;
  policy: { id: number; name: string; version: number } | null;
  reasons: Reason[];
  banner: ProtectionBanner | null;
  attachments: AttachmentScan[];
  images_blocked: boolean;
  links_as_text: boolean;
  quarantine_id: number | null;
  release: ReleaseRule | null;
}

/** POST /api/mail/attachments/scan */
export interface AttachmentScanResult {
  status: AttachmentStatus;
  threat: string | null;
  reason: string | null;
}

/**
 * POST /api/mail/links/check — the click-time check (P-UI-12). The server keeps `verdict` (and `level`) in the older
 * words for installed clients and gives the new ones as `safety`; an answer with the new words in `verdict` is read too.
 */
export interface LinkCheckResult {
  verdict: 'safe' | 'suspicious' | 'dangerous' | 'unknown' | 'ok' | 'caution' | 'danger' | 'blocked';
  safety?: 'safe' | 'suspicious' | 'dangerous' | 'unknown';
  level?: 'ok' | 'caution' | 'danger' | 'blocked';
  reasons?: string[];
  reason: string | null;
  final_url: string;
  checked_at: string;
}

export type QuarantineState = 'held' | 'requested' | 'released' | 'deleted' | 'expired';

export interface QuarantineRequest {
  state: string;
  note: string | null;
  decided_at: string | null;
  decision_note: string | null;
}

export interface QuarantineItem {
  id: number;
  received_at: string;
  sender: string;
  sender_name: string | null;
  recipient: string;
  subject: string;
  verdict: Verdict;
  score: number | null;
  reasons: Reason[];
  attachments: Array<{ name: string; size: number; blocked: boolean }>;
  size: number;
  path: ProtectionPath | null;
  state: QuarantineState;
  expires_at: string | null;
  release: ReleaseRule;
  request: QuarantineRequest | null;
  account: { id: number; email: string } | null;
}

export interface QuarantineCounts {
  held: number;
  requested: number;
  released: number;
}

/** GET /api/mail/quarantine */
export interface QuarantinePage {
  items: QuarantineItem[];
  total: number;
  counts: QuarantineCounts;
}

export type ListScope = 'org' | 'domain' | 'group' | 'user';

export interface ListEntry {
  id: number;
  scope: ListScope;
  scope_label: string;
  kind: 'allow' | 'block';
  value_type: 'address' | 'domain' | 'ip';
  value: string;
  reason: string | null;
  expires_at: string | null;
  created_by: string | null;
  created_at: string;
  migrated: boolean;
}

/** GET /api/mail/protection/lists/me */
export interface MyLists {
  allow: ListEntry[];
  block: ListEntry[];
}

export interface ProtectedAccount {
  id: number;
  email: string;
  provider: string;
  state: 'protected' | 'scanning_on_open' | 'waiting' | 'off';
  policy: { id: number; name: string; source: string };
}

/** GET/PUT /api/mail/protection/settings */
export interface ProtectionSettings {
  digest: 'daily' | 'weekly' | 'off';
  junk_level: 'standard' | 'strict';
  accounts: ProtectedAccount[];
  link_check: boolean;
}

/** Why a send was refused (P-UI-15): a file with malware (the draft is kept), or the mailbox's sending paused. */
export type SendBlock =
  | { kind: 'malware'; attachment: string | null; threat: string | null; message: string }
  | { kind: 'paused'; reason: string | null; message: string };

// ── Admin Center › Mail & Communication › Protection ───────────────────────────────────────────────

export type EngineKey = 'rspamd' | 'clamd' | 'freshclam' | 'reputation' | 'post_delivery' | 'icap';

export interface EngineStatus {
  key: EngineKey;
  name: string;
  version: string | null;
  state: 'ok' | 'warn' | 'down' | 'off';
  detail: string;
  signature_version: string | null;
  signature_age_s: number | null;
  last_update_at: string | null;
  last_update_result: string | null;
  checked_at: string;
}

export interface OverviewTiles {
  checked: number;
  clean: number;
  junk: number;
  junk_not_junk: number;
  quarantined: number;
  held_now: number;
  requests: number;
  refused: number;
  malware: number;
  malware_in: number;
  malware_out: number;
}

export interface ProtectionOverview {
  tiles: OverviewTiles;
  daily: Array<{ date: string; clean: number; junk: number; quarantined: number; refused: number }>;
  engines: EngineStatus[];
  targets: Array<{ user_id: number | null; name: string; verdict: Verdict; count: number }>;
  malware: Array<{ threat: string; at: string; file: string; recipient: string; path: ProtectionPath | string; outcome: string }>;
  alerts: Array<{ tone: 'danger' | 'warn' | 'neutral'; title: string; text: string; link: string | null }>;
}

/** The verdicts a policy acts on per path. */
export type ActedVerdict = 'BULK' | 'SPAM' | 'HIGH_SPAM' | 'PHISH' | 'SPOOF' | 'MALWARE' | 'POLICY';

export interface PolicySettings {
  thresholds: { junk: number; quarantine: number; reject: number };
  actions: Record<ProtectionPath, Partial<Record<ActedVerdict, ProtectionAction>>>;
  fail_mode: Record<ProtectionPath, ProtectionAction>;
  attachments: AttachmentRules;
  links: { click_check: boolean; rewrite: boolean };
  quarantine_days: number;
  digest: 'daily' | 'weekly' | 'off';
  user_release: boolean;
  provider_changes: 'off' | 'junk' | 'full';
  subject_tag: boolean;
  greylisting: boolean;
  outbound: { per_hour: number; per_day: number; recipients_per_message: number; spam_threshold: number; pause_on_compromise: boolean };
}

export interface AttachmentRules {
  blocked_types: string[];
  double_extensions: boolean;
  archive_depth: number;
  encrypted: 'deliver_locked' | 'quarantine';
  macros: 'tag' | 'quarantine';
  html_smuggling: boolean;
  max_scan_mb: number;
  strip_and_notice: boolean;
}

export interface PolicyAssignment {
  id: number;
  scope_type: 'org' | 'domain' | 'group' | 'mailbox';
  scope_id: number | null;
  label: string;
}

export interface Policy {
  id: number;
  name: string;
  base: 'standard' | 'strict' | 'custom';
  version: number;
  settings: PolicySettings;
  assignments: PolicyAssignment[];
  counts: { mailboxes: number };
  updated_at: string;
  updated_by: string | null;
}

export interface PolicyPreview {
  days: number;
  changes: Array<{ verdict: Verdict; from_action: ProtectionAction; to_action: ProtectionAction; count: number }>;
  totals: Record<string, number>;
}

export interface SelfTest {
  ran_at: string;
  paths: Array<{ path: string; kind: string; expected: string; got: string; passed: boolean }>;
}

export interface PolicyVersion {
  version: number;
  created_at: string;
  created_by: string | null;
  note: string | null;
  current?: boolean;
}

export interface AdminQuarantineItem extends QuarantineItem {
  recipients: string[];
  headers_available: boolean;
  message_id_header: string | null;
  policy: { id: number; name: string; version: number } | null;
}

export interface AdminQuarantineDetail extends AdminQuarantineItem {
  headers: string;
  verdict_detail: { symbols: Array<{ name: string; score: number; text: string }>; av: { threat: string; engine: string; signature_version: string } | null };
}

export interface AdminQuarantinePage {
  items: AdminQuarantineItem[];
  total: number;
  counts: QuarantineCounts;
}

export interface EnginesAnswer {
  hosts: Array<{ id: number; name: string; engines: EngineStatus[] }>;
  log: Array<{ at: string; operation: string; actor: string | null; result: string; detail: string | null }>;
}

export interface ReportsAnswer {
  rows: Array<{ date: string; policy: string; scanned: number; delivered: number; junk: number; quarantined: number; rejected: number; released: number; fp_reports: number; missed_spam: number }>;
  by_threat: Array<{ threat: string; count: number }>;
  rates: Array<{ policy: string; fp_rate: number; missed_rate: number }>;
}

export interface AttachmentsAnswer extends AttachmentRules {
  types_catalogue: Array<{ ext: string; group: string }>;
}

export interface SearchRemoveQuery {
  message_id?: string;
  sender?: string;
  subject?: string;
  sha256?: string;
  url?: string;
  from?: string;
  to?: string;
  reason: string;
}

export interface SearchRemovePreview {
  matches: Array<{ mailbox_id: number; email: string; kind: 'local' | 'external'; can_remove: boolean; count: number }>;
}

export interface SearchRemoveRun {
  job_id: string;
  removed: number;
  hidden_only: string[];
}

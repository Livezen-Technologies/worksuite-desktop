/**
 * New-mail alerts (ENH-MAIL-05): the rules, apart from Electron and React, so the main process, the in-app card and
 * the tests all read the same ones.
 *
 *  - what a `mail.received` event says, and which ones never alert (MNA-EVT-01/02, MNA-GRP-03);
 *  - where an alert goes on this computer (Section 3.1, MNA-EVT-05): the row in the list, an in-app card, a
 *    native notification, or nothing but the badge;
 *  - grouping (Section 3.3, MNA-GRP-01/02) and what each alert shows at each preview level (MNA-PRV);
 *  - pausing (MNA-TRY-02/04) and the unread count on the badge (MNA-TRY-03).
 */

/** What an alert may show (MNA-PRV-01): sender and preview, sender only, or nothing but the account. */
export type PreviewLevel = 'full' | 'sender' | 'hidden';

export const PREVIEW_LEVELS: readonly PreviewLevel[] = ['full', 'sender', 'hidden'];

const PREVIEW_RANK: Record<PreviewLevel, number> = { full: 0, sender: 1, hidden: 2 };

export function isPreviewLevel(v: unknown): v is PreviewLevel {
  return v === 'full' || v === 'sender' || v === 'hidden';
}

/** The stricter of two levels; anything unknown counts for nothing. */
export function stricterPreview(a: PreviewLevel, b: unknown): PreviewLevel {
  return isPreviewLevel(b) && PREVIEW_RANK[b] > PREVIEW_RANK[a] ? b : a;
}

/** The desktop's own notification privacy as a preview level (its organisation minimum applies to mail too). */
export function previewOfPrivacy(p: 'FULL' | 'SENDER_ONLY' | 'GENERIC' | null | undefined): PreviewLevel {
  return p === 'GENERIC' ? 'hidden' : p === 'SENDER_ONLY' ? 'sender' : 'full';
}

/** The protection verdict an event carries (ENH-MAIL-04). */
export type Verdict = 'clean' | 'bulk' | 'unknown' | 'blocked';

/** One new message, as an alert needs it (the `mail.received` payload, §7). */
export interface MailArrival {
  /** `mailbox:folder:uid`: one alert per message per device, whichever way it was heard of (NFR-MNA-03). */
  key: string;
  mailbox: number;
  folder: string;
  uid: number;
  account: string;
  /** The conversation: a new message in it replaces its alert (tag per conversation, MNA-WIN-06). */
  conversation: string;
  fromName: string | null;
  fromAddr: string | null;
  subject: string;
  /** Up to 160 characters; empty when the server left it out (privacy Hidden, confidential). */
  preview: string;
  importance: 'high' | 'normal' | 'low';
  attachments: number;
  verdict: Verdict;
  /** Marked confidential or encrypted, or under a private label: never a preview (MNA-PRV-03). */
  confidential: boolean;
  external: boolean;
  /** When it arrived (ms). */
  at: number;
  /** The level the server wrote the event at (it leaves out what that level hides): never shown fuller here. */
  level: PreviewLevel | null;
}

const BLOCKED_VERDICTS = new Set(['spam', 'junk', 'quarantine', 'quarantined', 'rejected', 'reject', 'checking', 'pending', 'malware', 'virus', 'phish', 'phishing', 'blocked']);
/** First sync, re-sync, backfill, imports and migrations (MNA-GRP-03): never an alert. */
const QUIET_SOURCES = new Set(['initial', 'first_sync', 'resync', 're-sync', 'backfill', 'import', 'imports', 'migration', 'migrate', 'restore']);

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const int = (v: unknown): number | null => {
  const n = typeof v === 'string' && /^\d{1,15}$/.test(v) ? Number(v) : typeof v === 'number' ? v : NaN;
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};

/** The message a deep link names: `/mail/m/{mailbox}/{message}` (MNA-EVT-03), or the older `/mail?msg=…&mbx=…`. */
export function linkTarget(link: unknown): { mailbox: number; uid: number; folder: string | null } | null {
  const s = str(link);
  if (!s) return null;
  const m = /^\/mail\/m\/(\d{1,15})\/(\d{1,15})(?:[/?#]|$)/.exec(s);
  if (m) return { mailbox: Number(m[1]), uid: Number(m[2]), folder: null };
  const q = /^\/mail\?(.*)$/.exec(s);
  if (!q) return null;
  const p = new URLSearchParams(q[1]);
  const uid = int(p.get('msg'));
  const mailbox = int(p.get('mbx'));
  return uid && mailbox ? { mailbox, uid, folder: p.get('mf') } : null;
}

function verdictOf(v: unknown): Verdict {
  const s = (str(v) ?? '').toLowerCase();
  if (!s) return 'unknown';
  if (s === 'clean' || s === 'ok' || s === 'pass' || s === 'passed') return 'clean';
  if (s === 'bulk') return 'bulk';
  return BLOCKED_VERDICTS.has(s) ? 'blocked' : 'unknown';
}

/** The event's own fields: at its top, or under `data` / `payload` / `mail` (a bell entry carries them there). */
function payloadOf(raw: Record<string, unknown>): Record<string, unknown> {
  for (const k of ['data', 'payload', 'mail']) {
    const v = raw[k];
    if (v && typeof v === 'object' && !Array.isArray(v)) return { ...raw, ...(v as Record<string, unknown>) };
  }
  return raw;
}

/** Whether an event is a new-mail one, whichever way it came (Mail's own push, or the bell's). */
export function isMailReceived(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object') return false;
  const e = raw as Record<string, unknown>;
  return e.event === 'mail.received' || e.event_key === 'mail.received' || (e.type === 'mail.received');
}

/**
 * A `mail.received` event as an arrival — or null for one that must never alert: no message named, a verdict other
 * than CLEAN or BULK (MNA-EVT-02; the server holds those back, this is the second lock), or mail from a first sync,
 * a re-sync, a backfill or an import (MNA-GRP-03).
 */
export function parseArrival(raw: unknown, now = Date.now()): MailArrival | null {
  if (!raw || typeof raw !== 'object') return null;
  const e = payloadOf(raw as Record<string, unknown>);
  for (const flag of ['initial', 'backfill', 'import', 'imported', 'migration', 'resync', 'first_sync']) if (e[flag] === true || e[flag] === 1) return null;
  const source = (str(e.source) ?? str(e.origin) ?? '').toLowerCase();
  if (QUIET_SOURCES.has(source)) return null;
  const verdict = verdictOf(e.verdict ?? e.protection ?? e.protection_verdict);
  if (verdict === 'blocked') return null;
  const linked = linkTarget(e.link);
  const mailbox = int(e.mailbox_id) ?? int(e.mailbox) ?? linked?.mailbox ?? null;
  const uid = int(e.uid) ?? int(e.message_id) ?? int(e.message) ?? linked?.uid ?? null;
  if (!mailbox || !uid) return null;
  const folder = str(e.folder) ?? linked?.folder ?? 'inbox';
  const imp = (str(e.importance) ?? str(e.priority) ?? '').toLowerCase();
  const confidential = e.confidential === true || e.encrypted === true || e.private === true || (str(e.sensitivity) ?? '').toLowerCase() === 'confidential';
  const at = Date.parse(str(e.received_at) ?? str(e.date) ?? '');
  const subject = str(e.subject) ?? '';
  return {
    key: `${mailbox}:${folder}:${uid}`,
    mailbox,
    folder,
    uid,
    account: str(e.account_label) ?? str(e.account) ?? str(e.mailbox_label) ?? '',
    conversation: `${mailbox}:${str(e.conversation_key) ?? str(e.thread_id) ?? `${folder}:${uid}`}`,
    fromName: str(e.from_name) ?? null,
    fromAddr: str(e.from_addr) ?? str(e.from_email) ?? str(e.from) ?? null,
    subject: subject.slice(0, 300),
    preview: confidential ? '' : (str(e.preview) ?? '').replace(/\s+/g, ' ').slice(0, 160),
    importance: imp === 'high' || imp === 'urgent' || imp === '1' ? 'high' : imp === 'low' ? 'low' : 'normal',
    attachments: Math.max(0, Math.min(999, Number(e.attachments ?? e.attachment_count ?? 0) || 0)),
    verdict,
    confidential,
    external: e.external === true,
    at: Number.isFinite(at) && at <= now ? at : now,
    level: isPreviewLevel(e.preview_level) ? e.preview_level : null,
  };
}

/**
 * The server's "and the rest" for a burst bigger than it announces one by one (`kind: summary`, ten per run): how
 * many more arrived in which account. Null for anything else.
 */
export function parseBurstRest(raw: unknown): { mailbox: number; account: string; count: number } | null {
  if (!raw || typeof raw !== 'object') return null;
  const e = payloadOf(raw as Record<string, unknown>);
  if (e.kind !== 'summary') return null;
  const mailbox = int(e.mailbox_id) ?? int(e.mailbox);
  const count = int(e.count);
  return mailbox && count ? { mailbox, account: str(e.account_label) ?? '', count } : null;
}

/** `mail.alert_cleared` (§7, MNA-EVT-06): which messages' alerts go, on every device. */
export interface AlertCleared {
  mailbox: number;
  uids: number[];
  folder: string | null;
  reason: string;
  /** "Mark all as read" in the Inbox: every alert of the mailbox goes. */
  all: boolean;
}

export function parseCleared(raw: unknown): AlertCleared | null {
  if (!raw || typeof raw !== 'object') return null;
  const e = payloadOf(raw as Record<string, unknown>);
  if (e.event !== 'mail.alert_cleared' && e.type !== 'mail.alert_cleared') return null;
  const mailbox = int(e.mailbox_id) ?? int(e.mailbox);
  const list = Array.isArray(e.message_ids) ? e.message_ids : Array.isArray(e.uids) ? e.uids : [e.message_id ?? e.uid];
  const uids = list.map(int).filter((n): n is number => n !== null);
  const all = e.all === true;
  if (!mailbox || (!uids.length && !all)) return null;
  return { mailbox, uids, folder: str(e.folder), reason: str(e.reason) ?? 'read', all };
}

// ── where an alert goes (Section 3.1) ─────────────────────────────────────────

/** What this computer is showing, as the main process sees it and the main window reports it. */
export interface DeviceView {
  /** The main window is shown and not minimised (not closed to the tray). */
  visible: boolean;
  /** …and has the keyboard. */
  focused: boolean;
  /** The app of the main window's tab in front ("mail", "files", …). */
  module: string | null;
  /** In Mail: the place in front — `box` is a mailbox id or "unified" (All Accounts), `folder` its slug. */
  mail: { box: string; folder: string } | null;
}

/**
 * `list`: Mail shows that folder — the row appears with "New", nothing else (MNA-APP-02).
 * `card`: WorkSuite is in front — the in-app card (MNA-APP-01).
 * `native`: it is not — the operating system's notification (MNA-WIN-01).
 * `quiet`: paused, or the system's Focus / do not disturb — badge and bell only, no sound (WF-N05).
 */
export type Delivery = 'list' | 'card' | 'native' | 'quiet';

export function sameFolderShowing(view: DeviceView, a: Pick<MailArrival, 'mailbox' | 'folder'>): boolean {
  if (!view.visible || !view.focused || view.module !== 'mail' || !view.mail) return false;
  if (view.mail.folder !== a.folder) return false;
  return view.mail.box === 'unified' ? a.folder === 'inbox' : view.mail.box === String(a.mailbox);
}

export function decide(view: DeviceView, quiet: { paused: boolean; dnd: boolean }, a: Pick<MailArrival, 'mailbox' | 'folder'>): Delivery {
  if (sameFolderShowing(view, a)) return 'list';
  if (quiet.paused || quiet.dnd) return 'quiet';
  return view.visible && view.focused ? 'card' : 'native';
}

// ── grouping (Section 3.3) ────────────────────────────────────────────────────

/** How long arrivals wait to be grouped (WF-N04), the window that counts a burst, and the sound limit (MNA-GRP-04). */
export const BUFFER_MS = 2_000;
export const BURST_WINDOW_MS = 60_000;
export const BURST_LIMIT = 3;
export const SOUND_GAP_MS = 10_000;

export type GroupKind = 'single' | 'account' | 'accounts';

/** More than three within a minute become one alert: for the account, or across accounts (MNA-GRP-01/02). */
export function groupKind(recent: readonly Pick<MailArrival, 'mailbox'>[]): GroupKind {
  if (recent.length <= BURST_LIMIT) return 'single';
  return new Set(recent.map((a) => a.mailbox)).size === 1 ? 'account' : 'accounts';
}

/** The rows a group lists — two senders for an account, up to five across accounts — and how many more. */
export function groupRows<T>(kind: GroupKind, items: readonly T[]): { rows: T[]; more: number } {
  const n = kind === 'account' ? 2 : 5;
  return { rows: items.slice(0, n), more: Math.max(0, items.length - n) };
}

const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many.replace('{n}', String(n)));

/** `extra`: the server's "and the rest" beyond what it announced one by one; `accounts` adds theirs to the count. */
export function groupTitle(kind: Exclude<GroupKind, 'single'>, items: readonly Pick<MailArrival, 'mailbox' | 'account'>[], extra = 0, accounts: readonly number[] = []): string {
  const n = items.length + extra;
  if (kind === 'account') return `${plural(n, '1 new email', '{n} new emails')} in ${items[0]?.account || 'your inbox'}`;
  const k = new Set([...items.map((a) => a.mailbox), ...accounts]).size;
  return `${plural(n, '1 new email', '{n} new emails')} · ${plural(k, '1 account', '{n} accounts')}`;
}

/** "While alerts were paused: 12 new emails" (MNA-TRY-04). */
export function summaryTitle(n: number): string {
  return `While alerts were paused: ${plural(n, '1 new email', '{n} new emails')}`;
}

// ── what an alert shows (Section 3.2, MNA-WIN-02, MNA-PRV) ─────────────────────

export function senderOf(a: Pick<MailArrival, 'fromName' | 'fromAddr'>): string {
  return a.fromName || a.fromAddr || 'Unknown sender';
}

export function initialsOf(name: string): string {
  const words = name.replace(/[<>"@].*$/, '').trim().split(/\s+/).filter(Boolean);
  const letters = (words.length > 1 ? [words[0]![0], words[words.length - 1]![0]] : [words[0]?.[0], words[0]?.[1]]).filter(Boolean).join('');
  return letters.toUpperCase() || '?';
}

/** The level one alert is shown at: the person's, the organisation's minimum, screen sharing and the lock (MNA-PRV-01/02). */
export function effectivePreview(chosen: PreviewLevel, orgMin: unknown, o: { sharing: boolean; locked: boolean }): PreviewLevel {
  const level = stricterPreview(chosen, orgMin);
  return o.sharing || o.locked ? 'hidden' : level;
}

/** The tags line: importance and protection in words, never colour alone (MNA-A11-02). */
export function tagsLine(a: Pick<MailArrival, 'importance' | 'attachments' | 'verdict'>, level: PreviewLevel): string {
  if (level === 'hidden') return '';
  return [a.verdict === 'clean' ? 'Checked' : null, a.attachments ? plural(a.attachments, '1 attachment', '{n} attachments') : null].filter(Boolean).join(' · ');
}

export interface NativeContent {
  title: string;
  /** macOS shows it under the title; elsewhere its words go in the body. */
  subtitle?: string;
  body: string;
}

/** Two lines of preview, as a banner has room for. */
function twoLines(s: string): string {
  return s.length > 120 ? `${s.slice(0, 119).trimEnd()}…` : s;
}

/**
 * One message's operating-system notification (MNA-WIN-02): "WorkSuite Mail · account", the sender, the subject, two
 * lines of preview and the tags. At Hidden nothing of the message is written to the notification — so nothing of it
 * reaches the system's history either (MNA-PRV-04): "New email in {account}" (AC-MNA-08).
 */
export function nativeContent(a: MailArrival, level: PreviewLevel, platform: NodeJS.Platform | string): NativeContent {
  const head = `WorkSuite Mail · ${a.account || 'Mail'}`;
  const mac = platform === 'darwin';
  if (level === 'hidden') return { title: 'WorkSuite Mail', body: `New email in ${a.account || 'your inbox'}` };
  const high = a.importance === 'high' ? 'High importance · ' : '';
  const tags = tagsLine(a, level);
  const foot = [mac ? null : head, tags || null].filter(Boolean).join(' · ');
  if (level === 'sender') return { title: senderOf(a), ...(mac ? { subtitle: head } : {}), body: [`${high}New email`, foot].filter(Boolean).join('\n') };
  const preview = a.confidential ? '' : twoLines(a.preview);
  return { title: senderOf(a), ...(mac ? { subtitle: head } : {}), body: [`${high}${a.subject || '(no subject)'}`, preview, foot].filter(Boolean).join('\n') };
}

/** A grouped alert's notification: the title, then a line per row ("Sender — Subject") and "and N more". */
export function groupContent(kind: Exclude<GroupKind, 'single'>, items: readonly MailArrival[], level: PreviewLevel, platform: NodeJS.Platform | string, extra = 0, accounts: readonly number[] = []): NativeContent {
  const title = groupTitle(kind, items, extra, accounts);
  const rowsMore = groupRows(kind, items);
  const rows = rowsMore.rows;
  const more = rowsMore.more + extra;
  if (level === 'hidden') return { title: 'WorkSuite Mail', body: title };
  const lines = rows.map((r) => (level === 'full' ? `${senderOf(r)} — ${r.subject || '(no subject)'}` : senderOf(r)));
  if (more) lines.push(`and ${more} more`);
  return { title, ...(platform === 'darwin' ? { subtitle: 'WorkSuite Mail' } : {}), body: lines.join('\n') };
}

// ── pausing (MNA-TRY-02/04) ───────────────────────────────────────────────────

/** For 1 hour, Until tomorrow 08:00, Outside working hours, Until I turn them on — as the server names them. */
export type PauseMode = '1h' | 'tomorrow' | 'outside_hours' | 'manual';

export interface MailPause {
  mode: PauseMode;
  /** When it was paused (ISO): what arrived since is summed up on resume. */
  since: string;
  /** When it ends by itself (ISO), for 1 hour and Until tomorrow. */
  until: string | null;
}

/** The person's working hours (HR's effective work schedule): "09:00"–"17:30" on ISO weekdays 1 (Mon)…7 (Sun). */
export interface WorkingHours {
  start: string;
  end: string;
  days: number[];
}

const minutes = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

/** Tomorrow at 08:00 on this computer's clock. */
export function tomorrowAt8(now: Date): Date {
  const t = new Date(now);
  t.setDate(t.getDate() + 1);
  t.setHours(8, 0, 0, 0);
  return t;
}

export function isoWeekday(d: Date): number {
  return d.getDay() === 0 ? 7 : d.getDay();
}

/** Whether `now` is inside the working hours; a schedule that crosses midnight belongs to the day it starts. */
export function inWorkingHours(h: WorkingHours, now: Date): boolean {
  const s = minutes(h.start);
  const e = minutes(h.end);
  const n = now.getHours() * 60 + now.getMinutes();
  const today = isoWeekday(now);
  if (s === e) return false;
  if (s < e) return h.days.includes(today) && n >= s && n < e;
  const yesterday = today === 1 ? 7 : today - 1;
  return (h.days.includes(today) && n >= s) || (h.days.includes(yesterday) && n < e);
}

/** HR's effective schedule (`GET /api/hr/schedules/effective`) as working hours, or null when it has none. */
export function workingHoursOf(raw: unknown): WorkingHours | null {
  const r = raw && typeof raw === 'object' ? ((raw as { resolved?: unknown }).resolved ?? raw) : null;
  if (!r || typeof r !== 'object') return null;
  const o = r as { day_start?: unknown; day_end?: unknown; work_days?: unknown };
  const t = (v: unknown) => (typeof v === 'string' && /^\d{2}:\d{2}/.test(v) ? v.slice(0, 5) : null);
  const start = t(o.day_start);
  const end = t(o.day_end);
  const days = Array.isArray(o.work_days) ? o.work_days.map(Number).filter((d) => Number.isInteger(d) && d >= 1 && d <= 7) : [];
  return start && end && start !== end && days.length ? { start, end, days } : null;
}

/** The pause a choice starts — null for Outside working hours when there are none. */
export function startPause(mode: PauseMode, now: Date, hours: WorkingHours | null): MailPause | null {
  if (mode === 'outside_hours' && !hours) return null;
  const until = mode === '1h' ? new Date(now.getTime() + 3_600_000) : mode === 'tomorrow' ? tomorrowAt8(now) : null;
  return { mode, since: now.toISOString(), until: until ? until.toISOString() : null };
}

/** Whether a pause has run out by itself (1 hour, until tomorrow): then it ends, with its summary. */
export function pauseOver(p: MailPause | null, now: Date): boolean {
  return !!p && !!p.until && Date.parse(p.until) <= now.getTime();
}

/** Whether pop-ups and sounds are held now. Outside working hours holds them outside the hours only. */
export function pausedNow(p: MailPause | null, now: Date, hours: WorkingHours | null): boolean {
  if (!p || pauseOver(p, now)) return false;
  if (p.mode === 'outside_hours') return !!hours && !inWorkingHours(hours, now);
  return true;
}

const hhmm = (d: Date): string => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

/** "17:30–08:30": the hours outside work, as the menu says them. */
export function outsideHoursLabel(h: WorkingHours): string {
  return `${h.end}–${h.start}`;
}

/** "Paused until 11:42", "Paused until tomorrow 08:00", "Paused outside working hours", "Paused". */
export function pauseLabel(p: MailPause, now: Date): string {
  if (p.mode === 'outside_hours') return 'Paused outside working hours';
  if (!p.until) return 'Paused until you turn them on';
  const until = new Date(p.until);
  return until.toDateString() === now.toDateString() ? `Paused until ${hhmm(until)}` : `Paused until tomorrow ${hhmm(until)}`;
}

/** The pause menu's lines (D28): each choice and what it means now. */
export function pauseChoices(now: Date, hours: WorkingHours | null): Array<{ mode: PauseMode; label: string; detail: string }> {
  return [
    { mode: '1h', label: 'For 1 hour', detail: `until ${hhmm(new Date(now.getTime() + 3_600_000))}` },
    { mode: 'tomorrow', label: 'Until tomorrow', detail: '08:00' },
    ...(hours ? [{ mode: 'outside_hours' as const, label: 'Outside working hours', detail: outsideHoursLabel(hours) }] : []),
    { mode: 'manual', label: 'Until I turn them on', detail: '' },
  ];
}

// ── the badge and the tray (MNA-TRY-01/03) ─────────────────────────────────────

/** One account's line in the tray: its unread, or that it needs signing in again. */
export interface TrayMailAccount {
  id: number;
  label: string;
  unread: number;
  problem: boolean;
}

interface MailboxRow {
  id?: unknown;
  email?: unknown;
  display_name?: unknown;
  label?: unknown;
  unread?: unknown;
  in_unified?: unknown;
  archived?: unknown;
  auth_state?: unknown;
}

export function accountLabel(b: MailboxRow): string {
  return str(b.label) ?? str(b.display_name) ?? str(b.email) ?? 'Mail';
}

/** The accounts the tray lists and the badge counts: those included in All Accounts (ENH-MAIL-03), not archived. */
export function trayAccounts(raw: unknown): TrayMailAccount[] {
  const list = raw && typeof raw === 'object' && Array.isArray((raw as { mailboxes?: unknown }).mailboxes) ? (raw as { mailboxes: MailboxRow[] }).mailboxes : [];
  return list
    .filter((b) => int(b.id) && b.in_unified !== false && b.archived !== true)
    .map((b) => ({ id: int(b.id)!, label: accountLabel(b), unread: Math.max(0, Number(b.unread ?? 0) || 0), problem: b.auth_state === 'problem' }));
}

/** The unread count of the included inboxes: the badge's mail (MNA-TRY-03, MNA-APP-06). */
export function includedUnread(accounts: readonly TrayMailAccount[]): number {
  return accounts.reduce((n, a) => n + a.unread, 0);
}

/** "WorkSuite — 6 unread emails" (D28). */
export function mailTooltip(n: number): string {
  return n > 0 ? `WorkSuite — ${plural(n, '1 unread email', '{n} unread emails')}` : 'WorkSuite — no unread email';
}

// ── the in-app card (D27) ─────────────────────────────────────────────────────

/** One message's row on a card. Its subject and preview are null where the preview level hides them. */
export interface MailAlertRow {
  key: string;
  mailbox: number;
  folder: string;
  uid: number;
  account: string;
  sender: string;
  /** Only at Full: the address, on hover. */
  address: string | null;
  initials: string;
  subject: string | null;
  preview: string | null;
  high: boolean;
  attachments: number;
  checked: boolean;
  external: boolean;
  at: string;
}

/** What the main window shows (`mail-alert:show`): one message, a group, or the resume summary. */
export interface MailAlertCard {
  id: string;
  kind: GroupKind | 'summary';
  title: string;
  /** "3 accounts · last 2 min", the account, or null. */
  subtitle: string | null;
  rows: MailAlertRow[];
  more: number;
  /** High importance: it stays 15 s, not 8 (MNA-APP-04). */
  high: boolean;
  level: PreviewLevel;
  /** A quick reply is offered (one message, at Full). */
  replyable: boolean;
  /** Open Inbox (All Accounts › Inbox, MNA-APP-05), or the account's for a per-account group. */
  inbox: { label: string; route: string };
  at: string;
}

export function cardRow(a: MailArrival, level: PreviewLevel): MailAlertRow {
  const hidden = level === 'hidden';
  const sender = hidden ? 'New email' : senderOf(a);
  return {
    key: a.key,
    mailbox: a.mailbox,
    folder: a.folder,
    uid: a.uid,
    account: a.account,
    sender,
    address: level === 'full' ? a.fromAddr : null,
    initials: hidden ? '✉' : initialsOf(sender),
    subject: level === 'full' ? a.subject || '(no subject)' : null,
    preview: level === 'full' && !a.confidential && a.preview ? a.preview : null,
    high: a.importance === 'high' && !hidden,
    attachments: hidden ? 0 : a.attachments,
    checked: a.verdict === 'clean' && !hidden,
    external: a.external && !hidden,
    at: new Date(a.at).toISOString(),
  };
}

/** The route that opens one message with its account and folder selected (MNA-WIN-05, AC-MNA-11). */
export function messageRoute(a: Pick<MailArrival, 'mailbox' | 'folder' | 'uid'>, reply = false): string {
  const q = new URLSearchParams({ box: String(a.mailbox), folder: a.folder, msg: String(a.uid), mbx: String(a.mailbox) });
  if (a.folder !== 'inbox') q.set('mf', a.folder);
  if (reply) q.set('reply', '1');
  return `/mail?${q}`;
}

/** All Accounts › Inbox (MNA-APP-05), or one account's inbox. */
export function inboxRoute(mailbox: number | null): string {
  return mailbox ? `/mail?box=${mailbox}&folder=inbox` : '/mail?box=unified&folder=inbox';
}

/** How long a card stays (MNA-APP-04): 8 s, 15 s at high importance; paused while hovered, focused or typed in. */
export function cardLifetime(card: Pick<MailAlertCard, 'high'>): number {
  return card.high ? 15_000 : 8_000;
}

/** "now", "1 min", "2 min", "1 h": the card's times. */
export function ago(iso: string, now: number): string {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 45) return 'now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  return `${Math.round(m / 60)} h`;
}

/** An action a card or a notification takes on a message, or on the whole alert. */
export type MailAlertAction = 'open' | 'reply' | 'read' | 'archive' | 'flag' | 'read-all' | 'open-inbox' | 'dismiss' | 'undo';

// ── a quick reply (MNA-WIN-04) ────────────────────────────────────────────────

/** How long a reply typed in an alert waits before it goes, as Mail's own Send does ("Sending … in 8 s · Undo"). */
export const REPLY_UNDO_MS = 8_000;

/** "Re: …", once. */
export function replySubject(subject: string): string {
  const s = subject.trim() || '(no subject)';
  return /^re:/i.test(s) ? s : `Re: ${s}`;
}

const escHtml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Typed text as the mail editor writes it: a block per line, an empty line as a blank block. */
export function replyHtml(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => (line ? `<div>${escHtml(line)}</div>` : '<div><br></div>'))
    .join('');
}

/** The composer's draft key for a reply (`draftContext` in Mail's Compose): where a reply that was not sent is kept. */
export function replyDraftContext(messageId: string | null, subject: string): string {
  return `compose:reply:${messageId ?? replySubject(subject)}`;
}

// ── what the main window and the tray are told ────────────────────────────────

export interface MailAlertState {
  /** This computer's pause, for the signed-in person, or null. */
  pause: MailPause | null;
  /** Pop-ups and sounds are held right now (a pause, or outside working hours). */
  paused: boolean;
  /** "Paused until 11:42" — the tray, the Mail footer. */
  pauseLabel: string | null;
  /** The choices the pause menu offers now; Outside working hours only when HR has the person's hours. */
  pauseChoices: Array<{ mode: PauseMode; label: string; detail: string }>;
  /** Why "Outside working hours" is not offered, or null when it is. */
  hoursNote: string | null;
  /** The level alerts use now, before screen sharing and the lock. */
  preview: PreviewLevel;
  /** The organisation's minimum, when it sets one stricter than Full. */
  minPreview: PreviewLevel | null;
  /** Previews are hidden now because the screen is being shared (MNA-PRV-02). */
  sharing: boolean;
  sound: boolean;
  accounts: TrayMailAccount[];
  unread: number;
  /** There is an alert Ctrl+Shift+N can open (MNA-A11-01). */
  hasLatest: boolean;
}

// ── new mail found by the count going up (the poll, when the push was missed) ─

/** A jump this big between two looks is an import, a re-sync or a first sync, not new mail (MNA-GRP-03, AC-MNA-12). */
export const BULK_JUMP = 50;
/** Mail older than this when first seen is a backfill, not news. */
export const LISTED_MAX_AGE_MS = 30 * 60_000;

interface ListRow {
  id?: unknown;
  uid?: unknown;
  is_read?: unknown;
  mailbox?: { id?: unknown; label?: unknown; display_name?: unknown; email?: unknown } | null;
  mailbox_id?: unknown;
  folder_slug?: unknown;
  folder?: unknown;
  from_name?: unknown;
  from_email?: unknown;
  subject?: unknown;
  preview?: unknown;
  importance?: unknown;
  attachment_count?: unknown;
  has_attachments?: unknown;
  verdict?: unknown;
  protection?: { verdict?: unknown } | null;
  created_at?: unknown;
  date?: unknown;
}

/** A row of Mail's list (`GET /api/mail/messages`) as a `mail.received` payload, or null when it is read or old. */
export function listedArrival(x: ListRow, now = Date.now()): Record<string, unknown> | null {
  if (!x || x.is_read === true) return null;
  const stamp = typeof x.created_at === 'string' ? x.created_at : typeof x.date === 'string' ? x.date : null;
  const at = stamp ? Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(stamp) ? stamp : `${stamp.replace(' ', 'T')}Z`) : NaN;
  if (Number.isFinite(at) && now - at > LISTED_MAX_AGE_MS) return null;
  const box = x.mailbox ?? null;
  return {
    event: 'mail.received',
    mailbox_id: box?.id ?? x.mailbox_id,
    uid: x.uid ?? x.id,
    folder: typeof x.folder_slug === 'string' ? x.folder_slug : typeof x.folder === 'string' ? x.folder : 'inbox',
    account_label: str(box?.label) ?? str(box?.display_name) ?? str(box?.email) ?? '',
    from_name: x.from_name,
    from_addr: x.from_email,
    subject: x.subject,
    preview: x.preview,
    importance: x.importance,
    attachments: x.attachment_count ?? (x.has_attachments === true ? 1 : 0),
    verdict: x.verdict ?? x.protection?.verdict,
    ...(Number.isFinite(at) ? { received_at: new Date(at).toISOString() } : {}),
  };
}

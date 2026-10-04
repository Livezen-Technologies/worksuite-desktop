import { currentLocale, text } from '../../core/i18n';
import { addDays, currentZone, dayKey, monthWords, parseTs, stampDayLabel, timeLabel, todayInZone } from '../../core/time';
import type { OfflineMutation } from '@shared/types';
import type { GroupKey, MailPrefs, Mailbox, MailboxTag, MessageRow, MessageSecurity, SortKey } from './types';

/**
 * Mail's list logic, kept apart from the screens so it can be tested on its
 * own: the smart views and what each asks the server, the quick-filter chips,
 * sorting and grouping, the account badges, and which rows have an action
 * waiting in the offline queue.
 */

export type SmartViewId = 'unread' | 'starred' | 'important' | 'today' | 'attachments' | 'scheduled' | 'drafts' | 'vip';

export interface SmartView {
  id: SmartViewId;
  label: string;
  icon: string;
  /** What the list asks for: a folder of the combined view, narrowed by quick filters. */
  folder: string;
  filters: string[];
}

export const SMART_VIEWS: SmartView[] = [
  { id: 'unread', label: 'Unread', icon: 'mail', folder: 'inbox', filters: ['unread'] },
  { id: 'starred', label: 'Starred', icon: 'star', folder: 'inbox', filters: ['starred'] },
  { id: 'important', label: 'Important', icon: 'flag', folder: 'important', filters: [] },
  { id: 'today', label: 'Today', icon: 'calendar', folder: 'inbox', filters: ['today'] },
  { id: 'attachments', label: 'Has attachments', icon: 'paperclip', folder: 'inbox', filters: ['attachments'] },
  { id: 'scheduled', label: 'Scheduled', icon: 'clock', folder: 'outbox', filters: [] },
  { id: 'drafts', label: 'Drafts', icon: 'file-text', folder: 'drafts', filters: [] },
  // Mail from the people marked VIP (DMO-PPL-05): narrowed here, so the server is never asked for it.
  { id: 'vip', label: 'VIP', icon: 'badge-check', folder: 'inbox', filters: ['vip'] },
];

export function smartView(id: string | null | undefined): SmartView | null {
  return SMART_VIEWS.find((v) => v.id === id) ?? null;
}

export type ChipId = 'unread' | 'attachments' | 'starred' | 'week';

/** The quick filters over the list, and the server's name for each. */
export const CHIPS: Array<{ id: ChipId; label: string }> = [
  { id: 'unread', label: 'Unread' },
  { id: 'attachments', label: 'Has files' },
  { id: 'starred', label: 'Starred' },
  { id: 'week', label: 'Last 7 days' },
];

/** The server's quick filters for a view plus the chips that are on, each once. */
export function filtersFor(view: SmartView | null, chips: ChipId[]): string[] {
  return [...new Set([...(view?.filters ?? []), ...chips])];
}

/** The filters the server answers; the rest are applied to what comes back. */
export const CLIENT_ONLY_FILTERS = ['vip'];
export function serverFilters(filters: string[]): string[] {
  return filters.filter((f) => !CLIENT_ONLY_FILTERS.includes(f));
}

/**
 * The same narrowing again on what came back. A connected mailbox answers the
 * filters it can (`quick`); one it could not is applied here, so a chip never
 * looks as if it did nothing.
 */
export function applyFilters(rows: MessageRow[], filters: string[], now = Date.now(), vips?: ReadonlySet<string>): MessageRow[] {
  const weekAgo = now - 7 * 86_400_000;
  const today = todayInZone();
  return rows.filter((m) =>
    filters.every((f) => {
      switch (f) {
        case 'unread':
          return !m.is_read;
        case 'starred':
          return m.is_starred;
        case 'attachments':
          return m.has_attachment;
        case 'week':
          return parseTs(m.created_at).getTime() >= weekAgo;
        case 'today':
          return dayKey(parseTs(m.created_at)) === today;
        case 'vip':
          return !!vips?.has(m.from_email.toLowerCase());
        default:
          return true;
      }
    }),
  );
}

/** What each sort compares, read once per message rather than once per comparison (#162: 90,000 rows). */
const SORT_KEYS: Record<SortKey, (m: MessageRow) => string | number> = {
  date: () => 0,
  sender: (m) => m.from_name || m.from_email,
  subject: (m) => stripPrefix(m.subject),
  size: (m) => m.size ?? 0,
  read: (m) => Number(m.is_read),
  attachment: (m) => Number(m.has_attachment),
  flag: (m) => Number(!!m.is_important),
  star: (m) => Number(m.is_starred),
};

function collator(): Intl.Collator {
  try {
    return new Intl.Collator(currentLocale(), { sensitivity: 'base' });
  } catch {
    return new Intl.Collator(undefined, { sensitivity: 'base' });
  }
}

/** "Re: Fwd: Hello" sorts as "Hello". */
export function stripPrefix(subject: string): string {
  return (subject || '').replace(/^\s*((re|fwd?|aw|sv)\s*:\s*)+/i, '').trim();
}

/** Sorted on what is loaded, newest first within a tie; the server's order is the date. */
export function sortRows(rows: MessageRow[], key: SortKey = 'date', dir: 'asc' | 'desc' = 'desc'): MessageRow[] {
  const k = SORT_KEYS[key] ? key : 'date';
  const pick = SORT_KEYS[k];
  const sign = dir === 'asc' ? 1 : -1;
  const coll = collator();
  // Each message's key and time once, one collator for the lot: a comparison is then just a compare.
  const items = rows.map((r) => ({ r, t: parseTs(r.created_at).getTime(), v: pick(r) }));
  const by = (a: (typeof items)[number], b: (typeof items)[number]): number => {
    if (k === 'date') return a.t - b.t;
    return typeof a.v === 'string' ? coll.compare(a.v, b.v as string) : a.v - (b.v as number);
  };
  // Read, attachment, flag and star put the "yes" first when descending, which is what people mean; ties newest first.
  return items.sort((a, b) => sign * by(a, b) || b.t - a.t).map((i) => i.r);
}

/** Which date band a message falls in on the reader's calendar. */
export function dateBand(stamp: string, today = todayInZone()): { key: string; label: string; order: number } {
  const d = parseTs(stamp);
  if (Number.isNaN(d.getTime())) return { key: 'older', label: text('Older'), order: 9 };
  return dayBand(dayKey(d), today);
}

function dayBand(day: string, today: string): { key: string; label: string; order: number } {
  if (day >= today) return { key: 'today', label: text('Today'), order: 0 };
  if (day === addDays(today, -1)) return { key: 'yesterday', label: text('Yesterday'), order: 1 };
  if (day >= addDays(today, -6)) return { key: 'week', label: text('Earlier this week'), order: 2 };
  if (day >= addDays(today, -13)) return { key: 'last-week', label: text('Last week'), order: 3 };
  const ym = day.slice(0, 7);
  return { key: `m:${ym}`, label: monthWords(ym), order: 4 };
}

export interface RowGroup {
  key: string;
  label: string;
  rows: MessageRow[];
}

/** The list in bands: by date, sender, folder, label, importance or conversation; or one band with no heading. */
export function groupRows(rows: MessageRow[], by: GroupKey = 'date', today = todayInZone()): RowGroup[] {
  if (by === 'none') return rows.length ? [{ key: 'all', label: '', rows }] : [];
  const groups = new Map<string, RowGroup>();
  const add = (key: string, label: string, m: MessageRow) => {
    const g = groups.get(key) ?? { key, label, rows: [] };
    g.rows.push(m);
    groups.set(key, g);
  };
  // A band's name is worked out once per day, not once per message (#162: 90,000 rows took seconds).
  const bands = new Map<string, { key: string; label: string; order: number }>();
  for (const m of rows) {
    if (by === 'date') {
      const d = parseTs(m.created_at);
      const day = Number.isNaN(d.getTime()) ? '' : dayKey(d);
      let b = bands.get(day);
      if (!b) bands.set(day, (b = day ? dayBand(day, today) : { key: 'older', label: text('Older'), order: 9 }));
      add(b.key, b.label, m);
    } else if (by === 'sender') add(`s:${(m.from_email || m.from_name).toLowerCase()}`, m.from_name || m.from_email, m);
    else if (by === 'folder') add(`f:${m.folder_slug ?? m.folder ?? ''}`, m.folder ? folderName(m.folder) : text('Inbox'), m);
    else if (by === 'label') {
      const l = m.labels?.[0];
      add(l ? `l:${l.id}` : 'l:none', l ? l.name : text('No label'), m);
    } else if (by === 'conversation') {
      // One band per conversation, named by its subject without Re:/Fwd: (worksuite-desktop#168).
      const subject = m.subject.replace(/^\s*((re|fwd?|aw|wg|sv|tr)\s*:\s*)+/i, '').trim();
      add(`c:${m.conversation_key ?? subject.toLowerCase()}`, subject || text('(no subject)'), m);
    } else add(m.is_important || m.is_starred ? 'p:high' : 'p:normal', m.is_important || m.is_starred ? text('Important') : text('Everything else'), m);
  }
  // Groups keep the order their first message has in the sorted list — except the date bands, which keep their own.
  return [...groups.values()];
}

/** A folder's path as a reader says it: "Clients/CreativeFX" → "Clients › CreativeFX". */
export function folderName(name: string): string {
  return name
    .replace(/^INBOX[./]/i, '')
    .split(/\//)
    .map((p) => p.trim())
    .filter(Boolean)
    .join(' › ');
}

/** The time beside a row: the time today, the weekday this week, the date before that. */
export function rowStamp(stamp: string, today = todayInZone()): string {
  const d = parseTs(stamp);
  if (Number.isNaN(d.getTime())) return '';
  const day = dayKey(d);
  if (day >= today) return timeLabel(stamp);
  const opts: Intl.DateTimeFormatOptions = day >= addDays(today, -6) ? { weekday: 'short' } : { day: 'numeric', month: 'short' };
  try {
    return new Intl.DateTimeFormat(currentLocale(), { ...opts, timeZone: currentZone() }).format(d);
  } catch {
    return new Intl.DateTimeFormat(currentLocale(), opts).format(d);
  }
}

/** The account's first letter, for its round avatar. */
export function mailboxLetter(m: Pick<Mailbox, 'email'> & Partial<Pick<Mailbox, 'provider' | 'account_type' | 'oauth_provider'>>): string {
  if (m.account_type === 'local_mailbox' || m.provider === 'local') return 'W';
  if (/gmail|google/.test(m.provider ?? '') || m.oauth_provider === 'google') return 'G';
  return (m.email[0] ?? '?').toUpperCase();
}

const TONES: Record<string, string> = {
  blue: 'blue',
  sky: 'sky',
  indigo: 'indigo',
  navy: 'indigo',
  teal: 'teal',
  emerald: 'emerald',
  green: 'emerald',
  amber: 'amber',
  orange: 'amber',
  red: 'red',
  violet: 'violet',
  purple: 'violet',
  slate: 'slate',
};

/** The colour an account is drawn in: one of the theme's account tokens, by the name the server keeps. */
export function accountTone(colour: string | null | undefined): string {
  return TONES[(colour ?? '').toLowerCase()] ?? 'slate';
}

/** "Verified" when the sender is proven (DMARC passed, or SPF and DKIM both did); "Not verified" when any check failed; else "Partly verified". */
export interface SecurityVerdict {
  tone: 'success' | 'warning' | 'muted';
  /** The reading pane's shield (#212): passed, partly verified, or failed. */
  state: 'pass' | 'partial' | 'fail';
  label: string;
  /** Each check and its result: "SPF: pass · DKIM: pass · DMARC: pass". */
  title: string;
  /** The checks that passed — for a failure, the ones that failed: "SPF, DKIM, DMARC". */
  checks: string;
}

export function securityVerdict(s: MessageSecurity | null | undefined): SecurityVerdict | null {
  if (!s || !s.available) return null;
  const checks = [
    ['SPF', s.spf],
    ['DKIM', s.dkim],
    ['DMARC', s.dmarc],
  ] as const;
  const known = checks.filter(([, v]) => v && v !== 'unknown');
  if (known.length === 0) return null;
  const title = checks.map(([k, v]) => `${k}: ${v ?? 'unknown'}`).join(' · ');
  const pass = (v: string | undefined) => v === 'pass' || v === 'bestguesspass';
  const verified = (names: string): SecurityVerdict => ({ tone: 'success', state: 'pass', label: text('Verified · {checks}', { checks: names }), title, checks: names });
  // Any check that failed outright says so, whatever else passed.
  const failed = known.filter(([, v]) => v === 'fail' || v === 'softfail' || v === 'permerror');
  if (failed.length) {
    const names = failed.map(([k]) => k).join(', ');
    return { tone: 'warning', state: 'fail', label: text('Not verified · {checks} failed', { checks: names }), title, checks: names };
  }
  if (known.every(([, v]) => pass(v))) return verified(known.map(([k]) => k).join(', '));
  // A DMARC pass means the sender's own domain was proven — by an aligned SPF or DKIM; the other being "none" (the
  // message was not DKIM-signed, say) does not make it less so (#163: such mail read "Partly verified").
  if (pass(s.dmarc)) return verified(known.filter(([, v]) => pass(v)).map(([k]) => k).join(', '));
  // No DMARC answer, or the domain publishes no DMARC policy ("none"): SPF and DKIM both passing still proves the sender.
  if (pass(s.spf) && pass(s.dkim)) return verified('SPF, DKIM');
  return { tone: 'muted', state: 'partial', label: text('Partly verified'), title, checks: known.filter(([, v]) => pass(v)).map(([k]) => k).join(', ') };
}

/** The shield's tooltip (#212): "Verified · SPF, DKIM, DMARC passed", or what did not pass. */
export function shieldTitle(v: SecurityVerdict): string {
  if (v.state === 'pass') return text('Verified · {checks} passed', { checks: v.checks });
  if (v.state === 'fail') return text('Not verified · {checks} failed ({details})', { checks: v.checks, details: v.title });
  return text('Partly verified ({details})', { details: v.title });
}

/** The reading pane header's layout (#212), from the Mail density setting; the full list reads as Compact. */
export type HeaderDensity = 'super' | 'compact' | 'classic';
export function headerDensity(view: MailPrefs['view']): HeaderDensity {
  return view === 'super' ? 'super' : view === 'classic' ? 'classic' : 'compact';
}

/**
 * The reading pane's date (#212): the time alone today, the day and the time this year, with the year
 * before that; the whole date and time for the tooltip.
 */
export function headerDate(stamp: string, today = todayInZone()): { short: string; full: string } {
  const d = parseTs(stamp);
  if (Number.isNaN(d.getTime())) return { short: '', full: '' };
  const time = timeLabel(stamp);
  const day = dayKey(d);
  const full = `${stampDayLabel(stamp, 'long')}, ${time}`;
  if (day === today) return { short: time, full };
  return { short: `${stampDayLabel(stamp, day.slice(0, 4) === today.slice(0, 4) ? 'short' : 'year')}, ${time}`, full };
}

/** "Dimuthu Perera <dimuthu@x.lk>" as its name and address; a bare address is the address. */
export function splitAddress(entry: string): { name: string; email: string } {
  const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(entry);
  if (m) return { name: (m[1] ?? '').trim(), email: (m[2] ?? '').trim() };
  return { name: '', email: entry.trim() };
}

/**
 * "to me", "to me, Dimuthu +2", "to Ann, Ravi" (#212): who a message went to, short — the reader first, as
 * "me", then each by first name (or the address's own part), at most two, and how many more.
 */
export function recipientSummary(to: string[], cc: string[], mine: Array<string | null | undefined>): string {
  const own = new Set(mine.filter(Boolean).map((a) => String(a).toLowerCase()));
  const seen = new Set<string>();
  const people: Array<{ me: boolean; label: string }> = [];
  for (const entry of [...to, ...cc]) {
    const { name, email } = splitAddress(entry);
    const key = (email || name).toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const me = own.has(email.toLowerCase());
    const first = name ? (name.split(/\s+/)[0] ?? name) : (email.split('@')[0] ?? email);
    people.push({ me, label: me ? text('me') : first });
  }
  if (!people.length) return text('to undisclosed recipients');
  people.sort((a, b) => Number(b.me) - Number(a.me));
  const shown = people.slice(0, 2).map((x) => x.label).join(', ');
  const more = people.length - 2;
  return more > 0 ? text('to {list} +{n}', { list: shown, n: more }) : text('to {list}', { list: shown });
}

/** Mail whose sender could not be proven: SPF, DKIM or DMARC failed (#163: its pictures never load on their own). */
export function authFailed(s: MessageSecurity | null | undefined): boolean {
  return securityVerdict(s)?.tone === 'warning';
}

/** The view settings kept per folder (DMO-INB-16). */
export const FOLDER_VIEW_KEYS = ['view', 'pane', 'sort', 'dir', 'group', 'toolbar'] as const;

/** The person's settings with this folder's own view on top. */
export function withFolderView(prefs: MailPrefs, folderKey: string): MailPrefs {
  const own = prefs.folderViews?.[folderKey];
  return own ? { ...prefs, ...own } : prefs;
}

/**
 * A change from the list or the reader, as it is saved: view settings go to
 * this folder; `applyToAll` makes them everyone's and forgets the folders'
 * own; anything else is a setting of its own.
 */
export function folderViewPatch(prefs: MailPrefs, folderKey: string, patch: Partial<MailPrefs> & { applyToAll?: boolean }): Partial<MailPrefs> {
  const { applyToAll, ...rest } = patch;
  const view: Partial<MailPrefs> = {};
  const other: Partial<MailPrefs> = {};
  for (const [k, v] of Object.entries(rest)) {
    if ((FOLDER_VIEW_KEYS as readonly string[]).includes(k)) (view as Record<string, unknown>)[k] = v;
    else (other as Record<string, unknown>)[k] = v;
  }
  if (applyToAll) {
    const merged = withFolderView(prefs, folderKey);
    const keep = Object.fromEntries(FOLDER_VIEW_KEYS.filter((k) => merged[k] !== undefined).map((k) => [k, merged[k]]));
    return { ...other, ...keep, ...view, folderViews: {} } as Partial<MailPrefs>;
  }
  if (Object.keys(view).length === 0) return other;
  return { ...other, folderViews: { ...(prefs.folderViews ?? {}), [folderKey]: { ...(prefs.folderViews?.[folderKey] ?? {}), ...view } } };
}

/** A message's identity in the offline queue: its mailbox, folder and uid. */
export function queueKey(mailbox: string | number | null | undefined, folder: string, uid: string | number): string {
  return `${mailbox ?? ''}:${folder}:${uid}`.slice(0, 128);
}

export type QueuedAction = 'archive' | 'trash' | 'spam' | 'read' | 'unread' | 'star' | 'unstar' | 'move' | 'send';

/** Mail's waiting changes, by the message each is for. */
export function queuedByMessage(pending: OfflineMutation[]): Map<string, QueuedAction> {
  const out = new Map<string, QueuedAction>();
  for (const m of pending) {
    if (m.module !== 'mail' || !m.entityId || !m.entity.startsWith('message.')) continue;
    if (m.state === 'DONE') continue;
    out.set(m.entityId, m.entity.slice('message.'.length) as QueuedAction);
  }
  return out;
}

/** The row's account, as the list knows it. */
export function rowMailbox(m: MessageRow, fallback: string | null): string | null {
  return m.mailbox ? String(m.mailbox.id) : fallback;
}

/** The next row for j/k and the arrows, staying on the list's ends. */
export function step<T>(items: T[], current: number, by: number): number {
  if (items.length === 0) return -1;
  if (current < 0) return by > 0 ? 0 : items.length - 1;
  return Math.max(0, Math.min(items.length - 1, current + by));
}

/** The person's own words, without markup, for AI and quoting. */
export function plainText(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  // Line breaks and blocks keep their lines: a signature's <br> is not run together.
  doc.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));
  doc.querySelectorAll('p, div, li, tr, h1, h2, h3, h4, h5, h6, blockquote').forEach((el) => el.append('\n'));
  return (doc.body.textContent ?? '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** A mailbox tag from a full mailbox row. */
export function tagOf(b: Mailbox): MailboxTag {
  return { id: b.id, email: b.email, name: b.display_name || b.email, colour: b.colour ?? 'slate' };
}

/** How long ago, short: "12 s", "4 min", "2 h". */
export function agoShort(seconds: number | null | undefined): string | null {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return null;
  if (seconds < 60) return text('{n} s ago', { n: Math.max(0, Math.round(seconds)) });
  if (seconds < 3600) return text('{n} min ago', { n: Math.round(seconds / 60) });
  if (seconds < 86_400) return text('{n} h ago', { n: Math.round(seconds / 3600) });
  return text('{n} d ago', { n: Math.round(seconds / 86_400) });
}

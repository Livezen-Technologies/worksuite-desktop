import { currentLocale, text } from '../../core/i18n';
import { addDays, currentZone, dayKey, monthWords, parseTs, timeLabel, todayInZone } from '../../core/time';
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

const SORTERS: Record<SortKey, (a: MessageRow, b: MessageRow) => number> = {
  date: (a, b) => parseTs(a.created_at).getTime() - parseTs(b.created_at).getTime(),
  sender: (a, b) => (a.from_name || a.from_email).localeCompare(b.from_name || b.from_email, currentLocale(), { sensitivity: 'base' }),
  subject: (a, b) => stripPrefix(a.subject).localeCompare(stripPrefix(b.subject), currentLocale(), { sensitivity: 'base' }),
  size: (a, b) => (a.size ?? 0) - (b.size ?? 0),
  read: (a, b) => Number(a.is_read) - Number(b.is_read),
  attachment: (a, b) => Number(a.has_attachment) - Number(b.has_attachment),
  flag: (a, b) => Number(!!a.is_important) - Number(!!b.is_important),
  star: (a, b) => Number(a.is_starred) - Number(b.is_starred),
};

/** "Re: Fwd: Hello" sorts as "Hello". */
export function stripPrefix(subject: string): string {
  return (subject || '').replace(/^\s*((re|fwd?|aw|sv)\s*:\s*)+/i, '').trim();
}

/** Sorted on what is loaded, newest first within a tie; the server's order is the date. */
export function sortRows(rows: MessageRow[], key: SortKey = 'date', dir: 'asc' | 'desc' = 'desc'): MessageRow[] {
  const by = SORTERS[key] ?? SORTERS.date;
  const sign = dir === 'asc' ? 1 : -1;
  // Read, attachment, flag and star put the "yes" first when descending, which is what people mean.
  return [...rows].sort((a, b) => sign * by(a, b) || SORTERS.date(b, a));
}

/** Which date band a message falls in on the reader's calendar. */
export function dateBand(stamp: string, today = todayInZone()): { key: string; label: string; order: number } {
  const d = parseTs(stamp);
  if (Number.isNaN(d.getTime())) return { key: 'older', label: text('Older'), order: 9 };
  const day = dayKey(d);
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
  for (const m of rows) {
    if (by === 'date') {
      const b = dateBand(m.created_at, today);
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

/** The account's short tag on a row in the combined list: GMAIL, the shared mailbox's name, or its domain's first letters. */
export function mailboxBadge(m: Pick<Mailbox, 'email'> & Partial<Pick<Mailbox, 'provider' | 'shared' | 'account_type' | 'oauth_provider'>>): string {
  const [local = '', domain = ''] = m.email.toLowerCase().split('@');
  if (m.shared || m.account_type === 'shared_mailbox') return local.replace(/[^a-z0-9]/g, '').slice(0, 6).toUpperCase() || 'SHARED';
  if (/gmail|google/.test(m.provider ?? '') || m.oauth_provider === 'google' || /^(gmail|googlemail)\./.test(domain)) return 'GMAIL';
  if (m.account_type === 'local_mailbox' || m.provider === 'local') return 'WS';
  const name = domain.split('.')[0] ?? '';
  return name.slice(0, 2).toUpperCase() || '@';
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

/** "Verified · SPF, DKIM, DMARC" only when every check the server recorded passed. */
export function securityVerdict(s: MessageSecurity | null | undefined): { tone: 'success' | 'warning' | 'muted'; label: string; title: string } | null {
  if (!s || !s.available) return null;
  const checks = [
    ['SPF', s.spf],
    ['DKIM', s.dkim],
    ['DMARC', s.dmarc],
  ] as const;
  const known = checks.filter(([, v]) => v && v !== 'unknown');
  if (known.length === 0) return null;
  const title = checks.map(([k, v]) => `${k}: ${v ?? 'unknown'}`).join(' · ');
  if (known.every(([, v]) => v === 'pass' || v === 'bestguesspass')) return { tone: 'success', label: text('Verified · {checks}', { checks: known.map(([k]) => k).join(', ') }), title };
  const failed = known.filter(([, v]) => v === 'fail' || v === 'softfail' || v === 'permerror');
  if (failed.length) return { tone: 'warning', label: text('Not verified · {checks} failed', { checks: failed.map(([k]) => k).join(', ') }), title };
  return { tone: 'muted', label: text('Partly verified'), title };
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

import { text } from '../../core/i18n';
import type { AccountHealth, AccountErrorCode, Mailbox, MessageDetail, MessagePage, MessageRow } from './types';

/**
 * One account's bad data never takes Mail down (worksuite-desktop#338).
 *
 * Mail used to trust every answer to be whole: an account with no address, a message with no sender, a page with no
 * data — one `null` read as a string threw while drawing, and the whole module showed "Mail failed to load". Each
 * answer is now read through these first, an item at a time: what can be shown is shown, with the gaps filled; an
 * account that cannot work is kept, marked `health.status: 'error'` with why, so the sidebar and the bar above the
 * list can offer Reconnect and Remove, and every other account goes on as usual.
 */

const str = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : '');
const strOrNull = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Server account fields this reads for its health; the rest of the record is kept as it came. */
interface RawAccount extends Record<string, unknown> {
  imap_host?: unknown;
  smtp_host?: unknown;
  pop3_host?: unknown;
  status?: unknown;
}

/**
 * Why an account cannot work, or null when nothing is known to be wrong. An account half set up before the sign-in
 * fix (#154) — no address, no server, an OAuth account whose sign-in never finished — is found here, on this
 * computer, and offered Reconnect (`needs_reconnect`) rather than deleted.
 */
export function accountIssue(b: Partial<Mailbox> & RawAccount): AccountErrorCode | null {
  if (b.account_type === 'local_mailbox' || b.account_type === 'shared_mailbox' || b.shared || b.provider === 'local') return b.auth_state === 'problem' ? 'auth_failed' : null;
  if (!str(b.email).includes('@')) return 'missing_email';
  if (b.auth_type === 'oauth' && !b.oauth_provider) return 'missing_token';
  if (b.auth_state === 'problem' && /\b(no|missing|null|empty)\b.{0,20}\btoken\b|\btoken\b.{0,20}\b(missing|null|empty)\b/i.test(str(b.last_error))) return 'missing_token';
  if (b.auth_state === 'problem') return 'auth_failed';
  // The server says which hosts it has; an older one says none, and nothing is concluded from that.
  if ('imap_host' in b || 'smtp_host' in b || 'pop3_host' in b) {
    if (!str(b.imap_host).trim() && !str(b.smtp_host).trim() && !str(b.pop3_host).trim()) return 'missing_host';
  }
  return null;
}

/** What the account's problem is, in words for its marker and the bar above the list. */
export function issueText(code: AccountErrorCode): string {
  if (code === 'missing_email') return text('The account has no address. Reconnect it, or remove it.');
  if (code === 'missing_token') return text('The sign-in never finished. Reconnect to finish it.');
  if (code === 'missing_host') return text('The account has no mail server. Reconnect it, or remove it.');
  return text('The sign-in stopped working. Reconnect to go on.');
}

/** One account as Mail can safely draw it, or null when it is not an account at all (no ID). */
export function safeMailbox(raw: unknown): Mailbox | null {
  if (!isObject(raw)) return null;
  const id = Number(raw.id);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  const email = str(raw.email).trim();
  const box = {
    ...raw,
    id,
    email,
    display_name: strOrNull(raw.display_name),
    shared: raw.shared === true,
    unread: typeof raw.unread === 'number' && Number.isFinite(raw.unread) ? raw.unread : null,
    provider_label: typeof raw.provider_label === 'string' ? raw.provider_label : undefined,
    provider: typeof raw.provider === 'string' ? raw.provider : undefined,
    last_error: strOrNull(raw.last_error),
  } as Mailbox & RawAccount;
  const code = accountIssue(box);
  const health: AccountHealth = code ? { status: 'error', code, needs_reconnect: true } : { status: 'ok', code: null, needs_reconnect: false };
  return { ...box, health };
}

/** GET mailboxes, an account at a time: one that cannot be read is left out, never the list with it. */
export function safeMailboxes(raw: unknown): { mailboxes: Mailbox[] } {
  const list = isObject(raw) && Array.isArray(raw.mailboxes) ? raw.mailboxes : [];
  const out: Mailbox[] = [];
  for (const b of list) {
    try {
      const box = safeMailbox(b);
      if (box) out.push(box);
    } catch {
      // Never one account for all.
    }
  }
  return { ...(isObject(raw) ? raw : {}), mailboxes: out };
}

/** The accounts that need the person: marked in the sidebar and named in the bar above the list. */
export function accountsNeedingAttention(boxes: Mailbox[]): Mailbox[] {
  return boxes.filter((b) => b.health?.status === 'error' && !b.archived);
}

/** "Microsoft 365 (name@company.com)", or the address alone. */
export function accountTitle(b: Pick<Mailbox, 'email' | 'provider_label' | 'display_name' | 'id'>): string {
  const who = b.email || b.display_name || text('Account {id}', { id: b.id });
  return b.provider_label ? `${b.provider_label} (${who})` : who;
}

/** A list row Mail can draw: the sender, subject and preview always strings, the ID a number. */
export function safeRow(raw: unknown): MessageRow | null {
  if (!isObject(raw)) return null;
  if (raw.id === undefined || raw.id === null || (typeof raw.id !== 'number' && typeof raw.id !== 'string')) return null;
  return {
    ...raw,
    from_name: str(raw.from_name),
    from_email: str(raw.from_email),
    subject: str(raw.subject),
    preview: str(raw.preview),
    created_at: str(raw.created_at),
    is_read: raw.is_read !== false,
    is_starred: raw.is_starred === true,
    has_attachment: raw.has_attachment === true,
  } as MessageRow;
}

/** A page's rows: a row that is not one is left out; a page with no rows is an empty page. */
export function safeRows(raw: unknown): MessageRow[] {
  if (!Array.isArray(raw)) return [];
  const out: MessageRow[] = [];
  for (const r of raw) {
    const row = safeRow(r);
    if (row) out.push(row);
  }
  return out;
}

/** An opened message with its body, sender and lists as Mail draws them; null when the answer holds no message. */
export function safeMessage(raw: unknown): MessageDetail | null {
  if (!isObject(raw)) return null;
  return {
    ...raw,
    id: Number(raw.id) || 0,
    message_id: str(raw.message_id),
    from_name: str(raw.from_name),
    from_email: str(raw.from_email),
    subject: str(raw.subject),
    to: strings(raw.to),
    cc: strings(raw.cc),
    ...(raw.bcc !== undefined ? { bcc: strings(raw.bcc) } : {}),
    body_html: str(raw.body_html),
    is_starred: raw.is_starred === true,
    attachments: Array.isArray(raw.attachments) ? raw.attachments.filter(isObject) : [],
    created_at: str(raw.created_at),
    ...(raw.labels !== undefined ? { labels: Array.isArray(raw.labels) ? raw.labels.filter(isObject) : [] } : {}),
  } as unknown as MessageDetail;
}

/** One page of a list as the list draws it: its rows read one by one, a page with no data an empty page. */
export function safePage<P>(p: P): P & { data: MessagePage } {
  const page = (isObject(p) ? p : {}) as Record<string, unknown>;
  const data = isObject(page.data) ? page.data : {};
  const total = Number(data.total);
  return { ...page, data: { ...data, messages: safeRows(data.messages), total: Number.isFinite(total) ? total : 0, has_more: data.has_more === true } } as P & { data: MessagePage };
}

/** The list query's pages, each made safe (its `select`): one bad page never stops the others being drawn. */
export type SafeListData<D> = Omit<D, 'pages'> & { pages: Array<{ data: MessagePage; offline?: boolean; cachedAt?: string | null; local?: boolean }> };
export function safeListData<D extends { pages: unknown[] }>(d: D): SafeListData<D> {
  return { ...d, pages: (Array.isArray(d.pages) ? d.pages : []).map(safePage) } as SafeListData<D>;
}

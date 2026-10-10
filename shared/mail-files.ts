/**
 * Mail data files and safe links between the main process and Mail
 * (ENH-MAIL-03 DMO-DAT-01…04, DMO-SEC-03). The renderer holds handles, never
 * paths, and never a file's bytes.
 */

export type DataFileKind = 'pst' | 'mbox' | 'eml' | 'msg';

export interface DataFolder {
  id: number;
  /** "Inbox", "Clients/Acme" — the file's own names, "/" between levels. */
  path: string;
  count: number;
  /** False for Calendar, Contacts, Tasks, Notes: listed, never imported. */
  mail: boolean;
}

/** A file (or folder of message files) the person chose. */
export interface MailFileHandle {
  id: string;
  name: string;
  kind: DataFileKind;
  size: number;
  folder: boolean;
}

export interface MailPlanEntry {
  folder: number;
  source: string;
  destination: string;
}

export interface ImportProgress {
  handle: string;
  importId: number;
  state: 'running' | 'paused' | 'done' | 'cancelled';
  folder: string | null;
  done: number;
  total: number;
  copied: number;
  skipped: number;
  failed: number;
  error: string | null;
  unreadable: string[];
}

/** One opened .eml or .msg, for the read-only viewer. */
export interface MailFileView {
  subject: string;
  from: { name: string; email: string } | null;
  to: Array<{ name: string; email: string }>;
  cc: Array<{ name: string; email: string }>;
  date: string | null;
  /** Untrusted: sanitised by the reader exactly like received mail. */
  html: string;
  text: string;
  messageId: string | null;
  attachments: Array<{ index: number; name: string; mime: string; size: number }>;
}

export interface ExportProgress {
  done: number;
  total: number;
  state: 'running' | 'done' | 'cancelled' | 'failed';
  error: string | null;
}

/** The mailboxes and folders a pick dialog offers. */
export const MAIL_FILE_FILTERS = [
  { name: 'Mail data files', extensions: ['pst', 'ost', 'mbox', 'mbx', 'eml', 'msg'] },
  { name: 'Outlook data file', extensions: ['pst', 'ost'] },
  { name: 'Mailbox (mbox)', extensions: ['mbox', 'mbx'] },
  { name: 'Email message', extensions: ['eml', 'msg'] },
];

/** A link clicked in a message, before it opens (safe links). */
export interface MailLinkClick {
  url: string;
  text: string;
  /** The reader the link was clicked in (its frame id), so the click can be traced to its message (ENH-MAIL-04 P-UI-12). */
  frame?: string;
}

/**
 * Where a message's links lead while it is shown: the sanitiser points each
 * at this address, which the main process recognises and turns into a
 * `mail:link` event — so the link is checked at the moment it is clicked.
 */
export const SAFE_LINK_PREFIX = 'app://bundle/__mail-link';

export function safeLinkHref(url: string, text: string): string {
  return `${SAFE_LINK_PREFIX}?${new URLSearchParams({ u: url, t: text.slice(0, 300) })}`;
}

export function parseSafeLink(href: string): MailLinkClick | null {
  if (!href.startsWith(`${SAFE_LINK_PREFIX}?`)) return null;
  const q = new URLSearchParams(href.slice(SAFE_LINK_PREFIX.length + 1));
  const url = q.get('u');
  const frame = q.get('f');
  if (!url) return null;
  return { url: url.slice(0, 4096), text: (q.get('t') ?? '').slice(0, 300), ...(frame && /^[a-z0-9]{4,24}$/i.test(frame) ? { frame } : {}) };
}

export type LinkVerdict = 'ok' | 'caution' | 'danger' | 'blocked';

/** The same signs the server checks (Modules\Mail\Libraries\LinkCheck), here so a link is judged offline too. */
export const SHORTENERS = ['bit.ly', 'tinyurl.com', 't.co', 'goo.gl', 'ow.ly', 'is.gd', 'buff.ly', 'rebrand.ly', 'cutt.ly', 'shorturl.at', 'rb.gy', 't.ly', 'tiny.cc', 'bl.ink', 's.id'];

const hostIn = (host: string, list: string[]) => list.some((d) => host === d || host.endsWith(`.${d}`));

export function siteOf(host: string): string {
  const parts = host.toLowerCase().replace(/\.$/, '').split('.');
  if (parts.length <= 2) return parts.join('.');
  const take = parts[parts.length - 2]!.length <= 3 && parts[parts.length - 1]!.length === 2 ? 3 : 2;
  return parts.slice(-take).join('.');
}

export function shownHost(text: string): string | null {
  const m = /^(?:https?:\/\/)?(?:www\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)+)(?:[/:?#]\S*)?$/.exec(text.trim().toLowerCase());
  return m && /\.[a-z]{2,}$/.test(m[1]!) ? m[1]! : null;
}

export function checkLink(url: string, text = ''): { verdict: LinkVerdict; reasons: string[]; host: string | null } {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { verdict: 'danger', reasons: ['unreadable'], host: null };
  }
  if (u.protocol === 'mailto:' || u.protocol === 'tel:') return { verdict: 'ok', reasons: [], host: null };
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return { verdict: 'danger', reasons: ['scheme'], host: null };
  const host = u.hostname.toLowerCase();
  const danger: string[] = [];
  const caution: string[] = [];
  if (u.username || u.password) danger.push('credentials');
  if (/^\[.*\]$/.test(host) || /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || /^\d+$/.test(host)) danger.push('ip_address');
  if (host.includes('xn--')) danger.push('lookalike');
  const shown = shownHost(text);
  if (shown && siteOf(shown) !== siteOf(host)) danger.push('text_mismatch');
  if (u.port && u.port !== '80' && u.port !== '443') caution.push('port');
  if (hostIn(host, SHORTENERS)) caution.push('shortener');
  if (/(?:^|&)[^=&]*=(?:https?%3a|https?:)/i.test(u.search.replace(/^\?/, ''))) caution.push('redirect');
  // On the desktop an unencrypted link is a caution: the browser would be told nothing about it otherwise.
  if (u.protocol === 'http:') caution.push('not_encrypted');
  return { verdict: danger.length ? 'danger' : caution.length ? 'caution' : 'ok', reasons: [...danger, ...caution], host };
}

/**
 * mailto: links (RFC 6068) handed to WorkSuite by the operating system when
 * it is the default mail app (Mail SRS v2.2 UI-DSK-04, design D04 "Open
 * mailto: links in WorkSuite"). A link only ever opens a new message,
 * prefilled, for the person to read and send themselves: nothing is sent,
 * attached or read from the disk, whatever the link says.
 */

export interface MailtoFields {
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  body: string;
}

export const MAX_MAILTO_LENGTH = 8192;
const ADDRESS = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/;

function decode(s: string): string {
  try {
    return decodeURIComponent(s.replace(/\+/g, '%2B'));
  } catch {
    return s;
  }
}

function addresses(raw: string): string[] {
  return raw
    .split(/[,;]/)
    .map((a) => a.trim())
    .filter((a) => ADDRESS.test(a))
    .slice(0, 50);
}

/** The fields of a mailto: link, or null when it is not one. Unknown headers (attach, from…) are ignored. */
export function parseMailto(url: string): MailtoFields | null {
  if (typeof url !== 'string' || url.length > MAX_MAILTO_LENGTH || !/^mailto:/i.test(url)) return null;
  const rest = url.slice(7);
  const q = rest.indexOf('?');
  const out: MailtoFields = { to: addresses(decode(q < 0 ? rest : rest.slice(0, q))), cc: [], bcc: [], subject: '', body: '' };
  if (q >= 0) {
    for (const pair of rest.slice(q + 1).split('&')) {
      const eq = pair.indexOf('=');
      if (eq <= 0) continue;
      const key = pair.slice(0, eq).toLowerCase();
      const value = decode(pair.slice(eq + 1));
      if (key === 'to') out.to.push(...addresses(value));
      else if (key === 'cc') out.cc.push(...addresses(value));
      else if (key === 'bcc') out.bcc.push(...addresses(value));
      else if (key === 'subject') out.subject = value.replace(/[\r\n]+/g, ' ').slice(0, 500);
      else if (key === 'body') out.body = value.replace(/\r\n/g, '\n').slice(0, 20_000);
    }
  }
  out.to = [...new Set(out.to)];
  return out;
}

/** The Mail route that opens a new message with these fields (MailPage reads `compose=1`). */
export function mailtoRoute(f: MailtoFields): string {
  const q = new URLSearchParams({ compose: '1' });
  if (f.to.length) q.set('to', f.to.join(', '));
  if (f.cc.length) q.set('cc', f.cc.join(', '));
  if (f.bcc.length) q.set('bcc', f.bcc.join(', '));
  if (f.subject) q.set('subject', f.subject);
  if (f.body) q.set('body', f.body);
  return `/mail?${q}`;
}

/** A mailto: link among a launch's arguments (Windows and Linux pass it on the command line). */
export function findMailtoInArgv(argv: readonly string[]): string | null {
  for (const arg of argv) if (typeof arg === 'string' && /^mailto:/i.test(arg) && arg.length <= MAX_MAILTO_LENGTH) return arg;
  return null;
}

/**
 * Whether a message's body may be kept on this computer: not when its
 * mailbox — or Mail as a whole — keeps headers only (D09). Lives here, beside
 * Mail's other main-process rules, so the API proxy and the tests share it.
 */
export function mailBodiesKept(prefs: { mailCacheDays: number; mailCacheDaysByMailbox?: Record<string, number>; mailFolderOffline?: Record<string, FolderOffline> }, path: string): boolean {
  const q = path.indexOf('?');
  const params = q >= 0 ? new URLSearchParams(path.slice(q + 1)) : null;
  const box = params?.get('mailbox') ?? null;
  const own = box ? prefs.mailCacheDaysByMailbox?.[box] : undefined;
  const folder = params?.get('folder') ?? null;
  // A folder's own offline policy (ENH-MAIL-03 DMO-OFF-01): headers only, or online only, keep no bodies; all keeps every one.
  const policy = folder ? folderOffline(prefs, box, folder) : null;
  if (policy === 'all') return true;
  if (policy && policy !== 'recent') return false;
  return (own ?? prefs.mailCacheDays) !== 0;
}

/**
 * What this computer keeps of a folder (ENH-MAIL-03 DMO-OFF-01, §3.3):
 * `all` — every message opened or fetched ahead, whatever its age
 * (worksuite-desktop#162); `recent` — messages within the mailbox's keep
 * period (30 days unless changed); `headers` — the
 * list only, messages open from the server; `online` — nothing, the folder
 * is read from the server each time.
 */
export type FolderOffline = 'all' | 'recent' | 'headers' | 'online';

/** The default for a folder: Inbox, Sent and Drafts keep recent mail, Archive is online only, the rest headers only. */
export function defaultFolderOffline(folder: string): FolderOffline {
  const f = folder.toLowerCase();
  if (f === 'inbox' || f === 'sent' || f === 'drafts') return 'recent';
  if (f === 'archive') return 'online';
  return 'headers';
}

export function folderOffline(prefs: { mailFolderOffline?: Record<string, FolderOffline> }, mailbox: string | null, folder: string): FolderOffline {
  return prefs.mailFolderOffline?.[`${mailbox ?? 'local'}:${folder}`] ?? defaultFolderOffline(folder);
}

/** Whether a folder's list may be kept on this computer: not when it is online only. */
export function mailListKept(prefs: { mailFolderOffline?: Record<string, FolderOffline> }, path: string): boolean {
  if (!/^\/api\/mail\/messages(\?|$)/.test(path)) return true;
  const q = path.indexOf('?');
  const params = q >= 0 ? new URLSearchParams(path.slice(q + 1)) : null;
  const folder = params?.get('folder');
  // The combined views (Unified, All Accounts) follow their folders' own policies at the server; kept as before.
  if (!folder || params?.get('unified')) return true;
  return folderOffline(prefs, params?.get('mailbox') ?? null, folder) !== 'online';
}

/**
 * A saved message body that the keep period does not remove: its folder keeps
 * all of its mail on this computer (worksuite-desktop#162).
 */
export function mailKeptForever(prefs: { mailFolderOffline?: Record<string, FolderOffline> }, path: string): boolean {
  if (!/^\/api\/mail\/messages\/\d+/.test(path)) return false;
  const q = path.indexOf('?');
  const params = q >= 0 ? new URLSearchParams(path.slice(q + 1)) : null;
  const folder = params?.get('folder');
  return !!folder && folderOffline(prefs, params?.get('mailbox') ?? null, folder) === 'all';
}

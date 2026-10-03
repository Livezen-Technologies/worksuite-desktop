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
export function mailBodiesKept(prefs: { mailCacheDays: number; mailCacheDaysByMailbox?: Record<string, number> }, path: string): boolean {
  const q = path.indexOf('?');
  const box = q >= 0 ? new URLSearchParams(path.slice(q + 1)).get('mailbox') : null;
  const own = box ? prefs.mailCacheDaysByMailbox?.[box] : undefined;
  return (own ?? prefs.mailCacheDays) !== 0;
}

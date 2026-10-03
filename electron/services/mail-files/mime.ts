import { createHash } from 'node:crypto';

/**
 * RFC 5322 / MIME messages built from what an Outlook data file (.pst, .msg)
 * holds — which is not a message but a set of properties (ENH-MAIL-03
 * DMO-DAT-01). The mail server is given a real message either way.
 *
 * DETERMINISTIC ON PURPOSE. The same item always becomes the same bytes —
 * boundaries come from a hash of the content, never from a random number —
 * so a message without a Message-ID is still recognised when the same file is
 * imported a second time (AC-DMO-10: no duplicates).
 *
 * NOTHING THE FILE SAYS REACHES A HEADER LINE AS IT IS: every value has its
 * line breaks removed and non-ASCII text is RFC 2047-encoded.
 */

export interface MimeAttachment {
  name: string;
  mime: string;
  data: Buffer;
  /** Shown inside the HTML body (cid:), not as a file. */
  contentId?: string;
}

export interface MimeAddress {
  name?: string;
  email: string;
}

export interface MimeInput {
  /** Header lines in order; values not yet encoded. */
  headers: Array<[string, string]>;
  /** Header lines kept from the original exactly as they were (a received message's transport headers). */
  raw?: string[];
  text?: string;
  html?: string;
  attachments?: MimeAttachment[];
}

const CRLF = '\r\n';

/** A header value with no way to start another header. */
export function oneLine(v: string): string {
  return v.replace(/[\r\n\0]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** RFC 2047 when the value is not plain ASCII; split so no encoded word is too long. */
export function encodeWord(v: string): string {
  const s = oneLine(v);
  if (/^[\x20-\x7e]*$/.test(s)) return s;
  const parts: string[] = [];
  let chunk = '';
  for (const ch of s) {
    if (Buffer.byteLength(chunk + ch, 'utf8') > 45) {
      parts.push(chunk);
      chunk = '';
    }
    chunk += ch;
  }
  if (chunk) parts.push(chunk);
  return parts.map((p) => `=?UTF-8?B?${Buffer.from(p, 'utf8').toString('base64')}?=`).join(`${CRLF} `);
}

const validEmail = (e: string) => /^[^\s<>@,;"]+@[^\s<>@,;"]+$/.test(e);

/** `"Name" <a@b>` for each address that is one; a name alone is dropped rather than invented an address. */
export function addressList(list: MimeAddress[]): string {
  return list
    .map((a) => ({ name: oneLine(a.name ?? ''), email: oneLine(a.email ?? '').toLowerCase() }))
    .filter((a) => validEmail(a.email))
    .map((a) => (a.name && a.name.toLowerCase() !== a.email ? `${/^[\x20-\x7e]*$/.test(a.name) ? `"${a.name.replace(/["\\]/g, '')}"` : encodeWord(a.name)} <${a.email}>` : a.email))
    .join(`,${CRLF} `);
}

/** RFC 5322 date. */
export function mailDate(d: Date): string {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const p = (n: number) => String(n).padStart(2, '0');
  return `${days[d.getUTCDay()]}, ${p(d.getUTCDate())} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} +0000`;
}

/** Base64 in 76-character lines. */
function b64(data: Buffer): string {
  return (data.toString('base64').match(/.{1,76}/g) ?? ['']).join(CRLF);
}

/** A quoted parameter value (a file name), RFC 2231 when it is not plain ASCII. */
function param(name: string, value: string): string {
  const v = oneLine(value).replace(/[\\"]/g, '_') || 'file';
  if (/^[\x20-\x7e]*$/.test(v)) return `${name}="${v}"`;
  return `${name}*=UTF-8''${encodeURIComponent(v).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`;
}

const SAFE_TYPE = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/i;

/**
 * Header lines kept from a received message: everything but the parts that
 * describe its old body (Content-*, MIME-Version), which is rebuilt here.
 * Folded lines stay with their header; line endings become CRLF.
 */
export function keptHeaders(transport: string): { lines: string[]; names: Set<string> } {
  const unix = transport.replace(/\r\n?/g, '\n').replace(/\n\n[\s\S]*$/, '');
  const fields: string[] = [];
  for (const line of unix.split('\n')) {
    if (!line) continue;
    if (/^[ \t]/.test(line) && fields.length) fields[fields.length - 1] += CRLF + line;
    else fields.push(line);
  }
  const lines: string[] = [];
  const names = new Set<string>();
  for (const f of fields) {
    const at = f.indexOf(':');
    if (at <= 0) continue;
    const name = f.slice(0, at).trim().toLowerCase();
    if (!/^[\x21-\x39\x3b-\x7e]+$/.test(name)) continue;
    if (name.startsWith('content-') || name === 'mime-version') continue;
    lines.push(f);
    names.add(name);
  }
  return { lines, names };
}

/** The whole message. */
export function buildMime(input: MimeInput): Buffer {
  const text = (input.text ?? '').replace(/\r\n?/g, '\n').replace(/\n/g, CRLF);
  const html = input.html ?? '';
  const atts = (input.attachments ?? []).filter((a) => a.data.length > 0 || a.name);
  const seed = createHash('sha1');
  seed.update(text).update(html);
  for (const a of atts) seed.update(a.name).update(a.data);
  for (const [k, v] of input.headers) seed.update(k).update(v);
  const tag = seed.digest('hex').slice(0, 24);
  const boundary = (level: string) => `=_ws_${level}_${tag}`;

  const head: string[] = [...(input.raw ?? [])];
  for (const [name, value] of input.headers) {
    if (!/^[A-Za-z0-9-]+$/.test(name)) continue;
    const v = /^(from|to|cc|bcc|reply-to|message-id|in-reply-to|references|date)$/i.test(name) ? oneLine(value) : encodeWord(value);
    if (v) head.push(`${name}: ${v}`);
  }
  head.push('MIME-Version: 1.0');

  const textPart = (): string => `Content-Type: text/plain; charset=UTF-8${CRLF}Content-Transfer-Encoding: base64${CRLF}${CRLF}${b64(Buffer.from(text, 'utf8'))}`;
  const htmlPart = (): string => `Content-Type: text/html; charset=UTF-8${CRLF}Content-Transfer-Encoding: base64${CRLF}${CRLF}${b64(Buffer.from(html, 'utf8'))}`;
  const multipart = (kind: string, level: string, parts: string[]): string =>
    `Content-Type: multipart/${kind}; boundary="${boundary(level)}"${CRLF}${CRLF}${parts.map((p) => `--${boundary(level)}${CRLF}${p}${CRLF}`).join('')}--${boundary(level)}--`;
  const attPart = (a: MimeAttachment): string => {
    const type = SAFE_TYPE.test(a.mime) ? a.mime.toLowerCase() : 'application/octet-stream';
    const cid = a.contentId ? oneLine(a.contentId).replace(/[<>\s]/g, '') : '';
    return [
      `Content-Type: ${type}; ${param('name', a.name)}`,
      `Content-Disposition: ${cid ? 'inline' : 'attachment'}; ${param('filename', a.name)}`,
      ...(cid ? [`Content-ID: <${cid}>`] : []),
      'Content-Transfer-Encoding: base64',
      '',
      b64(a.data),
    ].join(CRLF);
  };

  let body = html ? multipart('alternative', 'alt', [textPart(), htmlPart()]) : textPart();
  const inline = atts.filter((a) => a.contentId && html);
  const files = atts.filter((a) => !(a.contentId && html));
  if (inline.length) body = multipart('related', 'rel', [body, ...inline.map(attPart)]);
  if (files.length) body = multipart('mixed', 'mix', [body, ...files.map(attPart)]);

  return Buffer.from(`${head.join(CRLF)}${CRLF}${body}${CRLF}`, 'utf8');
}

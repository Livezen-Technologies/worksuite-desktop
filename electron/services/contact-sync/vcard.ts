import type { Card } from '@shared/contact-sync';

/**
 * vCard 3.0 / 4.0 ↔ the neutral card (RFC 2426, RFC 6350), for iCloud and other CardDAV servers.
 *
 * READ: FN, N, EMAIL, TEL, ADR, ORG, TITLE, BDAY, NOTE, URL, PHOTO (a link), CATEGORIES and REV, with Apple's
 * grouped labels (`item1.EMAIL` + `item1.X-ABLabel`) and its year-less birthdays (`X-APPLE-OMIT-YEAR=1604`).
 *
 * WRITE: the mapped properties are written from the card; EVERY OTHER LINE OF THE CARD AS THE SERVER LAST SENT IT
 * IS KEPT AS IT WAS — UID, PHOTO, CATEGORIES, X-SOCIALPROFILE, IMPP, RELATED, anniversaries, Apple's own — so a
 * round trip through WorkSuite loses nothing it does not understand.
 */

interface Line {
  group: string | null;
  name: string;
  params: Record<string, string[]>;
  value: string;
  raw: string;
}

/** The properties written from the card (everything else is carried over). */
const MAPPED = new Set(['FN', 'N', 'EMAIL', 'TEL', 'ADR', 'ORG', 'TITLE', 'BDAY', 'NOTE', 'URL']);

export function unfold(text: string): string[] {
  return text
    .replace(/\r\n|\r/g, '\n')
    .replace(/\n[ \t]/g, '')
    .split('\n')
    .filter((l) => l.trim() !== '');
}

function parseLine(raw: string): Line | null {
  // name[;params]:value, where a quoted parameter value may hold ':' or ';'.
  let i = 0;
  let inQuote = false;
  for (; i < raw.length; i++) {
    const c = raw[i];
    if (c === '"') inQuote = !inQuote;
    else if (c === ':' && !inQuote) break;
  }
  if (i >= raw.length) return null;
  const head = raw.slice(0, i);
  const value = raw.slice(i + 1);
  const parts = head.match(/(?:[^;"]|"[^"]*")+/g) ?? [];
  let name = (parts.shift() ?? '').trim();
  let group: string | null = null;
  const dot = name.indexOf('.');
  if (dot > 0) {
    group = name.slice(0, dot);
    name = name.slice(dot + 1);
  }
  const params: Record<string, string[]> = {};
  for (const p of parts) {
    const eq = p.indexOf('=');
    const key = (eq < 0 ? 'TYPE' : p.slice(0, eq)).trim().toUpperCase();
    const vals = (eq < 0 ? p : p.slice(eq + 1)).split(',').map((v) => v.trim().replace(/^"|"$/g, ''));
    (params[key] ??= []).push(...vals.filter(Boolean));
  }
  return { group, name: name.toUpperCase(), params, value, raw };
}

export function unescapeValue(v: string): string {
  return v.replace(/\\([nN,;\\])/g, (_m, c: string) => (c === 'n' || c === 'N' ? '\n' : c));
}

export function escapeValue(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
}

/** Split a structured value (N, ADR, ORG) on unescaped semicolons. */
function components(v: string): string[] {
  const out: string[] = [];
  let cur = '';
  for (let i = 0; i < v.length; i++) {
    if (v[i] === '\\' && i + 1 < v.length) {
      cur += v[i]! + v[i + 1]!;
      i++;
    } else if (v[i] === ';') {
      out.push(unescapeValue(cur));
      cur = '';
    } else cur += v[i];
  }
  out.push(unescapeValue(cur));
  return out;
}

function typeOf(l: Line, labels: Map<string, string>): string {
  const label = l.group ? labels.get(l.group) : undefined;
  return [...(l.params.TYPE ?? []), label ?? ''].filter(Boolean).join(',').toLowerCase();
}

function birthday(l: Line): string | null {
  const v = l.value.trim();
  const omit = l.params['X-APPLE-OMIT-YEAR']?.[0];
  let m = /^(\d{4})-?(\d{2})-?(\d{2})/.exec(v);
  if (m) return omit && m[1] === omit ? `--${m[2]}-${m[3]}` : `${m[1]}-${m[2]}-${m[3]}`;
  m = /^--(\d{2})-?(\d{2})/.exec(v);
  return m ? `--${m[1]}-${m[2]}` : null;
}

export interface ParsedCard {
  card: Card;
  uid: string | null;
}

export function parseVCard(text: string): ParsedCard {
  const lines = unfold(text)
    .map(parseLine)
    .filter((l): l is Line => !!l);
  const labels = new Map<string, string>();
  for (const l of lines) if (l.group && l.name === 'X-ABLABEL') labels.set(l.group, unescapeValue(l.value).replace(/^_\$!<|>!\$_$/g, ''));

  const card: Card = { emails: [], phones: [], addresses: [], groups: [] };
  let uid: string | null = null;
  for (const l of lines) {
    switch (l.name) {
      case 'FN':
        card.display_name = unescapeValue(l.value).trim() || null;
        break;
      case 'N': {
        const [last, firstName] = components(l.value);
        card.last_name = last?.trim() || null;
        card.first_name = firstName?.trim() || null;
        break;
      }
      case 'EMAIL':
        card.emails!.push({ type: typeOf(l, labels), value: unescapeValue(l.value).trim() });
        break;
      case 'TEL':
        card.phones!.push({ type: typeOf(l, labels), value: unescapeValue(l.value).replace(/^tel:/i, '').trim() });
        break;
      case 'ADR': {
        const [, , street, city, state, zip, country] = components(l.value);
        card.addresses!.push({ type: typeOf(l, labels), street: street || null, city: city || null, state: state || null, zip: zip || null, country: country || null });
        break;
      }
      case 'ORG': {
        const [company, department] = components(l.value);
        card.company = company?.trim() || null;
        card.department = department?.trim() || null;
        break;
      }
      case 'TITLE':
        card.job_title = unescapeValue(l.value).trim() || null;
        break;
      case 'BDAY':
        card.birthday = birthday(l);
        break;
      case 'NOTE':
        card.notes = unescapeValue(l.value).trim() || null;
        break;
      case 'URL':
        card.website ??= unescapeValue(l.value).trim() || null;
        break;
      case 'PHOTO':
        if (/^https?:/i.test(l.value.trim())) card.photo_url = l.value.trim();
        break;
      case 'CATEGORIES':
        card.groups!.push(
          ...l.value
            .split(/(?<!\\),/)
            .map((g) => unescapeValue(g).trim())
            .filter(Boolean),
        );
        break;
      case 'REV':
        card.updated_at = l.value.trim() || null;
        break;
      case 'UID':
        uid = l.value.trim() || null;
        break;
    }
  }
  return { card, uid };
}

const TEL_TYPES: Record<string, string> = { mobile: 'CELL', work: 'WORK,VOICE', home: 'HOME,VOICE', other: 'VOICE' };
const SIMPLE_TYPES: Record<string, string> = { work: 'WORK', home: 'HOME', other: 'OTHER' };

function fold(line: string): string {
  // 75 octets a line; continuation lines start with a space.
  const out: string[] = [];
  let rest = line;
  while (Buffer.byteLength(rest, 'utf8') > 75) {
    let cut = 75;
    while (Buffer.byteLength(rest.slice(0, cut), 'utf8') > 75) cut--;
    out.push(rest.slice(0, cut));
    rest = ` ${rest.slice(cut)}`;
  }
  out.push(rest);
  return out.join('\r\n');
}

function kind(type: string): 'mobile' | 'work' | 'home' | 'other' {
  const t = type.toLowerCase();
  if (/cell|mobile|iphone/.test(t)) return 'mobile';
  if (/work|business|main|office/.test(t)) return 'work';
  if (/home|personal/.test(t)) return 'home';
  return 'other';
}

/**
 * The card as a vCard, laid over the vCard the server last sent (when there is one) so that every property WorkSuite
 * does not map is kept.
 */
export function serializeVCard(card: Card, previous: string | null, uid: string): string {
  const prev = previous ? unfold(previous).map(parseLine).filter((l): l is Line => !!l) : [];
  // Groups whose main property is rewritten lose their label lines too.
  const rewrittenGroups = new Set(prev.filter((l) => l.group && MAPPED.has(l.name)).map((l) => l.group!));
  const kept = prev.filter((l) => !MAPPED.has(l.name) && !(l.group && rewrittenGroups.has(l.group)) && !['BEGIN', 'END'].includes(l.name));
  const has = (name: string) => kept.some((l) => l.name === name);

  const lines: string[] = ['BEGIN:VCARD'];
  if (!has('VERSION')) lines.push('VERSION:3.0');
  for (const l of kept) lines.push(l.raw);
  if (!has('UID')) lines.push(`UID:${uid}`);
  if (!has('PRODID')) lines.push('PRODID:-//WorkSuite//Contacts//EN');

  const display = card.display_name || [card.first_name, card.last_name].filter(Boolean).join(' ') || card.company || '';
  lines.push(`FN:${escapeValue(display)}`);
  lines.push(`N:${escapeValue(card.last_name ?? '')};${escapeValue(card.first_name ?? '')};;;`);
  if (card.company || card.department) lines.push(`ORG:${escapeValue(card.company ?? '')}${card.department ? `;${escapeValue(card.department)}` : ''}`);
  if (card.job_title) lines.push(`TITLE:${escapeValue(card.job_title)}`);
  for (const e of card.emails ?? []) lines.push(`EMAIL;TYPE=INTERNET,${SIMPLE_TYPES[kind(e.type) === 'mobile' ? 'other' : kind(e.type)]}:${escapeValue(e.value)}`);
  for (const p of card.phones ?? []) lines.push(`TEL;TYPE=${TEL_TYPES[kind(p.type)]}:${escapeValue(p.value)}`);
  for (const a of card.addresses ?? []) {
    const k = kind(a.type);
    lines.push(`ADR;TYPE=${SIMPLE_TYPES[k === 'mobile' ? 'other' : k]}:;;${[a.street, a.city, a.state, a.zip, a.country].map((v) => escapeValue(v ?? '')).join(';')}`);
  }
  if (card.birthday) {
    const m = /^--(\d{2})-(\d{2})$/.exec(card.birthday);
    lines.push(m ? `BDAY;X-APPLE-OMIT-YEAR=1604:1604-${m[1]}-${m[2]}` : `BDAY;VALUE=DATE:${card.birthday}`);
  }
  if (card.notes) lines.push(`NOTE:${escapeValue(card.notes)}`);
  if (card.website) lines.push(`URL:${card.website.replace(/\n/g, '')}`);
  lines.push('END:VCARD');
  return `${lines.map(fold).join('\r\n')}\r\n`;
}

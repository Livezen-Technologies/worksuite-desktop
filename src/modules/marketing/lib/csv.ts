import { count } from './format';

/**
 * CSV import on this side of the wire (MKT-IMP-01, WF-03 steps 1–2): the 10 MB / 10,000-row limits checked before
 * anything is sent, an RFC 4180 reader to count the rows, and the column mapping suggested from the headers. The
 * server parses, previews and writes; this only refuses early and proposes. Pure. Text is never stripped of
 * non-ASCII: Sinhala and Tamil names pass through as they are (NFR-12).
 */

export const IMPORT_LIMITS = { bytes: 10 * 1024 * 1024, rows: 10_000 } as const;

/** `212 KB`, `1.4 MB`. */
export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${Math.max(0, Math.round(bytes))} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Why a file is refused before it is read (not a .csv, over 10 MB, empty), or null. */
export function checkFile(f: { name: string; size: number }): string | null {
  if (!/\.csv$/i.test(f.name.trim())) return `“${f.name}” isn’t a CSV file. Choose a .csv file; from a spreadsheet, save it as “CSV UTF-8” first.`;
  if (f.size > IMPORT_LIMITS.bytes) return `“${f.name}” is ${fileSize(f.size)}; the limit is 10 MB. Split it into smaller files and import them one by one.`;
  if (f.size === 0) return `“${f.name}” is empty.`;
  return null;
}

/** Why a file is refused for its rows (over 10,000, none), or null. */
export function checkRows(rows: number): string | null {
  if (rows > IMPORT_LIMITS.rows) return `This file has ${count(rows)} rows; the limit is ${count(IMPORT_LIMITS.rows)}. Split it into smaller files and import them one by one.`;
  if (rows === 0) return 'This file has no rows under its header row.';
  return null;
}

/**
 * The file's bytes as text, or why they are refused: only UTF-8 keeps Sinhala and Tamil names intact, so a UTF-16 or
 * legacy-encoded file is refused with a reason (WF-03: wrong encoding is refused, nothing written).
 */
export function decodeCsv(bytes: Uint8Array): { text: string; error: null } | { text: null; error: string } {
  if (bytes.length >= 2 && ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff))) {
    return { text: null, error: 'This file is saved as UTF-16 (“Unicode text”). Save it as “CSV UTF-8” and choose it again.' };
  }
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return { text: null, error: 'This file isn’t saved as UTF-8, so names in Sinhala or Tamil would be garbled. Save it as “CSV UTF-8” and choose it again.' };
  }
  if (text.includes('\u0000')) return { text: null, error: 'This doesn’t look like a CSV text file.' };
  return { text, error: null };
}

/**
 * Rows of fields (RFC 4180): quoted fields with `""` for a quote, commas and line breaks inside quotes, CRLF or LF
 * (or a lone CR), a UTF-8 byte-order mark dropped, and the empty line a file ends with ignored. Fields are kept as
 * written — not trimmed, not re-encoded.
 */
export function parseCsv(text: string): string[][] {
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let start = true;
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i]!;
    if (quoted) {
      if (ch !== '"') field += ch;
      else if (s[i + 1] === '"') {
        field += '"';
        i += 1;
      } else quoted = false;
    } else if (ch === '"' && start) {
      quoted = true;
      start = false;
    } else if (ch === ',') {
      row.push(field);
      field = '';
      start = true;
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      start = true;
    } else {
      field += ch;
      start = false;
    }
  }
  if (quoted || !start || field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  while (rows.length && rows[rows.length - 1]!.length === 1 && rows[rows.length - 1]![0] === '') rows.pop();
  return rows;
}

/** The rows under the header row that hold anything. */
export function dataRows(rows: readonly string[][]): string[][] {
  return rows.slice(1).filter((r) => r.some((f) => f.trim() !== ''));
}

/* ------------------------------------------------------------------------ *
 * Column mapping (WF-03 step 2)
 * ------------------------------------------------------------------------ */

export type ImportField = 'first_name' | 'last_name' | 'name' | 'email' | 'phone' | 'organisation' | 'job_title' | 'tags' | 'source' | 'time_zone' | 'email_consent' | 'phone_consent' | 'ignore';

export const IMPORT_FIELDS: Array<{ value: ImportField; label: string }> = [
  { value: 'first_name', label: 'First name' },
  { value: 'last_name', label: 'Last name' },
  { value: 'name', label: 'Full name' },
  { value: 'email', label: 'Email' },
  { value: 'phone', label: 'Phone' },
  { value: 'organisation', label: 'Organisation' },
  { value: 'job_title', label: 'Job title' },
  { value: 'tags', label: 'Tags' },
  { value: 'source', label: 'Source' },
  { value: 'time_zone', label: 'Time zone' },
  { value: 'email_consent', label: 'Email consent' },
  { value: 'phone_consent', label: 'Phone consent' },
  { value: 'ignore', label: 'Don’t import' },
];

/** A header as compared: lower-case, punctuation and underscores as spaces, Sinhala and Tamil letters and signs kept. */
export function normHeader(h: string): string {
  return h
    .replace(/[\uFEFF\u200C\u200D]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ')
    .trim();
}

/** Exact names for each field, best first: a header matching an earlier name wins the field. */
const NAMES: Array<[Exclude<ImportField, 'ignore'>, string[]]> = [
  ['email', ['email', 'e mail', 'email address', 'e mail address', 'mail', 'email id', 'ඊමේල්', 'மின்னஞ்சல்']],
  ['phone', ['phone', 'mobile', 'tel', 'telephone', 'phone number', 'mobile number', 'contact number', 'mobile no', 'phone no', 'tel no', 'telephone number', 'contact no', 'cell', 'mobile phone', 'whatsapp', 'දුරකථනය', 'දුරකථන අංකය', 'ජංගම දුරකථනය', 'தொலைபேசி', 'கைபேசி', 'தொலைபேசி எண்']],
  ['organisation', ['organisation', 'organization', 'company', 'company name', 'organisation name', 'organization name', 'business', 'business name', 'employer', 'firm', 'ආයතනය', 'සමාගම', 'நிறுவனம்']],
  ['job_title', ['job title', 'title', 'designation', 'position', 'role', 'job']],
  ['name', ['name', 'full name', 'contact name', 'contact', 'customer name', 'නම', 'பெயர்']],
  ['first_name', ['first name', 'given name', 'firstname', 'forename', 'first']],
  ['last_name', ['last name', 'surname', 'family name', 'lastname', 'last']],
  ['tags', ['tags', 'tag', 'labels', 'label']],
  ['source', ['source', 'lead source', 'origin']],
  ['time_zone', ['time zone', 'timezone', 'tz']],
  ['email_consent', ['consent', 'email consent', 'subscribed', 'opt in', 'optin', 'email opt in', 'marketing consent', 'newsletter', 'subscription', 'email subscribed']],
  ['phone_consent', ['phone consent', 'call consent', 'phone opt in', 'consent to call', 'sms consent']],
];

const SYNONYMS = NAMES.map(([field, names]) => [field, names.map(normHeader)] as const);

const anyOf = (w: Set<string>, words: string[]) => words.some((x) => w.has(x));
const CONSENTISH = /consent|opt ?in|subscri/;

/** A header no exact name matched: its best guess, by the words in it. */
const GUESSES: Array<[Exclude<ImportField, 'ignore'>, (w: Set<string>, h: string) => boolean]> = [
  ['phone_consent', (w, h) => CONSENTISH.test(h) && anyOf(w, ['phone', 'call', 'calls', 'calling', 'sms', 'mobile'])],
  ['email_consent', (_w, h) => CONSENTISH.test(h)],
  ['email', (_w, h) => /e ?mail/.test(h)],
  ['phone', (w) => anyOf(w, ['phone', 'mobile', 'tel', 'telephone', 'cell', 'whatsapp', 'landline'])],
  ['organisation', (w) => anyOf(w, ['company', 'organisation', 'organization', 'org', 'employer', 'business'])],
  ['first_name', (w) => (w.has('first') && w.has('name')) || anyOf(w, ['given', 'forename'])],
  ['last_name', (w) => (w.has('last') && w.has('name')) || anyOf(w, ['surname', 'family'])],
  ['job_title', (w) => anyOf(w, ['title', 'designation', 'position', 'role'])],
  ['tags', (w) => anyOf(w, ['tag', 'tags'])],
  ['source', (w) => w.has('source')],
  ['time_zone', (_w, h) => /time ?zone/.test(h)],
  ['name', (w) => w.has('name')],
];

/**
 * A field for each header from its name ("E-mail" → email, "Mobile" → phone, "Company" → organisation, "Designation"
 * → job title, "Consent" → email consent). No field is given to two headers; a header nothing fits is `ignore`.
 */
export function suggestMapping(headers: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  const used = new Set<string>();
  const taken = new Set<number>();
  const normed = headers.map(normHeader);
  const exact: Array<{ i: number; field: ImportField; rank: number }> = [];
  normed.forEach((h, i) => {
    for (const [field, names] of SYNONYMS) {
      const rank = names.indexOf(h);
      if (rank >= 0) exact.push({ i, field, rank });
    }
  });
  exact.sort((a, b) => a.rank - b.rank || a.i - b.i);
  for (const c of exact) {
    const header = headers[c.i]!;
    if (taken.has(c.i) || used.has(c.field) || header in out) continue;
    taken.add(c.i);
    used.add(c.field);
    out[header] = c.field;
  }
  normed.forEach((h, i) => {
    const header = headers[i]!;
    if (taken.has(i) || header in out) return;
    const words = new Set(h.split(' ').filter(Boolean));
    const guess = GUESSES.find(([, fits]) => fits(words, h))?.[0];
    if (guess && !used.has(guess)) {
      used.add(guess);
      taken.add(i);
      out[header] = guess;
    }
  });
  for (const h of headers) if (!(h in out)) out[h] = 'ignore';
  return out;
}

/** Maps a header to a field; another header holding that field lets it go (`ignore`), so no field is mapped twice. */
export function assignField(mapping: Readonly<Record<string, string>>, header: string, field: string): Record<string, string> {
  const next: Record<string, string> = {};
  for (const [h, f] of Object.entries(mapping)) next[h] = field !== 'ignore' && h !== header && f === field ? 'ignore' : f;
  next[header] = field;
  return next;
}

/**
 * The mapping to start from: the one the server remembers for this header set (WF-03 step 2), headers it does not
 * cover filled in from their names; else the suggestion.
 */
export function initialMapping(headers: readonly string[], remembered: Readonly<Record<string, string>> | null | undefined): Record<string, string> {
  const suggested = suggestMapping(headers);
  if (!remembered || !headers.some((h) => !!remembered[h])) return suggested;
  const out: Record<string, string> = {};
  const used = new Set<string>();
  // The remembered fields first, each to one header.
  for (const h of headers) {
    const f = remembered[h];
    if (!f || h in out) continue;
    if (f !== 'ignore' && used.has(f)) out[h] = 'ignore';
    else {
      out[h] = f;
      if (f !== 'ignore') used.add(f);
    }
  }
  // Headers it does not cover, from their names, while the field is free.
  for (const h of headers) {
    if (h in out) continue;
    const s = suggested[h] ?? 'ignore';
    out[h] = s !== 'ignore' && !used.has(s) ? s : 'ignore';
    if (out[h] !== 'ignore') used.add(s);
  }
  return out;
}

export function hasConsentColumn(mapping: Readonly<Record<string, string>>): boolean {
  return Object.values(mapping).some((f) => f === 'email_consent' || f === 'phone_consent');
}

/** Contacts are matched on email or phone (MKT-AUD-02): one of them must be mapped. */
export function mapsContactKey(mapping: Readonly<Record<string, string>>): boolean {
  return Object.values(mapping).some((f) => f === 'email' || f === 'phone');
}

/** "vendor, Oct 2026 ,vendor" → ["vendor", "Oct 2026"]. */
export function splitTags(s: string): string[] {
  const out: string[] = [];
  for (const part of s.split(',')) {
    const t = part.trim().replace(/\s+/g, ' ');
    if (t && !out.some((x) => x.toLowerCase() === t.toLowerCase())) out.push(t);
  }
  return out;
}

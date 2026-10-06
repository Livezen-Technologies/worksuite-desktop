/**
 * CSV for the phone's exports (VOIP-HIS-08 call history, VOIP-EXT-10 extensions) and the extension import. RFC 4180:
 * a field with a comma, quote or line break is quoted, quotes doubled. A field that a spreadsheet would run as a
 * formula (`=`, `+`, `-`, `@` first) is prefixed with `'` — a caller ID is text the outside world chose.
 */

const FORMULA = /^[=+\-@\t\r]/;

export function csvField(v: unknown): string {
  if (v === null || v === undefined) return '';
  let s = typeof v === 'number' || typeof v === 'boolean' ? String(v) : String(v);
  // A phone number like +94… is data, not a formula, but spreadsheets disagree; keep it readable and inert.
  if (FORMULA.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: string[], rows: unknown[][]): string {
  return [header, ...rows].map((r) => r.map(csvField).join(',')).join('\r\n') + '\r\n';
}

/** Parse CSV text into rows of fields (quoted fields, doubled quotes, CRLF or LF). A leading `'` guard is removed. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const s = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i]!;
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"' && field === '') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim() !== '')).map((r) => r.map((f) => (f.startsWith("'") && FORMULA.test(f.slice(1)) ? f.slice(1) : f)));
}

/** Rows as objects keyed by the header row (lower-cased, trimmed). */
export function csvObjects(text: string): Array<Record<string, string>> {
  const [head, ...rest] = parseCsv(text);
  if (!head) return [];
  const keys = head.map((h) => h.trim().toLowerCase());
  return rest.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? '').trim()])));
}

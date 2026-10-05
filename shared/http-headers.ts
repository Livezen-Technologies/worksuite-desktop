/**
 * Header safety (worksuite-desktop#238). An HTTP header value may hold only the
 * bytes 0x00–0xFF, and `Headers.set` (undici in the main process, Blink in a
 * page) throws "Cannot convert argument to a ByteString" on anything above —
 * U+202F, the narrow no-break space macOS puts in "6:29 PM", Sinhala, Tamil, an
 * emoji. One such value used to take down the main process.
 *
 * Every outgoing request goes through here:
 *  · `safeHeaderValue` removes control characters, turns Unicode spaces and
 *    typographic punctuation into their ASCII forms, and percent-encodes
 *    (UTF-8, as `encodeURIComponent` does) whatever is still outside the range.
 *  · `safeHeaders` does that for a whole set and drops a name that is not a
 *    token at all.
 *  · `headerTime` and `contentDisposition` are the right way to put a time or
 *    a file name in a header to begin with: ISO 8601, and RFC 5987/6266.
 * User text (titles, prompts, messages) belongs in the JSON body, not here.
 *
 * A value that had to be changed is a bug in the caller. Tests run in 'throw'
 * mode, so such a bug fails loudly there; the app reports the header's NAME —
 * never its value — to the diagnostics log, and sends the cleaned value.
 */

export type HeaderSafetyMode = 'throw' | 'report';

export class UnsafeHeaderError extends Error {
  constructor(readonly header: string, readonly reason: string) {
    super(`Header "${header}" ${reason}.`);
    this.name = 'UnsafeHeaderError';
  }
}

type Reporter = (header: string, reason: string) => void;

const env = typeof process !== 'undefined' ? process.env : undefined;
let mode: HeaderSafetyMode = env?.VITEST ? 'throw' : 'report';
let reporter: Reporter = (header, reason) => {
  if (typeof console !== 'undefined') console.warn(`[http-headers] header "${header}" ${reason}; sent a safe form instead`);
};

/** 'throw' (tests) makes an unsafe value an error; 'report' (the app) cleans it and reports the header's name. */
export function setHeaderSafetyMode(next: HeaderSafetyMode): HeaderSafetyMode {
  const prev = mode;
  mode = next;
  return prev;
}

export function headerSafetyMode(): HeaderSafetyMode {
  return mode;
}

/** Where 'report' mode says which header was changed (the main process: its diagnostics log). */
export function setUnsafeHeaderReporter(fn: Reporter): void {
  reporter = fn;
}

/** RFC 7230 token: what a header name may be made of. */
const TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

const SPACES = /[\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]/g;
const ZERO_WIDTH = /[\u180e\u200b-\u200d\u2060\ufeff]/g;
const PUNCT: Record<string, string> = {
  '\u2010': '-', '\u2011': '-', '\u2012': '-', '\u2013': '-', '\u2014': '-', '\u2015': '-', '\u2212': '-',
  '\u2018': "'", '\u2019': "'", '\u201a': "'", '\u201b': "'", '\u2032': "'",
  '\u201c': '"', '\u201d': '"', '\u201e': '"', '\u201f': '"', '\u2033': '"',
  '\u2026': '...', '\u2022': '*', '\u00b7': '.',
};

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000a-\u001f\u007f]/g;

/** Half a surrogate pair (a name cut in the middle of an emoji): `encodeURIComponent` throws URIError on one (#253). */
const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g;

/** The text with any half surrogate pair replaced by U+FFFD, so nothing below can throw on it. */
export function wellFormed(value: string): string {
  return value.replace(LONE_SURROGATE, '\ufffd');
}

/** True when `value` is already safe to send: no control characters, nothing above `max`. */
export function isSafeHeaderValue(value: string, max = 0xff): boolean {
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c > max || (c < 0x20 && c !== 0x09) || c === 0x7f) return false;
  }
  return true;
}

/**
 * The value, made safe to send. `ascii` keeps it to 0x20–0x7E as well — what a page's request to the app's own
 * protocol needs, since the main process reads those bytes back as UTF-8.
 */
export function sanitizeHeaderValue(value: unknown, opts: { ascii?: boolean } = {}): string {
  const max = opts.ascii ? 0x7e : 0xff;
  let v = String(value ?? '');
  if (isSafeHeaderValue(v, max) && !/^[\t ]|[\t ]$/.test(v)) return v;
  v = wellFormed(v)
    .replace(/[\r\n]+/g, ' ')
    .replace(/\t/g, ' ')
    .replace(CONTROL, '')
    .replace(ZERO_WIDTH, '')
    .replace(SPACES, ' ')
    .replace(/[\u2010-\u2015\u2018-\u201f\u2026\u2022\u2032\u2033\u2212\u00b7]/g, (c) => (max === 0x7e || c.charCodeAt(0) > 0xff ? (PUNCT[c] ?? c) : c));
  let out = '';
  for (const ch of v) {
    const code = ch.codePointAt(0)!;
    out += code > max ? encodeURIComponent(ch) : ch;
  }
  return out.trim();
}

/**
 * One header's value, safe to send. A value that needed changing is reported by name (or throws, in tests). The
 * header is named in the error and the report; its value never is — it may be a password or a key.
 */
export function safeHeaderValue(name: string, value: unknown, opts: { ascii?: boolean } = {}): string {
  const raw = String(value ?? '');
  const clean = sanitizeHeaderValue(raw, opts);
  if (clean !== raw && clean !== raw.trim()) {
    const reason = isSafeHeaderValue(raw, 0xff) ? 'had characters a page request cannot carry' : 'had characters a header cannot carry (above 255, or control characters)';
    if (mode === 'throw') throw new UnsafeHeaderError(name, reason);
    try {
      reporter(name, reason);
    } catch {
      /* reporting must never break a request */
    }
  }
  return clean;
}

export type HeaderInput = Headers | Record<string, string | undefined | null> | Array<[string, string]> | undefined | null;

function entries(input: HeaderInput): Array<[string, string]> {
  if (!input) return [];
  if (typeof Headers !== 'undefined' && input instanceof Headers) {
    const out: Array<[string, string]> = [];
    input.forEach((v, k) => out.push([k, v]));
    return out;
  }
  if (Array.isArray(input)) return input.map(([k, v]) => [String(k), String(v)]);
  return Object.entries(input)
    .filter((e): e is [string, string] => e[1] !== undefined && e[1] !== null)
    .map(([k, v]) => [k, String(v)]);
}

/** A whole set of headers, safe to hand to `new Headers` / `fetch`. A name that is not a token is dropped (and reported). */
export function safeHeaders(input: HeaderInput, opts: { ascii?: boolean } = {}): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of entries(input)) {
    if (!TOKEN.test(name)) {
      if (mode === 'throw') throw new UnsafeHeaderError(name.replace(/[^\x20-\x7e]/g, '?'), 'is not a valid header name');
      try {
        reporter(name.replace(/[^\x20-\x7e]/g, '?'), 'is not a valid header name');
      } catch {
        /* never break a request */
      }
      continue;
    }
    out[name] = safeHeaderValue(name, value, opts);
  }
  return out;
}

/** Sets one header through the helper. */
export function setSafeHeader(headers: Headers, name: string, value: unknown): void {
  headers.set(name, safeHeaderValue(name, value));
}

/** A time for a header: ISO 8601 in UTC, never a locale's "6:29 PM" (which on macOS carries U+202F). */
export function headerTime(at: Date | number | string = Date.now()): string {
  const d = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(d.getTime())) throw new RangeError('headerTime: not a time');
  return d.toISOString();
}

/**
 * `Content-Disposition` for a file name (RFC 6266 with RFC 5987's `filename*`): an ASCII fallback any client can
 * read, and the real name in UTF-8 for those that can. Sinhala, Tamil, emoji and U+202F all survive in `filename*`.
 */
export function contentDisposition(fileName: string, type: 'attachment' | 'inline' = 'attachment', maxFallback = 150): string {
  const name = wellFormed(String(fileName ?? '')).normalize('NFC').replace(/[\r\n\t]/g, ' ').replace(CONTROL, '').trim() || 'download';
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 && name.length - dot <= 16 ? name.slice(dot) : '';
  const base = ext ? name.slice(0, dot) : name;
  // The fallback reads as the name does: "—" is "-", curly quotes are straight ("FORM TECH-10 - Bid Security.pdf", #253).
  const toAscii = (s: string) =>
    s
      .replace(ZERO_WIDTH, '')
      .replace(/[\u2010-\u2015\u2018-\u201f\u2026\u2022\u2032\u2033\u2212\u00b7]/g, (c) => PUNCT[c] ?? c)
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(SPACES, ' ')
      .replace(/[^\x20-\x7e]/g, '_')
      .replace(/"/g, "'")
      .replace(/\\/g, '_')
      .replace(/%/g, '_')
      .replace(/_+/g, '_')
      .replace(/ {2,}/g, ' ')
      .trim();
  const asciiExt = toAscii(ext).replace(/\s/g, '');
  let fallbackBase = toAscii(base).slice(0, Math.max(1, maxFallback - asciiExt.length)).trim();
  if (!fallbackBase || /^[_\s.]+$/.test(fallbackBase)) fallbackBase = 'download';
  const fallback = `${fallbackBase}${asciiExt}`;
  const encoded = encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  if (fallback === name) return `${type}; filename="${fallback}"`;
  return `${type}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

/**
 * A `Content-Disposition` received as raw bytes (a server that wrote a UTF-8 name without `filename*`): read back
 * as the name it meant, and written again as `contentDisposition` would. A value already in ASCII is returned as is.
 */
export function normalizeContentDisposition(value: string): string {
  try {
    if (isSafeHeaderValue(value, 0x7e)) return value;
    const type = /^\s*inline\b/i.test(value) ? 'inline' : 'attachment';
    // A real `filename*` (RFC 5987) wins over the plain one beside it.
    const star = /filename\*\s*=\s*([^']*)'[^']*'([^;\s]*)/i.exec(value);
    if (star && /^utf-8$/i.test(star[1]!.trim())) {
      try {
        return contentDisposition(decodeURIComponent(star[2]!), type);
      } catch {
        /* a broken encoding: read the plain name instead */
      }
    }
    const m = /filename\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^;]*))/i.exec(value);
    const raw = (m?.[1] ?? m?.[2] ?? '').trim();
    return contentDisposition(utf8FromWire(raw) || 'download', type);
  } catch {
    return 'attachment; filename="download"';
  }
}

/**
 * Text that came over the wire one byte per character (how undici, and a browser, read a header): read as the UTF-8 it
 * was written in. Anything that is not UTF-8 after all is Latin-1, and stays as it is.
 */
export function utf8FromWire(raw: string): string {
  if (!isSafeHeaderValue(raw, 0xff) || isSafeHeaderValue(raw, 0x7e) || typeof TextDecoder === 'undefined') return raw;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(raw, (c) => c.charCodeAt(0)));
  } catch {
    return raw;
  }
}

/**
 * A response header's value as the bytes it came in, one character per byte (worksuite-desktop#253). Electron's
 * `net` reads a response's header bytes as UTF-8, so a server's raw UTF-8 file name ("FORM TECH-10 — Bid
 * Security.pdf") reaches JavaScript as U+2014 — which `Headers.set` refuses ("Cannot convert argument to a
 * ByteString… value of 8212"). Written back as its UTF-8 bytes it is what undici and a browser would have read.
 */
export function wireHeaderValue(value: string): string {
  const v = String(value ?? '');
  if (isSafeHeaderValue(v, 0xff)) return v;
  let out = '';
  for (const b of new TextEncoder().encode(wellFormed(v))) out += String.fromCharCode(b);
  return out.replace(CONTROL, '').trim();
}

/**
 * A response's headers, as received, made into a `Headers` that can never throw: values above 255 become their bytes,
 * `Content-Disposition` is written again as RFC 5987 (`filename*`), and a header that still will not go is left out.
 */
export function responseHeaders(raw: Record<string, string | string[] | undefined> | Array<[string, string]>, onDropped?: (name: string) => void): Headers {
  const out = new Headers();
  const list: Array<[string, string | string[] | undefined]> = Array.isArray(raw) ? raw : Object.entries(raw);
  for (const [name, value] of list) {
    if (value === undefined) continue;
    try {
      const joined = Array.isArray(value) ? value.join(', ') : String(value);
      const wire = wireHeaderValue(joined);
      out.append(name, name.toLowerCase() === 'content-disposition' ? normalizeContentDisposition(wire) : wire);
    } catch {
      try {
        onDropped?.(String(name).replace(/[^\x20-\x7e]/g, '?'));
      } catch {
        /* reporting never breaks a response */
      }
    }
  }
  return out;
}

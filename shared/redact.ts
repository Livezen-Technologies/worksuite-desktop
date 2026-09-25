/**
 * Redaction applied to every log line and to the diagnostic bundle
 * (FR-DIAG-02, NFR-PRV-02). It errs towards removing too much: a support
 * engineer can ask for a detail, but a leaked token cannot be taken back.
 */

const SECRET_KEYS =
  /^(authorization|cookie|set-cookie|password|passwd|pass|secret|token|access_token|refresh_token|id_token|api_key|apikey|x-api-key|x-ws-device-signature|client_secret|otp|code|two_factor_code|private_key|device_key|body|html|text|content|contents|message_body|attachment_data)$/i;

const PATTERNS: Array<[RegExp, string]> = [
  // Bearer / Basic credentials in headers or free text.
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/g, '$1 [REDACTED]'],
  // JSON Web Tokens.
  [/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/g, '[JWT]'],
  // key=value secrets in query strings and form bodies.
  [/([?&;\s](?:token|access_token|refresh_token|password|secret|api_key|key|sig|signature|code)=)[^&\s"']+/gi, '$1[REDACTED]'],
  // Email addresses: keep the domain, which is useful for mail diagnostics.
  [/\b[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g, '[email]@$1'],
  // Long hex or base64 blobs (keys, hashes of secrets, encrypted payloads).
  [/\b[A-Fa-f0-9]{48,}\b/g, '[HEX]'],
  [/\b[A-Za-z0-9+/]{64,}={0,2}/g, '[BLOB]'],
];

export function redactString(input: string): string {
  let out = input;
  for (const [re, rep] of PATTERNS) out = out.replace(re, rep);
  return out;
}

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 8) return '[DEPTH]';
  if (typeof value === 'string') return redactString(value);
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Error) {
    return { name: value.name, message: redactString(value.message), stack: value.stack ? redactString(value.stack) : undefined };
  }
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SECRET_KEYS.test(k) ? (v === null || v === undefined || v === '' ? v : '[REDACTED]') : redact(v, depth + 1);
  }
  return out;
}

/** Deep links and URLs are logged without query strings or fragments (WF-04). */
export function redactUrl(raw: string): string {
  try {
    const u = new URL(raw);
    return `${u.protocol}//${u.host}${u.pathname}${u.search ? '?[…]' : ''}`;
  } catch {
    return '[invalid-url]';
  }
}

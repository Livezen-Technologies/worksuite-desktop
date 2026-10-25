import { createHash, createPublicKey, verify, type KeyObject } from 'node:crypto';
import { canonicalJson } from '@shared/canonical-json';

/**
 * The signed job envelope (WS-LABEL-SRS-001 §14.4, FR-GWY-04): every chunk of printer bytes comes with
 *
 *   {"job":"LJ-001481","chunk":3,"printer":"prn_7f2","org":12,"expires":"2026-10-25T05:20:00Z",
 *    "manifest_sha256":"41c9…e07b","payload_sha256":"…","key_id":"lbl-2026-10","sig":"ed25519:…"}
 *
 * `sig` is Ed25519 over the canonical JSON of the envelope without `sig` (keys sorted, no whitespace —
 * shared/canonical-json.ts, what release manifests are signed over), so it covers the manifest hash, the payload
 * hash, the printer, the company and the expiry together. Nothing is printed until all of these hold:
 *
 *  - the key id is one the server published to this host (`GET keys`, or the pairing answer for a gateway);
 *  - the signature verifies; the payload's SHA-256 is the one signed;
 *  - it is the job (its code, `LJ-…`) and chunk asked for, for the printer the job was claimed for, in this host's
 *    company (a gateway's; the desktop host's session already scopes it);
 *  - it has not expired.
 */
export interface Envelope {
  job: string;
  chunk: number;
  printer: string | number;
  org: number | null;
  expires: string;
  manifest_sha256: string;
  payload_sha256: string;
  key_id: string;
  sig: string;
  [extra: string]: unknown;
}

export type EnvelopeCheck = { ok: true } | { ok: false; reason: string };

/** A published key: base64 (or base64url) of the 32 raw Ed25519 bytes, or a PEM SPKI block. */
export function publicKey(text: string): KeyObject | null {
  try {
    if (text.includes('BEGIN PUBLIC KEY')) {
      const k = createPublicKey(text);
      return k.asymmetricKeyType === 'ed25519' ? k : null;
    }
    const raw = Buffer.from(text.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    if (raw.length !== 32) return null;
    return createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: raw.toString('base64url') }, format: 'jwk' });
  } catch {
    return null;
  }
}

export const sha256Hex = (b: Buffer): string => createHash('sha256').update(b).digest('hex');

export function checkEnvelope(
  env: unknown,
  payload: Buffer,
  expect: { job: string; chunk: number; printer: string | number; org: number | null },
  keys: Readonly<Record<string, string>>,
  now: number = Date.now(),
): EnvelopeCheck {
  if (!env || typeof env !== 'object') return { ok: false, reason: 'The job came without its signed envelope.' };
  const e = env as Partial<Envelope>;
  if (typeof e.sig !== 'string' || !e.sig.startsWith('ed25519:')) return { ok: false, reason: 'The job is not signed.' };
  const pem = typeof e.key_id === 'string' ? keys[e.key_id] : undefined;
  const key = pem ? publicKey(pem) : null;
  if (!key) return { ok: false, reason: `The job is signed with a key this computer does not know (${String(e.key_id ?? 'none')}).` };
  const { sig, ...signed } = e as Envelope;
  let good = false;
  try {
    good = verify(null, Buffer.from(canonicalJson(signed), 'utf8'), key, Buffer.from(sig.slice('ed25519:'.length), 'base64'));
  } catch {
    good = false;
  }
  if (!good) return { ok: false, reason: 'The job’s signature does not verify.' };
  if (typeof e.payload_sha256 !== 'string' || e.payload_sha256.toLowerCase() !== sha256Hex(payload)) return { ok: false, reason: 'The printer data is not what was signed.' };
  if (typeof e.manifest_sha256 !== 'string' || !/^[0-9a-f]{64}$/i.test(e.manifest_sha256)) return { ok: false, reason: 'The job has no manifest hash.' };
  if (e.job !== expect.job || e.chunk !== expect.chunk) return { ok: false, reason: 'The envelope is for another job or chunk.' };
  if (String(e.printer) !== String(expect.printer)) return { ok: false, reason: 'The job is for a printer this computer was not given it for.' };
  if (expect.org !== null && e.org !== expect.org) return { ok: false, reason: 'The job is for another company.' };
  const exp = typeof e.expires === 'string' ? Date.parse(e.expires) : NaN;
  if (!Number.isFinite(exp) || exp <= now) return { ok: false, reason: 'The job’s signature has expired.' };
  return { ok: true };
}

/**
 * A printer command from a heartbeat (Label 1.1: status, calibrate, cancel) comes with printer bytes and an envelope
 *
 *   {"type":"printer_command","command":"calibrate","printer_id":7,"bytes_sha256":"…","issued_at":"2026-10-25T05:20:00Z",
 *    "nonce":"9f…","key_id":"lbl-…","sig":"ed25519:…"}
 *
 * signed like a job's. The bytes go to the printer only when the signature verifies with a key the server gave this
 * host, it is this command for this printer, the bytes are the ones signed, it was issued in the last ten minutes,
 * and its nonce has not been seen before (no replay).
 */
export interface PrinterCommand {
  type?: string;
  printer_id?: number;
  bytes_base64?: string | null;
  envelope?: unknown;
}

export const COMMAND_MAX_AGE_MS = 10 * 60_000;

export type CommandCheck = { ok: true; bytes: Buffer | null } | { ok: false; reason: string };

export function checkCommand(cmd: PrinterCommand, keys: Readonly<Record<string, string>>, seen: Set<string>, now: number = Date.now()): CommandCheck {
  const e = cmd.envelope as Record<string, unknown> | null | undefined;
  if (!e || typeof e !== 'object') return { ok: false, reason: 'The printer command came without its signed envelope.' };
  if (typeof e.sig !== 'string' || !e.sig.startsWith('ed25519:')) return { ok: false, reason: 'The printer command is not signed.' };
  const pem = typeof e.key_id === 'string' ? keys[e.key_id] : undefined;
  const key = pem ? publicKey(pem) : null;
  if (!key) return { ok: false, reason: `The printer command is signed with a key this computer does not know (${String(e.key_id ?? 'none')}).` };
  const { sig, ...signed } = e as { sig: string } & Record<string, unknown>;
  let good = false;
  try {
    good = verify(null, Buffer.from(canonicalJson(signed), 'utf8'), key, Buffer.from(sig.slice('ed25519:'.length), 'base64'));
  } catch {
    good = false;
  }
  if (!good) return { ok: false, reason: 'The printer command’s signature does not verify.' };
  if (e.type !== 'printer_command' || e.command !== cmd.type) return { ok: false, reason: 'The envelope is for another command.' };
  if (String(e.printer_id) !== String(cmd.printer_id)) return { ok: false, reason: 'The command is for another printer.' };
  let bytes: Buffer | null = null;
  if (typeof cmd.bytes_base64 === 'string' && cmd.bytes_base64 !== '') {
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(cmd.bytes_base64)) return { ok: false, reason: 'The printer bytes are not readable.' };
    bytes = Buffer.from(cmd.bytes_base64, 'base64');
  }
  const want = typeof e.bytes_sha256 === 'string' ? e.bytes_sha256.toLowerCase() : null;
  if (bytes ? want !== sha256Hex(bytes) : want !== null) return { ok: false, reason: 'The printer bytes are not what was signed.' };
  const at = typeof e.issued_at === 'string' ? Date.parse(e.issued_at) : NaN;
  if (!Number.isFinite(at) || Math.abs(now - at) > COMMAND_MAX_AGE_MS) return { ok: false, reason: 'The printer command is too old.' };
  const nonce = typeof e.nonce === 'string' && e.nonce.length >= 8 ? e.nonce : null;
  if (!nonce) return { ok: false, reason: 'The printer command has no nonce.' };
  if (seen.has(nonce)) return { ok: false, reason: 'The printer command was already used.' };
  seen.add(nonce);
  if (seen.size > 500) seen.delete(seen.values().next().value as string);
  return { ok: true, bytes };
}

/**
 * The gateway's update manifest (`GET /api/label-gateways/{id}/updates`, Label 1.1): a signed
 * `{type:"gateway_update", gateway_id, version, channel, platform, url, sha256, notes, issued_at, key_id, sig}`.
 * Offered only when it verifies, is for this gateway, and names an https URL and a SHA-256; the download is then
 * checked against that SHA-256 before it is kept.
 */
export interface GatewayUpdate {
  version: string;
  channel: string;
  platform: string;
  url: string;
  sha256: string;
  notes: string | null;
}

export function checkUpdate(env: unknown, keys: Readonly<Record<string, string>>, gatewayId: number): { ok: true; update: GatewayUpdate } | { ok: false; reason: string } {
  if (!env || typeof env !== 'object') return { ok: false, reason: 'No update.' };
  const e = env as Record<string, unknown>;
  if (typeof e.sig !== 'string' || !e.sig.startsWith('ed25519:')) return { ok: false, reason: 'The update is not signed.' };
  const pem = typeof e.key_id === 'string' ? keys[e.key_id] : undefined;
  const key = pem ? publicKey(pem) : null;
  if (!key) return { ok: false, reason: 'The update is signed with a key this gateway does not know.' };
  const { sig, ...signed } = e as { sig: string } & Record<string, unknown>;
  let good = false;
  try {
    good = verify(null, Buffer.from(canonicalJson(signed), 'utf8'), key, Buffer.from(sig.slice('ed25519:'.length), 'base64'));
  } catch {
    good = false;
  }
  if (!good) return { ok: false, reason: 'The update’s signature does not verify.' };
  if (e.type !== 'gateway_update' || Number(e.gateway_id) !== gatewayId) return { ok: false, reason: 'The update is for another gateway.' };
  if (typeof e.url !== 'string' || !/^https:\/\//i.test(e.url)) return { ok: false, reason: 'The update does not come from an https address.' };
  if (typeof e.sha256 !== 'string' || !/^[0-9a-f]{64}$/i.test(e.sha256)) return { ok: false, reason: 'The update has no SHA-256.' };
  if (typeof e.version !== 'string' || !e.version) return { ok: false, reason: 'The update has no version.' };
  return { ok: true, update: { version: e.version, channel: String(e.channel ?? 'stable'), platform: String(e.platform ?? ''), url: e.url, sha256: e.sha256.toLowerCase(), notes: typeof e.notes === 'string' ? e.notes : null } };
}

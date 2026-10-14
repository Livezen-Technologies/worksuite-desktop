import { z } from 'zod';

/**
 * Trusted configuration (Connection & Startup, §2 "Trusted configuration"): what this computer trusts about a
 * WorkSuite server before it has talked to it. It comes from IT — the registry (GPO / Intune), a macOS MDM profile,
 * `/etc/worksuite/policy.json`, `managed.json`, a custom build's `enterprise.json` — or, for one connect run only,
 * from a signed setup link / QR made in Admin Center.
 *
 * Plain data and pure functions: the main process reads the sources (electron/services/discovery/trusted-config.ts)
 * and the renderer shows the result. Signatures are checked in the main process, never here.
 */

/** Where a trusted configuration came from. `null`: nothing configured. */
export type TrustedSource = 'registry' | 'mdm-profile' | 'policy.json' | 'managed.json' | 'enterprise.json' | 'setup-link' | null;

export interface TrustedConfig {
  source: TrustedSource;
  /** The server IT points this computer at (https origin), or null. */
  serverUrl: string | null;
  organizationId: string | null;
  updateChannel: string | null;
  /** `sha256/<base64>` SPKI pins. From managed config they may allow a private CA; from a setup link they only restrict. */
  spkiPins: string[];
  /** `ed25519:<base64 SPKI DER>` (Core) or raw base64url: the key the discovery document must be signed with. */
  discoveryKey: string | null;
  /** Refuse an unsigned discovery document (`SIGNATURE_MISSING`). */
  requireSigned: boolean;
  /** Personal (WorkSuite Cloud) accounts may be added alongside. */
  allowPersonal: boolean;
  /** No other enterprise server may be added (`disable_server_change`). */
  lockServer: boolean;
  /** A setup link's expiry (ISO), else null. */
  expiresAt: string | null;
}

/** Nothing configured: every default as an unmanaged computer has it. */
export const EMPTY_TRUSTED_CONFIG: TrustedConfig = Object.freeze({
  source: null,
  serverUrl: null,
  organizationId: null,
  updateChannel: null,
  spkiPins: [],
  discoveryKey: null,
  requireSigned: false,
  allowPersonal: true,
  lockServer: false,
  expiresAt: null,
}) as TrustedConfig;

/** An SPKI pin as Admin Center writes it: `sha256/` and the base64 SHA-256 of the SubjectPublicKeyInfo. */
export const SPKI_PIN = /^sha256\/[A-Za-z0-9+/]{43}=$/;

/**
 * A setup link's signed payload (Core `Discovery::setupLink`). v1 today: `{v,server_url,server_id,name,exp}`;
 * v2 (Desktop module 1.8.0) adds the trusted configuration and `iat`/`jti` so Regenerate can revoke old links.
 */
export interface SetupLinkPayload {
  v: 1 | 2;
  server_url: string;
  server_id: string;
  name: string;
  /** Unix seconds. */
  exp: number;
  iat?: number;
  jti?: string;
  org_id?: string;
  update_channel?: string;
  spki_pins?: string[];
  discovery_key?: string;
  require_signed?: boolean;
  allow_personal?: boolean;
}

export const setupLinkPayloadSchema = z.looseObject({
  v: z.union([z.literal(1), z.literal(2)]),
  server_url: z
    .string()
    .max(2048)
    .refine((u) => {
      try {
        return new URL(u).protocol === 'https:';
      } catch {
        return false;
      }
    }, 'server_url must be an https address'),
  server_id: z.string().min(1).max(128),
  name: z.string().min(1).max(200),
  exp: z.number().int().positive(),
  iat: z.number().int().positive().optional(),
  jti: z.string().max(128).optional(),
  org_id: z.string().max(128).optional(),
  update_channel: z.string().max(32).optional(),
  spki_pins: z.array(z.string().regex(SPKI_PIN)).max(8).optional(),
  discovery_key: z.string().max(512).optional(),
  require_signed: z.boolean().optional(),
  allow_personal: z.boolean().optional(),
});

export const SETUP_LINK_PREFIX = 'worksuite://setup';
const MAX_LINK = 8192;

export type ParsedSetupLink =
  | {
      ok: true;
      payload: SetupLinkPayload;
      /** The `d` parameter as given: base64url of the canonical JSON. */
      d: string;
      /** The `s` parameter: the standard-base64 Ed25519 signature (64 bytes). */
      s: string;
      /** What the signature covers: the decoded `d`, the canonical JSON text, exactly. */
      signed: string;
    }
  | { ok: false; reason: 'malformed' | 'expired' };

function b64ToBytes(b64: string): Uint8Array | null {
  try {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

function b64urlToBytes(s: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) return null;
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  return b64ToBytes(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
}

/**
 * Reads a setup link — `worksuite://setup?d=<b64url canonical JSON>&s=<base64 Ed25519 sig>` — as Core makes it.
 * Only the shape and the expiry are checked here; the signature is the main process's (discovery/trusted-config.ts),
 * against the server's key over `signed`. `now` is epoch ms.
 */
export function parseSetupLink(raw: string, now: number = Date.now()): ParsedSetupLink {
  const malformed = { ok: false, reason: 'malformed' } as const;
  if (typeof raw !== 'string') return malformed;
  const link = raw.trim();
  if (!link || link.length > MAX_LINK) return malformed;
  const q = link.indexOf('?');
  if (q < 0) return malformed;
  const head = link.slice(0, q).replace(/\/+$/, '');
  if (head.toLowerCase() !== SETUP_LINK_PREFIX) return malformed;
  const params = new URLSearchParams(link.slice(q + 1));
  const d = params.get('d');
  // URLSearchParams reads '+' as a space; a pasted signature that was not percent-encoded keeps its pluses.
  const s = params.get('s')?.replace(/ /g, '+') ?? null;
  if (!d || !s) return malformed;
  const sig = b64ToBytes(s);
  if (!sig || sig.length !== 64) return malformed;
  const bytes = b64urlToBytes(d);
  if (!bytes) return malformed;
  let signed: string;
  let json: unknown;
  try {
    signed = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    json = JSON.parse(signed);
  } catch {
    return malformed;
  }
  const parsed = setupLinkPayloadSchema.safeParse(json);
  if (!parsed.success) return malformed;
  const payload = parsed.data as SetupLinkPayload;
  if (payload.exp * 1000 <= now) return { ok: false, reason: 'expired' };
  return { ok: true, payload, d, s, signed };
}

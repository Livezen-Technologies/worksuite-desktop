import { z } from 'zod';
import { type StartupConfig } from './startup-config';
import type { TrustedConfig } from './trusted-config';

/**
 * The unified discovery document (WS-DESKTOP-ENH-04 §5.3, schema v1) and the connect run built on it
 * (Connection & Startup §2, screen 7).
 *
 * `GET /.well-known/worksuite` says, for an address: is this WorkSuite, which installation is it, how does one sign
 * in, where do the API and its friends live, which Desktop versions it accepts. `GET /.well-known/worksuite.jws` is a
 * detached EdDSA JWS over the exact bytes served. WorkSuite Core serves both today (`deployment:'ENTERPRISE'`,
 * `auth.mode:'legacy'`); WorkSuite Cloud serves `deployment:'CLOUD'`, `auth.mode:'oidc'`, signed with a Livezen key.
 *
 * Plain data, zod and types: the main process runs the checks (electron/services/discovery), the renderer shows them.
 */

export const DISCOVERY_PATH = '/.well-known/worksuite';
export const DISCOVERY_JWS_PATH = '/.well-known/worksuite.jws';
/** The legacy documents the pipeline falls back to on a 404 (the current `probeServer`). */
export const LEGACY_DESKTOP_PATH = '/.well-known/worksuite-desktop';
export const LEGACY_CORE_PATH = '/api/auth/config';
/** WorkSuite Cloud. Unpackaged builds may point elsewhere with WS_CLOUD_ORIGIN (ignored when packaged). */
export const CLOUD_ORIGIN = 'https://worksuitecloud.com';
/** The oldest WorkSuite server release train this Desktop supports (N-2), bumped every train. */
export const SERVER_MIN_VERSION = '2026.7';
/** The largest discovery document read (bytes). */
export const DISCOVERY_MAX_BYTES = 256 * 1024;
/** The OIDC client this app is, unless the document names another. */
export const DEFAULT_OIDC_CLIENT_ID = 'worksuite-desktop';

/** A UUID's shape, any version (Core derives a v5-shaped one from its base URL, or uses a pinned one). */
const uuidShape = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
const url = z.string().min(1).max(2048);
const nullableUrl = url.nullable().default(null);

/**
 * Schema v1. Lenient where the server may grow (every object keeps keys it does not know, so a newer server never
 * fails an older Desktop), strict where the app relies on a value. `product` and `schema_version` are read as any
 * string / integer here so the product step can say NOT_WORKSUITE rather than DISCOVERY_INVALID — see
 * `isWorkSuiteV1`.
 */
export const discoveryDocumentV1 = z.looseObject({
  product: z.string().max(64),
  schema_version: z.number().int(),
  server_id: uuidShape,
  server_name: z.string().min(1).max(200),
  /** Core release train (`2026.10`); absent on current Core and legacy servers: a warning, never a failure. */
  server_version: z.string().max(32).nullish(),
  deployment: z.enum(['CLOUD', 'ENTERPRISE']),
  api_versions: z.array(z.string().max(16)).max(16).default([]),
  base_path: z.string().max(256).optional(),
  endpoints: z.looseObject({
    api: url,
    auth: url,
    realtime: nullableUrl,
    files: nullableUrl,
    office: nullableUrl,
    ai: nullableUrl,
    policy: nullableUrl,
    entitlements: nullableUrl,
    /** `<apiOrigin>/api/health` when absent. */
    health: url.nullish(),
  }),
  auth: z.looseObject({
    mode: z.enum(['oidc', 'legacy']),
    signup: z.boolean().default(false),
    recovery_url: url.nullish(),
    issuer: url.nullish(),
    client_id: z.string().max(128).nullish(),
    /** Core AppHandoff: the browser sign-in page, the code exchange and the client name. */
    browser_sign_in: z.looseObject({ url: z.string().max(512), exchange: z.string().max(512), client: z.string().max(64) }).nullish(),
    idp_hints: z.array(z.string().max(32)).max(16).nullish(),
  }),
  desktop: z
    .looseObject({
      min_version: z.looseObject({ windows: z.string().max(32).optional(), macos: z.string().max(32).optional(), linux: z.string().max(32).optional() }).default({}),
      allowed_channels: z.array(z.string().max(16)).max(8).nullish(),
    })
    .default({ min_version: {} }),
  branding: z
    .looseObject({
      logo: z.string().max(2048).nullable().default(null),
      accent: z
        .string()
        .regex(/^#[0-9a-fA-F]{6}$/)
        .nullable()
        .catch(null)
        .default(null),
    })
    .default({ logo: null, accent: null }),
  /** The startup screen the Admin Center publishes (shared/startup-config.ts). Absent on servers that predate it. */
  startup: z.unknown().nullish(),
  link_hosts: z.array(z.string().max(253)).max(64).default([]),
  plans: z.looseObject({ free: z.looseObject({ storage_bytes: z.number().nonnegative() }) }).nullable().default(null),
  keys: z.looseObject({ discovery: z.string().max(512).nullable().default(null), policy: z.string().max(512).nullable().default(null) }).default({ discovery: null, policy: null }),
  /** Setup links issued before this (unix seconds) are refused: Admin Center's Regenerate. */
  setup: z.looseObject({ revoked_before: z.number().int().nonnegative().nullish() }).nullish(),
  legacy: z.record(z.string(), z.unknown()).nullish(),
});

export type DiscoveryDocument = z.infer<typeof discoveryDocumentV1>;

/** The product step's first question: WorkSuite, schema 1. */
export function isWorkSuiteV1(doc: Pick<DiscoveryDocument, 'product' | 'schema_version'>): boolean {
  return doc.product === 'WorkSuite' && doc.schema_version === 1;
}

/** The checks of screen 7, in order. */
export type CheckId = 'dns' | 'tls' | 'document' | 'signature' | 'product' | 'version' | 'health';
export const CHECK_IDS: readonly CheckId[] = ['dns', 'tls', 'document', 'signature', 'product', 'version', 'health'];
/** Each check's line on screen 7. */
export const CHECK_LABELS: Record<CheckId, string> = {
  dns: 'Address found (DNS)',
  tls: 'Secure connection (certificate)',
  document: 'Discovery document',
  signature: 'Signature',
  product: 'WorkSuite product check',
  version: 'Version compatibility',
  health: 'Server health',
};

export type CheckStatus = 'waiting' | 'running' | 'ok' | 'warning' | 'skipped' | 'failed';

export interface CheckResult {
  id: CheckId;
  status: CheckStatus;
  /** How long it took, once done. */
  ms: number | null;
  /** "Not configured", "version not reported", a reason. */
  note: string | null;
}

/** Every check waiting: a new run's steps. */
export function waitingSteps(): CheckResult[] {
  return CHECK_IDS.map((id) => ({ id, status: 'waiting', ms: null, note: null }));
}

export type ConnectErrorCode =
  | 'INVALID_ADDRESS'
  | 'HTTPS_REQUIRED'
  | 'DNS_FAILED'
  | 'UNREACHABLE'
  | 'TLS_UNTRUSTED'
  | 'TLS_EXPIRED'
  | 'TLS_HOSTNAME'
  | 'TLS_PIN_MISMATCH'
  | 'DISCOVERY_MISSING'
  | 'DISCOVERY_INVALID'
  | 'SIGNATURE_MISSING'
  | 'SIGNATURE_INVALID'
  | 'NOT_WORKSUITE'
  | 'ORIGIN_MISMATCH'
  | 'UPDATE_REQUIRED'
  | 'SERVER_TOO_OLD'
  | 'HEALTH_FAILED'
  | 'PERSONAL_NOT_ALLOWED'
  | 'SERVER_NOT_ALLOWED'
  | 'SETUP_LINK_EXPIRED'
  | 'SETUP_LINK_INVALID'
  | 'CLOUD_UNAVAILABLE'
  | 'ACCOUNT_EXISTS';

/** "Details for IT" on screen 7: the certificate as this computer saw it. */
export interface TlsDetails {
  host: string;
  port: number;
  issuer: string;
  subject: string;
  validFrom: string;
  validTo: string;
  /** `sha256/<base64>` of the leaf's SubjectPublicKeyInfo. */
  spki: string;
  trustStore: 'macOS' | 'Windows' | 'Linux';
  reason: string;
}

/** Screen 9: this Desktop against what the server asks for, and the server against what this Desktop supports. */
export interface CompatInfo {
  /** This app's version. */
  installed: string;
  /** The server's `desktop.min_version` for this platform, when above `installed`. */
  required: string | null;
  serverVersion: string | null;
  /** SERVER_MIN_VERSION. */
  supportedFrom: string;
}

export interface ConnectFailure {
  code: ConnectErrorCode;
  message: string;
  step: CheckId | null;
  host: string | null;
  /** For support: one id per run, in the logs too. */
  requestId: string;
  at: string;
  tls?: TlsDetails;
  compat?: CompatInfo;
}

/** What a successful run found: everything `connect:confirm` needs to create the account. */
export interface DiscoveredServer {
  origin: string;
  apiOrigin: string;
  serverId: string | null;
  name: string;
  deployment: 'CLOUD' | 'ENTERPRISE' | 'LEGACY';
  schema: 'v1' | 'legacy-desktop' | 'legacy-core';
  signed: boolean;
  authMode: 'oidc' | 'legacy';
  signup: boolean;
  oidc: { issuer: string; clientId: string } | null;
  browserSignIn: { url: string; exchange: string; client: string } | null;
  passkey: { url: string; exchange: string } | null;
  branding: { logo: string | null; accent: string | null };
  endpoints: { realtime: string | null; files: string | null; office: string | null; ai: string | null; health: string | null };
  linkHosts: string[];
  minimumVersion: string | null;
  serverVersion: string | null;
  plans: { freeBytes: number } | null;
  /** What the startup screen shows and offers, already merged with this computer's local policy. */
  startup: StartupConfig;
  discoveryKey: string | null;
  trustSource: TrustedConfig['source'];
}

/** One connect attempt (screen 7), pushed on `connect:progress` after every step. */
export interface ConnectRun {
  runId: string;
  /** What was typed or scanned: an address, a work email or a setup link. */
  input: string;
  target: 'personal' | 'enterprise';
  host: string | null;
  /** For a work email: the addresses tried, in order. */
  candidates: string[];
  steps: CheckResult[];
  state: 'running' | 'ok' | 'failed' | 'cancelled';
  server: DiscoveredServer | null;
  failure: ConnectFailure | null;
}

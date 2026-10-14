import { promises as dnsPromises } from 'node:dns';
import { isIP } from 'node:net';
import {
  CHECK_IDS,
  DISCOVERY_JWS_PATH,
  isWorkSuiteV1,
  waitingSteps,
  type CheckId,
  type CheckResult,
  type CompatInfo,
  type ConnectErrorCode,
  type ConnectFailure,
  type ConnectRun,
  type DiscoveredServer,
  type DiscoveryDocument,
  type TlsDetails,
} from '@shared/discovery';
import { parseSetupLink, type ParsedSetupLink, type TrustedConfig } from '@shared/trusted-config';
import { logger } from '../../main/log';
import { checkCompat } from './compat';
import { CrossOriginRedirect, fetchDiscoveryDocument, fetchJws, fetchLegacy, fetchLegacyPasskey, FetchFailed, get, TooManyRedirects, type LegacyDesktop } from './document';
import { emailCandidates, type ResolveTxt } from './email-lookup';
import { verifyDetachedJws } from './jws';
import { discoveryKeyring, parseEd25519Key } from './keys';
import { isLocalHost, normalizeInput, type NormalizedInput } from './normalize';
import { certPin, classifyTlsError, detailsFromChain, errorText, readPeerChain, readTlsDetails, type HostPins, type PeerChain, type PinsFor } from './pinning';
import { parsePins, setupLinkRevoked, trustedFromSetupLink, verifySetupLink } from './trusted-config';

export { normalizeInput, type NormalizedInput };

const log = logger('discovery');

/**
 * The discovery and verification pipeline behind screen 7 (Connection & Startup §2). [WP2]
 *
 * `runDiscovery` takes what was typed or scanned and runs, one step at a time, each reported through `onProgress`
 * (`connect:progress`), with no proceed-anyway path:
 *
 *  1. Input — `normalize`: an https origin (localhost allowed unpackaged); a work email → DNS TXT
 *     `_worksuite.<domain>` (`v=ws1; url=https://…`), then `https://worksuite.<domain>`, then `https://<domain>`, the
 *     first that passes every check wins (`candidates`); a setup link → its verified trusted configuration.
 *  2. DNS — `dns.promises.lookup`, timed. `DNS_FAILED`.
 *  3. TLS — Chromium's verdict in the target partition (`TLS_UNTRUSTED` / `TLS_EXPIRED` / `TLS_HOSTNAME` /
 *     `TLS_PIN_MISMATCH`), details from pinning.ts `readTlsDetails`; pins checked again on the chain node:tls sees.
 *  4. Document — `GET /.well-known/worksuite`, raw bytes kept, `redirect:'error'`, DISCOVERY_MAX_BYTES, parsed with
 *     `discoveryDocumentV1`; otherwise the legacy documents (`legacy-desktop`, `legacy-core`, `deployment:'LEGACY'`).
 *  5. Signature — `GET /.well-known/worksuite.jws`, detached EdDSA over `header + '.' + b64url(rawBytes)`, key per
 *     keys.ts. Unsigned enterprise without `require_signed`: `skipped` ("Not configured"), `signed:false`.
 *  6. Product — `isWorkSuiteV1`, every endpoint https, `endpoints.api` path `/` or `/api`, unsigned → same host.
 *     `NOT_WORKSUITE` / `ORIGIN_MISMATCH`.
 *  7. Version — `desktop.min_version[platform]` (`UPDATE_REQUIRED`), `server_version` vs SERVER_MIN_VERSION
 *     (`SERVER_TOO_OLD`); not reported → `warning`.
 *  8. Health — `endpoints.health ?? <apiOrigin>/api/health`, 10 s. `HEALTH_FAILED`.
 * Around it: `PERSONAL_NOT_ALLOWED`, `SERVER_NOT_ALLOWED` (lockServer), `ACCOUNT_EXISTS`.
 */

export interface DiscoveryInput {
  runId: string;
  input: string;
  target: 'personal' | 'enterprise';
}

export interface PipelineDeps {
  /** Chromium's network stack in the partition the account will use (OS trust store, pinning installed). */
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  /** This computer's trusted configuration (managed sources). */
  trusted: () => TrustedConfig;
  /** Rotated Livezen discovery keys from app.db, `kid` → key. */
  rotatedKeys: () => Readonly<Record<string, string>>;
  /** An account already added for this server and organization, by origin or server id. */
  existingAccount: (server: Pick<DiscoveredServer, 'origin' | 'serverId'>) => string | null;
  appVersion: string;
  platform: 'windows' | 'macos' | 'linux';
  /** Unpackaged builds accept http://localhost and WS_CLOUD_ORIGIN. */
  isPackaged: boolean;
  cloudOrigin: string;
  now?: () => number;
  /** DNS (default `dns.promises.lookup` / `resolveTxt`). */
  lookup?: (host: string) => Promise<unknown>;
  resolveTxt?: ResolveTxt;
  /** The chain a host presents, for "Details for IT" and the pin check (default node:tls). */
  peerChain?: (host: string, port: number, signal: AbortSignal) => Promise<PeerChain>;
  /** Pins an existing account keeps for a host (a setup link's, restrict only). */
  pinsFor?: PinsFor;
  /** Told the pins a run's setup link sets for its host (null when the run ends), so Chromium's verify proc has them. */
  runPins?: (host: string, pins: HostPins | null) => void;
  /** An existing account's discovery again: ACCOUNT_EXISTS does not apply. */
  rediscover?: boolean;
}

export type ProgressFn = (run: ConnectRun) => void;

export interface DiscoveryOutcome {
  run: ConnectRun;
  /** The trusted configuration the account keeps: the setup link's, or the managed one when it applies. */
  trust: TrustedConfig | null;
}

const MESSAGES: Record<ConnectErrorCode, (host: string) => string> = {
  INVALID_ADDRESS: () => 'That is not a valid server address. Check it and try again.',
  HTTPS_REQUIRED: () => 'WorkSuite Desktop connects only over HTTPS. Use an https:// address.',
  DNS_FAILED: (h) => `${h} could not be found. Check the address, or your network or company VPN.`,
  UNREACHABLE: (h) => `${h} could not be reached. Check your network or company VPN.`,
  TLS_UNTRUSTED: (h) => `This computer does not trust the security certificate of ${h}. Contact your IT administrator — WorkSuite will not connect to it.`,
  TLS_EXPIRED: (h) => `The security certificate of ${h} has expired or is not yet valid. Contact your IT administrator.`,
  TLS_HOSTNAME: (h) => `The security certificate of ${h} was issued for a different address. Contact your IT administrator.`,
  TLS_PIN_MISMATCH: (h) => `The security certificate of ${h} is not the one your organization configured. Contact your IT administrator.`,
  DISCOVERY_MISSING: (h) => `${h} did not describe itself as a WorkSuite server.`,
  DISCOVERY_INVALID: (h) => `${h} answered with a discovery document WorkSuite Desktop cannot read.`,
  SIGNATURE_MISSING: (h) => `${h} is not signed with the key your organization requires.`,
  SIGNATURE_INVALID: (h) => `The signature of ${h}'s discovery document does not verify. It may have been tampered with.`,
  NOT_WORKSUITE: (h) => `${h} doesn't look like a WorkSuite server. Check the address with your administrator.`,
  ORIGIN_MISMATCH: (h) => `${h} points WorkSuite Desktop at other addresses it has not proven it controls.`,
  UPDATE_REQUIRED: (h) => `${h} needs a newer version of WorkSuite Desktop.`,
  SERVER_TOO_OLD: (h) => `${h} runs a WorkSuite version this Desktop no longer supports.`,
  HEALTH_FAILED: (h) => `${h} is a WorkSuite server, but it is not responding properly right now. Try again in a few minutes.`,
  PERSONAL_NOT_ALLOWED: () => 'Your organization does not allow personal accounts on this computer.',
  SERVER_NOT_ALLOWED: () => 'Your organization manages which server this computer connects to. Other servers cannot be added.',
  SETUP_LINK_EXPIRED: () => 'This setup link has expired. Ask your administrator for a new one.',
  SETUP_LINK_INVALID: () => 'This setup link is not valid. Ask your administrator for a new one.',
  CLOUD_UNAVAILABLE: () => 'WorkSuite Cloud is not available right now. Try again in a few minutes.',
  ACCOUNT_EXISTS: () => 'This account is already on this computer.',
};

class StepFailure extends Error {
  constructor(readonly failure: Omit<ConnectFailure, 'requestId' | 'at' | 'host'>) {
    super(failure.message);
  }
}

class Cancelled extends Error {}

/** A step's failure, with the default message for its code unless one is given. */
function failure(step: CheckId | null, code: ConnectErrorCode, host: string, extra: { message?: string; tls?: TlsDetails; compat?: CompatInfo } = {}): StepFailure {
  const f: Omit<ConnectFailure, 'requestId' | 'at' | 'host'> = { code, message: extra.message ?? MESSAGES[code](host), step };
  if (extra.tls) f.tls = extra.tls;
  if (extra.compat) f.compat = extra.compat;
  return new StepFailure(f);
}

type OkLink = Extract<ParsedSetupLink, { ok: true }>;

interface Context {
  input: DiscoveryInput;
  deps: PipelineDeps;
  signal: AbortSignal;
  run: ConnectRun;
  emit: () => void;
  trusted: TrustedConfig;
  link: { parsed: OkLink; preKey: string | null; pins: string[] } | null;
}

function clone<T>(v: T): T {
  return structuredClone(v);
}

function checkCancelled(signal: AbortSignal): void {
  if (signal.aborted) throw new Cancelled();
}

function hostOf(origin: string): string {
  return new URL(origin).hostname;
}

/** Managed configuration applies to this origin: it names it, or names no server at all. */
function managedApplies(trusted: TrustedConfig, origin: string): boolean {
  return trusted.source !== null && trusted.source !== 'setup-link' && (trusted.serverUrl === null || trusted.serverUrl === origin);
}

/** The pins Chromium and the pipeline enforce for a host during a run. Managed pins win; a link's restrict. */
function pinsForHost(ctx: Context, origin: string): HostPins | null {
  const host = hostOf(origin);
  const t = ctx.trusted;
  if (t.source && t.serverUrl && hostOf(t.serverUrl) === host && t.spkiPins.length) return { pins: t.spkiPins, managed: true };
  if (ctx.link && ctx.link.pins.length && hostOf(ctx.link.parsed.payload.server_url) === host) return { pins: ctx.link.pins, managed: false };
  return ctx.deps.pinsFor?.(host) ?? null;
}

async function timed<T>(ctx: Context, id: CheckId, body: (step: CheckResult) => Promise<{ status: 'ok' | 'warning' | 'skipped'; note: string | null; value: T }>): Promise<T> {
  const step = ctx.run.steps.find((s) => s.id === id)!;
  step.status = 'running';
  ctx.emit();
  const t0 = performance.now();
  try {
    const r = await body(step);
    checkCancelled(ctx.signal);
    step.status = r.status;
    step.note = r.note;
    step.ms = Math.round(performance.now() - t0);
    ctx.emit();
    return r.value;
  } catch (e) {
    if (e instanceof Cancelled || ctx.signal.aborted) {
      step.status = 'waiting';
      throw new Cancelled();
    }
    step.status = 'failed';
    step.ms = Math.round(performance.now() - t0);
    if (e instanceof StepFailure) {
      step.note = e.failure.code;
      throw e;
    }
    throw e;
  }
}

/** The network error a step hit: cancelled, a certificate problem, or out of reach. */
function networkFailure(ctx: Context, step: CheckId, e: unknown, host: string): StepFailure {
  if (ctx.signal.aborted) throw new Cancelled();
  const original = e instanceof FetchFailed ? e.original : e;
  const tls = classifyTlsError(original);
  if (tls) return failure(step, tls, host);
  return failure(step, 'UNREACHABLE', host);
}

async function stepDns(ctx: Context, origin: string): Promise<void> {
  const host = hostOf(origin).replace(/^\[|\]$/g, '');
  await timed(ctx, 'dns', async () => {
    if (isIP(host)) return { status: 'ok', note: 'IP address', value: undefined };
    const lookup = ctx.deps.lookup ?? ((h: string) => dnsPromises.lookup(h));
    try {
      await Promise.race([
        lookup(host),
        new Promise((_, reject) => {
          const t = setTimeout(() => reject(new Error('DNS timed out')), 10_000);
          t.unref?.();
          ctx.signal.addEventListener('abort', () => reject(new Cancelled()), { once: true });
        }),
      ]);
    } catch (e) {
      if (e instanceof Cancelled || ctx.signal.aborted) throw new Cancelled();
      throw failure('dns', 'DNS_FAILED', host);
    }
    return { status: 'ok', note: null, value: undefined };
  });
}

function portOf(u: URL): number {
  return u.port ? Number(u.port) : u.protocol === 'https:' ? 443 : 80;
}

async function stepTls(ctx: Context, origin: string): Promise<void> {
  const u = new URL(origin);
  const host = u.hostname;
  const port = portOf(u);
  const peer = ctx.deps.peerChain ?? ((h: string, p: number, s: AbortSignal) => readPeerChain(h, p, s));
  const details = async (reason: string): Promise<TlsDetails | undefined> => {
    try {
      if (!ctx.deps.peerChain) return await readTlsDetails(host, port, reason, ctx.signal);
      const { chain } = await peer(host, port, ctx.signal);
      return chain.length ? detailsFromChain(host, port, chain, reason) : undefined;
    } catch (e) {
      log.info('certificate details unavailable', { host, error: String(e) });
      return undefined;
    }
  };
  await timed(ctx, 'tls', async () => {
    if (u.protocol === 'http:') return { status: 'skipped', note: 'Local development address (no TLS)', value: undefined };
    const pins = pinsForHost(ctx, origin);
    if (pins && !pins.managed) ctx.deps.runPins?.(host, pins);
    try {
      const res = await ctx.deps.fetch(origin + '/', { method: 'HEAD', redirect: 'error', signal: AbortSignal.any([ctx.signal, AbortSignal.timeout(15_000)]) });
      await res.body?.cancel().catch(() => undefined);
    } catch (e) {
      if (ctx.signal.aborted) throw new Cancelled();
      const text = errorText(e);
      const code = classifyTlsError(e);
      if (code) throw failure('tls', code, host, { tls: await details(text.slice(0, 300)) });
      // A redirect is an HTTP answer: the TLS handshake behind it succeeded.
      if (!/redirect/i.test(text)) throw failure('tls', 'UNREACHABLE', host);
    }
    if (pins) {
      // Belt and braces: the chain as node:tls sees it must carry a pinned key too (Chromium's verify proc already
      // enforces this when installed on the partition).
      let chain: PeerChain | null = null;
      try {
        chain = await peer(host, port, ctx.signal);
      } catch (e) {
        if (ctx.signal.aborted) throw new Cancelled();
        log.info('pin re-check skipped: chain unreadable', { host, error: String(e) });
      }
      if (chain) {
        const chainPins = chain.chain.map((c) => certPin(c)).filter((p): p is string => !!p);
        if (!chainPins.some((p) => pins.pins.includes(p))) {
          throw failure('tls', 'TLS_PIN_MISMATCH', host, { tls: chain.chain.length ? detailsFromChain(host, port, chain.chain, 'No certificate in the chain matches the configured pins.') : undefined });
        }
      }
      return { status: 'ok', note: pins.managed ? 'Trusted · pinned by your organization' : 'Trusted · pinned key matches', value: undefined };
    }
    return { status: 'ok', note: 'Trusted by this computer', value: undefined };
  });
}

type Found =
  | { kind: 'v1'; doc: DiscoveryDocument; raw: Uint8Array; passkey: LegacyDesktop | null }
  | { kind: 'legacy-desktop'; info: LegacyDesktop }
  | { kind: 'legacy-core'; name: string | null };

async function stepDocument(ctx: Context, origin: string): Promise<Found> {
  const host = hostOf(origin);
  return timed<Found>(ctx, 'document', async () => {
    try {
      const doc = await fetchDiscoveryDocument(ctx.deps.fetch, origin, ctx.signal);
      if (doc.kind === 'invalid') throw failure('document', 'DISCOVERY_INVALID', host, { message: `${MESSAGES.DISCOVERY_INVALID(host)} ${doc.reason}` });
      if (doc.kind === 'v1') {
        const passkey = doc.doc.deployment === 'ENTERPRISE' ? await fetchLegacyPasskey(ctx.deps.fetch, origin, doc.doc.legacy?.desktop, ctx.signal) : null;
        return { status: 'ok', note: 'WorkSuite discovery v1', value: { kind: 'v1', doc: doc.doc, raw: doc.raw, passkey } };
      }
      const legacy = await fetchLegacy(ctx.deps.fetch, origin, ctx.signal);
      if (legacy.kind === 'legacy-desktop') return { status: 'ok', note: 'Earlier desktop document', value: legacy };
      if (legacy.kind === 'legacy-core') return { status: 'ok', note: 'Earlier WorkSuite server', value: legacy };
      if (legacy.kind === 'server-error') {
        throw failure('document', 'HEALTH_FAILED', host, { message: `${host} is a WorkSuite server, but it reported a problem (error ${legacy.status}). Try again in a few minutes.` });
      }
      throw failure('document', doc.status === 404 || doc.status === 410 ? 'NOT_WORKSUITE' : 'DISCOVERY_MISSING', host);
    } catch (e) {
      if (e instanceof StepFailure || e instanceof Cancelled) throw e;
      if (e instanceof CrossOriginRedirect) {
        throw failure('document', 'ORIGIN_MISMATCH', host, {
          message: `${host} redirected WorkSuite Desktop to ${new URL(e.to).host}, a different server. Only redirects that stay on the same server are followed — use the server's own address.`,
        });
      }
      if (e instanceof TooManyRedirects) throw failure('document', 'DISCOVERY_MISSING', host, { message: `${host} redirected too many times. Check the address with your administrator.` });
      throw networkFailure(ctx, 'document', e, host);
    }
  });
}

/** The setup link's key, once the document is known; SETUP_LINK_INVALID when it cannot be trusted. */
function linkTrust(ctx: Context, origin: string, doc: DiscoveryDocument | null): TrustedConfig | null {
  if (!ctx.link) return null;
  const host = hostOf(origin);
  const { parsed, preKey } = ctx.link;
  const invalid = (message: string) => failure('signature', 'SETUP_LINK_INVALID', host, { message });
  if (!doc) {
    throw preKey ? failure('signature', 'SIGNATURE_MISSING', host) : invalid('This setup link cannot be verified: the server does not publish a signing key.');
  }
  if (parsed.payload.server_id.toLowerCase() !== doc.server_id.toLowerCase()) throw invalid('This setup link was made for a different server.');
  if (setupLinkRevoked(parsed, doc.setup?.revoked_before)) throw invalid('This setup link has been replaced by a newer one. Ask your administrator for the current link.');
  const key = preKey ?? doc.keys.discovery;
  if (!key || !verifySetupLink(parsed, key)) throw invalid('This setup link is not signed by this server.');
  return trustedFromSetupLink(parsed, key, doc.setup?.revoked_before ?? null);
}

interface SigResult {
  signed: boolean;
  key: string | null;
  trust: TrustedConfig | null;
}

async function stepSignature(ctx: Context, origin: string, found: Found): Promise<SigResult> {
  const host = hostOf(origin);
  return timed<SigResult>(ctx, 'signature', async () => {
    const managed = managedApplies(ctx.trusted, origin) ? ctx.trusted : null;
    if (found.kind !== 'v1') {
      linkTrust(ctx, origin, null);
      if (managed?.discoveryKey || ctx.trusted.requireSigned) throw failure('signature', 'SIGNATURE_MISSING', host);
      return { status: 'skipped', note: 'Not available on this server', value: { signed: false, key: null, trust: managed } };
    }
    const { doc, raw } = found;
    const jwsUrl = origin + DISCOVERY_JWS_PATH;
    const loadJws = async () => {
      try {
        return await fetchJws(ctx.deps.fetch, jwsUrl, ctx.signal);
      } catch (e) {
        throw networkFailure(ctx, 'signature', e, host);
      }
    };

    if (doc.deployment === 'CLOUD') {
      const jws = await loadJws();
      if (jws.kind === 'missing') throw failure('signature', 'SIGNATURE_MISSING', host);
      const v = verifyDetachedJws(jws.jws, raw, discoveryKeyring(ctx.deps.rotatedKeys(), ctx.deps.isPackaged));
      if (!v.ok) throw failure('signature', 'SIGNATURE_INVALID', host);
      return { status: 'ok', note: 'Signed by Livezen', value: { signed: true, key: null, trust: null } };
    }

    const fromLink = linkTrust(ctx, origin, doc);
    const trustedKey = fromLink?.discoveryKey ?? managed?.discoveryKey ?? null;
    const required = trustedKey !== null || ctx.trusted.requireSigned || fromLink?.requireSigned === true;
    const ownKey = doc.keys.discovery && parseEd25519Key(doc.keys.discovery) ? doc.keys.discovery : null;
    if (!trustedKey && required) throw failure('signature', 'SIGNATURE_MISSING', host, { message: `This computer requires signed servers, but no signing key is configured for ${host}. Contact your IT administrator.` });
    const jws = trustedKey || ownKey ? await loadJws() : ({ kind: 'missing' } as const);
    if (trustedKey) {
      if (jws.kind === 'missing') throw failure('signature', 'SIGNATURE_MISSING', host);
      if (!verifyDetachedJws(jws.jws, raw, trustedKey).ok) throw failure('signature', 'SIGNATURE_INVALID', host);
      return {
        status: 'ok',
        note: fromLink ? 'Signed with the setup link’s key' : 'Signed with your organization’s key',
        value: { signed: true, key: trustedKey, trust: fromLink ?? managed },
      };
    }
    // No key on this computer: a signature the server offers is still checked against its own key, so a document
    // altered on the way is caught, but it proves nothing about who the server is.
    if (jws.kind === 'found' && ownKey && !verifyDetachedJws(jws.jws, raw, ownKey).ok) throw failure('signature', 'SIGNATURE_INVALID', host);
    return { status: 'skipped', note: 'Not configured', value: { signed: false, key: null, trust: managed } };
  });
}

function endpointOk(raw: string, origin: string, signed: boolean, allowLocal: boolean, realtime: boolean): 'ok' | 'scheme' | 'host' {
  let u: URL;
  try {
    u = new URL(raw, origin);
  } catch {
    return 'scheme';
  }
  const secure = u.protocol === 'https:' || (realtime && u.protocol === 'wss:');
  const local = allowLocal && isLocalHost(u.hostname) && (u.protocol === 'http:' || (realtime && u.protocol === 'ws:'));
  if (!secure && !local) return 'scheme';
  if (u.username || u.password) return 'scheme';
  if (!signed && u.hostname !== new URL(origin).hostname) return 'host';
  return 'ok';
}

/** A browser sign-in path on the server: kept as a path; an absolute same-origin URL becomes one. */
function serverPath(raw: string, origin: string): string | null {
  try {
    const u = new URL(raw, origin);
    if (u.origin !== origin) return null;
    const p = u.pathname + u.search;
    return /^\/[A-Za-z0-9/_.?=&-]*$/.test(p) ? p : null;
  } catch {
    return null;
  }
}

function buildServer(ctx: Context, origin: string, found: Found, sig: { signed: boolean; key: string | null; trust: TrustedConfig | null }): DiscoveredServer {
  const host = hostOf(origin);
  const platform = ctx.deps.platform;
  const trustSource = sig.trust?.source ?? null;
  if (found.kind !== 'v1') {
    const info = found.kind === 'legacy-desktop' ? found.info : null;
    return {
      origin,
      apiOrigin: origin,
      serverId: null,
      name: (found.kind === 'legacy-desktop' ? found.info.name : found.name) ?? host,
      deployment: 'LEGACY',
      schema: found.kind,
      signed: false,
      authMode: 'legacy',
      signup: false,
      oidc: null,
      browserSignIn: null,
      passkey: info?.passkey ?? null,
      branding: { logo: null, accent: null },
      endpoints: { realtime: null, files: null, office: null, ai: null, health: null },
      linkHosts: [host],
      minimumVersion: info ? (info.minimumVersions[platform] ?? info.minimumVersion) : null,
      serverVersion: null,
      plans: null,
      discoveryKey: null,
      trustSource,
    };
  }
  const { doc } = found;
  const e = doc.endpoints;
  const bsi = doc.auth.browser_sign_in;
  const browserSignIn = bsi
    ? (() => {
        const url = serverPath(bsi.url, origin);
        const exchange = serverPath(bsi.exchange, origin);
        return url && exchange ? { url, exchange, client: bsi.client } : null;
      })()
    : null;
  const linkHosts = new Set<string>([host]);
  for (const h of doc.link_hosts) {
    const lh = h.trim().toLowerCase();
    if (sig.signed || lh === host || lh.endsWith(`.${host}`)) linkHosts.add(lh);
  }
  let logo = doc.branding.logo;
  if (logo && endpointOk(logo, origin, sig.signed, !ctx.deps.isPackaged, false) !== 'ok') logo = null;
  const abs = (v: string | null | undefined) => (v ? new URL(v, origin).toString() : null);
  return {
    origin,
    apiOrigin: new URL(e.api, origin).origin,
    serverId: doc.server_id,
    name: doc.server_name,
    deployment: doc.deployment,
    schema: 'v1',
    signed: sig.signed,
    authMode: doc.auth.mode,
    signup: doc.auth.signup,
    oidc: doc.auth.mode === 'oidc' ? { issuer: doc.auth.issuer ?? new URL(e.auth, origin).toString(), clientId: doc.auth.client_id ?? 'worksuite-desktop' } : null,
    browserSignIn,
    passkey: found.passkey?.passkey ?? null,
    branding: { logo: logo ? new URL(logo, origin).toString() : null, accent: doc.branding.accent },
    endpoints: { realtime: abs(e.realtime), files: abs(e.files), office: abs(e.office), ai: abs(e.ai), health: abs(e.health) },
    linkHosts: [...linkHosts],
    minimumVersion: doc.desktop.min_version[platform] ?? null,
    serverVersion: doc.server_version ?? null,
    plans: doc.plans ? { freeBytes: doc.plans.free.storage_bytes } : null,
    discoveryKey: sig.key ?? doc.keys.discovery ?? null,
    trustSource,
  };
}

async function stepProduct(ctx: Context, origin: string, found: Found, sig: { signed: boolean; key: string | null; trust: TrustedConfig | null }): Promise<DiscoveredServer> {
  const host = hostOf(origin);
  return timed(ctx, 'product', async () => {
    if (found.kind !== 'v1') {
      if (ctx.input.target === 'personal') throw failure('product', 'NOT_WORKSUITE', host, { message: `${host} is not WorkSuite Cloud.` });
      const server = buildServer(ctx, origin, found, sig);
      return { status: 'ok', note: 'WorkSuite (earlier server)', value: server };
    }
    const { doc } = found;
    if (!isWorkSuiteV1(doc)) throw failure('product', 'NOT_WORKSUITE', host);
    if (ctx.input.target === 'personal' && doc.deployment !== 'CLOUD') throw failure('product', 'NOT_WORKSUITE', host, { message: `${host} is not WorkSuite Cloud.` });
    if (doc.deployment === 'CLOUD') {
      if (origin !== ctx.deps.cloudOrigin) throw failure('product', 'ORIGIN_MISMATCH', host, { message: `${host} says it is WorkSuite Cloud, but WorkSuite Cloud lives at ${new URL(ctx.deps.cloudOrigin).host}.` });
      if (!ctx.trusted.allowPersonal) throw failure('product', 'PERSONAL_NOT_ALLOWED', host);
    }
    const allowLocal = !ctx.deps.isPackaged;
    for (const [name, value] of Object.entries(doc.endpoints)) {
      if (typeof value !== 'string') continue;
      const verdict = endpointOk(value, origin, sig.signed, allowLocal, name === 'realtime');
      if (verdict === 'scheme') throw failure('product', 'NOT_WORKSUITE', host, { message: `${host} names an endpoint (${name}) that is not a secure https address.` });
      if (verdict === 'host') throw failure('product', 'ORIGIN_MISMATCH', host, { message: `${host} sends its ${name} to another address, and its discovery document is not signed.` });
    }
    const apiPath = new URL(doc.endpoints.api, origin).pathname.replace(/\/+$/, '');
    if (apiPath !== '' && apiPath !== '/api') throw failure('product', 'NOT_WORKSUITE', host, { message: `${host} names an API address WorkSuite Desktop does not recognise.` });
    const server = buildServer(ctx, origin, found, sig);
    return { status: 'ok', note: doc.deployment === 'CLOUD' ? 'WorkSuite Cloud' : 'WorkSuite', value: server };
  });
}

async function stepVersion(ctx: Context, server: DiscoveredServer): Promise<void> {
  const host = hostOf(server.origin);
  await timed(ctx, 'version', async () => {
    const v = checkCompat({ appVersion: ctx.deps.appVersion, minVersion: server.minimumVersion, serverVersion: server.serverVersion });
    if (!v.ok) throw failure('version', v.code, host, { message: v.message, compat: v.compat });
    return { status: v.status, note: v.note, value: undefined };
  });
}

async function stepHealth(ctx: Context, server: DiscoveredServer): Promise<void> {
  const host = hostOf(server.origin);
  await timed(ctx, 'health', async () => {
    const explicit = server.endpoints.health;
    const url = explicit ?? `${server.apiOrigin}/api/health`;
    let res: Response;
    try {
      res = await get(ctx.deps.fetch, url, ctx.signal, 'application/json', 10_000);
    } catch (e) {
      if (ctx.signal.aborted) throw new Cancelled();
      if (/redirect/i.test(errorText(e))) return { status: 'warning', note: 'Health not reported', value: undefined };
      throw failure('health', 'HEALTH_FAILED', host);
    }
    await res.body?.cancel().catch(() => undefined);
    if (res.ok) return { status: 'ok', note: null, value: undefined };
    if (res.status >= 500) throw failure('health', 'HEALTH_FAILED', host, { message: `${MESSAGES.HEALTH_FAILED(host)} (error ${res.status})` });
    // Current Core and earlier servers may not have the endpoint, or keep it behind sign-in: up, not reported.
    return { status: 'warning', note: 'Health not reported', value: undefined };
  });
}

function existing(ctx: Context, server: DiscoveredServer): void {
  if (ctx.deps.rediscover) return;
  if (ctx.deps.existingAccount({ origin: server.origin, serverId: server.serverId })) throw failure(null, 'ACCOUNT_EXISTS', hostOf(server.origin));
}

function serverAllowed(ctx: Context, origin: string): void {
  const t = ctx.trusted;
  if (ctx.input.target !== 'enterprise' || !t.lockServer || !t.serverUrl) return;
  if (origin !== t.serverUrl) throw failure(null, 'SERVER_NOT_ALLOWED', hostOf(origin));
}

/** One candidate address, every step. */
async function checkOrigin(ctx: Context, origin: string): Promise<{ server: DiscoveredServer; trust: TrustedConfig | null }> {
  ctx.run.steps = waitingSteps();
  ctx.run.host = hostOf(origin);
  serverAllowed(ctx, origin);
  ctx.emit();
  await stepDns(ctx, origin);
  await stepTls(ctx, origin);
  const found = await stepDocument(ctx, origin);
  const sig = await stepSignature(ctx, origin, found);
  const server = await stepProduct(ctx, origin, found, sig);
  existing(ctx, server);
  await stepVersion(ctx, server);
  await stepHealth(ctx, server);
  return { server, trust: sig.trust };
}

/** Runs every step for one input. Resolves with the finished run (ok, failed or cancelled); never rejects. */
export async function runDiscovery(input: DiscoveryInput, deps: PipelineDeps, onProgress: ProgressFn, signal: AbortSignal): Promise<ConnectRun> {
  return (await discover(input, deps, onProgress, signal)).run;
}

/** `runDiscovery`, with the trusted configuration the new account keeps. */
export async function discover(input: DiscoveryInput, deps: PipelineDeps, onProgress: ProgressFn, signal: AbortSignal): Promise<DiscoveryOutcome> {
  const now = deps.now ?? Date.now;
  const run: ConnectRun = { runId: input.runId, input: input.input, target: input.target, host: null, candidates: [], steps: waitingSteps(), state: 'running', server: null, failure: null };
  const emit = () => {
    try {
      onProgress(clone(run));
    } catch (e) {
      log.warn('progress listener failed', { error: String(e) });
    }
  };
  let trusted: TrustedConfig;
  try {
    trusted = deps.trusted();
  } catch (e) {
    log.warn('trusted configuration unreadable', { error: String(e) });
    trusted = { source: null, serverUrl: null, organizationId: null, updateChannel: null, spkiPins: [], discoveryKey: null, requireSigned: false, allowPersonal: true, lockServer: false, expiresAt: null };
  }
  const ctx: Context = { input, deps, signal, run, emit, trusted, link: null };
  const finishFailed = (f: StepFailure, host: string | null) => {
    run.state = 'failed';
    run.failure = { ...f.failure, host, requestId: input.runId, at: new Date(now()).toISOString() };
    log.info('connect failed', { runId: input.runId, code: f.failure.code, step: f.failure.step, host });
    emit();
    return { run: clone(run), trust: null };
  };
  const cancelled = () => {
    run.state = 'cancelled';
    for (const s of run.steps) if (s.status === 'running') s.status = 'waiting';
    emit();
    return { run: clone(run), trust: null };
  };
  let linkHost: string | null = null;

  try {
    emit();
    let origins: string[];
    if (input.target === 'personal') {
      if (!trusted.allowPersonal) throw failure(null, 'PERSONAL_NOT_ALLOWED', hostOf(deps.cloudOrigin));
      origins = [deps.cloudOrigin];
    } else {
      const n = normalizeInput(input.input, { allowLocalhost: !deps.isPackaged });
      if (n.kind === 'invalid') throw failure(null, n.code, input.input.slice(0, 120));
      if (n.kind === 'origin') {
        origins = [n.origin];
      } else if (n.kind === 'email') {
        origins = await emailCandidates(n.domain, deps.resolveTxt ?? ((name) => dnsPromises.resolveTxt(name)), { allowLocalhost: !deps.isPackaged, signal });
        checkCancelled(signal);
        run.candidates = [...origins];
        emit();
      } else {
        const parsed = parseSetupLink(n.link, now());
        if (!parsed.ok) throw failure(null, parsed.reason === 'expired' ? 'SETUP_LINK_EXPIRED' : 'SETUP_LINK_INVALID', 'setup link');
        const origin = new URL(parsed.payload.server_url).origin;
        const managedKey = managedApplies(trusted, origin) ? trusted.discoveryKey : null;
        const preKey = managedKey ?? (parsed.payload.discovery_key && parseEd25519Key(parsed.payload.discovery_key) ? parsed.payload.discovery_key : null);
        if (preKey && !verifySetupLink(parsed, preKey)) throw failure(null, 'SETUP_LINK_INVALID', hostOf(origin));
        ctx.link = { parsed, preKey, pins: parsePins(parsed.payload.spki_pins ?? []) };
        linkHost = hostOf(origin);
        origins = [origin];
      }
    }

    let best: { f: StepFailure; steps: CheckResult[]; host: string | null; rank: number } | null = null;
    for (const origin of origins) {
      try {
        const { server, trust } = await checkOrigin(ctx, origin);
        run.state = 'ok';
        run.server = server;
        run.failure = null;
        log.info('connect ok', { runId: input.runId, host: run.host, schema: server.schema, signed: server.signed });
        emit();
        return { run: clone(run), trust };
      } catch (e) {
        if (e instanceof Cancelled || signal.aborted) return cancelled();
        if (!(e instanceof StepFailure)) throw e;
        // A failure before any step (SERVER_NOT_ALLOWED) ranks lowest; ACCOUNT_EXISTS comes after the product step.
        const rank = e.failure.step ? CHECK_IDS.indexOf(e.failure.step) : e.failure.code === 'ACCOUNT_EXISTS' ? CHECK_IDS.indexOf('product') : -1;
        if (!best || rank > best.rank) best = { f: e, steps: clone(run.steps), host: run.host, rank };
        // A WorkSuite server answered: the other candidates would not be it.
        if (rank >= CHECK_IDS.indexOf('product')) break;
      }
    }
    if (!best) throw failure(null, 'INVALID_ADDRESS', input.input.slice(0, 120));
    run.steps = best.steps;
    run.host = best.host;
    return finishFailed(best.f, best.host);
  } catch (e) {
    if (e instanceof Cancelled || signal.aborted) return cancelled();
    if (e instanceof StepFailure) return finishFailed(e, run.host);
    log.error('connect pipeline error', { runId: input.runId, error: e instanceof Error ? `${e.name}: ${e.message}` : String(e) });
    return finishFailed(failure(null, 'UNREACHABLE', run.host ?? '', { message: 'Something went wrong while checking this server. Try again.' }), run.host);
  } finally {
    if (linkHost) deps.runPins?.(linkHost, null);
  }
}

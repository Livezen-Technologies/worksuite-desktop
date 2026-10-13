import { execFileSync } from 'node:child_process';
import { createPrivateKey, sign, X509Certificate } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, request as httpsRequest, type Server } from 'node:https';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TLSSocket } from 'node:tls';
import { canonicalJson } from '@shared/canonical-json';
import { certPin, pinVerdict, type PinsFor } from '../../../../electron/services/discovery/pinning';

/**
 * The TLS test server for discovery (WP2): a private CA made with the openssl command line (node:crypto cannot make
 * X.509 certificates; the WP0 mock-cloud does the same), leaf certificates for localhost — good, for another host,
 * and expired — and an HTTPS server whose routes a test sets.
 *
 * `chromiumLikeFetch` stands in for Chromium's network stack: the "OS trust store" is the CA given (or none), and
 * the pinning verify proc's decision (`pinVerdict`) is applied exactly as `installPinning` applies it, failing with
 * Chromium's `net::ERR_…` names.
 */

export interface TestPki {
  dir: string;
  caCert: string;
  leaf: { cert: string; key: string; pin: string };
  wrongHost: { cert: string; key: string };
  expired: { cert: string; key: string };
  caPin: string;
  cleanup: () => void;
}

function ossl(dir: string, args: string[]): void {
  execFileSync('openssl', args, { cwd: dir, stdio: 'pipe' });
}

export function makePki(): TestPki {
  const dir = mkdtempSync(join(tmpdir(), 'ws-disco-pki-'));
  const ec = ['-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256', '-nodes'];
  ossl(dir, ['req', '-x509', ...ec, '-keyout', 'ca.key', '-out', 'ca.crt', '-days', '30', '-subj', '/O=WorkSuite Tests/CN=WS Test CA', '-addext', 'basicConstraints=critical,CA:TRUE', '-addext', 'keyUsage=critical,keyCertSign,cRLSign']);
  const leaf = (name: string, san: string) => {
    ossl(dir, ['req', ...ec, '-keyout', `${name}.key`, '-out', `${name}.csr`, '-subj', `/CN=${name === 'wrong' ? 'other.example' : 'localhost'}`]);
    writeFileSync(join(dir, `${name}.ext`), `subjectAltName=${san}\nbasicConstraints=CA:FALSE\nextendedKeyUsage=serverAuth\n`);
  };
  leaf('leaf', 'DNS:localhost,IP:127.0.0.1');
  ossl(dir, ['x509', '-req', '-in', 'leaf.csr', '-CA', 'ca.crt', '-CAkey', 'ca.key', '-CAcreateserial', '-out', 'leaf.crt', '-days', '30', '-extfile', 'leaf.ext']);
  leaf('wrong', 'DNS:other.example');
  ossl(dir, ['x509', '-req', '-in', 'wrong.csr', '-CA', 'ca.crt', '-CAkey', 'ca.key', '-CAcreateserial', '-out', 'wrong.crt', '-days', '30', '-extfile', 'wrong.ext']);
  // An expired one: `openssl ca` is the only 3.0 command that takes explicit dates.
  leaf('expired', 'DNS:localhost,IP:127.0.0.1');
  writeFileSync(join(dir, 'index.txt'), '');
  writeFileSync(join(dir, 'serial'), '1000\n');
  writeFileSync(
    join(dir, 'ca.cnf'),
    `[ca]\ndefault_ca=d\n[d]\ndir=${dir}\ndatabase=${dir}/index.txt\nnew_certs_dir=${dir}\nserial=${dir}/serial\ndefault_md=sha256\npolicy=p\nunique_subject=no\n[p]\ncommonName=supplied\n`,
  );
  ossl(dir, ['ca', '-batch', '-config', 'ca.cnf', '-notext', '-startdate', '20200101000000Z', '-enddate', '20200201000000Z', '-in', 'expired.csr', '-out', 'expired.crt', '-cert', 'ca.crt', '-keyfile', 'ca.key', '-extfile', 'expired.ext']);
  const read = (f: string) => readFileSync(join(dir, f), 'utf8');
  const caCert = read('ca.crt');
  return {
    dir,
    caCert,
    caPin: certPin(caCert)!,
    leaf: { cert: read('leaf.crt'), key: read('leaf.key'), pin: certPin(read('leaf.crt'))! },
    wrongHost: { cert: read('wrong.crt'), key: read('wrong.key') },
    expired: { cert: read('expired.crt'), key: read('expired.key') },
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

export interface Route {
  status?: number;
  body?: string | Uint8Array;
  type?: string;
  headers?: Record<string, string>;
  delayMs?: number;
}

export interface TestServer {
  origin: string;
  port: number;
  routes: Record<string, Route>;
  hits: string[];
  close: () => Promise<void>;
}

export async function startServer(cert: string, key: string, caCert: string): Promise<TestServer> {
  const routes: Record<string, Route> = {};
  const hits: string[] = [];
  const server: Server = createServer({ cert: cert + caCert, key }, (req, res) => {
    const path = (req.url ?? '/').split('?')[0]!;
    hits.push(`${req.method} ${path}`);
    const r = routes[path];
    const send = () => {
      if (!r) {
        res.writeHead(path === '/' ? 200 : 404, { 'content-type': 'text/html' });
        res.end(path === '/' ? 'ok' : 'not found');
        return;
      }
      res.writeHead(r.status ?? 200, { 'content-type': r.type ?? 'application/json', ...r.headers });
      res.end(req.method === 'HEAD' ? undefined : r.body);
    };
    if (r?.delayMs) setTimeout(send, r.delayMs);
    else send();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    origin: `https://localhost:${port}`,
    port,
    routes,
    hits,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

const NET_NAMES: Record<number, string> = {
  [-150]: 'ERR_SSL_PINNED_KEY_NOT_IN_CERT_CHAIN',
  [-200]: 'ERR_CERT_COMMON_NAME_INVALID',
  [-201]: 'ERR_CERT_DATE_INVALID',
  [-202]: 'ERR_CERT_AUTHORITY_INVALID',
};

function chromiumCode(authorizationError: string | null): number {
  if (!authorizationError) return 0;
  if (/ALTNAME|HOSTNAME|does not match/i.test(authorizationError)) return -200;
  if (/EXPIRED|NOT_YET_VALID/i.test(authorizationError)) return -201;
  return -202;
}

/** Chromium's network stack with `trustedCa` as the OS trust store and the verify proc's pin decision. */
export function chromiumLikeFetch(opts: { trustedCa: string | null; pinsFor?: PinsFor }): (url: string, init: RequestInit) => Promise<Response> {
  return (url, init) =>
    new Promise<Response>((resolve, reject) => {
      const u = new URL(url);
      const signal = init.signal ?? undefined;
      if (signal?.aborted) {
        reject(signal.reason);
        return;
      }
      const req = httpsRequest(
        {
          host: u.hostname,
          port: u.port,
          path: u.pathname + u.search,
          method: init.method ?? 'GET',
          headers: init.headers as Record<string, string>,
          agent: false,
          rejectUnauthorized: false,
          ...(opts.trustedCa ? { ca: [opts.trustedCa] } : { ca: [] as string[] }),
        },
        (res) => {
          const status = res.statusCode ?? 0;
          if (status >= 300 && status < 400 && init.redirect === 'error') {
            res.destroy();
            reject(new TypeError('fetch failed', { cause: new Error('redirect mode is set to error') }));
            return;
          }
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => {
            const headers = new Headers();
            for (const [k, v] of Object.entries(res.headers)) if (typeof v === 'string') headers.set(k, v);
            const nobody = init.method === 'HEAD' || status === 204 || status === 304;
            resolve(new Response(nobody ? null : Buffer.concat(chunks), { status, headers }));
          });
          res.on('error', reject);
        },
      );
      req.on('socket', (socket) => {
        (socket as TLSSocket).once('secureConnect', () => {
          const s = socket as TLSSocket;
          const err = s.authorizationError ? String((s.authorizationError as unknown as { code?: string }).code ?? s.authorizationError) : null;
          let code = chromiumCode(err);
          const chain: string[] = [];
          let c = s.getPeerCertificate(true);
          const seen = new Set<string>();
          while (c?.raw && !seen.has(c.fingerprint256)) {
            seen.add(c.fingerprint256);
            const p = certPin(c.raw);
            if (p) chain.push(p);
            c = c.issuerCertificate;
          }
          const verdict = pinVerdict(chain, code, opts.pinsFor?.(u.hostname) ?? null);
          if (verdict !== -3) code = verdict;
          if (code !== 0) {
            req.destroy(new Error(`net::${NET_NAMES[code] ?? 'ERR_FAILED'}`));
          }
        });
      });
      req.on('error', reject);
      signal?.addEventListener('abort', () => req.destroy(signal.reason as Error), { once: true });
      req.end();
    });
}

/** Signing with the fixtures' test key (tests/fixtures/discovery/test-ed25519.key). */
const FIXTURES = join(__dirname, '../../../fixtures/discovery');
export const TEST_KEYS = JSON.parse(readFileSync(join(FIXTURES, 'keys.json'), 'utf8')) as { kid: string; discovery_key: string; raw: string };
const TEST_PRIVATE = createPrivateKey(readFileSync(join(FIXTURES, 'test-ed25519.key'), 'utf8'));

export function signJws(raw: Uint8Array | string, kid = TEST_KEYS.kid): string {
  const header = Buffer.from(JSON.stringify({ alg: 'EdDSA', kid, b64: true })).toString('base64url');
  const payload = Buffer.from(raw).toString('base64url');
  return `${header}..${sign(null, Buffer.from(`${header}.${payload}`), TEST_PRIVATE).toString('base64url')}`;
}

export function makeSetupLink(payload: Record<string, unknown>): string {
  const json = canonicalJson(payload);
  const s = sign(null, Buffer.from(json), TEST_PRIVATE).toString('base64');
  return `worksuite://setup?d=${Buffer.from(json).toString('base64url')}&s=${encodeURIComponent(s)}`;
}

/** A v1 discovery document for a test server. */
export function discoveryDoc(origin: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    product: 'WorkSuite',
    schema_version: 1,
    server_id: '0f6c1b2a-9d3e-5a47-8b21-5e4d3c2b1a00',
    server_name: 'Livezen Technologies',
    server_version: '2026.10',
    deployment: 'ENTERPRISE',
    api_versions: ['v1'],
    base_path: '/',
    endpoints: { api: `${origin}/api`, auth: `${origin}/api/auth`, realtime: null, files: null, office: null, ai: null, policy: null, entitlements: null, health: `${origin}/api/health` },
    auth: { mode: 'legacy', signup: false, browser_sign_in: { url: '/desktop/sign-in', exchange: '/api/auth/apps/exchange', poll: '/api/auth/apps/poll', client: 'worksuite-desktop' } },
    desktop: { min_version: { windows: '0.3.0', macos: '0.3.0', linux: '0.3.0' }, allowed_channels: ['stable'] },
    branding: { logo: null, accent: '#23349E' },
    link_hosts: ['localhost'],
    plans: null,
    keys: { discovery: TEST_KEYS.discovery_key, policy: TEST_KEYS.discovery_key },
    setup: { revoked_before: null },
    legacy: { desktop_api: 'desktop-v1', desktop: '/.well-known/worksuite-desktop' },
    ...over,
  };
}

export function leafSpki(pem: string): string {
  return certPin(new X509Certificate(pem).raw)!;
}

// A small WorkSuite Cloud for tests (Connection & Startup): the discovery document and its JWS, OneAuth (OIDC
// metadata, authorize, token, revoke), and Cloud's /api/v1/* (me, provisioning, storage, entitlements, plans) plus
// /api/health. Everything it signs, it signs with the TEST key in tests/fixtures/discovery/test-ed25519.key, over a
// document naming its own origin — so the app under test must trust that key (unpackaged builds only; see WP2).
//
// Run it:
//   node tests/e2e/mock-cloud.mjs [--port 8443] [--tls self-signed|provided|none]
// or import it:
//   import { startMockCloud } from './mock-cloud.mjs';
//   const cloud = await startMockCloud({ tls: 'self-signed' });   // cloud.origin, cloud.state, cloud.requests, cloud.close()
// and point the app at it with WS_CLOUD_ORIGIN=<cloud.origin> (honoured by unpackaged builds only).
//
// TLS modes:
//   self-signed (default)  a certificate made at start with the `openssl` command line (node:crypto cannot make
//                          X.509 certificates, and `selfsigned` is not a dependency). The app must refuse it with
//                          TLS_UNTRUSTED unless a managed SPKI pin allows it — `cloud.spki` is its pin.
//   provided               "trusted": the certificate and key in MOCK_CLOUD_CERT / MOCK_CLOUD_KEY (PEM files), e.g.
//                          from a test CA the machine trusts. `--cert` / `--key` work too.
//   none                   plain http on 127.0.0.1 (unpackaged builds accept http://localhost).
// Without `openssl` on the PATH, self-signed fails with a message saying to use `provided` or `none`.
//
// Control (tests drive the account through its states):
//   POST /__mock/state    JSON merged into the state: { account_state, provisioning, used, limit, unavailable,
//                         emailVerified, autoApprove, tamperEntitlements }
//   GET  /__mock/state    the state
//   GET  /__mock/requests every request seen: { method, path, at }
//   GET  /__mock/last-authorize  the last /oauth/authorize query (state, code_challenge, idp_hint, prompt …)
import { execFileSync } from 'node:child_process';
import { createHash, createPrivateKey, createPublicKey, randomBytes, sign, X509Certificate } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { URL, URLSearchParams, fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const fixtures = join(root, 'tests', 'fixtures');
const fixture = (dir, name) => JSON.parse(readFileSync(join(fixtures, dir, name), 'utf8'));

const privateKey = createPrivateKey(readFileSync(join(fixtures, 'discovery', 'test-ed25519.key')));
const spkiDer = createPublicKey(privateKey).export({ type: 'spki', format: 'der' });
export const TEST_DISCOVERY_KEY = `ed25519:${spkiDer.toString('base64')}`;
export const TEST_KID = createHash('sha256').update(spkiDer.subarray(12)).digest('hex').slice(0, 32).toUpperCase().match(/.{4}/g).join(':');

const b64url = (buf) => Buffer.from(buf).toString('base64url');

function detachedJws(bytes) {
  const header = b64url(JSON.stringify({ alg: 'EdDSA', kid: TEST_KID, b64: true }));
  return `${header}..${b64url(sign(null, Buffer.from(`${header}.${b64url(bytes)}`), privateKey))}`;
}

function compactJws(claims) {
  const header = b64url(JSON.stringify({ alg: 'EdDSA', kid: TEST_KID, typ: 'JWT' }));
  const payload = b64url(JSON.stringify(claims));
  return `${header}.${payload}.${b64url(sign(null, Buffer.from(`${header}.${payload}`), privateKey))}`;
}

function selfSignedCert() {
  const dir = mkdtempSync(join(tmpdir(), 'mock-cloud-'));
  try {
    const key = join(dir, 'key.pem');
    const cert = join(dir, 'cert.pem');
    execFileSync(
      'openssl',
      ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256', '-nodes', '-keyout', key, '-out', cert, '-days', '2', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1'],
      { stdio: 'ignore' },
    );
    return { key: readFileSync(key), cert: readFileSync(cert) };
  } catch (e) {
    throw new Error(`mock-cloud: could not make a self-signed certificate with openssl (${e.message}). Use --tls provided (MOCK_CLOUD_CERT / MOCK_CLOUD_KEY) or --tls none.`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** `sha256/<base64>` of a PEM certificate's public key: what a managed pin for it says. */
export function spkiPinOf(certPem) {
  const der = new X509Certificate(certPem).publicKey.export({ type: 'spki', format: 'der' });
  return `sha256/${createHash('sha256').update(der).digest('base64')}`;
}

const initialState = () => ({
  account_state: 'EMAIL_VERIFICATION_PENDING',
  provisioning: 'PROVISIONING',
  provisioningPolls: 0,
  used: 650 * 1024 * 1024,
  limit: 2 * 1024 * 1024 * 1024,
  unavailable: false,
  autoApprove: true,
  tamperEntitlements: false,
});

/**
 * Starts the mock. `tls`: 'self-signed' | 'provided' | 'none'; `cert` / `key`: PEM for 'provided'; `port`: 0 for any.
 */
export async function startMockCloud({ port = 0, tls = 'self-signed', cert, key } = {}) {
  let creds = null;
  if (tls === 'self-signed') creds = selfSignedCert();
  else if (tls === 'provided') {
    const certPath = cert ?? process.env.MOCK_CLOUD_CERT;
    const keyPath = key ?? process.env.MOCK_CLOUD_KEY;
    if (!certPath || !keyPath || !existsSync(certPath) || !existsSync(keyPath)) throw new Error('mock-cloud: --tls provided needs MOCK_CLOUD_CERT and MOCK_CLOUD_KEY (PEM files).');
    creds = { cert: readFileSync(certPath), key: readFileSync(keyPath) };
  }

  const state = initialState();
  const requests = [];
  const codes = new Map(); // code → { challenge, redirect_uri, nonce, client_id }
  const refreshTokens = new Set();
  let lastAuthorize = null;
  let origin = '';

  const discovery = () => {
    const doc = fixture('discovery', 'cloud.json');
    doc.endpoints = { ...doc.endpoints, api: `${origin}/api`, auth: `${origin}/oauth`, realtime: null, entitlements: `${origin}/api/v1/entitlements`, health: `${origin}/api/health` };
    doc.auth = { ...doc.auth, issuer: `${origin}/oauth`, recovery_url: `${origin}/oauth/forgot-password` };
    doc.link_hosts = [new URL(origin).hostname];
    doc.keys = { discovery: TEST_DISCOVERY_KEY, policy: null };
    return Buffer.from(JSON.stringify(doc));
  };

  const me = () => {
    const base = fixture('cloud', 'me-active.json');
    const pending = state.account_state === 'EMAIL_VERIFICATION_PENDING';
    return {
      ...base,
      identity: { ...base.identity, email_verified: !pending },
      account_state: state.account_state,
      organizations: pending ? [] : base.organizations.map((o) => ({ ...o, state: state.account_state === 'SUSPENDED' ? 'RESTRICTED' : o.state })),
      active_organization_id: pending ? null : base.active_organization_id,
      onboarding: { complete: state.account_state === 'ACTIVE', step: state.account_state === 'ACTIVE' ? null : 'workspace' },
    };
  };

  const provisioning = () => {
    if (state.provisioning === 'PROVISIONING_FAILED') return { state: 'PROVISIONING_FAILED', step: 'apps', attempts: 3, retry_at: new Date(Date.now() + 4 * 60_000).toISOString() };
    if (state.provisioning === 'ACTIVE') return { state: 'ACTIVE', step: 'done', attempts: 1, retry_at: null };
    return { state: 'PROVISIONING', step: ['drive', 'apps', 'preferences'][Math.min(2, state.provisioningPolls)], attempts: 1, retry_at: null };
  };

  const tokens = () => {
    const rt = b64url(randomBytes(32));
    refreshTokens.add(rt);
    return { access_token: b64url(randomBytes(24)), refresh_token: rt, expires_in: 3600, token_type: 'Bearer' };
  };

  async function body(req) {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const text = Buffer.concat(chunks).toString('utf8');
    if ((req.headers['content-type'] ?? '').includes('application/json')) {
      try {
        return JSON.parse(text || '{}');
      } catch {
        return {};
      }
    }
    return Object.fromEntries(new URLSearchParams(text));
  }

  const send = (res, status, data, type = 'application/json') => {
    const payload = typeof data === 'string' || Buffer.isBuffer(data) ? data : JSON.stringify(data);
    res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
    res.end(payload);
  };
  const authed = (req) => /^Bearer .+/.test(req.headers.authorization ?? '');

  async function handle(req, res) {
    const url = new URL(req.url, origin);
    const path = url.pathname;
    requests.push({ method: req.method, path, at: new Date().toISOString() });

    if (path.startsWith('/__mock/')) {
      if (path === '/__mock/state' && req.method === 'POST') {
        Object.assign(state, await body(req));
        return send(res, 200, state);
      }
      if (path === '/__mock/state') return send(res, 200, state);
      if (path === '/__mock/requests') return send(res, 200, requests);
      if (path === '/__mock/last-authorize') return send(res, 200, lastAuthorize);
      return send(res, 404, { message: 'unknown control' });
    }
    if (state.unavailable && path !== '/.well-known/worksuite' && path !== '/.well-known/worksuite.jws') {
      res.setHeader('retry-after', '30');
      return send(res, 503, { status: 'error', code: 'CLOUD_UNAVAILABLE', message: 'WorkSuite Cloud is temporarily unavailable.' });
    }

    // Discovery.
    if (path === '/.well-known/worksuite') return send(res, 200, discovery());
    if (path === '/.well-known/worksuite.jws') return send(res, 200, detachedJws(discovery()), 'application/jose');
    if (path === '/api/health') return send(res, 200, { status: 'ok' });

    // OneAuth.
    if (path === '/oauth/.well-known/openid-configuration') {
      return send(res, 200, {
        issuer: `${origin}/oauth`,
        authorization_endpoint: `${origin}/oauth/authorize`,
        token_endpoint: `${origin}/oauth/token`,
        revocation_endpoint: `${origin}/oauth/revoke`,
        end_session_endpoint: `${origin}/oauth/logout`,
        code_challenge_methods_supported: ['S256'],
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
      });
    }
    if (path === '/oauth/authorize') {
      lastAuthorize = Object.fromEntries(url.searchParams);
      const q = url.searchParams;
      if (q.get('response_type') !== 'code' || q.get('code_challenge_method') !== 'S256' || !q.get('code_challenge') || !q.get('state') || !q.get('redirect_uri')) {
        return send(res, 400, { error: 'invalid_request' });
      }
      if (!state.autoApprove) return send(res, 200, '<!doctype html><title>OneAuth (mock)</title><p>Waiting.</p>', 'text/html');
      const code = b64url(randomBytes(16));
      codes.set(code, { challenge: q.get('code_challenge'), redirect_uri: q.get('redirect_uri'), nonce: q.get('nonce'), client_id: q.get('client_id') });
      const back = new URL(q.get('redirect_uri'));
      back.searchParams.set('code', code);
      back.searchParams.set('state', q.get('state'));
      res.writeHead(302, { location: back.toString() });
      return res.end();
    }
    if (path === '/oauth/token' && req.method === 'POST') {
      const b = await body(req);
      if (b.grant_type === 'authorization_code') {
        const c = codes.get(b.code);
        codes.delete(b.code);
        const challenge = b.code_verifier ? createHash('sha256').update(b.code_verifier).digest('base64url') : null;
        if (!c || challenge !== c.challenge || b.redirect_uri !== c.redirect_uri) return send(res, 400, { error: 'invalid_grant' });
        const now = Math.floor(Date.now() / 1000);
        const idClaims = { iss: `${origin}/oauth`, aud: c.client_id, sub: 'u_7f3a9c', email: 'hasarinda@email.example', nonce: c.nonce, iat: now, exp: now + 300 };
        return send(res, 200, { ...tokens(), id_token: compactJws(idClaims) });
      }
      if (b.grant_type === 'refresh_token') {
        if (!refreshTokens.delete(b.refresh_token)) return send(res, 400, { error: 'invalid_grant' });
        return send(res, 200, tokens());
      }
      return send(res, 400, { error: 'unsupported_grant_type' });
    }
    if (path === '/oauth/revoke' && req.method === 'POST') {
      const b = await body(req);
      refreshTokens.delete(b.token);
      return send(res, 200, {});
    }

    // An upload while full: the gateway's QUOTA_EXCEEDED (transfers hold, nothing is lost).
    if (path === '/api/uploads/init' && req.method === 'POST' && state.used >= state.limit) return send(res, 507, { status: 'error', code: 'QUOTA_EXCEEDED', message: 'Your storage is full.' });

    // Cloud API.
    if (path.startsWith('/api/v1/')) {
      if (!authed(req)) return send(res, 401, { status: 'error', code: 'SESSION_EXPIRED', message: 'Sign in again.' });
      if (path === '/api/v1/me') return send(res, 200, me());
      if (path === '/api/v1/provisioning/status') {
        state.provisioningPolls++;
        return send(res, 200, provisioning());
      }
      if (path === '/api/v1/provisioning/retry' && req.method === 'POST') {
        state.provisioning = 'PROVISIONING';
        state.provisioningPolls = 0;
        return send(res, 200, provisioning());
      }
      if (path === '/api/v1/storage/usage') {
        const s = fixture('cloud', 'storage.json');
        return send(res, 200, { ...s, used: state.used, limit: state.limit });
      }
      if (path === '/api/v1/entitlements') {
        const claims = { ...fixture('cloud', 'entitlements-claims.json'), org: url.searchParams.get('organization_id') ?? 'org_4b2e81', iat: Math.floor(Date.now() / 1000) };
        let jws = compactJws(claims);
        if (state.tamperEntitlements) {
          const [h, , s] = jws.split('.');
          jws = `${h}.${b64url(JSON.stringify({ ...claims, apps: { ...claims.apps, crm: true } }))}.${s}`;
        }
        return send(res, 200, jws, 'application/jose');
      }
      if (path === '/api/v1/plans') return send(res, 200, fixture('cloud', 'plans.json'));
    }
    return send(res, 404, { status: 'error', code: 'NOT_FOUND', message: 'Not found.' });
  }

  const listener = (req, res) => {
    handle(req, res).catch((e) => send(res, 500, { message: String(e?.message ?? e) }));
  };
  const server = creds ? createHttpsServer(creds, listener) : createHttpServer(listener);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  origin = `${creds ? 'https' : 'http'}://${creds ? 'localhost' : '127.0.0.1'}:${server.address().port}`;
  return {
    origin,
    /** The certificate's SPKI pin (`sha256/…`), null for plain http. */
    spki: creds ? spkiPinOf(creds.cert) : null,
    cert: creds ? creds.cert.toString() : null,
    state,
    requests,
    reset: () => {
      Object.assign(state, initialState());
      requests.length = 0;
    },
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const arg = (name, fallback) => {
    const i = process.argv.indexOf(`--${name}`);
    return i > 0 ? process.argv[i + 1] : fallback;
  };
  const cloud = await startMockCloud({ port: Number(arg('port', '8443')), tls: arg('tls', 'self-signed'), cert: arg('cert'), key: arg('key') });
  console.log(`mock-cloud on ${cloud.origin}${cloud.spki ? ` (pin ${cloud.spki})` : ''} — WS_CLOUD_ORIGIN=${cloud.origin}`);
}

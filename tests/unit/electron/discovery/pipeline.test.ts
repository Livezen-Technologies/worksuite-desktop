import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { EMPTY_TRUSTED_CONFIG, type TrustedConfig } from '@shared/trusted-config';
import type { ConnectRun } from '@shared/discovery';
import { discover, runDiscovery, type PipelineDeps } from '../../../../electron/services/discovery/pipeline';
import type { HostPins } from '../../../../electron/services/discovery/pinning';
import { chromiumLikeFetch, discoveryDoc, makePki, makeSetupLink, signJws, startServer, TEST_KEYS, type TestPki, type TestServer } from './tls-server';

/**
 * The pipeline against a real TLS server with a private CA (Connection & Startup §2, §8.2 e2e 6 at unit level):
 * untrusted certificates with their details, managed pins that allow and pins that refuse, setup-link pins that only
 * restrict, signatures (good, tampered, required), a legacy-only server, compat, work-email lookup and setup links.
 */

let pki: TestPki;
let good: TestServer;
let wrongHost: TestServer;
let expired: TestServer;

beforeAll(async () => {
  pki = makePki();
  good = await startServer(pki.leaf.cert, pki.leaf.key, pki.caCert);
  wrongHost = await startServer(pki.wrongHost.cert, pki.wrongHost.key, pki.caCert);
  expired = await startServer(pki.expired.cert, pki.expired.key, pki.caCert);
}, 30_000);

afterAll(async () => {
  await Promise.all([good?.close(), wrongHost?.close(), expired?.close()]);
  pki?.cleanup();
});

function serveV1(s: TestServer, doc: Record<string, unknown>, opts: { sign?: boolean; tamper?: boolean } = {}): string {
  const raw = JSON.stringify(doc);
  for (const k of Object.keys(s.routes)) delete s.routes[k];
  s.routes['/.well-known/worksuite'] = { body: raw };
  if (opts.sign) {
    let jws = signJws(raw);
    if (opts.tamper) jws = jws.slice(0, -2) + (jws.endsWith('AA') ? 'BA' : 'AA');
    s.routes['/.well-known/worksuite.jws'] = { body: jws, type: 'application/jose' };
  }
  s.routes['/api/health'] = { body: '{"status":"success"}' };
  return raw;
}

const trust = (over: Partial<TrustedConfig>): TrustedConfig => ({ ...EMPTY_TRUSTED_CONFIG, spkiPins: [], ...over });

function deps(over: Partial<PipelineDeps> & { trustedCa?: string | null; chromiumPins?: (host: string) => HostPins | null } = {}): PipelineDeps {
  const { trustedCa = pki.caCert, chromiumPins, ...rest } = over;
  return {
    fetch: chromiumLikeFetch({ trustedCa, pinsFor: chromiumPins }),
    trusted: () => trust({}),
    rotatedKeys: () => ({}),
    existingAccount: () => null,
    appVersion: '0.3.0',
    platform: 'linux',
    isPackaged: false,
    cloudOrigin: 'https://worksuitecloud.com',
    lookup: async (h) => {
      if (h === 'localhost') return { address: '127.0.0.1' };
      throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${h}`), { code: 'ENOTFOUND' });
    },
    ...rest,
  };
}

async function run(input: string, d: PipelineDeps, target: 'personal' | 'enterprise' = 'enterprise', progress: ConnectRun[] = []) {
  return discover({ runId: 'run-1', input, target }, d, (r) => progress.push(r), new AbortController().signal);
}

const statuses = (r: ConnectRun) => Object.fromEntries(r.steps.map((s) => [s.id, s.status]));

describe('TLS', () => {
  beforeEach(() => serveV1(good, discoveryDoc(good.origin)));

  it('an untrusted certificate fails TLS_UNTRUSTED with the details for IT, and nothing after it runs', async () => {
    const progress: ConnectRun[] = [];
    good.hits.length = 0;
    const { run: r } = await run(good.origin, deps({ trustedCa: null }), 'enterprise', progress);
    expect(r.state).toBe('failed');
    expect(r.failure?.code).toBe('TLS_UNTRUSTED');
    expect(r.failure?.step).toBe('tls');
    expect(r.failure?.requestId).toBe('run-1');
    const tls = r.failure!.tls!;
    expect(tls.issuer).toContain('CN=WS Test CA');
    expect(tls.subject).toContain('CN=localhost');
    expect(tls.spki).toBe(pki.leaf.pin);
    expect(tls.host).toBe('localhost');
    expect(tls.port).toBe(good.port);
    expect(Date.parse(tls.validTo)).toBeGreaterThan(Date.now());
    expect(tls.reason).toContain('ERR_CERT_AUTHORITY_INVALID');
    expect(statuses(r)).toMatchObject({ dns: 'ok', tls: 'failed', document: 'waiting', health: 'waiting' });
    // Progress after every step: running and done.
    expect(progress.some((p) => p.steps.find((s) => s.id === 'tls')?.status === 'running')).toBe(true);
    expect(good.hits.some((h) => h.includes('well-known'))).toBe(false);
  });

  it('a certificate for another host is TLS_HOSTNAME, an expired one TLS_EXPIRED', async () => {
    serveV1(wrongHost, discoveryDoc(wrongHost.origin));
    serveV1(expired, discoveryDoc(expired.origin));
    const a = await run(wrongHost.origin, deps());
    expect(a.run.failure?.code).toBe('TLS_HOSTNAME');
    expect(a.run.failure?.tls?.subject).toContain('other.example');
    const b = await run(expired.origin, deps());
    expect(b.run.failure?.code).toBe('TLS_EXPIRED');
    expect(Date.parse(b.run.failure!.tls!.validTo)).toBeLessThan(Date.now());
  });

  it('a managed pin lets IT allow a private CA the OS does not trust', async () => {
    const managed = trust({ source: 'managed.json', serverUrl: good.origin, spkiPins: [pki.leaf.pin] });
    const pinsFor = (h: string): HostPins | null => (h === 'localhost' ? { pins: managed.spkiPins, managed: true } : null);
    const { run: r } = await run(good.origin, deps({ trustedCa: null, chromiumPins: pinsFor, trusted: () => managed }));
    expect(r.failure).toBeNull();
    expect(r.state).toBe('ok');
    expect(r.steps.find((s) => s.id === 'tls')?.note).toContain('pinned by your organization');
  });

  it('a pin on the CA key matches too', async () => {
    const managed = trust({ source: 'managed.json', serverUrl: good.origin, spkiPins: [pki.caPin] });
    const { run: r } = await run(good.origin, deps({ trusted: () => managed }));
    expect(r.state).toBe('ok');
  });

  it('a wrong pin is TLS_PIN_MISMATCH — from Chromium’s verify proc, and again from the chain node:tls reads', async () => {
    const wrong = 'sha256/' + Buffer.alloc(32, 7).toString('base64');
    const managed = trust({ source: 'managed.json', serverUrl: good.origin, spkiPins: [wrong] });
    const viaProc = await run(good.origin, deps({ trusted: () => managed, chromiumPins: () => ({ pins: [wrong], managed: true }) }));
    expect(viaProc.run.failure?.code).toBe('TLS_PIN_MISMATCH');
    expect(viaProc.run.failure?.tls?.spki).toBe(pki.leaf.pin);
    const recheck = await run(good.origin, deps({ trusted: () => managed }));
    expect(recheck.run.failure?.code).toBe('TLS_PIN_MISMATCH');
    expect(recheck.run.failure?.tls?.spki).toBe(pki.leaf.pin);
  });

  it('setup-link pins only restrict: a matching link pin never admits an untrusted chain', async () => {
    const pins = new Map<string, HostPins>();
    const link = makeSetupLink({ v: 2, server_url: good.origin, server_id: discoveryDoc(good.origin).server_id, name: 'Livezen', exp: 4102444800, iat: 1790000100, jti: 'j', discovery_key: TEST_KEYS.discovery_key, require_signed: true, allow_personal: true, spki_pins: [pki.leaf.pin] });
    serveV1(good, discoveryDoc(good.origin), { sign: true });
    const d = deps({ trustedCa: null, chromiumPins: (h) => pins.get(h) ?? null, runPins: (h, p) => (p ? pins.set(h, p) : pins.delete(h)) });
    const { run: r } = await run(link, d);
    expect(r.failure?.code).toBe('TLS_UNTRUSTED');
    expect(pins.size).toBe(0); // cleared when the run ends
  });
});

describe('document and signature', () => {
  it('connects to an unsigned v1 server: signature "Not configured", signed:false', async () => {
    serveV1(good, discoveryDoc(good.origin));
    const { run: r, trust: t } = await run(good.origin, deps());
    expect(r.state).toBe('ok');
    expect(statuses(r)).toEqual({ dns: 'ok', tls: 'ok', document: 'ok', signature: 'skipped', product: 'ok', version: 'ok', health: 'ok' });
    expect(r.steps.find((s) => s.id === 'signature')?.note).toBe('Not configured');
    expect(r.server).toMatchObject({ origin: good.origin, apiOrigin: good.origin, deployment: 'ENTERPRISE', schema: 'v1', signed: false, name: 'Livezen Technologies', serverVersion: '2026.10' });
    expect(r.server?.browserSignIn).toEqual({ url: '/desktop/sign-in', exchange: '/api/auth/apps/exchange', client: 'worksuite-desktop' });
    expect(t).toBeNull();
  });

  it('verifies against the managed key', async () => {
    serveV1(good, discoveryDoc(good.origin), { sign: true });
    const managed = trust({ source: 'registry', serverUrl: good.origin, discoveryKey: TEST_KEYS.raw });
    const { run: r, trust: t } = await run(good.origin, deps({ trusted: () => managed }));
    expect(r.state).toBe('ok');
    expect(r.server?.signed).toBe(true);
    expect(r.server?.trustSource).toBe('registry');
    expect(t?.source).toBe('registry');
  });

  it('a tampered worksuite.jws is SIGNATURE_INVALID, with or without a managed key', async () => {
    serveV1(good, discoveryDoc(good.origin), { sign: true, tamper: true });
    const managed = trust({ source: 'registry', serverUrl: good.origin, discoveryKey: TEST_KEYS.discovery_key });
    expect((await run(good.origin, deps({ trusted: () => managed }))).run.failure?.code).toBe('SIGNATURE_INVALID');
    expect((await run(good.origin, deps())).run.failure?.code).toBe('SIGNATURE_INVALID');
  });

  it('a document changed after signing is SIGNATURE_INVALID', async () => {
    const raw = serveV1(good, discoveryDoc(good.origin), { sign: true });
    good.routes['/.well-known/worksuite'] = { body: raw.replace('Livezen Technologies', 'Evil Technologies') };
    const managed = trust({ source: 'registry', serverUrl: good.origin, discoveryKey: TEST_KEYS.discovery_key });
    expect((await run(good.origin, deps({ trusted: () => managed }))).run.failure?.code).toBe('SIGNATURE_INVALID');
  });

  it('require_signed without a key, or a key without a signature, is SIGNATURE_MISSING', async () => {
    serveV1(good, discoveryDoc(good.origin));
    expect((await run(good.origin, deps({ trusted: () => trust({ source: 'policy.json', requireSigned: true }) }))).run.failure?.code).toBe('SIGNATURE_MISSING');
    const managed = trust({ source: 'registry', serverUrl: good.origin, discoveryKey: TEST_KEYS.discovery_key });
    expect((await run(good.origin, deps({ trusted: () => managed }))).run.failure?.code).toBe('SIGNATURE_MISSING');
  });

  it('a legacy /api/auth/config-only server still connects', async () => {
    for (const k of Object.keys(good.routes)) delete good.routes[k];
    good.routes['/api/auth/config'] = { body: JSON.stringify({ status: 'success', data: { brand: { name: 'ABC Company' } } }) };
    const { run: r } = await run(good.origin, deps());
    expect(r.state).toBe('ok');
    expect(r.server).toMatchObject({ schema: 'legacy-core', deployment: 'LEGACY', name: 'ABC Company', signed: false, authMode: 'legacy', apiOrigin: good.origin });
    expect(statuses(r)).toMatchObject({ signature: 'skipped', version: 'warning', health: 'warning' });
    expect(r.steps.find((s) => s.id === 'version')?.note).toBe('Version not reported');
  });

  it('a legacy desktop document keeps its passkey hand-off and minimum version', async () => {
    for (const k of Object.keys(good.routes)) delete good.routes[k];
    good.routes['/.well-known/worksuite-desktop'] = {
      body: JSON.stringify({ api: 'desktop-v1', name: 'ABC', minimum_versions: { linux: '0.2.0' }, passkey_sign_in: { url: '/desktop/passkey', exchange: '/api/auth/passkeys/desktop/exchange' } }),
    };
    good.routes['/api/health'] = { body: '{}' };
    const { run: r } = await run(good.origin, deps());
    expect(r.server).toMatchObject({ schema: 'legacy-desktop', minimumVersion: '0.2.0', passkey: { url: '/desktop/passkey', exchange: '/api/auth/passkeys/desktop/exchange' } });
  });

  it('something that is not WorkSuite is NOT_WORKSUITE', async () => {
    for (const k of Object.keys(good.routes)) delete good.routes[k];
    expect((await run(good.origin, deps())).run.failure?.code).toBe('NOT_WORKSUITE');
  });

  it('an unsigned document pointing elsewhere is ORIGIN_MISMATCH; a non-https endpoint NOT_WORKSUITE', async () => {
    const doc = discoveryDoc(good.origin);
    serveV1(good, { ...doc, endpoints: { ...(doc.endpoints as object), files: 'https://files.elsewhere.example/x' } });
    expect((await run(good.origin, deps())).run.failure?.code).toBe('ORIGIN_MISMATCH');
    serveV1(good, { ...doc, endpoints: { ...(doc.endpoints as object), files: 'ftp://localhost/x' } });
    expect((await run(good.origin, deps())).run.failure?.code).toBe('NOT_WORKSUITE');
  });

  it('an unreadable document is DISCOVERY_INVALID', async () => {
    serveV1(good, discoveryDoc(good.origin));
    good.routes['/.well-known/worksuite'] = { body: '{"product":"WorkSuite"' };
    expect((await run(good.origin, deps())).run.failure?.code).toBe('DISCOVERY_INVALID');
  });

  it('a WorkSuite Cloud document verifies against the Livezen keyring (the test key only unpackaged)', async () => {
    const doc = discoveryDoc(good.origin, { deployment: 'CLOUD', auth: { mode: 'oidc', signup: true, issuer: `${good.origin}/oidc`, client_id: 'worksuite-desktop' } });
    serveV1(good, doc, { sign: true });
    const { run: r } = await run('', deps({ cloudOrigin: good.origin }), 'personal');
    expect(r.state).toBe('ok');
    expect(r.server).toMatchObject({ deployment: 'CLOUD', signed: true, authMode: 'oidc', oidc: { issuer: `${good.origin}/oidc`, clientId: 'worksuite-desktop' } });
    expect((await run('', deps({ cloudOrigin: good.origin, isPackaged: true }), 'personal')).run.failure?.code).toBe('SIGNATURE_INVALID');
  });
});

describe('compatibility and health', () => {
  it('UPDATE_REQUIRED and SERVER_TOO_OLD carry the compat info', async () => {
    serveV1(good, discoveryDoc(good.origin, { desktop: { min_version: { linux: '9.0.0' } } }));
    const a = (await run(good.origin, deps())).run;
    expect(a.failure).toMatchObject({ code: 'UPDATE_REQUIRED', step: 'version', compat: { installed: '0.3.0', required: '9.0.0', supportedFrom: '2026.7' } });
    serveV1(good, discoveryDoc(good.origin, { server_version: '2026.1' }));
    const b = (await run(good.origin, deps())).run;
    expect(b.failure).toMatchObject({ code: 'SERVER_TOO_OLD', compat: { serverVersion: '2026.1' } });
  });

  it('a server that does not report its version gets a warning only', async () => {
    const doc = discoveryDoc(good.origin);
    delete doc.server_version;
    serveV1(good, doc);
    const r = (await run(good.origin, deps())).run;
    expect(r.state).toBe('ok');
    expect(statuses(r).version).toBe('warning');
  });

  it('a failing health endpoint is HEALTH_FAILED', async () => {
    serveV1(good, discoveryDoc(good.origin));
    good.routes['/api/health'] = { status: 503, body: '{}' };
    expect((await run(good.origin, deps())).run.failure).toMatchObject({ code: 'HEALTH_FAILED', step: 'health' });
  });
});

describe('policy', () => {
  beforeEach(() => serveV1(good, discoveryDoc(good.origin)));

  it('ACCOUNT_EXISTS, except when rediscovering', async () => {
    const existingAccount = () => 'acc_aaaaaaaaaaaaaaaaaaaa';
    expect((await run(good.origin, deps({ existingAccount }))).run.failure?.code).toBe('ACCOUNT_EXISTS');
    expect((await run(good.origin, deps({ existingAccount, rediscover: true }))).run.state).toBe('ok');
  });

  it('SERVER_NOT_ALLOWED when IT locks the server; the managed one still connects', async () => {
    const locked = trust({ source: 'registry', serverUrl: 'https://ws.corp.example', lockServer: true });
    good.hits.length = 0;
    const r = (await run(good.origin, deps({ trusted: () => locked }))).run;
    expect(r.failure?.code).toBe('SERVER_NOT_ALLOWED');
    expect(good.hits.length).toBe(0);
    const own = trust({ source: 'registry', serverUrl: good.origin, lockServer: true });
    expect((await run(good.origin, deps({ trusted: () => own }))).run.state).toBe('ok');
  });

  it('PERSONAL_NOT_ALLOWED when IT forbids personal accounts', async () => {
    const r = (await run('', deps({ trusted: () => trust({ source: 'registry', allowPersonal: false }) }), 'personal')).run;
    expect(r.failure).toMatchObject({ code: 'PERSONAL_NOT_ALLOWED', step: null });
  });

  it('refuses http and nonsense before any request', async () => {
    expect((await run('http://ws.example.com', deps())).run.failure?.code).toBe('HTTPS_REQUIRED');
    expect((await run('not a server', deps())).run.failure?.code).toBe('INVALID_ADDRESS');
  });

  it('can be cancelled mid-run', async () => {
    good.routes['/.well-known/worksuite'] = { ...good.routes['/.well-known/worksuite']!, delayMs: 2000 };
    const ac = new AbortController();
    const p = runDiscovery({ runId: 'r', input: good.origin, target: 'enterprise' }, deps(), (r) => {
      if (r.steps.find((s) => s.id === 'document')?.status === 'running') ac.abort();
    }, ac.signal);
    const r = await p;
    expect(r.state).toBe('cancelled');
    expect(r.failure).toBeNull();
    expect(r.steps.some((s) => s.status === 'running')).toBe(false);
  });
});

describe('work email', () => {
  beforeEach(() => serveV1(good, discoveryDoc(good.origin)));

  it('follows the _worksuite TXT record first', async () => {
    const asked: string[] = [];
    const d = deps({ resolveTxt: async (n) => (asked.push(n), [['v=ws1; ', `url=${good.origin}`]]) });
    const r = (await run('nuwan@livezentech.example', d)).run;
    expect(asked).toEqual(['_worksuite.livezentech.example']);
    expect(r.state).toBe('ok');
    expect(r.candidates).toEqual([good.origin, 'https://worksuite.livezentech.example', 'https://livezentech.example']);
    expect(r.host).toBe('localhost');
  });

  it('tries worksuite.<domain> then <domain>, and reports what it tried', async () => {
    const d = deps({ resolveTxt: async () => { throw new Error('ENODATA'); } });
    const r = (await run('nuwan@livezentech.example', d)).run;
    expect(r.candidates).toEqual(['https://worksuite.livezentech.example', 'https://livezentech.example']);
    expect(r.failure?.code).toBe('DNS_FAILED');
  });
});

describe('setup links', () => {
  const serverId = '0f6c1b2a-9d3e-5a47-8b21-5e4d3c2b1a00';
  const v2 = (over: Record<string, unknown> = {}) =>
    makeSetupLink({ v: 2, server_url: good.origin, server_id: serverId, name: 'Livezen', exp: 4102444800, iat: 1790000100, jti: 'j1', discovery_key: TEST_KEYS.discovery_key, require_signed: true, allow_personal: false, ...over });

  it('a v2 link brings its key and pins: the run is signed and the trust comes from the link', async () => {
    serveV1(good, discoveryDoc(good.origin), { sign: true });
    const { run: r, trust: t } = await run(v2({ spki_pins: [pki.leaf.pin], org_id: '17' }), deps());
    expect(r.state).toBe('ok');
    expect(r.server).toMatchObject({ signed: true, trustSource: 'setup-link' });
    expect(t).toMatchObject({ source: 'setup-link', serverUrl: good.origin, organizationId: '17', spkiPins: [pki.leaf.pin], requireSigned: true, allowPersonal: false, lockServer: false });
  });

  it('a v1 link is verified against the server’s own key', async () => {
    serveV1(good, discoveryDoc(good.origin), { sign: true });
    const link = makeSetupLink({ v: 1, server_url: good.origin, server_id: serverId, name: 'Livezen', exp: 4102444800 });
    const { run: r } = await run(link, deps());
    expect(r.state).toBe('ok');
    expect(r.server?.signed).toBe(true);
  });

  it('expired → SETUP_LINK_EXPIRED; revoked (iat before revoked_before) → SETUP_LINK_INVALID', async () => {
    serveV1(good, discoveryDoc(good.origin, { setup: { revoked_before: 1790000200 } }), { sign: true });
    expect((await run(v2({ exp: 1700000000 }), deps())).run.failure?.code).toBe('SETUP_LINK_EXPIRED');
    const revoked = (await run(v2(), deps())).run;
    expect(revoked.failure).toMatchObject({ code: 'SETUP_LINK_INVALID', step: 'signature' });
    expect(revoked.failure?.message).toMatch(/replaced/);
    expect((await run(v2({ iat: 1790000300 }), deps())).run.state).toBe('ok');
    // A v1 link has no iat: once the server names a revocation time it is revoked.
    const v1 = makeSetupLink({ v: 1, server_url: good.origin, server_id: serverId, name: 'Livezen', exp: 4102444800 });
    expect((await run(v1, deps())).run.failure?.code).toBe('SETUP_LINK_INVALID');
  });

  it('a link for another server, or with a broken signature, is SETUP_LINK_INVALID', async () => {
    serveV1(good, discoveryDoc(good.origin), { sign: true });
    expect((await run(v2({ server_id: '11111111-2222-3333-4444-555555555555' }), deps())).run.failure?.code).toBe('SETUP_LINK_INVALID');
    const link = v2();
    const broken = link.replace(/&s=[^&]+$/, `&s=${encodeURIComponent(Buffer.alloc(64, 1).toString('base64'))}`);
    expect((await run(broken, deps())).run.failure?.code).toBe('SETUP_LINK_INVALID');
  });
});

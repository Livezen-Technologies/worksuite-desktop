import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ServiceHealthState } from '@shared/accounts';
import { checkCompat, compareTrains } from '../../../../electron/services/discovery/compat';
import { emailCandidates, parseWsTxt } from '../../../../electron/services/discovery/email-lookup';
import { HealthMonitor, parseRetryAfter, retryDelay } from '../../../../electron/services/discovery/health';
import { normalizeInput } from '../../../../electron/services/discovery/normalize';
import { classifyTlsError, installPinning, pinVerdict } from '../../../../electron/services/discovery/pinning';
import type { Session } from 'electron';
import { makePki } from './tls-server';

describe('normalize', () => {
  const n = (s: string, allowLocalhost = false) => normalizeInput(s, { allowLocalhost });
  it.each([
    ['ws.example.com', { kind: 'origin', origin: 'https://ws.example.com' }],
    ['https://WS.Example.com/login?x=1', { kind: 'origin', origin: 'https://ws.example.com' }],
    ['https://ws.example.com:8443', { kind: 'origin', origin: 'https://ws.example.com:8443' }],
    ['http://ws.example.com', { kind: 'invalid', code: 'HTTPS_REQUIRED' }],
    ['http://localhost:8080', { kind: 'invalid', code: 'HTTPS_REQUIRED' }],
    ['https://user:pw@ws.example.com', { kind: 'invalid', code: 'INVALID_ADDRESS' }],
    ['ftp://ws.example.com', { kind: 'invalid', code: 'INVALID_ADDRESS' }],
    ['not a server', { kind: 'invalid', code: 'INVALID_ADDRESS' }],
    ['intranet', { kind: 'invalid', code: 'INVALID_ADDRESS' }],
    ['nuwan@Livezen.Example', { kind: 'email', domain: 'livezen.example' }],
    ['nuwan@localhost', { kind: 'invalid', code: 'INVALID_ADDRESS' }],
    ['worksuite://setup?d=x&s=y', { kind: 'setup-link', link: 'worksuite://setup?d=x&s=y' }],
  ] as const)('%s', (input, out) => {
    expect(n(input)).toEqual(out);
  });

  it('allows http://localhost in unpackaged builds only', () => {
    expect(n('http://localhost:8080', true)).toEqual({ kind: 'origin', origin: 'http://localhost:8080' });
    expect(n('http://ws.example.com', true)).toEqual({ kind: 'invalid', code: 'HTTPS_REQUIRED' });
  });
});

describe('work email lookup', () => {
  it('reads v=ws1 records', () => {
    expect(parseWsTxt('v=ws1; url=https://ws.corp.example/x')).toBe('https://ws.corp.example');
    expect(parseWsTxt('V=WS1;URL=https://ws.corp.example')).toBe('https://ws.corp.example');
    expect(parseWsTxt('v=ws2; url=https://ws.corp.example')).toBeNull();
    expect(parseWsTxt('v=ws1; url=http://ws.corp.example')).toBeNull();
    expect(parseWsTxt('v=spf1 include:x')).toBeNull();
  });

  it('TXT first, then worksuite.<domain>, then <domain>, without duplicates', async () => {
    expect(await emailCandidates('corp.example', async () => [['v=ws1; url=https://worksuite.corp.example']])).toEqual(['https://worksuite.corp.example', 'https://corp.example']);
    expect(await emailCandidates('corp.example', async () => [['v=spf1'], ['v=ws1; url=https://ws.hosted.example']])).toEqual([
      'https://ws.hosted.example',
      'https://worksuite.corp.example',
      'https://corp.example',
    ]);
  });
});

describe('compat', () => {
  it('compares release trains numerically', () => {
    expect(compareTrains('2026.10', '2026.7')).toBe(1);
    expect(compareTrains('2026.7', '2026.7.0')).toBe(0);
    expect(compareTrains('2025.12', '2026.1')).toBe(-1);
    expect(compareTrains('latest', '2026.7')).toBeNull();
  });

  it('UPDATE_REQUIRED, SERVER_TOO_OLD, and a warning when not reported', () => {
    expect(checkCompat({ appVersion: '0.2.252', minVersion: '0.3.0', serverVersion: '2026.10' })).toMatchObject({ ok: false, code: 'UPDATE_REQUIRED', compat: { required: '0.3.0' } });
    expect(checkCompat({ appVersion: '0.3.0-beta.1', minVersion: '0.3.0', serverVersion: null })).toMatchObject({ ok: false, code: 'UPDATE_REQUIRED' });
    expect(checkCompat({ appVersion: '0.3.0', minVersion: '0.3.0', serverVersion: '2026.6' })).toMatchObject({ ok: false, code: 'SERVER_TOO_OLD', compat: { serverVersion: '2026.6', supportedFrom: '2026.7', required: null } });
    expect(checkCompat({ appVersion: '0.3.0', minVersion: null, serverVersion: null })).toMatchObject({ ok: true, status: 'warning', note: 'Version not reported' });
    expect(checkCompat({ appVersion: '0.3.0', minVersion: 'garbage', serverVersion: '2026.10' })).toMatchObject({ ok: true, status: 'ok' });
    expect(checkCompat({ appVersion: '0.3.0', minVersion: null, serverVersion: 'nightly' })).toMatchObject({ ok: true, status: 'warning' });
  });
});

describe('TLS error classification', () => {
  it.each([
    [new Error('net::ERR_CERT_AUTHORITY_INVALID'), 'TLS_UNTRUSTED'],
    [new Error('net::ERR_CERT_DATE_INVALID'), 'TLS_EXPIRED'],
    [new Error('net::ERR_CERT_COMMON_NAME_INVALID'), 'TLS_HOSTNAME'],
    [new Error('net::ERR_SSL_PINNED_KEY_NOT_IN_CERT_CHAIN'), 'TLS_PIN_MISMATCH'],
    [new TypeError('fetch failed', { cause: Object.assign(new Error('self-signed certificate'), { code: 'DEPTH_ZERO_SELF_SIGNED_CERT' }) }), 'TLS_UNTRUSTED'],
    [new TypeError('fetch failed', { cause: Object.assign(new Error('certificate has expired'), { code: 'CERT_HAS_EXPIRED' }) }), 'TLS_EXPIRED'],
    [new Error('net::ERR_CONNECTION_REFUSED'), null],
  ])('%s', (e, code) => {
    expect(classifyTlsError(e)).toBe(code);
  });
});

describe('pinning verify proc', () => {
  const pki = makePki();

  it('the decision: no pins → Chromium; mismatch → -150; managed pin admits authority-invalid only', () => {
    const pins = { pins: ['sha256/A'], managed: true };
    expect(pinVerdict(['sha256/A'], 0, null)).toBe(-3);
    expect(pinVerdict(['sha256/B'], 0, pins)).toBe(-150);
    expect(pinVerdict(['sha256/A'], 0, pins)).toBe(-3);
    expect(pinVerdict(['sha256/A'], -202, pins)).toBe(0);
    expect(pinVerdict(['sha256/A'], -201, pins)).toBe(-3);
    expect(pinVerdict(['sha256/A'], -202, { ...pins, managed: false })).toBe(-3);
  });

  it('installPinning reads the Electron chain (leaf and issuers) and answers through the callback', () => {
    let proc: ((req: unknown, cb: (n: number) => void) => void) | null = null;
    const ses = { setCertificateVerifyProc: (p: typeof proc) => (proc = p) } as unknown as Session;
    const pinsFor = vi.fn((host: string) => (host === 'ws.corp.example' ? { pins: [pki.caPin], managed: true } : null));
    installPinning(ses, pinsFor);
    const ca = { data: pki.caCert } as { data: string; issuerCert?: unknown };
    ca.issuerCert = ca;
    const certificate = { data: pki.leaf.cert, issuerCert: ca };
    const answer = (hostname: string, errorCode: number, cert: unknown = certificate) => {
      let out = NaN;
      proc!({ hostname, certificate: cert, validatedCertificate: cert, errorCode, verificationResult: '', isIssuedByKnownRoot: false }, (n) => (out = n));
      return out;
    };
    expect(answer('ws.corp.example', -202)).toBe(0);
    expect(answer('ws.corp.example', 0)).toBe(-3);
    expect(answer('other.example', -202)).toBe(-3);
    expect(answer('ws.corp.example', 0, { data: pki.wrongHost.cert })).toBe(-150);
    pki.cleanup();
  });
});

describe('HealthMonitor', () => {
  afterEach(() => vi.useRealTimers());

  it('backoff from 5 s, doubling with jitter, never above 300 s; Retry-After honoured within the cap', () => {
    const delays = Array.from({ length: 12 }, (_, i) => retryDelay(i, null, () => 1));
    expect(delays.slice(0, 4)).toEqual([5_000, 10_000, 20_000, 40_000]);
    expect(Math.max(...delays)).toBe(300_000);
    for (let i = 0; i < 40; i++) expect(retryDelay(i, null)).toBeLessThanOrEqual(300_000);
    expect(retryDelay(0, 0, () => 0)).toBe(2_500); // jitter keeps at least half
    expect(retryDelay(0, 120_000, () => 1)).toBe(120_000);
    expect(retryDelay(0, 3_600_000, () => 1)).toBe(300_000);
    expect(parseRetryAfter('30', 0)).toBe(30_000);
    expect(parseRetryAfter(new Date(60_000).toUTCString(), 0)).toBe(60_000);
    expect(parseRetryAfter('soon', 0)).toBeNull();
  });

  it('tells offline, unreachable and unavailable apart, and retries on the capped schedule', async () => {
    vi.useFakeTimers();
    let online = true;
    let mode: 'down' | '503' | 'ok' = '503';
    const fetch = vi.fn(async () => {
      if (mode === 'down') throw new TypeError('fetch failed');
      if (mode === '503') return new Response('{}', { status: 503, headers: { 'retry-after': '20' } });
      return new Response('{}', { status: 200 });
    });
    const states: ServiceHealthState[] = [];
    const m = new HealthMonitor({ healthUrl: () => 'https://ws.example.com/api/health', fetch, internetOnline: () => online, onChange: (s) => states.push(s), random: () => 1, now: () => Date.now() });
    m.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(m.state()).toMatchObject({ state: 'unavailable' });
    expect(Date.parse(m.state().nextRetryAt!) - Date.now()).toBe(20_000); // Retry-After over a 5 s backoff

    mode = 'down';
    await vi.advanceTimersByTimeAsync(20_000);
    expect(m.state().state).toBe('unreachable');
    online = false;
    await m.retryNow();
    expect(m.state().state).toBe('offline');

    // Many failures: the wait between probes never passes 300 s.
    let last = fetch.mock.calls.length;
    const gaps: number[] = [];
    let t = Date.now();
    online = true;
    for (let i = 0; i < 12; i++) {
      await vi.advanceTimersByTimeAsync(300_000);
      if (fetch.mock.calls.length > last) {
        gaps.push(Date.now() - t);
        t = Date.now();
        last = fetch.mock.calls.length;
      }
    }
    expect(m.state().nextRetryAt && Date.parse(m.state().nextRetryAt!) - Date.now()).toBeLessThanOrEqual(300_000);
    expect(fetch.mock.calls.length).toBeGreaterThanOrEqual(10);
    expect(Math.max(...gaps)).toBeLessThanOrEqual(300_000);

    mode = 'ok';
    await m.retryNow();
    expect(m.state()).toMatchObject({ state: 'ok', label: '', since: null, nextRetryAt: null });
    expect(states.map((s) => s.state)).toEqual(expect.arrayContaining(['unavailable', 'unreachable', 'offline', 'ok']));
    m.setWorkOffline(true);
    expect(m.state().workOffline).toBe(true);
    m.stop();
  });

  it('components: each endpoint probed, websocket and missing ones unknown', async () => {
    const fetch = vi.fn(async (url: string) => new Response('{}', { status: url.includes('files') ? 502 : 200 }));
    const m = new HealthMonitor({
      healthUrl: () => 'https://ws.example.com/api/health',
      fetch,
      internetOnline: () => true,
      onChange: () => undefined,
      componentUrls: () => ({ auth: 'https://ws.example.com/api/auth/config', realtime: 'wss://rt.example.com', files: 'https://files.example.com/health', office: null }),
      syncHealth: () => ({ state: 'healthy', detail: 'Up to date' }),
    });
    const h = await m.components('acc_aaaaaaaaaaaaaaaaaaaa');
    expect(h.components.api.state).toBe('healthy');
    expect(h.components.auth.state).toBe('healthy');
    expect(h.components.files).toEqual({ state: 'down', detail: 'Temporarily unavailable' });
    expect(h.components.realtime.state).toBe('unknown');
    expect(h.components.office.state).toBe('unknown');
    expect(h.components.sync).toEqual({ state: 'healthy', detail: 'Up to date' });
  });
});

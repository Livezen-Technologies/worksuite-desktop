import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('electron', () => ({ app: { getPath: () => '/tmp', getVersion: () => '0.1.0' }, safeStorage: {} }));
import {
  contentDisposition,
  headerTime,
  isSafeHeaderValue,
  normalizeContentDisposition,
  safeHeaders,
  safeHeaderValue,
  sanitizeHeaderValue,
  setHeaderSafetyMode,
  setUnsafeHeaderReporter,
  UnsafeHeaderError,
} from '@shared/http-headers';
import { createApiProxy } from '../../../electron/services/api-proxy';
import { AiService } from '../../../electron/services/ai';
import { HttpClient, NOT_SENT_MESSAGE, withSafeHeaders, type FetchLike } from '../../../electron/services/http';
import type { OfflineCache } from '../../../electron/services/offline-cache';
import { DesktopError } from '../../../electron/main/errors';
import { recentLog } from '../../../electron/main/log';
import { FRIENDLY_ERROR, installProcessGuards } from '../../../electron/main/process-guards';

/**
 * worksuite-desktop#238: "Cannot convert argument to a ByteString… character 8239". U+202F is what macOS puts in
 * "6:29 PM"; with Sinhala, Tamil, emoji and long file names it must never reach a header, and a request that
 * cannot be built is that screen's error, never a main-process crash.
 */
const NNBSP = '\u202f';
const MAC_TIME = `6:29${NNBSP}PM`;
const SINHALA = 'සිංහල';
const TAMIL = 'தமிழ்';
const EMOJI = '📎🎉';
const LONG_NAME = `${'වාර්තාව-அறிக்கை-report-'.repeat(20)}${EMOJI} ${MAC_TIME}.pdf`;
const SAMPLES = [MAC_TIME, SINHALA, TAMIL, EMOJI, LONG_NAME, `Q3 ${SINHALA} ${TAMIL} ${EMOJI} at ${MAC_TIME}`];

/** What undici does with a header: throws on anything above 255. */
function undiciAccepts(value: string): boolean {
  try {
    new Headers().set('x-probe', value);
    return true;
  } catch {
    return false;
  }
}

function maxCode(value: string): number {
  let m = 0;
  for (let i = 0; i < value.length; i++) m = Math.max(m, value.charCodeAt(i));
  return m;
}

afterEach(() => {
  setHeaderSafetyMode('throw');
  setUnsafeHeaderReporter(() => undefined);
});

describe('the header-safety helper', () => {
  it('is in throw mode under tests, so an unsafe header fails loudly — naming the header, never the value', () => {
    expect(undiciAccepts(MAC_TIME)).toBe(false); // the crash, as undici raises it
    try {
      safeHeaderValue('X-Client-Time', MAC_TIME);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(UnsafeHeaderError);
      expect((e as Error).message).toContain('X-Client-Time');
      expect((e as Error).message).not.toContain('6:29');
    }
  });

  it.each(SAMPLES)('makes %s safe: nothing above 255, accepted by undici, reported by name', (sample) => {
    setHeaderSafetyMode('report');
    const reported: string[] = [];
    setUnsafeHeaderReporter((name) => reported.push(name));
    const v = safeHeaderValue('X-Title', sample);
    expect(maxCode(v)).toBeLessThanOrEqual(255);
    expect(undiciAccepts(v)).toBe(true);
    expect(reported).toEqual(['X-Title']);
  });

  it('turns U+202F and other Unicode spaces into a plain space, and keeps what was already safe', () => {
    expect(sanitizeHeaderValue(MAC_TIME)).toBe('6:29 PM');
    expect(sanitizeHeaderValue('a\u2009b\u00a0c\u3000d')).toBe('a b c d');
    expect(sanitizeHeaderValue('application/json')).toBe('application/json');
    expect(sanitizeHeaderValue('caf\u00e9')).toBe('caf\u00e9');
    expect(sanitizeHeaderValue('caf\u00e9', { ascii: true })).toBe('caf%C3%A9');
  });

  it('percent-encodes Sinhala, Tamil and emoji as UTF-8, so the server can read them back', () => {
    for (const s of [SINHALA, TAMIL, EMOJI]) {
      const v = sanitizeHeaderValue(s);
      expect(v).toBe(encodeURIComponent(s));
      expect(decodeURIComponent(v)).toBe(s);
    }
  });

  it('strips control characters, so a value can never start a second header', () => {
    const v = sanitizeHeaderValue('ok\r\nSet-Cookie: x=1\u0000\u0007');
    // eslint-disable-next-line no-control-regex
    expect(v).not.toMatch(/[\r\n\u0000\u0007]/);
    expect(isSafeHeaderValue(v)).toBe(true);
  });

  it('safeHeaders cleans a whole set and drops a name that is not a token', () => {
    setHeaderSafetyMode('report');
    const out = safeHeaders({ Accept: 'application/json', 'X-Name': `${SINHALA} ${EMOJI}`, 'Bad Name': 'x', Empty: undefined });
    expect(Object.keys(out)).toEqual(['Accept', 'X-Name']);
    expect(() => new Headers(out)).not.toThrow();
  });

  it('times go in headers as ISO 8601, never as a locale time', () => {
    const at = new Date(Date.UTC(2026, 9, 5, 13, 29));
    expect(headerTime(at)).toBe('2026-10-05T13:29:00.000Z');
    expect(headerTime(at.getTime())).toBe('2026-10-05T13:29:00.000Z');
    expect(isSafeHeaderValue(headerTime(), 0x7e)).toBe(true);
    expect(() => headerTime('not a time')).toThrow(RangeError);
  });
});

describe('file names: RFC 5987', () => {
  it.each([
    ['plain.pdf', 'attachment; filename="plain.pdf"'],
    [`Report ${MAC_TIME}.pdf`, null],
    [`${SINHALA}.docx`, null],
    [`${TAMIL} குறிப்பு.xlsx`, null],
    [`photo ${EMOJI}.png`, null],
    [LONG_NAME, null],
  ])('%s gets an ASCII fallback and the real name in filename*', (name, exact) => {
    const v = contentDisposition(name);
    expect(undiciAccepts(v)).toBe(true);
    expect(isSafeHeaderValue(v, 0x7e)).toBe(true);
    if (exact) return expect(v).toBe(exact);
    const fallback = /filename="([^"]*)"/.exec(v)![1]!;
    expect(fallback.length).toBeLessThanOrEqual(150);
    expect(fallback.endsWith(name.slice(name.lastIndexOf('.')))).toBe(true);
    const star = /filename\*=UTF-8''(.+)$/.exec(v)![1]!;
    expect(decodeURIComponent(star)).toBe(name.normalize('NFC'));
  });

  it('reads a name the server wrote as raw UTF-8 bytes back as the name it meant', () => {
    const name = `${SINHALA} ${MAC_TIME}.pdf`;
    const asBytes = String.fromCharCode(...new TextEncoder().encode(name)); // what arrives on the wire, byte per char
    const v = normalizeContentDisposition(`attachment; filename="${asBytes}"`);
    expect(decodeURIComponent(/filename\*=UTF-8''(.+)$/.exec(v)![1]!)).toBe(name);
    expect(normalizeContentDisposition('inline; filename="a.pdf"')).toBe('inline; filename="a.pdf"');
  });
});

function client(fetch: FetchLike, clientHeaders: () => Record<string, string> = () => ({ 'X-WS-Client': 'worksuite-desktop/0.1.0 (macos; arm64)' })) {
  return new HttpClient({
    fetch,
    origin: () => 'https://ws.test',
    tokens: { accessToken: () => 'tok', refresh: async () => 'ok' },
    clientHeaders,
    onReachability: () => undefined,
    onAuthLost: () => undefined,
  });
}

const okJson = () => new Response(JSON.stringify({ status: 'success', data: { ok: true } }), { headers: { 'Content-Type': 'application/json' } });

describe('the main-process HTTP client', () => {
  it.each(SAMPLES)('sends only safe headers when a caller passes %s (the app: cleaned and reported)', async (sample) => {
    setHeaderSafetyMode('report');
    const fetch = vi.fn<FetchLike>(async () => okJson());
    const c = client(fetch, () => ({ 'X-WS-Client': 'worksuite-desktop/0.1.0', 'X-WS-Device': `${SINHALA}-${sample}` }));
    await expect(c.post('/api/ai/assist/chat', { text: sample }, { headers: { 'X-Request-Context': sample, 'Idempotency-Key': `k-${sample}` } })).resolves.toEqual({ ok: true });
    const init = fetch.mock.calls[0]![1];
    const headers = init.headers as Headers;
    headers.forEach((v) => expect(maxCode(v)).toBeLessThanOrEqual(255));
    // User text stays whole in the JSON body.
    expect(JSON.parse(String(init.body)).text).toBe(sample);
  });

  it('turns a header it cannot send into a normal error for the screen (Retry), and never calls fetch (tests: throw mode)', async () => {
    const fetch = vi.fn<FetchLike>(async () => okJson());
    const c = client(fetch);
    const err = await c.post('/api/ai/assist/chat', { text: 'hi' }, { headers: { 'X-Client-Time': MAC_TIME } }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DesktopError);
    expect((err as DesktopError).code).toBe('INTERNAL');
    expect((err as DesktopError).message).toBe(NOT_SENT_MESSAGE);
    expect(fetch).not.toHaveBeenCalled();
    expect(recentLog().some((l) => l.includes('request could not be built') && l.includes('X-Client-Time'))).toBe(true);
  });

  it("a fetch that throws undici's own ByteString error is a handled error, not 'server unreachable'", async () => {
    const reach = vi.fn();
    const c = new HttpClient({
      fetch: () => {
        new Headers().set('x', MAC_TIME); // throws, as Electron's net.fetch would
        return Promise.resolve(okJson());
      },
      origin: () => 'https://ws.test',
      tokens: { accessToken: () => null, refresh: async () => 'ok' },
      clientHeaders: () => ({}),
      onReachability: reach,
      onAuthLost: () => undefined,
    });
    const err = (await c.get('/api/x').catch((e: unknown) => e)) as DesktopError;
    expect(err.code).toBe('INTERNAL');
    expect(reach).not.toHaveBeenCalledWith(false);
  });

  it('withSafeHeaders: every request through net.fetch is cleaned, and a synchronous throw becomes a rejection', async () => {
    setHeaderSafetyMode('report');
    const inner = vi.fn(async (_u: string, _i: RequestInit) => okJson());
    const safe = withSafeHeaders(inner);
    await safe('https://ws.test/api/auth/login', { method: 'POST', headers: { 'X-WS-Device': `${TAMIL} ${EMOJI}`, 'X-Client-Time': MAC_TIME } });
    const sent = inner.mock.calls[0]![1].headers as Record<string, string>;
    expect(() => new Headers(sent)).not.toThrow();
    expect(sent['X-Client-Time']).toBe('6:29 PM');

    const throwing = withSafeHeaders((): Promise<Response> => {
      throw new TypeError('Cannot convert argument to a ByteString because the character at index 58 has a value of 8239');
    });
    const err = await throwing('https://ws.test/x', {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DesktopError);
    expect((err as DesktopError).message).toBe(NOT_SENT_MESSAGE);
  });
});

describe('the AI Assistant reply path: page → app:// proxy → HTTP client', () => {
  function proxyWith(raw: (...a: unknown[]) => Promise<Response>, extra?: Record<string, string>) {
    return createApiProxy({
      http: { raw, url: (p: string) => `https://ws.test${p}` } as unknown as HttpClient,
      cache: {} as OfflineCache,
      userId: () => '7',
      cacheModuleFor: () => null,
      cacheLimits: () => ({}) as never,
      mailBodiesCached: () => false,
      extraHeaders: () => extra ?? null,
    });
  }
  /** A request as Electron hands it over, after reading the page's header bytes back as UTF-8. */
  function pageRequest(headers: Record<string, string>, body: unknown): Request {
    const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
    return {
      method: 'POST',
      headers: { get: (h: string) => lower[h.toLowerCase()] ?? null },
      arrayBuffer: async () => new TextEncoder().encode(JSON.stringify(body)).buffer,
      signal: new AbortController().signal,
    } as unknown as Request;
  }

  it.each(SAMPLES)('sends the question (%s) with safe headers and the text intact in the body', async (sample) => {
    setHeaderSafetyMode('report');
    const raw = vi.fn(async (..._a: unknown[]) => okJson());
    const proxy = proxyWith(raw, { 'X-Salon-Desk-Key': `${TAMIL}` });
    const body = { text: `When is ${sample}?`, reply_language: 'si' };
    const res = await proxy(pageRequest({ 'Content-Type': 'application/json', 'Idempotency-Key': `ask-${sample}` }, body), '/api/ai/assist/chat');
    expect(res.status).toBe(200);
    const init = raw.mock.calls[0]![2] as { headers: Headers; body: ArrayBuffer };
    init.headers.forEach((v) => expect(maxCode(v)).toBeLessThanOrEqual(255));
    expect(JSON.parse(new TextDecoder().decode(init.body)).text).toBe(body.text);
  });

  it('answers a header it cannot send with an error envelope the AI screen shows with Try again — no crash', async () => {
    const raw = vi.fn(async (..._a: unknown[]) => okJson());
    const proxy = proxyWith(raw);
    const res = await proxy(pageRequest({ 'Content-Type': 'application/json', 'Idempotency-Key': `ask ${MAC_TIME}` }, { text: 'hi' }), '/api/ai/assist/chat');
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ status: 'error', code: 'INTERNAL', message: "Couldn't send this request. Try again." });
    expect(raw).not.toHaveBeenCalled();
  });

  it('a client error from the HTTP client is a 500 envelope, not "offline"', async () => {
    const proxy = proxyWith(async () => {
      throw new DesktopError('INTERNAL', NOT_SENT_MESSAGE);
    });
    const res = await proxy(pageRequest({ 'Content-Type': 'application/json' }, { text: 'hi' }), '/api/ai/assist/chat');
    expect(res.status).toBe(500);
    expect((await res.json()).message).toBe(NOT_SENT_MESSAGE);
  });

  it('returns a download name the server wrote as raw UTF-8 as RFC 5987', async () => {
    const name = `${TAMIL} ${EMOJI}.pdf`;
    const wire = String.fromCharCode(...new TextEncoder().encode(name));
    const upstream = new Response('x', { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${wire}"` } });
    const proxy = proxyWith(async () => upstream);
    const res = await proxy(new Request('app://bundle/__api/api/files/1/download'), '/api/files/1/download');
    const cd = res.headers.get('content-disposition')!;
    expect(isSafeHeaderValue(cd, 0x7e)).toBe(true);
    expect(decodeURIComponent(/filename\*=UTF-8''(.+)$/.exec(cd)![1]!)).toBe(name);
  });

  it('a picked file with a Sinhala/Tamil/emoji name goes to the assistant in the JSON body, not a header', async () => {
    const post = vi.fn(async (_p: string, b: unknown) => ({ ref: 'up:1', name: (b as { name: string }).name }));
    const ai = new AiService({
      get: (async () => ({ enabled: true, quick_ask: true, insert: true, local_files: true })) as never,
      post: post as never,
      policy: () => null,
      driveIdAt: () => null,
      realpath: async (p) => p,
      size: async () => 3,
      read: async () => Buffer.from('abc'),
    });
    await ai.refresh();
    const name = `${SINHALA} ${TAMIL} ${EMOJI} ${MAC_TIME}.txt`;
    const r = await ai.upload(`/home/me/${name}`);
    expect(r.name).toBe(name);
    expect(post.mock.calls[0]![0]).toBe('/api/ai/context/uploads');
    expect((post.mock.calls[0]![1] as { name: string }).name).toBe(name);
  });
});

describe('main-process guards', () => {
  it('logs an uncaught error for Diagnostics, reports it, and says so once in the app — no dialog, no exit', () => {
    const target = new EventEmitter();
    const notify = vi.fn();
    const report = vi.fn();
    let t = 0;
    const remove = installProcessGuards({ target: target as unknown as NodeJS.Process, notify, report, quietMs: 1000, now: () => t });
    const boom = new TypeError(`Cannot convert argument to a ByteString because the character at index 58 has a value of 8239`);
    target.emit('uncaughtException', boom);
    target.emit('uncaughtException', boom);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(FRIENDLY_ERROR);
    expect(report).toHaveBeenCalledWith(expect.stringContaining('8239'));
    expect(recentLog().some((l) => l.includes('uncaught exception') && l.includes('ByteString'))).toBe(true);
    t = 2000;
    target.emit('uncaughtException', new Error('later'));
    expect(notify).toHaveBeenCalledTimes(2);

    target.emit('unhandledRejection', new Error('background'));
    expect(notify).toHaveBeenCalledTimes(2); // logged only
    expect(recentLog().some((l) => l.includes('unhandled promise rejection') && l.includes('background'))).toBe(true);

    remove();
    expect(target.listenerCount('uncaughtException')).toBe(0);
    expect(target.listenerCount('unhandledRejection')).toBe(0);
  });

  it('a guard that fails while handling never throws back into the process', () => {
    const target = new EventEmitter();
    const remove = installProcessGuards({
      target: target as unknown as NodeJS.Process,
      notify: () => {
        throw new Error('no window');
      },
      report: () => {
        throw new Error('no reporter');
      },
    });
    expect(() => target.emit('uncaughtException', new Error('x'))).not.toThrow();
    remove();
  });

  it('reports a cleaned header by name to the diagnostics log', () => {
    const target = new EventEmitter();
    const remove = installProcessGuards({ target: target as unknown as NodeJS.Process });
    setHeaderSafetyMode('report');
    safeHeaderValue('X-Request-Context', `${SINHALA} ${MAC_TIME}`);
    expect(recentLog().some((l) => l.includes('unsafe request header cleaned') && l.includes('X-Request-Context') && !l.includes(SINHALA))).toBe(true);
    remove();
  });
});

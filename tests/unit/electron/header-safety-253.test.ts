import { Readable, Writable } from 'node:stream';
import { mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: () => tmpdir(), getVersion: () => '0.1.0', isPackaged: false },
  safeStorage: {},
  protocol: { handle: vi.fn() },
}));

import {
  contentDisposition,
  isSafeHeaderValue,
  normalizeContentDisposition,
  responseHeaders,
  sanitizeHeaderValue,
  setHeaderSafetyMode,
  wireHeaderValue,
} from '@shared/http-headers';
import { createNetFetch, type NetRequest } from '../../../electron/services/net-fetch';
import { createApiProxy } from '../../../electron/services/api-proxy';
import { HttpClient, withSafeHeaders } from '../../../electron/services/http';
import type { OfflineCache } from '../../../electron/services/offline-cache';
import { createAppHandler, protocolSafeResponse } from '../../../electron/protocols/app-protocol';

/**
 * worksuite-desktop#253: opening "FORM TECH-10 — Bid Security (Bank Guarantee).pdf" in the tender viewer crashed
 * the main process with "Cannot convert argument to a ByteString… value of 8212", and the viewer sat on "Opening the
 * file…". The server wrote the name into `Content-Disposition` as raw UTF-8; Chromium's network layer hands Electron
 * the header bytes decoded as UTF-8, and Electron's own `net.fetch` copies them into a `Headers` with `set()` inside
 * its 'response' listener — which throws on U+2014, outside any promise, so the fetch never settles.
 */
const REPORTED = 'FORM TECH-10 — Bid Security (Bank Guarantee).pdf';
const NAMES = [
  REPORTED,
  '“Final” ‘offer’.docx',
  'Minutes 6:29 PM.pdf',
  'ටෙන්ඩර් ලේඛනය.pdf',
  'ஒப்பந்த ஆவணம்.xlsx',
  'photo 📷🎉.png',
  'Résumé – café.pdf',
];
const PDF = new TextEncoder().encode('%PDF-1.4\n%âãÏÓ\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');

const ascii = (v: string) => isSafeHeaderValue(v, 0x7e);
const star = (v: string) => decodeURIComponent(/filename\*=UTF-8''([^;\s]+)/.exec(v)![1]!);
const plain = (v: string) => /filename="([^"]*)"/.exec(v)![1]!;
/** What Electron's net.fetch did with each response header (lib/common/api/net-fetch.ts). */
const electronNetFetchCopy = (headers: Record<string, string>) => {
  const t = new Headers();
  for (const [k, v] of Object.entries(headers)) t.set(k, v);
  return t;
};

afterEach(() => {
  setHeaderSafetyMode('throw');
});

/** A stand-in for Electron's ClientRequest: a Writable that answers with the response Chromium would give. */
class FakeClientRequest extends Writable {
  sent: Record<string, string> = {};
  body: Buffer[] = [];
  aborted = false;
  constructor(
    readonly options: Record<string, unknown>,
    private readonly answer: { status?: number; statusMessage?: string; headers: Record<string, string | string[]>; body?: Uint8Array; fail?: Error },
  ) {
    super();
  }
  setHeader(k: string, v: string) {
    // Electron's ClientRequest refuses what Chromium would (net::HttpUtil::IsValidHeaderValue): \0, CR, LF.
    if (/[\0\r\n]/.test(v)) throw new TypeError(`Invalid value for header '${k}'`);
    this.sent[k.toLowerCase()] = v;
  }
  abort() {
    this.aborted = true;
  }
  override _write(chunk: Buffer, _enc: BufferEncoding, cb: () => void) {
    this.body.push(Buffer.from(chunk));
    cb();
  }
  override _final(cb: () => void) {
    cb();
    setImmediate(() => {
      if (this.answer.fail) return this.emit('error', this.answer.fail);
      const resp = Object.assign(Readable.from(this.answer.body ? [Buffer.from(this.answer.body)] : []), {
        statusCode: this.answer.status ?? 200,
        statusMessage: this.answer.statusMessage ?? 'OK',
        headers: this.answer.headers,
      });
      this.emit('response', resp);
    });
  }
}

function fakeNet(answer: ConstructorParameters<typeof FakeClientRequest>[1]) {
  const made: FakeClientRequest[] = [];
  const request = ((o: Record<string, unknown>) => {
    const r = new FakeClientRequest(o, answer);
    made.push(r);
    return r;
  }) as unknown as NetRequest;
  return { request, made };
}

/** The headers Chromium hands Electron for a server that wrote the name as raw UTF-8 (decoded as UTF-8). */
const serverHeaders = (name: string, extra: Record<string, string> = {}) => ({
  'content-type': 'application/pdf',
  'content-disposition': `inline; filename="${name}"`,
  'content-length': String(PDF.byteLength),
  ...extra,
});

describe('the root cause', () => {
  it("is Electron's net.fetch copying a UTF-8 Content-Disposition into Headers: it throws on 8212", () => {
    expect(() => electronNetFetchCopy(serverHeaders(REPORTED))).toThrow(/ByteString|8212/);
  });
});

describe('createNetFetch: a response header can never crash the main process', () => {
  it.each(NAMES)('reads %s from a raw UTF-8 Content-Disposition and settles', async (name) => {
    const { request } = fakeNet({ headers: serverHeaders(name), body: PDF });
    const res = await createNetFetch(request)('https://ws.test/api/tenders/checklist/10/download');
    expect(res.status).toBe(200);
    const cd = res.headers.get('content-disposition')!;
    expect(ascii(cd)).toBe(true);
    expect(cd.startsWith('inline; ')).toBe(true);
    expect(star(cd)).toBe(name.normalize('NFC'));
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PDF);
  });

  it('writes the fallback name as the name reads: — is -, curly quotes are straight', async () => {
    const { request } = fakeNet({ headers: serverHeaders(REPORTED), body: PDF });
    const cd = (await createNetFetch(request)('https://ws.test/x')).headers.get('content-disposition')!;
    expect(plain(cd)).toBe('FORM TECH-10 - Bid Security (Bank Guarantee).pdf');
    expect(cd).toBe(`inline; filename="FORM TECH-10 - Bid Security (Bank Guarantee).pdf"; filename*=UTF-8''FORM%20TECH-10%20%E2%80%94%20Bid%20Security%20%28Bank%20Guarantee%29.pdf`);
    expect(plain(contentDisposition('“Final” ‘offer’.docx'))).toBe("'Final' 'offer'.docx");
  });

  it('keeps any other header value as the bytes it came in (as undici and a browser read it), never throwing', async () => {
    const { request } = fakeNet({ headers: { 'content-type': 'text/plain', 'x-note': 'naïve — ok', etag: '"abc"', 'set-cookie': ['a=1', 'b=2'] }, body: new Uint8Array([104, 105]) });
    const res = await createNetFetch(request)('https://ws.test/x');
    const note = res.headers.get('x-note')!;
    expect(note).toBe(wireHeaderValue('naïve — ok'));
    expect(new TextDecoder().decode(Uint8Array.from(note, (c) => c.charCodeAt(0)))).toBe('naïve — ok');
    expect(res.headers.get('etag')).toBe('"abc"');
    expect(await res.text()).toBe('hi');
  });

  it('leaves out a header that still cannot be held, and reports only its name', () => {
    const dropped: string[] = [];
    const h = responseHeaders({ 'bad name': 'x', 'content-type': 'text/plain' }, (n) => dropped.push(n));
    expect(h.get('content-type')).toBe('text/plain');
    expect(dropped).toEqual(['bad name']);
  });

  it('rejects that one fetch, never the process, when the response cannot be built', async () => {
    const { request, made } = fakeNet({ status: 99, headers: serverHeaders(REPORTED) });
    await expect(createNetFetch(request)('https://ws.test/x')).rejects.toBeInstanceOf(RangeError);
    expect(made[0]!.aborted).toBe(true);
  });

  it('rejects on a network error and on abort', async () => {
    const failing = fakeNet({ headers: {}, fail: new Error('net::ERR_CONNECTION_RESET') });
    await expect(createNetFetch(failing.request)('https://ws.test/x')).rejects.toThrow('ERR_CONNECTION_RESET');
    const ctl = new AbortController();
    ctl.abort();
    await expect(createNetFetch(fakeNet({ headers: {} }).request)('https://ws.test/x', { signal: ctl.signal })).rejects.toBeTruthy();
  });

  it('sends the request as net.fetch did: method, URL, session, redirect policy and safe headers', async () => {
    const { request, made } = fakeNet({ headers: { 'content-type': 'application/json' }, body: new TextEncoder().encode('{}') });
    const session = { id: 'persist:ws-net' } as unknown as Electron.Session;
    await createNetFetch(request, session)('https://ws.test/api/x', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer t' }, body: '{"name":"' + REPORTED + '"}', redirect: 'manual' });
    const r = made[0]!;
    expect(r.options).toMatchObject({ method: 'POST', url: 'https://ws.test/api/x', session, redirect: 'manual', credentials: 'include' });
    expect(r.sent.authorization).toBe('Bearer t');
    // The name travels in the body, in UTF-8: never in a header.
    expect(JSON.parse(Buffer.concat(r.body).toString('utf8')).name).toBe(REPORTED);
    for (const v of Object.values(r.sent)) expect(ascii(v)).toBe(true);
  });

  it('uploads a file with any name as multipart: the name in the body, the headers plain ASCII', async () => {
    for (const name of NAMES) {
      const { request, made } = fakeNet({ headers: { 'content-type': 'application/json' }, body: new TextEncoder().encode('{}') });
      const form = new FormData();
      form.append('file', new Blob([PDF], { type: 'application/pdf' }), name);
      await createNetFetch(request)('https://ws.test/api/files/1/versions', { method: 'POST', body: form });
      const r = made[0]!;
      for (const v of Object.values(r.sent)) expect(ascii(v)).toBe(true);
      expect(Buffer.concat(r.body).toString('utf8')).toContain(`filename="${name.replace(/"/g, '%22')}"`);
    }
  });
});

describe('the viewer path end to end: server → net fetch → HTTP client → API proxy → app:// protocol', () => {
  function build(name: string) {
    const { request } = fakeNet({ headers: serverHeaders(name), body: PDF });
    const http = new HttpClient({
      fetch: withSafeHeaders(createNetFetch(request)),
      origin: () => 'https://ws.test',
      tokens: { accessToken: () => 'tok', refresh: async () => 'ok' },
      clientHeaders: () => ({ 'X-WS-Client': 'worksuite-desktop/0.1.0 (macos; arm64)' }),
      onReachability: () => undefined,
      onAuthLost: () => undefined,
    });
    const proxy = createApiProxy({
      http,
      cache: {} as OfflineCache,
      userId: () => '7',
      cacheModuleFor: () => null,
      cacheLimits: () => ({}) as never,
      mailBodiesCached: () => false,
    });
    return createAppHandler(mkdtempSync(join(tmpdir(), 'ws-bundle-')), proxy);
  }

  it.each(NAMES)('opens %s', async (name) => {
    setHeaderSafetyMode('report');
    const handler = build(name);
    const res = await handler(new Request('app://bundle/__api/api/tenders/checklist/10/download'));
    expect(res.status).toBe(200);
    res.headers.forEach((v) => expect(ascii(v)).toBe(true));
    expect(star(res.headers.get('content-disposition')!)).toBe(name.normalize('NFC'));
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PDF);
  });
});

describe('the app:// protocol handler never throws', () => {
  const root = mkdtempSync(join(tmpdir(), 'ws-bundle-'));

  it('makes the app ask the server again for every API answer, so a saved file is never shown as it was (#396)', async () => {
    const handler = createAppHandler(root, async () => new Response('v2', { status: 200, headers: { 'Content-Type': 'application/pdf', 'Cache-Control': 'private, max-age=21600' } }));
    const res = await handler(new Request('app://bundle/__api/api/files/7/download'));
    expect(res.headers.get('cache-control')).toBe('no-cache');
    expect(await res.text()).toBe('v2');
    const empty = createAppHandler(root, async () => new Response(null, { status: 304 }));
    expect((await empty(new Request('app://bundle/__api/api/files/7/download'))).status).toBe(304);
  });

  it('answers 500, with safe headers, when the API proxy throws', async () => {
    const handler = createAppHandler(root, async () => {
      throw new TypeError(`Cannot convert argument to a ByteString because the character at index 13 has a value of 8212`);
    });
    const res = await handler(new Request('app://bundle/__api/api/files/1/download'));
    expect(res.status).toBe(500);
    res.headers.forEach((v) => expect(ascii(v)).toBe(true));
    expect((await res.json()) as unknown).toMatchObject({ status: 'error', code: 'INTERNAL' });
  });

  it('answers 500 when a local handler throws or gives no Response', async () => {
    const throwing = createAppHandler(root, async () => new Response(null), undefined, async () => {
      new Headers().set('content-disposition', `inline; filename="${REPORTED}"`);
      return new Response(null);
    });
    expect((await throwing(new Request('app://bundle/__local/chat-media/x'))).status).toBe(500);
    const nothing = createAppHandler(root, async () => new Response(null), undefined, async () => undefined as unknown as Response);
    expect((await nothing(new Request('app://bundle/__local/elearning/1/2'))).status).toBe(500);
  });

  it.each(NAMES)('writes a Content-Disposition for %s it was handed in Latin-1 bytes as RFC 5987', async (name) => {
    const bytes = String.fromCharCode(...new TextEncoder().encode(name));
    const handler = createAppHandler(root, async () => new Response(PDF, { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${bytes}"`, 'X-Other': 'café' } }));
    const res = await handler(new Request('app://bundle/__api/api/tenders/documents/5/file'));
    expect(res.status).toBe(200);
    res.headers.forEach((v) => expect(ascii(v)).toBe(true));
    expect(star(res.headers.get('content-disposition')!)).toBe(name.normalize('NFC'));
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PDF);
  });

  it('passes an already plain response through untouched', () => {
    const r = new Response('x', { headers: { 'Content-Type': 'text/plain', 'Content-Disposition': contentDisposition(REPORTED, 'inline') } });
    expect(protocolSafeResponse(r)).toBe(r);
  });

  it('answers 404 for another host and 500-free for a bundle miss', async () => {
    const handler = createAppHandler(root, async () => new Response(null));
    expect((await handler(new Request('app://elsewhere/x'))).status).toBe(404);
    expect((await handler(new Request('app://bundle/missing.js'))).status).toBe(404);
  });
});

describe('the helpers themselves never throw', () => {
  const broken = ['\ud83d', 'a\udc00b.pdf', `${REPORTED}\ud800`, '\u0000\r\n', '', '"""', '%%%.pdf', '.pdf'];

  it.each(broken)('contentDisposition, normalizeContentDisposition, wireHeaderValue and sanitizeHeaderValue take %j', (v) => {
    expect(() => contentDisposition(v)).not.toThrow();
    expect(ascii(contentDisposition(v))).toBe(true);
    expect(() => normalizeContentDisposition(`attachment; filename="${v}"`)).not.toThrow();
    expect(ascii(normalizeContentDisposition(`attachment; filename="${v}"`))).toBe(true);
    expect(() => new Headers().set('x', wireHeaderValue(v))).not.toThrow();
    expect(() => sanitizeHeaderValue(v)).not.toThrow();
  });

  it('prefers a real filename* over the plain name beside it', () => {
    const v = `attachment; filename="FORM TECH-10 â€” Bid.pdf"; filename*=UTF-8''FORM%20TECH-10%20%E2%80%94%20Bid.pdf`;
    expect(star(normalizeContentDisposition(v))).toBe('FORM TECH-10 — Bid.pdf');
  });
});

describe('no request or response we build puts an unencoded file name or title in a header', () => {
  function sources(dir: string): string[] {
    const out: string[] = [];
    for (const e of readdirSync(dir)) {
      const p = join(dir, e);
      if (statSync(p).isDirectory()) out.push(...sources(p));
      else if (/\.(ts|tsx)$/.test(e)) out.push(p);
    }
    return out;
  }
  const files = [...sources(join(__dirname, '../../../electron')), ...sources(join(__dirname, '../../../src')), ...sources(join(__dirname, '../../../shared'))];

  it('names no header after a file name or a title', () => {
    const offenders = files.filter((f) => /['"`]X-[A-Za-z-]*(File-?Name|Filename|Title|Original-?Name)[A-Za-z-]*['"`]\s*[:,\]]/i.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('builds every Content-Disposition response header through contentDisposition / normalizeContentDisposition', () => {
    const offenders = files.filter((f) => {
      const text = readFileSync(f, 'utf8');
      // A header (not a MIME part written into a body): `'Content-Disposition': …` with a file name pasted in.
      return /['"]Content-Disposition['"]\s*:\s*`[^`]*filename=/i.test(text);
    });
    expect(offenders).toEqual([]);
  });
});

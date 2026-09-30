import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { emptySecurity, type PdfSearchProgress, type PdfSessionView } from '../../../shared/pdf';
import { contract } from '../../../shared/ipc/contract';
import { DesktopError } from '../../../electron/main/errors';
import { EngineError, type EngineFile, type RenderRequest } from '../../../electron/services/pdf/engine';
import { PdfLocalFiles, pdfPathsInArgv } from '../../../electron/services/pdf/local-files';
import { DEFAULT_PDF_POLICY, DesktopPdfService, type EngineHandle, type PdfPolicy, type PdfServiceDeps } from '../../../electron/services/pdf/service';
import { PdfStorage } from '../../../electron/services/pdf/storage';
import { makePdf } from './pdf-fixture';

/**
 * DesktopPDFService with the engine behind PDFEngineInterface faked: what it
 * fetches and in which order, what it keeps on disk, how it queues and
 * cancels, what it tells the window, and what it never lets out.
 */
class FakeEngine implements EngineHandle {
  onGone?: (e: EngineError) => void;
  opened: Array<{ file: EngineFile; password: string | null }> = [];
  renders: RenderRequest[] = [];
  closed = false;
  password: string | null = null;
  permissions = { print: true, printHighQuality: true, copy: true, modify: true, annotate: true, fillForms: true, assemble: true };
  linkMap: Record<number, Array<{ index: number; rect: [number, number, number, number]; kind: 'page' | 'uri' | 'launch' | 'remote' | 'other'; page?: number; uri?: string }>> = {};
  hold: Array<() => void> = [];
  holdRenders = false;
  capabilities() {
    return { engine: 'Fake', version: '1', render: true, tiles: true, text: true, search: true, regex: true, outline: true, links: true, attachments: true, layers: false, annotationsRead: true, annotationsWrite: false, pages: false, save: false, editText: false, aes256: false, pades: false, javascript: false as const };
  }
  async open(file: EngineFile, password: string | null) {
    this.opened.push({ file, password });
    if (this.password && password !== this.password) throw new EngineError('password', 'This PDF is protected with a password.');
    return { pageCount: 3, pages: [[612, 792], [612, 792], [792, 612]] as Array<[number, number]>, info: { title: 'T', author: '', subject: '', keywords: '', creator: '', producer: '', created: '', modified: '', version: '1.7' }, permissions: this.permissions, security: { ...emptySecurity(), javascript: 1 } };
  }
  async render(req: RenderRequest) {
    this.renders.push(req);
    if (this.holdRenders) await new Promise<void>((r) => this.hold.push(r));
    const w = req.tile?.w ?? 10;
    const h = req.tile?.h ?? 10;
    return { width: w, height: h, data: new Uint8Array(w * h * 4) };
  }
  async search(_q: string, _o: unknown, onProgress: (p: { hits: never[]; pagesDone: number; truncated: boolean }) => void) {
    onProgress({ hits: [], pagesDone: 2, truncated: false });
    onProgress({ hits: [], pagesDone: 3, truncated: false });
  }
  async outline() {
    return [];
  }
  async links(page: number) {
    return this.linkMap[page] ?? [];
  }
  async attachments() {
    return [];
  }
  async scan() {
    return { ...emptySecurity(), javascript: 2, launchActions: 1, pagesScanned: 3, structureScanned: true };
  }
  async annotations() {
    return [];
  }
  async apply() {
    return [[612, 792], [612, 792], [792, 612]] as Array<[number, number]>;
  }
  async textSpan() {
    return { rects: [], text: '' };
  }
  async save() {
    return new Uint8Array(0);
  }
  async extract() {
    return new Uint8Array(0);
  }
  async unload() {}
  async close() {
    this.closed = true;
  }
}

let dir: string;
let engines: FakeEngine[];
let emitted: Array<{ sender: number; channel: string; payload: unknown }>;
let audit: Array<{ action: string; details: Record<string, unknown> }>;
let logged: Array<{ m: string; d?: Record<string, unknown> }>;
let policy: PdfPolicy;
let routes: string[];
let responses: Record<string, () => Response>;
let gets: Record<string, unknown>;
let printed: Array<{ pages: number[] }>;
let followed: Array<{ url: string; confirm: boolean }>;
let local: PdfLocalFiles;
let storage: PdfStorage;
let makeEngine: () => FakeEngine;

function service(over: Partial<PdfServiceDeps> = {}) {
  return new DesktopPdfService({
    storage,
    local,
    http: {
      get: async <T,>(path: string) => {
        routes.push(`GET ${path}`);
        if (!(path in gets)) throw new DesktopError('NOT_FOUND', 'That file no longer exists.', 404);
        const v = gets[path];
        if (v instanceof Error) throw v;
        return v as T;
      },
      raw: async (_m: string, url: string) => {
        const path = new URL(url).pathname;
        routes.push(`RAW ${path}`);
        return responses[path]?.() ?? new Response('no', { status: 404 });
      },
      url: (path: string, q?: Record<string, string | number | boolean | null | undefined>) => {
        const u = new URL(path, 'https://ws.example');
        for (const [k, v] of Object.entries(q ?? {})) if (v !== undefined && v !== null) u.searchParams.set(k, String(v));
        return u.toString();
      },
    },
    engine: () => {
      const e = makeEngine();
      engines.push(e);
      return e;
    },
    policy: () => policy,
    desktop: () => ({ downloads: true, diskCache: true }),
    encode: (_b, w, h, kind) => Buffer.from(`${kind}:${w}x${h}`),
    print: async (job) => {
      for (const p of job.pages) await job.image(p.index);
      printed.push({ pages: job.pages.map((p) => p.index) });
      return { printed: true };
    },
    openLink: async (url, confirm) => {
      followed.push({ url, confirm });
      return true;
    },
    emit: (sender, channel, payload) => emitted.push({ sender, channel, payload }),
    audit: (action, details) => audit.push({ action, details }),
    log: { info: (m, d) => logged.push({ m, d }), warn: (m, d) => logged.push({ m, d }), error: (m, d) => logged.push({ m, d }) },
    appVersion: '0.2.56',
    ...over,
  });
}

const until = async (fn: () => boolean, ms = 2000) => {
  const t = Date.now();
  while (!fn()) {
    if (Date.now() - t > ms) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
};
const lastView = (id: string) => [...emitted].reverse().find((e) => e.channel === 'pdf:changed' && (e.payload as PdfSessionView).id === id)?.payload as PdfSessionView | undefined;
const readyView = async (id: string) => {
  await until(() => lastView(id)?.state === 'ready' || lastView(id)?.state === 'failed' || lastView(id)?.state === 'password');
  return lastView(id)!;
};

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'ws-pdfsvc-'));
  mkdirSync(join(dir, 'userData'));
  engines = [];
  emitted = [];
  audit = [];
  logged = [];
  routes = [];
  responses = {};
  gets = {};
  printed = [];
  followed = [];
  policy = { ...DEFAULT_PDF_POLICY };
  makeEngine = () => new FakeEngine();
  local = new PdfLocalFiles({ maxBytes: () => policy.maxBytes, forbidden: () => [join(dir, 'userData')] });
  storage = new PdfStorage(join(dir, 'userData', 'PDF'), () => Buffer.alloc(32, 7));
  await storage.prepare();
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function localPdf(name = 'Contract.pdf', bytes = makePdf({ pages: 3 })): string {
  const p = join(dir, name);
  writeFileSync(p, bytes);
  return p;
}

describe('PDFLocalFileBridge (PDF-ARCH-014, PDF-API-001)', () => {
  it('hands out handles only for real PDFs outside WorkSuite’s own folder, within the size limit', async () => {
    const pdf = localPdf();
    writeFileSync(join(dir, 'notes.pdf'), 'just text, named like a PDF');
    writeFileSync(join(dir, 'userData', 'inside.pdf'), makePdf());
    const r = await local.register([pdf, join(dir, 'notes.pdf'), join(dir, 'userData', 'inside.pdf'), join(dir, 'missing.pdf'), 'relative.pdf', dir]);
    expect(r.files).toHaveLength(1);
    expect(r.files[0]).toMatchObject({ name: 'Contract.pdf' });
    expect(r.files[0]!.handle).toMatch(/^[0-9a-f-]{36}$/);
    expect(r.rejected.map((x) => x.reason)).toEqual([
      'notes.pdf is not a PDF.',
      "inside.pdf is inside WorkSuite's own data and cannot be opened here.",
      'missing.pdf could not be found.',
      'relative.pdf is not a file on this computer.',
      expect.stringMatching(/is not a file\.$/),
    ]);
    // No reason names the folder it came from.
    expect(r.rejected.some((x) => x.reason.includes(dir))).toBe(false);
    policy = { ...policy, maxBytes: 100 };
    expect((await local.register([pdf])).rejected[0]!.reason).toMatch(/larger than/);
    // The same file again: the same handle, so its open tab is found.
    policy = { ...DEFAULT_PDF_POLICY };
    expect((await local.register([pdf])).files[0]!.handle).toBe(r.files[0]!.handle);
  });

  it('takes only absolute .pdf paths from a second launch’s arguments', () => {
    expect(pdfPathsInArgv(['/usr/bin/worksuite', '--hidden', '/home/a/Report.PDF', 'relative.pdf', '/home/a/image.png', 'worksuite://pdf'])).toEqual(['/home/a/Report.PDF']);
  });
});

describe('opening (§5, PDF-OPEN-010)', () => {
  it('opens a local PDF in place, in its own engine, and audits without a name or path', async () => {
    const svc = service();
    const [pick] = (await svc.registerLocal([localPdf()])).files;
    const v0 = await svc.open(7, { kind: 'local', handle: pick!.handle });
    expect(v0.state).toBe('opening');
    const v = await readyView(v0.id);
    // Stage D2: a PDF on this computer can be changed and saved in place, so it opens with nothing to save rather than read-only.
    expect(v).toMatchObject({ state: 'ready', name: 'Contract.pdf', pageCount: 3, mode: 'VIEW', saveState: 'saved', source: { kind: 'local', label: 'This computer' } });
    expect(v.edit).toMatchObject({ modes: ['VIEW', 'ANNOTATE', 'EDIT'], canAnnotate: true, canOrganize: true, local: true });
    expect(engines[0]!.opened[0]!.file).toMatchObject({ kind: 'plain', path: join(dir, 'Contract.pdf') });
    expect(v.gates.download).toBe('This file is already on this computer.');
    expect(audit).toEqual([{ action: 'pdf.opened', details: { source: 'local', file_id: null, version: null, pages: 3, mode: 'VIEW' } }]);
    // The background scan's findings reach the window.
    await until(() => lastView(v.id)?.security.structureScanned === true);
    expect(lastView(v.id)!.security).toMatchObject({ javascript: 2, launchActions: 1 });
    expect(emitted.every((e) => e.sender === 7)).toBe(true);
    // Another window cannot use this window's session.
    expect(() => svc.view(8, v.id)).toThrow(/no longer open/);
    await expect(svc.render(8, { session: v.id, page: 0, scale: 1, ticket: 'a' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('asks WorkSuite before fetching a Drive file, keeps the copy sealed, and removes it when the tab closes', async () => {
    const body = makePdf({ pages: 3, text: 'Secret clause on page {n}' });
    gets['/api/pdf/12/status'] = { file: { id: 12, name: 'Tender.pdf', size: body.length, version: 4, updated_at: '' }, lock: { mine: false, holder: { id: 3, name: 'Samali' } }, versions: [{ id: 9, version: 4, size: body.length, note: null, author: 'Hasarinda', created_at: '2026-09-29 10:00:00' }], timeline: [{ action: 'uploaded', description: 'Uploaded', author: 'Hasarinda', at: '2026-09-29 10:00:00' }] };
    responses['/api/files/12/download'] = () => new Response(new Uint8Array(body), { headers: { 'content-length': String(body.length) } });
    const svc = service();
    const v0 = await svc.open(7, { kind: 'drive', fileId: 12 });
    const v = await readyView(v0.id);
    expect(routes.slice(0, 2)).toEqual(['GET /api/pdf/12/status', 'RAW /api/files/12/download']);
    expect(v).toMatchObject({ name: 'Tender.pdf', source: { kind: 'drive', fileId: 12, version: 4 }, lock: { holder: 'Samali', mine: false } });
    const file = engines[0]!.opened[0]!.file;
    expect(file.kind).toBe('sealed');
    const work = readdirSync(storage.work);
    expect(work).toHaveLength(1);
    expect(readFileSync(join(storage.work, work[0]!)).includes(Buffer.from('Secret clause'))).toBe(false);
    expect(svc.details(7, v.id)).toMatchObject({ versions: [{ version: 4, author: 'Hasarinda' }], activity: [{ action: 'uploaded' }] });
    expect(audit[0]).toEqual({ action: 'pdf.opened', details: { source: 'drive', file_id: 12, version: 4, pages: 3, mode: 'VIEW' } });
    await svc.close(7, v.id);
    expect(readdirSync(storage.work)).toEqual([]);
    expect(engines[0]!.closed).toBe(true);
  });

  it('says plainly when a Drive file is gone or not shared, without offering Retry', async () => {
    const svc = service();
    const v0 = await svc.open(7, { kind: 'drive', fileId: 99 });
    const v = await readyView(v0.id);
    expect(v.state).toBe('failed');
    expect(v.error).toMatchObject({ code: 'not_found', retry: false });
    expect(routes).toEqual(['GET /api/pdf/99/status']);
    expect(engines).toHaveLength(0);
  });

  it('opens a file shared to view only through the viewer’s own address, and keeps it inside (no print, no download)', async () => {
    const body = makePdf();
    gets['/api/pdf/5/status'] = { file: { id: 5, name: 'Shared.pdf', size: body.length, version: 1, updated_at: '' }, lock: null };
    responses['/api/files/5/download'] = () => new Response('no', { status: 403 });
    gets['/api/drive/preview/5'] = { url: '/media/abc.DEF-123' };
    responses['/media/abc.DEF-123'] = () => new Response(new Uint8Array(body));
    const v = await readyView((await service().open(7, { kind: 'drive', fileId: 5 })).id);
    expect(v.state).toBe('ready');
    expect(v.gates).toMatchObject({ print: 'This file is shared with you to view only.', download: 'This file is shared with you to view only.' });
  });

  it('refuses a Drive file over the organisation’s size limit before fetching it', async () => {
    policy = { ...policy, maxBytes: 1000 };
    gets['/api/pdf/6/status'] = { file: { id: 6, name: 'Huge.pdf', size: 5000, version: 1, updated_at: '' }, lock: null };
    const v = await readyView((await service().open(7, { kind: 'drive', fileId: 6 })).id);
    expect(v.error).toMatchObject({ code: 'too_large', retry: false });
    expect(routes).toEqual(['GET /api/pdf/6/status']);
  });

  it('opens a mail attachment for preview only', async () => {
    const body = makePdf();
    responses['/api/mail/messages/41/attachments/2'] = () => new Response(new Uint8Array(body));
    const v = await readyView((await service().open(7, { kind: 'mail', uid: '41', ref: '2', folder: 'INBOX', mailbox: null, name: 'Offer.pdf' })).id);
    expect(v).toMatchObject({ state: 'ready', name: 'Offer.pdf', readOnly: expect.stringMatching(/preview only/) });
  });
});

describe('passwords (PDF-OPEN-008, PDF-SEC-013/014)', () => {
  it('asks, counts wrong tries, remembers for the session only when asked, and forgets at sign-out', async () => {
    makeEngine = () => Object.assign(new FakeEngine(), { password: 'open sesame' });
    const svc = service();
    const path = localPdf('Locked.pdf');
    const { files } = await svc.registerLocal([path]);
    const v = await readyView((await svc.open(7, { kind: 'local', handle: files[0]!.handle })).id);
    expect(v).toMatchObject({ state: 'password', password: { attempts: 0, wrong: false } });
    expect((await svc.unlock(7, v.id, 'guess', true)).password).toEqual({ attempts: 1, wrong: true });
    expect((await svc.unlock(7, v.id, 'open sesame', true)).state).toBe('ready');
    // A second tab on the same file opens without asking.
    const again = await readyView((await svc.open(7, { kind: 'local', handle: files[0]!.handle })).id);
    expect(again.state).toBe('ready');
    // Never in a log, an audit entry or an event.
    const all = JSON.stringify([logged, audit, emitted]);
    expect(all).not.toContain('open sesame');
    expect(all).not.toContain('guess');
    await svc.closeAll();
    const { files: f2 } = await svc.registerLocal([path]);
    expect((await readyView((await svc.open(7, { kind: 'local', handle: f2[0]!.handle })).id)).state).toBe('password');
  });
});

describe('rendering (§6.2)', () => {
  it('draws newest requests first, drops those scrolled past, and serves repeats from memory', async () => {
    const svc = service();
    const { files } = await svc.registerLocal([localPdf()]);
    const v = await readyView((await svc.open(7, { kind: 'local', handle: files[0]!.handle })).id);
    const e = engines[0]!;
    e.holdRenders = true;
    const out: string[] = [];
    const req = (page: number, t: string) => svc.render(7, { session: v.id, page, scale: 1, ticket: t }).then(() => out.push(t), (err) => out.push(`${t}:${err.code}`));
    const all = [req(0, 'a'), req(1, 'b'), req(2, 'c'), req(0, 'd'), req(1, 'e')];
    // Two at a time reach the engine; the rest wait, and two of them are no longer wanted.
    await until(() => e.renders.length === 2);
    expect(svc.cancel(7, v.id, ['c', 'd', 'zzz'])).toBe(2);
    while (e.hold.length || e.renders.length < 3) {
      e.hold.shift()?.();
      await new Promise((r) => setTimeout(r, 2));
    }
    e.holdRenders = false;
    e.hold.forEach((r) => r());
    await Promise.all(all);
    expect(out).toContain('c:CANCELLED');
    expect(out).toContain('d:CANCELLED');
    expect(e.renders.map((r) => r.page)).toEqual([0, 1, 1]);
    const n = e.renders.length;
    await svc.render(7, { session: v.id, page: 0, scale: 1, ticket: 'f' });
    expect(e.renders.length).toBe(n);
    await expect(svc.render(7, { session: v.id, page: 9, scale: 1, ticket: 'g' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('keeps thumbnails sealed on disk and serves them again without the engine', async () => {
    const svc = service();
    const { files } = await svc.registerLocal([localPdf()]);
    const v = await readyView((await svc.open(7, { kind: 'local', handle: files[0]!.handle })).id);
    const t = await svc.thumbnail(7, v.id, 1, 'th1');
    expect(t.format).toBe('jpeg');
    expect(Buffer.from(t.data).toString()).toMatch(/^jpeg:/);
    await until(() => readdirSync(storage.cache).length === 1);
    await svc.close(7, v.id);
    const v2 = await readyView((await svc.open(7, { kind: 'local', handle: files[0]!.handle })).id);
    const before = engines[1]!.renders.length;
    const t2 = await svc.thumbnail(7, v2.id, 1, 'th2');
    expect(Buffer.from(t2.data).toString()).toBe(Buffer.from(t.data).toString());
    expect(engines[1]!.renders.length).toBe(before);
    const docDir = readdirSync(storage.cache)[0]!;
    expect(readFileSync(join(storage.cache, docDir, '1.bin')).includes(Buffer.from('jpeg:'))).toBe(false);
    await svc.wipe();
    expect(readdirSync(storage.cache)).toEqual([]);
  });

  it('turns a crashed engine into a failed tab with Retry, and Retry starts a new one', async () => {
    const svc = service();
    const { files } = await svc.registerLocal([localPdf()]);
    const v = await readyView((await svc.open(7, { kind: 'local', handle: files[0]!.handle })).id);
    engines[0]!.onGone!(new EngineError('crashed', 'The PDF engine stopped unexpectedly.'));
    expect(lastView(v.id)).toMatchObject({ state: 'failed', error: { code: 'crashed', retry: true } });
    const report = logged.find((l) => l.m === 'pdf failure');
    expect(report?.d).toMatchObject({ stage: 'worker', code: 'crashed', format: 'PDF 1.7', pages: 3, appVersion: '0.2.56' });
    expect(JSON.stringify(report)).not.toContain('Contract');
    await svc.retry(7, v.id);
    await until(() => lastView(v.id)?.state === 'ready');
    expect(engines).toHaveLength(2);
    expect(svc.recentFailures()).toHaveLength(1);
  });
});

describe('search, links and print', () => {
  async function openDoc() {
    const svc = service();
    const { files } = await svc.registerLocal([localPdf()]);
    const v = await readyView((await svc.open(7, { kind: 'local', handle: files[0]!.handle })).id);
    return { svc, v, e: engines[0]! };
  }

  it('streams search progress to the window that asked, then says it is done', async () => {
    const { svc, v } = await openDoc();
    const { searchId } = await svc.search(7, v.id, 'clause', { matchCase: false, wholeWord: false, regex: false, comments: false, bookmarks: false });
    await until(() => emitted.some((x) => x.channel === 'pdf:search' && (x.payload as PdfSearchProgress).done));
    const p = emitted.filter((x) => x.channel === 'pdf:search').map((x) => x.payload as PdfSearchProgress);
    expect(p.map((x) => [x.searchId === searchId, x.pagesDone, x.done])).toEqual([
      [true, 2, false],
      [true, 3, false],
      [true, 3, true],
    ]);
  });

  it('follows a web link only after the organisation’s rule and a confirmation; never a launch', async () => {
    const { svc, v, e } = await openDoc();
    e.linkMap[0] = [
      { index: 0, rect: [0, 0, 1, 1], kind: 'uri', uri: 'https://example.com/terms' },
      { index: 1, rect: [0, 0, 1, 1], kind: 'launch' },
      { index: 2, rect: [0, 0, 1, 1], kind: 'uri', uri: 'http://plain.example' },
      { index: 3, rect: [0, 0, 1, 1], kind: 'uri', uri: 'javascript:alert(1)' },
    ];
    expect(await svc.followLink(7, v.id, 0, 0)).toEqual({ opened: true, reason: null });
    expect(followed).toEqual([{ url: 'https://example.com/terms', confirm: true }]);
    expect((await svc.followLink(7, v.id, 0, 1)).reason).toMatch(/never does that/);
    expect((await svc.followLink(7, v.id, 0, 2)).reason).toMatch(/https/);
    expect((await svc.followLink(7, v.id, 0, 3)).reason).toMatch(/https/);
    expect(followed).toHaveLength(1);
  });

  it('blocks web links when the organisation does', async () => {
    policy = { ...policy, externalLinks: 'block' };
    const { svc, v, e } = await openDoc();
    e.linkMap[0] = [{ index: 0, rect: [0, 0, 1, 1], kind: 'uri', uri: 'https://example.com' }];
    expect(await svc.followLink(7, v.id, 0, 0)).toEqual({ opened: false, reason: 'Your organization blocks web links in PDFs.' });
    expect(followed).toEqual([]);
  });

  it('prints the chosen pages at print quality and audits the count, not the content (PDF-PRN-001/004)', async () => {
    const { svc, v, e } = await openDoc();
    const r = await svc.print(7, { session: v.id, range: { pages: '2-3' }, fit: 'fit', annotations: false, quality: 'standard' });
    expect(r).toEqual({ printed: true, pages: 2, reason: null });
    expect(printed).toEqual([{ pages: [1, 2] }]);
    expect(e.renders.slice(-2).map((x) => [x.page, x.printing, x.annotations, x.order, Math.round(x.scale * 72)])).toEqual([
      [1, true, false, 'bgra', 150],
      [2, true, false, 'bgra', 150],
    ]);
    expect(audit.at(-1)).toEqual({ action: 'pdf.printed', details: { source: 'local', file_id: null, version: null, pages: 2, outcome: 'printed' } });
    await expect(svc.print(7, { session: v.id, range: { pages: '7' }, fit: 'fit', annotations: true, quality: 'standard' })).rejects.toMatchObject({ code: 'IPC_VALIDATION_FAILED' });
  });

  it('does not print what the PDF’s own settings or the organisation forbid (PDF-PRN-002)', async () => {
    makeEngine = () => Object.assign(new FakeEngine(), { permissions: { print: false, printHighQuality: false, copy: false, modify: false, annotate: false, fillForms: false, assemble: false } });
    const { svc, v } = await openDoc();
    expect(v.gates.print).toBe('This PDF’s own settings do not allow printing.');
    expect(v.gates.copy).toBe('This PDF’s own settings do not allow copying.');
    await expect(svc.print(7, { session: v.id, range: 'all', fit: 'fit', annotations: true, quality: 'standard' })).rejects.toMatchObject({ code: 'POLICY_DENIED' });
    expect(printed).toEqual([]);
  });
});

describe('the organisation’s PDF policy (§21.2), as the service reads it', () => {
  it('refuses local files when the organisation turns them off', async () => {
    policy = { ...policy, allowLocalFiles: false };
    await expect(service().registerLocal([localPdf()])).rejects.toMatchObject({ code: 'POLICY_DENIED' });
  });
});

describe('the IPC contract (PDF-API-001…003)', () => {
  it('refuses unknown fields and anything that looks like a path', () => {
    const open = contract['pdf:open'].input;
    expect(open.safeParse({ source: { kind: 'drive', fileId: 3 } }).success).toBe(true);
    expect(open.safeParse({ source: { kind: 'drive', fileId: 3, path: '/etc/passwd' } }).success).toBe(false);
    expect(open.safeParse({ source: { kind: 'local', handle: '../../etc/passwd' } }).success).toBe(false);
    expect(open.safeParse({ source: { kind: 'local', path: '/home/a/x.pdf' } }).success).toBe(false);
    expect(open.safeParse({ source: { kind: 'drive', fileId: 3 }, extra: 1 }).success).toBe(false);
    const render = contract['pdf:render'].input;
    const session = '0f8fad5b-d9cb-469f-a165-70867728950e';
    expect(render.safeParse({ session, page: 0, scale: 2, ticket: 't1' }).success).toBe(true);
    expect(render.safeParse({ session, page: 0, scale: 2, ticket: 't1', tile: { x: 0, y: 0, w: 99999, h: 10 } }).success).toBe(false);
    expect(render.safeParse({ session: 'x', page: 0, scale: 2, ticket: 't1' }).success).toBe(false);
    expect(contract['pdf:unlock'].input.safeParse({ session, password: 'p', remember: true, save: true }).success).toBe(false);
    expect(contract['pdf:print'].input.safeParse({ session, range: 'all', fit: 'fit', annotations: true, quality: 'standard' }).success).toBe(true);
    expect(contract['pdf:print'].input.safeParse({ session, range: { pages: '1-2' }, fit: 'fit', annotations: true, quality: 'standard', silent: true }).success).toBe(false);
  });
});

import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PdfEditOp, PdfSessionView } from '../../../shared/pdf';
import { DesktopError } from '../../../electron/main/errors';
import { loadPdfium, PdfiumProvider } from '../../../electron/services/pdf/pdfium-provider';
import { PdfLocalFiles } from '../../../electron/services/pdf/local-files';
import { PdfRecovery } from '../../../electron/services/pdf/recovery';
import { DEFAULT_PDF_POLICY, DesktopPdfService, type EngineHandle } from '../../../electron/services/pdf/service';
import { PdfStorage } from '../../../electron/services/pdf/storage';
import { StudioApi } from '../../../electron/services/pdf/studio-api';
import { makePdf } from './pdf-fixture';

/**
 * PDF Studio stage D2 in the main process, end to end: the real engine
 * (PDFium, in this process), the service, and a stand-in for WorkSuite's
 * PDF Studio API that keeps Drive's versions, the lock and uploads the way
 * the server's contract says — so a save is checked down to the bytes Drive
 * would keep.
 */
const require = createRequire(import.meta.url);
let pdfium: Awaited<ReturnType<typeof loadPdfium>>;
beforeAll(async () => {
  pdfium = await loadPdfium(readFileSync(require.resolve('@embedpdf/pdfium/pdfium.wasm')));
});

interface Call {
  method: string;
  path: string;
  body: unknown;
  auth: boolean;
  headers: Record<string, string>;
}

/** WorkSuite's side: one Drive PDF, its versions, the lock and the uploads. */
class FakeStudio {
  versions: Buffer[] = [];
  calls: Call[] = [];
  flags = { open: true, annotate: true, edit: true, organize: true, save_version: true, save_copy: true, download: true, export: true, print: true, copy: true, offline: true, version_history: true, break_lock: false };
  modes: string[] = ['VIEW', 'ANNOTATE', 'EDIT'];
  lockedBy: string | null = null;
  offline = false;
  uploads = new Map<string, { size: number; sha: string; chunks: Map<number, Buffer>; chunk: number }>();
  copies: Array<{ name: string; bytes: Buffer }> = [];
  heartbeatAnswer: Record<string, unknown> = {};

  constructor(first: Buffer) {
    this.versions = [first, first, first];
  }

  get head(): number {
    return this.versions.length;
  }

  private state(mode = 'VIEW') {
    return {
      session_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      status: 'ACTIVE',
      mode,
      available_modes: this.modes,
      base_version: this.head,
      head_version: this.head,
      new_version_available: false,
      permissions: this.flags,
      read_only_reason: this.modes.includes('EDIT') ? null : { code: 'no_edit_permission', message: 'You can view this PDF, but you don’t have permission to change it.' },
      lock: null,
      policy: { autosave_interval_s: 30 },
      next_heartbeat_s: 30,
    };
  }

  private json(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }

  private ok(data: unknown, status = 200) {
    return this.json(status, { status: 'success', data });
  }

  private fail(status: number, code: string, message: string, extra: Record<string, unknown> = {}) {
    return this.json(status, { status: 'error', message, errors: { code, ...extra } });
  }

  async handle(method: string, url: string, init: RequestInit & { auth?: boolean }): Promise<Response> {
    const u = new URL(url);
    const path = u.pathname;
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((v, k) => (headers[k] = v));
    let body: unknown = null;
    if (typeof init.body === 'string') body = JSON.parse(init.body);
    else if (init.body) body = Buffer.from(init.body as Uint8Array);
    this.calls.push({ method, path: path + u.search, body: Buffer.isBuffer(body) ? `<${body.length} bytes>` : body, auth: init.auth !== false, headers });
    if (this.offline && (path.includes('/uploads') || path.endsWith('/save'))) throw new DesktopError('NETWORK_UNREACHABLE', 'WorkSuite cannot be reached.');
    let m: RegExpExecArray | null;
    if (method === 'POST' && path === '/api/files/7/pdf/sessions') {
      return this.ok({ ...this.state(), file: { id: 7, name: 'Contract.pdf', size: this.versions.at(-1)!.length, version: this.head, folder_id: 3 }, content: { url: `pdf/content/tok${this.head}`, version: this.head, expires_at: '' }, timeouts: { heartbeat_interval_s: 30, lock_timeout_s: 900, lock_warning_s: 120 } }, 201);
    }
    if (method === 'GET' && (m = /^\/pdf\/content\/tok(\d+)$/.exec(path))) return new Response(new Uint8Array(this.versions[Number(m[1]) - 1]!), { status: 200, headers: { 'content-length': String(this.versions[Number(m[1]) - 1]!.length) } });
    if (method === 'POST' && path.endsWith('/mode')) {
      const mode = (body as { mode: string }).mode;
      if (mode === 'EDIT' && this.lockedBy) return this.fail(409, 'PDF_FILE_LOCKED', `${this.lockedBy} is editing this PDF.`, { actions: ['open_read_only', 'take_over'], lock: { type: 'EDIT', holder: { id: 2, name: this.lockedBy }, mine: false, same_user: false, via: 'studio', device: null, expires_in_s: 800, warning: false } });
      return this.ok(this.state(mode));
    }
    if (method === 'POST' && path.endsWith('/heartbeat')) return this.ok({ ...this.state('ANNOTATE'), lock_lost: null, downgraded: false, ...this.heartbeatAnswer });
    if (method === 'DELETE' && /\/pdf\/sessions\//.test(path)) return this.ok({});
    if (method === 'POST' && path === '/api/files/7/pdf/uploads') {
      const b = body as { size: number; sha256: string; chunk_size: number };
      const id = `bbbbbbbb-bbbb-4bbb-8bbb-${randomBytes(6).toString('hex')}`;
      this.uploads.set(id, { size: b.size, sha: b.sha256, chunks: new Map(), chunk: b.chunk_size });
      return this.ok({ upload_id: id, chunk_size: b.chunk_size, total_chunks: Math.ceil(b.size / b.chunk_size), received_chunks: [] }, 201);
    }
    if (method === 'PUT' && (m = /\/pdf\/uploads\/([^/]+)\/chunks\/(\d+)$/.exec(path))) {
      const up = this.uploads.get(m[1]!)!;
      const bytes = body as Buffer;
      if (createHash('sha256').update(bytes).digest('hex') !== headers['x-chunk-sha256']) return this.fail(422, 'PDF_UPLOAD_INVALID', 'Damaged.');
      up.chunks.set(Number(m[2]), bytes);
      return this.ok({ chunk_index: Number(m[2]) });
    }
    if (method === 'POST' && path === '/api/files/7/pdf/save') {
      const b = body as { upload_id: string; mode: string; base_version?: number; resolution?: string; name?: string };
      const up = this.uploads.get(b.upload_id);
      if (!up) return this.fail(404, 'PDF_UPLOAD_NOT_FOUND', 'Gone.');
      const whole = Buffer.concat([...up.chunks.entries()].sort((a, c) => a[0] - c[0]).map((e) => e[1]));
      if (createHash('sha256').update(whole).digest('hex') !== up.sha) return this.fail(422, 'PDF_UPLOAD_INVALID', 'Not intact.');
      if (b.mode === 'copy') {
        this.copies.push({ name: b.name ?? 'copy.pdf', bytes: whole });
        return this.ok({ mode: 'copy', changed: true, file: { id: 99, name: b.name, version: 1, size: whole.length }, copy_of: 7 }, 201);
      }
      if (b.base_version !== this.head) {
        return this.fail(409, 'PDF_VERSION_CONFLICT', 'This PDF changed in WorkSuite since your copy was opened.', { base_version: b.base_version, server_version: this.head, saved_by: { id: 2, name: 'Nimal' }, saved_at: '2026-09-30T08:00:00Z', offline: false, actions: ['compare', 'keep_both', 'upload_as_new_version', 'use_cloud'] });
      }
      this.versions.push(whole);
      return this.ok({ mode: 'new_version', changed: true, file: { id: 7, name: 'Contract.pdf', version: this.head, size: whole.length }, version: this.head, previous_version: this.head - 1 }, 201);
    }
    return this.fail(404, `HTTP_404`, 'Not found.');
  }
}

let dir: string;
let studio: FakeStudio;
let emitted: PdfSessionView[];
let audit: Array<{ action: string; details: Record<string, unknown> }>;
let written: Array<{ path: string; bytes: Uint8Array }>;
let masterKey: Buffer | null;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ws-pdf-d2-'));
  studio = new FakeStudio(makePdf({ pages: 3, text: 'Page {n} of the contract, with enough words to drag across.' }));
  emitted = [];
  audit = [];
  written = [];
  masterKey = randomBytes(32);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function service(over: { chooseSavePath?: (s: number, suggested: string) => Promise<string | null> } = {}) {
  const storage = new PdfStorage(join(dir, 'PDF'), () => null);
  const http = {
    get: async <T,>(): Promise<T> => {
      throw new DesktopError('NOT_FOUND', 'Not used.');
    },
    raw: (method: string, url: string, init: RequestInit & { auth?: boolean } = {}) => studio.handle(method, url, init),
    url: (path: string, q?: Record<string, string | number | boolean | null | undefined>) => {
      const u = new URL(path, 'https://ws.example');
      for (const [k, v] of Object.entries(q ?? {})) if (v !== undefined && v !== null) u.searchParams.set(k, String(v));
      return u.toString();
    },
  };
  return new DesktopPdfService({
    storage,
    local: new PdfLocalFiles({ maxBytes: () => 1e9, forbidden: () => [] }),
    http,
    engine: () => new PdfiumProvider(pdfium) as unknown as EngineHandle,
    policy: () => DEFAULT_PDF_POLICY,
    desktop: () => ({ downloads: true, diskCache: false }),
    encode: () => Buffer.alloc(0),
    print: async () => ({ printed: true }),
    openLink: async () => true,
    emit: (_s, channel, payload) => channel === 'pdf:changed' && emitted.push(structuredClone(payload as PdfSessionView)),
    audit: (action, details) => audit.push({ action, details }),
    log: { info: () => undefined, warn: () => undefined, error: () => undefined },
    appVersion: '0.2.58',
    studio: new StudioApi(http),
    recovery: new PdfRecovery(join(dir, 'PDF'), () => masterKey),
    client: 'DESKTOP_WIN',
    device: () => ({ id: 'install-1', name: 'Laptop' }),
    userName: () => 'Hasarinda',
    writeLocal: async (path, bytes) => {
      written.push({ path, bytes });
      writeFileSync(path, bytes);
    },
    chooseSavePath: over.chooseSavePath ?? (async () => join(dir, 'chosen.pdf')),
  });
}

const until = async (fn: () => boolean, ms = 3000) => {
  const t = Date.now();
  while (!fn()) {
    if (Date.now() - t > ms) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
};
const last = (id: string) => [...emitted].reverse().find((v) => v.id === id)!;
async function opened(svc: DesktopPdfService) {
  const v0 = await svc.open(1, { kind: 'drive', fileId: 7 });
  await until(() => last(v0.id)?.state === 'ready' || last(v0.id)?.state === 'failed');
  return last(v0.id);
}

let n = 0;
const square = (page = 0): PdfEditOp => ({ op: 'annot.add', page, annot: { id: `ws-square-${String(++n).padStart(4, '0')}`, kind: 'square', color: [0, 0, 255], opacity: 1, width: 2, rect: [100, 100, 80, 60] } });

/** The annotations in a PDF's bytes, read by a separate engine. */
async function annotationsIn(bytes: Uint8Array, page = 0) {
  const f = join(dir, `check-${++n}.pdf`);
  writeFileSync(f, bytes);
  const e = new PdfiumProvider(pdfium);
  const r = await e.open({ kind: 'plain', path: f, size: bytes.length }, null);
  return { annots: await e.annotations(page), pages: r.pageCount };
}

describe('opening through PDF Studio’s session (PDF-OPEN-010)', () => {
  it('asks WorkSuite first as a desktop client, then fetches the bytes from the session’s address without sign-in', async () => {
    const v = await opened(service());
    expect(v.state).toBe('ready');
    const open = studio.calls[0]!;
    expect(open).toMatchObject({ method: 'POST', path: '/api/files/7/pdf/sessions', body: { mode: 'VIEW', client_type: 'DESKTOP_WIN', device_id: 'install-1', device_name: 'Laptop' } });
    expect(studio.calls[1]).toMatchObject({ method: 'GET', path: '/pdf/content/tok3', auth: false });
    expect(v.source.version).toBe(3);
    expect(v.edit).toMatchObject({ modes: ['VIEW', 'ANNOTATE', 'EDIT'], canAnnotate: true, canOrganize: true, canSaveVersion: true });
    expect(v.saveState).toBe('saved');
  });

  it('offers only viewing when the server allows only that, and says why', async () => {
    studio.modes = ['VIEW'];
    studio.flags = { ...studio.flags, annotate: false, edit: false, organize: false, save_version: false };
    const v = await opened(service());
    expect(v.edit).toMatchObject({ modes: ['VIEW'], canAnnotate: false, canOrganize: false, reason: 'You can view this PDF, but you don’t have permission to change it.' });
    expect(v.saveState).toBe('read-only');
  });
});

describe('changing a PDF', () => {
  it('annotates only in Annotate or Edit, and organises pages only in Edit (with the lock)', async () => {
    const svc = service();
    const v = await opened(svc);
    await expect(svc.edit(1, v.id, square())).rejects.toThrow(/Choose Annotate/);
    await svc.setMode(1, v.id, 'ANNOTATE');
    await svc.edit(1, v.id, square());
    await expect(svc.edit(1, v.id, { op: 'page.rotate', pages: [0], by: 90 })).rejects.toThrow(/Choose Edit/);
    await svc.setMode(1, v.id, 'EDIT');
    expect(studio.calls.find((c) => c.path.endsWith('/mode') && (c.body as { mode: string }).mode === 'EDIT')!.body).toMatchObject({ lock_type: 'STRUCTURAL_EDIT' });
    const after = await svc.edit(1, v.id, { op: 'page.rotate', pages: [0], by: 90 });
    expect(after.pages[0]).toEqual([792, 612]);
    expect(after.saveState).toBe('unsaved');
    expect(after.edit.summary).toMatchObject({ annotations_added: 1, pages_rotated: 1 });
  });

  it('says who holds the lock, and offers taking it over only when the server does', async () => {
    studio.lockedBy = 'Nimal';
    const svc = service();
    const v = await opened(svc);
    await expect(svc.setMode(1, v.id, 'EDIT')).rejects.toMatchObject({ code: 'FILE_LOCKED', message: 'Nimal is editing this PDF.' });
    expect(last(v.id).edit).toMatchObject({ mayTakeOver: true, message: 'Nimal is editing this PDF.', lock: { holder: 'Nimal', mine: false } });
  });

  it('undoes by replaying the rest onto the version opened, and redoes', async () => {
    const svc = service();
    const v = await opened(svc);
    await svc.setMode(1, v.id, 'EDIT');
    await svc.edit(1, v.id, square());
    await svc.edit(1, v.id, square());
    await svc.edit(1, v.id, { op: 'page.delete', pages: [2] });
    expect((await svc.annotations(1, v.id, 0)).length).toBe(2);
    let now = await svc.undo(1, v.id);
    expect(now.pageCount).toBe(3);
    now = await svc.undo(1, v.id);
    expect((await svc.annotations(1, v.id, 0)).length).toBe(1);
    expect(now.edit).toMatchObject({ undo: 1, redo: 2, summary: { annotations_added: 1 } });
    now = await svc.redoOp(1, v.id);
    expect((await svc.annotations(1, v.id, 0)).length).toBe(2);
    expect(now.edit).toMatchObject({ undo: 2, redo: 1 });
    // A new change after undoing: what could be redone is gone.
    now = await svc.edit(1, v.id, { op: 'page.rotate', pages: [1], by: 180 });
    expect(now.edit.redo).toBe(0);
  });

  it('gives each annotation its author and a WorkSuite id', async () => {
    const svc = service();
    const v = await opened(svc);
    await svc.setMode(1, v.id, 'ANNOTATE');
    await svc.edit(1, v.id, square());
    const [a] = await svc.annotations(1, v.id, 0);
    expect(a).toMatchObject({ kind: 'square', author: 'Hasarinda', editable: true });
    expect(a!.id).toMatch(/^ws-square-/);
  });
});

describe('saving (§16.1, §17.2)', () => {
  it('uploads in checked chunks and commits a version on the version it was made from', async () => {
    const svc = service();
    const v = await opened(svc);
    await svc.setMode(1, v.id, 'EDIT');
    await svc.edit(1, v.id, square());
    await svc.edit(1, v.id, { op: 'page.delete', pages: [1] });
    const saved = await svc.save(1, v.id, 'version');
    expect(saved).toMatchObject({ saveState: 'saved', source: { version: 4 }, edit: { undo: 0, redo: 0, lastSaved: { version: 4 } } });
    const save = studio.calls.find((c) => c.path === '/api/files/7/pdf/save')!;
    expect(save.body).toMatchObject({ mode: 'new_version', base_version: 3, session_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', client_type: 'DESKTOP_WIN', summary: { annotations_added: 1, pages_deleted: 1 } });
    // Only the counts that are there.
    expect(Object.keys((save.body as { summary: object }).summary).sort()).toEqual(['annotations_added', 'pages_deleted']);
    expect(studio.calls.some((c) => c.method === 'PUT' && c.headers['x-chunk-sha256']?.length === 64)).toBe(true);
    const inDrive = await annotationsIn(studio.versions[3]!);
    expect(inDrive.pages).toBe(2);
    expect(inDrive.annots).toHaveLength(1);
    // What undo replays onto now is the saved version: nothing to undo, and the document is as saved.
    expect((await svc.annotations(1, v.id, 0)).length).toBe(1);
    expect(audit.find((a) => a.action === 'pdf.saved')!.details).toMatchObject({ source: 'drive', target: 'version', version: 4 });
  });

  it('answers a conflict with the server’s choices: keep both, then save over it after review', async () => {
    const svc = service();
    const v = await opened(svc);
    await svc.setMode(1, v.id, 'ANNOTATE');
    await svc.edit(1, v.id, square());
    studio.versions.push(makePdf({ pages: 1 })); // Nimal saved version 4 meanwhile.
    let now = await svc.save(1, v.id, 'version');
    expect(now.edit.conflict).toMatchObject({ baseVersion: 3, serverVersion: 4, savedBy: 'Nimal' });
    expect(now.saveState).toBe('unsaved');
    const uploadsBefore = studio.calls.filter((c) => c.path === '/api/files/7/pdf/uploads').length;
    now = await svc.resolve(1, v.id, 'keep_both');
    expect(studio.copies).toHaveLength(1);
    expect(studio.copies[0]!.name).toBe('Contract (copy).pdf');
    // The same bytes: the upload WorkSuite already has is used again.
    expect(studio.calls.filter((c) => c.path === '/api/files/7/pdf/uploads').length).toBe(uploadsBefore);
    expect(now.edit.lastSaved).toMatchObject({ copyFileId: 99 });
    studio.versions.push(makePdf({ pages: 1 }));
    now = await svc.save(1, v.id, 'version');
    expect(now.edit.conflict?.serverVersion).toBe(5);
    now = await svc.resolve(1, v.id, 'upload_as_new_version');
    const last = studio.calls.filter((c) => c.path === '/api/files/7/pdf/save').at(-1)!;
    expect(last.body).toMatchObject({ mode: 'new_version', base_version: 5, resolution: 'upload_after_review' });
    expect(now).toMatchObject({ saveState: 'saved', source: { version: 6 } });
  });

  it('keeps the work on this computer when WorkSuite cannot be reached, and saves it when it can', async () => {
    const svc = service();
    const v = await opened(svc);
    await svc.setMode(1, v.id, 'ANNOTATE');
    await svc.edit(1, v.id, square());
    studio.offline = true;
    let now = await svc.save(1, v.id, 'version');
    expect(now).toMatchObject({ saveState: 'saved-locally', edit: { pendingSave: true } });
    const rec = new PdfRecovery(join(dir, 'PDF'), () => masterKey);
    expect(await rec.read('drive:7')).toMatchObject({ pendingSave: true, baseVersion: 3, summary: { annotations_added: 1 } });
    studio.offline = false;
    svc.online();
    await until(() => last(v.id).saveState === 'saved');
    now = last(v.id);
    expect(now.source.version).toBe(4);
    const offlineSave = studio.calls.filter((c) => c.path === '/api/files/7/pdf/save').at(-1)!;
    expect(offlineSave.body).toMatchObject({ offline: true });
    expect(await rec.read('drive:7')).toBeNull();
  });

  it('refuses a version to someone who may not make one', async () => {
    studio.flags = { ...studio.flags, save_version: false };
    const svc = service();
    const v = await opened(svc);
    await expect(svc.save(1, v.id, 'version')).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });
});

describe('recovering unsaved work (PDF-SAVE-020)', () => {
  it('keeps changes when the window closes unsaved, and offers them back when the PDF is opened again', async () => {
    const first = service();
    const v = await opened(first);
    await first.setMode(1, v.id, 'ANNOTATE');
    await first.edit(1, v.id, square());
    await first.edit(1, v.id, square());
    await first.close(1, v.id);
    const again = service();
    const v2 = await opened(again);
    await until(() => last(v2.id).edit.recovered);
    const now = last(v2.id);
    expect(now).toMatchObject({ saveState: 'unsaved', edit: { recovered: true, summary: { annotations_added: 2 } } });
    expect(now.edit.message).toMatch(/kept on this computer/);
    expect((await again.annotations(1, v2.id, 0)).length).toBe(2);
    // Saved from the recovered copy: a version on the version it was made from.
    await again.setMode(1, v2.id, 'ANNOTATE');
    const saved = await again.save(1, v2.id, 'version');
    expect(saved.source.version).toBe(4);
    expect((await annotationsIn(studio.versions[3]!)).annots).toHaveLength(2);
  });

  it('forgets them on "Don’t save", and keeps nothing without a key from the credential store', async () => {
    const svc = service();
    const v = await opened(svc);
    await svc.setMode(1, v.id, 'ANNOTATE');
    await svc.edit(1, v.id, square());
    const now = await svc.discard(1, v.id);
    expect(now).toMatchObject({ saveState: 'saved', edit: { undo: 0 } });
    expect((await svc.annotations(1, v.id, 0)).length).toBe(0);
    await svc.close(1, v.id);
    expect(await new PdfRecovery(join(dir, 'PDF'), () => masterKey).read('drive:7')).toBeNull();

    masterKey = null;
    const noKey = service();
    const v3 = await opened(noKey);
    await noKey.setMode(1, v3.id, 'ANNOTATE');
    await noKey.edit(1, v3.id, square());
    await noKey.close(1, v3.id);
    masterKey = randomBytes(32);
    expect(await new PdfRecovery(join(dir, 'PDF'), () => masterKey).count()).toBe(0);
  });
});

describe('the heartbeat and the lock (§18.1)', () => {
  it('says the lock was lost, who took it, and keeps the work to save as a copy', async () => {
    const svc = service();
    const v = await opened(svc);
    await svc.setMode(1, v.id, 'ANNOTATE');
    await svc.edit(1, v.id, square());
    studio.heartbeatAnswer = { lock_lost: { reason: 'taken_over', by: { id: 2, name: 'Nimal' }, at: null } };
    await (svc as unknown as { beat: (s: unknown) => Promise<void> }).beat((svc as unknown as { sessions: Map<string, unknown> }).sessions.get(v.id));
    const now = last(v.id);
    expect(now.edit.lockLost).toEqual({ reason: 'taken_over', by: 'Nimal' });
    expect(now.edit.message).toMatch(/Nimal took over/);
    expect(now.saveState).toBe('unsaved');
    const copy = await svc.save(1, v.id, 'copy');
    expect(copy.edit.lastSaved).toMatchObject({ copyFileId: 99 });
  });
});

describe('a PDF on this computer', () => {
  it('saves in place, and as a new file where the person chooses', async () => {
    const path = join(dir, 'Mine.pdf');
    writeFileSync(path, makePdf({ pages: 2 }));
    const svc = service();
    const { files } = await svc.registerLocal([path]);
    const v0 = await svc.open(1, { kind: 'local', handle: files[0]!.handle });
    await until(() => last(v0.id)?.state === 'ready');
    await svc.setMode(1, v0.id, 'EDIT');
    await svc.edit(1, v0.id, square());
    await svc.edit(1, v0.id, { op: 'page.insertBlank', at: 2, size: [612, 792] });
    const saved = await svc.save(1, v0.id, 'version');
    expect(saved.saveState).toBe('saved');
    expect(written.at(-1)!.path).toBe(path);
    expect((await annotationsIn(readFileSync(path))).pages).toBe(3);
    await svc.edit(1, v0.id, square());
    const asCopy = await svc.save(1, v0.id, 'copy');
    expect(written.at(-1)!.path).toBe(join(dir, 'chosen.pdf'));
    expect(asCopy.saveState).toBe('unsaved');
    expect((await annotationsIn(readFileSync(join(dir, 'chosen.pdf')))).annots).toHaveLength(2);
  });

  it('extracts pages to a new file, leaving the document as it was', async () => {
    const svc = service();
    const v = await opened(svc);
    const r = await svc.extract(1, v.id, [2, 0]);
    expect(r).toEqual({ saved: true, name: 'chosen.pdf' });
    expect((await annotationsIn(readFileSync(join(dir, 'chosen.pdf')))).pages).toBe(2);
    expect(last(v.id).pageCount).toBe(3);
  });
});

import { randomUUID } from 'node:crypto';
import {
  MAX_PDF_BYTES,
  MAX_RENDER_PIXELS,
  PRINT_MAX_PAGES,
  emptySecurity,
  parsePageRange,
  type Gate,
  type PdfAttachmentView,
  type PdfBitmap,
  type PdfDriveDetails,
  type PdfEngineCapabilities,
  type PdfFailureReport,
  type PdfLinkView,
  type PdfLocalPick,
  type PdfOutlineNode,
  type PdfPrintRequest,
  type PdfSearchOptions,
  type PdfSearchProgress,
  type PdfSecurityReport,
  type PdfSessionView,
  type PdfSource,
} from '@shared/pdf';
import { DesktopError, isDesktopError } from '../../main/errors';
import { SealWriter } from '../elearning-offline';
import { EngineError, ENGINE_MESSAGES, isEngineError, type CancelToken, type EngineFile, type PDFEngine } from './engine';
import type { PdfLocalFiles } from './local-files';
import type { PrintJob, PrintOutcome } from './print';
import { PdfStorage } from './storage';

/**
 * DesktopPDFService (§3.3): PDF Studio's half in the main process.
 *
 * It owns the sessions (one per open tab), fetches what a session shows —
 * a Drive file after WorkSuite said this person may open it (PDF-OPEN-010),
 * a local file through PDFLocalFileBridge, a mail attachment — seals working
 * copies, starts one engine worker per document, queues and caches renders,
 * streams searches, follows links only on the person's say-so and the
 * organisation's rule, prints through PDFPrintBridge, and writes audit
 * entries. Every call names a session the calling window opened; another
 * window's session is not found (PDF-API-002).
 *
 * Read-only in this version (stage D1): the session mode is VIEW. Edit
 * sessions, locks, saving and offline editing arrive in stage D2 on the
 * server's CorePDFService contract; see docs/ARCHITECTURE.md for the seams.
 */

/**
 * The organisation's PDF Studio policy (§21.2). The server's policies arrive
 * with its CorePDFService (stage S) and are wired in stage D2; until then
 * every check reads these defaults through `deps.policy()`.
 */
export interface PdfPolicy {
  allowPrint: boolean;
  allowCopy: boolean;
  allowExport: boolean;
  externalLinks: 'allow' | 'confirm' | 'block';
  maxBytes: number;
  /** Memory ceiling per open document (PDF-NFR-005). */
  memoryMb: number;
  allowLocalFiles: boolean;
}

export const DEFAULT_PDF_POLICY: PdfPolicy = { allowPrint: true, allowCopy: true, allowExport: true, externalLinks: 'confirm', maxBytes: MAX_PDF_BYTES, memoryMb: 1024, allowLocalFiles: true };

export interface EngineHandle extends PDFEngine {
  /** Told once when its worker is gone (crash, hang, memory). */
  onGone?: (e: EngineError) => void;
  memory?: number;
}

export interface HttpLike {
  get<T>(path: string, opts?: { query?: Record<string, string | number | boolean | null | undefined> }): Promise<T>;
  raw(method: string, url: string, init?: RequestInit & { auth?: boolean; timeoutMs?: number }): Promise<Response>;
  url(path: string, query?: Record<string, string | number | boolean | null | undefined>): string;
}

export interface PdfServiceDeps {
  storage: PdfStorage;
  local: PdfLocalFiles;
  http: HttpLike;
  /** A new engine worker for one document. */
  engine: (memoryMb: number) => EngineHandle;
  policy: () => PdfPolicy;
  /** What this computer allows: downloads (desktop policy and permission), thumbnails kept on disk (offline storage). */
  desktop: () => { downloads: boolean; diskCache: boolean };
  /** BGRA pixels to an image file. */
  encode: (bgra: Uint8Array, width: number, height: number, kind: 'jpeg' | 'png') => Buffer;
  print: (job: PrintJob, sender: number) => Promise<PrintOutcome>;
  /** Opens an https/mailto address in the browser (the app's own rules); `confirm` asks first in a native dialog. */
  openLink: (url: string, confirm: boolean, sender: number) => Promise<boolean>;
  emit: (sender: number, channel: 'pdf:changed' | 'pdf:search', payload: unknown) => void;
  audit: (action: string, details: Record<string, unknown>) => void;
  log: { info: (m: string, d?: Record<string, unknown>) => void; warn: (m: string, d?: Record<string, unknown>) => void; error: (m: string, d?: Record<string, unknown>) => void };
  appVersion: string;
}

interface RenderJob {
  ticket: string;
  priority: number;
  run: () => Promise<PdfBitmap>;
  resolve: (b: PdfBitmap) => void;
  reject: (e: unknown) => void;
}

interface Session {
  id: string;
  sender: number;
  source: PdfSource;
  /** Who this document is, for remembered passwords: a Drive file, a local path, an attachment. */
  identity: string;
  view: PdfSessionView;
  engine: EngineHandle | null;
  file: EngineFile | null;
  workCopy: string | null;
  docKey: string | null;
  queue: RenderJob[];
  busy: number;
  cache: Map<string, PdfBitmap>;
  cacheBytes: number;
  thumbs: Map<number, PdfBitmap>;
  links: Map<number, PdfLinkView[]>;
  outline: PdfOutlineNode[] | null;
  search: { id: string; token: CancelToken } | null;
  scan: CancelToken | null;
  drive: PdfDriveDetails | null;
  viewOnly: boolean;
  closed: boolean;
}

const MAX_SESSIONS = 16;
const CACHE_BYTES = 96 * 1024 * 1024;
const PARALLEL = 2;
const THUMB_WIDTH = 240;

interface DriveStatus {
  file: { id: number; name: string; size: number; version: number; updated_at: string };
  lock: { mine: boolean; holder: { id: number; name: string | null } } | null;
  versions?: Array<{ id: number; version: number; size: number; note: string | null; author: string | null; created_at: string }>;
  timeline?: Array<{ action: string; description: string | null; author: string | null; at: string }>;
}

function cancelled(): DesktopError {
  return new DesktopError('CANCELLED', 'Cancelled.');
}

export class DesktopPdfService {
  private sessions = new Map<string, Session>();
  /** "Remember for this session" (PDF-OPEN-008): in memory only, gone at sign-out or quit. */
  private passwords = new Map<string, string>();
  private failures: PdfFailureReport[] = [];

  constructor(private readonly deps: PdfServiceDeps) {}

  // ── sessions ───────────────────────────────────────────────────────────

  private get(sender: number, id: string): Session {
    const s = this.sessions.get(id);
    // Another window's session is not this caller's to use.
    if (!s || s.sender !== sender || s.closed) throw new DesktopError('NOT_FOUND', 'This PDF is no longer open. Open it again.');
    return s;
  }

  private ready(sender: number, id: string): Session & { engine: EngineHandle } {
    const s = this.get(sender, id);
    if (s.view.state !== 'ready' || !s.engine) throw new DesktopError('CONFLICT', 'The PDF is not open yet.');
    return s as Session & { engine: EngineHandle };
  }

  private publish(s: Session): void {
    if (!s.closed) this.deps.emit(s.sender, 'pdf:changed', s.view);
  }

  view(sender: number, id: string): PdfSessionView {
    return this.get(sender, id).view;
  }

  openCount(): number {
    return this.sessions.size;
  }

  private sourceLabel(src: PdfSource): string {
    return src.kind === 'drive' ? 'WorkSuite Drive' : src.kind === 'local' ? 'This computer' : 'Mail attachment';
  }

  private readOnlyReason(src: PdfSource): string {
    if (src.kind === 'mail') return 'Mail attachments open for preview only; the original stays as it arrived.';
    return 'Viewing only: annotation, page tools and saving arrive in a later update.';
  }

  async open(sender: number, source: PdfSource): Promise<PdfSessionView> {
    if (this.sessions.size >= MAX_SESSIONS) throw new DesktopError('RATE_LIMITED', `Close a PDF to open another: WorkSuite keeps up to ${MAX_SESSIONS} open at once.`);
    if (source.kind === 'local' && !this.deps.policy().allowLocalFiles) throw new DesktopError('POLICY_DENIED', 'Your organization does not allow opening PDFs from this computer in WorkSuite.');
    const id = randomUUID();
    const identity = source.kind === 'drive' ? `drive:${source.fileId}` : source.kind === 'local' ? `local:${source.handle}` : `mail:${source.uid}:${source.ref}`;
    const s: Session = {
      id,
      sender,
      source,
      identity,
      view: {
        id,
        state: 'opening',
        name: source.kind === 'local' ? (this.deps.local.name(source.handle) ?? 'PDF') : source.kind === 'mail' ? source.name : 'PDF',
        source: { kind: source.kind, fileId: source.kind === 'drive' ? source.fileId : null, version: null, label: this.sourceLabel(source) },
        mode: 'VIEW',
        saveState: 'read-only',
        readOnly: this.readOnlyReason(source),
        size: 0,
        pageCount: 0,
        pages: [],
        info: null,
        permissions: null,
        security: emptySecurity(),
        capabilities: null,
        gates: { print: null, download: null, copy: null, externalLinks: null },
        lock: null,
        password: null,
        error: null,
      },
      engine: null,
      file: null,
      workCopy: null,
      docKey: null,
      queue: [],
      busy: 0,
      cache: new Map(),
      cacheBytes: 0,
      thumbs: new Map(),
      links: new Map(),
      outline: null,
      search: null,
      scan: null,
      drive: null,
      viewOnly: false,
      closed: false,
    };
    this.sessions.set(id, s);
    void this.load(s);
    return s.view;
  }

  /** Fetches the file (if it is not already here), starts the engine and opens the document. */
  private async load(s: Session): Promise<void> {
    try {
      if (!s.file) s.file = await this.fetch(s);
      if (s.closed) return;
      await this.start(s, this.passwords.get(s.identity) ?? null);
    } catch (e) {
      this.fail(s, e, 'open');
    }
  }

  private async fetch(s: Session): Promise<EngineFile> {
    const src = s.source;
    const policy = this.deps.policy();
    if (src.kind === 'local') {
      const f = await this.deps.local.resolve(src.handle);
      s.view.name = f.name;
      s.view.size = f.size;
      s.identity = `local:${f.path}`;
      s.docKey = PdfStorage.docKey(`local:${f.path}:${f.size}:${f.mtimeMs}`);
      return { kind: 'plain', path: f.path, size: f.size };
    }
    if (src.kind === 'drive') {
      // WorkSuite first: may this person open it (PDF-OPEN-010)? Nothing of the file is fetched before it says yes.
      const st = await this.deps.http.get<DriveStatus>(`/api/pdf/${src.fileId}/status`);
      s.view.name = st.file.name;
      s.view.size = st.file.size;
      s.view.source.version = st.file.version;
      s.view.lock = st.lock ? { holder: st.lock.holder.name ?? 'Someone', mine: st.lock.mine } : null;
      s.drive = {
        versions: (st.versions ?? []).map((v) => ({ id: v.id, version: v.version, size: v.size, author: v.author, note: v.note, createdAt: v.created_at })),
        activity: (st.timeline ?? []).map((t) => ({ action: t.action, description: t.description, author: t.author, at: t.at })),
      };
      if (st.file.size > policy.maxBytes) throw new DesktopError('POLICY_DENIED', `This PDF is larger than ${formatLimit(policy.maxBytes)}, the most your organization allows to open.`);
      s.docKey = PdfStorage.docKey(`drive:${src.fileId}:v${st.file.version}`);
      this.publish(s);
      let res = await this.deps.http.raw('GET', this.deps.http.url(`/api/files/${src.fileId}/download`), { headers: { Accept: '*/*' }, timeoutMs: 60 * 60_000 });
      if (res.status === 403) {
        // Shared to view only: the viewer's own signed address, and nothing may leave the app (no download, no print).
        const preview = await this.deps.http.get<{ url?: string | null }>(`/api/drive/preview/${src.fileId}`).catch(() => null);
        const url = preview?.url && /^\/media\/[A-Za-z0-9._~-]+$/.test(preview.url) ? preview.url : null;
        if (!url) throw new DesktopError('PERMISSION_DENIED', 'This file is shared with you in a way that does not let it be opened here.');
        res = await this.deps.http.raw('GET', this.deps.http.url(url), { headers: { Accept: '*/*' }, auth: false, timeoutMs: 60 * 60_000 });
        s.viewOnly = true;
      }
      return this.seal(s, res, policy.maxBytes);
    }
    const q: Record<string, string> = { folder: src.folder, dl: '1', ...(src.mailbox ? { mailbox: src.mailbox } : {}) };
    const res = await this.deps.http.raw('GET', this.deps.http.url(`/api/mail/messages/${src.uid}/attachments/${encodeURIComponent(src.ref)}`, q), { headers: { Accept: '*/*' }, timeoutMs: 30 * 60_000 });
    return this.seal(s, res, policy.maxBytes);
  }

  /** Streams an answer into a sealed working copy (PDF-NFR-020); nothing plain touches the disk. */
  private async seal(s: Session, res: Response, maxBytes: number): Promise<EngineFile> {
    if (res.status === 404) throw new DesktopError('NOT_FOUND', 'That file no longer exists, or it is not shared with you.');
    if (res.status === 403) throw new DesktopError('PERMISSION_DENIED', 'You do not have access to this file.');
    if (!res.ok || !res.body) throw new DesktopError('SERVER_ERROR', `WorkSuite answered ${res.status}.`);
    const declared = Number(res.headers.get('content-length') ?? 0);
    if (declared > maxBytes) throw new DesktopError('POLICY_DENIED', `This PDF is larger than ${formatLimit(maxBytes)}, the most that can be opened.`);
    const { path, key } = await this.deps.storage.newWorkCopy();
    s.workCopy = path;
    const w = await SealWriter.create(path, key);
    let size = 0;
    let complete = false;
    try {
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) {
          await reader.cancel().catch(() => undefined);
          throw new DesktopError('POLICY_DENIED', `This PDF is larger than ${formatLimit(maxBytes)}, the most that can be opened.`);
        }
        if (s.closed) {
          await reader.cancel().catch(() => undefined);
          throw cancelled();
        }
        await w.write(value);
      }
      complete = true;
    } finally {
      await w.close(complete);
    }
    if (declared > 0 && size !== declared) throw new DesktopError('SERVER_ERROR', 'The file arrived incomplete. Try again.');
    s.view.size = size;
    return { kind: 'sealed', path, size, key: key.toString('base64') };
  }

  private async start(s: Session, password: string | null): Promise<void> {
    if (!s.engine) {
      const engine = this.deps.engine(this.deps.policy().memoryMb);
      engine.onGone = (e) => this.gone(s, engine, e);
      s.engine = engine;
    }
    const engine = s.engine;
    try {
      const o = await engine.open(s.file!, password);
      if (s.closed) return;
      const caps = engine.capabilities();
      s.view = {
        ...s.view,
        state: 'ready',
        pageCount: o.pageCount,
        pages: o.pages,
        info: o.info,
        permissions: o.permissions,
        security: o.security,
        capabilities: caps,
        password: null,
        error: null,
      };
      s.view.gates = this.gates(s, caps);
      this.publish(s);
      this.deps.audit('pdf.opened', { source: s.source.kind, file_id: s.view.source.fileId, version: s.view.source.version, pages: o.pageCount, mode: 'VIEW' });
      void this.scan(s);
    } catch (e) {
      if (isEngineError(e) && e.code === 'password') {
        const was = s.view.password;
        s.view.state = 'password';
        s.view.password = { attempts: (was?.attempts ?? 0) + (password === null ? 0 : 1), wrong: password !== null };
        if (password !== null && this.passwords.get(s.identity) === password) this.passwords.delete(s.identity);
        this.publish(s);
        return;
      }
      throw e;
    }
  }

  private gates(s: Session, _caps: PdfEngineCapabilities): PdfSessionView['gates'] {
    const policy = this.deps.policy();
    const desktop = this.deps.desktop();
    const perms = s.view.permissions;
    const viewOnly = s.viewOnly ? 'This file is shared with you to view only.' : null;
    const print: Gate = !policy.allowPrint ? 'Your organization does not allow printing PDFs.' : viewOnly ?? (perms && !perms.print ? 'This PDF’s own settings do not allow printing.' : null);
    const download: Gate =
      s.source.kind === 'local'
        ? 'This file is already on this computer.'
        : !policy.allowExport
          ? 'Your organization does not allow downloading PDFs.'
          : !desktop.downloads
            ? 'Downloads are turned off on this computer.'
            : viewOnly;
    const copy: Gate = !policy.allowCopy ? 'Your organization does not allow copying from PDFs.' : viewOnly ?? (perms && !perms.copy ? 'This PDF’s own settings do not allow copying.' : null);
    const externalLinks: Gate = policy.externalLinks === 'block' ? 'Your organization blocks web links in PDFs.' : null;
    return { print, download, copy, externalLinks };
  }

  /** Walks the pages and the file for active content in the background (§12.5), updating the banner as it goes. */
  private async scan(s: Session): Promise<void> {
    const engine = s.engine;
    if (!engine) return;
    const token: CancelToken = { cancelled: false };
    s.scan = token;
    let last = 0;
    const apply = (r: PdfSecurityReport) => {
      if (s.closed || token.cancelled) return;
      s.view.security = r;
      if (Date.now() - last > 500 || r.structureScanned) {
        last = Date.now();
        this.publish(s);
      }
    };
    try {
      apply(await engine.scan(apply, token));
      const r = s.view.security;
      if (r.javascript || r.launchActions || r.otherActions || r.embeddedFiles) {
        this.deps.log.info('pdf active content blocked', { javascript: r.javascript, launch: r.launchActions, other: r.otherActions, files: r.embeddedFiles });
      }
    } catch {
      /* the scan is advisory; a failing worker is reported by `gone` */
    } finally {
      if (s.scan === token) s.scan = null;
    }
  }

  async unlock(sender: number, id: string, password: string, remember: boolean): Promise<PdfSessionView> {
    const s = this.get(sender, id);
    if (s.view.state !== 'password') return s.view;
    await this.start(s, password).catch((e) => this.fail(s, e, 'open'));
    const now: PdfSessionView = s.view;
    if (now.state === 'ready' && remember) this.passwords.set(s.identity, password);
    return now;
  }

  async retry(sender: number, id: string): Promise<PdfSessionView> {
    const s = this.get(sender, id);
    if (s.view.state !== 'failed' || !s.view.error?.retry) return s.view;
    s.engine = null;
    s.cache.clear();
    s.cacheBytes = 0;
    s.links.clear();
    s.outline = null;
    s.view = { ...s.view, state: 'opening', error: null };
    this.publish(s);
    void this.load(s);
    return s.view;
  }

  private gone(s: Session, engine: EngineHandle, e: EngineError): void {
    if (s.closed || s.engine !== engine) return;
    s.engine = null;
    for (const j of s.queue.splice(0)) j.reject(new DesktopError('CANCELLED', 'The PDF engine stopped.'));
    this.fail(s, e, 'worker');
  }

  private fail(s: Session, e: unknown, stage: PdfFailureReport['stage']): void {
    if (s.closed) return;
    const code = isEngineError(e) ? e.code : isDesktopError(e) ? mapDesktop(e.code) : 'unknown';
    if (isDesktopError(e) && e.code === 'CANCELLED') return;
    const message = isEngineError(e) ? ENGINE_MESSAGES[e.code] : isDesktopError(e) ? e.message : ENGINE_MESSAGES.unknown;
    s.view = { ...s.view, state: 'failed', error: { code, message, retry: !['not_found', 'forbidden', 'too_large', 'format', 'security', 'gone'].includes(code) } };
    this.publish(s);
    this.report(s, stage, code);
    void s.engine?.close().catch(() => undefined);
    s.engine = null;
  }

  /**
   * A failure, reported the way the app reports problems (PDF-NFR-030/031):
   * to the redacted log that the diagnostic report carries, with the file's
   * format, size, page count, the engine's error and the app version —
   * never its name, its content or a password.
   */
  private report(s: Session, stage: PdfFailureReport['stage'], code: string): void {
    const r: PdfFailureReport = {
      at: new Date().toISOString(),
      stage,
      code,
      format: s.view.info?.version ? `PDF ${s.view.info.version}` : 'PDF',
      size: s.view.size,
      pages: s.view.pageCount,
      engine: s.view.capabilities?.version ?? 'PDFium',
      appVersion: this.deps.appVersion,
    };
    this.failures = [r, ...this.failures].slice(0, 20);
    this.deps.log.error('pdf failure', { ...r });
  }

  recentFailures(): PdfFailureReport[] {
    return [...this.failures];
  }

  async close(sender: number, id: string): Promise<void> {
    const s = this.sessions.get(id);
    if (!s || s.sender !== sender) return;
    await this.dispose(s);
  }

  private async dispose(s: Session): Promise<void> {
    s.closed = true;
    this.sessions.delete(s.id);
    if (s.search) s.search.token.cancelled = true;
    if (s.scan) s.scan.cancelled = true;
    for (const j of s.queue.splice(0)) j.reject(cancelled());
    const engine = s.engine;
    s.engine = null;
    await engine?.close().catch(() => undefined);
    if (s.workCopy) await this.deps.storage.removeWorkCopy(s.workCopy);
    s.cache.clear();
    s.thumbs.clear();
  }

  /** A window went away: its documents close with it. */
  async senderGone(sender: number): Promise<void> {
    await Promise.all([...this.sessions.values()].filter((s) => s.sender === sender).map((s) => this.dispose(s)));
  }

  /** Sign-out: every document closes, and remembered passwords and local handles are forgotten. */
  async closeAll(): Promise<void> {
    await Promise.all([...this.sessions.values()].map((s) => this.dispose(s)));
    this.passwords.clear();
    this.deps.local.forget();
  }

  /** A sign-out that removes WorkSuite's data, or a remote wipe (PDF-OFF-005). */
  async wipe(): Promise<void> {
    await this.closeAll();
    await this.deps.storage.wipe();
  }

  // ── rendering (§6.2) ───────────────────────────────────────────────────

  private enqueue(s: Session, ticket: string, priority: number, run: () => Promise<PdfBitmap>): Promise<PdfBitmap> {
    return new Promise<PdfBitmap>((resolve, reject) => {
      s.queue.push({ ticket, priority, run, resolve, reject });
      this.pump(s);
    });
  }

  /** Highest priority first; within it the newest request first — what was scrolled to last is what is on screen. */
  private pump(s: Session): void {
    while (s.busy < PARALLEL && s.queue.length) {
      let best = s.queue.length - 1;
      for (let i = s.queue.length - 1; i >= 0; i--) if (s.queue[i]!.priority > s.queue[best]!.priority) best = i;
      const job = s.queue.splice(best, 1)[0]!;
      s.busy++;
      job
        .run()
        .then(job.resolve, job.reject)
        .finally(() => {
          s.busy--;
          if (!s.closed) this.pump(s);
        });
    }
  }

  /** Renders still waiting are dropped (PDF-VIEW-014): the renderer scrolled past them. */
  cancel(sender: number, id: string, tickets: string[]): number {
    const s = this.sessions.get(id);
    if (!s || s.sender !== sender) return 0;
    const drop = new Set(tickets);
    const keep: RenderJob[] = [];
    let n = 0;
    for (const j of s.queue) {
      if (drop.has(j.ticket)) {
        j.reject(cancelled());
        n++;
      } else keep.push(j);
    }
    s.queue = keep;
    return n;
  }

  private remember(s: Session, key: string, b: PdfBitmap): void {
    const size = b.data.byteLength;
    if (size > CACHE_BYTES / 4) return;
    s.cache.set(key, b);
    s.cacheBytes += size;
    for (const [k, v] of s.cache) {
      if (s.cacheBytes <= CACHE_BYTES) break;
      s.cache.delete(k);
      s.cacheBytes -= v.data.byteLength;
    }
  }

  async render(sender: number, req: { session: string; page: number; scale: number; tile?: { x: number; y: number; w: number; h: number }; ticket: string }): Promise<PdfBitmap> {
    const s = this.ready(sender, req.session);
    if (req.page < 0 || req.page >= s.view.pageCount) throw new DesktopError('NOT_FOUND', 'That page is not in this PDF.');
    const [w, h] = s.view.pages[req.page]!;
    const tile = req.tile;
    const px = tile ? tile.w * tile.h : Math.round(w * req.scale) * Math.round(h * req.scale);
    if (px > MAX_RENDER_PIXELS) throw new DesktopError('IPC_VALIDATION_FAILED', 'Too large to draw at once; ask for tiles.');
    const key = `${req.page}|${req.scale.toFixed(4)}|${tile ? `${tile.x},${tile.y},${tile.w},${tile.h}` : 'page'}`;
    const hit = s.cache.get(key);
    if (hit) {
      s.cache.delete(key);
      s.cache.set(key, hit);
      return hit;
    }
    const b = await this.enqueue(s, req.ticket, 2, async () => {
      const engine = s.engine;
      if (!engine || s.closed) throw cancelled();
      const px2 = await engine.render({ page: req.page, scale: req.scale, ...(tile ? { tile } : {}), annotations: true, order: 'rgba' });
      return { page: req.page, width: px2.width, height: px2.height, format: 'rgba' as const, data: px2.data };
    }).catch((e) => {
      throw this.asDesktop(e);
    });
    this.remember(s, key, b);
    return b;
  }

  /** A page's thumbnail (PDF-VIEW-013): memory, then the sealed disk cache, then drawn by the worker. */
  async thumbnail(sender: number, id: string, page: number, ticket: string): Promise<PdfBitmap> {
    const s = this.ready(sender, id);
    if (page < 0 || page >= s.view.pageCount) throw new DesktopError('NOT_FOUND', 'That page is not in this PDF.');
    const mem = s.thumbs.get(page);
    if (mem) return mem;
    const disk = this.deps.desktop().diskCache && s.docKey ? s.docKey : null;
    if (disk) {
      const img = await this.deps.storage.readThumb(disk, page);
      if (img) {
        const b: PdfBitmap = { page, width: 0, height: 0, format: 'jpeg', data: new Uint8Array(img) };
        s.thumbs.set(page, b);
        return b;
      }
    }
    const [w] = s.view.pages[page]!;
    const b = await this.enqueue(s, ticket, 1, async () => {
      const engine = s.engine;
      if (!engine || s.closed) throw cancelled();
      const px = await engine.render({ page, scale: THUMB_WIDTH / Math.max(1, w), annotations: true, order: 'bgra' });
      const jpeg = this.deps.encode(px.data, px.width, px.height, 'jpeg');
      return { page, width: px.width, height: px.height, format: 'jpeg' as const, data: new Uint8Array(jpeg) };
    }).catch((e) => {
      throw this.asDesktop(e);
    });
    s.thumbs.set(page, b);
    if (disk) void this.deps.storage.writeThumb(disk, page, b.data).catch(() => undefined);
    return b;
  }

  private asDesktop(e: unknown): DesktopError {
    if (isDesktopError(e)) return e;
    if (isEngineError(e)) return new DesktopError(e.code === 'cancelled' ? 'CANCELLED' : e.code === 'page' ? 'NOT_FOUND' : 'INTERNAL', e.message);
    return new DesktopError('INTERNAL', ENGINE_MESSAGES.unknown);
  }

  // ── search, outline, links, attachments ────────────────────────────────

  async search(sender: number, id: string, query: string, options: PdfSearchOptions): Promise<{ searchId: string }> {
    const s = this.ready(sender, id);
    if (s.search) s.search.token.cancelled = true;
    const searchId = randomUUID();
    const token: CancelToken = { cancelled: false };
    s.search = { id: searchId, token };
    const engine = s.engine;
    const pageCount = s.view.pageCount;
    const send = (p: Omit<PdfSearchProgress, 'session' | 'searchId' | 'pageCount'>) => {
      if (!s.closed && !token.cancelled) this.deps.emit(sender, 'pdf:search', { session: id, searchId, pageCount, ...p } satisfies PdfSearchProgress);
    };
    let pagesDone = 0;
    let truncated = false;
    void engine
      .search(query, options, (p) => {
        pagesDone = p.pagesDone;
        truncated = truncated || p.truncated;
        send({ hits: p.hits, pagesDone, done: false, truncated, error: null });
      }, token)
      .then(
        () => send({ hits: [], pagesDone: token.cancelled ? pagesDone : pageCount, done: true, truncated, error: null }),
        (e) => send({ hits: [], pagesDone, done: true, truncated, error: isEngineError(e) ? e.message : 'The search stopped.' }),
      )
      .finally(() => {
        if (s.search?.id === searchId) s.search = null;
      });
    return { searchId };
  }

  cancelSearch(sender: number, id: string): void {
    const s = this.sessions.get(id);
    if (s && s.sender === sender && s.search) s.search.token.cancelled = true;
  }

  async outline(sender: number, id: string): Promise<PdfOutlineNode[]> {
    const s = this.ready(sender, id);
    if (!s.outline) {
      try {
        s.outline = await s.engine.outline();
      } catch (e) {
        throw this.asDesktop(e);
      }
    }
    return s.outline;
  }

  async links(sender: number, id: string, page: number): Promise<PdfLinkView[]> {
    const s = this.ready(sender, id);
    if (page < 0 || page >= s.view.pageCount) throw new DesktopError('NOT_FOUND', 'That page is not in this PDF.');
    const known = s.links.get(page);
    if (known) return known;
    try {
      const l = await s.engine.links(page);
      s.links.set(page, l);
      return l;
    } catch (e) {
      throw this.asDesktop(e);
    }
  }

  async attachments(sender: number, id: string): Promise<PdfAttachmentView[]> {
    const s = this.ready(sender, id);
    try {
      return await s.engine.attachments();
    } catch (e) {
      throw this.asDesktop(e);
    }
  }

  /**
   * Follows a link the person clicked (PDF-SEC-031/032). The address is
   * read again from the document here — the renderer only says which link —
   * and only web and mail addresses leave the app, after the organisation's
   * rule and, by default, the person's confirmation. A link that would start
   * a program or open another file is never followed.
   */
  async followLink(sender: number, id: string, page: number, index: number): Promise<{ opened: boolean; reason: string | null }> {
    const s = this.ready(sender, id);
    const link = (await this.links(sender, id, page)).find((l) => l.index === index);
    if (!link) throw new DesktopError('NOT_FOUND', 'That link is not on this page.');
    if (link.kind === 'page') return { opened: false, reason: null };
    if (link.kind !== 'uri' || !link.uri) return { opened: false, reason: 'This link would start another program or open another file. PDF Studio never does that.' };
    if (s.view.gates.externalLinks) return { opened: false, reason: s.view.gates.externalLinks };
    let url: URL;
    try {
      url = new URL(link.uri);
    } catch {
      return { opened: false, reason: 'This link’s address cannot be read.' };
    }
    if (url.protocol !== 'https:' && url.protocol !== 'mailto:') return { opened: false, reason: 'Only secure web (https) and mail links open from a PDF.' };
    const opened = await this.deps.openLink(url.toString(), this.deps.policy().externalLinks === 'confirm', sender);
    return { opened, reason: null };
  }

  details(sender: number, id: string): PdfDriveDetails | null {
    return this.get(sender, id).drive;
  }

  // ── print (§14.4) ──────────────────────────────────────────────────────

  async print(sender: number, req: PdfPrintRequest): Promise<{ printed: boolean; pages: number; reason: string | null }> {
    const s = this.ready(sender, req.session);
    if (s.view.gates.print) throw new DesktopError('POLICY_DENIED', s.view.gates.print);
    const count = s.view.pageCount;
    const pages =
      req.range === 'all'
        ? Array.from({ length: count }, (_, i) => i)
        : 'current' in req.range
          ? req.range.current < count
            ? [req.range.current]
            : null
          : parsePageRange(req.range.pages, count);
    if (!pages?.length) throw new DesktopError('IPC_VALIDATION_FAILED', 'Those pages are not in this PDF.');
    if (pages.length > PRINT_MAX_PAGES) throw new DesktopError('IPC_VALIDATION_FAILED', `Print up to ${PRINT_MAX_PAGES} pages at a time: choose a page range.`);
    const dpi = req.quality === 'high' && s.view.permissions?.printHighQuality !== false ? 300 : 150;
    const job: PrintJob = {
      title: s.view.name,
      fit: req.fit,
      pages: pages.map((index) => ({ index, widthPt: s.view.pages[index]![0], heightPt: s.view.pages[index]![1] })),
      image: async (index) => {
        const engine = s.engine;
        if (!engine) throw new EngineError('crashed', ENGINE_MESSAGES.crashed);
        const [w, h] = s.view.pages[index]!;
        const scale = Math.min(dpi / 72, Math.sqrt(MAX_RENDER_PIXELS / Math.max(1, w * h)));
        const px = await engine.render({ page: index, scale, annotations: req.annotations, printing: true, order: 'bgra' });
        return this.deps.encode(px.data, px.width, px.height, 'png');
      },
    };
    const out = await this.deps.print(job, sender);
    this.deps.audit('pdf.printed', { source: s.source.kind, file_id: s.view.source.fileId, version: s.view.source.version, pages: pages.length, outcome: out.printed ? 'printed' : out.reason });
    if (!out.printed && out.reason === 'failed') this.report(s, 'print', 'print_failed');
    return { printed: out.printed, pages: pages.length, reason: out.printed ? null : out.reason === 'cancelled' ? null : 'The document could not be sent to the printer.' };
  }

  // ── local files ────────────────────────────────────────────────────────

  async registerLocal(paths: string[]): Promise<{ files: PdfLocalPick[]; rejected: Array<{ name: string; reason: string }> }> {
    if (!this.deps.policy().allowLocalFiles) throw new DesktopError('POLICY_DENIED', 'Your organization does not allow opening PDFs from this computer in WorkSuite.');
    return this.deps.local.register(paths);
  }

  /** Memory in use by each open document's engine, for Diagnostics. */
  engines(): Array<{ state: string; pages: number; memory: number }> {
    return [...this.sessions.values()].map((s) => ({ state: s.view.state, pages: s.view.pageCount, memory: s.engine?.memory ?? 0 }));
  }
}

function formatLimit(bytes: number): string {
  return bytes >= 1024 ** 3 ? `${Math.round((bytes / 1024 ** 3) * 10) / 10} GB` : `${Math.round(bytes / 1024 ** 2)} MB`;
}

function mapDesktop(code: string): NonNullable<PdfSessionView['error']>['code'] {
  if (code === 'NOT_FOUND') return 'not_found';
  if (code === 'PERMISSION_DENIED' || code === 'APP_ACCESS_DENIED' || code === 'ORG_ACCESS_DENIED') return 'forbidden';
  if (code === 'POLICY_DENIED') return 'too_large';
  if (code === 'NETWORK_UNREACHABLE') return 'offline';
  if (code === 'RATE_LIMITED') return 'too_many';
  return 'unknown';
}

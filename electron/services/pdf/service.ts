import { createHash, randomUUID } from 'node:crypto';
import {
  MAX_PDF_BYTES,
  emptyEditState,
  opNeeds,
  summarize,
  type PdfAnnotView,
  type PdfEditOp,
  type PdfMode,
  type PdfPageSize,
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
import { EngineError, ENGINE_MESSAGES, isEngineError, type CancelToken, type EngineEditOp, type EngineFile, type PDFEngine, type TextSpan } from './engine';
import type { PdfLocalFiles } from './local-files';
import type { PrintJob, PrintOutcome } from './print';
import { PdfStorage } from './storage';
import type { PdfRecovery, RecoveryMeta } from './recovery';
import { isStudioError, isUnreachable, type StudioApi, type StudioClient, type StudioFlags, type StudioLock, type StudioState } from './studio-api';

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
 * Stage D2 adds editing on the server's CorePDFService: a Drive PDF opens
 * through an edit session (modes, heartbeat, the edit lock), changes are
 * operations the engine applies and the session keeps as a journal (undo
 * and redo replay it), unsaved work is kept sealed on this computer and
 * offered back (PDF-SAVE-020), and a save uploads the PDF in chunks and
 * commits it as a Drive version on the version it was made from — or,
 * when Drive moved on, answers the server's conflict (§17.2). A PDF on this
 * computer saves in place or as a new file; a mail attachment stays a
 * preview.
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
  // ── editing (stage D2) ──
  /** The server's PDF Studio API; absent where there is none (older servers, the unit tests of D1). */
  studio?: StudioApi;
  recovery?: PdfRecovery;
  client?: StudioClient;
  /** This computer, for the server's sessions and locks ("You are editing this PDF on another device (Laptop)"). */
  device?: () => { id: string | null; name: string };
  /** The signed-in person's name: the author of what they add. */
  userName?: () => string;
  /** Writes a PDF to a place on this computer (in place, atomically; or where the person chose). */
  writeLocal?: (path: string, bytes: Uint8Array) => Promise<void>;
  /** Asks where to save a PDF on this computer; null when cancelled. */
  chooseSavePath?: (sender: number, suggested: string) => Promise<string | null>;
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
  // ── editing (stage D2) ──
  /** The server's edit session for a Drive PDF, when it has PDF Studio. */
  server: { sid: string; fileId: number; flags: StudioFlags; baseVersion: number; heartbeatS: number; autosaveS: number } | null;
  /** The file the journal replays onto: the version opened, or the last one saved. */
  base: EngineFile | null;
  /** Kept only while the document is open: undo reopens it. */
  password: string | null;
  ops: EngineEditOp[];
  redo: EngineEditOp[];
  /** Other PDFs whose pages were inserted, sealed beside the working copy for replay. */
  extra: string[];
  /** Replays and saves wait for each other. */
  lock: Promise<unknown>;
  heartbeat: NodeJS.Timeout | null;
  autosave: NodeJS.Timeout | null;
  /** Changes since the last copy kept on this computer. */
  dirtySinceSnapshot: boolean;
  /** A save that is waiting for WorkSuite: how it was asked for. */
  pending: { target: 'version' | 'copy'; note?: string } | null;
  /** An upload WorkSuite has, kept for the conflict's answers (it is valid a day): the same bytes are not sent twice. */
  upload: { id: string; sha: string } | null;
  recoveredFrom: RecoveryMeta | null;
  lastActive: number;
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
    if (src.kind === 'drive' && !this.deps.studio) return 'This WorkSuite server does not offer editing PDFs yet: viewing only.';
    return '';
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
        edit: emptyEditState(),
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
      server: null,
      base: null,
      password: null,
      ops: [],
      redo: [],
      extra: [],
      lock: Promise.resolve(),
      heartbeat: null,
      autosave: null,
      dirtySinceSnapshot: false,
      pending: null,
      upload: null,
      recoveredFrom: null,
      lastActive: Date.now(),
    };
    s.view.edit.local = source.kind === 'local';
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
      const studio = this.deps.studio ? await this.openStudio(s, src.fileId, policy.maxBytes) : null;
      if (studio) return studio;
      // An older WorkSuite (no PDF Studio sessions): viewing only, as in stage D1.
      s.view.readOnly = 'This WorkSuite server does not offer editing PDFs yet: viewing only.';
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
      await this.startEditing(s, password);
      this.publish(s);
      this.deps.audit('pdf.opened', { source: s.source.kind, file_id: s.view.source.fileId, version: s.view.source.version, pages: o.pageCount, mode: s.view.mode });
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
    // A PDF Studio session's flags are the server's decision — company policy, role and share together — and only narrow these.
    const f = s.server?.flags;
    if (f) {
      return {
        print: print ?? (f.print ? null : 'You do not have permission to print this PDF.'),
        download: download ?? (f.download && f.export ? null : 'You do not have permission to download this PDF.'),
        copy: copy ?? (f.copy ? null : 'You do not have permission to copy from this PDF.'),
        externalLinks,
      };
    }
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
    // Unsaved work is kept on this computer first (PDF-SAVE-020): closing a window, signing out or a crash never loses it.
    if ((s.ops.length || s.recoveredFrom) && s.dirtySinceSnapshot) await this.snapshot(s, !!s.pending).catch(() => false);
    s.closed = true;
    this.sessions.delete(s.id);
    if (s.heartbeat) clearTimeout(s.heartbeat);
    if (s.autosave) clearTimeout(s.autosave);
    if (s.search) s.search.token.cancelled = true;
    if (s.scan) s.scan.cancelled = true;
    for (const j of s.queue.splice(0)) j.reject(cancelled());
    const engine = s.engine;
    s.engine = null;
    await engine?.close().catch(() => undefined);
    if (s.server?.sid && this.deps.studio) void this.deps.studio.end(s.server.fileId, s.server.sid).catch(() => undefined);
    if (s.workCopy) await this.deps.storage.removeWorkCopy(s.workCopy);
    for (const f of s.extra) await this.deps.storage.removeWorkCopy(f);
    s.password = null;
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
    await this.deps.recovery?.wipe();
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


  // ── editing (stage D2) ─────────────────────────────────────────────────

  /**
   * A Drive PDF through the server's PDF Studio: an edit session in VIEW
   * (PDF-OPEN-010 — nothing of the file is fetched before WorkSuite says
   * yes), then its bytes from the session's ten-minute address, sealed.
   * Null when the server has no PDF Studio.
   */
  private async openStudio(s: Session, fileId: number, maxBytes: number): Promise<EngineFile | null> {
    const studio = this.deps.studio!;
    const device = this.deps.device?.() ?? { id: null, name: 'This computer' };
    const boot = await studio
      .open(fileId, { mode: 'VIEW', client_type: this.deps.client ?? 'DESKTOP_LINUX', ...(device.id ? { device_id: device.id.slice(0, 100) } : {}), device_name: device.name.slice(0, 100) })
      .catch((e) => {
        throw this.fromStudio(e);
      });
    if (!boot) return null;
    s.view.name = boot.file.name;
    s.view.size = boot.file.size;
    s.view.source.version = boot.content.version;
    const autosave = Number(boot.policy.autosave_interval_s ?? 30);
    s.server = {
      sid: boot.session_id,
      fileId,
      flags: boot.permissions,
      baseVersion: boot.content.version,
      heartbeatS: Math.max(10, boot.timeouts?.heartbeat_interval_s ?? boot.next_heartbeat_s ?? 30),
      autosaveS: Number.isFinite(autosave) && autosave > 0 ? Math.max(10, autosave) : 30,
    };
    this.applyState(s, boot);
    if (boot.file.size > maxBytes) throw new DesktopError('POLICY_DENIED', `This PDF is larger than ${formatLimit(maxBytes)}, the most your organization allows to open.`);
    s.docKey = PdfStorage.docKey(`drive:${fileId}:v${boot.content.version}`);
    this.publish(s);
    const res = await studio.content(boot.content.url, 60 * 60_000);
    if (res.status === 410) throw new DesktopError('SERVER_ERROR', 'The link to this PDF expired before it arrived. Try again.');
    return this.seal(s, res, maxBytes);
  }

  /** A server refusal as the window shows it: the server's sentence, and the kind of failure. */
  private fromStudio(e: unknown): unknown {
    if (!isStudioError(e)) return e;
    if (e.code === 'PDF_FILE_NOT_FOUND') return new DesktopError('NOT_FOUND', e.message);
    if (e.code === 'PDF_PERMISSION_DENIED' || e.code === 'PDF_POLICY_DENIED') return new DesktopError('PERMISSION_DENIED', e.message);
    if (e.code === 'PDF_FILE_TOO_LARGE') return new DesktopError('POLICY_DENIED', e.message);
    if (e.code === 'PDF_UNSUPPORTED_FORMAT') return new DesktopError('NOT_FOUND', e.message);
    return new DesktopError('SERVER_ERROR', e.message);
  }

  /** What the server says about the session now: modes, flags, the lock, a newer version. */
  private applyState(s: Session, st: StudioState): void {
    if (s.server) {
      s.server.flags = st.permissions;
      s.server.heartbeatS = Math.max(10, st.next_heartbeat_s || s.server.heartbeatS);
    }
    const f = st.permissions;
    const e = s.view.edit;
    e.modes = st.available_modes.length ? st.available_modes : ['VIEW'];
    e.canAnnotate = f.annotate && st.available_modes.includes('ANNOTATE');
    e.canOrganize = f.organize && st.available_modes.includes('EDIT');
    e.canSaveVersion = f.save_version;
    e.canSaveCopy = f.save_copy;
    e.reason = st.read_only_reason?.message ?? null;
    e.newVersion = st.new_version_available;
    e.lock = st.lock ? this.lockView(st.lock) : null;
    e.mayTakeOver = f.break_lock;
    s.view.mode = st.mode;
    s.view.lock = st.lock && !st.lock.mine ? { holder: st.lock.holder.name, mine: false } : null;
  }

  private lockView(l: StudioLock): NonNullable<PdfSessionView['edit']['lock']> {
    return { mine: l.mine, holder: l.holder.name, device: l.device?.name ?? l.device?.client ?? null, expiresInS: l.expires_in_s, warning: l.warning };
  }

  /** After a document opened: what editing it offers here, the heartbeat, and any work kept from before. */
  private async startEditing(s: Session, password: string | null): Promise<void> {
    s.base = s.file;
    s.password = password;
    const e = s.view.edit;
    if (s.source.kind === 'local') {
      const perms = s.view.permissions;
      e.modes = ['VIEW', 'ANNOTATE', 'EDIT'];
      e.canAnnotate = perms?.annotate !== false;
      e.canOrganize = perms?.assemble !== false;
      e.canSaveVersion = true;
      e.canSaveCopy = true;
      if (!e.canAnnotate && !e.canOrganize) e.reason = 'This PDF’s own settings do not allow changing it.';
    } else if (s.source.kind === 'mail' || !s.server) {
      e.modes = ['VIEW'];
    }
    s.view.saveState = e.modes.length > 1 ? 'saved' : 'read-only';
    if (s.server) this.scheduleHeartbeat(s);
    await this.offerRecovery(s);
  }

  private identityFor(s: Session): string | null {
    if (s.source.kind === 'drive') return `drive:${s.source.fileId}`;
    if (s.source.kind === 'local') return s.identity;
    return null;
  }

  /** Work kept on this computer for this document: recovered into the session, to save or undo. */
  private async offerRecovery(s: Session): Promise<void> {
    const rec = this.deps.recovery;
    const identity = this.identityFor(s);
    if (!rec || !identity) return;
    const meta = await rec.read(identity);
    if (!meta) return;
    const file = await rec.file(identity);
    if (!file || !s.engine) return;
    try {
      await this.reopenOn(s, file);
    } catch {
      return;
    }
    s.recoveredFrom = meta;
    s.base = file;
    if (s.server && meta.baseVersion !== null) s.server.baseVersion = meta.baseVersion;
    const e = s.view.edit;
    e.recovered = true;
    e.summary = meta.summary;
    e.message = `Unsaved changes from ${new Date(meta.savedAt).toLocaleString()} were kept on this computer and are back.${meta.pendingSave ? ' They were waiting to be saved.' : ''}`;
    s.view.saveState = 'unsaved';
    this.invalidate(s);
    this.publish(s);
    if (meta.pendingSave) s.pending = { target: 'version' };
  }

  /** The engine on another file: the working copy after a save, the kept copy, the base for a replay. */
  private async reopenOn(s: Session, file: EngineFile): Promise<PdfPageSize[]> {
    const engine = s.engine;
    if (!engine) throw new EngineError('crashed', ENGINE_MESSAGES.crashed);
    await engine.unload();
    const o = await engine.open(file, s.password);
    s.view.pages = o.pages;
    s.view.pageCount = o.pageCount;
    return o.pages;
  }

  /** Everything drawn or listed from the old pages goes. */
  private invalidate(s: Session): void {
    s.view.edit.revision++;
    s.cache.clear();
    s.cacheBytes = 0;
    s.thumbs.clear();
    s.links.clear();
    s.outline = null;
    s.docKey = null;
  }

  private serialized<T>(s: Session, run: () => Promise<T>): Promise<T> {
    const next = s.lock.then(run, run);
    s.lock = next.catch(() => undefined);
    return next;
  }

  /** Changes the session's mode (§16): ANNOTATE, EDIT (with the edit lock — or taking it over), or back to VIEW. */
  async setMode(sender: number, id: string, mode: PdfMode, takeover = false): Promise<PdfSessionView> {
    const s = this.ready(sender, id);
    const e = s.view.edit;
    if (!e.modes.includes(mode) && !takeover) throw new DesktopError('PERMISSION_DENIED', e.reason ?? 'That is not possible on this PDF.');
    if (s.server && this.deps.studio) {
      try {
        const st = await this.deps.studio.mode(s.server.fileId, s.server.sid, mode, e.canOrganize || s.server.flags.organize ? 'STRUCTURAL_EDIT' : 'EDIT', takeover);
        this.applyState(s, st);
        e.lockLost = null;
        e.message = null;
      } catch (err) {
        if (isStudioError(err)) {
          const lock = err.details.lock as StudioLock | undefined;
          if (lock) e.lock = this.lockView(lock);
          e.mayTakeOver = err.actions.includes('take_over');
          e.message = err.message;
          this.publish(s);
          throw new DesktopError(err.code === 'PDF_FILE_LOCKED' ? 'FILE_LOCKED' : 'PERMISSION_DENIED', err.message);
        }
        throw err;
      }
    } else {
      s.view.mode = mode;
    }
    this.publish(s);
    return s.view;
  }

  private assertMay(s: Session, op: PdfEditOp): void {
    const e = s.view.edit;
    const need = opNeeds(op);
    if (need === 'annotate' && !(e.canAnnotate && (s.view.mode === 'ANNOTATE' || s.view.mode === 'EDIT'))) {
      throw new DesktopError('PERMISSION_DENIED', e.canAnnotate ? 'Choose Annotate to add comments and markup.' : (e.reason ?? 'You cannot annotate this PDF.'));
    }
    if (need === 'organize' && !(e.canOrganize && s.view.mode === 'EDIT')) {
      throw new DesktopError('PERMISSION_DENIED', e.canOrganize ? 'Choose Edit to organise pages.' : (e.reason ?? 'You cannot change this PDF’s pages.'));
    }
  }

  /** What the engine is given for an operation: the author and time of a new annotation, the file behind inserted pages. */
  private async toEngine(s: Session, op: PdfEditOp): Promise<EngineEditOp> {
    if (op.op === 'annot.add') return { ...op, author: (this.deps.userName?.() ?? '').slice(0, 200), at: new Date().toISOString() };
    if (op.op !== 'page.insertFile') return op;
    const path = this.deps.local.path(op.file);
    if (!path) throw new DesktopError('NOT_FOUND', 'That PDF is no longer available. Choose it again.');
    const f = await this.deps.local.resolve(op.file);
    // A sealed copy beside the working copy: the journal replays from it, whatever becomes of the original.
    const { path: copy, key } = await this.deps.storage.newWorkCopy();
    s.extra.push(copy);
    const { createReadStream } = await import('node:fs');
    const w = await SealWriter.create(copy, key);
    let ok = false;
    try {
      for await (const chunk of createReadStream(f.path)) await w.write(chunk as Buffer);
      ok = true;
    } finally {
      await w.close(ok);
    }
    return { op: 'page.insertFile', at: op.at, ...(op.pages ? { pages: op.pages } : {}), source: { kind: 'sealed', path: copy, size: f.size, key: key.toString('base64') } };
  }

  /** One change: applied, kept in the journal (redo cleared), everything drawn from the old pages dropped. */
  async edit(sender: number, id: string, op: PdfEditOp): Promise<PdfSessionView> {
    const s = this.ready(sender, id);
    this.assertMay(s, op);
    return this.serialized(s, async () => {
      const engineOp = await this.toEngine(s, op);
      try {
        const sizes = await s.engine!.apply(engineOp);
        s.view.pages = sizes;
        s.view.pageCount = sizes.length;
      } catch (e) {
        throw this.asDesktop(e);
      }
      s.ops.push(engineOp);
      s.redo = [];
      this.changed(s, op.op.startsWith('page.'));
      return s.view;
    });
  }

  private changed(s: Session, pagesMoved: boolean): void {
    s.lastActive = Date.now();
    if (pagesMoved) this.invalidate(s);
    else {
      // Annotations change what a page looks like: its renders and thumbnail go, the rest stays.
      s.view.edit.revision++;
      s.cache.clear();
      s.cacheBytes = 0;
      s.thumbs.clear();
      s.docKey = null;
    }
    const e = s.view.edit;
    const base = s.recoveredFrom?.summary;
    const now = summarize(s.ops);
    e.summary = base ? (Object.fromEntries(Object.entries(now).map(([k, v]) => [k, v + (base[k as keyof typeof base] ?? 0)])) as typeof now) : now;
    e.undo = s.ops.length;
    e.redo = s.redo.length;
    e.conflict = null;
    s.view.saveState = s.ops.length || s.recoveredFrom ? 'unsaved' : 'saved';
    s.dirtySinceSnapshot = true;
    this.scheduleSnapshot(s);
    this.publish(s);
  }

  /** Undo: the journal, less its last change, replayed onto the base. */
  async undo(sender: number, id: string): Promise<PdfSessionView> {
    const s = this.ready(sender, id);
    return this.serialized(s, async () => {
      const last = s.ops.pop();
      if (!last) return s.view;
      s.redo.push(last);
      await this.replay(s);
      this.changed(s, true);
      return s.view;
    });
  }

  async redoOp(sender: number, id: string): Promise<PdfSessionView> {
    const s = this.ready(sender, id);
    return this.serialized(s, async () => {
      const next = s.redo.pop();
      if (!next) return s.view;
      const sizes = await s.engine!.apply(next).catch((e) => {
        throw this.asDesktop(e);
      });
      s.ops.push(next);
      s.view.pages = sizes;
      s.view.pageCount = sizes.length;
      this.changed(s, true);
      return s.view;
    });
  }

  private async replay(s: Session): Promise<void> {
    if (!s.base) throw new DesktopError('CONFLICT', 'The PDF is not open yet.');
    let sizes = await this.reopenOn(s, s.base);
    for (const op of s.ops) sizes = await s.engine!.apply(op);
    s.view.pages = sizes;
    s.view.pageCount = sizes.length;
  }

  async annotations(sender: number, id: string, page: number): Promise<PdfAnnotView[]> {
    const s = this.ready(sender, id);
    if (page < 0 || page >= s.view.pageCount) throw new DesktopError('NOT_FOUND', 'That page is not in this PDF.');
    await s.lock;
    return s.engine!.annotations(page).catch((e) => {
      throw this.asDesktop(e);
    });
  }

  async textSpan(sender: number, id: string, page: number, from: [number, number], to: [number, number]): Promise<TextSpan> {
    const s = this.ready(sender, id);
    if (page < 0 || page >= s.view.pageCount) throw new DesktopError('NOT_FOUND', 'That page is not in this PDF.');
    return s.engine.textSpan(page, from, to).catch((e) => {
      throw this.asDesktop(e);
    });
  }

  // ── heartbeat and the lock (§18.1) ─────────────────────────────────────

  private scheduleHeartbeat(s: Session): void {
    if (s.heartbeat) clearTimeout(s.heartbeat);
    if (s.closed || !s.server) return;
    s.heartbeat = setTimeout(() => void this.beat(s), s.server.heartbeatS * 1000);
    s.heartbeat.unref?.();
  }

  /**
   * Every heartbeat asks the server again: the mode (editing may have been
   * taken away), the lock (lost, or two minutes from lapsing), a newer
   * version in Drive. Active while the person has changed something lately,
   * so the lock does not lapse under them.
   */
  private async beat(s: Session): Promise<void> {
    if (s.closed || !s.server || !this.deps.studio) return;
    try {
      const hb = await this.deps.studio.heartbeat(s.server.fileId, s.server.sid, Date.now() - s.lastActive < 5 * 60_000);
      this.applyState(s, hb);
      const e = s.view.edit;
      if (hb.lock_lost) {
        e.lockLost = { reason: hb.lock_lost.reason, by: hb.lock_lost.by?.name ?? null };
        e.message = hb.lock_lost.by ? `${hb.lock_lost.by.name} took over editing this PDF. Your changes are still here: save them as a copy.` : 'Your hold on editing this PDF lapsed. Your changes are still here: save them, or save them as a copy.';
      }
      if (hb.downgraded) e.message = hb.read_only_reason?.message ?? 'Editing this PDF is no longer allowed. Your changes are still here: save them as a copy.';
      if (s.pending) void this.flushPending(s);
      this.publish(s);
    } catch (err) {
      if (isStudioError(err) && (err.status === 410 || err.status === 404)) {
        // The session is over (the file went, access went, or it lapsed): the work stays, and saving opens a new one if it can.
        const e = s.view.edit;
        e.message = err.message;
        if (err.details.session_ended || err.status === 404) s.server = { ...s.server, sid: '' };
        e.modes = ['VIEW'];
        s.view.mode = 'VIEW';
        this.publish(s);
        return;
      }
    } finally {
      if (s.server?.sid) this.scheduleHeartbeat(s);
    }
  }

  // ── keeping work on this computer (PDF-SAVE-020) ───────────────────────

  private scheduleSnapshot(s: Session): void {
    if (s.autosave || !this.deps.recovery?.enabled) return;
    const every = (s.server?.autosaveS ?? 30) * 1000;
    s.autosave = setTimeout(() => {
      s.autosave = null;
      void this.snapshot(s).catch((e) => this.deps.log.warn('pdf work not kept', { error: String((e as Error)?.message ?? e) }));
    }, every);
    s.autosave.unref?.();
  }

  /** The document as it stands, sealed on this computer, with what it is. */
  private async snapshot(s: Session, pendingSave = false): Promise<boolean> {
    const rec = this.deps.recovery;
    const identity = this.identityFor(s);
    if (!rec || !identity || !s.engine || s.closed) return false;
    if (!s.dirtySinceSnapshot && !pendingSave) return true;
    return this.serialized(s, async () => {
      const bytes = await s.engine!.save();
      const localPath = s.source.kind === 'local' ? this.deps.local.path(s.source.handle) : null;
      const meta: RecoveryMeta = {
        identity,
        source: s.source.kind === 'drive' ? { kind: 'drive', fileId: s.source.fileId } : { kind: 'local', path: localPath ?? '' },
        name: s.view.name,
        baseVersion: s.server?.baseVersion ?? null,
        summary: s.view.edit.summary,
        savedAt: new Date().toISOString(),
        pendingSave,
        size: bytes.byteLength,
      };
      const ok = await rec.write(meta, bytes);
      if (ok) s.dirtySinceSnapshot = false;
      return ok;
    });
  }

  /** "Don't save": the changes go, and so does what was kept of them. */
  async discard(sender: number, id: string): Promise<PdfSessionView> {
    const s = this.ready(sender, id);
    return this.serialized(s, async () => {
      const identity = this.identityFor(s);
      if (identity) await this.deps.recovery?.remove(identity);
      s.recoveredFrom = null;
      s.ops = [];
      s.redo = [];
      s.pending = null;
      s.base = s.file;
      await this.replay(s);
      this.changed(s, true);
      const e = s.view.edit;
      e.recovered = false;
      e.message = null;
      e.pendingSave = false;
      s.dirtySinceSnapshot = false;
      s.view.saveState = 'saved';
      this.publish(s);
      return s.view;
    });
  }

  // ── saving (§16.1, §17.2) ──────────────────────────────────────────────

  /**
   * Save: a Drive PDF as a new version on the version it was made from (or
   * a copy beside it); a PDF on this computer in place (or as a new file).
   * When WorkSuite cannot be reached the work is kept here and the save goes
   * when it can (`saved-locally`).
   */
  async save(sender: number, id: string, target: 'version' | 'copy', note?: string): Promise<PdfSessionView> {
    const s = this.ready(sender, id);
    const e = s.view.edit;
    if (target === 'version' && !e.canSaveVersion && !e.lockLost) throw new DesktopError('PERMISSION_DENIED', e.reason ?? 'You cannot save a version of this PDF. Save a copy instead.');
    if (target === 'copy' && !e.canSaveCopy) throw new DesktopError('PERMISSION_DENIED', 'You cannot save a copy of this PDF.');
    if (s.source.kind === 'local') return this.saveLocal(s, sender, target);
    if (s.source.kind !== 'drive' || !s.server || !this.deps.studio) throw new DesktopError('UNSUPPORTED', 'This PDF cannot be saved here.');
    return this.saveDrive(s, target, note);
  }

  private async saveLocal(s: Session, sender: number, target: 'version' | 'copy'): Promise<PdfSessionView> {
    const handle = s.source.kind === 'local' ? s.source.handle : '';
    let path = target === 'version' ? this.deps.local.path(handle) : null;
    if (target === 'copy') path = (await this.deps.chooseSavePath?.(sender, s.view.name.replace(/\.pdf$/i, '') + ' (edited).pdf')) ?? null;
    if (!path) {
      if (target === 'copy') return s.view;
      throw new DesktopError('NOT_FOUND', 'The file is no longer where it was. Save it somewhere else.');
    }
    const write = this.deps.writeLocal;
    if (!write) throw new DesktopError('UNSUPPORTED', 'Saving to this computer is not available.');
    s.view.saveState = 'saving';
    this.publish(s);
    try {
      await this.serialized(s, async () => {
        const bytes = await s.engine!.save();
        // Writing over the file the engine reads: it lets go first (Windows will not replace an open file), and opens the saved one after.
        if (target === 'version') await s.engine!.unload();
        try {
          await write(path!, bytes);
        } catch (e) {
          if (target === 'version') await this.replay(s).catch(() => undefined);
          throw e;
        }
        if (target === 'version') s.file = { kind: 'plain', path: path!, size: bytes.byteLength };
        this.deps.audit('pdf.saved', { source: 'local', target, pages: s.view.pageCount, ...s.view.edit.summary });
      });
    } catch (e) {
      s.view.saveState = 'unsaved';
      this.publish(s);
      throw isDesktopError(e) ? e : new DesktopError('INTERNAL', 'The PDF could not be written to this computer.');
    }
    if (target === 'version') await this.settle(s, { version: null, copyFileId: null });
    else {
      s.view.saveState = s.ops.length ? 'unsaved' : 'saved';
      s.view.edit.message = `Saved a copy as ${path.split(/[\\/]/).pop()}.`;
      this.publish(s);
    }
    return s.view;
  }

  /** After a save that the document now matches: the saved file becomes the base, the journal starts again, the kept copy goes. */
  private async settle(s: Session, made: { version: number | null; copyFileId: number | null }, bytes?: Uint8Array): Promise<void> {
    await this.serialized(s, async () => {
      if (bytes) {
        // The saved PDF, sealed, is what undo replays onto from now on.
        const { path, key } = await this.deps.storage.newWorkCopy();
        const w = await SealWriter.create(path, key);
        let ok = false;
        try {
          await w.write(bytes);
          ok = true;
        } finally {
          await w.close(ok);
        }
        const old = s.workCopy;
        s.workCopy = path;
        s.base = { kind: 'sealed', path, size: bytes.byteLength, key: key.toString('base64') };
        s.file = s.base;
        await this.reopenOn(s, s.base);
        if (old && old !== path) await this.deps.storage.removeWorkCopy(old);
      } else if (s.source.kind === 'local' && s.file) {
        s.base = s.file;
        await this.reopenOn(s, s.base);
      }
      s.ops = [];
      s.redo = [];
      s.recoveredFrom = null;
      s.pending = null;
      s.upload = null;
      s.dirtySinceSnapshot = false;
      const identity = this.identityFor(s);
      if (identity) await this.deps.recovery?.remove(identity);
    });
    this.invalidate(s);
    const e = s.view.edit;
    e.undo = 0;
    e.redo = 0;
    e.summary = summarize([]);
    e.recovered = false;
    e.pendingSave = false;
    e.conflict = null;
    e.lastSaved = { ...made, at: new Date().toISOString() };
    e.message = null;
    s.view.saveState = 'saved';
    if (made.version !== null) s.view.source.version = made.version;
    this.publish(s);
  }

  private async saveDrive(s: Session, target: 'version' | 'copy', note?: string, resolution?: 'upload_after_review'): Promise<PdfSessionView> {
    const server = s.server!;
    const studio = this.deps.studio!;
    const e = s.view.edit;
    s.view.saveState = 'saving';
    e.message = null;
    this.publish(s);
    let bytes: Uint8Array;
    try {
      bytes = await this.serialized(s, () => s.engine!.save());
    } catch (err) {
      s.view.saveState = 'unsaved';
      this.publish(s);
      throw this.asDesktop(err);
    }
    const device = this.deps.device?.();
    try {
      const sha = createHash('sha256').update(bytes).digest('hex');
      const uploadId = s.upload && s.upload.sha === sha ? s.upload.id : await studio.upload(server.fileId, bytes, server.sid || null);
      s.upload = { id: uploadId, sha };
      const saved = await studio.save(server.fileId, {
        upload_id: uploadId,
        mode: target === 'version' ? 'new_version' : 'copy',
        ...(target === 'version' ? { base_version: resolution ? (e.conflict?.serverVersion ?? server.baseVersion) : server.baseVersion } : {}),
        ...(server.sid ? { session_id: server.sid } : {}),
        summary: e.summary,
        client_type: this.deps.client ?? 'DESKTOP_LINUX',
        ...(device?.id ? { device_id: device.id.slice(0, 100) } : {}),
        offline: !!s.pending,
        edited_at: new Date(s.lastActive).toISOString(),
        ...(resolution ? { resolution } : {}),
        ...(target === 'copy' ? { name: `${s.view.name.replace(/\.pdf$/i, '')} (copy).pdf` } : {}),
        ...(note ? { note: note.slice(0, 200) } : {}),
      });
      if (saved.mode === 'new_version') {
        server.baseVersion = saved.version ?? saved.file.version;
        await this.settle(s, { version: server.baseVersion, copyFileId: null }, bytes);
      } else {
        // A copy is another file: this document keeps its changes (still unsaved here) unless it was only a way out of a conflict.
        s.upload = null;
        s.pending = null;
        e.pendingSave = false;
        e.conflict = null;
        e.lastSaved = { version: null, copyFileId: saved.file.id, at: new Date().toISOString() };
        e.message = `Saved as “${saved.file.name}” beside the original in Drive.`;
        s.view.saveState = s.ops.length || s.recoveredFrom ? 'unsaved' : 'saved';
        this.publish(s);
      }
      this.deps.audit('pdf.saved', { source: 'drive', file_id: server.fileId, target, version: saved.version ?? null, ...e.summary });
      return s.view;
    } catch (err) {
      if (isUnreachable(err)) {
        // Kept here; it goes when WorkSuite answers again (PDF-OFF).
        s.pending = { target, ...(note ? { note } : {}) };
        e.pendingSave = true;
        e.message = 'WorkSuite cannot be reached. Your changes are kept on this computer and will be saved when it can be reached.';
        s.view.saveState = 'saved-locally';
        await this.snapshot(s, true).catch(() => false);
        this.publish(s);
        return s.view;
      }
      s.view.saveState = 'unsaved';
      if (isStudioError(err) && err.code === 'PDF_VERSION_CONFLICT') {
        const d = err.details;
        e.conflict = {
          baseVersion: Number(d.base_version ?? server.baseVersion),
          serverVersion: Number(d.server_version ?? 0),
          savedBy: (d.saved_by as { name?: string } | null)?.name ?? null,
          savedAt: typeof d.saved_at === 'string' ? d.saved_at : null,
          offline: d.offline === true,
          message: err.message,
        };
        this.publish(s);
        return s.view;
      }
      if (isStudioError(err) && (err.code === 'PDF_UPLOAD_NOT_FOUND' || err.code === 'PDF_UPLOAD_INVALID')) s.upload = null;
      e.message = isStudioError(err) ? err.message : (err as Error)?.message ?? 'The PDF could not be saved.';
      this.publish(s);
      throw isStudioError(err) ? new DesktopError(err.code === 'PDF_FILE_LOCKED' ? 'FILE_LOCKED' : err.status === 403 ? 'PERMISSION_DENIED' : 'SERVER_ERROR', err.message) : this.asDesktop(err);
    }
  }

  /**
   * The answers to a conflict (§17.2): keep both (a copy beside the
   * original), save over it after reviewing (a version on the newer one),
   * or use WorkSuite's (the changes here go and the newer version opens).
   */
  async resolve(sender: number, id: string, answer: 'keep_both' | 'upload_as_new_version' | 'use_cloud'): Promise<PdfSessionView> {
    const s = this.ready(sender, id);
    const e = s.view.edit;
    if (!e.conflict) return s.view;
    if (answer === 'keep_both') return this.saveDrive(s, 'copy');
    if (answer === 'upload_as_new_version') return this.saveDrive(s, 'version', undefined, 'upload_after_review');
    const identity = this.identityFor(s);
    if (identity) await this.deps.recovery?.remove(identity);
    const sess: Session = s;
    sess.ops = [];
    sess.redo = [];
    sess.recoveredFrom = null;
    sess.upload = null;
    sess.file = null;
    await sess.engine?.close().catch(() => undefined);
    sess.engine = null;
    if (s.server?.sid && this.deps.studio) await this.deps.studio.end(s.server.fileId, s.server.sid).catch(() => undefined);
    if (s.heartbeat) clearTimeout(s.heartbeat);
    s.server = null;
    s.view = { ...s.view, state: 'opening', edit: { ...emptyEditState(), local: false, revision: s.view.edit.revision + 1 }, saveState: 'read-only', mode: 'VIEW', error: null };
    this.invalidate(s);
    this.publish(s);
    void this.load(s);
    return s.view;
  }

  /** WorkSuite answers again: saves that were waiting go. */
  online(): void {
    for (const s of this.sessions.values()) if (s.pending) void this.flushPending(s);
  }

  private async flushPending(s: Session): Promise<void> {
    const p = s.pending;
    if (!p || s.closed || s.view.saveState === 'saving' || s.view.state !== 'ready') return;
    await this.saveDrive(s, p.target, p.note).catch(() => undefined);
  }

  /** These pages as a new PDF on this computer (the document is unchanged). */
  async extract(sender: number, id: string, pages: number[]): Promise<{ saved: boolean; name: string | null }> {
    const s = this.ready(sender, id);
    if (s.view.gates.download && s.source.kind !== 'local') throw new DesktopError('POLICY_DENIED', s.view.gates.download);
    const unique = [...new Set(pages)].filter((p) => p >= 0 && p < s.view.pageCount);
    if (!unique.length) throw new DesktopError('IPC_VALIDATION_FAILED', 'Choose the pages to extract.');
    const path = await this.deps.chooseSavePath?.(sender, `${s.view.name.replace(/\.pdf$/i, '')} (pages).pdf`);
    if (!path) return { saved: false, name: null };
    const bytes = await this.serialized(s, () => s.engine!.extract(unique)).catch((e) => {
      throw this.asDesktop(e);
    });
    await this.deps.writeLocal!(path, bytes);
    this.deps.audit('pdf.exported', { source: s.source.kind, file_id: s.view.source.fileId, pages: unique.length, kind: 'extract' });
    return { saved: true, name: path.split(/[\\/]/).pop() ?? null };
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

import { dialog, ipcMain, session, WebContentsView, type BrowserWindow, type IpcMainEvent, type Rectangle, type Session } from 'electron';
import { randomUUID } from 'node:crypto';
import {
  OFFICE_EDITOR_EVENTS,
  OFFICE_EVENT_MAX_BYTES,
  officeRequestAllowed,
  officeScriptOrigin,
  type OfficeEditorCommand,
  type OfficeEditorEventName,
  type OpenOfficeDocument,
} from '@shared/office';
import { DesktopError } from '../../main/errors';
import { sendTo } from '../../main/events';
import { logger } from '../../main/log';
import { allowFrameOrigin, hardenSession } from '../../security/hardening';
import { hostPage, hostPolicy } from './host-page';

const log = logger('office');

export const HOST_URL = 'app://office/host.html';
const EVENTS = new Set<string>(OFFICE_EDITOR_EVENTS);

export interface OfficeEditorsDeps {
  /** The editor view's preload (out/preload/office-host.js). */
  preload: string;
  /** A development build may use a local Document Server over http. */
  allowHttp: boolean;
  devTools: boolean;
  /** DELETE …/office/session/{id}: the server ends the session (CLOSED, or ORG_SWITCH, OO-DSK-060). */
  endSession(fileId: number, sessionId: string, reason: 'CLOSED' | 'ORG_SWITCH'): Promise<void>;
  /** The organisation the app acts in now. */
  organizationId(): string | null;
  /** Whether WorkSuite is locked now. */
  locked(): boolean;
}

interface Entry {
  win: BrowserWindow;
  view: WebContentsView | null;
  ses: Session | null;
  /** The Document Server the view may load from and frame; fixed for the view's life. */
  origin: string | null;
  /** The view's page has started and takes commands. */
  ready: boolean;
  queue: OfficeEditorCommand[];
  /** The last build asked for, so a view rebuilt after a crash can say which one it lost. */
  build: number;
  bounds: Rectangle | null;
  /** The page asked for the editor to be out of the way (a dialog of its own is open). */
  pageHidden: boolean;
  doc: OpenOfficeDocument;
  /** Closing was confirmed, or needs no confirmation. */
  closing: boolean;
}

/**
 * WorkSuite Office's document windows (OO-DSK): one per file, each with its
 * editor view — see `shared/office.ts` for the shape of it.
 *
 * The view is the part to distrust. It runs in an in-memory session of its
 * own (nothing it stores outlives the window), on its own origin, with
 * `sandbox`, context isolation and no Node; its requests may go to the
 * Document Server that session named and nowhere else; it may not navigate,
 * open windows, download or ask for any permission (the global hardening);
 * and it sees only the signed configuration, never WorkSuite's token.
 */
export class OfficeEditors {
  private readonly entries = new Map<number, Entry>();
  /** Editor view webContents id → its window's entry. */
  private readonly views = new Map<number, Entry>();

  constructor(private readonly deps: OfficeEditorsDeps) {
    ipcMain.on('office-host:event', (e, msg) => this.fromView(e, msg));
    ipcMain.on('office-host:ready', (e) => {
      const entry = this.viewEntry(e);
      if (!entry) return;
      entry.ready = true;
      const queued = entry.queue.splice(0);
      for (const cmd of queued) this.toView(entry, cmd);
    });
  }

  /** The window already showing this file, if any. */
  windowFor(fileId: number): BrowserWindow | null {
    for (const e of this.entries.values()) if (e.doc.fileId === fileId && !e.win.isDestroyed()) return e.win;
    return null;
  }

  /** A document window was opened: follow it until it closes. */
  register(win: BrowserWindow, fileId: number, name: string): void {
    if (this.entries.has(win.id)) return;
    const entry: Entry = {
      win,
      view: null,
      ses: null,
      origin: null,
      ready: false,
      queue: [],
      build: 0,
      bounds: null,
      pageHidden: false,
      closing: false,
      doc: { windowId: win.id, fileId, name, organizationId: this.deps.organizationId(), sessionId: null, dirty: false },
    };
    this.entries.set(win.id, entry);
    const id = win.id;
    win.on('close', (e) => {
      if (entry.closing || !entry.doc.dirty) return;
      // Changes the Document Server has not taken yet go with the window.
      e.preventDefault();
      void dialog
        .showMessageBox(win, {
          type: 'warning',
          buttons: ['Keep editing', 'Close anyway'],
          defaultId: 0,
          cancelId: 0,
          message: `“${entry.doc.name}” has changes that have not reached the Document Server yet.`,
          detail: 'Closing now may lose them. Keep the window open until it says Saved.',
        })
        .then(({ response }) => {
          if (response !== 1 || win.isDestroyed()) return;
          entry.closing = true;
          win.close();
        });
    });
    win.on('resize', () => this.place(entry));
    win.on('closed', () => {
      this.entries.delete(id);
      this.dropView(entry);
      const sid = entry.doc.sessionId;
      if (sid) void this.deps.endSession(fileId, sid, 'CLOSED').catch((e) => log.info('session not ended', { error: String(e) }));
    });
  }

  isDocumentWindow(win: BrowserWindow | null): win is BrowserWindow {
    return !!win && this.entries.has(win.id);
  }

  /** What the page says about its document: the session, whether it has unsaved changes, its name. */
  track(win: BrowserWindow, info: { sessionId: string | null; dirty: boolean; name?: string }): void {
    const entry = this.need(win);
    const previous = entry.doc.sessionId;
    entry.doc = { ...entry.doc, sessionId: info.sessionId, dirty: info.dirty, name: info.name ?? entry.doc.name };
    if (info.name) win.setTitle(`${info.name} — WorkSuite Office`);
    // A session the page moved on from (a new one after the file changed) is ended here, not left to expire.
    if (previous && info.sessionId && previous !== info.sessionId) void this.deps.endSession(entry.doc.fileId, previous, 'CLOSED').catch(() => undefined);
  }

  /** The open documents, for "close documents from … before switching?" (OO-DSK-060). */
  documents(): OpenOfficeDocument[] {
    return [...this.entries.values()].filter((e) => !e.win.isDestroyed()).map((e) => ({ ...e.doc }));
  }

  /**
   * Close document windows — every one, or those opened in another
   * organisation than `keep` — ending each session with `reason` first.
   */
  async closeWhere(reason: 'CLOSED' | 'ORG_SWITCH', keep?: { organizationId: string | null }): Promise<number> {
    const going = [...this.entries.values()].filter((e) => !keep || e.doc.organizationId !== keep.organizationId);
    await Promise.all(
      going.map(async (e) => {
        const sid = e.doc.sessionId;
        e.doc.sessionId = null;
        if (sid) await this.deps.endSession(e.doc.fileId, sid, reason).catch(() => undefined);
        e.closing = true;
        if (!e.win.isDestroyed()) e.win.close();
      }),
    );
    return going.length;
  }

  /** Signed out, revoked, or the session is gone: the windows close; the server ends idle sessions itself. */
  closeAllNow(): void {
    for (const e of this.entries.values()) {
      e.doc.sessionId = null;
      e.closing = true;
      if (!e.win.isDestroyed()) e.win.close();
    }
  }

  /** WorkSuite locked or unlocked: a locked window shows the lock, not the document. */
  lockChanged(): void {
    for (const e of this.entries.values()) this.place(e);
  }

  /* ───────────────────────── the page's requests ───────────────────────── */

  command(win: BrowserWindow, cmd: OfficeEditorCommand): void {
    const entry = this.need(win);
    if (cmd.op === 'load') {
      const origin = officeScriptOrigin(cmd.apiUrl, this.deps.allowHttp);
      if (!origin) throw new DesktopError('POLICY_DENIED', 'The Document Server’s address is not one WorkSuite Desktop can open.');
      entry.build = cmd.build;
      // A view is bound to one Document Server for its life: another one gets a new view.
      if (!entry.view || entry.origin !== origin) this.makeView(entry, origin);
    }
    if (!entry.view) return;
    this.toView(entry, cmd);
  }

  /** Where the editor goes in the window: the page's placeholder, in its CSS pixels. */
  setBounds(win: BrowserWindow, rect: Rectangle | null, hidden: boolean): void {
    const entry = this.need(win);
    entry.bounds = rect;
    entry.pageHidden = hidden;
    this.place(entry);
  }

  /* ───────────────────────── the view ───────────────────────── */

  private makeView(entry: Entry, origin: string): void {
    this.dropView(entry);
    const ses = session.fromPartition(`office-${randomUUID()}`, { cache: false });
    hardenSession(ses);
    ses.webRequest.onBeforeRequest((details, cb) => {
      const ok = officeRequestAllowed(details.url, origin, HOST_URL);
      if (!ok) log.info('office request blocked', { url: details.url.slice(0, 200) });
      cb({ cancel: !ok });
    });
    ses.protocol.handle('app', (req) => {
      if (req.url !== HOST_URL) return new Response('Not found', { status: 404 });
      return new Response(hostPage(), {
        status: 200,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Security-Policy': hostPolicy(origin),
          'X-Content-Type-Options': 'nosniff',
          'Referrer-Policy': 'no-referrer',
          'Cache-Control': 'no-store',
        },
      });
    });
    const view = new WebContentsView({
      webPreferences: {
        preload: this.deps.preload,
        session: ses,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
        webviewTag: false,
        navigateOnDragDrop: false,
        spellcheck: true,
        devTools: this.deps.devTools,
      },
    });
    view.setBackgroundColor('#FFFFFF');
    allowFrameOrigin(view.webContents, origin);
    entry.view = view;
    entry.ses = ses;
    entry.origin = origin;
    entry.ready = false;
    this.views.set(view.webContents.id, entry);
    view.webContents.on('render-process-gone', (_e, details) => {
      log.warn('office editor gone', { reason: details.reason });
      // The page is told as if the script had failed: it offers to open the document again.
      if (!entry.win.isDestroyed()) sendTo(entry.win, 'office:editorEvent', { build: entry.build, type: 'scriptError', data: null });
      this.dropView(entry);
    });
    entry.win.contentView.addChildView(view);
    this.place(entry);
    void view.webContents.loadURL(HOST_URL);
  }

  private dropView(entry: Entry): void {
    const view = entry.view;
    const ses = entry.ses;
    entry.view = null;
    entry.ses = null;
    entry.origin = null;
    entry.ready = false;
    entry.queue = [];
    if (view) {
      this.views.delete(view.webContents.id);
      try {
        if (!entry.win.isDestroyed()) entry.win.contentView.removeChildView(view);
      } catch {
        /* the window went first */
      }
      if (!view.webContents.isDestroyed()) view.webContents.close();
    }
    // In memory already; cleared anyway, so nothing of the document stays for the rest of the run.
    if (ses) void ses.clearStorageData().catch(() => undefined);
  }

  private place(entry: Entry): void {
    const view = entry.view;
    if (!view || entry.win.isDestroyed()) return;
    const b = entry.bounds;
    const show = !!b && b.width > 0 && b.height > 0 && !entry.pageHidden && !this.deps.locked();
    view.setVisible(show);
    if (!show || !b) return;
    const zoom = entry.win.webContents.getZoomFactor() || 1;
    view.setBounds({ x: Math.round(b.x * zoom), y: Math.round(b.y * zoom), width: Math.round(b.width * zoom), height: Math.round(b.height * zoom) });
  }

  private toView(entry: Entry, cmd: OfficeEditorCommand): void {
    const view = entry.view;
    if (!view || view.webContents.isDestroyed()) return;
    if (!entry.ready) {
      entry.queue.push(cmd);
      return;
    }
    view.webContents.send('office-host:command', cmd);
  }

  private viewEntry(e: IpcMainEvent): Entry | null {
    const entry = this.views.get(e.sender.id);
    if (!entry) return null;
    // The view's own page, never a frame inside it.
    if (e.senderFrame?.parent || e.senderFrame?.url !== HOST_URL) return null;
    return entry;
  }

  private fromView(e: IpcMainEvent, msg: unknown): void {
    const entry = this.viewEntry(e);
    if (!entry || !msg || typeof msg !== 'object') return;
    const { build, type, data } = msg as { build?: unknown; type?: unknown; data?: unknown };
    if (typeof build !== 'number' || !Number.isSafeInteger(build) || typeof type !== 'string' || !EVENTS.has(type)) return;
    let size = 0;
    try {
      size = JSON.stringify(data ?? null).length;
    } catch {
      return;
    }
    if (size > OFFICE_EVENT_MAX_BYTES) {
      log.info('office event too large', { type, size });
      return;
    }
    sendTo(entry.win, 'office:editorEvent', { build, type: type as OfficeEditorEventName, data: data ?? null });
  }

  private need(win: BrowserWindow): Entry {
    const entry = this.entries.get(win.id);
    if (!entry) throw new DesktopError('IPC_FORBIDDEN_SENDER', 'This is not a document window.');
    return entry;
  }
}

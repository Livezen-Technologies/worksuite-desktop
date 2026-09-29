import { BrowserWindow, WebContentsView, ipcMain, session as electronSession, type IpcMainEvent, type Rectangle, type Session, type WebContents } from 'electron';
import { randomBytes, randomUUID } from 'node:crypto';
import { documentServerOrigin, parseEditorEvent, type OfficeCommand, type OfficeEditorEventName, type OfficeViewEvent } from '@shared/office';
import { DesktopError } from '../main/errors';
import { logger } from '../main/log';
import { setNavigationRule } from '../security/hardening';
import { OFFICE_HOST, OFFICE_PAGE, OFFICE_SCHEME, menuKeepsShortcut, officeHostCsp, officeNavigationAllowed, officePartition, officeRequestAllowed, type OfficeOrigins } from '../security/office-policy';
import { OFFICE_HOST_HTML, OFFICE_HOST_JS } from './office-host-page';

const log = logger('office');

/** What a tab asks for when it opens its editor (`office:open`). */
export interface OfficeOpenSpec {
  key: string;
  fileId: number;
  sessionId: string;
  organizationId: string | null;
  documentServerUrl: string;
  apiUrl: string;
  config: Record<string, unknown>;
  events: OfficeEditorEventName[];
}

export interface OfficeHostDeps {
  /** The editor bridge (out/preload/office.js). */
  preload: string;
  serverOrigin: () => string | null;
  /** Development builds may load a Document Server on this computer over plain HTTP. */
  allowInsecureLocal: boolean;
  devTools: boolean;
  platform: string;
  /** Best effort, when a document's window or the app goes away without its tab closing it. */
  endSession: (fileId: number, sessionId: string) => void;
  /** The enterprise proxy, as the app's own sessions have it. */
  configureSession?: (ses: Session) => void;
}

interface Live {
  id: string;
  token: string;
  view: WebContentsView;
  owner: WebContents;
  win: BrowserWindow;
  fileId: number;
  sessionId: string;
  partition: string;
  origins: OfficeOrigins;
  hostReady: boolean;
  queue: unknown[];
  /** Events in the last second, for the flood limit. */
  recent: number[];
}

const MAX_EVENT_BYTES = 64 * 1024;
const MAX_EVENTS_PER_SECOND = 60;
const ALLOWED_PERMISSIONS = new Set(['clipboard-sanitized-write', 'fullscreen']);

/**
 * DesktopOfficeDocumentService's native half (SRS §7.1): the editor views.
 *
 * Each open document is a WebContentsView laid over its tab's placeholder
 * in the tab's own window — never a browser window, never `<webview>`
 * (OO-DSK-001, -020). A view lives in its organisation's editor partition
 * and loads `wsoffice://editor/index.html`, which loads the Document
 * Server's `api.js` and the configuration WorkSuite signed. Its navigation
 * and requests are held to the Document Server's origin (OO-DSK-021); the
 * shell's API proxy does not exist there, so no WorkSuite credential can be
 * reached from it. The tab keeps the session (heartbeats, renewal, closing);
 * this keeps the view, its place on screen and the bridge to its page.
 */
export class OfficeEditorHost {
  private lives = new Map<string, Live>();
  private configured = new Set<string>();
  private watchedOwners = new WeakSet<WebContents>();
  private watchedWindows = new WeakSet<BrowserWindow>();
  private installed = false;

  constructor(private readonly deps: OfficeHostDeps) {}

  /** The bridge's listeners: only an editor view's own page is heard. */
  install(): void {
    if (this.installed) return;
    this.installed = true;
    ipcMain.on('office-host:ready', (e) => {
      const l = this.fromPage(e);
      if (!l) return;
      l.hostReady = true;
      for (const cmd of l.queue.splice(0)) this.post(l, cmd);
      this.tell(l, 'hostReady', null);
    });
    ipcMain.on('office-host:failed', (e, reason: unknown) => {
      const l = this.fromPage(e);
      if (!l) return;
      log.warn('office editor script failed', { reason: String(reason).slice(0, 16) });
      this.tell(l, 'scriptFailed', { reason: ['load', 'api', 'init'].includes(String(reason)) ? String(reason) : 'load' });
    });
    ipcMain.on('office-host:event', (e, raw: unknown) => {
      const l = this.fromPage(e);
      if (!l) return;
      const now = Date.now();
      l.recent = l.recent.filter((t) => now - t < 1000);
      if (l.recent.length >= MAX_EVENTS_PER_SECOND) return;
      l.recent.push(now);
      let size = 0;
      try {
        size = JSON.stringify(raw ?? null).length;
      } catch {
        return;
      }
      if (size > MAX_EVENT_BYTES) return;
      const ev = parseEditorEvent(raw);
      if (!ev) {
        log.debug('office editor event dropped', { type: String((raw as { type?: unknown } | null)?.type ?? '').slice(0, 64) });
        return;
      }
      this.tell(l, ev.type, ev.data);
    });
  }

  /** A message is heard only from the main frame of an editor view's own page. */
  private fromPage(e: IpcMainEvent): Live | null {
    const frame = e.senderFrame;
    if (!frame || frame.parent !== null || !frame.url.startsWith(`${OFFICE_SCHEME}://${OFFICE_HOST}/`)) return null;
    for (const l of this.lives.values()) if (l.view.webContents === e.sender) return l;
    return null;
  }

  private tell(l: Live, type: OfficeViewEvent['type'], data: unknown): void {
    if (l.owner.isDestroyed()) return;
    const ev: OfficeViewEvent = { viewId: l.id, type, data };
    l.owner.send('office:event', ev);
  }

  private post(l: Live, cmd: unknown): void {
    if (l.view.webContents.isDestroyed()) return;
    if (!l.hostReady) {
      l.queue.push(cmd);
      return;
    }
    l.view.webContents.send('office-host:command', cmd);
  }

  // ── the editor partition ───────────────────────────────────────────────

  private originsOf(partition: string): OfficeOrigins[] {
    return [...this.lives.values()].filter((l) => l.partition === partition).map((l) => l.origins);
  }

  private sessionFor(partition: string): Session {
    const ses = electronSession.fromPartition(partition);
    if (this.configured.has(partition)) return ses;
    this.configured.add(partition);
    this.deps.configureSession?.(ses);
    // Nothing in the editor asks for a device, a location or a notification; the clipboard is written on a
    // copy, and a slide show goes full screen.
    ses.setPermissionRequestHandler((_wc, permission, callback) => callback(ALLOWED_PERMISSIONS.has(permission)));
    ses.setPermissionCheckHandler((_wc, permission) => ALLOWED_PERMISSIONS.has(permission));
    ses.setDevicePermissionHandler(() => false);
    // The editor's own "Download as" is not how a document leaves WorkSuite: the tab's Download and
    // Export go through Drive's permissions and the download manager (OO-DSK-024).
    ses.on('will-download', (event, _item, wc) => {
      event.preventDefault();
      const l = [...this.lives.values()].find((x) => x.view.webContents === wc);
      if (l) this.tell(l, 'downloadBlocked', null);
    });
    ses.webRequest.onBeforeRequest((details, callback) => {
      const ok = this.originsOf(partition).some((o) => officeRequestAllowed(details.url, o));
      if (!ok) log.warn('office editor request blocked', { url: details.url.slice(0, 160) });
      callback({ cancel: !ok });
    });
    ses.protocol.handle(OFFICE_SCHEME, (request) => this.servePage(request));
    return ses;
  }

  /** `wsoffice://editor/index.html?v=<token>` and its script; nothing else. */
  servePage(request: Request): Response {
    const u = new URL(request.url);
    if (u.host !== OFFICE_HOST || request.method !== 'GET') return new Response('Not found', { status: 404 });
    const common = { 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' };
    if (u.pathname === '/index.html') {
      const l = [...this.lives.values()].find((x) => x.token === u.searchParams.get('v'));
      if (!l) return new Response('Not found', { status: 404 });
      return new Response(OFFICE_HOST_HTML, {
        status: 200,
        headers: { ...common, 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': officeHostCsp(l.origins), 'Referrer-Policy': 'no-referrer' },
      });
    }
    if (u.pathname === '/host.js') return new Response(OFFICE_HOST_JS, { status: 200, headers: { ...common, 'Content-Type': 'text/javascript; charset=utf-8' } });
    return new Response('Not found', { status: 404 });
  }

  // ── views ──────────────────────────────────────────────────────────────

  open(owner: WebContents, spec: OfficeOpenSpec): { viewId: string } {
    const ds = documentServerOrigin(spec.documentServerUrl, spec.apiUrl, { allowInsecureLocal: this.deps.allowInsecureLocal });
    if ('error' in ds) throw new DesktopError('POLICY_DENIED', ds.error);
    const win = BrowserWindow.fromWebContents(owner);
    if (!win || win.isDestroyed()) throw new DesktopError('NOT_FOUND', 'That window has closed.');
    const partition = officePartition(spec.organizationId);
    const origins: OfficeOrigins = { documentServer: ds.origin, worksuite: this.deps.serverOrigin() };
    const id = randomUUID();
    const token = randomBytes(18).toString('base64url');
    // The partition is set up (and its request filter reads the live views) before the view exists.
    const placeholder: Live = { id, token, view: null as unknown as WebContentsView, owner, win, fileId: spec.fileId, sessionId: spec.sessionId, partition, origins, hostReady: false, queue: [], recent: [] };
    this.lives.set(id, placeholder);
    let view: WebContentsView;
    try {
      this.sessionFor(partition);
      view = new WebContentsView({
        webPreferences: {
          partition,
          preload: this.deps.preload,
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          webSecurity: true,
          allowRunningInsecureContent: false,
          webviewTag: false,
          navigateOnDragDrop: false,
          spellcheck: true,
          safeDialogs: true,
          devTools: this.deps.devTools,
        },
      });
    } catch (e) {
      this.lives.delete(id);
      throw e;
    }
    const l = placeholder;
    l.view = view;
    const wc = view.webContents;
    setNavigationRule(wc, (url, mainFrame) => officeNavigationAllowed(url, mainFrame, l.origins));
    // The app menu's shortcuts belong to the editor while it has the keyboard, except closing and opening tabs.
    wc.on('before-input-event', (_e, input) => {
      if (input.type === 'keyDown') wc.setIgnoreMenuShortcuts(!menuKeepsShortcut(input, this.deps.platform));
    });
    wc.on('render-process-gone', (_e, details) => {
      log.error('office editor gone', { reason: details.reason });
      this.tell(l, 'crashed', { reason: details.reason });
      this.destroy(l, false);
    });
    view.setBackgroundColor('#FFFFFF');
    view.setVisible(false);
    win.contentView.addChildView(view);
    this.watch(owner, win);
    this.post(l, { type: 'init', apiUrl: ds.apiUrl, events: spec.events });
    this.post(l, { type: 'start', config: spec.config });
    void wc.loadURL(`${OFFICE_PAGE}?v=${token}`).catch((e: unknown) => log.warn('office editor page did not load', { error: String(e) }));
    log.info('office editor opened', { file: spec.fileId, partition });
    return { viewId: id };
  }

  /** A window or a shell page that goes away takes its editors with it; their sessions are ended for it. */
  private watch(owner: WebContents, win: BrowserWindow): void {
    if (!this.watchedOwners.has(owner)) {
      this.watchedOwners.add(owner);
      const gone = () => this.destroyWhere((l) => l.owner === owner, true);
      owner.once('destroyed', gone);
      // A reload of the shell page (after a crash) leaves no tab to close its editor.
      owner.on('did-navigate', gone);
      owner.on('render-process-gone', gone);
    }
    if (!this.watchedWindows.has(win)) {
      this.watchedWindows.add(win);
      win.once('closed', () => this.destroyWhere((l) => l.win === win, true));
    }
  }

  private mine(owner: WebContents, viewId: string): Live | null {
    const l = this.lives.get(viewId);
    return l && l.owner === owner ? l : null;
  }

  /** Where the tab's placeholder is, in CSS pixels of its page, and whether it shows. */
  place(owner: WebContents, viewId: string, bounds: Rectangle, visible: boolean): boolean {
    const l = this.mine(owner, viewId);
    if (!l || l.view.webContents.isDestroyed()) return false;
    const z = owner.getZoomFactor() || 1;
    const r = { x: Math.round(bounds.x * z), y: Math.round(bounds.y * z), width: Math.max(0, Math.round(bounds.width * z)), height: Math.max(0, Math.round(bounds.height * z)) };
    l.view.setBounds(r);
    l.view.setVisible(visible && r.width > 0 && r.height > 0);
    return true;
  }

  command(owner: WebContents, viewId: string, cmd: OfficeCommand & { events?: OfficeEditorEventName[] }, sessionId?: string): boolean {
    const l = this.mine(owner, viewId);
    if (!l) return false;
    if (sessionId) l.sessionId = sessionId;
    this.post(l, cmd);
    return true;
  }

  close(owner: WebContents, viewId: string): boolean {
    const l = this.mine(owner, viewId);
    if (!l) return false;
    this.destroy(l, false);
    return true;
  }

  /**
   * OO-DSK-004 across windows: a document already open in another window is
   * brought forward there (and its tab told to show itself) instead of a
   * second session being opened.
   */
  focusFile(from: WebContents, fileId: number): boolean {
    const l = [...this.lives.values()].find((x) => x.fileId === fileId && x.owner !== from && !x.owner.isDestroyed());
    if (!l) return false;
    if (!l.win.isDestroyed()) {
      if (l.win.isMinimized()) l.win.restore();
      l.win.show();
      l.win.focus();
    }
    this.tell(l, 'focus', null);
    return true;
  }

  /** Signing out, a wipe, quitting: every editor closes and its storage goes. */
  closeAll(endSessions: boolean): void {
    this.destroyWhere(() => true, endSessions);
  }

  get count(): number {
    return this.lives.size;
  }

  private destroyWhere(test: (l: Live) => boolean, endSessions: boolean): void {
    for (const l of [...this.lives.values()]) if (test(l)) this.destroy(l, endSessions);
  }

  private destroy(l: Live, endSession: boolean): void {
    if (!this.lives.delete(l.id)) return;
    try {
      if (!l.win.isDestroyed()) l.win.contentView.removeChildView(l.view);
    } catch {
      /* the window is on its way out */
    }
    const wc = l.view.webContents;
    if (!wc.isDestroyed()) wc.close();
    if (endSession) this.deps.endSession(l.fileId, l.sessionId);
    // The last document of an organisation takes the partition's cookies, storage and cache with it (OO-DSK-023).
    if (![...this.lives.values()].some((x) => x.partition === l.partition)) {
      const ses = electronSession.fromPartition(l.partition);
      void ses.clearStorageData().catch(() => undefined);
      void ses.clearCache().catch(() => undefined);
    }
    log.info('office editor closed', { file: l.fileId });
  }
}

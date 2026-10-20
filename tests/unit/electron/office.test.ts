import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/*
 * The Office editor's isolation (OO-DSK-020/021/022, AC-21), with Electron
 * faked: the view's preferences, its partition's rules, the bridge that
 * only hears the editor's own page, and the copies opened in other apps.
 */
const fake = vi.hoisted(() => {
  type Handler = (...a: unknown[]) => unknown;
  const ipc = new Map<string, Handler>();
  const sessions = new Map<string, ReturnType<typeof makeSession>>();
  function makeSession(name: string) {
    return {
      name,
      permission: null as null | Handler,
      check: null as null | Handler,
      device: null as null | Handler,
      request: null as null | Handler,
      download: null as null | Handler,
      page: null as null | ((r: Request) => Response),
      cleared: 0,
      proxy: null as unknown,
      setPermissionRequestHandler(fn: Handler) {
        this.permission = fn;
      },
      setPermissionCheckHandler(fn: Handler) {
        this.check = fn;
      },
      setDevicePermissionHandler(fn: Handler) {
        this.device = fn;
      },
      on(ev: string, fn: Handler) {
        if (ev === 'will-download') this.download = fn;
      },
      webRequest: {
        onBeforeRequest(fn: Handler) {
          current().request = fn;
        },
      },
      protocol: {
        handle(_scheme: string, fn: (r: Request) => Response) {
          current().page = fn;
        },
      },
      async clearStorageData() {
        this.cleared++;
      },
      async clearCache() {},
      async setProxy(p: unknown) {
        this.proxy = p;
      },
    };
  }
  let last: ReturnType<typeof makeSession> | null = null;
  const current = () => last!;
  const views: Array<{ prefs: Record<string, unknown>; webContents: ReturnType<typeof makeContents>; bounds: unknown; visible: boolean; background: string | null }> = [];
  function makeContents(id: number) {
    const handlers = new Map<string, Handler[]>();
    return {
      id,
      url: '',
      sent: [] as Array<[string, unknown]>,
      closed: false,
      ignoreMenu: null as boolean | null,
      zoom: 1,
      focused: 0,
      focus() {
        this.focused++;
      },
      mainFrame: { parent: null, url: '' },
      capturePage: async () => ({ isEmpty: () => false, toJPEG: (q: number) => Buffer.from(`jpeg-${q}`) }),
      on(ev: string, fn: Handler) {
        handlers.set(ev, [...(handlers.get(ev) ?? []), fn]);
        return this;
      },
      once(ev: string, fn: Handler) {
        return this.on(ev, fn);
      },
      emit(ev: string, ...a: unknown[]) {
        for (const fn of handlers.get(ev) ?? []) fn(...a);
      },
      send(ch: string, p: unknown) {
        this.sent.push([ch, p]);
      },
      isDestroyed() {
        return this.closed;
      },
      close() {
        this.closed = true;
      },
      async loadURL(u: string) {
        this.url = u;
        this.mainFrame.url = u;
      },
      setIgnoreMenuShortcuts(v: boolean) {
        this.ignoreMenu = v;
      },
      getZoomFactor() {
        return this.zoom;
      },
    };
  }
  let seq = 100;
  class WebContentsView {
    webContents = makeContents(++seq);
    bounds: unknown = null;
    visible = true;
    prefs: Record<string, unknown>;
    constructor(o: { webPreferences: Record<string, unknown> }) {
      this.prefs = o.webPreferences;
      views.push(this as never);
    }
    setBounds(b: unknown) {
      this.bounds = b;
    }
    setVisible(v: boolean) {
      this.visible = v;
    }
    getVisible() {
      return this.visible;
    }
    background: string | null = null;
    setBackgroundColor(c: string) {
      this.background = c;
    }
  }
  const windows = new Map<unknown, { children: unknown[]; closed: Handler[]; focused: number; inUse: boolean; isFocused: () => boolean; contentView: { addChildView: (v: unknown) => void; removeChildView: (v: unknown) => void }; isDestroyed: () => boolean; isMinimized: () => boolean; isFullScreen: () => boolean; setFullScreen: (on: boolean) => void; restore: () => void; show: () => void; focus: () => void; once: (e: string, fn: Handler) => void }>();
  function windowFor(owner: unknown) {
    let w = windows.get(owner);
    if (!w) {
      const children: unknown[] = [];
      const closed: Handler[] = [];
      w = {
        children,
        closed,
        focused: 0,
        inUse: true,
        isFocused() {
          return this.inUse;
        },
        contentView: { addChildView: (v) => children.push(v), removeChildView: (v) => children.splice(children.indexOf(v), 1) },
        isDestroyed: () => false,
        isMinimized: () => false,
        isFullScreen: () => false,
        setFullScreen: () => undefined,
        restore: () => undefined,
        show: () => undefined,
        focus() {
          this.focused++;
        },
        once: (e, fn) => (e === 'closed' ? closed.push(fn) : undefined),
      };
      windows.set(owner, w);
    }
    return w;
  }
  return {
    ipc,
    sessions,
    views,
    windows,
    windowFor,
    makeContents,
    session: {
      fromPartition(name: string) {
        let s = sessions.get(name);
        if (!s) {
          s = makeSession(name);
          sessions.set(name, s);
        }
        last = s;
        return s;
      },
    },
    WebContentsView,
  };
});

vi.mock('electron', () => ({
  app: { getPath: () => tmpdir(), getVersion: () => '0.2.55', isPackaged: false, enableSandbox: () => undefined, on: () => undefined },
  ipcMain: { on: (ch: string, fn: (...a: unknown[]) => unknown) => fake.ipc.set(ch, fn) },
  session: fake.session,
  WebContentsView: fake.WebContentsView,
  BrowserWindow: { fromWebContents: (wc: unknown) => fake.windowFor(wc), getAllWindows: () => [] },
  protocol: { registerSchemesAsPrivileged: () => undefined },
  dialog: {},
  shell: { openPath: vi.fn(async () => '') },
  safeStorage: {},
}));

import { OFFICE_PAGE, menuKeepsShortcut, officeHostCsp, officeNavigationAllowed, officePartition, officeRequestAllowed } from '../../../electron/security/office-policy';
import { OfficeEditorHost } from '../../../electron/services/office-editor';
import { OfficeExternal, macAppCandidates, parseAppPath } from '../../../electron/services/office-external';
import { hardenWebContents, setNavigationRule } from '../../../electron/security/hardening';
import { isOfficeExportPath, TransferManager } from '../../../electron/services/transfers';
import { Database } from '../../../electron/services/db';
import { Vault } from '../../../electron/services/vault';
import { DesktopError } from '../../../electron/main/errors';

const DS = 'https://docs.example.com';
const WS = 'https://ws.example.com';
const o = { documentServer: DS, worksuite: WS };

describe("the editor's rules (OO-DSK-021)", () => {
  it('lets the editor page reach the Document Server, its socket and WorkSuite pictures — nothing else', () => {
    expect(officeRequestAllowed(`${OFFICE_PAGE}?v=abc`, o)).toBe(true);
    expect(officeRequestAllowed('wsoffice://editor/host.js', o)).toBe(true);
    expect(officeRequestAllowed(`${DS}/web-apps/apps/api/documents/api.js`, o)).toBe(true);
    expect(officeRequestAllowed('wss://docs.example.com/doc/k/c/?EIO=4', o)).toBe(true);
    expect(officeRequestAllowed(`${WS}/uploads/avatars/2/256.webp`, o)).toBe(true);
    expect(officeRequestAllowed('data:image/png;base64,AAA', o)).toBe(true);
    expect(officeRequestAllowed('https://tracker.example.net/pixel', o)).toBe(false);
    expect(officeRequestAllowed('app://bundle/__api/api/auth/me', o)).toBe(false);
    expect(officeRequestAllowed('file:///etc/passwd', o)).toBe(false);
    expect(officeRequestAllowed('https://user:pw@docs.example.com/x', o)).toBe(false);
    expect(officeRequestAllowed('https://tracker.example.net/', { documentServer: DS, worksuite: null })).toBe(false);
  });

  it('never lets the page navigate away; frames only to the Document Server', () => {
    expect(officeNavigationAllowed(`${OFFICE_PAGE}?v=x`, true, o)).toBe(true);
    expect(officeNavigationAllowed(`${DS}/web-apps/apps/documenteditor/main/index.html`, true, o)).toBe(false);
    expect(officeNavigationAllowed('app://bundle/index.html', true, o)).toBe(false);
    expect(officeNavigationAllowed(`${DS}/web-apps/apps/documenteditor/main/index.html?frameEditorId=editor`, false, o)).toBe(true);
    expect(officeNavigationAllowed('about:blank', false, o)).toBe(true);
    expect(officeNavigationAllowed(`blob:${DS}/0b9f`, false, o)).toBe(true);
    expect(officeNavigationAllowed('blob:https://evil.example.net/0b9f', false, o)).toBe(false);
    expect(officeNavigationAllowed('https://evil.example.net/', false, o)).toBe(false);
    expect(officeNavigationAllowed(`${WS}/files`, false, o)).toBe(false);
  });

  it("the page's CSP names the Document Server and nothing of the shell", () => {
    const csp = officeHostCsp(o);
    expect(csp).toContain(`script-src 'self' ${DS}`);
    expect(csp).toContain(`frame-src ${DS} blob:`);
    expect(csp).toContain(`connect-src ${DS} wss://docs.example.com`);
    expect(csp).toContain("default-src 'none'");
    expect(csp).not.toContain('app://');
    expect(csp).not.toContain('unsafe-eval');
  });

  it('keeps one in-memory partition per organisation (OO-DSK-023)', () => {
    expect(officePartition('3')).toBe('ws-office-3');
    expect(officePartition(null)).toBe('ws-office-personal');
    expect(officePartition('../x')).toBe('ws-office-personal');
    expect(officePartition('3').startsWith('persist:')).toBe(false);
  });

  it('leaves the editor its shortcuts: ⌘/Ctrl+K is Insert link, not Search; closing a tab still works', () => {
    const key = (k: string, mods: Partial<{ control: boolean; meta: boolean; shift: boolean; alt: boolean }> = {}) => ({ type: 'keyDown', key: k, control: false, meta: false, shift: false, alt: false, ...mods });
    expect(menuKeepsShortcut(key('k', { control: true }), 'win32')).toBe(false);
    expect(menuKeepsShortcut(key('l', { meta: true }), 'darwin')).toBe(false);
    expect(menuKeepsShortcut(key('w', { control: true }), 'linux')).toBe(true);
    expect(menuKeepsShortcut(key('t', { meta: true }), 'darwin')).toBe(true);
    expect(menuKeepsShortcut(key('q', { meta: true }), 'darwin')).toBe(true);
    expect(menuKeepsShortcut(key('w', { meta: true }), 'win32')).toBe(false);
    expect(menuKeepsShortcut(key('w'), 'win32')).toBe(false);
  });

  it("the shell's navigation lock-down gives way to a view's own rule, and only to it", () => {
    const make = () => {
      const h = new Map<string, (...a: unknown[]) => void>();
      return { h, setWindowOpenHandler: () => undefined, on: (e: string, fn: (...a: unknown[]) => void) => h.set(e, fn) };
    };
    const shell = make();
    const editor = make();
    hardenWebContents(shell as never);
    hardenWebContents(editor as never);
    setNavigationRule(editor as never, (url, main) => officeNavigationAllowed(url, main, o));
    const frame = (c: ReturnType<typeof make>, url: string) => {
      const ev = { url, isMainFrame: false, preventDefault: vi.fn() };
      c.h.get('will-frame-navigate')!(ev);
      return ev.preventDefault.mock.calls.length === 0;
    };
    expect(frame(editor, `${DS}/web-apps/apps/documenteditor/main/index.html`)).toBe(true);
    expect(frame(editor, 'https://evil.example.net/')).toBe(false);
    expect(frame(shell, `${DS}/web-apps/apps/documenteditor/main/index.html`)).toBe(false);
    const nav = { preventDefault: vi.fn() };
    editor.h.get('will-navigate')!(nav, 'app://bundle/index.html');
    expect(nav.preventDefault).toHaveBeenCalled();
  });
});

describe('the editor host (OO-DSK-001/020/022)', () => {
  const ended: Array<[number, string]> = [];
  let host: OfficeEditorHost;
  const owner = () => fake.makeContents(1);
  const spec = (over: Record<string, unknown> = {}) => ({
    key: 't1',
    fileId: 42,
    sessionId: '0e9c3a2e-5b1f-4c7e-9a41-2f1d7c9b8e10',
    organizationId: '3',
    documentServerUrl: DS,
    apiUrl: `${DS}/web-apps/apps/api/documents/api.js`,
    config: { document: { key: 'k' }, token: 'eyJ' },
    events: ['onDocumentReady', 'onDocumentStateChange', 'onRequestSendNotify'] as never,
    ...over,
  });
  const lastView = () => fake.views[fake.views.length - 1]!;
  const fromPage = (wc: { id: number; mainFrame: unknown }, frame?: unknown) => ({ sender: wc, senderFrame: frame ?? { parent: null, url: `${OFFICE_PAGE}?v=t` } });

  beforeEach(() => {
    ended.length = 0;
    host = new OfficeEditorHost({ preload: '/app/out/preload/office.js', serverOrigin: () => WS, allowInsecureLocal: false, devTools: false, platform: 'linux', endSession: (f, s) => void ended.push([f, s]), configureSession: (s) => void s.setProxy({ proxyRules: 'proxy:3128' }) });
    host.install();
  });

  it('opens the editor in a sandboxed view of its own partition, with only the editor bridge', () => {
    const w = owner();
    const { viewId } = host.open(w as never, spec());
    const v = lastView();
    expect(viewId).toMatch(/^[0-9a-f-]{36}$/);
    expect(v.prefs).toMatchObject({ partition: 'ws-office-3', preload: '/app/out/preload/office.js', nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, webviewTag: false, devTools: false });
    expect(v.webContents.url.startsWith(`${OFFICE_PAGE}?v=`)).toBe(true);
    expect(fake.windowFor(w).children).toContain(v);
    expect(fake.sessions.get('ws-office-3')!.proxy).toEqual({ proxyRules: 'proxy:3128' });
  });

  it('refuses a Document Server it will not load from', () => {
    expect(() => host.open(owner() as never, spec({ documentServerUrl: 'http://docs.example.com', apiUrl: 'http://docs.example.com/web-apps/apps/api/documents/api.js' }))).toThrow(DesktopError);
    expect(() => host.open(owner() as never, spec({ apiUrl: 'https://cdn.example.net/web-apps/apps/api/documents/api.js' }))).toThrow(/not on the Document Server/);
  });

  it("the partition denies devices and permissions, blocks other origins and the editor's own downloads", async () => {
    const w = owner();
    host.open(w as never, spec());
    const s = fake.sessions.get('ws-office-3')!;
    const answer = (permission: string) => new Promise((r) => s.permission!(null, permission, r));
    expect(await answer('media')).toBe(false);
    expect(await answer('geolocation')).toBe(false);
    expect(await answer('clipboard-sanitized-write')).toBe(true);
    expect(s.device!()).toBe(false);
    const req = (url: string) => new Promise<{ cancel: boolean }>((r) => s.request!({ url }, r));
    expect((await req(`${DS}/web-apps/apps/api/documents/api.js`)).cancel).toBe(false);
    expect((await req('https://evil.example.net/x')).cancel).toBe(true);
    expect((await req('app://bundle/__api/api/auth/me')).cancel).toBe(true);
    const ev = { preventDefault: vi.fn() };
    s.download!(ev, {}, lastView().webContents);
    expect(ev.preventDefault).toHaveBeenCalled();
    expect(w.sent.some(([ch, p]) => ch === 'office:event' && (p as { type: string }).type === 'downloadBlocked')).toBe(true);
  });

  it('serves its page only to a live view, with the CSP; its script to anyone in the partition', async () => {
    host.open(owner() as never, spec());
    const s = fake.sessions.get('ws-office-3')!;
    const token = new URL(lastView().webContents.url).searchParams.get('v');
    const page = s.page!(new Request(`${OFFICE_PAGE}?v=${token}`));
    expect(page.status).toBe(200);
    expect(page.headers.get('content-security-policy')).toContain(`script-src 'self' ${DS}`);
    expect(await page.text()).toContain('host.js');
    expect(s.page!(new Request(`${OFFICE_PAGE}?v=wrong`)).status).toBe(404);
    expect(s.page!(new Request('wsoffice://editor/host.js')).status).toBe(200);
    expect(s.page!(new Request('wsoffice://editor/../etc/passwd')).status).toBe(404);
    expect(s.page!(new Request('wsoffice://other/index.html')).status).toBe(404);
  });

  it('hears only the main frame of an editor page, and passes on only checked events', () => {
    const w = owner();
    const { viewId } = host.open(w as never, spec());
    const wc = lastView().webContents;
    // Commands wait for the page: init (the checked script address and the events), then the configuration.
    expect(wc.sent).toEqual([]);
    fake.ipc.get('office-host:ready')!(fromPage(wc));
    expect(wc.sent.map(([, c]) => (c as { type: string }).type)).toEqual(['init', 'theme', 'start']);
    expect((wc.sent[0]![1] as { apiUrl: string }).apiUrl).toBe(`${DS}/web-apps/apps/api/documents/api.js`);

    fake.ipc.get('office-host:event')!(fromPage(wc), { type: 'onDocumentStateChange', data: true });
    fake.ipc.get('office-host:event')!(fromPage(wc), { type: 'onRequestSendNotify', data: { emails: ['u3@worksuite.mention'], actionLink: null, message: 'secret comment' } });
    fake.ipc.get('office-host:event')!(fromPage(wc), { type: 'shell:openExternal', data: 'file:///' });
    // A subframe (the Document Server's own) and another page are not heard at all.
    fake.ipc.get('office-host:event')!(fromPage(wc, { parent: {}, url: `${DS}/x` }), { type: 'onDocumentStateChange', data: false });
    fake.ipc.get('office-host:event')!({ sender: fake.makeContents(999), senderFrame: { parent: null, url: `${OFFICE_PAGE}?v=t` } }, { type: 'onDocumentStateChange', data: false });
    const events = w.sent.filter(([ch]) => ch === 'office:event').map(([, p]) => p as { viewId: string; type: string; data: unknown });
    expect(events.map((e) => e.type)).toEqual(['hostReady', 'onDocumentStateChange', 'onRequestSendNotify']);
    expect(events.every((e) => e.viewId === viewId)).toBe(true);
    expect(JSON.stringify(events)).not.toContain('secret comment');
  });

  it("puts the app's light or dark grey behind the editor, never white, and follows a change (#326)", () => {
    let dark = true;
    const themed = new OfficeEditorHost({ preload: '/p.js', serverOrigin: () => WS, allowInsecureLocal: false, devTools: false, platform: 'linux', endSession: () => undefined, dark: () => dark });
    themed.install();
    const w = owner();
    themed.open(w as never, spec());
    const v = lastView();
    expect(v.background).toBe('#333333');
    fake.ipc.get('office-host:ready')!(fromPage(v.webContents));
    expect(v.webContents.sent.map(([, c]) => c)).toContainEqual({ type: 'theme', dark: true });
    dark = false;
    themed.setTheme(false);
    expect(v.background).toBe('#f4f4f4');
    expect(v.webContents.sent.at(-1)![1]).toEqual({ type: 'theme', dark: false });
    // Without a theme source, the light grey.
    host.install();
    host.open(owner() as never, spec());
    expect(lastView().background).toBe('#f4f4f4');
  });

  it('lays the view over its placeholder, scaled by the page zoom, and hides it with nothing to show', () => {
    const w = owner();
    w.zoom = 1.25;
    const { viewId } = host.open(w as never, spec());
    expect(host.place(w as never, viewId, { x: 100, y: 40, width: 800, height: 600 }, true)).toBe(true);
    expect(lastView().bounds).toEqual({ x: 125, y: 50, width: 1000, height: 750 });
    expect(lastView().visible).toBe(true);
    host.place(w as never, viewId, { x: 0, y: 0, width: 0, height: 0 }, true);
    expect(lastView().visible).toBe(false);
    // Another window's page cannot move or command it.
    expect(host.place(owner() as never, viewId, { x: 0, y: 0, width: 10, height: 10 }, true)).toBe(false);
    expect(host.command(owner() as never, viewId, { type: 'showMessage', message: 'hi' })).toBe(false);
  });

  it('takes a picture of the editor for its own page only, and none while it is hidden (worksuite-desktop#39)', async () => {
    const w = owner();
    const { viewId } = host.open(w as never, spec());
    host.place(w as never, viewId, { x: 0, y: 0, width: 800, height: 600 }, true);
    expect(await host.snapshot(w as never, viewId)).toBe(`data:image/jpeg;base64,${Buffer.from('jpeg-72').toString('base64')}`);
    expect(await host.snapshot(owner() as never, viewId)).toBeNull();
    host.place(w as never, viewId, { x: 0, y: 0, width: 800, height: 600 }, false);
    expect(await host.snapshot(w as never, viewId)).toBeNull();
  });

  it('gives the editor the keyboard back when it comes out from behind a dialog, in a window in use (worksuite-desktop#42)', () => {
    const w = owner();
    const { viewId } = host.open(w as never, spec());
    const box = { x: 0, y: 0, width: 800, height: 600 };
    host.place(w as never, viewId, box, true);
    const wc = lastView().webContents;
    const before = wc.focused;
    host.place(w as never, viewId, box, true);
    expect(wc.focused).toBe(before);
    host.place(w as never, viewId, box, false);
    host.place(w as never, viewId, box, true);
    expect(wc.focused).toBe(before + 1);
    // Not when somebody is in another window: that would take the keyboard from them.
    fake.windowFor(w).inUse = false;
    host.place(w as never, viewId, box, false);
    host.place(w as never, viewId, box, true);
    expect(wc.focused).toBe(before + 1);
  });

  it('gives the editor the keyboard shortcuts it owns', () => {
    host.open(owner() as never, spec());
    const wc = lastView().webContents;
    wc.emit('before-input-event', {}, { type: 'keyDown', key: 'k', control: true, meta: false, shift: false, alt: false });
    expect(wc.ignoreMenu).toBe(true);
    wc.emit('before-input-event', {}, { type: 'keyDown', key: 'w', control: true, meta: false, shift: false, alt: false });
    expect(wc.ignoreMenu).toBe(false);
  });

  it('closing the last document of an organisation clears its partition; a closed window ends its sessions', () => {
    const w = owner();
    const a = host.open(w as never, spec());
    host.open(w as never, spec({ fileId: 43, sessionId: '1e9c3a2e-5b1f-4c7e-9a41-2f1d7c9b8e10' }));
    const s = fake.sessions.get('ws-office-3')!;
    const before = s.cleared;
    host.close(w as never, a.viewId);
    expect(s.cleared).toBe(before);
    expect(ended).toEqual([]);
    for (const fn of fake.windowFor(w).closed) fn();
    expect(ended).toEqual([[43, '1e9c3a2e-5b1f-4c7e-9a41-2f1d7c9b8e10']]);
    expect(s.cleared).toBe(before + 1);
    expect(host.count).toBe(0);
  });

  it('a reload on a new session makes that the one a closing window ends', () => {
    const w = owner();
    const { viewId } = host.open(w as never, spec());
    host.command(w as never, viewId, { type: 'start', config: {} }, '2e9c3a2e-5b1f-4c7e-9a41-2f1d7c9b8e10');
    for (const fn of fake.windowFor(w).closed) fn();
    expect(ended).toEqual([[42, '2e9c3a2e-5b1f-4c7e-9a41-2f1d7c9b8e10']]);
  });

  it('brings a document open in another window forward instead of opening it twice (OO-DSK-004)', () => {
    const other = owner();
    host.open(other as never, spec());
    const me = owner();
    expect(host.focusFile(me as never, 42)).toBe(true);
    expect(fake.windowFor(other).focused).toBe(1);
    expect(other.sent.some(([, p]) => (p as { type?: string }).type === 'focus')).toBe(true);
    expect(host.focusFile(other as never, 42)).toBe(false);
    expect(host.focusFile(me as never, 7)).toBe(false);
  });

  it('a crashed editor is reported and closed; its session stays for a reload (OO-SAV-030)', () => {
    const w = owner();
    host.open(w as never, spec());
    lastView().webContents.emit('render-process-gone', {}, { reason: 'crashed' });
    expect(w.sent.some(([, p]) => (p as { type?: string }).type === 'crashed')).toBe(true);
    expect(host.count).toBe(0);
    expect(ended).toEqual([]);
  });
});

describe("the editor's page", () => {
  it('is served with its script and no inline code', async () => {
    const { OFFICE_HOST_HTML, OFFICE_HOST_JS } = await import('../../../electron/services/office-host-page');
    expect(OFFICE_HOST_HTML).toContain('<script src="host.js"></script>');
    expect(OFFICE_HOST_HTML).not.toMatch(/<script>[^<]/);
    expect(OFFICE_HOST_JS).toContain('window.officeBridge');
    expect(OFFICE_HOST_JS).not.toContain('require(');
    // No white page behind the editor (#326): a light grey, a dark grey with the theme command, and a resize hook.
    expect(OFFICE_HOST_HTML).not.toMatch(/background:#fff\b/i);
    expect(OFFICE_HOST_HTML).toContain('html.dark');
    expect(OFFICE_HOST_JS).toContain("case 'theme'");
    expect(OFFICE_HOST_JS).toContain("addEventListener('resize'");
  });
});

describe('copies opened in other apps (OO-DSK-050, OO-OFF-030)', () => {
  let dir: string;
  let db: Database;
  let copies: OfficeExternal[];
  beforeEach(() => {
    copies = [];
    dir = mkdtempSync(join(tmpdir(), 'ws-office-'));
    db = new Database(join(dir, 'db.sqlite'));
  });
  afterEach(async () => {
    await vi.waitFor(() => expect(copies.flatMap(x => x.list()).some(c => c.state === 'downloading')).toBe(false));
    copies.forEach(x => x.stop());
    db.raw.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('finds Word from the registry answer and Mac apps in Applications', () => {
    const out = '\r\nHKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\WINWORD.EXE\r\n    (Default)    REG_SZ    C:\\Program Files\\Microsoft Office\\Root\\Office16\\WINWORD.EXE\r\n';
    expect(parseAppPath(out, 'WINWORD.EXE')).toBe('C:\\Program Files\\Microsoft Office\\Root\\Office16\\WINWORD.EXE');
    expect(parseAppPath('    (Default)    REG_EXPAND_SZ    "%ProgramFiles%\\Office\\EXCEL.EXE"', 'EXCEL.EXE', { ProgramFiles: 'C:\\Program Files' })).toBe('C:\\Program Files\\Office\\EXCEL.EXE');
    expect(parseAppPath('    (Default)    REG_SZ    C:\\evil\\calc.exe', 'WINWORD.EXE')).toBeNull();
    expect(macAppCandidates('word', '/Users/h')).toEqual(['/Applications/Microsoft Word.app', '/Users/h/Applications/Microsoft Word.app']);
  });

  function setup(over: Partial<ConstructorParameters<typeof OfficeExternal>[0]> = {}) {
    const vault = new Vault(Vault.generateKey());
    const launched: string[] = [];
    const uploads: Array<{ path: string; name: string; folderId: number | null }> = [];
    const posts: Array<{ url: string; base: string | null; name: string | null }> = [];
    let answer: () => Response = () => new Response(JSON.stringify({ status: 'success', data: { current: { version: 8 } } }), { status: 201, headers: { 'content-type': 'application/json' } });
    const http = {
      url: (p: string) => `${WS}${p}`,
      raw: async (_m: string, url: string, init: { body: FormData }) => {
        posts.push({ url, base: init.body.get('base_version') as string | null, name: (init.body.get('file') as File | null)?.name ?? null });
        return answer();
      },
    };
    const x = new OfficeExternal({
      db,
      vault: () => vault,
      http: http as never,
      userId: () => '2',
      platform: 'linux',
      home: dir,
      canOpenFiles: () => true,
      syncedPath: () => null,
      download: async (fileId, name, then) => {
        const p = join(dir, name);
        writeFileSync(p, 'v7 bytes');
        setTimeout(() => then({ path: p }), 0);
      },
      uploadNew: async (path, name, folderId) => void uploads.push({ path, name, folderId }),
      openPath: async (p) => (launched.push(p), ''),
      audit: () => undefined,
      onChanged: () => undefined,
      pollMs: 60_000,
      ...over,
    });
    copies.push(x);
    return { x, launched, uploads, posts, setAnswer: (fn: () => Response) => (answer = fn) };
  }
  const settle = (x: OfficeExternal) => vi.waitFor(() => expect(x.list().some(c => c.state === 'downloading')).toBe(false));

  it('offers the default app everywhere, and on Linux nothing named', async () => {
    const { x } = setup();
    expect(await x.apps('docx')).toEqual([{ id: 'default', label: 'the default app' }]);
    await expect(x.open({ fileId: 42, name: 'Proposal.docx', folderId: 9, version: 7, app: 'word' })).rejects.toThrow(/not installed/);
  });

  it('refuses when the organisation keeps files in WorkSuite', async () => {
    const { x } = setup({ canOpenFiles: () => false });
    await expect(x.open({ fileId: 42, name: 'Proposal.docx', folderId: 9, version: 7, app: 'default' })).rejects.toThrow(/does not allow/);
  });

  it('a synced file opens where sync keeps it, and sync takes it back (OO-DSK-051)', async () => {
    const synced = join(dir, 'Synced.docx');
    writeFileSync(synced, 'x');
    const { x, launched, posts } = setup({ syncedPath: () => synced });
    const c = await x.open({ fileId: 42, name: 'Synced.docx', folderId: 9, version: 7, app: 'default' });
    expect(c.syncOwned).toBe(true);
    expect(launched).toEqual([synced]);
    await expect(x.upload(c.id, 'version')).rejects.toThrow(/Drive sync/);
    expect(posts).toEqual([]);
  });

  it('downloads, opens, notices the edit, and uploads it against the version it was made from', async () => {
    const { x, launched, posts } = setup();
    const c = await x.open({ fileId: 42, name: 'Proposal.docx', folderId: 9, version: 7, app: 'default' });
    expect(c.state).toBe('downloading');
    await vi.waitFor(() => {
      expect(x.list()[0]!.state).toBe('open');
      expect(launched).toEqual([join(dir, 'Proposal.docx')]);
    });
    await x.check();
    expect(x.list()[0]!.state).toBe('open');
    writeFileSync(join(dir, 'Proposal.docx'), 'edited in Word, longer');
    await x.check();
    expect(x.list()[0]!.state).toBe('changed');
    const r = await x.upload(c.id, 'version');
    expect(r).toEqual({ state: 'uploaded', version: 8 });
    expect(posts).toEqual([{ url: `${WS}/api/files/42/versions`, base: '7', name: 'Proposal.docx' }]);
    expect(x.list()[0]).toMatchObject({ state: 'uploaded', baseVersion: 8 });
  });

  it("shows the server's conflict and replaces nothing until the person chooses (OO-OFF-030/031)", async () => {
    const { x, posts, uploads, setAnswer } = setup();
    const c = await x.open({ fileId: 42, name: 'Proposal.docx', folderId: 9, version: 6, app: 'default' });
    await settle(x);
    setAnswer(() => new Response(JSON.stringify({ status: 'error', message: 'The cloud file changed while you were editing.', errors: { code: 'OFFICE_VERSION_CONFLICT', base_version: 6, server_version: 7, actions: ['keep_both', 'review', 'upload_as_new_version', 'cancel'] } }), { status: 409, headers: { 'content-type': 'application/json' } }));
    const r = await x.upload(c.id, 'version');
    expect(r).toEqual({ state: 'conflict', conflict: { message: 'The cloud file changed while you were editing.', baseVersion: 6, serverVersion: 7, actions: ['keep_both', 'review', 'upload_as_new_version', 'cancel'] } });
    expect(x.list()[0]!.state).toBe('conflict');
    // Keep Both: a new file beside the original, through the upload manager.
    await x.upload(c.id, 'keep_both');
    expect(uploads).toEqual([{ path: join(dir, 'Proposal.docx'), name: 'Proposal (edited on this computer).docx', folderId: 9 }]);
    // Upload as New Version: on purpose, over the version Drive has now.
    x.list();
    setAnswer(() => new Response(JSON.stringify({ status: 'success', data: { current: { version: 8 } } }), { status: 201, headers: { 'content-type': 'application/json' } }));
    const again = await x.open({ fileId: 42, name: 'Proposal.docx', folderId: 9, version: 6, app: 'default' });
    expect(again.id).toBe(c.id);
    expect(posts.map((p) => p.base)).toEqual(['6']);
  });

  it('a new version on purpose goes against the server version the conflict named', async () => {
    const { x, posts, setAnswer } = setup();
    const c = await x.open({ fileId: 42, name: 'Proposal.docx', folderId: 9, version: 6, app: 'default' });
    await settle(x);
    setAnswer(() => new Response(JSON.stringify({ status: 'error', message: 'changed', errors: { code: 'OFFICE_VERSION_CONFLICT', base_version: 6, server_version: 7, actions: [] } }), { status: 409, headers: { 'content-type': 'application/json' } }));
    await x.upload(c.id, 'version');
    setAnswer(() => new Response(JSON.stringify({ status: 'success', data: { current: { version: 8 } } }), { status: 201, headers: { 'content-type': 'application/json' } }));
    expect(await x.upload(c.id, 'new_version')).toEqual({ state: 'uploaded', version: 8 });
    expect(posts.map((p) => p.base)).toEqual(['6', '7']);
  });

  it('keeps its list encrypted per person, and forgets it on a wipe', async () => {
    const { x } = setup();
    await x.open({ fileId: 42, name: 'Proposal.docx', folderId: 9, version: 7, app: 'default' });
    await settle(x);
    const stored = db.getConfig<string>('office_local_copies:2')!;
    expect(stored).not.toContain('Proposal');
    expect(x.localPath(42)).toEqual({ path: join(dir, 'Proposal.docx'), synced: false });
    x.forgetUser('2');
    expect(db.getConfig('office_local_copies:2')).toBeUndefined();
    x.stop();
  });
});

describe('an export downloads from our own server by its token', () => {
  it('accepts /office/exports/{token} and nothing like it', () => {
    expect(isOfficeExportPath('/office/exports/AbC123_-.xyz')).toBe(true);
    expect(isOfficeExportPath('/office/exports/a/b')).toBe(false);
    expect(isOfficeExportPath('/office/documents/AbC123_-.xyz')).toBe(false);
    expect(isOfficeExportPath('/office/exports/short')).toBe(false);
  });

  it('opens a finished PDF in PDF Studio and anything else in its own application', async () => {
    const { shell } = await import('electron');
    const openPath = vi.mocked(shell.openPath);
    openPath.mockClear();
    const dir = mkdtempSync(join(tmpdir(), 'ws-open-dl-'));
    const db = new Database(join(dir, 'db.sqlite'));
    const vault = new Vault(Vault.generateKey());
    const http = { url: (p: string) => `${WS}${p}`, raw: async () => new Response('%PDF-1.7', { status: 200, headers: { 'content-length': '8' } }) };
    const inApp: string[] = [];
    let allowed = false;
    const t = new TransferManager({ db, vault: () => vault, http: http as never, userId: () => '2', downloadFolder: () => dir, hash: async () => ({ sha256: '', bytes: 0 }), canOpenFiles: () => allowed, audit: () => undefined, openInApp: (p) => (/\.pdf$/i.test(p) ? (inApp.push(p), true) : false) });
    const done = (path: string, name: string) => new Promise((resolve) => void t.download(path, name, true, null, resolve));
    // A PDF goes to PDF Studio even where other applications are not allowed.
    await done('/d/abcdef0123456789abcd', 'Brief.pdf');
    await vi.waitFor(() => expect(inApp).toEqual([join(dir, 'Brief.pdf')]));
    // An Office file goes to the installed app — only when the organization allows that.
    await done('/media/Tok3n_abc.def', 'Budget.xlsx');
    await new Promise((r) => setTimeout(r, 10));
    expect(openPath).not.toHaveBeenCalled();
    allowed = true;
    await done('/media/Tok3n_abc.def', 'Plan.docx');
    await vi.waitFor(() => expect(openPath).toHaveBeenCalledWith(join(dir, 'Plan.docx')));
    expect(inApp).toHaveLength(1);
    await expect(t.download('/d/short', 'x.pdf', true, null)).rejects.toThrow(/Not a WorkSuite download/);
    t.stopAll();
    db.raw.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('tells a service waiting for a download how it ended', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ws-office-dl-'));
    const db = new Database(join(dir, 'db.sqlite'));
    const vault = new Vault(Vault.generateKey());
    const http = { url: (p: string) => `${WS}${p}`, raw: async () => new Response('%PDF-1.7', { status: 200, headers: { 'content-length': '8' } }) };
    const t = new TransferManager({ db, vault: () => vault, http: http as never, userId: () => '2', downloadFolder: () => dir, hash: async () => ({ sha256: '', bytes: 0 }), canOpenFiles: () => true, audit: () => undefined });
    const outcome = await new Promise((resolve) => void t.download('/office/exports/AbC123_-.xyz', 'Proposal.pdf', false, null, resolve));
    expect(outcome).toEqual({ path: join(dir, 'Proposal.pdf') });
    await expect(t.download('/elsewhere/x', 'x', false, null)).rejects.toThrow(/Not a WorkSuite download/);
    // As the app does on quitting: stop transfers, then close the database. Nothing may read it afterwards.
    t.stopAll();
    db.raw.close();
    await new Promise((r) => setTimeout(r, 300));
    rmSync(dir, { recursive: true, force: true });
  });
});

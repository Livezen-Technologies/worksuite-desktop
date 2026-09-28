import { Notification, clipboard, dialog, globalShortcut, screen, systemPreferences, type BrowserWindow, type Rectangle } from 'electron';
import type { DesktopPolicy, RemoteControlSupport, RemoteControlView } from '@shared/types';
import { logger } from '../../main/log';
import type { WindowManager } from '../../windows/manager';
import type { Database } from '../db';
import type { HttpClient } from '../http';
import type { ScreenShare } from '../screen-share';
import type { TransferManager } from '../transfers';
import { createInjector, inputSupport } from './input';
import { RemoteControlService, type Display } from './service';

const log = logger('remote-control');

/**
 * Remote control's Electron side: the screens, the consent and control-bar
 * windows, the emergency shortcut, the clipboard, and the proof that an
 * answer came from this computer's own mouse or keyboard.
 */
export interface HostDeps {
  db: Database;
  http: HttpClient;
  windows: WindowManager;
  screenShare: ScreenShare;
  transfers: TransferManager;
  deviceId: () => number | null;
  policy: () => DesktopPolicy;
  pinnedKey: string | null;
  broadcast: (view: RemoteControlView) => void;
  toast: (text: string) => void;
}

const LOCAL_INPUT = new Set(['mouseDown', 'keyDown', 'rawKeyDown', 'gestureTap', 'touchStart']);

function support(policy: DesktopPolicy): RemoteControlSupport {
  const mac = process.platform === 'darwin';
  const trusted = mac ? systemPreferences.isTrustedAccessibilityClient(false) : true;
  const s = inputSupport({ accessibility: trusted });
  return {
    available: s.available,
    method: s.method,
    displayServer: s.displayServer,
    reason: s.reason,
    accessibility: mac ? (trusted ? 'granted' : 'denied') : 'not_required',
    policyAllows: policy.remote_control_host !== 'disabled',
  };
}

function display(d: Electron.Display): Display {
  return { id: d.id, bounds: d.bounds };
}

export function createRemoteControl(deps: HostDeps): RemoteControlService {
  const consents = new Map<number, BrowserWindow>();
  let indicator: BrowserWindow | null = null;

  const physical = process.platform === 'win32' || process.platform === 'linux';
  const toInput = (p: { x: number; y: number }) => {
    if (!physical) return p;
    try {
      return screen.dipToScreenPoint(p);
    } catch {
      return p;
    }
  };
  const fromInput = (p: { x: number; y: number }) => {
    if (!physical) return p;
    try {
      return screen.screenToDipPoint(p);
    } catch {
      return p;
    }
  };

  /** Every real click and key press in a remote-control window is noted — the proof an answer needs. */
  const watchInput = (win: BrowserWindow) => {
    const wc = win.webContents;
    wc.on('input-event', (_e, input) => {
      if (LOCAL_INPUT.has(input.type)) service.noteLocalInput(wc.id);
    });
  };

  const centred = (near: Display | null, w: number, h: number): Rectangle => {
    const d = near ? (screen.getAllDisplays().find((x) => x.id === near.id) ?? screen.getDisplayNearestPoint(screen.getCursorScreenPoint())) : screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const a = d.workArea;
    return { x: Math.round(a.x + (a.width - w) / 2), y: Math.round(a.y + (a.height - h) / 2), width: w, height: h };
  };

  const service: RemoteControlService = new RemoteControlService({
    http: deps.http,
    deviceId: deps.deviceId,
    policy: deps.policy,
    support: () => support(deps.policy()),
    pinnedKey: deps.pinnedKey,
    createInjector: () => createInjector(),
    screen: {
      displays: () => screen.getAllDisplays().map(display),
      primary: () => display(screen.getPrimaryDisplay()),
      cursor: () => screen.getCursorScreenPoint(),
      toInput,
      fromInput,
    },
    ui: {
      showConsent(requestId, near) {
        if (consents.has(requestId)) return;
        const win = deps.windows.openRemote('rc-consent', `/rc/consent?request=${requestId}`, centred(near, 460, 560));
        consents.set(requestId, win);
        watchInput(win);
        win.on('closed', () => {
          if (consents.get(requestId) === win) consents.delete(requestId);
        });
        // The person may be in another app: the system says so too.
        if (Notification.isSupported()) new Notification({ title: 'Remote control request', body: 'Someone in your meeting is asking to control your screen.', silent: false }).show();
      },
      closeConsent(requestId) {
        const win = consents.get(requestId);
        consents.delete(requestId);
        if (win && !win.isDestroyed()) win.close();
      },
      consentOpen: () => [...consents.values()].some((w) => !w.isDestroyed()),
      consentFor(webContentsId) {
        for (const [id, w] of consents) if (!w.isDestroyed() && w.webContents.id === webContentsId) return id;
        return null;
      },
      isIndicator: (webContentsId) => !!indicator && !indicator.isDestroyed() && indicator.webContents.id === webContentsId,
      showIndicator(on) {
        const d = on ? (screen.getAllDisplays().find((x) => x.id === on.id) ?? screen.getPrimaryDisplay()) : screen.getPrimaryDisplay();
        const a = d.workArea;
        const bounds = { x: Math.round(a.x + (a.width - 560) / 2), y: a.y + 8, width: 560, height: 52 };
        if (indicator && !indicator.isDestroyed()) {
          indicator.setBounds(bounds);
          indicator.showInactive();
          return;
        }
        indicator = deps.windows.openRemote('rc-indicator', '/rc/indicator', bounds);
        watchInput(indicator);
        indicator.on('closed', () => {
          indicator = null;
          // The bar is how control is seen and stopped: while control lives, it comes back.
          if (service.isLive()) setTimeout(() => service.isLive() && this.showIndicator(on), 500);
        });
      },
      hideIndicator() {
        const w = indicator;
        indicator = null;
        if (w && !w.isDestroyed()) w.close();
      },
      notify(text) {
        deps.toast(text);
        if (Notification.isSupported()) new Notification({ title: 'WorkSuite remote control', body: text, silent: true }).show();
      },
      changed: (view) => {
        deps.broadcast(view);
        // A row under the bar for each file waiting for an answer (RC06), up to three.
        if (indicator && !indicator.isDestroyed()) {
          const b = indicator.getBounds();
          const height = 52 + 44 * Math.min(3, view.offers.length) + (view.offers.length > 3 ? 24 : 0);
          if (b.height !== height) indicator.setBounds({ ...b, height });
        }
      },
      async switchScreen(webContentsId, n) {
        const screens = await deps.screenShare.screens();
        const target = screens[n - 1];
        const win = deps.windows.all().find((w) => w.webContents.id === webContentsId);
        if (!target || !win) return false;
        deps.screenShare.pickForController(webContentsId, target.id);
        win.webContents.send('rc:switchScreen', { id: target.id, name: target.name });
        return true;
      },
    },
    shortcuts: {
      register(accelerator, fn) {
        try {
          return globalShortcut.register(accelerator, fn);
        } catch (e) {
          log.warn('emergency chord not registered', { accelerator, error: String(e) });
          return false;
        }
      },
      unregister(accelerator) {
        try {
          globalShortcut.unregister(accelerator);
        } catch {
          /* already gone */
        }
      },
    },
    clipboard: { writeText: (text) => clipboard.writeText(text) },
    files: {
      download: async (apiPath, name) => {
        await deps.transfers.download(apiPath, name, false, null);
      },
      async pickAndOffer(sessionId, to) {
        const r = await dialog.showOpenDialog({ title: `Send files to ${to}`, buttonLabel: 'Send', properties: ['openFile', 'multiSelections'] });
        if (r.canceled || r.filePaths.length === 0) return 0;
        const picked = await deps.transfers.register(r.filePaths.slice(0, 10));
        await deps.transfers.upload(picked.map((p) => p.handle), { kind: 'remote', sessionId });
        return picked.length;
      },
    },
    prefs: {
      allowRequests: () => deps.db.getConfig<boolean>('rc_allow_requests') ?? true,
      setAllowRequests: (v) => deps.db.setConfig('rc_allow_requests', v),
    },
  });
  return service;
}

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tmpdir } from 'node:os';

const shown: Array<{ title: string; body: string }> = [];
vi.mock('electron', () => ({
  app: { getPath: () => tmpdir(), getVersion: () => '0.1.0', isPackaged: true, name: 'WorkSuite', on: () => undefined, getLocale: () => 'en' },
  BrowserWindow: { fromWebContents: () => null, getAllWindows: () => [] },
  Menu: { buildFromTemplate: (t: unknown) => t, setApplicationMenu: () => undefined },
  Tray: class {},
  Notification: class {
    static isSupported = () => true;
    constructor(private readonly o: { title: string; body: string }) {}
    on() {
      return this;
    }
    show() {
      shown.push({ title: this.o.title, body: this.o.body });
    }
  },
  nativeImage: { createFromPath: () => ({}), createFromDataURL: () => ({ isEmpty: () => true }) },
  clipboard: {},
  dialog: {},
  shell: {},
  systemPreferences: {},
  powerMonitor: {},
  protocol: {},
  session: {},
  screen: {},
}));
const opened: string[] = [];
vi.mock('../../../electron/security/hardening', () => ({ openExternalSafely: async (url: string) => (opened.push(url), true), APP_ORIGIN: 'app://worksuite', devOrigin: () => null }));

import { canOpenApp, canOpenLink, notificationAllowed, visibleAppIds } from '@shared/access';
import type { Preferences } from '@shared/types';
import { AccessWatch, assertRoute, assertWebPath, NO_ACCESS } from '../../../electron/main/access';
import { isDesktopError } from '../../../electron/main/errors';
import { registerHandlers } from '../../../electron/main/handlers';
import type { AppContext } from '../../../electron/main/context';
import { menuTemplate } from '../../../electron/main/menu';
import type { IpcRouter } from '../../../electron/ipc/router';
import { BootstrapService } from '../../../electron/services/bootstrap';
import { Database } from '../../../electron/services/db';
import type { HttpClient } from '../../../electron/services/http';
import { Vault } from '../../../electron/services/vault';
import { NotificationService } from '../../../electron/services/notifications';
import { trayMenu, type TrayModel } from '../../../electron/tray/tray';
import { windowRoute } from '../../../electron/windows/manager';

/**
 * The main process holds the bootstrap and decides for itself: the browser,
 * windows, the tray, the menu and OS notifications offer nothing of an app
 * the person was not given, whatever the page asks for.
 */
const everyday = visibleAppIds({ apps: ['mail', 'chat', 'calendar', 'tasks', 'notes', 'drive'], permissions: [] });

const refused = (fn: () => unknown): boolean => {
  try {
    fn();
    return false;
  } catch (e) {
    return isDesktopError(e) && e.code === 'APP_ACCESS_DENIED' && e.message === NO_ACCESS;
  }
};

describe('the main process refuses what the bootstrap does not allow', () => {
  it('a web path of an app the person may not open, not one of no app', () => {
    expect(refused(() => assertWebPath('/crm?account=3', everyday))).toBe(true);
    expect(refused(() => assertWebPath('/whatsapp?chat=4', everyday))).toBe(true);
    expect(refused(() => assertWebPath('/users/7', everyday))).toBe(false);
    expect(refused(() => assertWebPath('/notes?note=1', everyday))).toBe(false);
  });

  it('a window of an app the person may not open — and knows which app an open window is of', () => {
    expect(windowRoute('app://worksuite/index.html#/window/record?route=%2Fcrm%2Fleads%2F4')).toBe('/crm/leads/4');
    expect(windowRoute('app://worksuite/index.html#/window/ring?route=%2Fcalls%2Fring%3Fuuid%3Dx')).toBe('/calls/ring?uuid=x');
    expect(windowRoute('app://worksuite/index.html')).toBeNull();
    expect(refused(() => assertRoute('/crm/leads/4', everyday))).toBe(true);
    expect(refused(() => assertRoute('/calls/ring?uuid=x', visibleAppIds({ apps: ['mail'], permissions: [] })))).toBe(true);
    expect(refused(() => assertRoute('/chat?room=4', everyday))).toBe(false);
  });

  describe('over IPC', () => {
    const handlers = new Map<string, (input: unknown, c: unknown) => unknown>();
    const windowsOpen = vi.fn(() => ({ id: 9 }));
    const download = vi.fn(async (path: string) => ({ id: 't1', path }));
    beforeEach(() => {
      handlers.clear();
      opened.length = 0;
      windowsOpen.mockClear();
      download.mockClear();
      const router = { handle: (ch: string, fn: (input: unknown, c: unknown) => unknown) => void handlers.set(ch, fn) } as unknown as IpcRouter;
      const ctx = {
        auth: { getServer: () => ({ origin: 'https://ws.example' }) },
        session: { visibleApps: () => everyday },
        windows: { open: windowsOpen },
        transfers: { download },
      } as unknown as AppContext;
      registerHandlers(router, ctx);
    });
    const call = (ch: string, input: unknown) => handlers.get(ch)!(input, { sender: {} });

    it('app:openInBrowser never opens a page of an app the person was not given', async () => {
      await expect(Promise.resolve().then(() => call('app:openInBrowser', { path: '/finance/journal' }))).rejects.toMatchObject({ code: 'APP_ACCESS_DENIED' });
      await expect(Promise.resolve().then(() => call('app:openInBrowser', { path: '/ai' }))).rejects.toMatchObject({ code: 'APP_ACCESS_DENIED' });
      expect(opened).toEqual([]);
      await call('app:openInBrowser', { path: '/users/7' });
      expect(opened).toEqual(['https://ws.example/users/7']);
    });

    it('nor does app:openExternal with a page of this server', async () => {
      await expect(Promise.resolve().then(() => call('app:openExternal', { url: 'https://ws.example/crm?account=3' }))).rejects.toMatchObject({ code: 'APP_ACCESS_DENIED' });
      expect(opened).toEqual([]);
      await call('app:openExternal', { url: 'https://example.com/crm' });
      expect(opened).toEqual(['https://example.com/crm']);
    });

    it('downloads the person’s own payslip without the Payroll app', async () => {
      expect(everyday.has('payroll')).toBe(false);
      await call('transfers:download', { payslip: 'PS-2026-09-7', name: 'Payslip.pdf', open: true });
      expect(download).toHaveBeenCalledWith('/api/payroll/me/payslips/PS-2026-09-7/pdf', 'Payslip.pdf', true, null);
    });

    it('windows:open never opens a window on an app the person was not given', () => {
      expect(() => call('windows:open', { kind: 'record', route: '/crm/leads/4' })).toThrow(NO_ACCESS);
      expect(windowsOpen).not.toHaveBeenCalled();
      expect(call('windows:open', { kind: 'chat-mini', route: '/chat?room=4' })).toEqual({ id: 9 });
    });
  });
});

describe('picking up access changes (AccessWatch)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('fetches the bootstrap again on access.changed (and profile.updated), not on other events', async () => {
    const refresh = vi.fn(async () => undefined);
    const w = new AccessWatch({ refresh, ready: () => true, online: () => true });
    expect(w.onEvent({ type: 'access.changed', user_id: 7 } as { type: string })).toBe(true);
    await vi.runAllTimersAsync();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(w.onEvent({ type: 'chat.message' })).toBe(false);
    w.onEvent({ type: 'profile.updated' });
    await vi.runAllTimersAsync();
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('asks again after a refresh already running, which may have missed the change', async () => {
    let finish: () => void = () => undefined;
    const refresh = vi.fn(() => new Promise<void>((r) => (finish = r)));
    const w = new AccessWatch({ refresh, ready: () => true, online: () => true });
    w.onEvent({ type: 'access.changed' });
    w.onEvent({ type: 'access.changed' });
    w.onEvent({ type: 'access.changed' });
    expect(refresh).toHaveBeenCalledTimes(1);
    finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(refresh).toHaveBeenCalledTimes(2);
    finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('checks every ten minutes while signed in and online, and not otherwise', async () => {
    const refresh = vi.fn(async () => undefined);
    let online = true;
    let ready = true;
    const w = new AccessWatch({ refresh, ready: () => ready, online: () => online });
    w.start();
    await vi.advanceTimersByTimeAsync(9 * 60_000);
    expect(refresh).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(refresh).toHaveBeenCalledTimes(1);
    online = false;
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(refresh).toHaveBeenCalledTimes(1);
    online = true;
    ready = false;
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(w.onEvent({ type: 'access.changed' })).toBe(false);
    expect(refresh).toHaveBeenCalledTimes(1);
    w.stop();
  });
});

describe('the tray and the menu', () => {
  const model: TrayModel = {
    signedIn: true,
    userName: 'Nuwan',
    organization: 'Livezen',
    offline: false,
    pending: 0,
    error: null,
    unreadChat: 2,
    unreadMail: 5,
    unreadOther: 1,
    badge: true,
    notificationsPausedUntil: null,
    attendance: null,
    updateReady: false,
    apps: [],
  };
  const actions = { open: vi.fn(), openRoute: vi.fn(), clockIn: vi.fn(), clockOut: vi.fn(), pauseNotifications: vi.fn(), openSettings: vi.fn(), checkUpdates: vi.fn(), quit: vi.fn(), lock: vi.fn() };
  const labels = (apps: string[]) => trayMenu({ ...model, apps }, actions).map((i) => i.label ?? i.type);
  const quick = (apps: string[]) => (trayMenu({ ...model, apps }, actions).find((i) => i.label === 'Quick Actions')?.submenu as Array<{ label: string }> | undefined)?.map((i) => i.label) ?? null;

  it('builds the unread line and the quick actions from the apps the person has', () => {
    expect(labels(['chat', 'mail', 'tasks', 'files', 'crm'])).toContain('Unread Chat 2 · Unread Mail 5');
    expect(quick(['chat', 'mail', 'tasks', 'files', 'crm'])).toEqual(['New Task', 'New Email', 'Open Chat', 'Upload File', 'New Lead']);
    expect(labels(['chat', 'tasks'])).toContain('Unread Chat 2');
    expect(quick(['chat', 'tasks'])).toEqual(['New Task', 'Open Chat']);
  });

  it('offers nothing of an app the person was not given', () => {
    const l = labels(['hr']);
    expect(l.some((x) => String(x).startsWith('Unread'))).toBe(false);
    expect(quick(['hr'])).toBeNull();
    expect(l).toContain('Open WorkSuite');
  });

  it('opens whichever of the person’s apps has more unread', () => {
    const line = trayMenu({ ...model, apps: ['chat', 'mail'] }, actions).find((i) => String(i.label).startsWith('Unread'))!;
    (line.click as () => void)();
    expect(actions.openRoute).toHaveBeenLastCalledWith('/mail');
    const chatOnly = trayMenu({ ...model, apps: ['chat'] }, actions).find((i) => String(i.label).startsWith('Unread'))!;
    (chatOnly.click as () => void)();
    expect(actions.openRoute).toHaveBeenLastCalledWith('/chat');
  });

  it('puts View › AI Assistant in the menu only for whoever has the AI app', () => {
    const view = (ai: boolean) => (menuTemplate(() => undefined, { checkUpdates: () => undefined, diagnostics: () => undefined, quit: () => undefined }, { ai }).find((m) => m.label === 'View')!.submenu as Array<{ label?: string }>).map((i) => i.label);
    expect(view(true)).toContain('AI Assistant');
    expect(view(false)).not.toContain('AI Assistant');
  });
});

describe('OS notifications', () => {
  const prefs = { notificationsEnabled: true, backgroundServices: { notifications: true }, moduleNotifications: {}, dndEnabled: false, notificationPrivacy: 'FULL', notificationSounds: true } as unknown as Preferences;
  it('shows no banner for an app the person may not open', async () => {
    const { notificationAllowed } = await import('@shared/access');
    shown.length = 0;
    const svc = new NotificationService({} as never, (() => ({})) as never, {} as never, () => prefs);
    svc.moduleEnabled = (n) => notificationAllowed(n, everyday);
    svc.notify({ id: '1', module: 'crm', category: 'crm', title: 'Lead assigned', body: 'Acme', sender: null, link: '/crm/leads/4', critical: false });
    svc.notify({ id: '2', module: 'expenses', category: 'expenses', title: 'Claim approved', body: '', sender: null, link: null, critical: true });
    svc.notify({ id: '3', module: 'tasks', category: 'projects', title: 'Task due', body: 'Report', sender: null, link: '/tasks?task=3', critical: false });
    expect(shown.map((s) => s.title)).toEqual(['Task due']);
  });
});

describe('the bootstrap says which apps are self-service', () => {
  const answer = (routes: Record<string, unknown>) =>
    ({
      get: async (path: string) => {
        if (path in routes) return routes[path];
        throw new Error(`no ${path}`);
      },
    }) as unknown as HttpClient;
  const service = (routes: Record<string, unknown>) => new BootstrapService(new Database(':memory:'), () => new Vault(Vault.generateKey()), answer(routes), null);
  const user = { id: 7, name: 'Nuwan', email: 'n@ws.example' };

  it('reads self_service from a desktop-API server', async () => {
    const b = await service({ '/desktop/v1/bootstrap': { user, organizations: [], apps: ['mail', 'chat'], self_service: ['worksuite.expenses', { slug: 'x' }, 3] } }).fetch('desktop-v1');
    expect(b.selfService).toEqual(['expenses', 'x']);
  });

  it('reads self_service from /api/auth/me on a core server', async () => {
    const b = await service({ '/api/auth/me': { user, permissions: [], apps: ['mail'], self_service: ['expenses'] } }).fetch('core');
    expect(b.selfService).toEqual(['expenses']);
  });

  it('has none when an older server does not say', async () => {
    expect((await service({ '/desktop/v1/bootstrap': { user, apps: ['mail'] } }).fetch('desktop-v1')).selfService).toEqual([]);
    expect((await service({ '/api/auth/me': { user, apps: ['mail'] } }).fetch('core')).selfService).toEqual([]);
  });

  it('keeps a self-service app open to its person: Expenses to file their own claims', async () => {
    const b = await service({ '/desktop/v1/bootstrap': { user, apps: ['mail', 'chat'], self_service: ['expenses'] } }).fetch('desktop-v1');
    const visible = visibleAppIds(b);
    expect(canOpenApp('expenses', visible)).toBe(true);
    expect(canOpenLink('/expenses?claim=12', visible)).toBe(true);
    expect(notificationAllowed({ module: 'expenses', category: 'expenses', link: '/expenses?claim=12' }, visible)).toBe(true);
    expect(canOpenApp('finance', visible)).toBe(false);
  });
});

describe('own payslips without Payroll', () => {
  it('lets the payslip notification (HR’s My pay) through, and keeps payroll runs out', () => {
    expect(notificationAllowed({ module: 'payroll', category: 'payroll', link: '/hr?tab=mypay' }, everyday)).toBe(true);
    expect(notificationAllowed({ module: 'payroll', category: 'payroll', link: '/payroll?tab=runs' }, everyday)).toBe(false);
    expect(refused(() => assertWebPath('/payroll/me/payslips/PS-1/pdf', everyday))).toBe(false);
    expect(refused(() => assertWebPath('/payroll?tab=runs', everyday))).toBe(true);
  });
});

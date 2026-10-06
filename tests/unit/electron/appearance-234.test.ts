// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Preferences } from '../../../shared/types';
import { DARK_PROFILES, LIGHT_PROFILES, normalizeAppearance } from '../../../shared/theme-profiles';

/**
 * The colour profile in every window (worksuite-desktop#234), on the main-process side: the window manager's
 * broadcast to every page (windows and views), the windows' own colours, the profile written before the first paint,
 * the settings service's per-person copy and the organisation's default, and the sync between devices.
 */
const electron = vi.hoisted(() => ({
  all: [] as Array<Record<string, unknown>>,
  windows: new Map<number, Record<string, unknown>>(),
  sendSync: vi.fn(),
  exposed: null as unknown,
}));
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp', isPackaged: true, getVersion: () => '0.1.0' },
  screen: {},
  powerSaveBlocker: {},
  BrowserWindow: { getAllWindows: () => [], fromId: (id: number) => electron.windows.get(id) ?? null },
  webContents: { getAllWebContents: () => electron.all },
  contextBridge: { exposeInMainWorld: (_: string, api: unknown) => void (electron.exposed = api) },
  ipcRenderer: { sendSync: electron.sendSync, invoke: vi.fn(), on: vi.fn(), removeListener: vi.fn() },
  webUtils: { getPathForFile: () => '' },
}));

const { WindowManager } = await import('../../../electron/windows/manager');
const { installAppearance } = await import('../../../electron/windows/appearance');
const { SettingsService } = await import('../../../electron/services/settings');
const { normalizePolicy } = await import('../../../electron/services/policy');
const { AppearanceSync } = await import('../../../electron/services/appearance-sync');
const { saveAppearanceDefaults } = await import('../../../electron/services/appearance-defaults');
const { guestWindowIds } = await import('../../../electron/main/events');

function database() {
  const store = new Map<string, unknown>();
  return { store, getConfig: (k: string) => store.get(k), setConfig: (k: string, v: unknown) => void store.set(k, v), get: () => undefined, run: () => undefined } as never as { store: Map<string, unknown>; getConfig(k: string): unknown; setConfig(k: string, v: unknown): void };
}

function contents(id: number, url: string) {
  return { id, getURL: () => url, isDestroyed: () => false, isCrashed: () => false, send: vi.fn() };
}

beforeEach(() => {
  electron.all = [];
  electron.windows.clear();
  guestWindowIds.clear();
});
afterEach(() => vi.useRealTimers());

describe("the window manager's theme broadcast (#234)", () => {
  it('reaches every page of the app — windows and views laid into them — and nothing else', () => {
    const main = contents(1, 'app://bundle/index.html');
    const call = contents(2, 'app://bundle/index.html#/window/call');
    const view = contents(3, 'app://bundle/index.html#/window/quick-ask');
    const office = contents(4, 'https://office.example/editor');
    const guest = contents(5, 'app://bundle/index.html#/guest/meet');
    guestWindowIds.add(5);
    electron.all = [main, call, view, office, guest];
    const wm = new WindowManager(database() as never, '/preload.js');
    const a = normalizeAppearance({ mode: 'dark', darkProfile: 'teal' });
    wm.broadcastAppearance(a);
    for (const wc of [main, call, view]) expect(wc.send).toHaveBeenCalledWith('appearance:changed', a);
    expect(office.send).not.toHaveBeenCalled();
    expect(guest.send).not.toHaveBeenCalled();
  });

  it("gives every open window the profile's background, and the title bar under the window controls its colour", () => {
    const wm = new WindowManager(database() as never, '/preload.js');
    const win = (id: number) => ({ id, isDestroyed: () => false, setBackgroundColor: vi.fn(), setTitleBarOverlay: vi.fn() });
    const main = win(1), ringer = win(2), tray = win(3);
    electron.windows.set(1, main).set(2, ringer).set(3, tray);
    const internals = wm as unknown as { kinds: Map<number, string>; overlays: Set<number> };
    internals.kinds.set(1, 'main').set(2, 'webchat-ring').set(3, 'ring-tray');
    internals.overlays.add(1);
    wm.setLook({ ground: '#101820', surface: '#182028', chrome: '#0a1018' });
    expect(main.setBackgroundColor).toHaveBeenCalledWith('#101820');
    expect(main.setTitleBarOverlay).toHaveBeenCalledWith({ color: '#0a1018', symbolColor: '#FFFFFF' });
    expect(ringer.setBackgroundColor).toHaveBeenCalledWith('#0a1018');
    expect(tray.setBackgroundColor).toHaveBeenCalledWith('#182028');
    expect(tray.setTitleBarOverlay).not.toHaveBeenCalled();
  });
});

function harness(initial: Partial<Preferences> = {}) {
  const settings = new SettingsService(database() as never);
  settings.update(initial);
  const handlers = new Map<string, (e: { sender: unknown; returnValue?: unknown }) => void>();
  const nativeTheme = { themeSource: 'system' as 'system' | 'light' | 'dark', shouldUseDarkColors: false, listeners: [] as Array<() => void>, on(_: 'updated', fn: () => void) { this.listeners.push(fn); } };
  const windows = { setLook: vi.fn(), broadcastAppearance: vi.fn(), isAppContents: (wc: unknown) => (wc as { ours?: boolean }).ours === true };
  installAppearance({ settings, windows, ipc: { on: (c, fn) => handlers.set(c, fn as never) }, nativeTheme });
  return { settings, handlers, nativeTheme, windows };
}

describe('the profile at startup and on a change (#234)', () => {
  it('hands each page its profile synchronously before its first paint, and only to the app’s own pages', () => {
    const { handlers } = harness({ theme: 'dark', appearance: { darkProfile: 'purple' } as never });
    const ours = { sender: { ours: true }, returnValue: undefined as unknown };
    handlers.get('appearance:initial')!(ours);
    expect(ours.returnValue).toMatchObject({ mode: 'dark', darkProfile: 'purple', lightProfile: 'blue' });
    const foreign = { sender: { ours: false }, returnValue: undefined as unknown };
    handlers.get('appearance:initial')!(foreign);
    expect(foreign.returnValue).toBeNull();
  });

  it('opens windows in the profile’s colours, and the system draws in the chosen mode', () => {
    const { windows, nativeTheme } = harness({ theme: 'dark', appearance: { darkProfile: 'green' } as never });
    const green = DARK_PROFILES.find((p) => p.id === 'green')!.tokens;
    expect(windows.setLook).toHaveBeenLastCalledWith({ ground: green['--ws-ground'], surface: green['--ws-surface'], chrome: green['--ws-navy'] });
    expect(nativeTheme.themeSource).toBe('dark');
  });

  it('broadcasts a change to every page at once, and once', () => {
    const { settings, windows } = harness({ theme: 'dark' });
    expect(windows.broadcastAppearance).not.toHaveBeenCalled();
    settings.update({ appearance: { darkProfile: 'red', chosen: true } } as Partial<Preferences>);
    expect(windows.broadcastAppearance).toHaveBeenCalledTimes(1);
    expect(windows.broadcastAppearance.mock.calls[0]![0]).toMatchObject({ mode: 'dark', darkProfile: 'red' });
    settings.update({ density: 'compact' });
    expect(windows.broadcastAppearance).toHaveBeenCalledTimes(1);
  });

  it('under System, recolours the windows when the computer’s appearance changes', () => {
    const { windows, nativeTheme } = harness({ theme: 'system', appearance: { lightProfile: 'teal', darkProfile: 'purple' } as never });
    expect(windows.setLook).toHaveBeenLastCalledWith(expect.objectContaining({ ground: LIGHT_PROFILES.find((p) => p.id === 'teal')!.tokens['--ws-ground'] }));
    nativeTheme.shouldUseDarkColors = true;
    for (const fn of nativeTheme.listeners) fn();
    expect(windows.setLook).toHaveBeenLastCalledWith(expect.objectContaining({ ground: DARK_PROFILES.find((p) => p.id === 'purple')!.tokens['--ws-ground'] }));
  });

  it('the preload writes the profile onto the page before anything else runs', async () => {
    electron.sendSync.mockReturnValue(normalizeAppearance({ mode: 'dark', darkProfile: 'orange' }));
    document.documentElement.dataset.theme = 'light';
    await import('../../../electron/preload/index');
    expect(electron.sendSync).toHaveBeenCalledWith('appearance:initial');
    expect(document.documentElement.dataset).toMatchObject({ theme: 'dark', profile: 'orange' });
    expect(document.getElementById('ws-appearance')!.textContent).toContain(DARK_PROFILES.find((p) => p.id === 'orange')!.tokens['--ws-surface']!);
    expect(electron.exposed).toBeTruthy();
  });
});

describe('the settings service’s colour profiles (#234)', () => {
  it('keeps the mode and the dark profile the same as `theme` and `darkColorProfile`', () => {
    const s = new SettingsService(database() as never);
    s.update({ theme: 'light' });
    expect(s.effective().appearance?.mode).toBe('light');
    s.update({ darkColorProfile: 'teal' });
    expect(s.effective().appearance).toMatchObject({ darkProfile: 'teal', chosen: true });
    s.update({ appearance: { darkProfile: 'gray' } } as Partial<Preferences>);
    expect(s.effective().darkColorProfile).toBe('gray');
  });

  it('reads preferences saved before profiles (#73), or with a label, as the profile meant', () => {
    const db = database();
    db.setConfig('preferences', { theme: 'dark', darkColorProfile: 'purple' });
    expect(new SettingsService(db as never).effective().appearance).toMatchObject({ mode: 'dark', darkProfile: 'purple', lightProfile: 'blue' });
    db.setConfig('preferences', { theme: 'dark', appearance: { mode: 'dark', darkProfile: 'Dark Green ✓', lightProfile: 'Light Blue' } });
    expect(new SettingsService(db as never).effective().appearance).toMatchObject({ darkProfile: 'green', lightProfile: 'blue' });
  });

  it('is each person’s: switching accounts brings back theirs', () => {
    const db = database();
    const s = new SettingsService(db as never);
    s.setUserLanguageScope('https://ws.example', 'ann');
    s.update({ appearance: { darkProfile: 'red', chosen: true } } as Partial<Preferences>);
    s.setUserLanguageScope('https://ws.example', 'bob');
    s.update({ appearance: { darkProfile: 'teal', chosen: true } } as Partial<Preferences>);
    s.setUserLanguageScope('https://ws.example', 'ann');
    expect(s.effective().appearance?.darkProfile).toBe('red');
    s.setUserLanguageScope('https://ws.example', 'bob');
    expect(s.effective().appearance?.darkProfile).toBe('teal');
  });

  it('takes another device’s copy only when it is newer', () => {
    const s = new SettingsService(database() as never);
    s.update({ appearance: { darkProfile: 'red', chosen: true } } as Partial<Preferences>);
    const at = s.appearance().updatedAt!;
    expect(s.applyRemoteAppearance({ ...s.appearance(), darkProfile: 'green', updatedAt: at - 1 })).toBe(false);
    expect(s.applyRemoteAppearance({ ...s.appearance(), darkProfile: 'green', mode: 'dark', updatedAt: at + 1 })).toBe(true);
    expect(s.effective()).toMatchObject({ theme: 'dark', appearance: { darkProfile: 'green', updatedAt: at + 1 } });
  });

  it('honours the organisation’s default and its lock from the desktop policy', () => {
    const s = new SettingsService(database() as never);
    s.setPolicy(normalizePolicy({ appearance_accent: '#7C3AED', appearance_tint: 'custom', appearance_tint_color: '#0f172a' }, true));
    expect(s.effective().appearance).toMatchObject({ lightProfile: 'org', darkProfile: 'org', org: { accent: '#7c3aed', tint: 'custom', tintColor: '#0f172a' } });
    s.setPolicy(normalizePolicy({ appearance_accent: 'purple' }, true));
    expect(s.effective().appearance?.org).toBeNull();
    expect(s.effective().appearance?.darkProfile).toBe('blue');
  });
});

describe('colour profiles between devices (#234)', () => {
  function sync(remote: unknown) {
    const settings = new SettingsService(database() as never);
    const http = { get: vi.fn(async () => ({ prefs: remote })), request: vi.fn(async () => ({})) };
    const s = new AppearanceSync({ http: http as never, settings, online: () => true });
    return { settings, http, s };
  }

  it('takes the server’s newer copy and sends nothing back', async () => {
    const { settings, http, s } = sync({ ...normalizeAppearance({ mode: 'dark', darkProfile: 'orange' }), updatedAt: Date.now() + 10_000 });
    await s.pull();
    expect(settings.effective().appearance?.darkProfile).toBe('orange');
    expect(http.request).not.toHaveBeenCalled();
  });

  it('sends this computer’s newer copy, and later changes a moment after they are made, but nothing before the first read', async () => {
    vi.useFakeTimers();
    const { settings, http, s } = sync(null);
    settings.update({ appearance: { darkProfile: 'red', chosen: true } } as Partial<Preferences>);
    vi.advanceTimersByTime(2_000);
    expect(http.request).not.toHaveBeenCalled();
    await s.pull();
    expect(http.request).toHaveBeenCalledWith('PUT', '/api/prefs/desktop.appearance', { body: { prefs: expect.objectContaining({ darkProfile: 'red' }) } });
    settings.update({ appearance: { darkProfile: 'teal', chosen: true } } as Partial<Preferences>);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(http.request).toHaveBeenLastCalledWith('PUT', '/api/prefs/desktop.appearance', { body: { prefs: expect.objectContaining({ darkProfile: 'teal' }) } });
    expect(http.request).toHaveBeenCalledTimes(2);
  });
});

describe("the organisation's colour profile, set by an administrator (#234)", () => {
  it('writes the four keys into the organisation’s policy and keeps its other keys', async () => {
    const http = { get: vi.fn(async () => ({ policies: [{ scope: 'organization', scope_id: 4, policy: { launcher_pinned: ['mail'], appearance_tint_color: '#000000' } }] })), request: vi.fn(async () => ({})) };
    const saved = await saveAppearanceDefaults(http as never, '4', { accent: '#7C3AED', tint: 'accent', tintColor: null, locked: true });
    expect(saved).toEqual({ accent: '#7c3aed', tint: 'accent', tintColor: null, locked: true });
    expect(http.request).toHaveBeenCalledWith('PUT', '/desktop/v1/admin/policies/organization:4', { body: { policy: { launcher_pinned: ['mail'], appearance_accent: '#7c3aed', appearance_tint: 'accent', appearance_locked: true } } });
    await saveAppearanceDefaults(http as never, '4', { accent: null, tint: 'neutral', tintColor: null, locked: true });
    expect(http.request).toHaveBeenLastCalledWith('PUT', '/desktop/v1/admin/policies/organization:4', { body: { policy: { launcher_pinned: ['mail'] } } });
    await expect(saveAppearanceDefaults(http as never, 'x', { accent: '#000000', tint: 'neutral', tintColor: null, locked: false })).rejects.toThrow('Choose an organization first.');
  });
});


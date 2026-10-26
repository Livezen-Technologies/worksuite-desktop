// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyView, featureKey, localCatalogue, moduleKey, resolveSettings, STARTUP_KEY, type DesktopSettingsView } from '@shared/desktop-settings';
import { APP_CATALOGUE } from '@shared/apps';

/**
 * Desktop settings in the window: an app turned off is gone from the one list of what the person may open (and so
 * from the launcher, the sidebar, links and the palette, which all read it); a feature turned off does not open; the
 * startup screen opens in front.
 */
vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(async () => undefined), on: () => () => undefined, hasDesktop: () => true, errorMessage: String, isMac: false, platform: 'linux', registerDropped: vi.fn() }));

const { app, appsFor } = await import('../../../src/core/app-state');
const { canOpen, canFollowLink, canOpenDesktopRoute } = await import('../../../src/core/access');
const { applyStartupScreen } = await import('../../../src/core/startup');
const { activeTab, tabsStore } = await import('../../../src/core/tabs');

const BOOT = { permissions: ['*'], apps: '*', user: { id: 1, name: 'Asha' }, organizations: [] } as never;

function view(prefs: Record<string, boolean | string>, policy: Record<string, { value: boolean | string; enforcement: 'managed' | 'default' }> = {}): DesktopSettingsView {
  const catalogue = localCatalogue();
  return { ...emptyView(), mode: 'enterprise', catalogue, effective: resolveSettings({ mode: 'enterprise', catalogue, policy, preferences: prefs }) };
}

beforeEach(() => {
  tabsStore.set({ tabs: [], activeId: null, closed: [], sideId: null, split: 0.5 });
});
afterEach(() => app.set({ desktopSettings: null }));

describe('apps turned off', () => {
  it('leave what the person may open: tabs, routes and links are refused like apps not given', () => {
    // By the server's slugs: `drive` is Files and its Office part.
    const ds = view({ [moduleKey('mail')]: false, [moduleKey('drive')]: false }, { [moduleKey('crm')]: { value: false, enforcement: 'managed' } });
    const apps = appsFor(BOOT, ds);
    expect(apps.some((a) => a.id === 'mail' || a.id === 'crm')).toBe(false);
    expect(apps.some((a) => a.id === 'files' || a.id === 'office')).toBe(false);
    expect(apps.some((a) => a.id === 'tasks')).toBe(true);
    app.set({ apps, desktopSettings: ds });
    expect(canOpen('mail')).toBe(false);
    expect(canOpen('crm')).toBe(false);
    expect(canOpenDesktopRoute('/crm/leads/4')).toBe(false);
    expect(canFollowLink('/mail?message=4')).toBe(false);
    expect(canOpen('tasks')).toBe(true);
    // Home and Settings can never be turned off.
    expect(canOpen('settings')).toBe(true);
    expect(appsFor(BOOT, view({ [moduleKey('home')]: false })).some((a) => a.id === 'home')).toBe(true);
    // Turned on again, they are back.
    expect(appsFor(BOOT, null).length).toBe(appsFor(BOOT, view({})).length);
  });
});

describe('features turned off', () => {
  it('officeEditing off: WorkSuite Office’s document tabs do not open, though Files does', () => {
    const apps = appsFor(BOOT, null);
    app.set({ apps, desktopSettings: view({ [featureKey('officeEditing')]: false }) });
    expect(canOpen('office')).toBe(false);
    expect(canOpenDesktopRoute('/office/drive/4')).toBe(false);
    expect(canOpen('files')).toBe(true);
    app.set({ desktopSettings: view({}) });
    expect(canOpen('office')).toBe(true);
  });
});

describe('the startup screen', () => {
  const visible = APP_CATALOGUE.filter((a) => ['home', 'mail', 'tasks'].includes(a.id));

  it('opens the chosen app in front', () => {
    app.set({ apps: visible, desktopSettings: view({ [STARTUP_KEY]: 'app:tasks' }) });
    expect(applyStartupScreen(false)).toBe('/tasks');
    expect(activeTab()?.route).toBe('/tasks');
    // By slug: `drive` opens Files.
    app.set({ apps: [...visible, ...APP_CATALOGUE.filter((a) => a.id === 'files')], desktopSettings: view({ [STARTUP_KEY]: 'app:drive' }) });
    expect(applyStartupScreen(false)).toBe('/files');
    expect(activeTab()?.route).toBe('/files');
  });

  it('opens Home when the chosen app is not there', () => {
    app.set({ apps: visible, desktopSettings: view({ [STARTUP_KEY]: 'app:crm' }) });
    expect(applyStartupScreen(false)).toBe('/home');
    expect(activeTab()?.route).toBe('/home');
  });

  it('stays on the tab in front for “where I left off”', () => {
    app.set({ apps: visible, desktopSettings: view({ [STARTUP_KEY]: 'last' }) });
    tabsStore.set({ tabs: [{ id: 'a', route: '/mail', app: 'mail', title: 'Mail', lastActive: 0, suspended: false, reloadKey: 0 } as never], activeId: 'a', closed: [], sideId: null, split: 0.5 });
    expect(applyStartupScreen(true)).toBeNull();
    expect(activeTab()?.route).toBe('/mail');
  });
});

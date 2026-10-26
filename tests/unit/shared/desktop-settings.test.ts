import { describe, expect, it } from 'vitest';
import {
  canDisableModule,
  disabledModules,
  featureKey,
  featureOn,
  localCatalogue,
  mergeCatalogue,
  migrationValues,
  moduleKey,
  moduleOn,
  parseStartup,
  preferenceOverlay,
  prefKey,
  resolveSettings,
  STARTUP_KEY,
  startupTarget,
  withoutDisabled,
  withoutDisabledIds,
  type CatalogueItem,
} from '../../../shared/desktop-settings';
import { APP_CATALOGUE } from '../../../shared/apps';

/** Desktop settings: who decides, what is enforced, what migrates, and where WorkSuite opens. */

const catalogue: CatalogueItem[] = [
  { key: featureKey('command_palette'), type: 'boolean', default: true, label: 'Command palette', group: 'features' },
  { key: moduleKey('mail'), type: 'boolean', default: true, label: 'Mail', group: 'modules' },
  { key: STARTUP_KEY, type: 'string', default: 'home', label: 'Startup screen', group: 'startup' },
  { key: prefKey('density'), type: 'enum', default: 'comfortable', label: 'Density', group: 'prefs', options: [{ value: 'comfortable', label: 'Comfortable' }, { value: 'compact', label: 'Compact' }] },
];

describe('resolution', () => {
  it('managed policy wins and is locked, over the person’s preference', () => {
    const eff = resolveSettings({ mode: 'enterprise', catalogue, policy: { [moduleKey('mail')]: { value: false, enforcement: 'managed' } }, preferences: { [moduleKey('mail')]: true } });
    expect(eff[moduleKey('mail')]).toEqual({ value: false, source: 'policy', locked: true });
  });

  it('a default policy entry is only a default: the person’s preference wins, and without one the default applies unlocked', () => {
    const policy = { [prefKey('density')]: { value: 'compact', enforcement: 'default' as const } };
    expect(resolveSettings({ mode: 'enterprise', catalogue, policy, preferences: { [prefKey('density')]: 'comfortable' } })[prefKey('density')]).toEqual({ value: 'comfortable', source: 'user', locked: false });
    expect(resolveSettings({ mode: 'enterprise', catalogue, policy, preferences: {} })[prefKey('density')]).toEqual({ value: 'compact', source: 'policy', locked: false });
  });

  it('falls back to the catalogue’s default', () => {
    const eff = resolveSettings({ mode: 'enterprise', catalogue });
    expect(eff[featureKey('command_palette')]).toEqual({ value: true, source: 'default', locked: false });
    expect(eff[STARTUP_KEY]).toEqual({ value: 'home', source: 'default', locked: false });
  });

  it('personal mode applies no policy at all: everything on by default and the person’s to change', () => {
    const eff = resolveSettings({ mode: 'personal', catalogue, policy: { [featureKey('command_palette')]: { value: false, enforcement: 'managed' } } });
    expect(eff[featureKey('command_palette')]).toEqual({ value: true, source: 'default', locked: false });
    const mine = resolveSettings({ mode: 'personal', catalogue, preferences: { [featureKey('command_palette')]: false } });
    expect(mine[featureKey('command_palette')]).toEqual({ value: false, source: 'user', locked: false });
  });

  it('passes over values that do not fit their key — a policy typo never applies', () => {
    const eff = resolveSettings({
      mode: 'enterprise',
      catalogue,
      policy: { [moduleKey('mail')]: { value: 'no', enforcement: 'managed' }, [prefKey('density')]: { value: 'tiny', enforcement: 'managed' }, [STARTUP_KEY]: { value: 'route://evil.example', enforcement: 'managed' } },
    });
    expect(eff[moduleKey('mail')]!.value).toBe(true);
    expect(eff[prefKey('density')]!.value).toBe('comfortable');
    expect(eff[STARTUP_KEY]!.value).toBe('home');
    expect(Object.values(eff).some((e) => e.locked)).toBe(false);
  });

  it('keeps keys the server adds, and ignores keys of no known shape', () => {
    const eff = resolveSettings({ mode: 'enterprise', catalogue, policy: { 'features.whiteboard': { value: false, enforcement: 'managed' }, 'rm -rf': { value: true, enforcement: 'managed' } } as never });
    expect(eff['features.whiteboard']).toEqual({ value: false, source: 'policy', locked: true });
    expect(eff['rm -rf']).toBeUndefined();
  });

  it('merges the server’s catalogue over the desktop’s', () => {
    const merged = mergeCatalogue(localCatalogue(), [{ key: STARTUP_KEY, type: 'string', default: 'app:mail', label: 'Open on', group: 'startup' }, { key: 'nonsense', type: 'boolean', default: true, label: 'x', group: 'x' }]);
    expect(merged.find((c) => c.key === STARTUP_KEY)).toMatchObject({ default: 'app:mail', label: 'Open on' });
    expect(merged.some((c) => c.key === 'nonsense')).toBe(false);
    expect(merged.some((c) => c.key === moduleKey('crm'))).toBe(true);
  });
});

describe('enforcement', () => {
  const off = resolveSettings({ mode: 'enterprise', catalogue: localCatalogue(), policy: { [moduleKey('chat')]: { value: false, enforcement: 'managed' }, [moduleKey('home')]: { value: false, enforcement: 'managed' }, [featureKey('global_search')]: { value: false, enforcement: 'managed' } } });

  it('lists the apps turned off; the shell’s own screens can never be', () => {
    expect([...disabledModules(off)]).toEqual(['chat']);
    expect(moduleOn(off, 'chat')).toBe(false);
    expect(moduleOn(off, 'home')).toBe(true);
    expect(canDisableModule('settings')).toBe(false);
    expect(localCatalogue().some((c) => c.key === moduleKey('settings') || c.key === moduleKey('home'))).toBe(false);
    expect(featureOn(off, 'global_search')).toBe(false);
    expect(featureOn(off, 'command_palette')).toBe(true);
  });

  it('drops a turned-off app and its channels from the visible apps, by definition and by id', () => {
    const apps = APP_CATALOGUE.filter((a) => ['chat', 'whatsapp', 'mail'].includes(a.id));
    expect(apps.some((a) => a.channelOf === 'chat')).toBe(true);
    expect(withoutDisabled(apps, new Set(['chat'])).map((a) => a.id)).toEqual(['mail']);
    expect([...withoutDisabledIds(new Set(['chat', 'whatsapp', 'mail']), new Set(['chat']))]).toEqual(['mail']);
    expect(withoutDisabled(apps, new Set())).toBe(apps);
  });

  it('holds a feature’s preferences off and locked, and applies managed and synced preferences', () => {
    const eff = resolveSettings({
      mode: 'enterprise',
      catalogue: localCatalogue(),
      policy: { [featureKey('notifications')]: { value: false, enforcement: 'managed' }, [prefKey('density')]: { value: 'compact', enforcement: 'managed' } },
      preferences: { [prefKey('tabSuspendMinutes')]: 60, [featureKey('restore_tabs')]: false },
    });
    const { values, locks } = preferenceOverlay(eff);
    expect(values).toMatchObject({ notificationsEnabled: false, density: 'compact', tabSuspendMinutes: 60, restoreTabs: false });
    expect(locks.map((l) => l.key).sort()).toEqual(['density', 'notificationsEnabled', 'restoreTabs']);
    expect(locks.find((l) => l.key === 'restoreTabs')!.reason).toMatch(/Features & apps/);
    expect(locks.find((l) => l.key === 'notificationsEnabled')!.reason).toMatch(/organization/);
  });

  it('puts nothing over the preferences where nobody chose', () => {
    expect(preferenceOverlay(resolveSettings({ mode: 'personal', catalogue: localCatalogue() }))).toEqual({ values: {}, locks: [] });
  });
});

describe('migration', () => {
  it('uploads this computer’s own choices — not defaults, not managed keys, not keys another device set', () => {
    const values = migrationValues(
      { density: 'compact', sidebarMode: 'collapsed', restoreTabs: false, tabSuspendMinutes: 30, downloadFolder: '/x' },
      { density: 'comfortable', sidebarMode: 'expanded', restoreTabs: true, tabSuspendMinutes: 30 },
      { mode: 'enterprise', policy: { [prefKey('sidebarMode')]: { value: 'expanded', enforcement: 'managed' } }, preferences: { [prefKey('restoreTabs')]: true } },
      { [moduleKey('crm')]: false },
    );
    expect(values).toEqual({ [prefKey('density')]: 'compact', [moduleKey('crm')]: false });
  });

  it('a default policy entry does not stop a choice from going up', () => {
    const values = migrationValues({ density: 'compact' }, { density: 'comfortable' }, { mode: 'enterprise', policy: { [prefKey('density')]: { value: 'comfortable', enforcement: 'default' } }, preferences: {} });
    expect(values).toEqual({ [prefKey('density')]: 'compact' });
  });
});

describe('startup screen', () => {
  const apps = [
    { id: 'home', route: undefined },
    { id: 'mail', route: undefined },
    { id: 'whatsapp', route: '/chat?channel=whatsapp' },
  ];
  const ctx = (over: Partial<Parameters<typeof startupTarget>[1]> = {}) => ({ apps, canOpenRoute: (r: string) => !r.startsWith('/crm'), lastRoute: '/mail?folder=inbox', home: '/home', ...over });

  it('reads the four shapes and nothing else', () => {
    expect(parseStartup('home')).toEqual({ kind: 'home' });
    expect(parseStartup('last')).toEqual({ kind: 'last' });
    expect(parseStartup('app:mail')).toEqual({ kind: 'app', appId: 'mail' });
    expect(parseStartup('route:/tasks?view=mine')).toEqual({ kind: 'route', path: '/tasks?view=mine' });
    for (const bad of ['', 'app:', 'app:Mail!', 'route:mail', 'route://evil.example', 'route:/a/../b', 'route:https://x', 'away', 7, null]) expect(parseStartup(bad)).toBeNull();
  });

  it('home opens Home; last stays on the tab in front, or Home when no tabs came back', () => {
    expect(startupTarget('home', ctx())).toEqual({ route: '/home', fallback: null });
    expect(startupTarget('last', ctx())).toEqual({ route: null, fallback: null });
    expect(startupTarget('last', ctx({ lastRoute: null }))).toEqual({ route: '/home', fallback: null });
    expect(startupTarget('last', ctx({ lastRoute: '/crm/leads' }))).toEqual({ route: '/home', fallback: null });
  });

  it('an app opens at its own route; one not given or turned off opens Home and says so', () => {
    expect(startupTarget('app:mail', ctx())).toEqual({ route: '/mail', fallback: null });
    expect(startupTarget('app:whatsapp', ctx())).toEqual({ route: '/chat?channel=whatsapp', fallback: null });
    const gone = startupTarget('app:crm', ctx());
    expect(gone.route).toBe('/home');
    expect(gone.fallback).toMatch(/not available/);
  });

  it('a page opens where it may be opened, else Home; anything unreadable is Home; a guest’s home is Notes', () => {
    expect(startupTarget('route:/tasks?view=mine', ctx())).toEqual({ route: '/tasks?view=mine', fallback: null });
    expect(startupTarget('route:/crm/leads', ctx()).route).toBe('/home');
    expect(startupTarget('nonsense', ctx())).toEqual({ route: '/home', fallback: null });
    expect(startupTarget('home', ctx({ home: '/notes' })).route).toBe('/notes');
  });
});

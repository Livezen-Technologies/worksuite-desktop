// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Preferences } from '@shared/types';
import { emptyView, featureKey, localCatalogue, moduleKey, resolveSettings, STARTUP_KEY, type DesktopSettingsView } from '@shared/desktop-settings';

/**
 * The Settings kit's "Managed by your organization" badge, and the screens that use it: Features & apps and the
 * startup screen show what the organisation manages locked, with why as the tooltip, and offer Reset to default only
 * where the person's own choice differs.
 */
const bridge = vi.hoisted(() => ({ call: vi.fn() }));
const tab = vi.hoisted(() => ({ go: vi.fn(), path: ['settings', 'features'] as string[] }));
vi.mock('../../../src/core/bridge', () => ({ call: bridge.call, on: () => () => undefined, hasDesktop: () => true, errorMessage: (e: unknown) => String((e as Error)?.message ?? e), isMac: false, platform: 'linux', registerDropped: vi.fn() }));
vi.mock('../../../src/core/tab-context', () => ({ useTab: () => ({ navigate: vi.fn(), go: tab.go, query: new URLSearchParams(), path: tab.path, active: true }), useTabTitle: () => undefined }));

const { app } = await import('../../../src/core/app-state');
const { LockBadge, SettingRow, RadioCards, SettingsQuery } = await import('../../../src/modules/settings/kit');
const { FeaturesSettings } = await import('../../../src/modules/settings/FeaturesSettings');
const { StartupSettings } = await import('../../../src/modules/settings/StartupSettings');
const SettingsPage = (await import('../../../src/modules/settings/SettingsPage')).default;

const PREFS = { sidebarMode: 'expanded', pinnedApps: [], shortcuts: {}, language: 'en', theme: 'light', density: 'comfortable', restoreTabs: true, ai: { display: 'widget', dockAtStart: false }, webchatRinging: {}, meetRecording: {}, meetBehaviour: {}, drive: {} } as unknown as Preferences;
const BOOT = { permissions: ['*'], apps: '*', user: { id: 1, name: 'Asha' }, organizations: [] } as never;

function view(policy: Record<string, { value: boolean | string; enforcement: 'managed' | 'default' }>, preferences: Record<string, boolean | string> = {}): DesktopSettingsView {
  const catalogue = localCatalogue();
  return { ...emptyView(), mode: 'enterprise', status: 'synced', asOf: new Date().toISOString(), catalogue, effective: resolveSettings({ mode: 'enterprise', catalogue, policy, preferences }) };
}

function wrap(node: React.ReactNode) {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{node}</QueryClientProvider>);
}

beforeEach(() => {
  bridge.call.mockReset();
  bridge.call.mockImplementation(async (channel: string) => (channel === 'desktopSettings:set' ? app.get().desktopSettings : undefined));
  app.set({ ready: true, prefs: PREFS, locks: [], bootstrap: BOOT, apps: [], desktopSettings: null });
});
afterEach(cleanup);

describe('LockBadge', () => {
  it('says “Managed by your organization”, with the reason as its tooltip and accessible description', () => {
    render(<LockBadge reason="Your organization keeps Mail off on this computer." />);
    const badge = screen.getByText('Managed by your organization').closest<HTMLElement>('[data-lock-badge]')!;
    expect(badge.getAttribute('title')).toBe('Your organization keeps Mail off on this computer.');
    const described = document.getElementById(badge.getAttribute('aria-describedby')!);
    expect(described?.textContent).toBe('Your organization keeps Mail off on this computer.');
    expect(badge.querySelector('svg')).toBeTruthy();
  });

  it('a locked row shows the badge and the reason, and offers no reset', () => {
    const reset = vi.fn();
    render(
      <SettingRow label="Density" lock={{ reason: 'Your organization manages this setting.' }} onReset={reset}>
        <span>Compact</span>
      </SettingRow>,
    );
    const badge = screen.getByText('Managed by your organization').closest<HTMLElement>('[data-lock-badge]')!;
    // The reason once, under the label, and that line is what describes the badge.
    const reason = screen.getByText('Your organization manages this setting.');
    expect(badge.getAttribute('aria-describedby')).toBe(reason.id);
    expect(badge.getAttribute('title')).toBe('Your organization manages this setting.');
    expect(screen.queryByRole('button', { name: 'Reset to default' })).toBeNull();
  });

  it('an unlocked row with a change offers Reset to default', () => {
    const reset = vi.fn();
    render(
      <SettingRow label="Density" onReset={reset}>
        <span>Compact</span>
      </SettingRow>,
    );
    expect(screen.queryByText('Managed by your organization')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Reset to default' }));
    expect(reset).toHaveBeenCalled();
  });

  it('marks rows the settings search finds', () => {
    render(
      <SettingsQuery.Provider value="dens">
        <SettingRow label="Density">x</SettingRow>
        <SettingRow label="Theme">y</SettingRow>
      </SettingsQuery.Provider>,
    );
    expect(screen.getByText('Density').closest('[data-setting-row]')!.hasAttribute('data-setting-match')).toBe(true);
    expect(screen.getByText('Theme').closest('[data-setting-row]')!.hasAttribute('data-setting-match')).toBe(false);
  });

  it('radio cards are a radio group, moved through with the arrow keys', () => {
    const change = vi.fn();
    render(<RadioCards label="Startup screen" value="home" options={[{ value: 'home', label: 'Home' }, { value: 'last', label: 'Where I left off' }]} onChange={change} />);
    const group = screen.getByRole('radiogroup', { name: 'Startup screen' });
    expect(within(group).getByRole('radio', { name: /Home/ }).getAttribute('aria-checked')).toBe('true');
    fireEvent.keyDown(within(group).getByRole('radio', { name: /Home/ }), { key: 'ArrowRight' });
    expect(change).toHaveBeenCalledWith('last');
  });
});

describe('Features & apps', () => {
  it('shows managed features and apps locked with the badge, disabled; the rest are the person’s', async () => {
    app.set({ desktopSettings: view({ [featureKey('global_search')]: { value: false, enforcement: 'managed' }, [moduleKey('crm')]: { value: false, enforcement: 'managed' } }) });
    wrap(<FeaturesSettings />);
    const search = screen.getByRole('switch', { name: 'Search' });
    expect(search.getAttribute('aria-checked')).toBe('false');
    expect(search).toHaveProperty('disabled', true);
    const crm = screen.getByRole('switch', { name: 'CRM' });
    expect(crm).toHaveProperty('disabled', true);
    const crmRow = crm.closest<HTMLElement>('[data-setting-row]')!;
    expect(within(crmRow).getByText('Managed by your organization')).toBeTruthy();
    // Not managed: the person's to change.
    const palette = screen.getByRole('switch', { name: 'Command palette' });
    expect(palette).toHaveProperty('disabled', false);
    expect(within(palette.closest<HTMLElement>('[data-setting-row]')!).queryByText('Managed by your organization')).toBeNull();
    await act(async () => void fireEvent.click(palette));
    expect(bridge.call).toHaveBeenCalledWith('desktopSettings:set', { values: { [featureKey('command_palette')]: false } });
    expect(screen.getByText('Enterprise')).toBeTruthy();
  });

  it('marks an organisation default as such, and offers Reset to default on the person’s own change', () => {
    app.set({ desktopSettings: view({ [moduleKey('mail')]: { value: false, enforcement: 'default' } }, { [moduleKey('crm')]: false }) });
    wrap(<FeaturesSettings />);
    const mailRow = screen.getByRole('switch', { name: 'Mail' }).closest<HTMLElement>('[data-setting-row]')!;
    expect(within(mailRow).getByText('Your organization’s default')).toBeTruthy();
    expect(within(mailRow).queryByRole('button', { name: 'Reset to default' })).toBeNull();
    const crmRow = screen.getByRole('switch', { name: 'CRM' }).closest<HTMLElement>('[data-setting-row]')!;
    fireEvent.click(within(crmRow).getByRole('button', { name: 'Reset to default' }));
    expect(bridge.call).toHaveBeenCalledWith('desktopSettings:set', { values: { [moduleKey('crm')]: null } });
  });

  it('says when it shows the copy from the last sync, offline', () => {
    app.set({ desktopSettings: { ...view({}), status: 'cached', asOf: new Date(Date.now() - 3_600_000).toISOString(), pending: [STARTUP_KEY] } });
    wrap(<FeaturesSettings />);
    expect(screen.getByText(/Offline — showing your settings as of/)).toBeTruthy();
    expect(screen.getByText('1 change waiting to sync.')).toBeTruthy();
  });
});

describe('Startup screen', () => {
  it('is locked when the organisation manages it', () => {
    app.set({ desktopSettings: view({ [STARTUP_KEY]: { value: 'app:mail', enforcement: 'managed' } }) });
    wrap(<StartupSettings />);
    expect(screen.getByText('Managed by your organization')).toBeTruthy();
    for (const r of screen.getAllByRole('radio')) expect(r).toHaveProperty('disabled', true);
    expect(screen.getByRole('radio', { name: /An app/ }).getAttribute('aria-checked')).toBe('true');
  });

  it('saves the person’s choice', async () => {
    app.set({ desktopSettings: view({}) });
    wrap(<StartupSettings />);
    expect(screen.getByRole('radio', { name: /Where I left off/ }).getAttribute('aria-checked')).toBe('true');
    await act(async () => void fireEvent.click(screen.getByRole('radio', { name: /Home/ })));
    expect(bridge.call).toHaveBeenCalledWith('desktopSettings:set', { values: { [STARTUP_KEY]: 'home' } });
  });
});

describe('Settings page', () => {
  it('lists Desktop & startup and Features & apps, and its search finds a setting in another section', () => {
    tab.path = ['settings', 'general'];
    app.set({ desktopSettings: view({}) });
    wrap(<SettingsPage tabId="t" route="/settings/general" active />);
    const nav = screen.getByRole('navigation', { name: 'Settings sections' });
    expect(within(nav).getByRole('button', { name: 'Desktop & startup' })).toBeTruthy();
    expect(within(nav).getByRole('button', { name: 'Features & apps' })).toBeTruthy();
    fireEvent.change(within(nav).getByRole('searchbox', { name: 'Search settings' }), { target: { value: 'startup screen' } });
    expect(within(nav).getByRole('button', { name: 'Desktop & startup' })).toBeTruthy();
    expect(within(nav).queryByRole('button', { name: 'License' })).toBeNull();
    fireEvent.change(within(nav).getByRole('searchbox', { name: 'Search settings' }), { target: { value: 'zzzz' } });
    expect(within(nav).getByText(/No setting matches/)).toBeTruthy();
  });
});

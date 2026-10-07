// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { visibleApps } from '@shared/apps';
import type * as CoreApi from '../../../src/core/api';

/** Settings › App launcher (worksuite-desktop#201). */
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(async () => ({ prefs: null })), apiPut: vi.fn(async () => ({})) }));

const launcherDefaults = vi.fn(async (i: { pinned: string[]; order: string[] }) => ({ pinned: i.pinned, order: i.order }));
window.worksuite = {
  platform: 'darwin',
  settings: { launcherDefaults },
  files: { registerDropped: async () => [] },
  events: { on: () => () => undefined },
};
Object.defineProperty(window, 'matchMedia', { value: () => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined }) });

const { app } = await import('../../../src/core/app-state');
const { ui } = await import('../../../src/core/ui');
const { currentLauncherPrefs, resetLauncherPrefsForTests, updateLauncherPrefs } = await import('../../../src/core/launcher-prefs');
const { LauncherSettings } = await import('../../../src/modules/settings/LauncherSettings');

beforeEach(() => {
  localStorage.clear();
  resetLauncherPrefsForTests();
  launcherDefaults.mockClear();
  app.set({
    auth: { stage: 'ready', user: { id: '7' }, server: { api: 'desktop-v1', origin: 'https://ws.test' } } as never,
    session: { mode: 'account', signingIn: false, moveOffer: false },
    apps: visibleApps({ apps: ['mail', 'chat', 'tasks', 'notes', 'billing'], permissions: ['billing.view'] }),
    prefs: { shortcuts: {} } as never,
    bootstrap: null,
    organizationId: null,
  });
});
afterEach(() => cleanup());

describe('Settings › App launcher', () => {
  it('sets the size and how it opens', () => {
    render(<LauncherSettings />);
    fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Size' })).getByRole('radio', { name: 'Large' }));
    expect(currentLauncherPrefs().size).toBe('large');
    fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Open as' })).getByRole('radio', { name: 'Full screen' }));
    expect(currentLauncherPrefs().mode).toBe('fullscreen');
    expect(within(screen.getByRole('radiogroup', { name: 'Size' })).getByRole('radio', { name: 'Large' }).getAttribute('aria-checked')).toBe('true');
  });

  it('switches recent apps, badges, the browser mark and names', () => {
    render(<LauncherSettings />);
    for (const label of ['Show recent apps', 'Show unread badges', 'Mark apps that open in the browser', 'Show app names']) fireEvent.click(screen.getByRole('switch', { name: label }));
    expect(currentLauncherPrefs().toggles).toEqual({ recent: false, badges: false, browserMark: false, names: false, sidebar: true });
  });

  it('offers the categories in a sidebar only for full screen, and switches it', () => {
    render(<LauncherSettings />);
    expect(screen.queryByRole('switch', { name: 'Categories in a sidebar' })).toBeNull();
    fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Open as' })).getByRole('radio', { name: 'Full screen' }));
    const sidebar = screen.getByRole('switch', { name: 'Categories in a sidebar' });
    expect(sidebar.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(sidebar);
    expect(currentLauncherPrefs().toggles.sidebar).toBe(false);
  });

  it('hides and shows each app, and says how many are shown', () => {
    render(<LauncherSettings />);
    const total = within(screen.getByRole('list', { name: 'Apps' })).getAllByRole('listitem').length;
    expect(screen.getByText(`${total} of ${total} shown`)).toBeTruthy();
    fireEvent.click(screen.getByRole('switch', { name: 'Show Notes' }));
    expect(currentLauncherPrefs().hidden).toEqual(['notes']);
    expect(screen.getByText(`${total - 1} of ${total} shown`)).toBeTruthy();
  });

  it('unpins and reorders pinned apps', () => {
    updateLauncherPrefs((p) => ({ ...p, pinned: ['mail', 'chat', 'tasks'] }));
    render(<LauncherSettings />);
    expect(screen.getByText('3 of 8 · drag to reorder')).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('button', { name: 'Move Mail' }), { key: 'ArrowDown' });
    expect(currentLauncherPrefs().pinned).toEqual(['chat', 'mail', 'tasks']);
    fireEvent.click(screen.getByRole('button', { name: 'Unpin Tasks' }));
    expect(currentLauncherPrefs().pinned).toEqual(['chat', 'mail']);
  });

  it('reorders pinned apps by dragging', () => {
    updateLauncherPrefs((p) => ({ ...p, pinned: ['mail', 'chat', 'tasks'] }));
    render(<LauncherSettings />);
    const rows = within(screen.getByRole('list', { name: 'Pinned apps' })).getAllByRole('listitem');
    const dataTransfer = { setData: () => undefined, getData: () => '', effectAllowed: '' };
    fireEvent.dragStart(rows[2]!, { dataTransfer });
    fireEvent.dragOver(rows[0]!, { dataTransfer });
    fireEvent.drop(rows[0]!, { dataTransfer });
    expect(currentLauncherPrefs().pinned).toEqual(['tasks', 'mail', 'chat']);
  });

  it('says when the pinned row is full', () => {
    updateLauncherPrefs((p) => ({ ...p, pinned: ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8'] }));
    render(<LauncherSettings />);
    expect(screen.getByText('You can pin up to 8 apps. Unpin one to pin another.')).toBeTruthy();
  });

  it('records a new shortcut, and refuses ⌘K and single keys', () => {
    render(<LauncherSettings />);
    const rec = screen.getByRole('button', { name: 'Launcher shortcut' });
    expect(rec.textContent).toBe('⌘⇧K');
    fireEvent.click(rec);
    fireEvent.keyDown(rec, { key: 'k', code: 'KeyK', metaKey: true });
    expect(screen.getByRole('alert').textContent).toContain('Search');
    expect(currentLauncherPrefs().shortcut).toBe('Mod+Shift+K');
    fireEvent.click(rec);
    fireEvent.keyDown(rec, { key: 'p', code: 'KeyP', metaKey: true, shiftKey: true });
    expect(screen.getByRole('alert').textContent).toContain('Command palette');
    fireEvent.click(rec);
    fireEvent.keyDown(rec, { key: 'j', code: 'KeyJ' });
    expect(screen.getByRole('alert').textContent).toContain('single key');
    fireEvent.click(rec);
    fireEvent.keyDown(rec, { key: 'l', code: 'KeyL', metaKey: true, shiftKey: true });
    expect(currentLauncherPrefs().shortcut).toBe('Mod+Shift+L');
    expect(rec.textContent).toBe('⌘⇧L');
  });

  it('makes groups of the person\'s own', () => {
    updateLauncherPrefs((p) => ({ ...p, groupBy: 'mine' }));
    render(<LauncherSettings />);
    fireEvent.change(screen.getByLabelText('New group name'), { target: { value: 'Daily' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add group' }));
    expect(currentLauncherPrefs().groups).toEqual([{ id: 'daily', name: 'Daily', apps: [] }]);
    const group = screen.getByRole('group', { name: 'Daily' });
    const data = new Map<string, string>([['application/x-worksuite-app', 'mail']]);
    const dataTransfer = { types: ['application/x-worksuite-app'], getData: (k: string) => data.get(k) ?? '', setData: () => undefined };
    fireEvent.dragOver(group, { dataTransfer });
    fireEvent.drop(group, { dataTransfer });
    expect(currentLauncherPrefs().groups[0]!.apps).toEqual(['mail']);
    fireEvent.click(screen.getByRole('button', { name: 'Take Mail out of Daily' }));
    expect(currentLauncherPrefs().groups[0]!.apps).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Remove Daily' }));
    expect(currentLauncherPrefs().groups).toEqual([]);
  });

  it('resets to the defaults, and previews the launcher', () => {
    updateLauncherPrefs((p) => ({ ...p, size: 'large', hidden: ['mail'], pinned: ['chat'] }));
    render(<LauncherSettings />);
    fireEvent.click(screen.getByRole('button', { name: 'Reset to default' }));
    expect(currentLauncherPrefs()).toMatchObject({ size: 'compact', hidden: [], pinned: [], shortcut: 'Mod+Shift+K' });
    fireEvent.click(screen.getByRole('button', { name: 'Preview launcher' }));
    expect(ui.get().overlay).toBe('launcher');
  });

  it('offers the organization default only to whoever may set desktop policy', async () => {
    const boot = (permissions: string[]) =>
      app.set({ bootstrap: { apps: '*', permissions, organizations: [{ id: '4', name: 'Acme' }], defaultOrganizationId: '4', user: { organizationId: '4' }, policy: { launcher_pinned: ['mail'], launcher_order: [] } } as never });
    boot([]);
    render(<LauncherSettings />);
    expect(screen.queryByRole('region', { name: 'Organization default' })).toBeNull();
    cleanup();
    boot(['desktop.policies.manage']);
    updateLauncherPrefs((p) => ({ ...p, pinned: ['tasks', 'chat'] }));
    render(<LauncherSettings />);
    const card = screen.getByRole('region', { name: 'Organization default' });
    expect(card.textContent).toContain('Pinned now: Mail');
    fireEvent.click(within(card).getByRole('button', { name: 'Use my pinned apps and order' }));
    await waitFor(() => expect(launcherDefaults).toHaveBeenCalled());
    expect(launcherDefaults.mock.calls[0]![0]).toMatchObject({ organizationId: '4', pinned: ['tasks', 'chat'] });
  });
});

describe('light and dark', () => {
  it('draws the launcher and its settings with the theme\'s tokens, not fixed colours', () => {
    for (const f of ['src/app/overlays/Launcher.tsx', 'src/modules/settings/LauncherSettings.tsx']) {
      const src = readFileSync(resolve(__dirname, '../../..', f), 'utf8');
      expect(src.match(/(?<!\w)#(?:[0-9a-fA-F]{3}){1,2}\b/g) ?? [], f).toEqual([]);
      expect(src).toMatch(/bg-surface/);
    }
  });
});

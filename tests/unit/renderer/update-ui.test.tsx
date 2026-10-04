// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BusyReport, Preferences, UpdateStatus } from '../../../shared/types';

const handlers = vi.hoisted(() => new Map<string, (input?: unknown) => unknown>());
const listeners = vi.hoisted(() => new Map<string, (p: unknown) => void>());
vi.mock('../../../src/core/bridge', () => ({
  call: vi.fn(async (channel: string, input?: unknown) => (handlers.has(channel) ? handlers.get(channel)!(input) : undefined)),
  on: (channel: string, fn: (p: unknown) => void) => {
    listeners.set(channel, fn);
    return () => listeners.delete(channel);
  },
  hasDesktop: () => true,
  errorMessage: (e: unknown) => String((e as Error)?.message ?? e),
  isMac: false,
  platform: 'linux',
  registerDropped: vi.fn(),
}));
vi.mock('../../../src/core/tab-context', () => ({ useTab: () => ({ navigate: vi.fn(), go: vi.fn(), query: new URLSearchParams(), path: ['settings', 'about'] }), useTabTitle: () => undefined }));

const { call } = await import('../../../src/core/bridge');
const { app } = await import('../../../src/core/app-state');
const { UpdatesCard: AboutUpdates, updateStateLabel } = await import('../../../src/modules/settings/UpdatesCard');
const { UpdateNotices, pillVisible } = await import('../../../src/app/overlays/UpdateControls');
const { UpdateBanner, UpdateIndicator, UpdatePopover } = await import('../../../src/app/screens/UpdateScreens');
const { ui } = await import('../../../src/core/ui');
const { prepareForRestart, wireUpdatePrepare } = await import('../../../src/core/update-restart');
const { useDraft } = await import('../../../src/core/drafts');

const mocked = call as unknown as ReturnType<typeof vi.fn>;

function status(over: Partial<UpdateStatus> = {}): UpdateStatus {
  return {
    state: 'IDLE',
    channel: 'stable',
    currentVersion: '0.2.126',
    availableVersion: null,
    minimumVersion: null,
    required: false,
    critical: false,
    progress: 0,
    error: null,
    lastCheckedAt: null,
    deadline: null,
    signatureVerified: true,
    notesUrl: null,
    installSupported: true,
    installBlockedReason: null,
    allowedChannels: ['stable', 'beta', 'dev'],
    channelLockReason: null,
    notes: null,
    snoozedUntil: null,
    quietReason: null,
    ...over,
  };
}

const ready = (over: Partial<UpdateStatus> = {}) =>
  status({
    state: 'STAGED',
    availableVersion: '0.2.127',
    progress: 100,
    notes: { version: '0.2.127', summary: 'Faster mail search.', highlights: ['Faster mail search.', 'Calendar week numbers'], url: 'https://notes.example/0.2.127' },
    ...over,
  });

const idle: BusyReport = { uploads: 0, downloads: 0, pendingMutations: 0, drafts: 0, activeCall: false };

function wrap(node: ReactNode) {
  return render(<QueryClientProvider client={new QueryClient()}>{node}</QueryClientProvider>);
}

beforeEach(() => {
  handlers.clear();
  mocked.mockClear();
  app.set({ update: null, prefs: { autoUpdate: true, updateNotifications: true, updateInstallOnQuit: true, updateChannel: 'stable' } as unknown as Preferences, locks: [] });
  ui.set({ overlay: null });
  handlers.set('updates:busy', () => idle);
  handlers.set('updates:installNow', () => ({ started: true, busy: idle, message: null }));
});
afterEach(cleanup);

async function pick(label: string) {
  fireEvent.click(screen.getByRole('combobox', { name: 'Update channel' }));
  fireEvent.click(await screen.findByRole('option', { name: new RegExp(`^${label}`) }));
}

describe('Settings › About › Channel (worksuite-desktop#205)', () => {
  it('offers only the channels the organisation allows; the others are disabled with the note', async () => {
    app.set({ update: status({ allowedChannels: ['stable', 'beta'] }) });
    wrap(<AboutUpdates />);
    fireEvent.click(screen.getByRole('combobox', { name: 'Update channel' }));
    const options = await screen.findAllByRole('option');
    const dev = options.find((o) => o.textContent?.startsWith('Dev'))!;
    expect(dev.textContent).toContain('Not allowed by your organisation');
    expect(dev.getAttribute('aria-disabled')).toBe('true');
    expect(options.find((o) => o.textContent?.startsWith('Beta'))!.getAttribute('aria-disabled')).not.toBe('true');
    fireEvent.click(dev);
    expect(mocked).not.toHaveBeenCalledWith('updates:setChannel', expect.anything());
    expect(screen.getByText(/Your organisation allows: Stable, Beta\./)).toBeTruthy();
  });

  it('says when the channel this computer was on is no longer allowed', () => {
    app.set({ update: status({ allowedChannels: ['stable'], channelFallback: { from: 'beta', to: 'stable' } }) });
    wrap(<AboutUpdates />);
    expect(screen.getByText('Beta: Not allowed by your organisation. This computer follows Stable now, without downgrading.')).toBeTruthy();
  });

  it('is locked with the reason when the organisation chooses', () => {
    app.set({ update: status({ allowedChannels: ['stable'], channelLockReason: 'Your organization chooses the update channel.' }), locks: [{ key: 'autoUpdate', reason: 'Your organization keeps WorkSuite up to date automatically.' }] });
    wrap(<AboutUpdates />);
    expect((screen.getByRole('combobox', { name: 'Update channel' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Your organization chooses the update channel.')).toBeTruthy();
    expect((screen.getByRole('switch', { name: 'Download updates automatically' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('asks before a less stable channel, and only then switches', async () => {
    app.set({ update: status() });
    handlers.set('updates:setChannel', () => status({ channel: 'beta' }));
    wrap(<AboutUpdates />);
    await pick('Beta');
    expect(screen.getByRole('dialog', { name: 'Switch to Beta?' })).toBeTruthy();
    expect(mocked).not.toHaveBeenCalledWith('updates:setChannel', expect.anything());
    fireEvent.click(screen.getByRole('button', { name: 'Switch to Beta' }));
    await waitFor(() => expect(mocked).toHaveBeenCalledWith('updates:setChannel', { channel: 'beta', confirmed: true }));
  });

  it('cancelling keeps the channel', async () => {
    app.set({ update: status() });
    wrap(<AboutUpdates />);
    await pick('Dev');
    expect(screen.getByText(/may be unstable/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(mocked).not.toHaveBeenCalledWith('updates:setChannel', expect.anything());
  });

  it('moves to a more stable channel without asking, then waits, with Reinstall Stable now', async () => {
    app.set({ update: status({ channel: 'beta', currentVersion: '0.2.127-beta.1' }) });
    handlers.set('updates:setChannel', () => status({ channel: 'stable', currentVersion: '0.2.127-beta.1', waitingForChannel: { channel: 'stable', version: '0.2.127-beta.1' } }));
    handlers.set('updates:reinstall', () => status({ state: 'DOWNLOADING', availableVersion: '0.2.126', downgrade: true, progress: 10 }));
    const view = wrap(<AboutUpdates />);
    await pick('Stable');
    await waitFor(() => expect(mocked).toHaveBeenCalledWith('updates:setChannel', { channel: 'stable', confirmed: false }));
    view.rerender(<QueryClientProvider client={new QueryClient()}><AboutUpdates /></QueryClientProvider>);
    expect(await screen.findByText(/Waiting for Stable to catch up/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Reinstall Stable now' }));
    expect(screen.getByRole('dialog', { name: 'Reinstall Stable now?' })).toBeTruthy();
    expect(mocked).not.toHaveBeenCalledWith('updates:reinstall');
    fireEvent.click(screen.getByRole('button', { name: 'Download Stable' }));
    await waitFor(() => expect(mocked).toHaveBeenCalledWith('updates:reinstall'));
  });
});

describe('Settings › About › state and what is new', () => {
  it('says up to date, checking, downloading, ready or failed', () => {
    expect(updateStateLabel(status({ lastCheckedAt: null })).word).toBe('Up to date');
    expect(updateStateLabel(status({ state: 'CHECKING' })).word).toBe('Checking…');
    expect(updateStateLabel(status({ state: 'DOWNLOADING', progress: 42, availableVersion: '0.2.127' })).word).toBe('Downloading 42%');
    expect(updateStateLabel(ready()).word).toBe('Ready');
    expect(updateStateLabel(status({ state: 'FAILED', error: 'Could not check for updates.' }))).toMatchObject({ word: 'Failed', detail: 'Could not check for updates.' });
  });

  it('shows download progress', () => {
    app.set({ update: status({ state: 'DOWNLOADING', availableVersion: '0.2.127', progress: 42 }) });
    wrap(<AboutUpdates />);
    expect(screen.getByRole('progressbar', { name: 'Download progress' }).getAttribute('aria-valuenow')).toBe('42');
  });

  it("shows What's new in X with the full release notes link", () => {
    app.set({ update: ready() });
    wrap(<AboutUpdates />);
    expect(screen.getByRole('heading', { name: "What's new in 0.2.127" })).toBeTruthy();
    expect(screen.getByText('Calendar week numbers')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'View full release notes' }));
    expect(mocked).toHaveBeenCalledWith('app:openExternal', { url: 'https://notes.example/0.2.127' });
  });

  it('offers Download when automatic downloads are off', async () => {
    app.set({ update: status({ state: 'AVAILABLE', availableVersion: '0.2.127' }) });
    handlers.set('updates:download', () => ready());
    wrap(<AboutUpdates />);
    fireEvent.click(screen.getByRole('button', { name: 'Download' }));
    await waitFor(() => expect(mocked).toHaveBeenCalledWith('updates:download'));
  });

  it('saves each update switch', async () => {
    handlers.set('settings:set', (p) => ({ preferences: { ...app.get().prefs, ...(p as object) }, locks: [] }));
    app.set({ update: status() });
    wrap(<AboutUpdates />);
    fireEvent.click(screen.getByRole('switch', { name: 'Install when quitting' }));
    await waitFor(() => expect(mocked).toHaveBeenCalledWith('settings:set', { updateInstallOnQuit: false }));
    fireEvent.click(screen.getByRole('switch', { name: 'Update notifications' }));
    await waitFor(() => expect(mocked).toHaveBeenCalledWith('settings:set', { updateNotifications: false }));
    fireEvent.click(screen.getByRole('switch', { name: 'Download updates automatically' }));
    await waitFor(() => expect(mocked).toHaveBeenCalledWith('settings:set', { autoUpdate: false }));
  });
});

describe('the title-bar indicator when an update is ready', () => {
  const pill = 'Update ready: WorkSuite 0.2.127. Restart to install it.';
  function shown() {
    wrap(
      <>
        <UpdateIndicator />
        <UpdatePopover />
      </>,
    );
  }

  it('is the Update ready pill only when downloaded, not put off, and nothing must not be interrupted', () => {
    expect(pillVisible(ready())).toBe(true);
    expect(pillVisible(status({ state: 'DOWNLOADING' }))).toBe(false);
    expect(pillVisible(ready({ snoozedUntil: 'next-launch' }))).toBe(false);
    expect(pillVisible(ready({ quietReason: 'a meeting' }))).toBe(false);
    expect(pillVisible(ready({ required: true }))).toBe(false);
  });

  it('shows the pill look when ready, and a quiet icon during a meeting', () => {
    app.set({ update: ready() });
    shown();
    expect(screen.getByRole('button', { name: pill }).textContent).toContain('Update ready');
    cleanup();
    app.set({ update: ready({ quietReason: 'a meeting' }) });
    shown();
    expect(screen.getByRole('button', { name: pill }).textContent).not.toContain('Update ready');
  });

  it('opens a panel with the version, a summary, Restart to update and Later', async () => {
    app.set({ update: ready() });
    handlers.set('updates:later', () => ready({ snoozedUntil: new Date(Date.now() + 3600_000).toISOString() }));
    shown();
    fireEvent.click(screen.getByRole('button', { name: pill }));
    const pop = await screen.findByRole('dialog', { name: 'Update ready' });
    expect(pop.textContent).toContain('0.2.127');
    expect(pop.textContent).toContain('Faster mail search.');
    fireEvent.click(screen.getByRole('button', { name: /Later/ }));
    expect(screen.getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['1 hour', '4 hours', 'Tomorrow']);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Tomorrow' }));
    await waitFor(() => expect(mocked).toHaveBeenCalledWith('updates:later', { choice: 'tomorrow' }));
    await waitFor(() => expect(screen.getByRole('button', { name: pill }).textContent).not.toContain('Update ready'));
  });

  it('restarts at once when nothing is waiting', async () => {
    app.set({ update: ready() });
    shown();
    act(() => ui.set({ overlay: 'update' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Restart to update' }));
    await waitFor(() => expect(mocked).toHaveBeenCalledWith('updates:installNow', { force: false }));
    expect(mocked).not.toHaveBeenCalledWith('updates:installNow', { force: true });
  });

  it('lists what a restart would affect — a call BLOCKS, queued changes are SAFE — and restarts when work finishes', async () => {
    app.set({ update: ready() });
    handlers.set('updates:installNow', (i) => ((i as { force: boolean }).force ? { started: true, busy: null, message: null } : { started: false, busy: { ...idle, pendingMutations: 3, activeCall: true }, message: 'WorkSuite is busy.' }));
    handlers.set('updates:installWhenFree', () => ready({ restartWhenFree: true }));
    shown();
    act(() => ui.set({ overlay: 'update' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Restart to update' }));
    const dialog = await screen.findByRole('dialog', { name: 'WorkSuite Update Ready' });
    const rows = within(dialog).getAllByRole('listitem').map((li) => li.textContent);
    expect(rows).toEqual(['Call in progressRestarting would end itBLOCKS', '3 offline changes queuedKept in the offline queue and sent after the restartSAFE']);
    expect(mocked).not.toHaveBeenCalledWith('updates:installNow', { force: true });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Restart when work finishes' }));
    await waitFor(() => expect(mocked).toHaveBeenCalledWith('updates:installWhenFree'));
    expect(mocked).not.toHaveBeenCalledWith('updates:installNow', { force: true });
  });

  it('Restart Later keeps WorkSuite running and puts the reminder off an hour', async () => {
    app.set({ update: ready() });
    handlers.set('updates:installNow', () => ({ started: false, busy: { ...idle, activity: { meeting: true, call: false, screenShare: false, remoteControl: false } }, message: 'WorkSuite is busy.' }));
    handlers.set('updates:later', () => ready({ snoozedUntil: new Date(Date.now() + 3600_000).toISOString() }));
    shown();
    act(() => ui.set({ overlay: 'update' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Restart to update' }));
    expect(await screen.findByText('Meet call in progress')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Restart Later' }));
    await waitFor(() => expect(mocked).toHaveBeenCalledWith('updates:later', { choice: 'hour' }));
    expect(mocked).not.toHaveBeenCalledWith('updates:installNow', { force: true });
  });

  it('with only drafts and queued changes, offers Restart now', async () => {
    app.set({ update: ready() });
    handlers.set('updates:installNow', (i) => ((i as { force: boolean }).force ? { started: true, busy: null, message: null } : { started: false, busy: { ...idle, pendingMutations: 2, drafts: 1, details: { calls: [], transfers: [], draftModules: { mail: 1 } } }, message: 'WorkSuite is busy.' }));
    shown();
    act(() => ui.set({ overlay: 'update' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Restart to update' }));
    expect(await screen.findByText('1 unsent mail draft')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Restart now' }));
    await waitFor(() => expect(mocked).toHaveBeenCalledWith('updates:installNow', { force: true }));
  });
});

describe('critical updates and notices after the restart', () => {
  it('a security update gets the stronger banner, not just the pill', () => {
    app.set({ update: ready({ security: true, critical: true, postponed: 1 }) });
    wrap(<UpdateBanner />);
    const banner = screen.getByRole('alert');
    expect(banner.textContent).toContain('Security update: WorkSuite 0.2.127 is ready.');
    expect(banner.textContent).toContain('If you put it off again, it installs the next time WorkSuite starts.');
  });

  it('an ordinary update has no banner', () => {
    app.set({ update: ready() });
    wrap(<UpdateBanner />);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows "Updated to X · What\'s new" once, until dismissed', async () => {
    app.set({ update: status({ currentVersion: '0.2.127', justUpdated: { version: '0.2.127', notesUrl: 'https://notes.example/0.2.127' } }) });
    handlers.set('updates:dismissNotice', () => status({ currentVersion: '0.2.127' }));
    wrap(<UpdateNotices />);
    expect(screen.getByRole('status').textContent).toContain('Updated to 0.2.127');
    fireEvent.click(screen.getByRole('button', { name: "What's new" }));
    expect(mocked).toHaveBeenCalledWith('app:openExternal', { url: 'https://notes.example/0.2.127' });
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
  });

  it('reports a rolled-back update', () => {
    app.set({ update: status({ rollback: { failedVersion: '0.2.127', restored: true, message: 'WorkSuite 0.2.127 did not start, so the previous version was put back.' } }) });
    wrap(<UpdateNotices />);
    expect(screen.getByRole('alert').textContent).toContain('the previous version was put back');
  });
});

describe('before the restart', () => {
  it('writes waiting drafts, then says it is ready', async () => {
    const saved: unknown[] = [];
    handlers.set('offline:getDraft', () => null);
    handlers.set('offline:saveDraft', (d) => void saved.push(d));
    let setter: ((v: string) => void) | null = null;
    function Editor() {
      const d = useDraft('mail', 'compose:1', '');
      setter = d.setValue;
      return null;
    }
    wrap(<Editor />);
    act(() => setter!('Dear Asha,'));
    expect(saved).toEqual([]);
    await prepareForRestart('abc123');
    expect(saved).toEqual([{ module: 'mail', context: 'compose:1', content: 'Dear Asha,' }]);
    expect(mocked).toHaveBeenLastCalledWith('updates:prepared', { token: 'abc123' });
  });

  it('answers the main process when it asks', async () => {
    const off = wireUpdatePrepare();
    listeners.get('update:prepare')!({ token: 'tok9' });
    await waitFor(() => expect(mocked).toHaveBeenCalledWith('updates:prepared', { token: 'tok9' }));
    off();
  });
});

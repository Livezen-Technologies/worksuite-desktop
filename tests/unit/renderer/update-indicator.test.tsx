// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Preferences, UpdateStatus } from '../../../shared/types';

/**
 * A new version in the title bar (Settings › Desktop › Updates): an icon with a dot while a newer version is on
 * offer, on its way or ready, and a popover with its next step — Download, or Restart to update.
 */
const net = vi.hoisted(() => ({ call: vi.fn(), navigate: vi.fn() }));

vi.mock('../../../src/core/bridge', () => ({ call: net.call, on: () => () => undefined, hasDesktop: () => true, errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)), isMac: false, platform: 'linux' }));
vi.mock('../../../src/core/tabs', () => ({ navigate: net.navigate }));

const { app } = await import('../../../src/core/app-state');
const { ui } = await import('../../../src/core/ui');
const { UpdateIndicator, UpdatePopover } = await import('../../../src/app/screens/UpdateScreens');

const status = (patch: Partial<UpdateStatus>): UpdateStatus => ({
  state: 'IDLE',
  channel: 'stable',
  currentVersion: '0.2.131',
  availableVersion: '0.2.132',
  minimumVersion: null,
  required: false,
  critical: false,
  progress: 0,
  error: null,
  lastCheckedAt: null,
  deadline: null,
  signatureVerified: true,
  notesUrl: 'https://download.worksuitecloud.com/apps/desktop/releases/0.2.132',
  installSupported: true,
  installBlockedReason: null,
  ...patch,
});

function show(update: UpdateStatus, autoUpdate = true): void {
  app.set({ update, prefs: { autoUpdate } as Preferences });
  render(
    <>
      <UpdateIndicator />
      <UpdatePopover />
    </>,
  );
}

beforeEach(() => {
  net.call.mockReset().mockResolvedValue(undefined);
  net.navigate.mockReset();
  ui.set({ overlay: null });
});
afterEach(cleanup);

describe('the title-bar update icon', () => {
  it('is not there without a newer version, or while the blocking Update required screen shows', () => {
    show(status({ state: 'IDLE', availableVersion: null }));
    expect(screen.queryByRole('button', { name: /Update/ })).toBeNull();
    cleanup();
    show(status({ state: 'STAGED', required: true }));
    expect(screen.queryByRole('button', { name: /Update/ })).toBeNull();
  });

  it('offers a version that waits for the person, and Download fetches it', async () => {
    show(status({ state: 'AVAILABLE' }), false);
    fireEvent.click(screen.getByRole('button', { name: 'Update available: WorkSuite 0.2.132' }));
    expect(ui.get().overlay).toBe('update');
    await screen.findByRole('dialog', { name: 'Update available' });
    expect(screen.getByText('Version 0.2.132 is available. Download it when you are ready.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Download' }));
    await waitFor(() => expect(net.call).toHaveBeenCalledWith('updates:download'));
  });

  it('shows a download on its way, with its progress', async () => {
    show(status({ state: 'DOWNLOADING', progress: 40 }));
    expect(screen.getByRole('button', { name: 'Downloading WorkSuite 0.2.132… 40%' })).toBeTruthy();
    act(() => ui.set({ overlay: 'update' }));
    expect((await screen.findByRole('progressbar', { name: 'Download' })).getAttribute('aria-valuenow')).toBe('40');
  });

  it('a ready version restarts to update, and asks again over work in progress', async () => {
    net.call.mockImplementation(async (ch: string) => (ch === 'updates:installNow' ? { started: false, busy: { uploads: 1, downloads: 0, pendingMutations: 0, drafts: 0, activeCall: false }, message: 'WorkSuite is busy.' } : undefined));
    show(status({ state: 'STAGED', progress: 100 }));
    fireEvent.click(screen.getByRole('button', { name: 'Update ready: WorkSuite 0.2.132. Restart to install it.' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Restart to update' }));
    await waitFor(() => expect(net.call).toHaveBeenCalledWith('updates:installNow', { force: false }));
    fireEvent.click(await screen.findByRole('button', { name: 'Restart anyway' }));
    await waitFor(() => expect(net.call).toHaveBeenCalledWith('updates:installNow', { force: true }));
  });

  it('opens the update settings', async () => {
    show(status({ state: 'AVAILABLE' }));
    act(() => ui.set({ overlay: 'update' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Update settings' }));
    expect(net.navigate).toHaveBeenCalledWith('/settings/desktop');
    expect(ui.get().overlay).toBeNull();
  });
});

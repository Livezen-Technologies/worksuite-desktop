// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { Transfer } from '../../../shared/types';
import { defaultDrivePrefs } from '../../../shared/transfers';

const bridge = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock('../../../src/core/bridge', () => ({ call: bridge.call, on: vi.fn(() => () => undefined), errorMessage: (e: unknown) => String(e) }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));
const nav = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock('../../../src/core/tabs', () => ({ navigate: nav.navigate }));
vi.mock('../../../src/core/api', () => ({ apiGet: vi.fn(async () => ({ quota: 10 * 1024 ** 3, used: 2 * 1024 ** 3, unlimited: false })) }));
const prefs = vi.hoisted(() => ({ update: vi.fn(async () => undefined) }));
vi.mock('../../../src/core/app-state', async () => {
  const { createStore } = await import('../../../src/core/store');
  const { defaultDrivePrefs: d } = await import('../../../shared/transfers');
  return {
    app: createStore({ transfers: [] as Transfer[], prefs: { downloadFolder: '/home/me/Downloads/WorkSuite', drive: d() }, locks: [], sync: { folders: [{ bytes: 5 * 1024 * 1024 }] }, apps: [] }),
    updatePrefs: prefs.update,
  };
});

import { app } from '../../../src/core/app-state';
import { TransferCenter, waitingLine } from '../../../src/app/overlays/TransferCenter';
import { DriveSettings } from '../../../src/modules/files/DriveSettings';
import { autoChoices, type UploadConflict } from '../../../src/modules/files/UploadConflicts';

const tr = (id: string, state: Transfer['state'], over: Partial<Transfer> = {}): Transfer => ({ id, direction: 'download', name: `${id}.pdf`, source: '', destination: '/home/me/Downloads', bytes: 0, total: 1000, state, speed: 0, error: null, createdAt: '', ...over });

const wrap = (node: ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{node}</QueryClientProvider>);

beforeEach(() => {
  bridge.call.mockReset();
  bridge.call.mockImplementation(async (ch: string) => (ch === 'offline:status' ? { cacheBytes: 3 * 1024 * 1024, cacheEntries: 4 } : ch === 'transfers:resetSettings' ? { preferences: { downloadFolder: '/home/me/Downloads/WorkSuite', drive: defaultDrivePrefs() }, locks: [] } : undefined));
  prefs.update.mockClear();
});
afterEach(cleanup);

describe('the Transfers panel (worksuite-desktop#94)', () => {
  it('shows Active, Queued and Completed & failed, with a summary of what is moving', () => {
    app.set({
      transfers: [
        tr('a', 'running', { bytes: 500, speed: 100 }),
        tr('b', 'running'),
        ...Array.from({ length: 8 }, (_, i) => tr(`q${i}`, 'queued', { position: i + 1 })),
        tr('done', 'done'),
        tr('bad', 'failed', { error: 'That file no longer exists.' }),
      ],
    });
    render(<TransferCenter />);
    expect(screen.getByText('2 transferring · 8 queued')).toBeTruthy();
    const active = screen.getByRole('region', { name: 'Active' });
    expect(within(active).getByText('a.pdf')).toBeTruthy();
    // Progress, speed and time left for one moving.
    expect(within(active).getByText(/500 B \/ 1000 B · 100 B\/s · 5s left/)).toBeTruthy();
    const queued = screen.getByRole('region', { name: 'Queued' });
    expect(within(queued).getByText('Queued · #1 in line')).toBeTruthy();
    expect(within(queued).getAllByRole('button', { name: 'Pause' })).toHaveLength(8);
    const finished = screen.getByRole('region', { name: 'Completed & failed' });
    expect(within(finished).getByText('That file no longer exists.')).toBeTruthy();
    expect(within(finished).getByRole('button', { name: 'Retry' })).toBeTruthy();
  });

  it('pauses and resumes everything, and clears only finished history', () => {
    app.set({ transfers: [tr('a', 'running'), tr('p', 'paused'), tr('done', 'done')] });
    render(<TransferCenter />);
    fireEvent.click(screen.getByRole('button', { name: /Pause all/ }));
    fireEvent.click(screen.getByRole('button', { name: /Resume all/ }));
    fireEvent.click(screen.getByRole('button', { name: /Clear finished/ }));
    expect(bridge.call.mock.calls.map((c) => c[0])).toEqual(['transfers:pauseAll', 'transfers:resumeAll', 'transfers:clearFinished']);
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
    expect(bridge.call).toHaveBeenLastCalledWith('transfers:resume', { id: 'p' });
  });

  it('says when a waiting file is tried again', () => {
    expect(waitingLine(tr('x', 'queued', { position: 3 }), null)).toBe('Queued · #3 in line');
    expect(waitingLine(tr('x', 'queued', { retryAt: new Date().toISOString(), attempts: 1, error: 'The server answered 503.' }), 12)).toBe('Trying again in 12s · try 2 · The server answered 503.');
    expect(waitingLine(tr('x', 'paused', { error: 'The connection was lost. Resume to continue.' }), null)).toMatch(/^Paused · The connection was lost/);
  });
});

describe('Drive › Settings (worksuite-desktop#95)', () => {
  it('says the settings are for this computer, and groups them', async () => {
    wrap(<DriveSettings />);
    expect(screen.getByText('These settings apply to this computer.')).toBeTruthy();
    expect(screen.getByText(/don’t change your account’s storage or the file-size limits/)).toBeTruthy();
    for (const name of ['Transfers', 'Bandwidth', 'Storage & Sync', 'Notifications']) expect(screen.getByRole('region', { name })).toBeTruthy();
    // Local cache and kept-offline files, measured here.
    expect(await screen.findByText('3.0 MB')).toBeTruthy();
    expect(screen.getByText('5.0 MB')).toBeTruthy();
  });

  it('saves a change straight away, and resets everything to the defaults', async () => {
    wrap(<DriveSettings />);
    fireEvent.click(screen.getByRole('switch', { name: 'When a transfer finishes' }));
    expect(prefs.update).toHaveBeenCalledWith({ drive: { ...defaultDrivePrefs(), notifyComplete: true } });
    fireEvent.click(screen.getByRole('button', { name: 'Reset to defaults' }));
    expect(bridge.call).toHaveBeenCalledWith('transfers:resetSettings');
  });

  it('cleans up the cache without touching files', () => {
    wrap(<DriveSettings />);
    fireEvent.click(screen.getByRole('button', { name: 'Clean up' }));
    expect(bridge.call).toHaveBeenCalledWith('offline:clearCache');
  });
});

describe('the default answer to a name already taken', () => {
  const c = (name: string, canReplace: boolean): UploadConflict => ({ name, file_id: name.length, existing: name, size: 1, updated_at: null, can_replace: canReplace, free_name: `${name} (1)` });
  it('keeps both, skips, or replaces — keeping alongside a file this person may not change', () => {
    const list = [c('a.txt', true), c('bb.txt', false)];
    expect(autoChoices(list, 'both')).toEqual([{ how: 'both', name: 'a.txt (1)' }, { how: 'both', name: 'bb.txt (1)' }]);
    expect(autoChoices(list, 'skip')).toEqual([{ how: 'skip' }, { how: 'skip' }]);
    expect(autoChoices(list, 'replace')).toEqual([{ how: 'replace', fileId: 5 }, { how: 'both', name: 'bb.txt (1)' }]);
  });
});

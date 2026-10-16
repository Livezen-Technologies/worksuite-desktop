// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { Transfer } from '../../../shared/types';
import { CONNECTION_LOST, TOO_LARGE } from '../../../shared/uploads';

const bridge = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock('../../../src/core/bridge', () => ({ isMac: false, call: bridge.call, on: vi.fn(() => () => undefined), errorMessage: (e: unknown) => String(e), registerDropped: vi.fn(async () => []) }));
const toasts = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock('../../../src/core/toasts', () => ({ toast: toasts.toast }));
vi.mock('../../../src/core/tabs', () => ({ navigate: vi.fn() }));
vi.mock('../../../src/core/app-state', async () => {
  const { createStore } = await import('../../../src/core/store');
  return { app: createStore({ transfers: [] as Transfer[], apps: [] }) };
});

import { app } from '../../../src/core/app-state';
import { TransferCenter, waitingLine } from '../../../src/app/overlays/TransferCenter';
import { Uploading, uploadStage, useTenderUploads } from '../../../src/modules/tenders/files';

/**
 * worksuite-desktop#249 — what a person sees of a large upload: progress, speed and time left with Pause, Resume
 * and Cancel in Transfers; the reason when it stops, and a Retry that carries on; and on the tender's Documents
 * tab, the file at once as "Uploading 42%", which gives way to the normal row when it is filed.
 */

const MB = 1024 * 1024;
const up = (id: string, state: Transfer['state'], over: Partial<Transfer> = {}): Transfer => ({ id, direction: 'upload', name: `${id}.pdf`, source: '', destination: 'Tender', bytes: 0, total: 50 * MB, state, speed: 0, error: null, createdAt: '', ...over });

beforeEach(() => {
  bridge.call.mockReset();
  bridge.call.mockResolvedValue(undefined);
  toasts.toast.mockReset();
  app.set({ transfers: [] });
});
afterEach(cleanup);

describe('Transfers: progress, speed, pause and resume', () => {
  it('shows how far an upload is, how fast, and how long is left, with Pause and Cancel', () => {
    app.set({ transfers: [up('spec', 'running', { bytes: 21 * MB, speed: 625 * 1024 })] });
    render(<TransferCenter />);
    const active = screen.getByRole('region', { name: 'Active' });
    expect(within(active).getByText(/^42% · 21 MB \/ 50 MB · 625 KB\/s · .* left$/)).toBeTruthy();
    fireEvent.click(within(active).getByRole('button', { name: 'Pause' }));
    expect(bridge.call).toHaveBeenLastCalledWith('transfers:pause', { id: 'spec' });
    fireEvent.click(within(active).getByRole('button', { name: 'Cancel' }));
    expect(bridge.call).toHaveBeenLastCalledWith('transfers:cancel', { id: 'spec' });
  });

  it('a lost connection says it will continue by itself — never "The request was cancelled."', () => {
    const t = up('spec', 'queued', { bytes: 21 * MB, retryAt: new Date(Date.now() + 12_000).toISOString(), attempts: 6, error: CONNECTION_LOST });
    expect(waitingLine(t, 12)).toBe('Connection lost · paused, will continue automatically · next try in 12s');
    app.set({ transfers: [t] });
    render(<TransferCenter />);
    expect(screen.getByText(/^Connection lost · paused, will continue automatically/)).toBeTruthy();
    expect(screen.queryByText(/request was cancelled/i)).toBeNull();
  });

  it('a failure shows its reason and where it stopped, and Retry carries on from there', () => {
    app.set({ transfers: [up('spec', 'failed', { bytes: 21 * MB, error: 'Server rejected the file (type not allowed)' })] });
    render(<TransferCenter />);
    const finished = screen.getByRole('region', { name: 'Completed & failed' });
    expect(within(finished).getByText('Stopped at 42% · Server rejected the file (type not allowed)')).toBeTruthy();
    fireEvent.click(within(finished).getByRole('button', { name: 'Retry — continues from where it stopped' }));
    expect(bridge.call).toHaveBeenLastCalledWith('transfers:retry', { id: 'spec' });
  });

  it('a paused upload has Resume', () => {
    app.set({ transfers: [up('spec', 'paused', { bytes: 10 * MB })] });
    render(<TransferCenter />);
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
    expect(bridge.call).toHaveBeenLastCalledWith('transfers:resume', { id: 'spec' });
  });
});

function DocumentsUploads({ onSettled }: { onSettled: () => void }) {
  const uploads = useTenderUploads(9, onSettled);
  return <Uploading live={uploads.live} />;
}

describe("a tender's Documents tab", () => {
  it('shows the file at once as "Uploading 42%", and the normal row takes over when it is filed', () => {
    const settled = vi.fn();
    const tender = { tenderId: 9, into: 'document' as const, docKind: 'tender_notice' };
    // An upload already moving when the tab opens (started before, or before a restart) shows too.
    app.set({ transfers: [up('spec', 'running', { bytes: 21 * MB, tender }), up('other', 'running', { bytes: MB, tender: { ...tender, tenderId: 10 } })] });
    render(<DocumentsUploads onSettled={settled} />);
    const row = screen.getByRole('group', { name: 'Uploading spec.pdf' });
    expect(within(row).getByText('Uploading 42%')).toBeTruthy();
    expect(within(row).getByRole('progressbar').getAttribute('aria-valuenow')).toBe('42');
    // Another tender's upload is not this one's.
    expect(screen.queryByRole('group', { name: 'Uploading other.pdf' })).toBeNull();

    act(() => app.set({ transfers: [up('spec', 'done', { bytes: 50 * MB, tender })] }));
    expect(screen.queryByRole('group', { name: 'Uploading spec.pdf' })).toBeNull();
    // The list is asked again, so the document's own row appears.
    expect(settled).toHaveBeenCalledTimes(1);
  });

  it('a failed upload stays on the tab with its reason and a Retry that resumes', () => {
    const tender = { tenderId: 9, into: 'document' as const };
    app.set({ transfers: [up('spec', 'running', { bytes: 21 * MB, tender })] });
    render(<DocumentsUploads onSettled={() => undefined} />);
    act(() => app.set({ transfers: [up('spec', 'failed', { bytes: 21 * MB, tender, error: 'The server could not finish this file. It will be sent again from the start when you retry.' })] }));
    const row = screen.getByRole('group', { name: 'Uploading spec.pdf' });
    expect(within(row).getByText('Failed')).toBeTruthy();
    expect(within(row).getByText(/could not finish this file/)).toBeTruthy();
    expect(toasts.toast).toHaveBeenCalledWith('error', expect.stringContaining('spec.pdf'));
    fireEvent.click(within(row).getByRole('button', { name: 'Retry uploading spec.pdf' }));
    expect(bridge.call).toHaveBeenLastCalledWith('transfers:retry', { id: 'spec' });
  });

  it('an upload that ended before the tab opened is not news', () => {
    const settled = vi.fn();
    app.set({ transfers: [up('old', 'failed', { tender: { tenderId: 9, into: 'document' }, error: TOO_LARGE })] });
    render(<DocumentsUploads onSettled={settled} />);
    expect(toasts.toast).not.toHaveBeenCalled();
    expect(settled).not.toHaveBeenCalled();
  });

  it('says where an upload is in words', () => {
    expect(uploadStage({ state: 'running', bytes: 21 * MB, total: 50 * MB })).toEqual({ label: 'Uploading 42%', pct: 42 });
    expect(uploadStage({ state: 'paused', bytes: 21 * MB, total: 50 * MB })).toEqual({ label: 'Paused 42%', pct: 42 });
    expect(uploadStage({ state: 'queued', bytes: 21 * MB, total: 50 * MB, retryAt: '2026-10-05T10:00:00Z' })).toEqual({ label: 'Waiting 42%', pct: 42 });
    expect(uploadStage({ state: 'failed', bytes: 21 * MB, total: 50 * MB })).toEqual({ label: 'Failed', pct: 42 });
  });
});

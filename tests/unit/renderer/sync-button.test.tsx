// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SyncButton } from '../../../src/components/SyncButton';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const width = (b: HTMLElement) => [...b.querySelectorAll('span.col-start-1')].map((s) => s.textContent);

describe('the shared Sync button (#165)', () => {
  it('spins at once, ignores a second click, then shows Synced just now and returns to Ready', async () => {
    vi.useFakeTimers();
    let finish!: () => void;
    const onSync = vi.fn(() => new Promise<void>((r) => (finish = r)));
    render(<SyncButton label="Sync all now" onSync={onSync} />);
    const btn = screen.getByRole('button', { name: 'Sync all now' });
    fireEvent.click(btn);
    expect(btn.getAttribute('data-state')).toBe('syncing');
    expect(btn.getAttribute('aria-busy')).toBe('true');
    expect(screen.getByRole('button', { name: 'Syncing…' })).toBe(btn);
    expect(btn.querySelector('svg')!.getAttribute('class')).toContain('motion-safe:animate-spin');
    fireEvent.click(btn);
    expect(onSync).toHaveBeenCalledTimes(1);
    await act(async () => finish());
    expect(btn.getAttribute('data-state')).toBe('done');
    expect(screen.getByRole('button', { name: 'Synced just now' })).toBe(btn);
    expect(screen.getByRole('status').textContent).toBe('Sync complete');
    act(() => vi.advanceTimersByTime(2000));
    expect(btn.getAttribute('data-state')).toBe('ready');
  });

  it('shows Sync failed · Retry when the sync fails, and retries on click', async () => {
    const onSync = vi.fn().mockRejectedValueOnce(new Error('no')).mockResolvedValueOnce(undefined);
    render(<SyncButton onSync={onSync} />);
    const btn = screen.getByRole('button', { name: 'Sync now' });
    await act(async () => fireEvent.click(btn));
    expect(btn.getAttribute('data-state')).toBe('failed');
    expect(screen.getByRole('button', { name: 'Sync failed · Retry' })).toBe(btn);
    await act(async () => fireEvent.click(btn));
    expect(onSync).toHaveBeenCalledTimes(2);
    expect(btn.getAttribute('data-state')).toBe('done');
  });

  it('keeps one width: every label sits in the same cell, only the current one visible', () => {
    render(<SyncButton onSync={() => undefined} />);
    const btn = screen.getByRole('button');
    expect(width(btn)).toEqual(['Sync now', 'Syncing…', 'Synced just now', 'Sync failed · Retry']);
    expect([...btn.querySelectorAll('span.invisible')]).toHaveLength(3);
  });

  it('follows a run started elsewhere, and says how it ended', () => {
    const { rerender } = render(<SyncButton onSync={() => undefined} running={false} />);
    rerender(<SyncButton onSync={() => undefined} running />);
    const btn = screen.getByRole('button');
    expect(btn.getAttribute('data-state')).toBe('syncing');
    rerender(<SyncButton onSync={() => undefined} running={false} failed />);
    expect(btn.getAttribute('data-state')).toBe('failed');
  });
});

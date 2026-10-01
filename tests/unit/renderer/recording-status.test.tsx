// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadStatus, localRecordingStatus, serverRecordingStatus } from '../../../shared/recording-status';
import type { LocalRecording, Transfer } from '../../../shared/types';
import { DownloadStatusView, RecordingStatusView } from '../../../src/modules/meet/RecordingStatus';

/**
 * A recording's status on screen (worksuite-desktop#89): the step in words, a bar with the measured percentage or
 * one that moves without a number, where it is kept, what to do when stuck, and only the actions that apply.
 */
afterEach(cleanup);

const NOW = Date.parse('2026-10-01T12:00:00Z');
const rec = (o: Partial<LocalRecording> = {}): LocalRecording => ({
  id: 'r1', meeting: 'm', title: 'Board', state: 'uploading', error: null, failedAt: null, bytes: 300, uploaded: 0,
  startedAt: '2026-10-01T11:00:00Z', endedAt: '2026-10-01T11:59:00Z', durationMs: 1000, fileName: 'Board.webm', driveFileId: null,
  deleteAfter: null, recovered: false, stepAt: '2026-10-01T11:59:30Z', transferId: 't1', ...o,
});
const tr = (o: Partial<Transfer> = {}): Transfer => ({
  id: 't1', direction: 'upload', name: 'Board.webm', source: '/x', destination: 'WorkSuite Files', bytes: 0, total: 300 * 1024 * 1024, state: 'running',
  speed: 0, error: null, createdAt: '2026-10-01T11:59:00Z', movedAt: '2026-10-01T11:59:59Z', ...o,
});

describe('a recording status', () => {
  it('uploading: the measured percentage, size and time left, with Pause and Cancel transfer', () => {
    const on = { pause: vi.fn(), cancel: vi.fn(), resume: vi.fn() };
    render(<RecordingStatusView status={localRecordingStatus(rec(), tr({ bytes: 150 * 1024 * 1024, speed: 1024 * 1024 }), NOW)} on={on} />);
    expect(screen.getByText('Uploading to Drive')).toBeTruthy();
    expect(screen.getByText('Saved locally')).toBeTruthy();
    const bar = screen.getByRole('progressbar', { name: 'Uploading to Drive' });
    expect(bar.getAttribute('aria-valuenow')).toBe('50');
    expect(bar.getAttribute('data-indeterminate')).toBeNull();
    expect(screen.getByText(/50% · 150 MB of 300 MB · about 3 min left/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Resume' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel transfer' }));
    expect(on.pause).toHaveBeenCalledOnce();
    expect(on.cancel).toHaveBeenCalledOnce();
  });

  it('finalizing: a bar that moves without a number, never a made-up percentage', () => {
    render(<RecordingStatusView status={localRecordingStatus(rec({ state: 'processing', transferId: null }), null, NOW)} on={{}} />);
    expect(screen.getByText('Finalizing')).toBeTruthy();
    const bar = screen.getByRole('progressbar', { name: 'Finalizing' });
    expect(bar.getAttribute('aria-valuenow')).toBeNull();
    expect(bar.getAttribute('data-indeterminate')).toBe('true');
    expect(screen.queryByText(/%/)).toBeNull();
  });

  it('paused for the connection says so, with Resume', () => {
    const resume = vi.fn();
    render(<RecordingStatusView status={localRecordingStatus(rec(), tr({ state: 'paused', error: 'The connection was lost. Resume to continue.' }), NOW)} on={{ resume, cancel: vi.fn() }} />);
    expect(screen.getByText('Paused')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toMatch(/connection was lost/);
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
    expect(resume).toHaveBeenCalledOnce();
  });

  it('a stuck upload is an alert with what to do', () => {
    render(<RecordingStatusView status={localRecordingStatus(rec(), tr({ bytes: 10, movedAt: '2026-10-01T11:50:00Z' }), NOW)} on={{ pause: vi.fn(), cancel: vi.fn() }} />);
    expect(screen.getByRole('alert').textContent).toMatch(/Nothing has been uploaded for more than 5 minutes/);
  });

  it('failed: the reason and Try again; ready: Play and Open in Drive, saved in both places', () => {
    const retry = vi.fn();
    const { unmount } = render(<RecordingStatusView status={serverRecordingStatus({ status: 'failed', error: 'The recording file is incomplete.' })} on={{ retry }} />);
    expect(screen.getByText('Failed')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toBe('The recording file is incomplete.');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalledOnce();
    unmount();

    const play = vi.fn();
    render(<RecordingStatusView status={localRecordingStatus(rec({ state: 'ready', driveFileId: 9 }), null, NOW)} on={{ play, openInDrive: vi.fn() }} />);
    expect(screen.getByText('Ready to play')).toBeTruthy();
    expect(screen.getByText('Saved locally')).toBeTruthy();
    expect(screen.getByText('Saved to Drive')).toBeTruthy();
    expect(screen.queryByRole('progressbar')).toBeNull();
    // Only the actions with somewhere to go: Show the file has no handler here.
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Play', 'Open in Drive']);
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    expect(play).toHaveBeenCalledOnce();
  });
});

describe('a recording download', () => {
  it('Downloading with its progress, then Downloaded with Open and Show in folder', () => {
    const { unmount } = render(<DownloadStatusView status={downloadStatus(tr({ direction: 'download', bytes: 30 * 1024 * 1024 }), NOW)!} on={{ pause: vi.fn(), cancel: vi.fn() }} />);
    expect(screen.getByText('Downloading')).toBeTruthy();
    expect(screen.getByRole('progressbar', { name: 'Downloading' }).getAttribute('aria-valuenow')).toBe('10');
    unmount();
    const open = vi.fn();
    const reveal = vi.fn();
    render(<DownloadStatusView status={downloadStatus(tr({ direction: 'download', state: 'done' }), NOW)!} on={{ open, reveal }} />);
    expect(screen.getByText('Downloaded')).toBeTruthy();
    expect(screen.queryByRole('progressbar')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    fireEvent.click(screen.getByRole('button', { name: 'Show in folder' }));
    expect(open).toHaveBeenCalledOnce();
    expect(reveal).toHaveBeenCalledOnce();
  });
});

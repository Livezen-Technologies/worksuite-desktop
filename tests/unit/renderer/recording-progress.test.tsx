// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { LocalRecording, Transfer } from '../../../shared/types';
import { DriveRecordings, RecordingProgress } from '../../../src/modules/meet/RecordingProgress';
const state = vi.hoisted(() => ({ local: [] as LocalRecording[], transfers: [] as Transfer[], downloads: {} as Record<string, string>, call: vi.fn(async (_channel: string, _input: unknown) => undefined), navigate: vi.fn(), get: vi.fn() }));
vi.mock('../../../src/core/bridge', () => ({ call: state.call, errorMessage: String }));
vi.mock('../../../src/core/api', () => ({ apiGet: state.get, apiPost: vi.fn() }));
vi.mock('../../../src/core/tab-context', () => ({ useTab: () => ({ navigate: state.navigate }) }));
vi.mock('../../../src/modules/meet/recordings', () => ({
  useLocalRecordings: () => state.local, useTransfers: () => state.transfers, useRecordingDownloads: () => state.downloads,
  transferAct: (channel: string, id: string) => () => state.call(channel, { id }),
}));
const recording = { id: 42, client_id: 'capture-1', title: 'Board', created_at: '2026-10-02', size: null, ready: false, status: 'uploading' as const, method: 'local' as const, drive_file_id: null };
const local = { id: 'capture-1', title: 'Board', state: 'uploading', fileName: 'Board.mp4', bytes: 1000, driveFileId: null, transferId: 'upload-1', stepAt: new Date().toISOString() } as LocalRecording;
const transfer = { id: 'upload-1', direction: 'upload', state: 'running', bytes: 500, total: 1000, speed: 100, movedAt: new Date().toISOString() } as Transfer;
function show(element: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<QueryClientProvider client={client}>{element}</QueryClientProvider>);
}
beforeEach(() => { state.local = []; state.transfers = []; state.downloads = {}; vi.clearAllMocks(); });
afterEach(cleanup);
it('joins the server row to measured local progress and dispatches pause and cancel', () => {
  state.local = [local]; state.transfers = [transfer];
  show(<RecordingProgress recording={recording} />);
  expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('50');
  expect(screen.getByText('Saved locally')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
  fireEvent.click(screen.getByRole('button', { name: 'Cancel transfer' }));
  expect(state.call).toHaveBeenCalledWith('transfers:pause', { id: 'upload-1' });
  expect(state.call).toHaveBeenCalledWith('transfers:cancel', { id: 'upload-1' });
});
it('tracks a Drive download independently from verified playback readiness', () => {
  state.transfers = [{ ...transfer, id: 'download-1', direction: 'download', fileId: '9', state: 'done' }];
  show(<RecordingProgress recording={{ ...recording, status: 'ready', ready: true, playable: true, drive_file_id: 9 }} />);
  expect(screen.getByText('Downloaded')).toBeTruthy();
  expect(screen.getByText('Ready to play')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Play' }));
  expect(state.navigate).toHaveBeenCalledWith('/files?file=9&play=1');
});
it('never enables Play for an unverified stored video', () => {
  show(<RecordingProgress recording={{ ...recording, status: 'ready', drive_file_id: 9, playable: false }} />);
  expect(screen.queryByRole('button', { name: 'Play' })).toBeNull();
  expect(screen.getByText('Saved to Drive')).toBeTruthy();
  expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBeNull();
});
it('shows a pending capture in Drive before it has a Drive file, without duplicate rows', async () => {
  state.local = [local]; state.transfers = [transfer]; state.get.mockResolvedValue({ recordings: [recording] });
  show(<DriveRecordings />);
  await screen.findByRole('heading', { name: 'Meeting recordings' });
  await vi.waitFor(() => expect(screen.getAllByText('Board')).toHaveLength(1));
  expect(screen.getByText('Uploading to Drive')).toBeTruthy();
});

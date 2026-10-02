// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { apiPost } from '../../../src/core/api';
import { MediaViewer } from '../../../src/modules/files/MediaViewer';
import type { DriveFile } from '../../../src/modules/files/api';
const mocks = vi.hoisted(() => ({ get: vi.fn(), load: vi.fn() }));
vi.mock('../../../src/core/api', () => ({ apiUrl: (path: string) => path, apiGet: mocks.get, apiPost: vi.fn(async () => ({})), apiPut: vi.fn(async () => ({})), apiDelete: vi.fn(async () => ({})) }));
vi.mock('../../../src/modules/files/ctx', () => ({ useDrive: () => ({ download: vi.fn() }) }));
const file = { id: 42, name: 'Recording.mp4', extension: 'mp4', size: 1024, access: { capabilities: ['download'] } } as DriveFile;
const opened = (state: string) => ({ state, file: { id: 42, name: file.name, tags: [], description: null }, media: { kind: 'video', duration_ms: 60000 }, urls: state === 'ready' ? { source: '/api/drive/stream/test' } : {}, jobs: [], ffmpeg: true, tracks: [], markers: [] });
function mount(state: string, extra: Record<string, unknown> = {}) {
  mocks.get.mockResolvedValue({ ...opened(state), ...extra });
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MediaViewer files={[file]} start={0} onClose={() => {}} /></QueryClientProvider>);
}
beforeEach(() => { vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {}); vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {}); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); mocks.get.mockReset(); });
it('shows Preparing Video until the recording can play', async () => {
  const { container } = mount('probing');
  await screen.findByText('Preparing Video');
  expect(container.querySelector('video')).toBeNull();
});
it('streams through the Drive source and offers retry on playback failure', async () => {
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(mocks.load);
  const { container } = mount('ready');
  await waitFor(() => expect(container.querySelector('video')).toBeTruthy());
  const video = container.querySelector('video')!;
  expect(video.getAttribute('src')).toContain('/api/drive/stream/test');
  expect(screen.getByRole('combobox', { name: 'Speed' })).toBeTruthy();
  fireEvent.error(video);
  expect(screen.getByRole('alert').textContent).toContain('Check your connection');
  fireEvent.click(screen.getByRole('button', { name: 'Retry playback' }));
  expect(mocks.load).toHaveBeenCalledOnce();
  expect(screen.queryByRole('alert')).toBeNull();
});

it('shows a failed job and retries it without removing the original download actions', async () => {
  mount('failed', { media: null, jobs: [{ id: 8, kind: 'probe', state: 'failed', progress: 0, error: 'The worker stopped.' }] });
  await screen.findByText('Failed');
  expect(screen.getByRole('button', { name: 'Download Original' })).toBeTruthy();
  expect(screen.getAllByRole('button', { name: 'Open locally' }).length).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole('button', { name: 'Retry preparation' }));
  await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/drive/media/42/prepare', { what: 'probe' }));
});

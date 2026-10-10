// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';

/**
 * The photo viewer (VWR-E-02, 03, 07, 08, 16, 18) and the Sync conflicts screen (DSK-03), on this computer.
 */
vi.mock('../../../src/core/api', async (orig) => {
  const real = await orig<typeof CoreApi>();
  const request = vi.fn();
  const via = (method: string) => async (path: string, a?: unknown) => (await request(method, path, method === 'GET' ? { query: a } : { body: a })).data;
  return { ...real, request, apiGet: via('GET'), apiPost: via('POST'), apiPut: via('PUT'), apiDelete: via('DELETE') };
});
vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(async () => null), on: () => () => undefined, hasDesktop: () => true, errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)), isMac: false, platform: 'linux', registerDropped: vi.fn() }));

const { request } = await import('../../../src/core/api');
const { call } = await import('../../../src/core/bridge');
const { ImageViewer } = await import('../../../src/modules/files/image/Viewer');
const { SyncConflicts } = await import('../../../src/modules/files/SyncConflicts');
const { DriveCtx } = await import('../../../src/modules/files/ctx');

const access = { level: 'edit', owner: true, via: 'owner', can_download: true, capabilities: ['upload_version', 'download', 'edit', 'share'] };
const files = [
  { id: 5, name: 'ella-sunrise.jpg', extension: 'jpg', size: 100, folder_id: 2, version: 3, access },
  { id: 6, name: 'scan.tif', extension: 'tif', size: 100, folder_id: 2, version: 1, access },
] as never[];

function opened(id: number) {
  return {
    file: { id, name: id === 5 ? 'ella-sunrise.jpg' : 'scan.tif', extension: id === 5 ? 'jpg' : 'tif', mime_type: null, size: 100, folder_id: 2, version: 3, created_at: null, updated_at: null, description: null },
    image: { width: 2400, height: 1600 },
    exif: { camera: 'Canon EOS R6', gps: { lat: 7.2906, lng: 80.6337, alt: null } },
    source: '/media/abc',
    editable: id === 5,
    needs: null,
    recipe: null,
    neighbours: [],
    versions: [{ id: 1, version: 3, size: 1, note: null, author: null, created_at: null, editable: false, summary: null }],
    rating: { mine: 2, average: 3.5, count: 2 },
    tags: ['campaign'],
    can: { edit: true, rate: true, tag: true, comment: true, download: true },
    editor: { tools: [], ai: { enabled: false, actions: [] } },
  };
}

function wrap(node: ReactNode, d: Record<string, unknown> = {}) {
  const drive = new Proxy(d, { get: (t, k) => (k in t ? t[k as string] : vi.fn()) });
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <DriveCtx.Provider value={drive as never}>{node}</DriveCtx.Provider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.mocked(request).mockReset();
  vi.mocked(call).mockReset();
});

describe('the photo viewer', () => {
  it('shows the version, camera and place, rates with Alt+number, and turns for a look with Save as new version', async () => {
    vi.mocked(request).mockImplementation(async (method: string, path: string) => ({ data: path.startsWith('/api/drive/image/') && method === 'GET' ? opened(Number(path.split('/').pop())) : { version: 4, method: 'lossless', rating: { mine: 4 } }, offline: false, cachedAt: null }) as never);
    const onEdit = vi.fn();
    wrap(<ImageViewer files={files} start={0} onClose={vi.fn()} onEdit={onEdit} />);
    expect(await screen.findByText('v3')).toBeTruthy();
    expect(screen.getByText('Canon EOS R6')).toBeTruthy();
    expect(screen.getByText('7.29060, 80.63370')).toBeTruthy();
    expect(screen.getByRole('radio', { name: '2 stars (Alt+2)' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.keyDown(window, { key: '4', altKey: true });
    await waitFor(() => expect(vi.mocked(request)).toHaveBeenCalledWith('PUT', '/api/drive/image/5/rating', { body: { stars: 4 } }));
    fireEvent.keyDown(window, { key: 'r' });
    fireEvent.click(await screen.findByRole('button', { name: 'Save as new version' }));
    await waitFor(() => expect(vi.mocked(request)).toHaveBeenCalledWith('POST', '/api/drive/image/5/rotate', { body: { rotate: 90, flip_h: false, flip_v: false, base_version: 3 } }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove location' }));
    await waitFor(() => expect(vi.mocked(request)).toHaveBeenCalledWith('POST', '/api/drive/image/5/strip-location', { body: { base_version: 3 } }));
    fireEvent.keyDown(window, { key: 'e' });
    expect(onEdit).toHaveBeenCalled();
  });

  it('disables Edit photo with a reason for a format it cannot edit', async () => {
    vi.mocked(request).mockImplementation(async (_m: string, path: string) => ({ data: opened(Number(path.split('/').pop())), offline: false, cachedAt: null }) as never);
    wrap(<ImageViewer files={files} start={1} onClose={vi.fn()} onEdit={vi.fn()} />);
    await screen.findByText('v3');
    const edit = screen.getByRole('button', { name: 'Edit photo' }) as HTMLButtonElement;
    expect(edit.disabled).toBe(true);
    expect(edit.parentElement?.getAttribute('title')).toMatch(/TIF like this cannot be edited/);
  });
});

describe('Sync conflicts', () => {
  it('lists the server’s conflicts and decides one', async () => {
    vi.mocked(call).mockImplementation((async (ch: string) => {
      if (ch === 'sync:conflicts') return [{ id: 3, fileId: 5, fileName: 'ella-sunrise.jpg', copyFileId: 77, copyName: 'ella (conflicted copy).jpg', deviceName: 'MacBook', baseVersion: 3, serverVersion: 4, serverSize: 10, localSize: 12, serverUpdatedAt: null, createdAt: null }];
      if (ch === 'sync:resolveConflict') return { message: 'Your device’s version is now current.' };
      return null;
    }) as never);
    wrap(<SyncConflicts focus />);
    fireEvent.click(await screen.findByRole('button', { name: 'Keep mine as v5' }));
    await waitFor(() => expect(vi.mocked(call)).toHaveBeenCalledWith('sync:resolveConflict', { id: 3, resolution: 'keep_mine' }));
    expect(screen.getByText(/kept as “ella \(conflicted copy\)\.jpg”/)).toBeTruthy();
  });
});

// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';

vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), request: vi.fn() }));
vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(async () => null), on: () => () => undefined, hasDesktop: () => true, errorMessage: (e: unknown) => String(e), isMac: false, platform: 'linux', registerDropped: vi.fn() }));
vi.mock('../../../src/core/tab-context', () => ({ useTab: () => ({ query: new URLSearchParams(), go: vi.fn(), openLink: vi.fn() }), useTabTitle: () => undefined }));

const { request } = await import('../../../src/core/api');
const { Explorer } = await import('../../../src/modules/files/Explorer');
const { DriveCtx } = await import('../../../src/modules/files/ctx');

const page = (folder: object | null) => ({ data: { view: 'folder', files: [{ id: 1, name: 'Plan.docx', extension: 'docx', size: 2048, folder_id: 5, version: 1, updated_at: null, access: null }], folders: [], total: 1, page: 1, per_page: 100, folder, breadcrumb: [] }, offline: false, cachedAt: null });

function mount() {
  const d = new Proxy({ folderId: null, officeRouting: { types: null, legacy: false }, refresh: vi.fn() }, { get: (t, k) => (k in t ? (t as Record<string, unknown>)[k as string] : vi.fn()) });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <DriveCtx.Provider value={d as never}>
        <Explorer place={{ view: 'folder', folder: null } as never} active onPlace={() => undefined} ask={null} initialQ="" />
      </DriveCtx.Provider>
    </QueryClientProvider>,
  );
  return d;
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.mocked(request).mockReset();
});

describe("Drive's toolbar", () => {
  it('Refresh asks the server again and shows it is working', async () => {
    vi.mocked(request).mockResolvedValue(page(null) as never);
    const d = mount();
    await screen.findByText('Plan.docx');
    const calls = vi.mocked(request).mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(d.refresh).toHaveBeenCalled();
    await waitFor(() => expect(vi.mocked(request).mock.calls.length).toBeGreaterThan(calls));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh' }).getAttribute('aria-busy')).toBe('false'));
  });

  it('Details opens a panel even with nothing selected, and closes it again', async () => {
    vi.mocked(request).mockResolvedValue(page(null) as never);
    mount();
    await screen.findByText('Plan.docx');
    const details = () => screen.getByRole('button', { name: 'Details' });
    if (details().getAttribute('aria-pressed') === 'true') fireEvent.click(details());
    expect(screen.queryByRole('complementary', { name: 'Details' })).toBeNull();
    fireEvent.click(details());
    expect(screen.getByRole('complementary', { name: 'Details' })).toBeTruthy();
    expect(screen.getByText(/Select a file or folder/)).toBeTruthy();
    fireEvent.click(details());
    expect(screen.queryByRole('complementary', { name: 'Details' })).toBeNull();
  });
});

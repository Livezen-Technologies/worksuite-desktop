// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';

/**
 * The Images view (VWR-E-07, VWR-E-15): an edited picture says "Edited · vN", my stars show, and the list can be
 * narrowed to my rating and a tag. And the AI panel names the organization's provider (AI-02).
 */
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), request: vi.fn() }));
vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(async () => null), on: () => () => undefined, hasDesktop: () => true, errorMessage: (e: unknown) => String(e), isMac: false, platform: 'linux', registerDropped: vi.fn() }));
vi.mock('../../../src/core/tab-context', () => ({ useTab: () => ({ query: new URLSearchParams(), go: vi.fn(), openLink: vi.fn() }), useTabTitle: () => undefined }));

const { request } = await import('../../../src/core/api');
const { Explorer } = await import('../../../src/modules/files/Explorer');
const { DriveCtx } = await import('../../../src/modules/files/ctx');
const { AiPanel } = await import('../../../src/modules/files/image/AiPanel');
const { blankRecipe } = await import('../../../src/modules/files/image/recipe');

const rows = [
  { id: 1, name: 'ella-sunrise.jpg', extension: 'jpg', size: 2048, folder_id: null, version: 3, updated_at: null, access: null, edited: true, rating: { mine: 4, average: 4 } },
  { id: 2, name: 'harbour.jpg', extension: 'jpg', size: 2048, folder_id: null, version: 1, updated_at: null, access: null, edited: false, rating: { mine: null, average: null } },
];

function mount() {
  const d = new Proxy({ folderId: null, officeRouting: { types: null, legacy: false }, refresh: vi.fn() }, { get: (t, k) => (k in t ? (t as Record<string, unknown>)[k as string] : vi.fn()) });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <DriveCtx.Provider value={d as never}>
        <Explorer place={{ view: 'image', folder: null } as never} active onPlace={() => undefined} ask={null} initialQ="" />
      </DriveCtx.Provider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.mocked(request).mockReset();
});

describe('the Images view', () => {
  it('marks an edited picture with its version and shows my stars', async () => {
    vi.mocked(request).mockResolvedValue({ data: { view: 'image', files: rows, total: 2, page: 1, per_page: 100 }, offline: false, cachedAt: null } as never);
    mount();
    await screen.findByText('ella-sunrise.jpg');
    expect(screen.getAllByText('Edited · v3').length).toBeGreaterThan(0);
    expect(screen.queryByText('Edited · v1')).toBeNull();
    expect(screen.getAllByLabelText('Rated 4 of 5').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Grid view' }));
    expect(screen.getAllByText('Edited · v3').length).toBeGreaterThan(0);
  });

  it('asks for pictures I rated at least so many stars, and with a tag', async () => {
    vi.mocked(request).mockResolvedValue({ data: { view: 'image', files: rows, total: 2, page: 1, per_page: 100 }, offline: false, cachedAt: null } as never);
    mount();
    await screen.findByText('ella-sunrise.jpg');
    fireEvent.change(screen.getByRole('textbox', { name: 'Filter by tag' }), { target: { value: 'campaign' } });
    await waitFor(() => expect(vi.mocked(request).mock.calls.some(([, , o]) => (o as { query?: Record<string, unknown> })?.query?.tag === 'campaign')).toBe(true));
    const query = vi.mocked(request).mock.calls.map(([, , o]) => (o as { query?: Record<string, unknown> })?.query).filter(Boolean);
    expect(query.every((q) => q!.min_rating === undefined)).toBe(true);
  });
});

describe('the AI panel', () => {
  it('names the organization’s provider, and the one an answer came from', async () => {
    vi.mocked(request).mockResolvedValue({ data: { action: 'alt_text', text: 'Sunrise over hills', provider: 'WorkSuite AI · Company provider' }, offline: false, cachedAt: null } as never);
    render(<AiPanel fileId={5} ai={{ available: true, provider_label: 'WorkSuite AI · Org default', actions: ['alt_text'] }} recipe={blankRecipe()} picture={{ w: 10, h: 10 }} makeImage={async () => new Blob(['x'])} onPreview={vi.fn()} onApply={vi.fn()} onEditPanel={vi.fn()} />);
    expect(screen.getByTestId('ai-provider').textContent).toBe('WorkSuite AI · Org default');
    fireEvent.click(screen.getByRole('button', { name: 'Write alt text' }));
    expect(await screen.findByText('Sunrise over hills')).toBeTruthy();
    expect(screen.getByTestId('ai-provider').textContent).toBe('WorkSuite AI · Company provider');
  });
});

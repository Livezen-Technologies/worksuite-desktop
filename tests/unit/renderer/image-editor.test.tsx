// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';
import type * as ImageApi from '../../../src/modules/files/image/api';

/**
 * The desktop photo editor (Drive ENH-03 P11; EDT-E-02…05, SAV-01/05, AI-01, DSK-01/02): the rail in the SRS's order
 * with only the tools the server allows, the 320 px panel, the save dialog and its 409, and the offline status.
 */
vi.mock('../../../src/core/api', async (orig) => {
  const real = await orig<typeof CoreApi>();
  const request = vi.fn();
  const via = (method: string) => async (path: string, a?: unknown) => (await request(method, path, method === 'GET' ? { query: a } : { body: a })).data;
  return { ...real, request, apiGet: via('GET'), apiPost: via('POST'), apiPut: via('PUT'), apiDelete: via('DELETE') };
});
vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(async () => null), on: () => () => undefined, hasDesktop: () => true, errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)), isMac: false, platform: 'linux', registerDropped: vi.fn() }));
vi.mock('../../../src/modules/files/image/api', async (orig) => ({ ...(await orig<typeof ImageApi>()), saveVersion: vi.fn() }));

const { request, ApiError } = await import('../../../src/core/api');
const { call } = await import('../../../src/core/bridge');
const { app } = await import('../../../src/core/app-state');
const imageApi = await import('../../../src/modules/files/image/api');
const { default: Editor } = await import('../../../src/modules/files/image/Editor');

const RAIL = ['Select', 'Crop', 'Adjust', 'Filters', 'Area', 'Text', 'Shapes', 'Stickers', 'Frames', 'Draw', 'Mark', 'Redact'];

function fakeContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const target: Record<string, unknown> = {
    canvas,
    getImageData: (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(Math.max(1, w * h) * 4), width: w, height: h }),
    measureText: (t: string) => ({ width: t.length * 8 }),
    createLinearGradient: () => ({ addColorStop: () => undefined }),
  };
  return new Proxy(target, { get: (t, k) => (k in t ? t[k as string] : () => undefined), set: (t, k, v) => ((t[k as string] = v), true) }) as unknown as CanvasRenderingContext2D;
}

function open(over: Partial<ImageApi.ImageOpen> = {}): ImageApi.ImageOpen {
  return {
    file: { id: 5, name: 'ella-sunrise.jpg', extension: 'jpg', mime_type: 'image/jpeg', size: 1800000, folder_id: 2, version: 3, created_at: null, updated_at: null, description: null, folder_path: 'Marketing/Campaign 2026' },
    image: { width: 2400, height: 1600 },
    exif: null,
    source: '/media/abc',
    editable: true,
    needs: null,
    recipe: null,
    neighbours: [],
    versions: [1, 2, 3].map((v) => ({ id: v * 10, version: v, size: 100, note: null, author: 'Hasarinda', created_at: null, editable: false, summary: null })),
    can: { edit: true, upload_here: true, comment: true, download: true, restore: true },
    editor: { tools: ['select', 'crop', 'adjust', 'filters', 'area', 'text', 'shapes', 'stickers', 'frames', 'draw', 'mark', 'redact'], ai: { enabled: false, actions: [] }, saving: { format: 'same', quality: 85, keep_layers: true, strip_gps: true } },
    ...over,
  };
}

const file = { id: 5, name: 'ella-sunrise.jpg', extension: 'jpg', size: 1800000, folder_id: 2, version: 3, access: { level: 'edit', owner: false, via: 'direct', can_download: true, capabilities: ['upload_version', 'download', 'edit'] } } as never;

function answer(o: ImageApi.ImageOpen) {
  vi.mocked(request).mockImplementation(async (_m: string, path: string) => {
    if (path === '/api/drive/image/5') return { data: o, offline: false, cachedAt: null } as never;
    if (path.startsWith('/api/drive/image/libraries')) return { data: { libraries: {} }, offline: false, cachedAt: null } as never;
    if (path.startsWith('/api/drive/image/presets')) return { data: { presets: [] }, offline: false, cachedAt: null } as never;
    return { data: {}, offline: false, cachedAt: null } as never;
  });
}

function mount() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <Editor file={file} onClose={vi.fn()} onSwitch={vi.fn()} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
    return fakeContext(this);
  } as never);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (cb: BlobCallback) {
    cb(new Blob(['pixels'], { type: 'image/jpeg' }));
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,AA==');
  (globalThis as { createImageBitmap?: unknown }).createImageBitmap = vi.fn(async () => ({ width: 2400, height: 1600, close: () => undefined }));
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new Blob(['jpeg']), { status: 200 })));
  app.set({ status: { network: 'ONLINE' } as never });
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.mocked(request).mockReset();
  vi.mocked(call).mockReset();
  vi.unstubAllGlobals();
});

describe('the photo editor', () => {
  it('lists the tools in the SRS’s order, a 320 px panel with Layers and Export, and no AI when the server says none', async () => {
    answer(open());
    mount();
    const rail = await screen.findByRole('navigation', { name: 'Tools' });
    expect(within(rail).getAllByRole('button').map((b) => b.textContent)).toEqual(RAIL);
    expect(screen.queryByRole('button', { name: 'AI' })).toBeNull();
    const panel = screen.getByRole('complementary', { name: 'Adjust options' });
    expect(panel.className).toContain('w-[320px]');
    expect(within(panel).getAllByRole('tab').map((t) => t.textContent)).toEqual(['Adjust', 'Layers', 'Export']);
    expect(screen.getByText('ella-sunrise.jpg')).toBeTruthy();
    expect(await screen.findByText('Marketing › Campaign 2026')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Version 3 · compare versions' }).textContent).toBe('v3');
  });

  it('leaves out tools the organization turned off, and pins AI at the bottom when it is on', async () => {
    answer(open({ editor: { tools: ['select', 'crop', 'text'], ai: { enabled: true, actions: ['alt_text', 'suggest'] } } }));
    mount();
    const rail = await screen.findByRole('navigation', { name: 'Tools' });
    await waitFor(() => expect(within(rail).getAllByRole('button').map((b) => b.textContent)).toEqual(['Select', 'Crop', 'Text', 'AI']));
  });

  it('marks unsaved changes, and undo takes them back', async () => {
    answer(open());
    mount();
    const slider = await screen.findByRole('slider', { name: 'Contrast' });
    await waitFor(() => expect(screen.getByRole('img', { name: 'The picture, with your edits' }).className).not.toContain('invisible'));
    fireEvent.change(slider, { target: { value: '20' } });
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Unsaved changes'));
    fireEvent.pointerUp(slider);
    await waitFor(() => expect((screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect((screen.getByRole('slider', { name: 'Contrast' }) as HTMLInputElement).value).toBe('0'));
  });

  it('saves as the next version from one dialog, and on a 409 says who saved first and offers the next number (SAV-05)', async () => {
    answer(open());
    vi.mocked(imageApi.saveVersion).mockRejectedValueOnce(new ApiError(409, 'Somebody saved a newer version.', null, { code: 'IMAGE_VERSION_CONFLICT', base_version: 3, current_version: 4, saved_by: { id: 9, name: 'Kavindi' }, saved_at: '2026-10-10 13:38:00' }));
    vi.mocked(imageApi.saveVersion).mockResolvedValueOnce({ saved: true, version: 5 });
    mount();
    const slider = await screen.findByRole('slider', { name: 'Contrast' });
    await waitFor(() => expect(screen.getByRole('img', { name: 'The picture, with your edits' }).className).not.toContain('invisible'));
    fireEvent.change(slider, { target: { value: '20' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save to Drive' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('textbox', { name: 'Version note' })).toHaveProperty('value', 'Adjusted contrast');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save as v4' }));
    const again = await screen.findByRole('alert');
    expect(again.textContent).toContain('Kavindi saved v4');
    expect(again.textContent).toContain('Your save becomes v5');
    expect(vi.mocked(imageApi.saveVersion).mock.calls[0]![1]).toMatchObject({ baseVersion: 3, stripGps: true });
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Save as v5' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Saved as v5'));
    expect(vi.mocked(imageApi.saveVersion).mock.calls[1]![1]).toMatchObject({ baseVersion: 4 });
    const recipe = JSON.parse(vi.mocked(imageApi.saveVersion).mock.calls[1]![1].recipe!);
    expect(recipe).toMatchObject({ schema: 2, base_version: 3 });
    expect(recipe.adjust.contrast).toBe(20);
  });

  it('offline, edits a synced picture and says it will upload as the next version (DSK-02)', async () => {
    vi.mocked(call).mockImplementation((async (ch: string) => {
      if (ch === 'image:localInfo') return { synced: true, version: 3, canUpload: true, paused: false, pending: null };
      if (ch === 'image:localRead') return new Uint8Array([1, 2, 3]);
      return null;
    }) as never);
    vi.mocked(request).mockRejectedValue(new ApiError(0, 'WorkSuite Desktop could not complete the request.', 'NETWORK_UNREACHABLE'));
    app.set({ status: { network: 'OFFLINE' } as never });
    mount();
    await waitFor(() => expect(screen.getAllByRole('status').some((x) => x.textContent?.includes('Offline · will upload as v4'))).toBe(true));
    expect(screen.getByText('Available offline · synced copy on this computer')).toBeTruthy();
  });

  it('reopens a saved version’s layers on the pixels they were made on (AC-01)', async () => {
    const saved = JSON.stringify({ schema: 2, base_version: 2, filter: { name: 'warm', strength: 40 }, objects: [] });
    answer(open({ recipe: { version: 3, recipe: saved, summary: 'Warm', width: 2400, height: 1600 }, versions: [1, 2, 3].map((v) => ({ id: v * 10, version: v, size: 100, note: null, author: null, created_at: null, editable: v === 3, summary: null })) }));
    mount();
    await screen.findByRole('navigation', { name: 'Tools' });
    fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
    await waitFor(() => expect((screen.getByRole('slider', { name: 'Strength · Warm' }) as HTMLInputElement).value).toBe('40'));
    // The base was fetched: version 2's bytes, not the current picture.
    expect(vi.mocked(fetch).mock.calls.some(([u]) => String(u).includes('/api/files/5/versions/20/download'))).toBe(true);
  });
});

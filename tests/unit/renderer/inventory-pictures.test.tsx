// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';

/**
 * A product's pictures in the product form: a new product keeps them until it
 * is saved; an edit sends each change as it is made; the first is the main one.
 */
const toast = vi.fn();
vi.mock('../../../src/core/toasts', () => ({ toast: (...a: unknown[]) => toast(...a) }));
vi.mock('../../../src/core/bridge', () => ({ errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)) }));
const apiGet = vi.fn();
const apiPost = vi.fn();
const apiPut = vi.fn();
const apiDelete = vi.fn();
const request = vi.fn();
vi.mock('../../../src/core/api', async (orig) => ({
  ...(await orig<typeof CoreApi>()),
  apiGet: (...a: unknown[]) => apiGet(...a),
  apiPost: (...a: unknown[]) => apiPost(...a),
  apiPut: (...a: unknown[]) => apiPut(...a),
  apiDelete: (...a: unknown[]) => apiDelete(...a),
  request: (...a: unknown[]) => request(...a),
}));

const { default: ProductPictures, sendPictures } = await import('../../../src/modules/inventory/ProductPictures');
const { pictureProblem, pictureSrc, shrinkPicture } = await import('../../../src/modules/inventory/api');

const img = (id: number, position: number) => ({ id, file_id: 90 + id, mime: 'image/jpeg', bytes: 100, position, caption: null, main: position === 0, url: `/inventory/products/7/images/${id}/file` });
const file = (name: string, type = 'image/jpeg') => new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], name, { type });

beforeEach(() => {
  for (const f of [apiGet, apiPost, apiPut, apiDelete, request, toast]) f.mockReset();
});
afterEach(cleanup);

function wrap(ui: React.ReactNode) {
  return <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>;
}

function NewProduct({ onChange }: { onChange: (f: File[]) => void }) {
  const [pending, setPending] = useState<File[]>([]);
  return (
    <ProductPictures
      productId={null}
      pending={pending}
      onPending={(f) => {
        setPending(f);
        onChange(f);
      }}
    />
  );
}

describe('product pictures', () => {
  it('reads a picture through the API proxy and refuses what is not one before sending', () => {
    expect(pictureSrc('/inventory/products/7/images/31/file')).toBe('app://bundle/__api/api/inventory/products/7/images/31/file');
    expect(pictureProblem({ name: 'a.svg', type: 'image/svg+xml', size: 10 })).toMatch(/only JPEG, PNG, WebP or GIF/);
    expect(pictureProblem({ name: 'a.png', type: 'image/png', size: 10 })).toBeNull();
  });

  it('a GIF, which may move, goes as it is', async () => {
    const gif = file('spin.gif', 'image/gif');
    expect(await shrinkPicture(gif)).toBe(gif);
  });

  it('a new product keeps its pictures until it is saved, the first the main one', async () => {
    const seen = vi.fn();
    render(wrap(<NewProduct onChange={seen} />));
    const input = screen.getByLabelText('Choose pictures');
    await act(async () => {
      fireEvent.change(input, { target: { files: [file('front.jpg'), file('side.jpg'), file('notes.pdf', 'application/pdf')] } });
    });

    expect(seen).toHaveBeenLastCalledWith([expect.objectContaining({ name: 'front.jpg' }), expect.objectContaining({ name: 'side.jpg' })]);
    expect(toast).toHaveBeenCalledWith('error', expect.stringMatching(/notes\.pdf: only/));
    expect(request).not.toHaveBeenCalled();
    expect(screen.getByText(/They are added when you save/)).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByLabelText('Make side.jpg the main picture'));
    });
    expect(seen).toHaveBeenLastCalledWith([expect.objectContaining({ name: 'side.jpg' }), expect.objectContaining({ name: 'front.jpg' })]);

    await act(async () => {
      fireEvent.click(screen.getByLabelText('Remove front.jpg'));
    });
    expect(seen).toHaveBeenLastCalledWith([expect.objectContaining({ name: 'side.jpg' })]);
  });

  it('an edit sends each change as it is made', async () => {
    apiGet.mockResolvedValue({ images: [img(31, 0), img(32, 1)] });
    apiPost.mockResolvedValue({ images: [img(32, 0), img(31, 1)] });
    apiDelete.mockResolvedValue({ images: [img(31, 0)] });
    render(wrap(<ProductPictures productId={7} pending={[]} onPending={() => undefined} />));
    await waitFor(() => expect(screen.getByText('Main')).toBeTruthy());

    expect(apiGet).toHaveBeenCalledWith('/api/inventory/products/7/images', undefined, expect.anything());
    expect(screen.getAllByRole('img')).toHaveLength(2);
    expect(screen.getByText('Main')).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByLabelText('Make Picture 2 the main picture'));
    });
    expect(apiPost).toHaveBeenCalledWith('/api/inventory/products/7/images/32/main');

    await act(async () => {
      fireEvent.click(screen.getByLabelText('Remove Picture 2'));
    });
    expect(apiDelete).toHaveBeenCalledWith('/api/inventory/products/7/images/31');
  });

  it('sends pictures one at a time and keeps going past one the server refuses', async () => {
    request.mockRejectedValueOnce(new Error('Only pictures can be added')).mockResolvedValueOnce({ data: { images: [img(31, 0)] } });
    const gallery = vi.fn();
    const failed = await sendPictures(7, [file('bad.jpg'), file('good.jpg')], gallery);

    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[1]![0]).toBe('POST');
    expect(request.mock.calls[1]![1]).toBe('/api/inventory/products/7/images');
    expect((request.mock.calls[1]![2] as { body: FormData }).body.get('file')).toBeInstanceOf(Blob);
    expect(failed.map((f) => f.name)).toEqual(['bad.jpg']);
    expect(gallery).toHaveBeenCalledWith([img(31, 0)]);
    expect(toast).toHaveBeenCalledWith('error', 'bad.jpg: Only pictures can be added');
  });
});

// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
const { apiGet } = vi.hoisted(() => ({ apiGet: vi.fn() }));
vi.mock('../../../src/core/api', () => ({ apiGet }));
vi.mock('../../../src/components/LinkedText', () => ({ openAnyLink: vi.fn() }));
import { LinkPreview, MessageLinkPreview } from '../../../src/modules/chat/kit/LinkPreview';
afterEach(() => { cleanup(); apiGet.mockReset(); });

it('loads a server-validated product image instead of the external URL blocked by the shell', async () => {
  const image = 'data:image/png;base64,aW1hZ2U=';
  apiGet.mockResolvedValue({ url: 'https://shop.example/office', title: 'Office 2021', image: 'https://cdn.example/office.png', image_data: image });
  const { container } = render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MessageLinkPreview body="https://shop.example/office" path="/api/chat/widget-admin/link-preview" /></QueryClientProvider>);
  await waitFor(() => expect(container.querySelector('img')?.getAttribute('src')).toBe(image));
  expect(apiGet).toHaveBeenCalledWith('/api/chat/widget-admin/link-preview', { url: 'https://shop.example/office', image: 1 }, expect.any(AbortSignal));
});

describe('thumbnail failures', () => {
  it('keeps the title and description without a broken image, and retries a changed source', () => {
    const preview = { url: 'https://shop.example/office', title: 'Office 2021', description: 'Professional Plus', image: 'https://cdn.example/broken.png' };
    const { container, getByText, rerender } = render(<LinkPreview preview={preview} />);
    fireEvent.error(container.querySelector('img')!);
    expect(container.querySelector('img')).toBeNull();
    expect(getByText('Office 2021')).toBeTruthy();
    expect(getByText('Professional Plus')).toBeTruthy();
    rerender(<LinkPreview preview={{ ...preview, image: 'data:image/png;base64,bmV3' }} />);
    expect(container.querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,bmV3');
  });
});

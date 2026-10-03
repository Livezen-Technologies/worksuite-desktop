// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
vi.mock('../../../src/core/api', () => ({ ApiError: class extends Error {}, apiGet: vi.fn(), request: vi.fn() }));
vi.mock('../../../src/core/app-state', async () => {
  const { createStore } = await import('../../../src/core/store');
  return { app: createStore({ auth: { server: { origin: 'https://one.test' } }, bootstrap: { user: { id: 'u1', organizationId: 'o1' } } }) };
});
import { apiGet, request } from '../../../src/core/api';
import { useLocalFirstQuery } from '../../../src/core/local-first-query';
afterEach(cleanup);
it('renders a saved conversation before a pending network response and then replaces it with fresh data', async () => {
  let resolve: (v: { body: string }) => void = () => undefined;
  vi.mocked(apiGet).mockImplementation(() => new Promise((r) => { resolve = r as typeof resolve; }));
  vi.mocked(request).mockResolvedValue({ data: { body: 'saved' }, offline: true, cachedAt: '2026-10-03' });
  const qc = new QueryClient();
  const { result } = renderHook(() => useLocalFirstQuery<{ body: string }>({ queryKey: ['whatsapp', 'chat', '7'], path: '/api/whatsapp/chats/7', interval: 5000 }), { wrapper: ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider> });
  await waitFor(() => expect(result.current.data?.body).toBe('saved'));
  expect(result.current.isFetching).toBe(true);
  await act(async () => resolve({ body: 'fresh' }));
  await waitFor(() => expect(result.current.data?.body).toBe('fresh'));
});
it('does not overwrite a live response with a slower local read', async () => {
  let resolve: (v: { data: { body: string }; offline: boolean; cachedAt: null }) => void = () => undefined;
  vi.mocked(request).mockImplementation(() => new Promise((r) => { resolve = r as typeof resolve; }));
  vi.mocked(apiGet).mockResolvedValue({ body: 'fresh' });
  const qc = new QueryClient();
  const { result } = renderHook(() => useLocalFirstQuery<{ body: string }>({ queryKey: ['whatsapp', 'chat', '8'], path: '/api/whatsapp/chats/8', interval: 5000 }), { wrapper: ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider> });
  await waitFor(() => expect(result.current.data?.body).toBe('fresh'));
  await act(async () => resolve({ data: { body: 'old' }, offline: true, cachedAt: null }));
  expect(result.current.data?.body).toBe('fresh');
});

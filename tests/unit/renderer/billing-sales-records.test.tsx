// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
vi.mock('../../../src/core/bridge', () => ({ on: () => () => {}, call: vi.fn(), errorMessage: (e: Error) => e.message, hasDesktop: () => true }));
vi.mock('../../../src/core/api', () => ({ apiGet: vi.fn(async () => ({ invoices: [], total: 0, summary: {} })), apiPost: vi.fn(), apiPut: vi.fn(), apiDelete: vi.fn(), request: vi.fn() }));
import { apiGet } from '../../../src/core/api';
import Invoices from '../../../src/modules/billing/Invoices';
afterEach(() => { cleanup(); vi.clearAllMocks(); });
it('loads the exact company and calendar date from supporting sales links, without unrelated outstanding totals', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const props = { org: '7', narrow: null, salesDate: '2026-10-02', outstanding: 99999, currency: 'USD', canCreate: false, canIssue: false, onOpen: vi.fn(), onNew: vi.fn() };
  const view = render(<QueryClientProvider client={client}><Invoices {...props} /></QueryClientProvider>);
  await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/api/billing/invoices', expect.objectContaining({ org: '7', sales_date: '2026-10-02' }), expect.any(AbortSignal)));
  expect(screen.getByText(/Supporting gross sales invoices dated/).textContent).toContain('dated 2026-10-02'); expect(screen.queryByText('Outstanding')).toBeNull();
  view.rerender(<QueryClientProvider client={client}><Invoices {...props} org="8" salesDate="2026-10-03" /></QueryClientProvider>);
  await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/api/billing/invoices', expect.objectContaining({ org: '8', sales_date: '2026-10-03', page: 1 }), expect.any(AbortSignal)));
  expect(screen.getByText(/Supporting gross sales invoices dated/).textContent).toContain('dated 2026-10-03');
});

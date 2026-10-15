// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';
import type * as Bridge from '../../../src/core/bridge';

vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn(), apiDelete: vi.fn(), request: vi.fn() }));
vi.mock('../../../src/core/bridge', async (orig) => ({ ...(await orig<typeof Bridge>()), call: vi.fn(async () => true) }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));

window.matchMedia ??= ((query: string) => ({ matches: false, media: query, onchange: null, addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined, dispatchEvent: () => false })) as typeof window.matchMedia;

const { apiGet, apiPost } = await import('../../../src/core/api');
const { call } = await import('../../../src/core/bridge');
const { toast } = await import('../../../src/core/toasts');
const { app } = await import('../../../src/core/app-state');
const { bulkSummary, exportRequest, normaliseBulk } = await import('../../../src/modules/billing/actions');
const { default: Invoices } = await import('../../../src/modules/billing/Invoices');
const { billingExportPath } = await import('../../../shared/billing');

/*
 * Bulk acts on invoices (SRS-BIL-001 G-13): the server does each one on its
 * own and answers per invoice; the list says how many were done, shows the
 * refused ones with the server's reason, and keeps them chosen. A bulk PDF
 * comes back as one file, downloaded. Exports go through the download
 * manager to an address the main process builds.
 */
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
beforeEach(() => {
  app.set({ status: { network: 'ONLINE' } as never, bootstrap: { permissions: ['billing.view', 'billing.manage'] } as never });
});

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const row = (id: number, number: string | null, status: string) => ({ id, number, status, client: 'Green Leaf Hotels', currency: 'LKR', total: 1000, due: 1000, issue_date: '2026-10-01', due_date: '2026-10-15', days_overdue: 0, project: null, po_number: null });

describe('billing: a bulk answer', () => {
  it('takes the contract’s per-invoice results as they are', () => {
    const r = normaliseBulk({ results: [{ id: 1, ok: true }, { id: 2, ok: false, code: 'approval_required', message: 'Needs approval first.' }], done: 1, refused: 1, file_url: null });
    expect(r.done).toBe(1);
    expect(r.refused).toBe(1);
    expect(r.results[1]).toMatchObject({ id: 2, ok: false, code: 'approval_required', message: 'Needs approval first.' });
    // Counts left out are worked out from the results.
    expect(normaliseBulk({ results: [{ id: 1, ok: 1 }, { id: 2, ok: 0 }, { id: 3, ok: true }] })).toMatchObject({ done: 2, refused: 1 });
  });

  it('reads the older {done, failed} answer of a server before SRS-BIL-001', () => {
    const r = normaliseBulk({ done: [{ id: 1, number: 'INV-1' }], failed: [{ id: 2, number: 'INV-2', why: 'It has payments.' }] });
    expect(r).toEqual({ results: [{ id: 1, ok: true, number: 'INV-1' }, { id: 2, ok: false, number: 'INV-2', message: 'It has payments.' }], done: 1, refused: 1, file_url: null });
    expect(normaliseBulk(null)).toEqual({ results: [], done: 0, refused: 0, file_url: null });
  });

  it('says what happened in one line', () => {
    expect(bulkSummary('issue', { results: [], done: 3, refused: 1 })).toBe('3 invoices issued; 1 refused.');
    expect(bulkSummary('mark_sent', { results: [], done: 1, refused: 0 })).toBe('1 invoice recorded as sent.');
    expect(bulkSummary('pdf', { results: [], done: 2, refused: 0 })).toBe('2 invoices put in one PDF.');
    expect(bulkSummary('cancel', { results: [], done: 0, refused: 2 })).toBe('2 refused.');
    expect(bulkSummary('send', { results: [], done: 0, refused: 0 })).toBe('Nothing was done.');
  });
});

describe('billing: exports', () => {
  it('builds the server’s export address from the screen’s filters, never a path the page wrote', () => {
    const x = exportRequest('invoices', 'xlsx', { org: '2', q: 'green', status: '' });
    expect(x.billingExport).toEqual({ what: 'invoices', format: 'xlsx', org: '2', q: 'green' });
    expect(x.name).toMatch(/^billing-invoices-\d{4}-\d{2}-\d{2}\.xlsx$/);
    expect(billingExportPath(x.billingExport)).toBe('/api/billing/invoices/export?org=2&q=green&format=xlsx');
    expect(billingExportPath(exportRequest({ report: 'aging' }, 'pdf', { org: '2' }).billingExport)).toBe('/api/billing/reports/aging/export?org=2&format=pdf');
    expect(billingExportPath({ what: 'statement', customer: 9, format: 'pdf', from: '2026-07-01', to: '2026-09-30' })).toBe('/api/billing/customers/9/statement?from=2026-07-01&to=2026-09-30&format=pdf');
  });
});

describe('billing: the bulk bar', () => {
  it('issues the chosen ones, shows each refusal with its reason, and keeps the refused chosen', async () => {
    vi.mocked(apiGet).mockResolvedValue({ invoices: [row(1, null, 'draft'), row(2, null, 'draft'), row(3, 'INV-3', 'sent')], total: 3, page: 1, summary: {} });
    vi.mocked(apiPost).mockResolvedValue({ results: [{ id: 1, ok: true, number: 'INV-00401' }, { id: 2, ok: false, code: 'approval_required', message: 'Over LKR 500,000: it needs approval first.' }], done: 1, refused: 1 });
    wrap(<Invoices org="2" narrow={null} outstanding={null} currency={null} canCreate canIssue onOpen={vi.fn()} onNew={vi.fn()} />);

    fireEvent.click(await screen.findByLabelText('Choose Draft #1'));
    fireEvent.click(screen.getByLabelText('Choose Draft #2'));
    const bar = screen.getByRole('toolbar', { name: 'With the chosen invoices' });
    expect(within(bar).getByText('2 selected')).toBeTruthy();
    fireEvent.click(within(bar).getByRole('button', { name: 'Issue' }));
    const confirm = await screen.findByRole('dialog', { name: 'Issue 2 invoices?' });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Issue' }));

    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/billing/invoices/bulk', { ids: [1, 2], action: 'issue' }));
    expect(toast).toHaveBeenCalledWith('success', '1 invoice issued; 1 refused.');
    const results = await screen.findByRole('dialog', { name: 'Issue: 1 done, 1 refused' });
    const items = within(results).getAllByRole('listitem');
    // The refused one first, with the server's reason.
    expect(items[0]!.getAttribute('data-ok')).toBe('0');
    expect(items[0]!.textContent).toContain('Over LKR 500,000: it needs approval first.');
    expect(items[1]!.textContent).toContain('INV-00401');
    fireEvent.click(within(results).getByRole('button', { name: 'Done' }));
    expect(within(screen.getByRole('toolbar', { name: 'With the chosen invoices' })).getByText('1 selected')).toBeTruthy();
  });

  it('downloads the one PDF a bulk PDF makes', async () => {
    vi.mocked(apiGet).mockResolvedValue({ invoices: [row(3, 'INV-3', 'sent'), row(4, 'INV-4', 'paid')], total: 2, page: 1, summary: {} });
    vi.mocked(apiPost).mockResolvedValue({ results: [{ id: 3, ok: true }, { id: 4, ok: true }], done: 2, refused: 0, file_url: '/api/billing/invoices/bulk/files/ab12cd' });
    wrap(<Invoices org="" narrow={null} outstanding={null} currency={null} canCreate={false} canIssue onOpen={vi.fn()} onNew={vi.fn()} />);
    fireEvent.click(await screen.findByLabelText('Choose every invoice on this page'));
    fireEvent.click(within(screen.getByRole('toolbar', { name: 'With the chosen invoices' })).getByRole('button', { name: 'PDFs' }));
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'One PDF of 2 invoices?' })).getByRole('button', { name: 'PDFs' }));
    await waitFor(() => expect(call).toHaveBeenCalledWith('transfers:download', expect.objectContaining({ billingFile: '/api/billing/invoices/bulk/files/ab12cd', open: true })));
    expect(apiPost).toHaveBeenCalledWith('/api/billing/invoices/bulk', { ids: [3, 4], action: 'pdf' });
    // Nothing refused: no results sheet, and the selection is cleared.
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('toolbar', { name: 'With the chosen invoices' })).toBeNull();
  });

  it('cancels with the reason given, and offline offers only the PDF', async () => {
    app.set({ status: { network: 'OFFLINE' } as never });
    vi.mocked(apiGet).mockResolvedValue({ invoices: [row(3, 'INV-3', 'sent')], total: 1, page: 1, summary: {} });
    wrap(<Invoices org="" narrow={null} outstanding={null} currency={null} canCreate={false} canIssue onOpen={vi.fn()} onNew={vi.fn()} />);
    fireEvent.click(await screen.findByLabelText('Choose INV-3'));
    const bar = screen.getByRole('toolbar', { name: 'With the chosen invoices' });
    expect(within(bar).getByRole('button', { name: 'Cancel' })).toHaveProperty('disabled', true);
    expect(within(bar).getByRole('button', { name: 'PDFs' })).toHaveProperty('disabled', false);
  });
});

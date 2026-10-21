// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';

vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(), on: () => () => undefined, errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)), isMac: false, registerDropped: vi.fn() }));
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn(), apiDelete: vi.fn() }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));
vi.mock('../../../src/core/tabs', () => ({ navigate: vi.fn() }));
vi.mock('../../../src/core/app-state', async () => {
  const { createStore } = await import('../../../src/core/store');
  return { app: createStore({ auth: { user: { id: '5' }, server: { origin: 'https://app.worksuite.lk' } }, transfers: [] }) };
});
vi.mock('../../../src/core/access', () => ({ useCanOpen: () => false }));

import { ApiError, apiDelete, apiGet, apiPost, apiPut } from '../../../src/core/api';
import Workspace from '../../../src/modules/tenders/Workspace';
import Competitors from '../../../src/modules/tenders/Competitors';
import { competitorBody, fieldErrors, lowestBid, type Competitor } from '../../../src/modules/tenders/api';

const rival = (over: Partial<Competitor>): Competitor => ({ id: 1, company_name: 'Acme Builders', bid_price: '12500000.00', currency: 'LKR', remarks: null, created_by: { id: 5, name: 'Kamal' }, updated_by: null, created_at: '2026-10-20T10:00:00Z', updated_at: '2026-10-20T10:00:00Z', ...over });

describe('the pieces', () => {
  it('finds the lowest bid', () => {
    expect(lowestBid([rival({ id: 1, bid_price: '300' }), rival({ id: 2, bid_price: '120.50' }), rival({ id: 3, bid_price: '120.50' })])).toBe(2);
    expect(lowestBid([])).toBeNull();
  });
  it('sends the contract body', () => {
    expect(competitorBody({ company_name: ' Acme ', bid_price: '1,250,000.00', currency: 'usd', remarks: '  ' })).toEqual({ company_name: 'Acme', bid_price: '1250000.00', currency: 'USD', remarks: null });
    expect(competitorBody({ company_name: 'A', bid_price: '1', currency: '', remarks: 'x' })).toEqual({ company_name: 'A', bid_price: '1', remarks: 'x' });
  });
  it('reads field errors from a 422 only', () => {
    expect(fieldErrors(new ApiError(422, 'bad', null, { bid_price: ['Must be at least 0.'] }))).toEqual({ bid_price: 'Must be at least 0.' });
    expect(fieldErrors(new ApiError(409, 'not yet', 'tender_not_submitted', null))).toBeNull();
  });
});

describe('the Competitors tab', () => {
  let answer: Record<string, unknown>;
  beforeEach(() => {
    answer = { available: true, reason: null, currency: 'LKR', can: { edit: true }, competitors: [rival({}), rival({ id: 2, company_name: 'Beta Lanka', bid_price: '9800000.00', remarks: 'Late' })] };
    vi.mocked(apiGet).mockReset();
    vi.mocked(apiGet).mockImplementation(async (path: string) => {
      if (path === '/api/tenders/7/competitors') return answer as never;
      throw new Error('unexpected ' + path);
    });
    vi.mocked(apiPost).mockReset();
    vi.mocked(apiPut).mockReset();
    vi.mocked(apiDelete).mockReset();
  });
  afterEach(() => cleanup());

  function mount() {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <Competitors id={7} />
      </QueryClientProvider>,
    );
  }
  const row = (id: number) => document.querySelector<HTMLElement>(`[data-competitor="${id}"]`)!;

  it('lists them by bid price with the lowest marked and prices formatted', async () => {
    mount();
    expect(await screen.findByText('2 competitors')).toBeTruthy();
    const rows = [...document.querySelectorAll('[data-competitor]')].map((r) => r.getAttribute('data-competitor'));
    expect(rows).toEqual(['2', '1']);
    expect(row(2).getAttribute('data-lowest')).toBe('1');
    expect(within(row(2)).getByText('Lowest')).toBeTruthy();
    expect(within(row(1)).queryByText('Lowest')).toBeNull();
    expect(row(2).textContent).toContain('LKR 9,800,000.00');
  });

  it('says why when not yet available', async () => {
    answer = { available: false, reason: 'Competitors can be recorded after the tender is submitted.', currency: 'LKR', can: { edit: true }, competitors: [] };
    mount();
    expect(await screen.findByText('Competitors can be recorded after the tender is submitted.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Add competitor/ })).toBeNull();
  });

  it('offers no changes without can.edit', async () => {
    answer = { ...answer, can: { edit: false } };
    mount();
    await screen.findByText('2 competitors');
    expect(screen.queryByRole('button', { name: /Add competitor/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Edit|^Delete/ })).toBeNull();
  });

  it('adds one in the tender currency and shows a refused field under it', async () => {
    vi.mocked(apiPost).mockRejectedValueOnce(new ApiError(422, 'The given data was invalid.', null, { bid_price: ['The bid price must be at least 0.'] }));
    mount();
    await screen.findByText('2 competitors');
    fireEvent.click(screen.getByRole('button', { name: /Add competitor/ }));
    const dlg = screen.getByRole('dialog', { name: 'Add competitor' });
    expect((within(dlg).getByRole('textbox', { name: 'Currency' }) as HTMLInputElement).value).toBe('LKR');
    fireEvent.change(within(dlg).getByRole('textbox', { name: 'Company' }), { target: { value: 'Gamma' } });
    fireEvent.change(within(dlg).getByRole('textbox', { name: 'Bid price' }), { target: { value: '-1' } });
    await act(async () => {
      fireEvent.click(within(dlg).getByRole('button', { name: 'Save' }));
    });
    expect(apiPost).toHaveBeenCalledWith('/api/tenders/7/competitors', { company_name: 'Gamma', bid_price: '-1', currency: 'LKR', remarks: null });
    expect(within(dlg).getByText('The bid price must be at least 0.')).toBeTruthy();
    vi.mocked(apiPost).mockResolvedValueOnce({ competitor: rival({ id: 3 }) } as never);
    fireEvent.change(within(dlg).getByRole('textbox', { name: 'Bid price' }), { target: { value: '1,000' } });
    await act(async () => {
      fireEvent.click(within(dlg).getByRole('button', { name: 'Save' }));
    });
    expect(apiPost).toHaveBeenLastCalledWith('/api/tenders/7/competitors', { company_name: 'Gamma', bid_price: '1000', currency: 'LKR', remarks: null });
    expect(screen.queryByRole('dialog', { name: 'Add competitor' })).toBeNull();
  });

  it('edits with PUT', async () => {
    vi.mocked(apiPut).mockResolvedValue({ competitor: rival({}) } as never);
    mount();
    await screen.findByText('2 competitors');
    fireEvent.click(within(row(2)).getByRole('button', { name: 'Edit Beta Lanka' }));
    const dlg = screen.getByRole('dialog', { name: 'Edit Beta Lanka' });
    fireEvent.change(within(dlg).getByRole('textbox', { name: 'Remarks' }), { target: { value: 'Disqualified' } });
    await act(async () => {
      fireEvent.click(within(dlg).getByRole('button', { name: 'Save' }));
    });
    expect(apiPut).toHaveBeenCalledWith('/api/tenders/7/competitors/2', { company_name: 'Beta Lanka', bid_price: '9800000.00', currency: 'LKR', remarks: 'Disqualified' });
  });

  it('deletes only after asking', async () => {
    vi.mocked(apiDelete).mockResolvedValue({ id: 1 } as never);
    mount();
    await screen.findByText('2 competitors');
    fireEvent.click(within(row(1)).getByRole('button', { name: 'Delete Acme Builders' }));
    expect(apiDelete).not.toHaveBeenCalled();
    const ask = within(row(1)).getByRole('group', { name: 'Confirm delete' });
    await act(async () => {
      fireEvent.click(within(ask).getByRole('button', { name: 'Delete' }));
    });
    expect(apiDelete).toHaveBeenCalledWith('/api/tenders/7/competitors/1');
  });
});

describe('the tender’s tabs', () => {
  afterEach(() => cleanup());

  it('shows the Competitors tab only once the server says it is available', async () => {
    let available = false;
    vi.mocked(apiGet).mockReset();
    vi.mocked(apiGet).mockImplementation(async (path: string) => {
      if (path === '/api/tenders/7') return { tender: { id: 7, org_id: 1, title: 'Road resurfacing', reference: 'RFQ/7', stage: 'submitted', stage_label: 'Submitted', outcome: 'open', currency: 'LKR' } } as never;
      if (path === '/api/tenders/7/contacts') return { count: 0, items: [], can: { manage: false } } as never;
      if (path === '/api/tenders/7/competitors') return { available, reason: available ? null : 'Not submitted yet.', currency: 'LKR', can: { edit: false }, competitors: available ? [rival({})] : [] } as never;
      throw new Error('unexpected ' + path);
    });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const onTab = vi.fn();
    render(
      <QueryClientProvider client={qc}>
        <Workspace id={7} bands={[]} canManage={false} canApprove={false} tab="competitors" onTab={onTab} onBack={() => undefined} onEdit={() => undefined} />
      </QueryClientProvider>,
    );
    expect(await screen.findByRole('tab', { name: 'Overview' })).toBeTruthy();
    expect(screen.queryByRole('tab', { name: /Competitors/ })).toBeNull();
    available = true;
    await act(async () => {
      await qc.invalidateQueries();
    });
    const tab = await screen.findByRole('tab', { name: 'Competitors · 1' });
    expect(tab.getAttribute('aria-selected')).toBe('true');
    expect(await screen.findByText('1 competitor')).toBeTruthy();
  });
});

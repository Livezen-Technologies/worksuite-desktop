// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';
import type { Ageing as AgeingData, UnpostedDoc } from '../../../src/modules/finance/owed';

vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn(), apiDelete: vi.fn() }));

// jsdom draws no media: the app's theme listener only needs something to ask.
window.matchMedia ??= ((query: string) => ({ matches: false, media: query, onchange: null, addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined, dispatchEvent: () => false })) as typeof window.matchMedia;

const { ApiError, apiGet, apiPost } = await import('../../../src/core/api');
const { app } = await import('../../../src/core/app-state');
const { toasts } = await import('../../../src/core/toasts');
const o = await import('../../../src/modules/finance/owed');
const { default: Ageing } = await import('../../../src/modules/finance/Ageing');
const { default: Unposted } = await import('../../../src/modules/finance/Unposted');

/*
 * Who owes what: the ageing and the documents not in the ledger, drawn from
 * payloads shaped as `Ageing::build()` and `Ageing::unposted()` send them.
 */

const company = { id: 2, name: 'CreativeFX', base_currency: 'LKR', fiscal_year_start_month: 4, books_opened_at: '2026-04-01', has_books: true };

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const zero = { current: '0.00', d1_30: '0.00', d31_60: '0.00', d61_90: '0.00', d90plus: '0.00' };

const RECEIVABLES: AgeingData = {
  as_of: '2026-09-28',
  currency: 'LKR',
  rows: [
    { party_id: 7, party_name: 'Blue Lotus Hotels', buckets: { ...zero, current: '300000.00', d90plus: '1000000.00' }, total: '1300000.00', oldest: 120 },
    { party_id: null, party_name: 'Unattributed', buckets: { ...zero, d1_30: '-25000.00' }, total: '-25000.00', oldest: 12 },
  ],
  documents: [
    { id: 11, number: 'INV-2026-0011', party_id: 7, party_name: 'Blue Lotus Hotels', doc_date: '2026-05-01', due_date: '2026-05-31', currency: 'LKR', total: '1000000.00', open: '1000000.00', open_base: '1000000.00', bucket: 'd90plus', days: 120, is_credit: false },
    { id: 14, number: 'INV-2026-0014', party_id: 7, party_name: 'Blue Lotus Hotels', doc_date: '2026-09-20', due_date: '2026-10-20', currency: 'USD', total: '1000.00', open: '1000.00', open_base: '300000.00', bucket: 'current', days: -22, is_credit: false },
    { id: 15, number: 'CN-2026-0002', party_id: null, party_name: 'Unattributed', doc_date: '2026-09-16', due_date: null, currency: 'LKR', total: '25000.00', open: '-25000.00', open_base: '-25000.00', bucket: 'd1_30', days: 12, is_credit: true },
  ],
  totals: { ...zero, current: '300000.00', d1_30: '-25000.00', d90plus: '1000000.00' },
  total: '1275000.00',
  tie_out: { subledger: '1275000.00', control: '1250000.00', difference: '25000.00', agrees: false, account: { id: 31, code: '1200', name: 'Trade receivables' } },
};

const PAYABLES: AgeingData = {
  as_of: '2026-09-28',
  currency: 'LKR',
  rows: [{ party_id: 4, party_name: 'Ceylon Paper Co', buckets: { ...zero, d31_60: '80000.00' }, total: '80000.00', oldest: 45 }],
  documents: [
    { id: 3, number: 'BILL-88', party_id: 4, party_name: 'Ceylon Paper Co', doc_date: '2026-07-30', due_date: '2026-08-14', currency: 'LKR', total: '90000.00', open: '90000.00', open_base: '90000.00', bucket: 'd31_60', days: 45, is_credit: false },
    { id: 5, number: 'DN-3', party_id: 4, party_name: 'Ceylon Paper Co', doc_date: '2026-08-02', due_date: '2026-08-14', currency: 'LKR', total: '10000.00', open: '-10000.00', open_base: '-10000.00', bucket: 'd31_60', days: 45, is_credit: true },
  ],
  totals: { ...zero, d31_60: '80000.00' },
  total: '80000.00',
  tie_out: { subledger: '80000.00', control: '80000.00', difference: '0.00', agrees: true, account: { id: 52, code: '2100', name: 'Trade payables' } },
};

const UNPOSTED: UnpostedDoc[] = [
  { kind: 'bill', id: 12, number: 'BILL-91', date: '2026-08-30', currency: 'LKR', total: '45000.00', can_post: false, problems: ['August 2026 is locked. Reopen it, or date the bill into an open period.', 'No account is nominated for purchases.'] },
  { kind: 'invoice', id: 12, number: 'INV-2026-0019', date: '2026-09-02', currency: 'USD', total: '1200.00', can_post: true, problems: [] },
  { kind: 'expense_reimbursement', id: 3, number: null, date: null, currency: null, total: '12500.00', can_post: false, problems: ['No bank account is nominated for reimbursements.'] },
  { kind: 'debit_note', id: 4, number: 'DN-4', date: '2026-09-10', currency: 'LKR', total: '3000.00', can_post: true, problems: [] },
];

beforeEach(() => {
  app.set({ bootstrap: { permissions: ['*'] } as never });
  toasts.set({ items: [] });
  vi.mocked(apiGet).mockImplementation(async (path: string) => {
    if (path === '/api/finance/receivables') return RECEIVABLES;
    if (path === '/api/finance/payables') return PAYABLES;
    if (path === '/api/finance/unposted') return { documents: UNPOSTED };
    throw new Error(`unexpected ${path}`);
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('finance owed: the helpers', () => {
  it('keeps every key under the company, and the ageing date in its key', () => {
    expect(o.ageingKey(2, 'receivables', '2026-08-31')).toEqual(['finance', 'c', 2, 'ageing', 'receivables', '2026-08-31']);
    expect(o.unpostedKey(2)).toEqual(['finance', 'c', 2, 'unposted']);
  });

  it('reads with the company and the date, and retries with the company in the body', async () => {
    vi.mocked(apiPost).mockResolvedValueOnce({ ok: true, id: 40, journal_no: 'JE-000040' });
    await o.fetchAgeing(2, 'payables', '2026-08-31');
    expect(apiGet).toHaveBeenCalledWith('/api/finance/payables', { company: 2, as_of: '2026-08-31' }, undefined);
    await o.fetchUnposted(2);
    expect(apiGet).toHaveBeenCalledWith('/api/finance/unposted', { company: 2 }, undefined);
    const r = await o.retryPosting(2, { kind: 'debit_note', id: 4 });
    expect(apiPost).toHaveBeenCalledWith('/api/finance/unposted/debit_note/4', { company_id: 2 });
    expect(o.postedSentence(r)).toBe('Posted as JE-000040');
    expect(o.postedSentence(undefined)).toBe('Posted');
  });

  it('spells the tie-out out: the verdict, the difference, and what was compared', () => {
    const bad = o.tieSentences(RECEIVABLES.tie_out, 'LKR');
    expect(bad.headline).toBe('This does NOT agree with the ledger — out by LKR 25,000.00');
    expect(bad.detail).toBe('The documents below come to LKR 1,275,000.00; the 1200 Trade receivables account stands at LKR 1,250,000.00. A difference here means a journal went to the wrong account — every entry can balance and still be wrong.');
    const good = o.tieSentences(PAYABLES.tie_out, 'LKR');
    expect(good.headline).toBe('This agrees with the ledger');
    expect(good.detail).toBe('The documents below come to LKR 80,000.00; the 2100 Trade payables account stands at LKR 80,000.00.');
    const none = o.tieSentences({ subledger: '10.00', control: '0.00', difference: '10.00', agrees: false, account: null, note: 'No account is nominated for this control, so there is nothing to tie out against.' }, 'LKR');
    expect(none.detail).toBe('No account is nominated for this control, so there is nothing to tie out against.');
  });

  it('groups the unattributed documents under one row, and ages them in words', () => {
    expect(o.docsFor(RECEIVABLES.documents, null).map((d) => d.number)).toEqual(['CN-2026-0002']);
    expect(o.docsFor(RECEIVABLES.documents, 7)).toHaveLength(2);
    expect(o.ageLabel(-22)).toBe('not due');
    expect(o.ageLabel(0)).toBe('not due');
    expect(o.ageLabel(1)).toBe('1 day');
    expect(o.ageLabel(120)).toBe('120 days');
    expect(o.endOfLastMonth('2026-09-28')).toBe('2026-08-31');
    expect(o.endOfLastMonth('2026-03-05')).toBe('2026-02-28');
    expect(o.endOfLastMonth('2026-01-15')).toBe('2025-12-31');
  });

  it('names every kind the server lists, the debit note included, and keys them apart', () => {
    expect(o.kindLabel('debit_note')).toBe('Debit note');
    expect(o.kindLabel('payment')).toBe('Receipt');
    expect(o.kindLabel('something_new')).toBe('something new');
    expect(o.docKey({ kind: 'bill', id: 12 })).not.toBe(o.docKey({ kind: 'invoice', id: 12 }));
    expect(o.unpostedHeadline(1)).toBe('1 document not in the ledger');
  });

  it('tells a missing grant from a failed request', () => {
    const denied = new ApiError(403, 'Missing permission: finance.reports.view', null);
    expect(o.refusedRead(denied, ['finance.view'])).toMatch(/finance\.reports\.view, which you do not hold/);
    expect(o.refusedRead(new ApiError(403, 'That company is not available to you.', null), ['*'])).toBe('That company is not available to you.');
    expect(o.refusedRead(new ApiError(500, 'The server answered 500.', null), ['*'])).toBeNull();
    expect(o.refusedRead(new Error('offline'), ['*'])).toBeNull();
  });
});

describe('finance owed: the ageing', () => {
  it('puts a disagreeing tie-out first, in words, and lays out the buckets', async () => {
    const onGo = vi.fn();
    wrap(<Ageing company={company} onGo={onGo} side="receivables" />);
    await screen.findByText('Blue Lotus Hotels');
    expect(screen.getByText('Receivables ageing')).toBeTruthy();
    expect(screen.getByText('What is owed to you, and how long it has been outstanding. Figures in LKR.')).toBeTruthy();
    expect(screen.getByText('This does NOT agree with the ledger — out by LKR 25,000.00')).toBeTruthy();
    expect(screen.getByText(/the 1200 Trade receivables account stands at LKR 1,250,000.00/)).toBeTruthy();
    for (const label of ['Customer', 'Not yet due', '1–30 days', '31–60 days', '61–90 days', 'Over 90 days']) expect(screen.getByText(label)).toBeTruthy();
    expect(screen.getByText('120 days')).toBeTruthy();
    expect(screen.getAllByText('1,000,000.00').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('LKR 1,275,000.00')).toBeTruthy();
    fireEvent.click(screen.getByText('See what is not in the ledger'));
    expect(onGo).toHaveBeenCalledWith('unposted');
  });

  it('opens a party to its documents, each in its own currency with the base beneath', async () => {
    wrap(<Ageing company={company} onGo={vi.fn()} side="receivables" />);
    fireEvent.click(await screen.findByText('Blue Lotus Hotels'));
    expect(screen.getByText('INV-2026-0014')).toBeTruthy();
    expect(screen.getByText('USD 1,000.00')).toBeTruthy();
    expect(screen.getByText('LKR 300,000.00')).toBeTruthy();
    expect(screen.getByText('not due')).toBeTruthy();
    expect(screen.getByText('31 May 2026')).toBeTruthy();
    // The unattributed row opens too, to its credit note.
    fireEvent.click(screen.getByText('Unattributed'));
    expect(screen.getByText('CN-2026-0002')).toBeTruthy();
    expect(screen.getByText('credit note')).toBeTruthy();
    expect(screen.queryByText('INV-2026-0014')).toBeNull();
  });

  it('asks the server again for another date, and shows that date’s answer', async () => {
    wrap(<Ageing company={company} onGo={vi.fn()} side="receivables" />);
    await screen.findByText('Blue Lotus Hotels');
    vi.mocked(apiGet).mockImplementationOnce(async () => ({ ...RECEIVABLES, as_of: '2026-06-30', rows: [], documents: [], total: '0.00', totals: zero, tie_out: { subledger: '0.00', control: '0.00', difference: '0.00', agrees: true, account: { id: 31, code: '1200', name: 'Trade receivables' } } }));
    fireEvent.change(screen.getByLabelText('As at'), { target: { value: '2026-06-30' } });
    await screen.findByText('Nothing is owed to you as at 30 June 2026.');
    expect(apiGet).toHaveBeenLastCalledWith('/api/finance/receivables', { company: 2, as_of: '2026-06-30' }, expect.anything());
    expect(screen.getByText('This agrees with the ledger')).toBeTruthy();
  });

  it('payables mirror it: suppliers, a debit note, and a tie-out that agrees', async () => {
    wrap(<Ageing company={company} onGo={vi.fn()} side="payables" />);
    fireEvent.click(await screen.findByText('Ceylon Paper Co'));
    expect(screen.getByText('Payables ageing')).toBeTruthy();
    expect(screen.getByText('Supplier')).toBeTruthy();
    expect(screen.getByText('This agrees with the ledger')).toBeTruthy();
    expect(screen.getByText('debit note')).toBeTruthy();
    expect(screen.queryByText('See what is not in the ledger')).toBeNull();
  });

  it('a refused read names the missing grant; a failed one is not "nothing outstanding"', async () => {
    app.set({ bootstrap: { permissions: ['finance.view'] } as never });
    vi.mocked(apiGet).mockRejectedValueOnce(new ApiError(403, 'Missing permission: finance.reports.view', null));
    wrap(<Ageing company={company} onGo={vi.fn()} side="receivables" />);
    await screen.findByText(/figures are a separate grant: finance.reports.view/);
    cleanup();
    vi.mocked(apiGet).mockRejectedValueOnce(new ApiError(500, 'The server answered 500.', null));
    wrap(<Ageing company={company} onGo={vi.fn()} side="payables" />);
    await screen.findByText('The payables report could not be loaded. This is a failed request, not a statement that nothing is outstanding.');
  });
});

describe('finance owed: not in the ledger', () => {
  it('lists each document with the server’s live reasons, all of them', async () => {
    wrap(<Unposted company={company} onGo={vi.fn()} />);
    await screen.findByText('4 documents not in the ledger');
    expect(screen.getByText(/They are real documents and real money — they are simply absent from every report until they post. 2 still cannot post; the reason is on the row./)).toBeTruthy();
    expect(screen.getByText('August 2026 is locked. Reopen it, or date the bill into an open period.')).toBeTruthy();
    expect(screen.getByText('No account is nominated for purchases.')).toBeTruthy();
    expect(screen.getAllByText('Nothing — it can post now. It was refused when it was issued.')).toHaveLength(2);
    expect(screen.getByText('Debit note')).toBeTruthy();
    expect(screen.getByText('Reimbursement run')).toBeTruthy();
    // A run with no currency is not printed as "null".
    expect(screen.getByText('12,500.00')).toBeTruthy();
    expect(screen.getAllByText('Post it')).toHaveLength(2);
    expect(screen.getAllByText('Try anyway')).toHaveLength(2);
    expect(screen.getByText(/Posting is safe to retry/)).toBeTruthy();
  });

  it('posts one, says which journal it became, and offers to open it', async () => {
    const onGo = vi.fn();
    vi.mocked(apiPost).mockResolvedValueOnce({ ok: true, id: 41, journal_no: 'JE-000041', problems: [] });
    wrap(<Unposted company={company} onGo={onGo} />);
    await screen.findByText('INV-2026-0019');
    fireEvent.click(screen.getAllByText('Post it')[0]!);
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/finance/unposted/invoice/12', { company_id: 2 }));
    await waitFor(() => expect(toasts.get().items.at(-1)?.text).toBe('Posted as JE-000041'));
    toasts.get().items.at(-1)!.action!.run();
    expect(onGo).toHaveBeenCalledWith('journals', '&open=41');
  });

  it('a retry the ledger still refuses says every reason', async () => {
    vi.mocked(apiPost).mockRejectedValueOnce(new ApiError(422, 'August 2026 is locked.', null, { problems: ['August 2026 is locked.', 'No account is nominated for purchases.'] }));
    wrap(<Unposted company={company} onGo={vi.fn()} />);
    await screen.findByText('BILL-91');
    fireEvent.click(screen.getAllByText('Try anyway')[0]!);
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/finance/unposted/bill/12', { company_id: 2 }));
    await waitFor(() => expect(toasts.get().items.at(-1)?.text).toBe('2 problems: August 2026 is locked. No account is nominated for purchases.'));
  });

  it('without finance.journal.post the list is shown and the buttons are not', async () => {
    app.set({ bootstrap: { permissions: ['finance.view', 'finance.reports.view'] } as never });
    wrap(<Unposted company={company} onGo={vi.fn()} />);
    await screen.findByText('BILL-91');
    expect(screen.queryByText('Post it')).toBeNull();
    expect(screen.queryByText('Try anyway')).toBeNull();
    expect(screen.getByText(/Seeing that a document did not post is not the same act as posting it/)).toBeTruthy();
  });

  it('says so when everything is in the books, and a failure is not that', async () => {
    vi.mocked(apiGet).mockResolvedValueOnce({ documents: [] });
    wrap(<Unposted company={company} onGo={vi.fn()} />);
    await screen.findByText('Everything that was issued is in the books');
    expect(screen.getByText(/has a journal. Nothing is waiting./)).toBeTruthy();
    cleanup();
    vi.mocked(apiGet).mockRejectedValueOnce(new ApiError(500, 'The server answered 500.', null));
    wrap(<Unposted company={company} onGo={vi.fn()} />);
    await screen.findByText('This could not be loaded, so it is not a statement that everything posted — it is a failed request.');
  });
});

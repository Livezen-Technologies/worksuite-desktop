// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';

vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn(), apiDelete: vi.fn() }));

// jsdom draws no media: the app's theme listener only needs something to ask.
window.matchMedia ??= ((query: string) => ({ matches: false, media: query, onchange: null, addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined, dispatchEvent: () => false })) as typeof window.matchMedia;

const { ApiError, apiGet, apiPost, apiDelete } = await import('../../../src/core/api');
const { app } = await import('../../../src/core/app-state');
const B = await import('../../../src/modules/finance/banking');
const { default: Banks } = await import('../../../src/modules/finance/Banks');
const { default: Reconcile } = await import('../../../src/modules/finance/Reconcile');

/*
 * Banking, statements and reconciliation, drawn from payloads shaped as the
 * server sends them (BankingController, Statements, Reconcile) — ids and row
 * counts as strings, the way the database driver hands them over — to prove
 * the screens say what matters without a server: the difference as the
 * headline, a suggestion with its reasons, the lock held off until the
 * difference is nil, and no line parked without a reason.
 */

const company = { id: 2, name: 'CreativeFX', base_currency: 'LKR', fiscal_year_start_month: 4, books_opened_at: '2026-04-01', has_books: true };

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const ACCOUNTS = {
  accounts: [
    { id: '12', code: '1120', name: 'Commercial Bank current', currency: null, is_reconcilable: '1', line_count: 214, is_default: true },
    { id: '14', code: '1140', name: 'HNB dollar account', currency: 'USD', is_reconcilable: '1', line_count: 0, is_default: false },
  ],
  candidates: [{ id: '31', code: '1130', name: 'Sampath savings', currency: null }],
  base_currency: 'LKR',
  default_id: 12,
  can: { view: true, edit: true, manage: true, level: 'manage' },
};

const TXNS = [
  { id: '901', txn_date: '2026-08-30', value_date: null, description: 'CHQ 004512 RENT', counterparty: null, reference: '004512', amount: '-150000.00', currency: 'LKR', running_balance: '826190.06', status: 'unmatched', note: null, filename: 'aug.csv' },
  { id: '902', txn_date: '2026-08-29', value_date: null, description: 'SALES RECEIPT INV-12', counterparty: 'Acme', reference: null, amount: '30000.00', currency: 'LKR', running_balance: '976190.06', status: 'matched', note: null, filename: 'aug.csv' },
  { id: '903', txn_date: '2026-08-28', value_date: null, description: 'SMS ALERT FEE', counterparty: null, reference: null, amount: '-50.00', currency: 'LKR', running_balance: '946190.06', status: 'ignored', note: 'Bank fee, booked monthly by journal', filename: 'aug.csv' },
];

const STATEMENTS = [
  // Uploaded last, but covers an EARLIER month: the prefill must not pick it.
  { id: '6', filename: 'march.csv', period_start: '2026-03-01', period_end: '2026-03-31', opening_balance: '10.00', closing_balance: '500000.00', rows_seen: '40', rows_imported: '40', rows_duplicate: '0', rows_rejected: '0', notes: null, imported_by_name: 'Nimali', created_at: '2026-09-20 10:00:00' },
  { id: '5', filename: 'aug.csv', period_start: '2026-08-01', period_end: '2026-08-31', opening_balance: '900000.00', closing_balance: '826190.06', rows_seen: '46', rows_imported: '43', rows_duplicate: '3', rows_rejected: '0', notes: null, imported_by_name: 'Nimali', created_at: '2026-09-02 09:00:00' },
  { id: '4', filename: 'july-web.html', period_start: '2026-07-01', period_end: '2026-07-31', opening_balance: null, closing_balance: null, rows_seen: '30', rows_imported: '29', rows_duplicate: '0', rows_rejected: '1', notes: 'No opening or closing balance was recorded, because the first or last line carries no running balance.\nline 14: no amount could be read.', imported_by_name: null, created_at: '2026-08-02 09:00:00' },
];

const OPEN_REC = {
  id: '7', account_id: '12', period_start: '2026-08-01', period_end: '2026-08-31', statement_closing: '826190.06',
  ledger_balance: '823640.06', unpresented: '-2500.00', unrecorded: '-1500.00', difference: '-1550.00', matched_total: '30000.00',
  status: 'open', locked_at: null, locked_by: null, note: null,
};

const SUGGESTIONS = {
  suggestions: [
    { journal_line_id: 4411, journal_id: 88, journal_no: 'JE-000088', entry_date: '2026-08-30', description: 'August rent', amount: '-150000.00', score: 155, why: 'the amount is exactly right, the same day, the reference 004512 appears on it', kind: 'other', document: 'Journal' },
    { journal_line_id: 4412, journal_id: 90, journal_no: 'BILL-2026-0031', entry_date: '2026-08-27', description: 'Landlord bill', amount: '-149000.00', score: 55, why: 'the amount is within 1,000.00, 3 days apart', kind: 'payable', document: 'Supplier bill B-31' },
  ],
  matches: [],
};

let rec: Record<string, unknown> = OPEN_REC;
let unmatchedUpToEnd = 1;

beforeEach(() => {
  rec = OPEN_REC;
  unmatchedUpToEnd = 1;
  app.set({ bootstrap: { permissions: ['*'] } as never });
  vi.mocked(apiGet).mockImplementation(async (path: string, query?: Record<string, unknown>) => {
    if (path === '/api/finance/bank-accounts') return ACCOUNTS;
    if (path === '/api/finance/currencies') return { currencies: [{ code: 'LKR', name: 'Sri Lankan rupee' }, { code: 'USD', name: 'US dollar' }] };
    if (path === '/api/finance/bank-accounts/12/transactions') {
      const account = { id: '12', code: '1120', name: 'Commercial Bank current', currency: null, type: 'asset' };
      if (query?.status === 'unmatched' && query?.per_page === 1) return { account, transactions: [], total: unmatchedUpToEnd };
      if (query?.per_page === 1) return { account, transactions: TXNS.slice(0, 1), total: 46 };
      const rows = query?.status ? TXNS.filter((t) => t.status === query.status) : TXNS;
      return { account, transactions: rows, total: rows.length };
    }
    if (path === '/api/finance/bank-accounts/12/statements') return { statements: STATEMENTS };
    if (path === '/api/finance/bank-accounts/12/reconciliations') return { reconciliations: [{ ...OPEN_REC, ledger_balance: null, difference: null, unpresented: null, locked_by_name: null }], locked_through: '2026-07-31' };
    if (path === '/api/finance/bank-accounts/14/reconciliations') return { reconciliations: [], locked_through: null };
    if (path === '/api/finance/reconciliations/7') return { reconciliation: rec, live: rec.status !== 'locked' };
    if (path === '/api/finance/bank-transactions/901/suggestions') return SUGGESTIONS;
    if (path === '/api/finance/bank-transactions/901/choices') return { choices: [] };
    throw new Error(`unexpected ${path}`);
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ── the pure parts ───────────────────────────────────────────────────────

describe('banking helpers', () => {
  it('reads signed amounts as integer cents, and refuses what is not one', () => {
    expect(B.signedCents('-1,234.50')).toBe(-123450);
    expect(B.signedCents('0.1')).toBe(10);
    expect(B.signedCents('826190.06')).toBe(82619006);
    expect(B.signedCents('12.345')).toBeNull();
    expect(B.signedCents('')).toBeNull();
    expect(B.signedCents('abc')).toBeNull();
    expect(B.signedCents(null)).toBeNull();
  });

  it('works the reconciliation through in cents: bank + ledger only − bank only = what the ledger should say', () => {
    const a = B.arithmetic(OPEN_REC);
    // 826,190.06 − 2,500.00 + 1,500.00 — the float version drifts; this does not.
    expect(a.expected).toBe('825190.06');
    expect(a.agreed).toBe(false);
    expect(B.arithmetic({ ...OPEN_REC, difference: '0.00' }).agreed).toBe(true);
    expect(B.arithmetic({ ...OPEN_REC, difference: '-0.00' }).agreed).toBe(true);
    // A locked period keeps no "bank only" figure: no working rather than a made-up one.
    expect(B.arithmetic({ ...OPEN_REC, unrecorded: undefined }).expected).toBeNull();
  });

  it('holds the lock off for a difference and for any unmatched line up to the end, and says which', () => {
    const both = B.lockBlockers(OPEN_REC, 3, 'LKR');
    expect(both).toHaveLength(2);
    expect(both[0]).toContain('The difference is LKR -1,550.00');
    expect(both[1]).toBe('3 statement lines on or before 31 Aug 2026 are still unmatched. Match or park them, or shorten the period.');
    expect(B.lockBlockers({ ...OPEN_REC, difference: '0.00' }, 1)[0]).toContain('1 statement line on or before');
    expect(B.lockBlockers({ ...OPEN_REC, difference: '0.00' }, 0)).toEqual([]);
    expect(B.lockBlockers({ ...OPEN_REC, difference: '0.00' }, null)).toHaveLength(1);
  });

  it('names a suggestion’s strength from its points, and lists its reasons', () => {
    expect(B.strength(155)).toEqual({ label: 'Strong', tone: 'green' });
    expect(B.strength(115).label).toBe('Exact amount');
    expect(B.strength(70).label).toBe('Close');
    expect(B.reasons('the amount is within 1,234.00, 3 days apart, the reference AB12 appears on it')).toEqual(['the amount is within 1,234.00', '3 days apart', 'the reference AB12 appears on it']);
    expect(B.reasons('the amount is exactly right, a day apart')).toEqual(['the amount is exactly right', 'a day apart']);
  });

  it('reports an import with its duplicates, and a refusal with its lines', () => {
    expect(B.importSummary({ imported: 43, duplicates: 3, rejected: 0 })).toBe('43 lines loaded. 3 were already on file. 0 could not be read.');
    expect(B.importSummary({ imported: 1, duplicates: 1, rejected: 2 })).toBe('1 line loaded. 1 was already on file. 2 could not be read.');
    expect(B.batchLine({ rows_imported: '43', rows_duplicate: '3', rows_rejected: '0' })).toBe('43 loaded, 3 already on file');
    const e = new ApiError(422, 'Nothing in that file could be read as a transaction. line 2: no date could be read.', null, { seen: 2, problems: ['line 2: no date could be read.', 'line 3: the amount is zero.'] });
    expect(B.importRefusal(e)).toEqual({ message: e.message, problems: ['line 3: the amount is zero.'] });
    expect(B.autoMatchSummary({ matched: 0, considered: 12 })).toBe('Nothing matched unambiguously. Where two ledger lines both fit, neither is chosen.');
    expect(B.autoMatchSummary({ matched: 4, considered: 12 })).toBe('4 of 12 lines matched.');
    expect(B.tooBig({ size: 8 * 1024 * 1024 + 1 })).toBe(true);
  });

  it('prefills a period from the latest PROVED statement by period, not by upload order', () => {
    expect(B.provedStatement(STATEMENTS)?.filename).toBe('aug.csv');
    expect(B.provedStatement([STATEMENTS[2]!])).toBeNull();
    expect(B.lastMonth('2026-03-15')).toEqual({ start: '2026-02-01', end: '2026-02-28' });
    expect(B.periodProblems({ start: '2026-09-01', end: '2026-10-31', closing: '100' }, '2026-09-28')).toEqual(['A period cannot close in the future — there is no statement for it yet.']);
    expect(B.periodProblems({ start: '2026-08-01', end: '2026-08-31', closing: '' }, '2026-09-28')).toEqual(['Enter the closing balance from the statement.']);
    expect(B.periodProblems({ start: '2026-08-01', end: '2026-08-31', closing: '-1,200.50' }, '2026-09-28')).toEqual([]);
  });
});

// ── bank accounts and statements ─────────────────────────────────────────

describe('bank accounts', () => {
  it('lists the bank accounts with the default marked and unremovable, and makes a candidate one', async () => {
    vi.mocked(apiPost).mockResolvedValueOnce([]);
    wrap(<Banks company={company} onGo={vi.fn()} />);
    await screen.findByText('Commercial Bank current');
    expect(screen.getByText('Default')).toBeTruthy();
    expect(screen.getAllByText('Remove…')).toHaveLength(1);
    expect(screen.getByText('214')).toBeTruthy();
    expect(screen.getByText(/A bank account is an asset even when it is overdrawn/)).toBeTruthy();
    fireEvent.click(screen.getByText('Make it a bank account'));
    await screen.findByText('Make 1130 Sampath savings a bank account');
    fireEvent.click(screen.getAllByText('Make it a bank account').at(-1)!);
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/finance/accounts/31/bank', { company_id: 2, is_reconcilable: 1, currency: '' }, { company: 2 }));
  });

  it('warns before re-denominating an account with history', async () => {
    wrap(<Banks company={company} onGo={vi.fn()} />);
    await screen.findByText('Commercial Bank current');
    fireEvent.click(screen.getAllByText('Currency…')[0]!);
    expect(await screen.findByText(/already has 214 journal lines.*the server will refuse/)).toBeTruthy();
  });

  it('offers nothing to change without finance.accounts.manage', async () => {
    app.set({ bootstrap: { permissions: ['finance.view', 'finance.bank.import'] } as never });
    wrap(<Banks company={company} onGo={vi.fn()} />);
    await screen.findByText('Commercial Bank current');
    expect(screen.queryByText('Make it a bank account')).toBeNull();
    expect(screen.queryByText('Remove…')).toBeNull();
    expect(screen.queryByText('Currency…')).toBeNull();
    expect(screen.getAllByText('Statement').length).toBe(2);
  });

  it('opens a statement in place: signed lines, a parked line’s reason, and the import history with its duplicates', async () => {
    wrap(<Banks company={company} onGo={vi.fn()} />);
    await screen.findByText('Commercial Bank current');
    fireEvent.click(screen.getAllByText('Statement')[0]!);
    await screen.findByText('CHQ 004512 RENT');
    expect(screen.getByText(/What the bank says happened, in LKR. Nothing here is posted/)).toBeTruthy();
    expect(screen.getByText('-150,000.00')).toBeTruthy();
    expect(screen.getByText('Parked: Bank fee, booked monthly by journal')).toBeTruthy();
    await screen.findByText('aug.csv');
    expect(screen.getByText(/43 loaded, 3 already on file/)).toBeTruthy();
    expect(screen.getByText(/line 14: no amount could be read/)).toBeTruthy();
    expect(screen.getByText(/No closing balance recorded — enter it from the statement/)).toBeTruthy();
    expect(screen.getByText(/up to 8 MB/)).toBeTruthy();
  });

  it('sends a statement file as multipart, and keeps the counts on screen', async () => {
    vi.mocked(apiPost).mockResolvedValueOnce({ statement_id: 9, seen: 46, imported: 43, duplicates: 3, rejected: 0, problems: ['No opening or closing balance was recorded, because the balance column does not tie in either direction.'] });
    wrap(<Banks company={company} onGo={vi.fn()} />);
    await screen.findByText('Commercial Bank current');
    fireEvent.click(screen.getAllByText('Statement')[0]!);
    await screen.findByText('CHQ 004512 RENT');
    const file = new File(['Date,Description,Amount\n01/08/2026,SALARY,150000'], 'sept.csv', { type: 'text/csv' });
    fireEvent.change(screen.getByLabelText('Statement file'), { target: { files: [file] } });
    await screen.findByText(/43 lines loaded. 3 were already on file. 0 could not be read./);
    expect(screen.getByText(/the balance column does not tie in either direction/)).toBeTruthy();
    const [path, body, query] = vi.mocked(apiPost).mock.calls[0]!;
    expect(path).toBe('/api/finance/bank-accounts/12/statements');
    expect(body).toBeInstanceOf(FormData);
    expect(((body as FormData).get('file') as File).name).toBe('sept.csv');
    expect((body as FormData).get('company_id')).toBe('2');
    expect(query).toEqual({ company: 2 });
  });

  it('shows the duplicate-file refusal as the server says it, and does not send a file over 8 MB', async () => {
    vi.mocked(apiPost).mockRejectedValueOnce(new ApiError(422, 'This exact file was already loaded on 2026-09-02 as "aug.csv". Nothing has been changed.', null, { seen: 0, rejected: 0, problems: [] }));
    wrap(<Banks company={company} onGo={vi.fn()} />);
    await screen.findByText('Commercial Bank current');
    fireEvent.click(screen.getAllByText('Statement')[0]!);
    await screen.findByText('CHQ 004512 RENT');
    const input = screen.getByLabelText('Statement file');
    fireEvent.change(input, { target: { files: [new File(['x'], 'aug.csv')] } });
    expect(await screen.findByText(/This exact file was already loaded on 2026-09-02/)).toBeTruthy();
    const big = new File(['x'], 'huge.csv');
    Object.defineProperty(big, 'size', { value: 9 * 1024 * 1024 });
    fireEvent.change(input, { target: { files: [big] } });
    expect(await screen.findByText('That file is larger than 8 MB, so it was not sent.')).toBeTruthy();
    expect(apiPost).toHaveBeenCalledTimes(1);
  });

  it('will not park a line without a reason', async () => {
    vi.mocked(apiPost).mockResolvedValueOnce(null);
    wrap(<Banks company={company} onGo={vi.fn()} />);
    await screen.findByText('Commercial Bank current');
    fireEvent.click(screen.getAllByText('Statement')[0]!);
    await screen.findByText('CHQ 004512 RENT');
    fireEvent.click(screen.getByText('Park'));
    await screen.findByText('Park this line');
    const ok = screen.getByText('Park it') as HTMLButtonElement;
    expect(ok.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Why does this line need no match?'), { target: { value: '   ' } });
    expect(ok.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Why does this line need no match?'), { target: { value: 'Cheque cancelled; bank reversed it next day' } });
    expect(ok.disabled).toBe(false);
    fireEvent.click(ok);
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/finance/bank-transactions/901/ignore', { company_id: 2, why: 'Cheque cancelled; bank reversed it next day' }, { company: 2 }));
  });
});

// ── reconciliation ───────────────────────────────────────────────────────

async function openWorkspace() {
  wrap(<Reconcile company={company} onGo={vi.fn()} />);
  await screen.findByText(/frozen through/);
  fireEvent.click(screen.getByText('Commercial Bank current'));
  await screen.findByText(/Agreed with the bank through/);
  fireEvent.click(screen.getByText(/1 Aug 2026 – 31 Aug 2026/));
  await screen.findByTestId('difference');
}

describe('reconciliation', () => {
  it('shows each account’s locked-through date, and says what it means on the account', async () => {
    wrap(<Reconcile company={company} onGo={vi.fn()} />);
    await screen.findByText(/frozen through/);
    expect(await screen.findByText('Never reconciled')).toBeTruthy();
    fireEvent.click(screen.getByText('Commercial Bank current'));
    await screen.findByText(/not an invoice, not a bill, not a payroll run/);
    expect(screen.getByText('In progress')).toBeTruthy();
  });

  it('prefills a new period from the latest proved statement', async () => {
    vi.mocked(apiPost).mockResolvedValueOnce({ id: 7, reopened: false });
    wrap(<Reconcile company={company} onGo={vi.fn()} />);
    await screen.findByText(/frozen through/);
    fireEvent.click(screen.getByText('Commercial Bank current'));
    await screen.findByText(/Agreed with the bank through/);
    await waitFor(() => expect((screen.getByText('Reconcile a period').closest('button') as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByText('Reconcile a period'));
    expect(await screen.findByText(/Taken from aug.csv, which covers 1 Aug 2026 to 31 Aug 2026/)).toBeTruthy();
    expect((screen.getByLabelText("Closing balance on the bank's statement") as HTMLInputElement).value).toBe('826190.06');
    fireEvent.click(screen.getByText('Open the period'));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/finance/bank-accounts/12/reconciliations', { company_id: 2, period_start: '2026-08-01', period_end: '2026-08-31', statement_closing: '826190.06' }, { company: 2 }));
    await screen.findByTestId('difference');
  });

  it('puts the difference first, with its working, and holds the lock off until it is nil', async () => {
    await openWorkspace();
    expect(screen.getByTestId('difference').textContent).toBe('LKR -1,550.00');
    expect(screen.getByText('unexplained')).toBeTruthy();
    expect(screen.getByText(/= /).textContent).toContain('LKR 825,190.06');
    const lock = screen.getByText('Agree and lock').closest('button') as HTMLButtonElement;
    expect(lock.disabled).toBe(true);
    await screen.findByText(/1 statement line on or before 31 Aug 2026 is still unmatched/);
    expect(screen.getByText(/The difference is LKR -1,550.00. It has to be nil/)).toBeTruthy();
  });

  it('opens a line to its scored suggestions, each with its reasons, and matches one', async () => {
    vi.mocked(apiPost).mockResolvedValueOnce(null);
    await openWorkspace();
    fireEvent.click(await screen.findByText('CHQ 004512 RENT'));
    const panel = await screen.findByRole('complementary', { name: 'Statement line' });
    await within(panel).findByText('JE-000088');
    expect(within(panel).getByText('Strong · 155')).toBeTruthy();
    expect(within(panel).getByText(/the amount is exactly right · the same day · the reference 004512 appears on it/)).toBeTruthy();
    expect(within(panel).getByText('Supplier bill B-31')).toBeTruthy();
    expect(within(panel).getByText('Close · 55')).toBeTruthy();
    fireEvent.click(within(panel).getAllByText('Match')[0]!);
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/finance/bank-transactions/901/match', { company_id: 2, journal_line_id: 4411 }, { company: 2 }));
  });

  it('locks once the difference is nil and nothing is unmatched', async () => {
    rec = { ...OPEN_REC, unpresented: '-1000.00', unrecorded: '-1550.00', difference: '0.00' };
    unmatchedUpToEnd = 0;
    vi.mocked(apiPost).mockResolvedValueOnce(null);
    await openWorkspace();
    expect(screen.getByText('agreed — the two sides meet')).toBeTruthy();
    const lock = screen.getByText('Agree and lock').closest('button') as HTMLButtonElement;
    await waitFor(() => expect(lock.disabled).toBe(false));
    fireEvent.click(lock);
    await screen.findByText(/not an invoice, not a bill, not a payroll run. It can be reopened, with a reason./);
    fireEvent.click(screen.getAllByText('Agree and lock').at(-1)!);
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/finance/reconciliations/7/lock', { company_id: 2, note: '' }, { company: 2 }));
  });

  it('a locked period shows its snapshot, offers no matching, and reopens only with a reason', async () => {
    rec = { ...OPEN_REC, unrecorded: undefined, difference: '0.00', status: 'locked', locked_at: '2026-09-05 11:00:00', note: null };
    vi.mocked(apiPost).mockResolvedValueOnce(null);
    await openWorkspace();
    expect(screen.getByText(/as they stood when it was locked, not recomputed/)).toBeTruthy();
    expect(screen.queryByText('Match what is obvious')).toBeNull();
    expect(screen.queryByText('Agree and lock')).toBeNull();
    fireEvent.click(screen.getByText('Reopen…'));
    await screen.findByText('Reopen this reconciliation?');
    const ok = screen.getByText('Reopen') as HTMLButtonElement;
    expect(ok.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Why is this being reopened?'), { target: { value: 'Late bank charge for August' } });
    fireEvent.click(ok);
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/finance/reconciliations/7/unlock', { company_id: 2, why: 'Late bank charge for August' }, { company: 2 }));
  });

  it('without finance.bank.reconcile the work is offered but the lock is not', async () => {
    app.set({ bootstrap: { permissions: ['finance.view', 'finance.bank.import'] } as never });
    await openWorkspace();
    expect(screen.getByText('Match what is obvious')).toBeTruthy();
    expect(screen.queryByText('Agree and lock')).toBeNull();
    expect(screen.getByText(/locking needs finance.bank.reconcile/)).toBeTruthy();
  });

  it('unmatches through DELETE with the company named', async () => {
    vi.mocked(apiDelete).mockResolvedValueOnce(null);
    vi.mocked(apiGet).mockImplementation(async (path: string, query?: Record<string, unknown>) => {
      if (path === '/api/finance/bank-transactions/902/suggestions') return { suggestions: [], matches: [{ id: '55', journal_no: 'INV-2026-0012', entry_date: '2026-08-29', description: 'Invoice 12', amount: '30000.00', kind: 'auto', reconciliation_id: null }] };
      if (path === '/api/finance/bank-accounts') return ACCOUNTS;
      if (path === '/api/finance/bank-accounts/12/reconciliations') return { reconciliations: [OPEN_REC], locked_through: null };
      if (path === '/api/finance/bank-accounts/14/reconciliations') return { reconciliations: [], locked_through: null };
      if (path === '/api/finance/bank-accounts/12/statements') return { statements: [] };
      if (path === '/api/finance/reconciliations/7') return { reconciliation: OPEN_REC, live: true };
      if (path === '/api/finance/bank-accounts/12/transactions') return { account: {}, transactions: query?.per_page === 1 ? [] : TXNS, total: query?.per_page === 1 ? 1 : TXNS.length };
      throw new Error(`unexpected ${path}`);
    });
    wrap(<Reconcile company={company} onGo={vi.fn()} />);
    await screen.findAllByText('Never reconciled');
    fireEvent.click(screen.getByText('Commercial Bank current'));
    fireEvent.click(await screen.findByText(/1 Aug 2026 – 31 Aug 2026/));
    fireEvent.click(await screen.findByText('SALES RECEIPT INV-12'));
    const panel = await screen.findByRole('complementary', { name: 'Statement line' });
    await within(panel).findByText('INV-2026-0012');
    fireEvent.click(within(panel).getByLabelText('Unmatch'));
    await waitFor(() => expect(apiDelete).toHaveBeenCalledWith('/api/finance/bank-matches/55?company=2', { company_id: 2 }));
  });
});

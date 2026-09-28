import { describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';

vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn(), apiDelete: vi.fn() }));

const { ApiError, apiPost, apiPut } = await import('../../../src/core/api');
const f = await import('../../../src/modules/finance/api');
const { resolveCompany } = await import('../../../src/modules/finance/FinanceShell');

describe('finance: money is text, never a float', () => {
  it('formats the server’s strings exactly, sign and cents kept', () => {
    expect(f.money('12345678901.5', 'LKR')).toBe('LKR 12,345,678,901.50');
    expect(f.money('-1200')).toBe('-1,200.00');
    expect(f.money('0.1')).toBe('0.10');
    expect(f.money('1500', 'JPY', 0)).toBe('JPY 1,500');
    // A malformed value is shown as zero, not as its garbage.
    expect(f.money('abc', 'USD')).toBe('USD 0.00');
  });

  it('knows zero and negative from the string', () => {
    expect(f.isZero('0.00')).toBe(true);
    expect(f.isZero('-0.00')).toBe(true);
    expect(f.isZero(null)).toBe(true);
    expect(f.isZero('0.01')).toBe(false);
    expect(f.isNegative('-5.00')).toBe(true);
    expect(f.isNegative('-0.00')).toBe(false);
  });

  it('adds in cents, so 0.10 + 0.20 is 0.30', () => {
    expect(f.cents('0.1')! + f.cents('0.2')!).toBe(30);
    expect(f.fromCents(30)).toBe('0.30');
    expect(f.cents('1,250.5')).toBe(125050);
    expect(f.cents('')).toBe(0);
    expect(f.cents('1.234')).toBeNull();
    expect(f.cents('12a')).toBeNull();
    expect(f.fromCents(-705)).toBe('-7.05');
  });
});

describe('finance: a journal being written', () => {
  const line = (account: string, debit = '', credit = '') => ({ key: Math.random().toString(), account_id: account, description: '', debit, credit });

  it('passes a balanced journal', () => {
    const r = f.draftProblems([line('1', '100.10'), line('2', '', '100.1')]);
    expect(r.problems).toEqual([]);
    expect(r.dr).toBe(10010);
  });

  it('names every problem at once, the way the server does', () => {
    const r = f.draftProblems([line('', '50'), line('2', '10', '10'), line('3')]);
    expect(r.problems).toEqual(['Line 1: no account chosen.', 'Line 2: a line is either a debit or a credit, not both.', 'Line 3: has no amount.', 'Debits and credits must be equal — out by 50.00.']);
  });

  it('refuses one line, a nonsense amount, and a journal for nothing', () => {
    expect(f.draftProblems([line('1', '5'), line('')]).problems[0]).toBe('A journal needs at least two lines — one line cannot balance.');
    expect(f.draftProblems([line('1', '5.555'), line('2', '', '5')]).problems).toContain('An amount is not a number. Use digits and at most two decimal places.');
    expect(f.draftProblems([line('1', '0'), line('2', '', '0')]).problems).toContain('A journal for nothing has no effect.');
  });

  it('sends only lines with an account, amounts without their commas', async () => {
    vi.mocked(apiPost).mockResolvedValueOnce({ id: 9 });
    await f.createJournal(4, { entry_date: '2026-09-28', description: 'Rent', reference: '', lines: [line('10', '1,500.00'), line('20', '', '1500'), line('')] });
    expect(apiPost).toHaveBeenCalledWith('/api/finance/journals', {
      company_id: 4,
      entry_date: '2026-09-28',
      description: 'Rent',
      reference: '',
      lines: [
        { account_id: 10, description: null, debit: '1500.00', credit: '0' },
        { account_id: 20, description: null, debit: '0', credit: '1500' },
      ],
    });
  });

  it('puts the company in the query string where the route reads it from there', async () => {
    vi.mocked(apiPut).mockResolvedValueOnce({});
    await f.setBehaviour(3, 77, 'fixed');
    expect(apiPut).toHaveBeenCalledWith('/api/finance/accounts/77/behaviour?company=3', { behaviour: 'fixed' });
  });

  it('dates a reversal only when asked to', async () => {
    vi.mocked(apiPost).mockResolvedValue({});
    await f.reverseJournal(3, 5, 'Wrong account');
    expect(apiPost).toHaveBeenLastCalledWith('/api/finance/journals/5/reverse', { company_id: 3, reason: 'Wrong account' });
    await f.reverseJournal(3, 5, 'Wrong account', '2026-10-01');
    expect(apiPost).toHaveBeenLastCalledWith('/api/finance/journals/5/reverse', { company_id: 3, reason: 'Wrong account', entry_date: '2026-10-01' });
  });
});

describe('finance: the server’s refusals', () => {
  it('takes every problem the server listed, or its one message', () => {
    const listed = new ApiError(422, 'Refused', null, { problems: ['The period Oct 2026 is locked.', 'Debits and credits must be equal.'] });
    expect(f.problemsOf(listed)).toEqual(['The period Oct 2026 is locked.', 'Debits and credits must be equal.']);
    expect(f.refusal(listed)).toBe('2 problems: The period Oct 2026 is locked. Debits and credits must be equal.');
    expect(f.refusal(new ApiError(409, 'This company has no books yet. Open them first.', null))).toBe('This company has no books yet. Open them first.');
  });
});

describe('finance: dates from their digits', () => {
  it('writes a bare date without shifting it a day', () => {
    expect(f.longDate('2026-09-01')).toBe('1 September 2026');
    expect(f.shortDate('2026-12-31')).toBe('31 Dec 2026');
  });

  it('adds months, keeping the day inside the month', () => {
    expect(f.addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(f.addMonths('2026-11-15', 2)).toBe('2027-01-15');
    expect(f.addMonths('2024-03-31', -1)).toBe('2024-02-29');
  });
});

describe('finance: the chart', () => {
  const tree = [
    { id: 1, code: '1000', name: 'Assets', type: 'asset', normal_balance: 'debit', is_postable: false, is_system: false, children: [
      { id: 2, code: '1110', name: 'Cash', type: 'asset', normal_balance: 'debit', is_postable: true, is_system: true, children: [] },
      { id: 3, code: '1199', name: 'Old', type: 'asset', normal_balance: 'debit', is_postable: true, is_system: false, status: 'archived', children: [] },
    ] },
  ];
  it('flattens the tree in order with depths, and offers only live postable accounts to a journal', () => {
    expect(f.flattenAccounts(tree).map((a) => [a.code, a.depth])).toEqual([['1000', 0], ['1110', 1], ['1199', 1]]);
    expect(f.postable(tree).map((a) => a.code)).toEqual(['1110']);
  });
});

describe('finance: which company a tab is on', () => {
  const cos = [
    { id: 1, name: 'NoBooks Ltd', base_currency: null, fiscal_year_start_month: null, books_opened_at: null, has_books: false },
    { id: 2, name: 'CreativeFX', base_currency: 'LKR', fiscal_year_start_month: 4, books_opened_at: '2026-04-01', has_books: true },
    { id: 3, name: 'TechHubiz', base_currency: 'USD', fiscal_year_start_month: 1, books_opened_at: '2026-01-01', has_books: true },
  ];
  it('takes the route’s company, then the remembered one, then the first with books — each only if still held', () => {
    expect(resolveCompany(cos, 3, 2)?.id).toBe(3);
    expect(resolveCompany(cos, null, 3)?.id).toBe(3);
    expect(resolveCompany(cos, 99, 98)?.id).toBe(2);
    expect(resolveCompany(cos.slice(0, 1), null, null)?.id).toBe(1);
    expect(resolveCompany([], 1, 1)).toBeNull();
  });
});

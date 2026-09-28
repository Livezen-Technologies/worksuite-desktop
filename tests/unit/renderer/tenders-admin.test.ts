import { describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';
import type { LibraryDoc } from '../../../src/modules/tenders/admin';

vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn(), apiDelete: vi.fn() }));

const api = await import('../../../src/core/api');
const a = await import('../../../src/modules/tenders/admin');

const doc = (over: Partial<LibraryDoc>) => ({
  id: 1,
  org_id: 1,
  name: 'Tax clearance',
  kind: 'tax',
  reference: 'TC-12',
  file: { id: 9, name: 'tc.pdf' },
  issued_on: null,
  expires_on: null,
  days_left: null,
  state: 'valid' as const,
  note: null,
  ...over,
});

describe('tenders: the library', () => {
  it('reads documents with their company, and a file only where there is one', async () => {
    vi.mocked(api.apiGet).mockResolvedValueOnce({ items: [{ id: '103', org_id: '1', name: 'Tax', kind: 'tax', file: null, state: 'expired', days_left: '-3' }], summary: { total: 1, expired: 1, expiring: 0 } });
    const lib = await a.fetchLibrary('1');
    expect(vi.mocked(api.apiGet)).toHaveBeenLastCalledWith('/api/tender/library', { org: '1' }, undefined);
    expect(lib.items[0]).toMatchObject({ id: 103, org_id: 1, file: null, state: 'expired', days_left: -3 });
  });

  it('filters by state, by no file, and by search across name, reference and kind', () => {
    const items = [doc({ id: 1, state: 'expired' }), doc({ id: 2, name: 'VAT', kind: 'registration', reference: null, file: null }), doc({ id: 3, name: 'ISO 9001', kind: 'certification', state: 'expiring' })];
    expect(a.filterLibrary(items, 'expired', '').map((d) => d.id)).toEqual([1]);
    expect(a.filterLibrary(items, 'nofile', '').map((d) => d.id)).toEqual([2]);
    expect(a.filterLibrary(items, 'all', 'certif').map((d) => d.id)).toEqual([3]);
    expect(a.filterLibrary(items, 'all', 'tc-12').map((d) => d.id)).toEqual([1, 3]);
  });

  it('saves a document whole, with its own company and its file (or none)', () => {
    const d = a.libraryDraft(doc({ issued_on: '2026-01-01', expires_on: '2027-03-31' }));
    expect(a.libraryBody(d, 1).body).toEqual({ name: 'Tax clearance', kind: 'tax', reference: 'TC-12', issued_on: '2026-01-01', expires_on: '2027-03-31', note: '', file_id: 9, org: '1' });
    expect(a.libraryBody({ ...d, file: null }, null).body).toMatchObject({ file_id: null });
    expect(a.libraryBody({ ...d, expires_on: '2025-12-31' }, 1).error).toMatch(/expire before it was issued/);
    expect(a.libraryBody({ ...d, name: ' ' }, 1).error).toMatch(/needs a name/);
  });
});

describe('tenders: reports', () => {
  it('turns a preset into the days on the reader’s calendar', () => {
    expect(a.periodOf('month', '2026-09-27')).toEqual({ from: '2026-09-01', to: '2026-09-27' });
    expect(a.periodOf('quarter', '2026-09-27')).toEqual({ from: '2026-07-01', to: '2026-09-27' });
    expect(a.periodOf('quarter', '2026-11-02')).toEqual({ from: '2026-10-01', to: '2026-11-02' });
    expect(a.periodOf('year', '2026-09-27')).toEqual({ from: '2026-01-01', to: '2026-09-27' });
    expect(a.periodOf('12m', '2026-09-27')).toEqual({ from: '2025-09-28', to: '2026-09-27' });
    expect(a.periodOf('all', '2026-09-27')).toEqual({ from: '', to: '' });
    expect(a.periodOf('custom', '2026-09-27', { from: '2026-02-01', to: '2026-03-01' })).toEqual({ from: '2026-02-01', to: '2026-03-01' });
  });

  it('asks for the period in the server’s spelling, and reads what comes back safely', async () => {
    vi.mocked(api.apiGet).mockResolvedValueOnce({ total: 4, won: 1, lost: 1, cancelled: 1, open: 1, win_rate: 50, by_industry: [], by_sector: { government: '3' }, loss_analysis: { lost: 1, by_reason: { Price: 1 }, by_competitor: [] } });
    const r = await a.fetchReport('', '2026-01-01', '2026-09-27');
    expect(vi.mocked(api.apiGet)).toHaveBeenLastCalledWith('/api/tender/reports', { from: '2026-01-01', to: '2026-09-27' }, undefined);
    expect(r).toMatchObject({ total: 4, cancelled: 1, win_rate: 50, by_industry: {}, by_sector: { government: 3 } });
    expect(r.loss_analysis).toMatchObject({ lost: 1, by_reason: { Price: 1 }, by_competitor: {}, price_gap: null });
  });

  it('draws counts as bars, largest first, as a share of the largest', () => {
    expect(a.bars({ Roads: 2, Health: 8, IT: 4, Empty: 0 })).toEqual([
      { label: 'Health', n: 8, pct: 100 },
      { label: 'IT', n: 4, pct: 50 },
      { label: 'Roads', n: 2, pct: 25 },
    ]);
  });
});

describe('tenders: scoring rules', () => {
  const factors = { budget: 'Published budget ceiling', industry: 'Industry on the tender', certifications: 'Mandatory requirements outstanding', lead_time: 'Whole days until closing' };

  it('offers only the comparisons a factor can ever match', () => {
    expect(a.operatorsFor('industry')).toEqual(['equals', 'in']);
    expect(a.operatorsFor('budget')).toEqual(['gte', 'lte', 'equals', 'between', 'in']);
    expect(a.operatorsFor('certifications')).toEqual(['has_all', 'has_any']);
  });

  it('says a rule as a sentence', () => {
    expect(a.ruleSentence({ factor: 'budget', operator: 'gte', value: '1000000' }, factors)).toBe('Published budget ceiling is at least 1,000,000');
    expect(a.ruleSentence({ factor: 'lead_time', operator: 'between', value: '10,30' }, factors)).toBe('Whole days until closing is between 10 and 30');
    expect(a.ruleSentence({ factor: 'industry', operator: 'in', value: 'Construction, Roads' }, factors)).toBe('Industry on the tender is one of Construction, Roads');
    expect(a.ruleSentence({ factor: 'certifications', operator: 'has_any', value: '' }, factors)).toBe('A mandatory requirement is outstanding');
  });

  it('will not send a rule that could never fire', () => {
    const d = { ...a.ruleDraft(null), name: 'Roads', factor: 'industry' as const, operator: 'equals' as const, value: 'Construction', points: '15' };
    expect(a.ruleBody(d, 9, 1).body).toEqual({ name: 'Roads', factor: 'industry', operator: 'equals', value: 'Construction', points: 15, reason: '', enabled: 1, sort_order: 9, org: '1' });
    expect(a.ruleBody({ ...d, operator: 'gte' }, 9, 1).error).toMatch(/never matches/);
    expect(a.ruleBody({ ...d, factor: 'budget', operator: 'between', value: '30, 10' }, 9, 1).error).toMatch(/lower first/);
    expect(a.ruleBody({ ...d, factor: 'budget', operator: 'gte', value: 'a lot' }, 9, 1).error).toMatch(/is a number/);
    expect(a.ruleBody({ ...d, points: '0' }, 9, 1).error).toMatch(/not 0/);
    expect(a.ruleBody({ ...d, points: '150' }, 9, 1).error).toMatch(/-100 to 100/);
    expect(a.ruleBody({ ...d, factor: 'certifications', operator: 'has_all', value: 'ignored' }, 9, null).body).toMatchObject({ value: '' });
  });

  it('switches a rule on or off by saving it whole, in its own company', () => {
    const r = { id: 3, org_id: 2, name: 'x', factor: 'budget' as const, operator: 'gte' as const, value: '5', points: 10, reason: 'r', enabled: true, sort_order: 4 };
    expect(a.toggledRuleBody(r, r.org_id)).toEqual({ name: 'x', factor: 'budget', operator: 'gte', value: '5', points: 10, reason: 'r', enabled: 0, sort_order: 4, org: '2' });
  });
});

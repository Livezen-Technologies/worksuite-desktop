import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof import('../../../src/core/api')>()), apiGet: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn(), apiDelete: vi.fn() }));

const { ApiError } = await import('../../../src/core/api');
const { setRegional } = await import('../../../src/core/time');
const t = await import('../../../src/modules/tenders/api');

beforeAll(() => setRegional({ timezone: 'Asia/Colombo', locale: 'en-GB' }));

describe('tenders: money', () => {
  it('groups a figure as text, so seventeen digits come back as typed', () => {
    expect(t.grouped('45000000.5')).toBe('45,000,000.50');
    expect(t.grouped('12345678901234567.89')).toBe('12,345,678,901,234,567.89');
    expect(t.grouped('-1200')).toBe('-1,200.00');
    expect(t.grouped('007')).toBe('7.00');
    expect(t.grouped('abc')).toBeNull();
  });

  it('draws a dash for a figure nobody recorded, never 0.00', () => {
    expect(t.money(null, 'LKR')).toBe('—');
    expect(t.money('', 'LKR')).toBe('—');
    expect(t.money('0', 'LKR')).toBe('LKR 0.00');
    expect(t.money('950', null)).toBe('950.00');
  });

  it('keeps currencies apart and leaves out a total the server did not know', () => {
    expect(
      t.moneyList([
        { currency: 'LKR', total: '57500000.50', known: true },
        { currency: 'USD', total: '12000', known: true },
        { currency: 'EUR', total: '0', known: false },
      ]),
    ).toBe('LKR 57,500,000.50 · USD 12,000.00');
    expect(t.moneyList([])).toBe('—');
  });
});

describe('tenders: a row as the server sends it', () => {
  it('reads string ids as numbers and "1" as following', () => {
    const r = t.toTender({ id: '840', org_id: '1', owner_id: null, score: '65', following: '1', title: 'Road', stage: 'new', stage_label: 'New', budget_max: '45000000.00', remaining: { days: 11, text: '11 days left', tone: 'ok', closed: false } });
    expect(r).toMatchObject({ id: 840, org_id: 1, owner_id: null, score: 65, following: true, budget_max: '45000000.00', outcome: 'open', priority: 'normal', currency: 'LKR' });
    expect(r.remaining.text).toBe('11 days left');
  });

  it('takes the board card spelling too (value, owner), and says there is no closing date when none is sent', () => {
    const r = t.toTender({ id: 3, title: 'Card', value: '10', owner: 'Ann', score: null, following: false });
    expect(r).toMatchObject({ budget_max: '10', owner_name: 'Ann', score: null, following: false });
    expect(r.remaining).toEqual({ days: null, text: 'No closing date', tone: 'unknown', closed: false });
  });

  it('puts a score in the first band whose floor it reaches', () => {
    const bands = [
      { min: 0, label: 'Likely not worth bidding', tone: 'amber' },
      { min: 80, label: 'Worth reading first', tone: 'green' },
      { min: 60, label: 'Worth a look', tone: 'blue' },
    ];
    expect(t.bandFor(65, bands)?.label).toBe('Worth a look');
    expect(t.bandFor(80, bands)?.label).toBe('Worth reading first');
    expect(t.bandFor(5, bands)?.label).toBe('Likely not worth bidding');
    expect(t.bandFor(null, bands)).toBeNull();
  });
});

describe('tenders: the lists', () => {
  it('seeds each list from its preset, open tenders only where the rail counts them so', () => {
    expect(t.presetOf('new')).toMatchObject({ stage: 'new', outcome: 'open', sort: 'score', dir: 'desc', page: 1 });
    expect(t.presetOf('preparing').stage).toBe('preparing,internal_review,management_approval,ready');
    expect(t.presetOf('won')).toMatchObject({ outcome: 'won', stage: '' });
    expect(t.presetOf('all')).toEqual(t.BLANK);
  });

  it('offers the several-stage presets in the stage filter by name', () => {
    expect(t.STAGE_GROUPS.map((g) => g.label)).toEqual(['Being prepared', 'Evaluation']);
  });

  it('asks the server in its own spelling', () => {
    expect(t.listQuery(t.presetOf('new'), '')).toEqual({ stage: 'new', outcome: 'open', sort: 'score', dir: 'DESC', page: 1, per_page: 50 });
    const f = { ...t.BLANK, q: '  RFQ_12 ', owner: 'none', closing: 'overdue', following: true, unscored: true, priority: 'high' };
    expect(t.listQuery(f, '3')).toEqual({ org: '3', q: 'RFQ_12', unowned: 1, overdue: 1, following: 1, unscored: 1, priority: 'high', sort: 'closing', dir: 'ASC', page: 1, per_page: 50 });
    expect(t.listQuery({ ...t.BLANK, owner: '7', closing: '14' }, '')).toMatchObject({ owner_id: '7', closing_within: '14' });
  });

  it('draws every working stage, and a finished one only when something is in it', () => {
    const col = (key: string, terminal: boolean, count: number) => ({ key, label: key, group: 'x', terminal, next: [], count, tenders: [] });
    expect(t.boardColumns([col('new', false, 0), col('won', true, 0), col('lost', true, 2)]).map((c) => c.key)).toEqual(['new', 'lost']);
  });

  it('never offers a decision as a bulk move', () => {
    expect(t.NOT_IN_BULK).toEqual(['awarded', 'won', 'lost', 'cancelled']);
  });
});

describe('tenders: the closing time', () => {
  it('sends a day alone as a day, which the server closes at the end of', () => {
    expect(t.closingValue('2026-10-09', '')).toBe('2026-10-09');
    expect(t.closingValue('', '14:00')).toBe('');
  });

  it("sends a time read on the reader's clock as the instant", () => {
    expect(t.closingValue('2026-10-09', '14:00')).toBe('2026-10-09T08:30:00.000Z');
  });

  it("shows a stored instant on the reader's clock", () => {
    expect(t.wallParts('2026-10-09T08:30:00Z')).toEqual({ date: '2026-10-09', time: '14:00' });
    expect(t.wallParts('2026-10-01 05:00:00')).toEqual({ date: '2026-10-01', time: '10:30' });
    expect(t.wallParts(null)).toEqual({ date: '', time: '' });
  });
});

describe('tenders: new and edit', () => {
  const tender = t.toTender({ id: 840, org_id: 1, title: 'Road', organization: 'RDA', reference: 'PRB-1', budget_max: '45000000.00', currency: 'LKR', priority: 'normal', sector: 'government', closing_at: '2026-10-09T08:30:00Z', owner_id: 2 });

  it('sends nothing when nothing changed, and a figure retyped with commas is not a change', () => {
    const before = t.draftOf(tender);
    expect(t.editChanges(before, before)).toEqual({});
    expect(t.editChanges(before, { ...before, budget_max: '45,000,000' })).toEqual({});
  });

  it('sends only what changed, a cleared figure as null, and a moved closing time as the instant', () => {
    const before = t.draftOf(tender);
    expect(t.editChanges(before, { ...before, title: ' Road, phase 2 ', budget_max: '', bid_value: '41,500,000.00', time: '15:00', owner: '', currency: 'usd' })).toEqual({
      title: 'Road, phase 2',
      budget_max: null,
      bid_value: '41500000.00',
      closing_at: '2026-10-09T09:30:00.000Z',
      owner_id: null,
      currency: 'USD',
    });
    expect(t.editChanges(before, { ...before, date: '', time: '' })).toEqual({ closing_at: '' });
  });

  it('will not make a tender without a title, and names the company it is for', () => {
    expect(t.createBody(t.draftOf(null), 1).error).toMatch(/needs a title/);
    const d = { ...t.draftOf(null), title: ' Laptops ', budget_max: '1,200,000', date: '2026-10-01', reference: '' };
    expect(t.createBody(d, 4).body).toEqual({ title: 'Laptops', budget_max: '1200000', closing_at: '2026-10-01', org: '4' });
    expect(t.createBody(d, null).body).not.toHaveProperty('org');
  });
});

describe('tenders: a refused decision', () => {
  it('reads whether it may be recorded anyway, and what is outstanding', () => {
    expect(t.refusalOf(new ApiError(422, 'A tender at New cannot move straight to Won.', null, { may_override: true }))).toEqual({ mayOverride: true, blockers: [] });
    expect(t.refusalOf(new ApiError(422, 'This cannot move yet.', null, { blockers: ['VAT certificate'] }))).toEqual({ mayOverride: false, blockers: ['VAT certificate'] });
    expect(t.refusalOf(new Error('offline'))).toEqual({ mayOverride: false, blockers: [] });
  });
});

describe('tenders: a decision as it is sent', () => {
  it('sends the awarded value and the winning price without their grouping commas', async () => {
    const api = await import('../../../src/core/api');
    vi.mocked(api.apiPost).mockResolvedValue({});
    await t.recordWin(5, { award: '45,500,000', note: '' });
    expect(vi.mocked(api.apiPost)).toHaveBeenLastCalledWith('/api/tenders/5/win', { award_value: '45500000' });
    await t.recordLoss(5, { reason: ' Price ', competitor: '', price: '44 100 000', lessons: '' }, true);
    expect(vi.mocked(api.apiPost)).toHaveBeenLastCalledWith('/api/tenders/5/lose', { lost_reason: 'Price', competitor: null, winning_price: '44100000', lessons: null, override: true });
  });
});

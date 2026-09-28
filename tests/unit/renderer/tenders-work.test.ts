import { beforeAll, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';

vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn(), apiDelete: vi.fn() }));

const api = await import('../../../src/core/api');
const { setRegional } = await import('../../../src/core/time');
const w = await import('../../../src/modules/tenders/work');
const { tiedUp } = await import('../../../src/modules/tenders/Bonds');

beforeAll(() => setRegional({ timezone: 'Asia/Colombo', locale: 'en-GB' }));

const row = (over: Record<string, unknown> = {}) => ({ id: '1', label: 'Tax clearance', mandatory: '1', status: 'missing', is_settled: '0', files: [], ...over });

describe('tenders: the checklist', () => {
  it('reads a line as the server sends it, and takes its word for what is settled', async () => {
    const l = w.toLine(row({ id: '187', section: null, company_doc_id: '4', file_id: null, settled: true, why_not: null, files: [{ id: '9', file_id: '31', version: '2', name: 'VAT.pdf', is_current: '1' }] }));
    expect(l).toMatchObject({ id: 187, mandatory: true, status: 'missing', library: true, settled: true });
    expect(l.files[0]).toMatchObject({ id: 9, file_id: 31, version: 2, current: true });
    expect(w.toLine(row({ status: 'weird' })).status).toBe('missing');
  });

  it('says "no checklist" rather than 100% when nothing is required', async () => {
    vi.mocked(api.apiGet).mockResolvedValueOnce({ items: [], counts: { required: 0 }, completion: 100, packs: [] });
    expect((await w.fetchChecklist(1)).completion).toBeNull();
    vi.mocked(api.apiGet).mockResolvedValueOnce({ items: [row()], counts: { required: 8 }, completion: 25, packs: [] });
    expect((await w.fetchChecklist(1)).completion).toBe(25);
  });

  it("keeps the buyer's order, grouping only where the section changes", () => {
    const lines = [w.toLine(row({ id: 1, section: 'B. Eligibility' })), w.toLine(row({ id: 2, section: 'A. Bid forms' })), w.toLine(row({ id: 3, section: 'A. Bid forms' })), w.toLine(row({ id: 4, section: null }))];
    expect(w.sectionsOf(lines).map((s) => [s.name, s.lines.map((l) => l.id)])).toEqual([
      ['B. Eligibility', [1]],
      ['A. Bid forms', [2, 3]],
      ['Other', [4]],
    ]);
  });

  it('filters to what is outstanding: required and not settled', () => {
    const lines = [w.toLine(row({ id: 1 })), w.toLine(row({ id: 2, is_settled: '1', status: 'approved' })), w.toLine(row({ id: 3, mandatory: '0' })), w.toLine(row({ id: 4, status: 'rejected' }))];
    expect(w.filterLines(lines, 'outstanding').map((l) => l.id)).toEqual([1, 4]);
    expect(w.filterLines(lines, 'optional').map((l) => l.id)).toEqual([3]);
    expect(w.filterLines(lines, 'rejected').map((l) => l.id)).toEqual([4]);
  });

  it('edits a line by sending only what changed', () => {
    const before = w.lineDraft(w.toLine(row({ owner_id: '5', expires_on: '2026-12-31' })));
    expect(w.lineChanges(before, before)).toEqual({});
    expect(w.lineChanges(before, { ...before, mandatory: false, owner: '', expires_on: '', note: ' Chase the bank ' })).toEqual({ mandatory: false, owner_id: null, expires_on: '', note: 'Chase the bank' });
  });
});

describe('tenders: bonds', () => {
  const s = (over: Record<string, unknown>) => w.toSecurity({ id: 1, kind: 'bid_security', amount: '25000.00', currency: 'LKR', status: 'issued', ...over });

  it('adds up what is still tied up per currency, in cents, leaving out what came back', () => {
    expect(tiedUp([s({ amount: '0.10' }), s({ amount: '0.20' }), s({ amount: '99999999999999.99', currency: 'USD' }), s({ amount: '500', status: 'returned' })], 'LKR')).toEqual([
      { currency: 'LKR', total: '0.30' },
      { currency: 'USD', total: '99999999999999.99' },
    ]);
  });

  it('counts the days to an expiry on the calendar, not the clock', () => {
    expect(w.daysTo('2026-10-27', '2026-09-27')).toBe(30);
    expect(w.daysTo('2026-09-20', '2026-09-27')).toBe(-7);
    expect(w.daysTo(null, '2026-09-27')).toBeNull();
  });

  it('will not record a bond without an amount, and edits only what changed', () => {
    const d = w.securityDraft(null, 'LKR');
    expect(w.securityBody(d, null).error).toMatch(/needs an amount/);
    expect(w.securityBody({ ...d, amount: '250,000', currency: 'usd' }, null).body).toMatchObject({ amount: '250000', currency: 'USD', kind: 'bid_security', instrument: 'bank_guarantee' });
    const before = w.securityDraft(s({}), 'LKR');
    expect(w.securityBody({ ...before, amount: '25,000' }, before).body).toEqual({});
    expect(w.securityBody({ ...before, valid_until: '2027-01-31', status: 'extended' }, before).body).toEqual({ valid_until: '2027-01-31', status: 'extended' });
  });
});

describe('tenders: meetings', () => {
  it("sends a meeting's time as the instant, and a questions deadline given as a day alone as that day", () => {
    const d = { ...w.meetingDraft(null), date: '2026-10-05', time: '10:00', qDate: '2026-10-08', mandatory: true };
    expect(w.meetingBody(d, null).body).toMatchObject({ kind: 'pre_bid', scheduled_at: '2026-10-05T04:30:00.000Z', questions_due_at: '2026-10-08', mandatory: true });
    expect(w.meetingBody({ ...d, time: '' }, null).error).toMatch(/date and a time/);
  });

  it('reads a stored meeting back onto the form, and a saved edit carries only the change', () => {
    const m = w.toMeeting({ id: '15', kind: 'pre_bid', scheduled_at: '2026-10-05T04:30:00Z', questions_due_at: '2026-10-08T18:29:59Z', mode: 'physical', mandatory: '1', attended: '0' });
    const before = w.meetingDraft(m);
    expect(before).toMatchObject({ date: '2026-10-05', time: '10:00', qDate: '2026-10-08', qTime: '23:59', mandatory: true });
    expect(w.meetingBody(before, before).body).toEqual({});
    expect(w.meetingBody({ ...before, attended: true, attended_by: 'Nimal' }, before).body).toEqual({ attended: true, attended_by: 'Nimal' });
  });
});

describe('tenders: budget, notice, submission and evaluation', () => {
  it('refuses a cost it cannot read rather than making it 0', () => {
    expect(w.budgetLineBody({ label: 'Labour', category: 'labour', quantity: '2.5', unit_cost: '1,250.50', note: '' }).body).toEqual({ label: 'Labour', category: 'labour', quantity: '2.5', unit_cost: '1250.50' });
    expect(w.budgetLineBody({ label: 'Labour', category: 'labour', quantity: '', unit_cost: '100', note: '' }).body?.quantity).toBe('1');
    expect(w.budgetLineBody({ label: 'Labour', category: 'labour', quantity: '0', unit_cost: '100', note: '' }).error).toMatch(/above nothing/);
    expect(w.budgetLineBody({ label: 'Labour', category: 'labour', quantity: '1', unit_cost: 'about 100', note: '' }).error).toMatch(/an amount/);
    expect(w.budgetLineBody({ label: ' ', category: 'labour', quantity: '1', unit_cost: '1', note: '' }).error).toMatch(/description/);
  });

  it('saves the notice whole, and refuses an issuing period that ends before it starts', () => {
    const d = w.noticeDraft({ committee: 'Procurement Committee', doc_fee_amount: '1500.00' });
    const body = w.noticeBody({ ...d, doc_fee_amount: '1,500', doc_fee_currency: 'lkr' }).body!;
    expect(Object.keys(body).sort()).toEqual([...w.NOTICE_KEYS].sort());
    expect(body).toMatchObject({ committee: 'Procurement Committee', doc_fee_amount: '1500', doc_fee_currency: 'LKR', attention: '' });
    expect(w.noticeBody({ ...d, issuing_from: '2026-10-10', issuing_to: '2026-10-01' }).error).toMatch(/cannot stop being issued/);
  });

  it('records a submission at the moment given, with the bid as a plain figure', () => {
    expect(w.submissionBody({ method: 'portal', date: '2026-10-09', time: '14:00', receipt_no: ' R-12 ', bid_value: '41,500,000', reference: '', note: '' }).body).toEqual({
      method: 'portal',
      submitted_at: '2026-10-09T08:30:00.000Z',
      receipt_no: 'R-12',
      bid_value: '41500000',
    });
    expect(w.submissionBody({ method: 'portal', date: '', time: '', receipt_no: '', bid_value: '', reference: '', note: '' }).error).toMatch(/When/);
    expect(w.submissionBody({ method: 'portal', date: '2026-10-09', time: '', receipt_no: '', bid_value: 'forty', reference: '', note: '' }).error).toMatch(/an amount/);
  });

  it('records an evaluation with a title, and a score only as a number', () => {
    expect(w.evaluationBody({ kind: 'technical', title: 'Technical', body: '', score: '82.5', max_score: '100', date: '2026-10-20' }).body).toMatchObject({ kind: 'technical', title: 'Technical', score: '82.5', max_score: '100' });
    expect(w.evaluationBody({ kind: 'technical', title: 'x', body: '', score: 'high', max_score: '', date: '' }).error).toMatch(/score is a number/);
    expect(w.evaluationBody({ kind: 'technical', title: '', body: '', score: '', max_score: '', date: '' }).error).toMatch(/title/);
  });
});

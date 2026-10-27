import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';
import type { Run, RunDetail } from '../../../src/modules/payroll/api';

vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiPost: vi.fn(async () => ({})), apiPut: vi.fn(async () => ({})), request: vi.fn() }));

const { apiGet, apiPost } = await import('../../../src/core/api');
const api = await import('../../../src/modules/payroll/api');

const get = vi.mocked(apiGet);
const post = vi.mocked(apiPost);
const run = (r: Partial<Run> = {}): Run => ({ id: 7, kind: 'regular', status: 'submitted', created_by: 5, ...r });
const detail = (d: Partial<RunDetail> = {}, r: Partial<Run> = {}): Pick<RunDetail, 'run' | 'can' | 'approvals'> => ({
  run: run(r),
  can: { figures: true, calculate: true, submit: true, approve: true, reopen: false, edit: true },
  approvals: [],
  ...d,
});

/** Payroll's client (WS-PAYROLL-SRS-001): the server adds up pay; this only offers what it would accept (audit D-G07). */
describe('Payroll api', () => {
  beforeEach(() => {
    get.mockReset();
    post.mockClear();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('sends a run back only with a reason, trimmed', async () => {
    await expect(api.rejectRun(7, '   ')).rejects.toThrow(/Say why/);
    expect(post).not.toHaveBeenCalled();
    await api.rejectRun(7, '  Overtime missing ');
    expect(post).toHaveBeenLastCalledWith('/api/payroll/runs/7/reject', { reason: 'Overtime missing' });
  });

  it('approves a step with a note only when one was written', async () => {
    await api.approveRun(7, 2, '  ');
    expect(post).toHaveBeenLastCalledWith('/api/payroll/runs/7/approve', { step: 2, note: undefined });
    await api.approveRun(7, 2, ' Checked ');
    expect(post).toHaveBeenLastCalledWith('/api/payroll/runs/7/approve', { step: 2, note: 'Checked' });
  });

  it('keeps sending back open to an approver who did not prepare the run, blocking issues or not', () => {
    expect(api.rejectBlock(detail(), 8)).toBeNull();
    expect(api.rejectBlock(detail({}, { status: 'locked' }), 8)).toMatch(/in review/);
    expect(api.rejectBlock(detail(), 5)).toMatch(/prepared this run/);
    expect(api.rejectBlock(detail({ can: { ...detail().can, approve: false } }), 8)).toMatch(/permission/);
    // An explicit reject permission wins over approve.
    expect(api.rejectBlock(detail({ can: { ...detail().can, approve: false, reject: true } }), 8)).toBeNull();
  });

  it('refuses a second signature from the same person at another step', () => {
    const d = { ...detail({ approvals: [{ step: 1, status: 'approved', decided_by: 8 }, { step: 2, status: 'pending' }] }), counts: { blocking: 0, warning: 0 } };
    expect(api.approvalBlock(d, 8)).toMatch(/already approved/);
    expect(api.approvalBlock(d, 9)).toBeNull();
  });

  it('titles a run by its period, group and kind', () => {
    expect(api.runTitle(run({ period_name: 'October 2026', group_name: 'Head office' }))).toBe('October 2026 · Head office');
    expect(api.runTitle(run({ period_code: '2026-10', kind: 'off_cycle' }))).toBe('2026-10 · Off-cycle');
    expect(api.runTitle(run({ kind: 'special' }))).toBe('Run 7 · special');
  });

  it('can reverse an effective run once, and never a reversal', () => {
    expect(api.reversible(run({ status: 'locked' }))).toBe(true);
    expect(api.reversible(run({ status: 'paid' }))).toBe(true);
    expect(api.reversible(run({ status: 'submitted' }))).toBe(false);
    expect(api.reversible(run({ status: 'paid', replaced: true }))).toBe(false);
    expect(api.reversible(run({ status: 'locked', kind: 'reversal' }))).toBe(false);
  });

  it('treats a 404 or 405 as "not on this server yet" and anything else as an error', async () => {
    get.mockRejectedValueOnce(Object.assign(new Error('x'), { status: 404 }));
    expect(await api.fetchVariance(7)).toBeNull();
    get.mockResolvedValueOnce({ rows: [] });
    expect(await api.fetchVariance(7, undefined, 5)).toEqual({ rows: [] });
    expect(get).toHaveBeenLastCalledWith('/api/payroll/runs/7/variance', { threshold: 5 }, undefined);
    get.mockRejectedValueOnce(Object.assign(new Error('boom'), { status: 500 }));
    await expect(api.fetchVariance(7)).rejects.toThrow('boom');
  });

  it("shows an enrolment import's refusal (422) instead of throwing it", async () => {
    post.mockRejectedValueOnce(Object.assign(new Error('Invalid'), { status: 422, data: { valid: 1, errors: [{ row: 2, error: 'Unknown employee' }] } }));
    expect(await api.importEnrolments(3, 'csv', false)).toEqual({ dry_run: true, valid: 1, preview: [], errors: [{ row: 2, error: 'Unknown employee' }] });
    post.mockRejectedValueOnce(Object.assign(new Error('Forbidden'), { status: 403 }));
    await expect(api.importEnrolments(3, 'csv', true)).rejects.toThrow('Forbidden');
  });

  it('exports pay assignments as the server writes them, or null on a server without it', async () => {
    const fetchMock = vi.fn(async () => new Response('a,b\n1,2\n', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await api.exportEnrolments(3, true)).toBe('a,b\n1,2\n');
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toMatch(/enrolments\/export\?org_id=3&gross=1/);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })));
    expect(await api.exportEnrolments(3, false)).toBeNull();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ message: 'No access.' }), { status: 403 })));
    await expect(api.exportEnrolments(3, false)).rejects.toThrow('No access.');
  });

  it("names a saved attachment from the server's headers, never with a path in it", async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('x', { headers: { 'content-disposition': 'attachment; filename="../slip 10.pdf"', 'content-type': 'application/pdf' } })));
    expect(await api.attachmentName(4)).toBe('..-slip 10.pdf');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('x', { headers: { 'content-type': 'image/png' } })));
    expect(await api.attachmentName(4)).toBe('Input 4 attachment.png');
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('offline'))));
    expect(await api.attachmentName(4)).toBe('Input 4 attachment');
  });

  it('accepts what the server takes for a statutory number, and lists each company once', () => {
    for (const ok of ['', '199012345678', 'EPF/123-4']) expect(api.statutoryIdOk(ok)).toBe(true);
    for (const bad of ['12 34', 'x'.repeat(41), '<b>']) expect(api.statutoryIdOk(bad)).toBe(false);
    expect(api.groupCompanies([{ org_id: 2 }, { org_id: 2 }, { org_id: 0 }, { org_id: 5 }] as never)).toEqual([2, 5]);
    expect(api.groupCompanies(undefined)).toEqual([]);
  });

  it('sends expense claims to payroll, all or the ones chosen', async () => {
    await api.sendExpenses(3);
    expect(post).toHaveBeenLastCalledWith('/api/payroll/expenses/send', { org_id: 3 });
    await api.sendExpenses(3, [11, 12]);
    expect(post).toHaveBeenLastCalledWith('/api/payroll/expenses/send', { org_id: 3, claim_ids: [11, 12] });
  });

  it('allows the supporting files the server files', () => {
    expect(api.ATTACHMENT_TYPES.test('slip.PDF')).toBe(true);
    expect(api.ATTACHMENT_TYPES.test('run.exe')).toBe(false);
    expect(api.ATTACHMENT_MAX).toBe(10 * 1024 * 1024);
  });
});

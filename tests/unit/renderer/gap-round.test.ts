import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(), on: () => () => undefined, errorMessage: (e: unknown) => String(e) }));
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<object>()), apiPost: vi.fn(async () => ({})) }));

import { ApiError, apiPost } from '../../../src/core/api';
import { chequeDocPath, pngBase64 } from '../../../shared/cheque';
import { paidOnline } from '../../../src/modules/appointments/api';
import { isStepUpRequired } from '../../../src/modules/cheque/api';
import { answerStepUp, withStepUp } from '../../../src/modules/cheque/StepUp';
import { groupCompanies, importEnrolments, reversible, statutoryIdOk, type Run } from '../../../src/modules/payroll/api';

describe('Payroll 1.3–1.6 on the desktop', () => {
  it('offers a reversal only for an effective run that was not replaced', () => {
    const r = (status: string, extra: Partial<Run> = {}) => ({ id: 1, kind: 'regular', status, ...extra }) as Run;
    expect(reversible(r('locked'))).toBe(true);
    expect(reversible(r('paid'))).toBe(true);
    expect(reversible(r('calculated'))).toBe(false);
    expect(reversible(r('paid', { replaced: true }))).toBe(false);
    expect(reversible(r('locked', { kind: 'reversal' }))).toBe(false);
  });
  it('checks statutory identifiers as the server does and reads the companies of the pay groups', () => {
    expect(statutoryIdOk('199012345678')).toBe(true);
    expect(statutoryIdOk('EPF/123-4')).toBe(true);
    expect(statutoryIdOk('')).toBe(true);
    expect(statutoryIdOk('12 34')).toBe(false);
    expect(statutoryIdOk('x'.repeat(41))).toBe(false);
    expect(groupCompanies([{ org_id: 2 }, { org_id: 2 }, { org_id: 5 }] as never)).toEqual([2, 5]);
  });
  it('shows a refused assignment import (422) instead of throwing it', async () => {
    vi.mocked(apiPost).mockRejectedValueOnce(new ApiError(422, 'Fix the rows.', null, { dry_run: true, valid: 1, errors: [{ row: 3, error: 'Unknown group' }], preview: [] }));
    const r = await importEnrolments(1, 'employee_no,group_code\nE1,X', true);
    expect(r.errors).toEqual([{ row: 3, error: 'Unknown group' }]);
  });
});

describe('Cheque 1.2 on the station', () => {
  it('asks for a step-up on 428 and sends the action once more with the token', async () => {
    const run = vi.fn(async (token?: string) => {
      if (!token) throw new ApiError(428, 'Step up first.', null, { code: 'STEP_UP_REQUIRED' });
      return token;
    });
    const p = withStepUp('Asking for a reprint', run);
    await new Promise((r) => setTimeout(r, 0));
    answerStepUp('stp_1');
    await expect(p).resolves.toBe('stp_1');
    expect(run).toHaveBeenCalledTimes(2);
    expect(isStepUpRequired(new ApiError(409, 'x', null, null))).toBe(false);
    const q = withStepUp('Voiding', run);
    await new Promise((r) => setTimeout(r, 0));
    answerStepUp(null);
    await expect(q).rejects.toThrow('Step up first.');
  });
  it('reads only real PNGs as signatures, and knows where each PDF is', () => {
    expect(pngBase64('data:image/png;base64,iVBORw0KGgoAAAA')).toBe('iVBORw0KGgoAAAA');
    expect(pngBase64('data:image/svg+xml;base64,PHN2Zz4=')).toBeNull();
    expect(pngBase64('R0lGODlh')).toBeNull();
    expect(chequeDocPath({ kind: 'voucher', id: '12' })).toBe('/api/cheque/cheques/12/voucher.pdf');
    expect(chequeDocPath({ kind: 'return-letter', id: '4' })).toBe('/api/cheque/returns/4/letter.pdf');
  });
});

describe('Appointments 1.2 at checkout', () => {
  it('reads the deposit paid online whichever shape the server sends', () => {
    expect(paidOnline(undefined)).toBe(0);
    expect(paidOnline('1500.00')).toBe(1500);
    expect(paidOnline({ amount: 2000, currency: 'LKR' })).toBe(2000);
  });
});

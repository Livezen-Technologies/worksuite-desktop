// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(async () => ({ verified: true, method: 'touch-id' })), on: () => () => undefined, errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)), isMac: false, registerDropped: vi.fn() }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<object>()), apiGet: vi.fn(), apiPost: vi.fn(async () => ({})), apiPut: vi.fn(async () => ({})) }));

import { apiGet, apiPost } from '../../../src/core/api';
import { call } from '../../../src/core/bridge';
import { app } from '../../../src/core/app-state';
import { approvalBlock, csvRows, orNull, pendingStep, percent, preparerOf, rejectRun, type RunDetail } from '../../../src/modules/payroll/api';
import RunApproval from '../../../src/modules/payroll/RunApproval';
import { toCsv } from '../../../src/modules/payroll/Reports';
import { readiness } from '../../../src/modules/payroll/Employees';
import { companiesOf, groupLines, inCompany, raiseQuery } from '../../../src/modules/hr/pay';
import type { PayLine, Payslip } from '../../../src/modules/hr/api';
import { payrollNoticeLink, payrollReminders } from '../../../shared/payroll';

const wrap = (ui: ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);

function detail(over: Partial<RunDetail> = {}, run: Partial<RunDetail['run']> = {}): RunDetail {
  return {
    run: { id: 7, kind: 'regular', status: 'submitted', period_name: 'September 2026', group_name: 'Staff – Colombo', currency: 'LKR', created_by: 5, ...run },
    payslips: [],
    exceptions: [],
    counts: { blocking: 0, warning: 2 },
    self_employee_id: null,
    approvals: [{ step: 1, status: 'pending', requested_by: 5 }],
    can: { figures: true, calculate: true, submit: true, approve: true, reopen: true, edit: true },
    ...over,
  };
}
const slip = (ref: string, employer: string): Payslip => ({ reference: ref, period_name: ref, period_starts_on: null, period_ends_on: null, payment_date: null, gross: '1.00', deductions: '0.00', net: '1.00', paid_days: null, state: 'current', revision_note: null, payment: { state: 'paid', on: null, detail: null }, employer: { name: employer } });
const line = (kind: string, label: string, amount: string): PayLine => ({ component_code: label, label, kind, class: '', amount, rate: null, quantity: null });

beforeEach(() => {
  vi.mocked(apiPost).mockClear();
  vi.mocked(call).mockClear();
});
afterEach(() => cleanup());

describe('maker-checker (PAY-RUN-08)', () => {
  it('names the preparer from the payload, newest source first', () => {
    expect(preparerOf(detail().run, [{ step: 1, status: 'pending', requested_by: 9 }])).toBe(9);
    expect(preparerOf(detail({}, { prepared_by: { id: 3 } }).run)).toBe(3);
    expect(preparerOf(detail({}, { created_by: null }).run)).toBeNull();
  });
  it('refuses the preparer, blocking issues and a run not in review — and allows a second person', () => {
    expect(approvalBlock(detail(), 5)).toMatch(/prepared this run/);
    expect(approvalBlock(detail({ counts: { blocking: 2, warning: 0 } }), 8)).toMatch(/2 blocking issues/);
    expect(approvalBlock(detail({}, { status: 'calculated' }), 8)).toMatch(/in review/);
    expect(approvalBlock(detail({ can: { ...detail().can, approve: false } }), 8)).toMatch(/permission/);
    expect(approvalBlock(detail(), 8)).toBeNull();
  });
  it('signs the lowest pending step', () => {
    expect(pendingStep([{ step: 2, status: 'pending' }, { step: 1, status: 'approved' }])).toBe(2);
    expect(pendingStep([])).toBe(1);
  });
  it('will not reject without a reason, and sends it trimmed', async () => {
    await expect(rejectRun(7, '  ')).rejects.toThrow(/why/);
    expect(apiPost).not.toHaveBeenCalled();
    await rejectRun(7, ' OT not checked ');
    expect(apiPost).toHaveBeenCalledWith('/api/payroll/runs/7/reject', { reason: 'OT not checked' });
  });
});

describe('the approval screen (D07)', () => {
  const serve = (d: RunDetail) =>
    vi.mocked(apiGet).mockImplementation(async (path: string) => {
      if (path.endsWith('/runs/7')) return d;
      if (path.endsWith('/posting')) return { ok: true, problems: [], journal_id: null, posted: false, can: { post: true }, lines: [{ account_code: '6100', account_name: 'Salaries', role: 'salaries_expense', debit: '100.00', credit: '0.00' }], totals: { debit: '100.00', credit: '100.00', balanced: true } };
      if (path.endsWith('/variance')) return { previous_run_id: 6, threshold: 10, employees: [], components: [{ label: 'Overtime', prev: '1.00', current: '2.00', diff: '1.00', pct: 37.9, flagged: true }], totals: { prev_net: '1', net: '1', diff: '0', pct: 2.1 } };
      throw new Error(`unexpected ${path}`);
    });
  it('keeps Approve off for the person who prepared the run', async () => {
    app.set({ auth: { user: { id: 5, name: 'Hasarinda M.' } } } as never);
    serve(detail());
    wrap(<RunApproval id={7} onBack={() => undefined} onDone={() => undefined} />);
    const approve = await screen.findByRole('button', { name: 'Approve run' });
    expect((approve as HTMLButtonElement).disabled).toBe(true);
    expect(await screen.findByText('You prepared this run, so somebody else has to approve it.')).toBeTruthy();
    expect(await screen.findByText('Overtime +37.9%')).toBeTruthy();
    expect(await screen.findByText('Balanced')).toBeTruthy();
  });
  it('asks for Touch ID, then approves the pending step with the note', async () => {
    app.set({ auth: { user: { id: 8, name: 'Dilani F.' } } } as never);
    serve(detail());
    const done = vi.fn();
    wrap(<RunApproval id={7} onBack={() => undefined} onDone={done} />);
    fireEvent.change(await screen.findByLabelText('Note to preparer'), { target: { value: 'OT checked with Ops' } });
    fireEvent.click(screen.getByRole('button', { name: 'Approve run' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/payroll/runs/7/approve', { step: 1, note: 'OT checked with Ops' }));
    expect(call).toHaveBeenCalledWith('payroll:verify', expect.objectContaining({ reason: expect.stringContaining('payroll') }));
    expect(done).toHaveBeenCalled();
  });
  it('does not approve when Touch ID is declined', async () => {
    app.set({ auth: { user: { id: 8 } } } as never);
    vi.mocked(call).mockResolvedValueOnce({ verified: false, method: 'touch-id' } as never);
    serve(detail());
    wrap(<RunApproval id={7} onBack={() => undefined} onDone={() => undefined} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Approve run' }));
    await waitFor(() => expect(call).toHaveBeenCalled());
    expect(apiPost).not.toHaveBeenCalled();
  });
});

describe('payroll helpers', () => {
  it('reads a CSV with quotes, commas and blank lines', () => {
    expect(csvRows('employee_no,component_code,amount\r\nE1,COMMISSION,"25,000.00"\n\nE2,"A ""B""",1\n')).toEqual([
      ['employee_no', 'component_code', 'amount'],
      ['E1', 'COMMISSION', '25,000.00'],
      ['E2', 'A "B"', '1'],
    ]);
  });
  it('writes a report back as the server sent it', () => {
    expect(toCsv({ columns: [{ key: 'name', label: 'Employee' }, { key: 'net', label: 'Net' }], rows: [{ name: 'Perera, N', net: '146420.00' }], totals: { name: 'Total', net: '146420.00' } })).toBe('Employee,Net\n"Perera, N",146420.00\nTotal,146420.00\n');
  });
  it('formats a server percentage and treats a missing endpoint as nothing', async () => {
    expect(percent(2.1)).toBe('+2.1%');
    expect(percent('-10')).toBe('-10.0%');
    expect(percent(null)).toBeNull();
    await expect(orNull(Promise.reject(Object.assign(new Error('x'), { status: 404 })))).resolves.toBeNull();
    await expect(orNull(Promise.reject(Object.assign(new Error('x'), { status: 500 })))).rejects.toThrow();
  });
  it('knows who is ready to be paid', () => {
    expect(readiness({ id: 1, employee_id: 1, group_id: null })).toBe('unassigned');
    expect(readiness({ id: 1, employee_id: 1, group_id: 2, bank_verified: 0 })).toBe('attention');
    expect(readiness({ id: 1, employee_id: 1, group_id: 2, bank_verified: 1 })).toBe('ready');
  });
});

describe('my payslips (UI-23 / D23)', () => {
  it('lists the companies once and filters by one', () => {
    const all = [slip('Sep', 'CreativeFX'), slip('Aug', 'Dubai LLC'), slip('Jul', 'CreativeFX')];
    expect(companiesOf(all)).toEqual(['CreativeFX', 'Dubai LLC']);
    expect(inCompany(all, 'Dubai LLC').map((s) => s.reference)).toEqual(['Aug']);
    expect(inCompany(all, '')).toHaveLength(3);
  });
  it('groups lines as the payslip shows them', () => {
    const g = groupLines([line('earning', 'Basic', '150000.00'), line('deduction', 'EPF 8%', '12280.00'), line('adjustment', 'Recovery', '-3000.00'), line('employer_cost', 'EPF 12%', '18420.00'), line('information', 'Leave left', '9.5')]);
    expect(g.earnings.map((l) => l.label)).toEqual(['Basic']);
    expect(g.deductions.map((l) => l.label)).toEqual(['EPF 8%', 'Recovery']);
    expect(g.employer.map((l) => l.label)).toEqual(['EPF 12%']);
  });
  it('raises a payslip query as an HR request carrying the reference', async () => {
    await expect(raiseQuery(4, slip('REF1', 'X'), ' ')).rejects.toThrow();
    await raiseQuery(4, slip('REF1', 'X'), 'Why is OT lower?');
    expect(apiPost).toHaveBeenCalledWith('/api/hr/requests', { employee_id: 4, kind: 'payroll_query', reason: 'Why is OT lower?', payload: { payslip_reference: 'REF1', period: 'REF1' } });
  });
});

describe('tray and notifications (D24)', () => {
  it('opens the right screen for each payroll notice', () => {
    expect(payrollNoticeLink('payroll.needs_approval', { run_id: 7 })).toBe('/payroll?tab=approve&run=7');
    expect(payrollNoticeLink('payroll.needs_approval')).toBe('/payroll?tab=runs');
    expect(payrollNoticeLink('payroll.payslip_ready')).toBe('/hr?tab=mypay');
    expect(payrollNoticeLink('payroll.run.rejected', { run_id: '9' })).toBe('/payroll?tab=run&run=9');
    expect(payrollNoticeLink('mail.received')).toBeNull();
  });
  it('reminds of the cut-off, approvals and the pay date only when they are near', () => {
    const d = { next_period: { id: 3, name: 'Sep 2026', attendance_cutoff: '2026-09-25', payment_date: '2026-09-30' }, pending_approvals: 1, current_run: { id: 7, status: 'submitted' } };
    expect(payrollReminders(d, '2026-09-20').map((r) => r.title)).toEqual(['Payroll approval needed']);
    expect(payrollReminders(d, '2026-09-24').map((r) => r.title)).toEqual(['Payroll cut-off in 1 day', 'Payroll approval needed']);
    const payday = payrollReminders({ ...d, pending_approvals: 0 }, '2026-09-30');
    expect(payday.map((r) => [r.title, r.link])).toEqual([['Pay date today', '/payroll?tab=disbursements']]);
    expect(payrollReminders(d, '2026-09-24')[1]!.link).toBe('/payroll?tab=approve&run=7');
    expect(payrollReminders(null, '2026-09-24')).toEqual([]);
  });
});

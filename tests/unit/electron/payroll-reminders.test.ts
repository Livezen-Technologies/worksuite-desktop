import { describe, expect, it, vi } from 'vitest';
import { PayrollReminders } from '../../../electron/services/payroll-reminders';

describe('payroll tray reminders (D24)', () => {
  const dashboard = { next_period: { id: 3, name: 'Sep 2026', attendance_cutoff: '2026-09-25', payment_date: '2026-09-30' }, pending_approvals: 2, current_run: null };

  it('shows each reminder once per day, as a local notice that opens Payroll', async () => {
    const seen = new Set<string>();
    const sink = { addLocal: vi.fn((i: { id: string }) => (seen.has(i.id) ? false : (seen.add(i.id), true))), notify: vi.fn() };
    const r = new PayrollReminders({ get: vi.fn(async () => dashboard) as never }, sink, () => '2026-09-24');
    expect(await r.tick()).toBe(2);
    expect(await r.tick()).toBe(0);
    expect(sink.notify).toHaveBeenCalledWith(expect.objectContaining({ module: 'payroll', title: 'Payroll approval needed', link: '/payroll?tab=runs' }));
  });

  it('stays quiet for somebody without payroll access', async () => {
    const sink = { addLocal: vi.fn(() => true), notify: vi.fn() };
    const r = new PayrollReminders({ get: vi.fn(async () => Promise.reject(new Error('403'))) as never }, sink, () => '2026-09-24');
    expect(await r.tick()).toBe(0);
    expect(sink.notify).not.toHaveBeenCalled();
  });
});

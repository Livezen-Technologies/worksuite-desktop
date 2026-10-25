/**
 * Payroll on the desktop's tray and notifications (D24): which screen each `payroll.*` notice opens, and the
 * reminders this computer raises itself from the server's dashboard — the cut-off coming, runs waiting for
 * approval, the pay date — so they arrive even when the Payroll tab is closed. Pure: the service in
 * electron/services/payroll-reminders.ts fetches and shows them.
 */

const id = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : typeof v === 'string' && /^\d{1,12}$/.test(v) ? Number(v) : null);

/** The desktop link for a payroll notification, or null when the key is not one of ours. */
export function payrollNoticeLink(event: string | null | undefined, data?: unknown): string | null {
  if (!event || !event.startsWith('payroll.')) return null;
  const d = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  const run = id(d.run_id);
  switch (event) {
    case 'payroll.needs_approval':
    case 'payroll.approve':
      return run ? `/payroll?tab=approve&run=${run}` : '/payroll?tab=runs';
    case 'payroll.payslip_ready':
      return '/hr?tab=mypay';
    case 'payroll.run.approved':
    case 'payroll.run.rejected':
    case 'payroll.calculated':
      return run ? `/payroll?tab=run&run=${run}` : '/payroll?tab=runs';
    default:
      return run ? `/payroll?tab=run&run=${run}` : '/payroll';
  }
}

/** The part of `GET /api/payroll/dashboard` the reminders read. */
export interface ReminderDashboard {
  next_period?: { id: number; name: string; attendance_cutoff?: string | null; payment_date?: string | null } | null;
  pending_approvals?: number;
  current_run?: { id: number; status: string } | null;
}

export interface PayrollReminder {
  /** Stable per day and subject, so the same reminder is shown once. */
  id: string;
  title: string;
  body: string;
  link: string;
}

const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/** The reminders due today (`today` as YYYY-MM-DD, the person's own day). */
export function payrollReminders(d: ReminderDashboard | null | undefined, today: string): PayrollReminder[] {
  if (!d) return [];
  const out: PayrollReminder[] = [];
  const p = d.next_period;
  if (p?.attendance_cutoff) {
    const n = daysBetween(today, p.attendance_cutoff.slice(0, 10));
    if (n >= 0 && n <= 2) out.push({ id: `payroll:cutoff:${p.id}:${today}`, title: n === 0 ? 'Payroll cut-off today' : `Payroll cut-off in ${n} ${n === 1 ? 'day' : 'days'}`, body: `${p.name}: inputs, overtime and open attendance days need to be in before the cut-off.`, link: '/payroll?tab=inputs' });
  }
  if ((d.pending_approvals ?? 0) > 0) {
    const n = d.pending_approvals!;
    out.push({ id: `payroll:approvals:${today}`, title: 'Payroll approval needed', body: `${n} ${n === 1 ? 'run is' : 'runs are'} waiting for approval.`, link: d.current_run?.status === 'submitted' ? `/payroll?tab=approve&run=${d.current_run.id}` : '/payroll?tab=runs' });
  }
  if (p?.payment_date) {
    const n = daysBetween(today, p.payment_date.slice(0, 10));
    if (n >= 0 && n <= 1) out.push({ id: `payroll:payday:${p.id}:${today}`, title: n === 0 ? 'Pay date today' : 'Pay date tomorrow', body: `${p.name}: check the payment batches are with the bank.`, link: '/payroll?tab=disbursements' });
  }
  return out;
}

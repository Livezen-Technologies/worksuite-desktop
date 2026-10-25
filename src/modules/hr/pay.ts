import { apiGet, apiPost } from '../../core/api';
import type { PayLine, PayLoan, Payslip, TaxCertificate } from './api';

/**
 * My payslips (UI-23) without the screen: the companies a person's payslips come from, a payslip's lines in the
 * three groups the payslip shows, and the two v1.1 extras — tax certificates and a payslip query — which an older
 * server does not have. Nothing is summed here: gross, deductions and net are the payslip's own figures.
 */

export const ALL = '';

/** The companies on these payslips, in the order first met (newest payslip first). */
export function companiesOf(slips: Payslip[]): string[] {
  const out: string[] = [];
  for (const s of slips) {
    const n = s.employer?.name?.trim();
    if (n && !out.includes(n)) out.push(n);
  }
  return out;
}

export function inCompany(slips: Payslip[], company: string): Payslip[] {
  return company === ALL ? slips : slips.filter((s) => (s.employer?.name?.trim() ?? '') === company);
}

/** Earnings (and adjustments that add), deductions, and what the employer paid on top — information lines left out. */
export function groupLines(lines: PayLine[]): { earnings: PayLine[]; deductions: PayLine[]; employer: PayLine[] } {
  const earnings: PayLine[] = [];
  const deductions: PayLine[] = [];
  const employer: PayLine[] = [];
  for (const l of lines) {
    if (l.kind === 'employer_cost') employer.push(l);
    else if (l.kind === 'deduction' || (l.kind === 'adjustment' && String(l.amount).trim().startsWith('-'))) deductions.push(l);
    else if (l.kind !== 'information') earnings.push(l);
  }
  return { earnings, deductions, employer };
}

/** An amount without its sign, for a line already shown under "deductions". */
export const unsigned = (v: string) => String(v).trim().replace(/^[-+]/, '');

/** A line's label with its quantity where there is one ("Overtime 1.5× · 8 h"). */
export function lineLabel(l: PayLine): string {
  return l.quantity && Number(l.quantity) !== 1 && Number(l.quantity) !== 0 ? `${l.label} (${l.quantity})` : l.label;
}

const notThere = (e: unknown) => [404, 405].includes((e as { status?: number }).status ?? 0);

/** My annual certificates; none on a server that does not issue them yet. */
export async function fetchCertificates(signal?: AbortSignal): Promise<TaxCertificate[]> {
  try {
    const r = await apiGet<{ certificates: TaxCertificate[] }>('/api/payroll/me/tax-certificates', undefined, signal);
    return r.certificates ?? [];
  } catch (e) {
    if (notThere(e)) return [];
    throw e;
  }
}

export type PayslipDetail = { payslip: Payslip; lines: PayLine[]; loans?: PayLoan[] };

/** The HR request kind a payslip query is raised as (PAY-SLP-05). */
export const QUERY_KIND = 'payroll_query';

/** Raises a question about one payslip as an HR request; the reference goes with it so HR can open the payslip. */
export function raiseQuery(employeeId: number, payslip: Payslip, question: string): Promise<unknown> {
  const q = question.trim();
  if (!q) return Promise.reject(new Error('Write your question first.'));
  return apiPost('/api/hr/requests', { employee_id: employeeId, kind: QUERY_KIND, reason: q, payload: { payslip_reference: payslip.reference, period: payslip.period_name } });
}

import type { AiEngine, AiModuleAccessPrefs } from '@shared/types';
import { app } from '../../core/app-state';
import { ApiError, apiPost } from '../../core/api';
import { effective, personal, type OrgAccess } from './tools';
import type { AskSource } from './assistant';

export interface SalesAccess { orgId: string | null; engine: AiEngine; connected: boolean; denied: string | null }
export interface SalesTotal {
  company: { id: number; name: string };
  date: string;
  timezone: string;
  from: string;
  to_exclusive: string;
  basis: string;
  totals: Array<{ currency: string; total: string; count: number }>;
  records_url: string;
}
export function salesAccess(engine: AiEngine, org: OrgAccess | null | undefined, prefs: AiModuleAccessPrefs | undefined, connected: boolean): SalesAccess {
  const billing = org?.modules?.find((m) => m.key === 'billing');
  const denied = billing ? effective(billing, engine, prefs).readWhy : !personal(prefs, engine, 'billing').read ? `You turned Billing data off for ${engine === 'local' ? 'Local AI' : 'WorkSuite AI'} in Settings › AI Assistant › Module Access.` : null;
  return { orgId: app.get().organizationId, engine, connected, denied };
}
/** Both AI engines use the same authorized query, with no model-generated arithmetic. */
export async function todaySales(access: SalesAccess | undefined): Promise<{ text: string; sources: AskSource[] }> {
  if (!access?.connected) throw new Error('Today’s sales data is unavailable while offline. Connect to WorkSuite to retrieve an authorized total.');
  if (access.denied) throw new Error(access.denied);
  let report: SalesTotal;
  try {
    report = await apiPost<SalesTotal>('/api/ai/assist/sales-today', { org_id: access.orgId, engine: access.engine });
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) throw new Error('This WorkSuite server does not support today’s sales reporting yet. Update the server to enable it. No sales total was retrieved.');
    throw e;
  }
  if (!report?.company || !report.date || !report.timezone || !report.basis || !Array.isArray(report.totals) || !report.records_url?.startsWith('/billing?')) throw new Error('WorkSuite did not return a complete sales report. No sales total can be confirmed.');
  if (report.totals.some((t) => !/^[A-Z]{3}$/.test(t.currency) || !/^-?\d+(?:\.\d+)?$/.test(t.total) || !Number.isSafeInteger(t.count) || t.count < 0)) throw new Error('WorkSuite returned an invalid sales total. No sales total can be confirmed.');
  const amounts = report.totals.map((t) => `${t.currency} ${t.total} (${t.count} ${t.count === 1 ? 'invoice' : 'invoices'})`);
  return {
    text: [`Today’s sales · ${report.company.name}`, `${report.date} · ${report.timezone}`, ...(amounts.length ? amounts : ['No issued sales invoices for this date; no currency total is available.']), `Basis: ${report.basis}`, 'Currencies are reported separately; no conversion was applied.'].join('\n'),
    sources: [{ n: 1, kind: 'record', title: 'Supporting sales invoices', url: report.records_url }],
  };
}

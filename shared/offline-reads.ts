/**
 * Read-only offline for Finance, Expenses, Marketing, Cheque Manager and Recruitment (audit D-G14): which of their GET
 * answers the main process keeps in the encrypted offline cache (the manifest's READ_CACHE), so each module opens from
 * this computer's copy with its "as of" time while WorkSuite is out of reach. Every write waits for the connection
 * (src/core/offline-read.ts refuses it and the screens say so).
 *
 * Never kept, whatever the module: anything that is a secret or good once — share links and their tokens, exports and
 * downloads (files are not this cache's), webhook and provider credentials, one-time print checks, step-up answers —
 * and anything under `/files`, `/attachments`, `/documents`, `/receipt`.
 */

export interface OfflineReadModule {
  /** The registry module id. */
  module: 'finance' | 'expenses' | 'marketing' | 'cheque' | 'recruitment';
  /** The API prefix the module reads under. */
  prefix: string;
  /** What the banner calls it. */
  label: string;
}

export const OFFLINE_READ_MODULES: readonly OfflineReadModule[] = [
  { module: 'finance', prefix: '/api/finance', label: 'Finance' },
  { module: 'expenses', prefix: '/api/expense', label: 'Expenses' },
  { module: 'marketing', prefix: '/api/marketing', label: 'Marketing' },
  { module: 'cheque', prefix: '/api/cheque', label: 'Cheque Manager' },
  { module: 'recruitment', prefix: '/api/recruitment', label: 'Recruitment' },
];

/** Secrets and one-time answers, in any of the modules: never written to the cache. */
const NEVER = /\/(export|exports|share|shares|download|downloads|files?|attachments?|documents?|receipts?|token|tokens|secret|secrets|credentials|webhooks|step-up|stepup|pre-print-checks|calibration-sheet|print|preview|signed-url|otp)(\/|$)/;

/** What each module keeps: its lists, dashboards and the records opened (an id, or a record's own read). */
const KEPT: Record<OfflineReadModule['module'], RegExp> = {
  // The books as last read: dashboards and overviews, the chart, journals and each one opened, the ledger, the
  // statements, periods, budgets, tax codes, rates, banking and reconciliations, the unposted list and the settings.
  finance:
    /^\/api\/finance(?:\/(?:companies|dashboard|overview\/[a-z-]{1,40}|accounts|journals|journals\/\d{1,12}|ledger|trial-balance|cash-flow|changes-in-equity|periods|budgets|budgets\/\d{1,12}|tax-codes|tax-codes\/\d{1,12}|exchange-rates|depreciation|asset-accounts|purchase-accounts|bank-accounts|bank-accounts\/\d{1,12}(?:\/(?:transactions|reconciliations))?|bank-transactions\/\d{1,12}|reconciliations\/\d{1,12}|unposted|settings|access|access\/members|annual-report|close-tasks|dimensions))?$/,
  // Claims and the queues: my claims and each opened, approvals, advances, petty cash, budgets, policies, vendors,
  // subscriptions, reimbursement runs and the lookups. Not the cards (card details stay on the server).
  expenses:
    /^\/api\/expense(?:\/(?:access|organizations|dashboard\d{0,12}|claims\d{0,12}|claims\d{0,12}\/\d{1,12}|reports\d{0,12}|reports\d{0,12}\/\d{1,12}|approvals|advances|advances\/\d{1,12}|petty-cash|petty-cash\/\d{1,12}|budgets|budgets\/\d{1,12}|policies|approval-rules|vendors|vendors\/list|subscriptions|subscriptions\/\d{1,12}|runs|payable|postings|categories\d{0,12}|cost-centres|members|payment-methods|rates|settings\d{0,12}|activity|consolidated|related|duplicates))?$/,
  // The audience and the campaigns as last seen: dashboard, contacts and companies opened, lists, segments, campaigns
  // and their reports, journeys, forms, pages, templates, topics, consents, scores and the call campaigns' queue.
  marketing:
    /^\/api\/marketing(?:\/(?:options|dashboard|pulse|calendar|contacts|contacts\/\d{1,12}|contacts\/duplicates|contacts\/merges|companies|companies\/\d{1,12}|lists|lists\/\d{1,12}|segments|segments\/\d{1,12}|campaigns|campaigns\/\d{1,12}(?:\/(?:report|stats|activity|links|recipients))?|campaigns\/senders|journeys|journeys\/\d{1,12}|forms|forms\/\d{1,12}|pages|pages\/\d{1,12}|templates|topics|consents|suppressions|scores|custom-fields|utm-links|reports\/[a-z-]{1,40}|calls\/campaigns|calls\/campaigns\/\d{1,12}|calls\/scripts|calls\/scripts\/\d{1,12}|calls\/queue|calls\/queue\/list|calls\/callbacks|calls\/log\/\d{1,12}))?$/,
  // The print station's lists: access, the dashboard, the queue of approved cheques, batches and each one opened,
  // sources, bank accounts, returns and the templates list. Never a pre-print check or a calibration sheet: both are
  // asked for at the moment of printing, for that printer.
  cheque: /^\/api\/cheque(?:\/(?:me|dashboard|cheques|cheques\/sources|batches|batches\/\d{1,12}|bank-accounts|returns|templates|printers))?$/,
  // The hiring desk as last seen: meta, open jobs and each pipeline, the screening queue and each candidate opened,
  // my interviews, their kits and my evaluations, and the approvals. Never a CV or any other document.
  recruitment: /^\/api\/recruitment(?:\/(?:meta|jobs|jobs\/\d{1,12}\/pipeline|candidates|candidates\/\d{1,12}|interviews|interviews\/\d{1,12}|interviews\/\d{1,12}\/kit|evaluations|approvals))?$/,
};

/** The module whose read-only offline copy keeps this GET path, or null (not kept, or never kept). */
export function offlineReadModule(path: string): OfflineReadModule['module'] | null {
  const clean = path.split('?')[0]!;
  if (NEVER.test(clean)) return null;
  for (const m of OFFLINE_READ_MODULES) if ((clean === m.prefix || clean.startsWith(`${m.prefix}/`)) && KEPT[m.module].test(clean)) return m.module;
  return null;
}

/** The read-only-offline module an API path belongs to (any method), for refusing its writes offline. */
export function offlineReadOwner(path: string): OfflineReadModule | null {
  const clean = path.split('?')[0]!;
  return OFFLINE_READ_MODULES.find((m) => clean === m.prefix || clean.startsWith(`${m.prefix}/`)) ?? null;
}

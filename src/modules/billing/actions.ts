import { apiDelete, apiGet, apiPost, ApiError, request } from '../../core/api';

/**
 * Billing SRS-BIL-001 on the desktop: what an invoice can now do beyond its
 * figures — send it (G-05, the Send dialog), its pay link (G-02/G-03), its
 * approval before issue (G-14), cancelling with the journal reversed (G-01)
 * and the `period_locked` refusal, the bulk acts and exports (G-13), its
 * attachments (G-26), a dispute flag (G-05 dunning) and a customer's
 * statement. The server decides everything; these are its calls and the few
 * pure helpers the screens need to say what happened.
 */

// ── send (W12 / G-05) ───────────────────────────────────────────────────

export interface SendBody {
  to: string[];
  cc: string[];
  template_id?: number | null;
  subject: string;
  message: string;
  attach_pdf: boolean;
  include_pay_link: boolean;
  whatsapp: boolean;
}

export interface SendResult {
  sent: { email: boolean; whatsapp: boolean };
  warnings: string[];
}

export const sendPreview = (id: number, body: SendBody) => apiPost<{ subject: string; html: string }>(`/api/billing/invoices/${id}/send-preview`, body);
export const sendInvoice = (id: number, body: SendBody) => request<SendResult>('POST', `/api/billing/invoices/${id}/send`, { body });

/** One address, as a mail server would take it. */
export const isEmail = (s: string) => /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]{2,}$/.test(s.trim());

/** "a@x.lk, b@y.lk; c@z.lk" → the addresses, trimmed, each once (case-insensitively). */
export function splitAddresses(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(/[,;\s]+/)) {
    const a = raw.trim();
    if (!a || seen.has(a.toLowerCase())) continue;
    seen.add(a.toLowerCase());
    out.push(a);
  }
  return out;
}

/** What is wrong with a send before it goes, in words; null when it can go. */
export function sendProblem(b: Pick<SendBody, 'to' | 'cc' | 'subject' | 'whatsapp'>): string | null {
  if (!b.to.length && !b.whatsapp) return 'Add at least one address to send it to.';
  const bad = [...b.to, ...b.cc].find((a) => !isEmail(a));
  if (bad) return `“${bad}” is not an email address.`;
  if (b.to.length && !b.subject.trim()) return 'Give the email a subject.';
  return null;
}

/** The toast after a send: by which channels it went, and the server's warnings. */
export function sendOutcome(r: SendResult): { ok: boolean; text: string; warnings: string[] } {
  const by = [r.sent?.email ? 'email' : null, r.sent?.whatsapp ? 'WhatsApp' : null].filter(Boolean) as string[];
  return { ok: by.length > 0, text: by.length ? `Sent by ${by.join(' and ')}.` : 'Nothing was sent.', warnings: r.warnings ?? [] };
}

// ── pay link (G-02 / G-03) ──────────────────────────────────────────────

export interface PayLink {
  url: string;
  token: string;
  expires_at: string | null;
}

/** The invoice's live pay link, or null when it has none (404 or an empty answer). */
export const fetchPayLink = (id: number, signal?: AbortSignal) =>
  apiGet<PayLink | { link: PayLink | null } | null>(`/api/billing/invoices/${id}/pay-link`, undefined, signal).then(
    (r) => payLinkOf(r),
    (e) => {
      if (e instanceof ApiError && e.status === 404) return null;
      throw e;
    },
  );
/** Make one, or (when one exists) a new one in its place: the old address stops working. */
export const createPayLink = (id: number) => apiPost<PayLink | { link: PayLink }>(`/api/billing/invoices/${id}/pay-link`, {}).then((r) => payLinkOf(r));
export const revokePayLink = (id: number) => apiDelete(`/api/billing/invoices/${id}/pay-link`);

/** The server answers the link itself or `{link}`; either way, a link with an address or nothing. */
export function payLinkOf(r: unknown): PayLink | null {
  const x = r && typeof r === 'object' && 'link' in r ? (r as { link: unknown }).link : r;
  return x && typeof x === 'object' && typeof (x as PayLink).url === 'string' && (x as PayLink).url ? (x as PayLink) : null;
}

// ── approvals (G-14) ────────────────────────────────────────────────────

export const submitForApproval = (id: number, note?: string) => request<{ invoice: { id: number; status: string } }>('POST', `/api/billing/invoices/${id}/submit`, { body: note?.trim() ? { note: note.trim() } : {} });
/** Approve, and (`issue: true`) issue it in the same step: numbered, frozen and posted. */
export const approveInvoice = (id: number, note?: string) =>
  request<{ invoice_id: number; approval: string; issue?: { ok: boolean; number: string | null; problems?: string[] | null } }>('POST', `/api/billing/invoices/${id}/approve`, { body: { note: note?.trim() ?? '', issue: true } });
export const rejectInvoice = (id: number, note: string) => request<{ invoice: { id: number; status: string } }>('POST', `/api/billing/invoices/${id}/reject`, { body: { note: note.trim() } });

export interface ApprovalRow {
  id: number;
  invoice_id: number;
  number: string | null;
  client: string | null;
  currency: string;
  total: number;
  submitted_by: string | null;
  submitted_at: string | null;
  reason: string | null;
}
export const fetchApprovals = (org: string, signal?: AbortSignal) => apiGet<{ approvals?: ApprovalRow[]; items?: ApprovalRow[] }>('/api/billing/approvals', org ? { org } : undefined, signal).then((r) => r.approvals ?? r.items ?? []);

// ── cancel (G-01) ───────────────────────────────────────────────────────

/** Cancelling an issued invoice reverses its journal in the same transaction (G-01): said before it is done. */
export const REVERSAL_NOTE = 'Its journal is reversed in the same step: revenue, tax and the receivable come off the books on today’s date. It keeps its number and stays on the customer’s record, marked cancelled.';

export interface CancelRefusal {
  code: 'period_locked' | 'paid' | 'other';
  message: string;
  /** The server suggests a credit note in its place (a locked period). */
  creditInstead: boolean;
}

/**
 * Why a cancel was refused, from the server's error: a locked period (409
 * `period_locked`) comes with the suggestion of a credit note in the open
 * period; anything else is said as the server said it.
 */
export function cancelRefusal(e: unknown): CancelRefusal {
  const msg = e instanceof Error && e.message ? e.message : 'The invoice could not be cancelled.';
  if (e instanceof ApiError) {
    const data = (e.data && typeof e.data === 'object' ? e.data : {}) as Record<string, unknown>;
    const code = e.code ?? (typeof data.code === 'string' ? data.code : null);
    if (code === 'period_locked' || (e.status === 409 && /period/i.test(msg))) {
      return { code: 'period_locked', message: msg || 'The period this invoice was posted in is locked, so its journal cannot be reversed.', creditInstead: data.suggest === undefined || data.suggest === 'credit_note' || data.suggest === true };
    }
    if (code === 'has_payments' || /paid|payment/i.test(msg)) return { code: 'paid', message: msg, creditInstead: true };
  }
  return { code: 'other', message: msg, creditInstead: false };
}

// ── bulk (G-13) ─────────────────────────────────────────────────────────

export type BulkAction = 'issue' | 'send' | 'pdf' | 'cancel' | 'mark_sent' | 'record_payment';

export const BULK_LABEL: Record<BulkAction, { verb: string; done: string }> = {
  issue: { verb: 'Issue', done: 'issued' },
  send: { verb: 'Send', done: 'sent' },
  pdf: { verb: 'PDFs', done: 'put in one file' },
  cancel: { verb: 'Cancel', done: 'cancelled' },
  mark_sent: { verb: 'Mark as sent', done: 'recorded as sent' },
  record_payment: { verb: 'Record payment', done: 'paid in full' },
};

export interface BulkResult {
  results: Array<{ id: number; ok: boolean; code?: string | null; message?: string | null; number?: string | null }>;
  done: number;
  refused: number;
  file_url?: string | null;
  /** The bulk PDF's file in the Drive (`file_url` is its `/api/files/{id}/download`). */
  file_id?: number | null;
}

/** Issuing in bulk is confirmed in the dialog first; the server asks for `confirm: true` (else 422 `confirm_required`). */
export const bulkAct = (action: BulkAction, ids: number[], extra: Record<string, unknown> = {}) => apiPost<unknown>('/api/billing/invoices/bulk', { ids, action, ...(action === 'issue' ? { confirm: true } : {}), ...extra }).then(normaliseBulk);

/** Where a bulk PDF downloads from: its Drive file, else a Billing path. */
export function bulkFile(r: BulkResult): { fileId: string } | { billingFile: string } | null {
  const id = r.file_id ?? Number(/^\/api\/files\/(\d+)\/download$/.exec(r.file_url ?? '')?.[1] ?? 0);
  if (id) return { fileId: String(id) };
  return r.file_url && /^\/(?:api\/billing\/|d\/)/.test(r.file_url) ? { billingFile: r.file_url } : null;
}

/**
 * One shape for a bulk answer: the contract's `{results, done, refused,
 * file_url}`, or the older `{done: [...], failed: [...]}` a server before
 * SRS-BIL-001 sends.
 */
export function normaliseBulk(r: unknown): BulkResult {
  const o = (r && typeof r === 'object' ? r : {}) as Record<string, unknown>;
  if (Array.isArray(o.results)) {
    const results = (o.results as BulkResult['results']).map((x) => ({ ...x, ok: !!x.ok }));
    return {
      results,
      done: typeof o.done === 'number' ? o.done : results.filter((x) => x.ok).length,
      refused: typeof o.refused === 'number' ? o.refused : results.filter((x) => !x.ok).length,
      file_url: (o.file_url as string | null | undefined) ?? null,
      file_id: typeof o.file_id === 'number' ? o.file_id : null,
    };
  }
  const done = Array.isArray(o.done) ? (o.done as Array<{ id: number; number?: string | null }>) : [];
  const failed = Array.isArray(o.failed) ? (o.failed as Array<{ id: number; number?: string | null; why?: string }>) : [];
  return {
    results: [...done.map((d) => ({ id: d.id, ok: true, number: d.number ?? null })), ...failed.map((f) => ({ id: f.id, ok: false, number: f.number ?? null, message: f.why ?? null }))],
    done: done.length,
    refused: failed.length,
    file_url: null,
  };
}

/** "3 invoices issued; 1 refused." */
export function bulkSummary(action: BulkAction, r: BulkResult): string {
  const n = (k: number) => `${k} ${k === 1 ? 'invoice' : 'invoices'}`;
  const done = action === 'pdf' ? (r.done ? `${n(r.done)} put in one PDF` : '') : r.done ? `${n(r.done)} ${BULK_LABEL[action].done}` : '';
  const refused = r.refused ? `${r.refused} refused` : '';
  const parts = [done, refused].filter(Boolean);
  return parts.length ? `${parts.join('; ')}.` : 'Nothing was done.';
}

// ── exports (G-13) ──────────────────────────────────────────────────────

export type ExportWhat = 'invoices' | 'payments' | 'credit-notes' | 'customers';
export type ExportFormat = 'csv' | 'xlsx' | 'pdf';
export type ExportReport = 'aging' | 'revenue' | 'tax' | 'customers' | 'payments' | 'products' | 'numbering-gaps';

/** The download the main process saves to disk: `transfers:download {billingExport}`. */
export function exportRequest(what: ExportWhat | { report: ExportReport }, format: ExportFormat, q: { org?: string; q?: string; status?: string; from?: string; to?: string } = {}) {
  const name = typeof what === 'string' ? what : `report-${what.report}`;
  const stamp = new Date().toISOString().slice(0, 10);
  return {
    billingExport: { ...(typeof what === 'string' ? { what } : { what: 'report' as const, report: what.report }), format, ...Object.fromEntries(Object.entries(q).filter(([, v]) => v !== undefined && v !== '')) },
    name: `billing-${name}-${stamp}.${format}`,
  };
}

// ── attachments (G-26) ──────────────────────────────────────────────────

export interface Attachment {
  id: number;
  file_id: number;
  name: string;
  size?: number | null;
  mime?: string | null;
  added_by?: string | null;
  created_at?: string | null;
}
export const fetchAttachments = (id: number, signal?: AbortSignal) => apiGet<{ attachments: Attachment[] }>(`/api/billing/invoices/${id}/attachments`, undefined, signal).then((r) => r.attachments ?? []);
export const attachFile = (id: number, fileId: number) => apiPost<{ attachments?: Attachment[] }>(`/api/billing/invoices/${id}/attachments`, { file_id: fileId });
export const detachFile = (id: number, attachmentId: number) => apiDelete(`/api/billing/invoices/${id}/attachments/${attachmentId}`);

// ── dispute (G-05) ──────────────────────────────────────────────────────

export const flagDispute = (id: number, reason: string) => apiPost(`/api/billing/invoices/${id}/dispute`, { reason: reason.trim() });
export const clearDispute = (id: number) => apiDelete(`/api/billing/invoices/${id}/dispute`);

// ── statements (G-05) ───────────────────────────────────────────────────

/** Email a statement for `from`…`until` (the server's `to` is the recipients; without it, the customer's address). */
export const sendStatement = (customer: number, body: { from: string; until: string; to?: string[]; message?: string }) => request('POST', `/api/billing/customers/${customer}/statement/send`, { body });

// ── reminders shown on an invoice (D02) ─────────────────────────────────

/** One invoice's reminders: those still to come first (`status: 'scheduled'`, `due_on`, no id), then those sent. */
export interface ReminderEntry {
  id: number | null;
  invoice_id: number | null;
  offset_days: number | null;
  channel: string;
  status: string;
  sent_at: string | null;
  due_on?: string | null;
  error?: string | null;
}
export const fetchInvoiceReminders = (id: number, signal?: AbortSignal) =>
  apiGet<{ log?: ReminderEntry[]; items?: ReminderEntry[]; upcoming?: ReminderEntry[] }>('/api/billing/reminders/log', { invoice_id: id }, signal).then((r) => r.log ?? [...(r.upcoming ?? []), ...(r.items ?? [])]);

/** "+7" for seven days after the due date, "−3" before it, "on the due date". */
export const offsetLabel = (d: number | null | undefined) => (d === null || d === undefined ? '—' : d === 0 ? 'on the due date' : d > 0 ? `+${d}` : `−${Math.abs(d)}`);

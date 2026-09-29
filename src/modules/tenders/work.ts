import { apiDelete, apiGet, apiPost, apiPut } from '../../core/api';
import { closingValue, grouped, wallParts } from './api';

/**
 * A tender's working tabs (the server's checklist, document, security,
 * meeting, budget, approval, notice, letter, submission and evaluation
 * routes). Reading needs `tender.view`; writing `tender.manage`; approving a
 * checklist line or an approval step `tender.approve`. Filing a document
 * also asks the attachment permissions the server reports as `can`.
 *
 * THE CHECKLIST'S "DONE" IS THE SERVER'S. Each line carries `settled` and,
 * when it is not, `why_not` — the same sentence the pipeline gives when it
 * refuses to move the tender to Ready. The screen never works it out itself.
 */

const int = (v: unknown): number | null => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Math.trunc(Number(v)));
const str = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v));
const yes = (v: unknown) => v === true || v === 1 || v === '1';
/** A figure as typed, without its grouping commas. */
export const plain = (v: string) => v.replace(/[,\s]/g, '');

// ── the checklist ───────────────────────────────────────────────────────

export type LineStatus = 'missing' | 'uploaded' | 'pending_review' | 'approved' | 'rejected';

export const LINE_STATUS: Record<LineStatus, { label: string; tone: 'grey' | 'blue' | 'amber' | 'green' | 'red' }> = {
  missing: { label: 'Missing', tone: 'grey' },
  uploaded: { label: 'Uploaded', tone: 'blue' },
  pending_review: { label: 'Pending review', tone: 'amber' },
  approved: { label: 'Approved', tone: 'green' },
  rejected: { label: 'Sent back', tone: 'red' },
};

export interface LineFile {
  id: number;
  file_id: number;
  version: number;
  name: string | null;
  uploaded_at: string | null;
  /** Who uploaded this version (a user id; the name comes from the directory). */
  uploaded_by: number | null;
  current: boolean;
}

export interface Line {
  id: number;
  section: string | null;
  label: string;
  detail: string | null;
  mandatory: boolean;
  status: LineStatus;
  owner_id: number | null;
  owner_name: string | null;
  reviewer_name: string | null;
  reviewed_at: string | null;
  rejection_reason: string | null;
  issued_on: string | null;
  expires_on: string | null;
  note: string | null;
  /** Satisfied from the company library rather than a file of its own. */
  library: boolean;
  settled: boolean;
  why_not: string | null;
  files: LineFile[];
}

export interface Pack {
  key: string;
  label: string;
  blurb: string;
  sections: number;
  lines: number;
}

export interface Checklist {
  items: Line[];
  counts: Record<'required' | 'optional' | LineStatus, number>;
  /** Mandatory lines that would not block submission, as a percentage — null when nothing is mandatory. */
  completion: number | null;
  basis: string;
  packs: Pack[];
}

export function toLine(r: Record<string, unknown>): Line {
  const status = String(r.status ?? 'missing') as LineStatus;
  return {
    id: int(r.id) ?? 0,
    section: str(r.section),
    label: String(r.label ?? ''),
    detail: str(r.detail),
    mandatory: yes(r.mandatory),
    status: status in LINE_STATUS ? status : 'missing',
    owner_id: int(r.owner_id),
    owner_name: str(r.owner_name),
    reviewer_name: str(r.reviewer_name),
    reviewed_at: str(r.reviewed_at),
    rejection_reason: str(r.rejection_reason),
    issued_on: str(r.issued_on),
    expires_on: str(r.expires_on),
    note: str(r.note),
    library: int(r.company_doc_id) !== null && int(r.file_id) === null,
    settled: r.settled === true || yes(r.is_settled),
    why_not: str(r.why_not),
    files: (Array.isArray(r.files) ? (r.files as Array<Record<string, unknown>>) : []).map((f) => ({
      id: int(f.id) ?? 0,
      file_id: int(f.file_id) ?? 0,
      version: int(f.version) ?? 1,
      name: str(f.name),
      uploaded_at: str(f.uploaded_at),
      uploaded_by: int(f.uploaded_by),
      current: yes(f.is_current),
    })),
  };
}

export async function fetchChecklist(id: number, signal?: AbortSignal): Promise<Checklist> {
  const d = await apiGet<{ items?: Array<Record<string, unknown>>; counts?: Checklist['counts']; completion?: number; completion_basis?: string; packs?: Pack[] }>(`/api/tenders/${id}/checklist`, undefined, signal);
  const counts = { required: 0, optional: 0, missing: 0, uploaded: 0, pending_review: 0, approved: 0, rejected: 0, ...(d.counts ?? {}) };
  return {
    items: (d.items ?? []).map(toLine),
    counts,
    // The server calls a checklist with nothing mandatory 100% complete; that is "no checklist", not "done".
    completion: counts.required === 0 ? null : Number(d.completion ?? 0),
    basis: d.completion_basis ?? '',
    packs: d.packs ?? [],
  };
}

/** The lines in the buyer's order, grouped where the section changes (never re-sorted by name). */
export function sectionsOf(lines: Line[]): Array<{ name: string; lines: Line[] }> {
  const out: Array<{ name: string; lines: Line[] }> = [];
  for (const l of lines) {
    const name = l.section ?? 'Other';
    const last = out[out.length - 1];
    if (last && last.name === name) last.lines.push(l);
    else out.push({ name, lines: [l] });
  }
  return out;
}

export type LineFilter = 'all' | 'outstanding' | 'required' | 'optional' | LineStatus;

export function filterLines(lines: Line[], f: LineFilter): Line[] {
  if (f === 'all') return lines;
  if (f === 'outstanding') return lines.filter((l) => l.mandatory && !l.settled);
  if (f === 'required') return lines.filter((l) => l.mandatory);
  if (f === 'optional') return lines.filter((l) => !l.mandatory);
  return lines.filter((l) => l.status === f);
}

export const applyPack = (id: number, pack: string) => apiPost<{ added: number; skipped: number; linked: number }>(`/api/tenders/${id}/checklist/apply`, { pack });
export const addLine = (id: number, body: { label: string; section?: string; detail?: string; mandatory: boolean }) => apiPost<{ id: number }>(`/api/tenders/${id}/checklist`, body);
export const updateLine = (rid: number, patch: Record<string, string | number | boolean | null>) => apiPut(`/api/tenders/checklist/${rid}`, patch);
export const removeLine = (rid: number) => apiDelete(`/api/tenders/checklist/${rid}`);
/** A Drive file as a line's next version. */
export const attachToLine = (rid: number, fileId: number, name: string) => apiPost(`/api/tenders/checklist/${rid}/file`, { file_id: fileId, name });
export const reviewLine = (rid: number, decision: 'approved' | 'rejected', reason?: string) => apiPost(`/api/tenders/checklist/${rid}/review`, { decision, ...(reason ? { reason } : {}) });
export const bulkLines = (id: number, action: 'approve' | 'remove', ids: number[]) => apiPost<{ count: number }>(`/api/tenders/${id}/checklist/bulk`, { action, ids });

export interface LineDraft {
  label: string;
  section: string;
  detail: string;
  note: string;
  mandatory: boolean;
  owner: string;
  issued_on: string;
  expires_on: string;
}

export const lineDraft = (l: Line): LineDraft => ({
  label: l.label,
  section: l.section ?? '',
  detail: l.detail ?? '',
  note: l.note ?? '',
  mandatory: l.mandatory,
  owner: l.owner_id ? String(l.owner_id) : '',
  issued_on: l.issued_on ?? '',
  expires_on: l.expires_on ?? '',
});

/** Only what changed on a line, in the server's spelling. */
export function lineChanges(before: LineDraft, after: LineDraft): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {};
  for (const k of ['label', 'section', 'detail', 'note', 'issued_on', 'expires_on'] as const) if (after[k].trim() !== before[k].trim()) out[k] = after[k].trim();
  if (after.mandatory !== before.mandatory) out.mandatory = after.mandatory;
  if (after.owner !== before.owner) out.owner_id = after.owner ? Number(after.owner) : null;
  return out;
}

// ── documents ───────────────────────────────────────────────────────────

export const DOC_KINDS: Array<[string, string]> = [
  ['tender_notice', 'Tender notice'],
  ['specification', 'Specification'],
  ['our_bid', 'Our bid'],
  ['clarification', 'Clarification'],
  ['addendum', 'Addendum'],
  ['award_letter', 'Award letter'],
  ['other', 'Other'],
];
export const docKindLabel = (k: string) => DOC_KINDS.find(([v]) => v === k)?.[1] ?? k.replace(/_/g, ' ');

export const updateDocument = (docId: number, patch: { title?: string; kind?: string; note?: string; is_final?: boolean }) => apiPut(`/api/tenders/documents/${docId}`, patch);
/** A Drive file as a document's new version. */
export const replaceDocument = (docId: number, fileId: number) => apiPut(`/api/tenders/documents/${docId}`, { file_id: fileId });
/** Drive files as new documents of one kind, titled by their names. */
export const addDocuments = async (id: number, files: Array<{ id: number | string; name: string }>, kind: string) => {
  for (const f of files) await apiPost(`/api/tenders/${id}/documents`, { file_id: Number(f.id), kind, title: f.name });
};
export const removeDocument = (docId: number) => apiDelete(`/api/tenders/documents/${docId}`);

// ── bonds and guarantees ────────────────────────────────────────────────

export const SECURITY_KINDS: Array<[string, string]> = [
  ['bid_security', 'Bid security'],
  ['performance', 'Performance guarantee'],
  ['advance_payment', 'Advance payment guarantee'],
  ['retention', 'Retention guarantee'],
  ['other', 'Other'],
];
export const INSTRUMENTS: Array<[string, string]> = [
  ['bank_guarantee', 'Bank guarantee'],
  ['cash', 'Cash'],
  ['cheque', 'Cheque'],
  ['insurance_bond', 'Insurance bond'],
  ['other', 'Other'],
];
export const SECURITY_STATUSES: Array<[string, string]> = [
  ['draft', 'Draft'],
  ['issued', 'Issued'],
  ['submitted', 'Submitted'],
  ['extended', 'Extended'],
  ['returned', 'Returned'],
  ['forfeited', 'Forfeited'],
  ['expired', 'Expired'],
];
export const labelOf = (list: Array<[string, string]>, v: string | null) => (v ? (list.find(([k]) => k === v)?.[1] ?? v.replace(/_/g, ' ')) : '—');

export interface Security {
  id: number;
  kind: string;
  instrument: string | null;
  amount: string | null;
  currency: string | null;
  issued_by: string | null;
  reference: string | null;
  issued_on: string | null;
  valid_until: string | null;
  returned_on: string | null;
  status: string;
  file_id: number | null;
  note: string | null;
}

export const toSecurity = (r: Record<string, unknown>): Security => ({
  id: int(r.id) ?? 0,
  kind: String(r.kind ?? 'other'),
  instrument: str(r.instrument),
  amount: str(r.amount),
  currency: str(r.currency),
  issued_by: str(r.issued_by),
  reference: str(r.reference),
  issued_on: str(r.issued_on),
  valid_until: str(r.valid_until),
  returned_on: str(r.returned_on),
  status: String(r.status ?? 'issued'),
  file_id: int(r.file_id),
  note: str(r.note),
});

export const fetchSecurities = (id: number, signal?: AbortSignal) => apiGet<{ items: Array<Record<string, unknown>> }>(`/api/tenders/${id}/securities`, undefined, signal).then((d) => (d.items ?? []).map(toSecurity));

/** Still tying money up: not returned, forfeited or lapsed. */
export const securityLive = (s: Security) => !['returned', 'forfeited', 'expired'].includes(s.status);

/** Whole days from `today` (YYYY-MM-DD) to a bond's expiry, or null. */
export function daysTo(ymd: string | null, today: string): number | null {
  if (!ymd) return null;
  const a = Date.parse(`${ymd}T12:00:00Z`);
  const b = Date.parse(`${today}T12:00:00Z`);
  return Number.isNaN(a) || Number.isNaN(b) ? null : Math.round((a - b) / 86_400_000);
}

export interface SecurityDraft {
  kind: string;
  instrument: string;
  amount: string;
  currency: string;
  issued_by: string;
  reference: string;
  issued_on: string;
  valid_until: string;
  returned_on: string;
  status: string;
  note: string;
}

export const securityDraft = (s: Security | null, currency: string): SecurityDraft => ({
  kind: s?.kind ?? 'bid_security',
  instrument: s?.instrument ?? 'bank_guarantee',
  amount: s?.amount ?? '',
  currency: s?.currency ?? currency,
  issued_by: s?.issued_by ?? '',
  reference: s?.reference ?? '',
  issued_on: s?.issued_on ?? '',
  valid_until: s?.valid_until ?? '',
  returned_on: s?.returned_on ?? '',
  status: s?.status ?? 'issued',
  note: s?.note ?? '',
});

/** The whole form for a new bond; only what changed for an edit. An amount is required either way. */
export function securityBody(d: SecurityDraft, before: SecurityDraft | null): { body: Record<string, string> | null; error: string | null } {
  if (!plain(d.amount)) return { body: null, error: 'A bond needs an amount — it is money tied up until it comes back.' };
  const all: Record<string, string> = { ...d, amount: plain(d.amount), currency: d.currency.trim().toUpperCase() };
  if (!before) return { body: all, error: null };
  const prev: Record<string, string> = { ...before, amount: plain(before.amount), currency: before.currency.trim().toUpperCase() };
  const body = Object.fromEntries(Object.entries(all).filter(([k, v]) => (k === 'amount' ? grouped(v) !== grouped(prev[k]!) : v.trim() !== (prev[k] ?? '').trim())));
  return { body, error: null };
}

export const addSecurity = (id: number, body: Record<string, string>) => apiPost<{ id: number }>(`/api/tenders/${id}/securities`, body);
export const updateSecurity = (sid: number, body: Record<string, string>) => apiPut(`/api/tenders/securities/${sid}`, body);
export const deleteSecurity = (sid: number) => apiDelete(`/api/tenders/securities/${sid}`);

// ── meetings ────────────────────────────────────────────────────────────

export const MEETING_KINDS: Array<[string, string]> = [
  ['pre_bid', 'Pre-bid meeting'],
  ['site_visit', 'Site visit'],
  ['clarification', 'Clarification'],
  ['opening', 'Bid opening'],
  ['other', 'Other'],
];
export const MODES: Array<[string, string]> = [
  ['physical', 'In person'],
  ['online', 'Online'],
  ['hybrid', 'Hybrid'],
];

export interface Meeting {
  id: number;
  kind: string;
  scheduled_at: string | null;
  mode: string | null;
  venue: string | null;
  link: string | null;
  mandatory: boolean;
  questions_due_at: string | null;
  attended: boolean;
  attended_by: string | null;
  minutes: string | null;
}

export const toMeeting = (r: Record<string, unknown>): Meeting => ({
  id: int(r.id) ?? 0,
  kind: String(r.kind ?? 'other'),
  scheduled_at: str(r.scheduled_at),
  mode: str(r.mode),
  venue: str(r.venue),
  link: str(r.link),
  mandatory: yes(r.mandatory),
  questions_due_at: str(r.questions_due_at),
  attended: yes(r.attended),
  attended_by: str(r.attended_by),
  minutes: str(r.minutes),
});

export const fetchMeetings = (id: number, signal?: AbortSignal) => apiGet<{ items: Array<Record<string, unknown>> }>(`/api/tenders/${id}/meetings`, undefined, signal).then((d) => (d.items ?? []).map(toMeeting));

export interface MeetingDraft {
  kind: string;
  date: string;
  time: string;
  mode: string;
  venue: string;
  link: string;
  mandatory: boolean;
  qDate: string;
  qTime: string;
  attended: boolean;
  attended_by: string;
  minutes: string;
}

export function meetingDraft(m: Meeting | null): MeetingDraft {
  const at = wallParts(m?.scheduled_at ?? null);
  const q = wallParts(m?.questions_due_at ?? null);
  return {
    kind: m?.kind ?? 'pre_bid',
    date: at.date,
    time: at.time,
    mode: m?.mode ?? 'physical',
    venue: m?.venue ?? '',
    link: m?.link ?? '',
    mandatory: m?.mandatory ?? false,
    qDate: q.date,
    qTime: q.time,
    attended: m?.attended ?? false,
    attended_by: m?.attended_by ?? '',
    minutes: m?.minutes ?? '',
  };
}

/**
 * A meeting's body. Its time is on the reader's clock and goes as the instant;
 * the questions deadline may be a day alone, which the server closes at the
 * end of. A meeting without a time is refused here as it is by the server.
 */
export function meetingBody(d: MeetingDraft, before: MeetingDraft | null): { body: Record<string, string | boolean> | null; error: string | null } {
  if (!d.date || !d.time) return { body: null, error: 'A meeting needs a date and a time — that is the thing somebody has to be at.' };
  const all: Record<string, string | boolean> = {
    kind: d.kind,
    scheduled_at: closingValue(d.date, d.time),
    mode: d.mode,
    venue: d.venue.trim(),
    link: d.link.trim(),
    mandatory: d.mandatory,
    questions_due_at: closingValue(d.qDate, d.qTime),
    attended: d.attended,
    attended_by: d.attended_by.trim(),
    minutes: d.minutes.trim(),
  };
  if (!before) return { body: all, error: null };
  const prev = meetingBody(before, null).body ?? {};
  return { body: Object.fromEntries(Object.entries(all).filter(([k, v]) => v !== prev[k])), error: null };
}

export const addMeeting = (id: number, body: Record<string, string | boolean>) => apiPost<{ id: number }>(`/api/tenders/${id}/meetings`, body);
export const updateMeeting = (mid: number, body: Record<string, string | boolean>) => apiPut(`/api/tenders/meetings/${mid}`, body);
export const deleteMeeting = (mid: number) => apiDelete(`/api/tenders/meetings/${mid}`);

// ── budget and costs ────────────────────────────────────────────────────

export const COST_KINDS: Array<[string, string]> = [
  ['labour', 'Labour'],
  ['materials', 'Materials'],
  ['equipment', 'Equipment'],
  ['travel', 'Travel'],
  ['subcontract', 'Subcontract'],
  ['tax', 'Tax'],
  ['risk', 'Risk'],
  ['other', 'Other'],
];

export function budgetLineBody(d: { label: string; category: string; quantity: string; unit_cost: string; note: string }): { body: Record<string, string> | null; error: string | null } {
  if (!d.label.trim()) return { body: null, error: 'A cost line needs a description.' };
  const qty = plain(d.quantity) || '1';
  if (!/^\d+(\.\d{1,3})?$/.test(qty) || Number(qty) <= 0) return { body: null, error: 'The quantity is a number above nothing, to three places at most.' };
  const cost = plain(d.unit_cost);
  if (!/^\d+(\.\d{1,2})?$/.test(cost)) return { body: null, error: 'The unit cost is an amount, such as 1250 or 1,250.50.' };
  return { body: { label: d.label.trim(), category: d.category, quantity: qty, unit_cost: cost, ...(d.note.trim() ? { note: d.note.trim() } : {}) }, error: null };
}

export const addBudgetLine = (id: number, body: Record<string, string>) => apiPost<{ id: number }>(`/api/tenders/${id}/budget`, body);
export const removeBudgetLine = (lid: number) => apiDelete(`/api/tenders/budget/${lid}`);

export interface Costs {
  items: Array<{ id: number; claim_no: string | null; spent_on: string | null; amount: string; currency: string | null; category: string | null; claimant: string | null; description: string | null; status: string }>;
  total: number;
  sum: string;
  sum_currency: string | null;
  unconverted: number;
  why: string | null;
}

export async function fetchCosts(id: number, signal?: AbortSignal): Promise<Costs> {
  const d = await apiGet<Partial<Costs> & { items?: Array<Record<string, unknown>> }>(`/api/tenders/${id}/expenses`, undefined, signal);
  return {
    items: (d.items ?? []).map((r) => ({
      id: int(r.id) ?? 0,
      claim_no: str(r.claim_no),
      spent_on: str(r.spent_on),
      amount: String(r.amount ?? '0'),
      currency: str(r.currency),
      category: str(r.category),
      claimant: str(r.claimant),
      description: str(r.description),
      status: String(r.status ?? ''),
    })),
    total: Number(d.total ?? 0),
    sum: String(d.sum ?? '0.00'),
    sum_currency: d.sum_currency ?? null,
    unconverted: Number(d.unconverted ?? 0),
    why: d.why ?? null,
  };
}

// ── approvals ───────────────────────────────────────────────────────────

export const addApproval = (id: number, body: { role_label: string; step: number; approver_id?: number | null }) => apiPost<{ id: number }>(`/api/tenders/${id}/approvals`, body);
export const decideApproval = (aid: number, status: 'approved' | 'rejected' | 'skipped', comment?: string) => apiPut(`/api/tenders/approvals/${aid}`, { status, ...(comment ? { comment } : {}) });

// ── the notice and its letters ──────────────────────────────────────────

export const NOTICE_FIELDS: Array<{ key: string; label: string; hint?: string; long?: boolean }> = [
  { key: 'addressee_title', label: 'Addressed to', hint: 'The title the letter is sent to, such as "The Chairman".' },
  { key: 'committee', label: 'Committee', hint: 'The procurement committee named in the notice.' },
  { key: 'buyer_address', label: "The buyer's address", long: true },
  { key: 'attention', label: 'For the attention of' },
  { key: 'through', label: 'Through' },
  { key: 'notice_type', label: 'Kind of notice', hint: 'National competitive bidding, shopping, …' },
  { key: 'clause_ref', label: 'Clause' },
  { key: 'issuing_place', label: 'Where the documents are issued' },
  { key: 'issuing_hours', label: 'Issuing hours' },
  { key: 'envelope_procedure', label: 'Envelopes', hint: 'One envelope or two, and how they are marked.' },
];

export interface Notice {
  notice: Record<string, string | null> | null;
  elsewhere: {
    published_at: string | null;
    closing_at: string | null;
    pre_bid: { scheduled_at: string | null; venue: string | null; questions_due_at: string | null; mandatory: boolean } | null;
    bid_security: { amount: string | null; currency: string | null; valid_until: string | null; instrument: string | null } | null;
  };
}

export async function fetchNotice(id: number, signal?: AbortSignal): Promise<Notice> {
  const d = await apiGet<{ notice: Record<string, unknown> | null; elsewhere?: Record<string, { value: unknown }> }>(`/api/tenders/${id}/notice`, undefined, signal);
  const e = d.elsewhere ?? {};
  return {
    notice: d.notice ? Object.fromEntries(Object.entries(d.notice).map(([k, v]) => [k, str(v)])) : null,
    elsewhere: {
      published_at: str(e.published_at?.value),
      closing_at: str(e.closing_at?.value),
      pre_bid: (e.pre_bid?.value as Notice['elsewhere']['pre_bid']) ?? null,
      bid_security: (e.bid_security?.value as Notice['elsewhere']['bid_security']) ?? null,
    },
  };
}

export const NOTICE_KEYS = [...NOTICE_FIELDS.map((f) => f.key), 'doc_fee_amount', 'doc_fee_currency', 'doc_fee_terms', 'issuing_from', 'issuing_to'];

export const noticeDraft = (n: Notice['notice']): Record<string, string> => Object.fromEntries(NOTICE_KEYS.map((k) => [k, n?.[k] ?? '']));

/** The notice is saved whole: every field goes, a blank one as blank. */
export function noticeBody(d: Record<string, string>): { body: Record<string, string> | null; error: string | null } {
  if (d.issuing_from && d.issuing_to && d.issuing_to < d.issuing_from) return { body: null, error: 'The documents cannot stop being issued before they start.' };
  return { body: Object.fromEntries(NOTICE_KEYS.map((k) => [k, k === 'doc_fee_amount' ? plain(d[k] ?? '') : k === 'doc_fee_currency' ? (d[k] ?? '').trim().toUpperCase() : (d[k] ?? '').trim()])), error: null };
}

export const saveNotice = (id: number, body: Record<string, string>) => apiPut(`/api/tenders/${id}/notice`, body);

export interface Letter {
  id: number;
  number: string | null;
  title: string;
  status: string;
  pages: number;
  created_at: string;
  created_by: string | null;
}

export const fetchLetters = (id: number, signal?: AbortSignal) => apiGet<{ items: Letter[] }>(`/api/tenders/${id}/letters`, undefined, signal).then((d) => d.items ?? []);
export const generateLetter = (id: number) => apiPost<{ document_id: number; number: string | null }>(`/api/tenders/${id}/letter`, {});

// ── submission and evaluation ───────────────────────────────────────────

export const METHODS: Array<[string, string]> = [
  ['portal', 'Through the portal'],
  ['email', 'By email'],
  ['physical', 'By hand'],
  ['api', 'Automatically'],
];
export const EVALUATION_KINDS: Array<[string, string]> = [
  ['technical', 'Technical evaluation'],
  ['financial', 'Financial evaluation'],
  ['clarification', 'Clarification asked'],
  ['meeting', 'Meeting'],
  ['other', 'Other'],
];

export function submissionBody(d: { method: string; date: string; time: string; receipt_no: string; bid_value: string; reference: string; note: string }): { body: Record<string, string> | null; error: string | null } {
  if (!d.date) return { body: null, error: 'When did it go in?' };
  if (d.bid_value && !/^\d+(\.\d{1,2})?$/.test(plain(d.bid_value))) return { body: null, error: 'The bid value is an amount, such as 4500000 or 4,500,000.00.' };
  return {
    body: {
      method: d.method,
      submitted_at: closingValue(d.date, d.time || '12:00'),
      ...(d.receipt_no.trim() ? { receipt_no: d.receipt_no.trim() } : {}),
      ...(plain(d.bid_value) ? { bid_value: plain(d.bid_value) } : {}),
      ...(d.reference.trim() ? { reference: d.reference.trim() } : {}),
      ...(d.note.trim() ? { note: d.note.trim() } : {}),
    },
    error: null,
  };
}

export const recordSubmission = (id: number, body: Record<string, string>, override = false) => apiPost<{ id: number }>(`/api/tenders/${id}/submit`, { ...body, ...(override ? { override: true } : {}) });

export function evaluationBody(d: { kind: string; title: string; body: string; score: string; max_score: string; date: string }): { body: Record<string, string> | null; error: string | null } {
  if (!d.title.trim()) return { body: null, error: 'Give it a title.' };
  for (const [v, what] of [
    [d.score, 'score'],
    [d.max_score, 'out of'],
  ] as const)
    if (v.trim() && !/^\d+(\.\d{1,2})?$/.test(v.trim())) return { body: null, error: `The ${what} is a number.` };
  return {
    body: {
      kind: d.kind,
      title: d.title.trim(),
      ...(d.body.trim() ? { body: d.body.trim() } : {}),
      ...(d.score.trim() ? { score: d.score.trim() } : {}),
      ...(d.max_score.trim() ? { max_score: d.max_score.trim() } : {}),
      ...(d.date ? { happened_at: closingValue(d.date, '12:00') } : {}),
    },
    error: null,
  };
}

export const addEvaluation = (id: number, body: Record<string, string>) => apiPost<{ id: number }>(`/api/tenders/${id}/evaluations`, body);

export const K2 = {
  checklist: (id: number) => ['tenders', 'checklist', id] as const,
  securities: (id: number) => ['tenders', 'securities', id] as const,
  meetings: (id: number) => ['tenders', 'meetings', id] as const,
  costs: (id: number) => ['tenders', 'costs', id] as const,
  notice: (id: number) => ['tenders', 'notice', id] as const,
  letters: (id: number) => ['tenders', 'letters', id] as const,
};

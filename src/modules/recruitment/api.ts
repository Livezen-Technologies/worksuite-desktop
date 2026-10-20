import { useQuery } from '@tanstack/react-query';
import { apiGet, apiPatch, apiPost } from '../../core/api';

/**
 * Recruitment over the staff API (`/api/recruitment/…`, docs/recruitment/API.md in WorkSuite, v1.0). The server is
 * the authority on every rule — guarded moves, scopes, approval routes; what is checked here is only what saves a
 * round trip (a reason for a backward move, a comment on a 1 or a 5) and the server checks it again.
 */
const B = '/api/recruitment';

export const K = {
  meta: ['recruitment', 'meta'] as const,
  jobs: ['recruitment', 'jobs'] as const,
  pipeline: (job: number) => ['recruitment', 'pipeline', job] as const,
  queue: (job: number | null) => ['recruitment', 'queue', job ?? 0] as const,
  candidate: (id: number) => ['recruitment', 'candidate', id] as const,
  interviews: (day: string) => ['recruitment', 'interviews', day] as const,
  kit: (id: number) => ['recruitment', 'kit', id] as const,
  evaluations: (interview: number) => ['recruitment', 'evaluations', interview] as const,
  approvals: ['recruitment', 'approvals'] as const,
};

/** Lists come back as an array, or as `{items}` / `{data}` from a paginated route: either reads as the array. */
export function rows<T>(v: unknown): T[] {
  if (Array.isArray(v)) return v as T[];
  if (v && typeof v === 'object') {
    const o = v as { items?: unknown; data?: unknown };
    if (Array.isArray(o.items)) return o.items as T[];
    if (Array.isArray(o.data)) return o.data as T[];
  }
  return [];
}

// ── meta & permissions ─────────────────────────────────────────────────────

export interface Option { id: number | string; name?: string; label?: string }
export interface Meta {
  can: Record<string, boolean>;
  rejection_reasons?: Option[];
  stage_categories?: string[];
  scope?: unknown;
}

export const fetchMeta = (signal?: AbortSignal) => apiGet<Meta>(`${B}/meta`, undefined, signal);
export function useMeta() {
  return useQuery({ queryKey: K.meta, queryFn: ({ signal }) => fetchMeta(signal), staleTime: 300_000 });
}

/** `can{}` keys come with or without the `recruitment.` prefix; anything missing is "no". */
export function allowed(meta: Meta | undefined | null, perm: string): boolean {
  const can = meta?.can ?? {};
  const short = perm.replace(/^recruitment\./, '');
  return can[short] === true || can[`recruitment.${short}`] === true;
}

export const optionLabel = (o: Option) => o.label ?? o.name ?? String(o.id);

// ── jobs & pipeline (D01) ──────────────────────────────────────────────────

export interface Job { id: number; title: string; status: string; department?: string | null; location?: string | null; counts?: { total?: number } }
export type StageCategory = 'APPLIED' | 'SCREENING' | 'SHORTLISTED' | 'INTERVIEW' | 'ASSESSMENT' | 'SELECTED' | 'OFFER' | 'HIRED';
export interface Card {
  id: number;
  candidate: { id: number; name: string; headline?: string | null };
  applied_at?: string | null;
  status: string;
  flags?: { duplicate?: boolean; knockout?: boolean; sla_breach?: boolean };
  rating_avg?: number | null;
  days_in_stage?: number | null;
}
export interface Stage { id: number; name: string; category: StageCategory; position: number; applications: Card[] }
export interface Pipeline { stages: Stage[] }

export const fetchJobs = (signal?: AbortSignal) => apiGet<unknown>(`${B}/jobs`, { status: 'open' }, signal).then((v) => rows<Job>(v));
export const fetchPipeline = (job: number, signal?: AbortSignal) => apiGet<Pipeline>(`${B}/jobs/${job}/pipeline`, undefined, signal);

/** Statuses that take an application out of the pipeline: they need a reason, like a backward move (§3.10). */
export const EXIT_STATUSES = ['REJECTED', 'WITHDRAWN', 'NO_SHOW', 'ON_HOLD', 'TALENT_POOL'] as const;

/** Whether moving from one stage to another goes back down the pipeline. */
export function isBackward(stages: Stage[], from: number, to: number): boolean {
  const a = stages.find((s) => s.id === from);
  const b = stages.find((s) => s.id === to);
  return !!a && !!b && b.position < a.position;
}

export interface MoveInput { stage_id?: number; status?: string; reason?: string; review_date?: string }

/**
 * `POST applications/{id}/move`. A backward move or an exit without a reason is refused here, before the server
 * refuses it too.
 */
export async function moveApplication(id: number, input: MoveInput, opts: { backward?: boolean } = {}): Promise<unknown> {
  const exit = !!input.status && (EXIT_STATUSES as readonly string[]).includes(input.status);
  const reason = input.reason?.trim();
  if ((opts.backward || exit) && !reason) throw new Error('A reason is needed to move a candidate back or out of the pipeline.');
  const body: MoveInput = { ...input };
  if (reason) body.reason = reason;
  else delete body.reason;
  return apiPost(`${B}/applications/${id}/move`, body);
}

// ── review queue (D02) ─────────────────────────────────────────────────────

export interface QueueItem {
  id: number;
  name: string;
  headline?: string | null;
  application_id?: number | null;
  applications?: Array<{ id: number; job_id?: number; status?: string; stage?: { id: number; category?: string } | null }>;
}
export interface CandidateFile { id: number; file_id?: number; name: string; category?: string | null; mime?: string | null; url?: string | null }
export interface CandidateProfile {
  id: number;
  name: string;
  headline?: string | null;
  email?: string | null;
  location?: string | null;
  skills?: Array<string | { name: string }>;
  experience?: Array<{ title?: string; company?: string; from?: string; to?: string | null; summary?: string }>;
  files?: CandidateFile[];
  applications?: QueueItem['applications'];
  duplicates?: unknown[];
}

export const fetchQueue = (job: number | null, signal?: AbortSignal) =>
  apiGet<unknown>(`${B}/candidates`, { stage_category: 'APPLIED', status: 'ACTIVE', job_id: job ?? undefined }, signal).then((v) => rows<QueueItem>(v));
export const fetchCandidate = (id: number, signal?: AbortSignal) => apiGet<CandidateProfile>(`${B}/candidates/${id}`, undefined, signal);

/** The application a queue row is about: the row's own, or the candidate's one for this job (or its only one). */
export function applicationOf(item: Pick<QueueItem, 'application_id' | 'applications'>, job: number | null): number | null {
  if (item.application_id) return item.application_id;
  const apps = item.applications ?? [];
  const hit = (job ? apps.find((a) => a.job_id === job) : null) ?? (apps.length === 1 ? apps[0] : null);
  return hit?.id ?? null;
}

/** The CV among the candidate's files (category `cv`, else the first PDF, else the first file). */
export function cvOf(files: CandidateFile[] | undefined): CandidateFile | null {
  const list = files ?? [];
  return list.find((f) => (f.category ?? '').toLowerCase() === 'cv') ?? list.find((f) => /\.pdf$/i.test(f.name) || f.mime === 'application/pdf') ?? list[0] ?? null;
}
export const filePath = (f: CandidateFile) => f.url ?? `/api/files/${f.file_id ?? f.id}/download`;

export interface RejectInput { reason_id: number | string; note?: string; send_email?: boolean }
export const rejectApplication = (id: number, input: RejectInput) => apiPost<{ undo_until?: string }>(`${B}/applications/${id}/reject`, { send_email: true, ...input });
export const undoReject = (id: number) => apiPost(`${B}/applications/${id}/undo-reject`);

/** The stage of a pipeline a decision lands in: the first stage of that category. */
export function stageOfCategory(stages: Stage[], category: StageCategory): Stage | null {
  return [...stages].sort((a, b) => a.position - b.position).find((s) => s.category === category) ?? null;
}

/** J/K/A/R/S on the review queue: what a key asks for, or null. Typing in a field is never a shortcut. */
export type QueueKey = 'next' | 'prev' | 'advance' | 'reject' | 'shortlist';
export function queueKey(e: { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; target?: EventTarget | null }): QueueKey | null {
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  const t = e.target as { tagName?: string; isContentEditable?: boolean } | null;
  if (t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName ?? ''))) return null;
  switch (e.key.toLowerCase()) {
    case 'j': return 'next';
    case 'k': return 'prev';
    case 'a': return 'advance';
    case 'r': return 'reject';
    case 's': return 'shortlist';
    default: return null;
  }
}

// ── interviews (D03) & scorecards (D04) ────────────────────────────────────

export interface Interview {
  id: number;
  starts_at: string;
  ends_at?: string | null;
  status: string;
  format?: 'ONLINE' | 'ONSITE';
  title?: string | null;
  round?: string | null;
  candidate?: { id: number; name: string } | null;
  job?: { id: number; title: string } | null;
  application_id?: number | null;
  location?: string | null;
  /** The Meeting the interview made (source `recruitment.interview`), and its Meet room when it has one. */
  meeting_id?: number | null;
  meet_uuid?: string | null;
  online_url?: string | null;
  /** My part in it: an interviewer scores, an observer watches. */
  my_role?: 'INTERVIEWER' | 'OBSERVER' | string | null;
  my_evaluation?: { id: number; status: 'DRAFT' | 'SUBMITTED' } | null;
}

/** Today in the person's own time, as `YYYY-MM-DD`, and the UTC bounds of it for `from`/`to`. */
export function dayBounds(now = new Date()): { day: string; from: string; to: string } {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(start.getTime() + 86_400_000 - 1000);
  const utc = (d: Date) => d.toISOString().slice(0, 19).replace('T', ' ');
  const p = (n: number) => String(n).padStart(2, '0');
  return { day: `${start.getFullYear()}-${p(start.getMonth() + 1)}-${p(start.getDate())}`, from: utc(start), to: utc(end) };
}
/** A server stamp (UTC, `YYYY-MM-DD HH:MM:SS`) as a Date. */
export const stamp = (s: string) => new Date(s.includes('T') ? s : `${s.replace(' ', 'T')}Z`);

export const fetchMyInterviews = (from: string, to: string, signal?: AbortSignal) => apiGet<unknown>(`${B}/interviews`, { from, to, mine: 1 }, signal).then((v) => rows<Interview>(v));
export const fetchInterview = (id: number, signal?: AbortSignal) => apiGet<Interview>(`${B}/interviews/${id}`, undefined, signal);

export interface Criterion { id: number | string; name: string; description?: string | null; weight?: number | null }
export interface Kit {
  interview?: Interview;
  candidate: { id: number; name: string; headline?: string | null; summary?: string | null };
  criteria: Criterion[];
  questions: Array<{ id?: number | string; text: string; criterion_id?: number | string | null }>;
  mode?: string | null;
}
export const fetchKit = (id: number, signal?: AbortSignal) => apiGet<Kit>(`${B}/interviews/${id}/kit`, undefined, signal);

export type Recommendation = 'PROCEED' | 'HOLD' | 'ADDITIONAL_INTERVIEW' | 'REJECT' | 'FINAL_SELECTION';
export interface Rating { criterion_id: number | string; rating: number | null; comment: string }
export interface ScorecardDraft { ratings: Rating[]; notes: string; recommendation: Recommendation | null }
export interface Evaluation extends Partial<ScorecardDraft> { id: number; interview_id: number; status: 'DRAFT' | 'SUBMITTED' }

export const fetchMyEvaluation = (interview: number, signal?: AbortSignal) =>
  apiGet<unknown>(`${B}/evaluations`, { interview_id: interview, mine: 1 }, signal).then((v) => rows<Evaluation>(v)[0] ?? null);

/** What stops a scorecard being submitted, criterion by criterion (`criteria`) and overall (`form`). Empty = fine. */
export interface ScorecardErrors { criteria: Record<string, string>; form: string[] }
export function validateScorecard(draft: ScorecardDraft, criteria: Criterion[]): ScorecardErrors {
  const out: ScorecardErrors = { criteria: {}, form: [] };
  for (const c of criteria) {
    const r = draft.ratings.find((x) => String(x.criterion_id) === String(c.id));
    const v = r?.rating ?? null;
    if (v === null) out.criteria[String(c.id)] = 'Give a rating from 1 to 5.';
    else if (!Number.isInteger(v) || v < 1 || v > 5) out.criteria[String(c.id)] = 'A rating is from 1 to 5.';
    else if ((v === 1 || v === 5) && !r!.comment.trim()) out.criteria[String(c.id)] = `A ${v} needs a comment saying why.`;
  }
  if (!draft.recommendation) out.form.push('Choose a recommendation.');
  return out;
}
export const scorecardOk = (e: ScorecardErrors) => !Object.keys(e.criteria).length && !e.form.length;

const evalBody = (interview: number, d: ScorecardDraft) => ({
  interview_id: interview,
  ratings: d.ratings.filter((r) => r.rating !== null).map((r) => ({ criterion_id: r.criterion_id, rating: r.rating, comment: r.comment.trim() || null })),
  notes: d.notes,
  recommendation: d.recommendation,
});

/** Save the draft: a new evaluation the first time, a PATCH after. */
export async function saveScorecard(interview: number, existing: number | null, d: ScorecardDraft): Promise<Evaluation> {
  return existing ? apiPatch<Evaluation>(`${B}/evaluations/${existing}`, evalBody(interview, d)) : apiPost<Evaluation>(`${B}/evaluations`, evalBody(interview, d));
}

/** Save, then submit — refused here when the scorecard is not complete. */
export async function submitScorecard(interview: number, existing: number | null, d: ScorecardDraft, criteria: Criterion[]): Promise<Evaluation> {
  if (!scorecardOk(validateScorecard(d, criteria))) throw new Error('The scorecard is not complete.');
  const saved = await saveScorecard(interview, existing, d);
  return apiPost<Evaluation>(`${B}/evaluations/${saved.id}/submit`);
}

// ── approvals (D05) ────────────────────────────────────────────────────────

export type ApprovalKind = 'requisition' | 'selection' | 'offer';
export interface Approval {
  id: number;
  kind: ApprovalKind;
  title: string;
  subtitle?: string | null;
  detail?: string | null;
  /** The record the decision is on (the requisition, application or offer). */
  subject_id: number;
  requested_by?: string | null;
  requested_at?: string | null;
  above_band?: boolean;
}
export const fetchApprovals = (signal?: AbortSignal) => apiGet<unknown>(`${B}/approvals`, undefined, signal).then((v) => rows<Approval>(v).map(normaliseApproval));

/** The server's row, whatever it calls its type: `kind` or `type`, `subject_id` or the record's own id. */
function normaliseApproval(a: Approval & { type?: string }): Approval {
  const raw = String(a.kind ?? a.type ?? '').toLowerCase();
  const kind: ApprovalKind = raw.includes('offer') ? 'offer' : raw.includes('selection') ? 'selection' : 'requisition';
  return { ...a, kind, subject_id: a.subject_id ?? a.id };
}

export type Decision = 'approve' | 'reject' | 'return';
/** Where each kind's decision goes. Rejecting or returning needs a comment. */
export function decisionPath(a: Pick<Approval, 'kind' | 'subject_id'>): string {
  switch (a.kind) {
    case 'requisition': return `${B}/requisitions/${a.subject_id}/decide`;
    case 'offer': return `${B}/offers/${a.subject_id}/decide`;
    case 'selection': return `${B}/applications/${a.subject_id}/select/decide`;
  }
}
export async function decide(a: Pick<Approval, 'kind' | 'subject_id'>, decision: Decision, comment: string): Promise<unknown> {
  const c = comment.trim();
  if (decision !== 'approve' && !c) throw new Error('Say why, in a comment, to reject or return it.');
  return apiPost(decisionPath(a), { decision, comment: c || null });
}

/** The web page each kind opens on (Open). */
export function approvalRoute(a: Pick<Approval, 'kind' | 'subject_id'>): string {
  return a.kind === 'requisition' ? `/recruitment/requisitions/${a.subject_id}` : a.kind === 'offer' ? `/recruitment/offers/${a.subject_id}` : `/recruitment/applications/${a.subject_id}`;
}

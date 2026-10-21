import { useQuery } from '@tanstack/react-query';
import { apiGet, apiPatch, apiPost, apiPut } from '../../core/api';

/**
 * WorkSuite Board over `/api/board` (SRS-BOARD-001 §9). The server is the authority on every rule — who sees which
 * paper, quorum, eligibility, vote and circular outcomes, signature validity. What is checked here only saves a round
 * trip (a comment's length, a vote that cannot open without quorum) and the server checks it again. Where §9 names no
 * route, the routes follow Recruitment's REST conventions and the `{status, message, data}` envelope (see CHANGELOG).
 */
const B = '/api/board';

export const K = {
  dashboard: ['board', 'dashboard'] as const,
  meetings: (q: string) => ['board', 'meetings', q] as const,
  meeting: (id: number) => ['board', 'meeting', id] as const,
  agenda: (id: number) => ['board', 'agenda', id] as const,
  comments: (meeting: number, item: number | null) => ['board', 'comments', meeting, item ?? 0] as const,
  summary: (item: number) => ['board', 'summary', item] as const,
  annotations: (meeting: number, scope: string) => ['board', 'annotations', meeting, scope] as const,
  search: (q: string) => ['board', 'search', q] as const,
  approvals: ['board', 'approvals'] as const,
  circular: (id: number) => ['board', 'circular', id] as const,
  actions: ['board', 'actions'] as const,
  archive: ['board', 'archive'] as const,
  minutes: (id: number) => ['board', 'minutes', id] as const,
  delivery: (meeting: number) => ['board', 'delivery', meeting] as const,
  vault: ['board', 'vault'] as const,
};

export function rows<T>(v: unknown): T[] {
  if (Array.isArray(v)) return v as T[];
  if (v && typeof v === 'object') {
    const o = v as { items?: unknown; data?: unknown };
    if (Array.isArray(o.items)) return o.items as T[];
    if (Array.isArray(o.data)) return o.data as T[];
  }
  return [];
}

/** `can{}` with or without the `board.` prefix. */
export function allowed(m: { can?: Record<string, boolean> } | null | undefined, key: string): boolean {
  if (!m?.can) return false;
  const bare = key.replace(/^board\./, '');
  return m.can[bare] === true || m.can[`board.${bare}`] === true;
}

// ── shapes ─────────────────────────────────────────────────────────────────

export type Flag = 'NEW' | 'AMENDED' | null;

export interface Body { id: number; name: string; kind?: 'board' | 'committee' | string }
export interface MeetingCard {
  id: number;
  title: string;
  number?: string | null;
  body?: Body | null;
  starts_at: string;
  ends_at?: string | null;
  room?: string | null;
  status: string;
  /** FR-DX-03: computed by the server per user against what the user last opened. */
  flag?: Flag;
  archived_at?: string | null;
}

export interface Dashboard {
  user?: { name?: string; role?: string };
  bodies: Body[];
  meetings: MeetingCard[];
  counters?: { new_meetings?: number; new_items?: number; amended?: number; approvals?: number };
  documents?: Array<{ id: number; title: string; source?: string; date?: string; starred?: boolean }>;
  notices?: Array<{ id: number; title: string; body?: string; date?: string }>;
  can?: Record<string, boolean>;
}

export interface Participant {
  id: number;
  name: string;
  role?: string | null;
  kind?: 'member' | 'invitee' | 'presenter' | string;
  reply?: 'in_person' | 'remote' | 'apologies' | null;
  presence?: 'in_room' | 'remote' | 'left' | 'absent' | null;
  conflict_items?: string[];
  item_only?: string[] | null;
  voting?: boolean;
}

export interface AgendaItem {
  id: number;
  number: string;
  title: string;
  section?: string | null;
  paper?: { id: number; name: string; pages?: number | null; version?: number } | null;
  my_notes?: number;
  comments?: number;
  seen_at?: string | null;
  status?: string | null;
  flag?: Flag;
  minutes?: number | null;
  restricted?: boolean;
}

export interface Resolution { id: number; number: string; text: string; proposer?: string | null; seconder?: string | null; rule?: string | null }
export interface Vote {
  id: number;
  status: 'draft' | 'open' | 'closed';
  secret?: boolean;
  for?: number;
  against?: number;
  abstain?: number;
  cast?: number;
  eligible?: number;
  excluded?: string[];
  opened_at?: string | null;
  my_choice?: string | null;
  result?: string | null;
}
export interface Poll { id: number; question: string; options: Array<{ id: number; label: string; count?: number }>; anonymous?: boolean; status: 'open' | 'closed'; responded?: number; audience?: number }

export interface Meeting extends MeetingCard {
  location?: string | null;
  meet_link?: string | null;
  organiser?: string | null;
  purpose?: string | null;
  quorum_rule?: string | null;
  my_attendance?: 'in_person' | 'remote' | 'apologies' | null;
  my_role?: 'chair' | 'secretary' | 'member' | 'invitee' | 'presenter' | string;
  participants?: Participant[];
  pack?: { id: number; version: number; pages?: number | null; amended_at?: string | null } | null;
  minutes_id?: number | null;
  started_at?: string | null;
  quorum?: Quorum | null;
  /** Notice channels the administrator allows for this meeting (FR-NOT-05). */
  notice_channels?: string[];
  live?: { item_id?: number | null; page?: number | null; resolution?: Resolution | null; vote?: Vote | null; poll?: Poll | null } | null;
  can?: Record<string, boolean>;
}

export interface Quorum { present: number; required: number; voting_total?: number; met: boolean }

export interface Comment { id: number; author: string; mine?: boolean; body: string; at: string; share: 'all' | 'specific' | 'private'; with?: string[]; item?: string | null }
export interface Annotation {
  id: number | string;
  paper: string;
  item?: string | null;
  page: number;
  quote?: string | null;
  note?: string | null;
  share: 'private' | 'shared';
  with?: string[];
  owner?: string | null;
  at: string;
  detached?: boolean;
  version?: number;
  kind?: 'highlight' | 'underline' | 'strike' | 'pen' | 'text' | 'sticky' | 'shape' | 'bookmark';
}
export interface SearchResult { type: 'agenda' | 'paper' | 'minutes' | 'resolution' | 'comment' | 'note' | 'circular'; title: string; snippet?: string; page?: number | null; meeting_id?: number | null; meta?: string | null; flag?: Flag }

export interface Approval { id: number; kind: 'sign' | 'circular' | 'minutes' | 'agenda'; title: string; subtitle?: string | null; due?: string | null; ref_id: number; document?: { version: number; sha256: string; title?: string; body?: string; signed_by?: Array<{ name: string; at: string }> } | null }

export interface Circular {
  id: number;
  number: string;
  title: string;
  text: string;
  status: string;
  deadline: string | null;
  secret?: boolean;
  show_responses?: boolean;
  offline_responses_allowed?: boolean;
  can_respond?: boolean;
  approvals?: number;
  required?: number;
  my_response?: { choice: string; comment?: string | null } | null;
  responses?: Array<{ name: string; choice: string; comment?: string | null }>;
}

export interface BoardAction { id: number; title: string; source?: string | null; task_ref?: string | null; due?: string | null; status: 'open' | 'in_progress' | 'blocked' | 'done' | 'verified'; note?: string | null; assigned_by?: string | null; meeting?: string | null }
export interface MinutesBlock { id: string; kind: 'discussion' | 'poll' | 'decision' | 'action' | 'conflict' | 'vote'; text: string; item_id?: number | null; ref?: string | null }
export interface Minutes { id: number; meeting_id: number; version: number; saved_at?: string | null; blocks: MinutesBlock[]; versions?: Array<{ version: number; by: string; at: string }> }

// ── reads ─────────────────────────────────────────────────────────────────

export const fetchDashboard = (signal?: AbortSignal) => apiGet<Dashboard>(`${B}/dashboard`, undefined, signal);
export const useDashboard = () => useQuery({ queryKey: K.dashboard, queryFn: ({ signal }) => fetchDashboard(signal), refetchInterval: 120_000 });
export const fetchMeetings = async (q: { from?: string; to?: string; archived?: boolean }, signal?: AbortSignal) =>
  rows<MeetingCard>(await apiGet(`${B}/meetings`, { from: q.from, to: q.to, archived: q.archived ? 1 : undefined }, signal));
export const fetchMeeting = (id: number, signal?: AbortSignal) => apiGet<Meeting>(`${B}/meetings/${id}`, undefined, signal);
export const fetchAgenda = async (id: number, signal?: AbortSignal) => rows<AgendaItem>(await apiGet(`${B}/meetings/${id}/agenda`, undefined, signal));
export const fetchComments = async (meeting: number, item: number | null, signal?: AbortSignal) =>
  rows<Comment>(await apiGet(`${B}/meetings/${meeting}/comments`, { item: item ?? undefined }, signal));
export const fetchAnnotations = async (meeting: number, scope: 'mine' | 'shared', signal?: AbortSignal) =>
  rows<Annotation>(await apiGet(`${B}/meetings/${meeting}/annotations`, { scope }, signal));
export const fetchSearch = async (q: string, signal?: AbortSignal) => rows<SearchResult>(await apiGet(`${B}/search`, { q }, signal));
export const fetchApprovals = async (signal?: AbortSignal) => rows<Approval>(await apiGet(`${B}/approvals`, undefined, signal));
export const fetchCircular = (id: number, signal?: AbortSignal) => apiGet<Circular>(`${B}/circulars/${id}`, undefined, signal);
export const fetchActions = async (signal?: AbortSignal) => rows<BoardAction>(await apiGet(`${B}/actions`, { mine: 1 }, signal));
export const fetchMinutes = (id: number, signal?: AbortSignal) => apiGet<Minutes>(`${B}/minutes/${id}`, undefined, signal);
export const fetchDelivery = async (meeting: number, signal?: AbortSignal) =>
  rows<{ member: string; email?: string; sms?: string; app?: string }>(await apiGet(`${B}/meetings/${meeting}/notices/delivery`, undefined, signal));

// ── writes ────────────────────────────────────────────────────────────────

export const setAttendance = (meeting: number, mode: 'in_person' | 'remote' | 'apologies') => apiPost(`${B}/meetings/${meeting}/attendance`, { mode });
export const present = (meeting: number, item: number, page = 1) => apiPost(`${B}/meetings/${meeting}/present`, { item_id: item, page });
export const lifecycle = (meeting: number, step: 'start' | 'adjourn' | 'complete') => apiPost(`${B}/meetings/${meeting}/${step}`);
export const summarize = (item: number) => apiPost<{ points: Array<{ label: string; text: string; page?: number | null }>; sources?: unknown[] }>(`${B}/ai/summarize`, { item_id: item });
export const brief = (meeting: number) => apiPost<{ sections: Array<{ title: string; items: Array<{ text: string; cite?: string | null }> }> }>(`${B}/ai/brief`, { meeting_id: meeting });

export const COMMENT_MAX = 2000;
/** FR-DX-10: 1–2,000 characters, and a "specific people" comment names someone. */
export function commentProblem(body: string, share: Comment['share'], people: number[]): string | null {
  const t = body.trim();
  if (!t) return 'Write a comment first.';
  if (t.length > COMMENT_MAX) return `A comment is at most ${COMMENT_MAX} characters.`;
  if (share === 'specific' && people.length === 0) return 'Choose who sees this comment.';
  return null;
}
export async function postComment(meeting: number, item: number | null, body: string, share: Comment['share'], people: number[] = []) {
  const p = commentProblem(body, share, people);
  if (p) throw new Error(p);
  return apiPost<Comment>(`${B}/meetings/${meeting}/comments`, { item_id: item, body: body.trim(), share, user_ids: share === 'specific' ? people : undefined });
}

export const saveAnnotation = (meeting: number, a: Partial<Annotation> & { paper_id: number; page: number }) => apiPost<Annotation>(`${B}/meetings/${meeting}/annotations`, a);
export const reattach = (id: number | string, version: number) => apiPatch<Annotation>(`${B}/annotations/${id}`, { reattach_to_version: version });

export const respondCircular = (id: number, choice: 'approve' | 'reject' | 'abstain', comment?: string) => apiPost(`${B}/circulars/${id}/respond`, { choice, comment: comment?.trim() || undefined });

export interface SignInput { method: 'draw' | 'saved' | 'certificate'; image?: string | null; sha256: string; version: number; verification: 'touch-id' | 'server' }
/** Where an approval is signed: the minutes' own route (§9), else the approval item's. */
export const signPath = (a: Approval) => (a.kind === 'minutes' ? `${B}/minutes/${a.ref_id}/sign` : `${B}/approvals/${a.id}/sign`);
export const sign = (a: Approval, input: SignInput) => apiPost(signPath(a), { method: input.method, image: input.image ?? undefined, document_sha256: input.sha256, document_version: input.version, verification: input.verification });
export const approve = (a: Approval) => (a.kind === 'minutes' ? apiPost(`${B}/minutes/${a.ref_id}/approve`) : apiPost(`${B}/approvals/${a.id}/approve`));

export const updateAction = (id: number, status: 'in_progress' | 'blocked' | 'done', note?: string) => apiPost(`${B}/actions/${id}/progress`, { status, note: note?.trim() || undefined });

export const createVote = (resolution: number) => apiPost<Vote>(`${B}/votes`, { resolution_id: resolution });
export const voteStep = (vote: number, step: 'open' | 'close') => apiPost<Vote>(`${B}/votes/${vote}/${step}`);
export const castVote = (vote: number, choice: 'for' | 'against' | 'abstain') => apiPost<Vote>(`${B}/votes/${vote}/cast`, { choice });

export const launchPoll = (meeting: number, p: { question: string; options: string[]; anonymous: boolean }) => apiPost<Poll>(`${B}/meetings/${meeting}/polls`, p);
export const pollStep = (poll: number, step: 'close' | 'insert-minutes') => apiPost<Poll>(`${B}/polls/${poll}/${step}`);
export const respondPoll = (poll: number, option: number) => apiPost<Poll>(`${B}/polls/${poll}/respond`, { option_id: option });

export const autosaveMinutes = (id: number, blocks: MinutesBlock[], version: number) => apiPut<Minutes>(`${B}/minutes/${id}/autosave`, { blocks, base_version: version });
export const saveMinutesVersion = (id: number, blocks: MinutesBlock[]) => apiPost<Minutes>(`${B}/minutes/${id}`, { blocks });
export const compareMinutes = (id: number, a: number, b: number) => apiGet<{ diff: Array<{ op: 'same' | 'add' | 'del'; text: string }> }>(`${B}/minutes/${id}/versions/compare`, { a, b });

export const sendNotice = (meeting: number, n: { recipients: string[]; channels: string[]; subject: string; message: string; draft?: boolean }) => apiPost(`${B}/meetings/${meeting}/notices`, n);
export const checkIntegrity = (meeting: number) => apiPost<{ ok: boolean; checked_at?: string; message?: string }>(`${B}/integrity/check`, { meeting_id: meeting });

// ── pure helpers ──────────────────────────────────────────────────────────

/** A vote may open only with quorum (FR-QRM, D-12), and only once. */
export function voteBlock(q: Quorum | null | undefined, v: Vote | null | undefined): string | null {
  if (v?.status === 'open') return 'Voting is open.';
  if (v?.status === 'closed') return 'This vote is closed.';
  if (!q) return 'Quorum is not known yet.';
  if (!q.met) return 'Cannot open vote — no quorum';
  return null;
}

/** The tally a person may see (§9.3): a secret ballot shows only how many were cast. */
export function tallyView(v: Vote): { counts: { for: number; against: number; abstain: number } | null; cast: number; eligible: number } {
  return { counts: v.secret ? null : { for: v.for ?? 0, against: v.against ?? 0, abstain: v.abstain ?? 0 }, cast: v.cast ?? (v.for ?? 0) + (v.against ?? 0) + (v.abstain ?? 0), eligible: v.eligible ?? 0 };
}

/** D-09 groups: overdue, this week, later, done awaiting verification. */
export function groupActions(list: BoardAction[], now = new Date()): Record<'overdue' | 'week' | 'later' | 'verify', BoardAction[]> {
  const out = { overdue: [] as BoardAction[], week: [] as BoardAction[], later: [] as BoardAction[], verify: [] as BoardAction[] };
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  for (const a of list) {
    if (a.status === 'verified') continue;
    if (a.status === 'done') { out.verify.push(a); continue; }
    const due = a.due ? new Date(`${a.due.slice(0, 10)}T00:00:00`).getTime() : null;
    if (due !== null && due < today) out.overdue.push(a);
    else if (due !== null && due < today + 7 * 86_400_000) out.week.push(a);
    else out.later.push(a);
  }
  return out;
}

/** The meeting days of a month grid (D-01, D-03): weeks of seven, Sunday first, null outside the month. */
export function monthGrid(year: number, month: number): Array<Array<number | null>> {
  const first = new Date(year, month, 1).getDay();
  const days = new Date(year, month + 1, 0).getDate();
  const cells: Array<number | null> = [...Array(first).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  while (cells.length % 7) cells.push(null);
  const weeks: Array<Array<number | null>> = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

export const dayKey = (iso: string) => iso.slice(0, 10);
export const fmtDate = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '');
export const fmtTime = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : '');

/** SHA-256 of a document's bytes, shown before signing (FR-SIG). */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', bytes as unknown as ArrayBuffer);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Live-meeting limits by role (FR-DX-15): invitees cannot comment or download during the meeting; presenters see only their item. */
export function liveLimits(role: string | undefined, live: boolean): { comment: boolean; download: boolean; allItems: boolean } {
  if (!live) return { comment: true, download: true, allItems: role !== 'presenter' };
  return { comment: role !== 'invitee' && role !== 'presenter', download: role !== 'invitee' && role !== 'presenter', allItems: role !== 'presenter' };
}

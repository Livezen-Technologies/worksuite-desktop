import { useQuery } from '@tanstack/react-query';
import { ApiError, apiDelete, apiGet, apiPatch, apiPost, apiPut } from '../../core/api';

/**
 * WorkSuite Board over `/api/board`, as the server's contract has it (worksuite docs/board/API.md, module 1.0.0):
 * every path, body and shape below is the server's, and the server is the authority on every rule — who sees which
 * paper, quorum, eligibility, vote and circular outcomes, signature validity. What is checked here only saves a round
 * trip (a comment's length, a vote that cannot open without quorum) and the server checks it again.
 *
 * Envelope `{status, message, data}`; errors `{status: "error", message, errors}` with `errors.code` naming the case.
 * Records the caller may not see answer 404. Times are ISO 8601 UTC.
 */
const B = '/api/board';

export const K = {
  meta: ['board', 'meta'] as const,
  dashboard: ['board', 'dashboard'] as const,
  meetings: (q: string) => ['board', 'meetings', q] as const,
  meeting: (id: number) => ['board', 'meeting', id] as const,
  pack: (id: number) => ['board', 'pack', id] as const,
  agenda: (id: number) => ['board', 'agenda', id] as const,
  paper: (id: number) => ['board', 'paper', id] as const,
  comments: (meeting: number, item: number | null) => ['board', 'comments', meeting, item ?? 0] as const,
  summary: (paper: number) => ['board', 'summary', paper] as const,
  annotations: (meeting: number, scope: string) => ['board', 'annotations', meeting, scope] as const,
  search: (q: string) => ['board', 'search', q] as const,
  approvals: ['board', 'approvals'] as const,
  circular: (id: number) => ['board', 'circular', id] as const,
  actions: ['board', 'actions'] as const,
  archive: ['board', 'archive'] as const,
  minutes: (meeting: number) => ['board', 'minutes', meeting] as const,
  minuteVersions: (id: number) => ['board', 'minuteVersions', id] as const,
  room: (meeting: number) => ['board', 'room', meeting] as const,
  vault: ['board', 'vault'] as const,
};

const items = <T>(v: unknown): T[] => {
  if (Array.isArray(v)) return v as T[];
  const o = v && typeof v === 'object' ? (v as { items?: unknown }) : null;
  return Array.isArray(o?.items) ? (o!.items as T[]) : [];
};

/** `can{}` from `GET /meta`, keys with or without the `board.` prefix. */
export function allowed(m: { can?: Record<string, boolean> } | null | undefined, key: string): boolean {
  if (!m?.can) return false;
  const bare = key.replace(/^board\./, '');
  return m.can[bare] === true || m.can[`board.${bare}`] === true;
}

/** The server's error code (`errors.code`), when there is one. */
export function errorCode(e: unknown): string | null {
  if (!(e instanceof ApiError) || !e.data || typeof e.data !== 'object') return null;
  const c = (e.data as { code?: unknown }).code;
  return typeof c === 'string' ? c : null;
}

// ── shapes (the server's) ──────────────────────────────────────────────────

export type Flags = { new?: boolean; amended?: boolean } | null | undefined;
export type Flag = 'NEW' | 'AMENDED' | null;
/** FR-DX-03: the server computes NEW / AMENDED per person against what they last opened. */
export const flagOf = (f: Flags): Flag => (f?.amended ? 'AMENDED' : f?.new ? 'NEW' : null);

/** A dashboard tab: a board or a committee. `key` is `board:{id}` / `committee:{id}`, the meetings filter's `body=`. */
export interface Body { key: string; type: 'board' | 'committee'; id: number; name: string; board_id?: number | null }

export interface Attendance { user_id: number; name: string; meeting_role: string; state: string; joined_at?: string | null; left_at?: string | null; source?: string | null; item_only_id?: number | null; note?: string | null }

export interface Quorum { state: 'UNKNOWN' | 'NOT_ESTABLISHED' | 'ESTABLISHED' | 'LOST' | string; established: boolean; present_voting: number; eligible_voting: number; required: number; chair_present?: boolean; reasons?: string[]; label?: string }

export interface MeetingRow {
  id: number;
  board_id: number;
  board?: string | null;
  committee_id?: number | null;
  committee?: string | null;
  body?: string | null;
  meeting_number?: string | null;
  title: string;
  purpose?: string | null;
  mode?: string | null;
  gov_status: string;
  confidentiality?: string | null;
  starts_at: string;
  ends_at?: string | null;
  timezone?: string | null;
  location?: string | null;
  online_provider?: string | null;
  online_url?: string | null;
  agenda_version?: number;
  quorum_state?: string | null;
  chair_user_id?: number | null;
  chair?: string | null;
  organizer?: string | null;
  started_at?: string | null;
  ended_at?: string | null;
  pack?: { pack_id: number; status: string; current_version: number } | null;
  pack_revision_pending?: boolean;
  my_role?: string | null;
  my_attendance?: Attendance | null;
  can_run?: boolean;
  flags?: Flags;
  presenting?: { agenda_item_id: number; page: number | null } | null;
  archive?: { pack_versions?: number; minutes?: unknown; resolutions?: number; votes?: number; actions?: number; read_only?: boolean } | null;
}

export interface Meeting extends MeetingRow {
  quorum?: Quorum | null;
  quorum_rule?: { type?: string; min_count?: number; percent?: number } | null;
  participants?: Attendance[];
  allowed_actions?: string[];
}

/** The body key of a meeting: its committee, else its board. */
export const bodyKeyOf = (m: Pick<MeetingRow, 'board_id' | 'committee_id'>) => (m.committee_id ? `committee:${m.committee_id}` : `board:${m.board_id}`);
export const isLive = (m: Pick<MeetingRow, 'gov_status'> | null | undefined) => m?.gov_status === 'IN_PROGRESS';
/** Meeting roles come upper case (CHAIR, SECRETARY, MEMBER, INVITEE, PRESENTER, OBSERVER, MANAGER). */
export const roleOf = (m: Pick<MeetingRow, 'my_role'> | null | undefined) => (m?.my_role ?? '').toLowerCase();

export interface Meta {
  org_id?: number;
  can?: Record<string, boolean>;
  scope?: string;
  boards?: Array<{ id: number; name: string; short_name?: string | null; status?: string }>;
  committees?: Array<{ id: number; name: string; board_id: number; parent_id?: number | null; depth?: number; status?: string }>;
  users?: Array<{ id: number; name: string; email?: string }>;
}

export interface Dashboard {
  kpis?: { upcoming_meetings?: number; papers_to_read?: number; approvals_pending?: number; open_actions?: number; actions_overdue?: number; circulars_open?: number };
  tabs: Array<{ type: 'board' | 'committee'; id: number; name: string; board_id?: number | null }>;
  upcoming: MeetingRow[];
  pending_decisions?: Array<{ kind: 'resolution' | 'circular'; id: number; number?: string | null; title: string; state?: string; label?: string }>;
  actions?: Action[];
  whats_new?: { new_meetings?: number; new_circulars?: number; new_items_and_papers?: number; amended?: number; pending_approvals?: number; pending_signatures?: number };
  calendar?: Array<{ id: number; date: string; title: string; body?: string | null }>;
}

export const bodiesOf = (d: Pick<Dashboard, 'tabs'> | null | undefined): Body[] => (d?.tabs ?? []).map((t) => ({ key: `${t.type}:${t.id}`, type: t.type, id: t.id, name: t.name, board_id: t.board_id ?? null }));

export interface AgendaItem {
  id: number;
  parent_id?: number | null;
  number: string;
  title: string;
  item_type?: string | null;
  description?: string | null;
  presenter?: string | null;
  duration_minutes?: number | null;
  papers?: Array<{ id: number; title: string; status?: string }>;
  comment_count?: number;
  my_notes?: number;
  seen_at?: string | null;
  flags?: Flags;
  withheld?: boolean;
  reason?: string | null;
  depth?: number;
  children?: AgendaItem[];
}

export interface PaperVersion { id: number; paper_id: number; version: number; sha256?: string; name?: string | null; pages?: number | null; mime?: string | null; created_at?: string | null }
export interface Paper { id: number; title: string; agenda_item_id?: number | null; item_number?: string | null; status?: string; current_version?: PaperVersion | null; versions?: PaperVersion[]; controls?: { allow_download?: boolean; allow_annotate?: boolean; watermark?: boolean } | null; flags?: Flags }

export interface PackVersion { id: number; pack_id: number; version: number; pages?: number | null; bytes?: number | null; change_note?: string | null; published_at?: string | null; acknowledged?: boolean }
export interface Pack { id: number; status: string; current_version: number; versions?: PackVersion[] }
export interface MeetingPack { pack: Pack | null; revision_pending?: boolean }
/** The published version this member reads (the meeting's current one). */
export const currentPackVersion = (p: MeetingPack | null | undefined): PackVersion | null => p?.pack?.versions?.find((v) => v.version === p.pack!.current_version) ?? null;

export type Audience = 'ALL' | 'SPECIFIC' | 'PRIVATE';
export interface Comment { id: number; board_meeting_id: number; agenda_item_id: number; parent_id?: number | null; user_id: number; author: string; body: string; audience: Audience; shared_with?: number[]; created_at: string }

export type AnnotationKind = 'highlight' | 'underline' | 'strike' | 'pen' | 'note' | 'sticky' | 'shape' | 'bookmark';
export type Visibility = 'PRIVATE' | 'SELECTED' | 'COMMITTEE' | 'SECRETARY' | 'EVERYONE';
export interface Annotation {
  id: number;
  user_id: number;
  author?: string | null;
  mine?: boolean;
  board_meeting_id?: number | null;
  paper_version_id?: number | null;
  pack_version_id?: number | null;
  page?: number | null;
  anchor?: { text?: string } | null;
  kind: AnnotationKind;
  body?: string | null;
  colour?: string | null;
  visibility: Visibility;
  shared_with?: number[];
  detached?: boolean;
  client_uuid?: string | null;
  updated_at?: string | null;
}

export interface SearchResult { type: 'meeting' | 'agenda_item' | 'paper' | 'minutes' | 'resolution' | 'action' | 'annotation' | 'note'; id?: number; title: string; preview?: string | null; board_meeting_id?: number | null; meeting_number?: string | null; year?: number | null; page?: number | null }

export type ApprovalKind = 'PAPER' | 'MINUTES' | 'CIRCULAR' | 'SIGNATURE' | 'AGENDA' | 'PACK';
export interface Approval { id: number; kind: ApprovalKind; record_id: number; title: string; sub?: string | null; due_label?: string | null; overdue?: boolean; role?: string | null; open_path?: string | null }

export interface Circular {
  id: number;
  number: string;
  title: string;
  resolution_text: string;
  status: string;
  deadline_at: string | null;
  sign_required?: boolean;
  show_responses?: boolean;
  secret?: boolean;
  allow_offline?: boolean;
  approvals?: number;
  rejections?: number;
  abstentions?: number;
  eligible?: number;
  required?: number;
  progress?: string;
  document_sha256?: string | null;
  me?: { eligible?: boolean; response?: string | null; responded_at?: string | null; signed?: boolean } | null;
  recipients?: Array<{ user_id: number; name: string; eligible?: boolean; responded?: boolean; response?: string | null; comment?: string | null }>;
}

export type ActionStatus = 'OPEN' | 'IN_PROGRESS' | 'BLOCKED' | 'COMPLETED' | 'VERIFIED';
export interface Action { id: number; title: string; description?: string | null; meeting_number?: string | null; board_meeting_id?: number | null; agenda_item_id?: number | null; owner?: string | null; due_on?: string | null; status: ActionStatus; task_id?: number | null; overdue?: boolean; decision_extract?: { resolution_number?: string; title?: string; text?: string } | null }

export interface Resolution { id: number; board_meeting_id?: number | null; agenda_item_id?: number | null; resolution_number: string; title: string; resolution_text: string; proposer?: string | null; seconder?: string | null; status: string; voting_rule?: string | null; votes?: Array<{ id: number; status: string }> }
export interface VoteResult { outcome: string; for?: number; against?: number; abstain?: number; cast?: number; eligible?: number; tie?: boolean; casting_vote_used?: boolean; casting_choice?: string | null }
export interface Vote {
  id: number;
  board_meeting_id?: number | null;
  resolution_id?: number | null;
  title?: string | null;
  method?: string;
  options?: string[];
  secret?: boolean;
  status: 'CREATED' | 'OPEN' | 'CLOSING' | 'RESULT_FINAL' | 'CANCELLED' | string;
  ballots_cast?: number;
  eligible_count?: number;
  casting_vote?: boolean;
  me?: { eligible?: boolean; reason?: string | null; has_voted?: boolean; choice?: string | null } | null;
  result?: VoteResult | null;
  counts?: Record<string, number> | null;
  voters?: Array<{ user_id: number; name: string; eligible: boolean; reason?: string | null; conflict_excluded?: boolean; has_voted?: boolean }>;
}
export interface Poll { id: number; question: string; options: string[]; multi?: boolean; anonymous?: boolean; status: 'OPEN' | 'CLOSED'; my_choice?: string[] | null; results?: { counts?: Record<string, number>; responses?: number } | null }

export type BlockType = 'meta' | 'attendance' | 'quorum' | 'agenda_item' | 'discussion' | 'decision' | 'note' | 'heading' | 'action_note' | 'deferred' | 'resolution' | 'vote' | 'poll' | 'action' | 'conflict' | 'adjournment' | 'redacted';
export interface MinutesBlock { id: string; type: BlockType; agenda_item_id?: number | null; text: string; read_only?: boolean; source?: 'record' | 'human' | 'ai'; data?: unknown }
export interface MinuteVersion { id: number; seq: number; version: string; sha256?: string; note?: string | null; author?: string | null; created_at: string }
export interface Minutes { id: number; board_meeting_id: number; status: string; editable?: boolean; blocks: MinutesBlock[]; current_version?: MinuteVersion | null; final_sha256?: string | null; autosave_seconds?: number; presenting_item_id?: number | null; recovery?: { autosave_id: number; saved_at: string; client_rev?: number | null; blocks: MinutesBlock[] } | null }

/** A realtime frame on `board.meeting.{id}`, delivered on this person's socket and replayed by `GET /meetings/{id}/events`. */
export interface Frame { type: 'board.realtime'; channel: string; event: string; seq: number; board_meeting_id: number; data: Record<string, unknown>; at?: string }

// ── reads ─────────────────────────────────────────────────────────────────

export const fetchMeta = (signal?: AbortSignal) => apiGet<Meta>(`${B}/meta`, undefined, signal);
export const useMeta = () => useQuery({ queryKey: K.meta, queryFn: ({ signal }) => fetchMeta(signal), staleTime: 300_000 });
export const fetchDashboard = (signal?: AbortSignal) => apiGet<Dashboard>(`${B}/dashboard`, undefined, signal);
export const useDashboard = () => useQuery({ queryKey: K.dashboard, queryFn: ({ signal }) => fetchDashboard(signal), refetchInterval: 120_000 });
export const fetchMeetings = async (q: { from?: string; to?: string; body?: string | null }, signal?: AbortSignal) =>
  items<MeetingRow>(await apiGet(`${B}/meetings`, { from: q.from, to: q.to, body: q.body ?? undefined, per_page: 200 }, signal));
export const fetchArchive = async (signal?: AbortSignal) => items<MeetingRow>(await apiGet(`${B}/archive`, undefined, signal));
export const fetchMeeting = (id: number, signal?: AbortSignal) => apiGet<Meeting>(`${B}/meetings/${id}`, undefined, signal);
export const fetchPack = (id: number, signal?: AbortSignal) => apiGet<MeetingPack>(`${B}/meetings/${id}/pack`, undefined, signal);
/** The agenda, nested items flattened in order (withheld items stay, as the server's placeholder). */
export const fetchAgenda = async (id: number, signal?: AbortSignal) => flatten(items<AgendaItem>(await apiGet(`${B}/meetings/${id}/agenda`, undefined, signal)));
export function flatten(list: AgendaItem[], depth = 0): AgendaItem[] {
  return list.flatMap((i) => [{ ...i, depth: i.depth ?? depth }, ...flatten(i.children ?? [], depth + 1)]);
}
export const fetchPaper = (id: number, signal?: AbortSignal) => apiGet<Paper>(`${B}/papers/${id}`, undefined, signal);
/** The exact version's bytes (watermarked for the viewer). */
export const paperFilePath = (versionId: number) => `${B}/papers/versions/${versionId}/file`;
/** The member's own rendition of a published pack: watermarked, withheld items replaced by a notice. */
export const packFilePath = (versionId: number) => `${B}/packs/versions/${versionId}/file?member=me`;
export const fetchComments = async (meeting: number, item: number | null, signal?: AbortSignal) =>
  items<Comment>(await apiGet(`${B}/meetings/${meeting}/comments`, { agenda_item_id: item ?? undefined }, signal));
export const fetchAnnotations = async (meeting: number, scope: 'mine' | 'shared', signal?: AbortSignal) => {
  const list = items<Annotation>(await apiGet(`${B}/annotations`, { board_meeting_id: meeting, mine: scope === 'mine' ? 1 : undefined }, signal));
  return scope === 'mine' ? list : list.filter((a) => !a.mine);
};
export const fetchSearch = async (q: string, signal?: AbortSignal) => items<SearchResult>(await apiGet(`${B}/search`, { q }, signal));
export const fetchApprovals = async (signal?: AbortSignal) => items<Approval>(await apiGet(`${B}/approvals`, { box: 'waiting' }, signal));
export const fetchCircular = (id: number, signal?: AbortSignal) => apiGet<Circular>(`${B}/circulars/${id}`, undefined, signal);
export const fetchActions = async (signal?: AbortSignal) => items<Action>(await apiGet(`${B}/actions`, { owner: 'me', view: 'all' }, signal));
export const fetchMeetingMinutes = (meeting: number, signal?: AbortSignal) => apiGet<Minutes | null>(`${B}/meetings/${meeting}/minutes`, undefined, signal);
export const fetchMinutes = (id: number, signal?: AbortSignal) => apiGet<Minutes>(`${B}/minutes/${id}`, undefined, signal);
export const fetchMinuteVersions = async (id: number, signal?: AbortSignal) => items<MinuteVersion>(await apiGet(`${B}/minutes/${id}/versions`, undefined, signal));
export const fetchVotes = async (meeting: number, signal?: AbortSignal) => items<Vote>(await apiGet(`${B}/votes`, { meeting_id: meeting }, signal));
export const fetchResolutions = async (meeting: number, signal?: AbortSignal) => items<Resolution>(await apiGet(`${B}/resolutions`, { meeting_id: meeting }, signal));
export const fetchPolls = async (meeting: number, signal?: AbortSignal) => items<Poll>(await apiGet(`${B}/meetings/${meeting}/polls`, undefined, signal));
/** The stored frames after `after` this person may hear: the replay on reconnect, and the poll where the gateway is off. */
export const fetchEvents = (meeting: number, after: number, signal?: AbortSignal) =>
  apiGet<{ channel: string; items: Frame[]; last_seq: number }>(`${B}/meetings/${meeting}/events`, { after }, signal);

// ── writes ────────────────────────────────────────────────────────────────

/** A participant answers for themselves (FR-ATT-01): attending, declined, remote, or apologies (EXCUSED). */
export type Rsvp = 'ACCEPTED' | 'REMOTE' | 'EXCUSED' | 'DECLINED';
export const setAttendance = (meeting: number, state: Rsvp) => apiPost<{ attendance: Attendance; quorum: Quorum }>(`${B}/meetings/${meeting}/attendance`, { state });
export const present = (meeting: number, item: number, page = 1) => apiPost(`${B}/meetings/${meeting}/present`, { agenda_item_id: item, page });
export const lifecycle = (meeting: number, step: 'start' | 'adjourn' | 'reconvene' | 'complete') => apiPost<Meeting>(`${B}/meetings/${meeting}/${step}`);
export const summarize = (paper: number) => apiPost<{ summary: string; sources?: Array<{ type: string; id: number; title: string; version?: number }>; ai?: boolean; label?: string }>(`${B}/ai/summarize`, { paper_id: paper });
export const brief = (meeting: number) =>
  apiPost<{ meeting?: string; decision_items: string[]; high_risk_items: string[]; pending_actions: string[]; suggested_questions: string[]; sources?: unknown[]; ai?: boolean; label?: string }>(`${B}/ai/brief`, { meeting_id: meeting });

export const COMMENT_MAX = 2000;
/** FR-DX-10: 1–2,000 characters, and a "specific people" comment names someone. */
export function commentProblem(body: string, audience: Audience, people: number[]): string | null {
  const t = body.trim();
  if (!t) return 'Write a comment first.';
  if (t.length > COMMENT_MAX) return `A comment is at most ${COMMENT_MAX} characters.`;
  if (audience === 'SPECIFIC' && people.length === 0) return 'Choose who sees this comment.';
  return null;
}
export async function postComment(meeting: number, item: number, body: string, audience: Audience, people: number[] = []) {
  const p = commentProblem(body, audience, people);
  if (p) throw new Error(p);
  return apiPost<{ comment: Comment }>(`${B}/meetings/${meeting}/comments`, { agenda_item_id: item, body: body.trim(), audience, shared_with: audience === 'SPECIFIC' ? people : undefined });
}
export const deleteComment = (id: number) => apiDelete(`${B}/comments/${id}`);

export interface AnnotationInput { id?: number; board_meeting_id: number; paper_version_id: number; page: number; kind: AnnotationKind; body?: string | null; anchor?: { text: string } | null; visibility: Visibility; shared_with?: number[]; client_uuid?: string; updated_at?: string }
/** Creates or (by `id` / `client_uuid`) updates an annotation; the server keeps the newer of two edits. */
export const saveAnnotation = (a: AnnotationInput) => apiPost<{ annotation: Annotation; conflict?: 'server_newer' }>(`${B}/annotations`, a);
/** The current version of the paper a version belongs to (the server has no lookup by version id): through the agenda's papers. */
export async function currentVersionFor(meeting: number, paperVersionId: number): Promise<PaperVersion | null> {
  for (const it of await fetchAgenda(meeting)) {
    for (const p of it.papers ?? []) {
      const full = await fetchPaper(p.id);
      if (full.current_version?.id === paperVersionId || full.versions?.some((v) => v.id === paperVersionId)) return full.current_version ?? null;
    }
  }
  return null;
}
/** A detached note saved again against the paper's current version. */
export const reattach = (a: Annotation, paperVersionId: number) =>
  saveAnnotation({ id: a.id, board_meeting_id: a.board_meeting_id ?? 0, paper_version_id: paperVersionId, page: a.page ?? 1, kind: a.kind, body: a.body ?? null, anchor: a.anchor?.text ? { text: a.anchor.text } : null, visibility: a.visibility, shared_with: a.shared_with });
export const acknowledgePack = (versionId: number) => apiPost(`${B}/packs/versions/${versionId}/acknowledge`, {});

export const respondCircular = (id: number, response: 'APPROVE' | 'REJECT' | 'ABSTAIN', comment?: string, signing?: SigningBody) =>
  apiPost<Circular & { signature_id?: number | null }>(`${B}/circulars/${id}/respond`, { response, comment: comment?.trim() || undefined, ...(signing ?? {}) });

/** The signing body (FR-SIG): the kind of signature, a drawn image, and the step-up proof when the server asks (428). */
export interface SigningBody { type?: 'ACKNOWLEDGEMENT' | 'DRAWN' | 'UPLOADED' | 'CERTIFICATE'; image_data?: string; statement?: string; current_password?: string; totp_code?: string }
/** The server asks for a fresh proof of who is signing: `428 {errors: {step_up: true, methods: [...]}}`. */
export const needsStepUp = (e: unknown): boolean => e instanceof ApiError && e.status === 428;
/** Every approval is decided through the inbox's own route, which hands it to the record's action. */
export const decide = (a: Approval, decision: 'approve' | 'changes' | 'reject', extra: SigningBody & { comment?: string } = {}) => apiPost(`${B}/approvals/${a.id}/decide`, { decision, ...extra });

/** An action owner moves it along (D-09); the secretary verifies completed ones. */
export const updateAction = (id: number, status: Exclude<ActionStatus, 'VERIFIED'>) => apiPatch<Action>(`${B}/actions/${id}`, { status });

export const createVote = (meeting: number, resolution: number) => apiPost<Vote>(`${B}/votes`, { board_meeting_id: meeting, resolution_id: resolution });
export const openVote = (vote: number) => apiPost<Vote>(`${B}/votes/${vote}/open`);
/** Closing a tie with the chair's casting vote answers 409 `casting_vote_required`; the chair closes again with `casting_choice`. */
export const closeVote = (vote: number, castingChoice?: string) => apiPost<Vote & { result?: VoteResult }>(`${B}/votes/${vote}/close`, castingChoice ? { casting_choice: castingChoice } : {});
export const castVote = (vote: number, choice: string, proof: { current_password?: string } = {}) => apiPost<Vote>(`${B}/votes/${vote}/cast`, { choice, ...proof });

export const launchPoll = (meeting: number, p: { question: string; options: string[]; anonymous: boolean; agenda_item_id?: number | null }) => apiPost<Poll>(`${B}/meetings/${meeting}/polls`, p);
export const closePoll = (poll: number) => apiPost<Poll>(`${B}/polls/${poll}/close`);
export const insertPoll = (poll: number) => apiPost<{ version: MinuteVersion }>(`${B}/polls/${poll}/insert-minutes`);
export const respondPoll = (poll: number, choice: string) => apiPost(`${B}/polls/${poll}/respond`, { choice });

export const startMinutes = (meeting: number) => apiPost<Minutes>(`${B}/meetings/${meeting}/minutes`);
export const autosaveMinutes = (id: number, blocks: MinutesBlock[], rev: number) => apiPut<{ autosave_id: number; saved_at: string; client_rev: number | null }>(`${B}/minutes/${id}/autosave`, { blocks, client_rev: rev });
export const saveMinutesVersion = (id: number, blocks: MinutesBlock[], note?: string) => apiPost<{ version: MinuteVersion }>(`${B}/minutes/${id}`, { blocks, note });
export const compareMinutes = (id: number, a: number, b: number) =>
  apiGet<{ a: MinuteVersion; b: MinuteVersion; diff: { lines: Array<{ op: 'same' | 'added' | 'removed'; text: string }>; added: number; removed: number } }>(`${B}/minutes/${id}/versions/compare`, { a, b });

export const checkIntegrity = () => apiPost<{ ok: boolean; checked_at?: string; failures?: Array<{ type: string; id: number }> }>(`${B}/integrity/check`, {});

// ── pure helpers ──────────────────────────────────────────────────────────

/** A vote may open only with quorum (FR-QRM, D-12), and only once. */
export function voteBlock(q: Quorum | null | undefined, v: Vote | null | undefined): string | null {
  if (v?.status === 'OPEN') return 'Voting is open.';
  if (v?.status === 'CLOSING') return 'The chair has a casting vote to give.';
  if (v?.status === 'RESULT_FINAL') return 'This vote is closed.';
  if (!q) return 'Quorum is not known yet.';
  if (!q.established) return 'Cannot open vote — no quorum';
  return null;
}

/** The tally a person may see (§9.3): a secret ballot (or an open one before the result, to members) shows only how many were cast. */
export function tallyView(v: Vote): { counts: { for: number; against: number; abstain: number } | null; cast: number; eligible: number } {
  const r = v.result;
  const c = v.counts;
  const counts = v.secret ? null : r ? { for: r.for ?? 0, against: r.against ?? 0, abstain: r.abstain ?? 0 } : c ? { for: c.FOR ?? c.APPROVE ?? 0, against: c.AGAINST ?? c.REJECT ?? 0, abstain: c.ABSTAIN ?? 0 } : null;
  return { counts, cast: v.ballots_cast ?? r?.cast ?? 0, eligible: v.eligible_count ?? r?.eligible ?? 0 };
}

/** The ballot choices of a vote's method (FOR/AGAINST/ABSTAIN or APPROVE/REJECT/ABSTAIN; options for multiple choice). */
export function choicesOf(v: Vote): string[] {
  if (v.method === 'APPROVE_REJECT_ABSTAIN') return ['APPROVE', 'REJECT', 'ABSTAIN'];
  if (v.method === 'MULTIPLE_CHOICE' && v.options?.length) return v.options;
  return ['FOR', 'AGAINST', 'ABSTAIN'];
}

/** The resolution on the floor: the one on the presented item, else the one being voted on or discussed. */
export function liveResolution(list: Resolution[], presentedItem: number | null | undefined): Resolution | null {
  const open = list.filter((r) => !['RECORDED', 'WITHDRAWN', 'DEFERRED'].includes(r.status));
  return open.find((r) => presentedItem && r.agenda_item_id === presentedItem) ?? open.find((r) => r.status === 'VOTING') ?? open.find((r) => ['SECONDED', 'UNDER_DISCUSSION', 'PROPOSED'].includes(r.status)) ?? null;
}

/** D-09 groups: overdue, this week, later, done awaiting verification. */
export function groupActions(list: Action[], now = new Date()): Record<'overdue' | 'week' | 'later' | 'verify', Action[]> {
  const out = { overdue: [] as Action[], week: [] as Action[], later: [] as Action[], verify: [] as Action[] };
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  for (const a of list) {
    if (a.status === 'VERIFIED') continue;
    if (a.status === 'COMPLETED') { out.verify.push(a); continue; }
    const due = a.due_on ? new Date(`${a.due_on.slice(0, 10)}T00:00:00`).getTime() : null;
    if (a.overdue || (due !== null && due < today)) out.overdue.push(a);
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
export const titleCase = (s: string | null | undefined) => (s ? s.toLowerCase().replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()) : '');

/** Live-meeting limits by role (FR-DX-15): invitees and observers cannot comment during the meeting (403 `live_limit`); presenters see only their item. */
export function liveLimits(role: string | undefined, live: boolean): { comment: boolean; download: boolean; allItems: boolean } {
  const r = (role ?? '').toLowerCase();
  if (!live) return { comment: true, download: true, allItems: r !== 'presenter' };
  const limited = r === 'invitee' || r === 'observer' || r === 'presenter';
  return { comment: !limited, download: !limited, allItems: r !== 'presenter' };
}

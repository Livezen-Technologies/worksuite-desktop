import { ApiError, request, type Query } from '../../core/api';
import { call } from '../../core/bridge';
import {
  SUPPORT_API as BASE,
  SUPPORT_LEGACY_API as LEGACY,
  fromLegacyList,
  fromLegacyMessage,
  fromLegacyShow,
  legacyListQuery,
  legacyMeta,
  legacyViews,
  quickRoute,
  type Agent,
  type Attachment,
  type AssignInput,
  type Badges,
  type Canned,
  type ListParams,
  type Message,
  type MessageAnswer,
  type MessageInput,
  type Meta,
  type Present,
  type TicketChanges,
  type TicketEvent,
  type TicketFull,
  type TicketLink,
  type TicketPage,
  type TicketShow,
  type TransitionInput,
  type ViewsAnswer,
} from '@shared/support';

/**
 * The Support module's API client (WS-SUPPORT-SRS-001 §16.2): `/api/support/v1`, typed by the server's
 * docs/SUPPORT_API.md (the shapes are in shared/support.ts).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * AN OLDER SERVER: THE AS-BUILT ROUTES
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * A server from before v1 answers 404 (or 405) for every v1 route. A desktop release must not break against one,
 * so the five things the as-built `/api/tickets` can do — list, show, reply, set the status, assign (and take) —
 * fall back to it, read back into the v1 shapes. What it cannot do degrades instead of failing: views without
 * counts, the desk's vocabulary without organizations, no badge, no canned responses, nobody else present.
 *
 * A 404 alone does not say the route is missing: "Ticket not found" is a 404 too. So a v1 404/405 asks once which
 * API the server has (`GET meta`, which has no id that could be missing) and falls back only when that is missing as
 * well. A server found to be as-built is believed for ten minutes, then asked again: servers get upgraded.
 */

export type ApiFamily = 'v1' | 'legacy';

/** How long "this server has no v1 API" is believed before it is asked again. */
export const LEGACY_RECHECK_MS = 10 * 60_000;

let known: { family: ApiFamily; at: number } | null = null;
let asking: Promise<ApiFamily> | null = null;

/** A 404 or 405: the route, or the record, is not there. */
export function routeMissing(e: unknown): boolean {
  return e instanceof ApiError && (e.status === 404 || e.status === 405);
}

/** What was last learnt about the server, while it still holds. */
function familyNow(): ApiFamily | null {
  if (!known) return null;
  if (known.family === 'legacy' && Date.now() - known.at >= LEGACY_RECHECK_MS) return null;
  return known.family;
}

/** For tests, and a server switch: ask again. */
export function resetApiFamily(): void {
  known = null;
  asking = null;
}

/**
 * Which API this server answers. `GET meta` succeeding — or refusing in any way but "no such route" — is v1. Out
 * of reach, nothing is learnt: the next failure asks again.
 */
export function apiFamily(): Promise<ApiFamily> {
  const now = familyNow();
  if (now) return Promise.resolve(now);
  asking ??= request('GET', `${BASE}/meta`)
    .then(
      () => (known = { family: 'v1', at: Date.now() }).family,
      (e: unknown) => {
        if (routeMissing(e)) return (known = { family: 'legacy', at: Date.now() }).family;
        if (e instanceof ApiError && e.status >= 400 && e.status < 600 && !e.offline) return (known = { family: 'v1', at: Date.now() }).family;
        return 'v1' as const;
      },
    )
    .finally(() => {
      asking = null;
    });
  return asking;
}

/** The v1 call; on a server without v1, the as-built one. */
async function v1OrLegacy<T>(v1: () => Promise<T>, legacy: () => Promise<T>): Promise<T> {
  if (familyNow() === 'legacy') return legacy();
  try {
    return await v1();
  } catch (e) {
    if (!routeMissing(e) || (await apiFamily()) !== 'legacy') throw e;
    return legacy();
  }
}

/** The v1 call; on a server without v1, what the screen shows instead. */
function v1OrElse<T>(v1: () => Promise<T>, otherwise: () => T): Promise<T> {
  return v1OrLegacy(v1, async () => otherwise());
}

/** Said when a v1-only call reaches a server without it. */
export const NEEDS_NEWER_SERVER = 'Your WorkSuite server cannot do this yet. Ask your administrator to update it.';

/** A call only v1 can answer: on an as-built server, a refusal that says why. */
function v1Only<T>(v1: () => Promise<T>): Promise<T> {
  return v1OrLegacy(v1, async () => {
    throw new ApiError(501, NEEDS_NEWER_SERVER, 'NOT_SUPPORTED');
  });
}

/* ── requests ───────────────────────────────────────────────────────────── */

async function get<T>(path: string, query?: Query, signal?: AbortSignal): Promise<T> {
  return (await request<T>('GET', path, { query, signal })).data;
}

async function getMeta<T>(path: string, query?: Query, signal?: AbortSignal): Promise<{ data: T; offline: boolean }> {
  const r = await request<T>('GET', path, { query, signal });
  return { data: r.data, offline: r.offline };
}

async function send<T>(method: 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown, headers?: Record<string, string>): Promise<T> {
  return (await request<T>(method, path, { body, headers })).data;
}

const list = (v: string[] | undefined): string | undefined => (v && v.length ? v.join(',') : undefined);

/** A message's retry key (`client_id`, `[A-Za-z0-9._:-]{1,64}`): sent twice, it is one message (the server answers `duplicate`). */
export function newClientId(prefix = 'desk'): string {
  const rand = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}:${rand}`;
}

/* ── tickets ────────────────────────────────────────────────────────────── */

/** One page of a view (FR-WSP-02/05): `next_cursor` asks for the next. `offline`: the copy kept on this computer. */
export function listTickets(p: ListParams, signal?: AbortSignal): Promise<TicketPage & { offline?: boolean }> {
  return v1OrLegacy(
    async () => {
      const r = await getMeta<TicketPage>(
        `${BASE}/tickets`,
        { ...(p.extra ?? {}), view: p.view, sort: p.sort, q: p.q?.trim() || undefined, status: list(p.status), priority: list(p.priority), organization: list(p.organization) ?? p.extra?.organization, assignee: p.assignee, limit: p.limit, cursor: p.cursor ?? undefined },
        signal,
      );
      return { ...r.data, offline: r.offline };
    },
    async () => {
      const { query, keep } = legacyListQuery(p);
      return fromLegacyList(await get<Record<string, unknown>>(LEGACY, query, signal), p, keep);
    },
  );
}

/**
 * A ticket with its thread, journal and files. Reading it marks it read at the server unless `peek` — the inbox
 * and notifications peek, and say what was read themselves (`markRead`).
 */
export function getTicket(id: number, opts: { peek?: boolean } = {}, signal?: AbortSignal): Promise<TicketShow & { offline?: boolean }> {
  return v1OrLegacy(
    async () => {
      const r = await getMeta<TicketShow>(`${BASE}/tickets/${id}`, opts.peek ? { peek: 1 } : undefined, signal);
      return { ...r.data, offline: r.offline };
    },
    async () => fromLegacyShow(await get<Record<string, unknown>>(`${LEGACY}/${id}`, undefined, signal)),
  );
}

/**
 * The ticket a reference names ("CFX-001284": a deep link or a pasted reference), looked up among every ticket the
 * person may see. Null when none has it exactly.
 */
export async function ticketIdForReference(reference: string, signal?: AbortSignal): Promise<number | null> {
  const page = await listTickets({ view: 'all', q: reference, limit: 10 }, signal);
  return page.items.find((t) => t.reference.toLowerCase() === reference.toLowerCase())?.id ?? null;
}

/** Messages newer than one, oldest first (the delta after a realtime hint). */
export function messagesAfter(id: number, afterId: number): Promise<{ messages: Message[]; has_more: boolean; version: number }> {
  return v1Only(() => get(`${BASE}/tickets/${id}/messages`, { after_id: afterId }));
}

/** The hundred messages before one: paging back through a thread longer than the 500 a ticket opens with. */
export function messagesBefore(id: number, beforeId: number): Promise<{ messages: Message[]; has_more: boolean }> {
  return v1Only(() => get(`${BASE}/tickets/${id}/messages`, { before_id: beforeId }));
}

/** The journal, a hundred at a time, newest first. */
export function ticketEvents(id: number, beforeId?: number): Promise<{ events: TicketEvent[]; has_more: boolean }> {
  return v1Only(() => get(`${BASE}/tickets/${id}/events`, beforeId ? { before_id: beforeId } : undefined));
}

/** Change fields with the version they were read at (FR-TKT-10): a stale one is `VERSION_CONFLICT` with the ticket as it stands. */
export async function updateTicket(id: number, version: number, changes: TicketChanges): Promise<TicketFull> {
  return (await v1Only(() => send<{ ticket: TicketFull }>('PATCH', `${BASE}/tickets/${id}`, { ...changes, version }))).ticket;
}

/** Move the status through the state machine. Null from the as-built API, which answers nothing: read the ticket again. */
export function transition(id: number, input: TransitionInput): Promise<TicketFull | null> {
  return v1OrLegacy(
    async () => (await send<{ ticket: TicketFull }>('POST', `${BASE}/tickets/${id}/transition`, input)).ticket,
    async () => {
      await send('POST', `${LEGACY}/${id}/action`, { action: 'status', ...input });
      return null;
    },
  );
}

/** Give it to somebody (or nobody). Giving an unassigned ticket to yourself is taking it. */
export function assign(id: number, input: AssignInput): Promise<TicketFull | null> {
  return v1OrLegacy(
    async () => (await send<{ ticket: TicketFull }>('POST', `${BASE}/tickets/${id}/assign`, input)).ticket,
    async () => {
      await send('POST', `${LEGACY}/${id}/action`, { action: 'assign', user_id: input.user_id, version: input.version, reason: input.reason });
      return null;
    },
  );
}

/** Take an unassigned ticket (FR-ASN-03). */
export function take(id: number, version?: number): Promise<TicketFull | null> {
  return v1OrLegacy(
    async () => (await send<{ ticket: TicketFull }>('POST', `${BASE}/tickets/${id}/take`, version ? { version } : {})).ticket,
    async () => {
      await send('POST', `${LEGACY}/${id}/action`, { action: 'take', version });
      return null;
    },
  );
}

/**
 * A reply or an internal note. `client_id` makes a retry the same message. On the as-built API: the message, then
 * the status as a second call (whose refusal is reported beside the message, as v1 does); mentions, CC and files
 * are not something it can take, and files are refused rather than dropped.
 */
export function addMessage(id: number, input: MessageInput): Promise<MessageAnswer> {
  return v1OrLegacy(
    () => send<MessageAnswer>('POST', `${BASE}/tickets/${id}/messages`, input),
    async () => {
      if (input.attachments?.length) throw new ApiError(501, NEEDS_NEWER_SERVER, 'NOT_SUPPORTED');
      const r = await send<{ id: number; duplicate?: boolean }>('POST', `${LEGACY}/${id}/reply`, { body: input.body, internal: input.internal, client_id: input.client_id });
      let refused: MessageAnswer['status_refused'] = null;
      if (input.status && !r.duplicate) {
        try {
          await send('POST', `${LEGACY}/${id}/action`, { action: 'status', status: input.status, reason: 'Set on send' });
        } catch (e) {
          refused = { code: e instanceof ApiError ? (e.code ?? 'REFUSED') : 'REFUSED', message: e instanceof Error ? e.message : 'The status could not be changed.' };
        }
      }
      const message = fromLegacyMessage({ id: r.id, body: input.body, is_internal: input.internal, from: 'staff', author_id: null });
      return { message: { ...message, client_id: input.client_id ?? null, created_at: new Date().toISOString() }, duplicate: !!r.duplicate, ticket: null, status_refused: refused };
    },
  );
}

/** Move my read marker forward (never back) — to this message, or the newest. */
export function markRead(id: number, messageId?: number): Promise<unknown> {
  return v1Only(() => send('POST', `${BASE}/tickets/${id}/read`, messageId ? { message_id: messageId } : {}));
}

/* ── attachments ────────────────────────────────────────────────────────── */

/** At most this many files a message, each at most 25 MB (Chat's rules), scanned before they are kept. */
export const MAX_FILES = 10;
export const MAX_FILE_BYTES = 25 * 1024 * 1024;

/** One file for the composer: scanned and kept, waiting for the message that carries it. */
export async function uploadAttachment(ticketId: number, file: Blob, name: string): Promise<Attachment> {
  const form = new FormData();
  form.append('file', file, name);
  return (await v1Only(() => send<{ attachment: Attachment }>('POST', `${BASE}/tickets/${ticketId}/attachments`, form))).attachment;
}

/** Take back an upload that was not sent (the composer's ×). */
export function removeAttachment(id: number): Promise<unknown> {
  return v1Only(() => send('DELETE', `${BASE}/attachments/${id}`));
}

/** A short-lived address of a file's bytes (`/media/…`, ten minutes). */
export function attachmentLink(id: number): Promise<{ attachment: Attachment; url: string | null }> {
  return v1Only(() => get(`${BASE}/attachments/${id}`));
}

/* ── the desk ───────────────────────────────────────────────────────────── */

/** The rail: system views with their counts, saved views, and the badges. */
export function views(organization?: string[]): Promise<ViewsAnswer> {
  return v1OrElse(() => get<ViewsAnswer>(`${BASE}/views`, { organization: list(organization) }), legacyViews);
}

/** What the rail, dock and tray count; null for a server without them. */
export function badges(organization?: string[]): Promise<Badges | null> {
  return v1OrElse(async () => (await get<{ badges: Badges }>(`${BASE}/badges`, { organization: list(organization) })).badges, () => null);
}

/** Statuses and their moves, priorities, types, my organizations with my caps in each, their teams, categories, tags. */
export function meta(signal?: AbortSignal): Promise<Meta> {
  return v1OrElse(() => get<Meta>(`${BASE}/meta`, undefined, signal), legacyMeta);
}

/** Who a ticket can be given to, with their presence and load (never another organization's people). */
export function agents(q: { organization?: number | null; ticket_id?: number; team?: number } = {}): Promise<Agent[]> {
  return v1OrLegacy(
    async () => (await get<{ agents: Agent[] }>(`${BASE}/agents`, { organization: q.organization ?? undefined, ticket_id: q.ticket_id, team: q.team })).agents ?? [],
    async () => ((await get<{ agents?: Array<{ id: number; name: string }> }>(`${LEGACY}/agents`)).agents ?? []).map((a) => ({ id: a.id, name: a.name, presence: 'offline', open: 0, capacity: null, teams: [] })),
  );
}

/** My canned responses and my organizations' shared ones, most used first (what "/" offers). */
export function canned(q?: string): Promise<Canned[]> {
  return v1OrElse(async () => (await get<{ canned: Canned[] }>(`${BASE}/canned`, { q: q?.trim() || undefined })).canned ?? [], () => []);
}

/** A canned response with its placeholders filled for a ticket ({{requester.first_name}}…). */
export async function renderCanned(id: number, ticketId: number): Promise<string> {
  return (await v1Only(() => send<{ body: string }>('POST', `${BASE}/canned/${id}/render`, { ticket_id: ticketId }))).body;
}

/* ── links and watchers ─────────────────────────────────────────────────── */

/** What the ticket is linked to, as I may see it (FR-TKT-05). Nothing from an as-built server, which has no links. */
export function links(ticketId: number, signal?: AbortSignal): Promise<TicketLink[]> {
  return v1OrElse(async () => (await get<{ links: TicketLink[] }>(`${BASE}/tickets/${ticketId}/links`, undefined, signal)).links ?? [], () => []);
}

/** Follow a ticket: told whenever it changes (FR-ASN-07). Watchers do not change the version. */
export function watch(ticketId: number): Promise<unknown> {
  return v1Only(() => send('POST', `${BASE}/tickets/${ticketId}/watchers`, {}));
}

/** Stop following it: myself always (anybody else needs assign). */
export function unwatch(ticketId: number, userId: number): Promise<unknown> {
  return v1Only(() => send('DELETE', `${BASE}/tickets/${ticketId}/watchers/${userId}`));
}

/* ── presence (FR-COM-11) ───────────────────────────────────────────────── */

/** Who else is on a ticket now. Nobody, for a server without presence — and for an answer from the saved copy. */
export function presence(ticketId: number): Promise<Present[]> {
  return v1OrElse(async () => {
    const r = await getMeta<{ present: Present[] }>(`${BASE}/tickets/${ticketId}/presence`);
    return r.offline ? [] : (r.data.present ?? []);
  }, () => []);
}

/** I am on this ticket (viewing, typing a reply or a note), or I have left it. Answers who else is. */
export function here(ticketId: number, state: 'viewing' | 'typing' | 'left', mode?: 'reply' | 'note'): Promise<Present[]> {
  return v1OrElse(async () => (await send<{ present: Present[] }>('POST', `${BASE}/tickets/${ticketId}/presence`, mode ? { state, mode } : { state })).present ?? [], () => []);
}

/* ── windows ───────────────────────────────────────────────────────────── */

/** A ticket's quick-reply window (D-04): floating, always on top, one at a time; its draft is the ticket's. */
export function openQuickReply(ticketId: number): void {
  void call('windows:open', { kind: 'support-quick', route: quickRoute(ticketId), title: 'Quick reply', alwaysOnTop: true }).catch(() => undefined);
}

/* ── refusals ───────────────────────────────────────────────────────────── */

export function errorText(e: unknown, fallback = 'That could not be done. Try again.'): string {
  return e instanceof Error && e.message.trim() ? e.message : fallback;
}

/** The refusal's code (`VERSION_CONFLICT`, `TRANSITION_REFUSED`, `MERGED`…), or null. */
export function refusalCode(e: unknown): string | null {
  return e instanceof ApiError ? e.code : null;
}

/** A 409 version conflict: the ticket as it now stands, for the conflict review (FR-TKT-10). */
export function conflictTicket(e: unknown): TicketFull | null {
  if (!(e instanceof ApiError) || e.code !== 'VERSION_CONFLICT') return null;
  const t = (e.data as { ticket?: unknown } | null)?.ticket;
  return t && typeof t === 'object' ? (t as TicketFull) : null;
}

/** A write to a ticket merged into another: where it went (`MERGED`, `errors.merged_into`). */
export function mergedInto(e: unknown): { id: number; reference: string } | null {
  if (!(e instanceof ApiError) || e.code !== 'MERGED') return null;
  const m = (e.data as { merged_into?: unknown } | null)?.merged_into as { id?: unknown; reference?: unknown } | undefined;
  return m && typeof m.id === 'number' ? { id: m.id, reference: String(m.reference ?? '') } : null;
}

/* ── query keys ─────────────────────────────────────────────────────────── */

export const K = {
  all: ['support'] as const,
  meta: ['support', 'meta'] as const,
  views: (orgs: string) => ['support', 'views', orgs] as const,
  badges: ['support', 'badges'] as const,
  lists: ['support', 'list'] as const,
  list: (p: object) => ['support', 'list', p] as const,
  tickets: ['support', 'ticket'] as const,
  ticket: (id: number) => ['support', 'ticket', id] as const,
  ref: (key: string) => ['support', 'ref', key] as const,
  agents: (key: string) => ['support', 'agents', key] as const,
  canned: (q: string) => ['support', 'canned', q] as const,
  presence: (id: number) => ['support', 'presence', id] as const,
  links: (id: number) => ['support', 'links', id] as const,
  requester: (email: string) => ['support', 'requester', email.toLowerCase()] as const,
  myPresence: ['chat', 'presence', 'me'] as const,
};

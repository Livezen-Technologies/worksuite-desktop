import { ApiError, request, type Query } from '../../core/api';
import { call } from '../../core/bridge';
import { text } from '../../core/i18n';
import { toast } from '../../core/toasts';
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
  type AiClassification,
  type AiReplyDraft,
  type AiSummary,
  type AiTone,
  type Attachment,
  type AssignInput,
  type BulkAction,
  type BulkResult,
  type ClientChanges,
  type RelatedOrder,
  type TicketClient,
  type Badges,
  type Canned,
  type ConversionPreview,
  type ConvertAnswer,
  type ConvertInput,
  type KbInsert,
  type KbSuggestion,
  type ListParams,
  type HeldReply,
  type Message,
  type MessageAnswer,
  type MessageInput,
  type Meta,
  type NewTicketInput,
  type Present,
  type RewriteMode,
  type ServerDraft,
  type TicketChanges,
  type TicketEvent,
  type TicketFull,
  type TicketLink,
  type TicketPage,
  type TicketShow,
  type TrackingTimeline,
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

async function send<T>(method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown, headers?: Record<string, string>): Promise<T> {
  return (await request<T>(method, path, { body, headers })).data;
}

const list = (v: string[] | undefined): string | undefined => (v && v.length ? v.join(',') : undefined);

/** A message's retry key (`client_id`, `[A-Za-z0-9._:-]{1,64}`): sent twice, it is one message (the server answers `duplicate`). */
export function newClientId(prefix = 'desk'): string {
  const rand = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}:${rand}`;
}

/* ── the outbox (D-09, FR-DSK-07) ───────────────────────────────────────── */

/** Tickets' references as last read, to name a queued change ("Reply to requester · CFX-001284"). */
const references = new Map<number, string>();

/** What a queued support change is labelled: its kind, then the ticket. The outbox reads both back (queued.ts). */
export function outboxLabel(what: string, id: number): string {
  return `${what} · ${references.get(id) ?? `#${id}`}`;
}

/**
 * A write that cannot reach WorkSuite goes to the offline queue (FR-DSK-07): kept encrypted on this computer, sent in
 * order when the connection is back, with its retry key — a message's `client_id`, so a replay is stored once — and
 * the version it was made at, so a ticket changed meanwhile is refused (409) and waits in the outbox's conflict review
 * instead of overwriting. `queued` is what the screen is answered meanwhile.
 */
async function orQueue<T>(id: number, what: string, method: 'POST' | 'PATCH', path: string, body: unknown, now: () => Promise<T>, queued: () => T): Promise<T> {
  try {
    return await now();
  } catch (e) {
    if (!(e instanceof ApiError) || !e.offline) throw e;
    const r = await call('offline:submit', {
      module: 'support',
      entity: 'ticket',
      entityId: String(id),
      label: outboxLabel(what, id).slice(0, 200),
      method,
      path,
      body,
      queueIfOffline: true,
    });
    if (r.queued) toast('info', text('You are offline: {what} is in the outbox and goes when WorkSuite is back.', { what: outboxLabel(what, id) }));
    if (r.queued || r.delivered) return queued();
    throw new ApiError(r.status ?? 0, r.error ?? 'The change could not be kept to send later.', r.code);
  }
}

/* ── tickets ────────────────────────────────────────────────────────────── */

/** One page of a view (FR-WSP-02/05): `next_cursor` asks for the next. `offline`: the copy kept on this computer. */
export function listTickets(p: ListParams, signal?: AbortSignal): Promise<TicketPage & { offline?: boolean }> {
  return v1OrLegacy(
    async () => {
      const r = await getMeta<TicketPage>(
        `${BASE}/tickets`,
        {
          ...(p.extra ?? {}),
          view: p.view,
          sort: p.sort,
          q: p.q?.trim() || undefined,
          status: list(p.status),
          priority: list(p.priority),
          source: list(p.source) ?? p.extra?.source,
          organization: list(p.organization) ?? p.extra?.organization,
          assignee: p.assignee,
          limit: p.limit,
          cursor: p.cursor ?? undefined,
        },
        signal,
      );
      for (const t of r.data.items ?? []) references.set(t.id, t.reference);
      return { ...r.data, offline: r.offline };
    },
    async () => {
      const { query, keep } = legacyListQuery(p);
      return fromLegacyList(await get<Record<string, unknown>>(LEGACY, query, signal), p, keep);
    },
  );
}

/**
 * Raise a ticket by hand (FR-CRT-01/02, #298): the New ticket form's. `key` (Idempotency-Key) is kept by the form
 * until it is done, so Create pressed again after a failure is one ticket. The answer is the ticket in full
 * (`{ticket}`; a bare ticket is read too). A server without v1 refuses with `NEEDS_NEWER_SERVER`.
 *
 * Not queued offline, unlike a reply: the ticket is wanted at once (its reference, its place in the reading pane),
 * its files are scanned on the way up first, and its retry key travels as a header the outbox does not keep. Offline
 * the form says so and keeps what was typed.
 */
export async function createTicket(input: NewTicketInput, key: string): Promise<TicketFull> {
  const a = await v1Only(() => send<{ ticket?: TicketFull } & Partial<TicketFull>>('POST', `${BASE}/tickets`, input, { 'Idempotency-Key': key }));
  const t = (a?.ticket ?? a) as TicketFull;
  if (!t || typeof t.id !== 'number') throw new ApiError(500, text('The server did not say which ticket it raised.'), 'BAD_ANSWER');
  references.set(t.id, t.reference);
  return t;
}

/** Somebody to raise a ticket for (#298): one of my contacts, a customer or a colleague, as Contacts' lookup finds them. */
export interface RequesterHit {
  kind: 'contact' | 'customer' | 'employee' | string;
  id: number;
  name: string | null;
  email: string | null;
  phone: string | null;
  subtitle: string | null;
}

/** The New ticket form's requester search: `GET /api/contacts/lookup`, the one place the product looks somebody up. */
export async function findRequesters(q: string, signal?: AbortSignal): Promise<RequesterHit[]> {
  const term = q.trim();
  if (term.length < 2) return [];
  const r = await get<{
    results?: Array<Partial<RequesterHit> & { id: number | string }>;
  }>('/api/contacts/lookup', { q: term, kinds: 'contact,customer,employee', limit: 8 }, signal);
  return (r?.results ?? [])
    .map((x) => ({
      kind: String(x.kind ?? 'contact'),
      id: Number(x.id),
      name: x.name ?? null,
      email: x.email ?? null,
      phone: x.phone ?? null,
      subtitle: x.subtitle ?? null,
    }))
    .filter((x) => Number.isSafeInteger(x.id) && x.id > 0);
}

/**
 * A ticket with its thread, journal and files. Reading it marks it read at the server unless `peek` — the inbox
 * and notifications peek, and say what was read themselves (`markRead`).
 */
export function getTicket(id: number, opts: { peek?: boolean } = {}, signal?: AbortSignal): Promise<TicketShow & { offline?: boolean }> {
  return v1OrLegacy(
    async () => {
      const r = await getMeta<TicketShow>(`${BASE}/tickets/${id}`, opts.peek ? { peek: 1 } : undefined, signal);
      if (r.data?.ticket) references.set(id, r.data.ticket.reference);
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

/**
 * One bulk change (`POST tickets/bulk`, #333): each ticket checked and changed as if alone, refusals per ticket. At most
 * 200 a call — `bulkInBatches` (bulk.ts) sends more in batches. `of` is the whole change's size, so the journal says
 * "bulk, 128 tickets" on every batch.
 */
export async function bulk(action: BulkAction, ids: number[], fields: Record<string, unknown> = {}, of?: number): Promise<{ results: BulkResult[]; done: number; refused: number }> {
  return v1Only(() => send('POST', `${BASE}/tickets/bulk`, { ...fields, action, ids, ...(of && of > ids.length ? { of } : {}) }));
}

/** Every ticket a list matches, up to `limit`, with how many there are (#333's "Select all 128 resolved tickets"). */
export async function matchingIds(p: ListParams, limit = 1000, signal?: AbortSignal): Promise<{ ids: number[]; total: number }> {
  const r = await v1Only(() =>
    get<{ ids: number[]; total: number }>(
      `${BASE}/tickets/ids`,
      {
        ...(p.extra ?? {}),
        view: p.view,
        q: p.q?.trim() || undefined,
        status: list(p.status),
        priority: list(p.priority),
        source: list(p.source) ?? p.extra?.source,
        organization: list(p.organization) ?? p.extra?.organization,
        limit,
      },
      signal,
    ),
  );
  return { ids: r.ids ?? [], total: r.total ?? 0 };
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

/**
 * Change fields with the version they were read at (FR-TKT-10): a stale one is `VERSION_CONFLICT` with the ticket as it
 * stands. Offline, the change is queued with that version (null: read the ticket again later); a stale one comes back
 * to the outbox's conflict review (D-09).
 */
export async function updateTicket(id: number, version: number, changes: TicketChanges): Promise<TicketFull | null> {
  const body = { ...changes, version };
  return orQueue(
    id,
    'Property change',
    'PATCH',
    `${BASE}/tickets/${id}`,
    body,
    async () => (await v1Only(() => send<{ ticket: TicketFull }>('PATCH', `${BASE}/tickets/${id}`, body))).ticket,
    () => null,
  );
}

/** Move the status through the state machine. Null from the as-built API, which answers nothing: read the ticket again. */
export function transition(id: number, input: TransitionInput): Promise<TicketFull | null> {
  return orQueue(
    id,
    'Status change',
    'POST',
    `${BASE}/tickets/${id}/transition`,
    input,
    () => transitionNow(id, input),
    () => null,
  );
}

function transitionNow(id: number, input: TransitionInput): Promise<TicketFull | null> {
  return v1OrLegacy(
    async () => (await send<{ ticket: TicketFull }>('POST', `${BASE}/tickets/${id}/transition`, input)).ticket,
    async () => {
      await send('POST', `${LEGACY}/${id}/action`, {
        action: 'status',
        ...input,
      });
      return null;
    },
  );
}

/** Give it to somebody (or nobody). Giving an unassigned ticket to yourself is taking it. */
export function assign(id: number, input: AssignInput): Promise<TicketFull | null> {
  return orQueue(
    id,
    'Assignment',
    'POST',
    `${BASE}/tickets/${id}/assign`,
    input,
    () => assignNow(id, input),
    () => null,
  );
}

function assignNow(id: number, input: AssignInput): Promise<TicketFull | null> {
  return v1OrLegacy(
    async () => (await send<{ ticket: TicketFull }>('POST', `${BASE}/tickets/${id}/assign`, input)).ticket,
    async () => {
      await send('POST', `${LEGACY}/${id}/action`, {
        action: 'assign',
        user_id: input.user_id,
        version: input.version,
        reason: input.reason,
      });
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
export function addMessage(id: number, input: MessageInput): Promise<MessageAnswer & { queued?: boolean }> {
  return orQueue<MessageAnswer & { queued?: boolean }>(
    id,
    input.internal ? 'Internal note' : 'Reply to requester',
    'POST',
    `${BASE}/tickets/${id}/messages`,
    input,
    () => addMessageNow(id, input),
    () => ({
      message: {
        ...fromLegacyMessage({
          id: 0,
          body: input.body,
          is_internal: input.internal,
          from: 'staff',
          author_id: null,
        }),
        client_id: input.client_id ?? null,
        created_at: new Date().toISOString(),
      },
      duplicate: false,
      ticket: null,
      status_refused: null,
      queued: true,
    }),
  );
}

function addMessageNow(id: number, input: MessageInput): Promise<MessageAnswer> {
  return v1OrLegacy(
    () => send<MessageAnswer>('POST', `${BASE}/tickets/${id}/messages`, input),
    async () => {
      if (input.attachments?.length || input.send_at || /<img\b/i.test(input.body_html ?? '')) throw new ApiError(501, NEEDS_NEWER_SERVER, 'NOT_SUPPORTED');
      const r = await send<{ id: number; duplicate?: boolean }>('POST', `${LEGACY}/${id}/reply`, {
        body: input.body,
        internal: input.internal,
        client_id: input.client_id,
      });
      let refused: MessageAnswer['status_refused'] = null;
      if (input.status && !r.duplicate) {
        try {
          await send('POST', `${LEGACY}/${id}/action`, {
            action: 'status',
            status: input.status,
            reason: 'Set on send',
          });
        } catch (e) {
          refused = {
            code: e instanceof ApiError ? (e.code ?? 'REFUSED') : 'REFUSED',
            message: e instanceof Error ? e.message : 'The status could not be changed.',
          };
        }
      }
      const message = fromLegacyMessage({
        id: r.id,
        body: input.body,
        is_internal: input.internal,
        from: 'staff',
        author_id: null,
      });
      return {
        message: {
          ...message,
          client_id: input.client_id ?? null,
          created_at: new Date().toISOString(),
        },
        duplicate: !!r.duplicate,
        ticket: null,
        status_refused: refused,
      };
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

/**
 * One file for the composer: scanned and kept, waiting for the message that carries it. With no ticket (null), one for
 * the New ticket form (`POST attachments`), claimed by the ticket's first message when it is raised.
 */
const supportUploads = new WeakMap<Blob, { id: string; size: number; chunks: number }>();
export async function uploadAttachment(ticketId: number | null, file: Blob, name: string, progress?: (fraction: number) => void): Promise<Attachment> {
  if (ticketId !== null && file.size >= 8 * 1024 * 1024) {
    let session = supportUploads.get(file);
    if (!session) {
      const hash = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
      const sha256 = Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join('');
      const init = await send<{
        upload_id: string;
        chunk_size: number;
        total_chunks: number;
      }>('POST', '/api/uploads/init', {
        purpose: 'support',
        ticket_id: ticketId,
        filename: name,
        total_size: file.size,
        chunk_size: 2 * 1024 * 1024,
        mime_type: file.type,
        sha256,
      });
      session = {
        id: init.upload_id,
        size: init.chunk_size,
        chunks: init.total_chunks,
      };
      supportUploads.set(file, session);
    }
    const status = await get<{ received_chunks?: number[]; status?: string }>(`/api/uploads/${session.id}/status`);
    if (status.status === 'failed' || status.status === 'aborted') {
      supportUploads.delete(file);
      throw new ApiError(422, 'This upload could not be completed. Retry to start a new upload.', 'UPLOAD_FAILED');
    }
    const received = new Set(status.received_chunks ?? []);
    for (let i = 0; status.status !== 'completed' && i < session.chunks; i++) {
      if (!received.has(i)) {
        const form = new FormData();
        form.set('chunk_index', String(i));
        form.set('chunk', file.slice(i * session.size, (i + 1) * session.size), name);
        await send('POST', `/api/uploads/${session.id}/chunk`, form);
      }
      progress?.((i + 1) / session.chunks);
    }
    const answer = await send<{ attachment: Attachment }>('POST', `${BASE}/tickets/${ticketId}/attachments/from-upload`, { upload_id: session.id });
    supportUploads.delete(file);
    return answer.attachment;
  }
  const form = new FormData();
  form.append('file', file, name);
  const path = ticketId === null ? `${BASE}/attachments` : `${BASE}/tickets/${ticketId}/attachments`;
  const result = (await v1Only(() => send<{ attachment: Attachment }>('POST', path, form))).attachment;
  progress?.(1);
  return result;
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
  return v1OrElse(
    async () =>
      (
        await get<{ badges: Badges }>(`${BASE}/badges`, {
          organization: list(organization),
        })
      ).badges,
    () => null,
  );
}

/** Statuses and their moves, priorities, types, my organizations with my caps in each, their teams, categories, tags. */
export function meta(signal?: AbortSignal): Promise<Meta> {
  return v1OrElse(() => get<Meta>(`${BASE}/meta`, undefined, signal), legacyMeta);
}

/** Who a ticket can be given to, with their presence and load (never another organization's people). */
export function agents(q: { organization?: number | null; ticket_id?: number; team?: number } = {}): Promise<Agent[]> {
  return v1OrLegacy(
    async () =>
      (
        await get<{ agents: Agent[] }>(`${BASE}/agents`, {
          organization: q.organization ?? undefined,
          ticket_id: q.ticket_id,
          team: q.team,
        })
      ).agents ?? [],
    async () =>
      ((await get<{ agents?: Array<{ id: number; name: string }> }>(`${LEGACY}/agents`)).agents ?? []).map((a) => ({
        id: a.id,
        name: a.name,
        presence: 'offline',
        open: 0,
        capacity: null,
        teams: [],
      })),
  );
}

/** My canned responses and my organizations' shared ones, most used first (what "/" offers). */
export function canned(q?: string): Promise<Canned[]> {
  return v1OrElse(
    async () =>
      (
        await get<{ canned: Canned[] }>(`${BASE}/canned`, {
          q: q?.trim() || undefined,
        })
      ).canned ?? [],
    () => [],
  );
}

/** A canned response with its placeholders filled for a ticket ({{requester.first_name}}…). */
export async function renderCanned(id: number, ticketId: number): Promise<string> {
  return (
    await v1Only(() =>
      send<{ body: string }>('POST', `${BASE}/canned/${id}/render`, {
        ticket_id: ticketId,
      }),
    )
  ).body;
}

/* ── links and watchers ─────────────────────────────────────────────────── */

/** What the ticket is linked to, as I may see it (FR-TKT-05). Nothing from an as-built server, which has no links. */
export function links(ticketId: number, signal?: AbortSignal): Promise<TicketLink[]> {
  return v1OrElse(
    async () => (await get<{ links: TicketLink[] }>(`${BASE}/tickets/${ticketId}/links`, undefined, signal)).links ?? [],
    () => [],
  );
}

/** Follow a ticket: told whenever it changes (FR-ASN-07). Watchers do not change the version. */
/* ── the ticket details drawer (#334) ────────────────────────────────── */

/** Where the drawer's client and related parts are read (with the local copy first: `useLocalFirstQuery`). */
export const clientPath = (ticketId: number) => `${BASE}/tickets/${ticketId}/client`;
export const relatedPath = (ticketId: number) => `${BASE}/tickets/${ticketId}/related`;

/** An edit in place: `422` names the fields that are wrong (`errors`), and the answer is the client afterwards. */
export async function saveClient(ticketId: number, changes: ClientChanges, version?: number): Promise<{ client: TicketClient; ticket: TicketFull; changed: string[] }> {
  return v1Only(() => send('PATCH', `${BASE}/tickets/${ticketId}/client`, { ...changes, ...(version ? { version } : {}) }));
}

/** Link the client to a contact, or make one from the requester's details. */
export async function linkContact(ticketId: number, to: { contact_id: number } | { create: true }): Promise<{ client: TicketClient; ticket: TicketFull }> {
  return v1Only(() => send('POST', `${BASE}/tickets/${ticketId}/contact`, to));
}

export async function unlinkContact(ticketId: number): Promise<{ client: TicketClient; ticket: TicketFull }> {
  return v1Only(() => send('DELETE', `${BASE}/tickets/${ticketId}/contact`));
}

/* ── the customer channels (#336) ───────────────────────────────────────── */

/** Replies from an "Unverified sender" waiting for review, on the tickets I see and read notes on. */
export async function heldReplies(signal?: AbortSignal): Promise<HeldReply[]> {
  const r = await v1Only(() => get<{ held?: HeldReply[] }>(`${BASE}/held`, undefined, signal));
  return r.held ?? [];
}

/** Release a held reply into the conversation: the requester's side from then on, and its sender with it. */
export function releaseHeld(ticketId: number, messageId: number): Promise<{ message: Message | null }> {
  return v1Only(() => send('POST', `${BASE}/tickets/${ticketId}/messages/${messageId}/release`, {}));
}

/** Discard a held reply: it stays an internal note, out of review. */
export function discardHeld(ticketId: number, messageId: number): Promise<{ message: Message | null }> {
  return v1Only(() => send('POST', `${BASE}/tickets/${ticketId}/messages/${messageId}/discard`, {}));
}

/** "Show original": the whole email a reply was cut from (quoted history and signature included). */
export function messageOriginal(ticketId: number, messageId: number): Promise<{ id: number; original: string; cut: boolean }> {
  return v1Only(() => get(`${BASE}/tickets/${ticketId}/messages/${messageId}/original`));
}

/** A reply's email, step by step (#335): queued, delivered or bounced, each open and click, with the approximate client. */
export function messageTracking(ticketId: number, messageId: number, signal?: AbortSignal): Promise<TrackingTimeline> {
  return v1Only(() => get(`${BASE}/tickets/${ticketId}/messages/${messageId}/tracking`, undefined, signal));
}

/** Retry a reply whose email bounced or did not go (#335) — to a corrected address when one is given ("Edit address"). */
export function resendReply(ticketId: number, messageId: number, email?: string): Promise<{ message: Message }> {
  return v1Only(() => send('POST', `${BASE}/tickets/${ticketId}/messages/${messageId}/resend`, email ? { email } : {}));
}

/** Whether this desk tracks email to the requester's address (#335). */
export function trackingOptOut(ticketId: number): Promise<{ email: string | null; opted_out: boolean }> {
  return v1Only(() => get(`${BASE}/tickets/${ticketId}/tracking-optout`));
}

export function setTrackingOptOut(ticketId: number, optedOut: boolean): Promise<{ email: string; opted_out: boolean }> {
  return v1Only(() => send('PUT', `${BASE}/tickets/${ticketId}/tracking-optout`, { opted_out: optedOut }));
}

/** Every ticket-page link and session the requester holds for this ticket stops working. */
export function revokeTicketLinks(ticketId: number): Promise<unknown> {
  return v1Only(() => send('POST', `${BASE}/tickets/${ticketId}/access/revoke`, {}));
}

/** The store sends the order's licence email again. */
export async function resendLicence(ticketId: number, orderId: number): Promise<{ order: RelatedOrder }> {
  return v1Only(() => send('POST', `${BASE}/tickets/${ticketId}/orders/${orderId}/resend-licence`, {}));
}

/** Link a ticket to another ticket, a chat or a record (`POST tickets/{id}/links`, FR-TKT-05; the list's Link to…, #333). */
export function addLink(ticketId: number, kind: string, id: number, relation: 'related' | 'duplicate' | 'follow_up' = 'related'): Promise<unknown> {
  return v1Only(() => send('POST', `${BASE}/tickets/${ticketId}/links`, { kind, id, relation }));
}

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
  return v1OrElse(
    async () => {
      const r = await getMeta<{ present: Present[] }>(`${BASE}/tickets/${ticketId}/presence`);
      return r.offline ? [] : (r.data.present ?? []);
    },
    () => [],
  );
}

/** I am on this ticket (viewing, typing a reply or a note), or I have left it. Answers who else is. */
export function here(ticketId: number, state: 'viewing' | 'typing' | 'left', mode?: 'reply' | 'note'): Promise<Present[]> {
  return v1OrElse(
    async () => (await send<{ present: Present[] }>('POST', `${BASE}/tickets/${ticketId}/presence`, mode ? { state, mode } : { state })).present ?? [],
    () => [],
  );
}

/* ── website chat → ticket (D-06, FR-LCH-01…08, FR-DSK-08) ──────────────── */

/** What the conversion sheet opens with; its `ticket` is the chat's back-link once converted. */
export function conversionPreview(conversationId: number, signal?: AbortSignal): Promise<ConversionPreview> {
  return v1Only(() => get<ConversionPreview>(`${BASE}/conversions/${conversationId}`, undefined, signal));
}

/**
 * Convert the chat: a new ticket or appended to one of the visitor's. `key` (Idempotency-Key) is kept by the sheet
 * until it is done, so pressing Raise again after a failure raises one ticket. On a server without v1, the as-built
 * route, which always creates and answers `{id, reference}`.
 */
export function convertChat(
  input: ConvertInput,
  key: string,
): Promise<{
  id: number;
  reference: string;
  appended: boolean;
  answer: ConvertAnswer | null;
}> {
  return v1OrLegacy<{
    id: number;
    reference: string;
    appended: boolean;
    answer: ConvertAnswer | null;
  }>(
    async () => {
      const a = await send<ConvertAnswer>('POST', `${BASE}/conversions`, input, { 'Idempotency-Key': key });
      return {
        id: a.ticket.id,
        reference: a.ticket.reference,
        appended: a.appended,
        answer: a,
      };
    },
    async () => {
      const r = await send<{ id: number; reference: string }>('POST', `${LEGACY}/from-conversation`, { conversation_id: input.conversation_id });
      return {
        id: r.id,
        reference: r.reference,
        appended: false,
        answer: null,
      };
    },
  );
}

/** A chat or an email that is a ticket already (`ALREADY_CONVERTED`, `already_converted`): that ticket. */
export function alreadyConverted(e: unknown): { id: number; reference: string; status: string | null } | null {
  if (!(e instanceof ApiError) || e.code?.toUpperCase() !== 'ALREADY_CONVERTED') return null;
  const t = (
    e.data as {
      ticket?: { id?: unknown; reference?: unknown; status?: unknown };
    } | null
  )?.ticket;
  return t && typeof t.id === 'number'
    ? {
        id: t.id,
        reference: String(t.reference ?? ''),
        status: typeof t.status === 'string' ? t.status : null,
      }
    : null;
}

/** The visitor left no email address, and the ticket needs one to reach them (`422 requester_email_required`). */
export function requesterEmailRequired(e: unknown): boolean {
  return e instanceof ApiError && e.status === 422 && e.code?.toLowerCase() === 'requester_email_required';
}

/* ── what this server converts, and email → ticket (worksuite-desktop#298) ── */

/** Whether a conversion is offered: yes, no (off for the company, or not mine to do), or not said — an older server. */
export type ConversionOffer = 'yes' | 'no' | 'unknown';

/**
 * What `GET meta` says about converting a website chat or an email: `capabilities.convert_chat|convert_email` (the
 * company has Support, and Chat or Email, switched on) and `can.convert_chat|convert_email` (my right; `can.create`
 * where the server names no separate one). A server from before them says neither: 'unknown', and the screens keep
 * what they did before.
 */
export function conversionOffer(m: unknown, kind: 'chat' | 'email'): ConversionOffer {
  const d = (m ?? null) as {
    capabilities?: Record<string, unknown> | null;
    can?: Record<string, unknown> | null;
  } | null;
  const on = d?.capabilities?.[`convert_${kind}`];
  if (typeof on !== 'boolean') return 'unknown';
  if (!on) return 'no';
  return (d?.can?.[`convert_${kind}`] ?? d?.can?.create) === false ? 'no' : 'yes';
}

/** `POST conversions/email`: the message as Mail names it (its uid, in its folder and mailbox) and what it becomes. */
export interface EmailConvertInput {
  mail_message_id: number;
  folder?: string;
  mailbox?: string;
  /** A new ticket, or the id of one to add the email to. */
  target: 'new' | number;
  subject?: string;
  /** Null: the server files it under my only organization, or in Needs organization. */
  organization_id?: number | null;
}

/** The ticket an email became or joined. `existing`: it was one already, so nothing new was made. */
export interface EmailConvertAnswer {
  id: number;
  reference: string;
  status: TicketFull['status'] | null;
  appended: boolean;
  existing: boolean;
}

/**
 * An email made a ticket, or added to one (FR-EML-07): the requester is the sender, the email the first message, its
 * files kept. The same email twice is one ticket — `409 already_converted` with that ticket (`alreadyConverted`),
 * or an answer marked `existing`. Read either way the server sends the ticket: alone, or as `{ticket, appended}`.
 */
export async function convertEmail(input: EmailConvertInput): Promise<EmailConvertAnswer> {
  const a = await v1Only(() => send<Record<string, unknown>>('POST', `${BASE}/conversions/email`, input));
  const t = (a.ticket && typeof a.ticket === 'object' ? a.ticket : a) as {
    id?: unknown;
    reference?: unknown;
    status?: unknown;
  };
  if (typeof t.id === 'number' && typeof t.reference === 'string') references.set(t.id, t.reference);
  return {
    id: Number(t.id),
    reference: String(t.reference ?? ''),
    status: typeof t.status === 'string' ? (t.status as TicketFull['status']) : null,
    appended: a.appended === true,
    existing: a.existing === true,
  };
}

/* ── knowledge and AI in a ticket (D-10) ────────────────────────────────── */

/**
 * Articles for the ticket (FR-KB-06): from its subject and the requester's last message, ranked, or a search (`q`).
 * Nobody without `kb.view` there gets an empty list rather than a refusal.
 */
export async function ticketArticles(ticketId: number, q?: string, signal?: AbortSignal): Promise<KbSuggestion[]> {
  return (await v1Only(() => get<{ articles: KbSuggestion[] }>(`${BASE}/tickets/${ticketId}/kb`, { q: q?.trim() || undefined }, signal))).articles ?? [];
}

/** What to put in the reply for an article — its link (public articles only: `422 INTERNAL`) or its text; counted as a use. */
export function insertArticle(ticketId: number, articleId: number, mode: 'link' | 'text'): Promise<KbInsert> {
  return v1Only(() =>
    send<KbInsert>('POST', `${BASE}/tickets/${ticketId}/kb/insert`, {
      article_id: articleId,
      mode,
    }),
  );
}

/** The thread in up to five bullets (FR-AI-01), kept by the server until the thread moves; `refresh` asks anew. */
export function aiSummary(ticketId: number, refresh = false): Promise<AiSummary> {
  return v1Only(() => send<AiSummary>('POST', `${BASE}/tickets/${ticketId}/ai/summary`, refresh ? { refresh: true } : {}));
}

/** A reply to edit and send oneself (FR-AI-02): never sent by this call. Notes go in only when asked. */
export function aiReply(ticketId: number, input: { tone: AiTone; include_notes: boolean; instructions?: string }): Promise<AiReplyDraft> {
  const body = {
    tone: input.tone,
    include_notes: input.include_notes,
    ...(input.instructions?.trim() ? { instructions: input.instructions.trim() } : {}),
  };
  return v1Only(() => send<AiReplyDraft>('POST', `${BASE}/tickets/${ticketId}/ai/reply`, body));
}

/** Category, priority, language and sentiment as the assistant reads the ticket (FR-AI-03): applied, if at all, with PATCH. */
export function aiClassify(ticketId: number): Promise<AiClassification> {
  return v1Only(() => send<AiClassification>('POST', `${BASE}/tickets/${ticketId}/ai/classify`, {}));
}

/** The composer's text improved, shortened, made friendlier or more professional, or translated. */
export function aiRewrite(text: string, mode: RewriteMode, organizationId?: number | null): Promise<{ text: string; model: string | null }> {
  return v1Only(() =>
    send<{ text: string; model: string | null }>('POST', `${BASE}/ai/rewrite`, {
      text,
      mode,
      ...(organizationId ? { organization_id: organizationId } : {}),
    }),
  );
}

/** The assistant could not answer (`503 AI_UNAVAILABLE`): the rest of the desk carries on without it. */
export function aiUnavailable(e: unknown): boolean {
  return e instanceof ApiError && e.code === 'AI_UNAVAILABLE';
}

/** What an AI or knowledge refusal says on the panel: the assistant being away is not an error of the agent's. */
export function assistError(e: unknown): string {
  if (aiUnavailable(e)) return text('The AI assistant is not available just now. Everything else works; try again in a while.');
  if (e instanceof ApiError && e.status === 403) return text('You do not have permission for this on this ticket.');
  if (e instanceof ApiError && e.code === 'INTERNAL' && e.status === 422) return text('This article is internal: it has no link to send. Insert its text instead.');
  return errorText(e);
}

/* ── my draft on the server (FR-CRT-10, "Workspace extras") ─────────────── */

/** My draft of a ticket as the server keeps it, or null (none, or a server without drafts). */
export async function serverDraft(ticketId: number, signal?: AbortSignal): Promise<ServerDraft | null> {
  return v1OrElse(
    async () => (await get<{ draft: ServerDraft | null }>(`${BASE}/tickets/${ticketId}/draft`, undefined, signal)).draft ?? null,
    () => null,
  );
}

/** Keeps my draft on the server too — an empty body removes it. */
export function saveServerDraft(
  ticketId: number,
  draft: {
    mode: 'reply' | 'note';
    body: string;
    body_html?: string;
    cc?: string[];
  },
): Promise<unknown> {
  return v1OrElse(
    () =>
      send('PUT', `${BASE}/tickets/${ticketId}/draft`, {
        mode: draft.mode,
        body: draft.body,
        body_html: draft.body_html,
        ...(draft.cc?.length ? { cc: draft.cc } : {}),
      }),
    () => null,
  );
}

/* ── windows ───────────────────────────────────────────────────────────── */

/** A ticket's quick-reply window (D-04): floating, always on top, one at a time; its draft is the ticket's. */
export function openQuickReply(ticketId: number): void {
  void call('windows:open', {
    kind: 'support-quick',
    route: quickRoute(ticketId),
    title: 'Quick reply',
    alwaysOnTop: true,
  }).catch(() => undefined);
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
  lookup: (q: string) => ['support', 'lookup', q.trim().toLowerCase()] as const,
  conversion: (conversationId: number) => ['support', 'conversion', conversationId] as const,
  kb: (ticketId: number, q: string) => ['support', 'kb', ticketId, q] as const,
  summary: (ticketId: number) => ['support', 'ai-summary', ticketId] as const,
  client: (ticketId: number) => ['support', 'client', ticketId] as const,
  related: (ticketId: number) => ['support', 'related', ticketId] as const,
  dashboard: ['support', 'dashboard'] as const,
  myPresence: ['chat', 'presence', 'me'] as const,
};

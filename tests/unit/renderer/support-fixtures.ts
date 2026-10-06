import { vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';

/**
 * The desk as the support screens' tests serve it (desktop T22–T27): tickets, messages and a ticket's page in the
 * API's shapes (docs/SUPPORT_API.md), and a stand-in for `request` that answers by "METHOD path" and logs what was
 * asked. A test file mocks `src/core/api`'s `request` and hands it to `serveWith`.
 */
export const ticket = (id: number, over: Record<string, unknown> = {}) => ({
  id, reference: `CFX-00${id}`, subject: `Subject ${id}`, status: 'open', status_category: 'open', priority: 'normal', type: 'incident', source: 'email',
  organization: { id: 10, name: 'CreativeFX' }, requester: { name: `Requester ${id}`, email: `r${id}@acme.lk`, phone: null, kind: 'guest', user_id: null, contact_id: null, company_id: null },
  assignee: { id: 1, name: 'Ayesha Fernando' }, team: null, category: { id: 3, name: 'Licensing' }, department: null, tags: [], sla: { state: null, target: null, due_at: null, policy_id: null, paused_ms: 0 },
  due_at: null, confidential: false, unread: 0, conversation_id: null, version: 7, opened_at: '2026-10-04T09:12:00+05:30', first_response_at: null, last_customer_at: null, last_agent_at: null,
  resolved_at: null, closed_at: null, created_at: '2026-10-04T09:12:00+05:30', updated_at: '2026-10-04T09:42:00+05:30', deleted_at: null, ...over,
});

export const msg = (id: number, over: Record<string, unknown> = {}) => ({ id, body: `Message ${id}`, body_html: null, author: null, author_name: 'Requester', from: 'requester', internal: false, channel: 'email', delivery_channel: null, delivery_status: null, cc: [], mentions: [], client_id: null, edited_at: null, created_at: '2026-10-04T09:12:00+05:30', ...over });

export const show = (id: number, over: Record<string, unknown> = {}) => ({
  ticket: ticket(id, { unread: 2 }),
  messages: [msg(1), msg(2, { author: { id: 4, name: 'Nimal Perera' }, author_name: 'Nimal Perera', from: 'staff', internal: true, body: '@Ayesha seats missing' }), msg(3, { body: 'Affected users are kumari@' })],
  has_earlier: false, attachments: [], events: [], last_read_message_id: 2, can: { view: true, reply: true, notes: true, close: true, edit: true, assign: true }, transitions: ['in_progress', 'pending_customer', 'resolved'], remote_desk: null,
  ...over,
});

export type Call = { method: string; path: string; query?: Record<string, unknown>; body?: unknown; headers?: Record<string, string> };

/** Answers `request` from `served` ("GET /api/…": a value, a function of the query and body, or an Error to throw); nothing served never answers. */
export function serveWith(request: typeof CoreApi.request, served: Record<string, unknown>): Call[] {
  const log: Call[] = [];
  vi.mocked(request).mockImplementation((async (method: string, path: string, opts: { query?: Record<string, unknown>; body?: unknown; headers?: Record<string, string> } = {}) => {
    log.push({ method, path, query: opts.query, body: opts.body, headers: opts.headers });
    const hit = served[`${method} ${path}`];
    const data = typeof hit === 'function' ? (hit as (q: Record<string, unknown>, b: unknown) => unknown)(opts.query ?? {}, opts.body) : hit;
    if (data instanceof Error) throw data;
    if (data === undefined) return new Promise(() => undefined);
    return { data, offline: false, cachedAt: null, message: null };
  }) as never);
  return log;
}

export const READY = {
  auth: { stage: 'ready', server: null, user: { id: '1', name: 'Ayesha Fernando', email: 'a@x', avatar: null, timezone: null, locale: null, organizationId: null, organizationName: null, timeFormat: null, weekStart: null }, message: null, setupPending: false },
  status: { network: 'ONLINE', realtime: 'connected', pendingChanges: 0, unread: { mail: 0, chat: 0, notifications: 0, tasks: 0 }, notificationsPausedUntil: null, services: {}, locked: false, safeMode: false },
} as const;

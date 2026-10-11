import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';

vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), request: vi.fn() }));

const { ApiError, request } = await import('../../../src/core/api');
const api = await import('../../../src/modules/support/api');

/**
 * The Support API client (desktop T18): `/api/support/v1`, and the as-built `/api/tickets` on a server from before it
 * — only when the server really has no v1 route, never because one ticket was not found.
 */
type Handler = (method: string, path: string, opts: { query?: Record<string, unknown>; body?: unknown }) => unknown;
let handler: Handler;
const calls = () => vi.mocked(request).mock.calls.map((c) => `${c[0]} ${c[1]}`);
const missing = () => new ApiError(404, 'Not found', null);

beforeEach(() => {
  api.resetApiFamily();
  vi.mocked(request).mockReset().mockImplementation((async (method: string, path: string, opts: { query?: Record<string, unknown>; body?: unknown } = {}) => {
    const data = await handler(method, path, opts);
    return { data, offline: false, cachedAt: null, message: null };
  }) as never);
});
afterEach(() => {
  vi.useRealTimers();
});

/** A server with only the as-built routes. */
const asBuilt: Handler = (method, path) => {
  if (path.startsWith('/api/support/v1')) throw missing();
  if (method === 'GET' && path === '/api/tickets') return { tickets: [{ id: 5, reference: 'TKT-000005', subject: 'Printer', status: 'open', priority: 'high', assigned_to: null, updated_at: '2026-10-02 10:00:00' }], can: { view: true } };
  if (method === 'GET' && path === '/api/tickets/5') return { ticket: { id: 5, reference: 'TKT-000005', subject: 'Printer', status: 'pending', priority: 'high', version: 3 }, messages: [], events: [], tags: ['printers'], can: { view: true, reply: true, manage: true } };
  if (method === 'POST' && path === '/api/tickets/5/reply') return { id: 77, duplicate: false, version: 4 };
  if (method === 'POST' && path === '/api/tickets/5/action') return {};
  if (method === 'GET' && path === '/api/tickets/agents') return { agents: [{ id: 3, name: 'Ayesha' }] };
  throw new ApiError(500, `unexpected ${method} ${path}`, null);
};

describe('the v1 API', () => {
  it('lists a view with its filters, a page at a time', async () => {
    handler = () => ({ items: [], next_cursor: 'abc', has_more: true, sort: 'sla', view: 'mine' });
    const page = await api.listTickets({ view: 'mine', sort: 'sla', q: ' m365 ', status: ['open', 'new'], priority: ['urgent'], organization: ['10', '20'], limit: 50, cursor: 'xyz' });
    expect(page).toMatchObject({ next_cursor: 'abc', has_more: true, offline: false });
    expect(vi.mocked(request)).toHaveBeenCalledWith('GET', '/api/support/v1/tickets', expect.objectContaining({ query: { view: 'mine', sort: 'sla', q: 'm365', status: 'open,new', priority: 'urgent', organization: '10,20', assignee: undefined, limit: 50, cursor: 'xyz' } }));
  });

  it('peeks at a ticket without marking it read, and sends the version with a change', async () => {
    handler = (method) => (method === 'GET' ? { ticket: { id: 9 }, messages: [] } : { ticket: { id: 9, version: 8 } });
    await api.getTicket(9, { peek: true });
    expect(vi.mocked(request).mock.calls[0]).toEqual(['GET', '/api/support/v1/tickets/9', expect.objectContaining({ query: { peek: 1 } })]);
    await expect(api.updateTicket(9, 7, { priority: 'urgent' })).resolves.toMatchObject({ version: 8 });
    expect(vi.mocked(request).mock.calls[1]).toEqual(['PATCH', '/api/support/v1/tickets/9', expect.objectContaining({ body: { priority: 'urgent', version: 7 } })]);
  });

  it('does not fall back when one ticket is not found: the server has v1', async () => {
    handler = (_m, path) => {
      if (path === '/api/support/v1/tickets/404') throw new ApiError(404, 'Ticket not found', null);
      if (path === '/api/support/v1/meta') return { statuses: [] };
      throw new Error(`unexpected ${path}`);
    };
    await expect(api.getTicket(404)).rejects.toMatchObject({ status: 404, message: 'Ticket not found' });
    expect(calls()).toEqual(['GET /api/support/v1/tickets/404', 'GET /api/support/v1/meta']);
    // Known now: the next missing ticket asks nothing more.
    await expect(api.getTicket(404)).rejects.toMatchObject({ status: 404 });
    expect(calls()).toHaveLength(3);
  });

  it('reads a version conflict, a merge and a refusal', () => {
    const conflict = new ApiError(409, 'Somebody changed it first', 'VERSION_CONFLICT', { ticket: { id: 9, version: 12 } });
    expect(api.conflictTicket(conflict)).toMatchObject({ version: 12 });
    expect(api.conflictTicket(new ApiError(409, 'Taken', 'ALREADY_ASSIGNED', null))).toBeNull();
    expect(api.mergedInto(new ApiError(409, 'Merged', 'MERGED', { merged_into: { id: 3, reference: 'TKT-3' } }))).toEqual({ id: 3, reference: 'TKT-3' });
    expect(api.refusalCode(new ApiError(422, 'No', 'TRANSITION_REFUSED', null))).toBe('TRANSITION_REFUSED');
    expect(api.errorText(new Error(''), 'Fallback')).toBe('Fallback');
  });

  it('gives each message a retry key the server accepts', () => {
    const id = api.newClientId();
    expect(id).toMatch(/^[A-Za-z0-9._:-]{1,64}$/);
    expect(api.newClientId()).not.toBe(id);
  });

  it('never shows who is present from the copy kept on this computer', async () => {
    vi.mocked(request).mockResolvedValueOnce({ data: { present: [{ user_id: 4, name: 'Nimal', state: 'viewing', mode: null, since: null }] }, offline: true, cachedAt: 'x', message: null } as never);
    await expect(api.presence(7)).resolves.toEqual([]);
  });
});

describe('a server with only the as-built routes', () => {
  beforeEach(() => {
    handler = asBuilt;
  });

  it('lists through /api/tickets, read as v1, and remembers the server for later calls', async () => {
    const page = await api.listTickets({ view: 'unassigned', q: 'printer' });
    expect(page.items).toMatchObject([{ id: 5, reference: 'TKT-000005', status: 'open', priority: 'high', assignee: null }]);
    expect(page.has_more).toBe(false);
    expect(calls()).toEqual(['GET /api/support/v1/tickets', 'GET /api/support/v1/meta', 'GET /api/tickets']);
    expect(vi.mocked(request).mock.calls[2]![2]).toMatchObject({ query: { status: 'live', search: 'printer' } });
    await api.getTicket(5);
    // Straight to the as-built route: v1 is not asked again while the answer holds.
    expect(calls().slice(3)).toEqual(['GET /api/tickets/5']);
  });

  it('shows a ticket with the moves its permissions allow', async () => {
    const s = await api.getTicket(5);
    expect(s).toMatchObject({ legacy: true, ticket: { status: 'pending_customer', version: 3, tags: ['printers'] }, transitions: ['open', 'in_progress', 'resolved'] });
  });

  it('replies, then sets the status as a second call', async () => {
    const r = await api.addMessage(5, { body: 'On it', internal: false, client_id: 'desk:1', status: 'pending_customer' });
    expect(r).toMatchObject({ duplicate: false, ticket: null, status_refused: null, message: { id: 77, body: 'On it', internal: false, from: 'staff', client_id: 'desk:1' } });
    const posts = vi.mocked(request).mock.calls.filter((c) => c[0] === 'POST');
    expect(posts.map((c) => [c[1], (c[2] as { body: unknown }).body])).toEqual([
      ['/api/support/v1/tickets/5/messages', { body: 'On it', internal: false, client_id: 'desk:1', status: 'pending_customer' }],
      ['/api/tickets/5/reply', { body: 'On it', internal: false, client_id: 'desk:1' }],
      ['/api/tickets/5/action', { action: 'status', status: 'pending_customer', reason: 'Set on send' }],
    ]);
  });

  it('reports a refused status beside the reply, as v1 does', async () => {
    handler = (method, path, opts) => {
      if (path === '/api/tickets/5/action') throw new ApiError(422, 'Open tickets cannot move to Closed.', 'TRANSITION_REFUSED', null);
      return asBuilt(method, path, opts);
    };
    const r = await api.addMessage(5, { body: 'Done', internal: false, status: 'closed' });
    expect(r.status_refused).toEqual({ code: 'TRANSITION_REFUSED', message: 'Open tickets cannot move to Closed.' });
  });

  it('refuses files rather than dropping them', async () => {
    await expect(api.addMessage(5, { body: 'See attached', internal: false, attachments: [3] })).rejects.toMatchObject({ code: 'NOT_SUPPORTED' });
    expect(calls()).not.toContain('POST /api/tickets/5/reply');
  });

  it('sets the status, assigns and takes through the as-built action', async () => {
    await expect(api.transition(5, { status: 'resolved', version: 3 })).resolves.toBeNull();
    await expect(api.assign(5, { user_id: 3, version: 3 })).resolves.toBeNull();
    await expect(api.take(5, 3)).resolves.toBeNull();
    const bodies = vi.mocked(request).mock.calls.filter((c) => c[1] === '/api/tickets/5/action').map((c) => (c[2] as { body: unknown }).body);
    expect(bodies).toEqual([
      { action: 'status', status: 'resolved', version: 3 },
      { action: 'assign', user_id: 3, version: 3, reason: undefined },
      { action: 'take', version: 3 },
    ]);
  });

  it('degrades what the as-built API cannot do', async () => {
    await expect(api.views()).resolves.toMatchObject({ saved: [], badges: null });
    await expect(api.badges()).resolves.toBeNull();
    await expect(api.meta()).resolves.toMatchObject({ legacy: true });
    await expect(api.canned()).resolves.toEqual([]);
    await expect(api.presence(5)).resolves.toEqual([]);
    await expect(api.agents()).resolves.toEqual([{ id: 3, name: 'Ayesha', presence: 'offline', open: 0, capacity: null, teams: [] }]);
    await expect(api.updateTicket(5, 3, { priority: 'low' })).rejects.toMatchObject({ code: 'NOT_SUPPORTED', message: api.NEEDS_NEWER_SERVER });
  });

  it('asks again after a while: the server may have been updated', async () => {
    vi.useFakeTimers();
    await api.badges();
    expect(calls()).toEqual(['GET /api/support/v1/badges', 'GET /api/support/v1/meta']);
    await api.badges();
    expect(calls()).toHaveLength(2);
    vi.advanceTimersByTime(api.LEGACY_RECHECK_MS + 1);
    handler = (_m, path) => (path === '/api/support/v1/badges' ? { badges: { assigned_open: 4, unassigned: 1, overdue: 0, at_risk: 0, unread: 2 } } : asBuilt('GET', path, {}));
    await expect(api.badges()).resolves.toMatchObject({ unread: 2 });
  });

  it('learns nothing while the server is out of reach', async () => {
    handler = (_m, path) => {
      if (path === '/api/support/v1/meta') throw new ApiError(0, 'Cannot reach WorkSuite server.', 'NETWORK_UNREACHABLE');
      if (path.startsWith('/api/support/v1')) throw missing();
      return asBuilt('GET', path, {});
    };
    await expect(api.getTicket(5)).rejects.toMatchObject({ status: 404 });
    handler = asBuilt;
    await expect(api.getTicket(5)).resolves.toMatchObject({ legacy: true });
  });

  it('finds a ticket by its reference', async () => {
    await expect(api.ticketIdForReference('tkt-000005')).resolves.toBe(5);
    await expect(api.ticketIdForReference('TKT-000006')).resolves.toBeNull();
  });
});

describe('chunked Helpdesk attachments', () => {
  it('resumes missing chunks and recovers a lost completion response without uploading again', async () => {
    const file = new Blob([new Uint8Array(8 * 1024 * 1024)], { type: 'application/pdf' });
    const received = new Set<number>();
    let completed = false;
    let failChunk = true;
    let loseAnswer = true;
    handler = (_method, path, opts) => {
      if (path === '/api/uploads/init') {
        expect(opts.body).toMatchObject({ purpose: 'support', ticket_id: 9, total_size: file.size, sha256: expect.stringMatching(/^[a-f0-9]{64}$/) });
        return { upload_id: 'support-session', chunk_size: 2 * 1024 * 1024, total_chunks: 4 };
      }
      if (path.endsWith('/status')) return { status: completed ? 'completed' : 'uploading', received_chunks: [...received] };
      if (path.endsWith('/chunk')) {
        const index = Number((opts.body as FormData).get('chunk_index'));
        if (index === 1 && failChunk) { failChunk = false; throw new ApiError(500, 'Try again', null); }
        received.add(index); return {};
      }
      if (path.endsWith('/attachments/from-upload')) {
        completed = true;
        if (loseAnswer) { loseAnswer = false; throw new ApiError(500, 'Response lost', null); }
        return { attachment: { id: 70, name: 'large.pdf' } };
      }
      throw new Error(`unexpected ${path}`);
    };
    await expect(api.uploadAttachment(9, file, 'large.pdf')).rejects.toThrow('Try again');
    await expect(api.uploadAttachment(9, file, 'large.pdf')).rejects.toThrow('Response lost');
    const before = calls().filter((c) => c.endsWith('/chunk')).length;
    await expect(api.uploadAttachment(9, file, 'large.pdf')).resolves.toMatchObject({ id: 70 });
    expect(calls().filter((c) => c.endsWith('/chunk'))).toHaveLength(before);
    expect(calls().filter((c) => c.endsWith('/init'))).toHaveLength(1);
    expect(received.size).toBe(4);
  });
});

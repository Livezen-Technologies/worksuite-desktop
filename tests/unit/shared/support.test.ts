import { describe, expect, it } from 'vitest';
import { APP_CATALOGUE, SUPPORT_PERMISSIONS, findApp, hasPermission, visibleApps } from '../../../shared/apps';
import { canOpenWebPath, visibleAppIds } from '../../../shared/access';
import { parseDeepLink } from '../../../shared/deeplink';
import { resolveWebLink } from '../../../shared/links';
import {
  allowedMoves,
  canonicalSupportRoute,
  capForMove,
  fromLegacyCaps,
  fromLegacyList,
  fromLegacyShow,
  inboxRoute,
  isTicketRoute,
  legacyListQuery,
  legacyMeta,
  legacyStatus,
  legacyViews,
  parseSupportRoute,
  supportHint,
  ticketIdOf,
  ticketRoute,
  type Ticket,
} from '../../../shared/support';

/**
 * The support desk's shared rules (WS-SUPPORT-SRS-001, desktop T18): its routes and deep links (FR-DSK-05), the
 * realtime hints it listens for (§12.2), and how the as-built `/api/tickets` reads as the v1 API on a server from
 * before it.
 */
describe('support routes', () => {
  it('names a ticket by id or reference in its own tab, and reads the web’s forms as the same ticket', () => {
    expect(ticketRoute(1284)).toBe('/support/ticket/1284');
    expect(parseSupportRoute('/support/ticket/1284')).toEqual({ kind: 'ticket', key: '1284' });
    expect(parseSupportRoute('/support/ticket/CFX-001284')).toEqual({ kind: 'ticket', key: 'CFX-001284' });
    // `/tickets?ticket=4` and `/tickets/4` (notifications, search) arrive as these.
    expect(parseSupportRoute('/support?ticket=4')).toEqual({ kind: 'ticket', key: '4' });
    expect(parseSupportRoute('/support/4')).toEqual({ kind: 'ticket', key: '4' });
    expect(parseSupportRoute('/support/tickets/4')).toEqual({ kind: 'ticket', key: '4' });
    expect(canonicalSupportRoute('/support?ticket=4')).toBe('/support/ticket/4');
    expect(canonicalSupportRoute('/support/4')).toBe('/support/ticket/4');
    expect(isTicketRoute('/support/ticket/9')).toBe(true);
  });

  it('keeps the inbox, its view and search, and leaves other words and other apps alone', () => {
    expect(parseSupportRoute('/support?view=unassigned&q=licence')).toEqual({ kind: 'inbox', view: 'unassigned', saved: null, q: 'licence' });
    expect(parseSupportRoute('/support')).toEqual({ kind: 'inbox', view: null, saved: null, q: null });
    // Not an id or a reference: room for the module's other screens, never read as a ticket.
    expect(parseSupportRoute('/support/wallboard')).toMatchObject({ kind: 'inbox' });
    expect(parseSupportRoute('/support/ticket/..')).toMatchObject({ kind: 'inbox' });
    expect(canonicalSupportRoute('/support?view=mine')).toBe('/support?view=mine');
    expect(canonicalSupportRoute('/supportive/4')).toBe('/supportive/4');
    expect(isTicketRoute('/mail/4')).toBe(false);
    expect(inboxRoute('overdue', 'm365')).toBe('/support?view=overdue&q=m365');
    expect(ticketIdOf('1284')).toBe(1284);
    expect(ticketIdOf('CFX-001284')).toBeNull();
  });

  it('opens worksuite://support/ticket/{id} and worksuite://support (FR-DSK-05)', () => {
    const link = parseDeepLink('worksuite://support/ticket/1284');
    expect(link).toMatchObject({ ok: true, link: { module: 'support', route: '/support/ticket/1284', params: { id: '1284' } } });
    expect(parseDeepLink('worksuite://support/ticket/CFX-001284?window=1')).toMatchObject({ ok: true, link: { route: '/support/ticket/CFX-001284', newWindow: true } });
    expect(parseDeepLink('worksuite://support')).toMatchObject({ ok: true, link: { route: '/support' } });
    expect(parseDeepLink('worksuite://support/ticket/../etc')).toMatchObject({ ok: false });
    expect(parseDeepLink('worksuite://support/ticket/12%2F3')).toMatchObject({ ok: false });
  });

  it('opens the web’s ticket links in the native tab', () => {
    expect(resolveWebLink('/tickets?ticket=4')).toEqual({ kind: 'tab', route: '/support?ticket=4', app: 'support' });
    expect(canonicalSupportRoute((resolveWebLink('/tickets/4') as { route: string }).route)).toBe('/support/ticket/4');
  });
});

describe('the Support app', () => {
  it('is a native app in the sidebar, opened by the desk’s permission — or an as-built one — not an app slug', () => {
    const support = findApp('support')!;
    expect(support).toMatchObject({ surface: 'native', sidebar: 'business', webPath: '/tickets' });
    expect(support.app).toBeUndefined();
    const sees = (permissions: string[], apps: string[] | '*' | null = ['mail']) => visibleApps({ apps, permissions }).some((a) => a.id === 'support');
    expect(sees(['support.view'])).toBe(true);
    expect(sees(['ticket.view'])).toBe(true);
    expect(sees(['ticket.manage'])).toBe(true);
    expect(sees(['crm.view'])).toBe(false);
    expect(sees([], '*')).toBe(false);
    expect(sees(['*'])).toBe(true);
    // A desktop-v1 server lists no `tickets` application: that must not hide the desk.
    expect(visibleApps({ apps: ['mail'], permissions: ['support.view'], serverApps: ['mail'] }).some((a) => a.id === 'support')).toBe(true);
    expect(SUPPORT_PERMISSIONS).toContain('support.view');
    expect(APP_CATALOGUE.filter((a) => a.id === 'support')).toHaveLength(1);
  });

  it('checks any one of several permissions, and a single one as before', () => {
    const grant = { apps: null, permissions: ['ticket.reply'] };
    expect(hasPermission(grant, ['support.view', 'ticket.reply'])).toBe(true);
    expect(hasPermission(grant, ['support.view'])).toBe(false);
    expect(hasPermission(grant, 'ticket.reply')).toBe(true);
    expect(hasPermission(grant, undefined)).toBe(true);
    expect(hasPermission(grant, [])).toBe(true);
  });

  it('refuses a ticket link to somebody without the desk, and opens it for somebody with it', () => {
    const boot = (permissions: string[]) => visibleAppIds({ apps: ['mail'], permissions });
    expect(canOpenWebPath('/tickets?ticket=4', boot([]))).toBe(false);
    expect(canOpenWebPath('/tickets?ticket=4', boot(['support.view']))).toBe(true);
  });
});

describe('realtime hints', () => {
  it('reads the desk hint, which carries no ticket id', () => {
    expect(supportHint({ type: 'support.changed', organization_id: 10, kind: 'message' })).toEqual({ type: 'support.changed', organization_id: 10, kind: 'message' });
    expect(supportHint({ type: 'support.changed', organization_id: null, kind: 'bulk' })).toEqual({ type: 'support.changed', organization_id: null, kind: 'bulk' });
  });

  it('reads a ticket hint and a message hint, and drops one without a ticket', () => {
    expect(supportHint({ type: 'support.ticket', kind: 'status', ticket_id: 1284, reference: 'CFX-001284', version: 8, fields: ['status'] })).toMatchObject({ kind: 'status', ticket_id: 1284, version: 8, fields: ['status'], message_id: null, mentioned: false });
    expect(supportHint({ type: 'support.ticket', kind: 'message', ticket_id: 7, reference: 'TKT-7', version: 3, message_id: 91, internal: true, from: 'staff', mentioned: true })).toMatchObject({ message_id: 91, internal: true, from: 'staff', mentioned: true });
    expect(supportHint({ type: 'support.ticket', kind: 'status' })).toBeNull();
    expect(supportHint({ type: 'support.ticket', ticket_id: '12abc' })).toBeNull();
  });

  it('reads who is present, keeping only well-formed people', () => {
    expect(supportHint({ type: 'support.presence', ticket_id: 7, present: [{ user_id: 4, name: 'Nimal', state: 'typing', mode: 'note', since: 'x' }, { name: 'nobody' }] })).toEqual({
      type: 'support.presence',
      ticket_id: 7,
      present: [{ user_id: 4, name: 'Nimal', state: 'typing', mode: 'note', since: 'x' }],
    });
    expect(supportHint({ type: 'chat.message' })).toBeNull();
    expect(supportHint(null)).toBeNull();
  });
});

describe('the as-built API, read as v1', () => {
  // A server from before T01: four statuses (`pending`), three permissions, no version, no organization.
  const OLD_SHOW = {
    ticket: { id: 5, reference: 'TKT-000005', subject: 'Printer offline', requester_name: 'Pat', requester_email: 'pat@x.lk', requester_phone: null, rustdesk_id: '1 482 667 019', rustdesk_uri: 'rustdesk://1482667019', source: 'email', status: 'pending', priority: 'high', assigned_to: 3, assignee_name: 'Ayesha', conversation_id: null, opened_at: '2026-10-01 09:00:00', first_response_at: null, resolved_at: null, closed_at: null, updated_at: '2026-10-02 10:00:00' },
    messages: [
      { id: 1, body: 'It is offline', author_id: null, author_name: 'Pat', from: 'requester', is_internal: false, channel: 'email', at: '2026-10-01 09:00:00' },
      { id: 2, body: 'Checking the spooler', author_id: 3, author_name: 'Ayesha', from: 'staff', is_internal: true, channel: 'agent', at: '2026-10-01 09:05:00' },
    ],
    events: [{ id: 9, action: 'status', detail: 'open → pending', user: 'Ayesha', at: '2026-10-01 09:06:00' }],
    can: { view: true, reply: true, manage: false },
    remote_desk: null,
  };

  it('reads a ticket, its messages and its journal', () => {
    const s = fromLegacyShow(OLD_SHOW);
    expect(s.legacy).toBe(true);
    expect(s.ticket).toMatchObject({ id: 5, reference: 'TKT-000005', status: 'pending_customer', status_category: 'pending', priority: 'high', assignee: { id: 3, name: 'Ayesha' }, version: 0, sla: { state: null }, opened_at: '2026-10-01T09:00:00', rustdesk_uri: 'rustdesk://1482667019' });
    expect(s.ticket.requester).toMatchObject({ name: 'Pat', email: 'pat@x.lk', kind: 'guest' });
    expect(s.messages.map((m) => [m.id, m.from, m.internal, m.created_at])).toEqual([
      [1, 'requester', false, '2026-10-01T09:00:00'],
      [2, 'staff', true, '2026-10-01T09:05:00'],
    ]);
    expect(s.events[0]).toMatchObject({ action: 'status', user: { name: 'Ayesha' } });
    expect(s.last_read_message_id).toBe(0);
    expect(s.attachments).toEqual([]);
  });

  it('reads the old permissions, and offers only the moves they allow', () => {
    const s = fromLegacyShow(OLD_SHOW);
    expect(s.can).toMatchObject({ view: true, reply: true, notes: true, close: false, edit: false });
    expect(s.transitions).toEqual([]);
    const manager = fromLegacyShow({ ...OLD_SHOW, can: { view: true, reply: true, manage: true } });
    expect(manager.transitions).toEqual(['open', 'in_progress', 'resolved']);
    // A server since T02 sends the v1 caps on the as-built route too.
    expect(fromLegacyCaps({ view: true, reply: true, notes: false, edit: true, close: false })).toEqual({ view: true, reply: true, notes: false, edit: true, close: false });
    expect(fromLegacyCaps(null)).toEqual({ view: true });
  });

  it('knows which permission each move needs', () => {
    expect(capForMove('open', 'resolved')).toBe('close');
    expect(capForMove('resolved', 'open')).toBe('reopen');
    expect(capForMove('open', 'escalated')).toBe('escalate');
    expect(capForMove('new', 'in_progress')).toBe('edit');
    expect(allowedMoves('resolved', { reopen: true, close: true })).toEqual(['open', 'closed']);
    expect(allowedMoves('closed', { reopen: true, close: true })).toEqual([]);
    expect(legacyStatus('weird')).toBe('open');
  });

  it('asks the as-built list what it can answer, and filters the rest here', () => {
    const t = (id: number, over: Partial<Ticket> = {}) => ({ id, reference: `TKT-${id}`, subject: 's', status: 'open', priority: 'normal', assigned_to: null, ...over });
    expect(legacyListQuery({ view: 'mine', q: ' m365 ' }).query).toEqual({ mine: '1', status: 'live', search: 'm365' });
    expect(legacyListQuery({ view: 'resolved' }).query).toEqual({ status: 'resolved' });
    expect(legacyListQuery({ view: 'pending', priority: ['urgent'] }).query).toEqual({ status: 'pending', priority: 'urgent' });
    const { query, keep } = legacyListQuery({ view: 'unassigned', priority: ['urgent', 'high'] });
    expect(query).toEqual({ status: 'live' });
    const page = fromLegacyList({ tickets: [t(1), t(2, { assigned_to: 4 } as never), t(3, { priority: 'urgent' } as never)] }, { view: 'unassigned' }, keep);
    expect(page.items.map((x) => x.id)).toEqual([3]);
    expect(page).toMatchObject({ next_cursor: null, has_more: false, view: 'unassigned' });
  });

  it('draws the rail and the vocabulary without counts or organizations', () => {
    expect(legacyViews().views.map((v) => v.key)).toContain('unassigned');
    expect(legacyViews().views.every((v) => v.count === null)).toBe(true);
    expect(legacyViews().badges).toBeNull();
    const meta = legacyMeta();
    expect(meta.legacy).toBe(true);
    expect(meta.statuses.find((s) => s.key === 'escalated')).toMatchObject({ label: 'Escalated', category: 'open', live: true, next: ['in_progress', 'resolved'] });
    expect(meta.organizations).toEqual([]);
  });
});

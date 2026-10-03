// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';

vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiGetMeta: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn(), apiDelete: vi.fn() }));
vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(async () => null), on: () => () => undefined, errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)), isMac: false, hasDesktop: () => true }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));
vi.mock('../../../src/core/access', () => ({ canOpen: (id: string) => id !== 'notes' }));

import { ApiError, apiGet, apiPost } from '../../../src/core/api';
import { setRegional } from '../../../src/core/time';
import { toast } from '../../../src/core/toasts';
import { AppsPane } from '../../../src/modules/mail/AppsPane';
import { AWAY_MS, CatchUp, catchUpDigest } from '../../../src/modules/mail/CatchUp';
import { candidateSlots, freeSlots, slotWords } from '../../../src/modules/mail/SuggestTimes';
import { declineInvitations } from '../../../src/modules/mail/MailRules';
import { CalendarPeek, agendaOf } from '../../../src/layouts/CalendarPeek';
import type { MessageStates } from '../../../src/modules/mail/states';
import type { MessageDetail, MessageRow } from '../../../src/modules/mail/types';

/**
 * ENH-MAIL-03 P5: the Apps pane (DMO-INT-01/02), Catch up (DMO-AI-01) and
 * Suggest times (DMO-CMP-17).
 */

const wrap = (node: ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{node}</QueryClientProvider>);
const detail: MessageDetail = { id: 12, message_id: '<a@x>', from_name: 'Pat', from_email: 'Pat@Client.example', subject: 'BOQ', to: ['me@livezen.lk'], cc: [], body_html: '<p>Please send the BOQ</p>', is_starred: false, attachments: [], created_at: '2026-10-05 09:00:00' };
const row = (id: number, over: Partial<MessageRow> = {}): MessageRow => ({ id, from_name: 'Pat', from_email: 'pat@client.example', subject: `S${id}`, preview: '', is_read: false, is_starred: false, has_attachment: false, created_at: '2026-10-05 09:00:00', folder_slug: 'inbox', mailbox: { id: 4, email: 'me@livezen.lk', name: 'Me', colour: 'blue' }, ...over });

beforeEach(() => {
  setRegional({ timezone: 'UTC', locale: 'en-GB', timeFormat: '24' });
  vi.mocked(apiPost).mockReset().mockResolvedValue({} as never);
  vi.mocked(toast).mockReset();
  window.localStorage.clear();
});
afterEach(() => cleanup());

describe('the Apps pane (DMO-INT-01)', () => {
  it('shows the sender’s CRM account with open deals and logs the email; offers a task and a helpdesk ticket', async () => {
    vi.mocked(apiGet).mockReset().mockImplementation((async (path: string) => {
      if (path === '/api/crm/leads') return { leads: [] };
      if (path === '/api/crm/accounts') return { accounts: [{ id: 9, name: 'Client Ltd', email: 'pat@client.example', status: 'active' }] };
      if (path === '/api/crm/accounts/9') return { account: { id: 9, name: 'Client Ltd' }, deals: [{ id: 1, name: 'Tower B', amount: 1200000, currency: 'LKR', stage: 'Proposal', stage_kind: 'open' }, { id: 2, name: 'Old', amount: 5, currency: 'LKR', stage: 'Lost', stage_kind: 'lost' }] };
      throw new ApiError(404, path, null);
    }) as never);
    const navigate = vi.fn();
    const onCreateTask = vi.fn();
    wrap(<AppsPane m={detail} link="https://ws.example/mail?msg=12" context={{ sender: null, security: { available: false } as never, related: { tasks: [{ id: 3, title: 'Send BOQ', status: 'todo', due: '2026-10-06' }] } }} offline={false} navigate={navigate} onCreateTask={onCreateTask} onSaveNote={vi.fn()} onClose={vi.fn()} />);
    const pane = screen.getByRole('complementary', { name: 'Apps' });
    expect(await within(pane).findByText('Client Ltd')).toBeTruthy();
    expect(await within(pane).findByText('Tower B')).toBeTruthy();
    expect(within(pane).queryByText('Old')).toBeNull();
    fireEvent.click(within(pane).getByRole('button', { name: /Client Ltd/ }));
    expect(navigate).toHaveBeenCalledWith('/crm?account=9');
    fireEvent.click(within(pane).getByRole('button', { name: 'Log this email' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/crm/accounts/9/activity', { kind: 'email', title: 'Email: BOQ', body: 'Please send the BOQ\n\nhttps://ws.example/mail?msg=12' }));
    fireEvent.click(within(pane).getByRole('button', { name: 'Send BOQ' }));
    expect(navigate).toHaveBeenCalledWith('/tasks?task=3');
    fireEvent.click(within(pane).getByRole('button', { name: 'Create task…' }));
    expect(onCreateTask).toHaveBeenCalled();
    fireEvent.click(within(pane).getByRole('button', { name: 'Create a helpdesk ticket' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/tickets', expect.objectContaining({ subject: 'BOQ', requester_email: 'Pat@Client.example' })));
    expect(within(pane).queryByRole('region', { name: 'Notes' })).toBeNull();
  });

  it('says plainly when the sender is not in CRM, and that CRM needs a connection', async () => {
    vi.mocked(apiGet).mockReset().mockImplementation((async (path: string) => (path === '/api/crm/leads' ? { leads: [{ id: 1, email: 'other@client.example' }] } : { accounts: [] })) as never);
    wrap(<AppsPane m={detail} link="" context={null} offline={false} navigate={vi.fn()} onCreateTask={vi.fn()} onSaveNote={vi.fn()} onClose={vi.fn()} />);
    expect(await screen.findByText('Pat@Client.example is not a lead or account in CRM.')).toBeTruthy();
    cleanup();
    wrap(<AppsPane m={detail} link="" context={null} offline navigate={vi.fn()} onCreateTask={vi.fn()} onSaveNote={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText('CRM needs a connection.')).toBeTruthy();
  });
});

describe('Catch up (DMO-AI-01)', () => {
  const since = Date.parse('2026-10-05T00:00:00Z');
  const states = { pins: {}, snoozed: {}, returned: {}, focus: {}, categories: {}, flags: { a: { start_at: null, due_at: '2026-10-05 17:00:00', reminder_at: null, completed_at: null, task_id: 1, mailbox: 4, folder: 'inbox', uid: '7', subject: 'Due today', from_name: 'Kim', from_email: 'kim@x.org' }, b: { start_at: null, due_at: '2026-10-09 17:00:00', reminder_at: null, completed_at: null, task_id: 2, mailbox: 4, folder: 'inbox', uid: '8', subject: 'Later', from_name: 'Kim', from_email: 'kim@x.org' } } } as unknown as MessageStates;

  it('gathers unread VIP mail, mentions since then and flags due today, once each', () => {
    const rows = [row(1, { from_email: 'Boss@x.org', subject: 'From the boss' }), row(2, { from_email: 'boss@x.org', is_read: true }), row(3, { from_email: 'boss@x.org', created_at: '2026-10-04 09:00:00' }), row(4)];
    const mentions = [row(5, { subject: '@Me look' }), row(1, { from_email: 'Boss@x.org' })];
    const items = catchUpDigest(since, rows, ['boss@x.org'], states, mentions, Date.parse('2026-10-05T23:59:59Z'));
    expect(items.map((i) => [i.kind, i.title])).toEqual([['vip', 'From the boss'], ['mention', '@Me look'], ['due', 'Due today']]);
    expect(items[2]!.ref).toEqual({ uid: '7', folder: 'inbox', mailbox: '4' });
  });

  it('shows after time away, opens an item, and can be dismissed', async () => {
    vi.mocked(apiGet).mockReset().mockResolvedValue({ messages: [] } as never);
    window.localStorage.setItem('ws.mail.lastSeen', String(Date.now() - AWAY_MS - 1000));
    const onOpen = vi.fn();
    wrap(<CatchUp enabled rows={[row(1, { from_email: 'boss@x.org', subject: 'From the boss', created_at: new Date().toISOString() })]} vips={['boss@x.org']} states={null} onOpen={onOpen} />);
    const card = await screen.findByRole('region', { name: 'Catch up' });
    expect(within(card).getByText('While you were away · 1')).toBeTruthy();
    fireEvent.click(within(card).getByRole('button', { name: /From the boss/ }));
    expect(onOpen).toHaveBeenCalledWith({ uid: '1', folder: 'inbox', mailbox: '4' });
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/api/mail/search', { q: '', scope: 'all', mentioned: 1 }));
    fireEvent.click(within(card).getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('region', { name: 'Catch up' })).toBeNull();
  });

  it('stays away after a short break', () => {
    window.localStorage.setItem('ws.mail.lastSeen', String(Date.now() - 60_000));
    wrap(<CatchUp enabled rows={[row(1, { from_email: 'boss@x.org', created_at: new Date().toISOString() })]} vips={['boss@x.org']} states={null} onOpen={vi.fn()} />);
    expect(screen.queryByRole('region', { name: 'Catch up' })).toBeNull();
  });
});

describe('Suggest times (DMO-CMP-17)', () => {
  it('offers working-day hours ahead, never past or the weekend', () => {
    const naive = (ymd: string, min: number) => `${ymd}T${String(Math.floor(min / 60)).padStart(2, '0')}:00:00.000Z`;
    // Friday 2026-10-09 at 15:10 UTC.
    const slots = candidateSlots('2026-10-09', 60, Date.parse('2026-10-09T15:10:00Z'), 2, naive);
    expect(slots[0]).toEqual({ start: '2026-10-09T16:00', end: '2026-10-09T17:00' });
    expect(slots[1]).toEqual({ start: '2026-10-12T09:00', end: '2026-10-12T10:00' });
    expect(slots.some((s) => s.start.startsWith('2026-10-10') || s.start.startsWith('2026-10-11'))).toBe(false);
    expect(candidateSlots('2026-10-12', 90, 0, 1, naive).at(-1)).toEqual({ start: '2026-10-12T16:00', end: '2026-10-12T17:30' });
    expect(slotWords({ start: '2026-10-12T09:00', end: '2026-10-12T10:00' })).toBe('Monday 12 Oct, 9:00–10:00');
  });

  it('keeps the first free times and names the people it could not check', async () => {
    const slots = [{ start: 'a', end: 'b' }, { start: 'c', end: 'd' }, { start: 'e', end: 'f' }, { start: 'g', end: 'h' }];
    const check = vi.fn(async (s: { start: string }) => ({ conflicts: s.start === 'a' ? [{}] : [], unknown: [{ email: 'pat@client.example' }] }));
    const r = await freeSlots(['pat@client.example'], slots, 2, check);
    expect(r).toEqual({ free: [slots[1], slots[2]], unseen: ['pat@client.example'] });
    expect(check).toHaveBeenCalledTimes(3);
  });
});

describe('while away: decline meeting invitations (DMO-OOF-02)', () => {
  it('declines only invitations the person does not organise and has not already declined', async () => {
    const get = vi.fn(async () => ({ data: { events: [
      { source: 'event', id: 1, invited: true, can_manage: false, my_rsvp: 'accepted' },
      { source: 'event', id: 1, invited: true, can_manage: false, my_rsvp: 'accepted' },
      { source: 'event', id: 2, invited: true, can_manage: true },
      { source: 'event', id: 3, invited: false },
      { source: 'event', id: 4, invited: true, my_rsvp: 'declined' },
      { source: 'businessmeeting', id: 5, invited: true },
      { source: 'event', id: 6, invited: true, status: 'cancelled' },
      { source: 'event', id: 7, invited: true, my_rsvp: null },
    ] }, offline: false, cachedAt: null }));
    const post = vi.fn(async (path: string, _body?: unknown) => {
      if (path.includes('/7/')) throw new Error('refused');
      return {};
    });
    expect(await declineInvitations('2026-10-12', '2026-10-16', get as never, post as never)).toBe(1);
    expect(get).toHaveBeenCalledWith('/api/calendar/events', { from: '2026-10-12', to: '2026-10-16' });
    expect(post.mock.calls.map(([p, b]) => [p, b])).toEqual([['/api/calendar/events/1/rsvp', { status: 'declined' }], ['/api/calendar/events/7/rsvp', { status: 'declined' }]]);
  });
});

describe('Calendar peek (DMO-CAL-05)', () => {
  it('lists today all-day first then by time, without cancelled or declined entries', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const events = [
      { source: 'event', id: 1, title: 'Standup', start_at: `${today} 09:00:00`, end_at: `${today} 09:15:00`, all_day: false },
      { source: 'event', id: 2, title: 'Holiday', start_at: `${today} 00:00:00`, end_at: null, all_day: true },
      { source: 'event', id: 3, title: 'Cancelled', start_at: `${today} 08:00:00`, end_at: null, all_day: false, status: 'cancelled' },
      { source: 'event', id: 4, title: 'Declined', start_at: `${today} 07:00:00`, end_at: null, all_day: false, my_rsvp: 'declined' },
    ];
    expect(agendaOf(events).map((e) => e.title)).toEqual(['Holiday', 'Standup']);
    const { apiGetMeta } = await import('../../../src/core/api');
    vi.mocked(apiGetMeta).mockReset().mockResolvedValue({ data: { events }, offline: false, cachedAt: null } as never);
    const onClose = vi.fn();
    wrap(<CalendarPeek at={{ top: 10, left: 10 }} onClose={onClose} />);
    const peek = screen.getByRole('dialog', { name: 'Today’s agenda' });
    expect(await within(peek).findByText('Standup')).toBeTruthy();
    expect(within(peek).getByText('All day')).toBeTruthy();
    expect(within(peek).queryByText('Cancelled')).toBeNull();
    fireEvent.keyDown(peek, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});

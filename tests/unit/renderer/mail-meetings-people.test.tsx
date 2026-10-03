// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';
import type * as Tabs from '../../../src/core/tabs';

vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiGetMeta: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn(), apiDelete: vi.fn() }));
vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(async () => null), on: () => () => undefined, errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)), isMac: false, hasDesktop: () => true }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));
const nav = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock('../../../src/core/tabs', async (orig) => ({ ...(await orig<typeof Tabs>()), navigate: nav.navigate }));

import { ApiError, apiDelete, apiGet, apiGetMeta, apiPost, apiPut } from '../../../src/core/api';
import { app } from '../../../src/core/app-state';
import { call } from '../../../src/core/bridge';
import { TabProvider } from '../../../src/core/tab-context';
import { setRegional } from '../../../src/core/time';
import { toast } from '../../../src/core/toasts';
import { InviteCard, hasInvite, inviteWhen, type InviteView } from '../../../src/modules/mail/InviteCard';
import MailPage from '../../../src/modules/mail/MailPage';
import { Rules } from '../../../src/modules/mail/MailRules';
import { senderNotice } from '../../../src/modules/mail/MessageView';
import { applyFilters, serverFilters } from '../../../src/modules/mail/model';
import { PersonButton } from '../../../src/modules/mail/PeopleCard';
import { RecipientField } from '../../../src/modules/mail/Recipients';
import { MAIL_DRAG, TodoPane, nextSlot } from '../../../src/modules/mail/TodoPane';
import type { MessageContext, MessageRow } from '../../../src/modules/mail/types';

/**
 * ENH-MAIL-03 P3 — meetings and people in Mail: the invite card and its
 * answers (DMO-CAL-01…04, AC-DMO-07), My Day with drag to calendar and tasks
 * (DMO-TSK-04, DMO-CAL-05/07), the people card with VIP and out of office
 * (DMO-PPL-01/05, DMO-OOF-02, AC-DMO-15), server-kept autocomplete
 * (DMO-PPL-03) and automatic replies for inside and outside (DMO-OOF-01,
 * AC-DMO-09).
 */

const row = (id: number, over: Partial<MessageRow> = {}): MessageRow => ({ id, from_name: `Sender ${id}`, from_email: `s${id}@example.org`, subject: `Subject ${id}`, preview: '', is_read: true, is_starred: false, has_attachment: false, created_at: '2026-10-05 09:00:00', folder_slug: 'inbox', ...over });
const wrap = (node: ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{node}</QueryClientProvider>);

beforeEach(() => {
  setRegional({ timezone: 'Asia/Colombo', locale: 'en-GB', timeFormat: '24' });
  vi.mocked(toast).mockReset();
  vi.mocked(apiPost).mockReset().mockResolvedValue({} as never);
  vi.mocked(apiPut).mockReset().mockResolvedValue({} as never);
  vi.mocked(apiDelete).mockReset().mockResolvedValue({} as never);
  nav.navigate.mockReset();
  window.localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const INVITE: InviteView = {
  invite: {
    method: 'REQUEST',
    uid: 'abc',
    sequence: 0,
    status: 'confirmed',
    summary: 'BOQ review',
    location: 'Microsoft Teams Meeting',
    description: null,
    start: '2026-10-12 04:30:00',
    end: '2026-10-12 05:30:00',
    all_day: false,
    recurring: false,
    organizer: { email: 'pat@client.example', name: 'Pat Lee' },
    attendees: [
      { email: 'asha@example.com', name: 'Asha', status: 'needs-action', role: 'req-participant' },
      { email: 'omar@example.com', name: 'Omar', status: 'accepted', role: 'opt-participant' },
    ],
    meet_url: 'https://teams.microsoft.com/l/meetup-join/abc',
    comment: null,
    warning: null,
  },
  me: 'asha@example.com',
  event_id: null,
  state: 'new',
  response: null,
  applied: false,
  can_respond: true,
  conflicts: [{ title: 'Site visit', start: '2026-10-12 05:00:00', end: '2026-10-12 06:30:00', all_day: false }],
  day: [
    { title: 'Site visit', start: '2026-10-12 05:00:00', end: '2026-10-12 06:30:00', all_day: false },
    { title: 'Lunch', start: '2026-10-12 07:30:00', end: '2026-10-12 08:30:00', all_day: false },
  ],
};
const REF = { uid: '7', folder: 'inbox', mailbox: '4' };

describe('the invite card (DMO-CAL-01…04, AC-DMO-07)', () => {
  const serve = (v: InviteView | null) =>
    vi.mocked(apiGet).mockReset().mockImplementation((async (path: string) => {
      if (path === '/api/mail/messages/7/invite') {
        if (!v) throw new ApiError(404, path, null);
        return v;
      }
      throw new ApiError(404, path, null);
    }) as never);

  it('knows an invite and says when it is, on the reader’s clock', () => {
    expect(hasInvite({ attachments: [{ ref: '2', name: 'invite.ics', mime: 'text/calendar', size: 1 }] } as never)).toBe(true);
    expect(hasInvite({ attachments: [{ ref: '2', name: 'Plan.pdf', mime: 'application/pdf', size: 1 }] } as never)).toBe(false);
    expect(inviteWhen(INVITE.invite)).toBe('Monday 12 October, 10:00 – 11:00');
    expect(inviteWhen({ start: '2026-10-11 18:30:00', end: '2026-10-12 18:30:00', all_day: true })).toBe('Monday 12 October, all day');
  });

  it('shows the meeting, its link, who is coming, the clash and the day; Accept sends the response', async () => {
    serve(INVITE);
    wrap(<InviteCard msgRef={REF} offline={false} />);
    const card = await screen.findByRole('region', { name: 'Meeting invite' });
    expect(within(card).getByText('BOQ review')).toBeTruthy();
    expect(within(card).getByText('Monday 12 October, 10:00 – 11:00')).toBeTruthy();
    expect(within(card).getByText('Organiser: Pat Lee <pat@client.example>')).toBeTruthy();
    expect(within(card).getByText('2 invited · 1 going')).toBeTruthy();
    expect(within(card).getByRole('note').textContent).toContain('Clashes with Site visit (10:30–12:00)');
    const day = within(card).getByRole('group', { name: 'Your day' });
    expect(within(day).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['10:00–11:00BOQ review (this invite)', '10:30–12:00Site visit', '13:00–14:00Lunch']);
    fireEvent.click(within(card).getByRole('button', { name: 'Join' }));
    expect(call).toHaveBeenCalledWith('app:openExternal', { url: 'https://teams.microsoft.com/l/meetup-join/abc' });

    fireEvent.click(within(card).getByRole('button', { name: 'Accept' }));
    fireEvent.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: /Send the response now/ }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/mail/messages/7/invite', { mailbox: '4', folder: 'inbox', response: 'accepted', send: true, comment: '' }));
  });

  it('declines without telling anyone, or with a note', async () => {
    serve(INVITE);
    wrap(<InviteCard msgRef={REF} offline={false} />);
    const card = await screen.findByRole('region', { name: 'Meeting invite' });
    fireEvent.click(within(card).getByRole('button', { name: 'Decline' }));
    fireEvent.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: /Do not send a response/ }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/mail/messages/7/invite', expect.objectContaining({ response: 'declined', send: false })));

    fireEvent.click(within(card).getByRole('button', { name: 'Tentative' }));
    fireEvent.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: /Edit the response before sending/ }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Note to the organiser'), { target: { value: 'Running late' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/mail/messages/7/invite', expect.objectContaining({ response: 'tentative', send: true, comment: 'Running late' })));
  });

  it('proposes a new time in UTC from the reader’s clock', async () => {
    serve(INVITE);
    wrap(<InviteCard msgRef={REF} offline={false} />);
    const card = await screen.findByRole('region', { name: 'Meeting invite' });
    fireEvent.click(within(card).getByRole('button', { name: 'Propose new time' }));
    const dialog = await screen.findByRole('dialog', { name: 'Propose a new time' });
    expect((within(dialog).getByLabelText('Day') as HTMLInputElement).value).toBe('2026-10-12');
    expect((within(dialog).getByLabelText('Starts') as HTMLInputElement).value).toBe('10:00');
    fireEvent.change(within(dialog).getByLabelText('Starts'), { target: { value: '14:00' } });
    fireEvent.change(within(dialog).getByLabelText('Ends'), { target: { value: '13:00' } });
    expect((within(dialog).getByRole('button', { name: 'Send proposal' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText('Ends'), { target: { value: '15:00' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send proposal' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/mail/messages/7/invite', expect.objectContaining({ response: 'tentative', send: true, propose: { start: '2026-10-12 08:30:00', end: '2026-10-12 09:30:00' } })));
  });

  it('marks a change by the organiser, and offers Remove from calendar for a cancellation', async () => {
    serve({ ...INVITE, state: 'updated', response: 'accepted', event_id: 3 });
    wrap(<InviteCard msgRef={REF} offline={false} />);
    expect(await screen.findByText('Changed by the organiser')).toBeTruthy();
    cleanup();

    serve({ ...INVITE, invite: { ...INVITE.invite, method: 'CANCEL', status: 'cancelled' }, state: 'cancelled', event_id: 3 });
    wrap(<InviteCard msgRef={REF} offline={false} />);
    const card = await screen.findByRole('region', { name: 'Meeting invite' });
    expect(within(card).getByText('Cancelled')).toBeTruthy();
    expect(within(card).queryByRole('button', { name: 'Accept' })).toBeNull();
    fireEvent.click(within(card).getByRole('button', { name: 'Remove from calendar' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/mail/messages/7/invite/remove', { mailbox: '4', folder: 'inbox' }));
  });

  it('shows an attendee’s answer to my meeting, says when a shared mailbox cannot answer, and waits when offline', async () => {
    serve({ ...INVITE, invite: { ...INVITE.invite, method: 'REPLY', attendees: [{ email: 'omar@example.com', name: 'Omar', status: 'declined', role: 'req-participant' }] }, state: 'reply', applied: true });
    wrap(<InviteCard msgRef={REF} offline={false} />);
    expect(await screen.findByText(/Omar answered: Declined\. Your calendar has been updated\./)).toBeTruthy();
    cleanup();

    serve({ ...INVITE, can_respond: false });
    wrap(<InviteCard msgRef={REF} offline={false} />);
    expect(await screen.findByText(/came to a shared mailbox/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Accept' })).toBeNull();
    cleanup();

    wrap(<InviteCard msgRef={REF} offline />);
    expect(screen.getByText(/Answer it when you are back online/)).toBeTruthy();
  });
});

describe('the people card (DMO-PPL-01/05, DMO-OOF-02, AC-DMO-15)', () => {
  const CTX: MessageContext = {
    sender: { email: 'omar@example.com', name: 'Omar Farook', contact_id: null, user_id: 12, is_colleague: true, company: 'Livezen', job_title: 'Quantity Surveyor', department: 'Projects', phone: '+94 11 234 5678', is_customer: false },
    history: { total: 14, first: null, last: null, messages: [{ id: 1, subject: 'BOQ v3', at: '2026-10-04 08:00:00', is_read: false, has_attachment: true, folder: 'Inbox', slug: 'inbox' }] },
    security: {} as never,
  };

  it('shows who they are, that they are away, recent mail, and makes them a VIP', async () => {
    vi.mocked(apiGet).mockReset().mockImplementation((async (path: string) => {
      if (path === '/api/mail/vips') return { vips: [] };
      if (path === '/api/mail/people/out-of-office') return { known: true, away: true, until: '2026-10-12', subject: 'Away' };
      throw new ApiError(404, path, null);
    }) as never);
    const chat = vi.fn();
    const email = vi.fn();
    wrap(<PersonButton name="Omar Farook" email="omar@example.com" context={CTX} actions={{ email, chat }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Omar Farook' }));
    const card = await screen.findByRole('dialog', { name: 'About Omar Farook' });
    expect(within(card).getByText('Quantity Surveyor · Projects · Livezen')).toBeTruthy();
    expect(within(card).getByText('Colleague')).toBeTruthy();
    expect(await within(card).findByText('Out of office until 12 Oct')).toBeTruthy();
    expect(within(card).getByText('Recent mail (14)')).toBeTruthy();
    expect(within(card).getByText('BOQ v3')).toBeTruthy();
    fireEvent.click(within(card).getByRole('button', { name: 'Call' }));
    expect(call).toHaveBeenCalledWith('app:openExternal', { url: 'tel:+94112345678' });
    fireEvent.click(await within(card).findByRole('button', { name: 'Make VIP' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/mail/vips', { address: 'omar@example.com', name: 'Omar Farook' }));
    fireEvent.click(within(card).getByRole('button', { name: 'Chat' }));
    expect(chat).toHaveBeenCalledWith(12);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('has a VIP view that narrows on this computer and never asks the server for it', () => {
    const rows = [row(1, { from_email: 'Omar@example.com' }), row(2)];
    expect(applyFilters(rows, ['vip'], undefined, new Set(['omar@example.com'])).map((r) => r.id)).toEqual([1]);
    expect(applyFilters(rows, ['vip']).map((r) => r.id)).toEqual([]);
    expect(serverFilters(['vip', 'unread'])).toEqual(['unread']);
  });
});

describe('autocomplete kept by WorkSuite (DMO-PPL-03)', () => {
  it('suggests people written to before first, then the directory; one can be removed', async () => {
    vi.mocked(apiGet).mockReset().mockImplementation((async (path: string) => {
      if (path === '/api/mail/autocomplete') return { suggestions: [{ email: 'nimal@example.org', name: 'Nimal Perera' }] };
      if (path === '/api/contacts/lookup') return { results: [{ kind: 'contact', id: 3, name: 'Nimal P', email: 'nimal@example.org' }, { kind: 'employee', id: 4, name: 'Nimali', email: 'nimali@example.com' }] };
      throw new ApiError(404, path, null);
    }) as never);
    function Field() {
      const [v, setV] = useState('');
      return <RecipientField label="To" value={v} onChange={setV} names={{}} onName={() => undefined} />;
    }
    render(<Field />);
    fireEvent.change(screen.getByRole('combobox', { name: 'To' }), { target: { value: 'Nim' } });
    const list = await screen.findByRole('listbox', { name: 'Suggestions' });
    const options = within(list).getAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual([expect.stringContaining('Nimal Perera'), expect.stringContaining('Nimali')]);
    fireEvent.click(within(options[0]!).getByRole('button', { name: 'Remove nimal@example.org from suggestions' }));
    await waitFor(() => expect(apiDelete).toHaveBeenCalledWith('/api/mail/autocomplete', { email: 'nimal@example.org' }));
    expect(within(list).getAllByRole('option')).toHaveLength(1);
  });
});

describe('My Day (DMO-TSK-04, DMO-CAL-05/07)', () => {
  it('lists the week’s events, flagged mail and tasks due, and takes a dropped message', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-05T04:00:00Z')); // 09:30 in Colombo
    vi.mocked(apiGetMeta).mockReset().mockImplementation((async (path: string) => {
      if (path === '/api/calendar/events') return { data: { events: [{ source: 'event', id: 1, title: 'Site visit', start_at: '2026-10-05 10:30:00', end_at: '2026-10-05 12:00:00', all_day: false, color: null, editable: true }] }, offline: false, cachedAt: null };
      if (path === '/api/tasks') return { data: { tasks: [{ id: 9, title: 'Send BOQ', status: 'todo', archived: false, due_date: '2026-10-04' }, { id: 10, title: 'Done one', status: 'done', archived: false, due_date: '2026-10-05' }] }, offline: false, cachedAt: null };
      throw new ApiError(404, path, null);
    }) as never);
    vi.mocked(apiGet).mockReset().mockImplementation((async (path: string) => {
      if (path === '/api/mail/states') return { pins: {}, snoozed: {}, returned: {}, focus: {}, categories: {}, flags: { '4:inbox:7': { mailbox: 4, folder: 'inbox', uid: '7', start_at: null, due_at: '2026-10-05 11:30:00', reminder_at: null, completed_at: null, task_id: 2, subject: 'Approve the plan', from_name: 'Pat', from_email: 'pat@client.example' } } };
      throw new ApiError(404, path, null);
    }) as never);
    const open = vi.fn();
    const drop = vi.fn();
    wrap(<TodoPane canCalendar canTasks onClose={vi.fn()} onOpenFlag={open} onDropMail={drop} />);
    const pane = screen.getByRole('complementary', { name: 'My Day' });
    expect(await within(pane).findByText('Site visit')).toBeTruthy();
    expect(within(pane).getByText('Today · 10:30–12:00')).toBeTruthy();
    expect(await within(pane).findByText('Send BOQ')).toBeTruthy();
    expect(within(pane).queryByText('Done one')).toBeNull();
    fireEvent.click(await within(pane).findByText('Approve the plan'));
    expect(open).toHaveBeenCalledWith({ mailbox: 4, folder: 'inbox', uid: '7' });

    const data = new Map<string, string>([[MAIL_DRAG, '4:inbox:11']]);
    const dt = { types: [MAIL_DRAG], getData: (k: string) => data.get(k) ?? '', dropEffect: 'none' };
    const tasks = within(pane).getByRole('region', { name: 'Tasks due' });
    fireEvent.dragOver(tasks, { dataTransfer: dt });
    fireEvent.drop(tasks, { dataTransfer: dt });
    expect(drop).toHaveBeenCalledWith('4:inbox:11', 'task');
    fireEvent.drop(within(pane).getByRole('region', { name: 'Calendar' }), { dataTransfer: dt });
    expect(drop).toHaveBeenCalledWith('4:inbox:11', 'event');
  });

  it('puts an event made from a message in the next half hour on the WorkSuite clock', () => {
    expect(nextSlot(new Date('2026-10-05T04:00:00Z'))).toEqual({ date: '2026-10-05', start: '10:00', end: '10:30' });
    expect(nextSlot(new Date('2026-10-05T18:25:00Z'))).toEqual({ date: '2026-10-06', start: '09:00', end: '09:30' });
  });
});

describe('automatic replies (DMO-OOF-01/02, AC-DMO-09)', () => {
  const RULES = { server_rules: { available: true, reason: null }, vacation: { enabled: true, subject: 'Away', message: 'Back Monday', start_date: null, end_date: '2026-10-12', external_audience: 'same', external_subject: null, external_message: null }, filters: [] };

  it('can answer people outside the organisation differently', async () => {
    vi.mocked(apiGet).mockReset().mockImplementation((async (path: string) => {
      if (path === '/api/mail/rules') return RULES;
      throw new ApiError(404, path, null);
    }) as never);
    wrap(<Rules mailbox="4" />);
    const box = await screen.findByRole('region', { name: 'Automatic reply' });
    expect(within(box).queryByLabelText('Message to people outside')).toBeNull();
    fireEvent.click(within(box).getByRole('combobox', { name: 'People outside your organisation' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Only your contacts get a separate reply' }));
    fireEvent.change(within(box).getByLabelText('Message to people outside'), { target: { value: 'I reply next week' } });
    fireEvent.click(within(box).getByRole('button', { name: 'Save automatic reply' }));
    await waitFor(() => expect(apiPut).toHaveBeenCalledWith('/api/mail/rules/vacation', expect.objectContaining({ external_audience: 'contacts', external_message: 'I reply next week', mailbox: '4' })));
  });

  const BOX = { id: 4, email: 'me@example.test', display_name: 'me', shared: false, unread: 0, in_unified: true, is_default: true, provider: 'office365', provider_label: 'Microsoft 365', colour: 'blue', auth_state: 'ok' };
  function Page() {
    const [route, setRoute] = useState('/mail');
    return (
      <TabProvider tabId="t" route={route} active onGo={setRoute}>
        <MailPage active tabId="t" route={route} />
      </TabProvider>
    );
  }

  it('shows a banner in Mail while they are on, with Turn off; My Day opens from the edge', async () => {
    app.set({ status: { network: 'ONLINE' } as never, prefs: { mailCacheDays: 30, moduleNotifications: {}, badgeCount: true, theme: 'light' } as never, bootstrap: { user: { id: '9', name: 'Me', email: 'me@example.test' } } as never, apps: [] });
    vi.mocked(apiGet).mockReset().mockImplementation((async (path: string) => {
      if (path === '/api/mail/mailboxes') return { mailboxes: [BOX] };
      if (path === '/api/mail/prefs') return { prefs: { firstRun: 'done', focused: false } };
      if (path === '/api/mail/rules') return RULES;
      if (path === '/api/mail/folders') return { folders: [{ id: 1, name: 'Inbox', slug: 'inbox', type: 'system', total: 1, unread: 0 }] };
      if (path === '/api/mail/sync/status') return { enabled: true, mailboxes: [], accounts: [] };
      throw new ApiError(404, path, null);
    }) as never);
    vi.mocked(apiGetMeta).mockReset().mockImplementation((async (path: string) => {
      if (path === '/api/mail/messages') return { data: { messages: [row(11)], total: 1, has_more: false }, offline: false, cachedAt: null };
      throw new ApiError(404, path, null);
    }) as never);
    vi.mocked(call).mockReset().mockImplementation((async (channel: string) => (channel === 'offline:pending' ? [] : null)) as never);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-05T04:00:00Z'));
    wrap(<Page />);
    const banner = await screen.findByText('Automatic replies are on until Monday 12 Oct.');
    fireEvent.click(within(banner.closest('[role="status"]') as HTMLElement).getByRole('button', { name: 'Turn off' }));
    await waitFor(() => expect(apiPut).toHaveBeenCalledWith('/api/mail/rules/vacation', expect.objectContaining({ enabled: false, subject: 'Away' })));

    fireEvent.click(screen.getByRole('button', { name: 'Open My Day' }));
    await waitFor(() => expect(apiPut).toHaveBeenCalledWith('/api/mail/prefs', { todoPane: true }));
    await act(async () => undefined);
  });
});

describe('external and first-time senders (DMO-SEC-01)', () => {
  it('tags mail from outside the organisation and says when a sender is new, once the context has answered', () => {
    const ctx = (over: Partial<MessageContext['sender'] & object> = {}, total = 5) => ({ sender: { email: 'x', name: null, contact_id: null, user_id: null, is_colleague: false, company: null, ...over }, history: { total, first: null, last: null, messages: [] } });
    expect(senderNotice('pat@client.example', 'asha@example.com', ctx())).toEqual({ external: true, rare: false });
    expect(senderNotice('omar@example.com', 'asha@example.com', ctx())).toEqual({ external: false, rare: false });
    expect(senderNotice('omar@other.example', 'asha@example.com', ctx({ is_colleague: true }))).toEqual({ external: false, rare: false });
    expect(senderNotice('new@client.example', 'asha@example.com', ctx({}, 1))).toEqual({ external: true, rare: true });
    expect(senderNotice('new@client.example', 'asha@example.com', null)).toEqual({ external: false, rare: false });
  });
});

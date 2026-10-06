// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type * as CoreApi from '../../../src/core/api';
import type * as AttachmentViewer from '../../../src/modules/chat/AttachmentViewer';

/**
 * Several staff in one website chat on the desktop (WS-WCHAT ENH-WCHAT-03, TEAM-UI-01/02): who is in the chat, Invite
 * and Transfer, a note only staff see, the Internal note tab, the owner who cannot leave alone, and the notice when an
 * invitation is declined. The server is stubbed; every rule is its own.
 */
let listeners: Array<(e: unknown) => void> = [];
const realtime = (e: unknown) => listeners.forEach((cb) => cb(e));
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiPost: vi.fn(async () => ({})), request: vi.fn(async () => ({ data: {} })) }));
vi.mock('../../../src/core/bridge', () => ({
  call: vi.fn(async () => []),
  on: (channel: string, cb: (e: unknown) => void) => {
    if (channel !== 'realtime:event') return () => undefined;
    listeners.push(cb);
    return () => {
      listeners = listeners.filter((x) => x !== cb);
    };
  },
  errorMessage: (e: unknown) => String(e),
  isMac: false,
  registerDropped: vi.fn(),
}));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));
// The shared composer, stood in for: its tabs (`extras`) drawn, and which mode it is in (C-08: one box, note mode).
vi.mock('../../../src/modules/chat/Composer', () => ({
  websiteNoteDraftKey: (id: number) => ({ module: 'website-chat', context: `conversation:${id}:note` }),
  Composer: (p: { extras?: ReactNode; website?: { note?: boolean } }) => (
    <div>
      {p.extras}
      <div>{p.website?.note ? 'The note composer' : 'The composer'}</div>
    </div>
  ),
}));
vi.mock('../../../src/modules/chat/window', () => ({ openWebsiteChatWindow: vi.fn(async () => undefined) }));
vi.mock('../../../src/modules/chat/AttachmentViewer', async (orig) => ({ ...(await orig<typeof AttachmentViewer>()), openChatAttachment: vi.fn() }));
vi.mock('../../../src/core/tab-context', () => ({
  useTab: () => ({ query: new URLSearchParams('view=website&website=41'), path: ['chat'], go: vi.fn(), active: true, openLink: vi.fn() }),
  useTabTitle: () => undefined,
}));

import { apiGet, request } from '../../../src/core/api';
import { app } from '../../../src/core/app-state';
import { toast } from '../../../src/core/toasts';
import type { WebsiteConversation, WebsiteTeam } from '../../../src/modules/chat/website/api';
import { WebsiteThread } from '../../../src/modules/chat/website/WebsiteThread';

const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const teamOf = (over: Partial<WebsiteTeam> = {}): WebsiteTeam => ({
  people: [
    { user_id: 3, name: 'Samali Perera', avatar: null, role: 'owner', joined_at: ago(300_000) },
    { user_id: 7, name: 'Nimal Silva', avatar: null, role: 'participant', invited_by: 3, invited_by_name: 'Samali Perera', joined_at: ago(120_000) },
  ],
  pending: [{ id: 51, kind: 'invite', mode: 'warm', from: 3, from_name: 'Samali Perera', to: 'Kasun Jayasuriya', to_users: [8], note: null, expires_at: ago(-90_000), created_at: ago(30_000) }],
  my_role: 'owner',
  max: 4,
  transfer_count: 0,
  can: { invite: true, transfer: true, leave: false, remove: true, note: true, monitor: false, join: false, take_over: false },
  ...over,
});
let team: WebsiteTeam = teamOf();
const conversation = (): WebsiteConversation => ({
  conversation: { id: 41, widget: 'TechHub', website: 'techubiz.com', status: 'open', is_offline: false, inactive: false, assigned_to: 3, visitor_typing: false, started_at: ago(600_000), closed_at: null, rating: null, rating_comment: null, tags: null, is_starred: false },
  visitor: {
    id: 9, label: 'Visitor 4F2A', name: null, email: null, phone: null, company: null, browser: null, os: null, device: null, language: null, timezone: null,
    country: null, city: null, landing_page: null, current_url: null, current_title: null, referrer: null, utm_source: null, utm_campaign: null, visits: 1, first_seen: null, last_seen: ago(10_000), is_blocked: false,
  },
  messages: [
    { id: 1, body: 'Is the licence yearly?', from: 'visitor', agent: null, at: ago(300_000), file: null },
    { id: 2, body: 'Samali Perera joined the chat', from: 'system', agent: 'Samali Perera', at: ago(290_000), file: null, visibility: 'public' },
    { id: 3, body: 'Samali Perera invited Kasun Jayasuriya', from: 'system', agent: 'Samali Perera', at: ago(100_000), file: null, visibility: 'internal' },
    { id: 4, body: 'It is yearly.', from: 'agent', agent: 'Samali Perera', agent_id: 3, at: ago(90_000), file: null, visibility: 'public' },
    { id: 5, body: 'And renewals are 20% off.', from: 'agent', agent: 'Samali Perera', agent_id: 3, at: ago(80_000), file: null, visibility: 'public' },
    { id: 6, body: 'Can we match last year\'s price?', from: 'agent', agent: 'Nimal Silva', agent_id: 7, at: ago(60_000), file: null, visibility: 'internal' },
  ],
  journey: [],
  history: [],
  team,
  can: { view: true, reply: true, manage: false },
});
const AGENTS = {
  agents: [
    { id: 3, name: 'Samali Perera', email: 's@x', status: 'available', open_chats: 2, department_id: 1, department: 'Sales', on_staff: true, in_chat: 'owner' },
    { id: 7, name: 'Nimal Silva', email: 'n@x', status: 'available', open_chats: 1, department_id: 1, department: 'Sales', on_staff: true, in_chat: 'participant' },
    { id: 8, name: 'Kasun Jayasuriya', email: 'k@x', status: 'busy', open_chats: 4, department_id: 2, department: 'Billing', on_staff: false, in_chat: null },
    { id: 10, name: 'Amaya Silva', email: 'a@x', status: 'available', open_chats: 0, department_id: 2, department: 'Billing', on_staff: true, in_chat: null },
    { id: 11, name: 'Ruwan Offline', email: 'r@x', status: 'offline', open_chats: 0, department_id: null, department: null, on_staff: true, in_chat: null },
  ],
  departments: [{ id: 1, name: 'Sales', available: 2 }, { id: 2, name: 'Billing', available: 1 }],
};

beforeEach(() => {
  Element.prototype.scrollTo = vi.fn();
  team = teamOf();
  listeners = [];
  app.set({ auth: { stage: 'ready', user: { id: '3' } } as never });
  vi.mocked(apiGet).mockReset().mockImplementation((async (path: string) => {
    if (path === '/api/chat/widget-admin/conversations/41') return conversation();
    if (path === '/api/chat/widget-admin/canned') return { responses: [] };
    if (path === '/api/chat/widget-admin/agents') return AGENTS;
    throw new Error(`unexpected ${path}`);
  }) as never);
  vi.mocked(request).mockReset().mockResolvedValue({ data: {} } as never);
  vi.mocked(toast).mockReset();
});
afterEach(() => cleanup());

const mount = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <WebsiteThread id="41" />
    </QueryClientProvider>,
  );

describe('who is in the chat (TEAM-UI-01)', () => {
  it('shows the faces, each person\'s role and who invited them, what is pending, and the owner\'s Remove and Cancel', async () => {
    mount();
    const panel = await screen.findByRole('region', { name: 'In this chat' });
    // Two in it and one invited (C-08): three rows; the invitation rings down.
    expect(within(panel).getByText('In this chat')).toBeTruthy();
    expect(within(panel).getByTitle('2 of at most 4 staff').textContent).toBe('3');
    expect(within(panel).getByText('Owner')).toBeTruthy();
    expect(within(panel).getByText(/invited by Samali Perera/)).toBeTruthy();
    expect(within(panel).getByText('Kasun Jayasuriya')).toBeTruthy();
    expect(within(panel).getByText(/^Invited · 1:\d\d$/)).toBeTruthy();
    expect(screen.getByLabelText('In this chat: Samali Perera (owner), Nimal Silva')).toBeTruthy();

    fireEvent.click(within(panel).getByRole('button', { name: 'Remove Nimal Silva from the chat' }));
    await waitFor(() => expect(request).toHaveBeenCalledWith('DELETE', '/api/chat/widget-admin/conversations/41/participants/7'));
    fireEvent.click(within(panel).getByRole('button', { name: 'Cancel the invitation to Kasun Jayasuriya' }));
    await waitFor(() => expect(request).toHaveBeenCalledWith('DELETE', '/api/chat/widget-admin/handoffs/51'));
  });

  it('names each person on their first message in a run, and marks what only staff see', async () => {
    mount();
    await screen.findByText('It is yearly.');
    // Samali (me) signs her first reply once, as "You" (C-08); her second runs on.
    expect(screen.getByText('It is yearly.').closest('[data-bubble]')!.textContent).toMatch(/^You/);
    expect(screen.getByText('And renewals are 20% off.').closest('[data-bubble]')!.textContent).not.toMatch(/^You/);
    const note = screen.getByText('Can we match last year\'s price?');
    // The shared kit's note bubble (C-02, #229): amber and dashed, labelled above.
    expect(note.closest('[data-bubble-body]')!.className).toContain('border-dashed');
    expect(note.closest('[data-bubble]')!.textContent).toContain('Internal note · Nimal · only staff see this');
    expect(screen.getByText(/Samali Perera invited Kasun Jayasuriya/).getAttribute('title')).toBe('Only staff see this');
  });

  it('the owner cannot leave alone: offered Transfer or Close (AC-T07)', async () => {
    team = teamOf({ can: { ...teamOf().can, leave: false } });
    mount();
    await screen.findByRole('region', { name: 'In this chat' });
    // At the panel's foot, with the owner's warning (C-08).
    expect(screen.getByText('You own this chat — transfer it before you leave.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Leave chat' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Transfer the chat to a colleague first, or close it/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Transfer' }));
    expect(await screen.findByRole('dialog', { name: 'Transfer this chat' })).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: 'You own this chat' })).toBeNull();
    expect(request).not.toHaveBeenCalledWith('POST', '/api/chat/widget-admin/conversations/41/leave');
  });

  it('a participant leaves; a supervisor can monitor, join or take over', async () => {
    team = teamOf({ my_role: 'participant', can: { invite: true, transfer: false, leave: true, remove: false, note: true, monitor: false, join: false, take_over: true } });
    mount();
    const panel = await screen.findByRole('region', { name: 'In this chat' });
    expect(screen.queryByRole('button', { name: 'Transfer' })).toBeNull();
    expect(screen.queryByText('You own this chat — transfer it before you leave.')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Leave chat' }));
    await waitFor(() => expect(request).toHaveBeenCalledWith('POST', '/api/chat/widget-admin/conversations/41/leave'));
    fireEvent.click(within(panel).getByRole('button', { name: 'Take over' }));
    await waitFor(() => expect(request).toHaveBeenCalledWith('POST', '/api/chat/widget-admin/conversations/41/take-over'));
  });
});

describe('Invite and Transfer (TEAM-UI-02)', () => {
  it('invites colleagues with a note: availability, open chats and department shown, offline and already-in not pickable', async () => {
    mount();
    // In the header beside Close, and as Invite someone in the "In this chat" panel.
    await screen.findByRole('region', { name: 'In this chat' });
    expect(screen.getAllByRole('button', { name: /^Invite( someone)?$/ })).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Invite' }));
    const dialog = await screen.findByRole('dialog', { name: 'Invite to this chat' });
    await within(dialog).findByText('Kasun Jayasuriya');
    expect(within(dialog).getByText("Busy · 4 chats · Billing · not on this site's staff")).toBeTruthy();
    const boxes = within(dialog).getAllByRole('checkbox') as HTMLInputElement[];
    const byName = (n: string) => boxes.find((b) => b.closest('label')!.textContent!.includes(n))!;
    expect(byName('Ruwan Offline').disabled).toBe(true);
    expect(byName('Nimal Silva').disabled).toBe(true);
    expect(byName('Nimal Silva').closest('label')!.textContent).toContain('Already in this chat');

    fireEvent.click(byName('Kasun Jayasuriya'));
    fireEvent.click(byName('Amaya Silva'));
    fireEvent.change(within(dialog).getByRole('textbox', { name: /Note for them/ }), { target: { value: 'Education pricing, please.' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Invite 2 people' }));
    await waitFor(() => expect(request).toHaveBeenCalledWith('POST', '/api/chat/widget-admin/conversations/41/invites', { body: { user_ids: [8, 10], note: 'Education pricing, please.' } }));
    expect(apiGet).toHaveBeenCalledWith('/api/chat/widget-admin/agents', { conversation_id: '41' }, expect.anything());
  });

  it('says the server\'s refusal in its own words', async () => {
    const { ApiError } = await vi.importActual<typeof CoreApi>('../../../src/core/api');
    // Only the invitation is refused: the thread's read of its saved copy (#239) goes through `request` too.
    vi.mocked(request).mockImplementation((async (method: string) => {
      if (method === 'POST') throw new ApiError(409, 'A chat can have 4 staff at most, owner included: this one has 4.', null);
      return { data: {} };
    }) as never);
    mount();
    await screen.findByRole('region', { name: 'In this chat' });
    fireEvent.click(screen.getByRole('button', { name: 'Invite someone' }));
    const dialog = await screen.findByRole('dialog', { name: 'Invite to this chat' });
    fireEvent.click((await within(dialog).findByText('Amaya Silva')).closest('label')!.querySelector('input')!);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Invite 1 person' }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith('error', 'A chat can have 4 staff at most, owner included: this one has 4.'));
  });

  it('transfers to a colleague warm by default, or hands over now to a department', async () => {
    mount();
    await screen.findByRole('region', { name: 'In this chat' });
    fireEvent.click(screen.getAllByRole('button', { name: /Transfer$/ })[0]!);
    let dialog = await screen.findByRole('dialog', { name: 'Transfer this chat' });
    const amaya = (await within(dialog).findByText('Amaya Silva')).closest('label')!.querySelector('input')!;
    fireEvent.click(amaya);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Transfer' }));
    await waitFor(() => expect(request).toHaveBeenCalledWith('POST', '/api/chat/widget-admin/conversations/41/transfer', { body: { to_user_id: 10, mode: 'warm' } }));

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Transfer this chat' })).toBeNull());
    fireEvent.click(screen.getAllByRole('button', { name: /Transfer$/ })[0]!);
    dialog = await screen.findByRole('dialog', { name: 'Transfer this chat' });
    fireEvent.click(within(dialog).getByRole('radio', { name: 'A department' }));
    fireEvent.click(within(dialog).getByRole('combobox', { name: 'Department' }));
    fireEvent.click(screen.getByRole('option', { name: 'Billing · 1 available' }));
    fireEvent.click(within(dialog).getByText('Hand over now'));
    expect(within(dialog).getByText('You leave at once; it rings for the Billing team until someone joins.')).toBeTruthy();
    fireEvent.change(within(dialog).getByRole('textbox', { name: /Handover note/ }), { target: { value: 'Refund for invoice 1182' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Transfer' }));
    await waitFor(() => expect(request).toHaveBeenCalledWith('POST', '/api/chat/widget-admin/conversations/41/transfer', { body: { department_id: 2, mode: 'cold', note: 'Refund for invoice 1182' } }));
  });
});

describe('the Internal note tab (TEAM-60, TEAM-61)', () => {
  it('switches the one shared composer between the visitor and a note only staff see', async () => {
    mount();
    expect(await screen.findByText('The composer')).toBeTruthy();
    fireEvent.click(await screen.findByRole('tab', { name: 'Internal note' }));
    expect(screen.getByText('The note composer')).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Internal note' }).getAttribute('aria-selected')).toBe('true');
    fireEvent.click(screen.getByRole('tab', { name: 'Reply to visitor' }));
    expect(screen.getByText('The composer')).toBeTruthy();
  });
});

describe('a declined invitation comes back to whoever sent it (TEAM-24, WF-T2)', () => {
  it('says so in the thread, with Try someone else', async () => {
    mount();
    await screen.findByRole('region', { name: 'In this chat' });
    act(() => realtime({ type: 'chat.widget.handoff.resolved', handoff_id: 51, conversation_id: 41, status: 'declined', by: 8, by_name: 'Kasun Jayasuriya', visitor: 'Visitor 4F2A' }));
    const notice = await screen.findByText((_, el) => el?.getAttribute('role') === 'status' && !!el.textContent?.startsWith('Kasun Jayasuriya declined — Visitor 4F2A is still yours.'));
    expect(within(notice).getByText('Visitor 4F2A').tagName).toBe('B');
    fireEvent.click(screen.getByRole('button', { name: 'Try someone else' }));
    expect(await screen.findByRole('dialog', { name: 'Invite to this chat' })).toBeTruthy();
  });

  it('a removed person is told, and what they were writing to the visitor is dropped (TEAM-07)', async () => {
    const { call } = await import('../../../src/core/bridge');
    mount();
    await screen.findByRole('region', { name: 'In this chat' });
    act(() => realtime({ type: 'chat.widget.participants', conversation_id: 41, what: 'removed', text: 'Samali Perera removed you from the chat' }));
    expect(toast).toHaveBeenCalledWith('info', 'Samali Perera removed you from the chat');
    expect(call).toHaveBeenCalledWith('offline:deleteDraft', { module: 'website-chat', context: 'conversation:41' });
    expect(call).toHaveBeenCalledWith('offline:deleteDraft', { module: 'website-chat', context: 'conversation:41:note' });
  });
});

// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';

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
vi.mock('../../../src/modules/chat/Composer', () => ({ Composer: () => <div>The composer</div> }));
vi.mock('../../../src/modules/chat/window', () => ({ openWebsiteChatWindow: vi.fn(async () => undefined) }));
vi.mock('../../../src/modules/chat/AttachmentViewer', () => ({ openChatAttachment: vi.fn() }));
vi.mock('../../../src/core/tab-context', () => ({
  useTab: () => ({ query: new URLSearchParams('view=website&website=41'), path: ['chat'], go: vi.fn(), active: true, openLink: vi.fn() }),
  useTabTitle: () => undefined,
}));

import { apiGet, request } from '../../../src/core/api';
import { app } from '../../../src/core/app-state';
import { toast } from '../../../src/core/toasts';
import type { WebsiteConversation, WebsiteTeam } from '../../../src/modules/chat/website/api';
import { mentionQuery } from '../../../src/modules/chat/website/Team';
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
    expect(within(panel).getByText('In this chat · 2/4')).toBeTruthy();
    expect(within(panel).getByText('Owner')).toBeTruthy();
    expect(within(panel).getByText(/invited by Samali Perera/)).toBeTruthy();
    expect(within(panel).getByText('Invited Kasun Jayasuriya')).toBeTruthy();
    expect(screen.getByLabelText('In this chat: Samali Perera (owner), Nimal Silva')).toBeTruthy();

    fireEvent.click(within(panel).getByRole('button', { name: 'Remove Nimal Silva from the chat' }));
    await waitFor(() => expect(request).toHaveBeenCalledWith('DELETE', '/api/chat/widget-admin/conversations/41/participants/7'));
    fireEvent.click(within(panel).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(request).toHaveBeenCalledWith('DELETE', '/api/chat/widget-admin/handoffs/51'));
  });

  it('names each person on their first message in a run, and marks what only staff see', async () => {
    mount();
    await screen.findByText('It is yearly.');
    // Samali signs her first reply once; her second runs on.
    expect(screen.getAllByText('Samali Perera').length).toBeGreaterThanOrEqual(1);
    const note = screen.getByText('Can we match last year\'s price?');
    expect(note.className).toContain('border-dashed');
    expect(note.parentElement!.parentElement!.textContent).toContain('Only staff see this');
    expect(screen.getByText(/Samali Perera invited Kasun Jayasuriya/).getAttribute('title')).toBe('Only staff see this');
  });

  it('the owner cannot leave alone: offered Transfer or Close (AC-T07)', async () => {
    team = teamOf({ can: { ...teamOf().can, leave: false } });
    mount();
    const panel = await screen.findByRole('region', { name: 'In this chat' });
    fireEvent.click(within(panel).getByRole('button', { name: 'Leave chat' }));
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
    fireEvent.click(within(panel).getByRole('button', { name: 'Leave chat' }));
    await waitFor(() => expect(request).toHaveBeenCalledWith('POST', '/api/chat/widget-admin/conversations/41/leave'));
    fireEvent.click(within(panel).getByRole('button', { name: 'Take over' }));
    await waitFor(() => expect(request).toHaveBeenCalledWith('POST', '/api/chat/widget-admin/conversations/41/take-over'));
  });
});

describe('Invite and Transfer (TEAM-UI-02)', () => {
  it('invites colleagues with a note: availability, open chats and department shown, offline and already-in not pickable', async () => {
    mount();
    // In the header beside Close, and in the "In this chat" panel.
    await screen.findByRole('region', { name: 'In this chat' });
    expect(screen.getAllByRole('button', { name: /Invite$/ })).toHaveLength(2);
    fireEvent.click(screen.getAllByRole('button', { name: /Invite$/ })[0]!);
    const dialog = await screen.findByRole('dialog', { name: 'Invite to this chat' });
    await within(dialog).findByText('Kasun Jayasuriya');
    expect(within(dialog).getByText("Busy · 4 open chats · Billing · not on this site's staff")).toBeTruthy();
    const boxes = within(dialog).getAllByRole('checkbox') as HTMLInputElement[];
    const byName = (n: string) => boxes.find((b) => b.closest('label')!.textContent!.includes(n))!;
    expect(byName('Ruwan Offline').disabled).toBe(true);
    expect(byName('Nimal Silva').disabled).toBe(true);
    expect(byName('Nimal Silva').closest('label')!.textContent).toContain('Already in this chat');

    fireEvent.click(byName('Kasun Jayasuriya'));
    fireEvent.click(byName('Amaya Silva'));
    fireEvent.change(within(dialog).getByRole('textbox', { name: /Note for them/ }), { target: { value: 'Education pricing, please.' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Invite 2' }));
    await waitFor(() => expect(request).toHaveBeenCalledWith('POST', '/api/chat/widget-admin/conversations/41/invites', { body: { user_ids: [8, 10], note: 'Education pricing, please.' } }));
    expect(apiGet).toHaveBeenCalledWith('/api/chat/widget-admin/agents', { conversation_id: '41' }, expect.anything());
  });

  it('says the server\'s refusal in its own words', async () => {
    const { ApiError } = await vi.importActual<typeof CoreApi>('../../../src/core/api');
    vi.mocked(request).mockRejectedValueOnce(new ApiError(409, 'A chat can have 4 staff at most, owner included: this one has 4.', null));
    mount();
    await screen.findByRole('region', { name: 'In this chat' });
    fireEvent.click(screen.getAllByRole('button', { name: /Invite$/ })[1]!);
    const dialog = await screen.findByRole('dialog', { name: 'Invite to this chat' });
    fireEvent.click((await within(dialog).findByText('Amaya Silva')).closest('label')!.querySelector('input')!);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Invite' }));
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
    fireEvent.change(within(dialog).getByRole('textbox', { name: /Handover note/ }), { target: { value: 'Refund for invoice 1182' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Hand over now' }));
    await waitFor(() => expect(request).toHaveBeenCalledWith('POST', '/api/chat/widget-admin/conversations/41/transfer', { body: { department_id: 2, mode: 'cold', note: 'Refund for invoice 1182' } }));
  });
});

describe('the Internal note tab (TEAM-60, TEAM-61)', () => {
  it('writes a note only staff see, @mentioning a colleague, never through the visitor\'s reply', async () => {
    mount();
    fireEvent.click(await screen.findByRole('tab', { name: 'Internal note' }));
    expect(screen.queryByText('The composer')).toBeNull();
    expect(screen.getByText(/Only staff see this · the visitor never does/)).toBeTruthy();
    const box = screen.getByRole('textbox', { name: 'Internal note' }) as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: 'Can we match it, @Ka', selectionStart: 20 } });
    const option = await screen.findByRole('option', { name: /Kasun Jayasuriya/ });
    fireEvent.mouseDown(within(option).getByRole('button'));
    expect(box.value).toBe('Can we match it, @Kasun ');
    fireEvent.change(box, { target: { value: 'Can we match it, @Kasun?' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    await waitFor(() => expect(request).toHaveBeenCalledWith('POST', '/api/chat/widget-admin/conversations/41/note', { body: { message: 'Can we match it, @Kasun?', mentions: [8] } }));
    fireEvent.click(screen.getByRole('tab', { name: 'Reply to visitor' }));
    expect(screen.getByText('The composer')).toBeTruthy();
  });

  it('finds the @word being typed', () => {
    expect(mentionQuery('Hi @Sam', 7)).toEqual({ start: 3, word: 'sam' });
    expect(mentionQuery('email@example', 13)).toBeNull();
    expect(mentionQuery('@', 1)).toEqual({ start: 0, word: '' });
  });
});

describe('a declined invitation comes back to whoever sent it (TEAM-24, WF-T2)', () => {
  it('says so in the thread, with Try someone else', async () => {
    mount();
    await screen.findByRole('region', { name: 'In this chat' });
    act(() => realtime({ type: 'chat.widget.handoff.resolved', handoff_id: 51, conversation_id: 41, status: 'declined', by: 8, by_name: 'Kasun Jayasuriya', visitor: 'Visitor 4F2A' }));
    expect(await screen.findByText('Kasun Jayasuriya declined — Visitor 4F2A is still in your chat.')).toBeTruthy();
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
  });
});

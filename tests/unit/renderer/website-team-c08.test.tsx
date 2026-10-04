// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';
import type * as AttachmentViewer from '../../../src/modules/chat/AttachmentViewer';

/**
 * C-08 "Several staff in one chat, internal note" (TEAM-UI-01, X-UI-07; TEAM-04/05/06, TEAM-60/61, UX-DRW-03), on the
 * real shared composer: its Internal note mode (amber, words only, @ a colleague, straight to the server, typing only
 * colleagues see); the people card — presence, the countdown by the server's clock, Invite someone at the limit, its
 * place at the head of the panel — the owner's warning; the bubbles named "You" and tinted per colleague.
 */
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiPost: vi.fn(async () => ({})), request: vi.fn(async () => ({ data: {} })) }));
vi.mock('../../../src/core/bridge', () => ({
  call: vi.fn(),
  on: () => () => undefined,
  errorMessage: (e: unknown) => String(e),
  isMac: false,
  registerDropped: vi.fn(),
}));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));
vi.mock('../../../src/modules/chat/window', () => ({ openWebsiteChatWindow: vi.fn(async () => undefined) }));
vi.mock('../../../src/modules/chat/AttachmentViewer', async (orig) => ({ ...(await orig<typeof AttachmentViewer>()), openChatAttachment: vi.fn() }));
vi.mock('../../../src/core/tab-context', () => ({
  useTab: () => ({ query: new URLSearchParams('view=website&website=41'), path: ['chat'], go: vi.fn(), active: true, openLink: vi.fn() }),
  useTabTitle: () => undefined,
}));

import { apiGet, apiPost, request } from '../../../src/core/api';
import { app } from '../../../src/core/app-state';
import { call } from '../../../src/core/bridge';
import { toast } from '../../../src/core/toasts';
import { Composer, websiteNoteDraftKey } from '../../../src/modules/chat/Composer';
import type { WebsiteConversation, WebsiteTeam } from '../../../src/modules/chat/website/api';
import { countdown, secondsLeft } from '../../../src/modules/chat/website/Team';
import { WebsiteThread } from '../../../src/modules/chat/website/WebsiteThread';

const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const AGENTS = {
  agents: [
    { id: 3, name: 'Nuwan Silva', email: 'n@x', status: 'available', open_chats: 2, department: 'Sales', on_staff: true, in_chat: 'owner' },
    { id: 7, name: 'Dilini Perera', email: 'd@x', status: 'available', open_chats: 1, department: 'Education', on_staff: true, in_chat: 'participant' },
    { id: 8, name: 'Kasun Jayasuriya', email: 'k@x', status: 'busy', open_chats: 4, department: 'Billing', on_staff: true, in_chat: null },
  ],
  departments: [],
};
const teamOf = (over: Partial<WebsiteTeam> = {}): WebsiteTeam => ({
  // Sent participant first, as an older server might: the header still puts the owner first.
  people: [
    { user_id: 7, name: 'Dilini Perera', avatar: null, role: 'participant', invited_by: 3, invited_by_name: 'Nuwan Silva', joined_at: ago(240_000), presence: 'away' },
    { user_id: 3, name: 'Nuwan Silva', avatar: null, role: 'owner', joined_at: ago(480_000), presence: 'online' },
  ],
  // The computer's clock is off: the expiry time says ten minutes, the server's count says 21 seconds.
  pending: [{ id: 51, kind: 'invite', mode: 'warm', from: 3, from_name: 'Nuwan Silva', to: 'Kasun J.', to_users: [8], note: null, expires_at: ago(-600_000), expires_in: 21, created_at: ago(99_000) }],
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
    id: 9, label: 'Visitor 4F2A', name: null, email: 'ravi@studio.lk', phone: null, company: null, browser: 'Chrome', os: 'Windows', device: null, language: null, timezone: null,
    country: 'LK', city: 'Colombo', landing_page: null, current_url: null, current_title: null, referrer: null, utm_source: null, utm_campaign: null, visits: 3, first_seen: null, last_seen: ago(10_000), is_blocked: false,
  },
  messages: [
    { id: 1, body: 'Can you send a quote for 5 seats with the education discount?', from: 'visitor', agent: null, at: ago(300_000), file: null },
    { id: 2, body: 'Dilini handles education licences — inviting her.', from: 'agent', agent: 'Nuwan Silva', agent_id: 3, at: ago(290_000), file: null, visibility: 'internal' },
    { id: 3, body: 'Hi! I look after education licences.', from: 'agent', agent: 'Dilini Perera', agent_id: 7, at: ago(200_000), file: null, visibility: 'public' },
    { id: 4, body: "I'll leave you with Dilini — she'll send the quote.", from: 'agent', agent: 'Nuwan Silva', agent_id: 3, at: ago(100_000), file: null, visibility: 'public' },
  ],
  journey: [],
  history: [],
  team,
  can: { view: true, reply: true, manage: false },
});

beforeEach(() => {
  Element.prototype.scrollTo = vi.fn();
  team = teamOf();
  app.set({ auth: { stage: 'ready', user: { id: '3' } }, transfers: [] } as never);
  vi.mocked(apiGet).mockReset().mockImplementation((async (path: string) => {
    if (path === '/api/chat/widget-admin/conversations/41') return conversation();
    if (path === '/api/chat/widget-admin/canned') return { responses: [{ id: 1, shortcut: 'edu', title: 'Education discount', body: 'Schools get 20% off.' }] };
    if (path === '/api/chat/widget-admin/agents') return AGENTS;
    if (path === '/api/chat/presence') return { presence: {} };
    throw new Error(`unexpected ${path}`);
  }) as never);
  vi.mocked(apiPost).mockReset().mockResolvedValue({} as never);
  vi.mocked(request).mockReset().mockResolvedValue({ data: {} } as never);
  vi.mocked(call).mockReset().mockImplementation((async (channel: string) => {
    if (channel === 'offline:getDraft') return null;
    if (channel === 'offline:pending') return [];
    if (channel === 'offline:submit') return { delivered: true, queued: false };
    return undefined;
  }) as never);
  vi.mocked(toast).mockReset();
});
afterEach(() => cleanup());

const wrap = (ui: React.ReactElement) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);

describe("the shared composer's Internal note mode (TEAM-60, TEAM-61)", () => {
  const mountNote = () =>
    wrap(<Composer roomId="website-41" roomName="Visitor 4F2A" group={false} reply={null} onClearReply={() => undefined} website={{ conversationId: 41, replies: [{ id: 1, shortcut: 'edu', title: 'Education discount', body: 'x' }], note: true }} />);

  it('is amber and words only, with no attach or saved replies, and keeps its own draft', async () => {
    mountNote();
    expect(screen.getByText(/Only staff see this · the visitor never does/)).toBeTruthy();
    const box = screen.getByRole('textbox', { name: 'Internal note' });
    expect(box.getAttribute('placeholder')).toBe('Write a note for your colleagues — @ to mention someone');
    expect(box.closest('[data-chat-composer] > div.relative')!.className).toContain('border-dashed');
    expect(screen.queryByRole('button', { name: 'Attach' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Saved replies' })).toBeNull();
    expect(screen.queryByLabelText('Saved replies')).toBeNull();
    expect(screen.getByRole('button', { name: 'Add note' })).toBeTruthy();
    await waitFor(() => expect(call).toHaveBeenCalledWith('offline:getDraft', websiteNoteDraftKey(41)));
    expect(websiteNoteDraftKey(41)).toEqual({ module: 'website-chat', context: 'conversation:41:note' });
  });

  it('@ names a colleague (never me), and Enter posts the note straight to the server with who was mentioned', async () => {
    mountNote();
    const box = screen.getByRole('textbox', { name: 'Internal note' }) as HTMLTextAreaElement;
    // Colleagues see the note being written; the visitor never does (LIVE-03).
    fireEvent.change(box, { target: { value: 'Can we match it, @', selectionStart: 18 } });
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/chat/widget-admin/conversations/41/typing', { state: 'start', internal: true }));
    const list = await screen.findByRole('listbox', { name: 'Mention someone' });
    expect(within(list).getByText('COLLEAGUES')).toBeTruthy();
    expect(within(list).queryByText('Nuwan Silva')).toBeNull();
    fireEvent.change(box, { target: { value: 'Can we match it, @Ka', selectionStart: 20 } });
    fireEvent.click(await screen.findByRole('option', { name: /Kasun Jayasuriya/ }));
    expect(box.value).toBe('Can we match it, @Kasun Jayasuriya ');
    fireEvent.change(box, { target: { value: 'Can we match it, @Kasun Jayasuriya?' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    await waitFor(() => expect(request).toHaveBeenCalledWith('POST', '/api/chat/widget-admin/conversations/41/note', { body: { message: 'Can we match it, @Kasun Jayasuriya?', mentions: [8] } }));
    expect(call).not.toHaveBeenCalledWith('offline:submit', expect.anything());
  });

  it('refuses a file: a note is words only', () => {
    mountNote();
    const box = screen.getByRole('textbox', { name: 'Internal note' });
    fireEvent.paste(box, { clipboardData: { files: [new File(['x'], 'shot.png', { type: 'image/png' })] } });
    expect(toast).toHaveBeenCalledWith('error', 'A note is words only. Attach files from Reply to visitor.');
  });
});

const mountThread = () => wrap(<WebsiteThread id="41" />);

describe('a chat with several staff in it (C-08, X-UI-07)', () => {
  it('the people card leads the panel: presence, roles, join times, the invitation counting down by the server, Cancel and Invite someone', async () => {
    mountThread();
    const card = await screen.findByRole('region', { name: 'In this chat' });
    const panel = screen.getByRole('complementary', { name: 'Visitor details' });
    // Above the visitor's card, as designed.
    expect(panel.textContent!.indexOf('In this chat')).toBeLessThan(panel.textContent!.indexOf('Visitor'));
    expect(within(card).getByTitle('2 of at most 4 staff').textContent).toBe('3');
    const nuwan = within(card).getByText('Nuwan Silva (you)').closest('li')!;
    expect(within(nuwan).getByText('Owner')).toBeTruthy();
    expect(within(nuwan).getByLabelText('Online')).toBeTruthy();
    const dilini = within(card).getByText('Dilini Perera').closest('li')!;
    expect(within(dilini).getByText('Participant')).toBeTruthy();
    expect(within(dilini).getByLabelText('Away')).toBeTruthy();
    expect(within(dilini).getByText(/invited by Nuwan Silva/)).toBeTruthy();
    const kasun = within(card).getByText('Kasun J.').closest('li')!;
    expect(within(kasun).getByText('KJ')).toBeTruthy();
    expect(within(kasun).getByText(/^Invited · 0:2[01]$/)).toBeTruthy();
    fireEvent.click(within(kasun).getByRole('button', { name: 'Cancel the invitation to Kasun J.' }));
    await waitFor(() => expect(request).toHaveBeenCalledWith('DELETE', '/api/chat/widget-admin/handoffs/51'));
    fireEvent.click(within(card).getByRole('button', { name: 'Invite someone' }));
    expect(await screen.findByRole('dialog', { name: 'Invite to this chat' })).toBeTruthy();
  });

  it('the owner is warned at the foot of the panel, and offered Transfer or Close on Leave chat', async () => {
    mountThread();
    await screen.findByRole('region', { name: 'In this chat' });
    expect(screen.getByRole('note').textContent).toBe('You own this chat — transfer it before you leave.');
    fireEvent.click(screen.getByRole('button', { name: 'Leave chat' }));
    const dialog = await screen.findByRole('dialog', { name: 'You own this chat' });
    expect(within(dialog).getByRole('button', { name: 'Close the chat' })).toBeTruthy();
    expect(request).not.toHaveBeenCalledWith('POST', '/api/chat/widget-admin/conversations/41/leave');
  });

  it('at the limit nobody more can be invited (TEAM-03)', async () => {
    team = teamOf({ max: 2 });
    mountThread();
    const card = await screen.findByRole('region', { name: 'In this chat' });
    const invite = within(card).getByRole('button', { name: 'Invite someone' }) as HTMLButtonElement;
    expect(invite.disabled).toBe(true);
    expect(invite.title).toBe('This chat has 2 staff in it, the most one chat can have.');
  });

  it('alone in a chat, the card follows the visitor\'s facts and there is no warning to a participant', async () => {
    team = teamOf({ people: [{ user_id: 3, name: 'Nuwan Silva', avatar: null, role: 'participant', joined_at: ago(1000), presence: 'online' }], pending: [], my_role: 'participant', can: { ...teamOf().can, leave: true } });
    mountThread();
    await screen.findByRole('region', { name: 'In this chat' });
    const panel = screen.getByRole('complementary', { name: 'Visitor details' });
    expect(panel.textContent!.indexOf('In this chat')).toBeGreaterThan(panel.textContent!.indexOf('Visitor'));
    expect(screen.queryByRole('note')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Leave chat' }));
    await waitFor(() => expect(request).toHaveBeenCalledWith('POST', '/api/chat/widget-admin/conversations/41/leave'));
  });

  it('header faces put the owner first; each staff message is named — mine "You", a colleague\'s tinted and with their photo', async () => {
    mountThread();
    await screen.findByText('Hi! I look after education licences.');
    expect(screen.getByLabelText('In this chat: Nuwan Silva (owner), Dilini Perera')).toBeTruthy();
    const hers = screen.getByText('Hi! I look after education licences.').closest('[data-bubble-body]') as HTMLElement;
    expect(hers.className).toContain('color-mix');
    expect(hers.style.getPropertyValue('--c')).not.toBe('');
    expect(hers.closest('[data-bubble]')!.textContent).toContain('Dilini Perera');
    const mine = screen.getByText("I'll leave you with Dilini — she'll send the quote.").closest('[data-bubble-body]') as HTMLElement;
    expect(mine.className).toContain('bg-primary');
    expect(mine.closest('[data-bubble]')!.textContent).toMatch(/^You/);
    // The note names its author in its label (INTERNAL NOTE · NUWAN · ONLY STAFF SEE THIS).
    const note = screen.getByText('Dilini handles education licences — inviting her.').closest('[data-bubble]')!;
    expect(note.textContent).toContain('Internal note · Nuwan · only staff see this');
  });

  it('the composer has the Message type tabs; somebody monitoring opens on Internal note', async () => {
    mountThread();
    const tabs = await screen.findByRole('tablist', { name: 'Message type' });
    expect(within(tabs).getByRole('tab', { name: 'Reply to visitor' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('textbox', { name: 'Message' }).getAttribute('placeholder')).toBe('Type a message… / for saved replies');
    fireEvent.keyDown(within(tabs).getByRole('tab', { name: 'Reply to visitor' }), { key: 'ArrowRight' });
    expect(await screen.findByRole('textbox', { name: 'Internal note' })).toBeTruthy();
    cleanup();

    team = teamOf({ my_role: 'observer', can: { ...teamOf().can, leave: true }, people: [...teamOf().people, { user_id: 3, name: 'Nuwan Silva', avatar: null, role: 'observer' as const, joined_at: ago(1000) }].filter((p, i) => i !== 1) });
    mountThread();
    expect(await screen.findByRole('textbox', { name: 'Internal note' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Stop monitoring' })).toBeTruthy();
  });

  it('counts down by the server\'s seconds, else by the expiry time', () => {
    expect(countdown(81)).toBe('1:21');
    expect(countdown(-3)).toBe('0:00');
    const now = Date.now();
    expect(secondsLeft({ expires_at: null, expires_in: 30 }, now - 10_000, now)).toBe(20);
    expect(secondsLeft({ expires_at: new Date(now + 45_000).toISOString() }, now, now)).toBeCloseTo(45, 0);
    expect(secondsLeft({ expires_at: null }, now, now)).toBeNull();
  });
});

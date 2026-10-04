// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebchatFollowUp, WebchatRingChat, WebchatRingState } from '@shared/types';

let push: ((s: WebchatRingState) => void) | null = null;
vi.mock('../../../src/core/bridge', () => ({
  call: vi.fn(),
  on: (_: string, cb: (s: WebchatRingState) => void) => {
    push = cb;
    return () => undefined;
  },
  errorMessage: (e: unknown) => String(e),
  isMac: false,
}));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));
vi.mock('../../../src/modules/calls/tones', () => ({ playTone: vi.fn(() => ({ stop: vi.fn(), setVolume: vi.fn() })), playOnce: vi.fn() }));

import { call } from '../../../src/core/bridge';
import { playOnce, playTone } from '../../../src/modules/calls/tones';
import { RingingBar, WebchatRingWindow, clock, stageLabel, waited } from '../../../src/modules/chat/website/Ringing';

const chat = (over: Partial<WebchatRingChat>): WebchatRingChat => ({
  id: 7, visitor: 'Nimali', site: 'creativefx.lk', page: 'Pricing', place: 'Kandy, Sri Lanka', device: 'desktop · Chrome', returning: true, preview: 'Do you ship to Galle?',
  priority: 'normal', offline: false, since: new Date(Date.now() - 83_000).toISOString(), stage: 'first', atRisk: false, mine: false, by: null, silenced: false, ...over,
});
/** The card asks for the team's saved replies and the writing assistant: a query client around it. */
const show = (ui: ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
const state = (over: Partial<WebchatRingState>): WebchatRingState => ({ chats: [chat({})], tone: 'normal', volume: 80, outcome: null, hidden: false, shortcut: true, ...over });

beforeEach(() => {
  vi.mocked(call).mockReset();
  vi.mocked(call).mockResolvedValue(state({}) as never);
  vi.mocked(playTone).mockClear();
});
afterEach(() => cleanup());

describe('the website-chat call window (RING-UI-06)', () => {
  it('shows who, where, what they are reading and what they asked, and rings (#225, R-05)', async () => {
    show(<WebchatRingWindow />);
    await screen.findByText('Nimali');
    expect(screen.getByText('Returning')).toBeTruthy();
    // R-05: the site and the page they are on, in one line.
    expect(screen.getByText('creativefx.lk · Pricing')).toBeTruthy();
    expect(screen.getByText('Do you ship to Galle?')).toBeTruthy();
    expect(screen.getByText('Incoming website chat')).toBeTruthy();
    expect(screen.getByText('↵ send · Ctrl+Shift+J join')).toBeTruthy();
    // The tone starts in an effect, which React may run a moment after the name is on screen (a slow CI runner).
    await waitFor(() => expect(vi.mocked(playTone)).toHaveBeenCalledWith('webchat', 0.8));
  });

  it('a quick reply goes into the box, and Send & join joins, sends and opens the thread in one step (#225, R-05)', async () => {
    show(<WebchatRingWindow />);
    await screen.findByText('Nimali');
    fireEvent.click(within(screen.getByRole('group', { name: 'Quick replies' })).getByRole('button', { name: 'One moment, checking for you' }));
    const box = screen.getByLabelText('Reply and join') as HTMLInputElement;
    expect(box.value).toBe('One moment, checking for you');

    vi.mocked(call).mockResolvedValueOnce({ ok: true, why: null } as never);
    fireEvent.click(screen.getByRole('button', { name: 'Send and join' }));
    await waitFor(() => expect(call).toHaveBeenCalledWith('ring:joinSend', { id: 7, message: 'One moment, checking for you', open: true }));
    await waitFor(() => expect(box.value).toBe(''));

    // Enter sends and joins too.
    fireEvent.change(box, { target: { value: 'Yes, island-wide.' } });
    vi.mocked(call).mockResolvedValueOnce({ ok: true, why: null } as never);
    fireEvent.keyDown(box, { key: 'Enter' });
    await waitFor(() => expect(call).toHaveBeenCalledWith('ring:joinSend', { id: 7, message: 'Yes, island-wide.', open: true }));
  });

  it('Join chat joins without sending; Silence toggles; Esc and the minimise button put the card away (#225)', async () => {
    show(<WebchatRingWindow />);
    await screen.findByText('Nimali');
    fireEvent.click(screen.getByRole('button', { name: 'Join chat' }));
    // R-05, RING-41: Join chat brings WorkSuite forward on the conversation.
    expect(call).toHaveBeenCalledWith('ring:joinSend', { id: 7, open: true });
    await waitFor(() => expect((screen.getByRole('button', { name: 'Join chat' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Silence' }));
    expect(call).toHaveBeenCalledWith('ring:silence', { id: 7, on: true });
    // Silenced, it is R-04's compact card (website-ring-r03r04.test.tsx); Unsilence brings the full card back.
    act(() => push?.(state({ chats: [chat({ silenced: true })] })));
    expect(screen.getByRole('region', { name: 'Silenced chat' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Unsilence' }));
    expect(call).toHaveBeenCalledWith('ring:silence', { id: 7, on: false });
    act(() => push?.(state({ chats: [chat({})] })));

    fireEvent.click(screen.getByRole('button', { name: 'Minimise notification' }));
    expect(call).toHaveBeenCalledWith('ring:minimise');
    vi.mocked(call).mockClear();
    fireEvent.keyDown(screen.getByLabelText('Reply and join'), { key: 'Escape' });
    expect(call).toHaveBeenCalledWith('ring:minimise');
    // Transfer is for a chat given to me.
    expect(screen.queryByRole('button', { name: 'Transfer' })).toBeNull();
  });

  it('after joining, the card is a mini chat until the full chat is opened (#225)', async () => {
    const joined = { conversationId: 7, visitor: 'Nimali', site: 'creativefx.lk', place: null, device: null, page: 'Pricing', preview: 'Do you ship to Galle?', since: new Date(Date.now() - 60_000).toISOString(), sent: ['Yes, island-wide.'] };
    vi.mocked(call).mockResolvedValue(state({ chats: [], tone: 'off', joined }) as never);
    show(<WebchatRingWindow />);
    await screen.findByText('Website chat · you joined');
    expect(screen.getByText('You joined the chat')).toBeTruthy();
    expect(screen.getByText('Yes, island-wide.')).toBeTruthy();
    expect(screen.getByText('Sent')).toBeTruthy();

    vi.mocked(call).mockResolvedValueOnce({ ok: true, why: null } as never);
    fireEvent.change(screen.getByLabelText('Reply to Nimali'), { target: { value: 'Delivery takes two days.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(call).toHaveBeenCalledWith('ring:reply', { message: 'Delivery takes two days.' }));

    fireEvent.click(screen.getByRole('button', { name: /Open full chat/ }));
    expect(call).toHaveBeenCalledWith('ring:closeJoined', { open: true });
  });

  it('several ringing: a compact card each with its own reply box, Join and Silence, and the stronger tone at risk (#225)', async () => {
    show(<WebchatRingWindow />);
    await screen.findByText('Nimali');
    act(() => push?.(state({ tone: 'strong', chats: [chat({ id: 1, atRisk: true, visitor: 'Kamal' }), chat({ id: 2, mine: true, visitor: 'Ruwan', preview: 'Hello' })] })));
    expect(screen.getByText('2 website chats ringing')).toBeTruthy();
    expect(screen.getAllByText('At risk').length).toBeGreaterThan(0);
    expect(vi.mocked(playTone)).toHaveBeenLastCalledWith('webchat-strong', 0.8);

    const ruwan = screen.getByRole('listitem', { name: 'Ruwan' });
    expect(within(ruwan).getByText('Hello')).toBeTruthy();
    fireEvent.click(within(ruwan).getByRole('button', { name: 'Join chat' }));
    expect(call).toHaveBeenCalledWith('ring:joinSend', { id: 2 });

    const kamal = screen.getByRole('listitem', { name: 'Kamal' });
    fireEvent.change(within(kamal).getByLabelText('Reply to Kamal'), { target: { value: 'Hi Kamal!' } });
    fireEvent.click(within(kamal).getByRole('button', { name: 'Join & send' }));
    expect(call).toHaveBeenCalledWith('ring:joinSend', { id: 1, message: 'Hi Kamal!' });
    fireEvent.click(within(kamal).getByRole('button', { name: 'Silence Kamal' }));
    expect(call).toHaveBeenCalledWith('ring:silence', { id: 1, on: true });

    fireEvent.click(screen.getByRole('button', { name: 'Open inbox' }));
    expect(call).toHaveBeenCalledWith('ring:openInbox');
  });

  it('says nothing about who while locked, and cannot join from there', async () => {
    vi.mocked(call).mockResolvedValue(state({ hidden: true, chats: [chat({ visitor: 'A visitor', page: null, preview: null })] }) as never);
    show(<WebchatRingWindow />);
    await screen.findByText('A website visitor');
    expect(screen.getByText('Unlock WorkSuite to see who.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Join chat' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('a chat given to me counts down to its handover, and passes straight on (RING-UI-02)', async () => {
    const at = new Date(Date.now() + 18_000).toISOString();
    vi.mocked(call).mockResolvedValue(state({ chats: [chat({ mine: true, by: 'Dilini', handoverAt: at })] }) as never);
    show(<WebchatRingWindow />);
    await screen.findByText(/Passes to the next available agent in 0:1[78] if you don't join/);
    expect(screen.getByText('Assigned to you')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Pass now' }));
    expect(call).toHaveBeenCalledWith('ring:pass', { id: 7 });
    // Transfer opens the chat with the transfer dialog up.
    fireEvent.click(screen.getByRole('button', { name: 'Transfer' }));
    expect(call).toHaveBeenCalledWith('ring:join', { id: 7, then: 'transfer' });
    expect(clock(78)).toBe('1:18');
  });

  it('says when another of my devices has the ring', async () => {
    vi.mocked(call).mockResolvedValue(state({ tone: 'off', elsewhere: true }) as never);
    show(<WebchatRingWindow />);
    await screen.findByText('Ringing on your other device — shown here without sound');
    expect(vi.mocked(playTone)).not.toHaveBeenCalled();
  });

  it('shows how the ring ended', async () => {
    vi.mocked(call).mockResolvedValue(state({ chats: [], tone: 'off', outcome: { id: 7, text: 'Dilini joined the chat.', at: Date.now() } }) as never);
    show(<WebchatRingWindow />);
    await screen.findByText('Dilini joined the chat.');
    expect(vi.mocked(playTone)).not.toHaveBeenCalled();
  });
});

describe('the ringing bar in the main window (RING-45, RING-24)', () => {
  it('rings only when the call window is off, and turns amber when all are silenced', async () => {
    show(<RingingBar tone={false} />);
    await screen.findByText('Website chat ringing');
    expect(vi.mocked(playTone)).not.toHaveBeenCalled();
    act(() => push?.(state({ tone: 'off', chats: [chat({ silenced: true })] })));
    expect(screen.getByText('A chat waiting · silenced for you')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Unsilence' }));
    expect(call).toHaveBeenCalledWith('ring:silence', { id: 7, on: false });
  });
});

describe('ringing words', () => {
  it('names the step and the wait', () => {
    expect(stageLabel({ atRisk: false, mine: false, offline: false, stage: 'everyone' })).toBe('Everyone');
    expect(stageLabel({ atRisk: false, mine: true, offline: false, stage: 'first' })).toBe('Assigned to you');
    expect(waited(new Date(Date.now() - 3_725_000).toISOString(), Date.now())).toBe('1:02:05');
  });
});

describe('invitations and transfers in the call window (ENH-WCHAT-03, TEAM-UI-02)', () => {
  const handoff = (over: Partial<NonNullable<WebchatRingState['handoffs']>[number]>) => ({
    id: 21, conversationId: 3, kind: 'invite' as const, mode: 'warm' as const, visitor: 'Visitor 4F2A', site: 'techubiz.com', page: 'Pricing', from: 'Nuwan',
    department: null, toAny: false, note: 'Can you take the education pricing?', expiresAt: new Date(Date.now() + 95_000).toISOString(), createdAt: new Date(Date.now() - 25_000).toISOString(), ...over,
  });

  it('an INVITATION card: who asks, the note, the countdown, Join chat and Decline', async () => {
    vi.mocked(call).mockResolvedValue(state({ chats: [], handoffs: [handoff({})] }) as never);
    show(<WebchatRingWindow />);
    await screen.findByText('Invitation');
    expect(screen.getByText('Nuwan invites you to a chat with Visitor 4F2A')).toBeTruthy();
    expect(screen.getByText('“Can you take the education pricing?”')).toBeTruthy();
    expect(screen.getByRole('timer').getAttribute('aria-label')).toMatch(/^Rings for 1:3\d more$/);
    fireEvent.click(screen.getByRole('button', { name: 'Join chat' }));
    expect(call).toHaveBeenCalledWith('ring:handoff', { id: 21, accept: true });
    fireEvent.click(screen.getByRole('button', { name: 'Decline' }));
    expect(call).toHaveBeenCalledWith('ring:handoff', { id: 21, accept: false });
  });

  it('a TRANSFER TO YOU card says warm or handed over now, and Accept', async () => {
    vi.mocked(call).mockResolvedValue(state({ chats: [], handoffs: [handoff({ kind: 'transfer', mode: 'cold', from: 'Dilini' })] }) as never);
    show(<WebchatRingWindow />);
    await screen.findByText('Transfer to you');
    expect(screen.getByText('Dilini is handing you Visitor 4F2A')).toBeTruthy();
    expect(screen.getByText('Handed over now — Dilini has left; it rings for you until you join')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }));
    expect(call).toHaveBeenCalledWith('ring:handoff', { id: 21, accept: true });
  });

  it('under a ringing chat, an invitation is a row with Join and Decline; the bar shows one when nothing else rings', async () => {
    vi.mocked(call).mockResolvedValue(state({ handoffs: [handoff({})] }) as never);
    show(<WebchatRingWindow />);
    await screen.findByText('Nimali');
    const rows = await screen.findByRole('list', { name: 'Invitations and transfers' });
    expect(rows.textContent).toContain('Visitor 4F2A · Invitation from Nuwan');
    fireEvent.click(screen.getByRole('button', { name: 'Decline invitation for Visitor 4F2A' }));
    expect(call).toHaveBeenCalledWith('ring:handoff', { id: 21, accept: false });
    cleanup();

    vi.mocked(call).mockResolvedValue(state({ chats: [], handoffs: [handoff({})] }) as never);
    show(<RingingBar tone={false} />);
    const bar = await screen.findByRole('status', { name: 'Website chat invitation' });
    expect(bar.textContent).toContain('Nuwan invites you to join · Visitor 4F2A');
  });
});

describe('a visitor\'s voice call in the call window and the bar (ENH-WCHAT-05, VOICE-UI-03)', () => {
  const voice = { id: 31, conversationId: 3, visitor: 'Kamal', site: 'creativefx.lk', page: 'Pricing', place: 'Colombo, Sri Lanka', preview: 'Can I call you?', owner: 'Samali Perera', stage: 'first' as const, requestedAt: new Date(Date.now() - 12_000).toISOString() };

  it('comes before chats: who, where, whose chat, what they last wrote, Answer and Decline', async () => {
    vi.mocked(call).mockResolvedValue(state({ tone: 'strong', calls: [voice], answerShortcut: true }) as never);
    show(<WebchatRingWindow />);
    await screen.findByText('Kamal');
    expect(screen.getByText('Incoming voice call')).toBeTruthy();
    // V-04: "techubiz.com · in chat with Nuwan".
    expect(screen.getByText('creativefx.lk · in chat with Samali')).toBeTruthy();
    expect(screen.getByText('“Can I call you?”')).toBeTruthy();
    expect(screen.getByText('1 more waiting')).toBeTruthy();
    expect(screen.getByLabelText('Ctrl+Shift+A to answer')).toBeTruthy();
    expect(screen.queryByText('Nimali')).toBeNull();
    await waitFor(() => expect(vi.mocked(playTone)).toHaveBeenCalledWith('webchat-strong', 0.8));
    fireEvent.click(screen.getByRole('button', { name: 'Answer' }));
    expect(call).toHaveBeenCalledWith('ring:call', { id: 31, accept: true });
    fireEvent.click(screen.getByRole('button', { name: 'Decline' }));
    expect(call).toHaveBeenCalledWith('ring:call', { id: 31, accept: false });
  });

  it('locked, says a visitor is calling and nothing about who', async () => {
    vi.mocked(call).mockResolvedValue(state({ hidden: true, chats: [], calls: [{ ...voice, visitor: 'A visitor', page: null, place: null, preview: null, owner: null }] }) as never);
    show(<WebchatRingWindow />);
    await screen.findByText('A website visitor');
    expect(screen.getByText('Unlock WorkSuite to see who.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Answer' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('the bar under the tabs answers too', async () => {
    vi.mocked(call).mockResolvedValue(state({ calls: [voice] }) as never);
    show(<RingingBar tone={false} />);
    await screen.findByText('Incoming voice call');
    expect(screen.getByRole('status', { name: 'Voice call ringing' }).textContent).toContain('Kamal · creativefx.lk');
    fireEvent.click(screen.getByRole('button', { name: 'Answer' }));
    expect(call).toHaveBeenCalledWith('ring:call', { id: 31, accept: true });
  });
});

describe('a visitor who wrote again in my chat (#230)', () => {
  const f = (over: Partial<WebchatFollowUp> = {}): WebchatFollowUp => ({
    id: 41, visitor: 'Visitor CC1B', site: 'techubiz.com', since: new Date(Date.now() - 45_000).toISOString(), count: 1, stage: 'replied', mine: true, agent: null,
    recent: [{ from: 'agent', body: 'It is yearly.', at: null }, { from: 'visitor', body: 'Are u there', at: null }], ...over,
  });

  it('the card: who, their last messages, how long, a reply box that sends without opening, Open chat and Snooze 5 min', async () => {
    vi.mocked(call).mockImplementation((async (channel: string) => (channel === 'ring:state' ? state({ chats: [], tone: 'off', followUps: [f(), f({ id: 42, visitor: 'Kasun', recent: [{ from: 'visitor', body: 'Hello?', at: null }] })] }) : { ok: true, why: null })) as never);
    show(<WebchatRingWindow />);
    await screen.findByText('Visitor CC1B');
    expect(screen.getByText('Visitor replied')).toBeTruthy();
    expect(screen.getByText('It is yearly.')).toBeTruthy();
    expect(screen.getByText('Are u there')).toBeTruthy();
    expect(screen.getAllByText(/^0:4\d$/).length).toBe(2);
    fireEvent.change(screen.getByLabelText('Reply to Visitor CC1B'), { target: { value: 'Sorry, yes — 12,000 a year.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(call).toHaveBeenCalledWith('ring:followUp', { id: 41, action: 'reply', message: 'Sorry, yes — 12,000 a year.' }));
    fireEvent.click(screen.getByRole('button', { name: 'Snooze 5 min' }));
    expect(call).toHaveBeenCalledWith('ring:followUp', { id: 41, action: 'snooze' });
    fireEvent.click(screen.getByRole('button', { name: 'Open chat' }));
    expect(call).toHaveBeenCalledWith('ring:followUp', { id: 41, action: 'open' });
    // The other visitor waiting on me, as a row with its own Open.
    const others = screen.getByRole('list', { name: 'Other visitors waiting for you' });
    expect(within(others).getByText('Kasun')).toBeTruthy();
    fireEvent.click(within(others).getByRole('button', { name: 'Open' }));
    expect(call).toHaveBeenCalledWith('ring:followUp', { id: 42, action: 'open' });
  });

  it('a colleague’s chat the team was alerted about offers Take over instead of a reply box', async () => {
    vi.mocked(call).mockImplementation((async (channel: string) => (channel === 'ring:state' ? state({ chats: [], tone: 'off', followUps: [f({ stage: 'team', mine: false, agent: 'Hasarinda' })] }) : { ok: true, why: null })) as never);
    show(<WebchatRingWindow />);
    await screen.findByText("Team alert · Hasarinda's chat");
    expect(screen.queryByLabelText('Reply to Visitor CC1B')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Take over' }));
    expect(call).toHaveBeenCalledWith('ring:followUp', { id: 41, action: 'takeOver' });
  });

  it('the main window’s bar says so, and chimes once for each new one (not for those before it opened)', async () => {
    vi.mocked(playOnce).mockClear();
    vi.mocked(call).mockResolvedValue(state({ chats: [], tone: 'off', followUps: [f({ count: 2 })], chime: 3 }) as never);
    show(<RingingBar tone={false} />);
    await screen.findByText('Visitor replied · 2 new messages');
    expect(screen.getByText(/Visitor CC1B: “Are u there” · waiting 0:4\d/)).toBeTruthy();
    expect(playOnce).not.toHaveBeenCalled();
    act(() => push?.(state({ chats: [], tone: 'off', followUps: [f({ count: 3 })], chime: 4 })));
    expect(playOnce).toHaveBeenCalledWith('reply', 0.8);
    fireEvent.click(screen.getByRole('button', { name: 'Open chat' }));
    expect(call).toHaveBeenCalledWith('ring:followUp', { id: 41, action: 'open' });
  });
});

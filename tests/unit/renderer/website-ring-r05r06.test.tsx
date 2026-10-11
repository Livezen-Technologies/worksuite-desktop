// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebchatRingChat, WebchatRingState } from '@shared/types';

let push: ((s: WebchatRingState) => void) | null = null;
vi.mock('../../../src/core/bridge', () => ({
  call: vi.fn(),
  on: (_: string, cb: (s: WebchatRingState) => void) => {
    push = cb;
    return () => undefined;
  },
  errorMessage: (e: unknown) => String(e),
  isMac: true,
}));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));
vi.mock('../../../src/modules/calls/tones', () => ({ playTone: vi.fn(() => ({ stop: vi.fn(), setVolume: vi.fn() })), playOnce: vi.fn() }));
const SAVED = [
  { id: 11, shortcut: 'hold', title: 'Hi! One moment, checking now', body: 'Hi! One moment, checking now' },
  { id: 12, shortcut: 'yearly', title: "It's a yearly licence", body: "It's a yearly licence — renewed every 12 months." },
  { id: 13, shortcut: 'quote', title: 'Send a quote', body: 'I can send you a quote by email.' },
];
vi.mock('../../../src/modules/chat/website/api', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  useCanned: () => ({ data: { responses: SAVED }, isLoading: false }),
}));

import { call } from '../../../src/core/bridge';
import { RingAlertPill, WebchatRingWindow } from '../../../src/modules/chat/website/Ringing';
import { RingTrayWindow, trayLine } from '../../../src/modules/chat/website/RingTray';
import { savedMatches } from '../../../src/modules/chat/website/RingCard';

// Elapsed times ("At risk · 3:12", "Waiting 1:38") are worked out from fixture timestamps built when this file loads.
// Pin Date so a slow machine can't move the clock between building the fixtures and drawing them; timers stay real.
vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-11T09:00:00Z') });
afterAll(() => vi.useRealTimers());

/**
 * R-05 "Native incoming-chat window — reply and join from the alert" and R-06 "Tray menu — reply and join, title bar
 * and dock" (RING-UI-06/07, X-UI-10/11; RING-40/41/43/45/46, UX-ALR-01/02/04), in the design's words.
 */
const chat = (over: Partial<WebchatRingChat>): WebchatRingChat => ({
  id: 7, visitor: 'Visitor 4F2A', site: 'techubiz.com', page: '/shop/adobe-creative-cloud', place: 'Colombo, LK', device: null, returning: false,
  preview: 'Hi, is the Adobe licence lifetime or yearly? I need 5 seats.', priority: 'normal', offline: false, since: new Date(Date.now() - 42_000).toISOString(), stage: 'first',
  atRisk: false, mine: false, by: null, silenced: false, visits: null, othersRinging: null, ...over,
});
const state = (over: Partial<WebchatRingState>): WebchatRingState => ({ chats: [chat({})], tone: 'normal', volume: 80, outcome: null, hidden: false, shortcut: true, ...over });
const show = (ui: ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);

beforeEach(() => {
  vi.mocked(call).mockReset();
  vi.mocked(call).mockResolvedValue(state({}) as never);
});
afterEach(() => cleanup());

describe('R-05: the native incoming-chat window', () => {
  it('draws the design: title strip, INCOMING WEBSITE CHAT · 0:42, who and where, what they wrote, Join chat, Silence and the footer', async () => {
    show(<WebchatRingWindow />);
    const card = await screen.findByRole('region', { name: 'WorkSuite incoming website chat' });
    const w = within(card);
    expect(w.getByText('WorkSuite · Website chat')).toBeTruthy();
    expect(w.getByText('Always on top')).toBeTruthy();
    expect(w.getByText('Incoming website chat')).toBeTruthy();
    expect(w.getByRole('timer').textContent).toMatch(/^0:4\d$/);
    expect(w.getByText('Visitor 4F2A')).toBeTruthy();
    expect(w.getByText('techubiz.com · /shop/adobe-creative-cloud')).toBeTruthy();
    expect(w.getByText('Hi, is the Adobe licence lifetime or yearly? I need 5 seats.')).toBeTruthy();
    expect(w.getByText('Sending joins you to the chat, stops the ring for everyone and opens the thread.')).toBeTruthy();
    expect(w.getByRole('button', { name: 'Join chat' })).toBeTruthy();
    expect(w.getByRole('button', { name: 'Silence' })).toBeTruthy();
    expect(w.getByText('Rings until someone joins')).toBeTruthy();
    expect(w.getByText('↵ send · ⌘⇧J join')).toBeTruthy();
    // Without the shortcut registered, only Enter is offered.
    act(() => push?.(state({ shortcut: false })));
    expect(w.getByText('↵ send')).toBeTruthy();
  });

  it('quick replies are the two most used saved replies and "/ saved"; picking one and Send & join sends it, counted, and opens the thread', async () => {
    show(<WebchatRingWindow />);
    await screen.findByText('Visitor 4F2A');
    const chips = screen.getByRole('group', { name: 'Quick replies' });
    expect(within(chips).getAllByRole('button').map((b) => b.textContent)).toEqual(['Hi! One moment, checking now', "It's a yearly licence", '/ saved']);
    fireEvent.click(within(chips).getByRole('button', { name: "It's a yearly licence" }));
    const box = screen.getByLabelText('Reply and join') as HTMLInputElement;
    expect(box.value).toBe("It's a yearly licence — renewed every 12 months.");
    vi.mocked(call).mockResolvedValueOnce({ ok: true, why: null } as never);
    fireEvent.click(screen.getByRole('button', { name: 'Send and join' }));
    expect(screen.getByRole('button', { name: 'Send and join' }).textContent).toBe('Send & join');
    await waitFor(() => expect(call).toHaveBeenCalledWith('ring:joinSend', { id: 7, message: "It's a yearly licence — renewed every 12 months.", open: true, cannedId: 12 }));
  });

  it('"/ saved" — or "/" typed in the box — lists every saved reply, narrowed by what follows', async () => {
    show(<WebchatRingWindow />);
    await screen.findByText('Visitor 4F2A');
    fireEvent.click(screen.getByRole('button', { name: 'Saved replies' }));
    expect(within(screen.getByRole('listbox', { name: 'Saved replies' })).getAllByRole('option')).toHaveLength(3);
    fireEvent.click(screen.getByRole('button', { name: 'Saved replies' }));
    expect(screen.queryByRole('listbox')).toBeNull();
    const box = screen.getByLabelText('Reply and join') as HTMLInputElement;
    fireEvent.change(box, { target: { value: '/quo' } });
    const list = screen.getByRole('listbox', { name: 'Saved replies' });
    expect(within(list).getAllByRole('option')).toHaveLength(1);
    fireEvent.click(within(list).getByRole('option'));
    expect(box.value).toBe('I can send you a quote by email.');
    expect(screen.queryByRole('listbox')).toBeNull();
    // Edited by hand, it is no longer that saved reply.
    fireEvent.change(box, { target: { value: 'I can send you a quote today.' } });
    vi.mocked(call).mockResolvedValueOnce({ ok: true, why: null } as never);
    fireEvent.keyDown(box, { key: 'Enter' });
    await waitFor(() => expect(call).toHaveBeenCalledWith('ring:joinSend', { id: 7, message: 'I can send you a quote today.', open: true }));
    expect(savedMatches(SAVED, 'YEAR').map((r) => r.id)).toEqual([12]);
  });

  it('what I type is kept in the main process, and comes back when the window opens again', async () => {
    vi.mocked(call).mockResolvedValue(state({ drafts: { 7: 'Hi! It’s yearly' } }) as never);
    show(<WebchatRingWindow />);
    await screen.findByText('Visitor 4F2A');
    // The first state arrives after the first paint: the card for that chat starts from the kept words.
    cleanup();
    show(<WebchatRingWindow />);
    await screen.findByText('Visitor 4F2A');
    await waitFor(() => expect((screen.getByLabelText('Reply and join') as HTMLInputElement).value).toBe('Hi! It’s yearly'));
    fireEvent.change(screen.getByLabelText('Reply and join'), { target: { value: 'Hi! It’s yearly — for 5 seats' } });
    await waitFor(() => expect(call).toHaveBeenCalledWith('ring:draft', { id: 7, text: 'Hi! It’s yearly — for 5 seats' }));
  });

  it('UX-ALR-04: "Nuwan joined — send to the chat as a participant?" with my words; Send to the chat, View or Discard', async () => {
    const offer = { id: 7, at: 0, kind: 'joined' as const, by: 'Nuwan Perera', visitor: 'Visitor 4F2A', draft: 'Hi! It’s yearly — for 5 seats I can send a quote', text: 'Nuwan joined — send to the chat as a participant?' };
    vi.mocked(call).mockResolvedValue(state({ chats: [], tone: 'off', outcome: offer }) as never);
    show(<WebchatRingWindow />);
    const card = await screen.findByRole('alert', { name: 'A colleague joined first' });
    expect(within(card).getByText('Nuwan joined — send to the chat as a participant?')).toBeTruthy();
    expect(within(card).getByLabelText('Your reply, not sent').textContent).toBe('Hi! It’s yearly — for 5 seats I can send a quote');
    fireEvent.click(within(card).getByRole('button', { name: 'Send to the chat' }));
    expect(call).toHaveBeenCalledWith('ring:outcome', { action: 'participant' });
    fireEvent.click(within(card).getByRole('button', { name: 'Discard' }));
    expect(call).toHaveBeenCalledWith('ring:outcome', { action: 'dismiss' });
    fireEvent.click(within(card).getByRole('button', { name: 'View' }));
    expect(call).toHaveBeenCalledWith('ring:outcome', { action: 'view' });
    // Another chat still rings: the question stays above it, and is not said twice.
    act(() => push?.(state({ chats: [chat({ id: 8, visitor: 'Kasun P.' })], outcome: offer })));
    expect(screen.getByRole('alert', { name: 'A colleague joined first' })).toBeTruthy();
    expect(screen.getByText('Kasun P.')).toBeTruthy();
    expect(screen.getAllByText('Nuwan joined — send to the chat as a participant?')).toHaveLength(1);
    // Behind the lock: nothing of it.
    act(() => push?.(state({ chats: [], hidden: true, outcome: { ...offer, draft: null, text: 'A colleague joined the chat.' } })));
    expect(screen.queryByRole('alert', { name: 'A colleague joined first' })).toBeNull();
  });
});

describe('R-06: the title bar', () => {
  it('says "3 website chats ringing" with the top chat’s time while several ring', async () => {
    vi.mocked(call).mockResolvedValue(state({ chats: [chat({ id: 1 }), chat({ id: 2 }), chat({ id: 3 })] }) as never);
    show(<RingAlertPill />);
    const pill = await screen.findByRole('button', { name: /^3 website chats ringing, 0:4\d\. Open Website Chats$/ });
    expect(pill.textContent).toContain('3 website chats ringing');
    // One of them silenced for me: two ring.
    act(() => push?.(state({ chats: [chat({ id: 1 }), chat({ id: 2 }), chat({ id: 3, silenced: true })] })));
    expect(screen.getByText('2 website chats ringing')).toBeTruthy();
  });
});

describe('R-06: the tray’s ringing menu', () => {
  const three = state({
    chats: [
      chat({ id: 1, visitor: 'Anne · Acme Ltd', atRisk: true, place: 'Kandy, LK', preview: 'My activation key says invalid on the second laptop', since: new Date(Date.now() - 192_000).toISOString() }),
      chat({ id: 2, visitor: 'Kasun P.', mine: true, preview: 'Do you offer a trial?' }),
      chat({ id: 3, visitor: 'Visitor 4F2A', since: new Date(Date.now() - 65_000).toISOString() }),
    ],
  });

  it('draws the design: the count, the most urgent expanded with its last message and reply box, the others with Reply and Join, and the menu', async () => {
    vi.mocked(call).mockResolvedValue(three as never);
    show(<RingTrayWindow />);
    const menu = await screen.findByRole('region', { name: 'Tray menu' });
    const m = within(menu);
    expect(m.getByText('3 website chats ringing')).toBeTruthy();
    const anne = m.getByRole('listitem', { name: 'Anne · Acme Ltd' });
    expect(within(anne).getByText('At risk · 3:12 · Kandy')).toBeTruthy();
    expect(within(anne).getByText('"My activation key says invalid on the second laptop"')).toBeTruthy();
    expect(within(anne).getByRole('button', { name: 'Send and join' }).textContent).toBe('Send & join');
    const kasun = m.getByRole('listitem', { name: 'Kasun P.' });
    expect(within(kasun).getByText('Assigned to you · 0:42')).toBeTruthy();
    expect(within(kasun).getByRole('button', { name: 'Reply' })).toBeTruthy();
    expect(within(m.getByRole('listitem', { name: 'Visitor 4F2A' })).getByText('Waiting · 1:05')).toBeTruthy();
    expect(m.getByText('Reply from here: sending joins the chat and stops the ring.')).toBeTruthy();
    expect(m.getAllByRole('button').slice(-3).map((b) => b.textContent)).toEqual(['Open Website Chats', 'Ringing settings…', 'Quit WorkSuite']);
    // The reply box has the keyboard at once.
    await waitFor(() => expect(document.activeElement).toBe(within(anne).getByLabelText('Reply to Anne · Acme Ltd')));
  });

  it('Send & join from the menu joins and sends without opening the thread; Join joins and opens it', async () => {
    vi.mocked(call).mockResolvedValue(three as never);
    show(<RingTrayWindow />);
    const anne = await screen.findByRole('listitem', { name: 'Anne · Acme Ltd' });
    fireEvent.change(within(anne).getByLabelText('Reply to Anne · Acme Ltd'), { target: { value: 'Sorry Anne — I’ll fix it now' } });
    vi.mocked(call).mockResolvedValueOnce({ ok: true, why: null } as never);
    fireEvent.click(within(anne).getByRole('button', { name: 'Send and join' }));
    await waitFor(() => expect(call).toHaveBeenCalledWith('ring:joinSend', { id: 1, message: 'Sorry Anne — I’ll fix it now' }));
    fireEvent.click(within(screen.getByRole('listitem', { name: 'Visitor 4F2A' })).getByRole('button', { name: 'Join Visitor 4F2A' }));
    expect(call).toHaveBeenCalledWith('ring:join', { id: 3 });
  });

  it('Reply on another row expands it instead', async () => {
    vi.mocked(call).mockResolvedValue(three as never);
    show(<RingTrayWindow />);
    const kasun = await screen.findByRole('listitem', { name: 'Kasun P.' });
    fireEvent.click(within(kasun).getByRole('button', { name: 'Reply' }));
    const open = screen.getByRole('listitem', { name: 'Kasun P.' });
    expect(within(open).getByText('"Do you offer a trial?"')).toBeTruthy();
    expect(within(open).getByLabelText('Reply to Kasun P.')).toBeTruthy();
    expect(within(screen.getByRole('listitem', { name: 'Anne · Acme Ltd' })).queryByRole('textbox')).toBeNull();
    expect(within(screen.getByRole('listitem', { name: 'Anne · Acme Ltd' })).getByText('At risk · 3:12')).toBeTruthy();
  });

  it('its menu items and Esc', async () => {
    vi.mocked(call).mockResolvedValue(three as never);
    show(<RingTrayWindow />);
    await screen.findByRole('region', { name: 'Tray menu' });
    fireEvent.click(screen.getByRole('button', { name: 'Open Website Chats' }));
    expect(call).toHaveBeenCalledWith('ring:tray', { action: 'inbox' });
    fireEvent.click(screen.getByRole('button', { name: 'Ringing settings…' }));
    expect(call).toHaveBeenCalledWith('ring:tray', { action: 'settings' });
    fireEvent.click(screen.getByRole('button', { name: 'Quit WorkSuite' }));
    expect(call).toHaveBeenCalledWith('ring:tray', { action: 'quit' });
    fireEvent.keyDown(screen.getByRole('region', { name: 'Tray menu' }), { key: 'Escape' });
    expect(call).toHaveBeenCalledWith('ring:tray', { action: 'close' });
  });

  it('one chat says so; locked it says nothing of who', async () => {
    show(<RingTrayWindow />);
    await screen.findByText('Website chat ringing');
    act(() => push?.(state({ hidden: true })));
    expect(screen.getByText('Unlock WorkSuite to see who.')).toBeTruthy();
    expect(screen.queryByText('Visitor 4F2A')).toBeNull();
    const now = Date.now();
    expect(trayLine({ atRisk: false, mine: false, silenced: true, since: new Date(now - 5000).toISOString(), place: null }, now, true)).toBe('Silenced for you · 0:05');
  });
});

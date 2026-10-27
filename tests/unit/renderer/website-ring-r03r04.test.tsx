// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebchatRingChat, WebchatRingState } from '@shared/types';
import type * as CoreApi from '../../../src/core/api';

let push: ((s: WebchatRingState) => void) | null = null;
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(async () => ({})), apiPost: vi.fn(async () => ({})) }));
vi.mock('../../../src/core/bridge', () => ({
  call: vi.fn(),
  on: (channel: string, cb: (s: WebchatRingState) => void) => {
    if (channel === 'ring:changed') push = cb;
    return () => undefined;
  },
  errorMessage: (e: unknown) => String(e),
  isMac: false,
}));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));
vi.mock('../../../src/modules/calls/tones', () => ({ playTone: vi.fn(() => ({ stop: vi.fn(), setVolume: vi.fn() })), playOnce: vi.fn() }));

import { call } from '../../../src/core/bridge';
import type { WebsiteRow } from '../../../src/modules/chat/website/api';
import { RingAlertPill, WebchatRingWindow, silencedFor, youJoinedLine } from '../../../src/modules/chat/website/Ringing';
import { WebsiteTable } from '../../../src/modules/chat/website/WebsiteTable';

/**
 * R-03 "How the ring ends" and R-04 "Silenced for me, still waiting" (RING-UI-03/04; RING-02, RING-03, RING-11,
 * RING-22, RING-24, RING-28), in the design's words.
 */
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const chat = (over: Partial<WebchatRingChat>): WebchatRingChat => ({
  id: 7, visitor: 'Visitor 4F2A', site: 'techubiz.com', page: '/shop/adobe-creative-cloud', place: null, device: null, returning: true,
  preview: 'Is the Adobe licence yearly?', priority: 'normal', offline: false, since: ago(98_000), stage: 'first',
  atRisk: false, mine: false, by: null, silenced: false, othersRinging: 2, ...over,
});
const state = (over: Partial<WebchatRingState>): WebchatRingState => ({ chats: [], tone: 'off', volume: 80, outcome: null, hidden: false, shortcut: false, ...over });
const show = (ui: ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
const outcome = (o: Partial<NonNullable<WebchatRingState['outcome']>>) => ({ id: 7, at: Date.now(), text: '', ...o });

beforeEach(() => {
  push = null;
  vi.mocked(call).mockReset();
  vi.mocked(call).mockResolvedValue(state({}) as never);
});
afterEach(() => cleanup());

describe('R-03: how the ring ends', () => {
  it('SOMEONE ELSE JOINS: "Nuwan joined the chat with Visitor 4F2A", and View', async () => {
    vi.mocked(call).mockResolvedValue(state({ outcome: outcome({ kind: 'joined', by: 'Nuwan Silva', visitor: 'Visitor 4F2A', text: 'Nuwan joined the chat with Visitor 4F2A' }) }) as never);
    show(<WebchatRingWindow />);
    const toast = await screen.findByRole('status', { name: 'How the ring ended' });
    expect(toast.textContent).toContain('Nuwan joined the chat with Visitor 4F2A');
    expect(within(toast).getByText('Nuwan').tagName).toBe('B');
    fireEvent.click(within(toast).getByRole('button', { name: 'View' }));
    expect(call).toHaveBeenCalledWith('ring:outcome', { action: 'view' });
  });

  it('too late: "You pressed Join a moment late — Dilini already has this chat."', async () => {
    vi.mocked(call).mockResolvedValue(state({ outcome: outcome({ kind: 'late', by: 'Dilini Fernando', text: 'x' }) }) as never);
    show(<WebchatRingWindow />);
    const late = await screen.findByRole('status', { name: 'How the ring ended' });
    expect(late.textContent).toBe('You pressed Join a moment late — Dilini already has this chat.');
    expect(within(late).getByText('Dilini').tagName).toBe('B');
  });

  it('THE VISITOR IS GONE: in Missed chats with the email they left, Open in Missed and Dismiss', async () => {
    vi.mocked(call).mockResolvedValue(state({ outcome: outcome({ kind: 'visitor_left', visitor: 'Visitor 4F2A', missed: true, email: 'ravi@studio.lk', text: 'x' }) }) as never);
    show(<WebchatRingWindow />);
    await screen.findByText('Visitor 4F2A left the site');
    expect(screen.getByText('before anyone joined')).toBeTruthy();
    expect(screen.getByText('Ringing stopped. The chat is in Missed chats with the email they left: ravi@studio.lk')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open in Missed' }));
    expect(call).toHaveBeenCalledWith('ring:outcome', { action: 'missed' });
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(call).toHaveBeenCalledWith('ring:outcome', { action: 'dismiss' });

    // Not in Missed chats (switched off for the site, or an older server): it says only that the ring stopped.
    act(() => push?.(state({ outcome: outcome({ kind: 'visitor_left', visitor: 'Visitor 4F2A', missed: false, text: 'x' }) })));
    expect(screen.getByText('Ringing stopped.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Open in Missed' })).toBeNull();
  });

  it('the visitor ended the chat: "Visitor 4F2A ended the chat. Ringing stopped."', async () => {
    vi.mocked(call).mockResolvedValue(state({ outcome: outcome({ kind: 'visitor_ended', visitor: 'Visitor 4F2A', text: 'x' }) }) as never);
    show(<WebchatRingWindow />);
    const ended = await screen.findByRole('status', { name: 'How the ring ended' });
    expect(ended.textContent).toBe('Visitor 4F2A ended the chat. Ringing stopped.');
  });

  it('behind the lock, and for anything else, plain words', async () => {
    vi.mocked(call).mockResolvedValue(state({ hidden: true, outcome: outcome({ kind: 'joined', by: null, text: 'A colleague joined the chat.' }) }) as never);
    show(<WebchatRingWindow />);
    await screen.findByText('A colleague joined the chat.');
    expect(screen.queryByRole('button', { name: 'View' })).toBeNull();
  });

  it('YOU JOIN: Yours, and "You joined the chat · ringing stopped for 2 colleagues"', async () => {
    const joined = { conversationId: 7, visitor: 'Visitor 4F2A', site: 'techubiz.com', place: null, device: null, page: '/shop/adobe-creative-cloud', preview: 'Hi, is the Adobe licence lifetime or yearly?', since: ago(60_000), sent: [] };
    vi.mocked(call).mockResolvedValue(state({ joined, youJoined: { id: 7, colleagues: 2 } }) as never);
    show(<WebchatRingWindow />);
    await screen.findByText('You joined the chat · ringing stopped for 2 colleagues');
    expect(screen.getByText('Yours')).toBeTruthy();
    expect(screen.getByText('Hi, is the Adobe licence lifetime or yearly?')).toBeTruthy();
    expect(screen.getByPlaceholderText('Type a reply…')).toBeTruthy();
    expect([youJoinedLine(1), youJoinedLine(0), youJoinedLine(null)]).toEqual(['You joined the chat · ringing stopped for 1 colleague', 'You joined the chat', 'You joined the chat']);
  });
});

describe('R-04: silenced for me, still waiting', () => {
  it('the compact card: still waiting, silenced for me and still ringing for colleagues, Join chat, Unsilence', async () => {
    vi.mocked(call).mockResolvedValue(state({ chats: [chat({ silenced: true })] }) as never);
    show(<WebchatRingWindow />);
    const card = await screen.findByRole('region', { name: 'Silenced chat' });
    expect(within(card).getByText('Visitor 4F2A is still waiting')).toBeTruthy();
    expect(within(card).getByText('Silenced for you · still ringing for 2 colleagues')).toBeTruthy();
    expect(within(card).getByRole('timer').textContent).toMatch(/^1:3\d$/);
    expect(within(card).getByText('It rings for you again if it becomes at risk.')).toBeTruthy();
    // No tone, no reply box: it is not ringing for me.
    expect(screen.queryByLabelText('Reply and join')).toBeNull();
    vi.mocked(call).mockResolvedValueOnce({ ok: true, why: null } as never);
    fireEvent.click(within(card).getByRole('button', { name: 'Join chat' }));
    expect(call).toHaveBeenCalledWith('ring:joinSend', { id: 7 });
    fireEvent.click(within(card).getByRole('button', { name: 'Unsilence' }));
    expect(call).toHaveBeenCalledWith('ring:silence', { id: 7, on: false });

    // Others silenced too: "+N waiting" opens the inbox. One not silenced is the ringing card again.
    act(() => push?.(state({ chats: [chat({ silenced: true }), chat({ id: 8, silenced: true })] })));
    fireEvent.click(screen.getByRole('button', { name: '+1 waiting' }));
    expect(call).toHaveBeenCalledWith('ring:openInbox');
    act(() => push?.(state({ chats: [chat({ silenced: true }), chat({ id: 8 })] })));
    expect(screen.queryByRole('region', { name: 'Silenced chat' })).toBeNull();
  });

  it('says only what the server counted', () => {
    expect(silencedFor({ mine: false, othersRinging: 1 })).toBe('Silenced for you · still ringing for 1 colleague');
    expect(silencedFor({ mine: false, othersRinging: null })).toBe('Silenced for you');
    expect(silencedFor({ mine: false, othersRinging: 0 })).toBe('Silenced for you');
  });

  it('the amber top-bar pill: "Silenced · 1 waiting" with the timer', async () => {
    vi.mocked(call).mockResolvedValue(state({ chats: [chat({ silenced: true })] }) as never);
    show(<RingAlertPill />);
    const pill = await screen.findByRole('button', { name: /^Silenced · 1 waiting, 1:3\d\. Open Website Chats$/ });
    expect(pill.className).toContain('bg-stage-gray-2');
  });

  it('the Live chats row: amber with an amber edge, "Ringing · silenced", nobody yet, the wait in amber', async () => {
    const row = (over: Partial<WebsiteRow>): WebsiteRow => ({
      id: 7, widget: 'TechHub', widget_id: 1, site: 'techubiz.com', online: true, inactive: false, label: 'Visitor 4F2A', visitor_name: null,
      email: null, country: null, browser: null, os: null, device: null, current_url: null, last_seen: null, status: 'open',
      is_offline: false, priority: 'normal', updated_at: ago(0), agent: null, assigned_to: null, started_at: null,
      last_visitor_at: null, waiting_since: ago(98_000), at_risk: false, awaiting_reply: true, rating: null, is_starred: false, tags: null, ...over,
    });
    const rows = [row({}), row({ id: 8, label: 'Kasun P.', agent: 'Nuwan', assigned_to: 3, awaiting_reply: false, waiting_since: null })];
    show(
      <WebsiteTable title="Live chats" subtitle="Visitors still on the site" filters={null} rows={rows} me={5} myName="Me"
        ringing={new Map([[7, chat({ silenced: true })]])} typing={new Set()} active onOpen={vi.fn()} onMenu={vi.fn()} />,
    );
    const silenced = (await screen.findByText('Visitor 4F2A')).closest('[role="row"]') as HTMLElement;
    expect(silenced.className).toContain('bg-warning-bg');
    expect(silenced.className).toContain('shadow-[inset_3px_0_0_var(--color-warning)]');
    expect(within(silenced).getByText('Ringing · silenced')).toBeTruthy();
    expect(within(silenced).getAllByRole('img', { name: 'Silenced for you' }).length).toBeGreaterThan(0);
    expect(within(silenced).getByText('Nobody yet')).toBeTruthy();
    await waitFor(() => expect(within(silenced).getByLabelText(/^waiting 1:3\d$/).getAttribute('data-tone')).toBe('amber'));
    expect(within(silenced).getByText('“Is the Adobe licence yearly?”')).toBeTruthy();

    // A chat somebody has is drawn as before.
    const other = screen.getByText('Kasun P.').closest('[role="row"]') as HTMLElement;
    expect(other.className).not.toContain('bg-warning-bg');
    expect(within(other).getByText('Nuwan')).toBeTruthy();
    expect(within(other).getByText('Chatting')).toBeTruthy();
  });
});

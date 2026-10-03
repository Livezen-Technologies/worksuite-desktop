// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebchatRingChat, WebchatRingState } from '@shared/types';

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
vi.mock('../../../src/modules/calls/tones', () => ({ playTone: vi.fn(() => ({ stop: vi.fn(), setVolume: vi.fn() })) }));

import { call } from '../../../src/core/bridge';
import { playTone } from '../../../src/modules/calls/tones';
import { RingingBar, WebchatRingWindow, clock, stageLabel, waited } from '../../../src/modules/chat/website/Ringing';

const chat = (over: Partial<WebchatRingChat>): WebchatRingChat => ({
  id: 7, visitor: 'Nimali', site: 'creativefx.lk', page: 'Pricing', place: 'Kandy, Sri Lanka', device: 'desktop · Chrome', returning: true, preview: 'Do you ship to Galle?',
  priority: 'normal', offline: false, since: new Date(Date.now() - 83_000).toISOString(), stage: 'first', atRisk: false, mine: false, by: null, silenced: false, ...over,
});
const state = (over: Partial<WebchatRingState>): WebchatRingState => ({ chats: [chat({})], tone: 'normal', volume: 80, outcome: null, hidden: false, shortcut: true, ...over });

beforeEach(() => {
  vi.mocked(call).mockReset();
  vi.mocked(call).mockResolvedValue(state({}) as never);
  vi.mocked(playTone).mockClear();
});
afterEach(() => cleanup());

describe('the website-chat call window (RING-UI-06)', () => {
  it('shows who, where and what they asked, rings, and joins or silences', async () => {
    render(<WebchatRingWindow />);
    await screen.findByText('Nimali');
    expect(screen.getByText(/creativefx\.lk · Kandy, Sri Lanka/)).toBeTruthy();
    expect(screen.getByText('Reading Pricing')).toBeTruthy();
    expect(screen.getByText('“Do you ship to Galle?”')).toBeTruthy();
    expect(screen.getByText(/Ctrl\+Shift\+J to join/)).toBeTruthy();
    // The tone starts in an effect, which React may run a moment after the name is on screen (a slow CI runner).
    await waitFor(() => expect(vi.mocked(playTone)).toHaveBeenCalledWith('webchat', 0.8));
    fireEvent.click(screen.getByRole('button', { name: 'Join chat' }));
    expect(call).toHaveBeenCalledWith('ring:join', { id: 7 });
    fireEvent.click(screen.getByRole('button', { name: 'Silence' }));
    expect(call).toHaveBeenCalledWith('ring:silence', { id: 7, on: true });
  });

  it('lists the others with their own Join, and uses the stronger tone at risk', async () => {
    render(<WebchatRingWindow />);
    await screen.findByText('Nimali');
    act(() => push?.(state({ tone: 'strong', chats: [chat({ id: 1, atRisk: true, visitor: 'Kamal' }), chat({ id: 2, mine: true, visitor: 'Ruwan' })] })));
    expect(screen.getAllByText('At risk').length).toBeGreaterThan(0);
    expect(vi.mocked(playTone)).toHaveBeenLastCalledWith('webchat-strong', 0.8);
    fireEvent.click(screen.getByRole('button', { name: 'Join' }));
    expect(call).toHaveBeenCalledWith('ring:join', { id: 2 });
  });

  it('says nothing about who while locked, and cannot join from there', async () => {
    vi.mocked(call).mockResolvedValue(state({ hidden: true, chats: [chat({ visitor: 'A visitor', page: null, preview: null })] }) as never);
    render(<WebchatRingWindow />);
    await screen.findByText('A website visitor');
    expect(screen.getByText('Unlock WorkSuite to see who.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Join chat' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('a chat given to me counts down to its handover, and passes straight on (RING-UI-02)', async () => {
    const at = new Date(Date.now() + 18_000).toISOString();
    vi.mocked(call).mockResolvedValue(state({ chats: [chat({ mine: true, by: 'Dilini', handoverAt: at })] }) as never);
    render(<WebchatRingWindow />);
    await screen.findByText(/Passes to the next available agent in 0:1[78] if you don't join/);
    expect(screen.queryByRole('button', { name: 'Silence' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Pass to next' }));
    expect(call).toHaveBeenCalledWith('ring:pass', { id: 7 });
    expect(clock(78)).toBe('1:18');
  });

  it('says when another of my devices has the ring', async () => {
    vi.mocked(call).mockResolvedValue(state({ tone: 'off', elsewhere: true }) as never);
    render(<WebchatRingWindow />);
    await screen.findByText('Ringing on your other device — shown here without sound');
    expect(vi.mocked(playTone)).not.toHaveBeenCalled();
  });

  it('shows how the ring ended', async () => {
    vi.mocked(call).mockResolvedValue(state({ chats: [], tone: 'off', outcome: { id: 7, text: 'Dilini joined the chat.', at: Date.now() } }) as never);
    render(<WebchatRingWindow />);
    await screen.findByText('Dilini joined the chat.');
    expect(vi.mocked(playTone)).not.toHaveBeenCalled();
  });
});

describe('the ringing bar in the main window (RING-45, RING-24)', () => {
  it('rings only when the call window is off, and turns amber when all are silenced', async () => {
    render(<RingingBar tone={false} />);
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
    render(<WebchatRingWindow />);
    await screen.findByText('Invitation');
    expect(screen.getByText('Nuwan invites you to join')).toBeTruthy();
    expect(screen.getByText('“Can you take the education pricing?”')).toBeTruthy();
    expect(screen.getByRole('timer').getAttribute('aria-label')).toMatch(/^Rings for 1:3\d more$/);
    fireEvent.click(screen.getByRole('button', { name: 'Join chat' }));
    expect(call).toHaveBeenCalledWith('ring:handoff', { id: 21, accept: true });
    fireEvent.click(screen.getByRole('button', { name: 'Decline' }));
    expect(call).toHaveBeenCalledWith('ring:handoff', { id: 21, accept: false });
  });

  it('a TRANSFER TO YOU card says warm or handed over now, and Accept', async () => {
    vi.mocked(call).mockResolvedValue(state({ chats: [], handoffs: [handoff({ kind: 'transfer', mode: 'cold', from: 'Dilini' })] }) as never);
    render(<WebchatRingWindow />);
    await screen.findByText('Transfer to you');
    expect(screen.getByText('Handed over now')).toBeTruthy();
    expect(screen.getByText('Dilini handed this chat over')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }));
    expect(call).toHaveBeenCalledWith('ring:handoff', { id: 21, accept: true });
  });

  it('under a ringing chat, an invitation is a row with Join and Decline; the bar shows one when nothing else rings', async () => {
    vi.mocked(call).mockResolvedValue(state({ handoffs: [handoff({})] }) as never);
    render(<WebchatRingWindow />);
    await screen.findByText('Nimali');
    const rows = screen.getByRole('list', { name: 'Invitations and transfers' });
    expect(rows.textContent).toContain('Visitor 4F2A · Invitation from Nuwan');
    fireEvent.click(screen.getByRole('button', { name: 'Decline invitation for Visitor 4F2A' }));
    expect(call).toHaveBeenCalledWith('ring:handoff', { id: 21, accept: false });
    cleanup();

    vi.mocked(call).mockResolvedValue(state({ chats: [], handoffs: [handoff({})] }) as never);
    render(<RingingBar tone={false} />);
    const bar = await screen.findByRole('status', { name: 'Website chat invitation' });
    expect(bar.textContent).toContain('Nuwan invites you to join · Visitor 4F2A');
  });
});

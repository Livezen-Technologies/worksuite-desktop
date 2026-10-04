// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
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
vi.mock('../../../src/modules/calls/tones', () => ({ playTone: vi.fn(() => ({ stop: vi.fn(), setVolume: vi.fn() })), playOnce: vi.fn() }));

import { call } from '../../../src/core/bridge';
import { RingAlertPill, WebchatRingWindow, ringsFor, stepLabel, visitLabel } from '../../../src/modules/chat/website/Ringing';

/**
 * R-01 "Incoming chat rings while you work in Mail" and R-02 "Several ringing: at risk, assigned, waiting"
 * (RING-UI-01/02; RING-06, RING-20, RING-23, RING-24, RING-25).
 */
const chat = (over: Partial<WebchatRingChat>): WebchatRingChat => ({
  id: 7, visitor: 'Visitor 4F2A', site: 'techubiz.com', page: '/shop/adobe-creative-cloud', place: 'Colombo, LK', device: null, returning: true,
  preview: 'Hi, is the Adobe licence lifetime or yearly?', priority: 'normal', offline: false, since: new Date(Date.now() - 42_000).toISOString(), stage: 'first',
  atRisk: false, mine: false, by: null, silenced: false, visits: 3, othersRinging: 2, ...over,
});
const state = (over: Partial<WebchatRingState>): WebchatRingState => ({ chats: [chat({})], tone: 'normal', volume: 80, outcome: null, hidden: false, shortcut: true, ...over });
const show = (ui: ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);

beforeEach(() => {
  vi.mocked(call).mockReset();
  vi.mocked(call).mockResolvedValue(state({}) as never);
});
afterEach(() => cleanup());

describe('R-01: the ringing card', () => {
  it('chips the step and the visit, says it rings until someone joins and for how many others, and Silence in words', async () => {
    show(<WebchatRingWindow />);
    await screen.findByText('Visitor 4F2A');
    expect(screen.getByText('Priority · step 1 of 3')).toBeTruthy();
    expect(screen.getByText('3rd visit')).toBeTruthy();
    // R-05 says where they are reading in the site's line.
    expect(screen.getByText('techubiz.com · /shop/adobe-creative-cloud')).toBeTruthy();
    expect(screen.getByText('Rings until someone joins · 2 others ringing')).toBeTruthy();
    // One chat: nothing else waiting.
    expect(screen.queryByText(/\+\d+ waiting/)).toBeNull();
    const silence = screen.getByRole('button', { name: 'Silence' });
    expect(silence.textContent).toContain('Silence');
    fireEvent.click(silence);
    expect(call).toHaveBeenCalledWith('ring:silence', { id: 7, on: true });
  });

  it('at risk the chip is red and says so; a VIP is marked; mine rings for me alone', async () => {
    show(<WebchatRingWindow />);
    await screen.findByText('Visitor 4F2A');
    act(() => push?.(state({ chats: [chat({ atRisk: true, priority: 'vip' })] })));
    expect(screen.getByText('At risk')).toBeTruthy();
    expect(screen.getByText('VIP')).toBeTruthy();
    expect(screen.queryByText('Priority · step 1 of 3')).toBeNull();
    act(() => push?.(state({ chats: [chat({ mine: true, othersRinging: 0 })] })));
    expect(screen.getByText('Rings for you until you join')).toBeTruthy();
  });

  it('an older server without the counts: new or returning, and no count of others', async () => {
    vi.mocked(call).mockResolvedValue(state({ chats: [chat({ visits: null, othersRinging: null, returning: false })] }) as never);
    show(<WebchatRingWindow />);
    await screen.findByText('New visitor');
    expect(screen.getByText('Rings until someone joins')).toBeTruthy();
  });
});

describe('R-02: several ringing, most urgent on top', () => {
  const three = state({
    tone: 'strong',
    chats: [
      chat({ id: 1, visitor: 'Anne · Acme Ltd', atRisk: true, priority: 'vip', site: 'techhub.com.lk', preview: 'Our invoice shows the wrong company name', since: new Date(Date.now() - 192_000).toISOString() }),
      chat({ id: 2, visitor: 'Kasun P.', mine: true, preview: 'Do you offer a trial?', handoverAt: new Date(Date.now() + 18_000).toISOString() }),
      chat({ id: 3, visitor: 'Visitor 4F2A', stage: 'everyone', preview: null, page: null, since: new Date(Date.now() - 65_000).toISOString() }),
    ],
  });

  it('the at-risk card: AT RISK, stronger tone and supervisors told, VIP, Join and Silence', async () => {
    vi.mocked(call).mockResolvedValue(three as never);
    show(<WebchatRingWindow />);
    await screen.findByText('3 website chats ringing');
    expect(screen.getByText('Most urgent on top')).toBeTruthy();
    const anne = screen.getByRole('listitem', { name: 'Anne · Acme Ltd' });
    expect(within(anne).getByText('At risk')).toBeTruthy();
    expect(within(anne).getByText('Stronger tone · supervisors told')).toBeTruthy();
    expect(within(anne).getByText('VIP')).toBeTruthy();
    expect(within(anne).getByText(/^3:1[23]$/)).toBeTruthy();
    fireEvent.click(within(anne).getByRole('button', { name: 'Join chat' }));
    expect(call).toHaveBeenCalledWith('ring:joinSend', { id: 1 });
    expect(within(anne).getByRole('button', { name: 'Silence Anne · Acme Ltd' })).toBeTruthy();
  });

  it('the assigned card: ASSIGNED TO YOU in turn, the handover countdown, and Pass to next instead of Silence', async () => {
    vi.mocked(call).mockResolvedValue(three as never);
    show(<WebchatRingWindow />);
    const kasun = await screen.findByRole('listitem', { name: 'Kasun P.' });
    expect(within(kasun).getByText('Assigned to you')).toBeTruthy();
    expect(within(kasun).getByText('In turn')).toBeTruthy();
    expect(within(kasun).getByText(/Passes to the next available agent in 0:1[78] if you don't join/)).toBeTruthy();
    expect(within(kasun).queryByRole('button', { name: /Silence/ })).toBeNull();
    fireEvent.click(within(kasun).getByRole('button', { name: 'Pass to next' }));
    expect(call).toHaveBeenCalledWith('ring:pass', { id: 2 });
  });

  it('given by a colleague, it says from whom', async () => {
    vi.mocked(call).mockResolvedValue(state({ chats: [chat({ id: 2, visitor: 'Kasun P.', mine: true, by: 'Dilini' }), chat({ id: 3 })] }) as never);
    show(<WebchatRingWindow />);
    const kasun = await screen.findByRole('listitem', { name: 'Kasun P.' });
    expect(within(kasun).getByText('From Dilini')).toBeTruthy();
    // No countdown: Pass to next is still offered.
    fireEvent.click(within(kasun).getByRole('button', { name: 'Pass to next' }));
    expect(call).toHaveBeenCalledWith('ring:pass', { id: 2 });
  });

  it('the waiting row: its site, step and wait, and Join', async () => {
    vi.mocked(call).mockResolvedValue(three as never);
    show(<WebchatRingWindow />);
    const row = await screen.findByRole('listitem', { name: 'Visitor 4F2A' });
    expect(within(row).getByText('techubiz.com · everyone · step 3 of 3')).toBeTruthy();
    expect(within(row).getByText(/^1:0[56]$/)).toBeTruthy();
    fireEvent.click(within(row).getByRole('button', { name: 'Join chat' }));
    expect(call).toHaveBeenCalledWith('ring:joinSend', { id: 3 });
  });

  it('in the order the ringer gives: at risk, assigned to me, then waiting', async () => {
    vi.mocked(call).mockResolvedValue(three as never);
    show(<WebchatRingWindow />);
    const list = await screen.findByRole('list', { name: 'Chats waiting' });
    expect(within(list).getAllByRole('listitem').map((li) => li.getAttribute('aria-label'))).toEqual(['Anne · Acme Ltd', 'Kasun P.', 'Visitor 4F2A']);
  });
});

describe('the title bar alert (R-01, DsTopBar; RING-25, RING-24)', () => {
  it('red "Website chat ringing" with the top chat’s time; a click opens Website Chats', async () => {
    show(<RingAlertPill />);
    const pill = await screen.findByRole('button', { name: /^Website chat ringing, 0:4\d\. Open Website Chats$/ });
    expect(within(pill).getByRole('timer').textContent).toMatch(/^0:4\d$/);
    fireEvent.click(pill);
    expect(call).toHaveBeenCalledWith('ring:openInbox');
  });

  it('amber "Silenced · N waiting" once every chat is silenced for me, and gone when nothing rings', async () => {
    vi.mocked(call).mockResolvedValue(state({ tone: 'off', chats: [chat({ silenced: true }), chat({ id: 8, silenced: true })] }) as never);
    show(<RingAlertPill />);
    await screen.findByText('Silenced · 2 waiting');
    act(() => push?.(state({ chats: [], tone: 'off' })));
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('a main process with nothing to say leaves it empty', async () => {
    vi.mocked(call).mockResolvedValue(undefined as never);
    show(<RingAlertPill />);
    await act(async () => undefined);
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('R-01/R-02 words', () => {
  it('steps, visits and who else it rings for', () => {
    expect(stepLabel({ atRisk: false, mine: false, offline: false, stage: 'first' })).toBe('Priority · step 1 of 3');
    expect(stepLabel({ atRisk: false, mine: false, offline: false, stage: 'priority' })).toBe('Priority · step 2 of 3');
    expect(stepLabel({ atRisk: false, mine: false, offline: false, stage: 'released' })).toBe('Everyone · step 3 of 3');
    expect(stepLabel({ atRisk: true, mine: false, offline: false, stage: 'everyone' })).toBeNull();
    expect(stepLabel({ atRisk: false, mine: true, offline: false, stage: 'first' })).toBeNull();
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 101].map(visitLabel)).toEqual([null, '2nd visit', '3rd visit', '4th visit', '11th visit', '12th visit', '13th visit', '21st visit', '22nd visit', '101st visit']);
    expect(visitLabel(null)).toBeNull();
    expect(ringsFor({ mine: false, othersRinging: 1 })).toBe('Rings until someone joins · 1 other ringing');
    expect(ringsFor({ mine: false, othersRinging: 0 })).toBe('Rings until someone joins · only you');
  });
});

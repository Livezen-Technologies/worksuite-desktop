import { afterEach, describe, expect, it, vi } from 'vitest';
import { tmpdir } from 'node:os';
import type { WebchatRingChat, WebchatRingPrefs, WebchatRingState } from '@shared/types';

vi.mock('electron', () => ({
  app: { getPath: () => tmpdir(), getVersion: () => '0.1.0', isPackaged: false, on: () => undefined },
  BrowserWindow: class {},
  screen: {},
}));

import { DesktopError } from '../../../electron/main/errors';
import { hideOutcome, lateOutcome, leftDetail, ringerHeight, stopOutcome, WebchatRinger, type PendingAnswer, type RingingEntry } from '../../../electron/services/webchat-ring';
import type { HttpClient } from '../../../electron/services/http';

/**
 * R-03 "How the ring ends" and R-04 "Silenced for me, still waiting" in the main process (RING-UI-03/04; RING-02,
 * RING-03, RING-11, RING-24, RING-28): each outcome told in the design's words with what the card needs to draw it,
 * View and Open in Missed, "ringing stopped for N colleagues" after my own join, and the compact silenced card.
 */
const stamp = (msAgo: number) => new Date(Date.now() - msAgo).toISOString().slice(0, 19).replace('T', ' ');
const entry = (over: Partial<RingingEntry> = {}): RingingEntry => ({ id: 3, conversation_id: 3, visitor: 'Visitor 4F2A', site: 'techubiz.com', kind: 'waiting', mine: false, since: stamp(5000), silenced: false, others_ringing: 2, ...over });
const chat = (over: Partial<WebchatRingChat>): WebchatRingChat => ({
  id: 1, visitor: 'Visitor 4F2A', site: 'techubiz.com', page: null, place: null, device: null, returning: false, preview: null, priority: 'normal',
  offline: false, since: stamp(10_000), stage: 'first', atRisk: false, mine: false, by: null, silenced: false, ...over,
});

function ringer(answer: PendingAnswer, over: Partial<{ locked: boolean }> = {}) {
  const post = vi.fn(async (_path: string, _body?: unknown, _opts?: unknown): Promise<unknown> => ({}));
  const opened: number[] = [];
  const missed: number[] = [];
  const prefs: WebchatRingPrefs = { window: true, duringDnd: 'card', shortcut: true, volume: 80 };
  const r = new WebchatRinger({
    http: { get: vi.fn(async () => answer), post, request: vi.fn(async () => ({})) } as unknown as HttpClient,
    signedIn: () => true,
    locked: () => over.locked ?? false,
    me: () => 5,
    prefs: () => prefs,
    quiet: () => false,
    open: (id) => opened.push(id),
    openMissed: (id) => missed.push(id),
    onChanged: (_s: WebchatRingState) => undefined,
    deviceId: () => 'desktop-12',
    focused: () => false,
  });
  return { r, post, opened, missed };
}

afterEach(() => vi.useRealTimers());

describe('R-03 words (RING-UI-03, RING-28)', () => {
  it('names the visitor who left or ended it, and says Missed chats only when the server put it there', () => {
    expect(stopOutcome('visitor_left', 'Visitor 4F2A', { missed: true, visitor_email: 'ravi@studio.lk' })).toEqual({
      kind: 'visitor_left', visitor: 'Visitor 4F2A', missed: true, email: 'ravi@studio.lk',
      text: 'Visitor 4F2A left the site before anyone joined. Ringing stopped. The chat is in Missed chats with the email they left: ravi@studio.lk',
    });
    expect(leftDetail({ missed: true, email: null })).toBe('Ringing stopped. The chat is in Missed chats.');
    // Not in Missed chats (switched off there, or an older server): no email offered and no claim.
    expect(stopOutcome('visitor_left', 'Kasun', { missed: false, visitor_email: 'k@x.lk' })).toMatchObject({ missed: false, email: null, text: 'Kasun left the site before anyone joined. Ringing stopped.' });
    expect(stopOutcome('visitor_ended', 'Visitor 4F2A', {})).toEqual({ kind: 'visitor_ended', visitor: 'Visitor 4F2A', text: 'Visitor 4F2A ended the chat. Ringing stopped.' });
    expect(stopOutcome('closed', 'x', {})).toEqual({ kind: 'note', text: 'The chat was closed before anyone joined.' });
    expect(stopOutcome('joined', 'x', {})).toBeNull();
  });

  it('a late Join says who has it: from the 409, or an older server\'s sentence', () => {
    expect(lateOutcome({ message: 'Dilini Fernando has already taken this chat.', data: { by: 9, by_name: 'Dilini Fernando' } })).toEqual({ kind: 'late', by: 'Dilini Fernando', text: 'You pressed Join a moment late — Dilini already has this chat.' });
    expect(lateOutcome({ message: 'Kasun has already taken this chat.' })).toMatchObject({ kind: 'late', by: 'Kasun' });
    expect(lateOutcome({ message: 'This chat has been closed.' })).toEqual({ kind: 'note', text: 'This chat has been closed.' });
  });

  it('behind the lock says what happened, never who', () => {
    const o = hideOutcome({ id: 3, at: 0, kind: 'visitor_left', visitor: 'Ravi', email: 'ravi@studio.lk', missed: true, text: 'Ravi left…' });
    expect(o).toMatchObject({ visitor: 'A visitor', email: null, by: null, text: 'A visitor left the site before anyone joined. Ringing stopped.' });
  });
});

describe('R-03 in the ringer', () => {
  it('a colleague joined: the toast with View, which opens the chat and clears it', async () => {
    const { r, opened } = ringer({ ringing: [entry()] });
    r.start();
    await vi.waitFor(() => expect(r.state().chats).toHaveLength(1));
    r.handle({ type: 'chat.ring.stopped', conversation_id: 3, reason: 'joined', by: 8, by_name: 'Nuwan Silva' } as never);
    expect(r.state().outcome).toMatchObject({ id: 3, kind: 'joined', by: 'Nuwan Silva', visitor: 'Visitor 4F2A', text: 'Nuwan joined the chat with Visitor 4F2A' });
    // The chat.taken that follows says nothing twice.
    r.handle({ type: 'chat.taken', conversation_id: 3, by: 8, by_name: 'Nuwan Silva', how: 'accepted' } as never);
    r.outcomeAction('view');
    expect(opened).toEqual([3]);
    expect(r.state().outcome).toBeNull();
    r.stop();
  });

  it('the visitor left: Open in Missed opens Missed chats, never the inbox; Dismiss only clears', async () => {
    const { r, opened, missed } = ringer({ ringing: [entry(), entry({ id: 4, conversation_id: 4, visitor: 'Kasun' })] });
    r.start();
    await vi.waitFor(() => expect(r.state().chats).toHaveLength(2));
    r.handle({ type: 'chat.ring.stopped', conversation_id: 3, reason: 'visitor_left', missed: true, visitor_email: 'ravi@studio.lk' } as never);
    expect(r.state().outcome).toMatchObject({ kind: 'visitor_left', visitor: 'Visitor 4F2A', missed: true, email: 'ravi@studio.lk' });
    r.outcomeAction('missed');
    expect([missed, opened]).toEqual([[3], []]);

    r.handle({ type: 'chat.ring.stopped', conversation_id: 4, reason: 'visitor_left', missed: false } as never);
    r.outcomeAction('missed');
    expect(missed).toEqual([3]);
    expect(r.state().outcome).toBeNull();
    r.stop();
  });

  it('an outcome with something to do stays longer than a plain one', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const { r } = ringer({ ringing: [entry(), entry({ id: 4, conversation_id: 4 })] });
    r.start();
    await r.reconcile();
    r.handle({ type: 'chat.ring.stopped', conversation_id: 3, reason: 'visitor_ended' } as never);
    vi.advanceTimersByTime(6_000);
    expect(r.state().outcome).toBeNull();
    r.handle({ type: 'chat.ring.stopped', conversation_id: 4, reason: 'visitor_left', missed: true } as never);
    vi.advanceTimersByTime(6_000);
    expect(r.state().outcome?.kind).toBe('visitor_left');
    vi.advanceTimersByTime(15_000);
    expect(r.state().outcome).toBeNull();
    r.stop();
  });

  it('a late Join is told in the design\'s words, with who has it', async () => {
    const { r, post } = ringer({ ringing: [entry()] });
    post.mockImplementation(async (path: string) => {
      if (path.endsWith('/join-reply')) throw new DesktopError('CONFLICT', 'Dilini Fernando has already taken this chat.', 409, { by: 9, by_name: 'Dilini Fernando' });
      return {};
    });
    r.start();
    await vi.waitFor(() => expect(r.state().chats).toHaveLength(1));
    expect(await r.joinAndSend(3, null)).toEqual({ ok: false, why: 'You pressed Join a moment late — Dilini already has this chat.' });
    expect(r.state().outcome).toMatchObject({ kind: 'late', by: 'Dilini Fernando' });
    expect(r.state().chats).toHaveLength(0);
    r.stop();
  });

  it('my own join: ringing stopped for as many colleagues as the card said, then as the server counted', async () => {
    const { r } = ringer({ ringing: [entry()] });
    r.start();
    await vi.waitFor(() => expect(r.state().chats).toHaveLength(1));
    expect((await r.joinAndSend(3, null)).ok).toBe(true);
    expect(r.state().youJoined).toEqual({ id: 3, colleagues: 2 });
    expect(r.state().joined?.conversationId).toBe(3);
    r.handle({ type: 'chat.ring.stopped', conversation_id: 3, reason: 'joined', by: 5, by_name: 'Me', stopped_for: 1 } as never);
    expect(r.state().youJoined).toEqual({ id: 3, colleagues: 1 });
    // Nothing is said about my own join.
    expect(r.state().outcome).toBeNull();
    r.stop();
  });

  it('a chat given to me rang for me alone: no colleagues to stop for', async () => {
    const { r } = ringer({ ringing: [entry({ kind: 'assigned', mine: true, others_ringing: 0 })] });
    r.start();
    await vi.waitFor(() => expect(r.state().chats).toHaveLength(1));
    await r.join(3);
    expect(r.state().youJoined).toEqual({ id: 3, colleagues: 0 });
    r.stop();
  });

  it('says nothing about who behind the lock', async () => {
    const { r } = ringer({ ringing: [entry()] }, { locked: true });
    r.start();
    await vi.waitFor(() => expect(r.state().chats).toHaveLength(1));
    r.handle({ type: 'chat.ring.stopped', conversation_id: 3, reason: 'joined', by: 8, by_name: 'Nuwan Silva' } as never);
    expect(r.state().outcome).toMatchObject({ kind: 'joined', by: null, text: 'A colleague joined the chat.' });
    r.stop();
  });
});

describe('R-04 in the ringer (RING-11, RING-24)', () => {
  it('silenced on another of my devices is silenced here; at risk it rings again', async () => {
    const { r } = ringer({ ringing: [entry()] });
    r.start();
    await vi.waitFor(() => expect(r.state().chats).toHaveLength(1));
    r.handle({ type: 'chat.ring.silenced', conversation_id: 3, silenced: true } as never);
    expect(r.state()).toMatchObject({ tone: 'off', chats: [{ silenced: true, othersRinging: 2 }] });
    r.handle({ type: 'chat.at_risk', conversation_id: 3 } as never);
    expect(r.state()).toMatchObject({ tone: 'strong', chats: [{ silenced: false, atRisk: true }] });
    r.stop();
  });

  it('the call window is the compact card while every chat is silenced', () => {
    expect(ringerHeight({ chats: [chat({ silenced: true }), chat({ id: 2, silenced: true })], outcome: null })).toBe(150);
    expect(ringerHeight({ chats: [chat({ silenced: true }), chat({ id: 2 })], outcome: null })).toBe(280);
  });
});

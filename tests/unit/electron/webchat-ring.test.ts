import { afterEach, describe, expect, it, vi } from 'vitest';
import { tmpdir } from 'node:os';
import type { WebchatRingChat, WebchatRingPrefs, WebchatRingState } from '@shared/types';

vi.mock('electron', () => ({
  app: { getPath: () => tmpdir(), getVersion: () => '0.1.0', isPackaged: false, on: () => undefined },
  BrowserWindow: class {},
  screen: {},
}));

import { DesktopError } from '../../../electron/main/errors';
import { mergeAnswer, orderChats, ringerHeight, stampMs, toneFor, WebchatRinger, type PendingAnswer } from '../../../electron/services/webchat-ring';
import { ringerBounds } from '../../../electron/windows/manager';
import type { HttpClient } from '../../../electron/services/http';

const stamp = (msAgo: number) => new Date(Date.now() - msAgo).toISOString().slice(0, 19).replace('T', ' ');
const chat = (over: Partial<WebchatRingChat>): WebchatRingChat => ({
  id: 1,
  visitor: 'Visitor 4F2A',
  site: 'creativefx.lk',
  page: 'Pricing',
  place: 'Colombo, Sri Lanka',
  device: 'desktop · Chrome',
  returning: false,
  preview: null,
  priority: 'normal',
  offline: false,
  since: stamp(10_000),
  stage: 'first',
  atRisk: false,
  mine: false,
  by: null,
  silenced: false,
  ...over,
});

describe('the ringing list (ENH-WCHAT-01, RING-09/23)', () => {
  it('builds from the pending read: waiting chats with their context, mine from pending', () => {
    const answer: PendingAnswer = {
      waiting: [{ conversation_id: 7, visitor: 'Nimali', site: 'Shop', page: 'Checkout', city: 'Kandy', country: 'Sri Lanka', device: 'mobile', browser: 'Safari', returning: true, priority: 'vip', waiting_since: '2026-09-28 10:00:00', stage: 'priority' }],
      pending: [{ conversation_id: 9, visitor: 'Visitor 11', site: 'Docs', by: 'Kasun', at: '2026-09-28 10:05:00' }],
      ring_seconds: 0,
    };
    const list = mergeAnswer(answer, new Map());
    expect(list.map((c) => [c.id, c.mine])).toEqual([
      [9, true],
      [7, false],
    ]);
    expect(list[1]).toMatchObject({ visitor: 'Nimali', place: 'Kandy, Sri Lanka', device: 'mobile · Safari', returning: true, priority: 'vip', stage: 'priority' });
    expect(list[0]).toMatchObject({ by: 'Kasun', site: 'Docs' });
  });

  it('keeps a preview and a silence the answer does not carry, and drops the silence when a chat becomes at risk', () => {
    const prev = new Map([
      [7, chat({ id: 7, preview: 'Do you ship to Galle?', silenced: true })],
      [8, chat({ id: 8, silenced: true })],
    ]);
    const list = mergeAnswer({ waiting: [{ conversation_id: 7 }, { conversation_id: 8, at_risk: true }] }, prev);
    expect(list.find((c) => c.id === 7)).toMatchObject({ preview: 'Do you ship to Galle?', silenced: true });
    expect(list.find((c) => c.id === 8)).toMatchObject({ atRisk: true, silenced: false });
  });

  it('orders at risk, then mine, then oldest waiting', () => {
    const ordered = orderChats([chat({ id: 1, since: '2026-09-28 10:00:00' }), chat({ id: 2, since: '2026-09-28 09:00:00' }), chat({ id: 3, mine: true }), chat({ id: 4, atRisk: true, since: '2026-09-28 11:00:00' })]);
    expect(ordered.map((c) => c.id)).toEqual([4, 3, 2, 1]);
  });

  it('reads server stamps as UTC', () => {
    expect(stampMs('2026-09-28 10:00:00')).toBe(Date.UTC(2026, 8, 28, 10, 0, 0));
    expect(stampMs('2026-09-28T10:00:00+05:30')).toBe(Date.UTC(2026, 8, 28, 4, 30, 0));
  });
});

describe('the tone (RING-21, RING-47, RING-08)', () => {
  const base = { ringSeconds: 0, quiet: false, duringDnd: 'card' as const, now: Date.now() };
  it('rings until someone joins, stronger at risk and for high, urgent and VIP chats', () => {
    expect(toneFor([chat({ since: stamp(3_600_000) })], base)).toBe('normal');
    expect(toneFor([chat({ priority: 'urgent' })], base)).toBe('strong');
    expect(toneFor([chat({ atRisk: true })], base)).toBe('strong');
    expect(toneFor([], base)).toBe('off');
  });
  it('is silent for silenced chats and offline enquiries, which show as cards', () => {
    expect(toneFor([chat({ silenced: true }), chat({ id: 2, offline: true })], base)).toBe('off');
  });
  it('honours an organisation cap, except at risk', () => {
    const capped = { ...base, ringSeconds: 45 };
    expect(toneFor([chat({ since: stamp(60_000) })], capped)).toBe('off');
    expect(toneFor([chat({ since: stamp(20_000) })], capped)).toBe('normal');
    expect(toneFor([chat({ since: stamp(60_000), atRisk: true })], capped)).toBe('strong');
  });
  it('during Do not disturb: the window only, only at risk, or as usual', () => {
    const quiet = { ...base, quiet: true };
    expect(toneFor([chat({})], { ...quiet, duringDnd: 'card' })).toBe('off');
    expect(toneFor([chat({})], { ...quiet, duringDnd: 'at_risk' })).toBe('off');
    expect(toneFor([chat({ atRisk: true })], { ...quiet, duringDnd: 'at_risk' })).toBe('strong');
    expect(toneFor([chat({})], { ...quiet, duringDnd: 'ring' })).toBe('normal');
  });
});

describe('the call window place (RING-40)', () => {
  it('sits bottom right of the work area and grows with the list, never past it', () => {
    const area = { x: 0, y: 25, width: 1440, height: 875 };
    expect(ringerBounds(area, 272)).toEqual({ x: 1044, y: 612, width: 380, height: 272 });
    expect(ringerBounds(area, 5000).height).toBe(843);
    expect(ringerHeight({ chats: [chat({}), chat({ id: 2 })], outcome: null })).toBe(318);
    expect(ringerHeight({ chats: [], outcome: { id: 1, text: 'x', at: 0 } })).toBe(120);
  });
});

function ringer(answers: Array<PendingAnswer | Error>, over: Partial<{ locked: boolean; me: number }> = {}) {
  const get = vi.fn(async () => {
    const a = answers.length > 1 ? answers.shift()! : answers[0]!;
    if (a instanceof Error) throw a;
    return a;
  });
  const post = vi.fn(async (_path: string) => ({}));
  const states: WebchatRingState[] = [];
  const opened: number[] = [];
  const prefs: WebchatRingPrefs = { window: true, duringDnd: 'card', shortcut: true, volume: 80 };
  const r = new WebchatRinger({
    http: { get, post } as unknown as HttpClient,
    signedIn: () => true,
    locked: () => over.locked ?? false,
    me: () => over.me ?? 5,
    prefs: () => prefs,
    quiet: () => false,
    open: (id) => opened.push(id),
    onChanged: (s) => states.push(s),
  });
  return { r, get, post, states, opened };
}

describe('WebchatRinger', () => {
  afterEach(() => vi.useRealTimers());

  it('rings from an incoming frame, and stops with who joined when somebody else takes it', async () => {
    const { r, states } = ringer([{ waiting: [], pending: [] }]);
    r.start();
    await vi.waitFor(() => expect(states.length).toBeGreaterThan(0));
    r.handle({ type: 'chat.incoming', conversation_id: 12, visitor: 'Visitor 12', site: 'Shop', preview: 'Hello?', waiting_since: stamp(1000) } as never);
    expect(r.state().chats).toHaveLength(1);
    expect(r.state()).toMatchObject({ tone: 'normal', chats: [{ id: 12, preview: 'Hello?' }] });

    r.handle({ type: 'chat.taken', conversation_id: 12, by: 8, by_name: 'Dilini', how: 'accepted' } as never);
    expect(r.state().chats).toHaveLength(0);
    expect(r.state().outcome?.text).toBe('Dilini joined the chat.');
    r.stop();
  });

  it('a reconciliation drops a chat the server no longer lists (a lost taken frame)', async () => {
    const { r } = ringer([{ waiting: [{ conversation_id: 3 }] }, { waiting: [] }]);
    r.start();
    await vi.waitFor(() => expect(r.state().chats).toHaveLength(1));
    await r.reconcile();
    expect(r.state().chats).toHaveLength(0);
    r.stop();
  });

  it('joins a waiting chat by accepting it, and one assigned to me by opening it', async () => {
    const { r, post, opened } = ringer([{ waiting: [{ conversation_id: 3 }], pending: [{ conversation_id: 4 }] }]);
    r.start();
    await vi.waitFor(() => expect(r.state().chats).toHaveLength(2));
    expect(await r.join(3)).toBe(true);
    expect(post).toHaveBeenCalledWith('/api/chat/widget-admin/conversations/3/accept');
    expect(await r.join(4)).toBe(true);
    expect(post).toHaveBeenCalledTimes(1);
    expect(opened).toEqual([3, 4]);
    r.stop();
  });

  it('a moment too late is told who has it', async () => {
    const { r, post, opened } = ringer([{ waiting: [{ conversation_id: 3 }] }]);
    post.mockRejectedValueOnce(new DesktopError('CONFLICT', 'Kasun has already taken this chat.', 409));
    r.start();
    await vi.waitFor(() => expect(r.state().chats).toHaveLength(1));
    expect(await r.join(3)).toBe(false);
    expect(opened).toEqual([]);
    expect(r.state().outcome?.text).toBe('Kasun has already taken this chat.');
    expect(r.state().chats).toHaveLength(0);
    r.stop();
  });

  it('silence mutes the tone until the chat is at risk', async () => {
    const { r } = ringer([{ waiting: [{ conversation_id: 3 }] }]);
    r.start();
    await vi.waitFor(() => expect(r.state().chats).toHaveLength(1));
    r.silence(3, true);
    expect(r.state().tone).toBe('off');
    r.handle({ type: 'chat.at_risk', conversation_id: 3 } as never);
    expect(r.state()).toMatchObject({ tone: 'strong', chats: [{ silenced: false, atRisk: true }] });
    r.stop();
  });

  it('says nothing about who while WorkSuite is locked', async () => {
    const { r } = ringer([{ waiting: [{ conversation_id: 3, visitor: 'Nimali Perera', page: 'Checkout', preview: 'card number?' }] }], { locked: true });
    r.start();
    await vi.waitFor(() => expect(r.state().chats).toHaveLength(1));
    expect(r.state()).toMatchObject({ hidden: true, chats: [{ visitor: 'A visitor', page: null, preview: null }] });
    r.stop();
  });

  it('stops asking somebody the server refuses, until the next sign-in', async () => {
    const { r, get } = ringer([new DesktopError('PERMISSION_DENIED', 'no', 403)]);
    r.start();
    await vi.waitFor(() => expect(get).toHaveBeenCalledTimes(1));
    await r.reconcile();
    r.handle({ type: 'chat.incoming', conversation_id: 12 } as never);
    expect(get).toHaveBeenCalledTimes(1);
    expect(r.state().chats).toHaveLength(0);
    r.stop();
  });
});

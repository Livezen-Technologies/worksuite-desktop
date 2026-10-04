import { afterEach, describe, expect, it, vi } from 'vitest';
import { tmpdir } from 'node:os';
import type { WebchatRingChat, WebchatRingPrefs, WebchatRingState } from '@shared/types';

vi.mock('electron', () => ({
  app: { getPath: () => tmpdir(), getVersion: () => '0.1.0', isPackaged: false, on: () => undefined },
  BrowserWindow: class {},
  screen: {},
}));

import { DesktopError } from '../../../electron/main/errors';
import { fromCall, fromHandoff, mergeAnswer, orderChats, ringerHeight, stampMs, toneFor, WebchatRinger, type CallEntry, type HandoffEntry, type PendingAnswer, type RingingEntry } from '../../../electron/services/webchat-ring';
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
    expect(ringerBounds(area, 272)).toEqual({ x: 1004, y: 612, width: 420, height: 272 });
    expect(ringerBounds(area, 5000).height).toBe(843);
    expect(ringerHeight({ chats: [chat({}), chat({ id: 2 })], outcome: null })).toBe(280);
    expect(ringerHeight({ chats: [chat({})], outcome: null })).toBe(430);
    expect(ringerHeight({ chats: [], outcome: { id: 1, text: 'x', at: 0 } })).toBe(120);
  });
});

/** What the ringer reads about this computer, changeable in a test (#230). */
const env = { focused: false, idle: 0, quiet: false, followUps: { card: true, desktop: true, sound: true, idleMinutes: 2 as const } };

function ringer(answers: Array<PendingAnswer | Error>, over: Partial<{ locked: boolean; me: number }> = {}) {
  const get = vi.fn(async () => {
    const a = answers.length > 1 ? answers.shift()! : answers[0]!;
    if (a instanceof Error) throw a;
    return a;
  });
  const post = vi.fn(async (_path: string, _body?: unknown, _opts?: unknown): Promise<unknown> => ({}));
  const request = vi.fn(async (_method: string, _path: string): Promise<unknown> => ({}));
  const states: WebchatRingState[] = [];
  const opened: number[] = [];
  // Chats opened on a call just answered: [conversation, call].
  const onCalls: Array<[number, number]> = [];
  const prefs: WebchatRingPrefs = { window: true, duringDnd: 'card', shortcut: true, volume: 80 };
  // A reply from the mini chat (#225), as the conversation's composer sends one.
  const reply = vi.fn(async (_id: number, _text: string) => ({ delivered: true, queued: false, error: null }) as never);
  const inbox = vi.fn();
  const r = new WebchatRinger({
    http: { get, post, request } as unknown as HttpClient,
    signedIn: () => true,
    locked: () => over.locked ?? false,
    me: () => over.me ?? 5,
    prefs: () => prefs,
    quiet: () => env.quiet,
    open: (id, callId) => {
      opened.push(id);
      if (callId) onCalls.push([id, callId]);
    },
    onChanged: (s) => states.push(s),
    deviceId: () => 'desktop-12',
    focused: () => env.focused,
    followUpPrefs: () => env.followUps,
    idleSeconds: () => env.idle,
    reply,
    openInbox: inbox,
  });
  return { r, get, post, request, states, opened, onCalls, prefs, reply, inbox };
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
    expect(post.mock.calls.filter(([path]) => String(path).endsWith('/accept'))).toHaveLength(1);
    expect(opened).toEqual([3, 4]);
    r.stop();
  });

  it('a moment too late is told who has it', async () => {
    const { r, post, opened } = ringer([{ waiting: [{ conversation_id: 3 }] }]);
    post.mockImplementation(async (path: string) => {
      if (path.endsWith('/accept')) throw new DesktopError('CONFLICT', 'Kasun has already taken this chat.', 409);
      return {};
    });
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

/*
 * The server's ring sessions (ENH-WCHAT-01 server half): its list and silences are the truth, one device per person
 * plays the ring, a chat given to me can be passed on, and a ring stops with a reason.
 */
describe('WebchatRinger with ring sessions on the server', () => {
  const ringing = (over: Partial<RingingEntry> = {}): RingingEntry => ({ id: 3, conversation_id: 3, visitor: 'Nimali', site: 'Shop', kind: 'waiting', mine: false, since: stamp(5000), silenced: false, handover_at: null, ...over });

  it('heartbeats as this computer, and stays silent while my browser has the ring', async () => {
    const { r, post, get } = ringer([{ ringing: [ringing()], ring_here: true }]);
    post.mockImplementation(async (path: string) => (path === '/api/chat/ring/heartbeat' ? { ring_here: true } : {}));
    r.start();
    await vi.waitFor(() => expect(r.state().chats).toHaveLength(1));
    expect(post).toHaveBeenCalledWith('/api/chat/ring/heartbeat', { device_id: 'desktop-12', kind: 'desktop', focused: false, can_play_audio: true });
    expect(get).toHaveBeenCalledWith('/api/chat/widget-admin/assignments/pending', { query: { device_id: 'desktop-12' } });
    expect(r.state()).toMatchObject({ tone: 'normal', elsewhere: false });

    // I chose to ring in the browser: the window shows the chat, without the tone.
    r.handle({ type: 'chat.ring.device', device_id: 'web-abc', where: 'browser' } as never);
    expect(r.state()).toMatchObject({ tone: 'off', elsewhere: true });
    r.handle({ type: 'chat.ring.device', device_id: 'desktop-12', where: 'desktop_first' } as never);
    expect(r.state().tone).toBe('normal');
    r.stop();
  });

  it('takes the server\'s silences and handover times, and sends my silence to the server', async () => {
    const { r, request } = ringer([{ ringing: [ringing({ silenced: true }), ringing({ id: 4, conversation_id: 4, kind: 'assigned', mine: true, by: 'Dilini', handover_at: '2026-10-03 10:01:00' })] }]);
    r.start();
    await vi.waitFor(() => expect(r.state().chats).toHaveLength(2));
    expect(r.state().chats.map((c) => [c.id, c.mine, c.silenced, c.handoverAt ?? null])).toEqual([[4, true, false, '2026-10-03 10:01:00'], [3, false, true, null]]);

    await r.silence(4, true);
    expect(request).toHaveBeenCalledWith('POST', '/api/chat/widget-admin/conversations/4/silence');
    await r.silence(3, false);
    expect(request).toHaveBeenCalledWith('DELETE', '/api/chat/widget-admin/conversations/3/silence');

    // Silenced on another of my devices: silenced here too.
    r.handle({ type: 'chat.ring.silenced', conversation_id: 3, silenced: true } as never);
    expect(r.state().chats.find((c) => c.id === 3)?.silenced).toBe(true);
    r.stop();
  });

  it('a silence the server refuses (at risk) is put back and says why', async () => {
    const { r, request } = ringer([{ ringing: [ringing()] }]);
    request.mockRejectedValueOnce(new DesktopError('CONFLICT', 'This chat is at risk: it rings until somebody joins it.', 409));
    r.start();
    await vi.waitFor(() => expect(r.state().chats).toHaveLength(1));
    await r.silence(3, true);
    expect(r.state().chats[0]?.silenced).toBe(false);
    expect(r.state().outcome?.text).toBe('This chat is at risk: it rings until somebody joins it.');
    r.stop();
  });

  it('passes a chat given to me straight on', async () => {
    const { r, post } = ringer([{ ringing: [ringing({ kind: 'assigned', mine: true })] }]);
    post.mockImplementation(async (path: string) => (path.endsWith('/pass') ? { passed: 'released' } : {}));
    r.start();
    await vi.waitFor(() => expect(r.state().chats).toHaveLength(1));
    expect(await r.pass(3)).toBe(true);
    expect(post).toHaveBeenCalledWith('/api/chat/widget-admin/conversations/3/pass');
    expect(r.state().chats).toHaveLength(0);
    expect(r.state().outcome?.text).toBe('Passed to everybody covering the website.');
    r.stop();
  });

  it('says why a ring stopped: the visitor left, ended it, or somebody joined', async () => {
    const { r } = ringer([{ ringing: [ringing(), ringing({ id: 4, conversation_id: 4 }), ringing({ id: 5, conversation_id: 5 })] }]);
    r.start();
    await vi.waitFor(() => expect(r.state().chats).toHaveLength(3));
    r.handle({ type: 'chat.ring.stopped', conversation_id: 3, reason: 'visitor_left' } as never);
    expect(r.state().outcome?.text).toBe('The visitor left the site before anyone joined.');
    r.handle({ type: 'chat.ring.stopped', conversation_id: 4, reason: 'joined', by: 8, by_name: 'Kasun' } as never);
    expect(r.state().outcome?.text).toBe('Kasun joined the chat.');
    r.handle({ type: 'chat.ring.stopped', conversation_id: 5, reason: 'visitor_ended' } as never);
    expect(r.state().outcome?.text).toBe('The visitor ended the chat.');
    expect(r.state().chats).toHaveLength(0);
    r.stop();
  });

  it('an older server without heartbeats: this computer decides alone', async () => {
    const { r, post } = ringer([{ waiting: [{ conversation_id: 3 }] }]);
    post.mockRejectedValueOnce(new DesktopError('NOT_FOUND', 'Not found', 404));
    r.start();
    await vi.waitFor(() => expect(r.state().chats).toHaveLength(1));
    expect(r.state()).toMatchObject({ tone: 'normal', elsewhere: false });
    await r.beat();
    expect(post.mock.calls.filter(([path]) => path === '/api/chat/ring/heartbeat')).toHaveLength(1);
    r.stop();
  });
});

/*
 * Several staff in one chat (ENH-WCHAT-03): an invitation or a transfer rings like a chat, until I answer it, it is
 * cancelled or it runs out; Join chat opens the chat, Decline tells whoever asked.
 */
describe('WebchatRinger: invitations and transfers', () => {
  const card = (over: Record<string, unknown> = {}) => ({
    handoff_id: 21, conversation_id: 3, visitor: 'Nimali', site: 'Shop', kind: 'invite', mode: 'warm', from_name: 'Nuwan',
    department: null, to_any: false, note: 'Education pricing?', expires_at: stamp(-120_000), created_at: stamp(0), ...over,
  });

  it('rings an invitation from the pending read and from its frame, and stops when it is resolved', async () => {
    const { r } = ringer([{ ringing: [], handoffs: [card()] }]);
    r.start();
    await vi.waitFor(() => expect(r.state().handoffs).toHaveLength(1));
    expect(r.state().handoffs![0]).toMatchObject({ id: 21, conversationId: 3, kind: 'invite', from: 'Nuwan', note: 'Education pricing?' });
    expect(r.state().tone).toBe('normal');

    r.handle({ type: 'chat.widget.handoff', ...card({ handoff_id: 22, conversation_id: 4, kind: 'transfer', mode: 'cold', from_name: 'Dilini' }) } as never);
    expect(r.state().handoffs!.map((h) => [h.id, h.kind, h.mode])).toEqual([[21, 'invite', 'warm'], [22, 'transfer', 'cold']]);

    // Somebody else in the department took it first; another was cancelled.
    r.handle({ type: 'chat.widget.handoff.resolved', handoff_id: 21, conversation_id: 3, status: 'accepted', by: 9, by_name: 'Amaya' } as never);
    expect(r.state().outcome?.text).toBe('Amaya took it first.');
    r.handle({ type: 'chat.widget.handoff.resolved', handoff_id: 22, conversation_id: 4, status: 'cancelled', by: 8 } as never);
    expect(r.state().outcome?.text).toBe('The transfer for Nimali: it was cancelled.');
    expect(r.state()).toMatchObject({ handoffs: [], tone: 'off' });
    r.stop();
  });

  it('counts down by the server\'s seconds left, not its stamp against this computer\'s clock (C-09)', async () => {
    // This computer's clock is an hour fast: the stamp has "passed", but the server says 90 seconds are left.
    const { r } = ringer([{ ringing: [], handoffs: [card({ expires_at: stamp(3_600_000), expires_in: 90 })] }]);
    r.start();
    await vi.waitFor(() => expect(r.state().handoffs).toHaveLength(1));
    expect(r.state().handoffs![0]!.endsAt! - Date.now()).toBeGreaterThan(85_000);
    expect(fromHandoff({ handoff_id: 5, conversation_id: 3, visitor: 'V', expires_in: 48 } as HandoffEntry, 1_000)?.endsAt).toBe(49_000);
    expect(fromHandoff({ handoff_id: 5, conversation_id: 3, visitor: 'V', expires_at: null, expires_in: null } as HandoffEntry, 1_000)?.endsAt).toBeNull();
    r.stop();
  });

  it('one that ran out stops ringing before the server says so', async () => {
    const { r } = ringer([{ ringing: [], handoffs: [card({ expires_at: stamp(1000) })] }]);
    r.start();
    await vi.waitFor(() => expect(r.state()).toBeTruthy());
    await r.reconcile();
    expect(r.state().handoffs).toEqual([]);
    r.stop();
  });

  it('Join chat accepts it and opens the chat; Decline tells whoever asked; too late says who took it', async () => {
    const { r, post, opened } = ringer([{ ringing: [], handoffs: [card(), card({ handoff_id: 22, conversation_id: 4 }), card({ handoff_id: 23, conversation_id: 5 })] }]);
    post.mockImplementation(async (path: string) => {
      if (path.endsWith('/23/accept')) throw new DesktopError('CONFLICT', 'Amaya Silva accepted this invitation first.', 409);
      return {};
    });
    r.start();
    await vi.waitFor(() => expect(r.state().handoffs).toHaveLength(3));

    expect(await r.answer(21, true)).toBe(true);
    expect(post).toHaveBeenCalledWith('/api/chat/widget-admin/handoffs/21/accept');
    expect(opened).toEqual([3]);
    expect(await r.answer(22, false)).toBe(true);
    expect(post).toHaveBeenCalledWith('/api/chat/widget-admin/handoffs/22/decline');
    expect(opened).toEqual([3]);
    expect(await r.answer(23, true)).toBe(false);
    expect(r.state().outcome?.text).toBe('Amaya Silva accepted this invitation first.');
    expect(r.state().handoffs).toEqual([]);
    r.stop();
  });

  it('accepted during a voice call, the chat opens on the call so its audio is joined (V-03, WF-V3)', async () => {
    const { r, post, onCalls } = ringer([{ ringing: [], handoffs: [card({ on_call: true })] }]);
    post.mockImplementation(async () => ({ conversation_id: 3, kind: 'invite', role: 'participant', call_id: 77 }));
    r.start();
    await vi.waitFor(() => expect(r.state().handoffs).toHaveLength(1));
    expect(r.state().handoffs![0]!.onCall).toBe(true);
    expect(await r.answer(21, true)).toBe(true);
    expect(onCalls).toEqual([[3, 77]]);
    expect(fromHandoff({ handoff_id: 5, conversation_id: 3, visitor: 'V' } as HandoffEntry)?.onCall).toBe(false);
    r.stop();
  });

  it('says nothing about who while locked, and stays quiet while another device has the ring', async () => {
    const { r } = ringer([{ ringing: [], handoffs: [card()], ring_here: false }], { locked: true });
    r.start();
    await vi.waitFor(() => expect(r.state().handoffs).toHaveLength(1));
    expect(r.state()).toMatchObject({ hidden: true, tone: 'off', elsewhere: true, handoffs: [{ visitor: 'A visitor', note: null, from: null }] });
    r.stop();
  });

  it('the call window makes room for a note', () => {
    expect(ringerHeight({ chats: [], outcome: null, handoffs: [{ id: 1, conversationId: 3, kind: 'invite', mode: 'warm', visitor: 'x', site: null, page: null, from: 'Nuwan', department: null, toAny: false, note: 'n', expiresAt: null, createdAt: null }] })).toBe(312);
  });
});

describe('WebchatRinger: visitors\' voice calls (ENH-WCHAT-05)', () => {
  const card = (over: Partial<CallEntry> = {}): CallEntry => ({
    call_id: 31, conversation_id: 3, visitor: 'Nimali', site: 'Shop', page: 'Pricing', city: 'Kandy', country: 'Sri Lanka', status: 'ringing',
    call_stage: 'first', requested_at: stamp(4000), last_message: 'Can I call you about the licence?', owner: 'Samali Perera', ...over,
  });

  it('reads a call card: who, where, what they last wrote, whose chat it is', () => {
    expect(fromCall(card())).toEqual({
      id: 31, conversationId: 3, visitor: 'Nimali', site: 'Shop', page: 'Pricing', place: 'Kandy, Sri Lanka',
      preview: 'Can I call you about the licence?', owner: 'Samali Perera', stage: 'first', requestedAt: card().requested_at,
    });
    expect(fromCall(card({ call_id: 0 }))).toBeNull();
    expect(fromCall(card({ call_stage: 'everyone' }))!.stage).toBe('everyone');
  });

  it('rings a call from the pending read and from its frame, strongly, and stops with why (VOICE-10)', async () => {
    const { r } = ringer([{ ringing: [], calls: [card()] }]);
    r.start();
    await vi.waitFor(() => expect(r.state().calls).toHaveLength(1));
    expect(r.state()).toMatchObject({ tone: 'strong', calls: [{ id: 31, visitor: 'Nimali' }] });

    r.handle({ type: 'chat.widget.call', what: 'ringing', ...card({ call_id: 32, conversation_id: 4, visitor: 'Kamal' }) } as never);
    expect(r.state().calls!.map((c) => c.id)).toEqual([31, 32]);

    // A colleague answered one; the other visitor hung up.
    r.handle({ type: 'chat.widget.call', what: 'answered', call_id: 31, conversation_id: 3, by: 9, by_name: 'Amaya' } as never);
    expect(r.state().outcome?.text).toBe('Amaya answered the call.');
    r.handle({ type: 'chat.widget.call', what: 'cancelled', call_id: 32, conversation_id: 4 } as never);
    expect(r.state().outcome?.text).toBe('The call from Kamal hung up before anyone answered.');
    expect(r.state()).toMatchObject({ calls: [], tone: 'off' });
    // A frame about a call that is not ringing here changes nothing.
    r.handle({ type: 'chat.widget.call', what: 'held', call_id: 31, conversation_id: 3 } as never);
    expect(r.state().calls).toEqual([]);
    r.stop();
  });

  it('Answer takes the call and brings WorkSuite forward on its chat, on the call; too late says who answered', async () => {
    const { r, post, opened, onCalls } = ringer([{ ringing: [], calls: [card(), card({ call_id: 32, conversation_id: 4 }), card({ call_id: 33, conversation_id: 5 })] }]);
    post.mockImplementation(async (path: string) => {
      if (path.endsWith('/calls/33/answer')) throw new DesktopError('CONFLICT', 'Amaya Silva has already answered this call.', 409);
      return {};
    });
    r.start();
    await vi.waitFor(() => expect(r.state().calls).toHaveLength(3));
    expect(r.topCall()?.id).toBe(31);

    expect(await r.answerCall(31, true)).toBe(true);
    expect(post).toHaveBeenCalledWith('/api/chat/widget-admin/calls/31/answer');
    expect(onCalls).toEqual([[3, 31]]);
    expect(await r.answerCall(32, false)).toBe(true);
    expect(post).toHaveBeenCalledWith('/api/chat/widget-admin/calls/32/decline');
    expect(opened).toEqual([3]);
    expect(await r.answerCall(33, true)).toBe(false);
    expect(r.state().outcome?.text).toBe('Amaya Silva has already answered this call.');
    expect(r.state().calls).toEqual([]);
    r.stop();
  });

  it('rings through Do not disturb unless it shows cards only, and says nothing about who while locked', () => {
    const base = { ringSeconds: 0, quiet: true, now: Date.now(), calls: 1 };
    expect(toneFor([], { ...base, duringDnd: 'ring' })).toBe('strong');
    expect(toneFor([], { ...base, duringDnd: 'at_risk' })).toBe('strong');
    expect(toneFor([], { ...base, duringDnd: 'card' })).toBe('off');
    expect(toneFor([], { ...base, quiet: false, duringDnd: 'card', ringHere: false })).toBe('off');
  });

  it('says nothing about who while locked', async () => {
    const { r } = ringer([{ ringing: [], calls: [card()] }], { locked: true });
    r.start();
    await vi.waitFor(() => expect(r.state().calls).toHaveLength(1));
    expect(r.state().calls![0]).toMatchObject({ visitor: 'A visitor', page: null, place: null, preview: null, owner: null });
    r.stop();
  });

  it('tells the server whether this computer has a microphone, with the heartbeat (VOICE-11)', async () => {
    const { r, post } = ringer([{ ringing: [] }]);
    r.start();
    await vi.waitFor(() => expect(post).toHaveBeenCalledWith('/api/chat/ring/heartbeat', expect.not.objectContaining({ has_mic: expect.anything() })));
    r.setMic(false);
    await vi.waitFor(() => expect(post).toHaveBeenLastCalledWith('/api/chat/ring/heartbeat', expect.objectContaining({ has_mic: false })));
    const beats = post.mock.calls.length;
    r.setMic(false);
    expect(post.mock.calls.length).toBe(beats);
    r.stop();
  });

  it('the call window counts a call as a card', () => {
    const c = fromCall(card())!;
    expect(ringerHeight({ chats: [], outcome: null, calls: [c] })).toBe(272);
    expect(ringerHeight({ chats: [chat({})], outcome: null, calls: [c] })).toBe(318);
  });
});

/*
 * The card itself (worksuite-desktop#225): Join & send claims and replies in one step, the card becomes a mini chat,
 * and it can be put away without stopping the ring.
 */
describe('WebchatRinger: Join & send and the mini chat (#225)', () => {
  it('claims the chat and posts the reply in one request, then the card is a mini chat on it', async () => {
    const { r, post, opened } = ringer([{ waiting: [{ conversation_id: 3, visitor: 'Nimali', preview: 'Do you ship to Galle?' }] }]);
    r.start();
    await vi.waitFor(() => expect(r.state().chats).toHaveLength(1));
    expect(r.isRinging(3)).toBe(true);
    expect(await r.joinAndSend(3, '  Yes, island-wide.  ')).toEqual({ ok: true, why: null });
    const [path, body, opts] = post.mock.calls.find(([p]) => String(p).endsWith('/join-reply'))!;
    expect(path).toBe('/api/chat/widget-admin/conversations/3/join-reply');
    expect(body).toEqual({ message: 'Yes, island-wide.' });
    expect((opts as { headers: Record<string, string> }).headers['Idempotency-Key']).toMatch(/^ring-join-3-/);
    expect(r.state().chats).toHaveLength(0);
    expect(r.state().joined).toMatchObject({ conversationId: 3, visitor: 'Nimali', preview: 'Do you ship to Galle?', sent: ['Yes, island-wide.'] });
    expect(opened).toEqual([]);
    r.stop();
  });

  it('Join chat without a message sends nothing but the claim', async () => {
    const { r, post } = ringer([{ waiting: [{ conversation_id: 3 }] }]);
    r.start();
    await vi.waitFor(() => expect(r.state().chats).toHaveLength(1));
    expect((await r.joinAndSend(3, null)).ok).toBe(true);
    expect(post.mock.calls.find(([p]) => String(p).endsWith('/join-reply'))?.[1]).toEqual({});
    expect(r.state().joined?.sent).toEqual([]);
    r.stop();
  });

  it('a moment too late: told who has it, nothing sent, no mini chat', async () => {
    const { r, post } = ringer([{ waiting: [{ conversation_id: 3 }] }]);
    post.mockImplementation(async (path: string) => {
      if (path.endsWith('/join-reply')) throw new DesktopError('CONFLICT', 'Kasun has already taken this chat.', 409);
      return {};
    });
    r.start();
    await vi.waitFor(() => expect(r.state().chats).toHaveLength(1));
    expect(await r.joinAndSend(3, 'Hello')).toEqual({ ok: false, why: 'Kasun has already taken this chat.' });
    expect(r.state().chats).toHaveLength(0);
    expect(r.state().joined).toBeNull();
    expect(post.mock.calls.some(([p]) => String(p).endsWith('/reply'))).toBe(false);
    r.stop();
  });

  it('an older server without Join & send: accept, then the reply', async () => {
    const { r, post } = ringer([{ waiting: [{ conversation_id: 3 }] }]);
    post.mockImplementation(async (path: string) => {
      if (path.endsWith('/join-reply')) throw new DesktopError('NOT_FOUND', 'Not found', 404);
      return {};
    });
    r.start();
    await vi.waitFor(() => expect(r.state().chats).toHaveLength(1));
    expect((await r.joinAndSend(3, 'Hello')).ok).toBe(true);
    expect(post.mock.calls.map(([p]) => p)).toEqual(expect.arrayContaining([
      '/api/chat/widget-admin/conversations/3/accept',
      '/api/chat/widget-admin/conversations/3/reply',
    ]));
    r.stop();
  });

  it('a reply typed in a notification joins without a mini chat', async () => {
    const { r } = ringer([{ waiting: [{ conversation_id: 3 }] }]);
    r.start();
    await vi.waitFor(() => expect(r.state().chats).toHaveLength(1));
    expect((await r.joinAndSend(3, 'Hi', { stay: false })).ok).toBe(true);
    expect(r.state().joined).toBeNull();
    r.stop();
  });

  it('the mini chat replies, opens the full chat, or is put away', async () => {
    const { r, reply, opened } = ringer([{ waiting: [{ conversation_id: 3 }] }]);
    r.start();
    await vi.waitFor(() => expect(r.state().chats).toHaveLength(1));
    await r.joinAndSend(3, 'Hi');
    expect(await r.replyJoined('Delivery takes two days.')).toEqual({ ok: true, why: null });
    expect(reply).toHaveBeenCalledWith(3, 'Delivery takes two days.');
    expect(r.state().joined?.sent).toEqual(['Hi', 'Delivery takes two days.']);

    reply.mockResolvedValueOnce({ delivered: false, queued: false, error: 'Offline' } as never);
    expect(await r.replyJoined('Lost')).toEqual({ ok: false, why: 'Offline' });
    expect(r.state().joined?.sent).toHaveLength(2);

    r.closeJoined(true);
    expect(r.state().joined).toBeNull();
    expect(opened).toEqual([3]);
    expect(await r.replyJoined('Too late')).toMatchObject({ ok: false });
    r.stop();
  });

  it('minimise puts the card away while the same chats ring; a new one brings it back', async () => {
    const { r, inbox } = ringer([{ waiting: [{ conversation_id: 3 }] }]);
    r.start();
    await vi.waitFor(() => expect(r.state().chats).toHaveLength(1));
    r.minimise();
    expect(r.state()).toMatchObject({ minimised: true, tone: 'normal' });
    r.handle({ type: 'chat.incoming', conversation_id: 12, visitor: 'Visitor 12', waiting_since: stamp(1000) } as never);
    expect(r.state().minimised).toBe(false);

    r.openInbox();
    expect(inbox).toHaveBeenCalledTimes(1);
    expect(r.state().minimised).toBe(true);
    r.stop();
  });

  it('takes the height the card measured, and keeps the mini chat out of sight while locked', async () => {
    let locked = false;
    const { r } = ringer([{ waiting: [{ conversation_id: 3, visitor: 'Nimali' }] }]);
    (r as unknown as { deps: { locked: () => boolean } }).deps.locked = () => locked;
    r.start();
    await vi.waitFor(() => expect(r.state().chats).toHaveLength(1));
    r.fit(312);
    expect(r.state().fit).toBe(312);
    await r.joinAndSend(3, 'Hi');
    locked = true;
    expect(r.state().joined).toBeNull();
    locked = false;
    expect(r.state().joined?.visitor).toBe('Nimali');
    r.stop();
  });
});

describe('WebchatRinger: a visitor writes again while I am away (#230)', () => {
  afterEach(() => {
    Object.assign(env, { focused: false, idle: 0, quiet: false, followUps: { card: true, desktop: true, sound: true, idleMinutes: 2 } });
    vi.useRealTimers();
  });
  const said = (over: Record<string, unknown> = {}) => ({
    type: 'chat.widget.message',
    conversation_id: 41,
    visitor: 'Visitor CC1B',
    site: 'techubiz.com',
    preview: 'Are u there',
    at: stamp(1_000),
    assigned_to: 5,
    participants: [5],
    followup: true,
    waiting_since: stamp(45_000),
    recent: [
      { from: 'agent', body: 'It is yearly.', at: stamp(120_000) },
      { from: 'visitor', body: 'Ok and the price?', at: stamp(45_000) },
      { from: 'visitor', body: 'Are u there', at: stamp(1_000) },
    ],
    ...over,
  });

  it('a follow-up in my chat while I am elsewhere: a card with the last messages, the chime, and the count', async () => {
    const { r } = ringer([{}]);
    r.start();
    r.handle(said() as never);
    const f = r.state().followUps![0]!;
    expect(f).toMatchObject({ id: 41, visitor: 'Visitor CC1B', site: 'techubiz.com', since: stamp(45_000), count: 1, stage: 'replied', mine: true });
    expect(f.recent.map((m) => m.body)).toEqual(['It is yearly.', 'Ok and the price?', 'Are u there']);
    expect(r.state().chime).toBe(1);
    expect(r.followUpCount()).toBe(1);
    // Another message: the same card, one more in its count, the chime again.
    r.handle(said({ preview: 'Hello??', recent: undefined }) as never);
    expect(r.state().followUps).toHaveLength(1);
    expect(r.state().followUps![0]!.count).toBe(2);
    expect(r.state().followUps![0]!.recent.at(-1)!.body).toBe('Hello??');
    expect(r.state().chime).toBe(2);
    r.stop();
  });

  it('nothing for a chat that is not mine, one not answered yet, or one I am looking at', async () => {
    const { r } = ringer([{}]);
    r.start();
    r.handle(said({ assigned_to: 9, participants: [9] }) as never);
    r.handle(said({ conversation_id: 42, followup: false }) as never);
    Object.assign(env, { focused: true, idle: 10 });
    r.setViewing(43);
    r.handle(said({ conversation_id: 43 }) as never);
    expect(r.state().followUps).toEqual([]);
    expect(r.state().chime).toBe(0);
    // The same chat while I am idle past my two minutes counts as unattended.
    env.idle = 130;
    r.handle(said({ conversation_id: 43 }) as never);
    expect(r.state().followUps!.map((f) => f.id)).toEqual([43]);
    r.stop();
  });

  it('coming back to the conversation clears its card; answered, taken over or reassigned clears it too', async () => {
    const { r } = ringer([{}]);
    r.start();
    r.handle(said() as never);
    r.handle(said({ conversation_id: 42 }) as never);
    Object.assign(env, { focused: true, idle: 0 });
    r.setViewing(41);
    expect(r.state().followUps!.map((f) => f.id)).toEqual([42]);
    r.handle({ type: 'chat.widget.followup', conversation_id: 42, stage: 'answered', by: 5 } as never);
    expect(r.state().followUps).toEqual([]);
    r.stop();
  });

  it('a reminder, then the team step: a colleague’s card offers Take over, which takes it and opens it', async () => {
    const { r, post, opened } = ringer([{}], { me: 7 });
    r.start();
    r.handle({ type: 'chat.widget.followup', conversation_id: 41, stage: 'team', visitor: 'Visitor CC1B', site: 'techubiz.com', assigned_to: 5, agent: 'Hasarinda', waiting_since: stamp(200_000), recent: [{ from: 'visitor', body: 'Are u there', at: null }] } as never);
    expect(r.state().followUps![0]).toMatchObject({ stage: 'team', mine: false, agent: 'Hasarinda' });
    expect(await r.followUp(41, 'takeOver')).toEqual({ ok: true, why: null });
    expect(post).toHaveBeenCalledWith('/api/chat/widget-admin/conversations/41/take-over');
    expect(opened).toEqual([41]);
    expect(r.state().followUps).toEqual([]);
    r.stop();
  });

  it('replies from the card without opening anything, and Snooze hides it for five minutes', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const { r, reply, opened } = ringer([{}]);
    r.start();
    r.handle(said() as never);
    r.handle(said({ conversation_id: 42 }) as never);
    expect(await r.followUp(41, 'reply', '  Yes, sorry — it is 12,000 a year. ')).toEqual({ ok: true, why: null });
    expect(reply).toHaveBeenCalledWith(41, 'Yes, sorry — it is 12,000 a year.');
    expect(opened).toEqual([]);
    expect(r.state().followUps!.map((f) => f.id)).toEqual([42]);
    await r.followUp(42, 'snooze');
    expect(r.state().followUps).toEqual([]);
    expect(r.followUpCount()).toBe(0);
    vi.setSystemTime(Date.now() + 5 * 60_000 + 1_000);
    expect(r.state().followUps!.map((f) => f.id)).toEqual([42]);
    r.stop();
  });

  it('no chime when sounds are off or during Do not disturb; hidden details while locked', async () => {
    env.followUps = { ...env.followUps, sound: false };
    const { r } = ringer([{}]);
    r.start();
    r.handle(said() as never);
    expect(r.state().chime).toBe(0);
    env.followUps = { ...env.followUps, sound: true };
    env.quiet = true;
    r.handle(said({ conversation_id: 42 }) as never);
    expect(r.state().chime).toBe(0);
    r.stop();
    const locked = ringer([{}], { locked: true });
    locked.r.start();
    locked.r.handle(said() as never);
    expect(locked.r.state().followUps![0]).toMatchObject({ visitor: 'A visitor', recent: [] });
    locked.r.stop();
  });

  it('a chat still ringing has its ringing card, not a follow-up', async () => {
    const { r } = ringer([{ waiting: [{ conversation_id: 41, visitor: 'Visitor CC1B' }] }]);
    r.start();
    await vi.waitFor(() => expect(r.state().chats).toHaveLength(1));
    r.handle(said() as never);
    expect(r.state().followUps).toEqual([]);
    r.stop();
  });
});

describe('recentOf', () => {
  it('keeps the last three messages with words, oldest first', async () => {
    const { recentOf } = await import('../../../electron/services/webchat-ring');
    expect(recentOf([{ from: 'visitor', body: 'a' }, { from: 'agent', body: ' ' }, { from: 'agent', body: 'b' }, { from: 'x', body: 'c' }, { from: 'visitor', body: 'd' }])).toEqual([
      { from: 'agent', body: 'b', at: null },
      { from: 'visitor', body: 'c', at: null },
      { from: 'visitor', body: 'd', at: null },
    ]);
    expect(recentOf('nope')).toBeNull();
  });
});

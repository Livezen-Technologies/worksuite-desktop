import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bySeq, cursorOf, judgeSeq, mergeBySeq, newClientId, SeqSeen, watchBySeq, watchedBySeq, weave } from '../../../shared/chat-seq';
import { RealtimeService } from '../../../electron/services/realtime';
import type { HttpClient } from '../../../electron/services/http';

/**
 * Website chat delivery by seq (DLV-01, DLV-04…06; plan 1.9): one copy of each message, in the server's order, a gap
 * noticed, and a realtime announcement made twice heard once.
 */
type M = { id: number; seq?: number | null; client_id?: string | null; body?: string | null; deleted?: boolean; file?: unknown };

describe('render by seq', () => {
  it('orders by seq whatever the ids say, and by id where an older server sent no seq', () => {
    expect(([{ id: 9, seq: 3 }, { id: 4, seq: 1 }, { id: 7, seq: 2 }] as M[]).sort(bySeq).map((m) => m.id)).toEqual([4, 7, 9]);
    expect(([{ id: 3 }, { id: 1 }, { id: 2 }] as M[]).sort(bySeq).map((m) => m.id)).toEqual([1, 2, 3]);
  });

  it('knows the highest seq, counting last_seq from messages this reader cannot see', () => {
    expect(cursorOf([{ id: 1, seq: 4 }, { id: 2, seq: 6 }])).toBe(6);
    expect(cursorOf([{ id: 1, seq: 4 }], 9)).toBe(9);
    expect(cursorOf([{ id: 1 }], null)).toBe(0);
  });

  it('drops a repeated announcement, takes the next one, and calls a jump a gap', () => {
    expect([judgeSeq(41, 40), judgeSeq(41, 41), judgeSeq(41, 42), judgeSeq(41, 43)]).toEqual(['seen', 'seen', 'next', 'gap']);
  });

  it('merges the server copy over the one drawn on its way by client id, never showing it twice', () => {
    const current: M[] = [{ id: 1, seq: 1, body: 'Hello?' }, { id: 77, client_id: 'c-1', body: 'Let me check' }];
    const incoming: M[] = [{ id: 78, seq: 2, client_id: 'c-1', body: 'Let me check' }, { id: 80, seq: 3, body: 'Thanks' }];
    expect(mergeBySeq(current, incoming).map((m) => [m.id, m.seq])).toEqual([[1, 1], [78, 2], [80, 3]]);
    // The same message twice is one, the newer copy winning.
    expect(mergeBySeq<M>([{ id: 5, seq: 2, body: 'old' }], [{ id: 5, seq: 2, body: 'new' }, { id: 5, seq: 2, body: 'new' }])).toEqual([{ id: 5, seq: 2, body: 'new' }]);
  });

  it('draws a message deleted since as deleted, in its place', () => {
    const merged = mergeBySeq<M>([{ id: 1, seq: 1, body: 'Card number…' }, { id: 2, seq: 2, body: 'ok' }], [], [1]);
    expect(merged[0]).toMatchObject({ id: 1, deleted: true, body: null });
    expect(merged[1]!.body).toBe('ok');
  });

  it('weaves page visits in by time without reordering the messages', () => {
    const msgs = [{ k: 'm1', time: 10 }, { k: 'm2', time: 5 }, { k: 'm3', time: 30 }];
    const events = [{ k: 'e1', time: 1 }, { k: 'e2', time: 20 }, { k: 'e3', time: 40 }];
    expect(weave(msgs, events).map((x) => x.k)).toEqual(['e1', 'm1', 'm2', 'e2', 'm3', 'e3']);
  });

  it('hears each conversation\'s seq once, and lets the oldest go past its limit', () => {
    const seen = new SeqSeen(2);
    expect([seen.first(41, 3), seen.first(41, 3), seen.first(42, 3), seen.first(41, 4)]).toEqual([true, false, true, true]);
    expect(seen.first(41, 3)).toBe(true);
  });

  it('counts the screens keeping a conversation by seq, and makes a fresh client id each time', () => {
    const a = watchBySeq('website:3');
    const b = watchBySeq('website:3');
    a();
    expect(watchedBySeq('website:3')).toBe(true);
    b();
    expect(watchedBySeq('website:3')).toBe(false);
    expect(newClientId()).toMatch(/^[0-9a-f-]{36}$/);
    expect(newClientId()).not.toBe(newClientId());
  });
});

describe('a website message announced twice (plan 1.9)', () => {
  class Socket {
    static sockets: Socket[] = [];
    onmessage?: (m: { data: string }) => void;
    onclose?: (event: { code: number }) => void;
    onerror?: () => void;
    close = vi.fn();
    constructor() {
      Socket.sockets.push(this);
    }
    send(frame: Record<string, unknown>) {
      this.onmessage?.({ data: JSON.stringify(frame) });
    }
  }
  let rt: RealtimeService;
  beforeEach(() => {
    vi.useFakeTimers();
    Socket.sockets = [];
  });
  afterEach(() => {
    rt.stop();
    vi.useRealTimers();
  });

  it('reaches the app once, by conversation and seq; one without a seq always goes', async () => {
    const get = vi.fn(async () => ({ ticket: 't', enabled: true, url: 'wss://example.com/realtime' }));
    rt = new RealtimeService({ get } as unknown as HttpClient, () => 'https://example.com', false, Socket as unknown as new (url: string) => WebSocket);
    const event = vi.fn();
    rt.onEvent = event;
    rt.start();
    await Promise.resolve();
    await Promise.resolve();
    const ws = Socket.sockets[0]!;
    ws.send({ type: 'ready' });
    ws.send({ type: 'chat.widget.message', conversation_id: 41, message_id: 900, seq: 12 });
    ws.send({ type: 'chat.widget.message', conversation_id: 41, message_id: 900, seq: 12 });
    ws.send({ type: 'chat.widget.message', conversation_id: 42, message_id: 901, seq: 12 });
    ws.send({ type: 'chat.widget.message', conversation_id: 41, message_id: 902 });
    ws.send({ type: 'chat.widget.message', conversation_id: 41, message_id: 902 });
    expect(event.mock.calls.map(([e]) => [e.conversation_id, e.message_id])).toEqual([[41, 900], [42, 901], [41, 902], [41, 902]]);
  });
});

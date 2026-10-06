import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConnectionMonitor } from '../../../electron/services/connection-quality';
import { ReceiptBatcher } from '../../../electron/services/chat-receipts';
import { DesktopError } from '../../../electron/main/errors';
import type { HttpClient } from '../../../electron/services/http';
import { FAILS_PER_STEP, PROBE_MS, RealtimeService } from '../../../electron/services/realtime';
import { closeAdvice, openSse, parseScopes, SseParser, type V2Frame } from '../../../electron/services/realtime-v2';
import { ApiTimings } from '@shared/connection';

/**
 * Plan 2.7, 2.9, 2.11, 2.12 (the server's docs/CHAT_DELIVERY.md "Phase 2"): the transport chain WebSocket v2 → SSE →
 * built-in and back, resume and reset, 1012, the ticket and scope refresh, batched receipts by seq, and the live switch.
 */

type Frame = Record<string, unknown>;

class Socket {
  static sockets: Socket[] = [];
  sent: Array<Frame | string> = [];
  onopen?: () => void;
  onmessage?: (m: { data: string }) => void;
  onclose?: (event: { code: number; reason?: string }) => void;
  onerror?: () => void;
  close = vi.fn();
  constructor(readonly url: string) {
    Socket.sockets.push(this);
  }
  get v1(): boolean {
    return this.url.includes('?ticket=');
  }
  send(text: string) {
    this.sent.push(text.startsWith('{') ? (JSON.parse(text) as Frame) : text);
  }
  open() {
    this.onopen?.();
  }
  frame(f: Frame) {
    this.onmessage?.({ data: JSON.stringify(f) });
  }
  end(code: number, reason = '') {
    this.onclose?.({ code, reason });
  }
  hello(): Frame {
    return this.sent.find((f): f is Frame => typeof f === 'object' && f.type === 'hello')!;
  }
}

const last = () => Socket.sockets.at(-1)!;
const ready = (sid = 100, channels = ['system', 'user:7', 'widget:3', 'conv:41', 'conv:41:staff']) => ({ type: 'ready', v: 2, sid, subject: 'staff', user_id: 7, channels, heartbeat_ms: 15_000, dead_after_ms: 45_000 });

function ticket(over: { mode?: string; scopes?: string; enabled?: boolean; v2?: boolean } = {}) {
  return {
    ticket: '7.999.sig',
    url: 'wss://example.com/realtime',
    enabled: over.enabled ?? true,
    service: { mode: over.mode ?? 'websocket', configured: over.mode ?? 'websocket', fallback: true, rollout: null },
    ...(over.v2 === false
      ? {}
      : { v2: { ticket: `u7.${over.scopes ?? 'w3,c41'}.999.sig`, scopes: over.scopes ?? 'w3,c41', expires: 999, ws_url: 'wss://example.com/realtime', sse_url: 'https://example.com/realtime/sse' } }),
  };
}

type RawInit = { body?: string; headers?: Record<string, string>; signal?: AbortSignal };
interface SseGateway {
  fail: boolean | number;
  opens: Frame[];
  gets: Array<Record<string, string>>;
  streams: Array<ReadableStreamDefaultController<Uint8Array>>;
  raw: ReturnType<typeof vi.fn<(method: string, url: string, init: RawInit) => Promise<Response>>>;
  write(f: Frame, id?: number, at?: number): void;
  end(at?: number): void;
}

/** An SSE gateway behind `raw`: `fail` refuses the open, otherwise each GET is a stream the test writes to. */
function sseGateway(): SseGateway {
  const g: SseGateway = {
    fail: false as boolean | number,
    opens: [] as Frame[],
    gets: [] as Array<Record<string, string>>,
    streams: [] as Array<ReadableStreamDefaultController<Uint8Array>>,
    raw: vi.fn(async (method: string, _url: string, init: RawInit) => {
      if (method === 'POST') {
        if (g.fail === true) throw new Error('unreachable');
        if (typeof g.fail === 'number') return new Response('{}', { status: g.fail });
        g.opens.push(JSON.parse(init.body ?? '{}') as Frame);
        return new Response(JSON.stringify({ ok: true, stream: `tok${g.opens.length}`, expires_in: 30 }), { status: 200 });
      }
      g.gets.push(init.headers ?? {});
      let ctl!: ReadableStreamDefaultController<Uint8Array>;
      const body = new ReadableStream<Uint8Array>({ start: (c) => void (ctl = c) });
      init.signal?.addEventListener('abort', () => {
        try {
          ctl.error(new Error('aborted'));
        } catch {
          /* closed */
        }
      });
      g.streams.push(ctl);
      return new Response(body, { status: 200 });
    }),
    write(f: Frame, id?: number, at = g.streams.length - 1) {
      g.streams[at]!.enqueue(new TextEncoder().encode(`${id !== undefined ? `id: ${id}\n` : ''}data: ${JSON.stringify(f)}\n\n`));
    },
    end(at = g.streams.length - 1) {
      g.streams[at]!.close();
    },
  };
  return g;
}

const settle = async () => {
  for (let i = 0; i < 6; i++) await vi.advanceTimersByTimeAsync(0);
};

/** Time passing on a healthy connection: the gateway's heartbeat every 15 s. */
async function pass(ms: number, beat: () => void) {
  for (let t = 0; t < ms; t += 15_000) {
    beat();
    await vi.advanceTimersByTimeAsync(Math.min(15_000, ms - t));
  }
  await settle();
}

let services: RealtimeService[] = [];
function service(opts: { get?: ReturnType<typeof vi.fn>; post?: ReturnType<typeof vi.fn>; sse?: SseGateway } = {}) {
  const get = opts.get ?? vi.fn(async () => ticket());
  const post = opts.post ?? vi.fn(async () => ({}));
  const sse = opts.sse ?? sseGateway();
  const rt = new RealtimeService({ get, post, raw: sse.raw } as unknown as HttpClient, () => 'https://example.com', false, Socket as unknown as new (url: string) => WebSocket);
  const log = { events: [] as Frame[], resync: 0, reconnect: 0, transports: [] as Array<string | null> };
  rt.onEvent = (e) => void log.events.push(e);
  rt.onResync = () => void log.resync++;
  rt.onReconnect = () => void log.reconnect++;
  rt.onTransport = (t) => void log.transports.push(t);
  services.push(rt);
  return { rt, get, post, sse, log };
}

/** Connected on WebSocket v2 at `sid`. */
async function connected(s: ReturnType<typeof service>, sid = 100) {
  s.rt.start();
  await settle();
  last().open();
  last().frame(ready(sid));
  expect(s.rt.getState()).toBe('connected');
  expect(s.rt.getTransport()).toBe('websocket');
}

beforeEach(() => {
  vi.useFakeTimers();
  Socket.sockets = [];
});
afterEach(() => {
  services.forEach((rt) => rt.stop());
  services = [];
  vi.useRealTimers();
});

describe('protocol v2 pieces', () => {
  it('reads scopes, and says what a close means', () => {
    expect(parseScopes('w1-3,c10-12,tabcdefgh1')).toEqual({ widgets: [1, 3], conversations: [10, 12] });
    expect(parseScopes('-')).toEqual({ widgets: [], conversations: [] });
    expect(closeAdvice({ code: 1012, reason: '', retryMs: 1200, ready: true })).toEqual({ kind: 'restart', retryMs: 1200 });
    expect(closeAdvice({ code: 1012, reason: '', retryMs: 90_000, ready: true })).toEqual({ kind: 'restart', retryMs: 5000 });
    expect(closeAdvice({ code: 4401, reason: '', retryMs: null, ready: false }).kind).toBe('ticket');
    expect(closeAdvice({ code: 4403, reason: '', retryMs: null, ready: true }).kind).toBe('scope');
    expect(closeAdvice({ code: 4429, reason: '', retryMs: null, ready: true })).toEqual({ kind: 'busy', minMs: 60_000 });
    expect(closeAdvice({ code: 4008, reason: '', retryMs: null, ready: true }).kind).toBe('resume');
    expect(closeAdvice({ code: 1006, reason: '', retryMs: null, ready: true }).kind).toBe('resume');
    expect(closeAdvice({ code: 1006, reason: '', retryMs: null, ready: false }).kind).toBe('failure');
    expect(closeAdvice({ code: 1009, reason: '', retryMs: null, ready: true }).kind).toBe('failure');
  });

  it('parses an event stream split anywhere, with ids, retry and comments', () => {
    const got: Array<[string, string | null]> = [];
    const p = new SseParser((data, id) => got.push([data, id]));
    p.push('retry: 2000\n\n: ping\n\nid: 5\nda');
    p.push('ta: {"type":"event"}\r');
    p.push('\n\r\ndata: {"type":"ping"}\n\n');
    expect(got).toEqual([['{"type":"event"}', '5'], ['{"type":"ping"}', null]]);
    expect(p.lastEventId).toBe('5');
    expect(p.retry).toBe(2000);
  });

  it('SSE: opens with the ticket in the body, then picks a drop up with the same token and Last-Event-ID', async () => {
    const g = sseGateway();
    const frames: V2Frame[] = [];
    const closed = vi.fn();
    const t = openSse({ raw: g.raw } as unknown as HttpClient, { url: 'https://example.com/realtime/sse', ticket: 'u7.-.9.sig', resumeFrom: 40 }, { frame: (f) => void frames.push(f), closed });
    await settle();
    expect(g.opens).toEqual([{ ticket: 'u7.-.9.sig', resume_from: 40 }]);
    expect(g.raw.mock.calls[1]![1]).toBe('https://example.com/realtime/sse?stream=tok1');
    g.write({ type: 'ready', sid: 50 });
    g.write({ type: 'event', sid: 51, ch: 'user:7', data: { type: 'x' } }, 51);
    await settle();
    expect(frames.map((f) => f.type)).toEqual(['ready', 'event']);
    g.end();
    await settle();
    await vi.advanceTimersByTimeAsync(2000);
    await settle();
    expect(g.gets.at(-1)!['Last-Event-ID']).toBe('51');
    expect(g.raw.mock.calls.at(-1)![1]).toContain('stream=tok1');
    expect(closed).not.toHaveBeenCalled();
    t.close();
  });
});

describe('the chain (plan 2.7)', () => {
  it('walks down WebSocket → SSE → built-in when each fails, then probes back up and takes over without loss', async () => {
    const s = service();
    s.sse.fail = true;
    s.rt.start();
    await settle();
    // WebSocket v2: never comes up, twice.
    for (let i = 0; i < FAILS_PER_STEP; i++) {
      expect(last().v1).toBe(false);
      last().end(1006);
      await vi.advanceTimersByTimeAsync(1000);
      await settle();
    }
    // SSE: refused, twice.
    await vi.advanceTimersByTimeAsync(2000);
    await settle();
    expect(s.sse.raw.mock.calls.filter(([m]) => m === 'POST').length).toBe(FAILS_PER_STEP);
    // Built-in: the v1 socket, ticket in the URL.
    expect(last().v1).toBe(true);
    last().frame({ type: 'ready' });
    expect(s.rt.getTransport()).toBe('legacy');
    expect(s.rt.getState()).toBe('connected');
    const v1 = last();

    // Five minutes on: WebSocket is tried beside it and takes over once ready; views sync for the change.
    await pass(PROBE_MS, () => v1.frame({ type: 'ping' }));
    expect(Socket.sockets.filter((x) => x.v1)).toHaveLength(1);
    const probe = last();
    expect(probe.v1).toBe(false);
    probe.open();
    expect(probe.hello()).toMatchObject({ type: 'hello', ticket: 'u7.w3,c41.999.sig' });
    probe.frame(ready(300));
    expect(s.rt.getTransport()).toBe('websocket');
    expect(v1.close).toHaveBeenCalled();
    expect(s.log.resync).toBe(1);
    expect(s.log.transports).toEqual(['legacy', 'websocket']);
    // The old socket is no longer heard.
    v1.frame({ type: 'chat.widget.typing', conversation_id: 41 });
    expect(s.log.events).toEqual([]);
  });

  it('runs on SSE when WebSocket will not come up, and goes back to WebSocket when a probe gets through', async () => {
    const s = service();
    s.rt.start();
    await settle();
    last().end(1006);
    await vi.advanceTimersByTimeAsync(1000);
    await settle();
    last().end(1006);
    await settle();
    expect(s.sse.opens).toHaveLength(1);
    s.sse.write(ready(500));
    await settle();
    expect(s.rt.getTransport()).toBe('sse');
    expect(s.rt.sendPing('a1')).toBe(false); // one-way: connection strength measures over HTTP
    s.sse.write({ type: 'event', sid: 501, ch: 'widget:3', data: { type: 'chat.widget.typing', conversation_id: 41 } }, 501);
    await settle();
    expect(s.log.events).toHaveLength(1);

    const sockets = Socket.sockets.length;
    await pass(PROBE_MS, () => s.sse.write({ type: 'ping', sid: 501 }));
    expect(Socket.sockets.length).toBe(sockets + 1);
    expect(s.sse.opens).toHaveLength(1);
    last().open();
    expect(last().hello()).toMatchObject({ resume_from: 501 });
    last().frame(ready(520));
    // Replayed on the new socket, and the old stream still talking: each event once, by sid.
    last().frame({ type: 'event', sid: 501, ch: 'widget:3', data: { type: 'chat.widget.typing', conversation_id: 41 } });
    last().frame({ type: 'event', sid: 502, ch: 'widget:3', data: { type: 'chat.widget.typing', conversation_id: 41 } });
    expect(s.rt.getTransport()).toBe('websocket');
    expect(s.log.events).toHaveLength(2);
    expect(s.log.resync).toBe(1);
    expect(s.rt.sendPing('a2')).toBe(true);
    expect(last().sent.at(-1)).toEqual({ type: 'ping', id: 'a2' });
  });

  it('stays the v1 client it was on a server whose service is built-in, or that has no v2', async () => {
    for (const t of [ticket({ mode: 'builtin' }), ticket({ v2: false })]) {
      Socket.sockets = [];
      const s = service({ get: vi.fn(async () => t) });
      s.rt.start();
      await settle();
      expect(Socket.sockets).toHaveLength(1);
      expect(last().v1).toBe(true);
      last().frame({ type: 'ready' });
      expect(s.rt.getTransport()).toBe('legacy');
      s.rt.stop();
    }
  });
});

describe('resume and reset', () => {
  it('reconnects with resume_from the last sid; a replay is not a resync, a reset is', async () => {
    const s = service();
    await connected(s, 100);
    expect(last().hello()).not.toHaveProperty('resume_from');
    last().frame({ type: 'event', sid: 101, ch: 'widget:3', data: { type: 'chat.widget.typing', conversation_id: 41 } });
    expect(s.log.events).toHaveLength(1);

    last().end(1006);
    expect(s.rt.getState()).toBe('down');
    await vi.advanceTimersByTimeAsync(1000);
    await settle();
    last().open();
    expect(last().hello()).toMatchObject({ resume_from: 101 });
    last().frame(ready(140));
    last().frame({ type: 'event', sid: 101, ch: 'widget:3', data: { type: 'chat.widget.typing', conversation_id: 41 } });
    last().frame({ type: 'event', sid: 120, ch: 'conv:41', data: { type: 'message.new', conversation_id: 41, seq: 7, id: 900, from: 'agent' } });
    last().frame({ type: 'resumed', from: 101, to: 140, count: 1 });
    expect(s.log.events.map((e) => e.type)).toEqual(['chat.widget.typing', 'message.new']);
    expect(s.log.resync).toBe(0);
    expect(s.log.reconnect).toBe(1);

    last().end(4000);
    await vi.advanceTimersByTimeAsync(1000);
    await settle();
    last().open();
    expect(last().hello()).toMatchObject({ resume_from: 140 });
    last().frame(ready(10_000_000));
    last().frame({ type: 'reset', reason: 'unknown', sid: 10_000_000 });
    expect(s.log.resync).toBe(1);
    last().end(4008);
    await vi.advanceTimersByTimeAsync(1000);
    await settle();
    last().open();
    expect(last().hello()).toMatchObject({ resume_from: 10_000_000 });
  });

  it('comes back from sleep resuming (plan 2.12): a silent v2 socket is replaced on kick', async () => {
    const s = service();
    await connected(s, 100);
    last().frame({ type: 'event', sid: 105, ch: 'user:7', data: { type: 'notification', id: 1 } });
    const before = last();
    s.rt.kick();
    expect(Socket.sockets).toHaveLength(1); // fresh: nothing to do
    vi.setSystemTime(Date.now() + 60_000);
    s.rt.kick();
    await settle();
    expect(before.close).toHaveBeenCalled();
    last().open();
    expect(last().hello()).toMatchObject({ resume_from: 105 });
  });

  it('1012: back after the gateway retry_ms, resuming, on the same transport', async () => {
    const s = service();
    await connected(s, 100);
    last().frame({ type: 'restart', retry_ms: 3000 });
    last().end(1012, '{"retry_ms":3000}');
    await vi.advanceTimersByTimeAsync(2900);
    expect(Socket.sockets).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(400);
    await settle();
    expect(Socket.sockets).toHaveLength(2);
    expect(last().v1).toBe(false);
    last().open();
    expect(last().hello()).toMatchObject({ resume_from: 100 });
    // Restarts are not failures: however many, it stays on WebSocket.
    for (let i = 0; i < 3; i++) {
      last().end(1012, '{"retry_ms":0}');
      await vi.advanceTimersByTimeAsync(300);
      await settle();
      expect(last().v1).toBe(false);
    }
    expect(s.sse.raw).not.toHaveBeenCalled();
  });
});

describe('tickets and scope', () => {
  it('4401: a fresh ticket at once; 4403: a fresh ticket asking for the conversations shown', async () => {
    const s = service();
    await connected(s);
    expect(s.get).toHaveBeenCalledTimes(1);
    last().end(4401);
    await settle();
    expect(s.get).toHaveBeenCalledTimes(2);
    expect(Socket.sockets).toHaveLength(2);
    last().open();
    last().frame(ready(120));

    s.rt.watch(1, 77, true);
    await settle();
    last().end(4403, 'out of scope: conv:77');
    await settle();
    expect(s.get).toHaveBeenLastCalledWith('/api/notifications/realtime-ticket', { query: { conversations: '77' } });
  });

  it('a conversation a window shows is asked for in the ticket and subscribed with it; let go when no window shows it', async () => {
    const get = vi.fn(async (_p: string, o?: { query?: { conversations?: string } }) => ticket({ scopes: o?.query?.conversations ? `w3,c41-${o.query.conversations}` : 'w3,c41' }));
    const s = service({ get });
    await connected(s);
    const ws = last();
    s.rt.watch(1, 77, true);
    await settle();
    expect(get).toHaveBeenLastCalledWith('/api/notifications/realtime-ticket', { query: { conversations: '77' } });
    expect(ws.sent.at(-1)).toEqual({ type: 'subscribe', ticket: 'u7.w3,c41-77.999.sig', channels: ['conv:77', 'conv:77:staff'] });
    ws.frame({ type: 'subscribed', channels: ['conv:77', 'conv:77:staff'], dropped: [], sid: 130 });
    // Another window on the same chat: nothing more to ask.
    s.rt.watch(2, 77, true);
    s.rt.watch(1, 77, false);
    expect(ws.sent).toHaveLength(2);
    s.rt.watch(2, 77, false);
    expect(ws.sent.at(-1)).toEqual({ type: 'unsubscribe', channels: ['conv:77', 'conv:77:staff'] });
    // A chat I hold stays heard when its window closes.
    s.rt.watch(1, 41, true);
    s.rt.forget(1);
    expect(ws.sent).toHaveLength(3);
  });
});

describe('receipts by seq, batched (plan 2.9)', () => {
  it('coalesces received seqs and marks into one request a second', async () => {
    const post = vi.fn(async () => ({}));
    const b = new ReceiptBatcher({ post } as unknown as HttpClient);
    b.ack(41, 5, 900);
    b.ack(41, 6, 901);
    b.ack(42, 3);
    b.mark({ conversation_id: 41, read_seq: 6, read: 901 });
    await vi.advanceTimersByTimeAsync(999);
    expect(post).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith('/api/chat/widget-admin/conversations/receipts', {
      items: [
        { conversation_id: 41, acks: [5, 6], delivered_seq: 6, read_seq: 6, delivered: 901, read: 901 },
        { conversation_id: 42, acks: [3] },
      ],
    });
    expect(b.size()).toBe(0);
  });

  it('keeps what did not go and sends it later; a server without the batch is sent one chat at a time', async () => {
    const post = vi.fn().mockRejectedValueOnce(new DesktopError('NETWORK_UNREACHABLE', 'down')).mockResolvedValue({});
    const b = new ReceiptBatcher({ post } as unknown as HttpClient);
    b.ack(41, 5);
    await vi.advanceTimersByTimeAsync(1000);
    b.ack(41, 7);
    await vi.advanceTimersByTimeAsync(5000);
    expect(post).toHaveBeenCalledTimes(2);
    expect(post).toHaveBeenLastCalledWith('/api/chat/widget-admin/conversations/receipts', { items: [{ conversation_id: 41, acks: [5, 7] }] });

    const old = vi.fn().mockRejectedValueOnce(new DesktopError('INTERNAL', 'Not found', 404)).mockResolvedValue({});
    const o = new ReceiptBatcher({ post: old } as unknown as HttpClient);
    o.ack(41, 5, 900);
    o.mark({ conversation_id: 42, read_seq: 2, read: 77 });
    await vi.advanceTimersByTimeAsync(1000);
    expect(old.mock.calls.slice(1)).toEqual([
      ['/api/chat/widget-admin/conversations/41/receipts', { acks: [5], delivered_seq: 5, delivered: 900 }],
      ['/api/chat/widget-admin/conversations/42/receipts', { delivered_seq: 2, read_seq: 2, delivered: 77, read: 77 }],
    ]);
  });

  it('acknowledges a visitor message announced over realtime in a chat I hold, not one I do not', async () => {
    const s = service();
    await connected(s);
    last().frame({ type: 'event', sid: 101, ch: 'conv:41:staff', data: { type: 'chat.widget.message', conversation_id: 41, message_id: 900, seq: 9 } });
    last().frame({ type: 'event', sid: 102, ch: 'widget:3', data: { type: 'chat.widget.message', conversation_id: 99, message_id: 901, seq: 2 } });
    last().frame({ type: 'event', sid: 103, ch: 'widget:3', data: { type: 'chat.widget.message', conversation_id: 98, message_id: 902, seq: 4, assigned_to: 7 } });
    last().frame({ type: 'event', sid: 104, ch: 'conv:41', data: { type: 'message.new', conversation_id: 41, id: 903, seq: 10, from: 'agent' } });
    await vi.advanceTimersByTimeAsync(1000);
    expect(s.post).toHaveBeenCalledTimes(1);
    expect(s.post).toHaveBeenCalledWith('/api/chat/widget-admin/conversations/receipts', {
      items: [
        { conversation_id: 41, acks: [9], delivered: 900 },
        { conversation_id: 98, acks: [4], delivered: 902 },
      ],
    });
  });
});

describe('switching the chat service (plan 2.11)', () => {
  it('to built-in: views sync first, then the v2 socket goes and the built-in one comes, now', async () => {
    const order: string[] = [];
    let mode = 'websocket';
    const get = vi.fn(async () => {
      order.push('ticket');
      return ticket({ mode });
    });
    const s = service({ get });
    s.rt.onResync = () => void order.push('resync');
    await connected(s);
    const ws = last();
    order.length = 0;
    mode = 'builtin';
    ws.frame({ type: 'event', sid: 101, ch: 'system', data: { type: 'system.chat_service', service: { mode: 'builtin', configured: 'builtin' }, widget_service: { mode: 'builtin' } } });
    expect(s.log.events.map((e) => e.type)).toEqual(['system.chat_service']);
    await settle();
    expect(order.slice(0, 2)).toEqual(['resync', 'ticket']);
    expect(ws.close).toHaveBeenCalled();
    expect(last().v1).toBe(true);
    last().frame({ type: 'ready' });
    expect(s.rt.getTransport()).toBe('legacy');
    expect(s.rt.chatService()?.mode).toBe('builtin');
  });

  it('to WebSocket while on SSE: probes now rather than in five minutes', async () => {
    const s = service();
    s.rt.start();
    await settle();
    for (let i = 0; i < FAILS_PER_STEP; i++) {
      last().end(1006);
      await vi.advanceTimersByTimeAsync(1000);
      await settle();
    }
    s.sse.write(ready(500));
    await settle();
    expect(s.rt.getTransport()).toBe('sse');
    const sockets = Socket.sockets.length;
    s.sse.write({ type: 'event', sid: 501, ch: 'system', data: { type: 'system.chat_service', service: { mode: 'websocket' } } }, 501);
    await settle();
    expect(Socket.sockets.length).toBe(sockets + 1);
    last().open();
    last().frame(ready(510));
    expect(s.rt.getTransport()).toBe('websocket');
  });

  it('on the built-in v1 socket, the five-minute probe reads the ticket and follows a switch to WebSocket', async () => {
    let mode = 'builtin';
    const s = service({ get: vi.fn(async () => ticket({ mode })) });
    s.rt.start();
    await settle();
    const v1 = last();
    v1.frame({ type: 'ready' });
    expect(s.rt.getTransport()).toBe('legacy');
    await pass(PROBE_MS, () => v1.frame({ type: 'ping' }));
    expect(Socket.sockets).toHaveLength(1); // still built-in: nothing opened
    expect(s.get).toHaveBeenCalledTimes(2);
    mode = 'websocket';
    await pass(PROBE_MS, () => v1.frame({ type: 'ping' }));
    expect(last().v1).toBe(false);
    last().open();
    last().frame(ready(10));
    expect(s.rt.getTransport()).toBe('websocket');
  });
});

describe('connection strength (plan 2.7)', () => {
  it('reports the transport, and learns the echo again when it changes', async () => {
    const s = service();
    const changed = vi.fn();
    const monitor = new ConnectionMonitor({ realtime: s.rt, http: { raw: vi.fn(async () => new Response('{}')), url: (p: string) => `https://example.com${p}` } as unknown as HttpClient, origin: () => 'https://example.com', active: () => true, onChange: changed, api: new ApiTimings() });
    await connected(s);
    expect(monitor.stats().transport).toBe('websocket');
    expect(changed).toHaveBeenCalled();
    monitor.tick();
    expect(last().sent.at(-1)).toEqual({ type: 'ping', id: '1' });
    last().frame({ type: 'pong', id: '1', sid: 100, t: 1 });
    expect(monitor.stats().probe).toBe('realtime-echo');
    monitor.stop();
  });
});

import type { HttpClient } from './http';

/**
 * Protocol v2 of the realtime gateway (plan 2.7; the server's docs/CHAT_DELIVERY.md "Phase 2", realtime/server.js):
 * the pieces RealtimeService (realtime.ts) puts together into WebSocket v2 → SSE → built-in.
 *
 *  - WebSocket v2: `GET /realtime` with no ticket in the URL; the ticket goes in the `hello` frame, with `resume_from`
 *    (the last `sid` seen) so the gateway replays what was missed, or says `reset` when it cannot.
 *  - SSE: `POST /realtime/sse/open {ticket, resume_from}` → `{stream}`, then `GET /realtime/sse?stream=` read as an
 *    event stream. A drop is picked up again with the same token and `Last-Event-ID` (the token stays good for 60 s
 *    after a drop), as EventSource would; past that, the caller opens a new stream.
 *
 * Both report the same JSON frames (`ready`, `event`, `ping`, `reset`, `resumed`, `restart`, `pong`, `subscribed`…)
 * and one `closed` with a WebSocket-style close code, so the caller decides what a close means in one place
 * (`closeAdvice`).
 */

/** `service` from the realtime ticket and `system.chat_service` (TRN-20, TRN-11). */
export interface ChatService {
  mode: 'builtin' | 'websocket' | string;
  configured?: string;
  ws_url?: string | null;
  sse_url?: string | null;
  fallback?: boolean;
  rollout?: { stage?: string; staff_at?: number; widgets_at?: number } | null;
}

/** `v2` from `GET /api/notifications/realtime-ticket` (plan 2.2). */
export interface TicketV2 {
  ticket: string;
  scopes: string;
  expires?: number;
  ws_url: string | null;
  sse_url: string | null;
  channels?: string[];
}

export interface V2Frame {
  type: string;
  [k: string]: unknown;
}

export interface ClosedInfo {
  /** A WebSocket close code; SSE maps its HTTP refusals onto the same (401 → 4401, 403 → 4403, 429 → 4429). */
  code: number | null;
  reason: string;
  /** From a `restart` frame or a 1012 reason `{"retry_ms":N}`. */
  retryMs: number | null;
  /** Whether `ready` had come before the close. */
  ready: boolean;
}

export interface TransportHandlers {
  frame(f: V2Frame): void;
  closed(info: ClosedInfo): void;
}

export interface Transport {
  readonly kind: 'websocket' | 'sse';
  /** Whether `hello` (or the stream's open) asked to resume from a sid. */
  readonly resumed: boolean;
  /** A client frame (WebSocket only): false on SSE, which is one-way, or a socket that is not open. */
  send(frame: object): boolean;
  /** Closes without reporting `closed`. */
  close(): void;
}

/** `w1-3,c10-12,t<token>` (Realtime::encodeScopes) as lists; `-` is none. */
export function parseScopes(scopes: string | null | undefined): { widgets: number[]; conversations: number[] } {
  const out = { widgets: [] as number[], conversations: [] as number[] };
  for (const group of String(scopes ?? '').split(',')) {
    const kind = group[0];
    if (kind !== 'w' && kind !== 'c') continue;
    const ids = group.slice(1).split('-').map(Number).filter((n) => Number.isSafeInteger(n) && n > 0);
    (kind === 'w' ? out.widgets : out.conversations).push(...ids);
  }
  return out;
}

/** The two channels of one conversation a member of staff hears. */
export function conversationChannels(id: number): string[] {
  return [`conv:${id}`, `conv:${id}:staff`];
}

/** `{"retry_ms":N}` in a 1012 close reason. */
export function retryFromReason(reason: string | null | undefined): number | null {
  if (!reason) return null;
  try {
    const n = Number((JSON.parse(reason) as { retry_ms?: unknown }).retry_ms);
    return Number.isFinite(n) && n >= 0 ? Math.min(n, 30_000) : null;
  } catch {
    return null;
  }
}

export type CloseAdvice =
  /** 1012: the gateway is restarting. Back after `retryMs`, resuming; not a failure of this transport. */
  | { kind: 'restart'; retryMs: number }
  /** 4401: a new ticket, then again. */
  | { kind: 'ticket' }
  /** 4403: a ticket that covers what was asked for (`?conversations=`), then again. */
  | { kind: 'scope' }
  /** 4029 / 4429: too many frames or sockets. Back off at least `minMs`; not this transport's fault. */
  | { kind: 'busy'; minMs: number }
  /** A drop of a working connection (4000, 4008, a network blip): back with `resume_from`. */
  | { kind: 'resume' }
  /** It never came up, or spoke wrongly: counts toward stepping down the chain. */
  | { kind: 'failure' };

const PROTOCOL_ERRORS = new Set([1002, 1003, 1007, 1009, 4400]);

/** What a close means (the contract's close codes). */
export function closeAdvice(info: ClosedInfo): CloseAdvice {
  const { code } = info;
  if (code === 1012) return { kind: 'restart', retryMs: Math.max(0, Math.min(5_000, info.retryMs ?? 2_000)) };
  if (code === 4401) return { kind: 'ticket' };
  if (code === 4403) return { kind: 'scope' };
  if (code === 4029) return { kind: 'busy', minMs: 15_000 };
  if (code === 4429) return { kind: 'busy', minMs: 60_000 };
  if (code === 4000 || code === 4008) return { kind: 'resume' };
  if (code !== null && PROTOCOL_ERRORS.has(code)) return { kind: 'failure' };
  return info.ready ? { kind: 'resume' } : { kind: 'failure' };
}

function parseFrame(text: string): V2Frame | null {
  try {
    const f = JSON.parse(text) as V2Frame;
    return f && typeof f === 'object' && typeof f.type === 'string' ? f : null;
  } catch {
    return null;
  }
}

type WebSocketCtor = new (url: string) => WebSocket;

/** A protocol-v2 socket: `hello` on open, frames out as they come, one `closed`. */
export function openV2Socket(WS: WebSocketCtor, url: string, hello: { ticket: string; resume_from?: number }, h: TransportHandlers): Transport {
  let done = false;
  let ready = false;
  let retryMs: number | null = null;
  const ws = new WS(url);
  const finish = (code: number | null, reason: string) => {
    if (done) return;
    done = true;
    try {
      ws.close();
    } catch {
      /* already closed */
    }
    h.closed({ code, reason, retryMs: retryMs ?? retryFromReason(reason), ready });
  };
  ws.onopen = () => {
    if (done) return;
    try {
      ws.send(JSON.stringify({ type: 'hello', ...hello }));
    } catch {
      finish(null, 'hello not sent');
    }
  };
  ws.onmessage = (msg) => {
    if (done) return;
    const f = parseFrame(typeof msg.data === 'string' ? msg.data : String(msg.data));
    if (!f) return;
    if (f.type === 'ready') ready = true;
    if (f.type === 'restart' && typeof f.retry_ms === 'number') retryMs = f.retry_ms;
    h.frame(f);
  };
  ws.onclose = (event) => finish(typeof event?.code === 'number' ? event.code : null, typeof event?.reason === 'string' ? event.reason : '');
  ws.onerror = () => finish(null, 'socket error');
  return {
    kind: 'websocket',
    resumed: hello.resume_from !== undefined,
    send(frame) {
      if (done) return false;
      try {
        ws.send(JSON.stringify(frame));
        return true;
      } catch {
        return false;
      }
    },
    close() {
      done = true;
      try {
        ws.close(1000, 'client');
      } catch {
        /* already closed */
      }
    },
  };
}

/**
 * Server-Sent Events, read line by line (the WHATWG rules the gateway uses: `id:`, `data:`, `retry:`, comments, a blank
 * line ends an event).
 */
export class SseParser {
  private buffer = '';
  private data: string[] = [];
  private id: string | null = null;
  /** The last `id:` seen: sent back as Last-Event-ID. */
  lastEventId: string | null = null;
  /** The last `retry:` seen, in ms. */
  retry: number | null = null;

  constructor(private readonly emit: (data: string, id: string | null) => void) {}

  push(chunk: string): void {
    this.buffer += chunk;
    let at: number;
    while ((at = this.buffer.search(/\r\n|\r|\n/)) >= 0) {
      const line = this.buffer.slice(0, at);
      const eol = this.buffer.startsWith('\r\n', at) ? 2 : 1;
      // A lone \r at the end of a chunk may be half of \r\n: wait for the next.
      if (eol === 1 && this.buffer[at] === '\r' && at === this.buffer.length - 1) return;
      this.buffer = this.buffer.slice(at + eol);
      this.line(line);
    }
  }

  private line(line: string): void {
    if (line === '') {
      if (this.data.length) {
        if (this.id !== null) this.lastEventId = this.id;
        this.emit(this.data.join('\n'), this.id);
      }
      this.data = [];
      this.id = null;
      return;
    }
    if (line.startsWith(':')) return;
    const colon = line.indexOf(':');
    const field = colon < 0 ? line : line.slice(0, colon);
    let value = colon < 0 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'data') this.data.push(value);
    else if (field === 'id' && !value.includes('\0')) this.id = value;
    else if (field === 'retry' && /^\d+$/.test(value)) this.retry = Number(value);
  }
}

export interface SseConfig {
  /** `…/realtime/sse` (the ticket's `sse_url`). */
  url: string;
  ticket: string;
  resumeFrom?: number;
}

/** How long after a drop the stream token is worth trying again (the gateway keeps it 60 s). */
const TOKEN_REUSE_MS = 55_000;

/**
 * An SSE stream through the app's own HTTP stack (never with the session's token: the gateway reads the ticket from
 * the open body). After `ready`, a dropped stream is reopened once with the same token and Last-Event-ID; a refusal
 * (401: the token is gone, say after a restart) or a second drop ends it, and the caller opens a new one.
 */
export function openSse(http: Pick<HttpClient, 'raw'>, cfg: SseConfig, h: TransportHandlers): Transport {
  let done = false;
  let ready = false;
  let retryMs: number | null = null;
  let abort: AbortController | null = null;
  let timer: NodeJS.Timeout | null = null;
  const parser = new SseParser((data) => {
    if (done) return;
    const f = parseFrame(data);
    if (!f) return;
    if (f.type === 'ready') ready = true;
    if (f.type === 'restart' && typeof f.retry_ms === 'number') retryMs = f.retry_ms;
    h.frame(f);
  });
  const finish = (code: number | null, reason: string) => {
    if (done) return;
    done = true;
    if (timer) clearTimeout(timer);
    abort?.abort();
    h.closed({ code, reason, retryMs, ready });
  };
  const httpCode = (status: number): number | null => (status === 401 ? 4401 : status === 403 ? 4403 : status === 429 ? 4429 : null);

  const read = async (token: string, again: boolean): Promise<void> => {
    abort = new AbortController();
    const headers: Record<string, string> = { Accept: 'text/event-stream', 'Cache-Control': 'no-cache' };
    if (parser.lastEventId) headers['Last-Event-ID'] = parser.lastEventId;
    const res = await http.raw('GET', `${cfg.url}?stream=${encodeURIComponent(token)}`, { auth: false, timeoutMs: 0, headers, signal: abort.signal, cache: 'no-store' });
    if (done) return;
    if (!res.ok || !res.body) {
      // The token is gone (401) after a drop: the caller opens a new stream, resuming from the last sid.
      finish(again && res.status === 401 ? null : httpCode(res.status), `stream ${res.status}`);
      return;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    try {
      for (;;) {
        const { value, done: end } = await reader.read();
        if (done) return;
        if (end) break;
        parser.push(decoder.decode(value, { stream: true }));
      }
    } catch {
      if (done) return;
    }
    if (done) return;
    // A restart said when to come back; otherwise the stream's own `retry:` (2 s from the gateway).
    if (ready && !again && retryMs === null) {
      const droppedAt = Date.now();
      timer = setTimeout(() => {
        timer = null;
        if (done) return;
        if (Date.now() - droppedAt > TOKEN_REUSE_MS) return finish(null, 'stream ended');
        void read(token, true).catch(() => finish(null, 'stream ended'));
      }, parser.retry ?? 2_000);
      timer.unref?.();
      return;
    }
    finish(retryMs !== null ? 1012 : null, 'stream ended');
  };

  void (async () => {
    abort = new AbortController();
    const body = JSON.stringify({ ticket: cfg.ticket, ...(cfg.resumeFrom !== undefined ? { resume_from: cfg.resumeFrom } : {}) });
    const res = await http.raw('POST', `${cfg.url}/open`, { auth: false, timeoutMs: 15_000, body, headers: { 'Content-Type': 'application/json' }, signal: abort.signal });
    if (done) return;
    if (!res.ok) return finish(httpCode(res.status), `open ${res.status}`);
    const answer = (await res.json().catch(() => null)) as { stream?: unknown } | null;
    if (done) return;
    if (typeof answer?.stream !== 'string' || !answer.stream) return finish(null, 'open: no stream');
    await read(answer.stream, false);
  })().catch(() => finish(null, 'stream error'));

  return {
    kind: 'sse',
    resumed: cfg.resumeFrom !== undefined,
    send: () => false,
    close() {
      done = true;
      if (timer) clearTimeout(timer);
      abort?.abort();
    },
  };
}

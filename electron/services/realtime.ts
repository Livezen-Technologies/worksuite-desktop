import { backoffDelay } from '@shared/backoff';
import { SeqSeen } from '@shared/chat-seq';
import type { RealtimeState, RealtimeTransport } from '@shared/types';
import { isDesktopError } from '../main/errors';
import { logger } from '../main/log';
import { ReceiptBatcher } from './chat-receipts';
import type { HttpClient } from './http';
import { closeAdvice, conversationChannels, openSse, openV2Socket, parseScopes, type ChatService, type ClosedInfo, type TicketV2, type Transport, type V2Frame } from './realtime-v2';

const log = logger('realtime');

/**
 * One managed CoreRealtime connection for the whole app (FR-RT-01), held in
 * the main process and fanned out to windows.
 *
 * THE CHAIN (plan 2.7; the server's docs/CHAT_DELIVERY.md "Phase 2"). Where the server runs the chat service on
 * WebSocket (`service.mode = websocket`, a `v2` ticket), this connects with protocol v2 — the ticket in the `hello`
 * frame, `resume_from` the last stream id (`sid`) seen — and steps down when that does not come up:
 *
 *     WebSocket v2  →  SSE (`/realtime/sse`)  →  built-in
 *
 * two failed attempts a step. Built-in is the gateway's older protocol v1 socket where the server still offers it
 * (`enabled`), else polling: the renderer's own polls keep every view current (FR-RT-03). While below WebSocket this
 * probes upward every PROBE_MS — a fresh ticket, and a candidate connection beside the current one that takes over once
 * it is ready (resuming from the last sid, so nothing is lost or doubled). Where the server's service is built-in, or
 * it predates v2, this is the v1 client it always was; the probe then only reads the ticket, to notice a switch.
 *
 * RESUME. A dropped v2 connection comes back with `resume_from`: the gateway replays what was missed and says
 * `resumed`, so no view needs to refetch. When it cannot (`reset`), after a change of transport, and after any v1
 * reconnect (v1 keeps no cursor), `onResync` tells every view to sync from REST, which stays authoritative. Events
 * are dropped by `sid` once seen (two connections overlap while one takes over), and a website message by its
 * conversation and seq as before (DLV-05).
 *
 * CLOSES. 1012 (the gateway restarting): back after its `retry_ms`, jittered. 4401: a fresh ticket. 4403: a fresh ticket
 * covering the conversations asked for. 4029 / 4429: back off. Anything that never reached `ready` counts toward the
 * step down.
 *
 * CHANNELS. `hello` names none, so the socket hears everything the ticket covers: `system`, `user:<me>`, the widgets I
 * staff and the chats I hold. A conversation a window shows (`watch`) is asked for in the ticket (`?conversations=`)
 * and subscribed on a live socket with a fresh ticket in the `subscribe`; SSE, which cannot subscribe, reopens.
 *
 * SWITCHING (plan 2.11). `system.chat_service` says the service changed: views sync first, then this moves at once —
 * to built-in by closing the v2 connection, to WebSocket by probing now.
 */

export interface RealtimeEvent {
  type: string;
  [k: string]: unknown;
}

interface Ticket {
  ticket: string;
  url: string;
  enabled: boolean;
  expires?: number;
  /** Protocol v2 (plan 2.2); absent from a server before it. */
  v2?: TicketV2 | null;
  service?: ChatService | null;
}

/** Longer than the gateway's heartbeat: a connected socket silent this long may be dead. */
const STALE_MS = 35_000;
/** How often a connection below WebSocket tries the transports above it. */
export const PROBE_MS = 5 * 60_000;
/** Failed attempts on one transport before the next one down. */
export const FAILS_PER_STEP = 2;
const TICKET_PATH = '/api/notifications/realtime-ticket';
/** The most conversations a ticket is asked to cover (the server keeps 150, newest first). */
const MAX_ASKED = 50;

/** WebSocket v2, SSE, then built-in. */
type Step = 0 | 1 | 2;
const STEP_OF: Record<RealtimeTransport, Step> = { websocket: 0, sse: 1, legacy: 2, polling: 2 };

type WebSocketCtor = new (url: string) => WebSocket;

/** The realtime host must belong to the server's own domain. */
export function realtimeUrlAllowed(url: string, serverOrigin: string, allowInsecure: boolean): boolean {
  try {
    const u = new URL(url);
    const s = new URL(serverOrigin);
    if (u.protocol !== 'wss:' && !(allowInsecure && u.protocol === 'ws:')) return false;
    if (u.username || u.password) return false;
    if (u.hostname === s.hostname) return true;
    const parent = s.hostname.split('.').slice(1).join('.');
    return parent.includes('.') && u.hostname.endsWith(`.${parent}`);
  } catch {
    return false;
  }
}

/** The SSE endpoint (`https://…/realtime/sse`) under the same rule. */
function sseUrlAllowed(url: string, serverOrigin: string, allowInsecure: boolean): boolean {
  return /^https?:\/\//i.test(url) && realtimeUrlAllowed(url.replace(/^https:/i, 'wss:').replace(/^http:/i, 'ws:'), serverOrigin, allowInsecure);
}

export class RealtimeService {
  private ws: WebSocket | null = null;
  private state: RealtimeState = 'idle';
  private attempt = 0;
  private retryTimer: NodeJS.Timeout | null = null;
  private watchdog: NodeJS.Timeout | null = null;
  private lastFrameAt = 0;
  private running = false;
  private generation = 0;
  private connecting = false;
  private lastDisconnect: string | null = null;
  private everConnected = false;
  onEvent: (e: RealtimeEvent) => void = () => undefined;
  onState: (s: RealtimeState) => void = () => undefined;
  /** Called after a reconnect: views must refetch what they show. */
  onResync: () => void = () => undefined;
  /** The gateway's answer to `sendPing` (worksuite-desktop#254), with the id sent. */
  onPong: (id: string) => void = () => undefined;
  /** The socket came back after a drop (worksuite-desktop#254: reconnects are counted for connection strength). */
  onReconnect: () => void = () => undefined;
  /** The transport changed (plan 2.7): for connection strength and the status bar. */
  onTransport: (t: RealtimeTransport | null) => void = () => undefined;
  private host: string | null = null;
  private readonly seen = new SeqSeen();
  /** `message.new` (the v2 channel event) is counted apart from `chat.widget.message`: both announce one message. */
  private readonly seenNew = new SeqSeen();

  // ---- protocol v2 (plan 2.7)
  /** The live v2 connection (WebSocket or SSE); the v1 socket is `ws`. */
  private v2: Transport | null = null;
  /** A connection of a higher step, coming up beside the current one (the probe, or SSE reopening for a new chat). */
  private candidate: Transport | null = null;
  private step: Step = 0;
  private stepFails = 0;
  /** 4401s in a row: one gets a fresh ticket at once, more count as failures. */
  private ticketRetries = 0;
  /** The last stream id seen, sent as `resume_from`. */
  private lastSid: number | null = null;
  private transport: RealtimeTransport | null = null;
  private service: ChatService | null = null;
  private probeTimer: NodeJS.Timeout | null = null;
  private probing = false;
  /** Gateway silence that means a dead connection: from `ready.dead_after_ms` on v2, 75 s on v1. */
  private deadAfterMs = 75_000;
  private userId: number | null = null;
  /** The latest v2 ticket, while it is good (60 s): a probe or a subscribe uses it rather than asking again. */
  private ticketV2: TicketV2 | null = null;
  /** What the ticket covers: the widgets I staff, the chats I hold or asked for. */
  private scope: { widgets: number[]; conversations: Set<number> } = { widgets: [], conversations: new Set() };
  /** Chats in scope because I hold them (not only because a window asked). */
  private held = new Set<number>();
  /** Channels the live v2 connection hears. */
  private channels = new Set<string>();
  /** Conversations windows show: conversation → the windows (webContents ids) showing it. */
  private readonly watchers = new Map<number, Set<number>>();
  private widening: Promise<void> | null = null;
  private widenAgain = false;
  /** Delivered and read receipts, batched by seq (plan 2.9). */
  readonly receipts: ReceiptBatcher;

  /** False for a website message whose conversation and seq were announced already; true for anything without them. */
  private firstSighting(e: RealtimeEvent): boolean {
    const conversation = Number(e.conversation_id);
    const seq = Number(e.seq);
    if (!Number.isSafeInteger(conversation) || conversation <= 0 || !Number.isSafeInteger(seq) || seq <= 0) return true;
    // The server's re-publish of a message no device acknowledged (DLV-09) is let through even when this seq was seen:
    // the acknowledgement goes again, and the person is told it is not reaching them.
    if (e.not_reaching_staff === true) return true;
    return (e.type === 'message.new' ? this.seenNew : this.seen).first(conversation, seq);
  }

  constructor(
    private readonly http: HttpClient,
    private readonly serverOrigin: () => string | null,
    private readonly allowInsecure: boolean,
    private readonly WS: WebSocketCtor = WebSocket,
  ) {
    this.receipts = new ReceiptBatcher(http);
  }

  diagnostics(): { attempt: number; lastDisconnect: string | null; transport?: RealtimeTransport | null; sid?: number | null } {
    return { attempt: this.attempt, lastDisconnect: this.lastDisconnect, transport: this.transport, sid: this.lastSid };
  }

  getState(): RealtimeState {
    return this.state;
  }

  /** How realtime reaches this computer now; null before the first connection. */
  getTransport(): RealtimeTransport | null {
    return this.transport;
  }

  /** The chat service the server last named (TRN-20). */
  chatService(): ChatService | null {
    return this.service;
  }

  /** The gateway's host, once a ticket named it. */
  gatewayHost(): string | null {
    return this.host;
  }

  /**
   * An echo request over the socket (worksuite-desktop#254): the gateway answers `ping:<id>` (v1) or
   * `{"type":"ping","id"}` (v2) with `{"type":"pong","id":"<id>"}`. A gateway from before that ignores it, and the
   * caller falls back to HTTP. False when there is no connected socket to send it on (SSE is one-way).
   */
  sendPing(id: string): boolean {
    if (this.state !== 'connected' || !/^[0-9a-z]{1,16}$/.test(id)) return false;
    if (this.v2) return this.v2.send({ type: 'ping', id });
    const ws = this.ws;
    if (!ws) return false;
    try {
      ws.send(`ping:${id}`);
      return true;
    } catch {
      return false;
    }
  }

  /** "Reconnect now" (worksuite-desktop#254): replace the socket even when it looks healthy. */
  reconnectNow(): void {
    if (!this.running) return;
    this.lastFrameAt = 0;
    this.attempt = 0;
    this.kick();
  }

  private setState(s: RealtimeState): void {
    if (s === this.state) return;
    this.state = s;
    this.onState(s);
  }

  /** @returns whether it changed from another transport (not from none) */
  private setTransport(t: RealtimeTransport | null): boolean {
    if (t === this.transport) return false;
    const before = this.transport;
    this.transport = t;
    log.info('realtime transport', { from: before, to: t });
    this.onTransport(t);
    return before !== null && t !== null;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.generation++;
    this.attempt = 0;
    this.step = 0;
    this.stepFails = 0;
    void this.connect();
  }

  stop(): void {
    this.running = false;
    this.generation++;
    this.connecting = false;
    this.everConnected = false;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.watchdog) clearInterval(this.watchdog);
    if (this.probeTimer) clearTimeout(this.probeTimer);
    this.retryTimer = null;
    this.watchdog = null;
    this.probeTimer = null;
    this.probing = false;
    this.dropV2();
    this.dropCandidate();
    const ws = this.ws;
    this.ws = null;
    try {
      ws?.close(1000, 'client stop');
    } catch {
      /* already closed */
    }
    this.lastSid = null;
    this.ticketV2 = null;
    this.userId = null;
    this.scope = { widgets: [], conversations: new Set() };
    this.held.clear();
    this.channels.clear();
    this.receipts.stop();
    this.setTransport(null);
    this.setState('idle');
  }

  /**
   * Reconnect now (network came back, resume from sleep). A socket that says
   * it is connected but has been silent past a heartbeat is replaced too:
   * after sleep it is usually dead without having closed (#114). A v2 or SSE
   * connection comes back resuming from its last sid (plan 2.12).
   */
  kick(): void {
    if (!this.running) return;
    if (this.state === 'connected') {
      if (Date.now() - this.lastFrameAt < STALE_MS) return;
      this.dropV2();
      const ws = this.ws;
      this.ws = null;
      try {
        ws?.close();
      } catch {
        /* already closed */
      }
      this.setState('down');
    }
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    void this.connect();
  }

  // ---- windows' conversations (plan 2.7)

  /**
   * A window shows (`on`) or stopped showing a website conversation: its channels are heard while any window shows
   * it. Asked for in the ticket so the gateway allows it; subscribed on a live socket now.
   */
  watch(sender: number, conversationId: number, on: boolean): void {
    if (!Number.isSafeInteger(conversationId) || conversationId <= 0) return;
    const set = this.watchers.get(conversationId) ?? new Set<number>();
    const before = set.size;
    if (on) set.add(sender);
    else set.delete(sender);
    if (set.size) this.watchers.set(conversationId, set);
    else this.watchers.delete(conversationId);
    if (before === 0 && set.size) this.listen(conversationId);
    else if (before > 0 && set.size === 0) this.unlisten(conversationId);
  }

  /** A window closed: everything it showed. */
  forget(sender: number): void {
    for (const [id, set] of [...this.watchers]) if (set.has(sender)) this.watch(sender, id, false);
  }

  /** Conversations windows show now. */
  watched(): number[] {
    return [...this.watchers.keys()];
  }

  /** Whether this person holds the chat, or a window shows it: its receipts are theirs to send. */
  holds(conversationId: number, e?: Record<string, unknown>): boolean {
    if (this.scope.conversations.has(conversationId) || this.watchers.has(conversationId)) return true;
    const me = this.userId;
    if (!me || !e) return false;
    if (Number(e.assigned_to) === me) return true;
    return Array.isArray(e.participants) && e.participants.some((p) => Number(typeof p === 'object' && p ? (p as { user_id?: unknown }).user_id : p) === me);
  }

  private listen(id: number): void {
    if (!this.v2 || this.state !== 'connected') return;
    const [conv, staff] = conversationChannels(id);
    if (this.channels.has(conv!) && this.channels.has(staff!)) return;
    if (this.scope.conversations.has(id) && this.v2.kind === 'websocket') {
      this.v2.send({ type: 'subscribe', channels: [conv, staff] });
      return;
    }
    void this.widen();
  }

  private unlisten(id: number): void {
    // A chat I hold stays heard: its list row and ring need it.
    if (!this.v2 || this.v2.kind !== 'websocket' || this.held.has(id)) return;
    const list = conversationChannels(id).filter((c) => this.channels.has(c));
    if (!list.length) return;
    this.v2.send({ type: 'unsubscribe', channels: list });
    for (const c of list) this.channels.delete(c);
  }

  /** A fresh ticket covering every conversation shown, then a `subscribe` with it (WebSocket) or a new stream (SSE). */
  private widen(): Promise<void> {
    if (this.widening) {
      this.widenAgain = true;
      return this.widening;
    }
    const generation = this.generation;
    this.widening = (async () => {
      do {
        this.widenAgain = false;
        let ticket: Ticket;
        try {
          ticket = await this.fetchTicket();
        } catch {
          return;
        }
        if (generation !== this.generation || !ticket.v2) return;
        this.adoptTicket(ticket);
        const live = this.v2;
        if (!live || this.state !== 'connected') return;
        const want = this.watched()
          .filter((id) => this.scope.conversations.has(id))
          .flatMap(conversationChannels)
          .filter((c) => !this.channels.has(c));
        if (!want.length) continue;
        if (live.kind === 'websocket') live.send({ type: 'subscribe', ticket: ticket.v2.ticket, channels: want });
        else if (!this.candidate) this.openCandidate('sse', ticket.v2);
      } while (this.widenAgain);
    })().finally(() => {
      this.widening = null;
    });
    return this.widening;
  }

  // ---- connecting

  private schedule(delayMs?: number): void {
    if (!this.running) return;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    const delay = delayMs ?? backoffDelay(this.attempt++, { baseMs: 1000, maxMs: 60_000, jitter: 0.5 });
    this.retryTimer = setTimeout(() => void this.connect(), delay);
    this.retryTimer.unref?.();
  }

  private fetchTicket(): Promise<Ticket> {
    const asked = this.watched().slice(-MAX_ASKED);
    return asked.length ? this.http.get<Ticket>(TICKET_PATH, { query: { conversations: asked.join(',') } }) : this.http.get<Ticket>(TICKET_PATH);
  }

  /** What a ticket says: the service, the v2 scope, who I am. */
  private adoptTicket(ticket: Ticket): void {
    if (ticket.service && typeof ticket.service.mode === 'string') this.service = ticket.service;
    const v1User = /^(\d+)\./.exec(ticket.ticket ?? '');
    if (v1User) this.userId = Number(v1User[1]);
    if (!ticket.v2?.ticket) {
      this.ticketV2 = null;
      return;
    }
    this.ticketV2 = ticket.v2;
    const asked = new Set(this.watched());
    const parsed = parseScopes(ticket.v2.scopes);
    const conversations = new Set(parsed.conversations);
    // Held: in scope without being asked for, or held before and asked for since.
    this.held = new Set([...conversations].filter((c) => !asked.has(c) || this.held.has(c)));
    this.scope = { widgets: parsed.widgets, conversations };
  }

  /** The v2 URLs this computer may use: on the server's own domain only. */
  private v2Urls(v2: TicketV2 | null | undefined, origin: string | null): { ws: boolean; sse: boolean } {
    if (!v2?.ticket || !origin) return { ws: false, sse: false };
    return {
      ws: !!v2.ws_url && realtimeUrlAllowed(v2.ws_url, origin, this.allowInsecure),
      sse: !!v2.sse_url && sseUrlAllowed(v2.sse_url, origin, this.allowInsecure),
    };
  }

  /** The highest transport at or below `from` the ticket offers. */
  private plan(ticket: Ticket, origin: string | null, from: Step): 'websocket' | 'sse' | 'builtin' {
    if (ticket.service?.mode !== 'websocket') return 'builtin';
    const urls = this.v2Urls(ticket.v2, origin);
    if (from <= 0 && urls.ws) return 'websocket';
    if (from <= 1 && urls.sse) return 'sse';
    return 'builtin';
  }

  private async connect(): Promise<void> {
    if (!this.running || this.connecting || this.ws || this.v2) return;
    const generation = this.generation;
    const origin = this.serverOrigin();
    this.connecting = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.setState('connecting');
    let ticket: Ticket;
    try {
      ticket = await this.fetchTicket();
    } catch (e) {
      if (!this.running || generation !== this.generation) return;
      this.lastDisconnect = isDesktopError(e) ? `ticket: ${e.code}` : 'ticket request failed';
      log.debug('ticket unavailable', { code: isDesktopError(e) ? e.code : String(e) });
      this.setState('down');
      this.schedule();
      return;
    } finally {
      if (generation === this.generation) this.connecting = false;
    }
    if (!this.running || generation !== this.generation || origin !== this.serverOrigin()) return;
    // A probe's connection took over while the ticket was on its way: nothing more to open.
    if (this.ws || this.v2) return;
    this.adoptTicket(ticket);
    const plan = this.plan(ticket, origin, this.step);
    // Below WebSocket on a server that offers it, or on the built-in service of one that could switch: look up later.
    if (ticket.v2?.ticket && plan !== 'websocket') this.scheduleProbe();
    if (plan !== 'builtin' && ticket.v2) {
      this.step = plan === 'websocket' ? 0 : 1;
      this.openV2(plan, ticket.v2, generation);
      return;
    }
    this.step = 2;
    this.openV1(ticket, origin, generation);
  }

  // ---- protocol v1 (unchanged, the built-in step)

  private openV1(ticket: Ticket, origin: string | null, generation: number): void {
    if (!ticket.enabled || !ticket.url) {
      // The installation runs without the gateway: poll, and retry rarely.
      this.setTransport('polling');
      this.setState('disabled');
      this.retryTimer = setTimeout(() => void this.connect(), 15 * 60_000);
      this.retryTimer.unref?.();
      return;
    }
    if (!origin || !realtimeUrlAllowed(ticket.url, origin, this.allowInsecure)) {
      log.warn('realtime URL outside the server domain; not connecting', { url: ticket.url.slice(0, 80) });
      this.setTransport('polling');
      this.setState('disabled');
      return;
    }
    try {
      this.host = new URL(ticket.url).host;
    } catch {
      this.host = null;
    }
    const url = `${ticket.url}${ticket.url.includes('?') ? '&' : '?'}ticket=${encodeURIComponent(ticket.ticket)}`;
    let ws: WebSocket;
    try {
      ws = new this.WS(url);
    } catch (e) {
      log.warn('websocket construction failed', { error: String(e) });
      this.setState('down');
      this.schedule();
      return;
    }
    this.ws = ws;
    this.deadAfterMs = 75_000;
    const openedAt = Date.now();
    ws.onmessage = (msg) => {
      if (this.ws !== ws || !this.running || generation !== this.generation) return;
      let data: RealtimeEvent;
      try {
        data = JSON.parse(typeof msg.data === 'string' ? msg.data : String(msg.data)) as RealtimeEvent;
      } catch {
        return;
      }
      if (!data || typeof data.type !== 'string') return;
      this.lastFrameAt = Date.now();
      if (data.type === 'ready') {
        if (this.state === 'connected') return;
        if (typeof data.user_id === 'number') this.userId = data.user_id;
        const wasReconnect = this.everConnected;
        this.everConnected = true;
        this.attempt = 0;
        // v1 keeps no cursor: a sid from a v2 connection means nothing to it.
        this.lastSid = null;
        const changed = this.setTransport('legacy');
        this.setState('connected');
        if (wasReconnect) {
          if (!changed) this.onReconnect();
          this.onResync();
        }
        return;
      }
      if (data.type === 'pong') {
        this.onPong(typeof data.id === 'string' ? data.id : '');
        return;
      }
      if (data.type === 'ping') return;
      if (this.state === 'connected') this.deliver(data);
    };
    const disconnect = (reason: string, code?: number) => {
      if (this.ws !== ws || generation !== this.generation) return;
      this.ws = null;
      if (this.watchdog) clearInterval(this.watchdog);
      this.watchdog = null;
      this.lastDisconnect = reason;
      log.info('realtime disconnected', { reason, code, attempt: this.attempt });
      try { ws.close(); } catch { /* already closed */ }
      if (!this.running) return;
      this.setState('down');
      this.schedule();
    };
    ws.onclose = event => disconnect('socket closed', event.code);
    ws.onerror = () => disconnect('socket error');
    this.lastFrameAt = Date.now();
    this.startWatchdog(openedAt, () => this.ws === ws, (reason) => disconnect(reason));
  }

  /** The gateway pings every 15–30 s; silence past `deadAfterMs` means a dead connection. */
  private startWatchdog(openedAt: number, current: () => boolean, drop: (reason: string) => void): void {
    if (this.watchdog) clearInterval(this.watchdog);
    this.watchdog = setInterval(() => {
      if (!current()) return;
      if (this.state !== 'connected' && Date.now() - openedAt >= 30_000) drop('gateway ready timeout');
      else if (Date.now() - this.lastFrameAt > this.deadAfterMs) drop('heartbeat timeout');
    }, 15_000);
    this.watchdog.unref?.();
  }

  // ---- protocol v2: WebSocket and SSE

  private open(kind: 'websocket' | 'sse', v2: TicketV2, generation: number): Transport {
    const resume = this.lastSid !== null ? { resume_from: this.lastSid } : {};
    let t: Transport | null = null;
    const handlers = {
      frame: (f: V2Frame) => {
        if (t && generation === this.generation) this.onFrame(t, f);
      },
      closed: (info: ClosedInfo) => {
        if (t && generation === this.generation) this.onClosed(t, info);
      },
    };
    t =
      kind === 'websocket'
        ? openV2Socket(this.WS, v2.ws_url!, { ticket: v2.ticket, ...resume }, handlers)
        : openSse(this.http, { url: v2.sse_url!, ticket: v2.ticket, ...(this.lastSid !== null ? { resumeFrom: this.lastSid } : {}) }, handlers);
    try {
      this.host = new URL(kind === 'websocket' ? v2.ws_url! : v2.sse_url!).host;
    } catch {
      /* the host is for display only */
    }
    return t;
  }

  private openV2(kind: 'websocket' | 'sse', v2: TicketV2, generation: number): void {
    let t: Transport;
    try {
      t = this.open(kind, v2, generation);
    } catch (e) {
      log.warn('realtime transport could not open', { kind, error: String(e) });
      this.failed();
      return;
    }
    this.v2 = t;
    this.channels.clear();
    this.lastFrameAt = Date.now();
    this.startWatchdog(Date.now(), () => this.v2 === t, (reason) => {
      if (this.v2 !== t) return;
      this.dropV2();
      this.onClosed(t, { code: null, reason, retryMs: null, ready: this.state === 'connected' }, true);
    });
  }

  /** A connection of a higher step beside the current one; it takes over once ready. */
  private openCandidate(kind: 'websocket' | 'sse', v2: TicketV2): void {
    this.dropCandidate();
    try {
      this.candidate = this.open(kind, v2, this.generation);
    } catch (e) {
      log.debug('probe could not open', { kind, error: String(e) });
      this.candidate = null;
      this.scheduleProbe();
    }
  }

  private dropV2(): void {
    const t = this.v2;
    this.v2 = null;
    t?.close();
    this.channels.clear();
  }

  private dropCandidate(): void {
    const t = this.candidate;
    this.candidate = null;
    t?.close();
  }

  private onFrame(t: Transport, f: V2Frame): void {
    if (t === this.candidate && f.type === 'ready') this.promote(t);
    if (t !== this.v2) return;
    this.lastFrameAt = Date.now();
    switch (f.type) {
      case 'ready':
        this.ready(t, f);
        return;
      case 'event':
        if (this.state === 'connected') this.event(f);
        return;
      case 'reset':
        // Resume impossible: every view syncs, then this carries on from the gateway's sid.
        if (typeof f.sid === 'number') this.lastSid = f.sid;
        log.info('realtime resume reset', { reason: f.reason });
        this.onResync();
        return;
      case 'resumed':
        if (typeof f.to === 'number') this.lastSid = Math.max(this.lastSid ?? 0, f.to);
        return;
      case 'pong':
        this.onPong(typeof f.id === 'string' ? f.id : '');
        return;
      case 'subscribed':
        for (const c of Array.isArray(f.channels) ? f.channels : []) if (typeof c === 'string') this.channels.add(c);
        for (const c of Array.isArray(f.dropped) ? f.dropped : []) if (typeof c === 'string') this.channels.delete(c);
        return;
      case 'unsubscribed':
        for (const c of Array.isArray(f.channels) ? f.channels : []) if (typeof c === 'string' && c !== 'system') this.channels.delete(c);
        return;
      case 'error':
        log.debug('realtime gateway error frame', { code: f.code });
        return;
      default:
        // ping, restart (its retry_ms comes with the close): nothing else to do.
        return;
    }
  }

  private ready(t: Transport, f: V2Frame): void {
    if (typeof f.user_id === 'number') this.userId = f.user_id;
    if (typeof f.dead_after_ms === 'number' && f.dead_after_ms > 0) this.deadAfterMs = f.dead_after_ms;
    else this.deadAfterMs = 45_000;
    this.channels = new Set((Array.isArray(f.channels) ? f.channels : []).filter((c): c is string => typeof c === 'string'));
    // The first sid: from here on, `resume_from` (a resume keeps its own, and the replay moves it on).
    if (this.lastSid === null && typeof f.sid === 'number') this.lastSid = f.sid;
    if (this.state === 'connected' && this.transport === t.kind) return;
    const wasReconnect = this.everConnected;
    this.everConnected = true;
    this.attempt = 0;
    this.stepFails = 0;
    this.ticketRetries = 0;
    const changed = this.setTransport(t.kind);
    this.setState('connected');
    if (wasReconnect && !changed) this.onReconnect();
    // A new transport, or a reconnect that could not ask to resume: views sync. A resume says `resumed` or `reset`.
    if (changed || (wasReconnect && !t.resumed)) this.onResync();
    // Conversations windows show that the ticket did not cover when it was asked for.
    if (this.watched().some((id) => !this.channels.has(conversationChannels(id)[0]!))) void this.widen();
    if (t.kind !== 'websocket') this.scheduleProbe();
    else this.clearProbe();
  }

  private event(f: V2Frame): void {
    const sid = Number(f.sid);
    if (Number.isSafeInteger(sid)) {
      // Two connections overlap while one takes over, and a replay may repeat what came live: once each.
      if (this.lastSid !== null && sid <= this.lastSid) return;
      this.lastSid = sid;
    }
    const data = f.data as RealtimeEvent | undefined;
    if (!data || typeof data !== 'object' || typeof data.type !== 'string') return;
    if (data.type === 'system.chat_service') this.serviceChanged(data);
    this.deliver(data);
  }

  /** To the app: a website message announced twice reaches it once (DLV-05, plan 1.9), and is acknowledged (2.9). */
  private deliver(data: RealtimeEvent): void {
    if ((data.type === 'chat.widget.message' || data.type === 'message.new') && !this.firstSighting(data)) return;
    this.receipts.fromEvent(data, (id, e) => this.holds(id, e));
    this.onEvent(data);
  }

  /** Took over from the connection below it (a probe, or SSE reopened for a new chat). */
  private promote(t: Transport): void {
    this.candidate = null;
    const old = this.v2;
    this.v2 = null;
    old?.close();
    const ws = this.ws;
    this.ws = null;
    try {
      ws?.close(1000, 'upgraded');
    } catch {
      /* already closed */
    }
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.v2 = t;
    this.step = STEP_OF[t.kind];
    this.stepFails = 0;
    this.lastFrameAt = Date.now();
    this.startWatchdog(Date.now(), () => this.v2 === t, (reason) => {
      if (this.v2 !== t) return;
      this.dropV2();
      this.onClosed(t, { code: null, reason, retryMs: null, ready: true }, true);
    });
  }

  private onClosed(t: Transport, info: ClosedInfo, dropped = false): void {
    if (t === this.candidate) {
      this.candidate = null;
      this.probeFailed(t.kind);
      return;
    }
    if (t !== this.v2 && !dropped) return;
    if (!dropped) this.v2 = null;
    this.channels.clear();
    if (this.watchdog) clearInterval(this.watchdog);
    this.watchdog = null;
    this.lastDisconnect = `${t.kind} ${info.code ?? ''} ${info.reason}`.trim();
    log.info('realtime disconnected', { transport: t.kind, code: info.code, reason: info.reason.slice(0, 80), attempt: this.attempt });
    if (!this.running) return;
    this.setState('down');
    const advice = closeAdvice(info);
    switch (advice.kind) {
      case 'restart':
        // The gateway's own spread (0–5 s) and a little of ours: everybody does not come back in the same instant.
        this.schedule(advice.retryMs + Math.round(Math.random() * 250));
        return;
      case 'ticket':
        if (++this.ticketRetries <= 1) this.schedule(0);
        else this.failed();
        return;
      case 'scope':
        // The next ticket asks for every conversation shown; one not allowed is then simply not subscribed.
        this.schedule(++this.ticketRetries <= 1 ? 0 : undefined);
        return;
      case 'busy':
        this.schedule(Math.max(advice.minMs, backoffDelay(this.attempt++, { baseMs: 1000, maxMs: 60_000, jitter: 0.5 })));
        return;
      case 'resume':
        this.schedule(this.attempt === 0 ? Math.round(Math.random() * 1000) : undefined);
        if (this.attempt === 0) this.attempt = 1;
        return;
      case 'failure':
        this.failed();
        return;
    }
  }

  /** One more failure on this step: the next step down after FAILS_PER_STEP. */
  private failed(): void {
    if (++this.stepFails >= FAILS_PER_STEP && this.step < 2) {
      this.step = (this.step + 1) as Step;
      this.stepFails = 0;
      this.ticketRetries = 0;
      log.info('realtime stepping down', { to: ['websocket', 'sse', 'builtin'][this.step] });
      this.schedule(0);
      return;
    }
    this.schedule();
  }

  // ---- probing upward, and switching (plans 2.7, 2.11)

  private scheduleProbe(delayMs = PROBE_MS): void {
    if (!this.running || this.probeTimer) return;
    this.probeTimer = setTimeout(() => {
      this.probeTimer = null;
      void this.probe(0);
    }, delayMs);
    this.probeTimer.unref?.();
  }

  private clearProbe(): void {
    if (this.probeTimer) clearTimeout(this.probeTimer);
    this.probeTimer = null;
  }

  /** Try the transports above the current one, from `from` down; one that comes up takes over. */
  private async probe(from: Step): Promise<void> {
    if (!this.running || this.probing || this.candidate) return;
    // A connection being made now: look again later rather than beside it.
    if (this.connecting) return this.scheduleProbe();
    const current = this.transport;
    if (current === 'websocket' && this.v2) return;
    const generation = this.generation;
    this.probing = true;
    let ticket: Ticket;
    try {
      ticket = await this.fetchTicket();
    } catch {
      this.probing = false;
      this.scheduleProbe();
      return;
    }
    this.probing = false;
    if (!this.running || generation !== this.generation) return;
    this.adoptTicket(ticket);
    const best = this.plan(ticket, this.serverOrigin(), from);
    const here: Step = current && (this.v2 || this.ws || current === 'polling') ? STEP_OF[current] : 2;
    if (best === 'builtin') {
      // The service went back to built-in while this was on v2: move now.
      if (ticket.service?.mode !== 'websocket' && (current === 'websocket' || current === 'sse')) this.restartAt(2);
      else this.scheduleProbe();
      return;
    }
    if (STEP_OF[best] >= here) {
      this.scheduleProbe();
      return;
    }
    // Nothing up at all (between attempts): connect at the better step rather than beside nothing.
    if (!this.v2 && !this.ws && current !== 'polling') {
      this.step = STEP_OF[best];
      this.stepFails = 0;
      if (this.retryTimer) {
        clearTimeout(this.retryTimer);
        this.retryTimer = null;
        void this.connect();
      }
      return;
    }
    this.openCandidate(best, ticket.v2!);
  }

  private probeFailed(kind: 'websocket' | 'sse'): void {
    const here = this.transport ? STEP_OF[this.transport] : 2;
    // WebSocket would not come up from here: SSE may, when that is still a step up.
    if (kind === 'websocket' && here > 1) void this.probe(1);
    else this.scheduleProbe();
  }

  /** Close what is up and connect again at `step`, now. */
  private restartAt(step: Step): void {
    this.step = step;
    this.stepFails = 0;
    this.dropCandidate();
    this.dropV2();
    const ws = this.ws;
    this.ws = null;
    try {
      ws?.close(1000, 'switch');
    } catch {
      /* already closed */
    }
    if (this.watchdog) clearInterval(this.watchdog);
    this.watchdog = null;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.setState('connecting');
    void this.connect();
  }

  /** `system.chat_service` (plan 2.11): views sync first, then the switch happens now. */
  private serviceChanged(e: RealtimeEvent): void {
    const service = e.service as ChatService | undefined;
    if (!service || typeof service.mode !== 'string') return;
    const before = this.service?.mode ?? null;
    this.service = service;
    if (service.mode === 'builtin' && (this.transport === 'websocket' || this.transport === 'sse')) {
      log.info('chat service switched to built-in');
      this.onResync();
      // Not from inside this connection's own frame handler.
      queueMicrotask(() => {
        if (this.running) this.restartAt(2);
      });
    } else if (service.mode === 'websocket' && this.transport !== 'websocket' && before !== 'websocket') {
      log.info('chat service switched to WebSocket');
      this.onResync();
      this.clearProbe();
      queueMicrotask(() => void this.probe(0));
    } else if (service.mode === 'websocket' && this.transport === 'sse') {
      this.clearProbe();
      queueMicrotask(() => void this.probe(0));
    }
  }
}

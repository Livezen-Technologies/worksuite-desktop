import { backoffDelay } from '@shared/backoff';
import type { RealtimeState } from '@shared/types';
import { isDesktopError } from '../main/errors';
import { logger } from '../main/log';
import type { HttpClient } from './http';

const log = logger('realtime');

/**
 * One managed CoreRealtime connection for the whole app (FR-RT-01), held in
 * the main process and fanned out to windows.
 *
 * WorkSuite's gateway is a plain WebSocket, server → client only, opened with
 * a one-minute ticket from GET /api/notifications/realtime-ticket. It keeps no
 * event cursor, so recovery (FR-RT-02, WF-18) is: reconnect with backoff and
 * jitter (1 s → 60 s), then tell every view to refetch from REST, which stays
 * authoritative (FR-RT-03). A server that does not run the gateway leaves the
 * app LIMITED, polling instead.
 */

export interface RealtimeEvent {
  type: string;
  [k: string]: unknown;
}

interface Ticket {
  ticket: string;
  url: string;
  enabled: boolean;
}

/** Longer than the gateway's 30 s ping: a connected socket silent this long may be dead. */
const STALE_MS = 35_000;

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
  private host: string | null = null;

  constructor(
    private readonly http: HttpClient,
    private readonly serverOrigin: () => string | null,
    private readonly allowInsecure: boolean,
    private readonly WS: WebSocketCtor = WebSocket,
  ) {}

  diagnostics(): { attempt: number; lastDisconnect: string | null } { return { attempt: this.attempt, lastDisconnect: this.lastDisconnect }; }

  getState(): RealtimeState {
    return this.state;
  }

  /** The gateway's host, once a ticket named it. */
  gatewayHost(): string | null {
    return this.host;
  }

  /**
   * An echo request over the socket (worksuite-desktop#254): the gateway answers `ping:<id>` with
   * `{"type":"pong","id":"<id>"}`. A gateway from before that ignores it, and the caller falls back to HTTP.
   * False when there is no connected socket to send it on.
   */
  sendPing(id: string): boolean {
    const ws = this.ws;
    if (this.state !== 'connected' || !ws || !/^[0-9a-z]{1,16}$/.test(id)) return false;
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

  start(): void {
    if (this.running) return;
    this.running = true;
    this.generation++;
    this.attempt = 0;
    void this.connect();
  }

  stop(): void {
    this.running = false;
    this.generation++;
    this.connecting = false;
    this.everConnected = false;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.watchdog) clearInterval(this.watchdog);
    this.retryTimer = null;
    this.watchdog = null;
    const ws = this.ws;
    this.ws = null;
    try {
      ws?.close(1000, 'client stop');
    } catch {
      /* already closed */
    }
    this.setState('idle');
  }

  /**
   * Reconnect now (network came back, resume from sleep). A socket that says
   * it is connected but has been silent past a heartbeat is replaced too:
   * after sleep it is usually dead without having closed (#114).
   */
  kick(): void {
    if (!this.running) return;
    if (this.state === 'connected') {
      if (Date.now() - this.lastFrameAt < STALE_MS) return;
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

  private schedule(): void {
    if (!this.running) return;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    const delay = backoffDelay(this.attempt++, { baseMs: 1000, maxMs: 60_000, jitter: 0.5 });
    this.retryTimer = setTimeout(() => void this.connect(), delay);
    this.retryTimer.unref?.();
  }

  private async connect(): Promise<void> {
    if (!this.running || this.connecting || this.ws) return;
    const generation = this.generation;
    const origin = this.serverOrigin();
    this.connecting = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.setState('connecting');
    let ticket: Ticket;
    try {
      ticket = await this.http.get<Ticket>('/api/notifications/realtime-ticket');
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
    if (!ticket.enabled || !ticket.url) {
      // The installation runs without the gateway: poll, and retry rarely.
      this.setState('disabled');
      this.retryTimer = setTimeout(() => void this.connect(), 15 * 60_000);
      this.retryTimer.unref?.();
      return;
    }
    if (!origin || !realtimeUrlAllowed(ticket.url, origin, this.allowInsecure)) {
      log.warn('realtime URL outside the server domain; not connecting', { url: ticket.url.slice(0, 80) });
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
        const wasReconnect = this.everConnected;
        this.everConnected = true;
        this.attempt = 0;
        this.setState('connected');
        if (wasReconnect) {
          this.onReconnect();
          this.onResync();
        }
        return;
      }
      if (data.type === 'pong') {
        this.onPong(typeof data.id === 'string' ? data.id : '');
        return;
      }
      if (data.type === 'ping') return;
      if (this.state === 'connected') this.onEvent(data);
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
    if (this.watchdog) clearInterval(this.watchdog);
    // The gateway pings every 30 s; silence for 75 s means a dead socket.
    this.watchdog = setInterval(() => {
      if (this.ws !== ws) return;
      if (this.state !== 'connected' && Date.now() - openedAt >= 30_000) disconnect('gateway ready timeout');
      else if (Date.now() - this.lastFrameAt > 75_000) disconnect('heartbeat timeout');
    }, 15_000);
    this.watchdog.unref?.();
  }
}

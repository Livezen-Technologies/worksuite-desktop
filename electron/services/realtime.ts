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
  private everConnected = false;
  onEvent: (e: RealtimeEvent) => void = () => undefined;
  onState: (s: RealtimeState) => void = () => undefined;
  /** Called after a reconnect: views must refetch what they show. */
  onResync: () => void = () => undefined;

  constructor(
    private readonly http: HttpClient,
    private readonly serverOrigin: () => string | null,
    private readonly allowInsecure: boolean,
    private readonly WS: WebSocketCtor = WebSocket,
  ) {}

  getState(): RealtimeState {
    return this.state;
  }

  private setState(s: RealtimeState): void {
    if (s === this.state) return;
    this.state = s;
    this.onState(s);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.attempt = 0;
    void this.connect();
  }

  stop(): void {
    this.running = false;
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

  /** Reconnect now (network came back, resume from sleep). */
  kick(): void {
    if (!this.running) return;
    if (this.state === 'connected') return;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    void this.connect();
  }

  private schedule(): void {
    if (!this.running) return;
    const delay = backoffDelay(this.attempt++, { baseMs: 1000, maxMs: 60_000, jitter: 0.5 });
    this.retryTimer = setTimeout(() => void this.connect(), delay);
    this.retryTimer.unref?.();
  }

  private async connect(): Promise<void> {
    if (!this.running) return;
    this.setState('connecting');
    let ticket: Ticket;
    try {
      ticket = await this.http.get<Ticket>('/api/notifications/realtime-ticket');
    } catch (e) {
      log.debug('ticket unavailable', { code: isDesktopError(e) ? e.code : String(e) });
      this.setState('down');
      this.schedule();
      return;
    }
    if (!ticket.enabled || !ticket.url) {
      // The installation runs without the gateway: poll, and retry rarely.
      this.setState('disabled');
      this.retryTimer = setTimeout(() => void this.connect(), 15 * 60_000);
      this.retryTimer.unref?.();
      return;
    }
    const origin = this.serverOrigin();
    if (!origin || !realtimeUrlAllowed(ticket.url, origin, this.allowInsecure)) {
      log.warn('realtime URL outside the server domain; not connecting', { url: ticket.url.slice(0, 80) });
      this.setState('disabled');
      return;
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
    ws.onmessage = (msg) => {
      this.lastFrameAt = Date.now();
      let data: RealtimeEvent;
      try {
        data = JSON.parse(typeof msg.data === 'string' ? msg.data : String(msg.data)) as RealtimeEvent;
      } catch {
        return;
      }
      if (!data || typeof data.type !== 'string') return;
      if (data.type === 'ready') {
        const wasReconnect = this.everConnected;
        this.everConnected = true;
        this.attempt = 0;
        this.setState('connected');
        if (wasReconnect) this.onResync();
        return;
      }
      if (data.type === 'ping' || data.type === 'pong') return;
      this.onEvent(data);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (!this.running) return;
      this.setState('down');
      this.schedule();
    };
    ws.onerror = () => {
      /* onclose follows */
    };
    this.lastFrameAt = Date.now();
    if (this.watchdog) clearInterval(this.watchdog);
    // The gateway pings every 30 s; silence for 75 s means a dead socket.
    this.watchdog = setInterval(() => {
      if (this.ws === ws && Date.now() - this.lastFrameAt > 75_000) {
        log.info('realtime heartbeat missed; reconnecting');
        try {
          ws.close();
        } catch {
          /* ignore */
        }
      }
    }, 15_000);
    this.watchdog.unref?.();
  }
}

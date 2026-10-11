import type { BrowserWindow } from 'electron';
import type { ActiveCall } from '@shared/types';
import { logger } from '../main/log';
import type { WindowManager } from '../windows/manager';
import type { HttpClient } from './http';
import type { RealtimeEvent } from './realtime';

const log = logger('calls');

/** What `chat.call.ringing` and `GET /api/chat/calls/ringing` carry. */
export interface Ringing {
  uuid: string;
  room_id: number;
  room_name?: string | null;
  caller_name?: string | null;
  mode?: string;
  silent?: boolean;
  expires_in?: number;
}

const UUID = /^[A-Za-z0-9-]{8,64}$/;

/** The ring window's route for an incoming call; null when the payload is not one. */
export function ringRoute(r: Partial<Ringing> | null | undefined): string | null {
  if (!r || typeof r.uuid !== 'string' || !UUID.test(r.uuid) || !Number.isInteger(Number(r.room_id))) return null;
  const q: Record<string, string> = {
    uuid: r.uuid,
    room_id: String(r.room_id),
    name: String(r.caller_name ?? 'Someone').slice(0, 120),
    mode: r.mode === 'video' ? 'video' : 'audio',
    silent: r.silent ? '1' : '0',
    expires: String(Math.max(1, Math.min(60, Number(r.expires_in ?? 45) || 45))),
  };
  if (r.room_name) q.room = String(r.room_name).slice(0, 120);
  // Percent-encoded throughout (a route never carries "+").
  return `/calls/ring?${Object.entries(q).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')}`;
}

/** What `meet.ring` and `GET /api/meet/rings/ringing` carry: somebody ringing this person into a meeting (worksuite-desktop#79). */
export interface MeetRinging {
  ring_id: number;
  uuid: string;
  title?: string | null;
  inviter_name?: string | null;
  silent?: boolean;
  expires_in?: number;
}

/** The ring window's route for a meeting invitation (Meet's own screen); null when the payload is not one. */
export function meetRingRoute(r: Partial<MeetRinging> | null | undefined): string | null {
  if (!r || typeof r.uuid !== 'string' || !UUID.test(r.uuid) || !Number.isInteger(Number(r.ring_id)) || Number(r.ring_id) <= 0) return null;
  const q: Record<string, string> = {
    ring: String(Number(r.ring_id)),
    uuid: r.uuid,
    name: String(r.inviter_name ?? 'Someone').slice(0, 120),
    title: String(r.title ?? 'Meeting').slice(0, 160),
    silent: r.silent ? '1' : '0',
    expires: String(Math.max(1, Math.min(60, Number(r.expires_in ?? 45) || 45))),
  };
  return `/meet/ring?${Object.entries(q).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')}`;
}

/**
 * Chat calls in the shell (FR-COM): an incoming call opens its own small
 * always-on-top window wherever the person is, and a call window that closes
 * — by its close button, a crash or quitting — hangs up on the server, which
 * a page cannot do reliably for itself (a beacon carries no credentials).
 */
export class CallService {
  private rung = new Map<string, number>();
  private active = new Map<number, { uuid: string; kind: 'call' | 'meet'; title: string; since: number }>();
  onActiveChanged: (active: boolean) => void = () => undefined;
  /** The list changed: main broadcasts it to every window (`calls:changed`). */
  onListChanged: (list: ActiveCall[]) => void = () => undefined;

  constructor(
    private readonly windows: WindowManager,
    private readonly http: HttpClient,
    /** Signed in, not locked: a ring may show who is calling. */
    private readonly canRing: () => boolean,
    /** The same, for a meeting invitation: Meet is the app it opens. */
    private readonly canRingMeet: () => boolean = canRing,
  ) {}

  attention: ((key: string, context: string) => Promise<boolean>) | null = null;
  canShowRing(): boolean { return this.canRing(); }

  handle(e: RealtimeEvent): void {
    if (e.type === 'chat.call.ringing') this.ring(e as unknown as Ringing);
    else if (e.type === 'meet.ring') this.ringMeet(e as unknown as MeetRinging);
  }

  private pollTimer: NodeJS.Timeout | null = null;

  /**
   * Without the realtime connection nothing announces a ring, so ask — every
   * 5 s while it is down, as the web does, and now and then while it is up
   * in case an event was lost.
   */
  poll(realtimeUp: () => boolean): void {
    if (this.pollTimer) return;
    let tick = 0;
    this.pollTimer = setInterval(() => {
      tick++;
      if (!realtimeUp() || tick % 6 === 0) void this.check();
    }, 5_000);
    this.pollTimer.unref?.();
  }

  stop(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
  }

  /** On start and after a reconnect: a call — or a meeting invitation — that rang while we were away. */
  async check(): Promise<void> {
    if (this.canRing()) {
      try {
        const r = await this.http.get<Ringing | null>('/api/chat/calls/ringing');
        if (r) this.ring(r);
      } catch (e) {
        log.debug('ringing check failed', { error: String(e) });
      }
    }
    if (this.canRingMeet()) {
      try {
        const r = await this.http.get<MeetRinging | null>('/api/meet/rings/ringing');
        if (r) this.ringMeet(r);
      } catch (e) {
        // An older server has no meeting rings.
        log.debug('meeting ring check failed', { error: String(e) });
      }
    }
  }

  /**
   * Somebody rings this person into a meeting that is on. Once per ring; not
   * for a meeting this device is already in. Stopping it — answered here or
   * on another device, cancelled, given up, the meeting ended — is the ring
   * window's, which hears `meet.ring.stopped`.
   */
  ringMeet(r: MeetRinging): void {
    const route = meetRingRoute(r);
    if (!route || !this.canRingMeet()) return;
    const key = `meet-ring-${r.ring_id}`;
    const now = Date.now();
    for (const [u, at] of this.rung) if (now - at > 120_000) this.rung.delete(u);
    if (this.rung.has(key) || [...this.active.values()].some((a) => a.uuid === r.uuid)) return;
    this.rung.set(key, now);
    const show = () => { if (this.canRingMeet()) this.windows.open('ring', route, 'Invitation to a WorkSuite meeting', true); };
    if (this.attention) void this.attention(`meet-ring:${r.ring_id}`, `meet:${r.uuid}`).then((allowed) => { if (allowed) show(); });
    else show();
  }

  ring(r: Ringing): void {
    const route = ringRoute(r);
    if (!route || !this.canRing()) return;
    // One ring per call, however many devices or events announce it; none
    // for a call this device is already in.
    const now = Date.now();
    for (const [u, at] of this.rung) if (now - at > 120_000) this.rung.delete(u);
    if (this.rung.has(r.uuid) || [...this.active.values()].some((a) => a.uuid === r.uuid)) return;
    this.rung.set(r.uuid, now);
    const show = () => {
      if (!this.canRing()) return;
      this.windows.open('ring', route, 'Incoming WorkSuite call', true);
      void this.delivered(r.uuid);
    };
    if (this.attention) void this.attention(`call:${r.uuid}`, `call:${r.uuid}`).then((allowed) => { if (allowed) show(); });
    else show();
  }

  /** The ring is showing here: the caller's "Calling…" becomes "Ringing…" (worksuite-desktop#113). An older server has no such call. */
  private async delivered(uuid: string): Promise<void> {
    try {
      await this.http.post(`/api/chat/calls/${uuid}/delivered`);
    } catch (e) {
      log.debug('ring delivery not recorded', { uuid, error: String(e) });
    }
  }

  /**
   * The call or meeting a window is in (null when it has left). A chat call
   * is hung up on the server when its window closes; a meeting is left by
   * its media connection closing with the window, so there is nothing to
   * post.
   */
  setActive(win: BrowserWindow, uuid: string | null, meta: { kind: 'call' | 'meet'; title: string } = { kind: 'call', title: '' }): void {
    const id = win.id;
    const had = this.active.get(id);
    if (uuid && UUID.test(uuid)) this.active.set(id, { uuid, kind: meta.kind, title: meta.title.slice(0, 200), since: had?.uuid === uuid ? had.since : Date.now() });
    else this.active.delete(id);
    if (!had && this.active.has(id)) {
      win.once('closed', () => {
        const left = this.active.get(id);
        this.active.delete(id);
        this.changed();
        if (left?.kind === 'call') void this.hangUp(left.uuid);
      });
    }
    this.changed();
  }

  has(windowId: number): boolean {
    return this.active.has(windowId);
  }

  /** What this device is in, for the main window's "in a call" pill. */
  list(): ActiveCall[] {
    return [...this.active.entries()].map(([windowId, a]) => ({ windowId, uuid: a.uuid, kind: a.kind, title: a.title, since: a.since }));
  }

  private changed(): void {
    this.onActiveChanged(this.active.size > 0);
    this.onListChanged(this.list());
  }

  /** Quitting: leave every call this device is in. */
  async endAll(): Promise<void> {
    const calls = [...this.active.values()].filter((a) => a.kind === 'call');
    this.active.clear();
    await Promise.all(calls.map((a) => this.hangUp(a.uuid)));
  }

  private async hangUp(uuid: string): Promise<void> {
    try {
      await this.http.post(`/api/chat/calls/${uuid}/end`);
      log.info('left the call on close', { uuid });
    } catch (e) {
      log.warn('could not leave the call', { uuid, error: String(e) });
    }
  }
}

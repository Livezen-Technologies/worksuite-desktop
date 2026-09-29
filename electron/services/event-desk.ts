import { createHmac } from 'node:crypto';
import {
  applyLocal,
  checkOutRefusal,
  copyExpired,
  copyFacts,
  dayKeyFor,
  isoAt,
  localView,
  matchInCopy,
  mergeChanges,
  nextSequence,
  normalizeCode,
  presenceFor,
  provisionalNumber,
  scanId,
  scanRules,
  searchCopy,
  type BadgeJob,
  type CopyRow,
  type DeskCopy,
  type DeskQueueItem,
  type DeskRegistration,
  type DeskScanMode,
  type DeskScanOutcome,
  type DeskSearchHit,
  type DeskStatus,
  type DeskWalkIn,
  type ScanResult,
  type ScanView,
  type Verdict,
  type When,
} from '@shared/event-desk';
import { DesktopError, isDesktopError } from '../main/errors';
import { logger } from '../main/log';
import type { Database } from './db';
import type { HttpClient } from './http';
import type { SecureStore } from './secure-store';
import type { Vault } from './vault';

const log = logger('event-desk');

/**
 * WorkSuite Events' desk on this computer (Events SRS §15.2 [D], §9.4, §9.8,
 * §9.9; the server's contract web-api-b1 "Gates and devices" and "Offline").
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS COMPUTER IS A CHECK-IN DEVICE, AND ITS KEY IS A CREDENTIAL
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Registering the desk at an event (`POST events/{id}/devices`, as a `desktop`
 * device named by this installation's sync device id) answers with a 256-bit
 * key, once. The offline copy's ticket hashes are HMACs under that key, so it
 * is what makes the copy usable — it is kept in the OS credential store, filed
 * under the server, and never reaches a renderer or a log: registering and a
 * new key happen here, not through the API proxy (which refuses both), and the
 * matching of a scanned code against the copy happens here too. The desk
 * belongs to the computer, not to whoever is signed in: staff take turns at it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ONLINE, THE SERVER ANSWERS; OFFLINE, ITS RULES DO
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * A scan goes to the server with this device and gate and a fresh
 * `client_uuid`. When WorkSuite does not answer, the desk answers from its
 * copy with the server's own `ScanRules` (shared/event-desk.ts) and keeps
 * what it did — a check-in, a check-out, a refused attempt, a walk-in — in a
 * queue with this device's own sequence number and the same `client_uuid`.
 * The queue goes up (`POST checkin/sync`) as soon as WorkSuite answers, and
 * is recorded once however often it is sent. What the server made of each
 * item — recorded, a possible duplicate, a check-in of a ticket cancelled
 * meanwhile, a walk-in it could not confirm — stays beside it for the desk.
 *
 * The copy comes from `checkin/bootstrap` (only the gate's tickets, no email,
 * phone or amount), is kept current with `checkin/changes` every few seconds
 * while online, and is encrypted in the profile's database, only where the
 * company's desktop policy lets this computer keep data offline and queue
 * changes. It goes when it expires, when the event's offline check-in is
 * switched off, and — with the key and the queue — when the device is revoked
 * (EV-CHK-033): the server's `device_revoked` / `wipe` is obeyed at once.
 *
 * The queue belongs to the person who scanned (the server records the person
 * who syncs as the one who scanned), so another person signed in at the desk
 * sees only that it is there; it waits for its maker through a plain sign-out.
 */
const EVENTS = '/api/events/v1';
const SLOT = 'event-desk:';
const TICK_MS = 15_000;
const HEARTBEAT_MS = 60_000;
/** The whole copy is taken again this often; `changes` keeps it current in between. */
const REFRESH_MS = 6 * 60 * 60_000;
const PAGE = 2000;
const MAX_PAGES = 30;
const MAX_UPLOAD = 1000;
/** A scan waits this long for the server before the desk answers from its copy. */
const SCAN_TIMEOUT_MS = 6000;
/** Answered items kept for the desk to show, per event. */
const KEEP_DONE = 300;
/** The copy is written back at most this often after a scan changes it (the queue is written at once). */
const WRITE_DELAY_MS = 2000;

interface Stored {
  event_id: number;
  event_name: string;
  org_id: number | null;
  device_id: number;
  device_name: string;
  gate_id: number | null;
  gate_name: string | null;
  key: string;
  registered_at: string;
}

/** What goes up in `items` (web-api-b1 "Item"). */
interface WireItem {
  client_uuid: string;
  device_sequence: number;
  action: 'CHECK_IN' | 'CHECK_OUT' | 'WALK_IN';
  occurred_at: string;
  gate_id: number | null;
  token?: string;
  registration_id?: number;
  registration_number?: string;
  local_result: ScanResult;
  note?: string | null;
  provisional_number?: string;
  walk_in?: { ticket_type_id: number; answers: Record<string, unknown> };
}

interface QueueRecord {
  wire: WireItem;
  view: Omit<DeskQueueItem, 'client_uuid' | 'device_sequence' | 'action' | 'occurred_at' | 'local_result'>;
}

/** A refusal from the Events API, with what the desk acts on (`errors.code`, `errors.wipe`). */
export class EventsRefusal extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code: string | null,
    readonly errors: Record<string, unknown> | null,
  ) {
    super(message);
    this.name = 'EventsRefusal';
  }
  get wipe(): boolean {
    return this.code === 'device_revoked' || this.errors?.wipe === true;
  }
}

/** WorkSuite did not answer (the line, a gateway in front of it): the desk answers from its copy. */
export function unreachable(e: unknown): boolean {
  if (isDesktopError(e)) return e.code === 'NETWORK_UNREACHABLE';
  return e instanceof EventsRefusal && [502, 503, 504].includes(e.status) && e.code !== 'busy';
}

/** The copy's hashes: `HMAC-SHA256(text trimmed and in capitals, device key)`, lower-case hex (`Tokens::deviceHash()`). */
export function deviceHash(key: string, text: string): string {
  return createHmac('sha256', key).update(normalizeCode(text), 'utf8').digest('hex');
}

export interface EventDeskDeps {
  db: Database;
  vault: () => Vault;
  http: Pick<HttpClient, 'raw' | 'url'>;
  secrets: Pick<SecureStore, 'get' | 'set' | 'delete' | 'deletePrefix'>;
  origin: () => string | null;
  /** The signed-in person, once the session is ready. */
  user: () => string | null;
  /** This installation's sync device id (the `desktop_devices.sync_device_id` the server checks). */
  deviceRef: () => string | null;
  platform: 'windows' | 'macos' | 'linux';
  appVersion: string;
  caps: () => { offlineCache: boolean; offlineQueue: 'allowed' | 'drafts_only' | 'disabled' };
  notify: (n: { id: string; title: string; body: string; link: string }) => void;
  changed: (eventId: number) => void;
  now?: () => number;
}

interface Scope {
  origin: string;
  user: string;
}

interface Held {
  copy: DeskCopy;
  refreshed_at: string;
  pulled_at: string;
  device_id: number;
  dirty: boolean;
}

interface DeviceSeen {
  status: string;
  status_label: string;
  online: boolean;
  trusted: boolean | null;
  queue_size: number;
  last_sync: When | null;
}

export class EventDesk {
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;
  private again = false;
  private reachable = true;
  private lastContact: string | null = null;
  private lastBeat = new Map<number, number>();
  private held = new Map<string, Held>();
  private writeTimer: NodeJS.Timeout | null = null;
  private seen = new Map<number, DeviceSeen>();
  private offlineOff = new Map<number, boolean>();
  private problems = new Map<number, { code: string | null; message: string }>();
  private lastSync = new Map<number, NonNullable<DeskStatus['last_sync']>>();
  private wiped = new Map<number, string>();

  constructor(private readonly d: EventDeskDeps) {}

  private now(): number {
    return this.d.now?.() ?? Date.now();
  }

  private stamp(): string {
    return new Date(this.now()).toISOString();
  }

  private scope(): Scope | null {
    const origin = this.d.origin();
    const user = this.d.user();
    return origin && user ? { origin, user } : null;
  }

  /* ── The Events API ───────────────────────────────────────────────── */

  private async call<T>(method: string, path: string, opts: { query?: Record<string, string | number | undefined>; body?: unknown; timeoutMs?: number } = {}): Promise<{ data: T; message: string | null }> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    let res: Response;
    try {
      res = await this.d.http.raw(method, this.d.http.url(`${EVENTS}${path}`, opts.query), {
        headers,
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        timeoutMs: opts.timeoutMs ?? 30_000,
      });
    } catch (e) {
      if (unreachable(e)) this.reachable = false;
      throw e;
    }
    this.reachable = true;
    this.lastContact = this.stamp();
    type Envelope = { status?: string; message?: string; data?: unknown; errors?: unknown };
    const env = (await res.json().catch(() => null)) as Envelope | null;
    if (!res.ok || env?.status === 'error') {
      const errors = env?.errors && typeof env.errors === 'object' ? (env.errors as Record<string, unknown>) : null;
      const r = new EventsRefusal(res.status, env?.message || `WorkSuite answered ${res.status}.`, typeof errors?.code === 'string' ? errors.code : null, errors);
      if (unreachable(r)) this.reachable = false;
      throw r;
    }
    return { data: (env && 'data' in env ? env.data : env) as T, message: typeof env?.message === 'string' ? env.message : null };
  }

  /* ── Registrations: which device this computer is, per event ──────── */

  private slot(): string | null {
    const o = this.d.origin();
    return o ? `${SLOT}${o}` : null;
  }

  private readAll(): Record<string, Stored> {
    const slot = this.slot();
    const raw = slot ? this.d.secrets.get(slot) : null;
    if (!raw) return {};
    try {
      const v = JSON.parse(raw) as Record<string, Stored>;
      return v && typeof v === 'object' ? v : {};
    } catch {
      return {};
    }
  }

  private writeAll(all: Record<string, Stored>): void {
    const slot = this.slot();
    if (!slot) return;
    if (Object.keys(all).length === 0) this.d.secrets.delete(slot);
    else this.d.secrets.set(slot, JSON.stringify(all));
  }

  private stored(eventId: number): Stored | null {
    const s = this.readAll()[String(eventId)];
    return s && typeof s.device_id === 'number' && typeof s.key === 'string' && s.key !== '' ? s : null;
  }

  private static public(s: Stored): DeskRegistration {
    return {
      event_id: s.event_id,
      event_name: s.event_name,
      org_id: s.org_id,
      device_id: s.device_id,
      device_name: s.device_name,
      gate_id: s.gate_id,
      gate_name: s.gate_name,
      registered_at: s.registered_at,
    };
  }

  /** The events this computer is a check-in device for, on this server — never the keys. */
  registrations(): DeskRegistration[] {
    return Object.values(this.readAll())
      .filter((s) => typeof s?.device_id === 'number')
      .map(EventDesk.public)
      .sort((a, b) => a.event_name.localeCompare(b.event_name));
  }

  registration(eventId: number): DeskRegistration | null {
    const s = this.stored(eventId);
    return s ? EventDesk.public(s) : null;
  }

  /**
   * Register this computer at an event's gate (EV-CHK-031). The server keeps
   * the device and hands over its key once: the key is kept here, the device
   * alone goes back. The same computer again at the event is the same device
   * with a new key — the old copy stops matching, so it is taken again.
   */
  async register(input: { event_id: number; gate_id: number | null; name: string }): Promise<{ registration: DeskRegistration; message: string; reregistered: boolean }> {
    if (!this.d.origin()) throw new DesktopError('NOT_SIGNED_IN', 'No WorkSuite server is configured.');
    const ref = this.d.deviceRef();
    if (!ref) throw new DesktopError('DEVICE_NOT_REGISTERED', 'This computer is not registered with WorkSuite yet. Try again in a moment.');
    const r = await this.call<{ device?: { id?: number; name?: string; event_id?: number; gate?: { id: number; name: string } | null }; device_key?: unknown; reregistered?: boolean }>(
      'POST',
      `/events/${input.event_id}/devices`,
      { body: { name: input.name, gate_id: input.gate_id, device_ref_type: 'desktop', device_ref_id: ref, platform: this.d.platform, app_version: `desktop ${this.d.appVersion}` } },
    );
    const dev = r.data.device;
    if (!dev || typeof dev.id !== 'number' || typeof r.data.device_key !== 'string' || r.data.device_key === '') {
      throw new DesktopError('SERVER_ERROR', 'WorkSuite registered the device but did not hand over its key. Register it again.');
    }
    const event = await this.eventName(input.event_id);
    const s: Stored = {
      event_id: input.event_id,
      event_name: event.name,
      org_id: event.org_id,
      device_id: dev.id,
      device_name: dev.name ?? input.name,
      gate_id: dev.gate?.id ?? input.gate_id,
      gate_name: dev.gate?.name ?? null,
      key: r.data.device_key,
      registered_at: this.stamp(),
    };
    this.writeAll({ ...this.readAll(), [String(input.event_id)]: s });
    /* A new key: the old copy's hashes match nothing. What was queued stays — it names tickets, not hashes. */
    this.dropCopy(input.event_id);
    this.problems.delete(input.event_id);
    this.wiped.delete(input.event_id);
    this.offlineOff.delete(input.event_id);
    this.d.changed(input.event_id);
    void this.sync(input.event_id);
    return { registration: EventDesk.public(s), message: r.message ?? 'Registered.', reregistered: !!r.data.reregistered };
  }

  private async eventName(eventId: number): Promise<{ name: string; org_id: number | null }> {
    try {
      const e = await this.call<{ name?: string; org_id?: number }>('GET', `/events/${eventId}`);
      return { name: e.data.name ?? `Event ${eventId}`, org_id: typeof e.data.org_id === 'number' ? e.data.org_id : null };
    } catch {
      return { name: `Event ${eventId}`, org_id: null };
    }
  }

  /** A new key for this computer at the event (the old copy stops matching); the copy is taken again. */
  async rotateKey(eventId: number): Promise<{ message: string }> {
    const s = this.stored(eventId);
    if (!s) throw new DesktopError('NOT_FOUND', 'This computer is not a check-in device for that event.');
    const r = await this.call<{ device_key?: unknown }>('POST', `/devices/${s.device_id}/key`, { body: {} });
    if (typeof r.data.device_key !== 'string' || r.data.device_key === '') throw new DesktopError('SERVER_ERROR', 'WorkSuite did not hand over the new key. Try again.');
    this.writeAll({ ...this.readAll(), [String(eventId)]: { ...s, key: r.data.device_key } });
    this.dropCopy(eventId);
    this.problems.delete(eventId);
    this.d.changed(eventId);
    void this.sync(eventId);
    return { message: r.message ?? 'A new key: the event is being downloaded again.' };
  }

  /**
   * Stop being a device at this event on this computer. Scans that have not
   * reached WorkSuite are not thrown away without being asked (`discard`).
   */
  forget(eventId: number, discard = false): number {
    const origin = this.d.origin();
    if (!origin) return 0;
    const waiting = this.d.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM event_desk_queue WHERE origin = ? AND event_id = ? AND state IN ('waiting', 'rejected')", origin, eventId)?.n ?? 0;
    if (waiting > 0 && !discard) {
      throw new DesktopError('CONFLICT', `${waiting} scan${waiting === 1 ? '' : 's'} made here offline ${waiting === 1 ? 'has' : 'have'} not reached WorkSuite yet. Sync first, or remove ${waiting === 1 ? 'it' : 'them'} with the desk.`);
    }
    const all = this.readAll();
    delete all[String(eventId)];
    this.writeAll(all);
    this.dropCopy(eventId);
    this.d.db.run('DELETE FROM event_desk_queue WHERE origin = ? AND event_id = ?', origin, eventId);
    this.seen.delete(eventId);
    this.problems.delete(eventId);
    this.d.changed(eventId);
    return waiting;
  }

  /**
   * The device was revoked (EV-CHK-033): its key, its copy and what it queued
   * go from this computer at once — whoever is signed in.
   */
  private wipe(eventId: number, why: string): void {
    const origin = this.d.origin();
    if (!origin) return;
    const lost = this.d.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM event_desk_queue WHERE origin = ? AND event_id = ? AND state IN ('waiting', 'rejected')", origin, eventId)?.n ?? 0;
    const name = this.stored(eventId)?.event_name ?? `event ${eventId}`;
    const all = this.readAll();
    delete all[String(eventId)];
    this.writeAll(all);
    this.dropCopy(eventId);
    this.d.db.run('DELETE FROM event_desk_queue WHERE origin = ? AND event_id = ?', origin, eventId);
    this.seen.delete(eventId);
    this.problems.delete(eventId);
    const text = `${why}${lost > 0 ? ` ${lost} scan${lost === 1 ? '' : 's'} made offline and not yet sent ${lost === 1 ? 'was' : 'were'} removed with it.` : ''}`;
    this.wiped.set(eventId, text);
    log.info('event desk wiped: device revoked', { event: eventId, lost });
    this.d.notify({ id: `events-desk-wiped-${eventId}`, title: `This desk was revoked at ${name}`, body: text, link: `/events/${eventId}/desk` });
    this.d.changed(eventId);
  }

  /* ── The copy ─────────────────────────────────────────────────────── */

  private heldKey(s: Scope, eventId: number): string {
    return `${s.origin}\n${s.user}\n${eventId}`;
  }

  private readCopy(s: Scope, eventId: number): Held | null {
    const k = this.heldKey(s, eventId);
    const have = this.held.get(k);
    if (have) return have;
    const r = this.d.db.get<{ payload: string; refreshed_at: string; pulled_at: string; device_id: number }>(
      'SELECT payload, refreshed_at, pulled_at, device_id FROM event_desk_copy WHERE origin = ? AND event_id = ? AND user_id = ?',
      s.origin,
      eventId,
      s.user,
    );
    const copy = r ? this.d.vault().decrypt<DeskCopy>(r.payload) : undefined;
    if (!r || !copy) return null;
    const h: Held = { copy, refreshed_at: r.refreshed_at, pulled_at: r.pulled_at, device_id: r.device_id, dirty: false };
    this.held.set(k, h);
    return h;
  }

  private writeCopy(s: Scope, eventId: number, h: Held): void {
    this.d.db.run(
      `INSERT INTO event_desk_copy (origin, event_id, user_id, device_id, payload, refreshed_at, pulled_at) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(origin, event_id, user_id) DO UPDATE SET device_id = excluded.device_id, payload = excluded.payload,
         refreshed_at = excluded.refreshed_at, pulled_at = excluded.pulled_at`,
      s.origin,
      eventId,
      s.user,
      h.device_id,
      this.d.vault().encrypt(h.copy),
      h.refreshed_at,
      h.pulled_at,
    );
    h.dirty = false;
  }

  /** Write back what scans changed in the copies (the queue itself is already on disk). */
  flush(): void {
    if (this.writeTimer) clearTimeout(this.writeTimer);
    this.writeTimer = null;
    for (const [k, h] of this.held) {
      if (!h.dirty) continue;
      const [origin, user, ev] = k.split('\n');
      this.writeCopy({ origin: origin!, user: user! }, Number(ev), h);
    }
  }

  private soon(): void {
    if (this.writeTimer) return;
    this.writeTimer = setTimeout(() => this.flush(), WRITE_DELAY_MS);
    this.writeTimer.unref?.();
  }

  private dropCopy(eventId: number): void {
    const origin = this.d.origin();
    if (!origin) return;
    this.d.db.run('DELETE FROM event_desk_copy WHERE origin = ? AND event_id = ?', origin, eventId);
    for (const k of [...this.held.keys()]) if (k.startsWith(`${origin}\n`) && k.endsWith(`\n${eventId}`)) this.held.delete(k);
  }

  /** Why this desk cannot check in offline now, or null when it can. */
  offlineBlocked(eventId: number): string | null {
    const caps = this.d.caps();
    if (!caps.offlineCache) return 'your company does not let this computer keep data offline';
    if (caps.offlineQueue !== 'allowed') {
      return caps.offlineQueue === 'disabled'
        ? 'your company does not let this computer keep changes offline'
        : 'only a trusted computer keeps check-ins to send later (an administrator can mark this one trusted in WorkSuite → Devices)';
    }
    if (this.offlineOff.get(eventId)) return 'offline check-in is off for this event';
    if (!this.stored(eventId)) return 'this computer is not registered at the event';
    return null;
  }

  private async pull(s: Scope, st: Stored): Promise<void> {
    if (this.offlineBlocked(st.event_id)) {
      this.dropCopy(st.event_id);
      return;
    }
    const h = this.readCopy(s, st.event_id);
    if (!h || h.device_id !== st.device_id || this.now() - Date.parse(h.refreshed_at) > REFRESH_MS) {
      await this.bootstrap(s, st);
      return;
    }
    let copy = h.copy;
    for (let page = 0; page < MAX_PAGES; page++) {
      const r = await this.call<{ items?: CopyRow[]; removed?: number[]; cursor?: number; more?: boolean }>('GET', `/events/${st.event_id}/checkin/changes`, {
        query: { device_id: st.device_id, after: copy.cursor, limit: 500 },
      });
      const before = copy.cursor;
      copy = mergeChanges(copy, r.data);
      if (!r.data.more || copy.cursor === before) break;
    }
    h.copy = copy;
    h.pulled_at = this.stamp();
    this.writeCopy(s, st.event_id, h);
  }

  /** The whole copy, a page at a time (EV-OFF-002): only the gate's tickets, no email, phone or amount. */
  private async bootstrap(s: Scope, st: Stored): Promise<void> {
    type First = Omit<DeskCopy, 'rows'> & { items: CopyRow[]; more: boolean; next_after_id: number };
    const first = await this.call<First>('GET', `/events/${st.event_id}/checkin/bootstrap`, { query: { device_id: st.device_id, after_id: 0, limit: PAGE } });
    const f = first.data;
    const rows = [...(f.items ?? [])];
    let more = f.more;
    let after = f.next_after_id;
    for (let page = 1; more && page < MAX_PAGES; page++) {
      const r = await this.call<{ items: CopyRow[]; more: boolean; next_after_id: number }>('GET', `/events/${st.event_id}/checkin/bootstrap`, {
        query: { device_id: st.device_id, after_id: after, limit: PAGE },
      });
      rows.push(...(r.data.items ?? []));
      if (r.data.next_after_id === after) break;
      more = r.data.more;
      after = r.data.next_after_id;
    }
    const copy: DeskCopy = {
      event: f.event,
      gate: f.gate ? { id: f.gate.id, name: f.gate.name, direction: f.gate.direction, active: f.gate.active, auto_print: f.gate.auto_print } : null,
      ticket_types: f.ticket_types ?? [],
      rules: {
        duplicate_behavior: f.rules?.duplicate_behavior ?? 'warn',
        require_payment: f.rules?.require_payment ?? 'block',
        auto_checkin: !!f.rules?.auto_checkin,
        photo_verification: !!f.rules?.photo_verification,
        walk_ins: !!f.rules?.walk_ins,
      },
      rows,
      cursor: Number(f.cursor) || 0,
      cache_expires: f.cache_expires ?? null,
      generated: f.generated ?? null,
      total: Number(f.total) || rows.length,
      warning: f.warning ?? null,
    };
    /* Check-ins this person made here offline and not yet sent are still what this desk saw. */
    let merged = copy;
    for (const q of this.load(s, st.event_id, ['waiting'])) {
      if (q.wire.local_result !== 'VALID' || q.wire.action === 'WALK_IN') continue;
      const hash = q.wire.token ? deviceHash(st.key, q.wire.token) : null;
      const id = q.wire.registration_id ?? merged.rows.find((r) => (q.wire.registration_number && r.number === q.wire.registration_number) || (hash !== null && r.hash === hash))?.id;
      if (id) merged = applyLocal(merged, id, q.wire.action, Date.parse(q.wire.occurred_at));
    }
    const at = this.stamp();
    const h: Held = { copy: merged, refreshed_at: at, pulled_at: at, device_id: st.device_id, dirty: false };
    this.held.set(this.heldKey(s, st.event_id), h);
    this.writeCopy(s, st.event_id, h);
  }

  /* ── The queue ────────────────────────────────────────────────────── */

  private load(s: Scope, eventId: number, states?: DeskQueueItem['state'][]): Array<QueueRecord & { state: DeskQueueItem['state'] }> {
    const vault = this.d.vault();
    const rows = this.d.db.all<{ state: string; item: string }>(
      'SELECT state, item FROM event_desk_queue WHERE origin = ? AND event_id = ? AND user_id = ? ORDER BY seq',
      s.origin,
      eventId,
      s.user,
    );
    const out: Array<QueueRecord & { state: DeskQueueItem['state'] }> = [];
    for (const r of rows) {
      if (states && !states.includes(r.state as DeskQueueItem['state'])) continue;
      const rec = vault.decrypt<QueueRecord>(r.item);
      if (rec) out.push({ ...rec, state: r.state as DeskQueueItem['state'] });
    }
    return out;
  }

  private sequence(origin: string, deviceId: number): number {
    const key = `event-desk-seq:${origin}:${deviceId}`;
    const last = Math.max(Number(this.d.db.getConfig<number>(key) ?? 0), this.d.db.get<{ m: number | null }>('SELECT MAX(seq) AS m FROM event_desk_queue WHERE origin = ? AND device_id = ?', origin, deviceId)?.m ?? 0);
    const next = nextSequence(last, this.now());
    this.d.db.setConfig(key, next);
    return next;
  }

  private enqueue(s: Scope, st: Stored, wire: Omit<WireItem, 'device_sequence' | 'gate_id'>, label: string, detail: string | null): QueueRecord {
    const seq = this.sequence(s.origin, st.device_id);
    const full: WireItem = { ...wire, device_sequence: seq, gate_id: st.gate_id };
    const rec: QueueRecord = {
      wire: full,
      view: { label, detail, state: 'waiting', flag: null, message: null, reconciliation_id: null, provisional_number: full.provisional_number ?? null, registration_number: full.registration_number ?? null },
    };
    const at = this.stamp();
    this.d.db.run(
      'INSERT INTO event_desk_queue (client_uuid, origin, event_id, user_id, device_id, seq, state, item, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      full.client_uuid,
      s.origin,
      st.event_id,
      s.user,
      st.device_id,
      seq,
      'waiting',
      this.d.vault().encrypt(rec),
      at,
      at,
    );
    return rec;
  }

  private setState(clientUuid: string, rec: QueueRecord, state: DeskQueueItem['state']): void {
    rec.view.state = state;
    this.d.db.run('UPDATE event_desk_queue SET state = ?, item = ?, updated_at = ? WHERE client_uuid = ?', state, this.d.vault().encrypt(rec), this.stamp(), clientUuid);
  }

  /** This person's queue at the event, newest first: what waits, and what the server made of what went. */
  queue(eventId: number): DeskQueueItem[] {
    const s = this.scope();
    if (!s) return [];
    return this.load(s, eventId)
      .reverse()
      .map((r) => ({
        ...r.view,
        state: r.state,
        client_uuid: r.wire.client_uuid,
        device_sequence: r.wire.device_sequence,
        action: r.wire.action,
        occurred_at: r.wire.occurred_at,
        local_result: r.wire.local_result,
      }));
  }

  /** Send an item the server would not take again, or drop it (a person's decision, never the desk's). */
  resolveItem(eventId: number, clientUuid: string, action: 'retry' | 'drop'): DeskQueueItem[] {
    const s = this.scope();
    if (!s) throw new DesktopError('NOT_SIGNED_IN', 'Sign in to WorkSuite first.');
    const rec = this.load(s, eventId).find((r) => r.wire.client_uuid === clientUuid);
    if (!rec) throw new DesktopError('NOT_FOUND', 'That scan is no longer in the queue.');
    if (action === 'drop') {
      if (rec.state !== 'rejected' && rec.state !== 'waiting') throw new DesktopError('CONFLICT', 'WorkSuite has that scan already.');
      this.d.db.run('DELETE FROM event_desk_queue WHERE client_uuid = ? AND user_id = ?', clientUuid, s.user);
    } else if (rec.state === 'rejected') {
      rec.view.message = null;
      this.setState(clientUuid, rec, 'waiting');
      void this.sync(eventId);
    }
    this.d.changed(eventId);
    return this.queue(eventId);
  }

  private async upload(s: Scope, st: Stored, h: Held | null): Promise<void> {
    const waiting = this.load(s, st.event_id, ['waiting']);
    if (waiting.length === 0) return;
    const send = waiting.slice(0, MAX_UPLOAD);
    const others = this.d.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM event_desk_queue WHERE origin = ? AND event_id = ? AND state = 'waiting'", s.origin, st.event_id)?.n ?? 0;
    const r = await this.call<{
      accepted?: number;
      duplicates?: number;
      conflicts?: number;
      rejected?: number;
      items?: Array<{ client_uuid?: string; status?: string; flag?: string | null; message?: string; reconciliation_id?: number | null; provisional_number?: string; registration_number?: string }>;
      changes?: { items?: CopyRow[]; removed?: number[]; cursor?: number };
      device?: { wipe?: boolean; device?: Record<string, unknown> };
    }>('POST', `/events/${st.event_id}/checkin/sync`, {
      body: { device_id: st.device_id, batch_uuid: scanId('batch'), cursor: h?.copy.cursor ?? 0, queue_size: Math.max(0, others - send.length), items: send.map((q) => q.wire) },
      timeoutMs: 60_000,
    });
    const byUuid = new Map(send.map((q) => [q.wire.client_uuid, q]));
    for (const it of r.data.items ?? []) {
      const q = it.client_uuid ? byUuid.get(it.client_uuid) : undefined;
      if (!q) continue;
      const status = it.status === 'recorded' || it.status === 'replayed' || it.status === 'conflict' ? it.status : 'rejected';
      q.view.flag = it.flag ?? null;
      q.view.message = it.message ?? null;
      q.view.reconciliation_id = it.reconciliation_id ?? null;
      if (it.provisional_number) q.view.provisional_number = it.provisional_number;
      if (it.registration_number) q.view.registration_number = it.registration_number;
      this.setState(q.wire.client_uuid, q, status);
    }
    if (h && r.data.changes) {
      h.copy = mergeChanges(h.copy, r.data.changes);
      h.dirty = true;
      this.soon();
    }
    const counts = { accepted: r.data.accepted ?? 0, duplicates: r.data.duplicates ?? 0, conflicts: r.data.conflicts ?? 0, rejected: r.data.rejected ?? 0 };
    this.lastSync.set(st.event_id, { at: this.stamp(), ...counts });
    this.prune(s.origin, st.event_id);
    if (r.data.device?.device) this.see(st.event_id, r.data.device.device);
    if (r.data.device?.wipe) {
      this.wipe(st.event_id, 'WorkSuite revoked this computer as a check-in device: its copy of the event was removed.');
      return;
    }
    if (counts.duplicates + counts.conflicts > 0) {
      this.d.notify({
        id: `events-desk-review-${st.event_id}-${Date.now()}`,
        title: 'Offline check-ins to review',
        body: `${counts.duplicates} possible duplicate entr${counts.duplicates === 1 ? 'y' : 'ies'} and ${counts.conflicts} to reconcile from ${st.device_name}.`,
        link: `/events/${st.event_id}/checkin/reconciliation`,
      });
    }
  }

  private prune(origin: string, eventId: number): void {
    const old = this.d.db.all<{ client_uuid: string }>(
      "SELECT client_uuid FROM event_desk_queue WHERE origin = ? AND event_id = ? AND state IN ('recorded', 'replayed', 'conflict') ORDER BY seq DESC LIMIT -1 OFFSET ?",
      origin,
      eventId,
      KEEP_DONE,
    );
    for (const o of old) this.d.db.run('DELETE FROM event_desk_queue WHERE client_uuid = ?', o.client_uuid);
  }

  private see(eventId: number, dev: Record<string, unknown>): void {
    const ref = dev.device_ref as { trusted?: unknown } | undefined;
    this.seen.set(eventId, {
      status: String(dev.status ?? ''),
      status_label: String(dev.status_label ?? dev.status ?? ''),
      online: dev.online === true,
      trusted: typeof ref?.trusted === 'boolean' ? ref.trusted : null,
      queue_size: Number(dev.queue_size ?? 0),
      last_sync: (dev.last_sync as When | null) ?? null,
    });
  }

  private async heartbeat(s: Scope, st: Stored, h: Held | null): Promise<void> {
    const queued = this.d.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM event_desk_queue WHERE origin = ? AND event_id = ? AND state = 'waiting'", s.origin, st.event_id)?.n ?? 0;
    const r = await this.call<{ status?: string; wipe?: boolean; event_status?: string; offline_allowed?: boolean; cache_expires?: When | null; device?: Record<string, unknown> }>(
      'POST',
      `/devices/${st.device_id}/heartbeat`,
      { body: { app_version: `desktop ${this.d.appVersion}`, queue_size: queued } },
    );
    this.lastBeat.set(st.event_id, this.now());
    if (r.data.device) this.see(st.event_id, r.data.device);
    if (r.data.wipe) {
      this.wipe(st.event_id, 'WorkSuite revoked this computer as a check-in device: its copy of the event was removed.');
      return;
    }
    this.offlineOff.set(st.event_id, r.data.offline_allowed === false);
    if (r.data.offline_allowed === false) this.dropCopy(st.event_id);
    else if (h && r.data.event_status && r.data.event_status !== h.copy.event.status) {
      h.copy = { ...h.copy, event: { ...h.copy.event, status: r.data.event_status }, cache_expires: r.data.cache_expires ?? h.copy.cache_expires };
      h.dirty = true;
      this.soon();
    }
  }

  /* ── Keeping it current ───────────────────────────────────────────── */

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.sync(), TICK_MS);
    this.timer.unref?.();
    void this.sync();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.flush();
    this.held.clear();
  }

  /** Send what waits, catch up with the server and call in — for one event, or every event this computer is a device at. */
  sync(eventId?: number): Promise<void> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = (async () => {
      try {
        do {
          this.again = false;
          await this.run(eventId);
        } while (this.again);
      } finally {
        this.running = null;
      }
    })();
    return this.running;
  }

  private async run(only?: number): Promise<void> {
    const s = this.scope();
    if (!s) return;
    for (const st of Object.values(this.readAll())) {
      if (only !== undefined && st.event_id !== only) continue;
      if (!st || typeof st.device_id !== 'number') continue;
      try {
        const h = this.readCopy(s, st.event_id);
        await this.upload(s, st, h);
        if (!this.stored(st.event_id)) continue;
        await this.pull(s, st);
        if (!this.stored(st.event_id)) continue;
        if (only !== undefined || this.now() - (this.lastBeat.get(st.event_id) ?? 0) >= HEARTBEAT_MS) await this.heartbeat(s, st, this.readCopy(s, st.event_id));
        this.problems.delete(st.event_id);
      } catch (e) {
        this.fail(st.event_id, e);
      }
      this.d.changed(st.event_id);
    }
  }

  private fail(eventId: number, e: unknown): void {
    if (unreachable(e)) return;
    if (e instanceof EventsRefusal) {
      if (e.wipe) {
        this.wipe(eventId, `${e.message} WorkSuite asked this computer to remove its copy of the event.`);
        return;
      }
      if (e.code === 'offline_off') {
        this.offlineOff.set(eventId, true);
        this.dropCopy(eventId);
      }
      this.problems.set(eventId, { code: e.code, message: e.message });
      return;
    }
    const message = e instanceof Error ? e.message : String(e);
    this.problems.set(eventId, { code: isDesktopError(e) ? e.code : null, message });
    log.warn('event desk sync failed', { event: eventId, error: message });
  }

  /* ── Scanning ─────────────────────────────────────────────────────── */

  /**
   * A scan at this desk: the server's answer when it answers; otherwise the
   * desk's own from its copy, kept for the server. A check-out offline is
   * refused as the server refuses it (a ticket not inside).
   */
  async scan(input: { event_id: number; code?: string; registration_id?: number; mode: DeskScanMode }): Promise<DeskScanOutcome> {
    const st = this.stored(input.event_id);
    if (!st) throw new DesktopError('NOT_FOUND', 'This computer is not a check-in device for that event. Register it first.');
    const clientUuid = scanId('dsk');
    const path = input.mode === 'scan' ? 'scan' : input.mode === 'check_in' ? 'check-in' : 'check-out';
    try {
      const r = await this.call<ScanView & { badge?: BadgeJob | null }>('POST', `/events/${st.event_id}/${path}`, {
        body: { code: input.code, registration_id: input.registration_id, gate_id: st.gate_id, device_id: st.device_id, client_uuid: clientUuid },
        timeoutMs: SCAN_TIMEOUT_MS,
      });
      const { badge, ...view } = r.data;
      this.problems.delete(st.event_id);
      if (view.done && view.registration) this.followServer(st, view);
      return { source: 'server', view: view as ScanView, message: r.message, badge: badge ?? null };
    } catch (e) {
      if (e instanceof EventsRefusal) {
        if (e.wipe) {
          this.wipe(st.event_id, `${e.message} Its copy of the event was removed from this computer.`);
          return { source: 'refused', status: e.status, code: e.code, message: e.message, wipe: true };
        }
        if (['device_suspended', 'device_untrusted', 'device_unknown', 'device_key_missing'].includes(e.code ?? '')) this.problems.set(st.event_id, { code: e.code, message: e.message });
        if (!unreachable(e)) return { source: 'refused', status: e.status, code: e.code, message: e.message, wipe: false };
      } else if (!unreachable(e)) {
        throw e;
      }
      return this.scanHere(st, input, clientUuid);
    }
  }

  /** The server admitted (or let out) someone: the copy says so at once, before the change feed brings it. */
  private followServer(st: Stored, view: ScanView): void {
    const s = this.scope();
    const h = s ? this.readCopy(s, st.event_id) : null;
    if (!h || !view.registration || !view.action) return;
    if (!h.copy.rows.some((r) => r.id === view.registration!.id)) return;
    h.copy = applyLocal(h.copy, view.registration.id, view.action, this.now());
    h.dirty = true;
    this.soon();
  }

  private scanHere(st: Stored, input: { event_id: number; code?: string; registration_id?: number; mode: DeskScanMode }, clientUuid: string): DeskScanOutcome {
    const s = this.scope();
    const refuse = (message: string, code: string | null = 'offline'): DeskScanOutcome => ({ source: 'refused', status: 0, code, message, wipe: false });
    if (!s) return refuse('Sign in to WorkSuite first.', 'signed_out');
    const blocked = this.offlineBlocked(st.event_id);
    if (blocked) return refuse(`WorkSuite cannot be reached, and ${blocked}. Check this person in on another device, or wait for the line.`);
    const problem = this.problems.get(st.event_id);
    if (problem && ['device_suspended', 'device_untrusted', 'device_unknown', 'device_key_missing'].includes(problem.code ?? '')) {
      return refuse(`WorkSuite cannot be reached, and when it last answered it said: ${problem.message}`, problem.code);
    }
    const h = this.readCopy(s, st.event_id);
    if (!h || h.device_id !== st.device_id) return refuse('WorkSuite cannot be reached, and this computer has no offline copy of the event yet. It is downloaded as soon as the line is back.');
    const at = this.now();
    if (copyExpired(h.copy, at)) return refuse('WorkSuite cannot be reached, and this computer’s offline copy of the event has expired.', 'expired');

    const match = matchInCopy(h.copy.rows, input, (t) => deviceHash(st.key, t));
    const code = input.code ? normalizeCode(input.code) : undefined;
    const subject = {
      token: match?.via === 'qr' || (!match && code && /^EV1-/.test(code)) ? code : undefined,
      registration_id: match?.via === 'registration' ? match.row.id : !match && !code ? input.registration_id : undefined,
      registration_number: match?.via === 'number' ? match.row.number : !match && code && !/^EV1-/.test(code) ? code : undefined,
    };
    const who = match ? `${match.row.name || match.row.number} · ${match.row.number}` : (code ?? `Registration ${input.registration_id}`);

    if (input.mode === 'check_out') {
      const tt = match ? (h.copy.ticket_types.find((t) => t.id === match.row.ticket_type_id) ?? null) : null;
      const why = checkOutRefusal({ token_known: !!match, presence: match ? presenceFor(match.row, dayKeyFor(h.copy, tt, at)).state : undefined });
      if (why) return { source: 'refused', status: match ? 409 : 404, code: match ? 'not_inside' : 'not_a_ticket', message: why, wipe: false };
      const v: Verdict = { result: 'VALID', action: 'CHECK_OUT', colour: 'green', label: 'Checked out', reason: 'Goodbye.', warning: null };
      return this.keep(s, st, h, match!, v, subject, clientUuid, who, at);
    }

    const v = scanRules(copyFacts(h.copy, match, at));
    if (!match) {
      v.reason = 'This code is not in this gate’s offline copy: it is not a ticket for this event, or not one this gate admits.';
    }
    const admit = v.result === 'VALID' && (input.mode === 'check_in' || h.copy.rules.auto_checkin);
    if (admit && match) return this.keep(s, st, h, match, v, subject, clientUuid, who, at);

    let queued = false;
    if (v.result !== 'VALID') {
      /* A refused scan is kept as the attempt it was (EV-CHK-010). */
      this.enqueue(s, st, { client_uuid: clientUuid, action: 'CHECK_IN', occurred_at: isoAt(at), ...subject, local_result: v.result, note: v.reason.slice(0, 255) }, who, v.label);
      queued = true;
      this.d.changed(st.event_id);
    }
    return {
      source: 'local',
      view: localView(h.copy, match, v, false, at),
      message: `${v.label}: ${v.reason}${queued ? ' (kept for WorkSuite)' : ''}`,
      queued,
      badge: null,
    };
  }

  private keep(s: Scope, st: Stored, h: Held, match: NonNullable<ReturnType<typeof matchInCopy>>, v: Verdict, subject: Pick<WireItem, 'token' | 'registration_id' | 'registration_number'>, clientUuid: string, who: string, at: number): DeskScanOutcome {
    const action = v.action ?? 'CHECK_IN';
    this.enqueue(s, st, { client_uuid: clientUuid, action, occurred_at: isoAt(at), ...subject, local_result: 'VALID', note: v.warning }, who, action === 'CHECK_OUT' ? 'Checked out here' : 'Checked in here');
    h.copy = applyLocal(h.copy, match.row.id, action, at);
    h.dirty = true;
    this.soon();
    this.d.changed(st.event_id);
    const now = h.copy.rows.find((r) => r.id === match.row.id) ?? match.row;
    const view = localView(h.copy, { row: now, via: match.via }, v, true, at);
    const warn = h.copy.warning ?? 'Offline, a ticket let in at another gate is only seen when that device syncs.';
    return {
      source: 'local',
      view,
      message: `${action === 'CHECK_OUT' ? 'Checked out' : 'Checked in'} on this computer: ${match.row.name || match.row.number}. WorkSuite is told as soon as it answers. ${warn}`,
      queued: true,
      badge: null,
    };
  }

  /** A walk-in registered with WorkSuite out of reach (EV-OFF-006): it goes up with the queue and gets its real number then. */
  walkIn(input: DeskWalkIn): { provisional_number: string; message: string } {
    const s = this.scope();
    const st = this.stored(input.event_id);
    if (!s || !st) throw new DesktopError('NOT_FOUND', 'This computer is not a check-in device for that event.');
    const blocked = this.offlineBlocked(st.event_id);
    if (blocked) throw new DesktopError('POLICY_DENIED', `A walk-in cannot be kept offline: ${blocked}.`);
    const h = this.readCopy(s, st.event_id);
    if (!h) throw new DesktopError('NOT_FOUND', 'This computer has no offline copy of the event.');
    if (!h.copy.rules.walk_ins) throw new DesktopError('POLICY_DENIED', 'Walk-ins are off for this event.');
    const tt = h.copy.ticket_types.find((t) => t.id === input.ticket_type_id);
    if (!tt || !tt.admitted_here) throw new DesktopError('IPC_VALIDATION_FAILED', 'Choose a ticket this gate admits.');
    const at = this.now();
    const seq = this.sequence(s.origin, st.device_id);
    const prov = provisionalNumber(st.device_id, seq);
    const name = `${String(input.answers.first_name ?? '').trim()} ${String(input.answers.last_name ?? '').trim()}`.trim() || 'Walk-in';
    const clientUuid = scanId('walkin');
    const wire: WireItem = {
      client_uuid: clientUuid,
      device_sequence: seq,
      action: 'WALK_IN',
      occurred_at: isoAt(at),
      gate_id: st.gate_id,
      local_result: 'VALID',
      provisional_number: prov,
      walk_in: { ticket_type_id: tt.id, answers: input.answers },
    };
    const rec: QueueRecord = { wire, view: { label: `${name} · ${prov}`, detail: tt.name, state: 'waiting', flag: null, message: null, reconciliation_id: null, provisional_number: prov, registration_number: null } };
    this.d.db.run(
      'INSERT INTO event_desk_queue (client_uuid, origin, event_id, user_id, device_id, seq, state, item, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      clientUuid,
      s.origin,
      st.event_id,
      s.user,
      st.device_id,
      seq,
      'waiting',
      this.d.vault().encrypt(rec),
      this.stamp(),
      this.stamp(),
    );
    this.d.changed(st.event_id);
    return {
      provisional_number: prov,
      message: `${name} is let in as ${prov}. WorkSuite registers them when it is back; a walk-in it cannot confirm (full, a paid ticket, answers missing) goes to the review queue.`,
    };
  }

  /** The desk's search from its copy, while WorkSuite does not answer (EV-CHK-050). */
  search(eventId: number, q: string, limit = 20): DeskSearchHit[] {
    const s = this.scope();
    const h = s ? this.readCopy(s, eventId) : null;
    return h && !copyExpired(h.copy, this.now()) ? searchCopy(h.copy, q, limit, this.now()) : [];
  }

  /** What the desk shows about itself: online or not, the copy, the queue, what the server said (EV-OFF-007). */
  status(eventId: number): DeskStatus {
    const s = this.scope();
    const st = this.stored(eventId);
    const h = s && st ? this.readCopy(s, eventId) : null;
    const counts = s
      ? this.d.db.all<{ user_id: string; state: string; n: number }>('SELECT user_id, state, COUNT(*) AS n FROM event_desk_queue WHERE origin = ? AND event_id = ? GROUP BY user_id, state', s.origin, eventId)
      : [];
    const mine = (state: string) => counts.filter((c) => c.user_id === s?.user && c.state === state).reduce((t, c) => t + c.n, 0);
    const flagged = s ? this.load(s, eventId, ['conflict']).length : 0;
    return {
      event_id: eventId,
      registration: st ? EventDesk.public(st) : null,
      device: this.seen.get(eventId) ?? null,
      reachable: this.reachable,
      last_contact: this.lastContact,
      last_sync: this.lastSync.get(eventId) ?? null,
      copy: h
        ? {
            rows: h.copy.rows.length,
            total: h.copy.total,
            refreshed_at: h.refreshed_at,
            pulled_at: h.pulled_at,
            cache_expires: h.copy.cache_expires,
            event_status: h.copy.event.status,
            gate: h.copy.gate?.name ?? null,
            warning: h.copy.warning,
          }
        : null,
      waiting: mine('waiting'),
      rejected: mine('rejected'),
      flagged,
      others: counts.filter((c) => c.user_id !== s?.user && (c.state === 'waiting' || c.state === 'rejected')).reduce((t, c) => t + c.n, 0),
      offline_blocked: st ? this.offlineBlocked(eventId) : null,
      problem: this.problems.get(eventId) ?? null,
      wiped: this.wiped.get(eventId) ?? null,
    };
  }

  /** Scans waiting for WorkSuite, for the app's "pending changes". */
  pending(): number {
    const s = this.scope();
    if (!s) return 0;
    return this.d.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM event_desk_queue WHERE origin = ? AND user_id = ? AND state IN ('waiting', 'rejected')", s.origin, s.user)?.n ?? 0;
  }

  /* ── Forgetting ───────────────────────────────────────────────────── */

  /** A plain sign-out: this person's copies go (they are cache); their scans wait for them, and the device stays this computer's. */
  signedOut(user: string): void {
    this.flush();
    this.d.db.run('DELETE FROM event_desk_copy WHERE user_id = ?', user);
    for (const k of [...this.held.keys()]) if (k.split('\n')[1] === user) this.held.delete(k);
  }

  /** A remote wipe, or signing out with "remove WorkSuite's data": every desk, key, copy and queue on this computer. */
  forgetAll(): void {
    if (this.writeTimer) clearTimeout(this.writeTimer);
    this.writeTimer = null;
    this.held.clear();
    this.d.secrets.deletePrefix(SLOT);
    this.d.db.run('DELETE FROM event_desk_copy');
    this.d.db.run('DELETE FROM event_desk_queue');
    this.seen.clear();
    this.problems.clear();
  }
}

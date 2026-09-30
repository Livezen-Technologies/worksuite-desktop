import { randomUUID } from 'node:crypto';
import {
  OP_NEEDS,
  RESTAURANT_API,
  restaurantOutboxAdd,
  type RestaurantCopy,
  type RestaurantOutboxInput,
  type RestaurantOutboxItem,
  type RestaurantPairing,
  type RestaurantStatus,
} from '@shared/restaurant';
import { DesktopError, isDesktopError } from '../../main/errors';
import { logger } from '../../main/log';
import type { Database } from '../db';
import type { HttpClient } from '../http';
import type { Vault } from '../vault';
import { apply, batch, batchKey, dropWithDependents, needsOf, retried, type SyncResult } from './outbox';

const log = logger('restaurant-sync');

/**
 * The till keeps working when WorkSuite is out of reach (Restaurant SRS §4.3).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE COPY
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * What the till opens with (`GET pos`), what its branch sells (`GET
 * menu/branch/{id}`) and its floor (`GET floor`) are kept, sealed with the
 * profile's key, in the terminal's own table — per server, terminal and
 * person, since the server answers each person within their data scope. The
 * floor is taken every tick, the menu every five minutes. Screens read the
 * copy only when WorkSuite does not answer, and say how old it is.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE OUTBOX
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Orders, lines and sends made offline wait in order (outbox.ts) and go to
 * `POST sync` with the terminal's key and an idempotency key per batch; the
 * server plays them back once, keeps what it cannot take as it was for a
 * manager, and answers each. Money is never queued here: bills, payments,
 * voids, table moves and the cashier need WorkSuite (the screens disable
 * them). Only a computer the desktop policy trusts with queued changes keeps
 * them, and only ops the branch allows offline (`offline_actions`).
 *
 * Every tick it also sends the terminal's heartbeat — queue size, version,
 * printers hosted — which is how the manager's device list knows it is alive.
 *
 * Tables are created here (IF NOT EXISTS) rather than as a numbered
 * migration, so this module's schema stands on its own beside the others'.
 */
const TICK_MS = 30_000;
const MENU_MS = 5 * 60_000;
const MAX_ROUNDS = 10;
const MAX_ITEMS = 500;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS restaurant_copy (
  origin TEXT NOT NULL,
  terminal_id INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  payload TEXT NOT NULL,            -- enc: pos context, branch menu, floor
  menu_at TEXT,
  taken_at TEXT NOT NULL,
  PRIMARY KEY (origin, terminal_id, user_id)
);
CREATE TABLE IF NOT EXISTS restaurant_outbox (
  id TEXT PRIMARY KEY,
  origin TEXT NOT NULL,
  terminal_id INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  state TEXT NOT NULL,
  item TEXT NOT NULL,               -- enc: the op, its data, what the server said
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS restaurant_outbox_terminal ON restaurant_outbox(origin, terminal_id, user_id, seq);
`;

interface Scope {
  origin: string;
  user: string;
  terminal: RestaurantPairing;
}

interface CopyData {
  pos: unknown;
  menu: unknown;
  floor: unknown;
}

export interface RestaurantSyncDeps {
  db: Database;
  vault: () => Vault;
  http: Pick<HttpClient, 'request'>;
  origin: () => string | null;
  /** The signed-in person who may use the Restaurant app, or null. */
  user: () => string | null;
  terminal: () => RestaurantPairing | null;
  terminalKey: () => string | null;
  caps: () => { offlineCache: boolean; offlineQueue: 'allowed' | 'drafts_only' | 'disabled' };
  appVersion: string;
  /** The print agent's view of the printers it hosts, for the heartbeat. */
  printers: () => Array<{ id: number; status: 'online' | 'error' }>;
  agent: () => RestaurantStatus['agent'];
  notify: (n: { id: string; title: string; body: string; link: string }) => void;
  changed: () => void;
  now?: () => number;
}

export class RestaurantSync {
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<RestaurantStatus> | null = null;
  private again: Promise<RestaurantStatus> | null = null;
  private reachable = true;
  private lastContact: string | null = null;
  private lastSync: RestaurantStatus['last_sync'] = null;
  private problem: string | null = null;
  private lastSeq = 0;

  constructor(private readonly d: RestaurantSyncDeps) {
    d.db.raw.exec(SCHEMA);
  }

  private now(): number {
    return this.d.now?.() ?? Date.now();
  }

  private stamp(): string {
    return new Date(this.now()).toISOString();
  }

  private scope(): Scope | null {
    const origin = this.d.origin();
    const user = this.d.user();
    const terminal = this.d.terminal();
    return origin && user && terminal ? { origin, user, terminal } : null;
  }

  /* ── The loop ─────────────────────────────────────────────────────── */

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.sync(), TICK_MS);
    this.timer.unref?.();
    void this.sync();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Send what waits, beat, and bring the copy up to date — now. Asked again mid-run, it runs once more after. */
  sync(): Promise<RestaurantStatus> {
    if (this.running) {
      this.again ??= this.running.then(() => {
        this.again = null;
        return this.sync();
      });
      return this.again;
    }
    this.running = this.run().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async run(): Promise<RestaurantStatus> {
    const s = this.scope();
    const key = this.d.terminalKey();
    if (!s || !key) return this.status();
    try {
      await this.replay(s, key);
      await this.heartbeat(s, key);
      await this.pull(s, key);
      this.problem = null;
    } catch (e) {
      if (isDesktopError(e) && (e.code === 'NETWORK_UNREACHABLE' || e.code === 'TLS_ERROR')) {
        this.reachable = false;
      } else {
        this.reachable = true;
        /* A revoked key, or a person who may not work the till: the server says which. */
        this.problem = e instanceof Error ? e.message : String(e);
        if (!isDesktopError(e) || e.status !== 403) log.warn('restaurant sync failed', { error: this.problem });
      }
    }
    this.d.changed();
    return this.status();
  }

  private async call<T>(method: string, path: string, key: string, s: Scope, opts: { query?: Record<string, string | number | undefined>; body?: unknown; idem?: string } = {}): Promise<T> {
    const headers: Record<string, string> = { 'X-Terminal-Key': key };
    if (opts.idem) headers['Idempotency-Key'] = opts.idem;
    const data = await this.d.http.request<T>(method, `${RESTAURANT_API}${path}`, { query: { org: s.terminal.org_id, ...(opts.query ?? {}) }, body: opts.body, headers, timeoutMs: 30_000 });
    this.reachable = true;
    this.lastContact = this.stamp();
    return data;
  }

  /* ── The outbox ───────────────────────────────────────────────────── */

  private load(s: Scope): RestaurantOutboxItem[] {
    const vault = this.d.vault();
    const out: RestaurantOutboxItem[] = [];
    for (const r of this.d.db.all<{ id: string; seq: number; state: string; item: string }>(
      'SELECT id, seq, state, item FROM restaurant_outbox WHERE origin = ? AND terminal_id = ? AND user_id = ? ORDER BY seq',
      s.origin,
      s.terminal.terminal_id,
      s.user,
    )) {
      const item = vault.decrypt<RestaurantOutboxItem>(r.item);
      if (item) out.push({ ...item, id: r.id, seq: r.seq, state: r.state as RestaurantOutboxItem['state'] });
    }
    return out;
  }

  private save(s: Scope, items: RestaurantOutboxItem[]): void {
    const vault = this.d.vault();
    this.d.db.tx(() => {
      const keep = new Set(items.map((i) => i.id));
      for (const r of this.d.db.all<{ id: string }>('SELECT id FROM restaurant_outbox WHERE origin = ? AND terminal_id = ? AND user_id = ?', s.origin, s.terminal.terminal_id, s.user)) {
        if (!keep.has(r.id)) this.d.db.run('DELETE FROM restaurant_outbox WHERE id = ?', r.id);
      }
      for (const i of items) {
        this.d.db.run(
          `INSERT INTO restaurant_outbox (id, origin, terminal_id, user_id, seq, state, item, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET state = excluded.state, item = excluded.item, updated_at = excluded.updated_at`,
          i.id,
          s.origin,
          s.terminal.terminal_id,
          s.user,
          i.seq,
          i.state,
          vault.encrypt(i),
          i.created_at,
          i.updated_at,
        );
      }
    });
  }

  /** Why this computer may not keep this for later, or null when it may. */
  private whyNot(op: RestaurantOutboxInput['op'] | null): string | null {
    const q = this.d.caps().offlineQueue;
    if (q !== 'allowed') {
      return q === 'disabled'
        ? 'Your company does not let this computer keep changes offline.'
        : 'Only a trusted computer keeps orders to send later. An administrator can mark this one trusted in WorkSuite → Devices.';
    }
    const s = this.scope();
    const pos = s ? (this.readCopy(s)?.pos as { policy?: { offline_actions?: unknown } } | undefined) : undefined;
    const allowed = pos?.policy?.offline_actions;
    if (op && Array.isArray(allowed) && !allowed.includes(OP_NEEDS[op])) return 'This branch does not let its tills do that offline.';
    return null;
  }

  outbox(): RestaurantOutboxItem[] {
    const s = this.scope();
    return s ? this.load(s) : [];
  }

  /** Keep something the till did for when WorkSuite answers. */
  add(raw: RestaurantOutboxInput): RestaurantOutboxItem {
    const s = this.scope();
    if (!s) throw new DesktopError('NOT_SIGNED_IN', 'This computer is not a paired restaurant terminal.');
    const input = restaurantOutboxAdd.parse(raw);
    const why = this.whyNot(input.op);
    if (why) throw new DesktopError('POLICY_DENIED', why);
    const items = this.load(s);
    if (items.length >= MAX_ITEMS) throw new DesktopError('CONFLICT', 'This till has too much waiting for WorkSuite. Send it before taking more orders offline.');
    const data = input.data as Record<string, unknown>;
    if (input.op === 'create_order' && items.some((i) => i.op === 'create_order' && i.data.uuid === data.uuid)) {
      throw new DesktopError('CONFLICT', 'That order is already waiting.');
    }
    const seqRow = this.d.db.get<{ m: number | null }>('SELECT MAX(seq) AS m FROM restaurant_outbox');
    const at = this.stamp();
    const item: RestaurantOutboxItem = {
      id: randomUUID(),
      seq: (seqRow?.m ?? 0) + 1,
      ref: `t${s.terminal.terminal_id}-${randomUUID()}`,
      op: input.op,
      data: input.op === 'create_order' ? { ...data, made_at: at } : data,
      label: input.label,
      needs: needsOf(items, data),
      state: 'waiting',
      attempts: 0,
      message: null,
      conflict_ids: [],
      order: null,
      created_at: at,
      updated_at: at,
    };
    this.save(s, [...items, item]);
    this.d.changed();
    void this.sync();
    return item;
  }

  /** A person's answer to a refusal or a conflict: send it again, or let it go. */
  resolve(id: string, action: 'retry' | 'drop'): RestaurantOutboxItem[] {
    const s = this.scope();
    if (!s) throw new DesktopError('NOT_SIGNED_IN', 'This computer is not a paired restaurant terminal.');
    let items = this.load(s);
    const item = items.find((i) => i.id === id);
    if (!item) throw new DesktopError('NOT_FOUND', 'That is no longer waiting.');
    if (action === 'drop') items = dropWithDependents(items, id).items;
    else {
      if (item.state === 'conflict') throw new DesktopError('CONFLICT', 'WorkSuite has this already; a manager settles it in Conflicts.');
      items = items.map((i) => (i.id === id ? retried(i, `t${s.terminal.terminal_id}-${randomUUID()}`, this.stamp()) : i));
    }
    this.save(s, items);
    this.d.changed();
    void this.sync();
    return items;
  }

  private async replay(s: Scope, key: string): Promise<void> {
    const total = { applied: 0, conflicts: 0, refused: 0 };
    const fresh: RestaurantOutboxItem[] = [];
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const items = this.load(s);
      const send = batch(items);
      if (send.length === 0) break;
      const data = await this.call<{ results?: SyncResult[] }>('POST', '/sync', key, s, {
        body: { branch_id: s.terminal.branch_id, ops: send.map((i) => ({ op: i.op, client_ref: i.ref, data: i.data })) },
        idem: batchKey(s.terminal.terminal_id, send),
      });
      const done = apply(items, send, data?.results ?? [], this.stamp());
      this.save(s, done.items);
      total.applied += done.applied;
      total.conflicts += done.conflicts.length;
      total.refused += done.refused.length;
      fresh.push(...done.conflicts, ...done.refused);
      if (done.applied + done.conflicts.length + done.refused.length === 0) break;
    }
    if (total.applied + total.conflicts + total.refused > 0) this.lastSync = { at: this.stamp(), ...total };
    if (fresh.length > 0) {
      this.d.notify({
        id: `restaurant-outbox-${fresh.map((f) => f.ref).join(',')}`.slice(0, 200),
        title: fresh.length === 1 ? 'An offline order needs a look' : `${fresh.length} offline orders need a look`,
        body: fresh.length === 1 ? `${fresh[0]!.label} — ${fresh[0]!.message ?? 'WorkSuite did not take it as it was.'}` : 'WorkSuite did not take them as they were. Open Restaurant to see.',
        link: '/restaurant?view=outbox',
      });
    }
  }

  private async heartbeat(s: Scope, key: string): Promise<void> {
    const all = this.d.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM restaurant_outbox WHERE origin = ? AND terminal_id = ? AND state = 'waiting'", s.origin, s.terminal.terminal_id);
    const hb = await this.call<{ last_seq?: number } | null>('POST', '/sync/heartbeat', key, s, {
      body: { queue_size: all?.n ?? 0, app_version: `desktop ${this.d.appVersion}`, online: true, last_sync_at: this.lastSync?.at ?? null, printers: this.d.printers() },
    });
    if (typeof hb?.last_seq === 'number') this.lastSeq = hb.last_seq;
  }

  /* ── The copy ─────────────────────────────────────────────────────── */

  private row(s: Scope): { payload: string; menu_at: string | null; taken_at: string } | undefined {
    return this.d.db.get('SELECT payload, menu_at, taken_at FROM restaurant_copy WHERE origin = ? AND terminal_id = ? AND user_id = ?', s.origin, s.terminal.terminal_id, s.user);
  }

  private readCopy(s: Scope): CopyData | null {
    const r = this.row(s);
    return r ? (this.d.vault().decrypt<CopyData>(r.payload) ?? null) : null;
  }

  private async pull(s: Scope, key: string): Promise<void> {
    if (!this.d.caps().offlineCache) {
      this.d.db.run('DELETE FROM restaurant_copy WHERE origin = ? AND terminal_id = ? AND user_id = ?', s.origin, s.terminal.terminal_id, s.user);
      return;
    }
    const r = this.row(s);
    const old = this.readCopy(s);
    const branch = s.terminal.branch_id;
    /* A kitchen screen's cook may not see the till or the floor: the copy keeps what it has of those. */
    const mayNot = (had: unknown) => (e: unknown) => {
      if (isDesktopError(e) && (e.status === 403 || e.status === 404)) return had ?? null;
      throw e;
    };
    const pos = await this.call('GET', '/pos', key, s, { query: { branch_id: branch } }).catch(mayNot(old?.pos));
    const floor = await this.call('GET', '/floor', key, s, { query: { branch_id: branch } }).catch(mayNot(old?.floor));
    let menu: unknown = old?.menu ?? null;
    let menuAt = r?.menu_at ?? null;
    if (!menu || !menuAt || this.now() - Date.parse(menuAt) > MENU_MS) {
      menu = await this.call('GET', `/menu/branch/${branch}`, key, s, { query: { channel: 'dine_in' } }).catch(mayNot(menu));
      menuAt = this.stamp();
    }
    const data: CopyData = { pos, menu, floor };
    this.d.db.run(
      `INSERT INTO restaurant_copy (origin, terminal_id, user_id, payload, menu_at, taken_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(origin, terminal_id, user_id) DO UPDATE SET payload = excluded.payload, menu_at = excluded.menu_at, taken_at = excluded.taken_at`,
      s.origin,
      s.terminal.terminal_id,
      s.user,
      this.d.vault().encrypt(data),
      menuAt,
      this.stamp(),
    );
  }

  /* ── What the screens read ────────────────────────────────────────── */

  copy(): RestaurantCopy | null {
    const s = this.scope();
    if (!s || !this.d.caps().offlineCache) return null;
    const r = this.row(s);
    const c = r ? this.d.vault().decrypt<CopyData>(r.payload) : undefined;
    if (!r || !c) return null;
    return { terminal_id: s.terminal.terminal_id, branch_id: s.terminal.branch_id, taken_at: r.taken_at, pos: c.pos, menu: c.menu, floor: c.floor };
  }

  /** What this person made at this till that WorkSuite does not have yet. */
  pending(): number {
    const s = this.scope();
    if (!s) return 0;
    return this.d.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM restaurant_outbox WHERE origin = ? AND terminal_id = ? AND user_id = ? AND state = 'waiting'", s.origin, s.terminal.terminal_id, s.user)?.n ?? 0;
  }

  status(): RestaurantStatus {
    const s = this.scope();
    const base = { reachable: this.reachable, last_contact: this.lastContact, last_sync: this.lastSync, problem: this.problem, last_seq: this.lastSeq, agent: this.d.agent() };
    if (!s) {
      return { ...base, pairing: this.d.terminal(), waiting: 0, conflicts: 0, refused: 0, others: 0, can_queue: false, why_not: 'This computer is not a paired restaurant terminal.', copy: null };
    }
    const counts = this.d.db.all<{ user_id: string; state: string; n: number }>(
      'SELECT user_id, state, COUNT(*) AS n FROM restaurant_outbox WHERE origin = ? AND terminal_id = ? GROUP BY user_id, state',
      s.origin,
      s.terminal.terminal_id,
    );
    const mine = (state: string) => counts.filter((x) => x.user_id === s.user && x.state === state).reduce((t, x) => t + x.n, 0);
    const r = this.d.caps().offlineCache ? this.row(s) : undefined;
    const c = r ? this.d.vault().decrypt<CopyData>(r.payload) : undefined;
    const why = this.whyNot(null);
    return {
      ...base,
      pairing: s.terminal,
      waiting: mine('waiting'),
      conflicts: mine('conflict'),
      refused: mine('refused'),
      others: counts.filter((x) => x.user_id !== s.user).reduce((t, x) => t + x.n, 0),
      can_queue: why === null,
      why_not: why,
      copy: r && c ? { taken_at: r.taken_at, menu: !!c.menu, floor: !!c.floor } : null,
    };
  }

  /* ── Forgetting ───────────────────────────────────────────────────── */

  /** A plain sign-out: this person's copy goes; what they made waits for them. */
  signedOut(user: string): void {
    this.d.db.run('DELETE FROM restaurant_copy WHERE user_id = ?', user);
  }

  /** Unpaired: the old terminal's copy means nothing; its outbox goes only when asked (`discard`). Returns how many were dropped. */
  forgetTerminal(origin: string, terminalId: number, discard: boolean): number {
    this.d.db.run('DELETE FROM restaurant_copy WHERE origin = ? AND terminal_id = ?', origin, terminalId);
    if (!discard) return 0;
    const n = this.d.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM restaurant_outbox WHERE origin = ? AND terminal_id = ?', origin, terminalId)?.n ?? 0;
    this.d.db.run('DELETE FROM restaurant_outbox WHERE origin = ? AND terminal_id = ?', origin, terminalId);
    this.d.changed();
    return n;
  }

  /** How many of this terminal's items have not reached WorkSuite, anyone's. */
  unsent(origin: string, terminalId: number): number {
    return this.d.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM restaurant_outbox WHERE origin = ? AND terminal_id = ? AND state != 'conflict'", origin, terminalId)?.n ?? 0;
  }

  /** A remote wipe, or "remove WorkSuite's data". */
  forgetAll(): void {
    this.d.db.run('DELETE FROM restaurant_copy');
    this.d.db.run('DELETE FROM restaurant_outbox');
  }
}

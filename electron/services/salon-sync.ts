import { randomUUID } from 'node:crypto';
import type { SalonCopy, SalonCopyClient, SalonDeskInfo, SalonOutboxAction, SalonOutboxInput, SalonOutboxItem, SalonSyncStatus } from '@shared/types';
import { DesktopError, isDesktopError } from '../main/errors';
import { logger } from '../main/log';
import type { Database } from './db';
import type { HttpClient } from './http';
import { adoptClient, apply, batch, depth, dropWithDependents, KINDS, LOCAL_ID, needsOf, newKeyFor, type ReplayResult } from './salon-outbox';
import type { Vault } from './vault';

const log = logger('salon-sync');

/**
 * The front desk keeps working when WorkSuite is out of reach (OFF-01…08).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE DAY'S COPY
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The desk's copy of its day — the menu, the stylists, the clients seen in a
 * year, and the book from yesterday to the salon's "days ahead" — comes from
 * `desk/bootstrap`, and is kept current with `desk/delta` every minute and
 * taken whole again every hour. It is the signed-in person's copy (WorkSuite
 * answers with what they may see), kept encrypted, and only where the
 * company's desktop policy lets this computer keep data offline. Screens read
 * it when WorkSuite does not answer; they never prefer it to a live answer.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE OUTBOX
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * A new client, a booking or a check-in made while WorkSuite is out of reach
 * waits here, in order, and goes to `desk/outbox` when it answers; the
 * server judges each again (R-03). The outbox belongs to the person who made
 * it — WorkSuite keeps each person's keys apart, and an allergy read out is
 * that person's acknowledgement — so it waits through a plain sign-out for
 * them, and another person signed in at the counter sees only that it is
 * there. Money is never queued: payments, deposits and the register need
 * WorkSuite. Only a trusted computer queues, as the desktop policy says, and
 * only for a company that lets its desks book offline.
 *
 * The desk's key is added here, in the main process, as the API proxy adds
 * it to the screens' calls.
 */
const SALON = '/api/salon/v1';
const TICK_MS = 60_000;
const REFRESH_MS = 60 * 60_000;
/** Asked again with a little overlap: a change committed just after `at` is not lost behind the cursor. */
const OVERLAP_MS = 5_000;
const MAX_ROUNDS = 20;
const MAX_PAGES = 10;
const MAX_PAYLOAD = 20_000;

interface CopyData {
  desk: SalonDeskInfo | null;
  timezone: string;
  location: SalonCopy['location'];
  menu: unknown[];
  stylists: unknown[];
  settings: Record<string, unknown>;
  options: SalonCopy['options'];
  visits: CopyVisit[];
  clients: CopyClient[];
}

interface CopyVisit {
  id: number;
  date?: string;
  start?: string;
  starts_at?: string;
  status?: string;
  client?: { id?: number; name?: string };
  cancel?: { by?: string } | null;
  [k: string]: unknown;
}

type CopyClient = SalonCopyClient;

interface CopyRow {
  payload: string;
  since: string | null;
  after: number | null;
  refreshed_at: string;
  pulled_at: string;
}

export interface SalonSyncDeps {
  db: Database;
  vault: () => Vault;
  http: Pick<HttpClient, 'request'>;
  origin: () => string | null;
  /** The signed-in person, once the session is ready. */
  user: () => string | null;
  desk: () => { desk_id: number; name: string } | null;
  deskKey: () => string | null;
  caps: () => { offlineCache: boolean; offlineQueue: 'allowed' | 'drafts_only' | 'disabled' };
  appVersion: string;
  notify: (n: { id: string; title: string; body: string; link: string }) => void;
  changed: () => void;
  now?: () => number;
}

export class SalonSync {
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<SalonSyncStatus> | null = null;
  private again: Promise<SalonSyncStatus> | null = null;
  private reachable = true;
  private lastContact: string | null = null;
  private lastSync: SalonSyncStatus['last_sync'] = null;
  private problem: string | null = null;

  constructor(private readonly d: SalonSyncDeps) {}

  private now(): number {
    return this.d.now?.() ?? Date.now();
  }

  private stamp(): string {
    return new Date(this.now()).toISOString();
  }

  /** Who, where and which desk: nothing is read or kept without all three. */
  private scope(): { origin: string; user: string; desk: number; name: string } | null {
    const origin = this.d.origin();
    const user = this.d.user();
    const desk = this.d.desk();
    return origin && user && desk ? { origin, user, desk: desk.desk_id, name: desk.name } : null;
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

  /**
   * Send what waits and bring the copy up to date, now. One run at a time:
   * asked again while one runs — a walk-in kept mid-run, the line back — it
   * runs once more after it, so nothing waits for the next tick.
   */
  sync(): Promise<SalonSyncStatus> {
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

  private async run(): Promise<SalonSyncStatus> {
    const s = this.scope();
    const key = this.d.deskKey();
    if (!s || !key) return this.status();
    try {
      /* The outbox refused as a whole (writes turned off, a bad answer) still leaves the copy to keep current. */
      let refusedWhole: string | null = null;
      try {
        await this.replay(s, key);
      } catch (e) {
        if (!isDesktopError(e) || e.code === 'NETWORK_UNREACHABLE' || e.code === 'TLS_ERROR' || e.status === 403) throw e;
        refusedWhole = e.message;
      }
      await this.pull(s, key);
      await this.heartbeat(s, key);
      this.problem = refusedWhole;
    } catch (e) {
      if (isDesktopError(e) && (e.code === 'NETWORK_UNREACHABLE' || e.code === 'TLS_ERROR')) {
        this.reachable = false;
      } else if (isDesktopError(e) && e.status === 403) {
        this.reachable = true;
        /* A desk revoked, or a person who may not work the desk: WorkSuite says which. */
        this.problem = e.message || 'This desk is not paired, or was revoked. Pair this computer again.';
      } else {
        this.reachable = true;
        this.problem = e instanceof Error ? e.message : String(e);
        log.warn('salon sync failed', { error: this.problem });
      }
    }
    this.d.changed();
    return this.status();
  }

  private async call<T>(method: string, path: string, key: string, opts: { query?: Record<string, string | number | undefined>; body?: unknown } = {}): Promise<T> {
    const data = await this.d.http.request<T>(method, `${SALON}${path}`, { ...opts, headers: { 'X-Salon-Desk-Key': key }, timeoutMs: 30_000 });
    this.reachable = true;
    this.lastContact = this.stamp();
    return data;
  }

  /* ── The outbox ───────────────────────────────────────────────────── */

  private load(s: { origin: string; user: string; desk: number }): SalonOutboxItem[] {
    const vault = this.d.vault();
    const out: SalonOutboxItem[] = [];
    for (const r of this.d.db.all<{ id: string; seq: number; state: string; item: string }>(
      'SELECT id, seq, state, item FROM salon_outbox WHERE origin = ? AND desk_id = ? AND user_id = ? ORDER BY seq',
      s.origin,
      s.desk,
      s.user,
    )) {
      const item = vault.decrypt<SalonOutboxItem>(r.item);
      if (item) out.push({ ...item, id: r.id, seq: r.seq, state: r.state as SalonOutboxItem['state'] });
    }
    return out;
  }

  private save(s: { origin: string; user: string; desk: number }, items: SalonOutboxItem[]): void {
    const vault = this.d.vault();
    this.d.db.tx(() => {
      const keep = new Set(items.map((i) => i.id));
      for (const r of this.d.db.all<{ id: string }>('SELECT id FROM salon_outbox WHERE origin = ? AND desk_id = ? AND user_id = ?', s.origin, s.desk, s.user)) {
        if (!keep.has(r.id)) this.d.db.run('DELETE FROM salon_outbox WHERE id = ?', r.id);
      }
      for (const i of items) {
        this.d.db.run(
          `INSERT INTO salon_outbox (id, origin, desk_id, user_id, seq, state, item, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET state = excluded.state, item = excluded.item, updated_at = excluded.updated_at`,
          i.id,
          s.origin,
          s.desk,
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

  /** Why this computer may not keep changes for later, or null when it may. */
  private whyNot(copy: CopyData | null): string | null {
    const q = this.d.caps().offlineQueue;
    if (q !== 'allowed') {
      return q === 'disabled'
        ? 'Your company does not let this computer keep changes offline.'
        : 'Only a trusted computer keeps changes to send later. An administrator can mark this one trusted in WorkSuite → Devices.';
    }
    if (copy && copy.settings.offline_writes === false) return 'This company does not let its desks book offline.';
    return null;
  }

  outbox(): SalonOutboxItem[] {
    const s = this.scope();
    return s ? this.load(s) : [];
  }

  /** Keep something the counter did for when WorkSuite answers (OFF-03). */
  add(input: SalonOutboxInput): SalonOutboxItem {
    const s = this.scope();
    if (!s) throw new DesktopError('NOT_SIGNED_IN', 'This computer is not a paired front desk.');
    const why = this.whyNot(this.readCopy(s));
    if (why) throw new DesktopError('POLICY_DENIED', why);
    if (!KINDS.includes(input.kind)) throw new DesktopError('IPC_VALIDATION_FAILED', 'That is not something a desk does offline.');
    const local = input.local_id ?? null;
    if (local !== null && (!LOCAL_ID.test(local) || (input.kind === 'client.create') !== local.startsWith('C-') || input.kind === 'visit.check_in')) {
      throw new DesktopError('IPC_VALIDATION_FAILED', 'That local id is not one this desk makes.');
    }
    if (JSON.stringify(input.payload).length > MAX_PAYLOAD) throw new DesktopError('IPC_VALIDATION_FAILED', 'That is too large to keep.');

    const items = this.load(s);
    const needs = needsOf(input.payload);
    const known = new Set(items.map((i) => i.local_id).filter(Boolean));
    if (needs.some((n) => !known.has(n))) throw new DesktopError('IPC_VALIDATION_FAILED', 'That names a client or booking this desk does not have waiting.');

    const seqRow = this.d.db.get<{ m: number | null }>('SELECT MAX(seq) AS m FROM salon_outbox');
    const at = this.stamp();
    const item: SalonOutboxItem = {
      id: randomUUID(),
      seq: (seqRow?.m ?? 0) + 1,
      key: `desk${s.desk}-${randomUUID()}`,
      kind: input.kind,
      local_id: local,
      payload: input.payload,
      needs,
      label: input.label.slice(0, 200),
      detail: input.detail?.slice(0, 300) ?? null,
      created_at: at,
      updated_at: at,
      state: 'waiting',
      attempts: 0,
      message: null,
      next: null,
      choices: [],
    };
    this.save(s, [...items, item]);
    this.d.changed();
    void this.sync();
    return item;
  }

  /** A person's answer to a refusal (OFF-08): drop it, send it again, take the next time, pick a time, it is this client, or edit it. */
  resolve(a: SalonOutboxAction): SalonOutboxItem[] {
    const s = this.scope();
    if (!s) throw new DesktopError('NOT_SIGNED_IN', 'This computer is not a paired front desk.');
    let items = this.load(s);
    const item = items.find((i) => i.id === a.id);
    if (!item) throw new DesktopError('NOT_FOUND', 'That change is no longer waiting.');
    const again = (i: SalonOutboxItem, payload = i.payload): SalonOutboxItem => ({
      ...i,
      payload,
      needs: needsOf(payload),
      key: newKeyFor(i.key),
      state: 'waiting',
      message: null,
      next: null,
      choices: [],
      updated_at: this.stamp(),
    });

    switch (a.action) {
      case 'drop':
        items = dropWithDependents(items, item.id).items;
        break;
      case 'retry':
        items = items.map((i) => (i.id === item.id ? again(i) : i));
        break;
      case 'take_next': {
        const next = item.next && 'starts_at' in item.next ? item.next.starts_at : null;
        if (!next) throw new DesktopError('CONFLICT', 'WorkSuite offered no other time for this.');
        items = items.map((i) => (i.id === item.id ? again(i, { ...i.payload, starts_at: next }) : i));
        break;
      }
      case 'time':
        if (item.kind !== 'visit.book') throw new DesktopError('IPC_VALIDATION_FAILED', 'Only a booking has a time to choose.');
        items = items.map((i) => (i.id === item.id ? again(i, { ...i.payload, starts_at: a.starts_at }) : i));
        break;
      case 'client':
        items = adoptClient(items, item.id, a.client_id);
        break;
      case 'edit': {
        const allowed: Record<string, string[]> = {
          'client.create': ['name', 'mobile', 'email'],
          'visit.book': ['starts_at', 'note'],
          'visit.check_in': ['ack', 'statement', 'patch_override'],
        };
        const changes = Object.fromEntries(Object.entries(a.changes).filter(([k]) => allowed[item.kind]!.includes(k)));
        items = items.map((i) => (i.id === item.id ? again(i, { ...i.payload, ...changes }) : i));
        break;
      }
    }
    this.save(s, items);
    this.d.changed();
    void this.sync();
    return items;
  }

  private async replay(s: { origin: string; user: string; desk: number }, key: string): Promise<void> {
    let fresh: SalonOutboxItem[] = [];
    const total = { accepted: 0, refused: 0, duplicates: 0 };
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const items = this.load(s);
      const send = batch(items);
      if (send.length === 0) break;
      const data = await this.call<{ results?: ReplayResult[] }>('POST', '/desk/outbox', key, {
        body: {
          desk: s.desk,
          app_version: `desktop ${this.d.appVersion}`,
          items: send.map((i) => ({ key: i.key, kind: i.kind, local_id: i.local_id, payload: i.payload, made_at: i.created_at })),
        },
      });
      const done = apply(items, send, data?.results ?? [], this.stamp());
      this.save(s, done.items);
      total.accepted += done.accepted;
      total.duplicates += done.duplicates;
      total.refused += done.refused.length;
      fresh = [...fresh, ...done.refused];
      if (done.stop || done.accepted + done.duplicates + done.refused.length === 0) break;
    }
    if (total.accepted + total.refused + total.duplicates > 0) this.lastSync = { at: this.stamp(), ...total };
    if (fresh.length > 0) {
      this.d.notify({
        id: `salon-outbox-${fresh.map((f) => f.key).join(',')}`.slice(0, 200),
        title: fresh.length === 1 ? 'A change from the desk needs you' : `${fresh.length} changes from the desk need you`,
        body: fresh.length === 1 ? `${fresh[0]!.label} — ${fresh[0]!.message ?? 'WorkSuite would not do it.'}` : 'WorkSuite would not do them as they were. Open SalonMate to decide.',
        link: '/salon?view=outbox',
      });
    }
  }

  /* ── The copy ─────────────────────────────────────────────────────── */

  private row(s: { origin: string; user: string; desk: number }): CopyRow | undefined {
    return this.d.db.get<CopyRow>('SELECT payload, since, after, refreshed_at, pulled_at FROM salon_copy WHERE origin = ? AND desk_id = ? AND user_id = ?', s.origin, s.desk, s.user);
  }

  private readCopy(s: { origin: string; user: string; desk: number }): CopyData | null {
    const r = this.row(s);
    return r ? (this.d.vault().decrypt<CopyData>(r.payload) ?? null) : null;
  }

  private writeCopy(s: { origin: string; user: string; desk: number }, data: CopyData, since: string | null, after: number | null, refreshed: string): void {
    this.d.db.run(
      `INSERT INTO salon_copy (origin, desk_id, user_id, payload, since, after, refreshed_at, pulled_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(origin, desk_id, user_id) DO UPDATE SET payload = excluded.payload, since = excluded.since, after = excluded.after,
         refreshed_at = excluded.refreshed_at, pulled_at = excluded.pulled_at`,
      s.origin,
      s.desk,
      s.user,
      this.d.vault().encrypt(data),
      since,
      after,
      refreshed,
      this.stamp(),
    );
  }

  private async pull(s: { origin: string; user: string; desk: number }, key: string): Promise<void> {
    if (!this.d.caps().offlineCache) {
      this.d.db.run('DELETE FROM salon_copy WHERE origin = ? AND desk_id = ? AND user_id = ?', s.origin, s.desk, s.user);
      return;
    }
    const r = this.row(s);
    const old = r ? this.d.vault().decrypt<CopyData>(r.payload) : undefined;
    if (!r || !old || this.now() - Date.parse(r.refreshed_at) > REFRESH_MS) {
      await this.bootstrap(s, key);
      return;
    }

    let since = r.since;
    let after = r.after;
    if (since && after === null) since = new Date(Date.parse(since.replace(' ', 'T') + (since.endsWith('Z') ? '' : 'Z')) - OVERLAP_MS).toISOString();
    const byId = new Map(old.visits.map((v) => [v.id, v]));
    const changed: CopyVisit[] = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const d = await this.call<{ at: string; after: number | null; more: boolean; visits: CopyVisit[] }>('GET', '/desk/delta', key, {
        query: { desk: s.desk, since: since ?? undefined, after: after ?? undefined },
      });
      for (const v of d.visits ?? []) {
        changed.push(v);
        byId.set(v.id, v);
      }
      const moved = d.at !== since || (d.after ?? null) !== after;
      since = d.at;
      after = d.more ? (d.after ?? null) : null;
      if (!d.more || !moved) break;
    }

    const merged = { ...old, visits: prune([...byId.values()], old.timezone, Number(old.settings.cache_days_ahead ?? 14), this.now()) };
    this.writeCopy(s, merged, since, after, r.refreshed_at);
    this.tellCancellations(old, changed);
  }

  private async bootstrap(s: { origin: string; user: string; desk: number }, key: string): Promise<void> {
    const b = await this.call<Omit<CopyData, 'options' | 'visits' | 'clients'> & { at: string; visits: CopyVisit[]; clients: CopyClient[] }>('GET', '/desk/bootstrap', key, { query: { desk: s.desk } });
    let options: CopyData['options'] = null;
    try {
      const org = b.desk?.org_id;
      options = await this.call<NonNullable<CopyData['options']>>('GET', '/options', key, { query: org ? { org } : {} });
    } catch (e) {
      if (!isDesktopError(e) || e.code === 'NETWORK_UNREACHABLE') throw e;
    }
    const data: CopyData = {
      desk: b.desk ?? null,
      timezone: b.timezone,
      location: b.location,
      menu: b.menu ?? [],
      stylists: b.stylists ?? [],
      settings: b.settings ?? {},
      options: options ? { may: options.may ?? {}, currency: options.currency, company: options.company, ack_severity: options.ack_severity, locations: options.locations } : null,
      visits: prune(b.visits ?? [], b.timezone, Number(b.settings?.cache_days_ahead ?? 14), this.now()),
      clients: b.clients ?? [],
    };
    const had = this.readCopy(s);
    this.writeCopy(s, data, b.at ?? null, null, this.stamp());
    if (had) this.tellCancellations(had, data.visits);
  }

  /** A client cancelling today's visit from their own link or the portal tells nobody at the desk (the server raises nothing): the copy does. */
  private tellCancellations(old: CopyData, changed: CopyVisit[]): void {
    const today = dayIn(old.timezone, this.now());
    const was = new Map(old.visits.map((v) => [v.id, v]));
    for (const v of changed) {
      const before = was.get(v.id);
      if (!before || before.status === 'cancelled' || v.status !== 'cancelled' || v.cancel?.by !== 'client' || v.date !== today) continue;
      this.d.notify({
        id: `salon-cancelled-${v.id}`,
        title: `${v.client?.name ?? 'A client'} cancelled`,
        body: `Today's ${v.start ?? ''} visit${typeof v.number === 'string' ? ` (${v.number})` : ''} was cancelled from the client's own link.`,
        link: '/salon?view=today',
      });
    }
  }

  private async heartbeat(s: { origin: string; user: string; desk: number }, key: string): Promise<void> {
    const all = this.d.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM salon_outbox WHERE origin = ? AND desk_id = ?', s.origin, s.desk);
    await this.call('POST', '/desk/heartbeat', key, { body: { desk: s.desk, app_version: `desktop ${this.d.appVersion}`, queue_depth: all?.n ?? 0 } });
  }

  /* ── What the screens read ────────────────────────────────────────── */

  copy(): SalonCopy | null {
    const s = this.scope();
    if (!s || !this.d.caps().offlineCache) return null;
    const r = this.row(s);
    const c = r ? this.d.vault().decrypt<CopyData>(r.payload) : undefined;
    if (!r || !c) return null;
    return {
      desk_id: s.desk,
      refreshed_at: r.refreshed_at,
      pulled_at: r.pulled_at,
      timezone: c.timezone,
      location: c.location,
      menu: c.menu,
      stylists: c.stylists,
      visits: c.visits,
      settings: c.settings,
      options: c.options,
      desk: c.desk,
    };
  }

  /** Clients in the copy, by any part of their name or email, or three digits or more of their mobile — or the one client asked for. */
  clients(q: string, limit: number, id?: number): CopyClient[] {
    const s = this.scope();
    const c = s && this.d.caps().offlineCache ? this.readCopy(s) : null;
    if (!c) return [];
    return id ? c.clients.filter((x) => x.id === id).slice(0, 1) : searchClients(c.clients, q, limit);
  }

  status(): SalonSyncStatus {
    const s = this.scope();
    if (!s) {
      return { desk_id: null, copy: null, waiting: 0, refused: 0, others: 0, reachable: this.reachable, last_contact: this.lastContact, last_sync: this.lastSync, problem: this.problem, can_write: false, why_not: 'This computer is not a paired front desk.', can_keep_copy: false };
    }
    const r = this.row(s);
    const c = r ? this.d.vault().decrypt<CopyData>(r.payload) : undefined;
    const counts = this.d.db.all<{ user_id: string; state: string; n: number }>(
      'SELECT user_id, state, COUNT(*) AS n FROM salon_outbox WHERE origin = ? AND desk_id = ? GROUP BY user_id, state',
      s.origin,
      s.desk,
    );
    const mine = (state: string) => counts.filter((x) => x.user_id === s.user && x.state === state).reduce((t, x) => t + x.n, 0);
    const why = this.whyNot(c ?? null);
    return {
      desk_id: s.desk,
      copy: r && c ? { refreshed_at: r.refreshed_at, pulled_at: r.pulled_at, visits: c.visits.length, clients: c.clients.length } : null,
      waiting: mine('waiting'),
      refused: mine('refused'),
      others: counts.filter((x) => x.user_id !== s.user).reduce((t, x) => t + x.n, 0),
      reachable: this.reachable,
      last_contact: this.lastContact,
      last_sync: this.lastSync,
      problem: this.problem,
      can_write: why === null,
      why_not: why,
      can_keep_copy: this.d.caps().offlineCache,
    };
  }

  /* ── Forgetting ───────────────────────────────────────────────────── */

  /** A plain sign-out: this person's copy goes (as the rest of the offline cache does); what they made waits for them. */
  signedOut(user: string): void {
    this.d.db.run('DELETE FROM salon_copy WHERE user_id = ?', user);
  }

  /** "Pair this computer again": the old desk's copy and outbox mean nothing to a new desk. */
  forgetDesk(origin: string, desk: number): number {
    const n = this.d.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM salon_outbox WHERE origin = ? AND desk_id = ?', origin, desk)?.n ?? 0;
    this.d.db.run('DELETE FROM salon_copy WHERE origin = ? AND desk_id = ?', origin, desk);
    this.d.db.run('DELETE FROM salon_outbox WHERE origin = ? AND desk_id = ?', origin, desk);
    this.d.changed();
    return n;
  }

  /** A remote wipe, or "remove WorkSuite's data". */
  forgetAll(): void {
    this.d.db.run('DELETE FROM salon_copy');
    this.d.db.run('DELETE FROM salon_outbox');
  }
}

/** Today on the salon's calendar. */
export function dayIn(tz: string, at: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(at));
}

/** The copy's window: yesterday to the salon's days ahead, on its own calendar (as bootstrap sends it). */
export function prune<T extends { date?: string }>(visits: T[], tz: string, ahead: number, at: number): T[] {
  const from = dayIn(tz, at - 86_400_000);
  const to = dayIn(tz, at + Math.max(1, ahead) * 86_400_000);
  return visits.filter((v) => !v.date || (v.date >= from && v.date <= to)).sort((a, b) => String((a as { starts_at?: string }).starts_at ?? '').localeCompare(String((b as { starts_at?: string }).starts_at ?? '')));
}

/** Two-digit country calling codes (ITU E.164); 1 and 7 are one digit, the rest three. */
const CC2 = new Set('20 27 30 31 32 33 34 36 39 40 41 43 44 45 46 47 48 49 51 52 53 54 55 56 57 58 60 61 62 63 64 65 66 81 82 84 86 90 91 92 93 94 95 98'.split(' '));

/** A mobile as it is dialled at home, without the trunk 0: "+94 77 123 4567" → "771234567". */
export function nationalDigits(phone: string): string {
  const d = phone.replace(/\D+/g, '');
  if (!phone.trim().startsWith('+')) return d.replace(/^0+/, '');
  if (/^[17]/.test(d)) return d.slice(1);
  return CC2.has(d.slice(0, 2)) ? d.slice(2) : d.slice(3);
}

/**
 * Clients by any part of their name or email, or three digits or more of
 * their mobile — as stored ("+9477…"), or as the desk says it ("077…").
 */
export function searchClients<T extends { name: string; phone: string | null; email: string | null }>(clients: T[], q: string, limit: number): T[] {
  const t = q.trim().toLowerCase();
  const digits = t.replace(/\D+/g, '');
  const local = /^\+/.test(t) ? null : digits.replace(/^0+/, '');
  const out: T[] = [];
  for (const c of clients) {
    if (out.length >= limit) break;
    if (t === '') {
      out.push(c);
      continue;
    }
    const phone = (c.phone ?? '').replace(/\D+/g, '');
    const byPhone = digits.length >= 3 && (phone.includes(digits) || (local !== null && local.length >= 2 && digits.startsWith('0') && nationalDigits(c.phone ?? '').startsWith(local)));
    if (c.name.toLowerCase().includes(t) || (c.email ?? '').toLowerCase().includes(t) || byPhone) out.push(c);
  }
  return out;
}

export { depth };

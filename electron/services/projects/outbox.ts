import { randomUUID } from 'node:crypto';
import { PROJECTS_API, TASK_STATUS_LABEL, isConflict, nextToSend, type ProjectTaskStatus, type ProjectsOutboxItem, type ProjectsOutboxKind, type ProjectsOutboxState, type ProjectsSubmit, type ProjectsSubmitResult } from '@shared/projects';
import { isDesktopError } from '../../main/errors';
import { logger } from '../../main/log';
import type { Database } from '../db';
import type { HttpClient } from '../http';
import type { Vault } from '../vault';

const log = logger('projects-outbox');

/**
 * WorkSuite Projects' outbox (PRJ-DSK-04, NFR-09, acceptance #11).
 *
 * What the person did in Projects while WorkSuite was out of reach — a card moved, a note (comment) added, time
 * logged, a timer stopped — is written here, sealed, before they are told it was kept, and sent in the order it was
 * done when the connection is back (`replay`): on reconnect, on waking, at sign-in and on Try now.
 *
 * Each item carries its own idempotency key, sent as `Idempotency-Key` every time it is tried, so a send cut off
 * halfway and tried again is one change on a server that honours the key. A timer stopped offline is the one
 * multi-step item: its running entry is removed, then the time up to the stop is logged — the step reached is kept
 * with the item, so a retry never removes or logs twice, and exactly one entry results.
 *
 * A move never overwrites somebody else's change (NFR-09): before it is sent, the task is read again, and when its
 * `updated_at` is no longer the one the move was made from (and it is not already where I put it), the move stops
 * and waits for the person — keep theirs, or apply mine. A later move of that task waits behind it. Comments and
 * time add, never overwrite, and go on.
 *
 * Tables are made here (IF NOT EXISTS), as Restaurant's are, so this module's schema stands on its own.
 */

const SCHEMA = `
CREATE TABLE IF NOT EXISTS projects_outbox (
  id TEXT PRIMARY KEY,
  origin TEXT NOT NULL,
  user_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  state TEXT NOT NULL,
  item TEXT NOT NULL,               -- enc: kind, payload, label, base version, step, what the server said
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS projects_outbox_user ON projects_outbox(origin, user_id, seq);
`;

/** What is kept for one item (sealed in `item`). */
export interface StoredItem {
  id: string;
  seq: number;
  kind: ProjectsOutboxKind;
  taskId: number | null;
  label: string;
  state: ProjectsOutboxState;
  message: string | null;
  createdAt: string;
  /** The request's body (a move's status, a comment, a time entry; a stop's entry id and the time to log). */
  payload: Record<string, unknown>;
  /** A move's base: the task's `updated_at` in the copy it was made from. */
  base: string | null;
  /** Sent as `Idempotency-Key` on every try. */
  key: string;
  /** How far a timer's stop got: its running entry already removed. */
  step: 'deleted' | null;
  status: ProjectTaskStatus | null;
  theirs: ProjectsOutboxItem['theirs'];
  attempts: number;
}

export interface ProjectsOutboxDeps {
  db: Database;
  vault: () => Vault;
  http: Pick<HttpClient, 'request'>;
  /** The signed-in person who may use Projects, or null. */
  user: () => string | null;
  origin: () => string | null;
  /** The list changed: the screens and the title bar's count. */
  changed: (items: ProjectsOutboxItem[]) => void;
  now?: () => number;
}

type Outcome = 'done' | 'offline' | 'later' | 'conflict' | 'refused';

/** How a failed request leaves an item: wait for the connection, try later in line, ask the person, or refused. */
export function outcomeOf(e: unknown): { outcome: Exclude<Outcome, 'done'>; message: string } {
  const message = e instanceof Error ? e.message : String(e);
  if (!isDesktopError(e)) return { outcome: 'offline', message };
  if (e.code === 'NETWORK_UNREACHABLE' || e.code === 'TLS_ERROR' || e.code === 'SESSION_EXPIRED' || e.code === 'NOT_SIGNED_IN' || e.code === 'CANCELLED') return { outcome: 'offline', message };
  if (e.code === 'RATE_LIMITED' || e.code === 'SERVER_ERROR' || (e.status !== null && e.status >= 500)) return { outcome: 'later', message };
  if (e.code === 'CONFLICT') return { outcome: 'conflict', message };
  return { outcome: 'refused', message };
}

export function view(s: StoredItem): ProjectsOutboxItem {
  return { id: s.id, seq: s.seq, kind: s.kind, taskId: s.taskId, label: s.label, state: s.state, message: s.message, createdAt: s.createdAt, status: s.status, theirs: s.theirs };
}

interface TaskAnswer {
  task?: { status?: string; updated_at?: string | null; updated_by?: string | null; task_number?: string | null; title?: string | null };
}

export class ProjectsOutbox {
  private busy: Promise<{ online: boolean }> | null = null;
  private readonly now: () => number;

  constructor(private readonly d: ProjectsOutboxDeps) {
    // Made again in another account's database after a switch (Database.swap).
    d.db.onOpen((db) => db.raw.exec(SCHEMA));
    this.now = d.now ?? Date.now;
  }

  private scope(): { origin: string; user: string } | null {
    const user = this.d.user();
    const origin = this.d.origin();
    return user && origin ? { origin, user } : null;
  }

  private load(): StoredItem[] {
    const s = this.scope();
    if (!s) return [];
    const rows = this.d.db.all<{ id: string; item: string }>('SELECT id, item FROM projects_outbox WHERE origin = ? AND user_id = ? ORDER BY seq ASC', s.origin, s.user);
    const out: StoredItem[] = [];
    for (const r of rows) {
      const item = this.d.vault().decrypt<StoredItem>(r.item);
      if (item) out.push(item);
      else this.d.db.run('DELETE FROM projects_outbox WHERE id = ?', r.id);
    }
    return out;
  }

  private save(item: StoredItem): void {
    const s = this.scope();
    if (!s) return;
    const now = new Date(this.now()).toISOString();
    this.d.db.run(
      `INSERT INTO projects_outbox (id, origin, user_id, seq, state, item, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET state = excluded.state, item = excluded.item, updated_at = excluded.updated_at`,
      item.id,
      s.origin,
      s.user,
      item.seq,
      item.state,
      this.d.vault().encrypt(item),
      item.createdAt,
      now,
    );
  }

  private remove(id: string): void {
    const s = this.scope();
    if (s) this.d.db.run('DELETE FROM projects_outbox WHERE id = ? AND origin = ? AND user_id = ?', id, s.origin, s.user);
  }

  private emit(): void {
    this.d.changed(this.list());
  }

  list(): ProjectsOutboxItem[] {
    return this.load().map(view);
  }

  /** What still has to reach WorkSuite: the title bar's "n changes waiting". Refused items are the person's to clear. */
  pending(): number {
    return this.load().filter((i) => i.state !== 'refused').length;
  }

  /** The running entries a stop kept here is for: not shown as running while it waits. */
  stoppedEntries(): Set<number> {
    return new Set(this.load().filter((i) => i.kind === 'stop').map((i) => Number(i.payload.entry_id)));
  }

  /** Writes an item, on disk before anyone is told it was kept. */
  add(kind: ProjectsOutboxKind, payload: Record<string, unknown>, o: { label: string; taskId: number | null; base?: string | null; status?: ProjectTaskStatus | null }): StoredItem | null {
    const s = this.scope();
    if (!s) return null;
    const last = this.d.db.get<{ n: number | null }>('SELECT MAX(seq) AS n FROM projects_outbox WHERE origin = ? AND user_id = ?', s.origin, s.user);
    const item: StoredItem = {
      id: randomUUID(),
      seq: Number(last?.n ?? 0) + 1,
      kind,
      taskId: o.taskId,
      label: o.label,
      state: 'waiting',
      message: null,
      createdAt: new Date(this.now()).toISOString(),
      payload,
      base: o.base ?? null,
      key: `wsd-prj-${randomUUID()}`,
      step: null,
      status: o.status ?? null,
      theirs: null,
      attempts: 0,
    };
    this.save(item);
    log.info('kept for later', { kind });
    this.emit();
    return item;
  }

  /** The renderer's move, comment or time: sent now when it can go now, kept in line when it cannot. */
  async submit(input: ProjectsSubmit): Promise<ProjectsSubmitResult> {
    const { kind, payload, taskId, base, status } = toItem(input);
    // Something already waits: this goes behind it, so nothing overtakes (NFR-09).
    const inLine = this.load().some((i) => i.state === 'waiting' || i.state === 'sending' || (i.state === 'conflict' && i.taskId === taskId && kind === 'move'));
    if (!inLine) {
      try {
        const data = await this.request(kind, payload, `wsd-prj-${randomUUID()}`);
        return { delivered: true, queued: false, id: null, data, error: null };
      } catch (e) {
        const { outcome, message } = outcomeOf(e);
        if (outcome !== 'offline' && outcome !== 'later') return { delivered: false, queued: false, id: null, data: null, error: message };
      }
    }
    const item = this.add(kind, payload, { label: input.label, taskId, base, status });
    if (!item) return { delivered: false, queued: false, id: null, data: null, error: 'Sign in to WorkSuite to keep this change.' };
    await this.replay();
    const still = this.load().find((i) => i.id === item.id);
    if (!still) return { delivered: true, queued: false, id: null, data: null, error: null };
    return { delivered: false, queued: true, id: item.id, data: null, error: still.state === 'refused' ? still.message : null };
  }

  private request(kind: ProjectsOutboxKind, payload: Record<string, unknown>, key: string): Promise<unknown> {
    const headers = { 'Idempotency-Key': key };
    switch (kind) {
      case 'move':
        return this.d.http.request('POST', `${PROJECTS_API}/tasks/${Number(payload.task_id)}/move`, { body: { status: payload.status, ...(payload.blocked_reason ? { blocked_reason: payload.blocked_reason } : {}) }, headers });
      case 'comment':
        return this.d.http.request('POST', `${PROJECTS_API}/tasks/${Number(payload.task_id)}/comments`, { body: { body: payload.body }, headers });
      case 'log':
        return this.d.http.request('POST', `${PROJECTS_API}/time/log`, { body: payload, headers });
      case 'stop':
        throw new Error('A stop is sent in its steps.');
    }
  }

  /**
   * Sends what waits, in order, until the line is empty or the server cannot be reached. One replay at a time; a
   * second call waits for the one under way. `online` is whether the server answered.
   */
  replay(): Promise<{ online: boolean }> {
    if (this.busy) return this.busy;
    this.busy = this.run().finally(() => {
      this.busy = null;
    });
    return this.busy;
  }

  private async run(): Promise<{ online: boolean }> {
    if (!this.scope()) return { online: false };
    // A crash while sending leaves an item `sending`: it goes back in line (its key makes the retry the same change).
    for (const i of this.load()) {
      if (i.state === 'sending') this.save({ ...i, state: 'waiting' });
    }
    let online = true;
    for (let guard = 0; guard < 500; guard++) {
      const next = nextToSend(this.load());
      if (!next) break;
      this.save({ ...next, state: 'sending' });
      this.emit();
      const outcome = await this.send(next);
      if (outcome === 'offline' || outcome === 'later') {
        online = outcome === 'later';
        break;
      }
    }
    this.emit();
    return { online };
  }

  private async send(item: StoredItem): Promise<Outcome> {
    const fail = (e: unknown, current: StoredItem): Outcome => {
      const { outcome, message } = outcomeOf(e);
      if (outcome === 'offline' || outcome === 'later') {
        this.save({ ...current, state: 'waiting', message: outcome === 'later' ? message : null, attempts: current.attempts + 1 });
        return outcome;
      }
      this.save({ ...current, state: outcome === 'conflict' ? 'conflict' : 'refused', message, attempts: current.attempts + 1 });
      log.info('kept change not taken', { kind: current.kind, outcome });
      return outcome;
    };
    try {
      if (item.kind === 'move') {
        // Read the task again: somebody may have moved it since the copy this move was made from (NFR-09).
        const now = await this.d.http.request<TaskAnswer>('GET', `${PROJECTS_API}/tasks/${Number(item.payload.task_id)}`);
        const t = now?.task;
        if (t && typeof t.status === 'string' && isConflict(item.base, { status: t.status, updated_at: t.updated_at ?? null }, String(item.payload.status))) {
          this.save({
            ...item,
            state: 'conflict',
            message: null,
            theirs: { status: t.status, updatedAt: t.updated_at ?? null, updatedBy: t.updated_by ?? null, number: t.task_number ?? null, title: t.title ?? null },
          });
          return 'conflict';
        }
        // Already where I put it (somebody did the same, or an earlier try got through): nothing to send.
        if (t && t.status === item.payload.status) {
          this.remove(item.id);
          return 'done';
        }
        await this.request('move', item.payload, item.key);
      } else if (item.kind === 'stop') {
        let current = item;
        if (current.step !== 'deleted') {
          try {
            await this.d.http.request('DELETE', `${PROJECTS_API}/time/${Number(current.payload.entry_id)}`, { headers: { 'Idempotency-Key': `${current.key}-stop` } });
          } catch (e) {
            // Already gone (an earlier try removed it): go on to log the time, once.
            if (!(isDesktopError(e) && e.code === 'NOT_FOUND')) return fail(e, current);
          }
          current = { ...current, step: 'deleted' };
          this.save(current);
        }
        if (current.payload.log) {
          try {
            await this.d.http.request('POST', `${PROJECTS_API}/time/log`, { body: current.payload.log, headers: { 'Idempotency-Key': current.key } });
          } catch (e) {
            return fail(e, current);
          }
        }
      } else {
        await this.request(item.kind, item.payload, item.key);
      }
      this.remove(item.id);
      return 'done';
    } catch (e) {
      return fail(e, item);
    }
  }

  /** The person's choice on a move in conflict: keep the server's (the move is dropped) or apply mine (sent now). */
  async resolve(id: string, choice: 'mine' | 'theirs'): Promise<ProjectsOutboxItem[]> {
    const item = this.load().find((i) => i.id === id);
    if (!item) return this.list();
    // A refused item, tried again (mine) or let go (theirs), goes the same way.
    if (choice === 'theirs') this.remove(id);
    // Mine: made again from what I have now seen, so it goes unless the task changes once more.
    else this.save({ ...item, state: 'waiting', message: null, base: item.theirs?.updatedAt ?? null, theirs: null });
    this.emit();
    await this.replay();
    return this.list();
  }

  discard(id: string): ProjectsOutboxItem[] {
    this.remove(id);
    this.emit();
    return this.list();
  }

  /** Signing out with WorkSuite's data removed, or a remote wipe: what this person kept goes too. */
  wipeUser(userId: string): void {
    this.d.db.run('DELETE FROM projects_outbox WHERE user_id = ?', userId);
  }
}

/** The renderer's request as an item: its kind, the body the server takes, the task and the base it was made from. */
export function toItem(input: ProjectsSubmit): { kind: ProjectsOutboxKind; payload: Record<string, unknown>; taskId: number | null; base: string | null; status: ProjectTaskStatus | null } {
  switch (input.kind) {
    case 'move':
      return { kind: 'move', payload: { task_id: input.taskId, status: input.status, blocked_reason: input.blockedReason ?? null }, taskId: input.taskId, base: input.baseUpdatedAt ?? null, status: input.status };
    case 'comment':
      return { kind: 'comment', payload: { task_id: input.taskId, body: input.body }, taskId: input.taskId, base: null, status: null };
    case 'log':
      return {
        kind: 'log',
        payload: { duration: input.duration, on_date: input.onDate, project_id: input.projectId ?? null, task_id: input.taskId ?? null, note: input.note ?? null, is_billable: input.billable },
        taskId: input.taskId ?? null,
        base: null,
        status: null,
      };
  }
}

/** "Move TSK-0402 to In review". */
export function moveLabel(number: string | null, title: string, status: ProjectTaskStatus): string {
  return `Move ${number ?? title} to ${TASK_STATUS_LABEL[status]}`;
}

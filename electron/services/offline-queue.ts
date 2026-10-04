import { randomUUID } from 'node:crypto';
import type { MutationInput, OfflineStatus, SubmitResult } from '@shared/ipc/contract';
import type { Draft, MutationState, OfflineMutation } from '@shared/types';
import { backoffDelay } from '@shared/backoff';
import { DesktopError, UNREACHABLE_MESSAGE, isDesktopError } from '../main/errors';
import { logger } from '../main/log';
import { isProxyPathAllowed } from './api-proxy';
import type { Database } from './db';
import type { HttpClient } from './http';
import type { Vault } from './vault';

const log = logger('offline');

/**
 * The offline mutation queue and draft store (FR-OFF-02/03/04/07, WF-17).
 *
 * A write the module allows offline goes to the server if it can; if the
 * server cannot be reached it is written — durably, encrypted, before the
 * user is told "queued" — to an ordered queue, and replayed in order when the
 * connection returns. Every mutation carries an idempotency key and its base
 * version. A version conflict is shown to the user, never overwritten; a
 * later change to the same record waits behind an earlier one that failed.
 */

export type QueuePermission = 'allowed' | 'drafts_only' | 'disabled';

interface MutationRow {
  id: string;
  idempotency_key: string;
  module: string;
  entity: string;
  entity_id: string | null;
  label: string;
  method: string;
  path: string;
  payload: string;
  base_etag: string | null;
  state: MutationState;
  attempts: number;
  error: string | null;
  seq: number;
  created_at: string;
  next_attempt_at: string | null;
}

function toMutation(r: MutationRow): OfflineMutation {
  return {
    id: r.id,
    idempotencyKey: r.idempotency_key,
    module: r.module,
    entity: r.entity,
    entityId: r.entity_id,
    label: r.label,
    method: r.method as OfflineMutation['method'],
    path: r.path,
    state: r.state,
    attempts: r.attempts,
    error: r.error,
    createdAt: r.created_at,
  };
}

async function readJson(res: Response): Promise<{ data: unknown; message: string | null }> {
  try {
    const j = (await res.json()) as { data?: unknown; message?: string };
    return { data: j.data ?? j, message: typeof j.message === 'string' ? j.message : null };
  } catch {
    return { data: null, message: null };
  }
}

export class OfflineQueue {
  private replaying = false;
  onChanged: () => void = () => undefined;

  constructor(
    private readonly db: Database,
    private readonly vault: () => Vault,
    private readonly http: HttpClient,
    private readonly permission: () => QueuePermission,
  ) {}

  private async send(m: { method: string; path: string; body: unknown; idempotencyKey: string; baseEtag: string | null }): Promise<Response> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', 'Idempotency-Key': m.idempotencyKey };
    if (m.baseEtag) headers['If-Match'] = m.baseEtag;
    return this.http.raw(m.method, this.http.url(m.path), {
      headers,
      body: m.body === undefined ? undefined : JSON.stringify(m.body),
      timeoutMs: 30_000,
    });
  }

  async submit(userId: string, input: MutationInput): Promise<SubmitResult> {
    // The same addresses the API proxy allows, and no others: this path goes
    // to the server with the user's token, so it must not reach what the
    // proxy keeps from a page (a salon desk's pairing, which answers with the
    // desk's key; token and device endpoints) — nor get there by `..`.
    if (!isProxyPathAllowed(input.path, input.method)) {
      throw new DesktopError('POLICY_DENIED', 'That address cannot be written to from here.');
    }
    const idempotencyKey = randomUUID();
    try {
      const res = await this.send({ method: input.method, path: input.path, body: input.body, idempotencyKey, baseEtag: input.baseEtag ?? null });
      const { data, message } = await readJson(res);
      if (res.ok) return { delivered: true, queued: false, id: null, status: res.status, data, error: null, code: null };
      return {
        delivered: false,
        queued: false,
        id: null,
        status: res.status,
        data,
        error: message ?? `The server answered ${res.status}.`,
        code: res.status === 409 ? 'CONFLICT' : res.status === 403 ? 'PERMISSION_DENIED' : 'SERVER_ERROR',
      };
    } catch (e) {
      const offline = isDesktopError(e) && e.code === 'NETWORK_UNREACHABLE';
      if (!offline) {
        return { delivered: false, queued: false, id: null, status: null, data: null, error: isDesktopError(e) ? e.message : String(e), code: isDesktopError(e) ? e.code : 'INTERNAL' };
      }
      if (!input.queueIfOffline) {
        return { delivered: false, queued: false, id: null, status: null, data: null, error: UNREACHABLE_MESSAGE, code: 'NETWORK_UNREACHABLE' };
      }
      const perm = this.permission();
      if (perm !== 'allowed') {
        return {
          delivered: false,
          queued: false,
          id: null,
          status: null,
          data: null,
          error:
            perm === 'drafts_only'
              ? 'You are offline. On this device your organization allows drafts only; your change was not queued.'
              : 'You are offline, and offline changes are turned off for this device.',
          code: 'POLICY_DENIED',
        };
      }
      const id = this.enqueue(userId, input, idempotencyKey);
      return { delivered: false, queued: true, id, status: null, data: null, error: null, code: null };
    }
  }

  enqueue(userId: string, input: MutationInput, idempotencyKey = randomUUID()): string {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db.tx(() => {
      const seqRow = this.db.get<{ n: number | null }>('SELECT MAX(seq) AS n FROM offline_mutations');
      const seq = Number(seqRow?.n ?? 0) + 1;
      this.db.run(
        `INSERT INTO offline_mutations (id, user_id, idempotency_key, module, entity, entity_id, label, method, path, payload, base_etag, state, attempts, error, seq, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', 0, NULL, ?, ?, ?)`,
        id,
        userId,
        idempotencyKey,
        input.module,
        input.entity,
        input.entityId,
        input.label,
        input.method,
        input.path,
        this.vault().encrypt({ body: input.body ?? null }),
        input.baseEtag ?? null,
        seq,
        now,
        now,
      );
    });
    log.info('mutation queued', { module: input.module, entity: input.entity });
    this.onChanged();
    return id;
  }

  private setState(id: string, state: MutationState, error: string | null, extra: { response?: unknown; nextAttemptAt?: string | null; attempts?: number } = {}): void {
    this.db.run(
      'UPDATE offline_mutations SET state = ?, error = ?, response = COALESCE(?, response), next_attempt_at = ?, attempts = COALESCE(?, attempts), updated_at = ? WHERE id = ?',
      state,
      error,
      extra.response === undefined ? null : this.vault().encrypt(extra.response),
      extra.nextAttemptAt ?? null,
      extra.attempts ?? null,
      new Date().toISOString(),
      id,
    );
  }

  /** Replays the queue in order (WF-17 steps 7–12). */
  async replay(userId: string): Promise<{ done: number; conflicts: number; failed: number; remaining: number }> {
    if (this.replaying) return { done: 0, conflicts: 0, failed: 0, remaining: this.pendingCount(userId) };
    this.replaying = true;
    let done = 0;
    let conflicts = 0;
    let failed = 0;
    try {
      // A crash mid-replay leaves rows SYNCING: they go back in line.
      this.db.run("UPDATE offline_mutations SET state = 'PENDING' WHERE user_id = ? AND state = 'SYNCING'", userId);
      const rows = this.db.all<MutationRow>("SELECT * FROM offline_mutations WHERE user_id = ? AND state = 'PENDING' ORDER BY seq ASC", userId);
      const blocked = new Set<string>(
        this.db
          .all<{ k: string }>("SELECT entity || ':' || COALESCE(entity_id, '') AS k FROM offline_mutations WHERE user_id = ? AND state IN ('CONFLICT', 'FAILED')", userId)
          .map((r) => r.k),
      );
      for (const r of rows) {
        const entityKey = `${r.entity}:${r.entity_id ?? ''}`;
        if (blocked.has(entityKey)) continue; // waits for its parent to be resolved
        if (r.next_attempt_at && new Date(r.next_attempt_at).getTime() > Date.now()) continue;
        this.setState(r.id, 'SYNCING', null);
        this.onChanged();
        const payload = this.vault().decrypt<{ body: unknown }>(r.payload);
        try {
          const res = await this.send({ method: r.method, path: r.path, body: payload?.body ?? undefined, idempotencyKey: r.idempotency_key, baseEtag: r.base_etag });
          const { data, message } = await readJson(res);
          if (res.ok) {
            this.setState(r.id, 'DONE', null, { response: data });
            done++;
          } else if (res.status === 409) {
            this.setState(r.id, 'CONFLICT', message ?? 'This was changed on the server while you were offline.', { response: data });
            blocked.add(entityKey);
            conflicts++;
          } else if (res.status === 429 || res.status >= 500) {
            const attempts = r.attempts + 1;
            const next = new Date(Date.now() + backoffDelay(attempts, { baseMs: 5_000, maxMs: 30 * 60_000 })).toISOString();
            this.setState(r.id, 'PENDING', message ?? `Server busy (${res.status}).`, { attempts, nextAttemptAt: next });
            break; // keep order: nothing overtakes a delayed mutation
          } else {
            this.setState(r.id, 'FAILED', message ?? `The server refused this change (${res.status}).`, { response: data, attempts: r.attempts + 1 });
            blocked.add(entityKey);
            failed++;
          }
        } catch (e) {
          this.setState(r.id, 'PENDING', isDesktopError(e) ? e.message : String(e), { attempts: r.attempts + 1 });
          break; // offline again; stop and wait for the next reconnect
        }
      }
      // Delivered changes are kept for a day so the user can see what went through.
      this.db.run("DELETE FROM offline_mutations WHERE state = 'DONE' AND updated_at < ?", new Date(Date.now() - 86_400_000).toISOString());
    } finally {
      this.replaying = false;
      this.onChanged();
    }
    if (done + conflicts + failed > 0) log.info('replay finished', { done, conflicts, failed });
    return { done, conflicts, failed, remaining: this.pendingCount(userId) };
  }

  list(userId: string): OfflineMutation[] {
    return this.db
      .all<MutationRow>("SELECT * FROM offline_mutations WHERE user_id = ? AND state != 'DONE' ORDER BY seq ASC", userId)
      .map(toMutation);
  }

  pendingCount(userId: string): number {
    const r = this.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM offline_mutations WHERE user_id = ? AND state IN ('PENDING', 'SYNCING')", userId);
    return Number(r?.n ?? 0);
  }

  status(userId: string, cache: { bytes: number; entries: number }): OfflineStatus {
    const counts = this.db.all<{ state: string; n: number }>('SELECT state, COUNT(*) AS n FROM offline_mutations WHERE user_id = ? GROUP BY state', userId);
    const by = (s: string) => Number(counts.find((c) => c.state === s)?.n ?? 0);
    const perm = this.permission();
    return {
      pending: by('PENDING') + by('SYNCING'),
      conflicts: by('CONFLICT'),
      failed: by('FAILED'),
      queueAllowed: perm === 'allowed',
      reason: perm === 'drafts_only' ? 'On this device your organization allows drafts only.' : perm === 'disabled' ? 'Offline changes are turned off for this device.' : null,
      cacheBytes: cache.bytes,
      cacheEntries: cache.entries,
    };
  }

  retry(userId: string, id: string): void {
    const n = this.db.run("UPDATE offline_mutations SET state = 'PENDING', error = NULL, next_attempt_at = NULL WHERE id = ? AND user_id = ? AND state IN ('FAILED', 'CONFLICT')", id, userId).changes;
    if (n === 0) throw new DesktopError('NOT_FOUND', 'That change is not waiting for a retry.');
    this.onChanged();
  }

  discard(userId: string, id: string): void {
    this.db.run('DELETE FROM offline_mutations WHERE id = ? AND user_id = ?', id, userId);
    this.onChanged();
  }

  // Drafts (FR-OFF-07): autosaved by editors, encrypted, per user.
  saveDraft(userId: string, module: string, context: string, content: unknown): Draft {
    const now = new Date().toISOString();
    const id = randomUUID();
    this.db.run(
      `INSERT INTO drafts (id, user_id, module, context, content, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, module, context) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at`,
      id,
      userId,
      module,
      context,
      this.vault().encrypt(content),
      now,
    );
    const row = this.db.get<{ id: string }>('SELECT id FROM drafts WHERE user_id = ? AND module = ? AND context = ?', userId, module, context);
    return { id: row?.id ?? id, module, context, content, updatedAt: now };
  }

  getDraft(userId: string, module: string, context: string): Draft | null {
    const r = this.db.get<{ id: string; content: string; updated_at: string }>('SELECT id, content, updated_at FROM drafts WHERE user_id = ? AND module = ? AND context = ?', userId, module, context);
    if (!r) return null;
    return { id: r.id, module, context, content: this.vault().decrypt(r.content) ?? null, updatedAt: r.updated_at };
  }

  listDrafts(userId: string, module?: string): Draft[] {
    const rows = module
      ? this.db.all<{ id: string; module: string; context: string; content: string; updated_at: string }>('SELECT * FROM drafts WHERE user_id = ? AND module = ? ORDER BY updated_at DESC', userId, module)
      : this.db.all<{ id: string; module: string; context: string; content: string; updated_at: string }>('SELECT * FROM drafts WHERE user_id = ? ORDER BY updated_at DESC', userId);
    return rows.map((r) => ({ id: r.id, module: r.module, context: r.context, content: this.vault().decrypt(r.content) ?? null, updatedAt: r.updated_at }));
  }

  deleteDraft(userId: string, module: string, context: string): void {
    this.db.run('DELETE FROM drafts WHERE user_id = ? AND module = ? AND context = ?', userId, module, context);
  }

  draftCount(userId: string): number {
    return Number(this.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM drafts WHERE user_id = ?', userId)?.n ?? 0);
  }

  /** Saved drafts by module ("1 unsent mail draft" in the Update Ready dialog). */
  draftModules(userId: string): Record<string, number> {
    const out: Record<string, number> = {};
    for (const r of this.db.all<{ module: string; n: number }>('SELECT module, COUNT(*) AS n FROM drafts WHERE user_id = ? GROUP BY module', userId)) out[r.module] = Number(r.n);
    return out;
  }

  wipeUser(userId: string, includeDrafts: boolean): void {
    this.db.run('DELETE FROM offline_mutations WHERE user_id = ?', userId);
    if (includeDrafts) this.db.run('DELETE FROM drafts WHERE user_id = ?', userId);
  }
}

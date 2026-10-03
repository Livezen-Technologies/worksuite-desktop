import { createHash } from 'node:crypto';
import type { Database } from './db';
import type { Vault } from './vault';
import type { MailStoreStats } from '@shared/types';

/**
 * READ_CACHE (FR-OFF-01): the last good answer to a module's GET request,
 * encrypted, per user. Served — and labelled as offline — only when the
 * server cannot be reached. REST stays authoritative: a cached answer is
 * never preferred over a live one (FR-RT-03).
 */
export interface CachedResponse {
  status: number;
  contentType: string;
  body: string;
  cachedAt: string;
}

export interface CacheLimits {
  enabled: boolean;
  maxBytes: number;
}

/** Which part of Mail a saved answer is, by its path. */
export function mailPathKind(path: string): 'messages' | 'lists' | 'search' | 'other' {
  if (/^\/api\/mail\/messages\/\d+/.test(path)) return 'messages';
  if (/^\/api\/mail\/(messages|folders|folders-tree|labels|views|mailboxes|sidebar)(\/|\?|$)/.test(path)) return 'lists';
  if (/^\/api\/mail\/search(\?|$)/.test(path)) return 'search';
  return 'other';
}

/** The mailbox a saved answer belongs to (its `mailbox=` parameter), or null for the combined view. */
export function mailboxOfPath(path: string): string | null {
  const q = path.indexOf('?');
  if (q < 0) return null;
  const m = new URLSearchParams(path.slice(q + 1)).get('mailbox');
  return m && /^\d{1,12}$/.test(m) ? m : null;
}

/**
 * The key a saved answer is kept under. A message body is the same answer
 * however it was asked for — opened with `peek=1` or without, its parameters
 * in any order — so it is kept once, under its folder and mailbox: the body
 * downloaded in the background (#190) is the one a later offline open finds.
 */
export function cacheKeyPath(path: string): string {
  const q = path.indexOf('?');
  const base = q >= 0 ? path.slice(0, q) : path;
  if (!/^\/api\/mail\/messages\/\d+$/.test(base) || q < 0) return path;
  const params = new URLSearchParams(path.slice(q + 1));
  params.delete('peek');
  const kept = [...params.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return kept.length ? `${base}?${new URLSearchParams(kept).toString()}` : base;
}

export class OfflineCache {
  constructor(
    private readonly db: Database,
    private readonly vault: () => Vault,
  ) {}

  static key(userId: string, path: string): string {
    return createHash('sha256').update(`${userId}\n${path}`).digest('hex');
  }

  put(userId: string, module: string, rawPath: string, res: Omit<CachedResponse, 'cachedAt'>, limits: CacheLimits): void {
    if (!limits.enabled) return;
    const path = cacheKeyPath(rawPath);
    const now = new Date().toISOString();
    const payload = this.vault().encrypt({ ...res, cachedAt: now });
    const bytes = Buffer.byteLength(payload);
    if (bytes > limits.maxBytes / 4) return; // one answer never evicts most of the cache
    this.db.run(
      `INSERT INTO cached_records (key, user_id, module, path, payload, etag, bytes, cached_at, accessed_at)
       VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET payload = excluded.payload, bytes = excluded.bytes,
         cached_at = excluded.cached_at, accessed_at = excluded.accessed_at`,
      OfflineCache.key(userId, path),
      userId,
      module,
      path,
      payload,
      bytes,
      now,
      now,
    );
    this.evict(limits.maxBytes);
  }

  get(userId: string, path: string): CachedResponse | null {
    const key = OfflineCache.key(userId, cacheKeyPath(path));
    const row = this.db.get<{ payload: string }>('SELECT payload FROM cached_records WHERE key = ? AND user_id = ?', key, userId);
    if (!row) return null;
    const value = this.vault().decrypt<CachedResponse>(row.payload);
    if (!value) {
      this.db.run('DELETE FROM cached_records WHERE key = ?', key);
      return null;
    }
    this.db.run('UPDATE cached_records SET accessed_at = ? WHERE key = ?', new Date().toISOString(), key);
    return value;
  }

  /** Remove saved reads under an API prefix after access is refused. */
  clearPrefix(userId: string, prefix: string): number {
    const rows = this.db.all<{ key: string; path: string }>('SELECT key, path FROM cached_records WHERE user_id = ?', userId);
    let removed = 0;
    for (const row of rows) if (row.path === prefix || row.path.startsWith(`${prefix}/`) || row.path.startsWith(`${prefix}?`)) removed += this.db.run('DELETE FROM cached_records WHERE key = ? AND user_id = ?', row.key, userId).changes;
    return removed;
  }

  /** Is an answer kept for this path (without opening it)? */
  has(userId: string, path: string): boolean {
    return !!this.db.get<{ n: number }>('SELECT 1 AS n FROM cached_records WHERE key = ? AND user_id = ?', OfflineCache.key(userId, cacheKeyPath(path)), userId);
  }

  /** Least-recently-used eviction down to the policy limit (offline_storage max MB). */
  evict(maxBytes: number): number {
    const total = this.totalBytes();
    if (total <= maxBytes) return 0;
    let over = total - maxBytes;
    let removed = 0;
    const rows = this.db.all<{ key: string; bytes: number }>('SELECT key, bytes FROM cached_records ORDER BY accessed_at ASC LIMIT 500');
    for (const r of rows) {
      if (over <= 0) break;
      this.db.run('DELETE FROM cached_records WHERE key = ?', r.key);
      over -= r.bytes;
      removed++;
    }
    return removed;
  }

  /**
   * Mail cache window (FR-OFF-06): message bodies older than N days are dropped —
   * except those `keep` names (a folder kept whole on this computer, worksuite-desktop#162).
   */
  pruneModuleOlderThan(module: string, days: number, keep?: (path: string) => boolean): number {
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
    if (!keep) return this.db.run('DELETE FROM cached_records WHERE module = ? AND cached_at < ?', module, cutoff).changes;
    let removed = 0;
    for (const r of this.db.all<{ key: string; path: string }>('SELECT key, path FROM cached_records WHERE module = ? AND cached_at < ?', module, cutoff)) {
      if (!keep(r.path)) removed += this.db.run('DELETE FROM cached_records WHERE key = ?', r.key).changes;
    }
    return removed;
  }

  /** How much one app's saved answers take for one person (Mail's "Local store"). */
  moduleBytes(userId: string, module: string): number {
    const r = this.db.get<{ n: number | null }>('SELECT SUM(bytes) AS n FROM cached_records WHERE user_id = ? AND module = ?', userId, module);
    return Number(r?.n ?? 0);
  }

  /**
   * What Mail keeps on this computer, by kind and by mailbox (Settings ›
   * Mail, D04 and D09): opened messages, lists and folders, search answers,
   * and the rest — measured from the saved answers themselves.
   */
  mailStats(userId: string): MailStoreStats {
    const rows = this.db.all<{ path: string; bytes: number }>('SELECT path, bytes FROM cached_records WHERE user_id = ? AND module = ?', userId, 'mail');
    const out: MailStoreStats = { total: 0, messages: 0, lists: 0, search: 0, other: 0, byMailbox: {} };
    for (const r of rows) {
      const kind = mailPathKind(r.path);
      const n = Number(r.bytes) || 0;
      out.total += n;
      out[kind] += n;
      const box = mailboxOfPath(r.path);
      if (box) {
        const b = (out.byMailbox[box] ??= { messages: 0, bytes: 0 });
        b.bytes += n;
        if (kind === 'messages' && /^\/api\/mail\/messages\/\d+(\?|$)/.test(r.path)) b.messages++;
      }
    }
    return out;
  }

  /** One mailbox's saved mail older than N days (its own keep period, D09); 0 days keeps none of its messages. */
  pruneMailbox(userId: string, mailbox: string, days: number, keep?: (path: string) => boolean): number {
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
    const rows = this.db.all<{ key: string; path: string; cached_at: string }>('SELECT key, path, cached_at FROM cached_records WHERE user_id = ? AND module = ?', userId, 'mail');
    let removed = 0;
    for (const r of rows) {
      if (mailboxOfPath(r.path) !== mailbox || keep?.(r.path)) continue;
      const old = days > 0 ? r.cached_at < cutoff : mailPathKind(r.path) === 'messages';
      if (old) removed += this.db.run('DELETE FROM cached_records WHERE key = ?', r.key).changes;
    }
    return removed;
  }

  /**
   * Everything saved of one mailbox for one person: a mailbox removed from
   * the account takes its mail off this computer with it (worksuite-desktop#162).
   */
  clearMailbox(userId: string, mailbox: string): number {
    let removed = 0;
    for (const r of this.db.all<{ key: string; path: string }>('SELECT key, path FROM cached_records WHERE user_id = ? AND module = ?', userId, 'mail')) {
      if (mailboxOfPath(r.path) === mailbox) removed += this.db.run('DELETE FROM cached_records WHERE key = ?', r.key).changes;
    }
    return removed;
  }

  totalBytes(): number {
    const r = this.db.get<{ n: number | null }>('SELECT SUM(bytes) AS n FROM cached_records');
    return Number(r?.n ?? 0);
  }

  count(): number {
    const r = this.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM cached_records');
    return Number(r?.n ?? 0);
  }

  /** One app's answers for one person: dropped when the app is no longer theirs. */
  clearModule(userId: string, module: string): number {
    return this.db.run('DELETE FROM cached_records WHERE user_id = ? AND module = ?', userId, module).changes;
  }

  /** The modules a person has answers saved for. */
  modules(userId: string): string[] {
    return this.db.all<{ module: string }>('SELECT DISTINCT module FROM cached_records WHERE user_id = ?', userId).map((r) => r.module);
  }

  clearUser(userId: string): number {
    return this.db.run('DELETE FROM cached_records WHERE user_id = ?', userId).changes;
  }

  clearAll(): number {
    return this.db.run('DELETE FROM cached_records').changes;
  }

  /**
   * Mail search on this computer, offline (worksuite-desktop#162): every word in
   * the sender, subject, preview or — for an opened message — its text, over
   * the lists and messages saved here (the most recently used first, at most
   * `scan` of them). Rows come back as the list shows them, one per message.
   */
  mailSearch(userId: string, q: string, limit = 200, scan = 5000): Array<Record<string, unknown>> {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    const out = new Map<string, Record<string, unknown>>();
    const hit = (hay: string) => {
      const h = hay.toLowerCase();
      return words.every((w) => h.includes(w));
    };
    const rows = this.db.all<{ path: string; payload: string }>('SELECT path, payload FROM cached_records WHERE user_id = ? AND module = ? ORDER BY accessed_at DESC LIMIT ?', userId, 'mail', scan);
    for (const r of rows) {
      if (out.size >= limit) break;
      const kind = mailPathKind(r.path);
      if (kind !== 'lists' && kind !== 'messages') continue;
      const value = this.vault().decrypt<CachedResponse>(r.payload);
      if (!value) continue;
      let data: Record<string, unknown> | null = null;
      try {
        data = ((JSON.parse(value.body) as { data?: unknown }).data ?? null) as Record<string, unknown> | null;
      } catch {
        continue;
      }
      if (!data || typeof data !== 'object') continue;
      const box = mailboxOfPath(r.path);
      const q = r.path.indexOf('?');
      const folder = (q >= 0 ? new URLSearchParams(r.path.slice(q + 1)).get('folder') : null) ?? 'inbox';
      const add = (m: Record<string, unknown>, text: string) => {
        const key = `${String((m.mailbox as { id?: unknown } | undefined)?.id ?? box ?? '')}:${String(m.folder_slug ?? folder)}:${String(m.id)}`;
        if (out.has(key) || !hit(text)) return;
        out.set(key, { ...m, folder_slug: m.folder_slug ?? folder, ...(m.mailbox || !box ? {} : { mailbox: { id: Number(box) } }) });
      };
      if (kind === 'lists' && Array.isArray(data.messages)) {
        for (const m of data.messages as Array<Record<string, unknown>>) {
          if (out.size >= limit) break;
          if (m && typeof m === 'object' && m.id !== undefined) add(m, `${String(m.from_name ?? '')} ${String(m.from_email ?? '')} ${String(m.subject ?? '')} ${String(m.preview ?? '')}`);
        }
      } else if (kind === 'messages' && /^\/api\/mail\/messages\/\d+(\?|$)/.test(r.path) && data.id !== undefined) {
        const body = String(data.body_html ?? '').replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
        add(
          { id: data.id, from_name: data.from_name ?? '', from_email: data.from_email ?? '', subject: data.subject ?? '', preview: body.slice(0, 160), is_read: data.is_read !== false, is_starred: !!data.is_starred, has_attachment: Array.isArray(data.attachments) && data.attachments.length > 0, created_at: data.created_at ?? '', ...(data.mailbox ? { mailbox: data.mailbox } : {}) },
          `${String(data.from_name ?? '')} ${String(data.from_email ?? '')} ${String(data.subject ?? '')} ${body}`,
        );
      }
    }
    return [...out.values()];
  }

  /** Offline search over cached lists (FR-SRCH-02): titles only, labelled offline. */
  entries(userId: string, module?: string): Array<{ module: string; path: string; value: CachedResponse }> {
    const rows = module
      ? this.db.all<{ module: string; path: string; payload: string }>('SELECT module, path, payload FROM cached_records WHERE user_id = ? AND module = ? ORDER BY accessed_at DESC LIMIT 200', userId, module)
      : this.db.all<{ module: string; path: string; payload: string }>('SELECT module, path, payload FROM cached_records WHERE user_id = ? ORDER BY accessed_at DESC LIMIT 200', userId);
    const out: Array<{ module: string; path: string; value: CachedResponse }> = [];
    for (const r of rows) {
      const value = this.vault().decrypt<CachedResponse>(r.payload);
      if (value) out.push({ module: r.module, path: r.path, value });
    }
    return out;
  }
}

import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, statfs, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Database } from './db';

/**
 * POS: the products' small pictures, kept so the counter's grid shows them offline (worksuite-desktop#296).
 *
 * Fetched after a catalogue sync through the till's door (`products/{id}/image?size=thumb`, at most 256 px), one
 * directory per server and till under the profile, each recorded in `pos_thumbs` with its size and when it was last
 * shown. They are a nicety, never the point:
 *
 *  - only where the desktop policy lets this computer keep data offline (otherwise the grid loads them live);
 *  - within a quota (`PosTillSettings.thumbs_mb`, 200 MB by default), the least recently shown dropped first;
 *  - when the disk runs low they all go, before a single product of the catalogue does — and none are fetched;
 *  - forgotten with the till, and in a wipe.
 *
 * The grid reads one as `/__local/pos-thumb/<id>` (the app's own protocol, `serve`): the current till's only.
 */
export interface ThumbScope {
  origin: string;
  terminal: number;
}

export interface PosThumbsDeps {
  db: Database;
  /** Where the pictures live (the profile's `pos-thumbs`); null: none are kept. */
  dir: () => string | null;
  /** A product's small picture through the till's door. */
  fetch: (productId: number) => Promise<{ status: number; type: string | null; bytes: Buffer | null }>;
  /** Free bytes on the disk holding `dir`, or null when it cannot be told. */
  free?: (dir: string) => Promise<number | null>;
  now?: () => number;
}

/** Below this much free disk the pictures are dropped and none fetched. */
export const LOW_DISK = 512 * 1024 * 1024;
/** Fetched at once, at most. */
const PARALLEL = 4;
/** A picture is not marked as shown more often than this (each mark is a write). */
const TOUCH_MS = 60 * 60_000;

const MIME: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };

/** What free space `statfs` says, or null. */
export async function freeBytes(dir: string): Promise<number | null> {
  try {
    const s = await statfs(dir);
    return Number(s.bavail) * Number(s.bsize);
  } catch {
    return null;
  }
}

export class PosThumbs {
  /** The ids kept, per scope, until something changes. */
  private known = new Map<string, Set<number>>();
  private filling: Promise<number> | null = null;

  constructor(private readonly d: PosThumbsDeps) {}

  private stamp(): string {
    return new Date(this.d.now?.() ?? Date.now()).toISOString();
  }

  private folder(s: ThumbScope): string | null {
    const root = this.d.dir();
    return root ? join(root, createHash('sha256').update(`${s.origin}|${s.terminal}`).digest('hex').slice(0, 24)) : null;
  }

  /** The products with a picture kept. */
  ids(s: ThumbScope): Set<number> {
    const k = `${s.origin}|${s.terminal}`;
    let ids = this.known.get(k);
    if (!ids) {
      ids = new Set(this.d.db.all<{ product_id: number }>('SELECT product_id FROM pos_thumbs WHERE origin = ? AND terminal_id = ?', s.origin, s.terminal).map((r) => r.product_id));
      this.known.set(k, ids);
    }
    return ids;
  }

  usage(s: ThumbScope): { count: number; bytes: number } {
    const r = this.d.db.get<{ n: number; b: number | null }>('SELECT COUNT(*) AS n, SUM(bytes) AS b FROM pos_thumbs WHERE origin = ? AND terminal_id = ?', s.origin, s.terminal);
    return { count: r?.n ?? 0, bytes: r?.b ?? 0 };
  }

  private total(): number {
    return this.d.db.get<{ b: number | null }>('SELECT SUM(bytes) AS b FROM pos_thumbs')?.b ?? 0;
  }

  /**
   * Fetch the pictures the copy lacks — and again those whose product changed since — within the quota (`quotaMb`;
   * 0 keeps none). Single-flight. Answers how many were fetched. Stops at the first answer that is not a picture
   * the door could give (out of reach, POS off), to try again after the next sync.
   */
  fill(s: ThumbScope, rows: Array<{ id: number; updated_at: string; image: boolean }>, quotaMb: number): Promise<number> {
    if (this.filling) return this.filling;
    this.filling = this.fillNow(s, rows, quotaMb).finally(() => {
      this.filling = null;
    });
    return this.filling;
  }

  private async fillNow(s: ThumbScope, rows: Array<{ id: number; updated_at: string; image: boolean }>, quotaMb: number): Promise<number> {
    const folder = this.folder(s);
    if (!folder) return 0;
    const quota = Math.max(0, quotaMb) * 1024 * 1024;
    if (quota === 0) {
      await this.evict(0);
      return 0;
    }
    await mkdir(folder, { recursive: true, mode: 0o700 });
    // The disk is running low: the pictures go first, and none are fetched.
    const free = await (this.d.free ?? freeBytes)(folder);
    if (free !== null && free < LOW_DISK) {
      await this.evict(0);
      return 0;
    }
    const have = new Map(this.d.db.all<{ product_id: number; fetched_at: string }>('SELECT product_id, fetched_at FROM pos_thumbs WHERE origin = ? AND terminal_id = ?', s.origin, s.terminal).map((r) => [r.product_id, r.fetched_at] as const));
    const withImage = new Set(rows.filter((r) => r.image).map((r) => r.id));
    // A product that no longer has a picture, or is no longer sold: its picture goes.
    const gone = [...have.keys()].filter((id) => !withImage.has(id));
    for (const id of gone) await this.drop(s, id);
    const want = rows.filter((r) => r.image && (!have.has(r.id) || have.get(r.id)! < r.updated_at)).map((r) => r.id);
    let fetched = 0;
    let stop = false;
    let used = this.total();
    const one = async (id: number) => {
      if (stop || used >= quota) return;
      let got;
      try {
        got = await this.d.fetch(id);
      } catch {
        stop = true;
        return;
      }
      if (got.status === 404) return;
      if (!got.bytes || !got.type || !MIME[got.type]) {
        if (got.status >= 500 || got.status === 401 || got.status === 503 || got.status === 429) stop = true;
        return;
      }
      // The room is full: no more are fetched (dropping others to make room would only fetch them again next time).
      if (used + got.bytes.length > quota) {
        stop = true;
        return;
      }
      // Its room taken now, before the write: the others fetched beside it see it.
      used += got.bytes.length;
      const file = `${id}.${MIME[got.type]}`;
      await writeFile(join(folder, file), got.bytes, { mode: 0o600 });
      const at = this.stamp();
      this.d.db.run(
        'INSERT INTO pos_thumbs (origin, terminal_id, product_id, file, mime, bytes, fetched_at, used_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(origin, terminal_id, product_id) DO UPDATE SET file = excluded.file, mime = excluded.mime, bytes = excluded.bytes, fetched_at = excluded.fetched_at',
        s.origin,
        s.terminal,
        id,
        file,
        got.type,
        got.bytes.length,
        at,
        at,
      );
      fetched++;
    };
    for (let i = 0; i < want.length && !stop && used < quota; i += PARALLEL) await Promise.all(want.slice(i, i + PARALLEL).map(one));
    if (fetched || gone.length) this.known.clear();
    return fetched;
  }

  /** Drop the least recently shown pictures, every till's, until they take at most `mb`. */
  async evict(mb: number): Promise<number> {
    const limit = Math.max(0, mb) * 1024 * 1024;
    let total = this.total();
    let n = 0;
    if (total <= limit) return 0;
    for (const r of this.d.db.all<{ origin: string; terminal_id: number; product_id: number; bytes: number }>('SELECT origin, terminal_id, product_id, bytes FROM pos_thumbs ORDER BY used_at, product_id')) {
      if (total <= limit) break;
      await this.drop({ origin: r.origin, terminal: r.terminal_id }, r.product_id);
      total -= r.bytes;
      n++;
    }
    this.known.clear();
    return n;
  }

  private async drop(s: ThumbScope, id: number): Promise<void> {
    const row = this.d.db.get<{ file: string }>('SELECT file FROM pos_thumbs WHERE origin = ? AND terminal_id = ? AND product_id = ?', s.origin, s.terminal, id);
    const folder = this.folder(s);
    if (row && folder) await rm(join(folder, row.file), { force: true }).catch(() => undefined);
    this.d.db.run('DELETE FROM pos_thumbs WHERE origin = ? AND terminal_id = ? AND product_id = ?', s.origin, s.terminal, id);
  }

  /** `/__local/pos-thumb/<id>` for the current till: the picture, or 404 (the grid then loads it live). */
  async serve(s: ThumbScope | null, path: string): Promise<Response> {
    const m = /^\/pos-thumb\/(\d{1,12})$/.exec(path);
    const folder = s ? this.folder(s) : null;
    if (!m || !s || !folder) return new Response('Not found', { status: 404 });
    const id = Number(m[1]);
    const row = this.d.db.get<{ file: string; mime: string; used_at: string }>('SELECT file, mime, used_at FROM pos_thumbs WHERE origin = ? AND terminal_id = ? AND product_id = ?', s.origin, s.terminal, id);
    if (!row || !/^\d{1,12}\.(jpg|png|webp|gif)$/.test(row.file)) return new Response('Not found', { status: 404 });
    try {
      const bytes = await readFile(join(folder, row.file));
      const now = this.d.now?.() ?? Date.now();
      if (now - Date.parse(row.used_at) > TOUCH_MS) this.d.db.run('UPDATE pos_thumbs SET used_at = ? WHERE origin = ? AND terminal_id = ? AND product_id = ?', this.stamp(), s.origin, s.terminal, id);
      return new Response(new Uint8Array(bytes), { status: 200, headers: { 'Content-Type': row.mime, 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff' } });
    } catch {
      this.d.db.run('DELETE FROM pos_thumbs WHERE origin = ? AND terminal_id = ? AND product_id = ?', s.origin, s.terminal, id);
      this.known.clear();
      return new Response('Not found', { status: 404 });
    }
  }

  forget(origin: string, terminal: number): void {
    const folder = this.folder({ origin, terminal });
    this.d.db.run('DELETE FROM pos_thumbs WHERE origin = ? AND terminal_id = ?', origin, terminal);
    if (folder) void rm(folder, { recursive: true, force: true }).catch(() => undefined);
    this.known.clear();
  }

  forgetAll(): void {
    const root = this.d.dir();
    this.d.db.run('DELETE FROM pos_thumbs');
    if (root) void rm(root, { recursive: true, force: true }).catch(() => undefined);
    this.known.clear();
  }
}

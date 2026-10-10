import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import type { LocalImageEvent, LocalImageInfo } from '@shared/types';
import { DesktopError } from '../main/errors';
import { logger } from '../main/log';

const log = logger('image-local');

/**
 * The image editor's side of this computer (Drive ENH-03 DSK-02…06).
 *
 * OFFLINE EDITS. A synced picture edited while the server cannot be reached is saved to its synced copy here, and
 * the editor's recipe (its layers, crop, filter strength…) waits beside it in a SIDECAR in the app's own data — never
 * in the synced folder, where it would be sent up as a file of its own. The sidecar holds the hash of the bytes it
 * belongs to. When sync sends those bytes (a new version of the file, or — when Drive moved on meanwhile — a new
 * conflicted copy), the recipe follows them to that file (`POST /api/drive/image/{id}/recipe`), so the version
 * reopens as layers on the web too. Bytes changed by another app (Open with › System editor) carry no matching
 * sidecar: sync sends them as a version without a recipe, and the stale sidecar is dropped.
 *
 * LIBRARY CACHE (DSK-04). Sticker, frame, font and logo items, and the list of them, are kept after first use so
 * the tools work offline. Bounded, oldest out first.
 *
 * DRAG OUT (DSK-05). The canvas, rendered by the editor, is written to a temporary PNG and handed to the
 * operating system's drag (`webContents.startDrag`). The renderer never names a path on this computer.
 */

export interface LocalFile {
  path: string;
  version: number;
  sha256: string | null;
  canUpload: boolean;
  paused: boolean;
}

export interface Sidecar {
  fileId: number;
  sha256: string;
  baseVersion: number;
  recipe: string;
  summary: string;
  note: string;
  width: number | null;
  height: number | null;
  savedAt: string;
  /** A copy saved beside the file (it goes up as a new file), not a new version of it. */
  copyName: string | null;
  state: 'waiting' | 'conflict' | 'recipe-pending';
  /** Where the bytes landed, once sync sent them; the recipe still to follow when `state` is recipe-pending. */
  landed?: { fileId: number; version: number } | null;
  copyId?: number | null;
}

export interface ImageLocalDeps {
  root: () => string;
  tmp: () => string;
  userId: () => string | null;
  locate: (fileId: number) => LocalFile | null;
  kick: () => void;
  postRecipe: (fileId: number, body: { recipe: string; summary: string; width: number | null; height: number | null }) => Promise<void>;
  write: (path: string, bytes: Uint8Array) => Promise<void>;
  openPath: (path: string) => Promise<string>;
  changed?: (e: LocalImageEvent) => void;
  /** Bytes the cache may hold before the oldest go. */
  cacheBytes?: number;
}

/** A synced file larger than this is not read into the editor here (the server's proxy rules apply online). */
export const MAX_LOCAL_IMAGE_BYTES = 200 * 1024 * 1024;
const SAFE_NAME = /^[^/\\\0:*?"<>|]{1,200}$/;
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

export class ImageLocal {
  private drags = new Map<string, string>();
  private retrying = false;

  constructor(private readonly deps: ImageLocalDeps) {}

  private dir(kind: 'edits' | 'cache'): string {
    const uid = this.deps.userId();
    if (!uid) throw new DesktopError('NOT_SIGNED_IN', 'Sign in to WorkSuite first.');
    return join(this.deps.root(), kind, uid.replace(/[^A-Za-z0-9_-]/g, '_'));
  }

  private sidecarPath(fileId: number): string {
    return join(this.dir('edits'), `${fileId}.json`);
  }

  async sidecar(fileId: number): Promise<Sidecar | null> {
    try {
      return JSON.parse(await readFile(this.sidecarPath(fileId), 'utf8')) as Sidecar;
    } catch {
      return null;
    }
  }

  async sidecars(): Promise<Sidecar[]> {
    let names: string[] = [];
    try {
      names = await readdir(this.dir('edits'));
    } catch {
      return [];
    }
    const out: Sidecar[] = [];
    for (const n of names.filter((x) => /^-?\d+\.json$/.test(x))) {
      const s = await this.sidecar(Number(n.slice(0, -5)));
      if (s) out.push(s);
    }
    return out;
  }

  private async putSidecar(s: Sidecar): Promise<void> {
    await mkdir(this.dir('edits'), { recursive: true });
    await writeFile(this.sidecarPath(s.fileId), JSON.stringify(s));
  }

  private async dropSidecar(fileId: number): Promise<void> {
    await unlink(this.sidecarPath(fileId)).catch(() => undefined);
  }

  async info(fileId: number): Promise<LocalImageInfo> {
    const at = this.deps.locate(fileId);
    const s = await this.sidecar(fileId);
    return {
      synced: !!at,
      version: at?.version ?? null,
      canUpload: !!at?.canUpload,
      paused: !!at?.paused,
      pending: s ? { baseVersion: s.baseVersion, savedAt: s.savedAt, state: s.state, copyName: s.copyName, willBe: s.baseVersion + 1 } : null,
    };
  }

  private need(fileId: number): LocalFile {
    const at = this.deps.locate(fileId);
    if (!at) throw new DesktopError('NOT_FOUND', 'This picture is not kept on this computer.');
    return at;
  }

  /** The synced copy's bytes, for editing without the server. */
  async read(fileId: number): Promise<Uint8Array> {
    const at = this.need(fileId);
    const st = await stat(at.path).catch(() => null);
    if (!st?.isFile()) throw new DesktopError('NOT_FOUND', 'The synced copy of this picture is missing.');
    if (st.size > MAX_LOCAL_IMAGE_BYTES) throw new DesktopError('IPC_VALIDATION_FAILED', 'This picture is too large to open from this computer.');
    return new Uint8Array(await readFile(at.path));
  }

  /**
   * An edit saved while offline: the bytes go to the synced copy (or, for a copy, a new file beside it), the recipe
   * to its sidecar, and sync is asked to send them when it can.
   */
  async save(input: { fileId: number; bytes: Uint8Array; recipe: string; summary: string; note: string; width: number | null; height: number | null; copyName?: string | null }): Promise<{ willBe: number; name: string }> {
    const at = this.need(input.fileId);
    if (!at.canUpload) throw new DesktopError('POLICY_DENIED', 'This folder only follows Drive, so an edit made here would not be sent up.');
    const copy = input.copyName?.trim() || null;
    if (copy !== null && (!SAFE_NAME.test(copy) || copy === '.' || copy === '..')) throw new DesktopError('IPC_VALIDATION_FAILED', 'That is not a usable file name.');
    const target = copy ? join(dirname(at.path), copy) : at.path;
    if (copy) {
      const exists = await stat(target).then(
        () => true,
        () => false,
      );
      if (exists) throw new DesktopError('CONFLICT', `There is already a file called “${copy}” in this folder.`);
    }
    const hash = sha(input.bytes);
    await this.deps.write(target, input.bytes);
    // A copy is keyed by a fresh number of its own (it has no Drive id yet); a version, by the file's.
    const key = copy ? -Math.abs(Number.parseInt(hash.slice(0, 8), 16) || 1) : input.fileId;
    await this.putSidecar({
      fileId: key,
      sha256: hash,
      baseVersion: at.version,
      recipe: input.recipe,
      summary: input.summary,
      note: input.note,
      width: input.width,
      height: input.height,
      savedAt: new Date().toISOString(),
      copyName: copy,
      state: 'waiting',
    });
    this.deps.changed?.({ fileId: input.fileId, state: 'saved' });
    this.deps.kick();
    return { willBe: at.version + 1, name: basename(target) };
  }

  /** Sync sent some bytes: a recipe waiting on exactly those follows them; one waiting on older bytes is spent. */
  async uploaded(e: { fileId: number; version: number; sha256: string }): Promise<void> {
    if (!this.deps.userId()) return;
    for (const s of await this.sidecars()) {
      if (s.sha256 === e.sha256) {
        await this.attach({ ...s, state: 'recipe-pending', landed: { fileId: e.fileId, version: e.version } });
      } else if (s.fileId === e.fileId && s.state === 'waiting') {
        // Something else was sent as this file's next version (the system editor, say): its recipe no longer fits.
        log.info('an offline recipe was superseded', { fileId: e.fileId });
        await this.dropSidecar(s.fileId);
      }
    }
  }

  /** Both copies were kept. When the server already holds this computer's bytes as a copy, the recipe goes there. */
  async conflicted(e: { fileId: number | null; copyId: number | null; sha256: string | null }): Promise<void> {
    if (!this.deps.userId() || !e.sha256) return;
    for (const s of await this.sidecars()) {
      if (s.sha256 !== e.sha256) continue;
      const next: Sidecar = { ...s, state: 'conflict', copyId: e.copyId };
      if (e.copyId) {
        await this.attach({ ...next, landed: { fileId: e.copyId, version: 1 } }, 'conflict');
      } else {
        await this.putSidecar(next);
        this.deps.changed?.({ fileId: e.fileId ?? s.fileId, state: 'conflict', copyId: null });
      }
    }
  }

  private async attach(s: Sidecar, reported: 'uploaded' | 'conflict' = 'uploaded'): Promise<void> {
    const to = s.landed!;
    try {
      await this.deps.postRecipe(to.fileId, { recipe: withBase(s.recipe, s.baseVersion), summary: s.summary, width: s.width, height: s.height });
      await this.dropSidecar(s.fileId);
      this.deps.changed?.({ fileId: s.fileId > 0 ? s.fileId : to.fileId, state: reported, version: to.version, copyId: reported === 'conflict' ? to.fileId : null });
    } catch (err) {
      // The bytes are in Drive; only the recipe is still to go. Kept, and tried again when sync next reports.
      log.info('recipe not sent yet', { error: (err as Error).message });
      await this.putSidecar({ ...s, state: s.state === 'conflict' ? 'conflict' : 'recipe-pending' });
    }
  }

  /** Recipes whose bytes already landed but which could not be sent then. */
  async retry(): Promise<void> {
    if (this.retrying || !this.deps.userId()) return;
    this.retrying = true;
    try {
      for (const s of await this.sidecars()) if (s.landed) await this.attach(s, s.state === 'conflict' ? 'conflict' : 'uploaded');
    } finally {
      this.retrying = false;
    }
  }

  /** Open with › System editor: the synced copy in the operating system's default app. */
  async openSystem(fileId: number): Promise<boolean> {
    const at = this.need(fileId);
    return (await this.deps.openPath(at.path)) === '';
  }

  // ── drag out ─────────────────────────────────────────────────────────

  async prepareDrag(bytes: Uint8Array, name: string): Promise<string> {
    if (bytes.byteLength < 8 || bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47) throw new DesktopError('IPC_VALIDATION_FAILED', 'Only a PNG can be dragged out.');
    const clean = (name.replace(/\.[A-Za-z0-9]{1,5}$/, '').replace(/[/\\\0:*?"<>|]/g, '').trim() || 'Picture').slice(0, 120);
    const token = randomUUID();
    const dir = join(this.deps.tmp(), 'worksuite-image-drag', token);
    await mkdir(dir, { recursive: true });
    const path = join(dir, `${clean}.png`);
    await writeFile(path, bytes);
    // One drag at a time is plenty; older ones go.
    for (const [t, p] of this.drags) {
      if (this.drags.size < 4) break;
      this.drags.delete(t);
      void rm(dirname(p), { recursive: true, force: true }).catch(() => undefined);
    }
    this.drags.set(token, path);
    return token;
  }

  dragFile(token: string): string {
    const p = this.drags.get(token);
    if (!p) throw new DesktopError('NOT_FOUND', 'That picture is no longer ready to drag.');
    return p;
  }

  async dispose(): Promise<void> {
    for (const p of this.drags.values()) await rm(dirname(p), { recursive: true, force: true }).catch(() => undefined);
    this.drags.clear();
  }

  // ── the library cache ────────────────────────────────────────────────

  private cacheFile(key: string): string {
    return join(this.dir('cache'), createHash('sha1').update(key).digest('hex'));
  }

  async cacheGet(key: string): Promise<{ bytes: Uint8Array; type: string; savedAt: string } | null> {
    try {
      const meta = JSON.parse(await readFile(`${this.cacheFile(key)}.json`, 'utf8')) as { type: string; savedAt: string; key: string };
      if (meta.key !== key) return null;
      return { bytes: new Uint8Array(await readFile(`${this.cacheFile(key)}.bin`)), type: meta.type, savedAt: meta.savedAt };
    } catch {
      return null;
    }
  }

  async cachePut(key: string, bytes: Uint8Array, type: string): Promise<void> {
    await mkdir(this.dir('cache'), { recursive: true });
    await writeFile(`${this.cacheFile(key)}.bin`, bytes);
    await writeFile(`${this.cacheFile(key)}.json`, JSON.stringify({ key, type, savedAt: new Date().toISOString() }));
    await this.trimCache();
  }

  private async trimCache(): Promise<void> {
    const limit = this.deps.cacheBytes ?? 256 * 1024 * 1024;
    const dir = this.dir('cache');
    const files = await Promise.all(
      (await readdir(dir)).filter((n) => n.endsWith('.bin')).map(async (n) => {
        const st = await stat(join(dir, n)).catch(() => null);
        return { n, size: st?.size ?? 0, at: st?.mtimeMs ?? 0 };
      }),
    );
    let total = files.reduce((a, f) => a + f.size, 0);
    for (const f of files.sort((a, b) => a.at - b.at)) {
      if (total <= limit) break;
      total -= f.size;
      await unlink(join(dir, f.n)).catch(() => undefined);
      await unlink(join(dir, f.n.replace(/\.bin$/, '.json'))).catch(() => undefined);
    }
  }
}

/** The recipe as sent with its bytes: it names the version it was made from, so it reopens on those pixels. */
export function withBase(recipe: string, baseVersion: number): string {
  try {
    const r = JSON.parse(recipe) as Record<string, unknown>;
    if (r && typeof r === 'object' && !Array.isArray(r)) {
      if (r.schema === 2 && (typeof r.base_version !== 'number' || r.base_version <= 0)) r.base_version = baseVersion;
      delete r.draft;
      return JSON.stringify(r);
    }
  } catch {
    /* sent as it is */
  }
  return recipe;
}

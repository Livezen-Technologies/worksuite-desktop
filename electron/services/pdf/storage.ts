import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Where PDF Studio keeps things on this computer (§3.5, §6.2, PDF-ARCH-015):
 *
 *   <profile>/PDF/work/    working copies — a Drive file or a mail
 *                          attachment being viewed, sealed (AES-256-GCM,
 *                          key in memory only); never inside a synced Drive
 *                          folder (Drive sync refuses the app's own folder)
 *   <profile>/PDF/cache/   page thumbnails (PDF-VIEW-013), one folder per
 *                          document version, each image sealed with a key
 *                          derived from the database key (OS credential store)
 *
 * The work folder is emptied at start-up and each copy removed when its tab
 * closes (PDF-SAVE-024; D2's recovery drafts will live beside it and follow
 * the retention rule instead). The cache is trimmed to its size and age
 * limits. A sign-out that removes WorkSuite's data removes both (PDF-OFF-005).
 */
export interface PdfStorageLimits {
  cacheBytes: number;
  maxAgeDays: number;
}

const NONCE = 12;
const TAG = 16;

export class PdfStorage {
  private readonly base: () => string;

  constructor(
    root: string | (() => string),
    private readonly key: () => Buffer | null,
    private readonly limits: PdfStorageLimits = { cacheBytes: 256 * 1024 * 1024, maxAgeDays: 14 },
  ) {
    this.base = typeof root === 'function' ? root : () => root;
  }

  /** The open account's PDF folder (a getter: it follows account switches, Connection & Startup §1.3). */
  get root(): string {
    return this.base();
  }

  get work(): string {
    return join(this.base(), 'work');
  }

  get cache(): string {
    return join(this.base(), 'cache');
  }

  /** Start-up: folders made, a previous run's working copies removed, the cache trimmed. */
  async prepare(): Promise<void> {
    await mkdir(this.work, { recursive: true, mode: 0o700 });
    await mkdir(this.cache, { recursive: true, mode: 0o700 });
    for (const f of await readdir(this.work).catch(() => [] as string[])) {
      if (f.endsWith('.wsl') || f.endsWith('.part')) await rm(join(this.work, f), { force: true }).catch(() => undefined);
    }
    await this.trim();
  }

  /** A new sealed working copy's place and key (the key never touches the disk). */
  async newWorkCopy(): Promise<{ path: string; key: Buffer }> {
    await mkdir(this.work, { recursive: true, mode: 0o700 });
    return { path: join(this.work, `${randomUUID()}.wsl`), key: randomBytes(32) };
  }

  async removeWorkCopy(path: string): Promise<void> {
    if (!path.startsWith(this.work)) return;
    await rm(path, { force: true }).catch(() => undefined);
  }

  /** A document version's cache name: a hash, so no file name or id is written as a folder name. */
  static docKey(identity: string): string {
    return createHash('sha256').update(`worksuite-pdf:${identity}`).digest('hex').slice(0, 40);
  }

  private thumbPath(doc: string, page: number): string {
    return join(this.cache, doc, `${page}.bin`);
  }

  async readThumb(doc: string, page: number): Promise<Buffer | null> {
    const key = this.key();
    if (!key) return null;
    const path = this.thumbPath(doc, page);
    let raw: Buffer;
    try {
      raw = await readFile(path);
    } catch {
      return null;
    }
    try {
      const d = createDecipheriv('aes-256-gcm', key, raw.subarray(0, NONCE));
      d.setAAD(Buffer.from(`${doc}:${page}`));
      d.setAuthTag(raw.subarray(NONCE, NONCE + TAG));
      return Buffer.concat([d.update(raw.subarray(NONCE + TAG)), d.final()]);
    } catch {
      // Another key (secure storage was reset) or a damaged file: drawn again instead.
      await rm(path, { force: true }).catch(() => undefined);
      return null;
    }
  }

  async writeThumb(doc: string, page: number, image: Uint8Array): Promise<void> {
    const key = this.key();
    if (!key) return;
    const nonce = randomBytes(NONCE);
    const c = createCipheriv('aes-256-gcm', key, nonce);
    c.setAAD(Buffer.from(`${doc}:${page}`));
    const body = Buffer.concat([c.update(image), c.final()]);
    await mkdir(join(this.cache, doc), { recursive: true, mode: 0o700 });
    await writeFile(this.thumbPath(doc, page), Buffer.concat([nonce, c.getAuthTag(), body]), { mode: 0o600 });
    // The folder's time says when the document was last looked at, for trimming.
    const now = new Date();
    await utimes(join(this.cache, doc), now, now).catch(() => undefined);
  }

  /** Removes documents unseen for `maxAgeDays`, then the oldest until the cache fits. */
  async trim(): Promise<void> {
    const dirs: Array<{ path: string; at: number; bytes: number }> = [];
    for (const d of await readdir(this.cache).catch(() => [] as string[])) {
      const path = join(this.cache, d);
      try {
        const s = await stat(path);
        if (!s.isDirectory()) continue;
        let bytes = 0;
        for (const f of await readdir(path)) bytes += (await stat(join(path, f)).catch(() => ({ size: 0 }))).size;
        dirs.push({ path, at: s.mtimeMs, bytes });
      } catch {
        /* gone meanwhile */
      }
    }
    const oldest = Date.now() - this.limits.maxAgeDays * 86_400_000;
    dirs.sort((a, b) => a.at - b.at);
    let total = dirs.reduce((n, d) => n + d.bytes, 0);
    for (const d of dirs) {
      if (d.at >= oldest && total <= this.limits.cacheBytes) break;
      await rm(d.path, { recursive: true, force: true }).catch(() => undefined);
      total -= d.bytes;
    }
  }

  async usage(): Promise<{ workFiles: number; cacheDocuments: number }> {
    const w = await readdir(this.work).catch(() => [] as string[]);
    const c = await readdir(this.cache).catch(() => [] as string[]);
    return { workFiles: w.length, cacheDocuments: c.length };
  }

  /** Whether a file can be written and removed in the work folder (Diagnostics). */
  async writable(): Promise<boolean> {
    const probe = join(this.work, `.probe-${randomUUID()}`);
    try {
      await mkdir(this.work, { recursive: true, mode: 0o700 });
      await writeFile(probe, 'ok', { mode: 0o600 });
      await rm(probe, { force: true });
      return true;
    } catch {
      return false;
    }
  }

  /** Everything PDF Studio kept here: working copies and thumbnails. */
  async wipe(): Promise<void> {
    await rm(this.work, { recursive: true, force: true }).catch(() => undefined);
    await rm(this.cache, { recursive: true, force: true }).catch(() => undefined);
    await mkdir(this.work, { recursive: true, mode: 0o700 }).catch(() => undefined);
    await mkdir(this.cache, { recursive: true, mode: 0o700 }).catch(() => undefined);
  }
}

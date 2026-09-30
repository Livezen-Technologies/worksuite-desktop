import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { PdfChangeSummary } from '@shared/pdf';
import { SealWriter } from '../elearning-offline';
import type { EngineFile } from './engine';

/**
 * Unsaved work kept on this computer (PDF-SAVE-020, PDF-OFF): while a PDF
 * has changes, a copy of it as it stands is written here on the company's
 * autosave interval, and at once when a save cannot reach WorkSuite. When
 * the same file is opened again — after a crash, a closed window, a lost
 * connection — the window offers the work back; a later save that meets a
 * newer Drive version is a conflict, as any other.
 *
 *   <profile>/PDF/recovery/<hash>/doc.wsl    the PDF, sealed (AES-256-GCM chunks)
 *   <profile>/PDF/recovery/<hash>/meta.bin   what it is, sealed
 *
 * Keys are derived per document from the profile's key, which lives in the
 * OS credential store; without one (no keyring) nothing is kept — the work
 * stays in memory only, as the rest of the profile does. The folder name is
 * a hash, never a file name. Copies older than the retention period go at
 * start-up; a wipe removes everything.
 */
export interface RecoveryMeta {
  identity: string;
  source: { kind: 'drive'; fileId: number } | { kind: 'local'; path: string };
  name: string;
  /** The Drive version the work was made from (null for a local file). */
  baseVersion: number | null;
  summary: PdfChangeSummary;
  savedAt: string;
  /** A save was asked for and is waiting for WorkSuite. */
  pendingSave: boolean;
  size: number;
}

const NONCE = 12;
const TAG = 16;

export class PdfRecovery {
  readonly root: string;

  constructor(
    base: string,
    private readonly master: () => Buffer | null,
    private readonly retentionDays: () => number = () => 14,
  ) {
    this.root = join(base, 'recovery');
  }

  get enabled(): boolean {
    return this.master() !== null;
  }

  private dir(identity: string): string {
    return join(this.root, createHash('sha256').update(`worksuite-pdf-recovery:${identity}`).digest('hex').slice(0, 40));
  }

  private key(identity: string, purpose: 'doc' | 'meta'): Buffer | null {
    const m = this.master();
    return m ? Buffer.from(hkdfSync('sha256', m, identity, `worksuite-pdf-recovery-${purpose}`, 32)) : null;
  }

  /** Keeps the PDF as it stands, with what it is. Written beside and then moved into place, so a crash mid-write keeps the last copy. */
  async write(meta: RecoveryMeta, bytes: Uint8Array): Promise<boolean> {
    const dk = this.key(meta.identity, 'doc');
    const mk = this.key(meta.identity, 'meta');
    if (!dk || !mk) return false;
    const dir = this.dir(meta.identity);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const tmp = join(dir, 'doc.wsl.part');
    const w = await SealWriter.create(tmp, dk);
    let ok = false;
    try {
      await w.write(bytes);
      ok = true;
    } finally {
      await w.close(ok);
    }
    await rename(tmp, join(dir, 'doc.wsl'));
    const nonce = randomBytes(NONCE);
    const c = createCipheriv('aes-256-gcm', mk, nonce);
    c.setAAD(Buffer.from(meta.identity));
    const body = Buffer.concat([c.update(JSON.stringify({ ...meta, size: bytes.byteLength })), c.final()]);
    await writeFile(join(dir, 'meta.bin.part'), Buffer.concat([nonce, c.getAuthTag(), body]), { mode: 0o600 });
    await rename(join(dir, 'meta.bin.part'), join(dir, 'meta.bin'));
    return true;
  }

  /** What is kept for this document, or null. */
  async read(identity: string): Promise<RecoveryMeta | null> {
    const mk = this.key(identity, 'meta');
    if (!mk) return null;
    try {
      const raw = await readFile(join(this.dir(identity), 'meta.bin'));
      const d = createDecipheriv('aes-256-gcm', mk, raw.subarray(0, NONCE));
      d.setAAD(Buffer.from(identity));
      d.setAuthTag(raw.subarray(NONCE, NONCE + TAG));
      const meta = JSON.parse(Buffer.concat([d.update(raw.subarray(NONCE + TAG)), d.final()]).toString('utf8')) as RecoveryMeta;
      await stat(join(this.dir(identity), 'doc.wsl'));
      return meta.identity === identity ? meta : null;
    } catch {
      return null;
    }
  }

  /** The kept PDF, for the engine to open. */
  async file(identity: string): Promise<EngineFile | null> {
    const meta = await this.read(identity);
    const dk = this.key(identity, 'doc');
    if (!meta || !dk) return null;
    return { kind: 'sealed', path: join(this.dir(identity), 'doc.wsl'), size: meta.size, key: dk.toString('base64') };
  }

  async remove(identity: string): Promise<void> {
    await rm(this.dir(identity), { recursive: true, force: true }).catch(() => undefined);
  }

  /** Start-up: copies past the company's retention period go (their work was never saved or asked for). */
  async trim(): Promise<void> {
    const oldest = Date.now() - this.retentionDays() * 86_400_000;
    for (const d of await readdir(this.root).catch(() => [] as string[])) {
      const path = join(this.root, d);
      const s = await stat(path).catch(() => null);
      if (!s || s.mtimeMs < oldest) await rm(path, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  async count(): Promise<number> {
    return (await readdir(this.root).catch(() => [] as string[])).length;
  }

  async wipe(): Promise<void> {
    await rm(this.root, { recursive: true, force: true }).catch(() => undefined);
  }
}

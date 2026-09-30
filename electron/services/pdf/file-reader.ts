import { createDecipheriv } from 'node:crypto';
import { closeSync, fstatSync, openSync, readSync } from 'node:fs';
import type { EngineFile } from './engine';

/**
 * How the engine reads a document: a block at a time, synchronously, when
 * PDFium asks (FPDF_LoadCustomDocument). Nothing loads the whole file, so a
 * 2 GB drawing set opens with only the parts PDFium touches in memory
 * (PDF-VIEW-015, AC-03).
 *
 * A working copy (a Drive file, a mail attachment) is sealed on disk the way
 * eLearning's offline copies are (electron/services/elearning-offline.ts,
 * format "WSL1"): AES-256-GCM in 1 MiB chunks, each with its own nonce and
 * its index as associated data, under a key that lives only in memory. This
 * reader opens chunks as they are needed; a chunk that fails its tag stops
 * the read — PDFium then reports the file as damaged, and nothing tampered
 * with is parsed (PDF-NFR-020).
 */
export interface BlockReader {
  readonly size: number;
  /** Fills `into` from `position`; false when the file cannot give those bytes. */
  read(position: number, into: Uint8Array): boolean;
  close(): void;
}

// The sealed format (kept in step with elearning-offline.ts; a unit test writes with its SealWriter and reads here).
const CHUNK = 1024 * 1024;
const NONCE = 12;
const TAG = 16;
const STRIDE = NONCE + CHUNK + TAG;
const MAGIC = Buffer.from('WSL1');
const HEADER = 8;

export class PlainReader implements BlockReader {
  private fd: number | null;
  readonly size: number;

  constructor(path: string) {
    this.fd = openSync(path, 'r');
    this.size = fstatSync(this.fd).size;
  }

  read(position: number, into: Uint8Array): boolean {
    if (this.fd === null || position < 0 || position + into.length > this.size) return false;
    let done = 0;
    while (done < into.length) {
      const n = readSync(this.fd, into, done, into.length - done, position + done);
      if (n <= 0) return false;
      done += n;
    }
    return true;
  }

  close(): void {
    if (this.fd !== null) closeSync(this.fd);
    this.fd = null;
  }
}

export class SealedReader implements BlockReader {
  private fd: number | null;
  private readonly key: Buffer;
  /** A few opened chunks, most recent last: PDFium reads the same regions again and again. */
  private cache = new Map<number, Buffer>();
  private readonly sealed = Buffer.alloc(STRIDE);

  constructor(
    path: string,
    key: Buffer,
    readonly size: number,
    private readonly keep = 24,
  ) {
    if (key.length !== 32) throw new Error('bad key');
    this.key = key;
    this.fd = openSync(path, 'r');
    const head = Buffer.alloc(HEADER);
    if (readSync(this.fd, head, 0, HEADER, 0) !== HEADER || !head.subarray(0, 4).equals(MAGIC) || head.readUInt32BE(4) !== CHUNK) {
      this.close();
      throw new Error('not a sealed copy');
    }
  }

  private chunk(i: number): Buffer | null {
    const hit = this.cache.get(i);
    if (hit) {
      this.cache.delete(i);
      this.cache.set(i, hit);
      return hit;
    }
    if (this.fd === null) return null;
    const plainLen = Math.min(CHUNK, this.size - i * CHUNK);
    if (plainLen <= 0) return null;
    const len = NONCE + plainLen + TAG;
    const n = readSync(this.fd, this.sealed, 0, len, HEADER + i * STRIDE);
    if (n !== len) return null;
    try {
      const d = createDecipheriv('aes-256-gcm', this.key, this.sealed.subarray(0, NONCE));
      const aad = Buffer.alloc(4);
      aad.writeUInt32BE(i, 0);
      d.setAAD(aad);
      d.setAuthTag(this.sealed.subarray(len - TAG, len));
      const plain = Buffer.concat([d.update(this.sealed.subarray(NONCE, len - TAG)), d.final()]);
      this.cache.set(i, plain);
      while (this.cache.size > this.keep) this.cache.delete(this.cache.keys().next().value!);
      return plain;
    } catch {
      return null;
    }
  }

  read(position: number, into: Uint8Array): boolean {
    if (position < 0 || position + into.length > this.size) return false;
    let done = 0;
    while (done < into.length) {
      const at = position + done;
      const i = Math.floor(at / CHUNK);
      const plain = this.chunk(i);
      if (!plain) return false;
      const from = at - i * CHUNK;
      const take = Math.min(plain.length - from, into.length - done);
      if (take <= 0) return false;
      into.set(plain.subarray(from, from + take), done);
      done += take;
    }
    return true;
  }

  close(): void {
    if (this.fd !== null) closeSync(this.fd);
    this.fd = null;
    this.cache.clear();
  }
}

export function openReader(file: EngineFile): BlockReader {
  if (file.kind === 'sealed') return new SealedReader(file.path, Buffer.from(file.key, 'base64'), file.size);
  return new PlainReader(file.path);
}

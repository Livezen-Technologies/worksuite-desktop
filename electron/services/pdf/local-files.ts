import { randomUUID } from 'node:crypto';
import { open, realpath, stat } from 'node:fs/promises';
import { basename, extname, isAbsolute, relative, resolve } from 'node:path';
import { MAX_PDF_BYTES, type PdfLocalPick } from '@shared/pdf';
import { DesktopError } from '../../main/errors';

/**
 * PDFLocalFileBridge (§3.3, PDF-ARCH-014, PDF-API-001).
 *
 * The renderer never names a path. A PDF on this computer reaches PDF
 * Studio only as a handle this bridge issued for a path that came from:
 *  - the main process's own open dialog (File → Open, Ctrl+O),
 *  - a real drop (the preload turns the dropped File into its path), or
 *  - the operating system ("Open with", a file handed to the app).
 *
 * Every path is resolved (links followed), must be a regular file, must be
 * a PDF by its first bytes (`%PDF-` in the first 1,024 bytes, as ISO 32000
 * allows) — not merely by its name — and within the size limit, and must not
 * sit inside WorkSuite's own data folder (the database, secrets and working
 * copies are never opened this way). Local PDFs are read in place and never
 * uploaded without an explicit action (PDF-OPEN-002).
 */
export interface LocalPdf {
  handle: string;
  path: string;
  name: string;
  size: number;
  mtimeMs: number;
}

export interface LocalFilesDeps {
  /** The organisation's Max PDF Size (§21.2); at most the engine's ceiling. */
  maxBytes: () => number;
  /** Folders nothing may be opened from (the app's own data). */
  forbidden: () => string[];
}

export interface Rejected {
  name: string;
  reason: string;
}

export function inside(child: string, parent: string): boolean {
  const rel = relative(resolve(parent), resolve(child));
  return rel === '' || (!!rel && !rel.startsWith('..') && !isAbsolute(rel));
}

export async function looksLikePdf(path: string): Promise<boolean> {
  const fh = await open(path, 'r');
  try {
    const head = Buffer.alloc(1024);
    const { bytesRead } = await fh.read(head, 0, 1024, 0);
    return head.subarray(0, bytesRead).includes(Buffer.from('%PDF-'));
  } finally {
    await fh.close();
  }
}

export class PdfLocalFiles {
  private handles = new Map<string, LocalPdf>();

  constructor(private readonly deps: LocalFilesDeps) {}

  /** Validates one path; the reason is a sentence for the person, never the path. */
  async check(raw: string): Promise<{ ok: true; file: Omit<LocalPdf, 'handle'> } | { ok: false; reason: string }> {
    const name = basename(raw);
    if (typeof raw !== 'string' || !raw || raw.includes('\0') || !isAbsolute(raw)) return { ok: false, reason: `${name || 'That item'} is not a file on this computer.` };
    let real: string;
    try {
      real = await realpath(raw);
    } catch {
      return { ok: false, reason: `${name} could not be found.` };
    }
    for (const root of this.deps.forbidden()) {
      if (inside(real, root)) return { ok: false, reason: `${name} is inside WorkSuite's own data and cannot be opened here.` };
    }
    let st;
    try {
      st = await stat(real);
    } catch {
      return { ok: false, reason: `${name} could not be read.` };
    }
    if (!st.isFile()) return { ok: false, reason: `${name} is not a file.` };
    const limit = Math.min(this.deps.maxBytes(), MAX_PDF_BYTES);
    if (st.size > limit) return { ok: false, reason: `${name} is larger than ${Math.round(limit / 1024 ** 3 * 10) / 10} GB, the most PDF Studio opens.` };
    if (st.size < 8) return { ok: false, reason: `${name} is empty.` };
    try {
      if (!(await looksLikePdf(real))) return { ok: false, reason: `${name} is not a PDF.` };
    } catch {
      return { ok: false, reason: `${name} could not be read.` };
    }
    return { ok: true, file: { path: real, name: basename(real), size: st.size, mtimeMs: st.mtimeMs } };
  }

  /** Handles for the PDFs among `paths`; the rest are listed with why. */
  async register(paths: string[]): Promise<{ files: PdfLocalPick[]; rejected: Rejected[] }> {
    const files: PdfLocalPick[] = [];
    const rejected: Rejected[] = [];
    for (const p of paths.slice(0, 20)) {
      const r = await this.check(p);
      if (!r.ok) {
        rejected.push({ name: basename(String(p)) || 'item', reason: r.reason });
        continue;
      }
      // The same file chosen twice gets its first handle back, so an open tab is found again.
      const known = [...this.handles.values()].find((h) => h.path === r.file.path && h.size === r.file.size && h.mtimeMs === r.file.mtimeMs);
      const h = known ?? { handle: randomUUID(), ...r.file };
      this.handles.set(h.handle, h);
      files.push({ handle: h.handle, name: h.name, size: h.size });
    }
    return { files, rejected };
  }

  /** The file behind a handle, checked again (it may have been moved, replaced or grown since). */
  async resolve(handle: string): Promise<LocalPdf> {
    const h = this.handles.get(handle);
    if (!h) throw new DesktopError('NOT_FOUND', 'Open the file again from this computer: WorkSuite no longer holds it.');
    const r = await this.check(h.path);
    if (!r.ok) throw new DesktopError('NOT_FOUND', r.reason);
    const next = { ...h, ...r.file };
    this.handles.set(handle, next);
    return next;
  }

  name(handle: string): string | null {
    return this.handles.get(handle)?.name ?? null;
  }

  /** The path behind a handle, for writing a saved PDF back (main process only; never sent to a page). */
  path(handle: string): string | null {
    return this.handles.get(handle)?.path ?? null;
  }

  forget(): void {
    this.handles.clear();
  }
}

/** Paths in a second launch's arguments that could be a PDF handed over by the OS ("Open with"). */
export function pdfPathsInArgv(argv: readonly string[]): string[] {
  return argv.filter((a, i) => i > 0 && typeof a === 'string' && !a.startsWith('-') && isAbsolute(a) && extname(a).toLowerCase() === '.pdf').slice(0, 10);
}

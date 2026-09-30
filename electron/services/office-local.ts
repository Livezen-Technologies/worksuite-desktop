import { randomUUID } from 'node:crypto';
import { open, readFile, realpath, stat } from 'node:fs/promises';
import { basename, isAbsolute } from 'node:path';
import { MAX_OFFICE_LOCAL_BYTES, officeKind, type OfficeLocalPick } from '@shared/office';
import { DesktopError } from '../main/errors';
import { inside, type Rejected } from './pdf/local-files';

/**
 * OfficeFileService — Office files on this computer for WorkSuite DOC / Sheet / Slides tabs.
 *
 * Like PDF Studio's bridge, the renderer never names a path: a file reaches
 * an Office tab only as a handle issued here for a path from the main
 * process's own open dialog or from the operating system ("Open with"). A
 * path is resolved (links followed), must be a regular file of an Office
 * type — by its name and its first bytes (a ZIP package, an OLE compound
 * file, or text for RTF/CSV) — within the size limit, and outside
 * WorkSuite's own data. Saving writes back only to a file that was opened
 * this way, atomically; "Save a copy" writes only where the person chose in
 * the save dialog.
 */
export interface LocalOffice {
  handle: string;
  path: string;
  name: string;
  size: number;
  mtimeMs: number;
}

const ZIP = [0x50, 0x4b, 0x03, 0x04];
const OLE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const starts = (b: Buffer, sig: number[]) => sig.every((x, i) => b[i] === x);

/** Whether a file's first bytes fit its Office type (not merely its name). */
export function officeBytesFit(name: string, head: Buffer): boolean {
  const e = (name.split('.').pop() ?? '').toLowerCase();
  if (e === 'rtf') return head.subarray(0, 5).toString('latin1') === '{\\rtf';
  if (e === 'csv') return !head.subarray(0, 512).includes(0);
  if (['doc', 'xls', 'ppt'].includes(e)) return starts(head, OLE);
  return starts(head, ZIP);
}

export class OfficeLocalFiles {
  private handles = new Map<string, LocalOffice>();

  constructor(private readonly deps: { forbidden: () => string[] }) {}

  async check(raw: string): Promise<{ ok: true; file: Omit<LocalOffice, 'handle'> } | { ok: false; reason: string }> {
    const name = typeof raw === 'string' ? basename(raw) : '';
    if (typeof raw !== 'string' || !raw || raw.includes('\0') || !isAbsolute(raw)) return { ok: false, reason: `${name || 'That item'} is not a file on this computer.` };
    // The formats the tab's local editor opens; older ones (.doc, .xls, .odt…) open in an installed app.
    if (!officeKind(name) || !/\.(docx|xlsx|pptx)$/i.test(name)) return { ok: false, reason: `${name} is not a .docx, .xlsx or .pptx file.` };
    let real: string;
    try {
      real = await realpath(raw);
    } catch {
      return { ok: false, reason: `${name} could not be found.` };
    }
    for (const root of this.deps.forbidden()) if (inside(real, root)) return { ok: false, reason: `${name} is inside WorkSuite's own data and cannot be opened here.` };
    const st = await stat(real).catch(() => null);
    if (!st?.isFile()) return { ok: false, reason: `${name} is not a file.` };
    if (st.size > MAX_OFFICE_LOCAL_BYTES) return { ok: false, reason: `${name} is larger than 200 MB, the most WorkSuite opens here.` };
    const fh = await open(real, 'r').catch(() => null);
    if (!fh) return { ok: false, reason: `${name} could not be read.` };
    try {
      const head = Buffer.alloc(512);
      const { bytesRead } = await fh.read(head, 0, 512, 0);
      if (st.size > 0 && !officeBytesFit(basename(real), head.subarray(0, bytesRead))) return { ok: false, reason: `${name} is not what its name says: it cannot be opened as an Office file.` };
    } finally {
      await fh.close();
    }
    return { ok: true, file: { path: real, name: basename(real), size: st.size, mtimeMs: st.mtimeMs } };
  }

  async register(paths: string[]): Promise<{ files: OfficeLocalPick[]; rejected: Rejected[] }> {
    const files: OfficeLocalPick[] = [];
    const rejected: Rejected[] = [];
    for (const p of paths.slice(0, 20)) {
      const r = await this.check(p);
      if (!r.ok) {
        rejected.push({ name: basename(String(p)) || 'item', reason: r.reason });
        continue;
      }
      // The same file again gets its first handle, so its open tab is found again.
      const known = [...this.handles.values()].find((h) => h.path === r.file.path);
      const h = { ...(known ?? { handle: randomUUID() }), ...r.file };
      this.handles.set(h.handle, h);
      files.push({ handle: h.handle, name: h.name, size: h.size });
    }
    return { files, rejected };
  }

  private async resolve(handle: string): Promise<LocalOffice> {
    const h = this.handles.get(handle);
    if (!h) throw new DesktopError('NOT_FOUND', 'Open the file again from this computer: WorkSuite no longer holds it.');
    const r = await this.check(h.path);
    if (!r.ok) throw new DesktopError('NOT_FOUND', r.reason);
    const next = { ...h, ...r.file };
    this.handles.set(handle, next);
    return next;
  }

  /** The file's bytes, for the tab's editor. */
  async read(handle: string): Promise<Uint8Array> {
    const h = await this.resolve(handle);
    return new Uint8Array(await readFile(h.path));
  }

  /** Saves the editor's bytes over the file it opened (atomically: the old file or the new one, never half). */
  async write(handle: string, bytes: Uint8Array, writeAtomically: (path: string, bytes: Uint8Array) => Promise<void>): Promise<{ size: number }> {
    const h = this.handles.get(handle);
    if (!h) throw new DesktopError('NOT_FOUND', 'Open the file again from this computer: WorkSuite no longer holds it.');
    if (bytes.byteLength > MAX_OFFICE_LOCAL_BYTES) throw new DesktopError('IPC_VALIDATION_FAILED', 'The document is too large to save here.');
    await writeAtomically(h.path, bytes);
    const st = await stat(h.path);
    this.handles.set(handle, { ...h, size: st.size, mtimeMs: st.mtimeMs });
    return { size: st.size };
  }

  path(handle: string): string | null {
    return this.handles.get(handle)?.path ?? null;
  }

  forget(): void {
    this.handles.clear();
  }
}

/** Paths among a launch's arguments that could be an Office file handed over by the OS ("Open with"). */
export function officePathsInArgv(argv: readonly string[]): string[] {
  return argv.slice(1).filter((a) => typeof a === 'string' && isAbsolute(a) && !a.startsWith('-') && /\.(docx|xlsx|pptx)$/i.test(basename(a))).slice(0, 20);
}

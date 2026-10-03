import { readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, extname, join, relative, sep } from 'node:path';
import { msgToMime } from './msg';
import { MAX_MESSAGE_BYTES, type DataBatch, type DataFileReader, type DataFolder, type DataItem } from './types';

/**
 * A folder of .eml (or .msg) files — what Apple Mail and many backup tools
 * export (ENH-MAIL-03 DMO-DAT-02). Each directory is a folder; each file a
 * message. A single .eml or .msg is a folder of one.
 *
 * Only the chosen folder and what is under it is read; links that lead out
 * of it are not followed.
 */

const MAX_FILES = 200_000;
const MAX_DEPTH = 12;

export function walkMailFiles(root: string, kind: 'eml' | 'msg'): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const want = kind === 'msg' ? '.msg' : '.eml';
  let seen = 0;
  const visit = (dir: string, depth: number) => {
    if (depth > MAX_DEPTH || seen >= MAX_FILES) return;
    let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean; isSymbolicLink(): boolean }> = [];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    const files: string[] = [];
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.isSymbolicLink() || e.name.startsWith('.')) continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) visit(full, depth + 1);
      else if (e.isFile() && extname(e.name).toLowerCase() === want && seen < MAX_FILES) {
        files.push(full);
        seen++;
      }
    }
    if (files.length) {
      const rel = relative(root, dir).split(sep).filter(Boolean).join('/');
      out.set(rel || basename(root), files);
    }
  };
  visit(root, 0);
  return out;
}

export class MailFilesReader implements DataFileReader {
  private readonly groups: Array<{ path: string; files: string[] }>;

  constructor(path: string, private readonly kind: 'eml' | 'msg') {
    const single = statSync(path).isFile();
    this.groups = single ? [{ path: basename(path, extname(path)), files: [path] }] : [...walkMailFiles(path, kind)].map(([p, files]) => ({ path: p, files }));
  }

  folders(): { folders: DataFolder[]; unreadable: string[] } {
    return { folders: this.groups.map((g, i) => ({ id: i + 1, path: g.path, count: g.files.length, mail: true })), unreadable: [] };
  }

  batch(folderId: number, offset: number, limit: number, maxBytes: number): DataBatch {
    const g = this.groups[folderId - 1];
    if (!g) return { items: [], next: null };
    const items: DataItem[] = [];
    let used = 0;
    let i = offset;
    for (; i < g.files.length && items.length < limit && used < maxBytes; i++) {
      const file = g.files[i]!;
      try {
        const size = statSync(file).size;
        if (size > MAX_MESSAGE_BYTES) {
          items.push({ flags: [], date: null, subject: basename(file), error: 'Larger than 24 MB.' });
          continue;
        }
        const data = readFileSync(file);
        const raw = this.kind === 'msg' ? msgToMime(data) : data;
        items.push({ raw, flags: ['\\Seen'], date: null, subject: /^Subject:\s*(.*)$/im.exec(raw.subarray(0, 16384).toString('utf8'))?.[1] });
        used += raw.length;
      } catch (e) {
        items.push({ flags: [], date: null, subject: basename(file), error: `Could not be read (${(e as Error).message.slice(0, 80)}).` });
      }
    }
    return { items, next: i < g.files.length ? i : null };
  }

  close(): void {
    // Files are read whole and closed as they are read.
  }
}

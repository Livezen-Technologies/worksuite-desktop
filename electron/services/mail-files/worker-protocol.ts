import { readFileSync, statSync } from 'node:fs';
import { MailFilesReader } from './eml';
import { MboxReader } from './mbox';
import { msgToMime } from './msg';
import { PstReader } from './pst';
import { MAX_MESSAGE_BYTES, type DataFileKind, type DataFileReader, type DataFolder, type MailFileView } from './types';
import { parseMailFile, type ParsedFile } from './view';

/**
 * The data-file worker's conversation with the main process (ENH-MAIL-03
 * §3.1, the amber box): one file per worker; the main process names it, the
 * worker reads it. Messages cross as bytes (Uint8Array), never as paths the
 * renderer could see.
 */

export type WorkerRequest =
  | { id: number; op: 'open'; path: string; kind: DataFileKind }
  | { id: number; op: 'batch'; folderId: number; offset: number; limit: number; maxBytes: number }
  | { id: number; op: 'view'; path: string; kind: 'eml' | 'msg' }
  | { id: number; op: 'attachment'; index: number }
  | { id: number; op: 'close' };

export interface WireItem {
  raw?: Uint8Array;
  flags: string[];
  date: string | null;
  subject?: string;
  skip?: string;
  error?: string;
}

export type WorkerResult =
  | { folders: DataFolder[]; unreadable: string[] }
  | { items: WireItem[]; next: number | null }
  | MailFileView
  | { name: string; mime: string; data: Uint8Array }
  | null;

export type WorkerResponse = { id: number; ok: true; result: WorkerResult } | { id: number; ok: false; error: string };

export function readerFor(path: string, kind: DataFileKind): DataFileReader {
  if (kind === 'pst') return new PstReader(path);
  if (kind === 'mbox') return new MboxReader(path);
  return new MailFilesReader(path, kind);
}

/** The worker's state and its answers; used in the worker process, and directly by tests. */
export function createWorkerHandler(): (req: WorkerRequest) => Promise<WorkerResponse> {
  let reader: DataFileReader | null = null;
  let parsed: ParsedFile | null = null;
  return async (req) => {
    try {
      switch (req.op) {
        case 'open': {
          reader?.close();
          reader = readerFor(req.path, req.kind);
          return { id: req.id, ok: true, result: reader.folders() };
        }
        case 'batch': {
          if (!reader) throw new Error('No file is open.');
          const b = reader.batch(req.folderId, req.offset, Math.max(1, Math.min(50, req.limit)), Math.max(1, req.maxBytes));
          return { id: req.id, ok: true, result: { next: b.next, items: b.items.map((it) => ({ ...it, raw: it.raw ? new Uint8Array(it.raw.buffer, it.raw.byteOffset, it.raw.byteLength) : undefined })) } };
        }
        case 'view': {
          if (statSync(req.path).size > MAX_MESSAGE_BYTES * 2) throw new Error('The file is too large to open as a message.');
          const data = readFileSync(req.path);
          parsed = await parseMailFile(req.kind === 'msg' ? msgToMime(data) : data);
          return { id: req.id, ok: true, result: parsed.view };
        }
        case 'attachment': {
          const a = parsed?.attachments[req.index];
          if (!a) throw new Error('No such attachment.');
          return { id: req.id, ok: true, result: { name: a.name, mime: a.mime, data: new Uint8Array(a.data.buffer, a.data.byteOffset, a.data.byteLength) } };
        }
        case 'close': {
          reader?.close();
          reader = null;
          parsed = null;
          return { id: req.id, ok: true, result: null };
        }
      }
    } catch (e) {
      return { id: req.id, ok: false, error: (e as Error)?.message?.slice(0, 300) || 'The file could not be read.' };
    }
  };
}

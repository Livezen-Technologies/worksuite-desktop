import { randomUUID } from 'node:crypto';
import { statSync } from 'node:fs';
import { basename, extname } from 'node:path';
import type { DataFileKind, DataFolder, ImportProgress, MailFileHandle, MailFileView, MailPlanEntry } from '@shared/mail-files';
import type { WireItem, WorkerRequest, WorkerResponse, WorkerResult } from './worker-protocol';

export type { ImportProgress } from '@shared/mail-files';
type FileHandle = MailFileHandle;
type PlanEntry = MailPlanEntry;
type WithoutId<T> = T extends unknown ? Omit<T, 'id'> : never;

/**
 * Mail data files in the main process (ENH-MAIL-03 DMO-DAT-01…04, WF-DO09):
 * which file the person chose, the sandboxed worker that reads it, and the
 * import that streams its messages to the server.
 *
 * The renderer only ever holds a handle — a random id — for a file; paths
 * stay here, and so do the bytes, which go straight from the worker to the
 * server's import API. The import runs here, not in a window, so the person
 * can close Mail and it carries on; progress goes to every window.
 */

export interface WorkerChannel {
  post(m: WorkerRequest): void;
  onMessage(cb: (m: WorkerResponse) => void): void;
  onExit(cb: (code: number) => void): void;
  kill(): void;
}

export interface MailFilesHttp {
  post<T>(path: string, body?: unknown, opts?: { timeoutMs?: number }): Promise<T>;
}

export interface MailFilesDeps {
  http: MailFilesHttp;
  spawn: () => WorkerChannel;
  broadcast: (payload: ImportProgress) => void;
  audit: (action: string, details: Record<string, unknown>) => void;
  /** How long to wait before trying a failed batch again (tests: 0). */
  retryMs?: number;
}

interface Job {
  importId: number;
  plan: PlanEntry[];
  /** Where it got to: the plan entry and the offset inside it. */
  at: number;
  offset: number;
  progress: ImportProgress;
  cancel: boolean;
  running: boolean;
}

interface Entry {
  handle: FileHandle;
  path: string;
  worker: Worker | null;
  folders: DataFolder[] | null;
  unreadable: string[];
  job: Job | null;
}

/** The kind of a chosen path; null when it is not one of ours. */
export function kindOf(path: string, isDir: boolean): DataFileKind | null {
  if (isDir) return 'eml';
  const ext = extname(path).toLowerCase();
  if (ext === '.pst' || ext === '.ost') return 'pst';
  if (ext === '.mbox' || ext === '.mbx' || ext === '') return 'mbox';
  if (ext === '.eml') return 'eml';
  if (ext === '.msg') return 'msg';
  return null;
}

/** One running worker: requests answered in order of their ids. */
class Worker {
  private seq = 0;
  private waiting = new Map<number, { resolve: (r: WorkerResult) => void; reject: (e: Error) => void }>();
  alive = true;
  /** The file is open in it (a fresh worker after a crash has nothing open). */
  opened = false;

  constructor(private readonly channel: WorkerChannel) {
    channel.onMessage((m) => {
      const w = this.waiting.get(m.id);
      if (!w) return;
      this.waiting.delete(m.id);
      if (m.ok) w.resolve(m.result);
      else w.reject(new Error(m.error));
    });
    channel.onExit(() => {
      this.alive = false;
      for (const w of this.waiting.values()) w.reject(new Error('The file reader stopped — the file may be damaged.'));
      this.waiting.clear();
    });
  }

  request<T extends WorkerResult>(req: WithoutId<WorkerRequest>): Promise<T> {
    if (!this.alive) return Promise.reject(new Error('The file reader is not running.'));
    const id = ++this.seq;
    return new Promise<T>((resolve, reject) => {
      this.waiting.set(id, { resolve: resolve as (r: WorkerResult) => void, reject });
      this.channel.post({ ...req, id } as WorkerRequest);
    });
  }

  kill(): void {
    this.alive = false;
    this.channel.kill();
  }
}

const BATCH = 25;
const BATCH_BYTES = 16 * 1024 * 1024;

export class MailFiles {
  private readonly files = new Map<string, Entry>();

  constructor(private readonly deps: MailFilesDeps) {}

  /** A path the person chose (or the system handed over): a handle for it. */
  add(path: string): FileHandle | null {
    let st;
    try {
      st = statSync(path);
    } catch {
      return null;
    }
    const kind = kindOf(path, st.isDirectory());
    if (!kind) return null;
    const handle: FileHandle = { id: randomUUID(), name: basename(path), kind, size: st.isDirectory() ? 0 : st.size, folder: st.isDirectory() };
    this.files.set(handle.id, { handle, path, worker: null, folders: null, unreadable: [], job: null });
    return handle;
  }

  private entry(id: string): Entry {
    const e = this.files.get(id);
    if (!e) throw new Error('That file is no longer open. Choose it again.');
    return e;
  }

  private worker(e: Entry): Worker {
    if (!e.worker || !e.worker.alive) e.worker = new Worker(this.deps.spawn());
    return e.worker;
  }

  /** What the file holds: its folders, with counts, and what could not be read. */
  async scan(id: string): Promise<{ folders: DataFolder[]; unreadable: string[] }> {
    const e = this.entry(id);
    const w = this.worker(e);
    const r = await w.request<{ folders: DataFolder[]; unreadable: string[] }>({ op: 'open', path: e.path, kind: e.handle.kind });
    w.opened = true;
    e.folders = r.folders;
    e.unreadable = r.unreadable;
    return r;
  }

  /** One message file opened to read. */
  async view(id: string): Promise<MailFileView> {
    const e = this.entry(id);
    if (e.handle.kind !== 'eml' && e.handle.kind !== 'msg') throw new Error('Only an .eml or .msg file opens as a message.');
    return this.worker(e).request<MailFileView>({ op: 'view', path: e.path, kind: e.handle.kind });
  }

  async attachment(id: string, index: number): Promise<{ name: string; mime: string; data: Uint8Array }> {
    return this.worker(this.entry(id)).request({ op: 'attachment', index });
  }

  /** Start (or resume) the import of a scanned file into the import the server made. */
  start(id: string, importId: number, plan: PlanEntry[]): ImportProgress {
    const e = this.entry(id);
    if (!e.folders) throw new Error('Read the file first.');
    if (e.job?.running) return e.job.progress;
    if (!e.job || e.job.importId !== importId) {
      const known = new Set(e.folders.map((f) => f.id));
      const steps = plan.filter((p) => known.has(p.folder) && p.destination);
      const total = steps.reduce((n, p) => n + (e.folders!.find((f) => f.id === p.folder)?.count ?? 0), 0);
      e.job = {
        importId, plan: steps, at: 0, offset: 0, cancel: false, running: false,
        progress: { handle: id, importId, state: 'running', folder: null, done: 0, total, copied: 0, skipped: 0, failed: 0, error: null, unreadable: [...e.unreadable] },
      };
      this.deps.audit('mail.datafile.import', { kind: e.handle.kind, folders: steps.length, total });
    }
    e.job.cancel = false;
    e.job.progress = { ...e.job.progress, state: 'running', error: null };
    void this.run(e);
    return e.job.progress;
  }

  cancel(id: string): void {
    const e = this.files.get(id);
    if (e?.job) e.job.cancel = true;
  }

  progress(id: string): ImportProgress | null {
    return this.files.get(id)?.job?.progress ?? null;
  }

  private emit(job: Job, patch: Partial<ImportProgress>): void {
    job.progress = { ...job.progress, ...patch };
    this.deps.broadcast(job.progress);
  }

  private async send(job: Job, step: PlanEntry, items: WireItem[]): Promise<{ copied: number; skipped: number; failed: number }> {
    const messages = items.filter((it) => it.raw).map((it) => ({ raw: Buffer.from(it.raw!).toString('base64'), flags: it.flags, date: it.date }));
    if (!messages.length) return { copied: 0, skipped: 0, failed: 0 };
    let last: unknown = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.deps.http.post(`/api/mail/imports/datafile/${job.importId}/stream`, { folder: step.source, destination: step.destination, messages }, { timeoutMs: 180_000 });
      } catch (err) {
        last = err;
        if (this.deps.retryMs !== 0) await new Promise((r) => setTimeout(r, (this.deps.retryMs ?? 5_000) * (attempt + 1)));
      }
    }
    throw last instanceof Error ? last : new Error('The server did not take the messages.');
  }

  private async run(e: Entry): Promise<void> {
    const job = e.job!;
    if (job.running) return;
    job.running = true;
    try {
      // A resumed import after the reader stopped opens the file again in a fresh worker.
      if (!this.worker(e).opened) await this.scan(e.handle.id);
      while (job.at < job.plan.length) {
        const step = job.plan[job.at]!;
        this.emit(job, { folder: step.source });
        let batch: { items: WireItem[]; next: number | null };
        try {
          batch = await this.worker(e).request({ op: 'batch', folderId: step.folder, offset: job.offset, limit: BATCH, maxBytes: BATCH_BYTES });
        } catch (err) {
          // A folder the reader cannot get through: noted, and on to the next.
          this.emit(job, { unreadable: [...job.progress.unreadable, `${step.source} (${(err as Error).message})`] });
          job.at++;
          job.offset = 0;
          if (!this.worker(e).opened) await this.scan(e.handle.id).catch(() => undefined);
          continue;
        }
        const r = await this.send(job, step, batch.items);
        const local = batch.items.filter((it) => !it.raw);
        this.emit(job, {
          done: job.progress.done + batch.items.length,
          copied: job.progress.copied + r.copied,
          skipped: job.progress.skipped + r.skipped + local.filter((it) => it.skip).length,
          failed: job.progress.failed + r.failed + local.filter((it) => it.error).length,
        });
        if (batch.next === null) {
          job.at++;
          job.offset = 0;
        } else job.offset = batch.next;
        if (job.cancel) {
          await this.deps.http.post(`/api/mail/imports/datafile/${job.importId}/finish`, { state: 'cancelled', unreadable: job.progress.unreadable }).catch(() => undefined);
          this.emit(job, { state: 'cancelled' });
          return;
        }
      }
      await this.deps.http.post(`/api/mail/imports/datafile/${job.importId}/finish`, { state: 'done', unreadable: job.progress.unreadable });
      this.emit(job, { state: 'done', folder: null });
    } catch (err) {
      // Offline, the server full, the mailbox refusing: paused where it got to, to resume.
      this.emit(job, { state: 'paused', error: (err as Error)?.message ?? 'The import stopped.' });
    } finally {
      job.running = false;
    }
  }

  close(id: string): void {
    const e = this.files.get(id);
    if (!e) return;
    if (e.job?.running) {
      e.job.cancel = true;
      return;
    }
    e.worker?.kill();
    this.files.delete(id);
  }

  closeAll(): void {
    for (const e of this.files.values()) {
      if (e.job) e.job.cancel = true;
      e.worker?.kill();
    }
    this.files.clear();
  }
}

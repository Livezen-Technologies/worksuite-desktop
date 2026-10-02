import { randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { appendFile, mkdir, open, rename, rm, stat, statfs, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { shell } from 'electron';
import type { LocalRecording, MeetRecordingPrefs } from '@shared/types';
import { logger } from '../main/log';
import { DesktopError, isDesktopError } from '../main/errors';
import type { Database } from './db';
import type { HttpClient } from './http';
import type { TransferManager } from './transfers';
import { videoProblem } from './video-check';
import { withDuration } from './webm-duration';

const log = logger('meet-recorder');

/** Below this much free space a recording does not start: an hour of 1080p is about 2 GB. */
export const MIN_FREE = 2 * 1024 ** 3;
/** The largest piece one IPC call may hand over (a few seconds of video). */
export const MAX_CHUNK = 16 * 1024 * 1024;
const HEAD = 1024 * 1024;
const DAY = 24 * 60 * 60 * 1000;

interface Entry extends LocalRecording {
  /** Where it is on this computer: `.part` while it is written. */
  path: string;
  transferId: string | null;
}

export interface MeetRecorderDeps {
  db: Pick<Database, 'getConfig' | 'setConfig'>;
  http: Pick<HttpClient, 'post'>;
  transfers: Pick<TransferManager, 'uploadOwn' | 'uploadStatus' | 'whenUploaded' | 'resume'>;
  prefs: () => MeetRecordingPrefs;
  userId: () => string | null;
  /** Free bytes where a recording would be written. */
  freeSpace?: (dir: string) => Promise<number | null>;
  /** Tells the person when a recording made here is ready to play, or has failed (worksuite-desktop#89). */
  notify?: (r: LocalRecording, how: 'ready' | 'failed') => void;
  /** Opens a file in the system's own application. */
  openPath?: (path: string) => Promise<string>;
}

/** Downloads of Meet recordings kept per person, by recording: the newest few. */
const MAX_DOWNLOADS = 100;

/** A file name from a meeting's title and when it started: nothing a file system refuses. */
export function recordingFileName(title: string, at: Date, ext: string): string {
  const safe = title.replace(/[\\/:*?"<>|\p{C}]+/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Meeting';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${safe} ${at.getFullYear()}-${p(at.getMonth() + 1)}-${p(at.getDate())} ${p(at.getHours())}${p(at.getMinutes())}${p(at.getSeconds())}${ext}`;
}

/**
 * Meetings recorded on this computer (worksuite-desktop#68): Recording → Processing → Uploading → Ready.
 *
 * The meeting's window records and hands the pieces over as it goes; this process writes them to the chosen folder
 * at once, so a crash or a closed window loses at most the last few seconds. When the recording stops it is finished
 * here — given its length, so players can seek — and uploaded to the recorder's Drive in the background, resumably:
 * leaving the meeting, closing its window or restarting WorkSuite does not stop it, and a restart continues the same
 * upload rather than starting a second file. The local copy is deleted only after the server has the whole file, and
 * then only as the person chose.
 *
 * Every step is told to the server for the meeting (`/api/meet/{uuid}/recordings/local`), keyed by this recording's
 * own id, so the others in the meeting know it is being recorded and the meeting's details find it.
 */
export class MeetRecorder {
  private entries: Entry[] = [];
  private loadedFor: string | null = null;
  /** Each recording's writes, one after another. */
  private writes = new Map<string, Promise<void>>();
  private saveTimer: NodeJS.Timeout | null = null;
  onChanged: (list: LocalRecording[]) => void = () => undefined;

  constructor(private readonly deps: MeetRecorderDeps) {}

  // ── the ledger ─────────────────────────────────────────────────────────

  private key(): string | null {
    const uid = this.deps.userId();
    return uid ? `meet-recordings:${uid}` : null;
  }

  private downloadsKey(): string | null {
    const uid = this.deps.userId();
    return uid ? `meet-recording-downloads:${uid}` : null;
  }

  /**
   * A Meet recording's download (worksuite-desktop#89): which transfer has it, kept so the recording shows
   * Downloading and then Downloaded — with Open and Show in folder — wherever it is listed, also after a restart.
   */
  rememberDownload(recordingId: number, transferId: string): void {
    const key = this.downloadsKey();
    if (!key) return;
    const all = { ...(this.deps.db.getConfig<Record<string, string>>(key) ?? {}) };
    delete all[String(recordingId)];
    all[String(recordingId)] = transferId;
    const keep = Object.entries(all).slice(-MAX_DOWNLOADS);
    this.deps.db.setConfig(key, Object.fromEntries(keep));
  }

  downloads(): Record<string, string> {
    const key = this.downloadsKey();
    return key ? (this.deps.db.getConfig<Record<string, string>>(key) ?? {}) : {};
  }

  private load(): void {
    const uid = this.deps.userId();
    if (this.loadedFor === uid) return;
    this.loadedFor = uid;
    const key = this.key();
    this.entries = key ? (this.deps.db.getConfig<Entry[]>(key) ?? []) : [];
  }

  private save(now = true): void {
    if (!now) {
      if (this.saveTimer) return;
      this.saveTimer = setTimeout(() => {
        this.saveTimer = null;
        this.save();
      }, 5_000);
      this.saveTimer.unref?.();
      return;
    }
    const key = this.key();
    if (key) this.deps.db.setConfig(key, this.entries);
    this.onChanged(this.list());
  }

  list(): LocalRecording[] {
    this.load();
    return this.entries.map(({ path: _p, transferId, ...view }) => ({
      ...view,
      stepAt: view.stepAt ?? (view.state === 'recording' ? view.startedAt : view.endedAt),
      transferId: transferId ?? null,
      uploaded: view.state === 'uploading' && transferId ? (this.deps.transfers.uploadStatus(transferId)?.bytes ?? view.uploaded) : view.uploaded,
    }));
  }

  /** Being finished or uploaded: what quitting would pause. */
  pending(): { recording: number; working: number } {
    this.load();
    return {
      recording: this.entries.filter((e) => ['starting', 'recording'].includes(e.state)).length,
      working: this.entries.filter((e) => e.state === 'processing' || e.state === 'uploading').length,
    };
  }

  private entry(id: string): Entry {
    this.load();
    const e = this.entries.find((x) => x.id === id);
    if (!e) throw new DesktopError('NOT_FOUND', 'That recording is no longer on this computer.');
    return e;
  }

  private set(e: Entry, patch: Partial<Entry>, now = true): void {
    // When each step began, so one that goes on far too long can be said to be stuck (worksuite-desktop#89).
    if (patch.state && patch.state !== e.state) patch = { ...patch, stepAt: new Date().toISOString() };
    Object.assign(e, patch);
    this.save(now);
  }

  private view(e: Entry): LocalRecording {
    return this.list().find((x) => x.id === e.id) ?? { ...e };
  }

  /** Tell the server a step; it keeps the meeting's list and tells the others. Never stops the recording. */
  private async tell(e: Entry, action: 'prepare' | 'active' | 'start' | 'stop' | 'uploading' | 'ready' | 'failed', extra: Record<string, unknown> = {}): Promise<unknown> {
    return this.deps.http.post(`/api/meet/${e.meeting}/recordings/local`, { client_id: e.id, action, ...extra });
  }

  // ── recording ──────────────────────────────────────────────────────────

  /** Whether a recording can start here now: the folder, and the room on its disk. */
  async preflight(): Promise<{ folder: string; free: number | null; ok: boolean; why: string | null }> {
    const folder = this.deps.prefs().localFolder;
    try {
      await mkdir(folder, { recursive: true });
    } catch {
      return { folder, free: null, ok: false, why: `WorkSuite cannot write to ${folder}. Choose another folder in Settings › Meet › Recording.` };
    }
    const free = await (this.deps.freeSpace ?? freeBytes)(folder);
    if (free !== null && free < MIN_FREE) {
      return { folder, free, ok: false, why: `There is only ${(free / 1024 ** 3).toFixed(1)} GB free where recordings are saved. Free up space or choose another folder in Settings › Meet › Recording.` };
    }
    return { folder, free, ok: true, why: null };
  }

  async start(input: { meeting: string; title: string; layout: string; mime: string }): Promise<{ id: string }> {
    this.load();
    const check = await this.preflight();
    if (!check.ok) throw new DesktopError('POLICY_DENIED', check.why ?? 'A recording cannot start now.');
    const ext = input.mime.startsWith('video/mp4') ? '.mp4' : '.webm';
    const now = new Date();
    let name = recordingFileName(input.title, now, ext);
    for (let i = 2; this.entries.some((x) => x.fileName === name); i++) name = recordingFileName(`${input.title} (${i})`, now, ext);
    const e: Entry = {
      id: randomUUID(),
      meeting: input.meeting,
      title: input.title.slice(0, 190) || 'Meeting',
      state: 'starting',
      error: null,
      failedAt: null,
      bytes: 0,
      uploaded: 0,
      startedAt: now.toISOString(),
      endedAt: null,
      durationMs: null,
      fileName: name,
      driveFileId: null,
      deleteAfter: null,
      recovered: false,
      stepAt: now.toISOString(),
      path: join(check.folder, `${name}.part`),
      transferId: null,
    };
    // The server decides who may record, and tells everybody in the meeting; nothing is written before it agrees.
    try {
      await this.tell(e, 'prepare', { title: e.title, layout: input.layout });
    } catch (err) {
      throw isDesktopError(err) ? err : new DesktopError('SERVER_ERROR', 'WorkSuite could not start the recording.');
    }
    try { await writeFile(e.path, Buffer.alloc(0), { flag: 'wx', mode: 0o600 }); }
    catch (error) { await this.tell(e, 'failed', { error: 'The recording file could not be created. Check disk access and free space.' }).catch(() => undefined); throw error; }
    this.entries.unshift(e);
    this.save();
    log.info('local recording started', { id: e.id });
    return { id: e.id };
  }

  async active(id: string): Promise<void> {
    const e = this.entry(id);
    if (e.state !== 'starting') return;
    await this.tell(e, 'active');
    this.set(e, { state: 'recording', startedAt: new Date().toISOString() });
  }

  async abort(id: string): Promise<void> {
    const e = this.entry(id);
    if (e.state !== 'starting' && !['starting', 'recording'].includes(e.state)) return;
    this.fail(e, 'recording', 'Recording startup failed or was cancelled. Check permissions and retry.');
    await this.tell(e, 'failed', { error: e.error });
  }

  /** A piece of the recording, written at once. */
  chunk(id: string, data: Uint8Array): Promise<void> {
    const e = this.entry(id);
    if (!['starting', 'recording'].includes(e.state)) throw new DesktopError('IPC_VALIDATION_FAILED', 'That recording has stopped.');
    if (data.byteLength > MAX_CHUNK) throw new DesktopError('IPC_VALIDATION_FAILED', 'That piece is too large.');
    const prev = this.writes.get(id) ?? Promise.resolve();
    const next = prev.then(async () => {
      await appendFile(e.path, data);
      this.set(e, { bytes: e.bytes + data.byteLength }, false);
    });
    this.writes.set(
      id,
      next.catch((err) => {
        log.warn('a recording piece was not written', { id, error: String(err) });
        this.set(e, { error: 'Part of the recording could not be written to disk. Check the free space.' });
      }),
    );
    return next;
  }

  async stop(id: string, durationMs: number): Promise<void> {
    const e = this.entry(id);
    if (!['starting', 'recording'].includes(e.state)) {
      if (e.endedAt) await this.tell(e, 'stop', { duration: Math.round((e.durationMs ?? 0) / 1000) });
      return;
    }
    await this.writes.get(id)?.catch(() => undefined);
    this.writes.delete(id);
    this.set(e, { state: 'processing', endedAt: new Date().toISOString(), durationMs: Math.max(0, Math.round(durationMs)) || null });
    try { await this.tell(e, 'stop', { duration: Math.round((e.durationMs ?? 0) / 1000) }); }
    finally { void this.process(e); }
  }

  // ── after: processing, uploading, checking ──────────────────────────────

  /** Give it its length and its final name. */
  private async process(e: Entry): Promise<void> {
    this.set(e, { state: 'processing', error: null, failedAt: null });
    try {
      if (e.path.endsWith('.part')) {
        const final = e.path.slice(0, -'.part'.length);
        const st = await stat(e.path);
        if (st.size === 0) throw new DesktopError('SERVER_ERROR', 'Nothing was recorded: the file is empty.');
        let fixed: ReturnType<typeof withDuration> = null;
        if (extname(final) === '.webm' && e.durationMs) {
          const fh = await open(e.path, 'r');
          try {
            const head = Buffer.alloc(Math.min(HEAD, st.size));
            await fh.read(head, 0, head.length, 0);
            fixed = withDuration(head, e.durationMs);
          } finally {
            await fh.close();
          }
        }
        if (fixed) {
          await writeFile(final, fixed.bytes, { mode: 0o600 });
          await pipeline(createReadStream(e.path, { start: fixed.replaces }), createWriteStream(final, { flags: 'a' }));
          await rm(e.path, { force: true });
        } else await rename(e.path, final);
        this.set(e, { path: final, fileName: basename(final), bytes: (await stat(final)).size });
      }
      // Ready to play means it plays (worksuite-desktop#89): a file that is not a whole video is not sent at all.
      const problem = await videoProblem(e.path);
      if (problem) {
        this.fail(e, 'processing', `${problem} The file is kept on this computer; Show the file to look at it.`);
        return;
      }
      await this.upload(e);
    } catch (err) {
      this.fail(e, 'processing', `The recording could not be finished on this computer: ${(err as Error).message}. It is kept; try again.`);
    }
  }

  private async upload(e: Entry): Promise<void> {
    this.set(e, { state: 'uploading', error: null, failedAt: null, uploaded: 0 });
    try {
      void this.tell(e, 'uploading').catch(() => undefined);
      const prefs = this.deps.prefs();
      const folder = await this.deps.http.post<{ id: number }>('/api/meet/recordings/folder', { name: prefs.folder, meeting: e.meeting, client_id: e.id });
      const transferId = await this.deps.transfers.uploadOwn(e.path, e.fileName ?? basename(e.path), { kind: 'files', folderId: String(folder.id), name: e.fileName ?? basename(e.path) });
      this.set(e, { transferId });
      this.await(e, transferId);
    } catch (err) {
      this.fail(e, 'uploading', `The recording could not be uploaded: ${(err as Error).message}. It is kept on this computer; try again when you are connected.`);
    }
  }

  private await(e: Entry, transferId: string): void {
    this.deps.transfers.whenUploaded(transferId, (out) => {
      // Cancelled by the person: nothing to tell them, and the recording stays on this computer.
      if ('error' in out && this.deps.transfers.uploadStatus(transferId)?.state === 'cancelled') this.fail(e, 'uploading', 'The upload was cancelled. The recording is kept on this computer; Try again to upload it.', false);
      else if ('error' in out) this.fail(e, 'uploading', `The upload stopped: ${out.error}. It continues from where it was when you try again.`);
      else if (!out.fileId) this.fail(e, 'uploading', 'The file reached WorkSuite, but WorkSuite did not say where it is. Try again.');
      else void this.register(e, Number(out.fileId));
    });
  }

  /** The server confirms it has the whole file in Drive; then the local copy is kept or deleted as chosen. */
  private async register(e: Entry, fileId: number): Promise<void> {
    try {
      const local = await stat(e.path).then((s) => s.size).catch(() => null);
      const r = await this.tell(e, 'ready', { file_id: fileId, duration: Math.round((e.durationMs ?? 0) / 1000) || undefined });
      const size = (r as { size?: number } | null)?.size ?? null;
      if (local !== null && size !== null && size !== local) {
        this.fail(e, 'registering', 'The copy in Drive is not the same size as the recording here. The local copy is kept; try again.');
        return;
      }
      const keep = this.deps.prefs().keepLocal;
      this.set(e, { state: 'ready', driveFileId: fileId, error: null, failedAt: null, transferId: null, deleteAfter: keep === '7' || keep === '30' ? new Date(Date.now() + Number(keep) * DAY).toISOString() : null });
      if (keep === 'delete') await this.removeLocal(e);
      log.info('local recording in Drive', { id: e.id, fileId });
      this.deps.notify?.(this.view(e), 'ready');
    } catch (err) {
      this.set(e, { driveFileId: fileId });
      this.fail(e, 'registering', `The recording is in your Drive, but the meeting could not be told: ${(err as Error).message}. Try again.`);
    }
  }

  /** A step failed. The local file is never touched here: whatever went wrong, the recording stays recoverable. */
  private fail(e: Entry, at: NonNullable<LocalRecording['failedAt']>, message: string, tellPerson = true): void {
    log.warn('local recording step failed', { id: e.id, at, error: message });
    this.set(e, { state: 'failed', failedAt: at, error: message });
    void this.tell(e, 'failed', { error: message }).catch(() => undefined);
    if (tellPerson) this.deps.notify?.(this.view(e), 'failed');
  }

  /** Try a failed step again, from where it stopped. */
  async retry(id: string): Promise<void> {
    const e = this.entry(id);
    if (e.state !== 'failed') return;
    if (e.failedAt === 'processing' || e.failedAt === 'recording') return this.process(e);
    if (e.failedAt === 'registering' && e.driveFileId) return this.register(e, e.driveFileId);
    // The same upload, from where it got to — never a second file.
    const t = e.transferId ? this.deps.transfers.uploadStatus(e.transferId) : null;
    if (e.transferId && t?.state === 'done' && t.fileId) return this.register(e, Number(t.fileId));
    if (e.transferId && t && (t.state === 'paused' || t.state === 'failed')) {
      this.set(e, { state: 'uploading', error: null, failedAt: null });
      this.await(e, e.transferId);
      this.deps.transfers.resume(e.transferId);
      return;
    }
    return this.upload(e);
  }

  /** Delete the local copy (and the entry): never while recording, never before Drive has it unless asked. */
  async discard(id: string): Promise<void> {
    const e = this.entry(id);
    if (['starting', 'recording'].includes(e.state) || e.state === 'uploading' || e.state === 'processing') throw new DesktopError('IPC_VALIDATION_FAILED', 'Wait until it has finished, or stop the upload first.');
    await this.removeLocal(e);
    this.entries = this.entries.filter((x) => x.id !== id);
    this.save();
  }

  reveal(id: string): void {
    const e = this.entry(id);
    if (e.fileName) shell.showItemInFolder(e.path);
  }

  /** Play the copy on this computer in the system's player — only once it is a whole file, never one being written. */
  async openLocal(id: string): Promise<boolean> {
    const e = this.entry(id);
    if (!e.fileName || ['starting', 'recording'].includes(e.state) || e.path.endsWith('.part')) throw new DesktopError('NOT_FOUND', 'There is no finished copy of this recording on this computer.');
    const failed = await (this.deps.openPath ?? ((p: string) => shell.openPath(p)))(e.path);
    if (failed) throw new DesktopError('NOT_FOUND', 'The recording could not be opened. It may have been moved or deleted.');
    return true;
  }

  private async removeLocal(e: Entry): Promise<void> {
    await rm(e.path, { force: true }).catch(() => undefined);
    this.set(e, { fileName: null, deleteAfter: null });
  }

  /**
   * After signing in: carry on where WorkSuite left off. A recording that was still being written when WorkSuite
   * closed is finished with what reached the disk; processing and uploads continue; local copies past their time go.
   */
  async recover(): Promise<void> {
    this.loadedFor = null;
    this.load();
    for (const e of this.entries) {
      try {
        if (['starting', 'recording'].includes(e.state)) {
          this.set(e, { recovered: true, endedAt: e.endedAt ?? new Date().toISOString(), durationMs: e.durationMs ?? Math.max(0, Date.now() - Date.parse(e.startedAt)) });
          void this.tell(e, 'stop').catch(() => undefined);
          void this.process(e);
        } else if (e.state === 'processing') void this.process(e);
        else if (e.state === 'uploading') {
          const t = e.transferId ? this.deps.transfers.uploadStatus(e.transferId) : null;
          if (e.transferId && t?.state === 'done' && t.fileId) void this.register(e, Number(t.fileId));
          else if (e.transferId && t && t.state !== 'cancelled') {
            this.await(e, e.transferId);
            // A deliberate pause survives restart; only an interrupted running job resumes.
            if (t.state !== 'paused') this.deps.transfers.resume(e.transferId);
          } else void this.upload(e);
        }
      } catch (err) {
        log.warn('a recording could not be carried on', { id: e.id, error: String(err) });
      }
    }
    await this.sweep();
  }

  /** Local copies whose time is up, as the retention setting said when they reached Drive. */
  async sweep(now = Date.now()): Promise<void> {
    this.load();
    for (const e of this.entries) if (e.state === 'ready' && e.fileName && e.deleteAfter && Date.parse(e.deleteAfter) <= now) await this.removeLocal(e);
  }
}

async function freeBytes(dir: string): Promise<number | null> {
  const fs = await statfs(dir).catch(() => null);
  return fs ? fs.bavail * fs.bsize : null;
}

import { execFile, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, existsSync, openAsBlob } from 'node:fs';
import { stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { copyHasUnsentEdits, EXTERNAL_APP_LABELS, keepBothName, microsoftAppFor, type ExternalApp, type ExternalAppId, type OfficeLocalCopy, type OfficeUploadHow } from '@shared/office';
import { DesktopError, isDesktopError } from '../main/errors';
import { logger } from '../main/log';
import type { Database } from './db';
import type { HttpClient } from './http';
import type { DownloadOutcome } from './transfers';
import type { Vault } from './vault';

const log = logger('office-external');

/** Where a Microsoft app lives on this computer, by what it edits. */
const MAC_BUNDLES: Record<Exclude<ExternalAppId, 'default'>, string> = {
  word: 'Microsoft Word.app',
  excel: 'Microsoft Excel.app',
  powerpoint: 'Microsoft PowerPoint.app',
};
const WIN_EXES: Record<Exclude<ExternalAppId, 'default'>, string> = {
  word: 'WINWORD.EXE',
  excel: 'EXCEL.EXE',
  powerpoint: 'POWERPNT.EXE',
};

/**
 * `reg query "…\App Paths\WINWORD.EXE" /ve` → the program's path, when the
 * answer names that program. `%ProgramFiles%`-style values are expanded.
 */
export function parseAppPath(output: string, exe: string, env: Record<string, string | undefined> = process.env): string | null {
  for (const line of output.split(/\r?\n/)) {
    const m = /^\s*\(Default\)\s+REG_(?:EXPAND_)?SZ\s+(.+?)\s*$/i.exec(line);
    if (!m) continue;
    const value = m[1]!.replace(/^"(.*)"$/, '$1').replace(/%([A-Za-z0-9_()]+)%/g, (_all, name: string) => env[name] ?? `%${name}%`);
    if (value.toUpperCase().endsWith(`\\${exe.toUpperCase()}`) && !value.includes('%')) return value;
  }
  return null;
}

/** Where to look for a Mac app: the computer's Applications folder, then the person's own. */
export function macAppCandidates(app: Exclude<ExternalAppId, 'default'>, home: string): string[] {
  return [join('/Applications', MAC_BUNDLES[app]), join(home, 'Applications', MAC_BUNDLES[app])];
}

export interface OfficeExternalDeps {
  db: Database;
  vault: () => Vault;
  http: HttpClient;
  userId: () => string | null;
  platform: string;
  home: string;
  /** The desktop policy lets files be opened in other apps (`desktop.files.open_external`). */
  canOpenFiles: () => boolean;
  /** Drive sync's copy of this file on this computer, if sync keeps one. */
  syncedPath: (fileId: number) => string | null;
  /** A download through the download manager (it shows in Transfers); `then` hears how it ended. */
  download: (fileId: number, name: string, then: (outcome: DownloadOutcome) => void) => Promise<void>;
  /** A local file up to Drive as a new file beside the original (Keep Both), through the upload manager. */
  uploadNew: (path: string, name: string, folderId: number | null) => Promise<void>;
  /** Opens a path with the system's default app (`shell.openPath`): '' when it worked. */
  openPath: (path: string) => Promise<string>;
  /** Runs a program with arguments, no shell (tests replace it). */
  run?: (file: string, args: string[]) => Promise<string>;
  exists?: (path: string) => boolean;
  audit: (action: string, details: Record<string, unknown>) => void;
  /** The list changed: the tabs and Files show it. */
  onChanged: (copies: OfficeLocalCopy[]) => void;
  /** A new version was refused because the account's storage is full (Cloud's QUOTA_EXCEEDED): ask Cloud more often. */
  onQuota?: () => void;
  pollMs?: number;
}

interface Stored extends OfficeLocalCopy {
  path: string | null;
  sha256: string | null;
  size: number;
  mtimeMs: number;
  misses: number;
}

const WATCHED = new Set(['open', 'uploaded']);

/** Why a copy with edits waiting cannot go back. */
export const GONE_MESSAGE = 'The file no longer exists on this computer.';

/** Screen 13's promise, on a copy whose new version the account's full storage refused. */
export const QUOTA_COPY_MESSAGE = 'Your storage is full. Your edits are safe on this computer and upload as a new version as soon as there is room.';

function runFile(file: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout: 15_000, windowsHide: true }, (err, stdout) => (err ? reject(err) : resolve(String(stdout))));
  });
}

async function sha256(path: string): Promise<string> {
  const h = createHash('sha256');
  await new Promise<void>((resolve, reject) => {
    createReadStream(path)
      .on('data', (c) => h.update(c))
      .on('end', () => resolve())
      .on('error', reject);
  });
  return h.digest('hex');
}

/**
 * OfficeExternalAppService (SRS §7.1, OO-DSK-050, OO-OFF-030/031/040).
 *
 * "Open in Microsoft Word / Excel / PowerPoint" or the system's default app.
 * A file Drive sync keeps on this computer opens where sync keeps it: its
 * changes go back through sync and sync's own conflict engine (OO-DSK-051,
 * OO-OFF-032). Any other file is downloaded through the download manager
 * into the downloads folder and opened there; the copy is watched, and when
 * it changes the person is asked — nothing goes back on its own. Going back
 * is `POST /api/files/{id}/versions` with `base_version`, the version the
 * copy was made from; when Drive has moved on, the server's conflict
 * ("The cloud file changed while you were editing.") comes back with Keep
 * Both, Review, Upload as New Version and Cancel, and nothing is replaced
 * until the person chooses.
 */
export class OfficeExternal {
  private copies: Stored[] = [];
  private loadedFor: string | null = null;
  private timer: NodeJS.Timeout | null = null;
  private checking = false;
  private detected: Map<ExternalAppId, string> | null = null;

  constructor(private readonly deps: OfficeExternalDeps) {}

  private get exists(): (p: string) => boolean {
    return this.deps.exists ?? existsSync;
  }

  private get run(): (file: string, args: string[]) => Promise<string> {
    return this.deps.run ?? runFile;
  }

  // ── which apps ─────────────────────────────────────────────────────────

  /** The Microsoft apps on this computer, by where they are (found once per run). */
  private async detect(): Promise<Map<ExternalAppId, string>> {
    if (this.detected) return this.detected;
    const found = new Map<ExternalAppId, string>();
    for (const app of ['word', 'excel', 'powerpoint'] as const) {
      try {
        if (this.deps.platform === 'darwin') {
          const hit = macAppCandidates(app, this.deps.home).find((p) => this.exists(p));
          if (hit) found.set(app, hit);
        } else if (this.deps.platform === 'win32') {
          for (const hive of ['HKLM', 'HKCU']) {
            const out = await this.run('reg', ['query', `${hive}\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${WIN_EXES[app]}`, '/ve']).catch(() => '');
            const path = parseAppPath(out, WIN_EXES[app]);
            if (path && this.exists(path)) {
              found.set(app, path);
              break;
            }
          }
        }
      } catch (e) {
        log.debug('app detection failed', { app, error: String(e) });
      }
    }
    this.detected = found;
    return found;
  }

  /** "Open in Microsoft Word" where Word is here, and always the default app (OO-DRV-030). */
  async apps(extension: string): Promise<ExternalApp[]> {
    const out: ExternalApp[] = [];
    const ms = microsoftAppFor(extension);
    if (ms && (await this.detect()).has(ms)) out.push({ id: ms, label: EXTERNAL_APP_LABELS[ms] });
    out.push({ id: 'default', label: EXTERNAL_APP_LABELS.default });
    return out;
  }

  private async launch(app: ExternalAppId, path: string): Promise<void> {
    if (app === 'default') {
      const err = await this.deps.openPath(path);
      if (err) throw new DesktopError('INTERNAL', `No app on this computer opened ${basename(path)}: ${err}`);
      return;
    }
    const where = (await this.detect()).get(app);
    if (!where) throw new DesktopError('UNSUPPORTED', `${EXTERNAL_APP_LABELS[app]} is not installed on this computer.`);
    if (this.deps.platform === 'darwin') {
      await this.run('open', ['-a', where, path]);
      return;
    }
    // Windows: the program itself, with the file as its one argument; no shell in between.
    const child = spawn(where, [path], { detached: true, stdio: 'ignore', windowsHide: false });
    child.on('error', (e) => log.warn('external app did not start', { app, error: String(e) }));
    child.unref();
  }

  // ── the copies ─────────────────────────────────────────────────────────

  private key(uid: string): string {
    return `office_local_copies:${uid}`;
  }

  private load(): Stored[] {
    const uid = this.deps.userId();
    if (!uid) return [];
    if (this.loadedFor !== uid) {
      const stored = this.deps.db.getConfig<string>(this.key(uid));
      this.copies = (stored ? this.deps.vault().decrypt<Stored[]>(stored) : undefined) ?? [];
      this.loadedFor = uid;
      if (this.tidy()) this.save();
      this.schedule();
    }
    return this.copies;
  }

  /**
   * The list as it is read (each start, each account): rows that stood for nothing are let go, and two rows for one
   * Drive file become one. Only the list changes — no file on this computer is touched, so edits not sent are never
   * lost: a copy with edits waiting is always the row kept.
   *  - a download that failed and was never edited here (`failed`, no changedAt): nothing to send;
   *  - an older row for a file that has a newer one (the same file opened again before the fix that replaced it).
   * A copy with edits waiting whose file is gone keeps its row, with why it cannot be sent, so the person can see it
   * and discard it.
   */
  private tidy(): boolean {
    const before = this.copies.length;
    const kept: Stored[] = [];
    const seen = new Map<string, Stored>();
    let dropped = 0;
    let duplicates = 0;
    let gone = 0;
    for (const c of this.copies) {
      if (c.state === 'failed' && !c.changedAt) {
        dropped++;
        continue;
      }
      // An upload interrupted by quitting is not running any more: back to "changed", to be sent again.
      if (c.state === 'uploading') c.state = 'changed';
      if (copyHasUnsentEdits(c) && c.path && !this.exists(c.path) && c.error !== GONE_MESSAGE) {
        c.error = GONE_MESSAGE;
        gone++;
      }
      const key = c.syncOwned ? `s:${c.fileId}` : `f:${c.fileId}`;
      const had = seen.get(key);
      if (had) {
        duplicates++;
        // Keep the one with edits waiting; between equals, the newer.
        const better = copyHasUnsentEdits(c) && !copyHasUnsentEdits(had) ? c : copyHasUnsentEdits(had) && !copyHasUnsentEdits(c) ? had : (c.updatedAt ?? '') > (had.updatedAt ?? '') ? c : had;
        if (better === c) kept[kept.indexOf(had)] = c;
        seen.set(key, better);
        continue;
      }
      seen.set(key, c);
      kept.push(c);
    }
    this.copies = kept;
    if (dropped || duplicates || gone) log.info('local copies tidied', { before, after: kept.length, failedDownloads: dropped, duplicates, missingFiles: gone });
    return dropped > 0 || duplicates > 0 || gone > 0 || kept.length !== before;
  }

  private save(): void {
    const uid = this.deps.userId();
    if (!uid || this.loadedFor !== uid) return;
    this.deps.db.setConfig(this.key(uid), this.deps.vault().encrypt(this.copies));
    this.deps.onChanged(this.list());
  }

  private view(c: Stored): OfficeLocalCopy {
    return {
      id: c.id,
      fileId: c.fileId,
      name: c.name,
      folderId: c.folderId,
      baseVersion: c.baseVersion,
      app: c.app,
      state: c.state,
      syncOwned: c.syncOwned,
      error: c.error,
      conflict: c.conflict,
      changedAt: c.changedAt,
      updatedAt: c.updatedAt,
    };
  }

  list(): OfficeLocalCopy[] {
    return this.load().map((c) => this.view(c));
  }

  private find(id: string): Stored {
    const c = this.load().find((x) => x.id === id);
    if (!c) throw new DesktopError('NOT_FOUND', 'That copy is no longer on this computer.');
    return c;
  }

  private touch(c: Stored, patch: Partial<Stored>): void {
    Object.assign(c, patch, { updatedAt: new Date().toISOString() });
    this.save();
  }

  /**
   * Opens a Drive file in another app on this computer. `version` is the
   * Drive version being opened: an edited copy goes back against it.
   */
  async open(spec: { fileId: number; name: string; folderId: number | null; version: number; app: ExternalAppId }): Promise<OfficeLocalCopy> {
    if (!this.deps.canOpenFiles()) throw new DesktopError('POLICY_DENIED', 'Your organization does not allow opening files in other applications.');
    const ext = spec.name.includes('.') ? spec.name.split('.').pop()! : '';
    if (!(await this.apps(ext)).some((a) => a.id === spec.app)) throw new DesktopError('UNSUPPORTED', `${EXTERNAL_APP_LABELS[spec.app]} is not installed on this computer.`);
    const copies = this.load();
    const now = new Date().toISOString();
    this.deps.audit('office.open_external', { file_id: spec.fileId, app: spec.app });

    // Drive sync keeps it here: open sync's copy; sync takes the changes back.
    const synced = this.deps.syncedPath(spec.fileId);
    if (synced) {
      await this.launch(spec.app, synced);
      const c: Stored = { id: randomUUID(), fileId: spec.fileId, name: spec.name, folderId: spec.folderId, baseVersion: spec.version, app: spec.app, state: 'open', syncOwned: true, error: null, conflict: null, changedAt: null, updatedAt: now, path: synced, sha256: null, size: 0, mtimeMs: 0, misses: 0 };
      this.copies = [c, ...copies.filter((x) => !(x.fileId === spec.fileId && x.syncOwned))].slice(0, 50);
      this.save();
      return this.view(c);
    }

    // A copy already here (with edits waiting, perhaps) opens again rather than being downloaded over.
    const mine = copies.find((x) => x.fileId === spec.fileId && !x.syncOwned && x.path && this.exists(x.path) && ['open', 'changed', 'uploaded', 'conflict', 'quota'].includes(x.state));
    if (mine?.path) {
      await this.launch(spec.app, mine.path);
      this.touch(mine, { app: spec.app });
      return this.view(mine);
    }

    const c: Stored = { id: randomUUID(), fileId: spec.fileId, name: spec.name, folderId: spec.folderId, baseVersion: spec.version, app: spec.app, state: 'downloading', syncOwned: false, error: null, conflict: null, changedAt: null, updatedAt: now, path: null, sha256: null, size: 0, mtimeMs: 0, misses: 0 };
    this.copies = [c, ...copies.filter((x) => x.fileId !== spec.fileId || x.syncOwned)].slice(0, 50);
    this.save();
    await this.deps.download(spec.fileId, spec.name, (outcome) => void this.downloaded(c.id, outcome));
    return this.view(c);
  }

  private async downloaded(id: string, outcome: DownloadOutcome): Promise<void> {
    const c = this.load().find((x) => x.id === id);
    if (!c) return;
    if ('error' in outcome) {
      this.touch(c, { state: 'failed', error: outcome.error });
      return;
    }
    try {
      const st = await stat(outcome.path);
      this.touch(c, { path: outcome.path, sha256: await sha256(outcome.path), size: st.size, mtimeMs: st.mtimeMs, state: 'open', error: null });
      await this.launch(c.app, outcome.path);
    } catch (e) {
      this.touch(c, { state: 'failed', error: isDesktopError(e) ? e.message : String((e as Error).message ?? e) });
    }
    this.schedule();
  }

  // ── watching ───────────────────────────────────────────────────────────

  private schedule(): void {
    const watching = this.copies.some((c) => !c.syncOwned && WATCHED.has(c.state));
    if (watching && !this.timer) {
      this.timer = setInterval(() => void this.check(), this.deps.pollMs ?? 4000);
      this.timer.unref?.();
    } else if (!watching && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** A watched copy whose bytes changed is "changed": the person decides what happens to it. */
  async check(): Promise<void> {
    if (this.checking) return;
    this.checking = true;
    try {
      for (const c of this.load()) {
        if (c.syncOwned || !WATCHED.has(c.state) || !c.path) continue;
        const st = await stat(c.path).catch(() => null);
        if (!st) {
          // An app saving by replacing the file leaves a moment with no file: only a copy gone for a while is missing.
          c.misses += 1;
          if (c.misses >= 4) this.touch(c, { state: 'missing', error: 'The copy on this computer was moved or deleted.' });
          continue;
        }
        c.misses = 0;
        if (st.size === c.size && st.mtimeMs === c.mtimeMs) continue;
        const hash = await sha256(c.path).catch(() => null);
        if (!hash) continue;
        if (hash === c.sha256) {
          Object.assign(c, { size: st.size, mtimeMs: st.mtimeMs });
          continue;
        }
        this.touch(c, { state: 'changed', changedAt: new Date().toISOString(), size: st.size, mtimeMs: st.mtimeMs, sha256: hash });
      }
    } finally {
      this.checking = false;
      this.schedule();
    }
  }

  // ── going back ─────────────────────────────────────────────────────────

  /**
   * Takes an edited copy back to Drive, as the person chose:
   *  - `version`: a new version, against the version the copy was made from;
   *  - `new_version`: a new version on purpose, over the one Drive has now (after a conflict);
   *  - `keep_both`: a new file beside the original.
   */
  async upload(id: string, how: OfficeUploadHow): Promise<{ state: 'uploaded'; version: number | null } | { state: 'conflict'; conflict: NonNullable<OfficeLocalCopy['conflict']> } | { state: 'queued' }> {
    const c = this.find(id);
    if (c.syncOwned) throw new DesktopError('POLICY_DENIED', 'Drive sync takes this file’s changes back; nothing to upload.');
    if (!c.path || !this.exists(c.path)) {
      if (c.error !== GONE_MESSAGE) this.touch(c, { error: GONE_MESSAGE });
      throw new DesktopError('NOT_FOUND', GONE_MESSAGE);
    }
    if (how === 'keep_both') {
      await this.deps.uploadNew(c.path, keepBothName(c.name), c.folderId);
      this.touch(c, { state: 'uploaded', conflict: null, error: null });
      this.deps.audit('office.local_copy.kept_both', { file_id: c.fileId });
      return { state: 'queued' };
    }
    const base = how === 'new_version' && c.conflict ? c.conflict.serverVersion : c.baseVersion;
    this.touch(c, { state: 'uploading', error: null });
    try {
      const form = new FormData();
      form.set('file', await openAsBlob(c.path), c.name);
      form.set('base_version', String(base));
      const res = await this.deps.http.raw('POST', this.deps.http.url(`/api/files/${c.fileId}/versions`), { body: form, timeoutMs: 15 * 60_000 });
      const body = (await res.json().catch(() => null)) as { message?: string; code?: string; data?: { current?: { version?: number } }; errors?: Record<string, unknown> } | null;
      const errors = body?.errors ?? null;
      // The account's storage is full (Cloud): the edits stay here, in `quota`, and go up when there is room.
      if (body?.code === 'QUOTA_EXCEEDED' || errors?.code === 'QUOTA_EXCEEDED' || res.status === 507) {
        this.touch(c, { state: 'quota', error: QUOTA_COPY_MESSAGE });
        this.deps.audit('office.local_copy.quota', { file_id: c.fileId });
        this.deps.onQuota?.();
        throw new DesktopError('QUOTA_EXCEEDED', body?.message ?? 'Your storage is full.', res.status);
      }
      if (res.status === 409 && errors?.code === 'OFFICE_VERSION_CONFLICT') {
        const conflict = {
          message: body?.message ?? 'The cloud file changed while you were editing.',
          baseVersion: Number(errors.base_version ?? base),
          serverVersion: Number(errors.server_version ?? 0),
          actions: Array.isArray(errors.actions) ? errors.actions.map(String).slice(0, 8) : ['keep_both', 'review', 'upload_as_new_version', 'cancel'],
        };
        this.touch(c, { state: 'conflict', conflict });
        return { state: 'conflict', conflict };
      }
      if (!res.ok) throw new DesktopError(res.status >= 500 ? 'SERVER_ERROR' : 'INTERNAL', body?.message ?? `The server answered ${res.status}.`, res.status);
      const version = Number(body?.data?.current?.version ?? 0) || null;
      const st = await stat(c.path);
      this.touch(c, { state: 'uploaded', conflict: null, baseVersion: version ?? base + 1, sha256: await sha256(c.path), size: st.size, mtimeMs: st.mtimeMs, changedAt: null });
      this.deps.audit('office.local_copy.uploaded', { file_id: c.fileId, version });
      this.schedule();
      return { state: 'uploaded', version };
    } catch (e) {
      if (isDesktopError(e) && e.code === 'QUOTA_EXCEEDED') {
        if (c.state !== 'quota') this.touch(c, { state: 'quota', error: QUOTA_COPY_MESSAGE });
        throw e;
      }
      const message = isDesktopError(e) ? e.message : String((e as Error).message ?? e);
      this.touch(c, { state: 'changed', error: message });
      throw isDesktopError(e) ? e : new DesktopError('INTERNAL', message);
    }
  }

  /**
   * There is room again: each copy waiting in `quota` goes up as a new version, against the version it was made
   * from (a conflict comes back to be decided, as ever). One that cannot go up yet stays as it is.
   */
  async retryQuota(): Promise<number> {
    let sent = 0;
    for (const c of [...this.load()]) {
      if (c.state !== 'quota' || c.syncOwned) continue;
      try {
        await this.upload(c.id, 'version');
        sent++;
      } catch (e) {
        log.debug('copy still waiting for room', { error: String((e as Error)?.message ?? e) });
        if (isDesktopError(e) && e.code === 'QUOTA_EXCEEDED') break;
      }
    }
    return sent;
  }

  /**
   * Sync Now: every copy with edits waiting goes up as a new version, against the version it was made from. A
   * conflict is left for the person to decide (Files shows Keep Both / Upload as New Version); each one that could not
   * go is returned with why, and keeps that reason on its row for the sign-out list.
   */
  async syncPending(): Promise<{ sent: number; errors: Array<{ id: string; name: string; error: string }> }> {
    let sent = 0;
    const errors: Array<{ id: string; name: string; error: string }> = [];
    for (const c of [...this.load()]) {
      if (!copyHasUnsentEdits(c) || c.state === 'uploading') continue;
      if (c.state === 'conflict') {
        errors.push({ id: c.id, name: c.name, error: c.conflict?.message ?? 'The cloud file changed while you were editing.' });
        continue;
      }
      try {
        const r = await this.upload(c.id, 'version');
        if (r.state === 'conflict') errors.push({ id: c.id, name: c.name, error: r.conflict.message });
        else sent++;
      } catch (e) {
        const error = isDesktopError(e) ? e.message : String((e as Error)?.message ?? e);
        errors.push({ id: c.id, name: c.name, error });
        if (isDesktopError(e) && e.code === 'QUOTA_EXCEEDED') break;
      }
    }
    if (sent || errors.length) log.info('local copies synced', { sent, failed: errors.length });
    return { sent, errors };
  }

  /** Stop watching a copy; the file stays in the downloads folder (it is the person's). */
  forget(id: string): boolean {
    const before = this.load().length;
    this.copies = this.copies.filter((c) => c.id !== id);
    if (this.copies.length === before) return false;
    this.save();
    this.schedule();
    return true;
  }

  /** The copy's path, for Show in folder. */
  pathOf(id: string): string {
    const c = this.find(id);
    if (!c.path || !this.exists(c.path)) throw new DesktopError('NOT_FOUND', 'The copy on this computer was moved or deleted.');
    return c.path;
  }

  /** A copy of this file on this computer — sync's, or one downloaded for another app — for opening offline (OO-OFF-020). */
  localPath(fileId: number): { path: string; synced: boolean } | null {
    const synced = this.deps.syncedPath(fileId);
    if (synced && this.exists(synced)) return { path: synced, synced: true };
    const c = this.load().find((x) => x.fileId === fileId && x.path && this.exists(x.path));
    return c?.path ? { path: c.path, synced: false } : null;
  }

  /** Signing out or a wipe: nothing is watched for that person any more. */
  forgetUser(uid: string): void {
    this.deps.db.deleteConfig(this.key(uid));
    if (this.loadedFor === uid) {
      this.copies = [];
      this.loadedFor = null;
    }
    this.schedule();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.loadedFor = null;
    this.copies = [];
  }
}

import { createHash, randomBytes } from 'node:crypto';
import { watch, type FSWatcher } from 'node:fs';
import { access, constants, lstat, mkdir, open, readdir, realpath, rename, rmdir, stat, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import type { SyncActivity, SyncFolder, SyncFolderState, SyncIssue, SyncItemState, SyncLookup, SyncMode, SyncPolicy, SyncStatus } from '@shared/types';
import { conflictedCopyName, numberedName, safeFileName } from '@shared/filename';
import { mimeFor } from '@shared/mime';
import { DesktopError, isDesktopError } from '../../main/errors';
import { logger } from '../../main/log';
import type { Database } from '../db';
import type { HttpClient } from '../http';
import { scanLocal } from './local';
import { planContent, planMoves, type BaseItem, type ContentAction, type LocalItem, type MoveAction, type Picture, type RemoteItem } from './plan';
import { defaultPolicy, SyncProtocol } from './protocol';
import { listRemote } from './remote';
import { BLOCK_SIZE, JUNK, isUnder, joinRel, looksRemovable, makeKey, nameOf, parentOf } from './rules';
import { SyncStore, type SyncFolderRow } from './store';

const log = logger('drive-sync');

/**
 * DriveSync — keeps chosen Drive folders in step with folders on this
 * computer (WorkSuite Drive FR-SYN-01…06, WF-15).
 *
 * A PASS, for each folder: say hello (policy, pause, wipe); picture both
 * sides; carry moves across first so renamed files keep their ids; then plan
 * the content (plan.ts) and carry it out one action at a time, writing the
 * index after each, so a pass cut short resumes where it stopped.
 *
 * WHAT STARTS ONE: a change in the folder here (watched, then settled for a
 * few seconds), a change in Drive (the journal, polled every minute — it
 * excludes this computer's own writes), every five minutes regardless (the
 * journal does not record deletions or folders, and this is what catches
 * them), and "Sync now".
 *
 * THE SAFETY RULES, which win over speed every time:
 *   - nothing is overwritten that changed since it was looked at; a pass
 *     re-checks each file just before it touches it;
 *   - a conflict keeps both copies;
 *   - deletions go to a recycle bin — Drive's, or this computer's Trash;
 *   - a pass that would delete many files at once holds them until somebody
 *     confirms (a disk unplugged, or a folder emptied by mistake, looks
 *     exactly like a mass deletion);
 *   - a folder that is missing, on either side, stops that folder's sync
 *     rather than reading as "everything was deleted".
 */

export interface DriveSyncDeps {
  db: Database;
  http: HttpClient;
  platform: NodeJS.Platform;
  userId: () => string | null;
  userName: () => string;
  deviceToken: () => string | null;
  /** Policy and permission: may this computer sync at all, and if not, why. */
  allowed: () => { ok: boolean; reason: string | null };
  removableAllowed: () => boolean;
  hash: (path: string) => Promise<{ sha256: string; bytes: number }>;
  hashBlocks: (path: string) => Promise<{ sha256: string; bytes: number; blocks: string[] }>;
  /** To the operating system's Trash. */
  trash: (path: string) => Promise<void>;
  info: () => { app_version: string; os_version: string; hostname: string };
  audit: (action: string, details: Record<string, unknown>) => void;
  /** Where "~/WorkSuite Drive" is. */
  home?: () => string;
  /** Not to be synced into: the app's own data. */
  protectedPaths?: () => string[];
  settleMs?: number;
}

interface Runtime {
  state: SyncFolderState;
  pending: { up: number; down: number };
  issues: SyncIssue[];
  held: { side: 'computer' | 'drive'; rels: string[] } | null;
  confirmDeletes: boolean;
  watcher: FSWatcher | null;
}

interface PassStats {
  pulled: number;
  pushed: number;
  bytesUp: number;
  bytesDown: number;
  conflicts: number;
  sessionId: number | null;
  sessionTried: boolean;
}

const POLL_MS = 60_000;
const FULL_MS = 5 * 60_000;
const DEBOUNCE_MS = 2_500;
/** A block-protocol commit is assembled in the server's memory; beyond this, the chunked upload is used. */
const MAX_COMMIT_BLOCKS = 64;
const UPLOAD_CHUNK = 8 * 1024 * 1024;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export class DriveSync {
  readonly key: (rel: string) => string;
  private readonly store: SyncStore;
  private readonly protocol: SyncProtocol;
  private uid: string | null = null;
  private runtime = new Map<string, Runtime>();
  private activity: SyncActivity[] = [];
  private revision = 0;
  private cursor = 0;
  private deviceId: number | null = null;
  private policy: SyncPolicy | null = null;
  private state: SyncStatus['state'] = 'off';
  private message: string | null = null;
  private running: Promise<void> | null = null;
  private again = false;
  private abort: AbortController | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private fullTimer: NodeJS.Timeout | null = null;
  private debounce: NodeJS.Timeout | null = null;
  private emitTimer: NodeJS.Timeout | null = null;
  private pendingIds = new Set<number>();
  private lastError: string | null = null;
  /** Watching and polling on their own (start), or only when asked (attach). */
  private auto = false;
  /** Files held back as still being written, this pass; and how many quick follow-ups have been spent on them. */
  private unsettled = 0;
  private settleRetries = 0;
  private settleTimer: NodeJS.Timeout | null = null;
  onChanged: (s: SyncStatus) => void = () => undefined;

  constructor(private readonly deps: DriveSyncDeps) {
    this.key = makeKey(deps.platform === 'darwin' || deps.platform === 'win32');
    this.store = new SyncStore(deps.db, this.key);
    this.protocol = new SyncProtocol(deps.http, deps.deviceToken);
  }

  // ── lifecycle ──────────────────────────────────────────────────────────

  /** Signed in as `userId`; passes run only when asked. */
  attach(userId: string): void {
    this.stop();
    this.uid = userId;
    this.state = 'idle';
    this.message = null;
    this.emit();
  }

  /** Signed in, and syncing on its own: folders watched, Drive polled, a pass every five minutes. */
  start(userId: string): void {
    this.attach(userId);
    this.auto = true;
    for (const f of this.store.folders(userId)) this.watch(f);
    this.pollTimer = setInterval(() => void this.poll(), POLL_MS);
    this.pollTimer.unref?.();
    this.fullTimer = setInterval(() => this.kick('timer'), FULL_MS);
    this.fullTimer.unref?.();
    setTimeout(() => this.kick('start'), 3_000).unref?.();
    this.emit();
  }

  stop(): void {
    this.abort?.abort();
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.fullTimer) clearInterval(this.fullTimer);
    if (this.debounce) clearTimeout(this.debounce);
    if (this.settleTimer) clearTimeout(this.settleTimer);
    this.pollTimer = this.fullTimer = this.debounce = this.settleTimer = null;
    this.settleRetries = 0;
    for (const r of this.runtime.values()) r.watcher?.close();
    this.runtime.clear();
    this.pendingIds.clear();
    this.uid = null;
    this.auto = false;
    this.state = 'off';
    this.emit();
  }

  /** Something may have changed: run a pass soon (one at a time; a request during a pass runs one more after it). */
  kick(reason: string): void {
    if (!this.uid) return;
    if (this.running) {
      this.again = true;
      return;
    }
    log.debug('pass requested', { reason });
    this.running = this.pass()
      .catch((e) => log.warn('pass failed', { error: String((e as Error)?.message ?? e) }))
      .finally(() => {
        this.running = null;
        if (this.again && this.auto) {
          this.again = false;
          setTimeout(() => this.kick('again'), 1_000).unref?.();
        }
      });
  }

  /** The journal says whether Drive changed since this computer last caught up. */
  private async poll(): Promise<void> {
    if (!this.uid || this.running || !this.deviceId || this.state === 'paused' || this.state === 'disconnected' || this.state === 'blocked') return;
    if (!this.store.folders(this.uid).some((f) => !f.paused)) return;
    try {
      if (await this.protocol.changedSince(this.cursor)) this.kick('drive changed');
    } catch {
      /* offline: the next poll asks again */
    }
  }

  /** Runs passes until one leaves nothing for another (a conflict's copy still to send, say). */
  async syncNow(): Promise<void> {
    for (let i = 0; i < 6; i++) {
      this.again = false;
      this.kick('now');
      while (this.running) await this.running;
      if (!this.again) return;
    }
  }

  // ── status ─────────────────────────────────────────────────────────────

  defaultRoot(): string {
    return join(this.deps.home?.() ?? homedir(), 'WorkSuite Drive');
  }

  private rt(id: string): Runtime {
    let r = this.runtime.get(id);
    if (!r) {
      r = { state: 'idle', pending: { up: 0, down: 0 }, issues: [], held: null, confirmDeletes: false, watcher: null };
      this.runtime.set(id, r);
    }
    return r;
  }

  private emit(): void {
    if (this.emitTimer) return;
    this.emitTimer = setTimeout(() => {
      this.emitTimer = null;
      this.onChanged(this.status());
    }, 150);
    this.emitTimer.unref?.();
  }

  private paused(): boolean {
    return !!this.uid && this.deps.db.getConfig<boolean>(`sync:paused:${this.uid}`) === true;
  }

  status(): SyncStatus {
    const uid = this.uid ?? this.deps.userId();
    const allowed = this.deps.allowed();
    const rows = uid ? this.store.folders(uid) : [];
    const folders: SyncFolder[] = rows.map((f) => {
      const r = this.rt(f.id);
      const totals = this.store.totals(f.id);
      return {
        id: f.id,
        folderId: f.folderId,
        folderName: f.folderName,
        localPath: f.localPath,
        mode: f.mode,
        paused: f.paused,
        state: f.paused ? 'paused' : r.state,
        pending: { ...r.pending },
        files: totals.files,
        bytes: totals.bytes,
        lastSyncAt: f.lastSyncAt,
        error: f.error,
        issues: r.issues.slice(0, 100),
        heldDeletions: r.held ? { side: r.held.side, count: r.held.rels.length } : null,
      };
    });
    let state = this.state;
    if (!allowed.ok) state = 'off';
    else if (state === 'idle' && (this.paused() || (folders.length > 0 && folders.every((f) => f.paused)))) state = 'paused';
    else if (state === 'idle' && folders.some((f) => f.error)) state = 'error';
    const last = folders.map((f) => f.lastSyncAt).filter((x): x is string => !!x).sort().pop() ?? null;
    return {
      available: allowed.ok,
      reason: allowed.reason,
      state,
      message: this.message,
      paused: this.paused(),
      folders,
      activity: this.activity.slice(0, 50),
      lastSyncAt: last,
      defaultRoot: this.defaultRoot(),
      revision: this.revision,
      deviceId: this.deviceId,
    };
  }

  /** For the device heartbeat (FR-DEV-02). */
  health(): { pendingUp: number; pendingDown: number; lastError: string | null } {
    let up = 0;
    let down = 0;
    for (const r of this.runtime.values()) {
      up += r.pending.up;
      down += r.pending.down;
    }
    return { pendingUp: up, pendingDown: down, lastError: this.lastError };
  }

  private note(folderId: string, action: SyncActivity['action'], path: string): void {
    this.activity.unshift({ at: new Date().toISOString(), folderId, action, path });
    if (this.activity.length > 200) this.activity.length = 200;
    this.revision++;
    this.emit();
  }

  /** Per-item answers for the rows on screen. `context`: the Drive folder being looked at, if any. */
  lookup(fileIds: number[], folderIds: number[], context: number | null): SyncLookup {
    const out: SyncLookup = { files: {}, folders: {} };
    const uid = this.uid;
    if (!uid) return out;
    const rows = this.store.folders(uid);
    const byId = new Map(rows.map((f) => [f.id, f]));
    const roots = new Map(rows.filter((f) => f.folderId !== null).map((f) => [f.folderId!, f]));
    const dirs = this.store.located(uid, 'dir', [...folderIds, ...(context !== null ? [context] : [])]);
    const inSync = (folderId: number | null): SyncFolderRow | null => {
      if (folderId === null) return rows.find((f) => f.folderId === null) ?? null;
      const root = roots.get(folderId);
      if (root) return root;
      const d = dirs.get(folderId);
      return d ? (byId.get(d.folder) ?? null) : (rows.find((f) => f.folderId === null) ?? null);
    };
    const contextFolder = context === null ? null : inSync(context);
    const conflicted = (f: string, rel: string) => this.rt(f).issues.some((i) => i.kind === 'conflict' && this.key(i.path) === this.key(rel));
    const pathOf = (f: SyncFolderRow, rel: string) => this.display(rel ? join(f.localPath, ...rel.split('/')) : f.localPath);

    for (const [id, at] of this.store.located(uid, 'file', fileIds)) {
      const f = byId.get(at.folder);
      if (!f) continue;
      const state: SyncItemState = this.pendingIds.has(id) ? 'pending' : conflicted(f.id, at.rel) ? 'conflict' : 'synced';
      out.files[String(id)] = { state, path: pathOf(f, parentOf(at.rel)) };
    }
    for (const id of fileIds) {
      if (out.files[String(id)]) continue;
      const pending = contextFolder && !contextFolder.paused && contextFolder.mode !== 'upload_only';
      out.files[String(id)] = { state: pending ? 'pending' : 'online', path: null };
    }
    for (const id of folderIds) {
      const root = roots.get(id);
      if (root) {
        out.folders[String(id)] = { state: 'synced', path: pathOf(root, ''), syncFolderId: root.id, root: true };
        continue;
      }
      const d = dirs.get(id);
      const f = d ? byId.get(d.folder) : undefined;
      if (d && f) out.folders[String(id)] = { state: 'synced', path: pathOf(f, d.rel), syncFolderId: f.id, root: false };
      else out.folders[String(id)] = { state: contextFolder && contextFolder.mode !== 'upload_only' ? 'pending' : 'online', path: null, syncFolderId: null, root: false };
    }
    return out;
  }

  /** Home shown as ~, the way people write it. */
  private display(p: string): string {
    const home = this.deps.home?.() ?? homedir();
    return p === home ? '~' : p.startsWith(home + sep) ? `~${p.slice(home.length)}` : p;
  }

  /** The place on this computer of a synced Drive item, or of a synced folder. */
  locate(what: { fileId?: number; folderId?: number; syncFolderId?: string }): { path: string; isFile: boolean } | null {
    const uid = this.uid;
    if (!uid) return null;
    const rows = this.store.folders(uid);
    if (what.syncFolderId) {
      const f = rows.find((x) => x.id === what.syncFolderId);
      return f ? { path: f.localPath, isFile: false } : null;
    }
    if (what.folderId !== undefined) {
      const root = rows.find((f) => f.folderId === what.folderId);
      if (root) return { path: root.localPath, isFile: false };
      const d = this.store.located(uid, 'dir', [what.folderId]).get(what.folderId);
      const f = d ? rows.find((x) => x.id === d.folder) : undefined;
      return d && f ? { path: join(f.localPath, ...d.rel.split('/')), isFile: false } : null;
    }
    if (what.fileId !== undefined) {
      const at = this.store.located(uid, 'file', [what.fileId]).get(what.fileId);
      const f = at ? rows.find((x) => x.id === at.folder) : undefined;
      return at && f ? { path: join(f.localPath, ...at.rel.split('/')), isFile: true } : null;
    }
    return null;
  }

  // ── choosing folders ───────────────────────────────────────────────────

  private requireUser(): string {
    if (!this.uid) throw new DesktopError('NOT_SIGNED_IN', 'Sign in to WorkSuite first.');
    const a = this.deps.allowed();
    if (!a.ok) throw new DesktopError('POLICY_DENIED', a.reason ?? 'Drive sync is turned off for this computer.');
    return this.uid;
  }

  /** Where a Drive folder goes by default: ~/WorkSuite Drive/<its name>. */
  suggestedPath(folderName: string): string {
    return join(this.defaultRoot(), safeFileName(folderName, 'Drive folder'));
  }

  /**
   * Starts syncing a Drive folder (one of the person's own: the sync protocol
   * writes only into those) with a folder here. The local folder may already
   * hold files; they are merged in, and anything that differs is kept twice.
   */
  async add(input: { folderId: number | null; mode: SyncMode; localPath: string | null }): Promise<SyncStatus> {
    const uid = this.requireUser();
    const tree = await this.deps.http.get<{ tree?: Array<{ id: number; name: string; owner_id?: number; children?: unknown[] }> }>('/api/drive/tree');
    type Node = { id: number; name: string; owner_id?: number; children?: Node[] };
    const nodes = (tree.tree ?? []) as Node[];
    const chain = (target: number, list: Node[], above: number[] = []): number[] | null => {
      for (const n of list) {
        if (n.id === target) return [...above, n.id];
        const hit = chain(target, n.children ?? [], [...above, n.id]);
        if (hit) return hit;
      }
      return null;
    };
    let folderName = 'My Drive';
    let lineage: number[] = [];
    if (input.folderId !== null) {
      const path = chain(input.folderId, nodes);
      if (!path) throw new DesktopError('NOT_FOUND', 'That folder is not in your Drive.');
      const find = (list: Node[]): Node | null => {
        for (const n of list) {
          if (n.id === input.folderId) return n;
          const hit = find(n.children ?? []);
          if (hit) return hit;
        }
        return null;
      };
      const node = find(nodes)!;
      const me = Number(uid);
      if (node.owner_id !== undefined && node.owner_id !== me) throw new DesktopError('PERMISSION_DENIED', 'Only your own folders can be synced. Copy what you need into one of yours.');
      folderName = node.name;
      lineage = path;
    }

    const existing = this.store.folders(uid);
    for (const f of existing) {
      if (f.folderId === input.folderId) throw new DesktopError('CONFLICT', `${f.folderName} is already synced to ${this.display(f.localPath)}.`);
      if (f.folderId === null || input.folderId === null) throw new DesktopError('CONFLICT', input.folderId === null ? 'Some of your folders are already synced one by one. Stop syncing them first to sync all of My Drive.' : 'All of My Drive is already synced to this computer, this folder included.');
      const theirs = chain(f.folderId, nodes) ?? [];
      if (lineage.includes(f.folderId)) throw new DesktopError('CONFLICT', `${folderName} is already synced as part of ${f.folderName}.`);
      if (theirs.includes(input.folderId!)) throw new DesktopError('CONFLICT', `${f.folderName}, inside ${folderName}, is already synced on its own. Stop syncing it first.`);
    }

    const target = resolve(input.localPath ?? this.suggestedPath(folderName));
    await this.checkLocalPlace(target, existing);
    await mkdir(target, { recursive: true });
    await access(target, constants.W_OK).catch(() => {
      throw new DesktopError('PERMISSION_DENIED', `WorkSuite cannot write to ${this.display(target)}. Choose another folder.`);
    });
    const row = this.store.addFolder(uid, { folderId: input.folderId, folderName, localPath: await realpath(target), mode: input.mode });
    this.deps.audit('drive.sync.folder_added', { folder_id: input.folderId, mode: input.mode });
    if (this.auto) this.watch(row);
    void this.pushRoots();
    this.kick('folder added');
    this.emit();
    return this.status();
  }

  private async checkLocalPlace(target: string, existing: SyncFolderRow[]): Promise<void> {
    if (!isAbsolute(target)) throw new DesktopError('IPC_VALIDATION_FAILED', 'Choose a folder on this computer.');
    // Both resolved: on macOS a temporary or linked home (/var → /private/var) must still read as home.
    const homeRaw = this.deps.home?.() ?? homedir();
    const home = await realpath(homeRaw).catch(() => homeRaw);
    const real = await realpath(target).catch(() => target);
    if (real === home || real === dirname(home) || real === resolve('/') || /^[A-Za-z]:\\?$/.test(real)) {
      throw new DesktopError('IPC_VALIDATION_FAILED', 'Choose a folder of its own, not your home folder or the top of a disk.');
    }
    for (const p of this.deps.protectedPaths?.() ?? []) {
      if (isUnder(real, p) || isUnder(p, real)) throw new DesktopError('IPC_VALIDATION_FAILED', "That folder holds WorkSuite's own data. Choose another.");
    }
    for (const f of existing) {
      if (isUnder(real, f.localPath) || isUnder(f.localPath, real)) throw new DesktopError('CONFLICT', `That folder overlaps ${this.display(f.localPath)}, where ${f.folderName} is synced.`);
    }
    if (looksRemovable(real, this.deps.platform) && !this.deps.removableAllowed()) {
      throw new DesktopError('POLICY_DENIED', 'Your organization does not allow syncing to removable or external disks.');
    }
  }

  /** Stops syncing a folder. The files stay where they are, on both sides. */
  async remove(id: string): Promise<SyncStatus> {
    const uid = this.requireUser();
    const f = this.store.folder(id);
    if (!f || f.userId !== uid) throw new DesktopError('NOT_FOUND', 'That folder is not synced.');
    this.runtime.get(id)?.watcher?.close();
    this.runtime.delete(id);
    this.store.removeFolder(id);
    this.revision++;
    this.deps.audit('drive.sync.folder_removed', { folder_id: f.folderId });
    void this.pushRoots();
    this.emit();
    return this.status();
  }

  setMode(id: string, mode: SyncMode): SyncStatus {
    this.requireUser();
    this.store.updateFolder(id, { mode });
    void this.pushRoots();
    this.kick('mode');
    return this.status();
  }

  setPaused(id: string | null, paused: boolean): SyncStatus {
    const uid = this.requireUser();
    if (id) this.store.updateFolder(id, { paused });
    else this.deps.db.setConfig(`sync:paused:${uid}`, paused);
    if (!paused) this.kick('resumed');
    else this.abort?.abort();
    this.emit();
    return this.status();
  }

  /** The deletion guard's answer: carry the held deletions out, or bring those files back. */
  resolveHeld(id: string, choice: 'apply' | 'restore'): SyncStatus {
    this.requireUser();
    const r = this.rt(id);
    if (r.held) {
      if (choice === 'apply') r.confirmDeletes = true;
      else for (const rel of r.held.rels) this.store.remove(id, rel);
      r.held = null;
    }
    this.kick('deletions resolved');
    this.emit();
    return this.status();
  }

  /** The server's record of what this device syncs (the device centre shows it). */
  private async pushRoots(): Promise<void> {
    if (!this.uid || !this.deviceId) return;
    const roots = this.store.folders(this.uid).map((f) => ({ folder_id: f.folderId, local_path: this.display(f.localPath), mode: f.mode, enabled: true }));
    await this.deps.http.request('PUT', `/api/sync/devices/${this.deviceId}/roots`, { body: { roots } }).catch(() => undefined);
  }

  private watch(f: SyncFolderRow): void {
    const r = this.rt(f.id);
    r.watcher?.close();
    r.watcher = null;
    try {
      r.watcher = watch(f.localPath, { recursive: true, persistent: false }, (_event, name) => {
        const n = typeof name === 'string' ? name : '';
        if (/\.wsync-part$/.test(n)) return;
        if (this.debounce) clearTimeout(this.debounce);
        this.debounce = setTimeout(() => this.kick('local change'), DEBOUNCE_MS);
        this.debounce.unref?.();
      });
      r.watcher.on('error', () => {
        r.watcher?.close();
        r.watcher = null;
      });
    } catch {
      // No watching (a missing folder, or a filesystem without events): the five-minute pass still runs.
    }
  }

  // ── wipe ───────────────────────────────────────────────────────────────

  /**
   * Removes what sync put on this computer: every file the index tracks, and
   * then the folders it tracked if nothing else is left in them. Files the
   * person put beside them are never touched. The index goes too.
   */
  async wipe(userId: string, confirm: boolean): Promise<number> {
    const was = this.uid;
    if (was === userId) this.stop();
    let removed = 0;
    for (const f of this.store.folders(userId)) {
      const entries = [...this.store.entries(f.id).values()];
      for (const e of entries.filter((x) => x.kind === 'file')) {
        try {
          await unlink(join(f.localPath, ...e.rel.split('/')));
          removed++;
        } catch {
          /* already gone */
        }
      }
      const dirs = entries.filter((x) => x.kind === 'dir').sort((a, b) => b.rel.split('/').length - a.rel.split('/').length);
      for (const d of dirs) await this.removeIfEmpty(join(f.localPath, ...d.rel.split('/')));
      await this.removeIfEmpty(f.localPath);
      this.store.removeFolder(f.id);
    }
    if (confirm && this.deps.deviceToken()) await this.protocol.wiped().catch(() => undefined);
    this.deps.audit('drive.sync.wiped', { files: removed });
    log.warn('synced copy removed', { files: removed });
    return removed;
  }

  private async removeIfEmpty(dir: string): Promise<boolean> {
    try {
      const names = await readdir(dir);
      if (names.some((n) => !JUNK.includes(n))) return false;
      for (const n of names) await unlink(join(dir, n)).catch(() => undefined);
      await rmdir(dir);
      return true;
    } catch {
      return false;
    }
  }

  // ── a pass ─────────────────────────────────────────────────────────────

  private async pass(): Promise<void> {
    const uid = this.uid;
    if (!uid) return;
    if (!this.deps.allowed().ok) {
      this.state = 'off';
      return this.emit();
    }
    const folders = this.store.folders(uid);
    if (!folders.length) {
      this.state = 'idle';
      return this.emit();
    }
    if (this.paused()) {
      this.state = 'idle';
      return this.emit();
    }

    let hello;
    try {
      const totals = folders.reduce((a, f) => {
        const t = this.store.totals(f.id);
        return { files: a.files + t.files, bytes: a.bytes + t.bytes };
      }, { files: 0, bytes: 0 });
      hello = await this.protocol.hello({ ...this.deps.info(), storage_used: totals.bytes, file_count: totals.files });
    } catch (e) {
      this.onHelloError(e);
      return this.emit();
    }
    if (hello.command === 'wipe') {
      log.warn('the server asked for the synced copy to be removed');
      await this.wipe(uid, true);
      this.state = 'disconnected';
      this.message = 'The synced copy on this computer was removed, as your account’s device settings asked.';
      return this.emit();
    }
    if (hello.command === 'pause') {
      this.state = 'paused';
      this.message = hello.message;
      return this.emit();
    }
    const firstHello = this.deviceId === null;
    this.deviceId = hello.deviceId;
    this.cursor = hello.cursor;
    this.policy = hello.policy;
    this.message = null;
    if (firstHello) void this.pushRoots();

    this.state = 'syncing';
    this.abort = new AbortController();
    const stats: PassStats = { pulled: 0, pushed: 0, bytesUp: 0, bytesDown: 0, conflicts: 0, sessionId: null, sessionTried: false };
    this.unsettled = 0;
    let complete = true;
    this.emit();
    for (const f of folders) {
      if (f.paused || this.abort.signal.aborted) continue;
      try {
        await this.syncFolder(f, stats);
      } catch (e) {
        complete = false;
        const msg = isDesktopError(e) ? e.message : String((e as Error)?.message ?? e);
        if (isDesktopError(e) && e.code === 'NETWORK_UNREACHABLE') {
          this.state = 'offline';
          this.rt(f.id).state = 'waiting';
          break;
        }
        log.warn('folder pass failed', { error: msg });
        this.lastError = msg;
        this.rt(f.id).state = 'error';
        this.store.updateFolder(f.id, { error: msg });
      }
    }
    this.pendingIds.clear();
    if (complete && hello.head > this.cursor) {
      await this.protocol.ack(hello.head).then(() => (this.cursor = hello.head)).catch(() => undefined);
    }
    if (stats.sessionId) {
      await this.protocol.closeSession(stats.sessionId, {
        cursor: this.cursor,
        pulled: stats.pulled,
        pushed: stats.pushed,
        bytes_up: stats.bytesUp,
        bytes_down: stats.bytesDown,
        conflicts: stats.conflicts,
        state: complete ? 'done' : this.abort.signal.aborted ? 'cancelled' : 'failed',
      });
    }
    if (this.state === 'syncing') this.state = 'idle';
    this.followUpUnsettled();
    this.abort = null;
    this.emit();
  }

  /**
   * A file saved a moment ago was left for later — but the change that
   * started this pass has already been heard, so nothing else would bring it
   * back before the five-minute pass. Look again once it has had time to
   * settle; a few times at most, so a file another program keeps locked does
   * not keep a pass running every few seconds.
   */
  private followUpUnsettled(): void {
    if (!this.auto) return;
    if (this.unsettled === 0) {
      this.settleRetries = 0;
      return;
    }
    if (this.settleRetries >= 5 || this.settleTimer) return;
    this.settleRetries++;
    this.settleTimer = setTimeout(() => {
      this.settleTimer = null;
      this.kick('files settled');
    }, (this.deps.settleMs ?? 3000) + 1500);
    this.settleTimer.unref?.();
  }

  private onHelloError(e: unknown): void {
    if (!isDesktopError(e)) {
      this.state = 'error';
      this.message = String((e as Error)?.message ?? e);
      return;
    }
    switch (e.code) {
      case 'NETWORK_UNREACHABLE':
        this.state = 'offline';
        this.message = null;
        return;
      case 'DEVICE_NOT_REGISTERED':
      case 'SESSION_EXPIRED':
        this.state = 'disconnected';
        this.message = 'This computer is no longer connected to Drive sync — it was signed out from another device, or its registration was removed. Reconnect it to sync again.';
        return;
      case 'PERMISSION_DENIED':
        this.state = 'blocked';
        this.message = e.message || 'An administrator has blocked this computer from syncing.';
        return;
      default:
        this.state = 'error';
        this.message = e.message;
    }
  }

  private async openSessionOnce(stats: PassStats): Promise<void> {
    if (stats.sessionTried) return;
    stats.sessionTried = true;
    stats.sessionId = await this.protocol.openSession();
  }

  private abs(f: SyncFolderRow, rel: string): string {
    return rel ? join(f.localPath, ...rel.split('/')) : f.localPath;
  }

  private async syncFolder(f: SyncFolderRow, stats: PassStats): Promise<void> {
    const r = this.rt(f.id);
    const signal = this.abort!.signal;
    r.state = 'scanning';
    r.pending = { up: 0, down: 0 };
    this.emit();

    if (looksRemovable(f.localPath, this.deps.platform) && !this.deps.removableAllowed()) {
      throw new DesktopError('POLICY_DENIED', 'Your organization does not allow syncing to removable or external disks.');
    }
    const policy = this.policy ?? defaultPolicy();
    const userId = Number(this.uid);
    let base = this.store.entries(f.id);
    let local;
    let remote;
    const opts = { mode: f.mode, key: this.key };

    // Moves first, until none are left (a move can reveal another).
    for (let round = 0; ; round++) {
      local = await scanLocal(f.localPath, { base, key: this.key, patterns: policy.ignored_patterns, policy, hash: this.deps.hash, settleMs: this.deps.settleMs, signal });
      if (local.missingRoot) {
        throw new DesktopError('NOT_FOUND', `${this.display(f.localPath)} is not on this computer any more — moved, renamed, or on a disk that is not connected. Nothing was deleted from Drive. Put it back, or stop syncing this folder.`);
      }
      const known = { files: new Set<number>(), dirs: new Set<number>() };
      for (const b of base.values()) (b.kind === 'dir' ? known.dirs : known.files).add(b.remoteId);
      remote = await listRemote(this.deps.http, { rootId: f.folderId, userId, key: this.key, patterns: policy.ignored_patterns, policy, platform: this.deps.platform, known });
      if (remote.missingRoot) {
        throw new DesktopError('NOT_FOUND', `The Drive folder ${f.folderName} was deleted, moved to the recycle bin, or is no longer yours. Nothing on this computer was deleted. Restore it in Drive, or stop syncing it.`);
      }
      if (remote.rootName && remote.rootName !== f.folderName && f.folderId !== null) {
        this.store.updateFolder(f.id, { folderName: remote.rootName });
        f.folderName = remote.rootName;
      }
      const moves = round < 4 ? planMoves(base, local.picture, remote.picture, opts) : [];
      if (!moves.length) break;
      await this.openSessionOnce(stats);
      for (const m of moves) {
        if (signal.aborted) return;
        await this.applyMove(f, m).catch((e) => this.issue(f.id, m.to, 'error', `Could not move this: ${(e as Error).message}`));
      }
      base = this.store.entries(f.id);
    }

    // A conflict is news for a day, whatever passes follow; everything else is this pass's.
    const dayAgo = new Date(Date.now() - 86_400_000).toISOString();
    const recentConflicts = r.issues.filter((i) => i.kind === 'conflict' && (i.at ?? '') > dayAgo);
    let actions = planContent(base, local.picture, remote.picture, opts);
    actions = this.guardDeletions(r, base, actions);
    r.issues = [...recentConflicts, ...local.issues, ...remote.issues];
    this.unsettled += local.unstable;
    const work = actions.filter((a) => a.op !== 'record' && a.op !== 'forget' && a.op !== 'skip');
    r.pending = {
      up: work.filter((a) => a.op === 'upload' || a.op === 'mkdir-remote' || a.op === 'delete-remote').length,
      down: work.filter((a) => a.op === 'download' || a.op === 'mkdir-local' || a.op === 'delete-local' || a.op === 'conflict').length,
    };
    for (const a of work) if ((a.op === 'download' || a.op === 'conflict') && a.remote.kind === 'file') this.pendingIds.add(a.remote.id);
    r.state = work.length ? 'syncing' : 'idle';
    this.emit();
    if (work.length) await this.openSessionOnce(stats);

    for (const a of actions) {
      if (signal.aborted) break;
      try {
        await this.apply(f, a, stats, remote.picture);
      } catch (e) {
        const msg = isDesktopError(e) ? e.message : String((e as Error)?.message ?? e);
        if (isDesktopError(e) && e.code === 'NETWORK_UNREACHABLE') throw e;
        log.info('sync action failed', { op: a.op, error: msg });
        this.lastError = msg;
        r.issues.push({ path: a.rel, kind: 'error', message: msg });
      } finally {
        if (a.op === 'upload' || a.op === 'mkdir-remote' || a.op === 'delete-remote') r.pending.up = Math.max(0, r.pending.up - 1);
        if (a.op === 'download' || a.op === 'mkdir-local' || a.op === 'delete-local' || a.op === 'conflict') r.pending.down = Math.max(0, r.pending.down - 1);
        if ((a.op === 'download' || a.op === 'conflict') && a.remote.kind === 'file') this.pendingIds.delete(a.remote.id);
        this.emit();
      }
    }
    r.state = 'idle';
    r.pending = { up: 0, down: 0 };
    this.store.updateFolder(f.id, { lastSyncAt: new Date().toISOString(), error: null });
    this.revision++;
  }

  /**
   * The deletion guard. A disk that is not mounted, a folder emptied by
   * mistake, or a Drive folder cleared by somebody else all look like "delete
   * everything" — so above a threshold, deletions wait for a person.
   */
  private guardDeletions(r: Runtime, base: Map<string, BaseItem>, actions: ContentAction[]): ContentAction[] {
    if (r.confirmDeletes) {
      r.confirmDeletes = false;
      r.held = null;
      return actions;
    }
    let tracked = 0;
    for (const b of base.values()) if (b.kind === 'file') tracked++;
    const limit = Math.max(25, Math.ceil(tracked * 0.3));
    const here = actions.filter((a) => a.op === 'delete-local' && a.kind === 'file');
    const there = actions.filter((a) => a.op === 'delete-remote' && a.kind === 'file');
    let out = actions;
    r.held = null;
    if (there.length > limit) {
      r.held = { side: 'drive', rels: there.map((a) => a.rel) };
      out = out.filter((a) => a.op !== 'delete-remote');
      log.warn('deletions in Drive held for confirmation', { count: there.length });
    } else if (here.length > limit) {
      r.held = { side: 'computer', rels: here.map((a) => a.rel) };
      out = out.filter((a) => a.op !== 'delete-local');
      log.warn('deletions on this computer held for confirmation', { count: here.length });
    }
    return out;
  }

  private issue(folderId: string, path: string, kind: SyncIssue['kind'], message: string): void {
    this.rt(folderId).issues.push({ path, kind, message, at: new Date().toISOString() });
    this.emit();
  }

  // ── moves ──────────────────────────────────────────────────────────────

  private async applyMove(f: SyncFolderRow, m: MoveAction): Promise<void> {
    if (m.op === 'rebase') {
      this.store.rebase(f.id, m.baseRel, m.to);
      return;
    }
    if (m.op === 'move-local') {
      const from = this.abs(f, m.from);
      const to = this.abs(f, m.to);
      if (await exists(to)) throw new Error(`${m.to} already exists here.`);
      await mkdir(dirname(to), { recursive: true });
      await rename(from, to);
      this.store.rebase(f.id, m.baseRel, m.to);
      this.note(f.id, 'moved', m.to);
      return;
    }
    // move-remote
    const oldParent = parentOf(m.baseRel);
    const newParent = parentOf(m.to);
    const newName = nameOf(m.to);
    const nameChanged = nameOf(m.baseRel) !== newName;
    const parentChanged = this.key(oldParent) !== this.key(newParent);
    const parentId = parentChanged ? await this.ensureRemoteDir(f, newParent) : null;
    if (m.kind === 'file') {
      await this.deps.http.request('PUT', `/api/files/${m.remoteId}`, { body: { ...(nameChanged ? { name: newName } : {}), ...(parentChanged ? { folder_id: parentId } : {}) } });
    } else {
      if (nameChanged) await this.deps.http.request('PUT', `/api/folders/${m.remoteId}`, { body: { name: newName } });
      if (parentChanged) await this.deps.http.post(`/api/drive/folders/${m.remoteId}/move`, { parent_id: parentId });
    }
    this.store.rebase(f.id, m.baseRel, m.to);
    this.note(f.id, 'moved', m.to);
  }

  /** The Drive folder for a path inside the synced folder, made (with any above it) if it is not there yet. */
  private async ensureRemoteDir(f: SyncFolderRow, rel: string): Promise<number | null> {
    if (rel === '') return f.folderId;
    const known = this.store.entries(f.id).get(this.key(rel));
    if (known && known.kind === 'dir') return known.remoteId;
    const parentId = await this.ensureRemoteDir(f, parentOf(rel));
    const made = await this.deps.http.post<{ id?: number | string }>('/api/folders', { name: nameOf(rel), parent_id: parentId });
    const id = Number(made.id);
    if (!id) throw new DesktopError('SERVER_ERROR', `Drive did not say which folder it made for ${rel}.`);
    const st = await lstat(this.abs(f, rel), { bigint: true }).catch(() => null);
    this.store.put(f.id, { rel, kind: 'dir', remoteId: id, version: 0, sha256: null, size: 0, mtimeMs: st ? Number(st.mtimeMs) : 0, ino: st ? `${st.dev}:${st.ino}` : null });
    this.note(f.id, 'folder', rel);
    return id;
  }

  // ── content ────────────────────────────────────────────────────────────

  private async apply(f: SyncFolderRow, a: ContentAction, stats: PassStats, remote: Picture<RemoteItem>): Promise<void> {
    switch (a.op) {
      case 'skip':
        this.issue(f.id, a.rel, 'skipped', a.message);
        return;
      case 'forget':
        this.store.remove(f.id, a.rel);
        return;
      case 'record': {
        const l = a.local;
        this.store.put(f.id, { rel: a.rel, kind: a.kind, remoteId: a.remote.id, version: a.remote.version, sha256: a.kind === 'file' ? (l.sha256 ?? a.remote.sha256) : null, size: l.size, mtimeMs: l.mtimeMs, ino: l.ino });
        return;
      }
      case 'mkdir-local': {
        const p = this.abs(f, a.rel);
        await mkdir(p, { recursive: true });
        const st = await lstat(p, { bigint: true });
        this.store.put(f.id, { rel: a.rel, kind: 'dir', remoteId: a.remote.id, version: 0, sha256: null, size: 0, mtimeMs: Number(st.mtimeMs), ino: `${st.dev}:${st.ino}` });
        this.note(f.id, 'folder', a.rel);
        return;
      }
      case 'mkdir-remote':
        await this.ensureRemoteDir(f, a.rel);
        return;
      case 'download':
        await this.download(f, a.rel, a.remote, a.local, stats);
        return;
      case 'upload':
        await this.upload(f, a.rel, a.local, a.fileId, a.baseVersion, remote.items.get(this.key(a.rel)) ?? null, stats);
        return;
      case 'conflict':
        await this.keepBoth(f, a.rel, a.local, a.remote, stats);
        return;
      case 'delete-local':
        await this.deleteLocal(f, a.rel, a.kind, a.local);
        return;
      case 'delete-remote':
        await this.deleteRemote(f, a.rel, a.kind, a.remote);
        return;
    }
  }

  /** The file is still what the pass saw (or still absent). Anything else waits for the next pass. */
  private async unchanged(path: string, seen: LocalItem | null): Promise<boolean> {
    const st = await lstat(path, { bigint: true }).catch(() => null);
    if (!seen) return st === null;
    return !!st && Number(st.size) === seen.size && Number(st.mtimeMs) === seen.mtimeMs;
  }

  private async throttle(bytes: number, kbps: number): Promise<void> {
    if (kbps > 0 && bytes > 0) await sleep((bytes / (kbps * 1024)) * 1000);
  }

  private async download(f: SyncFolderRow, rel: string, r: RemoteItem, seen: LocalItem | null, stats: PassStats): Promise<void> {
    const target = this.abs(f, rel);
    if (!(await this.unchanged(target, seen))) return; // changed while this pass ran
    await mkdir(dirname(target), { recursive: true });
    const tmp = join(dirname(target), `.${nameOf(rel).slice(0, 80)}.${randomBytes(4).toString('hex')}.wsync-part`);
    const kbps = this.policy?.download_kbps ?? 0;
    let version = r.version;
    let sha = '';
    let fetched = 0;
    try {
      const whole = createHash('sha256');
      const out = await open(tmp, 'w', 0o644);
      try {
        let viaBlocks = r.own;
        if (viaBlocks) {
          try {
            const m = await this.protocol.manifest(r.id);
            version = m.version;
            // Blocks this computer already has in the old copy are copied, not fetched.
            const reuse = new Map<string, number>();
            if (seen && seen.size > BLOCK_SIZE) {
              const mine = await this.deps.hashBlocks(target);
              mine.blocks.forEach((h, i) => reuse.set(h, i));
            }
            const old = reuse.size ? await open(target, 'r') : null;
            try {
              for (const b of m.blocks) {
                let bytes: Buffer;
                const at = reuse.get(b.sha256);
                if (old && at !== undefined) {
                  bytes = Buffer.alloc(b.size);
                  await old.read(bytes, 0, b.size, at * BLOCK_SIZE);
                } else {
                  bytes = await this.protocol.readBlock(r.id, b.idx, this.abort?.signal);
                  fetched += bytes.length;
                  await this.throttle(bytes.length, kbps);
                }
                if (createHash('sha256').update(bytes).digest('hex') !== b.sha256) throw new DesktopError('SERVER_ERROR', `Part ${b.idx + 1} of ${nameOf(rel)} arrived damaged.`);
                whole.update(bytes);
                await out.write(bytes);
              }
            } finally {
              await old?.close();
            }
            if (m.sha256 && whole.copy().digest('hex') !== m.sha256) throw new DesktopError('SERVER_ERROR', `${nameOf(rel)} did not arrive whole.`);
          } catch (e) {
            if (isDesktopError(e) && (e.code === 'NETWORK_UNREACHABLE' || e.code === 'CANCELLED')) throw e;
            if (!isDesktopError(e) || !['NOT_FOUND', 'SERVER_ERROR'].includes(e.code)) throw e;
            log.info('block download unavailable; fetching the whole file', { error: e.message });
            viaBlocks = false;
            await out.truncate(0);
            fetched = 0;
          }
        }
        if (!viaBlocks) {
          const w = createHash('sha256');
          const res = await this.deps.http.raw('GET', this.deps.http.url(`/api/files/${r.id}/download`), { headers: { Accept: '*/*' }, signal: this.abort?.signal, timeoutMs: 24 * 3600_000 });
          if (res.status === 403) throw new DesktopError('PERMISSION_DENIED', `You may view ${nameOf(rel)} but not download it, so it is not kept on this computer.`);
          if (!res.ok || !res.body) throw new DesktopError(res.status === 404 ? 'NOT_FOUND' : 'SERVER_ERROR', `${nameOf(rel)} could not be downloaded (${res.status}).`);
          const reader = res.body.getReader();
          let pos = 0;
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            w.update(value);
            await out.write(value, 0, value.byteLength, pos);
            pos += value.byteLength;
            fetched += value.byteLength;
            await this.throttle(value.byteLength, kbps);
          }
          sha = w.digest('hex');
          if (r.sha256 && sha !== r.sha256) throw new DesktopError('SERVER_ERROR', `${nameOf(rel)} did not arrive whole.`);
        } else {
          sha = whole.digest('hex');
        }
      } finally {
        await out.close();
      }
      // Once more, just before it replaces anything.
      if (!(await this.unchanged(target, seen))) {
        await unlink(tmp).catch(() => undefined);
        return;
      }
      await rename(tmp, target);
    } catch (e) {
      await unlink(tmp).catch(() => undefined);
      throw e;
    }
    const st = await lstat(target, { bigint: true });
    this.store.put(f.id, { rel, kind: 'file', remoteId: r.id, version, sha256: sha, size: Number(st.size), mtimeMs: Number(st.mtimeMs), ino: `${st.dev}:${st.ino}` });
    stats.pulled++;
    stats.bytesDown += fetched;
    this.note(f.id, 'downloaded', rel);
  }

  private async upload(f: SyncFolderRow, rel: string, l: LocalItem, fileId: number | null, baseVersion: number | null, r: RemoteItem | null, stats: PassStats): Promise<void> {
    const path = this.abs(f, rel);
    if (!(await this.unchanged(path, l))) return;
    const name = nameOf(rel);
    const folderId = await this.ensureRemoteDir(f, parentOf(rel));
    const h = await this.deps.hashBlocks(path);
    if (h.sha256 !== l.sha256 || h.bytes !== l.size) return; // changed since the scan: next pass
    const own = fileId === null || (r?.own ?? true);
    const mime = mimeFor(name) ?? 'application/octet-stream';
    let result: { fileId: number; version: number; sent: number } | null = null;

    if (own && h.blocks.length > 0 && h.blocks.length <= MAX_COMMIT_BLOCKS) {
      try {
        result = await this.commitBlocks(path, h, { name, mime, fileId, baseVersion, folderId });
      } catch (e) {
        if (isDesktopError(e) && e.code === 'CONFLICT' && (e.data as { conflict?: boolean } | null)?.conflict) {
          await this.serverKeptBoth(f, rel, l, (e.data as { copy_file_id?: number | null }).copy_file_id ?? null, stats);
          return;
        }
        // The server could not assemble it (a large file, or its memory): the ordinary upload takes it.
        if (!(isDesktopError(e) && e.code === 'SERVER_ERROR')) throw e;
        log.info('block commit failed; using the chunked upload', { error: e.message });
      }
    }
    if (!result) {
      if (fileId !== null) {
        const now = await this.deps.http.get<{ version?: number }>(`/api/files/${fileId}`).catch(() => null);
        if (now && baseVersion !== null && Number(now.version) !== baseVersion) {
          await this.setAside(f, rel, l, stats, 'Changed here and in Drive at the same time.');
          return;
        }
      }
      result = await this.chunkedUpload(path, h.sha256, h.bytes, { name, mime, fileId, folderId });
    }
    const st = await lstat(path, { bigint: true });
    this.store.put(f.id, { rel, kind: 'file', remoteId: result.fileId, version: result.version, sha256: h.sha256, size: h.bytes, mtimeMs: Number(st.mtimeMs), ino: `${st.dev}:${st.ino}` });
    stats.pushed++;
    stats.bytesUp += result.sent;
    this.note(f.id, 'uploaded', rel);
  }

  /** have → block → commit: only the blocks Drive does not already hold travel. */
  private async commitBlocks(path: string, h: { sha256: string; blocks: string[] }, t: { name: string; mime: string; fileId: number | null; baseVersion: number | null; folderId: number | null }): Promise<{ fileId: number; version: number; sent: number }> {
    const kbps = this.policy?.upload_kbps ?? 0;
    let sent = 0;
    const send = async (missing: Set<string>) => {
      const fh = await open(path, 'r');
      try {
        for (let i = 0; i < h.blocks.length; i++) {
          const hash = h.blocks[i]!;
          if (!missing.has(hash)) continue;
          missing.delete(hash);
          const buf = Buffer.alloc(BLOCK_SIZE);
          const { bytesRead } = await fh.read(buf, 0, BLOCK_SIZE, i * BLOCK_SIZE);
          const bytes = buf.subarray(0, bytesRead);
          if (createHash('sha256').update(bytes).digest('hex') !== hash) throw new DesktopError('CANCELLED', 'The file changed while it was being sent; it will be sent again.');
          await this.protocol.putBlock(bytes, hash, this.abort?.signal);
          sent += bytes.length;
          await this.throttle(bytes.length, kbps);
        }
      } finally {
        await fh.close();
      }
    };
    await send(await this.protocol.have([...new Set(h.blocks)]));
    for (let attempt = 0; ; attempt++) {
      try {
        const c = await this.protocol.commit({
          name: t.name,
          blocks: h.blocks,
          sha256: h.sha256,
          mime_type: t.mime,
          ...(t.fileId !== null ? { file_id: t.fileId, base_version: t.baseVersion ?? 0 } : { folder_id: t.folderId }),
        });
        return { ...c, sent };
      } catch (e) {
        const missing = isDesktopError(e) && e.code === 'CONFLICT' ? (e.data as { missing?: string } | null)?.missing : undefined;
        if (!missing || attempt >= 2) throw e;
        await send(new Set([missing]));
      }
    }
  }

  /** The ordinary resumable upload (init → chunks → complete), for what the block protocol cannot take. */
  private async chunkedUpload(path: string, sha256: string, size: number, t: { name: string; mime: string; fileId: number | null; folderId: number | null }): Promise<{ fileId: number; version: number; sent: number }> {
    const http = this.deps.http;
    const init = await http.post<{ upload_id: string; chunk_size: number; total_chunks: number; replaces?: number | string }>('/api/uploads/init', {
      filename: t.name,
      total_size: size,
      chunk_size: UPLOAD_CHUNK,
      sha256,
      mime_type: t.mime,
      purpose: 'drive',
      folder_id: t.folderId,
      ...(t.fileId !== null ? { replace_file_id: t.fileId } : {}),
    });
    if (t.fileId !== null && Number(init.replaces) !== t.fileId) {
      await http.post(`/api/uploads/${init.upload_id}/abort`, {}).catch(() => undefined);
      throw new DesktopError('SERVER_ERROR', 'This WorkSuite server cannot save a new version of this file from sync yet.');
    }
    const chunk = Number(init.chunk_size) || UPLOAD_CHUNK;
    const total = Number(init.total_chunks) || Math.max(0, Math.ceil(size / chunk));
    const kbps = this.policy?.upload_kbps ?? 0;
    const fh = await open(path, 'r');
    try {
      for (let i = 0; i < total; i++) {
        const len = Math.min(chunk, size - i * chunk);
        const buf = Buffer.alloc(len);
        await fh.read(buf, 0, len, i * chunk);
        const form = new FormData();
        form.set('chunk_index', String(i));
        form.set('chunk', new Blob([new Uint8Array(buf)]), t.name);
        const res = await http.raw('POST', http.url(`/api/uploads/${init.upload_id}/chunk`), { body: form, signal: this.abort?.signal, timeoutMs: 10 * 60_000 });
        if (!res.ok) throw new DesktopError('SERVER_ERROR', `The server refused part ${i + 1} of ${t.name} (${res.status}).`, res.status);
        await this.throttle(len, kbps);
      }
    } finally {
      await fh.close();
    }
    const done = await http.post<{ file_id?: number | string }>(`/api/uploads/${init.upload_id}/complete`, {});
    const id = Number(done.file_id ?? t.fileId);
    if (!id) throw new DesktopError('SERVER_ERROR', `${t.name} was stored, but Drive did not say where.`);
    const now = await http.get<{ version?: number }>(`/api/files/${id}`).catch(() => null);
    return { fileId: id, version: Number(now?.version ?? 1), sent: size };
  }

  /** A name beside `rel` that neither side has. */
  private async asideName(f: SyncFolderRow, rel: string): Promise<string> {
    const base = conflictedCopyName(nameOf(rel), this.deps.userName() || 'WorkSuite', new Date());
    for (let n = 0; n < 100; n++) {
      const candidate = joinRel(parentOf(rel), numberedName(base, n));
      if (!(await exists(this.abs(f, candidate)))) return candidate;
    }
    return joinRel(parentOf(rel), `${randomBytes(3).toString('hex')} ${base}`);
  }

  /** Both changed: this computer's copy is moved aside (it goes up as a new file), Drive's comes down. */
  private async keepBoth(f: SyncFolderRow, rel: string, l: LocalItem, r: RemoteItem, stats: PassStats): Promise<void> {
    if (!(await this.unchanged(this.abs(f, rel), l))) return;
    const aside = await this.setAside(f, rel, l, stats, 'Changed here and in Drive.');
    if (aside) await this.download(f, rel, r, null, stats);
  }

  private async setAside(f: SyncFolderRow, rel: string, l: LocalItem, stats: PassStats, why: string): Promise<string | null> {
    const from = this.abs(f, rel);
    if (!(await this.unchanged(from, l))) return null;
    const aside = await this.asideName(f, rel);
    await rename(from, this.abs(f, aside));
    this.store.remove(f.id, rel);
    stats.conflicts++;
    this.issue(f.id, rel, 'conflict', `${why} Drive’s version is kept as ${nameOf(rel)}; the one from this computer is beside it as ${nameOf(aside)}.`);
    this.note(f.id, 'conflict', aside);
    this.again = true;
    return aside;
  }

  /**
   * The server refused a commit because Drive moved on, and kept this
   * computer's copy beside it as its own conflicted copy. The local file takes
   * that copy's name, so the two sides agree without sending it twice.
   */
  private async serverKeptBoth(f: SyncFolderRow, rel: string, l: LocalItem, copyId: number | null, stats: PassStats): Promise<void> {
    const copy = copyId ? await this.deps.http.get<{ name?: string; version?: number; sha256?: string | null }>(`/api/files/${copyId}`).catch(() => null) : null;
    if (!copy?.name) {
      await this.setAside(f, rel, l, stats, 'Somebody changed this in Drive while it was being sent.');
      return;
    }
    const aside = joinRel(parentOf(rel), copy.name);
    if (await exists(this.abs(f, aside))) {
      await this.setAside(f, rel, l, stats, 'Somebody changed this in Drive while it was being sent.');
      return;
    }
    await rename(this.abs(f, rel), this.abs(f, aside));
    const st = await lstat(this.abs(f, aside), { bigint: true });
    this.store.remove(f.id, rel);
    this.store.put(f.id, { rel: aside, kind: 'file', remoteId: copyId!, version: Number(copy.version ?? 1), sha256: l.sha256, size: l.size, mtimeMs: Number(st.mtimeMs), ino: `${st.dev}:${st.ino}` });
    stats.conflicts++;
    this.issue(f.id, rel, 'conflict', `Somebody changed this in Drive while it was being sent. Their version is ${nameOf(rel)}; yours is kept beside it as ${copy.name}.`);
    this.note(f.id, 'conflict', aside);
    this.again = true;
  }

  private async deleteLocal(f: SyncFolderRow, rel: string, kind: 'file' | 'dir', l: LocalItem): Promise<void> {
    const p = this.abs(f, rel);
    if (kind === 'file') {
      if (!(await this.unchanged(p, l))) return;
      try {
        await this.deps.trash(p);
      } catch {
        // Some volumes have no Trash. The file is in Drive's recycle bin either way.
        await unlink(p);
      }
      this.store.remove(f.id, rel);
      this.note(f.id, 'deleted-here', rel);
      return;
    }
    if (await this.removeIfEmpty(p)) this.note(f.id, 'deleted-here', rel);
    this.store.remove(f.id, rel);
  }

  private async deleteRemote(f: SyncFolderRow, rel: string, kind: 'file' | 'dir', r: RemoteItem): Promise<void> {
    try {
      if (kind === 'file') await this.deps.http.request('DELETE', `/api/files/${r.id}`);
      else {
        // Only an empty folder: Drive's folder delete does not take the files in it along to the recycle bin.
        const inside = await this.deps.http.get<{ total?: number }>('/api/drive/list', { query: { folder_id: r.id, deep: 1, per_page: 10, counts: 0 } });
        if (Number(inside.total ?? 0) > 0) {
          this.store.remove(f.id, rel);
          return;
        }
        await this.deps.http.request('DELETE', `/api/folders/${r.id}`);
      }
    } catch (e) {
      // Already gone, or already in the recycle bin: the same outcome.
      if (!(isDesktopError(e) && (e.code === 'NOT_FOUND' || e.code === 'CONFLICT'))) {
        this.store.remove(f.id, rel);
        throw e;
      }
    }
    this.store.remove(f.id, rel);
    this.note(f.id, 'deleted-in-drive', rel);
  }
}

async function exists(p: string): Promise<boolean> {
  return stat(p).then(
    () => true,
    () => false,
  );
}


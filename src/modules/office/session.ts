import {
  OFFICE_BASE_EVENTS,
  type OfficeBootstrap,
  type OfficeCollaborator,
  type OfficeCommand,
  type OfficeEditorEventName,
  type OfficeLock,
  type OfficeMode,
  type OfficeReadOnlyReason,
  type OfficeSaveStatus,
  type OfficeViewEvent,
} from '@shared/office';
import { createStore } from '../../core/store';
import * as officeApi from './api';
import { names, refusalOf, type OfficeRefusal } from './api';

/**
 * One Office document's session in one tab (web-api §1–§4, §12): open,
 * heartbeat every 60 s, renew the signed configuration before it lapses
 * or when the editor asks, reload when the server says so, reopen after a
 * 410, switch mode, report the save status, and close — waiting for changes
 * to reach the Document Server first (OO-DSK-006). The editor itself is
 * the tab's view (EditorPort); this never builds a configuration, only
 * hands over the one the server signed.
 */

export type OfficePhase = 'opening' | 'open' | 'offline' | 'refused' | 'ended';

export interface OfficeState {
  phase: OfficePhase;
  boot: OfficeBootstrap | null;
  /** Why it did not open, or why it ended — the server's sentence and what it offers. */
  refusal: OfficeRefusal | null;
  mode: OfficeMode | null;
  availableModes: OfficeMode[];
  readOnlyReason: OfficeReadOnlyReason | null;
  collaborators: OfficeCollaborator[];
  lock: OfficeLock | null;
  save: OfficeSaveStatus | null;
  /** The editor has changes not yet in the Document Server's working copy (`onDocumentStateChange`). */
  dirty: boolean;
  /** Anything was changed in this session (a close asks the server to save). */
  changed: boolean;
  /** When the editor last said its changes reached the Document Server. */
  savedAt: number | null;
  ready: boolean;
  newVersion: boolean;
  canSwitchToEdit: boolean;
  /** The server could not be reached for a heartbeat; the editor carries on. */
  reconnecting: boolean;
  /** "Saving changes…" while a closing tab waits for its changes (OO-DSK-006). */
  closing: boolean;
  /** The editor could not load or stopped; offered: reload. */
  editorProblem: string | null;
  /** The editor's own "Download as" was stopped: the tab's Download and Export are the way out. */
  downloadBlocked: boolean;
  /** A mode or an open refused because a legacy file must be converted first (OO-CNV-030). */
  convertAsk: OfficeRefusal | null;
  busy: boolean;
}

/** The tab's view of the editor: loading a configuration, and commands to it. */
export interface EditorPort {
  start(boot: OfficeBootstrap, events: OfficeEditorEventName[]): void;
  command(cmd: OfficeCommand): void;
}

export interface OfficeSessionHooks {
  /** Open WorkSuite's share dialog (the editor's Share, OO-COL-062). */
  share(): void;
  /** The file's name changed (a rename here or by someone else). */
  renamed(name: string): void;
  notice(kind: 'info' | 'success' | 'warning' | 'error', text: string, action?: { label: string; run: () => void }): void;
  isOffline(): boolean;
  /** The document was asked for again from another window: bring this tab forward (OO-DSK-004). */
  focus?(): void;
  /** A presentation's Present keys were pressed in the editor (#321). */
  present?(fromCurrent: boolean): void;
}

export type OfficeApi = Pick<typeof officeApi, 'openSession' | 'renewSession' | 'switchMode' | 'heartbeat' | 'endSession' | 'forceSave' | 'retrySave' | 'mentionable' | 'mention' | 'renameFile' | 'refreshTitle' | 'takeLock' | 'releaseLock'>;

export interface OfficeSessionDeps {
  api?: OfficeApi;
  now?: () => number;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (h: unknown) => void;
}

/** Renew the signed configuration this long before it lapses (it lasts ten minutes, OO-SEC-002). */
export const RENEW_BEFORE_MS = 150_000;
/** How long a closing tab waits for its changes (OO-DSK-006). */
export const CLOSE_WAIT_MS = 10_000;

const INITIAL: OfficeState = {
  phase: 'opening',
  boot: null,
  refusal: null,
  mode: null,
  availableModes: [],
  readOnlyReason: null,
  collaborators: [],
  lock: null,
  save: null,
  dirty: false,
  changed: false,
  savedAt: null,
  ready: false,
  newVersion: false,
  canSwitchToEdit: false,
  reconnecting: false,
  closing: false,
  editorProblem: null,
  downloadBlocked: false,
  convertAsk: null,
  busy: false,
};

/**
 * The editor events a session wires: the base ones, and each feature only with the permission behind it. Never
 * `onRequestSharingSettings`: with it the editor draws a Share button of its own, and the tab's header already has
 * WorkSuite's (worksuite-desktop#326).
 */
export function editorEvents(boot: OfficeBootstrap): OfficeEditorEventName[] {
  const out: OfficeEditorEventName[] = [...OFFICE_BASE_EVENTS, 'onRequestRefreshFile'];
  if (boot.mode === 'VIEW' && boot.available_modes.includes('EDIT')) out.push('onRequestEditRights');
  if (boot.permissions.rename) out.push('onRequestRename');
  if (boot.permissions.mention && boot.mode !== 'VIEW') out.push('onRequestUsers', 'onRequestSendNotify');
  return out;
}

/** A refused open that ends the session outright rather than reopening: the file went to the bin, or access went. */
function endsForGood(r: OfficeRefusal): boolean {
  if (r.details.reason === 'trashed') return true;
  return r.code === 'OFFICE_PERMISSION_DENIED' && r.details.session_ended === true;
}

function reopens(r: OfficeRefusal): boolean {
  return r.code === 'OFFICE_SESSION_EXPIRED' || r.code === 'OFFICE_SESSION_NOT_FOUND' || (r.status === 410 && !endsForGood(r));
}

export class OfficeSession {
  readonly store = createStore<OfficeState>({ ...INITIAL });
  private readonly api: OfficeApi;
  private readonly now: () => number;
  private readonly setT: (fn: () => void, ms: number) => unknown;
  private readonly clearT: (h: unknown) => void;
  private port: EditorPort | null = null;
  private timer: unknown = null;
  private loadStartedAt = 0;
  private readySent = false;
  private closed = false;
  private saved = false;
  /** Each open is numbered: an answer to an open that was superseded (or closed) ends the session it made. */
  private gen = 0;
  /** The mode the person chose (the route's, or a switch); a reopen asks for it again. */
  private chosen: OfficeMode | null;
  private cleanWaiters: Array<() => void> = [];

  constructor(
    readonly fileId: number,
    requested: OfficeMode | null,
    private readonly hooks: OfficeSessionHooks,
    deps: OfficeSessionDeps = {},
  ) {
    this.chosen = requested;
    this.api = deps.api ?? officeApi;
    this.now = deps.now ?? Date.now;
    this.setT = deps.setTimeout ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearT = deps.clearTimeout ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  }

  get state(): OfficeState {
    return this.store.get();
  }

  /** The tab mounted again (React's development double mount): the session may open again. */
  revive(): void {
    this.closed = false;
    this.saved = false;
  }

  private set(patch: Partial<OfficeState>): void {
    this.store.set(patch);
  }

  // ── the editor view ────────────────────────────────────────────────────

  attach(port: EditorPort): void {
    this.port = port;
    if (this.state.phase === 'open' && this.state.boot) this.load();
  }

  detach(port: EditorPort): void {
    if (this.port === port) this.port = null;
  }

  private load(): void {
    const boot = this.state.boot;
    if (!boot || !this.port || this.closed) return;
    this.loadStartedAt = this.now();
    this.readySent = false;
    this.set({ ready: false, editorProblem: null, dirty: false });
    this.port.start(boot, editorEvents(boot));
  }

  // ── opening ────────────────────────────────────────────────────────────

  /** POST …/session: the mode the person chose, or the server's default action. */
  async open(mode: OfficeMode | null = this.chosen): Promise<void> {
    if (this.closed) return;
    this.clearTimer();
    if (this.hooks.isOffline()) {
      this.set({ phase: 'offline', refusal: null });
      return;
    }
    const gen = ++this.gen;
    this.set({ phase: 'opening', refusal: null, convertAsk: null });
    try {
      const boot = await this.api.openSession(this.fileId, mode);
      if (this.closed || gen !== this.gen) {
        void this.api.endSession(this.fileId, boot.session_id, 'CLOSED').catch(() => undefined);
        return;
      }
      if (mode) this.chosen = mode;
      this.accept(boot);
      this.set({ phase: 'open' });
      this.load();
      this.schedule(boot.heartbeat_interval_s);
    } catch (e) {
      const r = refusalOf(e);
      if (this.closed || gen !== this.gen) return;
      if (r.offline) return this.set({ phase: 'offline', refusal: null });
      if (r.code === 'OFFICE_LEGACY_CONVERSION_REQUIRED') return this.set({ phase: 'refused', refusal: r, convertAsk: r });
      this.set({ phase: 'refused', refusal: r });
    }
  }

  private accept(boot: OfficeBootstrap): void {
    this.set({
      boot,
      mode: boot.mode,
      availableModes: boot.available_modes,
      readOnlyReason: boot.mode === 'VIEW' ? boot.read_only_reason : null,
      collaborators: boot.collaborators ?? [],
      lock: boot.lock,
      save: boot.save,
      newVersion: !!boot.new_version_available,
      canSwitchToEdit: false,
    });
  }

  // ── heartbeat and renewal ──────────────────────────────────────────────

  private clearTimer(): void {
    if (this.timer !== null) this.clearT(this.timer);
    this.timer = null;
  }

  private schedule(seconds: number): void {
    this.clearTimer();
    if (this.closed) return;
    this.timer = this.setT(() => void this.beat(), Math.max(10, seconds || 60) * 1000);
  }

  /** A heartbeat now (the editor became ready, or a realtime event about this document arrived). */
  poke(): void {
    if (this.state.phase === 'open') void this.beat();
  }

  async beat(readyMs?: number): Promise<void> {
    const boot = this.state.boot;
    if (!boot || this.closed || this.state.phase !== 'open') return;
    const interval = boot.heartbeat_interval_s || 60;
    try {
      const hb = await this.api.heartbeat(this.fileId, boot.session_id, readyMs);
      if (this.closed) return;
      this.set({
        reconnecting: false,
        mode: hb.mode,
        availableModes: hb.available_modes,
        readOnlyReason: hb.mode === 'VIEW' ? hb.read_only_reason : null,
        lock: hb.lock,
        collaborators: hb.collaborators ?? [],
        save: hb.save,
        newVersion: hb.new_version_available,
        canSwitchToEdit: hb.can_switch_to_edit,
      });
      if (hb.reload) {
        // Editing was taken away (OO-ERR-020): the server already dropped this editor; reload read-only.
        this.hooks.notice('warning', hb.read_only_reason?.message ?? 'Editing was turned off for you. The document reopens read-only.');
        await this.renew('reload');
      } else if (!hb.new_version_available && Date.parse(boot.expires_at) - this.now() < RENEW_BEFORE_MS) {
        await this.renew('expiry');
      }
      this.schedule(hb.next_heartbeat_s || interval);
    } catch (e) {
      await this.failed(refusalOf(e));
      if (this.state.phase === 'open') this.schedule(interval);
    }
  }

  /** A refusal from a heartbeat or a renewal: carry on offline, reopen, or end. */
  private async failed(r: OfficeRefusal): Promise<void> {
    if (this.closed) return;
    if (r.offline) {
      this.set({ reconnecting: true });
      return;
    }
    if (endsForGood(r)) {
      this.end(r);
      return;
    }
    if (reopens(r)) {
      // The session ended (idle, closed, revoked): a new one; the Document Server keeps the working state under the key.
      await this.open();
    }
  }

  private end(r: OfficeRefusal): void {
    this.clearTimer();
    this.set({ phase: 'ended', refusal: r, ready: false });
  }

  /**
   * GET …/config — the same session with new tokens. `editor`: the editor
   * asked (onRequestRefreshFile) and gets them in place; `reload`, `newer`:
   * the editor loads again (downgraded, outdated, or a newer version the
   * person chose to open). A renewal that comes back on another key or in
   * another mode always reloads.
   */
  async renew(why: 'expiry' | 'editor' | 'reload' | 'newer'): Promise<void> {
    const boot = this.state.boot;
    if (!boot || this.closed) return;
    try {
      const next = await this.api.renewSession(this.fileId, boot.session_id);
      if (this.closed) return;
      const moved = next.session_id !== boot.session_id || next.document_key !== boot.document_key || next.mode !== boot.mode || next.document_server_url !== boot.document_server_url;
      this.accept(next);
      if (moved || why === 'reload' || why === 'newer') {
        if (why === 'expiry' && next.replaced_session_id) this.hooks.notice('info', 'A newer version of this document was opened.');
        this.load();
      } else if (why === 'editor') {
        this.port?.command({ type: 'refresh', config: next.config });
      }
    } catch (e) {
      await this.failed(refusalOf(e));
    }
  }

  /** The editor stopped, or the person asked: load it again on fresh tokens (OO-SAV-030). */
  reloadEditor(): void {
    void this.renew('reload');
  }

  // ── modes ──────────────────────────────────────────────────────────────

  async setMode(mode: OfficeMode): Promise<boolean> {
    const boot = this.state.boot;
    if (!boot || this.closed || this.state.busy) return false;
    this.set({ busy: true });
    try {
      const next = await this.api.switchMode(this.fileId, boot.session_id, mode);
      this.chosen = mode;
      this.accept(next);
      this.load();
      return true;
    } catch (e) {
      const r = refusalOf(e);
      if (r.code === 'OFFICE_LEGACY_CONVERSION_REQUIRED') this.set({ convertAsk: r });
      else if (reopens(r) || endsForGood(r)) await this.failed(r);
      else {
        this.hooks.notice('error', r.message);
        if (this.state.mode === 'VIEW') this.port?.command({ type: 'denyEditingRights', message: r.message.slice(0, 500) });
      }
      return false;
    } finally {
      this.set({ busy: false });
    }
  }

  dismissConvert(): void {
    this.set({ convertAsk: null });
  }

  // ── saving ─────────────────────────────────────────────────────────────

  async retrySave(): Promise<void> {
    try {
      const s = await this.api.retrySave(this.fileId);
      this.set({ save: s });
    } catch (e) {
      this.hooks.notice('error', refusalOf(e).message);
    }
  }

  /** File → Save as version (OO-VER-012): always a version, labelled. */
  async saveVersion(label: string, description: string): Promise<boolean> {
    const boot = this.state.boot;
    if (!boot) return false;
    try {
      const r = await this.api.forceSave(this.fileId, boot.session_id, { version_label: label.slice(0, 120), ...(description.trim() ? { description: description.slice(0, 110) } : {}) });
      this.hooks.notice('success', r.state === 'no_changes' ? 'Nothing changed since the last version.' : 'Saving the version…');
      return true;
    } catch (e) {
      this.hooks.notice('error', refusalOf(e).message);
      return false;
    }
  }

  private waitClean(ms: number): Promise<void> {
    if (!this.state.dirty) return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => {
        this.clearT(t);
        this.cleanWaiters = this.cleanWaiters.filter((w) => w !== done);
        resolve();
      };
      const t = this.setT(done, Math.max(0, ms));
      this.cleanWaiters.push(done);
    });
  }

  /**
   * The tab's close guard (OO-DSK-006): a document with changes waits — up
   * to ten seconds — for them to reach the Document Server, asks it to save
   * now, and then lets the tab close. Nothing to save: it closes at once.
   */
  closeGuard(): Promise<void> | null {
    const s = this.state;
    if (this.closed || s.phase !== 'open' || !s.boot || s.mode === 'VIEW' || !(s.dirty || s.changed) || s.closing) return null;
    const boot = s.boot;
    this.set({ closing: true });
    const deadline = this.now() + CLOSE_WAIT_MS;
    return (async () => {
      await this.waitClean(CLOSE_WAIT_MS);
      if (this.state.dirty) this.hooks.notice('warning', 'Some changes had not reached the Office server when the tab closed. It keeps what it has.');
      const left = deadline - this.now();
      if (left > 0) {
        await Promise.race([this.api.forceSave(this.fileId, boot.session_id).catch(() => undefined), new Promise<void>((r) => this.setT(r, left))]);
        this.saved = true;
      }
    })();
  }

  /** The tab closed (or its organisation was left): DELETE the session; the Document Server saves anyway. */
  close(reason: 'CLOSED' | 'ORG_SWITCH'): void {
    if (this.closed) return;
    this.closed = true;
    this.gen++;
    this.clearTimer();
    for (const w of [...this.cleanWaiters]) w();
    const boot = this.state.boot;
    if (!boot || this.state.phase !== 'open') return;
    this.set({ phase: 'opening', boot: null });
    const save = !this.saved && this.state.mode !== 'VIEW' && this.state.changed;
    void (async () => {
      if (save) await this.api.forceSave(this.fileId, boot.session_id).catch(() => undefined);
      await this.api.endSession(this.fileId, boot.session_id, reason).catch(() => undefined);
    })();
  }

  // ── the editor's events ────────────────────────────────────────────────

  onViewEvent(ev: OfficeViewEvent): void {
    switch (ev.type) {
      case 'scriptFailed':
        this.set({ editorProblem: 'The Office editor could not be loaded from the Document Server. Check your connection, or ask your administrator whether the Document Server is running.' });
        return;
      case 'crashed':
        this.set({ editorProblem: 'The Office editor stopped. Your changes are kept on the Office server; reload to carry on.', ready: false });
        return;
      case 'downloadBlocked':
        this.set({ downloadBlocked: true });
        return;
      case 'focus':
        this.hooks.focus?.();
        return;
      case 'present':
        this.hooks.present?.(!!(ev.data && typeof ev.data === 'object' && (ev.data as { fromCurrent?: unknown }).fromCurrent === true));
        return;
      case 'hostReady':
        return;
      default:
        void this.onEditorEvent(ev.type, ev.data);
    }
  }

  async onEditorEvent(type: OfficeEditorEventName, data: unknown): Promise<void> {
    const boot = this.state.boot;
    if (!boot || this.closed) return;
    switch (type) {
      case 'onDocumentReady':
        this.set({ ready: true, editorProblem: null });
        if (!this.readySent) {
          this.readySent = true;
          void this.beat(this.now() - this.loadStartedAt);
          this.schedule(boot.heartbeat_interval_s);
        }
        return;
      case 'onDocumentStateChange': {
        const dirty = data === true;
        this.set(dirty ? { dirty: true, changed: true } : { dirty: false, savedAt: this.now() });
        if (!dirty) for (const w of [...this.cleanWaiters]) w();
        return;
      }
      case 'onError': {
        const d = (data ?? {}) as { errorDescription?: string };
        this.set({ editorProblem: d.errorDescription || 'The Office editor reported a problem.' });
        return;
      }
      case 'onRequestRefreshFile':
        return this.renew('editor');
      case 'onOutdatedVersion':
        return this.renew('reload');
      case 'onMetaChange': {
        const title = (data as { title?: string } | null)?.title;
        if (title && title !== boot.file.name) {
          this.set({ boot: { ...boot, file: { ...boot.file, name: title } } });
          this.hooks.renamed(title);
        }
        return;
      }
      case 'onRequestEditRights':
        await this.setMode('EDIT');
        return;
      case 'onRequestSharingSettings':
        this.hooks.share();
        return;
      case 'onRequestRename':
        await this.rename(String(data ?? ''));
        return;
      case 'onRequestUsers':
        await this.users((data as { c?: string; search?: string } | null) ?? null);
        return;
      case 'onRequestSendNotify': {
        const d = data as { emails: string[]; actionLink: string | null };
        await this.notify(d.emails, d.actionLink);
        return;
      }
      default:
        return;
    }
  }

  /** The editor's title (OO-COL-060): Drive's rename, then every open session's title. */
  async rename(title: string): Promise<void> {
    const boot = this.state.boot;
    if (!boot) return;
    let name = title.trim();
    if (!name) return;
    const ext = boot.file.extension;
    if (ext && !name.toLowerCase().endsWith(`.${ext.toLowerCase()}`)) name = `${name}.${ext}`;
    if (name === boot.file.name) return;
    try {
      await this.api.renameFile(this.fileId, name);
      await this.api.refreshTitle(this.fileId).catch(() => undefined);
      const now = this.state.boot;
      if (now) this.set({ boot: { ...now, file: { ...now.file, name } } });
      this.hooks.renamed(name);
      this.hooks.notice('success', `Renamed to “${name}”.`);
    } catch (e) {
      this.hooks.notice('error', refusalOf(e).message);
    }
  }

  /**
   * The @mention list (onRequestUsers): people the server says may be
   * mentioned, found by what was typed. The server searches from two
   * characters; an editor that asks for its whole list gets an empty one.
   */
  async users(data: { c?: string; search?: string } | null): Promise<void> {
    const boot = this.state.boot;
    const c = data?.c === 'protect' || data?.c === 'info' ? data.c : 'mention';
    const q = (data?.search ?? '').trim();
    if (!boot || c !== 'mention' || !boot.permissions.mention || q.length < 2) {
      this.port?.command({ type: 'setUsers', c, users: [] });
      return;
    }
    try {
      const r = await this.api.mentionable(this.fileId, q);
      const users = r.allowed ? r.users.slice(0, 100).map((u) => ({ id: u.id, name: u.name, email: u.email ?? u.mention_key })) : [];
      this.port?.command({ type: 'setUsers', c, users });
    } catch {
      this.port?.command({ type: 'setUsers', c, users: [] });
    }
  }

  /** A comment mentioned people (onRequestSendNotify): who and where, never the comment's text. */
  async notify(emails: string[], actionLink: string | null): Promise<void> {
    if (!emails.length) return;
    try {
      const r = await this.api.mention(this.fileId, emails.slice(0, 50), actionLink);
      if (r.notified.length) this.hooks.notice('success', `${names(r.notified.map((p) => p.name))} ${r.notified.length === 1 ? 'was' : 'were'} told about your comment.`);
      if (r.needs_share.length) {
        const who = names(r.needs_share.map((p) => p.name));
        this.hooks.notice('info', `${who} can't open this document, so ${r.needs_share.length === 1 ? 'wasn’t' : 'weren’t'} told. A mention never shares it.`, r.can_share ? { label: 'Share…', run: () => this.hooks.share() } : undefined);
      }
    } catch (e) {
      this.hooks.notice('error', refusalOf(e).message);
    }
  }

  // ── locks ──────────────────────────────────────────────────────────────

  async keepToMyself(): Promise<void> {
    const boot = this.state.boot;
    if (!boot) return;
    try {
      const r = await this.api.takeLock(this.fileId, boot.session_id);
      this.set({ lock: r.lock });
      this.hooks.notice('success', 'Only you can edit this document while you have it open.');
    } catch (e) {
      this.hooks.notice('error', refusalOf(e).message);
    }
  }

  async releaseLock(): Promise<void> {
    try {
      await this.api.releaseLock(this.fileId);
      this.set({ lock: null });
      this.hooks.notice('success', 'Others can edit this document again.');
    } catch (e) {
      this.hooks.notice('error', refusalOf(e).message);
    }
  }
}

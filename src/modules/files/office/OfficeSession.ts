import type { OfficeEditorCommand, OfficeEditorEvent, OfficeEditorEventName } from '@shared/office';
import { officeRefusal, type Collaborator, type MentionAnswer, type OfficeApi, type OfficeBootstrap, type OfficeLock, type OfficeMode, type OfficeRefusal, type ReadOnlyReason, type SaveStatus } from './api';

/**
 * One document open in a WorkSuite Office window, from the first request to
 * the last — the session API's life cycle, as the web's `OfficeSession` runs
 * it, kept out of React so it can be driven and tested on its own:
 *
 *   open      POST …/office/session → the bootstrap → the editor view loads
 *             `api_url` and is given the signed `config` exactly as it came
 *   keep      a heartbeat every `next_heartbeat_s`; the first after the
 *             document is drawn carries `ready_ms`
 *   renew     GET …/config before `expires_at`, and whenever the editor asks
 *   reload    `reload: true`, a newer version chosen, a mode switch — the
 *             editor is built again from the answer's `config`
 *   reopen    410 → a new session; twice without a working editor is the end
 *   end       the session is over for good: the editor goes, the sentence stays
 *
 * The editor is not on this page: it is the window's editor view (see
 * `shared/office.ts`), reached through `EditorLink`. Each build is numbered;
 * events from an older build are ignored.
 *
 * THE DOCUMENT SERVER DECIDES "SAVED"; WORKSUITE DECIDES "VERSION". `dirty` is
 * the editor's own `onDocumentStateChange`; `save` is the server's status.
 * The window never downloads and uploads the document itself.
 */

export type Phase = 'opening' | 'ready' | 'refused' | 'ended';

export interface OfficeSessionState {
  phase: Phase;
  boot: OfficeBootstrap | null;
  loaded: boolean;
  refusal: OfficeRefusal | null;
  ended: string | null;
  dirty: boolean;
  savedAt: number | null;
  connection: 'ok' | 'reconnecting';
  save: SaveStatus | null;
  collaborators: Collaborator[];
  lock: OfficeLock | null;
  mode: OfficeMode | null;
  availableModes: OfficeMode[];
  readOnlyReason: ReadOnlyReason | null;
  newVersion: boolean;
  canSwitchToEdit: boolean;
  notice: string | null;
  busy: boolean;
}

/** The window's editor view, as the session drives it. */
export interface EditorLink {
  send(cmd: OfficeEditorCommand): Promise<void>;
  onEvent(cb: (e: OfficeEditorEvent) => void): () => void;
}

export interface OfficeSessionHooks {
  onRequestClose?: () => void;
  onRequestShare?: () => void;
  onTitle?: (title: string) => void;
  onMention?: (answer: MentionAnswer | null, refusal?: OfficeRefusal) => void;
  onDownloadUrl?: (url: string) => void;
  /** Realtime: `cb` for every event; returns the way to stop. */
  realtime?: (cb: (e: { type?: unknown; file_id?: unknown; source_file_id?: unknown }) => void) => () => void;
  /** The session, and whether there is anything unsaved, for the main process (closing, switching organisation). */
  onTrack?: (info: { sessionId: string | null; dirty: boolean; name?: string }) => void;
}

/** The editor's error codes that mean its tokens are out of date (sdkjs `errorCodes.js`). */
const TOKEN_ERRORS = new Set([-20, -21, -102, -120, -121, -122]);
const DISCONNECTED = -18;
const USER_DROPPED = -100;
const MINUTE = 60_000;

const initial: OfficeSessionState = {
  phase: 'opening', boot: null, loaded: false, refusal: null, ended: null, dirty: false, savedAt: null,
  connection: 'ok', save: null, collaborators: [], lock: null, mode: null, availableModes: [], readOnlyReason: null,
  newVersion: false, canSwitchToEdit: false, notice: null, busy: false,
};

export class OfficeSession {
  private state: OfficeSessionState = initial;
  private readonly listeners = new Set<() => void>();
  private timers: { beat?: ReturnType<typeof setTimeout>; renew?: ReturnType<typeof setTimeout>; soon?: ReturnType<typeof setTimeout> } = {};
  private run = 0;
  private build = 0;
  private openedAt = 0;
  private readySent = false;
  private lastTokenRenew = 0;
  private reopens = 0;
  private closed = false;
  private offEditor: (() => void) | null = null;
  private offRealtime: (() => void) | null = null;
  private tracked = '';

  constructor(
    private readonly fileId: number,
    private readonly api: OfficeApi,
    private readonly editor: EditorLink,
    private readonly requested: OfficeMode | null = null,
    private readonly hooks: OfficeSessionHooks = {},
  ) {}

  getState = (): OfficeSessionState => this.state;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  private set(patch: Partial<OfficeSessionState>): void {
    this.state = { ...this.state, ...patch };
    this.track();
    this.listeners.forEach((fn) => fn());
  }

  /** Tell the main process what it needs to know, only when that changed. */
  private track(): void {
    const s = this.state;
    const sessionId = s.phase === 'ready' || s.phase === 'opening' ? (s.boot?.session_id ?? null) : null;
    const name = s.boot?.file.name;
    const key = `${sessionId}|${s.dirty}|${name ?? ''}`;
    if (key === this.tracked) return;
    this.tracked = key;
    this.hooks.onTrack?.({ sessionId, dirty: s.dirty, ...(name ? { name } : {}) });
  }

  get sessionId(): string | null {
    return this.state.boot?.session_id ?? null;
  }

  /* ───────────────────────── opening ───────────────────────── */

  async start(mode: OfficeMode | null = this.requested): Promise<void> {
    const run = ++this.run;
    this.closed = false;
    this.listen();
    this.set({ phase: 'opening', refusal: null, ended: null, busy: true, notice: null });
    try {
      const boot = await this.api.openSession(this.fileId, mode);
      if (run !== this.run) {
        void this.api.endSession(this.fileId, boot.session_id).catch(() => undefined);
        return;
      }
      await this.mount(boot, run);
    } catch (e) {
      if (run !== this.run) return;
      this.set({ phase: 'refused', refusal: officeRefusal(e, 'This document could not be opened.'), busy: false });
    }
  }

  private async mount(boot: OfficeBootstrap, run: number, notice: string | null = null): Promise<void> {
    this.stopTimers();
    this.adopt(boot);
    const build = ++this.build;
    this.openedAt = Date.now();
    this.readySent = false;
    try {
      await this.editor.send({ op: 'load', build, apiUrl: boot.api_url, config: boot.config, events: this.eventNames(boot) });
    } catch (e) {
      if (run !== this.run) return;
      void this.api.endSession(this.fileId, boot.session_id).catch(() => undefined);
      this.set({
        phase: 'refused',
        busy: false,
        refusal: {
          status: 503,
          code: 'OFFICE_PROVIDER_UNAVAILABLE',
          message: e instanceof Error && e.message ? e.message : 'The Document Server could not be opened here.',
          actions: ['retry', 'open_in_browser'],
          details: {},
        },
      });
      return;
    }
    if (run !== this.run) return;
    this.reopens = 0;
    this.set({ phase: 'ready', loaded: false, dirty: false, connection: 'ok', busy: false, notice });
    this.scheduleBeat(boot.heartbeat_interval_s);
    this.scheduleRenew(boot.expires_at);
  }

  private adopt(boot: OfficeBootstrap): void {
    this.set({
      boot,
      mode: boot.mode,
      availableModes: boot.available_modes,
      readOnlyReason: boot.mode === 'VIEW' ? boot.read_only_reason : null,
      lock: boot.lock,
      collaborators: boot.collaborators,
      save: boot.save,
      newVersion: boot.new_version_available,
      canSwitchToEdit: false,
    });
  }

  /**
   * The events the editor is given. Share, Rename, @-mentions and the working
   * copy's download only when the person may: the editor shows those only
   * when their event is there to answer them.
   */
  private eventNames(boot: OfficeBootstrap): OfficeEditorEventName[] {
    const p = boot.permissions;
    const names: OfficeEditorEventName[] = ['onDocumentReady', 'onDocumentStateChange', 'onError', 'onRequestRefreshFile', 'onOutdatedVersion', 'onRequestClose', 'onMetaChange'];
    if (p.share) names.push('onRequestSharingSettings');
    if (p.mention) names.push('onRequestUsers', 'onRequestSendNotify');
    if (p.download) names.push('onDownloadAs');
    return names;
  }

  /** An event from the editor view: only the current build's. */
  private onEditorEvent = (ev: OfficeEditorEvent): void => {
    if (ev.build !== this.build || this.state.phase !== 'ready') return;
    const data = ev.data;
    switch (ev.type) {
      case 'onDocumentReady':
        this.set({ loaded: true, connection: 'ok' });
        if (!this.readySent) {
          this.readySent = true;
          void this.beat(Math.max(0, Date.now() - this.openedAt));
        }
        return;
      case 'onDocumentStateChange':
        this.set(data === true ? { dirty: true } : { dirty: false, savedAt: Date.now(), connection: 'ok' });
        return;
      case 'onError': {
        const code = Number((data as { errorCode?: unknown } | null)?.errorCode);
        if (TOKEN_ERRORS.has(code)) void this.renewForEditor();
        else if (code === USER_DROPPED) void this.beat();
        else if (code === DISCONNECTED) this.set({ connection: 'reconnecting' });
        return;
      }
      case 'onRequestRefreshFile':
        void this.renewForEditor();
        return;
      case 'onOutdatedVersion':
        void this.reload();
        return;
      case 'onRequestClose':
        this.hooks.onRequestClose?.();
        return;
      case 'onMetaChange': {
        const title = (data as { title?: unknown } | null)?.title;
        if (typeof title === 'string' && title !== '') this.hooks.onTitle?.(title);
        return;
      }
      case 'onRequestSharingSettings':
        if (this.state.boot?.permissions.share) this.hooks.onRequestShare?.();
        return;
      case 'onRequestUsers':
        if (this.state.boot?.permissions.mention) void this.users((data as Record<string, unknown> | null) ?? {});
        return;
      case 'onRequestSendNotify':
        if (this.state.boot?.permissions.mention) void this.notify((data as Record<string, unknown> | null) ?? {});
        return;
      case 'onDownloadAs': {
        const url = (data as { url?: unknown } | null)?.url;
        if (this.state.boot?.permissions.download && typeof url === 'string') this.hooks.onDownloadUrl?.(url);
        return;
      }
      case 'scriptError':
        void this.api.endSession(this.fileId, this.state.boot?.session_id ?? '').catch(() => undefined);
        this.stopTimers();
        this.set({
          phase: 'refused',
          busy: false,
          refusal: {
            status: 503,
            code: 'OFFICE_PROVIDER_UNAVAILABLE',
            message: 'The Document Server could not be reached from this computer. Try again in a minute, or open the document in the browser.',
            actions: ['retry', 'open_in_browser', ...(this.state.boot?.permissions.download ? ['download'] : [])],
            details: {},
          },
        });
        return;
      default:
        return;
    }
  };

  /* ───────────────────────── keeping it alive ───────────────────────── */

  private scheduleBeat(seconds: number): void {
    clearTimeout(this.timers.beat);
    this.timers.beat = setTimeout(() => void this.beat(), Math.max(5, seconds || 60) * 1000);
  }

  /** Renew a minute and a half before the signed configuration runs out. */
  private scheduleRenew(expiresAt: string): void {
    clearTimeout(this.timers.renew);
    const at = Date.parse(expiresAt);
    const wait = Number.isFinite(at) ? Math.max(10_000, at - Date.now() - 90_000) : 8 * MINUTE;
    this.timers.renew = setTimeout(() => void this.renew(), wait);
  }

  /** A heartbeat now, once — for a realtime event, which only says "look again". */
  beatSoon(ms = 400): void {
    clearTimeout(this.timers.soon);
    this.timers.soon = setTimeout(() => void this.beat(), ms);
  }

  private async beat(readyMs?: number): Promise<void> {
    const boot = this.state.boot;
    const run = this.run;
    if (!boot || this.state.phase !== 'ready') return;
    clearTimeout(this.timers.beat);
    try {
      const hb = await this.api.heartbeat(this.fileId, boot.session_id, readyMs);
      if (run !== this.run || this.state.boot?.session_id !== boot.session_id) return;
      this.set({
        save: hb.save,
        collaborators: hb.collaborators,
        lock: hb.lock,
        mode: hb.mode,
        availableModes: hb.available_modes,
        readOnlyReason: hb.mode === 'VIEW' ? hb.read_only_reason : null,
        newVersion: hb.new_version_available,
        canSwitchToEdit: hb.can_switch_to_edit,
      });
      if (hb.reload) {
        await this.reload(hb.read_only_reason?.message ?? 'Editing is no longer available. The document is open read-only.');
        return;
      }
      this.scheduleBeat(hb.next_heartbeat_s);
    } catch (e) {
      if (run !== this.run || this.state.boot?.session_id !== boot.session_id) return;
      this.onLost(officeRefusal(e), () => this.scheduleBeat(boot.heartbeat_interval_s));
    }
  }

  /**
   * A failed heartbeat or renewal. 410: the session ended — for good when the
   * file went to the bin or access went, otherwise a new one. Anything else
   * (the network, a restart) is tried again on the next beat.
   */
  private onLost(r: OfficeRefusal, otherwise: () => void): void {
    const endedForGood = r.details.reason === 'trashed' || r.details.reason === 'access_removed' || (r.status !== 410 && r.details.session_ended === true);
    if (endedForGood) this.finish(r.message);
    else if (r.status === 410 || r.code === 'OFFICE_SESSION_NOT_FOUND') void this.reopen();
    else otherwise();
  }

  private finish(message: string): void {
    this.stopTimers();
    this.destroyEditor();
    this.set({ phase: 'ended', ended: message, busy: false, dirty: false });
  }

  private async reopen(): Promise<void> {
    if (this.reopens++ >= 2) {
      this.finish('This editing session has ended. Open the document again to carry on.');
      return;
    }
    const mode = this.state.mode && this.state.mode !== 'VIEW' ? this.state.mode : this.requested;
    this.stopTimers();
    this.set({ busy: true });
    const run = this.run;
    try {
      const boot = await this.api.openSession(this.fileId, mode);
      if (run !== this.run) return;
      await this.mount(boot, run, 'The editing session was renewed. Your work is where you left it.');
    } catch (e) {
      if (run !== this.run) return;
      if (mode) {
        // The mode they were in may not be theirs any more: the server's default for them, then.
        try {
          const boot = await this.api.openSession(this.fileId, null);
          if (run !== this.run) return;
          await this.mount(boot, run, boot.read_only_reason?.message ?? null);
          return;
        } catch (e2) {
          if (run !== this.run) return;
          this.destroyEditor();
          this.set({ phase: 'refused', refusal: officeRefusal(e2, 'This document could not be opened again.'), busy: false });
          return;
        }
      }
      this.destroyEditor();
      this.set({ phase: 'refused', refusal: officeRefusal(e, 'This document could not be opened again.'), busy: false });
    }
  }

  /** GET …/config: new tokens, the mode checked again. @returns whether the editor was built again. */
  private async renew(): Promise<boolean> {
    const boot = this.state.boot;
    const run = this.run;
    if (!boot || this.state.phase !== 'ready') return false;
    clearTimeout(this.timers.renew);
    try {
      const next = await this.api.reloadSession(this.fileId, boot.session_id);
      if (run !== this.run) return false;
      if (next.session_id !== boot.session_id || next.document_key !== boot.document_key || next.mode !== boot.mode) {
        await this.mount(next, run, next.mode !== boot.mode && next.mode === 'VIEW' ? (next.read_only_reason?.message ?? null) : null);
        return true;
      }
      this.adopt(next);
      this.scheduleRenew(next.expires_at);
      return false;
    } catch (e) {
      if (run !== this.run) return false;
      this.onLost(officeRefusal(e), () => {
        clearTimeout(this.timers.renew);
        this.timers.renew = setTimeout(() => void this.renew(), MINUTE);
      });
      return false;
    }
  }

  private async renewForEditor(): Promise<void> {
    // A token error the renewed tokens do not cure would otherwise loop.
    if (Date.now() - this.lastTokenRenew < 20_000) return;
    this.lastTokenRenew = Date.now();
    const rebuilt = await this.renew();
    const boot = this.state.boot;
    if (rebuilt || !boot || this.state.phase !== 'ready') return;
    await this.editor.send({ op: 'refreshFile', config: boot.config }).catch(() => undefined);
  }

  /** Build the editor again from a renewed session: editing taken away, or a newer version chosen. */
  async reload(notice: string | null = null): Promise<void> {
    const boot = this.state.boot;
    const run = this.run;
    if (!boot) return;
    this.set({ busy: true });
    try {
      const next = await this.api.reloadSession(this.fileId, boot.session_id);
      if (run !== this.run) return;
      await this.mount(next, run, notice);
    } catch (e) {
      if (run !== this.run) return;
      this.set({ busy: false });
      const r = officeRefusal(e);
      this.onLost(r, () => this.set({ notice: r.message }));
    }
  }

  /* ───────────────────────── what the person does ───────────────────────── */

  /** Switch mode in the same session; the editor is built again from the answer. Throws the refusal. */
  async setMode(mode: OfficeMode): Promise<void> {
    const boot = this.state.boot;
    const run = this.run;
    if (!boot || mode === this.state.mode) return;
    this.set({ busy: true });
    try {
      const next = await this.api.switchMode(this.fileId, boot.session_id, mode);
      if (run !== this.run) return;
      await this.mount(next, run);
    } catch (e) {
      this.set({ busy: false });
      throw officeRefusal(e, 'The mode could not be changed.');
    }
  }

  /** Save now, or — with a label — a named version. Throws the refusal. */
  async saveNow(label?: string): Promise<{ state: string; message: string }> {
    const boot = this.state.boot;
    if (!boot) throw officeRefusal(null);
    try {
      const r = await this.api.forceSave(this.fileId, boot.session_id, label);
      this.beatSoon(3000);
      return r;
    } catch (e) {
      throw officeRefusal(e, 'The document could not be saved now.');
    }
  }

  async retrySave(): Promise<void> {
    try {
      this.set({ save: await this.api.retrySave(this.fileId) });
    } catch (e) {
      throw officeRefusal(e, 'The save could not be retried.');
    }
  }

  /** "Download working copy" of a failed save: the editor's own copy (needs download). */
  downloadWorkingCopy(): boolean {
    if (!this.state.boot?.permissions.download || this.state.phase !== 'ready') return false;
    void this.editor.send({ op: 'downloadAs' }).catch(() => undefined);
    return true;
  }

  /** Close: the session ends, the editor goes. */
  async close(): Promise<void> {
    const boot = this.state.boot;
    this.closed = true;
    this.dispose();
    if (boot) await this.api.endSession(this.fileId, boot.session_id).catch(() => undefined);
  }

  /** Stop everything this session holds. A session not closed deliberately is ended by the main process with its window. */
  dispose(): void {
    this.run++;
    this.stopTimers();
    this.destroyEditor();
    this.offEditor?.();
    this.offEditor = null;
    this.offRealtime?.();
    this.offRealtime = null;
    if (this.closed) this.hooks.onTrack?.({ sessionId: null, dirty: false });
  }

  /* ───────────────────────── mentions ───────────────────────── */

  /**
   * The editor's @-list. WorkSuite answers people matching what was typed
   * (two characters at least), each with their address only when the server
   * shows it, else a `mention_key` that maps back to exactly one person.
   */
  private async users(data: Record<string, unknown>): Promise<void> {
    const c = typeof data.c === 'string' ? data.c : 'mention';
    if (c === 'info') {
      const ids = Array.isArray(data.id) ? data.id.map(String) : [];
      const users = this.state.collaborators
        .filter((p) => ids.includes(String(p.user.id)))
        .map((p) => ({ id: String(p.user.id), name: p.user.name, ...(p.user.avatar ? { image: p.user.avatar } : {}) }));
      await this.editor.send({ op: 'setUsers', data: { c, users } }).catch(() => undefined);
      return;
    }
    const search = typeof data.search === 'string' ? data.search.trim() : '';
    if (search.length < 2 || Number(data.from ?? 0) > 0) {
      await this.editor.send({ op: 'setUsers', data: { c, users: [], isPaginated: true } }).catch(() => undefined);
      return;
    }
    let users: Array<{ id: string; name: string; email: string }> = [];
    try {
      const r = await this.api.mentionable(this.fileId, search);
      users = r.allowed ? r.users.map((u) => ({ id: u.id, name: u.name, email: u.email ?? u.mention_key })) : [];
    } catch {
      users = [];
    }
    await this.editor.send({ op: 'setUsers', data: { c, users, isPaginated: true } }).catch(() => undefined);
  }

  /** A mention in a comment. The comment's text is never sent. */
  private async notify(data: Record<string, unknown>): Promise<void> {
    const emails = Array.isArray(data.emails) ? data.emails.filter((x): x is string => typeof x === 'string') : [];
    if (emails.length === 0) return;
    const link = data.actionLink === undefined ? undefined : JSON.stringify(data.actionLink);
    try {
      this.hooks.onMention?.(await this.api.mention(this.fileId, { emails, ...(link ? { action_link: link } : {}) }));
    } catch (e) {
      this.hooks.onMention?.(null, officeRefusal(e, 'The people you mentioned could not be told.'));
    }
  }

  /* ───────────────────────── plumbing ───────────────────────── */

  private listen(): void {
    if (!this.offEditor) this.offEditor = this.editor.onEvent(this.onEditorEvent);
    if (!this.offRealtime && this.hooks.realtime) {
      // Every `office.*` event about this file means "ask again": the heartbeat has the rest.
      this.offRealtime = this.hooks.realtime((e) => {
        if (typeof e.type !== 'string' || !e.type.startsWith('office.')) return;
        if (Number(e.file_id ?? e.source_file_id) !== this.fileId) return;
        this.beatSoon();
      });
    }
  }

  private stopTimers(): void {
    clearTimeout(this.timers.beat);
    clearTimeout(this.timers.renew);
    clearTimeout(this.timers.soon);
    this.timers = {};
  }

  private destroyEditor(): void {
    this.build++;
    void this.editor.send({ op: 'destroy' }).catch(() => undefined);
  }
}

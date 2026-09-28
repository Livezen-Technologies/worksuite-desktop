import type { DesktopPolicy, RemoteControlConsent, RemoteControlOffer, RemoteControlRequestView, RemoteControlSessionView, RemoteControlSupport, RemoteControlView } from '@shared/types';
import { ControlReceiver, acceleratorsFor, chordOf, importKeys, parseChord, parseEnvelope, type Caps, type Refusal } from '@shared/remote-control/channel';
import { DesktopError, isDesktopError } from '../../main/errors';
import { logger } from '../../main/log';
import { checkGrant, type GrantDelivery } from './grant';
import type { Foreground, InputAction, Injector, Rect } from './input';
import { Held, comboActions, keyActions, place, pointerActions, type Point } from './mapping';

const log = logger('remote-control');

/**
 * Meet remote control, on the computer being shared (WS-MEET-ENH-01 §E).
 *
 * The main process, not the meeting window, holds everything that matters:
 * the share's record, the grant and its key, the consent, the decision on
 * every message and the input helper. The meeting window only relays what
 * arrives on the data channel; it never sees a key and cannot inject.
 *
 *   share started ─▶ registered with the server as WorkSuite Desktop
 *   request ───────▶ consent window (RC03); allowing needs a real click or
 *                    key press in that window, with nothing injected since
 *   approved ──────▶ grant fetched once, signature and claims checked,
 *                    confirmed; the indicator (RC04) goes up
 *   each message ──▶ ControlReceiver (§B.4) ─▶ gates here ─▶ input helper
 *
 * The gates: a consent window is open (nothing is injected while one is);
 * the person here moved the mouse (they win for `local_priority_hold_ms`);
 * a window share whose window is not in front (keys wait); the lock screen,
 * sleep and protected apps pause control on the server. The emergency chord
 * stops it outright.
 */

type Status = RemoteControlSessionView['status'];

interface StateShare {
  id: number;
  identity: string;
}

interface StateRequest {
  id: number;
  session_id: number;
  share_id: number;
  kind: 'request' | 'handover' | 'increase';
  requester: { id: number; name: string };
  reason: string | null;
  expires_in: number;
}

interface StateSession {
  id: number;
  share_id: number;
  status: string;
  role: 'sharer' | 'controller';
  pause_reason: string | null;
  caps: Caps;
  caps_label: string;
  controller: { id: number; name: string; identity: string };
  expires_at: string | null;
  key_version: number | null;
  grant_waiting: boolean;
  type: 'meeting' | 'support' | 'call';
}

/** A file offered in a session, as `GET control/sessions/{id}/files` lists it. */
interface FileRow {
  id: number;
  session_id: number;
  direction: 'to_sharer' | 'to_controller';
  sender: { id: number; name: string };
  name: string;
  size: number;
  executable: boolean;
  scan: 'clean' | 'not_scanned' | 'infected';
  status: string;
}

export interface ControlState {
  shares: StateShare[];
  asked: StateRequest[];
  sessions: StateSession[];
}

/** What was captured, as the capture handler granted it — never what the page says it shared. */
export interface CapturedSource {
  id: string;
  name: string;
  kind: 'screen' | 'window';
  displayId: string | null;
  windowId: string | null;
}

interface Share {
  uuid: string;
  shareId: number;
  identity: string;
  webContentsId: number;
  source: CapturedSource | null;
  allowRequests: boolean;
  paused: boolean;
}

interface Live {
  id: number;
  status: Status;
  controller: string;
  controllerIdentity: string;
  caps: Caps;
  capsLabel: string;
  pauseReason: string | null;
  expiresAt: string | null;
  keyVersion: number | null;
  type: StateSession['type'];
  receiver: ControlReceiver | null;
  receiverVersion: number | null;
  fetching: boolean;
  activeSince: number | null;
  lastInput: number;
  /** Paused here and told to the server, before the server's answer comes back. */
  pausedHere: boolean;
  /** When it was paused here: a state read that started earlier cannot undo it. */
  pausedAt: number;
  /** The server has heard of the pause made here (it takes a pause only while control is active). */
  pauseSent: boolean;
  /** When the person here last resumed: a new key after that, and only then, lifts a pause made here. */
  resumedAt: number;
  /** When the current receiver (its key) was set up: messages under the old key are expected for a moment. */
  receiverAt: number;
}

export interface Display {
  id: number;
  bounds: Rect;
}

export interface RemoteControlDeps {
  http: {
    get<T>(path: string, opts?: { query?: Record<string, string | number | boolean | null | undefined> }): Promise<T>;
    request<T>(method: string, path: string, opts?: { body?: unknown }): Promise<T>;
  };
  deviceId: () => number | null;
  policy: () => DesktopPolicy;
  support: () => RemoteControlSupport;
  pinnedKey: string | null;
  createInjector: () => Injector | null;
  screen: {
    displays(): Display[];
    primary(): Display;
    /** The pointer, in the same coordinates as display bounds. */
    cursor(): Point;
    /** Display coordinates → the input helper's (physical pixels on Windows and X11). */
    toInput(p: Point): Point;
    /** The other way, for comparing the pointer with where it was put. */
    fromInput(p: Point): Point;
  };
  ui: {
    showConsent(requestId: number, near: Display | null): void;
    closeConsent(requestId: number): void;
    consentOpen(): boolean;
    /** Which request the consent window with this web contents is for, or null. */
    consentFor(webContentsId: number): number | null;
    isIndicator(webContentsId: number): boolean;
    showIndicator(on: Display | null): void;
    hideIndicator(): void;
    notify(text: string): void;
    changed(view: RemoteControlView): void;
    /** Share screen `n` (1-based, the system's order) in that meeting window instead: a controller allowed to switch asked. */
    switchScreen(webContentsId: number, n: number): Promise<boolean>;
  };
  shortcuts: { register(accelerator: string, fn: () => void): boolean; unregister(accelerator: string): void };
  clipboard: { writeText(text: string): void };
  files: {
    /** Fetch an accepted file into the download folder (the transfer list shows it). */
    download(apiPath: string, name: string): Promise<void>;
    /** Let the person here choose files in the system's dialog and offer them in the session; how many went. */
    pickAndOffer(sessionId: number, to: string): Promise<number>;
  };
  prefs: { allowRequests(): boolean; setAllowRequests(v: boolean): void };
  now?: () => number;
  timers?: { every(ms: number, fn: () => void): () => void; after(ms: number, fn: () => void): () => void };
}

const LIVE: Status[] = ['CONTROL_APPROVED', 'CONTROL_ACTIVE', 'CONTROL_PAUSED'];
const REPORTED: Refusal[] = ['bad_mac', 'stale_sequence', 'input_burst', 'wrong_sender', 'out_of_bounds', 'reserved_chord'];
/** Apps whose windows nobody else should drive: password managers and the system's own prompts. */
const PROTECTED = ['1password', 'keepass', 'bitwarden', 'lastpass', 'dashlane', 'enpass', 'keeper', 'keychain access', 'securityagent', 'credential', 'consent.exe', 'windows security', 'polkit', 'gcr-prompter', 'pinentry', 'seahorse'];

/** Why control is paused, as the indicator says it (RC04). */
export function pauseText(reason: string | null): string {
  switch (reason) {
    case 'lock_screen':
      return 'Paused while the screen is locked.';
    case 'secure_desktop':
      return 'Paused while a system prompt is in front — nobody else can answer it.';
    case 'protected_app':
      return 'Paused while a password manager or system prompt is in front.';
    case 'idle':
      return 'Paused: nothing was done for a while.';
    case 'sleep':
      return 'Paused while the computer slept.';
    case 'user_switch':
      return 'Paused while another user was signed in.';
    case 'security':
      return 'Paused: more input arrived at once than a person could send. Your administrators have been told.';
    case 'share_paused':
      return 'Paused while your screen sharing is paused.';
    case 'network':
      return 'Paused: the connection dropped.';
    default:
      return 'You paused control.';
  }
}

/**
 * A chord that switches to another app: Alt+Tab, Command+Tab, Windows+Tab,
 * or the Windows or Command key sent on its own from the special-keys menu.
 * Command itself still works (Cmd+C on a Mac); a Windows-key tap that opens
 * Start is caught by the foreground check, which then holds keys back.
 */
export function switchesApps(chord: string): boolean {
  const c = parseChord(chord);
  if (c.key === 'Tab' && (c.mods.has('Alt') || c.mods.has('Meta'))) return true;
  return c.key === '' && c.mods.size === 1 && c.mods.has('Meta');
}

/** Whether an app in front is one control must not reach. */
export function isProtected(fg: Pick<Foreground, 'app' | 'title'> | null): boolean {
  if (!fg) return false;
  const hay = `${fg.app} ${fg.title}`.toLowerCase();
  return PROTECTED.some((p) => hay.includes(p));
}

export class RemoteControlService {
  private share: Share | null = null;
  private sessions = new Map<number, Live>();
  private requests = new Map<number, StateRequest>();
  private injector: Injector | null = null;
  private injectorReady: Promise<boolean> | null = null;
  private held = new Held();
  private queue: Promise<void> = Promise.resolve();
  private queued = 0;
  private lastInjected = 0;
  private expected: Point | null = null;
  private lastCursor: Point | null = null;
  private readingPointer = false;
  private localUntil = 0;
  private windowRect: Rect | null = null;
  private keysAllowed = true;
  private emptyForeground = 0;
  private refusals = new Map<string, number>();
  private proofs = new Map<number, number>();
  private chords: string[] = [];
  private chordOk = true;
  private stops: Array<() => void> = [];
  private polling: Promise<void> | null = null;
  private offers = new Map<number, RemoteControlOffer>();
  /** The system's file dialog is open for sending: nothing is injected into it. */
  private dialogOpen = false;
  /** Sessions this computer stopped: never taken up again. */
  private ended = new Set<number>();
  private pollAgain: Promise<void> | null = null;
  private pollTimer: (() => void) | null = null;
  private capabilitiesSent = '';
  private readonly now: () => number;
  private readonly timers: NonNullable<RemoteControlDeps['timers']>;

  constructor(private readonly deps: RemoteControlDeps) {
    this.now = deps.now ?? (() => Date.now());
    this.timers = deps.timers ?? {
      every: (ms, fn) => {
        const t = setInterval(fn, ms);
        t.unref?.();
        return () => clearInterval(t);
      },
      after: (ms, fn) => {
        const t = setTimeout(fn, ms);
        t.unref?.();
        return () => clearTimeout(t);
      },
    };
  }

  // ── the view every remote-control screen reads ──────────────────────────

  view(): RemoteControlView {
    const live = this.current();
    const policy = this.deps.policy();
    return {
      support: this.deps.support(),
      allowRequests: this.deps.prefs.allowRequests(),
      emergencyChord: policy.remote_emergency_stop_chord,
      chordRegistered: this.chordOk,
      share: this.share
        ? { uuid: this.share.uuid, shareId: this.share.shareId, label: this.share.source?.name ?? 'your screen', kind: this.share.source?.kind ?? 'screen', allowRequests: this.share.allowRequests, paused: this.share.paused }
        : null,
      requests: [...this.requests.values()].map((r): RemoteControlRequestView => ({ id: r.id, sessionId: r.session_id, kind: r.kind, requester: r.requester.name, reason: r.reason, expiresIn: r.expires_in })),
      offers: [...this.offers.values()],
      canSendFiles: !!live && live.caps.file_transfer && live.status === 'CONTROL_ACTIVE',
      session: live
        ? {
            id: live.id,
            status: live.pausedHere && live.status === 'CONTROL_ACTIVE' ? 'CONTROL_PAUSED' : live.status,
            controller: live.controller,
            controllerIdentity: live.controllerIdentity,
            capsLabel: live.capsLabel,
            pauseReason: live.pauseReason,
            pauseText: live.status === 'CONTROL_PAUSED' || live.pausedHere ? pauseText(live.pauseReason) : null,
            since: live.activeSince,
            expiresAt: live.expiresAt,
            waiting: live.status !== 'CONTROL_ACTIVE' || live.pausedHere ? null : this.now() < this.localUntil ? 'local' : !this.keysAllowed ? 'window' : null,
            type: live.type,
          }
        : null,
    };
  }

  /** Control is live on this computer: approved, active or paused. */
  isLive(): boolean {
    return this.sessions.size > 0;
  }

  isSharing(): boolean {
    return this.share !== null;
  }

  setAllowRequests(v: boolean): RemoteControlView {
    this.deps.prefs.setAllowRequests(v);
    this.changed();
    return this.view();
  }

  private current(): Live | null {
    let best: Live | null = null;
    for (const s of this.sessions.values()) if (!best || s.id > best.id) best = s;
    return best;
  }

  private changed(): void {
    this.deps.ui.changed(this.view());
  }

  // ── what this computer can do, told to the server (WF-RC-08) ───────────

  async reportCapabilities(info: { platform: 'windows' | 'macos' | 'linux'; osVersion: string; desktopVersion: string; screenPermission: string; displays: number }): Promise<void> {
    const id = this.deps.deviceId();
    if (!id) return;
    const s = this.deps.support();
    const body = {
      platform: info.platform,
      os_version: info.osVersion.slice(0, 64),
      desktop_version: info.desktopVersion.slice(0, 32),
      display_server: s.displayServer,
      screen_capture_supported: info.screenPermission !== 'denied',
      remote_input_supported: s.available && s.policyAllows,
      window_confined_input: s.available,
      clipboard_supported: true,
      multi_monitor_supported: info.displays > 1,
      screen_permission: ['granted', 'denied'].includes(info.screenPermission) ? info.screenPermission : info.platform === 'macos' ? 'unknown' : 'not_required',
      accessibility_permission: s.accessibility,
      displays: info.displays,
    };
    const key = JSON.stringify(body);
    if (key === this.capabilitiesSent) return;
    try {
      await this.deps.http.request('PUT', `/api/meet/devices/${id}/capabilities`, { body });
      this.capabilitiesSent = key;
    } catch (e) {
      log.info('capabilities not reported', { error: String((e as Error).message ?? e) });
    }
  }

  // ── the share ──────────────────────────────────────────────────────────

  /**
   * The meeting window started sharing `source` (what the capture handler
   * actually granted it). Registered as a desktop share; control is offered
   * only when this computer can be controlled and the person said so.
   */
  async shareStarted(webContentsId: number, input: { uuid: string; identity: string; quality?: string; allowRequests?: boolean }, source: CapturedSource | null): Promise<{ shareId: number; controlOffered: boolean; why: string | null }> {
    const support = this.deps.support();
    const wanted = input.allowRequests ?? this.deps.prefs.allowRequests();
    const offered = wanted && support.available && support.policyAllows && source !== null;
    const why = !wanted ? null : !source ? 'What is shared could not be matched to a screen or window, so it can be watched but not controlled.' : !support.policyAllows ? "This computer's policy doesn't let others control it." : support.reason;

    // One share per person: whatever this window shared before has ended.
    if (this.share) this.endLocally('share_stopped');
    const share = await this.deps.http.request<{ id: number }>('POST', `/api/meet/${encodeURIComponent(input.uuid)}/control/shares`, {
      body: {
        identity: input.identity,
        client: 'desktop',
        surface: source?.kind ?? 'screen',
        label: (source?.name ?? '').slice(0, 120),
        quality: ['auto', 'quality', 'balanced', 'performance'].includes(input.quality ?? '') ? input.quality : 'auto',
        allow_requests: offered,
      },
    });
    this.share = { uuid: input.uuid, shareId: Number(share.id), identity: input.identity, webContentsId, source, allowRequests: offered, paused: false };
    // One window shared: keys wait until it has been seen in front.
    this.keysAllowed = source?.kind !== 'window';
    this.startPolling();
    this.changed();
    return { shareId: this.share.shareId, controlOffered: offered, why: offered ? null : why };
  }

  /**
   * What the window shares changed without a new share. When this computer
   * switched it for the controller (monitor switch), control goes on; when
   * the person here picked something else, live control ends — they allowed
   * control of what they were sharing then.
   */
  async shareChanged(webContentsId: number, source: CapturedSource | null, byController: boolean): Promise<void> {
    if (!this.share || this.share.webContentsId !== webContentsId) return;
    this.share.source = source;
    this.windowRect = null;
    this.keysAllowed = source?.kind !== 'window';
    if (!byController) for (const s of [...this.sessions.values()]) await this.stop(s.id, 'stopped');
    this.changed();
  }

  async shareStopped(webContentsId: number): Promise<void> {
    const share = this.share;
    if (!share || share.webContentsId !== webContentsId) return;
    this.endLocally('share_stopped');
    try {
      await this.deps.http.request('DELETE', `/api/meet/${encodeURIComponent(share.uuid)}/control/shares/${share.shareId}`);
    } catch (e) {
      log.info('share stop not recorded', { error: String((e as Error).message ?? e) });
    }
  }

  async sharePaused(webContentsId: number, paused: boolean): Promise<void> {
    const share = this.share;
    if (!share || share.webContentsId !== webContentsId) return;
    share.paused = paused;
    if (paused) this.gateNow();
    // The server pauses active control with the share (reason share_paused); resuming control stays the person's.
    await this.deps.http.request('PUT', `/api/meet/${encodeURIComponent(share.uuid)}/control/shares/${share.shareId}`, { body: { paused } }).catch(() => undefined);
    void this.poll();
  }

  /** The meeting window went away (closed, crashed, reloaded): the share and any control end with it. */
  windowGone(webContentsId: number): void {
    if (this.share?.webContentsId === webContentsId) void this.shareStopped(webContentsId);
  }

  private endLocally(reason: string): void {
    if (this.share) log.info('share ended here', { reason });
    for (const id of [...this.sessions.keys()]) this.endSession(id, null);
    for (const id of [...this.requests.keys()]) this.deps.ui.closeConsent(id);
    this.requests.clear();
    this.share = null;
    this.stopPolling();
    this.changed();
  }

  // ── reading the server's state ────────────────────────────────────────

  private startPolling(): void {
    if (this.pollTimer) return;
    this.pollTimer = this.timers.every(3_000, () => void this.poll());
    void this.poll();
  }

  private stopPolling(): void {
    this.pollTimer?.();
    this.pollTimer = null;
  }

  /** The realtime gateway said something changed in a meeting. */
  onRealtime(e: { type?: string; meeting?: string }): void {
    if (e.type === 'meet.control' && this.share && (!e.meeting || e.meeting === this.share.uuid)) void this.poll();
  }

  /**
   * Read the server's state. Asked again while a read is on its way, one more
   * read follows it — what changed may have changed after that read left.
   */
  poll(): Promise<void> {
    if (!this.share) return Promise.resolve();
    if (this.polling) {
      this.pollAgain ??= this.polling.then(() => {
        this.pollAgain = null;
        return this.poll();
      });
      return this.pollAgain;
    }
    const share = this.share;
    const run = (async () => {
      try {
        const asked = this.now();
        const state = await this.deps.http.get<ControlState>(`/api/meet/${encodeURIComponent(share.uuid)}/control/state`);
        if (this.share === share) await this.reconcile(state, asked);
        if (this.share === share) await this.readOffers();
      } catch (e) {
        log.debug('control state not read', { error: String((e as Error).message ?? e) });
      }
    })();
    this.polling = run.finally(() => {
      this.polling = null;
    });
    return this.polling;
  }

  private async reconcile(state: ControlState, asked: number): Promise<void> {
    const share = this.share!;
    if (!state.shares.some((s) => s.id === share.shareId)) {
      // The server ended the share (a new one elsewhere, the meeting ended).
      this.endLocally('share_stopped');
      return;
    }

    const requests = new Map(state.asked.filter((r) => r.share_id === share.shareId).map((r) => [r.id, r]));
    for (const id of this.requests.keys()) if (!requests.has(id)) this.deps.ui.closeConsent(id);
    for (const id of requests.keys()) if (!this.requests.has(id)) this.deps.ui.showConsent(id, this.displayOf(share.source));
    this.requests = requests;

    // A session this computer stopped stays stopped, whatever a read that crossed the stop says.
    const mine = state.sessions.filter((s) => s.role === 'sharer' && s.share_id === share.shareId && (LIVE as string[]).includes(s.status) && !this.ended.has(s.id));
    const seen = new Set<number>();
    for (const s of mine) {
      seen.add(s.id);
      const was = this.sessions.get(s.id);
      const live: Live = was ?? {
        id: s.id,
        status: s.status as Status,
        controller: s.controller.name,
        controllerIdentity: s.controller.identity,
        caps: s.caps,
        capsLabel: s.caps_label,
        pauseReason: s.pause_reason,
        expiresAt: s.expires_at,
        keyVersion: s.key_version,
        type: s.type,
        receiver: null,
        receiverVersion: null,
        fetching: false,
        activeSince: null,
        lastInput: this.now(),
        pausedHere: false,
        pausedAt: 0,
        pauseSent: false,
        resumedAt: 0,
        receiverAt: 0,
      };
      // A read that left before this computer paused control says nothing about the pause.
      const stale = asked < live.pausedAt;
      const becameActive = !stale && s.status === 'CONTROL_ACTIVE' && live.status !== 'CONTROL_ACTIVE';
      if (!stale) Object.assign(live, { status: s.status as Status, pauseReason: live.pausedHere ? live.pauseReason : s.pause_reason });
      // A pause made here holds until the person resumes, which rotates the key (see `collect`). The server
      // still calling it active ten seconds on means it never heard: say it again.
      if (live.pausedHere && !stale && s.status === 'CONTROL_ACTIVE' && (!live.pauseSent || this.now() - live.pausedAt > 10_000)) {
        live.pausedAt = this.now();
        live.pauseSent = true;
        void this.deps.http.request('POST', `/api/meet/control/sessions/${live.id}/pause`, { body: { reason: live.pauseReason ?? 'sharer' } }).catch(() => undefined);
      }
      Object.assign(live, { caps: s.caps, capsLabel: s.caps_label, expiresAt: s.expires_at, keyVersion: s.key_version, type: s.type });
      if (becameActive || (s.status === 'CONTROL_ACTIVE' && live.activeSince === null)) {
        live.activeSince = this.now();
        live.lastInput = this.now();
      }
      this.sessions.set(s.id, live);
      if (!was) this.sessionStarted(live);
      // The grant, once per key version: at approval, and again after a resume rotated the key.
      if (s.grant_waiting && !live.fetching && live.receiverVersion !== s.key_version) void this.collect(live);
    }
    for (const id of [...this.sessions.keys()]) if (!seen.has(id)) this.endSession(id, 'Control has ended.');
    this.changed();
  }

  private displayOf(source: CapturedSource | null): Display | null {
    if (!source || source.kind !== 'screen') return null;
    return this.deps.screen.displays().find((d) => String(d.id) === source.displayId) ?? null;
  }

  // ── files (RC06) ───────────────────────────────────────────────────────

  /** Files the controller offered this computer, while a session allows file transfer. */
  private async readOffers(): Promise<void> {
    const next = new Map<number, RemoteControlOffer>();
    for (const s of this.sessions.values()) {
      if (!s.caps.file_transfer) continue;
      try {
        const r = await this.deps.http.get<{ files: FileRow[] }>(`/api/meet/control/sessions/${s.id}/files`);
        for (const f of r.files ?? []) {
          if (f.direction === 'to_sharer' && f.status === 'offered') next.set(f.id, { id: f.id, sessionId: s.id, name: f.name, size: f.size, from: f.sender.name, executable: !!f.executable, scan: f.scan });
        }
      } catch {
        for (const [id, o] of this.offers) if (o.sessionId === s.id) next.set(id, o);
      }
    }
    const fresh = [...next.values()].find((o) => !this.offers.has(o.id));
    this.offers = next;
    if (fresh) this.deps.ui.notify(`${fresh.from} wants to send you ${fresh.name}. Accept or decline it on the bar at the top of your screen.`);
    this.changed();
  }

  /**
   * The person's answer to a file offer, on the control bar. Accepting
   * needs a real click there, as allowing control does — a controller must
   * not be able to accept a program onto this computer themselves.
   */
  async answerFile(webContentsId: number, input: { id: number; accept: boolean; confirmExecutable?: boolean }, locked: boolean): Promise<{ status: string; confirmExecutable?: boolean; message?: string }> {
    if (!this.deps.ui.isIndicator(webContentsId)) throw new DesktopError('IPC_FORBIDDEN_SENDER', 'Answer on the control bar.');
    const offer = this.offers.get(input.id);
    if (!offer) throw new DesktopError('NOT_FOUND', 'That file is no longer offered.');
    if (!input.accept) {
      await this.deps.http.request('POST', `/api/meet/control/files/${offer.id}/decline`, { body: {} }).catch(() => undefined);
      this.offers.delete(offer.id);
      this.changed();
      return { status: 'declined' };
    }
    if (locked) throw new DesktopError('APP_LOCKED', 'Unlock WorkSuite to accept files.');
    if (!this.hasProof(webContentsId)) throw new DesktopError('POLICY_DENIED', 'Click Accept with this computer’s own mouse or keyboard.');
    if (this.deps.policy().remote_file_receive === 'disabled') throw new DesktopError('POLICY_DENIED', "This computer's policy doesn't let it receive files in a remote session.");
    if (offer.scan === 'infected') throw new DesktopError('POLICY_DENIED', 'The virus scan found something in this file, so it can’t be received.');
    let download: string;
    try {
      const r = await this.deps.http.request<{ download: string }>('POST', `/api/meet/control/files/${offer.id}/accept`, { body: { confirm_executable: input.confirmExecutable === true } });
      download = String(r.download ?? '');
    } catch (e) {
      if (isDesktopError(e) && e.status === 428) return { status: 'confirm', confirmExecutable: true, message: e.message };
      throw e;
    }
    this.proofs.delete(webContentsId);
    const t = /[?&]t=([A-Za-z0-9_-]{16,128})(?:&|$)/.exec(download)?.[1];
    if (!t) throw new DesktopError('SERVER_ERROR', 'The server did not say where to fetch the file from.');
    this.offers.delete(offer.id);
    this.changed();
    await this.deps.files.download(`/api/meet/control/files/${offer.id}/download?t=${t}`, offer.name);
    return { status: 'accepted' };
  }

  /**
   * This computer as the CONTROLLER takes a file the sharer offered it. Only
   * files sent to the controller: one sent to this computer as the shared
   * one is answered on the red bar, with a real click, never from a page.
   */
  async takeFile(input: { sessionId: number; id: number; confirmExecutable?: boolean }, locked: boolean): Promise<{ status: string; confirmExecutable?: boolean; message?: string }> {
    if (locked) throw new DesktopError('APP_LOCKED', 'Unlock WorkSuite to accept files.');
    if (this.deps.policy().remote_file_receive === 'disabled') throw new DesktopError('POLICY_DENIED', "This computer's policy doesn't let it receive files in a remote session.");
    const r = await this.deps.http.get<{ files: FileRow[] }>(`/api/meet/control/sessions/${input.sessionId}/files`);
    const f = (r.files ?? []).find((x) => x.id === input.id);
    if (!f || f.status !== 'offered') throw new DesktopError('NOT_FOUND', 'That file is no longer offered.');
    if (f.direction !== 'to_controller') throw new DesktopError('IPC_FORBIDDEN_SENDER', 'Files sent to this computer are answered on the red bar at the top of the screen.');
    if (f.scan === 'infected') throw new DesktopError('POLICY_DENIED', 'The virus scan found something in this file, so it can’t be received.');
    let download: string;
    try {
      const a = await this.deps.http.request<{ download: string }>('POST', `/api/meet/control/files/${f.id}/accept`, { body: { confirm_executable: input.confirmExecutable === true } });
      download = String(a.download ?? '');
    } catch (e) {
      if (isDesktopError(e) && e.status === 428) return { status: 'confirm', confirmExecutable: true, message: e.message };
      throw e;
    }
    const t = /[?&]t=([A-Za-z0-9_-]{16,128})(?:&|$)/.exec(download)?.[1];
    if (!t) throw new DesktopError('SERVER_ERROR', 'The server did not say where to fetch the file from.');
    await this.deps.files.download(`/api/meet/control/files/${f.id}/download?t=${t}`, f.name);
    return { status: 'accepted' };
  }

  /** Offer the controller files from this computer: chosen by the person here, in the system's dialog. */
  async sendFile(webContentsId: number, sessionId: number): Promise<{ sent: number }> {
    if (!this.deps.ui.isIndicator(webContentsId)) throw new DesktopError('IPC_FORBIDDEN_SENDER', 'Send files from the control bar.');
    if (!this.hasProof(webContentsId)) throw new DesktopError('POLICY_DENIED', 'Click Send a file with this computer’s own mouse or keyboard.');
    const live = this.sessions.get(sessionId);
    if (!live || !live.caps.file_transfer) throw new DesktopError('POLICY_DENIED', 'This session does not allow files.');
    this.proofs.delete(webContentsId);
    this.dialogOpen = true;
    this.release();
    try {
      return { sent: await this.deps.files.pickAndOffer(sessionId, live.controller) };
    } finally {
      this.dialogOpen = false;
    }
  }

  // ── consent (RC03) ─────────────────────────────────────────────────────

  /** A real click or key press in one of this computer's remote-control windows. */
  noteLocalInput(webContentsId: number): void {
    this.proofs.set(webContentsId, this.now());
  }

  /**
   * `local_input_proof` (SEC-02): the answer came from a click or key press
   * in that very window, in the last ten seconds, and nothing was injected
   * for a second and a half before it — so a controller cannot allow
   * themselves, or a second controller, by clicking the prompt.
   */
  hasProof(webContentsId: number): boolean {
    const at = this.proofs.get(webContentsId) ?? 0;
    // Measured from when the helper last finished carrying input out, not when it was handed over, and
    // with nothing still waiting: a queued click that runs late must not pass for the person's own.
    const inj = this.injector;
    const done = Math.max(this.lastInjected, inj?.lastDone() ?? 0);
    return at > 0 && this.now() - at <= 10_000 && at - done > 1_500 && (!inj || inj.idle());
  }

  consent(webContentsId: number, locked: boolean): RemoteControlConsent {
    const id = this.deps.ui.consentFor(webContentsId);
    const r = id === null ? undefined : this.requests.get(id);
    if (!r) throw new DesktopError('NOT_FOUND', 'That request has ended.');
    const policy = this.deps.policy();
    const current = [...this.sessions.values()].find((s) => s.status !== 'CONTROL_APPROVED' || s.receiver);
    return {
      id: r.id,
      kind: r.kind,
      requester: r.requester.name,
      reason: r.reason,
      expiresIn: r.expires_in,
      share: this.share?.source?.name ?? 'your screen',
      current: r.kind === 'handover' ? (current?.controller ?? null) : null,
      clipboard: policy.remote_clipboard === 'off' ? 'off' : policy.remote_clipboard === 'text_only' ? 'text' : 'text_files',
      fileTransfer: policy.remote_file_receive !== 'disabled',
      locked,
    };
  }

  /** The person's answer, from the consent window for that request. */
  async answer(webContentsId: number, input: { decision: 'allow' | 'allow_5' | 'deny' | 'transfer'; caps?: Partial<Caps>; duration?: string }, locked: boolean): Promise<{ status: string; stepUp?: boolean; message?: string }> {
    const id = this.deps.ui.consentFor(webContentsId);
    if (id === null || !this.requests.has(id)) throw new DesktopError('NOT_FOUND', 'That request has ended.');
    const allowing = input.decision !== 'deny';
    if (allowing && locked) throw new DesktopError('APP_LOCKED', 'Unlock WorkSuite first — control can only be allowed while it is unlocked.');
    if (allowing && !this.hasProof(webContentsId)) throw new DesktopError('POLICY_DENIED', 'Click Allow with this computer’s own mouse or keyboard.');
    const policy = this.deps.policy();
    const clipCap: Caps['clipboard'] = policy.remote_clipboard === 'off' ? 'off' : policy.remote_clipboard === 'text_only' ? 'text' : 'text_files';
    const asked = input.caps ?? {};
    const clipboard = asked.clipboard === 'text_files' && clipCap === 'text_files' ? 'text_files' : asked.clipboard && asked.clipboard !== 'off' && clipCap !== 'off' ? 'text' : 'off';
    const caps = {
      mouse: asked.mouse !== false,
      keyboard: asked.keyboard !== false,
      clipboard,
      file_transfer: asked.file_transfer === true && policy.remote_file_receive !== 'disabled',
      monitor_switch: asked.monitor_switch === true,
    };
    try {
      const r = await this.deps.http.request<{ status: string }>('POST', `/api/meet/control/requests/${id}/answer`, {
        body: { decision: input.decision, caps, duration: input.duration ?? 'until_stopped', local_input_proof: allowing },
      });
      this.proofs.delete(webContentsId);
      this.requests.delete(id);
      this.deps.ui.closeConsent(id);
      void this.poll();
      this.changed();
      return { status: r.status };
    } catch (e) {
      if (isDesktopError(e) && e.status === 428) return { status: 'step_up', stepUp: true, message: e.message };
      throw e;
    }
  }

  // ── the grant ──────────────────────────────────────────────────────────

  private async collect(live: Live): Promise<void> {
    const share = this.share;
    if (!share) return;
    live.fetching = true;
    try {
      // The helper starts while the grant is fetched: PowerShell takes a moment.
      void this.ensureInjector();
      const d = await this.deps.http.get<GrantDelivery>(`/api/meet/control/sessions/${live.id}/grant`, { query: { end: 'sharer' } });
      const check = checkGrant(d, { sessionId: live.id, meeting: share.uuid, sharerIdentity: share.identity, deviceId: this.deps.deviceId(), now: this.now() }, this.deps.pinnedKey);
      if (!check.ok) {
        log.warn('grant refused', { session: live.id, why: check.why });
        this.deps.ui.notify(`Control was not started: ${check.why}`);
        await this.stop(live.id, 'security');
        return;
      }
      const keys = await importKeys(check.key);
      live.receiver = new ControlReceiver(check.claims, keys, this.now, this.deps.policy().remote_emergency_stop_chord);
      live.receiverVersion = check.claims.key_version;
      live.controllerIdentity = check.claims.controller_identity;
      live.receiverAt = this.now();
      // A new key lifts a pause made here only when the person here resumed after it: a lock or a
      // pause during the approval or the key change stands.
      if (live.resumedAt > live.pausedAt) live.pausedHere = false;
      if (!(await this.ensureInjector())) {
        this.deps.ui.notify(this.deps.support().reason ?? 'This computer could not start taking input, so control was stopped.');
        await this.stop(live.id, 'device_change');
        return;
      }
      await this.deps.http.request('POST', `/api/meet/control/sessions/${live.id}/confirm`, { body: { end: 'sharer' } });
      void this.poll();
    } catch (e) {
      if (isDesktopError(e) && (e.data as { code?: string } | null)?.code === 'delivered') {
        // Handed to this computer already (WorkSuite restarted since): its key is gone with the old process.
        this.deps.ui.notify('Control stopped: WorkSuite restarted and no longer holds the key. Ask again to continue.');
        await this.stop(live.id, 'device_change');
      } else {
        log.warn('grant not collected', { session: live.id, error: String((e as Error).message ?? e) });
      }
    } finally {
      live.fetching = false;
    }
  }

  private ensureInjector(): Promise<boolean> {
    if (this.injectorReady) return this.injectorReady;
    this.injector = this.deps.createInjector();
    if (!this.injector) return Promise.resolve(false);
    const inj = this.injector;
    inj.onExit = () => this.helperGone(inj);
    this.injectorReady = inj.start().then((ok) => {
      if (!ok) {
        this.injectorReady = null;
        if (this.injector === inj) this.injector = null;
      }
      return ok;
    });
    return this.injectorReady;
  }

  /**
   * The input helper went away by itself. Keys it held stay held in the
   * system, so control pauses here and the person is told; resuming starts
   * a new helper with the new key.
   */
  private helperGone(inj: Injector): void {
    if (this.injector !== inj) return;
    log.warn('input helper exited while control was live');
    this.injector = null;
    this.injectorReady = null;
    this.held = new Held();
    for (const s of this.sessions.values()) void this.pause(s.id, 'sharer');
    if (this.sessions.size) this.deps.ui.notify('Input stopped working on this computer, so control is paused. Press any key you see stuck, then Resume to try again.');
  }

  // ── the session's life ────────────────────────────────────────────────

  private sessionStarted(live: Live): void {
    log.info('control session', { id: live.id, status: live.status });
    this.deps.ui.showIndicator(this.displayOf(this.share?.source ?? null));
    if (this.stops.length === 0) {
      this.registerChord();
      this.stops.push(this.timers.every(100, () => void this.watchPointer()));
      // Once a second, or four times a second when one window is shared: keys wait while it is not in front.
      let tick = 0;
      this.stops.push(this.timers.every(250, () => {
        tick += 1;
        if (this.share?.source?.kind === 'window' || tick % 4 === 0) void this.watchForeground();
      }));
      this.stops.push(this.timers.every(500, () => void this.watchWindow()));
      this.stops.push(this.timers.every(5_000, () => this.watchIdle()));
      this.stops.push(this.timers.every(10_000, () => void this.flushRefusals()));
    }
  }

  private endSession(id: number, message: string | null): void {
    const live = this.sessions.get(id);
    if (!live) return;
    this.sessions.delete(id);
    for (const [oid, o] of this.offers) if (o.sessionId === id) this.offers.delete(oid);
    this.release();
    if (message) this.deps.ui.notify(`${message} ${live.controller} no longer controls your screen.`);
    if (this.sessions.size === 0) {
      this.deps.ui.hideIndicator();
      this.unregisterChord();
      for (const stop of this.stops.splice(0)) stop();
      void this.flushRefusals();
      this.injector?.stop();
      this.injector = null;
      this.injectorReady = null;
      this.localUntil = 0;
      this.expected = null;
      this.lastCursor = null;
    }
    this.changed();
  }

  /** The person here pauses control (the indicator, the tray), or this computer does (lock screen, protected app, burst). */
  async pause(id: number, reason: string): Promise<void> {
    const live = this.sessions.get(id);
    if (!live) return;
    this.gateNow();
    live.pausedHere = true;
    live.pausedAt = this.now();
    live.pauseReason = reason;
    // The server takes a pause only while control is active; one made earlier (during the approval or a
    // key change) holds here and is told to the server when it goes active (see `reconcile`).
    live.pauseSent = live.status === 'CONTROL_ACTIVE';
    if (live.status === 'CONTROL_ACTIVE') {
      live.status = 'CONTROL_PAUSED';
      this.changed();
      await this.deps.http.request('POST', `/api/meet/control/sessions/${id}/pause`, { body: { reason } }).catch((e) => {
        live.pauseSent = false;
        log.warn('pause not recorded', { error: String((e as Error).message ?? e) });
      });
    } else this.changed();
    void this.poll();
  }

  /** Resume: only by the person here, with a real click in the indicator (RC-IND-04). The key rotates. */
  async resume(webContentsId: number, id: number): Promise<void> {
    if (!this.deps.ui.isIndicator(webContentsId)) throw new DesktopError('IPC_FORBIDDEN_SENDER', 'Resume from the control bar.');
    if (!this.hasProof(webContentsId)) throw new DesktopError('POLICY_DENIED', 'Click Resume with this computer’s own mouse or keyboard.');
    if (!this.sessions.has(id)) throw new DesktopError('NOT_FOUND', 'Control has ended.');
    this.proofs.delete(webContentsId);
    await this.deps.http.request('POST', `/api/meet/control/sessions/${id}/resume`, { body: { local_input_proof: true } });
    const live = this.sessions.get(id);
    if (live) live.resumedAt = this.now();
    void this.poll();
  }

  async stop(id: number, reason = 'stopped'): Promise<void> {
    // Here first — the input stops and the helper ends now, not after the server has answered.
    this.gateNow();
    this.ended.add(id);
    this.endSession(id, null);
    try {
      await this.deps.http.request('POST', `/api/meet/control/sessions/${id}/stop`, { body: { reason } });
    } catch (e) {
      log.warn('stop not recorded', { error: String((e as Error).message ?? e) });
    }
    void this.poll();
  }

  /** Everything stops now: the emergency chord (RC-IND-06), quitting, signing out. */
  async stopAll(reason: 'emergency_stop' | 'stopped' | 'logout' = 'stopped'): Promise<void> {
    await Promise.all([...this.sessions.keys()].map((id) => this.stop(id, reason)));
  }

  /** Quit, sign-out: control ends and the share is taken down. */
  async shutdown(reason: 'stopped' | 'logout' = 'stopped'): Promise<void> {
    await this.stopAll(reason);
    const share = this.share;
    if (share) await this.shareStopped(share.webContentsId);
  }

  // ── the watchers ──────────────────────────────────────────────────────

  private registerChord(): void {
    this.chords = acceleratorsFor(this.deps.policy().remote_emergency_stop_chord, process.platform);
    this.chordOk = this.chords.length > 0;
    for (const a of this.chords) {
      const ok = this.deps.shortcuts.register(a, () => {
        log.warn('emergency stop');
        this.deps.ui.notify('Remote control stopped.');
        void this.stopAll('emergency_stop');
      });
      if (!ok) this.chordOk = false;
    }
  }

  private unregisterChord(): void {
    for (const a of this.chords) this.deps.shortcuts.unregister(a);
    this.chords = [];
  }

  /** The person here moved the mouse: they win for the hold, and whatever the controller held is let go (RC-INP-04). */
  private async watchPointer(): Promise<void> {
    if (this.readingPointer || this.current()?.status !== 'CONTROL_ACTIVE') return;
    this.readingPointer = true;
    let cur: Point;
    try {
      const at = await this.injector?.pointer().catch(() => null);
      cur = at ? this.deps.screen.fromInput(at) : this.deps.screen.cursor();
    } finally {
      this.readingPointer = false;
    }
    if (this.current()?.status !== 'CONTROL_ACTIVE') return;
    const prev = this.lastCursor;
    this.lastCursor = cur;
    if (!prev) return;
    const moved = Math.hypot(cur.x - prev.x, cur.y - prev.y) > 2;
    if (!moved) return;
    const sinceInjected = this.now() - this.lastInjected;
    const offTarget = this.expected ? Math.hypot(cur.x - this.expected.x, cur.y - this.expected.y) > 24 : true;
    if (sinceInjected > 250 || offTarget) {
      const hold = this.deps.policy().remote_local_priority_hold_ms;
      const wasWaiting = this.now() < this.localUntil;
      this.localUntil = this.now() + hold;
      this.expected = null;
      this.release();
      if (!wasWaiting) this.changed();
      this.timers.after(hold + 50, () => this.changed());
    }
  }

  private async watchForeground(): Promise<void> {
    const live = this.current();
    if (!live || live.status !== 'CONTROL_ACTIVE' || !this.injector) return;
    const fg = await this.injector.foreground();
    if (!fg) return;
    if (process.platform === 'win32' && fg.window === null) {
      // Nothing in front, twice running: the secure desktop (UAC, Ctrl+Alt+Delete) has the screen.
      if (++this.emptyForeground >= 2) await this.pause(live.id, 'secure_desktop');
      return;
    }
    this.emptyForeground = 0;
    if (isProtected(fg)) {
      await this.pause(live.id, 'protected_app');
      return;
    }
    const source = this.share?.source;
    const allowed = !source || source.kind !== 'window' || fg.window === source.windowId;
    if (allowed !== this.keysAllowed) {
      this.keysAllowed = allowed;
      if (!allowed) this.releaseKeys();
      this.changed();
    }
  }

  private async watchWindow(): Promise<void> {
    const source = this.share?.source;
    if (!source || source.kind !== 'window' || !source.windowId || !this.injector) {
      this.windowRect = null;
      return;
    }
    this.windowRect = await this.injector.windowBounds(source.windowId);
  }

  private watchIdle(): void {
    const live = this.current();
    if (!live || live.status !== 'CONTROL_ACTIVE') return;
    const idle = (live.receiver?.claims.idle_pause_s ?? 600) * 1000;
    if (idle > 0 && this.now() - live.lastInput > idle) void this.pause(live.id, 'idle');
  }

  /** The screen locked, the computer is going to sleep, the user switched (§E.6). */
  onSystem(event: 'lock-screen' | 'suspend' | 'user-did-resign-active'): void {
    const reason = event === 'lock-screen' ? 'lock_screen' : event === 'suspend' ? 'sleep' : 'user_switch';
    // Every live session, active or not yet: a lock during the approval or a key change must hold too.
    for (const s of this.sessions.values()) void this.pause(s.id, reason);
  }

  // ── messages from the controller ───────────────────────────────────────

  /**
   * One data-channel message, relayed by the meeting window that holds the
   * share. Messages are handled strictly in order; a backlog of moves is
   * thinned rather than replayed late.
   */
  packet(webContentsId: number, sender: string, text: string, topic: string): void {
    if (!this.share || this.share.webContentsId !== webContentsId || this.sessions.size === 0) return;
    if (this.queued > 240 && topic === 'rc.ctl.move') return;
    this.queued++;
    this.queue = this.queue.then(() => this.handle(sender, text)).catch((e) => log.warn('control message failed', { error: String((e as Error).message ?? e) })).finally(() => {
      this.queued--;
    });
  }

  private async handle(sender: string, text: string): Promise<void> {
    const env = parseEnvelope(text);
    if (!env) return;
    const live = [...this.sessions.values()].find((s) => s.receiver?.claims.grant_id === env.g);
    if (!live || !live.receiver) return;
    const active = live.status === 'CONTROL_ACTIVE' && !live.pausedHere;
    const verdict = await live.receiver.accept(env, sender, active);
    if (!verdict.ok) {
      this.refused(live, verdict.reason);
      return;
    }
    if (verdict.type === 'lease' || verdict.type === 'state') return;
    live.lastInput = this.now();
    await this.apply(live, verdict.type, verdict.payload);
  }

  private refused(live: Live, reason: Refusal): void {
    // Right after a key change, messages under the other key are expected (the two ends switch a moment
    // apart): they are dropped, not reported to the administrators.
    const rekeying = reason === 'bad_mac' && (live.receiverVersion !== live.keyVersion || this.now() - live.receiverAt < 15_000);
    if (REPORTED.includes(reason) && !rekeying) {
      const k = `${live.id}:${reason}`;
      this.refusals.set(k, (this.refusals.get(k) ?? 0) + 1);
    }
    if (reason === 'input_burst' && !live.pausedHere) {
      log.warn('input burst; pausing control', { session: live.id });
      void this.pause(live.id, 'security').then(() => this.flushRefusals());
    }
  }

  private async flushRefusals(): Promise<void> {
    const all = [...this.refusals.entries()];
    this.refusals.clear();
    for (const [k, count] of all) {
      const [id, kind] = k.split(':') as [string, string];
      await this.deps.http.request('POST', `/api/meet/control/sessions/${id}/security`, { body: { kind, count } }).catch(() => undefined);
    }
  }

  /** The gates past the receiver, then the helper. */
  private async apply(live: Live, type: string, payload: Record<string, unknown>): Promise<void> {
    const gated = () => !this.injector || this.deps.ui.consentOpen() || this.dialogOpen || !!this.share?.paused;
    if (gated()) return;
    const local = this.now() < this.localUntil;
    const windowShare = this.share?.source?.kind === 'window' ? this.share.source : null;
    let actions: InputAction[] = [];

    if (type === 'ptr.move' || type === 'ptr.button' || type === 'ptr.wheel') {
      if (local) return;
      const at = this.target(Number(payload.x), Number(payload.y));
      if (!at) return;
      // One window shared: a press or a wheel lands only where that window is what the pointer is over —
      // not on another app covering part of it, which the controller cannot see.
      if (windowShare && (type === 'ptr.wheel' || (type === 'ptr.button' && payload.down === true))) {
        // On X11 the check itself takes the pointer there: that move is the controller's, not the person's.
        this.expected = at.display;
        this.lastInjected = this.now();
        const under = await this.injector!.isUnder(at.input.x, at.input.y, windowShare.windowId ?? '');
        // Cannot tell (no xwininfo on this X11 desktop): only while the shared window is the one in front.
        if (under === false || (under === null && !this.keysAllowed) || gated()) return;
      }
      actions = pointerActions(type, payload, at.input, this.held);
      this.expected = at.display;
    } else if (type === 'key') {
      if (local || !this.keysAllowed) return;
      // One window shared: no switching to another app from the keyboard (Alt+Tab, Command, the Windows key).
      if (windowShare && switchesApps(chordOf(payload))) return;
      actions = keyActions(payload, this.held);
    } else if (type === 'special') {
      if (local || !this.keysAllowed) return;
      const combo = typeof payload.combo === 'string' ? payload.combo : '';
      if (windowShare && switchesApps(combo)) return;
      if (/^Ctrl\+Alt\+Del(ete)?$/.test(combo)) {
        // No app can raise it (Windows takes it only from the keyboard), and the screen it opens is never controlled.
        this.deps.ui.notify(`${live.controller} asked for Ctrl+Alt+Delete. Press it yourself if it is needed.`);
        return;
      }
      actions = comboActions(combo);
    } else if (type === 'clip') {
      const text = typeof payload.text === 'string' ? payload.text.slice(0, 256 * 1024) : '';
      if (text && live.caps.clipboard !== 'off' && this.deps.policy().remote_clipboard !== 'off') {
        this.deps.clipboard.writeText(text);
        this.deps.ui.notify(`${live.controller} put text on your clipboard.`);
      }
      return;
    } else if (type === 'display') {
      // Switching screens (monitor_switch): the meeting window captures the other one; control goes on there.
      const n = Math.trunc(Number(payload.display));
      if (live.caps.monitor_switch && this.share?.source?.kind === 'screen' && n >= 1 && n <= 16) void this.deps.ui.switchScreen(this.share.webContentsId, n);
      return;
    } else {
      return;
    }
    if (actions.length === 0 || gated()) return;
    this.injector!.send(actions);
    this.lastInjected = this.now();
  }

  /** Where (nx, ny) on the shared picture is, for the helper and in display coordinates. */
  private target(nx: number, ny: number): { input: Point; display: Point } | null {
    if (!Number.isFinite(nx) || !Number.isFinite(ny)) return null;
    const source = this.share?.source;
    if (source?.kind === 'window') {
      if (!this.windowRect) return null;
      const input = place(nx, ny, this.windowRect);
      return { input, display: this.deps.screen.fromInput(input) };
    }
    // The shared display, or the only one there is; never a guess at another display.
    const all = this.deps.screen.displays();
    const d = this.displayOf(source ?? null) ?? (all.length === 1 ? all[0]! : null);
    if (!d) return null;
    const display = place(nx, ny, d.bounds);
    return { input: this.deps.screen.toInput(display), display };
  }

  /** Let go of everything held for the controller. */
  private release(): void {
    // What is still waiting to be carried out is forgotten first, so the releases come next, not after it.
    this.injector?.drop();
    const actions = this.held.releaseAll();
    if (actions.length && this.injector) {
      this.injector.send(actions);
      this.lastInjected = this.now();
    }
  }

  private releaseKeys(): void {
    this.injector?.drop();
    const buttons = new Set(this.held.buttons);
    const actions = this.held.releaseAll().filter((a) => a.t === 'key');
    this.held.buttons = buttons;
    if (actions.length && this.injector) this.injector.send(actions);
  }

  /** Nothing more is injected until the server says control is active again. */
  private gateNow(): void {
    for (const s of this.sessions.values()) {
      if (s.status === 'CONTROL_APPROVED') continue;
      s.pausedHere = true;
      s.pausedAt = this.now();
    }
    this.release();
  }
}


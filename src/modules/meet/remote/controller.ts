import { ControlSender, TOPIC_LOSSY, TOPIC_RELIABLE, importKeys, unb64, type ControlType, type GrantClaims } from '@shared/remote-control/channel';
import type { Track } from 'livekit-client';
import { app } from '../../../core/app-state';
import { call, on } from '../../../core/bridge';
import { toast } from '../../../core/toasts';
import { callUi } from '../../calls/ui/state';
import { meet } from '../session';
import { connectionLabel, endedOf, failure, rc, sessionLength, type ConnectionLabel, type ControlSession, type ControlState, type RemoteFile, type Share } from './api';
import { MoveCoalescer, keyMessage, type ButtonName, type KeyLike, type KeyPayload, type Point } from './input';
import { pointers } from './pointers';

/**
 * Controlling somebody's shared screen from a meeting window (WS-MEET-ENH-01
 * RC05, RC07, §C.4), kept outside React like the meeting itself, so one
 * owner holds the grant key, the sequence numbers and the timers.
 *
 * Nothing is sent before this end holds the grant and has confirmed it; the
 * sharer's desktop confirms too and decides, message by message, whether to
 * inject. Every message is sealed with the grant key and numbered. Moves go
 * on the lossy topic, at most 60 a second; clicks, the wheel and keys on the
 * reliable one. The lease is renewed every `lease_renew_s` over the data
 * channel and, as a fallback, over HTTPS. When the sharer resumes a pause the
 * key rotates: the grant is collected and confirmed again before anything
 * more is sent. Nothing typed here is logged or kept (RC-KBD-06).
 */

/** The meeting's room, as far as sending control needs it. */
export interface RoomLike {
  localParticipant: {
    identity: string;
    publishData(data: Uint8Array<ArrayBuffer>, options: { reliable?: boolean; topic?: string; destinationIdentities?: string[] }): Promise<void>;
  };
}

export interface Waiting {
  requestId: number;
  shareId: number;
  name: string;
  /** When the request runs out (ms). */
  until: number;
  /** When it was sent, so a read that started earlier cannot clear it. */
  at: number;
}

/** Asks the person for something the server wants first; null when they cancel. */
export interface Prompts {
  reason: (message: string) => Promise<string | null>;
  code: (message: string) => Promise<string | null>;
}

const INPUT: ReadonlySet<ControlType> = new Set(['ptr.move', 'ptr.button', 'ptr.wheel', 'key', 'special', 'clip', 'display']);

export class MeetController {
  uuid = '';
  state: ControlState | null = null;
  /** The session this computer controls, while the server lists it as live. */
  session: ControlSession | null = null;
  /** This end holds the current grant and the server knows it. */
  confirmed = false;
  /** Why control cannot start (the grant was already handed over, or could not be set up). */
  problem: string | null = null;
  waiting: Waiting | null = null;
  /** Characters go as text rather than keys (layouts the sharer's keyboard doesn't have). */
  textMode = false;
  label: ConnectionLabel = '—';
  rtt: number | null = null;
  /** Files the sharer offered this end, waiting for an answer (RC06). */
  offers: RemoteFile[] = [];

  private sender: ControlSender | null = null;
  private claims: GrantClaims | null = null;
  /** The key version this end holds, and the one it last asked the server for. */
  private held: number | null = null;
  private tried: number | null = null;
  private confirming = false;
  /** Sessions over for this end (released, or gone from the state): never picked up again from a late read. */
  private gone = new Set<number>();
  private chain: Promise<void> = Promise.resolve();
  private moves: MoveCoalescer;
  private keysDown = new Map<string, KeyPayload>();
  private buttonsDown = new Set<ButtonName>();
  private lastPoint: Point | null = null;
  private track: Track | null = null;
  private reading: Promise<void> | null = null;
  private again = false;
  private readAt = 0;
  private timers: { poll?: ReturnType<typeof setTimeout>; wait?: ReturnType<typeof setTimeout>; lease?: ReturnType<typeof setInterval>; stats?: ReturnType<typeof setInterval> } = {};
  private off: (() => void) | null = null;
  private version = 0;
  private listeners = new Set<() => void>();

  constructor(
    private readonly roomOf: () => RoomLike | null,
    private readonly now: () => number = () => Date.now(),
  ) {
    this.moves = new MoveCoalescer((p) => void this.input('ptr.move', { ...p, display: 1 }), now);
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  snapshot = (): number => this.version;

  private changed(): void {
    this.version++;
    const v = this.session ? 'active' : this.waiting ? 'requested' : 'off';
    if (callUi.get().remoteControl !== v) callUi.set({ remoteControl: v });
    for (const fn of this.listeners) fn();
  }

  /** Input flows: the session is active, this end confirmed its grant, and the key is the current one. */
  get active(): boolean {
    return !!this.session && this.session.status === 'CONTROL_ACTIVE' && this.confirmed && !!this.sender && this.held === this.session.key_version;
  }

  /** This computer's policy turns controlling other computers off. */
  get policyOff(): boolean {
    return app.get().bootstrap?.policy?.remote_control_controller === 'disabled';
  }

  // ── following the meeting ─────────────────────────────────────────────────

  /** Start following a meeting's sharing and control; the returned function stops. */
  start(uuid: string): () => void {
    if (this.uuid !== uuid) {
      this.stop();
      this.uuid = uuid;
      this.off = on<{ type?: string; meeting?: string }>('realtime:event', (e) => {
        if (e?.type !== 'meet.control') return;
        if (e.meeting && e.meeting !== this.uuid) return;
        void this.refresh();
      });
      void this.refresh();
    }
    return () => this.stop();
  }

  /** Leaving the meeting: control ends with it, and every timer stops. */
  stop(): void {
    if (this.session) void this.release();
    this.off?.();
    this.off = null;
    clearTimeout(this.timers.poll);
    clearTimeout(this.timers.wait);
    clearInterval(this.timers.lease);
    clearInterval(this.timers.stats);
    this.timers = {};
    this.uuid = '';
    this.state = null;
    this.waiting = null;
    this.problem = null;
    this.changed();
  }

  /**
   * Read the state now (the poll, `meet.control`, or after something this end
   * did). Reads never overlap: asked for during one, another follows it, and
   * the promise settles once both have.
   */
  refresh(): Promise<void> {
    if (!this.uuid) return Promise.resolve();
    if (this.reading) {
      this.again = true;
      return this.reading;
    }
    this.reading = this.read();
    return this.reading;
  }

  private async read(): Promise<void> {
    try {
      do {
        this.again = false;
        const uuid = this.uuid;
        if (!uuid) return;
        const at = this.now();
        try {
          const state = await rc.state(uuid);
          if (this.uuid !== uuid) return;
          this.state = state;
          this.readAt = at;
          await this.sync();
        } catch {
          /* the last state stands; the poll tries again */
        }
        this.changed();
      } while (this.again);
    } finally {
      this.reading = null;
    }
    if (this.uuid) this.schedule();
  }

  /** Every three seconds while anything is shared or asked for — a request lives sixty — else every ten. */
  private schedule(): void {
    clearTimeout(this.timers.poll);
    const s = this.state;
    const busy = !!s && s.shares.length + s.requests.length + s.sessions.length + s.asked.length > 0;
    this.timers.poll = setTimeout(() => void this.refresh(), busy ? 3_000 : 10_000);
  }

  private async sync(): Promise<void> {
    const st = this.state;
    if (!st) return;
    const live = (s: ControlSession) => s.role === 'controller' && !this.gone.has(s.id) && st.shares.some((sh) => sh.id === s.share_id);

    if (this.session) {
      const still = st.sessions.find((s) => s.id === this.session!.id);
      if (still && live(still)) this.session = still;
      else this.finish();
    }
    if (!this.session) {
      const fresh = st.sessions.find(live);
      if (fresh) this.begin(fresh);
    }

    // The request: answered, run out or cancelled — or one this window did not send, still waiting.
    if (this.waiting && this.readAt >= this.waiting.at && !st.requests.some((r) => r.id === this.waiting!.requestId)) this.clearWaiting();
    if (!this.waiting && !this.session) {
      const r = st.requests.find((q) => q.status === 'pending' && st.shares.some((sh) => sh.id === q.share_id));
      if (r) this.wait({ requestId: r.id, shareId: r.share_id, name: r.sharer.name, until: this.now() + r.expires_in * 1000, at: this.now() });
    }

    if (this.session) {
      if (!this.active) this.moves.drop();
      await this.collect(this.session);
      await this.readOffers(this.session);
    } else this.offers = [];
  }

  // ── files (RC06) ──────────────────────────────────────────────────────────

  private async readOffers(s: ControlSession): Promise<void> {
    if (!s.caps.file_transfer) {
      this.offers = [];
      return;
    }
    try {
      const r = await rc.files(s.id);
      this.offers = (r.files ?? []).filter((f) => f.direction === 'to_controller' && f.status === 'offered');
    } catch {
      /* the last list stands */
    }
  }

  /** Offer the sharer files from this computer: chosen in the system's dialog, sent by the upload manager. */
  async sendFiles(): Promise<number> {
    const s = this.session;
    if (!s || !s.caps.file_transfer) return 0;
    const picked = await call('files:pickFiles', { multiple: true, title: `Send files to ${s.sharer.name}` });
    if (!picked.length) return 0;
    await call('transfers:upload', { handles: picked.map((p) => p.handle), target: { kind: 'remote', sessionId: s.id } });
    toast('success', picked.length === 1 ? `${picked[0]!.name} offered to ${s.sharer.name}.` : `${picked.length} files offered to ${s.sharer.name}.`);
    return picked.length;
  }

  /**
   * Take a file the sharer offered; a program needs `confirmExecutable`. Returns false when the
   * server wants that first. The main process accepts and fetches it: it takes only files sent to
   * this end, and a page never holds the one-time address.
   */
  async acceptFile(f: RemoteFile, confirmExecutable = false): Promise<boolean> {
    const r = await call('rc:takeFile', { sessionId: f.session_id, id: f.id, confirmExecutable });
    if (r.status === 'confirm') return false;
    this.offers = this.offers.filter((x) => x.id !== f.id);
    this.changed();
    return true;
  }

  async declineFile(f: RemoteFile): Promise<void> {
    await rc.declineFile(f.id).catch(() => undefined);
    this.offers = this.offers.filter((x) => x.id !== f.id);
    this.changed();
  }

  private begin(s: ControlSession): void {
    this.session = s;
    // A new session: last time's card is not about this one.
    this.ended = null;
    this.problem = null;
    this.confirmed = false;
    this.held = null;
    this.tried = null;
    this.clearWaiting();
    toast('success', `You now have control. ${s.sharer.name} allowed ${s.caps_label.toLowerCase()}.`);
    this.timers.stats = setInterval(() => void this.sample(), 2_000);
  }

  /**
   * The session left the live states, or its share ended: say how, as the web
   * does — and keep the summary, so RC07's card can offer asking again rather
   * than a toast that is gone before the person has read it.
   */
  private finish(): void {
    const s = this.session!;
    const label = this.label;
    this.gone.add(s.id);
    this.teardown();
    this.session = null;
    void rc
      .session(s.id)
      .then(
        // The record says when it ended; when it started is the session we were in.
        (d) => ({ end: endedOf(d, s.sharer.name), length: sessionLength(s.started_at, d?.ended_at ?? null) }),
        () => ({ end: endedOf(null, s.sharer.name), length: sessionLength(s.started_at, null) }),
      )
      .then(({ end, length }) => {
        this.ended = { shareId: s.share_id, sharer: s.sharer.name, by: end.by, reason: end.reason, length, at: this.now() };
        this.changed();
        toast('info', `Remote control ended by ${end.by}. ${end.reason}`);
      });
    this.report(s.id, label);
  }

  /** The last session that ended, for the card over the share; cleared when it is dismissed or another starts. */
  ended: { shareId: number; sharer: string; by: string; reason: string; length: string; at: number } | null = null;

  /** The card was dismissed, or control was asked for again. */
  clearEnded(): void {
    if (!this.ended) return;

    this.ended = null;
    this.changed();
  }

  // ── the grant ─────────────────────────────────────────────────────────────

  /**
   * Collect the grant once per key version, import it, confirm. A rotated key
   * (the sharer resumed) drops the old sender first: nothing goes out under a
   * key the sharer no longer holds. A grant already handed over answers 409
   * `delivered` — said, not retried.
   */
  private async collect(s: ControlSession): Promise<void> {
    if (s.grant_waiting && this.held !== null && s.key_version !== this.held) this.drop();

    if (s.grant_waiting && s.key_version !== this.held && this.tried !== s.key_version) {
      this.tried = s.key_version;
      try {
        const g = await rc.grant(s.id);
        const raw = unb64(g.key);
        if (!raw) throw new Error('bad key');
        const keys = await importKeys(raw);
        if (this.session?.id !== s.id) return;
        this.claims = g.claims;
        this.sender = new ControlSender(g.claims, keys, this.now);
        this.held = g.claims.key_version ?? s.key_version;
        this.confirmed = false;
        this.problem = null;
      } catch (e) {
        const f = failure(e, 'Control could not be set up.');
        this.problem = f.message;
        // Never reached the server: the grant is still there to collect on the next read.
        if (f.status === 0) this.tried = null;
        this.changed();
        return;
      }
    }

    if (this.sender && !this.confirmed && !this.confirming && this.session?.id === s.id) {
      if (this.held !== s.key_version) {
        void this.refresh();
        return;
      }
      this.confirming = true;
      try {
        await rc.confirm(s.id);
        if (this.session?.id !== s.id || this.held !== s.key_version) return;
        this.confirmed = true;
        this.problem = null;
        this.lease(s.id);
        void this.refresh();
      } catch (e) {
        this.problem = failure(e, 'Control could not be set up.').message;
      } finally {
        this.confirming = false;
      }
    }

    // Live, but its key went to another window of this end before this one was open.
    if (!s.grant_waiting && !this.sender && this.tried === null) {
      this.problem = "This session's key was already handed to this computer once and can't be handed over again. Release control and ask again.";
    }
    this.changed();
  }

  private lease(sessionId: number): void {
    clearInterval(this.timers.lease);
    const every = (this.claims?.lease_renew_s || this.state?.server.lease_renew_s || 10) * 1000;
    this.timers.lease = setInterval(() => {
      if (!this.sender) return;
      this.sender.renew();
      void this.seal('lease', {});
      void rc.lease(sessionId).catch(() => undefined);
    }, every);
  }

  /** Forget the key: a rotated one is on its way, or control is over. */
  private drop(): void {
    this.moves.drop();
    this.keysDown.clear();
    this.buttonsDown.clear();
    clearInterval(this.timers.lease);
    this.sender = null;
    this.claims = null;
    this.held = null;
    this.confirmed = false;
  }

  private teardown(): void {
    this.drop();
    clearInterval(this.timers.stats);
    this.tried = null;
    this.problem = null;
    this.label = '—';
    this.rtt = null;
  }

  // ── sending ───────────────────────────────────────────────────────────────

  /** Sealed and published strictly in sequence order, to the sharer alone. */
  private seal(type: ControlType, payload: unknown): Promise<void> {
    const sender = this.sender;
    const to = this.session?.sharer.identity;
    const room = this.roomOf();
    if (!sender || !to || !room) return this.chain;
    const lossy = type === 'ptr.move';
    this.chain = this.chain
      .then(async () => {
        if (this.sender !== sender) return;
        const bytes = await sender.next(type, payload);
        void room.localParticipant.publishData(bytes, { reliable: !lossy, topic: lossy ? TOPIC_LOSSY : TOPIC_RELIABLE, destinationIdentities: [to] }).catch(() => undefined);
      })
      .catch(() => undefined);
    return this.chain;
  }

  private input(type: ControlType, payload: unknown): Promise<void> {
    if (!INPUT.has(type) || !this.active) return this.chain;
    return this.seal(type, payload);
  }

  /** Resolves once everything queued so far has been sealed and handed to the room. */
  flush(): Promise<void> {
    return this.chain;
  }

  move(p: Point): void {
    if (!this.active) return;
    this.lastPoint = p;
    this.moves.push(p);
  }

  button(p: Point, button: ButtonName, down: boolean): void {
    if (!this.active) return;
    // The press carries its own position; a move still waiting would only arrive after it.
    this.moves.drop();
    this.lastPoint = p;
    if (down) this.buttonsDown.add(button);
    else this.buttonsDown.delete(button);
    void this.input('ptr.button', { ...p, button, down });
  }

  wheel(p: Point, dx: number, dy: number): void {
    if (!this.active) return;
    void this.input('ptr.wheel', { ...p, dx, dy });
  }

  /** A key on the shared screen; false when nothing was sent (not active), so the key keeps its local meaning. */
  key(e: KeyLike, down: boolean): boolean {
    if (!this.active) return false;
    const msg = keyMessage(e, down, this.textMode);
    if (!msg) return true;
    if ('code' in msg) {
      if (down) this.keysDown.set(msg.code, msg);
      else this.keysDown.delete(msg.code);
    }
    void this.input('key', msg);
    return true;
  }

  special(combo: string): void {
    void this.input('special', { combo });
  }

  /**
   * Focus left the shared screen with keys or buttons still down (Alt+Tab on
   * this computer): let them go over there too, or they stay stuck.
   */
  releaseHeld(): void {
    if (!this.active) return;
    for (const k of this.keysDown.values()) void this.input('key', { ...k, down: false });
    const p = this.lastPoint;
    if (p) for (const b of this.buttonsDown) void this.input('ptr.button', { ...p, button: b, down: false });
    this.keysDown.clear();
    this.buttonsDown.clear();
  }

  setTextMode(on: boolean): void {
    this.textMode = on;
    this.changed();
  }

  // ── asking, cancelling, letting go ──────────────────────────────────────

  /**
   * Request control of a share (RC-REQ-01). The company may ask for a reason
   * or for an authenticator code first; the server says which, and this asks
   * the person and tries again, as the web does.
   */
  async ask(share: Share, reason: string, prompts: Prompts, again = 0): Promise<void> {
    const room = this.roomOf();
    if (!room || !this.uuid || this.policyOff) return;
    try {
      const r = await rc.request(this.uuid, { share_id: share.id, identity: room.localParticipant.identity, reason });
      const at = this.now();
      this.wait({ requestId: r.request_id, shareId: share.id, name: share.name, until: at + r.expires_in * 1000, at });
      void this.refresh();
    } catch (e) {
      const f = failure(e, 'Could not ask for control');
      if (f.code === 'reason_required' && again < 1) {
        const why = await prompts.reason(f.message);
        if (why) return this.ask(share, why, prompts, again + 1);
      } else if (f.code === 'step_up' && again < 2) {
        const code = await prompts.code(f.message);
        if (code) {
          try {
            await rc.stepUp(code);
            return this.ask(share, reason, prompts, again + 1);
          } catch (e2) {
            toast('error', failure(e2, 'That code is not valid.').message);
          }
        }
      } else {
        toast('error', f.message);
      }
    }
  }

  private wait(w: Waiting): void {
    this.waiting = w;
    clearTimeout(this.timers.wait);
    this.timers.wait = setTimeout(
      () => {
        if (this.waiting?.requestId !== w.requestId) return;
        this.clearWaiting();
        toast('info', `${w.name} didn't answer. You can ask again.`);
        this.changed();
      },
      Math.max(0, w.until - this.now()) + 1000,
    );
    this.changed();
  }

  private clearWaiting(): void {
    clearTimeout(this.timers.wait);
    this.waiting = null;
  }

  async cancel(): Promise<void> {
    const w = this.waiting;
    if (!w) return;
    this.clearWaiting();
    this.changed();
    await rc.cancel(w.requestId).catch(() => undefined); // it may have just been answered
    void this.refresh();
  }

  /** Release control (reason `released`); the sharer's screen is theirs again at once. */
  async release(): Promise<void> {
    const s = this.session;
    if (!s) return;
    const label = this.label;
    this.releaseHeld();
    await this.flush();
    this.gone.add(s.id);
    this.teardown();
    this.session = null;
    this.changed();
    await rc.stop(s.id, 'released').catch(() => undefined); // ended already
    this.report(s.id, label);
    void this.refresh();
  }

  // ── how the connection was ──────────────────────────────────────────────

  /** The shared screen's track, while it is on screen: its figures give the quality label. */
  watch(track: Track | null): () => void {
    this.track = track;
    return () => {
      if (this.track === track) this.track = null;
    };
  }

  private async sample(): Promise<void> {
    const report = await this.track?.getRTCStatsReport().catch(() => undefined);
    if (!report) return;
    let rtt: number | null = null;
    let loss: number | null = null;
    report.forEach((r: Record<string, unknown>) => {
      if (r.type === 'inbound-rtp' && r.kind === 'video') {
        const lost = Number(r.packetsLost ?? 0);
        const got = Number(r.packetsReceived ?? 0);
        loss = got + lost > 0 ? Math.round((1000 * lost) / (got + lost)) / 10 : 0;
      }
      if (r.type === 'candidate-pair' && (r.nominated || r.state === 'succeeded') && r.currentRoundTripTime != null) rtt = Math.round(Number(r.currentRoundTripTime) * 1000);
    });
    const label = connectionLabel(rtt, loss);
    if (label !== this.label || rtt !== this.rtt) {
      this.label = label;
      this.rtt = rtt;
      this.changed();
    }
  }

  /** How the connection was when it ended, for the admins' overview. */
  private report(sessionId: number, label: ConnectionLabel): void {
    if (label !== '—') void rc.quality(sessionId, label.toLowerCase()).catch(() => undefined);
  }
}

/** This meeting window's controller. */
export const remote = new MeetController(() => meet.room);
// Who may clear everybody's marks on a share, or switch annotation off: the person sharing it.
pointers.sharerOf = (shareId) => remote.state?.shares.find((s) => s.id === shareId)?.identity ?? null;

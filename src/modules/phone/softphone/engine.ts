import { Invitation, Inviter, Registerer, RegistererState, SessionState, UserAgent, type Session } from 'sip.js';
import { ApiError } from '../../../core/api';
import { call, hasDesktop } from '../../../core/bridge';
import { createStore, useStore, type Store } from '../../../core/store';
import { playOnce, playTone, ringVolume } from '../../calls/tones';
import { phoneApi, type ScreenPop, type SoftphoneCredentials } from '../api';
import { CALL_STATUS, ringOf, type CallStatus } from '../lib/callstatus';
import { dialable, isDialable } from '../lib/format';
import { mos as mosOf, qualityLabel, sampleFromStats, type QualityLabel } from '../lib/mos';

/**
 * The softphone (WS-VOIP-SRS-001 §5 Softphone & calling, Call control; workflows WF-04…WF-07).
 *
 * One SIP user agent for the whole app session, held by the main window's shell (VOIP-SP-01): it registers the
 * person's own extension over WebSocket to the PBX the server names (`GET /api/voip/softphone`, VOIP-SP-02/07) and
 * stays up on every screen. Every other window — the compact phone (D01) — reads its state and sends it commands
 * over `BroadcastChannel('ws-phone')` (remote.ts); audio plays here.
 *
 * Calls are placed the way the SRS specifies (WF-05): `POST /api/voip/call` asks the switch to ring this phone first
 * and then the destination, which writes the call-log row and the CRM activity. The ring-back this phone receives
 * is answered here without a click. When the server cannot reach its switch over AMI but the phone is registered,
 * the call goes out over SIP directly, and the person is told it will not be in the history until the switch
 * reports it (G-01).
 *
 * What needs the switch's own control (park, recording on/off) goes through `POST /api/voip/calls/control`, which
 * checks the channel is ours (VOIP-CTL-01). Conference uses the per-extension ConfBridge room the server already
 * generates (`8<ext>`): each party is transferred in and this phone joins it — no ARI needed.
 */

export type Phase =
  | 'idle'
  | 'starting'
  | 'no-extension'
  | 'unavailable'
  | 'needs-reload'
  | 'connecting'
  | 'registered'
  | 'reconnecting'
  | 'failed'
  | 'stopped';

export type LineState = 'ringing' | 'dialing' | 'early' | 'connected' | 'ended';
export type RecordingState = 'policy' | 'on' | 'paused' | 'off' | 'unknown';

/** A call this phone holds. Plain data: it crosses windows. */
export interface Line {
  id: string;
  direction: 'inbound' | 'outbound';
  /** The other party's number or extension, as the switch gave it. */
  remote: string;
  remoteName: string | null;
  /** "Sales queue 600" when the switch said so (Alert-Info / display prefix). */
  via: string | null;
  state: LineState;
  held: boolean;
  muted: boolean;
  createdAt: number;
  answeredAt: number | null;
  endedAt: number | null;
  endReason: string | null;
  /** This line is the "speak first" leg of an attended transfer of that line. */
  consultFor: string | null;
  recording: RecordingState;
  mos: number | null;
  quality: QualityLabel | null;
  codec: string | null;
  /** The call-log row, when the call was placed through the server (WF-05). */
  callId: number | null;
  /** Placed over SIP directly: not in the history until the switch reports it. */
  direct: boolean;
  /** What the server already knows about the number (VOIP-POP-01). */
  context: ScreenPop | null;
  /** The note being written during the call (W02), saved to the call when it ends. */
  note: string;
  /** In a conference room on the switch. */
  conference: boolean;
}

export interface MediaChoice {
  mic: string;
  speaker: string;
  ringer: string;
}

export interface PhoneState {
  phase: Phase;
  message: string | null;
  extension: string | null;
  name: string | null;
  domain: string | null;
  server: string | null;
  lines: Line[];
  /** The line the in-call screen shows. */
  focused: string | null;
  /**
   * The status calls are in (worksuite-desktop#288), handed in by PhoneHost from the status menu and the WorkSuite
   * status: Available rings, Busy rings without a sound, Do not disturb and Away do not ring here.
   */
  status: CallStatus;
  /** Not answering on this computer (Do not disturb or Away here; the switch's own is the server's). */
  dnd: boolean;
  media: MediaChoice;
  /** Calls missed on this computer since it started (cleared when Recents is opened). */
  missed: Array<{ remote: string; name: string | null; at: number }>;
  /** The last line that ended, for wrap-up. */
  ended: Line | null;
  locked: boolean;
}

const MEDIA_KEY = 'ws.phone.media';

function readMedia(): MediaChoice {
  try {
    const v = JSON.parse(localStorage.getItem(MEDIA_KEY) ?? '{}') as Partial<MediaChoice>;
    return { mic: typeof v.mic === 'string' ? v.mic : '', speaker: typeof v.speaker === 'string' ? v.speaker : '', ringer: typeof v.ringer === 'string' ? v.ringer : '' };
  } catch {
    return { mic: '', speaker: '', ringer: '' };
  }
}

export const INITIAL: PhoneState = {
  phase: 'idle',
  message: null,
  extension: null,
  name: null,
  domain: null,
  server: null,
  lines: [],
  focused: null,
  status: 'available',
  dnd: false,
  media: { mic: '', speaker: '', ringer: '' },
  missed: [],
  ended: null,
  locked: false,
};

/** Everything a remote window may ask of the phone. */
export type Command =
  | { cmd: 'dial'; number: string; contactId?: number | null; name?: string | null }
  | { cmd: 'answer'; id?: string }
  | { cmd: 'decline'; id?: string; voicemail?: boolean }
  | { cmd: 'hangup'; id?: string }
  | { cmd: 'hold'; id?: string; on?: boolean }
  | { cmd: 'mute'; id?: string; on?: boolean }
  | { cmd: 'dtmf'; id?: string; digit: string }
  | { cmd: 'transfer'; id?: string; to: string }
  | { cmd: 'consult'; id?: string; to: string }
  | { cmd: 'complete'; id: string }
  | { cmd: 'cancelConsult'; id: string }
  | { cmd: 'conference'; id?: string }
  | { cmd: 'park'; id?: string }
  | { cmd: 'record'; id?: string; action: 'pause' | 'resume' | 'start' | 'stop' }
  | { cmd: 'focus'; id: string }
  | { cmd: 'note'; id: string; text: string }
  | { cmd: 'media'; patch: Partial<MediaChoice> }
  | { cmd: 'dismissEnded' }
  | { cmd: 'clearMissed' }
  | { cmd: 'retry' };

export type CommandResult = { ok: true; message?: string | null } | { ok: false; message: string };

let seq = 0;
const lineId = () => `l${Date.now().toString(36)}${(seq++).toString(36)}`;

/** The number and name a SIP identity carries. */
function who(s: Session): { remote: string; name: string | null } {
  const id = s.assertedIdentity ?? s.remoteIdentity;
  const remote = id?.uri?.user ?? '';
  const name = (id?.displayName ?? '').replace(/^"|"$/g, '').trim();
  return { remote, name: name && name !== remote ? name : null };
}

/** A queue or IVR the switch names in Alert-Info (`<…>;info=Sales queue 600`) or a `Queue: ` display prefix. */
export function viaOf(alertInfo: string | null | undefined, displayName: string | null | undefined): string | null {
  const m = /info=([^;>]+)/i.exec(alertInfo ?? '');
  if (m?.[1]) return m[1].trim();
  const d = /^\s*\[?([^\]:]{2,40})\]?\s*[:|]\s*/.exec(displayName ?? '');
  return d?.[1] && /queue|ivr|group|sales|support|line/i.test(d[1]) ? d[1].trim() : null;
}

/** Answered elsewhere ("Call completed elsewhere") is not a missed call. */
export function answeredElsewhere(reason: string | null | undefined): boolean {
  return /cause=200|completed elsewhere/i.test(reason ?? '');
}

/** The SIP target for something dialled: digits and `*#+` only, at the phone's own domain. */
export function sipTarget(number: string, domain: string): string | null {
  const n = dialable(number);
  return isDialable(n) || /^\d$/.test(n) ? `sip:${n}@${domain}` : null;
}

export class PhoneEngine {
  readonly store: Store<PhoneState> = createStore<PhoneState>({ ...INITIAL });
  private ua: UserAgent | null = null;
  private registerer: Registerer | null = null;
  private sessions = new Map<string, Session>();
  private audio = new Map<string, HTMLAudioElement>();
  private creds: SoftphoneCredentials | null = null;
  private ring: { stop: () => void } | null = null;
  private waitingBeep: ReturnType<typeof setInterval> | null = null;
  private ringback: { stop: () => void } | null = null;
  private pending: { number: string; until: number; contactId: number | null; name: string | null; callId: number | null; context: ScreenPop | null } | null = null;
  private stats: ReturnType<typeof setInterval> | null = null;
  private counters = new Map<string, { received: number; lost: number }>();
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  /** How this phone's own identity reads on the switch's ring-back: its extension, name and caller ID. */
  private self = new Set<string>();
  private attempt = 0;
  private wanted = false;
  private onCspViolation: ((e: SecurityPolicyViolationEvent) => void) | null = null;
  /**
   * Hooks the host fills in: OS notifications and the global shortcuts (main process). A notification is a banner
   * with the app's sound, a `silent` banner (Busy), or only an entry in the bell (a call turned away by Do not disturb).
   */
  notify: (n: { kind: 'incoming' | 'missed'; id: string; title: string; body: string; delivery?: 'silent' | 'bell' }) => void = () => undefined;
  shortcuts: (on: boolean) => void = () => undefined;

  get state(): PhoneState {
    return this.store.get();
  }

  private patch(p: Partial<PhoneState> | ((s: PhoneState) => Partial<PhoneState>)): void {
    this.store.set(p);
  }

  private patchLine(id: string, p: Partial<Line>): void {
    this.patch((s) => ({ lines: s.lines.map((l) => (l.id === id ? { ...l, ...p } : l)) }));
  }

  line(id?: string | null): Line | null {
    const s = this.state;
    const want = id ?? s.focused;
    return s.lines.find((l) => l.id === want) ?? s.lines.find((l) => l.state !== 'ended') ?? null;
  }

  /* ==================================================================== *
   * Registration
   * ==================================================================== */

  async start(): Promise<void> {
    if (this.wanted && this.ua) return;
    this.wanted = true;
    this.patch({ phase: 'starting', message: null, media: readMedia() });
    let creds: SoftphoneCredentials;
    try {
      creds = await phoneApi.softphone();
    } catch (e) {
      if (!this.wanted) return;
      // No extension (404) or no SIP domain / password (422): the module still works as a directory (VOIP-SP-05).
      if (e instanceof ApiError && e.status === 404) this.patch({ phase: 'no-extension', message: e.message });
      else if (e instanceof ApiError && (e.status === 422 || e.status === 403)) this.patch({ phase: 'unavailable', message: e.message });
      else this.schedule(e instanceof Error ? e.message : 'The phone could not reach WorkSuite.');
      return;
    }
    if (!this.wanted) return;
    if (!/^wss:\/\//i.test(creds.ws_uri)) {
      // A SIP password must never cross an unencrypted WebSocket (NFR-05).
      this.patch({ phase: 'unavailable', message: 'The phone system is not offered over a secure WebSocket (wss://), so this computer will not connect to it.' });
      return;
    }
    this.creds = creds;
    this.patch({ extension: creds.extension, name: creds.name, domain: creds.domain, server: creds.server?.name ?? null });
    this.self = new Set([creds.extension, creds.name.trim().toLowerCase()].filter(Boolean));
    // The caller ID the switch shows on a ring-back (`CallController::dial` sends the extension's caller ID).
    void phoneApi.extensions().then(
      (list) => {
        const mine = list.find((e) => e.extension === creds.extension);
        const digits = (mine?.caller_id ?? '').replace(/\D/g, '');
        if (digits) this.self.add(digits.slice(-9));
        if (mine?.caller_id) this.self.add(mine.caller_id.trim().toLowerCase());
      },
      () => undefined,
    );
    // The page may only open WebSockets its policy names; the main process adds the switch the server named.
    if (hasDesktop()) {
      try {
        const r = await call('phone:prepare');
        if (r.added) {
          this.patch({ phase: 'needs-reload', message: `WorkSuite needs to restart its window once to allow your phone system (${r.origin}).` });
          return;
        }
      } catch {
        // An older main process: try anyway, and say so if the policy refuses it.
      }
    }
    await this.connect();
  }

  private async connect(): Promise<void> {
    const c = this.creds;
    if (!c || !this.wanted) return;
    this.patch({ phase: this.attempt > 0 ? 'reconnecting' : 'connecting' });
    const uri = UserAgent.makeURI(`sip:${c.extension}@${c.domain}`);
    if (!uri) {
      this.patch({ phase: 'failed', message: 'That extension does not form a valid SIP address.' });
      return;
    }
    if (typeof document !== 'undefined' && !this.onCspViolation) {
      this.onCspViolation = (e) => {
        if (/^wss?:/i.test(e.blockedURI) && this.state.phase !== 'registered') {
          this.patch({ phase: 'needs-reload', message: 'WorkSuite needs to restart its window once to allow your phone system.' });
        }
      };
      document.addEventListener('securitypolicyviolation', this.onCspViolation);
    }
    const agent = new UserAgent({
      uri,
      authorizationUsername: c.extension,
      authorizationPassword: c.secret,
      displayName: c.name,
      transportOptions: { server: c.ws_uri, traceSip: false },
      userAgentString: 'WorkSuite Desktop',
      logLevel: 'error',
      noAnswerTimeout: 60,
      sessionDescriptionHandlerFactoryOptions: {
        // The switch's STUN/TURN (VOIP-SP-06) when it sends them; otherwise what it sent.
        peerConnectionConfiguration: { iceServers: c.ice },
        iceGatheringTimeout: 2000,
      },
      delegate: {
        onInvite: (inv) => this.incoming(inv),
        onDisconnect: (err) => {
          if (!this.wanted) return;
          this.schedule(err?.message ?? 'The connection to the phone system dropped.');
        },
      },
    });
    this.ua = agent;
    try {
      await agent.start();
      if (!this.wanted) {
        await agent.stop().catch(() => undefined);
        return;
      }
      const reg = new Registerer(agent, { expires: 300 });
      reg.stateChange.addListener((st) => {
        if (st === RegistererState.Registered) {
          this.attempt = 0;
          this.patch({ phase: 'registered', message: null });
          this.shortcuts(true);
        } else if (st === RegistererState.Unregistered && this.wanted && this.state.phase === 'registered') {
          this.patch({ phase: 'reconnecting', message: 'The phone system stopped accepting this phone. Trying again…' });
        }
      });
      this.registerer = reg;
      await reg.register({
        requestDelegate: {
          onReject: (r) => {
            const code = r.message.statusCode;
            this.patch({
              phase: 'failed',
              message: code === 401 || code === 403 ? 'The phone system refused this extension’s password. Ask an administrator to issue a new one.' : `The phone system refused to register this phone (${code} ${r.message.reasonPhrase}).`,
            });
          },
        },
      });
    } catch (e) {
      if (this.wanted) this.schedule(e instanceof Error ? e.message : 'The phone could not connect.');
    }
  }

  /** Try again later, backing off to a minute; calls in progress are kept. */
  private schedule(message: string): void {
    if (!this.wanted) return;
    if (this.state.phase === 'needs-reload') return;
    this.attempt += 1;
    const delay = Math.min(60_000, 2_000 * 2 ** Math.min(5, this.attempt - 1));
    this.patch({ phase: 'reconnecting', message });
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.teardownUa().then(() => (this.creds ? this.connect() : this.start()));
    }, delay);
  }

  private async teardownUa(): Promise<void> {
    const reg = this.registerer;
    const ua = this.ua;
    this.registerer = null;
    this.ua = null;
    if (reg && reg.state === RegistererState.Registered) await reg.unregister().catch(() => undefined);
    if (ua) await ua.stop().catch(() => undefined);
  }

  async stop(): Promise<void> {
    this.wanted = false;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    for (const l of this.state.lines) if (l.state !== 'ended') void this.hangup(l.id);
    this.stopRinging();
    this.shortcuts(false);
    await this.teardownUa();
    this.creds = null;
    if (this.onCspViolation && typeof document !== 'undefined') document.removeEventListener('securitypolicyviolation', this.onCspViolation);
    this.onCspViolation = null;
    // The status is PhoneHost's to set: kept, so a stop that finishes after the next start does not undo it.
    this.patch((s) => ({ ...INITIAL, phase: 'stopped', status: s.status, dnd: s.dnd }));
  }

  async retry(): Promise<void> {
    this.attempt = 0;
    await this.teardownUa();
    this.wanted = false;
    await this.start();
  }

  setLocked(locked: boolean): void {
    if (this.state.locked !== locked) this.patch({ locked });
  }

  /* ==================================================================== *
   * Incoming
   * ==================================================================== */

  private incoming(inv: Invitation): void {
    const { remote, name } = who(inv);
    const via = viaOf(inv.request.getHeader('Alert-Info'), inv.remoteIdentity.displayName);
    const id = lineId();
    const p = this.pending;
    // The ring-back of a call this phone asked the switch to place (WF-05): answer it, and it is that call. It carries
    // this phone's own caller ID; anyone else ringing in that moment rings as usual.
    if (p && p.until > Date.now() && this.isSelf(remote, name)) {
      this.pending = null;
      this.sessions.set(id, inv);
      this.add({ id, direction: 'outbound', remote: p.number, remoteName: p.name ?? p.context?.contact?.name ?? null, via: null, state: 'dialing', callId: p.callId, context: p.context });
      this.watch(id, inv);
      void inv.accept(this.acceptOptions()).catch((e: unknown) => this.endLine(id, e instanceof Error ? e.message : 'The call could not start.'));
      return;
    }
    const busy = this.state.lines.some((l) => l.state === 'connected' || l.state === 'ringing');
    const status = this.state.status;
    const ring = ringOf(status);
    // Do not disturb or Away here, or locked: the caller goes where the switch sends a busy line — voicemail, the next
    // person in the queue or ring group, the "When busy" forwarding. Still a missed call, in Calls; with Do not disturb
    // or Away it goes to the bell without a banner, since nothing is to pop up while they asked not to be disturbed.
    if (ring === 'off' || this.state.locked) {
      void inv.reject({ statusCode: 486 }).catch(() => undefined);
      this.patch((s) => ({ missed: [{ remote, name, at: Date.now() }, ...s.missed].slice(0, 50) }));
      if (this.state.locked) this.notify({ kind: 'missed', id: `phone-missed:${id}`, title: 'Missed call while WorkSuite was locked', body: name ?? remote });
      else this.notify({ kind: 'missed', id: `phone-missed:${id}`, title: `Missed call from ${name ?? remote}`, body: [remote, via, `${CALL_STATUS[status].label}: ${status === 'away' ? 'sent to your forwarding or voicemail' : 'sent to voicemail'}`].filter(Boolean).join(' · '), delivery: 'bell' });
      return;
    }
    // Busy: it rings on screen only — no ring tone, a silent banner.
    const quiet = ring === 'quiet' ? ({ delivery: 'silent' } as const) : {};
    this.sessions.set(id, inv);
    this.add({ id, direction: 'inbound', remote, remoteName: name, via, state: 'ringing' });
    this.watch(id, inv);
    inv.delegate = {
      onCancel: (cancel) => {
        const reason = cancel.request.getHeader('Reason');
        if (!answeredElsewhere(reason)) {
          this.patch((s) => ({ missed: [{ remote, name, at: Date.now() }, ...s.missed].slice(0, 50) }));
          this.notify({ kind: 'missed', id: `phone-missed:${id}`, title: `Missed call from ${name ?? remote}`, body: via ? `${remote} · ${via}` : remote, ...quiet });
        }
      },
    };
    if (!busy || !this.state.focused) this.patch({ focused: id });
    void phoneApi.screenPop(remote).then(
      (ctx) => this.patchLine(id, { context: ctx, remoteName: this.line(id)?.remoteName ?? ctx.contact?.name ?? ctx.account?.name ?? ctx.lead?.name ?? null }),
      () => undefined,
    );
    this.notify({ kind: 'incoming', id: `phone-ring:${id}`, title: `Incoming call from ${name ?? remote}`, body: via ? `${remote} · ${via}` : remote, ...quiet });
    this.updateRinging();
  }

  /** Whether an identity is this phone's own (the switch's ring-back of a call we asked it to place). */
  isSelf(remote: string, name: string | null): boolean {
    const digits = remote.replace(/\D/g, '');
    return (
      this.self.has(remote) ||
      (!!name && this.self.has(name.trim().toLowerCase())) ||
      (digits.length >= 6 && this.self.has(digits.slice(-9))) ||
      // A switch that sends the caller ID as a name only: the number part is empty or the name itself.
      ((remote === '' || remote.toLowerCase() === (name ?? '').toLowerCase()) && !!name && this.self.has(name.trim().toLowerCase()))
    );
  }

  private add(p: Pick<Line, 'id' | 'direction' | 'remote' | 'remoteName' | 'via' | 'state'> & Partial<Line>): void {
    const line: Line = {
      held: false,
      muted: false,
      createdAt: Date.now(),
      answeredAt: null,
      endedAt: null,
      endReason: null,
      consultFor: null,
      recording: 'policy',
      mos: null,
      quality: null,
      codec: null,
      callId: null,
      direct: false,
      context: null,
      note: '',
      conference: false,
      ...p,
    };
    this.patch((s) => ({ lines: [...s.lines.filter((l) => l.state !== 'ended' || Date.now() - (l.endedAt ?? 0) < 5_000), line] }));
  }

  private watch(id: string, s: Session): void {
    s.stateChange.addListener((st) => {
      if (st === SessionState.Establishing) {
        const l = this.line(id);
        if (l && l.direction === 'outbound' && l.state === 'dialing') this.patchLine(id, { state: 'early' });
      } else if (st === SessionState.Established) {
        this.patchLine(id, { state: 'connected', answeredAt: Date.now() });
        this.attachAudio(id, s);
        this.stopRingback();
        this.patch({ focused: id });
        this.startStats();
      } else if (st === SessionState.Terminated) {
        const l = this.line(id);
        this.endLine(id, l?.state === 'ringing' ? 'Missed' : l?.state === 'connected' ? 'Call ended' : 'Not connected');
      }
      this.updateRinging();
    });
  }

  private endLine(id: string, reason: string): void {
    const l = this.state.lines.find((x) => x.id === id);
    if (!l || l.state === 'ended') return;
    const ended: Line = { ...l, state: 'ended', endedAt: Date.now(), endReason: reason };
    this.sessions.delete(id);
    this.counters.delete(id);
    const el = this.audio.get(id);
    if (el) {
      el.srcObject = null;
      el.remove();
      this.audio.delete(id);
    }
    this.patch((s) => {
      const lines = s.lines.map((x) => (x.id === id ? ended : x));
      const live = lines.filter((x) => x.state !== 'ended');
      return {
        lines,
        focused: s.focused === id ? (live.find((x) => x.state === 'connected')?.id ?? live[0]?.id ?? id) : s.focused,
        ended: l.answeredAt ? ended : s.ended,
      };
    });
    // A consultation that ends hands the caller back: take them off hold.
    if (l.consultFor) {
      const orig = this.state.lines.find((x) => x.id === l.consultFor);
      if (orig && orig.state === 'connected' && orig.held) void this.hold(orig.id, false);
    }
    if (l.answeredAt && l.note.trim()) void this.saveNote(ended);
    if (!this.state.lines.some((x) => x.state === 'connected')) this.stopStats();
    this.updateRinging();
    this.stopRingback();
  }

  /** The note typed during the call, onto the call once it ended (W02 "saved to the call and the contact's timeline"). */
  private async saveNote(l: Line): Promise<void> {
    const callId = l.callId ?? (await this.findCall(l));
    if (!callId) return;
    try {
      await phoneApi.addNote(callId, l.note.trim());
      this.patch((s) => ({ ended: s.ended?.id === l.id ? { ...s.ended, note: '', callId } : s.ended }));
    } catch {
      // Kept on the ended line; the wrap-up card offers to save it again.
    }
  }

  /** The history row for a call placed or taken directly, once the switch has reported it (G-01). */
  async findCall(l: Pick<Line, 'remote' | 'createdAt' | 'direction'>): Promise<number | null> {
    try {
      const page = await phoneApi.history({ q: l.remote.replace(/^\+/, '').slice(-9), per_page: 10 });
      const near = page.calls.find((c) => {
        const at = c.started_at ? Date.parse(`${c.started_at.replace(' ', 'T')}Z`) : NaN;
        return Number.isFinite(at) && Math.abs(at - l.createdAt) < 3 * 60_000;
      });
      return near?.id ?? null;
    } catch {
      return null;
    }
  }

  /* ==================================================================== *
   * Ringing
   * ==================================================================== */

  private updateRinging(): void {
    const s = this.state;
    const ringing = s.lines.some((l) => l.state === 'ringing');
    const talking = s.lines.some((l) => l.state === 'connected');
    // Out loud only while Available: Busy rings on screen alone, without the ring tone or the call-waiting beep.
    const loud = ringOf(s.status) === 'loud';
    if (ringing && !talking && loud) {
      if (!this.ring) this.ring = playTone('ring', ringVolume());
    } else this.stopRing();
    if (ringing && talking && loud) {
      // Call waiting (VOIP-CTL-05): a short beep in the ear, not the ringer over the conversation.
      if (!this.waitingBeep) {
        playOnce('hand', Math.min(0.5, ringVolume()));
        this.waitingBeep = setInterval(() => playOnce('hand', Math.min(0.5, ringVolume())), 4_000);
      }
    } else if (this.waitingBeep) {
      clearInterval(this.waitingBeep);
      this.waitingBeep = null;
    }
  }

  private stopRing(): void {
    this.ring?.stop();
    this.ring = null;
  }

  private stopRinging(): void {
    this.stopRing();
    if (this.waitingBeep) clearInterval(this.waitingBeep);
    this.waitingBeep = null;
    this.stopRingback();
  }

  private stopRingback(): void {
    this.ringback?.stop();
    this.ringback = null;
  }

  /* ==================================================================== *
   * Media
   * ==================================================================== */

  private constraints(): MediaStreamConstraints {
    const mic = this.state.media.mic;
    return { audio: mic ? { deviceId: { exact: mic }, echoCancellation: true, noiseSuppression: true, autoGainControl: true } : { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false };
  }

  private acceptOptions() {
    return { sessionDescriptionHandlerOptions: { constraints: this.constraints() } };
  }

  private async micAllowed(): Promise<boolean> {
    if (!hasDesktop()) return true;
    try {
      return (await call('media:access', { kind: 'microphone' })).granted;
    } catch {
      return true;
    }
  }

  private attachAudio(id: string, s: Session): void {
    const sdh = s.sessionDescriptionHandler as unknown as { remoteMediaStream?: MediaStream; peerConnection?: RTCPeerConnection } | undefined;
    let stream = sdh?.remoteMediaStream;
    if (!stream && sdh?.peerConnection) {
      stream = new MediaStream();
      for (const r of sdh.peerConnection.getReceivers()) if (r.track) stream.addTrack(r.track);
    }
    if (!stream || typeof document === 'undefined') return;
    let el = this.audio.get(id);
    if (!el) {
      el = document.createElement('audio');
      el.autoplay = true;
      el.dataset.phoneLine = id;
      el.style.display = 'none';
      document.body.appendChild(el);
      this.audio.set(id, el);
    }
    el.srcObject = stream;
    const speaker = this.state.media.speaker;
    if (speaker) void (el as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }).setSinkId?.(speaker).catch(() => undefined);
    void el.play().catch(() => undefined);
  }

  private startStats(): void {
    if (this.stats) return;
    this.stats = setInterval(() => void this.sample(), 2_000);
  }

  private stopStats(): void {
    if (this.stats) clearInterval(this.stats);
    this.stats = null;
  }

  private async sample(): Promise<void> {
    for (const l of this.state.lines) {
      if (l.state !== 'connected' || l.held) continue;
      const pc = (this.sessions.get(l.id)?.sessionDescriptionHandler as unknown as { peerConnection?: RTCPeerConnection } | undefined)?.peerConnection;
      if (!pc) continue;
      try {
        const report = await pc.getStats();
        const { sample, codec, counters } = sampleFromStats(report.values() as Iterable<{ type: string }>, this.counters.get(l.id));
        this.counters.set(l.id, counters);
        const m = mosOf(sample);
        this.patchLine(l.id, { mos: m, quality: qualityLabel(m), codec: codec ?? l.codec });
      } catch {
        // A closing connection has no stats.
      }
    }
  }

  setMedia(patch: Partial<MediaChoice>): void {
    const media = { ...this.state.media, ...patch };
    try {
      localStorage.setItem(MEDIA_KEY, JSON.stringify(media));
    } catch {
      /* kept for this session */
    }
    this.patch({ media });
    if (patch.speaker !== undefined) {
      for (const el of this.audio.values()) void (el as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }).setSinkId?.(patch.speaker).catch(() => undefined);
    }
    if (patch.mic !== undefined) {
      // A new microphone for the calls in progress: replace the track being sent.
      void (async () => {
        try {
          const stream = await navigator.mediaDevices.getUserMedia(this.constraints());
          const track = stream.getAudioTracks()[0];
          if (!track) return;
          for (const [id, s] of this.sessions) {
            const pc = (s.sessionDescriptionHandler as unknown as { peerConnection?: RTCPeerConnection } | undefined)?.peerConnection;
            const sender = pc?.getSenders().find((x) => x.track?.kind === 'audio');
            if (sender) {
              await sender.replaceTrack(track.clone());
              const l = this.line(id);
              if (l?.muted && sender.track) sender.track.enabled = false;
            }
          }
          track.stop();
        } catch {
          /* the next call uses it */
        }
      })();
    }
  }

  /**
   * How calls reach this computer (status.ts keeps it, PhoneHost hands it in). A call ringing now goes quiet unless
   * the status is Available, and stays on screen to be answered or turned away by hand.
   */
  setStatus(status: CallStatus): void {
    if (this.state.status === status) return;
    this.patch({ status, dnd: ringOf(status) === 'off' });
    this.updateRinging();
  }

  /** Do not disturb on this computer, or Available: the status's two ends. */
  setDnd(on: boolean): void {
    this.setStatus(on ? 'dnd' : 'available');
  }

  /* ==================================================================== *
   * Placing calls
   * ==================================================================== */

  /**
   * Call a number (WF-05). Through the server when it can: the switch rings this phone first, then the number, and
   * the call is logged with its CRM activity. Over SIP directly when the server cannot reach its switch.
   */
  async dial(raw: string, opts: { contactId?: number | null; name?: string | null } = {}): Promise<CommandResult> {
    const number = dialable(raw);
    if (!isDialable(number)) return { ok: false, message: 'That is not a number that can be dialled.' };
    const registered = this.state.phase === 'registered';
    if (registered && !(await this.micAllowed())) return { ok: false, message: 'WorkSuite is not allowed to use the microphone. Allow it in your system settings.' };
    // Put a call in progress on hold first: one conversation at a time.
    for (const l of this.state.lines) if (l.state === 'connected' && !l.held) await this.hold(l.id, true);
    if (registered) this.pending = { number, until: Date.now() + 20_000, contactId: opts.contactId ?? null, name: opts.name ?? null, callId: null, context: null };
    try {
      const r = await phoneApi.dial(number, opts.contactId ? { contact_id: opts.contactId } : undefined);
      // The ring-back may already be answered (the switch waits for it): give that line its record.
      const answered = this.state.lines.find((l) => l.direction === 'outbound' && l.remote === number && l.callId === null && Date.now() - l.createdAt < 25_000);
      if (answered) this.patchLine(answered.id, { callId: r.call_id, context: r.context, remoteName: answered.remoteName ?? r.context?.contact?.name ?? null });
      else if (this.pending) {
        this.pending.callId = r.call_id;
        this.pending.context = r.context;
      }
      return { ok: true, message: registered ? null : 'Your phone is ringing. Pick it up to be connected.' };
    } catch (e) {
      this.pending = null;
      const status = e instanceof ApiError ? e.status : 0;
      // The server cannot reach its switch (AMI), but this phone can: dial it ourselves.
      if (registered && (status === 502 || status === 503 || status === 0)) return this.dialDirect(number, opts.name ?? null);
      return { ok: false, message: e instanceof Error ? e.message : 'The call could not be placed.' };
    }
  }

  /** An INVITE from this phone, not through the server: what the Call button does when the server cannot dial. */
  async dialDirect(number: string, name: string | null = null, consultFor: string | null = null): Promise<CommandResult> {
    const ua = this.ua;
    const domain = this.state.domain;
    if (!ua || !domain || this.state.phase !== 'registered') return { ok: false, message: 'The phone is not connected to the phone system.' };
    const target = sipTarget(number, domain);
    const uri = target ? UserAgent.makeURI(target) : undefined;
    if (!uri) return { ok: false, message: 'That is not a number that can be dialled.' };
    const id = lineId();
    const inviter = new Inviter(ua, uri, { sessionDescriptionHandlerOptions: { constraints: this.constraints() } });
    this.sessions.set(id, inviter);
    this.add({ id, direction: 'outbound', remote: dialable(number), remoteName: name, via: null, state: 'dialing', direct: !consultFor, consultFor });
    this.patch({ focused: id });
    this.watch(id, inviter);
    void phoneApi.screenPop(dialable(number)).then((ctx) => this.patchLine(id, { context: ctx, remoteName: this.line(id)?.remoteName ?? ctx.contact?.name ?? ctx.account?.name ?? null }), () => undefined);
    try {
      await inviter.invite({
        requestDelegate: {
          onProgress: (r) => {
            // Ringing with no early media: play the ring-back here, until the far end sends its own or answers.
            if (r.message.statusCode === 180 && !r.message.body && !this.ringback) this.ringback = playTone('ringback', 0.5);
            if (r.message.statusCode === 183) this.stopRingback();
          },
          onReject: (r) => this.endLine(id, r.message.statusCode === 486 ? 'Busy' : r.message.statusCode === 404 ? 'Number not found' : `${r.message.statusCode} ${r.message.reasonPhrase}`),
        },
      });
      return { ok: true, message: consultFor ? null : 'Placed directly: this call is not in the history until the phone system reports it.' };
    } catch (e) {
      this.endLine(id, 'Not connected');
      return { ok: false, message: e instanceof Error ? e.message : 'The call could not be placed.' };
    }
  }

  /* ==================================================================== *
   * In call
   * ==================================================================== */

  async answer(id?: string): Promise<CommandResult> {
    const l = this.state.lines.find((x) => x.id === id) ?? this.state.lines.find((x) => x.state === 'ringing');
    const s = l ? this.sessions.get(l.id) : null;
    if (!l || !(s instanceof Invitation) || l.state !== 'ringing') return { ok: false, message: 'There is no call to answer.' };
    if (!(await this.micAllowed())) return { ok: false, message: 'WorkSuite is not allowed to use the microphone. Allow it in your system settings.' };
    // Hold & answer (VOIP-CTL-05).
    for (const o of this.state.lines) if (o.id !== l.id && o.state === 'connected' && !o.held) await this.hold(o.id, true);
    this.stopRinging();
    this.patch({ focused: l.id });
    try {
      await s.accept(this.acceptOptions());
      return { ok: true };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : 'The call could not be answered.' };
    }
  }

  /** Decline (603), or send to voicemail (486: the switch's busy path is voicemail on a WorkSuite dial plan). */
  async decline(id?: string, voicemail = false): Promise<CommandResult> {
    const l = this.state.lines.find((x) => x.id === id) ?? this.state.lines.find((x) => x.state === 'ringing');
    const s = l ? this.sessions.get(l.id) : null;
    if (!l || !(s instanceof Invitation)) return { ok: false, message: 'There is no call to decline.' };
    try {
      await s.reject({ statusCode: voicemail ? 486 : 603 });
    } catch {
      /* already gone */
    }
    this.endLine(l.id, voicemail ? 'Sent to voicemail' : 'Declined');
    return { ok: true };
  }

  async hangup(id?: string): Promise<CommandResult> {
    const l = this.line(id);
    const s = l ? this.sessions.get(l.id) : null;
    if (!l || !s) return { ok: false, message: 'There is no call to end.' };
    try {
      if (s.state === SessionState.Established) await s.bye();
      else if (s instanceof Inviter) await s.cancel();
      else if (s instanceof Invitation) await s.reject();
    } catch {
      /* the far end may have gone first */
    }
    this.endLine(l.id, 'You hung up');
    return { ok: true };
  }

  async hold(id: string | undefined, on?: boolean): Promise<CommandResult> {
    const l = this.line(id);
    const s = l ? this.sessions.get(l.id) : null;
    if (!l || !s || s.state !== SessionState.Established) return { ok: false, message: 'There is no call to hold.' };
    const next = on ?? !l.held;
    if (next === l.held) return { ok: true };
    const options = { hold: next } as Record<string, unknown>;
    try {
      // The re-INVITE we send, and the answer to any the switch sends, both keep the hold.
      s.sessionDescriptionHandlerOptionsReInvite = options;
      await s.invite({ sessionDescriptionHandlerOptions: options as never });
      this.patchLine(l.id, { held: next });
      const el = this.audio.get(l.id);
      if (el) el.muted = next;
      return { ok: true };
    } catch {
      return { ok: false, message: next ? 'The phone system would not hold the call.' : 'The phone system would not resume the call.' };
    }
  }

  mute(id?: string, on?: boolean): CommandResult {
    const l = this.line(id);
    const s = l ? this.sessions.get(l.id) : null;
    const pc = (s?.sessionDescriptionHandler as unknown as { peerConnection?: RTCPeerConnection } | undefined)?.peerConnection;
    if (!l || !pc) return { ok: false, message: 'There is no call to mute.' };
    const next = on ?? !l.muted;
    for (const sender of pc.getSenders()) if (sender.track?.kind === 'audio') sender.track.enabled = !next;
    this.patchLine(l.id, { muted: next });
    return { ok: true };
  }

  /** RTP DTMF (RFC 4733), which IVRs on the far side listen for; SIP INFO when the browser has no sender. */
  dtmf(id: string | undefined, digit: string): CommandResult {
    if (!/^[0-9*#A-D]$/.test(digit)) return { ok: false, message: 'Not a keypad digit.' };
    const l = this.line(id);
    const s = l ? this.sessions.get(l.id) : null;
    const pc = (s?.sessionDescriptionHandler as unknown as { peerConnection?: RTCPeerConnection } | undefined)?.peerConnection;
    const sender = pc?.getSenders().find((x) => x.track?.kind === 'audio');
    if (sender?.dtmf) {
      sender.dtmf.insertDTMF(digit, 160, 70);
      playOnce('hand', 0.15);
      return { ok: true };
    }
    if (s && s.state === SessionState.Established) {
      void s.info({ requestOptions: { body: { contentDisposition: 'render', contentType: 'application/dtmf-relay', content: `Signal=${digit}\r\nDuration=160` } } }).catch(() => undefined);
      return { ok: true };
    }
    return { ok: false, message: 'There is no call to send tones to.' };
  }

  /** Transfer now (blind): the call goes straight to them (SIP REFER). */
  async transfer(id: string | undefined, to: string): Promise<CommandResult> {
    const l = this.line(id);
    const s = l ? this.sessions.get(l.id) : null;
    const target = this.state.domain ? sipTarget(to, this.state.domain) : null;
    const uri = target ? UserAgent.makeURI(target) : undefined;
    if (!l || !s || s.state !== SessionState.Established) return { ok: false, message: 'There is no call to transfer.' };
    if (!uri) return { ok: false, message: 'That is not a number the call can go to.' };
    try {
      await s.refer(uri, { requestDelegate: { onReject: () => this.patchLine(l.id, { endReason: 'The phone system refused the transfer.' }) } });
      this.endLine(l.id, `Transferred to ${to}`);
      return { ok: true, message: `Transferred to ${to}.` };
    } catch {
      return { ok: false, message: 'The phone system refused the transfer.' };
    }
  }

  /** Speak first (attended): hold the caller, ring the colleague on a second line. */
  async consult(id: string | undefined, to: string): Promise<CommandResult> {
    const l = this.line(id);
    if (!l || l.state !== 'connected') return { ok: false, message: 'There is no call to transfer.' };
    const held = await this.hold(l.id, true);
    if (!held.ok) return held;
    const r = await this.dialDirect(to, null, l.id);
    if (!r.ok) await this.hold(l.id, false);
    return r;
  }

  /** Complete: join the caller to the colleague and step out (REFER with Replaces). */
  async complete(consultId: string): Promise<CommandResult> {
    const c = this.state.lines.find((x) => x.id === consultId);
    const orig = c?.consultFor ? this.state.lines.find((x) => x.id === c.consultFor) : null;
    const cs = c ? this.sessions.get(c.id) : null;
    const os = orig ? this.sessions.get(orig.id) : null;
    if (!c || !orig || !cs || !os) return { ok: false, message: 'There is no transfer to complete.' };
    try {
      await os.refer(cs);
      this.endLine(orig.id, `Transferred to ${c.remoteName ?? c.remote}`);
      this.endLine(c.id, 'Transfer completed');
      return { ok: true, message: 'Transferred.' };
    } catch {
      return { ok: false, message: 'The phone system refused the transfer. You are still talking to both.' };
    }
  }

  async cancelConsult(consultId: string): Promise<CommandResult> {
    const c = this.state.lines.find((x) => x.id === consultId);
    if (!c?.consultFor) return { ok: false, message: 'There is no transfer to cancel.' };
    const orig = c.consultFor;
    await this.hangup(c.id);
    await this.hold(orig, false);
    this.patch({ focused: orig });
    return { ok: true };
  }

  /**
   * Conference (W02): every call this phone holds goes into this extension's own room on the switch (`8<ext>`,
   * generated by PbxConfig), then this phone joins it.
   */
  async conference(): Promise<CommandResult> {
    const ext = this.state.extension;
    const domain = this.state.domain;
    const live = this.state.lines.filter((l) => l.state === 'connected');
    if (!ext || !domain) return { ok: false, message: 'The phone is not connected.' };
    if (live.length < 2) return { ok: false, message: 'Hold one call and place or answer another, then merge them into a conference.' };
    const room = UserAgent.makeURI(`sip:8${ext}@${domain}`);
    if (!room) return { ok: false, message: 'The conference room is not reachable.' };
    for (const l of live) {
      const s = this.sessions.get(l.id);
      if (!s) continue;
      try {
        await s.refer(room);
        this.endLine(l.id, 'Moved into your conference');
      } catch {
        return { ok: false, message: `${l.remoteName ?? l.remote} could not be moved into the conference.` };
      }
    }
    const r = await this.dialDirect(`8${ext}`, 'Conference');
    const conf = this.state.lines.find((l) => l.remote === `8${ext}` && l.state !== 'ended');
    if (conf) this.patchLine(conf.id, { conference: true, direct: false, remoteName: 'Conference' });
    return r.ok ? { ok: true, message: 'Conference started.' } : r;
  }

  /**
   * The switch's channels for a line: ours (`PJSIP/<ext>-…`, talking to this number) and the other party's (same
   * linkedid). Park and recording act on them through the server, which checks they are ours.
   */
  private async channelsFor(l: Line): Promise<{ mine: string | null; other: string | null; uniqueid: string | null; message?: string }> {
    const ext = this.state.extension;
    if (!ext) return { mine: null, other: null, uniqueid: null, message: 'The phone is not connected.' };
    let servers;
    try {
      servers = await phoneApi.live();
    } catch (e) {
      return { mine: null, other: null, uniqueid: null, message: e instanceof ApiError && e.forbidden ? 'Live calls are only visible to supervisors on this server.' : 'The switch could not be asked about this call.' };
    }
    const channels = servers.flatMap((s) => s.channels);
    const digits = l.remote.replace(/\D/g, '').slice(-9);
    const mine = channels.filter((c) => c.channel.startsWith(`PJSIP/${ext}-`));
    const ours = mine.find((c) => digits && (c.connected.replace(/\D/g, '').endsWith(digits) || c.caller.replace(/\D/g, '').endsWith(digits))) ?? mine[0];
    if (!ours) return { mine: null, other: null, uniqueid: null, message: 'The switch does not show this call.' };
    const other = channels.find((c) => c.linkedid === ours.linkedid && c.channel !== ours.channel) ?? null;
    return { mine: ours.channel, other: other?.channel ?? null, uniqueid: ours.linkedid || ours.uniqueid };
  }

  /** Park (res_parking): the caller waits in the parking lot; the switch says which slot. */
  async park(id?: string): Promise<CommandResult> {
    const l = this.line(id);
    if (!l || l.state !== 'connected') return { ok: false, message: 'There is no call to park.' };
    const ch = await this.channelsFor(l);
    if (!ch.other) return { ok: false, message: ch.message ?? 'The other side of this call is not on the switch.' };
    try {
      const r = await phoneApi.control('park', { channel: ch.other });
      this.endLine(l.id, r.slot ? `Parked on ${r.slot}` : 'Parked');
      return { ok: true, message: r.message ?? 'Parked.' };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : 'The call could not be parked.' };
    }
  }

  /** Recording: start, pause for card numbers (VOIP-REC-07), resume, stop — needs ARI on the switch (VOIP-CTL-03). */
  async record(id: string | undefined, action: 'start' | 'pause' | 'resume' | 'stop'): Promise<CommandResult> {
    const l = this.line(id);
    if (!l || l.state !== 'connected') return { ok: false, message: 'There is no call to record.' };
    const ch = await this.channelsFor(l);
    if (!ch.mine) return { ok: false, message: ch.message ?? 'This call is not on the switch.' };
    const name = ch.uniqueid ?? ch.mine;
    try {
      if (action === 'start') await phoneApi.control('record', { channel: ch.mine, name, beep: true });
      else await phoneApi.control(`${action}_recording` as 'pause_recording', { channel: ch.mine, name });
      this.patchLine(l.id, { recording: action === 'start' || action === 'resume' ? 'on' : action === 'pause' ? 'paused' : 'off' });
      return { ok: true };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : 'The recording could not be changed.' };
    }
  }

  focus(id: string): void {
    if (this.state.lines.some((l) => l.id === id)) this.patch({ focused: id });
  }

  setNote(id: string, text: string): void {
    this.patchLine(id, { note: text.slice(0, 20_000) });
    this.patch((s) => (s.ended?.id === id ? { ended: { ...s.ended, note: text.slice(0, 20_000) } } : {}));
  }

  dismissEnded(): void {
    this.patch((s) => ({ ended: null, lines: s.lines.filter((l) => l.state !== 'ended') }));
  }

  clearMissed(): void {
    this.patch({ missed: [] });
  }

  /** One entry point for the compact window, the global shortcuts and the screens. */
  async run(c: Command): Promise<CommandResult> {
    switch (c.cmd) {
      case 'dial':
        return this.dial(c.number, { contactId: c.contactId, name: c.name });
      case 'answer':
        return this.answer(c.id);
      case 'decline':
        return this.decline(c.id, c.voicemail);
      case 'hangup':
        return this.hangup(c.id);
      case 'hold':
        return this.hold(c.id, c.on);
      case 'mute':
        return this.mute(c.id, c.on);
      case 'dtmf':
        return this.dtmf(c.id, c.digit);
      case 'transfer':
        return this.transfer(c.id, c.to);
      case 'consult':
        return this.consult(c.id, c.to);
      case 'complete':
        return this.complete(c.id);
      case 'cancelConsult':
        return this.cancelConsult(c.id);
      case 'conference':
        return this.conference();
      case 'park':
        return this.park(c.id);
      case 'record':
        return this.record(c.id, c.action);
      case 'focus':
        this.focus(c.id);
        return { ok: true };
      case 'note':
        this.setNote(c.id, c.text);
        return { ok: true };
      case 'media':
        this.setMedia(c.patch);
        return { ok: true };
      case 'dismissEnded':
        this.dismissEnded();
        return { ok: true };
      case 'clearMissed':
        this.clearMissed();
        return { ok: true };
      case 'retry':
        void this.retry();
        return { ok: true };
    }
  }

  /** The global shortcuts (D01): answer what rings, hang up what is live, mute it. */
  shortcut(action: 'answer' | 'hangup' | 'mute'): void {
    if (action === 'answer') void this.answer();
    else if (action === 'hangup') {
      const live = this.state.lines.find((l) => l.state === 'connected' && !l.held) ?? this.state.lines.find((l) => l.state === 'dialing' || l.state === 'early');
      if (live) void this.hangup(live.id);
      else {
        const ringing = this.state.lines.find((l) => l.state === 'ringing');
        if (ringing) void this.decline(ringing.id);
      }
    } else this.mute();
  }
}

/** The phone. One per main window; other windows reach it through remote.ts. */
export const phone = new PhoneEngine();

export function usePhone<S>(selector: (s: PhoneState) => S): S {
  return useStore(phone.store, selector);
}

/** A line as it changes, or null. */
export function useLine(id: string | null | undefined): Line | null {
  return usePhone((s) => s.lines.find((l) => l.id === id) ?? null);
}

export function liveLines(s: PhoneState): Line[] {
  return s.lines.filter((l) => l.state !== 'ended');
}

/** How the registration chip reads (W01 "Ext 1042 · Registered"). */
export function phaseLabel(s: Pick<PhoneState, 'phase' | 'extension'> & { talking?: boolean; lines?: Line[] }): { text: string; tone: 'success' | 'warning' | 'danger' | 'muted' } {
  const ext = s.extension ? `Ext ${s.extension}` : 'Phone';
  const talking = s.talking ?? (s.lines ?? []).some((l) => l.state === 'connected');
  switch (s.phase) {
    case 'registered':
      return talking ? { text: `${ext} · On a call`, tone: 'danger' } : { text: `${ext} · Registered`, tone: 'success' };
    case 'starting':
    case 'connecting':
      return { text: `${ext} · Connecting…`, tone: 'muted' };
    case 'reconnecting':
      return { text: `${ext} · Reconnecting…`, tone: 'warning' };
    case 'no-extension':
      return { text: 'No extension', tone: 'muted' };
    case 'needs-reload':
      return { text: `${ext} · Restart needed`, tone: 'warning' };
    case 'failed':
      return { text: `${ext} · Not registered`, tone: 'danger' };
    case 'unavailable':
      return { text: 'Phone unavailable', tone: 'muted' };
    default:
      return { text: ext, tone: 'muted' };
  }
}

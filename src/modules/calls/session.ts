import { app } from '../../core/app-state';
import { createLocalTracks, Room, RoomEvent, Track, VideoPresets, type LocalParticipant, type LocalTrack, type Participant, type RemoteTrack } from 'livekit-client';
import { ApiError, apiGet, apiPost, request } from '../../core/api';
import { call, errorMessage, on } from '../../core/bridge';
import { text } from '../../core/i18n';
import type { SharePick } from './ScreenPicker';

/**
 * One chat call, in its own window (CallVoice / CallVideo). Kept outside
 * React: a call is a connection with a life of its own, and a component
 * mounting twice must not place it twice.
 *
 * The server's call API (`/api/chat/calls`) rings and records; the media goes
 * through LiveKit with the token it returns. The caller's no-answer timeout,
 * hanging up when the other person has left a direct call, and noticing the
 * call ended elsewhere are all this side's job; the server's `chat.call.*`
 * events and the poll of the call say how it is going.
 *
 * A caller reads Calling until a device of the other person's shows the ring
 * (`chat.call.updated`, `what: ringing`), then Ringing, then Connecting once
 * somebody answered and until their media arrives (worksuite-desktop#113).
 * The one answering reads Connecting until the caller's media is there.
 */
export type Phase = 'devices' | 'placing' | 'calling' | 'ringing' | 'connecting' | 'connected' | 'ended' | 'unreachable' | 'error';

/** Why nobody is on the line: what the call window says, and whether a voice message is offered. */
export type Unreachable = 'busy' | 'offline' | 'no_answer' | 'declined';

export interface CallParams {
  roomId: number;
  mode: 'audio' | 'video';
  /** Who or what is being called, for the window until the server says. */
  name: string;
  /** Answering a call that rang here, rather than placing one. */
  uuid?: string;
}

export interface Connection {
  uuid: string;
  status: 'ringing' | 'connected' | 'ended';
  mode: 'audio' | 'video';
  room_id: number;
  video: boolean;
  url: string;
  token: string;
  i_started: boolean;
  members: Member[];
}

export interface Member {
  user_id: number;
  name: string;
  state: string;
  /** A device of theirs is showing the ring. Absent from a server before worksuite-desktop#113: read as shown. */
  delivered?: boolean;
}

/** Calling until a device of somebody being rung shows the ring, then Ringing. */
export function ringPhase(members: Member[] | undefined): 'calling' | 'ringing' {
  const rung = (members ?? []).filter((m) => m.state === 'ringing');
  return !rung.length || rung.some((m) => m.delivered !== false) ? 'ringing' : 'calling';
}

/**
 * What a call that stopped before anybody talked means to the caller: Declined,
 * Busy (everybody declined as busy) or No answer — or null, an ending to show as
 * "Call ended" (answered, cancelled here, merged, ended elsewhere).
 */
export function stoppedAs(outcome: string | null | undefined, reason: string | null | undefined, talked: boolean, iStarted: boolean): Unreachable | null {
  if (talked || !iStarted) return null;
  if (outcome === 'missed') return 'no_answer';
  if (outcome === 'declined') return reason === 'busy' ? 'busy' : 'declined';
  return null;
}

interface Unplaced {
  placed: false;
  outcome: 'busy' | 'offline';
  room_id: number;
  voicemail: boolean;
  who?: Record<string, string>;
}

/**
 * How the call is going, in words, and the colour they are drawn in: Calling,
 * Ringing, Connecting, Connected with the clock, Reconnecting, Busy, Declined,
 * No answer, Call ended.
 */
export function statusLine(
  s: { phase: Phase; answering: boolean; unreachable: { reason: Unreachable } | null; reconnecting: boolean; remoteLost: boolean; lost: boolean },
  clock: string | null,
  endedAfter: string | null,
): [string, string] {
  switch (s.phase) {
    case 'devices':
    case 'placing':
      return s.answering ? [text('Connecting…'), 'text-[#FDE68A]'] : [text('Calling…'), 'text-[#AFC0E8]'];
    case 'calling':
      return [text('Calling…'), 'text-[#AFC0E8]'];
    case 'ringing':
      return [text('Ringing…'), 'text-[#AFC0E8]'];
    case 'connecting':
      return [text('Connecting…'), 'text-[#FDE68A]'];
    case 'connected':
      return s.reconnecting || s.remoteLost ? [`${text('Reconnecting…')} · ${clock ?? '0:00'}`, 'text-[#FDE68A]'] : [`${text('Connected')} · ${clock ?? '0:00'}`, 'text-[#9EE6C3]'];
    case 'ended':
      return [`${text('Call ended')}${s.lost ? ` · ${text('connection lost')}` : ''}${endedAfter ? ` · ${endedAfter}` : ''}`, 'text-[#AFC0E8]'];
    case 'unreachable': {
      const r = s.unreachable?.reason;
      return [text(r === 'busy' ? 'Busy' : r === 'declined' ? 'Declined' : r === 'offline' ? 'Not available right now' : 'No answer'), 'text-[#FFD2C4]'];
    }
    default:
      return [text('Connecting…'), 'text-[#FDE68A]'];
  }
}

/** Browser-side voice processing: on by default, off for music or a quiet room. */
export const CLEAN_AUDIO = { noiseSuppression: true, echoCancellation: true, autoGainControl: true };
export const RAW_AUDIO = { noiseSuppression: false, echoCancellation: true, autoGainControl: false };

/** The caller gives up after this long with nobody picking up: as long as the server rings (CallState::RING_SECONDS). */
export const NO_ANSWER_MS = 45_000;
/**
 * How long a connection that dropped — this side's, or the other person's in a
 * direct call — may take to come back before the call is given up. The server
 * ends a call between two the moment either hangs up, so a gone person who is
 * not heard of as hanging up is somebody whose connection dropped.
 */
export const RECONNECT_MS = 30_000;
/** Between tries to get back into a call whose connection dropped. */
const RETRY_MS = 3_000;
const SPEAKER_KEY = 'ws.calls.speaker';

export function savedSpeaker(): string {
  try {
    return localStorage.getItem(SPEAKER_KEY) ?? '';
  } catch {
    return '';
  }
}

/** Remember the speaker calls play through on this computer ('' for the system's): every kind of call shares it. */
export function saveSpeaker(id: string): void {
  try {
    if (id) localStorage.setItem(SPEAKER_KEY, id);
    else localStorage.removeItem(SPEAKER_KEY);
  } catch {
    // Remembering is a convenience; the call in hand still uses it.
  }
}

/** Play into this output device ('' for the system's). Not every element or system can: then the default plays. */
export async function sinkTo(el: HTMLMediaElement, id: string): Promise<void> {
  const sink = el as HTMLMediaElement & { setSinkId?: (id: string) => Promise<void> };
  await sink.setSinkId?.(id).catch(() => undefined);
}

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export interface DeviceProblem {
  message: string;
  pane: 'microphone' | 'camera' | null;
}

/** What went wrong opening the microphone or camera, in words a person can act on. */
export function deviceProblem(e: unknown, what: 'microphone' | 'camera' = 'microphone'): DeviceProblem {
  const name = e instanceof Error ? e.name : '';
  const Dev = what === 'camera' ? 'Camera' : 'Microphone';
  if (name === 'NotAllowedError' || name === 'SecurityError') return { message: `${Dev} blocked (${name}). WorkSuite needs ${what} access in your system privacy settings.`, pane: what };
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return { message: `No ${what} was found (${name}). Connect one, or choose another in your system sound settings.`, pane: what };
  if (name === 'NotReadableError' || name === 'AbortError') return { message: `The ${what} is in use by another app (${name}). Close it there and try again.`, pane: null };
  return { message: `The ${what} could not be started: ${errorMessage(e)}`, pane: null };
}

export class CallSession {
  phase: Phase = 'devices';
  params: CallParams | null = null;
  conn: Connection | null = null;
  problem: DeviceProblem | null = null;
  /** Why nobody is on the line, when the call could not be made or was not answered. */
  unreachable: { reason: Unreachable; voicemail: boolean } | null = null;
  room: Room | null = null;
  connectedAt: number | null = null;
  endedAfter: number | null = null;
  /** The call ended because a dropped connection did not come back in time. */
  lost = false;
  /** This side's connection dropped and is coming back: "Reconnecting…", the clock running on. */
  reconnecting = false;
  /** The other person in a direct call dropped and has not come back yet. */
  remoteLost = false;
  noise = true;
  sound = true;
  /** The output devices, and the one the call plays through ('' is the system's). */
  speakers: MediaDeviceInfo[] = [];
  speakerId = savedSpeaker();
  /** Who spoke last (not you), so the big picture stays on them in a pause. */
  lastSpeaker: string | null = null;
  /** What is being shared, in words: "Screen 1", "Visual Studio Code". */
  shareLabel: string | null = null;
  private version = 0;
  private listeners = new Set<() => void>();
  private audio = new Set<HTMLMediaElement>();
  private cleanups: Array<() => void> = [];
  private tracks: LocalTrack[] = [];
  private busy = false;
  private left = false;
  private joined = false;
  private recovering = false;
  /** When the caller's ring runs out, kept across a reconnect so the ring is not given longer. */
  private ringUntil: number | null = null;
  private closing: ReturnType<typeof setTimeout> | null = null;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  snapshot = (): number => this.version;

  private changed(): void {
    this.version++;
    for (const fn of this.listeners) fn();
  }

  private set(phase: Phase): void {
    this.phase = phase;
    this.changed();
  }

  get remoteCount(): number {
    return this.room?.remoteParticipants.size ?? 0;
  }

  /** Place (or answer) the call: devices first, while the click still counts, then the server, then the media. */
  async start(p: CallParams): Promise<void> {
    if (this.busy || (this.params && this.phase !== 'error')) return;
    this.busy = true;
    this.params = p;
    this.left = false;
    this.joined = false;
    this.lost = false;
    this.ringUntil = null;
    this.problem = null;
    this.set('devices');
    try {
      const video = p.mode === 'video' && !app.get().lock?.locked;
      if (!(await call('media:access', { kind: 'microphone' })).granted) {
        this.problem = deviceProblem(Object.assign(new Error('denied'), { name: 'NotAllowedError' }));
        this.set('error');
        return;
      }
      const camera = video ? (await call('media:access', { kind: 'camera' })).granted : false;
      try {
        this.tracks = await createLocalTracks({ audio: CLEAN_AUDIO, video: camera && !app.get().lock?.locked ? { resolution: VideoPresets.h720.resolution } : false });
      } catch (e) {
        // A camera that fails is no reason not to talk.
        if (!camera) throw e;
        this.tracks = await createLocalTracks({ audio: CLEAN_AUDIO, video: false });
      }
    } catch (e) {
      this.problem = deviceProblem(e);
      this.set('error');
      return;
    } finally {
      this.busy = false;
    }
    // Named now that the microphone may be used: the list for choosing a speaker.
    void this.listSpeakers();

    this.set('placing');
    let conn: Connection;
    try {
      const r = p.uuid
        ? await apiPost<Connection>(`/api/chat/calls/${p.uuid}/answer`, { video: p.mode === 'video' && !app.get().lock?.locked })
        : await apiPost<Connection | Unplaced>('/api/chat/calls', { room_id: p.roomId, mode: p.mode });
      if ('placed' in r && r.placed === false) {
        this.stopTracks();
        this.unreachable = { reason: r.outcome, voicemail: r.voicemail };
        this.set('unreachable');
        return;
      }
      conn = r as Connection;
    } catch (e) {
      this.stopTracks();
      this.problem = { message: e instanceof ApiError && e.status === 410 ? 'That call has already ended.' : errorMessage(e), pane: null };
      this.set('error');
      return;
    }
    this.conn = conn;
    void call('calls:active', { uuid: conn.uuid, kind: 'call', title: p.name ? `Call · ${p.name}` : 'Call' });
    await this.connect(conn);
  }

  /**
   * Into the media room. `again` is coming back after the connection dropped:
   * a failure then is reported to the caller of this (recover), not as the
   * call failing.
   */
  private async connect(conn: Connection, again = false): Promise<boolean> {
    const room = new Room({ adaptiveStream: true, dynacast: true });
    this.room = room;
    const refresh = () => this.changed();
    room
      .on(RoomEvent.ParticipantConnected, () => {
        if (this.phase !== 'connected') {
          this.connectedAt ??= Date.now();
          this.phase = 'connected';
        }
        this.remoteLost = false;
        refresh();
      })
      .on(RoomEvent.ParticipantDisconnected, () => {
        refresh();
        this.whenAlone();
      })
      .on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
        if (track.kind === Track.Kind.Audio) {
          const el = track.attach();
          el.muted = !this.sound;
          if (this.speakerId) void sinkTo(el, this.speakerId);
          document.body.appendChild(el);
          this.audio.add(el);
        }
        refresh();
      })
      .on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
        for (const el of track.detach()) {
          this.audio.delete(el);
          el.remove();
        }
        refresh();
      })
      .on(RoomEvent.TrackMuted, refresh)
      .on(RoomEvent.TrackUnmuted, refresh)
      .on(RoomEvent.LocalTrackPublished, refresh)
      .on(RoomEvent.LocalTrackUnpublished, refresh)
      .on(RoomEvent.ActiveSpeakersChanged, (speakers: Participant[]) => {
        this.lastSpeaker = speakers.find((p) => !p.isLocal)?.identity ?? this.lastSpeaker;
        refresh();
      })
      // The media connection blipped: LiveKit is putting it back by itself.
      .on(RoomEvent.Reconnecting, () => {
        this.reconnecting = true;
        refresh();
      })
      .on(RoomEvent.Reconnected, () => {
        this.reconnecting = false;
        refresh();
      })
      .on(RoomEvent.Disconnected, () => {
        // Our own leaving (the room was let go first), or a failed connect: that is not this.
        if (room !== this.room || !this.joined || this.left || this.phase === 'ended' || this.phase === 'unreachable') return;
        // LiveKit gave up putting it back: get back into the call ourselves, for a while.
        void this.recover();
      });
    try {
      await room.connect(conn.url, conn.token);
      this.joined = true;
      for (const t of this.tracks) await room.localParticipant.publishTrack(t);
    } catch (e) {
      if (again) {
        if (this.room === room) this.room = null;
        void room.disconnect();
        return false;
      }
      this.problem = { message: `Could not connect the call: ${errorMessage(e)}`, pane: null };
      await this.hangUp(false);
      this.set('error');
      return false;
    }
    if (room.remoteParticipants.size > 0) {
      this.connectedAt ??= Date.now();
      this.remoteLost = false;
      this.set('connected');
    } else if (this.connectedAt) {
      // Back from a dropped connection before the other person is: they are coming back too.
      this.set('connected');
      this.whenAlone();
    } else this.set(conn.i_started ? ringPhase(conn.members) : 'connecting');

    // Nobody picks up: the caller gives up when the ring runs out, and may leave a voice message.
    if (conn.i_started && !this.connectedAt && room.remoteParticipants.size === 0) {
      this.ringUntil ??= Date.now() + NO_ANSWER_MS;
      const t = setTimeout(() => {
        if ((this.phase === 'calling' || this.phase === 'ringing') && this.remoteCount === 0) {
          void this.hangUp(false, 'no_answer').then(() => {
            this.unreachable = { reason: 'no_answer', voicemail: true };
            this.set('unreachable');
          });
        }
      }, Math.max(0, this.ringUntil - Date.now()));
      this.cleanups.push(() => clearTimeout(t));
    }
    // The call may end, be answered or start ringing without anyone here noticing through the media.
    const poll = setInterval(() => {
      void apiGet<{ status: string; outcome?: string | null; decline_reason?: string | null; members?: Member[] }>(`/api/chat/calls/${conn.uuid}`)
        .then((s) => {
          if (s.status === 'ended') this.stopped(s.outcome, s.decline_reason);
          else if (s.status === 'connected' && conn.i_started && (this.phase === 'calling' || this.phase === 'ringing')) this.set('connecting');
          else if (this.phase === 'calling' && ringPhase(s.members) === 'ringing') this.set('ringing');
        })
        .catch(() => undefined);
    }, 5_000);
    this.cleanups.push(() => clearInterval(poll));
    this.cleanups.push(
      on<{ type: string; uuid?: string; outcome?: string; reason?: string; what?: string }>('realtime:event', (e) => {
        if (e.uuid !== conn.uuid) return;
        if (e.type === 'chat.call.stopped') {
          // "Answered" stops the ring; for the caller, the other side is on the way.
          if (e.outcome !== 'answered') this.stopped(e.outcome, e.reason);
          else if (conn.i_started && (this.phase === 'calling' || this.phase === 'ringing')) this.set('connecting');
        } else if (e.type === 'chat.call.updated' && e.what === 'ringing' && this.phase === 'calling') this.set('ringing');
      }),
    );
    return true;
  }

  /** The call stopped on the server: said as Declined, Busy or No answer when nobody talked, else ended. */
  private stopped(outcome: string | null | undefined, reason: string | null | undefined): void {
    if (this.phase === 'ended' || this.phase === 'unreachable') return;
    const why = stoppedAs(outcome, reason, !!this.connectedAt, !!this.conn?.i_started);
    if (!why) {
      void this.finish();
      return;
    }
    void this.hangUp(false).then(() => {
      this.unreachable = { reason: why, voicemail: why !== 'declined' };
      this.set('unreachable');
    });
  }

  /**
   * The media connection dropped and LiveKit could not put it back: answer the
   * call again (a fresh token, the same place on it) and rejoin, every few
   * seconds, for RECONNECT_MS. The clock runs on; the window says
   * "Reconnecting…". A call that ended meanwhile, or one that does not come
   * back in time, ends here.
   */
  private async recover(): Promise<void> {
    const conn = this.conn;
    if (this.recovering || !conn || this.left) return;
    this.recovering = true;
    this.reconnecting = true;
    const lp = this.room?.localParticipant;
    const muted = lp ? !lp.isMicrophoneEnabled : false;
    const camera = !!lp?.isCameraEnabled;
    this.teardown();
    this.changed();
    const until = Date.now() + RECONNECT_MS;
    let over = false;
    while (!this.left && !over && Date.now() < until) {
      try {
        const fresh = await apiPost<Connection>(`/api/chat/calls/${conn.uuid}/answer`, { video: false });
        this.tracks = await createLocalTracks({ audio: this.noise ? CLEAN_AUDIO : RAW_AUDIO, video: false });
        if (this.left) break;
        this.conn = fresh;
        if (await this.connect(fresh, true)) {
          const back = this.room?.localParticipant;
          if (back && muted) await back.setMicrophoneEnabled(false).catch(() => undefined);
          if (back && camera && !app.get().lock?.locked) await back.setCameraEnabled(true).catch(() => undefined);
          this.recovering = false;
          this.reconnecting = false;
          this.changed();
          return;
        }
        this.stopTracks();
      } catch (e) {
        this.stopTracks();
        // Over on the server, or no longer ours to join: nothing to come back to.
        over = e instanceof ApiError && [403, 404, 410].includes(e.status);
      }
      if (!over && !this.left) await pause(RETRY_MS);
    }
    this.recovering = false;
    this.reconnecting = false;
    if (this.left) return;
    this.lost = !over;
    await this.finish();
  }

  /**
   * A direct call whose other person has gone (a group call carries on). Their
   * hanging up ends the call on the server, which says so at once; until then
   * they dropped, and have RECONNECT_MS to come back.
   */
  private whenAlone(): void {
    const direct = (this.conn?.members.length ?? 0) <= 2;
    if (!direct || this.phase !== 'connected' || this.remoteCount > 0) return;
    this.remoteLost = true;
    this.changed();
    const t = setTimeout(() => {
      if (this.remoteCount === 0 && this.phase === 'connected') {
        this.lost = true;
        void this.hangUp();
      }
    }, RECONNECT_MS);
    this.cleanups.push(() => clearTimeout(t));
  }

  /** The output devices, named once the microphone may be used. */
  async listSpeakers(): Promise<void> {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      this.speakers = all.filter((d) => d.kind === 'audiooutput' && d.deviceId !== 'default');
    } catch {
      this.speakers = [];
    }
    // A speaker that is no longer here: the system's plays, and the choice stays for when it is back.
    this.changed();
  }

  /** Play the call through this speaker ('' for the system's), now and next time. */
  async setSpeaker(id: string): Promise<void> {
    this.speakerId = id;
    saveSpeaker(id);
    await Promise.all([...this.audio].map((el) => sinkTo(el, id)));
    this.changed();
  }

  async toggleMic(): Promise<void> {
    const lp = this.room?.localParticipant;
    if (lp) await lp.setMicrophoneEnabled(!lp.isMicrophoneEnabled).catch((e) => this.fail(e));
    this.changed();
  }

  async toggleCamera(): Promise<void> {
    const lp = this.room?.localParticipant;
    if (!lp) return;
    // Turning a voice call into video is this side's camera only: the other person's stays as they left it.
    if (!lp.isCameraEnabled && app.get().lock?.locked) {
      this.problem = { message: 'Unlock WorkSuite to turn your camera on.', pane: null };
      this.changed();
      return;
    }
    if (!lp.isCameraEnabled && !(await call('media:access', { kind: 'camera' })).granted) {
      this.problem = deviceProblem(Object.assign(new Error('denied'), { name: 'NotAllowedError' }), 'camera');
      this.changed();
      return;
    }
    await lp.setCameraEnabled(!lp.isCameraEnabled).catch((e) => {
      this.problem = deviceProblem(e, 'camera');
    });
    this.changed();
  }

  /** Share the screen or window picked in our picker (the page never picks for itself), or stop. */
  async share(pick: SharePick | null): Promise<void> {
    if (pick && app.get().lock?.locked) return;
    const lp = this.room?.localParticipant;
    if (!lp) return;
    try {
      await shareOn(lp, pick);
      if (pick && app.get().lock?.locked) { await shareOn(lp, null); pick = null; }
      this.shareLabel = pick ? pick.name : null;
    } catch (e) {
      this.fail(e);
    }
    this.changed();
  }

  get sharePaused(): boolean {
    return !!this.room?.localParticipant.getTrackPublication(Track.Source.ScreenShare)?.isMuted;
  }

  /** Pause or resume the share: the others see "Screen sharing paused"; the call and cameras go on. */
  async pauseShare(paused: boolean): Promise<void> {
    await pauseOn(this.room?.localParticipant, paused).catch((e) => this.fail(e));
    this.changed();
  }

  async toggleNoise(): Promise<void> {
    this.noise = !this.noise;
    const pub = this.room?.localParticipant.getTrackPublication(Track.Source.Microphone);
    await pub?.track?.mediaStreamTrack.applyConstraints(this.noise ? CLEAN_AUDIO : RAW_AUDIO).catch(() => undefined);
    this.changed();
  }

  toggleSound(): void {
    this.sound = !this.sound;
    for (const el of this.audio) el.muted = !this.sound;
    this.changed();
  }

  /**
   * Leave the call. The server ends it when nobody is left, and a call between
   * two when either goes. `no_answer`: the caller's ring ran out, which the
   * server records as missed rather than cancelled.
   */
  async hangUp(close = true, reason?: 'no_answer'): Promise<void> {
    // Once: leaving twice used to re-finish a cancelled call as answered.
    const uuid = this.left ? null : this.conn?.uuid;
    this.left = true;
    this.teardown();
    if (uuid) await apiPost(`/api/chat/calls/${uuid}/end`, reason ? { reason } : undefined).catch(() => undefined);
    void call('calls:active', { uuid: null });
    if (close) {
      this.endedAfter = this.connectedAt ? Date.now() - this.connectedAt : null;
      this.set('ended');
      this.closeSoon(8_000);
    }
  }

  /** Ended from elsewhere: the other side, another device, or the server. */
  private async finish(): Promise<void> {
    if (this.phase === 'ended') return;
    // Leave on the server too (a no-op when the call is already over there).
    const uuid = this.left ? null : this.conn?.uuid;
    this.left = true;
    if (uuid) void apiPost(`/api/chat/calls/${uuid}/end`).catch(() => undefined);
    this.endedAfter = this.connectedAt ? Date.now() - this.connectedAt : null;
    this.teardown();
    void call('calls:active', { uuid: null });
    this.set('ended');
    this.closeSoon(8_000);
  }

  /** "Call again" from the ended screen: a new call to the same conversation. */
  async again(): Promise<void> {
    if (!this.params || (this.phase !== 'ended' && this.phase !== 'unreachable')) return;
    if (this.closing) clearTimeout(this.closing);
    this.closing = null;
    const p: CallParams = { roomId: this.params.roomId, mode: this.params.mode, name: this.params.name };
    this.params = null;
    this.conn = null;
    this.unreachable = null;
    this.connectedAt = null;
    this.endedAfter = null;
    this.lost = false;
    await this.start(p);
  }

  /** Keep the ended screen up: somebody is reaching for Call again or Message. */
  stay(): void {
    if (this.closing) clearTimeout(this.closing);
    this.closing = null;
  }

  private closeSoon(ms: number): void {
    if (this.closing) clearTimeout(this.closing);
    this.closing = setTimeout(() => void call('windows:close'), ms);
  }

  async voicemail(blob: Blob, ms: number): Promise<void> {
    const form = new FormData();
    form.append('room_id', String(this.params?.roomId ?? ''));
    form.append('seconds', String(Math.max(1, Math.round(ms / 1000))));
    form.append('audio', blob, blob.type.includes('mp4') ? 'voice-message.m4a' : 'voice-message.webm');
    await request('POST', '/api/chat/voicemail', { body: form });
  }

  private fail(e: unknown): void {
    this.problem = { message: errorMessage(e), pane: null };
  }

  private stopTracks(): void {
    for (const t of this.tracks) t.stop();
    this.tracks = [];
  }

  private teardown(): void {
    this.reconnecting = this.recovering;
    this.remoteLost = false;
    for (const c of this.cleanups.splice(0)) c();
    for (const el of this.audio) el.remove();
    this.audio.clear();
    const room = this.room;
    this.room = null;
    if (room) void room.disconnect();
    this.stopTracks();
  }
}

/** The one call this window is for. */
export const session = new CallSession();

/**
 * Start, switch or stop a screen share. Switching stops the old share first
 * and starts the new one: the call, the camera and the microphone are not
 * touched, and the others see the new screen a moment later.
 */
export async function shareOn(lp: LocalParticipant, pick: SharePick | null): Promise<void> {
  if (lp.isScreenShareEnabled) await lp.setScreenShareEnabled(false);
  if (!pick) return;
  await call('media:screenPick', { id: pick.id, audio: pick.audio });
  try { await lp.setScreenShareEnabled(true, { audio: pick.audio }); }
  catch (e) {
    const name = e instanceof Error ? e.name : '';
    const detail = errorMessage(e);
    throw new Error(name === 'NotAllowedError' || name === 'SecurityError'
      ? `Screen capture was refused. Check Screen Recording / Screen & System Audio Recording for the running WorkSuite app; Accessibility is separate. ${detail}`
      : name === 'NotFoundError' ? `The selected screen or window is no longer available. Refresh the sharing picker. ${detail}`
      : `Screen capture could not start or be published to the call. ${detail}`);
  }
}

export async function pauseOn(lp: LocalParticipant | undefined, paused: boolean): Promise<void> {
  const pub = lp?.getTrackPublication(Track.Source.ScreenShare);
  if (!pub?.track) return;
  if (paused) await pub.mute();
  else await pub.unmute();
}

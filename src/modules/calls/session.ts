import { createLocalTracks, Room, RoomEvent, Track, VideoPresets, type LocalTrack, type RemoteTrack } from 'livekit-client';
import { ApiError, apiGet, apiPost, request } from '../../core/api';
import { call, errorMessage, on } from '../../core/bridge';

/**
 * One chat call, in its own window (CallVoice / CallVideo). Kept outside
 * React: a call is a connection with a life of its own, and a component
 * mounting twice must not place it twice.
 *
 * The server's call API (`/api/chat/calls`) rings and records; the media goes
 * through LiveKit with the token it returns. The caller's no-answer timeout,
 * hanging up when the other person has left a direct call, and noticing the
 * call ended elsewhere are all this side's job — the server does not push
 * "connected" or "ended" to a caller.
 */
export type Phase = 'devices' | 'placing' | 'ringing' | 'connected' | 'ended' | 'unreachable' | 'error';

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
  members: Array<{ user_id: number; name: string; state: string }>;
}

interface Unplaced {
  placed: false;
  outcome: 'busy' | 'offline';
  room_id: number;
  voicemail: boolean;
  who?: Record<string, string>;
}

/** Browser-side voice processing: on by default, off for music or a quiet room. */
export const CLEAN_AUDIO = { noiseSuppression: true, echoCancellation: true, autoGainControl: true };
export const RAW_AUDIO = { noiseSuppression: false, echoCancellation: true, autoGainControl: false };

/** The caller gives up after this long with nobody picking up (the server rings for 45 s). */
export const NO_ANSWER_MS = 30_000;
/** A direct call whose other side has gone for this long is over. */
const ALONE_MS = 2_500;

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
  unreachable: { reason: 'busy' | 'offline' | 'no_answer'; voicemail: boolean } | null = null;
  room: Room | null = null;
  connectedAt: number | null = null;
  endedAfter: number | null = null;
  noise = true;
  sound = true;
  private version = 0;
  private listeners = new Set<() => void>();
  private audio = new Set<HTMLMediaElement>();
  private cleanups: Array<() => void> = [];
  private tracks: LocalTrack[] = [];
  private busy = false;

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
    this.problem = null;
    this.set('devices');
    try {
      const video = p.mode === 'video';
      if (!(await call('media:access', { kind: 'microphone' })).granted) {
        this.problem = deviceProblem(Object.assign(new Error('denied'), { name: 'NotAllowedError' }));
        this.set('error');
        return;
      }
      const camera = video ? (await call('media:access', { kind: 'camera' })).granted : false;
      try {
        this.tracks = await createLocalTracks({ audio: CLEAN_AUDIO, video: camera ? { resolution: VideoPresets.h720.resolution } : false });
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

    this.set('placing');
    let conn: Connection;
    try {
      const r = p.uuid
        ? await apiPost<Connection>(`/api/chat/calls/${p.uuid}/answer`, { video: p.mode === 'video' })
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
    void call('calls:active', { uuid: conn.uuid });
    await this.connect(conn);
  }

  private async connect(conn: Connection): Promise<void> {
    const room = new Room({ adaptiveStream: true, dynacast: true });
    this.room = room;
    const refresh = () => this.changed();
    room
      .on(RoomEvent.ParticipantConnected, () => {
        if (this.phase !== 'connected') {
          this.connectedAt = Date.now();
          this.phase = 'connected';
        }
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
      .on(RoomEvent.ActiveSpeakersChanged, refresh)
      .on(RoomEvent.Disconnected, () => {
        if (this.phase !== 'ended' && this.phase !== 'unreachable') void this.finish();
      });
    try {
      await room.connect(conn.url, conn.token);
      for (const t of this.tracks) await room.localParticipant.publishTrack(t);
    } catch (e) {
      this.problem = { message: `Could not connect the call: ${errorMessage(e)}`, pane: null };
      await this.hangUp(false);
      this.set('error');
      return;
    }
    if (room.remoteParticipants.size > 0) {
      this.connectedAt = Date.now();
      this.set('connected');
    } else this.set('ringing');

    // Nobody picks up: the caller gives up, and may leave a voice message.
    if (conn.i_started && room.remoteParticipants.size === 0) {
      const t = setTimeout(() => {
        if (this.phase === 'ringing' && this.remoteCount === 0) {
          void this.hangUp(false).then(() => {
            this.unreachable = { reason: 'no_answer', voicemail: true };
            this.set('unreachable');
          });
        }
      }, NO_ANSWER_MS);
      this.cleanups.push(() => clearTimeout(t));
    }
    // The call may end without anyone here noticing through the media.
    const poll = setInterval(() => {
      void apiGet<{ status: string }>(`/api/chat/calls/${conn.uuid}`)
        .then((s) => {
          if (s.status === 'ended') void this.finish();
        })
        .catch(() => undefined);
    }, 5_000);
    this.cleanups.push(() => clearInterval(poll));
    this.cleanups.push(
      on<{ type: string; uuid?: string; outcome?: string }>('realtime:event', (e) => {
        // "answered" also means someone else picked up; only the end of a call ends it.
        if (e.type === 'chat.call.stopped' && e.uuid === conn.uuid && e.outcome !== 'answered') void this.finish();
      }),
    );
  }

  /** A direct call is over once the other person has gone (a group call carries on). */
  private whenAlone(): void {
    const direct = (this.conn?.members.length ?? 0) <= 2;
    if (!direct || this.phase !== 'connected' || this.remoteCount > 0) return;
    const t = setTimeout(() => {
      if (this.remoteCount === 0 && this.phase === 'connected') void this.hangUp();
    }, ALONE_MS);
    this.cleanups.push(() => clearTimeout(t));
  }

  async toggleMic(): Promise<void> {
    const lp = this.room?.localParticipant;
    if (lp) await lp.setMicrophoneEnabled(!lp.isMicrophoneEnabled).catch((e) => this.fail(e));
    this.changed();
  }

  async toggleCamera(): Promise<void> {
    const lp = this.room?.localParticipant;
    if (!lp) return;
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

  /** Share the screen or window picked in our picker (the page never picks for itself). */
  async share(sourceId: string | null): Promise<void> {
    const lp = this.room?.localParticipant;
    if (!lp) return;
    try {
      if (sourceId === null) await lp.setScreenShareEnabled(false);
      else {
        await call('media:screenPick', { id: sourceId });
        await lp.setScreenShareEnabled(true, { audio: false });
      }
    } catch (e) {
      this.fail(e);
    }
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

  /** Leave the call. The server ends it when nobody is left. */
  async hangUp(close = true): Promise<void> {
    const uuid = this.conn?.uuid;
    this.teardown();
    if (uuid) await apiPost(`/api/chat/calls/${uuid}/end`).catch(() => undefined);
    void call('calls:active', { uuid: null });
    if (close) {
      this.endedAfter = this.connectedAt ? Date.now() - this.connectedAt : null;
      this.set('ended');
      setTimeout(() => void call('windows:close'), 1_500);
    }
  }

  /** Ended from elsewhere: the other side, another device, or the server. */
  private async finish(): Promise<void> {
    if (this.phase === 'ended') return;
    this.endedAfter = this.connectedAt ? Date.now() - this.connectedAt : null;
    this.teardown();
    void call('calls:active', { uuid: null });
    this.set('ended');
    setTimeout(() => void call('windows:close'), 2_000);
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

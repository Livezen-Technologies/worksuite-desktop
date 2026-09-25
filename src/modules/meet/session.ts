import { DisconnectReason, Room, RoomEvent, Track, VideoPresets, type Participant, type RemoteParticipant } from 'livekit-client';
import { ApiError, apiGet, apiPost, apiPut } from '../../core/api';
import { call, errorMessage } from '../../core/bridge';
import { CLEAN_AUDIO } from '../calls/session';
import type { MeetInfo, Sfu } from './api';

/**
 * One Meet meeting, in its window (MeetLobby → MeetRoom). Like a call, kept
 * outside React so the connection has one owner.
 *
 * The server keeps no waiting list: somebody who is not the host joins with a
 * token that cannot publish or subscribe and metadata `{waiting: true}`; the
 * host sees them as a waiting participant and admits them (which grants
 * publishing) or removes them. Meeting chat is the meeting's chat room; the
 * whiteboard travels on the data channel (topic `wb`) and the host saves it.
 */
export type MeetPhase = 'loading' | 'lobby' | 'joining' | 'waiting' | 'in' | 'left' | 'ended' | 'error';

export interface Stroke {
  color: string;
  width: number;
  /** 0–1 on each axis, so every screen draws the same board. */
  points: Array<[number, number]>;
}

type Board = { t: 'stroke'; s: Stroke } | { t: 'clear' };

export function metaOf(p: Participant): { host?: boolean; waiting?: boolean } {
  try {
    return p.metadata ? (JSON.parse(p.metadata) as { host?: boolean; waiting?: boolean }) : {};
  } catch {
    return {};
  }
}

export function isGuest(p: Participant): boolean {
  return p.identity.startsWith('g-');
}

export class MeetSession {
  phase: MeetPhase = 'loading';
  uuid = '';
  info: MeetInfo | null = null;
  locked = false;
  error: string | null = null;
  /** Why the meeting ended for us, in a sentence. */
  farewell: string | null = null;
  room: Room | null = null;
  joinedAt: number | null = null;
  strokes: Stroke[] = [];
  private version = 0;
  private listeners = new Set<() => void>();
  private audio = new Set<HTMLMediaElement>();
  private wants = { mic: true, cam: true };
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  snapshot = (): number => this.version;

  changed(): void {
    this.version++;
    for (const fn of this.listeners) fn();
  }

  get isHost(): boolean {
    return !!this.info?.is_host;
  }

  get canPublish(): boolean {
    return this.room?.localParticipant.permissions?.canPublish ?? false;
  }

  /** People admitted to the meeting (not the ones waiting at the door). */
  get present(): RemoteParticipant[] {
    return this.room ? [...this.room.remoteParticipants.values()].filter((p) => !metaOf(p).waiting) : [];
  }

  get waiting(): RemoteParticipant[] {
    return this.room ? [...this.room.remoteParticipants.values()].filter((p) => metaOf(p).waiting) : [];
  }

  async load(uuid: string): Promise<void> {
    // Once per meeting; again only to rejoin after leaving, or to retry.
    if (this.uuid === uuid && this.phase !== 'error' && this.phase !== 'left') return;
    this.farewell = null;
    this.error = null;
    this.uuid = uuid;
    this.phase = 'loading';
    this.changed();
    try {
      this.info = await apiGet<MeetInfo>(`/api/meet/${uuid}`);
      const pub = await apiGet<{ locked: boolean }>(`/api/meet/${uuid}/public`).catch(() => ({ locked: false }));
      this.locked = !!pub.locked;
      this.phase = this.info.ended ? 'ended' : 'lobby';
      if (this.info.ended) this.farewell = 'This meeting has ended.';
    } catch (e) {
      this.error = e instanceof ApiError && e.status === 404 ? 'There is no meeting at this link.' : errorMessage(e);
      this.phase = 'error';
    }
    this.changed();
  }

  /** Into the meeting, with the devices chosen in the lobby. */
  async join(opts: { mic: boolean; cam: boolean; micId?: string; camId?: string; speakerId?: string; passcode?: string }): Promise<void> {
    if (this.phase === 'joining' || this.phase === 'in' || this.phase === 'waiting') return;
    this.phase = 'joining';
    this.error = null;
    this.wants = { mic: opts.mic, cam: opts.cam };
    this.changed();
    let sfu: Sfu;
    try {
      sfu = await apiGet<Sfu>(`/api/meet/${this.uuid}/sfu`, opts.passcode ? { pass: opts.passcode } : undefined);
    } catch (e) {
      this.phase = 'lobby';
      this.error =
        e instanceof ApiError && e.status === 403 ? 'That passcode is not right.' : e instanceof ApiError && e.status === 423 ? 'The host has locked this meeting. No one new can join.' : errorMessage(e);
      this.changed();
      return;
    }
    const room = new Room({
      adaptiveStream: true,
      dynacast: true,
      audioCaptureDefaults: { ...CLEAN_AUDIO, deviceId: opts.micId },
      videoCaptureDefaults: { deviceId: opts.camId, resolution: VideoPresets.h720.resolution },
      audioOutput: opts.speakerId ? { deviceId: opts.speakerId } : undefined,
    });
    this.room = room;
    const refresh = () => this.changed();
    room
      .on(RoomEvent.ParticipantConnected, refresh)
      .on(RoomEvent.ParticipantDisconnected, refresh)
      .on(RoomEvent.ParticipantMetadataChanged, refresh)
      .on(RoomEvent.ActiveSpeakersChanged, refresh)
      .on(RoomEvent.TrackMuted, refresh)
      .on(RoomEvent.TrackUnmuted, refresh)
      .on(RoomEvent.LocalTrackPublished, refresh)
      .on(RoomEvent.LocalTrackUnpublished, refresh)
      .on(RoomEvent.RecordingStatusChanged, refresh)
      .on(RoomEvent.TrackSubscribed, (track) => {
        if (track.kind === Track.Kind.Audio) {
          const el = track.attach();
          document.body.appendChild(el);
          this.audio.add(el);
        }
        refresh();
      })
      .on(RoomEvent.TrackUnsubscribed, (track) => {
        for (const el of track.detach()) {
          this.audio.delete(el);
          el.remove();
        }
        refresh();
      })
      .on(RoomEvent.ParticipantPermissionsChanged, (_prev, p) => {
        // Admitted: the door opens and our devices go on.
        if (p === room.localParticipant && this.phase === 'waiting' && this.canPublish) void this.enter();
        refresh();
      })
      .on(RoomEvent.DataReceived, (payload, _p, _kind, topic) => {
        if (topic !== 'wb') return;
        try {
          const msg = JSON.parse(new TextDecoder().decode(payload)) as Board;
          if (msg.t === 'clear') this.strokes = [];
          else if (msg.t === 'stroke' && Array.isArray(msg.s?.points)) this.strokes = [...this.strokes, msg.s];
          refresh();
        } catch {
          /* not a board message */
        }
      })
      .on(RoomEvent.Disconnected, (reason) => {
        if (this.phase === 'left' || this.phase === 'ended') return;
        this.farewell =
          reason === DisconnectReason.ROOM_DELETED
            ? 'The host ended the meeting for everyone.'
            : reason === DisconnectReason.PARTICIPANT_REMOVED
              ? this.phase === 'waiting'
                ? 'The host did not let you in.'
                : 'The host removed you from the meeting.'
              : reason === DisconnectReason.DUPLICATE_IDENTITY
                ? 'You joined this meeting from another window or device.'
                : 'You were disconnected from the meeting.';
        this.teardown();
        this.phase = reason === DisconnectReason.ROOM_DELETED ? 'ended' : 'left';
        this.changed();
      });
    try {
      await room.connect(sfu.url, sfu.token);
    } catch (e) {
      this.teardown();
      this.phase = 'lobby';
      this.error = `Could not connect to the meeting: ${errorMessage(e)}`;
      this.changed();
      return;
    }
    void this.loadBoard();
    if (this.canPublish) await this.enter();
    else {
      this.phase = 'waiting';
      this.changed();
    }
  }

  private async enter(): Promise<void> {
    const lp = this.room?.localParticipant;
    if (!lp) return;
    this.joinedAt = this.joinedAt ?? Date.now();
    this.phase = 'in';
    this.changed();
    if (this.wants.mic) await lp.setMicrophoneEnabled(true).catch((e) => this.note(`The microphone could not start: ${errorMessage(e)}`));
    if (this.wants.cam) await lp.setCameraEnabled(true).catch((e) => this.note(`The camera could not start: ${errorMessage(e)}`));
    this.changed();
  }

  note(message: string | null): void {
    this.error = message;
    this.changed();
  }

  async toggleMic(): Promise<void> {
    const lp = this.room?.localParticipant;
    if (lp) await lp.setMicrophoneEnabled(!lp.isMicrophoneEnabled).catch((e) => this.note(errorMessage(e)));
    this.changed();
  }

  async toggleCamera(): Promise<void> {
    const lp = this.room?.localParticipant;
    if (!lp) return;
    if (!lp.isCameraEnabled && !(await call('media:access', { kind: 'camera' })).granted) {
      this.note('WorkSuite needs camera access in your system privacy settings.');
      return;
    }
    await lp.setCameraEnabled(!lp.isCameraEnabled).catch((e) => this.note(errorMessage(e)));
    this.changed();
  }

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
      this.note(errorMessage(e));
    }
    this.changed();
  }

  // ── host ────────────────────────────────────────────────────────────────
  private async host(path: string, body?: unknown, done?: () => void): Promise<void> {
    try {
      await apiPost(`/api/meet/${this.uuid}/${path}`, body);
      done?.();
    } catch (e) {
      this.note(errorMessage(e));
    }
    this.changed();
  }

  admit = (p: Participant) => this.host('admit', { identity: p.identity });
  remove = (p: Participant) => this.host('remove', { identity: p.identity });
  mute = (p: Participant) => this.host('mute', { identity: p.identity });
  lock = (locked: boolean) => this.host('lock', { locked }, () => (this.locked = locked));
  record = (on: boolean) => this.host(on ? 'record/start' : 'record/stop');

  async endForAll(): Promise<void> {
    this.farewell = 'You ended the meeting for everyone.';
    await this.host('end-all');
    this.teardown();
    this.phase = 'ended';
    this.changed();
  }

  async leave(): Promise<void> {
    this.farewell = 'You left the meeting.';
    this.teardown();
    this.phase = 'left';
    this.changed();
  }

  // ── whiteboard ──────────────────────────────────────────────────────────
  private async loadBoard(): Promise<void> {
    try {
      const b = await apiGet<{ strokes: Stroke[] | null }>(`/api/meet/${this.uuid}/whiteboard`);
      if (Array.isArray(b.strokes) && this.strokes.length === 0) {
        this.strokes = b.strokes;
        this.changed();
      }
    } catch {
      /* no board yet */
    }
  }

  draw(s: Stroke | null): void {
    const msg: Board = s ? { t: 'stroke', s } : { t: 'clear' };
    this.strokes = s ? [...this.strokes, s] : [];
    void this.room?.localParticipant.publishData(new TextEncoder().encode(JSON.stringify(msg)), { reliable: true, topic: 'wb' }).catch(() => undefined);
    this.changed();
    // The host keeps the board, so it is there after the meeting.
    if (this.isHost) {
      if (this.saveTimer) clearTimeout(this.saveTimer);
      this.saveTimer = setTimeout(() => void apiPut(`/api/meet/${this.uuid}/whiteboard`, { strokes: this.strokes.slice(-5000) }).catch(() => undefined), 2_000);
    }
  }

  private teardown(): void {
    for (const el of this.audio) el.remove();
    this.audio.clear();
    const room = this.room;
    this.room = null;
    if (room) void room.disconnect();
  }
}

export const meet = new MeetSession();

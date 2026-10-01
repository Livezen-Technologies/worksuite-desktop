import { DisconnectReason, Room, RoomEvent, Track, VideoPresets, type Participant, type RemoteParticipant } from 'livekit-client';
import { ApiError, apiDelete, apiGet, apiPost, apiPut } from '../../core/api';
import { toast } from '../../core/toasts';
import { call, errorMessage, on } from '../../core/bridge';
import { CLEAN_AUDIO, pauseOn, shareOn } from '../calls/session';
import type { SharePick } from '../calls/ScreenPicker';
import { DEFAULT_ROOM_SETTINGS, may, type MeetInfo, type MeetRole, type RoomSettings, type Sfu } from './api';
import type { RemoteControlView } from '@shared/types';
import { pointers } from './remote/pointers';

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

/** What the server says about a connection: its role, and whether it waits at the door (and why). */
export interface Meta {
  role?: MeetRole;
  host?: boolean;
  cohost?: boolean;
  waiting?: boolean;
  door?: 'waiting_room' | 'no_host' | null;
  uid?: number | null;
}

export function metaOf(p: Participant): Meta {
  try {
    return p.metadata ? (JSON.parse(p.metadata) as Meta) : {};
  } catch {
    return {};
  }
}

/** A connection's role; an older server only says host or co-host. */
export function roleOf(p: Participant): MeetRole {
  const m = metaOf(p);
  return m.role ?? (m.host ? 'host' : m.cohost ? 'cohost' : 'participant');
}

/** The WorkSuite user behind a connection (`u12-ab3f` → 12), or 0 for a guest. */
export function userIdOf(p: Participant): number {
  const m = /^u(\d+)-/.exec(p.identity);
  return m ? Number(m[1]) : 0;
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
  /** Who spoke last (not you), so the big picture stays on them in a pause. */
  lastSpeaker: string | null = null;
  /** What is being shared, in words. */
  shareLabel: string | null = null;
  /** Whether others can ask to control what this window shares, and if not, why (the main process decides). */
  control: { offered: boolean; why: string | null } | null = null;
  /** A share being started, switched or stopped here, so the track events it causes are not mistaken for the system stopping it. */
  private switching = false;
  private offSwitch: (() => void) | null = null;
  private offControl: (() => void) | null = null;
  /** Whose control messages to relay: the one controller the main process names. Anyone else's are dropped here. */
  private controllerIdentity: string | null = null;
  private version = 0;
  private listeners = new Set<() => void>();
  private audio = new Set<HTMLMediaElement>();
  private wants = { mic: true, cam: true };
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private offRoles: (() => void) | null = null;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  snapshot = (): number => this.version;

  changed(): void {
    this.version++;
    for (const fn of this.listeners) fn();
  }

  /**
   * My role now: what my connection carries (it changes during the meeting),
   * else what the meeting said when it loaded. Never decided here — the
   * server sets both.
   */
  get role(): MeetRole {
    const lp = this.room?.localParticipant;
    if (lp && metaOf(lp).role) return roleOf(lp);
    return this.info?.role ?? (this.info?.is_host ? 'host' : this.info?.is_cohost ? 'cohost' : 'participant');
  }

  get isHost(): boolean {
    return this.role === 'host';
  }

  /** Host or co-host: admits, removes, mutes, locks, names presenters and changes the room settings. */
  get canManage(): boolean {
    return may.manage(this.role);
  }

  get settings(): RoomSettings {
    return { ...DEFAULT_ROOM_SETTINGS, ...this.info?.room_settings };
  }

  get mayPresent(): boolean {
    return may.present(this.role, this.settings);
  }

  get mayRecord(): boolean {
    return may.record(this.role, this.settings);
  }

  get mayInvite(): boolean {
    return may.invite(this.role, this.settings);
  }

  /** Why we are waiting at the door, as the server put it. */
  get door(): 'waiting_room' | 'no_host' | null {
    const lp = this.room?.localParticipant;
    return lp ? (metaOf(lp).door ?? (metaOf(lp).waiting ? 'waiting_room' : null)) : null;
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
      const pub = this.info.locked !== undefined ? { locked: this.info.locked } : await apiGet<{ locked: boolean }>(`/api/meet/${uuid}/public`).catch(() => ({ locked: false }));
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
      .on(RoomEvent.ParticipantMetadataChanged, (_prev, p) => {
        // My role changed (made co-host or presenter, handed the host role, or it was taken back): the lists and settings follow.
        if (p === room.localParticipant) void this.reload();
        refresh();
      })
      .on(RoomEvent.ActiveSpeakersChanged, (speakers: Participant[]) => {
        this.lastSpeaker = speakers.find((p) => !p.isLocal)?.identity ?? this.lastSpeaker;
        refresh();
      })
      .on(RoomEvent.TrackMuted, refresh)
      .on(RoomEvent.TrackUnmuted, refresh)
      .on(RoomEvent.LocalTrackPublished, refresh)
      .on(RoomEvent.LocalTrackUnpublished, (pub) => {
        // Sharing stopped from outside (the system's own "Stop sharing"): the share, and any control of it, ends.
        if (pub.source === Track.Source.ScreenShare && !this.switching) void this.shareEnded();
        refresh();
      })
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
        // No longer allowed to present: the media server has already stopped the screen; say so.
        if (p === room.localParticipant && room.localParticipant.isScreenShareEnabled && !this.mayPresentNow()) {
          void this.share(null).then(() => this.note('Only presenters can share their screen now. Ask the host to make you a presenter.'));
        }
        refresh();
      })
      .on(RoomEvent.ParticipantConnected, (p) => {
        // Somebody waiting only because no host was in, and the room has no waiting room: let them in as I arrive.
        if (this.canManage && !this.settings.waiting_room && metaOf(p).door === 'no_host') void this.admit(p);
      })
      .on(RoomEvent.DataReceived, (payload, p, _kind, topic) => {
        // Remote control: relayed to the main process as it came. The key, and the decision, are there.
        if (topic === 'rc.ctl' || topic === 'rc.ctl.move') {
          // Only the controller's: another participant flooding the topic must not crowd them out.
          if (p && this.control && p.identity === this.controllerIdentity && payload.length <= 16_384) {
            void call('rc:packet', { sender: p.identity, topic, data: new TextDecoder().decode(payload) }).catch(() => undefined);
          }
          return;
        }
        // Viewers' pointers and annotations over a shared screen: painted, never injected.
        if (topic === 'rc.pointer') {
          if (p) pointers.receive(payload, { identity: p.identity, name: p.name });
          return;
        }
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
    this.offRoles?.();
    // Roles and settings changed by someone else reach everyone in the meeting at once (`meet.control`, what: roles).
    this.offRoles = on<{ type?: string; meeting?: string; what?: string }>('realtime:event', (e) => {
      if (e?.type === 'meet.control' && e.what === 'roles' && e.meeting === this.uuid) void this.reload();
    });
    if (this.canPublish) await this.enter();
    else {
      this.phase = 'waiting';
      this.changed();
    }
  }

  /** The meeting's roles and settings again, after somebody changed them. */
  async reload(): Promise<void> {
    if (!this.uuid) return;
    try {
      const info = await apiGet<MeetInfo>(`/api/meet/${this.uuid}`);
      this.info = { ...this.info, ...info };
      if (info.locked !== undefined) this.locked = info.locked;
      this.changed();
    } catch {
      /* the next change tries again */
    }
  }

  /** Whether my connection may publish a screen now — what the media server granted. */
  private mayPresentNow(): boolean {
    const sources = this.room?.localParticipant.permissions?.canPublishSources;
    return !sources?.length || sources.includes(3 /* TrackSource.SCREEN_SHARE */);
  }

  /** People in the meeting who are signed in, with their roles: for choosing a co-host, presenter or new host. */
  get people(): Array<{ id: number; name: string; role: MeetRole }> {
    const seen = new Map<number, { id: number; name: string; role: MeetRole }>();
    for (const p of this.present) {
      const id = userIdOf(p);
      if (id && !seen.has(id)) seen.set(id, { id, name: p.name || 'Someone', role: roleOf(p) });
    }
    return [...seen.values()];
  }

  private async enter(): Promise<void> {
    const lp = this.room?.localParticipant;
    if (!lp) return;
    this.joinedAt = this.joinedAt ?? Date.now();
    this.phase = 'in';
    // The main window shows "in a meeting" and brings this window back.
    void call('calls:active', { uuid: this.uuid, kind: 'meet', title: this.info?.title || 'Meeting' }).catch(() => undefined);
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

  /** Share what was picked, switch to something else, or stop (the meeting and cameras go on). */
  async share(pick: SharePick | null): Promise<void> {
    const lp = this.room?.localParticipant;
    if (!lp) return;
    const was = lp.isScreenShareEnabled;
    this.switching = true;
    try {
      await shareOn(lp, pick);
      this.shareLabel = pick ? pick.name : null;
    } catch (e) {
      this.note(errorMessage(e));
    } finally {
      this.switching = false;
    }
    await this.registerShare(was, pick);
    this.changed();
  }

  /**
   * The server hears of every share from the main process, which knows what
   * was really captured: started (as WorkSuite Desktop), switched, stopped.
   */
  private async registerShare(was: boolean, pick: SharePick | null): Promise<void> {
    const lp = this.room?.localParticipant;
    const now = !!lp?.isScreenShareEnabled;
    try {
      if (now && !was && lp) {
        const r = await call('rc:shareStarted', { uuid: this.uuid, identity: lp.identity, quality: pick?.quality, allowRequests: pick?.allowRequests });
        this.control = { offered: r.controlOffered, why: r.why };
        this.offSwitch?.();
        this.offSwitch = on<{ id: string; name: string }>('rc:switchScreen', (s) => void this.switchForController(s));
        this.offControl?.();
        this.offControl = on<RemoteControlView>('rc:changed', (v) => (this.controllerIdentity = v.session?.controllerIdentity ?? null));
        void call('rc:state').then((v) => (this.controllerIdentity = v.session?.controllerIdentity ?? null), () => undefined);
      } else if (now && was) await call('rc:shareChanged', { uuid: this.uuid });
      else if (!now && was) await this.shareEnded();
    } catch {
      // Sharing works without the record; it just cannot be controlled.
      if (now && !was) this.control = { offered: false, why: null };
    }
  }

  private async shareEnded(): Promise<void> {
    if (!this.control) return;
    this.control = null;
    this.offSwitch?.();
    this.offSwitch = null;
    this.offControl?.();
    this.offControl = null;
    this.controllerIdentity = null;
    await call('rc:shareStopped', { uuid: this.uuid }).catch(() => undefined);
    this.changed();
  }

  /** A controller allowed to switch screens asked for another one; the main process already chose it. */
  private async switchForController(s: { id: string; name: string }): Promise<void> {
    const lp = this.room?.localParticipant;
    if (!lp?.isScreenShareEnabled) return;
    this.switching = true;
    try {
      await lp.setScreenShareEnabled(false);
      await lp.setScreenShareEnabled(true, { audio: false });
      this.shareLabel = s.name;
      await call('rc:shareChanged', { uuid: this.uuid });
    } catch (e) {
      this.note(errorMessage(e));
    } finally {
      this.switching = false;
    }
    this.changed();
  }

  get sharePaused(): boolean {
    return !!this.room?.localParticipant.getTrackPublication(Track.Source.ScreenShare)?.isMuted;
  }

  async pauseShare(paused: boolean): Promise<void> {
    await pauseOn(this.room?.localParticipant, paused).catch((e) => this.note(errorMessage(e)));
    if (this.control) await call('rc:sharePaused', { uuid: this.uuid, paused }).catch(() => undefined);
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

  /** Roles (worksuite-desktop#82): the server checks who may; these only ask. */
  private async roles(run: () => Promise<unknown>, done: string): Promise<boolean> {
    try {
      await run();
      await this.reload();
      this.note(null);
      toast('success', done);
      return true;
    } catch (e) {
      this.note(errorMessage(e));
      return false;
    }
  }

  cohost = (userId: number, on: boolean) =>
    this.roles(() => (on ? apiPost(`/api/meet/${this.uuid}/cohosts`, { user_id: userId }) : apiDelete(`/api/meet/${this.uuid}/cohosts/${userId}`)), on ? 'Co-host added.' : 'Co-host removed.');

  presenter = (userId: number, on: boolean) =>
    this.roles(() => (on ? apiPost(`/api/meet/${this.uuid}/presenters`, { user_id: userId }) : apiDelete(`/api/meet/${this.uuid}/presenters/${userId}`)), on ? 'Presenter added.' : 'Presenter removed.');

  /** Hand the host role to somebody; I stay on as a co-host. */
  transferHost = (userId: number) => this.roles(() => apiPost(`/api/meet/${this.uuid}/host`, { user_id: userId }), 'Host changed. You are now a co-host.');

  /**
   * Leave, and the meeting goes on: the host role passes to the person
   * chosen, else to a co-host. With nobody to pass it to, the server names
   * the people who could take it, and nothing happens until one is chosen.
   */
  async leaveAsHost(userId?: number): Promise<{ left: true } | { left: false; candidates: Array<{ id: number; name: string }>; error?: string }> {
    try {
      await apiPost(`/api/meet/${this.uuid}/handover`, userId ? { user_id: userId } : {});
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        const d = (e.data ?? {}) as { candidates?: Array<{ id: number; name: string }> };
        return { left: false, candidates: d.candidates ?? [] };
      }
      return { left: false, candidates: [], error: errorMessage(e) };
    }
    await this.leave();
    return { left: true };
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
    this.offRoles?.();
    this.offRoles = null;
    void call('calls:active', { uuid: null, kind: 'meet' }).catch(() => undefined);
    pointers.reset();
    void this.shareEnded();
    this.shareLabel = null;
    for (const el of this.audio) el.remove();
    this.audio.clear();
    const room = this.room;
    this.room = null;
    if (room) void room.disconnect();
  }
}

export const meet = new MeetSession();

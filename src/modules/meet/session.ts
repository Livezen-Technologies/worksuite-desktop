import type { LivestreamStatus } from '@shared/livestream';
import { announceRecording } from './recording-notice';
import { DisconnectReason, Room, RoomEvent, Track, VideoPresets, type Participant, type RemoteParticipant } from 'livekit-client';
import { ApiError, apiDelete, apiGet, apiPost, apiPut } from '../../core/api';
import { toast } from '../../core/toasts';
import { call, errorMessage, on } from '../../core/bridge';
import { CLEAN_AUDIO, pauseOn, shareOn } from '../calls/session';
import type { SharePick } from '../calls/ScreenPicker';
import { DEFAULT_ROOM_SETTINGS, may, type MeetActivities, type MeetInfo, type MeetRole, type RaisedHand, type RoomSettings, type Sfu } from './api';
import { mt, type MKey } from './i18n';
import { playOnce } from '../calls/tones';
import type { RemoteControlView } from '@shared/types';
import { pointers } from './remote/pointers';
import { app } from '../../core/app-state';
import { LocalRecorder, RecordingError } from './recorder';
import { LiveTranscriber } from './transcribe/live';
import type { SpeechLanguage } from './transcribe/engine';
import type { AutoEmail, Transcript } from '../meetings/transcripts/api';

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
  /** Waiting until a host is in (`door: no_host`): where they go once one is — straight in (null), or the waiting room. */
  after?: 'waiting_room' | null;
  uid?: number | null;
}

/** The reactions anybody may send (worksuite-desktop#91): a short, fixed set, so nothing else is shown. */
export const REACTIONS = ['👍', '👏', '❤️', '😂', '😮', '🎉'] as const;

/** A reaction on screen for a moment. */
export interface Reaction {
  id: number;
  name: string;
  emoji: string;
}

/** The permissions a participant can lose or get back, as the host turns them off and on, with what they are told. */
const TOLD: Array<{ may: (r: MeetRole, s: RoomSettings) => boolean; off: MKey; on: MKey | null }> = [
  { may: (r, s) => may.microphone(r, s), off: 'hc.turnedOff.microphone', on: 'hc.turnedOn.microphone' },
  { may: (r, s) => may.camera(r, s), off: 'hc.turnedOff.camera', on: 'hc.turnedOn.camera' },
  { may: (r, s) => may.present(r, s), off: 'hc.turnedOff.present', on: null },
  { may: (r, s) => may.react(r, s), off: 'hc.turnedOff.reactions', on: null },
  { may: (r, s) => may.draw(r, s), off: 'hc.turnedOff.whiteboard', on: null },
  { may: (r, s) => may.chat(r, s), off: 'hc.turnedOff.chat', on: null },
  { may: (_r, s) => s.qa !== false, off: 'hc.turnedOff.qa', on: null },
  { may: (_r, s) => s.polls !== false, off: 'hc.turnedOff.polls', on: null },
  { may: (_r, s) => s.raise_hand !== false, off: 'hc.turnedOff.raiseHand', on: null },
];

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

/** Who a connection is in Q&A, polls and raised hands: `u12` for a person signed in, on any connection of theirs; a guest by their identity. */
export function handKey(p: Participant): string {
  const id = userIdOf(p);
  return id ? `u${id}` : p.identity;
}

/** A change to the meeting's Q&A, polls or hands, as the server tells the room (`meet.control`, and topic `meet.activity`). */
interface ActivityEvent {
  what?: string;
  action?: string;
  who?: string;
  name?: string;
  question?: string;
  by_host?: boolean;
  poll?: number;
}

/** `GET /api/meet/{uuid}/record/status` (worksuite-desktop#68). */
export interface RecordStatus {
  cloud: { id?: number; status: string; started_at: string | null; by: { id: number; name: string } | null } | null;
  local: Array<{ id: number; started_at: string | null; by: { id: number; name: string } }>;
  pending?: Array<{ id: number; phase: string; error?: string | null }>;
  may_record?: boolean;
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
  /** Bumped when the meeting's invitations change, so the list is read again. */
  ringsVersion = 0;
  /** Who is recording the meeting, as the server says (worksuite-desktop#68). */
  rec: RecordStatus | null = null;
  /** This computer's own recording of the meeting, while it records. */
  localRec: LocalRecorder | null = null;
  recordingCommand: 'idle' | 'starting' | 'stopping' | 'error' = 'idle';
  recordingError: string | null = null;
  /** What fixes the recording problem, when it is a permission (worksuite-desktop#240): shown as Open System Settings and Check again. */
  recordingFix: 'screen-permission' | null = null;
  recordingRetry: 'start' | 'stop' = 'start';
  recordingStopped = false;
  livestream: LivestreamStatus | null = null;
  private streamRequest = false;
  private recordedNotice = false;
  private recordRequest = false;
  private recRead: Promise<void> | null = null;
  private recTimer: ReturnType<typeof setInterval> | null = null;
  /** The meeting's live transcription, when one is on (worksuite-desktop#81): whoever started it, and in what language. */
  transcribing: { id: number | null; by: string | null; language: string | null } | null = null;
  /** This computer's own transcribing of the meeting, while it does. */
  liveTx: LiveTranscriber | null = null;
  /** The meeting record the notes and transcripts are kept on, once known. */
  recordId: number | null = null;
  /** Q&A, polls and raised hands (worksuite-desktop#92), as the server says; null until read, and from an older server. */
  activities: MeetActivities | null = null;
  private actReading = false;
  private actAgain = false;
  /** The last change told, so one that arrives by both routes is told once. */
  private lastNotice: { key: string; at: number } | null = null;
  /** Reactions on screen now (worksuite-desktop#91), newest last. */
  reactions: Reaction[] = [];
  private reactionId = 0;

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

  /** Participants' permissions (worksuite-desktop#91), as the host set them. The media server holds the same. */
  get mayMic(): boolean {
    return may.microphone(this.role, this.settings);
  }

  get mayCamera(): boolean {
    return may.camera(this.role, this.settings);
  }

  get mayReact(): boolean {
    return may.react(this.role, this.settings);
  }

  get mayDraw(): boolean {
    return may.draw(this.role, this.settings);
  }

  /** A recording already running can be stopped by whoever could record, even after recording was turned off. */
  get mayStopRecording(): boolean {
    return may.record(this.role, { ...this.settings, recording: true });
  }

  /** Why we are waiting at the door, as the server put it. */
  get door(): 'waiting_room' | 'no_host' | null {
    const lp = this.room?.localParticipant;
    return lp ? (metaOf(lp).door ?? (metaOf(lp).waiting ? 'waiting_room' : null)) : null;
  }

  get canPublish(): boolean {
    return this.room?.localParticipant.permissions?.canPublish ?? false;
  }

  /**
   * Past the door: what the media server lets us receive. Not whether we may
   * publish — a participant whose microphone, camera and screen are all off
   * (worksuite-desktop#91) publishes nothing and is still in the meeting.
   */
  get admitted(): boolean {
    const perm = this.room?.localParticipant.permissions;
    return perm ? (perm.canSubscribe ?? perm.canPublish ?? false) : false;
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
      // A 403 is the passcode, or the meeting's access mode turning us away (#91), in the server's words.
      this.error =
        e instanceof ApiError && e.status === 403 && /passcode/i.test(e.message)
          ? 'That passcode is not right.'
          : e instanceof ApiError && e.status === 423
            ? 'The host has locked this meeting. No one new can join.'
            : errorMessage(e);
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
      .on(RoomEvent.RecordingStatusChanged, () => {
        void this.refreshRecording();
        refresh();
      })
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
        if (p === room.localParticipant && this.phase === 'waiting' && this.admitted) void this.enter();
        // A microphone or camera the host turned off is stopped here too, not only on the media server (#91).
        if (p === room.localParticipant && this.phase === 'in') void this.applyPermissions();
        // No longer allowed to present: the media server has already stopped the screen; say so.
        if (p === room.localParticipant && room.localParticipant.isScreenShareEnabled && !this.mayPresentNow()) {
          void this.share(null).then(() => this.note('Only presenters can share their screen now. Ask the host to make you a presenter.'));
        }
        refresh();
      })
      // Back after a dropped connection: the settings, Q&A, polls and hands may have moved on meanwhile.
      .on(RoomEvent.Reconnected, () => { void this.refreshRecording(); void this.reload().then(() => this.refreshActivities()); })
      .on(RoomEvent.ParticipantConnected, (p) => {
        // Somebody waiting only because no host was in, whom the room would have let straight in: let them in as I arrive.
        const m = metaOf(p);
        if (this.canManage && m.door === 'no_host' && ('after' in m ? m.after === null : !this.settings.waiting_room)) void this.admit(p);
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
        // Q&A, polls and hands changed (#92): from the server only (no sender), never from another participant.
        if (topic === 'meet.activity') {
          if (!p) {
            try {
              const event = JSON.parse(new TextDecoder().decode(payload)) as ActivityEvent;
              if ((event as { what?: string }).what === 'livestream') void this.refreshLivestream();
              else this.onActivity(event);
            } catch {
              /* not an activity message */
            }
          }
          return;
        }
        // A reaction (#91): from somebody in the room, one of the set, while the host allows them.
        if (topic === 'meet.reaction') {
          if (p && may.react(roleOf(p), this.settings)) {
            try {
              const r = JSON.parse(new TextDecoder().decode(payload)) as { e?: string };
              if (r.e && (REACTIONS as readonly string[]).includes(r.e)) this.showReaction(p.name || 'Someone', r.e);
            } catch {
              /* not a reaction */
            }
          }
          return;
        }
        if (topic !== 'wb') return;
        // With participants' drawing off (#91), only the host's and co-hosts' strokes reach the board.
        if (p && !may.draw(roleOf(p), this.settings)) return;
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
      if (e?.type !== 'meet.control' || e.meeting !== this.uuid) return;
      // A settings change (#91) comes as both: what it changed for me is told when the settings are read again.
      if (e.what === 'roles' || e.what === 'settings') void this.reload().then(() => this.refreshActivities());
      // Q&A, polls and raised hands (#92): the server keeps them; read them again.
      if (e.what === 'qa' || e.what === 'polls' || e.what === 'hands') this.onActivity(e as ActivityEvent);
      // Somebody started or stopped transcribing (#81): everybody is told while it is on.
      if (e.what === 'transcript') {
        const ev = e as { on?: boolean; by?: string; language?: string };
        this.transcribing = ev.on ? { id: this.transcribing?.id ?? null, by: ev.by ?? null, language: ev.language ?? null } : null;
        if (ev.by && ev.by !== app.get().auth?.user?.name) toast('info', ev.on ? `${ev.by} started transcribing this meeting. What is said is being written down.` : `${ev.by} stopped transcribing this meeting.`);
        this.changed();
      }
      // Somebody started or stopped recording (#68): everybody is told, and the badge follows.
      if (e.what === 'livestream') void this.refreshLivestream();
      if (e.what === 'recording') {
        // Both realtime and the media server may deliver this; announce only the confirmed status transition.
        void this.refreshRecording();
      }
      // Somebody was rung in, answered or was cancelled (#79): the invitations are read again.
      if (e.what === 'rings') {
        this.ringsVersion++;
        this.changed();
      }
    });
    if (this.admitted) await this.enter();
    else {
      this.phase = 'waiting';
      this.changed();
    }
  }

  /** The meeting's roles and settings again, after somebody changed them. */
  async reload(): Promise<void> {
    if (!this.uuid) return;
    try {
      const before = { role: this.role, settings: this.settings };
      const info = await apiGet<MeetInfo>(`/api/meet/${this.uuid}`);
      this.info = { ...this.info, ...info };
      if (info.locked !== undefined) this.locked = info.locked;
      if (this.phase === 'in') {
        this.tellChanges(before.role, before.settings);
        await this.applyPermissions();
      }
      this.changed();
    } catch {
      /* the next change tries again */
    }
  }

  /**
   * What the host turned off or back on for me (worksuite-desktop#91), in a
   * toast. Only what I lost or got back: a change that leaves me as I was —
   * the hosts are never limited — says nothing.
   */
  private tellChanges(roleBefore: MeetRole, before: RoomSettings): void {
    const role = this.role;
    const now = this.settings;
    for (const c of TOLD) {
      const had = c.may(roleBefore, before);
      const has = c.may(role, now);
      if (had && !has) toast('info', mt(c.off));
      else if (!had && has && c.on && roleBefore === role) toast('info', mt(c.on));
    }
  }

  /**
   * Stop here what I may no longer use: the media server has already stopped
   * the tracks, and this turns the devices off so the buttons say so. A
   * permission given back turns nothing on — that stays mine to do.
   */
  async applyPermissions(): Promise<void> {
    const lp = this.room?.localParticipant;
    if (!lp) return;
    if (!this.mayMic && lp.isMicrophoneEnabled) await lp.setMicrophoneEnabled(false).catch(() => undefined);
    if (!this.mayCamera && lp.isCameraEnabled) await lp.setCameraEnabled(false).catch(() => undefined);
    this.changed();
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
    void this.refreshRecording();
    void this.refreshLivestream();
    void this.refreshTranscribing();
    void this.refreshActivities();
    if (!this.recTimer) this.recTimer = setInterval(() => { void this.refreshRecording(); void this.refreshLivestream(); }, 3_000);
    // The main window shows "in a meeting" and brings this window back.
    void call('calls:active', { uuid: this.uuid, kind: 'meet', title: this.info?.title || 'Meeting' }).catch(() => undefined);
    this.changed();
    // What the host turned off for participants (#91) does not start, whatever the lobby said.
    if (this.wants.mic && this.mayMic) await lp.setMicrophoneEnabled(true).catch((e) => this.note(`The microphone could not start: ${errorMessage(e)}`));
    if (this.wants.cam && this.mayCamera) await lp.setCameraEnabled(true).catch((e) => this.note(`The camera could not start: ${errorMessage(e)}`));
    this.changed();
  }

  note(message: string | null): void {
    this.error = message;
    this.changed();
  }

  async toggleMic(): Promise<void> {
    const lp = this.room?.localParticipant;
    if (lp && !lp.isMicrophoneEnabled && !this.mayMic) return this.note(mt('hc.off.microphone'));
    if (lp) await lp.setMicrophoneEnabled(!lp.isMicrophoneEnabled).catch((e) => this.note(errorMessage(e)));
    this.changed();
  }

  async toggleCamera(): Promise<void> {
    const lp = this.room?.localParticipant;
    if (!lp) return;
    if (!lp.isCameraEnabled && !this.mayCamera) return this.note(mt('hc.off.camera'));
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
  // ── recording (worksuite-desktop#68) ─────────────────────────────────────

  /** What the server knows of the meeting's recordings now. */
  async refreshLivestream(): Promise<void> {
    if (this.streamRequest || !this.uuid || !this.room) return;
    this.streamRequest = true;
    const uuid = this.uuid;
    try {
      const status = await apiGet<LivestreamStatus>(`/api/meet/${uuid}/livestream`);
      if (this.uuid === uuid && this.room) { this.livestream = status; this.changed(); }
    } catch { /* Keep the last confirmed state during network loss; older servers may not support livestreams. */ }
    finally { this.streamRequest = false; }
  }

  refreshRecording(): Promise<void> {
    if (this.recRead) return this.recRead;
    this.recRead = this.readRecording().finally(() => { this.recRead = null; });
    return this.recRead;
  }

  private async readRecording(): Promise<void> {
    if (!this.uuid) return;
    const uuid = this.uuid;
    try {
      const next = await apiGet<RecordStatus>(`/api/meet/${uuid}/record/status`);
      if (uuid !== this.uuid) return;
      this.rec = next;
    } catch {
      // Keep the last confirmed state during a transient failure; an older server initially uses the room flag.
    }
    const active = !!this.recording;
    if (this.recordingCommand === 'error' && (this.recordingRetry === 'start' ? active : !active)) { this.recordingCommand = 'idle'; this.recordingError = null; this.recordingFix = null; }
    if (active !== this.recordedNotice) {
      this.recordedNotice = active; this.recordingStopped = !active;
      announceRecording(active);
      toast('info', active ? 'This meeting is being recorded.' : 'Recording has stopped. Processing and upload continue separately.');
    }
    this.changed();
  }

  /** Recording, here or on the server, and since when — for the badge and its clock. */
  get recording(): { since: number | null; mine: boolean; local: boolean; who: string[] } | null {
    if (this.localRec?.id && this.localRec.startedAt > 0) return { since: this.localRec.startedAt, mine: true, local: true, who: [] };
    const cloud = this.rec?.cloud;
    const locals = this.rec?.local ?? [];
    if (cloud || locals.length || (!this.rec && this.livestream?.available === false && this.room?.isRecording)) {
      const at = cloud?.started_at ?? locals[0]?.started_at;
      const since = at ? Date.parse(`${at.replace(' ', 'T')}${/Z|[+-]\d\d:?\d\d$/.test(at) ? '' : 'Z'}`) : null;
      return { since, mine: false, local: !cloud && locals.length > 0, who: [...(cloud?.by ? [cloud.by.name] : []), ...locals.map((l) => l.by.name)] };
    }
    return null;
  }

  private async waitForCapture(active: boolean): Promise<void> {
    for (let tries = 0; tries < 30; tries++) {
      await this.refreshRecording();
      if (!!this.recording === active) return;
      const failed = this.rec?.pending?.find((row) => row.phase === 'failed');
      if (failed) throw new Error(failed.error || 'The recording service failed. Check the service and retry.');
      await new Promise<void>((resolve) => setTimeout(resolve, 1_000));
    }
    throw new Error(active ? 'Startup timed out. Check the recording service, stop any pending request, and retry.' : 'Stopping timed out. Check your connection and retry stopping; capture may still be active.');
  }

  private async recordingOperation(kind: 'start' | 'stop', run: () => Promise<void>): Promise<void> {
    if (this.recordRequest) return;
    this.recordRequest = true; this.recordingRetry = kind;
    this.recordingCommand = kind === 'start' ? 'starting' : 'stopping';
    this.recordingError = null; this.recordingFix = null; this.recordingStopped = false; this.changed();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([run(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Recording request timed out. Check your connection and recording service, then retry.')), 45_000); })]);
      this.recordingCommand = 'idle';
    } catch (e) {
      if (kind === 'start' && this.localRec) { void this.localRec.abort(); this.localRec = null; }
      this.recordingCommand = 'error'; this.recordingError = errorMessage(e);
      this.recordingFix = e instanceof RecordingError ? e.fix : null;
      // A missing permission has its own explanation, with Open System Settings and Check again (#240).
      if (!this.recordingFix) this.note(`The recording did not ${kind}: ${this.recordingError}`);
    } finally {
      clearTimeout(timer); this.recordRequest = false; this.changed();
    }
    await this.refreshRecording();
  }

  async startRecording(): Promise<void> {
    if (this.recording || this.recordRequest) return;
    const prefs = app.get().prefs?.meetRecording ?? { method: 'cloud', quality: '720p', layout: 'grid', folder: 'Meeting Recordings' };
    await this.recordingOperation('start', async () => {
      if (prefs.method === 'local' && this.room) {
        const rec: LocalRecorder = new LocalRecorder(this.room, {
          layout: prefs.layout,
          quality: prefs.quality,
          speaker: () => this.lastSpeaker,
          onError: (m, info) => {
            if (!info?.stopped) return this.note(m);
            // Not capturing video (#240): it was stopped; say so where the recording controls are, with the fix.
            if (this.localRec === rec) this.localRec = null;
            this.recordingCommand = 'error'; this.recordingRetry = 'start';
            this.recordingError = m; this.recordingFix = info.fix ?? null;
            this.changed();
            void this.refreshRecording();
          },
        });
        this.localRec = rec;
        await rec.start(this.uuid, this.info?.title || 'Meeting');
      } else {
        await apiPost(`/api/meet/${this.uuid}/record/start`, { layout: prefs.layout, quality: prefs.quality, folder: prefs.folder });
        await this.waitForCapture(true);
      }
    });
  }

  async stopRecording(): Promise<void> {
    await this.recordingOperation('stop', async () => {
      const local = this.localRec;
      if (local) {
        await local.stop();
        this.localRec = null;
      } else {
        await apiPost(`/api/meet/${this.uuid}/record/stop`);
        await this.waitForCapture(false);
      }
      toast('success', 'Capture has stopped. Processing and upload continue in the background.');
    });
  }

  record = (on: boolean) => (on ? this.startRecording() : this.stopRecording());

  // ── transcription (worksuite-desktop#81) ─────────────────────────────────

  /** The meeting record the transcript goes on: made the first time its host or a co-host needs it. */
  async meetingRecord(): Promise<number> {
    if (this.recordId) return this.recordId;
    const r = await apiPost<{ id: number }>('/api/meetings/for-meet', { uuid: this.uuid });
    this.recordId = r.id;
    return r.id;
  }

  /** Whether a live transcription is on (somebody joining late is told too). */
  async refreshTranscribing(): Promise<void> {
    try {
      const id = await this.meetingRecord();
      const r = await apiGet<{ transcripts: Transcript[] }>(`/api/meetings/${id}/transcripts`);
      const live = r.transcripts.find((t) => t.source === 'live' && t.status === 'active');
      this.transcribing = live ? { id: live.id, by: null, language: live.language } : this.liveTx ? this.transcribing : null;
      this.changed();
    } catch {
      // No record yet, or not allowed to see transcripts: nothing to show.
    }
  }

  /** The hosts or whoever may record, while the room allows transcription (#91). */
  get mayTranscribe(): boolean {
    return may.transcribe(this.role, this.settings);
  }

  async startTranscription(language: SpeechLanguage, autoEmail: AutoEmail | null): Promise<void> {
    if (!this.room || this.liveTx) return;
    try {
      const id = await this.meetingRecord();
      const t = await apiPost<Transcript>(`/api/meetings/${id}/transcripts`, { source: 'live', language, auto_email: autoEmail ?? undefined });
      const tx = new LiveTranscriber(this.room, t.id, language, () => this.changed());
      this.liveTx = tx;
      this.transcribing = { id: t.id, by: app.get().auth?.user?.name ?? null, language };
      tx.start();
      toast('success', 'Transcribing. Everybody in the meeting is told.');
    } catch (e) {
      this.note(`Transcription did not start: ${errorMessage(e)}`);
    }
    this.changed();
  }

  async stopTranscription(): Promise<void> {
    const tx = this.liveTx;
    const id = this.transcribing?.id;
    this.liveTx = null;
    this.changed();
    if (tx) await tx.stop();
    if (id) {
      try {
        await apiPost(`/api/meetings/transcripts/${id}/finish`, { status: 'ready' });
        toast('success', 'Transcription stopped. The transcript is in the meeting\'s details, to review.');
      } catch (e) {
        this.note(`The transcript could not be finished: ${errorMessage(e)}`);
      }
    }
    this.transcribing = null;
    this.changed();
  }

  // ── Q&A, polls and raised hands (worksuite-desktop#92) ─────────────────────

  /** The whole state again: on entering, after reconnecting, and whenever the room is told something changed. */
  async refreshActivities(): Promise<void> {
    if (!this.uuid) return;
    if (this.actReading) {
      this.actAgain = true;
      return;
    }
    this.actReading = true;
    try {
      this.activities = await apiGet<MeetActivities>(`/api/meet/${this.uuid}/activities`);
    } catch {
      // An older server, or not let in yet: nothing to show.
    } finally {
      this.actReading = false;
    }
    this.changed();
    if (this.actAgain) {
      this.actAgain = false;
      await this.refreshActivities();
    }
  }

  /** One change. The server checks who may, and answers with the state after it. */
  private async activity(run: () => Promise<MeetActivities>): Promise<boolean> {
    try {
      this.activities = await run();
      this.changed();
      return true;
    } catch (e) {
      toast('error', errorMessage(e));
      void this.refreshActivities();
      return false;
    }
  }

  private actPost(path: string, body?: unknown): Promise<boolean> {
    return this.activity(() => apiPost<MeetActivities>(`/api/meet/${this.uuid}/${path}`, body));
  }

  ask = (text: string, anonymous: boolean) => this.actPost('qa', { text, anonymous });
  /** Upvote a question, or take the upvote back. */
  upvote = (id: number) => this.actPost(`qa/${id}/vote`);
  answer = (id: number, answered: boolean, answer?: string) => this.actPost(`qa/${id}/answer`, answer === undefined ? { answered } : { answered, answer });
  hideQuestion = (id: number, hidden: boolean) => this.actPost(`qa/${id}/hide`, { hidden });
  createPoll = (poll: { question: string; kind: 'single' | 'multiple'; options: string[]; anonymous: boolean }) => this.actPost('polls', poll);
  launchPoll = (id: number) => this.actPost(`polls/${id}/launch`);
  closePoll = (id: number) => this.actPost(`polls/${id}/close`);
  sharePoll = (id: number, shared: boolean) => this.actPost(`polls/${id}/share`, { shared });
  deletePoll = (id: number) => this.activity(() => apiDelete<MeetActivities>(`/api/meet/${this.uuid}/polls/${id}`));
  votePoll = (id: number, choices: number[]) => this.actPost(`polls/${id}/vote`, { choices });
  /** Raise or lower my hand. Only the hand: the microphone stays as it is. */
  raiseHand = (up: boolean) => this.actPost(up ? 'hands/raise' : 'hands/lower');
  /** A host or co-host lowering somebody's hand. */
  lowerHandOf = (who: string) => this.actPost('hands/lower', { who });
  lowerAllHands = () => this.actPost('hands/lower-all');

  get myHand(): boolean {
    return !!this.activities?.hands.some((h) => h.mine);
  }

  /** Their raised hand and its place in the queue (1 is first), or null. */
  handOf(p: Participant): (RaisedHand & { position: number }) | null {
    const key = handKey(p);
    const hands = this.activities?.hands ?? [];
    const at = hands.findIndex((h) => h.who === key);
    return at < 0 ? null : { ...hands[at]!, position: at + 1 };
  }

  /** Something changed in the meeting's Q&A, polls or hands: told to whoever it concerns, then read again. */
  onActivity(e: ActivityEvent): void {
    const key = `${e.what}:${e.action}:${e.who ?? ''}:${e.poll ?? ''}`;
    const now = Date.now();
    const repeat = this.lastNotice?.key === key && now - this.lastNotice.at < 3_000;
    this.lastNotice = { key, at: now };
    const mine = this.room ? handKey(this.room.localParticipant) : (this.activities?.me.who ?? '');
    if (!repeat && e.what === 'hands') {
      // The hosts are told a hand went up, with a sound: the queue is in the People panel.
      if (e.action === 'raised' && this.canManage && e.who !== mine) {
        toast('info', mt('act.handRaisedBy', { name: e.name || 'Someone' }));
        playOnce('hand', 0.8);
      }
      if ((e.action === 'lowered' && e.by_host && e.who === mine) || (e.action === 'lowered_all' && this.myHand && !this.canManage)) toast('info', mt('act.handLoweredByHost'));
    }
    if (!repeat && e.what === 'polls' && e.action === 'launched' && !this.canManage && e.question) toast('info', mt('act.pollLaunched', { question: e.question }));
    void this.refreshActivities();
  }

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
    // Drawing turned off for participants (#91): nothing is drawn, and the others' screens would drop it anyway.
    if (!this.mayDraw) return;
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

  // ── reactions (worksuite-desktop#91) ─────────────────────────────────────

  /** Send a reaction to everybody in the meeting, and show it here. */
  react(emoji: string): void {
    const lp = this.room?.localParticipant;
    if (!lp || !this.mayReact || !(REACTIONS as readonly string[]).includes(emoji)) return;
    void lp.publishData(new TextEncoder().encode(JSON.stringify({ e: emoji })), { reliable: true, topic: 'meet.reaction' }).catch(() => undefined);
    this.showReaction(mt('hc.you'), emoji);
  }

  /** On screen for a few seconds; the last few only. */
  private showReaction(name: string, emoji: string): void {
    const id = ++this.reactionId;
    this.reactions = [...this.reactions.slice(-5), { id, name, emoji }];
    this.changed();
    setTimeout(() => {
      this.reactions = this.reactions.filter((r) => r.id !== id);
      this.changed();
    }, 4_000);
  }

  private teardown(): void {
    this.offRoles?.();
    this.offRoles = null;
    this.activities = null;
    this.reactions = [];
    // Leaving while transcribing here: what was said so far is finished and kept.
    if (this.liveTx) void this.stopTranscription();
    // Leaving while recording here: the recording stops, and is finished and uploaded in the background.
    const local = this.localRec;
    this.localRec = null;
    if (local) void local.stop();
    if (this.recTimer) clearInterval(this.recTimer);
    this.recTimer = null;
    this.livestream = null;
    this.rec = null; this.recordedNotice = false; this.recordingCommand = 'idle'; this.recordingError = null; this.recordingFix = null; this.recordingStopped = false;
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

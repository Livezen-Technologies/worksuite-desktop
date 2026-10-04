import { ConnectionQuality, Room, RoomEvent, Track, type Participant, type RemoteTrack } from 'livekit-client';
import { useSyncExternalStore } from 'react';
import { apiPost } from '../../../core/api';
import { call, errorMessage } from '../../../core/bridge';
import { deviceProblem, saveSpeaker, savedSpeaker, sinkTo } from '../../calls/session';
import { readPrefs, savePrefs } from '../../meet/devices';
import { WEBSITE } from './api';

/**
 * A visitor's voice call on this computer (WS-WCHAT ENH-WCHAT-05, VOICE-12, VOICE-13): audio only, the microphone and
 * nothing else, in the website call's own LiveKit room. One at a time. The server says who is on the call and when it
 * ends; this holds the room, the microphone and the speaker, and tells the main process for the tray and the updater.
 */

export interface WebsiteCallState {
  callId: number;
  conversationId: number;
  visitor: string;
  phase: 'joining' | 'connected' | 'reconnecting' | 'ended' | 'failed';
  muted: boolean;
  held: boolean;
  /** How the connection is, once LiveKit says. */
  quality: 'good' | 'fair' | 'poor' | null;
  /** The visitor is speaking now. */
  speaking: boolean;
  /** What went wrong, in words a person can act on. */
  problem: string | null;
  /** Epoch ms the audio connected. */
  since: number | null;
  /**
   * The call notes panel (V-03, VOICE-UI-02): what I have written so far, kept on the server as I write and saved as
   * an internal note when the call ends. Null until the thread has said what the server already has.
   */
  notes: string | null;
  /** The last save of the notes did not reach the server: they stay here and go with End. */
  notesUnsaved: boolean;
}

/** The microphones and speakers this computer has, for the in-call bar's device menu (VOICE-14). */
export interface CallDevices {
  mics: Array<{ id: string; label: string }>;
  speakers: Array<{ id: string; label: string }>;
  mic: string;
  speaker: string;
}

/** While I type, the notes are saved this long after the last key (and at once on leaving the box). */
const NOTES_SAVE_MS = 700;

interface JoinAnswer {
  url: string;
  token: string;
}

const QUALITY: Partial<Record<ConnectionQuality, WebsiteCallState['quality']>> = {
  [ConnectionQuality.Excellent]: 'good',
  [ConnectionQuality.Good]: 'fair',
  [ConnectionQuality.Poor]: 'poor',
  [ConnectionQuality.Lost]: 'poor',
};

export class WebsiteCallSession {
  private room: Room | null = null;
  private audio = new Set<HTMLMediaElement>();
  private listeners = new Set<() => void>();
  private current: WebsiteCallState | null = null;
  /** Calls this computer has joined by itself once, so a thread opened on one does not join it twice. */
  private joined = new Set<number>();
  private notesTimer: ReturnType<typeof setTimeout> | null = null;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  snapshot = (): WebsiteCallState | null => this.current;

  /** On this call now, or getting there. */
  on(callId: number): boolean {
    const s = this.current;
    return !!s && s.callId === callId && (s.phase === 'joining' || s.phase === 'connected' || s.phase === 'reconnecting');
  }

  /** Whether this computer already joined this call by itself once (answering it brings the thread up with it). */
  triedOnce(callId: number): boolean {
    return this.joined.has(callId);
  }

  /**
   * Into the call's room (VOICE-12): a token for this person, microphone only, from the server — which says no unless
   * I answered the call or am in its chat.
   */
  async join(callId: number, conversationId: number, visitor: string): Promise<boolean> {
    if (this.on(callId)) return true;
    if (this.current && this.current.callId !== callId) this.letGo();
    this.joined.add(callId);
    this.set({ callId, conversationId, visitor, phase: 'joining', muted: false, held: false, quality: null, speaking: false, problem: null, since: null, notes: null, notesUnsaved: false });
    let answer: JoinAnswer;
    try {
      answer = await apiPost<JoinAnswer>(`${WEBSITE}/calls/${callId}/join`, {});
    } catch (e) {
      this.patch({ phase: 'failed', problem: errorMessage(e) });
      return false;
    }
    if (this.current?.callId !== callId) return false;
    const room = new Room({ adaptiveStream: false, dynacast: false });
    this.room = room;
    const speaker = savedSpeaker();
    room
      .on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
        if (track.kind !== Track.Kind.Audio) return;
        const el = track.attach();
        if (speaker) void sinkTo(el, speaker);
        el.dataset.websiteCall = String(callId);
        document.body.appendChild(el);
        this.audio.add(el);
      })
      .on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
        for (const el of track.detach()) {
          this.audio.delete(el);
          el.remove();
        }
      })
      .on(RoomEvent.ActiveSpeakersChanged, (speakers: Participant[]) => this.patch({ speaking: speakers.some((p) => !p.isLocal) }))
      .on(RoomEvent.ConnectionQualityChanged, (q: ConnectionQuality, p: Participant) => {
        if (p.isLocal) this.patch({ quality: QUALITY[q] ?? null });
      })
      .on(RoomEvent.Reconnecting, () => this.patch({ phase: 'reconnecting' }))
      .on(RoomEvent.Reconnected, () => this.patch({ phase: 'connected' }))
      .on(RoomEvent.Disconnected, () => {
        // Our own leaving lets the room go first: only LiveKit giving up lands here.
        if (room !== this.room) return;
        this.room = null;
        this.patch({ phase: 'ended', problem: 'The call\'s connection was lost.' });
        this.report();
      });
    try {
      await room.connect(answer.url, answer.token);
      // Through the microphone chosen on this computer (VOICE-14: "audio through the chosen headset"), else the system's.
      const mic = readPrefs().micId;
      if (mic) await room.localParticipant.setMicrophoneEnabled(true, { deviceId: mic });
      else await room.localParticipant.setMicrophoneEnabled(true);
    } catch (e) {
      if (this.room === room) this.room = null;
      void room.disconnect();
      const problem = e instanceof Error && /NotAllowed|NotFound|Security|Overconstrained/.test(e.name) ? deviceProblem(e).message : `Could not connect the call: ${errorMessage(e)}`;
      this.patch({ phase: 'failed', problem });
      return false;
    }
    this.patch({ phase: 'connected', since: Date.now() });
    this.mediaKeys(true);
    this.report();
    return true;
  }

  async mute(on = !this.current?.muted): Promise<void> {
    const s = this.current;
    if (!s) return;
    this.patch({ muted: on });
    this.micState();
    // Held, the microphone stays off whatever Mute says; it comes back on Resume.
    if (!s.held) await this.room?.localParticipant.setMicrophoneEnabled(!on).catch(() => undefined);
  }

  /**
   * What the thread says the server has kept of my call notes (V-03): taken once, so a thread opened again (or in
   * another window) after a restart picks up where I was, and never over what I am typing.
   */
  seedNotes(callId: number, notes: string): void {
    if (this.current?.callId === callId && this.current.notes === null) this.patch({ notes });
  }

  /** The call notes panel changed (V-03): kept here at once, on the server shortly after the last key. */
  setNotes(notes: string): void {
    if (!this.current) return;
    this.patch({ notes });
    if (this.notesTimer) clearTimeout(this.notesTimer);
    this.notesTimer = setTimeout(() => void this.saveNotes(), NOTES_SAVE_MS);
  }

  /** Save the notes now (the box lost focus); nothing to do when they are saved already. */
  async saveNotes(): Promise<void> {
    const s = this.current;
    if (!this.notesTimer || !s || s.notes === null) return;
    clearTimeout(this.notesTimer);
    this.notesTimer = null;
    try {
      await apiPost(`${WEBSITE}/calls/${s.callId}/draft`, { notes: s.notes });
      if (this.current?.callId === s.callId) this.patch({ notesUnsaved: false });
    } catch {
      // Kept here, and sent with End; the panel says so.
      if (this.current?.callId === s.callId) this.patch({ notesUnsaved: true });
    }
  }

  /** The microphones and speakers this computer has, named, and the ones the call uses (VOICE-14). */
  async devices(): Promise<CallDevices> {
    const [mics, outs] = await Promise.all([Room.getLocalDevices('audioinput').catch(() => []), Room.getLocalDevices('audiooutput').catch(() => [])]);
    const named = (list: MediaDeviceInfo[], what: string) =>
      list.filter((d) => d.deviceId && d.deviceId !== 'default').map((d, i) => ({ id: d.deviceId, label: d.label || `${what} ${i + 1}` }));
    return { mics: named(mics, 'Microphone'), speakers: named(outs, 'Speaker'), mic: readPrefs().micId, speaker: savedSpeaker() };
  }

  /**
   * Talk through another microphone, or listen through another speaker, now and on the next call ('' for the
   * system's). Every kind of call on this computer remembers the same choice.
   */
  async useDevice(kind: 'mic' | 'speaker', id: string): Promise<void> {
    if (kind === 'mic') {
      savePrefs({ ...readPrefs(), micId: id });
      await this.room?.switchActiveDevice('audioinput', id || 'default').catch(() => undefined);
    } else {
      saveSpeaker(id);
      await Promise.all([...this.audio].map((el) => sinkTo(el, id)));
    }
    this.patch({});
  }

  /** Hold or resume (VOICE-13): the visitor hears the hold tone, and nothing from here. */
  async hold(on: boolean): Promise<void> {
    const s = this.current;
    if (!s) return;
    await apiPost(`${WEBSITE}/calls/${s.callId}/hold`, { on });
    this.patch({ held: on });
    this.micState();
    await this.room?.localParticipant.setMicrophoneEnabled(!on && !s.muted).catch(() => undefined);
    for (const el of this.audio) el.muted = on;
    this.report();
  }

  /**
   * Leave the call, or end it for everybody (VOICE-13). Notes are kept on the chat as a note only staff see. Leaving
   * as the last of the team ends it too; the server decides.
   */
  async end(callId: number, forEveryone: boolean, notes?: string): Promise<void> {
    // The notes go with End, so a save still waiting is not needed. Without them, the server saves what it kept (V-03).
    if (this.current?.callId === callId && this.notesTimer) {
      clearTimeout(this.notesTimer);
      this.notesTimer = null;
    }
    await apiPost(`${WEBSITE}/calls/${callId}/end`, notes === undefined ? { for_everyone: forEveryone } : { for_everyone: forEveryone, notes: notes.trim() });
    if (this.current?.callId === callId) this.over(callId);
  }

  /** The server says this call is over, or I am off it: let the room go. */
  over(callId: number): void {
    if (this.current?.callId !== callId) return;
    this.letGo();
    this.patch({ phase: 'ended' });
    this.report();
  }

  /** Forget a call that ended, so its thread stops showing it. */
  clear(callId: number): void {
    if (this.current?.callId !== callId || this.on(callId)) return;
    this.set(null);
  }

  private letGo(): void {
    const room = this.room;
    this.room = null;
    if (room) void room.disconnect();
    for (const el of this.audio) el.remove();
    this.audio.clear();
    // The server saves the notes it has when the call ends (V-03); a save still waiting has nowhere to go.
    if (this.notesTimer) clearTimeout(this.notesTimer);
    this.notesTimer = null;
    this.mediaKeys(false);
  }

  /**
   * The keyboard's and headset's microphone key toggles Mute while the call is on (VOICE-14: "OS media mute key
   * toggles mute"): Chromium hands it to the page as the media session's `togglemicrophone`. Not every system has it.
   */
  private mediaKeys(on: boolean): void {
    const ms = typeof navigator !== 'undefined' ? navigator.mediaSession : undefined;
    if (!ms?.setActionHandler) return;
    try {
      ms.setActionHandler('togglemicrophone' as MediaSessionAction, on ? () => void this.mute() : null);
    } catch {
      // This Chromium does not know the action: Ctrl/Cmd+Shift+M still does it.
    }
    this.micState();
  }

  /** The system's microphone indicator follows Mute. */
  private micState(): void {
    const ms = (typeof navigator !== 'undefined' ? navigator.mediaSession : undefined) as (MediaSession & { setMicrophoneActive?: (on: boolean) => Promise<void> }) | undefined;
    const s = this.current;
    void ms?.setMicrophoneActive?.(!!s && this.on(s.callId) && !s.muted && !s.held)?.catch?.(() => undefined);
  }

  /** The tray's "On a call", and the updater's wait (it never restarts the app in a call). */
  private report(): void {
    const s = this.current;
    const live = !!s && (s.phase === 'connected' || s.phase === 'reconnecting');
    void call('ring:onCall', live ? { conversationId: s.conversationId, visitor: s.visitor.slice(0, 120), since: s.since ?? Date.now(), held: s.held } : null).catch(() => undefined);
    void call('updates:setActiveCall', { active: live }).catch(() => undefined);
  }

  private set(s: WebsiteCallState | null): void {
    this.current = s;
    for (const fn of this.listeners) fn();
  }

  private patch(p: Partial<WebsiteCallState>): void {
    if (this.current) this.set({ ...this.current, ...p });
  }
}

export const websiteCall = new WebsiteCallSession();

/** The website call this computer is on, if any. */
export function useWebsiteCall(): WebsiteCallState | null {
  return useSyncExternalStore(websiteCall.subscribe, websiteCall.snapshot);
}

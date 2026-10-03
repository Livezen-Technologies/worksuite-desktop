import { ConnectionQuality, Room, RoomEvent, Track, type Participant, type RemoteTrack } from 'livekit-client';
import { useSyncExternalStore } from 'react';
import { apiPost } from '../../../core/api';
import { call, errorMessage } from '../../../core/bridge';
import { deviceProblem, savedSpeaker, sinkTo } from '../../calls/session';
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
}

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
    this.set({ callId, conversationId, visitor, phase: 'joining', muted: false, held: false, quality: null, speaking: false, problem: null, since: null });
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
      await room.localParticipant.setMicrophoneEnabled(true);
    } catch (e) {
      if (this.room === room) this.room = null;
      void room.disconnect();
      const problem = e instanceof Error && /NotAllowed|NotFound|Security|Overconstrained/.test(e.name) ? deviceProblem(e).message : `Could not connect the call: ${errorMessage(e)}`;
      this.patch({ phase: 'failed', problem });
      return false;
    }
    this.patch({ phase: 'connected', since: Date.now() });
    this.report();
    return true;
  }

  async mute(on = !this.current?.muted): Promise<void> {
    const s = this.current;
    if (!s) return;
    this.patch({ muted: on });
    // Held, the microphone stays off whatever Mute says; it comes back on Resume.
    if (!s.held) await this.room?.localParticipant.setMicrophoneEnabled(!on).catch(() => undefined);
  }

  /** Hold or resume (VOICE-13): the visitor hears the hold tone, and nothing from here. */
  async hold(on: boolean): Promise<void> {
    const s = this.current;
    if (!s) return;
    await apiPost(`${WEBSITE}/calls/${s.callId}/hold`, { on });
    this.patch({ held: on });
    await this.room?.localParticipant.setMicrophoneEnabled(!on && !s.muted).catch(() => undefined);
    for (const el of this.audio) el.muted = on;
    this.report();
  }

  /**
   * Leave the call, or end it for everybody (VOICE-13). Notes are kept on the chat as a note only staff see. Leaving
   * as the last of the team ends it too; the server decides.
   */
  async end(callId: number, forEveryone: boolean, notes: string): Promise<void> {
    await apiPost(`${WEBSITE}/calls/${callId}/end`, { for_everyone: forEveryone, notes: notes.trim() || null });
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

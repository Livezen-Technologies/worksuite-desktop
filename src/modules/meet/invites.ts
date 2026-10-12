import type { MeetRole } from './api';

/**
 * How each invitation into a meeting that is on stands (worksuite-desktop#347),
 * with nothing here deciding it: the server keeps one state per invitation,
 * moves it on an answer, a cancel, a join or its own clock, and tells the
 * host, the meeting and the person invited (`meeting.invite_state_changed`),
 * on which the list is read again. This file only says each state in words
 * and which actions go with it.
 *
 * The ring arriving is never "accepted": Accepted — "Joining…" — is only ever
 * what the server says after the person tapped Accept.
 */

export type InviteState = 'ringing' | 'no_answer' | 'declined' | 'cancelled' | 'accepted' | 'joining' | 'joined' | 'failed' | 'offline' | 'busy';

/** The seven states the #79 server sends as `state`; a newer one sends `invite_state` too. */
export type RingState = 'ringing' | 'accepted' | 'joined' | 'declined' | 'no_answer' | 'cancelled' | 'unavailable';

export interface Ring {
  id: number;
  /** The ring this invitation follows (the same as `id`); ringing again makes a new one. */
  ring_id?: number;
  user_id: number;
  name: string;
  state: RingState;
  /** The invitation's own state; missing from an older server. */
  invite_state?: InviteState | null;
  /** What they said declining, or why it could not ring (`do_not_disturb`). */
  reason?: string | null;
  state_changed_at?: string | null;
  /** Seconds before the server settles it by itself (no answer, couldn't join); null when nothing will. */
  expires_in?: number | null;
  invited_by: { id: number; name: string };
  rang_at: string;
  retry_in: number;
}

export type InviteAction = 'cancel' | 'ring_again' | 'remove' | 'copy_link' | 'message';

const STATES = new Set<string>(['ringing', 'no_answer', 'declined', 'cancelled', 'accepted', 'joining', 'joined', 'failed', 'offline', 'busy']);

/** An older server's state, read as the invitation it means. Its "accepted" is somebody who tapped Accept. */
const FROM_RING: Record<RingState, InviteState> = {
  ringing: 'ringing',
  accepted: 'joining',
  joined: 'joined',
  declined: 'declined',
  no_answer: 'no_answer',
  cancelled: 'cancelled',
  unavailable: 'offline',
};

export function inviteStateOf(r: Pick<Ring, 'state' | 'invite_state'>): InviteState {
  if (r.invite_state && STATES.has(r.invite_state)) return r.invite_state;
  return FROM_RING[r.state] ?? 'no_answer';
}

/** 0:07, 1:02. */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** The server's time as epoch ms: its `Y-m-d H:i:s` is UTC. */
export function serverTime(at: string | null | undefined): number {
  if (!at) return NaN;
  return Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(at) ? at : `${at.replace(' ', 'T')}Z`);
}

/**
 * An invitation in words — one for each state, and nothing else.
 *
 * @param now   epoch ms, for how long it has been ringing
 */
export function inviteLabel(r: Ring, now: number): string {
  const state = inviteStateOf(r);
  switch (state) {
    case 'ringing': {
      const since = serverTime(r.state_changed_at ?? r.rang_at);
      return Number.isFinite(since) ? `Ringing… ${clock((now - since) / 1000)}` : 'Ringing…';
    }
    case 'no_answer':
      return 'Didn’t answer';
    case 'declined':
      return r.reason ? `Declined · ${r.reason}` : 'Declined';
    case 'cancelled':
      return 'Invite cancelled';
    case 'accepted':
    case 'joining':
      return 'Joining…';
    case 'joined':
      return 'In the meeting';
    case 'failed':
      return 'Couldn’t join';
    case 'offline':
      return r.reason === 'do_not_disturb' ? 'Do not disturb · invite sent by notification' : 'Offline · invite sent by notification';
    case 'busy':
      return 'Busy in another call';
  }
}

export const INVITE_TONE: Record<InviteState, string> = {
  ringing: 'text-primary',
  accepted: 'text-success',
  joining: 'text-success',
  joined: 'text-success',
  declined: 'text-danger',
  failed: 'text-danger',
  no_answer: 'text-ink-3',
  cancelled: 'text-ink-3',
  offline: 'text-ink-3',
  busy: 'text-warning',
};

/** What the person inviting can do about an invitation in this state. */
export function inviteActions(state: InviteState): InviteAction[] {
  switch (state) {
    case 'ringing':
    case 'accepted':
    case 'joining':
      return ['cancel'];
    case 'no_answer':
    case 'declined':
    case 'cancelled':
      return ['ring_again', 'remove'];
    case 'failed':
      return ['ring_again'];
    case 'offline':
      return ['copy_link'];
    case 'busy':
      return ['ring_again', 'message'];
    case 'joined':
      return [];
  }
}

/** `meeting.invite_state_changed`, as the server sends it. `user_id` is the recipient's; the person invited is `invitee_id`. */
export interface InviteEvent {
  type: 'meeting.invite_state_changed';
  meeting: string;
  invitee_id: number;
  ring_id: number;
  invite_state: InviteState | null;
  state?: RingState | null;
  reason?: string | null;
  state_changed_at?: string | null;
  expires_in?: number | null;
  removed?: boolean;
}

export function isInviteEvent(e: unknown): e is InviteEvent {
  const x = e as Partial<InviteEvent> | null;
  return !!x && x.type === 'meeting.invite_state_changed' && typeof x.meeting === 'string' && Number.isInteger(Number(x.invitee_id)) && Number.isInteger(Number(x.ring_id));
}

/**
 * When to read the list again: just after the server's clock settles the
 * soonest invitation (no answer at 45 s, couldn't join at 30 s), else every
 * few seconds while one is still moving, else now and then.
 *
 * @param readAt epoch ms the list was read at
 */
export function nextRead(rings: Ring[], readAt: number, now: number): number {
  const moving = rings.filter((r) => ['ringing', 'accepted', 'joining'].includes(inviteStateOf(r)));
  if (!moving.length) return 20_000;
  const due = moving.map((r) => (r.expires_in == null ? Infinity : readAt + r.expires_in * 1000 + 300 - now)).filter((ms) => Number.isFinite(ms));
  const soonest = due.length ? Math.min(...due) : Infinity;
  return Math.max(250, Math.min(3_000, soonest));
}

/**
 * The badge next to a person in the meeting: from the meeting's host id and
 * co-host ids first — whoever made or started it is the Host — and the
 * connection's own word for anybody the meeting does not name.
 */
export function badgeRole(userId: number, connectionRole: MeetRole, info: { host_id?: number; cohosts?: number[] } | null | undefined): MeetRole {
  if (userId > 0 && info?.host_id && userId === info.host_id) return 'host';
  if (userId > 0 && info?.cohosts?.includes(userId)) return 'cohost';
  return connectionRole;
}

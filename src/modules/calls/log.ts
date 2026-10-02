/**
 * The call log (`GET /api/chat/calls/history`), as the chat drawer's Calls
 * tab shows it (ChatDrawerCalls).
 */

/** A native call log row. */
export interface CallRow {
  uuid: string;
  room_id: number;
  room_name: string | null;
  caller_name: string;
  mode: 'audio' | 'video';
  direction: 'incoming' | 'outgoing';
  status: string;
  outcome: string | null;
  /** An outgoing call everybody declined as busy says `busy` (worksuite-desktop#113). */
  decline_reason?: string | null;
  missed: boolean;
  live: boolean;
  duration: number | null;
  started_at: string;
}

export type Kind = 'missed' | 'in' | 'out' | 'live';

/** How a call reads in the log: its glyph and colour, its line, and what to do about it. */
export function describeCall(c: CallRow): { kind: Kind; line: string; action: string } {
  const how = c.mode === 'video' ? 'video' : 'voice';
  const mins = c.duration ? ` · ${Math.max(1, Math.round(c.duration / 60))} min` : '';
  if (c.live) return { kind: 'live', line: `Ongoing ${how} call`, action: 'Join' };
  if (c.missed) return { kind: 'missed', line: `Missed ${how} call`, action: 'Call back' };
  if (c.direction === 'incoming') return { kind: 'in', line: c.outcome === 'declined' ? `Declined ${how} call` : `Incoming ${how}${mins}`, action: 'Call back' };
  if (c.outcome === 'answered') return { kind: 'out', line: `Outgoing ${how}${mins}`, action: 'Call again' };
  // Nobody talked: why, as the call window said it (worksuite-desktop#113).
  const line = c.outcome === 'declined' ? (c.decline_reason === 'busy' ? 'Busy' : 'Declined') : c.outcome === 'missed' ? 'No answer' : c.outcome === 'cancelled' ? 'Cancelled' : 'No one joined';
  return { kind: 'out', line, action: 'Call again' };
}

/** A call card as the thread draws it: what it says, how it looks, and what Join or Call back does. */
export function describeCard(
  m: { sender_name: string; call_state?: string | null; call_kind?: string | null; call_mode?: string | null; call_outcome?: string | null; call_duration?: number | null },
  own: boolean,
): { title: string; detail: string | null; tone: 'live' | 'missed' | 'plain'; action: 'Join' | 'Call back' | 'Call again' | null } {
  const how = m.call_mode === 'video' ? 'video' : 'voice';
  if (m.call_kind === 'meeting') {
    if (m.call_state === 'gone') return { title: 'Meeting removed', detail: null, tone: 'plain', action: null };
    return { title: own ? 'You started a meeting' : `${m.sender_name} started a meeting`, detail: m.call_state === 'live' ? 'Live' : 'Ended', tone: m.call_state === 'live' ? 'live' : 'plain', action: m.call_state === 'live' ? 'Join' : null };
  }
  if (m.call_state === 'live') return { title: own ? `You started a ${how} call` : `${m.sender_name} is calling`, detail: 'Live', tone: 'live', action: own ? null : 'Join' };
  const talked = m.call_duration ? `${Math.max(1, Math.round(m.call_duration / 60))} min` : null;
  if (m.call_outcome === 'answered' && talked) return { title: `${how === 'video' ? 'Video' : 'Voice'} call`, detail: talked, tone: 'plain', action: own ? 'Call again' : 'Call back' };
  if (own) return { title: m.call_outcome === 'declined' ? 'Call declined' : m.call_outcome === 'cancelled' ? 'Cancelled call' : 'No answer', detail: `${how} call`, tone: 'plain', action: 'Call again' };
  // Declined is a choice somebody made, not a call that went unseen.
  if (m.call_outcome === 'declined') return { title: `Declined ${how} call`, detail: null, tone: 'plain', action: 'Call back' };
  return { title: `Missed ${how} call`, detail: null, tone: 'missed', action: 'Call back' };
}

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
  return { kind: 'out', line: c.outcome === 'declined' ? 'Declined' : 'No one joined', action: 'Call again' };
}

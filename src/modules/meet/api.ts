import { apiGet, apiPost } from '../../core/api';
import { call } from '../../core/bridge';

/**
 * WorkSuite Meet (`/api/meet/*`): meetings with a link, a code and a lobby,
 * held on the same media server as calls. A meeting opens in a window of its
 * own; the chat that goes with it is an ordinary chat room.
 */
export interface MeetInfo {
  uuid: string;
  meeting_id?: string;
  title: string | null;
  host_name: string | null;
  scheduled_at: string | null;
  started_at: string | null;
  mode: 'audio' | 'video' | null;
  room_id: number | null;
  joined_count: number;
  ended: boolean;
  has_passcode: boolean;
  needs_passcode: boolean;
  is_host: boolean;
  join_url: string;
  displayName?: string;
  /** Hosts only. */
  passcode?: string | null;
  code?: string | null;
  /** Roles and room settings (worksuite-desktop#82); missing from an older server. */
  role?: MeetRole;
  is_cohost?: boolean;
  can_manage?: boolean;
  host_id?: number;
  cohosts?: number[];
  presenters?: number[];
  locked?: boolean;
  room_settings?: RoomSettings;
}

/** Host runs the meeting; co-hosts run the room with them; presenters may share; participants take part. */
export type MeetRole = 'host' | 'cohost' | 'presenter' | 'participant';

export const ROLE_LABEL: Record<MeetRole, string> = { host: 'Host', cohost: 'Co-host', presenter: 'Presenter', participant: 'Participant' };

/** A meeting's room settings, as the server keeps them (`MeetRoom::DEFAULTS`). */
export interface RoomSettings {
  /** Who may come in: anyone with the link (guests too), people signed in to WorkSuite, or only the people invited. */
  access: 'anyone' | 'signed_in' | 'invited';
  waiting_room: boolean;
  join_before_host: boolean;
  present: 'everyone' | 'presenters';
  invite: 'everyone' | 'hosts';
  chat: 'everyone' | 'hosts' | 'off';
  record: 'host' | 'hosts';
  /** Who sees the meeting's transcripts and minutes. */
  transcripts: 'participants' | 'hosts';
}

export const DEFAULT_ROOM_SETTINGS: RoomSettings = {
  access: 'anyone',
  waiting_room: true,
  join_before_host: true,
  present: 'everyone',
  invite: 'everyone',
  chat: 'everyone',
  record: 'host',
  transcripts: 'participants',
};

/** `GET/PUT /api/meet/{uuid}/settings`. */
export interface RoomSettingsView {
  title: string;
  locked: boolean;
  has_passcode: boolean;
  passcode?: string | null;
  settings: RoomSettings;
  can_edit: boolean;
}

/** A role or settings change, in the meeting's activity. */
export interface RoomActivity {
  id: number;
  action: string;
  description: string;
  by: { id: number; name: string } | null;
  at: string;
}

/** What a role may do in a room with these settings — the server decides; this only shows the right controls. */
export const may = {
  manage: (r: MeetRole) => r === 'host' || r === 'cohost',
  present: (r: MeetRole, s: RoomSettings) => s.present === 'everyone' || r !== 'participant',
  record: (r: MeetRole, s: RoomSettings) => r === 'host' || (r === 'cohost' && s.record === 'hosts'),
  invite: (r: MeetRole, s: RoomSettings) => s.invite === 'everyone' || r === 'host' || r === 'cohost',
  chat: (r: MeetRole, s: RoomSettings) => (s.chat === 'off' ? false : s.chat === 'hosts' ? r === 'host' || r === 'cohost' : true),
  transcripts: (r: MeetRole, s: RoomSettings) => s.transcripts === 'participants' || r === 'host' || r === 'cohost',
};

export interface Created extends MeetInfo {
  code: string;
  later: boolean;
}

export interface Sfu {
  url: string;
  token: string;
  identity: string;
  is_host: boolean;
  role?: MeetRole;
  /** Why we wait at the door: to be admitted, or until a host is in. Null: straight in. */
  door?: 'waiting_room' | 'no_host' | null;
}

export interface HistoryRow {
  uuid: string;
  title: string | null;
  type: string | null;
  code: string | null;
  started_at: string | null;
  ended_at: string | null;
  scheduled_at: string | null;
  created_at: string;
  status: 'ended' | 'not_started' | 'live' | 'open';
  in_call: number | null;
  is_host: boolean;
  host_name: string | null;
  people: string[];
  room_id: number | null;
  join_url: string;
  recording: boolean;
  recording_ready: boolean;
}

export interface UpcomingRow {
  uuid: string;
  title: string | null;
  scheduled_at: string;
  ends_at: string | null;
  is_host: boolean;
  host_name: string | null;
  people: number;
  record_id: number | null;
}

export interface Recording {
  id: number;
  title: string;
  created_at: string;
  ready: boolean;
  size: number | null;
}

const UUID = /^[A-Za-z0-9-]{8,64}$/;

/** What was typed into "Enter a code or meeting link": a meeting's uuid, or a code to resolve. */
export function parseMeetingInput(raw: string): { uuid: string } | { code: string } | null {
  const s = raw.trim();
  if (!s) return null;
  const link = /\/meet\/([A-Za-z0-9-]{8,64})(?:[/?#]|$)/.exec(s);
  if (link) return { uuid: link[1]! };
  const digits = s.replace(/[\s-]/g, '');
  if (/^\d{6,12}$/.test(digits)) return { code: digits };
  if (UUID.test(s) && s.includes('-')) return { uuid: s };
  return { code: s };
}

/** "482119330" → "482 119 330", the way people read a meeting ID aloud. */
export function formatCode(code: string | null | undefined): string {
  const d = (code ?? '').replace(/\D/g, '');
  return d.length === 9 ? `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}` : (code ?? '');
}

/** Open a meeting in its window (one window per meeting). */
/** Open a meeting in its window. `quiet`: its join screen starts with the microphone and camera off (an accepted ring). */
export async function openMeeting(uuid: string, title?: string | null, opts: { quiet?: boolean } = {}): Promise<void> {
  if (!UUID.test(uuid)) return;
  await call('windows:open', { kind: 'meet', route: `/meet/${uuid}${opts.quiet ? '?quiet=1' : ''}`, title: title ?? 'WorkSuite Meet', alwaysOnTop: false });
}

export async function resolveCode(code: string): Promise<{ uuid: string; title: string | null; ended: boolean }> {
  return apiGet('/api/meet/resolve', { code });
}

export async function createMeeting(opts: { title?: string; roomId?: number | string; later?: boolean; passcode?: string }): Promise<Created> {
  return apiPost<Created>('/api/meet/create', {
    title: opts.title || undefined,
    room_id: opts.roomId ? Number(opts.roomId) : undefined,
    mode: 'video',
    later: !!opts.later,
    passcode: opts.passcode || undefined,
  });
}

/** The invitation text a host sends, as the web words it. */
export function invitation(m: { title?: string | null; join_url: string; code?: string | null; passcode?: string | null }, host: string | null): string {
  const parts = [`${host ?? 'Someone'} invites you to “${m.title || 'a WorkSuite meeting'}”.`, `Join: ${m.join_url}`];
  if (m.code) parts.push(`Meeting ID: ${formatCode(m.code)}`);
  if (m.passcode) parts.push(`Passcode: ${m.passcode}`);
  return parts.join('\n');
}

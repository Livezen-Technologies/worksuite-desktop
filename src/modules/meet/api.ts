import { apiGet, apiPost } from '../../core/api';
import { call } from '../../core/bridge';
import { can, meetingRoleOf, type MeetingRole } from './permissions';

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
  /** My one role in the permission table, and what it allows here (#348); missing from an older server. */
  meeting_role?: MeetingRole;
  permissions?: string[];
  is_cohost?: boolean;
  can_manage?: boolean;
  host_id?: number;
  cohosts?: number[];
  presenters?: number[];
  locked?: boolean;
  room_settings?: RoomSettings;
  /**
   * A remote support session rather than a meeting (WS-MEET-ENH-01 RC-SUP-03).
   * The server says so; when it does, the room is reduced to the screen, the
   * conversation, files and the session itself — a support call is two people
   * and a problem, not a meeting with an audience.
   */
  session_kind?: 'meeting' | 'support';
  ticket_id?: number | null;
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
  /** Q&A, polls and raised hands (worksuite-desktop#92); missing from an older server, which has none of them. */
  qa?: boolean;
  /** Askers may leave their name off a question. */
  qa_anonymous?: boolean;
  polls?: boolean;
  raise_hand?: boolean;
  /**
   * Host Controls (worksuite-desktop#91); missing from an older server. Who may come in: open (anyone with the
   * link), trusted (invited people signed in come straight in, everybody else asks) or restricted (only invited
   * people may ask). `access` and `waiting_room` are what it means in the settings before it.
   */
  access_mode?: AccessMode;
  /** Guests (no WorkSuite account) may come in, or ask to. Never in a restricted meeting. */
  guest_requests?: boolean;
  /** What participants (everybody but the host and co-hosts) may use. */
  microphone?: boolean;
  camera?: boolean;
  reactions?: boolean;
  whiteboard?: boolean;
  /** Off: nobody records or transcribes this meeting. */
  recording?: boolean;
  transcription?: boolean;
}

export type AccessMode = 'open' | 'trusted' | 'restricted';

/** The access mode, from a server that sends it or from the settings before it. */
export function accessModeOf(s: Partial<RoomSettings>): AccessMode {
  if (s.access_mode) return s.access_mode;
  if (s.access === 'invited') return 'restricted';
  return s.waiting_room === false ? 'open' : 'trusted';
}

/** Whether guests may come in or ask, from a server that sends it or from the settings before it. */
export function guestsOf(s: Partial<RoomSettings>): boolean {
  return s.guest_requests ?? (s.access ?? 'anyone') === 'anyone';
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
  qa: true,
  qa_anonymous: true,
  polls: true,
  raise_hand: true,
  access_mode: 'trusted',
  guest_requests: true,
  microphone: true,
  camera: true,
  reactions: true,
  whiteboard: true,
  recording: true,
  transcription: true,
};

/** `GET/PUT /api/meet/defaults`: my defaults for the meetings I start or schedule (worksuite-desktop#91). */
export interface MeetDefaultsView {
  settings: RoomSettings;
  /** False: never saved, so new meetings use the standard settings. */
  saved: boolean;
  /** False: the server cannot keep them yet. */
  available?: boolean;
}

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
  /** Nobody while the room has recording off (worksuite-desktop#91). The permission table decides (#348). */
  record: (r: MeetRole, s: RoomSettings) => can(meetingRoleOf(r, false), 'record', s),
  invite: (r: MeetRole, s: RoomSettings) => can(meetingRoleOf(r, false), 'invite', s),
  chat: (r: MeetRole, s: RoomSettings) => (s.chat === 'off' ? false : s.chat === 'hosts' ? r === 'host' || r === 'cohost' : true),
  transcripts: (r: MeetRole, s: RoomSettings) => s.transcripts === 'participants' || r === 'host' || r === 'cohost',
  /** Participants' permissions (worksuite-desktop#91): the host and co-hosts are never limited. A setting an older server leaves out is on. */
  microphone: (r: MeetRole, s: RoomSettings) => r === 'host' || r === 'cohost' || s.microphone !== false,
  camera: (r: MeetRole, s: RoomSettings) => r === 'host' || r === 'cohost' || s.camera !== false,
  react: (r: MeetRole, s: RoomSettings) => r === 'host' || r === 'cohost' || s.reactions !== false,
  draw: (r: MeetRole, s: RoomSettings) => r === 'host' || r === 'cohost' || s.whiteboard !== false,
  transcribe: (r: MeetRole, s: RoomSettings) => s.transcription !== false && (r === 'host' || r === 'cohost' || may.record(r, s)),
};

/**
 * Q&A, polls and raised hands (worksuite-desktop#92): `GET /api/meet/{uuid}/activities`.
 * The server keeps them and decides who sees what; every change it is told of
 * comes back as the whole state.
 */
export interface MeetQuestion {
  id: number;
  text: string;
  anonymous: boolean;
  /** Null when asked anonymously, for everybody but the host and co-hosts. */
  author: string | null;
  author_id: number | null;
  guest: boolean | null;
  mine: boolean;
  status: 'open' | 'answered';
  answer: string | null;
  answered_by: string | null;
  answered_at: string | null;
  /** Only the host and co-hosts are sent hidden questions. */
  hidden: boolean;
  votes: number;
  voted: boolean;
  created_at: string | null;
}

export interface MeetPoll {
  id: number;
  question: string;
  kind: 'single' | 'multiple';
  options: string[];
  anonymous: boolean;
  status: 'draft' | 'live' | 'closed';
  shared: boolean;
  /** How many have voted: everybody sees it while the poll is live. */
  voters: number;
  /** What I chose, once I have voted. */
  my_choices: number[] | null;
  /** The count per option: the hosts', and everybody's once shared. */
  results: number[] | null;
  /** Who chose what: the hosts', and never on an anonymous poll. */
  ballots?: Array<{ name: string; choices: number[] }>;
  created_at?: string | null;
  launched_at?: string | null;
  closed_at?: string | null;
}

export interface RaisedHand {
  /** `u12` for a person signed in, the guest's identity for a guest. */
  who: string;
  user_id: number | null;
  name: string;
  raised_at: string;
  mine: boolean;
}

export interface MeetActivities {
  enabled: { qa: boolean; qa_anonymous: boolean; polls: boolean; raise_hand: boolean };
  me: { who: string; name: string; manages: boolean; guest: boolean };
  questions: MeetQuestion[];
  polls: MeetPoll[];
  /** First raised first. */
  hands: RaisedHand[];
}

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
  /** The one role of the permission table, and what it allows (#348). */
  meeting_role?: MeetingRole;
  permissions?: string[];
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
  client_id?: string | null;
  thumbnail_url?: string | null;
  id: number;
  title: string;
  created_at: string;
  ready: boolean;
  size: number | null;
  /** Where and how far (worksuite-desktop#68); missing from an older server. */
  method?: 'cloud' | 'local';
  status?: 'starting' | 'stopping' | 'recording' | 'processing' | 'uploading' | 'ready' | 'failed';
  error?: string | null;
  drive_file_id?: number | null;
  duration?: number | null;
  meeting_uuid?: string | null;
  /** How the step it is in is going (worksuite-desktop#89): stuck for far too long, with what to do; whole and in Drive. */
  stalled?: boolean;
  guidance?: string | null;
  playable?: boolean;
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
export async function openMeeting(uuid: string, title?: string | null, opts: { quiet?: boolean; audioOnly?: boolean; present?: boolean } = {}): Promise<void> {
  if (!UUID.test(uuid)) return;
  // `quiet`: nothing switches on by itself (an accepted invitation).
  // `audio`: the camera starts off, the microphone as remembered (D04's Audio only).
  // `present`: came from Share screen (D01), so the pre-join screen offers the
  // share as its main action and starts the camera off.
  const flags = [opts.quiet ? 'quiet=1' : '', opts.audioOnly ? 'audio=1' : '', opts.present ? 'present=1' : ''].filter(Boolean).join('&');
  await call('windows:open', { kind: 'meet', route: `/meet/${uuid}${flags ? `?${flags}` : ''}`, title: title ?? 'WorkSuite Meet', alwaysOnTop: false });
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

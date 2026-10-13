/**
 * Meetings (`/api/meetings/*`): agendas, attendance, minutes and action
 * items, gated by the `meeting.*` permissions. Times are instants with a Z.
 */
import { currentZone, parseTs } from '../../core/time';

export interface Can {
  view: boolean;
  schedule: boolean;
  manage: boolean;
  rooms: boolean;
}

export type Rsvp = 'no_response' | 'accepted' | 'declined' | 'tentative';

/**
 * The record a meeting was scheduled from (worksuite-desktop#100, #101): a
 * tender, a lead, a customer or a supplier. `label` and `link` are there only
 * for someone who may open that record (`can_open`); everyone sees what kind
 * of meeting it is.
 */
export interface MeetingSource {
  type: 'tender' | 'crm_lead' | 'crm_account' | 'crm_deal' | 'vendor' | string;
  id: number;
  kind: string | null;
  kind_label: string;
  label: string | null;
  link: string | null;
  can_open: boolean;
  /** "Open Tender" — sent with `link`. */
  open_label?: string | null;
}

/** The "Related to" filter of the Meetings list, as the server takes it (`source=`). */
export const SOURCE_FILTERS: Array<[string, string]> = [
  ['', 'Anything'],
  ['tender', 'Tender'],
  ['crm', 'CRM'],
  ['crm_lead', 'Lead'],
  ['crm_account', 'Customer'],
  ['vendor', 'Supplier'],
];

/**
 * Whether a meeting belongs under a "Related to" choice. The server filters (`source=`); this says the same thing
 * again on the rows it sent, so a server that does not know the filter yet cannot show tender meetings as
 * everything.
 */
export function matchesSource(m: Pick<Meeting, 'source'>, source: string): boolean {
  if (!source) return true;
  const t = m.source?.type;
  if (!t) return false;
  return source === 'crm' ? t.startsWith('crm_') : t === source;
}

/** "Open Tender", "Open Lead"… — what the button to the related record says. */
export function openRelatedLabel(s: Pick<MeetingSource, 'type'>): string {
  return s.type === 'tender' ? 'Open Tender' : s.type === 'crm_lead' ? 'Open Lead' : s.type === 'crm_account' ? 'Open Customer' : s.type === 'crm_deal' ? 'Open Deal' : s.type === 'vendor' ? 'Open Supplier' : 'Open Related Record';
}

/** What scheduling from a record fills in (ScheduleDialog's `preset`). */
export interface MeetingPreset {
  title?: string;
  type?: string;
  source_type: MeetingSource['type'];
  source_id: number;
  source_kind?: string;
  client_id?: number;
  /** Shown in the dialog: "Lead · Acme Corp". */
  label: string;
  /** External guests to invite by email — a tender's contact person, for one. */
  guests?: string[];
}

export interface Meeting {
  id: number;
  meeting_no: string;
  title: string;
  subject: string | null;
  description: string | null;
  type: string;
  priority: string;
  status: string;
  live_status: 'scheduled' | 'ongoing' | 'completed' | 'cancelled' | 'draft';
  organizer_id: number;
  organizer: string | null;
  host: string | null;
  project: string | null;
  client: string | null;
  start_at: string;
  end_at: string;
  all_day: boolean;
  /** The clock it was booked on — a tender's meeting, the buyer's company's (#100). */
  timezone?: string | null;
  duration_minutes: number;
  recur_freq: string;
  location_type: string;
  room_id: number | null;
  room: string | null;
  address: string | null;
  where: string | null;
  online_provider: string | null;
  online_url: string | null;
  online_password: string | null;
  meet_uuid: string | null;
  participants?: number;
  accepted?: number;
  my_role?: string | null;
  my_rsvp?: Rsvp | null;
  /** Newer servers (#100, #101): the record it was scheduled from. */
  source?: MeetingSource | null;
  /** Newer servers (MTG-U02/U03): what the reader may do with this meeting. Absent from an older server. */
  can?: Partial<MeetingAbilities> | null;
}

/**
 * What the reader may do with one meeting (SRS v1.1 MTG-U02/U03), as the server works it out from
 * `MeetingAccess::runsMeeting()`, the meeting's status and the reader's participant permissions. A control is shown
 * only when its flag is true. `agenda` is the server's older name for `run_agenda`.
 */
export interface MeetingAbilities {
  edit: boolean;
  reschedule: boolean;
  cancel: boolean;
  delete: boolean;
  start: boolean;
  complete: boolean;
  run_agenda: boolean;
  minutes: boolean;
  actions: boolean;
  upload: boolean;
  /** Join it, and be counted as attending. */
  attend: boolean;
  invite: boolean;
  rsvp: boolean;
}

export type Ability = keyof MeetingAbilities;

const ABILITIES: Ability[] = ['edit', 'reschedule', 'cancel', 'delete', 'start', 'complete', 'run_agenda', 'minutes', 'actions', 'upload', 'attend', 'invite', 'rsvp'];

/**
 * The abilities to show a meeting's controls by. From the server's `can` when it sends one — a flag it leaves out is
 * false, so nothing is offered that the server would refuse. From an older server, worked out the way this app always
 * did: whoever organises it, hosts it or manages meetings runs it, and a participant's permissions add to that. Start,
 * Complete and Delete are never offered without the server's word.
 */
export function abilitiesOf(m: Pick<Meeting, 'can' | 'live_status' | 'organizer_id'>, ctx: { me: number | null; mine: Pick<Person, 'role' | 'permissions'> | null; manage: boolean }): MeetingAbilities {
  const can = m.can;
  if (can && typeof can === 'object') {
    const out = Object.fromEntries(ABILITIES.map((k) => [k, can[k] === true])) as unknown as MeetingAbilities;
    out.run_agenda = can.run_agenda === true || (can.run_agenda === undefined && (can as { agenda?: boolean }).agenda === true);
    return out;
  }
  const runs = (ctx.me !== null && m.organizer_id === ctx.me) || ctx.manage || ctx.mine?.role === 'host' || ctx.mine?.role === 'organizer';
  const open = m.live_status !== 'cancelled' && m.live_status !== 'completed';
  const perms = ctx.mine?.permissions ?? null;
  return {
    edit: runs,
    reschedule: runs && open,
    cancel: runs && open,
    delete: false,
    start: false,
    complete: false,
    run_agenda: runs || !!perms?.edit_agenda,
    minutes: runs || !!perms?.edit_minutes,
    actions: runs || !!perms?.create_actions,
    upload: runs || (!!ctx.mine && perms?.upload !== false),
    attend: open,
    invite: runs,
    rsvp: !!ctx.mine && !(ctx.me !== null && m.organizer_id === ctx.me),
  };
}

/** Whether the server sent its own abilities for this meeting. */
export const serverAbilities = (m: Pick<Meeting, 'can'>): boolean => !!m.can && typeof m.can === 'object';

/**
 * A refusal that means the meeting moved on under the reader (MTG-U07/U08): a status change on a meeting already
 * cancelled or completed (409 `INVALID_STATUS`), an answer after it ended (410 `MEETING_OVER`), a check-in out of
 * its window. What to say, and that the meeting should be read again. Null for any other error.
 */
export function meetingProblem(e: unknown): { message: string; refresh: true } | null {
  const x = e as { status?: unknown; code?: unknown; message?: unknown } | null;
  const status = typeof x?.status === 'number' ? x.status : null;
  const code = typeof x?.code === 'string' ? x.code : null;
  const said = typeof x?.message === 'string' && x.message.trim() && !/^Request failed|^HTTP \d+/.test(x.message) ? x.message.trim() : null;
  if (status === 410 || code === 'MEETING_OVER') return { message: said ?? 'This meeting is over: answers are closed.', refresh: true };
  if (status === 409 && (code === 'INVALID_STATUS' || code === null || code === 'CHECK_IN_CLOSED')) return { message: said ?? 'This meeting has changed since you opened it. It is shown as it is now.', refresh: true };
  return null;
}

/** The paging the server sends with a list (MTG-U11); absent from an older one, which sends everything. */
export interface PageMeta {
  page: number;
  per_page: number;
  total: number;
  last_page: number;
}

/** A list answer: `meetings` from this app's server so far, `data` from the paged list; `meta` when it pages. */
export function listOf(r: { meetings?: Meeting[]; data?: Meeting[]; meta?: PageMeta | null } | null | undefined): { rows: Meeting[]; meta: PageMeta | null } {
  const rows = Array.isArray(r?.meetings) ? r.meetings : Array.isArray(r?.data) ? r.data : [];
  const meta = r?.meta && typeof r.meta.page === 'number' && typeof r.meta.last_page === 'number' ? r.meta : null;
  return { rows, meta };
}

/** One occurrence of a meeting on the calendar (MTG-U12), a repeating one's each its own. */
export interface Occurrence {
  meeting_id: number;
  occurrence_date: string;
  start_at: string;
  end_at: string;
  title: string;
  status: string;
  room_id: number | null;
  room: string | null;
  type: string;
  can?: Partial<MeetingAbilities> | null;
}

/**
 * The home's day strip: the next `days` days from `today`, each with how many meetings it has. From the calendar's
 * occurrences when the server has them (a repeating meeting on every day it happens), else from the list's rows.
 * Cancelled ones are not counted. `dayOf` puts a stamp on the reader's calendar.
 */
export function dayStrip(today: string, days: number, items: Array<{ start_at: string; status?: string; live_status?: string }>, dayOf: (stamp: string) => string, addDays: (ymd: string, n: number) => string): Array<{ day: string; count: number }> {
  const out = Array.from({ length: days }, (_, i) => ({ day: addDays(today, i), count: 0 }));
  for (const it of items) {
    if (it.status === 'cancelled' || it.live_status === 'cancelled') continue;
    const slot = out.find((d) => d.day === dayOf(it.start_at));
    if (slot) slot.count++;
  }
  return out;
}

/**
 * The status chip a row of the home shows (D01): live, cancelled, yours to run, or your answer — "Waiting for you"
 * while you have not answered.
 */
export function rowChip(m: Pick<Meeting, 'live_status' | 'my_role' | 'my_rsvp'>): [string, 'muted' | 'indigo' | 'success' | 'warning' | 'danger'] {
  if (m.live_status === 'ongoing') return ['Happening now', 'danger'];
  if (m.live_status === 'cancelled') return ['Cancelled', 'muted'];
  if (m.live_status === 'completed') return ['Completed', 'muted'];
  if (m.my_role === 'organizer') return ['Organiser', 'indigo'];
  if (m.my_role === 'host') return ['Host', 'indigo'];
  const r = m.my_rsvp ?? 'no_response';
  if (r === 'accepted') return ['Going', 'success'];
  if (r === 'tentative') return ['Tentative', 'warning'];
  if (r === 'declined') return ['Not going', 'muted'];
  return ['Waiting for you', 'danger'];
}

export interface Person {
  id: number;
  user_id: number | null;
  name: string | null;
  email: string | null;
  role: string;
  rsvp: Rsvp;
  attendance: string | null;
  permissions: Record<string, boolean> | null;
  attended_minutes: number;
  external: boolean;
}

export interface AgendaItem {
  id: number;
  position: number;
  title: string;
  presenter: string | null;
  minutes: number;
  notes: string | null;
  status?: 'pending' | 'running' | 'done' | 'skipped';
  started_at?: string | null;
  elapsed_seconds?: number;
}

export interface ActionItem {
  id: number;
  title: string;
  detail: string | null;
  assignee_id: number | null;
  assignee: string | null;
  due_date: string | null;
  priority: string;
  status: 'open' | 'in_progress' | 'done' | 'cancelled';
  task_id: number | null;
}

/** One message about a meeting to one person (worksuite-desktop#97), as its organiser sees it. */
export interface Delivery {
  id: number;
  participant_id: number | null;
  name: string | null;
  email: string | null;
  channel: 'email' | 'in_app' | string;
  kind: 'invitation' | 'update' | 'cancellation' | 'reminder' | 'summary' | string;
  state: 'queued' | 'sending' | 'sent' | 'failed' | 'suppressed' | 'cancelled' | string;
  attempts: number;
  error: string | null;
  next_attempt_at: string | null;
  sent_at: string | null;
}

export interface Detail {
  meeting: Meeting;
  /** For whoever runs it: what reached whom, failures first; null for everyone else. */
  deliveries?: { rows: Delivery[]; counts: Record<string, number> } | null;
  participants: Person[];
  agenda: AgendaItem[];
  minutes: { summary: string | null; decisions: string | null; notes: string | null; finalised_at: string | null } | null;
  action_items: ActionItem[];
  /** Newer servers (MTG-U06, U15) open a file by a short-lived signed link and keep it in Drive; `url` and `at` are older. */
  files: Array<{ id: number; kind: string; filename: string; size: number; mime: string; url?: string | null; at?: string | null; created_at?: string | null; uploaded_by?: string | null; drive_file_id?: number | null }>;
  /** Your recordings of this meeting held on Meet (worksuite-desktop#68); only their owner sees them. */
  recordings?: Array<{ id: number; client_id?: string | null; title: string; status: string; method: 'cloud' | 'local'; error: string | null; drive_file_id: number | null; size: number | null; created_at: string; stalled?: boolean; guidance?: string | null; playable?: boolean }>;
  chat: { room_id: number; meet_uuid: string | null; join_url: string | null; member: boolean } | null;
  can: Can;
}

export interface MeetingRoom {
  id: number;
  name: string;
  building: string | null;
  floor: string | null;
  capacity: number | null;
  amenities: string | null;
  is_active: boolean;
  in_use: boolean;
  current: { title: string; until: string } | null;
  next: { title: string; at: string } | null;
}

export const TYPES: Array<[string, string]> = [
  ['internal', 'Internal'], ['client', 'Client'], ['sales', 'Sales'], ['vendor', 'Vendor'], ['interview', 'Interview'], ['training', 'Training'],
  ['project', 'Project'], ['support', 'Support'], ['team', 'Team'], ['board', 'Board'], ['hr', 'HR'], ['online', 'Online'],
];

/** The type colours of MeetingsDash. */
export const TYPE_COLOUR: Record<string, string> = {
  internal: 'text-primary', client: 'text-[#0B6770] dark:text-teal', sales: 'text-[#9A4A06] dark:text-warning', vendor: 'text-[#6B3FB5]', interview: 'text-success', training: 'text-ink-2',
};

export const RSVP_LABEL: Record<Rsvp, string> = { accepted: 'Going', tentative: 'Maybe', declined: 'Not going', no_response: 'Awaiting answer' };

export function typeLabel(t: string): string {
  return TYPES.find(([k]) => k === t)?.[1] ?? t;
}

/**
 * When a meeting was booked on another clock — a tender's pre-bid meeting on the buyer's company's (#100) — the
 * time as it is there: "20 Oct, 10:00 Asia/Colombo". Null on the reader's own clock, where it would only repeat.
 */
export function zoneNote(instant: string, zone: string | null | undefined, here = currentZone()): string | null {
  if (!zone || zone === here) return null;
  const at = parseTs(instant);
  if (Number.isNaN(at.getTime())) return null;
  try {
    return `${new Intl.DateTimeFormat('en-GB', { timeZone: zone, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at)} ${zone}`;
  } catch {
    // Not a zone this computer knows.
    return null;
  }
}

export function providerLabel(m: Pick<Meeting, 'location_type' | 'online_provider'>): string {
  if (m.location_type === 'room' || m.location_type === 'customer' || m.location_type === 'external') return 'In person';
  const p = m.online_provider === 'builtin' ? 'Built-in Meet' : m.online_provider === 'jitsi' ? 'Jitsi Meet' : m.online_provider === 'google' ? 'Google Meet (link)' : m.online_provider === 'teams' ? 'Microsoft Teams (link)' : m.online_provider === 'zoom' ? 'Zoom (link)' : 'Online';
  return m.location_type === 'hybrid' ? `Hybrid · ${p}` : p;
}

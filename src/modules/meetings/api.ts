/**
 * Meetings (`/api/meetings/*`): agendas, attendance, minutes and action
 * items, gated by the `meeting.*` permissions. Times are instants with a Z.
 */
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

export interface Detail {
  meeting: Meeting;
  participants: Person[];
  agenda: AgendaItem[];
  minutes: { summary: string | null; decisions: string | null; notes: string | null; finalised_at: string | null } | null;
  action_items: ActionItem[];
  files: Array<{ id: number; kind: string; filename: string; size: number; mime: string; url: string; at: string }>;
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

export function providerLabel(m: Pick<Meeting, 'location_type' | 'online_provider'>): string {
  if (m.location_type === 'room' || m.location_type === 'customer' || m.location_type === 'external') return 'In person';
  const p = m.online_provider === 'builtin' ? 'Built-in Meet' : m.online_provider === 'jitsi' ? 'Jitsi Meet' : m.online_provider === 'google' ? 'Google Meet (link)' : m.online_provider === 'teams' ? 'Microsoft Teams (link)' : m.online_provider === 'zoom' ? 'Zoom (link)' : 'Online';
  return m.location_type === 'hybrid' ? `Hybrid · ${p}` : p;
}

/**
 * Where WorkSuite Events is, from the tab's address — and the address of each
 * place. Pure, so a deep link, a notification's link and a window's route are
 * read the same way (tested in `event-desk.test.tsx`).
 *
 *   /events                                  the events this person reaches
 *   /events/<id>                             the event (Event 360 for organisers; the desk otherwise)
 *   /events/<id>/desk                        the Event Desk (`worksuite://events/<id>/desk`)
 *   /events/<id>/counters                    live counters — a window of their own beside the desk
 *   /events/<id>/setup                       this computer at the event: device, gate, key, badge printer
 *   /events/<id>/review                      offline scans, duplicates and conflicts to review
 *   /events/<id>/recent                      the latest scans at the event
 *   /events/<id>/program                     the day's program and a session's door
 *   /events/<id>/badges                      pre-printing badges and the print queue
 *   /events/<id>/registrations[?list=]       registrations (read)
 *   /events/<id>/registrations/<rid>         one registration
 *   /events/<id>/attendees                   the attendees
 *   /events/attendees/<aid>                  an attendee's profile
 *
 * The server's notification links name the web's pages: `/events/<id>/checkin/reconciliation`
 * (review), `/events/<id>/devices` (setup), `/events/<id>/schedule` and `/sessions…` (program),
 * `/events/<id>/registrations/<rid>`, `/events/<id>/groups/…`, `/events/<id>/waitlist` (registrations);
 * the rest of an event's pages open its Event 360.
 */

export type EventView = 'overview' | 'desk' | 'counters' | 'setup' | 'review' | 'recent' | 'program' | 'badges' | 'registrations' | 'attendees';

export const VIEW_IDS: readonly EventView[] = ['overview', 'desk', 'counters', 'setup', 'review', 'recent', 'program', 'badges', 'registrations', 'attendees'];

export type Screen =
  | { kind: 'events' }
  | { kind: 'event'; id: number; view: EventView | null; list: string | null }
  | { kind: 'registration'; event: number; id: number }
  | { kind: 'attendee'; id: number; event: number | null };

const num = (v: string | null | undefined): number | null => (v && /^\d{1,10}$/.test(v) && Number(v) > 0 ? Number(v) : null);

const ALIASES: Record<string, EventView> = {
  desk: 'desk',
  'check-in': 'desk',
  checkin: 'desk',
  counters: 'counters',
  setup: 'setup',
  devices: 'setup',
  gates: 'setup',
  review: 'review',
  reconciliation: 'review',
  recent: 'recent',
  program: 'program',
  schedule: 'program',
  sessions: 'program',
  badges: 'badges',
  'badge-prints': 'badges',
  registrations: 'registrations',
  waitlist: 'registrations',
  groups: 'registrations',
  'walk-ins': 'registrations',
  attendees: 'attendees',
  overview: 'overview',
};

/** The screen a route names (`path` without the leading `events`, or with it). */
export function screenOf(path: string[], query: URLSearchParams): Screen {
  const rest = path[0] === 'events' ? path.slice(1) : path;
  const [a, b, c] = rest;
  if (a === 'attendees' && num(b)) return { kind: 'attendee', id: num(b)!, event: num(query.get('event')) };
  const id = num(a);
  if (!id) return { kind: 'events' };
  if (b === 'registrations' && num(c)) return { kind: 'registration', event: id, id: num(c)! };
  if (b === 'attendees' && num(c)) return { kind: 'attendee', id: num(c)!, event: id };
  const asked = query.get('view');
  let view: EventView | null = asked && (VIEW_IDS as readonly string[]).includes(asked) ? (asked as EventView) : null;
  if (!view && b) {
    // `/events/<id>/checkin/reconciliation`, `/events/<id>/checkin/recent`…
    const key = b === 'checkin' && c ? (c === 'reconciliation' ? 'review' : c === 'recent' ? 'recent' : c === 'sessions' ? 'program' : 'desk') : b;
    view = ALIASES[key] ?? 'overview';
  }
  const list = query.get('list') ?? (b === 'waitlist' ? 'waitlist' : b === 'walk-ins' ? 'walkins' : null);
  return { kind: 'event', id, view, list };
}

/** The address of a screen. */
export function routeOf(s: Screen | { kind: 'event'; id: number; view: EventView; list?: string | null }): string {
  switch (s.kind) {
    case 'events':
      return '/events';
    case 'registration':
      return `/events/${s.event}/registrations/${s.id}`;
    case 'attendee':
      return s.event ? `/events/${s.event}/attendees/${s.id}` : `/events/attendees/${s.id}`;
    default: {
      if (!s.view || s.view === 'overview') return `/events/${s.id}`;
      return s.list ? `/events/${s.id}/${s.view}?list=${encodeURIComponent(s.list)}` : `/events/${s.id}/${s.view}`;
    }
  }
}

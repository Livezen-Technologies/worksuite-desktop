/**
 * Where Hotel PMS is, from the tab's address — and the address of each
 * place. Pure, so a deep link, a notification's link and a window's route are
 * read the same way (tested in `pms.test.ts`).
 *
 *   /pms?view=rack|arrivals|departures|inhouse|dashboard|reservations|new|walkin|guests|cashier|audit|housekeeping|requests|devices
 *        |maintenance|lostfound
 *   /pms/reservations/<id>              a reservation (the deep link `worksuite://pms/reservations/<id>`)
 *   /pms/reservations/<id>/check-in     its quick check-in screen
 *   /pms/reservations/<id>/check-out    its check-out screen
 *   /pms/stays/<id>[?folio=<id>&act=]   a guest in house: the stay, its key, its folios (`act`: charge, move, extend)
 *   /pms/folios/<id>                    one folio
 *   /pms/rooms/<id>                     a room (the deep link `worksuite://pms/rooms/<id>`)
 *   /pms/guests/<id>                    a guest's profile
 *   /pms/cashier/<id>                   a cashier shift
 *   /pms/requests/<id>                  a guest request
 *   /pms/housekeeping/tasks/<id>        a housekeeping task
 *   /pms/maintenance/<id>               a maintenance issue
 *   /pms/lost-found/<id>                a found item
 *   /pms/maintenance, /pms/lost-found  their lists (the web's addresses)
 *
 * And the server's notification links, which name the web's pages:
 * `/pms/front-desk?arrivals=<date>` (the day's arrivals), `/pms/front-desk?room=<id>`
 * (the rack, that room's panel open), `/pms/housekeeping[?room=]`, `/pms/housekeeping/my`,
 * `/pms/night-audit`. `?new=1` (the shell's Mod+N) is a new reservation.
 */

export type PmsView =
  | 'dashboard'
  | 'rack'
  | 'arrivals'
  | 'departures'
  | 'inhouse'
  | 'reservations'
  | 'new'
  | 'walkin'
  | 'guests'
  | 'cashier'
  | 'audit'
  | 'housekeeping'
  | 'requests'
  | 'maintenance'
  | 'lostfound'
  | 'devices';

export const VIEW_IDS: readonly PmsView[] = ['dashboard', 'rack', 'arrivals', 'departures', 'inhouse', 'reservations', 'new', 'walkin', 'guests', 'cashier', 'audit', 'housekeeping', 'requests', 'maintenance', 'lostfound', 'devices'];

/** What a stay opens straight into, from the rack's quick actions. */
export type StayAct = 'charge' | 'move' | 'extend';
const ACTS: readonly string[] = ['charge', 'move', 'extend'];
const actOf = (v: string | null): StayAct | null => (v && ACTS.includes(v) ? (v as StayAct) : null);

export type Screen =
  | { kind: 'view'; view: PmsView | null; date: string | null; room: number | null; q: string | null }
  | { kind: 'reservation'; id: number }
  | { kind: 'checkin'; id: number }
  | { kind: 'checkout'; id: number }
  | { kind: 'stay'; id: number; folio: number | null; act?: StayAct | null }
  | { kind: 'folio'; id: number }
  | { kind: 'room'; id: number }
  | { kind: 'guest'; id: number }
  | { kind: 'shift'; id: number }
  | { kind: 'request'; id: number }
  | { kind: 'task'; id: number }
  | { kind: 'issue'; id: number }
  | { kind: 'lost'; id: number };

const num = (v: string | null | undefined): number | null => (v && /^\d{1,10}$/.test(v) && Number(v) > 0 ? Number(v) : null);
const ymd = (v: string | null | undefined): string | null => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

/** The screen a route names (`path` without the leading `pms`, or with it). */
export function screenOf(path: string[], query: URLSearchParams): Screen {
  const rest = path[0] === 'pms' ? path.slice(1) : path;
  const [a, b, c] = rest;
  const id = num(b);
  if (a === 'reservations' && id) {
    if (c === 'check-in') return { kind: 'checkin', id };
    if (c === 'check-out') return { kind: 'checkout', id };
    return { kind: 'reservation', id };
  }
  if (a === 'stays' && id) return { kind: 'stay', id, folio: num(query.get('folio')), act: actOf(query.get('act')) };
  if (a === 'folios' && id) return { kind: 'folio', id };
  if (a === 'rooms' && id) return { kind: 'room', id };
  if (a === 'guests' && id) return { kind: 'guest', id };
  if (a === 'cashier' && id) return { kind: 'shift', id };
  if (a === 'requests' && id) return { kind: 'request', id };
  if (a === 'housekeeping' && b === 'tasks' && num(c)) return { kind: 'task', id: num(c)! };
  if (a === 'maintenance' && id) return { kind: 'issue', id };
  if (a === 'lost-found' && id) return { kind: 'lost', id };

  // Records named in the query (a tab moving inside the module).
  const q = (k: string) => num(query.get(k));
  if (q('reservation')) return { kind: 'reservation', id: q('reservation')! };
  if (q('checkin')) return { kind: 'checkin', id: q('checkin')! };
  if (q('checkout')) return { kind: 'checkout', id: q('checkout')! };
  if (q('stay')) return { kind: 'stay', id: q('stay')!, folio: q('folio'), act: actOf(query.get('act')) };
  if (q('folio')) return { kind: 'folio', id: q('folio')! };
  if (q('guest')) return { kind: 'guest', id: q('guest')! };
  if (q('shift')) return { kind: 'shift', id: q('shift')! };

  const room = q('room');
  const date = ymd(query.get('date')) ?? ymd(query.get('arrivals'));
  const search = query.get('q');
  const asked = query.get('view');
  let view: PmsView | null = asked && (VIEW_IDS as readonly string[]).includes(asked) ? (asked as PmsView) : null;
  if (!view) {
    if (query.get('new') === '1') view = 'new';
    else if (a === 'front-desk') view = query.has('arrivals') ? 'arrivals' : 'rack';
    else if (a === 'housekeeping') view = 'housekeeping';
    else if (a === 'night-audit') view = 'audit';
    else if (a === 'cashier') view = 'cashier';
    else if (a === 'reservations') view = 'reservations';
    else if (a === 'dashboard') view = 'dashboard';
    else if (a === 'guests') view = 'guests';
    else if (a === 'requests') view = 'requests';
    else if (a === 'maintenance') view = 'maintenance';
    else if (a === 'lost-found') view = 'lostfound';
    else if (room) view = 'rack';
  }
  return { kind: 'view', view, date, room, q: search };
}

/** The address of a screen. Records have paths of their own, so a window or a link can open them. */
export function routeOf(s: Screen | { kind: 'view'; view: PmsView; date?: string | null; room?: number | null; q?: string | null }): string {
  switch (s.kind) {
    case 'reservation':
      return `/pms/reservations/${s.id}`;
    case 'checkin':
      return `/pms/reservations/${s.id}/check-in`;
    case 'checkout':
      return `/pms/reservations/${s.id}/check-out`;
    case 'stay': {
      const p = new URLSearchParams();
      if (s.folio) p.set('folio', String(s.folio));
      if (s.act) p.set('act', s.act);
      const t = p.toString();
      return `/pms/stays/${s.id}${t ? `?${t}` : ''}`;
    }
    case 'folio':
      return `/pms/folios/${s.id}`;
    case 'room':
      return `/pms/rooms/${s.id}`;
    case 'guest':
      return `/pms/guests/${s.id}`;
    case 'shift':
      return `/pms/cashier/${s.id}`;
    case 'request':
      return `/pms/requests/${s.id}`;
    case 'task':
      return `/pms/housekeeping/tasks/${s.id}`;
    case 'issue':
      return `/pms/maintenance/${s.id}`;
    case 'lost':
      return `/pms/lost-found/${s.id}`;
    default: {
      const p = new URLSearchParams();
      if (s.view) p.set('view', s.view);
      if (s.date) p.set('date', s.date);
      if (s.room) p.set('room', String(s.room));
      if (s.q) p.set('q', s.q);
      const t = p.toString();
      return t ? `/pms?${t}` : '/pms';
    }
  }
}

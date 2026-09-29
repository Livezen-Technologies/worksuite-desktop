import { useQuery } from '@tanstack/react-query';
import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { ErrorNote, Modal, Spinner, cx } from '../../components/ui';
import { call, isMac } from '../../core/bridge';
import { useTab, useTabTitle } from '../../core/tab-context';
import { toast } from '../../core/toasts';
import type { ModuleProps } from '../registry';
import { day, errorText, K, pGet, pGetMeta, useOnline, type Options, type Property } from './api';
import { PmsContext, SHORTCUTS, type Pms } from './parts';
import { routeOf, screenOf, type PmsView, type Screen } from './routes';
import { ShortcutContext, type Shortcut } from './shortcuts';

/**
 * Hotel PMS, native in WorkSuite Desktop: the front desk, the cashier and the
 * night audit (PMS-DSK-001) over the server's `/api/pms/v1`. The back office
 * — rates, rooms and room types, packages, taxes, reports, settings and the
 * set-up wizard — is the web's.
 *
 * Addresses: see `routes.ts`. The property is chosen in the rail and kept on
 * this computer; a record of another property moves the choice with it.
 */
const Rack = lazy(() => import('./Rack'));
const Lists = lazy(() => import('./Lists'));
const Dashboard = lazy(() => import('./Dashboard'));
const Reservations = lazy(() => import('./Reservations'));
const Reservation = lazy(() => import('./Reservation'));
const NewReservation = lazy(() => import('./NewReservation'));
const WalkIn = lazy(() => import('./WalkIn'));
const CheckIn = lazy(() => import('./CheckIn'));
const CheckOut = lazy(() => import('./CheckOut'));
const StayScreen = lazy(() => import('./Stay'));
const FolioScreen = lazy(() => import('./Folio'));
const Guests = lazy(() => import('./Guests'));
const GuestScreen = lazy(() => import('./Guest'));
const RoomScreen = lazy(() => import('./Room'));
const Cashier = lazy(() => import('./Cashier'));
const ShiftScreen = lazy(() => import('./Shift'));
const NightAudit = lazy(() => import('./NightAudit'));
const Housekeeping = lazy(() => import('./Housekeeping'));
const Requests = lazy(() => import('./Requests'));
const Devices = lazy(() => import('./Devices'));

type Group = 'desk' | 'bookings' | 'money' | 'overview' | 'this-desk';

const RACK_READ = ['pms.room.view', 'pms.reservation.view', 'pms.checkin', 'pms.room.manage'];

export const VIEWS: Record<PmsView, { label: string; icon: string; group: Group; needs: string[][] }> = {
  rack: { label: 'Room rack', icon: 'grid', group: 'desk', needs: [RACK_READ] },
  arrivals: { label: 'Arrivals', icon: 'log-in', group: 'desk', needs: [['pms.reservation.view', 'pms.checkin']] },
  departures: { label: 'Departures', icon: 'logout', group: 'desk', needs: [['pms.reservation.view', 'pms.checkout']] },
  inhouse: { label: 'In house', icon: 'bed', group: 'desk', needs: [['pms.reservation.view', 'pms.checkin', 'pms.checkout']] },
  housekeeping: { label: 'Housekeeping', icon: 'sparkles', group: 'desk', needs: [[...RACK_READ, 'pms.housekeeping.view', 'pms.housekeeping.manage']] },
  reservations: { label: 'Reservations', icon: 'list', group: 'bookings', needs: [['pms.reservation.view']] },
  new: { label: 'New reservation', icon: 'calendar-plus', group: 'bookings', needs: [['pms.reservation.create']] },
  walkin: { label: 'Walk-in', icon: 'user-plus', group: 'bookings', needs: [['pms.checkin'], ['pms.reservation.create']] },
  guests: { label: 'Guests', icon: 'users', group: 'bookings', needs: [['pms.guest.view']] },
  requests: { label: 'Guest requests', icon: 'concierge', group: 'bookings', needs: [['pms.guest_request.manage', 'pms.reservation.view']] },
  cashier: { label: 'Cashier', icon: 'wallet', group: 'money', needs: [['pms.cashier.open', 'pms.cashier.close', 'pms.payment.view']] },
  audit: { label: 'Night audit', icon: 'moon', group: 'money', needs: [['pms.night_audit.execute', 'pms.night_audit.override', 'pms.reports.view']] },
  dashboard: { label: 'Dashboard', icon: 'chart', group: 'overview', needs: [['pms.dashboard.view']] },
  devices: { label: 'Desk devices', icon: 'printer', group: 'this-desk', needs: [] },
};

const HEADINGS: Record<Group, string | null> = { desk: 'Front desk', bookings: 'Reservations & guests', money: 'Cashier & close', overview: 'Overview', 'this-desk': 'This desk' };
const ORDER: PmsView[] = ['rack', 'arrivals', 'dashboard', 'reservations', 'cashier', 'audit', 'housekeeping', 'guests', 'devices'];
const TITLES: Record<Exclude<Screen['kind'], 'view'>, string> = {
  reservation: 'Reservation', checkin: 'Check-in', checkout: 'Check-out', stay: 'In house', folio: 'Folio', room: 'Room', guest: 'Guest', shift: 'Cashier shift', request: 'Guest request',
};

const PROPERTY_KEY = 'pms.property';

function savedProperty(): number | null {
  try {
    const v = Number(localStorage.getItem(PROPERTY_KEY));
    return Number.isInteger(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

function keepProperty(id: number): void {
  try {
    localStorage.setItem(PROPERTY_KEY, String(id));
  } catch {
    /* a convenience */
  }
}

/** Whether a person holding `perms` may open a view: every group of `needs` has one they hold. */
export function mayOpen(view: PmsView, perms: readonly string[]): boolean {
  return VIEWS[view].needs.every((any) => any.some((p) => perms.includes(p)));
}

/** Alt+letter, read from the key's place (Alt+N on a Mac types a letter of its own). */
const ALT_KEYS: Record<string, Shortcut> = { KeyN: 'new', KeyW: 'walkin', KeyF: 'search', KeyI: 'checkin', KeyP: 'charge', KeyR: 'rack', KeyA: 'arrivals', KeyD: 'departures', KeyH: 'inhouse' };

export default function PmsShell({ active }: ModuleProps) {
  const { query, path, go: goRoute, openInWindow } = useTab();
  const online = useOnline();
  const [picked, setPicked] = useState<number | null>(savedProperty);
  const [help, setHelp] = useState(false);
  const search = useRef<HTMLInputElement>(null);
  const [handlers] = useState(() => new Map<Shortcut, () => boolean>());

  const properties = useQuery({ queryKey: K.properties, queryFn: ({ signal }) => pGetMeta<{ items: Property[] }>('/properties', undefined, signal) });
  const list = useMemo(() => properties.data?.data.items ?? [], [properties.data]);
  const property = list.find((p) => p.id === picked) ?? list.find((p) => p.status === 'active') ?? list[0] ?? null;
  const options = useQuery({
    queryKey: K.options(property?.org_id ?? 0, property?.id ?? 0),
    queryFn: ({ signal }) => pGet<Options>('/options', { org: property!.org_id, property_id: property!.id }, signal),
    enabled: !!property,
  });
  const opts = options.data;
  const screen = screenOf(path, query);
  const perms = opts?.permissions ?? [];
  const firstView = ORDER.find((v) => mayOpen(v, perms)) ?? 'devices';
  const view: PmsView = screen.kind === 'view' && screen.view && mayOpen(screen.view, perms) ? screen.view : firstView;
  const title = screen.kind === 'view' ? VIEWS[view].label : TITLES[screen.kind];
  useTabTitle(`Hotel PMS · ${title}`);

  // PMS-WEB-003 on the desktop: Alt+letter while this tab is the one in front.
  useEffect(() => {
    if (!active || !opts) return;
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const s = ALT_KEYS[e.code];
      if (!s) return;
      // On a Mac, Option+letter types a character (ñ, é…): in a field it is left to the field.
      if (isMac && e.target instanceof Element && e.target.closest('input, textarea, [contenteditable="true"]')) return;
      e.preventDefault();
      if (handlers.get(s)?.()) return;
      const p = opts.permissions;
      if (s === 'search') search.current?.focus();
      else if (s === 'new' && mayOpen('new', p)) goRoute(routeOf({ kind: 'view', view: 'new' }));
      else if (s === 'walkin' && mayOpen('walkin', p)) goRoute(routeOf({ kind: 'view', view: 'walkin' }));
      else if ((s === 'rack' || s === 'arrivals' || s === 'departures' || s === 'inhouse') && mayOpen(s, p)) goRoute(routeOf({ kind: 'view', view: s }));
      else if (s === 'checkin' && mayOpen('arrivals', p)) goRoute(routeOf({ kind: 'view', view: 'arrivals' }));
      else if (s === 'charge') toast('info', 'Open a guest in house, or a folio, to post a charge.');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, opts, goRoute, handlers]);

  if (properties.isLoading || (property && options.isLoading)) return <Spinner label="Opening Hotel PMS…" />;
  if (properties.error) {
    return (
      <div className="p-6">
        <ErrorNote error={properties.error} onRetry={() => void properties.refetch()} />
      </div>
    );
  }
  if (!property) {
    return (
      <div className="p-6">
        <div className="flex items-start gap-3 rounded-[12px] border border-line bg-surface p-5">
          <Icon name="bed" size={20} className="mt-0.5 text-primary" />
          <div>
            <h1 className="m-0 text-[15px] font-bold text-ink">No hotel property is open to you</h1>
            <p className="mt-1 mb-0 text-[13px] text-ink-2">Properties are set up on the web, and each person is given the properties they work at. Ask whoever manages Hotel PMS in your company.</p>
          </div>
        </div>
      </div>
    );
  }
  if (options.error || !opts) {
    return (
      <div className="p-6">
        <ErrorNote error={options.error ?? new Error('Hotel PMS could not be loaded.')} onRetry={() => void options.refetch()} />
      </div>
    );
  }

  const may = (perm: string) => opts.permissions.includes(perm);
  const choose = (id: number) => {
    setPicked(id);
    keepProperty(id);
  };
  const pms: Pms = {
    property,
    options: opts,
    businessDate: opts.business_date?.business_date ?? property.business_date ?? '',
    may,
    mayAny: (...p) => p.some(may),
    online,
    go: (v, params) => goRoute(routeOf({ kind: 'view', view: v, ...params })),
    open: (s) => goRoute(routeOf(s)),
    openWindow: (s, t) => openInWindow(routeOf(s), t),
    adopt: (id) => {
      if (id !== property.id && list.some((p) => p.id === id)) choose(id);
    },
    back: () => goRoute(routeOf({ kind: 'view', view })),
  };
  const bd = opts.business_date;
  const groups: Group[] = ['desk', 'bookings', 'money', 'overview', 'this-desk'];
  const current = screen.kind === 'view' ? view : null;

  const body: ReactNode = (() => {
    switch (screen.kind) {
      case 'reservation':
        return <Reservation key={`r${screen.id}`} id={screen.id} />;
      case 'checkin':
        return <CheckIn key={`ci${screen.id}`} id={screen.id} />;
      case 'checkout':
        return <CheckOut key={`co${screen.id}`} id={screen.id} />;
      case 'stay':
        return <StayScreen key={`s${screen.id}`} id={screen.id} folio={screen.folio} act={screen.act ?? null} />;
      case 'folio':
        return <FolioScreen key={`f${screen.id}`} id={screen.id} />;
      case 'room':
        return <RoomScreen key={`rm${screen.id}`} id={screen.id} />;
      case 'guest':
        return <GuestScreen key={`g${screen.id}`} id={screen.id} />;
      case 'shift':
        return <ShiftScreen key={`sh${screen.id}`} id={screen.id} />;
      case 'request':
        return <Requests key={`rq${screen.id}`} open={screen.id} />;
      default:
        break;
    }
    const date = screen.kind === 'view' ? screen.date : null;
    switch (view) {
      case 'rack':
        return <Rack room={screen.kind === 'view' ? screen.room : null} />;
      case 'arrivals':
      case 'departures':
      case 'inhouse':
        return <Lists key={view} list={view} date={date} />;
      case 'dashboard':
        return <Dashboard />;
      case 'reservations':
        return <Reservations seed={screen.kind === 'view' ? screen.q : null} />;
      case 'new':
        return <NewReservation room={screen.kind === 'view' ? screen.room : null} />;
      case 'walkin':
        return <WalkIn room={screen.kind === 'view' ? screen.room : null} />;
      case 'guests':
        return <Guests />;
      case 'requests':
        return <Requests open={null} />;
      case 'cashier':
        return <Cashier />;
      case 'audit':
        return <NightAudit />;
      case 'housekeeping':
        return <Housekeeping room={screen.kind === 'view' ? screen.room : null} />;
      default:
        return <Devices />;
    }
  })();

  return (
    <PmsContext.Provider value={pms}>
      <ShortcutContext.Provider value={handlers}>
        <div className="flex h-full min-h-0">
          <nav aria-label="Hotel PMS" className="flex w-[228px] shrink-0 flex-col overflow-hidden border-r border-line bg-[#FBFBFD] text-[13px] text-ink dark:bg-surface">
            <div className="flex flex-col gap-2 px-2.5 pt-3.5 pb-1">
              <div className="flex items-center gap-2 px-1">
                <span className="grid size-8 place-items-center rounded-[10px] bg-selection text-primary">
                  <Icon name="bed" size={17} />
                </span>
                <div className="min-w-0">
                  <b className="block text-[13.5px]">Hotel PMS</b>
                  <span className="block truncate text-[11px] text-ink-3">{property.name}</span>
                </div>
              </div>
              {list.length > 1 ? (
                <Select
                  aria-label="Property"
                  value={String(property.id)}
                  onChange={(e) => choose(Number(e.target.value))}
                  options={list.map((p) => ({ value: String(p.id), label: `${p.name}${p.status !== 'active' ? ` (${p.status_label.toLowerCase()})` : ''}` }))}
                  className="h-8 rounded-[8px] border border-line bg-surface px-2 text-[12px] font-semibold text-ink"
                />
              ) : null}
              <div className="flex items-center gap-1.5 rounded-[8px] bg-subtle px-2 py-1 text-[11.5px] text-ink-2" title="Today for the desk moves on only with the night audit">
                <Icon name="calendar" size={13} className="text-ink-3" />
                <span className="min-w-0 flex-1 truncate">
                  Business date <b className="text-ink">{bd?.business_date ? day(bd.business_date, true) : '—'}</b>
                </span>
                {bd?.status && bd.status !== 'open' ? <span className="font-semibold text-warning">{bd.status_label}</span> : null}
              </div>
              {may('pms.reservation.view') ? (
                <form
                  role="search"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const q = search.current?.value.trim() ?? '';
                    if (q.length >= 2) pms.go('reservations', { q });
                  }}
                >
                  <input
                    ref={search}
                    type="search"
                    aria-label="Search reservations"
                    placeholder="Guest, confirmation, room, phone"
                    className="h-8 w-full rounded-[8px] border border-line bg-surface px-2.5 text-[12px] text-ink outline-none placeholder:text-ink-3 focus:border-primary"
                  />
                </form>
              ) : null}
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-px overflow-y-auto px-2.5 pb-3 scroll-thin">
              {groups.map((grp) => {
                const items = (Object.keys(VIEWS) as PmsView[]).filter((v) => VIEWS[v].group === grp && mayOpen(v, opts.permissions));
                if (items.length === 0) return null;
                return (
                  <div key={grp} className="flex flex-col gap-px">
                    {HEADINGS[grp] ? <div className="mt-3 mb-0.5 px-2 text-[10.5px] font-bold tracking-[.6px] text-ink-3 uppercase">{HEADINGS[grp]}</div> : null}
                    {items.map((v) => {
                      const on = current === v;
                      return (
                        <button
                          key={v}
                          type="button"
                          aria-current={on ? 'page' : undefined}
                          onClick={() => pms.go(v)}
                          className={cx('relative flex h-[30px] shrink-0 items-center gap-[9px] rounded-[8px] pr-2 pl-2.5 text-left', on ? 'bg-[#EAEDFB] font-bold text-[#1B2A85] dark:bg-selection dark:text-primary' : 'font-medium text-ink hover:bg-subtle')}
                        >
                          <span className={cx('absolute top-1.5 bottom-1.5 left-0 w-[3px] rounded-r-[3px]', on ? 'bg-primary' : 'bg-transparent')} />
                          <Icon name={VIEWS[v].icon} size={16} className={cx('shrink-0', on ? 'text-primary' : 'text-ink-3')} />
                          <span className="min-w-0 flex-1 truncate">{VIEWS[v].label}</span>
                        </button>
                      );
                    })}
                  </div>
                );
              })}
              <div className="mt-3 flex flex-col gap-px border-t border-line pt-2">
                <button type="button" onClick={() => setHelp(true)} className="flex h-[30px] items-center gap-[9px] rounded-[8px] px-2.5 text-left font-medium text-ink-2 hover:bg-subtle">
                  <Icon name="keyboard" size={16} className="text-ink-3" /> Keyboard shortcuts
                </button>
                <button
                  type="button"
                  onClick={() => void call('app:openInBrowser', { path: '/pms' }).catch((e) => toast('error', errorText(e)))}
                  className="flex h-[30px] items-center gap-[9px] rounded-[8px] px-2.5 text-left font-medium text-ink-2 hover:bg-subtle"
                  title="Rates, rooms, packages, taxes, reports, settings and the set-up wizard"
                >
                  <Icon name="external" size={16} className="text-ink-3" /> Back office on the web
                </button>
              </div>
            </div>
          </nav>
          <main className="min-w-0 flex-1 overflow-y-auto bg-ground scroll-thin" aria-label={`Hotel PMS · ${title}`}>
            {!online ? (
              <div role="status" className="flex items-center gap-2 border-b border-line bg-warning-bg px-6 py-1.5 text-[12.5px] font-medium text-warning">
                <Icon name="cloud-off" size={14} />
                Offline — the room rack, arrivals, departures and in-house list are the last copy. Check-ins, payments, charges and new bookings wait until WorkSuite is back.
              </div>
            ) : null}
            {property.status !== 'active' ? (
              <div className="border-b border-line bg-selection px-6 py-1.5 text-[12.5px] font-medium text-primary">
                {property.name} is {property.status === 'setup' ? 'being set up on the web: nothing is booked before it is active.' : 'inactive: its records stay, but nothing new is booked.'}
              </div>
            ) : null}
            <Suspense fallback={<Spinner />}>{body}</Suspense>
          </main>
        </div>
        {help ? (
          <Modal title="Keyboard shortcuts" onClose={() => setHelp(false)} width={440}>
            <table className="w-full text-[13px]">
              <tbody>
                {SHORTCUTS.map(([k, what]) => (
                  <tr key={k} className="border-b border-line last:border-b-0">
                    <td className="py-1.5 pr-3 font-mono text-[12px] font-semibold whitespace-nowrap">{k}</td>
                    <td className="py-1.5 text-ink-2">{what}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Modal>
        ) : null}
      </ShortcutContext.Provider>
    </PmsContext.Provider>
  );
}

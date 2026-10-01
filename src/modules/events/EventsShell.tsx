import { useQuery } from '@tanstack/react-query';
import { lazy, Suspense, useMemo, type ReactNode } from 'react';
import { Icon } from '../../components/Icon';
import { Empty, ErrorNote, Spinner, cx } from '../../components/ui';
import { useTab, useTabTitle } from '../../core/tab-context';
import type { ModuleProps } from '../registry';
import { at, eGet, K, statusOf, useOnline, type EventItem, type Options, type Paged } from './api';
import { useDeskChanged, useDesks } from './desk';
import { EventContext, NoAccess, type EventCtx } from './parts';
import { routeOf, screenOf, type EventView, type Screen } from './routes';
import { SidePanel } from '../../components/SidePanel';

/**
 * WorkSuite Events on the desktop: the Event Desk (Events SRS §15.2 [D] —
 * check-in desk, walk-in registration, badge printing, scanner input, fast
 * search, offline check-in, local printing, the operations view) and the
 * organiser's read of an event (Event 360, registrations, attendees, the
 * day's program), over the server's `/api/events/v1`. Planning — creating and
 * editing events, tickets, forms, the schedule, screens, badge templates,
 * gates and devices — is the web's.
 *
 * Addresses: see `routes.ts`. What each person sees follows their `events.*`
 * permissions in the event's company (`GET options?org=`).
 */
const Desk = lazy(() => import('./DeskScreen'));
const Counters = lazy(() => import('./Counters'));
const Setup = lazy(() => import('./Setup'));
const Review = lazy(() => import('./Review'));
const Recent = lazy(() => import('./Recent'));
const Program = lazy(() => import('./Program'));
const Badges = lazy(() => import('./Badges'));
const Overview = lazy(() => import('./Overview'));
const Registrations = lazy(() => import('./Registrations'));
const RegistrationScreen = lazy(() => import('./Registration'));
const Attendees = lazy(() => import('./Attendees'));
const AttendeeScreen = lazy(() => import('./Attendee'));

type Group = 'desk' | 'event' | 'this';

export const VIEWS: Record<EventView, { label: string; icon: string; group: Group; needs: string[] }> = {
  desk: { label: 'Check-in desk', icon: 'scan', group: 'desk', needs: ['events.checkin.use', 'events.checkout.use'] },
  counters: { label: 'Live counters', icon: 'chart', group: 'desk', needs: ['events.checkin.use'] },
  review: { label: 'To review', icon: 'warning', group: 'desk', needs: ['events.checkin.use'] },
  recent: { label: 'Recent scans', icon: 'history', group: 'desk', needs: ['events.checkin.use'] },
  program: { label: 'Today’s program', icon: 'calendar-clock', group: 'desk', needs: ['events.checkin.use', 'events.session.view'] },
  badges: { label: 'Badges', icon: 'printer', group: 'desk', needs: ['events.badge.print'] },
  overview: { label: 'Event 360', icon: 'activity', group: 'event', needs: ['events.event.view'] },
  registrations: { label: 'Registrations', icon: 'list', group: 'event', needs: ['events.registration.view'] },
  attendees: { label: 'Attendees', icon: 'users', group: 'event', needs: ['events.registration.view'] },
  setup: { label: 'This computer', icon: 'laptop', group: 'this', needs: [] },
};

const HEADINGS: Record<Group, string> = { desk: 'Event desk', event: 'The event', this: 'This desk' };
const ORDER: EventView[] = ['desk', 'overview', 'registrations', 'program', 'setup'];

/** Whether a person holding `perms` may open a view: one of its permissions (or none needed). */
export function mayOpen(view: EventView, perms: readonly string[]): boolean {
  const needs = VIEWS[view].needs;
  return needs.length === 0 || needs.some((p) => perms.includes(p));
}

export default function EventsShell({ active }: ModuleProps) {
  const { path, query, go: goRoute, openInWindow } = useTab();
  const screen = screenOf(path, query);
  useDeskChanged();
  const eventId = screen.kind === 'event' ? screen.id : screen.kind === 'registration' ? screen.event : screen.kind === 'attendee' ? screen.event : null;

  if (screen.kind === 'attendee' && !screen.event) {
    return (
      <main className="h-full overflow-y-auto bg-ground scroll-thin">
        <Suspense fallback={<Spinner />}>
          <AttendeeScreen id={screen.id} />
        </Suspense>
      </main>
    );
  }
  if (!eventId) return <EventList onOpen={(id) => goRoute(`/events/${id}`)} />;
  return <EventShell key={eventId} id={eventId} screen={screen} active={active} goRoute={goRoute} openInWindow={openInWindow} />;
}

function EventShell({ id, screen, active, goRoute, openInWindow }: { id: number; screen: Screen; active: boolean; goRoute: (r: string) => void; openInWindow: (r: string, t?: string) => void }) {
  const online = useOnline();
  const desks = useDesks();
  const registered = desks.data?.find((d) => d.event_id === id) ?? null;
  const event = useQuery({ queryKey: K.event(id), queryFn: ({ signal }) => eGet<EventItem>(`/events/${id}`, undefined, signal), retry: false });
  const org = event.data?.org_id ?? registered?.org_id ?? null;
  const options = useQuery({ queryKey: K.options(org ?? 0), queryFn: ({ signal }) => eGet<Options>('/options', { org }, signal), enabled: org !== null });
  const perms = useMemo(() => options.data?.permissions ?? [], [options.data]);
  const asked = screen.kind === 'event' ? screen.view : null;
  const firstView: EventView = ORDER.find((v) => mayOpen(v, perms)) ?? 'setup';
  const view: EventView = asked && mayOpen(asked, perms) ? asked : firstView;
  const name = event.data?.name ?? registered?.event_name ?? 'Event';
  const title = screen.kind === 'registration' ? 'Registration' : screen.kind === 'attendee' ? 'Attendee' : VIEWS[view].label;
  useTabTitle(`${name} · ${title}`);

  if (event.isLoading || (org !== null && options.isLoading)) return <Spinner label="Opening the event…" />;
  if (event.error && !registered) {
    return statusOf(event.error) === 404 || statusOf(event.error) === 403 ? (
      <NoAccess what="This event is not open to you. Check-in needs the event in your data scope and permission to see it (Events → the event, events.event.view); ask whoever runs Events in your company." />
    ) : (
      <div className="p-6">
        <ErrorNote error={event.error} onRetry={() => void event.refetch()} />
      </div>
    );
  }
  const ev: EventItem =
    event.data ??
    ({ id, org_id: org ?? 0, code: '', name, summary: null, type_label: null, delivery_mode: '', status: '', status_label: '', registration_state_label: null, display_label: null, timezone: '', start: null, end: null, capacity: null, version: 0 } as EventItem);
  const opts: Options = options.data ?? { permissions: [] };
  const may = (p: string) => opts.permissions.includes(p);
  const ctx: EventCtx = {
    event: ev,
    options: opts,
    may,
    mayAny: (...p) => p.some(may),
    online,
    go: (v, list) => goRoute(routeOf({ kind: 'event', id, view: v, list: list ?? null })),
    open: (s) => goRoute(routeOf(s)),
    openWindow: (v, t) => openInWindow(routeOf({ kind: 'event', id, view: v }), t),
  };
  const current = screen.kind === 'event' ? view : null;

  const body: ReactNode = (() => {
    if (screen.kind === 'registration') return <RegistrationScreen key={`r${screen.id}`} id={screen.id} />;
    if (screen.kind === 'attendee') return <AttendeeScreen key={`a${screen.id}`} id={screen.id} />;
    switch (view) {
      case 'desk':
        return <Desk active={active} />;
      case 'counters':
        return <Counters />;
      case 'review':
        return <Review />;
      case 'recent':
        return <Recent />;
      case 'program':
        return <Program />;
      case 'badges':
        return <Badges />;
      case 'overview':
        return <Overview />;
      case 'registrations':
        return <Registrations list={screen.kind === 'event' ? screen.list : null} />;
      case 'attendees':
        return <Attendees />;
      default:
        return <Setup />;
    }
  })();

  /* The counters in a window of their own, on a second screen: just the counters. */
  const bare = screen.kind === 'event' && view === 'counters' && window.location.hash.startsWith('#/window/');

  return (
    <EventContext.Provider value={ctx}>
      <div className="flex h-full min-h-0">
        {!bare ? (
          <SidePanel id="events" label="the event menu">
            <nav aria-label="Events" className="flex w-[228px] shrink-0 flex-col overflow-hidden border-r border-line bg-[#FBFBFD] text-[13px] text-ink dark:bg-surface">
              <div className="flex flex-col gap-2 px-2.5 pt-3.5 pb-1">
                <button type="button" onClick={() => goRoute('/events')} className="flex items-center gap-1 px-1 text-left text-[11.5px] font-semibold text-ink-3 hover:text-ink">
                  <Icon name="back" size={13} /> All events
                </button>
                <div className="flex items-center gap-2 px-1">
                  <span className="grid size-8 shrink-0 place-items-center rounded-[10px] bg-selection text-primary">
                    <Icon name="ticket" size={17} />
                  </span>
                  <div className="min-w-0">
                    <b className="block truncate text-[13.5px]" title={name}>
                      {name}
                    </b>
                    <span className="block truncate text-[11px] text-ink-3">{[ev.status_label, ev.start ? at(ev.start) : null].filter(Boolean).join(' · ') || ' '}</span>
                  </div>
                </div>
                {registered ? (
                  <div className="flex items-center gap-1.5 rounded-[8px] bg-subtle px-2 py-1 text-[11.5px] text-ink-2" title="This computer is a check-in device at the event">
                    <Icon name="laptop" size={13} className="text-ink-3" />
                    <span className="min-w-0 flex-1 truncate">
                      {registered.device_name}
                      {registered.gate_name ? ` · ${registered.gate_name}` : ''}
                    </span>
                  </div>
                ) : null}
              </div>
              <div className="flex min-h-0 flex-1 flex-col gap-px overflow-y-auto px-2.5 pb-3 scroll-thin">
                {(['desk', 'event', 'this'] as Group[]).map((grp) => {
                  const items = (Object.keys(VIEWS) as EventView[]).filter((v) => VIEWS[v].group === grp && mayOpen(v, opts.permissions));
                  if (items.length === 0) return null;
                  return (
                    <div key={grp} className="flex flex-col gap-px">
                      <div className="mt-3 mb-0.5 px-2 text-[10.5px] font-bold tracking-[.6px] text-ink-3 uppercase">{HEADINGS[grp]}</div>
                      {items.map((v) => {
                        const on = current === v;
                        return (
                          <button
                            key={v}
                            type="button"
                            aria-current={on ? 'page' : undefined}
                            onClick={() => ctx.go(v)}
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
                {may('events.checkin.use') ? (
                  <div className="mt-3 flex flex-col gap-px border-t border-line pt-2">
                    <button type="button" onClick={() => ctx.openWindow('counters', `${name} · Live counters`)} className="flex h-[30px] items-center gap-[9px] rounded-[8px] px-2.5 text-left font-medium text-ink-2 hover:bg-subtle" title="The counters on a screen of their own">
                      <Icon name="app-window" size={16} className="text-ink-3" /> Counters in a window
                    </button>
                  </div>
                ) : null}
              </div>
            </nav>
          </SidePanel>
        ) : null}
        <main className="min-w-0 flex-1 overflow-y-auto bg-ground scroll-thin" aria-label={`${name} · ${title}`}>
          {!online && view !== 'desk' ? (
            <div role="status" className="flex items-center gap-2 border-b border-line bg-warning-bg px-6 py-1.5 text-[12.5px] font-medium text-warning">
              <Icon name="cloud-off" size={14} />
              Offline — the check-in desk works from this computer’s copy of the event; everything else waits for WorkSuite.
            </div>
          ) : null}
          <Suspense fallback={<Spinner />}>{body}</Suspense>
        </main>
      </div>
    </EventContext.Provider>
  );
}

/** The events this person reaches: live ones first, then those to come, then the rest (the server's order within each). */
function EventList({ onOpen }: { onOpen: (id: number) => void }) {
  useTabTitle('Events');
  const desks = useDesks();
  const list = useQuery({ queryKey: K.events, queryFn: ({ signal }) => eGet<Paged<EventItem>>('/events', { per_page: 100, sort: 'start' }, signal) });
  const items = list.data?.items ?? [];
  const groups: Array<[string, EventItem[]]> = [
    ['Live now', items.filter((e) => e.status === 'LIVE')],
    ['Coming up', items.filter((e) => e.status === 'PUBLISHED')],
    ['Planning', items.filter((e) => e.status === 'DRAFT' || e.status === 'PLANNING')],
    ['Past', items.filter((e) => ['COMPLETED', 'CANCELLED', 'ARCHIVED'].includes(e.status))],
  ];
  const mine = desks.data ?? [];
  return (
    <main className="h-full overflow-y-auto bg-ground px-6 py-5 scroll-thin" aria-label="Events">
      <h1 className="m-0 text-[20px] font-bold text-ink">Events</h1>
      <p className="mt-1 mb-4 text-[12.5px] text-ink-2">Choose an event to run its check-in desk, print badges or read its registrations. Events are planned on the web.</p>
      {mine.length > 0 ? (
        <section className="mb-5">
          <h2 className="mb-2 text-[11px] font-bold tracking-[.6px] text-ink-3 uppercase">This computer is a check-in device at</h2>
          <div className="flex flex-wrap gap-2">
            {mine.map((d) => (
              <button key={d.event_id} type="button" onClick={() => onOpen(d.event_id)} className="flex items-center gap-2 rounded-[10px] border border-line bg-surface px-3 py-2 text-left text-[13px] hover:border-primary">
                <Icon name="scan" size={16} className="text-primary" />
                <span>
                  <b className="block">{d.event_name}</b>
                  <span className="text-[11.5px] text-ink-3">
                    {d.device_name}
                    {d.gate_name ? ` · ${d.gate_name}` : ''}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </section>
      ) : null}
      {list.isLoading ? <Spinner /> : null}
      {list.error ? <ErrorNote error={list.error} onRetry={() => void list.refetch()} /> : null}
      {list.data && items.length === 0 ? (
        <Empty icon="ticket" title="No event is open to you" hint="Events you may see appear here. Ask whoever runs Events in your company to give you the events you work at." />
      ) : null}
      {groups.map(([label, evs]) =>
        evs.length === 0 ? null : (
          <section key={label} className="mb-5">
            <h2 className="mb-2 text-[11px] font-bold tracking-[.6px] text-ink-3 uppercase">{label}</h2>
            <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-2 p-0">
              {evs.map((e) => (
                <li key={e.id}>
                  <button type="button" onClick={() => onOpen(e.id)} className="flex w-full flex-col gap-1 rounded-[12px] border border-line bg-surface px-4 py-3 text-left hover:border-primary">
                    <span className="flex items-center justify-between gap-2">
                      <b className="truncate text-[14px] text-ink">{e.name}</b>
                      <span className={cx('shrink-0 rounded-[6px] px-1.5 text-[11px] font-semibold', e.status === 'LIVE' ? 'bg-success-bg text-success' : 'bg-subtle text-ink-2')}>{e.display_label ?? e.status_label}</span>
                    </span>
                    <span className="text-[12px] text-ink-2">
                      {at(e.start)}
                      {e.end ? ` – ${at(e.end)}` : ''}
                      {e.type_label ? ` · ${e.type_label}` : ''}
                    </span>
                    {e.counts ? (
                      <span className="text-[11.5px] text-ink-3">
                        {e.counts.confirmed} confirmed of {e.counts.registered} registered
                      </span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ),
      )}
    </main>
  );
}

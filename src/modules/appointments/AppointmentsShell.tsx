import { useQuery, useQueryClient } from '@tanstack/react-query';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { app } from '../../core/app-state';
import { call, on } from '../../core/bridge';
import { useStore } from '../../core/store';
import { useTab, useTabTitle } from '../../core/tab-context';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Spinner } from '../../components/ui';
import type { ModuleProps } from '../registry';
import { fetchDashboard, fetchOptions, K, laneOf, today } from './api';
import { DeskCtx, useOnline, type Desk } from './parts';
import { readDesk, writeDesk } from './print';
import { Rail, TITLES, VIEWS, type View } from './Rail';

/**
 * Appointments on the desktop (Appointments SRS v1.0 §9, the desktop boards D01–D24), addressed as
 * `/appointments?tab=<view>` with `&apt=<id>` for the appointment in the side panel (D08), `&client=`, `&date=`.
 * A web link `/appointments/<id>` (a notification's) opens that appointment in the panel over Today.
 *
 * Desk keys (D24), while this tab is in front and nothing is being typed: N new appointment, F2 walk-in, T today,
 * ⌘J the command palette, Esc closes the panel. Every figure and every check is the server's (api.ts).
 */
const Today = lazy(() => import('./Today'));
const Calendar = lazy(() => import('./Calendar'));
const List = lazy(() => import('./List'));
const WalkIn = lazy(() => import('./WalkIn'));
const Clients = lazy(() => import('./Clients'));
const ClientHistory = lazy(() => import('./ClientHistory'));
const Waitlist = lazy(() => import('./Waitlist'));
const Outbox = lazy(() => import('./Outbox'));
const Reports = lazy(() => import('./Reports'));
const Commission = lazy(() => import('./Commission'));
const Setup = lazy(() => import('./Setup'));
const Checkout = lazy(() => import('./Checkout'));
const DeskSettings = lazy(() => import('./DeskSettings'));
const Alerts = lazy(() => import('./Alerts'));
const DaySheet = lazy(() => import('./DaySheet'));
const Panel = lazy(() => import('./Panel'));
const NewAppointment = lazy(() => import('./NewAppointment'));
const Palette = lazy(() => import('./Palette'));

const num = (v: string | null | undefined) => (v && /^\d{1,12}$/.test(v) ? Number(v) : null);
const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

export default function AppointmentsShell({ active }: ModuleProps) {
  const { query, path, go, openInNewTab } = useTab();
  const online = useOnline();
  const qc = useQueryClient();
  const me = useStore(app, (s) => (s.auth?.user as { name?: string } | undefined)?.name ?? '');
  // `/appointments/123` (a web link) is that appointment over Today.
  const pathId = num(path[1]);
  const asked = query.get('tab') ?? (pathId ? 'today' : 'today');
  const view: View = VIEWS.has(asked) ? (asked as View) : 'today';
  const apt = num(query.get('apt')) ?? pathId;
  const clientId = num(query.get('client'));
  useTabTitle(`Appointments · ${TITLES[view]}`);

  const options = useQuery({ queryKey: K.options, queryFn: ({ signal }) => fetchOptions(signal), staleTime: 10 * 60_000 });
  const [desk, setDesk] = useState(readDesk);
  const location = desk.location && options.data?.locations.some((l) => l.id === desk.location) ? desk.location : (options.data?.locations[0]?.id ?? null);
  const locName = options.data?.locations.find((l) => l.id === location)?.name ?? null;

  const outbox = useQuery({
    queryKey: K.outbox,
    queryFn: async () => (await call('offline:pending')).filter((m) => m.module === 'appointments'),
    networkMode: 'always',
    retry: false,
  });
  useEffect(() => on('offline:changed', () => void qc.invalidateQueries({ queryKey: K.outbox })), [qc]);
  // Back online: what the outbox sent changes the day, so the screens ask again.
  useEffect(() => {
    if (online) void qc.invalidateQueries({ queryKey: K.all });
  }, [online, qc]);

  const keepRef = useRef<(patch: Record<string, string | null>) => void>(() => undefined);
  // D20 "Running late": once per appointment, a note on this desk when a booked client is past their start.
  const day = today();
  const dash = useQuery({ queryKey: K.dashboard(day), queryFn: ({ signal }) => fetchDashboard(day, signal), refetchInterval: 60_000, enabled: desk.alertLate && online });
  const told = useRef(new Set<number>());
  useEffect(() => {
    if (!desk.alertLate || !dash.data) return;
    for (const a of dash.data.late) {
      if (told.current.has(a.id) || laneOf(a) !== 'arriving' || (location && a.location.id !== location)) continue;
      told.current.add(a.id);
      toast('warning', `${a.customer.name} (${a.local.start}, ${a.provider.name}) has not arrived.`, { label: 'Open', run: () => keepRef.current({ apt: String(a.id) }) });
    }
  }, [dash.data, desk.alertLate, location]);

  const [booking, setBooking] = useState<Parameters<Desk['book']>[0] | false>(false);
  const [palette, setPalette] = useState(false);

  // `&new=1` (the quick action): New appointment over Today.
  const askNew = query.get('new') === '1';

  const route = useCallback((v: View, extra = '') => `/appointments?tab=${v}${extra}`, []);
  const to = useCallback((v: View, extra = '', newTab = false) => (newTab ? openInNewTab(route(v, extra), `Appointments · ${TITLES[v]}`) : go(route(v, extra))), [go, openInNewTab, route]);
  const keep = useCallback(
    (patch: Record<string, string | null>) => {
      const q = new URLSearchParams(query);
      q.set('tab', view);
      q.delete('new');
      for (const [k, v] of Object.entries(patch)) {
        if (v === null) q.delete(k);
        else q.set(k, v);
      }
      go(`/appointments?${q.toString()}`);
    },
    [go, query, view],
  );


  useEffect(() => {
    keepRef.current = keep;
  }, [keep]);

  const ctx: Desk = useMemo(
    () => ({
      online,
      options: options.data ?? null,
      location,
      setLocation: (id) => {
        const next = { ...desk, location: id };
        setDesk(next);
        writeDesk(next);
      },
      open: (id) => keep({ apt: String(id) }),
      client: (id) => to('client', `&client=${id}`),
      checkout: (id) => to('checkout', `&apt=${id}`),
      book: (prefill) => setBooking(prefill ?? {}),
      walkIn: () => to('walkin'),
      me,
    }),
    [online, options.data, location, desk, keep, to, me],
  );

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'j') {
        e.preventDefault();
        setPalette(true);
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey || typing(e.target) || document.querySelector('[role="dialog"]')) return;
      if (e.key === 'F2') {
        e.preventDefault();
        to('walkin');
      } else if (e.key === 'n' || e.key === 'N') {
        if (!online) return;
        e.preventDefault();
        setBooking({});
      } else if ((e.key === 't' || e.key === 'T') && view !== 'calendar') {
        e.preventDefault();
        to('today');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, online, to, view]);

  if (options.isPending) return <Spinner />;
  const date = query.get('date') ?? today();
  const pending = outbox.data?.length ?? 0;
  const refused = outbox.data?.filter((m) => m.state === 'CONFLICT' || m.state === 'FAILED').length ?? 0;

  return (
    <DeskCtx.Provider value={ctx}>
      <div className="flex h-full min-h-0">
        <Rail view={view} online={online} location={locName} me={me ? `${me.split(' ')[0]} · desk` : 'desk'} counts={{ outbox: pending || undefined }} onPick={(v, nt) => to(v, '', nt)} />
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-ground" aria-label={`Appointments · ${TITLES[view]}`}>
          {!online ? (
            <div role="status" className="flex shrink-0 items-center gap-2 border-b border-[#F5D48A] bg-[#FFF8E6] px-5 py-1.5 text-[12px] font-semibold text-[#7A3B05] dark:border-warning/40 dark:bg-warning-bg dark:text-warning">
              <Icon name="cloud-off" size={14} />
              <span className="min-w-0 flex-1">No connection to WorkSuite. You can check clients in and write notes; booking, moving, checkout and deposits wait for the connection.</span>
              <button type="button" className="font-bold underline" onClick={() => to('outbox')}>{pending ? `Outbox · ${pending}` : 'Outbox'}</button>
            </div>
          ) : refused ? (
            <div role="status" className="flex shrink-0 items-center gap-2 border-b border-line bg-[#FDECEA] px-5 py-1.5 text-[12px] font-semibold text-[#B42318] dark:bg-danger/15 dark:text-danger">
              <span className="min-w-0 flex-1">{`${refused} queued change${refused === 1 ? ' was' : 's were'} refused by WorkSuite.`}</span>
              <button type="button" className="font-bold underline" onClick={() => to('outbox')}>Review</button>
            </div>
          ) : null}
          <div className="flex min-h-0 flex-1">
            <div className="min-h-0 min-w-0 flex-1 overflow-y-auto px-[22px] py-[18px] scroll-thin">
              <Suspense fallback={<Spinner />}>
                {options.isError || !options.data ? (
                  <p className="m-0 text-[13px] text-ink-2">Appointments could not be opened. {online ? 'Try again in a moment.' : 'It needs WorkSuite the first time.'}</p>
                ) : view === 'today' ? (
                  <Today date={date} onAlerts={() => to('alerts')} />
                ) : view === 'calendar' ? (
                  <Calendar date={date} mode={query.get('mode') === 'week' ? 'week' : 'day'} by={query.get('by') === 'chairs' ? 'chairs' : 'stylists'} provider={num(query.get('provider'))} active={active} onNav={keep} onPrint={() => to('daysheet', `&date=${date}`)} />
                ) : view === 'list' ? (
                  <List active={active} />
                ) : view === 'walkin' ? (
                  <WalkIn onDone={(id) => to('today', `&apt=${id}`)} onWaitlist={() => to('waitlist')} />
                ) : view === 'clients' ? (
                  <Clients />
                ) : view === 'client' && clientId ? (
                  <ClientHistory id={clientId} onBack={() => to('clients')} />
                ) : view === 'waitlist' ? (
                  <Waitlist />
                ) : view === 'outbox' ? (
                  <Outbox items={outbox.data ?? []} />
                ) : view === 'reports' ? (
                  <Reports report={query.get('report')} onReport={(k) => keep({ report: k })} />
                ) : view === 'commission' ? (
                  <Commission />
                ) : view === 'setup' ? (
                  <Setup onDesk={() => to('settings')} />
                ) : view === 'checkout' && apt ? (
                  <Checkout id={apt} onDone={() => to('today')} />
                ) : view === 'settings' ? (
                  <DeskSettings settings={desk} onChange={(s) => { setDesk(s); writeDesk(s); }} />
                ) : view === 'alerts' ? (
                  <Alerts />
                ) : view === 'daysheet' ? (
                  <DaySheet date={date} settings={desk} onBack={() => to('calendar', `&date=${date}`)} />
                ) : (
                  <Today date={date} onAlerts={() => to('alerts')} />
                )}
              </Suspense>
            </div>
            {apt && view !== 'checkout' ? (
              <Suspense fallback={null}>
                <Panel id={apt} settings={desk} onClose={() => (pathId ? go(route(view)) : keep({ apt: null }))} />
              </Suspense>
            ) : null}
          </div>
        </main>
        {booking !== false || askNew ? (
          <Suspense fallback={null}>
            <NewAppointment prefill={booking || {}} onClose={() => (setBooking(false), askNew && keep({}))} onBooked={(id) => (setBooking(false), keep({ apt: String(id) }))} />
          </Suspense>
        ) : null}
        {palette ? (
          <Suspense fallback={null}>
            <Palette onClose={() => setPalette(false)} onGo={(v, extra) => (setPalette(false), to(v, extra))} />
          </Suspense>
        ) : null}
      </div>
    </DeskCtx.Provider>
  );
}

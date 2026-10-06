import { useQuery, useQueryClient } from '@tanstack/react-query';
import { lazy, Suspense, useEffect, useState } from 'react';
import { Icon } from '../../components/Icon';
import { Spinner, cx } from '../../components/ui';
import { app } from '../../core/app-state';
import { useStore } from '../../core/store';
import { useTab, useTabTitle } from '../../core/tab-context';
import type { ModuleProps } from '../registry';
import { clockAt, deskState, fetchDesks, fetchOptions, K, pairing as readPairing } from './api';
import { useCheckIn } from './CheckIn';
import Connect from './Connect';
import { useDeposit } from './Deposit';
import type { CheckoutResult } from './money';
import { copyAge, deskFromCopy, optionsFromCopy, syncNow, unreachable, useCopy, useOnline, useSalonChanged, useSyncStatus, waitingLine } from './offline';
import { DeskContext, Failed, Note, salonRoute, seedParam, TouchButton, usePrintSettings, type Desk, type DeskView } from './parts';
import { SidePanel } from '../../components/SidePanel';

/**
 * SalonMate's front desk, native in WorkSuite Desktop. Addressed as
 * `/salon?view=today|calendar|walkin|book|clients|record|outbox|…`
 * (`&client=<id>` for a client's card, `&date=YYYY-MM-DD` for a day,
 * `&seed=` for a walk-in started with what is known, `&visit=` for a
 * payment or a service record). A notification's `view=checkout` is the
 * payment screen.
 *
 * Until this computer is an approved desk it shows the pairing screen. The
 * owners' screens — reports, commission, settings, the desks list — open in
 * WorkSuite on the web, from Settings.
 *
 * When WorkSuite does not answer, the desk opens from its copy of the day and
 * says so (offline.ts); taking money waits for WorkSuite.
 */
const Today = lazy(() => import('./Today'));
const Calendar = lazy(() => import('./Calendar'));
const WalkIn = lazy(() => import('./WalkIn'));
const NewBooking = lazy(() => import('./NewBooking'));
const Clients = lazy(() => import('./Clients'));
const ServiceRecord = lazy(() => import('./ServiceRecord'));
const Pay = lazy(() => import('./Pay'));
const Paid = lazy(() => import('./Pay').then((m) => ({ default: m.Paid })));
const Register = lazy(() => import('./Register'));
const DayClose = lazy(() => import('./DayClose'));
const Printers = lazy(() => import('./Printers'));
const Outbox = lazy(() => import('./Outbox'));

const TITLES: Record<DeskView, string> = {
  today: 'Today',
  calendar: 'Calendar',
  walkin: 'Walk-in',
  book: 'New booking',
  clients: 'Clients',
  record: 'Service record',
  pay: 'Take payment',
  paid: 'Paid',
  register: 'Register',
  close: 'Close the day',
  printers: 'Printers & receipts',
  outbox: 'Sync',
};

/** The desk's rail (D02): each item, and the screens it stands for. */
const RAIL: Array<{ view: DeskView; label: string; icon: string; covers: DeskView[] }> = [
  { view: 'today', label: 'Today', icon: 'grid', covers: ['today'] },
  { view: 'calendar', label: 'Calendar', icon: 'calendar', covers: ['calendar', 'book'] },
  { view: 'walkin', label: 'Walk-in', icon: 'door', covers: ['walkin'] },
  { view: 'clients', label: 'Clients', icon: 'users', covers: ['clients', 'record'] },
  { view: 'pay', label: 'Checkout', icon: 'file-text', covers: ['pay', 'paid'] },
  { view: 'register', label: 'Register', icon: 'store', covers: ['register', 'close'] },
  { view: 'outbox', label: 'Sync', icon: 'refresh', covers: ['outbox'] },
  { view: 'printers', label: 'Settings', icon: 'settings', covers: ['printers'] },
];

/** Screens that take or count money: they need WorkSuite, always. */
const MONEY: DeskView[] = ['pay', 'register', 'close'];

/** Old and outside names for a screen: a notification's `checkout`, `settings`, `sync`. */
const ALIASES: Record<string, DeskView> = { checkout: 'pay', settings: 'printers', sync: 'outbox' };

export default function SalonShell(_props: ModuleProps) {
  const { query, go: goRoute } = useTab();
  const qc = useQueryClient();
  const raw = query.get('view') ?? '';
  const asked = (ALIASES[raw] ?? raw) as DeskView;
  const view: DeskView = asked in TITLES ? asked : 'today';
  useTabTitle(`SalonMate · ${TITLES[view]}`);
  useSalonChanged();
  const online = useOnline();
  const me = useStore(app, (s) => s.auth?.user?.name ?? null);

  const pairing = useQuery({ queryKey: K.pairing, queryFn: readPairing });
  const deskId = pairing.data?.desk_id ?? null;
  const sync = useSyncStatus();
  const copyQ = useCopy(!!deskId);
  const copy = copyQ.data && copyQ.data.desk_id === deskId ? copyQ.data : null;
  const desks = useQuery({
    queryKey: K.desks,
    queryFn: ({ signal }) => fetchDesks(signal),
    enabled: pairing.isSuccess,
    // Waiting for an owner's approval: ask often. Working: now and then, to notice a revoke.
    refetchInterval: (q) => (deskId && deskState(q.state.data, deskId) === 'requested' ? 10_000 : 5 * 60_000),
  });
  const desksDown = unreachable(desks);
  /* Opened with WorkSuite out of reach: the desk as the copy last saw it. */
  const fromCopy = !desks.data && desksDown ? deskFromCopy(copy) : null;
  const state = fromCopy ? fromCopy.status : deskId ? deskState(desks.data, deskId) : null;
  const info = fromCopy ?? (deskId ? (desks.data?.items.find((d) => d.id === deskId) ?? null) : null);
  const options = useQuery({ queryKey: K.options(info?.org_id ?? null), queryFn: ({ signal }) => fetchOptions(info!.org_id, signal), enabled: state === 'active' && !!info });
  const offline = !online || desksDown || unreachable(options) || sync.data?.reachable === false;
  const opts = options.data ?? (offline && copy ? optionsFromCopy(copy) : undefined);
  const go: Desk['go'] = (v, params = {}) => goRoute(salonRoute(v, params));
  const checkIn = useCheckIn(opts?.ack_severity ?? 'moderate', offline, (client) => go('clients', { client, allergy: 1 }));
  /* What each payment answered, for the Paid screen that follows it. */
  const [paid, setPaid] = useState<Record<number, CheckoutResult>>({});

  /* The main process sends the desk's heartbeat; a refusal there is how a revoke reaches the counter. */
  const problem = sync.data?.problem ?? null;
  useEffect(() => {
    if (problem) void qc.invalidateQueries({ queryKey: K.desks });
  }, [problem, qc]);

  const location = opts?.locations.find((l) => l.id === info?.location_id) ?? null;

  let desk: Desk | null = null;
  const may = opts?.may ?? {};
  const deposit = useDeposit(info ? { desk: info, go, may: (p) => may[p] === true } : null);
  if (info && opts && location) {
    desk = {
      desk: info,
      location,
      org: info.org_id,
      company: opts.company ?? '',
      currency: opts.currency ?? '',
      options: opts,
      params: query,
      me,
      may: (p) => may[p] === true,
      go,
      checkIn: (v) => checkIn.start(v),
      deposit: (v) => deposit.start(v),
      walkIn: (seed, later = false) => go(later ? 'book' : 'walkin', { seed: seedParam(seed) }),
      paid: {
        remember: (id, r) => setPaid((p) => ({ ...p, [id]: r })),
        note: (id, o) => setPaid((p) => (p[id] ? { ...p, [id]: { ...p[id], ...o } } : p)),
        get: (id) => paid[id],
      },
      offline,
      copy,
      sync: sync.data ?? null,
    };
  }

  if (pairing.isError) return <Failed text="WorkSuite Desktop could not read which desk this computer is." onRetry={() => void pairing.refetch()} />;
  if (pairing.isLoading) return <Spinner label="Opening SalonMate…" />;

  if (!pairing.data || state !== 'active') {
    return <Connect pairing={pairing.data ?? null} desk={info} state={state} desks={desks} me={me} onChange={() => void qc.invalidateQueries({ queryKey: K.all })} />;
  }

  if (options.isError && !opts) {
    return (
      <div className="p-6">
        <Failed
          text={offline ? 'WorkSuite cannot be reached, and this computer has no copy of the desk’s day yet. It keeps one once it has been open with WorkSuite reachable.' : 'SalonMate’s menu, stylists and permissions could not be loaded.'}
          onRetry={() => void options.refetch()}
        />
      </div>
    );
  }
  if (!desk) {
    if (opts && !location) {
      return (
        <div className="p-6">
          <Note tone="warning">This desk’s location is not one you may work at. Ask an owner for access to it, or pair this computer again for another location.</Note>
        </div>
      );
    }
    return <Spinner label="Opening the desk…" />;
  }

  return (
    <DeskContext.Provider value={desk}>
      <div className="flex h-full min-h-0">
        <SidePanel id="salon" label="the SalonMate menu">
          <Rail view={view} desk={desk} />
        </SidePanel>
        <main className="min-w-0 flex-1 overflow-y-auto bg-ground scroll-thin" aria-label={`SalonMate · ${TITLES[view]}`}>
          <SyncBar desk={desk} view={view} />
          <Suspense fallback={<Spinner />}>
            {offline && MONEY.includes(view) ? (
              <NeedsWorkSuite view={view} />
            ) : view === 'outbox' ? (
              <Outbox />
            ) : view === 'calendar' ? (
              <Calendar />
            ) : view === 'walkin' ? (
              <WalkIn key={`walkin-${query.get('seed') ?? ''}`} />
            ) : view === 'book' ? (
              <NewBooking key={`book-${query.get('seed') ?? ''}`} />
            ) : view === 'clients' ? (
              <Clients />
            ) : view === 'record' ? (
              <ServiceRecord key={`${query.get('visit') ?? ''}-${query.get('appointment') ?? ''}`} />
            ) : view === 'pay' ? (
              <Pay key={query.get('visit') ?? ''} />
            ) : view === 'paid' ? (
              <Paid key={query.get('visit') ?? ''} />
            ) : view === 'register' ? (
              <Register />
            ) : view === 'close' ? (
              <DayClose />
            ) : view === 'printers' ? (
              <Printers />
            ) : (
              <Today />
            )}
          </Suspense>
        </main>
      </div>
      {checkIn.panel}
      {deposit.panel}
    </DeskContext.Provider>
  );
}

/** What the desk is working from (D09's banner), and what waits to be sent. */
function SyncBar({ desk, view }: { desk: Desk; view: DeskView }) {
  const [busy, setBusy] = useState(false);
  const s = desk.sync;
  const tz = desk.location.timezone;
  const tryNow = async () => {
    setBusy(true);
    try {
      await syncNow();
    } finally {
      setBusy(false);
    }
  };

  if (desk.offline) {
    const age = copyAge(desk.copy, tz);
    return (
      <div className="px-5 pt-4">
        <div role="status" className="flex flex-wrap items-center gap-3.5 rounded-[16px] border border-[var(--ws-note-line)] bg-warning-bg px-[18px] py-3.5 text-warning-ink">
          <Icon name="wifi-off" size={22} className="shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="text-[17px] font-extrabold">No connection to WorkSuite{s?.last_contact ? ` since ${clockAt(s.last_contact, tz)}` : ''}</div>
            <div className="text-[13px]">
              {age ? `Showing the calendar, clients and services as of ${age}. ` : 'This computer has no copy of the day yet. '}
              {s?.can_write ? 'New clients, bookings and check-ins are kept here and sent in order when the line is back. ' : s?.why_not ? `${s.why_not} ` : ''}
              Payments, deposits and the register need WorkSuite.
            </div>
          </div>
          <TouchButton icon="refresh" loading={busy} onClick={() => void tryNow()}>
            Try now
          </TouchButton>
        </div>
      </div>
    );
  }
  const line = view === 'outbox' ? null : waitingLine(s ?? undefined);
  if (!line) return null;
  return (
    <div className="px-5 pt-4">
      <Note
        tone={s && s.refused > 0 ? 'danger' : 'indigo'}
        icon={s && s.refused > 0 ? 'warning' : 'upload'}
        action={
          <TouchButton className="min-h-10 text-[13px]" onClick={() => desk.go('outbox')}>
            Open Sync
          </TouchButton>
        }
      >
        {line}
      </Note>
    </div>
  );
}

function NeedsWorkSuite({ view }: { view: DeskView }) {
  const what = view === 'pay' ? 'Taking payment' : view === 'register' ? 'The register' : 'Closing the day';
  return (
    <div className="px-5 py-4">
      <Note tone="muted">{what} needs WorkSuite, so that the money is counted once, in one place. Clients can still be checked in, walked in and booked here; take payment when the line is back.</Note>
    </div>
  );
}

/** The desk's own rail (D02): icons over their names, and where this desk stands at its foot. */
function Rail({ view, desk }: { view: DeskView; desk: Desk }) {
  const print = usePrintSettings();
  const s = desk.sync;
  const tz = desk.location.timezone;
  const unsent = (s?.waiting ?? 0) + (s?.refused ?? 0);
  const book = desk.may('salon.visit.book');
  const reg = desk.desk.register;
  const disabled: Partial<Record<DeskView, boolean>> = { walkin: !book, pay: !desk.may('salon.checkout') };

  return (
    <nav aria-label="SalonMate" className="flex h-full w-[88px] shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-line bg-surface px-[7px] py-2.5 scroll-thin">
      <div className="pt-1 pb-2 text-center text-[10px] font-extrabold tracking-[.08em] text-[#6D28D9] dark:text-[#C4B5FD]">SALONMATE</div>
      {RAIL.map((r) => {
        const on = r.covers.includes(view);
        return (
          <button
            key={r.view}
            type="button"
            disabled={disabled[r.view]}
            aria-current={on ? 'page' : undefined}
            onClick={() => (r.view === 'walkin' ? desk.walkIn({}) : desk.go(r.view))}
            className={cx(
              'relative flex shrink-0 flex-col items-center gap-[3px] rounded-[12px] py-2 text-[11.5px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40',
              on ? 'bg-selection text-primary' : 'text-ink-2 enabled:hover:bg-subtle enabled:hover:text-ink',
            )}
          >
            <span className="relative">
              <Icon name={r.icon} size={22} />
              {r.view === 'outbox' && unsent > 0 ? (
                <span
                  aria-label={`${unsent} waiting`}
                  className={cx('absolute -top-1.5 -right-2.5 grid h-[18px] min-w-[18px] place-items-center rounded-full px-1 text-[10.5px] font-bold text-white', s && s.refused > 0 ? 'bg-danger' : 'bg-[#F59E0B]')}
                >
                  {unsent > 99 ? '99+' : unsent}
                </span>
              ) : null}
            </span>
            {r.label}
          </button>
        );
      })}

      <div className="mt-auto flex flex-col items-center gap-1 pt-3 text-center text-[10px] leading-tight text-ink-2">
        <span className={cx('flex items-center gap-1 font-bold', desk.offline ? 'text-warning' : 'text-success')}>
          <span className={cx('h-[7px] w-[7px] rounded-full', desk.offline ? 'bg-warning' : 'bg-success')} />
          {desk.offline ? 'Offline' : 'Online'}
        </span>
        <span>{desk.offline ? (unsent > 0 ? `${unsent} waiting` : 'nothing waiting') : s?.last_contact ? `synced ${clockAt(s.last_contact, tz)}` : ''}</span>
        {reg ? (
          <span className={cx('mt-1 flex items-center gap-1 font-semibold', reg.open ? 'text-teal' : 'text-ink-3')} title={`Register ${reg.code} ${reg.open ? 'open' : 'closed'}`}>
            <Icon name="store" size={11} />
            {reg.code} {reg.open ? 'open' : 'closed'}
          </span>
        ) : null}
        {print.data?.receipt_printer ? (
          <span className="flex max-w-full items-center gap-1" title={print.data.receipt_printer}>
            <Icon name="printer" size={11} className="shrink-0" />
            <span className="truncate">{print.data.receipt_printer}</span>
          </span>
        ) : null}
        <span className="mt-1.5 border-t border-line pt-1.5">
          {desk.location.name}
          <br />
          {desk.desk.name}
          {reg ? ` · ${reg.code}` : ''}
        </span>
      </div>
    </nav>
  );
}

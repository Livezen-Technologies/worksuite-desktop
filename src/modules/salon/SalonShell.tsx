import { useQuery, useQueryClient } from '@tanstack/react-query';
import { lazy, Suspense, useEffect, useState } from 'react';
import { Icon } from '../../components/Icon';
import { Button, Modal, Spinner, cx } from '../../components/ui';
import { call } from '../../core/bridge';
import { useTab, useTabTitle } from '../../core/tab-context';
import { toast } from '../../core/toasts';
import type { ModuleProps } from '../registry';
import { deskState, fetchDesks, fetchOptions, forgetDesk, K, pairing as readPairing } from './api';
import { useCheckIn } from './CheckIn';
import type { CheckoutResult } from './money';
import Connect from './Connect';
import { copyAge, deskFromCopy, optionsFromCopy, syncNow, unreachable, useCopy, useOnline, useSalonChanged, useSyncStatus, waitingLine } from './offline';
import { DeskContext, Failed, Note, salonRoute, seedParam, type Desk, type DeskView } from './parts';

/**
 * SalonMate's front desk, native in WorkSuite Desktop. Addressed as
 * `/salon?view=today|calendar|walkin|book|clients|outbox|…` (`&client=<id>`
 * for a client's card, `&date=YYYY-MM-DD` for a day, `&seed=` for a walk-in
 * started with what is known). A notification's `view=checkout` is the
 * payment screen.
 *
 * Until this computer is an approved desk it shows the pairing screen. The
 * owners' screens — reports, commission, settings, the desks list — open in
 * WorkSuite on the web.
 *
 * When WorkSuite does not answer, the desk opens from its copy of the day and
 * says so (offline.ts); taking money waits for WorkSuite.
 */
const Today = lazy(() => import('./Today'));
const Calendar = lazy(() => import('./Calendar'));
const WalkIn = lazy(() => import('./WalkIn'));
const Clients = lazy(() => import('./Clients'));
const Pay = lazy(() => import('./Pay'));
const Paid = lazy(() => import('./Pay').then((m) => ({ default: m.Paid })));
const Register = lazy(() => import('./Register'));
const DayClose = lazy(() => import('./DayClose'));
const Printers = lazy(() => import('./Printers'));
const Outbox = lazy(() => import('./Outbox'));

const VIEWS: Record<DeskView, { label: string; icon: string }> = {
  today: { label: 'Today', icon: 'home' },
  calendar: { label: 'Calendar', icon: 'calendar' },
  walkin: { label: 'Walk-in', icon: 'user-plus' },
  book: { label: 'New booking', icon: 'calendar-check' },
  clients: { label: 'Clients', icon: 'users' },
  pay: { label: 'Take payment', icon: 'banknote' },
  paid: { label: 'Paid', icon: 'check-circle' },
  register: { label: 'Register', icon: 'unlock' },
  close: { label: 'Close the day', icon: 'moon' },
  printers: { label: 'Printers', icon: 'printer' },
  outbox: { label: 'Changes to send', icon: 'upload' },
};

/** Screens that take or count money: they need WorkSuite, always. */
const MONEY: DeskView[] = ['pay', 'register', 'close'];

export default function SalonShell(_props: ModuleProps) {
  const { query, go: goRoute } = useTab();
  const qc = useQueryClient();
  const raw = query.get('view') ?? '';
  const asked = (raw === 'checkout' ? 'pay' : raw) as DeskView;
  const view: DeskView = asked in VIEWS ? asked : 'today';
  useTabTitle(`SalonMate · ${VIEWS[view].label}`);
  useSalonChanged();
  const online = useOnline();

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
  const checkIn = useCheckIn(opts?.ack_severity ?? 'moderate', offline);
  /* What each payment answered, for the Paid screen that follows it. */
  const [paid, setPaid] = useState<Record<number, CheckoutResult>>({});

  /* The main process sends the desk's heartbeat; a refusal there is how a revoke reaches the counter. */
  const problem = sync.data?.problem ?? null;
  useEffect(() => {
    if (problem) void qc.invalidateQueries({ queryKey: K.desks });
  }, [problem, qc]);

  const location = opts?.locations.find((l) => l.id === info?.location_id) ?? null;

  let desk: Desk | null = null;
  if (info && opts && location) {
    const may = opts.may ?? {};
    const go: Desk['go'] = (v, params = {}) => goRoute(salonRoute(v, params));
    desk = {
      desk: info,
      location,
      org: info.org_id,
      company: opts.company ?? '',
      currency: opts.currency ?? '',
      options: opts,
      params: query,
      may: (p) => may[p] === true,
      go,
      checkIn: (v) => checkIn.start(v),
      walkIn: (seed, later = false) => go(later ? 'book' : 'walkin', { seed: seedParam(seed) }),
      paid: { remember: (id, r) => setPaid((p) => ({ ...p, [id]: r })), get: (id) => paid[id] },
      offline,
      copy,
      sync: sync.data ?? null,
    };
  }

  if (pairing.isError) return <Failed text="WorkSuite Desktop could not read which desk this computer is." onRetry={() => void pairing.refetch()} />;
  if (pairing.isLoading) return <Spinner label="Opening SalonMate…" />;

  if (!pairing.data || state !== 'active') {
    return <Connect pairing={pairing.data ?? null} desk={info} state={state} desks={desks} onChange={() => void qc.invalidateQueries({ queryKey: K.all })} />;
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
        <Rail view={view} desk={desk} />
        <main className="min-w-0 flex-1 overflow-y-auto bg-ground scroll-thin" aria-label={`SalonMate · ${VIEWS[view].label}`}>
          <SyncBar desk={desk} view={view} />
          <Suspense fallback={<Spinner />}>
            {offline && MONEY.includes(view) ? (
              <NeedsWorkSuite view={view} />
            ) : view === 'outbox' ? (
              <Outbox />
            ) : view === 'calendar' ? (
              <Calendar />
            ) : view === 'walkin' || view === 'book' ? (
              <WalkIn key={`${view}-${query.get('seed') ?? ''}`} later={view === 'book'} />
            ) : view === 'clients' ? (
              <Clients />
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
    </DeskContext.Provider>
  );
}

/** What the desk is working from, and what waits to be sent. */
function SyncBar({ desk, view }: { desk: Desk; view: DeskView }) {
  const [busy, setBusy] = useState(false);
  const s = desk.sync;
  const tryNow = async () => {
    setBusy(true);
    try {
      await syncNow();
    } finally {
      setBusy(false);
    }
  };

  if (desk.offline) {
    const age = copyAge(desk.copy, desk.location.timezone);
    return (
      <div className="px-6 pt-4">
        <Note
          tone="warning"
          action={
            <Button size="sm" icon="refresh" loading={busy} onClick={() => void tryNow()}>
              Try now
            </Button>
          }
        >
          <span className="font-bold">WorkSuite cannot be reached.</span> {age ? `Working from this desk’s copy of the day, taken at ${age}.` : 'This computer has no copy of the day yet.'}{' '}
          {s?.can_write ? 'New clients, walk-ins, bookings and check-ins are kept here and sent when it is back.' : (s?.why_not ?? '')} Payments and the register need WorkSuite.
        </Note>
      </div>
    );
  }
  const line = view === 'outbox' ? null : waitingLine(s ?? undefined);
  if (!line) return null;
  return (
    <div className="px-6 pt-4">
      <Note
        tone={s && s.refused > 0 ? 'danger' : 'indigo'}
        action={
          <Button size="sm" onClick={() => desk.go('outbox')}>
            Open
          </Button>
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
    <div className="p-6">
      <Note tone="muted">{what} needs WorkSuite, so that the money is counted once, in one place. Clients can still be checked in, walked in and booked here; take payment when the line is back.</Note>
    </div>
  );
}

function Rail({ view, desk }: { view: DeskView; desk: Desk }) {
  const qc = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const item = (v: DeskView, disabled = false) => {
    const on = view === v;
    return (
      <button
        key={v}
        type="button"
        disabled={disabled}
        aria-current={on ? 'page' : undefined}
        onClick={() => (v === 'walkin' || v === 'book' ? desk.walkIn({}, v === 'book') : desk.go(v))}
        className={cx(
          'relative flex h-[34px] shrink-0 items-center gap-[9px] rounded-[8px] pr-2 pl-2.5 text-left disabled:opacity-50',
          on ? 'bg-selection font-bold text-primary' : 'font-medium text-ink hover:bg-subtle',
        )}
      >
        <span className={cx('absolute top-1.5 bottom-1.5 left-0 w-[3px] rounded-r-[3px]', on ? 'bg-primary' : 'bg-transparent')} />
        <Icon name={VIEWS[v].icon} size={16} className={cx('shrink-0', on ? 'text-primary' : 'text-ink-3')} />
        <span className="min-w-0 flex-1 truncate">{VIEWS[v].label}</span>
      </button>
    );
  };
  const book = desk.may('salon.visit.book');
  const unsent = (desk.sync?.waiting ?? 0) + (desk.sync?.refused ?? 0) + (desk.sync?.others ?? 0);

  async function forget() {
    try {
      await forgetDesk();
      setConfirming(false);
      void qc.invalidateQueries({ queryKey: K.all });
    } catch (e) {
      toast('error', e instanceof Error ? e.message : 'The pairing could not be forgotten.');
    }
  }

  return (
    <nav aria-label="SalonMate" className="flex w-[220px] shrink-0 flex-col overflow-hidden border-r border-line bg-surface text-[13px] text-ink">
      <div className="flex flex-col gap-0.5 px-2.5 pt-3.5">
        {item('today')}
        {item('calendar')}
        {item('walkin', !book)}
        {item('book', !book)}
        {item('clients')}
        {outboxItem(view, desk)}
        <div className="mx-1 my-1.5 border-t border-line" />
        {item('pay', !desk.may('salon.checkout'))}
        {desk.desk.register ? item('register') : null}
        {item('close')}
        {item('printers')}
      </div>
      <div className="mt-auto flex flex-col gap-2 border-t border-line px-3 py-3">
        <button type="button" onClick={() => void call('app:openInBrowser', { path: '/salon' })} className="flex items-center gap-2 text-left text-[12.5px] font-semibold text-ink-2 hover:text-ink">
          <Icon name="external" size={14} /> Owners’ screens on the web
        </button>
        <div className="text-[12px] text-ink-3">
          <div className="truncate font-semibold text-ink-2">{desk.desk.name}</div>
          <div className="truncate">
            {desk.location.name}
            {desk.desk.register ? ` · ${desk.desk.register.code}` : ''}
          </div>
        </div>
        <button type="button" onClick={() => setConfirming(true)} className="text-left text-[12px] text-ink-3 hover:text-danger">
          Pair this computer again…
        </button>
      </div>
      {confirming ? (
        <Modal
          title="Pair this computer again?"
          onClose={() => setConfirming(false)}
          footer={
            <>
              <Button onClick={() => setConfirming(false)}>Keep this desk</Button>
              <Button variant="danger" onClick={() => void forget()}>
                Forget this desk
              </Button>
            </>
          }
        >
          <p className="text-[13.5px] text-ink">
            This computer forgets that it is {desk.desk.name}. To work as a front desk again it is paired anew, and an owner approves it. The old desk stays on the server until an owner revokes it.
          </p>
          {unsent > 0 ? (
            <p className="mt-2 text-[13.5px] font-semibold text-danger">
              {unsent} change{unsent === 1 ? '' : 's'} made at this desk while WorkSuite was out of reach {unsent === 1 ? 'has' : 'have'} not reached it, and will be dropped.
            </p>
          ) : null}
        </Modal>
      ) : null}
    </nav>
  );
}

/** "Changes to send", with how many wait and whether any needs a person. */
function outboxItem(view: DeskView, desk: Desk) {
  const s = desk.sync;
  const n = (s?.waiting ?? 0) + (s?.refused ?? 0);
  if (n === 0 && view !== 'outbox' && !desk.offline) return null;
  const on = view === 'outbox';
  return (
    <button
      key="outbox"
      type="button"
      aria-current={on ? 'page' : undefined}
      onClick={() => desk.go('outbox')}
      className={cx(
        'relative flex h-[34px] shrink-0 items-center gap-[9px] rounded-[8px] pr-2 pl-2.5 text-left',
        on ? 'bg-selection font-bold text-primary' : 'font-medium text-ink hover:bg-subtle',
      )}
    >
      <span className={cx('absolute top-1.5 bottom-1.5 left-0 w-[3px] rounded-r-[3px]', on ? 'bg-primary' : 'bg-transparent')} />
      <Icon name={VIEWS.outbox.icon} size={16} className={cx('shrink-0', on ? 'text-primary' : 'text-ink-3')} />
      <span className="min-w-0 flex-1 truncate">{VIEWS.outbox.label}</span>
      {n > 0 ? (
        <span className={cx('rounded-full px-1.5 text-[11px] font-bold tabular-nums', s && s.refused > 0 ? 'bg-danger text-white' : 'bg-subtle text-ink-2')} aria-label={`${n} waiting`}>
          {n}
        </span>
      ) : null}
    </button>
  );
}

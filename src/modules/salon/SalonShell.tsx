import { useQuery, useQueryClient } from '@tanstack/react-query';
import { lazy, Suspense, useEffect, useState } from 'react';
import { Icon } from '../../components/Icon';
import { Button, Modal, Spinner, cx } from '../../components/ui';
import { ApiError, request } from '../../core/api';
import { app } from '../../core/app-state';
import { call } from '../../core/bridge';
import { useStore } from '../../core/store';
import { useTab, useTabTitle } from '../../core/tab-context';
import { toast } from '../../core/toasts';
import type { ModuleProps } from '../registry';
import { deskState, fetchDesks, fetchOptions, forgetDesk, K, pairing as readPairing } from './api';
import { useCheckIn } from './CheckIn';
import Connect from './Connect';
import { DeskContext, Failed, Note, salonRoute, seedParam, type Desk, type DeskView } from './parts';

/**
 * SalonMate's front desk, native in WorkSuite Desktop. Addressed as
 * `/salon?view=today|calendar|walkin|book|clients` (`&client=<id>` for a
 * client's card, `&date=YYYY-MM-DD` for a day, `&seed=` for a walk-in started
 * with what is known).
 *
 * Until this computer is an approved desk it shows the pairing screen. The
 * owners' screens — reports, commission, settings, the desks list — open in
 * WorkSuite on the web.
 */
const Today = lazy(() => import('./Today'));
const Calendar = lazy(() => import('./Calendar'));
const WalkIn = lazy(() => import('./WalkIn'));
const Clients = lazy(() => import('./Clients'));

const VIEWS: Record<DeskView, { label: string; icon: string }> = {
  today: { label: 'Today', icon: 'home' },
  calendar: { label: 'Calendar', icon: 'calendar' },
  walkin: { label: 'Walk-in', icon: 'user-plus' },
  book: { label: 'New booking', icon: 'calendar-check' },
  clients: { label: 'Clients', icon: 'users' },
};

const HEARTBEAT_MS = 5 * 60_000;

export default function SalonShell(_props: ModuleProps) {
  const { query, go: goRoute } = useTab();
  const qc = useQueryClient();
  const version = useStore(app, (s) => s.info?.version ?? null);
  const asked = (query.get('view') ?? '') as DeskView;
  const view: DeskView = asked in VIEWS ? asked : 'today';
  useTabTitle(`SalonMate · ${VIEWS[view].label}`);

  const pairing = useQuery({ queryKey: K.pairing, queryFn: readPairing });
  const deskId = pairing.data?.desk_id ?? null;
  const desks = useQuery({
    queryKey: K.desks,
    queryFn: ({ signal }) => fetchDesks(signal),
    enabled: pairing.isSuccess,
    // Waiting for an owner's approval: ask often. Working: now and then, to notice a revoke.
    refetchInterval: (q) => (deskId && deskState(q.state.data, deskId) === 'requested' ? 10_000 : 5 * 60_000),
  });
  const state = deskId ? deskState(desks.data, deskId) : null;
  const info = deskId ? (desks.data?.items.find((d) => d.id === deskId) ?? null) : null;
  const options = useQuery({ queryKey: K.options(info?.org_id ?? null), queryFn: ({ signal }) => fetchOptions(info!.org_id, signal), enabled: state === 'active' && !!info });
  const checkIn = useCheckIn(options.data?.ack_severity ?? 'moderate');

  /* The heartbeat: WorkSuite shows owners which desks are alive, and a refusal is how a revoke reaches the counter. */
  useEffect(() => {
    if (state !== 'active' || !deskId) return;
    const beat = () =>
      request('POST', '/api/salon/v1/desk/heartbeat', { body: { desk: deskId, app_version: version ? `desktop ${version}` : 'desktop', queue_depth: 0 } }).catch((e: unknown) => {
        if (e instanceof ApiError && e.status === 403) void qc.invalidateQueries({ queryKey: K.desks });
      });
    void beat();
    const t = window.setInterval(() => void beat(), HEARTBEAT_MS);
    return () => window.clearInterval(t);
  }, [state, deskId, version, qc]);

  const location = options.data?.locations.find((l) => l.id === info?.location_id) ?? null;

  let desk: Desk | null = null;
  if (info && options.data && location) {
    const may = options.data.may ?? {};
    const go: Desk['go'] = (v, params = {}) => goRoute(salonRoute(v, params));
    desk = {
      desk: info,
      location,
      org: info.org_id,
      options: options.data,
      params: query,
      may: (p) => may[p] === true,
      go,
      checkIn: (v) => checkIn.start(v),
      walkIn: (seed, later = false) => go(later ? 'book' : 'walkin', { seed: seedParam(seed) }),
    };
  }

  if (pairing.isError) return <Failed text="WorkSuite Desktop could not read which desk this computer is." onRetry={() => void pairing.refetch()} />;
  if (pairing.isLoading) return <Spinner label="Opening SalonMate…" />;

  if (!pairing.data || state !== 'active') {
    return <Connect pairing={pairing.data ?? null} desk={info} state={state} desks={desks} onChange={() => void qc.invalidateQueries({ queryKey: K.all })} />;
  }

  if (options.isError) return <div className="p-6"><Failed text="SalonMate’s menu, stylists and permissions could not be loaded." onRetry={() => void options.refetch()} /></div>;
  if (!desk) {
    if (options.data && !location) {
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
          <Suspense fallback={<Spinner />}>
            {view === 'calendar' ? (
              <Calendar />
            ) : view === 'walkin' || view === 'book' ? (
              <WalkIn key={`${view}-${query.get('seed') ?? ''}`} later={view === 'book'} />
            ) : view === 'clients' ? (
              <Clients />
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
        </Modal>
      ) : null}
    </nav>
  );
}

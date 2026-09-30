import { useQuery, useQueryClient } from '@tanstack/react-query';
import { lazy, Suspense, useState } from 'react';
import { Icon } from '../../components/Icon';
import { SidePanel } from '../../components/SidePanel';
import { Button, Modal, Spinner, Switch, cx } from '../../components/ui';
import { ApiError } from '../../core/api';
import { call } from '../../core/bridge';
import { useTab, useTabTitle } from '../../core/tab-context';
import { toast } from '../../core/toasts';
import type { ModuleProps } from '../registry';
import { bridge, get, K, setOrg, unreachable, type Options, type PosContext } from './api';
import Connect from './Connect';
import { useT, type RKey } from './i18n';
import { Failed, Note, TillContext, tillGo, useCopy, useRestaurantChanged, useStatus, useTill, type Till } from './parts';
import { screenOf, type View } from './routes';

/**
 * Restaurant Manager, native in WorkSuite Desktop: this computer as one of a
 * branch's terminals — the waiter's and cashier's till (floor, order, bill,
 * payment, cashier session), the kitchen screen and the pass, the printers it
 * hosts, and what it kept while WorkSuite was out of reach.
 *
 * Until the computer is paired it shows the pairing screen. The back office —
 * menu, floor design, staff, reports, the day close — opens on the web.
 * The host stand (reservations) is here.
 *
 * Offline the till opens from its copy of the menu and floor (the main
 * process keeps it) and keeps new orders, lines and sends for WorkSuite;
 * anything with money, a void or a table move waits for it.
 */
const Floor = lazy(() => import('./Floor'));
const OrderScreen = lazy(() => import('./Order'));
const BillScreen = lazy(() => import('./Bill'));
const Cashier = lazy(() => import('./Cashier'));
const Kitchen = lazy(() => import('./Kitchen'));
const Expo = lazy(() => import('./Kitchen').then((m) => ({ default: m.Expo })));
const Printers = lazy(() => import('./Printers'));
const Outbox = lazy(() => import('./Outbox'));
const Approvals = lazy(() => import('./Approvals'));
const Reservations = lazy(() => import('./Reservations'));

const RAIL: Record<View, { label: RKey; icon: string }> = {
  floor: { label: 'nav.floor', icon: 'grid' },
  order: { label: 'nav.order', icon: 'receipt' },
  bill: { label: 'nav.bill', icon: 'banknote' },
  cashier: { label: 'nav.cashier', icon: 'wallet' },
  kitchen: { label: 'nav.kitchen', icon: 'timer' },
  expo: { label: 'nav.expo', icon: 'check-check' },
  printers: { label: 'nav.printers', icon: 'printer' },
  outbox: { label: 'nav.outbox', icon: 'upload' },
  approvals: { label: 'nav.approvals', icon: 'shield-check' },
  reservations: { label: 'nav.reservations', icon: 'calendar-clock' },
};

/** Screens that take, count or give back money, void or move a party: WorkSuite decides them, always. */
const ONLINE_ONLY: View[] = ['bill', 'cashier', 'approvals', 'expo', 'kitchen', 'reservations'];

export default function RestaurantShell(_props: ModuleProps) {
  const t = useT();
  const { path, query, go: goRoute } = useTab();
  const qc = useQueryClient();
  useRestaurantChanged();

  const pairing = useQuery({ queryKey: K.pairing, queryFn: bridge.pairing });
  const p = pairing.data ?? null;
  setOrg(p?.org_id ?? null);
  const status = useStatus();
  const copyQ = useCopy(!!p);
  const copy = copyQ.data && copyQ.data.terminal_id === p?.terminal_id ? copyQ.data : null;

  const options = useQuery({ queryKey: K.options(p?.org_id ?? null), queryFn: ({ signal }) => get<Options>('/options', {}, signal), enabled: !!p, staleTime: 5 * 60_000 });
  const pos = useQuery({ queryKey: K.pos(p?.branch_id ?? 0), queryFn: ({ signal }) => get<PosContext>('/pos', { branch_id: p!.branch_id }, signal), enabled: !!p, refetchInterval: 60_000 });
  const offline = unreachable(pos.error) || unreachable(options.error) || status.data?.reachable === false;
  const screen = screenOf(path, query, p?.mode);
  const title = t(RAIL[screen.view].label);
  useTabTitle(`${t('app.name')} · ${title}`);

  if (pairing.isError) return <div className="p-6"><Failed text={t('shell.pairingUnreadable')} onRetry={() => void pairing.refetch()} /></div>;
  if (pairing.isLoading) return <Spinner label={t('shell.opening')} />;
  if (!p) return <Connect onPaired={() => void qc.invalidateQueries({ queryKey: K.all })} />;

  const posData = pos.data ?? (offline ? ((copy?.pos as PosContext | undefined) ?? null) : null);
  const opts = options.data ?? null;
  const till: Till = {
    pairing: p,
    org: p.org_id,
    branch: p.branch_id,
    options: opts,
    pos: posData,
    currency: opts?.currency ?? '',
    can: (perm) => (opts ? opts.can[perm] === true : offline),
    offline,
    copy,
    status: status.data ?? null,
    screen,
    go: tillGo(goRoute),
  };

  /* A kitchen screen's cook may not have the till (`pos.access`): the till's context is then simply not there. */
  if (!offline && pos.isError && !(pos.error instanceof ApiError && (pos.error.status === 403 || pos.error.status === 404) && p.mode !== 'pos')) {
    return (
      <div className="flex max-w-[720px] flex-col gap-3 p-6">
        <Failed text={pos.error instanceof Error ? pos.error.message : t('shell.posFailed')} onRetry={() => void pos.refetch()} />
        <UnpairButton />
      </div>
    );
  }

  return (
    <TillContext.Provider value={till}>
      <div className="flex h-full min-h-0">
        <SidePanel id="restaurant" label={t('shell.menuLabel')}>
          <Rail />
        </SidePanel>
        <main className="min-w-0 flex-1 overflow-y-auto bg-ground scroll-thin" aria-label={`${t('app.name')} · ${title}`}>
          <SyncBar />
          <Suspense fallback={<Spinner />}>
            {offline && ONLINE_ONLY.includes(screen.view) ? (
              <div className="p-6">
                <Note tone="muted">{t('shell.needsWorkSuite')}</Note>
              </div>
            ) : screen.view === 'order' ? (
              <OrderScreen key={`${screen.order ?? ''}-${screen.table ?? ''}-${screen.local ?? ''}-${screen.takeaway}`} />
            ) : screen.view === 'bill' ? (
              <BillScreen key={screen.order ?? 0} />
            ) : screen.view === 'cashier' ? (
              <Cashier />
            ) : screen.view === 'kitchen' ? (
              <Kitchen />
            ) : screen.view === 'expo' ? (
              <Expo />
            ) : screen.view === 'printers' ? (
              <Printers />
            ) : screen.view === 'outbox' ? (
              <Outbox />
            ) : screen.view === 'approvals' ? (
              <Approvals />
            ) : screen.view === 'reservations' ? (
              <Reservations />
            ) : (
              <Floor />
            )}
          </Suspense>
        </main>
      </div>
    </TillContext.Provider>
  );
}

/** Out of reach, and what waits to be sent. */
function SyncBar() {
  const t = useT();
  const till = useTill();
  const [busy, setBusy] = useState(false);
  const s = till.status;
  const tryNow = async () => {
    setBusy(true);
    try {
      await bridge.syncNow();
    } finally {
      setBusy(false);
    }
  };
  const retry = (
    <Button size="sm" icon="refresh" loading={busy} onClick={() => void tryNow()}>
      {t('common.tryNow')}
    </Button>
  );
  if (till.offline) {
    const at = till.copy?.taken_at ? new Date(till.copy.taken_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null;
    return (
      <div className="px-6 pt-4">
        <Note tone="warning" action={retry}>
          <span className="font-bold">{t('sync.offline')}</span> {at ? t('sync.fromCopy', { at }) : t('sync.noCopy')} {s?.can_queue ? t('sync.queueing') : (s?.why_not ?? '')}
        </Note>
      </div>
    );
  }
  if (s?.problem) {
    return (
      <div className="px-6 pt-4">
        <Note tone="danger" action={retry}>
          {s.problem}
        </Note>
      </div>
    );
  }
  const n = (s?.waiting ?? 0) + (s?.conflicts ?? 0) + (s?.refused ?? 0);
  if (n === 0 || till.screen.view === 'outbox') return null;
  return (
    <div className="px-6 pt-4">
      <Note tone={s && s.conflicts + s.refused > 0 ? 'danger' : 'indigo'} action={<Button size="sm" onClick={() => till.go('outbox')}>{t('common.open')}</Button>}>
        {t('sync.waiting', { n })}
      </Note>
    </div>
  );
}

function Rail() {
  const t = useT();
  const till = useTill();
  const view = till.screen.view;
  const item = (v: View, show = true) => {
    if (!show) return null;
    const on = view === v;
    return (
      <button
        key={v}
        type="button"
        aria-current={on ? 'page' : undefined}
        onClick={() => till.go(v)}
        className={cx('relative flex h-[34px] shrink-0 items-center gap-[9px] rounded-[8px] ps-2.5 pe-2 text-start', on ? 'bg-selection font-bold text-primary' : 'font-medium text-ink hover:bg-subtle')}
      >
        <span className={cx('absolute start-0 top-1.5 bottom-1.5 w-[3px] rounded-e-[3px]', on ? 'bg-primary' : 'bg-transparent')} />
        <Icon name={RAIL[v].icon} size={16} className={cx('shrink-0', on ? 'text-primary' : 'text-ink-3')} />
        <span className="min-w-0 flex-1 truncate">{t(RAIL[v].label)}</span>
        {v === 'outbox' && till.status && till.status.waiting + till.status.conflicts + till.status.refused > 0 ? (
          <span className={cx('rounded-full px-1.5 text-[11px] font-bold tabular-nums', till.status.conflicts + till.status.refused > 0 ? 'bg-danger text-white' : 'bg-subtle text-ink-2')}>
            {till.status.waiting + till.status.conflicts + till.status.refused}
          </span>
        ) : null}
      </button>
    );
  };
  const pos = till.pairing.mode === 'pos' || till.pairing.mode === 'back_office';
  return (
    <nav aria-label={t('app.name')} className="flex w-[220px] shrink-0 flex-col overflow-hidden border-e border-line bg-surface text-[13px] text-ink">
      <div className="flex flex-col gap-0.5 px-2.5 pt-3.5">
        {item('floor', pos || till.can('pos_access'))}
        {item('order', pos || till.can('order_create'))}
        {item('reservations', till.can('reservation_view') || till.can('reservation_manage'))}
        {item('cashier', till.can('cashier_open') || till.can('cashier_close'))}
        <div className="mx-1 my-1.5 border-t border-line" />
        {item('kitchen', till.can('kitchen_view') || till.can('kitchen_manage') || till.pairing.mode === 'kds')}
        {item('expo', till.can('kitchen_view') || till.can('kitchen_manage') || till.pairing.mode === 'expo')}
        <div className="mx-1 my-1.5 border-t border-line" />
        {item('approvals')}
        {item('outbox')}
        {item('printers')}
      </div>
      <div className="mt-auto flex flex-col gap-2 border-t border-line px-3 py-3">
        <button type="button" onClick={() => void call('app:openInBrowser', { path: '/restaurant' })} className="flex items-center gap-2 text-start text-[12.5px] font-semibold text-ink-2 hover:text-ink">
          <Icon name="external" size={14} /> {t('shell.backOffice')}
        </button>
        <div className="text-[12px] text-ink-3">
          <div className="truncate font-semibold text-ink-2">{till.pairing.name}</div>
          <div className="truncate">
            {till.pairing.code}
            {till.pos?.business_date ? ` · ${till.pos.business_date.business_date}` : ''}
          </div>
        </div>
        <UnpairButton />
      </div>
    </nav>
  );
}

/** "Pair this computer again": forget the terminal here, and optionally revoke its key on the server. */
function UnpairButton() {
  const t = useT();
  const qc = useQueryClient();
  const status = useStatus();
  const [open, setOpen] = useState(false);
  const [revoke, setRevoke] = useState(true);
  const [busy, setBusy] = useState(false);
  const unsent = (status.data?.waiting ?? 0) + (status.data?.refused ?? 0) + (status.data?.others ?? 0);

  async function unpair() {
    setBusy(true);
    try {
      const r = await call('restaurant:unpair', { revoke, discard: true });
      if (revoke && !r.revoked && r.message) toast('warning', t('unpair.notRevoked', { why: r.message }));
      setOpen(false);
      setOrg(null);
      void qc.invalidateQueries({ queryKey: K.all });
    } catch (e) {
      toast('error', e instanceof Error ? e.message : t('unpair.failed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="text-start text-[12px] text-ink-3 hover:text-danger">
        {t('unpair.open')}
      </button>
      {open ? (
        <Modal
          title={t('unpair.title')}
          onClose={() => setOpen(false)}
          footer={
            <>
              <Button onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
              <Button variant="danger" loading={busy} onClick={() => void unpair()}>
                {t('unpair.confirm')}
              </Button>
            </>
          }
        >
          <p className="text-[13.5px] text-ink">{t('unpair.body')}</p>
          <div className="mt-3 flex items-center gap-3">
            <span className="flex-1 text-[13px] text-ink">{t('unpair.revoke')}</span>
            <Switch checked={revoke} onChange={setRevoke} label={t('unpair.revoke')} />
          </div>
          {unsent > 0 ? <p className="mt-2 text-[13.5px] font-semibold text-danger">{t('unpair.unsent', { n: unsent })}</p> : null}
        </Modal>
      ) : null}
    </>
  );
}

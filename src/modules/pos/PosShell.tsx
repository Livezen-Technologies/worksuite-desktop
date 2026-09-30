import { useQuery, useQueryClient } from '@tanstack/react-query';
import { lazy, Suspense, useState } from 'react';
import { Icon } from '../../components/Icon';
import { SidePanel } from '../../components/SidePanel';
import { Button, Modal, Spinner, cx } from '../../components/ui';
import { app } from '../../core/app-state';
import { call } from '../../core/bridge';
import { useStore } from '../../core/store';
import { useTab, useTabTitle } from '../../core/tab-context';
import { toast } from '../../core/toasts';
import type { ModuleProps } from '../registry';
import { closeDisplay, fetchOptions, fetchRegisters, forgetTill, openDisplay, PK, syncNow, unreachable, useTill, usePosChanged } from './api';
import Connect from './Connect';
import { useT, type PosKey } from './i18n';
import { Failed, Note, posRoute, TillContext, type PosView, type Till } from './parts';

/**
 * POS, native in WorkSuite Desktop: this computer as a till. Addressed as `/pos?view=register|shift|sales|printers|till`
 * (`&sale=<receipt>` opens a sale in the history); `/pos/display` is the customer display, a window of its own.
 *
 * Until this computer is paired with a till it shows the pairing screen. Tills, registers and POS settings are
 * managed on the web. When WorkSuite does not answer the till keeps selling from its catalogue copy and keeps the
 * sales to send; opening and closing the drawer, and cash in and out, wait for WorkSuite.
 */
const Register = lazy(() => import('./Register'));
const Shift = lazy(() => import('./Shift'));
const Sales = lazy(() => import('./Sales'));
const Printers = lazy(() => import('./Printers'));
const TillScreen = lazy(() => import('./TillScreen'));
const CustomerDisplay = lazy(() => import('./CustomerDisplay'));

const VIEWS: Record<PosView, { label: PosKey; icon: string }> = {
  register: { label: 'pos.register', icon: 'cart' },
  shift: { label: 'pos.shift', icon: 'banknote' },
  sales: { label: 'pos.sales', icon: 'receipt' },
  printers: { label: 'pos.printers', icon: 'printer' },
  till: { label: 'pos.till', icon: 'store' },
};

export default function PosShell({ route, active }: ModuleProps) {
  if (route.split('?')[0] === '/pos/display') {
    return (
      <Suspense fallback={<Spinner />}>
        <CustomerDisplay />
      </Suspense>
    );
  }
  return <Counter active={active} />;
}

function Counter({ active }: { active: boolean }) {
  const t = useT();
  const { query, go: goRoute } = useTab();
  const qc = useQueryClient();
  const raw = (query.get('view') ?? 'register') as PosView;
  const view: PosView = raw in VIEWS ? raw : 'register';
  useTabTitle(`POS · ${t(VIEWS[view].label)}`);
  usePosChanged();
  const perms = useStore(app, (s) => s.bootstrap?.permissions);

  const till = useTill();
  const paired = !!till.data?.till && till.data.till.state !== 'revoked';
  const options = useQuery({ queryKey: PK.options, queryFn: ({ signal }) => fetchOptions(signal), enabled: paired, staleTime: 60_000 });
  const registers = useQuery({ queryKey: PK.registers, queryFn: ({ signal }) => fetchRegisters(signal), enabled: paired, refetchInterval: 60_000 });

  if (till.isError) return <div className="p-6"><Failed text="WorkSuite Desktop could not read which till this computer is." onRetry={() => void till.refetch()} /></div>;
  if (!till.data) return <Spinner label="Opening the till…" />;
  if (!paired) return <Connect status={till.data} onChange={() => void qc.invalidateQueries({ queryKey: PK.all })} />;

  const status = till.data;
  const terminal = status.till!.terminal;
  const offline = (typeof navigator !== 'undefined' && navigator.onLine === false) || unreachable(registers) || unreachable(options);
  const company = options.data?.companies.find((c) => c.id === terminal.org_id) ?? null;
  if (options.isError && !options.data && !offline) return <div className="p-6"><Failed text="What you may do at this till could not be loaded." onRetry={() => void options.refetch()} /></div>;
  if (options.data && !company) {
    return (
      <div className="p-6">
        <Note tone="warning">
          {terminal.name} sells for {terminal.org_name ?? 'another company'}, and you do not sell at a till there. Ask for POS in that company, or pair this computer with one of yours.
        </Note>
      </div>
    );
  }
  const session = registers.data?.session ?? null;
  const may = (p: string) => !!perms && (perms.includes('*') || perms.includes(p));
  const ctx: Till = {
    status,
    options: options.data ?? null,
    company,
    caps: options.data?.capabilities ?? {},
    currency: session?.currency ?? company?.currency ?? '',
    session: session && session.status === 'open' ? session : null,
    registers: registers.data?.items ?? [],
    offline,
    discount: {
      allowed: company?.can.discount ?? may('pos.sale.discount'),
      ceiling: company?.can.max_discount_pct ?? null,
    },
    params: query,
    go: (v, params) => goRoute(posRoute(v, params)),
  };

  return (
    <TillContext.Provider value={ctx}>
      <div className="flex h-full min-h-0">
        <SidePanel id="pos" label="the POS menu">
          <Rail view={view} till={ctx} />
        </SidePanel>
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-ground" aria-label={`POS · ${t(VIEWS[view].label)}`}>
          <SyncBar till={ctx} />
          <div className="min-h-0 flex-1 overflow-y-auto scroll-thin">
            <Suspense fallback={<Spinner />}>
              {view === 'shift' ? <Shift /> : view === 'sales' ? <Sales /> : view === 'printers' ? <Printers /> : view === 'till' ? <TillScreen /> : <Register active={active} />}
            </Suspense>
          </div>
        </main>
      </div>
    </TillContext.Provider>
  );
}

/** Where the till stands with WorkSuite: offline, sales on their way, a refusal, a till no longer accepted. */
function SyncBar({ till }: { till: Till }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const s = till.status;
  const send = async () => {
    setBusy(true);
    try {
      await syncNow();
    } finally {
      setBusy(false);
    }
  };
  const action = (
    <Button size="sm" icon="upload" loading={busy} onClick={() => void send()}>
      {t('pos.sendNow')}
    </Button>
  );
  const notes: React.ReactNode[] = [];
  if (s.problem) notes.push(<Note key="p" tone="danger">{s.problem}</Note>);
  if (till.offline || !s.reachable) notes.push(<Note key="o" tone="warning" action={s.waiting ? action : undefined}>{t('pos.offline')}{s.waiting ? ` ${t('pos.waiting', { n: s.waiting })}.` : ''}</Note>);
  else if (s.waiting) notes.push(<Note key="w" tone="indigo" action={action}>{t('pos.waiting', { n: s.waiting })}</Note>);
  if (s.refused) notes.push(<Note key="r" tone="danger" action={<Button size="sm" onClick={() => till.go('sales')}>{t('pos.sales')}</Button>}>{t('pos.refused', { n: s.refused })}</Note>);
  if (!notes.length) return null;
  return <div className="flex flex-col gap-2 px-5 pt-3">{notes}</div>;
}

function Rail({ view, till }: { view: PosView; till: Till }) {
  const t = useT();
  const qc = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const [display, setDisplay] = useState(false);
  const pending = till.status.waiting + till.status.refused;
  const item = (v: PosView) => {
    const on = view === v;
    return (
      <button
        key={v}
        type="button"
        aria-current={on ? 'page' : undefined}
        onClick={() => till.go(v)}
        className={cx('relative flex h-[34px] shrink-0 items-center gap-[9px] rounded-[8px] pr-2 pl-2.5 text-left', on ? 'bg-selection font-bold text-primary' : 'font-medium text-ink hover:bg-subtle')}
      >
        <span className={cx('absolute top-1.5 bottom-1.5 left-0 w-[3px] rounded-r-[3px]', on ? 'bg-primary' : 'bg-transparent')} />
        <Icon name={VIEWS[v].icon} size={16} className={cx('shrink-0', on ? 'text-primary' : 'text-ink-3')} />
        <span className="min-w-0 flex-1 truncate">{t(VIEWS[v].label)}</span>
        {v === 'sales' && pending ? <span className={cx('rounded-full px-1.5 text-[11px] font-bold tabular-nums', till.status.refused ? 'bg-danger text-white' : 'bg-subtle text-ink-2')}>{pending}</span> : null}
      </button>
    );
  };

  async function toggleDisplay() {
    try {
      if (display) {
        await closeDisplay();
        setDisplay(false);
      } else {
        const r = await openDisplay();
        setDisplay(r.opened);
        if (!r.secondary) toast('info', 'Only one screen is connected: the customer display opened as a window. Move it to the customer’s screen.');
      }
    } catch (e) {
      toast('error', e instanceof Error ? e.message : 'The customer display could not be opened.');
    }
  }

  async function forget(discard: boolean) {
    try {
      await forgetTill(discard);
      setConfirming(false);
      void qc.invalidateQueries({ queryKey: PK.all });
    } catch (e) {
      toast('error', e instanceof Error ? e.message : 'The till could not be forgotten.');
    }
  }

  const terminal = till.status.till!.terminal;
  return (
    <nav aria-label="POS" className="flex w-[220px] shrink-0 flex-col overflow-hidden border-r border-line bg-surface text-[13px] text-ink">
      <div className="flex flex-col gap-0.5 px-2.5 pt-3.5">
        {item('register')}
        {item('shift')}
        {item('sales')}
        <div className="mx-1 my-1.5 border-t border-line" />
        {item('printers')}
        {item('till')}
        <button type="button" onClick={() => void toggleDisplay()} className="flex h-[34px] items-center gap-[9px] rounded-[8px] pl-2.5 text-left font-medium text-ink hover:bg-subtle">
          <Icon name="monitor" size={16} className="text-ink-3" />
          <span className="flex-1 truncate">{t('pos.display')}</span>
          {display ? <span className="h-2 w-2 rounded-full bg-success" aria-label="open" /> : null}
        </button>
      </div>
      <div className="mt-auto flex flex-col gap-2 border-t border-line px-3 py-3">
        <button type="button" onClick={() => void call('security:lock')} className="flex items-center gap-2 text-left text-[12.5px] font-semibold text-ink-2 hover:text-ink">
          <Icon name="lock" size={14} /> {t('pos.lock')}
        </button>
        <button type="button" onClick={() => void call('auth:signOut', {})} className="flex items-center gap-2 text-left text-[12.5px] font-semibold text-ink-2 hover:text-ink" title="Sign out: the next cashier signs in. The till and its unsent sales stay.">
          <Icon name="logout" size={14} /> {t('pos.switchCashier')}
        </button>
        <button type="button" onClick={() => void call('app:openInBrowser', { path: '/pos' })} className="flex items-center gap-2 text-left text-[12.5px] font-semibold text-ink-2 hover:text-ink">
          <Icon name="external" size={14} /> {t('pos.webScreens')}
        </button>
        <div className="text-[12px] text-ink-3">
          <div className="truncate font-semibold text-ink-2">{terminal.name}</div>
          <div className="truncate">{[terminal.branch_name, terminal.warehouse_name].filter(Boolean).join(' · ')}</div>
        </div>
        <button type="button" onClick={() => setConfirming(true)} className="text-left text-[12px] text-ink-3 hover:text-danger">
          {t('pos.forget')}
        </button>
      </div>
      {confirming ? (
        <Modal
          title="Forget this till?"
          onClose={() => setConfirming(false)}
          footer={
            <>
              <Button onClick={() => setConfirming(false)}>Keep it</Button>
              <Button variant="danger" onClick={() => void forget(pending > 0)}>
                Forget the till
              </Button>
            </>
          }
        >
          <p className="text-[13.5px] text-ink">This computer stops being {terminal.name}: its credential, its catalogue copy and its record of sales are removed. To sell here again it is paired anew.</p>
          {pending > 0 ? <p className="mt-2 text-[13.5px] font-semibold text-danger">{pending} sale(s) have not reached WorkSuite, and will be lost.</p> : null}
        </Modal>
      ) : null}
    </nav>
  );
}

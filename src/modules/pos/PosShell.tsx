import { useQuery, useQueryClient } from '@tanstack/react-query';
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Toasts } from '../../app/overlays/Toasts';
import { Button, Spinner, cx } from '../../components/ui';
import { useTab, useTabTitle } from '../../core/tab-context';
import type { ModuleProps } from '../registry';
import { discountRights, fetchOptions, fetchRegisters, PK, unreachable, useTill, usePosChanged } from './api';
import { useKeptCarts } from './cart';
import Connect from './Connect';
import { useT, type PosKey } from './i18n';
import { Failed, Note, posRoute, TillContext, type PosView, type Till } from './parts';
import SyncDrawer from './SyncDrawer';
import TillBar from './TillBar';

/**
 * POS, native in WorkSuite Desktop: this computer as a till. Addressed as `/pos?view=register|shift|sales|printers|till`
 * (`&sale=<receipt>` opens a sale in the history); `/pos/display` is the customer display, a window of its own.
 *
 * Until this computer is paired with a till it shows the pairing screen. Tills, registers and POS settings are
 * managed on the web. When WorkSuite does not answer the till keeps selling from its catalogue copy and keeps the
 * sales to send; opening and closing the drawer, and cash in and out, wait for WorkSuite.
 */
const Register = lazy(() => import('./Register'));
const Shift = lazy(() => import('./ShiftScreen'));
const Sales = lazy(() => import('./Sales'));
const TillSettings = lazy(() => import('./TillSettings'));
const CustomerDisplay = lazy(() => import('./CustomerDisplay'));

const VIEWS: Record<PosView, { label: PosKey; icon: string }> = {
  register: { label: 'pos.register', icon: 'cart' },
  shift: { label: 'pos.shift', icon: 'banknote' },
  sales: { label: 'pos.sales', icon: 'receipt' },
  printers: { label: 'pos.settings', icon: 'printer' },
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

  const till = useTill();
  const paired = !!till.data?.till && till.data.till.state !== 'revoked';
  const options = useQuery({ queryKey: PK.options, queryFn: ({ signal }) => fetchOptions(signal), enabled: paired, staleTime: 60_000 });
  const registers = useQuery({ queryKey: PK.registers, queryFn: ({ signal }) => fetchRegisters(signal), enabled: paired, refetchInterval: 60_000 });
  // The open and held sales, as the main process keeps them for this till.
  useKeptCarts(paired ? String(till.data!.till!.terminal.id) : null);
  // Full-screen counter mode: the till alone on the screen (the element, not the window: Esc leaves it).
  const root = useRef<HTMLDivElement>(null);
  const [full, setFull] = useState(false);
  const [syncOpen, setSyncOpen] = useState(false);
  useEffect(() => {
    const sync = () => setFull(!!root.current && document.fullscreenElement === root.current);
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);
  const toggleFull = useCallback(async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await root.current?.requestFullscreen();
    } catch {
      /* Not allowed here (a test, an older shell): the till stays in its tab. */
    }
  }, []);

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
  const ctx: Till = {
    status,
    options: options.data ?? null,
    company,
    caps: options.data?.capabilities ?? {},
    currency: session?.currency ?? company?.currency ?? '',
    session: session && session.status === 'open' ? session : null,
    registers: registers.data?.items ?? [],
    offline,
    // WorkSuite's word on it, per company (`can.discount`, `max_discount_pct`, `discount_override`); none without it.
    discount: discountRights(company?.can),
    params: query,
    go: (v, params) => goRoute(posRoute(v, params)),
  };

  return (
    <TillContext.Provider value={ctx}>
      <div ref={root} className="pos-scope relative flex h-full min-h-0 flex-col bg-pos-ground text-ink">
        <TillBar till={ctx} view={view} full={full} onFull={() => void toggleFull()} onSync={() => setSyncOpen(true)} />
        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden" aria-label={`POS · ${t(VIEWS[view].label)}`}>
          <SyncBar till={ctx} />
          <div className={cx('min-h-0 flex-1', view === 'register' ? 'overflow-hidden' : 'overflow-y-auto scroll-thin')}>
            <Suspense fallback={<Spinner />}>
              {view === 'shift' ? <Shift /> : view === 'sales' ? <Sales /> : view === 'printers' || view === 'till' ? <TillSettings initial={view === 'till' ? 'till' : 'devices'} /> : <Register active={active} />}
            </Suspense>
          </div>
        </main>
        {syncOpen ? <SyncDrawer till={ctx} onClose={() => setSyncOpen(false)} /> : null}
        {/* In full screen only this element is drawn: the app's toasts are shown from inside it. */}
        {full ? <Toasts /> : null}
      </div>
    </TillContext.Provider>
  );
}

/** What needs a person, under the till bar: a problem WorkSuite reported, sales it refused. (Online, offline and what
 * waits to be sent are the till bar's pill and its drawer.) */
function SyncBar({ till }: { till: Till }) {
  const t = useT();
  const s = till.status;
  const notes: React.ReactNode[] = [];
  if (s.problem) notes.push(<Note key="p" tone="danger">{s.problem}</Note>);
  if (s.refused) notes.push(<Note key="r" tone="danger" action={<Button size="sm" onClick={() => till.go('sales')}>{t('pos.sales')}</Button>}>{t('pos.refused', { n: s.refused })}</Note>);
  if (!notes.length) return null;
  return <div className="flex flex-col gap-2 px-5 pt-3">{notes}</div>;
}

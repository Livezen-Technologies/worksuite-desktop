import { useQuery } from '@tanstack/react-query';
import { lazy, Suspense, type MouseEvent } from 'react';
import { useTab, useTabTitle } from '../../core/tab-context';
import { Icon } from '../../components/Icon';
import { SidePanel } from '../../components/SidePanel';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import type { ModuleProps } from '../registry';
import { fetchAccess, fetchHome, K } from './api';
import { useOnline, useStation } from './parts';

/**
 * Cheque Manager on the desktop (Cheque SRS v1.0; the "Desktop — certified print station" boards D01–D06), addressed
 * as `/cheque?tab=<view>` with `&batch=` and `&version=`/`&profile=` for the record a screen is about. Cheques print
 * only from here, through the main process, at 100 % (§2.2). Printing needs WorkSuite: offline, nothing prints.
 */
const Home = lazy(() => import('./Home'));
const Queue = lazy(() => import('./Queue'));
const Calibration = lazy(() => import('./Calibration'));
const Batches = lazy(() => import('./Batches'));
const BatchRun = lazy(() => import('./BatchRun'));

export type ChequeView = 'home' | 'queue' | 'calibration' | 'batches' | 'batch';
const VIEWS = new Set<string>(['home', 'queue', 'calibration', 'batches', 'batch']);
const TITLES: Record<ChequeView, string> = { home: 'Home', queue: 'Print queue', calibration: 'Calibration', batches: 'Batches', batch: 'Batch' };
const num = (v: string | null) => (v && /^\d+$/.test(v) ? Number(v) : null);

export default function ChequeShell(_props: ModuleProps) {
  const { query, go, openInNewTab } = useTab();
  const online = useOnline();
  const asked = query.get('tab') ?? 'home';
  const batchId = num(query.get('batch'));
  const view: ChequeView = VIEWS.has(asked) ? (asked === 'batch' && !batchId ? 'batches' : (asked as ChequeView)) : 'home';
  useTabTitle(`Cheque Manager · ${TITLES[view]}`);
  const st = useStation();
  const access = useQuery({ queryKey: K.access, queryFn: ({ signal }) => fetchAccess(signal), staleTime: 60_000, enabled: online });
  const home = useQuery({ queryKey: K.home, queryFn: ({ signal }) => fetchHome(signal), enabled: online && !!access.data, refetchInterval: 30_000 });
  const to = (v: ChequeView, extra = '', newTab = false) => {
    const r = `/cheque?tab=${v}${extra}`;
    if (newTab) openInNewTab(r, `Cheque Manager · ${TITLES[v]}`);
    else go(r);
  };

  if (!online) {
    return (
      <div className="m-6 max-w-[520px] text-[13px] text-ink-2">
        <p className="m-0 font-bold text-ink">Cheque printing needs WorkSuite.</p>
        <p className="m-0 mt-1">Every print is checked by the server first, so nothing can print while this computer is offline.</p>
      </div>
    );
  }
  if (access.isPending || st.isPending) return <Spinner />;
  if (access.error) return <div className="m-6"><ErrorNote error={access.error} onRetry={() => void access.refetch()} /></div>;

  const counts: Partial<Record<ChequeView, number>> = { queue: home.data?.ready_to_print };
  const at: ChequeView = view === 'batch' ? 'batches' : view;
  const item = (id: ChequeView, label: string, icon: string) => (
    <button
      key={id}
      type="button"
      aria-current={at === id ? 'page' : undefined}
      onClick={(e: MouseEvent) => to(id, '', e.metaKey || e.ctrlKey)}
      className={cx('flex h-[32px] shrink-0 items-center gap-[9px] rounded-[7px] pr-2 pl-2.5 text-left', at === id ? 'bg-[#EEF1FD] font-bold text-[#3B5BDB] dark:bg-selection dark:text-primary' : 'font-medium text-ink-2 hover:bg-subtle')}
    >
      <Icon name={icon} size={16} className={cx('shrink-0', at === id ? 'text-primary' : 'text-ink-3')} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {counts[id] ? <span className="shrink-0 rounded-[9px] bg-[#EAEDFB] px-1.5 text-[11px] font-bold text-[#23349E] tabular-nums dark:bg-primary/15 dark:text-primary">{counts[id]}</span> : null}
    </button>
  );

  return (
    <div className="flex h-full min-h-0">
      <SidePanel id="cheque" label="the Cheque Manager menu">
        <nav aria-label="Cheque Manager" className="flex w-[232px] shrink-0 flex-col overflow-hidden border-r border-line bg-[#FBFBFD] text-[13px] text-ink dark:bg-surface">
          <div className="px-4 pt-3.5 pb-1">
            <div className="text-[15px] font-extrabold">Cheque Manager</div>
            <div className="truncate text-[11.5px] text-ink-3">{st.data?.host ? `Print station · ${st.data.host}` : 'Print station'}</div>
          </div>
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2.5 pt-2 pb-2.5 scroll-thin">
            {item('home', 'Home', 'home')}
            {item('queue', 'Print queue', 'printer')}
            {item('batches', 'Batches', 'list')}
            {item('calibration', 'Calibration', 'sliders')}
          </div>
        </nav>
      </SidePanel>
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-ground" aria-label={`Cheque Manager · ${TITLES[view]}`}>
        <div className="min-h-0 flex-1 overflow-y-auto px-[22px] py-[18px] scroll-thin">
          <Suspense fallback={<Spinner />}>
            {view === 'home' ? (
              <Home data={home} access={access.data} onGo={(v, extra) => to(v, extra)} />
            ) : view === 'queue' ? (
              <Queue access={access.data} />
            ) : view === 'calibration' ? (
              <Calibration access={access.data} versionId={num(query.get('version'))} profileId={num(query.get('profile'))} onPick={(v, p) => go(`/cheque?tab=calibration&version=${v}&profile=${p}`)} />
            ) : view === 'batches' ? (
              <Batches onOpen={(id) => to('batch', `&batch=${id}`)} />
            ) : batchId ? (
              <BatchRun id={batchId} access={access.data} onBack={() => to('batches')} />
            ) : null}
          </Suspense>
        </div>
        <div role="status" className="shrink-0 border-t border-line bg-surface px-4 py-1 text-[11.5px] text-ink-2">
          {st.data?.device_id ? `${st.data.printers.length} ${st.data.printers.length === 1 ? 'printer' : 'printers'} on this computer · cheques print at 100 % only from this app` : 'This computer is not registered with WorkSuite, so it cannot print cheques.'}
        </div>
      </main>
    </div>
  );
}

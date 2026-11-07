import { lazy, Suspense } from 'react';
import { SERVICE_VIEWS, type ServiceView } from '@shared/service';
import { call } from '../../core/bridge';
import { useTab, useTabTitle } from '../../core/tab-context';
import { Icon } from '../../components/Icon';
import { SidePanel } from '../../components/SidePanel';
import { cx, Spinner } from '../../components/ui';
import type { ModuleProps } from '../registry';
import { useOffline } from './api';

/**
 * Service & Repair on the desktop, addressed as `/service?view=<area>`:
 * `home` the dashboard; `jobs` the repair list (`&scope=`, `&job=<id>` its job card beside it; `&solo=1` alone in a
 * window); `board` the Kanban board; `checkin` a new job; `devices` the registry. Technicians, warranty claims,
 * pickups, the customer portal, reports and settings open on the web.
 */
const Dashboard = lazy(() => import('./Dashboard'));
const Jobs = lazy(() => import('./Jobs'));
const JobCard = lazy(() => import('./JobCard'));
const Board = lazy(() => import('./Board'));
const CheckIn = lazy(() => import('./CheckIn'));
const Devices = lazy(() => import('./Devices'));

const TITLES: Record<ServiceView, string> = { home: 'Dashboard', jobs: 'Repair jobs', board: 'Board', checkin: 'New job', devices: 'Devices' };
const ICONS: Record<ServiceView, string> = { home: 'grid', jobs: 'inbox', board: 'kanban', checkin: 'user-plus', devices: 'box' };
const WEB: Array<[string, string, string]> = [['Technicians', '/service/technicians', 'users'], ['Warranty', '/service/warranty', 'shield'], ['Pickup & Delivery', '/service/pickups', 'map-pin'], ['Reports', '/service/reports', 'chart'], ['Settings', '/service/settings', 'settings']];
const idOf = (v: string | null) => (v && /^[\w-]{1,64}$/.test(v) ? v : null);

export default function ServiceShell(_props: ModuleProps) {
  const { query, go, openInNewTab } = useTab();
  const asked = query.get('view') ?? '';
  const view: ServiceView = (SERVICE_VIEWS as readonly string[]).includes(asked) ? (asked as ServiceView) : idOf(query.get('job')) ? 'jobs' : 'home';
  const job = idOf(query.get('job'));
  const scope = query.get('scope') ?? 'active';
  const offline = useOffline();
  useTabTitle(`Service · ${TITLES[view]}`);
  const web = (path: string) => void call('app:openInBrowser', { path });
  const openJob = (id: string) => go(`/service?view=jobs&scope=${encodeURIComponent(scope)}&job=${encodeURIComponent(id)}`);

  if (query.get('solo') === '1' && job) return <Suspense fallback={<Spinner />}><JobCard id={job} offline={offline} onWeb={web} onRoute={(r) => openInNewTab(r)} /></Suspense>;

  return (
    <div className="flex h-full min-h-0">
      <SidePanel id="service" label="the Service & Repair menu">
        <nav aria-label="Service & Repair" className="flex w-[210px] shrink-0 flex-col overflow-y-auto border-r border-line bg-rail px-2.5 py-3 text-[13px] text-ink scroll-thin dark:bg-surface">
          {SERVICE_VIEWS.map((v) => (
            <button key={v} type="button" aria-current={v === view ? 'page' : undefined} onClick={() => go(`/service?view=${v}`)}
              className={cx('flex h-[32px] shrink-0 items-center gap-[9px] rounded-[7px] px-2.5 text-left', v === view ? 'bg-yellow-bg font-bold text-warning dark:bg-selection dark:text-primary' : 'font-medium text-ink-2 hover:bg-subtle')}>
              <Icon name={ICONS[v]} size={16} className="shrink-0" /><span className="flex-1 truncate">{TITLES[v]}</span>
            </button>
          ))}
          <div className="mt-3 mb-0.5 px-2 text-[10.5px] font-bold tracking-[.6px] text-ink-3 uppercase">On the web</div>
          {WEB.map(([l, p, i]) => (
            <button key={p} type="button" title="Opens on the web" onClick={() => web(p)} className="flex h-[32px] shrink-0 items-center gap-[9px] rounded-[7px] px-2.5 text-left font-medium text-ink-2 hover:bg-subtle">
              <Icon name={i} size={16} className="shrink-0 text-ink-3" /><span className="flex-1 truncate">{l}</span><Icon name="external" size={12} className="text-ink-3" />
            </button>
          ))}
        </nav>
      </SidePanel>
      <main className="min-w-0 flex-1 overflow-auto bg-ground" aria-label={`Service · ${TITLES[view]}`}>
        {offline ? <p role="status" className="m-3 mb-0 rounded-[8px] bg-warning-bg px-3 py-1.5 text-[12.5px] font-semibold text-warning">Offline — showing what was last saved. Changes are off until you are back online.</p> : null}
        <Suspense fallback={<Spinner />}>
          {view === 'home' ? <Dashboard onJobs={(s) => go(`/service?view=jobs&scope=${encodeURIComponent(s)}`)} />
            : view === 'board' ? <Board offline={offline} onOpen={openJob} />
            : view === 'checkin' ? <CheckIn offline={offline} onCreated={openJob} />
            : view === 'devices' ? <Devices onJob={openJob} />
            : (
              <div className="flex h-full min-h-0">
                <div className="min-w-0 flex-1"><Jobs scope={scope} onScope={(s) => go(`/service?view=jobs&scope=${encodeURIComponent(s)}`)} selected={job} onOpen={openJob} /></div>
                {job ? <aside className="w-[min(640px,55%)] shrink-0 border-l border-line bg-surface"><JobCard id={job} offline={offline} onWeb={web} onRoute={(r) => openInNewTab(r)} onClose={() => go(`/service?view=jobs&scope=${encodeURIComponent(scope)}`)} /></aside> : null}
              </div>
            )}
        </Suspense>
      </main>
    </div>
  );
}

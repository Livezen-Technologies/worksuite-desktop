import { lazy, Suspense } from 'react';
import { AMC_NATIVE_VIEWS, type AmcView } from '@shared/amc';
import { call } from '../../core/bridge';
import { useTab, useTabTitle } from '../../core/tab-context';
import { Icon } from '../../components/Icon';
import { SidePanel } from '../../components/SidePanel';
import { cx, Spinner } from '../../components/ui';
import type { ModuleProps } from '../registry';
import { LISTS, useOffline, useOptions } from './api';

/**
 * AMC & Service on the desktop (WS-AMC-SRS-001 T-15), addressed as the server's links are, `/amc?view=<area>`:
 * - `home` D-01 the dashboard; `dispatch` D-02 the hourly timeline (`&give=<request>` picks a request to give out);
 * - `requests` D-03 the desk's requests, `&request=<id>` one of them (`&solo=1` alone, in its own window);
 * - `contracts`, `renewals`, `estimates`, `units`, `warranties`: the server's paged lists and a record's detail.
 * The schedule, sites, claims, technicians, plans, reports and settings open on the web.
 */
const Dashboard = lazy(() => import('./Dashboard'));
const Dispatch = lazy(() => import('./Dispatch'));
const RequestWindow = lazy(() => import('./RequestWindow'));
const ListView = lazy(() => import('./ListView'));

const TITLES: Record<AmcView, string> = { home: 'Dashboard', dispatch: 'Dispatch', requests: 'Requests', contracts: 'Contracts', renewals: 'Renewals', estimates: 'Estimates', units: 'Units', warranties: 'Warranties' };
const ICONS: Record<AmcView, string> = { home: 'grid', dispatch: 'calendar-clock', requests: 'inbox', contracts: 'file-text', renewals: 'repeat', estimates: 'receipt', units: 'box', warranties: 'shield' };
const WEB: Array<[string, string, string]> = [['Schedule', '/amc?view=schedule', 'calendar'], ['Sites', '/amc?view=sites', 'map-pin'], ['Claims', '/amc?view=claims', 'file-text'], ['Technicians', '/amc?view=technicians', 'users'], ['Reports', '/amc?view=reports', 'chart'], ['Settings', '/amc?view=settings', 'settings']];
const num = (v: string | null) => (v && /^\d{1,12}$/.test(v) ? Number(v) : null);

export default function AmcShell(_props: ModuleProps) {
  const { query, go, openInWindow } = useTab();
  const asked = query.get('view') ?? query.get('tab') ?? '';
  const view: AmcView = (AMC_NATIVE_VIEWS as readonly string[]).includes(asked) ? (asked as AmcView) : 'home';
  const offline = useOffline();
  const options = useOptions();
  const solo = query.get('solo') === '1';
  useTabTitle(`AMC · ${TITLES[view]}`);
  const web = (path: string) => void call('app:openInBrowser', { path });
  const openRequest = (id: number) => go(`/amc?view=requests&request=${id}`);
  const popOut = (id: number) => openInWindow(`/amc?view=requests&request=${id}&solo=1`, `Request ${id}`);

  if (options.isPending) return <Spinner />;
  if (options.isError && !options.data) return <p className="m-6 text-[13px] text-ink-2">AMC & Service is not open to you, or the server could not be reached.</p>;
  const opts = options.data?.data;

  // D-03: one request alone, in a window of its own.
  if (solo && view === 'requests' && num(query.get('request'))) {
    return (
      <Suspense fallback={<Spinner />}>
        <RequestWindow id={num(query.get('request'))!} options={opts} offline={offline} solo onGive={(id) => go(`/amc?view=dispatch&give=${id}`)} />
      </Suspense>
    );
  }

  const def = LISTS[view];
  return (
    <div className="flex h-full min-h-0">
      <SidePanel id="amc" label="the AMC menu">
        <nav aria-label="AMC & Service" className="flex w-[210px] shrink-0 flex-col overflow-y-auto border-r border-line bg-rail px-2.5 py-3 text-[13px] text-ink scroll-thin dark:bg-surface">
          {AMC_NATIVE_VIEWS.map((v) => (
            <button key={v} type="button" aria-current={v === view ? 'page' : undefined} onClick={() => go(`/amc?view=${v}`)}
              className={cx('flex h-[32px] shrink-0 items-center gap-[9px] rounded-[7px] px-2.5 text-left', v === view ? 'bg-yellow-bg font-bold text-warning dark:bg-selection dark:text-primary' : 'font-medium text-ink-2 hover:bg-subtle')}>
              <Icon name={ICONS[v]} size={16} className="shrink-0" />
              <span className="flex-1 truncate">{TITLES[v]}</span>
            </button>
          ))}
          <div className="mt-3 mb-0.5 px-2 text-[10.5px] font-bold tracking-[.6px] text-ink-3 uppercase">On the web</div>
          {WEB.map(([l, p, i]) => (
            <button key={p} type="button" title="Opens on the web" onClick={() => web(p)} className="flex h-[32px] shrink-0 items-center gap-[9px] rounded-[7px] px-2.5 text-left font-medium text-ink-2 hover:bg-subtle">
              <Icon name={i} size={16} className="shrink-0 text-ink-3" />
              <span className="flex-1 truncate">{l}</span>
              <Icon name="external" size={12} className="text-ink-3" />
            </button>
          ))}
        </nav>
      </SidePanel>
      <main className="min-w-0 flex-1 overflow-auto bg-ground" aria-label={`AMC · ${TITLES[view]}`}>
        {offline ? <p role="status" className="m-3 mb-0 rounded-[8px] bg-warning-bg px-3 py-1.5 text-[12.5px] font-semibold text-warning">Offline — showing what was last saved. Changes are off until you are back online.</p> : null}
        <Suspense fallback={<Spinner />}>
          {view === 'home' ? (
            <Dashboard onView={(v) => go(`/amc?view=${v}`)} onRequest={openRequest} />
          ) : view === 'dispatch' ? (
            <Dispatch options={opts} offline={offline} give={num(query.get('give'))} onRequest={openRequest} />
          ) : view === 'requests' && num(query.get('request')) ? (
            <RequestWindow id={num(query.get('request'))!} options={opts} offline={offline} onBack={() => go('/amc?view=requests')} onPopOut={popOut} onGive={(id) => go(`/amc?view=dispatch&give=${id}`)} />
          ) : def ? (
            <ListView key={view} def={def} selected={num(query.get(def.param))} onSelect={(id) => go(`/amc?view=${view}${id ? `&${def.param}=${id}` : ''}`)} onWeb={web} />
          ) : null}
        </Suspense>
      </main>
    </div>
  );
}

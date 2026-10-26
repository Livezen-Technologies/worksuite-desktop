import { useQuery } from '@tanstack/react-query';
import { lazy, Suspense } from 'react';
import { call } from '../../core/bridge';
import { useTab, useTabTitle } from '../../core/tab-context';
import { Spinner } from '../../components/ui';
import type { ModuleProps } from '../registry';
import { hostStatus, K, useLabelEvents } from './api';
import { LabelRail, VIEWS, type LabelView } from './parts';

/**
 * Label Studio on the desktop (WS-LABEL-SRS-001 §4.27 FR-DSK-01…06, the desktop boards D01–D07), addressed as
 * `/label?tab=<view>` with `&template=` for the designer and `&job=` for a batch. This computer prints; the server
 * renders, allocates and keeps the queue (docs/label-api.md on the server).
 */
const Home = lazy(() => import('./Home'));
const Designer = lazy(() => import('./Designer'));
const Station = lazy(() => import('./Station'));
const Printers = lazy(() => import('./Printers'));
const Batch = lazy(() => import('./Batch'));
const Gateway = lazy(() => import('./Gateway'));

const TITLES: Record<LabelView, string> = { home: 'Home', designer: 'Designer', station: 'Print station', printers: 'Printers', batch: 'Running batches', gateway: 'Print Gateway' };

export default function LabelShell({ active }: ModuleProps) {
  const { query, go, openInNewTab } = useTab();
  const asked = query.get('tab') ?? 'home';
  const view = (VIEWS.has(asked) ? asked : 'home') as LabelView;
  useTabTitle(`Label Studio · ${TITLES[view]}`);
  useLabelEvents();
  const host = useQuery({ queryKey: K.host, queryFn: hostStatus, refetchInterval: active ? 10_000 : false });
  const waiting = (host.data?.jobs ?? []).filter((j) => j.state === 'interrupted').length;
  const to = (v: LabelView, extra = '', newTab = false) => {
    const route = `/label?tab=${v}${extra}`;
    if (newTab) openInNewTab(route, `Label Studio · ${TITLES[v]}`);
    else go(route);
  };
  const props = { to, active };
  return (
    <div className="flex h-full min-h-0">
      <LabelRail view={view} counts={{ batch: waiting }} onPick={(v, n) => to(v, '', n)} onWeb={(path) => void call('app:openInBrowser', { path })} />
      <main className="min-w-0 flex-1 overflow-y-auto bg-ground scroll-thin">
        <Suspense fallback={<Spinner />}>
          {view === 'home' ? <Home {...props} /> : null}
          {view === 'designer' ? <Designer {...props} template={query.get('template')} /> : null}
          {view === 'station' ? <Station {...props} /> : null}
          {view === 'printers' ? <Printers {...props} /> : null}
          {view === 'batch' ? <Batch {...props} job={query.get('job')} /> : null}
          {view === 'gateway' ? <Gateway {...props} /> : null}
        </Suspense>
      </main>
    </div>
  );
}

export interface ViewProps {
  to: (v: LabelView, extra?: string, newTab?: boolean) => void;
  active: boolean;
}

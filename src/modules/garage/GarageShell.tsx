import { useQuery } from '@tanstack/react-query';
import { lazy, Suspense, useEffect, useState } from 'react';
import { useTab, useTabTitle } from '../../core/tab-context';
import { ErrorNote, Spinner } from '../../components/ui';
import type { ModuleProps } from '../registry';
import { canAny, fetchBoard, K, needsSetup, useOnline, useOptions, type Options } from './api';
import { GarageRail } from './Rail';
import { EXTRA_VIEWS } from './registry';
import { LISTS, OfflineBanner, readRoute } from './parts';

/**
 * Garage & Vehicle Service Center: the rail, and the screen it points at
 * (routes: `readRoute` in parts.tsx). A job card, a Vehicle 360° or a
 * customer opens in place of the screen, with a way back to it. Links from
 * the server's notifications (`/garage?job=ID`) and `worksuite://garage/jobs/<id>`
 * and `…/vehicles/<id>` open here.
 *
 * Keys while this tab is in front and nothing is being typed or asked:
 * N a new walk-in, O the overview, B the board, J the jobs, C customers,
 * V vehicles, / the screen's search.
 */
const Overview = lazy(() => import('./Overview'));
const Board = lazy(() => import('./Board'));
const Jobs = lazy(() => import('./Jobs'));
const WalkIn = lazy(() => import('./WalkIn'));
const Customers = lazy(() => import('./Customers'));
const Vehicles = lazy(() => import('./Vehicles'));
const Vehicle360 = lazy(() => import('./Vehicle360'));
const JobCard = lazy(() => import('./JobCard'));
const Setup = lazy(() => import('./Setup'));
const Settings = lazy(() => import('./Settings'));

const TITLES: Record<string, string> = {
  overview: 'Overview',
  board: 'Job board',
  jobs: 'Jobs',
  walkin: 'New walk-in',
  customers: 'Customers',
  vehicles: 'Vehicles',
  setup: 'Set-up',
  settings: 'Settings',
};
const ORG_KEY = 'garage.org';
const EXTRA_IDS: ReadonlySet<string> = new Set(EXTRA_VIEWS.map((v) => v.id));

function savedOrg(): string {
  try {
    return localStorage.getItem(ORG_KEY) ?? '';
  } catch {
    return '';
  }
}

/** The screen a reader lands on when none was asked: set-up while their garage is not set up (FR-APP-04), else the first they may use. */
export function landing(options: Options, org: string): string {
  if (needsSetup(options, org).length) return 'setup';
  if (canAny(options, 'dashboard', org)) return 'overview';
  if (canAny(options, 'view', org)) return 'board';
  if (canAny(options, 'vehicles', org)) return 'vehicles';
  return 'customers';
}

export default function GarageShell({ active }: ModuleProps) {
  const { query, path, go } = useTab();
  const options = useOptions();
  const online = useOnline();
  const [picked, setPicked] = useState(savedOrg);
  const route = readRoute(path, query, EXTRA_IDS);
  const opts = options.data?.data;
  const companies = opts?.companies ?? [];
  // A company no longer held (or never) reads as every company.
  const org = picked && companies.length && !companies.some((c) => String(c.id) === picked) ? '' : picked;
  const canJobs = canAny(opts, 'view', org);
  const board = useQuery({ queryKey: K.board(org, {}), queryFn: ({ signal }) => fetchBoard(org, {}, signal), enabled: !!opts && canJobs, refetchInterval: 60_000 });
  const counts = Object.fromEntries((board.data?.data.columns ?? []).map((c) => [c.code, c.count]));
  const view = route.view ?? (opts ? landing(opts, org) : 'overview');
  const title = route.job ? 'Job card' : route.vehicle ? 'Vehicle' : route.customer ? 'Customer' : view === 'jobs' ? (LISTS.find((l) => l.id === route.list)?.label ?? 'Jobs') : (TITLES[view] ?? EXTRA_VIEWS.find((v) => v.id === view)?.label ?? 'Garage');
  useTabTitle(`Garage · ${title}`);

  const show = {
    overview: canAny(opts, 'dashboard', org),
    jobs: canJobs,
    customers: canJobs || canAny(opts, 'vehicles', org),
    vehicles: canAny(opts, 'vehicles', org),
    setup: canAny(opts, 'settings', org),
    settings: canAny(opts, 'settings', org),
  };
  const canWalkIn = canAny(opts, 'create', org);
  const extra = EXTRA_VIEWS.filter((v) => !v.can || canAny(opts, v.can, org));

  // Where this screen is, without the one-off asks (a record open over it), to come back to.
  const base = (() => {
    const q = new URLSearchParams(query);
    for (const k of ['job', 'jt', 'vehicle', 'customer', 'new']) q.delete(k);
    q.set('view', view);
    return `/garage?${q.toString()}`;
  })();
  const nav = {
    view: (v: string, list?: string) => go(`/garage?view=${v}${list ? `&list=${list}` : ''}`),
    job: (id: number, tab?: string) => go(`${base}&job=${id}${tab ? `&jt=${tab}` : ''}`),
    vehicle: (id: number) => go(`${base}&vehicle=${id}`),
    customer: (id: number) => go(`${base}&customer=${id}`),
    back: () => go(base),
    go,
  };
  const chooseOrg = (v: string) => {
    setPicked(v);
    try {
      localStorage.setItem(ORG_KEY, v);
    } catch {
      /* a convenience */
    }
  };

  // Keys while this tab is in front and nothing is being typed or asked.
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey || document.querySelector('[role="dialog"]')) return;
      if (t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return;
      const k = e.key.toLowerCase();
      if (k === 'n' && canWalkIn) go('/garage?view=walkin');
      else if (k === 'o' && show.overview) go('/garage?view=overview');
      else if (k === 'b' && show.jobs) go('/garage?view=board');
      else if (k === 'j' && show.jobs) go('/garage?view=jobs&list=open');
      else if (k === 'c' && show.customers) go('/garage?view=customers');
      else if (k === 'v' && show.vehicles) go('/garage?view=vehicles');
      else if (e.key === '/') document.querySelector<HTMLInputElement>('input[data-garage-search]')?.focus();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (options.isLoading) return <Spinner />;
  if (options.error || !opts)
    return (
      <div className="m-6">
        <ErrorNote error={options.error ?? new Error('Garage could not be read.')} onRetry={() => void options.refetch()} />
      </div>
    );
  if (!companies.length)
    return <p className="m-6 max-w-lg text-[13px] text-ink-2">Garage is not open to you in any company. Your administrator gives access to Garage and its permissions company by company.</p>;

  const current = route.job || route.vehicle || route.customer ? null : view === 'jobs' ? `jobs:${route.list ?? 'open'}` : view;
  const main = (() => {
    if (route.job) return <JobCard key={route.job} id={route.job} tab={route.jobTab} options={opts} online={online} onTab={(t) => nav.job(route.job!, t)} onBack={nav.back} onJob={(id) => nav.job(id)} onVehicle={nav.vehicle} onCustomer={nav.customer} />;
    if (route.vehicle) return <Vehicle360 key={route.vehicle} id={route.vehicle} options={opts} online={online} onBack={nav.back} onJob={(id) => nav.job(id)} onCustomer={nav.customer} onWalkIn={canWalkIn ? (vid) => go(`/garage?view=walkin&vehicle_id=${vid}`) : null} />;
    switch (view) {
      case 'overview':
        return <Overview org={org} options={opts} onGo={go} onJob={(id) => nav.job(id)} onSetup={() => nav.view('setup')} />;
      case 'board':
        return <Board org={org} options={opts} online={online} onJob={(id) => nav.job(id)} />;
      case 'jobs':
        return <Jobs key={`${route.list}:${query.toString()}`} org={org} options={opts} list={route.list} query={query} onJob={(id) => nav.job(id)} onGo={go} />;
      case 'walkin':
        return <WalkIn org={org} options={opts} online={online} seedVehicle={query.get('vehicle_id')} onDone={(id) => go(`/garage?view=board&job=${id}&jt=checkin`)} onJob={(id) => nav.job(id)} />;
      case 'customers':
        return <Customers org={org} options={opts} online={online} open={route.customer} onOpen={nav.customer} onBack={nav.back} onJob={(id) => nav.job(id)} onVehicle={nav.vehicle} />;
      case 'vehicles':
        return <Vehicles org={org} options={opts} online={online} onVehicle={nav.vehicle} />;
      case 'setup':
        return <Setup org={org} options={opts} online={online} onWalkIn={canWalkIn ? () => nav.view('walkin') : null} />;
      case 'settings':
        return <Settings org={org} options={opts} onSetup={() => nav.view('setup')} />;
      default: {
        const X = EXTRA_VIEWS.find((v) => v.id === view)?.component;
        return X ? <X org={org} options={opts} online={online} onJob={(id, tab) => nav.job(id, tab)} /> : null;
      }
    }
  })();

  return (
    <div className="flex h-full min-h-0">
      <GarageRail
        current={current}
        onView={nav.view}
        onWalkIn={canWalkIn ? () => nav.view('walkin') : null}
        counts={counts}
        org={org}
        companies={companies}
        onOrg={chooseOrg}
        show={show}
        extra={extra}
        setupLeft={needsSetup(opts, org).length}
      />
      <main className="min-w-0 flex-1 overflow-y-auto bg-ground scroll-thin" aria-label={`Garage · ${title}`}>
        {options.data?.offline ? (
          <div className="px-6 pt-4">
            <OfflineBanner cachedAt={options.data.cachedAt} />
          </div>
        ) : null}
        <Suspense fallback={<Spinner />}>{main}</Suspense>
      </main>
    </div>
  );
}

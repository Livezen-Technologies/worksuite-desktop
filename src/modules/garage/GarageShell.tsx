import { useQuery } from '@tanstack/react-query';
import { lazy, Suspense, useState } from 'react';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { Button, ErrorNote, Spinner, cx } from '../../components/ui';
import { app } from '../../core/app-state';
import { useStore } from '../../core/store';
import { useTab, useTabTitle } from '../../core/tab-context';
import type { ModuleProps } from '../registry';
import { gGet, K, mayIn, type Options } from './api';
import { GarageContext, openWeb, type Garage, type GarageView } from './parts';

/**
 * Garage, native in WorkSuite Desktop. Addressed as
 * `/garage?view=overview|board|jobs|walkin|mywork|parts` (`&list=` for a job
 * list), a job as `?job=<id>` — what the server's notifications carry — or
 * `/garage/jobs/<id>` (the deep link). `?checkin=<id>` opens that job, whose
 * check-in is on the web for now.
 *
 * The counter, the board, the technician's screen and the parts counter are
 * here; check-in with its photos and signature, estimates, QC and delivery,
 * vehicles, customers, reports and set-up open in WorkSuite on the web from
 * the rail and the job card.
 */
const Overview = lazy(() => import('./Overview'));
const Board = lazy(() => import('./Board'));
const Jobs = lazy(() => import('./Jobs'));
const WalkIn = lazy(() => import('./WalkIn'));
const MyWork = lazy(() => import('./MyWork'));
const PartsCounter = lazy(() => import('./PartsCounter'));
const JobCard = lazy(() => import('./JobCard'));

const VIEWS: Record<GarageView, { label: string; icon: string; perm?: string }> = {
  overview: { label: 'Overview', icon: 'home' },
  board: { label: 'Job board', icon: 'kanban', perm: 'garage.job.view' },
  jobs: { label: 'Jobs', icon: 'list', perm: 'garage.job.view' },
  walkin: { label: 'New walk-in', icon: 'user-plus', perm: 'garage.job.create' },
  mywork: { label: 'My work', icon: 'timer' },
  parts: { label: 'Parts counter', icon: 'package', perm: 'garage.parts.issue' },
};

/** On the web for now, from the rail. */
const WEB: Array<{ view: string; label: string; icon: string; perm?: string }> = [
  { view: 'vehicles', label: 'Vehicles', icon: 'truck', perm: 'garage.vehicle.view' },
  { view: 'customers', label: 'Customers', icon: 'users', perm: 'garage.vehicle.view' },
  { view: 'reports', label: 'Reports', icon: 'chart', perm: 'garage.report.view' },
  { view: 'workshop', label: 'Workshop', icon: 'wrench', perm: 'garage.settings.manage' },
];

const ORG_KEY = 'garage.org';
const num = (v: string | null | undefined) => (v && /^\d+$/.test(v) ? Number(v) : null);

function savedOrg(): string {
  try {
    return localStorage.getItem(ORG_KEY) ?? '';
  } catch {
    return '';
  }
}

/** The job a route names: `?job=`, `?checkin=`, or `/garage/jobs/<id>`. */
export function jobOf(path: string[], query: URLSearchParams): number | null {
  const i = path.indexOf('jobs');
  return num(query.get('job')) ?? num(query.get('checkin')) ?? (i >= 0 ? num(path[i + 1]) : null);
}

/** A vehicle a route names — its page is on the web for now. */
export function vehicleOf(path: string[], query: URLSearchParams): number | null {
  const i = path.indexOf('vehicles');
  return num(query.get('vehicle')) ?? (i >= 0 ? num(path[i + 1]) : null);
}

export default function GarageShell(_props: ModuleProps) {
  const { query, path, go: goRoute } = useTab();
  const perms = useStore(app, (s) => s.bootstrap?.permissions);
  const [org, setOrg] = useState(savedOrg);
  const options = useQuery({ queryKey: K.options(org), queryFn: ({ signal }) => gGet<Options>('/options', org ? { org } : undefined, signal) });
  const opts = options.data;
  const asked = (query.get('view') ?? '') as GarageView;
  const view: GarageView = asked in VIEWS ? asked : 'overview';
  const job = jobOf(path, query);
  const vehicle = vehicleOf(path, query);
  useTabTitle(job ? 'Garage · Job' : `Garage · ${VIEWS[view].label}`);

  if (options.isLoading) return <Spinner label="Opening Garage…" />;
  if (options.error || !opts) {
    return (
      <div className="p-6">
        <ErrorNote error={options.error ?? new Error('Garage could not be loaded.')} onRetry={() => void options.refetch()} />
      </div>
    );
  }

  const may = (perm: string) => mayIn(opts, perm, perms ?? []);
  const scope = org || String(opts.org);
  const route = (v: GarageView, params: Record<string, string | number | null | undefined> = {}) => {
    const q = new URLSearchParams({ view: v });
    for (const [k, val] of Object.entries(params)) if (val !== null && val !== undefined && val !== '') q.set(k, String(val));
    return `/garage?${q.toString()}`;
  };
  const g: Garage = {
    org: scope,
    options: opts,
    may,
    go: (v, params) => goRoute(route(v, params)),
    openJob: (id) => goRoute(id ? `${route(view)}&job=${id}` : route(view)),
  };
  const chooseOrg = (v: string) => {
    setOrg(v);
    try {
      localStorage.setItem(ORG_KEY, v);
    } catch {
      /* a convenience */
    }
  };
  const pending = !opts.setup.complete;
  const allowed = (perm?: string) => !perm || may(perm);

  return (
    <GarageContext.Provider value={g}>
      <div className="flex h-full min-h-0">
        <nav aria-label="Garage" className="flex w-[220px] shrink-0 flex-col overflow-hidden border-r border-line bg-[#FBFBFD] text-[13px] text-ink dark:bg-surface">
          <div className="flex flex-col gap-2 px-2.5 pt-3.5 pb-1">
            <div className="flex items-center gap-2 px-1">
              <span className="grid size-8 place-items-center rounded-[10px] bg-selection text-primary">
                <Icon name="wrench" size={17} />
              </span>
              <div className="min-w-0">
                <b className="block text-[13.5px]">Garage</b>
                <span className="block truncate text-[11px] text-ink-3">{opts.companies.find((c) => c.id === opts.org)?.name ?? ''}</span>
              </div>
            </div>
            {opts.companies.length > 1 ? (
              <Select aria-label="Company" value={scope} onChange={(e) => chooseOrg(e.target.value)} options={opts.companies.map((c) => ({ value: String(c.id), label: c.name }))} className="h-8 rounded-[8px] border border-line bg-surface px-2 text-[12px] font-semibold text-ink" />
            ) : null}
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-px overflow-y-auto px-2.5 pb-3 scroll-thin">
            {(Object.keys(VIEWS) as GarageView[])
              .filter((v) => allowed(VIEWS[v].perm) && !(pending && (v === 'walkin' || v === 'board')))
              .map((v) => {
                const on = !job && view === v;
                return (
                  <button
                    key={v}
                    type="button"
                    aria-current={on ? 'page' : undefined}
                    onClick={() => g.go(v)}
                    className={cx('relative flex h-[30px] shrink-0 items-center gap-[9px] rounded-[8px] pr-2 pl-2.5 text-left', on ? 'bg-[#EAEDFB] font-bold text-[#1B2A85] dark:bg-selection dark:text-primary' : 'font-medium text-ink hover:bg-subtle')}
                  >
                    <span className={cx('absolute top-1.5 bottom-1.5 left-0 w-[3px] rounded-r-[3px]', on ? 'bg-primary' : 'bg-transparent')} />
                    <Icon name={VIEWS[v].icon} size={16} className={cx('shrink-0', on ? 'text-primary' : 'text-ink-3')} />
                    <span className="min-w-0 flex-1 truncate">{VIEWS[v].label}</span>
                  </button>
                );
              })}
            <div className="mt-3 mb-0.5 px-2 text-[10.5px] font-bold tracking-[.6px] text-ink-3 uppercase">On the web</div>
            {WEB.filter((w) => allowed(w.perm)).map((w) => (
              <button key={w.view} type="button" onClick={() => openWeb(`/garage?view=${w.view}`)} className="flex h-[30px] shrink-0 items-center gap-[9px] rounded-[8px] pr-2 pl-2.5 text-left font-medium text-ink hover:bg-subtle">
                <Icon name={w.icon} size={16} className="shrink-0 text-ink-3" />
                <span className="min-w-0 flex-1 truncate">{w.label}</span>
                <Icon name="external" size={13} className="shrink-0 text-ink-3" />
              </button>
            ))}
          </div>
        </nav>
        <main className="min-w-0 flex-1 overflow-y-auto bg-ground scroll-thin" aria-label={job ? 'Garage · Job' : `Garage · ${VIEWS[view].label}`}>
          <Suspense fallback={<Spinner />}>
            {vehicle && !job ? (
              <OnTheWeb title="Vehicles open on the web" text="A vehicle's history, mileage and owners are in WorkSuite on the web for now." path={`/garage?vehicle=${vehicle}`} />
            ) : job ? (
              <JobCard key={job} id={job} onBack={() => g.openJob(null)} />
            ) : pending && view !== 'mywork' && view !== 'parts' ? (
              <SetupPending manages={may('garage.settings.manage')} />
            ) : view === 'board' ? (
              <Board />
            ) : view === 'jobs' ? (
              <Jobs list={query.get('list') ?? 'open'} />
            ) : view === 'walkin' ? (
              <WalkIn />
            ) : view === 'mywork' ? (
              <MyWork />
            ) : view === 'parts' ? (
              <PartsCounter />
            ) : (
              <Overview />
            )}
          </Suspense>
        </main>
      </div>
    </GarageContext.Provider>
  );
}

function SetupPending({ manages }: { manages: boolean }) {
  return (
    <OnTheWeb
      title="Configure your workshop before the first service job"
      text={manages ? 'A few steps on the web: branches, workshops, bays, technicians, warehouses, labour rates and service types.' : 'Someone who manages Garage in this company is finishing the set-up. Jobs can be taken once it is done.'}
      path={manages ? '/garage?view=setup' : null}
      action="Start set-up"
    />
  );
}

function OnTheWeb({ title, text, path, action = 'Open in WorkSuite' }: { title: string; text: string; path: string | null; action?: string }) {
  return (
    <div className="p-6">
      <div className="flex items-start gap-3 rounded-[12px] border border-line bg-surface p-5">
        <Icon name="wrench" size={20} className="mt-0.5 text-primary" />
        <div className="min-w-0 flex-1">
          <h1 className="m-0 text-[15px] font-bold text-ink">{title}</h1>
          <p className="mt-1 text-[13px] text-ink-2">{text}</p>
          {path ? (
            <Button variant="primary" icon="external" className="mt-3" onClick={() => openWeb(path)}>
              {action}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

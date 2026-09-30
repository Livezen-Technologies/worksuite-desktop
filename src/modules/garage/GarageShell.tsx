import { useQuery } from '@tanstack/react-query';
import { lazy, Suspense, useState } from 'react';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { app } from '../../core/app-state';
import { useStore } from '../../core/store';
import { useTab, useTabTitle } from '../../core/tab-context';
import type { ModuleProps } from '../registry';
import { gGet, K, mayIn, useOnline, type Options } from './api';
import { GarageContext, type Garage, type GarageView } from './parts';
import { SidePanel } from '../../components/SidePanel';

/**
 * Garage, native in WorkSuite Desktop. Addressed as
 * `/garage?view=overview|board|jobs|walkin|mywork|parts|vehicles|customers|reports|workshop|setup|settings`
 * (`&list=` for a job list, `&customer=` for a customer), a job as `?job=<id>`
 * (`&jt=` its tab) — what the server's notifications carry — or
 * `/garage/jobs/<id>` (the deep link), its check-in as `?checkin=<id>`, and a
 * vehicle as `?vehicle=<id>` or `/garage/vehicles/<id>`.
 *
 * Everything the server's Garage offers is here: the counter, the board, the
 * job card with its check-in, inspection, diagnosis, estimate, work, quality
 * and delivery, vehicles and customers, reports, the workshop, the set-up
 * wizard and the settings.
 */
const Overview = lazy(() => import('./Overview'));
const Board = lazy(() => import('./Board'));
const Jobs = lazy(() => import('./Jobs'));
const WalkIn = lazy(() => import('./WalkIn'));
const MyWork = lazy(() => import('./MyWork'));
const PartsCounter = lazy(() => import('./PartsCounter'));
const JobCard = lazy(() => import('./JobCard'));
const CheckIn = lazy(() => import('./CheckIn'));
const Vehicles = lazy(() => import('./Vehicles'));
const Vehicle360 = lazy(() => import('./Vehicle360'));
const Customers = lazy(() => import('./Customers'));
const Reports = lazy(() => import('./Reports'));
const Workshop = lazy(() => import('./Workshop'));
const Setup = lazy(() => import('./Setup'));
const Settings = lazy(() => import('./Settings'));

type Group = 'main' | 'records' | 'insight' | 'setup';

const VIEWS: Record<GarageView, { label: string; icon: string; perm?: string; group: Group }> = {
  overview: { label: 'Overview', icon: 'home', group: 'main' },
  board: { label: 'Job board', icon: 'kanban', perm: 'garage.job.view', group: 'main' },
  jobs: { label: 'Jobs', icon: 'list', perm: 'garage.job.view', group: 'main' },
  walkin: { label: 'New walk-in', icon: 'user-plus', perm: 'garage.job.create', group: 'main' },
  mywork: { label: 'My work', icon: 'timer', group: 'main' },
  parts: { label: 'Parts counter', icon: 'package', perm: 'garage.parts.issue', group: 'main' },
  vehicles: { label: 'Vehicles', icon: 'truck', perm: 'garage.vehicle.view', group: 'records' },
  customers: { label: 'Customers', icon: 'users', perm: 'garage.vehicle.view', group: 'records' },
  reports: { label: 'Reports', icon: 'chart', perm: 'garage.report.view', group: 'insight' },
  workshop: { label: 'Workshop', icon: 'wrench', group: 'setup' },
  setup: { label: 'Set-up wizard', icon: 'list-todo', perm: 'garage.settings.manage', group: 'setup' },
  settings: { label: 'Settings', icon: 'settings', perm: 'garage.settings.manage', group: 'setup' },
};

const HEADINGS: Record<Group, string | null> = { main: null, records: 'Customers & vehicles', insight: 'Insight', setup: 'Set up' };

/** What can be opened while a company's set-up is not finished (FR-APP-04): the set-up itself, and the floor's own screens. */
const WHILE_SETTING_UP: ReadonlySet<GarageView> = new Set<GarageView>(['setup', 'workshop', 'settings', 'mywork', 'parts']);

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

/** A vehicle a route names: `?vehicle=` or `/garage/vehicles/<id>`. */
export function vehicleOf(path: string[], query: URLSearchParams): number | null {
  const i = path.indexOf('vehicles');
  return num(query.get('vehicle')) ?? (i >= 0 ? num(path[i + 1]) : null);
}

export default function GarageShell(_props: ModuleProps) {
  const { query, path, go: goRoute } = useTab();
  const perms = useStore(app, (s) => s.bootstrap?.permissions);
  const online = useOnline();
  const [org, setOrg] = useState(savedOrg);
  const options = useQuery({ queryKey: K.options(org), queryFn: ({ signal }) => gGet<Options>('/options', org ? { org } : undefined, signal) });
  const opts = options.data;
  const asked = (query.get('view') ?? '') as GarageView;
  const checkin = num(query.get('checkin'));
  const job = checkin ? null : jobOf(path, query);
  const vehicle = job || checkin ? null : vehicleOf(path, query);
  const manages = !!opts && mayIn(opts, 'garage.settings.manage', perms ?? []);
  const pending = !!opts && !opts.setup.complete;
  const view: GarageView = asked in VIEWS ? asked : pending && manages ? 'setup' : 'overview';
  const title = checkin ? 'Check-in' : job ? 'Job' : vehicle ? 'Vehicle' : VIEWS[view].label;
  useTabTitle(`Garage · ${title}`);

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
    online,
    go: (v, params) => goRoute(route(v, params)),
    openJob: (id, tab) => goRoute(id ? `${route(view)}&job=${id}${tab ? `&jt=${encodeURIComponent(tab)}` : ''}` : route(view)),
    openCheckin: (id) => goRoute(`${route(view)}&checkin=${id}`),
    openVehicle: (id) => goRoute(`${route(view)}&vehicle=${id}`),
  };
  const chooseOrg = (v: string) => {
    setOrg(v);
    try {
      localStorage.setItem(ORG_KEY, v);
    } catch {
      /* a convenience */
    }
  };
  const allowed = (v: GarageView) => {
    const perm = VIEWS[v].perm;
    if (perm && !may(perm)) return false;
    return !(pending && (v === 'walkin' || v === 'board'));
  };
  const record = checkin || job || vehicle;
  const groups: Group[] = ['main', 'records', 'insight', 'setup'];

  return (
    <GarageContext.Provider value={g}>
      <div className="flex h-full min-h-0">
        <SidePanel id="garage" label="the Garage menu">
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
              {groups.map((grp) => {
                const items = (Object.keys(VIEWS) as GarageView[]).filter((v) => VIEWS[v].group === grp && allowed(v));
                if (items.length === 0) return null;
                return (
                  <div key={grp} className="flex flex-col gap-px">
                    {HEADINGS[grp] ? <div className="mt-3 mb-0.5 px-2 text-[10.5px] font-bold tracking-[.6px] text-ink-3 uppercase">{HEADINGS[grp]}</div> : null}
                    {items.map((v) => {
                      const on = !record && view === v;
                      const label = v === 'setup' && pending ? 'Finish set-up' : VIEWS[v].label;
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
                          <span className="min-w-0 flex-1 truncate">{label}</span>
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </nav>
        </SidePanel>
        <main className="min-w-0 flex-1 overflow-y-auto bg-ground scroll-thin" aria-label={`Garage · ${title}`}>
          {!online ? (
            <div className="border-b border-line bg-warning-bg px-6 py-1.5 text-[12.5px] font-medium text-warning">Offline — what you see is the last copy. Changes wait until WorkSuite is back; a technician’s timer is kept and sent then.</div>
          ) : null}
          <Suspense fallback={<Spinner />}>
            {checkin ? (
              <CheckIn key={`c${checkin}`} jobId={checkin} onBack={() => g.openJob(checkin, 'checkin')} />
            ) : job ? (
              <JobCard key={job} id={job} tab={query.get('jt')} onBack={() => g.openJob(null)} />
            ) : vehicle ? (
              <Vehicle360 key={`v${vehicle}`} id={vehicle} onBack={() => goRoute(route(view))} />
            ) : pending && !WHILE_SETTING_UP.has(view) ? (
              manages ? <Setup /> : <SetupPending />
            ) : view === 'board' ? (
              <Board />
            ) : view === 'jobs' ? (
              <Jobs list={query.get('list') ?? 'open'} />
            ) : view === 'walkin' ? (
              <WalkIn seed={query.get('q') ?? ''} />
            ) : view === 'mywork' ? (
              <MyWork />
            ) : view === 'parts' ? (
              <PartsCounter />
            ) : view === 'vehicles' && allowed('vehicles') ? (
              <Vehicles />
            ) : view === 'customers' && allowed('customers') ? (
              <Customers open={num(query.get('customer'))} />
            ) : view === 'reports' && allowed('reports') ? (
              <Reports />
            ) : view === 'workshop' ? (
              <Workshop />
            ) : view === 'setup' && manages ? (
              <Setup />
            ) : view === 'settings' && manages ? (
              <Settings />
            ) : (
              <Overview />
            )}
          </Suspense>
        </main>
      </div>
    </GarageContext.Provider>
  );
}

/** Someone who does not set Garage up, while it is being set up. */
function SetupPending() {
  return (
    <div className="p-6">
      <div className="flex items-start gap-3 rounded-[12px] border border-line bg-surface p-5">
        <Icon name="wrench" size={20} className="mt-0.5 text-primary" />
        <div className="min-w-0 flex-1">
          <h1 className="m-0 text-[15px] font-bold text-ink">Garage is being set up</h1>
          <p className="mt-1 mb-0 text-[13px] text-ink-2">Someone who manages Garage in this company is finishing the set-up: branches, workshops, bays, technicians, warehouses, labour rates and service types. Jobs can be taken once it is done.</p>
        </div>
      </div>
    </div>
  );
}

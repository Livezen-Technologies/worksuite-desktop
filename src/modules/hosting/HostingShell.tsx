import { useQuery, useQueryClient } from '@tanstack/react-query';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useTab, useTabTitle } from '../../core/tab-context';
import { registerCommand } from '../../core/commands';
import { errorMessage } from '../../core/bridge';
import { text } from '../../core/i18n';
import { toast } from '../../core/toasts';
import { SidePanel } from '../../components/SidePanel';
import { Select } from '../../components/Select';
import { Spinner } from '../../components/ui';
import { asOf, fetchAccounts, fetchOrgs, fetchOverview, K, syncAccount, useAsOf } from './api';
import { Btn, ReadOnly, useOnline, when } from './parts';
import { HostingRail, RAIL, VIEWS, type HostingView } from './Rail';
import { StepUpHost } from './StepUp';

/** The registry's ModuleProps, of which the shell reads only whether its tab is in front. */
interface ModuleProps {
  active: boolean;
}

/**
 * Hosting & Domains on the desktop (Hosting & Domains SRS v1.0 HDM-DSK-01…05, boards D-01…D-08), addressed as
 * `/hosting?tab=<view>`; `&domain=<id>` (and `&view=overview|dns|certificates|monitors|costs|activity`) is one domain
 * in its tab, `&server=<id>` one server and `&certificate=<id>` a certificate selected — the web's deep links
 * (`?domain=`, `?server=`, `?certificate=`) open the same. Keys while the tab is in front: ⌘N add a domain, ⌘⇧S sync
 * all accounts, F5 refresh, Alt+1…0 the rail. Every screen's actions are in the command palette while Hosting is open.
 * Offline (HDM-DSK-05) the screens show the copy saved on this computer with its "as of" time and every change is off.
 */
const Overview = lazy(() => import('./Overview'));
const Domains = lazy(() => import('./Domains'));
const DomainPage = lazy(() => import('./DomainPage'));
const DnsView = lazy(() => import('./DnsView'));
const Certificates = lazy(() => import('./Certificates'));
const Servers = lazy(() => import('./Servers'));
const ServerPage = lazy(() => import('./ServerPage'));
const Monitors = lazy(() => import('./Monitors'));
const Costs = lazy(() => import('./Costs'));
const Accounts = lazy(() => import('./Accounts'));
const AddDomain = lazy(() => import('./AddDomain'));
const Register = lazy(() => import('./Register'));
const ImportCsv = lazy(() => import('./Import'));
const Reports = lazy(() => import('./Reports'));

const TITLES: Record<HostingView, string> = {
  overview: 'Overview', domains: 'Domains', expiring: 'Expiring', dns: 'DNS', certificates: 'Certificates', servers: 'Servers', monitors: 'Monitors',
  costs: 'Costs', accounts: 'Accounts', history: 'Sync history', domain: 'Domain', server: 'Server', new: 'Add domain',
  register: 'Register a domain', import: 'Import', reports: 'Reports',
};
const num = (v: string | null) => (v && /^\d{1,12}$/.test(v) ? Number(v) : null);

export interface Nav {
  /** A domain in this tab, a new tab or a window of its own (HDM-DSK-03). */
  openDomain: (id: number, how?: 'here' | 'tab' | 'window', name?: string, sub?: string) => void;
  openServer: (id: number, how?: 'here' | 'tab' | 'window', name?: string) => void;
  to: (v: HostingView, extra?: string, newTab?: boolean) => void;
}

/** "Sync all": every connected account, one after the other. A sync answers `{ok: false, why}` when it failed. */
export async function syncAll(ids: number[]): Promise<{ ok: number; failed: number }> {
  let ok = 0;
  let failed = 0;
  for (const id of ids) {
    try {
      const r = await syncAccount(id);
      if (r && r.ok === false) failed++;
      else ok++;
    } catch {
      failed++;
    }
  }
  return { ok, failed };
}

export default function HostingShell({ active }: ModuleProps) {
  const { query, go, openInNewTab, openInWindow } = useTab();
  const qc = useQueryClient();
  const online = useOnline();
  const cachedAt = useAsOf();
  const [org, setOrg] = useState(0);
  const domainId = num(query.get('domain'));
  const serverId = num(query.get('server'));
  const asked = query.get('tab') ?? (domainId ? 'domain' : serverId ? 'server' : null);
  let view: HostingView = asked && VIEWS.has(asked) ? (asked as HostingView) : 'overview';
  if (view === 'domain' && !domainId) view = 'domains';
  if (view === 'server' && !serverId) view = 'servers';
  useTabTitle(text('Hosting · {view}', { view: TITLES[view] }));

  const orgs = useQuery({ queryKey: K.orgs, queryFn: ({ signal }) => fetchOrgs(signal), staleTime: 300_000 });
  const overview = useQuery({ queryKey: K.overview(org), queryFn: ({ signal }) => fetchOverview(org, signal), staleTime: 60_000, retry: false });
  const accounts = useQuery({ queryKey: K.accounts, queryFn: ({ signal }) => fetchAccounts(signal), staleTime: 120_000, retry: false });

  // Back online: the "as of" time is the next offline spell's.
  useEffect(() => {
    if (online) asOf.set({ at: null });
  }, [online]);

  const route = (v: HostingView, extra = '') => `/hosting?tab=${v}${extra}`;
  const nav: Nav = {
    to: (v, extra = '', newTab = false) => (newTab ? openInNewTab(route(v, extra), text('Hosting · {view}', { view: TITLES[v] })) : go(route(v, extra))),
    openDomain: (id, how = 'here', name, sub) => {
      const r = `/hosting?domain=${id}${sub ? `&view=${sub}` : ''}`;
      const title = name ?? text('Domain {id}', { id });
      if (how === 'tab') openInNewTab(r, title);
      else if (how === 'window') openInWindow(r, title);
      else go(r);
    },
    openServer: (id, how = 'here', name) => {
      const r = `/hosting?server=${id}`;
      const title = name ?? text('Server {id}', { id });
      if (how === 'tab') openInNewTab(r, title);
      else if (how === 'window') openInWindow(r, title);
      else go(r);
    },
  };

  const [syncing, setSyncing] = useState(false);
  const runSyncAll = async () => {
    if (!online || syncing) return;
    const ids = (accounts.data ?? []).filter((a) => a.connectable !== false && !a.paused).map((a) => a.id);
    if (!ids.length) return toast('info', text('No provider accounts are connected.'));
    setSyncing(true);
    try {
      const r = await syncAll(ids);
      toast(r.failed ? 'error' : 'success', r.failed ? text('{ok} synced, {failed} failed — see Sync history.', r) : text('{ok} accounts synced.', r));
      void qc.invalidateQueries({ queryKey: K.all });
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setSyncing(false);
    }
  };

  // The shell's keys, only while this tab is in front. A ref keeps the latest closures without re-binding.
  const keys = useRef({ online, runSyncAll, nav });
  useEffect(() => {
    keys.current = { online, runSyncAll, nav };
  });
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();
      const typing = e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
      if (mod && !e.shiftKey && k === 'n' && view !== 'dns' && view !== 'domain') {
        e.preventDefault();
        if (keys.current.online) keys.current.nav.to('new');
      } else if (mod && e.shiftKey && k === 's') {
        e.preventDefault();
        void keys.current.runSyncAll();
      } else if (e.key === 'F5') {
        e.preventDefault();
        void qc.invalidateQueries({ queryKey: K.all });
      } else if (e.altKey && !mod && !typing && /^Digit\d$/.test(e.code)) {
        const r = RAIL.find((x) => x.key === e.code.slice(5));
        if (r) {
          e.preventDefault();
          keys.current.nav.to(r.id);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, view, qc]);

  // Command palette entries (HDM-DSK-03) while Hosting is open.
  useEffect(() => {
    if (!active) return;
    const offs = [
      ...RAIL.map((r) => registerCommand({ id: `hosting-go-${r.id}`, label: text('Hosting: {view}', { view: r.label }), group: 'Navigate', source: 'module', keywords: `hosting domains ${r.label.toLowerCase()}`, hint: `Alt+${r.key}`, run: () => keys.current.nav.to(r.id) })),
      registerCommand({ id: 'hosting-add-domain', label: text('Hosting: add a domain'), group: 'Create', source: 'module', keywords: 'hosting domain new add', hint: '⌘N', when: () => keys.current.online, run: () => keys.current.nav.to('new') }),
      registerCommand({ id: 'hosting-sync-all', label: text('Hosting: sync all accounts'), group: 'Module', source: 'module', keywords: 'hosting sync providers registrar refresh', hint: '⌘⇧S', when: () => keys.current.online, run: () => void keys.current.runSyncAll() }),
      registerCommand({ id: 'hosting-watch-host', label: text('Hosting: watch a certificate'), group: 'Create', source: 'module', keywords: 'hosting ssl tls certificate watch host', when: () => keys.current.online, run: () => keys.current.nav.to('certificates', '&watch=1') }),
      registerCommand({ id: 'hosting-add-monitor', label: text('Hosting: add a monitor'), group: 'Create', source: 'module', keywords: 'hosting monitor uptime check', when: () => keys.current.online, run: () => keys.current.nav.to('monitors', '&add=1') }),
      registerCommand({ id: 'hosting-register', label: text('Hosting: find and register a domain'), group: 'Create', source: 'module', keywords: 'hosting domain search register buy available', when: () => keys.current.online, run: () => keys.current.nav.to('register') }),
      registerCommand({ id: 'hosting-import', label: text('Hosting: import domains or servers from CSV'), group: 'Module', source: 'module', keywords: 'hosting import csv domains servers', when: () => keys.current.online, run: () => keys.current.nav.to('import') }),
      registerCommand({ id: 'hosting-add-server', label: text('Hosting: add a server'), group: 'Create', source: 'module', keywords: 'hosting server add vps', when: () => keys.current.online, run: () => keys.current.nav.to('servers', '&add=1') }),
      registerCommand({ id: 'hosting-reports', label: text('Hosting: reports'), group: 'Navigate', source: 'module', keywords: 'hosting reports renewals cost uptime print export', run: () => keys.current.nav.to('reports') }),
    ];
    return () => offs.forEach((off) => off());
  }, [active]);

  if (orgs.isPending && overview.isPending) return <Spinner />;
  const o = overview.data;
  const companies = orgs.data ?? [];
  const props = { org, nav, active, companies };

  return (
    <ReadOnly.Provider value={!online}>
      <div className="flex h-full min-h-0">
        <SidePanel id="hosting" label="the Hosting menu">
          <HostingRail
            view={view}
            counts={{ expiring: o?.domains?.within_30, certificates: o?.certificates?.at_risk, monitors: o?.monitors?.down, accounts: o?.sync_failures?.length ?? (accounts.data ?? []).filter((a) => a.last_error).length }}
            onPick={(v, newTab) => nav.to(v, '', newTab)}
          />
        </SidePanel>
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-ground" aria-label={text('Hosting · {view}', { view: TITLES[view] })}>
          {!online ? (
            <div role="status" className="flex shrink-0 flex-wrap items-center gap-3 border-b border-warning-line bg-warning-bg px-5 py-2 text-[12.5px] text-warning-strong dark:border-warning/40 dark:bg-warning-bg dark:text-warning">
              <span className="min-w-0 flex-1">
                {cachedAt
                  ? text('You are offline. This is the register as of {time}. Adding, editing, DNS changes, sync and checks come back when you reconnect.', { time: when(cachedAt) })
                  : text('You are offline. Adding, editing, DNS changes, sync and checks come back when you reconnect.')}
              </span>
              <Btn onClick={() => void qc.invalidateQueries({ queryKey: K.all })}>Try again</Btn>
            </div>
          ) : null}
          {companies.length > 1 ? (
            <div className="flex shrink-0 items-center gap-2 border-b border-line bg-surface px-[22px] py-1.5 text-[12px] text-ink-2">
              Company
              <Select aria-label="Company" value={org} onChange={(e) => setOrg(Number(e.target.value))} className="h-[28px] rounded-[7px] border border-line bg-surface px-2 text-[12px] font-semibold text-ink">
                <option value={0}>All my companies</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </div>
          ) : null}
          <div className="min-h-0 flex-1 overflow-y-auto px-[22px] py-[18px] scroll-thin">
            <Suspense fallback={<Spinner />}>
              {view === 'overview' ? (
                <Overview data={overview} org={org} nav={nav} syncing={syncing} onSyncAll={() => void runSyncAll()} />
              ) : view === 'domains' || view === 'expiring' ? (
                <Domains key={view} {...props} expiring={view === 'expiring'} filter={query.get('filter') ?? ''} />
              ) : view === 'register' ? (
                <Register companies={companies} org={org} nav={nav} initial={query.get('name') ?? ''} />
              ) : view === 'import' ? (
                <ImportCsv companies={companies} org={org} nav={nav} />
              ) : view === 'reports' ? (
                <Reports org={org} nav={nav} />
              ) : view === 'domain' && domainId ? (
                <DomainPage id={domainId} active={active} tab={query.get('view') ?? 'overview'} onTab={(t) => go(`/hosting?domain=${domainId}&view=${t}`)} nav={nav} />
              ) : view === 'dns' ? (
                <DnsView {...props} picked={num(query.get('pick'))} onPick={(id) => go(route('dns', `&pick=${id}`))} />
              ) : view === 'certificates' ? (
                <Certificates {...props} selected={num(query.get('certificate'))} watch={query.get('watch') === '1'} />
              ) : view === 'servers' ? (
                <Servers {...props} add={query.get('add') === '1'} />
              ) : view === 'server' && serverId ? (
                <ServerPage id={serverId} nav={nav} />
              ) : view === 'monitors' ? (
                <Monitors {...props} add={query.get('add') === '1'} />
              ) : view === 'costs' ? (
                <Costs org={org} nav={nav} />
              ) : view === 'accounts' || view === 'history' ? (
                <Accounts history={view === 'history'} />
              ) : (
                <AddDomain companies={companies} org={org} onDone={(id) => nav.openDomain(id)} onCancel={() => nav.to('domains')} onRegister={() => nav.to('register')} />
              )}
            </Suspense>
          </div>
          <div className="flex h-[26px] shrink-0 items-center gap-5 border-t border-line bg-surface px-4 text-[11.5px] text-ink-2">
            <span className="flex items-center gap-1.5">
              <span className={online ? 'size-2 rounded-full bg-success' : 'size-2 rounded-full bg-warning'} />
              {online ? 'Connected' : 'Offline · read-only'}
            </span>
            {o?.as_of ? <span>{text('Read {time}', { time: when(o.as_of) })}</span> : null}
            <span className="flex-1" />
            <span>Hosting & Domains</span>
          </div>
        </main>
      </div>
      <StepUpHost />
    </ReadOnly.Provider>
  );
}

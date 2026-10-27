import { useQuery, useQueryClient } from '@tanstack/react-query';
import { lazy, Suspense, useEffect, useState } from 'react';
import { useTab, useTabTitle } from '../../core/tab-context';
import { useScannerSeen } from '../../core/scanner';
import { SidePanel } from '../../components/SidePanel';
import { Select } from '../../components/Select';
import { Spinner } from '../../components/ui';
/** The registry's ModuleProps, of which the shell reads only whether its tab is in front. */
interface ModuleProps {
  active: boolean;
}
import { fetchAccess, fetchDashboard, K, type Can } from './api';
import { OFFLINE, ReadOnly, useOnline } from './parts';
import { AssetsRail, VIEWS, type AssetView } from './Rail';

/**
 * Assets on the desktop (WS-ASSET-SRS-001 T-17, the "Assets — Desktop" boards D01–D26), addressed as
 * `/assets?tab=<view>`, with `&asset=<id>` (and `&view=overview|custody|depreciation|upkeep|documents|history`) for
 * one asset — a server link `/assets?asset=55` opens that asset here. ⌘N adds an asset, F5 refreshes. Offline the
 * screens show the last copy the server sent and every act is off. Every figure is the server's.
 */
const Dashboard = lazy(() => import('./Dashboard'));
const Register = lazy(() => import('./Register'));
const AssetPage = lazy(() => import('./AssetPage'));
const AssetForm = lazy(() => import('./AssetForm'));
const MyAssets = lazy(() => import('./MyAssets'));
const Bookings = lazy(() => import('./Bookings'));
const Scan = lazy(() => import('./Scan'));
const Requests = lazy(() => import('./Requests'));
const Transfers = lazy(() => import('./Transfers'));
const Maintenance = lazy(() => import('./Maintenance'));
const Plans = lazy(() => import('./Plans'));
const Licences = lazy(() => import('./Licences'));
const Stock = lazy(() => import('./Stock'));
const Audits = lazy(() => import('./Audits'));
const Disposals = lazy(() => import('./Disposals'));
const Reports = lazy(() => import('./Reports'));
const Activity = lazy(() => import('./Activity'));
const Lookups = lazy(() => import('./Lookups'));
const ImportExport = lazy(() => import('./ImportExport'));
const Labels = lazy(() => import('./Labels'));
const Settings = lazy(() => import('./Settings'));
const Unfiled = lazy(() => import('./Unfiled'));

const TITLES: Record<AssetView, string> = {
  dashboard: 'Dashboard', register: 'Register', asset: 'Asset', new: 'New asset', edit: 'Edit asset', mine: 'My assets', bookings: 'Bookings', scan: 'Scan station',
  requests: 'Requests', transfers: 'Transfers', maintenance: 'Maintenance', plans: 'Plans', licences: 'Licences', stock: 'Consumables', audits: 'Audits',
  disposals: 'Disposal', reports: 'Reports', activity: 'Activity', lookups: 'Lists & fields', import: 'Import & export', labels: 'Labels', settings: 'Settings', unfiled: 'File unassigned assets',
};
const num = (v: string | null) => (v && /^\d{1,12}$/.test(v) ? Number(v) : null);

export default function AssetsShell({ active }: ModuleProps) {
  const { query, go, openInNewTab } = useTab();
  const qc = useQueryClient();
  const online = useOnline();
  const scanner = useScannerSeen();
  const [org, setOrg] = useState(0);
  const assetId = num(query.get('asset'));
  const asked = query.get('tab') ?? (assetId ? 'asset' : null);
  const access = useQuery({ queryKey: K.access, queryFn: ({ signal }) => fetchAccess(signal), staleTime: 300_000 });
  const dash = useQuery({ queryKey: K.dashboard(org), queryFn: ({ signal }) => fetchDashboard(org, signal), staleTime: 60_000, retry: false });
  const can: Can = dash.data?.can ?? (dash.data?.can_manage ? { manage: true, assign: true, approve: true, maintain: true, finance: true, audit: true, settings: true } : {});
  const staff = !!dash.data && Object.entries(can).some(([k, v]) => k !== 'view' && v);
  const fallback: AssetView = staff ? 'dashboard' : 'mine';
  let view: AssetView = asked && VIEWS.has(asked) ? (asked as AssetView) : fallback;
  if ((view === 'asset' || view === 'edit') && !assetId) view = staff ? 'register' : 'mine';
  useTabTitle(`Assets · ${TITLES[view]}`);
  const route = (v: AssetView, extra = '') => `/assets?tab=${v}${extra}`;
  const to = (v: AssetView, extra = '', newTab = false) => (newTab ? openInNewTab(route(v, extra), `Assets · ${TITLES[v]}`) : go(route(v, extra)));
  const openAsset = (id: number, how: 'here' | 'tab' = 'here', sub?: string) => {
    const r = `/assets?asset=${id}${sub ? `&view=${sub}` : ''}`;
    if (how === 'tab') openInNewTab(r, `Assets · ${id}`);
    else go(r);
  };

  // ⌘N adds an asset; F5 asks the server again. Only while this tab is in front.
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'n' && online && (can.manage ?? false)) {
        e.preventDefault();
        go(route('new'));
      } else if (e.key === 'F5') {
        e.preventDefault();
        void qc.invalidateQueries({ queryKey: ['assets'] });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (access.isPending && dash.isPending) return <Spinner />;
  const companies = access.data?.companies ?? [];
  const k = dash.data?.kpi;
  const props = { org, can, active };

  return (
    <ReadOnly.Provider value={!online}>
      <div className="flex h-full min-h-0">
        <SidePanel id="assets" label="the Assets menu">
          <AssetsRail
            view={view}
            access={{ manage: !!can.manage, assign: !!can.assign, settings: !!can.settings, staff }}
            counts={{ register: k?.total, requests: k?.pending_requests, transfers: k?.pending_transfers, maintenance: k?.due_maintenance, licences: k?.license_expiring }}
            cached={!online ? (k?.total ?? null) : null}
            onPick={(v, newTab) => to(v, '', newTab)}
          />
        </SidePanel>
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-ground" aria-label={`Assets · ${TITLES[view]}`}>
          {!online ? (
            <div role="status" className="shrink-0 border-b border-warning-line bg-warning-bg px-5 py-1.5 text-[12px] font-semibold text-warning-strong dark:border-warning/40 dark:bg-warning-bg dark:text-warning">
              {`Offline · showing the copy kept on this computer · ${OFFLINE}`}
            </div>
          ) : null}
          {companies.length > 1 && staff ? (
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
              {view === 'dashboard' ? (
                <Dashboard data={dash} org={org} can={can} onGo={(v, extra) => to(v, extra)} onAsset={(id) => openAsset(id)} />
              ) : view === 'register' ? (
                <Register {...props} status={query.get('status') ?? ''} onOpen={openAsset} onNew={() => to('new')} onGo={(v, extra) => to(v, extra)} />
              ) : view === 'asset' && assetId ? (
                <AssetPage id={assetId} can={can} active={active} tab={query.get('view') ?? 'overview'} onTab={(t) => go(`/assets?asset=${assetId}&view=${t}`)} onEdit={() => to('edit', `&asset=${assetId}`)} onGo={(v, extra) => to(v, extra)} />
              ) : view === 'new' || view === 'edit' ? (
                <AssetForm id={view === 'edit' ? assetId : null} companies={companies} org={org} onDone={(id) => openAsset(id)} onCancel={() => (assetId ? openAsset(assetId) : to('register'))} />
              ) : view === 'mine' ? (
                <MyAssets confirm={num(query.get('confirm'))} problem={query.get('problem') === '1'} onAsset={(id) => openAsset(id)} />
              ) : view === 'bookings' ? (
                <Bookings {...props} />
              ) : view === 'scan' ? (
                <Scan {...props} onAsset={(id) => openAsset(id, 'tab')} />
              ) : view === 'requests' ? (
                <Requests {...props} open={num(query.get('request'))} />
              ) : view === 'transfers' ? (
                <Transfers {...props} />
              ) : view === 'maintenance' ? (
                <Maintenance {...props} onAsset={(id) => openAsset(id)} />
              ) : view === 'plans' ? (
                <Plans {...props} />
              ) : view === 'licences' ? (
                <Licences {...props} />
              ) : view === 'stock' ? (
                <Stock {...props} />
              ) : view === 'audits' ? (
                <Audits {...props} open={num(query.get('audit'))} onOpen={(id) => to('audits', `&audit=${id}`)} />
              ) : view === 'disposals' ? (
                <Disposals {...props} preset={num(query.get('write_off'))} />
              ) : view === 'reports' ? (
                <Reports org={org} kind={query.get('report') ?? 'valuation'} onKind={(r) => go(route('reports', `&report=${r}`))} onUnfiled={() => to('unfiled')} />
              ) : view === 'activity' ? (
                <Activity org={org} onAsset={(id) => openAsset(id)} />
              ) : view === 'lookups' ? (
                <Lookups kind={query.get('kind') ?? 'categories'} onKind={(x) => go(route('lookups', `&kind=${x}`))} />
              ) : view === 'import' ? (
                <ImportExport org={org} companies={companies} onLabels={(ids) => to('labels', `&ids=${ids.join(',')}`)} />
              ) : view === 'labels' ? (
                <Labels ids={(query.get('ids') ?? '').split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0)} />
              ) : view === 'settings' ? (
                <Settings can={can} companies={companies} />
              ) : (
                <Unfiled companies={companies} onDone={() => to('dashboard')} />
              )}
            </Suspense>
          </div>
          <div className="flex h-[26px] shrink-0 items-center gap-5 border-t border-line bg-surface px-4 text-[11.5px] text-ink-2">
            <span className="flex items-center gap-1.5">
              <span className={online ? 'size-2 rounded-full bg-success' : 'size-2 rounded-full bg-warning'} />
              {online ? 'Connected' : 'Offline'}
            </span>
            <span>{scanner ? 'Barcode scanner ready' : 'Scanner: scan anything to check'}</span>
            <span className="flex-1" />
            <span>Assets</span>
          </div>
        </main>
      </div>
    </ReadOnly.Provider>
  );
}

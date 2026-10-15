import { useQuery } from '@tanstack/react-query';
import { lazy, Suspense, useState } from 'react';
import { app } from '../../core/app-state';
import { useStore } from '../../core/store';
import { useTab, useTabTitle } from '../../core/tab-context';
import { Spinner } from '../../components/ui';
import type { ModuleProps } from '../registry';
import { fetchFulfilment, fetchReturns, K, useOrgs, useOverview, type Status } from './api';
import { NATIVE, NEEDS, SalesRail, type SalesView } from './Rail';
import { SidePanel } from '../../components/SidePanel';
import { recallOrgChoice, rememberOrgChoice } from '../../core/org-prefs';

/**
 * Sales & Orders (the "12 · Orders (OMS)" designs): the rail, and the screen
 * it points at. Addressed as `/sales?tab=…` (`&status=` narrows the order
 * list, `&section=channels` opens Settings on the sales channels); an order
 * as `?order=<id>` — what the server's notifications and
 * shares link to (`/oms?order=`, which the desktop reads as this) — and
 * `?new=1` starts a new one.
 */
const Dashboard = lazy(() => import('./Dashboard'));
const Orders = lazy(() => import('./Orders'));
const Fulfilment = lazy(() => import('./Fulfilment'));
const Returns = lazy(() => import('./Returns'));
const Activity = lazy(() => import('./Activity'));
const Reports = lazy(() => import('./Reports'));
const Coupons = lazy(() => import('./Coupons'));
const ApprovalRules = lazy(() => import('./ApprovalRules'));
const Settings = lazy(() => import('./Settings'));
const MyAccess = lazy(() => import('./MyAccess'));
const Approvals = lazy(() => import('./Approvals'));
const ShippingDesk = lazy(() => import('./ShippingDesk'));
const Dispatch = lazy(() => import('./Dispatch'));
const Channels = lazy(() => import('./Channels'));

const TITLES: Record<SalesView, string> = {
  dash: 'Dashboard',
  orders: 'Orders',
  appr: 'Approvals',
  ful: 'Fulfilment',
  desk: 'Shipping desk',
  dispatch: 'Dispatch board',
  ret: 'Returns',
  act: 'Activity',
  rep: 'Reports',
  cou: 'Coupons',
  chan: 'Channels',
  rules: 'Approval rules',
  set: 'Settings',
  acc: 'My access',
};
const ORG_KEY = 'sales.org';
const num = (v: string | null | undefined) => (v && /^\d+$/.test(v) ? Number(v) : null);
const has = (perms: readonly string[] | undefined, p: string) => !!perms && (perms.includes('*') || perms.includes(p));

function savedOrg(): string {
  try {
    // The organisation filter's memory (#214), shared with the other apps when the person chose so; this app's own before it.
    return recallOrgChoice('sales') ?? localStorage.getItem(ORG_KEY) ?? '';
  } catch {
    return '';
  }
}

export default function SalesShell(_props: ModuleProps) {
  const { query, go, openInNewTab } = useTab();
  const perms = useStore(app, (s) => s.bootstrap?.permissions);
  const [org, setOrg] = useState(savedOrg);
  const order = num(query.get('order'));
  const creating = query.get('new') === '1';
  const asked = (query.get('tab') ?? '') as SalesView;
  const status = query.get('status');
  const allowed = (v: SalesView) => !NEEDS[v] || has(perms, NEEDS[v]!);
  const view: SalesView = asked && NATIVE.has(asked) && allowed(asked) ? asked : order || creating || status ? 'orders' : 'dash';
  // Orders waiting on a decision I may make: the same number as the tray and the Dock (FR-DSK-05).
  const approvals = useStore(app, (s) => s.status?.unread.salesApprovals ?? null);
  useTabTitle(`Orders · ${TITLES[view]}`);

  const orgs = useOrgs();
  const overview = useOverview(org);
  const ful = useQuery({ queryKey: K.fulfilment(org), queryFn: ({ signal }) => fetchFulfilment(org, signal), refetchInterval: 60_000 });
  const ret = useQuery({ queryKey: K.returns(org), queryFn: ({ signal }) => fetchReturns(org, signal), refetchInterval: 120_000 });
  const o = overview.data;
  const byStatus: Partial<Record<Status, number>> = {};
  for (const s of [...(o?.stages ?? []), ...(o?.exits ?? [])]) byStatus[s.status] = s.count;
  if (o) {
    byStatus.delivered = o.delivered;
    byStatus.completed = o.completed;
    byStatus.cancelled = o.cancelled;
  }
  const fb = ful.data?.board;
  const rb = ret.data?.board;
  const counts = {
    byStatus,
    total: o?.total ?? 0,
    pending: o?.attention.pending_approval ?? 0,
    approvals: approvals ?? o?.attention.pending_approval ?? 0,
    fulfilment: (fb?.to_pick.length ?? 0) + (fb?.to_dispatch.length ?? 0),
    returns: (rb?.to_approve.length ?? 0) + (rb?.to_receive.length ?? 0) + (rb?.to_credit.length ?? 0),
  };
  const pick = (v: SalesView, s?: string | null) => go(v === 'orders' && s === '__overdue' ? '/sales?tab=orders&overdue=1' : v === 'orders' && s ? `/sales?tab=orders&status=${s}` : `/sales?tab=${v}`);
  const chooseOrg = (v: string) => {
    setOrg(v);
    rememberOrgChoice('sales', v);
    try {
      localStorage.setItem(ORG_KEY, v);
    } catch {
      /* a convenience */
    }
  };
  const canCreate = has(perms, 'inventory.sell');

  return (
    <div className="flex h-full min-h-0">
      <SidePanel id="sales" label="the Sales menu">
        <SalesRail
          view={view}
          status={view === 'orders' ? status : null}
          onPick={pick}
          onNew={() => go('/sales?tab=orders&new=1')}
          counts={counts}
          org={org}
          orgs={orgs.data ?? []}
          onOrg={chooseOrg}
          canCreate={canCreate}
          allowed={allowed}
        />
      </SidePanel>
      <main className="min-w-0 flex-1 overflow-y-auto bg-ground scroll-thin" aria-label={`Orders · ${TITLES[view]}`}>
        <Suspense fallback={<Spinner />}>
          {view === 'dash' ? <Dashboard org={org} overview={overview} onOpen={(id) => go(`/sales?tab=orders&order=${id}`)} onList={(s) => pick('orders', s)} onPick={pick} /> : null}
          {view === 'orders' ? (
            <Orders
              org={org}
              status={status}
              overdue={query.get('overdue') === '1'}
              openId={order}
              creating={creating}
              canCreate={canCreate}
              onOpen={(id) => go(`/sales?tab=orders${status ? `&status=${status}` : ''}${id ? `&order=${id}` : ''}`)}
              onNew={() => go(`/sales?tab=orders${status ? `&status=${status}` : ''}&new=1`)}
              onCloseNew={(id) => go(`/sales?tab=orders${status ? `&status=${status}` : ''}${id ? `&order=${id}` : ''}`)}
            />
          ) : null}
          {view === 'appr' ? <Approvals org={org} openId={order} onOpen={(id) => go(`/sales?tab=appr${id ? `&order=${id}` : ''}`)} /> : null}
          {view === 'ful' ? <Fulfilment org={org} board={ful} onOpen={(id) => go(`/sales?tab=orders&order=${id}`)} /> : null}
          {view === 'desk' ? <ShippingDesk org={org} /> : null}
          {view === 'dispatch' ? <Dispatch org={org} onOpen={(id) => go(`/sales?tab=orders&order=${id}`)} /> : null}
          {view === 'chan' ? <div className="flex flex-col gap-3.5 px-6 py-5"><Channels org={org} /></div> : null}
          {view === 'ret' ? <Returns org={org} board={ret} /> : null}
          {view === 'act' ? <Activity org={org} onOpen={(id) => openInNewTab(`/sales?tab=orders&order=${id}`)} /> : null}
          {view === 'rep' ? <Reports org={org} /> : null}
          {view === 'cou' ? <Coupons org={org} /> : null}
          {view === 'rules' ? <ApprovalRules org={org} /> : null}
          {view === 'set' ? <Settings org={org} section={query.get('section')} /> : null}
          {view === 'acc' ? <MyAccess /> : null}
        </Suspense>
      </main>
    </div>
  );
}

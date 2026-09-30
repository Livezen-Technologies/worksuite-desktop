import { lazy, Suspense } from 'react';
import { useTab, useTabTitle } from '../../core/tab-context';
import { Spinner } from '../../components/ui';
import type { ModuleProps } from '../registry';
import { useDashboard, useFollowUpCounts } from './api';
import { CrmRail, NATIVE, type CrmView } from './Rail';
import { SidePanel } from '../../components/SidePanel';

/**
 * CRM (the "11 · CRM" designs): the rail, and the screen it points at.
 * Addressed as `/crm?tab=…`; a lead as `/crm/leads/<id>` (what notifications
 * and search link to), a deal as `?deal=<id>`, an account as `?account=<id>`
 * (the web's address for one), a quote as `?quote=<id>`, and `?new=1` opens
 * the New form of the screen it is on.
 */
const Dashboard = lazy(() => import('./Dashboard'));
const Leads = lazy(() => import('./Leads'));
const FollowUps = lazy(() => import('./FollowUps'));
const Pipeline = lazy(() => import('./Pipeline'));
const Accounts = lazy(() => import('./Accounts'));
const Quotes = lazy(() => import('./Quotes'));
const PriceList = lazy(() => import('./PriceList'));
const Intake = lazy(() => import('./Intake'));
const CrmSettings = lazy(() => import('./Settings'));
const CrmAccess = lazy(() => import('./Settings').then((m) => ({ default: m.Access })));

const TITLES: Record<CrmView, string> = {
  dash: 'Dashboard',
  pipe: 'Pipeline',
  leads: 'Leads',
  fu: 'Follow-ups',
  acc: 'Accounts',
  quotes: 'Quotes',
  price: 'Price list',
  intake: 'Lead intake',
  set: 'Settings',
  access: 'My access',
};

const num = (v: string | null | undefined) => (v && /^\d+$/.test(v) ? Number(v) : null);

export default function CrmShell(_props: ModuleProps) {
  const { path, query, go } = useTab();
  const lead = path[1] === 'leads' ? num(path[2]) : num(query.get('lead'));
  const deal = num(query.get('deal'));
  const account = num(query.get('account'));
  const quote = num(query.get('quote'));
  const creating = query.get('new') === '1';
  const asked = (query.get('tab') ?? '') as CrmView;
  const view: CrmView = asked && NATIVE.has(asked) ? asked : lead || creating ? 'leads' : deal ? 'pipe' : account ? 'acc' : quote ? 'quotes' : 'dash';
  useTabTitle(`CRM · ${TITLES[view]}`);

  const dash = useDashboard(false);
  const fu = useFollowUpCounts();
  const kpi = dash.data?.kpi;
  const counts = {
    openDeals: kpi?.open_deals ?? 0,
    newLeads: kpi?.leads_new ?? 0,
    late: fu.data?.counts.overdue ?? 0,
    tasksToday: kpi?.tasks_today ?? 0,
    meetingsToday: kpi?.meetings_today ?? 0,
  };

  const pick = (v: CrmView) => go(`/crm?tab=${v}`);
  return (
    <div className="flex h-full min-h-0">
      <SidePanel id="crm" label="the CRM menu">
        <CrmRail
          view={view}
          onPick={pick}
          counts={counts}
          onNewLead={() => go('/crm?tab=leads&new=1')}
          onOpenHit={(h) => {
            if (h.type === 'lead') go(`/crm/leads/${h.id}`);
            else if (h.type === 'deal') go(`/crm?tab=pipe&deal=${h.id}`);
            else if (h.type === 'account') go(`/crm?tab=acc&account=${h.id}`);
            else go('/crm?tab=leads');
          }}
        />
      </SidePanel>
      <main className="relative flex min-w-0 flex-1 flex-col overflow-y-auto bg-ground px-[22px] py-[18px] scroll-thin">
        <Suspense fallback={<Spinner />}>
          {view === 'dash' ? <Dashboard onPick={pick} onOpenDeal={(id) => go(`/crm?tab=pipe&deal=${id}`)} onOpenLead={(id) => go(`/crm/leads/${id}`)} /> : null}
          {view === 'leads' ? <Leads openId={lead} creating={creating} onNew={() => go('/crm?tab=leads&new=1')} onOpen={(id) => go(id ? `/crm/leads/${id}` : '/crm?tab=leads')} onCreated={(id) => go(`/crm/leads/${id}`)} onCloseNew={() => go('/crm?tab=leads')} onOpenDeal={(id) => go(`/crm?tab=pipe&deal=${id}`)} /> : null}
          {view === 'fu' ? <FollowUps onOpenLead={(id) => go(`/crm/leads/${id}`)} /> : null}
          {view === 'pipe' ? <Pipeline openId={deal} onOpen={(id) => go(id ? `/crm?tab=pipe&deal=${id}` : '/crm?tab=pipe')} /> : null}
          {view === 'acc' ? (
            <Accounts
              openId={account}
              creating={creating}
              onOpen={(id) => go(id ? `/crm?tab=acc&account=${id}` : '/crm?tab=acc')}
              onNew={() => go('/crm?tab=acc&new=1')}
              onCloseNew={() => go('/crm?tab=acc')}
              onOpenDeal={(id) => go(`/crm?tab=pipe&deal=${id}`)}
              onOpenQuote={(id) => go(`/crm?tab=quotes&quote=${id}`)}
            />
          ) : null}
          {view === 'quotes' ? <Quotes openId={quote} creating={creating} onOpen={(id) => go(id ? `/crm?tab=quotes&quote=${id}` : '/crm?tab=quotes')} onNew={() => go('/crm?tab=quotes&new=1')} onCloseNew={() => go('/crm?tab=quotes')} /> : null}
          {view === 'price' ? <PriceList /> : null}
          {view === 'intake' ? <Intake /> : null}
          {view === 'set' ? <CrmSettings /> : null}
          {view === 'access' ? <CrmAccess /> : null}
        </Suspense>
      </main>
    </div>
  );
}

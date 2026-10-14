import { lazy, Suspense } from 'react';
import { useTab, useTabTitle } from '../../core/tab-context';
import { Spinner } from '../../components/ui';
import type { ModuleProps } from '../registry';
import { useDashboard, useFollowUpCounts } from './api';
import { CrmRail, NATIVE, type CrmView } from './Rail';
import { SidePanel } from '../../components/SidePanel';
import { crmRoute } from './logic';
import { useCrmScope } from './scope';
import { useCanApprove, usePendingApprovals } from './Approvals';

/**
 * CRM (the "11 · CRM" designs): the rail, and the screen it points at.
 * Addressed as `/crm?tab=…`; a lead as `/crm/leads/<id>` (what notifications
 * and search link to), a deal as `?deal=<id>`, an account as `?account=<id>`
 * (the web's address for one), a quote as `?quote=<id>`, a proposal as
 * `?proposal=<id>` or `/crm/proposals/<id>`, an estimate as `?estimate=<id>`
 * or `/crm/estimates/<id>`, and `?new=1` opens the New form of the screen it
 * is on. The web's own `?view=` names (what server notifications link to,
 * `/crm?view=proposals&proposal=12`) pick the screen too. Every list follows the company the
 * desktop is showing (`org_id`, scope.tsx).
 */
const Dashboard = lazy(() => import('./Dashboard'));
const Leads = lazy(() => import('./Leads'));
const FollowUps = lazy(() => import('./FollowUps'));
const Pipeline = lazy(() => import('./Pipeline'));
const Accounts = lazy(() => import('./Accounts'));
const Quotes = lazy(() => import('./Quotes'));
const Proposals = lazy(() => import('./Proposals'));
const Estimates = lazy(() => import('./Estimates'));
const PriceList = lazy(() => import('./PriceList'));
const Intake = lazy(() => import('./Intake'));
const Reports = lazy(() => import('./Reports'));
const CrmSettings = lazy(() => import('./Settings'));
const CrmAccess = lazy(() => import('./Settings').then((m) => ({ default: m.Access })));

const TITLES: Record<CrmView, string> = {
  dash: 'Dashboard',
  pipe: 'Pipeline',
  leads: 'Leads',
  fu: 'Follow-ups',
  acc: 'Accounts',
  estimates: 'Estimates',
  quotes: 'Quotes',
  proposals: 'Proposals',
  price: 'Price list',
  reports: 'Reports',
  intake: 'Lead intake',
  set: 'Settings',
  access: 'My access',
};

const num = (v: string | null | undefined) => (v && /^\d+$/.test(v) ? Number(v) : null);

/** The web's `?view=` names, which server notifications and links carry, as the screens here. */
const WEB_VIEWS: Record<string, CrmView> = {
  dashboard: 'dash', deals: 'pipe', pipeline: 'pipe', leads: 'leads', followups: 'fu', accounts: 'acc', estimates: 'estimates', quotes: 'quotes', proposals: 'proposals', approvals: 'proposals', reports: 'reports', settings: 'set',
};

export default function CrmShell(_props: ModuleProps) {
  const { path, query, go } = useTab();
  const lead = path[1] === 'leads' ? num(path[2]) : num(query.get('lead'));
  const deal = num(query.get('deal'));
  const account = num(query.get('account'));
  const quote = num(query.get('quote'));
  const proposal = path[1] === 'proposals' ? num(path[2]) : num(query.get('proposal'));
  const estimate = path[1] === 'estimates' ? num(path[2]) : num(query.get('estimate'));
  const needle = query.get('q') ?? '';
  const creating = query.get('new') === '1';
  const asked = (query.get('tab') ?? WEB_VIEWS[query.get('view') ?? ''] ?? (path[1] === 'proposals' ? 'proposals' : path[1] === 'estimates' ? 'estimates' : '')) as CrmView;
  const view: CrmView = asked && NATIVE.has(asked) ? asked : lead || creating ? 'leads' : deal ? 'pipe' : account ? 'acc' : quote ? 'quotes' : proposal ? 'proposals' : estimate ? 'estimates' : 'dash';
  useTabTitle(`CRM · ${TITLES[view]}`);

  const scope = useCrmScope();
  const dash = useDashboard(false, scope.params);
  const fu = useFollowUpCounts(scope.params);
  const canApprove = useCanApprove();
  const approvals = usePendingApprovals(canApprove);
  const kpi = dash.data?.kpi;
  const counts = {
    openDeals: kpi?.open_deals ?? 0,
    newLeads: kpi?.leads_new ?? 0,
    late: fu.data?.counts.overdue ?? 0,
    tasksToday: kpi?.tasks_today ?? 0,
    meetingsToday: kpi?.meetings_today ?? 0,
    toApprove: approvals.data?.length ?? 0,
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
          onOpenHit={(h) => go(crmRoute(h))}
        />
      </SidePanel>
      <main className="relative flex min-w-0 flex-1 flex-col overflow-y-auto bg-ground px-[22px] py-[18px] scroll-thin">
        <Suspense fallback={<Spinner />}>
          {view === 'dash' ? <Dashboard onOpenProposal={(id) => go(`/crm?tab=proposals&proposal=${id}`)} onOpenEstimate={(id) => go(`/crm?tab=estimates&estimate=${id}`)} onPick={pick} onNewLead={() => go('/crm?tab=leads&new=1')} onOpenDeal={(id) => go(`/crm?tab=pipe&deal=${id}`)} onOpenLead={(id) => go(`/crm/leads/${id}`)} /> : null}
          {view === 'leads' ? <Leads openId={lead} creating={creating} onNew={() => go('/crm?tab=leads&new=1')} onOpen={(id) => go(id ? `/crm/leads/${id}` : '/crm?tab=leads')} onCreated={(id) => go(`/crm/leads/${id}`)} onCloseNew={() => go('/crm?tab=leads')} onOpenDeal={(id) => go(`/crm?tab=pipe&deal=${id}`)} onOpenAccount={(id) => go(`/crm?tab=acc&account=${id}`)} /> : null}
          {view === 'fu' ? <FollowUps onOpen={(r) => go(crmRoute(r))} /> : null}
          {view === 'pipe' ? <Pipeline openId={deal} onOpen={(id) => go(id ? `/crm?tab=pipe&deal=${id}` : '/crm?tab=pipe')} onOpenQuote={(id) => go(`/crm?tab=quotes&quote=${id}`)} /> : null}
          {view === 'acc' ? (
            <Accounts
              openId={account}
              creating={creating}
              initialQuery={needle}
              onOpen={(id) => go(id ? `/crm?tab=acc&account=${id}` : '/crm?tab=acc')}
              onNew={() => go('/crm?tab=acc&new=1')}
              onCloseNew={() => go('/crm?tab=acc')}
              onOpenDeal={(id) => go(`/crm?tab=pipe&deal=${id}`)}
              onOpenQuote={(id) => go(`/crm?tab=quotes&quote=${id}`)}
              onNewQuote={(id) => go(`/crm?tab=quotes&new=1&account=${id}`)}
            />
          ) : null}
          {view === 'quotes' ? <Quotes openId={quote} creating={creating} forAccount={account} onOpenAccount={(id) => go(`/crm?tab=acc&account=${id}`)} onOpenInvoice={(id) => go(`/billing?tab=inv&invoice=${id}`)} onOpen={(id) => go(id ? `/crm?tab=quotes&quote=${id}` : '/crm?tab=quotes')} onNew={() => go('/crm?tab=quotes&new=1')} onCloseNew={() => go('/crm?tab=quotes')} /> : null}
          {view === 'proposals' ? <Proposals openId={proposal} onOpen={(id) => go(id ? `/crm?tab=proposals&proposal=${id}` : '/crm?tab=proposals')} onOpenDeal={(id) => go(`/crm?tab=pipe&deal=${id}`)} onOpenEstimate={(id) => go(`/crm?tab=estimates&estimate=${id}`)} /> : null}
          {view === 'estimates' ? <Estimates openId={estimate} onOpen={(id) => go(id ? `/crm?tab=estimates&estimate=${id}` : '/crm?tab=estimates')} onOpenQuote={(id) => go(`/crm?tab=quotes&quote=${id}`)} onOpenProposal={(id) => go(`/crm?tab=proposals&proposal=${id}`)} onOpenRecord={(r) => go(crmRoute(r))} /> : null}
          {view === 'price' ? <PriceList /> : null}
          {view === 'reports' ? <Reports /> : null}
          {view === 'intake' ? <Intake /> : null}
          {view === 'set' ? <CrmSettings /> : null}
          {view === 'access' ? <CrmAccess /> : null}
        </Suspense>
      </main>
    </div>
  );
}

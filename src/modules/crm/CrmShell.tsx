import { lazy, Suspense } from 'react';
import { call } from '../../core/bridge';
import { useTab, useTabTitle } from '../../core/tab-context';
import { Spinner } from '../../components/ui';
import type { ModuleProps } from '../registry';
import { useDashboard, useFollowUpCounts } from './api';
import { CrmRail, NATIVE, type CrmView } from './Rail';

/**
 * CRM (the "11 · CRM" designs): the rail, and the screen it points at.
 * Addressed as `/crm?tab=…`; a lead as `/crm/leads/<id>` (what notifications
 * and search link to), a deal as `?deal=<id>`, and `?new=1` opens New lead.
 */
const Dashboard = lazy(() => import('./Dashboard'));
const Leads = lazy(() => import('./Leads'));
const FollowUps = lazy(() => import('./FollowUps'));
const Pipeline = lazy(() => import('./Pipeline'));

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
  const creating = query.get('new') === '1';
  const asked = (query.get('tab') ?? '') as CrmView;
  const view: CrmView = lead || creating ? 'leads' : deal ? 'pipe' : asked && NATIVE.has(asked) ? asked : 'dash';
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
      <CrmRail
        view={view}
        onPick={pick}
        counts={counts}
        onNewLead={() => go('/crm?tab=leads&new=1')}
        onOpenHit={(h) => {
          if (h.type === 'lead') go(`/crm/leads/${h.id}`);
          else if (h.type === 'deal') go(`/crm?tab=pipe&deal=${h.id}`);
          else if (h.type === 'account') void call('app:openInBrowser', { path: `/crm?account=${h.id}` });
          else go('/crm?tab=leads');
        }}
      />
      <main className="relative flex min-w-0 flex-1 flex-col overflow-y-auto bg-ground px-[22px] py-[18px] scroll-thin">
        <Suspense fallback={<Spinner />}>
          {view === 'dash' ? <Dashboard onPick={pick} onOpenDeal={(id) => go(`/crm?tab=pipe&deal=${id}`)} onOpenLead={(id) => go(`/crm/leads/${id}`)} /> : null}
          {view === 'leads' ? <Leads openId={lead} creating={creating} onNew={() => go('/crm?tab=leads&new=1')} onOpen={(id) => go(id ? `/crm/leads/${id}` : '/crm?tab=leads')} onCreated={(id) => go(`/crm/leads/${id}`)} onCloseNew={() => go('/crm?tab=leads')} onOpenDeal={(id) => go(`/crm?tab=pipe&deal=${id}`)} /> : null}
          {view === 'fu' ? <FollowUps onOpenLead={(id) => go(`/crm/leads/${id}`)} /> : null}
          {view === 'pipe' ? <Pipeline openId={deal} onOpen={(id) => go(id ? `/crm?tab=pipe&deal=${id}` : '/crm?tab=pipe')} /> : null}
        </Suspense>
      </main>
    </div>
  );
}

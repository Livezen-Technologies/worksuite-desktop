import { useQuery } from '@tanstack/react-query';
import { lazy, Suspense, useEffect, useState } from 'react';
import { useTab, useTabTitle } from '../../core/tab-context';
import { SidePanel } from '../../components/SidePanel';
import { Spinner } from '../../components/ui';
import type { ModuleProps } from '../registry';
import { fetchAccess, fetchDashboard, K } from './api';
import { OFFLINE, ReadOnly, useOnline } from './parts';
import { NATIVE, PayrollRail, type PayView } from './Rail';

/**
 * Payroll on the desktop (WS-PAYROLL-SRS-001 §D1, the "Payroll — Desktop" boards D01–D25), addressed as
 * `/payroll?tab=<view>` with `&run=`, `&employee=`, `&settlement=` for the record a screen is about. ⌘N starts a new
 * run (D03) from anywhere in the module. Offline (D25) every screen shows the last copy the server sent and every
 * action is off. Every figure is the server's (docs/payroll-api.md).
 */
const Home = lazy(() => import('./Home'));
const Runs = lazy(() => import('./Runs'));
const NewRun = lazy(() => import('./NewRun'));
const RunWorkspace = lazy(() => import('./RunWorkspace'));
const RunApproval = lazy(() => import('./RunApproval'));
const Employees = lazy(() => import('./Employees'));
const PayProfile = lazy(() => import('./PayProfile'));
const Inputs = lazy(() => import('./Inputs'));
const Loans = lazy(() => import('./Loans'));
const Settlements = lazy(() => import('./Settlements'));
const Payslips = lazy(() => import('./Payslips'));
const Template = lazy(() => import('./Template'));
const Disbursements = lazy(() => import('./Disbursements'));
const Statutory = lazy(() => import('./Statutory'));
const Reports = lazy(() => import('./Reports'));
const Setup = lazy(() => import('./Setup'));
const Settings = lazy(() => import('./Settings'));

const TITLES: Record<PayView, string> = {
  home: 'Home', runs: 'Runs', run: 'Run', approve: 'Approve run', employees: 'Employees', profile: 'Pay profile', inputs: 'Inputs', loans: 'Loans',
  settlements: 'Final settlements', settlement: 'Settlement', payslips: 'Payslips', template: 'Payslip template', disbursements: 'Disbursements',
  statutory: 'Statutory', reports: 'Reports', setup: 'Setup', settings: 'Settings',
};
const num = (v: string | null) => (v && /^\d+$/.test(v) ? Number(v) : null);
/** Screens about one record fall back to their list when the record is not named. */
const NEEDS: Partial<Record<PayView, 'run' | 'employee' | 'settlement'>> = { run: 'run', approve: 'run', profile: 'employee' };

export default function PayrollShell({ active }: ModuleProps) {
  const { query, go, openInNewTab, openInWindow } = useTab();
  const online = useOnline();
  const asked = (query.get('tab') ?? 'home') as PayView;
  const ids = { run: num(query.get('run')), employee: num(query.get('employee')), settlement: num(query.get('settlement')) };
  const need = NEEDS[asked];
  const view: PayView = NATIVE.has(asked) && (!need || ids[need]) ? asked : asked === 'run' || asked === 'approve' ? 'runs' : asked === 'profile' ? 'employees' : 'home';
  const [creating, setCreating] = useState(false);
  useTabTitle(`Payroll · ${TITLES[view]}`);
  const access = useQuery({ queryKey: K.access, queryFn: ({ signal }) => fetchAccess(signal), staleTime: 60_000 });
  const dash = useQuery({ queryKey: ['payroll', 'dashboard'], queryFn: ({ signal }) => fetchDashboard(signal), staleTime: 60_000, enabled: !!access.data && access.data.scope.kind !== 'self' && access.data.scope.kind !== 'none' });
  const route = (v: PayView, extra = '') => `/payroll?tab=${v}${extra}`;
  const to = (v: PayView, extra = '', newTab = false) => (newTab ? openInNewTab(route(v, extra), `Payroll · ${TITLES[v]}`) : go(route(v, extra)));

  // ⌘N — a new run (D03), only while this tab is the one in front and only online.
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'n' && online) {
        e.preventDefault();
        setCreating(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, online]);

  if (access.isPending) return <Spinner />;
  const a = access.data;
  if (!a || a.scope.kind === 'self' || a.scope.kind === 'none') {
    return (
      <div className="m-6 flex flex-col items-start gap-2 text-[13px] text-ink-2">
        <p className="m-0">{a?.scope.why ?? 'Payroll is not open to you.'}</p>
        <button type="button" className="font-bold text-primary hover:underline" onClick={() => go('/hr?tab=mypay')}>
          Open my payslips
        </button>
      </div>
    );
  }
  const d = dash.data;
  const figures = a.figures;
  const openRun = (id: number, how: 'tab' | 'here' | 'window' = 'here', approve = false) => {
    const r = route(approve ? 'approve' : 'run', `&run=${id}`);
    if (how === 'window') openInWindow(r, `Payroll · Run ${id}`);
    else if (how === 'tab') openInNewTab(r, `Payroll · Run ${id}`);
    else go(r);
  };

  return (
    <ReadOnly.Provider value={!online}>
      <div className="flex h-full min-h-0">
        <SidePanel id="payroll" label="the Payroll menu">
          <PayrollRail
            view={view}
            sub={d?.next_period?.name ?? null}
            counts={{ runs: d?.pending_approvals, settlements: d?.settlements_open }}
            onPick={(v, newTab) => to(v, '', newTab)}
            onMine={() => go('/hr?tab=mypay')}
          />
        </SidePanel>
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-ground" aria-label={`Payroll · ${TITLES[view]}`}>
          {!online ? (
            <div role="status" className="shrink-0 border-b border-warning-line bg-warning-bg px-5 py-1.5 text-[12px] font-semibold text-warning-strong dark:border-warning/40 dark:bg-warning-bg dark:text-warning">
              {`Offline · showing cached data · ${OFFLINE}`}
            </div>
          ) : null}
          <div className="min-h-0 flex-1 overflow-y-auto px-[22px] py-[18px] scroll-thin">
            <Suspense fallback={<Spinner />}>
              {view === 'home' ? (
                <Home data={dash} figures={figures} onNew={() => setCreating(true)} onGo={(v, extra) => to(v, extra)} onRun={(id, approve) => openRun(id, 'here', approve)} />
              ) : view === 'runs' ? (
                <Runs figures={figures} active={active} onOpen={openRun} onNew={() => setCreating(true)} />
              ) : view === 'run' && ids.run ? (
                <RunWorkspace id={ids.run} figures={figures} tab={query.get('view') ?? 'summary'} active={active} onTab={(t) => go(route('run', `&run=${ids.run}&view=${t}`))} onBack={() => to('runs')} onApprove={() => openRun(ids.run!, 'here', true)} onEmployee={(id) => to('profile', `&employee=${id}`)} />
              ) : view === 'approve' && ids.run ? (
                <RunApproval id={ids.run} onBack={() => openRun(ids.run!)} onDone={() => openRun(ids.run!)} />
              ) : view === 'employees' ? (
                <Employees figures={figures} onOpen={(id, newTab) => to('profile', `&employee=${id}`, newTab)} />
              ) : view === 'profile' && ids.employee ? (
                <PayProfile employee={ids.employee} figures={figures} onBack={() => to('employees')} />
              ) : view === 'inputs' ? (
                <Inputs periodId={num(query.get('period')) ?? d?.next_period?.id ?? null} />
              ) : view === 'loans' ? (
                <Loans figures={figures} />
              ) : view === 'settlements' || view === 'settlement' ? (
                <Settlements open={ids.settlement} onOpen={(id) => to('settlement', `&settlement=${id}`)} onRun={(id) => openRun(id)} />
              ) : view === 'payslips' ? (
                <Payslips runId={ids.run} figures={figures} onTemplate={() => to('template')} onRun={(id) => to('payslips', `&run=${id}`)} />
              ) : view === 'template' ? (
                <Template onBack={() => to('payslips')} />
              ) : view === 'disbursements' ? (
                <Disbursements runId={ids.run} onRun={(id) => to('disbursements', `&run=${id}`)} />
              ) : view === 'statutory' ? (
                <Statutory runId={ids.run} />
              ) : view === 'reports' ? (
                <Reports runId={ids.run} report={query.get('report') ?? 'register'} onReport={(k) => go(route('reports', `&report=${k}${ids.run ? `&run=${ids.run}` : ''}`))} />
              ) : view === 'setup' ? (
                <Setup tab={query.get('view') ?? 'components'} onTab={(t) => go(route('setup', `&view=${t}`))} />
              ) : (
                <Settings />
              )}
            </Suspense>
          </div>
        </main>
        {creating ? (
          <Suspense fallback={null}>
            <NewRun onClose={() => setCreating(false)} onCreated={(id) => (setCreating(false), openRun(id, 'here'))} />
          </Suspense>
        ) : null}
      </div>
    </ReadOnly.Provider>
  );
}

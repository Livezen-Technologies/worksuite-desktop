import { lazy, Suspense, useEffect } from 'react';
import { app } from '../../core/app-state';
import { call } from '../../core/bridge';
import { useStore } from '../../core/store';
import { useTab, useTabTitle } from '../../core/tab-context';
import { Spinner } from '../../components/ui';
import type { ModuleProps } from '../registry';
import { useHrCounts } from './api';
import { can, HrRail, hrSections, NATIVE, webPathFor, type HrView } from './Rail';

/**
 * HR ("People", the HR designs): the rail, and the screen it points at.
 * Screens are addressed as the web addresses them (`/hr?tab=leave`), so a
 * link from a notification or from the web lands on the same screen here.
 */
const Dashboard = lazy(() => import('./Dashboard'));
const MyHr = lazy(() => import('./MyHr'));
const MyPay = lazy(() => import('./MyPay'));
const MyDocuments = lazy(() => import('./MyDocuments'));
const Requests = lazy(() => import('./Requests'));
const MyAttendance = lazy(() => import('./MyAttendance'));
const Timesheet = lazy(() => import('./Timesheet'));
const Leave = lazy(() => import('./Leave'));
const Waiting = lazy(() => import('./Waiting'));

const TITLES: Partial<Record<HrView, string>> = {
  overview: 'Dashboard',
  myhr: 'My HR',
  mypay: 'My pay',
  mydocs: 'My documents',
  requests: 'Requests',
  attendance: 'My attendance',
  timesheet: 'Timesheet',
  leave: 'Leave',
  waiting: 'Waiting on me',
};

export default function HrShell(_props: ModuleProps) {
  const { query, go } = useTab();
  const perms = useStore(app, (s) => s.bootstrap?.permissions);
  const counts = useHrCounts();
  const staff = can(perms, 'hr.view');
  const asked = (query.get('tab') ?? '') as HrView;
  // Old desktop addresses: "approvals" was the queue now called "Waiting on me".
  const wanted: HrView = (asked as string) === 'approvals' && !counts.reviewsTimesheets ? 'waiting' : asked;
  const allowed = hrSections(perms, counts).flatMap((s) => s.items.map((i) => i.id));
  const view: HrView = wanted && NATIVE.has(wanted) && allowed.includes(wanted) ? wanted : staff ? 'overview' : 'myhr';
  useTabTitle(`HR · ${TITLES[view] ?? 'People'}`);

  // A web-only screen asked for by address opens in the browser, once.
  const elsewhere = wanted && !NATIVE.has(wanted) && allowed.includes(wanted) ? wanted : null;
  useEffect(() => {
    if (!elsewhere) return;
    void call('app:openInBrowser', { path: webPathFor(elsewhere) });
    go(`/hr?tab=${staff ? 'overview' : 'myhr'}`);
  }, [elsewhere, go, staff]);

  const pick = (v: HrView) => go(`/hr?tab=${v}`);
  return (
    <div className="flex h-full min-h-0">
      <HrRail view={view} onPick={pick} counts={counts} />
      <main className="relative flex min-w-0 flex-1 flex-col overflow-y-auto bg-ground px-[22px] py-[18px] scroll-thin">
        <Suspense fallback={<Spinner />}>
          {view === 'overview' ? <Dashboard onPick={pick} /> : null}
          {view === 'myhr' ? <MyHr onPick={pick} /> : null}
          {view === 'mypay' ? <MyPay /> : null}
          {view === 'mydocs' ? <MyDocuments /> : null}
          {view === 'requests' ? <Requests /> : null}
          {view === 'attendance' ? <MyAttendance onPick={pick} /> : null}
          {view === 'timesheet' ? <Timesheet /> : null}
          {view === 'leave' ? <Leave /> : null}
          {view === 'waiting' ? <Waiting onPick={pick} /> : null}
        </Suspense>
      </main>
    </div>
  );
}

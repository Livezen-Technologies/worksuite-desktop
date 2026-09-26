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
const WorkPattern = lazy(() => import('./WorkPattern'));
const MyAccess = lazy(() => import('./MyAccess'));
const Directory = lazy(() => import('./Directory'));
const EmployeeProfile = lazy(() => import('./EmployeeProfile'));
const TeamAttendance = lazy(() => import('./TeamAttendance'));
const MissingCheckouts = lazy(() => import('./MissingCheckouts'));
const TimesheetApprovals = lazy(() => import('./TimesheetApprovals'));
const Reports = lazy(() => import('./Reports'));
const Onboarding = lazy(() => import('./Onboarding'));
const MyOnboarding = lazy(() => import('./MyOnboarding'));
const Resignations = lazy(() => import('./Resignations'));
const MyResignation = lazy(() => import('./MyResignation'));
const Offboarding = lazy(() => import('./Offboarding'));
const Schedules = lazy(() => import('./Schedules'));
const Settings = lazy(() => import('./Settings'));
const Announcements = lazy(() => import('./Announcements'));
const Departments = lazy(() => import('./Departments'));
const Devices = lazy(() => import('./Devices'));

const TITLES: Partial<Record<HrView, string>> = {
  departments: 'Departments',
  overview: 'Dashboard',
  myhr: 'My HR',
  mypay: 'My pay',
  mydocs: 'My documents',
  requests: 'Requests',
  attendance: 'My attendance',
  timesheet: 'Timesheet',
  leave: 'Leave',
  waiting: 'Waiting on me',
  workpattern: 'Work pattern',
  myaccess: 'My access',
  people: 'Directory',
  roster: 'Team attendance',
  openatt: 'Missing check-outs',
  approvals: 'Timesheet approvals',
  reports: 'Reports',
  onboarding: 'Onboarding',
  myonboarding: 'My onboarding',
  resignation: 'My resignation',
  resignations: 'Resignations',
  offboarding: 'Offboarding',
  schedules: 'Work schedules',
  settings: 'Settings',
  announcements: 'Announcements',
  devices: 'Devices',
};

const num = (v: string | null) => (v && /^\d+$/.test(v) ? Number(v) : null);

export default function HrShell(_props: ModuleProps) {
  const { query, go, path } = useTab();
  const perms = useStore(app, (s) => s.bootstrap?.permissions);
  const counts = useHrCounts();
  const staff = can(perms, 'hr.view');
  // The web's profile address (/hr/employees/12) is the Directory with that profile open.
  const fromPath = path[1] === 'employees' && /^\d+$/.test(path[2] ?? '') ? Number(path[2]) : null;
  const employee = fromPath ?? (/^\d+$/.test(query.get('employee') ?? '') ? Number(query.get('employee')) : null);
  // A notification's link to one resignation or offboarding case opens it even
  // for somebody without the list (an approver in the chain, a department's clearer).
  const resignation = num(query.get('resignation'));
  const offboarding = num(query.get('offboarding'));
  const onboarding = num(query.get('onboarding'));
  const asked = (fromPath ? 'people' : (query.get('tab') ?? (resignation ? 'resignations' : offboarding ? 'offboarding' : ''))) as HrView;
  // Old desktop addresses: "approvals" was the queue now called "Waiting on me".
  const wanted: HrView = (asked as string) === 'approvals' && !counts.reviewsTimesheets ? 'waiting' : asked;
  const allowed: HrView[] = hrSections(perms, counts).flatMap((s) => s.items.map((i) => i.id));
  if (resignation) allowed.push('resignations');
  if (offboarding) allowed.push('offboarding');
  const view: HrView = wanted && NATIVE.has(wanted) && allowed.includes(wanted) ? wanted : staff ? 'overview' : 'myhr';
  useTabTitle(view === 'people' && employee ? 'HR · Profile' : `HR · ${TITLES[view] ?? 'People'}`);

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
          {view === 'overview' ? <Dashboard onPick={pick} onGo={go} /> : null}
          {view === 'myhr' ? <MyHr onPick={pick} /> : null}
          {view === 'mypay' ? <MyPay /> : null}
          {view === 'mydocs' ? <MyDocuments /> : null}
          {view === 'requests' ? <Requests /> : null}
          {view === 'attendance' ? <MyAttendance onPick={pick} /> : null}
          {view === 'timesheet' ? <Timesheet /> : null}
          {view === 'leave' ? <Leave /> : null}
          {view === 'waiting' ? <Waiting onPick={pick} /> : null}
          {view === 'workpattern' ? <WorkPattern /> : null}
          {view === 'myaccess' ? <MyAccess /> : null}
          {view === 'people' && employee ? <EmployeeProfile key={employee} id={employee} onBack={() => go('/hr?tab=people')} /> : null}
          {view === 'people' && !employee ? <Directory creating={query.get('new') === '1'} onCloseNew={() => go('/hr?tab=people')} onOpen={(id) => go(`/hr?tab=people&employee=${id}`)} /> : null}
          {view === 'roster' ? <TeamAttendance /> : null}
          {view === 'openatt' ? <MissingCheckouts /> : null}
          {view === 'approvals' ? <TimesheetApprovals /> : null}
          {view === 'reports' ? <Reports /> : null}
          {view === 'onboarding' ? <Onboarding openId={onboarding} onOpen={(id) => go(id ? `/hr?tab=onboarding&onboarding=${id}` : '/hr?tab=onboarding')} /> : null}
          {view === 'myonboarding' ? <MyOnboarding /> : null}
          {view === 'resignation' ? <MyResignation /> : null}
          {view === 'resignations' ? <Resignations openId={resignation} onOpen={(id) => go(id ? `/hr?tab=resignations&resignation=${id}` : '/hr?tab=resignations')} onOffboarding={(id) => go(`/hr?tab=offboarding&offboarding=${id}`)} /> : null}
          {view === 'offboarding' ? <Offboarding openId={offboarding} onOpen={(id) => go(id ? `/hr?tab=offboarding&offboarding=${id}` : '/hr?tab=offboarding')} /> : null}
          {view === 'schedules' ? <Schedules /> : null}
          {view === 'settings' ? <Settings section={query.get('section')} /> : null}
          {view === 'departments' ? <Departments /> : null}
          {view === 'announcements' ? <Announcements /> : null}
          {view === 'devices' ? <Devices /> : null}
        </Suspense>
      </main>
    </div>
  );
}

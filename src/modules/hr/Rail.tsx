import { useState } from 'react';
import { app, organizationName } from '../../core/app-state';
import { call } from '../../core/bridge';
import { useStore } from '../../core/store';
import { openOverlay } from '../../core/ui';
import { Icon } from '../../components/Icon';
import { cx } from '../../components/ui';

/**
 * The People rail (HrRail): For me, Employees, Time & attendance, Leave and
 * Administration, each item shown only to whoever the web shows it to (the
 * same permission, so the two can never disagree). Long sections fold unless
 * they hold the page you are on, and say how many items and alerts they hide.
 * Screens the desktop does not draw yet open in the browser, marked so.
 */
export type HrView =
  | 'overview'
  | 'myhr'
  | 'mypay'
  | 'mydocs'
  | 'myonboarding'
  | 'resignation'
  | 'requests'
  | 'announcements'
  | 'myaccess'
  | 'people'
  | 'onboarding'
  | 'resignations'
  | 'offboarding'
  | 'attendance'
  | 'timesheet'
  | 'roster'
  | 'approvals'
  | 'openatt'
  | 'reports'
  | 'workpattern'
  | 'schedules'
  | 'leave'
  | 'waiting'
  | 'settings'
  | 'devices'
  | 'departments';

/** Drawn by the desktop; the rest (Departments, which is Organization's) opens in the browser. */
export const NATIVE = new Set<HrView>(['overview', 'myhr', 'mypay', 'mydocs', 'myonboarding', 'resignation', 'requests', 'announcements', 'myaccess', 'people', 'onboarding', 'resignations', 'offboarding', 'attendance', 'timesheet', 'roster', 'approvals', 'openatt', 'reports', 'workpattern', 'schedules', 'leave', 'waiting', 'settings', 'devices']);

interface Item {
  id: HrView;
  label: string;
  icon: string;
  show: boolean;
  badge?: number;
  tone?: 'amber' | 'red';
}

export function can(perms: readonly string[] | undefined, p: string): boolean {
  return !!perms && (perms.includes('*') || perms.includes(p));
}

export function hrSections(perms: readonly string[] | undefined, counts: { requests: number; waiting: number; reviewsTimesheets: boolean }): Array<{ id: string; label: string; items: Item[] }> {
  const c = (p: string) => can(perms, p);
  const staff = c('hr.view');
  const manage = c('hr.manage');
  return [
    {
      id: 'me',
      label: 'For me',
      items: [
        { id: 'overview', label: 'Dashboard', icon: 'grid', show: staff },
        { id: 'myhr', label: 'My HR', icon: 'user', show: true },
        { id: 'mypay', label: 'My pay', icon: 'banknote', show: true },
        { id: 'mydocs', label: 'My documents', icon: 'file-text', show: true },
        { id: 'myonboarding', label: 'My onboarding', icon: 'sparkles', show: true },
        { id: 'resignation', label: 'My resignation', icon: 'logout', show: c('hr.resignation.submit_own') },
        { id: 'requests', label: 'Requests', icon: 'inbox', show: true, badge: counts.requests, tone: 'amber' },
        { id: 'announcements', label: 'Announcements', icon: 'megaphone', show: c('hr.announcement.view') },
        { id: 'myaccess', label: 'My access', icon: 'key', show: true },
      ],
    },
    {
      id: 'emp',
      label: 'Employees',
      items: [
        { id: 'people', label: 'Directory', icon: 'users', show: staff },
        { id: 'onboarding', label: 'Onboarding', icon: 'user-plus', show: c('hr.onboarding.manage') },
        { id: 'resignations', label: 'Resignations', icon: 'file-text', show: c('hr.resignation.view') },
        { id: 'offboarding', label: 'Offboarding', icon: 'door', show: c('hr.offboarding.view') },
      ],
    },
    {
      id: 'time',
      label: 'Time & attendance',
      items: [
        { id: 'attendance', label: 'My attendance', icon: 'clock', show: true },
        { id: 'timesheet', label: 'Timesheet', icon: 'file-sheet', show: true },
        { id: 'roster', label: 'Team attendance', icon: 'users', show: manage },
        { id: 'approvals', label: 'Timesheet approvals', icon: 'check-circle', show: counts.reviewsTimesheets },
        { id: 'openatt', label: 'Missing check-outs', icon: 'alert', show: manage },
        // The web shows it to everyone; the report behind it needs hr.view.
        { id: 'reports', label: 'Reports', icon: 'chart', show: staff },
        { id: 'workpattern', label: 'Work pattern', icon: 'repeat', show: true },
        { id: 'schedules', label: 'Work schedules', icon: 'calendar', show: c('hr.schedule.manage') },
      ],
    },
    {
      id: 'leave',
      label: 'Leave',
      items: [
        { id: 'leave', label: 'Requests & calendar', icon: 'calendar-check', show: true },
        { id: 'waiting', label: 'Waiting on me', icon: 'hourglass', show: true, badge: counts.waiting, tone: 'red' },
      ],
    },
    {
      id: 'admin',
      label: 'Administration',
      items: [
        { id: 'settings', label: 'Settings', icon: 'settings', show: manage || c('hr.schedule.manage') },
        { id: 'devices', label: 'Devices', icon: 'fingerprint', show: c('hr.device.manage') },
        { id: 'departments', label: 'Departments', icon: 'building', show: staff },
      ],
    },
  ]
    .map((s) => ({ ...s, items: (s.items as Item[]).filter((i) => i.show) }))
    .filter((s) => s.items.length > 0);
}

/** Where the web shows a screen the desktop does not draw yet. */
export function webPathFor(view: HrView): string {
  return view === 'departments' ? '/organization' : `/hr?tab=${view}`;
}

export function HrRail({ view, onPick, counts }: { view: HrView; onPick: (v: HrView) => void; counts: { requests: number; waiting: number; reviewsTimesheets: boolean } }) {
  const perms = useStore(app, (s) => s.bootstrap?.permissions);
  const orgId = useStore(app, (s) => s.organizationId);
  const orgs = useStore(app, (s) => s.bootstrap?.organizations.length ?? 0);
  const sections = hrSections(perms, counts);
  const holding = sections.find((s) => s.items.some((i) => i.id === view))?.id;
  const [shut, setShut] = useState<Record<string, boolean> | null>(null);
  const closed = shut ?? { time: holding !== 'time', admin: holding !== 'admin' };

  return (
    <nav aria-label="People" className="flex w-[220px] shrink-0 flex-col overflow-hidden border-r border-line bg-[#FBFBFD] text-[13px] text-ink dark:bg-surface">
      <div className="flex flex-col gap-2.5 px-3 pt-3.5 pb-2">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] border border-[#E4D8FB] bg-[#F3EEFD] text-[#7C3AED] dark:border-[#3B2A63] dark:bg-[#231A3A] dark:text-[#B794F4]">
            <Icon name="users" size={17} />
          </span>
          <span className="flex flex-col">
            <b className="text-[14.5px] tracking-[-0.1px]">People</b>
            <span className="text-[11px] text-ink-3">Employees &amp; leave</span>
          </span>
        </div>
        <button type="button" aria-label="Company scope" onClick={() => openOverlay('org')} className="flex h-[34px] items-center gap-2 rounded-[10px] border border-line bg-surface pr-2 pl-2.5 text-[12.5px] font-semibold text-ink hover:bg-subtle">
          <span className="min-w-0 flex-1 truncate text-left">{organizationName(orgId)}</span>
          {orgs > 1 ? <span className="flex h-[18px] items-center rounded-[9px] bg-selection px-1.5 text-[10.5px] font-bold text-primary">+{orgs - 1}</span> : null}
          <Icon name="chevrons-up-down" size={13} className="text-ink-3" />
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2.5 pb-2.5 scroll-thin">
        {sections.map((s) => {
          const isShut = !!closed[s.id];
          const alerts = s.items.reduce((n, i) => n + (i.badge ?? 0), 0);
          return (
            <div key={s.id} className="flex flex-col">
              <button
                type="button"
                aria-expanded={!isShut}
                onClick={() => setShut((prev) => {
                  const now = prev ?? { time: holding !== 'time', admin: holding !== 'admin' };
                  return { ...now, [s.id]: !now[s.id] };
                })}
                className="mt-2 flex h-6 shrink-0 items-center gap-1.5 pr-1.5 pl-2 text-left text-[11px] font-bold tracking-[.3px] text-ink-3"
              >
                <span className="flex-1">{s.label}</span>
                {isShut && alerts ? <span className="flex h-4 min-w-[18px] items-center justify-center rounded-[8px] bg-badge px-[5px] text-[10px] text-white">{alerts}</span> : null}
                {isShut ? <span className="flex h-4 min-w-[18px] items-center justify-center rounded-[8px] bg-subtle px-[5px] text-[10.5px]">{s.items.length}</span> : null}
                <Icon name="chevron-down" size={12} className={cx('shrink-0 transition-transform', isShut && '-rotate-90')} />
              </button>
              {isShut
                ? null
                : s.items.map((i) => {
                    const on = i.id === view;
                    const web = !NATIVE.has(i.id);
                    return (
                      <button
                        key={i.id}
                        type="button"
                        title={web ? `${i.label} — opens in your browser` : i.label}
                        aria-current={on ? 'page' : undefined}
                        onClick={() => (web ? void call('app:openInBrowser', { path: webPathFor(i.id) }) : onPick(i.id))}
                        className={cx('relative flex h-[27px] shrink-0 items-center gap-[9px] rounded-[8px] pr-2 pl-2.5 text-left', on ? 'bg-[#EAEDFB] font-bold text-[#1B2A85] dark:bg-selection dark:text-primary' : 'font-medium text-ink hover:bg-subtle')}
                      >
                        <span className={cx('absolute top-1.5 bottom-1.5 left-0 w-[3px] rounded-r-[3px]', on ? 'bg-primary' : 'bg-transparent')} />
                        <Icon name={i.icon} size={16} className={cx('shrink-0', on ? 'text-primary' : 'text-ink-3')} />
                        <span className="min-w-0 flex-1 truncate">{i.label}</span>
                        {i.badge ? (
                          <span className={cx('flex h-[18px] min-w-5 shrink-0 items-center justify-center rounded-[9px] px-1.5 text-[11px] font-bold tabular-nums', on ? 'bg-surface text-primary' : i.tone === 'red' ? 'bg-badge text-white' : 'bg-[#FFF4E0] text-[#9A4A06] dark:bg-warning-bg dark:text-warning')}>{i.badge}</span>
                        ) : web ? (
                          <Icon name="external" size={12} className="shrink-0 text-ink-3" />
                        ) : null}
                      </button>
                    );
                  })}
            </div>
          );
        })}
      </div>
    </nav>
  );
}

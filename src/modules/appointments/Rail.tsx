import type { MouseEvent } from 'react';
import { Icon } from '../../components/Icon';
import { cx } from '../../components/ui';

/**
 * The Appointments rail (DModRail, 88px): Today, Calendar, List, Walk-in, Clients, Waitlist, Outbox, Reports,
 * Commission, Set up — with the desk's connection, location and who is at it at the foot. ⌘-click (Ctrl-click) opens a
 * screen in a new tab.
 */
export type View =
  | 'today' | 'calendar' | 'list' | 'walkin' | 'clients' | 'client' | 'waitlist' | 'outbox' | 'reports' | 'commission' | 'setup'
  | 'checkout' | 'settings' | 'alerts' | 'daysheet';

export const VIEWS = new Set<string>(['today', 'calendar', 'list', 'walkin', 'clients', 'client', 'waitlist', 'outbox', 'reports', 'commission', 'setup', 'checkout', 'settings', 'alerts', 'daysheet']);

export const TITLES: Record<View, string> = {
  today: 'Today', calendar: 'Calendar', list: 'List', walkin: 'Walk-in', clients: 'Clients', client: 'Client', waitlist: 'Waitlist', outbox: 'Outbox',
  reports: 'Reports', commission: 'Commission', setup: 'Set up', checkout: 'Checkout', settings: 'This desk', alerts: 'Notifications', daysheet: 'Day sheets',
};

const UNDER: Partial<Record<View, View>> = { client: 'clients', checkout: 'today', daysheet: 'calendar', settings: 'setup', alerts: 'today' };

const ITEMS: Array<[View, string, string]> = [
  ['today', 'Today', 'grid'],
  ['calendar', 'Calendar', 'calendar'],
  ['list', 'List', 'list'],
  ['walkin', 'Walk-in', 'user-plus'],
  ['clients', 'Clients', 'users'],
  ['waitlist', 'Waitlist', 'hourglass'],
  ['outbox', 'Outbox', 'inbox'],
  ['reports', 'Reports', 'chart'],
  ['commission', 'Commission', 'banknote'],
  ['setup', 'Set up', 'settings'],
];

export function Rail({ view, counts, online, location, me, onPick }: {
  view: View;
  counts: Partial<Record<View, number>>;
  online: boolean;
  location: string | null;
  me: string;
  onPick: (v: View, newTab: boolean) => void;
}) {
  const at = UNDER[view] ?? view;
  return (
    <nav aria-label="Appointments" className="flex w-[88px] shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-line bg-surface px-[7px] py-2.5 scroll-thin">
      <div className="pt-1 pb-2 text-center text-[9.5px] font-extrabold tracking-[.08em] text-[#DB2777]">APPOINTMENTS</div>
      {ITEMS.map(([id, text, icon]) => {
        const on = at === id;
        const n = counts[id];
        const tone = id === 'waitlist' ? 'bg-[#B45309]' : id === 'outbox' ? 'bg-[#F59E0B]' : 'bg-[#23349E] dark:bg-primary';
        return (
          <button
            key={id}
            type="button"
            aria-current={on ? 'page' : undefined}
            onClick={(e: MouseEvent) => onPick(id, e.metaKey || e.ctrlKey)}
            className={cx('flex flex-col items-center gap-1 rounded-[12px] px-0.5 py-2 text-[11.5px]', on ? 'bg-[#EEF1FD] font-bold text-[#23349E] dark:bg-selection dark:text-primary' : 'font-medium text-ink-2 hover:bg-subtle')}
          >
            <span className="relative flex">
              <Icon name={icon} size={22} />
              {n ? <span className={cx('absolute -top-1.5 -right-2.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[10.5px] font-bold text-white tabular-nums', tone)}>{n}</span> : null}
            </span>
            <span>{text}</span>
          </button>
        );
      })}
      <div className="mt-auto flex flex-col items-center gap-1 pt-3 text-center text-[10px] leading-tight text-ink-2">
        <span role="status" className={cx('flex items-center gap-1 font-bold', online ? 'text-[#1F7A4D] dark:text-success' : 'text-[#B45309] dark:text-warning')}>
          <span className={cx('h-[7px] w-[7px] rounded-full', online ? 'bg-[#1F7A4D] dark:bg-success' : 'bg-[#B45309] dark:bg-warning')} />
          {online ? 'Online' : 'Offline'}
        </span>
        {location ? <span>{location}</span> : null}
        <span className="mt-1 border-t border-line pt-1.5">{me}</span>
      </div>
    </nav>
  );
}

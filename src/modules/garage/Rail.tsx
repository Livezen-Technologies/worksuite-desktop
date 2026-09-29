import type { ReactNode } from 'react';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { cx } from '../../components/ui';
import type { Company } from './api';
import type { GarageView } from './registry';
import { LISTS } from './parts';

/**
 * The Garage rail (SRS §8), in the order a service desk works: the overview
 * and the board, the jobs by where they are, the customers and vehicles, and
 * the workshop's set-up. An item the reader may not use in any company in
 * view is not there at all. The company picker narrows everything on it.
 */
export interface RailProps {
  /** What is open: a rail view id, or `jobs:<list>` for a jobs preset; null while a record is open. */
  current: string | null;
  onView: (view: string, list?: string) => void;
  onWalkIn: (() => void) | null;
  /** Job counts per board column, from the board. */
  counts: Record<string, number>;
  org: string;
  companies: Company[];
  onOrg: (org: string) => void;
  show: { overview: boolean; jobs: boolean; customers: boolean; vehicles: boolean; setup: boolean; settings: boolean };
  /** Stage-B screens the reader may open. */
  extra: GarageView[];
  /** Companies in view whose garage still needs setting up (FR-APP-04). */
  setupLeft: number;
}

export function GarageRail({ current, onView, onWalkIn, counts, org, companies, onOrg, show, extra, setupLeft }: RailProps) {
  const item = (key: string, label: string, icon: string, go: () => void, badge?: number, tone?: 'red' | 'amber', hint?: ReactNode) => {
    const on = current === key;
    return (
      <button
        key={key}
        type="button"
        aria-current={on ? 'page' : undefined}
        onClick={go}
        className={cx('relative flex h-[30px] shrink-0 items-center gap-[9px] rounded-[8px] pr-2 pl-2.5 text-left', on ? 'bg-[#EAEDFB] font-bold text-[#1B2A85] dark:bg-selection dark:text-primary' : 'font-medium text-ink hover:bg-subtle')}
      >
        <span className={cx('absolute top-1.5 bottom-1.5 left-0 w-[3px] rounded-r-[3px]', on ? 'bg-primary' : 'bg-transparent')} />
        <Icon name={icon} size={16} className={cx('shrink-0', on ? 'text-primary' : 'text-ink-3')} />
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {hint}
        {badge ? (
          <span
            className={cx(
              'flex h-[18px] min-w-5 shrink-0 items-center justify-center rounded-[9px] px-1.5 text-[11px] font-bold tabular-nums',
              tone === 'red' ? 'bg-[#FCE9E4] text-[#8C2A14] dark:bg-danger-bg dark:text-danger' : tone === 'amber' ? 'bg-[#FFF4E0] text-[#9A4A06] dark:bg-warning-bg dark:text-warning' : 'bg-subtle text-ink-2',
            )}
          >
            {badge}
          </span>
        ) : null}
      </button>
    );
  };
  const head = (label: string) => <div className="mt-3 mb-0.5 px-2 text-[10.5px] font-bold tracking-[.6px] text-ink-3 uppercase">{label}</div>;
  const group = (g: GarageView['group']) => extra.filter((v) => v.group === g).map((v) => item(v.id, v.label, v.icon, () => onView(v.id)));
  const open = Object.entries(counts).filter(([k]) => k !== 'delivered').reduce((n, [, v]) => n + v, 0);

  return (
    <nav aria-label="Garage" className="flex w-[220px] shrink-0 flex-col overflow-hidden border-r border-line bg-[#FBFBFD] text-[13px] text-ink dark:bg-surface">
      <div className="flex flex-col gap-2 px-2.5 pt-3.5 pb-1">
        {companies.length > 1 ? (
          <Select aria-label="Companies" searchable value={org} onChange={(e) => onOrg(e.target.value)} className="h-8 rounded-[8px] border border-line bg-surface px-2 text-[12px] font-semibold text-ink">
            <option value="">Every company</option>
            {companies.map((c) => (
              <option key={c.id} value={String(c.id)}>
                {c.name}
              </option>
            ))}
          </Select>
        ) : null}
        {onWalkIn ? (
          <button type="button" onClick={onWalkIn} title="New walk-in (N)" className="flex h-8 items-center justify-center gap-1.5 rounded-[8px] bg-primary text-[12.5px] font-bold text-white hover:bg-primary-hover">
            <Icon name="plus" size={14} /> New walk-in
          </button>
        ) : null}
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2.5 pb-2.5 scroll-thin">
        {show.overview ? item('overview', 'Overview', 'grid', () => onView('overview')) : null}
        {show.jobs ? item('board', 'Job board', 'kanban', () => onView('board'), open) : null}
        {show.jobs ? (
          <>
            {head('Jobs')}
            {LISTS.map((l) => item(`jobs:${l.id}`, l.label, l.icon, () => onView('jobs', l.id), l.column ? counts[l.column] : undefined))}
          </>
        ) : null}
        {group('work')}
        {show.customers || show.vehicles ? head('Customers & vehicles') : null}
        {show.customers ? item('customers', 'Customers', 'users', () => onView('customers')) : null}
        {show.vehicles ? item('vehicles', 'Vehicles', 'car', () => onView('vehicles')) : null}
        {extra.some((v) => v.group === 'workshop') ? head('Workshop') : null}
        {group('workshop')}
        {extra.some((v) => v.group === 'reports') ? head('Reports') : null}
        {group('reports')}
        {show.setup || show.settings ? head('Workshop set-up') : null}
        {show.setup ? item('setup', 'Set-up', 'list-todo', () => onView('setup'), setupLeft || undefined, 'amber') : null}
        {show.settings ? item('settings', 'Settings', 'settings', () => onView('settings')) : null}
      </div>
    </nav>
  );
}

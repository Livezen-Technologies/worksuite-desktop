import { Icon } from '../../components/Icon';
import { cx } from '../../components/ui';
import { FINISHED, MOVING, statusOf, type Status } from './api';
import { PrimaryActionButton } from '../../components/PrimaryAction';
import { OrgSwitcher } from '../../components/OrgSwitcher';

/**
 * The Orders rail (OmsRail): a company picker, then the orders by who they
 * are waiting on — a person (approval), or us (each status still moving,
 * then those finished) — fulfilment and returns, activity and reports,
 * coupons, and the set-up screens. A screen you lack the permission for is
 * left out rather than shown and refused.
 */
export type SalesView = 'dash' | 'orders' | 'ful' | 'ret' | 'act' | 'rep' | 'cou' | 'rules' | 'set' | 'acc';

export const NATIVE = new Set<SalesView>(['dash', 'orders', 'ful', 'ret', 'act', 'rep', 'cou', 'rules', 'set', 'acc']);

/** The screens that need more than `oms.view`; the rail leaves out what you cannot open. */
export const NEEDS: Partial<Record<SalesView, string>> = { rep: 'oms.reports.view', cou: 'oms.coupons.view', set: 'oms.settings' };

export interface RailCounts {
  byStatus: Partial<Record<Status, number>>;
  total: number;
  pending: number;
  fulfilment: number;
  returns: number;
}

export function SalesRail({ view, status, onPick, onNew, counts, org, orgs, onOrg, canCreate, allowed }: {
  view: SalesView;
  /** The status the order list is narrowed to, if any. */
  status: string | null;
  onPick: (v: SalesView, status?: string | null) => void;
  onNew: () => void;
  counts: RailCounts;
  org: string;
  orgs: Array<{ id: number; name: string }>;
  onOrg: (org: string) => void;
  canCreate: boolean;
  /** Whether a screen may be opened (its permission is held). */
  allowed: (v: SalesView) => boolean;
}) {
  const item = (id: SalesView, label: string, icon: string, badge?: number, opts: { status?: string | null; tone?: 'amber' } = {}) => {
    if (!allowed(id)) return null;
    const on = view === id && (opts.status ?? null) === (id === 'orders' ? status : null);
    return (
      <button
        key={`${id}-${opts.status ?? ''}`}
        type="button"
        title={label}
        aria-current={on ? 'page' : undefined}
        onClick={() => onPick(id, opts.status ?? null)}
        className={cx('relative flex h-[30px] shrink-0 items-center gap-[9px] rounded-[8px] pr-2 pl-2.5 text-left', on ? 'bg-[#EAEDFB] font-bold text-[#1B2A85] dark:bg-selection dark:text-primary' : 'font-medium text-ink hover:bg-subtle')}
      >
        <span className={cx('absolute top-1.5 bottom-1.5 left-0 w-[3px] rounded-r-[3px]', on ? 'bg-primary' : 'bg-transparent')} />
        <Icon name={icon} size={16} className={cx('shrink-0', on ? 'text-primary' : 'text-ink-3')} />
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {badge ? (
          <span className={cx('flex h-[18px] min-w-5 shrink-0 items-center justify-center rounded-[9px] px-1.5 text-[11px] font-bold tabular-nums', opts.tone === 'amber' ? 'bg-[#FFF4E0] text-[#9A4A06] dark:bg-warning-bg dark:text-warning' : on ? 'bg-surface text-primary' : 'bg-selection text-primary')}>{badge}</span>
        ) : null}
      </button>
    );
  };
  const sub = (s: Status, dim?: boolean) => {
    const on = view === 'orders' && status === s;
    const n = counts.byStatus[s] ?? 0;
    return (
      <button
        key={s}
        type="button"
        aria-current={on ? 'page' : undefined}
        onClick={() => onPick('orders', s)}
        className={cx('flex h-[24px] shrink-0 items-center gap-[7px] rounded-[7px] pr-2 pl-[26px] text-left text-[12px]', on ? 'bg-[#EAEDFB] font-bold text-[#1B2A85] dark:bg-selection dark:text-primary' : dim ? 'text-ink-3 hover:bg-subtle' : 'text-ink hover:bg-subtle')}
      >
        <span className="h-[7px] w-[7px] shrink-0 rounded-full" style={{ background: statusOf(s).dot }} />
        <span className="min-w-0 flex-1 truncate">{statusOf(s).label}</span>
        {n ? <span className="text-[11.5px] font-bold text-ink-3 tabular-nums">{n}</span> : null}
      </button>
    );
  };
  const head = (label: string) => <div className="mt-3 mb-0.5 px-2 text-[10.5px] font-bold tracking-[.6px] text-ink-3 uppercase">{label}</div>;

  return (
    <nav aria-label="Orders" className="flex w-[220px] shrink-0 flex-col overflow-hidden border-r border-line bg-[#FBFBFD] text-[13px] text-ink dark:bg-surface">
      <div className="flex flex-col gap-2 px-2.5 pt-3.5 pb-1">
        {canCreate ? (
          <PrimaryActionButton data-guide="sales.new-order" label="New order" onClick={onNew} />
        ) : null}
        {orgs.length > 1 ? (
          <OrgSwitcher variant="field" orgs={orgs.map((c) => ({ id: String(c.id), name: c.name }))} value={org ? [org] : []} onChange={(ids) => onOrg(ids[0] ?? '')} />
        ) : null}
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2.5 pb-2.5 scroll-thin">
        {item('dash', 'Dashboard', 'grid')}
        {head('Waiting on a person')}
        {item('orders', 'Pending approval', 'hourglass', counts.pending, { status: 'pending_approval', tone: 'amber' })}
        {head('Waiting on us')}
        {item('orders', 'All orders', 'list', counts.total)}
        {MOVING.map((s) => sub(s))}
        <div className="px-2 pt-1.5 pb-0.5 pl-[26px] text-[10.5px] font-bold text-ink-3">Finished</div>
        {FINISHED.map((s) => sub(s, true))}
        {item('ful', 'Fulfilment', 'package', counts.fulfilment)}
        {head('Coming back')}
        {item('ret', 'Returns', 'undo', counts.returns)}
        {item('act', 'Activity', 'activity')}
        {item('rep', 'Reports', 'chart')}
        {allowed('cou') ? head('Pricing') : null}
        {item('cou', 'Coupons', 'receipt')}
        {head('Set up')}
        {item('rules', 'Approval rules', 'check-circle')}
        {item('set', 'Settings', 'settings')}
        {item('acc', 'My access', 'key')}
      </div>
    </nav>
  );
}

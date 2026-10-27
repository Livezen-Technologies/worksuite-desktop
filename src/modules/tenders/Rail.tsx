import { Icon } from '../../components/Icon';
import { cx } from '../../components/ui';
import type { Company } from './api';
import { PrimaryActionButton } from '../../components/PrimaryAction';
import { OrgSwitcher } from '../../components/OrgSwitcher';

/**
 * The Tenders rail, ordered by the working week rather than the data model:
 * what arrived, what is being written, what has gone out, and what came back.
 * The company picker narrows everything on it. Nothing here opens in the
 * browser any more.
 */
export type TenderView = 'dash' | 'board' | 'new' | 'following' | 'preparing' | 'submitted' | 'evaluation' | 'won' | 'lost' | 'all' | 'lib' | 'rep' | 'set' | 'acc';

export const NATIVE = new Set<string>(['dash', 'board', 'new', 'following', 'preparing', 'submitted', 'evaluation', 'won', 'lost', 'all', 'lib', 'rep', 'set', 'acc']);

export function TenderRail({
  view,
  onPick,
  onNew,
  counts,
  expired,
  org,
  companies,
  onOrg,
  canSettings,
}: {
  view: TenderView | null;
  onPick: (v: TenderView) => void;
  /** Start a tender, for those who may. */
  onNew: (() => void) | null;
  counts: Record<string, number>;
  /** Library documents past their expiry. */
  expired: number;
  org: string;
  companies: Company[];
  onOrg: (org: string) => void;
  canSettings: boolean;
}) {
  const item = (id: TenderView, label: string, icon: string, badge?: number, tone?: 'red') => {
    const on = view === id;
    return (
      <button
        key={id}
        type="button"
        aria-current={on ? 'page' : undefined}
        onClick={() => onPick(id)}
        className={cx('relative flex h-[30px] shrink-0 items-center gap-[9px] rounded-[8px] pr-2 pl-2.5 text-left', on ? 'bg-info-bg font-bold text-info-ink dark:bg-selection dark:text-primary' : 'font-medium text-ink hover:bg-subtle')}
      >
        <span className={cx('absolute top-1.5 bottom-1.5 left-0 w-[3px] rounded-r-[3px]', on ? 'bg-primary' : 'bg-transparent')} />
        <Icon name={icon} size={16} className={cx('shrink-0', on ? 'text-primary' : 'text-ink-3')} />
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {badge ? (
          <span
            className={cx(
              'flex h-[18px] min-w-5 shrink-0 items-center justify-center rounded-[9px] px-1.5 text-[11px] font-bold tabular-nums',
              tone === 'red' ? 'bg-danger-bg text-danger-ink dark:bg-danger-bg dark:text-danger' : 'bg-subtle text-ink-2',
            )}
            title={tone === 'red' ? `${badge} expired` : undefined}
          >
            {badge}
          </span>
        ) : null}
      </button>
    );
  };
  const head = (label: string) => <div className="mt-3 mb-0.5 px-2 text-[10.5px] font-bold tracking-[.6px] text-ink-3 uppercase">{label}</div>;

  return (
    <nav aria-label="Tenders" className="flex w-[220px] shrink-0 flex-col overflow-hidden border-r border-line bg-rail text-[13px] text-ink dark:bg-surface">
      <div className="flex flex-col gap-2 px-2.5 pt-3.5 pb-1">
        {companies.length > 1 ? (
          <OrgSwitcher variant="field" orgs={companies.map((c) => ({ id: String(c.id), name: c.name }))} value={org ? [org] : []} onChange={(ids) => onOrg(ids[0] ?? '')} />
        ) : null}
        {onNew ? (
          <PrimaryActionButton label="New tender" onClick={onNew} />
        ) : null}
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2.5 pb-2.5 scroll-thin">
        {item('dash', 'Dashboard', 'grid')}
        {item('board', 'Pipeline', 'board', counts.open)}
        {item('all', 'All tenders', 'list')}
        {head('Coming in')}
        {item('new', 'New opportunities', 'inbox', counts.new)}
        {item('following', 'Following', 'eye', counts.following)}
        {head('In hand')}
        {item('preparing', 'Preparing', 'list-todo', counts.preparing)}
        {item('submitted', 'Submitted', 'send', counts.submitted)}
        {item('evaluation', 'Evaluation', 'hourglass', counts.evaluation)}
        {head('Decided')}
        {item('won', 'Won', 'star', counts.won)}
        {item('lost', 'Lost', 'x', counts.lost)}
        {head('Company')}
        {item('lib', 'Document library', 'file', expired, 'red')}
        {item('rep', 'Reports', 'chart')}
        {canSettings ? item('set', 'Settings', 'settings') : null}
        {head('Administration')}
        {item('acc', 'My access', 'shield-check')}
      </div>
    </nav>
  );
}

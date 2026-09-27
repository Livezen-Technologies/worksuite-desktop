import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { cx } from '../../components/ui';
import type { Company } from './api';
import { openWeb } from './parts';

/**
 * The Tenders rail, ordered by the working week rather than the data model:
 * what arrived, what is being written, what has gone out, and what came back.
 * The company picker narrows everything on it. The document library, reports
 * and settings open in the browser for now.
 */
export type TenderView = 'dash' | 'board' | 'new' | 'following' | 'preparing' | 'submitted' | 'evaluation' | 'won' | 'lost' | 'all' | 'acc';

export const NATIVE = new Set<string>(['dash', 'board', 'new', 'following', 'preparing', 'submitted', 'evaluation', 'won', 'lost', 'all', 'acc']);

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
  const item = (id: TenderView, label: string, icon: string, badge?: number) => {
    const on = view === id;
    return (
      <button
        key={id}
        type="button"
        aria-current={on ? 'page' : undefined}
        onClick={() => onPick(id)}
        className={cx('relative flex h-[30px] shrink-0 items-center gap-[9px] rounded-[8px] pr-2 pl-2.5 text-left', on ? 'bg-[#EAEDFB] font-bold text-[#1B2A85] dark:bg-selection dark:text-primary' : 'font-medium text-ink hover:bg-subtle')}
      >
        <span className={cx('absolute top-1.5 bottom-1.5 left-0 w-[3px] rounded-r-[3px]', on ? 'bg-primary' : 'bg-transparent')} />
        <Icon name={icon} size={16} className={cx('shrink-0', on ? 'text-primary' : 'text-ink-3')} />
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {badge ? <span className="flex h-[18px] min-w-5 shrink-0 items-center justify-center rounded-[9px] bg-subtle px-1.5 text-[11px] font-bold text-ink-2 tabular-nums">{badge}</span> : null}
      </button>
    );
  };
  const web = (label: string, icon: string, badge?: number) => (
    <button key={label} type="button" title={`${label} — opens in your browser`} onClick={() => openWeb()} className="relative flex h-[30px] shrink-0 items-center gap-[9px] rounded-[8px] pr-2 pl-2.5 text-left font-medium text-ink hover:bg-subtle">
      <Icon name={icon} size={16} className="shrink-0 text-ink-3" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {badge ? <span className="flex h-[18px] min-w-5 shrink-0 items-center justify-center rounded-[9px] bg-[#FCE9E4] px-1.5 text-[11px] font-bold text-[#8C2A14] tabular-nums dark:bg-danger-bg dark:text-danger">{badge}</span> : null}
      <Icon name="external" size={12} className="shrink-0 text-ink-3" />
    </button>
  );
  const head = (label: string) => <div className="mt-3 mb-0.5 px-2 text-[10.5px] font-bold tracking-[.6px] text-ink-3 uppercase">{label}</div>;

  return (
    <nav aria-label="Tenders" className="flex w-[220px] shrink-0 flex-col overflow-hidden border-r border-line bg-[#FBFBFD] text-[13px] text-ink dark:bg-surface">
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
        {onNew ? (
          <button type="button" onClick={onNew} className="flex h-8 items-center justify-center gap-1.5 rounded-[8px] bg-primary text-[12.5px] font-bold text-white hover:bg-primary-hover">
            <Icon name="plus" size={14} /> New tender
          </button>
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
        {web('Document library', 'file', expired)}
        {web('Reports', 'chart')}
        {canSettings ? web('Settings', 'settings') : null}
        {head('Administration')}
        {item('acc', 'My access', 'shield-check')}
      </div>
    </nav>
  );
}

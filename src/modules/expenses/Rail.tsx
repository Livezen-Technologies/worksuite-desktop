import { useState } from 'react';
import { Icon } from '../../components/Icon';
import { cx } from '../../components/ui';
import { canAct, type Org } from './api';
import { PrimaryActionButton } from '../../components/PrimaryAction';

/**
 * The Expenses rail, ordered by the working day rather than the data model:
 * what you owe and are owed and what waits on you, then money going out,
 * then control, then insight.
 *
 * Items a person cannot use are hidden — asked of the server's area map, the
 * same resolver its route filters use, so the rail and the server cannot
 * disagree. Items that exist but are empty stay, and say so on their screen.
 */
export type ExpenseView =
  | 'dashboard' | 'mine' | 'team' | 'organization' | 'approvals'
  | 'advances' | 'petty' | 'cards' | 'reimburse' | 'postings'
  | 'budgets' | 'policies' | 'vendors' | 'subs'
  | 'analytics' | 'reports' | 'consolidated'
  | 'settings';

export const VIEWS: ExpenseView[] = ['dashboard', 'mine', 'team', 'organization', 'approvals', 'advances', 'petty', 'cards', 'reimburse', 'postings', 'budgets', 'policies', 'vendors', 'subs', 'analytics', 'reports', 'consolidated', 'settings'];

export const TITLES: Record<ExpenseView, string> = {
  dashboard: 'Dashboard',
  mine: 'My expenses',
  team: 'Team expenses',
  organization: 'Organization',
  approvals: 'Approvals',
  advances: 'Cash advances',
  petty: 'Petty cash',
  cards: 'Corporate cards',
  reimburse: 'Reimbursements',
  postings: 'Accounting export',
  budgets: 'Budgets',
  policies: 'Policies',
  vendors: 'Vendors',
  subs: 'Vendor subscriptions',
  analytics: 'Analytics',
  reports: 'Reports',
  consolidated: 'All organizations',
  settings: 'Settings',
};

/**
 * Screens shown only when the server's area map allows them (keys as
 * `/api/module-areas/expense` names them). Settings is not among them: it is
 * where My access lives, and a person refused the rest of it still gets that.
 */
export const GATED: Partial<Record<ExpenseView, string>> = {
  team: 'team',
  organization: 'organization',
  petty: 'petty',
  cards: 'cards',
  reimburse: 'reimburse',
  postings: 'postings',
  vendors: 'vendors',
  consolidated: 'consolidated',
};

/**
 * Screens that work in one company. They write, or their server side still
 * resolves a single company; with several selected they ask for one rather
 * than show one company's figures under a heading naming several.
 */
export const ONE_COMPANY = new Set<ExpenseView>(['advances', 'petty', 'cards', 'reimburse', 'postings', 'budgets', 'policies', 'vendors', 'analytics', 'reports', 'settings']);

/**
 * What every Expenses screen is given. `org` is the selection for reads ('' =
 * every company the person sees); `orgId` the one company a write happens in,
 * null when several are selected (a one-company screen always gets one).
 * `onGo` goes to another screen; `extra` is more of the address, such as
 * `&claim=12`.
 */
export interface ScreenProps {
  org: string;
  orgId: number | null;
  orgs: Org[];
  onGo: (view: ExpenseView, extra?: string) => void;
}

const ICONS: Record<ExpenseView, string> = {
  dashboard: 'grid',
  mine: 'list-todo',
  team: 'users',
  organization: 'building',
  approvals: 'check-check',
  advances: 'banknote',
  petty: 'wallet',
  cards: 'key',
  reimburse: 'truck',
  postings: 'file-text',
  budgets: 'chart',
  policies: 'shield-check',
  vendors: 'store',
  subs: 'repeat',
  analytics: 'trending-up',
  reports: 'file-text',
  consolidated: 'building',
  settings: 'settings',
};

export function ExpensesRail({
  view,
  onPick,
  onFile,
  shows,
  badges,
  orgs,
  selected,
  onSelect,
  onFavourite,
}: {
  view: ExpenseView;
  onPick: (v: ExpenseView) => void;
  /** File an expense — offered only where the person may act. */
  onFile: (() => void) | null;
  shows: (v: ExpenseView) => boolean;
  badges: Partial<Record<ExpenseView, number>>;
  orgs: Org[];
  selected: number[];
  onSelect: (ids: number[]) => void;
  onFavourite: (id: number) => void;
}) {
  const item = (id: ExpenseView) => {
    if (!shows(id)) return null;
    const on = view === id;
    const badge = badges[id];
    return (
      <button
        key={id}
        type="button"
        aria-current={on ? 'page' : undefined}
        onClick={() => onPick(id)}
        className={cx('relative flex h-[30px] shrink-0 items-center gap-[9px] rounded-[8px] pr-2 pl-2.5 text-left', on ? 'bg-[#EAEDFB] font-bold text-[#1B2A85] dark:bg-selection dark:text-primary' : 'font-medium text-ink hover:bg-subtle')}
      >
        <span className={cx('absolute top-1.5 bottom-1.5 left-0 w-[3px] rounded-r-[3px]', on ? 'bg-primary' : 'bg-transparent')} />
        <Icon name={ICONS[id]} size={16} className={cx('shrink-0', on ? 'text-primary' : 'text-ink-3')} />
        <span className="min-w-0 flex-1 truncate">{TITLES[id]}</span>
        {badge ? <span className="flex h-[18px] min-w-5 shrink-0 items-center justify-center rounded-[9px] bg-subtle px-1.5 text-[11px] font-bold text-ink-2 tabular-nums">{badge}</span> : null}
      </button>
    );
  };
  const head = (label: string, ids: ExpenseView[]) => (ids.some(shows) ? <div className="mt-3 mb-0.5 px-2 text-[10.5px] font-bold tracking-[.6px] text-ink-3 uppercase">{label}</div> : null);

  return (
    <nav aria-label="Expenses" className="flex w-[232px] shrink-0 flex-col overflow-hidden border-r border-line bg-[#FBFBFD] text-[13px] text-ink dark:bg-surface">
      <div className="flex flex-col gap-2 px-2.5 pt-3.5 pb-1">
        <OrgSwitcher orgs={orgs} selected={selected} onSelect={onSelect} onFavourite={onFavourite} />
        {onFile ? (
          <PrimaryActionButton data-guide="expenses.file" label="File an expense" onClick={onFile} />
        ) : null}
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2.5 pb-2.5 scroll-thin">
        {item('dashboard')}
        {item('mine')}
        {item('team')}
        {item('organization')}
        {item('approvals')}
        {head('Money out', ['advances', 'petty', 'cards', 'reimburse', 'postings'])}
        {item('advances')}
        {item('petty')}
        {item('cards')}
        {item('reimburse')}
        {item('postings')}
        {head('Control', ['budgets', 'policies', 'vendors', 'subs'])}
        {item('budgets')}
        {item('policies')}
        {item('vendors')}
        {item('subs')}
        {head('Insight', ['analytics', 'reports', 'consolidated'])}
        {item('analytics')}
        {item('reports')}
        {item('consolidated')}
        {head('Administration', ['settings'])}
        {item('settings')}
      </div>
    </nav>
  );
}

/**
 * The company switcher. Several may be ticked, because the dashboard and the
 * claim lists add companies up; **Only** picks one without unticking the rest
 * one at a time, which is what most people want most days. A company pinned
 * with the star sits at the top. A company visible only through consolidated
 * reporting says it can be read and not changed — here, before somebody tries
 * to act and is refused.
 */
export function OrgSwitcher({ orgs, selected, onSelect, onFavourite }: { orgs: Org[]; selected: number[]; onSelect: (ids: number[]) => void; onFavourite: (id: number) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const all = selected.length === 0;
  const chosen = orgs.filter((o) => selected.includes(o.id));
  const sorted = [...orgs].sort((a, b) => Number(b.favourite) - Number(a.favourite));
  const shown = q.trim() ? sorted.filter((o) => o.name.toLowerCase().includes(q.trim().toLowerCase())) : sorted;
  const label = all ? 'All companies' : chosen.length === 1 ? chosen[0]!.name : `${chosen.length} companies`;
  const sub = all ? 'Every company you can see' : chosen.length === 1 ? `${chosen[0]!.currency}${canAct(chosen[0]!) ? (chosen[0]!.role ? ` · ${chosen[0]!.role}` : '') : ' · read only'}` : chosen.map((o) => o.name).join(', ');
  const toggle = (id: number) => {
    const next = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
    onSelect(next);
  };

  return (
    <div className="relative">
      <button type="button" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 rounded-[9px] border border-line bg-surface px-2 py-1.5 text-left hover:bg-subtle">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] bg-primary text-[11px] font-bold text-white">{all ? '∗' : chosen.length === 1 ? chosen[0]!.name.slice(0, 2).toUpperCase() : chosen.length}</span>
        <span className="flex min-w-0 flex-1 flex-col">
          <b className="truncate text-[12.5px] text-ink">{label}</b>
          <span className="truncate text-[11px] text-ink-3">{sub}</span>
        </span>
        <Icon name="chevrons-up-down" size={14} className="shrink-0 text-ink-3" />
      </button>
      {open ? (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div role="listbox" aria-label="Companies" aria-multiselectable="true" className="absolute top-full right-0 left-0 z-40 mt-1 flex max-h-[420px] flex-col overflow-y-auto rounded-[10px] border border-line bg-surface py-1 shadow-[0_12px_32px_rgb(var(--ws-shadow-rgb)/.18)] scroll-thin">
            {orgs.length > 6 ? (
              <div className="px-2 pb-1">
                <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a company" aria-label="Find a company" className="h-7 w-full rounded-[7px] border border-line bg-ground px-2 text-[12px] text-ink outline-none focus:border-primary" />
              </div>
            ) : null}
            <button type="button" role="option" aria-selected={all} onClick={() => (onSelect([]), setOpen(false))} className={cx('flex items-center gap-2 px-2.5 py-1.5 text-left text-[12.5px]', all ? 'bg-selection font-bold text-primary' : 'text-ink hover:bg-subtle')}>
              <Box on={all} /> All companies
            </button>
            <div className="my-1 border-t border-line" />
            {shown.map((o) => {
              const on = selected.includes(o.id);
              return (
                <div key={o.id} className={cx('group flex items-center', on ? 'bg-selection' : 'hover:bg-subtle')}>
                  <button type="button" role="option" aria-selected={on} onClick={() => toggle(o.id)} className="flex min-w-0 flex-1 items-center gap-2 px-2.5 py-1.5 text-left">
                    <Box on={on} />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-[12.5px] text-ink">{o.name}</span>
                      <span className="truncate text-[11px] text-ink-3">
                        {o.currency}
                        {canAct(o) ? (o.role ? ` · ${o.role}` : '') : ' · you can read this one, not change it'}
                      </span>
                    </span>
                  </button>
                  <button type="button" title={`Show only ${o.name}`} onClick={() => (onSelect([o.id]), setOpen(false))} className="mr-1 rounded-[6px] px-1.5 py-1 text-[11px] font-semibold text-ink-3 opacity-0 group-hover:opacity-100 hover:bg-subtle hover:text-ink focus-visible:opacity-100">
                    Only
                  </button>
                  <button type="button" aria-label={o.favourite ? `Unpin ${o.name}` : `Pin ${o.name} to the top`} title={o.favourite ? 'Unpin' : 'Pin to the top'} onClick={() => onFavourite(o.id)} className={cx('mr-2 rounded-[6px] p-1', o.favourite ? 'text-[#E9A23B]' : 'text-ink-3 opacity-0 group-hover:opacity-100 focus-visible:opacity-100')}>
                    <Icon name="star" size={13} className={o.favourite ? 'fill-current' : undefined} />
                  </button>
                </div>
              );
            })}
            {!shown.length ? <p className="m-0 px-3 py-3 text-center text-[12px] text-ink-3">Nothing matches.</p> : null}
          </div>
        </>
      ) : null}
    </div>
  );
}

function Box({ on }: { on: boolean }) {
  return <span className={cx('flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border', on ? 'border-primary bg-primary text-white' : 'border-line bg-surface')}>{on ? <Icon name="check" size={11} /> : null}</span>;
}

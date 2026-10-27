import { Icon } from '../../components/Icon';
import { cx } from '../../components/ui';
import { canAct, type Org } from './api';
import { PrimaryActionButton } from '../../components/PrimaryAction';
import { OrgSwitcher as SharedOrgSwitcher } from '../../components/OrgSwitcher';
import type { MenuItem } from '../../components/Menu';

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
        className={cx('relative flex h-[30px] shrink-0 items-center gap-[9px] rounded-[8px] pr-2 pl-2.5 text-left', on ? 'bg-info-bg font-bold text-info-ink dark:bg-selection dark:text-primary' : 'font-medium text-ink hover:bg-subtle')}
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
    <nav aria-label="Expenses" className="flex w-[232px] shrink-0 flex-col overflow-hidden border-r border-line bg-rail text-[13px] text-ink dark:bg-surface">
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
 * The company switcher: the shared organisation filter (#214). Several may be ticked, because the dashboard and the
 * claim lists add companies up, and applied together; a click on a name shows only that company. A company pinned
 * to the top (Pin to the top ›) comes first. A company visible only through consolidated reporting says it can be read
 * and not changed — here, before somebody tries to act and is refused.
 */
export function OrgSwitcher({ orgs, selected, onSelect, onFavourite }: { orgs: Org[]; selected: number[]; onSelect: (ids: number[]) => void; onFavourite: (id: number) => void }) {
  const sorted = [...orgs].sort((a, b) => Number(b.favourite) - Number(a.favourite));
  const pin: MenuItem = {
    id: 'pin',
    label: 'Pin to the top',
    icon: 'star',
    submenu: [{ id: 'pins', items: sorted.map((o) => ({ id: `pin-${o.id}`, label: o.name, checked: !!o.favourite, onSelect: () => onFavourite(o.id) })) }],
  };
  return (
    <SharedOrgSwitcher
      variant="field"
      multiple
      orgs={sorted.map((o) => ({ id: String(o.id), name: o.name, hint: `${o.currency}${canAct(o) ? (o.role ? ` · ${o.role}` : '') : ' · read only'}` }))}
      value={selected.map(String)}
      onChange={(ids) => onSelect(ids.map(Number))}
      more={orgs.length > 1 ? [pin] : []}
    />
  );
}

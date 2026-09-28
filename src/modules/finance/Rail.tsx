import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { cx } from '../../components/ui';
import type { Company } from './api';

/**
 * The Finance rail, in the web's order: the company first, because it changes
 * what every item below it means; then the books, who owes what, the reports,
 * setup and administration.
 *
 * The company picker is single-choice on purpose. A trial balance across two
 * companies is not a report, it is a mistake with a total at the bottom.
 */
export type FinanceView =
  | 'dashboard' | 'accounts' | 'banks' | 'reconcile' | 'journals'
  | 'receivables' | 'payables' | 'unposted'
  | 'ledger' | 'trial' | 'pl' | 'bs' | 'cf' | 'overview' | 'cashoverview' | 'variance' | 'consolidated' | 'yearend'
  | 'budgets' | 'fx' | 'shares' | 'periods' | 'tax' | 'assetaccounts' | 'depreciation' | 'purchaseaccounts'
  | 'settings' | 'myaccess';

export const VIEWS: FinanceView[] = [
  'dashboard', 'accounts', 'banks', 'reconcile', 'journals',
  'receivables', 'payables', 'unposted',
  'ledger', 'trial', 'pl', 'bs', 'cf', 'overview', 'cashoverview', 'variance', 'consolidated', 'yearend',
  'budgets', 'fx', 'shares', 'periods', 'tax', 'assetaccounts', 'depreciation', 'purchaseaccounts',
  'settings', 'myaccess',
];

/** What this app draws itself; the rest opens in the browser until it does. */
export const NATIVE = new Set<FinanceView>(['dashboard', 'accounts', 'journals', 'periods', 'myaccess']);

export const TITLES: Record<FinanceView, string> = {
  dashboard: 'Overview',
  accounts: 'Chart of accounts',
  banks: 'Bank accounts',
  reconcile: 'Reconciliation',
  journals: 'Journals',
  receivables: 'Receivables',
  payables: 'Payables',
  unposted: 'Not in the ledger',
  ledger: 'General ledger',
  trial: 'Trial balance',
  pl: 'Profit and loss',
  bs: 'Balance sheet',
  cf: 'Cash flow and equity',
  overview: 'Financial overview',
  cashoverview: 'Cash flow overview',
  variance: 'Budget vs actual',
  consolidated: 'All companies',
  yearend: 'Year-end close',
  budgets: 'Budgets',
  fx: 'Exchange rates',
  shares: 'Shared reports',
  periods: 'Periods',
  tax: 'Tax codes',
  assetaccounts: 'Fixed-asset accounts',
  depreciation: 'Depreciation',
  purchaseaccounts: 'Purchase accounts',
  settings: 'Settings',
  myaccess: 'My access',
};

const ICONS: Record<FinanceView, string> = {
  dashboard: 'grid',
  accounts: 'notebook',
  banks: 'landmark',
  reconcile: 'check-check',
  journals: 'banknote',
  receivables: 'arrow-down',
  payables: 'arrow-up',
  unposted: 'warning',
  ledger: 'list',
  trial: 'weight',
  pl: 'trending-up',
  bs: 'file-text',
  cf: 'repeat',
  overview: 'chart',
  cashoverview: 'wallet',
  variance: 'sliders',
  consolidated: 'building',
  yearend: 'lock',
  budgets: 'calendar-check',
  fx: 'globe',
  shares: 'link',
  periods: 'calendar',
  tax: 'receipt',
  assetaccounts: 'box',
  depreciation: 'arrow-down',
  purchaseaccounts: 'cart',
  settings: 'settings',
  myaccess: 'shield-check',
};

export function FinanceRail({
  view,
  onPick,
  company,
  companies,
  onCompany,
  badges,
}: {
  view: FinanceView;
  onPick: (v: FinanceView) => void;
  company: Company | null;
  companies: Company[];
  onCompany: (id: number) => void;
  /** Counts worth a glance: journals waiting, documents not in the ledger. */
  badges: Partial<Record<FinanceView, number>>;
}) {
  const item = (id: FinanceView) => {
    const on = view === id;
    const web = !NATIVE.has(id);
    const badge = badges[id];
    return (
      <button
        key={id}
        type="button"
        aria-current={on ? 'page' : undefined}
        onClick={() => onPick(id)}
        title={web ? `${TITLES[id]} — opens in your browser` : TITLES[id]}
        className={cx('relative flex h-[30px] shrink-0 items-center gap-[9px] rounded-[8px] pr-2 pl-2.5 text-left', on ? 'bg-[#EAEDFB] font-bold text-[#1B2A85] dark:bg-selection dark:text-primary' : 'font-medium text-ink hover:bg-subtle')}
      >
        <span className={cx('absolute top-1.5 bottom-1.5 left-0 w-[3px] rounded-r-[3px]', on ? 'bg-primary' : 'bg-transparent')} />
        <Icon name={ICONS[id]} size={16} className={cx('shrink-0', on ? 'text-primary' : 'text-ink-3')} />
        <span className="min-w-0 flex-1 truncate">{TITLES[id]}</span>
        {badge ? <span className="flex h-[18px] min-w-5 shrink-0 items-center justify-center rounded-[9px] bg-subtle px-1.5 text-[11px] font-bold text-ink-2 tabular-nums">{badge}</span> : null}
        {web ? <Icon name="external" size={11} className="shrink-0 text-ink-3" /> : null}
      </button>
    );
  };
  const head = (label: string) => <div className="mt-3 mb-0.5 px-2 text-[10.5px] font-bold tracking-[.6px] text-ink-3 uppercase">{label}</div>;

  return (
    <nav aria-label="Finance" className="flex w-[228px] shrink-0 flex-col overflow-hidden border-r border-line bg-[#FBFBFD] text-[13px] text-ink dark:bg-surface">
      <div className="flex flex-col gap-1.5 px-2.5 pt-3.5 pb-1">
        <div className="px-1">
          <div className="text-[14px] font-bold text-ink">Finance</div>
          <div className="text-[11px] text-ink-3">Accounts, journals and the ledger</div>
        </div>
        {companies.length ? (
          <Select
            aria-label="Company"
            searchable
            value={company ? String(company.id) : ''}
            onChange={(e) => e.target.value && onCompany(Number(e.target.value))}
            className="h-8 rounded-[8px] border border-line bg-surface px-2 text-[12px] font-semibold text-ink"
          >
            {company ? null : <option value="">Choose a company</option>}
            {companies.map((c) => (
              <option key={c.id} value={String(c.id)}>
                {c.has_books ? c.name : `${c.name} — no books yet`}
              </option>
            ))}
          </Select>
        ) : null}
        {company?.base_currency ? <div className="px-1 text-[11px] text-ink-3">Books kept in {company.base_currency}</div> : null}
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2.5 pb-2.5 scroll-thin">
        {item('dashboard')}
        {head('The books')}
        {item('accounts')}
        {item('banks')}
        {item('reconcile')}
        {item('journals')}
        {head('Who owes what')}
        {item('receivables')}
        {item('payables')}
        {item('unposted')}
        {head('Reports')}
        {item('ledger')}
        {item('trial')}
        {item('pl')}
        {item('bs')}
        {item('cf')}
        {item('overview')}
        {item('cashoverview')}
        {item('variance')}
        {item('consolidated')}
        {item('yearend')}
        {head('Setup')}
        {item('budgets')}
        {item('fx')}
        {item('shares')}
        {item('periods')}
        {item('tax')}
        {item('assetaccounts')}
        {item('depreciation')}
        {item('purchaseaccounts')}
        {head('Administration')}
        {item('settings')}
        {item('myaccess')}
      </div>
    </nav>
  );
}

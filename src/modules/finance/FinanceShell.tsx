import { useQuery, useQueryClient } from '@tanstack/react-query';
import { lazy, Suspense } from 'react';
import { app } from '../../core/app-state';
import { useStore } from '../../core/store';
import { useTab, useTabTitle } from '../../core/tab-context';
import { Spinner } from '../../components/ui';
import { btnPrimary } from '../hr/parts';
import type { ModuleProps } from '../registry';
import { fetchCompanies, fetchDashboard, K, type Company } from './api';
import { LoadFailed } from './parts';
import { FinanceRail, TITLES, VIEWS, type FinanceView } from './Rail';

/**
 * Finance: the rail, and the screen it points at. Addressed as
 * `/finance?tab=<view>&company=<id>` with the web's view names, so a web link
 * to a Finance screen opens here; `&open=<id>` is one journal, and
 * `&make=journal` starts one. The general ledger keeps its account and dates
 * in the address too (`&account=&from=&to=`).
 *
 * THE COMPANY IS PART OF WHERE YOU ARE. It rides in the tab's route, so a
 * restored tab reopens on the books it showed, and it is remembered per
 * person for the next visit — and in every case checked against the list the
 * server sends, never trusted: access is revocable, and a company that is no
 * longer held falls through to the default as if nothing had been stored.
 */
const Overview = lazy(() => import('./Overview'));
const Accounts = lazy(() => import('./Accounts'));
const Journals = lazy(() => import('./Journals'));
const Periods = lazy(() => import('./Periods'));
const MyAccess = lazy(() => import('./MyAccess'));
const Ageing = lazy(() => import('./Ageing'));
const Unposted = lazy(() => import('./Unposted'));
const Banks = lazy(() => import('./Banks'));
const Reconcile = lazy(() => import('./Reconcile'));
const Ledger = lazy(() => import('./Ledger'));
const Trial = lazy(() => import('./Trial'));
const ProfitAndLoss = lazy(() => import('./Statements').then((m) => ({ default: m.ProfitAndLoss })));
const BalanceSheet = lazy(() => import('./Statements').then((m) => ({ default: m.BalanceSheet })));
const CashFlow = lazy(() => import('./CashFlow'));
const Budgets = lazy(() => import('./Budgets'));
const YearEnd = lazy(() => import('./YearEnd'));
const Rates = lazy(() => import('./Rates'));
const Shares = lazy(() => import('./Shares'));
const TaxCodes = lazy(() => import('./TaxCodes'));
const AssetAccounts = lazy(() => import('./AssetAccounts'));
const Depreciation = lazy(() => import('./Depreciation'));
const PurchaseAccounts = lazy(() => import('./PurchaseAccounts'));
const Settings = lazy(() => import('./Settings'));
const FinancialOverview = lazy(() => import('./FinancialOverview'));
const CashOverview = lazy(() => import('./CashOverview'));
const Variance = lazy(() => import('./Variance'));
const Consolidated = lazy(() => import('./Consolidated'));

const num = (v: string | null | undefined) => (v && /^\d+$/.test(v) ? Number(v) : null);
const memoryKey = (uid: string) => `finance.company.v1.${uid}`;

function remembered(uid: string): number | null {
  try {
    return num(localStorage.getItem(memoryKey(uid)));
  } catch {
    return null;
  }
}

function remember(uid: string, id: number) {
  try {
    localStorage.setItem(memoryKey(uid), String(id));
  } catch {
    /* not remembering is a preference lost, not a failure */
  }
}

/** The company this tab is on: the route's, else the remembered one, else one with books — each only if still held. */
export function resolveCompany(companies: Company[], fromRoute: number | null, fromMemory: number | null): Company | null {
  const held = (id: number | null) => (id === null ? undefined : companies.find((c) => c.id === id));
  return held(fromRoute) ?? held(fromMemory) ?? companies.find((c) => c.has_books) ?? companies[0] ?? null;
}

export default function FinanceShell(_props: ModuleProps) {
  const { query, go } = useTab();
  const qc = useQueryClient();
  const uid = useStore(app, (s) => s.auth?.user?.id ?? '');
  const asked = query.get('tab') as FinanceView | null;
  const view: FinanceView = asked && VIEWS.includes(asked) ? asked : 'dashboard';
  const companiesQ = useQuery({ queryKey: K.companies(uid), queryFn: ({ signal }) => fetchCompanies(signal), retry: false, staleTime: 60_000 });
  const companies = companiesQ.data ?? [];
  const company = resolveCompany(companies, num(query.get('company')), remembered(uid));
  const dash = useQuery({
    queryKey: K.dashboard(company?.id ?? 0),
    queryFn: ({ signal }) => fetchDashboard(company!.id, signal),
    enabled: !!company?.has_books,
    refetchInterval: 120_000,
  });
  useTabTitle(`Finance · ${TITLES[view]}`);

  const route = (v: FinanceView, c: number | null = company?.id ?? null, extra = '') => `/finance?tab=${v}${c ? `&company=${c}` : ''}${extra}`;
  const pick = (v: FinanceView, extra = '') => go(route(v, company?.id ?? null, extra));
  const choose = (id: number) => {
    remember(uid, id);
    go(route(view, id));
  };

  if (companiesQ.isLoading) return <Spinner />;
  if (companiesQ.error) {
    return <LoadFailed what="Your companies in Finance" onRetry={() => void companiesQ.refetch()} />;
  }

  const d = dash.data;
  const badges = { journals: d?.unposted ?? 0, unposted: d?.may_read_figures === false ? 0 : (d?.unposted_documents ?? 0) };

  let body;
  if (view === 'myaccess') body = <MyAccess />;
  else if (!companies.length) {
    body = <p className="m-6 text-[13px] text-ink-2">No company has made you a member at a level that reaches its books, so there are none for you to open. My access says why.</p>;
  } else if (!company) {
    body = <p className="m-6 text-[13px] text-ink-2">Choose a company.</p>;
  } else if (view === 'consolidated') {
    // Every company the person reaches, not this one's books.
    body = <Consolidated key={company.id} company={company} onGo={pick} />;
  } else if (view === 'fx') {
    // Rates belong to the installation, not to one company's books.
    body = <Rates key={company.id} company={company} onGo={pick} />;
  } else if (view === 'settings') {
    // The accounting profile says for itself when the books are not open.
    body = <Settings key={company.id} company={company} onGo={pick} />;
  } else if (view === 'dashboard') {
    body = <Overview key={company.id} company={company} data={dash} onGo={pick} onOpened={() => void qc.invalidateQueries({ queryKey: K.companies(uid) })} />;
  } else if (!company.has_books) {
    body = (
      <div className="m-6 flex max-w-[560px] flex-col items-start gap-2.5 rounded-[12px] border border-line bg-surface px-5 py-4">
        <b className="text-[15px] text-ink">{company.name} has no books yet</b>
        <span className="text-[13px] text-ink-2">Open them from the Overview first. Until then there is no chart, no journal and no period to show.</span>
        <button type="button" className={btnPrimary} onClick={() => go(route('dashboard'))}>
          Go to the Overview
        </button>
      </div>
    );
  } else if (view === 'accounts') body = <Accounts key={company.id} company={company} />;
  else if (view === 'journals') {
    body = (
      <Journals
        key={company.id}
        company={company}
        openId={num(query.get('open'))}
        making={query.get('make') === 'journal'}
        onOpen={(id) => go(route('journals', company.id, id ? `&open=${id}` : ''))}
        onMake={(on) => go(route('journals', company.id, on ? '&make=journal' : ''))}
      />
    );
  } else if (view === 'periods') body = <Periods key={company.id} company={company} />;
  else if (view === 'receivables' || view === 'payables') body = <Ageing key={company.id} company={company} onGo={pick} side={view} />;
  else if (view === 'unposted') body = <Unposted key={company.id} company={company} onGo={pick} />;
  else if (view === 'banks') body = <Banks key={company.id} company={company} onGo={pick} />;
  else if (view === 'reconcile') body = <Reconcile key={company.id} company={company} onGo={pick} />;
  // Keyed by company only: the ledger writes its account and dates to the address as they change.
  else if (view === 'ledger') body = <Ledger key={company.id} company={company} onGo={pick} />;
  else if (view === 'trial') body = <Trial key={company.id} company={company} onGo={pick} />;
  else if (view === 'pl') body = <ProfitAndLoss key={company.id} company={company} onGo={pick} />;
  else if (view === 'bs') body = <BalanceSheet key={company.id} company={company} onGo={pick} />;
  else if (view === 'cf') body = <CashFlow key={company.id} company={company} onGo={pick} />;
  else if (view === 'budgets') body = <Budgets key={company.id} company={company} onGo={pick} />;
  else if (view === 'yearend') body = <YearEnd key={company.id} company={company} onGo={pick} />;
  else if (view === 'shares') body = <Shares key={company.id} company={company} onGo={pick} />;
  else if (view === 'tax') body = <TaxCodes key={company.id} company={company} onGo={pick} />;
  else if (view === 'assetaccounts') body = <AssetAccounts key={company.id} company={company} onGo={pick} />;
  else if (view === 'depreciation') body = <Depreciation key={company.id} company={company} onGo={pick} />;
  else if (view === 'purchaseaccounts') body = <PurchaseAccounts key={company.id} company={company} onGo={pick} />;
  else if (view === 'overview') body = <FinancialOverview key={company.id} company={company} onGo={pick} />;
  else if (view === 'cashoverview') body = <CashOverview key={company.id} company={company} onGo={pick} />;
  else if (view === 'variance') body = <Variance key={company.id} company={company} onGo={pick} />;

  return (
    <div className="flex h-full min-h-0">
      <FinanceRail view={view} onPick={pick} company={company} companies={companies} onCompany={choose} badges={badges} />
      <main className="min-w-0 flex-1 overflow-y-auto bg-ground scroll-thin" aria-label={`Finance · ${TITLES[view]}`}>
        <Suspense fallback={<Spinner />}>{body}</Suspense>
      </main>
    </div>
  );
}

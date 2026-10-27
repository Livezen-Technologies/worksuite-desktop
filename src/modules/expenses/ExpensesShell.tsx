import { useQuery, useQueryClient } from '@tanstack/react-query';
import { lazy, Suspense, useState } from 'react';
import { app } from '../../core/app-state';
import { useStore } from '../../core/store';
import { useTab, useTabTitle } from '../../core/tab-context';
import { toast } from '../../core/toasts';
import { Spinner } from '../../components/ui';
import { btn, Sheet } from '../../components/PageKit';
import { LoadFailed } from '../../components/RecordKit';
import { refusal } from '../finance/api';
import type { ModuleProps } from '../registry';
import { can, canAct, count, fetchAreas, fetchDashboard, fetchOrgs, fetchQueueTotal, K, resolveSelection, selectionParam, toggleFavourite, type Org } from './api';
import { Note, OneCompany, QuickBar } from './parts';
import type { ClaimPreset } from './suppliers';
import { ExpensesRail, GATED, ONE_COMPANY, TITLES, VIEWS, type ExpenseView } from './Rail';
import { SidePanel } from '../../components/SidePanel';
import { encodeSelection, recallOrgSelection, rememberOrgSelection } from '../../core/org-prefs';
import { useOfflineReadOnly } from '../../core/offline-read';
import { OfflineReadOnlyBanner } from '../../components/OfflineReadOnly';

/**
 * Expenses: the rail, the quick bar, and the screen they point at. Addressed
 * as `/expenses?tab=<view>&org=<ids|all>` with the web's view names;
 * `&claim=<id>` opens a claim (as notifications link it, `/expenses?claim=12`),
 * `&advance=` goes to advances, `&sub=<id>` opens a subscription, and
 * `&file=1` starts filing an expense.
 *
 * THE SELECTION IS PART OF WHERE YOU ARE. It rides in the tab's address and is
 * remembered per person, and every id in it is checked against the companies
 * the server lists now — access ends on the next request, not whenever a tab
 * happens to reload.
 */
const Dashboard = lazy(() => import('./Dashboard'));
const Claims = lazy(() => import('./Claims'));
const NewClaim = lazy(() => import('./NewClaim'));
const Approvals = lazy(() => import('./Approvals'));
const Advances = lazy(() => import('./Advances'));
const Petty = lazy(() => import('./Petty'));
const Cards = lazy(() => import('./Cards'));
const Reimburse = lazy(() => import('./Reimburse'));
const Budgets = lazy(() => import('./Budgets'));
const Policies = lazy(() => import('./Policies'));
const Vendors = lazy(() => import('./Vendors'));
const Subscriptions = lazy(() => import('./Subscriptions'));
const Analytics = lazy(() => import('./Analytics'));
const Consolidated = lazy(() => import('./Consolidated'));
const Settings = lazy(() => import('./Settings'));
const Organizations = lazy(() => import('./Organizations').then((m) => ({ default: m.Organizations })));

const num = (v: string | null | undefined) => (v && /^\d+$/.test(v) ? Number(v) : null);
const memoryKey = (uid: string) => `expenses.org.v1.${uid}`;

function remembered(uid: string): string | null {
  try {
    return localStorage.getItem(memoryKey(uid));
  } catch {
    return null;
  }
}

function remember(uid: string, value: string) {
  try {
    localStorage.setItem(memoryKey(uid), value);
  } catch {
    /* a preference lost, not a failure */
  }
}

/** Which screen an address means: its tab, or where a notification's link points. */
export function viewFrom(q: URLSearchParams): ExpenseView {
  // `view=` is the server's own spelling in some notifications ("awaiting payment" → `?view=reimburse`).
  const t = (q.get('tab') ?? q.get('view')) as ExpenseView | null;
  if (t && VIEWS.includes(t)) return t;
  if (num(q.get('claim'))) return 'mine';
  if (num(q.get('advance'))) return 'advances';
  if (num(q.get('sub'))) return 'subs';
  return 'dashboard';
}

export default function ExpensesShell(_props: ModuleProps) {
  const { query, go } = useTab();
  // Offline (D-G14): read-only from this computer's copy; filing an expense waits for the connection.
  const { readOnly } = useOfflineReadOnly('expenses');
  const qc = useQueryClient();
  const uid = useStore(app, (s) => s.auth?.user?.id ?? '');
  const perms = useStore(app, (s) => s.bootstrap?.permissions);
  const view = viewFrom(query);
  const orgsQ = useQuery({ queryKey: K.orgs(uid), queryFn: ({ signal }) => fetchOrgs(signal), retry: false, staleTime: 60_000 });
  const orgs = orgsQ.data?.items ?? [];
  // Remembered: the organisation filter's memory (#214, shared with the other apps when the person chose so), else Expenses' own.
  const shared = recallOrgSelection('expenses');
  const selected = resolveSelection(orgs, query.get('org'), shared === null ? remembered(uid) : encodeSelection(shared), orgsQ.data?.current ?? null);
  const org = selectionParam(selected);
  // One company to write in: the one selected, or the only one there is.
  const orgId = selected.length === 1 ? selected[0]! : orgs.length === 1 ? orgs[0]!.id : null;
  // "Every company" is asked of the area map as all of them: asking for none is refused.
  const scopeIds = selected.length ? selected : orgs.map((o) => o.id);
  const areas = useQuery({ queryKey: K.areas(selectionParam(scopeIds)), queryFn: ({ signal }) => fetchAreas(scopeIds, signal), enabled: scopeIds.length > 0, staleTime: 60_000 });
  const dash = useQuery({ queryKey: K.dashboard(org), queryFn: ({ signal }) => fetchDashboard(org, signal), enabled: orgs.length > 0, refetchInterval: 120_000 });
  const queue = useQuery({ queryKey: [...K.queue, 'total'], queryFn: ({ signal }) => fetchQueueTotal(signal), enabled: orgs.length > 0, refetchInterval: 120_000 });
  const [picking, setPicking] = useState(false);
  const [filingOrg, setFilingOrg] = useState<number | null>(null);
  // Filing from a subscription: the form opens linked to it, in its company.
  const [fromSub, setFromSub] = useState<{ preset: ClaimPreset; orgId: number } | null>(null);
  useTabTitle(`Expenses · ${TITLES[view]}`);

  const orgPart = (ids: number[]) => `&org=${ids.length ? selectionParam(ids) : 'all'}`;
  const route = (v: ExpenseView, ids: number[] = selected, extra = '') => `/expenses?tab=${v}${orgPart(ids)}${extra}`;
  const onGo = (v: ExpenseView, extra = '') => go(route(v, selected, extra));
  const onSelect = (ids: number[]) => {
    remember(uid, ids.length ? selectionParam(ids) : 'all');
    rememberOrgSelection('expenses', ids.map(String));
    go(route(view, ids));
  };
  const favourite = async (id: number) => {
    try {
      await toggleFavourite(id);
      void qc.invalidateQueries({ queryKey: K.orgs(uid) });
    } catch (e) {
      toast('error', refusal(e));
    }
  };

  if (orgsQ.isLoading || (scopeIds.length > 0 && areas.isLoading)) return <Spinner />;
  if (orgsQ.error) return <LoadFailed what="Your companies in Expenses" onRetry={() => void orgsQ.refetch()} />;

  if (!orgs.length) {
    return (
      <div className="mx-auto flex max-w-[640px] flex-col gap-3.5 px-6 py-9">
        <div className="rounded-[14px] border border-line bg-surface px-6 py-5 text-center">
          <b className="text-[16px] text-ink">No organization yet</b>
          <p className="mt-1.5 mb-0 text-[13px] text-ink-2">{orgsQ.data?.empty_reason ?? 'You are not a member of any organization.'}</p>
        </div>
        {can(perms, 'expense.admin') ? (
          <Suspense fallback={<Spinner />}>
            <Organizations onCreated={() => void qc.invalidateQueries({ queryKey: K.orgs(uid) })} />
          </Suspense>
        ) : null}
      </div>
    );
  }

  const allowed = areas.data ?? {};
  const shows = (v: ExpenseView) => {
    const key = GATED[v];
    return key ? allowed[key] === true : true;
  };
  const inScope = orgs.filter((o) => !selected.length || selected.includes(o.id));
  const actable = inScope.filter(canAct);
  const filing = !readOnly && (query.get('file') === '1' || filingOrg !== null || fromSub !== null);
  const fileIn = fromSub?.orgId ?? filingOrg ?? (orgId !== null && actable.some((o) => o.id === orgId) ? orgId : null);
  const startFiling = () => {
    if (orgId !== null && actable.some((o) => o.id === orgId)) go(route(view, selected, '&file=1'));
    else setPicking(true);
  };
  const stopFiling = () => {
    setFilingOrg(null);
    setFromSub(null);
    if (query.get('file') === '1') go(route(view));
  };

  const d = dash.data;
  const counts = {
    approvals: queue.data ?? 0,
    unmatchedCards: count(d?.cards_unmatched?.count),
    owedToYou: count(d?.my_unpaid?.count),
    advances: count(d?.advances?.count),
    renewing: count(d?.subscriptions_due),
  };
  const props = { org, orgId, orgs, onGo };
  const narrow = () => onSelect([selected[0] ?? orgs[0]!.id]);

  let body;
  if (!shows(view)) body = <Note>{TITLES[view]} is not part of what you can do in {selected.length === 1 ? 'this company' : 'these companies'}. Settings › My access says why.</Note>;
  else if (ONE_COMPANY.has(view) && orgId === null) body = <OneCompany label={TITLES[view]} count={selected.length} onNarrow={narrow} />;
  else if (view === 'dashboard') body = <Dashboard {...props} />;
  else if (view === 'mine' || view === 'team' || view === 'organization') body = <Claims key={view} {...props} scope={view} openClaim={num(query.get('claim'))} />;
  else if (view === 'approvals') body = <Approvals {...props} />;
  else if (view === 'advances') body = <Advances key={orgId} {...props} openAdvance={num(query.get('advance'))} />;
  else if (view === 'petty') body = <Petty key={orgId} {...props} />;
  else if (view === 'cards') body = <Cards key={orgId} {...props} />;
  else if (view === 'reimburse' || view === 'postings') body = <Reimburse key={`${view}:${orgId}`} {...props} mode={view === 'reimburse' ? 'runs' : 'postings'} />;
  else if (view === 'budgets') body = <Budgets key={orgId} {...props} />;
  else if (view === 'policies') body = <Policies key={orgId} {...props} />;
  else if (view === 'vendors') body = <Vendors key={orgId} {...props} />;
  else if (view === 'subs') body = <Subscriptions {...props} openSub={num(query.get('sub'))} onFile={(preset, id) => setFromSub({ preset, orgId: id })} />;
  else if (view === 'analytics' || view === 'reports') body = <Analytics key={`${view}:${orgId}`} {...props} startOnReports={view === 'reports'} />;
  else if (view === 'consolidated') body = <Consolidated {...props} />;
  else body = <Settings key={orgId} {...props} />;

  return (
    <div className="flex h-full min-h-0">
      <SidePanel id="expenses" label="the Expenses menu">
        <ExpensesRail
          view={view}
          onPick={(v) => onGo(v)}
          onFile={actable.length ? startFiling : null}
          shows={shows}
          badges={{ approvals: counts.approvals, cards: counts.unmatchedCards }}
          orgs={orgs}
          selected={selected}
          onSelect={onSelect}
          onFavourite={(id) => void favourite(id)}
        />
      </SidePanel>
      <main className="min-w-0 flex-1 overflow-y-auto bg-ground scroll-thin" aria-label={`Expenses · ${TITLES[view]}`}>
        <OfflineReadOnlyBanner module="expenses" className="sticky top-0 z-10" />
        {d ? <QuickBar counts={counts} onGo={(v) => onGo(v)} canApprove={shows('team')} canFinance={shows('reimburse')} /> : null}
        <Suspense fallback={<Spinner />}>{body}</Suspense>
        <Suspense fallback={null}>
          {filing && fileIn !== null ? (
            <NewClaim
              orgId={fileIn}
              orgs={orgs}
              preset={fromSub ? { ...fromSub.preset } : undefined}
              fixed={fromSub ? ['subscription_id'] : undefined}
              relatedLabel={fromSub ? `the subscription ${fromSub.preset.description}` : undefined}
              onClose={stopFiling}
              onDone={(id) => {
                const stay = fromSub !== null;
                stopFiling();
                void qc.invalidateQueries({ queryKey: K.all });
                // Filed from a subscription, it stays there: the drawer's Expenses tab now lists it.
                if (id && !stay) onGo('mine', `&claim=${id}`);
              }}
            />
          ) : null}
        </Suspense>
      </main>
      {picking || (filing && fileIn === null) ? (
        <PickCompany
          orgs={actable}
          onPick={(id) => {
            setPicking(false);
            setFilingOrg(id);
          }}
          onClose={() => {
            setPicking(false);
            stopFiling();
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * Filing happens in one company. With several selected there is no defensible
 * guess, so it is asked — and only companies the person may act in are
 * offered: a consolidated reader can see a company's figures and cannot book
 * against it.
 */
function PickCompany({ orgs, onPick, onClose }: { orgs: Org[]; onPick: (id: number) => void; onClose: () => void }) {
  return (
    <Sheet
      title="Which company is this expense for?"
      onClose={onClose}
      width={440}
      footer={
        <button type="button" className={btn} onClick={onClose}>
          Cancel
        </button>
      }
    >
      <p className="m-0 text-[13px] text-ink-2">You have several selected, and a claim is booked against one set of books.</p>
      {orgs.length ? (
        <div className="flex flex-col overflow-hidden rounded-[10px] border border-line">
          {orgs.map((o) => (
            <button key={o.id} type="button" onClick={() => onPick(o.id)} className="flex items-center gap-2 border-b border-line/60 px-3 py-2.5 text-left last:border-b-0 hover:bg-subtle">
              <span className="flex min-w-0 flex-1 flex-col">
                <b className="truncate text-[13px] text-ink">{o.name}</b>
                <span className="text-[11.5px] text-ink-3">
                  {o.currency}
                  {o.role ? ` · ${o.role}` : ''}
                </span>
              </span>
            </button>
          ))}
        </div>
      ) : (
        <p className="m-0 text-[13px] text-ink-2">You can read these companies but are not a member of any of them, so there is nowhere to file this. Ask an administrator to add you to one.</p>
      )}
    </Sheet>
  );
}

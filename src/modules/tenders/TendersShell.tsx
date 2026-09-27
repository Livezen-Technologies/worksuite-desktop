import { useQuery } from '@tanstack/react-query';
import { lazy, Suspense, useState } from 'react';
import { app } from '../../core/app-state';
import { useStore } from '../../core/store';
import { useTab, useTabTitle } from '../../core/tab-context';
import { Spinner } from '../../components/ui';
import type { ModuleProps } from '../registry';
import { can, fetchDashboard, K, useCompanies, type ListView } from './api';
import { NATIVE, TenderRail, type TenderView } from './Rail';

/**
 * Tenders: the rail, and the screen it points at. Addressed as
 * `/tenders?tab=dash|board|all|new|following|preparing|submitted|evaluation|won|lost|lib|rep|set|acc`
 * (`&ss=scoring|sources|general` for a part of the settings):
 * - a tender as `?open=<id>` (what the server's notifications, search and the
 *   Social stream carry), its workspace in place of the list, `&wt=` for a tab
 *   of it (`overview|checklist|documents|bonds|meetings|budget|approvals|notice|decision|history|activity`);
 * - `&make=new` starts a tender, `&edit=<id>` edits one.
 * Nothing in Tenders opens in the browser any more.
 */
const Dashboard = lazy(() => import('./Dashboard'));
const List = lazy(() => import('./List'));
const Board = lazy(() => import('./Board'));
const Workspace = lazy(() => import('./Workspace'));
const TenderSheet = lazy(() => import('./TenderSheet'));
const MyAccess = lazy(() => import('./MyAccess'));
const Library = lazy(() => import('./Library'));
const Reports = lazy(() => import('./Reports'));
const Settings = lazy(() => import('./Settings'));

const TITLES: Record<TenderView, string> = {
  dash: 'Dashboard',
  board: 'Pipeline',
  all: 'All tenders',
  new: 'New opportunities',
  following: 'Following',
  preparing: 'Preparing',
  submitted: 'Submitted',
  evaluation: 'Evaluation',
  won: 'Won',
  lost: 'Lost',
  lib: 'Document library',
  rep: 'Reports',
  set: 'Settings',
  acc: 'My access',
};
const ORG_KEY = 'tenders.org';
const num = (v: string | null | undefined) => (v && /^\d+$/.test(v) ? Number(v) : null);

function savedOrg(): string {
  try {
    return localStorage.getItem(ORG_KEY) ?? '';
  } catch {
    return '';
  }
}

export default function TendersShell(_props: ModuleProps) {
  const { query, path, go } = useTab();
  const perms = useStore(app, (s) => s.bootstrap?.permissions);
  const canManage = can(perms, 'tender.manage');
  const canSettings = can(perms, 'tender.settings');
  const canApprove = can(perms, 'tender.approve');
  const [org, setOrg] = useState(savedOrg);
  // `/tenders/<id>` as well as `?open=<id>`, for links written either way.
  const fromPath = num(path[path.length - 1]);
  const open = num(query.get('open')) ?? fromPath;
  const editing = canManage ? num(query.get('edit')) : null;
  // Starting a tender is for those who may; a quick action or a link does not get round that.
  const creating = query.get('make') === 'new' && canManage;
  const asked = (query.get('tab') ?? '') as TenderView;
  const view: TenderView = asked && NATIVE.has(asked) ? asked : 'dash';
  const companies = useCompanies();
  const list = companies.data ?? [];
  // A company that is no longer held (or never was) reads as every company.
  const scope = org && list.length && !list.some((c) => String(c.id) === org) ? '' : org;
  const dash = useQuery({ queryKey: K.dashboard(scope), queryFn: ({ signal }) => fetchDashboard(scope, signal), refetchInterval: 120_000 });
  const c = dash.data?.counts ?? {};
  // The Preparing list holds Ready to submit as well, so its badge does too.
  const counts = { ...c, preparing: (c.preparing ?? 0) + (c.ready ?? 0) };
  useTabTitle(open ? 'Tenders · Tender' : `Tenders · ${TITLES[view]}`);

  const chooseOrg = (v: string) => {
    setOrg(v);
    try {
      localStorage.setItem(ORG_KEY, v);
    } catch {
      /* a convenience */
    }
  };
  // Where this screen is, without the one-off asks, to come back to.
  const base = (() => {
    const q = new URLSearchParams(query);
    for (const k of ['open', 'wt', 'make', 'edit']) q.delete(k);
    q.set('tab', view);
    return `/tenders?${q.toString()}`;
  })();
  const openTender = (id: number | null, wt?: string) => go(id ? `${base}&open=${id}${wt && wt !== 'overview' ? `&wt=${wt}` : ''}` : base);

  return (
    <div className="flex h-full min-h-0">
      <TenderRail
        view={open ? null : view}
        onPick={(v) => go(`/tenders?tab=${v}`)}
        onNew={canManage ? () => go(`${base}&make=new`) : null}
        counts={counts}
        expired={dash.data?.documents.expired ?? 0}
        org={scope}
        companies={list}
        onOrg={chooseOrg}
        canSettings={canSettings}
      />
      <main className="min-w-0 flex-1 overflow-y-auto bg-ground scroll-thin" aria-label={open ? 'Tenders · Tender' : `Tenders · ${TITLES[view]}`}>
        <Suspense fallback={<Spinner />}>
          {open ? (
            <Workspace
              key={open}
              id={open}
              bands={dash.data?.bands}
              canManage={canManage}
              canApprove={canApprove}
              tab={query.get('wt') ?? 'overview'}
              onTab={(t) => openTender(open, t)}
              onBack={() => openTender(null)}
              onEdit={() => go(`${base}&open=${open}&edit=${open}`)}
            />
          ) : view === 'dash' ? (
            <Dashboard data={dash} org={scope} onOpen={(id) => openTender(id)} onGo={(v) => go(`/tenders?tab=${v}`)} />
          ) : view === 'board' ? (
            <Board org={scope} bands={dash.data?.bands} onOpen={(id) => openTender(id)} onList={(v) => go(`/tenders?tab=${v}`)} />
          ) : view === 'acc' ? (
            <MyAccess companies={list} />
          ) : view === 'lib' ? (
            <Library org={scope} companies={list} canManage={canManage} />
          ) : view === 'rep' ? (
            <Reports org={scope} />
          ) : view === 'set' ? (
            canSettings ? (
              <Settings org={scope} companies={list} section={query.get('ss')} onSection={(x) => go(`/tenders?tab=set&ss=${x}`)} />
            ) : (
              <p className="m-6 text-[13px] text-ink-2">Settings are for those who may set Tenders up. My access says what you can do here.</p>
            )
          ) : (
            <List key={view} view={view as ListView} org={scope} stages={dash.data?.stages ?? []} bands={dash.data?.bands} canManage={canManage} onOpen={(id) => openTender(id)} />
          )}
        </Suspense>
        <Suspense fallback={null}>
          {creating || editing ? <TenderSheet key={editing ?? 'new'} id={editing} org={scope} companies={list} onClose={() => (editing ? openTender(editing, query.get('wt') ?? undefined) : go(base))} onSaved={(id) => openTender(id)} /> : null}
        </Suspense>
      </main>
    </div>
  );
}

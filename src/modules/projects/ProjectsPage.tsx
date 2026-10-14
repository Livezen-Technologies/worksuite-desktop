import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { isMac } from '../../core/bridge';
import { useStore } from '../../core/store';
import { app } from '../../core/app-state';
import { useTab, useTabTitle } from '../../core/tab-context';
import { todayInZone } from '../../core/time';
import { useNow } from '../../core/use-now';
import { Button, Empty } from '../../components/ui';
import { SidePanel } from '../../components/SidePanel';
import type { ModuleProps } from '../registry';
import { qk, read, type Project, type Task, type TaskStatus } from './api';
import { Board } from './Board';
import { keepOffline, noteRecent, useOfflineFlag, useOutbox, usePinsAndRecent } from './desk';
import { JumpTo, LogTime, NewTask } from './Dialogs';
import { MyWork } from './MyWork';
import { OfflineBanner, OutboxPanel } from './Outbox';
import { openWeb } from './parts';
import { Rail } from './Rail';
import { boardRoute, viewOf } from './routes';
import { TaskPanel } from './TaskPanel';
import { rememberTaskView, syncTaskView, useTaskView } from './view-prefs';
import { MiniTimer } from './Timer';
// ── PORTFOLIO ──
import { PortfolioDashboard } from './screens/Dashboard';
import { NewProjectDialog, startKey } from './screens/NewProject';
import { PortfolioScreen, isPortfolio, portfolioTitle } from './screens/Portfolio';
import { ProjectTabs } from './screens/ProjectPage';
import { usePermission } from './portfolio';
// ── DELIVERY ──
import { MilestonesScreen } from './screens/Milestones';
import { SprintsScreen } from './screens/Sprints';
import { TimeScreen } from './screens/Time';
import { TimelineScreen } from './screens/Timeline';
import { WorkloadScreen } from './screens/Workload';
// ── GOVERNANCE ──
import { BudgetScreen } from './screens/Budget';
import { ChangesScreen } from './screens/Changes';
import { governanceTitle } from './screens/gov-routes';
import { ReportsScreen } from './screens/Reports';
import { RisksScreen } from './screens/Risks';

/**
 * WorkSuite Projects in a tab (WS-PROJECT-SRS-001 PRJ-DSK-01, D01–D04): the project switcher and the web's views on
 * the left; in the middle the whole module — the Dashboard, All projects, Templates, Clients, the Activity log and
 * Module settings, a project's page with its tabs (overview, board, timeline, sprints, milestones, team, budget, risks,
 * changes, files, activity, settings), My work, Timeline & Gantt, Milestones, Sprints, Time & approvals, Team
 * workload, Budget & cost, Risks, Change requests and Reports; a task open on the right; the New project dialog over
 * any of them — and, offline, the banner, the outbox and the choices a reconnect may need. A project's Time tab is
 * the one page still on the web. `/projects/timer` is the mini timer window (D02).
 */
export default function ProjectsPage(_props: ModuleProps) {
  const { path, query } = useTab();
  const { view } = viewOf(path, query);
  if (view.kind === 'timer') return <MiniTimer />;
  return <Workspace />;
}

/** The view kinds a project's tab strip names (ProjectPage's TABS) when they are opened for one project. */
const OWN_TABS = new Set<string>(['timeline', 'milestones', 'sprints', 'budget', 'risks', 'changes']);
const num = (v: string | undefined): number | null => (v && /^\d{1,12}$/.test(v) ? Number(v) : null);

function Workspace() {
  const { path, query, go, active } = useTab();
  const { view, taskId } = viewOf(path, query);
  const qc = useQueryClient();
  const me = Number(useStore(app, (s) => s.auth?.user?.id) ?? 0);
  useNow(60_000);
  const today = todayInZone();
  const list = useQuery({ queryKey: qk.list, queryFn: ({ signal }) => read.list({ signal }), staleTime: 60_000 });
  const counts = useQuery({ queryKey: qk.counts, queryFn: ({ signal }) => read.counts({ signal }), refetchInterval: 60_000 });
  const { pins, recent } = usePinsAndRecent();
  const outbox = useOutbox();
  const [cached, setCached] = useState(false);
  const offline = useOfflineFlag(cached, !!list.data?.offline);
  const [selected, setSelected] = useState<number | null>(taskId);
  const [jump, setJump] = useState(false);
  const [logFor, setLogFor] = useState<{ task: Task | null } | null>(null);
  const [newIn, setNewIn] = useState<TaskStatus | null>(null);
  const projects = useMemo(() => new Map<number, Project>((list.data?.data.projects ?? []).map((p) => [p.id, p])), [list.data]);
  // `/projects/board` (the web's Board) shows the board of the project last worked in: the most recent, else a pinned one.
  const boardProject = view.kind === 'board' ? view.projectId : view.kind === 'board-home' ? (recent[0] ?? pins[0] ?? null) : null;
  const current = boardProject ? (projects.get(boardProject) ?? null) : null;
  // Board or list (PRJ-LST-01/02): the address's, else the one last used for this project.
  const taskView = useTaskView(boardProject ?? 0);
  const display = view.kind === 'board' && view.display ? view.display : taskView.view;
  useEffect(() => {
    if (boardProject && !offline) void syncTaskView(boardProject);
  }, [boardProject, offline]);

  // The project this view is about (its page, board or one of its own screens): noted as recent, named in the title.
  const pageProject = view.kind === 'project' ? view.projectId : boardProject ?? ('projectId' in view ? (view.projectId ?? null) : null);
  const pageCode = pageProject ? (projects.get(pageProject)?.code ?? null) : null;
  // Delivery's titles: "PRJ-0018 · Timeline", or "Projects · Timeline" module-wide.
  const deliveryTitle = view.kind === 'timeline' ? 'Timeline' : view.kind === 'milestones' ? 'Milestones' : view.kind === 'sprints' ? 'Sprints' : view.kind === 'workload' ? 'Team workload' : null;
  useTabTitle(
    portfolioTitle(view, projects) ??
      governanceTitle(view, pageCode) ??
      (deliveryTitle ? `${('projectId' in view && view.projectId ? pageCode : null) ?? 'Projects'} · ${deliveryTitle}` : boardProject || view.kind === 'board-home' ? (current ? `${current.code} · ${display === 'list' ? 'List' : 'Board'}` : `Projects · ${display === 'list' ? 'List' : 'Board'}`) : view.kind === 'my-work' ? 'Projects · My work' : view.kind === 'time' ? 'Projects · Time' : 'Projects'),
  );
  const may = usePermission();
  // A project's own screens sit under its tab strip (W04), as on the web: its board, and the delivery and governance
  // screens opened for it (`/projects/<id>/timeline`…); a tab still on the web keeps the strip too.
  const projectInPath = num(path[1]);
  const ownTab: { projectId: number; tab: string } | null = boardProject
    ? { projectId: boardProject, tab: 'board' }
    : projectInPath && (OWN_TABS.has(view.kind) || (view.kind === 'web' && path[2]))
      ? { projectId: projectInPath, tab: view.kind === 'web' ? (path[2] ?? '') : view.kind }
      : null;

  useEffect(() => {
    if (pageProject) noteRecent(pageProject);
  }, [pageProject]);
  // A task opened from a link is the board's selection too.
  const [openedTask, setOpenedTask] = useState(taskId);
  if (openedTask !== taskId) {
    setOpenedTask(taskId);
    if (taskId) setSelected(taskId);
  }
  // What the app opens with offline, read while WorkSuite answers (PRJ-DSK-04).
  useEffect(() => {
    if (!offline) void keepOffline();
  }, [offline, pins.length]);
  // `?new=blank`, `?new={template key}` or `?new={template id}` (the web's New project): the dialog, over whatever view is open.
  const newParam = query.get('new');
  const setNew = (value: string | null) => {
    const p = new URLSearchParams(query);
    if (value) p.set('new', value);
    else p.delete('new');
    go(`/${path.join('/')}${p.toString() ? `?${p}` : ''}`);
  };

  // A state setter keeps its identity, so the screens' effects that report it do not re-run.
  const onOffline = setCached;
  const withTask = (id: number | null) => {
    const p = new URLSearchParams(query);
    if (id) p.set('task', String(id));
    else p.delete('task');
    const base = `/${path.join('/')}`.replace(/\/tasks\/\d+$/, '');
    return `${base}${p.toString() ? `?${p}` : ''}`;
  };
  const openTask = (id: number, projectId?: number | null) => {
    if (boardProject) go(boardRoute(boardProject, id, display));
    else if (projectId && view.kind !== 'my-work') go(boardRoute(projectId, id));
    else go(withTask(id));
  };
  const closeTask = () => go(boardProject ? boardRoute(boardProject, null, display) : withTask(null));

  // ⌘P jumps to a project and Esc closes the open task, while this tab is in front.
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector('[role="dialog"]')) return;
      const mod = isMac ? e.metaKey : e.ctrlKey;
      if (mod && !e.shiftKey && !e.altKey && e.code === 'KeyP') {
        e.preventDefault();
        e.stopImmediatePropagation();
        setJump(true);
        return;
      }
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));
      if (e.key === 'Escape' && taskId && !typing) {
        e.preventDefault();
        closeTask();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  const showOutbox = offline || outbox.length > 0;
  const waiting = outbox.filter((i) => i.state !== 'refused').length;

  return (
    <div className="flex h-full bg-ground text-[13px]">
      <SidePanel id="projects" label="the Projects menu">
        <Rail view={view} counts={counts.data?.data ?? null} projects={projects} pins={pins} recent={recent} canCreate={!offline} mayCreate={may('project.manage')} maySettings={may('project.settings') || may('project.manage')} onGo={go} onJump={() => setJump(true)} onNew={() => setNew('blank')} />
      </SidePanel>
      <div className="flex min-w-0 flex-1 flex-col">
        {offline ? <OfflineBanner waiting={waiting} /> : null}
        <div className="flex min-h-0 flex-1">
          <main className="flex min-w-0 flex-1 flex-col bg-surface">
            {ownTab ? <ProjectTabs projectId={ownTab.projectId} tab={ownTab.tab} onGo={go} /> : null}
            {boardProject ? (
              <Board
                key={boardProject}
                projectId={boardProject}
                display={display}
                prefs={taskView}
                onDisplay={(d) => {
                  rememberTaskView(boardProject, { view: d });
                  // The task open stays open, the filter and selection stay with the board (acceptance #13).
                  go(boardRoute(boardProject, taskId, d));
                }}
                onPrefs={(patch) => void rememberTaskView(boardProject, patch)}
                selected={selected}
                today={today}
                me={me}
                active={active && !jump && !logFor && !newIn}
                pinned={pins.includes(boardProject)}
                offline={offline}
                outbox={outbox}
                onOpen={(id) => openTask(id)}
                onSelect={setSelected}
                onNewTask={(s) => setNewIn(s)}
                onLogTime={(t) => setLogFor({ task: t })}
                onOffline={onOffline}
              />
            ) : view.kind === 'board-home' ? (
              <Empty
                icon="kanban"
                title="Choose a project"
                hint="The board shows one project's tasks. Pick the project to open its board."
                action={
                  <Button variant="primary" icon="search" onClick={() => setJump(true)}>
                    Jump to project
                  </Button>
                }
              />
            ) : view.kind === 'my-work' ? (
              <MyWork me={me} today={today} offline={offline} outbox={outbox} onOpenTask={(t) => openTask(t.id, t.project_id)} onGo={go} onOffline={onOffline} />
            ) : view.kind === 'time' ? (
              <TimeScreen
                today={today}
                waiting={counts.data?.data.time_waiting ?? 0}
                offline={offline}
                tab={query.get('tab')}
                onTab={(t) => go(t === 'mine' ? '/projects/time' : `/projects/time?tab=${t}`)}
                onLogTime={() => setLogFor({ task: null })}
                onOffline={onOffline}
              />
            ) : view.kind === 'timeline' ? (
              <TimelineScreen key={view.projectId ?? 0} projectId={view.projectId} onGo={go} onOpenTask={(id) => go(withTask(id))} onOffline={onOffline} />
            ) : view.kind === 'milestones' ? (
              <MilestonesScreen key={view.projectId ?? 0} projectId={view.projectId} offline={offline} onOffline={onOffline} />
            ) : view.kind === 'sprints' ? (
              <SprintsScreen key={view.projectId ?? 0} projectId={view.projectId} sprintId={view.sprintId} offline={offline} onGo={go} onOpenTask={(id) => go(withTask(id))} onOffline={onOffline} />
            ) : view.kind === 'workload' ? (
              <WorkloadScreen onOffline={onOffline} />
            ) : view.kind === 'changes' ? (
              <ChangesScreen key={view.projectId ?? 'all'} id={view.id} projectId={view.projectId ?? null} offline={offline} onOffline={onOffline} onGo={go} />
            ) : view.kind === 'budget' ? (
              <BudgetScreen key={view.projectId ?? 'all'} projectId={view.projectId} offline={offline} onOffline={onOffline} onGo={go} />
            ) : view.kind === 'risks' ? (
              <RisksScreen key={view.projectId ?? 'all'} projectId={view.projectId} offline={offline} onOffline={onOffline} onGo={go} />
            ) : view.kind === 'reports' ? (
              <ReportsScreen kind={view.report} offline={offline} onOffline={onOffline} onGo={go} />
            ) : view.kind === 'dashboard' ? (
              <PortfolioDashboard offline={offline} mayCreate={may('project.manage')} onGo={go} onNew={() => setNew('blank')} onLogTime={() => setLogFor({ task: null })} onOffline={onOffline} />
            ) : isPortfolio(view) ? (
              <PortfolioScreen view={view} query={query} offline={offline} onGo={go} onNew={(t) => setNew(t ? String(t) : 'blank')} onOpenTask={(id) => openTask(id)} onOffline={onOffline} />
            ) : (
              <Empty
                icon="external"
                title="This page is on the web"
                hint="Everything else in Projects is here; this page — a project's Time tab, or an address this app does not know — opens in WorkSuite on the web."
                action={
                  <Button variant="primary" icon="external" onClick={() => openWeb(view.kind === 'web' ? view.path : '/projects')}>
                    Open in the browser
                  </Button>
                }
              />
            )}
          </main>
          {taskId ? <TaskPanel key={taskId} id={taskId} today={today} offline={offline} outbox={outbox} onClose={closeTask} onLogTime={(t) => setLogFor({ task: t })} onMoved={() => void counts.refetch()} /> : null}
          {showOutbox ? <OutboxPanel items={outbox} offline={offline} /> : null}
        </div>
      </div>
      {jump ? <JumpTo projects={[...projects.values()]} onClose={() => setJump(false)} onPick={(id) => (setJump(false), go(view.kind === 'board-home' ? `/projects/${id}/board` : `/projects/${id}`))} /> : null}
      {logFor ? <LogTime task={logFor.task} project={current ? { id: current.id, code: current.code } : boardProject ? { id: boardProject } : null} onClose={() => setLogFor(null)} /> : null}
      {newParam ? <NewProjectDialog start={startKey(newParam)} offline={offline} onClose={() => setNew(null)} onGo={go} /> : null}
      {newIn && boardProject ? <NewTask projectId={boardProject} status={newIn} me={me} onClose={() => setNewIn(null)} onCreated={(id) => (setNewIn(null), void qc.invalidateQueries({ queryKey: qk.tasks(boardProject) }), go(boardRoute(boardProject, id, display)))} /> : null}
    </div>
  );
}

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { MiniTimer } from './Timer';
import { DashboardView, TimeView } from './Views';
// ── governance (W12–W15) ──
import { BudgetScreen } from './screens/Budget';
import { ChangesScreen } from './screens/Changes';
import { governanceTitle } from './screens/gov-routes';
import { ReportsScreen } from './screens/Reports';
import { RisksScreen } from './screens/Risks';

/**
 * WorkSuite Projects in a tab (WS-PROJECT-SRS-001 PRJ-DSK-01, D01–D04): the project switcher and views on the left, a
 * board, My work, my time or change decisions in the middle, a task open on the right — and, offline, the banner,
 * the outbox and the choices a reconnect may need. `/projects/timer` is the mini timer window (D02).
 */
export default function ProjectsPage(_props: ModuleProps) {
  const { path, query } = useTab();
  const { view } = viewOf(path, query);
  if (view.kind === 'timer') return <MiniTimer />;
  return <Workspace />;
}

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
  const boardProject = view.kind === 'board' ? view.projectId : null;
  const current = boardProject ? (projects.get(boardProject) ?? null) : null;

  useTabTitle(governanceTitle(view) ?? (view.kind === 'board' ? (current ? `${current.code} · Board` : 'Projects · Board') : view.kind === 'my-work' ? 'Projects · My work' : view.kind === 'time' ? 'Projects · Time' : 'Projects'));

  useEffect(() => {
    if (boardProject) noteRecent(boardProject);
  }, [boardProject]);
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
  // `?new=1` (the web's New project): that dialog is the web's.
  useEffect(() => {
    if (query.get('new') !== '1') return;
    openWeb('/projects?new=1');
    const p = new URLSearchParams(query);
    p.delete('new');
    go(`/${path.join('/')}${p.toString() ? `?${p}` : ''}`);
  }, [query, path, go]);

  const onOffline = useCallback((o: boolean) => setCached(o), [setCached]);
  const withTask = (id: number | null) => {
    const p = new URLSearchParams(query);
    if (id) p.set('task', String(id));
    else p.delete('task');
    const base = `/${path.join('/')}`.replace(/\/tasks\/\d+$/, '');
    return `${base}${p.toString() ? `?${p}` : ''}`;
  };
  const openTask = (id: number, projectId?: number | null) => {
    if (boardProject) go(boardRoute(boardProject, id));
    else if (projectId && view.kind !== 'my-work') go(boardRoute(projectId, id));
    else go(withTask(id));
  };
  const closeTask = () => go(boardProject ? boardRoute(boardProject) : withTask(null));

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
        <Rail view={view} counts={counts.data?.data ?? null} projects={projects} pins={pins} recent={recent} canCreate={!offline} onGo={go} onJump={() => setJump(true)} onNew={() => openWeb('/projects?new=1')} />
      </SidePanel>
      <div className="flex min-w-0 flex-1 flex-col">
        {offline ? <OfflineBanner waiting={waiting} /> : null}
        <div className="flex min-h-0 flex-1">
          <main className="flex min-w-0 flex-1 flex-col bg-surface">
            {view.kind === 'board' ? (
              <Board
                key={view.projectId}
                projectId={view.projectId}
                selected={selected}
                today={today}
                me={me}
                active={active && !jump && !logFor && !newIn}
                pinned={pins.includes(view.projectId)}
                offline={offline}
                outbox={outbox}
                onOpen={(id) => openTask(id)}
                onSelect={setSelected}
                onNewTask={(s) => setNewIn(s)}
                onLogTime={(t) => setLogFor({ task: t })}
                onOffline={onOffline}
              />
            ) : view.kind === 'my-work' ? (
              <MyWork me={me} today={today} offline={offline} outbox={outbox} onOpenTask={(t) => openTask(t.id, t.project_id)} onGo={go} onOffline={onOffline} />
            ) : view.kind === 'time' ? (
              <TimeView today={today} waiting={counts.data?.data.time_waiting ?? 0} offline={offline} onLogTime={() => setLogFor({ task: null })} onOffline={onOffline} />
            ) : view.kind === 'changes' ? (
              <ChangesScreen key={view.projectId ?? 'all'} id={view.id} projectId={view.projectId ?? null} offline={offline} onOffline={onOffline} onGo={go} />
            ) : view.kind === 'budget' ? (
              <BudgetScreen key={view.projectId ?? 'all'} projectId={view.projectId} offline={offline} onOffline={onOffline} onGo={go} />
            ) : view.kind === 'risks' ? (
              <RisksScreen key={view.projectId ?? 'all'} projectId={view.projectId} offline={offline} onOffline={onOffline} onGo={go} />
            ) : view.kind === 'reports' ? (
              <ReportsScreen kind={view.report} offline={offline} onOffline={onOffline} onGo={go} />
            ) : view.kind === 'dashboard' ? (
              <DashboardView onGo={go} onOffline={onOffline} />
            ) : (
              <Empty
                icon="external"
                title="This page is on the web"
                hint="The desktop app has the board, My work, time and change decisions. This screen opens in WorkSuite on the web."
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
      {jump ? <JumpTo projects={[...projects.values()]} onClose={() => setJump(false)} onPick={(id) => (setJump(false), go(`/projects/${id}`))} /> : null}
      {logFor ? <LogTime task={logFor.task} project={current ? { id: current.id, code: current.code } : boardProject ? { id: boardProject } : null} onClose={() => setLogFor(null)} /> : null}
      {newIn && boardProject ? <NewTask projectId={boardProject} status={newIn} me={me} onClose={() => setNewIn(null)} onCreated={(id) => (setNewIn(null), void qc.invalidateQueries({ queryKey: qk.tasks(boardProject) }), go(boardRoute(boardProject, id)))} /> : null}
    </div>
  );
}

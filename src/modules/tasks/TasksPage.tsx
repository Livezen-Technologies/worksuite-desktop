import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { app } from '../../core/app-state';
import { apiGetMeta, apiPost } from '../../core/api';
import { errorMessage } from '../../core/bridge';
import { useStore } from '../../core/store';
import { useTab, useTabTitle } from '../../core/tab-context';
import { todayInZone } from '../../core/time';
import { toast } from '../../core/toasts';
import { ErrorNote, OfflineNote, Spinner, cx } from '../../components/ui';
import type { ModuleProps } from '../registry';
import { createTask, patchTask } from './actions';
import { ALL_TASKS } from './queries';
import { counts as countOf, inScope, isOpen, plainText, PRIORITIES, SCOPES, STATUSES, type Priority, type Scope, type Status, type Task, type TaskList } from './api';
import { BoardView } from './BoardView';
import { ListView } from './ListView';
import { NewTask } from './NewTask';
import { Rail } from './Rail';
import { TaskDetail } from './TaskDetail';
import { Select } from '../../components/Select';
import { SidePanel } from '../../components/SidePanel';

/** The old `?filter=` links (notifications, the dashboard) in the new scopes. */
const LEGACY: Record<string, Scope> = { mine: 'mine', today: 'today', overdue: 'overdue', upcoming: 'upcoming', active: 'all', completed: 'done', created: 'all', shared: 'shared' };
const field = 'h-[34px] rounded-[8px] border border-line bg-surface px-2 text-[13px] text-ink outline-none focus:border-primary';

/** The time, a minute at a time: what is overdue changes while the page is open. */
function useMinute(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

function scopeFrom(q: URLSearchParams): Scope {
  const list = q.get('list');
  if (list && /^\d+$/.test(list)) return `list:${Number(list)}`;
  const s = q.get('scope') ?? LEGACY[q.get('filter') ?? ''] ?? 'all';
  return (SCOPES.some((x) => x.id === s) ? s : 'all') as Scope;
}

/**
 * Tasks (TaskRail, TasksList, TasksBoard): your views and lists on the left,
 * a list grouped by when things are due or a board by status, and a task
 * opened over it. Completing and creating work offline (PARTIAL_WRITE).
 */
export default function TasksPage(_props: ModuleProps) {
  useTabTitle('Tasks');
  const qc = useQueryClient();
  const { query, path, go, active } = useTab();
  const me = Number(useStore(app, (s) => s.auth?.user?.id) ?? 0);
  const today = todayInZone();
  const now = useMinute();
  const scope = scopeFrom(query);
  const listScope = scope.startsWith('list:') ? Number(scope.slice(5)) : null;
  const view = (query.get('view') ?? (listScope ? 'board' : 'list')) === 'board' ? 'board' : 'list';
  const pathTask = path[0] === 'tasks' && /^\d+$/.test(path[1] ?? '') ? path[1] : null;
  const opened = Number(query.get('task') ?? pathTask ?? 0) || null;
  const [creating, setCreating] = useState(query.get('new') === '1');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'open' | 'all' | Status>('open');
  const [assignee, setAssignee] = useState<'any' | 'me' | string>('any');
  const [priority, setPriority] = useState<'any' | Priority>('any');

  const all = useQuery({ ...ALL_TASKS, refetchInterval: 20_000 });
  const shared = useQuery({ queryKey: ['tasks', 'shared'], queryFn: ({ signal }) => apiGetMeta<{ tasks: Task[] }>('/api/tasks', { filter: 'shared' }, signal), refetchInterval: 60_000 });
  const listsQ = useQuery({ queryKey: ['tasks', 'lists'], queryFn: ({ signal }) => apiGetMeta<{ lists: TaskList[] }>('/api/task-lists', undefined, signal) });
  const tasks = useMemo(() => all.data?.data.tasks ?? [], [all.data]);
  const sharedTasks = useMemo(() => shared.data?.data.tasks ?? [], [shared.data]);
  const lists = useMemo(() => listsQ.data?.data.lists ?? [], [listsQ.data]);
  const listMap = useMemo(() => new Map(lists.map((l) => [l.id, l])), [lists]);
  const offline = !!all.data?.offline;
  const counts = countOf(tasks, sharedTasks, lists, me, today, now);

  const set = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams(query);
    p.delete('filter');
    p.delete('new');
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) p.delete(k);
      else p.set(k, v);
    }
    go(`/tasks${p.toString() ? `?${p}` : ''}`);
  };
  const setScope = (s: Scope) => set(s.startsWith('list:') ? { list: s.slice(5), scope: null, view: null } : { scope: s === 'all' ? null : s, list: null, view: null });
  const open = (id: number | null) => set({ task: id ? String(id) : null });

  const needle = q.trim().toLowerCase();
  const shown = (scope === 'shared' ? sharedTasks : tasks).filter((t) => {
    if (!inScope(t, scope, me, today, now)) return false;
    if (needle && !`${t.title} ${plainText(t.description)} ${t.tags.join(' ')}`.toLowerCase().includes(needle)) return false;
    if (assignee === 'me' ? t.assignee_id !== me : assignee !== 'any' && String(t.assignee_id) !== assignee) return false;
    if (priority !== 'any' && t.priority !== priority) return false;
    if (view === 'list' && scope !== 'done') {
      if (status === 'open' && !isOpen(t)) return false;
      if (status !== 'open' && status !== 'all' && t.status !== status) return false;
    }
    return true;
  });
  const people = [...new Map((scope === 'shared' ? sharedTasks : tasks).filter((t) => t.assignee_id && t.assignee_id !== me).map((t) => [String(t.assignee_id), t.assignee_name ?? 'Someone'])).entries()];
  const title = listScope ? (listMap.get(listScope)?.name ?? 'List') : (SCOPES.find((s) => s.id === scope)?.label ?? 'Tasks');
  const openCount = shown.filter(isOpen).length;
  const refresh = () => void qc.invalidateQueries({ queryKey: ['tasks'] });

  const quickAdd = async (text: string, st?: Status) => {
    try {
      const r = await createTask({ title: text, ...(listScope ? { list_id: listScope } : {}), ...(st ? { status: st } : {}), ...(scope === 'today' ? { due_date: today } : {}) });
      if (r.queued) toast('info', 'Offline — the task is created when you reconnect.');
      refresh();
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  const change = async (t: Task, s: Status) => {
    try {
      await patchTask(t, 'status', s, `${STATUSES.find((x) => x.id === s)?.label}: “${t.title}”`);
      // Completing sets progress to 100 and reopening leaves it there; a reopened task is not finished.
      if (t.status === 'done' && s !== 'done' && !t.checklist_total && t.progress === 100) await patchTask(t, 'progress', 0, `Progress of “${t.title}”`);
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      refresh();
    }
  };
  const move = async (t: Task, s: Status) => {
    // Shown in its new column straight away; the server has the last word.
    qc.setQueryData<{ data: { tasks: Task[] } }>(['tasks', 'all'], (old) => (old ? { ...old, data: { tasks: old.data.tasks.map((x) => (x.id === t.id ? { ...x, status: s } : x)) } } : old));
    try {
      await apiPost(`/api/tasks/${t.id}/move`, { status: s });
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      refresh();
    }
  };

  // Keys while this tab is in front and nothing is being typed or asked: N new, B/L the view, / search.
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey || creating || opened || document.querySelector('[role="dialog"]')) return;
      if (t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return;
      if (e.key === 'n') setCreating(true);
      else if (e.key === 'b' || e.key === 'l') set({ view: e.key === 'b' ? 'board' : 'list' });
      else if (e.key === '/') document.querySelector<HTMLInputElement>('input[aria-label="Search tasks"]')?.focus();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div className="flex h-full bg-surface text-[13px]">
      <SidePanel id="tasks" label="the Tasks menu">
        <Rail scope={scope} counts={counts} lists={lists} onScope={setScope} onNew={() => setCreating(true)} />
      </SidePanel>
      <main className="flex min-w-0 flex-1 flex-col">
        <div className="flex shrink-0 flex-wrap items-center gap-2 px-5 pt-4 pb-2.5">
          <div className="flex min-w-0 flex-1 flex-col">
            <h1 className="truncate text-[20px] font-bold text-ink">{title}</h1>
            <span className="text-[12px] text-ink-3">
              {listScope ? `List · ${openCount} open` : scope === 'shared' ? 'Tasks you review, follow or were shared' : scope === 'done' ? `${shown.length} completed` : `${openCount} open`}
            </span>
          </div>
          {offline ? <OfflineNote cachedAt={all.data?.cachedAt ?? null} /> : null}
          <input value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search tasks" placeholder="Search tasks…" className={cx(field, 'w-[200px] px-2.5')} />
          {view === 'list' && scope !== 'done' ? (
            <Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className={field}>
              <option value="open">Status: open</option>
              <option value="all">Status: any</option>
              {STATUSES.map((s) => <option key={s.id} value={s.id}>Status: {s.label}</option>)}
            </Select>
          ) : null}
          <Select aria-label="Assignee" value={assignee} onChange={(e) => setAssignee(e.target.value)} className={field}>
            <option value="any">Assignee: anyone</option>
            <option value="me">Assignee: me</option>
            {people.map(([id, name]) => <option key={id} value={id}>Assignee: {name}</option>)}
          </Select>
          <Select aria-label="Priority" value={priority} onChange={(e) => setPriority(e.target.value as typeof priority)} className={field}>
            <option value="any">Priority: any</option>
            {PRIORITIES.map((p) => <option key={p.id} value={p.id}>Priority: {p.label}</option>)}
          </Select>
          <span role="tablist" aria-label="View" className="flex overflow-hidden rounded-[8px] border border-line font-semibold">
            {(['board', 'list'] as const).map((v) => (
              <button key={v} type="button" role="tab" aria-selected={view === v} title={`${v === 'board' ? 'Board' : 'List'} (${v[0]!.toUpperCase()})`} onClick={() => set({ view: v })} className={cx('px-3 py-[7px]', view === v ? 'bg-selection text-primary' : 'text-ink hover:bg-subtle')}>
                {v === 'board' ? 'Board' : 'List'}
              </button>
            ))}
          </span>
          {view === 'board' ? (
            <button type="button" onClick={() => setCreating(true)} className="flex h-[34px] items-center rounded-[8px] bg-primary px-3.5 font-bold text-white hover:bg-primary-hover">+ New task</button>
          ) : null}
        </div>
        {all.isLoading ? <Spinner /> : null}
        {all.error && !all.data ? <div className="p-5"><ErrorNote error={all.error} onRetry={() => void all.refetch()} /></div> : null}
        {!all.isLoading && (all.data || !all.error) ? (
          view === 'board' ? (
            <BoardView tasks={shown} me={me} today={today} now={now} selected={opened} canMove={scope !== 'shared' && !offline} onOpen={(t) => open(t.id)} onMove={(t, s) => void move(t, s)} onQuickAdd={(text, st) => quickAdd(text, st)} />
          ) : (
            <ListView
              tasks={shown}
              lists={listMap}
              me={me}
              today={today}
              now={now}
              completed={scope === 'done'}
              selected={opened}
              canChangeStatus={scope !== 'shared'}
              quickAdd={scope === 'shared' || scope === 'done' ? null : listScope ? (listMap.get(listScope)?.name ?? 'this list') : 'My tasks'}
              onOpen={(t) => open(t.id)}
              onToggle={(t) => void change(t, t.status === 'done' ? 'todo' : 'done')}
              onStatus={(t, s) => void change(t, s)}
              onQuickAdd={(text) => quickAdd(text)}
            />
          )
        ) : null}
      </main>
      {opened ? <TaskDetail key={opened} id={opened} lists={lists} onClose={() => open(null)} onOpen={(id) => open(id)} /> : null}
      {creating ? (
        <NewTask
          lists={lists}
          defaults={{ list_id: listScope, ...(scope === 'today' ? { due: today } : {}), ...(query.get('title') ? { title: query.get('title')!.slice(0, 200) } : {}) }}
          onClose={() => (setCreating(false), query.get('new') ? set({}) : undefined)}
          onCreated={(id) => {
            setCreating(false);
            toast('success', 'Task created.');
            refresh();
            if (id) open(id);
          }}
        />
      ) : null}
    </div>
  );
}

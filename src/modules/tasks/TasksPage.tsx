import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { app } from '../../core/app-state';
import { apiGet, apiGetMeta } from '../../core/api';
import { call, errorMessage } from '../../core/bridge';
import { useDraft } from '../../core/drafts';
import { useStore } from '../../core/store';
import { useTab, useTabTitle } from '../../core/tab-context';
import { dateLabel, relative, todayInZone } from '../../core/time';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Button, Chip, Empty, ErrorNote, IconButton, OfflineNote, Select, Spinner, cx } from '../../components/ui';
import { VirtualList } from '../../components/VirtualList';
import type { ModuleProps } from '../registry';

/** Tasks (PARTIAL_WRITE, §14): completing and creating tasks work offline, queued in order. */
export interface Task {
  id: number;
  task_key: string | null;
  list_id: number | null;
  org_id: number | null;
  org_name: string | null;
  assignee_name: string | null;
  title: string;
  description: string | null;
  status: 'backlog' | 'todo' | 'in_progress' | 'on_hold' | 'review' | 'changes_requested' | 'done' | 'cancelled';
  priority: 'urgent' | 'high' | 'medium' | 'low' | 'none';
  tags: string[];
  due_date: string | null;
  due_at: string | null;
  progress: number;
  updated_at: string | null;
  checklist_done?: number;
  checklist_total?: number;
}

const FILTERS = [
  { id: 'mine', label: 'My tasks' },
  { id: 'today', label: 'Today' },
  { id: 'overdue', label: 'Overdue' },
  { id: 'active', label: 'All open' },
  { id: 'completed', label: 'Completed' },
] as const;

const STATUS: Array<{ value: Task['status']; label: string }> = [
  { value: 'backlog', label: 'Backlog' },
  { value: 'todo', label: 'To do' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'on_hold', label: 'On hold' },
  { value: 'review', label: 'In review' },
  { value: 'done', label: 'Done' },
  { value: 'cancelled', label: 'Cancelled' },
];

const PRIORITY_TONE: Record<Task['priority'], 'danger' | 'warning' | 'indigo' | 'muted'> = { urgent: 'danger', high: 'warning', medium: 'indigo', low: 'muted', none: 'muted' };

function stripHtml(html: string | null): string {
  if (!html) return '';
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return (doc.body.textContent ?? '').trim();
}

export async function submitTaskChange(task: Pick<Task, 'id' | 'title'>, field: string, value: unknown, label: string) {
  const r = await call('offline:submit', {
    module: 'tasks',
    entity: 'task',
    entityId: String(task.id),
    label,
    method: 'PATCH',
    path: `/api/tasks/${task.id}`,
    body: { field, value },
    queueIfOffline: true,
  });
  if (!r.delivered && !r.queued) throw new Error(r.error ?? 'Could not update the task.');
  if (r.queued) toast('info', 'Offline — the change will sync when you reconnect.');
  return r;
}

export default function TasksPage(_props: ModuleProps) {
  useTabTitle('Tasks');
  const { query, go } = useTab();
  const orgId = useStore(app, (s) => s.organizationId);
  const filter = (query.get('filter') as (typeof FILTERS)[number]['id']) ?? 'mine';
  const selected = query.get('task');
  const [q, setQ] = useState('');
  const qc = useQueryClient();
  const today = todayInZone();

  const list = useQuery({
    queryKey: ['tasks', 'list', filter, q, orgId],
    queryFn: ({ signal }) => apiGetMeta<{ tasks: Task[] }>('/api/tasks', { filter, q: q || undefined, org: orgId }, signal),
  });
  const tasks = list.data?.data.tasks ?? [];

  const toggle = useMutation({
    mutationFn: (t: Task) => submitTaskChange(t, 'status', t.status === 'done' ? 'todo' : 'done', `${t.status === 'done' ? 'Reopen' : 'Complete'} “${t.title}”`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['tasks'] }),
    onError: (e) => toast('error', errorMessage(e)),
  });

  const setParam = (k: string, v: string | null) => {
    const p = new URLSearchParams(query);
    if (v === null) p.delete(k);
    else p.set(k, v);
    p.delete('new');
    go(`/tasks${p.toString() ? `?${p}` : ''}`);
  };

  return (
    <div className="flex h-full">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-3 border-b border-line bg-surface px-6 py-3">
          <h1 className="text-[20px] font-bold text-ink">Tasks</h1>
          <div className="ml-3 flex gap-1">
            {FILTERS.map((f) => (
              <button key={f.id} type="button" onClick={() => setParam('filter', f.id)} className={cx('rounded-full px-3 py-1.5 text-[12.5px] font-semibold', filter === f.id ? 'bg-ink text-surface' : 'text-ink-2 hover:bg-subtle')}>
                {f.label}
              </button>
            ))}
          </div>
          <div className="flex-1" />
          {list.data?.offline ? <OfflineNote cachedAt={list.data.cachedAt} /> : null}
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search tasks" aria-label="Search tasks" className="h-8 w-[220px] rounded-[8px] border border-line bg-ground px-3 text-[13px] outline-none focus:border-primary" />
        </div>
        <QuickAdd autoFocus={query.get('new') === '1'} orgId={orgId} />
        <div className="min-h-0 flex-1">
          {list.isLoading ? <Spinner /> : list.error ? <div className="p-6"><ErrorNote error={list.error} onRetry={() => void list.refetch()} /></div> : tasks.length === 0 ? <Empty icon="check-circle" title="No tasks here" hint="Tasks assigned to you and that you create appear here." /> : null}
          {tasks.length > 0 ? (
            <VirtualList
              items={tasks}
              estimate={56}
              getKey={(t) => t.id}
              render={(t) => {
                const done = t.status === 'done';
                const overdue = !done && t.due_date !== null && t.due_date < today;
                return (
                  <div className={cx('flex items-center gap-3 border-b border-line px-6 py-2.5', String(t.id) === selected ? 'bg-selection' : 'bg-surface hover:bg-subtle')}>
                    <input type="checkbox" checked={done} onChange={() => toggle.mutate(t)} aria-label={`Mark “${t.title}” ${done ? 'not done' : 'done'}`} className="h-[17px] w-[17px] shrink-0 accent-[var(--ws-indigo)]" />
                    <button type="button" onClick={() => setParam('task', String(t.id))} className="min-w-0 flex-1 text-left">
                      <div className={cx('truncate text-[13.5px] font-semibold', done ? 'text-ink-3 line-through' : 'text-ink')}>{t.title}</div>
                      <div className="flex items-center gap-2 truncate text-[12px] text-ink-3">
                        {t.task_key ? <span className="font-mono">{t.task_key}</span> : null}
                        {t.org_name ? <span>{t.org_name}</span> : null}
                        {t.assignee_name ? <span>· {t.assignee_name}</span> : null}
                        {t.checklist_total ? <span>· {t.checklist_done}/{t.checklist_total} checklist</span> : null}
                      </div>
                    </button>
                    {t.priority !== 'none' ? <Chip tone={PRIORITY_TONE[t.priority]}>{t.priority}</Chip> : null}
                    <span className={cx('w-[92px] shrink-0 text-right text-[12.5px]', overdue ? 'font-semibold text-danger' : 'text-ink-3')}>{t.due_date ? dateLabel(t.due_date) : ''}</span>
                  </div>
                );
              }}
            />
          ) : null}
        </div>
      </div>
      {selected ? <TaskDetail id={selected} onClose={() => setParam('task', null)} /> : null}
    </div>
  );
}

function QuickAdd({ autoFocus, orgId }: { autoFocus: boolean; orgId: string | null }) {
  const draft = useDraft<string>('tasks', 'quick-add', '');
  const [due, setDue] = useState('');
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();
  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);
  const add = async () => {
    const title = draft.value.trim();
    if (!title) return;
    setBusy(true);
    try {
      const r = await call('offline:submit', {
        module: 'tasks',
        entity: 'task',
        entityId: null,
        label: `Create task “${title}”`,
        method: 'POST',
        path: '/api/tasks',
        body: { title, due_date: due || undefined, org_id: orgId ?? undefined },
        queueIfOffline: true,
      });
      if (!r.delivered && !r.queued) throw new Error(r.error ?? 'Could not create the task.');
      toast(r.queued ? 'info' : 'success', r.queued ? 'Offline — the task will be created when you reconnect.' : 'Task created.');
      draft.setValue('');
      setDue('');
      await draft.clear();
      void qc.invalidateQueries({ queryKey: ['tasks'] });
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="flex items-center gap-2 border-b border-line bg-surface px-6 py-2"
      onSubmit={(e) => {
        e.preventDefault();
        void add();
      }}
    >
      <Icon name="plus" size={16} className="text-ink-3" />
      <input ref={ref} value={draft.value} onChange={(e) => draft.setValue(e.target.value)} placeholder="Add a task and press Enter" aria-label="New task title" className="h-8 flex-1 bg-transparent text-[13.5px] outline-none placeholder:text-ink-3" />
      {draft.restored && draft.value ? <Chip tone="teal">Draft restored</Chip> : null}
      <input type="date" value={due} onChange={(e) => setDue(e.target.value)} aria-label="Due date" className="h-8 rounded-[8px] border border-line bg-ground px-2 text-[12.5px] text-ink-2" />
      <Button type="submit" variant="primary" size="sm" loading={busy} disabled={!draft.value.trim()}>
        Add
      </Button>
    </form>
  );
}

function TaskDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient();
  const { openLink } = useTab();
  const q = useQuery({ queryKey: ['tasks', 'detail', id], queryFn: () => apiGet<{ task: Task } | Task>(`/api/tasks/${id}`) });
  const task = useMemo(() => (q.data && 'task' in q.data ? q.data.task : (q.data as Task | undefined)), [q.data]);
  const change = async (field: string, value: unknown) => {
    if (!task) return;
    try {
      await submitTaskChange(task, field, value, `Update “${task.title}”`);
      void qc.invalidateQueries({ queryKey: ['tasks'] });
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  return (
    <aside className="flex w-[400px] shrink-0 flex-col border-l border-line bg-surface">
      <div className="flex items-center justify-between border-b border-line px-5 py-3">
        <span className="font-mono text-[12px] text-ink-3">{task?.task_key ?? `#${id}`}</span>
        <div className="flex gap-1">
          <IconButton icon="external" label="Open in browser" onClick={() => openLink(`/tasks?task=${id}`)} />
          <IconButton icon="x" label="Close" onClick={onClose} />
        </div>
      </div>
      {q.isLoading ? <Spinner /> : q.error ? <div className="p-5"><ErrorNote error={q.error} /></div> : task ? (
        <div className="flex-1 overflow-y-auto p-5 scroll-thin">
          <h2 className="text-[18px] font-bold text-ink selectable">{task.title}</h2>
          <dl className="mt-4 grid grid-cols-[110px_1fr] items-center gap-y-3 text-[13px]">
            <dt className="text-ink-3">Status</dt>
            <dd>
              <Select label="Status" value={task.status} options={STATUS} onChange={(v) => void change('status', v)} />
            </dd>
            <dt className="text-ink-3">Priority</dt>
            <dd>
              <Select label="Priority" value={task.priority} options={(['urgent', 'high', 'medium', 'low', 'none'] as const).map((p) => ({ value: p, label: p[0]!.toUpperCase() + p.slice(1) }))} onChange={(v) => void change('priority', v)} />
            </dd>
            <dt className="text-ink-3">Due</dt>
            <dd>
              <input type="date" defaultValue={task.due_date ?? ''} onBlur={(e) => e.target.value !== (task.due_date ?? '') && void change('due_date', e.target.value || null)} aria-label="Due date" className="h-8 rounded-[8px] border border-line bg-surface px-2 text-[13px]" />
            </dd>
            <dt className="text-ink-3">Assignee</dt>
            <dd className="text-ink">{task.assignee_name ?? 'Unassigned'}</dd>
            <dt className="text-ink-3">Company</dt>
            <dd className="text-ink">{task.org_name ?? '—'}</dd>
            <dt className="text-ink-3">Updated</dt>
            <dd className="text-ink-2">{relative(task.updated_at)}</dd>
          </dl>
          {task.description ? <p className="mt-5 whitespace-pre-wrap text-[13.5px] leading-relaxed text-ink-2 selectable">{stripHtml(task.description)}</p> : null}
          {task.tags.length ? (
            <div className="mt-4 flex flex-wrap gap-1.5">
              {task.tags.map((t) => (
                <Chip key={t}>{t}</Chip>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </aside>
  );
}

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type KeyboardEvent } from 'react';
import { call, errorMessage } from '../../core/bridge';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { cx } from '../../components/ui';
import { Checkbox } from '../../components/Checkbox';
import { dueOf, priorityOf, type Priority, type Task } from '../tasks/api';
import { compactCount, type taskBuckets } from './today';

/**
 * Home › Today's work (optimized): Today, Overdue and Upcoming as tabs, each counted as the Tasks page counts it;
 * a task is ticked done right here (offline, it is queued), opened by its title, and added through Tasks' own form.
 */
type Bucket = 'today' | 'overdue' | 'upcoming';

const TABS: Array<{ id: Bucket; label: string }> = [
  { id: 'today', label: 'Today' },
  { id: 'overdue', label: 'Overdue' },
  { id: 'upcoming', label: 'Upcoming' },
];

const EMPTY: Record<Bucket, string> = { today: 'Nothing else due today.', overdue: 'Nothing overdue. Nice work.', upcoming: 'Nothing due in the next week.' };

/** The priority's dot and word, in the Tasks page's colours; "None" says nothing. */
const PRIORITY_TONE: Record<Priority, string> = { urgent: 'text-danger', high: 'text-warning', medium: 'text-primary', low: 'text-ink-3', none: '' };

const SHOWN = 6;

export function TodaysWork({ buckets, today, onOpen, onMore, onAdd }: { buckets: ReturnType<typeof taskBuckets>; today: string; onOpen: (id: number) => void; onMore: (scope: Bucket) => void; onAdd: () => void }) {
  const [tab, setTab] = useState<Bucket>('today');
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);
  const items = buckets[tab];
  const keys = (e: KeyboardEvent, i: number) => {
    const j = e.key === 'ArrowRight' ? (i + 1) % TABS.length : e.key === 'ArrowLeft' ? (i + TABS.length - 1) % TABS.length : e.key === 'Home' ? 0 : e.key === 'End' ? TABS.length - 1 : -1;
    if (j < 0) return;
    e.preventDefault();
    setTab(TABS[j]!.id);
    tabs.current[j]?.focus();
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div role="tablist" aria-label="Task filter" className="flex gap-0.5 self-start rounded-[10px] border border-line bg-well p-[3px]">
        {TABS.map((s, i) => {
          const selected = tab === s.id;
          const n = buckets[s.id].length;
          return (
            <button
              key={s.id}
              ref={(el) => {
                tabs.current[i] = el;
              }}
              type="button"
              role="tab"
              id={`home-work-${s.id}`}
              aria-selected={selected}
              aria-controls="home-work-panel"
              tabIndex={selected ? 0 : -1}
              onClick={() => setTab(s.id)}
              onKeyDown={(e) => keys(e, i)}
              className={cx('flex h-[30px] items-center gap-2 rounded-[7px] px-3 text-[13px] font-medium', selected ? 'bg-surface text-ink shadow-sm ring-1 ring-line' : 'text-ink-2 hover:text-ink')}
            >
              {s.label}
              <span
                title={n.toLocaleString()}
                className={cx(
                  'flex h-[18px] min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold tabular',
                  s.id === 'overdue' && n ? 'bg-danger-bg text-danger' : selected ? 'bg-selection text-primary' : 'bg-subtle text-ink-2',
                )}
              >
                {compactCount(n)}
              </span>
            </button>
          );
        })}
      </div>
      <div role="tabpanel" id="home-work-panel" aria-labelledby={`home-work-${tab}`} className="flex flex-col">
        {items.length ? (
          <>
            <TaskRows tasks={items.slice(0, SHOWN)} today={today} onOpen={onOpen} />
            {items.length > SHOWN ? (
              <button type="button" onClick={() => onMore(tab)} className="self-start border-t border-transparent py-2 text-[12.5px] font-semibold text-primary hover:underline">
                View all {items.length.toLocaleString()}
              </button>
            ) : null}
          </>
        ) : (
          <p className="m-0 flex items-center gap-2 border-t border-line py-3 text-[13px] text-ink-3">
            <Icon name="check-circle" size={15} /> {EMPTY[tab]}
          </p>
        )}
      </div>
      <button type="button" onClick={onAdd} className="mt-auto flex h-10 items-center gap-2.5 border-t border-line px-1 text-left text-[13px] text-ink-3 hover:text-ink">
        <Icon name="plus" size={16} /> Add a task
      </button>
    </div>
  );
}

function TaskRows({ tasks, today, onOpen }: { tasks: Task[]; today: string; onOpen: (id: number) => void }) {
  const qc = useQueryClient();
  // Ticked here and not yet gone from the list: struck through until the list is asked again.
  const [ticked, setTicked] = useState<Set<number>>(() => new Set());
  const mark = (id: number, on: boolean) =>
    setTicked((s) => {
      const n = new Set(s);
      if (on) n.add(id);
      else n.delete(id);
      return n;
    });
  const complete = useMutation({
    mutationFn: async (task: Task) => {
      const done = task.status !== 'done' && !ticked.has(task.id);
      mark(task.id, done);
      const r = await call('offline:submit', {
        module: 'tasks',
        entity: 'task',
        entityId: String(task.id),
        label: `${done ? 'Complete' : 'Reopen'} “${task.title}”`,
        method: 'PATCH',
        path: `/api/tasks/${task.id}`,
        body: { field: 'status', value: done ? 'done' : 'todo' },
        queueIfOffline: true,
      });
      if (!r.delivered && !r.queued) {
        mark(task.id, !done);
        throw new Error(r.error ?? 'Could not update the task.');
      }
      return r;
    },
    onSuccess: (r) => {
      if (r.queued) toast('info', 'Offline — the change will sync when you reconnect.');
      void qc.invalidateQueries({ queryKey: ['tasks'] });
    },
    onError: (e) => toast('error', errorMessage(e)),
  });
  return (
    <ul className="m-0 flex list-none flex-col p-0">
      {tasks.map((task) => {
        const due = dueOf(task, today);
        const done = task.status === 'done' || ticked.has(task.id);
        const p = priorityOf(task.priority);
        return (
          <li key={task.id} className="flex items-center gap-3 border-t border-line py-[11px]">
            <Checkbox checked={done} onChange={() => complete.mutate(task)} aria-label={`Mark “${task.title}” done`} />
            <button type="button" onClick={() => onOpen(task.id)} className="flex min-w-0 flex-1 flex-col gap-[3px] text-left">
              <span className={cx('truncate text-[14px] font-medium', done ? 'text-ink-3 line-through' : 'text-ink')} title={task.title}>
                {task.title}
              </span>
              {task.org_name ? <span className="truncate text-[12px] text-ink-3">{task.org_name}</span> : null}
            </button>
            <span className="flex shrink-0 flex-col items-end gap-[3px]">
              {due.label ? <span className={cx('text-[13px] tabular', due.tone === 'overdue' && !done ? 'text-danger' : 'text-ink-3')}>{due.label.replace(/^Today /, '')}</span> : null}
              {task.priority !== 'none' ? (
                <span className={cx('flex items-center gap-[5px] text-[11px] font-medium', PRIORITY_TONE[task.priority])}>
                  <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
                  {p.label}
                </span>
              ) : null}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

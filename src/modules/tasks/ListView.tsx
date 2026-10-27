import { useMemo, useState } from 'react';
import { cx } from '../../components/ui';
import { dueOf, priorityOf, progressOf, STATUSES, type DueGroup, type Status, type Task, type TaskList } from './api';
import { Select } from '../../components/Select';
import { Checkbox } from '../../components/Checkbox';

const GROUPS: Array<{ id: DueGroup | 'done'; label: string; tone: string }> = [
  { id: 'overdue', label: 'OVERDUE', tone: 'text-danger' },
  { id: 'today', label: 'TODAY', tone: 'text-primary' },
  { id: 'week', label: 'THIS WEEK', tone: 'text-ink-2' },
  { id: 'later', label: 'LATER', tone: 'text-ink-2' },
  { id: 'none', label: 'NO DUE DATE', tone: 'text-ink-3' },
];
const COLS = '22px minmax(0,2.6fr) minmax(0,1.2fr) minmax(0,1.3fr) minmax(0,0.8fr) minmax(0,0.9fr) minmax(0,0.9fr) minmax(0,1fr)';

/**
 * The list (TasksList): open tasks grouped by when they are due, with the
 * status changed in place and a round tick before the title to complete.
 * Completed tasks come newest first, in one group.
 *
 * The box at the start of a row picks it (#392): a bar over the list then
 * completes, reopens or moves every picked task at once.
 */
export function ListView({ tasks, lists, me, today, now, completed, selected, canChangeStatus, quickAdd, onOpen, onToggle, onStatus, onBulkStatus, onQuickAdd }: {
  tasks: Task[];
  lists: Map<number, TaskList>;
  me: number;
  today: string;
  now: number;
  completed: boolean;
  selected: number | null;
  canChangeStatus: boolean;
  quickAdd: string | null;
  onOpen: (t: Task) => void;
  onToggle: (t: Task) => void;
  onStatus: (t: Task, s: Status) => void;
  onBulkStatus: (ts: Task[], s: Status) => Promise<void>;
  onQuickAdd: (title: string) => Promise<void>;
}) {
  const [title, setTitle] = useState('');
  const [picked, setPicked] = useState<Set<number>>(() => new Set());
  // Only what is still on screen counts: a task that left the view (completed, filtered) is no longer picked.
  const chosen = useMemo(() => tasks.filter((t) => picked.has(t.id)), [tasks, picked]);
  const pick = (id: number, on: boolean) => setPicked((cur) => { const next = new Set(cur); if (on) next.add(id); else next.delete(id); return next; });
  const allPicked = tasks.length > 0 && chosen.length === tasks.length;
  const [busy, setBusy] = useState(false);
  const bulk = async (s: Status) => {
    setBusy(true);
    try {
      await onBulkStatus(chosen, s);
      setPicked(new Set());
    } finally {
      setBusy(false);
    }
  };
  const sorted = completed
    ? [...tasks].sort((a, b) => (b.completed_at ?? '').localeCompare(a.completed_at ?? ''))
    : [...tasks].sort((a, b) => {
        const da = dueOf(a, today, now);
        const db = dueOf(b, today, now);
        return (da.day ?? '9999').localeCompare(db.day ?? '9999') || (PRIO[a.priority] ?? 4) - (PRIO[b.priority] ?? 4) || a.position - b.position;
      });
  const groups = completed ? [{ id: 'done' as const, label: 'COMPLETED', tone: 'text-success', items: sorted }] : GROUPS.map((g) => ({ ...g, items: sorted.filter((t) => dueOf(t, today, now).group === g.id) })).filter((g) => g.items.length);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {quickAdd !== null ? (
        <div className="shrink-0 px-5 pb-2">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' || !title.trim()) return;
              const t = title.trim();
              setTitle('');
              void onQuickAdd(t);
            }}
            aria-label="Quick add"
            placeholder={`+ Task title… (Enter to add to ${quickAdd})`}
            className="h-[38px] w-full rounded-[9px] border border-dashed border-primary-soft bg-surface px-3 text-[13px] text-ink outline-none focus:border-solid focus:border-primary dark:border-line"
          />
        </div>
      ) : null}
      {chosen.length ? (
        <div role="toolbar" aria-label="Picked tasks" className="mx-5 mb-2 flex shrink-0 flex-wrap items-center gap-2 rounded-[9px] border border-primary/30 bg-selection px-3 py-1.5 text-[13px]">
          <b className="text-ink">{chosen.length} picked</b>
          {canChangeStatus ? (
            <>
              <button type="button" disabled={busy} onClick={() => void bulk('done')} className="h-7 rounded-[7px] bg-primary px-2.5 text-[12.5px] font-semibold text-white hover:bg-primary-hover disabled:opacity-50">Mark complete</button>
              <button type="button" disabled={busy} onClick={() => void bulk('todo')} className="h-7 rounded-[7px] border border-line bg-surface px-2.5 text-[12.5px] font-semibold text-ink hover:bg-subtle disabled:opacity-50">Reopen</button>
              <Select value="" disabled={busy} onChange={(e) => e.target.value && void bulk(e.target.value as Status)} aria-label="Set the status of the picked tasks" className="h-7 rounded-[7px] border border-line bg-surface px-1 text-[12px] text-ink">
                <option value="">Set status…</option>
                {STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </Select>
            </>
          ) : <span className="text-ink-3">Shared tasks can only be changed by their owners.</span>}
          <span className="flex-1" />
          <button type="button" onClick={() => setPicked(new Set())} className="h-7 rounded-[7px] px-2 text-[12.5px] font-semibold text-ink-2 hover:bg-subtle">Clear</button>
        </div>
      ) : null}
      <div role="table" aria-label="Tasks" className="min-h-0 flex-1 overflow-y-auto scroll-thin">
        <div role="row" className="sticky top-0 z-10 grid gap-2 border-y border-line bg-ground px-5 py-[7px] text-[10.5px] font-bold tracking-[0.4px] text-ink-3" style={{ gridTemplateColumns: COLS }}>
          <Checkbox checked={allPicked} indeterminate={chosen.length > 0 && !allPicked} disabled={!tasks.length} onChange={(e) => setPicked(e.target.checked ? new Set(tasks.map((t) => t.id)) : new Set())} aria-label="Pick all tasks" />
          <span role="columnheader">TASK</span>
          <span role="columnheader">LIST</span>
          <span role="columnheader">STATUS</span>
          <span role="columnheader">PRIORITY</span>
          <span role="columnheader">ASSIGNEE</span>
          <span role="columnheader">DUE</span>
          <span role="columnheader">PROGRESS</span>
        </div>
        {groups.length === 0 ? <p className="px-5 py-10 text-center text-[13px] text-ink-3">{completed ? 'Nothing completed yet.' : 'Nothing here. Add a task above, or press N.'}</p> : null}
        {groups.map((g) => (
          <div key={g.id} role="rowgroup" aria-label={g.label}>
            <div className={cx('px-5 pt-2 pb-1 text-[11px] font-bold tracking-[0.5px]', g.tone)}>{g.label} · {g.items.length}</div>
            {g.items.map((t) => {
              const due = dueOf(t, today, now);
              const pr = priorityOf(t.priority);
              const p = progressOf(t);
              const done = t.status === 'done';
              const list = t.list_id ? lists.get(t.list_id) : undefined;
              return (
                <div key={t.id} role="row" aria-selected={selected === t.id} className={cx('grid items-center gap-2 border-b border-line/60 px-5 py-[7px] text-[13px]', selected === t.id ? 'bg-selection' : 'hover:bg-subtle/60')} style={{ gridTemplateColumns: COLS }}>
                  <Checkbox checked={picked.has(t.id)} onChange={(e) => pick(t.id, e.target.checked)} aria-label={`Pick ${t.title}`} />
                  <span className="flex min-w-0 items-center gap-2">
                    <button
                      type="button"
                      disabled={!canChangeStatus}
                      onClick={() => onToggle(t)}
                      aria-label={`${done ? 'Reopen' : 'Complete'} ${t.title}`}
                      title={canChangeStatus ? (done ? 'Reopen' : 'Complete') : 'Shared tasks can only be completed by their owners'}
                      className={cx('flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border-[1.5px] text-[11px] leading-none', done ? 'border-success bg-success text-white' : 'border-ink-3 text-transparent hover:border-success hover:text-success', 'disabled:cursor-not-allowed disabled:opacity-50')}
                    >
                      ✓
                    </button>
                    <button type="button" onClick={() => onOpen(t)} className={cx('min-w-0 truncate text-left font-semibold hover:underline', done ? 'text-ink-3 line-through' : 'text-ink')} title={t.title}>
                      {t.title}
                    </button>
                  </span>
                  <span className="flex min-w-0 items-center gap-1.5 text-ink-2">
                    {list ? <span className="h-2 w-2 shrink-0 rounded-[3px]" style={{ background: list.color }} /> : null}
                    <span className="truncate">{list?.name ?? '—'}</span>
                  </span>
                  <Select value={t.status} disabled={!canChangeStatus} onChange={(e) => onStatus(t, e.target.value as Status)} aria-label={`Status of ${t.title}`} className="h-7 min-w-0 rounded-[7px] border border-line bg-surface px-1 text-[12px] text-ink disabled:opacity-70">
                    {STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                  </Select>
                  <span>{t.priority !== 'none' ? <span className={cx('rounded-[5px] px-[7px] py-[2px] text-[10.5px] font-bold', pr.tone)}>{pr.label}</span> : null}</span>
                  <span className="truncate text-ink-2">{t.assignee_id === me ? 'You' : (t.assignee_name ?? '—')}</span>
                  <span className={cx('truncate font-semibold', due.tone === 'overdue' ? 'text-danger' : due.tone === 'soon' ? 'text-warning dark:text-warning' : due.tone === 'done' ? 'text-success' : 'text-ink-2')}>{due.label || '—'}</span>
                  <span className="flex items-center gap-1.5" aria-label={`${p}% done`}>
                    <span className="h-[5px] flex-1 overflow-hidden rounded-full bg-subtle"><span className={cx('block h-full rounded-full', p === 100 ? 'bg-success' : 'bg-primary')} style={{ width: `${p}%` }} /></span>
                    <span className="w-8 text-right text-[11px] text-ink-3">{p}%</span>
                  </span>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

const PRIO: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3, none: 4 };

import { useRef, useState } from 'react';
import { initials, cx } from '../../components/ui';
import { dueOf, priorityOf, progressOf, STATUSES, type Status, type Task } from './api';

const BOARD: Status[] = ['todo', 'in_progress', 'review', 'changes_requested', 'on_hold', 'done'];

/**
 * The board (TasksBoard): a column per status, cards dragged between them.
 * Backlog shows when something is in it; cancelled tasks stay in the list.
 */
export function BoardView({ tasks, me, today, now, selected, canMove, onOpen, onMove, onQuickAdd }: {
  tasks: Task[];
  me: number;
  today: string;
  now: number;
  selected: number | null;
  canMove: boolean;
  onOpen: (t: Task) => void;
  onMove: (t: Task, s: Status) => void;
  onQuickAdd: (title: string, status: Status) => Promise<void>;
}) {
  const dragging = useRef<Task | null>(null);
  const [over, setOver] = useState<Status | null>(null);
  const columns = (tasks.some((t) => t.status === 'backlog') ? (['backlog', ...BOARD] as Status[]) : BOARD).map((s) => ({ ...STATUSES.find((x) => x.id === s)!, items: tasks.filter((t) => t.status === s) }));
  return (
    <div className="grid min-h-0 flex-1 auto-cols-[minmax(210px,1fr)] grid-flow-col gap-2.5 overflow-x-auto px-5 pb-4 scroll-thin">
      {columns.map((c) => (
        <section
          key={c.id}
          aria-label={c.label}
          onDragOver={(e) => {
            if (!dragging.current || !canMove) return;
            e.preventDefault();
            if (over !== c.id) setOver(c.id);
          }}
          onDragLeave={(e) => e.currentTarget === e.target && setOver(null)}
          onDrop={(e) => {
            e.preventDefault();
            const t = dragging.current;
            dragging.current = null;
            setOver(null);
            if (t && t.status !== c.id) onMove(t, c.id);
          }}
          className={cx('flex min-h-0 flex-col gap-2 rounded-[12px] bg-[#EAEDF4] p-2 dark:bg-subtle', over === c.id && 'ring-2 ring-primary/40')}
        >
          <div className="flex items-center gap-1.5 px-1 pt-0.5">
            <span className="h-2 w-2 rounded-full" style={{ background: c.dot }} />
            <b className="flex-1 text-[12.5px] text-ink">{c.label}</b>
            <span className="text-[11.5px] text-ink-3">{c.items.length}</span>
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto scroll-thin">
            {c.items.map((t) => {
              const due = dueOf(t, today, now);
              const pr = priorityOf(t.priority);
              const p = progressOf(t);
              const meta = [t.checklist_total ? `${t.checklist_done}/${t.checklist_total}` : null].filter(Boolean).join(' · ');
              return (
                <button
                  key={t.id}
                  type="button"
                  draggable={canMove}
                  onDragStart={(e) => {
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', t.title);
                    dragging.current = t;
                  }}
                  onDragEnd={() => {
                    dragging.current = null;
                    setOver(null);
                  }}
                  onClick={() => onOpen(t)}
                  aria-label={t.title}
                  className={cx('flex flex-col gap-[7px] rounded-[10px] border bg-surface p-2.5 text-left', selected === t.id ? 'border-primary' : 'border-line hover:border-[#B8C1DA]', canMove && 'cursor-grab')}
                >
                  <span className="flex flex-wrap gap-[5px]">
                    {t.priority !== 'none' ? <span className={cx('rounded-[5px] px-1.5 py-px text-[10.5px] font-bold', pr.tone)}>{pr.label}</span> : null}
                    {t.tags[0] ? <span className="rounded-[5px] bg-subtle px-1.5 py-px text-[10.5px] font-semibold text-ink-2">{t.tags[0]}</span> : null}
                  </span>
                  <b className={cx('text-[12.5px] leading-[1.35]', t.status === 'done' ? 'text-ink-3 line-through' : 'text-ink')}>{t.title}</b>
                  {p > 0 && p < 100 ? (
                    <span className="h-1 overflow-hidden rounded-full bg-subtle" aria-label={`${p}% done`}>
                      <span className="block h-full rounded-full bg-success" style={{ width: `${p}%` }} />
                    </span>
                  ) : null}
                  <span className="flex items-center gap-1.5 text-[11px] text-ink-3">
                    <span className={cx('font-semibold', due.tone === 'overdue' ? 'text-danger' : due.tone === 'soon' ? 'text-[#B45309] dark:text-warning' : due.tone === 'done' ? 'text-success' : '')}>{due.label}</span>
                    <span className="min-w-0 flex-1 truncate">{due.tone === 'overdue' ? `Overdue${meta ? ` · ${meta}` : ''}` : meta}</span>
                    {t.assignee_name ? (
                      <span title={t.assignee_id === me ? 'You' : t.assignee_name} className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-selection text-[9px] font-bold text-primary">
                        {initials(t.assignee_name)}
                      </span>
                    ) : null}
                  </span>
                </button>
              );
            })}
          </div>
          <ColumnAdd label={c.label} onAdd={(title) => onQuickAdd(title, c.id)} />
        </section>
      ))}
    </div>
  );
}

function ColumnAdd({ label, onAdd }: { label: string; onAdd: (title: string) => Promise<void> }) {
  const [title, setTitle] = useState('');
  return (
    <input
      value={title}
      onChange={(e) => setTitle(e.target.value)}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' || !title.trim()) return;
        const t = title.trim();
        setTitle('');
        void onAdd(t);
      }}
      aria-label={`Add a task to ${label}`}
      placeholder="+ Task title…"
      className="h-[30px] shrink-0 rounded-[8px] border border-dashed border-[#B8C1DA] bg-transparent px-2 text-[12px] text-ink outline-none focus:border-solid focus:border-primary focus:bg-surface dark:border-line"
    />
  );
}

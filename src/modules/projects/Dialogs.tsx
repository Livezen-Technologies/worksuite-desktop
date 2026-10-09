import { useMemo, useState } from 'react';
import { TASK_STATUS_LABEL } from '@shared/projects';
import { errorMessage } from '../../core/bridge';
import { todayInZone } from '../../core/time';
import { toast } from '../../core/toasts';
import { Checkbox } from '../../components/Checkbox';
import { Select } from '../../components/Select';
import { Button, Modal, cx } from '../../components/ui';
import { write, type Project, type Task, type TaskStatus } from './api';
import { submit } from './desk';
import { BOARD_COLUMNS } from './logic';
import { HealthDot, fieldClass } from './parts';

/** "1:30", "90m", "1.5h", "1h30": what the Projects API takes as a duration (PRJ-TIM-01). Minutes, or null. */
export function durationMinutes(text: string): number | null {
  const s = text.trim().toLowerCase().replace(/\s+/g, '');
  let m: RegExpExecArray | null;
  if ((m = /^(\d{1,2}):(\d{2})$/.exec(s))) return Number(m[1]) * 60 + Number(m[2]);
  if ((m = /^(\d+)m$/.exec(s))) return Number(m[1]);
  if ((m = /^(\d+)h(\d{1,2})$/.exec(s))) return Number(m[1]) * 60 + Number(m[2]);
  if ((m = /^(\d+(?:\.\d+)?)h?$/.exec(s))) return Math.round(Number(m[1]) * 60);
  return null;
}

/**
 * Log time (L, D01): on a task or its project, for a day, with a note and billing. It goes through the outbox, so it
 * is kept while WorkSuite is out of reach and logged once when it is back.
 */
export function LogTime({ task, project, onClose }: { task: Pick<Task, 'id' | 'task_number' | 'title' | 'project_id' | 'is_billable'> | null; project: { id: number; code?: string | null } | null; onClose: () => void }) {
  const [duration, setDuration] = useState('');
  const [day, setDay] = useState(todayInZone());
  const [note, setNote] = useState('');
  const [billable, setBillable] = useState(task?.is_billable ?? true);
  const [busy, setBusy] = useState(false);
  const minutes = durationMinutes(duration);
  const valid = minutes !== null && minutes > 0 && minutes <= 24 * 60;
  const on = task ? (task.task_number ?? task.title) : (project?.code ?? 'the project');
  const save = async () => {
    if (!valid) return;
    setBusy(true);
    try {
      const h = `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
      const r = await submit({ kind: 'log', duration: h, onDate: day, projectId: task?.project_id ?? project?.id ?? null, taskId: task?.id ?? null, note: note.trim() || null, billable, label: `Log ${h} on ${on}${billable ? ' · billable' : ''}` });
      if (r.error && !r.queued) throw new Error(r.error);
      toast(r.queued ? 'info' : 'success', r.queued ? 'Offline — the time is kept and logged when you reconnect.' : `Logged ${h} on ${on}.`);
      onClose();
    } catch (e) {
      toast('error', errorMessage(e));
      setBusy(false);
    }
  };
  return (
    <Modal
      title={`Log time on ${on}`}
      onClose={onClose}
      width={420}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!valid} onClick={() => void save()}>
            Log time
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-[13px]">
        <div className="grid grid-cols-2 gap-2.5">
          <label className="flex flex-col gap-1 font-semibold text-ink">
            Duration
            <input autoFocus value={duration} onChange={(e) => setDuration(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void save()} placeholder="1:30, 90m, 1.5h" aria-invalid={!!duration && !valid} className={cx(fieldClass, 'font-normal', duration && !valid && 'border-danger')} />
          </label>
          <label className="flex flex-col gap-1 font-semibold text-ink">
            Day
            <input type="date" value={day} max={todayInZone()} onChange={(e) => setDay(e.target.value)} className={cx(fieldClass, 'font-normal')} />
          </label>
        </div>
        <label className="flex flex-col gap-1 font-semibold text-ink">
          Note
          <input value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} placeholder="What the time was spent on" className={cx(fieldClass, 'font-normal')} />
        </label>
        <label className="flex items-center gap-2 font-semibold text-ink">
          <Checkbox checked={billable} onChange={(e) => setBillable(e.target.checked)} />
          Billable
        </label>
        {duration && !valid ? <p className="text-[12px] text-danger">Write it as 1:30, 90m or 1.5h — at most 24 hours.</p> : null}
      </div>
    </Modal>
  );
}

/** New task (N): on this project's board, in a column. Creating needs WorkSuite (it is not kept offline). */
export function NewTask({ projectId, status, me, onClose, onCreated }: { projectId: number; status: TaskStatus; me: number; onClose: () => void; onCreated: (id: number) => void }) {
  const [title, setTitle] = useState('');
  const [column, setColumn] = useState<TaskStatus>(BOARD_COLUMNS.includes(status) ? status : 'todo');
  const [type, setType] = useState('task');
  const [due, setDue] = useState('');
  const [mine, setMine] = useState(true);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!title.trim()) return;
    setBusy(true);
    try {
      const r = await write.createTask({ project_id: projectId, title: title.trim(), status: column, task_type: type, due_date: due || null, assignee_id: mine && me ? me : null });
      toast('success', `${r.task_number ?? 'Task'} created.`);
      onCreated(Number(r.id));
    } catch (e) {
      toast('error', errorMessage(e));
      setBusy(false);
    }
  };
  return (
    <Modal
      title="New task"
      onClose={onClose}
      width={460}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!title.trim()} onClick={() => void save()}>
            Create task
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-[13px]">
        <label className="flex flex-col gap-1 font-semibold text-ink">
          Title
          <input autoFocus value={title} maxLength={250} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void save()} placeholder="What needs doing" className={cx(fieldClass, 'font-normal')} />
        </label>
        <div className="grid grid-cols-3 gap-2.5">
          <label className="flex flex-col gap-1 font-semibold text-ink">
            Column
            <Select value={column} onChange={(e) => setColumn(e.target.value as TaskStatus)} className={fieldClass}>
              {BOARD_COLUMNS.map((s) => (
                <option key={s} value={s}>
                  {TASK_STATUS_LABEL[s]}
                </option>
              ))}
            </Select>
          </label>
          <label className="flex flex-col gap-1 font-semibold text-ink">
            Type
            <Select value={type} onChange={(e) => setType(e.target.value)} className={fieldClass}>
              <option value="task">Task</option>
              <option value="bug">Bug</option>
              <option value="story">Story</option>
              <option value="chore">Chore</option>
            </Select>
          </label>
          <label className="flex flex-col gap-1 font-semibold text-ink">
            Due
            <input type="date" value={due} onChange={(e) => setDue(e.target.value)} className={cx(fieldClass, 'font-normal')} />
          </label>
        </div>
        <label className="flex items-center gap-2 font-semibold text-ink">
          <Checkbox checked={mine} onChange={(e) => setMine(e.target.checked)} />
          Assign to me
        </label>
      </div>
    </Modal>
  );
}

/** Jump to project (⌘P, D01): type to find, ↑/↓ to choose, Enter to open. */
export function JumpTo({ projects, onPick, onClose }: { projects: Project[]; onPick: (id: number) => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [at, setAt] = useState(0);
  const hits = useMemo(() => {
    const n = q.trim().toLowerCase();
    return (n ? projects.filter((p) => `${p.code} ${p.name} ${p.client ?? ''}`.toLowerCase().includes(n)) : projects).slice(0, 12);
  }, [q, projects]);
  return (
    <Modal title="Jump to project" onClose={onClose} width={480}>
      <input
        autoFocus
        value={q}
        onChange={(e) => (setQ(e.target.value), setAt(0))}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') setAt((n) => Math.min(n + 1, hits.length - 1));
          else if (e.key === 'ArrowUp') setAt((n) => Math.max(n - 1, 0));
          else if (e.key === 'Enter' && hits[at]) onPick(hits[at].id);
          else return;
          e.preventDefault();
        }}
        aria-label="Project name or code"
        placeholder="Project name or code"
        className={cx(fieldClass, 'mb-2 w-full')}
      />
      <ul role="listbox" aria-label="Projects" className="flex flex-col">
        {hits.map((p, i) => (
          <li key={p.id} role="option" aria-selected={i === at}>
            <button type="button" onMouseEnter={() => setAt(i)} onClick={() => onPick(p.id)} className={cx('flex w-full items-center gap-2.5 rounded-[8px] px-2.5 py-2 text-left text-[13px]', i === at ? 'bg-selection text-primary' : 'text-ink hover:bg-subtle')}>
              <HealthDot health={p.health} />
              <span className="font-mono text-[11.5px] text-ink-3">{p.code}</span>
              <span className="min-w-0 flex-1 truncate font-semibold">{p.name}</span>
              {p.client ? <span className="truncate text-[12px] text-ink-3">{p.client}</span> : null}
            </button>
          </li>
        ))}
        {!hits.length ? <li className="px-2.5 py-3 text-[12.5px] text-ink-3">No project matches.</li> : null}
      </ul>
    </Modal>
  );
}

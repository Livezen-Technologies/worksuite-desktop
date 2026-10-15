import { useMemo, useState, type ReactNode } from 'react';
import { clockOf, hhmm } from '@shared/projects';
import { apiDelete, apiPost } from '../../core/api';
import { errorMessage } from '../../core/bridge';
import { useNow } from '../../core/use-now';
import { Checkbox } from '../../components/Checkbox';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { Button, Modal, cx } from '../../components/ui';
import { Row, aside } from '../tasks/editor';
import { API, type Task, type TaskStatus } from './api';
import { elapsedOf } from './desk';
import { shortDay } from './logic';
import { Ref, StatusChip } from './parts';
import { entryState, type Dep, type EditorData, type ProjectBlock } from './task-editor';

/**
 * The project's own parts of the task modal (PRJ-TED-03/04, D06): the Project group of the side panel, the
 * dependencies and the time of the main column. Each field the reader may not change is shown read-only with the
 * reason as its tooltip (PRJ-TED-08).
 */

type Access = (field: string) => { ok: boolean; reason: string | null };
type Save = (field: string, value: unknown, label: string) => void;

const readOnly = 'min-w-0 truncate text-[12.5px] text-ink-2';

function Section({ title, extra, children }: { title: ReactNode; extra?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <b className="flex-1 text-ink">{title}</b>
        {extra}
      </div>
      {children}
    </section>
  );
}

export function GroupHead({ children }: { children: ReactNode }) {
  return <h3 className="mt-1 border-t border-line pt-2.5 text-[11px] font-bold tracking-[0.5px] text-ink-3 uppercase">{children}</h3>;
}

/** A number that saves when it is left (Points, Estimate). */
function NumberField({ label, value, step, suffix, access, onSave }: { label: string; value: number | null; step: number; suffix?: string; access: { ok: boolean; reason: string | null }; onSave: (v: number | null) => void }) {
  const [v, setV] = useState(value === null ? '' : String(value));
  const commit = () => {
    const next = v.trim() === '' ? null : Math.max(0, Number(v));
    if (next !== null && !Number.isFinite(next)) return setV(value === null ? '' : String(value));
    if (next !== value) onSave(next);
  };
  return (
    <span className="flex items-center gap-1.5">
      <input type="number" min={0} step={step} aria-label={label} disabled={!access.ok} title={access.reason ?? undefined} value={v} onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} className={aside} />
      {suffix ? <span className="text-ink-3">{suffix}</span> : null}
    </span>
  );
}

function TextField({ label, value, access, onSave }: { label: string; value: string | null; access: { ok: boolean; reason: string | null }; onSave: (v: string) => void }) {
  const [v, setV] = useState(value ?? '');
  return <input aria-label={label} disabled={!access.ok} title={access.reason ?? undefined} value={v} maxLength={400} onChange={(e) => setV(e.target.value)} onBlur={() => v.trim() !== (value ?? '') && onSave(v.trim())} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} className={aside} />;
}

/** Choices with the current value always among them (named even when the list has not come yet). */
function Pick({ label, value, current, none, options, access, onPick }: { label: string; value: number | null; current: string | null; none: string; options: Array<{ id: number; label: string }>; access: { ok: boolean; reason: string | null }; onPick: (v: number | null) => void }) {
  const opts = [{ value: '' as number | '', label: none }, ...options.map((o) => ({ value: o.id as number | '', label: o.label }))];
  if (value && !options.some((o) => o.id === value)) opts.push({ value, label: current ?? `#${value}` });
  return <Select<number | ''> aria-label={label} disabled={!access.ok} title={access.reason ?? undefined} value={value ?? ''} options={opts} onValueChange={(v) => onPick(v === '' ? null : v)} className={aside} />;
}

/** The people a project task may be given to: the project's members. */
export function MemberPick({ label, value, name, members, access, onPick }: { label: string; value: number | null; name: string | null; members: Array<{ user_id: number; name: string }>; access: { ok: boolean; reason: string | null }; onPick: (v: number | null) => void }) {
  return <Pick label={label} value={value} current={name} none="Nobody" options={members.map((m) => ({ id: m.user_id, label: m.name }))} access={access} onPick={onPick} />;
}

/** Side panel › Project (PRJ-TED-03): Project (read-only), Type, Sprint, Milestone, Parent, Points, Estimate, Billable, and the blocked reason while blocked. */
export function ProjectFields({ data, status, sprints, milestones, tasks, access, save }: {
  data: EditorData;
  status: TaskStatus;
  sprints: Array<{ id: number; name: string }>;
  milestones: Array<{ id: number; name: string }>;
  tasks: Task[];
  access: Access;
  save: Save;
}) {
  const p = data.project;
  const title = data.task.title;
  const parents = tasks.filter((t) => t.id !== data.task.id).map((t) => ({ id: t.id, label: `${t.task_number ?? `#${t.id}`} · ${t.title}` }));
  return (
    <>
      <GroupHead>Project</GroupHead>
      <Row label="Project">
        <span className={readOnly} title="A task’s project changes with Move to another project…">
          {[p.code, p.name].filter(Boolean).join(' · ') || '—'}
        </span>
      </Row>
      <Row label="Type">
        <Select aria-label="Type" disabled={!access('task_type').ok} title={access('task_type').reason ?? undefined} value={p.task_type} onChange={(e) => save('task_type', e.target.value, `Type of “${title}”`)} className={aside}>
          <option value="task">Task</option>
          <option value="bug">Bug</option>
          <option value="story">Story</option>
          <option value="chore">Chore</option>
        </Select>
      </Row>
      <Row label="Sprint">
        <Pick label="Sprint" value={p.sprint_id} current={p.sprint} none="No sprint" options={sprints.map((s) => ({ id: s.id, label: s.name }))} access={access('sprint_id')} onPick={(v) => save('sprint_id', v, `Sprint of “${title}”`)} />
      </Row>
      <Row label="Milestone">
        <Pick label="Milestone" value={p.milestone_id} current={p.milestone} none="No milestone" options={milestones.map((m) => ({ id: m.id, label: m.name }))} access={access('milestone_id')} onPick={(v) => save('milestone_id', v, `Milestone of “${title}”`)} />
      </Row>
      <Row label="Parent">
        <Pick label="Parent" value={p.parent_id} current={p.parent} none="None" options={parents} access={access('parent_id')} onPick={(v) => save('parent_id', v, `Parent of “${title}”`)} />
      </Row>
      <Row label="Points">
        <NumberField key={`p${p.story_points}`} label="Points" value={p.story_points} step={1} access={access('story_points')} onSave={(v) => save('story_points', v, `Points of “${title}”`)} />
      </Row>
      <Row label="Estimate">
        <NumberField key={`e${p.estimated_hours}`} label="Estimate" value={p.estimated_hours} step={0.25} suffix="h" access={access('estimated_hours')} onSave={(v) => save('estimated_hours', v, `Estimate of “${title}”`)} />
      </Row>
      <Row label="Billable">
        <label className="flex items-center gap-2 text-ink" title={access('is_billable').reason ?? undefined}>
          <Checkbox aria-label="Billable" checked={p.is_billable} disabled={!access('is_billable').ok} onChange={(e) => save('is_billable', e.target.checked, `Billing of “${title}”`)} />
          Billable
        </label>
      </Row>
      {status === 'blocked' ? (
        <Row label="Blocked by">
          <TextField key={`b${p.blocked_reason}`} label="Blocked reason" value={p.blocked_reason} access={access('blocked_reason')} onSave={(v) => save('blocked_reason', v, `Why “${title}” is blocked`)} />
        </Row>
      ) : null}
    </>
  );
}

/**
 * Dependencies (PRJ-TED-04): what this task waits on and what it blocks, each with its status; Add picks a task of
 * the same project. A loop is refused — here when it is plain from the two lists, else by the server, whose
 * sentence names the tasks.
 */
export function Dependencies({ data, tasks, access, onChanged }: { data: EditorData; tasks: Task[]; access: { ok: boolean; reason: string | null }; onChanged: () => void }) {
  const p = data.project;
  const me = data.task.id;
  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState<'waits_on' | 'blocks'>('waits_on');
  const [other, setOther] = useState<number | ''>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const linked = new Set([...p.dependencies.waits_on, ...p.dependencies.blocks].map((d) => d.task_id));
  const choices = tasks.filter((t) => t.id !== me && !linked.has(t.id)).map((t) => ({ value: t.id as number | '', label: `${t.task_number ?? `#${t.id}`} · ${t.title}` }));
  const self = p.task_number ?? `#${me}`;
  const add = async () => {
    if (other === '') return;
    setError(null);
    const target = tasks.find((t) => t.id === other);
    const name = target?.task_number ?? `#${other}`;
    const loop = loopOf(p, kind, other);
    if (loop) return setError(`${kind === 'waits_on' ? `${self} waiting on ${name}` : `${self} blocking ${name}`} would close a loop (${loop === 'blocks' ? `${self} → ${name} → ${self}` : `${name} → ${self} → ${name}`}) — not allowed.`);
    setBusy(true);
    try {
      if (kind === 'waits_on') await apiPost(`${API}/tasks/${me}/dependencies`, { depends_on_id: other });
      else await apiPost(`${API}/tasks/${other}/dependencies`, { depends_on_id: me });
      setAdding(false);
      setOther('');
      onChanged();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const remove = async (d: Dep, side: 'waits_on' | 'blocks') => {
    try {
      if (side === 'waits_on') await apiDelete(`${API}/tasks/${me}/dependencies/${d.id ?? d.task_id}`);
      else await apiDelete(`${API}/tasks/${d.task_id}/dependencies/${d.id ?? me}`);
      onChanged();
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  const rows = [...p.dependencies.waits_on.map((d) => ['waits_on', d] as const), ...p.dependencies.blocks.map((d) => ['blocks', d] as const)];
  return (
    <Section
      title="Dependencies"
      extra={
        <button type="button" disabled={!access.ok} title={access.reason ?? undefined} onClick={() => (setAdding(!adding), setError(null))} className="font-semibold text-primary enabled:hover:underline disabled:text-ink-3">
          + Add
        </button>
      }
    >
      {!rows.length && !adding ? <span className="text-[12px] text-ink-3">Waits on nothing and blocks nothing.</span> : null}
      {rows.map(([side, d]) => (
        <div key={`${side}${d.task_id}`} className="group flex items-center gap-2 py-0.5">
          <span className="w-[62px] shrink-0 text-[12px] text-ink-3">{side === 'waits_on' ? 'Waits on' : 'Blocks'}</span>
          <Ref>{d.task_number ?? `#${d.task_id}`}</Ref>
          <span className="min-w-0 flex-1 truncate text-ink">{d.title}</span>
          <StatusChip status={d.status} />
          {access.ok ? (
            <button type="button" aria-label={`Remove ${side === 'waits_on' ? 'waits on' : 'blocks'} ${d.task_number ?? d.title}`} onClick={() => void remove(d, side)} className="invisible px-1 text-ink-3 group-hover:visible hover:text-danger">
              ×
            </button>
          ) : null}
        </div>
      ))}
      {adding ? (
        <div className="flex flex-wrap items-center gap-2 rounded-[9px] border border-line p-2">
          <Select<'waits_on' | 'blocks'> aria-label="Dependency kind" value={kind} onValueChange={setKind} options={[{ value: 'waits_on', label: 'Waits on' }, { value: 'blocks', label: 'Blocks' }]} className={cx(aside, 'w-[110px]')} />
          <Select<number | ''> aria-label="Task on this project" searchable value={other} onValueChange={setOther} options={[{ value: '', label: choices.length ? 'Choose a task…' : 'No other task on this project' }, ...choices]} className={cx(aside, 'min-w-[220px] flex-1')} />
          <Button size="sm" variant="primary" loading={busy} disabled={other === ''} onClick={() => void add()}>
            Add
          </Button>
          <Button size="sm" onClick={() => (setAdding(false), setError(null))}>
            Cancel
          </Button>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="rounded-[8px] bg-danger-bg px-2.5 py-1.5 text-[12px] text-danger">
          {error}
        </p>
      ) : null}
    </Section>
  );
}

/** A loop the two lists already show: waiting on a task this one blocks, or blocking one it waits on. */
export function loopOf(p: Pick<ProjectBlock, 'dependencies'>, kind: 'waits_on' | 'blocks', other: number): 'waits_on' | 'blocks' | null {
  if (kind === 'waits_on' && p.dependencies.blocks.some((d) => d.task_id === other)) return 'blocks';
  if (kind === 'blocks' && p.dependencies.waits_on.some((d) => d.task_id === other)) return 'waits_on';
  return null;
}

/**
 * Time (PRJ-TED-04): logged against the estimate, Start timer and Log time, and the entries with their state —
 * Pending, Approved, Sent back, Invoiced — and a lock when they can no longer change.
 */
export function TaskTime({ data, running, startedAt, offline, onTimer, onLog }: { data: EditorData; running: boolean; startedAt: string | null; offline: boolean; onTimer: () => void; onLog: () => void }) {
  const now = useNow(running ? 1000 : 60_000).getTime();
  const t = data.project.time;
  const over = t.estimate_minutes !== null && t.minutes > t.estimate_minutes;
  const entries = useMemo(() => t.entries.slice(0, 50), [t.entries]);
  return (
    <Section
      title={
        <>
          Time{' '}
          <span className={cx('font-normal', over ? 'font-semibold text-danger' : 'text-ink-3')}>
            {hhmm(t.minutes)}
            {t.estimate_minutes !== null ? ` of ${Math.round((t.estimate_minutes / 60) * 100) / 100} h` : ' logged'}
          </span>
        </>
      }
      extra={
        <>
          <Button size="sm" variant={running ? 'danger' : 'primary'} icon={running ? 'stop' : 'play'} disabled={!running && offline} title={!running && offline ? 'Needs a connection' : 'T'} onClick={onTimer}>
            {running && startedAt ? `Stop ${clockOf(elapsedOf(startedAt, now))}` : 'Start timer'}
          </Button>
          <Button size="sm" icon="clock" title="L" onClick={onLog}>
            Log time
          </Button>
        </>
      }
    >
      {!entries.length ? <span className="text-[12px] text-ink-3">No time logged on this task yet.</span> : null}
      {entries.map((e) => {
        const s = entryState(e);
        return (
          <div key={e.id} className="flex items-center gap-2 py-0.5 text-[12.5px]">
            <span className="w-[52px] shrink-0 text-ink-3">{shortDay(e.on_date)}</span>
            <span className="min-w-0 flex-1 truncate text-ink">
              {e.user}
              {e.note ? <span className="text-ink-3"> · {e.note}</span> : null}
            </span>
            <span className="font-mono font-semibold text-ink">{e.running ? 'running' : hhmm(e.minutes)}</span>
            <span className={cx('rounded-full px-2 py-px text-[11px] font-semibold whitespace-nowrap', s.key === 'approved' ? 'bg-success-bg text-success' : s.key === 'sent_back' ? 'bg-danger-bg text-danger' : s.key === 'pending' || s.key === 'running' ? 'bg-warning-bg text-warning-ink' : 'bg-subtle text-ink-2')}>{s.label}</span>
            {s.locked ? <Icon name="lock" size={12} className="text-ink-3" label="Locked" /> : <span className="w-3" />}
          </div>
        );
      })}
    </Section>
  );
}

/** Pick a task or a project (Convert to sub-task of…, Move to another project…); a refusal stays in the dialog. */
export function PickDialog({ title, label, confirm, options, onPick, onClose }: { title: string; label: string; confirm: string; options: Array<{ value: number; label: string }>; onPick: (id: number) => Promise<void>; onClose: () => void }) {
  const [v, setV] = useState<number | ''>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const go = async () => {
    if (v === '') return;
    setBusy(true);
    setError(null);
    try {
      await onPick(v);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };
  return (
    <Modal
      title={title}
      onClose={onClose}
      width={460}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={v === ''} onClick={() => void go()}>
            {confirm}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-2 text-[13px]">
        <Select<number | ''> aria-label={label} searchable value={v} onValueChange={setV} options={[{ value: '', label: options.length ? 'Choose…' : 'Nothing to choose' }, ...options]} className={cx(aside, 'w-full')} />
        {error ? (
          <p role="alert" className="rounded-[8px] bg-danger-bg px-2.5 py-1.5 text-[12px] text-danger">
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

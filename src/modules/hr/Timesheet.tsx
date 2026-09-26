import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { apiDelete, apiGet, apiPost, apiPut } from '../../core/api';
import { errorMessage } from '../../core/bridge';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import type { LogsResponse, Sheet as TimesheetRow, TimeLog } from './api';
import { addDays, dayShort, hoursLabel, monthLabel, parseYmd, rangeLabel, weekDays, weekStart, ymd } from './dates';
import { btn, btnPrimary, Cell, Empty, Field, input, Kpi, PageHead, Panel, row, Seg, Sheet, StatusChip, THead } from './parts';

/**
 * Timesheet (HrTimesheet): what I worked on — day, week or month — as work
 * logs by day, with the totals by project and by task, and the week sent for
 * approval. A week that was sent back says why; a submitted one is locked.
 */
type View = 'day' | 'week' | 'month';

function rangeFor(view: View, anchor: string): { from: string; to: string } {
  if (view === 'day') return { from: anchor, to: anchor };
  if (view === 'week') return { from: weekStart(anchor), to: addDays(weekStart(anchor), 6) };
  const first = `${anchor.slice(0, 7)}-01`;
  const d = parseYmd(first);
  return { from: first, to: ymd(new Date(d.getFullYear(), d.getMonth() + 1, 0, 12)) };
}

export default function Timesheet() {
  const qc = useQueryClient();
  const today = ymd(new Date());
  const [view, setView] = useState<View>('week');
  const [anchor, setAnchor] = useState(today);
  const [editing, setEditing] = useState<{ log: TimeLog | null; on: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const { from, to } = rangeFor(view, anchor);
  const logs = useQuery({ queryKey: ['hr', 'time-logs', from, to], queryFn: ({ signal }) => apiGet<LogsResponse>('/api/hr/time-logs', { from, to }, signal) });
  const sheets = useQuery({ queryKey: ['hr', 'timesheets'], queryFn: ({ signal }) => apiGet<TimesheetRow[]>('/api/hr/timesheets', undefined, signal) });
  const sheet = (sheets.data ?? []).find((s) => s.starts_on <= from && s.ends_on >= to) ?? null;
  const locked = !!sheet && ['submitted', 'approved', 'locked'].includes(sheet.status);
  const data = logs.data;

  const move = (n: number) => setAnchor(view === 'day' ? addDays(anchor, n) : view === 'week' ? addDays(anchor, n * 7) : ymd(new Date(parseYmd(anchor).getFullYear(), parseYmd(anchor).getMonth() + n, 1, 12)));
  const title = view === 'day' ? dayShort(from) : view === 'week' ? `Week of ${rangeLabel(from, to)} ${parseYmd(to).getFullYear()}` : monthLabel(from);

  // The days drawn: the working week (and a weekend day that has work), every day of a month that has work.
  const byDay = new Map<string, TimeLog[]>();
  for (const l of data?.logs ?? []) byDay.set(l.on_date, [...(byDay.get(l.on_date) ?? []), l]);
  const days = view === 'day' ? [from] : view === 'week' ? weekDays(from).filter((d, i) => i < 5 || byDay.has(d)) : [...byDay.keys()].sort();

  const submit = async () => {
    setBusy(true);
    try {
      let id = sheet?.id;
      if (!id) {
        const made = await apiPost<{ id: number }>('/api/hr/timesheets', { starts_on: from });
        id = made.id;
      }
      await apiPost(`/api/hr/timesheets/${id}/submit`, {});
      toast('success', 'Submitted for approval.');
      void qc.invalidateQueries({ queryKey: ['hr'] });
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3.5">
      <PageHead title="Timesheet" sub={title}>
        <button type="button" className={btn} aria-label="Earlier" onClick={() => move(-1)}>
          ←
        </button>
        <Seg label="Period" value={view} onChange={(v) => setView(v)} options={[{ id: 'day', label: 'Day' }, { id: 'week', label: 'Week' }, { id: 'month', label: 'Month' }]} />
        <button type="button" className={btn} aria-label="Later" onClick={() => move(1)}>
          →
        </button>
        {anchor !== today ? (
          <button type="button" className={btn} onClick={() => setAnchor(today)}>
            Today
          </button>
        ) : null}
        <button type="button" className={btn} disabled={locked} onClick={() => setEditing({ log: null, on: from <= today && today <= to ? today : from })}>
          Add work log
        </button>
        {view === 'week' ? (
          locked ? (
            <StatusChip className="!h-[34px] !rounded-[8px] !px-3 !text-[12.5px]">{sheet!.status === 'submitted' ? 'Waiting for approval' : sheet!.status === 'approved' ? 'Approved' : 'Locked'}</StatusChip>
          ) : (
            <button type="button" className={btnPrimary} disabled={busy || !data?.totals.entries} onClick={() => void submit()}>
              Submit week
            </button>
          )
        ) : null}
      </PageHead>
      {sheet?.status === 'rejected' ? (
        <div className="rounded-[9px] border border-[#F6D9A8] bg-[#FFF4E0] px-3 py-2.5 font-semibold text-[#6B3A06] dark:border-warning/30 dark:bg-warning-bg dark:text-warning">
          Sent back{sheet.decided_by ? ` by ${sheet.decided_by}` : ''}
          {sheet.decision_note ? `: “${sheet.decision_note}”` : '.'} Change it and submit the week again.
        </div>
      ) : null}
      <div className="grid grid-cols-3 gap-2.5">
        <Kpi label="Logged" value={data ? `${hoursLabel(data.totals.minutes / 60).replace('h', ' h')}` : '—'} />
        <Kpi label="Billable" value={data ? `${hoursLabel(data.totals.billable_minutes / 60).replace('h', ' h')}` : '—'} />
        <Kpi label="Entries" value={data?.totals.entries ?? '—'} />
      </div>
      {logs.isLoading ? <Spinner /> : logs.error ? <ErrorNote error={logs.error} onRetry={() => void logs.refetch()} /> : null}
      {data ? (
        <div className="grid min-h-0 flex-1 grid-cols-[2.2fr_1fr] gap-3">
          <div className={cx('grid content-start gap-2', view === 'day' ? 'grid-cols-1' : view === 'week' ? 'grid-cols-5' : 'grid-cols-[repeat(auto-fill,minmax(180px,1fr))]', view === 'week' && days.length > 5 && 'grid-cols-7')}>
            {view === 'month' && !days.length ? <div className="col-span-full"><Empty text="Nothing logged this month." /></div> : null}
            {days.map((d) => {
              const list = byDay.get(d) ?? [];
              const minutes = list.reduce((n, l) => n + l.minutes, 0);
              return (
                <div key={d} className={cx('group flex flex-col overflow-hidden rounded-[12px] border bg-surface', d === today ? 'border-primary/50' : 'border-line')}>
                  <div className="flex items-center border-b border-line px-2.5 py-2">
                    <b className="min-w-0 flex-1 truncate whitespace-nowrap text-ink">{parseYmd(d).toLocaleDateString([], { weekday: 'short', day: 'numeric' })}</b>
                    <span className="font-bold text-primary">{hoursLabel(minutes / 60)}</span>
                  </div>
                  {list.map((l) => (
                    <button key={l.id} type="button" disabled={locked || l.locked} onClick={() => setEditing({ log: l, on: l.on_date })} className="flex flex-col gap-0.5 border-b border-line/70 px-2.5 py-2 text-left hover:bg-subtle disabled:cursor-default disabled:hover:bg-transparent">
                      <b className="text-[12.5px] text-ink">{l.description}</b>
                      <span className="text-[11.5px] text-ink-3">
                        {[l.project ?? 'No project', l.task, !l.billable ? 'non-billable' : null, l.invoiced ? 'invoiced' : l.approved ? 'approved for billing' : null].filter(Boolean).join(' · ')}
                      </span>
                      <span className="text-[11.5px] font-bold text-ink">{hoursLabel(l.minutes / 60)}</span>
                    </button>
                  ))}
                  {!list.length ? <span className="px-2.5 py-2 text-[12px] text-ink-3">Nothing logged.</span> : null}
                  {!locked && d <= today ? (
                    <button type="button" onClick={() => setEditing({ log: null, on: d })} className="flex items-center gap-1 px-2.5 py-1.5 text-left text-[12px] font-semibold text-primary opacity-0 group-hover:opacity-100 focus:opacity-100">
                      <Icon name="plus" size={13} /> Add
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
          <div className="flex flex-col gap-3">
            <Panel title="By project">
              <THead cols={[['Project', null], ['Hours', 60]]} />
              {data.by_project.length ? data.by_project.map((p) => (
                <div key={String(p.id)} className={row}>
                  <Cell w={null}>{p.label}</Cell>
                  <Cell w={60} className="font-semibold">{hoursLabel(p.minutes / 60)}</Cell>
                </div>
              )) : <Empty text="Nothing yet." />}
            </Panel>
            <Panel title="By task">
              <THead cols={[['Task', null], ['Hours', 60]]} />
              {data.by_task.length ? data.by_task.map((p) => (
                <div key={String(p.id)} className={row}>
                  <Cell w={null}>{p.label}</Cell>
                  <Cell w={60} className="font-semibold">{hoursLabel(p.minutes / 60)}</Cell>
                </div>
              )) : <Empty text="Nothing yet." />}
            </Panel>
          </div>
        </div>
      ) : null}
      {editing ? <WorkLog log={editing.log} onDate={editing.on} onClose={() => setEditing(null)} onDone={() => (setEditing(null), void qc.invalidateQueries({ queryKey: ['hr', 'time-logs'] }))} /> : null}
    </div>
  );
}

/** Minutes between two "HH:MM" times, or null. */
export function spanMinutes(start: string, end: string): number | null {
  const a = /^(\d{1,2}):(\d{2})$/.exec(start);
  const b = /^(\d{1,2}):(\d{2})$/.exec(end);
  if (!a || !b) return null;
  const m = +b[1]! * 60 + +b[2]! - (+a[1]! * 60 + +a[2]!);
  return m > 0 ? m : null;
}

function WorkLog({ log, onDate, onClose, onDone }: { log: TimeLog | null; onDate: string; onClose: () => void; onDone: () => void }) {
  const targets = useQuery({ queryKey: ['hr', 'time-targets'], queryFn: ({ signal }) => apiGet<{ projects: Array<{ id: number; name: string; code: string }>; tasks: Array<{ id: number; title: string; task_number: string | null; project_id: number | null }> }>('/api/hr/time-logs/targets', undefined, signal) });
  const hm = (s: string | null) => (s ? (/(\d{2}:\d{2})/.exec(s)?.[1] ?? '') : '');
  const [date, setDate] = useState(log?.on_date ?? onDate);
  const [project, setProject] = useState(log?.project_id ? String(log.project_id) : '');
  const [task, setTask] = useState(log?.task_id ? String(log.task_id) : '');
  const [description, setDescription] = useState(log?.description ?? '');
  const [start, setStart] = useState(hm(log?.started_at ?? null));
  const [end, setEnd] = useState(hm(log?.ended_at ?? null));
  const [hours, setHours] = useState(log ? String(Math.round((log.minutes / 60) * 100) / 100) : '');
  const [billable, setBillable] = useState(log?.billable ?? true);
  const [busy, setBusy] = useState(false);
  const derived = spanMinutes(start, end);
  const tasks = (targets.data?.tasks ?? []).filter((t) => !project || t.project_id === Number(project));

  const save = async () => {
    if (!description.trim()) return toast('error', 'Say what the time was spent on.');
    const minutes = derived ?? Math.round(parseFloat(hours || '0') * 60);
    if (!minutes || minutes <= 0) return toast('error', 'Give a duration, or a start and end time.');
    setBusy(true);
    const body = { on_date: date, project_id: project ? Number(project) : null, task_id: task ? Number(task) : null, description: description.trim(), started_at: start || null, ended_at: end || null, minutes, billable };
    try {
      if (log) await apiPut(`/api/hr/time-logs/${log.id}`, body);
      else await apiPost('/api/hr/time-logs', body);
      toast('success', log ? 'Saved.' : 'Time logged.');
      onDone();
    } catch (e) {
      toast('error', errorMessage(e));
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!log) return;
    setBusy(true);
    try {
      await apiDelete(`/api/hr/time-logs/${log.id}`);
      toast('success', 'Removed.');
      onDone();
    } catch (e) {
      toast('error', errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <Sheet
      title={log ? 'Work log' : 'Add work log'}
      onClose={onClose}
      footer={
        <>
          {log ? (
            <button type="button" disabled={busy} className={btn + ' mr-auto !text-danger'} onClick={() => void remove()}>
              Delete
            </button>
          ) : null}
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" disabled={busy} className={btnPrimary} onClick={() => void save()}>
            Save
          </button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-2.5">
        <Field label="Date">
          <input type="date" aria-label="Date" max={ymd(new Date())} value={date} onChange={(e) => setDate(e.target.value)} className={input} />
        </Field>
        <Field label="Project">
          <select aria-label="Project" value={project} onChange={(e) => (setProject(e.target.value), setTask(''))} className={input}>
            <option value="">No project</option>
            {(targets.data?.projects ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="Task" hint="Your open tasks in the chosen project.">
        <select aria-label="Task" value={task} onChange={(e) => setTask(e.target.value)} className={input}>
          <option value="">No task</option>
          {tasks.map((t) => (
            <option key={t.id} value={t.id}>
              {t.task_number ? `${t.task_number} · ` : ''}
              {t.title}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Description">
        <input aria-label="Description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Fix login redirect bug" className={input} />
      </Field>
      <div className="grid grid-cols-3 gap-2">
        <Field label="Start">
          <input type="time" aria-label="Start" value={start} onChange={(e) => setStart(e.target.value)} className={input} />
        </Field>
        <Field label="End">
          <input type="time" aria-label="End" value={end} onChange={(e) => setEnd(e.target.value)} className={input} />
        </Field>
        <Field label="Hours">
          <input aria-label="Hours" inputMode="decimal" value={derived != null ? String(Math.round((derived / 60) * 100) / 100) : hours} disabled={derived != null} onChange={(e) => setHours(e.target.value)} className={input} />
        </Field>
      </div>
      <label className="flex items-center gap-2 font-semibold text-ink">
        <input type="checkbox" checked={billable} onChange={(e) => setBillable(e.target.checked)} className="accent-[var(--color-primary)]" />
        Billable
      </label>
    </Sheet>
  );
}

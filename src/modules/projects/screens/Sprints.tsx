import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { errorMessage } from '../../../core/bridge';
import { todayInZone } from '../../../core/time';
import { toast } from '../../../core/toasts';
import { Select } from '../../../components/Select';
import { Button, ErrorNote, Modal, Spinner, cx } from '../../../components/ui';
import { qk, type Can } from '../api';
import { useProjectCompany } from '../company';
import { FORECAST, SPRINT_STATUS, dqk, dread, dwrite, fmtDay, fmtRange, num, type Sprint, type SprintDetail } from '../delivery';
import { StatusChip, openWeb } from '../parts';
import { ChartTable, Chip, Confirm, Field, Mono, NEEDS_CONNECTION, PageHead, ProjectPick, areaClass, inputClass, useLiveProjects, useReportOffline } from './kit';

/**
 * W09 · Sprints (PRJ-SPR), in the desktop: the sprints on the left, one open on the right — committed at start vs
 * added since, done, remaining and the forecast; the burndown (from when tasks were finished, against a straight
 * ideal over the working days) and velocity, both drawn with their figures in a table for screen readers (NFR-08);
 * the sprint backlog. Plan a sprint, edit it, start it, cancel it, delete a planned one, and complete it with a
 * retrospective and where the unfinished tasks are carried over to (the next planned sprint, or the backlog).
 *
 * Every change needs WorkSuite: offline the kept copy is shown and the actions wait for a connection.
 */

export function SprintsScreen({ projectId, sprintId, offline, onGo, onOpenTask, onOffline }: { projectId: number | null; sprintId: number | null; offline: boolean; onGo: (route: string) => void; onOpenTask: (id: number) => void; onOffline: (o: boolean) => void }) {
  const qc = useQueryClient();
  useProjectCompany();
  const [filter, setFilter] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const pid = projectId ?? filter;
  const params = { project_id: pid };
  const list = useQuery({ queryKey: dqk.sprints(params), queryFn: ({ signal }) => dread.sprints(params, { signal }) });
  useReportOffline(!!list.data?.offline, onOffline);
  const sprints = list.data?.data.sprints ?? [];
  const can = (list.data?.data.can ?? {}) as Can;
  const fallback = sprints.find((s) => s.status === 'active') ?? sprints[0];
  const selected = sprintId ?? fallback?.id ?? null;
  const base = projectId ? `/projects/${projectId}/sprints` : '/projects/sprints';
  const select = (id: number) => onGo(`${base}/${id}`);

  return (
    <div className="flex min-h-0 flex-1">
      <aside className="flex w-[260px] shrink-0 flex-col border-r border-line">
        <div className="flex flex-col gap-2 px-4 pt-4 pb-2">
          <div className="flex items-center gap-2">
            <h1 className="flex-1 text-[18px] font-bold text-ink">Sprints</h1>
            {can.manage ? (
              <Button size="sm" icon="plus" aria-label="New sprint" disabled={offline} title={offline ? NEEDS_CONNECTION : 'Plan a sprint'} onClick={() => setCreating(true)}>
                New
              </Button>
            ) : null}
          </div>
          {!projectId ? <ProjectPick value={filter} onChange={setFilter} /> : null}
        </div>
        <nav aria-label="Sprints" className="flex min-h-0 flex-1 flex-col overflow-y-auto scroll-thin">
          {list.isLoading ? <Spinner /> : null}
          {list.error && !list.data ? <ErrorNote error={list.error} onRetry={() => void list.refetch()} /> : null}
          {list.data && !sprints.length ? <p className="px-4 py-3 text-[12.5px] text-ink-3">No sprints yet.</p> : null}
          {sprints.map((s) => {
            const on = s.id === selected;
            const st = SPRINT_STATUS[s.status] ?? SPRINT_STATUS.planned;
            const pts = s.status === 'completed' ? `${s.done_points} of ${s.committed_points}` : `${s.total_points} pts`;
            return (
              <button key={s.id} type="button" aria-current={on ? 'true' : undefined} onClick={() => select(s.id)} className={cx('flex flex-col gap-0.5 px-4 py-2 text-left hover:bg-subtle', on && 'bg-selection shadow-[inset_3px_0_0_var(--color-primary)]')}>
                <span className="flex items-center gap-1.5">
                  <b className="flex-1 truncate text-[13px] text-ink">{s.name}</b>
                  <Chip tone={st.tone}>{st.label}</Chip>
                </span>
                <span className="text-[11.5px] text-ink-3">
                  {!pid ? <Mono>{s.project_code} · </Mono> : null}
                  {fmtRange(s.start_date, s.end_date)} · {pts}
                </span>
              </button>
            );
          })}
        </nav>
      </aside>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {selected ? <SprintView key={selected} id={selected} offline={offline} base={base} onGo={onGo} onOpenTask={onOpenTask} /> : list.data ? <p className="px-5 py-6 text-ink-3">Choose a sprint, or plan one with New.</p> : null}
      </div>
      {creating ? (
        <SprintDialog
          sprint={null}
          projectId={pid}
          onClose={() => setCreating(false)}
          onSaved={(id) => {
            setCreating(false);
            void qc.invalidateQueries({ queryKey: ['projects', 'sprints'] });
            if (id) select(id);
          }}
        />
      ) : null}
    </div>
  );
}

function SprintView({ id, offline, base, onGo, onOpenTask }: { id: number; offline: boolean; base: string; onGo: (route: string) => void; onOpenTask: (id: number) => void }) {
  const qc = useQueryClient();
  const [completing, setCompleting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [asking, setAsking] = useState<'cancel' | 'delete' | null>(null);
  const [busy, setBusy] = useState(false);
  const q = useQuery({ queryKey: dqk.sprint(id), queryFn: ({ signal }) => dread.sprint(id, { signal }) });
  const refresh = () => {
    for (const k of [['projects', 'sprints'], ['projects', 'sprint'], ['projects', 'tasks'], qk.counts]) void qc.invalidateQueries({ queryKey: k });
  };
  const setStatus = async (body: { status: string; retrospective?: string; move_to_sprint_id?: number | null }) => {
    setBusy(true);
    try {
      await dwrite.sprintStatus(id, body);
      setCompleting(false);
      setAsking(null);
      toast('success', body.status === 'active' ? 'Sprint started.' : body.status === 'completed' ? 'Sprint completed.' : 'Sprint cancelled.');
      refresh();
    } catch (e) {
      // G-19: a second active sprint, or completing one twice, is refused — say why.
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    setBusy(true);
    try {
      await dwrite.deleteSprint(id);
      toast('success', 'Sprint deleted.');
      setAsking(null);
      void qc.invalidateQueries({ queryKey: ['projects', 'sprints'] });
      onGo(base);
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (q.isLoading) return <Spinner />;
  const d = q.data?.data;
  if (!d?.sprint) return q.error ? <ErrorNote error={q.error} onRetry={() => void q.refetch()} /> : <p className="px-5 py-6 text-ink-3">That sprint is not there any more.</p>;
  const { sprint: s, tasks, velocity, forecast, day_of, can } = d;
  const manage = !!can?.manage;
  const live = s.status === 'planned' || s.status === 'active';
  const off = offline ? NEEDS_CONNECTION : undefined;
  const st = SPRINT_STATUS[s.status] ?? SPRINT_STATUS.planned;
  const fc = FORECAST[forecast.label] ?? FORECAST.not_started;
  const remaining = Math.max(0, s.total_points - s.done_points);
  const tile = (label: string, value: string | number, sub: string, tone = 'text-ink') => (
    <div className="flex flex-col gap-0.5 rounded-[12px] border border-line bg-surface px-3.5 py-2.5">
      <span className="text-[11.5px] font-semibold text-ink-3">{label}</span>
      <b className={cx('text-[20px]', tone)}>{value}</b>
      <span className="text-[11.5px] text-ink-3">{sub}</span>
    </div>
  );

  return (
    <>
      <PageHead
        crumb={`${s.project_code} · ${fmtRange(s.start_date, s.end_date)}${day_of ? ` · day ${day_of.day} of ${day_of.of}` : ''}`}
        title={`${s.name}${s.goal ? ` — ${s.goal}` : ''}`}
        chips={<Chip tone={st.tone}>{st.label}</Chip>}
        actions={
          <>
            <Button size="sm" icon="kanban" onClick={() => onGo(`/projects/${s.project_id}`)}>
              Open board
            </Button>
            {manage && live ? (
              <Button size="sm" disabled={offline} title={off} onClick={() => setEditing(true)}>
                Edit
              </Button>
            ) : null}
            {manage && s.status === 'planned' ? (
              <Button size="sm" variant="danger" disabled={offline} title={off} onClick={() => setAsking('delete')}>
                Delete
              </Button>
            ) : null}
            {manage && live ? (
              <Button size="sm" variant="ghost" disabled={offline} title={off} onClick={() => setAsking('cancel')}>
                Cancel sprint
              </Button>
            ) : null}
            {manage && s.status === 'planned' ? (
              <Button size="sm" variant="primary" icon="play" loading={busy} disabled={offline} title={off} onClick={() => void setStatus({ status: 'active' })}>
                Start sprint
              </Button>
            ) : null}
            {manage && s.status === 'active' ? (
              <Button size="sm" variant="primary" disabled={offline} title={off} onClick={() => setCompleting(true)}>
                Complete sprint…
              </Button>
            ) : null}
            <Button size="sm" icon="external" onClick={() => openWeb(`/projects/sprints/${s.id}`)}>
              Open on the web
            </Button>
          </>
        }
      />
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 py-4 scroll-thin">
        {offline && manage ? <p className="text-[12px] text-warning-ink">Planning, starting and completing sprints wait for a connection.</p> : null}
        <section aria-label="Sprint figures" className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2.5">
          {tile('Committed at start', s.committed_points, s.started_at ? `frozen ${fmtDay(s.started_at)}` : 'frozen when it starts')}
          {tile('Now in sprint', s.total_points, `${s.added_points >= 0 ? '+' : '−'}${Math.abs(s.added_points)} added`)}
          {tile('Done', s.done_points, `${s.done_tasks} of ${s.total_tasks} tasks`)}
          {tile('Remaining', remaining, forecast.ideal_today !== null ? `ideal today ${num(forecast.ideal_today, 1)}` : '—')}
          {tile('Forecast', fc.label, forecast.needs_per_day !== null ? `needs ${num(forecast.needs_per_day, 1)} pts / day` : '—', fc.tone)}
        </section>
        <div className="grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] gap-3">
          <section className="flex flex-col gap-1.5 rounded-[12px] border border-line bg-surface px-4 py-3">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <h2 className="text-[13.5px] font-bold text-ink">Burndown</h2>
              <span className="text-[11.5px] text-ink-3">points remaining, from when tasks were finished</span>
              <span aria-hidden className="ml-auto flex gap-2.5 text-[11.5px] text-ink-2">
                <span>
                  <span className="inline-block h-[3px] w-3.5 bg-primary align-middle" /> Actual
                </span>
                <span>
                  <span className="inline-block w-3.5 border-t-2 border-dashed border-ink-3 align-middle" /> Ideal
                </span>
              </span>
            </div>
            <Burndown sprint={s} />
          </section>
          <section className="flex flex-col gap-1.5 rounded-[12px] border border-line bg-surface px-4 py-3">
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
              <h2 className="text-[13.5px] font-bold text-ink">Velocity</h2>
              <span className="text-[11.5px] text-ink-3">average {num(velocity.average, 1)} delivered</span>
              <span aria-hidden className="ml-auto flex gap-2.5 text-[11.5px] text-ink-2">
                <span>
                  <span className="inline-block h-2.5 w-2.5 rounded-sm bg-ink-3/40" /> Committed
                </span>
                <span>
                  <span className="inline-block h-2.5 w-2.5 rounded-sm bg-primary" /> Delivered
                </span>
              </span>
            </div>
            <Velocity data={velocity} currentId={s.id} />
          </section>
        </div>
        <section className="overflow-hidden rounded-[12px] border border-line bg-surface">
          <div className="flex items-baseline gap-2 border-b border-line px-3.5 py-2">
            <h2 className="text-[13.5px] font-bold text-ink">Sprint backlog</h2>
            <span className="text-[12px] text-ink-3">
              {s.total_tasks} tasks · {s.total_points} pts{s.added_points > 0 ? ` · ${s.added_points} pts added after start` : ''}
            </span>
          </div>
          {!tasks.length ? (
            <p className="px-3.5 py-4 text-ink-3">No tasks in this sprint yet. Plan them from the board.</p>
          ) : (
            <ul>
              {tasks.map((t) => (
                <li key={t.id} className="grid grid-cols-[90px_minmax(0,1fr)_160px_110px_44px] items-center gap-2 border-b border-line/60 px-3.5 py-1.5 text-[12.5px] last:border-b-0">
                  <Mono className="text-[11px] text-ink-3">{t.task_number ?? '—'}</Mono>
                  <button type="button" onClick={() => onOpenTask(t.id)} className="truncate text-left font-semibold text-ink hover:text-primary hover:underline">
                    {t.title}
                  </button>
                  <span className="truncate text-ink-2">{t.assignee ?? 'Unassigned'}</span>
                  <StatusChip status={t.status} className="justify-self-start" />
                  <Mono className="text-right text-ink">{t.story_points ?? '—'}</Mono>
                </li>
              ))}
            </ul>
          )}
        </section>
        {s.retrospective ? (
          <section className="rounded-[12px] border border-line bg-surface px-4 py-3">
            <h2 className="text-[13.5px] font-bold text-ink">Retrospective</h2>
            <p className="mt-1 whitespace-pre-line text-[12.5px] text-ink-2">{s.retrospective}</p>
          </section>
        ) : null}
      </div>
      {completing ? <CompleteDialog sprint={s} busy={busy} onClose={() => setCompleting(false)} onSubmit={(body) => void setStatus(body)} /> : null}
      {editing ? <SprintDialog sprint={s} projectId={s.project_id} onClose={() => setEditing(false)} onSaved={() => (setEditing(false), refresh())} /> : null}
      {asking === 'cancel' ? <Confirm title="Cancel sprint" message={`Cancel “${s.name}”? Its tasks stay where they are.`} confirmLabel="Cancel sprint" cancelLabel="Keep it" danger busy={busy} onClose={() => setAsking(null)} onConfirm={() => void setStatus({ status: 'cancelled' })} /> : null}
      {asking === 'delete' ? <Confirm title="Delete sprint" message={`Delete “${s.name}”? Its tasks go back to the backlog.`} confirmLabel="Delete" danger busy={busy} onClose={() => setAsking(null)} onConfirm={() => void remove()} /> : null}
    </>
  );
}

/** Complete: a retrospective, and where the unfinished tasks are carried over to — the next planned sprint, or the backlog. */
function CompleteDialog({ sprint, busy, onClose, onSubmit }: { sprint: Sprint; busy: boolean; onClose: () => void; onSubmit: (body: { status: 'completed'; retrospective: string; move_to_sprint_id: number | null }) => void }) {
  const p = { project_id: sprint.project_id };
  const siblings = useQuery({ queryKey: dqk.sprints(p), queryFn: ({ signal }) => dread.sprints(p, { signal }) });
  const planned = (siblings.data?.data.sprints ?? []).filter((x) => x.status === 'planned' && x.id !== sprint.id).sort((a, b) => (a.start_date ?? '9999').localeCompare(b.start_date ?? '9999'));
  const [retro, setRetro] = useState('');
  const [target, setTarget] = useState<number | '' | null>(null);
  const moveTo = target ?? planned[0]?.id ?? '';
  const unfinished = sprint.total_tasks - sprint.done_tasks;
  return (
    <Modal
      title={`Complete ${sprint.name}`}
      onClose={onClose}
      width={480}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={() => onSubmit({ status: 'completed', retrospective: retro.trim(), move_to_sprint_id: moveTo === '' ? null : moveTo })}>
            Complete sprint
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-[12.5px] text-ink-3">
          {sprint.done_points} of {sprint.total_points} points done
        </p>
        <Field label="Retrospective" hint="What went well, what to change. Kept with the sprint.">
          <textarea autoFocus rows={4} value={retro} onChange={(e) => setRetro(e.target.value)} className={areaClass} />
        </Field>
        <Field label="Move unfinished tasks to" hint={`${unfinished} task${unfinished === 1 ? '' : 's'} not done`}>
          <Select<number | ''> aria-label="Move unfinished tasks to" value={moveTo} onValueChange={(v) => setTarget(v)} options={[...planned.map((x) => ({ value: x.id, label: `${x.name} (${fmtRange(x.start_date, x.end_date)})` })), { value: '', label: 'The backlog' }]} className={inputClass} />
        </Field>
      </div>
    </Modal>
  );
}

function SprintDialog({ sprint, projectId, onClose, onSaved }: { sprint: Sprint | null; projectId: number | null; onClose: () => void; onSaved: (id?: number) => void }) {
  const projects = useLiveProjects(!projectId);
  const [f, setF] = useState({ project_id: projectId, name: sprint?.name ?? '', goal: sprint?.goal ?? '', start_date: sprint?.start_date?.slice(0, 10) ?? todayInZone(), end_date: sprint?.end_date?.slice(0, 10) ?? '' });
  const [busy, setBusy] = useState(false);
  const datesOk = !f.end_date || !f.start_date || f.end_date >= f.start_date;
  const ok = !!f.name.trim() && !!f.project_id && datesOk;
  const save = async () => {
    if (!ok) return;
    setBusy(true);
    try {
      const body = { name: f.name.trim(), goal: f.goal.trim() || null, start_date: f.start_date || null, end_date: f.end_date || null };
      let id: number | undefined;
      if (sprint) await dwrite.updateSprint(sprint.id, body);
      else id = (await dwrite.createSprint({ ...body, project_id: f.project_id }))?.id;
      toast('success', sprint ? 'Sprint saved.' : 'Sprint planned.');
      onSaved(id);
    } catch (e) {
      toast('error', errorMessage(e));
      setBusy(false);
    }
  };
  return (
    <Modal
      title={sprint ? `Edit ${sprint.name}` : 'New sprint'}
      onClose={onClose}
      width={480}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!ok} onClick={() => void save()}>
            {sprint ? 'Save' : 'Plan sprint'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {!projectId ? (
          <Field label="Project">
            <Select<number | ''> aria-label="Project" value={f.project_id ?? ''} onValueChange={(v) => setF((x) => ({ ...x, project_id: v === '' ? null : v }))} options={[{ value: '', label: 'Choose a project…' }, ...projects]} className={inputClass} />
          </Field>
        ) : null}
        <Field label="Name">
          <input autoFocus value={f.name} maxLength={120} onChange={(e) => setF((x) => ({ ...x, name: e.target.value }))} placeholder="Sprint 8" className={inputClass} />
        </Field>
        <Field label="Goal">
          <input value={f.goal} maxLength={250} onChange={(e) => setF((x) => ({ ...x, goal: e.target.value }))} placeholder="What the sprint should deliver" className={inputClass} />
        </Field>
        <div className="grid grid-cols-2 gap-2.5">
          <Field label="Starts">
            <input type="date" value={f.start_date} onChange={(e) => setF((x) => ({ ...x, start_date: e.target.value }))} className={inputClass} />
          </Field>
          <Field label="Ends">
            <input type="date" value={f.end_date} min={f.start_date || undefined} onChange={(e) => setF((x) => ({ ...x, end_date: e.target.value }))} aria-invalid={!datesOk} className={cx(inputClass, !datesOk && 'border-danger')} />
          </Field>
        </div>
        {!datesOk ? <p className="text-[12px] text-danger">A sprint ends on or after the day it starts.</p> : null}
      </div>
    </Modal>
  );
}

// ── charts ─────────────────────────────────────────────────────────────────

/** A round top for an axis: 39 → 40, step 10. */
function niceScale(max: number, ticks = 4): { top: number; step: number } {
  const raw = Math.max(1, max) / ticks;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((x) => x >= raw) ?? 10 * mag;
  return { top: step * ticks, step };
}

function Burndown({ sprint: s }: { sprint: Sprint }) {
  const days = s.days ?? [];
  if (days.length < 2) return <p className="py-4 text-[12.5px] text-ink-3">The burndown appears once the sprint has dates.</p>;
  const L = 40;
  const R = 550;
  const T = 20;
  const B = 200;
  const peak = Math.max(s.total_points, s.committed_points, ...days.map((d) => Math.max(d.ideal, d.remaining ?? 0)));
  const { top, step } = niceScale(peak);
  const x = (i: number) => L + (i * (R - L)) / (days.length - 1);
  const y = (v: number) => B - (v / top) * (B - T);
  const ideal = days.map((d, i) => `${x(i).toFixed(1)},${y(d.ideal).toFixed(1)}`).join(' ');
  const actual = days.flatMap((d, i) => (d.remaining === null ? [] : [`${x(i).toFixed(1)},${y(d.remaining).toFixed(1)}`])).join(' ');
  const today = days.findIndex((d) => d.date === todayInZone());
  const every = Math.ceil(days.length / 12);
  const last = [...days].reverse().find((d) => d.remaining !== null);
  const summary = last ? `Burndown: ${s.committed_points} points at start, ${last.remaining} remaining on ${fmtDay(last.date)} against an ideal of ${num(last.ideal, 1)}.` : `Burndown: ${s.committed_points} points at start; nothing burned yet.`;
  return (
    <figure className="m-0">
      <svg viewBox="0 0 560 230" className="h-auto w-full" role="img" aria-label={summary}>
        {Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step).map((v) => (
          <g key={v}>
            <line x1={L} x2={R} y1={y(v)} y2={y(v)} className={v === 0 ? 'stroke-ink-3/50' : 'stroke-line'} />
            <text x={L - 8} y={y(v) + 4} textAnchor="end" className="fill-ink-3 font-mono text-[10px]">
              {num(v)}
            </text>
          </g>
        ))}
        {days.map((d, i) =>
          i % every === 0 || i === days.length - 1 ? (
            <text key={d.date} x={x(i)} y={218} textAnchor="middle" className="fill-ink-3 text-[10px]">
              {Number(d.date.slice(8, 10))}
            </text>
          ) : null,
        )}
        <polyline points={ideal} fill="none" className="stroke-ink-3" strokeWidth={2} strokeDasharray="5 4" />
        {actual ? <polyline points={actual} fill="none" className="stroke-primary" strokeWidth={3} strokeLinejoin="round" /> : null}
        {today >= 0 ? (
          <g>
            <line x1={x(today)} x2={x(today)} y1={T} y2={B} className="stroke-warning" strokeDasharray="3 3" />
            <text x={x(today) + 4} y={T + 12} className="fill-warning-ink text-[10px]">
              today
            </text>
          </g>
        ) : null}
      </svg>
      <ChartTable caption="Burndown, points remaining by day" head={['Day', 'Ideal', 'Actual']} rows={days.map((d) => [fmtDay(d.date), num(d.ideal, 1), d.remaining === null ? '—' : d.remaining])} />
    </figure>
  );
}

function Velocity({ data, currentId }: { data: SprintDetail['velocity']; currentId: number }) {
  const rows = data.sprints;
  if (!rows.length) return <p className="py-4 text-[12.5px] text-ink-3">Velocity appears after the first sprint.</p>;
  const W = 360;
  const H = 210;
  const T = 10;
  const B = 180;
  const L = 28;
  const { top, step } = niceScale(Math.max(...rows.map((r) => Math.max(r.committed, r.delivered))));
  const y = (v: number) => B - (v / top) * (B - T);
  const slot = (W - L) / rows.length;
  const bar = Math.min(18, slot / 3);
  return (
    <figure className="m-0">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`Velocity: committed and delivered points for the last ${rows.length} sprints, average ${num(data.average, 1)} delivered.`}>
        {Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step).map((v) => (
          <g key={v}>
            <line x1={L} x2={W} y1={y(v)} y2={y(v)} className={v === 0 ? 'stroke-ink-3/50' : 'stroke-line'} />
            <text x={L - 6} y={y(v) + 4} textAnchor="end" className="fill-ink-3 font-mono text-[10px]">
              {num(v)}
            </text>
          </g>
        ))}
        {data.average > 0 ? <line x1={L} x2={W} y1={y(data.average)} y2={y(data.average)} className="stroke-ink-2" strokeDasharray="2 3" /> : null}
        {rows.map((r, i) => {
          const cx0 = L + slot * i + slot / 2;
          return (
            <g key={r.id}>
              <rect x={cx0 - bar - 1.5} y={y(r.committed)} width={bar} height={B - y(r.committed)} rx={3} className="fill-ink-3/40" />
              <rect x={cx0 + 1.5} y={y(r.delivered)} width={bar} height={B - y(r.delivered)} rx={3} className={r.id === currentId ? 'fill-primary/45' : 'fill-primary'} />
              <text x={cx0} y={H - 12} textAnchor="middle" className="fill-ink-3 text-[10px]">
                {r.name.length > 10 ? `${r.name.slice(0, 9)}…` : r.name}
              </text>
            </g>
          );
        })}
      </svg>
      <ChartTable caption={`Velocity by sprint, average ${num(data.average, 1)} delivered`} head={['Sprint', 'Committed', 'Delivered']} rows={rows.map((r) => [r.name, r.committed, r.delivered])} />
    </figure>
  );
}

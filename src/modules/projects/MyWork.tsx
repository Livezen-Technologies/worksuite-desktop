import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { hhmm, mondayOf, stampMs, targetLabel } from '@shared/projects';
import { call, errorMessage } from '../../core/bridge';
import { currentZone, dayWords } from '../../core/time';
import { toast } from '../../core/toasts';
import { useNow } from '../../core/use-now';
import { Checkbox } from '../../components/Checkbox';
import { ErrorNote, IconButton, Spinner, cx } from '../../components/ui';
import { qk, read, type Task } from './api';
import { elapsedOf, setTimerState, submit, useProjectTimer } from './desk';
import { daySegments, dueOf, filterMyWork, groupMyWork, perProject, withPending, type MyWorkFilter } from './logic';
import { Ref, SectionTitle, StatusChip } from './parts';
import type { ProjectsOutboxItem } from '@shared/projects';

/**
 * My work (PRJ-TSK-05, D03): my open tasks across projects by when they are due on my own calendar — overdue, today,
 * this week, later — each with its project, status and due, a box to complete it and ▶ to start its timer. On the
 * right, today's time on a line from 08:00 to 20:00 with the total by project, and what waits on me.
 */

const SWATCH = ['#2563EB', '#0891B2', '#7C3AED', '#D97706', '#059669', '#DB2777', '#4B5563'];

function minutesOfDay(ms: number): number {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: currentZone(), hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ms));
  return Number(p.find((x) => x.type === 'hour')?.value ?? 0) * 60 + Number(p.find((x) => x.type === 'minute')?.value ?? 0);
}

export function MyWork({ me, today, offline, outbox, onOpenTask, onGo, onOffline }: {
  me: number;
  today: string;
  offline: boolean;
  outbox: ProjectsOutboxItem[];
  onOpenTask: (t: Task) => void;
  onGo: (route: string) => void;
  onOffline: (offline: boolean) => void;
}) {
  const q = useQuery({ queryKey: qk.myWork, queryFn: ({ signal }) => read.myWork({ signal }), refetchInterval: 60_000 });
  const week = useQuery({ queryKey: qk.week(today), queryFn: ({ signal }) => read.week(today, { signal }) });
  const timer = useProjectTimer();
  const now = useNow(30_000).getTime();
  const [filter, setFilter] = useState<MyWorkFilter>('all');
  const d = q.data?.data;
  const fromCache = !!q.data?.offline;
  useEffect(() => onOffline(fromCache), [fromCache, onOffline]);

  const all = useMemo(() => (d ? [...d.overdue, ...d.today, ...d.this_week, ...d.later] : []), [d]);
  const { tasks, marks } = useMemo(() => withPending(all, outbox), [all, outbox]);
  const groups = groupMyWork(filterMyWork(tasks, filter, me, d?.waiting.reviews ?? []), today);
  const openCount = groups.overdue.length + groups.today.length + groups.week.length + groups.later.length;
  const projects = new Set(tasks.filter((t) => t.status !== 'completed').map((t) => t.project_id)).size;

  const todays = (week.data?.data.entries ?? []).filter((e) => e.on_date === today);
  const running = timer.running ? { startedAt: timer.running.startedAt, projectId: timer.running.projectId, label: timer.running.project ?? targetLabel(timer.running), project: timer.running.project, seconds: elapsedOf(timer.running.startedAt, now) } : null;
  const segments = daySegments(todays, running, now, minutesOfDay);
  const totals = perProject(todays, running);
  const colour = (id: number | null) => (id === null ? '#94A3B8' : SWATCH[id % SWATCH.length]!);
  const total = totals.reduce((n, t) => n + t.minutes, 0);

  const complete = async (t: Task) => {
    try {
      const r = await submit({ kind: 'move', taskId: t.id, status: t.status === 'completed' ? 'in_progress' : 'completed', baseUpdatedAt: t.updated_at, label: `${t.status === 'completed' ? 'Reopen' : 'Complete'} ${t.task_number ?? t.title}` });
      if (r.error && !r.queued) throw new Error(r.error);
      if (r.queued) toast('info', 'Offline — kept and sent when you reconnect.');
      void q.refetch();
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  const start = async (t: Task) => {
    try {
      setTimerState(timer.running ? await call('projects:timerSwitch', { taskId: t.id, projectId: t.project_id ?? null }) : await call('projects:timerStart', { taskId: t.id, projectId: t.project_id ?? null }));
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };

  const group = (title: string, list: Task[], tone?: 'danger') =>
    list.length ? (
      <section key={title} className="rounded-[12px] border border-line bg-surface">
        <div className="border-b border-line px-3.5 py-2">
          <SectionTitle count={list.length} tone={tone}>
            {title}
          </SectionTitle>
        </div>
        {list.map((t) => {
          const due = dueOf(t, today);
          const mark = marks.get(t.id);
          const mine = timer.running?.taskId === t.id;
          return (
            <div key={t.id} className="grid grid-cols-[22px_76px_minmax(0,1.6fr)_minmax(0,1fr)_96px_64px_32px] items-center gap-2 border-b border-line/60 px-3.5 py-1.5 last:border-b-0 hover:bg-subtle">
              <Checkbox aria-label={`Complete ${t.title}`} checked={t.status === 'completed'} onChange={() => void complete(t)} />
              <Ref>{t.task_number ?? `#${t.id}`}</Ref>
              <button type="button" onClick={() => onOpenTask(t)} className="min-w-0 truncate text-left text-[13px] font-semibold text-ink hover:underline">
                {t.title}
                {mark ? <span className="ml-2 rounded-full bg-warning-bg px-1.5 py-px text-[10.5px] font-semibold text-warning-ink">{mark}</span> : null}
              </button>
              <span className="truncate text-[12px] text-ink-3">{[t.project_code, t.project].filter(Boolean).join(' · ')}</span>
              <StatusChip status={t.blocked_reason && t.status !== 'completed' ? 'blocked' : t.status} className="justify-self-start" />
              <span className={cx('text-[12px]', due.late ? 'font-bold text-danger' : 'text-ink-2')}>{due.late && t.due_date ? `${Number(t.due_date.slice(8, 10))} ${new Date(`${t.due_date.slice(0, 10)}T12:00:00Z`).toLocaleDateString([], { month: 'short', timeZone: 'UTC' })}` : due.label || '—'}</span>
              <IconButton icon={mine ? 'pause' : 'play'} label={mine ? 'Timer running' : offline ? 'Starting a timer needs a connection' : 'Start timer'} disabled={mine || offline} size={14} onClick={() => void start(t)} className="h-7 w-7 text-primary" />
            </div>
          );
        })}
      </section>
    ) : null;

  const chip = (id: MyWorkFilter, label: string) => (
    <button key={id} type="button" aria-pressed={filter === id} onClick={() => setFilter(id)} className={cx('rounded-full px-2.5 py-1 text-[12px] font-semibold', filter === id ? 'bg-primary text-white' : 'bg-subtle text-ink-2 hover:text-ink')}>
      {label}
    </button>
  );

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-y-auto px-5 py-4 scroll-thin">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex min-w-0 flex-1 items-baseline gap-2.5">
            <h1 className="text-[20px] font-bold text-ink">My work</h1>
            <span className="text-[12.5px] text-ink-3">
              {dayWords(today, { weekday: true, long: true })} · {openCount} open across {projects} {projects === 1 ? 'project' : 'projects'}
            </span>
          </div>
          <div role="group" aria-label="Show" className="flex gap-1.5">
            {chip('all', 'All projects')}
            {chip('mine', 'Assigned to me')}
            {chip('review', 'To review')}
            {chip('bugs', 'Bugs')}
          </div>
        </div>
        {q.isLoading ? <Spinner /> : null}
        {q.error && !d ? <ErrorNote error={q.error} onRetry={() => void q.refetch()} /> : null}
        {group('Overdue', groups.overdue, 'danger')}
        {group('Today', groups.today)}
        {group('This week', groups.week)}
        {group('Later', groups.later)}
        {d && !openCount ? <p className="py-6 text-center text-[13px] text-ink-3">Nothing open here. Well done.</p> : null}
      </div>
      <aside aria-label="Today’s time and what waits on you" className="flex w-[300px] shrink-0 flex-col gap-4 overflow-y-auto border-l border-line bg-surface px-4 py-4 text-[12.5px] scroll-thin">
        <section className="flex flex-col gap-2">
          <div className="flex items-baseline">
            <h2 className="flex-1 text-[14px] font-bold text-ink">Today’s time</h2>
            <span className="font-mono text-[13px] font-bold text-ink">{hhmm(total)}</span>
          </div>
          <div className="relative h-4 overflow-hidden rounded-[5px] bg-subtle" role="img" aria-label={`Time logged today: ${hhmm(total)}`}>
            {segments.map((s) => (
              <span key={s.key} title={s.label} className={cx('absolute top-0 h-full', s.running && 'opacity-80')} style={{ left: `${s.left}%`, width: `${Math.max(s.width, 0.6)}%`, background: colour(s.projectId) }} />
            ))}
          </div>
          <div className="flex justify-between font-mono text-[10.5px] text-ink-3">
            <span>08:00</span>
            <span>12:00</span>
            <span>16:00</span>
            <span>20:00</span>
          </div>
          {totals.map((t) => (
            <div key={String(t.projectId)} className="flex items-center gap-2">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: colour(t.projectId) }} />
              <span className="min-w-0 flex-1 truncate text-ink-2">{t.label}</span>
              <span className="font-mono font-semibold text-ink">{hhmm(t.minutes)}</span>
            </div>
          ))}
          {!totals.length ? <span className="text-ink-3">Nothing logged today yet.</span> : null}
        </section>
        <section className="flex flex-col gap-2">
          <h2 className="text-[14px] font-bold text-ink">Waiting on you</h2>
          {d?.waiting.approvals ? (
            <WaitCard title={`Approve ${d.waiting.approvals} time ${d.waiting.approvals === 1 ? 'entry' : 'entries'}`} sub={offline ? 'Approvals wait for a connection' : 'In Time & approvals'} disabled={offline} onClick={() => onGo('/projects/time')} />
          ) : null}
          {(d?.waiting.reviews ?? []).map((t) => (
            <WaitCard key={`r${t.id}`} title={`Review ${t.task_number ?? ''} ${t.title}`} sub={[t.project_code, t.assignee ? `${t.assignee} asked for your review` : null].filter(Boolean).join(' · ')} onClick={() => onOpenTask(t)} />
          ))}
          {(d?.waiting.changes ?? []).map((c) => (
            <WaitCard key={`c${c.id}`} title={`Decide ${c.number ?? 'change request'}`} sub={`${c.project_code} · ${c.title}`} disabled={offline} onClick={() => onGo(`/projects/changes/${c.id}`)} />
          ))}
          {d && !d.waiting.approvals && !d.waiting.reviews.length && !d.waiting.changes.length ? <span className="text-ink-3">Nothing waits on you.</span> : null}
        </section>
        <p className="mt-auto text-[11.5px] text-ink-3">Week from {mondayOf(today)} · {stampMs(timer.checkedAt) ? 'timer synced' : 'timer not read yet'}</p>
      </aside>
    </div>
  );
}

function WaitCard({ title, sub, onClick, disabled }: { title: string; sub: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className="flex flex-col gap-0.5 rounded-[9px] border border-line px-2.5 py-2 text-left hover:border-primary/50 disabled:opacity-60">
      <b className="text-[12.5px] text-ink">{title}</b>
      {sub ? <span className="text-[11.5px] text-ink-3">{sub}</span> : null}
    </button>
  );
}

import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { hhmm, mondayOf } from '@shared/projects';
import { addDays, dayWords } from '../../core/time';
import { useNow } from '../../core/use-now';
import { Button, ErrorNote, Spinner, cx } from '../../components/ui';
import { HEALTH, qk, read } from './api';
import { elapsedOf, useProjectTimer } from './desk';
import { HealthDot, SectionTitle, openWeb } from './parts';

/**
 * The Projects app's lighter views: the Dashboard (the projects that need attention) and my time this week with what
 * waits for my approval. Approvals need WorkSuite: they are disabled offline and never kept (PRJ-DSK-04).
 */

export function DashboardView({ onGo, onOffline }: { onGo: (route: string) => void; onOffline: (o: boolean) => void }) {
  const q = useQuery({ queryKey: qk.dashboard, queryFn: ({ signal }) => read.dashboard({ signal }) });
  const d = q.data?.data;
  const fromCache = !!q.data?.offline;
  useEffect(() => onOffline(fromCache), [fromCache, onOffline]);
  const k = d?.kpi ?? {};
  const tile = (label: string, value: number | undefined, tone?: 'danger' | 'warning') => (
    <div className="flex flex-col gap-0.5 rounded-[12px] border border-line bg-surface px-3.5 py-2.5">
      <span className="text-[11.5px] font-semibold text-ink-3">{label}</span>
      <b className={cx('text-[20px]', tone === 'danger' && value ? 'text-danger' : tone === 'warning' && value ? 'text-warning-ink' : 'text-ink')}>{value ?? '—'}</b>
    </div>
  );
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto px-5 py-4 scroll-thin">
      <div className="flex items-center gap-2">
        <h1 className="flex-1 text-[20px] font-bold text-ink">Dashboard</h1>
        <Button size="sm" icon="external" onClick={() => openWeb('/projects')}>
          Full dashboard on the web
        </Button>
      </div>
      {q.isLoading ? <Spinner /> : null}
      {q.error && !d ? <ErrorNote error={q.error} onRetry={() => void q.refetch()} /> : null}
      {d ? (
        <>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2.5">
            {tile('Live projects', k.live)}
            {tile('At risk', k.at_risk, 'danger')}
            {tile('Watch', k.watch, 'warning')}
            {tile('Open tasks', k.tasks_open)}
            {tile('Overdue tasks', k.tasks_overdue, 'danger')}
            {tile('Milestones due', k.upcoming_milestones)}
          </div>
          <section className="rounded-[12px] border border-line bg-surface">
            <div className="border-b border-line px-3.5 py-2">
              <SectionTitle count={d.attention.length}>Needing attention</SectionTitle>
            </div>
            {d.attention.map((p) => (
              <button key={p.id} type="button" onClick={() => onGo(`/projects/${p.id}`)} className="grid w-full grid-cols-[14px_76px_minmax(0,1.4fr)_minmax(0,1fr)_70px_70px] items-center gap-2 border-b border-line/60 px-3.5 py-2 text-left text-[12.5px] last:border-b-0 hover:bg-subtle">
                <HealthDot health={p.health} />
                <span className="font-mono text-[11px] text-ink-3">{p.code}</span>
                <span className="min-w-0">
                  <b className="block truncate text-ink">{p.name}</b>
                  <span className="block truncate text-[11.5px] text-ink-3">{HEALTH[p.health]?.label}{p.reasons.length ? ` · ${p.reasons.join(' · ')}` : ''}</span>
                </span>
                <span className="truncate text-ink-2">{p.manager ?? '—'}</span>
                <span className="text-ink-2">{p.progress}% done</span>
                <span className={cx(p.budget_used_percent >= 100 ? 'font-bold text-danger' : 'text-ink-2')}>{p.budget_used_percent}% budget</span>
              </button>
            ))}
            {!d.attention.length ? <p className="px-3.5 py-3 text-ink-3">Every project is on track.</p> : null}
          </section>
          {d.upcoming_milestones?.length ? (
            <section className="rounded-[12px] border border-line bg-surface">
              <div className="border-b border-line px-3.5 py-2">
                <SectionTitle count={d.upcoming_milestones.length}>Milestones coming up</SectionTitle>
              </div>
              {d.upcoming_milestones.slice(0, 8).map((m) => (
                <button key={m.id} type="button" onClick={() => onGo(`/projects/${m.project_id}`)} className="flex w-full items-center gap-2 border-b border-line/60 px-3.5 py-1.5 text-left text-[12.5px] last:border-b-0 hover:bg-subtle">
                  <span className="font-mono text-[11px] text-ink-3">{m.code}</span>
                  <span className="min-w-0 flex-1 truncate text-ink">{m.name}</span>
                  <span className={cx(m.days_left < 0 ? 'font-bold text-danger' : 'text-ink-2')}>{m.days_left < 0 ? `${-m.days_left} d late` : m.days_left === 0 ? 'Today' : `in ${m.days_left} d`}</span>
                </button>
              ))}
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

/** My time this week (PRJ-TIM), the running timer with it, and the approvals waiting for me (on the web, online). */
export function TimeView({ today, waiting, offline, onLogTime, onOffline }: { today: string; waiting: number; offline: boolean; onLogTime: () => void; onOffline: (o: boolean) => void }) {
  const [day, setDay] = useState(today);
  const q = useQuery({ queryKey: qk.week(mondayOf(day)), queryFn: ({ signal }) => read.week(mondayOf(day), { signal }) });
  const timer = useProjectTimer();
  const now = useNow(30_000).getTime();
  const fromCache = !!q.data?.offline;
  useEffect(() => onOffline(fromCache), [fromCache, onOffline]);
  const entries = (q.data?.data.entries ?? []).filter((e) => !e.running);
  const monday = mondayOf(day);
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const running = timer.running && mondayOf(today) === monday ? Math.floor(elapsedOf(timer.running.startedAt, now) / 60) : 0;
  const total = entries.reduce((n, e) => n + e.minutes, 0) + running;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 py-4 scroll-thin">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex min-w-0 flex-1 flex-col">
          <h1 className="text-[20px] font-bold text-ink">Time & approvals</h1>
          <span className="text-[12.5px] text-ink-3">
            Week of {dayWords(monday)} · {hhmm(total)} logged
          </span>
        </div>
        <Button size="sm" aria-label="Earlier week" onClick={() => setDay(addDays(monday, -7))}>
          ←
        </Button>
        {monday !== mondayOf(today) ? (
          <Button size="sm" onClick={() => setDay(today)}>
            This week
          </Button>
        ) : null}
        <Button size="sm" aria-label="Later week" disabled={monday >= mondayOf(today)} onClick={() => setDay(addDays(monday, 7))}>
          →
        </Button>
        <Button size="sm" variant="primary" icon="clock" onClick={onLogTime}>
          Log time
        </Button>
      </div>
      {waiting ? (
        <div className="flex items-center gap-3 rounded-[10px] border border-line bg-surface px-3.5 py-2.5 text-[12.5px]">
          <b className="flex-1 text-ink">
            {waiting} time {waiting === 1 ? 'entry waits' : 'entries wait'} for your approval
          </b>
          <Button size="sm" disabled={offline} title={offline ? 'Approvals wait for a connection' : 'Opens the approval queue on the web'} onClick={() => openWeb('/projects/time')}>
            {offline ? 'Waits for a connection' : 'Review on the web'}
          </Button>
        </div>
      ) : null}
      {q.isLoading ? <Spinner /> : null}
      {q.error && !q.data ? <ErrorNote error={q.error} onRetry={() => void q.refetch()} /> : null}
      <div className="flex flex-col gap-2">
        {days.map((d) => {
          const list = entries.filter((e) => e.on_date === d);
          const run = timer.running && d === today && running ? running : 0;
          if (!list.length && !run) return null;
          return (
            <section key={d} className="rounded-[12px] border border-line bg-surface">
              <div className="flex items-center border-b border-line px-3.5 py-1.5">
                <b className={cx('flex-1 text-[12.5px]', d === today ? 'text-primary' : 'text-ink')}>{dayWords(d, { weekday: true })}</b>
                <span className="font-mono text-[12px] font-bold text-ink">{hhmm(list.reduce((n, e) => n + e.minutes, 0) + run)}</span>
              </div>
              {list.map((e) => (
                <div key={e.id} className="flex items-center gap-2 border-b border-line/60 px-3.5 py-1.5 text-[12.5px] last:border-b-0">
                  <span className="w-[70px] font-mono text-[11px] text-ink-3">{e.task_number ?? e.project_code ?? '—'}</span>
                  <span className="min-w-0 flex-1 truncate text-ink">{e.task ?? e.project ?? 'Internal · not on a project'}</span>
                  {e.note ? <span className="max-w-[30%] truncate text-ink-3">{e.note}</span> : null}
                  <span className="text-[11px] text-ink-3">{e.is_billable ? 'billable' : 'non-billable'}</span>
                  <span className="text-[11px] text-ink-3">{e.approved ? 'approved' : (e.state ?? '').replace(/_/g, ' ')}</span>
                  <span className="w-[44px] text-right font-mono font-semibold text-ink">{hhmm(e.minutes)}</span>
                </div>
              ))}
              {run && timer.running ? (
                <div className="flex items-center gap-2 px-3.5 py-1.5 text-[12.5px]">
                  <span className="w-[70px] font-mono text-[11px] text-ink-3">{timer.running.taskNumber ?? '—'}</span>
                  <span className="min-w-0 flex-1 truncate text-ink">{timer.running.task ?? timer.running.project ?? 'Internal'}</span>
                  <span className="text-[11px] font-semibold text-success">running</span>
                  <span className="w-[44px] text-right font-mono font-semibold text-ink">{hhmm(run)}</span>
                </div>
              ) : null}
            </section>
          );
        })}
        {q.data && !entries.length && !running ? <p className="py-4 text-center text-ink-3">Nothing logged this week.</p> : null}
      </div>
    </div>
  );
}

// Change requests (list, raise, withdraw, decide) are `screens/Changes.tsx` (W14).

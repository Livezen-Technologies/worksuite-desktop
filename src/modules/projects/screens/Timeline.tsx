import { useQuery } from '@tanstack/react-query';
import { useMemo, useState, type ReactNode } from 'react';
import { todayInZone } from '../../../core/time';
import { Checkbox } from '../../../components/Checkbox';
import { Button, ErrorNote, Spinner, cx } from '../../../components/ui';
import { dqk, dread, fmtDay, type DependencyType, type Schedule } from '../delivery';
import { openWeb } from '../parts';
import { Mono, PageHead, ProjectPick, Tabs, useRememberedProject, useReportOffline } from './kit';

/**
 * W08 · Timeline & Gantt (PRJ-SCH), in the desktop: a project's tasks as bars on real calendar dates (the
 * schedule's `start` / `finish`, worked out by the server from the project start skipping weekends and HR holidays),
 * the critical path, each task's slack, the milestones, today, and the planned end against the baseline and the
 * finish forecast. "Skip weekends" folds non-working days out of the axis. Below the chart, the dependencies with
 * their kind and lag.
 *
 * Critical or not is said in words in the legend and the Slack column; the colours only repeat it (NFR-08). Read
 * only: dependencies are edited on a task (its panel), dates by the schedule.
 */

type Zoom = 'days' | 'weeks' | 'months';
const PX: Record<Zoom, number> = { days: 28, weeks: 14, months: 4 };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY_MS = 86_400_000;
const DEP_WORDS: Record<DependencyType, string> = { finish_start: 'finish → start', start_start: 'start → start', finish_finish: 'finish → finish' };

/** "2026-10-30" → local midnight, or null. */
function parseDay(d: string | null | undefined): Date | null {
  const m = d ? /^(\d{4})-(\d{2})-(\d{2})/.exec(d) : null;
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

function isoDay(date: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

function plus(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

const isoWeekday = (d: Date) => ((d.getDay() + 6) % 7) + 1;

/**
 * The calendar the chart draws on: every day from the Monday before the first date to a week after the last, and
 * the column each starts at. With weekends skipped a non-working day takes no width.
 */
export function buildAxis(s: Schedule, skip: boolean, today: string) {
  const working = new Set(s.working_days?.length ? s.working_days : [1, 2, 3, 4, 5]);
  const holidays = new Set(s.holidays ?? []);
  const isWorking = (d: Date) => working.has(isoWeekday(d)) && !holidays.has(isoDay(d));
  const dates: string[] = [];
  const push = (v: string | null | undefined) => {
    if (v && parseDay(v)) dates.push(v.slice(0, 10));
  };
  push(s.project_start);
  push(s.planned_end);
  push(s.baseline_end);
  push(s.forecast_finish);
  for (const t of s.tasks) {
    push(t.start);
    push(t.finish);
  }
  for (const m of s.milestones) push(m.due_date);
  if (!dates.length) push(today);
  dates.sort();
  let first = parseDay(dates[0]) as Date;
  first = plus(first, -((first.getDay() + 6) % 7));
  const last = plus(parseDay(dates[dates.length - 1]) as Date, 7);
  const days: Array<{ iso: string; date: Date; on: boolean; col: number }> = [];
  let col = 0;
  for (let d = first; d <= last; d = plus(d, 1)) {
    const on = !skip || isWorking(d);
    days.push({ iso: isoDay(d), date: d, on, col });
    if (on) col += 1;
  }
  const index = new Map(days.map((d, i) => [d.iso, i]));
  const firstMs = first.getTime();
  const at = (iso: string | null | undefined): number | null => {
    if (!iso) return null;
    const i = index.get(iso.slice(0, 10));
    if (i !== undefined) return days[i]!.col;
    const d = parseDay(iso);
    if (!d) return null;
    return d.getTime() < firstMs ? 0 : col;
  };
  /** The column just after a day: where a bar that ends that day stops. */
  const after = (iso: string | null | undefined): number | null => {
    if (!iso) return null;
    const i = index.get(iso.slice(0, 10));
    if (i === undefined) return at(iso);
    return days[i]!.col + (days[i]!.on ? 1 : 0);
  };
  /** The date n working days after `iso`: where a task's slack runs out. */
  const plusWorking = (iso: string, n: number): string => {
    let d = parseDay(iso) as Date;
    let left = n;
    while (left > 0) {
      d = plus(d, 1);
      if (isWorking(d)) left -= 1;
    }
    return isoDay(d);
  };
  return { days, cols: col, at, after, plusWorking, firstMs };
}

export function TimelineScreen({ projectId, onGo, onOpenTask, onOffline }: { projectId: number | null; onGo: (route: string) => void; onOpenTask: (id: number) => void; onOffline: (o: boolean) => void }) {
  const [pid, setPid] = useRememberedProject(projectId, 'timeline');
  const [zoom, setZoom] = useState<Zoom>('weeks');
  const [baseline, setBaseline] = useState(true);
  const [skip, setSkip] = useState(true);
  const q = useQuery({ queryKey: dqk.schedule(pid ?? 0), queryFn: ({ signal }) => dread.schedule(pid as number, { signal }), enabled: !!pid });
  useReportOffline(!!q.data?.offline, onOffline);
  const s = q.data?.data;

  let body: ReactNode;
  if (!pid) body = <p className="py-6 text-center text-ink-3">Choose a project to see its timeline.</p>;
  else if (q.isLoading) body = <Spinner label="Working out the schedule…" />;
  else if (q.error && !s) body = <ErrorNote error={q.error} onRetry={() => void q.refetch()} />;
  else if (s) body = <Chart s={s} zoom={zoom} showBaseline={baseline} skip={skip} onOpenTask={onOpenTask} />;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHead
        title="Timeline"
        actions={
          <>
            {pid ? (
              <Button size="sm" icon="kanban" onClick={() => onGo(`/projects/${pid}/board`)}>
                Board
              </Button>
            ) : null}
            <Button size="sm" icon="external" onClick={() => openWeb(pid ? `/projects/${pid}/timeline` : '/projects/timeline')}>
              Open on the web
            </Button>
          </>
        }
      >
        <div className="pb-2.5">
          <div className="flex flex-wrap items-center gap-2.5">
            {!projectId ? <ProjectPick value={pid} onChange={setPid} anyLabel="Choose…" /> : null}
            <Tabs<Zoom>
              label="Scale"
              value={zoom}
              onChange={setZoom}
              tabs={[
                { key: 'days', label: 'Days' },
                { key: 'weeks', label: 'Weeks' },
                { key: 'months', label: 'Months' },
              ]}
            />
            <label className="flex items-center gap-1.5 text-[12.5px] text-ink-2">
              <Checkbox checked={baseline} onChange={(e) => setBaseline(e.target.checked)} />
              Show baseline
            </label>
            <label className="flex items-center gap-1.5 text-[12.5px] text-ink-2">
              <Checkbox checked={skip} onChange={(e) => setSkip(e.target.checked)} />
              Skip weekends
            </label>
            <Legend />
          </div>
        </div>
      </PageHead>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 py-4 scroll-thin">{body}</div>
    </div>
  );
}

function Legend() {
  const item = (swatch: ReactNode, label: string) => (
    <span className="flex items-center gap-1.5">
      {swatch}
      {label}
    </span>
  );
  return (
    <div aria-label="Legend" className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-ink-2">
      {item(<span aria-hidden className="h-2 w-4 rounded-[3px] bg-danger" />, 'Critical path')}
      {item(<span aria-hidden className="h-2 w-4 rounded-[3px] bg-primary" />, 'Has slack')}
      {item(<span aria-hidden className="h-2 w-4 rounded-[3px] bg-primary/30" />, 'Slack')}
      {item(<span aria-hidden className="h-2.5 w-2.5 rotate-45 bg-[#7C3AED]" />, 'Milestone')}
      {item(<span aria-hidden className="h-3 w-0.5 bg-warning" />, 'Today')}
      {item(<span aria-hidden className="h-3 w-0 border-l-2 border-dashed border-ink-2" />, 'Planned end')}
      {item(<span aria-hidden className="h-3 w-0 border-l-2 border-dotted border-ink-3" />, 'Baseline')}
    </div>
  );
}

type Row = { kind: 'task'; key: string; sort: string; t: Schedule['tasks'][number] } | { kind: 'milestone'; key: string; sort: string; m: Schedule['milestones'][number] };

function Chart({ s, zoom, showBaseline, skip, onOpenTask }: { s: Schedule; zoom: Zoom; showBaseline: boolean; skip: boolean; onOpenTask: (id: number) => void }) {
  const today = todayInZone();
  const axis = useMemo(() => buildAxis(s, skip, today), [s, skip, today]);
  const px = PX[zoom];
  const width = Math.max(axis.cols * px, 320);
  const rows: Row[] = [
    ...s.tasks.map((t) => ({ kind: 'task' as const, key: `t${t.id}`, sort: t.start ?? '9999', t })),
    ...s.milestones.map((m) => ({ kind: 'milestone' as const, key: `m${m.id}`, sort: m.due_date ?? '9999', m })),
  ].sort((a, b) => (a.sort === b.sort ? (a.kind === 'task' ? -1 : 1) : a.sort < b.sort ? -1 : 1));

  const ticks: Array<{ col: number; label: string; strong?: boolean }> = [];
  let lastWeek = -1;
  let lastMonth = -1;
  for (const d of axis.days) {
    if (!d.on) continue;
    const weekNo = Math.floor((d.date.getTime() - axis.firstMs + 3_600_000) / (7 * DAY_MS));
    if (zoom === 'days') ticks.push({ col: d.col, label: d.date.getDate() === 1 || ticks.length === 0 ? `${d.date.getDate()} ${MONTHS[d.date.getMonth()]}` : String(d.date.getDate()), strong: isoWeekday(d.date) === 1 });
    else if (zoom === 'weeks' && weekNo !== lastWeek) ticks.push({ col: d.col, label: fmtDay(d.iso) });
    else if (zoom === 'months' && d.date.getMonth() !== lastMonth) ticks.push({ col: d.col, label: `${MONTHS[d.date.getMonth()]} ${d.date.getFullYear()}` });
    lastWeek = weekNo;
    lastMonth = d.date.getMonth();
  }

  const byId = new Map(s.tasks.map((t) => [t.id, t]));
  const critical = s.tasks.filter((t) => t.critical).length || s.critical_path.length;
  const late = s.working_days_late;
  const todayCol = axis.at(today);
  const plannedCol = axis.after(s.planned_end);
  const baselineCol = s.baseline_end && s.baseline_end !== s.planned_end ? axis.after(s.baseline_end) : null;
  const lines = (
    <>
      {todayCol !== null && todayCol > 0 && todayCol < axis.cols ? <div aria-hidden className="pointer-events-none absolute inset-y-0 w-0.5 bg-warning" style={{ left: todayCol * px }} /> : null}
      {showBaseline && plannedCol !== null ? <div aria-hidden className="pointer-events-none absolute inset-y-0 border-l-2 border-dashed border-ink-2" style={{ left: plannedCol * px }} /> : null}
      {showBaseline && baselineCol !== null ? <div aria-hidden className="pointer-events-none absolute inset-y-0 border-l-2 border-dotted border-ink-3" style={{ left: baselineCol * px }} /> : null}
    </>
  );
  const LEFT = 'sticky left-0 z-10 flex w-[22rem] shrink-0 items-center bg-surface';
  const ref = (id: number) => byId.get(id)?.task_number ?? `#${id}`;

  return (
    <>
      <div className="flex flex-wrap gap-x-5 gap-y-1 rounded-[10px] bg-selection px-3 py-2 text-[12.5px] text-ink">
        {s.forecast_finish ? (
          <span>
            <b>Finish forecast {fmtDay(s.forecast_finish)}</b>
            {s.planned_end && late !== null ? (late === 0 ? ` — on the planned end (${fmtDay(s.planned_end)})` : ` — ${Math.abs(late)} working day${Math.abs(late) === 1 ? '' : 's'} ${late > 0 ? 'after' : 'before'} the planned end (${fmtDay(s.planned_end)})`) : null}
          </span>
        ) : (
          <span>No forecast yet — add tasks with estimates to work one out.</span>
        )}
        <span>
          Critical path: {critical} task{critical === 1 ? '' : 's'} · {s.duration_days} day{s.duration_days === 1 ? '' : 's'}
        </span>
        <span>{s.hours_per_day} h working day · from Settings</span>
        {showBaseline && s.baseline_end && s.baseline_end !== s.planned_end ? <span>Baseline end {fmtDay(s.baseline_end)}</span> : null}
      </div>
      {s.cycle && s.cycle.length > 0 ? (
        <p role="alert" className="rounded-[10px] bg-warning-bg px-3 py-2 text-[12.5px] text-warning-ink">
          These tasks wait on each other in a loop, so no schedule can be worked out until it is broken: <b className="font-mono">{[...s.cycle, s.cycle[0]!].map(ref).join(' → ')}</b>
        </p>
      ) : null}
      <section className="min-h-0 overflow-hidden rounded-[12px] border border-line bg-surface">
        {rows.length === 0 ? (
          <p className="px-4 py-6 text-center text-ink-3">Nothing scheduled yet. Add tasks with estimates and dependencies to build the timeline.</p>
        ) : (
          <div className="overflow-x-auto scroll-thin">
            <div role="table" aria-label="Timeline" className="min-w-max text-[12.5px]">
              <div role="row" className="flex border-b border-line bg-subtle text-[11.5px] font-semibold text-ink-2">
                <div className={cx(LEFT, 'bg-subtle')}>
                  <span role="columnheader" className="min-w-0 flex-1 px-3.5 py-2">
                    Task
                  </span>
                  <span role="columnheader" className="w-12 px-1 py-2 text-right">
                    Days
                  </span>
                  <span role="columnheader" className="w-[4.5rem] px-2 py-2 text-right">
                    Slack
                  </span>
                </div>
                <div role="columnheader" className="relative h-8 shrink-0" style={{ width }}>
                  <span className="sr-only">Dates</span>
                  {ticks.map((tk) => (
                    <span key={`${tk.col}-${tk.label}`} aria-hidden className={cx('absolute inset-y-0 border-l px-1.5 py-2 whitespace-nowrap', tk.strong ? 'border-ink-3/40' : 'border-line')} style={{ left: tk.col * px }}>
                      {tk.label}
                    </span>
                  ))}
                </div>
              </div>
              {rows.map((r) => {
                if (r.kind === 'milestone') {
                  const c = axis.at(r.m.due_date);
                  return (
                    <div role="row" key={r.key} className="flex h-10 border-b border-line/60">
                      <div className={LEFT}>
                        <span role="cell" className="flex min-w-0 flex-1 items-center gap-2 px-3.5">
                          <span aria-hidden className="text-[#7C3AED]">
                            ◆
                          </span>
                          <span className="truncate font-bold text-[#6D28D9] dark:text-[#C4B5FD]">{r.m.name}</span>
                          <span className="sr-only">Milestone due {fmtDay(r.m.due_date)}</span>
                        </span>
                        <span role="cell" className="w-12 px-1 text-right font-mono text-ink-3">
                          —
                        </span>
                        <span role="cell" className="w-[4.5rem] px-2 text-right text-[11.5px] text-[#6D28D9] dark:text-[#C4B5FD]">
                          Milestone
                        </span>
                      </div>
                      <div role="cell" className="relative shrink-0" style={{ width }}>
                        {lines}
                        {c !== null ? <span role="img" aria-label={`${r.m.name}: due ${fmtDay(r.m.due_date)}`} className="absolute top-[13px] h-[13px] w-[13px] rotate-45 bg-[#7C3AED]" style={{ left: c * px - 6 }} /> : null}
                      </div>
                    </div>
                  );
                }
                const t = r.t;
                const from = axis.at(t.start);
                const to = axis.after(t.finish);
                const slackEnd = t.finish && t.slack > 0 ? axis.after(axis.plusWorking(t.finish, t.slack)) : null;
                return (
                  <div role="row" key={r.key} className="flex h-10 border-b border-line/60">
                    <div className={LEFT}>
                      <span role="cell" className="flex min-w-0 flex-1 items-center gap-2 px-3.5">
                        <Mono className="shrink-0 text-[11px] text-ink-3">{t.task_number}</Mono>
                        <button type="button" onClick={() => onOpenTask(t.id)} className={cx('truncate text-left hover:text-primary hover:underline', t.critical ? 'font-semibold text-ink' : 'text-ink-2')}>
                          {t.title}
                        </button>
                      </span>
                      <span role="cell" className="w-12 px-1 text-right font-mono text-ink">
                        {t.duration_days}
                      </span>
                      <span role="cell" className={cx('w-[4.5rem] px-2 text-right text-[11.5px]', t.critical ? 'font-bold text-danger' : 'text-ink-2')}>
                        {t.critical ? 'Critical' : `${t.slack} d slack`}
                      </span>
                    </div>
                    <div role="cell" className="relative shrink-0" style={{ width }}>
                      {lines}
                      {from !== null && to !== null ? (
                        <>
                          {slackEnd !== null && slackEnd > to ? <div aria-hidden className="absolute top-4 h-2 rounded-r bg-primary/30" style={{ left: to * px, width: (slackEnd - to) * px }} /> : null}
                          <div
                            role="img"
                            aria-label={`${t.task_number ?? t.title}: ${fmtDay(t.start)} to ${fmtDay(t.finish)}, ${t.critical ? 'on the critical path' : `${t.slack} working days of slack`}, ${t.progress}% done`}
                            title={`${fmtDay(t.start)} – ${fmtDay(t.finish)}`}
                            className={cx('absolute top-3 h-4 overflow-hidden rounded-[5px]', t.critical ? 'bg-danger' : 'bg-primary')}
                            style={{ left: from * px, width: Math.max(px * 0.6, (to - from) * px) }}
                          >
                            <span className="block h-full bg-[#0F172A]/30" style={{ width: `${Math.max(0, Math.min(100, t.progress))}%` }} />
                          </div>
                        </>
                      ) : (
                        <span className="absolute top-3 left-2 text-[11.5px] text-ink-3">Not scheduled — no start date</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>
      {s.dependencies?.length ? (
        <section aria-label="Dependencies" className="rounded-[12px] border border-line bg-surface">
          <h2 className="border-b border-line px-3.5 py-2 text-[13.5px] font-bold text-ink">
            Dependencies <span className="text-[12px] font-semibold text-ink-3">{s.dependencies.length}</span>
          </h2>
          <ul>
            {s.dependencies.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-2 border-b border-line/60 px-3.5 py-1.5 text-[12.5px] last:border-b-0">
                <Mono className="text-ink">{ref(d.task_id)}</Mono>
                <span className="text-ink-2">waits on</span>
                <Mono className="text-ink">{ref(d.depends_on_id)}</Mono>
                <span className="text-ink-3">· {DEP_WORDS[d.type] ?? d.type}</span>
                <span className={cx('text-[11.5px]', d.lag_days ? 'font-semibold text-ink-2' : 'text-ink-3')}>{d.lag_days ? `${d.lag_days > 0 ? '+' : '−'}${Math.abs(d.lag_days)} d lag` : 'no lag'}</span>
                {byId.get(d.task_id)?.critical && byId.get(d.depends_on_id)?.critical ? <span className="text-[11.5px] font-bold text-danger">on the critical path</span> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}

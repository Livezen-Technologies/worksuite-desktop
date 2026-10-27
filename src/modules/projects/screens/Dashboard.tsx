import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { Button, cx } from '../../../components/ui';
import type { ProjectStatus } from '../api';
import { CompanySelect, useOrgParam } from '../company';
import { openWeb } from '../parts';
import { PROJECT_STATUS, daysLeftText, fmtDay, hm, num, pk, preads, projectPath, shortMoney, usedFill, usedTone, type ActivityRow, type FullDashboard } from '../portfolio';
import { Failed, HealthChip, Kpi, Loading, Mono, Nothing, PageHead, Panel, Progress, TD, TH } from './kit';
import { NewProjectButton } from './Register';
import { StatGrid } from '../../../components/StatCard';

/**
 * W01 · The Projects dashboard (PRJ-STS, PRJ-RPT), with the web's figures: eight tiles across the top, each leading to
 * the screen that explains it; the projects that need attention with the reasons in words; recent activity; by status;
 * upcoming milestones; team workload.
 *
 * Everything here is ONE company's (G-01, NFR-05): "Company ▾" picks which, the server answers for that company only,
 * and the money tile names it with its reporting currency (and the Finance rate date when anything was converted).
 */

const STATUS_ORDER: ProjectStatus[] = ['planning', 'pending_approval', 'active', 'on_hold', 'completed', 'cancelled'];
const STATUS_BAR: Record<string, string> = {
  planning: 'bg-ink-3',
  pending_approval: 'bg-violet',
  active: 'bg-primary',
  on_hold: 'bg-warning',
  completed: 'bg-success',
  cancelled: 'bg-line',
};

export function PortfolioDashboard({ offline, mayCreate, onGo, onNew, onLogTime, onOffline }: { offline: boolean; mayCreate: boolean; onGo: (route: string) => void; onNew: () => void; onLogTime: () => void; onOffline: (o: boolean) => void }) {
  const org = useOrgParam();
  const q = useQuery({ queryKey: pk.dashboard(org), queryFn: ({ signal }) => preads.dashboard({ signal }), staleTime: 60_000 });
  const fromCache = !!q.data?.offline;
  useEffect(() => onOffline(fromCache), [fromCache, onOffline]);
  const d = q.data?.data;
  const may = (d?.can?.manage ?? mayCreate) && mayCreate;
  const today = new Date().toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHead
        title="Dashboard"
        sub={`${today} · your projects`}
        actions={
          <>
            <CompanySelect />
            <Button size="sm" icon="clock" onClick={onLogTime}>
              Log time
            </Button>
            <NewProjectButton may={may} offline={offline} onNew={onNew} />
          </>
        }
      />
      <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto px-5 py-3.5 scroll-thin">
        {q.isLoading ? <Loading label="Loading the dashboard" /> : !d ? <Failed error={q.error} onRetry={() => void q.refetch()} /> : <Content d={d} onGo={onGo} />}
        <button type="button" onClick={() => openWeb('/projects')} className="self-start text-[12px] text-ink-3 hover:text-primary hover:underline">
          Open on the web
        </button>
      </div>
    </div>
  );
}

function Content({ d, onGo }: { d: FullDashboard; onGo: (route: string) => void }) {
  const k = d.kpi ?? {};
  const waitingTime = k.waiting_time ?? 0;
  const waitingChanges = k.waiting_changes ?? 0;
  const used = k.used_percent ?? 0;
  const rateNote = d.rate_date ? `at Finance rates of ${fmtDay(d.rate_date, { year: true })}` : null;
  const basis = [d.company?.name, d.currency].filter(Boolean).join(' · ');
  return (
    <>
      <StatGrid min={200} label="Key figures">
        <Kpi icon="briefcase"  tone="blue" label="Active projects" value={k.active ?? 0} sub={`${k.total ?? 0} in total`} onClick={() => onGo('/projects/all?status=active')} />
        <Kpi icon="shield-alert" label="At risk" value={k.at_risk ?? 0} sub={`${k.watch ?? 0} on watch`} tone={k.at_risk ? 'text-danger' : 'text-ink'} onClick={() => onGo('/projects/all?health=at_risk')} />
        <Kpi icon="list-todo" label="Overdue tasks" value={k.tasks_overdue ?? 0} sub={`of ${num(k.tasks_open)} open`} tone={k.tasks_overdue ? 'text-danger' : 'text-ink'} onClick={() => onGo('/projects/my-work')} />
        <Kpi icon="flag" label="Milestones · 30 days" value={k.milestones_30d ?? 0} sub={`${k.milestones_overdue ?? 0} overdue`} tone="text-violet dark:text-violet-ink" onClick={() => onGo('/projects/milestones')} />
        <Kpi icon="timer" tone="cyan" label="Hours this week" value={hm(k.minutes_week)} sub={`${k.billable_percent_week ?? 0}% billable`} onClick={() => onGo('/projects/time')} />
        <Kpi
          icon="wallet"
          label="Budget used"
          value={`${used}%`}
          tone={used > 100 ? 'text-danger' : 'text-ink'}
          onClick={() => onGo('/projects/budget')}
          sub={
            <>
              {shortMoney(k.spent, d.currency)} of {shortMoney(k.budget)}
              <span className="block">{basis}</span>
              {rateNote ? <span className="block">{rateNote}</span> : null}
            </>
          }
        />
        <Kpi icon="warning" label="Open risks" value={k.open_risks ?? 0} sub={`${k.risks_high ?? 0} high`} tone={k.open_risks ? 'text-warning-ink' : 'text-ink'} onClick={() => onGo('/projects/risks')} />
        <Kpi icon="inbox" label="Waiting on you" value={waitingTime + waitingChanges} tone="text-primary" sub={`${waitingTime} time · ${waitingChanges} change${waitingChanges === 1 ? '' : 's'}`} onClick={() => onGo(waitingTime || !waitingChanges ? '/projects/time' : '/projects/changes')} />
      </StatGrid>
      <div className="grid gap-3.5 lg:grid-cols-[minmax(0,1.75fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-3.5">
          <Attention d={d} onGo={onGo} />
          <Recent rows={d.recent ?? []} onGo={onGo} />
        </div>
        <div className="flex min-w-0 flex-col gap-3.5">
          <ByStatus counts={d.by_status ?? {}} onGo={onGo} />
          <Milestones rows={d.upcoming_milestones ?? []} onGo={onGo} />
          <Workload rows={d.workload ?? []} onGo={onGo} />
        </div>
      </div>
    </>
  );
}

const linkCls = 'text-[12px] font-semibold text-primary hover:underline';

function Attention({ d, onGo }: { d: FullDashboard; onGo: (route: string) => void }) {
  return (
    <Panel
      title="Projects needing attention"
      className="overflow-hidden"
      action={
        <button type="button" onClick={() => onGo('/projects/all')} className={linkCls}>
          All projects
        </button>
      }
    >
      {d.attention.length === 0 ? (
        <Nothing text="Every live project is on track." />
      ) : (
        <div className="overflow-x-auto scroll-thin">
          <table className="w-full min-w-[600px] border-collapse">
            <thead className="bg-ground">
              <tr>
                <th scope="col" className={TH}>Project</th>
                <th scope="col" className={TH}>Health</th>
                <th scope="col" className={cx(TH, 'w-[140px]')}>Progress</th>
                <th scope="col" className={cx(TH, 'text-end')}>Budget used</th>
                <th scope="col" className={TH}>Why</th>
              </tr>
            </thead>
            <tbody>
              {d.attention.map((p) => (
                <tr key={p.id} className="border-t border-line/70">
                  <td className={TD}>
                    <button type="button" onClick={() => onGo(projectPath(p.id))} className="text-start font-semibold text-ink hover:text-primary hover:underline">
                      {p.name}
                    </button>
                    <div className="font-mono text-[11px] text-ink-3">
                      {p.code}
                      {p.manager ? ` · ${p.manager}` : ''}
                    </div>
                  </td>
                  <td className={TD}>
                    <HealthChip health={p.health} />
                  </td>
                  <td className={TD}>
                    <Progress value={p.progress} label={`${p.name} progress`} />
                  </td>
                  <td className={cx(TD, 'text-end')}>
                    <Mono className={usedTone(p.budget_used_percent)}>{p.budget_used_percent}%</Mono>
                  </td>
                  <td className={cx(TD, 'text-[12px] text-ink-2')}>{p.reasons.length ? p.reasons.join(' · ') : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

/** "10:42" for today, "Yest." for yesterday, otherwise "7 Oct". */
function when(at: string): string {
  const iso = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
  const day = at.slice(0, 10);
  const now = new Date();
  if (day === iso(now)) return at.slice(11, 16) || 'Today';
  now.setDate(now.getDate() - 1);
  if (day === iso(now)) return 'Yest.';
  return fmtDay(day);
}

function Recent({ rows, onGo }: { rows: ActivityRow[]; onGo: (route: string) => void }) {
  return (
    <Panel
      title="Recent activity"
      action={
        <button type="button" onClick={() => onGo('/projects/activity')} className={linkCls}>
          Activity log
        </button>
      }
    >
      {rows.length === 0 ? (
        <p className="px-3.5 py-3 text-[12.5px] text-ink-3">Nothing has happened yet.</p>
      ) : (
        <ul className="flex flex-col gap-1.5 px-3.5 py-2.5">
          {rows.map((a, i) => (
            <li key={a.id ?? i} className="flex items-baseline gap-2.5 text-[12.5px] text-ink">
              <Mono className="w-[48px] shrink-0 text-[11px] text-ink-3">{when(a.at)}</Mono>
              <span className="min-w-0">
                {a.actor ? <b className="font-semibold">{a.actor} </b> : null}
                {a.detail ?? a.action.replace(/[._]/g, ' ')}
                {a.code ? (
                  <span className="text-ink-3">
                    {' · '}
                    {a.project_id ? (
                      <button type="button" onClick={() => onGo(projectPath(a.project_id!))} className="font-mono hover:underline">
                        {a.code}
                      </button>
                    ) : (
                      <Mono>{a.code}</Mono>
                    )}
                  </span>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function ByStatus({ counts, onGo }: { counts: Record<string, number>; onGo: (route: string) => void }) {
  const max = Math.max(1, ...STATUS_ORDER.map((s) => counts[s] ?? 0));
  return (
    <Panel title="By status">
      <ul className="flex flex-col gap-1 px-3.5 py-2.5">
        {STATUS_ORDER.map((s) => {
          const n = counts[s] ?? 0;
          return (
            <li key={s}>
              <button type="button" onClick={() => onGo(`/projects/all?status=${s}`)} className="grid w-full grid-cols-[110px_minmax(0,1fr)_28px] items-center gap-2 rounded-[6px] text-start text-[12px] hover:bg-subtle">
                <span className="text-ink-2">{PROJECT_STATUS[s].label}</span>
                <span aria-hidden="true" className="h-2 overflow-hidden rounded-full bg-subtle">
                  <span className={cx('block h-full rounded-full', STATUS_BAR[s])} style={{ width: `${Math.round((n / max) * 100)}%` }} />
                </span>
                <Mono className="text-end text-ink">{n}</Mono>
              </button>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

function Milestones({ rows, onGo }: { rows: NonNullable<FullDashboard['upcoming_milestones']>; onGo: (route: string) => void }) {
  return (
    <Panel
      title="Upcoming milestones"
      action={
        <button type="button" onClick={() => onGo('/projects/milestones')} className={linkCls}>
          All
        </button>
      }
    >
      {rows.length === 0 ? (
        <p className="px-3.5 py-3 text-[12.5px] text-ink-3">No milestones are coming up.</p>
      ) : (
        <ul className="flex flex-col gap-2 px-3.5 py-2.5">
          {rows.map((m) => {
            const left = daysLeftText(m.days_left);
            return (
              <li key={m.id} className="flex items-center gap-2.5 text-[12.5px]">
                <span className="w-[46px] shrink-0 rounded-[6px] bg-violet-bg py-0.5 text-center text-[11px] font-bold text-violet-ink dark:bg-violet/25">{fmtDay(m.due_date)}</span>
                <span className="min-w-0 flex-1">
                  <b className="block truncate font-semibold text-ink">{m.name}</b>
                  <button type="button" onClick={() => onGo(projectPath(m.project_id))} className="block truncate text-start text-[11px] text-ink-3 hover:underline">
                    {m.code} · {m.project}
                  </button>
                </span>
                <span className={cx('shrink-0 text-[11px]', left.late ? 'font-semibold text-danger' : 'text-ink-3')}>{left.text}</span>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

function Workload({ rows, onGo }: { rows: NonNullable<FullDashboard['workload']>; onGo: (route: string) => void }) {
  return (
    <Panel
      title="Team workload"
      action={
        <button type="button" onClick={() => onGo('/projects/workload')} className="text-[11px] text-ink-3 hover:underline">
          open estimate ÷ weekly capacity
        </button>
      }
    >
      {rows.length === 0 ? (
        <p className="px-3.5 py-3 text-[12.5px] text-ink-3">Nobody has open work.</p>
      ) : (
        <ul className="flex flex-col gap-2 px-3.5 py-2.5">
          {rows.map((w) => (
            <li key={w.user_id} className="grid grid-cols-[120px_minmax(0,1fr)_44px] items-center gap-2 text-[12px]">
              <span className="truncate text-ink">{w.name}</span>
              <span aria-hidden="true" className="h-2 overflow-hidden rounded-full bg-subtle">
                <span className={cx('block h-full rounded-full', usedFill(w.percent))} style={{ width: `${Math.min(100, w.percent ?? 0)}%` }} />
              </span>
              <Mono className={cx('text-end', w.percent !== null && w.percent > 100 ? 'font-bold text-danger' : 'text-ink-2')}>{w.percent === null ? '—' : `${w.percent}%`}</Mono>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

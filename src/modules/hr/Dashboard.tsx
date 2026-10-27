import { useQuery } from '@tanstack/react-query';
import { app, organizationName } from '../../core/app-state';
import { apiGet } from '../../core/api';
import { useStore } from '../../core/store';
import { ErrorNote, Spinner } from '../../components/ui';
import { type HrOverview } from './api';
import { dayShort, parseYmd, ymd } from './dates';
import { btn, btnPrimary, Empty, humanise, Initials, Kpi, PageHead, Panel, StatusChip } from './parts';
import { can, type HrView } from './Rail';
import { StatGrid } from '../../components/StatCard';

/**
 * The HR dashboard (HrDashboard; hr.view): headcount, who is out today,
 * leave waiting, missing check-outs, onboarding under way, recent joiners,
 * the mix of employment types and the holidays coming up.
 */
const TYPE_COLOURS = ['#23349E', '#0E7C86', '#6B3FB5', '#B45309', '#1F7A4D', '#B42318', '#4A5168'];

export default function Dashboard({ onPick, onGo }: { onPick: (v: HrView) => void; onGo: (route: string) => void }) {
  const orgId = useStore(app, (s) => s.organizationId);
  const perms = useStore(app, (s) => s.bootstrap?.permissions);
  const q = useQuery({ queryKey: ['hr', 'overview'], queryFn: ({ signal }) => apiGet<HrOverview>('/api/hr/overview', undefined, signal) });
  const today = ymd(new Date());
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorNote error={q.error} onRetry={() => void q.refetch()} />;
  const o = q.data!;
  // The largest groups by status: "38 active · 4 probation".
  const statuses = Object.entries(o.by_status).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k, n]) => `${n} ${humanise(k).toLowerCase()}`).join(' · ');
  const onLeave = o.out_today.filter((x) => /leave/i.test(x.type)).length;
  const types = Object.entries(o.by_type).sort((a, b) => b[1] - a[1]);
  const most = Math.max(1, ...types.map(([, n]) => n));
  const daysTo = (d: string) => Math.round((parseYmd(d).getTime() - parseYmd(today).getTime()) / 86_400_000);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3.5">
      <PageHead title="Dashboard" sub={`${organizationName(orgId)} · ${parseYmd(today).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })}`}>
        <button type="button" className={btnPrimary} onClick={() => onGo('/hr?tab=people&new=1')}>
          Add employee
        </button>
        <button type="button" className={btn} onClick={() => onPick('leave')}>
          Request leave
        </button>
        <button type="button" className={btn} onClick={() => onPick('waiting')}>
          Approvals
        </button>
        {can(perms, 'directory.view') ? (
          <button type="button" className={btn} onClick={() => onPick('departments')}>
            Departments
          </button>
        ) : null}
      </PageHead>
      <StatGrid>
        <Kpi icon="users" tone="blue" label="Employees" value={o.total} sub={[statuses, o.unlinked ? `${o.unlinked} without a login` : null].filter(Boolean).join(' · ')} />
        <Kpi icon="plane" tone="violet" label="Out today" value={o.out_today.length} sub={o.out_today.length ? `${onLeave} on leave · ${o.out_today.length - onLeave} away` : 'Everyone is in'} />
        <Kpi icon="hourglass" label="Pending leave" value={o.pending_leave} sub="Click to review" tone={o.pending_leave ? 'amber' : undefined} onClick={() => onPick('waiting')} />
        <Kpi icon="door" label="Missing check-outs" value={o.open_attendance ?? 0} sub="Waiting to be settled" tone={o.open_attendance ? 'red' : undefined} onClick={() => onPick('openatt')} />
      </StatGrid>
      <div className="grid min-h-0 flex-1 grid-cols-3 gap-3">
        <Panel title="Out today">
          {o.out_today.length ? (
            o.out_today.map((x, i) => (
              <div key={i} className="flex items-center gap-2.5 border-b border-line/70 px-3.5 py-[9px]">
                <Initials name={x.name} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <b className="truncate text-ink">{x.name}</b>
                  <span className="truncate text-[12px] text-ink-3">{x.until ? `until ${dayShort(x.until)}` : 'today'}</span>
                </span>
                <StatusChip>{humanise(x.type)}</StatusChip>
              </div>
            ))
          ) : (
            <Empty text="Nobody is out today." />
          )}
        </Panel>
        <Panel title={`Onboarding in progress${o.onboarding?.total ? ` (${o.onboarding.total})` : ''}`}>
          {o.onboarding?.items.length ? (
            o.onboarding.items.map((x) => (
              <button key={x.employee_id} type="button" onClick={() => onGo(`/hr?tab=onboarding&onboarding=${x.employee_id}`)} className="flex w-full flex-col gap-[5px] border-b border-line/70 px-3.5 py-[11px] text-left hover:bg-subtle">
                <span className="flex">
                  <b className="flex-1 truncate text-ink">{x.name}</b>
                  <b className="text-primary">{x.percent}%</b>
                </span>
                <span className="h-1.5 overflow-hidden rounded-[3px] bg-info-bg dark:bg-subtle">
                  <span className="block h-1.5 bg-primary" style={{ width: `${Math.max(2, Math.min(100, x.percent))}%` }} />
                </span>
                <span className="truncate text-[12px] text-ink-3">
                  {[x.target_start_date ? `joins ${dayShort(x.target_start_date)}` : null, x.next ? `Next: ${x.next}` : null].filter(Boolean).join(' · ')}
                </span>
              </button>
            ))
          ) : (
            <Empty text="Nobody is being onboarded." />
          )}
        </Panel>
        <Panel title="Recent joiners">
          {o.recent_joiners.length ? (
            o.recent_joiners.map((x, i) => (
              <div key={i} className="flex items-center gap-2.5 border-b border-line/70 px-3.5 py-[9px]">
                <Initials name={x.name} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <b className="truncate text-ink">{x.name}</b>
                  <span className="text-[12px] text-ink-3">joined {dayShort(x.joined_at)}</span>
                </span>
              </div>
            ))
          ) : (
            <Empty text="No one has joined lately." />
          )}
        </Panel>
        <Panel title="Employment type" bodyClassName="flex flex-col gap-[9px] px-3.5 py-3">
          {types.length ? (
            types.map(([t, n], i) => (
              <div key={t} className="flex items-center gap-2.5">
                <span className="w-[90px] truncate text-ink">{humanise(t)}</span>
                <span className="h-2.5 flex-1 overflow-hidden rounded-[5px] bg-subtle">
                  <span className="block h-2.5 rounded-[5px]" style={{ width: `${(n / most) * 100}%`, background: TYPE_COLOURS[i % TYPE_COLOURS.length] }} />
                </span>
                <b className="w-6 text-right text-ink tabular-nums">{n}</b>
              </div>
            ))
          ) : (
            <span className="text-ink-3">No employees yet.</span>
          )}
        </Panel>
        <Panel title="Upcoming holidays" className="col-span-2" action={<button type="button" className="font-semibold text-primary hover:underline" onClick={() => onGo('/hr?tab=settings&section=holidays')}>Manage</button>}>
          {o.upcoming_holidays.length ? (
            o.upcoming_holidays.map((h) => {
              const n = daysTo(h.on_date);
              return (
                <div key={h.on_date + h.name} className="flex items-center gap-2.5 border-b border-line/70 px-3.5 py-[9px]">
                  <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full bg-selection text-[11px] font-bold text-primary">{parseYmd(h.on_date).getDate()}</span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <b className="truncate text-ink">{h.name}</b>
                    <span className="text-[12px] text-ink-3">{dayShort(h.on_date)}</span>
                  </span>
                  <span className="text-[12px] font-semibold text-ink-3">{n <= 0 ? 'today' : n === 1 ? 'tomorrow' : `in ${n} days`}</span>
                </div>
              );
            })
          ) : (
            <Empty text="No holidays coming up." />
          )}
        </Panel>
      </div>
    </div>
  );
}

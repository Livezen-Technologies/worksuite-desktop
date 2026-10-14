import { useQuery } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { apiGet } from '../../core/api';
import { relative } from '../../core/time';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { btn, btnPrimary, PageHead, Panel, Seg, StatusChip } from '../hr/parts';
import { useDashboard, type DashboardDetail } from './api';
import { BarRow, Kpi, ListLine, money, stageColour } from './parts';
import type { CrmView } from './Rail';
import { useCrmScope } from './scope';
import { ApprovalsPanel } from './Approvals';

/**
 * The CRM dashboard (CrmDashboard, desk-dashboard): my pipeline or the
 * team's, for the company the CRM is showing — four headline figures (open
 * deals, weighted forecast, won this month, win rate) and four more under
 * them, then the pipeline by stage beside follow-ups and stalled deals, and
 * recent activity; leads by status, quotes out, who is carrying the
 * pipeline, lead sources and where leads arrive below. Estimates and
 * proposals waiting for my approval sit at the top, when there are any. Two requests, as on
 * the web: the first half paints at once, the heavier second half fills in.
 */
export default function Dashboard({ onPick, onNewLead, onOpenDeal, onOpenLead, onOpenProposal, onOpenEstimate }: { onPick: (v: CrmView) => void; onNewLead: () => void; onOpenDeal: (id: number) => void; onOpenLead: (id: number) => void; onOpenProposal?: (id: number) => void; onOpenEstimate?: (id: number) => void }) {
  const [mine, setMine] = useState(true);
  const scope = useCrmScope();
  const q = useDashboard(mine, scope.params);
  const detail = useQuery({ queryKey: ['crm', 'dashboard-detail', mine, scope.orgId ?? 0], queryFn: ({ signal }) => apiGet<DashboardDetail>('/api/crm/dashboard/detail', { ...(mine ? { mine: 1 } : {}), ...scope.params }, signal) });
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorNote error={q.error} onRetry={() => void q.refetch()} />;
  const d = q.data!;
  const k = d.kpi;
  const currency = d.stalled[0]?.currency ?? detail.data?.quotes.expiring[0]?.currency ?? 'LKR';
  const stageMax = Math.max(1, ...d.stages.map((s) => s.total));
  const leadTotal = Math.max(1, ...Object.values(d.lead_status));
  const sourceMax = Math.max(1, ...d.lead_sources.map((s) => s.count));
  const fu = detail.data?.followups;
  const staleDays = d.stale_days ?? detail.data?.stale_days ?? 21;
  const open = (x: { subject_type: string; subject_id: number }) => (x.subject_type === 'lead' ? () => onOpenLead(x.subject_id) : x.subject_type === 'deal' ? () => onOpenDeal(x.subject_id) : undefined);

  return (
    <div className="@container flex flex-col gap-3">
      <PageHead title={mine ? 'My pipeline' : 'Team pipeline'} sub={[d.pipeline?.name ?? 'Sales pipeline', scope.name].join(' · ')}>
        <Seg label="Whose pipeline" value={mine ? 'mine' : 'team'} onChange={(v) => setMine(v === 'mine')} options={[{ id: 'mine', label: 'Mine' }, { id: 'team', label: 'Team' }]} />
        <button type="button" className={btnPrimary} onClick={onNewLead}>
          New lead
        </button>
        <button type="button" className={btn} onClick={() => onPick('fu')}>
          Follow-ups
        </button>
        <button type="button" className={btn} onClick={() => onPick('pipe')}>
          Pipeline board
        </button>
      </PageHead>

      <ApprovalsPanel onOpen={(r) => (r.doc === 'proposal' ? onOpenProposal?.(r.doc_id) : onOpenEstimate?.(r.doc_id))} />

      <div className="grid grid-cols-2 gap-2.5 @min-[760px]:grid-cols-4">
        <Kpi label="Open deals" value={k.open_deals} sub={money(k.open_value, currency)} onClick={() => onPick('pipe')} />
        <Kpi label="Weighted forecast" value={money(k.forecast, currency)} sub="value × stage probability" tone="blue" />
        <Kpi label="Won this month" value={money(k.won_month, currency)} sub={`${k.won_month_count} ${k.won_month_count === 1 ? 'deal' : 'deals'}`} tone="green" />
        <Kpi label="Win rate" value={k.win_rate === null ? '—' : `${k.win_rate}%`} sub={k.win_rate === null ? 'nothing decided yet' : `${k.won_month_count} won · ${k.lost_month_count} lost`} />
      </div>
      <div className="grid grid-cols-2 gap-2.5 @min-[760px]:grid-cols-4">
        <Kpi size="sm" label="New leads" value={k.leads_new} sub={`${k.leads_open} being worked`} onClick={() => onPick('leads')} />
        <Kpi size="sm" label="Stalled deals" value={d.stalled.length} sub={`no stage change in ${staleDays} days`} tone={d.stalled.length ? 'red' : 'plain'} onClick={() => onPick('pipe')} />
        <Kpi size="sm" label="Tasks due today" value={k.tasks_today} sub="from the Tasks module" />
        <Kpi size="sm" label="Meetings today" value={k.meetings_today} sub="from the Meetings module" />
      </div>

      <div className="grid items-start gap-3 @min-[900px]:grid-cols-[1.3fr_1fr]">
        <Panel title="Pipeline by stage" action={<Link onClick={() => onPick('pipe')}>Open board</Link>} bodyClassName="flex flex-col px-3.5 py-1.5">
          {d.stages.map((s) => (
            <StageRow key={s.id} label={`${s.name} · ${s.probability}%`} value={money(s.total, currency)} pct={(s.total / stageMax) * 100} colour={s.kind === 'won' ? '#34D399' : stageColour(s.colour)} />
          ))}
          {!d.stages.length ? <p className="m-0 py-2 text-[12.5px] text-ink-3">No pipeline yet.</p> : null}
          <p className="m-0 py-2 text-[12px] text-ink-2">
            Weighted forecast <b className="text-ink">{money(k.forecast, currency)}</b>
          </p>
        </Panel>
        <div className="flex min-w-0 flex-col gap-3">
          <Panel title="Follow-ups" action={<Link onClick={() => onPick('fu')}>Open the list</Link>}>
            <div className="grid grid-cols-3 gap-2 px-3.5 py-2.5">
              {[
                ['Late', fu?.overdue ?? 0, 'bg-[#FCE9E4] text-[#8C2A14] dark:bg-danger-bg dark:text-danger'],
                ['Today', fu?.today ?? 0, 'bg-[#FFF4E0] text-[#9A4A06] dark:bg-warning-bg dark:text-warning'],
                ['Later', fu?.upcoming ?? 0, 'bg-selection text-primary'],
              ].map(([l, v, c]) => (
                <button key={l as string} type="button" onClick={() => onPick('fu')} className={cx('rounded-[8px] px-2.5 py-2 text-left', c as string)}>
                  <div className="text-[12px] font-semibold">{l}</div>
                  <b className="text-[20px] leading-tight tabular-nums">{v}</b>
                </button>
              ))}
            </div>
            {(fu?.next ?? []).slice(0, 3).map((x) => (
              <ListLine key={x.id} title={x.who} sub={[x.kind, x.assignee].filter(Boolean).join(' · ')} right={x.late ? <StatusChip>Late</StatusChip> : <span className="text-[12px] font-bold text-ink-2">{relative(x.due_at)}</span>} onClick={() => onOpenLead(x.lead_id)} />
            ))}
          </Panel>
          <Panel title={`Stalled deals · ${staleDays} days`}>
            {d.stalled.slice(0, 4).map((x) => (
              <ListLine key={x.id} title={x.name} sub={x.account ?? 'No account'} right={<span className="flex flex-col items-end"><b className="text-[12.5px] text-ink tabular-nums">{money(x.amount, x.currency)}</b><span className="text-[11.5px] font-bold text-danger">{x.days} d</span></span>} onClick={() => onOpenDeal(x.id)} />
            ))}
            {!d.stalled.length ? <p className="m-0 px-3.5 py-3 text-[12.5px] text-ink-3">Nothing has stood still.</p> : null}
          </Panel>
        </div>
      </div>

      <Panel title="Recent activity">
        {d.recent.slice(0, 6).map((x, i) => (
          <ListLine key={`${x.subject_type}-${x.subject_id}-${i}`} title={x.title} right={<span className="shrink-0 text-[11.5px] text-ink-3">{`${x.author ?? 'System'} · ${relative(x.at)}`}</span>} onClick={open(x)} />
        ))}
        {!d.recent.length ? <p className="m-0 px-3.5 py-3 text-[12.5px] text-ink-3">Nothing yet.</p> : null}
      </Panel>

      <div className="grid items-start gap-3 @min-[900px]:grid-cols-3">
        <Panel title="Leads by status" action={<Link onClick={() => onPick('leads')}>View all</Link>} bodyClassName="flex flex-col gap-2 px-3.5 py-2.5">
          {Object.entries(d.lead_status).map(([status, n]) => (
            <BarRow key={status} label={status} value={n} pct={(n / leadTotal) * 100} />
          ))}
          {!Object.keys(d.lead_status).length ? <p className="m-0 text-[12.5px] text-ink-3">No leads yet.</p> : null}
        </Panel>
        <Panel title="Quotes out" action={<Link onClick={() => onPick('quotes')}>Quotes</Link>}>
          {detail.data ? (
            <>
              <p className="m-0 px-3.5 py-2 text-[12.5px] text-ink-2">
                {detail.data.quotes.open} sent, {money(detail.data.quotes.open_value, currency)} · {detail.data.quotes.accepted} accepted.
              </p>
              {detail.data.quotes.expiring.slice(0, 3).map((x) => (
                <ListLine key={x.id} title={`${x.account ?? 'No account'} · ${x.number}`} sub={`${money(x.total, x.currency)} · to ${x.valid_until}`} right={<StatusChip>Sent</StatusChip>} />
              ))}
            </>
          ) : (
            <Spinner />
          )}
        </Panel>
        <Panel title="Who is carrying the pipeline">
          {(detail.data?.owners ?? []).slice(0, 5).map((x) => (
            <ListLine key={x.name} title={x.name || 'Nobody yet'} sub={`${x.deals} ${x.deals === 1 ? 'deal' : 'deals'}`} right={<b className="text-[12px] text-ink tabular-nums">{money(x.value, currency)}</b>} />
          ))}
          {detail.data && !detail.data.owners.length ? <p className="m-0 px-3.5 py-3 text-[12.5px] text-ink-3">No open deals.</p> : null}
        </Panel>
      </div>

      <div className="grid items-start gap-3 @min-[900px]:grid-cols-2">
        <Panel title="Lead sources" bodyClassName="flex flex-col gap-2 px-3.5 py-2.5">
          {d.lead_sources.slice(0, 6).map((s) => (
            <BarRow key={s.source} label={s.source || 'Not given'} value={s.count} pct={(s.count / sourceMax) * 100} colour="#0E7C86" />
          ))}
          {!d.lead_sources.length ? <p className="m-0 text-[12.5px] text-ink-3">No leads yet.</p> : null}
        </Panel>
        <Panel title="Where your leads arrive">
          {(detail.data?.intake.sources ?? []).map((w) => {
            const quiet = !w.active || w.received === 0;
            return (
              <div key={w.id} className="flex flex-col gap-[3px] border-b border-line/60 px-3.5 py-2 last:border-b-0">
                <span className="flex">
                  <b className={cx('min-w-0 flex-1 truncate text-[12.5px]', quiet ? 'text-ink-3 line-through' : 'text-ink')}>{w.name}</b>
                  <span className="text-[12px] font-bold text-ink">{w.created} new</span>
                </span>
                <span className={cx('text-[11.5px]', quiet ? 'text-danger' : 'text-ink-3')}>
                  {quiet ? `Nothing since ${detail.data?.intake.from ?? 'the start of the period'} — nothing has become a lead.` : [w.duplicate ? `${w.duplicate} already known` : null, w.refused ? `${w.refused} refused` : null].filter(Boolean).join(' · ') || `${w.received} received`}
                </span>
              </div>
            );
          })}
          {detail.data && !detail.data.intake.sources.length ? <p className="m-0 px-3.5 py-3 text-[12.5px] text-ink-3">No intake sources set up.</p> : null}
        </Panel>
      </div>
    </div>
  );
}

/** A stage in the design's form: its name and probability, the bar, the value at the right. */
function StageRow({ label, value, pct, colour }: { label: string; value: string; pct: number; colour: string }) {
  return (
    <div className="flex items-center gap-2.5 border-b border-line/60 py-2 text-[12.5px] last:border-b-0">
      <span className="w-[140px] shrink-0 truncate text-ink-2">{label}</span>
      <span className="h-[7px] min-w-0 flex-1 overflow-hidden rounded-full bg-subtle">
        <span className="block h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, pct))}%`, background: colour }} />
      </span>
      <b className="w-[100px] shrink-0 text-right text-ink tabular-nums">{value}</b>
    </div>
  );
}

function Link({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="text-[12.5px] font-semibold text-primary hover:underline">
      {children}
    </button>
  );
}

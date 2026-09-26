import { useQuery } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { apiGet } from '../../core/api';
import { relative } from '../../core/time';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { btn, btnPrimary, PageHead, Panel, Seg, StatusChip } from '../hr/parts';
import { useDashboard, type DashboardDetail } from './api';
import { BarRow, ListLine, money, stageColour } from './parts';
import type { CrmView } from './Rail';

/**
 * The CRM dashboard (CrmDashboard): my pipeline or the team's — eight
 * figures, then the pipeline by stage, leads by status, follow-ups, stalled
 * deals, quotes out, who is carrying the pipeline, lead sources, where leads
 * arrive, and recent activity. Two requests, as on the web: the first half
 * paints at once, the heavier second half fills in.
 */
export default function Dashboard({ onPick, onOpenDeal, onOpenLead }: { onPick: (v: CrmView) => void; onOpenDeal: (id: number) => void; onOpenLead: (id: number) => void }) {
  const [mine, setMine] = useState(true);
  const q = useDashboard(mine);
  const detail = useQuery({ queryKey: ['crm', 'dashboard-detail', mine], queryFn: ({ signal }) => apiGet<DashboardDetail>('/api/crm/dashboard/detail', mine ? { mine: 1 } : undefined, signal) });
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

  const tiles: Array<{ l: string; v: ReactNode; sub: ReactNode; to?: CrmView; tone?: 'green' | 'red' }> = [
    { l: 'Open deals', v: k.open_deals, sub: money(k.open_value, currency), to: 'pipe' },
    { l: 'Weighted forecast', v: money(k.forecast, currency), sub: 'value × stage probability' },
    { l: 'Won this month', v: money(k.won_month, currency), sub: `${k.won_month_count} ${k.won_month_count === 1 ? 'deal' : 'deals'}`, tone: 'green' },
    { l: 'Win rate', v: k.win_rate === null ? '—' : `${k.win_rate}%`, sub: k.win_rate === null ? 'nothing decided yet' : `${k.won_month_count} won · ${k.lost_month_count} lost` },
    { l: 'New leads', v: k.leads_new, sub: `${k.leads_open} being worked`, to: 'leads' },
    { l: 'Tasks due today', v: k.tasks_today, sub: 'from the Tasks module' },
    { l: 'Meetings today', v: k.meetings_today, sub: 'from the Meetings module' },
    { l: 'Stalled deals', v: d.stalled.length, sub: `no stage change in ${staleDays} days`, to: 'pipe', tone: d.stalled.length ? 'red' : undefined },
  ];

  return (
    <div className="@container flex flex-col gap-3.5">
      <PageHead title={mine ? 'My pipeline' : 'Team pipeline'} sub={d.pipeline?.name ?? 'Sales pipeline'}>
        <Seg label="Whose pipeline" value={mine ? 'mine' : 'team'} onChange={(v) => setMine(v === 'mine')} options={[{ id: 'mine', label: 'Mine' }, { id: 'team', label: 'Team' }]} />
        <button type="button" className={btnPrimary} onClick={() => onPick('leads')}>
          New lead
        </button>
        <button type="button" className={btn} onClick={() => onPick('fu')}>
          Follow-ups
        </button>
        <button type="button" className={btn} onClick={() => onPick('pipe')}>
          Pipeline board
        </button>
      </PageHead>

      <div className="grid grid-cols-4 gap-2 @min-[1100px]:grid-cols-8">
        {tiles.map((t) => {
          const body = (
            <>
              <span className="text-[11.5px] font-semibold text-ink-3">{t.l}</span>
              <b className={cx('truncate text-[18px] tabular-nums', t.tone === 'green' ? 'text-[#145C39] dark:text-success' : t.tone === 'red' ? 'text-[#B42318] dark:text-danger' : 'text-ink')}>{t.v}</b>
              <span className="text-[11px] leading-[1.3] text-ink-3">{t.sub}</span>
            </>
          );
          const cls = 'flex min-w-0 flex-col gap-px rounded-[12px] border border-line bg-surface px-[11px] py-2.5 text-left';
          return t.to ? (
            <button key={t.l} type="button" className={cx(cls, 'hover:border-primary/40')} onClick={() => onPick(t.to!)}>
              {body}
            </button>
          ) : (
            <div key={t.l} className={cls}>
              {body}
            </div>
          );
        })}
      </div>

      <div className="grid items-start gap-3 @min-[900px]:grid-cols-2 @min-[1100px]:grid-cols-[1.1fr_1fr_1fr]">
        <Panel title="Pipeline by stage" action={<Link onClick={() => onPick('pipe')}>Open board</Link>} bodyClassName="flex flex-col gap-2 px-3.5 py-2.5">
          {d.stages.map((s) => (
            <BarRow key={s.id} label={`${s.name} · ${s.probability}%`} value={money(s.total, currency)} pct={(s.total / stageMax) * 100} colour={stageColour(s.colour)} />
          ))}
          {!d.stages.length ? <p className="m-0 text-[12.5px] text-ink-3">No pipeline yet.</p> : null}
          <p className="m-0 pt-1 text-[12px] text-ink-2">
            Weighted forecast <b className="text-ink">{money(k.forecast, currency)}</b>
          </p>
        </Panel>
        <Panel title="Leads by status" action={<Link onClick={() => onPick('leads')}>View all</Link>} bodyClassName="flex flex-col gap-2 px-3.5 py-2.5">
          {Object.entries(d.lead_status).map(([status, n]) => (
            <BarRow key={status} label={status} value={n} pct={(n / leadTotal) * 100} />
          ))}
          {!Object.keys(d.lead_status).length ? <p className="m-0 text-[12.5px] text-ink-3">No leads yet.</p> : null}
        </Panel>
        <Panel title="Follow-ups" action={<Link onClick={() => onPick('fu')}>Open the list</Link>}>
          <div className="grid grid-cols-3 gap-1.5 px-3.5 pt-2.5 pb-1">
            {[
              ['Late', fu?.overdue ?? 0, 'bg-[#FCE9E4] text-[#8C2A14] dark:bg-danger-bg dark:text-danger'],
              ['Today', fu?.today ?? 0, 'bg-[#FFF4E0] text-[#9A4A06] dark:bg-warning-bg dark:text-warning'],
              ['Later', fu?.upcoming ?? 0, 'bg-selection text-primary'],
            ].map(([l, v, c]) => (
              <div key={l as string} className={cx('rounded-[8px] px-2 py-1.5', c as string)}>
                <div className="text-[11px] font-semibold">{l}</div>
                <b className="text-[16px] tabular-nums">{v}</b>
              </div>
            ))}
          </div>
          {(fu?.next ?? []).slice(0, 4).map((x) => (
            <ListLine key={x.id} title={x.who} sub={[x.kind, x.assignee].filter(Boolean).join(' · ')} right={x.late ? <StatusChip>Late</StatusChip> : <span className="text-[12px] font-bold text-ink-2">{relative(x.due_at)}</span>} onClick={() => onOpenLead(x.lead_id)} />
          ))}
        </Panel>
        <Panel title={`Stalled deals · ${staleDays} days`}>
          {d.stalled.slice(0, 5).map((x) => (
            <ListLine key={x.id} title={x.name} sub={[x.account ?? 'No account', x.stage].join(' · ')} right={<StatusChip>{`${x.days} d`}</StatusChip>} onClick={() => onOpenDeal(x.id)} />
          ))}
          {!d.stalled.length ? <p className="m-0 px-3.5 py-3 text-[12.5px] text-ink-3">Nothing has stood still.</p> : null}
        </Panel>
        <Panel title="Quotes out">
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

      <div className="grid items-start gap-3 @min-[900px]:grid-cols-[1fr_1fr_1.2fr]">
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
        <Panel title="Recent activity">
          {d.recent.slice(0, 6).map((x, i) => (
            <ListLine key={`${x.subject_type}-${x.subject_id}-${i}`} title={x.title} sub={`${x.author ?? 'System'} · ${relative(x.at)}`} onClick={x.subject_type === 'lead' ? () => onOpenLead(x.subject_id) : x.subject_type === 'deal' ? () => onOpenDeal(x.subject_id) : undefined} />
          ))}
          {!d.recent.length ? <p className="m-0 px-3.5 py-3 text-[12.5px] text-ink-3">Nothing yet.</p> : null}
        </Panel>
      </div>
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

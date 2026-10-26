import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { dateLabel, relative, timeLabel } from '../../core/time';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { Kpi, PageHead, Panel } from '../hr/parts';
import { Line, ListPanel, Pill } from '../inventory/parts';
import { fetchDetail, K, money, moneyList, type Dashboard as Data } from './api';
import { Left, subline } from './parts';
import { StatGrid } from '../../components/StatCard';

/**
 * The Tenders front page: what is open and where, the win rate, the value in
 * play per currency; then how ready each bid is against how long is left,
 * bids that closed and were never moved on, what is waiting for sign-off,
 * bonds about to lapse, meetings coming up and whether the feeds still bring
 * anything in. The second half is its own request — it scores every open bid's
 * checklist — so the figures above never wait for it.
 */
export default function Dashboard({ data, org, onOpen, onGo }: { data: UseQueryResult<Data>; org: string; onOpen: (id: number) => void; onGo: (view: string) => void }) {
  const detail = useQuery({ queryKey: K.detail(org), queryFn: ({ signal }) => fetchDetail(org, signal), refetchInterval: 300_000 });
  if (data.isLoading) return <Spinner />;
  if (data.error || !data.data) return <ErrorNote error={data.error} onRetry={() => void data.refetch()} />;
  const d = data.data;
  const c = d.counts;
  const m = detail.data;

  return (
    <div className="flex flex-col gap-3.5 px-6 py-5">
      <PageHead title="Tenders" sub="What is coming in, what is going out, and what came back" />
      <StatGrid>
        <Kpi icon="file-text" tone="blue" label="Open" value={c.open ?? 0} sub="Every stage before a decision" onClick={() => onGo('board')} />
        <Kpi icon="compose" tone="violet" label="Being prepared" value={(c.preparing ?? 0) + (c.ready ?? 0)} sub={c.ready ? `${c.ready} ready to submit` : 'Documents, review, approval'} onClick={() => onGo('preparing')} />
        <Kpi icon="hourglass" tone="amber" label="Awaiting a decision" value={(c.submitted ?? 0) + (c.evaluation ?? 0)} sub="Submitted or under evaluation" onClick={() => onGo('submitted')} />
        <Kpi
          icon="trophy"
          label="Win rate"
          value={d.win_rate.percent === null ? '—' : `${d.win_rate.percent}%`}
          sub={d.win_rate.decided ? `${d.win_rate.won} won of ${d.win_rate.decided} decided` : 'Nothing decided yet'}
          tone={d.win_rate.percent !== null && d.win_rate.percent >= 50 ? 'green' : undefined}
        />
      </StatGrid>

      <div className="grid grid-cols-2 gap-3.5">
        <Panel title="Ready to go out" sub="Mandatory documents only · least time and most missing first" bodyClassName="flex flex-col">
          {detail.isLoading ? (
            <Spinner />
          ) : m?.readiness.length ? (
            m.readiness.slice(0, 8).map((t) => (
              <button key={t.id} type="button" onClick={() => onOpen(Number(t.id))} className="flex items-center gap-3 border-b border-line/60 px-3.5 py-2 text-left last:border-b-0 hover:bg-subtle">
                <span className="flex min-w-0 flex-1 flex-col">
                  <b className="truncate text-[12.5px] text-ink">{t.title}</b>
                  <span className="truncate text-[11.5px] text-ink-3">
                    {t.required ? `${t.missing} of ${t.required} mandatory documents still outstanding` : 'No checklist'}
                    {t.days !== null ? ` · ${t.days} ${t.days === 1 ? 'day' : 'days'} left` : ''}
                  </span>
                </span>
                {t.percent === null ? (
                  <span className="text-[11.5px] text-ink-3">—</span>
                ) : (
                  <span className="flex w-[92px] shrink-0 items-center gap-1.5">
                    <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-subtle">
                      <span className={cx('block h-full rounded-full', t.percent >= 100 ? 'bg-success' : t.days !== null && t.days <= 3 ? 'bg-danger' : 'bg-primary')} style={{ width: `${Math.min(100, t.percent)}%` }} />
                    </span>
                    <b className="w-8 text-right text-[11.5px] text-ink tabular-nums">{t.percent}%</b>
                  </span>
                )}
              </button>
            ))
          ) : (
            <p className="m-0 px-3.5 py-6 text-center text-[12.5px] text-ink-3">No open bid is being prepared.</p>
          )}
        </Panel>

        <ListPanel title="Closing this week" empty="Nothing closes in the next seven days.">
          {d.due_this_week.map((t) => (
            <Line key={t.id} title={t.title} sub={subline(t.reference, t.organization) || undefined} right={<Left r={t.remaining} />} onClick={() => onOpen(t.id)} />
          ))}
        </ListPanel>

        <Panel title="Value" sub={d.value.note} bodyClassName="flex flex-col gap-2 px-3.5 py-3">
          <div className="flex flex-col">
            <span className="text-[11.5px] text-ink-3">Open pipeline, published ceiling</span>
            <b className="text-[15px] text-ink tabular-nums">{moneyList(d.value.pipeline_by_currency)}</b>
          </div>
          <div className="flex flex-col">
            <span className="text-[11.5px] text-ink-3">Awarded to us</span>
            <b className="text-[15px] text-[#145C39] tabular-nums dark:text-success">{moneyList(d.value.awarded_by_currency)}</b>
          </div>
          <div className="flex flex-col">
            <span className="text-[11.5px] text-ink-3">Company documents</span>
            <span className="text-[12.5px] text-ink">
              {d.documents.total} in the library
              {d.documents.expired ? <b className="text-danger"> · {d.documents.expired} expired</b> : null}
              {d.documents.expiring ? <b className="text-[#9A4A06] dark:text-warning"> · {d.documents.expiring} expiring soon</b> : null}
            </span>
          </div>
        </Panel>

        {m?.overdue.length ? (
          <ListPanel title="Closed, still open on the board" empty="">
            {m.overdue.map((t) => (
              <Line
                key={t.id}
                title={t.title}
                sub={[subline(t.reference, t.organization), t.closing_at ? `closed ${dateLabel(t.closing_at)}` : null].filter(Boolean).join(' · ')}
                right={t.days_ago !== null ? `${t.days_ago} ${t.days_ago === 1 ? 'day' : 'days'} ago` : undefined}
                rightClass="text-danger"
                onClick={() => onOpen(Number(t.id))}
              />
            ))}
          </ListPanel>
        ) : null}

        {m?.approvals.length ? (
          <ListPanel title="Waiting for sign-off" empty="">
            {m.approvals.map((a) => (
              <Line key={a.id} title={a.title} sub={[a.reference, `step ${a.step}`, a.role, a.approver].filter(Boolean).join(' · ')} onClick={() => onOpen(Number(a.tender_id))} />
            ))}
          </ListPanel>
        ) : null}

        {m?.securities.rows.length ? (
          <ListPanel title={`Bonds lapsing in ${m.securities.days} days`} empty="">
            {m.securities.rows.map((x) => (
              <Line
                key={x.id}
                title={x.title}
                sub={[x.tender_ref, x.kind.replace(/_/g, ' '), x.instrument, money(x.amount, x.currency)].filter(Boolean).join(' · ')}
                right={x.days !== null ? `${x.days} ${x.days === 1 ? 'day' : 'days'} left` : dateLabel(x.valid_until)}
                rightClass={(x.days ?? 99) <= 7 ? 'text-danger' : 'text-[#9A4A06] dark:text-warning'}
                onClick={() => onOpen(Number(x.tender_id))}
              />
            ))}
          </ListPanel>
        ) : null}

        {m?.meetings.rows.length ? (
          <ListPanel title={`Meetings in the next ${m.meetings.days} days`} empty="">
            {m.meetings.rows.map((x) => (
              <Line
                key={x.id}
                title={x.title}
                sub={[x.kind.replace(/_/g, ' '), x.mode, x.venue].filter(Boolean).join(' · ')}
                right={
                  <span className="flex flex-col items-end">
                    <span>
                      {dateLabel(x.at)}, {timeLabel(x.at)}
                    </span>
                    {x.mandatory ? <Pill tone="amber">Attendance is mandatory</Pill> : null}
                  </span>
                }
                onClick={() => onOpen(Number(x.tender_id))}
              />
            ))}
          </ListPanel>
        ) : null}

        {m?.sources.length ? (
          <ListPanel title="Where tenders come from" empty="">
            {m.sources.map((s) => (
              <Line
                key={s.id}
                title={s.name}
                sub={s.enabled ? (s.imported_30 || s.seen_30 ? `${s.imported_30} kept of ${s.seen_30} seen in 30 days` : 'Nothing at all in 30 days.') : 'Switched off'}
                right={s.last_run_at ? relative(s.last_run_at) : 'Never run'}
                rightClass={s.enabled && !s.seen_30 ? 'text-[#9A4A06] dark:text-warning' : 'text-ink-3'}
              />
            ))}
          </ListPanel>
        ) : null}
      </div>
    </div>
  );
}

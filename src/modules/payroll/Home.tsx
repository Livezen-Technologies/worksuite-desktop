import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { app } from '../../core/app-state';
import { useStore } from '../../core/store';
import { Icon } from '../../components/Icon';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { shortDate } from '../finance/api';
import { fetchRuns, K, STATUS_LABEL, runTitle, type Dashboard } from './api';
import { Badge, Card, Kbd, NotYet, Table, amt, td, tdr, useReadOnly } from './parts';
import type { PayView } from './Rail';

/**
 * Payroll home (D01): the period, the current run's figures, what needs attention, this period's runs with the next
 * step, the 12-month trend and the pay calendar. All of it from `GET /dashboard`; an older server without it gets
 * the runs list and a line saying the rest needs Payroll 1.2.
 */
export default function Home({ data, figures, onNew, onGo, onRun }: { data: UseQueryResult<Dashboard | null>; figures: boolean; onNew: () => void; onGo: (v: PayView, extra?: string) => void; onRun: (id: number, approve?: boolean) => void }) {
  const ro = useReadOnly();
  const name = useStore(app, (s) => s.auth?.user?.name ?? '');
  const runs = useQuery({ queryKey: K.runs('', 1), queryFn: ({ signal }) => fetchRuns('', 1, signal) });
  const d = data.data;
  const hour = new Date().getHours();
  const hello = `${hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'}${name ? `, ${name.split(' ')[0]}` : ''}`;
  const period = d?.next_period;
  const recent = (runs.data?.items ?? []).filter((r) => !period || r.period_id === period.id || (runs.data?.items ?? []).indexOf(r) < 6).slice(0, 6);
  const trend = d?.trend ?? [];
  const peak = Math.max(1, ...trend.map((t) => Number(t.gross ?? 0)));
  const next = (status: string): { label: string; approve?: boolean } | null =>
    status === 'submitted' ? { label: 'Approve', approve: true } : status === 'draft' || status === 'calculated' ? { label: status === 'draft' ? 'Calculate' : 'Submit' } : status === 'locked' ? { label: 'Pay' } : null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-2.5">
        <div className="min-w-0 flex-1">
          {period ? <div className="text-[11px] font-bold tracking-[.8px] text-[#23349E] uppercase dark:text-primary">{`${period.name} · period open`}</div> : null}
          <h1 className="m-0 mt-0.5 text-[21px] font-extrabold tracking-[-.3px] text-ink">{hello}</h1>
          {period?.payment_date ? <div className="mt-0.5 text-[12px] text-ink-2">{`Next pay date ${shortDate(period.payment_date)}${period.days_to_cutoff != null && period.days_to_cutoff >= 0 ? ` · cut-off in ${period.days_to_cutoff} ${period.days_to_cutoff === 1 ? 'day' : 'days'}` : ''}`}</div> : null}
        </div>
        <button type="button" className="inline-flex h-8 items-center gap-1.5 rounded-[7px] border border-line bg-surface px-3 text-[12.5px] font-semibold text-ink hover:bg-subtle" onClick={() => onGo('inputs')}>
          Period inputs
        </button>
        <button type="button" disabled={ro} className="inline-flex h-8 items-center gap-1.5 rounded-[7px] bg-primary px-3 text-[12.5px] font-bold text-white hover:bg-primary-hover disabled:opacity-50" onClick={onNew}>
          <Icon name="plus" size={14} /> New run <Kbd>⌘N</Kbd>
        </button>
      </div>

      {data.isLoading ? <Spinner /> : data.error ? <ErrorNote error={data.error} onRetry={() => void data.refetch()} /> : null}
      {data.data === null ? <Card><NotYet what="The payroll home" /></Card> : null}

      {d ? (
        <div className="grid grid-cols-4 gap-2.5">
          <Tile label="Current run · net pay" value={figures ? amt(d.current_run?.net_total) : '—'} sub={d.current_run ? `${d.current_run.employee_count} people · ${STATUS_LABEL[d.current_run.status] ?? d.current_run.status}` : 'No run yet'} onClick={d.current_run ? () => onRun(d.current_run!.id) : undefined} />
          <Tile label="Waiting for approval" value={String(d.pending_approvals)} sub="Runs in review" onClick={() => onGo('runs')} />
          <Tile label="Unposted" value={String(d.unposted.runs + d.unposted.payments)} sub={`${d.unposted.runs} runs · ${d.unposted.payments} payments`} />
          <Tile label="Blocking issues" value={String(d.open_exceptions)} sub={d.open_exceptions ? 'Fix before approval' : 'None open'} bad={d.open_exceptions > 0} onClick={d.current_run ? () => onRun(d.current_run!.id) : undefined} />
        </div>
      ) : null}

      <div className="grid grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)] gap-2.5">
        <Card title="Runs this period" action={<button type="button" className="text-[12px] font-semibold text-primary hover:underline" onClick={() => onGo('runs')}>All runs</button>}>
          {runs.isLoading ? <Spinner /> : null}
          <Table head={['Run', ['Staff', 'r'], 'Pay date', 'Status', ['Next', 'r']]}>
            {recent.map((r) => {
              const n = next(r.status);
              return (
                <tr key={r.id}>
                  <td className={td}>
                    <button type="button" className="font-bold hover:underline" onClick={() => onRun(r.id)}>
                      {r.group_name ?? runTitle(r)}
                    </button>
                    <div className="text-[11px] text-ink-2">{[r.period_name, r.currency].filter(Boolean).join(' · ')}</div>
                  </td>
                  <td className={tdr}>{r.employee_count ?? '—'}</td>
                  <td className={td}>{r.period_ends_on ? shortDate(r.period_ends_on) : '—'}</td>
                  <td className={td}><Badge status={r.status}>{STATUS_LABEL[r.status] ?? r.status}</Badge></td>
                  <td className={tdr}>
                    {n ? (
                      <button type="button" className="font-bold text-primary hover:underline" onClick={() => (n.label === 'Pay' ? onGo('disbursements', `&run=${r.id}`) : onRun(r.id, n.approve))}>
                        {n.label}
                      </button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </Table>
        </Card>
        <Card title="Needs attention">
          <div className="flex flex-col gap-2 px-3.5 pb-3 text-[12px]">
            {d ? (
              <>
                <Attn tone="red" show={d.open_exceptions > 0} text={`${d.open_exceptions} blocking ${d.open_exceptions === 1 ? 'issue' : 'issues'} on the current run`} onClick={d.current_run ? () => onRun(d.current_run!.id) : undefined} />
                <Attn tone="amber" show={d.settlements_open > 0} text={`${d.settlements_open} final ${d.settlements_open === 1 ? 'settlement' : 'settlements'} waiting`} onClick={() => onGo('settlements')} />
                <Attn tone="amber" show={d.unposted.runs + d.unposted.payments > 0} text={`${d.unposted.runs + d.unposted.payments} not in the books yet`} onClick={() => onGo('disbursements')} />
                <Attn tone="amber" show={d.inputs_open > 0} text={`${d.inputs_open} inputs waiting for the run`} onClick={() => onGo('inputs')} />
                <Attn tone="amber" show={!!d.blackout?.active} text={d.blackout ? `Payroll window ${shortDate(d.blackout.from)} – ${shortDate(d.blackout.to)}: updates wait until it closes` : ''} />
                {!d.open_exceptions && !d.settlements_open && !d.unposted.runs && !d.unposted.payments && !d.inputs_open ? <span className="text-ink-3">Nothing needs you.</span> : null}
              </>
            ) : (
              <span className="text-ink-3">—</span>
            )}
          </div>
        </Card>
      </div>

      {trend.length ? (
        <div className="grid grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)] gap-2.5">
          <Card title="Gross pay, last 12 months">
            <div role="img" aria-label={`Gross pay for the last ${trend.length} periods`} className="mx-3.5 mt-1 flex h-[150px] items-end gap-2 border-b border-line pb-0.5">
              {trend.map((t, i) => (
                <div key={t.period} title={`${t.period}: ${amt(t.gross)}`} className={cx('flex-1 rounded-t-[3px]', i === trend.length - 1 ? 'bg-[#23349E] dark:bg-primary' : 'bg-[#C2CBF2] dark:bg-primary/40')} style={{ height: `${Math.max(2, (Number(t.gross ?? 0) / peak) * 100)}%` }} />
              ))}
            </div>
            <div className="mx-3.5 mt-1 mb-3 flex gap-2 text-center text-[10.5px] text-ink-2">
              {trend.map((t) => (
                <span key={t.period} className="min-w-0 flex-1 truncate">{t.period}</span>
              ))}
            </div>
          </Card>
          <Card title="Pay calendar">
            <div className="flex flex-col gap-1.5 px-3.5 pb-3 text-[12px]">
              {period?.attendance_cutoff ? <Cal day={period.attendance_cutoff} text="Input cut-off" /> : null}
              {period?.payment_date ? <Cal day={period.payment_date} text="Pay date" strong /> : null}
              <span className="mt-1 text-[11px] text-ink-2">Reminders arrive in the tray, even when this tab is closed.</span>
            </div>
          </Card>
        </div>
      ) : null}
    </div>
  );
}

function Tile({ label, value, sub, bad, onClick }: { label: string; value: string; sub: string; bad?: boolean; onClick?: () => void }) {
  const body = (
    <>
      <div className="text-[11px] font-semibold text-ink-2">{label}</div>
      <div className={cx('mt-0.5 text-[20px] font-extrabold tabular-nums', bad ? 'text-danger' : 'text-ink')}>{value}</div>
      <div className={cx('text-[11px]', bad ? 'font-semibold text-danger' : 'text-ink-2')}>{sub}</div>
    </>
  );
  const cls = cx('rounded-[10px] border bg-surface px-3.5 py-[11px] text-left', bad ? 'border-[#F2C4BE] dark:border-danger/40' : 'border-line');
  return onClick ? (
    <button type="button" className={cx(cls, 'hover:bg-subtle')} onClick={onClick}>
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  );
}

function Attn({ tone, show, text, onClick }: { tone: 'red' | 'amber'; show: boolean; text: string; onClick?: () => void }) {
  if (!show) return null;
  return (
    <button type="button" onClick={onClick} disabled={!onClick} className="flex gap-2 text-left text-ink enabled:hover:underline">
      <span aria-hidden className={cx('mt-[5px] size-[7px] shrink-0 rounded-full', tone === 'red' ? 'bg-[#D92D20]' : 'bg-[#D97706]')} />
      <span>{text}</span>
    </button>
  );
}

function Cal({ day, text, strong }: { day: string; text: string; strong?: boolean }) {
  return (
    <div className="flex gap-2.5">
      <b className={cx('w-[52px] shrink-0', strong ? 'text-[#23349E] dark:text-primary' : 'text-ink-2')}>{shortDate(day).replace(/ \d{4}$/, '')}</b>
      <span className={strong ? 'font-bold' : ''}>{text}</span>
    </div>
  );
}

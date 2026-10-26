import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Button } from '../../components/ui';
import { arriving, dayLabel, fetchDashboard, K, lateBy, laneOf, primaryMove, type Appointment, type Lane } from './api';
import { EDGE, Head, Kbd, Pill, useDesk, useMove } from './parts';

/**
 * D01 · Today board: Arriving (late, and the next two hours), Waiting, In service and To check out, each card with the
 * one move the server says comes next. The counts are the server's dashboard; the board refreshes every half minute.
 */
const LANES: Array<[Lane, string]> = [
  ['arriving', 'Arriving'],
  ['waiting', 'Waiting'],
  ['in_service', 'In service'],
  ['checkout', 'To check out'],
];

export default function Today({ date, onAlerts }: { date: string; onAlerts: () => void }) {
  const desk = useDesk();
  const move = useMove();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, []);
  const q = useQuery({ queryKey: K.dashboard(date), queryFn: ({ signal }) => fetchDashboard(date, signal), refetchInterval: 30_000 });
  const d = q.data;
  const rows = (d?.schedule ?? []).filter((a) => !desk.location || a.location.id === desk.location);
  const lane = (l: Lane) => (l === 'arriving' ? arriving(rows, now) : rows.filter((a) => laneOf(a) === l).sort((x, y) => Date.parse(x.starts_at) - Date.parse(y.starts_at)));
  const late = rows.filter((a) => laneOf(a) === 'arriving' && Date.parse(a.starts_at) < now);
  const done = d ? d.counts.completed : 0;
  const locName = desk.options?.locations.find((l) => l.id === desk.location)?.name;

  const act = (a: Appointment) => {
    const l = laneOf(a);
    if (l === 'checkout' || (l === 'in_service' && a.can.checkout)) return { label: 'Check out', run: () => desk.checkout(a.id), off: !desk.online };
    const m = primaryMove(a);
    if (!m) return null;
    return { label: m.status === 'checked_in' ? 'Check in' : m.status === 'in_service' ? 'Start' : m.status === 'completed' ? 'Complete' : m.status === 'confirmed' ? 'Confirm' : m.label, run: () => void move(a, m.status), off: false };
  };

  return (
    <div>
      <Head
        title={`Today · ${dayLabel(date, { weekday: 'long', day: 'numeric', month: 'long' })}`}
        sub={d ? `${locName ? `${locName} · ` : ''}${d.total} booked, ${done} done${d.counts.no_show ? `, ${d.counts.no_show} no-show` : ''}` : q.isError ? 'The day could not be read.' : 'Reading the day…'}
      >
        <Button variant="ghost" icon="bell" onClick={onAlerts}>Notifications</Button>
        <Button variant="secondary" icon="user-plus" onClick={desk.walkIn}>
          Walk-in<Kbd>F2</Kbd>
        </Button>
        <Button variant="primary" icon="plus" disabled={!desk.online} title={desk.online ? undefined : 'Booking needs a connection to WorkSuite.'} onClick={() => desk.book({ date })}>
          New appointment<Kbd>N</Kbd>
        </Button>
      </Head>

      {late.length ? (
        <div role="alert" className="mb-3.5 flex flex-wrap items-center gap-3 rounded-[12px] border border-[#F5C2BD] bg-[#FDECEA] px-4 py-2.5 text-[13px] text-[#7A1A12] dark:border-danger/40 dark:bg-danger/15 dark:text-danger">
          <b>{late.length === 1 ? '1 running late' : `${late.length} running late`}</b>
          <span className="min-w-0 flex-1">
            {late.slice(0, 2).map((a) => `${a.customer.name} (${a.local.start}, ${a.provider.name})`).join(' · ')}
            {late.length === 1 ? ' has not arrived. No-show can be marked now.' : ' have not arrived.'}
          </span>
          {late[0] ? <Button size="sm" variant="secondary" onClick={() => desk.open(late[0]!.id)}>Open</Button> : null}
        </div>
      ) : null}

      <div className="grid grid-cols-4 gap-3.5 max-[1100px]:grid-cols-2">
        {LANES.map(([l, title]) => {
          const list = lane(l);
          return (
            <section key={l} aria-label={title} className="flex min-h-[200px] flex-col gap-2.5 rounded-[14px] bg-[#EEF0F6] p-2.5 dark:bg-subtle">
              <div className="flex items-baseline justify-between px-1">
                <h2 className="m-0 text-[13px] font-bold text-ink">{title}</h2>
                <span className="text-[11.5px] text-ink-3">{l === 'arriving' ? `late + next 2 h · ${list.length}` : list.length}</span>
              </div>
              {list.map((a) => {
                const x = act(a);
                const lateMin = l === 'arriving' ? lateBy(a, now) : 0;
                const waited = l === 'waiting' && a.checked_in_at ? Math.max(0, Math.floor((now - Date.parse(a.checked_in_at)) / 60_000)) : 0;
                return (
                  <article key={a.id} className="rounded-[12px] border border-line bg-surface px-3 py-2.5" style={{ boxShadow: `inset 4px 0 0 ${lateMin ? EDGE.late : (EDGE[a.status] ?? '#9AA1B5')}` }}>
                    <button type="button" className="block w-full text-left" onClick={() => desk.open(a.id)}>
                      <div className="flex items-baseline justify-between gap-2 text-[12px] text-ink-3">
                        <b className="text-[14px] text-ink tabular-nums">{a.local.start}</b>
                        <span className="truncate">{a.location.name}</span>
                      </div>
                      <div className="mt-0.5 truncate text-[14px] font-bold text-ink">{a.customer.name}</div>
                      <div className="truncate text-[12.5px] text-ink-2">
                        {`${a.service.name} · ${a.provider.name}`}
                        {l === 'in_service' ? ` · ends ${a.local.end}` : ''}
                      </div>
                      {lateMin ? <Pill tone="late" className="mt-1.5">{`Late ${lateMin} min`}</Pill> : null}
                      {!lateMin && a.status === 'pending' ? <Pill tone="pending" className="mt-1.5">Pending</Pill> : null}
                      {a.deposit && a.deposit.held > 0 && l === 'arriving' ? <Pill tone="ok" className="mt-1.5 ml-1">{`Deposit ${a.deposit.currency ?? ''} ${a.deposit.held.toLocaleString()} held`}</Pill> : null}
                      {waited ? <Pill tone="info" className="mt-1.5">{`Waiting ${waited} min`}</Pill> : null}
                      {l === 'checkout' ? <Pill tone="warn" className="mt-1.5">Completed, not paid</Pill> : null}
                    </button>
                    {x ? (
                      <button type="button" disabled={x.off} onClick={x.run} className="mt-2.5 h-10 w-full rounded-[10px] bg-[#23349E] text-[13.5px] font-bold text-white hover:brightness-110 disabled:opacity-50 dark:bg-primary">
                        {x.label}
                      </button>
                    ) : null}
                  </article>
                );
              })}
              {!list.length ? <p className="m-0 px-1 text-[12px] text-ink-3">{q.isPending ? 'Reading…' : 'No one.'}</p> : null}
            </section>
          );
        })}
      </div>
    </div>
  );
}

import { useQuery } from '@tanstack/react-query';
import { Avatar, Button, Card, Chip, Empty, Spinner } from '../../components/ui';
import { amount, clockAt, fetchToday, greeting, K, longDay, minutesOf, readyToPay, type TodayBoard, type Visit } from './api';
import { AllergyChip, Failed, QuickAction, servicesOf, stylistsOf, useDesk, useNow } from './parts';

/**
 * Today at the counter (D02): who walks in next, who is late, who is in a
 * chair and until when, and the jobs the desk does most — a walk-in, a
 * booking, finding a client. The server's board for this desk's location,
 * refreshed every minute; its day and times are the salon's clock.
 */
export default function Today() {
  const desk = useDesk();
  const q = useQuery({ queryKey: K.today(desk.location.id), queryFn: ({ signal }) => fetchToday(desk.location.id, signal), refetchInterval: 60_000 });
  const board = q.data;
  const now = useNow(60_000);
  const hour = Math.floor(minutesOf(board?.now_label ?? clockAt(new Date(now).toISOString(), desk.location.timezone)) / 60);
  const book = desk.may('salon.visit.book');

  return (
    <div className="flex flex-col gap-4 p-6">
      <div>
        <h1 className="text-[22px] font-extrabold text-ink">{greeting(hour)}</h1>
        <p className="mt-0.5 text-[13px] text-ink-2">{board ? summary(board) : desk.location.name}</p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <QuickAction icon="user-plus" label="Walk-in" onClick={() => desk.walkIn({})} disabled={!book} />
        <QuickAction icon="calendar-check" label="New booking" onClick={() => desk.walkIn({}, true)} disabled={!book} />
        <QuickAction icon="search" label="Find a client" onClick={() => desk.go('clients')} />
        <QuickAction icon="calendar" label="The day by stylist" onClick={() => desk.go('calendar')} />
      </div>

      {!board ? (
        q.isError ? <Failed text="Today's board could not be loaded." onRetry={() => void q.refetch()} /> : <Spinner label="Loading today…" />
      ) : (
        <div className="flex flex-col gap-4 xl:flex-row">
          <Card title="Arriving next" action={<span className="text-[12.5px] text-ink-3">{board.figures.to_come} still to come today</span>} className="min-w-0 flex-1">
            {board.late.length + board.arriving.length === 0 ? (
              <Empty icon="calendar" title="Nobody else is booked in today." hint="Walk-ins and new bookings appear here as they are made." />
            ) : (
              <ul>
                {board.late.map((v) => (
                  <Arriving key={v.id} visit={v} late now={now} />
                ))}
                {board.arriving.map((v) => (
                  <Arriving key={v.id} visit={v} late={false} now={now} />
                ))}
              </ul>
            )}
          </Card>

          <div className="flex w-full flex-col gap-4 xl:w-[380px]">
            <ReadyToPay board={board} />
            <Card title="On the floor">
              {board.floor.length === 0 ? (
                <Empty icon="users" title="No stylist is working here today." />
              ) : (
                <ul className="grid grid-cols-2 gap-2.5">
                  {board.floor.map((f) => (
                    <li key={f.provider_id} className="rounded-[10px] border border-line p-3">
                      <div className="flex items-center gap-2">
                        <Avatar name={f.name} size={28} />
                        <div className="min-w-0">
                          <div className="truncate text-[13px] font-bold text-ink">{f.name.split(' ')[0]}</div>
                          {f.current ? <div className="text-[12px] text-ink-3">till {f.current.until}</div> : null}
                        </div>
                      </div>
                      {f.current ? (
                        <div className="mt-1.5 truncate text-[12.5px] text-ink-2">
                          {f.current.client} · {f.current.service}
                        </div>
                      ) : (
                        <div className="mt-1.5 text-[12.5px] font-bold text-success">Free{f.next ? ` · until ${f.next.label}` : ''}</div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}

function summary(b: TodayBoard): string {
  return [
    longDay(b.date),
    `${b.figures.bookings} booking${b.figures.bookings === 1 ? '' : 's'}`,
    `${b.figures.done} done or in the chair`,
    b.figures.taken ? `${amount(b.figures.taken.total, b.currency)} taken` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

function dueIn(v: Visit, now: number): string | null {
  const mins = Math.round((Date.parse(v.starts_at) - now) / 60_000);
  return mins > 0 && mins <= 90 ? `due in ${mins} min` : null;
}

function Arriving({ visit, late, now }: { visit: Visit; late: boolean; now: number }) {
  const desk = useDesk();
  const owed = visit.money.deposit_owed > 0;
  const due = dueIn(visit, now);

  return (
    <li className="flex items-center gap-3.5 border-t border-line py-3 first:border-t-0">
      <span className="w-[52px] text-[17px] font-extrabold text-ink tabular-nums">{visit.start}</span>
      <Avatar name={visit.client.name} size={34} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => desk.go('clients', { client: visit.client.id })} className="truncate text-left text-[15px] font-bold text-ink hover:underline">
            {visit.client.name}
          </button>
          {late ? <Chip tone="danger">Late</Chip> : null}
          {visit.client.allergy ? <AllergyChip allergy={visit.client.allergy} /> : null}
          {owed ? <Chip tone="warning">Deposit owed</Chip> : null}
          {!owed && visit.money.advance > 0 ? <Chip tone="indigo">Advance</Chip> : null}
        </div>
        <div className="truncate text-[12.5px] text-ink-2">
          {servicesOf(visit)} · {stylistsOf(visit)} · {visit.status_label}
          {due ? ` · ${due}` : ''}
        </div>
      </div>
      <Button variant="primary" size="lg" icon="check-circle" disabled={!desk.may('salon.visit.checkin')} onClick={() => desk.checkIn(visit)}>
        Check in
      </Button>
    </li>
  );
}

/** Checked in, in the chair or done, and not yet paid. Taking the money comes with the next desktop release. */
function ReadyToPay({ board }: { board: TodayBoard }) {
  const ready = readyToPay(board);
  if (ready.length === 0) return null;

  return (
    <Card title="Ready to pay">
      <ul>
        {ready.map((v) => (
          <li key={v.id} className="flex items-center gap-3 border-t border-line py-2.5 first:border-t-0">
            <Avatar name={v.client.name} size={30} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[14px] font-bold text-ink">{v.client.name}</div>
              <div className="truncate text-[12.5px] text-ink-2">
                {servicesOf(v)} · {v.status_label}
              </div>
            </div>
            <span className="text-[13px] font-bold text-ink tabular-nums" title="Still to pay, after any advance">
              {amount(v.money.balance, v.money.currency)}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

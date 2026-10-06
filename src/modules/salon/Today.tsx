import { useQuery } from '@tanstack/react-query';
import { Avatar, Empty, Spinner } from '../../components/ui';
import { call } from '../../core/bridge';
import { amount, clockAt, fetchToday, greeting, K, longDay, minutesOf, owing, readyToPay, stillToPay, type TodayBoard, type Visit } from './api';
import { boardFromCopy, copyAge, unreachable, useOutbox } from './offline';
import { AllergyChip, Bar, Failed, firstName, Note, Page, Panel, QuickAction, servicesOf, stylistsOf, Tag, TouchButton, useDesk, useNow, Who } from './parts';

/**
 * Today at the counter (D02): who walks in next, who is late, who is in a
 * chair and until when, and the jobs the desk does most — a walk-in, a
 * booking, taking payment, finding a client. The server's board for this
 * desk's location, refreshed every minute; its day and times are the salon's
 * clock.
 *
 * With WorkSuite out of reach it is the same board, worked out from the day's
 * copy by the server's rules, with what the desk has kept to send beside it.
 */
export default function Today() {
  const desk = useDesk();
  const q = useQuery({ queryKey: K.today(desk.location.id), queryFn: ({ signal }) => fetchToday(desk.location.id, signal), refetchInterval: 60_000, retry: desk.offline ? false : undefined });
  const now = useNow(60_000);
  const fromCopy = !!desk.copy && (desk.offline || unreachable(q));
  const board = fromCopy && desk.copy ? boardFromCopy(desk.copy, now) : q.data;
  const outbox = useOutbox();
  const waiting = (outbox.data ?? []).filter((i) => i.state === 'waiting');
  const kept = new Set(waiting.filter((i) => i.kind === 'visit.check_in' && typeof i.payload.visit_id === 'number').map((i) => i.payload.visit_id as number));
  const hour = Math.floor(minutesOf(board?.now_label ?? clockAt(new Date(now).toISOString(), desk.location.timezone)) / 60);
  const book = desk.may('salon.visit.book');
  const hello = desk.me ? `${greeting(hour)}, ${firstName(desk.me)}` : greeting(hour);

  return (
    <Page
      title={hello}
      sub={
        <>
          {board ? summary(board) : desk.location.name}
          {fromCopy ? ` · from this desk’s copy, taken at ${copyAge(desk.copy, desk.location.timezone) ?? '—'}` : ''}
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <QuickAction icon="door" label="Walk-in" onClick={() => desk.walkIn({})} disabled={!book} />
        <QuickAction icon="plus" tone="teal" label="New booking" onClick={() => desk.walkIn({}, true)} disabled={!book} />
        <QuickAction icon="banknote" tone="amber" label="Take payment" onClick={() => desk.go('pay')} disabled={!desk.may('salon.checkout') || desk.offline} />
        <QuickAction icon="search" tone="pink" label="Find a client" onClick={() => desk.go('clients')} />
      </div>

      {waiting.length > 0 ? (
        <Panel title="Kept to send" action={<span className="text-[13px] text-ink-2">Goes to WorkSuite when it answers</span>}>
          <ul>
            {waiting.map((i) => (
              <li key={i.id} className="flex items-baseline gap-3 border-t border-line py-2 text-[14px] first:border-t-0">
                <span className="min-w-0 flex-1 truncate font-semibold text-ink">{i.label}</span>
                {i.detail ? <span className="truncate text-[13px] text-ink-2">{i.detail}</span> : null}
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      {fromCopy && board && board.figures.taken === null ? <Note tone="muted">What was taken today, and who is ready to pay, show when WorkSuite answers.</Note> : null}

      {!board ? (
        q.isError ? <Failed text="Today's board could not be loaded." onRetry={() => void q.refetch()} /> : <Spinner label="Loading today…" />
      ) : (
        <div className="flex flex-col items-start gap-3.5 xl:flex-row">
          <Panel title="Arriving next" action={<span className="text-[13px] text-ink-2">{board.figures.to_come} still to come today</span>} className="w-full min-w-0 xl:flex-1">
            {board.late.length + board.arriving.length === 0 ? (
              <Empty icon="calendar" title="Nobody else is booked in today." hint="Walk-ins and new bookings appear here as they are made." />
            ) : (
              <ul>
                {board.late.map((v) => (
                  <Arriving key={v.id} visit={v} late now={now} kept={kept.has(v.id)} />
                ))}
                {board.arriving.map((v) => (
                  <Arriving key={v.id} visit={v} late={false} now={now} kept={kept.has(v.id)} />
                ))}
              </ul>
            )}
          </Panel>

          <div className="flex w-full flex-col gap-3 xl:w-[420px] xl:shrink-0">
            {!fromCopy && board.attention?.length ? <Attention board={board} /> : null}
            <Panel title="On the floor">
              {board.floor.length === 0 ? (
                <Empty icon="users" title="No stylist is working here today." />
              ) : (
                <ul>
                  {board.floor.map((f) => (
                    <li key={f.provider_id} className="flex items-center gap-3 border-t border-line py-2.5 first:border-t-0">
                      <Who name={f.name} color={f.color} size={38} />
                      <div className="min-w-0 flex-1">
                        <div className="flex justify-between gap-2 text-[14px]">
                          <b className="truncate text-ink">{firstName(f.name)}</b>
                          {f.current ? <span className="shrink-0 text-ink-2">till {f.current.until}</span> : null}
                        </div>
                        {f.current ? (
                          <>
                            <div className="mt-0.5 mb-1.5 truncate text-[13px] font-medium text-ink-2">
                              {f.current.client} · {f.current.service}
                            </div>
                            <Bar value={f.current.progress ?? 0} color={f.color} />
                          </>
                        ) : (
                          <div className="mt-0.5 text-[13px] font-bold text-success">Free{f.next ? ` · until ${f.next.label}` : ''}</div>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
            {fromCopy ? null : <ReadyToPay board={board} />}
          </div>
        </div>
      )}
    </Page>
  );
}

function summary(b: TodayBoard): string {
  const f = b.figures;
  return [
    longDay(b.date).replace(/ \d{4}$/, ''),
    `${f.bookings} booking${f.bookings === 1 ? '' : 's'}`,
    `${f.done} done or in the chair`,
    f.taken ? `${amount(f.taken.total, b.currency).replace(/\.00$/, '')} taken` : null,
    f.owed && f.owed.amount > 0 ? `${amount(f.owed.amount, b.currency).replace(/\.00$/, '')} owed` : null,
    typeof f.utilisation === 'number' ? `${Math.round(f.utilisation)}% of chair time booked` : null,
    typeof f.no_show_rate === 'number' ? `${f.no_show_rate}% no-shows (30 days)` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** What needs somebody now (CAL-06). The owners' lists open in WorkSuite on the web; a deposit is taken here. */
function Attention({ board }: { board: TodayBoard }) {
  const desk = useDesk();
  const owed = [...board.late, ...board.arriving].find((v) => v.money.deposit_owed > 0);
  const act = (view: string) => {
    if (view === 'today' && owed && desk.may('salon.checkout')) desk.deposit(owed);
    else if (view === 'settings') desk.go('outbox');
    else void call('app:openInBrowser', { path: `/salon?view=${encodeURIComponent(view)}` }).catch(() => undefined);
  };
  return (
    <Panel title="Needs attention">
      <ul>
        {(board.attention ?? []).map((a) => (
          <li key={a.kind} className="flex items-center gap-3 border-t border-line py-2.5 first:border-t-0">
            <span className="grid h-7 min-w-7 place-items-center rounded-full bg-warning-bg px-1.5 text-[12px] font-extrabold text-warning tabular-nums">{a.count}</span>
            <span className="min-w-0 flex-1 text-[14px] text-ink">{a.label.replace(/^\d+\s/, '')}</span>
            <TouchButton className="min-h-10 px-3.5 text-[13px]" onClick={() => act(a.view)}>
              {a.action}
            </TouchButton>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function dueIn(v: Visit, now: number): string | null {
  const mins = Math.round((Date.parse(v.starts_at) - now) / 60_000);
  return mins > 0 && mins <= 90 ? `Due in ${mins} min` : null;
}

function Arriving({ visit, late, now, kept }: { visit: Visit; late: boolean; now: number; kept: boolean }) {
  const desk = useDesk();
  const owed = visit.money.deposit_owed > 0;
  const due = dueIn(visit, now);
  const first = visit.items[0];
  const canDeposit = owed && !desk.offline && desk.may('salon.checkout');

  return (
    <li className="flex items-center gap-3.5 border-t border-line py-3 first:border-t-0">
      <span className="w-[58px] shrink-0 text-[18px] font-extrabold text-ink tabular-nums">{visit.start}</span>
      {first ? <Who name={first.provider} color={first.provider_color} size={40} /> : <Avatar name={visit.client.name} size={40} />}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => desk.go('clients', { client: visit.client.id })} className="truncate text-left text-[16px] font-bold text-ink hover:underline">
            {visit.client.name}
          </button>
          {kept ? <Tag tone="indigo">Check-in kept</Tag> : late ? <Tag tone="danger">Late</Tag> : null}
          {owed ? <Tag tone="warning">Deposit owed</Tag> : null}
          {visit.client.allergy ? <AllergyChip allergy={visit.client.allergy} /> : null}
          {!owed && visit.money.advance > 0 ? <Tag tone="violet">Advance</Tag> : null}
        </div>
        <div className="truncate text-[13px] text-ink-2">
          {[
            servicesOf(visit),
            stylistsOf(visit),
            visit.status_label,
            owed ? 'deposit owed' : visit.money.advance > 0 ? `Advance ${amount(visit.money.advance, visit.money.currency).replace(/\.00$/, '')}` : null,
            late ? null : due,
          ]
            .filter(Boolean)
            .join(' · ')}
        </div>
      </div>
      {canDeposit ? (
        <TouchButton icon="wallet" onClick={() => desk.deposit(visit)}>
          Take deposit
        </TouchButton>
      ) : (
        <TouchButton variant="primary" icon="check" disabled={kept || !desk.may('salon.visit.checkin')} onClick={() => desk.checkIn(visit)}>
          Check in
        </TouchButton>
      )}
    </li>
  );
}

/** Checked in, in the chair or done, and not yet paid — or checked out and still owing. */
function ReadyToPay({ board }: { board: TodayBoard }) {
  const desk = useDesk();
  const ready = readyToPay(board);
  if (ready.length === 0) return null;

  return (
    <Panel title="Ready to pay" action={<span className="text-[13px] text-ink-2">{ready.length}</span>}>
      <ul>
        {ready.map((v) => (
          <li key={v.id} className="flex items-center gap-3 border-t border-line py-2.5 first:border-t-0">
            <div className="min-w-0 flex-1">
              <div className="truncate text-[14px] font-bold text-ink">{v.client.name}</div>
              <div className="truncate text-[13px] text-ink-2">
                {servicesOf(v)} · {owing(v) ? 'still owing' : v.status_label}
              </div>
            </div>
            <span className="text-[14px] font-bold text-ink tabular-nums" title="Still to pay, after any advance">
              {amount(stillToPay(v))}
            </span>
            <TouchButton variant="primary" className="min-h-10 px-3.5 text-[13px]" disabled={!desk.may('salon.checkout')} onClick={() => desk.go('pay', { visit: v.id })}>
              {owing(v) ? 'Take the rest' : 'Pay'}
            </TouchButton>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

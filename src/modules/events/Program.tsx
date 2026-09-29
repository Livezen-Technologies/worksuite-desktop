import { useQuery } from '@tanstack/react-query';
import { useRef, useState, type FormEvent } from 'react';
import { Icon } from '../../components/Icon';
import { Button, Card, Empty, Modal, Spinner, cx } from '../../components/ui';
import { localDate, scanId } from '@shared/event-desk';
import { at, eGet, ePost, errorText, K, type Session } from './api';
import { useDeskStatus } from './desk';
import { Header, Refusal, toneOf, useEvent } from './parts';

/**
 * The day's program for the desk (§10, B2's sessions) and a session's door
 * (§9.7, EV-CHK-060): the sessions under way and to come, and — at a room
 * entrance — a scan that checks the ticket, the session place where one is
 * needed and the room's capacity, recorded as session attendance (the
 * server's `POST checkin/sessions/{id}`; online only, as the server has it).
 * The people holding a place are one click away for those who may read
 * registrations.
 */

interface DoorAnswer {
  result: string;
  colour: string;
  label: string;
  reason: string;
  warning: string | null;
  done: boolean;
  attendee: { name: string; company: string | null } | null;
  ticket: { id: number; name: string } | null;
  registration: { id: number; number: string } | null;
  session: Session;
}

export default function Program() {
  const { event, may, online } = useEvent();
  const door = useQuery({
    queryKey: [...K.live(event.id), 'door-sessions'],
    queryFn: ({ signal }) => eGet<{ items: Session[] }>(`/events/${event.id}/checkin/sessions`, undefined, signal),
    enabled: online && may('events.checkin.use'),
    refetchInterval: 30_000,
  });
  const all = useQuery({
    queryKey: [...K.event(event.id), 'sessions'],
    queryFn: ({ signal }) => eGet<{ items: Session[] }>(`/events/${event.id}/sessions`, undefined, signal),
    enabled: online && may('events.session.view'),
    retry: false,
  });
  const [atDoor, setAtDoor] = useState<Session | null>(null);
  const [places, setPlaces] = useState<Session | null>(null);
  /* Published sessions only: a draft is not the program yet. */
  const published = (all.data?.items ?? []).filter((s) => s.status !== 'DRAFT');
  const days = [...new Set(published.map((s) => s.day).filter((d): d is number => d !== null))].sort((a, b) => a - b);
  const [today] = useState(() => localDate(event.timezone, Date.now()));
  const todayDay = published.find((s) => s.start?.date === today)?.day ?? days[0] ?? null;
  const [day, setDay] = useState<number | null>(null);
  const shownDay = day ?? todayDay;
  const list = published.filter((s) => shownDay === null || s.day === shownDay).sort((a, b) => (a.start?.utc ?? '').localeCompare(b.start?.utc ?? ''));

  if (atDoor) return <Door session={atDoor} onBack={() => setAtDoor(null)} />;

  return (
    <div className="flex flex-col gap-4 pb-6">
      <Header title="Today’s program" sub="Sessions under way and to come; a room’s door checks people into its session" />
      <div className="flex flex-col gap-4 px-6">
        {!online ? <Refusal text="The program and session doors are WorkSuite’s: they come back with the line." /> : null}
        {may('events.checkin.use') ? (
          <Card title="Session doors">
            {door.isLoading ? <Spinner /> : null}
            {door.error ? <Refusal text={errorText(door.error)} /> : null}
            {door.data && door.data.items.length === 0 ? <p className="m-0 text-[13px] text-ink-3">No session is scheduled or under way.</p> : null}
            <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
              {door.data?.items.map((s) => (
                <li key={s.id} className="flex items-center gap-3 rounded-[10px] border border-line px-3 py-2 text-[13px]">
                  <span className={cx('rounded-[6px] px-1.5 text-[11px] font-bold', s.status === 'LIVE' ? 'bg-success-bg text-success' : 'bg-subtle text-ink-2')}>{s.status_label}</span>
                  <span className="min-w-0 flex-1">
                    <b className="block truncate">{s.title}</b>
                    <span className="text-[12px] text-ink-2">
                      {at(s.start)}–{s.end?.time ?? ''} · {s.room?.name ?? 'no room'}
                      {s.registration_required ? ' · places reserved' : ''}
                    </span>
                  </span>
                  <span className="text-[12px] text-ink-2 tabular-nums">
                    {s.attended ?? 0}
                    {s.capacity ? ` / ${s.capacity}` : ''} in
                  </span>
                  {may('events.registration.view') ? (
                    <Button size="sm" onClick={() => setPlaces(s)}>
                      Places
                    </Button>
                  ) : null}
                  <Button size="sm" variant="primary" icon="door" onClick={() => setAtDoor(s)}>
                    At the door
                  </Button>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}
        {may('events.session.view') ? (
          <Card
            title="The program"
            action={
              days.length > 1 ? (
                <div className="flex gap-1">
                  {days.map((d) => (
                    <button key={d} type="button" aria-pressed={shownDay === d} onClick={() => setDay(d)} className={cx('h-7 rounded-[7px] px-2.5 text-[12px] font-semibold', shownDay === d ? 'bg-selection text-primary' : 'text-ink-2 hover:bg-subtle')}>
                      Day {d}
                    </button>
                  ))}
                </div>
              ) : null
            }
          >
            {all.isLoading ? <Spinner /> : null}
            {all.error ? <Refusal text={errorText(all.error)} /> : null}
            {all.data && list.length === 0 ? <Empty icon="calendar" title="No published sessions" /> : null}
            <ol className="m-0 flex list-none flex-col gap-1 p-0">
              {list.map((s) => (
                <li key={s.id} className="grid grid-cols-[110px_1fr_auto] items-start gap-3 border-t border-line py-2 text-[13px] first:border-t-0">
                  <span className="font-semibold tabular-nums">
                    {s.start?.time ?? '—'}–{s.end?.time ?? ''}
                  </span>
                  <span className="min-w-0">
                    <b className="block">{s.title}</b>
                    <span className="text-[12px] text-ink-2">
                      {[s.room?.name, s.track?.name, s.speakers?.map((p) => p.name).join(', ')].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  <span className="text-right text-[12px] text-ink-2">
                    <span className="block">{s.status_label}</span>
                    {s.seats?.capacity ? <span className="block text-ink-3">{s.seats.availability_label ?? `${s.seats.left ?? '—'} left`}</span> : null}
                  </span>
                </li>
              ))}
            </ol>
          </Card>
        ) : null}
      </div>
      {places ? <Places session={places} onClose={() => setPlaces(null)} /> : null}
    </div>
  );
}

/** A session's door: scan, and the server says whether they may go in (EV-CHK-060). */
function Door({ session, onBack }: { session: Session; onBack: () => void }) {
  const { event } = useEvent();
  const status = useDeskStatus(event.id);
  const [code, setCode] = useState('');
  const [answer, setAnswer] = useState<DoorAnswer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const s = answer?.session ?? session;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const c = code.trim();
    setCode('');
    if (!c) return;
    setBusy(true);
    setError(null);
    try {
      const r = await ePost<DoorAnswer>(`/events/${event.id}/checkin/sessions/${session.id}`, { code: c, device_id: status.data?.registration?.device_id ?? undefined, client_uuid: scanId('dsk'), check_in: true });
      setAnswer(r.data);
    } catch (err) {
      setAnswer(null);
      setError(errorText(err));
    } finally {
      setBusy(false);
      input.current?.focus();
    }
  };
  const tone = toneOf(answer?.colour);
  return (
    <div className="flex flex-col gap-4 px-6 py-5">
      <button type="button" onClick={onBack} className="flex items-center gap-1 self-start text-[12.5px] font-semibold text-ink-2 hover:text-ink">
        <Icon name="back" size={14} /> The program
      </button>
      <div>
        <h1 className="m-0 text-[22px] font-extrabold text-ink">{s.title}</h1>
        <p className="mt-1 mb-0 text-[13px] text-ink-2">
          {at(s.start)}–{s.end?.time ?? ''} · {s.room?.name ?? 'no room'} · {s.attended ?? 0}
          {s.capacity ? ` of ${s.capacity}` : ''} let in{s.registration_required ? ' · places reserved' : ''}
        </p>
      </div>
      <form onSubmit={(e) => void submit(e)} className="flex items-center gap-3 rounded-[18px] border-2 border-primary bg-surface px-5 py-4">
        <Icon name="door" size={30} className="text-primary" />
        <input ref={input} autoFocus value={code} onChange={(e) => setCode(e.target.value)} placeholder="Scan a ticket at the door" aria-label="Scan a ticket at the session door" autoComplete="off" className="min-w-0 flex-1 bg-transparent text-[24px] font-bold text-ink outline-none placeholder:text-[18px] placeholder:font-medium placeholder:text-ink-3" />
        {busy ? <Icon name="spinner" size={22} className="animate-spin-slow text-ink-3" /> : null}
      </form>
      {error ? <Refusal text={error} /> : null}
      {answer ? (
        <section aria-live="assertive" className={cx('flex flex-col gap-2 rounded-[16px] border-2 p-5', tone === 'success' ? 'border-success/40 bg-success-bg' : tone === 'warning' ? 'border-warning/40 bg-warning-bg' : 'border-danger/40 bg-danger-bg')}>
          <div className={cx('flex items-center gap-3', tone === 'success' ? 'text-success' : tone === 'warning' ? 'text-warning' : 'text-danger')}>
            <Icon name={tone === 'success' ? 'check-circle' : tone === 'warning' ? 'warning' : 'x-circle'} size={36} />
            <div>
              <div className="text-[24px] font-extrabold">{answer.done && answer.result === 'VALID' ? 'In' : answer.label}</div>
              <div className="text-[14px] font-semibold">{answer.reason}</div>
            </div>
          </div>
          {answer.warning ? <div className="text-[13px] font-semibold text-warning">{answer.warning}</div> : null}
          {answer.attendee ? (
            <div className="text-[20px] font-bold text-ink">
              {answer.attendee.name}
              {answer.attendee.company ? <span className="text-[14px] font-medium text-ink-2"> · {answer.attendee.company}</span> : null}
            </div>
          ) : null}
          {answer.registration ? (
            <div className="text-[13px] text-ink-2">
              {answer.registration.number}
              {answer.ticket ? ` · ${answer.ticket.name}` : ''}
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

/** Who holds a place in the session (`GET sessions/{id}/registrations`). */
function Places({ session, onClose }: { session: Session; onClose: () => void }) {
  const q = useQuery({
    queryKey: ['events', 'session-places', session.id],
    queryFn: ({ signal }) => eGet<{ items: Array<{ id: number; number: string; name: string; company: string | null; ticket: { name: string } | string | null; status: string; status_label: string; position: number | null }> }>(`/sessions/${session.id}/registrations`, undefined, signal),
  });
  return (
    <Modal title={`Places — ${session.title}`} onClose={onClose} width={620}>
      {q.isLoading ? <Spinner /> : null}
      {q.error ? <Refusal text={errorText(q.error)} /> : null}
      {q.data && q.data.items.length === 0 ? <p className="m-0 text-[13px] text-ink-3">Nobody holds a place.</p> : null}
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {q.data?.items.map((p) => (
          <li key={p.id} className="flex items-center gap-3 border-t border-line py-1.5 text-[13px] first:border-t-0">
            <span className="min-w-0 flex-1">
              <b>{p.name}</b>
              <span className="text-ink-3">
                {' '}
                · {p.number}
                {p.company ? ` · ${p.company}` : ''}
              </span>
            </span>
            <span className="text-[12px] text-ink-2">
              {p.status_label}
              {p.position ? ` #${p.position}` : ''}
            </span>
          </li>
        ))}
      </ul>
    </Modal>
  );
}

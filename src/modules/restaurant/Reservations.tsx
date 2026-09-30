import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button, Card, Chip, Modal, Spinner, TextField, cx } from '../../components/ui';
import { toast } from '../../core/toasts';
import { get, K, refusal, write, type Availability, type Floor, type Reservation, type ReservationChoice, type Timeline } from './api';
import { tr, useT, type RKey } from './i18n';
import { Failed, Heading, Note, ReasonField, useLive, useTill } from './parts';

/**
 * The host stand (§5.7, reservations phase 1): the day's bookings with the
 * moves the server offers each (`choices` — confirm, arrived, seat, cancel,
 * no-show), the tables' timeline for the day, and a booking made after
 * asking the server which tables are free (`reservations/availability`, or
 * other times when none is). Seating a booking opens its party at the table
 * the host picks. Every write needs WorkSuite; a host without
 * `restaurant.reservation.manage` sees the day but moves nothing.
 */
const STATUS_TONE: Record<string, 'muted' | 'indigo' | 'success' | 'warning' | 'danger'> = {
  pending: 'warning',
  confirmed: 'indigo',
  arrived: 'success',
  seated: 'success',
  completed: 'muted',
  cancelled: 'muted',
  no_show: 'danger',
};

/** The server's moves as the host says them; a move this build does not know shows the server's own words. */
const ON: Record<string, RKey> = { confirm: 'resv.on.confirm', arrive: 'resv.on.arrive', seat: 'resv.on.seat', cancel: 'resv.on.cancel', no_show: 'resv.on.no_show' };

function verb(c: ReservationChoice): string {
  const k = ON[c.on];
  return k ? tr(k) : c.label;
}

export function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const hhmm = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—');

export default function Reservations() {
  const t = useT();
  const till = useTill();
  const qc = useQueryClient();
  const [date, setDate] = useState(today);
  const [booking, setBooking] = useState(false);
  const [moving, setMoving] = useState<{ r: Reservation; c: ReservationChoice } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const manages = till.can('reservation_manage');

  const list = useQuery({
    queryKey: K.reservations(till.branch, date),
    queryFn: ({ signal }) => get<{ reservations: Reservation[] }>('/reservations', { branch_id: till.branch, date }, signal).then((d) => d.reservations),
  });
  const line = useQuery({ queryKey: K.timeline(till.branch, date), queryFn: ({ signal }) => get<Timeline>('/reservations/timeline', { branch_id: till.branch, date }, signal) });
  useLive(till.branch, till.status?.last_seq ?? 0, true, 10_000, [K.reservations(till.branch, date), K.timeline(till.branch, date)]);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['restaurant', 'reservations', till.branch] });
    void qc.invalidateQueries({ queryKey: ['restaurant', 'timeline', till.branch] });
    void qc.invalidateQueries({ queryKey: K.floor(till.branch) });
  };

  async function move(r: Reservation, c: ReservationChoice, extra: Record<string, unknown> = {}) {
    setBusy(`${c.on}-${r.id}`);
    try {
      const res = await write<{ reservation: Reservation | null; session_id?: number }>(`/reservations/${r.id}/${c.on}`, { version: r.version, ...extra });
      toast('success', res.message ?? t('resv.done'));
      refresh();
      setMoving(null);
      return true;
    } catch (e) {
      const f = refusal(e);
      toast(f.code === 'version_conflict' ? 'warning' : 'error', f.message);
      if (f.code === 'version_conflict') refresh();
      return false;
    } finally {
      setBusy(null);
    }
  }

  const pick = (r: Reservation, c: ReservationChoice) => (c.on === 'seat' || c.needs.length > 0 ? setMoving({ r, c }) : void move(r, c));

  return (
    <div className="flex max-w-[1180px] flex-col gap-4 p-6">
      <Heading
        title={t('nav.reservations')}
        hint={t('resv.hint')}
        action={
          <div className="flex items-end gap-2">
            <TextField label={t('resv.date')} type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
            {manages ? (
              <Button variant="primary" icon="calendar-plus" disabled={till.offline} onClick={() => setBooking(true)}>
                {t('resv.book')}
              </Button>
            ) : null}
          </div>
        }
      />
      {!manages ? <Note tone="muted">{t('resv.viewOnly')}</Note> : null}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card title={t('resv.day')}>
          {list.isError ? <Failed text={list.error instanceof Error ? list.error.message : t('resv.failed')} onRetry={() => void list.refetch()} /> : !list.data ? <Spinner /> : null}
          {list.data && list.data.length === 0 ? <p className="text-[13px] text-ink-3">{t('resv.none')}</p> : null}
          <ul className="flex flex-col divide-y divide-line" aria-label={t('resv.day')}>
            {(list.data ?? []).map((r) => (
              <li key={r.id} className="flex flex-col gap-1.5 py-2.5" aria-label={t('resv.rowLabel', { name: r.name, time: r.local_time })}>
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="w-[52px] font-bold tabular-nums text-ink">{r.local_time}</span>
                  <span className="min-w-0 flex-1 font-semibold text-ink">
                    {r.name} · {t('resv.guests', { n: r.guests })}
                    {r.table_code ? <span className="text-ink-2"> · {t('floor.table')} {r.table_code}</span> : null}
                  </span>
                  <Chip tone={STATUS_TONE[r.status] ?? 'muted'}>{r.status_label}</Chip>
                </div>
                {r.phone || r.occasion || r.special_requests ? (
                  <div className="ps-[60px] text-[12px] text-ink-2">{[r.phone, r.occasion, r.special_requests].filter(Boolean).join(' · ')}</div>
                ) : null}
                {manages && r.choices.length ? (
                  <div className="flex flex-wrap gap-1.5 ps-[60px]">
                    {r.choices.map((c) => (
                      <Button key={c.on} size="sm" variant={c.on === 'seat' ? 'primary' : c.on === 'cancel' || c.on === 'no_show' ? 'ghost' : 'secondary'} disabled={till.offline} loading={busy === `${c.on}-${r.id}`} onClick={() => pick(r, c)}>
                        {verb(c)}
                      </Button>
                    ))}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
        <Card title={t('resv.timeline')}>{line.isError ? <Failed text={line.error instanceof Error ? line.error.message : t('resv.failed')} onRetry={() => void line.refetch()} /> : !line.data ? <Spinner /> : <TimelineView data={line.data} />}</Card>
      </div>
      {booking ? <BookDialog date={date} onClose={() => setBooking(false)} onDone={refresh} /> : null}
      {moving ? <MoveDialog r={moving.r} c={moving.c} busy={busy !== null} onClose={() => setMoving(null)} onGo={(extra) => move(moving.r, moving.c, extra)} /> : null}
    </div>
  );
}

/** Each table's day: bookings and parties as bars from the first to the last hour anything happens. */
function TimelineView({ data }: { data: Timeline }) {
  const t = useT();
  const times = data.tables.flatMap((x) => x.blocks.flatMap((b) => [b.from, b.to])).filter((v): v is string => !!v).map((v) => new Date(v).getTime());
  if (data.tables.length === 0) return <p className="text-[13px] text-ink-3">{t('resv.noTables')}</p>;
  const start = times.length ? Math.min(...times) : 0;
  const end = times.length ? Math.max(...times) : 1;
  const span = Math.max(1, end - start);
  const pos = (iso: string | null) => (iso ? ((new Date(iso).getTime() - start) / span) * 100 : 0);
  return (
    <div className="flex flex-col gap-1" role="list" aria-label={t('resv.timeline')}>
      {times.length ? (
        <div className="flex justify-between ps-[64px] text-[11px] text-ink-3">
          <span>{hhmm(new Date(start).toISOString())}</span>
          <span>{hhmm(new Date(end).toISOString())}</span>
        </div>
      ) : null}
      {data.tables.map((row) => (
        <div key={row.table_id} role="listitem" aria-label={`${t('floor.table')} ${row.code}`} className="flex items-center gap-2">
          <span className="w-[56px] shrink-0 text-[12.5px] font-semibold text-ink">
            {row.code} <span className="font-normal text-ink-3">({row.capacity})</span>
          </span>
          <div className="relative h-7 min-w-0 flex-1 rounded-[6px] bg-subtle">
            {row.blocks.map((b) => {
              const left = pos(b.from);
              const width = Math.max(4, pos(b.to) - left);
              return (
                <span
                  key={`${b.kind}-${b.id}`}
                  title={`${b.name ?? t('resv.party')} · ${t('resv.guests', { n: b.guests })} · ${hhmm(b.from)}–${hhmm(b.to)}`}
                  style={{ insetInlineStart: `${left}%`, width: `${Math.min(width, 100 - left)}%` }}
                  className={cx('absolute top-0.5 bottom-0.5 truncate rounded-[5px] px-1.5 text-[11px] leading-6 font-semibold', b.kind === 'party' ? 'bg-warning/30 text-ink' : 'bg-primary/20 text-primary')}
                >
                  {hhmm(b.from)} {b.name ?? t('resv.party')}
                </span>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

/** A move that asks for something: the table and guests to seat, or the reason to cancel. */
function MoveDialog({ r, c, busy, onClose, onGo }: { r: Reservation; c: ReservationChoice; busy: boolean; onClose: () => void; onGo: (extra: Record<string, unknown>) => Promise<boolean> }) {
  const t = useT();
  const till = useTill();
  const [reason, setReason] = useState('');
  const [table, setTable] = useState<number | null>(r.table_id);
  const [guests, setGuests] = useState(String(r.guests));
  const floor = useQuery({ queryKey: K.floor(till.branch), queryFn: ({ signal }) => get<Floor>('/floor', { branch_id: till.branch }, signal), enabled: c.on === 'seat' });
  const free = (floor.data?.tables ?? []).filter((x) => !x.in_use && x.status !== 'blocked');
  const seat = c.on === 'seat';
  const tableVersion = floor.data?.tables.find((x) => x.id === table)?.version;
  const ok = seat ? !!table : c.needs.includes('reason') ? reason.trim() !== '' : true;
  return (
    <Modal
      title={seat ? t('resv.seatTitle', { name: r.name }) : `${verb(c)}: ${r.name}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant={seat ? 'primary' : 'danger'} loading={busy} disabled={!ok} onClick={() => void onGo(seat ? { table_id: table, guests: Math.max(1, Number(guests) || r.guests), ...(tableVersion ? { table_version: tableVersion } : {}) } : { reason: reason.trim() })}>
            {seat ? t('resv.seat') : verb(c)}
          </Button>
        </>
      }
    >
      {seat ? (
        <div className="flex flex-col gap-3">
          <TextField label={t('floor.howMany')} type="number" min={1} value={guests} onChange={(e) => setGuests(e.target.value)} />
          <fieldset className="flex flex-wrap gap-1.5">
            <legend className="mb-1 text-[12.5px] font-semibold text-ink-2">{t('resv.table')}</legend>
            {!floor.data ? <Spinner /> : null}
            {free.map((x) => (
              <button key={x.id} type="button" aria-pressed={table === x.id} onClick={() => setTable(x.id)} className={cx('rounded-[8px] border px-2.5 py-1 text-[12.5px] font-semibold', table === x.id ? 'border-primary bg-selection text-primary' : 'border-line text-ink hover:bg-subtle')}>
                {x.code} · {x.capacity}
              </button>
            ))}
            {floor.data && free.length === 0 ? <p className="text-[13px] text-ink-3">{t('resv.noFree')}</p> : null}
          </fieldset>
        </div>
      ) : (
        <ReasonField label={t('adjust.why')} value={reason} onChange={setReason} />
      )}
    </Modal>
  );
}

/** Book: ask the server what is free for the party first, then book the table chosen (or let the server place it). */
function BookDialog({ date, onClose, onDone }: { date: string; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const till = useTill();
  const [f, setF] = useState({ date, time: '19:00', guests: '2', name: '', phone: '', occasion: '', special_requests: '' });
  const [avail, setAvail] = useState<Availability | null>(null);
  const [table, setTable] = useState<number | null>(null);
  const [uuid] = useState(() => globalThis.crypto.randomUUID());
  const [busy, setBusy] = useState<'check' | 'book' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f, v: string) => {
    setF({ ...f, [k]: v });
    if (k === 'date' || k === 'time' || k === 'guests') {
      setAvail(null);
      setTable(null);
    }
  };

  async function check() {
    setBusy('check');
    setError(null);
    try {
      setAvail(await get<Availability>('/reservations/availability', { branch_id: till.branch, date: f.date, time: f.time, guests: Number(f.guests) || 1 }));
    } catch (e) {
      setError(refusal(e).message);
    } finally {
      setBusy(null);
    }
  }

  async function book() {
    setBusy('book');
    setError(null);
    try {
      const r = await write('/reservations', {
        branch_id: till.branch,
        date: f.date,
        time: f.time,
        guests: Number(f.guests) || 1,
        name: f.name.trim(),
        phone: f.phone.trim() || null,
        occasion: f.occasion.trim() || null,
        special_requests: f.special_requests.trim() || null,
        ...(table ? { table_id: table } : {}),
        source: 'phone',
        uuid,
      });
      toast('success', r.message ?? t('resv.booked'));
      onDone();
      onClose();
    } catch (e) {
      setError(refusal(e).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Modal
      title={t('resv.book')}
      onClose={onClose}
      width={560}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button loading={busy === 'check'} onClick={() => void check()}>
            {t('resv.check')}
          </Button>
          <Button variant="primary" loading={busy === 'book'} disabled={!avail || !f.name.trim() || (avail.tables.length === 0 && !table)} onClick={() => void book()}>
            {t('resv.bookIt')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-3 gap-2">
          <TextField label={t('resv.date')} type="date" value={f.date} onChange={(e) => set('date', e.target.value)} />
          <TextField label={t('resv.time')} type="time" value={f.time} onChange={(e) => set('time', e.target.value)} />
          <TextField label={t('floor.howMany')} type="number" min={1} max={100} value={f.guests} onChange={(e) => set('guests', e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <TextField label={t('resv.name')} value={f.name} maxLength={120} onChange={(e) => set('name', e.target.value)} />
          <TextField label={t('resv.phone')} value={f.phone} maxLength={40} onChange={(e) => set('phone', e.target.value)} />
        </div>
        <TextField label={t('resv.occasion')} value={f.occasion} maxLength={120} onChange={(e) => set('occasion', e.target.value)} />
        <TextField label={t('resv.requests')} value={f.special_requests} maxLength={500} onChange={(e) => set('special_requests', e.target.value)} />
        {avail ? (
          !avail.open ? (
            <Note tone="warning">{t('resv.closed')}</Note>
          ) : avail.tables.length ? (
            <fieldset className="flex flex-wrap gap-1.5">
              <legend className="mb-1 text-[12.5px] font-semibold text-ink-2">{t('resv.freeTables')}</legend>
              {avail.tables.map((x) => (
                <button key={x.id} type="button" aria-pressed={table === x.id} onClick={() => setTable(table === x.id ? null : x.id)} className={cx('rounded-[8px] border px-2.5 py-1 text-[12.5px] font-semibold', table === x.id ? 'border-primary bg-selection text-primary' : 'border-line text-ink hover:bg-subtle')}>
                  {x.code} · {x.capacity}
                </button>
              ))}
            </fieldset>
          ) : (
            <Note
              tone="warning"
              action={
                <div className="flex flex-wrap gap-1">
                  {avail.suggestions.map((s) => (
                    <Button key={s.reserved_for} size="sm" onClick={() => set('time', hhmm(s.reserved_for).replace(/[^\d:]/g, '').slice(0, 5))}>
                      {hhmm(s.reserved_for)}
                    </Button>
                  ))}
                </div>
              }
            >
              {avail.suggestions.length ? t('resv.fullTry') : t('resv.full')}
            </Note>
          )
        ) : (
          <p className="text-[12.5px] text-ink-3">{t('resv.checkFirst')}</p>
        )}
        {error ? <Note tone="danger">{error}</Note> : null}
      </div>
    </Modal>
  );
}

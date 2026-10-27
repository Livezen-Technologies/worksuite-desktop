import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Select } from '../../components/Select';
import { Button, ErrorNote, Modal, Spinner, cx } from '../../components/ui';
import { toast } from '../../core/toasts';
import { input } from '../../components/FormKit';
import { PageHead } from '../../components/PageKit';
import { codeOf, day, errorText, K, money, pGet, plusDays, pPost, type CalendarBar, type CalendarData } from './api';
import { NoAccess, Refusal, usePms } from './parts';
import { Checkbox } from '../../components/Checkbox';

const SPANS = [7, 14, 30] as const;
const ROOM_W = 110;

interface Impact {
  impact?: { before: string; after: string; difference: string; currency: string };
  change?: Record<string, unknown>;
}

/** Days between two YYYY-MM-DD dates (a date on no clock). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);
}

/** Where a bar sits on the tape: its first and last visible day, as columns. */
export function barSpan(bar: Pick<CalendarBar, 'start' | 'end'>, from: string, days: number): { col: number; span: number } | null {
  const a = Math.max(0, daysBetween(from, bar.start));
  const b = Math.min(days, daysBetween(from, bar.end));
  return b > a ? { col: a, span: b - a } : null;
}

/**
 * The tape chart (§6.4, the room calendar): each room a row, each night a
 * column, each reservation a bar in the server's status colour with the
 * guest's name — its words beside its colour — over 7, 14 or 30 nights;
 * out-of-order and blocked nights shaded; bookings with no room yet listed
 * below. A bar is chosen with a click (or the keyboard) and opens its
 * reservation from there, or on a double-click. Whoever may edit reservations (dates)
 * or move rooms moves a booking here: the server says first what the move
 * would do to the price (`calendar/preview`, nothing saved), then makes it
 * with the reservation's `version` (`calendar/move`). A guest in house is
 * moved at the front desk. Online only: availability is the server's.
 */
export default function Calendar({ date }: { date: string | null }) {
  const pms = usePms();
  const pid = pms.property.id;
  const [from, setFrom] = useState(date ?? pms.businessDate);
  const [days, setDays] = useState<number>(14);
  const [type, setType] = useState('');
  const [moving, setMoving] = useState<CalendarBar | null>(null);
  const [picked, setPicked] = useState<CalendarBar | null>(null);
  const q = useQuery({ queryKey: K.calendar(pid, from, days), queryFn: ({ signal }) => pGet<CalendarData>(`/properties/${pid}/calendar`, { from, days }, signal), enabled: pms.may('pms.reservation.view') && pms.online });
  const moves = pms.mayAny('pms.reservation.edit', 'pms.room.move');
  const d = q.data;
  const rows = useMemo(() => (d?.rooms ?? []).filter((r) => !type || String(r.room_type_id) === type), [d, type]);
  const byRoom = useMemo(() => {
    const m = new Map<number, CalendarBar[]>();
    for (const b of d?.bars ?? []) if (b.room_id) m.set(b.room_id, [...(m.get(b.room_id) ?? []), b]);
    return m;
  }, [d]);

  if (!pms.may('pms.reservation.view')) return <NoAccess what="The tape chart is shown to people who may read reservations." />;
  if (!pms.online) return <NoAccess what="The tape chart shows when WorkSuite is back: availability is the server’s." />;
  const cols = d?.dates ?? [];
  const cell = `minmax(34px, 1fr)`;
  const grid = { gridTemplateColumns: `${ROOM_W}px repeat(${cols.length || days}, ${cell})` };

  return (
    <div className="flex flex-col gap-3 px-6 py-5">
      <PageHead title="Tape chart" sub={d ? `${day(d.from)} – ${day(plusDays(d.from, d.days - 1))} · ${d.bars.length} ${d.bars.length === 1 ? 'booking' : 'bookings'} on rooms` : pms.property.name}>
        <Button variant="ghost" aria-label="Earlier" icon="chevron-left" onClick={() => setFrom(plusDays(from, -days))} />
        <Button onClick={() => setFrom(pms.businessDate)}>Today</Button>
        <Button variant="ghost" aria-label="Later" icon="chevron-right" onClick={() => setFrom(plusDays(from, days))} />
        <input aria-label="From" type="date" value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} className={`${input} w-40`} />
        <div className="flex gap-1" role="group" aria-label="Nights shown">
          {SPANS.map((n) => (
            <button key={n} type="button" aria-pressed={days === n} onClick={() => setDays(n)} className={cx('rounded-[8px] border px-2 py-1 text-[12px] font-semibold', days === n ? 'border-primary bg-selection text-primary' : 'border-line bg-surface')}>
              {n}
            </button>
          ))}
        </div>
        <Select aria-label="Room type" value={type} options={[{ value: '', label: 'Every room type' }, ...(d?.room_types ?? []).map((t) => ({ value: String(t.id), label: t.name }))]} onChange={(e) => setType(e.target.value)} className={`${input} w-44`} />
      </PageHead>
      {d ? (
        <div className="flex flex-wrap gap-2 text-[11.5px]" aria-label="Legend">
          {d.legend.map((l) => (
            <span key={l.status} className="flex items-center gap-1">
              <span className="inline-block size-2.5 rounded-[3px]" style={{ background: l.colour }} />
              {l.label}
            </span>
          ))}
          <span className="flex items-center gap-1">
            <span className="inline-block size-2.5 rounded-[3px] bg-[repeating-linear-gradient(45deg,var(--ws-muted)_0_2px,transparent_2px_5px)]" />
            Out of order / blocked
          </span>
        </div>
      ) : null}
      {q.isLoading ? (
        <Spinner />
      ) : q.error || !d ? (
        <ErrorNote error={q.error ?? new Error('The calendar could not be loaded.')} onRetry={() => void q.refetch()} />
      ) : (
        <div className="overflow-x-auto rounded-[12px] border border-line bg-surface" role="grid" aria-label="Rooms by night">
          <div className="min-w-[720px]">
            <div className="sticky top-0 z-[1] grid border-b border-line bg-subtle text-[11px] font-semibold text-ink-3" style={grid} role="row">
              <div className="px-2 py-1.5" role="columnheader">
                Room
              </div>
              {cols.map((c) => (
                <div key={c} role="columnheader" className={cx('border-l border-line px-1 py-1.5 text-center', c === d.business_date && 'bg-selection text-primary')}>
                  {day(c, days <= 14)}
                </div>
              ))}
            </div>
            {rows.map((r) => (
              <div key={r.id} className="relative grid h-[34px] border-b border-line last:border-b-0" style={grid} role="row" aria-label={`Room ${r.number}`}>
                <div className="flex items-center gap-1.5 truncate px-2 text-[12.5px]" role="rowheader">
                  <b className="tabular-nums">{r.number}</b>
                  <span className="truncate text-[11px] text-ink-3">{r.room_type}</span>
                </div>
                {cols.map((c) => (
                  <div key={c} className={cx('border-l border-line', c === d.business_date && 'bg-selection/40')} />
                ))}
                {d.outages
                  .filter((o) => o.room_id === r.id)
                  .map((o) => {
                    const s = barSpan(o, d.from, cols.length);
                    return s ? (
                      <div
                        key={`o${o.id}`}
                        title={`${o.kind.replace(/_/g, ' ')}${o.reason ? ` — ${o.reason}` : ''}`}
                        className="pointer-events-none absolute top-1 bottom-1 rounded-[4px] bg-[repeating-linear-gradient(45deg,color-mix(in_srgb,var(--ws-muted)_33%,transparent)_0_3px,transparent_3px_7px)]"
                        style={{ left: `calc(${ROOM_W}px + (100% - ${ROOM_W}px) * ${s.col / cols.length})`, width: `calc((100% - ${ROOM_W}px) * ${s.span / cols.length})` }}
                      />
                    ) : null;
                  })}
                {(byRoom.get(r.id) ?? []).map((b) => {
                  const s = barSpan(b, d.from, cols.length);
                  if (!s) return null;
                  return (
                    <button
                      key={`${b.reservation_room_id}-${b.start}`}
                      type="button"
                      title={`${b.confirmation_no} · ${b.guest_name} · ${b.status_label} · ${day(b.arrival_date)} → ${day(b.departure_date)}`}
                      aria-label={`${b.guest_name || b.confirmation_no}, ${b.status_label}, ${day(b.arrival_date)} to ${day(b.departure_date)}, room ${r.number}`}
                      aria-pressed={picked?.reservation_room_id === b.reservation_room_id}
                      onClick={() => setPicked(b)}
                      onDoubleClick={() => pms.open({ kind: 'reservation', id: b.reservation_id })}
                      className={cx('absolute top-1 bottom-1 flex items-center gap-1 overflow-hidden rounded-[6px] px-1.5 text-left text-[11.5px] font-semibold text-white', b.continues_before && 'rounded-l-none', b.continues_after && 'rounded-r-none', picked?.reservation_room_id === b.reservation_room_id && 'ring-2 ring-ink ring-offset-1')}
                      style={{ background: b.colour, left: `calc(${ROOM_W}px + (100% - ${ROOM_W}px) * ${s.col / cols.length} + 1px)`, width: `calc((100% - ${ROOM_W}px) * ${s.span / cols.length} - 2px)` }}
                    >
                      <span className="truncate">{b.guest_name || b.confirmation_no}</span>
                      <span className="shrink-0 font-normal opacity-85">{b.status_label}</span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
      {picked ? (
        <div className="flex flex-wrap items-center gap-2 rounded-[10px] border border-line bg-surface px-3 py-2 text-[13px]" role="region" aria-label="Chosen booking">
          <span className="inline-block size-2.5 rounded-[3px]" style={{ background: picked.colour }} />
          <b>{picked.guest_name || picked.confirmation_no}</b>
          <span className="min-w-0 flex-1 text-ink-2">
            {picked.confirmation_no} · {picked.status_label} · {day(picked.arrival_date)} → {day(picked.departure_date)}
          </span>
          <Button size="sm" onClick={() => pms.open({ kind: 'reservation', id: picked.reservation_id })}>
            Open reservation
          </Button>
          {moves ? (
            <Button size="sm" onClick={() => setMoving(picked)}>
              Move…
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" onClick={() => setPicked(null)}>
            Close
          </Button>
        </div>
      ) : d ? (
        <p className="m-0 text-[12px] text-ink-3">Choose a booking to open it{moves ? ' or move it to another room or other dates' : ''}; double-click opens it.</p>
      ) : null}
      {d && d.unassigned.length ? (
        <section aria-label="Without a room">
          <h2 className="mb-2 text-[13.5px] font-bold">Without a room ({d.unassigned.length})</h2>
          <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[13px]">
            {d.unassigned.map((b) => (
              <li key={`${b.reservation_room_id}-${b.start}`} className="flex items-center gap-2 rounded-[8px] border border-line bg-surface px-3 py-1.5">
                <span className="inline-block size-2.5 shrink-0 rounded-[3px]" style={{ background: b.colour }} />
                <button type="button" className="font-mono text-[12px] font-semibold text-primary" onClick={() => pms.open({ kind: 'reservation', id: b.reservation_id })}>
                  {b.confirmation_no}
                </button>
                <span className="min-w-0 flex-1 truncate">
                  {b.guest_name} · {day(b.arrival_date)} → {day(b.departure_date)} · {d.room_types.find((t) => t.id === b.room_type_id)?.name ?? ''}
                </span>
                <span className="text-[12px] text-ink-3">{b.status_label}</span>
                {moves ? (
                  <Button size="sm" onClick={() => setMoving(b)}>
                    Give a room
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {moving && d ? (
        <MoveBooking
          bar={moving}
          data={d}
          onClose={() => {
            setMoving(null);
            setPicked(null);
          }}
        />
      ) : null}
    </div>
  );
}

/** A booking moved on the tape: another room and/or other dates, the server's price impact first. */
function MoveBooking({ bar, data, onClose }: { bar: CalendarBar; data: CalendarData; onClose: () => void }) {
  const pms = usePms();
  const qc = useQueryClient();
  const rooms = pms.mayAny('pms.room.move', 'pms.reservation.edit') && !bar.in_house;
  const dates = pms.may('pms.reservation.edit');
  const [room, setRoom] = useState(bar.room_id ? String(bar.room_id) : '');
  const [arrival, setArrival] = useState(bar.arrival_date);
  const [departure, setDeparture] = useState(bar.departure_date);
  const [complimentary, setComplimentary] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const body: Record<string, unknown> = {
    reservation_room_id: bar.reservation_room_id,
    ...(rooms && room && Number(room) !== bar.room_id ? { room_id: Number(room) } : {}),
    ...(dates && arrival !== bar.arrival_date ? { arrival_date: arrival } : {}),
    ...(dates && departure !== bar.departure_date ? { departure_date: departure } : {}),
    ...(complimentary ? { upgrade_type: 'complimentary' } : {}),
  };
  const changed = Object.keys(body).some((k) => ['room_id', 'arrival_date', 'departure_date'].includes(k));
  const preview = useQuery({ queryKey: ['pms', 'calendar-preview', body], queryFn: async () => (await pPost<Impact>('/calendar/preview', body)).data, enabled: changed, retry: false });
  const target = data.rooms.find((r) => String(r.id) === room);
  const otherType = !!target && target.room_type_id !== bar.room_type_id;
  const i = preview.data?.impact;

  const move = async () => {
    setBusy(true);
    setError(null);
    try {
      toast('success', (await pPost('/calendar/move', { ...body, version: bar.version, ...(reason.trim() ? { reason: reason.trim() } : {}) })).message);
      void qc.invalidateQueries({ queryKey: ['pms', 'live'] });
      void qc.invalidateQueries({ queryKey: K.reservation(bar.reservation_id) });
      onClose();
    } catch (e) {
      setError(codeOf(e) === 'version_conflict' ? `${errorText(e)}` : errorText(e, 'The booking was not moved.'));
      if (codeOf(e) === 'version_conflict') void qc.invalidateQueries({ queryKey: ['pms', 'live', 'calendar'] });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`Move ${bar.confirmation_no}`}
      onClose={onClose}
      width={520}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} disabled={!changed || !!preview.error || preview.isLoading || !pms.online} onClick={() => void move()}>
            Move
          </Button>
        </div>
      }
    >
      <div className="grid grid-cols-2 gap-2 text-[12.5px]">
        <p className="col-span-2 m-0 text-ink-2">
          {bar.guest_name} · {bar.status_label} · {day(bar.arrival_date)} → {day(bar.departure_date)}
        </p>
        {rooms ? (
          <label className="col-span-2 flex flex-col gap-1">
            Room
            <Select aria-label="Room" value={room} options={[...(bar.room_id ? [] : [{ value: '', label: 'No room yet' }]), ...data.rooms.map((r) => ({ value: String(r.id), label: `${r.number} · ${r.room_type ?? ''}` }))]} onChange={(e) => setRoom(e.target.value)} className={input} />
          </label>
        ) : bar.in_house ? (
          <p className="col-span-2 m-0 text-ink-3">The guest is in house: a room move is made at the front desk.</p>
        ) : null}
        {otherType ? (
          <label className="col-span-2 flex items-center gap-2">
            <Checkbox checked={complimentary} onChange={(e) => setComplimentary(e.target.checked)} /> Complimentary (keep the booked type’s price)
          </label>
        ) : null}
        {dates ? (
          <>
            <label className="flex flex-col gap-1">
              Arrival
              <input aria-label="Arrival" type="date" value={arrival} disabled={bar.in_house} onChange={(e) => setArrival(e.target.value)} className={input} />
            </label>
            <label className="flex flex-col gap-1">
              Departure
              <input aria-label="Departure" type="date" value={departure} onChange={(e) => setDeparture(e.target.value)} className={input} />
            </label>
          </>
        ) : null}
        <label className="col-span-2 flex flex-col gap-1">
          Reason (kept on the move)
          <input aria-label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} className={input} />
        </label>
        <div className="col-span-2" aria-live="polite">
          {!changed ? null : preview.isLoading ? (
            <Spinner label="Asking what it would do…" />
          ) : preview.error ? (
            <Refusal text={errorText(preview.error, 'That move is not possible.')} />
          ) : i ? (
            <p className="m-0 rounded-[8px] bg-subtle px-2 py-1.5" aria-label="Price impact">
              Before {money(i.before, i.currency)} · after <b>{money(i.after, i.currency)}</b> · difference {money(i.difference, i.currency)}
            </p>
          ) : null}
        </div>
        {error ? (
          <div className="col-span-2">
            <Refusal text={error} />
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

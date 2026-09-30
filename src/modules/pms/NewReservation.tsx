import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Select } from '../../components/Select';
import { Button, ErrorNote, Spinner, cx } from '../../components/ui';
import { Field, input, Section } from '../garage/parts';
import { PageHead } from '../hr/parts';
import { codeOf, day, errorData, errorText, K, newKey, pGet, pPost, plusDays, type Availability, type RateOffer, type TypeOffer } from './api';
import GuestPick, { type PickedGuest } from './GuestPick';
import { Money, NoAccess, Refusal, usePms } from './parts';

export interface Pick {
  type: TypeOffer;
  rate: RateOffer;
}

export interface StayAsk {
  arrival: string;
  departure: string;
  adults: number;
  children: number;
  rooms: number;
}

/**
 * The server's availability for a stay (AVL-001…004, AC-03): each room type
 * with how many are free and each rate's price for the stay — or, for a rate
 * not on offer, the server's reasons ("Minimum stay 4 nights…").
 */
export function OfferList({ data, picked, onPick }: { data: Availability; picked: Pick | null; onPick: (p: Pick) => void }) {
  if (data.results.length === 0) return <p className="text-[13px] text-ink-3">No room type takes this stay.</p>;
  return (
    <div className="flex flex-col gap-2">
      {data.results.map((t) => (
        <div key={t.room_type_id} className={cx('rounded-[10px] border px-3 py-2', t.enough && t.fits ? 'border-line' : 'border-line opacity-80')}>
          <div className="flex flex-wrap items-center gap-2">
            <b className="text-[14px]">{t.name}</b>
            <span className={cx('text-[12.5px] font-semibold', t.enough ? 'text-success' : 'text-danger')}>{t.available} available</span>
            <span className="text-[12px] text-ink-3">up to {t.max_occupancy} guests</span>
            {t.why_not ? <span className="text-[12px] text-warning">{t.why_not}</span> : null}
          </div>
          <ul className="m-0 mt-1.5 flex list-none flex-col gap-1 p-0" aria-label={`Rates for ${t.name}`}>
            {t.rates.map((r) => {
              const on = picked?.type.room_type_id === t.room_type_id && picked.rate.rate_plan_id === r.rate_plan_id;
              const ok = r.available && t.enough && t.fits;
              return (
                <li key={r.rate_plan_id}>
                  <button
                    type="button"
                    disabled={!ok}
                    aria-pressed={on}
                    onClick={() => onPick({ type: t, rate: r })}
                    className={cx('flex w-full items-center gap-3 rounded-[8px] border px-2.5 py-1.5 text-left text-[13px]', on ? 'border-primary bg-selection' : 'border-transparent hover:bg-subtle', !ok && 'cursor-not-allowed')}
                  >
                    <span className="min-w-0 flex-1">
                      <b>{r.name}</b>
                      <span className="ml-2 text-[12px] text-ink-3">
                        {r.meal_plan ? r.meal_plan.replace(/_/g, ' ') : ''}
                        {r.refundable ? '' : ' · non-refundable'}
                      </span>
                      {r.reasons.length ? <span className="block text-[12px] text-warning">{r.reasons.join(' ')}</span> : null}
                    </span>
                    {r.available ? (
                      <span className="text-right">
                        <Money amount={r.total} currency={data.currency} className="font-bold" />
                        <span className="block text-[11px] text-ink-3">
                          <Money amount={r.average_nightly} currency={data.currency} /> a night
                        </span>
                      </span>
                    ) : (
                      <span className="text-[12px] text-ink-3">Not on offer</span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

const STATUSES = ['confirmed', 'guaranteed', 'reserved', 'tentative', 'inquiry', 'waitlisted'];

/**
 * A new reservation (PMS-RSV-010): search what is free, choose the room type
 * and rate, find or add the guest, the details, and book — once: the booking
 * carries an idempotency key, so a second press after a dropped answer is the
 * same reservation. The server claims the inventory night by night; if the
 * last room went meanwhile it says so (AC-01) and the search runs again.
 * New bookings wait for WorkSuite (PMS-DSK-003).
 */
export default function NewReservation({ room }: { room?: number | null }) {
  const pms = usePms();
  const qc = useQueryClient();
  const bd = pms.businessDate;
  const [stay, setStay] = useState<StayAsk>({ arrival: bd, departure: plusDays(bd, 1), adults: 2, children: 0, rooms: 1 });
  const [asked, setAsked] = useState<StayAsk | null>(null);
  const [source, setSource] = useState('');
  const [promo, setPromo] = useState('');
  const [pick, setPick] = useState<Pick | null>(null);
  const [guest, setGuest] = useState<PickedGuest | null>(null);
  const [details, setDetails] = useState({ status: '', booking_type: 'phone', guarantee_type: 'none', guarantee_ref: '', eta: '', special_requests: '', internal_notes: '', option_date: '' });
  const [override, setOverride] = useState<{ reasons: string[]; reason: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [key, setKey] = useState(() => newKey('booking'));
  const avail = useQuery({
    queryKey: K.availability({ pid: pms.property.id, ...asked, source, promo }),
    queryFn: ({ signal }) =>
      pGet<Availability>('/availability', { property_id: pms.property.id, arrival: asked!.arrival, departure: asked!.departure, adults: asked!.adults, children: asked!.children, rooms: asked!.rooms, source_id: source || undefined, promo_code: promo || undefined }, signal),
    enabled: !!asked && pms.online,
  });

  if (!pms.may('pms.reservation.create')) return <NoAccess what="Booking needs “Create reservations”." />;
  if (!pms.online) return <NoAccess what="New bookings wait for WorkSuite: the last room is sold by the server, so a booking is never taken against what this computer cannot see." />;

  const search = () => {
    setPick(null);
    setOverride(null);
    setError(null);
    setAsked({ ...stay });
  };

  const book = async () => {
    if (!pick || !guest || !asked) return;
    setBusy(true);
    setError(null);
    const line = { room_type_id: pick.type.room_type_id, rate_plan_id: pick.rate.rate_plan_id, adults: asked.adults, children: asked.children };
    const rooms = Array.from({ length: asked.rooms }, (_, i) => ({ ...line, ...(i === 0 && room && pms.mayAny('pms.room.move', 'pms.reservation.edit') ? { room_id: room } : {}) }));
    const body: Record<string, unknown> = {
      guest_id: guest.id,
      arrival_date: asked.arrival,
      departure_date: asked.departure,
      rooms,
      booking_type: details.booking_type,
      ...(details.status ? { status: details.status } : {}),
      ...(source ? { source_id: Number(source) } : {}),
      ...(promo ? { promo_code: promo } : {}),
      ...(details.guarantee_type !== 'none' ? { guarantee_type: details.guarantee_type, guarantee_ref: details.guarantee_ref || undefined } : {}),
      ...(details.eta ? { eta: details.eta } : {}),
      ...(details.special_requests ? { special_requests: details.special_requests } : {}),
      ...(details.internal_notes ? { internal_notes: details.internal_notes } : {}),
      ...(details.option_date ? { option_date: details.option_date } : {}),
      ...(override?.reason.trim() ? { override_restrictions: true, override_reason: override.reason.trim() } : {}),
    };
    try {
      const r = await pPost<{ id: number; confirmation_no: string }>(`/properties/${pms.property.id}/reservations`, body, key);
      setKey(newKey('booking'));
      void qc.invalidateQueries({ queryKey: K.live });
      void qc.invalidateQueries({ queryKey: ['pms', 'reservations'] });
      pms.open({ kind: 'reservation', id: r.data.id });
    } catch (e) {
      const code = codeOf(e);
      if (code === 'restricted') {
        setOverride({ reasons: errorData<{ reasons?: string[] }>(e)?.reasons ?? [], reason: '' });
        setError(errorText(e));
      } else if (code === 'no_longer_available') {
        setError(`${errorText(e)} The search has been run again.`);
        setPick(null);
        void avail.refetch();
      } else setError(errorText(e, 'The booking was not made.'));
      // A refusal is an answer: the next press is a new attempt.
      setKey(newKey('booking'));
    } finally {
      setBusy(false);
    }
  };

  const num = (v: string, min: number) => Math.max(min, Math.min(99, Number(v) || min));
  return (
    <div className="flex flex-col gap-4 px-6 py-5">
      <PageHead title="New reservation" sub={`${pms.property.name} · business date ${day(bd, true)}`}>
        <Button variant="ghost" icon="back" onClick={pms.back}>
          Back
        </Button>
      </PageHead>
      <Section title="1 · What is free">
        <form
          className="grid grid-cols-2 gap-3 md:grid-cols-6"
          onSubmit={(e) => {
            e.preventDefault();
            search();
          }}
        >
          <Field label="Arrival">
            <input aria-label="Arrival" type="date" className={input} min={bd} value={stay.arrival} onChange={(e) => setStay({ ...stay, arrival: e.target.value, departure: stay.departure <= e.target.value ? plusDays(e.target.value, 1) : stay.departure })} />
          </Field>
          <Field label="Departure">
            <input aria-label="Departure" type="date" className={input} min={plusDays(stay.arrival, 1)} value={stay.departure} onChange={(e) => setStay({ ...stay, departure: e.target.value })} />
          </Field>
          <Field label="Adults">
            <input aria-label="Adults" type="number" min={1} className={input} value={stay.adults} onChange={(e) => setStay({ ...stay, adults: num(e.target.value, 1) })} />
          </Field>
          <Field label="Children">
            <input aria-label="Children" type="number" min={0} className={input} value={stay.children} onChange={(e) => setStay({ ...stay, children: num(e.target.value, 0) })} />
          </Field>
          <Field label="Rooms">
            <input aria-label="Rooms" type="number" min={1} className={input} value={stay.rooms} onChange={(e) => setStay({ ...stay, rooms: num(e.target.value, 1) })} />
          </Field>
          <div className="flex items-end">
            <Button variant="primary" icon="search" className="w-full" onClick={search}>
              Search
            </Button>
          </div>
          <Field label="Source">
            <Select aria-label="Source" value={source} onChange={(e) => setSource(e.target.value)} options={[{ value: '', label: 'Direct' }, ...pms.options.sources.filter((s) => s.active !== false).map((s) => ({ value: String(s.id), label: s.name }))]} className={input} />
          </Field>
          <Field label="Promo code">
            <input aria-label="Promo code" className={input} value={promo} onChange={(e) => setPromo(e.target.value.toUpperCase())} />
          </Field>
          <button type="submit" hidden />
        </form>
        <div className="mt-3">
          {!asked ? null : avail.isLoading ? <Spinner label="Asking what is free…" /> : avail.error ? <ErrorNote error={avail.error} onRetry={() => void avail.refetch()} /> : avail.data ? <OfferList data={avail.data} picked={pick} onPick={setPick} /> : null}
        </div>
      </Section>

      {pick ? (
        <Section title="2 · The guest">
          <GuestPick picked={guest} onPick={setGuest} />
        </Section>
      ) : null}

      {pick && guest ? (
        <Section title="3 · Details">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Field label="Status" hint="Blank: the property’s default.">
              <Select aria-label="Status" value={details.status} onChange={(e) => setDetails({ ...details, status: e.target.value })} options={[{ value: '', label: 'Default' }, ...pms.options.reservation_statuses.filter((s) => STATUSES.includes(s.value)).map((s) => ({ value: s.value, label: s.label }))]} className={input} />
            </Field>
            <Field label="Taken by">
              <Select aria-label="Taken by" value={details.booking_type} onChange={(e) => setDetails({ ...details, booking_type: e.target.value })} options={pms.options.booking_types.filter((b) => b.value !== 'walk_in')} className={input} />
            </Field>
            <Field label="Guarantee">
              <Select aria-label="Guarantee" value={details.guarantee_type} onChange={(e) => setDetails({ ...details, guarantee_type: e.target.value })} options={pms.options.guarantees} className={input} />
            </Field>
            {details.guarantee_type !== 'none' ? (
              <Field label="Guarantee reference">
                <input aria-label="Guarantee reference" className={input} value={details.guarantee_ref} onChange={(e) => setDetails({ ...details, guarantee_ref: e.target.value })} />
              </Field>
            ) : null}
            {details.status === 'tentative' ? (
              <Field label="Option date">
                <input aria-label="Option date" type="date" className={input} value={details.option_date} onChange={(e) => setDetails({ ...details, option_date: e.target.value })} />
              </Field>
            ) : null}
            <Field label="ETA">
              <input aria-label="ETA" className={input} placeholder="15:30" value={details.eta} onChange={(e) => setDetails({ ...details, eta: e.target.value })} />
            </Field>
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <Field label="Special requests">
              <textarea aria-label="Special requests" className={cx(input, 'h-auto py-2')} rows={2} value={details.special_requests} onChange={(e) => setDetails({ ...details, special_requests: e.target.value })} />
            </Field>
            <Field label="Internal notes">
              <textarea aria-label="Internal notes" className={cx(input, 'h-auto py-2')} rows={2} value={details.internal_notes} onChange={(e) => setDetails({ ...details, internal_notes: e.target.value })} />
            </Field>
          </div>
          {override ? (
            <div className="mt-3 flex flex-col gap-2 rounded-[10px] border border-warning/40 bg-warning-bg px-3 py-2 text-[12.5px]">
              {override.reasons.map((r) => (
                <span key={r} className="text-warning">
                  {r}
                </span>
              ))}
              {pms.may('pms.rate.override') ? (
                <Field label="Book through the restrictions — why">
                  <input aria-label="Why the restrictions are overridden" className={input} value={override.reason} onChange={(e) => setOverride({ ...override, reason: e.target.value })} />
                </Field>
              ) : (
                <span className="text-ink-2">Booking through a restriction needs “Override rates and restrictions”.</span>
              )}
            </div>
          ) : null}
          {error ? <div className="mt-3"><Refusal text={error} /></div> : null}
          <div className="mt-3 flex items-center gap-3">
            <Button variant="primary" size="lg" icon="check" loading={busy} onClick={() => void book()}>
              Book {pick.type.name}, {pick.rate.name}
            </Button>
            <span className="text-[13px] text-ink-2">
              <Money amount={pick.rate.total} currency={avail.data?.currency} className="font-bold" /> for {asked?.rooms ?? 1} {asked && asked.rooms > 1 ? 'rooms' : 'room'}, {day(asked?.arrival)} → {day(asked?.departure)}
            </span>
          </div>
        </Section>
      ) : null}
    </div>
  );
}

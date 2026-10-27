import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Select } from '../../components/Select';
import { Button, ErrorNote, Spinner, cx } from '../../components/ui';
import { toast } from '../../core/toasts';
import { Field, input, Section } from '../../components/FormKit';
import { PageHead } from '../../components/PageKit';
import { codeOf, day, errorText, K, newKey, pGet, pGetMeta, pPost, plusDays, type Availability, type KeyResult, type Rack } from './api';
import GuestPick, { type PickedGuest } from './GuestPick';
import { deskName, METHODS, PROVIDER_METHODS, useMyShift } from './money';
import { OfferList, type Pick } from './NewReservation';
import { Money, NoAccess, Refusal, usePms } from './parts';
import { Checkbox } from '../../components/Checkbox';

/**
 * The walk-in (PMS-WLK-001/002): a guest at the desk with no booking, taken on
 * one screen — how long, who, which type and rate from what is free tonight,
 * the room, a payment if there is one — and checked in. The server checks the
 * room before it books, books through the same inventory claim as any
 * reservation, checks in, and takes the payment on the new folio; a check-in
 * that fails after the booking cancels the booking. One press is one walk-in.
 */
export default function WalkIn({ room }: { room: number | null }) {
  const pms = usePms();
  const qc = useQueryClient();
  const bd = pms.businessDate;
  const pid = pms.property.id;
  const { shift } = useMyShift();
  const [dep, setDep] = useState(plusDays(bd, 1));
  const [adults, setAdults] = useState(1);
  const [children, setChildren] = useState(0);
  const [asked, setAsked] = useState(false);
  const [pick, setPick] = useState<Pick | null>(null);
  const [roomId, setRoomId] = useState<number | null>(room);
  const [guest, setGuest] = useState<PickedGuest | null>(null);
  const [idOk, setIdOk] = useState(false);
  const [requests, setRequests] = useState('');
  const [pay, setPay] = useState({ on: false, method: 'cash', amount: '', last4: '', ref: '' });
  const [overrideReason, setOverrideReason] = useState('');
  const [needsOverride, setNeedsOverride] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [key, setKey] = useState(() => newKey('walkin'));
  const avail = useQuery({
    queryKey: K.availability({ pid, walkin: true, bd, dep, adults, children }),
    queryFn: ({ signal }) => pGet<Availability>('/availability', { property_id: pid, arrival: bd, departure: dep, adults, children, rooms: 1 }, signal),
    enabled: asked && pms.online,
  });
  const rack = useQuery({ queryKey: K.rack(pid), queryFn: ({ signal }) => pGetMeta<Rack>(`/properties/${pid}/rack`, undefined, signal) });
  const assigns = pms.mayAny('pms.room.move', 'pms.reservation.edit');

  if (!(pms.may('pms.checkin') && pms.may('pms.reservation.create'))) return <NoAccess what="A walk-in needs “Check guests in” and “Create reservations”." />;
  if (!pms.online) return <NoAccess what="A walk-in waits for WorkSuite: the room is sold and checked in by the server." />;

  const rooms = (rack.data?.data.rooms ?? [])
    .filter((r) => pick && r.room_type_id === pick.type.room_type_id && r.occupancy === 'vacant' && r.service_status === 'in_service')
    .sort((a, b) => Number(b.ready) - Number(a.ready) || a.number.localeCompare(b.number, undefined, { numeric: true }));
  const fromRack = room ? rack.data?.data.rooms.find((r) => r.id === room) : null;
  const payOk = !pay.on || (/^\d+(\.\d{1,2})?$/.test(pay.amount) && Number(pay.amount) > 0 && (!pay.last4 || /^\d{4}$/.test(pay.last4)));

  const go = async () => {
    if (!pick || !guest) return;
    setBusy(true);
    setError(null);
    const body: Record<string, unknown> = {
      guest_id: guest.id,
      room_type_id: pick.type.room_type_id,
      rate_plan_id: pick.rate.rate_plan_id,
      adults,
      children,
      departure_date: dep,
      ...(roomId && assigns ? { room_id: roomId } : {}),
      ...(requests.trim() ? { special_requests: requests.trim() } : {}),
      ...(idOk ? { id_verified: true } : {}),
      ...(overrideReason.trim() ? { override_reason: overrideReason.trim() } : {}),
      ...(pay.on
        ? { payment: { method: pay.method, amount: pay.amount, currency: pms.property.currency, terminal: deskName(shift), ...(pay.last4 ? { card_last4: pay.last4 } : {}), ...(pay.ref ? { provider_ref: pay.ref } : {}) } }
        : {}),
    };
    try {
      const r = await pPost<{ id: number; confirmation_no: string; stays: Array<{ stay_id: number; room_number: string; key: KeyResult }> }>(`/properties/${pid}/walk-ins`, body, key);
      setKey(newKey('walkin'));
      void qc.invalidateQueries({ queryKey: K.live });
      const first = r.data.stays?.[0];
      toast('success', `${r.message}${first ? ` Room ${first.room_number}. ${first.key?.message ?? ''}` : ''}`);
      if (first) pms.open({ kind: 'stay', id: first.stay_id, folio: null });
      else pms.open({ kind: 'reservation', id: r.data.id });
    } catch (e) {
      if (codeOf(e) === 'room_not_ready') setNeedsOverride(true);
      setError(errorText(e, 'The walk-in was not checked in.'));
      setKey(newKey('walkin'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 px-6 py-5">
      <PageHead title="Walk-in" sub={`Checking in today, ${day(bd, true)}${fromRack ? ` · room ${fromRack.number}` : ''}`}>
        <Button variant="ghost" icon="back" onClick={pms.back}>
          Back
        </Button>
      </PageHead>
      <Section title="The stay">
        <form
          className="grid grid-cols-2 gap-3 md:grid-cols-4"
          onSubmit={(e) => {
            e.preventDefault();
            setPick(null);
            setAsked(true);
          }}
        >
          <Field label="Leaving on">
            <input aria-label="Leaving on" type="date" className={input} min={plusDays(bd, 1)} value={dep} onChange={(e) => (setDep(e.target.value), setPick(null))} />
          </Field>
          <Field label="Adults">
            <input aria-label="Adults" type="number" min={1} className={input} value={adults} onChange={(e) => setAdults(Math.max(1, Number(e.target.value) || 1))} />
          </Field>
          <Field label="Children">
            <input aria-label="Children" type="number" min={0} className={input} value={children} onChange={(e) => setChildren(Math.max(0, Number(e.target.value) || 0))} />
          </Field>
          <div className="flex items-end">
            <Button variant="primary" icon="search" className="w-full" onClick={() => (setPick(null), setAsked(true))}>
              What is free tonight
            </Button>
          </div>
          <button type="submit" hidden />
        </form>
        <div className="mt-3">{!asked ? null : avail.isLoading ? <Spinner /> : avail.error ? <ErrorNote error={avail.error} /> : avail.data ? <OfferList data={avail.data} picked={pick} onPick={(p) => (setPick(p), setRoomId(room && fromRack?.room_type_id === p.type.room_type_id ? room : null))} /> : null}</div>
      </Section>

      {pick ? (
        <Section title="The guest">
          <GuestPick picked={guest} onPick={setGuest} />
        </Section>
      ) : null}

      {pick && guest ? (
        <Section title="Room, payment and check-in">
          <div className="grid gap-3 md:grid-cols-2">
            {assigns ? (
              <Field label="Room" hint="Blank: the best ready room of the type.">
                <Select
                  aria-label="Room"
                  value={roomId ? String(roomId) : ''}
                  onChange={(e) => setRoomId(e.target.value ? Number(e.target.value) : null)}
                  options={[{ value: '', label: 'The best ready room' }, ...rooms.map((r) => ({ value: String(r.id), label: `${r.number}${r.ready ? ' · ready' : ` · ${r.hk_status_label.toLowerCase()}`}` }))]}
                  className={input}
                />
              </Field>
            ) : null}
            <Field label="Special requests">
              <input aria-label="Special requests" className={input} value={requests} onChange={(e) => setRequests(e.target.value)} />
            </Field>
          </div>
          <label className="mt-3 flex items-center gap-2 text-[13px]">
            <Checkbox checked={idOk} onChange={(e) => setIdOk(e.target.checked)} /> The guest’s ID has been checked
          </label>
          {pms.may('pms.payment.process') ? (
            <div className="mt-3 flex flex-col gap-2 rounded-[10px] border border-line px-3 py-2">
              <label className="flex items-center gap-2 text-[13px] font-semibold">
                <Checkbox checked={pay.on} onChange={(e) => setPay({ ...pay, on: e.target.checked, amount: pay.amount || pick.rate.total })} /> Take a payment now
              </label>
              {pay.on ? (
                <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                  <Select aria-label="Method" value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value })} options={METHODS} className={input} />
                  <input aria-label="Amount" className={input} inputMode="decimal" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} />
                  {PROVIDER_METHODS.has(pay.method) ? (
                    <>
                      <input aria-label="Last four digits" className={input} maxLength={4} placeholder="Last 4" value={pay.last4} onChange={(e) => setPay({ ...pay, last4: e.target.value.replace(/\D/g, '').slice(0, 4) })} />
                      <input aria-label="Reference" className={input} placeholder="Approval code" value={pay.ref} onChange={(e) => setPay({ ...pay, ref: e.target.value })} />
                    </>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
          {needsOverride && pms.may('pms.checkin.override') ? (
            <div className="mt-3">
              <Field label="Check in to a room that is not ready — why">
                <input aria-label="Override reason" className={input} value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} />
              </Field>
            </div>
          ) : null}
          {error ? <div className="mt-3"><Refusal text={error} /></div> : null}
          <div className="mt-3 flex items-center gap-3">
            <Button variant="primary" size="lg" icon="log-in" loading={busy} disabled={!payOk} onClick={() => void go()}>
              Check in {guest.name}
            </Button>
            <span className={cx('text-[13px] text-ink-2')}>
              {pick.type.name}, {pick.rate.name}: <Money amount={pick.rate.total} currency={avail.data?.currency} className="font-bold" /> until {day(dep)}
            </span>
          </div>
        </Section>
      ) : null}
    </div>
  );
}

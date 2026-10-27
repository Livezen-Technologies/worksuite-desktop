import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Button, ErrorNote, Spinner } from '../../components/ui';
import { toast } from '../../core/toasts';
import { Ask, Section, type AskField } from '../../components/FormKit';
import { PageHead } from '../../components/PageKit';
import AssignRoom from './Assign';
import { codeOf, day, errorText, isZero, K, money, newKey, pGet, pPost, stamp, type Deposit, type FolioShape, type Payment, type ReservationView, type Stay } from './api';
import { PaymentDialog } from './money';
import { Facts, Money, occupants, Refusal, ReservationPill, usePms, VipPill } from './parts';
import { useShortcut } from './shortcuts';

interface History {
  activity: Array<{ action: string; text: string; business_date: string | null; by: string | null; channel: string | null; at: string }>;
  moves: Array<{ from_room_id: number | null; to_room_id: number | null; move_type: string; reason: string | null; at?: string; created_at?: string }>;
}

/** Whether a reservation has rooms still to check in (the status allows it and a room is due). */
export function checkInOpen(r: Pick<ReservationView, 'status' | 'rooms_detail'>): boolean {
  return ['reserved', 'confirmed', 'guaranteed', 'checked_in'].includes(r.status) && r.rooms_detail.some((l) => l.status === 'pending');
}

/**
 * A reservation (§6): who, when, which rooms at what price, where it stands
 * and the moves the server offers this person from there (ReservationMachine's
 * edges), the rooms' numbers, the deposit, its history. Check-in and
 * check-out open their own screens; a guest in house opens their stay.
 */
export default function Reservation({ id }: { id: number }) {
  const pms = usePms();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: K.reservation(id), queryFn: ({ signal }) => pGet<{ reservation: ReservationView }>(`/reservations/${id}`, undefined, signal) });
  const r = q.data?.reservation;
  const [ask, setAsk] = useState<{ kind: 'status'; to: string; label: string; needs: string[] } | { kind: 'cancel' } | { kind: 'edit' } | null>(null);
  const [assign, setAssign] = useState<{ line: number; what: string; current: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  useEffect(() => {
    if (r) pms.adopt(r.property_id);
  }, [r, pms]);

  const stays = useQuery({
    queryKey: [...K.inHouse(r?.property_id ?? 0), 'of', id],
    queryFn: ({ signal }) => pGet<{ items: Stay[] }>(`/properties/${r!.property_id}/in-house`, undefined, signal).then((x) => x.items.filter((s) => s.reservation_id === id)),
    enabled: !!r && r.status === 'checked_in',
  });
  const history = useQuery({ queryKey: K.history(id), queryFn: ({ signal }) => pGet<History>(`/reservations/${id}/history`, undefined, signal), enabled: showHistory });

  useShortcut('checkin', () => {
    if (!r || !checkInOpen(r) || !pms.may('pms.checkin')) return false;
    pms.open({ kind: 'checkin', id });
    return true;
  });

  const reload = () => {
    void qc.invalidateQueries({ queryKey: K.reservation(id) });
    void qc.invalidateQueries({ queryKey: K.live });
    void qc.invalidateQueries({ queryKey: ['pms', 'reservations'] });
  };

  if (q.isLoading) return <Spinner />;
  if (q.error || !r) {
    return (
      <div className="flex flex-col gap-3 p-6">
        <Button icon="back" className="self-start" onClick={pms.back}>
          Back
        </Button>
        <ErrorNote error={q.error ?? new Error('The reservation could not be loaded.')} onRetry={() => void q.refetch()} />
      </div>
    );
  }

  const run = async (fn: () => Promise<{ message: string }>, fallback: string) => {
    setBusy(true);
    setRefusal(null);
    try {
      const res = await fn();
      toast('success', res.message);
      setAsk(null);
      reload();
    } catch (e) {
      setRefusal(codeOf(e) === 'version_conflict' ? `${errorText(e)} It has been reloaded.` : errorText(e, fallback));
      setAsk(null);
      reload();
    } finally {
      setBusy(false);
    }
  };

  const moves = r.options.filter((o) => o.to !== 'cancelled');
  const mayCancel = r.options.some((o) => o.to === 'cancelled');
  const edits = pms.may('pms.reservation.edit') && !['checked_out', 'cancelled', 'no_show'].includes(r.status);
  const assigns = pms.mayAny('pms.room.move', 'pms.reservation.edit');
  const unnumbered = r.rooms_detail.filter((l) => l.status === 'pending' && !l.room_id);

  const statusFields = (needs: string[], to: string): AskField[] => [
    ...(needs.includes('option_date') || to === 'tentative' ? [{ name: 'option_date', label: 'Option date', type: 'date' as const, required: true, hint: 'The booking is released if not confirmed by then.' }] : []),
    ...(to === 'guaranteed'
      ? [
          { name: 'guarantee_type', label: 'Guarantee', type: 'select' as const, options: pms.options.guarantees.filter((g) => g.value !== 'none'), initial: r.guarantee_type !== 'none' ? r.guarantee_type : undefined },
          { name: 'guarantee_ref', label: 'Reference', placeholder: 'Card token reference, voucher or company', initial: r.guarantee_ref ?? '' },
        ]
      : []),
    ...(needs.includes('reason') ? [{ name: 'reason', label: 'Reason', required: true }] : []),
  ];

  return (
    <div className="flex flex-col gap-4 px-6 py-5">
      <PageHead
        title={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono">{r.confirmation_no}</span>
            <ReservationPill label={r.status_label} badge={r.badge} />
            <VipPill level={r.vip_level} />
          </span>
        }
        sub={`${r.guest_name ?? ''} · ${day(r.arrival_date, true)} → ${day(r.departure_date, true)} · ${r.nights} ${r.nights === 1 ? 'night' : 'nights'}`}
      >
        <Button variant="ghost" icon="back" onClick={pms.back}>
          Back
        </Button>
        <Button variant="ghost" icon="app-window" title="Open in a window of its own" onClick={() => pms.openWindow({ kind: 'reservation', id }, `Reservation ${r.confirmation_no}`)}>
          Window
        </Button>
        {checkInOpen(r) && pms.may('pms.checkin') ? (
          <Button variant="primary" icon="log-in" disabled={!pms.online} title={pms.online ? 'Alt+I' : 'Needs WorkSuite'} onClick={() => pms.open({ kind: 'checkin', id })}>
            Check in
          </Button>
        ) : null}
        {r.status === 'checked_in' && pms.may('pms.checkout') && pms.may('pms.folio.view') ? (
          <Button variant="primary" icon="logout" disabled={!pms.online} onClick={() => pms.open({ kind: 'checkout', id })}>
            Check out
          </Button>
        ) : null}
      </PageHead>

      {refusal ? <Refusal text={refusal} /> : null}

      <div className="flex flex-wrap gap-2">
        {moves.map((o) => (
          <Button key={o.to} size="sm" disabled={busy || !pms.online} onClick={() => setAsk({ kind: 'status', to: o.to, label: o.label, needs: o.needs })}>
            {o.label}
          </Button>
        ))}
        {edits ? (
          <Button size="sm" icon="compose" disabled={!pms.online} onClick={() => setAsk({ kind: 'edit' })}>
            Edit
          </Button>
        ) : null}
        {assigns && unnumbered.length > 0 ? (
          <Button size="sm" icon="bed" disabled={busy || !pms.online} onClick={() => void run(() => pPost(`/reservations/${id}/assign`, { rooms: unnumbered.map((l) => l.id) }), 'No room was assigned.')}>
            Assign rooms automatically
          </Button>
        ) : null}
        {mayCancel ? (
          <Button size="sm" variant="danger" disabled={busy || !pms.online} onClick={() => setAsk({ kind: 'cancel' })}>
            Cancel reservation
          </Button>
        ) : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Guest and booking">
          <Facts
            rows={[
              [
                'Guest',
                r.guest && pms.may('pms.guest.view') ? (
                  <button type="button" className="font-semibold text-primary" onClick={() => pms.open({ kind: 'guest', id: r.guest!.id })}>
                    {r.guest.name}
                  </button>
                ) : (
                  r.guest_name
                ),
              ],
              ['Guests', occupants(r.adults, r.children)],
              ['Source', r.source?.name ?? '—'],
              ['Booking', r.booking_type.replace(/_/g, ' ')],
              ['ETA', r.eta ?? '—'],
              ['Guarantee', `${r.guarantee_type}${r.guarantee_ref ? ` · ${r.guarantee_ref}` : ''}`],
              ['Option date', r.option_date ? day(r.option_date) : '—'],
              ['Total', <Money key="t" amount={r.total_amount} currency={r.currency} />],
              ['Deposit asked', money(r.deposit_required, r.currency)],
              ['Channel reference', r.channel_ref ?? '—'],
            ]}
          />
          {r.guest?.preferences.filter((p) => p.is_flag).length ? <p className="mt-2 mb-0 text-[12.5px] text-warning">{r.guest.preferences.filter((p) => p.is_flag).map((p) => p.preference).join(' · ')}</p> : null}
          {r.special_requests ? <p className="mt-2 mb-0 text-[12.5px] text-ink-2">Requests: {r.special_requests}</p> : null}
          {r.internal_notes ? <p className="mt-1 mb-0 text-[12.5px] text-ink-3">Internal: {r.internal_notes}</p> : null}
          {r.cancel_reason ? <p className="mt-2 mb-0 text-[12.5px] text-danger">Cancelled: {r.cancel_reason} · fee {money(r.cancel_fee, r.currency)}</p> : null}
        </Section>
        <Section title="In house">
          {r.status !== 'checked_in' ? (
            <p className="m-0 text-[13px] text-ink-3">Nobody from this reservation is in house.</p>
          ) : stays.isLoading ? (
            <Spinner />
          ) : (
            <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
              {(stays.data ?? []).map((s) => (
                <li key={s.id} className="flex items-center gap-2 text-[13px]">
                  <b className="w-12 tabular-nums">{s.room_number}</b>
                  <span className="min-w-0 flex-1 truncate">
                    {s.guest_name} · until {day(s.departure_date)}
                  </span>
                  <Button size="sm" onClick={() => pms.open({ kind: 'stay', id: s.id, folio: null })}>
                    Stay & folio
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      <Section title="Rooms">
        <div className="overflow-hidden rounded-[10px] border border-line">
          <table className="w-full text-left text-[13px]">
            <thead className="bg-subtle text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase">
              <tr>
                <th className="px-3 py-2">Room</th>
                <th className="px-3 py-2">Type · rate</th>
                <th className="px-3 py-2">Dates</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {r.rooms_detail.map((l) => (
                <tr key={l.id} className="border-t border-line align-top">
                  <td className="px-3 py-2">
                    {l.room_number ? <b className="tabular-nums">{l.room_number}</b> : <span className="text-warning">no room yet</span>}
                    {assigns && l.status === 'pending' ? (
                      <button
                        type="button"
                        className="ml-2 text-[12px] font-semibold text-primary disabled:opacity-50"
                        disabled={!pms.online}
                        onClick={() => setAssign({ line: l.id, what: `${r.confirmation_no} · ${l.room_type ?? 'room'} ${l.line_no}`, current: l.room_number })}
                      >
                        {l.room_number ? 'Change' : 'Assign'}
                      </button>
                    ) : null}
                    {l.upgrade_type ? <span className="block text-[11px] text-primary">{l.upgrade_type} upgrade</span> : null}
                  </td>
                  <td className="px-3 py-2">
                    {l.room_type}
                    <span className="block text-[11.5px] text-ink-3">
                      {l.rate_plan} · {occupants(l.adults, l.children)}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-ink-2">
                    {day(l.arrival_date)} → {day(l.departure_date)}
                  </td>
                  <td className="px-3 py-2 text-ink-2">{l.status_label}</td>
                  <td className="px-3 py-2 text-right">
                    <Money amount={l.total_amount} currency={r.currency} />
                    <span className="block text-[11px] text-ink-3" title={l.nights.map((n) => `${n.date}: ${money(n.amount)}${n.is_override ? ` (${n.override_reason ?? 'typed over'})` : ''}`).join('\n')}>
                      {l.nights.length} {l.nights.length === 1 ? 'night' : 'nights'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {r.addons.length ? (
          <ul className="mt-2 mb-0 list-none p-0 text-[12.5px] text-ink-2">
            {r.addons.map((a) => (
              <li key={a.id}>
                {a.package} × {a.quantity} · {money(a.total_amount, r.currency)}
              </li>
            ))}
          </ul>
        ) : null}
      </Section>

      {pms.may('pms.payment.view') ? <DepositPanel reservationId={id} propertyId={r.property_id} confirmation={r.confirmation_no} currency={r.currency} onChanged={reload} /> : null}

      <Section
        title="History"
        action={
          <Button size="sm" variant="ghost" onClick={() => setShowHistory(!showHistory)}>
            {showHistory ? 'Hide' : 'Show'}
          </Button>
        }
      >
        {!showHistory ? (
          <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[12.5px]">
            {r.status_history.map((h, i) => (
              <li key={i} className="text-ink-2">
                {stamp(h.at)} · {h.from ? `${h.from} → ` : ''}
                <b>{h.to}</b>
                {h.by ? ` · ${h.by}` : ''}
                {h.reason ? ` · ${h.reason}` : ''}
              </li>
            ))}
          </ul>
        ) : history.isLoading ? (
          <Spinner />
        ) : history.error ? (
          <ErrorNote error={history.error} />
        ) : (
          <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[12.5px]">
            {(history.data?.activity ?? []).map((a, i) => (
              <li key={i} className="text-ink-2">
                {stamp(a.at)} · {a.text}
                {a.by ? ` · ${a.by}` : ''}
              </li>
            ))}
          </ul>
        )}
      </Section>

      {ask?.kind === 'status' ? (
        <Ask
          title={ask.label}
          fields={statusFields(ask.needs, ask.to)}
          confirm={ask.label}
          busy={busy}
          onClose={() => setAsk(null)}
          onSubmit={(v) => void run(() => pPost(`/reservations/${id}/status`, { to: ask.to, version: r.version, ...Object.fromEntries(Object.entries(v).filter(([, x]) => x !== '')) }), 'The status was not changed.')}
        />
      ) : null}
      {ask?.kind === 'cancel' ? (
        <Ask
          title={`Cancel ${r.confirmation_no}`}
          text={r.cancellation ? `The rate plan’s policy: ${money(r.cancellation.fee, r.currency)} — ${r.cancellation.why}` : 'The rate plan’s policy decides the fee.'}
          fields={[
            { name: 'reason', label: 'Reason', required: true },
            ...(pms.may('pms.rate.override') ? [{ name: 'waive', label: 'The fee', type: 'select' as const, options: [{ value: '', label: 'Charge it as the policy says' }, { value: '1', label: 'Waive it' }] }] : []),
          ]}
          confirm="Cancel reservation"
          danger
          busy={busy}
          onClose={() => setAsk(null)}
          onSubmit={(v) => void run(() => pPost(`/reservations/${id}/cancel`, { reason: v.reason, version: r.version, ...(v.waive === '1' ? { waive_fee: true } : {}) }), 'The reservation was not cancelled.')}
        />
      ) : null}
      {ask?.kind === 'edit' ? (
        <Ask
          title={`Change ${r.confirmation_no}`}
          text="The server prices the change again and checks it against what is free and the restrictions; a guest in house changes their stay from the stay."
          fields={[
            ...(r.status !== 'checked_in' ? [{ name: 'arrival_date', label: 'Arrival', type: 'date' as const, initial: r.arrival_date }] : []),
            { name: 'departure_date', label: 'Departure', type: 'date', initial: r.departure_date },
            { name: 'eta', label: 'ETA', initial: r.eta ?? '', placeholder: '15:30' },
            { name: 'special_requests', label: 'Special requests', type: 'textarea', initial: r.special_requests ?? '' },
            { name: 'internal_notes', label: 'Internal notes', type: 'textarea', initial: r.internal_notes ?? '' },
            { name: 'reason', label: 'Why (kept in the history)' },
          ]}
          busy={busy}
          onClose={() => setAsk(null)}
          onSubmit={(v) => {
            const was: Record<string, string> = { arrival_date: r.arrival_date, departure_date: r.departure_date, eta: r.eta ?? '', special_requests: r.special_requests ?? '', internal_notes: r.internal_notes ?? '' };
            const changed = Object.fromEntries(Object.entries(v).filter(([k, x]) => k !== 'reason' && x !== was[k]));
            if (Object.keys(changed).length === 0) return setAsk(null);
            void run(() => pPost(`/reservations/${id}`, { ...changed, version: r.version, ...(v.reason ? { reason: v.reason } : {}) }), 'The reservation was not changed.');
          }}
        />
      ) : null}
      {assign ? (
        <AssignRoom
          lineId={assign.line}
          version={r.version}
          what={assign.what}
          current={assign.current}
          onClose={() => setAssign(null)}
          onDone={() => {
            setAssign(null);
            reload();
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * The reservation's deposit (§10.4): required, paid, remaining, refundable;
 * paid here (online only, with an idempotency key), waived or refunded with a
 * reason, as the server allows — and what it holds applied to one of the
 * reservation's open folios (`POST reservations/{id}/deposit/apply`, for
 * `pms.payment.process`): the server takes the smaller of what is available
 * and what the folio owes, or the amount given.
 */
function DepositPanel({ reservationId, propertyId, confirmation, currency, onChanged }: { reservationId: number; propertyId: number; confirmation: string; currency: string; onChanged: () => void }) {
  const pms = usePms();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: K.deposit(reservationId), queryFn: ({ signal }) => pGet<{ deposit: Deposit | null; payments: Payment[] }>(`/reservations/${reservationId}/deposit`, undefined, signal) });
  const [paying, setPaying] = useState(false);
  const [asking, setAsking] = useState<'waive' | 'refund' | 'apply' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [key] = useState(() => newKey('deposit'));
  const d = q.data?.deposit ?? null;
  const applies = !!d && !isZero(d.available) && pms.may('pms.payment.process') && pms.may('pms.folio.view');
  const folios = useQuery({
    queryKey: [...K.folios(propertyId, 'open'), 'of', reservationId],
    queryFn: ({ signal }) => pGet<{ items: FolioShape[] }>(`/properties/${propertyId}/folios`, { status: 'open', q: confirmation }, signal).then((x) => x.items.filter((f) => f.reservation_id === reservationId)),
    enabled: applies && asking === 'apply',
  });

  const done = (message: string) => {
    toast('success', message);
    setPaying(false);
    setAsking(null);
    void qc.invalidateQueries({ queryKey: K.deposit(reservationId) });
    void qc.invalidateQueries({ queryKey: ['pms', 'folios'] });
    void qc.invalidateQueries({ queryKey: ['pms', 'folio'] });
    onChanged();
  };
  const act = async (fn: () => Promise<{ message: string }>) => {
    setBusy(true);
    setError(null);
    try {
      done((await fn()).message);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  if (q.isLoading) return null;
  if (q.error) return <ErrorNote error={q.error} />;
  return (
    <Section
      title="Deposit"
      action={
        pms.may('pms.payment.process') ? (
          <span className="flex gap-1.5">
            <Button size="sm" icon="wallet" disabled={!pms.online} onClick={() => setPaying(true)}>
              Take deposit
            </Button>
            {d?.status === 'required' ? (
              <Button size="sm" variant="ghost" disabled={!pms.online} onClick={() => setAsking('waive')}>
                Waive
              </Button>
            ) : null}
            {applies ? (
              <Button size="sm" variant="ghost" disabled={!pms.online} onClick={() => setAsking('apply')}>
                Apply to folio
              </Button>
            ) : null}
            {d && pms.may('pms.refund') && ['paid', 'remaining'].includes(d.status) ? (
              <Button size="sm" variant="ghost" disabled={!pms.online} onClick={() => setAsking('refund')}>
                Refund
              </Button>
            ) : null}
          </span>
        ) : null
      }
    >
      {!d ? (
        <p className="m-0 text-[13px] text-ink-3">No deposit is asked for this booking.</p>
      ) : (
        <Facts
          rows={[
            ['Status', `${d.status_label}${d.overdue ? ' · overdue' : ''}`],
            ['Required', money(d.required, d.currency)],
            ['Due', d.due_date ? day(d.due_date) : '—'],
            ['Paid', money(d.paid, d.currency)],
            ['Remaining', money(d.remaining, d.currency)],
            ['Available to apply', money(d.available, d.currency)],
            ['Refundable', money(d.refundable, d.currency)],
          ]}
        />
      )}
      {error && !paying && !asking ? <div className="mt-2"><Refusal text={error} /></div> : null}
      {paying ? (
        <PaymentDialog
          title="Take a deposit"
          currency={d?.currency ?? currency}
          owed={d?.remaining ?? null}
          busy={busy}
          error={error}
          onClose={() => {
            setPaying(false);
            setError(null);
          }}
          onPay={(body) => void act(() => pPost(`/reservations/${reservationId}/deposit/payments`, body, key))}
        />
      ) : null}
      {asking === 'apply' && d ? (
        folios.isLoading ? (
          <Spinner />
        ) : (folios.data ?? []).length === 0 ? (
          <Ask title="Apply the deposit" text={folios.error ? errorText(folios.error) : 'This reservation has no open folio to apply the deposit to. A folio opens at check-in.'} fields={[]} confirm="Close" onClose={() => setAsking(null)} onSubmit={() => setAsking(null)} />
        ) : (
          <Ask
            title="Apply the deposit"
            text={`${money(d.available, d.currency)} of the deposit is available. The server applies no more than the folio owes.`}
            fields={[
              { name: 'folio_id', label: 'Folio', type: 'select', required: true, options: folios.data!.map((f) => ({ value: String(f.id), label: `${f.folio_no} · ${f.label} · owes ${money(f.balance, f.currency)}` })) },
              { name: 'amount', label: 'Amount', hint: 'Blank: as much as the folio owes, up to what is available.' },
            ]}
            busy={busy}
            confirm="Apply"
            onClose={() => setAsking(null)}
            onSubmit={(v) => void act(() => pPost(`/reservations/${reservationId}/deposit/apply`, { folio_id: Number(v.folio_id), ...(v.amount ? { amount: v.amount } : {}) }))}
          />
        )
      ) : null}
      {(asking === 'waive' || asking === 'refund') && d ? (
        <Ask
          title={asking === 'waive' ? 'Waive the deposit' : 'Refund the deposit'}
          fields={[...(asking === 'refund' ? [{ name: 'amount', label: 'Amount', hint: `Blank: all that can be refunded (${money(d.refundable, d.currency)}).` }] : []), { name: 'reason', label: 'Reason', required: true }]}
          busy={busy}
          danger={asking === 'refund'}
          confirm={asking === 'waive' ? 'Waive' : 'Refund'}
          onClose={() => setAsking(null)}
          onSubmit={(v) => void act(() => pPost(`/deposits/${d.id}/${asking}`, { reason: v.reason, ...(v.amount ? { amount: v.amount } : {}) }))}
        />
      ) : null}
    </Section>
  );
}

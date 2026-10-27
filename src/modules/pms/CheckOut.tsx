import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button, ErrorNote, Spinner, cx } from '../../components/ui';
import { toast } from '../../core/toasts';
import { Section } from '../../components/FormKit';
import { PageHead } from '../../components/PageKit';
import { codeOf, day, errorData, errorText, isZero, K, money, newKey, pGet, pPost, type CheckOutScreen } from './api';
import { FolioPanel } from './Folio';
import { Money, NoAccess, Refusal, usePms, VipPill } from './parts';
import { folioDocumentHtml, printPage, type FolioDocument } from './print';
import { Checkbox } from '../../components/Checkbox';

interface Result {
  stays: Array<{ stay_id: number; room_id: number; room_dirty: boolean; task_id: number | null; key: { ok: boolean; message: string } | null }>;
  invoices: Array<{ folio_id: number; kind: 'invoice' | 'receipt' | 'none'; number?: string | null; receipt_no?: string | null; queued?: boolean; message?: string | null }>;
  minibar: { posted: number; total: string | number; left: Array<{ id: number; room_id: number; reason: string }> };
  reservation_status: string;
}

/**
 * Check-out (PMS-CKO-001…003, AC-08): each room in house with its folios —
 * charges, the mini bar still to be charged, the deposit to apply, payments —
 * and what stands in the way. A folio with a balance blocks the check-out
 * unless a company's balance goes to its account with permission. The server
 * settles the folios, raises the invoices or receipts, sends the room to
 * housekeeping and revokes the key; one press is one check-out.
 */
export default function CheckOut({ id }: { id: number }) {
  const pms = usePms();
  const qc = useQueryClient();
  const allowed = pms.may('pms.checkout') && pms.may('pms.folio.view');
  const q = useQuery({ queryKey: K.checkout(id), queryFn: ({ signal }) => pGet<CheckOutScreen>(`/reservations/${id}/check-out`, undefined, signal), enabled: allowed });
  const s = q.data;
  const [picked, setRooms] = useState<Set<number> | null>(null);
  const [early, setEarly] = useState(false);
  const [late, setLate] = useState(false);
  const [applyDeposit, setApplyDeposit] = useState<boolean | null>(null);
  const [toAr, setToAr] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<{ text: string; folios: Array<{ folio_no: string; label: string; balance: string }> } | null>(null);
  const [done, setDone] = useState<Result | null>(null);
  const [key, setKey] = useState(() => newKey('checkout'));

  if (!allowed) return <NoAccess what="Check-out needs “Check guests out” and “See folios” — the folios are the check-out." />;
  if (q.isLoading) return <Spinner />;
  if (q.error || !s) return <div className="p-6"><ErrorNote error={q.error ?? new Error('The check-out could not be loaded.')} onRetry={() => void q.refetch()} /></div>;

  const rooms = picked ?? new Set(s.stays.map((x) => x.reservation_room_id));
  const chosen = s.stays.filter((x) => rooms.has(x.reservation_room_id));
  const anyEarly = chosen.some((x) => x.early);
  const deposit = applyDeposit ?? s.apply_deposit;
  const reload = () => {
    void q.refetch();
    void qc.invalidateQueries({ queryKey: K.live });
  };

  const go = async () => {
    setBusy(true);
    setRefusal(null);
    try {
      const r = await pPost<Result>(
        `/reservations/${id}/check-out`,
        {
          rooms: chosen.map((x) => x.reservation_room_id),
          ...(anyEarly || early ? { early: true } : {}),
          ...(late ? { late_checkout: true } : {}),
          apply_deposit: deposit,
          ...(toAr ? { transfer_ar: true } : {}),
        },
        key,
      );
      setKey(newKey('checkout'));
      setDone(r.data);
      toast('success', r.message);
      void qc.invalidateQueries({ queryKey: K.live });
      void qc.invalidateQueries({ queryKey: K.reservation(id) });
    } catch (e) {
      const code = codeOf(e);
      setRefusal({ text: errorText(e, 'The guest was not checked out.'), folios: code === 'balance' ? (errorData<{ folios?: Array<{ folio_no: string; label: string; balance: string }> }>(e)?.folios ?? []) : [] });
      if (code === 'early_departure') setEarly(true);
      setKey(newKey('checkout'));
      reload();
    } finally {
      setBusy(false);
    }
  };

  const print = async (folioId: number) => {
    try {
      const d = await pGet<FolioDocument>(`/folios/${folioId}/document`);
      await printPage({ title: `${d.kind} ${d.number ?? d.folio.folio_no}`, html: folioDocumentHtml(d), kind: d.kind });
    } catch (e) {
      toast('error', errorText(e, 'It could not be printed.'));
    }
  };

  if (done) {
    return (
      <div className="flex flex-col gap-4 px-6 py-5">
        <PageHead title={`${s.confirmation_no} checked out`} sub={`Reservation ${done.reservation_status.replace(/_/g, ' ')}`}>
          <Button onClick={() => pms.go('departures')}>Departures</Button>
          <Button onClick={() => pms.go('rack')}>Room rack</Button>
        </PageHead>
        <Section title="Invoices and receipts">
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-[13px]">
            {done.invoices.map((i) => (
              <li key={i.folio_id} className="flex items-center gap-2">
                <span className="min-w-0 flex-1">
                  {i.kind === 'invoice' ? `Invoice ${i.number ?? ''}` : i.kind === 'receipt' ? `Receipt ${i.receipt_no ?? ''}` : 'No document'}
                  {i.queued ? ' — being raised in Billing' : ''}
                  {i.message ? <span className="block text-[12px] text-ink-3">{i.message}</span> : null}
                </span>
                <Button size="sm" icon="printer" onClick={() => void print(i.folio_id)}>
                  Print
                </Button>
              </li>
            ))}
          </ul>
        </Section>
        <Section title="Rooms">
          <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[13px]">
            {done.stays.map((x) => (
              <li key={x.stay_id}>
                {s.stays.find((y) => y.id === x.stay_id)?.room_number ?? x.room_id}: {x.room_dirty ? 'dirty, handed to housekeeping' : 'left as it is'}
                {x.key ? ` · ${x.key.message}` : ''}
              </li>
            ))}
          </ul>
          {done.minibar.left.length ? (
            <p className="mt-2 mb-0 text-[12.5px] text-warning">
              Mini bar not charged: {done.minibar.left.map((l) => l.reason).join('; ')}
            </p>
          ) : null}
        </Section>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 px-6 py-5">
      <PageHead title={`Check out ${s.confirmation_no}`} sub={`Business date ${day(s.business_date, true)}`}>
        <Button variant="ghost" icon="back" onClick={() => pms.open({ kind: 'reservation', id })}>
          Reservation
        </Button>
      </PageHead>
      {s.stays.length === 0 ? <p className="text-[13px] text-ink-3">No room of this reservation is in house.</p> : null}
      {s.stays.map((x) => (
        <Section
          key={x.id}
          title={
            <span className="flex flex-wrap items-center gap-2">
              {s.stays.length > 1 ? (
                <Checkbox
                  aria-label={`Check out room ${x.room_number}`}
                  checked={rooms.has(x.reservation_room_id)}
                  onChange={(e) => {
                    const next = new Set(rooms);
                    if (e.target.checked) next.add(x.reservation_room_id);
                    else next.delete(x.reservation_room_id);
                    setRooms(next);
                  }}
                />
              ) : null}
              Room {x.room_number} · {x.guest_name} <VipPill level={x.vip_level} />
              <span className="text-[12px] font-normal text-ink-3">
                due out {day(x.departure_date)}
                {x.early ? ' — leaving early' : ''}
              </span>
            </span>
          }
          action={
            <span className="text-[13px]">
              Owes <Money amount={x.owed} currency={x.currency} className={cx('font-bold', !isZero(x.owed) && 'text-danger')} />
            </span>
          }
        >
          {x.blockers.map((b) => (
            <p key={b} className="mt-0 mb-2 text-[12.5px] text-warning">
              {b}
            </p>
          ))}
          {x.minibar_waiting.length ? (
            <p className="mt-0 mb-2 text-[12.5px] text-ink-2">
              Mini bar to be charged at check-out: {x.minibar_waiting.map((m) => `${m.product} × ${m.quantity} (${money(m.amount, m.currency)})`).join(', ')}
            </p>
          ) : null}
          <div className="flex flex-col gap-4">
            {x.folio_views.map((f) => (
              <FolioPanel key={f.id} id={f.id} others={x.folio_views} onChanged={reload} />
            ))}
          </div>
        </Section>
      ))}

      <Section title="Check-out">
        <div className="flex flex-col gap-2 text-[13px]">
          {s.deposit ? (
            <label className="flex items-center gap-2">
              <Checkbox checked={deposit} onChange={(e) => setApplyDeposit(e.target.checked)} /> Apply the deposit ({money(s.deposit.available, s.deposit.currency)} available)
            </label>
          ) : null}
          {s.late_checkout.offered ? (
            <label className="flex items-center gap-2">
              <Checkbox checked={late} onChange={(e) => setLate(e.target.checked)} /> Late check-out: charge {s.late_checkout.name} ({money(s.late_checkout.price, pms.property.currency)})
            </label>
          ) : null}
          {anyEarly || early ? (
            <label className="flex items-center gap-2">
              <Checkbox checked readOnly /> An early departure: the nights to come are given back
            </label>
          ) : null}
          {pms.may('pms.folio.adjust') ? (
            <label className="flex items-center gap-2">
              <Checkbox checked={toAr} onChange={(e) => setToAr(e.target.checked)} /> Move a company’s balance to its account (city ledger)
            </label>
          ) : null}
        </div>
        {refusal ? (
          <div className="mt-3">
            <Refusal text={refusal.text}>
              {refusal.folios.length ? (
                <ul className="m-0 list-none p-0 text-ink-2">
                  {refusal.folios.map((f) => (
                    <li key={f.folio_no}>
                      {f.folio_no} · {f.label}: {money(f.balance)}
                    </li>
                  ))}
                </ul>
              ) : null}
            </Refusal>
          </div>
        ) : null}
        <div className="mt-3 flex items-center gap-3">
          <Button variant="primary" size="lg" icon="logout" loading={busy} disabled={chosen.length === 0 || !pms.online} onClick={() => void go()}>
            Check out {chosen.length > 1 ? `${chosen.length} rooms` : `room ${chosen[0]?.room_number ?? ''}`}
          </Button>
          {!pms.online ? <span className="text-[12.5px] text-warning">Check-out waits for WorkSuite.</span> : null}
        </div>
      </Section>
    </div>
  );
}

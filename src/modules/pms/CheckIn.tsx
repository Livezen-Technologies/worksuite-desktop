import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Icon } from '../../components/Icon';
import { Button, ErrorNote, Modal, Spinner, cx } from '../../components/ui';
import { toast } from '../../core/toasts';
import { Field, input, Section } from '../garage/parts';
import { PageHead } from '../hr/parts';
import AssignRoom from './Assign';
import { codeOf, day, errorText, K, money, newKey, pGet, pPost, type CheckInScreen } from './api';
import { device, type IdScan } from './devices';
import { finishKeys } from './Keys';
import type { KeyAnswer } from './locks';
import { NoAccess, occupants, Refusal, usePms, VipPill } from './parts';
import { printCards } from './print';
import RegistrationCardDialog from './RegistrationCard';
import { useShortcut } from './shortcuts';
import { Checkbox } from '../../components/Checkbox';

interface Done {
  stays: Array<{ stay_id: number; reservation_room_id: number; room_id: number; room_number: string; folio_id: number | null; key: KeyAnswer }>;
  reservation_status: string;
}

/**
 * The quick check-in screen (PMS-CKI-001…005, AC-06): the guest, each room due
 * in with what stands in its way — a number, in service, empty, clean (or
 * inspected) — the ID and the guarantee, the early check-in offer, and one
 * button. A room that is not ready is refused unless someone who may override
 * gives a reason; an occupied room never. Several rooms check in together or
 * one by one. Then the keys (the server's door-lock provider, and this
 * desk's encoder when it has one) and the registration card.
 */
export default function CheckIn({ id }: { id: number }) {
  const pms = usePms();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: K.checkin(id), queryFn: ({ signal }) => pGet<CheckInScreen>(`/reservations/${id}/check-in`, undefined, signal), enabled: pms.may('pms.checkin') });
  const s = q.data;
  const [picked, setChosen] = useState<Set<number> | null>(null);
  const [idOk, setIdOk] = useState(false);
  const [guaranteeOk, setGuaranteeOk] = useState(false);
  const [early, setEarly] = useState(false);
  const [cashOnly, setCashOnly] = useState(false);
  const [keys, setKeys] = useState(1);
  const [overrideReason, setOverrideReason] = useState('');
  const [assign, setAssign] = useState<{ line: number; what: string; current: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<{ text: string; code: string | null } | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const [key, setKey] = useState(() => newKey('checkin'));
  const [scan, setScan] = useState<IdScan | null>(null);
  const [card, setCard] = useState<{ stay: number } | null>(null);
  const scanner = device('id_scanner');

  const chosen = picked ?? new Set((s?.rooms ?? []).filter((r) => r.due_today !== false).map((r) => r.reservation_room_id));
  const selected = s ? s.rooms.filter((r) => chosen.has(r.reservation_room_id)) : [];
  const needsOverride = selected.some((r) => r.needs_override && !r.readiness.ready);
  const blocked = selected.some((r) => !r.readiness.assigned && !pms.mayAny('pms.room.move', 'pms.reservation.edit')) || selected.some((r) => r.readiness.assigned && (!r.readiness.vacant || !r.readiness.in_service));
  const canPress = !!s && selected.length > 0 && !blocked && (!needsOverride || (s.can_override && overrideReason.trim() !== '')) && pms.online;

  const go = async () => {
    if (!s || !canPress) return;
    setBusy(true);
    setRefusal(null);
    try {
      const r = await pPost<Done>(
        `/reservations/${id}/check-in`,
        {
          rooms: selected.map((x) => x.reservation_room_id),
          version: s.version,
          ...(idOk ? { id_verified: true } : {}),
          ...(guaranteeOk ? { guarantee_verified: true } : {}),
          ...(early && s.early_checkin.offered ? { early_checkin: true } : {}),
          ...(cashOnly ? { posting_allowed: false } : {}),
          ...(needsOverride ? { override_reason: overrideReason.trim() } : {}),
          keys,
        },
        key,
      );
      setKey(newKey('checkin'));
      setDone(r.data);
      toast('success', r.message);
      void qc.invalidateQueries({ queryKey: K.live });
      void qc.invalidateQueries({ queryKey: K.reservation(id) });
      // The keys the property's lock system answered: an on-premise vendor's cards are encoded here, room by room.
      void finishKeys(pms.property.id, r.data.stays.map((st) => ({ room: st.room_number, key: st.key })));
    } catch (e) {
      const code = codeOf(e);
      setRefusal({ text: errorText(e, 'The guest was not checked in.'), code });
      setKey(newKey('checkin'));
      if (code === 'version_conflict') void q.refetch();
    } finally {
      setBusy(false);
    }
  };

  useShortcut('checkin', () => {
    if (!canPress || busy || done) return false;
    void go();
    return true;
  });

  if (!pms.may('pms.checkin')) return <NoAccess what="Checking guests in needs “Check guests in”." />;
  if (q.isLoading) return <Spinner />;
  if (q.error || !s) return <div className="p-6"><ErrorNote error={q.error ?? new Error('The check-in could not be loaded.')} onRetry={() => void q.refetch()} /></div>;

  if (done) {
    return (
      <div className="flex flex-col gap-4 px-6 py-5">
        <PageHead title={`${s.guest_name ?? ''} is checked in`} sub={`${s.confirmation_no} · ${done.reservation_status.replace(/_/g, ' ')}`}>
          <Button icon="printer" onClick={() => void printCards(done.stays.map((x) => x.stay_id)).catch((e) => toast('error', errorText(e)))}>
            Print registration card{done.stays.length > 1 ? 's' : ''}
          </Button>
        </PageHead>
        <Section title="Rooms and keys">
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {done.stays.map((x) => (
              <li key={x.stay_id} className="flex flex-wrap items-center gap-3 rounded-[10px] border border-line px-3 py-2 text-[13px]">
                <b className="w-14 text-[16px] tabular-nums">{x.room_number}</b>
                <span className={cx('flex min-w-0 flex-1 items-center gap-1.5', x.key.ok ? 'text-ink-2' : 'text-danger')}>
                  <Icon name="key" size={14} /> {x.key.message || x.key.status}
                </span>
                <Button size="sm" icon="pen" onClick={() => setCard({ stay: x.stay_id })}>
                  Sign the card
                </Button>
                <Button size="sm" variant="primary" onClick={() => pms.open({ kind: 'stay', id: x.stay_id, folio: null })}>
                  Stay & folio
                </Button>
              </li>
            ))}
          </ul>
        </Section>
        {card ? <RegistrationCardDialog stayId={card.stay} guestId={s.guest_id} reservationId={id} onClose={() => setCard(null)} /> : null}
      </div>
    );
  }

  const flags = s.preferences.filter((p) => p.is_flag);
  return (
    <div className="flex flex-col gap-4 px-6 py-5">
      <PageHead
        title={
          <span className="flex items-center gap-2">
            Check in {s.guest_name} <VipPill level={s.vip_level} />
          </span>
        }
        sub={`${s.confirmation_no} · ${s.status_label} · business date ${day(s.business_date, true)}${s.eta ? ` · ETA ${s.eta}` : ''}`}
      >
        <Button variant="ghost" icon="back" onClick={() => pms.open({ kind: 'reservation', id })}>
          Reservation
        </Button>
      </PageHead>
      {flags.length || s.special_requests ? (
        <div className="rounded-[10px] bg-warning-bg px-3 py-2 text-[12.5px] text-warning">
          {[...flags.map((p) => p.preference), s.special_requests].filter(Boolean).join(' · ')}
        </div>
      ) : null}

      <Section title="Rooms">
        {s.rooms.length === 0 ? (
          <p className="m-0 text-[13px] text-ink-3">No room of this reservation is due in.</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {s.rooms.map((r) => {
              const on = chosen.has(r.reservation_room_id);
              return (
                <li key={r.reservation_room_id} className={cx('flex flex-wrap items-start gap-3 rounded-[10px] border px-3 py-2', on ? 'border-primary/50' : 'border-line')}>
                  <Checkbox
                    aria-label={`Check in ${r.room_type ?? 'room'} ${r.line_no}`} className="mt-1"
                    checked={on}
                    disabled={r.due_today === false}
                    onChange={(e) => {
                      const next = new Set(chosen);
                      if (e.target.checked) next.add(r.reservation_room_id);
                      else next.delete(r.reservation_room_id);
                      setChosen(next);
                    }}
                  />
                  <div className="min-w-0 flex-1 text-[13px]">
                    <div className="flex flex-wrap items-center gap-2">
                      <b>{r.room_number ? `Room ${r.room_number}` : 'No room yet'}</b>
                      <span className="text-ink-2">{r.room_type}</span>
                      <span className="text-ink-3">
                        {day(r.arrival_date)} → {day(r.departure_date)} · {occupants(r.adults, r.children)}
                      </span>
                      {pms.mayAny('pms.room.move', 'pms.reservation.edit') ? (
                        <button type="button" className="text-[12px] font-semibold text-primary" onClick={() => setAssign({ line: r.reservation_room_id, what: `${s.guest_name ?? s.confirmation_no} (${r.room_type ?? 'room'})`, current: r.room_number })}>
                          {r.room_number ? 'Change room' : 'Choose a room'}
                        </button>
                      ) : null}
                    </div>
                    {r.readiness.ready ? (
                      <span className="flex items-center gap-1 text-success">
                        <Icon name="check-circle" size={13} /> Ready
                      </span>
                    ) : (
                      <span className="text-warning">{r.readiness.blockers.join(' ')}</span>
                    )}
                    {r.due_today === false ? <span className="block text-ink-3">Not due today.</span> : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <Section title="Checks">
        <div className="flex flex-col gap-2 text-[13px]">
          <label className="flex items-center gap-2">
            <Checkbox checked={idOk || s.id_verified} disabled={s.id_verified} onChange={(e) => setIdOk(e.target.checked)} />
            {s.id_verified ? 'The guest’s identification is verified on file.' : `The guest’s ID has been checked${s.id_required ? ' (required here)' : ''}`}
            {scanner.available() && !s.id_verified ? (
              <Button
                size="sm"
                icon="scan"
                onClick={() =>
                  void scanner
                    .scan()
                    .then((x) => x && setScan(x))
                    .catch((e) => toast('error', errorText(e)))
                }
              >
                Scan the ID
              </Button>
            ) : null}
          </label>
          <label className="flex items-center gap-2">
            <Checkbox checked={guaranteeOk} onChange={(e) => setGuaranteeOk(e.target.checked)} />
            Guarantee checked ({s.guarantee_type === 'none' ? 'none on the booking' : s.guarantee_type}
            {s.deposit ? `; deposit ${s.deposit.status}, ${money(s.deposit.paid, pms.property.currency)} of ${money(s.deposit.required, pms.property.currency)}` : ''})
          </label>
          {s.early_checkin.offered ? (
            <label className="flex items-center gap-2">
              <Checkbox checked={early} onChange={(e) => setEarly(e.target.checked)} />
              Early check-in before {s.early_checkin.check_in_time}: charge {s.early_checkin.name} ({money(s.early_checkin.price, pms.property.currency)})
            </label>
          ) : null}
          <label className="flex items-center gap-2">
            <Checkbox checked={cashOnly} onChange={(e) => setCashOnly(e.target.checked)} />
            Cash only — no charges to the room from the outlets
          </label>
          <label className="flex items-center gap-2">
            Keys per room
            <input aria-label="Keys per room" type="number" min={1} max={6} className={cx(input, 'w-20')} value={keys} onChange={(e) => setKeys(Math.max(1, Math.min(6, Number(e.target.value) || 1)))} />
          </label>
        </div>
        {needsOverride ? (
          s.can_override ? (
            <div className="mt-3">
              <Field label="The room is not ready — check in anyway because *" hint="Kept on the stay with your name, and in the audit log.">
                <input aria-label="Override reason" className={input} value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} />
              </Field>
            </div>
          ) : (
            <p className="mt-3 mb-0 text-[12.5px] text-warning">A room that is not ready can be checked in only by someone who may override it, with a reason. Choose a ready room, or ask them.</p>
          )
        ) : null}
      </Section>

      {refusal ? (
        <Refusal text={refusal.text}>
          {refusal.code === 'room_not_ready' && s.can_override ? <span className="text-ink-2">Give the reason above to check in anyway.</span> : null}
          {refusal.code === 'id_required' ? <span className="text-ink-2">Tick that the guest’s ID has been checked.</span> : null}
        </Refusal>
      ) : null}

      <div className="flex items-center gap-3">
        <Button variant="primary" size="lg" icon="log-in" loading={busy} disabled={!canPress} title="Alt+I" onClick={() => void go()}>
          Check in {selected.length > 1 ? `${selected.length} rooms` : ''}
        </Button>
        {!pms.online ? <span className="text-[12.5px] text-warning">Check-in waits for WorkSuite.</span> : null}
      </div>

      {assign ? (
        <AssignRoom
          lineId={assign.line}
          version={s.version}
          what={assign.what}
          current={assign.current}
          onClose={() => setAssign(null)}
          onDone={() => {
            setAssign(null);
            void q.refetch();
          }}
        />
      ) : null}
      {scan ? <ScanConfirm guestId={s.guest_id} scan={scan} onClose={() => setScan(null)} onSaved={() => (setScan(null), setIdOk(true))} /> : null}
    </div>
  );
}

/** What the ID scanner read, for staff to check before anything is saved (PMS-IDS-002). */
function ScanConfirm({ guestId, scan, onClose, onSaved }: { guestId: number; scan: IdScan; onClose: () => void; onSaved: () => void }) {
  const pms = usePms();
  const [v, setV] = useState<IdScan>(scan);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const may = pms.may('pms.guest.sensitive_data') && pms.may('pms.guest.edit');
  const save = async () => {
    setBusy(true);
    try {
      const r = await pPost(`/guests/${guestId}/identity`, { id_type: v.id_type, id_number: v.id_number, id_country: v.id_country, id_expires_on: v.id_expires_on, date_of_birth: v.date_of_birth, verified: true });
      toast('success', r.message);
      onSaved();
    } catch (e) {
      setError(errorText(e, 'The identification was not saved.'));
    } finally {
      setBusy(false);
    }
  };
  const field = (k: keyof IdScan, label: string) => (
    <Field key={k} label={label}>
      <input aria-label={label} className={input} value={v[k] ?? ''} onChange={(e) => setV({ ...v, [k]: e.target.value || null })} />
    </Field>
  );
  return (
    <Modal
      title="Check what the scanner read"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Discard
          </Button>
          {may ? (
            <Button variant="primary" loading={busy} onClick={() => void save()}>
              Correct — save to the guest
            </Button>
          ) : (
            <Button variant="primary" onClick={onSaved}>
              Correct — tick ID checked
            </Button>
          )}
        </>
      }
    >
      <div className="grid grid-cols-2 gap-2">
        {field('first_name', 'First name')}
        {field('last_name', 'Last name')}
        {field('id_type', 'Document')}
        {field('id_number', 'Number')}
        {field('id_country', 'Issued by')}
        {field('id_expires_on', 'Expires')}
        {field('date_of_birth', 'Date of birth')}
        {field('nationality', 'Nationality')}
      </div>
      {!may ? <p className="mt-2 mb-0 text-[12.5px] text-ink-3">Saving identification needs “See guests’ identification”: nothing read here is kept.</p> : null}
      {error ? <div className="mt-2"><Refusal text={error} /></div> : null}
    </Modal>
  );
}

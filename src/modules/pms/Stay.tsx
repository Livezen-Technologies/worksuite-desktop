import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Select } from '../../components/Select';
import { Button, ErrorNote, Modal, Spinner } from '../../components/ui';
import { toast } from '../../core/toasts';
import { Ask, Field, input, Section, Tabs } from '../garage/parts';
import { PageHead } from '../hr/parts';
import { codeOf, day, errorText, K, money, pDelete, pGet, pPost, plusDays, type Candidate, type Stay } from './api';
import { ChargeDialog, FolioPanel } from './Folio';
import { finishKeys, KeyPanel } from './Keys';
import type { KeyAnswer } from './locks';
import { Facts, NoAccess, occupants, Refusal, usePms, VipPill } from './parts';
import RegistrationCardDialog from './RegistrationCard';
import type { StayAct } from './routes';
import { useShortcut } from './shortcuts';
import { Checkbox } from '../../components/Checkbox';

const CHARGE_TYPES = ['room', 'fnb', 'minibar', 'laundry', 'spa', 'transport', 'telephone', 'banquet', 'package', 'fee', 'other'];
const CHARGE_LABEL: Record<string, string> = { room: 'Room', fnb: 'Food & beverage', minibar: 'Mini bar', laundry: 'Laundry', spa: 'Spa', transport: 'Transport', telephone: 'Telephone', banquet: 'Banquet', package: 'Package', fee: 'Fees', other: 'Other' };

type Dialog = 'move' | 'extend' | 'charge' | 'keys' | 'limits' | 'card' | 'folio' | 'route' | null;

/**
 * A guest in house (§8): the stay — room, dates, key, what the room may be
 * charged — and its folios. From here the desk moves the guest (PMS-MOV-001),
 * extends or shortens the stay, asks the lock system for keys, posts charges,
 * splits the folio and routes charges between folios (PMS-FOL-003/004), keeps
 * the signed registration card, and goes to check-out.
 */
export default function StayScreen({ id, folio, act }: { id: number; folio: number | null; act?: StayAct | null }) {
  const pms = usePms();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: K.stay(id), queryFn: ({ signal }) => pGet<{ stay: Stay }>(`/stays/${id}`, undefined, signal) });
  const s = q.data?.stay;
  const [dialog, setDialog] = useState<Dialog>(act ?? null);
  const [picked, setPicked] = useState<number | null>(folio);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (s) pms.adopt(s.property_id);
  }, [s, pms]);

  useShortcut('charge', () => {
    if (!s || s.status !== 'in_house' || !pms.may('pms.folio.post') || !pms.online) return false;
    setDialog('charge');
    return true;
  });

  const reload = () => {
    void qc.invalidateQueries({ queryKey: K.stay(id) });
    void qc.invalidateQueries({ queryKey: K.live });
    void qc.invalidateQueries({ queryKey: ['pms', 'folio'] });
  };
  const run = async (fn: () => Promise<{ message: string }>, fallback: string) => {
    setBusy(true);
    setError(null);
    try {
      const r = await fn();
      toast('success', r.message);
      setDialog(null);
      reload();
    } catch (e) {
      setError(errorText(e, fallback));
      setDialog(null);
    } finally {
      setBusy(false);
    }
  };

  if (!pms.may('pms.reservation.view') && !pms.mayAny('pms.checkin', 'pms.checkout')) return <NoAccess what="A stay is shown to the front desk." />;
  if (q.isLoading) return <Spinner />;
  if (q.error || !s) {
    return (
      <div className="flex flex-col gap-3 p-6">
        <Button icon="back" className="self-start" onClick={pms.back}>
          Back
        </Button>
        <ErrorNote error={q.error ?? new Error('The stay could not be loaded.')} onRetry={() => void q.refetch()} />
      </div>
    );
  }

  const inHouse = s.status === 'in_house';
  const on = pms.online;
  const folios = s.folios ?? [];
  const current = folios.find((f) => f.id === picked) ?? folios[0] ?? null;

  return (
    <div className="flex flex-col gap-4 px-6 py-5">
      <PageHead
        title={
          <span className="flex flex-wrap items-center gap-2">
            Room {s.room_number} · {s.guest_name} <VipPill level={s.vip_level} />
          </span>
        }
        sub={`${s.room_type ?? ''} · ${day(s.arrival_date, true)} → ${day(s.departure_date, true)} · ${s.nights} ${s.nights === 1 ? 'night' : 'nights'} · ${occupants(s.adults, s.children)} · ${s.status_label}`}
      >
        <Button variant="ghost" icon="back" onClick={pms.back}>
          Back
        </Button>
        <Button variant="ghost" icon="app-window" onClick={() => pms.openWindow({ kind: 'stay', id, folio: null }, `Room ${s.room_number} · ${s.guest_name ?? ''}`)}>
          Window
        </Button>
        <Button onClick={() => pms.open({ kind: 'reservation', id: s.reservation_id })}>{s.confirmation_no}</Button>
        {inHouse && pms.may('pms.checkout') && pms.may('pms.folio.view') ? (
          <Button variant="primary" icon="logout" disabled={!on} onClick={() => pms.open({ kind: 'checkout', id: s.reservation_id })}>
            Check out
          </Button>
        ) : null}
      </PageHead>

      {inHouse ? (
        <div className="flex flex-wrap gap-1.5">
          {pms.may('pms.folio.post') ? (
            <Button size="sm" icon="plus" disabled={!on} title="Alt+P" onClick={() => setDialog('charge')}>
              Post charge
            </Button>
          ) : null}
          {pms.may('pms.room.move') ? (
            <Button size="sm" icon="bed" disabled={!on} onClick={() => setDialog('move')}>
              Move room
            </Button>
          ) : null}
          {pms.mayAny('pms.reservation.edit', 'pms.checkin') ? (
            <Button size="sm" icon="calendar" disabled={!on} onClick={() => setDialog('extend')}>
              Extend or shorten
            </Button>
          ) : null}
          {pms.mayAny('pms.keys.issue', 'pms.checkin') ? (
            <Button size="sm" icon="key" disabled={!on} onClick={() => setDialog('keys')}>
              Keys
            </Button>
          ) : null}
          {pms.may('pms.checkin') ? (
            <Button size="sm" icon="pen" disabled={!on} onClick={() => setDialog('card')}>
              Registration card
            </Button>
          ) : null}
          {pms.may('pms.folio.adjust') ? (
            <Button size="sm" icon="sliders" disabled={!on} onClick={() => setDialog('limits')}>
              Charges to the room
            </Button>
          ) : null}
        </div>
      ) : null}
      {error ? <Refusal text={error} /> : null}

      <div className="grid gap-4 lg:grid-cols-[1fr_1.1fr]">
        <Section title="The stay">
          <Facts
            rows={[
              ['Checked in', s.checked_in_at ? `${day(s.checked_in_at.slice(0, 10))} by ${s.checked_in_by ?? '—'}` : '—'],
              ['Key', s.key_status_label ?? '—'],
              ['ID verified', s.id_verified ? 'Yes' : 'No'],
              ['Registration card', s.registration_card_file_id ? 'Signed card kept' : 'Not signed yet'],
              ['Charges to the room', s.posting_allowed ? 'Allowed' : 'Cash only'],
              ['Credit limit', s.credit_limit !== null ? money(s.credit_limit, s.currency) : 'The property’s'],
              ...(s.credit_left !== null ? ([['Credit left', money(s.credit_left, s.currency)]] as Array<[string, string]>) : []),
              ...(s.override_reason ? ([['Checked in not ready', `${s.override_reason} (${s.override_by ?? ''})`]] as Array<[string, string]>) : []),
            ]}
          />
          {s.moves.length ? (
            <ul className="mt-3 mb-0 list-none p-0 text-[12px] text-ink-3">
              {s.moves.map((m, i) => (
                <li key={i}>
                  {m.business_date ? day(m.business_date) : ''} · {m.move_type}
                  {m.reason ? ` · ${m.reason}` : ''}
                </li>
              ))}
            </ul>
          ) : null}
        </Section>
        <Section
          title="Routing"
          action={
            inHouse && pms.may('pms.folio.adjust') && folios.length > 1 ? (
              <Button size="sm" disabled={!on} onClick={() => setDialog('route')}>
                Route charges
              </Button>
            ) : null
          }
        >
          {s.routing === null ? (
            <p className="m-0 text-[12.5px] text-ink-3">Folios and routing are shown to people who may see folios.</p>
          ) : s.routing.length === 0 ? (
            <p className="m-0 text-[12.5px] text-ink-3">Every charge goes to the guest’s folio.</p>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[12.5px]">
              {s.routing.map((r) => (
                <li key={r.id} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1">
                    {r.charge_types.map((c) => CHARGE_LABEL[c] ?? c).join(', ') || 'Chosen charges'} → {folios.find((f) => f.id === r.target_folio_id)?.label ?? `folio #${r.target_folio_id}`}
                    {r.whole_reservation ? ' (whole reservation)' : ''}
                  </span>
                  {pms.may('pms.folio.adjust') ? (
                    <button type="button" className="text-[11.5px] font-semibold text-danger disabled:opacity-40" disabled={!on || busy} onClick={() => void run(() => pDelete(`/routing-rules/${r.id}`), 'The rule was not removed.')}>
                      Remove
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      {s.folios === null ? (
        <p className="text-[13px] text-ink-3">The folios are shown to people who may see them.</p>
      ) : (
        <Section
          title="Folios"
          action={
            inHouse && pms.may('pms.folio.adjust') ? (
              <Button size="sm" icon="plus" disabled={!on} onClick={() => setDialog('folio')}>
                Split: new folio
              </Button>
            ) : null
          }
        >
          {folios.length > 1 ? <Tabs label="Folios" tabs={folios.map((f) => ({ id: String(f.id), label: `${f.label} · ${money(f.balance, f.currency)}` }))} value={String(current?.id ?? '')} onChange={(v) => setPicked(Number(v))} /> : null}
          <div className="mt-3">{current ? <FolioPanel key={current.id} id={current.id} others={folios} onChanged={reload} /> : <p className="m-0 text-[13px] text-ink-3">No folio.</p>}</div>
        </Section>
      )}

      {dialog === 'charge' ? <ChargeDialog target={{ stay: id }} currency={s.currency} onClose={() => setDialog(null)} onDone={() => (setDialog(null), reload())} /> : null}
      {dialog === 'move' ? <MoveDialog stay={s} onClose={() => setDialog(null)} onDone={() => (setDialog(null), reload())} /> : null}
      {dialog === 'extend' ? (
        <Ask
          title="Extend or shorten the stay"
          text="Extra nights are priced at today’s rates on the stay’s plan and taken from what is free; nights given back are the ones from the new departure on — never a night already charged."
          fields={[
            { name: 'departure_date', label: 'Leaves on', type: 'date', initial: s.departure_date, required: true },
            { name: 'reason', label: 'Reason' },
          ]}
          confirm="Change the departure"
          busy={busy}
          onClose={() => setDialog(null)}
          onSubmit={(v) => void run(() => pPost(`/stays/${id}/departure`, { departure_date: v.departure_date, ...(v.reason ? { reason: v.reason } : {}) }), 'The departure was not changed.')}
        />
      ) : null}
      {dialog === 'keys' ? (
        <Modal
          title={`Keys for room ${s.room_number}`}
          onClose={() => setDialog(null)}
          width={440}
          footer={
            <Button variant="ghost" onClick={() => setDialog(null)}>
              Close
            </Button>
          }
        >
          <KeyPanel stay={s} onChanged={reload} />
        </Modal>
      ) : null}
      {dialog === 'limits' ? (
        <Ask
          title="Charges to the room"
          text="Whether the outlets may charge to this room, and how much this stay may run up (blank: the property’s limit)."
          fields={[
            { name: 'posting_allowed', label: 'Outlets may charge to the room', type: 'select', options: [{ value: '1', label: 'Yes' }, { value: '0', label: 'No — cash only' }], initial: s.posting_allowed ? '1' : '0' },
            { name: 'credit_limit', label: 'Credit limit', initial: s.credit_limit ?? '' },
          ]}
          busy={busy}
          onClose={() => setDialog(null)}
          onSubmit={(v) => void run(() => pPost(`/stays/${id}`, { posting_allowed: v.posting_allowed === '1', credit_limit: (v.credit_limit ?? '').trim() === '' ? null : v.credit_limit, version: s.version }), 'Nothing was changed.')}
        />
      ) : null}
      {dialog === 'card' ? <RegistrationCardDialog stayId={id} guestId={s.guest_id} reservationId={s.reservation_id} onClose={() => setDialog(null)} /> : null}
      {dialog === 'folio' ? (
        <Ask
          title="Another folio for this stay"
          text="Split the bill: a company’s folio for the room, the guest’s for extras, a second guest folio."
          fields={[
            { name: 'label', label: 'Label', placeholder: 'Guest folio 2' },
            { name: 'payee_type', label: 'Who pays it', type: 'select', options: [{ value: 'guest', label: 'The guest' }, { value: 'company', label: 'A company' }, { value: 'agent', label: 'A travel agent' }] },
            { name: 'payee_client_id', label: 'The company’s CRM number', hint: 'For a company or agent: their CRM client id.' },
          ]}
          confirm="Open folio"
          busy={busy}
          onClose={() => setDialog(null)}
          onSubmit={(v) => void run(() => pPost(`/stays/${id}/folios`, { payee_type: v.payee_type, ...(v.label ? { label: v.label } : {}), ...(v.payee_client_id ? { payee_client_id: Number(v.payee_client_id) } : {}) }), 'The folio was not opened.')}
        />
      ) : null}
      {dialog === 'route' ? <RouteDialog stay={s} busy={busy} onClose={() => setDialog(null)} onSave={(body) => void run(() => pPost(`/stays/${id}/routing`, body), 'The routing was not saved.')} /> : null}
    </div>
  );
}

/**
 * Moving a guest in house (PMS-MOV-001/002): the rooms free for the rest of
 * the stay, best first; another type is a complimentary or a paid upgrade; a
 * room not ready needs the override and its reason. The old room goes dirty
 * and to housekeeping; the folio stays the stay's; the key moves.
 */
function MoveDialog({ stay, onClose, onDone }: { stay: Stay; onClose: () => void; onDone: () => void }) {
  const pms = usePms();
  const q = useQuery({ queryKey: K.candidates(stay.reservation_room_id, true), queryFn: ({ signal }) => pGet<{ items: Candidate[] }>(`/reservation-rooms/${stay.reservation_room_id}/rooms`, { any_type: 1 }, signal) });
  const [pick, setPick] = useState<Candidate | null>(null);
  const [reason, setReason] = useState('');
  const [upgrade, setUpgrade] = useState<'complimentary' | 'paid'>('complimentary');
  const [override, setOverride] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; code: string | null } | null>(null);
  const items = (q.data?.items ?? []).filter((c) => c.room_id !== stay.room_id);
  const notReady = pick && !pick.ready;
  const valid = !!pick && reason.trim() !== '' && (!notReady || override.trim() !== '');

  const move = async () => {
    if (!pick) return;
    setBusy(true);
    setError(null);
    try {
      const r = await pPost<{ price_before: string; price_after: string; old_room: { number: string }; key?: KeyAnswer; old_key?: KeyAnswer }>(`/stays/${stay.id}/move`, {
        room_id: pick.room_id,
        reason: reason.trim(),
        ...(pick.upgrade ? { upgrade_type: upgrade } : {}),
        ...(notReady ? { override_reason: override.trim() } : {}),
      });
      toast('success', `${r.message}${r.data.price_before !== r.data.price_after ? ` The price went from ${money(r.data.price_before, stay.currency)} to ${money(r.data.price_after, stay.currency)}.` : ''}`);
      // The key moves with the guest: the old room's cancelled, the new room's made, on this desk's encoder when it has one.
      await finishKeys(stay.property_id, [
        { room: r.data.old_room.number, key: r.data.old_key },
        { room: pick.number, key: r.data.key },
      ]);
      onDone();
    } catch (e) {
      setError({ text: errorText(e, 'The guest was not moved.'), code: codeOf(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`Move ${stay.guest_name ?? 'the guest'} from room ${stay.room_number}`}
      onClose={onClose}
      width={600}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} disabled={!valid} onClick={() => void move()}>
            {pick ? `Move to ${pick.number}` : 'Move'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {q.isLoading ? (
          <Spinner />
        ) : q.error ? (
          <ErrorNote error={q.error} />
        ) : items.length === 0 ? (
          <p className="text-[13px] text-ink-3">No other room is free for the rest of this stay.</p>
        ) : (
          <Select
            aria-label="Room"
            value={pick ? String(pick.room_id) : ''}
            onChange={(e) => setPick(items.find((c) => String(c.room_id) === e.target.value) ?? null)}
            options={[{ value: '', label: 'Choose a room…' }, ...items.map((c) => ({ value: String(c.room_id), label: `${c.number} · ${c.room_type ?? ''}${c.upgrade ? ' (another type)' : ''} · ${c.ready ? 'ready' : c.hk_status}` }))]}
            className={input}
          />
        )}
        {pick?.warnings.length ? <p className="m-0 text-[12px] text-warning">{pick.warnings.join(' ')}</p> : null}
        <Field label="Why *">
          <input aria-label="Why" className={input} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Air conditioning fault" />
        </Field>
        {pick?.upgrade ? (
          <Field label="The price">
            <Select
              aria-label="The price"
              value={upgrade}
              onChange={(e) => setUpgrade(e.target.value as 'complimentary' | 'paid')}
              options={[
                { value: 'complimentary', label: 'Stays as booked (complimentary)' },
                { value: 'paid', label: 'The rest of the stay at the new type (paid)' },
              ]}
              className={input}
            />
          </Field>
        ) : null}
        {notReady ? (
          pms.may('pms.checkin.override') ? (
            <Field label="The room is not ready — move anyway because *">
              <input aria-label="Override reason" className={input} value={override} onChange={(e) => setOverride(e.target.value)} />
            </Field>
          ) : (
            <p className="m-0 text-[12.5px] text-warning">That room is not ready; moving into it needs someone who may override.</p>
          )
        ) : null}
        {error ? <Refusal text={error.text} /> : null}
      </div>
    </Modal>
  );
}

/** Routing instructions (PMS-FOL-004): these kinds of charge go to that folio. A tax follows its charge. */
function RouteDialog({ stay, busy, onClose, onSave }: { stay: Stay; busy: boolean; onClose: () => void; onSave: (body: Record<string, unknown>) => void }) {
  const folios = (stay.folios ?? []).filter((f) => f.status === 'open');
  const [target, setTarget] = useState(String(folios[1]?.id ?? folios[0]?.id ?? ''));
  const [types, setTypes] = useState<Set<string>>(new Set(['room']));
  const [whole, setWhole] = useState(false);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  return (
    <Modal
      title="Route charges to a folio"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} disabled={!target || types.size === 0} onClick={() => onSave({ target_folio_id: Number(target), charge_types: [...types], ...(whole ? { whole_reservation: true } : {}), ...(from ? { valid_from: from } : {}), ...(to ? { valid_to: to } : {}) })}>
            Save routing
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="To folio">
          <Select aria-label="To folio" value={target} onChange={(e) => setTarget(e.target.value)} options={folios.map((f) => ({ value: String(f.id), label: `${f.folio_no} · ${f.label}` }))} className={input} />
        </Field>
        <fieldset className="m-0 grid grid-cols-2 gap-1 border-0 p-0 text-[13px]">
          <legend className="mb-1 text-[12.5px] font-semibold text-ink-2">Charges</legend>
          {CHARGE_TYPES.map((c) => (
            <label key={c} className="flex items-center gap-2">
              <Checkbox
                checked={types.has(c)}
                onChange={(e) => {
                  const next = new Set(types);
                  if (e.target.checked) next.add(c);
                  else next.delete(c);
                  setTypes(next);
                }}
              />
              {CHARGE_LABEL[c]}
            </label>
          ))}
        </fieldset>
        <div className="grid grid-cols-2 gap-3">
          <Field label="From">
            <input aria-label="From" type="date" className={input} min={stay.arrival_date} value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="Until">
            <input aria-label="Until" type="date" className={input} max={plusDays(stay.departure_date, 0)} value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-[13px]">
          <Checkbox checked={whole} onChange={(e) => setWhole(e.target.checked)} /> For every room of the reservation
        </label>
      </div>
    </Modal>
  );
}

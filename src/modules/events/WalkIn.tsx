import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Button, Modal, Spinner, cx } from '../../components/ui';
import { toast } from '../../core/toasts';
import { ApiError } from '../../core/api';
import { scanId, type BadgeJob, type DeskScanOutcome, type ScanView } from '@shared/event-desk';
import { eGet, ePost, errorText, fieldErrors, K, money, newKey, nice, type FormField, type TicketType } from './api';
import { printQueued } from './badge';
import { DK, deskWalkIn, useDeskStatus } from './desk';
import { Refusal, useEvent } from './parts';

/**
 * "+ Walk-In" (EV-CHK-040..042, §9.5): the person's name, a phone or an
 * email, the ticket, their own consents and — for a paid ticket — the
 * payment, then one press: registered (source WALK_IN), checked in here and
 * the badge printed. Capacity, approval, payment and the form's rules are the
 * server's (`POST events/{id}/walk-ins`, one idempotency key per attempt).
 *
 * With WorkSuite out of reach, a walk-in can be let in on the desk's own
 * word (EV-OFF-006): kept with a provisional number and registered when the
 * queue goes up; one the server cannot confirm (full, a paid ticket, answers
 * missing) goes to the review queue.
 */

const STANDARD: FormField[] = [
  { key: 'first_name', type: 'TEXT', label: 'First name', required: true },
  { key: 'last_name', type: 'TEXT', label: 'Last name' },
  { key: 'phone', type: 'PHONE', label: 'Phone' },
  { key: 'email', type: 'EMAIL', label: 'Email' },
  { key: 'company', type: 'TEXT', label: 'Company' },
];

type Answers = Record<string, string | boolean | string[]>;

/** Whether a field shows for this ticket and these answers (the form's own condition — which fields to ask, never whether they are right). */
export function fieldShows(f: FormField, ticketId: number | null, answers: Answers): boolean {
  if (f.ticket_type_ids?.length && (ticketId === null || !f.ticket_type_ids.includes(ticketId))) return false;
  const c = f.condition;
  if (!c) return true;
  const v = answers[c.field];
  switch (c.op) {
    case 'equals':
      return String(v ?? '') === String(c.value ?? '');
    case 'not_equals':
      return String(v ?? '') !== String(c.value ?? '');
    case 'in':
      return Array.isArray(c.value) && c.value.map(String).includes(String(v ?? ''));
    case 'checked':
      return v === true;
    case 'filled':
      return Array.isArray(v) ? v.length > 0 : v !== undefined && v !== '' && v !== false;
    default:
      return true;
  }
}

const optionsOf = (f: FormField) => (f.options ?? []).map((o) => (typeof o === 'string' ? { value: o, label: o } : o));

export default function WalkIn({ deviceId, gateId, onClose, onDone }: { deviceId: number; gateId: number | null; onClose: () => void; onDone: (outcome: DeskScanOutcome | null) => void }) {
  const { event, online, may } = useEvent();
  const qc = useQueryClient();
  const status = useDeskStatus(event.id);
  const [offline, setOffline] = useState(!online);
  const tickets = useQuery({ queryKey: [...K.event(event.id), 'tickets'], queryFn: ({ signal }) => eGet<TicketType[]>(`/events/${event.id}/ticket-types`, undefined, signal), enabled: !offline });
  const form = useQuery({
    queryKey: [...K.event(event.id), 'form'],
    queryFn: ({ signal }) => eGet<{ published: { fields: FormField[] } | null }>(`/events/${event.id}/form`, undefined, signal),
    enabled: !offline,
    retry: false,
  });
  const live = useQuery({ queryKey: ['events', 'options-live'], queryFn: ({ signal }) => eGet<{ payment_methods: string[] }>('/options/live', undefined, signal), enabled: !offline, staleTime: 300_000 });

  const offered = useMemo(() => (tickets.data ?? []).filter((t) => t.active && t.kind === 'ATTENDEE'), [tickets.data]);
  const offlineTickets = status.data?.copy?.ticket_types ?? [];
  const [ticket, setTicket] = useState<number | null>(null);
  const chosen = offered.find((t) => t.id === ticket) ?? null;
  const [answers, setAnswers] = useState<Answers>({});
  const [pay, setPay] = useState<{ method: string; reference: string } | null>(null);
  const [waive, setWaive] = useState<string | null>(null);
  const [promo, setPromo] = useState('');
  const [print, setPrint] = useState(may('events.badge.print'));
  const [key] = useState(() => newKey('walkin'));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  /* The published form's fields for this ticket, standard ones first; offline, the standard ones. A file is not asked at a desk. */
  const all: FormField[] = useMemo(() => {
    if (offline) return STANDARD;
    const published = form.data?.published?.fields ?? [];
    const keys = new Set(published.map((f) => f.key));
    return [...STANDARD.filter((f) => !keys.has(f.key)), ...published].filter((f) => f.type !== 'FILE');
  }, [offline, form.data]);
  const shown = all.filter((f) => fieldShows(f, ticket, answers));
  const set = (k: string, v: string | boolean | string[]) => setAnswers((a) => ({ ...a, [k]: v }));

  const submitOnline = async () => {
    if (!ticket) return;
    setBusy(true);
    setError(null);
    setFields({});
    try {
      const body = {
        ticket_type_id: ticket,
        answers: Object.fromEntries(shown.map((f) => [f.key, answers[f.key] ?? (f.type === 'CHECKBOX' || f.type === 'CONSENT' ? false : '')])),
        gate_id: gateId ?? undefined,
        device_id: deviceId,
        check_in: true,
        print_badge: print,
        client_uuid: scanId('dsk'),
        ...(pay ? { payment: { method: pay.method, reference: pay.reference.trim() || undefined } } : {}),
        ...(waive !== null ? { waive_payment: true, reason: waive.trim() } : {}),
        ...(promo.trim() ? { promo_code: promo.trim() } : {}),
      };
      const r = await ePost<{ checkin: ScanView | null; badge: BadgeJob | null; registration: { number: string } | null }>(`/events/${event.id}/walk-ins`, body, key);
      toast(r.data.checkin ? 'success' : 'info', r.message);
      if (r.data.badge?.id) void printQueued(event.id, [r.data.badge.id]);
      void qc.invalidateQueries({ queryKey: K.live(event.id) });
      onDone(r.data.checkin ? { source: 'server', view: r.data.checkin, message: r.message, badge: r.data.badge } : null);
    } catch (e) {
      if (e instanceof ApiError && e.offline && status.data?.copy?.walk_ins) {
        setOffline(true);
        setError('WorkSuite cannot be reached. You can let this person in on the desk’s own word; they are registered when the line is back.');
      } else {
        setError(errorText(e));
        setFields(fieldErrors(e));
      }
    } finally {
      setBusy(false);
    }
  };

  const submitOffline = async () => {
    if (!ticket) return;
    setBusy(true);
    setError(null);
    try {
      const r = await deskWalkIn({ event_id: event.id, ticket_type_id: ticket, answers: Object.fromEntries(Object.entries(answers).filter(([k]) => STANDARD.some((f) => f.key === k))) as Record<string, string> });
      toast('success', r.message);
      void qc.invalidateQueries({ queryKey: DK.all });
      onDone(null);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const needsContact = !String(answers.email ?? '').trim() && !String(answers.phone ?? '').trim();
  const ready = !!ticket && !!String(answers.first_name ?? '').trim() && !needsContact && (waive === null || waive.trim().length > 0);
  const methods = (live.data?.payment_methods ?? []).filter((m) => m !== 'offset');

  return (
    <Modal
      title={offline ? 'Walk-in — kept offline' : 'Walk-in'}
      onClose={onClose}
      width={620}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon="user-plus" loading={busy} disabled={!ready} onClick={() => void (offline ? submitOffline() : submitOnline())}>
            {offline ? 'Let in, register later' : 'Register and check in'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {offline ? (
          status.data?.copy?.walk_ins ? (
            <p className="m-0 rounded-[10px] bg-warning-bg px-3 py-2 text-[12.5px] text-warning">
              WorkSuite is out of reach. This walk-in gets a provisional number and is registered when the line is back; if the server cannot confirm it (full, a paid ticket, answers missing) it goes to the review queue.
            </p>
          ) : (
            <Refusal text={status.data?.copy ? 'Walk-ins are off for this event.' : 'WorkSuite is out of reach and this computer has no offline copy of the event: walk-ins wait for the line.'} />
          )
        ) : null}
        <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0">
          <legend className="mb-1 text-[12.5px] font-semibold text-ink-2">Ticket</legend>
          {!offline && tickets.isLoading ? <Spinner /> : null}
          {!offline && tickets.error ? <Refusal text={errorText(tickets.error)} /> : null}
          <div className="flex flex-wrap gap-1.5">
            {(offline ? offlineTickets.map((t) => ({ id: t.id, name: t.name, price: null as string | null, currency: null as string | null, free: true, availability: 'AVAILABLE', availability_label: '' })) : offered).map((t) => (
              <button
                key={t.id}
                type="button"
                aria-pressed={ticket === t.id}
                disabled={t.availability === 'SOLD_OUT' || t.availability === 'NOT_ON_SALE'}
                onClick={() => {
                  setTicket(t.id);
                  setPay(null);
                  setWaive(null);
                }}
                className={cx('flex flex-col rounded-[10px] border px-3 py-1.5 text-left text-[13px] disabled:opacity-40', ticket === t.id ? 'border-primary bg-selection' : 'border-line bg-surface')}
              >
                <b>{t.name}</b>
                {t.price !== null ? <span className="text-[11.5px] text-ink-2">{t.free ? 'Free' : money(t.price, t.currency)}{t.availability_label && t.availability !== 'AVAILABLE' ? ` · ${t.availability_label}` : ''}</span> : null}
              </button>
            ))}
          </div>
        </fieldset>

        <div className="grid grid-cols-2 gap-3">
          {shown.map((f) => (
            <Field key={f.key} f={f} value={answers[f.key]} onChange={(v) => set(f.key, v)} error={fields[f.key] ?? null} />
          ))}
        </div>
        {needsContact ? <div className="text-[12px] text-ink-3">A phone or an email is needed.</div> : null}

        {!offline && chosen && !chosen.free ? (
          <fieldset className="m-0 flex flex-col gap-2 rounded-[10px] border border-line p-3">
            <legend className="px-1 text-[12.5px] font-semibold text-ink-2">Payment — {money(chosen.price, chosen.currency)}</legend>
            {methods.length > 0 ? (
              <div className="flex flex-wrap items-center gap-1.5">
                {methods.map((m) => (
                  <button key={m} type="button" aria-pressed={pay?.method === m} onClick={() => { setPay({ method: m, reference: pay?.reference ?? '' }); setWaive(null); }} className={cx('h-8 rounded-[8px] border px-3 text-[12.5px] font-semibold', pay?.method === m ? 'border-primary bg-selection text-primary' : 'border-line bg-surface text-ink-2')}>
                    {nice(m)}
                  </button>
                ))}
                {pay ? <input value={pay.reference} onChange={(e) => setPay({ ...pay, reference: e.target.value })} placeholder="Reference (slip, transfer…)" className="h-8 min-w-0 flex-1 rounded-[8px] border border-line bg-surface px-2 text-[12.5px] outline-none focus:border-primary" /> : null}
              </div>
            ) : (
              <span className="text-[12px] text-ink-3">Billing is not part of this installation: the walk-in stays waiting for its payment and is not checked in.</span>
            )}
            {may('events.registration.approve') ? (
              <label className="flex items-center gap-2 text-[12.5px] text-ink-2">
                <input type="checkbox" checked={waive !== null} onChange={(e) => { setWaive(e.target.checked ? '' : null); if (e.target.checked) setPay(null); }} /> Waive the payment
                {waive !== null ? <input autoFocus value={waive} onChange={(e) => setWaive(e.target.value)} placeholder="Why" className="h-8 min-w-0 flex-1 rounded-[8px] border border-line bg-surface px-2 text-[12.5px] outline-none focus:border-primary" /> : null}
              </label>
            ) : null}
            <input value={promo} onChange={(e) => setPromo(e.target.value)} placeholder="Promo code (optional)" className="h-8 w-[220px] rounded-[8px] border border-line bg-surface px-2 text-[12.5px] outline-none focus:border-primary" />
          </fieldset>
        ) : null}

        {!offline && may('events.badge.print') ? (
          <label className="flex items-center gap-2 text-[13px] text-ink">
            <input type="checkbox" checked={print} onChange={(e) => setPrint(e.target.checked)} /> Print the badge here
          </label>
        ) : null}
        {error ? <Refusal text={error} /> : null}
      </div>
    </Modal>
  );
}

function Field({ f, value, onChange, error }: { f: FormField; value: Answers[string] | undefined; onChange: (v: string | boolean | string[]) => void; error: string | null }) {
  const label = (
    <span>
      {f.label}
      {f.required ? <span className="text-danger"> *</span> : null}
    </span>
  );
  const box = 'h-9 rounded-[8px] border border-line bg-surface px-2.5 text-[13px] font-normal text-ink outline-none focus:border-primary';
  const wide = f.type === 'TEXTAREA' || f.type === 'CONSENT' || f.type === 'MULTI_SELECT' || f.type === 'RADIO';
  let control;
  switch (f.type) {
    case 'CHECKBOX':
    case 'CONSENT':
      control = (
        <label className="flex items-start gap-2 text-[12.5px] font-normal text-ink">
          <input type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} className="mt-0.5" />
          <span>{f.consent?.text ?? f.label}</span>
        </label>
      );
      break;
    case 'SELECT':
    case 'RADIO':
      control = (
        <div className="flex flex-wrap gap-1.5">
          {optionsOf(f).map((o) => (
            <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)} className={cx('h-8 rounded-[8px] border px-2.5 text-[12.5px]', value === o.value ? 'border-primary bg-selection text-primary' : 'border-line bg-surface text-ink-2')}>
              {o.label}
            </button>
          ))}
        </div>
      );
      break;
    case 'MULTI_SELECT': {
      const list = Array.isArray(value) ? value : [];
      control = (
        <div className="flex flex-wrap gap-1.5">
          {optionsOf(f).map((o) => (
            <button key={o.value} type="button" aria-pressed={list.includes(o.value)} onClick={() => onChange(list.includes(o.value) ? list.filter((x) => x !== o.value) : [...list, o.value])} className={cx('h-8 rounded-[8px] border px-2.5 text-[12.5px]', list.includes(o.value) ? 'border-primary bg-selection text-primary' : 'border-line bg-surface text-ink-2')}>
              {o.label}
            </button>
          ))}
        </div>
      );
      break;
    }
    case 'TEXTAREA':
      control = <textarea value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} rows={2} className="rounded-[8px] border border-line bg-surface px-2.5 py-1.5 text-[13px] font-normal text-ink outline-none focus:border-primary" />;
      break;
    default:
      control = (
        <input
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          type={f.type === 'EMAIL' ? 'email' : f.type === 'NUMBER' ? 'number' : f.type === 'DATE' ? 'date' : f.type === 'PHONE' ? 'tel' : 'text'}
          autoFocus={f.key === 'first_name'}
          className={box}
        />
      );
  }
  return (
    <div className={cx('flex flex-col gap-1 text-[12.5px] font-semibold text-ink-2', wide && 'col-span-2')}>
      {f.type === 'CHECKBOX' || f.type === 'CONSENT' ? null : label}
      {control}
      {f.help ? <span className="text-[11.5px] font-normal text-ink-3">{f.help}</span> : null}
      {error ? <span className="text-[11.5px] font-medium text-danger">{error}</span> : null}
    </div>
  );
}

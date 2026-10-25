import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from '../../core/toasts';
import { Button, cx, Modal } from '../../components/ui';
import { addDays, book, dayLabel, fetchAvailability, K, money, refusal, today, type ClientRow } from './api';
import { ClientPick } from './ClientPick';
import { input, Kbd, label, Refused, useDesk, type Desk } from './parts';

/**
 * D06 · New appointment: 1 client, 2 service, 3 stylist (or anyone), 4 a time the server offers — the slots are the
 * server's availability engine, asked again under its locks when Book is pressed. A service that asks a deposit says
 * so before booking, and the booking starts Pending until it is covered. Tab to move, Enter to book, Esc to close.
 */
export default function NewAppointment({ prefill, onClose, onBooked }: { prefill: Parameters<Desk['book']>[0]; onClose: () => void; onBooked: (id: number) => void }) {
  const desk = useDesk();
  const qc = useQueryClient();
  const o = desk.options;
  const loc = o?.locations.find((l) => l.id === desk.location) ?? o?.locations[0] ?? null;
  const [client, setClient] = useState<ClientRow | null>(prefill?.customer ? { ...prefill.customer, phone: null, email: null } : null);
  const services = (o?.services ?? []).filter((s) => !loc || !s.locations.length || s.locations.includes(loc.id));
  const [service, setService] = useState<number | null>(prefill?.service ?? null);
  const providers = (o?.providers ?? []).filter((p) => (!loc || !p.locations.length || p.locations.includes(loc.id)) && (!service || !p.services.length || p.services.includes(service)));
  const [provider, setProvider] = useState<number | 'any'>(prefill?.provider ?? 'any');
  const [date, setDate] = useState(prefill?.date ?? today(loc?.timezone));
  const [slot, setSlot] = useState<{ starts_at: string; label: string; provider: number; name: string } | null>(null);
  const [notes, setNotes] = useState('');
  const [internal, setInternal] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const avail = useQuery({
    queryKey: K.availability({ loc: loc?.id, service, provider, date }),
    queryFn: ({ signal }) => fetchAvailability({ location: loc!.id, service: service!, provider, date }, signal),
    enabled: !!loc && !!service && desk.online,
    staleTime: 0,
  });
  const svc = services.find((s) => s.id === service) ?? null;
  const slots = (avail.data?.providers ?? []).flatMap((p) => p.slots.map((s) => ({ ...s, provider: p.id, name: p.name })));
  // With "anyone", one button per time (the first provider free then); the server picks again under its lock.
  const times = provider === 'any' ? slots.filter((s, i) => slots.findIndex((x) => x.label === s.label) === i).sort((a, b) => a.starts_at.localeCompare(b.starts_at)) : slots;
  const wanted = prefill?.start;
  const ready = !!client && !!svc && !!slot && !!loc && desk.online;

  const submit = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await book({ location_id: loc!.id, service_id: svc!.id, provider_id: provider === 'any' ? 'any' : slot!.provider, customer_id: client!.id, starts_at: slot!.starts_at, notes: notes.trim() || undefined, internal_notes: internal.trim() || undefined });
      toast('success', r.message || 'Booked.');
      void qc.invalidateQueries({ queryKey: K.all });
      onBooked(r.data.appointment.id);
    } catch (e) {
      const f = refusal(e);
      setErr(f.next ? `${f.message} The next free time is ${f.next.label ?? f.next.starts_at}${f.next.provider ? ` with ${f.next.provider}` : ''}.` : f.message);
      void avail.refetch();
    } finally {
      setBusy(false);
    }
  };

  const step = (n: number, title: string) => <div className="mb-1.5 text-[12px] font-bold tracking-[.02em] text-ink-2">{`${n} · ${title}`}</div>;
  return (
    <Modal
      title="New appointment"
      onClose={onClose}
      width={720}
      footer={
        <>
          <span className="mr-auto text-[12px] text-ink-2">
            {slot && svc ? `${dayLabel(date)}, ${slot.label} · ${svc.name} with ${provider === 'any' ? 'anyone free' : slot.name}` : 'Tab to move · Enter to book · Esc to close'}
          </span>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!ready} onClick={() => void submit()}>
            {svc?.deposit ? 'Book · deposit asked' : 'Book'}<Kbd>⏎</Kbd>
          </Button>
        </>
      }
    >
      <form onSubmit={(e) => (e.preventDefault(), void submit())} className="grid grid-cols-2 gap-5">
        <div className="flex flex-col gap-4">
          <div>{step(1, 'Client')}<ClientPick value={client} onChange={setClient} autoFocus={!client} /></div>
          <div>
            {step(2, 'Service')}
            <div className="flex max-h-[180px] flex-col gap-1 overflow-y-auto scroll-thin">
              {services.map((s) => (
                <button key={s.id} type="button" aria-pressed={service === s.id} onClick={() => (setService(s.id), setSlot(null))} className={cx('flex items-center gap-2 rounded-[8px] border px-2.5 py-1.5 text-left text-[13px]', service === s.id ? 'border-primary bg-[#EEF1FD] font-bold dark:bg-selection' : 'border-line hover:bg-subtle')}>
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color ?? '#9AA1B5' }} />
                  <span className="flex-1 truncate">{s.name}</span>
                  <span className="text-[11.5px] text-ink-3">{`${s.duration_min} min`}</span>
                </button>
              ))}
            </div>
          </div>
          <div>
            {step(3, o?.terms.provider ?? 'Stylist')}
            <select className={input} value={provider} onChange={(e) => (setProvider(e.target.value === 'any' ? 'any' : Number(e.target.value)), setSlot(null))} aria-label="Stylist">
              <option value="any">Anyone free</option>
              {providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
        </div>
        <div className="flex flex-col gap-4">
          <div>
            {step(4, `Time · ${loc?.name ?? ''}`)}
            <div className="mb-2 flex gap-1 overflow-x-auto scroll-thin">
              {Array.from({ length: 7 }, (_, i) => addDays(today(loc?.timezone), i)).map((d) => (
                <button key={d} type="button" aria-pressed={d === date} onClick={() => (setDate(d), setSlot(null))} className={cx('min-w-[52px] rounded-[8px] border px-1.5 py-1 text-center text-[11px]', d === date ? 'border-primary bg-[#EEF1FD] font-bold text-[#23349E] dark:bg-selection dark:text-primary' : 'border-line text-ink-2')}>
                  {dayLabel(d, { weekday: 'short' })}<br /><b className="text-[13px]">{Number(d.slice(8))}</b>
                </button>
              ))}
              <input type="date" aria-label="Another day" className={cx(input, 'w-[130px]')} value={date} onChange={(e) => e.target.value && (setDate(e.target.value), setSlot(null))} />
            </div>
            {!service ? <p className="m-0 text-[12px] text-ink-3">Choose a service to see free times.</p> : !desk.online ? <p className="m-0 text-[12px] text-ink-3">Free times need a connection to WorkSuite.</p> : avail.isPending ? <p className="m-0 text-[12px] text-ink-3">Asking for free times…</p> : (
              <div className="grid max-h-[170px] grid-cols-5 gap-1 overflow-y-auto scroll-thin">
                {times.map((s) => {
                  const on = slot?.starts_at === s.starts_at && slot.provider === s.provider;
                  return (
                    <button key={`${s.provider}-${s.starts_at}`} type="button" aria-pressed={on} title={provider === 'any' ? undefined : s.name} onClick={() => setSlot(s)} className={cx('h-8 rounded-[8px] border text-[12px] tabular-nums', on ? 'border-primary bg-[#23349E] font-bold text-white dark:bg-primary' : wanted === s.label ? 'border-primary text-primary' : 'border-line text-ink hover:bg-subtle')}>
                      {s.label}
                    </button>
                  );
                })}
                {!times.length ? <p className="col-span-5 m-0 text-[12px] text-ink-3">No free time that day.</p> : null}
              </div>
            )}
          </div>
          <label><span className={label}>Note for the client</span><input className={input} value={notes} maxLength={500} onChange={(e) => setNotes(e.target.value)} /></label>
          <label><span className={label}>Internal note</span><input className={input} value={internal} maxLength={500} onChange={(e) => setInternal(e.target.value)} /></label>
          {svc?.deposit ? <p className="m-0 rounded-[8px] bg-[#FDF1E3] px-3 py-2 text-[12px] text-[#9A4A06] dark:bg-warning/15 dark:text-warning">{`Deposit ${money(svc.deposit.due as number | undefined, svc.deposit.currency ?? null)} asked → starts as Pending until it is paid.`}</p> : null}
          <Refused>{err}</Refused>
        </div>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

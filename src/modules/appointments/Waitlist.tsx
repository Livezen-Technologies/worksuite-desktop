import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from '../../core/toasts';
import { Button, cx, Modal } from '../../components/ui';
import { addDays, addToWaitlist, bookFromWaitlist, offerFromWaitlist, dateIn, fetchWaitlist, K, minutesIn, hhmm, refusal, today, type ClientRow } from './api';
import { ClientPick } from './ClientPick';
import { errText, Head, input, label, Pill, Refused, Section, useDesk } from './parts';

/**
 * D16 · Waitlist (SRS T-07): clients who want a time that is full. When a booking is cancelled the server matches the
 * freed time against the list and offers it here; Book opens New appointment on that time for the first match.
 * An entry the server has matched (`match`) is booked in one click (`POST /waitlist/{id}/book`) or offered to the client
 * with the time held (`POST /waitlist/{id}/offer`). On a server without `/waitlist` (404) the board says so.
 */
export default function Waitlist() {
  const desk = useDesk();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: K.waitlist, queryFn: ({ signal }) => fetchWaitlist(signal), refetchInterval: 60_000 });
  const [adding, setAdding] = useState(false);
  const act = async (run: () => Promise<{ message: string }>, done: string) => {
    try {
      const r = await run();
      toast('success', r.message || done);
    } catch (err) {
      toast('error', refusal(err).message);
    } finally {
      void qc.invalidateQueries({ queryKey: K.all });
    }
  };
  const tz = desk.options?.locations.find((l) => l.id === desk.location)?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;

  if (q.data === null) {
    return (
      <div>
        <Head title="Waitlist" />
        <Section><p className="m-0 px-4 py-4 text-[13px] text-ink-2">The waitlist needs a newer WorkSuite server (Appointments with T-07). Until then, a freed time shows on Today and the calendar.</p></Section>
      </div>
    );
  }
  const items = q.data?.items ?? [];
  const offers = q.data?.offers ?? [];
  const byId = new Map(items.map((e) => [e.id, e]));
  return (
    <div>
      <Head title="Waitlist" sub="Clients wanting a time that is full. Freed times are matched within a minute.">
        <Button variant="primary" icon="plus" disabled={!desk.online} onClick={() => setAdding(true)}>Add to waitlist</Button>
      </Head>
      {offers.map((o, i) => {
        const first = o.matches.map((m) => byId.get(m)).find(Boolean);
        return (
          <div key={i} className="mb-3 flex flex-wrap items-center gap-3 rounded-[12px] border border-success-line bg-success-bg px-4 py-2.5 text-[13px] text-success-ink dark:border-success/40 dark:bg-success/15 dark:text-success">
            <b>{`Freed · ${dateIn(o.starts_at, tz) === today(tz) ? 'Today' : dateIn(o.starts_at, tz)} ${hhmm(minutesIn(o.starts_at, tz))}${o.provider ? ` · ${o.provider.name}` : ''}`}</b>
            <span className="min-w-0 flex-1">{`${o.why ? `${o.why} ` : ''}${o.matches.length} waitlist match${o.matches.length === 1 ? '' : 'es'}.`}</span>
            {first ? (
              <Button size="sm" variant="primary" disabled={!desk.online} onClick={() => desk.book({ date: dateIn(o.starts_at, tz), start: hhmm(minutesIn(o.starts_at, tz)), provider: o.provider?.id, service: first.service?.id, customer: { id: first.customer.id, name: first.customer.name } })}>
                {`Book ${first.customer.name.split(' ')[0]}`}
              </Button>
            ) : null}
          </div>
        );
      })}
      <Section>
        <ul className="m-0 list-none p-0">
          {items.map((e) => (
            <li key={e.id} className="flex items-center gap-3 border-b border-line/70 px-4 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-bold text-ink">{e.customer.name}</div>
                <div className="text-[12px] text-ink-3">{[e.service?.name ?? 'Any service', e.provider?.name ?? 'anyone', [e.date_from, e.date_to].filter(Boolean).join(' – '), e.part_of_day, e.note].filter(Boolean).join(' · ')}</div>
              </div>
              {e.match ? <span className="text-[12px] text-ink-2">{e.match.label ?? `${dateIn(e.match.starts_at, tz)} ${hhmm(minutesIn(e.match.starts_at, tz))}`}</span> : null}
              {e.status ? <Pill tone={e.status === 'offered' ? 'ok' : 'muted'}>{e.status}</Pill> : null}
              {e.match ? <Button size="sm" variant="secondary" disabled={!desk.online} onClick={() => void act(() => offerFromWaitlist(e.id), 'Offered.')}>Offer</Button> : null}
              {e.match ? <Button size="sm" variant="primary" disabled={!desk.online} onClick={() => void act(() => bookFromWaitlist(e.id, { starts_at: e.match!.starts_at, provider_id: e.match!.provider_id }), 'Booked.')}>Book match</Button> : null}
              <Button size="sm" variant="secondary" disabled={!desk.online} onClick={() => desk.book({ customer: { id: e.customer.id, name: e.customer.name }, service: e.service?.id, provider: e.provider?.id, date: e.date_from ?? undefined })}>Book</Button>
            </li>
          ))}
          {!items.length ? <li className="px-4 py-6 text-center text-[12.5px] text-ink-3">{q.isPending ? 'Reading…' : q.isError ? errText(q.error) : 'Nobody is waiting.'}</li> : null}
        </ul>
      </Section>
      {adding ? <AddDialog onClose={() => setAdding(false)} onSaved={() => (setAdding(false), void qc.invalidateQueries({ queryKey: K.waitlist }))} /> : null}
    </div>
  );
}

function AddDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const desk = useDesk();
  const [client, setClient] = useState<ClientRow | null>(null);
  const [service, setService] = useState<number | null>(desk.options?.services[0]?.id ?? null);
  const [provider, setProvider] = useState<number | null>(null);
  const [from, setFrom] = useState(today());
  const [to, setTo] = useState(addDays(today(), 7));
  const [part, setPart] = useState('any');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    if (!client || !service) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await addToWaitlist({ customer_id: client.id, location_id: desk.location, service_id: service, provider_id: provider, date_from: from, date_to: to, part_of_day: part, note: note.trim() || undefined });
      toast('success', r.message || 'Added to the waitlist.');
      onSaved();
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="Add to waitlist" onClose={onClose} width={520} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={!client || !service} onClick={() => void save()}>Add</Button></>}>
      <div className="flex flex-col gap-3">
        <div><span className={label}>Client</span><ClientPick value={client} onChange={setClient} autoFocus /></div>
        <div className="grid grid-cols-2 gap-2">
          <label><span className={label}>Service</span><select className={input} value={service ?? ''} onChange={(e) => setService(Number(e.target.value))}>{(desk.options?.services ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
          <label><span className={label}>With</span><select className={input} value={provider ?? ''} onChange={(e) => setProvider(e.target.value ? Number(e.target.value) : null)}><option value="">Anyone</option>{(desk.options?.providers ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          <label><span className={label}>From</span><input type="date" className={input} value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label><span className={label}>To</span><input type="date" className={input} value={to} onChange={(e) => setTo(e.target.value)} /></label>
          <label><span className={label}>Time of day</span><select className={input} value={part} onChange={(e) => setPart(e.target.value)}><option value="any">Any time</option><option value="morning">Morning</option><option value="afternoon">Afternoon</option><option value="evening">Evening</option></select></label>
          <label><span className={label}>Note</span><input className={cx(input)} value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} /></label>
        </div>
        <Refused>{err}</Refused>
      </div>
    </Modal>
  );
}

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from '../../core/toasts';
import { Button, cx } from '../../components/ui';
import { book, fetchAvailability, K, refusal, setStatus, today, type ClientRow } from './api';
import { ClientPick } from './ClientPick';
import { Head, Refused, Section, useDesk, useNow } from './parts';

/**
 * D07 · Walk-in: someone who is here now. Pick the service; each stylist who gives it shows their first free start
 * from the server's availability (free now, or free at…); find the client by phone or add them; Book and check in
 * books that start and checks them in at once. Booking needs WorkSuite; offline, the waitlist is offered instead.
 */
export default function WalkIn({ onDone, onWaitlist }: { onDone: (id: number) => void; onWaitlist: () => void }) {
  const desk = useDesk();
  const qc = useQueryClient();
  const loc = desk.options?.locations.find((l) => l.id === desk.location) ?? null;
  const services = (desk.options?.services ?? []).filter((s) => !loc || !s.locations.length || s.locations.includes(loc.id));
  const [service, setService] = useState<number | null>(null);
  const [pick, setPick] = useState<{ provider: number; starts_at: string; label: string; name: string } | null>(null);
  const [client, setClient] = useState<ClientRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const day = today(loc?.timezone);
  const avail = useQuery({
    queryKey: K.availability({ walkin: 1, loc: loc?.id, service, day }),
    queryFn: ({ signal }) => fetchAvailability({ location: loc!.id, service: service!, provider: 'any', date: day }, signal),
    enabled: !!loc && !!service && desk.online,
    refetchInterval: 60_000,
    staleTime: 0,
  });
  const svc = services.find((s) => s.id === service);
  const now = useNow();
  const who = (avail.data?.providers ?? []).map((p) => {
    const first = p.slots.find((s) => Date.parse(s.starts_at) >= now - 5 * 60_000) ?? null;
    const wait = first ? Math.max(0, Math.round((Date.parse(first.starts_at) - now) / 60_000)) : null;
    return { ...p, first, wait };
  }).sort((a, b) => (a.wait ?? 1e9) - (b.wait ?? 1e9));

  const go = async () => {
    if (!pick || !client || !loc || !svc) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await book({ location_id: loc.id, service_id: svc.id, provider_id: pick.provider, customer_id: client.id, starts_at: pick.starts_at, internal_notes: 'Walk-in' });
      const a = r.data.appointment;
      if (a.next.some((n) => n.status === 'checked_in' && n.allowed)) await setStatus(a, 'checked_in');
      else if (a.next.some((n) => n.status === 'confirmed' && n.allowed)) toast('info', 'Booked. It waits to be confirmed (a deposit, or a permission) before check-in.');
      toast('success', `${client.name} is booked with ${pick.name} and checked in.`);
      void qc.invalidateQueries({ queryKey: K.all });
      onDone(a.id);
    } catch (e) {
      setErr(refusal(e).message);
      void avail.refetch();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-[880px]">
      <Head title="Walk-in" sub="Book someone who is here now. They start checked in." />
      {!desk.online ? <div className="mb-3"><Refused>Booking a walk-in needs a connection to WorkSuite. Add them to the waitlist and book when the connection is back.</Refused></div> : null}
      <div className="grid grid-cols-2 gap-4">
        <Section title="Service">
          <div className="flex flex-col gap-1 px-3 pb-3">
            {services.map((s) => (
              <button key={s.id} type="button" aria-pressed={service === s.id} onClick={() => (setService(s.id), setPick(null))} className={cx('flex items-center rounded-[8px] border px-2.5 py-2 text-left text-[13px]', service === s.id ? 'border-primary bg-[#EEF1FD] font-bold dark:bg-selection' : 'border-line hover:bg-subtle')}>
                <span className="flex-1">{s.name}</span>
                <span className="text-[11.5px] text-ink-3">{`${s.duration_min} min`}</span>
              </button>
            ))}
          </div>
        </Section>
        <Section title={svc ? `Who can take them · ${svc.name}, ${svc.duration_min} min` : 'Who can take them'}>
          <div className="flex flex-col gap-1 px-3 pb-3">
            {!service ? <p className="m-0 text-[12px] text-ink-3">Choose the service first.</p> : avail.isPending && desk.online ? <p className="m-0 text-[12px] text-ink-3">Asking who is free…</p> : null}
            {who.map((p) => {
              const on = pick?.provider === p.id;
              return (
                <div key={p.id} className={cx('flex items-center gap-2 rounded-[8px] border px-2.5 py-2', on ? 'border-primary bg-[#EEF1FD] dark:bg-selection' : 'border-line')}>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-bold text-ink">{p.name}</div>
                    <div className="text-[12px] text-ink-3">{p.first ? (p.wait! <= 5 ? `Free now · ${p.first.label}` : `Free at ${p.first.label} · ${p.wait} min wait`) : 'Not free again today'}</div>
                  </div>
                  {p.first ? <Button size="sm" variant={on ? 'primary' : 'secondary'} onClick={() => setPick({ provider: p.id, starts_at: p.first!.starts_at, label: p.first!.label, name: p.name })}>{on ? 'Chosen' : p.wait! <= 5 ? 'Take now' : 'Take'}</Button> : null}
                </div>
              );
            })}
          </div>
        </Section>
      </div>
      <Section title="Client" className="mt-4">
        <div className="px-3 pb-3"><ClientPick value={client} onChange={setClient} phoneFirst /></div>
      </Section>
      <div className="mt-3"><Refused>{err}</Refused></div>
      <div className="mt-4 flex items-center gap-2">
        <span className="flex-1 text-[12.5px] text-ink-2">{pick && svc ? `${pick.name} · ${pick.label} · ${svc.name} · checked in straight away` : ''}</span>
        <Button variant="secondary" onClick={onWaitlist}>Add to waitlist instead</Button>
        <Button variant="primary" loading={busy} disabled={!pick || !client || !desk.online} onClick={() => void go()}>Book and check in</Button>
      </div>
    </div>
  );
}

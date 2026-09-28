import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Icon } from '../../components/Icon';
import { Button, Card, Chip, Spinner, TextField, cx } from '../../components/ui';
import { toast } from '../../core/toasts';
import {
  addClient,
  addDays,
  amount,
  answered,
  attemptKey,
  bookAt,
  capable,
  fetchAvailability,
  fetchClient,
  fetchClients,
  fetchQuote,
  freeNow,
  K,
  longDay,
  nextFree,
  refusal,
  startWalkIn,
  STATEMENT,
  todayAt,
  worstAllergy,
  type CheckInExtra,
  type ClientCandidate,
  type Gate,
  type Service,
  type Severity,
} from './api';
import { AllergyGate } from './CheckIn';
import { AllergyChip, Failed, firstName, Note, Person, seedOf, useDesk, useNow } from './parts';

/**
 * A walk-in, or a booking made at the counter (D04, CTR-01…06): who, which
 * services, which stylist — then start now, or book a later slot.
 *
 * THE COUNTER HOLDS NO SCHEDULING OF ITS OWN (CTR-05). Only stylists who do
 * every chosen service are offered (CTR-04); when each is next free comes from
 * the availability check every booking uses, and the price from the server's
 * quote. "Start now" is one request — booked, checked in through the allergy
 * gate, and started — sent under a key made for this attempt, so a second
 * press after a dropped connection is the same walk-in (CTR-06).
 */
interface Chosen {
  id: number;
  name: string;
  phone: string | null;
  note?: string | null;
  allergy: { severity: Severity; substance: string } | null;
}

export default function WalkIn({ later: bookingFirst }: { later: boolean }) {
  const desk = useDesk();
  const qc = useQueryClient();
  const seed = seedOf(desk.params);
  const loc = desk.location.id;
  const services = useMemo(() => desk.options.menu.flatMap((c) => c.services.filter((s) => s.active !== false).map((s) => ({ ...s, category: c.name }))), [desk.options.menu]);
  const clock = useNow();
  const today = todayAt(desk.location.timezone, new Date(clock));

  const [chosenClient, setClient] = useState<Chosen | null>(() => (seed.client_id ? { id: seed.client_id, name: '', phone: null, allergy: null } : null));
  /* Opened for a known client (Book again): who they are, and their allergy, come from their card. */
  const seeded = !!chosenClient && chosenClient.name === '';
  const card = useQuery({ queryKey: K.client(chosenClient?.id ?? 0), queryFn: ({ signal }) => fetchClient(chosenClient!.id, signal), enabled: seeded });
  const client: Chosen | null =
    seeded && card.data ? { id: card.data.client.id, name: card.data.client.name, phone: card.data.client.phone ?? card.data.client.mobile, note: card.data.profile.tier, allergy: worstAllergy(card.data.allergies) } : seeded ? null : chosenClient;
  const [picked, setPicked] = useState<number[]>(() => (seed.service_ids ?? []).filter((id) => services.some((s) => s.id === id)));
  const [stylistId, setStylistId] = useState<number | null>(seed.provider_id ?? null);
  const [category, setCategory] = useState('all');
  const [find, setFind] = useState('');
  const [later, setLater] = useState(bookingFirst);
  const [date, setDate] = useState(seed.date && seed.date >= today ? seed.date : today);
  const [slot, setSlot] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [gate, setGate] = useState<Gate | null>(null);
  const [key, setKey] = useState(attemptKey);
  const [offer, setOffer] = useState<{ starts_at: string; label: string } | null>(null);

  const chosen = picked.map((id) => services.find((s) => s.id === id)).filter((s): s is Service & { category: string } => !!s);
  const categories = desk.options.menu.filter((c) => c.services.length > 0);
  const shown = services.filter((s) => (category === 'all' || s.category === category) && (find.trim() === '' || s.name.toLowerCase().includes(find.trim().toLowerCase())));
  const able = capable(desk.options.stylists, picked, loc);
  const stylist = able.find((s) => s.id === stylistId) ?? null;
  const day = later ? date : today;
  const items = stylist ? chosen.map((s) => ({ service_id: s.id, provider_id: stylist.id })) : [];

  /* When each capable stylist is next free, from the shared availability check. */
  const free = useQueries({
    queries: able.slice(0, 8).map((s) => {
      const asked = JSON.stringify(chosen.map((c) => ({ service_id: c.id, provider_id: s.id })));
      return { queryKey: K.availability(loc, day, asked), queryFn: ({ signal }: { signal: AbortSignal }) => fetchAvailability(loc, day, asked, signal), enabled: chosen.length > 0, staleTime: 30_000 };
    }),
  });
  const quoteItems = JSON.stringify(chosen.map((s) => ({ service_id: s.id, provider_id: stylist?.id ?? 'any' })));
  const quote = useQuery({ queryKey: K.quote(loc, client?.id ?? 0, quoteItems), queryFn: ({ signal }) => fetchQuote(loc, client?.id ?? null, quoteItems, signal), enabled: chosen.length > 0 });

  const stylistIndex = stylist ? able.findIndex((s) => s.id === stylist.id) : -1;
  const stylistDay = stylistIndex >= 0 ? free[stylistIndex]?.data : undefined;
  const firstFree = nextFree(stylistDay, clock);
  const now = freeNow(firstFree, clock);

  /* A different walk-in is a different attempt: any change to it gets a new key. */
  const fresh = () => setKey(attemptKey());
  const toggle = (id: number) => {
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
    setSlot(null);
    setOffer(null);
    fresh();
  };

  function done(message: string, visitDate?: string) {
    toast('success', message);
    void qc.invalidateQueries({ queryKey: K.all });
    if (later) desk.go('calendar', { date: visitDate ?? date });
    else desk.go('today');
  }

  function failed(e: unknown, again: string) {
    if (answered(e)) {
      fresh();
      const d = refusal(e);
      toast('error', e instanceof Error ? e.message : 'That did not go through.');
      if (d.next?.starts_at) setOffer({ starts_at: d.next.starts_at, label: d.next.label });
    } else {
      /* No answer: the next press is the same attempt, under the same key, so it cannot happen twice. */
      toast('error', `WorkSuite did not answer. Press ${again} again — it is the same one, never a second.`);
    }
  }

  async function startNow(extra: CheckInExtra = {}) {
    if (!client || !stylist) return;
    setBusy(true);
    try {
      const r = await startWalkIn({ location_id: loc, client_id: client.id, items, desk_id: desk.desk.id }, extra, key);
      setGate(null);
      if (r.data.gate && r.data.visit) {
        /* Booked, but the check-in still needs something: the same panel as any check-in. */
        toast('warning', r.message ?? 'Booked — the check-in needs you.');
        desk.checkIn(r.data.visit);
        desk.go('today');
      } else {
        done(r.message || 'Started now.');
      }
    } catch (e) {
      const d = refusal(e);
      if (answered(e) && d.code === 'ack_required' && d.gate) {
        fresh();
        setGate(d.gate);
      } else {
        failed(e, 'Start now');
      }
    } finally {
      setBusy(false);
    }
  }

  async function book(startsAt: string) {
    if (!client || !stylist) return;
    setBusy(true);
    try {
      const r = await bookAt({ location_id: loc, client_id: client.id, items, desk_id: desk.desk.id }, startsAt, bookingFirst, key);
      done(r.message || 'Booked.', r.data.visit?.date);
    } catch (e) {
      failed(e, 'Book');
    } finally {
      setBusy(false);
    }
  }

  const canBook = desk.may('salon.visit.book');
  const ready = !!client && chosen.length > 0 && !!stylist && canBook;
  const slots = (stylistDay?.starts ?? []).filter((s) => s.free && Date.parse(s.starts_at) >= clock - 5 * 60_000);

  return (
    <div className="flex flex-col gap-4 p-6 xl:flex-row">
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <div>
          <h1 className="text-[22px] font-extrabold text-ink">{bookingFirst ? 'New booking' : 'Walk-in'}</h1>
          <p className="mt-0.5 text-[13px] text-ink-2">Pick services, then a stylist who does them. Times come from the same check as every booking.</p>
        </div>
        <Card>
          <div className="pt-4">
            <TextField aria-label="Search services" placeholder="Search services" value={find} onChange={(e) => setFind(e.target.value)} />
          </div>
          <div role="radiogroup" aria-label="Category" className="mt-3 flex flex-wrap gap-1.5">
            {[{ key: 'all', name: 'All' }, ...categories.map((c) => ({ key: c.name, name: c.name }))].map((c) => (
              <button
                key={c.key}
                type="button"
                role="radio"
                aria-checked={category === c.key}
                onClick={() => setCategory(c.key)}
                className={cx('h-8 rounded-full px-3.5 text-[12.5px] font-semibold', category === c.key ? 'bg-primary text-white' : 'border border-line bg-surface text-ink hover:bg-subtle')}
              >
                {c.name}
              </button>
            ))}
          </div>
          {shown.length === 0 ? (
            <p className="py-4 text-[13px] text-ink-2">{services.length === 0 ? 'No services are set up yet. They are added in SalonMate → Services.' : 'No service matches.'}</p>
          ) : (
            <div className="mt-3 grid grid-cols-2 gap-2.5 2xl:grid-cols-3">
              {shown.map((s) => {
                const on = picked.includes(s.id);
                return (
                  <button
                    key={s.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggle(s.id)}
                    className={cx('flex min-h-[72px] flex-col justify-between rounded-[10px] border p-3 text-left transition-colors', on ? 'border-primary bg-selection' : 'border-line bg-surface hover:bg-subtle')}
                  >
                    <span className="flex w-full items-start gap-2 text-[14px] font-bold text-ink">
                      <span className="flex-1">{s.name}</span>
                      {on ? <Icon name="check" size={16} className="text-primary" /> : null}
                    </span>
                    <span className="flex w-full flex-wrap justify-between gap-x-2 text-[12.5px] text-ink-2">
                      <span className="whitespace-nowrap">{s.duration_min} min</span>
                      <span className="whitespace-nowrap tabular-nums">{amount(s.price)}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </Card>
      </div>

      <div className="flex w-full flex-col gap-4 xl:w-[400px]">
        <Card>
          <div className="pt-4">
            {client ? (
              <Person
                name={client.name}
                sub={[client.phone, client.note].filter(Boolean).join(' · ') || 'Client'}
                trailing={
                  <div className="flex items-center gap-2">
                    {client.allergy ? <AllergyChip allergy={client.allergy} /> : null}
                    <Button size="sm" onClick={() => setClient(null)}>
                      Change
                    </Button>
                  </div>
                }
              />
            ) : seeded && !card.isError ? (
              <Spinner label="Loading the client…" />
            ) : (
              <FindClient
                onChosen={(c) => {
                  setClient(c);
                  fresh();
                }}
              />
            )}
          </div>
        </Card>

        <Card title="Services and stylist">
          {chosen.length === 0 ? (
            <p className="text-[13px] text-ink-2">Tap services to add them.</p>
          ) : (
            <ul>
              {chosen.map((s) => {
                const line = quote.data?.lines.find((l) => l.service_id === s.id);
                return (
                  <li key={s.id} className="flex items-baseline justify-between gap-3 py-1 text-[14px] text-ink">
                    <span className="min-w-0 truncate">
                      {s.name} · {line?.duration_min ?? s.duration_min} min
                    </span>
                    <span className="font-bold tabular-nums">{amount(line ? line.price : s.price)}</span>
                  </li>
                );
              })}
            </ul>
          )}

          {chosen.length > 0 ? (
            <div role="radiogroup" aria-label="Stylist" className="mt-3 flex flex-col gap-1.5">
              {desk.options.stylists
                .filter((s) => s.active !== false)
                .map((s) => {
                  const i = able.indexOf(s);
                  const f = i >= 0 ? nextFree(free[i]?.data, clock) : null;
                  const lacks = chosen.filter((c) => !s.services.includes(c.id)).map((c) => c.name);
                  const status =
                    i < 0 ? `Doesn't do ${lacks.join(', ') || 'these here'}` : free[i]?.isLoading ? 'Checking…' : free[i]?.isError ? 'Could not check' : f ? (freeNow(f, clock) ? 'Free now' : `Free ${f.label}`) : 'Not free that day';
                  return (
                    <button
                      key={s.id}
                      type="button"
                      role="radio"
                      aria-checked={stylistId === s.id}
                      disabled={i < 0}
                      onClick={() => {
                        setStylistId(s.id);
                        setSlot(null);
                        setOffer(null);
                        fresh();
                      }}
                      className={cx('flex min-h-11 w-full items-center gap-3 rounded-[10px] border px-3 text-left disabled:opacity-50', stylistId === s.id ? 'border-primary bg-selection' : 'border-line bg-surface')}
                    >
                      <span className={cx('min-w-0 flex-1 truncate text-[13.5px]', i >= 0 ? 'font-bold text-ink' : 'text-ink-2')}>{s.name}</span>
                      <span className={cx('text-[12.5px]', i >= 0 && f && freeNow(f, clock) ? 'font-bold text-success' : 'text-ink-3')}>{status}</span>
                    </button>
                  );
                })}
            </div>
          ) : null}

          {chosen.length > 0 ? (
            <div className="mt-3 flex items-baseline justify-between border-t border-line pt-3">
              <span className="text-[13px] text-ink-2">Total</span>
              <span className="text-[18px] font-extrabold text-ink tabular-nums">{quote.data ? amount(quote.data.total, quote.data.currency) : quote.isError ? '—' : '…'}</span>
            </div>
          ) : null}
          {quote.data && quote.data.deposit.due > 0 ? (
            <p className="mt-1 text-[12.5px] text-warning">
              Deposit asked: {amount(quote.data.deposit.due, quote.data.currency)}
              {quote.data.deposit.reason ? ` — ${quote.data.deposit.reason}` : ''}
            </p>
          ) : null}
        </Card>

        {later ? (
          <Card title="When">
            <div className="flex items-end gap-2">
              <TextField
                label="Day"
                type="date"
                className="flex-1"
                value={date}
                min={today}
                onChange={(e) => {
                  setDate(e.target.value || today);
                  setSlot(null);
                }}
              />
              <Button
                size="md"
                onClick={() => {
                  setDate(addDays(date, 1));
                  setSlot(null);
                }}
              >
                Next day
              </Button>
            </div>
            <p className="mt-1 text-[12.5px] text-ink-3">{longDay(date)}</p>
            {!stylist ? (
              <p className="mt-2 text-[13px] text-ink-2">Choose a stylist to see their free times.</p>
            ) : !stylistDay ? (
              free[stylistIndex]?.isError ? <Failed text="Could not check the diary just now — this is not a full day." onRetry={() => void free[stylistIndex]?.refetch()} /> : <Spinner label="Checking free times…" />
            ) : slots.length === 0 ? (
              <p className="mt-2 text-[13px] text-ink-2">{firstName(stylist.name)} has no free time that day. Try the next day, or another stylist.</p>
            ) : (
              <div role="radiogroup" aria-label="Start time" className="mt-2 grid grid-cols-4 gap-2">
                {slots.map((s) => (
                  <button
                    key={s.starts_at}
                    type="button"
                    role="radio"
                    aria-checked={slot === s.starts_at}
                    onClick={() => {
                      setSlot(s.starts_at);
                      fresh();
                    }}
                    className={cx('h-10 rounded-[8px] border text-[13.5px] font-bold tabular-nums', slot === s.starts_at ? 'border-primary bg-primary text-white' : 'border-line bg-surface text-ink hover:bg-subtle')}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            )}
          </Card>
        ) : null}

        {offer ? (
          <Note tone="warning" action={<Button variant="primary" size="sm" loading={busy} onClick={() => void book(offer.starts_at)}>Book {offer.label}</Button>}>
            Nearest free: {offer.label}
          </Note>
        ) : null}

        <div className="flex gap-2.5">
          {!later ? (
            <>
              <Button size="lg" className="flex-1" disabled={!ready} onClick={() => setLater(true)}>
                Book a later slot
              </Button>
              <Button variant="primary" size="lg" className="flex-1" loading={busy} disabled={!ready || !desk.may('salon.visit.checkin')} onClick={() => void startNow()}>
                Start now
              </Button>
            </>
          ) : (
            <>
              {!bookingFirst ? (
                <Button
                  size="lg"
                  className="flex-1"
                  onClick={() => {
                    setLater(false);
                    setSlot(null);
                  }}
                >
                  Start now instead
                </Button>
              ) : null}
              <Button variant="primary" size="lg" className="flex-1" loading={busy} disabled={!ready || !slot} onClick={() => slot && void book(slot)}>
                {slot && stylist ? `Book ${slots.find((s) => s.starts_at === slot)?.label ?? ''} with ${firstName(stylist.name)}` : 'Book'}
              </Button>
            </>
          )}
        </div>
        {!later && stylist && client ? (
          <p className="text-[12.5px] text-ink-3">
            Start now books {now || !firstFree ? 'now' : firstFree.label} with {firstName(stylist.name)}, checks {firstName(client.name)} in and starts the service.
          </p>
        ) : null}
      </div>

      {gate && client ? (
        <AllergyGate
          title={`${client.name} has an allergy on file`}
          sub={`Read before starting · ${chosen.map((s) => s.name).join(', ')}${stylist ? ` with ${stylist.name}` : ''}`}
          allergies={gate.allergies}
          patchTests={[]}
          missing={gate.missing_patch}
          statement={STATEMENT}
          gate={gate.message ? gate : null}
          busy={busy}
          confirmLabel={`Start ${firstName(client.name)} now`}
          onClose={() => setGate(null)}
          onConfirm={(extra) => void startNow(extra)}
        />
      ) : null}
    </div>
  );
}

/** Find the client, or add them (CTR-01, CTR-02): name, mobile or email, on partial input. */
function FindClient({ onChosen }: { onChosen: (c: Chosen) => void }) {
  const desk = useDesk();
  const [term, setTerm] = useState('');
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [mobile, setMobile] = useState('');
  const [candidates, setCandidates] = useState<ClientCandidate[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(attemptKey);
  const t = term.trim();
  const q = useQuery({ queryKey: K.clients(desk.org, t), queryFn: ({ signal }) => fetchClients(desk.org, t, 8, signal), enabled: t.length >= 2 });

  async function add(confirmNew = false) {
    const n = name.trim();
    if (!n) return;
    setBusy(true);
    try {
      const r = await addClient(desk.org, { name: n, mobile: mobile.trim() || undefined, ...(confirmNew ? { confirm_new: true } : {}) }, key);
      toast('success', r.message || 'Client added.');
      onChosen({ id: r.data.client.id, name: r.data.client.name, phone: r.data.client.phone, note: 'new client', allergy: null });
    } catch (e) {
      if (answered(e)) setKey(attemptKey());
      const d = refusal(e);
      if (d.candidates?.length) setCandidates(d.candidates);
      else toast('error', e instanceof Error ? e.message : 'The client could not be added.');
    } finally {
      setBusy(false);
    }
  }

  if (adding) {
    return (
      <div className="flex flex-col gap-3">
        <h2 className="text-[15px] font-bold text-ink">New client</h2>
        <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        <TextField label="Mobile" hint="077 123 4567 — or leave it empty." inputMode="tel" value={mobile} onChange={(e) => setMobile(e.target.value)} />
        {candidates ? (
          <div className="flex flex-col gap-2 rounded-[10px] border border-warning/30 bg-warning-bg p-3">
            <p className="text-[13px] font-semibold text-warning">WorkSuite already knows somebody with these details. Is it one of them?</p>
            {candidates.map((c) => (
              <button key={c.id} type="button" onClick={() => onChosen({ id: c.id, name: c.name, phone: c.phone, allergy: null })} className="rounded-[8px] border border-line bg-surface px-3 py-2 text-left hover:bg-subtle">
                <Person name={c.name} sub={c.phone ?? c.email ?? undefined} size={26} />
              </button>
            ))}
            <Button size="sm" loading={busy} onClick={() => void add(true)}>
              No — add a new client anyway
            </Button>
          </div>
        ) : null}
        <div className="flex gap-2">
          <Button
            onClick={() => {
              setAdding(false);
              setCandidates(null);
            }}
          >
            Back
          </Button>
          <Button variant="primary" icon="user-plus" loading={busy} disabled={name.trim() === '' || !desk.may('salon.client.edit')} onClick={() => void add()}>
            Add client
          </Button>
        </div>
      </div>
    );
  }

  const rows = q.data?.items ?? [];

  return (
    <div className="flex flex-col gap-2.5">
      <TextField label="Client" placeholder="Name, mobile or email" value={term} onChange={(e) => setTerm(e.target.value)} />
      {t.length >= 2 ? (
        q.isError ? (
          <Failed text="Clients could not be searched." onRetry={() => void q.refetch()} />
        ) : q.isLoading ? (
          <Spinner label="Searching clients…" />
        ) : rows.length === 0 ? (
          <p className="text-[13px] text-ink-2">Nobody matches “{t}”.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {rows.map((c) => (
              <li key={c.id}>
                <button type="button" onClick={() => onChosen({ id: c.id, name: c.name, phone: c.phone, allergy: c.allergy, note: c.tier })} className="w-full rounded-[8px] border border-line bg-surface px-3 py-2 text-left hover:bg-subtle">
                  <Person name={c.name} sub={c.phone ?? undefined} size={26} trailing={c.allergy ? <Chip tone="danger">Allergy</Chip> : null} />
                </button>
              </li>
            ))}
          </ul>
        )
      ) : null}
      <Button
        icon="user-plus"
        disabled={!desk.may('salon.client.edit')}
        onClick={() => {
          setAdding(true);
          setName(/\d/.test(t) ? '' : t);
          setMobile(/\d/.test(t) ? t : '');
        }}
      >
        New client
      </Button>
    </div>
  );
}

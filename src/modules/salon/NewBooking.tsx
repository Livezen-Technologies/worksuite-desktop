import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { SalonOutboxInput } from '@shared/types';
import { Icon } from '../../components/Icon';
import { Modal, Spinner, cx } from '../../components/ui';
import { ApiError } from '../../core/api';
import { toast } from '../../core/toasts';
import { addDays, amount, answered, attemptKey, bookAt, capable, clockAt, fetchAvailability, fetchQuote, K, longDay, refusal, todayAt, type StartOption } from './api';
import { ClientBox, FindClient, useSeededClient } from './ClientPick';
import { keep, localId, SK, syncNow } from './offline';
import { Failed, firstName, Label, Note, Page, Panel, seedOf, TouchButton, useDesk, useNow, Who } from './parts';
import { Categories, ServiceGrid, ServiceSearch, useMenu } from './WalkIn';

/**
 * A booking made at the counter, by touch (D16, CTR-03…06): the client, the
 * services back to back — each with a stylist who does it, or whoever is
 * free — a day, and a time from the same availability check every booking
 * uses. Times that are taken are shown struck through; the chain WorkSuite
 * offers for a time ("Kasun, then Nadeesha") is what is booked.
 *
 * A client on the watch list is asked for a deposit: "Book · take deposit"
 * books and opens the deposit at once; the visit stays Pending until it is
 * taken.
 *
 * WITH WORKSUITE OUT OF REACH a booking is kept to send, at a time typed on
 * the salon's clock, with each service's stylist named; WorkSuite checks the
 * diary when it answers and offers the nearest time if this one is taken.
 */
interface Line {
  service_id: number;
  provider: number | 'any';
}

const DAYS_SHOWN = 6;

export default function NewBooking() {
  const desk = useDesk();
  const qc = useQueryClient();
  const seed = seedOf(desk.params);
  const loc = desk.location.id;
  const tz = desk.location.timezone;
  const menu = useMenu();
  const clock = useNow();
  const today = todayAt(tz, new Date(clock));
  const offline = desk.offline;
  const canKeep = desk.sync?.can_write === true;

  const { client, setClient, loading } = useSeededClient(seed);
  const [lines, setLines] = useState<Line[]>(() =>
    (seed.service_ids ?? [])
      .filter((id) => menu.some((s) => s.id === id))
      .map((id) => ({ service_id: id, provider: seed.provider_id && capable(desk.options.stylists, [id], loc).some((s) => s.id === seed.provider_id) ? seed.provider_id : 'any' })),
  );
  const [date, setDate] = useState(seed.date && seed.date >= today ? seed.date : today);
  /* The day strip opens on today when the day asked for is on it. */
  const [first, setFirst] = useState(() => (date < addDays(today, DAYS_SHOWN) ? today : date));
  const [picked, setSlot] = useState<string | null>(null);
  /* A time tapped on the calendar is chosen until anything about the booking changes. */
  const [touched, setTouched] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [busy, setBusy] = useState<'book' | 'deposit' | null>(null);
  const [key, setKey] = useState(attemptKey);
  const [offer, setOffer] = useState<{ starts_at: string; label: string } | null>(null);
  /* Offline: the time as the salon's clock says it, "14:30". */
  const [at, setAt] = useState('');

  const items = JSON.stringify(lines.map((l) => ({ service_id: l.service_id, provider_id: l.provider })));
  const day = useQuery({ queryKey: K.availability(loc, date, items), queryFn: ({ signal }) => fetchAvailability(loc, date, items, signal), enabled: lines.length > 0 && !offline, staleTime: 15_000 });
  const quote = useQuery({ queryKey: K.quote(loc, client?.id ?? 0, items), queryFn: ({ signal }) => fetchQuote(loc, client?.id || null, items, signal), enabled: lines.length > 0 && !offline });
  const starts = (day.data?.starts ?? []).filter((s) => date > today || Date.parse(s.starts_at) >= clock - 5 * 60_000);
  const slot = picked ?? (!touched && seed.time ? (starts.find((s) => s.free && s.label === seed.time)?.starts_at ?? null) : null);
  const chosen: StartOption | null = starts.find((s) => s.starts_at === slot && s.free) ?? null;

  const svc = (id: number) => menu.find((s) => s.id === id);
  const stylist = (id: number | 'any' | undefined) => (typeof id === 'number' ? desk.options.stylists.find((s) => s.id === id) : undefined);
  const lineMinutes = (i: number) => quote.data?.lines[i]?.duration_min ?? svc(lines[i]!.service_id)?.duration_min ?? 0;
  const linePrice = (i: number) => quote.data?.lines[i]?.price ?? svc(lines[i]!.service_id)?.price ?? 0;
  const total = quote.data?.total ?? lines.reduce((t, _l, i) => t + linePrice(i), 0);
  const deposit = quote.data?.deposit.due ?? 0;
  /* Who does each service: the line's own choice, or the chain WorkSuite offered for the chosen time. */
  const who = (i: number) => (lines[i]!.provider !== 'any' ? lines[i]!.provider : (chosen?.chain[i]?.provider_id ?? 'any'));
  const span = chosen && chosen.chain.length ? Math.round((Date.parse(chosen.chain[chosen.chain.length - 1]!.starts_at) + lineMinutes(chosen.chain.length - 1) * 60_000 - Date.parse(chosen.starts_at)) / 60_000) : lines.reduce((t, _l, i) => t + lineMinutes(i), 0);
  const names = [...new Set(lines.map((_l, i) => who(i)).map((p) => (p === 'any' ? 'whoever is free' : firstName(stylist(p)?.name ?? ''))))].filter(Boolean);

  /* A different booking is a different attempt: any change to it gets a new key. */
  const fresh = () => {
    setKey(attemptKey());
    setOffer(null);
  };
  const changed = () => {
    fresh();
    setTouched(true);
  };
  const pickDay = (d: string) => {
    setDate(d);
    setSlot(null);
    changed();
  };

  function failed(e: unknown) {
    if (e instanceof ApiError && e.offline) void syncNow().catch(() => undefined);
    if (answered(e)) {
      changed();
      const d = refusal(e);
      toast('error', e instanceof Error ? e.message : 'That did not go through.');
      if (d.next?.starts_at) setOffer({ starts_at: d.next.starts_at, label: d.next.label });
      void qc.invalidateQueries({ queryKey: ['salon', 'availability'] });
    } else {
      toast('error', 'WorkSuite did not answer. Press Book again — it is the same booking, never a second.');
    }
  }

  async function book(startsAt: string, takeDeposit: boolean, chain: StartOption['chain'] | null) {
    if (!client) return;
    setBusy(takeDeposit ? 'deposit' : 'book');
    try {
      const body = {
        location_id: loc,
        client_id: client.id,
        desk_id: desk.desk.id,
        items: lines.map((l, i) => ({ service_id: l.service_id, provider_id: l.provider !== 'any' ? l.provider : (chain?.[i]?.provider_id ?? 'any') })) as Array<{ service_id: number; provider_id: number }>,
      };
      const r = await bookAt(body, startsAt, true, key);
      toast('success', r.message || 'Booked.');
      void qc.invalidateQueries({ queryKey: K.all });
      const visit = r.data.visit;
      desk.go('calendar', { date: visit?.date ?? date });
      if (takeDeposit && visit) desk.deposit(visit);
    } catch (e) {
      failed(e);
    } finally {
      setBusy(null);
    }
  }

  /** Keep the booking for when WorkSuite answers: the new client first, when there is one, then the visit. */
  async function keepIt() {
    if (!client) return;
    setBusy('book');
    try {
      const whoId = client.local ? `local:${client.local}` : client.id;
      const visit = localId('V');
      const what = lines.map((l) => `${svc(l.service_id)?.name ?? 'Service'} with ${firstName(stylist(l.provider)?.name ?? '')}`).join(', then ');
      const inputs: SalonOutboxInput[] = [];
      if (client.local) {
        inputs.push({ kind: 'client.create', local_id: client.local, payload: { name: client.name, ...(client.mobile ? { mobile: client.mobile } : {}) }, label: `New client: ${client.name}`, detail: client.mobile ?? null });
      }
      inputs.push({
        kind: 'visit.book',
        local_id: visit,
        payload: { client_id: whoId, starts_at: `${date} ${at}`, items: lines.map((l) => ({ service_id: l.service_id, provider_id: l.provider })) },
        label: `Booking: ${client.name}`,
        detail: `${longDay(date)} ${at} · ${what}`,
      });
      await keep(inputs);
      toast('success', `${client.name}’s booking is kept, and goes to WorkSuite when it answers.`);
      void qc.invalidateQueries({ queryKey: SK.all });
      desk.go('today');
    } catch (e) {
      toast('error', e instanceof Error ? e.message : 'That could not be kept on this computer.');
    } finally {
      setBusy(null);
    }
  }

  const canBook = desk.may('salon.visit.book') && (!offline || canKeep) && (!client?.local || desk.may('salon.client.edit'));
  const ready = !!client && lines.length > 0 && canBook && lines.every((_l, i) => capable(desk.options.stylists, [lines[i]!.service_id], loc).length > 0);
  const atValid = /^\d{2}:\d{2}$/.test(at) && (date > today || at >= clockAt(new Date(clock).toISOString(), tz));
  const strip = Array.from({ length: DAYS_SHOWN }, (_, i) => addDays(first, i));

  return (
    <Page
      title="New booking"
      sub={offline ? 'Kept here, and WorkSuite checks the time when it answers.' : deposit > 0 ? 'Starts as Pending until the deposit is taken' : 'Times come from the same check as every booking.'}
    >
      {offline && !canKeep ? <Note tone="warning">{desk.sync?.why_not ?? 'This computer cannot keep changes to send later.'}</Note> : null}
      <div className="flex flex-col gap-3.5 xl:flex-row xl:items-start">
        <Panel className="flex min-w-0 flex-1 flex-col gap-3">
          <Label>Client</Label>
          {client ? (
            <ClientBox
              framed
              client={client}
              onChange={() => {
                setClient(null);
                fresh();
              }}
            />
          ) : loading ? (
            <Spinner label="Loading the client…" />
          ) : (
            <FindClient
              onChosen={(c) => {
                setClient(c);
                fresh();
              }}
            />
          )}
          {quote.data && deposit > 0 ? (
            <div className="rounded-[12px] border border-[#FDE68A] bg-[#FFFBEB] px-3 py-2.5 text-[13px] text-[#92400E] dark:border-[var(--ws-note-line)] dark:bg-warning-bg dark:text-warning-ink">
              {quote.data.deposit.reason ? `${quote.data.deposit.reason} · ` : ''}
              <b>{amount(deposit, quote.data.currency)} deposit</b> asked
            </div>
          ) : null}

          <Label className="mt-1">Services · back to back</Label>
          <div className="flex flex-col gap-2">
            {lines.map((l, i) => {
              const s = svc(l.service_id);
              const able = capable(desk.options.stylists, [l.service_id], loc);
              const p = stylist(who(i));
              const step = chosen?.chain[i];
              const end = step ? clockAt(new Date(Date.parse(step.starts_at) + lineMinutes(i) * 60_000).toISOString(), tz) : null;
              return (
                <div key={`${l.service_id}-${i}`} className="rounded-[14px] border border-line bg-surface">
                  <div className="flex items-center gap-3 px-3.5 py-3">
                    <Icon name="scissors" size={18} className="shrink-0 text-ink-2" />
                    <button type="button" aria-expanded={editing === i} onClick={() => setEditing(editing === i ? null : i)} className="min-w-0 flex-1 text-left">
                      <div className="truncate text-[16px] font-bold text-ink">{s?.name ?? 'Service'}</div>
                      <div className="truncate text-[12.5px] text-ink-2">
                        {p ? `${p.name}${p.tier?.name ? ` · ${p.tier.name}${p.tier.multiplier && p.tier.multiplier !== 1 ? ` ×${p.tier.multiplier.toFixed(2)}` : ''}` : ''}` : able.length ? 'Whoever is free — tap to choose' : 'Nobody here does this'}
                      </div>
                    </button>
                    {step && end ? <span className="shrink-0 text-[13px] text-ink-2 tabular-nums">{`${step.label}–${end}`}</span> : null}
                    <b className="w-[100px] shrink-0 text-right text-[16px] text-ink tabular-nums">{amount(linePrice(i))}</b>
                    <button
                      type="button"
                      aria-label={`Remove ${s?.name ?? 'this service'}`}
                      onClick={() => {
                        setLines((x) => x.filter((_y, j) => j !== i));
                        setEditing(null);
                        setSlot(null);
                        changed();
                      }}
                      className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] text-ink-3 hover:bg-danger-bg hover:text-danger"
                    >
                      <Icon name="x" size={16} />
                    </button>
                  </div>
                  {editing === i ? (
                    <div role="radiogroup" aria-label={`Who does ${s?.name ?? 'it'}`} className="flex flex-wrap gap-2 border-t border-line px-3.5 py-3">
                      {[...(offline ? [] : [{ id: 'any' as const, name: 'Whoever is free', color: null }]), ...able].map((x) => (
                        <button
                          key={x.id}
                          type="button"
                          role="radio"
                          aria-checked={l.provider === x.id}
                          onClick={() => {
                            setLines((ls) => ls.map((y, j) => (j === i ? { ...y, provider: x.id } : y)));
                            setEditing(null);
                            setSlot(null);
                            changed();
                          }}
                          className={cx('flex min-h-11 items-center gap-2 rounded-full pr-4 pl-1.5 text-[14px] font-semibold', l.provider === x.id ? 'border-2 border-primary bg-selection text-primary' : 'border border-line bg-surface text-ink hover:bg-subtle')}
                        >
                          {x.id === 'any' ? <span className="grid h-8 w-8 place-items-center rounded-full bg-subtle text-ink-2"><Icon name="users" size={15} /></span> : <Who name={x.name} color={x.color} size={32} />}
                          {x.name}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
          <button type="button" disabled={lines.length >= 8} onClick={() => setAdding(true)} className="min-h-12 w-full rounded-[12px] border border-dashed border-[#C9CEDD] bg-surface text-[14px] font-bold text-primary hover:bg-subtle disabled:opacity-50 dark:border-line">
            + Add a service
          </button>
        </Panel>

        <Panel className="flex w-full flex-col gap-3 xl:w-[520px] xl:shrink-0">
          <div className="flex gap-1.5">
            <button type="button" aria-label="Earlier days" disabled={first <= today} onClick={() => setFirst(addDays(first, -DAYS_SHOWN) < today ? today : addDays(first, -DAYS_SHOWN))} className="grid w-8 shrink-0 place-items-center rounded-[10px] text-ink-2 hover:bg-subtle disabled:opacity-30">
              <Icon name="chevron-left" size={18} />
            </button>
            <div role="radiogroup" aria-label="Day" className="grid flex-1 grid-cols-6 gap-1.5">
              {strip.map((d) => {
                const on = d === date;
                const dt = new Date(`${d}T12:00:00Z`);
                return (
                  <button
                    key={d}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    aria-label={longDay(d)}
                    onClick={() => pickDay(d)}
                    className={cx('flex min-h-[60px] flex-col items-center justify-center rounded-[12px]', on ? 'bg-primary text-white' : 'border border-line bg-surface text-ink hover:bg-subtle')}
                  >
                    <span className="text-[11px]">{dt.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' })}</span>
                    <span className="text-[19px] leading-tight font-extrabold">{dt.getUTCDate()}</span>
                  </button>
                );
              })}
            </div>
            <button type="button" aria-label="Later days" onClick={() => setFirst(addDays(first, DAYS_SHOWN))} className="grid w-8 shrink-0 place-items-center rounded-[10px] text-ink-2 hover:bg-subtle">
              <Icon name="chevron-right" size={18} />
            </button>
          </div>
          <div className="text-[15px] font-bold text-ink">
            {longDay(date).replace(/ \d{4}$/, '')}
            {lines.length > 0 && names.length ? ` · ${names.join(', then ')}` : ''}
          </div>

          {lines.length === 0 ? (
            <p className="text-[14px] text-ink-2">Add a service to see the free times.</p>
          ) : offline ? (
            <label className="flex flex-col gap-1">
              <span className="text-[12.5px] font-semibold text-ink-2">Time, on the salon’s clock</span>
              <input
                type="time"
                step={300}
                value={at}
                onChange={(e) => {
                  setAt(e.target.value);
                  changed();
                }}
                className="h-12 rounded-[12px] border border-line bg-surface px-3.5 text-[16px] text-ink outline-none focus:border-primary"
              />
              <span className="text-[12.5px] text-ink-2">WorkSuite checks the diary when it answers, and offers the nearest time if this one is taken. Each service needs its stylist named.</span>
            </label>
          ) : day.isError ? (
            <Failed text="Could not check the diary just now — this is not a full day." onRetry={() => void day.refetch()} />
          ) : !day.data ? (
            <Spinner label="Checking free times…" />
          ) : starts.length === 0 ? (
            <p className="text-[14px] text-ink-2">No time left that day. Try another day, or other stylists.</p>
          ) : (
            <>
              <div role="radiogroup" aria-label="Start time" className="grid max-h-[270px] grid-cols-4 gap-1.5 overflow-y-auto pr-0.5 scroll-thin">
                {starts.map((s) => (
                  <button
                    key={s.starts_at}
                    type="button"
                    role="radio"
                    aria-checked={slot === s.starts_at}
                    disabled={!s.free}
                    onClick={() => {
                      setSlot(s.starts_at);
                      changed();
                    }}
                    className={cx(
                      'rounded-[8px] py-[13px] text-[16px] tabular-nums',
                      !s.free ? 'border border-dashed border-line bg-[#F8FAFC] text-[#94A3B8] line-through dark:bg-subtle dark:text-ink-3' : slot === s.starts_at ? 'border border-primary bg-primary font-bold text-white' : 'border border-[#CBD5E1] bg-surface text-ink hover:bg-subtle dark:border-line',
                    )}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
              <p className="text-[12.5px] text-ink-2">Checked just now — and again when you press Book.</p>
            </>
          )}

          {offer ? (
            <Note
              tone="warning"
              action={
                <TouchButton variant="primary" className="min-h-10 text-[13px]" loading={busy !== null} onClick={() => void book(offer.starts_at, false, null)}>
                  Book {offer.label}
                </TouchButton>
              }
            >
              Taken in the meantime. Nearest free: {offer.label}
            </Note>
          ) : null}

          <div className="border-t border-dashed border-line pt-3">
            <div className="flex items-baseline justify-between gap-3 py-[3px] text-[18px]">
              <span className="text-ink-2">Total · {hours(span)} in the salon</span>
              <span className="font-extrabold text-ink tabular-nums">{offline ? `about ${amount(total, desk.currency)}` : amount(total, quote.data?.currency ?? desk.currency)}</span>
            </div>
            {deposit > 0 ? (
              <div className="flex items-baseline justify-between gap-3 py-[3px] text-[15px]">
                <span className="text-ink-2">Deposit asked</span>
                <span className="font-semibold text-warning tabular-nums">{amount(deposit, quote.data?.currency ?? desk.currency)}</span>
              </div>
            ) : null}
          </div>

          <div className="flex gap-2.5">
            {offline ? (
              <TouchButton variant="primary" icon="check" className="flex-1" loading={busy !== null} disabled={!ready || !atValid || lines.some((l) => l.provider === 'any')} onClick={() => void keepIt()}>
                {atValid ? `Keep: ${at}` : 'Keep the booking'}
              </TouchButton>
            ) : (
              <>
                {deposit > 0 && desk.may('salon.checkout') ? (
                  <TouchButton icon="wallet" className="flex-1" loading={busy === 'deposit'} disabled={!ready || !chosen || busy !== null} onClick={() => chosen && void book(chosen.starts_at, true, chosen.chain)}>
                    Book · take deposit
                  </TouchButton>
                ) : null}
                <TouchButton variant="primary" icon="check" className="flex-1" loading={busy === 'book'} disabled={!ready || !chosen || busy !== null} onClick={() => chosen && void book(chosen.starts_at, false, chosen.chain)}>
                  Book {lines.length === 1 ? (chosen ? chosen.label : '') : `${lines.length} services`}
                </TouchButton>
              </>
            )}
          </div>
        </Panel>
      </div>

      {adding ? (
        <AddService
          onClose={() => setAdding(false)}
          onAdd={(ids) => {
            setLines((ls) =>
              [
                ...ls,
                ...ids.map((id) => {
                  const able = capable(desk.options.stylists, [id], loc);
                  const asked = seed.provider_id && able.some((x) => x.id === seed.provider_id) ? seed.provider_id : null;
                  return { service_id: id, provider: asked ?? (offline ? (able[0]?.id ?? ('any' as const)) : ('any' as const)) };
                }),
              ].slice(0, 8),
            );
            setAdding(false);
            fresh();
          }}
        />
      ) : null}
    </Page>
  );
}

/** "4 h", "1 h 30 min", "45 min". */
export function hours(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** The menu, to add services to the booking. */
function AddService({ onClose, onAdd }: { onClose: () => void; onAdd: (ids: number[]) => void }) {
  const desk = useDesk();
  const menu = useMenu();
  const [category, setCategory] = useState('all');
  const [find, setFind] = useState('');
  const [picked, setPicked] = useState<number[]>([]);
  const shown = menu.filter((s) => (category === 'all' || s.category === category) && (find.trim() === '' || s.name.toLowerCase().includes(find.trim().toLowerCase())));
  return (
    <Modal title="Add a service" width={960} onClose={onClose}>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <Categories value={category} onChange={setCategory} names={desk.options.menu.filter((c) => c.services.length > 0).map((c) => c.name)} />
          </div>
          <ServiceSearch value={find} onChange={setFind} />
        </div>
        <div className="max-h-[52vh] overflow-y-auto scroll-thin">
          <ServiceGrid services={shown} picked={picked} onToggle={(id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))} empty="No service matches." />
        </div>
        <div className="flex justify-end gap-2.5">
          <TouchButton onClick={onClose}>Cancel</TouchButton>
          <TouchButton variant="primary" icon="plus" disabled={picked.length === 0} onClick={() => onAdd(picked)}>
            Add {picked.length > 1 ? `${picked.length} services` : 'to the booking'}
          </TouchButton>
        </div>
      </div>
    </Modal>
  );
}

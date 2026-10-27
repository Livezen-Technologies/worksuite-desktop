import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import type { SalonOutboxInput } from '@shared/types';
import { Icon } from '../../components/Icon';
import { Spinner, cx } from '../../components/ui';
import { ApiError } from '../../core/api';
import { toast } from '../../core/toasts';
import {
  amount,
  answered,
  atLeast,
  attemptKey,
  bookAt,
  capable,
  clockAt,
  fetchAvailability,
  fetchQuote,
  freeNow,
  K,
  nextFree,
  refusal,
  startWalkIn,
  STATEMENT,
  todayAt,
  type CheckInExtra,
  type Gate,
  type Service,
} from './api';
import { AllergyGate } from './CheckIn';
import { ClientBox, FindClient, useSeededClient } from './ClientPick';
import { keep, localId, SK, syncNow } from './offline';
import { firstName, Label, Note, Page, Panel, seedOf, TouchButton, useDesk, useNow, Who } from './parts';

/**
 * A walk-in at the counter (D04, CTR-01…06): who, which services, which
 * stylist — then start now, or book a later slot (the booking screen, with
 * all of this carried over).
 *
 * THE COUNTER HOLDS NO SCHEDULING OF ITS OWN (CTR-05). Only stylists who do
 * every chosen service are offered (CTR-04); when each is next free comes from
 * the availability check every booking uses, and the price from the server's
 * quote. "Start now" is one request — booked, checked in through the allergy
 * gate, and started — sent under a key made for this attempt, so a second
 * press after a dropped connection is the same walk-in (CTR-06).
 *
 * WITH WORKSUITE OUT OF REACH the desk still takes the walk-in (OFF-03): the
 * client from the day's copy or a new one, the services, a stylist who does
 * them, and "start now". It is kept — new client, visit, check-in, in that
 * order — and sent when the line is back, where the availability check and
 * the allergy gate run again. Nobody's diary is guessed at here: whether the
 * stylist is free is WorkSuite's to say, then.
 */
export type MenuService = Service & { category: string };

export function useMenu(): MenuService[] {
  const desk = useDesk();
  return useMemo(() => desk.options.menu.flatMap((c) => c.services.filter((s) => s.active !== false).map((s) => ({ ...s, category: c.name }))), [desk.options.menu]);
}

export default function WalkIn() {
  const desk = useDesk();
  const qc = useQueryClient();
  const seed = seedOf(desk.params);
  const loc = desk.location.id;
  const services = useMenu();
  const clock = useNow();
  const today = todayAt(desk.location.timezone, new Date(clock));
  const offline = desk.offline;

  const { client, setClient, loading } = useSeededClient(seed);
  const [picked, setPicked] = useState<number[]>(() => (seed.service_ids ?? []).filter((id) => services.some((s) => s.id === id)));
  const [stylistId, setStylistId] = useState<number | null>(seed.provider_id ?? null);
  const [category, setCategory] = useState('all');
  const [find, setFind] = useState('');
  const [busy, setBusy] = useState(false);
  const [gate, setGate] = useState<Gate | null>(null);
  const [key, setKey] = useState(attemptKey);
  const [offer, setOffer] = useState<{ starts_at: string; label: string } | null>(null);
  const canKeep = desk.sync?.can_write === true;

  const chosen = picked.map((id) => services.find((s) => s.id === id)).filter((s): s is MenuService => !!s);
  const categories = desk.options.menu.filter((c) => c.services.length > 0);
  const shown = services.filter((s) => (category === 'all' || s.category === category) && (find.trim() === '' || s.name.toLowerCase().includes(find.trim().toLowerCase())));
  const able = capable(desk.options.stylists, picked, loc);
  const stylist = able.find((s) => s.id === stylistId) ?? null;
  const items = stylist ? chosen.map((s) => ({ service_id: s.id, provider_id: stylist.id })) : [];

  /* When each capable stylist is next free today, from the shared availability check. */
  const free = useQueries({
    queries: able.slice(0, 8).map((s) => {
      const asked = JSON.stringify(chosen.map((c) => ({ service_id: c.id, provider_id: s.id })));
      return { queryKey: K.availability(loc, today, asked), queryFn: ({ signal }: { signal: AbortSignal }) => fetchAvailability(loc, today, asked, signal), enabled: chosen.length > 0 && !offline, staleTime: 30_000 };
    }),
  });
  const quoteItems = JSON.stringify(chosen.map((s) => ({ service_id: s.id, provider_id: stylist?.id ?? 'any' })));
  const quote = useQuery({ queryKey: K.quote(loc, client?.id ?? 0, quoteItems), queryFn: ({ signal }) => fetchQuote(loc, client?.id || null, quoteItems, signal), enabled: chosen.length > 0 && !offline });
  /* Offline, the menu's own prices: WorkSuite's quote (a tier's price, a deposit) comes with the visit. */
  const listTotal = chosen.reduce((t, s) => t + (s.price ?? 0), 0);
  const minutes = quote.data ? quote.data.lines.reduce((t, l) => t + l.duration_min, 0) : chosen.reduce((t, s) => t + s.duration_min, 0);

  const stylistIndex = stylist ? able.findIndex((s) => s.id === stylist.id) : -1;
  const stylistDay = stylistIndex >= 0 ? free[stylistIndex]?.data : undefined;
  const firstFree = nextFree(stylistDay, clock);
  const now = freeNow(firstFree, clock);

  /* A different walk-in is a different attempt: any change to it gets a new key. */
  const fresh = () => setKey(attemptKey());
  const toggle = (id: number) => {
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
    setOffer(null);
    fresh();
  };

  function failed(e: unknown, again: string) {
    if (e instanceof ApiError && e.offline) void syncNow().catch(() => undefined);
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

  /** Keep the walk-in for when WorkSuite answers: the new client first, then the visit and its check-in. */
  async function keepIt(extra: CheckInExtra) {
    if (!client || !stylist) return;
    setBusy(true);
    try {
      const who = client.local ? `local:${client.local}` : client.id;
      const visit = localId('V');
      const what = `${chosen.map((s) => s.name).join(', ')} with ${firstName(stylist.name)}`;
      const inputs: SalonOutboxInput[] = [];
      if (client.local) {
        inputs.push({ kind: 'client.create', local_id: client.local, payload: { name: client.name, ...(client.mobile ? { mobile: client.mobile } : {}) }, label: `New client: ${client.name}`, detail: client.mobile ?? null });
      }
      inputs.push({ kind: 'visit.book', local_id: visit, payload: { client_id: who, starts_at: 'now', items }, label: `Walk-in: ${client.name}`, detail: what });
      inputs.push({ kind: 'visit.check_in', payload: { visit_id: `local:${visit}`, ...extra }, label: `Check-in: ${client.name}`, detail: what });
      await keep(inputs);
      setGate(null);
      toast('success', `${client.name}’s walk-in is kept, and goes to WorkSuite when it answers.`);
      void qc.invalidateQueries({ queryKey: SK.all });
      desk.go('today');
    } catch (e) {
      toast('error', e instanceof Error ? e.message : 'That could not be kept on this computer.');
    } finally {
      setBusy(false);
    }
  }

  /* Offline "start now": the allergy on file is read out here first, as online. */
  function startOffline() {
    if (!client) return;
    const a = client.allergy;
    if (a && atLeast(a.severity, desk.options.ack_severity ?? 'moderate')) {
      setGate({ ok: false, code: 'ack_required', message: '', allergies: [{ id: 0, substance: a.substance, severity: a.severity, reaction: null, withdrawn_at: null }], missing_patch: [] });
    } else {
      void keepIt({});
    }
  }

  async function startNow(extra: CheckInExtra = {}) {
    if (!client || !stylist) return;
    if (offline) {
      await keepIt(extra);
      return;
    }
    setBusy(true);
    try {
      const r = await startWalkIn({ location_id: loc, client_id: client.id, items, desk_id: desk.desk.id }, extra, key);
      setGate(null);
      void qc.invalidateQueries({ queryKey: K.all });
      if (r.data.gate && r.data.visit) {
        /* Booked, but the check-in still needs something: the same panel as any check-in. */
        toast('warning', r.message ?? 'Booked — the check-in needs you.');
        desk.checkIn(r.data.visit);
      } else {
        toast('success', r.message || 'Started now.');
      }
      desk.go('today');
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

  /** Taken in the meantime: the nearest free time, as a walk-in that comes back then. */
  async function takeOffer(startsAt: string) {
    if (!client || !stylist) return;
    setBusy(true);
    try {
      const r = await bookAt({ location_id: loc, client_id: client.id, items, desk_id: desk.desk.id }, startsAt, false, key);
      toast('success', r.message || 'Booked.');
      void qc.invalidateQueries({ queryKey: K.all });
      desk.go('today');
    } catch (e) {
      failed(e, 'Book');
    } finally {
      setBusy(false);
    }
  }

  const later = () =>
    desk.walkIn(
      {
        ...(client?.local ? { local: { id: client.local, name: client.name, mobile: client.mobile } } : client ? { client_id: client.id } : {}),
        service_ids: picked,
        provider_id: stylist?.id,
      },
      true,
    );

  const canBook = desk.may('salon.visit.book') && (!offline || canKeep) && (!client?.local || desk.may('salon.client.edit'));
  const ready = !!client && chosen.length > 0 && !!stylist && canBook;
  const endsAt = firstFree ? clockAt(new Date(Date.parse(firstFree.starts_at) + minutes * 60_000).toISOString(), desk.location.timezone) : null;

  return (
    <Page
      title="Walk-in"
      sub={offline ? 'Pick services, then a stylist who does them. It is kept here, and WorkSuite checks the time when it answers.' : 'Pick services, then a stylist who does them. Times come from the same check as every booking.'}
      actions={<ServiceSearch value={find} onChange={setFind} />}
    >
      {offline && !canKeep ? <Note tone="warning">{desk.sync?.why_not ?? 'This computer cannot keep changes to send later.'}</Note> : null}
      <div className="flex flex-col gap-3.5 xl:flex-row xl:items-start">
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <Categories value={category} onChange={setCategory} names={categories.map((c) => c.name)} />
          <ServiceGrid services={shown} picked={picked} onToggle={toggle} empty={services.length === 0 ? 'No services are set up yet. They are added in SalonMate → Services.' : 'No service matches.'} />
        </div>

        <Panel className="flex w-full flex-col gap-3 xl:w-[440px] xl:shrink-0">
          {client ? (
            <ClientBox
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

          <div>
            <Label className="mb-1">Services</Label>
            {chosen.length === 0 ? (
              <p className="text-[14px] text-ink-2">Tap services to add them.</p>
            ) : (
              <ul>
                {chosen.map((s) => {
                  const line = quote.data?.lines.find((l) => l.service_id === s.id);
                  return (
                    <li key={s.id} className="flex items-baseline justify-between gap-3 py-[3px] text-[15px]">
                      <span className="min-w-0 truncate text-ink-2">
                        {s.name} · {line?.duration_min ?? s.duration_min} min
                      </span>
                      <span className="font-semibold text-ink tabular-nums">{amount(line ? line.price : s.price)}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {chosen.length > 0 ? (
            <div>
              <Label className="mb-1.5">Who can do it</Label>
              <div role="radiogroup" aria-label="Stylist" className="flex flex-col gap-2">
                {desk.options.stylists
                  .filter((s) => s.active !== false && (s.locations.length === 0 || s.locations.includes(loc)))
                  .map((s) => {
                    const i = able.indexOf(s);
                    const f = i >= 0 ? nextFree(free[i]?.data, clock) : null;
                    const lacks = chosen.filter((c) => !s.services.includes(c.id)).map((c) => c.category.toLowerCase());
                    const status =
                      i < 0
                        ? `Doesn't do ${[...new Set(lacks)].join(', ') || 'these here'}`
                        : offline
                          ? 'Checked when WorkSuite answers'
                          : free[i]?.isLoading
                            ? 'Checking…'
                            : free[i]?.isError
                              ? 'Could not check'
                              : f
                                ? freeNow(f, clock)
                                  ? 'Free now'
                                  : `Free ${f.label}`
                                : 'Not free today';
                    const on = stylistId === s.id;
                    return (
                      <button
                        key={s.id}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        disabled={i < 0}
                        onClick={() => {
                          setStylistId(s.id);
                          setOffer(null);
                          fresh();
                        }}
                        className={cx(
                          'flex min-h-14 w-full items-center gap-2.5 rounded-[12px] px-3 text-left',
                          i < 0 ? 'border border-dashed border-line text-ink-3' : on ? 'border-2 border-primary bg-selection' : 'border border-line bg-surface hover:bg-subtle',
                        )}
                      >
                        <Who name={s.name} color={s.color} size={32} className={i < 0 ? 'opacity-50' : undefined} />
                        <span className={cx('min-w-0 flex-1 truncate text-[15px]', i >= 0 ? 'font-bold text-ink' : 'font-medium')}>{s.name}</span>
                        <span className={cx('shrink-0 text-[13px]', i >= 0 && f && freeNow(f, clock) ? 'font-bold text-success' : i >= 0 ? 'font-semibold text-ink-2' : '')}>{status}</span>
                      </button>
                    );
                  })}
              </div>
            </div>
          ) : null}

          {chosen.length > 0 ? (
            <div className="border-t border-dashed border-line pt-3">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[18px] text-ink-2">Total · {minutes} min</span>
                <span className="text-[20px] font-extrabold text-ink tabular-nums">
                  {offline ? `about ${amount(listTotal, desk.currency)}` : quote.data ? amount(quote.data.total, quote.data.currency) : quote.isError ? '—' : '…'}
                </span>
              </div>
              {stylist && firstFree && endsAt ? (
                <p className="mt-0.5 text-[12.5px] text-ink-2">
                  {firstName(stylist.name)} is free {firstFree.label} – {endsAt} · checked just now
                </p>
              ) : null}
              {quote.data && quote.data.deposit.due > 0 ? (
                <p className="mt-0.5 text-[12.5px] font-semibold text-warning">
                  Deposit asked for a later slot: {amount(quote.data.deposit.due, quote.data.currency)}
                  {quote.data.deposit.reason ? ` — ${quote.data.deposit.reason}` : ''}
                </p>
              ) : null}
            </div>
          ) : null}

          {offer ? (
            <Note
              tone="warning"
              action={
                <TouchButton variant="primary" className="min-h-10 text-[13px]" loading={busy} onClick={() => void takeOffer(offer.starts_at)}>
                  Book {offer.label}
                </TouchButton>
              }
            >
              Taken in the meantime. Nearest free: {offer.label}
            </Note>
          ) : null}

          <div className="flex gap-2.5">
            <TouchButton icon="calendar" className="flex-1" disabled={!client || chosen.length === 0 || !canBook} onClick={later}>
              Book a later slot
            </TouchButton>
            <TouchButton variant="primary" icon="play" className="flex-1" loading={busy} disabled={!ready || !desk.may('salon.visit.checkin')} onClick={() => (offline ? startOffline() : void startNow())}>
              {offline ? 'Keep: start now' : 'Start now'}
            </TouchButton>
          </div>
          {stylist && client ? (
            <p className="text-[12.5px] text-ink-2">
              {offline
                ? `Keeps ${firstName(client.name)}’s visit with ${firstName(stylist.name)} from now, checked in. It goes to WorkSuite, as of now, when it answers.`
                : `Start now books ${now || !firstFree ? 'now' : firstFree.label} with ${firstName(stylist.name)}, checks ${firstName(client.name)} in and starts the service. Bill when done.`}
            </p>
          ) : null}
        </Panel>
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
          confirmLabel={offline ? `Keep ${firstName(client.name)}’s walk-in` : `Start ${firstName(client.name)} now`}
          onClose={() => setGate(null)}
          onConfirm={(extra) => void startNow(extra)}
        />
      ) : null}
    </Page>
  );
}

/** "Search services", at the page's right (D04). */
export function ServiceSearch({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex min-h-12 w-full items-center gap-2 rounded-[12px] border border-slate-line bg-surface px-3.5 focus-within:border-primary sm:w-[340px] dark:border-line">
      <Icon name="search" size={18} className="text-ink-3" />
      <input aria-label="Search services" placeholder="Search services" value={value} onChange={(e) => onChange(e.target.value)} className="bare-focus min-w-0 flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-ink-3" />
    </label>
  );
}

/** The menu's categories as pills, All first. */
export function Categories({ value, onChange, names, label = 'Category' }: { value: string; onChange: (v: string) => void; names: string[]; label?: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2">
      {[{ key: 'all', name: 'All' }, ...names.map((n) => ({ key: n, name: n }))].map((c) => (
        <button
          key={c.key}
          type="button"
          role="radio"
          aria-checked={value === c.key}
          onClick={() => onChange(c.key)}
          className={cx('min-h-11 rounded-full px-[18px] text-[14px] font-bold', value === c.key ? 'bg-navy text-white dark:bg-primary' : 'border border-line bg-surface text-ink hover:bg-subtle')}
        >
          {c.name}
        </button>
      ))}
    </div>
  );
}

/** The menu as big cards: name, how long, the price; chosen ones ticked. */
export function ServiceGrid({ services, picked, onToggle, empty }: { services: MenuService[]; picked: number[]; onToggle: (id: number) => void; empty: string }) {
  if (services.length === 0) return <p className="py-4 text-[14px] text-ink-2">{empty}</p>;
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
      {services.map((s) => {
        const on = picked.includes(s.id);
        return (
          <button
            key={s.id}
            type="button"
            aria-pressed={on}
            onClick={() => onToggle(s.id)}
            className={cx('relative flex min-h-[104px] flex-col justify-between rounded-[16px] p-3.5 text-left transition-colors', on ? 'border-2 border-primary bg-selection' : 'border border-line bg-surface hover:bg-subtle')}
          >
            <span className="pr-7 text-[15px] font-bold text-ink">{s.name}</span>
            {on ? (
              <span className="absolute top-3 right-3 grid h-[22px] w-[22px] place-items-center rounded-full bg-primary text-white">
                <Icon name="check" size={14} strokeWidth={2.6} />
              </span>
            ) : null}
            <span className="flex w-full items-baseline justify-between gap-2 text-[13px] text-ink-2">
              <span className="whitespace-nowrap">{s.duration_min} min</span>
              <b className="text-[15px] text-ink tabular-nums">{s.price.toLocaleString('en-US', { maximumFractionDigits: 2 })}</b>
            </span>
          </button>
        );
      })}
    </div>
  );
}

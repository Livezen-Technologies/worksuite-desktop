import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type DragEvent } from 'react';
import { toast } from '../../core/toasts';
import { Button, cx, Modal } from '../../components/ui';
import { Checkbox } from '../../components/Checkbox';
import { addDays, dayLabel, fetchDay, fetchWeek, hhmm, K, minutesIn, movable, reschedule, snap, today, weekStart, zonedInstant, type Appointment } from './api';
import { EDGE, input, Kbd, label, Refused, useDesk } from './parts';

/**
 * D02 · Calendar day (one column per stylist, their working hours shaded, a mini-month and a stylist filter) and
 * D04 · Calendar week (one stylist, seven days). Pending and Confirmed cards the person may move can be dragged; the
 * drop asks why, then the server checks the new time as it checks a new booking — a refusal leaves the card where it
 * was and says why (nothing moves on this computer until the server says it has).
 *
 * Keys while the tab is in front: ← → a day (a week in Week), D day, W week, T today, N new at the hovered time.
 */
const HOUR = 64;
const PX = HOUR / 60;

interface Drop { a: Appointment; date: string; minute: number; provider: number; providerName: string }

export default function Calendar({ date, mode, provider, active, onNav, onPrint }: {
  date: string;
  mode: 'day' | 'week';
  by?: 'stylists' | 'chairs';
  provider: number | null;
  active: boolean;
  onNav: (patch: Record<string, string | null>) => void;
  onPrint: () => void;
}) {
  const desk = useDesk();
  const qc = useQueryClient();
  const loc = desk.options?.locations.find((l) => l.id === desk.location) ?? null;
  const tz = loc?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const providers = (desk.options?.providers ?? []).filter((p) => !loc || !p.locations.length || p.locations.includes(loc.id));
  const [hidden, setHidden] = useState<Set<number>>(new Set());
  const week0 = weekStart(date);
  const weekProvider = provider ?? providers[0]?.id ?? null;

  const day = useQuery({ queryKey: K.day(loc?.id ?? 0, date), queryFn: ({ signal }) => fetchDay(loc!.id, date, signal), enabled: mode === 'day' && !!loc });
  const week = useQuery({
    queryKey: K.range({ from: week0, loc: loc?.id, provider: weekProvider }),
    queryFn: ({ signal }) => fetchWeek({ date: week0, location: loc?.id ?? null, provider: weekProvider }, signal),
    enabled: mode === 'week' && !!loc,
  });

  const [drop, setDrop] = useState<Drop | null>(null);
  const [why, setWhy] = useState('');
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || document.querySelector('[role="dialog"]')) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      const step = mode === 'week' ? 7 : 1;
      if (e.key === 'ArrowLeft') onNav({ date: addDays(date, -step) });
      else if (e.key === 'ArrowRight') onNav({ date: addDays(date, step) });
      else if (e.key === 'd' || e.key === 'D') onNav({ mode: null });
      else if (e.key === 'w' || e.key === 'W') onNav({ mode: 'week' });
      else if (e.key === 't' || e.key === 'T') onNav({ date: today(tz) });
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, date, mode, onNav, tz]);

  // The hours drawn: the earliest anyone works to the latest, 08:00–20:00 when nobody has hours that day.
  const [from, to] = (() => {
    const spans = mode === 'day' ? (day.data?.providers ?? []).flatMap((p) => p.working) : [];
    const appts = mode === 'day' ? (day.data?.appointments ?? []) : (week.data?.items ?? []);
    let lo = 8 * 60;
    let hi = 20 * 60;
    for (const [s, e] of spans) {
      lo = Math.min(lo, minutesIn(s, tz));
      hi = Math.max(hi, minutesIn(e, tz) || 1440);
    }
    for (const a of appts) {
      lo = Math.min(lo, minutesIn(a.starts_at, tz));
      hi = Math.max(hi, minutesIn(a.ends_at, tz) || 1440);
    }
    return [Math.floor(lo / 60) * 60, Math.min(1440, Math.ceil(hi / 60) * 60)];
  })();

  const minuteAt = (e: DragEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return Math.max(from, Math.min(to - 15, from + snap((e.clientY - r.top) / PX)));
  };
  const onDragStart = (e: DragEvent, a: Appointment) => {
    e.dataTransfer.setData('text/x-appointment', String(a.id));
    e.dataTransfer.effectAllowed = 'move';
    setDragging(a.id);
  };
  const dropOn = (e: DragEvent<HTMLElement>, d: string, p: { id: number; name: string }, list: Appointment[]) => {
    e.preventDefault();
    setDragging(null);
    const id = Number(e.dataTransfer.getData('text/x-appointment'));
    const a = list.find((x) => x.id === id);
    if (!a || !movable(a)) return;
    // The grab point: the card moves by its top, not by where the pointer is inside it.
    const minute = minuteAt(e);
    if (d === a.local.date && minute === minutesIn(a.starts_at, tz) && p.id === a.provider.id) return;
    setRefused(null);
    setWhy('');
    setDrop({ a, date: d, minute, provider: p.id, providerName: p.name });
  };
  const confirm = async () => {
    if (!drop) return;
    setBusy(true);
    setRefused(null);
    try {
      const r = await reschedule(drop.a.id, { starts_at: zonedInstant(drop.date, drop.minute, tz), provider_id: drop.provider, reason: why.trim() || undefined });
      toast('success', r.message || `Moved to ${dayLabel(drop.date)}, ${hhmm(drop.minute)}.`);
      setDrop(null);
      void qc.invalidateQueries({ queryKey: K.all });
    } catch (e) {
      setRefused(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const card = (a: Appointment) => {
    const top = (minutesIn(a.starts_at, tz) - from) * PX;
    const h = Math.max(22, (Date.parse(a.ends_at) - Date.parse(a.starts_at)) / 60_000) * PX;
    const can = desk.online && movable(a);
    return (
      <button
        key={a.id}
        type="button"
        draggable={can}
        onDragStart={(e) => onDragStart(e, a)}
        onDragEnd={() => setDragging(null)}
        onClick={() => desk.open(a.id)}
        title={can ? 'Drag to move' : undefined}
        className={cx('absolute right-1 left-1 overflow-hidden rounded-[8px] border border-line bg-surface px-2 py-1 text-left text-[11.5px] leading-tight shadow-sm', can ? 'cursor-grab' : 'cursor-pointer', dragging === a.id && 'opacity-40', a.status === 'no_show' && 'line-through opacity-60')}
        style={{ top, height: h - 2, boxShadow: `inset 3px 0 0 ${a.provider.color ?? EDGE[a.status] ?? '#3B5BDB'}` }}
      >
        <b className="tabular-nums">{a.local.start}</b> <span className="font-semibold text-ink">{a.customer.name}</span>
        <div className="truncate text-ink-3">{a.service.name}</div>
      </button>
    );
  };

  const column = (key: string, d: string, p: { id: number; name: string }, list: Appointment[], working: Array<[string, string]> | null) => (
    <div
      key={key}
      role="group"
      aria-label={`${p.name} · ${dayLabel(d)}`}
      className="relative min-w-[150px] flex-1 border-l border-line"
      style={{ height: (to - from) * PX }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('text/x-appointment')) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
        }
      }}
      onDrop={(e) => dropOn(e, d, p, list)}
      onDoubleClick={(e) => {
        if (e.target !== e.currentTarget || !desk.online) return;
        const r = e.currentTarget.getBoundingClientRect();
        desk.book({ date: d, start: hhmm(from + snap((e.clientY - r.top) / PX)), provider: p.id });
      }}
    >
      {/* Outside working hours is shaded; with no hours sent, nothing is shaded. */}
      {working ? <div className="pointer-events-none absolute inset-0 bg-[repeating-linear-gradient(135deg,transparent,transparent_6px,rgba(0,0,0,.035)_6px,rgba(0,0,0,.035)_12px)]" /> : null}
      {working?.map(([s, e], i) => {
        const t = (minutesIn(s, tz) - from) * PX;
        const b = ((minutesIn(e, tz) || 1440) - from) * PX;
        return <div key={i} className="pointer-events-none absolute inset-x-0 bg-surface" style={{ top: t, height: Math.max(0, b - t) }} />;
      })}
      {Array.from({ length: (to - from) / 60 }, (_, i) => <div key={i} className="pointer-events-none absolute inset-x-0 border-t border-line/60" style={{ top: i * HOUR }} />)}
      {list.map(card)}
      {drop && drop.provider === p.id && drop.date === d ? (
        <div className="pointer-events-none absolute right-1 left-1 rounded-[8px] border-2 border-dashed border-primary bg-primary/10" style={{ top: (drop.minute - from) * PX, height: drop.a.duration_min * PX }} />
      ) : null}
    </div>
  );

  const shown = providers.filter((p) => !hidden.has(p.id));
  const nowLine = date === today(tz) ? (minutesIn(new Date().toISOString(), tz) - from) * PX : null;

  return (
    <div className="flex gap-4">
      {mode === 'day' ? (
        <aside className="w-[200px] shrink-0">
          <MiniMonth date={date} onPick={(d) => onNav({ date: d })} />
          <div className="mt-4">
            <div className={label}>Location</div>
            <select className={input} value={loc?.id ?? ''} onChange={(e) => desk.setLocation(Number(e.target.value))} aria-label="Location">
              {(desk.options?.locations ?? []).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </div>
          <div className="mt-4">
            <div className={label}>{desk.options?.terms.provider ? `${desk.options.terms.provider}s` : 'Stylists'}</div>
            {providers.map((p) => (
              <label key={p.id} className="flex items-center gap-2 py-1 text-[12.5px] text-ink">
                <Checkbox checked={!hidden.has(p.id)} onChange={() => setHidden((h) => { const n = new Set(h); if (n.has(p.id)) n.delete(p.id); else n.add(p.id); return n; })} />
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: p.color ?? '#3B5BDB' }} />
                {p.name}
              </label>
            ))}
          </div>
          <p className="mt-4 text-[11px] leading-relaxed text-ink-3">N new · T today · ← → day · D day · W week · drag to move · double-click a free time to book</p>
        </aside>
      ) : null}

      <div className="min-w-0 flex-1">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Button size="sm" variant="secondary" icon="chevron-left" aria-label="Earlier" onClick={() => onNav({ date: addDays(date, mode === 'week' ? -7 : -1) })} />
          <Button size="sm" variant="secondary" onClick={() => onNav({ date: today(tz) })}>Today<Kbd>T</Kbd></Button>
          <Button size="sm" variant="secondary" icon="chevron-right" aria-label="Later" onClick={() => onNav({ date: addDays(date, mode === 'week' ? 7 : 1) })} />
          <h1 className="m-0 ml-1 flex-1 text-[17px] font-extrabold text-ink">
            {mode === 'week' ? `${dayLabel(week0, { day: 'numeric', month: 'short' })} – ${dayLabel(addDays(week0, 6), { day: 'numeric', month: 'short' })}` : dayLabel(date, { weekday: 'short', day: 'numeric', month: 'short' })}
            <span className="ml-2 text-[12px] font-medium text-ink-3">{tz}</span>
          </h1>
          {mode === 'week' ? (
            <select className={cx(input, 'w-auto')} aria-label="Stylist" value={weekProvider ?? ''} onChange={(e) => onNav({ provider: e.target.value })}>
              {providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          ) : null}
          <div role="group" aria-label="View" className="flex overflow-hidden rounded-[8px] border border-line">
            {(['day', 'week'] as const).map((m) => (
              <button key={m} type="button" aria-pressed={mode === m} onClick={() => onNav({ mode: m === 'week' ? 'week' : null })} className={cx('h-7 px-3 text-[12px] font-semibold', mode === m ? 'bg-[#EAEDFB] text-[#23349E] dark:bg-selection dark:text-primary' : 'bg-surface text-ink-2')}>
                {m === 'day' ? 'Day' : 'Week'}
              </button>
            ))}
          </div>
          <Button size="sm" variant="secondary" icon="printer" onClick={onPrint}>Day sheets</Button>
        </div>

        {!loc ? (
          <p className="text-[13px] text-ink-2">There is no location to show. Add one under Set up.</p>
        ) : (
          <div className="overflow-auto rounded-[12px] border border-line bg-surface scroll-thin">
            <div className="sticky top-0 z-10 flex border-b border-line bg-surface pl-[52px] text-[12px] font-semibold text-ink-2">
              {mode === 'day'
                ? (day.data?.providers ?? []).filter((p) => !hidden.has(p.id)).map((p) => (
                    <div key={p.id} className="min-w-[150px] flex-1 truncate border-l border-line px-2 py-2">
                      <span className="mr-1.5 inline-block h-2 w-2 rounded-full" style={{ background: p.color ?? '#3B5BDB' }} />
                      {p.name}
                      <span className="ml-1 font-normal text-ink-3">{`${(day.data?.appointments ?? []).filter((a) => a.provider.id === p.id).length}`}</span>
                    </div>
                  ))
                : Array.from({ length: 7 }, (_, i) => addDays(week0, i)).map((d) => (
                    <div key={d} className={cx('min-w-[130px] flex-1 border-l border-line px-2 py-2', d === today(tz) && 'text-primary')}>{dayLabel(d)}</div>
                  ))}
            </div>
            <div className="relative flex">
              <div className="w-[52px] shrink-0 text-[10.5px] text-ink-3" style={{ height: (to - from) * PX }}>
                {Array.from({ length: (to - from) / 60 }, (_, i) => <div key={i} className="pr-1.5 text-right" style={{ height: HOUR }}>{hhmm(from + i * 60)}</div>)}
              </div>
              {mode === 'day'
                ? (day.data?.providers ?? []).filter((p) => shown.some((s) => s.id === p.id) || !providers.some((s) => s.id === p.id)).map((p) =>
                    column(String(p.id), date, p, (day.data?.appointments ?? []).filter((a) => a.provider.id === p.id), p.working),
                  )
                : Array.from({ length: 7 }, (_, i) => addDays(week0, i)).map((d) => {
                    const p = providers.find((x) => x.id === weekProvider);
                    return p ? column(d, d, p, (week.data?.items ?? []).filter((a) => a.local.date === d && a.status !== 'cancelled'), null) : null;
                  })}
              {nowLine !== null && nowLine > 0 && mode === 'day' ? <div className="pointer-events-none absolute right-0 left-[52px] border-t-2 border-[#DB2777]" style={{ top: nowLine }} /> : null}
            </div>
            {(mode === 'day' ? day.isPending : week.isPending) ? <p className="m-0 p-3 text-[12px] text-ink-3">Reading the calendar…</p> : null}
            {mode === 'day' && day.data && !day.data.providers.length ? <p className="m-0 p-3 text-[12px] text-ink-3">Nobody works here that day.</p> : null}
          </div>
        )}
        {mode === 'week' ? <p className="mt-2 text-[11.5px] text-ink-3">Only Pending and Confirmed appointments can be dragged. The drop asks for a reason, then WorkSuite checks the time like a new booking; a refused drop stays where it was, with the reason.</p> : null}
      </div>

      {drop ? (
        <Modal
          title={`Move ${drop.a.customer.name}?`}
          onClose={() => (busy ? undefined : setDrop(null))}
          width={460}
          footer={
            <>
              <Button variant="secondary" disabled={busy} onClick={() => setDrop(null)}>Keep as it is<Kbd>Esc</Kbd></Button>
              <Button variant="primary" loading={busy} onClick={() => void confirm()}>{`Move to ${dayLabel(drop.date)}, ${hhmm(drop.minute)}`}</Button>
            </>
          }
        >
          <p className="m-0 mb-3 text-[13px] text-ink-2">
            {`${drop.a.number} · ${drop.a.service.name} · now ${drop.a.local.date} ${drop.a.local.start} with ${drop.a.provider.name} → ${dayLabel(drop.date)} ${hhmm(drop.minute)} with ${drop.providerName}.`}
          </p>
          <label className={label} htmlFor="apt-move-why">Why is it moving? (kept in the history)</label>
          <input id="apt-move-why" autoFocus className={input} value={why} maxLength={200} onChange={(e) => setWhy(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void confirm()} />
          <div className="mt-3"><Refused>{refused}</Refused></div>
        </Modal>
      ) : null}
    </div>
  );
}

export function MiniMonth({ date, onPick }: { date: string; onPick: (d: string) => void }) {
  const first = `${date.slice(0, 8)}01`;
  const start = weekStart(first);
  const month = date.slice(0, 7);
  const t = today();
  return (
    <div className="rounded-[12px] border border-line bg-surface p-2.5">
      <div className="mb-1.5 flex items-center justify-between text-[12.5px] font-bold text-ink">
        <button type="button" aria-label="Previous month" className="px-1 text-ink-3" onClick={() => onPick(addDays(first, -1).slice(0, 8) + '01')}>‹</button>
        {dayLabel(first, { month: 'long', year: 'numeric' })}
        <button type="button" aria-label="Next month" className="px-1 text-ink-3" onClick={() => onPick(addDays(first, 32).slice(0, 8) + '01')}>›</button>
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-center text-[11px]">
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((w, i) => <span key={i} className="text-ink-3">{w}</span>)}
        {Array.from({ length: 42 }, (_, i) => addDays(start, i)).map((d) => (
          <button key={d} type="button" onClick={() => onPick(d)} aria-pressed={d === date} className={cx('h-6 rounded-[6px] tabular-nums', d === date ? 'bg-[#23349E] font-bold text-white dark:bg-primary' : d === t ? 'font-bold text-primary' : d.slice(0, 7) === month ? 'text-ink hover:bg-subtle' : 'text-ink-3/60')}>
            {Number(d.slice(8))}
          </button>
        ))}
      </div>
    </div>
  );
}

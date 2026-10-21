import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { errorMessage } from '../../core/bridge';
import { toast } from '../../core/toasts';
import { Checkbox } from '../../components/Checkbox';
import { Button, cx, ErrorNote, OfflineNote, Spinner } from '../../components/ui';
import {
  can, dropTime, fetchBoard, fetchOverduePm, fetchSuggest, fetchTimeline, giveOut, K, label, localDay, minutesOf, scheduleRequest, scheduleVisit,
  type Options, type Row, type Visit,
} from './api';

/**
 * D-02 the dispatch timeline (WS-AMC-SRS-001 §15, T-08): every technician's day hour by hour
 * (`GET dispatch/timeline`), the jobs and requests still to give out (`GET dispatch`) beside it. Drag one onto a
 * technician's row at an hour to give it out (`visits/{id}/schedule`, or `requests/{id}/schedule` for a request with
 * no visit yet); pick a job to see the dispatch assistant's ranked technicians (`dispatch/suggest`, with its reasons);
 * tick overdue planned maintenance and give it out in one go (`dispatch/give-out`). Nothing is given out offline.
 */
export const START_HOUR = 7;
export const END_HOUR = 20;
export const HOUR_PX = 64;

type Dragged = { kind: 'visit'; id: number } | { kind: 'request'; id: number };

export default function Dispatch({ options, offline, give, onRequest }: { options?: Options; offline: boolean; give: number | null; onRequest: (id: number) => void }) {
  const qc = useQueryClient();
  const [date, setDate] = useState(() => localDay());
  const [picked, setPicked] = useState<number | null>(null);
  const [dragged, setDragged] = useState<Dragged | null>(null);
  const [ticked, setTicked] = useState<Set<number>>(new Set());
  const [start, setStart] = useState('08:30');
  const [tech, setTech] = useState<number | ''>('');
  const mayGive = can(options, 'schedule') || can(options, 'assign');
  const locked = offline || !mayGive;

  const timeline = useQuery({ queryKey: K.timeline(date), queryFn: ({ signal }) => fetchTimeline(date, signal), refetchInterval: 60_000 });
  const board = useQuery({ queryKey: K.board(date), queryFn: ({ signal }) => fetchBoard(date, signal), refetchInterval: 60_000 });
  const overdue = useQuery({ queryKey: K.overdue(date), queryFn: ({ signal }) => fetchOverduePm(date, signal) });
  const pickedVisit = (board.data?.data.unassigned ?? []).find((v) => v.id === picked) ?? (overdue.data ?? []).find((v) => v.id === picked) ?? null;
  const suggest = useQuery({
    queryKey: K.suggest(picked ?? 0, date, start),
    queryFn: ({ signal }) => fetchSuggest(picked!, date, start, signal),
    enabled: picked !== null,
  });

  const refresh = () => void qc.invalidateQueries({ queryKey: ['amc'] });
  const book = useMutation({
    mutationFn: ({ item, time, technician }: { item: Dragged; time: string; technician: number }) =>
      item.kind === 'visit' ? scheduleVisit(item.id, date, time, technician) : scheduleRequest(item.id, date, time, technician),
    onSuccess: () => { toast('success', 'Given out.'); refresh(); },
    onError: (e) => toast('error', errorMessage(e)),
  });
  const bulk = useMutation({
    mutationFn: () => giveOut([...ticked], date, start, tech === '' ? null : tech),
    onSuccess: (r) => {
      toast(r.refused.length ? 'warning' : 'success', `${r.booked.length} given out${r.refused.length ? `, ${r.refused.length} refused: ${r.refused[0]?.message ?? ''}` : ''}.`);
      setTicked(new Set());
      refresh();
    },
    onError: (e) => toast('error', errorMessage(e)),
  });

  const drop = (technician: number, x: number) => {
    if (!dragged || locked) return;
    book.mutate({ item: dragged, time: dropTime(x, START_HOUR, HOUR_PX, END_HOUR), technician });
    setDragged(null);
  };

  if (timeline.isPending || board.isPending) return <Spinner />;
  if (timeline.isError) return <div className="m-4"><ErrorNote error={timeline.error} onRetry={() => void timeline.refetch()} /></div>;
  const techs = timeline.data.data.items ?? [];
  const waiting = board.data?.data.waiting ?? [];
  const unassigned = board.data?.data.unassigned ?? [];
  const pm = overdue.data ?? [];
  const hours = Array.from({ length: END_HOUR - START_HOUR }, (_, i) => START_HOUR + i);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-[18px] font-bold">Dispatch</h1>
        <input type="date" aria-label="Day" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} className="rounded-[7px] border border-line bg-surface px-2 py-1 text-[13px]" />
        {timeline.data.offline ? <OfflineNote cachedAt={timeline.data.cachedAt} /> : null}
        {!mayGive ? <span className="text-[12px] text-ink-3">You may look; giving out jobs is someone else's.</span> : null}
      </div>
      <div className="flex min-h-0 flex-1 gap-3">
        <aside aria-label="To give out" className="flex w-[280px] shrink-0 flex-col gap-3 overflow-y-auto scroll-thin">
          <Group title={`Requests waiting (${waiting.length})`}>
            {waiting.map((r: Row) => (
              <Item key={`r${r.id}`} draggable={!locked} highlight={give === r.id} onDragStart={() => setDragged({ kind: 'request', id: r.id })} onClick={() => onRequest(r.id)}
                title={`${label(r.number)} · ${label(r.subject)}`} sub={`${label(r.client)} · ${label(r.priority_label ?? r.priority)}`} />
            ))}
          </Group>
          <Group title={`Jobs to give out (${unassigned.length})`}>
            {unassigned.map((v: Visit) => (
              <Item key={`v${v.id}`} draggable={!locked} highlight={picked === v.id} onDragStart={() => setDragged({ kind: 'visit', id: v.id })} onClick={() => setPicked(v.id)}
                title={`${label(v.number)} · ${label(v.label ?? v.kind_label)}`} sub={`${label(v.client)} · due ${label(v.due_on)}`} />
            ))}
          </Group>
          <Group title={`Overdue PMs (${pm.length})`}>
            {pm.map((v) => (
              <label key={`p${v.id}`} className="flex items-start gap-2 px-2 py-1 text-[12.5px]">
                <Checkbox disabled={locked} checked={ticked.has(v.id)} onChange={(e) => setTicked((s) => { const n = new Set(s); if (e.target.checked) n.add(v.id); else n.delete(v.id); return n; })} />
                <span className="min-w-0"><span className="block truncate font-semibold">{label(v.client)} · {label(v.equipment ?? v.label)}</span><span className="text-ink-3">due {label(v.due_on)}</span></span>
              </label>
            ))}
            {pm.length ? (
              <div className="flex flex-col gap-1.5 border-t border-line p-2">
                <div className="flex gap-1.5">
                  <input aria-label="Start at" type="time" value={start} onChange={(e) => setStart(e.target.value)} className="w-[90px] rounded-[6px] border border-line bg-surface px-1.5 text-[12.5px]" />
                  <select aria-label="Technician" value={tech} onChange={(e) => setTech(e.target.value ? Number(e.target.value) : '')} className="min-w-0 flex-1 rounded-[6px] border border-line bg-surface text-[12.5px]">
                    <option value="">Suggested for each</option>
                    {techs.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
                <Button size="sm" variant="primary" disabled={locked || !ticked.size || bulk.isPending} onClick={() => bulk.mutate()}>Give out {ticked.size || ''} overdue</Button>
              </div>
            ) : null}
          </Group>
        </aside>
        <section aria-label="Timeline" className="min-w-0 flex-1 overflow-auto rounded-[10px] border border-line bg-surface scroll-thin">
          <div style={{ width: 160 + hours.length * HOUR_PX }}>
            <div className="sticky top-0 flex border-b border-line bg-surface text-[11px] text-ink-3">
              <div className="w-[160px] shrink-0 px-2 py-1">Technician</div>
              {hours.map((h) => <div key={h} style={{ width: HOUR_PX }} className="shrink-0 border-l border-line px-1 py-1">{String(h).padStart(2, '0')}:00</div>)}
            </div>
            {techs.map((t) => (
              <div key={t.id} className="flex border-b border-line" data-testid={`row-${t.id}`}>
                <div className="w-[160px] shrink-0 truncate px-2 py-2 text-[12.5px] font-semibold">{t.name}</div>
                <div
                  className={cx('relative h-[44px] shrink-0', dragged && !locked ? 'bg-subtle' : '')}
                  style={{ width: hours.length * HOUR_PX }}
                  onDragOver={(e) => { if (dragged && !locked) e.preventDefault(); }}
                  onDrop={(e) => { e.preventDefault(); drop(t.id, e.clientX - e.currentTarget.getBoundingClientRect().left); }}
                >
                  {t.timeline.map((s) => {
                    const from = minutesOf(s.from) ?? START_HOUR * 60;
                    const to = Math.max(minutesOf(s.to) ?? from + 60, from + 15);
                    return (
                      <div key={s.visit_id} title={`${label(s.label)} · ${label(s.client)}`} className="absolute top-1 bottom-1 overflow-hidden rounded-[6px] bg-[#FEF3C7] px-1.5 text-[11px] text-[#92400E] dark:bg-selection dark:text-ink"
                        style={{ left: ((from - START_HOUR * 60) / 60) * HOUR_PX, width: ((to - from) / 60) * HOUR_PX }}>
                        <span className="font-semibold">{label(s.client)}</span> {s.label ?? ''}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
            {!techs.length ? <p className="p-4 text-[13px] text-ink-3">No active technicians.</p> : null}
          </div>
        </section>
        {picked !== null ? (
          <aside aria-label="Dispatch assistant" className="w-[260px] shrink-0 overflow-y-auto rounded-[10px] border border-line bg-surface p-3 scroll-thin">
            <div className="mb-2 flex items-center justify-between"><h2 className="text-[13px] font-bold">Suggested</h2><button type="button" className="text-[12px] text-ink-3" onClick={() => setPicked(null)}>Close</button></div>
            <p className="mb-2 text-[12px] text-ink-2">{pickedVisit ? `${label(pickedVisit.client)} · ${label(pickedVisit.label ?? pickedVisit.kind_label)}` : ''} at {start}</p>
            {suggest.isPending ? <Spinner /> : suggest.isError ? <ErrorNote error={suggest.error} /> : (suggest.data ?? []).map((s) => (
              <div key={s.id} className={cx('mb-2 rounded-[8px] border p-2', s.suggested ? 'border-primary' : 'border-line')}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[13px] font-semibold">{s.name}{s.suggested ? ' · suggested' : ''}</span>
                  <Button size="sm" disabled={locked || !s.eligible || book.isPending} onClick={() => book.mutate({ item: { kind: 'visit', id: picked }, time: start, technician: s.id })}>Give to</Button>
                </div>
                <ul className="mt-1 text-[11.5px] text-ink-3">{(s.why ?? []).map((w, i) => <li key={i}>{w}</li>)}</ul>
              </div>
            ))}
          </aside>
        ) : null}
      </div>
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="rounded-[10px] border border-line bg-surface">
      <h2 className="border-b border-line px-2.5 py-1.5 text-[12px] font-bold">{title}</h2>
      <div className="py-1">{children}</div>
    </section>
  );
}

function Item({ title, sub, draggable, highlight, onDragStart, onClick }: { title: string; sub: string; draggable: boolean; highlight: boolean; onDragStart: () => void; onClick: () => void }) {
  return (
    <button type="button" draggable={draggable} onDragStart={onDragStart} onClick={onClick}
      className={cx('flex w-full flex-col px-2.5 py-1 text-left hover:bg-subtle', highlight ? 'bg-[#FEF3C7] dark:bg-selection' : '', draggable ? 'cursor-grab' : '')}>
      <span className="truncate text-[12.5px] font-semibold">{title}</span>
      <span className="truncate text-[11.5px] text-ink-3">{sub}</span>
    </button>
  );
}

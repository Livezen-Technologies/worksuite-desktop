import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTab } from '../../core/tab-context';
import { toast } from '../../core/toasts';
import { Button, cx } from '../../components/ui';
import { addBlock, dateIn, fetchBlocks, fetchProviders, K, minutesIn, hhmm, removeBlock, zonedInstant } from './api';
import { errText, Head, input, label, Pill, Refused, Section, useDesk } from './parts';

/**
 * D19 · Set up: the stylists — their hours (from HR, or their own), the services they give and where they work — and
 * the times they cannot be booked (blocks), which are added and removed here. Changes save to the server, need a
 * connection, and each needs its own permission (the server checks). Locations, services, resources and the rest of
 * the company's rules open on the web.
 */
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function Setup({ onDesk }: { onDesk: () => void }) {
  const desk = useDesk();
  const qc = useQueryClient();
  const { openLink } = useTab();
  const ps = useQuery({ queryKey: K.setup('providers'), queryFn: ({ signal }) => fetchProviders(signal) });
  const [sel, setSel] = useState<number | null>(null);
  const p = ps.data?.items.find((x) => x.id === sel) ?? ps.data?.items[0] ?? null;
  const blocks = useQuery({ queryKey: K.setup(`blocks-${p?.id}`), queryFn: ({ signal }) => fetchBlocks(p!.id, signal), enabled: !!p });
  const tz = desk.options?.locations.find((l) => l.id === (p?.locations[0] ?? desk.location))?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [day, setDay] = useState('');
  const [start, setStart] = useState('13:00');
  const [end, setEnd] = useState('14:00');
  const [why, setWhy] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const services = new Map((desk.options?.services ?? []).map((s) => [s.id, s]));
  const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

  const add = async () => {
    if (!p || !day) return;
    setErr(null);
    try {
      const r = await addBlock(p.id, { starts_at: zonedInstant(day, toMin(start), tz), ends_at: zonedInstant(day, toMin(end), tz), reason: why.trim() || undefined });
      toast('success', r.message || 'Block added.');
      setWhy('');
      void qc.invalidateQueries({ queryKey: K.setup(`blocks-${p.id}`) });
      void qc.invalidateQueries({ queryKey: K.all });
    } catch (e) {
      setErr(errText(e));
    }
  };
  const remove = async (id: number) => {
    try {
      const r = await removeBlock(id);
      toast('success', r.message || 'Removed.');
      void qc.invalidateQueries({ queryKey: K.setup(`blocks-${p?.id}`) });
    } catch (e) {
      toast('error', errText(e));
    }
  };

  return (
    <div>
      <Head title="Set up" sub="Changes save to the server and need a connection. Each needs its own permission.">
        <Button variant="secondary" onClick={onDesk}>This desk</Button>
        <Button variant="secondary" icon="external" onClick={() => openLink('/appointments/setup')}>Locations, services and rules on the web</Button>
      </Head>
      <div className="grid grid-cols-[260px_1fr] gap-4">
        <Section title={desk.options?.terms.provider ? `${desk.options.terms.provider}s` : 'Stylists'}>
          <ul className="m-0 list-none p-0">
            {(ps.data?.items ?? []).map((x) => (
              <li key={x.id}>
                <button type="button" aria-current={p?.id === x.id ? 'true' : undefined} onClick={() => setSel(x.id)} className={cx('flex w-full items-center gap-2 border-b border-line/70 px-3.5 py-2 text-left', p?.id === x.id ? 'bg-selection dark:bg-selection' : 'hover:bg-subtle')}>
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: x.color ?? '#9AA1B5' }} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-bold text-ink">{x.name}</span>
                    <span className="block truncate text-[11.5px] text-ink-3">{[x.title, x.hours_mode === 'hr' ? 'HR shift' : 'Own hours'].filter(Boolean).join(' · ')}</span>
                  </span>
                  {!x.active ? <Pill tone="muted">Off</Pill> : null}
                </button>
              </li>
            ))}
            {!ps.data?.items.length ? <li className="px-3.5 py-4 text-[12.5px] text-ink-3">{ps.isPending ? 'Reading…' : ps.isError ? errText(ps.error) : 'Nobody set up yet.'}</li> : null}
          </ul>
        </Section>
        {p ? (
          <div className="flex flex-col gap-4">
            <Section title={p.name}>
              <div className="grid grid-cols-2 gap-4 px-3.5 pb-3.5 text-[12.5px]">
                <div>
                  <div className={label}>{p.hours_mode === 'hr' ? 'Hours from HR (shift, leave, holidays)' : 'Own bookable hours'}</div>
                  {p.hours_mode === 'hr' ? <p className="m-0 text-ink-2">Bookable when HR has them on shift, off their leave and the company’s holidays.</p> : null}
                  {p.hours.map((h, i) => <div key={i} className="text-ink tabular-nums">{`${DAYS[h.weekday] ?? h.weekday} ${h.starts}–${h.ends}`}</div>)}
                </div>
                <div>
                  <div className={label}>Services · own time</div>
                  {p.services.map((s) => <div key={s.service_id} className="text-ink">{`${services.get(s.service_id)?.name ?? `Service ${s.service_id}`}${s.duration_min ? ` · ${s.duration_min} min` : ''}`}</div>)}
                  {!p.services.length ? <div className="text-ink-3">Every service</div> : null}
                  <div className={cx(label, 'mt-3')}>Works at</div>
                  <div className="text-ink">{p.locations.length ? p.locations.map((l) => desk.options?.locations.find((x) => x.id === l)?.name ?? `#${l}`).join(', ') : 'Every location'}</div>
                </div>
              </div>
            </Section>
            <Section title="Not bookable · blocks">
              <div className="px-3.5 pb-3.5">
                {(blocks.data?.items ?? []).map((b) => (
                  <div key={b.id} className="flex items-center gap-2 border-b border-line/70 py-1.5 text-[12.5px]">
                    <span className="flex-1 text-ink">{`${dateIn(b.starts_at, tz)} ${hhmm(minutesIn(b.starts_at, tz))}–${hhmm(minutesIn(b.ends_at, tz))}${b.reason ? ` · ${b.reason}` : ''}`}</span>
                    <Button size="sm" variant="ghost" disabled={!desk.online} onClick={() => void remove(b.id)}>Remove</Button>
                  </div>
                ))}
                {!blocks.data?.items.length ? <p className="m-0 py-1 text-[12px] text-ink-3">No blocks.</p> : null}
                <div className="mt-3 grid grid-cols-[1fr_90px_90px_1.5fr_auto] items-end gap-2">
                  <label><span className={label}>Day</span><input type="date" className={input} value={day} onChange={(e) => setDay(e.target.value)} /></label>
                  <label><span className={label}>From</span><input type="time" className={input} value={start} onChange={(e) => setStart(e.target.value)} /></label>
                  <label><span className={label}>To</span><input type="time" className={input} value={end} onChange={(e) => setEnd(e.target.value)} /></label>
                  <label><span className={label}>Reason</span><input className={input} value={why} maxLength={200} onChange={(e) => setWhy(e.target.value)} /></label>
                  <Button variant="primary" disabled={!desk.online || !day || end <= start} onClick={() => void add()}>Add block</Button>
                </div>
                <div className="mt-2"><Refused>{err}</Refused></div>
              </div>
            </Section>
          </div>
        ) : null}
      </div>
    </div>
  );
}

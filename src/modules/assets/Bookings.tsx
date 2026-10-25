import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { apiGet, apiPost } from '../../core/api';
import { toast } from '../../core/toasts';
import { Spinner, cx } from '../../components/ui';
import { refusal } from '../finance/api';
import { BASE, fetchAssets, orNull, type Booking, type Can } from './api';
import { Btn, Card, Field, NotYet, PageHead, input, useReadOnly } from './parts';

/**
 * Bookings & check-out (D13, T-04): the week, one row per bookable asset, each booking across its days; ‹ Today ›
 * to move; a new booking with the server's conflict check (a clash is refused with its reason). Needs Assets 1.1
 * (`GET/POST bookings`); an older server says so.
 */
const DAY = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
export function weekOf(anchor: Date): string[] {
  const d = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), anchor.getUTCDate()));
  const monday = d.getTime() - ((d.getUTCDay() + 6) % 7) * DAY;
  return Array.from({ length: 7 }, (_, i) => iso(new Date(monday + i * DAY)));
}

export default function Bookings({ org }: { org: number; can: Can; active: boolean }) {
  const ro = useReadOnly();
  const qc = useQueryClient();
  const [anchor, setAnchor] = useState(() => new Date());
  const days = weekOf(anchor);
  const q = useQuery({ queryKey: ['assets', 'bookings', days[0], org], queryFn: ({ signal }) => orNull(apiGet<{ bookings: Booking[] }>(`${BASE}/bookings`, { from: days[0], to: days[6], org: org || undefined }, signal)) });
  const assets = useQuery({ queryKey: ['assets', 'list', 'bookable', org], queryFn: ({ signal }) => fetchAssets({ per_page: 100, org: org || undefined }, signal), staleTime: 60_000 });
  const [asset, setAsset] = useState(0);
  const [from, setFrom] = useState(() => `${iso(new Date())}T09:00`);
  const [until, setUntil] = useState(() => `${iso(new Date(Date.now() + DAY))}T18:00`);
  const [purpose, setPurpose] = useState('');
  const [busy, setBusy] = useState(false);

  if (q.isPending) return <Spinner />;
  if (q.data === null) return (<div className="flex flex-col gap-3"><PageHead title="Bookings" /><Card><NotYet what="Booking equipment" /></Card></div>);
  const list = q.data?.bookings ?? [];
  const byAsset = new Map<number, Booking[]>();
  for (const b of list) byAsset.set(b.asset_id, [...(byAsset.get(b.asset_id) ?? []), b]);
  const rows = [...byAsset.entries()];

  const book = async () => {
    if (!asset) return;
    setBusy(true);
    try {
      await apiPost(`${BASE}/bookings`, { asset_id: asset, starts_at: from, ends_at: until, purpose: purpose.trim() || undefined });
      toast('success', 'Booked.');
      setPurpose('');
      void qc.invalidateQueries({ queryKey: ['assets', 'bookings'] });
    } catch (e) {
      toast('error', refusal(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap gap-4">
      <div className="flex min-w-0 flex-[3_1_600px] flex-col gap-3">
        <PageHead title="Bookings" sub={`${days[0]} – ${days[6]}`}>
          <Btn aria-label="Previous week" onClick={() => setAnchor((a) => new Date(a.getTime() - 7 * DAY))}>‹</Btn>
          <Btn onClick={() => setAnchor(new Date())}>Today</Btn>
          <Btn aria-label="Next week" onClick={() => setAnchor((a) => new Date(a.getTime() + 7 * DAY))}>›</Btn>
        </PageHead>
        <Card>
          <div className="grid grid-cols-[180px_repeat(7,minmax(70px,1fr))] text-[11.5px]">
            <div className="border-b border-line bg-ground px-2.5 py-1.5 font-semibold text-ink-2">Asset</div>
            {days.map((d) => (
              <div key={d} className={cx('border-b border-l border-line bg-ground px-2 py-1.5 font-semibold text-ink-2', d === iso(new Date()) && 'text-primary')}>{new Date(`${d}T00:00:00Z`).toLocaleDateString([], { weekday: 'short', day: 'numeric', timeZone: 'UTC' })}</div>
            ))}
            {rows.map(([id, bs]) => (
              <div key={id} className="contents">
                <div className="border-b border-line/70 px-2.5 py-2"><b className="block truncate">{bs[0]!.asset ?? `#${id}`}</b><span className="font-mono text-[10.5px] text-ink-3">{bs[0]!.asset_code}</span></div>
                {days.map((d) => {
                  const b = bs.find((x) => x.starts_at.slice(0, 10) <= d && x.ends_at.slice(0, 10) >= d);
                  return (
                    <div key={d} className="border-b border-l border-line/70 p-1">
                      {b ? <div className={cx('truncate rounded-[5px] px-1.5 py-1 text-[11px] font-semibold', b.overdue ? 'bg-[#FDECEA] text-[#B42318]' : b.status === 'checked_out' ? 'bg-[#EAEDFB] text-[#23349E]' : 'bg-[#EEF0F6] text-[#4A5068]')} title={b.purpose ?? undefined}>{b.booked_for ?? b.purpose ?? b.status}</div> : null}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
          {!rows.length ? <p className="m-0 px-3.5 py-4 text-[12.5px] text-ink-3">Nothing booked this week.</p> : null}
        </Card>
      </div>
      <aside aria-label="New booking" className="flex min-w-0 flex-[1_1_260px] flex-col gap-2.5 self-start rounded-[10px] border border-line bg-surface p-3.5">
        <h2 className="m-0 text-[13.5px] font-bold">New booking</h2>
        <Field label="Asset">
          <select className={input} value={asset} onChange={(e) => setAsset(Number(e.target.value))}>
            <option value={0}>Choose…</option>
            {(assets.data?.assets ?? []).map((a) => (
              <option key={a.id} value={a.id}>{`${a.asset_code} · ${a.name}`}</option>
            ))}
          </select>
        </Field>
        <Field label="From"><input className={input} type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="Until"><input className={input} type="datetime-local" value={until} onChange={(e) => setUntil(e.target.value)} /></Field>
        <Field label="Purpose"><input className={input} value={purpose} onChange={(e) => setPurpose(e.target.value)} /></Field>
        <Btn primary disabled={ro || busy || !asset} onClick={() => void book()}>Book</Btn>
        <p className="m-0 text-[11px] text-ink-3">Check-out and check-in are at the scan station (Loan out / in).</p>
      </aside>
    </div>
  );
}

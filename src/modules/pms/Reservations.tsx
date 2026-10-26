import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Select } from '../../components/Select';
import { Button, ErrorNote, Spinner, cx } from '../../components/ui';
import { input } from '../garage/parts';
import { PageHead } from '../hr/parts';
import { day, K, pGet, type ReservationSummary } from './api';
import { Money, occupants, ReservationPill, usePms, VipPill } from './parts';
import { clickOnKey } from '../../components/press';

/**
 * Reservations: the property's list by status, and the search every desk
 * needs (PMS-WEB-004 on the desktop) — a guest's name, email or phone, a
 * confirmation number, a channel reference or a room number — across the
 * properties the person reaches.
 */
export default function Reservations({ seed }: { seed: string | null }) {
  const pms = usePms();
  const pid = pms.property.id;
  const [text, setText] = useState(seed ?? '');
  const [q, setQ] = useState(seed ?? '');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  useEffect(() => {
    const t = setTimeout(() => {
      setQ(text.trim());
      setPage(1);
    }, 250);
    return () => clearTimeout(t);
  }, [text]);
  const searching = q.length >= 2;
  const found = useQuery({ queryKey: K.search(q), queryFn: ({ signal }) => pGet<{ items: ReservationSummary[] }>('/search', { q }, signal), enabled: searching });
  const listed = useQuery({
    queryKey: K.reservations(pid, { status, page }),
    queryFn: ({ signal }) => pGet<{ items: ReservationSummary[]; total: number; page: number; per_page: number }>(`/properties/${pid}/reservations`, { status: status || undefined, page, per_page: 50 }, signal),
    enabled: !searching,
    placeholderData: keepPreviousData,
  });
  const data = searching ? found : listed;
  const items = (searching ? found.data?.items : listed.data?.items) ?? [];
  const pages = listed.data ? Math.max(1, Math.ceil(listed.data.total / Math.max(1, listed.data.per_page))) : 1;
  const others = new Set(items.map((r) => r.property_id)).size > 1 || items.some((r) => r.property_id !== pid);
  const propertyName = (id: number) => pms.options.properties.find((p) => p.id === id)?.name ?? `#${id}`;

  return (
    <div className="flex flex-col gap-3 px-6 py-5">
      <PageHead title={searching ? 'Search' : 'Reservations'} sub={searching ? `Across the properties you reach: “${q}”` : pms.property.name}>
        <input className={cx(input, 'w-72')} autoFocus={!!seed} placeholder="Guest, confirmation, room, phone, channel reference" aria-label="Search reservations" value={text} onChange={(e) => setText(e.target.value)} />
        {!searching ? (
          <Select
            aria-label="Status"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
            options={[{ value: '', label: 'Every status' }, ...pms.options.reservation_statuses.map((s) => ({ value: s.value, label: s.label }))]}
            className={cx(input, 'w-44')}
          />
        ) : null}
        {pms.may('pms.reservation.create') ? (
          <Button variant="primary" icon="calendar-plus" disabled={!pms.online} title={pms.online ? 'Alt+N' : 'Needs WorkSuite'} onClick={() => pms.go('new')}>
            New reservation
          </Button>
        ) : null}
      </PageHead>
      {data.isLoading ? (
        <Spinner />
      ) : data.error ? (
        <ErrorNote error={data.error} onRetry={() => void data.refetch()} />
      ) : items.length === 0 ? (
        <p className="text-[13px] text-ink-3">{searching ? 'No reservation matches.' : 'No reservations here.'}</p>
      ) : (
        <div className="overflow-hidden rounded-[12px] border border-line bg-surface">
          <table className="w-full text-left text-[13px]">
            <thead className="bg-subtle text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase">
              <tr>
                <th className="px-3 py-2">Confirmation</th>
                <th className="px-3 py-2">Guest</th>
                <th className="px-3 py-2">Stay</th>
                <th className="px-3 py-2">Status</th>
                {others ? <th className="px-3 py-2">Property</th> : null}
                <th className="px-3 py-2 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {items.map((r) => (
                <tr tabIndex={0} onKeyDown={clickOnKey} key={r.id} className="cursor-pointer border-t border-line hover:bg-subtle" onClick={() => pms.open({ kind: 'reservation', id: r.id })}>
                  <td className="px-3 py-2">
                    <button type="button" className="font-mono text-[12px] font-semibold text-primary" onClick={() => pms.open({ kind: 'reservation', id: r.id })}>
                      {r.confirmation_no}
                    </button>
                    {r.channel_ref ? <span className="block text-[11px] text-ink-3">{r.channel_ref}</span> : null}
                  </td>
                  <td className="px-3 py-2">
                    <span className="flex items-center gap-1.5">
                      {r.guest_name ?? '—'} <VipPill level={r.vip_level} />
                    </span>
                  </td>
                  <td className="px-3 py-2 text-ink-2">
                    {day(r.arrival_date)} → {day(r.departure_date)}
                    <span className="block text-[11.5px] text-ink-3">
                      {r.nights} {r.nights === 1 ? 'night' : 'nights'} · {r.rooms} {r.rooms === 1 ? 'room' : 'rooms'} · {occupants(r.adults, r.children)}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <ReservationPill label={r.status_label} badge={r.badge} />
                  </td>
                  {others ? <td className="px-3 py-2 text-ink-2">{propertyName(r.property_id)}</td> : null}
                  <td className="px-3 py-2 text-right">
                    <Money amount={r.total_amount} currency={r.currency} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!searching && pages > 1 ? (
        <div className="flex items-center justify-end gap-2 text-[12.5px] text-ink-2">
          <Button size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            Previous
          </Button>
          <span className="tabular-nums">
            {page} of {pages}
          </span>
          <Button size="sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>
            Next
          </Button>
        </div>
      ) : null}
    </div>
  );
}

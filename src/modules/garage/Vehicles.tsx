import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { Button, ErrorNote, Spinner, cx } from '../../components/ui';
import { PageHead } from '../hr/parts';
import { gGet, K, nice, type VehicleBrief } from './api';
import { input, useGarage } from './parts';
import { NewVehicle } from './WalkIn';

/** Vehicles (FR-VEH-01): search by plate, VIN, make, model, owner or the owner's phone; each opens its 360°. */
export default function Vehicles() {
  const g = useGarage();
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => {
      setQ(text.trim());
      setPage(1);
    }, 250);
    return () => clearTimeout(t);
  }, [text]);
  const list = useQuery({
    queryKey: K.vehicles(g.org, { q, type, page }),
    queryFn: ({ signal }) => gGet<{ total: number | null; page: number; per_page: number; vehicles: VehicleBrief[] }>('/vehicles', { q, type, page, org: g.org }, signal),
    placeholderData: keepPreviousData,
  });
  const d = list.data;
  const pages = d?.total ? Math.max(1, Math.ceil(d.total / Math.max(1, d.per_page))) : 1;

  return (
    <div className="flex flex-col gap-3 px-6 py-5">
      <PageHead title="Vehicles" sub={d?.total != null ? `${d.total} on file` : undefined}>
        <label className="relative block">
          <span className="sr-only">Search vehicles</span>
          <Icon name="search" size={15} className="pointer-events-none absolute top-2.5 left-2.5 text-ink-3" />
          <input className={cx(input, 'w-72 pl-8')} placeholder="Plate, VIN, make, model, owner or phone" value={text} onChange={(e) => setText(e.target.value)} />
        </label>
        <Select aria-label="Type" value={type} onChange={(e) => setType(e.target.value)} options={[{ value: '', label: 'Every type' }, ...g.options.vehicle_types.map((t) => ({ value: t, label: nice(t) }))]} className="h-9 w-40 rounded-[8px] border border-line bg-surface px-2 text-[12.5px]" />
        {g.may('garage.vehicle.manage') ? (
          <Button variant="primary" icon="plus" disabled={!g.online} onClick={() => setAdding(true)}>
            Add vehicle
          </Button>
        ) : null}
      </PageHead>
      {list.isLoading ? (
        <Spinner />
      ) : list.error || !d ? (
        <ErrorNote error={list.error ?? new Error('The vehicles could not be loaded.')} onRetry={() => void list.refetch()} />
      ) : d.vehicles.length === 0 ? (
        <p className="text-[13px] text-ink-3">No vehicles here.</p>
      ) : (
        <ul className="m-0 grid list-none gap-2 p-0 sm:grid-cols-2 xl:grid-cols-3">
          {d.vehicles.map((v) => (
            <li key={v.id}>
              <button type="button" onClick={() => g.openVehicle(v.id)} className="flex w-full items-center gap-3 rounded-[12px] border border-line bg-surface p-3 text-left hover:border-primary/50">
                <span className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-selection text-primary">
                  <Icon name="truck" size={17} />
                </span>
                <span className="min-w-0">
                  <b className="block tracking-wide">{v.vehicle_number}</b>
                  <span className="block truncate text-[12px] text-ink-3">
                    {[v.make, v.model, v.year].filter(Boolean).join(' ') || nice(v.vehicle_type)} · {v.customer_name ?? 'no owner'}
                  </span>
                  {v.odometer !== null ? (
                    <span className="block text-[11.5px] text-ink-3 tabular-nums">
                      {v.odometer.toLocaleString()} {g.options.units}
                    </span>
                  ) : null}
                </span>
                {(v.open?.length ?? 0) > 0 ? <span className="ml-auto rounded-[6px] bg-warning-bg px-1.5 text-[10.5px] font-bold text-warning">IN THE WORKSHOP</span> : null}
              </button>
            </li>
          ))}
        </ul>
      )}
      {pages > 1 ? (
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
      {adding ? (
        <NewVehicle
          seed=""
          customer={null}
          onClose={() => setAdding(false)}
          onPicked={(v) => {
            setAdding(false);
            g.openVehicle(v.id);
          }}
        />
      ) : null}
    </div>
  );
}

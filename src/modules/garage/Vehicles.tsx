import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { btn, btnPrimary, btnSmall, Caps, Cell, Field, input, PageHead, row, Sheet, THead } from '../hr/parts';
import { companiesWhere, createVehicle, distance, fetchCustomers, fetchVehicles, K, lookupVehicles, OFFLINE_WRITE, refusalOf, updateVehicle, type Options, type Refusal, type Vehicle } from './api';
import { OfflineBanner, Pill } from './parts';

/**
 * Vehicles (SRS §11.2, FR-VEH-01/02/06/07): a search over number, VIN and
 * make/model; a new vehicle, checked against the numbers and VINs already
 * recorded (unique per company, compared without spaces or dashes); and the
 * same form to edit one, where choosing another customer records a new owner.
 */
export default function Vehicles({ org, options, online, onVehicle }: { org: string; options: Options; online: boolean; onVehicle: (id: number) => void }) {
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);
  const list = useQuery({ queryKey: K.vehicles(org, { q: q.trim(), page }), queryFn: ({ signal }) => fetchVehicles(org, { q: q.trim() || undefined, page }, signal), placeholderData: (p) => p });
  const mayAdd = companiesWhere(options, 'manage_vehicles', org).length > 0;
  const data = list.data?.data;

  return (
    <div className="flex flex-col gap-3 px-6 py-5">
      <PageHead title="Vehicles" sub={data ? `${data.meta.total} ${data.meta.total === 1 ? 'vehicle' : 'vehicles'}` : undefined}>
        <label className="flex h-[34px] w-[260px] items-center gap-2 rounded-[8px] border border-line bg-surface px-2.5 focus-within:border-primary">
          <Icon name="search" size={14} className="text-ink-3" />
          <input
            data-garage-search
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
            placeholder="Number, VIN, make or model"
            aria-label="Search vehicles"
            className="bare-focus min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-3"
          />
        </label>
        {mayAdd ? (
          <button type="button" className={btnPrimary} disabled={!online} onClick={() => setAdding(true)}>
            <Icon name="plus" size={15} /> New vehicle
          </button>
        ) : null}
      </PageHead>
      {list.data?.offline ? <OfflineBanner cachedAt={list.data.cachedAt} /> : null}
      {list.isLoading ? <Spinner /> : list.error ? <ErrorNote error={list.error} onRetry={() => void list.refetch()} /> : null}
      {data ? (
        <section className="overflow-hidden rounded-[12px] border border-line bg-surface" aria-label="Vehicles">
          <THead cols={[['Number', 150], ['Vehicle', null], ['Customer', 200], ['VIN', 190], ['Job', 170]]} />
          {data.items.map((v) => (
            <button key={v.id} type="button" onClick={() => onVehicle(v.id)} className={cx(row, 'w-full text-left hover:bg-subtle')}>
              <Cell w={150}>
                <b>{v.vehicle_number}</b>
              </Cell>
              <Cell w={null}>{[v.make, v.model, v.year].filter(Boolean).join(' ') || '—'}</Cell>
              <Cell w={200} className="text-ink-2">
                {v.customer?.name ?? '—'}
              </Cell>
              <Cell w={190} className="font-mono text-[12px] text-ink-2">
                {v.vin ?? '—'}
              </Cell>
              <Cell w={170}>{v.open_job ? <Pill tone="blue">{v.open_job.job_number}</Pill> : <span className="text-ink-3">—</span>}</Cell>
            </button>
          ))}
          {!data.items.length ? <div className="px-3.5 py-8 text-center text-[12.5px] text-ink-3">{q.trim() ? 'No vehicle matches.' : 'No vehicles yet.'}</div> : null}
          {data.meta.pages > 1 ? (
            <div className="flex items-center justify-end gap-2 border-t border-line px-3.5 py-2 text-[12.5px] text-ink-2">
              <span>
                Page {data.meta.page} of {data.meta.pages}
              </span>
              <button type="button" className={btnSmall} disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                Previous
              </button>
              <button type="button" className={btnSmall} disabled={page >= data.meta.pages} onClick={() => setPage((p) => p + 1)}>
                Next
              </button>
            </div>
          ) : null}
        </section>
      ) : null}
      {adding ? (
        <VehicleSheet
          org={org}
          options={options}
          online={online}
          vehicle={null}
          onClose={() => setAdding(false)}
          onSaved={(v) => {
            setAdding(false);
            onVehicle(v.id);
          }}
        />
      ) : null}
    </div>
  );
}

export interface VehicleDraft {
  org: string;
  customer: { id: number; name: string } | null;
  vehicle_number: string;
  vin: string;
  engine_number: string;
  vehicle_type: string;
  make: string;
  model: string;
  variant: string;
  year: string;
  colour: string;
  fuel_type: string;
  transmission: string;
  engine_capacity_cc: string;
  engine_hours: string;
  registration_date: string;
  insurer: string;
  policy: string;
  insurance_expires_on: string;
  warranty_provider: string;
  warranty_until: string;
  warranty_until_km: string;
  notes: string;
  odometer: string;
}

export function vehicleDraft(v: Vehicle | null, org: string): VehicleDraft {
  const s = (x: string | number | null | undefined) => (x === null || x === undefined ? '' : String(x));
  return {
    org: v ? String(v.org_id) : org,
    customer: v?.customer ? { id: v.customer.id, name: v.customer.name } : null,
    vehicle_number: s(v?.vehicle_number),
    vin: s(v?.vin),
    engine_number: s(v?.engine_number),
    vehicle_type: v?.vehicle_type ?? 'car',
    make: s(v?.make),
    model: s(v?.model),
    variant: s(v?.variant),
    year: s(v?.year),
    colour: s(v?.colour),
    fuel_type: s(v?.fuel_type),
    transmission: s(v?.transmission),
    engine_capacity_cc: s(v?.engine_capacity_cc),
    engine_hours: s(v?.engine_hours),
    registration_date: s(v?.registration_date),
    insurer: s(v?.insurance?.insurer),
    policy: s(v?.insurance?.policy),
    insurance_expires_on: s(v?.insurance?.expires_on),
    warranty_provider: s(v?.warranty?.provider),
    warranty_until: s(v?.warranty?.until),
    warranty_until_km: s(v?.warranty?.until_km),
    notes: s(v?.notes),
    odometer: '',
  };
}

/** The body of `POST vehicles` (everything) or `PUT vehicles/{id}` (only what changed from `was`). */
export function vehicleBody(d: VehicleDraft, was: VehicleDraft | null): Record<string, unknown> {
  const t = (v: string) => v.trim() || null;
  const n = (v: string) => (v.trim() === '' ? null : Number(v.replace(/[^\d.]/g, '')));
  const full: Record<string, unknown> = {
    customer_id: d.customer?.id ?? null,
    vehicle_number: d.vehicle_number.trim(),
    vin: t(d.vin),
    engine_number: t(d.engine_number),
    vehicle_type: d.vehicle_type,
    make: t(d.make),
    model: t(d.model),
    variant: t(d.variant),
    year: n(d.year),
    colour: t(d.colour),
    fuel_type: t(d.fuel_type),
    transmission: t(d.transmission),
    engine_capacity_cc: n(d.engine_capacity_cc),
    engine_hours: n(d.engine_hours),
    registration_date: t(d.registration_date),
    insurance: { insurer: t(d.insurer), policy: t(d.policy), expires_on: t(d.insurance_expires_on) },
    warranty: { provider: t(d.warranty_provider), until: t(d.warranty_until), until_km: n(d.warranty_until_km), notes: null },
    notes: t(d.notes),
  };
  if (!was) return { org_id: Number(d.org), ...full, ...(d.odometer.trim() ? { odometer: n(d.odometer) } : {}) };
  const before = vehicleBody(was, null);
  return Object.fromEntries(Object.entries(full).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(before[k])));
}

function useDebounced<T>(v: T, ms: number): T {
  const [d, setD] = useState(v);
  useEffect(() => {
    const h = setTimeout(() => setD(v), ms);
    return () => clearTimeout(h);
  }, [v, ms]);
  return d;
}

/** A customer chosen by searching CRM (the garage's view of it). */
export function CustomerPicker({ org, value, onChange }: { org: string; value: { id: number; name: string } | null; onChange: (c: { id: number; name: string } | null) => void }) {
  const [term, setTerm] = useState('');
  const t = useDebounced(term.trim(), 250);
  const q = useQuery({ queryKey: K.customers(org, t), queryFn: ({ signal }) => fetchCustomers(org, t, signal), enabled: !!org });
  const found = q.data?.data.items ?? [];
  const opts = [...(value && !found.some((c) => c.id === value.id) ? [{ value: String(value.id), label: value.name }] : []), ...found.map((c) => ({ value: String(c.id), label: c.name, hint: c.phone ?? undefined }))];
  return (
    <Select
      aria-label="Customer"
      value={value ? String(value.id) : ''}
      onSearch={setTerm}
      loading={q.isFetching}
      empty="No customer matches"
      placeholder="Search CRM customers"
      onValueChange={(v) => {
        const c = found.find((x) => String(x.id) === v) ?? (value && String(value.id) === v ? value : null);
        onChange(c ? { id: c.id, name: c.name } : null);
      }}
      options={opts}
    />
  );
}

/** Add a vehicle, or edit one (`vehicle`). */
export function VehicleSheet({ org, options, online, vehicle, onClose, onSaved }: { org: string; options: Options; online: boolean; vehicle: Vehicle | null; onClose: () => void; onSaved: (v: Vehicle) => void }) {
  const qc = useQueryClient();
  const companies = companiesWhere(options, 'manage_vehicles', vehicle ? String(vehicle.org_id) : org);
  const [was] = useState(() => (vehicle ? vehicleDraft(vehicle, org) : null));
  const [d, setD] = useState<VehicleDraft>(() => vehicleDraft(vehicle, companies.length === 1 ? String(companies[0]!.id) : org));
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<Refusal | null>(null);
  const set = (patch: Partial<VehicleDraft>) => setD((x) => ({ ...x, ...patch }));
  const f = (k: keyof VehicleDraft) => (e: { target: { value: string } }) => set({ [k]: e.target.value } as Partial<VehicleDraft>);
  const num = useDebounced(d.vehicle_number.trim(), 300);
  const vin = useDebounced(d.vin.trim(), 300);
  const changedKey = !was || num !== was.vehicle_number || vin !== was.vin;
  const dupes = useQuery({ queryKey: ['garage', 'lookup', d.org, num, vin], queryFn: ({ signal }) => lookupVehicles(d.org, num, vin, signal), enabled: !!d.org && online && changedKey && (num.length >= 3 || vin.length >= 6) });
  const others = (dupes.data?.items ?? []).filter((v) => v.id !== vehicle?.id);
  const body = vehicleBody(d, was);
  const newOwner = !!vehicle && !!was?.customer && d.customer?.id !== was.customer.id;
  const ready = !!d.org && !!d.customer && !!d.vehicle_number.trim() && (!vehicle || Object.keys(body).length > 0);

  const save = async () => {
    if (!online) return toast('error', OFFLINE_WRITE);
    setBusy(true);
    setRefused(null);
    try {
      const r = vehicle ? await updateVehicle(vehicle.id, body) : await createVehicle(body);
      toast('success', r.message || (vehicle ? 'Saved.' : `${r.data.vehicle.vehicle_number} added.`));
      void qc.invalidateQueries({ queryKey: K.all });
      onSaved(r.data.vehicle);
    } catch (e) {
      setRefused(refusalOf(e));
    } finally {
      setBusy(false);
    }
  };
  const bad = (k: string) => refused?.field === k && 'border-danger';

  return (
    <Sheet
      title={vehicle ? `Edit ${vehicle.vehicle_number}` : 'New vehicle'}
      width={680}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} disabled={busy || !online || !ready} onClick={() => void save()}>
            {vehicle ? 'Save' : 'Add the vehicle'}
          </button>
        </>
      }
    >
      {!vehicle && companies.length > 1 ? (
        <Field label="Company">
          <Select aria-label="Company" value={d.org} onValueChange={(v) => set({ org: v, customer: null })} options={[{ value: '', label: 'Which company?' }, ...companies.map((c) => ({ value: String(c.id), label: c.name }))]} />
        </Field>
      ) : null}
      <Field label="Customer" hint={newOwner ? 'Another customer records a new owner: the history stays with the vehicle.' : 'A CRM customer.'}>
        <CustomerPicker org={d.org} value={d.customer} onChange={(c) => set({ customer: c })} />
      </Field>
      <Caps>Identity</Caps>
      <div className="grid grid-cols-3 gap-2">
        <Field label="Vehicle number">
          <input aria-label="Vehicle number" value={d.vehicle_number} onChange={(e) => set({ vehicle_number: e.target.value.toUpperCase() })} className={cx(input, bad('vehicle_number'))} maxLength={40} />
        </Field>
        <Field label="VIN / chassis">
          <input aria-label="VIN" value={d.vin} onChange={(e) => set({ vin: e.target.value.toUpperCase() })} className={cx(input, bad('vin'))} maxLength={40} />
        </Field>
        <Field label="Engine number">
          <input aria-label="Engine number" value={d.engine_number} onChange={f('engine_number')} className={input} maxLength={60} />
        </Field>
      </div>
      {others.length ? (
        <div role="status" className="rounded-[8px] bg-warning-bg px-2.5 py-2 text-[12.5px] text-warning">
          {others.map((v) => (
            <div key={v.id}>
              Already recorded: <b>{v.vehicle_number}</b> {[v.make, v.model].filter(Boolean).join(' ')} ({v.matched === 'vin' ? 'same VIN' : 'same number'}){v.customer?.name ? `, ${v.customer.name}` : ''}.
            </div>
          ))}
        </div>
      ) : null}
      <Caps>Model</Caps>
      <div className="grid grid-cols-3 gap-2">
        <Field label="Type">
          <Select aria-label="Vehicle type" value={d.vehicle_type} onValueChange={(v) => set({ vehicle_type: v })} options={Object.entries(options.vehicle_types).map(([value, label]) => ({ value, label }))} />
        </Field>
        <Field label="Make">
          <input aria-label="Make" value={d.make} onChange={f('make')} className={input} maxLength={60} />
        </Field>
        <Field label="Model">
          <input aria-label="Model" value={d.model} onChange={f('model')} className={input} maxLength={60} />
        </Field>
        <Field label="Variant">
          <input aria-label="Variant" value={d.variant} onChange={f('variant')} className={input} maxLength={60} />
        </Field>
        <Field label="Year">
          <input aria-label="Year" inputMode="numeric" value={d.year} onChange={(e) => set({ year: e.target.value.replace(/[^\d]/g, '').slice(0, 4) })} className={cx(input, bad('year'))} />
        </Field>
        <Field label="Colour">
          <input aria-label="Colour" value={d.colour} onChange={f('colour')} className={input} maxLength={40} />
        </Field>
      </div>
      <Caps>Technical</Caps>
      <div className="grid grid-cols-3 gap-2">
        <Field label="Fuel">
          <Select aria-label="Fuel" value={d.fuel_type} onValueChange={(v) => set({ fuel_type: v })} options={[{ value: '', label: 'Not recorded' }, ...Object.entries(options.fuels).map(([value, label]) => ({ value, label }))]} />
        </Field>
        <Field label="Transmission">
          <Select aria-label="Transmission" value={d.transmission} onValueChange={(v) => set({ transmission: v })} options={[{ value: '', label: 'Not recorded' }, ...Object.entries(options.transmissions).map(([value, label]) => ({ value, label }))]} />
        </Field>
        <Field label="Engine (cc)">
          <input aria-label="Engine capacity" inputMode="numeric" value={d.engine_capacity_cc} onChange={(e) => set({ engine_capacity_cc: e.target.value.replace(/[^\d]/g, '') })} className={input} />
        </Field>
        {d.vehicle_type === 'heavy' ? (
          <Field label="Engine hours">
            <input aria-label="Engine hours" inputMode="numeric" value={d.engine_hours} onChange={(e) => set({ engine_hours: e.target.value.replace(/[^\d.]/g, '') })} className={input} />
          </Field>
        ) : null}
        {!vehicle ? (
          <Field label="Odometer" hint="The first reading.">
            <input aria-label="Odometer" inputMode="numeric" value={d.odometer} onChange={(e) => set({ odometer: e.target.value.replace(/[^\d]/g, '') })} className={input} />
          </Field>
        ) : null}
      </div>
      <Caps>Compliance</Caps>
      <div className="grid grid-cols-3 gap-2">
        <Field label="Registered on">
          <input aria-label="Registration date" type="date" value={d.registration_date} onChange={f('registration_date')} className={input} />
        </Field>
        <Field label="Insurer">
          <input aria-label="Insurer" value={d.insurer} onChange={f('insurer')} className={input} maxLength={120} />
        </Field>
        <Field label="Policy">
          <input aria-label="Policy" value={d.policy} onChange={f('policy')} className={input} maxLength={60} />
        </Field>
        <Field label="Insurance expires">
          <input aria-label="Insurance expires" type="date" value={d.insurance_expires_on} onChange={f('insurance_expires_on')} className={input} />
        </Field>
        <Field label="Warranty by">
          <input aria-label="Warranty provider" value={d.warranty_provider} onChange={f('warranty_provider')} className={input} maxLength={120} />
        </Field>
        <Field label="Warranty until">
          <input aria-label="Warranty until" type="date" value={d.warranty_until} onChange={f('warranty_until')} className={input} />
        </Field>
      </div>
      <Field label="Notes">
        <textarea aria-label="Notes" value={d.notes} onChange={f('notes')} rows={2} className={cx(input, 'h-auto py-2')} maxLength={2000} />
      </Field>
      {refused ? (
        <div role="alert" className="rounded-[9px] bg-danger-bg px-3 py-2 text-[12.5px] text-danger">
          <b>{refused.message}</b>
          {refused.existing ? <span> Already recorded: {refused.existing.vehicle_number ?? refused.existing.name}.</span> : null}
        </div>
      ) : null}
    </Sheet>
  );
}

/** "84,250 km" with the unit the vehicle is read in. */
export const reading = (v: Pick<Vehicle, 'odometer' | 'odometer_unit'>) => distance(v.odometer, v.odometer_unit);

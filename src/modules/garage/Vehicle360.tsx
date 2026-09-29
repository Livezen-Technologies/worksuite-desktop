import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { dateLabel, timeLabel } from '../../core/time';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { btn, btnPrimary, Field, Grid, input, PageHead, Panel, Sheet } from '../hr/parts';
import { amount, canIn, distance, fetchVehicle, fetchVehicle360, K, OFFLINE_WRITE, recordOdometer, refusalOf, vehicleLine, type Options, type Vehicle } from './api';
import { Pill, StatusPill, when } from './parts';
import { fetchVehicleHistory, KB3 } from './api-b3';
import { ServiceHistory } from './History';
import { Thumb } from './job/media-kit';
import { VehicleSheet } from './Vehicles';

/**
 * Vehicle 360° (SRS §11.3, §28.12, FR-VEH-03..06): everything known about one
 * vehicle — the header with its owner, mileage, last service and current job;
 * a new job for it; the profile, edited in place; an odometer reading (lower
 * than the last one only with the override permission and a reason, audited);
 * and its history, tab by tab. Inspections, repairs, parts, invoices and
 * deferred work fill in as the stage-B areas record them.
 */
const TABS = ['overview', 'history', 'open', 'inspections', 'repairs', 'parts', 'mileage', 'invoices', 'warranty', 'photos', 'notes', 'owners', 'activity'] as const;
type Tab = (typeof TABS)[number];
const LABELS: Record<Tab, string> = {
  overview: 'Overview',
  history: 'Service history',
  open: 'Open jobs',
  inspections: 'Inspections',
  repairs: 'Repairs',
  parts: 'Parts replaced',
  mileage: 'Mileage',
  invoices: 'Invoices',
  warranty: 'Warranty',
  photos: 'Photos',
  notes: 'Notes',
  owners: 'Owners',
  activity: 'Activity',
};
const stamp = (s: string | null | undefined) => (s ? `${dateLabel(s)} ${timeLabel(s)}` : '—');

export default function Vehicle360({ id, options, online, onBack, onJob, onCustomer, onWalkIn }: { id: number; options: Options; online: boolean; onBack: () => void; onJob: (id: number) => void; onCustomer: (id: number) => void; onWalkIn: ((vehicleId: number) => void) | null }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: K.vehicle360(id), queryFn: ({ signal }) => fetchVehicle360(id, signal), refetchOnMount: 'always' });
  const profile = useQuery({ queryKey: K.vehicle(id), queryFn: ({ signal }) => fetchVehicle(id, signal) });
  const [tab, setTab] = useState<Tab>('overview');
  const [editing, setEditing] = useState(false);
  const [odo, setOdo] = useState(false);
  // Stage B3's history adds Billing's totals; an older server has none (404), and the 360° rows stand.
  const hist = useQuery({ queryKey: KB3.vehicleHistory(id), queryFn: ({ signal }) => fetchVehicleHistory(id, signal), enabled: tab === 'history', retry: false });
  if (q.isLoading) return <Spinner />;
  const back = (
    <button type="button" onClick={onBack} className="flex items-center gap-1 self-start text-[12.5px] font-semibold text-ink-2 hover:text-ink" title="Back">
      <Icon name="chevron-left" size={15} /> Back
    </button>
  );
  if (q.error || !q.data)
    return (
      <div className="flex flex-col gap-3 px-6 py-5">
        {back}
        <ErrorNote error={q.error ?? new Error('This vehicle could not be read.')} onRetry={() => void q.refetch()} />
      </div>
    );
  const d = q.data;
  const v = profile.data?.vehicle ?? d.header.vehicle;
  const company = options.companies.find((c) => c.id === v.org_id);
  const unit = v.odometer_unit ?? company?.distance_unit ?? 'km';
  const mayManage = canIn(options, v.org_id, 'manage_vehicles');
  const refresh = () => void qc.invalidateQueries({ queryKey: K.all });
  const count: Partial<Record<Tab, number>> = { history: d.service_history.length, open: d.open_jobs.length, inspections: d.inspections.length, repairs: d.repairs.length, parts: d.parts_replaced.length, invoices: d.invoices.length, photos: d.media.length, notes: d.notes.length };

  return (
    <div className="flex flex-col gap-3.5 px-6 py-5">
      {back}
      <PageHead
        title={`${[v.make, v.model].filter(Boolean).join(' ').toUpperCase() || 'Vehicle'} — ${v.vehicle_number}`}
        sub={[options.vehicle_types[v.vehicle_type] ?? v.vehicle_type, v.fuel_type ? (options.fuels[v.fuel_type] ?? v.fuel_type) : null, v.vin ? `VIN ${v.vin}` : null, company && options.companies.length > 1 ? company.name : null].filter(Boolean).join(' · ')}
      >
        {onWalkIn && canIn(options, v.org_id, 'create') ? (
          <button type="button" className={btnPrimary} disabled={!online} onClick={() => onWalkIn(v.id)}>
            <Icon name="plus" size={15} /> New job
          </button>
        ) : null}
        {mayManage ? (
          <>
            <button type="button" className={btn} disabled={!online} onClick={() => setOdo(true)}>
              <Icon name="history" size={15} /> Odometer reading
            </button>
            <button type="button" className={btn} disabled={!online || !profile.data} onClick={() => setEditing(true)}>
              <Icon name="compose" size={15} /> Edit
            </button>
          </>
        ) : null}
      </PageHead>
      <section className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-x-4 gap-y-2 rounded-[12px] border border-line bg-surface px-4 py-3 text-[12.5px]" aria-label="Vehicle">
        <Fact k="Customer">
          {d.header.customer ? (
            <button type="button" className="font-semibold text-primary hover:underline" onClick={() => onCustomer(d.header.customer!.id)}>
              {d.header.customer.name}
            </button>
          ) : (
            '—'
          )}
        </Fact>
        <Fact k="Mileage">{distance(d.header.mileage, unit)}</Fact>
        <Fact k="Last service">{d.header.last_service ? `${distance(d.header.last_service.odometer, unit)} · ${dateLabel(d.header.last_service.date)}` : '—'}</Fact>
        <Fact k="Next service">{d.header.next_service ? String(d.header.next_service) : 'Reminders arrive later'}</Fact>
        <Fact k="Current job">
          {d.header.current_job ? (
            <button type="button" className="flex items-center gap-1.5 font-semibold text-primary hover:underline" onClick={() => onJob(d.header.current_job!.id)}>
              {d.header.current_job.number} <StatusPill status={d.header.current_job.status} label={d.header.current_job.status_label} />
            </button>
          ) : (
            'None'
          )}
        </Fact>
        <Fact k="Average">{d.mileage.per_day !== null ? `${Math.round(d.mileage.per_day)} ${unit} a day` : '—'}</Fact>
      </section>

      <div role="tablist" aria-label="Vehicle 360°" className="flex flex-wrap gap-1 border-b border-line">
        {TABS.map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={cx('-mb-px h-9 border-b-2 px-2.5 text-[12.5px] font-semibold', tab === t ? 'border-primary text-primary' : 'border-transparent text-ink-2 hover:text-ink')}>
            {LABELS[t]}
            {count[t] ? <span className="ml-1 text-ink-3">{count[t]}</span> : null}
          </button>
        ))}
      </div>

      <div role="tabpanel" aria-label={LABELS[tab]}>
        {tab === 'overview' ? <Profile v={v} options={options} /> : null}
        {tab === 'history' ? <ServiceHistory rows={hist.data?.jobs ?? d.service_history} totals={hist.data?.totals} unit={unit} options={options} onJob={onJob} /> : null}
        {tab === 'open' ? (
          <Rows empty="No job open." head={['Job', 'Status', 'Promised', 'Advisor']}>
            {d.open_jobs.map((j) => (
              <Tr key={j.id} onClick={() => onJob(j.id)} cells={[j.number, <StatusPill key="s" status={j.status} label={j.status_label} />, when(j.target_completion_at) || '—', j.service_advisor?.name ?? '—']} />
            ))}
          </Rows>
        ) : null}
        {tab === 'inspections' ? (
          <Rows empty="No inspections yet." head={['Completed', 'Type', 'Status', 'Job']}>
            {d.inspections.map((i) => (
              <Tr key={i.id} onClick={() => onJob(i.job_id)} cells={[stamp(i.completed_at), i.type, i.status, `#${i.job_id}`]} />
            ))}
          </Rows>
        ) : null}
        {tab === 'repairs' ? (
          <Rows empty="No repairs recorded yet." head={['Line', 'Description', 'Qty', 'Decision']}>
            {d.repairs.map((r, i) => (
              <Tr key={`${r.job_id}-${i}`} onClick={() => onJob(r.job_id)} cells={[r.line_type, r.description, String(r.qty), r.decision]} />
            ))}
          </Rows>
        ) : null}
        {tab === 'parts' ? (
          <Rows empty="No parts replaced yet." head={['Date', 'Part', 'Qty', 'Serial']}>
            {d.parts_replaced.map((p, i) => (
              <Tr key={`${p.job_id}-${i}`} onClick={() => onJob(p.job_id)} cells={[dateLabel(p.date), p.name, String(p.qty), p.serial_no ?? '—']} />
            ))}
          </Rows>
        ) : null}
        {tab === 'mileage' ? (
          <Rows empty="No readings yet." head={['When', 'Reading', 'Source', 'Recorded by', 'Why lower']}>
            {d.mileage.readings.map((r) => (
              <Tr key={r.id} onClick={r.job_id ? () => onJob(r.job_id!) : undefined} cells={[stamp(r.at), distance(r.reading, unit), options.odometer_sources[r.source] ?? r.source, r.by?.name ?? '—', r.override_reason ?? '']} />
            ))}
          </Rows>
        ) : null}
        {tab === 'invoices' ? (
          <Rows empty="No invoices yet." head={['Issued', 'Invoice', 'Status', 'Total']}>
            {d.invoices.map((i) => (
              <Tr key={i.invoice_id} onClick={() => onJob(i.job_id)} cells={[dateLabel(i.issue_date), i.number ?? `#${i.invoice_id}`, i.status, i.total !== undefined ? amount(i.total, i.currency) : '—']} />
            ))}
          </Rows>
        ) : null}
        {tab === 'warranty' ? <p className="m-0 text-[12.5px] text-ink-3">Warranties arrive with a later Garage phase. {v.warranty?.provider ? `Recorded on the profile: ${v.warranty.provider}${v.warranty.until ? ` until ${dateLabel(v.warranty.until)}` : ''}.` : ''}</p> : null}
        {tab === 'photos' ? (
          <div className="flex flex-wrap gap-2">
            {d.media.map((m) => (
              <span key={m.id} className="flex flex-col items-center gap-0.5 text-[11px] text-ink-3">
                <Thumb m={m} size={96} onOpen={() => onJob(m.job_id)} />
                {options.media_contexts[m.context] ?? m.context}
              </span>
            ))}
            {!d.media.length ? <span className="text-[12.5px] text-ink-3">No photos yet.</span> : null}
          </div>
        ) : null}
        {tab === 'notes' ? (
          <Rows empty="No notes yet." head={['When', 'Note', 'Who reads it', 'By']}>
            {d.notes.map((n) => (
              <Tr key={n.id} onClick={() => onJob(n.job_id)} cells={[stamp(n.at), n.body, n.visibility === 'customer' ? 'Customer can read it' : 'Internal', n.by?.name ?? '—']} />
            ))}
          </Rows>
        ) : null}
        {tab === 'owners' ? (
          <Rows empty="No ownership recorded." head={['Owner', 'From', 'To']}>
            {d.owners.map((o, i) => (
              <Tr key={`${o.customer_id}-${i}`} onClick={() => onCustomer(o.customer_id)} cells={[o.customer ?? `#${o.customer_id}`, dateLabel(o.from) || '—', o.to ? dateLabel(o.to) : 'Now']} />
            ))}
          </Rows>
        ) : null}
        {tab === 'activity' ? (
          <Rows empty="Nothing recorded yet." head={['When', 'What', 'By']}>
            {d.activity.map((a) => (
              <Tr key={a.id} onClick={a.job_id ? () => onJob(a.job_id!) : undefined} cells={[stamp(a.at), a.summary, a.by?.name ?? '—']} />
            ))}
          </Rows>
        ) : null}
        {d.deferred.length && tab === 'overview' ? (
          <div className="mt-3">
            <Panel title="Declined and deferred work" sub="Offered again at the next visit">
              {d.deferred.map((x) => (
                <button key={x.item_id} type="button" onClick={() => onJob(x.job_id)} className="flex w-full items-center gap-2.5 border-b border-line/70 px-3.5 py-2 text-left text-[12.5px] last:border-b-0 hover:bg-subtle">
                  {x.vhc ? <Pill tone={x.vhc === 'red' ? 'red' : x.vhc === 'amber' ? 'amber' : 'green'}>{x.vhc}</Pill> : null}
                  <span className="min-w-0 flex-1 truncate text-ink">{x.description}</span>
                  <span className="text-ink-3">{dateLabel(x.decided_at)}</span>
                </button>
              ))}
            </Panel>
          </div>
        ) : null}
      </div>

      {editing && profile.data ? (
        <VehicleSheet
          org={String(v.org_id)}
          options={options}
          online={online}
          vehicle={profile.data.vehicle}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            refresh();
          }}
        />
      ) : null}
      {odo ? <OdometerSheet v={v} unit={unit} mayOverride={canIn(options, v.org_id, 'override_odometer')} online={online} onClose={() => setOdo(false)} onSaved={() => (setOdo(false), refresh())} /> : null}
    </div>
  );
}

function Fact({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col">
      <span className="text-[11.5px] text-ink-3">{k}</span>
      <span className="truncate font-semibold text-ink">{children}</span>
    </div>
  );
}

function Profile({ v, options }: { v: Vehicle; options: Options }) {
  return (
    <div className="grid gap-3 xl:grid-cols-2">
      <Panel title="Identity and model">
        <div className="px-3.5 py-2">
          <Grid
            rows={[
              ['Vehicle number', v.vehicle_number],
              ['VIN / chassis', v.vin],
              ['Engine number', v.engine_number],
              ['Type', options.vehicle_types[v.vehicle_type] ?? v.vehicle_type],
              ['Make and model', vehicleLine({ ...v, vehicle_number: '' }) || null],
              ['Variant', v.variant],
              ['Year', v.year],
              ['Colour', v.colour],
            ]}
          />
        </div>
      </Panel>
      <Panel title="Technical and compliance">
        <div className="px-3.5 py-2">
          <Grid
            rows={[
              ['Fuel', v.fuel_type ? (options.fuels[v.fuel_type] ?? v.fuel_type) : null],
              ['Transmission', v.transmission ? (options.transmissions[v.transmission] ?? v.transmission) : null],
              ['Engine', v.engine_capacity_cc ? `${v.engine_capacity_cc} cc` : null],
              ['Odometer', `${distance(v.odometer, v.odometer_unit)}${v.odometer_updated_at ? ` · ${dateLabel(v.odometer_updated_at)}` : ''}`],
              ['Registered', v.registration_date ? dateLabel(v.registration_date) : null],
              ['Insurance', v.insurance?.insurer ? `${v.insurance.insurer}${v.insurance.policy ? ` · ${v.insurance.policy}` : ''}${v.insurance.expires_on ? ` · to ${dateLabel(v.insurance.expires_on)}` : ''}` : null],
              ['Warranty', v.warranty?.provider ? `${v.warranty.provider}${v.warranty.until ? ` · to ${dateLabel(v.warranty.until)}` : ''}` : null],
              ['Notes', v.notes],
            ]}
          />
        </div>
      </Panel>
    </div>
  );
}

function Rows({ head, children, empty }: { head: string[]; children: ReactNode[]; empty: string }) {
  return (
    <section className="overflow-hidden rounded-[12px] border border-line bg-surface">
      <div className="grid gap-2.5 border-b border-line bg-ground px-3.5 py-2 text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase" style={{ gridTemplateColumns: `repeat(${head.length}, minmax(0, 1fr))` }}>
        {head.map((h) => (
          <span key={h}>{h}</span>
        ))}
      </div>
      {children.length ? children : <div className="px-3.5 py-5 text-center text-[12.5px] text-ink-3">{empty}</div>}
    </section>
  );
}

function Tr({ cells, onClick }: { cells: ReactNode[]; onClick?: () => void }) {
  return (
    <button type="button" disabled={!onClick} onClick={onClick} className="grid w-full gap-2.5 border-b border-line/70 px-3.5 py-2 text-left text-[12.5px] text-ink last:border-b-0 enabled:hover:bg-subtle" style={{ gridTemplateColumns: `repeat(${cells.length}, minmax(0, 1fr))` }}>
      {cells.map((c, i) => (
        <span key={i} className="truncate">
          {c}
        </span>
      ))}
    </button>
  );
}

/** A reading (FR-VEH-03): lower than the last only with the override permission and a reason, which is audited. */
export function OdometerSheet({ v, unit, mayOverride, online, onClose, onSaved }: { v: Pick<Vehicle, 'id' | 'odometer' | 'vehicle_number'>; unit: string; mayOverride: boolean; online: boolean; onClose: () => void; onSaved: () => void }) {
  const [value, setValue] = useState('');
  const [why, setWhy] = useState('');
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const n = value === '' ? null : Number(value);
  const lower = n !== null && v.odometer !== null && n < v.odometer;
  const save = async () => {
    if (!online) return toast('error', OFFLINE_WRITE);
    setBusy(true);
    setRefused(null);
    try {
      const r = await recordOdometer(v.id, { reading: n!, ...(lower && why.trim() ? { override_reason: why.trim() } : {}) });
      toast('success', r.message || 'Reading recorded.');
      onSaved();
    } catch (e) {
      setRefused(refusalOf(e).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      title={`Odometer — ${v.vehicle_number}`}
      width={440}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} disabled={busy || !online || n === null || (lower && (!mayOverride || !why.trim()))} onClick={() => void save()}>
            Record the reading
          </button>
        </>
      }
    >
      <Field label={`Reading (${unit})`} hint={v.odometer !== null ? `Last reading ${distance(v.odometer, unit)}` : 'No reading yet'}>
        <input autoFocus aria-label="Reading" inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value.replace(/[^\d]/g, ''))} className={input} />
      </Field>
      {lower ? (
        mayOverride ? (
          <Field label="Why is it lower?" hint="Recorded and audited.">
            <input aria-label="Why the reading is lower" value={why} onChange={(e) => setWhy(e.target.value)} className={input} maxLength={255} />
          </Field>
        ) : (
          <p className="m-0 text-[12.5px] text-warning">Lower than the last reading. Only somebody allowed to accept a lower reading can record it.</p>
        )
      ) : null}
      {refused ? (
        <p role="alert" className="m-0 rounded-[9px] bg-danger-bg px-3 py-2 text-[12.5px] text-danger">
          {refused}
        </p>
      ) : null}
    </Sheet>
  );
}

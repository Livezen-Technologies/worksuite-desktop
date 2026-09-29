import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { Button, ErrorNote, Modal, Spinner, cx } from '../../components/ui';
import { toast } from '../../core/toasts';
import { codeOf, errorText, gGet, gPost, K, money, nice, span, when, type Customer, type Vehicle360 as Data, type VehicleJob } from './api';
import { Ask, Field, input, Section, StatusPill, Thumb, useGarage } from './parts';

type Dialog = 'edit' | 'odometer' | 'transfer' | 'note' | null;

/**
 * The Vehicle 360° (FR-VEH-04/05, §11.3): who owns it and who did, where it
 * stands, its mileage, everything done to it (FR-HIS-01: work, parts,
 * technicians, invoice and the workmanship warranty on each completed job),
 * its photos, notes and activity. A reading lower than the last one needs a
 * reason from someone who may accept it (FR-VEH-03).
 */
export default function Vehicle360({ id, onBack }: { id: number; onBack: () => void }) {
  const g = useGarage();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: K.vehicle(id), queryFn: ({ signal }) => gGet<Data>(`/vehicles/${id}`, undefined, signal) });
  const [dialog, setDialog] = useState<Dialog>(null);
  const [lower, setLower] = useState<{ reading: number; message: string } | null>(null);
  const [busy, setBusy] = useState(false);

  if (q.isLoading) return <Spinner />;
  if (q.error || !q.data) {
    return (
      <div className="flex flex-col gap-3 p-6">
        <Button icon="back" className="self-start" onClick={onBack}>
          Back
        </Button>
        <ErrorNote error={q.error ?? new Error('This vehicle could not be loaded.')} onRetry={() => void q.refetch()} />
      </div>
    );
  }
  const d = q.data;
  const v = d.vehicle;
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: K.vehicle(id) });
    void qc.invalidateQueries({ queryKey: ['garage', 'vehicles'] });
  };
  const status = (s: VehicleJob['status']) => g.options.statuses?.[s] ?? nice(s);

  const reading = async (n: number, reason?: string) => {
    setBusy(true);
    try {
      const r = await gPost(`/vehicles/${id}/odometer`, { reading: n, reason });
      toast('success', r.message);
      setDialog(null);
      setLower(null);
      refresh();
    } catch (e) {
      if (codeOf(e) === 'odometer_reason') {
        setDialog(null);
        setLower({ reading: n, message: errorText(e) });
      } else toast('error', errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const note = async (body: string, customer: boolean) => {
    setBusy(true);
    try {
      const r = await gPost(`/vehicles/${id}/notes`, { body, visibility: customer ? 'CUSTOMER' : 'INTERNAL' });
      toast('success', r.message);
      setDialog(null);
      refresh();
    } catch (e) {
      toast('error', errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const jobs = [...d.open_jobs, ...d.history];
  const facts = (o: Record<string, string | null> | null) => Object.entries(o ?? {}).filter(([, x]) => x !== null && x !== '');

  return (
    <div className="flex flex-col gap-4 px-6 py-5">
      <div className="flex flex-wrap items-start gap-3">
        <Button icon="back" onClick={onBack}>
          Back
        </Button>
        <span className="grid size-10 shrink-0 place-items-center rounded-[12px] bg-selection text-primary">
          <Icon name="truck" size={19} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          <h1 className="m-0 text-[20px] font-bold tracking-wide text-ink">{v.vehicle_number}</h1>
          <span className="text-[12.5px] text-ink-2">{[v.make, v.model, v.variant, v.year, v.colour].filter(Boolean).join(' · ') || nice(v.vehicle_type)}</span>
          <span className="text-[12px] text-ink-3">
            VIN {v.vin ?? '—'} · {[nice(v.fuel_type), nice(v.transmission)].filter(Boolean).join(' ') || '—'} · {v.odometer !== null ? `${v.odometer.toLocaleString()} ${g.options.units}` : 'no reading'}
            {d.km_per_day ? ` · about ${d.km_per_day} a day` : ''}
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          {d.can.create_job && !d.current_job ? (
            <Button variant="primary" icon="user-plus" disabled={!g.online} onClick={() => g.go('walkin', { q: v.vehicle_number })}>
              New job
            </Button>
          ) : null}
          {d.can.manage ? (
            <>
              <Button icon="compose" disabled={!g.online} onClick={() => setDialog('edit')}>
                Edit
              </Button>
              <Button disabled={!g.online} onClick={() => setDialog('odometer')}>
                Record odometer
              </Button>
              <Button variant="ghost" disabled={!g.online} onClick={() => setDialog('transfer')}>
                Transfer owner
              </Button>
              <Button variant="ghost" disabled={!g.online} onClick={() => setDialog('note')}>
                Add note
              </Button>
            </>
          ) : null}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Section title="Owner">
          {d.customer ? (
            <>
              <button type="button" className="text-left text-[13.5px] font-semibold hover:text-primary" onClick={() => g.go('customers', { customer: d.customer!.id })}>
                {d.customer.name}
              </button>
              <p className="m-0 text-[12.5px] text-ink-2">{[d.customer.phone, d.customer.email].filter(Boolean).join(' · ')}</p>
            </>
          ) : (
            <p className="m-0 text-[13px] text-ink-3">No owner on file.</p>
          )}
          {v.driver_name ? (
            <p className="m-0 mt-1 text-[12px] text-ink-3">
              Usual driver {v.driver_name}
              {v.driver_phone ? ` · ${v.driver_phone}` : ''}
            </p>
          ) : null}
          {d.owners.length > 1 ? (
            <ul className="m-0 mt-2 list-none p-0 text-[12px] text-ink-3">
              {d.owners.slice(1).map((o, i) => (
                <li key={i}>
                  Before: {o.name ?? '—'} ({when(o.from, false)} – {when(o.to, false)})
                </li>
              ))}
            </ul>
          ) : null}
        </Section>
        <Section title="Now">
          {d.current_job ? (
            <button type="button" className="flex flex-wrap items-center gap-2 text-left" onClick={() => g.openJob(d.current_job!.id)}>
              <span className="font-mono text-[13px] font-semibold">{d.current_job.number}</span>
              <StatusPill status={d.current_job.status} label={status(d.current_job.status)} />
            </button>
          ) : (
            <p className="m-0 text-[13px] text-ink-3">Not in the workshop.</p>
          )}
          {d.last_service ? (
            <p className="m-0 mt-2 text-[12px] text-ink-3">
              Last service {when(d.last_service.at, false)} at {d.last_service.odometer?.toLocaleString() ?? '—'} ({d.last_service.number})
            </p>
          ) : null}
          {v.registration_date ? <p className="m-0 mt-1 text-[12px] text-ink-3">Registered {when(v.registration_date, false)}</p> : null}
        </Section>
        <Section title="Mileage">
          {d.mileage.length === 0 ? (
            <p className="m-0 text-[13px] text-ink-3">No readings.</p>
          ) : (
            <ul className="m-0 flex max-h-44 list-none flex-col gap-0.5 overflow-y-auto p-0 text-[12px] scroll-thin">
              {[...d.mileage].reverse().map((m, i) => (
                <li key={i} className="flex justify-between gap-2">
                  <span>
                    {when(m.at, false)} · {nice(m.source)}
                    {m.override ? ` (${m.override})` : ''}
                  </span>
                  <b className="tabular-nums">{m.reading.toLocaleString()}</b>
                </li>
              ))}
            </ul>
          )}
        </Section>
        <Section title="Service history" className="lg:col-span-2">
          {jobs.length === 0 ? (
            <p className="m-0 text-[13px] text-ink-3">No jobs yet.</p>
          ) : (
            <ul className="m-0 flex list-none flex-col divide-y divide-line p-0">
              {jobs.map((j) => (
                <li key={j.id} className="py-2">
                  <button type="button" className="flex w-full items-center justify-between gap-2 text-left" onClick={() => g.openJob(j.id)}>
                    <span className="min-w-0">
                      <span className="font-mono text-[13px] font-semibold">{j.number}</span>{' '}
                      <span className="text-[12px] text-ink-3">
                        {when(j.completed_at ?? j.checkin_at, false)} · {j.requested ?? nice(j.job_type)}
                      </span>
                    </span>
                    <StatusPill status={j.status} label={status(j.status)} />
                  </button>
                  {j.status === 'COMPLETED' ? <JobDetail j={j} /> : null}
                </li>
              ))}
            </ul>
          )}
        </Section>
        <Section title="Insurance and warranty">
          {facts(v.insurance).length === 0 && facts(v.warranty).length === 0 ? (
            <p className="m-0 text-[13px] text-ink-3">Nothing recorded.</p>
          ) : (
            <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[13px]">
              {facts(v.insurance).map(([k, x]) => (
                <Fact key={`i${k}`} label={`Insurance ${nice(k).toLowerCase()}`} value={x} />
              ))}
              {facts(v.warranty).map(([k, x]) => (
                <Fact key={`w${k}`} label={`Warranty ${nice(k).toLowerCase()}`} value={x} />
              ))}
            </dl>
          )}
        </Section>
        <Section title="Photos" className="lg:col-span-2">
          {d.photos.length === 0 ? (
            <p className="m-0 text-[13px] text-ink-3">No photos.</p>
          ) : (
            <div className="grid grid-cols-4 gap-2 md:grid-cols-6">
              {d.photos.slice(0, 18).map((p) => (
                <button key={p.id} type="button" title={`${p.number} · ${nice(p.slot) || nice(p.subject_type)}`} onClick={() => g.openJob(p.job_id, 'media')}>
                  <Thumb id={p.id} alt={p.slot ?? 'photo'} className="aspect-square w-full" />
                </button>
              ))}
            </div>
          )}
        </Section>
        <Section title="Notes">
          {v.notes ? <p className="m-0 mb-2 text-[13px] whitespace-pre-wrap text-ink-2">{v.notes}</p> : null}
          {d.notes.length === 0 ? (
            v.notes ? null : <p className="m-0 text-[13px] text-ink-3">No notes.</p>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {d.notes.map((n) => (
                <li key={n.id} className="text-[13px]">
                  <p className="m-0 whitespace-pre-wrap">{n.body}</p>
                  <span className="text-[11.5px] text-ink-3">
                    {n.by ?? '—'} · {when(n.at)} · {n.visibility === 'CUSTOMER' ? 'shown to the customer' : 'staff only'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>
        <Section title="Activity" className="lg:col-span-3">
          {d.activity.length === 0 ? (
            <p className="m-0 text-[13px] text-ink-3">Nothing yet.</p>
          ) : (
            <ol className="m-0 flex list-none flex-col gap-1 p-0 text-[13px]">
              {d.activity.slice(0, 40).map((a) => (
                <li key={a.id}>
                  {a.text}
                  <span className="ml-2 text-[11.5px] text-ink-3">
                    {when(a.at)}
                    {a.by ? ` · ${a.by}` : ''}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </Section>
      </div>

      {dialog === 'edit' ? (
        <EditVehicle
          d={d}
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null);
            refresh();
          }}
        />
      ) : null}
      {dialog === 'odometer' ? (
        <Ask
          title="Odometer reading"
          text={`Last reading ${v.odometer?.toLocaleString() ?? '—'} ${g.options.units}.`}
          fields={[{ name: 'reading', label: 'Reading', type: 'number', required: true, placeholder: '85200' }]}
          confirm="Record"
          busy={busy}
          onClose={() => setDialog(null)}
          onSubmit={(x) => void reading(Number((x.reading ?? '').replace(/\D/g, '')))}
        />
      ) : null}
      {lower ? (
        <Ask
          title="Lower than the last reading"
          text={lower.message}
          fields={[{ name: 'reason', label: 'Why', required: true, placeholder: 'Instrument cluster replaced' }]}
          confirm="Accept the reading"
          busy={busy}
          onClose={() => setLower(null)}
          onSubmit={(x) => void reading(lower.reading, x.reason)}
        />
      ) : null}
      {dialog === 'note' ? (
        <Ask
          title={`A note on ${v.vehicle_number}`}
          text="Kept with the vehicle, not a job."
          fields={[
            { name: 'body', label: 'Note', type: 'textarea', required: true },
            ...(g.may('garage.media.publish') ? [{ name: 'customer', label: 'Who sees it', type: 'select' as const, options: [{ value: '', label: 'Staff only' }, { value: '1', label: 'The customer too' }] }] : []),
          ]}
          busy={busy}
          onClose={() => setDialog(null)}
          onSubmit={(x) => void note(x.body ?? '', x.customer === '1')}
        />
      ) : null}
      {dialog === 'transfer' ? (
        <Transfer
          id={id}
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null);
            refresh();
          }}
        />
      ) : null}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string | null }) {
  return (
    <>
      <dt className="text-ink-3">{label}</dt>
      <dd className="m-0">{value}</dd>
    </>
  );
}

/** What a completed job did (FR-HIS-01); parts cost only for people who may see money. */
function JobDetail({ j }: { j: VehicleJob }) {
  const g = useGarage();
  if (!j.repairs?.length && !j.parts?.length && !j.invoice && !j.warranty_until) return null;
  return (
    <div className="mt-1 flex flex-col gap-0.5 pl-1 text-[12px] text-ink-2">
      {j.complaints?.length ? (
        <p className="m-0">
          <span className="text-ink-3">Asked about:</span> {j.complaints.join('; ')}
        </p>
      ) : null}
      {j.repairs?.length ? (
        <p className="m-0">
          <span className="text-ink-3">Work:</span> {j.repairs.join('; ')}
        </p>
      ) : null}
      {j.parts?.length ? (
        <p className="m-0">
          <span className="text-ink-3">Parts:</span> {j.parts.join(', ')}
        </p>
      ) : null}
      <p className="m-0 text-ink-3">
        {[
          j.odometer_out ? `out at ${j.odometer_out.toLocaleString()} ${g.options.units}` : null,
          j.technicians?.length ? j.technicians.join(', ') : null,
          j.labour_minutes ? span(j.labour_minutes) : null,
          j.invoice ? `invoice ${j.invoice.number} (${nice(j.invoice.status).toLowerCase()})` : null,
          j.total ? money(j.total, g.options.currency) : null,
          j.parts_cost != null ? `parts cost ${money(j.parts_cost, g.options.currency)}` : null,
          j.warranty_until ? `warranty to ${when(j.warranty_until, false)}${j.warranty_km ? ` or ${j.warranty_km.toLocaleString()} ${g.options.units}` : ''}` : null,
        ]
          .filter(Boolean)
          .join(' · ')}
      </p>
    </div>
  );
}

/** A new owner (FR-VEH-06): the history stays with the vehicle, the previous owner on file. */
function Transfer({ id, onClose, onDone }: { id: number; onClose: () => void; onDone: () => void }) {
  const g = useGarage();
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [pick, setPick] = useState<Customer | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setQ(text.trim()), 250);
    return () => clearTimeout(t);
  }, [text]);
  const found = useQuery({ queryKey: K.search(g.org, q), queryFn: ({ signal }) => gGet<{ customers: Customer[] }>('/search', { q, org: g.org }, signal), enabled: q.length >= 2 });
  const save = async () => {
    setBusy(true);
    try {
      const r = await gPost(`/vehicles/${id}/transfer`, { client_id: pick?.id, note });
      toast('success', r.message);
      onDone();
    } catch (e) {
      toast('error', errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="Transfer to a new owner"
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} disabled={!pick} onClick={() => void save()}>
            Transfer
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="New owner">
          <input className={input} autoFocus aria-label="New owner" placeholder="Name, phone or email" value={text} onChange={(e) => setText(e.target.value)} />
        </Field>
        <ul className="m-0 flex max-h-48 list-none flex-col divide-y divide-line overflow-y-auto rounded-[10px] border border-line p-0">
          {(found.data?.customers ?? []).map((c) => (
            <li key={c.id}>
              <button type="button" onClick={() => setPick(c)} className={cx('w-full px-3 py-2 text-left text-[13px] hover:bg-subtle', pick?.id === c.id && 'bg-selection')}>
                {c.name} <span className="text-[12px] text-ink-3">{c.phone}</span>
              </button>
            </li>
          ))}
          {q.length >= 2 && found.data && found.data.customers.length === 0 ? <li className="px-3 py-2 text-[12.5px] text-ink-3">No customer matches. Add them in Customers first.</li> : null}
        </ul>
        <Field label="Note">
          <input className={input} aria-label="Transfer note" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <p className="m-0 text-[12px] text-ink-3">The vehicle's history stays with it; the previous owner is kept on file.</p>
      </div>
    </Modal>
  );
}

/** Change what the vehicle record says (FR-VEH-01); the same plate or VIN on another vehicle is refused. */
function EditVehicle({ d, onClose, onDone }: { d: Data; onClose: () => void; onDone: () => void }) {
  const g = useGarage();
  const o = g.options;
  const v = d.vehicle;
  const [f, setF] = useState({
    vehicle_number: v.vehicle_number,
    vin: v.vin ?? '',
    engine_number: v.engine_number ?? '',
    make: v.make ?? '',
    model: v.model ?? '',
    variant: v.variant ?? '',
    year: v.year ? String(v.year) : '',
    colour: v.colour ?? '',
    vehicle_type: v.vehicle_type,
    fuel_type: v.fuel_type ?? '',
    transmission: v.transmission ?? '',
    engine_cc: v.engine_cc ? String(v.engine_cc) : '',
    engine_hours: v.engine_hours ? String(v.engine_hours) : '',
    registration_date: v.registration_date ?? '',
    driver_name: v.driver_name ?? '',
    driver_phone: v.driver_phone ?? '',
    notes: v.notes ?? '',
    insurer: v.insurance?.insurer ?? '',
    policy: v.insurance?.policy ?? '',
    insured_until: v.insurance?.until ?? '',
    warranty_provider: v.warranty?.provider ?? '',
    warranty_until: v.warranty?.until ?? '',
    warranty_km: v.warranty?.km ?? '',
  });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (val: string) => setF({ ...f, [k]: val });
  const opt = (list: string[]) => [{ value: '', label: '—' }, ...list.map((t) => ({ value: t, label: nice(t) }))];
  const keep = (x: Record<string, string>) => Object.fromEntries(Object.entries(x).filter(([, val]) => val.trim() !== ''));
  const save = async () => {
    setBusy(true);
    try {
      const { insurer, policy, insured_until, warranty_provider, warranty_until, warranty_km, ...rest } = f;
      const r = await gPost(`/vehicles/${v.id}`, {
        ...rest,
        year: f.year || null,
        insurance: keep({ insurer, policy, until: insured_until }),
        warranty: keep({ provider: warranty_provider, until: warranty_until, km: warranty_km }),
      });
      toast('success', r.message);
      onDone();
    } catch (e) {
      toast('error', errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const text = (k: keyof typeof f, label: string, extra: { upper?: boolean; numeric?: boolean; date?: boolean } = {}) => (
    <Field label={label}>
      <input
        className={input}
        aria-label={label}
        type={extra.date ? 'date' : 'text'}
        inputMode={extra.numeric ? 'numeric' : undefined}
        value={f[k]}
        onChange={(e) => set(k)(extra.upper ? e.target.value.toUpperCase() : extra.numeric ? e.target.value.replace(/\D/g, '') : e.target.value)}
      />
    </Field>
  );
  return (
    <Modal
      title={`Edit ${v.vehicle_number}`}
      onClose={onClose}
      width={760}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} disabled={!f.vehicle_number.trim()} onClick={() => void save()}>
            Save
          </Button>
        </div>
      }
    >
      <div className="grid grid-cols-3 gap-3">
        {text('vehicle_number', 'Plate', { upper: true })}
        {text('vin', 'VIN / chassis number', { upper: true })}
        {text('engine_number', 'Engine number')}
        {text('make', 'Make')}
        {text('model', 'Model')}
        {text('variant', 'Variant')}
        {text('year', 'Year', { numeric: true })}
        {text('colour', 'Colour')}
        <Field label="Type">
          <Select aria-label="Type" value={f.vehicle_type} onChange={(e) => set('vehicle_type')(e.target.value)} options={o.vehicle_types.map((t) => ({ value: t, label: nice(t) }))} className={input} />
        </Field>
        <Field label="Fuel">
          <Select aria-label="Fuel" value={f.fuel_type} onChange={(e) => set('fuel_type')(e.target.value)} options={opt(o.fuels)} className={input} />
        </Field>
        <Field label="Transmission">
          <Select aria-label="Transmission" value={f.transmission} onChange={(e) => set('transmission')(e.target.value)} options={opt(o.transmissions)} className={input} />
        </Field>
        {text('engine_cc', 'Engine capacity (cc)', { numeric: true })}
        {text('engine_hours', 'Engine hours', { numeric: true })}
        {text('registration_date', 'Registered on', { date: true })}
        {text('driver_name', 'Usual driver')}
        {text('driver_phone', "Driver's phone")}
        {text('insurer', 'Insurer')}
        {text('policy', 'Policy number')}
        {text('insured_until', 'Insured until', { date: true })}
        {text('warranty_provider', 'Warranty from')}
        {text('warranty_until', 'Warranty until', { date: true })}
        {text('warranty_km', `Warranty up to (${o.units || 'km'})`, { numeric: true })}
        <Field label="Notes" className="col-span-3">
          <textarea className={cx(input, 'h-auto py-2')} rows={2} aria-label="Notes" value={f.notes} onChange={(e) => set('notes')(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

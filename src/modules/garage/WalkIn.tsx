import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { Button, IconButton, Modal, Spinner, cx } from '../../components/ui';
import { toast } from '../../core/toasts';
import { PageHead } from '../hr/parts';
import { errorData, errorText, gGet, gPost, K, newKey, nice, type Customer, type VehicleBrief } from './api';
import { Field, input, openWeb, useGarage } from './parts';

interface Found {
  vehicles: VehicleBrief[];
  customers: Customer[];
}

/**
 * A walk-in (WF-03, §9): one search box for the plate, VIN, phone or name;
 * the vehicle and its owner, or new ones; then the job card. A vehicle that
 * already has an open job says so, and a second job card is a choice made on
 * purpose (FR-WLK-01..03). The new job opens here; its check-in — photos,
 * marks and the customer's signature — is on the web for now.
 */
export default function WalkIn() {
  const g = useGarage();
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [vehicle, setVehicle] = useState<VehicleBrief | null>(null);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [adding, setAdding] = useState<'vehicle' | 'customer' | null>(null);
  useEffect(() => {
    const t = setTimeout(() => setQ(text.trim()), 250);
    return () => clearTimeout(t);
  }, [text]);
  const found = useQuery({ queryKey: K.search(g.org, q), queryFn: ({ signal }) => gGet<Found>('/search', { q, org: g.org }, signal), enabled: q.length >= 2 });

  const pickVehicle = (v: VehicleBrief) => {
    setVehicle(v);
    if (v.client_id) setCustomer({ id: v.client_id, name: v.customer_name ?? '', phone: v.customer_phone, email: null });
  };

  const row = 'flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-subtle';

  return (
    <div className="flex flex-col gap-4 px-6 py-5">
      <PageHead title="New walk-in" sub="Find the vehicle or the customer. Add them if they are new." />
      <div className="grid gap-4 xl:grid-cols-[1fr_1.1fr]">
        <div className="flex flex-col gap-3">
          <label className="relative block">
            <span className="sr-only">Plate, VIN, phone or name</span>
            <Icon name="search" size={17} className="pointer-events-none absolute top-3 left-3 text-ink-3" />
            <input autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="Plate (WP CAB-1234), VIN, phone or customer name" className={cx(input, 'h-11 pl-10 text-[14px]')} />
          </label>
          {q.length >= 2 ? (
            <>
              <div className="overflow-hidden rounded-[12px] border border-line bg-surface">
                <div className="flex items-center border-b border-line px-4 py-2">
                  <h2 className="m-0 flex-1 text-[11px] font-bold tracking-[.6px] text-ink-3 uppercase">Vehicles</h2>
                  {g.may('garage.vehicle.manage') ? (
                    <button type="button" onClick={() => setAdding('vehicle')} className="text-[12px] font-semibold text-primary">
                      Add a vehicle
                    </button>
                  ) : null}
                </div>
                {found.isLoading ? (
                  <Spinner />
                ) : (found.data?.vehicles ?? []).length === 0 ? (
                  <p className="m-0 px-4 py-3 text-[13px] text-ink-3">No vehicle matches “{q}”.</p>
                ) : (
                  <ul className="m-0 list-none divide-y divide-line p-0">
                    {found.data!.vehicles.map((v) => (
                      <li key={v.id}>
                        <button type="button" onClick={() => pickVehicle(v)} className={cx(row, vehicle?.id === v.id && 'bg-selection')}>
                          <Icon name="truck" size={17} className="text-ink-3" />
                          <span className="min-w-0 flex-1">
                            <b className="block tracking-wide">{v.vehicle_number}</b>
                            <span className="block truncate text-[12px] text-ink-3">
                              {[v.make, v.model, v.year].filter(Boolean).join(' ')} · {v.customer_name ?? 'no owner'}
                            </span>
                          </span>
                          {(v.open?.length ?? 0) > 0 ? <span className="rounded-[6px] bg-warning-bg px-1.5 text-[10.5px] font-bold text-warning">OPEN JOB</span> : null}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="overflow-hidden rounded-[12px] border border-line bg-surface">
                <div className="flex items-center border-b border-line px-4 py-2">
                  <h2 className="m-0 flex-1 text-[11px] font-bold tracking-[.6px] text-ink-3 uppercase">Customers</h2>
                  {g.may('garage.job.create') ? (
                    <button type="button" onClick={() => setAdding('customer')} className="text-[12px] font-semibold text-primary">
                      Add a customer
                    </button>
                  ) : null}
                </div>
                {(found.data?.customers ?? []).length === 0 ? (
                  <p className="m-0 px-4 py-3 text-[13px] text-ink-3">No customer matches.</p>
                ) : (
                  <ul className="m-0 list-none divide-y divide-line p-0">
                    {found.data!.customers.map((c) => (
                      <li key={c.id}>
                        <button type="button" onClick={() => setCustomer(c)} className={cx(row, customer?.id === c.id && 'bg-selection')}>
                          <Icon name="user" size={17} className="text-ink-3" />
                          <span className="min-w-0 flex-1">
                            <b className="block">{c.name}</b>
                            <span className="block text-[12px] text-ink-3">{[c.phone, c.email].filter(Boolean).join(' · ')}</span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          ) : (
            <div className="flex gap-2">
              {g.may('garage.vehicle.manage') ? (
                <Button icon="plus" onClick={() => setAdding('vehicle')}>
                  New vehicle
                </Button>
              ) : null}
              {g.may('garage.job.create') ? (
                <Button icon="plus" onClick={() => setAdding('customer')}>
                  New customer
                </Button>
              ) : null}
            </div>
          )}
        </div>
        <JobForm
          vehicle={vehicle}
          customer={customer}
          onClearVehicle={() => setVehicle(null)}
          onClearCustomer={() => setCustomer(null)}
          onCreated={(id) => {
            void qc.invalidateQueries({ queryKey: ['garage', 'jobs'] });
            void qc.invalidateQueries({ queryKey: ['garage', 'board'] });
            void qc.invalidateQueries({ queryKey: ['garage', 'overview'] });
            g.openJob(id);
          }}
        />
      </div>
      {adding === 'customer' ? (
        <NewCustomer
          seed={text}
          onClose={() => setAdding(null)}
          onPicked={(c) => {
            setCustomer(c);
            setAdding(null);
          }}
        />
      ) : null}
      {adding === 'vehicle' ? (
        <NewVehicle
          seed={text}
          customer={customer}
          onClose={() => setAdding(null)}
          onPicked={(v) => {
            pickVehicle(v);
            setAdding(null);
          }}
        />
      ) : null}
    </div>
  );
}

function Chosen({ label, value, onClear }: { label: string; value: string | null; onClear: () => void }) {
  return (
    <div className={cx('rounded-[10px] border px-3 py-2', value ? 'border-primary/40 bg-selection' : 'border-dashed border-line')}>
      <div className="text-[10.5px] font-bold tracking-[.6px] text-ink-3 uppercase">{label}</div>
      <div className="flex items-center gap-2">
        <span className={cx('min-w-0 flex-1 truncate text-[13px]', value ? 'font-semibold text-ink' : 'text-ink-3')}>{value ?? 'Not chosen yet'}</span>
        {value ? <IconButton icon="x" label={`Clear ${label.toLowerCase()}`} size={14} onClick={onClear} /> : null}
      </div>
    </div>
  );
}

/** The job card itself. A vehicle with an open job is asked about before a second one is made. */
export function JobForm({ vehicle, customer, onClearVehicle, onClearCustomer, onCreated }: { vehicle: VehicleBrief | null; customer: Customer | null; onClearVehicle: () => void; onClearCustomer: () => void; onCreated: (id: number) => void }) {
  const g = useGarage();
  const o = g.options;
  const branches = useMemo(() => o.branches.filter((b) => b.garage), [o]);
  const [branch, setBranch] = useState('');
  const [priority, setPriority] = useState('NORMAL');
  const [type, setType] = useState(o.job_types.includes('SERVICE') ? 'SERVICE' : (o.job_types[0] ?? ''));
  const [pipeline, setPipeline] = useState('standard');
  const [target, setTarget] = useState('');
  const [complaints, setComplaints] = useState<string[]>([]);
  const [complaint, setComplaint] = useState('');
  const [requested, setRequested] = useState('');
  const [busy, setBusy] = useState(false);
  const [openJobs, setOpenJobs] = useState<{ id: number; number: string }[] | null>(null);
  const [key] = useState(() => newKey('walkin'));
  const chosenBranch = branch || String(branches[0]?.id ?? '');

  const add = (c: string) => {
    const t = c.trim();
    if (t && !complaints.includes(t)) setComplaints([...complaints, t]);
    setComplaint('');
  };

  const create = async (again = false) => {
    if (!vehicle || !customer) return;
    setBusy(true);
    try {
      const r = await gPost<{ id: number; number: string }>(
        '/jobs',
        {
          branch_id: Number(chosenBranch),
          client_id: customer.id,
          vehicle_id: vehicle.id,
          priority,
          job_type: type,
          pipeline,
          target_completion_at: target ? new Date(target).toISOString() : undefined,
          complaints,
          requested_services: requested,
          confirm_open: again,
        },
        again ? `${key}-again` : key,
      );
      toast('success', r.message);
      setOpenJobs(null);
      onCreated(r.data.id);
    } catch (e) {
      const open = errorData<{ open?: { id: number; number: string }[] }>(e)?.open;
      if (open && open.length > 0 && !again) setOpenJobs(open);
      else toast('error', errorText(e, 'The job could not be created.'));
    } finally {
      setBusy(false);
    }
  };

  const onFile = vehicle?.open ?? [];

  return (
    <div className="flex flex-col gap-3 rounded-[12px] border border-line bg-surface p-5">
      <h2 className="m-0 text-[15px] font-bold text-ink">Job card</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <Chosen label="Vehicle" value={vehicle ? `${vehicle.vehicle_number} · ${[vehicle.make, vehicle.model].filter(Boolean).join(' ')}` : null} onClear={onClearVehicle} />
        <Chosen label="Customer" value={customer ? customer.name : null} onClear={onClearCustomer} />
      </div>
      {onFile.length > 0 ? (
        <div className="flex items-start gap-2 rounded-[10px] bg-warning-bg p-3 text-[13px] text-warning">
          <Icon name="warning" size={16} className="mt-0.5 shrink-0" />
          <span>
            {vehicle?.vehicle_number} already has an open job ({onFile.map((j) => j.number).join(', ')}).{' '}
            <button type="button" className="font-semibold underline" onClick={() => g.openJob(onFile[0]!.id)}>
              Open it
            </button>
          </span>
        </div>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Branch">
          {branches.length ? (
            <Select aria-label="Branch" value={chosenBranch} onChange={(e) => setBranch(e.target.value)} options={branches.map((b) => ({ value: String(b.id), label: b.name }))} className={input} />
          ) : (
            <span className="text-[13px] text-ink-3">No garage branch yet.</span>
          )}
        </Field>
        <Field label="Promised for">
          <input type="datetime-local" className={input} value={target} onChange={(e) => setTarget(e.target.value)} aria-label="Promised for" />
        </Field>
        <Field label="Job type">
          <Select aria-label="Job type" value={type} onChange={(e) => setType(e.target.value)} options={o.job_types.map((t) => ({ value: t, label: nice(t) }))} className={input} />
        </Field>
        <Field label="Priority">
          <Select aria-label="Priority" value={priority} onChange={(e) => setPriority(e.target.value)} options={o.priorities.map((p) => ({ value: p, label: nice(p) }))} className={input} />
        </Field>
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-[12.5px] font-semibold text-ink-2">Workflow</span>
        <div className="flex gap-2">
          {[
            ['standard', 'Standard — inspect, diagnose, estimate'],
            ['express', 'Express — straight to the estimate'],
          ].map(([v, l]) => (
            <button key={v} type="button" aria-pressed={pipeline === v} onClick={() => setPipeline(v!)} className={cx('flex-1 rounded-[8px] border px-3 py-2 text-left text-[13px]', pipeline === v ? 'border-primary bg-selection text-primary' : 'border-line text-ink-2')}>
              {l}
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-[12.5px] font-semibold text-ink-2">What the customer says</span>
        {o.complaints.length ? (
          <div className="flex flex-wrap gap-1.5 pb-1">
            {o.complaints.map((c) => (
              <button key={c} type="button" onClick={() => add(c)} className="rounded-full border border-line px-2.5 py-0.5 text-[12px] text-ink-2 hover:border-primary hover:text-primary">
                {c}
              </button>
            ))}
          </div>
        ) : null}
        <div className="flex gap-2">
          <input
            className={input}
            aria-label="Complaint"
            value={complaint}
            onChange={(e) => setComplaint(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                add(complaint);
              }
            }}
            placeholder="Type a complaint and press Enter"
          />
          <Button onClick={() => add(complaint)}>Add</Button>
        </div>
        {complaints.length > 0 ? (
          <ul className="m-0 mt-1 flex list-none flex-col gap-1 p-0">
            {complaints.map((c) => (
              <li key={c} className="flex items-center justify-between rounded-[8px] bg-subtle px-3 py-1.5 text-[13px]">
                {c}
                <IconButton icon="x" label={`Remove ${c}`} size={14} onClick={() => setComplaints(complaints.filter((x) => x !== c))} />
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <Field label="Requested services">
        <textarea className={cx(input, 'h-auto py-2')} rows={2} value={requested} onChange={(e) => setRequested(e.target.value)} placeholder="Full service, wheel alignment…" />
      </Field>
      <div className="flex justify-end">
        <Button variant="primary" loading={busy} disabled={!vehicle || !customer || !chosenBranch} onClick={() => void create()}>
          Create the job
        </Button>
      </div>
      {openJobs ? (
        <Modal
          title="This vehicle has an open job"
          onClose={() => setOpenJobs(null)}
          footer={
            <div className="flex justify-end gap-2">
              <Button onClick={() => g.openJob(openJobs[0]!.id)}>Open {openJobs[0]!.number}</Button>
              <Button variant="primary" loading={busy} onClick={() => void create(true)}>
                Create another job card
              </Button>
            </div>
          }
        >
          <p className="m-0 text-[13px] text-ink-2">{openJobs.map((j) => j.number).join(', ')} is still open for this vehicle. A second job card is for separate work, on purpose.</p>
        </Modal>
      ) : null}
    </div>
  );
}

/** Add a customer to CRM (FR-WLK-01); a likely duplicate is answered with the candidates. */
function NewCustomer({ seed, onClose, onPicked }: { seed: string; onClose: () => void; onPicked: (c: Customer) => void }) {
  const g = useGarage();
  const digits = seed.replace(/\D/g, '');
  const [name, setName] = useState(digits.length >= 6 ? '' : seed);
  const [phone, setPhone] = useState(digits.length >= 6 ? seed : '');
  const [email, setEmail] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [candidates, setCandidates] = useState<Customer[] | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async (force = false) => {
    setBusy(true);
    try {
      const r = await gPost<{ id: number; customer: Customer }>('/customers', { name, phone, email, whatsapp, force, org: g.org });
      toast('success', r.message);
      onPicked(r.data.customer);
    } catch (e) {
      const c = errorData<{ candidates?: Customer[] }>(e)?.candidates;
      if (c && c.length > 0) setCandidates(c);
      else toast('error', errorText(e, 'The customer could not be added.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="New customer" onClose={onClose}>
      {candidates ? (
        <div className="flex flex-col gap-3">
          <p className="m-0 text-[13px] text-ink-2">This customer may already be in CRM. Choose them, or add a new one if they are someone else.</p>
          <ul className="m-0 list-none divide-y divide-line overflow-hidden rounded-[10px] border border-line p-0">
            {candidates.map((c) => (
              <li key={c.id}>
                <button type="button" onClick={() => onPicked(c)} className="w-full px-3 py-2 text-left hover:bg-subtle">
                  <b className="block text-[13px]">{c.name}</b>
                  <span className="text-[12px] text-ink-3">{[c.phone, c.email].filter(Boolean).join(' · ')}</span>
                </button>
              </li>
            ))}
          </ul>
          <div className="flex justify-between">
            <Button variant="ghost" onClick={() => setCandidates(null)}>
              Back
            </Button>
            <Button loading={busy} onClick={() => void save(true)}>
              They are someone else — add
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <Field label="Name">
            <input className={input} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Phone">
              <input className={input} value={phone} onChange={(e) => setPhone(e.target.value)} />
            </Field>
            <Field label="Email">
              <input className={input} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <Field label="WhatsApp">
              <input className={input} value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} />
            </Field>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" loading={busy} disabled={!name.trim()} onClick={() => void save()}>
              Add to CRM
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

/** Add a vehicle (FR-VEH-01/02); the same plate or VIN already on file is answered with that vehicle. */
function NewVehicle({ seed, customer, onClose, onPicked }: { seed: string; customer: Customer | null; onClose: () => void; onPicked: (v: VehicleBrief) => void }) {
  const g = useGarage();
  const o = g.options;
  const [f, setF] = useState({
    vehicle_number: /\d/.test(seed) && seed.replace(/\D/g, '').length < 6 ? seed.toUpperCase() : '',
    vin: '',
    make: '',
    model: '',
    year: '',
    colour: '',
    vehicle_type: o.vehicle_types.includes('car') ? 'car' : (o.vehicle_types[0] ?? ''),
    fuel_type: '',
    transmission: '',
    odometer: '',
  });
  const [dup, setDup] = useState<VehicleBrief | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (v: string) => setF({ ...f, [k]: v });
  const makes = useMemo(() => Array.from(new Set(o.models.filter((m) => m.active).map((m) => m.make))), [o]);
  const models = useMemo(() => o.models.filter((m) => m.active && m.make === f.make).map((m) => m.model), [o, f.make]);
  const save = async () => {
    setBusy(true);
    try {
      const r = await gPost<{ id: number; vehicle: VehicleBrief }>('/vehicles', { ...f, year: f.year || undefined, client_id: customer?.id, org_id: Number(g.org) || undefined });
      toast('success', r.message);
      onPicked({ ...r.data.vehicle, customer_name: customer?.name ?? null, customer_phone: customer?.phone ?? null, open: [] });
    } catch (e) {
      const d = errorData<{ duplicate?: VehicleBrief }>(e)?.duplicate;
      if (d) setDup(d);
      toast('error', errorText(e, 'The vehicle could not be added.'));
    } finally {
      setBusy(false);
    }
  };
  const opt = (list: string[]) => [{ value: '', label: '—' }, ...list.map((t) => ({ value: t, label: nice(t) }))];
  return (
    <Modal
      title="New vehicle"
      onClose={onClose}
      width={600}
      footer={
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 text-[12px] text-ink-3">{customer ? `Owner: ${customer.name}` : 'No owner chosen — choose or add the customer to link them.'}</span>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} disabled={!f.vehicle_number.trim() || (o.require_vin && !f.vin.trim())} onClick={() => void save()}>
            Add vehicle
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        {dup ? (
          <div className="rounded-[10px] bg-warning-bg p-3 text-[13px] text-warning">
            {dup.vehicle_number} is already on file.{' '}
            <button type="button" className="font-semibold underline" onClick={() => openWeb(`/garage?vehicle=${dup.id}`)}>
              Open it
            </button>
          </div>
        ) : null}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Plate">
            <input className={input} value={f.vehicle_number} onChange={(e) => set('vehicle_number')(e.target.value.toUpperCase())} autoFocus />
          </Field>
          <Field label={o.require_vin ? 'VIN / chassis number' : 'VIN / chassis number (optional)'}>
            <input className={input} value={f.vin} onChange={(e) => set('vin')(e.target.value.toUpperCase())} />
          </Field>
          <Field label="Make">
            <input className={input} list="garage-makes" value={f.make} onChange={(e) => set('make')(e.target.value)} />
            <datalist id="garage-makes">
              {makes.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </Field>
          <Field label="Model">
            <input className={input} list="garage-models" value={f.model} onChange={(e) => set('model')(e.target.value)} />
            <datalist id="garage-models">
              {models.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </Field>
          <Field label="Year">
            <input className={input} inputMode="numeric" value={f.year} onChange={(e) => set('year')(e.target.value.replace(/\D/g, '').slice(0, 4))} />
          </Field>
          <Field label="Colour">
            <input className={input} value={f.colour} onChange={(e) => set('colour')(e.target.value)} />
          </Field>
          <Field label="Type">
            <Select aria-label="Vehicle type" value={f.vehicle_type} onChange={(e) => set('vehicle_type')(e.target.value)} options={o.vehicle_types.map((t) => ({ value: t, label: nice(t) }))} className={input} />
          </Field>
          <Field label="Fuel">
            <Select aria-label="Fuel" value={f.fuel_type} onChange={(e) => set('fuel_type')(e.target.value)} options={opt(o.fuels)} className={input} />
          </Field>
          <Field label="Transmission">
            <Select aria-label="Transmission" value={f.transmission} onChange={(e) => set('transmission')(e.target.value)} options={opt(o.transmissions)} className={input} />
          </Field>
          <Field label={`Odometer (${o.units || 'km'})`}>
            <input className={input} inputMode="numeric" value={f.odometer} onChange={(e) => set('odometer')(e.target.value.replace(/\D/g, ''))} />
          </Field>
        </div>
      </div>
    </Modal>
  );
}

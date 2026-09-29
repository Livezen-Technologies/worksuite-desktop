import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { Spinner, cx } from '../../components/ui';
import { btn, btnPrimary, btnSmall, Field, input, PageHead, Panel } from '../hr/parts';
import {
  companiesWhere,
  fetchCustomer,
  fetchVehicle,
  K,
  localToIso,
  lookupVehicles,
  OFFLINE_WRITE,
  refusalOf,
  searchWalkIn,
  useMayAddCustomer,
  walkIn,
  type Added,
  type CustomerBrief,
  type Options,
  type Refusal,
  type VehicleBrief,
} from './api';
import { Pill } from './parts';

/**
 * A walk-in (SRS WF-03, FR-WLK-01/02): one search box for a phone, a name, a
 * vehicle number or a VIN; the customer (a CRM account — the garage keeps no
 * customer of its own) and the vehicle are picked from what it finds, or
 * added when they are missing; then the job is opened as a draft, at normal
 * priority unless the desk says otherwise (never made urgent by itself).
 *
 * The server is the one that refuses: a vehicle that already has a job open
 * (409 `open_job` — "Open a second job" sends it again, confirmed), a
 * duplicate vehicle number, a vehicle of another customer, a missing branch.
 * When it refused after adding something (the customer went into CRM, then
 * the job was refused), the screen takes what was added, so the next try
 * uses it rather than adding it twice.
 */
export type WalkInCustomer = { kind: 'existing'; id: number; name: string; phone: string | null } | { kind: 'new'; name: string; phone: string; email: string };
export type WalkInVehicle =
  | { kind: 'existing'; id: number; vehicle_number: string; label: string; customer_id: number | null; open_job: VehicleBrief['open_job'] }
  | { kind: 'new'; vehicle_number: string; make: string; model: string; year: string; vin: string; vehicle_type: string; odometer: string };

export interface WalkInDraft {
  org: number | null;
  branch: string;
  customer: WalkInCustomer | null;
  vehicle: WalkInVehicle | null;
  priority: string;
  jobType: string;
  requestedWork: string;
  promised: string;
  confirmOpenJob: boolean;
}

/** What the missing pieces are, in words; empty when the walk-in can be sent. */
export function walkInGaps(d: WalkInDraft): string[] {
  const out: string[] = [];
  if (!d.org) out.push('the company');
  if (!d.vehicle) out.push('the vehicle');
  else if (d.vehicle.kind === 'new' && !d.vehicle.vehicle_number.trim()) out.push('the vehicle number');
  if (!d.customer && !(d.vehicle?.kind === 'existing' && d.vehicle.customer_id)) out.push('the customer');
  else if (d.customer?.kind === 'new' && !d.customer.name.trim()) out.push('the customer’s name');
  return out;
}

/** The body of `POST walk-in` for a draft. */
export function walkInBody(d: WalkInDraft): Record<string, unknown> {
  const body: Record<string, unknown> = { org_id: d.org, priority: d.priority || 'normal', job_type: d.jobType || 'service' };
  if (d.branch) body.branch_id = Number(d.branch);
  if (d.customer?.kind === 'existing') body.customer_id = d.customer.id;
  else if (d.customer?.kind === 'new') body.customer = { name: d.customer.name.trim(), phone: d.customer.phone.trim() || null, email: d.customer.email.trim() || null };
  else if (d.vehicle?.kind === 'existing' && d.vehicle.customer_id) body.customer_id = d.vehicle.customer_id;
  if (d.vehicle?.kind === 'existing') body.vehicle_id = d.vehicle.id;
  else if (d.vehicle?.kind === 'new') {
    const v = d.vehicle;
    body.vehicle = {
      vehicle_number: v.vehicle_number.trim(),
      make: v.make.trim() || null,
      model: v.model.trim() || null,
      year: v.year.trim() ? Number(v.year) : null,
      vin: v.vin.trim() || null,
      vehicle_type: v.vehicle_type || 'car',
      ...(v.odometer.trim() ? { odometer: Number(v.odometer.replace(/[^\d]/g, '')) } : {}),
    };
  }
  if (d.requestedWork.trim()) body.requested_work = d.requestedWork.trim();
  const at = d.promised ? localToIso(d.promised) : null;
  if (at) body.target_completion_at = at;
  if (d.confirmOpenJob) body.confirm_open_job = true;
  return body;
}

/** A draft after a refusal that added something first: the next try uses what is there now. */
export function adoptAdded(d: WalkInDraft, added: Added | null): WalkInDraft {
  if (!added) return d;
  let next = d;
  if (added.customer) next = { ...next, customer: { kind: 'existing', id: added.customer.id, name: added.customer.name, phone: added.customer.phone ?? null } };
  if (added.vehicle) {
    const v = added.vehicle;
    next = { ...next, vehicle: { kind: 'existing', id: v.id, vehicle_number: v.vehicle_number, label: [v.make, v.model].filter(Boolean).join(' '), customer_id: v.customer_id ?? null, open_job: null } };
  }
  return next;
}

function useDebounced<T>(v: T, ms: number): T {
  const [d, setD] = useState(v);
  useEffect(() => {
    const t = setTimeout(() => setD(v), ms);
    return () => clearTimeout(t);
  }, [v, ms]);
  return d;
}

const BLANK_VEHICLE: WalkInVehicle = { kind: 'new', vehicle_number: '', make: '', model: '', year: '', vin: '', vehicle_type: 'car', odometer: '' };

export default function WalkIn({ org, options, online, seedVehicle, onDone, onJob }: { org: string; options: Options; online: boolean; seedVehicle: string | null; onDone: (jobId: number) => void; onJob: (id: number) => void }) {
  const qc = useQueryClient();
  const companies = companiesWhere(options, 'create', org);
  const [draft, setDraft] = useState<WalkInDraft>(() => ({
    org: companies.length === 1 ? companies[0]!.id : null,
    branch: '',
    customer: null,
    vehicle: null,
    priority: 'normal',
    jobType: 'service',
    requestedWork: '',
    promised: '',
    confirmOpenJob: false,
  }));
  const [q, setQ] = useState('');
  const term = useDebounced(q.trim(), 250);
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<Refusal | null>(null);
  const [seedOff, setSeedOff] = useState(false);
  const seeded = useQuery({ queryKey: K.vehicle(Number(seedVehicle) || 0), queryFn: ({ signal }) => fetchVehicle(Number(seedVehicle), signal), enabled: !!seedVehicle && /^\d+$/.test(seedVehicle) && online });
  // A vehicle handed over from its 360° (New job) stands in until the desk picks something else.
  const seed = !seedOff && !draft.vehicle ? seeded.data?.vehicle : undefined;
  const view: WalkInDraft = seed
    ? {
        ...draft,
        org: draft.org ?? seed.org_id,
        vehicle: { kind: 'existing', id: seed.id, vehicle_number: seed.vehicle_number, label: seed.make_model ?? '', customer_id: seed.customer_id, open_job: seed.open_job },
        customer: draft.customer ?? (seed.customer ? { kind: 'existing', id: seed.customer.id, name: seed.customer.name, phone: seed.customer.phone } : null),
      }
    : draft;
  const company = options.companies.find((c) => c.id === view.org);
  const mayAddVehicle = !!company?.can.manage_vehicles;
  const mayAddCustomer = useMayAddCustomer();
  const set = (patch: Partial<WalkInDraft>) => {
    setDraft({ ...view, ...patch, confirmOpenJob: false });
    setSeedOff(true);
    setRefused(null);
  };

  const scope = String(view.org ?? org);
  const found = useQuery({ queryKey: K.search(scope, term), queryFn: ({ signal }) => searchWalkIn(scope, term, signal), enabled: term.length >= 2 && online });
  const chosenCustomer = view.customer?.kind === 'existing' ? view.customer.id : null;
  const theirs = useQuery({ queryKey: K.customer(chosenCustomer ?? 0), queryFn: ({ signal }) => fetchCustomer(chosenCustomer!, signal), enabled: !!chosenCustomer && online });
  const newVehicle = view.vehicle?.kind === 'new' ? view.vehicle : null;
  const lookNumber = useDebounced(newVehicle?.vehicle_number.trim() ?? '', 300);
  const lookVin = useDebounced(newVehicle?.vin.trim() ?? '', 300);
  const dupes = useQuery({
    queryKey: ['garage', 'lookup', view.org, lookNumber, lookVin],
    queryFn: ({ signal }) => lookupVehicles(view.org!, lookNumber, lookVin, signal),
    enabled: !!view.org && online && (lookNumber.length >= 3 || lookVin.length >= 6),
  });

  const pickVehicle = (v: VehicleBrief) => {
    const owner = v.customer && 'id' in v.customer ? v.customer : null;
    set({
      org: view.org ?? v.org_id ?? null,
      vehicle: { kind: 'existing', id: v.id, vehicle_number: v.vehicle_number, label: [v.make, v.model, v.year].filter(Boolean).join(' '), customer_id: v.customer_id, open_job: v.open_job },
      customer: owner ? { kind: 'existing', id: owner.id, name: owner.name, phone: owner.phone } : view.customer,
    });
    setQ('');
  };
  const pickCustomer = (c: Pick<CustomerBrief, 'id' | 'name' | 'phone'>) => {
    // A vehicle of somebody else is not this customer's: it would be refused ("record the new owner first").
    const keep = view.vehicle?.kind === 'existing' && view.vehicle.customer_id !== c.id ? null : view.vehicle;
    set({ customer: { kind: 'existing', id: c.id, name: c.name, phone: c.phone }, vehicle: keep });
    setQ('');
  };

  const gaps = walkInGaps(view);
  const send = async (confirm: boolean) => {
    if (!online) return toast('error', OFFLINE_WRITE);
    setBusy(true);
    setRefused(null);
    try {
      const r = await walkIn(walkInBody({ ...view, confirmOpenJob: confirm }));
      toast('success', r.message || `${r.data.job.number} opened.`);
      void qc.invalidateQueries({ queryKey: K.all });
      onDone(r.data.job.id);
    } catch (e) {
      const p = refusalOf(e);
      setRefused(p);
      setDraft(adoptAdded(view, p.added));
      setSeedOff(true);
      if (p.added) void qc.invalidateQueries({ queryKey: K.all });
    } finally {
      setBusy(false);
    }
  };

  const openJob = refused?.openJob ?? (view.vehicle?.kind === 'existing' ? view.vehicle.open_job : null);
  const branches = company?.branches.filter((b) => b.branch_id > 0) ?? [];

  return (
    <div className="flex max-w-[980px] flex-col gap-3.5 px-6 py-5">
      <PageHead title="New walk-in" sub="Find the customer or the vehicle — by phone, name, vehicle number or VIN — or add them." />
      {!companies.length ? <p className="text-[13px] text-ink-2">Opening jobs is for those who may create them in this company.</p> : null}
      {!online ? <p className="rounded-[9px] bg-warning-bg px-3 py-2 text-[12.5px] font-semibold text-warning">{OFFLINE_WRITE}</p> : null}
      {companies.length > 1 ? (
        <Field label="Company">
          <Select aria-label="Company" value={view.org ? String(view.org) : ''} onValueChange={(v) => set({ org: v ? Number(v) : null, branch: '', customer: null, vehicle: null })} options={[{ value: '', label: 'Which company is the vehicle at?' }, ...companies.map((c) => ({ value: String(c.id), label: c.name }))]} />
        </Field>
      ) : null}

      <label className="flex h-11 items-center gap-2.5 rounded-[10px] border border-line bg-surface px-3 focus-within:border-primary">
        <Icon name="search" size={17} className="text-ink-3" />
        <input autoFocus data-garage-search value={q} onChange={(e) => setQ(e.target.value)} placeholder="Phone, name, vehicle number or VIN" aria-label="Find the customer or vehicle" className="bare-focus min-w-0 flex-1 bg-transparent text-[14px] text-ink outline-none placeholder:text-ink-3" />
        {found.isFetching ? <Icon name="spinner" size={15} className="animate-spin-slow text-ink-3" /> : null}
      </label>
      {term.length >= 2 && found.data ? (
        <div className="grid gap-3 md:grid-cols-2">
          <Panel title="Vehicles" sub={found.data.vehicles.length ? undefined : 'No vehicle matches'} bodyClassName="max-h-[240px]">
            {found.data.vehicles.map((v) => (
              <button key={v.id} type="button" onClick={() => pickVehicle(v)} className="flex w-full items-center gap-2.5 border-b border-line/70 px-3.5 py-2 text-left last:border-b-0 hover:bg-subtle">
                <Icon name="car" size={16} className="shrink-0 text-ink-3" />
                <span className="flex min-w-0 flex-1 flex-col">
                  <b className="text-ink">{v.vehicle_number}</b>
                  <span className="truncate text-[12px] text-ink-3">{[[v.make, v.model, v.year].filter(Boolean).join(' '), v.customer?.name].filter(Boolean).join(' · ')}</span>
                </span>
                {v.open_job ? <Pill tone="amber">{v.open_job.job_number} open</Pill> : null}
              </button>
            ))}
          </Panel>
          <Panel title="Customers" sub={found.data.customers.length ? undefined : 'No customer matches'} bodyClassName="max-h-[240px]">
            {found.data.customers.map((c) => (
              <button key={c.id} type="button" onClick={() => pickCustomer(c)} className="flex w-full items-center gap-2.5 border-b border-line/70 px-3.5 py-2 text-left last:border-b-0 hover:bg-subtle">
                <Icon name="user" size={16} className="shrink-0 text-ink-3" />
                <span className="flex min-w-0 flex-1 flex-col">
                  <b className="truncate text-ink">{c.name}</b>
                  <span className="truncate text-[12px] text-ink-3">{[c.phone, c.email, `${c.vehicles} ${c.vehicles === 1 ? 'vehicle' : 'vehicles'}`].filter(Boolean).join(' · ')}</span>
                </span>
              </button>
            ))}
          </Panel>
        </div>
      ) : null}

      <div className="grid gap-3 md:grid-cols-2">
        <Panel
          title="Customer"
          action={
            view.customer ? (
              <button type="button" className={btnSmall} onClick={() => set({ customer: null, vehicle: view.vehicle?.kind === 'existing' ? null : view.vehicle })}>
                Change
              </button>
            ) : mayAddCustomer ? (
              <button type="button" className={btnSmall} onClick={() => set({ customer: { kind: 'new', name: q.trim() && !/\d{3}/.test(q) ? q.trim() : '', phone: /\d{3}/.test(q) && !/[A-Za-z]{2}/.test(q) ? q.trim() : '', email: '' } })}>
                <Icon name="user-plus" size={14} /> New customer
              </button>
            ) : null
          }
        >
          <div className="flex flex-col gap-2 px-3.5 py-3">
            {view.customer?.kind === 'existing' ? (
              <>
                <b className="text-ink">{view.customer.name}</b>
                <span className="text-[12px] text-ink-3">{view.customer.phone ?? 'No phone recorded'} · in CRM</span>
                {theirs.data && !view.vehicle ? (
                  <div className="flex flex-col gap-1">
                    <span className="text-[11.5px] font-bold tracking-[.4px] text-ink-3 uppercase">Their vehicles</span>
                    {theirs.data.vehicles.map((v) => {
                      const open = theirs.data.open_jobs.find((j) => j.vehicle?.id === v.id);
                      const owner = view.customer?.kind === 'existing' ? { id: view.customer.id, name: view.customer.name, phone: view.customer.phone, email: null } : null;
                      return (
                        <button key={v.id} type="button" className="flex items-center gap-2 rounded-[7px] px-1.5 py-1 text-left text-[12.5px] hover:bg-subtle" onClick={() => pickVehicle({ ...v, customer: owner, open_job: open ? { id: open.id, job_number: open.number, status: open.status } : null })}>
                          <Icon name="car" size={14} className="text-ink-3" /> <b>{v.vehicle_number}</b> <span className="text-ink-3">{[v.make, v.model].filter(Boolean).join(' ')}</span>
                        </button>
                      );
                    })}
                    {!theirs.data.vehicles.length ? <span className="text-[12px] text-ink-3">None recorded yet.</span> : null}
                  </div>
                ) : null}
              </>
            ) : view.customer?.kind === 'new' ? (
              <>
                <Field label="Name">
                  <input aria-label="Customer name" value={view.customer.name} onChange={(e) => set({ customer: { ...(view.customer as Extract<WalkInCustomer, { kind: 'new' }>), name: e.target.value } })} className={input} maxLength={190} />
                </Field>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Phone">
                    <input aria-label="Customer phone" value={view.customer.phone} onChange={(e) => set({ customer: { ...(view.customer as Extract<WalkInCustomer, { kind: 'new' }>), phone: e.target.value } })} className={input} maxLength={40} />
                  </Field>
                  <Field label="Email">
                    <input aria-label="Customer email" type="email" value={view.customer.email} onChange={(e) => set({ customer: { ...(view.customer as Extract<WalkInCustomer, { kind: 'new' }>), email: e.target.value } })} className={input} maxLength={190} />
                  </Field>
                </div>
                <span className="text-[11.5px] text-ink-3">Added to CRM with the job — adding a customer needs CRM’s permission to add accounts.</span>
              </>
            ) : view.vehicle?.kind === 'existing' && view.vehicle.customer_id ? (
              <span className="text-[12.5px] text-ink-2">The vehicle’s owner.</span>
            ) : (
              <span className="text-[12.5px] text-ink-3">{mayAddCustomer ? 'Pick one from the search, or add a new customer.' : 'Pick one from the search. Adding customers is for those who may add CRM accounts.'}</span>
            )}
          </div>
        </Panel>

        <Panel
          title="Vehicle"
          action={
            view.vehicle ? (
              <button type="button" className={btnSmall} onClick={() => set({ vehicle: null })}>
                Change
              </button>
            ) : mayAddVehicle ? (
              <button type="button" className={btnSmall} onClick={() => set({ vehicle: { ...BLANK_VEHICLE, vehicle_number: /\d/.test(q) && /[A-Za-z]/.test(q) ? q.trim().toUpperCase() : '' } as WalkInVehicle })}>
                <Icon name="plus" size={14} /> New vehicle
              </button>
            ) : null
          }
        >
          <div className="flex flex-col gap-2 px-3.5 py-3">
            {view.vehicle?.kind === 'existing' ? (
              <>
                <b className="text-ink">{view.vehicle.vehicle_number}</b>
                <span className="text-[12px] text-ink-3">{view.vehicle.label || 'Make and model not recorded'}</span>
              </>
            ) : newVehicle ? (
              <NewVehicleFields v={newVehicle} options={options} onChange={(v) => set({ vehicle: v })} />
            ) : (
              <span className="text-[12.5px] text-ink-3">{mayAddVehicle ? 'Pick one from the search, or add a new vehicle.' : 'Pick one from the search. Adding vehicles is for those who manage them.'}</span>
            )}
            {newVehicle && dupes.data?.items.length ? (
              <div role="status" className="flex flex-col gap-1 rounded-[8px] bg-warning-bg px-2.5 py-2 text-[12.5px] text-warning">
                {dupes.data.items.map((v) => (
                  <span key={v.id} className="flex items-center gap-2">
                    <span className="flex-1">
                      Already here: <b>{v.vehicle_number}</b> {[v.make, v.model].filter(Boolean).join(' ')} ({v.matched === 'vin' ? 'same VIN' : 'same number'}){v.customer?.name ? `, ${v.customer.name}` : ''}.
                    </span>
                    <button type="button" className="font-semibold underline" onClick={() => pickVehicle(v)}>
                      Use it
                    </button>
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        </Panel>
      </div>

      {openJob ? (
        <div role="alert" className="flex flex-wrap items-center gap-2 rounded-[10px] border border-[#F3D19E] bg-[#FFF8EC] px-3.5 py-2.5 text-[13px] text-[#7A3E05] dark:border-warning/40 dark:bg-warning-bg dark:text-warning">
          <Icon name="warning" size={16} />
          <span className="min-w-0 flex-1">
            This vehicle already has <b>{openJob.job_number}</b> open ({options.statuses[openJob.status] ?? openJob.status}). Carry on with that job, or open a second one.
          </span>
          <button type="button" className={btnSmall} onClick={() => onJob(openJob.id)}>
            Open {openJob.job_number}
          </button>
          {refused?.openJob ? (
            <button type="button" className={btnSmall} disabled={busy} onClick={() => void send(true)}>
              Open a second job
            </button>
          ) : null}
        </div>
      ) : null}

      <Panel title="The job">
        <div className="grid gap-2.5 px-3.5 py-3 md:grid-cols-2">
          <Field label="What the customer asks for">
            <textarea aria-label="Requested work" value={view.requestedWork} onChange={(e) => set({ requestedWork: e.target.value })} rows={2} className={cx(input, 'h-auto py-2')} maxLength={2000} />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Priority">
              <Select aria-label="Priority" value={view.priority} onValueChange={(v) => set({ priority: v })} options={Object.entries(options.priorities).map(([value, label]) => ({ value, label }))} />
            </Field>
            <Field label="Job type">
              <Select aria-label="Job type" value={view.jobType} onValueChange={(v) => set({ jobType: v })} options={Object.entries(options.job_types).map(([value, label]) => ({ value, label }))} />
            </Field>
            <Field label="Promised for" hint="Your clock">
              <input aria-label="Promised for" type="datetime-local" value={view.promised} onChange={(e) => set({ promised: e.target.value })} className={input} />
            </Field>
            {branches.length > 1 ? (
              <Field label="Branch">
                <Select aria-label="Branch" value={view.branch} onValueChange={(v) => set({ branch: v })} options={[{ value: '', label: 'My branch' }, ...branches.map((b) => ({ value: String(b.branch_id), label: b.name }))]} />
              </Field>
            ) : null}
          </div>
        </div>
      </Panel>

      {refused && !refused.openJob ? (
        <div role="alert" className="flex flex-col gap-1 rounded-[9px] bg-danger-bg px-3 py-2 text-[12.5px] text-danger">
          <span className="flex items-start gap-2">
            <Icon name="alert" size={15} className="mt-px shrink-0" />
            <b>{refused.message}</b>
          </span>
          {refused.existing ? (
            <span>
              Already recorded: {refused.existing.vehicle_number ?? refused.existing.name}
              {refused.existing.phone ? ` · ${refused.existing.phone}` : ''}.
            </span>
          ) : null}
          {refused.added ? <span>Added before it stopped: {[refused.added.customer ? `the customer ${refused.added.customer.name}` : null, refused.added.vehicle ? `the vehicle ${refused.added.vehicle.vehicle_number}` : null].filter(Boolean).join(' and ')} — they are used for the next try.</span> : null}
        </div>
      ) : null}

      <div className="flex items-center gap-2">
        <span className="flex-1 text-[12.5px] text-ink-3">{gaps.length ? `Still needed: ${gaps.join(', ')}.` : 'Opened as a draft; the check-in comes next.'}</span>
        <button type="button" className={btn} onClick={() => (setDraft({ ...view, customer: null, vehicle: null, requestedWork: '', promised: '', confirmOpenJob: false }), setSeedOff(true), setRefused(null), setQ(''))}>
          Start again
        </button>
        <button type="button" className={btnPrimary} disabled={busy || !online || gaps.length > 0} onClick={() => void send(false)}>
          {busy ? <Spinner label="" className="p-0" /> : <Icon name="check" size={15} />} Open the job
        </button>
      </div>
    </div>
  );
}

function NewVehicleFields({ v, options, onChange }: { v: Extract<WalkInVehicle, { kind: 'new' }>; options: Options; onChange: (v: WalkInVehicle) => void }) {
  const f = (k: keyof typeof v) => (e: { target: { value: string } }) => onChange({ ...v, [k]: e.target.value });
  return (
    <div className="grid grid-cols-2 gap-2">
      <Field label="Vehicle number">
        <input aria-label="Vehicle number" value={v.vehicle_number} onChange={(e) => onChange({ ...v, vehicle_number: e.target.value.toUpperCase() })} className={input} maxLength={40} />
      </Field>
      <Field label="Type">
        <Select aria-label="Vehicle type" value={v.vehicle_type} onValueChange={(t) => onChange({ ...v, vehicle_type: t })} options={Object.entries(options.vehicle_types).map(([value, label]) => ({ value, label }))} />
      </Field>
      <Field label="Make">
        <input aria-label="Make" value={v.make} onChange={f('make')} className={input} maxLength={60} />
      </Field>
      <Field label="Model">
        <input aria-label="Model" value={v.model} onChange={f('model')} className={input} maxLength={60} />
      </Field>
      <Field label="Year">
        <input aria-label="Year" inputMode="numeric" value={v.year} onChange={(e) => onChange({ ...v, year: e.target.value.replace(/[^\d]/g, '').slice(0, 4) })} className={input} />
      </Field>
      <Field label="Odometer">
        <input aria-label="Odometer" inputMode="numeric" value={v.odometer} onChange={(e) => onChange({ ...v, odometer: e.target.value.replace(/[^\d]/g, '') })} className={input} />
      </Field>
      <Field label="VIN / chassis" className="col-span-2">
        <input aria-label="VIN" value={v.vin} onChange={(e) => onChange({ ...v, vin: e.target.value.toUpperCase() })} className={input} maxLength={40} />
      </Field>
    </div>
  );
}

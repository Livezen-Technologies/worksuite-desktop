import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { ErrorNote, Spinner, Switch, cx } from '../../components/ui';
import { btn, btnPrimary, btnSmall, Field, input, PageHead, Panel, Sheet } from '../hr/parts';
import {
  fetchBranches,
  fetchCandidates,
  fetchPipelines,
  fetchRecords,
  fetchWizard,
  K,
  markStep,
  OFFLINE_WRITE,
  refusalOf,
  saveBranch,
  saveRecord,
  type Branch,
  type Company,
  type Options,
  type SetupRecord,
  type WizardStep,
} from './api';
import { Pill } from './parts';

/**
 * The first-time set-up (SRS §27, §28.13, FR-APP-04), one company at a time:
 * the seventeen steps with what is done, and each step's records edited in
 * place — branches and their hours and warehouses, workshops, bays,
 * technicians, labour rates, service types — plus skills and the make/model
 * catalogue. A required step is done by creating what it asks for (the
 * server reads it from the records); an optional one can be skipped or
 * marked done. Reading is for everyone in Garage; changing is for those who
 * may set it up.
 */
type Kind = 'workshops' | 'bays' | 'technicians' | 'labor-rates' | 'service-types' | 'skills' | 'vehicle-models';

interface Ctx {
  company: Company;
  options: Options;
  records: Partial<Record<Kind, SetupRecord[]>>;
  pipelines: Array<{ code: string; name: string }>;
  candidates: Array<{ id: number; name: string | null }>;
}

type Opt = { value: string; label: string };
interface FieldSpec {
  key: string;
  label: string;
  type: 'text' | 'code' | 'number' | 'money' | 'bool' | 'select' | 'multi';
  required?: boolean;
  /** Only when the record is new (a technician's person). */
  createOnly?: boolean;
  options?: (c: Ctx) => Opt[];
}

const branchOpts = (c: Ctx): Opt[] => [{ value: '', label: 'The company as a whole' }, ...c.company.branches.filter((b) => b.branch_id > 0).map((b) => ({ value: String(b.branch_id), label: b.name }))];
const recOpts = (kind: Kind, label: (r: SetupRecord) => string, value = (r: SetupRecord) => String(r.id)) => (c: Ctx): Opt[] => (c.records[kind] ?? []).map((r) => ({ value: value(r), label: label(r) }));
const labels = (m: Record<string, string>): Opt[] => Object.entries(m).map(([value, label]) => ({ value, label }));
const skillOpts = (c: Ctx): Opt[] => {
  const recorded = (c.records.skills ?? []).map((r) => ({ value: String(r.code), label: String(r.name) }));
  return recorded.length ? recorded : labels(c.options.default_skills);
};

export const KINDS: Record<Kind, { title: string; one: string; fields: FieldSpec[]; show: (r: SetupRecord, c: Ctx) => string }> = {
  workshops: {
    title: 'Workshops',
    one: 'workshop',
    fields: [
      { key: 'code', label: 'Code', type: 'code', required: true },
      { key: 'name', label: 'Name', type: 'text', required: true },
      { key: 'branch_id', label: 'Branch', type: 'select', options: branchOpts },
      { key: 'active', label: 'In use', type: 'bool' },
    ],
    show: (r, c) => c.company.branches.find((b) => b.branch_id === r.branch_id)?.name ?? '',
  },
  bays: {
    title: 'Service bays',
    one: 'bay',
    fields: [
      { key: 'code', label: 'Code', type: 'code', required: true },
      { key: 'name', label: 'Name', type: 'text', required: true },
      { key: 'branch_id', label: 'Branch', type: 'select', options: branchOpts },
      { key: 'workshop_id', label: 'Workshop', type: 'select', options: (c) => [{ value: '', label: 'None' }, ...recOpts('workshops', (r) => String(r.name))(c)] },
      { key: 'bay_type', label: 'Type', type: 'select', options: (c) => labels(c.options.bay_types) },
      { key: 'capabilities', label: 'Can take', type: 'multi', options: skillOpts },
      { key: 'active', label: 'In use', type: 'bool' },
    ],
    show: (r, c) => [c.options.bay_types[String(r.bay_type)] ?? r.bay_type, r.status_label].filter(Boolean).join(' · '),
  },
  technicians: {
    title: 'Technicians',
    one: 'technician',
    fields: [
      { key: 'user_id', label: 'Person', type: 'select', required: true, createOnly: true, options: (c) => c.candidates.map((p) => ({ value: String(p.id), label: p.name ?? `#${p.id}` })) },
      { key: 'branch_id', label: 'Branch', type: 'select', options: branchOpts },
      { key: 'workshop_id', label: 'Workshop', type: 'select', options: (c) => [{ value: '', label: 'None' }, ...recOpts('workshops', (r) => String(r.name))(c)] },
      { key: 'labor_rate_id', label: 'Labour rate', type: 'select', options: (c) => [{ value: '', label: 'The default' }, ...recOpts('labor-rates', (r) => `${r.name} · ${r.currency ?? ''} ${r.amount ?? ''}`.trim())(c)] },
      { key: 'skills', label: 'Skills', type: 'multi', options: skillOpts },
      { key: 'active', label: 'Working here', type: 'bool' },
    ],
    show: (r) => (Array.isArray(r.skills) ? (r.skills as string[]).join(', ') : ''),
  },
  'labor-rates': {
    title: 'Labour rates',
    one: 'labour rate',
    fields: [
      { key: 'code', label: 'Code', type: 'code', required: true },
      { key: 'name', label: 'Name', type: 'text', required: true },
      { key: 'rate_type', label: 'Kind', type: 'select', options: (c) => labels(c.options.rate_types) },
      { key: 'amount', label: 'Amount', type: 'money', required: true },
      { key: 'currency', label: 'Currency', type: 'code' },
      { key: 'branch_id', label: 'Branch', type: 'select', options: branchOpts },
      { key: 'skill_code', label: 'For the skill', type: 'select', options: (c) => [{ value: '', label: 'Any' }, ...skillOpts(c)] },
      { key: 'is_default', label: 'The default rate', type: 'bool' },
      { key: 'active', label: 'In use', type: 'bool' },
    ],
    show: (r, c) => `${r.currency ?? c.company.currency} ${r.amount ?? ''}${r.is_default ? ' · default' : ''}`,
  },
  'service-types': {
    title: 'Service types',
    one: 'service type',
    fields: [
      { key: 'code', label: 'Code', type: 'code', required: true },
      { key: 'name', label: 'Name', type: 'text', required: true },
      { key: 'job_type', label: 'Job type', type: 'select', options: (c) => labels(c.options.job_types) },
      { key: 'default_minutes', label: 'Usual minutes', type: 'number' },
      { key: 'pipeline_code', label: 'Pipeline', type: 'select', options: (c) => [{ value: '', label: 'The default' }, ...c.pipelines.map((p) => ({ value: p.code, label: p.name }))] },
      { key: 'active', label: 'Offered', type: 'bool' },
    ],
    show: (r, c) => [c.options.job_types[String(r.job_type)] ?? r.job_type, r.default_minutes ? `${r.default_minutes} min` : null].filter(Boolean).join(' · '),
  },
  skills: {
    title: 'Skills',
    one: 'skill',
    fields: [
      { key: 'code', label: 'Code', type: 'code', required: true },
      { key: 'name', label: 'Name', type: 'text', required: true },
      { key: 'active', label: 'In use', type: 'bool' },
    ],
    show: () => '',
  },
  'vehicle-models': {
    title: 'Makes and models',
    one: 'make and model',
    fields: [
      { key: 'make', label: 'Make', type: 'text', required: true },
      { key: 'model', label: 'Model', type: 'text', required: true },
      { key: 'vehicle_type', label: 'Type', type: 'select', options: (c) => labels(c.options.vehicle_types) },
      { key: 'active', label: 'In use', type: 'bool' },
    ],
    show: (r, c) => c.options.vehicle_types[String(r.vehicle_type)] ?? '',
  },
};

/** Which records a step is done by. */
const STEP_KIND: Record<string, Kind | 'branches' | 'warehouses' | 'pipelines' | 'first_job'> = {
  branches: 'branches',
  warehouses: 'warehouses',
  workshops: 'workshops',
  bays: 'bays',
  technicians: 'technicians',
  labor_rates: 'labor-rates',
  service_types: 'service-types',
  pipelines: 'pipelines',
  first_job: 'first_job',
};

const STATUS: Record<WizardStep['status'], { label: string; tone: 'green' | 'amber' | 'grey' | 'blue' }> = {
  done: { label: 'Done', tone: 'green' },
  pending: { label: 'To do', tone: 'amber' },
  skipped: { label: 'Skipped', tone: 'grey' },
  default: { label: 'Defaults', tone: 'blue' },
  later: { label: 'Later', tone: 'grey' },
};

/** The form's value for a record field; what is sent back is `valueOut`. */
export function valueIn(f: FieldSpec, v: unknown): string {
  if (f.type === 'bool') return v === undefined ? (f.key === 'is_default' ? '0' : '1') : v === true || v === 1 || v === '1' ? '1' : '0';
  if (f.type === 'multi') return Array.isArray(v) ? v.map(String).join(',') : '';
  return v === null || v === undefined ? '' : String(v);
}

export function valueOut(f: FieldSpec, v: string): unknown {
  if (f.type === 'bool') return v === '1';
  if (f.type === 'multi') return v ? v.split(',').filter(Boolean) : [];
  if (f.type === 'number') return v.trim() === '' ? null : Number(v);
  if (f.key.endsWith('_id')) return v === '' ? null : Number(v);
  if (f.type === 'code') return v.trim() || null;
  return v.trim() === '' ? null : v.trim();
}

export default function Setup({ org, options, online, onWalkIn }: { org: string; options: Options; online: boolean; onWalkIn: (() => void) | null }) {
  const qc = useQueryClient();
  const companies = options.companies.filter((c) => !org || String(c.id) === org);
  const first = companies.find((c) => !c.setup_complete && c.can.settings) ?? companies.find((c) => c.can.settings) ?? companies[0];
  const [picked, setPicked] = useState<number | null>(null);
  const company = companies.find((c) => c.id === picked) ?? first;
  const [step, setStep] = useState<string | null>(null);
  const wizard = useQuery({ queryKey: K.wizard(company?.id ?? 0), queryFn: ({ signal }) => fetchWizard(company!.id, signal), enabled: !!company });
  if (!company) return <p className="m-6 text-[13px] text-ink-2">There is no company to set up here.</p>;
  const w = wizard.data;
  const may = !!w?.may_manage && online;
  const current = w?.steps.find((s) => s.key === step) ?? w?.steps.find((s) => s.required && s.status !== 'done') ?? w?.steps[0];
  const doneCount = w?.steps.filter((s) => s.status === 'done').length ?? 0;
  const refresh = () => void qc.invalidateQueries({ queryKey: K.all });

  const mark = async (s: WizardStep, action: 'skip' | 'done' | 'reopen') => {
    if (!online) return toast('error', OFFLINE_WRITE);
    try {
      await markStep(s.key, company.id, action);
      refresh();
    } catch (e) {
      toast('error', refusalOf(e).message);
    }
  };

  return (
    <div className="flex flex-col gap-3 px-6 py-5">
      <PageHead title="Set-up" sub={w ? (w.complete ? `${company.name} is set up — ${doneCount} of ${w.steps.length} steps done.` : `Configure the workshop before the first service job: ${w.required_left} required ${w.required_left === 1 ? 'step' : 'steps'} left.`) : company.name}>
        {companies.length > 1 ? <Select label="Company" value={String(company.id)} onValueChange={(v) => (setPicked(Number(v)), setStep(null))} options={companies.map((c) => ({ value: String(c.id), label: c.name }))} /> : null}
      </PageHead>
      {w && !w.may_manage ? <p className="m-0 rounded-[9px] bg-subtle px-3 py-2 text-[12.5px] text-ink-2">You can read the set-up; changing it is for those who may set up Garage.</p> : null}
      {wizard.isLoading ? <Spinner /> : wizard.error ? <ErrorNote error={wizard.error} onRetry={() => void wizard.refetch()} /> : null}
      {w ? (
        <div className="flex min-h-0 flex-wrap items-start gap-3">
          <nav aria-label="Set-up steps" className="flex w-[260px] shrink-0 flex-col gap-0.5 rounded-[12px] border border-line bg-surface p-2">
            <div className="mx-1.5 mb-1.5 h-1.5 overflow-hidden rounded-full bg-subtle" aria-label={`${doneCount} of ${w.steps.length} done`}>
              <span className="block h-full rounded-full bg-success" style={{ width: `${(doneCount / Math.max(1, w.steps.length)) * 100}%` }} />
            </div>
            {w.steps.map((s) => (
              <button key={s.key} type="button" aria-current={current?.key === s.key ? 'step' : undefined} onClick={() => setStep(s.key)} className={cx('flex items-center gap-2 rounded-[8px] px-2 py-1.5 text-left text-[12.5px]', current?.key === s.key ? 'bg-selection font-bold text-primary' : 'text-ink hover:bg-subtle')}>
                <span className={cx('flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10.5px] font-bold', s.status === 'done' ? 'bg-success text-white' : 'bg-subtle text-ink-2')}>{s.status === 'done' ? <Icon name="check" size={12} /> : s.number}</span>
                <span className="min-w-0 flex-1 truncate">{s.title}</span>
                {s.required && s.status !== 'done' ? <Pill tone="amber">Required</Pill> : s.status !== 'done' && s.status !== 'pending' ? <Pill tone={STATUS[s.status].tone}>{STATUS[s.status].label}</Pill> : null}
              </button>
            ))}
            <div className="mt-2 border-t border-line px-2 pt-2 text-[11px] font-bold tracking-[.5px] text-ink-3 uppercase">Also</div>
            {(['skills', 'vehicle-models'] as Kind[]).map((k) => (
              <button key={k} type="button" aria-current={step === `x:${k}` ? 'step' : undefined} onClick={() => setStep(`x:${k}`)} className={cx('rounded-[8px] px-2 py-1.5 text-left text-[12.5px]', step === `x:${k}` ? 'bg-selection font-bold text-primary' : 'text-ink hover:bg-subtle')}>
                {KINDS[k].title}
              </button>
            ))}
          </nav>
          <div className="flex min-w-[420px] flex-1 flex-col gap-3">
            {step?.startsWith('x:') ? (
              <Records kind={step.slice(2) as Kind} company={company} options={options} may={may} onChanged={refresh} />
            ) : current ? (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="m-0 flex-1 text-[16px] font-bold text-ink">
                    {current.number}. {current.title}
                  </h2>
                  <Pill tone={STATUS[current.status].tone}>{current.required && current.status === 'pending' ? 'Required' : STATUS[current.status].label}</Pill>
                  {!current.required && current.status !== 'later' && may ? (
                    current.status === 'done' || current.status === 'skipped' ? (
                      <button type="button" className={btnSmall} onClick={() => void mark(current, 'reopen')}>
                        Reopen
                      </button>
                    ) : (
                      <>
                        <button type="button" className={btnSmall} onClick={() => void mark(current, 'skip')}>
                          Skip
                        </button>
                        <button type="button" className={btnSmall} onClick={() => void mark(current, 'done')}>
                          Mark done
                        </button>
                      </>
                    )
                  ) : null}
                </div>
                <StepBody step={current} company={company} options={options} may={may} onChanged={refresh} onWalkIn={onWalkIn} />
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function StepBody({ step, company, options, may, onChanged, onWalkIn }: { step: WizardStep; company: Company; options: Options; may: boolean; onChanged: () => void; onWalkIn: (() => void) | null }) {
  const kind = STEP_KIND[step.key];
  if (step.key === 'organization') return <p className="m-0 text-[13px] text-ink-2">Garage is set up for {company.name}. Each company is set up on its own.</p>;
  if (kind === 'branches' || kind === 'warehouses') return <Branches company={company} may={may} focus={kind} onChanged={onChanged} />;
  if (kind === 'pipelines') return <Pipelines company={company} />;
  if (kind === 'first_job')
    return (
      <div className="flex items-center gap-3 text-[13px] text-ink-2">
        <span className="flex-1">A guided walk-in: find or add the customer and the vehicle, and open the job.</span>
        {onWalkIn ? (
          <button type="button" className={btnPrimary} onClick={onWalkIn}>
            <Icon name="plus" size={15} /> New walk-in
          </button>
        ) : null}
      </div>
    );
  if (kind) return <Records kind={kind} company={company} options={options} may={may} onChanged={onChanged} />;
  const words: Record<string, string> = {
    inspections: 'Inspection templates come with the inspections themselves, in the next Garage update. Skip this step for now, or mark it done if you have none to add.',
    qc: 'The quality-control checklist from the specification is created with the company’s first job. It can be changed with the QC screens in the next Garage update.',
    approvals: 'The estimate approval defaults are in force until they are changed in Settings.',
    notifications: 'Garage’s notifications go through the Notification Centre with its defaults; each person chooses their own channels.',
    packages: 'Service packages arrive in a later Garage phase.',
    warranty: 'Warranties arrive in a later Garage phase.',
    portal: 'The customer portal arrives in a later Garage phase.',
  };
  return <p className="m-0 text-[13px] text-ink-2">{words[step.key] ?? 'Nothing to configure here yet.'}</p>;
}

function Pipelines({ company }: { company: Company }) {
  const q = useQuery({ queryKey: K.pipelines(company.id), queryFn: ({ signal }) => fetchPipelines(company.id, signal) });
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorNote error={q.error} onRetry={() => void q.refetch()} />;
  return (
    <Panel title="Pipelines" sub="Seeded for every company; the workflow builder arrives in a later phase.">
      {(q.data?.items ?? []).map((p) => (
        <div key={p.id} className="flex items-center gap-2 border-b border-line/70 px-3.5 py-2 text-[12.5px] last:border-b-0">
          <b className="text-ink">{p.name}</b>
          <span className="flex-1 text-ink-3">{[p.inspection_required ? 'inspects first' : 'no inspection', p.express ? 'express' : null].filter(Boolean).join(' · ')}</span>
          {p.is_default ? <Pill tone="blue">Default</Pill> : null}
        </div>
      ))}
    </Panel>
  );
}

const DAYS: Array<[string, string]> = [
  ['mon', 'Mon'],
  ['tue', 'Tue'],
  ['wed', 'Wed'],
  ['thu', 'Thu'],
  ['fri', 'Fri'],
  ['sat', 'Sat'],
  ['sun', 'Sun'],
];

function Branches({ company, may, focus, onChanged }: { company: Company; may: boolean; focus: 'branches' | 'warehouses'; onChanged: () => void }) {
  const q = useQuery({ queryKey: K.branches(company.id), queryFn: ({ signal }) => fetchBranches(company.id, signal) });
  const rates = useQuery({ queryKey: K.records('labor-rates', company.id), queryFn: ({ signal }) => fetchRecords('labor-rates', company.id, signal) });
  const [editing, setEditing] = useState<Branch | null>(null);
  if (q.isLoading) return <Spinner />;
  if (q.error || !q.data) return <ErrorNote error={q.error} onRetry={() => void q.refetch()} />;
  const warehouses = q.data.warehouses;
  return (
    <Panel title={focus === 'warehouses' ? 'Warehouses for each branch' : 'Garage branches'} sub={focus === 'warehouses' ? 'Every garage branch takes its parts from an Inventory warehouse.' : 'The branches that run a workshop, and their hours.'}>
      {q.data.items.map((b) => (
        <div key={b.branch_id} className="flex items-center gap-2.5 border-b border-line/70 px-3.5 py-2 text-[12.5px] last:border-b-0">
          <span className="flex min-w-0 flex-1 flex-col">
            <b className="text-ink">{b.name}</b>
            <span className="truncate text-ink-3">
              {[b.enabled ? 'Runs a workshop' : 'No workshop', warehouses.find((w) => w.id === b.warehouse_id)?.name ?? (b.enabled ? 'no warehouse yet' : null), b.hours ? Object.entries(b.hours).map(([d, [from, to]]) => `${d} ${from}–${to}`).join(', ') : null].filter(Boolean).join(' · ')}
            </span>
          </span>
          {b.enabled && !b.warehouse_id ? <Pill tone="amber">Needs a warehouse</Pill> : null}
          {may ? (
            <button type="button" className={btnSmall} onClick={() => setEditing(b)}>
              Edit
            </button>
          ) : null}
        </div>
      ))}
      {editing ? (
        <BranchSheet
          b={editing}
          company={company}
          warehouses={warehouses}
          rates={(rates.data?.items ?? []).map((r) => ({ value: String(r.id), label: String(r.name) }))}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            onChanged();
          }}
        />
      ) : null}
    </Panel>
  );
}

function BranchSheet({ b, company, warehouses, rates, onClose, onSaved }: { b: Branch; company: Company; warehouses: Array<{ id: number; name: string }>; rates: Opt[]; onClose: () => void; onSaved: () => void }) {
  const [enabled, setEnabled] = useState(b.enabled);
  const [warehouse, setWarehouse] = useState(b.warehouse_id ? String(b.warehouse_id) : '');
  const [rate, setRate] = useState(b.labor_rate_id ? String(b.labor_rate_id) : '');
  const [hours, setHours] = useState<Record<string, [string, string]>>(() => ({ ...(b.hours ?? {}) }));
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const save = async () => {
    setBusy(true);
    setRefused(null);
    try {
      await saveBranch(b.branch_id, { org_id: company.id, enabled, warehouse_id: warehouse ? Number(warehouse) : null, price_list_id: b.price_list_id, labor_rate_id: rate ? Number(rate) : null, hours });
      toast('success', `${b.name} saved.`);
      onSaved();
    } catch (e) {
      setRefused(refusalOf(e).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      title={b.name}
      width={520}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} disabled={busy} onClick={() => void save()}>
            Save
          </button>
        </>
      }
    >
      <label className="flex items-center gap-2 text-[13px] font-semibold text-ink">
        <Switch label="Runs a workshop" checked={enabled} onChange={setEnabled} /> Runs a workshop
      </label>
      <Field label="Parts come from">
        <Select aria-label="Warehouse" value={warehouse} onValueChange={setWarehouse} options={[{ value: '', label: 'No warehouse yet' }, ...warehouses.map((w) => ({ value: String(w.id), label: w.name }))]} />
      </Field>
      <Field label="Labour rate">
        <Select aria-label="Labour rate" value={rate} onValueChange={setRate} options={[{ value: '', label: 'The company’s default' }, ...rates]} />
      </Field>
      <span className="text-[12.5px] font-semibold text-ink">Hours</span>
      <div className="flex flex-col gap-1">
        {DAYS.map(([d, label]) => {
          const h = hours[d];
          return (
            <div key={d} className="flex items-center gap-2 text-[12.5px]">
              <label className="flex w-[70px] items-center gap-1.5">
                <input type="checkbox" checked={!!h} onChange={(e) => setHours((x) => (e.target.checked ? { ...x, [d]: ['08:00', '17:00'] } : Object.fromEntries(Object.entries(x).filter(([k]) => k !== d))))} /> {label}
              </label>
              {h ? (
                <>
                  <input type="time" aria-label={`${label} opens`} value={h[0]} onChange={(e) => setHours((x) => ({ ...x, [d]: [e.target.value, h[1]] }))} className={cx(input, 'w-[110px]')} />
                  <span className="text-ink-3">to</span>
                  <input type="time" aria-label={`${label} closes`} value={h[1]} onChange={(e) => setHours((x) => ({ ...x, [d]: [h[0], e.target.value] }))} className={cx(input, 'w-[110px]')} />
                </>
              ) : (
                <span className="text-ink-3">Closed</span>
              )}
            </div>
          );
        })}
      </div>
      {refused ? (
        <p role="alert" className="m-0 rounded-[9px] bg-danger-bg px-3 py-2 text-[12.5px] text-danger">
          {refused}
        </p>
      ) : null}
    </Sheet>
  );
}

function Records({ kind, company, options, may, onChanged }: { kind: Kind; company: Company; options: Options; may: boolean; onChanged: () => void }) {
  const spec = KINDS[kind];
  const q = useQuery({ queryKey: K.records(kind, company.id), queryFn: ({ signal }) => fetchRecords(kind, company.id, signal) });
  // What the form's choices are read from.
  const needs: Kind[] = kind === 'bays' ? ['workshops', 'skills'] : kind === 'technicians' ? ['workshops', 'labor-rates', 'skills'] : kind === 'labor-rates' ? ['skills'] : [];
  const w = useQuery({ queryKey: K.records('workshops', company.id), queryFn: ({ signal }) => fetchRecords('workshops', company.id, signal), enabled: needs.includes('workshops') });
  const s = useQuery({ queryKey: K.records('skills', company.id), queryFn: ({ signal }) => fetchRecords('skills', company.id, signal), enabled: needs.includes('skills') });
  const lr = useQuery({ queryKey: K.records('labor-rates', company.id), queryFn: ({ signal }) => fetchRecords('labor-rates', company.id, signal), enabled: needs.includes('labor-rates') });
  const p = useQuery({ queryKey: K.pipelines(company.id), queryFn: ({ signal }) => fetchPipelines(company.id, signal), enabled: kind === 'service-types' });
  const cand = useQuery({ queryKey: ['garage', 'setup', 'candidates', company.id], queryFn: ({ signal }) => fetchCandidates(company.id, signal), enabled: kind === 'technicians' && may });
  const [editing, setEditing] = useState<SetupRecord | 'new' | null>(null);
  const ctx: Ctx = { company, options, records: { workshops: w.data?.items, skills: s.data?.items, 'labor-rates': lr.data?.items }, pipelines: p.data?.items ?? [], candidates: cand.data?.items ?? [] };
  const rows = q.data?.items ?? [];

  return (
    <Panel
      title={spec.title}
      sub={`${rows.length} recorded`}
      action={
        may ? (
          <button type="button" className={btnSmall} onClick={() => setEditing('new')}>
            <Icon name="plus" size={14} /> Add a {spec.one}
          </button>
        ) : null
      }
    >
      {q.isLoading ? <Spinner /> : q.error ? <ErrorNote error={q.error} onRetry={() => void q.refetch()} /> : null}
      {rows.map((r) => (
        <div key={r.id} className={cx('flex items-center gap-2.5 border-b border-line/70 px-3.5 py-2 text-[12.5px] last:border-b-0', r.active === false && 'opacity-60')}>
          {r.code ? <b className="w-[90px] shrink-0 truncate font-mono text-[12px] text-ink">{String(r.code)}</b> : null}
          <span className="min-w-0 flex-1 truncate text-ink">{String(r.name ?? [r.make, r.model].filter(Boolean).join(' ') ?? '')}</span>
          <span className="shrink-0 truncate text-ink-3">{spec.show(r, ctx)}</span>
          {r.active === false ? <Pill>Not in use</Pill> : null}
          {may ? (
            <button type="button" className={btnSmall} onClick={() => setEditing(r)}>
              Edit
            </button>
          ) : null}
        </div>
      ))}
      {!rows.length && !q.isLoading ? <div className="px-3.5 py-5 text-center text-[12.5px] text-ink-3">None yet.</div> : null}
      {editing ? (
        <RecordSheet
          kind={kind}
          record={editing === 'new' ? null : editing}
          ctx={ctx}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            onChanged();
          }}
        />
      ) : null}
    </Panel>
  );
}

function RecordSheet({ kind, record, ctx, onClose, onSaved }: { kind: Kind; record: SetupRecord | null; ctx: Ctx; onClose: () => void; onSaved: () => void }) {
  const spec = KINDS[kind];
  const fields = spec.fields.filter((f) => !(record && f.createOnly));
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(fields.map((f) => [f.key, valueIn(f, record?.[f.key] ?? (f.key === 'currency' ? ctx.company.currency : undefined))])));
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<{ message: string; field: string | null } | null>(null);
  const ready = fields.every((f) => !f.required || values[f.key]?.trim());
  const save = async () => {
    setBusy(true);
    setRefused(null);
    try {
      const body: Record<string, unknown> = Object.fromEntries(fields.map((f) => [f.key, valueOut(f, values[f.key] ?? '')]));
      if (!record) body.org_id = ctx.company.id;
      const r = await saveRecord(kind, record?.id ?? null, body);
      toast('success', r.message || 'Saved.');
      onSaved();
    } catch (e) {
      const p = refusalOf(e);
      setRefused({ message: p.message, field: p.field });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      title={record ? `Edit the ${spec.one}` : `Add a ${spec.one}`}
      width={520}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} disabled={busy || !ready} onClick={() => void save()}>
            Save
          </button>
        </>
      }
    >
      {fields.map((f) => {
        const v = values[f.key] ?? '';
        const set = (x: string) => setValues((s) => ({ ...s, [f.key]: x }));
        const bad = refused?.field === f.key;
        if (f.type === 'bool')
          return (
            <label key={f.key} className="flex items-center gap-2 text-[13px] font-semibold text-ink">
              <Switch label={f.label} checked={v === '1'} onChange={(on) => set(on ? '1' : '0')} /> {f.label}
            </label>
          );
        if (f.type === 'multi') {
          const on = new Set(v.split(',').filter(Boolean));
          return (
            <Field key={f.key} label={f.label}>
              <div className="flex flex-wrap gap-1">
                {(f.options?.(ctx) ?? []).map((o) => (
                  <button key={o.value} type="button" aria-pressed={on.has(o.value)} onClick={() => set([...(on.has(o.value) ? [...on].filter((x) => x !== o.value) : [...on, o.value])].join(','))} className={cx('h-7 rounded-[14px] px-2.5 text-[12px] font-semibold', on.has(o.value) ? 'bg-primary text-white' : 'border border-line bg-surface text-ink-2')}>
                    {o.label}
                  </button>
                ))}
              </div>
            </Field>
          );
        }
        if (f.type === 'select')
          return (
            <Field key={f.key} label={`${f.label}${f.required ? '' : ' (optional)'}`}>
              <Select aria-label={f.label} value={v} onValueChange={set} options={[...(f.required && !v ? [{ value: '', label: 'Choose…' }] : []), ...(f.options?.(ctx) ?? [])]} />
            </Field>
          );
        return (
          <Field key={f.key} label={f.label}>
            <input
              aria-label={f.label}
              inputMode={f.type === 'number' || f.type === 'money' ? 'decimal' : undefined}
              value={v}
              onChange={(e) => set(f.type === 'code' ? e.target.value.replace(/\s/g, '') : e.target.value)}
              className={cx(input, bad && 'border-danger')}
              maxLength={f.type === 'code' ? 30 : 190}
            />
          </Field>
        );
      })}
      {refused ? (
        <p role="alert" className="m-0 rounded-[9px] bg-danger-bg px-3 py-2 text-[12.5px] text-danger">
          {refused.message}
        </p>
      ) : null}
    </Sheet>
  );
}

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Select } from '../../components/Select';
import { Button, ErrorNote, IconButton, Modal, Spinner, cx } from '../../components/ui';
import { toast } from '../../core/toasts';
import { PageHead } from '../hr/parts';
import { Pill } from '../inventory/parts';
import { errorText, gGet, gPost, K, money, nice, type Bay, type Branch, type InspectionTemplate, type Technician, type TemplateItem, type WorkshopData } from './api';
import { Ask, Field, input, Section, Tabs, useGarage, type AskField } from './parts';

export type WorkshopTab = 'branches' | 'bays' | 'technicians' | 'rates' | 'services' | 'models' | 'inspections';

const TABS: Array<{ id: WorkshopTab; label: string }> = [
  { id: 'bays', label: 'Workshops & bays' },
  { id: 'branches', label: 'Branches' },
  { id: 'technicians', label: 'Technicians' },
  { id: 'rates', label: 'Labour rates' },
  { id: 'services', label: 'Service types' },
  { id: 'models', label: 'Makes & models' },
  { id: 'inspections', label: 'Inspection templates' },
];

const BAY_TONE: Record<string, 'blue' | 'amber' | 'red' | 'green' | 'grey'> = { AVAILABLE: 'green', RESERVED: 'blue', OCCUPIED: 'blue', CLEANING: 'grey', MAINTENANCE: 'amber', BLOCKED: 'red' };

type Adding = { title: string; text?: string; fields: AskField[]; path: string; body: (v: Record<string, string>) => Record<string, unknown> } | null;

/**
 * The workshop's shape (FR-BRN-01/02, FR-BAY-01..03, FR-TEC-04/06, FR-PRC-01/02,
 * FR-INS-02): the bay board with each bay's vehicle, job and status; branches
 * that run a garage and the warehouse their parts come from; the technician
 * roster from HR; labour rates, service types, the make and model list and
 * the inspection templates. Everyone in Garage reads it; someone who manages
 * Garage changes it, and someone who assigns work sets a bay's status.
 */
export default function Workshop({ initial = 'bays', embedded = false }: { initial?: WorkshopTab; embedded?: boolean }) {
  const g = useGarage();
  const qc = useQueryClient();
  const [tab, setTab] = useState<WorkshopTab>(initial);
  const [adding, setAdding] = useState<Adding>(null);
  const [hiring, setHiring] = useState(false);
  const [bayStatus, setBayStatus] = useState<{ bay: Bay; status: string } | null>(null);
  const [template, setTemplate] = useState<InspectionTemplate | 'new' | null>(null);
  const [branchEdit, setBranchEdit] = useState<Branch | null>(null);
  const [techEdit, setTechEdit] = useState<Technician | null>(null);
  const [busy, setBusy] = useState(false);
  const q = useQuery({ queryKey: K.workshop(g.org), queryFn: ({ signal }) => gGet<WorkshopData>('/workshop', { org: g.org }, signal) });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: K.workshop(g.org) });
    void qc.invalidateQueries({ queryKey: K.options(g.org) });
    void qc.invalidateQueries({ queryKey: ['garage', 'options'] });
    void qc.invalidateQueries({ queryKey: K.setup(g.org) });
  };
  const send = async (path: string, body: Record<string, unknown>): Promise<boolean> => {
    setBusy(true);
    try {
      const r = await gPost(path, { ...body, org: g.org });
      toast('success', r.message);
      refresh();
      return true;
    } catch (e) {
      toast('error', errorText(e));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const d = q.data;
  const manage = !!d?.manage && g.online;
  const branchName = (id: number | null) => d?.branches.find((b) => b.id === id)?.name ?? '—';
  const garageBranches = (d?.branches ?? []).filter((b) => b.garage);
  const o = g.options;

  const addButton = (label: string, a: NonNullable<Adding>) =>
    manage ? (
      <Button size="sm" icon="plus" onClick={() => setAdding(a)}>
        {label}
      </Button>
    ) : null;

  return (
    <div className={cx('flex flex-col gap-3', embedded ? 'p-4' : 'px-6 py-5')}>
      {embedded ? null : <PageHead title="Workshop" sub="Bays, branches, technicians and prices." />}
      <Tabs label="Workshop sections" value={tab} onChange={setTab} tabs={TABS} />
      {q.isLoading ? (
        <Spinner />
      ) : q.error || !d ? (
        <ErrorNote error={q.error ?? new Error('The workshop could not be loaded.')} onRetry={() => void q.refetch()} />
      ) : tab === 'branches' ? (
        <Section title="Branches that run a garage">
          {d.branches.length === 0 ? (
            <p className="m-0 text-[13px] text-ink-3">The company has no branches yet. Branches are added in Directory.</p>
          ) : (
            <ul className="m-0 flex list-none flex-col divide-y divide-line p-0">
              {d.branches.map((b) => (
                <li key={b.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                  <div>
                    <p className="m-0 text-[13.5px] font-semibold">
                      {b.name} <span className="text-[11.5px] text-ink-3">{b.code}</span>
                    </p>
                    <p className="m-0 text-[12px] text-ink-3">
                      {b.garage ? 'Runs a garage' : 'No garage here'} · parts from {b.warehouse ?? 'no warehouse yet'}
                      {b.invoice_prefix ? ` · invoices ${b.invoice_prefix}…` : ''}
                      {b.hours && Object.keys(b.hours).length ? ` · open ${Object.keys(b.hours).length} days a week` : ''}
                    </p>
                  </div>
                  {manage ? (
                    <div className="flex items-center gap-2">
                      {d.warehouses.length > 0 && b.garage ? (
                        <Select
                          aria-label={`Warehouse for ${b.name}`}
                          value={String(b.warehouse_id ?? '')}
                          placeholder="Parts warehouse"
                          onChange={(e) => void send(`/workshop/branches/${b.id}`, { warehouse_id: Number(e.target.value) || null })}
                          options={d.warehouses.map((w) => ({ value: String(w.id), label: w.name }))}
                          className={cx(input, 'w-52')}
                        />
                      ) : null}
                      {b.garage ? (
                        <Button size="sm" variant="ghost" onClick={() => setBranchEdit(b)}>
                          Hours & invoices
                        </Button>
                      ) : null}
                      <Button size="sm" variant={b.garage ? 'ghost' : 'secondary'} loading={busy} onClick={() => void send(`/workshop/branches/${b.id}`, { active: !b.garage })}>
                        {b.garage ? 'Turn off' : 'Run a garage here'}
                      </Button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Section>
      ) : tab === 'bays' ? (
        <>
          <div className="flex justify-end">
            {addButton('Add workshop', {
              title: 'Add a workshop',
              fields: [
                { name: 'branch_id', label: 'Branch', type: 'select', required: true, options: garageBranches.map((b) => ({ value: String(b.id), label: b.name })) },
                { name: 'name', label: 'Name', required: true, placeholder: 'Main workshop' },
                { name: 'code', label: 'Code', placeholder: 'MW' },
              ],
              path: '/workshop/workshops',
              body: (v) => ({ ...v, branch_id: Number(v.branch_id) }),
            })}
          </div>
          {d.workshops.length === 0 ? <p className="m-0 text-[13px] text-ink-3">No workshops yet{garageBranches.length ? '.' : '. Turn the garage on at a branch first.'}</p> : null}
          {d.workshops.map((w) => {
            const bays = d.bays.filter((b) => b.workshop_id === w.id);
            return (
              <Section
                key={w.id}
                title={`${w.name} · ${branchName(w.branch_id)}`}
                action={addButton('Bay', {
                  title: `Add a bay to ${w.name}`,
                  fields: [
                    { name: 'code', label: 'Code', required: true, placeholder: 'B1' },
                    { name: 'name', label: 'Name', placeholder: 'Lift 1' },
                    { name: 'bay_type', label: 'Type', type: 'select', options: (o.bay_types ?? ['general']).map((t) => ({ value: t, label: nice(t) })) },
                  ],
                  path: '/workshop/bays',
                  body: (v) => ({ ...v, workshop_id: w.id }),
                })}
              >
                {bays.length === 0 ? (
                  <p className="m-0 text-[13px] text-ink-3">No bays.</p>
                ) : (
                  <ul className="m-0 grid list-none gap-2 p-0 sm:grid-cols-2 lg:grid-cols-4" aria-label={`Bays in ${w.name}`}>
                    {bays.map((b) => (
                      <li key={b.id} className={cx('rounded-[10px] border p-3', b.active ? 'border-line' : 'border-dashed border-line opacity-60')}>
                        <div className="flex items-center justify-between gap-2">
                          <b className="text-[13.5px]">{b.code}</b>
                          <Pill tone={BAY_TONE[b.status] ?? 'grey'}>{nice(b.status)}</Pill>
                        </div>
                        <p className="m-0 text-[12px] text-ink-3">
                          {b.name ?? nice(b.bay_type)} · {nice(b.bay_type)}
                        </p>
                        {b.current ? (
                          <button type="button" className="mt-1 text-left text-[12px] font-semibold text-primary" onClick={() => g.openJob(b.current!.job_id)}>
                            {b.current.vehicle} · {b.current.number}
                          </button>
                        ) : null}
                        {b.status_note ? <p className="m-0 mt-1 text-[12px] text-warning">{b.status_note}</p> : null}
                        {manage ? (
                          <button type="button" className="mt-1 text-[11.5px] font-semibold text-ink-3 hover:text-primary" onClick={() => void send(`/workshop/bays/${b.id}`, { active: !b.active })}>
                            {b.active ? 'Take out of use' : 'Put back in use'}
                          </button>
                        ) : null}
                        {d.assign && g.online ? (
                          <Select
                            aria-label={`Set bay ${b.code}`}
                            value=""
                            placeholder="Set status"
                            onChange={(e) => setBayStatus({ bay: b, status: e.target.value })}
                            options={(o.bay_manual ?? []).filter((s) => s !== b.status).map((s) => ({ value: s, label: nice(s) }))}
                            className={cx(input, 'mt-2 h-8 text-[12px]')}
                          />
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </Section>
            );
          })}
        </>
      ) : tab === 'technicians' ? (
        <Section
          title="Technician roster"
          action={
            manage ? (
              <Button size="sm" icon="plus" onClick={() => setHiring(true)}>
                From HR
              </Button>
            ) : null
          }
        >
          {d.technicians.length === 0 ? (
            <p className="m-0 text-[13px] text-ink-3">No technicians on the roster. Technicians are HR employees; add their garage skills here.</p>
          ) : (
            <ul className="m-0 flex list-none flex-col divide-y divide-line p-0">
              {d.technicians.map((t) => (
                <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <div>
                    <p className="m-0 text-[13px] font-semibold">
                      {t.name}
                      {t.is_lead ? <span className="ml-2 rounded-[5px] bg-selection px-1.5 py-0.5 text-[10px] font-bold text-primary">LEAD</span> : null}
                      {!t.active ? <span className="ml-2 text-[11.5px] text-ink-3">inactive</span> : null}
                    </p>
                    <p className="m-0 text-[12px] text-ink-3">
                      {branchName(t.branch_id ?? null)} · {t.skills.join(', ') || 'no skills set'} · rate {t.rate_class ?? '—'}
                    </p>
                  </div>
                  {manage ? (
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" onClick={() => setTechEdit(t)}>
                        Skills
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => void send(`/workshop/technicians/${t.id}`, { is_lead: !t.is_lead })}>
                        {t.is_lead ? 'Not lead' : 'Make lead'}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => void send(`/workshop/technicians/${t.id}`, { active: !t.active })}>
                        {t.active ? 'Deactivate' : 'Activate'}
                      </Button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Section>
      ) : tab === 'rates' ? (
        <Section
          title="Labour rates"
          action={addButton('Rate', {
            title: 'Add a labour rate',
            fields: [
              { name: 'rate_class', label: 'Rate class', required: true, placeholder: 'general' },
              { name: 'label', label: 'Name', required: true, placeholder: 'General mechanical' },
              { name: 'rate_type', label: 'Charged', type: 'select', options: [{ value: 'hourly', label: 'By the hour' }, { value: 'flat', label: 'Flat' }] },
              { name: 'rate', label: `Amount (${o.currency})`, type: 'number', required: true },
              { name: 'branch_id', label: 'Branch', type: 'select', options: [{ value: '', label: 'Every branch' }, ...garageBranches.map((b) => ({ value: String(b.id), label: b.name }))] },
            ],
            path: '/workshop/rates',
            body: (v) => ({ ...v, rate: Number(v.rate), branch_id: Number(v.branch_id) || null }),
          })}
        >
          {d.rates.length === 0 ? (
            <p className="m-0 text-[13px] text-ink-3">No labour rates.</p>
          ) : (
            <table className="w-full text-left text-[13px]">
              <tbody>
                {d.rates.map((r) => (
                  <tr key={r.id} className={cx('border-b border-line/70 last:border-b-0', !r.active && 'text-ink-3')}>
                    <td className="py-2 font-semibold">{r.label}</td>
                    <td className="text-ink-3">{r.rate_class}</td>
                    <td className="text-ink-3">{r.branch_id ? branchName(r.branch_id) : 'every branch'}</td>
                    <td className="text-right tabular-nums">
                      {d.financials || d.manage ? money(r.rate, o.currency) : '—'} {r.rate_type === 'hourly' ? '/ hour' : 'flat'}
                    </td>
                    {manage ? (
                      <td className="w-44 text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            setAdding({
                              title: `Change ${r.label}`,
                              text: 'A change of amount is kept in the audit log. Estimates already sent keep their prices.',
                              fields: [
                                { name: 'label', label: 'Name', required: true, initial: r.label },
                                { name: 'rate', label: `Amount (${o.currency})`, type: 'number', required: true, initial: String(r.rate) },
                              ],
                              path: `/workshop/rates/${r.id}`,
                              body: (v) => ({ label: v.label, rate: Number(v.rate) }),
                            })
                          }
                        >
                          Change
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => void send(`/workshop/rates/${r.id}`, { active: !r.active })}>
                          {r.active ? 'Deactivate' : 'Activate'}
                        </Button>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>
      ) : tab === 'services' ? (
        <Section
          title="Service types"
          action={addButton('Service type', {
            title: 'Add a service type',
            fields: [
              { name: 'name', label: 'Name', required: true, placeholder: 'Full service' },
              { name: 'duration_minutes', label: 'Takes (minutes)', type: 'number', initial: '60', required: true },
              { name: 'required_skill', label: 'Needs the skill', type: 'select', options: [{ value: '', label: 'Any' }, ...d.skills.map((s) => ({ value: s, label: s }))] },
              { name: 'bay_type', label: 'In a bay of type', type: 'select', options: [{ value: '', label: 'Any' }, ...(o.bay_types ?? []).map((t) => ({ value: t, label: nice(t) }))] },
            ],
            path: '/workshop/service-types',
            body: (v) => ({ ...v, duration_minutes: Number(v.duration_minutes) }),
          })}
        >
          {d.service_types.length === 0 ? (
            <p className="m-0 text-[13px] text-ink-3">No service types.</p>
          ) : (
            <ul className="m-0 flex list-none flex-col divide-y divide-line p-0">
              {d.service_types.map((s) => (
                <li key={s.id} className={cx('flex items-center justify-between gap-2 py-1.5 text-[13px]', !s.active && 'text-ink-3')}>
                  <span>
                    <b>{s.name}</b>{' '}
                    <span className="text-ink-3">
                      · {s.duration_minutes} min{s.required_skill ? ` · ${s.required_skill}` : ''}
                      {s.bay_type ? ` · ${nice(s.bay_type)} bay` : ''}
                      {!s.active ? ' · inactive' : ''}
                    </span>
                  </span>
                  {manage ? (
                    <Button size="sm" variant="ghost" onClick={() => void send(`/workshop/service-types/${s.id}`, { active: !s.active })}>
                      {s.active ? 'Deactivate' : 'Activate'}
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Section>
      ) : tab === 'inspections' ? (
        <Section
          title="Inspection templates"
          action={
            manage ? (
              <Button size="sm" icon="plus" onClick={() => setTemplate('new')}>
                Template
              </Button>
            ) : null
          }
        >
          {d.inspection_templates.length === 0 ? (
            <p className="m-0 text-[13px] text-ink-3">No templates. The standard vehicle health check is added the first time a job is inspected.</p>
          ) : (
            <ul className="m-0 flex list-none flex-col divide-y divide-line p-0">
              {d.inspection_templates.map((t) => (
                <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <div>
                    <p className="m-0 text-[13px] font-semibold">
                      {t.name}
                      {!t.active ? <span className="ml-2 text-[11.5px] text-ink-3">inactive</span> : null}
                    </p>
                    <p className="m-0 text-[12px] text-ink-3">
                      {t.inspection_type === 'VHC' ? 'Vehicle health check' : nice(t.inspection_type)} · {t.sections.length} sections · {t.sections.reduce((n, s) => n + s.items.length, 0)} items
                      {[t.vehicle_type && nice(t.vehicle_type), t.brand, t.job_type && nice(t.job_type)]
                        .filter(Boolean)
                        .map((x) => ` · ${x}`)
                        .join('')}
                    </p>
                  </div>
                  {manage ? (
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" onClick={() => setTemplate(t)}>
                        Edit
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setTemplate({ ...t, id: 0, name: `${t.name} (copy)` })}>
                        Copy
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => void send(`/workshop/inspection-templates/${t.id}`, { active: !t.active })}>
                        {t.active ? 'Deactivate' : 'Activate'}
                      </Button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Section>
      ) : (
        <Section
          title="Makes and models"
          action={addButton('Model', {
            title: 'Add a make and model',
            text: 'The list helps advisors type makes and models the same way.',
            fields: [
              { name: 'make', label: 'Make', required: true, placeholder: 'Toyota' },
              { name: 'model', label: 'Model', required: true, placeholder: 'Prius' },
              { name: 'vehicle_type', label: 'Type', type: 'select', options: o.vehicle_types.map((t) => ({ value: t, label: nice(t) })) },
            ],
            path: '/workshop/models',
            body: (v) => v,
          })}
        >
          {d.models.length === 0 ? (
            <p className="m-0 text-[13px] text-ink-3">No models yet.</p>
          ) : (
            <ul className="m-0 grid list-none gap-1 p-0 sm:grid-cols-3">
              {d.models.map((m) => (
                <li key={m.id} className={cx('flex items-center gap-2 text-[13px]', !m.active && 'text-ink-3')}>
                  <span className="min-w-0 flex-1 truncate">
                    {m.make} {m.model} <span className="text-[11.5px] text-ink-3">{nice(m.vehicle_type)}</span>
                  </span>
                  {manage ? (
                    <button type="button" className="text-[11.5px] font-semibold text-ink-3 hover:text-primary" onClick={() => void send(`/workshop/models/${m.id}`, { active: !m.active, vehicle_type: m.vehicle_type })}>
                      {m.active ? 'Hide' : 'Show'}
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}
      {adding ? (
        <Ask
          title={adding.title}
          text={adding.text}
          fields={adding.fields}
          busy={busy}
          onClose={() => setAdding(null)}
          onSubmit={(v) => {
            void send(adding.path, adding.body(v)).then((ok) => {
              if (ok) setAdding(null);
            });
          }}
        />
      ) : null}
      {bayStatus ? (
        <Ask
          title={`Bay ${bayStatus.bay.code}: ${nice(bayStatus.status)}`}
          fields={[{ name: 'note', label: 'Why', required: bayStatus.status === 'MAINTENANCE' || bayStatus.status === 'BLOCKED' }]}
          confirm="Set"
          busy={busy}
          onClose={() => setBayStatus(null)}
          onSubmit={(v) => {
            void send(`/bays/${bayStatus.bay.id}/status`, { status: bayStatus.status, note: v.note }).then((ok) => {
              if (ok) setBayStatus(null);
            });
          }}
        />
      ) : null}
      {hiring && d ? (
        <AddTechnician
          d={d}
          onClose={() => setHiring(false)}
          onDone={() => {
            setHiring(false);
            refresh();
          }}
        />
      ) : null}
      {branchEdit ? (
        <BranchForm
          branch={branchEdit}
          busy={busy}
          onClose={() => setBranchEdit(null)}
          onSave={(body) => {
            void send(`/workshop/branches/${branchEdit.id}`, body).then((ok) => {
              if (ok) setBranchEdit(null);
            });
          }}
        />
      ) : null}
      {techEdit && d ? (
        <TechnicianForm
          t={techEdit}
          d={d}
          busy={busy}
          onClose={() => setTechEdit(null)}
          onSave={(body) => {
            void send(`/workshop/technicians/${techEdit.id}`, body).then((ok) => {
              if (ok) setTechEdit(null);
            });
          }}
        />
      ) : null}
      {template && d ? (
        <TemplateForm
          template={template === 'new' ? null : template}
          types={d.inspection_types}
          onClose={() => setTemplate(null)}
          onSaved={() => {
            setTemplate(null);
            refresh();
          }}
        />
      ) : null}
    </div>
  );
}

const DAYS: Array<[string, string]> = [
  ['mon', 'Monday'],
  ['tue', 'Tuesday'],
  ['wed', 'Wednesday'],
  ['thu', 'Thursday'],
  ['fri', 'Friday'],
  ['sat', 'Saturday'],
  ['sun', 'Sunday'],
];

/** A garage branch's opening hours and invoice series (FR-BRN-02). A day left empty is closed. */
function BranchForm({ branch, busy, onClose, onSave }: { branch: Branch; busy: boolean; onClose: () => void; onSave: (body: Record<string, unknown>) => void }) {
  const [prefix, setPrefix] = useState(branch.invoice_prefix ?? '');
  const [hours, setHours] = useState<Record<string, { open: string; close: string }>>(() => ({ ...(branch.hours ?? {}) }));
  const set = (day: string, k: 'open' | 'close', v: string) => setHours({ ...hours, [day]: { open: hours[day]?.open ?? '', close: hours[day]?.close ?? '', [k]: v } });
  return (
    <Modal
      title={`${branch.name}: hours and invoices`}
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} onClick={() => onSave({ invoice_prefix: prefix, hours })}>
            Save
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="Invoice prefix" hint="Up to 20 letters, digits and dashes; empty for the company's.">
          <input className={input} aria-label="Invoice prefix" value={prefix} onChange={(e) => setPrefix(e.target.value.toUpperCase())} />
        </Field>
        <div className="flex flex-col gap-1.5">
          <span className="text-[12.5px] font-semibold text-ink-2">Opening hours</span>
          {DAYS.map(([day, label]) => (
            <div key={day} className="grid grid-cols-[7rem_1fr_1fr] items-center gap-2 text-[13px]">
              <span>{label}</span>
              <input type="time" className={input} aria-label={`${label} opens`} value={hours[day]?.open ?? ''} onChange={(e) => set(day, 'open', e.target.value)} />
              <input type="time" className={input} aria-label={`${label} closes`} value={hours[day]?.close ?? ''} onChange={(e) => set(day, 'close', e.target.value)} />
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}

/** A technician's garage skills, rate class and branch (FR-TEC-06). */
function TechnicianForm({ t, d, busy, onClose, onSave }: { t: Technician; d: WorkshopData; busy: boolean; onClose: () => void; onSave: (body: Record<string, unknown>) => void }) {
  const [skills, setSkills] = useState<string[]>(t.skills);
  const [rate, setRate] = useState(t.rate_class ?? 'general');
  const [branch, setBranch] = useState(String(t.branch_id ?? ''));
  return (
    <Modal
      title={t.name}
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} onClick={() => onSave({ skills, rate_class: rate, branch_id: Number(branch) || null })}>
            Save
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-1.5" aria-label="Skills">
          {d.skills.map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={skills.includes(s)}
              onClick={() => setSkills(skills.includes(s) ? skills.filter((x) => x !== s) : [...skills, s])}
              className={cx('rounded-full border px-2.5 py-1 text-[12px]', skills.includes(s) ? 'border-primary bg-selection text-primary' : 'border-line text-ink-2')}
            >
              {s}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Labour rate class">
            <Select aria-label="Rate class" value={rate} onChange={(e) => setRate(e.target.value)} options={Array.from(new Set(['general', rate, ...d.rates.map((r) => r.rate_class)])).map((r) => ({ value: r, label: r }))} className={input} />
          </Field>
          <Field label="Branch">
            <Select aria-label="Branch" value={branch} onChange={(e) => setBranch(e.target.value)} options={[{ value: '', label: 'Any' }, ...d.branches.filter((b) => b.garage).map((b) => ({ value: String(b.id), label: b.name }))]} className={input} />
          </Field>
        </div>
      </div>
    </Modal>
  );
}

/** Put an HR employee on the roster (FR-TEC-06): their garage skills, rate class and whether they lead. */
function AddTechnician({ d, onClose, onDone }: { d: WorkshopData; onClose: () => void; onDone: () => void }) {
  const g = useGarage();
  const [term, setTerm] = useState('');
  const [emp, setEmp] = useState<number | null>(null);
  const [skills, setSkills] = useState<string[]>([]);
  const [rate, setRate] = useState(d.rates[0]?.rate_class ?? 'general');
  const [lead, setLead] = useState(false);
  const [busy, setBusy] = useState(false);
  const people = useQuery({
    queryKey: K.employees(g.org, term),
    queryFn: ({ signal }) => gGet<{ employees: { employee_id: number; name: string; employee_no: string | null; branch_id: number | null; on_roster: boolean }[] }>('/workshop/employees', { q: term, org: g.org }, signal),
  });
  const save = async () => {
    setBusy(true);
    try {
      const r = await gPost('/workshop/technicians', { employee_id: emp, skills, rate_class: rate, is_lead: lead, org: g.org });
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
      title="Add a technician from HR"
      onClose={onClose}
      width={560}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} disabled={!emp} onClick={() => void save()}>
            Add to roster
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="Employee">
          <input className={input} autoFocus aria-label="Employee" placeholder="Name, email or employee number" value={term} onChange={(e) => setTerm(e.target.value)} />
        </Field>
        <ul className="m-0 flex max-h-48 list-none flex-col divide-y divide-line overflow-y-auto rounded-[10px] border border-line p-0">
          {(people.data?.employees ?? []).map((p) => (
            <li key={p.employee_id}>
              <button type="button" disabled={p.on_roster} onClick={() => setEmp(p.employee_id)} className={cx('w-full px-3 py-2 text-left text-[13px] hover:bg-subtle disabled:opacity-50', emp === p.employee_id && 'bg-selection')}>
                {p.name}{' '}
                <span className="text-[12px] text-ink-3">
                  {p.employee_no}
                  {p.on_roster ? ' · on the roster' : ''}
                </span>
              </button>
            </li>
          ))}
          {people.data && people.data.employees.length === 0 ? <li className="px-3 py-2 text-[12.5px] text-ink-3">No active employees match.</li> : null}
        </ul>
        <div className="flex flex-col gap-1">
          <span className="text-[12.5px] font-semibold text-ink-2">Skills</span>
          <div className="flex flex-wrap gap-1.5">
            {d.skills.map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={skills.includes(s)}
                onClick={() => setSkills(skills.includes(s) ? skills.filter((x) => x !== s) : [...skills, s])}
                className={cx('rounded-full border px-2.5 py-1 text-[12px]', skills.includes(s) ? 'border-primary bg-selection text-primary' : 'border-line text-ink-2')}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 items-end gap-3">
          <Field label="Labour rate class">
            <Select aria-label="Rate class" value={rate} onChange={(e) => setRate(e.target.value)} options={Array.from(new Set(['general', ...d.rates.map((r) => r.rate_class)])).map((r) => ({ value: r, label: r }))} className={input} />
          </Field>
          <label className="flex h-9 items-center gap-2 text-[13px]">
            <input type="checkbox" checked={lead} onChange={(e) => setLead(e.target.checked)} /> Lead technician
          </label>
        </div>
      </div>
    </Modal>
  );
}

const ITEM_TYPES: Array<{ value: TemplateItem['type']; label: string }> = [
  { value: 'traffic', label: 'Good / soon / urgent' },
  { value: 'passfail', label: 'Pass / fail' },
  { value: 'number', label: 'Measurement' },
  { value: 'text', label: 'Text' },
  { value: 'photo', label: 'Photo' },
];

interface ItemDraft {
  label: string;
  type: TemplateItem['type'];
  unit: string;
  work: string;
  minutes: string;
}

interface SectionDraft {
  name: string;
  items: ItemDraft[];
}

const blankItem = (): ItemDraft => ({ label: '', type: 'traffic', unit: '', work: '', minutes: '' });

/**
 * An inspection template (FR-INS-02): sections of items, each with how it is
 * answered and the work it suggests when it is not good. Editing one never
 * changes an inspection already started — it copied its items.
 */
function TemplateForm({ template, types, onClose, onSaved }: { template: InspectionTemplate | null; types: string[]; onClose: () => void; onSaved: () => void }) {
  const g = useGarage();
  const [name, setName] = useState(template?.name ?? '');
  const [type, setType] = useState(template?.inspection_type ?? types[0] ?? 'VHC');
  const [vehicleType, setVehicleType] = useState(template?.vehicle_type ?? '');
  const [brand, setBrand] = useState(template?.brand ?? '');
  const [jobType, setJobType] = useState(template?.job_type ?? '');
  const [sections, setSections] = useState<SectionDraft[]>(
    () =>
      template?.sections.map((s) => ({
        name: s.name,
        items: s.items.map((i) => ({ label: i.label, type: i.type, unit: i.unit ?? '', work: i.suggest?.description ?? '', minutes: i.suggest?.labour_minutes ? String(i.suggest.labour_minutes) : '' })),
      })) ?? [{ name: '', items: [blankItem()] }],
  );
  const [busy, setBusy] = useState(false);
  const setSection = (i: number, s: SectionDraft) => setSections(sections.map((x, j) => (j === i ? s : x)));
  const setItem = (si: number, ii: number, patch: Partial<ItemDraft>) => {
    const s = sections[si];
    if (s) setSection(si, { ...s, items: s.items.map((x, j) => (j === ii ? { ...x, ...patch } : x)) });
  };
  const save = async () => {
    setBusy(true);
    const body = {
      name,
      inspection_type: type,
      vehicle_type: vehicleType,
      brand,
      job_type: jobType,
      sections: sections.map((s) => ({
        name: s.name,
        items: s.items.map((i) => ({ label: i.label, type: i.type, unit: i.unit || null, suggest: i.work.trim() ? { line_type: 'LABOUR', description: i.work, labour_minutes: Number(i.minutes) || 0 } : null })),
      })),
      org: g.org,
    };
    try {
      const r = await gPost(template?.id ? `/workshop/inspection-templates/${template.id}` : '/workshop/inspection-templates', body);
      toast('success', r.message);
      onSaved();
    } catch (e) {
      toast('error', errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={template?.id ? `Edit ${template.name}` : 'New inspection template'}
      onClose={onClose}
      width={980}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} disabled={!name.trim()} onClick={() => void save()}>
            Save template
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-3 gap-3">
          <Field label="Name *">
            <input className={input} aria-label="Template name" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Inspection type">
            <Select aria-label="Inspection type" value={type} onChange={(e) => setType(e.target.value)} options={types.map((t) => ({ value: t, label: t === 'VHC' ? 'Vehicle health check' : nice(t) }))} className={input} />
          </Field>
          <Field label="Only for vehicle type">
            <Select aria-label="Vehicle type" value={vehicleType} onChange={(e) => setVehicleType(e.target.value)} options={[{ value: '', label: 'Any' }, ...g.options.vehicle_types.map((t) => ({ value: t, label: nice(t) }))]} className={input} />
          </Field>
          <Field label="Only for brand">
            <input className={input} aria-label="Brand" placeholder="Any" value={brand} onChange={(e) => setBrand(e.target.value)} />
          </Field>
          <Field label="Only for job type">
            <Select aria-label="Job type" value={jobType} onChange={(e) => setJobType(e.target.value)} options={[{ value: '', label: 'Any' }, ...g.options.job_types.map((t) => ({ value: t, label: nice(t) }))]} className={input} />
          </Field>
        </div>
        {sections.map((s, si) => (
          <fieldset key={si} className="m-0 rounded-[10px] border border-line p-3">
            <div className="mb-2 flex items-center gap-2">
              <input className={cx(input, 'font-semibold')} placeholder="Section, e.g. Brakes" aria-label={`Section ${si + 1} name`} value={s.name} onChange={(e) => setSection(si, { ...s, name: e.target.value })} />
              <IconButton icon="trash" label={`Remove section ${si + 1}`} size={15} onClick={() => setSections(sections.filter((_, j) => j !== si))} />
            </div>
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {s.items.map((it, ii) => (
                <li key={ii} className="grid grid-cols-[1.5fr_1fr_0.5fr_1.5fr_0.6fr_auto] items-center gap-2">
                  <input className={input} placeholder="Item" aria-label="Item" value={it.label} onChange={(e) => setItem(si, ii, { label: e.target.value })} />
                  <Select aria-label="Answered as" value={it.type} onChange={(e) => setItem(si, ii, { type: e.target.value as TemplateItem['type'] })} options={ITEM_TYPES} className={input} />
                  <input className={input} placeholder="Unit" aria-label="Unit" value={it.unit} disabled={it.type !== 'number'} onChange={(e) => setItem(si, ii, { unit: e.target.value })} />
                  <input className={input} placeholder="Work suggested when not good" aria-label="Suggested work" value={it.work} onChange={(e) => setItem(si, ii, { work: e.target.value })} />
                  <input className={input} placeholder="Min" aria-label="Suggested minutes" inputMode="numeric" value={it.minutes} onChange={(e) => setItem(si, ii, { minutes: e.target.value.replace(/\D/g, '') })} />
                  <IconButton icon="x" label="Remove item" size={14} onClick={() => setSection(si, { ...s, items: s.items.filter((_, j) => j !== ii) })} />
                </li>
              ))}
            </ul>
            <button type="button" className="mt-2 text-[12px] font-semibold text-primary" onClick={() => setSection(si, { ...s, items: [...s.items, blankItem()] })}>
              + Item
            </button>
          </fieldset>
        ))}
        <button type="button" className="self-start text-[13px] font-semibold text-primary" onClick={() => setSections([...sections, { name: '', items: [blankItem()] }])}>
          + Section
        </button>
      </div>
    </Modal>
  );
}

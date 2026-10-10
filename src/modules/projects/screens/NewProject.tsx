import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { app } from '../../../core/app-state';
import { useStore } from '../../../core/store';
import { toast } from '../../../core/toasts';
import { Checkbox } from '../../../components/Checkbox';
import { Select } from '../../../components/Select';
import { Button, Modal, cx } from '../../../components/ui';
import { qk, type ProjectStatus } from '../api';
import { useProjectCompany } from '../company';
import { PRIORITY, errorText, pk, preads, projectPath, pwrites, templateSummary, type CopyParts } from '../portfolio';
import { ErrorLine, Field, Mono, areaClass, inputClass, needsConnection } from './kit';

/**
 * W03 · New project — blank, or from a template (PRJ-REG, PRJ-TPL), over whatever view is open (`?new=blank`,
 * `?new={templateId}`, the web's addresses).
 *
 * Left: what to start from, and which parts of the template to copy (dates shift to the new start). Right: the
 * project's details. The end date is saved as the baseline. The code is not chosen here: the footer names the next
 * one, issued when the project is saved.
 *
 * COMPANY (G-01): the project is made in the company chosen here — the selector's to begin with. Templates, clients and
 * people are that company's, so changing it clears the template and client already picked. Creating needs WorkSuite.
 */

const COPY_ALL: CopyParts = { milestones: true, tasks: true, dependencies: true, roles: true, risks: false };
const START_AS: Array<{ value: ProjectStatus; label: string }> = [
  { value: 'planning', label: 'Planning' },
  { value: 'pending_approval', label: 'Pending approval' },
  { value: 'active', label: 'Active now' },
];
const CURRENCIES = ['LKR', 'USD', 'EUR', 'GBP', 'AED', 'INR', 'AUD', 'SGD'];

export function NewProjectDialog({ templateId, offline, onClose, onGo }: { templateId: number | null; offline: boolean; onClose: () => void; onGo: (route: string) => void }) {
  const qc = useQueryClient();
  const me = useStore(app, (s) => s.auth?.user?.id);
  const company = useProjectCompany();
  const [orgPick, setOrgPick] = useState<number | null>(null);
  const org = orgPick ?? company.current?.id ?? null;

  const templates = useQuery({ queryKey: pk.templates(org), queryFn: ({ signal }) => preads.templates(org, { signal }), staleTime: 60_000 });
  const clients = useQuery({ queryKey: pk.clients({ org }), queryFn: ({ signal }) => preads.clients({ org }, { signal }), staleTime: 300_000 });
  const categories = useQuery({ queryKey: pk.categories, queryFn: ({ signal }) => preads.categories({ signal }), staleTime: 300_000 });
  const people = useQuery({ queryKey: pk.people(org), queryFn: ({ signal }) => preads.people(org, { signal }), staleTime: 300_000 });
  const settings = useQuery({ queryKey: pk.settings, queryFn: ({ signal }) => preads.settings({ signal }), staleTime: 300_000, retry: false });

  const [from, setFrom] = useState<number | null>(templateId);
  const [copy, setCopy] = useState<CopyParts>(COPY_ALL);
  const [f, setF] = useState({ name: '', client_id: '', category_id: '', manager_id: me ? String(me) : '', priority: 'medium', start_date: '', end_date: '', budget: '', currency: '', hourly_rate: '', estimated_hours: '', description: '' });
  const [status, setStatus] = useState<ProjectStatus>('planning');
  const [billable, setBillable] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));

  const tpls = templates.data?.data.templates ?? [];
  const tpl = tpls.find((t) => t.id === from) ?? null;
  const currency = f.currency || settings.data?.data.settings.default_currency || 'LKR';
  const nextCode = settings.data?.data.settings.next_code;

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    setError('');
    if (!f.name.trim()) return setError('Give the project a name.');
    if (f.start_date && f.end_date && f.end_date < f.start_date) return setError('The end date is before the start date.');
    const body: Record<string, unknown> = {
      org_id: org,
      name: f.name.trim(),
      client_id: f.client_id ? Number(f.client_id) : null,
      category_id: f.category_id ? Number(f.category_id) : null,
      manager_id: f.manager_id ? Number(f.manager_id) : null,
      priority: f.priority,
      start_date: f.start_date || null,
      end_date: f.end_date || null,
      budget: f.budget.replace(/,/g, '') || '0',
      currency,
      hourly_rate: f.hourly_rate.replace(/,/g, '') || '0',
      estimated_hours: f.estimated_hours.replace(/,/g, '') || '0',
      description: f.description.trim() || null,
      status,
      is_billable: billable,
    };
    setBusy(true);
    try {
      const made = tpl ? await pwrites.fromTemplate({ ...body, template_id: tpl.id, copy }) : await pwrites.create(body);
      await qc.invalidateQueries({ queryKey: qk.all });
      toast('success', `Project ${made.code} created`);
      // Going to the project drops ?new, which closes this dialog.
      onGo(projectPath(made.id));
    } catch (err) {
      const msg = errorText(err, 'The project could not be created.');
      setError(msg);
      toast('error', msg);
    } finally {
      setBusy(false);
    }
  };

  const copyRows: Array<{ key: keyof CopyParts; label: string; n: number }> = tpl
    ? [
        { key: 'milestones', label: 'Milestones', n: tpl.milestones },
        { key: 'tasks', label: 'Tasks and checklists', n: tpl.tasks },
        { key: 'dependencies', label: 'Task dependencies', n: tpl.dependencies },
        { key: 'roles', label: 'Team roles, not people', n: tpl.roles },
        { key: 'risks', label: 'Standard risks', n: tpl.risks },
      ]
    : [];

  const option = (checked: boolean, onPick: () => void, title: string, sub: string, key: string) => (
    <label key={key} className={cx('flex cursor-pointer flex-col gap-0.5 rounded-[10px] px-3 py-2 focus-within:ring-2 focus-within:ring-primary/40', checked ? 'border-2 border-primary bg-selection' : 'border border-line bg-surface hover:border-primary/40')}>
      <input type="radio" name="np-from" checked={checked} onChange={onPick} className="sr-only" />
      <span className="text-[13px] font-semibold text-ink">{title}</span>
      <span className="text-[11.5px] text-ink-3">{sub}</span>
    </label>
  );

  return (
    <Modal
      title={
        <span className="flex flex-col">
          New project
          <span className="text-[12px] font-normal text-ink-3">{tpl ? `From the template “${tpl.name}”` : 'Blank project'}</span>
        </span>
      }
      onClose={onClose}
      width={960}
      footer={
        <div className="flex w-full flex-wrap items-center gap-2.5">
          <span className="text-[12px] text-ink-3">
            {nextCode ? (
              <>
                Code <Mono className="text-ink">{nextCode}</Mono> is reserved when you save.
              </>
            ) : (
              'A code is reserved when you save.'
            )}{' '}
            The end date becomes the baseline.
          </span>
          <div className="ms-auto flex gap-2">
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" loading={busy} disabled={offline} title={offline ? needsConnection('Creating a project') : undefined} onClick={() => void submit()}>
              Create project
            </Button>
          </div>
        </div>
      }
    >
      <div className="grid gap-4 md:grid-cols-[240px_minmax(0,1fr)]">
        <aside className="flex flex-col gap-2 rounded-[10px] bg-ground p-2.5">
          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1 text-[10.5px] font-bold tracking-[0.6px] text-ink-3">START FROM</legend>
            {option(from === null, () => setFrom(null), 'Blank project', 'Nothing copied', 'blank')}
            {templates.isLoading ? <span className="text-[12px] text-ink-3">Loading templates…</span> : null}
            {tpls.map((t) => option(from === t.id, () => (setFrom(t.id), setCopy(COPY_ALL)), t.name, templateSummary(t) || 'Nothing to copy yet', `t${t.id}`))}
          </fieldset>
          {tpl ? (
            <fieldset className="mt-1 flex flex-col gap-1.5 rounded-[10px] border border-line bg-surface p-2.5 text-[12.5px]">
              <legend className="px-1 font-semibold text-ink">Copy from “{tpl.name}”</legend>
              {copyRows.map((c) => (
                <label key={c.key} className="flex items-center gap-2 text-ink-2">
                  <Checkbox checked={copy[c.key]} onChange={(e) => setCopy((p) => ({ ...p, [c.key]: e.target.checked }))} />
                  {c.label}
                  {c.n ? ` (${c.n})` : ''}
                </label>
              ))}
              <span className="text-[11.5px] text-ink-3">Task dates move with the new start date.</span>
            </fieldset>
          ) : null}
        </aside>

        <form id="new-project-form" onSubmit={(e) => void submit(e)} noValidate className="grid content-start gap-x-4 gap-y-3 sm:grid-cols-2">
          {company.companies.length > 1 ? (
            <Field label="Company" hint="Who owns this project and its numbers.">
              <Select
                aria-label="Company"
                value={org !== null ? String(org) : ''}
                onChange={(e) => {
                  // Templates and clients are a company's own: what was picked for the last one does not carry over.
                  setOrgPick(Number(e.target.value));
                  setFrom(null);
                  set('client_id', '');
                }}
                options={company.companies.map((c) => ({ value: String(c.id), label: c.name }))}
                className={inputClass}
              />
            </Field>
          ) : (
            <div className="flex flex-col gap-1 text-[13px]">
              <span className="font-semibold text-ink">Company</span>
              <span className="flex h-[32px] items-center rounded-[8px] border border-line bg-ground px-2.5 text-ink-2">{company.current?.name ?? '—'}</span>
              <span className="text-[11.5px] text-ink-3">Who owns this project and its numbers.</span>
            </div>
          )}
          <Field label="Project name" required>
            <input autoFocus value={f.name} onChange={(e) => set('name', e.target.value)} className={inputClass} />
          </Field>
          <Field label="Client">
            <Select aria-label="Client" value={f.client_id} onChange={(e) => set('client_id', e.target.value)} options={[{ value: '', label: 'Internal (no client)' }, ...(clients.data?.data.clients ?? []).map((c) => ({ value: String(c.id), label: c.name }))]} className={inputClass} />
          </Field>
          <Field label="Category">
            <Select
              aria-label="Category"
              value={f.category_id}
              onChange={(e) => set('category_id', e.target.value)}
              options={[{ value: '', label: 'None' }, ...(categories.data?.data.categories ?? []).filter((c) => c.status !== 'archived').map((c) => ({ value: String(c.id), label: c.name }))]}
              className={inputClass}
            />
          </Field>
          <Field label="Project manager" hint="Joins as a member with the manager role.">
            <Select aria-label="Project manager" searchable placeholder="Choose a person…" value={f.manager_id} onChange={(e) => set('manager_id', e.target.value)} options={(people.data?.data.people ?? []).map((p) => ({ value: String(p.id), label: p.name, hint: p.email }))} className={inputClass} />
          </Field>
          <Field label="Priority">
            <Select aria-label="Priority" value={f.priority} onChange={(e) => set('priority', e.target.value)} options={Object.entries(PRIORITY).map(([value, p]) => ({ value, label: p.label }))} className={inputClass} />
          </Field>
          <Field label="Starts">
            <input type="date" value={f.start_date} onChange={(e) => set('start_date', e.target.value)} className={inputClass} />
          </Field>
          <Field label="Ends" hint="Saved as the baseline end date.">
            <input type="date" value={f.end_date} min={f.start_date || undefined} onChange={(e) => set('end_date', e.target.value)} className={inputClass} />
          </Field>
          <Field label="Budget">
            <span className="flex gap-2">
              <Select aria-label="Currency" value={currency} onChange={(e) => set('currency', e.target.value)} options={[...new Set([currency, ...CURRENCIES])].map((c) => ({ value: c, label: c }))} className={cx(inputClass, 'w-24 shrink-0')} />
              <input aria-label="Budget amount" value={f.budget} onChange={(e) => set('budget', e.target.value)} inputMode="decimal" placeholder="0.00" className={cx(inputClass, 'font-mono')} />
            </span>
          </Field>
          <Field label="Default hourly rate" hint="Used when a member has no rate.">
            <input value={f.hourly_rate} onChange={(e) => set('hourly_rate', e.target.value)} inputMode="decimal" placeholder={`${currency} 0.00`} className={cx(inputClass, 'font-mono')} />
          </Field>
          <Field label="Estimated hours">
            <input value={f.estimated_hours} onChange={(e) => set('estimated_hours', e.target.value)} inputMode="decimal" placeholder="0" className={cx(inputClass, 'font-mono')} />
          </Field>
          <Field label="Description" className="sm:col-span-2">
            <textarea value={f.description} onChange={(e) => set('description', e.target.value)} rows={3} className={areaClass} />
          </Field>
          <fieldset className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-[10px] border border-line px-3 py-2 text-[13px] text-ink sm:col-span-2">
            <legend className="px-1 text-[12.5px] font-semibold text-ink">Start the project as</legend>
            {START_AS.map((s) => (
              <label key={s.value} className="flex items-center gap-1.5">
                <input type="radio" name="np-status" value={s.value} checked={status === s.value} onChange={() => setStatus(s.value)} className="accent-[var(--color-primary)]" />
                {s.label}
              </label>
            ))}
            <label className="flex items-center gap-1.5 sm:ms-auto">
              <Checkbox checked={billable} onChange={(e) => setBillable(e.target.checked)} />
              Billable
            </label>
          </fieldset>
          {error ? (
            <div className="sm:col-span-2">
              <ErrorLine>{error}</ErrorLine>
            </div>
          ) : null}
        </form>
      </div>
    </Modal>
  );
}

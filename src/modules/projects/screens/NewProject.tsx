import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { app } from '../../../core/app-state';
import { useStore } from '../../../core/store';
import { toast } from '../../../core/toasts';
import { todayInZone } from '../../../core/time';
import { Checkbox } from '../../../components/Checkbox';
import { DateField, dateWords } from '../../../components/DateField';
import { Icon } from '../../../components/Icon';
import { Select } from '../../../components/Select';
import { Button, Modal, cx } from '../../../components/ui';
import { qk, type ProjectStatus } from '../api';
import { useProjectCompany } from '../company';
import { PRIORITY, errorText, num, pk, preads, projectPath, pwrites } from '../portfolio';
import {
  GROUPS,
  INCLUDE_ALL,
  barOf,
  budgetTotal,
  byCategory,
  fillName,
  offsetLabel,
  planHours,
  pricedBudget,
  schedule,
  searchTemplates,
  tk,
  treads,
  twrites,
  workCalendar,
  type Include,
  type IncludePart,
  type LibraryItem,
  type Plan,
  type TemplateSpec,
} from '../templates';
import { ErrorLine, Field, Mono, Tabs, areaClass, inputClass, needsConnection, useLiveProjects } from './kit';

/**
 * W03 · New project — over whatever view is open (`?new=blank`, `?new={key}`; a bare number is a project marked as
 * a template, the web's address).
 *
 * LEFT, "Start from" (worksuite-desktop#337): a search box, then Blank project, Copy an existing project (pick one),
 * Company templates, My templates and the built-in Template packs by category. Each card: icon, name, one line
 * ("8 phases · 29 tasks · 8 weeks") and tags.
 *
 * RIGHT: Details and, once a template is chosen, Preview. Choosing a template fills the form — name from its pattern,
 * category, priority, billable, estimated hours, budget (the budget lines' total, for someone who may set money),
 * description and "Start the project as" — and offers what to include and a person for each role. The Preview lays
 * the plan on the chosen dates exactly as the server will (templates.ts `schedule()`): working days only, and HR's
 * public holidays when "Skip public holidays" is on. Create project builds the whole thing in one call
 * (POST /from-library), with progress for a large template, then opens it.
 *
 * COMPANY (G-01): the project is made in the company chosen here. Templates, clients and people are that company's,
 * so changing it clears the template and client already picked. Creating needs WorkSuite.
 */

const START_AS: Array<{ value: ProjectStatus; label: string }> = [
  { value: 'planning', label: 'Planning' },
  { value: 'pending_approval', label: 'Pending approval' },
  { value: 'active', label: 'Active now' },
];
const CURRENCIES = ['LKR', 'USD', 'EUR', 'GBP', 'AED', 'INR', 'AUD', 'SGD'];
const PARTS: Array<{ key: IncludePart; label: string }> = [
  { key: 'phases', label: 'Phases and milestones' },
  { key: 'tasks', label: 'Tasks, sub-tasks and checklists' },
  { key: 'folders', label: 'Folders and documents in Files' },
  { key: 'budget', label: 'Budget lines' },
  { key: 'automations', label: 'Automations' },
  { key: 'risks', label: 'Standard risks' },
];
/** From this many tasks, Create project shows what it is building while it builds. */
export const LARGE_TEMPLATE = 20;

/** The currency picker and the amount beside it: the field look without `w-full`, which squeezed the amount out. */
const fieldBase = 'h-[32px] rounded-[8px] border border-line bg-surface px-2.5 text-[13px] text-ink outline-none focus:border-primary disabled:bg-subtle';

type Form = { name: string; client_id: string; category_id: string; manager_id: string; priority: string; start_date: string; end_date: string; budget: string; currency: string; hourly_rate: string; estimated_hours: string; description: string };

/** `?new=` as a template key: a number is a project marked as a template. */
export function startKey(param: string | null): string | null {
  if (!param || param === 'blank') return null;
  return /^\d+$/.test(param) ? `project.${param}` : param;
}

export function NewProjectDialog({ start, offline, onClose, onGo }: { start: string | null; offline: boolean; onClose: () => void; onGo: (route: string) => void }) {
  const qc = useQueryClient();
  const me = useStore(app, (s) => s.auth?.user?.id);
  const company = useProjectCompany();
  const [orgPick, setOrgPick] = useState<number | null>(null);
  const org = orgPick ?? company.current?.id ?? null;

  const [q, setQ] = useState('');
  const library = useQuery({ queryKey: tk.library({ org }), queryFn: ({ signal }) => treads.library({ org }, { signal }), staleTime: 60_000 });
  const clients = useQuery({ queryKey: pk.clients({ org }), queryFn: ({ signal }) => preads.clients({ org }, { signal }), staleTime: 300_000 });
  const categories = useQuery({ queryKey: pk.categories, queryFn: ({ signal }) => preads.categories({ signal }), staleTime: 300_000 });
  const people = useQuery({ queryKey: pk.people(org), queryFn: ({ signal }) => preads.people(org, { signal }), staleTime: 300_000 });
  const settings = useQuery({ queryKey: pk.settings, queryFn: ({ signal }) => preads.settings({ signal }), staleTime: 300_000, retry: false });

  const [copying, setCopying] = useState(false);
  const [copyId, setCopyId] = useState<number | null>(null);
  const [picked, setPicked] = useState<string | null>(start);
  const key = copying ? (copyId ? `project.${copyId}` : null) : picked;
  const chosen = useQuery({ queryKey: tk.one(key ?? ''), queryFn: ({ signal }) => treads.one(key ?? '', { signal }), enabled: !!key, staleTime: 60_000 });
  const spec: TemplateSpec | null = key ? (chosen.data?.data.spec ?? null) : null;
  const item: LibraryItem | null = key ? (chosen.data?.data.template ?? library.data?.data.templates.find((t) => t.key === key) ?? null) : null;

  const [f, setF] = useState<Form>({ name: '', client_id: '', category_id: '', manager_id: me ? String(me) : '', priority: 'medium', start_date: '', end_date: '', budget: '', currency: '', hourly_rate: '', estimated_hours: '', description: '' });
  const [status, setStatus] = useState<ProjectStatus>('planning');
  const [billable, setBillable] = useState(true);
  const [include, setInclude] = useState<Include>(INCLUDE_ALL);
  const [roles, setRoles] = useState<Record<string, string>>({});
  const [skipHolidays, setSkipHolidays] = useState(true);
  const [tenderId, setTenderId] = useState('');
  const [tab, setTab] = useState<'details' | 'preview'>('details');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // Which template the form was last filled from, and the name it gave — a name typed since is kept.
  const [filledFor, setFilledFor] = useState<string | null>(null);
  const [autoName, setAutoName] = useState('');
  const set = (k: keyof Form, v: string) => setF((p) => ({ ...p, [k]: v }));

  const can = settings.data?.data.can;
  const mayBudget = !!can?.budget;
  const currency = f.currency || settings.data?.data.settings.default_currency || 'LKR';
  const nextCode = settings.data?.data.settings.next_code;
  // Archived templates are not started from (the server leaves them out; this holds if a cached answer had them).
  const items = (library.data?.data.templates ?? []).filter((t) => t.status !== 'archived');
  const found = searchTemplates(items, q);
  const today = todayInZone();
  const clientName = (clients.data?.data.clients ?? []).find((c) => String(c.id) === f.client_id)?.name ?? '';

  // The form filled from a template, once, when its plan arrives (state set while rendering: no effect, no flash).
  if (spec && item && filledFor !== item.key && !categories.isLoading) {
    const d = spec.defaults;
    const cat = (categories.data?.data.categories ?? []).find((c) => c.name.toLowerCase() === (d.category || spec.category).toLowerCase() && c.status !== 'archived');
    const words = { client: clientName, year: today.slice(0, 4), name: spec.name };
    // "{client} website" with no client yet is the template's own name, not "website".
    const pattern = d.name_pattern && !(clientName === '' && d.name_pattern.includes('{client}')) ? d.name_pattern : spec.name;
    const name = fillName(pattern, words) || spec.name;
    const keepName = f.name.trim() !== '' && f.name !== autoName;
    setFilledFor(item.key);
    setAutoName(keepName ? autoName : name);
    setF((p) => ({
      ...p,
      name: keepName ? p.name : name,
      category_id: cat ? String(cat.id) : p.category_id,
      priority: d.priority,
      estimated_hours: String(d.estimated_hours ?? planHours(spec)),
      budget: mayBudget && budgetTotal(spec) > 0 ? String(d.budget ?? budgetTotal(spec)) : p.budget,
      currency: mayBudget && d.currency ? d.currency : p.currency,
      description: fillName(d.description, { ...words, client: clientName || 'the client' }) || p.description,
    }));
    setStatus(d.status);
    setBillable(d.billable);
    setInclude({ ...INCLUDE_ALL });
    setRoles({});
  }

  const choose = (k: string | null) => {
    setError('');
    setCopying(false);
    setPicked(k);
    setFilledFor(null);
    if (!k) setTab('details');
  };

  // ---- the plan on the chosen dates ------------------------------------------------
  const working = settings.data?.data.settings.working_days;
  const around = f.start_date || f.end_date || today;
  const hFrom = `${Number(around.slice(0, 4)) - 1}-01-01`;
  const hTo = `${Number(around.slice(0, 4)) + 2}-12-31`;
  const holidays = useQuery({ queryKey: tk.holidays(hFrom, hTo), queryFn: ({ signal }) => treads.holidays(hFrom, hTo, { signal }), enabled: !!spec && skipHolidays, staleTime: 3_600_000, retry: false });
  const plan: Plan | null = useMemo(() => {
    if (!spec) return null;
    const days = skipHolidays ? (holidays.data?.data.holidays ?? []).map((h) => h.date) : [];
    return schedule(spec, f.start_date || null, f.end_date || null, workCalendar(holidays.data?.data.working_days ?? working ?? [1, 2, 3, 4, 5], days), today);
  }, [spec, f.start_date, f.end_date, skipHolidays, holidays.data, working, today]);
  const holidaysIn = useMemo(() => (plan && skipHolidays ? (holidays.data?.data.holidays ?? []).filter((h) => h.date >= plan.start && h.date <= plan.end) : []), [plan, skipHolidays, holidays.data]);

  const tenders = useQuery({ queryKey: tk.tenders, queryFn: ({ signal }) => treads.tenders({ signal }), enabled: !!spec?.links?.tenders, staleTime: 60_000, retry: false });
  const live = useLiveProjects(copying);
  const endWord = (item?.anchor_label || spec?.anchor_label || '').toLowerCase() || 'end';
  const taskCount = spec ? (plan?.tasks.length ?? 0) + spec.tasks.reduce((a, t) => a + t.subtasks.length, 0) : 0;

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    setError('');
    if (copying && !copyId) return setError('Choose the project to copy.');
    if (!f.name.trim()) {
      setTab('details');
      return setError('Give the project a name.');
    }
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
      if (key && spec) {
        const people = Object.fromEntries(Object.entries(roles).filter(([, v]) => v).map(([r, v]) => [r, Number(v)]));
        const made = await twrites.fromLibrary({ ...body, template: key, include, people, skip_holidays: skipHolidays, ...(tenderId ? { tender_id: Number(tenderId) } : {}) });
        await qc.invalidateQueries({ queryKey: qk.all });
        const m = made.made ?? {};
        toast('success', `Project ${made.code} created from ${made.template.name} v${made.template.version}: ${m.phases ?? 0} phases, ${(m.tasks ?? 0) + (m.subtasks ?? 0)} tasks`);
        if (made.kept?.length) toast('info', `Not applied: ${made.kept.map((k) => k.what).join('; ')}`);
        onGo(projectPath(made.id));
      } else {
        const made = await pwrites.create(body);
        await qc.invalidateQueries({ queryKey: qk.all });
        toast('success', `Project ${made.code} created`);
        // Going to the project drops ?new, which closes this dialog.
        onGo(projectPath(made.id));
      }
    } catch (err) {
      const msg = errorText(err, 'The project could not be created.');
      setError(msg);
      toast('error', msg);
    } finally {
      setBusy(false);
    }
  };

  const card = (it: LibraryItem) => <StartCard key={it.key} checked={!copying && picked === it.key} onPick={() => choose(it.key)} icon={it.icon || 'copy'} title={it.name} sub={it.line} tags={it.tags} badge={it.version > 1 ? `v${it.version}` : undefined} />;

  return (
    <Modal
      title={
        <span className="flex flex-col">
          New project
          <span className="text-[12px] font-normal text-ink-3">{item ? (copying ? `A copy of “${item.name}”` : `From the template “${item.name}”`) : copying ? 'Copy an existing project' : 'Blank project'}</span>
        </span>
      }
      onClose={busy ? undefined : onClose}
      width={1120}
      footer={
        <div className="flex w-full flex-wrap items-center gap-2.5">
          {busy && key && taskCount >= LARGE_TEMPLATE ? (
            <span className="flex min-w-[240px] flex-1 flex-col gap-1 text-[12px] text-ink-2" role="status">
              <span>
                Building {include.phases ? (plan?.phases.length ?? 0) : 0} phases, {include.tasks ? taskCount : 0} tasks
                {include.budget && spec?.budget.length ? `, ${spec.budget.length} budget lines` : ''}
                {include.folders && spec?.folders.length ? `, ${spec.folders.length} folders` : ''}…
              </span>
              <span role="progressbar" aria-label="Creating the project" className="relative h-1.5 overflow-hidden rounded-full bg-subtle">
                <span className="absolute inset-y-0 w-1/3 animate-pulse rounded-full bg-primary" />
              </span>
            </span>
          ) : (
            <span className="text-[12px] text-ink-3">
              {item && !copying ? (
                <>
                  Created from template <em className="font-semibold text-ink-2">{item.name}</em> v{item.version}.{' '}
                </>
              ) : null}
              {nextCode ? (
                <>
                  Code <Mono className="text-ink">{nextCode}</Mono> is reserved when you save.
                </>
              ) : (
                'A code is reserved when you save.'
              )}{' '}
              The end date becomes the baseline.
            </span>
          )}
          <div className="ms-auto flex gap-2">
            <Button onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button variant="primary" loading={busy} disabled={offline || (!!key && !spec)} title={offline ? needsConnection('Creating a project') : undefined} onClick={() => void submit()}>
              Create project
            </Button>
          </div>
        </div>
      }
    >
      <div className="grid gap-4 md:grid-cols-[300px_minmax(0,1fr)]">
        <aside className="flex max-h-[70vh] flex-col gap-2 overflow-y-auto rounded-[10px] bg-ground p-2.5 scroll-thin">
          <span className="flex items-center gap-2 rounded-[8px] border border-line bg-surface px-2">
            <Icon name="search" size={14} className="text-ink-3" />
            <input aria-label="Find a template" placeholder="Find a template" value={q} onChange={(e) => setQ(e.target.value)} className="h-[30px] min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-3" />
          </span>
          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1 text-[10.5px] font-bold tracking-[0.6px] text-ink-3">START FROM</legend>
            <StartCard checked={!copying && picked === null} onPick={() => choose(null)} icon="file" title="Blank project" sub="Nothing copied" />
            <StartCard
              checked={copying}
              onPick={() => {
                setCopying(true);
                setError('');
                setFilledFor(null);
              }}
              icon="copy"
              title="Copy an existing project"
              sub="Pick a project, choose what to copy"
            />
            {copying ? (
              <Select
                aria-label="Project to copy"
                searchable
                placeholder="Choose a project…"
                value={copyId !== null ? String(copyId) : ''}
                onChange={(e) => {
                  setCopyId(Number(e.target.value) || null);
                  setFilledFor(null);
                }}
                options={live.map((p) => ({ value: String(p.value), label: p.label }))}
                className={inputClass}
              />
            ) : null}
            {library.isLoading ? <span className="text-[12px] text-ink-3">Loading templates…</span> : null}
            {GROUPS.map((g) => {
              const list = found.filter((t) => t.group === g.group);
              if (q && !list.length) return null;
              return (
                <section key={g.group} aria-label={g.title} className="mt-1.5 flex flex-col gap-1.5">
                  <h3 className="text-[10.5px] font-bold tracking-[0.6px] text-ink-3 uppercase">{g.title}</h3>
                  {!list.length ? <p className="px-1 text-[11.5px] text-ink-3">{g.empty}</p> : null}
                  {g.group === 'pack'
                    ? byCategory(list).map((c) => (
                        <div key={c.category} className="flex flex-col gap-1.5">
                          <span className="px-1 text-[11px] font-semibold text-ink-2">{c.category}</span>
                          {c.items.map(card)}
                        </div>
                      ))
                    : list.map(card)}
                </section>
              );
            })}
            {q && !found.length ? <p className="px-1 text-[12px] text-ink-3">No template matches “{q}”.</p> : null}
          </fieldset>
        </aside>

        <div className="flex min-w-0 flex-col gap-3">
          {key ? (
            <Tabs
              label="New project"
              value={tab}
              onChange={setTab}
              tabs={[
                { key: 'details', label: 'Details' },
                { key: 'preview', label: 'Preview' },
              ]}
            />
          ) : null}
          {key && chosen.isLoading ? <span className="text-[12px] text-ink-3">Reading the template…</span> : null}
          {key && chosen.error && !spec ? <ErrorLine>{errorText(chosen.error, 'The template could not be read.')}</ErrorLine> : null}

          {tab === 'preview' && spec && plan ? (
            <Preview spec={spec} plan={plan} include={include} endWord={endWord} holidays={holidaysIn} currency={currency} mayBudget={mayBudget} />
          ) : (
            <form id="new-project-form" onSubmit={(e) => void submit(e)} noValidate className="grid content-start gap-x-4 gap-y-3 sm:grid-cols-2">
              {company.companies.length > 1 ? (
                <Field label="Company" hint="Who owns this project and its numbers.">
                  <Select
                    aria-label="Company"
                    value={org !== null ? String(org) : ''}
                    onChange={(e) => {
                      // Templates and clients are a company's own: what was picked for the last one does not carry over.
                      setOrgPick(Number(e.target.value));
                      choose(null);
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
              <Field label="Starts" hint={plan && !f.start_date ? `From the plan: ${dateWords(plan.start)}` : undefined}>
                <DateField aria-label="Starts" value={f.start_date} onChange={(v) => set('start_date', v)} clearable />
              </Field>
              <Field label={spec?.anchor === 'end' && spec.anchor_label ? spec.anchor_label : 'Ends'} hint={plan && !f.end_date ? `From the plan: ${dateWords(plan.end)}. Saved as the baseline.` : 'Saved as the baseline end date.'}>
                <DateField aria-label="Ends" value={f.end_date} min={f.start_date || undefined} onChange={(v) => set('end_date', v)} clearable />
              </Field>
              <Field label="Budget" hint={spec && mayBudget && budgetTotal(spec) > 0 ? `The template’s budget lines total ${currency} ${num(budgetTotal(spec))}.` : undefined}>
                <span className="flex gap-2">
                  <Select aria-label="Currency" value={currency} onChange={(e) => set('currency', e.target.value)} options={[...new Set([currency, ...CURRENCIES])].map((c) => ({ value: c, label: c }))} className={cx(fieldBase, 'w-24 shrink-0')} />
                  <input aria-label="Budget amount" value={f.budget} onChange={(e) => set('budget', e.target.value)} inputMode="decimal" placeholder="0.00" className={cx(fieldBase, 'min-w-0 flex-1 font-mono')} />
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

              {spec ? (
                <>
                  <fieldset className="flex flex-col gap-1.5 rounded-[10px] border border-line px-3 py-2 text-[12.5px] text-ink-2">
                    <legend className="px-1 text-[12.5px] font-semibold text-ink">{copying ? 'What to copy' : 'Include from the template'}</legend>
                    {PARTS.map((p) => {
                      const n = partCount(spec, p.key);
                      if (!n) return null;
                      return (
                        <label key={p.key} className="flex items-center gap-2">
                          <Checkbox checked={include[p.key]} onChange={(e) => setInclude((x) => ({ ...x, [p.key]: e.target.checked }))} />
                          {p.label} ({n})
                        </label>
                      );
                    })}
                    <label className="mt-1 flex items-center gap-2 border-t border-line pt-1.5">
                      <Checkbox checked={skipHolidays} onChange={(e) => setSkipHolidays(e.target.checked)} />
                      Skip public holidays{settings.data?.data.settings.holiday_calendar ? ` (${settings.data.data.settings.holiday_calendar})` : ''}
                    </label>
                    <span className="text-[11.5px] text-ink-3">Dates skip weekends and move with the start and end dates.</span>
                  </fieldset>
                  <fieldset className="flex flex-col gap-1.5 rounded-[10px] border border-line px-3 py-2 text-[12.5px]">
                    <legend className="px-1 text-[12.5px] font-semibold text-ink">Assign roles</legend>
                    {spec.roles.length ? (
                      spec.roles.map((r) => (
                        <div key={r.key} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] items-center gap-2 text-ink-2">
                          <span className="truncate" title={r.name}>
                            {r.name}
                          </span>
                          <Select
                            aria-label={`Person for ${r.name}`}
                            searchable
                            value={roles[r.key] ?? ''}
                            onChange={(e) => setRoles((x) => ({ ...x, [r.key]: e.target.value }))}
                            options={[{ value: '', label: 'Leave unassigned' }, ...(people.data?.data.people ?? []).map((p) => ({ value: String(p.id), label: p.name, hint: p.email }))]}
                            className={cx(fieldBase, 'h-[30px] w-full')}
                          />
                        </div>
                      ))
                    ) : (
                      <span className="text-ink-3">This template names no roles.</span>
                    )}
                    <span className="text-[11.5px] text-ink-3">Each role’s tasks go to its person; a role left unassigned is listed in the description as a seat to fill.</span>
                  </fieldset>
                  {spec.links?.tenders && tenders.data?.data.available ? (
                    <Field label="Tender" hint="Links the project to the tender in Tenders." className="sm:col-span-2">
                      <Select
                        aria-label="Tender"
                        searchable
                        value={tenderId}
                        onChange={(e) => {
                          setTenderId(e.target.value);
                          const t = tenders.data?.data.tenders.find((x) => String(x.id) === e.target.value);
                          if (t?.closing_date && !f.end_date) set('end_date', t.closing_date);
                        }}
                        options={[{ value: '', label: 'No tender' }, ...tenders.data.data.tenders.map((t) => ({ value: String(t.id), label: t.reference ? `${t.reference} · ${t.title}` : t.title, hint: t.closing_date ? `Closes ${dateWords(t.closing_date)}` : undefined }))]}
                        className={inputClass}
                      />
                    </Field>
                  ) : null}
                </>
              ) : null}

              {error ? (
                <div className="sm:col-span-2">
                  <ErrorLine>{error}</ErrorLine>
                </div>
              ) : null}
            </form>
          )}
          {tab === 'preview' && error ? <ErrorLine>{error}</ErrorLine> : null}
        </div>
      </div>
    </Modal>
  );
}

function partCount(spec: TemplateSpec, part: IncludePart): number {
  switch (part) {
    case 'phases':
      return spec.phases.length;
    case 'tasks':
      return spec.tasks.length + spec.tasks.reduce((a, t) => a + t.subtasks.length, 0);
    case 'folders':
      return spec.folders.length;
    case 'budget':
      return spec.budget.length;
    case 'automations':
      return spec.automations.length;
    case 'risks':
      return spec.risks.length;
  }
}

function StartCard({ checked, onPick, icon, title, sub, tags, badge }: { checked: boolean; onPick: () => void; icon: string; title: string; sub: string; tags?: string[]; badge?: string }) {
  return (
    <label className={cx('flex cursor-pointer gap-2 rounded-[10px] px-2.5 py-2 focus-within:ring-2 focus-within:ring-primary/40', checked ? 'border-2 border-primary bg-selection' : 'border border-line bg-surface hover:border-primary/40')}>
      <input type="radio" name="np-from" checked={checked} onChange={onPick} className="sr-only" aria-label={title} />
      <Icon name={icon} size={16} className={cx('mt-0.5 shrink-0', checked ? 'text-primary' : 'text-ink-3')} />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="flex items-baseline gap-1.5 text-[13px] font-semibold text-ink">
          <span className="truncate">{title}</span>
          {badge ? <span className="text-[10.5px] font-normal text-ink-3">{badge}</span> : null}
        </span>
        <span className="text-[11.5px] text-ink-3">{sub}</span>
        {tags?.length ? (
          <span className="flex flex-wrap gap-1 pt-0.5">
            {tags.slice(0, 3).map((t) => (
              <span key={t} className="rounded-full bg-subtle px-1.5 py-px text-[10.5px] font-semibold text-ink-2">
                {t}
              </span>
            ))}
          </span>
        ) : null}
      </span>
    </label>
  );
}

/** The plan on the chosen dates: the timeline of phases, the tasks under each, the money, the files and the automations. */
function Preview({ spec, plan, include, endWord, holidays, currency, mayBudget }: { spec: TemplateSpec; plan: Plan; include: Include; endWord: string; holidays: Array<{ date: string; name: string }>; currency: string; mayBudget: boolean }) {
  const lines = pricedBudget(spec);
  const groups = include.phases ? [...spec.phases.map((p) => ({ key: p.key as string | null, name: p.name })), { key: null, name: 'No phase' }] : [{ key: '*' as string | null, name: '' }];
  const scaleNote = plan.scale !== 1 ? ` · the plan is ${plan.scale > 1 ? 'stretched' : 'squeezed'} to fit (${Math.round(plan.scale * 100)}%)` : '';
  return (
    <section aria-label="Preview" className="flex max-h-[64vh] flex-col gap-3 overflow-y-auto pe-1 text-[12.5px] scroll-thin">
      <p className="text-ink-2">
        <b className="text-ink">{dateWords(plan.start)}</b> → <b className="text-ink">{dateWords(plan.end)}</b> · {plan.days} working days{scaleNote}
        {holidays.length ? ` · skips ${holidays.map((h) => `${h.name} (${dateWords(h.date)})`).join(', ')}` : ''}
      </p>
      {include.phases && spec.phases.length ? (
        <Block title="Phases">
          <ol aria-label="Timeline" className="flex flex-col gap-1">
            {plan.phases.map((p, i) => {
              const bar = barOf(p.start, p.end, plan.start, plan.end);
              const src = spec.phases[i];
              return (
                <li key={p.key} className="grid grid-cols-[180px_minmax(0,1fr)] items-center gap-2">
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate font-semibold text-ink">{p.name}</span>
                    <span className="text-[11px] text-ink-3">
                      {dateWords(p.start)} – {dateWords(p.end)}
                      {src ? ` · ${offsetLabel(src, endWord)}` : ''}
                    </span>
                  </span>
                  <span className="relative h-3 rounded-full bg-subtle">
                    <span className="absolute inset-y-0 rounded-full bg-primary/70" style={{ left: `${bar.left}%`, width: `${bar.width}%` }} />
                  </span>
                </li>
              );
            })}
          </ol>
        </Block>
      ) : null}
      {include.tasks && plan.tasks.length ? (
        <Block title={`Tasks (${plan.tasks.length + spec.tasks.reduce((a, t) => a + t.subtasks.length, 0)})`}>
          {groups.map((g) => {
            const rows = g.key === '*' ? plan.tasks : plan.tasks.filter((t) => t.phase === g.key);
            if (!rows.length) return null;
            return (
              <div key={g.key ?? 'none'} className="mb-1.5">
                {g.name ? <div className="text-[11px] font-bold text-ink-3 uppercase">{g.name}</div> : null}
                <ul className="flex flex-col">
                  {rows.map((t) => {
                    const src = spec.tasks.find((x) => x.key === t.source);
                    const role = spec.roles.find((r) => r.key === src?.role)?.name;
                    return (
                      <li key={t.key} className="flex flex-wrap items-baseline gap-x-2 border-b border-line/60 py-1 last:border-0">
                        <span className="min-w-0 flex-1 text-ink">{t.title}</span>
                        <span className="text-[11px] text-ink-3">
                          {role ? `${role} · ` : ''}
                          {src?.hours ? `${src.hours} h · ` : ''}
                          {t.start === t.end ? dateWords(t.start) : `${dateWords(t.start)} – ${dateWords(t.end)}`}
                          {src?.checklist.length ? ` · ${src.checklist.length} checks` : ''}
                          {src?.subtasks.length ? ` · ${src.subtasks.length} sub-tasks` : ''}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </Block>
      ) : null}
      {include.budget && lines.length ? (
        <Block title="Budget lines">
          {mayBudget ? (
            <table className="w-full">
              <tbody>
                {lines.map((b, i) => (
                  <tr key={i} className="border-b border-line/60 last:border-0">
                    <td className="py-1 text-ink">{b.label}</td>
                    <td className="py-1 text-end text-[11px] text-ink-3">{b.kind === 'labour' ? `${b.hours} h × ${num(b.rateDue)}` : 'expense'}</td>
                    <td className="py-1 text-end font-mono text-ink">{num(b.amountDue)}</td>
                  </tr>
                ))}
                <tr>
                  <td className="pt-1.5 font-semibold text-ink">Total</td>
                  <td />
                  <td className="pt-1.5 text-end font-mono font-semibold text-ink">
                    {currency} {num(budgetTotal(spec))}
                  </td>
                </tr>
              </tbody>
            </table>
          ) : (
            <p className="text-ink-3">{lines.length} lines. Amounts need the Manage project budgets permission.</p>
          )}
        </Block>
      ) : null}
      {include.folders && spec.folders.length ? (
        <Block title="Files">
          <ul className="flex flex-col gap-0.5">
            {spec.folders.map((d) => (
              <li key={d.path} className="flex items-center gap-1.5 text-ink-2">
                <Icon name="folder" size={13} className="text-ink-3" />
                {d.path}
                {d.documents.length ? <span className="text-[11px] text-ink-3">· {d.documents.map((x) => `${x.name}.${x.type}`).join(', ')}</span> : null}
              </li>
            ))}
          </ul>
        </Block>
      ) : null}
      {include.automations && spec.automations.length ? (
        <Block title="Automations">
          <ul className="flex flex-col gap-1">
            {spec.automations.map((a, i) => (
              <li key={i} className="text-ink-2">
                {automationWords(a)}
                <span className="block text-[11px] text-ink-3">{automationFate(a)}</span>
              </li>
            ))}
          </ul>
        </Block>
      ) : null}
      {spec.custom_fields.length || spec.portal ? (
        <Block title="Kept with the template">
          <p className="text-ink-3">
            {[spec.custom_fields.length ? `Custom fields: ${spec.custom_fields.map((c) => c.name).join(', ')}` : '', spec.portal ? 'client portal settings' : ''].filter(Boolean).join('; ')}. Projects has no place for these yet; they are
            kept on the project’s template record.
          </p>
        </Block>
      ) : null}
    </section>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-[10px] border border-line bg-surface px-3 py-2">
      <h3 className="mb-1.5 text-[12.5px] font-bold text-ink">{title}</h3>
      {children}
    </section>
  );
}

/** "When a milestone is reached → notify the client: …" — the server's TemplateBuild words. */
export function automationWords(a: { when: string; do: string; days?: number; title?: string }): string {
  const when = a.when === 'milestone_achieved' ? 'When a milestone is reached' : a.when === 'days_before_end' ? `${a.days ?? '?'} days before the end` : a.when.replace(/_/g, ' ');
  const what = ({ create_task: 'create a task', notify_client: 'notify the client', remind: 'remind the team', notify_team: 'notify the team' } as Record<string, string>)[a.do] ?? a.do.replace(/_/g, ' ');
  return `${when} → ${what}${a.title ? `: ${a.title}` : ''}`;
}

/** What Projects will do with an automation. */
export function automationFate(a: { when: string; do: string }): string {
  if (a.when === 'milestone_achieved' && a.do === 'create_task') return 'Runs: a task is created when the milestone is reached.';
  if (a.when === 'milestone_achieved' && a.do === 'notify_client') return 'Adapted: Projects cannot email a client, so a follow-up task is created instead.';
  return 'Kept, not run: Projects has no automation of this kind yet.';
}

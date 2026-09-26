import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiError, apiGet, apiPost, apiPut } from '../../core/api';
import { call, errorMessage } from '../../core/bridge';
import { toast } from '../../core/toasts';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { EMPLOYMENT_TYPES, hasLeft, type EmployeeRow } from './api';
import { BankCard } from './Bank';
import { dayLong, ymd } from './dates';
import MyDocuments from './MyDocuments';
import { HAND_TICKED, ProgressBar, RequiredDocs, StepList, type ObRow, type ObState, type ObStep, type ReqDoc } from './onboardingParts';
import { btn, btnPrimary, Empty, Field, humanise, input, PageHead, Panel, Seg, Sheet, SidePanel } from './parts';
import { Select } from '../../components/Select';

/**
 * Onboarding (HrOnboarding; the web's Onboarding): everyone being brought
 * in, with how far each has got and what is next, and one new hire's steps,
 * required documents and bank details. HR records the two hand-ticked steps,
 * marks any step blocked or not applicable, approves documents, edits the
 * basics and activates the person when nothing is left. Every onboarding
 * address is the EMPLOYEE's id, as on the server.
 */
type Filter = 'in_progress' | 'completed' | 'all';

export default function Onboarding({ openId, onOpen }: { openId: number | null; onOpen: (employeeId: number | null) => void }) {
  const [filter, setFilter] = useState<Filter>('in_progress');
  const [starting, setStarting] = useState(false);
  const list = useQuery({ queryKey: ['hr', 'onboarding', filter], queryFn: ({ signal }) => apiGet<{ onboardings: ObRow[]; steps: Record<string, string> }>('/api/hr/onboarding', { status: filter }, signal) });
  const rows = list.data?.onboardings ?? [];

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3.5">
      <PageHead title="Onboarding" sub="New hires, and what is left before their first day.">
        <Seg
          label="Onboardings"
          value={filter}
          onChange={setFilter}
          options={[
            { id: 'in_progress', label: 'In progress' },
            { id: 'completed', label: 'Completed' },
            { id: 'all', label: 'All' },
          ]}
        />
        <button type="button" className={btnPrimary} onClick={() => setStarting(true)}>
          New employee
        </button>
      </PageHead>
      {list.isLoading ? <Spinner /> : list.error ? <ErrorNote error={list.error} onRetry={() => void list.refetch()} /> : null}
      <div className="grid min-h-0 flex-1 grid-cols-[300px_1fr] gap-3.5">
        <div className="flex min-h-0 flex-col gap-2 overflow-y-auto pr-0.5 scroll-thin">
          {rows.map((c) => (
            <button
              key={c.id}
              type="button"
              aria-current={openId === c.employee_id ? 'true' : undefined}
              onClick={() => onOpen(c.employee_id)}
              className={cx('flex flex-col gap-[5px] rounded-[12px] bg-surface px-3.5 py-3 text-left', openId === c.employee_id ? 'border-2 border-primary' : 'border border-line hover:border-primary/40')}
            >
              <b className="truncate text-ink">{c.name}</b>
              <span className="truncate text-[12px] text-ink-3">
                {c.employee_no}
                {c.target_start_date || c.joined_at ? ` · joins ${dayLong(c.target_start_date ?? c.joined_at)}` : ''}
              </span>
              <span className="flex items-center gap-2">
                <ProgressBar percent={c.percent} className="flex-1" />
                <b className="text-[12px] text-ink tabular-nums">{c.percent}%</b>
              </span>
              <span className="truncate text-[12px] text-ink-2">{c.status === 'completed' ? 'Completed' : c.status === 'cancelled' ? 'Cancelled' : `Next: ${c.next_label ?? 'ready to activate'}`}</span>
            </button>
          ))}
          {list.data && !rows.length ? <Empty text={filter === 'in_progress' ? 'Nobody is being onboarded.' : 'Nothing here.'} /> : null}
        </div>
        <div className="min-w-0">{openId ? <Case key={openId} employeeId={openId} onBack={() => onOpen(null)} /> : <Empty text="Choose somebody on the left to see their steps." />}</div>
      </div>
      {starting ? <StartOnboarding onClose={() => setStarting(false)} onDone={(id) => (setStarting(false), setFilter('in_progress'), onOpen(id))} /> : null}
    </div>
  );
}

function Case({ employeeId, onBack }: { employeeId: number; onBack: () => void }) {
  const qc = useQueryClient();
  const [marking, setMarking] = useState<ObStep | null>(null);
  const [editing, setEditing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const [docs, setDocs] = useState(false);
  const [rejecting, setRejecting] = useState<ReqDoc | null>(null);
  const q = useQuery({ queryKey: ['hr', 'onboarding-case', employeeId], queryFn: ({ signal }) => apiGet<ObState>(`/api/hr/onboarding/${employeeId}`, undefined, signal) });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['hr'] });
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorNote error={q.error} onRetry={() => void q.refetch()} />;
  const s = q.data!;
  const e = s.employee;
  const open = s.onboarding?.status === 'in_progress';

  const step = async (st: string, body: { status: string; note?: string | null }) => {
    try {
      await apiPost(`/api/hr/onboarding/${employeeId}/steps/${st}`, body);
      toast('success', body.status === 'pending' ? 'Mark cleared.' : body.status === 'done' ? 'Recorded.' : 'Saved.');
      refresh();
      return true;
    } catch (err) {
      toast('error', errorMessage(err));
      return false;
    }
  };
  const activate = async () => {
    try {
      await apiPost(`/api/hr/onboarding/${employeeId}/activate`, {});
      toast('success', `${e.name} is now active.`);
      refresh();
    } catch (err) {
      // A 409 lists what is still in the way, one per line; show it whole.
      if (err instanceof ApiError && err.status === 409) setRefused(err.message);
      else toast('error', errorMessage(err));
    }
  };
  const verify = async (d: ReqDoc, verdict: 'approved' | 'rejected', comment = '') => {
    if (!d.document_id) return;
    try {
      await apiPost(`/api/hr/onboarding/${employeeId}/documents/${d.document_id}/verify`, { verdict, comment });
      toast('success', verdict === 'approved' ? `${d.name} approved.` : `${d.name} sent back.`);
      refresh();
      return true;
    } catch (err) {
      toast('error', errorMessage(err));
      return false;
    }
  };
  const actions = (st: ObStep) => {
    if (!open || st.step === 'start_working') return [];
    const out: Array<{ label: string; run: () => void }> = [];
    const done = st.status === 'done' || st.status === 'skipped';
    if (!done && (st.step === 'required_documents' || st.step === 'hr_verification')) out.push({ label: 'Open', run: () => setDocs(true) });
    if (!done && HAND_TICKED.has(st.step)) out.push({ label: 'Mark as done', run: () => void step(st.step, { status: 'done' }) });
    if (!done || HAND_TICKED.has(st.step) || st.status === 'skipped') out.push({ label: 'Mark…', run: () => setMarking(st) });
    return out;
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="font-semibold text-primary hover:underline" onClick={onBack}>
          ← All onboardings
        </button>
        <b className="min-w-0 flex-1 truncate text-[15px] text-ink">
          {e.name} · {e.employee_no}
          {s.onboarding?.target_start_date || e.joined_at ? ` · joins ${dayLong(s.onboarding?.target_start_date ?? e.joined_at)}` : ''}
        </b>
        {open ? (
          <>
            <button type="button" className={btn} onClick={() => setEditing(true)}>
              Edit details
            </button>
            <button type="button" className={btn} onClick={() => setCancelling(true)}>
              Cancel onboarding
            </button>
            <button type="button" className={btnPrimary} title={s.can_activate ? undefined : 'Some steps are still outstanding'} onClick={() => void activate()}>
              Activate
            </button>
          </>
        ) : (
          <span className="text-[12.5px] font-semibold text-ink-2">{s.onboarding?.status === 'completed' ? `Completed ${dayLong(s.onboarding.completed_at?.slice(0, 10))}` : `Cancelled${s.onboarding?.cancel_reason ? ` — ${s.onboarding.cancel_reason}` : ''}`}</span>
        )}
      </div>
      <div className="grid grid-cols-[1.25fr_1fr] gap-3">
        <Panel title="Steps">
          <div className="flex items-center gap-2.5 border-b border-line/70 px-3.5 py-2.5">
            <span className="text-[12.5px] font-semibold text-ink-2">Onboarding progress · {s.percent}%</span>
            <ProgressBar percent={s.percent} className="flex-1" />
          </div>
          <StepList state={s} actions={actions} />
        </Panel>
        <div className="flex flex-col gap-3">
          {open && s.blocking.length ? (
            <Panel title={`Still outstanding — ${s.blocking.length}`} bodyClassName="px-3.5 py-2">
              <ul className="m-0 flex list-disc flex-col gap-1 pl-4 text-[12.5px] text-ink-2">
                {s.blocking.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            </Panel>
          ) : null}
          {s.required_documents?.length ? (
            <Panel title="Required documents" action={<button type="button" className="font-semibold text-primary hover:underline" onClick={() => setDocs(true)}>All documents</button>}>
              <RequiredDocs docs={s.required_documents} uploadTo={`/api/hr/employees/${employeeId}/documents`} onChanged={refresh} onVerify={(d, v) => (v === 'rejected' ? setRejecting(d) : void verify(d, v))} />
            </Panel>
          ) : null}
          <BankCard employeeId={employeeId} />
        </div>
      </div>
      {marking ? <MarkStep step={marking} onClose={() => setMarking(null)} onMark={async (status, note) => (await step(marking.step, { status, note })) && setMarking(null)} /> : null}
      {editing ? <EditOnboarding state={s} onClose={() => setEditing(false)} onDone={() => (setEditing(false), refresh())} /> : null}
      {cancelling ? <CancelOnboarding name={e.name} employeeId={employeeId} onClose={() => setCancelling(false)} onDone={() => (setCancelling(false), refresh())} /> : null}
      {rejecting ? <RejectDoc doc={rejecting} onClose={() => setRejecting(null)} onReject={async (why) => (await verify(rejecting, 'rejected', why)) && setRejecting(null)} /> : null}
      {refused ? (
        <Sheet title="Not ready to activate" width={460} onClose={() => setRefused(null)} footer={<button type="button" className={btnPrimary} onClick={() => setRefused(null)}>OK</button>}>
          <div className="text-[12.5px] whitespace-pre-line text-ink-2">{refused}</div>
        </Sheet>
      ) : null}
      {docs ? (
        <SidePanel label="Documents" width={760} onClose={() => setDocs(false)} head={<b className="text-ink">{e.name} · documents</b>}>
          <MyDocuments employeeId={employeeId} />
        </SidePanel>
      ) : null}
    </div>
  );
}

/** Blocked, not applicable, or clear the mark — three different answers, as the web now asks them. */
function MarkStep({ step, onClose, onMark }: { step: ObStep; onClose: () => void; onMark: (status: string, note: string | null) => Promise<unknown> }) {
  const [status, setStatus] = useState(step.status === 'blocked' || step.status === 'skipped' ? 'pending' : 'blocked');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const options: Array<[string, string, string]> = [
    ['blocked', 'Blocked — still outstanding', 'It still has to be cleared before they can be activated.'],
    ['skipped', 'Not applicable to this person — treat as done', 'For example, a contractor gets no company laptop.'],
    ['pending', 'Clear the mark — measure it again', ''],
  ];
  return (
    <Sheet
      title={`Mark… · ${step.label}`}
      width={440}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" disabled={busy} className={btnPrimary} onClick={() => (setBusy(true), void onMark(status, note.trim() || null).finally(() => setBusy(false)))}>
            Mark
          </button>
        </>
      }
    >
      <div role="radiogroup" aria-label="What is the answer?" className="flex flex-col gap-2">
        {options.map(([v, l, h]) => (
          <label key={v} className="flex cursor-pointer items-start gap-2">
            <input type="radio" name="mark-step" checked={status === v} onChange={() => setStatus(v)} className="mt-[3px] accent-primary" />
            <span className="flex flex-col">
              <span className="font-semibold text-ink">{l}</span>
              {h ? <span className="text-[11.5px] text-ink-3">{h}</span> : null}
            </span>
          </label>
        ))}
      </div>
      <Field label="Why?" hint="Shown on HR's dashboard. The employee is told a step is blocked, but not in these words.">
        <input aria-label="Why?" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="e.g. contractor, no company laptop" className={input} />
      </Field>
    </Sheet>
  );
}

function RejectDoc({ doc, onClose, onReject }: { doc: ReqDoc; onClose: () => void; onReject: (why: string) => Promise<unknown> }) {
  const [why, setWhy] = useState('');
  return (
    <Sheet
      title={`Reject · ${doc.name}`}
      width={420}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" disabled={!why.trim()} className={btnPrimary} onClick={() => void onReject(why.trim())}>
            Reject
          </button>
        </>
      }
    >
      <Field label="What is wrong with it?" hint="The new hire sees this and uploads it again.">
        <input aria-label="What is wrong with it?" value={why} onChange={(e) => setWhy(e.target.value)} placeholder="Page 2 missing" className={input} />
      </Field>
    </Sheet>
  );
}

function CancelOnboarding({ name, employeeId, onClose, onDone }: { name: string; employeeId: number; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      await apiPost(`/api/hr/onboarding/${employeeId}/cancel`, { reason: reason.trim() });
      toast('success', 'Onboarding cancelled.');
      onDone();
    } catch (e) {
      toast('error', errorMessage(e));
      setBusy(false);
    }
  };
  return (
    <Sheet
      title="Cancel this onboarding?"
      width={420}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Keep it
          </button>
          <button type="button" disabled={busy || !reason.trim()} className={btnPrimary + ' !bg-danger hover:!opacity-90'} onClick={() => void run()}>
            Cancel onboarding
          </button>
        </>
      }
    >
      <span className="text-ink-2">{name} will not be brought in. Their record stays, marked as cancelled.</span>
      <Field label="Why?">
        <input aria-label="Why?" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Offer declined" className={input} />
      </Field>
    </Sheet>
  );
}

interface Lookups {
  people: EmployeeRow[];
  logins: Array<{ id: number; name: string | null; email: string }>;
  companies: Array<{ id: number; name: string }>;
  schedules: Array<{ id: number; name: string; status: string }>;
  departments: Array<{ id: number; name: string }>;
  designations: Array<{ id: number; name: string; department_id: number | null }>;
}

/** Everything the new-hire forms pick from. Department lists need Directory access; without it they are simply not offered. */
function useLookups(): Lookups {
  const opt = { retry: false, staleTime: 300_000 } as const;
  const people = useQuery({ queryKey: ['hr', 'employees'], queryFn: ({ signal }) => apiGet<EmployeeRow[]>('/api/hr/employees', undefined, signal), ...opt });
  const logins = useQuery({ queryKey: ['hr', 'linkable'], queryFn: ({ signal }) => apiGet<Lookups['logins']>('/api/hr/linkable', undefined, signal), ...opt });
  const companies = useQuery({ queryKey: ['hr', 'companies'], queryFn: ({ signal }) => apiGet<Lookups['companies']>('/api/hr/companies', undefined, signal), ...opt });
  const schedules = useQuery({ queryKey: ['hr', 'schedules'], queryFn: ({ signal }) => apiGet<{ schedules: Lookups['schedules'] }>('/api/hr/schedules', undefined, signal), ...opt });
  const departments = useQuery({ queryKey: ['directory', 'departments'], queryFn: ({ signal }) => apiGet<Lookups['departments']>('/api/directory/departments', undefined, signal), ...opt });
  const designations = useQuery({ queryKey: ['directory', 'designations'], queryFn: ({ signal }) => apiGet<Lookups['designations']>('/api/directory/designations', undefined, signal), ...opt });
  return {
    people: people.data ?? [],
    logins: logins.data ?? [],
    companies: companies.data ?? [],
    schedules: (schedules.data?.schedules ?? []).filter((x) => x.status === 'active'),
    departments: Array.isArray(departments.data) ? departments.data : [],
    designations: Array.isArray(designations.data) ? designations.data : [],
  };
}

type LoginMode = 'none' | 'existing' | 'new';

const START = { full_name: '', personal_email: '', phone: '', date_of_birth: '', address: '', city: '', country: '', employment_type: 'permanent', joined_at: '', target_start_date: '', manager_id: '', work_location: '', schedule_id: '', department_id: '', designation_id: '', org_id: '', notes: '', user_id: '', email: '' };
type StartForm = typeof START;

/**
 * A new hire (the web's "Start onboarding"): the person, the job, and a
 * login now or later. A new login and a company cannot be set together when
 * starting (the server refuses it), so the company is offered with an
 * existing login only; Edit details adds one afterwards.
 */
function StartOnboarding({ onClose, onDone }: { onClose: () => void; onDone: (employeeId: number) => void }) {
  const l = useLookups();
  const today = ymd(new Date());
  const [f, setF] = useState<StartForm>(START);
  const [mode, setMode] = useState<LoginMode>('none');
  const [busy, setBusy] = useState(false);
  const set = (k: keyof StartForm) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }));
  const withLogin = (mode === 'existing' && !!f.user_id) || (mode === 'new' && !!f.email.trim());
  const save = async () => {
    if (!f.full_name.trim()) return toast('error', 'A full name is needed.');
    setBusy(true);
    const n = (k: keyof StartForm) => (f[k] ? Number(f[k]) : undefined);
    const s = (k: keyof StartForm) => f[k].trim() || undefined;
    try {
      const r = await apiPost<{ employee_id: number }>('/api/hr/onboarding', {
        full_name: f.full_name.trim(),
        personal_email: s('personal_email'),
        phone: s('phone'),
        date_of_birth: s('date_of_birth'),
        address: s('address'),
        city: s('city'),
        country: s('country'),
        employment_type: f.employment_type,
        joined_at: s('joined_at'),
        target_start_date: s('target_start_date'),
        manager_id: n('manager_id'),
        work_location: s('work_location'),
        schedule_id: n('schedule_id'),
        notes: s('notes'),
        ...(mode === 'existing' && f.user_id ? { user_id: Number(f.user_id), org_id: n('org_id') } : {}),
        ...(mode === 'new' && f.email.trim() ? { new_user: { name: f.full_name.trim(), email: f.email.trim() } } : {}),
        ...(withLogin ? { department_id: n('department_id'), designation_id: n('designation_id') } : {}),
      });
      toast('success', `${f.full_name.trim()} added. Their onboarding has started.`);
      onDone(Number(r.employee_id));
    } catch (e) {
      toast('error', errorMessage(e));
      setBusy(false);
    }
  };
  const text = (k: keyof StartForm, label: string, type = 'text', placeholder?: string) => (
    <Field label={label}>
      <input aria-label={label} type={type} value={f[k]} onChange={set(k)} placeholder={placeholder} className={input} />
    </Field>
  );
  return (
    <Sheet
      title="New employee"
      width={680}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" disabled={busy || !f.full_name.trim()} className={btnPrimary} onClick={() => void save()}>
            {busy ? 'Starting…' : 'Start onboarding'}
          </button>
        </>
      }
    >
      <div className="grid grid-cols-3 gap-2.5">
        <Field label="Full name" className="col-span-2">
          <input aria-label="Full name" value={f.full_name} onChange={set('full_name')} autoFocus className={input} />
        </Field>
        <Field label="Employment type">
          <Select aria-label="Employment type" value={f.employment_type} onChange={set('employment_type')} className={input}>
            {EMPLOYMENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {humanise(t)}
              </option>
            ))}
          </Select>
        </Field>
        {text('personal_email', 'Personal email', 'email')}
        {text('phone', 'Phone')}
        {text('date_of_birth', 'Date of birth', 'date')}
        {text('joined_at', 'Joins on', 'date')}
        {text('target_start_date', 'Target start date', 'date')}
        {text('work_location', 'Work location', 'text', 'Colombo office')}
        <Field label="Reports to">
          <Select aria-label="Reports to" value={f.manager_id} onChange={set('manager_id')} className={input}>
            <option value="">Nobody yet</option>
            {l.people
              .filter((p) => !hasLeft(p, today) && p.status !== 'pending_onboarding')
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name ?? p.employee_no}
                </option>
              ))}
          </Select>
        </Field>
        <Field label="Work schedule">
          <Select aria-label="Work schedule" value={f.schedule_id} onChange={set('schedule_id')} className={input}>
            <option value="">The company default</option>
            {l.schedules.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </Select>
        </Field>
        {text('city', 'City')}
        {text('address', 'Address')}
        {text('country', 'Country')}
      </div>
      <Field label="Their login">
        <Seg
          label="Their login"
          value={mode}
          onChange={setMode}
          options={[
            { id: 'none', label: 'Later' },
            { id: 'existing', label: 'Use an existing one' },
            { id: 'new', label: 'Create one' },
          ]}
        />
      </Field>
      {mode === 'existing' ? (
        <Select aria-label="Existing login" value={f.user_id} onChange={set('user_id')} className={input}>
          <option value="">Choose a login…</option>
          {l.logins.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name ? `${u.name} · ${u.email}` : u.email}
            </option>
          ))}
        </Select>
      ) : null}
      {mode === 'new' ? <input aria-label="Work email for the new login" type="email" value={f.email} onChange={set('email')} placeholder="Work email for the new login" className={input} /> : null}
      {withLogin ? (
        <div className="grid grid-cols-3 gap-2.5">
          {mode === 'existing' && l.companies.length > 1 ? (
            <Field label="Company">
              <Select aria-label="Company" value={f.org_id} onChange={set('org_id')} className={input}>
                <option value="">Choose…</option>
                {l.companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          {l.departments.length ? (
            <Field label="Department">
              <Select aria-label="Department" value={f.department_id} onChange={set('department_id')} className={input}>
                <option value="">None</option>
                {l.departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          {l.designations.length ? (
            <Field label="Position">
              <Select aria-label="Position" value={f.designation_id} onChange={set('designation_id')} className={input}>
                <option value="">None</option>
                {l.designations
                  .filter((d) => !f.department_id || !d.department_id || String(d.department_id) === f.department_id)
                  .map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
              </Select>
            </Field>
          ) : null}
        </div>
      ) : (
        <span className="text-[11.5px] text-ink-3">Department and position live on the login, so they are set once there is one.</span>
      )}
      <Field label="Notes for HR">
        <textarea aria-label="Notes for HR" value={f.notes} onChange={set('notes')} className={input + ' !h-[54px] resize-none py-2'} />
      </Field>
    </Sheet>
  );
}

/** The basics after the start — only what the server accepts at this point (a login or a company only while there is none). */
function EditOnboarding({ state, onClose, onDone }: { state: ObState; onClose: () => void; onDone: () => void }) {
  const l = useLookups();
  const e = state.employee;
  const hasLogin = !!e.user_id;
  const hasCompany = !!e.org_id;
  const today = ymd(new Date());
  const was = {
    full_name: e.name ?? '',
    employment_type: e.type ?? 'permanent',
    joined_at: e.joined_at ?? '',
    target_start_date: state.onboarding?.target_start_date ?? '',
    work_location: e.work_location ?? '',
    notes: state.onboarding?.notes ?? '',
    manager_id: '',
    org_id: '',
    user_id: '',
    email: '',
  };
  const [f, setF] = useState(was);
  const [mode, setMode] = useState<LoginMode>('none');
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof was) => (ev: { target: { value: string } }) => setF((p) => ({ ...p, [k]: ev.target.value }));
  const save = async () => {
    setBusy(true);
    const body: Record<string, unknown> = {};
    for (const k of ['full_name', 'employment_type', 'joined_at', 'target_start_date', 'work_location', 'notes'] as const) if (f[k] !== was[k]) body[k] = f[k].trim() === '' ? null : f[k].trim();
    if (f.manager_id) body.manager_id = Number(f.manager_id);
    if (!hasCompany && f.org_id) body.org_id = Number(f.org_id);
    if (!hasLogin && mode === 'existing' && f.user_id) body.user_id = Number(f.user_id);
    if (!hasLogin && mode === 'new' && f.email.trim()) body.new_user = { name: f.full_name.trim(), email: f.email.trim() };
    if (!Object.keys(body).length) return onClose();
    try {
      await apiPut(`/api/hr/onboarding/${e.id}`, body);
      toast('success', 'Saved.');
      onDone();
    } catch (err) {
      toast('error', errorMessage(err));
      setBusy(false);
    }
  };
  return (
    <Sheet
      title={`Edit details · ${e.name}`}
      width={600}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" disabled={busy || !f.full_name.trim()} className={btnPrimary} onClick={() => void save()}>
            Save
          </button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-2.5">
        <Field label="Full name">
          <input aria-label="Full name" value={f.full_name} onChange={set('full_name')} className={input} />
        </Field>
        <Field label="Employment type">
          <Select aria-label="Employment type" value={f.employment_type} onChange={set('employment_type')} className={input}>
            {EMPLOYMENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {humanise(t)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Joins on">
          <input aria-label="Joins on" type="date" value={f.joined_at} onChange={set('joined_at')} className={input} />
        </Field>
        <Field label="Target start date">
          <input aria-label="Target start date" type="date" value={f.target_start_date} onChange={set('target_start_date')} className={input} />
        </Field>
        <Field label="Work location">
          <input aria-label="Work location" value={f.work_location} onChange={set('work_location')} className={input} />
        </Field>
        <Field label="Reports to" hint="Leave as it is to keep the current manager.">
          <Select aria-label="Reports to" value={f.manager_id} onChange={set('manager_id')} className={input}>
            <option value="">Unchanged</option>
            {l.people
              .filter((p) => p.id !== e.id && !hasLeft(p, today) && p.status !== 'pending_onboarding')
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name ?? p.employee_no}
                </option>
              ))}
          </Select>
        </Field>
      </div>
      {!hasLogin ? (
        <>
          <Field label="Their login">
            <Seg label="Their login" value={mode} onChange={setMode} options={[{ id: 'none', label: 'Still later' }, { id: 'existing', label: 'Use an existing one' }, { id: 'new', label: 'Create one' }]} />
          </Field>
          {mode === 'existing' ? (
            <Select aria-label="Existing login" value={f.user_id} onChange={set('user_id')} className={input}>
              <option value="">Choose a login…</option>
              {l.logins.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name ? `${u.name} · ${u.email}` : u.email}
                </option>
              ))}
            </Select>
          ) : null}
          {mode === 'new' ? <input aria-label="Work email for the new login" type="email" value={f.email} onChange={set('email')} placeholder="Work email for the new login" className={input} /> : null}
        </>
      ) : null}
      {!hasCompany && l.companies.length > 1 ? (
        <Field label="Company">
          <Select aria-label="Company" value={f.org_id} onChange={set('org_id')} className={input}>
            <option value="">Not yet</option>
            {l.companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
      <Field label="Notes for HR">
        <textarea aria-label="Notes for HR" value={f.notes} onChange={set('notes')} className={input + ' !h-[54px] resize-none py-2'} />
      </Field>
      {hasLogin ? (
        <button type="button" className="self-start text-[12px] font-semibold text-primary hover:underline" onClick={() => void call('app:openInBrowser', { path: `/users/${e.user_id}` })}>
          Their department and position are on the login — open it in the browser
        </button>
      ) : null}
    </Sheet>
  );
}

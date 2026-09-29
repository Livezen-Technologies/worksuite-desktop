import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Suspense, useEffect, useState } from 'react';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { btn, btnPrimary, Field, input, Sheet } from '../hr/parts';
import { cancelJob, distance, fetchJob, isoToLocal, K, localToIso, OFFLINE_WRITE, patchJob, refusalOf, transition, vehicleLine, type Job360, type Options, type Transition } from './api';
import { OfflineBanner, OverduePill, Pill, PriorityPill, StatusPill, when } from './parts';
import { tabFor, tabsFor } from './registry';

/**
 * One job (SRS §13, §28.3, FR-JOB-01..10): the header with the vehicle,
 * customer, advisor, technicians, bay, promised time and odometer; where it
 * is on the pipeline; the moves the server offers from here (and what stands
 * in the way of the others); cancelling with a reason; and the tabs of
 * `registry.ts` — stage A's, and stage B's as they arrive.
 *
 * A move sends the version the card was read at. When somebody else changed
 * the job first the server says so (409) and sends the job as it is now,
 * which the card shows instead.
 */
type Ask = { kind: 'move'; t: Transition } | { kind: 'cancel' } | { kind: 'edit' };

/** The moves offered as buttons (cancel has its own), and those that stand refused with the server's reason — never ones the reader may not ask for. */
export function movesOf(transitions: Transition[]): { offered: Transition[]; blocked: Transition[] } {
  const moves = transitions.filter((t) => t.to !== 'cancelled');
  return {
    offered: moves.filter((t) => t.allowed),
    blocked: moves.filter((t) => !t.allowed && !!t.why && !/permission/i.test(t.why)),
  };
}

export default function JobCard({
  id,
  tab,
  options,
  online,
  onTab,
  onBack,
  onJob,
  onVehicle,
  onCustomer,
}: {
  id: number;
  tab: string | null;
  options: Options;
  online: boolean;
  onTab: (t: string) => void;
  onBack: () => void;
  onJob: (id: number) => void;
  onVehicle: (id: number) => void;
  onCustomer: (id: number) => void;
}) {
  const qc = useQueryClient();
  // Opened means read afresh: a job moved by somebody else a moment ago must not show its old status and moves.
  const q = useQuery({ queryKey: K.job(id), queryFn: ({ signal }) => fetchJob(id, signal), refetchOnMount: 'always', refetchInterval: 60_000 });
  const [ask, setAsk] = useState<Ask | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key !== 'Escape' || document.querySelector('[role="dialog"]')) return;
      if (t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return;
      onBack();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onBack]);

  if (q.isLoading) return <Spinner />;
  if (q.error || !q.data)
    return (
      <div className="flex flex-col gap-3 px-6 py-5">
        <Back onBack={onBack} />
        <ErrorNote error={q.error ?? new Error('This job could not be read.')} onRetry={() => void q.refetch()} />
      </div>
    );
  const job = q.data.data.job;
  const company = options.companies.find((c) => c.id === job.org_id);
  const offline = !online || q.data.offline;
  const unit = company?.distance_unit ?? 'km';
  const { offered, blocked } = movesOf(job.transitions);
  const cancellable = job.can.cancel && job.transitions.some((t) => t.to === 'cancelled' && t.allowed);
  const finished = job.status === 'completed' || job.status === 'cancelled';
  const visible = tabsFor(job, company);
  const current = tabFor(tab, visible);
  const Tab = current?.component;

  /** The job as the server answered, shown at once; everything that lists it is read again. */
  const changed = (next?: Job360 | null) => {
    if (next) qc.setQueryData(K.job(id), { data: { job: next }, offline: false, cachedAt: null });
    void qc.invalidateQueries({ queryKey: K.all });
  };
  const run = async (key: string, fn: () => Promise<{ data: { job: Job360 | null }; message?: string | null }>, done: string) => {
    if (offline) return toast('error', OFFLINE_WRITE);
    setBusy(key);
    try {
      const r = await fn();
      toast('success', r.message || done);
      setAsk(null);
      changed(r.data.job);
    } catch (e) {
      const p = refusalOf(e);
      if (p.code === 'version_conflict') {
        toast('error', `${p.message} This is the job as it is now.`);
        setAsk(null);
        changed(p.server);
      } else {
        // The server's sentence as written. A 409 means the job changed under the action (a cancel that met a
        // timer or a part moving): read it again. A 500 rolled everything back: the sheet stays for another try.
        toast('error', p.message);
        if (p.status === 409) {
          setAsk(null);
          changed();
        }
      }
    } finally {
      setBusy(null);
    }
  };
  const move = (t: Transition, reason?: string) => {
    if (t.needs.includes('reason') && !reason) return setAsk({ kind: 'move', t });
    void run(`move:${t.to}`, () => transition(job.id, { to: t.to, ...(reason ? { reason } : {}) }, job.version), `Moved to ${t.label}.`);
  };
  const stages = Object.entries(options.columns);
  const here = stages.findIndex(([code]) => code === job.column);

  return (
    <div className="flex flex-col gap-3.5 px-6 py-5">
      <Back onBack={onBack} />
      {q.data.offline ? <OfflineBanner cachedAt={q.data.cachedAt} /> : null}
      <section className="flex flex-col gap-3 rounded-[12px] border border-line bg-surface px-4 py-3.5" aria-label="Job">
        <div className="flex flex-wrap items-start gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <StatusPill status={job.status} label={job.status_label} />
              <PriorityPill priority={job.priority} options={options} />
              {job.overdue ? <OverduePill /> : null}
              {job.vehicle?.fleet ? <Pill tone="violet">Fleet</Pill> : null}
              {job.waiting_reason ? <Pill tone="amber">Waiting: {options.waiting_reasons[job.waiting_reason] ?? job.waiting_reason}</Pill> : null}
            </div>
            <h1 className="m-0 text-[20px] leading-snug font-bold text-ink">
              {job.number} — {job.vehicle?.make_model ?? job.vehicle?.vehicle_number ?? 'Vehicle'}
            </h1>
            <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12.5px] text-ink-2">
              {job.vehicle ? (
                <button type="button" className="font-semibold text-primary hover:underline" onClick={() => onVehicle(job.vehicle!.id)}>
                  {vehicleLine(job.vehicle)}
                </button>
              ) : null}
              {job.customer ? (
                <button type="button" className="hover:underline" onClick={() => onCustomer(job.customer!.id)}>
                  {job.customer.name}
                  {job.customer.phone ? ` · ${job.customer.phone}` : ''}
                </button>
              ) : null}
              {company && options.companies.length > 1 ? <span className="text-ink-3">{company.name}</span> : null}
            </span>
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
            {offered.map((t) => (
              <button key={t.to} type="button" className={btnPrimary} disabled={offline || !!busy} onClick={() => move(t)}>
                {busy === `move:${t.to}` ? <Icon name="spinner" size={15} className="animate-spin-slow" /> : <Icon name="chevron-right" size={15} />} {t.label}
              </button>
            ))}
            {job.can.edit && !finished ? (
              <button type="button" className={btn} disabled={offline} onClick={() => setAsk({ kind: 'edit' })}>
                <Icon name="compose" size={15} /> Edit
              </button>
            ) : null}
            {cancellable ? (
              <button type="button" className={btn} disabled={offline} onClick={() => setAsk({ kind: 'cancel' })}>
                <Icon name="x" size={15} /> Cancel job…
              </button>
            ) : null}
          </div>
        </div>
        <dl className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-x-4 gap-y-1.5 text-[12.5px]">
          {(
            [
              ['Service advisor', job.service_advisor?.name],
              ['Technicians', job.technicians.map((t) => t.name).filter(Boolean).join(', ') || null],
              ['Bay', job.bay ? `${job.bay.code} · ${job.bay.name}` : null],
              ['Promised', when(job.target_completion_at) || null],
              ['Odometer in', job.odometer_in !== null ? distance(job.odometer_in, unit) : null],
              ['Pipeline', job.pipeline?.name],
              ['Job type', options.job_types[job.job_type] ?? job.job_type],
              ['Service type', job.service_type?.name],
              ['Workshop', job.workshop?.name],
            ] as Array<[string, string | null | undefined]>
          ).map(([k, v]) => (
            <div key={k} className="flex min-w-0 flex-col">
              <dt className="text-[11.5px] text-ink-3">{k}</dt>
              <dd className="m-0 truncate font-semibold text-ink">{v || '—'}</dd>
            </div>
          ))}
        </dl>
        {job.status !== 'cancelled' ? (
          <ol className="flex flex-wrap items-center gap-1" aria-label="Where the job is">
            {stages.map(([code, c], i) => (
              <li key={code} aria-current={i === here ? 'step' : undefined} className={cx('flex h-6 items-center rounded-[6px] px-2 text-[11px] font-bold', i === here ? 'bg-primary text-white' : i < here ? 'bg-[#E4F4EA] text-[#145C39] dark:bg-success-bg dark:text-success' : 'bg-subtle text-ink-3')}>
                {c.label}
              </li>
            ))}
          </ol>
        ) : (
          <p className="m-0 text-[12.5px] text-ink-2">
            Cancelled{job.cancel ? ` — ${options.cancel_reasons[job.cancel.code] ?? job.cancel.code}${job.cancel.reason ? `: ${job.cancel.reason}` : ''}` : ''}.
          </p>
        )}
        {blocked.length ? (
          <ul className="m-0 flex flex-col gap-0.5 p-0 text-[12px] text-ink-2" aria-label="What stands in the way">
            {blocked.map((t) => (
              <li key={t.to} className="flex list-none items-start gap-1.5">
                <Icon name="lock" size={13} className="mt-px shrink-0 text-ink-3" />
                <span>
                  <b>{t.label}:</b> {t.why}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <div role="tablist" aria-label="Job card" className="flex flex-wrap gap-1 border-b border-line">
        {visible.map((t) => {
          const on = current?.id === t.id;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={on}
              aria-disabled={!t.component}
              title={t.component ? undefined : t.soon}
              onClick={() => t.component && onTab(t.id)}
              className={cx('-mb-px h-9 border-b-2 px-3 text-[13px] font-semibold', on ? 'border-primary text-primary' : 'border-transparent text-ink-2 hover:text-ink', !t.component && 'cursor-default text-ink-3 opacity-60 hover:text-ink-3')}
            >
              {t.label}
            </button>
          );
        })}
      </div>
      <div role="tabpanel" aria-label={current?.label}>
        <Suspense fallback={<Spinner />}>{Tab ? <Tab job={job} company={company} options={options} online={!offline} onChanged={changed} onJob={onJob} /> : null}</Suspense>
      </div>

      {ask?.kind === 'move' ? <ReasonSheet title={ask.t.label} busy={!!busy} onClose={() => setAsk(null)} onSave={(why) => move(ask.t, why)} /> : null}
      {ask?.kind === 'cancel' ? <CancelSheet job={job} options={options} busy={busy === 'cancel'} onClose={() => setAsk(null)} onSave={(code, why) => void run('cancel', () => cancelJob(job.id, { reason_code: code, ...(why ? { reason: why } : {}) }, job.version), 'Job cancelled.')} /> : null}
      {ask?.kind === 'edit' ? <EditSheet job={job} options={options} busy={busy === 'edit'} onClose={() => setAsk(null)} onSave={(body) => void run('edit', () => patchJob(job.id, body, job.version), 'Saved.')} /> : null}
    </div>
  );
}

function Back({ onBack }: { onBack: () => void }) {
  return (
    <button type="button" onClick={onBack} className="flex items-center gap-1 self-start text-[12.5px] font-semibold text-ink-2 hover:text-ink" title="Back (Esc)">
      <Icon name="chevron-left" size={15} /> Back
    </button>
  );
}

function ReasonSheet({ title, busy, onClose, onSave }: { title: string; busy: boolean; onClose: () => void; onSave: (why: string) => void }) {
  const [why, setWhy] = useState('');
  return (
    <Sheet
      title={title}
      width={440}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} disabled={busy || !why.trim()} onClick={() => onSave(why.trim())}>
            {title}
          </button>
        </>
      }
    >
      <Field label="Why" hint="Kept in the job’s history.">
        <input autoFocus aria-label="Why" value={why} onChange={(e) => setWhy(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && why.trim() && onSave(why.trim())} className={input} maxLength={500} />
      </Field>
    </Sheet>
  );
}

/** Cancelling (WF-23): a reason from the list, and words when it is "other". What it lets go of is the server's to do. */
export function CancelSheet({ job, options, busy, onClose, onSave }: { job: Pick<Job360, 'number' | 'started_at'>; options: Options; busy: boolean; onClose: () => void; onSave: (code: string, why: string) => void }) {
  const [code, setCode] = useState('');
  const [why, setWhy] = useState('');
  const needsWords = code === 'other';
  const ready = !!code && (!needsWords || !!why.trim());
  return (
    <Sheet
      title={`Cancel ${job.number}?`}
      width={460}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Keep the job
          </button>
          <button type="button" className={cx(btnPrimary, 'bg-danger hover:bg-danger')} disabled={busy || !ready} onClick={() => onSave(code, why.trim())}>
            Cancel the job
          </button>
        </>
      }
    >
      <Field label="Reason">
        <Select aria-label="Reason" value={code} onValueChange={setCode} options={[{ value: '', label: 'Choose a reason' }, ...Object.entries(options.cancel_reasons).map(([value, label]) => ({ value, label }))]} />
      </Field>
      <Field label={needsWords ? 'Say why' : 'More about it (optional)'}>
        <textarea aria-label="Say why" value={why} onChange={(e) => setWhy(e.target.value)} rows={3} className={cx(input, 'h-auto py-2')} maxLength={1000} />
      </Field>
      <span className="text-[12px] text-ink-3">
        Reserved parts are released, open parts requests and work orders are cancelled; parts already issued stay recorded.{job.started_at ? ' Work has started, so only a workshop manager may cancel it.' : ''}
      </span>
    </Sheet>
  );
}

function EditSheet({ job, options, busy, onClose, onSave }: { job: Job360; options: Options; busy: boolean; onClose: () => void; onSave: (body: Record<string, unknown>) => void }) {
  const [priority, setPriority] = useState(job.priority);
  const [promised, setPromised] = useState(isoToLocal(job.target_completion_at));
  const [work, setWork] = useState(job.requested_work ?? '');
  const [notes, setNotes] = useState(job.notes ?? '');
  const [jobType, setJobType] = useState(job.job_type);
  // Only what changed is sent: a field somebody else just changed is left as it is on the server.
  const body: Record<string, unknown> = {};
  if (priority !== job.priority) body.priority = priority;
  if (jobType !== job.job_type) body.job_type = jobType;
  if (promised !== isoToLocal(job.target_completion_at)) body.target_completion_at = promised ? localToIso(promised) : null;
  if (work !== (job.requested_work ?? '')) body.requested_work = work;
  if (notes !== (job.notes ?? '')) body.notes = notes;
  return (
    <Sheet
      title={`Edit ${job.number}`}
      width={520}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} disabled={busy || !Object.keys(body).length} onClick={() => onSave(body)}>
            Save
          </button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-2.5">
        <Field label="Priority" hint="Never raised to urgent by WorkSuite itself.">
          <Select aria-label="Priority" value={priority} onValueChange={setPriority} options={Object.entries(options.priorities).map(([value, label]) => ({ value, label }))} />
        </Field>
        <Field label="Job type">
          <Select aria-label="Job type" value={jobType} onValueChange={setJobType} options={Object.entries(options.job_types).map(([value, label]) => ({ value, label }))} />
        </Field>
      </div>
      <Field label="Promised for" hint="Your clock. Moving it re-arms the overdue notice.">
        <input type="datetime-local" aria-label="Promised for" value={promised} onChange={(e) => setPromised(e.target.value)} className={input} />
      </Field>
      <Field label="What the customer asks for">
        <textarea aria-label="Requested work" value={work} onChange={(e) => setWork(e.target.value)} rows={3} className={cx(input, 'h-auto py-2')} maxLength={2000} />
      </Field>
      <Field label="Notes on the job">
        <textarea aria-label="Notes on the job" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className={cx(input, 'h-auto py-2')} maxLength={4000} />
      </Field>
    </Sheet>
  );
}

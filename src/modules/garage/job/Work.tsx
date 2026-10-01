import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Select } from '../../../components/Select';
import { Button, ErrorNote, Modal, Spinner, cx } from '../../../components/ui';
import { toast } from '../../../core/toasts';
import { errorText, fromLocalInput, gGet, gPost, K, newKey, nice, PAUSE_LABEL, partCounts, span, timer, toLocalInput, when, type LabourEntry, type WorkOrder, type WorkView } from '../api';
import { AskForPart, PauseTimer, RaiseAdditional } from '../MyWork';
import { PartActions } from '../PartsCounter';
import { Ask, DocActions, Field, input, LightPill, PartPill, Section, useGarage, WorkPill } from '../parts';
import { Checkbox } from '../../../components/Checkbox';

const OPEN_JOB = ['APPROVED', 'WAITING_PARTS', 'READY_TO_START', 'IN_PROGRESS', 'PAUSED', 'ADDITIONAL_APPROVAL_REQUIRED'];

/**
 * The job's work (WF-11..14): its work orders with their people, bay and
 * timer; the parts on the job; additional work found under the car; and the
 * labour recorded. The job's status follows from these — nothing here picks
 * it. A timer started or paused with WorkSuite out of reach is kept with its
 * moment and sent when it is back, as on My work.
 */
export default function WorkTab({ jobId, onChange, onEstimate }: { jobId: number; onChange: () => void; onEstimate: () => void }) {
  const g = useGarage();
  const qc = useQueryClient();
  const key = K.work(jobId);
  const q = useQuery({ queryKey: key, queryFn: ({ signal }) => gGet<WorkView>(`/jobs/${jobId}/work`, undefined, signal) });
  const [adding, setAdding] = useState(false);
  const [asking, setAsking] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [pick, setPick] = useState<number[]>([]);

  if (q.isLoading) return <Spinner />;
  if (q.error || !q.data) return <ErrorNote error={q.error ?? new Error('The work could not be loaded.')} onRetry={() => void q.refetch()} />;

  const d = q.data;
  const can = d.can ?? { assign: false, execute: false, request: false, issue: false, return: false, correct: false, price: false, override: false, financials: false };
  const reload = () => {
    void qc.invalidateQueries({ queryKey: key });
    void qc.invalidateQueries({ queryKey: K.estimates(jobId) });
    onChange();
  };
  const online = g.online;
  const open = OPEN_JOB.includes(d.job_status);
  const code = (id: number | null) => d.work_orders.find((w) => w.id === id)?.code ?? '—';
  const additional = d.additional ?? [];
  const raised = additional.filter((a) => a.status === 'RAISED');
  const live = d.work_orders.find((w) => !['COMPLETED', 'CANCELLED'].includes(w.status));

  const price = async () => {
    try {
      const r = await gPost(`/jobs/${jobId}/additional/price`, { ids: pick });
      toast('success', r.message);
      setPick([]);
      reload();
      onEstimate();
    } catch (e) {
      toast('error', errorText(e));
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap justify-end gap-2">
        {can.request && open && live ? (
          <Button size="sm" disabled={!online} onClick={() => setAsking(true)}>
            Ask for a part
          </Button>
        ) : null}
        {(can.execute || can.return) && d.work_orders.length > 0 ? (
          <Button size="sm" variant="ghost" disabled={!online} onClick={() => setRemoving(true)}>
            Record a removed part
          </Button>
        ) : null}
        {can.assign && open ? (
          <Button size="sm" icon="plus" disabled={!online} onClick={() => setAdding(true)}>
            Work order
          </Button>
        ) : null}
      </div>

      {d.work_orders.length === 0 ? (
        <Section title="Work orders">
          <p className="m-0 text-[13px] text-ink-3">No work orders yet. They are made from the approved lines when the customer approves the estimate.</p>
        </Section>
      ) : (
        d.work_orders.map((w) => <WorkOrderCard key={w.id} w={w} d={d} can={can} onChange={reload} />)
      )}

      {additional.length > 0 ? (
        <Section
          title="Additional work"
          action={
            can.price && raised.length > 0 ? (
              <Button size="sm" variant="primary" disabled={pick.length === 0 || !online} onClick={() => void price()}>
                Price {pick.length || ''} for the customer
              </Button>
            ) : null
          }
        >
          <ul className="m-0 flex list-none flex-col divide-y divide-line p-0">
            {additional.map((a) => (
              <li key={a.id} className="flex items-start gap-2 py-2">
                {can.price && a.status === 'RAISED' ? (
                  <Checkbox className="mt-1" aria-label={`Price ${a.finding}`} checked={pick.includes(a.id)} onChange={(e) => setPick(e.target.checked ? [...pick, a.id] : pick.filter((x) => x !== a.id))} />
                ) : null}
                <div className="min-w-0 flex-1">
                  <p className="m-0 flex flex-wrap items-center gap-1.5 text-[13px]">
                    <LightPill value={a.priority} />
                    {a.finding}
                  </p>
                  <p className="m-0 text-[11.5px] text-ink-3">
                    {code(a.work_order_id)} · {a.raised_by ?? '—'} · {span(a.labour_minutes)}
                    {a.parts.length ? ` · ${a.parts.length} part${a.parts.length === 1 ? '' : 's'}` : ''} · {nice(a.status)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <Section title={`Parts (${d.parts.length})`}>
        {d.parts.length === 0 ? (
          <p className="m-0 text-[13px] text-ink-3">No parts on this job.</p>
        ) : (
          <ul className="m-0 flex list-none flex-col divide-y divide-line p-0">
            {d.parts.map((u) => (
              <li key={u.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div className="min-w-0">
                  <p className="m-0 flex flex-wrap items-center gap-1.5 text-[13px]">
                    <PartPill status={u.status} />
                    <b className="font-medium">{u.description}</b>
                    <span className="text-[11.5px] text-ink-3">
                      {code(u.work_order_id)}
                      {u.source === 'REQUEST' ? ' · asked for, not on the estimate' : ''}
                    </span>
                  </p>
                  <span className="text-[11.5px] text-ink-3">
                    {partCounts(u)}
                    {u.serial_no ? ` · serial ${u.serial_no}` : ''}
                  </span>
                </div>
                {online ? <PartActions u={u} technicians={(d.technicians ?? []).map((t) => ({ id: t.id, name: t.name }))} onChange={reload} can={{ issue: can.issue, return: can.return, override: can.override, used: can.execute || can.issue }} /> : null}
              </li>
            ))}
          </ul>
        )}
        {(d.removed ?? []).length > 0 ? (
          <div className="mt-3 border-t border-line pt-2">
            <p className="m-0 mb-1 text-[11px] font-bold text-ink-3 uppercase">Removed from the vehicle</p>
            <ul className="m-0 flex list-none flex-col gap-0.5 p-0 text-[13px]">
              {d.removed!.map((r) => (
                <li key={r.id}>
                  {r.description} × {r.qty} — {nice(r.disposition)}
                  {r.note ? ` (${r.note})` : ''}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </Section>

      <LabourList d={d} canCorrect={can.correct && online} onChange={reload} />

      {adding ? (
        <AddWorkOrder
          jobId={jobId}
          skills={d.skills ?? []}
          onClose={() => setAdding(false)}
          onDone={() => {
            setAdding(false);
            reload();
          }}
        />
      ) : null}
      {asking && live ? (
        <AskForPart
          w={live}
          currency={g.options.currency}
          onClose={() => setAsking(false)}
          onDone={() => {
            setAsking(false);
            reload();
          }}
        />
      ) : null}
      {removing ? (
        <RemovedPart
          jobId={jobId}
          d={d}
          onClose={() => setRemoving(false)}
          onDone={() => {
            setRemoving(false);
            reload();
          }}
        />
      ) : null}
    </div>
  );
}

type Dialog = { kind: 'assign' } | { kind: 'bay' } | { kind: 'pause'; technicianId: number; who: string } | { kind: 'raise' } | { kind: 'complete' } | { kind: 'cancel' } | { kind: 'edit' } | null;

function WorkOrderCard({ w, d, can, onChange }: { w: WorkOrder; d: WorkView; can: NonNullable<WorkView['can']>; onChange: () => void }) {
  const g = useGarage();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState(false);
  const me = d.me ?? null;
  const mine = me !== null && w.technicians.some((t) => t.id === me);
  const live = !['COMPLETED', 'CANCELLED'].includes(w.status);
  // Whose timer the buttons drive: mine, or — for someone who assigns — each technician on it.
  const timers = mine ? w.technicians.filter((t) => t.id === me) : can.assign ? w.technicians : [];
  const late = w.estimated_minutes > 0 && w.logged_minutes > w.estimated_minutes;
  const online = g.online;

  const send = async (path: string, body: Record<string, unknown> = {}, key?: string) => {
    setBusy(true);
    try {
      const r = await gPost(path, body, key ? newKey(key) : undefined);
      toast('success', r.message);
      setDialog(null);
      onChange();
    } catch (e) {
      toast('error', errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const start = async (technicianId: number, who: string) => {
    setBusy(true);
    try {
      const r = await timer(w.id, 'start', { technician_id: technicianId }, `Start ${w.code} for ${who}`);
      toast(r.queued ? 'info' : 'success', r.message);
      if (!r.queued) onChange();
    } catch (e) {
      toast('error', errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section
      title={`${w.code} · ${w.work_type}`}
      action={
        <span className="flex items-center gap-2">
          {w.is_additional ? <span className="rounded-[5px] bg-selection px-1.5 py-0.5 text-[10px] font-bold text-primary">ADDITIONAL</span> : null}
          <WorkPill status={w.status} />
        </span>
      }
    >
      {w.description ? <p className="m-0 text-[13px] text-ink-2">{w.description}</p> : null}
      <dl className="m-0 mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[13px] sm:grid-cols-4">
        <div>
          <dt className="text-[11.5px] text-ink-3">Technicians</dt>
          <dd className="m-0">
            {w.technicians.length === 0
              ? '—'
              : w.technicians.map((t) => (
                  <span key={t.id} className="mr-1 inline-flex items-center gap-1">
                    {t.running ? <span className="size-2 rounded-full bg-success" aria-label="timer running" /> : null}
                    {t.name}
                    {t.role !== 'LEAD' ? ` (${t.role.toLowerCase()})` : ''}
                  </span>
                ))}
          </dd>
        </div>
        <div>
          <dt className="text-[11.5px] text-ink-3">Bay</dt>
          <dd className="m-0">{w.bay ? `${w.bay.code}${w.slot ? ` · ${when(w.slot.starts_at)}` : ''}` : '—'}</dd>
        </div>
        <div>
          <dt className="text-[11.5px] text-ink-3">Time</dt>
          <dd className={cx('m-0', late && 'font-semibold text-warning')}>
            {span(w.status === 'COMPLETED' ? (w.actual_minutes ?? w.logged_minutes) : w.logged_minutes)} of {span(w.estimated_minutes)}
          </dd>
        </div>
        <div>
          <dt className="text-[11.5px] text-ink-3">Needs</dt>
          <dd className="m-0">{w.required_skill ?? '—'}</dd>
        </div>
      </dl>
      {w.lines.length > 0 ? (
        <ul className="m-0 mt-2 list-inside list-disc p-0 text-[12px] text-ink-2">
          {w.lines.map((l) => (
            <li key={l.id}>{l.description}</li>
          ))}
        </ul>
      ) : null}
      {w.cancel_reason ? <p className="m-0 mt-2 text-[12px] text-ink-3">Cancelled: {w.cancel_reason}</p> : null}
      <div className="mt-3 flex flex-wrap gap-2 border-t border-line pt-3">
        {live && can.execute
          ? timers.map((t) =>
              t.running ? (
                <Button key={t.id} size="sm" icon="pause" onClick={() => setDialog({ kind: 'pause', technicianId: t.id, who: t.name })}>
                  Pause{timers.length > 1 || !mine ? ` ${t.name}` : ''}
                </Button>
              ) : (
                <Button
                  key={t.id}
                  size="sm"
                  variant="primary"
                  icon="play"
                  loading={busy}
                  disabled={w.status === 'PENDING' || w.status === 'READY'}
                  title={w.status === 'PENDING' ? 'Its parts are not all here yet' : w.status === 'READY' ? 'Assign a lead technician first' : undefined}
                  onClick={() => void start(t.id, t.name)}
                >
                  Start{timers.length > 1 || !mine ? ` ${t.name}` : ''}
                </Button>
              ),
            )
          : null}
        {live && can.execute && (mine || can.assign) && ['IN_PROGRESS', 'PAUSED', 'WAITING_PARTS', 'REWORK'].includes(w.status) ? (
          <Button size="sm" disabled={!online} onClick={() => setDialog({ kind: 'complete' })}>
            Complete
          </Button>
        ) : null}
        {live && can.execute && ['IN_PROGRESS', 'PAUSED', 'WAITING_PARTS', 'ASSIGNED', 'REWORK'].includes(w.status) ? (
          <Button size="sm" variant="ghost" disabled={!online} onClick={() => setDialog({ kind: 'raise' })}>
            Found more work
          </Button>
        ) : null}
        {live && can.assign ? (
          <Button size="sm" variant="ghost" disabled={!online} onClick={() => setDialog({ kind: 'assign' })}>
            {w.technicians.length ? 'People' : 'Assign'}
          </Button>
        ) : null}
        {live && can.assign ? (
          <Button size="sm" variant="ghost" disabled={!online} onClick={() => setDialog({ kind: 'bay' })}>
            Bay
          </Button>
        ) : null}
        {live && can.assign && ['PENDING', 'READY', 'ASSIGNED'].includes(w.status) ? (
          <Button size="sm" variant="ghost" disabled={!online} onClick={() => setDialog({ kind: 'edit' })}>
            Change
          </Button>
        ) : null}
        {live && can.assign && ['PENDING', 'READY', 'ASSIGNED'].includes(w.status) ? (
          <Button size="sm" variant="ghost" className="text-danger" disabled={!online} onClick={() => setDialog({ kind: 'cancel' })}>
            Cancel
          </Button>
        ) : null}
        <DocActions doc={{ kind: 'work-order', workOrder: w.id }} name={`${w.code} work order.html`} label="Sheet" what="work order sheet" />
      </div>
      {dialog?.kind === 'assign' ? <Assign w={w} d={d} onClose={() => setDialog(null)} onDone={() => { setDialog(null); onChange(); }} /> : null}
      {dialog?.kind === 'bay' ? <BookBay w={w} d={d} onClose={() => setDialog(null)} onDone={() => { setDialog(null); onChange(); }} /> : null}
      {dialog?.kind === 'pause' ? (
        <PauseTimer
          w={w}
          technicianId={dialog.technicianId}
          who={dialog.who}
          reasons={d.pause_reasons ?? []}
          onClose={() => setDialog(null)}
          onDone={(queued) => {
            setDialog(null);
            if (!queued) onChange();
          }}
        />
      ) : null}
      {dialog?.kind === 'raise' ? <RaiseAdditional w={w} currency={g.options.currency} onClose={() => setDialog(null)} onDone={() => { setDialog(null); onChange(); }} /> : null}
      {dialog?.kind === 'complete' ? (
        <Modal
          title={`Complete ${w.code}?`}
          onClose={() => setDialog(null)}
          footer={
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setDialog(null)}>
                Not yet
              </Button>
              <Button variant="primary" loading={busy} onClick={() => void send(`/work-orders/${w.id}/complete`, {}, 'wo-done')}>
                Complete
              </Button>
            </div>
          }
        >
          <p className="m-0 text-[13px] text-ink-2">Every timer on it stops. Parts issued to it must be used or returned first.</p>
        </Modal>
      ) : null}
      {dialog?.kind === 'edit' ? (
        <Ask
          title={`Change ${w.code}`}
          text="What the work is, before it starts."
          fields={[
            { name: 'work_type', label: 'Kind of work', required: true, initial: w.work_type },
            { name: 'description', label: 'What to do', type: 'textarea', initial: w.description ?? '' },
            { name: 'required_skill', label: 'Needs a skill', type: 'select', initial: w.required_skill ?? '', options: [{ value: '', label: 'No' }, ...(d.skills ?? []).map((x) => ({ value: x, label: x }))] },
            { name: 'estimated_minutes', label: 'Minutes', type: 'number', initial: String(w.estimated_minutes || '') },
          ]}
          busy={busy}
          onClose={() => setDialog(null)}
          onSubmit={(v) => void send(`/work-orders/${w.id}`, { work_type: v.work_type, description: v.description, required_skill: v.required_skill, estimated_minutes: Number(v.estimated_minutes) || 0 })}
        />
      ) : null}
      {dialog?.kind === 'cancel' ? (
        <Ask title={`Cancel ${w.code}?`} text="Its parts are released." fields={[{ name: 'reason', label: 'Why', required: true }]} confirm="Cancel work order" danger busy={busy} onClose={() => setDialog(null)} onSubmit={(v) => void send(`/work-orders/${w.id}/cancel`, { reason: v.reason })} />
      ) : null}
    </Section>
  );
}

interface Suggestion {
  id: number;
  name: string;
  skills: string[];
  is_lead: boolean;
  has_skill: boolean;
  open_work: number;
  busy: boolean;
}

/** Who works on it (FR-TEC-04/07): one lead, assistants and specialists; suggestions put the skill first, then the least loaded. */
function Assign({ w, d, onClose, onDone }: { w: WorkOrder; d: WorkView; onClose: () => void; onDone: () => void }) {
  const [roles, setRoles] = useState<Record<number, string>>(() => Object.fromEntries(w.technicians.map((t) => [t.id, t.role])));
  const [hints, setHints] = useState<Suggestion[] | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    gGet<{ technicians: Suggestion[] }>(`/work-orders/${w.id}/suggest`)
      .then((r) => {
        if (live) setHints(r.technicians);
      })
      .catch(() => {
        if (live) setHints([]);
      });
    return () => {
      live = false;
    };
  }, [w.id]);
  const people: Suggestion[] = hints && hints.length ? hints : (d.technicians ?? []).map((t) => ({ id: t.id, name: t.name, skills: t.skills, is_lead: t.is_lead, has_skill: true, open_work: 0, busy: false }));
  const save = async () => {
    setBusy(true);
    try {
      const r = await gPost<{ warnings?: string[] }>(`/work-orders/${w.id}/assign`, {
        technicians: Object.entries(roles)
          .filter(([, role]) => role)
          .map(([id, role]) => ({ technician_id: Number(id), role })),
      });
      toast(r.data?.warnings?.length ? 'warning' : 'success', r.message);
      onDone();
    } catch (e) {
      toast('error', errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={`Who works on ${w.code}`}
      onClose={onClose}
      width={560}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} onClick={() => void save()}>
            Save
          </Button>
        </div>
      }
    >
      <p className="m-0 mb-2 text-[12.5px] text-ink-3">{w.required_skill ? `Needs ${w.required_skill}.` : 'One lead; assistants and specialists as needed.'}</p>
      <ul className="m-0 flex list-none flex-col divide-y divide-line p-0">
        {people.map((t) => (
          <li key={t.id} className="flex items-center justify-between gap-2 py-2">
            <div className="min-w-0">
              <p className="m-0 text-[13px] font-medium">
                {t.name}
                {t.busy ? <span className="ml-2 text-[10px] font-bold text-success uppercase">working now</span> : null}
              </p>
              <p className="m-0 text-[11.5px] text-ink-3">
                {t.has_skill ? '' : <span className="text-warning">no {w.required_skill} · </span>}
                {t.open_work} open work order{t.open_work === 1 ? '' : 's'}
                {t.skills.length ? ` · ${t.skills.join(', ')}` : ''}
              </p>
            </div>
            <Select
              aria-label={`Role of ${t.name}`}
              value={roles[t.id] ?? ''}
              onChange={(e) => setRoles({ ...roles, [t.id]: e.target.value })}
              options={[
                { value: '', label: 'Not on it' },
                { value: 'LEAD', label: 'Lead' },
                { value: 'ASSISTANT', label: 'Assistant' },
                { value: 'SPECIALIST', label: 'Specialist' },
              ]}
              className={cx(input, 'w-36')}
            />
          </li>
        ))}
      </ul>
    </Modal>
  );
}

/** A bay for a slot (FR-BAY-04); the server refuses an overlap or a bay out of use. */
function BookBay({ w, d, onClose, onDone }: { w: WorkOrder; d: WorkView; onClose: () => void; onDone: () => void }) {
  const [bay, setBay] = useState(String(w.bay?.id ?? d.bays?.[0]?.id ?? ''));
  const [start, setStart] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const r = await gPost(`/work-orders/${w.id}/bay`, { bay_id: Number(bay), starts_at: start ? fromLocalInput(start) : undefined });
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
      title={`Bay for ${w.code}`}
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} disabled={!bay} onClick={() => void save()}>
            Book
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="m-0 text-[12.5px] text-ink-3">About {span(w.estimated_minutes || 30)}.</p>
        <Field label="Bay">
          <Select aria-label="Bay" value={bay} onChange={(e) => setBay(e.target.value)} options={(d.bays ?? []).map((b) => ({ value: String(b.id), label: `${b.code}${b.name ? ` · ${b.name}` : ''} · ${nice(b.bay_type)} · ${nice(b.status)}` }))} className={input} />
        </Field>
        <Field label="From" hint="Left empty, from now.">
          <input type="datetime-local" className={input} aria-label="From" value={start} onChange={(e) => setStart(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

/** Work the workshop does that is not a customer-approved line — not charged. */
function AddWorkOrder({ jobId, skills, onClose, onDone }: { jobId: number; skills: string[]; onClose: () => void; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <Ask
      title="Add a work order"
      text="Work the workshop does that is not a customer-approved line — not charged."
      fields={[
        { name: 'work_type', label: 'Kind of work', required: true, placeholder: 'Wash' },
        { name: 'description', label: 'What to do', type: 'textarea' },
        { name: 'required_skill', label: 'Needs a skill', type: 'select', options: [{ value: '', label: 'No' }, ...skills.map((s) => ({ value: s, label: s }))] },
        { name: 'estimated_minutes', label: 'Minutes', type: 'number' },
      ]}
      confirm="Add"
      busy={busy}
      onClose={onClose}
      onSubmit={(v) => {
        setBusy(true);
        gPost(`/jobs/${jobId}/work-orders`, { work_type: v.work_type, description: v.description, required_skill: v.required_skill || undefined, estimated_minutes: Number(v.estimated_minutes) || 0 })
          .then((r) => {
            toast('success', r.message);
            onDone();
          })
          .catch((e: unknown) => toast('error', errorText(e)))
          .finally(() => setBusy(false));
      }}
    />
  );
}

/** A part taken off the vehicle and what becomes of it (FR-PRT-06). */
function RemovedPart({ jobId, d, onClose, onDone }: { jobId: number; d: WorkView; onClose: () => void; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <Ask
      title="A part removed from the vehicle"
      fields={[
        { name: 'description', label: 'What came off', required: true },
        { name: 'qty', label: 'How many', type: 'number', initial: '1', required: true },
        { name: 'disposition', label: 'What happens to it', type: 'select', options: (d.dispositions ?? []).map((x) => ({ value: x, label: nice(x) })) },
        { name: 'work_order_id', label: 'From', type: 'select', options: d.work_orders.map((w) => ({ value: String(w.id), label: `${w.code} · ${w.work_type}` })) },
        { name: 'note', label: 'Note' },
      ]}
      confirm="Record"
      busy={busy}
      onClose={onClose}
      onSubmit={(v) => {
        setBusy(true);
        gPost(`/jobs/${jobId}/removed-parts`, { description: v.description, qty: Number(v.qty), disposition: v.disposition, note: v.note, work_order_id: Number(v.work_order_id) || undefined })
          .then((r) => {
            toast('success', r.message);
            onDone();
          })
          .catch((e: unknown) => toast('error', errorText(e)))
          .finally(() => setBusy(false));
      }}
    />
  );
}

/** Labour on the job (FR-TEC-02/05): every entry kept; a correction voids and keeps the original. */
function LabourList({ d, canCorrect, onChange }: { d: WorkView; canCorrect: boolean; onChange: () => void }) {
  const [editing, setEditing] = useState<LabourEntry | 'new' | null>(null);
  const code = (id: number) => d.work_orders.find((w) => w.id === id)?.code ?? '';
  const labour = d.labour ?? [];
  return (
    <Section
      title="Labour"
      action={
        canCorrect && d.work_orders.length > 0 ? (
          <Button size="sm" variant="ghost" onClick={() => setEditing('new')}>
            Add by hand
          </Button>
        ) : null
      }
    >
      {labour.length === 0 ? (
        <p className="m-0 text-[13px] text-ink-3">No labour recorded yet.</p>
      ) : (
        <table className="w-full text-left text-[13px]">
          <tbody>
            {labour.map((e) => (
              <tr key={e.id} className={cx('border-b border-line/70 last:border-b-0', e.voided && 'text-ink-3 line-through')}>
                <td className="py-1.5 pr-2">{code(e.work_order_id)}</td>
                <td className="pr-2">{e.technician}</td>
                <td className="pr-2 text-[12px]">
                  {when(e.started_at)} → {e.running ? <span className="font-semibold text-success">running</span> : when(e.ended_at)}
                </td>
                <td className="pr-2 text-right tabular-nums">{e.running ? '' : span(e.minutes)}</td>
                <td className="pr-2 text-[12px] text-ink-3">
                  {e.source === 'OFFLINE_SYNC' ? 'kept offline, sent later' : e.source === 'MANUAL' ? `by hand: ${e.reason ?? ''}` : ''}
                  {e.pause_reason ? ` ${PAUSE_LABEL[e.pause_reason] ?? nice(e.pause_reason)}` : ''}
                  {e.is_rework ? ' · rework, not billed' : ''}
                </td>
                <td className="text-right">
                  {canCorrect && !e.voided && !e.running ? (
                    <button type="button" className="text-[12px] font-semibold text-primary" onClick={() => setEditing(e)}>
                      Correct
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {editing ? (
        <LabourForm
          d={d}
          entry={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            onChange();
          }}
        />
      ) : null}
    </Section>
  );
}

function LabourForm({ d, entry, onClose, onDone }: { d: WorkView; entry: LabourEntry | null; onClose: () => void; onDone: () => void }) {
  const [wo, setWo] = useState(String(entry?.work_order_id ?? d.work_orders[0]?.id ?? ''));
  const [tech, setTech] = useState(String(entry?.technician_id ?? ''));
  const [start, setStart] = useState(toLocalInput(entry?.started_at));
  const [end, setEnd] = useState(toLocalInput(entry?.ended_at));
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async (strike = false) => {
    setBusy(true);
    try {
      const r = entry
        ? await gPost(`/labour/${entry.id}/correct`, strike ? { void: true, reason } : { started_at: fromLocalInput(start), ended_at: fromLocalInput(end), reason })
        : await gPost(`/work-orders/${wo}/labour`, { technician_id: Number(tech), started_at: fromLocalInput(start), ended_at: fromLocalInput(end), reason });
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
      title={entry ? `Correct ${entry.technician}'s labour` : 'Add labour by hand'}
      onClose={onClose}
      width={560}
      footer={
        <div className="flex w-full justify-between gap-2">
          {entry ? (
            <Button variant="ghost" className="text-danger" loading={busy} disabled={!reason.trim()} onClick={() => void save(true)}>
              Strike it out
            </Button>
          ) : (
            <span />
          )}
          <span className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" loading={busy} disabled={!reason.trim() || !start || !end || (!entry && !tech)} onClick={() => void save()}>
              Save
            </Button>
          </span>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="m-0 text-[12.5px] text-ink-3">The original is kept, voided; the reason goes in the audit log.</p>
        {!entry ? (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Work order">
              <Select aria-label="Work order" value={wo} onChange={(e) => setWo(e.target.value)} options={d.work_orders.map((w) => ({ value: String(w.id), label: `${w.code} · ${w.work_type}` }))} className={input} />
            </Field>
            <Field label="Technician">
              <Select aria-label="Technician" value={tech} onChange={(e) => setTech(e.target.value)} placeholder="Choose" options={(d.technicians ?? []).map((t) => ({ value: String(t.id), label: t.name }))} className={input} />
            </Field>
          </div>
        ) : null}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Started">
            <input type="datetime-local" className={input} aria-label="Started" value={start} onChange={(e) => setStart(e.target.value)} />
          </Field>
          <Field label="Ended">
            <input type="datetime-local" className={input} aria-label="Ended" value={end} onChange={(e) => setEnd(e.target.value)} />
          </Field>
        </div>
        <Field label="Why *">
          <input className={input} aria-label="Why" value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { dateLabel, timeLabel } from '../../../core/time';
import { toast } from '../../../core/toasts';
import { Icon } from '../../../components/Icon';
import { Select } from '../../../components/Select';
import { ErrorNote, Modal, Spinner, cx } from '../../../components/ui';
import { btn, btnPrimary, btnSmall, Field, input, Panel } from '../../hr/parts';
import { localToIso, OFFLINE_WRITE, refusalOf } from '../api';
import { raiseAdditional } from '../api-b1';
import {
  assignWorkOrder,
  cancelWorkOrder,
  clock,
  completeWorkOrder,
  correctLabour,
  createWorkOrders,
  fetchBays,
  fetchLabour,
  fetchTechnicians,
  fetchWorkOrders,
  KB2,
  minutesLabel,
  PAUSE_REASONS,
  timer,
  workedSeconds,
  workOrderNote,
  type LabourEntry,
  type WorkOrder,
} from '../api-b2';
import { Pill } from '../parts';
import type { JobTabProps } from '../registry';

/**
 * Work orders (SRS §16, §28.3, FR-WO-01..03, FR-TEC-01..05, WF-11/12), stage
 * B2: made from the work the customer approved (C4) — or internal work, which
 * is never billed; technicians and a bay given to each; the labour timer, the
 * caller's own, on the server's clock (C6); completing; and the labour kept
 * from the timer, corrected only by adding a new entry with a reason. The job
 * follows its work orders on the server (first timer: work started; last one
 * done: quality check).
 */
const WO_TONE = (s: string): 'blue' | 'amber' | 'green' | 'grey' | 'violet' | 'red' =>
  s === 'completed' ? 'green' : s === 'cancelled' ? 'grey' : s === 'in_progress' ? 'blue' : s === 'qc_failed' ? 'red' : s === 'rework' ? 'violet' : 'amber';
const stamp = (s: string | null | undefined) => (s ? `${dateLabel(s)} ${timeLabel(s)}` : '—');
const WORKABLE = ['approved', 'waiting_parts', 'ready_to_start', 'in_progress', 'paused', 'additional_approval_required'];

/** Now, every second while something runs — for the timers' clocks. */
function useNow(on: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    const h = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(h);
  }, [on]);
  return now;
}

export default function WorkOrders({ job, company, online, onChanged }: JobTabProps) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: KB2.workOrders(job.id), queryFn: ({ signal }) => fetchWorkOrders(job.id, signal), refetchInterval: 30_000 });
  const labour = useQuery({ queryKey: KB2.labour(job.id), queryFn: ({ signal }) => fetchLabour(job.id, signal) });
  const [busy, setBusy] = useState<string | null>(null);
  const [ask, setAsk] = useState<null | { kind: 'pause' | 'cancel' | 'note' | 'assign' | 'extra'; wo: WorkOrder } | { kind: 'internal' } | { kind: 'correct'; entry: LabourEntry }>(null);
  const running = (q.data?.items ?? []).some((w) => w.running > 0);
  const now = useNow(running);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: KB2.workOrders(job.id) });
    void qc.invalidateQueries({ queryKey: KB2.labour(job.id) });
    onChanged();
  };
  const act = async (key: string, fn: () => Promise<{ message?: string | null; data: unknown }>, done: string) => {
    if (!online) {
      toast('error', OFFLINE_WRITE);
      return false;
    }
    setBusy(key);
    try {
      const r = await fn();
      const d = (r.data ?? {}) as { warnings?: string[]; already?: boolean };
      toast('success', r.message || done);
      for (const w of d.warnings ?? []) toast('warning', w);
      refresh();
      return true;
    } catch (e) {
      toast('error', refusalOf(e).message);
      return false;
    } finally {
      setBusy(null);
    }
  };

  if (q.isLoading) return <Spinner />;
  if (q.error || !q.data) return <ErrorNote error={q.error} onRetry={() => void q.refetch()} />;
  const tab = q.data;
  const workable = WORKABLE.includes(job.status);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
        <span className="flex-1 text-ink-2">{tab.lines_waiting ? `${tab.lines_waiting} approved ${tab.lines_waiting === 1 ? 'line is' : 'lines are'} in no work order yet.` : tab.items.length ? 'Every approved line is in a work order.' : 'Work orders are made from the work the customer approved.'}</span>
        {tab.can.create && workable && tab.lines_waiting ? (
          <button type="button" className={btnPrimary} disabled={!online || !!busy} onClick={() => void act('make', () => createWorkOrders(job.id, {}), 'Work orders made.')}>
            <Icon name="plus" size={15} /> Make work orders
          </button>
        ) : null}
        {tab.can.assign && workable ? (
          <button type="button" className={btnSmall} disabled={!online} onClick={() => setAsk({ kind: 'internal' })}>
            Internal work
          </button>
        ) : null}
      </div>
      {tab.items.map((wo) => (
        <section key={wo.id} aria-label={wo.code} className="flex flex-col gap-2 rounded-[12px] border border-line bg-surface px-4 py-3 text-[12.5px]">
          <div className="flex flex-wrap items-center gap-2">
            <b className="text-[13.5px] text-ink">{wo.code}</b>
            <span className="min-w-0 flex-1 truncate font-semibold text-ink">{wo.work_type}</span>
            {wo.internal ? <Pill tone="grey">Internal</Pill> : null}
            <Pill tone={WO_TONE(wo.status)}>{wo.status_label}</Pill>
            {wo.pause_reason ? <Pill tone="amber">{wo.pause_reason_label ?? PAUSE_REASONS[wo.pause_reason] ?? wo.pause_reason}</Pill> : null}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-ink-2">
            <span>Bay: {wo.bay ? `${wo.bay.code} (${wo.bay.status_label})` : '—'}</span>
            <span>Skill: {wo.required_skill_name ?? wo.required_skill ?? '—'}</span>
            <span>
              Time: {minutesLabel(wo.actual_minutes)} of {minutesLabel(wo.estimated_minutes)}
            </span>
            {wo.bookings.filter((b) => b.status === 'reserved' || b.status === 'active').map((b) => (
              <span key={b.id}>
                Booked {stamp(b.starts_at)}–{timeLabel(b.ends_at)}
              </span>
            ))}
          </div>
          {wo.technicians.length ? (
            <ul className="m-0 flex flex-col gap-0.5 p-0">
              {wo.technicians.map((t) => (
                <li key={t.id} className="flex list-none items-center gap-2">
                  <b className="text-ink">{t.name ?? `#${t.id}`}</b>
                  <span className="text-ink-3">{t.role_label}</span>
                  {!t.has_skill && wo.required_skill ? <Pill tone="amber">Lacks the skill</Pill> : null}
                  <span className="flex-1" />
                  {t.timer && t.timer.state !== 'not_started' ? <span className={cx('font-mono tabular-nums', t.timer.state === 'running' ? 'font-bold text-primary' : 'text-ink-3')}>{clock(workedSeconds(t.timer, now))}</span> : null}
                  <span className="text-ink-3">{t.timer?.state === 'running' ? 'working' : t.timer?.state === 'paused' ? 'paused' : ''}</span>
                </li>
              ))}
            </ul>
          ) : (
            <span className="text-ink-3">Nobody on it yet.</span>
          )}
          {wo.lines.length ? <span className="text-ink-3">Work: {wo.lines.map((l) => l.description).join('; ')}</span> : null}
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            {wo.my_timer?.state === 'running' ? (
              <>
                <span className="mr-1 font-mono text-[15px] font-bold text-primary tabular-nums" aria-label="My timer">
                  {clock(workedSeconds(wo.my_timer, now))}
                </span>
                {wo.can.pause ? (
                  <button type="button" className={btnSmall} disabled={!online || !!busy} onClick={() => setAsk({ kind: 'pause', wo })}>
                    <Icon name="pause" size={13} /> Pause
                  </button>
                ) : null}
              </>
            ) : wo.can.start ? (
              <button type="button" className={btnPrimary} disabled={!online || !!busy} onClick={() => void act(`start:${wo.id}`, () => timer(wo.id, wo.my_timer?.state === 'paused' ? 'resume' : 'start'), 'Timer running.')}>
                <Icon name="play" size={14} /> {wo.my_timer?.state === 'paused' ? 'Resume' : 'Start'}
              </button>
            ) : null}
            {wo.can.complete ? (
              <button type="button" className={btnSmall} disabled={!online || !!busy} onClick={() => void act(`done:${wo.id}`, () => completeWorkOrder(wo.id), `${wo.code} completed.`)}>
                <Icon name="check" size={13} /> Complete
              </button>
            ) : null}
            {wo.can.assign ? (
              <button type="button" className={btnSmall} disabled={!online} onClick={() => setAsk({ kind: 'assign', wo })}>
                <Icon name="users" size={13} /> Technicians and bay
              </button>
            ) : null}
            {wo.my_role || company?.can.edit ? (
              <button type="button" className={btnSmall} disabled={!online} onClick={() => setAsk({ kind: 'note', wo })}>
                Note
              </button>
            ) : null}
            {(wo.my_role || tab.can.assign) && ['in_progress', 'paused', 'additional_approval_required', 'approved', 'ready_to_start', 'waiting_parts'].includes(job.status) && !wo.internal ? (
              <button type="button" className={btnSmall} disabled={!online} onClick={() => setAsk({ kind: 'extra', wo })}>
                Found more work…
              </button>
            ) : null}
            {wo.can.cancel ? (
              <button type="button" className={btnSmall} disabled={!online} onClick={() => setAsk({ kind: 'cancel', wo })}>
                Cancel
              </button>
            ) : null}
          </div>
        </section>
      ))}

      {labour.data ? (
        <Panel title="Labour" sub={`${minutesLabel(labour.data.minutes)} worked · ${minutesLabel(labour.data.billable_minutes)} billable${labour.data.rework_minutes ? ` · ${minutesLabel(labour.data.rework_minutes)} rework` : ''}`}>
          {labour.data.by_technician.length ? (
            <div className="flex flex-wrap gap-x-4 border-b border-line px-3.5 py-2 text-[12.5px] text-ink-2">
              {labour.data.by_technician.map((t) => (
                <span key={t.id}>
                  <b className="text-ink">{t.name}</b> {minutesLabel(t.minutes)}
                </span>
              ))}
            </div>
          ) : null}
          {labour.data.items.map((e) => (
            <div key={e.id} className={cx('flex items-center gap-2.5 border-b border-line/70 px-3.5 py-1.5 text-[12.5px] last:border-b-0', e.superseded && 'text-ink-3 line-through')}>
              <span className="w-[120px] shrink-0 truncate font-semibold">{e.technician?.name ?? '—'}</span>
              <span className="w-[60px] shrink-0">{e.work_order?.code ?? ''}</span>
              <span className="min-w-0 flex-1 truncate">
                {stamp(e.started_at)} – {e.running ? 'now' : e.ended_at ? timeLabel(e.ended_at) : '—'}
                {e.pause_reason ? ` · ${PAUSE_REASONS[e.pause_reason] ?? e.pause_reason}` : ''}
                {e.correction_reason ? ` · ${e.correction_reason}` : ''}
              </span>
              <span className="w-[70px] shrink-0 text-right tabular-nums">{minutesLabel(e.minutes)}</span>
              <span className="w-[90px] shrink-0 text-right text-ink-3">{[e.source !== 'timer' ? (e.source === 'manual' ? 'by hand' : 'offline') : null, e.is_rework ? 'rework' : null, !e.is_billable ? 'not billed' : null].filter(Boolean).join(', ')}</span>
              {labour.data.can_correct && !e.superseded && !e.running ? (
                <button type="button" className={btnSmall} disabled={!online} onClick={() => setAsk({ kind: 'correct', entry: e })}>
                  Correct
                </button>
              ) : (
                <span className="w-[62px]" />
              )}
            </div>
          ))}
          {!labour.data.items.length ? <div className="px-3.5 py-4 text-[12.5px] text-ink-3">No labour yet: it comes from the timers.</div> : null}
        </Panel>
      ) : null}

      {ask?.kind === 'pause' ? (
        <ReasonSheet title={`Pause ${ask.wo.code}`} reasons={PAUSE_REASONS} onClose={() => setAsk(null)} onSave={(reason) => void act(`pause:${ask.wo.id}`, () => timer(ask.wo.id, 'pause', { reason }), 'Paused.').then((ok) => ok && setAsk(null))} />
      ) : null}
      {ask?.kind === 'cancel' ? <TextSheet title={`Cancel ${ask.wo.code}`} label="Why" onClose={() => setAsk(null)} onSave={(t) => void act(`cancel:${ask.wo.id}`, () => cancelWorkOrder(ask.wo.id, t), `${ask.wo.code} cancelled.`).then((ok) => ok && setAsk(null))} /> : null}
      {ask?.kind === 'note' ? <TextSheet title={`A note on ${ask.wo.code}`} label="Note" long onClose={() => setAsk(null)} onSave={(t) => void act(`note:${ask.wo.id}`, () => workOrderNote(ask.wo.id, { body: t, visibility: 'internal' }), 'Note added.').then((ok) => ok && setAsk(null))} /> : null}
      {ask?.kind === 'internal' ? (
        <TextSheet title="Internal work" label="What is to be done (never billed)" onClose={() => setAsk(null)} onSave={(t) => void act('internal', () => createWorkOrders(job.id, { internal: true, work_type: t }), 'Internal work order made.').then((ok) => ok && setAsk(null))} />
      ) : null}
      {ask?.kind === 'assign' ? <AssignSheet wo={ask.wo} orgId={job.org_id} branchId={job.branch_id} onClose={() => setAsk(null)} onSave={(body) => void act(`assign:${ask.wo.id}`, () => assignWorkOrder(ask.wo.id, body, ask.wo.version), 'Assigned.').then((ok) => ok && setAsk(null))} /> : null}
      {ask?.kind === 'extra' ? (
        <ExtraSheet
          wo={ask.wo}
          onClose={() => setAsk(null)}
          onSave={(body) => void act(`extra:${ask.wo.id}`, () => raiseAdditional(job.id, { work_order_id: ask.wo.id, ...body }), 'Sent to the advisor to price and ask the customer.').then((ok) => ok && setAsk(null))}
        />
      ) : null}
      {ask?.kind === 'correct' ? <CorrectSheet entry={ask.entry} onClose={() => setAsk(null)} onSave={(body) => void act(`correct:${ask.entry.id}`, () => correctLabour(ask.entry.id, body), 'Corrected; the original is kept.').then((ok) => ok && setAsk(null))} /> : null}
    </div>
  );
}

function ReasonSheet({ title, reasons, onClose, onSave }: { title: string; reasons: Record<string, string>; onClose: () => void; onSave: (reason: string) => void }) {
  const [reason, setReason] = useState('');
  return (
    <Modal
      title={title}
      width={420}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} disabled={!reason} onClick={() => onSave(reason)}>
            Pause
          </button>
        </>
      }
    >
      <div role="radiogroup" aria-label="Why" className="flex flex-col gap-1">
        {Object.entries(reasons).map(([k, label]) => (
          <button key={k} type="button" role="radio" aria-checked={reason === k} onClick={() => setReason(k)} className={cx('h-9 rounded-[8px] px-3 text-left text-[13px] font-semibold', reason === k ? 'bg-primary text-white' : 'border border-line bg-surface text-ink')}>
            {label}
          </button>
        ))}
      </div>
    </Modal>
  );
}

function TextSheet({ title, label, long, onClose, onSave }: { title: string; label: string; long?: boolean; onClose: () => void; onSave: (text: string) => void }) {
  const [t, setT] = useState('');
  return (
    <Modal
      title={title}
      width={460}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} disabled={!t.trim()} onClick={() => onSave(t.trim())}>
            Save
          </button>
        </>
      }
    >
      <Field label={label}>{long ? <textarea autoFocus aria-label={label} value={t} onChange={(e) => setT(e.target.value)} rows={3} className={cx(input, 'h-auto py-2')} maxLength={2000} /> : <input autoFocus aria-label={label} value={t} onChange={(e) => setT(e.target.value)} className={input} maxLength={200} />}</Field>
    </Modal>
  );
}

/** The body of `POST work-orders/{id}/assign`: the technicians (the first chosen is the lead unless one is marked), the bay, and a slot when one is given. */
export function assignBody(picked: Array<{ id: number; role: string }>, bay: string, start: string, minutes: string): { technicians: Array<{ id: number; role: string }>; service_bay_id: number | null; starts_at?: string; minutes?: number } {
  const lead = picked.some((p) => p.role === 'lead');
  const technicians = picked.map((p, i) => ({ id: p.id, role: lead ? p.role : i === 0 ? 'lead' : p.role === 'lead' ? 'assistant' : p.role }));
  const at = start ? localToIso(start) : null;
  return { technicians, service_bay_id: bay ? Number(bay) : null, ...(at && bay ? { starts_at: at, minutes: Number(minutes) || 60 } : {}) };
}

function AssignSheet({ wo, orgId, branchId, onClose, onSave }: { wo: WorkOrder; orgId: number; branchId: number | null; onClose: () => void; onSave: (body: ReturnType<typeof assignBody>) => void }) {
  const techs = useQuery({ queryKey: KB2.technicians(orgId, wo.id), queryFn: ({ signal }) => fetchTechnicians(orgId, wo.id, branchId, signal) });
  const bays = useQuery({ queryKey: KB2.bays(String(orgId), branchId ? String(branchId) : ''), queryFn: ({ signal }) => fetchBays(String(orgId), branchId ? String(branchId) : '', signal) });
  const [picked, setPicked] = useState<Array<{ id: number; role: string }>>(() => wo.technicians.map((t) => ({ id: t.id, role: t.role })));
  const [bay, setBay] = useState(wo.bay ? String(wo.bay.id) : '');
  const [start, setStart] = useState('');
  const [minutes, setMinutes] = useState(String(wo.estimated_minutes ?? 60));
  const toggle = (id: number) => setPicked((p) => (p.some((x) => x.id === id) ? p.filter((x) => x.id !== id) : [...p, { id, role: p.length ? 'assistant' : 'lead' }]));
  return (
    <Modal
      title={`${wo.code}: technicians and bay`}
      width={620}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} onClick={() => onSave(assignBody(picked, bay, start, minutes))}>
            Save
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-2.5 text-[12.5px]">
        <b className="text-ink">Technicians {wo.required_skill_name ? <span className="font-normal text-ink-3">· needs {wo.required_skill_name}</span> : null}</b>
        {techs.isLoading ? <Spinner /> : techs.error ? <ErrorNote error={techs.error} /> : null}
        {(techs.data?.items ?? []).map((t) => {
          const on = picked.find((p) => p.id === t.id);
          return (
            <div key={t.id} className="flex items-center gap-2">
              <label className="flex min-w-0 flex-1 items-center gap-2">
                <input type="checkbox" checked={!!on} onChange={() => toggle(t.id)} />
                <b className="text-ink">{t.name}</b>
                <span className="truncate text-ink-3">
                  {t.skills.map((s) => s.name).join(', ')} · {t.open_work_orders} open · {minutesLabel(t.booked_minutes_today)} booked today
                </span>
                {t.has_skill === false ? <Pill tone="amber">Lacks the skill</Pill> : null}
                {t.running ? <Pill tone="blue">Working now</Pill> : null}
              </label>
              {on ? <Select aria-label={`${t.name} role`} value={on.role} onValueChange={(r) => setPicked((p) => p.map((x) => (x.id === t.id ? { ...x, role: r } : r === 'lead' && x.role === 'lead' ? { ...x, role: 'assistant' } : x)))} options={[{ value: 'lead', label: 'Lead' }, { value: 'assistant', label: 'Assistant' }, { value: 'specialist', label: 'Specialist' }]} /> : null}
            </div>
          );
        })}
        <div className="grid grid-cols-3 gap-2">
          <Field label="Bay">
            <Select aria-label="Bay" value={bay} onValueChange={setBay} options={[{ value: '', label: 'No bay' }, ...(bays.data?.items ?? []).filter((b) => b.active).map((b) => ({ value: String(b.id), label: `${b.code} · ${b.status_label}` }))]} />
          </Field>
          <Field label="Book from" hint="Optional; your clock">
            <input aria-label="Book from" type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} className={input} disabled={!bay} />
          </Field>
          <Field label="Minutes">
            <input aria-label="Minutes" inputMode="numeric" value={minutes} onChange={(e) => setMinutes(e.target.value.replace(/[^\d]/g, ''))} className={input} disabled={!bay || !start} />
          </Field>
        </div>
      </div>
    </Modal>
  );
}

function ExtraSheet({ wo, onClose, onSave }: { wo: WorkOrder; onClose: () => void; onSave: (body: { finding: string; lines: Array<Record<string, unknown>> }) => void }) {
  const [finding, setFinding] = useState('');
  const [what, setWhat] = useState('');
  const [hours, setHours] = useState('');
  const [safety, setSafety] = useState(false);
  return (
    <Modal
      title={`Found more work on ${wo.code}`}
      width={520}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} disabled={!finding.trim()} onClick={() => onSave({ finding: finding.trim(), lines: what.trim() && hours ? [{ line_type: 'labour', description: what.trim(), labour_hours: hours, safety }] : [] })}>
            Send to the advisor
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-2.5">
        <Field label="What you found">
          <textarea autoFocus aria-label="What you found" value={finding} onChange={(e) => setFinding(e.target.value)} rows={3} className={cx(input, 'h-auto py-2')} maxLength={2000} />
        </Field>
        <div className="grid grid-cols-[1fr_110px] gap-2">
          <Field label="The work it needs (optional)">
            <input aria-label="The work it needs" value={what} onChange={(e) => setWhat(e.target.value)} className={input} maxLength={500} />
          </Field>
          <Field label="Hours">
            <input aria-label="Hours" inputMode="decimal" value={hours} onChange={(e) => setHours(e.target.value.replace(/[^\d.]/g, ''))} className={input} />
          </Field>
        </div>
        <label className="flex items-center gap-1.5 text-[12.5px] font-semibold">
          <input type="checkbox" checked={safety} onChange={(e) => setSafety(e.target.checked)} /> A safety matter
        </label>
        <p className="m-0 text-[12px] text-ink-3">The advisor prices it and asks the customer. Nothing extra is done until they agree; the rest of the approved work carries on.</p>
      </div>
    </Modal>
  );
}

function CorrectSheet({ entry, onClose, onSave }: { entry: LabourEntry; onClose: () => void; onSave: (body: Record<string, unknown>) => void }) {
  const [minutes, setMinutes] = useState(String(entry.minutes));
  const [billable, setBillable] = useState(entry.is_billable);
  const [voided, setVoided] = useState(false);
  const [reason, setReason] = useState('');
  return (
    <Modal
      title={`Correct ${entry.technician?.name ?? 'the entry'}’s labour`}
      width={460}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} disabled={!reason.trim()} onClick={() => onSave(voided ? { void: true, reason: reason.trim() } : { minutes: Number(minutes) || 0, is_billable: billable, reason: reason.trim() })}>
            Correct
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-2.5 text-[12.5px]">
        <span className="text-ink-2">
          {stamp(entry.started_at)} – {entry.ended_at ? timeLabel(entry.ended_at) : '—'}, {minutesLabel(entry.minutes)}. The original stays on record.
        </span>
        <label className="flex items-center gap-1.5 font-semibold">
          <input type="checkbox" checked={voided} onChange={(e) => setVoided(e.target.checked)} /> It should not count at all
        </label>
        {!voided ? (
          <div className="grid grid-cols-2 gap-2">
            <Field label="Minutes">
              <input aria-label="Minutes" inputMode="numeric" value={minutes} onChange={(e) => setMinutes(e.target.value.replace(/[^\d]/g, ''))} className={input} />
            </Field>
            <label className="flex items-end gap-1.5 pb-2 font-semibold">
              <input type="checkbox" checked={billable} onChange={(e) => setBillable(e.target.checked)} /> Billable
            </label>
          </div>
        ) : null}
        <Field label="Why">
          <input aria-label="Why" value={reason} onChange={(e) => setReason(e.target.value)} className={input} maxLength={255} />
        </Field>
      </div>
    </Modal>
  );
}

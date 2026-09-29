import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { dateLabel, timeLabel } from '../../../core/time';
import { toast } from '../../../core/toasts';
import { Icon } from '../../../components/Icon';
import { Select } from '../../../components/Select';
import { ErrorNote, Modal, Spinner, cx } from '../../../components/ui';
import { btn, btnPrimary, btnSmall, Field, input, Panel } from '../../hr/parts';
import { OFFLINE_WRITE, refusalOf } from '../api';
import type { WorkOrdersTab } from '../api-b2';
import { answerQc, decideQc, fetchQc, KB3, reworkOrders, selfQcBlocked, startQc, type QcItem } from '../api-b3';
import { minutesLabel } from '../api-b2';
import { Pill } from '../parts';
import type { JobTabProps } from '../registry';

/**
 * The quality check (SRS §18, §28.10, FR-QC-01..06, SM-07, WF-16), stage B3:
 * opened by the server when the last work order completes, from the
 * company's QC checklist. Pass or fail each item (and name the work order a
 * failure is about); the inspector who may approve then passes it — every
 * required item checked and passed — or fails it with a reason, which sends
 * the named work orders back to rework (never billed unless the company says
 * so). Whoever worked on the job may not check it, unless the company allows.
 */
const stamp = (s: string | null | undefined) => (s ? `${dateLabel(s)} ${timeLabel(s)}` : '');

export default function Quality({ job, online, onChanged }: JobTabProps) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: KB3.qc(job.id), queryFn: ({ signal }) => fetchQc(job.id, signal) });
  const [busy, setBusy] = useState<string | null>(null);
  const [failing, setFailing] = useState(false);
  const workOrders = ((job.work_orders as WorkOrdersTab | null | undefined)?.items ?? []).filter((w) => !w.internal);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: KB3.qc(job.id) });
    onChanged();
  };
  const act = async (key: string, fn: () => Promise<{ message?: string | null }>, done: string, quiet = false) => {
    if (!online) {
      toast('error', OFFLINE_WRITE);
      return false;
    }
    setBusy(key);
    try {
      const r = await fn();
      if (!quiet) toast('success', r.message || done);
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
  const tab = q.data.qc;
  const cur = tab.current;
  const blocked = selfQcBlocked(tab);
  const mayCheck = tab.can.check && !blocked && online;
  const open = cur ? cur.items.filter((i) => i.mandatory && !i.result).length : 0;
  const failedMandatory = cur ? cur.items.some((i) => i.mandatory && i.result === 'fail') : false;

  return (
    <div className="flex flex-col gap-3">
      {blocked ? <p className="m-0 rounded-[9px] bg-warning-bg px-3 py-2 text-[12.5px] font-semibold text-warning">You worked on this job: somebody else must check it.</p> : null}
      {!cur ? (
        <p className="m-0 text-[12.5px] text-ink-3">{job.status === 'quality_check' ? 'The check opens as soon as somebody starts it.' : 'The quality check opens when the last work order is completed.'}</p>
      ) : (
        <section aria-label={`Attempt ${cur.attempt}`} className="flex flex-col gap-2 rounded-[12px] border border-line bg-surface">
          <div className="flex flex-wrap items-center gap-2 px-4 pt-3 text-[12.5px]">
            <b className="text-[14px] text-ink">Attempt {cur.attempt}</b>
            <Pill tone={cur.status === 'passed' ? 'green' : cur.status === 'failed' || cur.status === 'rework_required' ? 'red' : 'blue'}>{cur.status_label}</Pill>
            <span className="text-ink-3">{[cur.inspector?.name, cur.started_at ? `started ${stamp(cur.started_at)}` : null].filter(Boolean).join(' · ')}</span>
            <span className="flex-1" />
            {cur.status === 'pending' && mayCheck ? (
              <button type="button" className={btnSmall} disabled={!!busy} onClick={() => void act('start', () => startQc(job.id), 'Check started.')}>
                Start the check
              </button>
            ) : null}
          </div>
          {cur.items.map((i) => (
            <QcRow key={i.id} item={i} workOrders={workOrders} locked={!mayCheck || !['pending', 'in_progress'].includes(cur.status)} onAnswer={(patch) => void act(`i:${i.id}`, () => answerQc(cur.id, [{ id: i.id, ...patch }]), 'Saved.', true)} />
          ))}
          {tab.can.decide && !blocked && ['pending', 'in_progress'].includes(cur.status) ? (
            <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-2.5">
              <span className="flex-1 text-[12.5px] text-ink-2">{open ? `${open} required ${open === 1 ? 'item' : 'items'} not yet checked.` : failedMandatory ? 'A required item failed.' : 'Every required item passed.'}</span>
              <button type="button" className={btn} disabled={!online || !failedMandatory || !!busy} onClick={() => setFailing(true)}>
                Fail — send back to rework
              </button>
              <button type="button" className={btnPrimary} disabled={!online || !!open || failedMandatory || !!busy} onClick={() => void act('pass', () => decideQc(cur.id, { result: 'passed' }), 'Quality check passed.')}>
                <Icon name="check" size={15} /> Pass the check
              </button>
            </div>
          ) : null}
        </section>
      )}
      {tab.rework.length ? (
        <Panel title="Rework" sub="Never billed unless the company says so">
          {tab.rework.map((r) => (
            <div key={r.id} className="flex items-center gap-2 border-b border-line/70 px-3.5 py-1.5 text-[12.5px] last:border-b-0">
              <b className="w-[60px] shrink-0 text-ink">{r.work_order?.code ?? ''}</b>
              <span className="min-w-0 flex-1 truncate text-ink-2">
                Attempt {r.attempt}: {r.reason}
              </span>
              <span className="text-ink-3">{[r.technician?.name, minutesLabel(r.minutes)].filter(Boolean).join(' · ')}</span>
              <Pill tone={r.status === 'done' ? 'green' : 'amber'}>{r.status === 'done' ? 'Done' : 'Open'}</Pill>
            </div>
          ))}
        </Panel>
      ) : null}
      {tab.attempts.length > 1 ? (
        <Panel title="Earlier attempts">
          {tab.attempts
            .filter((a) => a.id !== cur?.id)
            .map((a) => (
              <div key={a.id} className="flex items-center gap-2 border-b border-line/70 px-3.5 py-1.5 text-[12.5px] last:border-b-0">
                <b className="text-ink">Attempt {a.attempt}</b>
                <span className="min-w-0 flex-1 truncate text-ink-2">{[a.status_label, a.reason, a.inspector?.name].filter(Boolean).join(' · ')}</span>
                <span className="text-ink-3">{stamp(a.completed_at)}</span>
              </div>
            ))}
        </Panel>
      ) : null}
      {failing && cur ? (
        <FailSheet
          workOrders={workOrders}
          preselected={reworkOrders(cur, [])}
          onClose={() => setFailing(false)}
          onSave={(reason, ids) => void act('fail', () => decideQc(cur.id, { result: 'failed', reason, work_orders: ids }), 'Sent back to rework.').then((ok) => ok && setFailing(false))}
        />
      ) : null}
    </div>
  );
}

function QcRow({ item, workOrders, locked, onAnswer }: { item: QcItem; workOrders: Array<{ id: number; code: string; work_type: string }>; locked: boolean; onAnswer: (patch: { result?: 'pass' | 'fail' | null; note?: string; work_order_id?: number | null }) => void }) {
  const [note, setNote] = useState(item.note ?? '');
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-line/70 px-4 py-2 text-[12.5px]">
      <b className="min-w-[200px] flex-1 text-ink">
        {item.label}
        {item.mandatory ? <span className="text-danger"> *</span> : null}
      </b>
      <div role="radiogroup" aria-label={`${item.label} result`} className="flex gap-1">
        {(['pass', 'fail'] as const).map((r) => (
          <button key={r} type="button" role="radio" aria-checked={item.result === r} disabled={locked} onClick={() => onAnswer({ result: r })} className={cx('h-7 rounded-[7px] px-2.5 text-[12px] font-bold disabled:opacity-60', item.result === r ? (r === 'pass' ? 'bg-[#1F7A4D] text-white' : 'bg-danger text-white') : 'border border-line bg-surface text-ink-2')}>
            {r === 'pass' ? 'Pass' : 'Fail'}
          </button>
        ))}
      </div>
      {item.result === 'fail' && workOrders.length ? (
        <Select aria-label={`${item.label} work order`} disabled={locked} value={item.work_order_id ? String(item.work_order_id) : ''} onValueChange={(v) => onAnswer({ work_order_id: v ? Number(v) : null })} options={[{ value: '', label: 'Which work order?' }, ...workOrders.map((w) => ({ value: String(w.id), label: `${w.code} · ${w.work_type}` }))]} />
      ) : null}
      <input aria-label={`${item.label} note`} placeholder="Note" disabled={locked} value={note} onChange={(e) => setNote(e.target.value)} onBlur={() => note !== (item.note ?? '') && onAnswer({ note })} className={cx(input, 'h-8 w-[200px]')} maxLength={500} />
    </div>
  );
}

function FailSheet({ workOrders, preselected, onClose, onSave }: { workOrders: Array<{ id: number; code: string; work_type: string }>; preselected: number[]; onClose: () => void; onSave: (reason: string, workOrders: number[]) => void }) {
  const [reason, setReason] = useState('');
  const [ids, setIds] = useState<number[]>(preselected);
  return (
    <Modal
      title="Fail the check"
      width={500}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} disabled={!reason.trim() || !ids.length} onClick={() => onSave(reason.trim(), ids)}>
            Send back to rework
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-2.5 text-[12.5px]">
        <Field label="Why">
          <input autoFocus aria-label="Why" value={reason} onChange={(e) => setReason(e.target.value)} className={input} maxLength={500} />
        </Field>
        <b className="text-ink">Work orders to redo</b>
        {workOrders.map((w) => (
          <label key={w.id} className="flex items-center gap-2">
            <input type="checkbox" checked={ids.includes(w.id)} onChange={(e) => setIds((x) => (e.target.checked ? [...x, w.id] : x.filter((y) => y !== w.id)))} /> {w.code} · {w.work_type}
          </label>
        ))}
        {!workOrders.length ? <span className="text-ink-3">No work order to send back.</span> : null}
      </div>
    </Modal>
  );
}

import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { errorMessage } from '../../core/bridge';
import { relative } from '../../core/time';
import { toast } from '../../core/toasts';
import { Select } from '../../components/Select';
import { btn, btnPrimary, btnSmall, Empty, Field, input, Sheet } from '../../components/PageKit';
import { Pill } from '../../components/ListKit';
import { K, useOwners, type Workspace } from './api';
import { addApproval, decideApproval } from './work';

/**
 * The sign-off chain a bid needs before it is submitted: Finance, Legal, a
 * director. The pipeline will not move a tender to Submitted while a step is
 * pending or was rejected (that can be overridden, and the override is kept).
 * Deciding a step needs the approval permission; a rejection needs a reason,
 * because it sends the bid back to whoever prepared it. A named approver is
 * told when the bid reaches Management approval.
 */
export default function Approvals({ id, org, rows, canManage, canApprove }: { id: number; org: string; rows: Workspace['approvals']; canManage: boolean; canApprove: boolean }) {
  const qc = useQueryClient();
  const owners = useOwners(org);
  const [label, setLabel] = useState('');
  const [approver, setApprover] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<Workspace['approvals'][number] | null>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: K.all });
  const run = async (key: string, fn: () => Promise<unknown>, done: string) => {
    setBusy(key);
    try {
      await fn();
      toast('success', done);
      refresh();
      return true;
    } catch (e) {
      toast('error', errorMessage(e));
      return false;
    } finally {
      setBusy(null);
    }
  };
  const next = rows.reduce((m, a) => Math.max(m, a.step), 0) + 1;
  const named = label.trim() !== '';

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-hidden rounded-[12px] border border-line bg-surface" aria-label="Approval chain">
        {rows.length ? (
          rows.map((a) => (
            <div key={a.id} data-approval={a.id} className="flex items-center gap-3 border-b border-line/60 px-3.5 py-2.5 text-[12.5px] last:border-b-0">
              <span className="w-6 shrink-0 text-center font-bold text-ink-3 tabular-nums">{a.step}</span>
              <span className="flex min-w-0 flex-1 flex-col">
                <b className="text-[13px] text-ink">{a.role_label ?? 'Approval'}</b>
                {a.comment ? <span className="text-[12px] text-ink-2">{a.comment}</span> : null}
                {a.decided_at ? <span className="text-[11.5px] text-ink-3">Decided {relative(a.decided_at)}</span> : null}
              </span>
              <Pill tone={a.status === 'approved' ? 'green' : a.status === 'rejected' ? 'red' : a.status === 'pending' ? 'amber' : 'grey'}>{a.status[0]!.toUpperCase() + a.status.slice(1)}</Pill>
              {canApprove && a.status === 'pending' ? (
                <span className="flex shrink-0 gap-1.5">
                  <button
                    type="button"
                    className={btnSmall + ' !h-7 !border-success-line !text-success-ink dark:!text-success'}
                    disabled={busy !== null}
                    onClick={() => void run(`a${a.id}`, () => decideApproval(a.id, 'approved'), `${a.role_label ?? 'The step'} approved.`)}
                  >
                    Approve
                  </button>
                  <button type="button" className={btnSmall + ' !h-7'} disabled={busy !== null} onClick={() => setRejecting(a)}>
                    Reject…
                  </button>
                  <button type="button" className={btnSmall + ' !h-7'} disabled={busy !== null} title="This step does not apply to this bid" onClick={() => void run(`s${a.id}`, () => decideApproval(a.id, 'skipped'), 'Skipped.')}>
                    Skip
                  </button>
                </span>
              ) : null}
            </div>
          ))
        ) : (
          <Empty text="No approval steps. A tender with no chain can be submitted without anybody signing it off." />
        )}
      </div>
      {canManage ? (
        <div className="flex flex-wrap items-end gap-2 rounded-[12px] border border-line bg-surface px-3.5 py-3">
          <Field label={`Step ${next}`} className="min-w-[200px] flex-1">
            <input aria-label="The step" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={80} placeholder="Finance, Legal, Director…" className={input} />
          </Field>
          <Field label="Who approves (optional)" className="w-[220px]">
            <Select<string>
              aria-label="Who approves"
              searchable
              value={approver}
              onValueChange={setApprover}
              options={[{ value: '', label: 'Anyone who may approve' }, ...(owners.data ?? []).filter((o) => o.holds).map((o) => ({ value: String(o.id), label: o.name }))]}
              className={input}
            />
          </Field>
          {/* Grey only while there is no name to add — the one thing it waits for, and said in its title. A decision
              in flight on a row above is not a reason to look switched off. */}
          <button
            type="button"
            className={btnPrimary}
            disabled={!named || busy === 'add'}
            title={named ? undefined : 'Name the step first'}
            onClick={() => void run('add', () => addApproval(id, { role_label: label.trim(), step: next, approver_id: approver ? Number(approver) : null }), 'Step added.').then((ok) => ok && (setLabel(''), setApprover('')))}
          >
            {busy === 'add' ? 'Adding…' : 'Add the step'}
          </button>
        </div>
      ) : null}
      {rejecting ? <RejectSheet step={rejecting} onClose={() => setRejecting(null)} onSaved={refresh} /> : null}
    </div>
  );
}

function RejectSheet({ step, onClose, onSaved }: { step: Workspace['approvals'][number]; onClose: () => void; onSaved: () => void }) {
  const [why, setWhy] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const go = async () => {
    setBusy(true);
    try {
      await decideApproval(step.id, 'rejected', why.trim());
      toast('success', 'Rejected, with the reason.');
      onSaved();
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      title={`Reject at ${step.role_label ?? 'this step'}`}
      width={460}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary + ' !bg-danger hover:!opacity-90'} disabled={busy || !why.trim()} onClick={() => void go()}>
            {busy ? 'Rejecting…' : 'Reject'}
          </button>
        </>
      }
    >
      <p className="m-0 text-[13px] text-ink-2">The bid cannot be submitted while a step is rejected, and everyone on it is told.</p>
      <Field label="Why?">
        <input aria-label="Why?" autoFocus value={why} onChange={(e) => setWhy(e.target.value)} maxLength={500} placeholder="The margin is below what we agreed for public work." className={input} />
      </Field>
      {error ? <p className="m-0 text-[12.5px] text-danger">{error}</p> : null}
    </Sheet>
  );
}

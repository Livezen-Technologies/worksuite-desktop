import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { apiGet, apiPost } from '../../core/api';
import { app } from '../../core/app-state';
import { errorMessage } from '../../core/bridge';
import { useStore } from '../../core/store';
import { relative } from '../../core/time';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { cx } from '../../components/ui';
import { btn, btnBad, btnGood, btnPrimary, Field, input, Panel, Sheet } from '../hr/parts';
import { crmCan, moneyFull, ListLine } from './parts';
import { nameOf, OFFLINE_HINT, rowsOf, useOnline, type PendingApproval } from './proposalLogic';
import { useCrmScope } from './scope';

/**
 * Approvals waiting for me (CRM SRS v1.3 §17, the shared approval engine):
 * the estimates and proposals a rule sent to me, each with Approve or Send
 * back and a note — a note is required to send one back, so the owner knows
 * what to change. Shown on the CRM dashboard and above the proposals list,
 * to whoever holds `crm.proposals.approve`.
 */

export type Decision = 'approve' | 'send_back';

/** The approver's decision, where the contract puts it: a proposal's `approve`/`send-back`, an estimate's `approval`. */
export function decideApproval(doc: 'estimate' | 'proposal', id: number, decision: Decision, note: string): Promise<unknown> {
  const n = note.trim();
  if (doc === 'proposal') return decision === 'approve' ? apiPost(`/api/crm/proposals/${id}/approve`, n ? { note: n } : {}) : apiPost(`/api/crm/proposals/${id}/send-back`, { note: n });
  return apiPost(`/api/crm/estimates/${id}/approval`, { decision, ...(n ? { note: n } : {}) });
}

export function useCanApprove(): boolean {
  const perms = useStore(app, (s) => s.bootstrap?.permissions);
  return crmCan(perms, 'crm.proposals.approve');
}

export function usePendingApprovals(enabled = true) {
  const scope = useCrmScope();
  return useQuery({
    queryKey: ['crm', 'approvals', 'pending', scope.orgId ?? 0],
    queryFn: async ({ signal }) => rowsOf<PendingApproval>(await apiGet<unknown>('/api/crm/approvals', { status: 'pending', ...scope.params }, signal), 'approvals'),
    enabled,
    refetchInterval: 120_000,
    retry: false,
  });
}

/** Approve, or send back with a note; the sheet the queue and a proposal's preview both use. */
export function DecideSheet({ doc, id, number, decision, onClose, onDone }: { doc: 'estimate' | 'proposal'; id: number; number: string; decision: Decision; onClose: () => void; onDone?: () => void }) {
  const qc = useQueryClient();
  const online = useOnline();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const back = decision === 'send_back';
  const ready = online && !busy && (!back || note.trim() !== '');
  const save = async () => {
    setBusy(true);
    try {
      await decideApproval(doc, id, decision, note);
      toast('success', back ? `${number} sent back.` : `${number} approved.`);
      void qc.invalidateQueries({ queryKey: ['crm'] });
      onDone?.();
      onClose();
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      title={back ? `Send ${number} back` : `Approve ${number}`}
      width={440}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={back ? cx(btnPrimary, 'bg-danger hover:bg-danger') : btnPrimary} disabled={!ready} title={online ? undefined : OFFLINE_HINT} onClick={() => void save()}>
            {back ? 'Send back' : 'Approve'}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="m-0 text-[13px] text-ink-2">{back ? 'The owner gets it back as a draft with your note, and sends it again once it is changed.' : `The owner can send this ${doc} to the customer once it is approved.`}</p>
        <Field label="Note" hint={back ? 'Required — what needs to change' : 'Optional — kept with the approval'}>
          <textarea autoFocus value={note} maxLength={1000} rows={3} onChange={(e) => setNote(e.target.value)} aria-label="Note" className={cx(input, 'h-auto py-2')} />
        </Field>
        {!online ? <p className="m-0 text-[12px] text-danger">{OFFLINE_HINT}</p> : null}
      </div>
    </Sheet>
  );
}

/** The approver's queue as a panel; nothing at all when there is nothing waiting or the person cannot approve. */
export function ApprovalsPanel({ onOpen, className }: { onOpen: (row: PendingApproval) => void; className?: string }) {
  const canApprove = useCanApprove();
  const online = useOnline();
  const q = usePendingApprovals(canApprove);
  const [deciding, setDeciding] = useState<{ row: PendingApproval; decision: Decision } | null>(null);
  const rows = q.data ?? [];
  if (!canApprove || !rows.length) return null;
  return (
    <Panel className={className} title={`Waiting for your approval · ${rows.length}`} sub="Estimates and proposals a rule sent to you">
      {rows.map((r) => (
        <div key={`${r.doc}-${r.id}`} data-approval={r.id} className="flex items-center gap-2 border-b border-line/60 last:border-b-0">
          <div className="min-w-0 flex-1">
            <ListLine
              title={`${r.number} · ${r.title}`}
              sub={[r.doc === 'proposal' ? 'Proposal' : 'Estimate', typeof r.rule === 'string' ? r.rule : r.rule?.label, nameOf(r.requested_by) ? `asked by ${nameOf(r.requested_by)}` : null, r.requested_at ? relative(r.requested_at) : null].filter(Boolean).join(' · ')}
              right={r.value !== null && r.value !== undefined ? <b className="shrink-0 text-[12.5px] text-ink tabular-nums">{moneyFull(r.value, r.currency ?? null)}</b> : null}
              onClick={() => onOpen(r)}
            />
          </div>
          <span className="flex shrink-0 gap-1.5 pr-3.5">
            <button type="button" className={btnGood} disabled={!online} title={online ? undefined : OFFLINE_HINT} onClick={() => setDeciding({ row: r, decision: 'approve' })}>
              <Icon name="check" size={13} className="mr-1" /> Approve
            </button>
            <button type="button" className={btnBad} disabled={!online} title={online ? undefined : OFFLINE_HINT} onClick={() => setDeciding({ row: r, decision: 'send_back' })}>
              Send back
            </button>
          </span>
        </div>
      ))}
      {deciding ? <DecideSheet doc={deciding.row.doc} id={deciding.row.doc_id} number={deciding.row.number} decision={deciding.decision} onClose={() => setDeciding(null)} /> : null}
    </Panel>
  );
}

import { useMutation, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useState } from 'react';
import { errorMessage } from '../../core/bridge';
import { toast } from '../../core/toasts';
import { ErrorNote, Modal, Spinner, cx } from '../../components/ui';
import { btn, btnBad, btnGood, btnPrimary, btnSmall, input, PageHead } from '../hr/parts';
import { approvalRoute, decide, K, type Approval, type ApprovalKind, type Decision } from './api';

/**
 * D05 · approvals waiting on me: requisitions, selections and offers, each decided through the same approval chain
 * as the web — approve, reject or return, with a comment (required to reject or return).
 */
const KIND: Record<ApprovalKind, string> = { requisition: 'Requisition', selection: 'Selection', offer: 'Offer' };
const VERB: Record<Decision, string> = { approve: 'Approve', reject: 'Reject', return: 'Return' };

export default function Approvals({ data, can, onWeb }: { data: UseQueryResult<Approval[]>; can: Record<ApprovalKind, boolean>; onWeb: (path: string) => void }) {
  const qc = useQueryClient();
  const [asking, setAsking] = useState<{ a: Approval; d: Decision } | null>(null);
  const run = useMutation({
    mutationFn: ({ a, d, comment }: { a: Approval; d: Decision; comment: string }) => decide(a, d, comment),
    onSuccess: (_r, v) => { toast('success', `${KIND[v.a.kind]} ${v.d === 'approve' ? 'approved' : v.d === 'reject' ? 'rejected' : 'returned'}.`); void qc.invalidateQueries({ queryKey: K.approvals }); },
    onError: (e) => toast('error', errorMessage(e)),
  });
  const list = data.data ?? [];

  return (
    <div className="h-full overflow-y-auto px-6 pt-5 pb-6 scroll-thin">
      <PageHead title="Approvals" sub={`${list.length} waiting on you`} />
      {data.isPending ? <Spinner /> : data.isError ? <ErrorNote error={data.error} onRetry={() => void data.refetch()} /> : !list.length ? (
        <p className="text-[13px] text-ink-2">Nothing is waiting on you.</p>
      ) : (
        <ul aria-label="Waiting on me" className="flex flex-col gap-2">
          {list.map((a) => (
            <li key={`${a.kind}-${a.id}`} aria-label={`${KIND[a.kind]}: ${a.title}`} className="flex items-center gap-3 rounded-[12px] border border-line bg-surface p-3.5">
              <span className={cx('inline-flex h-5 shrink-0 items-center rounded-full px-[7px] text-[11px] font-bold', a.kind === 'offer' ? 'bg-[#EEF1FD] text-[#3B5BDB]' : a.kind === 'selection' ? 'bg-[#E3F6EE] text-[#1F7A4D]' : 'bg-subtle text-ink-2')}>{KIND[a.kind]}</span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-semibold text-ink">{a.title}{a.subtitle ? <span className="font-normal text-ink-3"> · {a.subtitle}</span> : null}</div>
                {a.detail ? <div className={cx('truncate text-[12px]', a.above_band ? 'text-[#92400E] dark:text-warning' : 'text-ink-3')}>{a.detail}</div> : null}
              </div>
              <button type="button" className={btnSmall} onClick={() => onWeb(approvalRoute(a))}>Open</button>
              {can[a.kind] ? (
                <>
                  <button type="button" className={btnSmall} disabled={run.isPending} onClick={() => setAsking({ a, d: 'return' })}>Return</button>
                  <button type="button" className={btnBad} disabled={run.isPending} onClick={() => setAsking({ a, d: 'reject' })}>Reject</button>
                  <button type="button" className={btnGood} disabled={run.isPending} onClick={() => setAsking({ a, d: 'approve' })}>Approve</button>
                </>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-4 text-[12px] text-ink-3">Decisions go through the same approval chain as the web — a desktop notification arrives when something new waits on you.</p>
      {asking ? <DecidePrompt approval={asking.a} decision={asking.d} onCancel={() => setAsking(null)} onConfirm={(comment) => { const v = asking; setAsking(null); run.mutate({ a: v.a, d: v.d, comment }); }} /> : null}
    </div>
  );
}

export function DecidePrompt({ approval, decision, onCancel, onConfirm }: { approval: Approval; decision: Decision; onCancel: () => void; onConfirm: (comment: string) => void }) {
  const [comment, setComment] = useState('');
  const needed = decision !== 'approve';
  return (
    <Modal
      title={`${VERB[decision]} · ${approval.title}`}
      onClose={onCancel}
      footer={
        <>
          <button type="button" className={btn} onClick={onCancel}>Cancel</button>
          <button type="button" className={btnPrimary} disabled={needed && !comment.trim()} onClick={() => onConfirm(comment.trim())}>{VERB[decision]}</button>
        </>
      }
    >
      <label className="flex flex-col gap-1 text-[13px] font-semibold text-ink-2">
        {needed ? 'Comment (required)' : 'Comment'}
        <textarea aria-label="Comment" className={cx(input, 'h-24 py-2 font-normal')} value={comment} onChange={(e) => setComment(e.target.value)} autoFocus />
      </label>
    </Modal>
  );
}

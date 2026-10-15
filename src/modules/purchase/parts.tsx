import { useQueryClient } from '@tanstack/react-query';
import { useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { dateLabel } from '../../core/time';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { cx } from '../../components/ui';
import { btn, btnBad, btnGood, btnPrimary, btnSmall, Field, input, Sheet } from '../hr/parts';
import type { ApprovalDoc } from '@shared/purchase';
import { OFFLINE_WRITE, refreshPurchase } from './api';
import { approvalActions, chainWords, currentStep, decide, refusalCode, refusalText, submitForApproval, type ApprovalState } from './chain';

/** Purchasing's own pieces: a list's frame, the approval chain, and the bar that submits, approves and rejects. */

export function Frame({ min, head, children, more }: { min: number; head: ReactNode; children: ReactNode; more?: ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[12px] border border-line bg-surface">
      <div className="min-h-0 flex-1 overflow-auto scroll-thin">
        <div style={{ minWidth: min }}>
          <div className="sticky top-0 z-10 flex gap-2.5 border-b border-line bg-ground px-3.5 py-2 text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase">{head}</div>
          {children}
        </div>
      </div>
      {more}
    </div>
  );
}

export const rowCls = 'flex w-full items-center gap-2.5 border-b border-line/60 px-3.5 py-2 text-left text-[12.5px] last:border-b-0 hover:bg-subtle/60';

/** A screen's head: its title, a line under it, and its actions on the right. */
export function Head({ title, sub, children }: { title: ReactNode; sub?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex min-w-0 flex-1 flex-col">
        <h1 className="m-0 text-[20px] font-bold text-ink">{title}</h1>
        {sub ? <span className="text-[13px] text-ink-2">{sub}</span> : null}
      </div>
      {children ? <div className="flex flex-wrap items-center gap-2">{children}</div> : null}
    </div>
  );
}

/** The approval chain: each step, who decided it and when (the design's "✓ Department · Nadeesha P. · 22 Sep"). */
export function Chain({ a }: { a: ApprovalState }) {
  if (!a.steps.length) return <span className="text-[12.5px] text-ink-3">{a.required ? 'Not submitted for approval yet.' : 'No approval needed below the threshold.'}</span>;
  const now = currentStep(a);
  return (
    <ol className="m-0 flex list-none flex-col gap-1 p-0" aria-label="Approval chain">
      {a.steps.map((s) => (
        <li key={s.step} className={cx('flex items-center gap-2 text-[12.5px]', s === now ? 'font-semibold text-ink' : 'text-ink-2')}>
          <span
            className={cx(
              'flex h-5 w-5 shrink-0 items-center justify-center rounded-full',
              s.decision === 'approved' ? 'bg-[#E4F4EA] text-[#145C39]' : s.decision === 'rejected' ? 'bg-[#FCE9E4] text-[#8C2A14]' : s.decision === 'skipped' ? 'bg-subtle text-ink-3' : 'bg-[#FFF4E0] text-[#9A4A06]',
            )}
            aria-hidden="true"
          >
            <Icon name={s.decision === 'approved' ? 'check' : s.decision === 'rejected' ? 'x' : s.decision === 'skipped' ? 'minus' : 'clock'} size={12} />
          </span>
          <span className="min-w-0 flex-1 truncate">
            {[s.label, s.decided_by ?? s.approver, s.decided_at ? dateLabel(s.decided_at.slice(0, 10)) : s.decision === 'pending' ? 'waiting' : null].filter(Boolean).join(' · ')}
            {s.note ? <span className="text-ink-3"> — “{s.note}”</span> : null}
          </span>
        </li>
      ))}
    </ol>
  );
}

/** "Approval 2/3" as a pill, for lists. */
export function ChainPill({ a }: { a: ApprovalState }) {
  const w = chainWords(a);
  return w ? <span className="inline-flex h-[20px] items-center rounded-[10px] bg-[#FFF4E0] px-2 text-[11px] font-bold whitespace-nowrap text-[#9A4A06] dark:bg-warning-bg dark:text-warning">{w}</span> : null;
}

/**
 * Submit for approval, Approve and Reject for one document, as the chain and the person's permissions allow. A refusal
 * (`self_approval`, `already_decided`, `approval_required`…) is said in words, and the document is asked for again.
 */
export function DecisionBar({
  doc,
  id,
  a,
  status,
  raise,
  approve,
  offline,
  extra,
}: {
  doc: ApprovalDoc;
  id: number;
  a: ApprovalState;
  status: string;
  /** May submit this kind of document. */
  raise: boolean;
  /** Holds an approve permission. */
  approve: boolean;
  offline: boolean;
  extra?: ReactNode;
}) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState('');
  const acts = approvalActions(a, status, { raise, approve, offline });
  const step = currentStep(a)?.step ?? null;
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      toast('success', ok);
      setRejecting(false);
      setNote('');
    } catch (e) {
      toast(refusalCode(e) === 'already_decided' ? 'warning' : 'error', refusalText(e));
    } finally {
      setBusy(false);
      refreshPurchase(qc);
    }
  };
  if (!acts.submit && !acts.approve && !acts.note && !extra) return null;
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {acts.submit ? (
          <button type="button" className={btnPrimary + ' !h-[30px] !text-[12.5px]'} disabled={busy} onClick={() => void run(() => submitForApproval(doc, id), 'Submitted for approval')}>
            Submit for approval
          </button>
        ) : null}
        {acts.approve ? (
          <button type="button" className={btnGood} disabled={busy} title="Approve your step (A)" data-approve onClick={() => void run(() => decide(doc, id, 'approve', { step }), 'Approved')}>
            Approve
          </button>
        ) : null}
        {acts.reject ? (
          <button type="button" className={btnBad} disabled={busy} onClick={() => setRejecting(true)}>
            Reject
          </button>
        ) : null}
        {extra}
        {acts.note ? <span className="text-[12.5px] text-ink-3">{acts.note}</span> : null}
        {offline && (raise || approve) && !acts.note ? <span className="text-[12px] text-ink-3">{OFFLINE_WRITE}</span> : null}
      </div>
      {rejecting ? (
        <Sheet
          title="Reject this step?"
          width={440}
          onClose={() => setRejecting(false)}
          footer={
            <>
              <button type="button" className={btn} onClick={() => setRejecting(false)}>
                Back
              </button>
              <button type="button" className={btnPrimary} disabled={busy || !note.trim()} onClick={() => void run(() => decide(doc, id, 'reject', { note, step }), 'Rejected')}>
                Reject
              </button>
            </>
          }
        >
          <Field label="Why" hint="Whoever raised it sees this">
            <input className={input} value={note} onChange={(e) => setNote(e.target.value)} aria-label="Why it is rejected" maxLength={500} autoFocus />
          </Field>
        </Sheet>
      ) : null}
    </>
  );
}

/** A small action that waits for the connection while offline. */
export function WriteButton({ offline, children, className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { offline: boolean }) {
  return (
    <button type="button" {...rest} className={className ?? btnSmall} disabled={offline || rest.disabled} title={offline ? OFFLINE_WRITE : rest.title}>
      {children}
    </button>
  );
}

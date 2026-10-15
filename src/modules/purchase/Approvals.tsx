import { useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiError } from '../../core/api';
import { dateLabel } from '../../core/time';
import { toast } from '../../core/toasts';
import { ErrorNote, Spinner } from '../../components/ui';
import { btn, btnBad, btnGood, btnPrimary, btnSmall, Empty, Field, input, Sheet } from '../hr/parts';
import { whole } from '../inventory/api';
import type { ApprovalDoc } from '@shared/purchase';
import { OFFLINE_WRITE, refreshPurchase, usePurchaseCan, usePurchaseOffline, type QueueItem } from './api';
import { decide, refusalCode, refusalText } from './chain';
import { Head } from './parts';

/**
 * Waiting on me (G-14): every purchase document whose current step is mine to decide — orders, requests, returns and
 * bills — from `GET /api/purchase/approvals?mine=1`, the same queue the tray counts and the banners come from. Approve
 * decides my step; Reject asks why. A step somebody else took meanwhile, or my own document, is refused by the server
 * and said in words.
 */
const DOC: Record<ApprovalDoc, string> = { order: 'Purchase order', request: 'Request', return: 'Return', bill: 'Vendor bill' };

export default function Approvals({ q, onOpen }: { org: string; q: UseQueryResult<QueueItem[]>; onOpen: (doc: ApprovalDoc, id: number) => void }) {
  const qc = useQueryClient();
  const c = usePurchaseCan();
  const offline = usePurchaseOffline();
  const [busy, setBusy] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<QueueItem | null>(null);
  const [note, setNote] = useState('');
  const rows = q.data ?? [];
  const run = async (a: QueueItem, decision: 'approve' | 'reject', why?: string) => {
    setBusy(`${a.doc}${a.id}`);
    try {
      await decide(a.doc, a.id, decision, { step: a.step, note: why });
      toast('success', decision === 'approve' ? `${a.number} approved` : `${a.number} rejected`);
      setRejecting(null);
      setNote('');
    } catch (e) {
      toast(refusalCode(e) === 'already_decided' ? 'warning' : 'error', refusalText(e));
    } finally {
      setBusy(null);
      refreshPurchase(qc);
    }
  };
  const unsupported = q.error instanceof ApiError && q.error.status === 404;

  return (
    <div className="flex flex-col gap-3 px-6 py-5">
      <Head title="Waiting on me" sub="Purchase documents whose next approval step is yours" />
      {offline ? <span className="text-[12.5px] text-ink-3">{OFFLINE_WRITE}</span> : null}
      {q.isLoading ? <Spinner /> : unsupported ? <Empty text="This WorkSuite server has no approvals queue yet. Approve orders from Purchase orders." /> : q.error ? <ErrorNote error={q.error} onRetry={() => void q.refetch()} /> : null}
      {!q.isLoading && !q.error && !rows.length ? <Empty text="Nothing is waiting on you." /> : null}
      <div className="flex flex-col overflow-hidden rounded-[12px] border border-line bg-surface">
        {rows.map((a) => (
          <div key={`${a.doc}-${a.id}`} data-approval={`${a.doc}-${a.id}`} className="flex flex-wrap items-center gap-3 border-b border-line/60 px-3.5 py-2.5 text-[12.5px] last:border-b-0">
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="flex items-center gap-2">
                <b className="text-ink">{a.number}</b>
                <span className="text-ink-3">{DOC[a.doc]}</span>
              </span>
              <span className="truncate text-ink-2">
                {[a.vendor, a.label ? `${a.label}${a.step && a.steps ? ` · step ${a.step} of ${a.steps}` : ''}` : a.step && a.steps ? `step ${a.step} of ${a.steps}` : null, a.requested_by ? `raised by ${a.requested_by}` : null, a.created_at ? dateLabel(a.created_at.slice(0, 10)) : null]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </span>
            <b className="text-ink tabular-nums">{a.total !== null ? whole(a.total, a.currency) : ''}</b>
            <span className="flex gap-1.5">
              <button type="button" className={btnSmall} onClick={() => onOpen(a.doc, a.id)}>
                Open
              </button>
              {c.approve || a.doc === 'bill' ? (
                <>
                  <button type="button" className={btnGood} disabled={!!busy || offline} title={offline ? OFFLINE_WRITE : undefined} onClick={() => void run(a, 'approve')}>
                    Approve
                  </button>
                  <button type="button" className={btnBad} disabled={!!busy || offline} title={offline ? OFFLINE_WRITE : undefined} onClick={() => setRejecting(a)}>
                    Reject
                  </button>
                </>
              ) : null}
            </span>
          </div>
        ))}
      </div>
      {rejecting ? (
        <Sheet
          title={`Reject ${rejecting.number}?`}
          width={440}
          onClose={() => setRejecting(null)}
          footer={
            <>
              <button type="button" className={btn} onClick={() => setRejecting(null)}>
                Back
              </button>
              <button type="button" className={btnPrimary} disabled={!!busy || !note.trim()} onClick={() => void run(rejecting, 'reject', note)}>
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
    </div>
  );
}

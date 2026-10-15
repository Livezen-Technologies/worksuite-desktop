import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiError } from '../../core/api';
import { toast } from '../../core/toasts';
import { Checkbox } from '../../components/Checkbox';
import { Select } from '../../components/Select';
import { ErrorNote, Spinner } from '../../components/ui';
import { btn, btnBad, btnGood, btnPrimary, Empty, Field, input, Sheet } from '../hr/parts';
import { qty, stampWords } from '../inventory/api';
import { pick } from '../inventory/pickers';
import { fetchQc, KP, OFFLINE_WRITE, refreshPurchase, rejectQc, releaseQc, usePurchaseCan, usePurchaseOffline, type QcItem } from './api';
import { refusalText } from './chain';
import { Frame, Head } from './parts';

/**
 * Quality hold (G-07): what was received into QC — the lines put on hold at receiving (F3) — waiting to be tested.
 * Release puts it into stock to sell or use; Reject writes it off the hold with a reason and, when asked, starts a
 * return to the vendor.
 */
export default function Qc({ org, onReceipt, onReturn }: { org: string; onReceipt: (id: number) => void; onReturn: (id: number) => void }) {
  const qc = useQueryClient();
  const c = usePurchaseCan();
  const offline = usePurchaseOffline();
  const [status, setStatus] = useState('held');
  const q = useQuery({ queryKey: KP.qc(org, status), queryFn: ({ signal }) => fetchQc(org, status, signal), retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 2 });
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState<QcItem | null>(null);
  const [reason, setReason] = useState('');
  const [back, setBack] = useState(true);
  const rows = q.data?.items ?? [];
  const reasons = q.data?.reasons?.length ? q.data.reasons : ['damaged', 'wrong_item', 'expired', 'quality', 'documentation', 'other'];
  const [why, setWhy] = useState('quality');
  const may = c.receive && !offline;
  const run = async (fn: () => Promise<unknown>, ok: string, after?: (r: unknown) => void) => {
    setBusy(true);
    try {
      const r = await fn();
      toast('success', ok);
      after?.(r);
      setRejecting(null);
      setReason('');
    } catch (e) {
      toast('error', refusalText(e));
    } finally {
      setBusy(false);
      refreshPurchase(qc);
    }
  };
  return (
    <div className="flex h-full min-h-0 flex-col gap-3 px-6 py-5">
      <Head title="Quality hold" sub="Received into QC, waiting to be tested" />
      <div className="flex items-center gap-2">
        <Select
          aria-label="Hold status"
          value={status}
          onValueChange={setStatus}
          options={[
            { value: 'held', label: 'On hold' },
            { value: 'released', label: 'Released' },
            { value: 'rejected', label: 'Rejected' },
            { value: 'all', label: 'Everything' },
          ]}
          className={pick + ' !w-[160px]'}
        />
        {offline ? <span className="text-[12px] text-ink-3">{OFFLINE_WRITE}</span> : null}
      </div>
      <Frame
        min={820}
        head={
          <>
            <span className="min-w-0 flex-1">Item</span>
            <span className="w-[90px] text-right">Quantity</span>
            <span className="w-[120px]">Receipt</span>
            <span className="w-[150px]">Vendor</span>
            <span className="w-[110px]">Held</span>
            <span className="w-[170px]" />
          </>
        }
      >
        {q.isLoading ? (
          <Spinner />
        ) : q.error instanceof ApiError && q.error.status === 404 ? (
          <Empty text="This WorkSuite server has no quality hold yet." />
        ) : q.error ? (
          <ErrorNote error={q.error} onRetry={() => void q.refetch()} />
        ) : rows.length ? (
          rows.map((x) => (
            <div key={x.id} data-qc={x.id} className="flex items-center gap-2.5 border-b border-line/60 px-3.5 py-2 text-[12.5px] last:border-b-0">
              <span className="flex min-w-0 flex-1 flex-col">
                <b className="truncate text-ink">{x.product}</b>
                <span className="truncate text-[11.5px] text-ink-3">{[x.code, x.batch_no ? `batch ${x.batch_no}` : null, x.warehouse, x.bin ? `bin ${x.bin}` : null].filter(Boolean).join(' · ')}</span>
              </span>
              <b className="w-[90px] text-right text-ink tabular-nums">{qty(x.quantity, x.unit)}</b>
              <span className="w-[120px] truncate">
                {x.grn_id ? (
                  <button type="button" className="text-primary hover:underline" onClick={() => onReceipt(x.grn_id!)}>
                    {x.grn_number ?? `#${x.grn_id}`}
                  </button>
                ) : (
                  '—'
                )}
              </span>
              <span className="w-[150px] truncate text-ink-2">{x.vendor ?? '—'}</span>
              <span className="w-[110px] text-ink-3">{x.held_at ? stampWords(x.held_at) : '—'}</span>
              <span className="flex w-[170px] justify-end gap-1.5">
                {x.status === 'held' || !x.status ? (
                  <>
                    <button type="button" className={btnGood} disabled={busy || !may} title={offline ? OFFLINE_WRITE : 'It passed: into stock'} onClick={() => void run(() => releaseQc(x.id), `${x.product} released into stock`)}>
                      Release
                    </button>
                    <button type="button" className={btnBad} disabled={busy || !may} title={offline ? OFFLINE_WRITE : undefined} onClick={() => setRejecting(x)}>
                      Reject
                    </button>
                  </>
                ) : (
                  <span className="text-ink-3">{x.status}</span>
                )}
              </span>
            </div>
          ))
        ) : (
          <Empty text={status === 'held' ? 'Nothing is on quality hold.' : 'Nothing here.'} />
        )}
      </Frame>
      {rejecting ? (
        <Sheet
          title={`Reject ${rejecting.product}?`}
          width={460}
          onClose={() => setRejecting(null)}
          footer={
            <>
              <button type="button" className={btn} onClick={() => setRejecting(null)}>
                Back
              </button>
              <button
                type="button"
                className={btnPrimary}
                disabled={busy || (why === 'other' && !reason.trim())}
                onClick={() => void run(() => rejectQc(rejecting.id, { reason: why, note: reason.trim() || null, return: back }), back ? 'Rejected — a return to the vendor is started' : 'Rejected', (r) => {
                  const rid = (r as { return_id?: number | null } | null)?.return_id;
                  if (rid) onReturn(rid);
                })}
              >
                Reject
              </button>
            </>
          }
        >
          <div className="flex flex-col gap-2.5">
            <Field label="Why it failed">
              <Select aria-label="Why it failed" value={why} onValueChange={setWhy} options={reasons.map((r) => ({ value: r, label: r.replace(/_/g, ' ').replace(/^./, (x) => x.toUpperCase()) }))} className={pick} />
            </Field>
            <Field label="Note" hint={why === 'other' ? 'Say what was wrong' : undefined}>
              <input className={input} value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Note" maxLength={400} autoFocus />
            </Field>
            <label className="flex items-center gap-2 text-[12.5px] text-ink">
              <Checkbox checked={back} onChange={(e) => setBack(e.target.checked)} /> Send it back to the vendor (starts a return)
            </label>
          </div>
        </Sheet>
      ) : null}
    </div>
  );
}

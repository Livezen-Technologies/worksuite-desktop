import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { errorMessage } from '../../core/bridge';
import { dateLabel } from '../../core/time';
import { toast } from '../../core/toasts';
import { Select } from '../../components/Select';
import { ErrorNote, Spinner } from '../../components/ui';
import { btn, btnPrimary, btnSmall, Empty, Field, input, Sheet, SidePanel } from '../../components/PageKit';
import { qty, whole } from '../inventory/api';
import { Pill } from '../../components/ListKit';
import { pick } from '../inventory/pickers';
import { createReturn, fetchReturn, fetchReturns, KP, OFFLINE_WRITE, refreshPurchase, RETURN_REASONS, returnAct, SETTLEMENTS, usePurchaseCan, usePurchaseOffline } from './api';
import { approvalOf, refusalText } from './chain';
import { fetchReceipt } from './buying';
import { Chain, DecisionBar, Frame, Head, rowCls } from './parts';

/**
 * Returns (S-07): sending something back — against a posted receipt, from its warehouse — with why, and what we want
 * instead: a debit note, a refund, or a replacement (G-19: that opens an expected receipt on the order). It goes
 * through the approval chain (G-01), is shipped with a carrier and tracking number, and settled.
 */
const STATUS_TONE = (s: string): 'grey' | 'amber' | 'blue' | 'green' | 'red' => (s === 'settled' ? 'green' : s === 'shipped' ? 'blue' : s === 'cancelled' ? 'grey' : s === 'rejected' ? 'red' : 'amber');
const label = (list: Array<{ value: string; label: string }>, v: string) => list.find((x) => x.value === v)?.label ?? v;

export default function Returns({ org, openId, initialStatus, onOpen, onOrder, onReceipt }: { org: string; openId: number | null; initialStatus?: string | null; onOpen: (id: number | null) => void; onOrder: (id: number) => void; onReceipt: (id: number) => void }) {
  const [status, setStatus] = useState(initialStatus ?? '');
  const q = useQuery({ queryKey: KP.returns(org, status), queryFn: ({ signal }) => fetchReturns(org, status, signal) });
  const rows = q.data ?? [];
  return (
    <div className="flex h-full min-h-0 flex-col gap-3 px-6 py-5">
      <Head title="Returns" sub="Goods sent back to vendors — start one from a posted receipt in Goods received" />
      <Select
        aria-label="Return status"
        value={status}
        onValueChange={setStatus}
        options={[{ value: '', label: 'Every state' }, ...['draft', 'pending', 'approved', 'shipped', 'settled', 'cancelled'].map((s) => ({ value: s, label: s.charAt(0).toUpperCase() + s.slice(1) }))]}
        className={pick + ' !w-[160px]'}
      />
      <Frame
        min={900}
        head={
          <>
            <span className="min-w-0 flex-1">Return</span>
            <span className="w-[170px]">Vendor</span>
            <span className="w-[110px]">Order</span>
            <span className="w-[130px]">Why</span>
            <span className="w-[160px]">We want</span>
            <span className="w-[100px]">Status</span>
            <span className="w-[100px] text-right">Value</span>
          </>
        }
      >
        {q.isLoading ? (
          <Spinner />
        ) : q.error ? (
          <ErrorNote error={q.error} onRetry={() => void q.refetch()} />
        ) : rows.length ? (
          rows.map((r) => (
            <button key={r.id} type="button" data-return={r.id} className={rowCls} onClick={() => onOpen(r.id)}>
              <b className="min-w-0 flex-1 truncate text-ink">{r.reference}</b>
              <span className="w-[170px] truncate text-ink">{r.vendor ?? '—'}</span>
              <span className="w-[110px] truncate text-ink-2">{r.po_number ?? '—'}</span>
              <span className="w-[130px] truncate text-ink-2">{label(RETURN_REASONS, r.reason)}</span>
              <span className="w-[160px] truncate text-ink-2">{label(SETTLEMENTS, r.settlement)}</span>
              <span className="w-[100px]">
                <Pill tone={STATUS_TONE(r.status)}>{r.status}</Pill>
              </span>
              <span className="w-[100px] text-right text-ink tabular-nums">{whole(r.total_value)}</span>
            </button>
          ))
        ) : (
          <Empty text={status ? 'No return matches.' : 'Nothing has been sent back.'} />
        )}
      </Frame>
      {openId ? <ReturnPanel key={openId} id={openId} onClose={() => onOpen(null)} onOrder={onOrder} onReceipt={onReceipt} /> : null}
    </div>
  );
}

function ReturnPanel({ id, onClose, onOrder, onReceipt }: { id: number; onClose: () => void; onOrder: (id: number) => void; onReceipt: (id: number) => void }) {
  const qc = useQueryClient();
  const c = usePurchaseCan();
  const offline = usePurchaseOffline();
  const q = useQuery({ queryKey: KP.ret(id), queryFn: ({ signal }) => fetchReturn(id, signal) });
  const d = q.data;
  const r = d?.return;
  const a = approvalOf(d, c.approve);
  const [busy, setBusy] = useState(false);
  const [shipping, setShipping] = useState(false);
  const [carrier, setCarrier] = useState('');
  const [tracking, setTracking] = useState('');
  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      toast('success', ok);
      setShipping(false);
    } catch (e) {
      toast('error', refusalText(e));
    } finally {
      setBusy(false);
      refreshPurchase(qc);
    }
  };
  // Returns are the buying side's (`purchase.order`, the server's submit capability for them).
  const may = c.order && !offline;
  return (
    <SidePanel
      label={r ? `Return ${r.reference}` : 'Return'}
      width={600}
      onClose={onClose}
      head={
        <span className="flex items-center gap-2">
          <b className="text-[15px] text-ink">{r?.reference ?? 'Return'}</b>
          {r ? <Pill tone={STATUS_TONE(r.status)}>{r.status}</Pill> : null}
        </span>
      }
    >
      {q.isLoading ? (
        <Spinner />
      ) : q.error ? (
        <ErrorNote error={q.error} onRetry={() => void q.refetch()} />
      ) : r && d ? (
        <>
          <span className="text-[12.5px] text-ink-2">
            {[r.vendor, r.warehouse ? `from ${r.warehouse}` : null, label(RETURN_REASONS, r.reason), label(SETTLEMENTS, r.settlement), r.return_date ? dateLabel(r.return_date) : null, r.carrier ? `${r.carrier}${r.tracking_no ? ` ${r.tracking_no}` : ''}` : null].filter(Boolean).join(' · ')}
          </span>
          <span className="flex gap-3 text-[12.5px]">
            {r.po_id ? (
              <button type="button" className="text-primary hover:underline" onClick={() => onOrder(r.po_id!)}>
                {r.po_number ?? 'The order'}
              </button>
            ) : null}
            {r.grn_id ? (
              <button type="button" className="text-primary hover:underline" onClick={() => onReceipt(r.grn_id!)}>
                The receipt
              </button>
            ) : null}
          </span>
          <div className="overflow-hidden rounded-[10px] border border-line">
            {d.lines.map((l) => (
              <span key={l.id} className="flex gap-2 border-b border-line/60 px-3 py-1.5 text-[12.5px] last:border-b-0">
                <span className="min-w-0 flex-1 truncate text-ink">
                  {l.product_name ?? '—'} <span className="text-ink-3">{l.code}</span>
                </span>
                <b className="w-[80px] text-right text-ink tabular-nums">{qty(l.quantity, l.unit)}</b>
                <span className="w-[90px] text-right text-ink-2 tabular-nums">{whole(l.line_total)}</span>
              </span>
            ))}
          </div>
          {r.settlement === 'replacement' && (r.status === 'shipped' || r.status === 'settled') ? <span className="text-[12px] text-ink-2">The replacement is expected as a line on the order, received like any other.</span> : null}
          <section className="flex flex-col gap-1.5">
            <b className="text-[13px] text-ink">Approvals</b>
            <Chain a={a} />
            {d.approval !== undefined ? (
              <DecisionBar doc="return" id={id} a={a} status={r.status} raise={c.order} approve={c.approve} offline={offline} />
            ) : c.approve && ['draft', 'pending'].includes(r.status) && d.may_approve !== false ? (
              // A server before the purchasing build: the return's own approve.
              <button type="button" className={btnSmall + ' self-start'} disabled={busy || offline} title={offline ? OFFLINE_WRITE : undefined} onClick={() => void act(() => returnAct(id, 'approve'), 'Return approved')}>
                Approve
              </button>
            ) : null}
          </section>
          <div className="flex flex-wrap gap-2">
            {r.status === 'approved' ? (
              <button type="button" className={btnSmall} disabled={busy || !may} title={offline ? OFFLINE_WRITE : undefined} onClick={() => setShipping(true)}>
                Ship it
              </button>
            ) : null}
            {r.status === 'shipped' && r.settlement === 'credit' ? (
              <button type="button" className={btnSmall} disabled={busy || !may} title={offline ? OFFLINE_WRITE : undefined} onClick={() => void act(() => returnAct(id, 'debit-note'), 'Debit note raised')}>
                Raise the debit note
              </button>
            ) : null}
            {['draft', 'pending', 'approved'].includes(r.status) ? (
              <button type="button" className={btnSmall + ' ml-auto text-danger'} disabled={busy || !may} title={offline ? OFFLINE_WRITE : undefined} onClick={() => void act(() => returnAct(id, 'cancel'), 'Return cancelled')}>
                Cancel
              </button>
            ) : null}
          </div>
        </>
      ) : null}
      {shipping ? (
        <Sheet
          title="Ship the return"
          width={460}
          onClose={() => setShipping(false)}
          footer={
            <>
              <button type="button" className={btn} onClick={() => setShipping(false)}>
                Back
              </button>
              <button type="button" className={btnPrimary} disabled={busy} onClick={() => void act(() => returnAct(id, 'ship', { carrier: carrier.trim() || null, tracking_no: tracking.trim() || null }), 'Shipped — the stock has left')}>
                Ship
              </button>
            </>
          }
        >
          <div className="grid grid-cols-2 gap-2.5">
            <Field label="Carrier">
              <input className={input} value={carrier} onChange={(e) => setCarrier(e.target.value)} aria-label="Carrier" maxLength={80} />
            </Field>
            <Field label="Tracking number">
              <input className={input} value={tracking} onChange={(e) => setTracking(e.target.value)} aria-label="Tracking number" maxLength={80} />
            </Field>
          </div>
        </Sheet>
      ) : null}
    </SidePanel>
  );
}

/** A return from a posted receipt: its lines default to what was turned away at the door. */
export function ReturnSheet({ org, grnId, onClose, onSaved }: { org: string; grnId: number; onClose: () => void; onSaved: (id: number) => void }) {
  const qc = useQueryClient();
  const offline = usePurchaseOffline();
  const g = useQuery({ queryKey: ['purchase', 'grn', grnId], queryFn: ({ signal }) => fetchReceipt(grnId, signal) });
  const [reason, setReason] = useState('damaged');
  const [settlement, setSettlement] = useState('credit');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    const rec = g.data?.receipt;
    if (!rec) return;
    setError(null);
    setSaving(true);
    try {
      const r = await createReturn(org, { grn_id: grnId, warehouse_id: Number(rec.warehouse_id), reason, settlement, notes: notes.trim() || null });
      refreshPurchase(qc);
      toast('success', 'Return started — submit it for approval');
      onSaved(Number(r.return?.id ?? r.id));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Sheet
      title={g.data ? `Return from ${g.data.receipt.grn_number}` : 'Return goods'}
      width={520}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} disabled={saving || !g.data || offline} title={offline ? OFFLINE_WRITE : undefined} onClick={() => void save()}>
            {saving ? 'Saving…' : 'Start the return'}
          </button>
        </>
      }
    >
      {g.isLoading ? (
        <Spinner />
      ) : g.error ? (
        <ErrorNote error={g.error} onRetry={() => void g.refetch()} />
      ) : (
        <div className="flex flex-col gap-2.5">
          <span className="text-[12.5px] text-ink-2">{[g.data?.receipt.vendor, g.data?.receipt.warehouse].filter(Boolean).join(' · ')} — the lines start as what was rejected at the door; change them on the return.</span>
          <div className="grid grid-cols-2 gap-2.5">
            <Field label="Why">
              <Select aria-label="Why" value={reason} onValueChange={setReason} options={RETURN_REASONS} className={pick} />
            </Field>
            <Field label="What we want">
              <Select aria-label="What we want" value={settlement} onValueChange={setSettlement} options={SETTLEMENTS} className={pick} />
            </Field>
          </div>
          <Field label="Note">
            <input className={input} value={notes} onChange={(e) => setNotes(e.target.value)} aria-label="Note" maxLength={300} />
          </Field>
          {error ? (
            <span role="alert" className="rounded-[8px] bg-danger-bg px-3 py-2 text-[12.5px] font-semibold text-danger">
              {error}
            </span>
          ) : null}
        </div>
      )}
    </Sheet>
  );
}

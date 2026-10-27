import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { errorMessage } from '../../core/bridge';
import { dateLabel } from '../../core/time';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { btn, btnPrimary, btnSmall, Empty, Field, input, Sheet } from '../../components/PageKit';
import { qty, type Warehouse } from '../inventory/api';
import { pick, ProductPick, WarehousePick } from '../inventory/pickers';
import { createRequest, OFFLINE_WRITE, refreshPurchase, rfqFromRequest, usePurchaseCan, usePurchaseOffline } from './api';
import { approvalOf } from './chain';
import { fetchRequests, KB, requestAct, requestsFromReplenishment, type PurchaseRequest } from './buying';
import { Chain, ChainPill, DecisionBar, Head } from './parts';
import { PoChip } from './Purchasing';

/**
 * Requests (S-02, "What people have asked for"): what people need bought, with the approval chain (G-01) — submitted,
 * decided step by step — then turned into draft orders, or sent out for quotes as an RFQ. A request comes from a
 * person (New request), from the reorder rules (Raise from what is below minimum) or from another module (G-15).
 */
export default function Requests({
  org,
  warehouse,
  openId,
  initialStatus,
  onNew,
  onOrders,
  onRfq,
}: {
  org: string;
  warehouse: number | null;
  openId: number | null;
  initialStatus?: string | null;
  onNew: (() => void) | null;
  onOrders: () => void;
  onRfq: (id: number) => void;
}) {
  const qc = useQueryClient();
  const c = usePurchaseCan();
  const offline = usePurchaseOffline();
  const [status, setStatus] = useState(initialStatus ?? '');
  const q = useQuery({ queryKey: KB.requests(org, status), queryFn: ({ signal }) => fetchRequests(org, status, signal) });
  const [busy, setBusy] = useState(false);
  const rows = q.data ?? [];
  const run = async (fn: () => Promise<unknown>, label: (r: unknown) => string, after?: (r: unknown) => void) => {
    setBusy(true);
    try {
      const r = await fn();
      toast('success', label(r));
      after?.(r);
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
      refreshPurchase(qc);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 px-6 py-5">
      <Head title="Requests" sub="What people have asked for">
        {c.order ? (
          <button type="button" className={btn} disabled={busy || offline} title={offline ? OFFLINE_WRITE : undefined} onClick={() => void run(() => requestsFromReplenishment(org, warehouse), (r) => `${(r as { ids?: number[] }).ids?.length ?? 0} request(s) raised`)}>
            Raise from what is below minimum
          </button>
        ) : null}
        {onNew ? (
          <button type="button" className={btnPrimary} disabled={offline} title={offline ? OFFLINE_WRITE : undefined} onClick={onNew}>
            <Icon name="plus" size={15} /> New request
          </button>
        ) : null}
      </Head>
      <div className="flex items-center gap-2">
        <Select
          aria-label="Request status"
          value={status}
          onValueChange={setStatus}
          options={[
            { value: '', label: 'Every state' },
            { value: 'draft', label: 'Draft' },
            { value: 'pending', label: 'Waiting on approval' },
            { value: 'approved', label: 'Approved' },
            { value: 'rejected', label: 'Rejected' },
            { value: 'ordered', label: 'Ordered' },
          ]}
          className={pick + ' !w-[180px]'}
        />
        {offline ? <span className="text-[12px] text-ink-3">{OFFLINE_WRITE}</span> : null}
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto scroll-thin">
        {q.isLoading ? <Spinner /> : q.error ? <ErrorNote error={q.error} onRetry={() => void q.refetch()} /> : null}
        {!q.isLoading && !rows.length ? <Empty text={status ? 'No request matches.' : 'Nobody has asked for anything yet.'} /> : null}
        {rows.map((r) => (
          <RequestCard key={r.id} r={r} open={openId === Number(r.id)} busy={busy} offline={offline} run={run} onOrders={onOrders} onRfq={onRfq} />
        ))}
      </div>
    </div>
  );
}

function RequestCard({
  r,
  open,
  busy,
  offline,
  run,
  onOrders,
  onRfq,
}: {
  r: PurchaseRequest & { approval?: unknown; approvals?: unknown };
  open: boolean;
  busy: boolean;
  offline: boolean;
  run: (fn: () => Promise<unknown>, label: (r: unknown) => string, after?: (r: unknown) => void) => Promise<void>;
  onOrders: () => void;
  onRfq: (id: number) => void;
}) {
  const c = usePurchaseCan();
  const id = Number(r.id);
  const a = approvalOf(r, c.approve);
  // A server before the chain approves a request with its own call; the chain's buttons are DecisionBar's.
  const chainServer = r.approval !== undefined;
  const legacyApprove = !chainServer && c.approve && r.may_approve !== false && (r.status === 'pending' || r.status === 'draft');
  return (
    <section data-request={r.id} className={cx('flex flex-col gap-1.5 rounded-[12px] border bg-surface px-3.5 py-3', open ? 'border-primary' : 'border-line')}>
      <div className="flex flex-wrap items-center gap-2">
        <b className="text-ink">{r.reference}</b>
        <span className="text-[12.5px] text-ink-3">{r.warehouse ?? 'No warehouse'}</span>
        <PoChip status={r.status} />
        <ChainPill a={a} />
        {r.source === 'reorder' ? <span className="text-[11.5px] text-ink-3">raised by the reorder rules</span> : r.source && r.source !== 'manual' ? <span className="text-[11.5px] text-ink-3">from {r.source}</span> : null}
        <span className="ml-auto flex flex-wrap gap-1.5">
          {legacyApprove ? (
            <button type="button" className={btnSmall} disabled={busy || offline} onClick={() => void run(() => requestAct(id, 'approve'), () => 'Approved')}>
              Approve
            </button>
          ) : null}
          {!chainServer && c.approve && r.may_approve === false && (r.status === 'pending' || r.status === 'draft') ? <span className="self-center text-[12px] text-ink-3">You raised it, so someone else approves it</span> : null}
          {c.order && r.status === 'approved' ? (
            <>
              <button type="button" className={btnSmall} disabled={busy || offline} title="Ask vendors for quotes first" onClick={() => void run(() => rfqFromRequest(id), () => 'RFQ started', (x) => onRfq(Number((x as { id?: number; quotation?: { id: number } }).quotation?.id ?? (x as { id?: number }).id)))}>
                Request quotes
              </button>
              <button type="button" className={btnPrimary + ' !h-[30px] !text-[12.5px]'} disabled={busy || offline} onClick={() => void run(() => requestAct(id, 'order'), (x) => `${(x as { ids?: number[] }).ids?.length ?? 0} draft order(s) created`, onOrders)}>
                Turn into draft orders
              </button>
            </>
          ) : null}
        </span>
      </div>
      {r.reason || r.needed_by || r.requested_by_name ? <span className="text-[12px] text-ink-2">{[r.reason, r.needed_by ? `needed by ${dateLabel(r.needed_by)}` : null, r.requested_by_name ? `asked by ${r.requested_by_name}` : null].filter(Boolean).join(' · ')}</span> : null}
      <div className="flex flex-col">
        {r.lines.map((l) => (
          <span key={l.id} className="flex gap-2 border-t border-line/60 py-1 text-[12.5px]">
            <span className="min-w-0 flex-1 truncate text-ink">
              {l.name} <span className="text-ink-3">{l.code}</span>
            </span>
            <b className="w-[80px] text-right text-ink tabular-nums">{qty(l.quantity, l.unit)}</b>
            <span className="w-[160px] truncate text-ink-2">{l.vendor ?? <span className="text-warning-ink dark:text-warning">no vendor set</span>}</span>
            <span className="w-[200px] truncate text-ink-3">{l.note ?? ''}</span>
          </span>
        ))}
      </div>
      {chainServer ? (
        <div className="flex flex-col gap-1.5 border-t border-line/60 pt-2">
          {a.steps.length ? <Chain a={a} /> : null}
          <DecisionBar doc="request" id={id} a={a} status={r.status} raise={c.request} approve={c.approve} offline={offline} />
        </div>
      ) : null}
    </section>
  );
}

interface Draft {
  key: number;
  product: { id: number; code: string | null; name: string } | null;
  qty: string;
  note: string;
}

/** A new purchase request: where it is needed, by when, why, and the products. It goes for approval when submitted. */
export function RequestSheet({ org, warehouses, onClose, onSaved }: { org: string; warehouses: Warehouse[]; onClose: () => void; onSaved: (id: number) => void }) {
  const qc = useQueryClient();
  const offline = usePurchaseOffline();
  const [wh, setWh] = useState<number | null>(warehouses.length === 1 ? warehouses[0]!.id : null);
  const [needed, setNeeded] = useState('');
  const [reason, setReason] = useState('');
  const [lines, setLines] = useState<Draft[]>([{ key: 0, product: null, qty: '', note: '' }]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const set = (key: number, p: Partial<Draft>) => setLines((x) => x.map((l) => (l.key === key ? { ...l, ...p } : l)));
  const save = async () => {
    setError(null);
    if (!wh) return setError('Choose where it is needed.');
    const out: Array<{ product_id: number; quantity: number; note: string | null }> = [];
    for (const l of lines) {
      if (!l.product) continue;
      const n = Number(l.qty.replace(/,/g, ''));
      if (!Number.isFinite(n) || n <= 0) return setError(`Say how many of “${l.product.name}” are needed.`);
      out.push({ product_id: l.product.id, quantity: n, note: l.note.trim() || null });
    }
    if (!out.length) return setError('Add at least one product.');
    setSaving(true);
    try {
      const r = await createRequest(org, { warehouse_id: wh, needed_by: needed || null, reason: reason.trim() || null, lines: out });
      refreshPurchase(qc);
      toast('success', 'Request raised');
      onSaved(Number(r.request?.id ?? r.id));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Sheet
      title="New purchase request"
      width={720}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} disabled={saving || offline} title={offline ? OFFLINE_WRITE : undefined} onClick={() => void save()}>
            {saving ? 'Saving…' : 'Raise request'}
          </button>
        </>
      }
    >
      <div role="form" aria-label="New purchase request" className="flex flex-col gap-2.5">
        <div className="grid grid-cols-3 gap-2.5">
          <Field label="Needed at">
            <WarehousePick warehouses={warehouses} value={wh} onChange={setWh} label="Needed at" />
          </Field>
          <Field label="Needed by">
            <input type="date" className={input} value={needed} onChange={(e) => setNeeded(e.target.value)} aria-label="Needed by" />
          </Field>
          <Field label="Why">
            <input className={input} value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Why" maxLength={300} />
          </Field>
        </div>
        <b className="mt-1 text-[13px] text-ink">Products</b>
        {lines.map((l, i) => (
          <div key={l.key} className="flex items-center gap-2">
            <span className="min-w-0 flex-1">
              <ProductPick
                org={org}
                warehouse={wh}
                value={l.product ? { id: l.product.id, code: l.product.code, barcode: null, name: l.product.name, variant_label: null, unit: null, tracking: 'none', is_stocked: 1, on_hand: 0, reserved: 0 } : null}
                onChange={(p) => set(l.key, { product: p ? { id: p.id, code: p.code, name: p.name } : null })}
                label={`Line ${i + 1} product`}
              />
            </span>
            <input className={input + ' !w-[80px] text-right tabular-nums'} value={l.qty} onChange={(e) => set(l.key, { qty: e.target.value })} placeholder="Qty" aria-label={`Line ${i + 1} quantity`} />
            <input className={input + ' !w-[180px]'} value={l.note} onChange={(e) => set(l.key, { note: e.target.value })} placeholder="Note" aria-label={`Line ${i + 1} note`} />
            <button type="button" aria-label={`Remove line ${i + 1}`} onClick={() => setLines((x) => (x.length > 1 ? x.filter((y) => y.key !== l.key) : [{ key: l.key + 1, product: null, qty: '', note: '' }]))} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] text-ink-3 hover:bg-subtle hover:text-ink">
              <Icon name="x" size={14} />
            </button>
          </div>
        ))}
        <button type="button" className="self-start text-[12.5px] font-semibold text-primary hover:underline" onClick={() => setLines((x) => [...x, { key: Math.max(...x.map((y) => y.key)) + 1, product: null, qty: '', note: '' }])}>
          + Add a line
        </button>
        {error ? (
          <span role="alert" className="rounded-[8px] bg-danger-bg px-3 py-2 text-[12.5px] font-semibold text-danger">
            {error}
          </span>
        ) : null}
      </div>
    </Sheet>
  );
}

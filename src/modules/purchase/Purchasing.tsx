import { keepPreviousData, useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { app } from '../../core/app-state';
import { errorMessage } from '../../core/bridge';
import { useStore } from '../../core/store';
import { dateLabel } from '../../core/time';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { btn, btnPrimary, btnSmall, Empty, Field, input, Sheet, SidePanel } from '../hr/parts';
import { cost, num, qty, stampWords, whole, type Warehouse } from '../inventory/api';
import { OFFLINE_WRITE, purchaseCan, refreshPurchase, usePurchaseOffline, type Duplicate } from './api';
import { refusalCode, refusalText } from './chain';
import {
  cancelReceipt,
  fetchOrder,
  fetchReceipt,
  fetchReceipts,
  KB,
  orderBody,
  PER,
  PO_LABEL,
  poTone,
  postReceipt,
  receiptBody,
  REJECT_REASONS,
  saveOrder,
  searchVendors,
  type PODraft,
  type POLineDraft,
  type ReceiptLine,
  type ReceiptLineDraft,
} from './buying';
import { minWidth, Pill } from '../inventory/parts';
import { pick, ProductPick, WarehousePick } from '../inventory/pickers';

/**
 * Purchasing's documents that came with it from Inventory (InvPurchasing, InvTradeSheet; SRS-PUR-001 G-21): the
 * goods received — each receipt checked and posted, which is the moment the stock is on the shelf — and the order
 * form. The orders grid is Orders.tsx; receiving by scan is Receive.tsx; requests are Requests.tsx.
 */

export function PoChip({ status }: { status: string }) {
  return <Pill tone={poTone(status)}>{PO_LABEL[status] ?? status.replace(/_/g, ' ')}</Pill>;
}

const rowCls = 'flex w-full items-center gap-2.5 border-b border-line/60 px-3.5 py-2 text-left text-[12.5px] last:border-b-0 hover:bg-subtle/60';

function Frame({ min, head, children, more }: { min: number; head: ReactNode; children: ReactNode; more?: ReactNode }) {
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

export function Receipts({ org, warehouse, openId, onOpen }: { org: string; warehouse: number | null; openId: number | null; onOpen: (id: number) => void }) {
  const [status, setStatus] = useState('');
  const list = useInfiniteQuery({
    queryKey: KB.receipts(org, { status, warehouse }),
    initialPageParam: 1,
    queryFn: ({ pageParam, signal }) => fetchReceipts(org, warehouse, { status, page: pageParam }, signal),
    getNextPageParam: (last, pages) => (pages.length * PER < last.total ? pages.length + 1 : undefined),
    placeholderData: keepPreviousData,
  });
  const rows = useMemo(() => (list.data?.pages ?? []).flatMap((p) => p.rows), [list.data]);
  const total = list.data?.pages[0]?.total ?? 0;
  const seesCost = rows.some((r) => r.total_value !== null);
  const W = { po: 100, vendor: 160, wh: 130, st: 80, when: 90, inv: 100, val: 96 };
  return (
    <>
      <div className="flex items-center gap-2">
        <Select
          aria-label="Receipt status"
          value={status}
          onValueChange={setStatus}
          options={[
            { value: '', label: 'Every state' },
            { value: 'draft', label: 'Draft' },
            { value: 'posted', label: 'Posted' },
            { value: 'cancelled', label: 'Cancelled' },
          ]}
          className={pick + ' !w-[160px]'}
        />
        <span className="ml-auto text-[12.5px] text-ink-3">{list.isLoading ? '' : `${total.toLocaleString()} ${total === 1 ? 'receipt' : 'receipts'}`}</span>
      </div>
      <Frame
        min={minWidth(110, [W.po, W.vendor, W.wh, W.st, W.when, W.inv, ...(seesCost ? [W.val] : [])])}
        head={
          <>
            <span className="min-w-0 flex-1">Receipt</span>
            <span style={{ width: W.po }}>Order</span>
            <span style={{ width: W.vendor }}>Vendor</span>
            <span style={{ width: W.wh }}>Warehouse</span>
            <span style={{ width: W.st }}>Status</span>
            <span style={{ width: W.when }}>Received</span>
            <span style={{ width: W.inv }}>Their invoice</span>
            {seesCost ? (
              <span className="text-right" style={{ width: W.val }}>
                Value
              </span>
            ) : null}
          </>
        }
      >
        {list.isLoading ? (
          <Spinner />
        ) : list.error ? (
          <ErrorNote error={list.error} onRetry={() => void list.refetch()} />
        ) : rows.length ? (
          rows.map((g) => (
            <button key={g.id} type="button" data-grn={g.id} onClick={() => onOpen(Number(g.id))} className={cx(rowCls, openId === Number(g.id) && 'bg-info-soft dark:bg-selection/40')}>
              <b className="min-w-0 flex-1 truncate text-ink">{g.grn_number}</b>
              <span className="shrink-0 truncate text-ink-2" style={{ width: W.po }}>
                {g.po_number ?? '—'}
              </span>
              <span className="shrink-0 truncate text-ink" style={{ width: W.vendor }}>
                {g.vendor ?? '—'}
              </span>
              <span className="shrink-0 truncate text-ink-2" style={{ width: W.wh }}>
                {g.warehouse ?? '—'}
              </span>
              <span className="shrink-0" style={{ width: W.st }}>
                <Pill tone={g.status === 'posted' ? 'green' : g.status === 'draft' ? 'amber' : 'grey'}>{g.status}</Pill>
              </span>
              <span className="shrink-0 text-ink-3" style={{ width: W.when }}>
                {g.received_at ? stampWords(g.received_at) : '—'}
              </span>
              <span className="shrink-0 truncate text-ink-2" style={{ width: W.inv }}>
                {g.vendor_invoice_no ?? '—'}
              </span>
              {seesCost ? (
                <span className="shrink-0 text-right text-ink tabular-nums" style={{ width: W.val }}>
                  {g.status === 'posted' ? whole(g.total_value) : '—'}
                </span>
              ) : null}
            </button>
          ))
        ) : (
          <Empty text={status ? 'No receipt matches.' : 'Nothing has been received yet. Receive goods from an approved order.'} />
        )}
      </Frame>
    </>
  );
}

export function ReceiptPanel({ id, currency, onClose, onOrder, onReturn }: { id: number; currency: string | null; onClose: () => void; onOrder: (id: number) => void; onReturn?: ((grnId: number) => void) | null }) {
  const q = useQuery({ queryKey: KB.receipt(id), queryFn: ({ signal }) => fetchReceipt(id, signal) });
  const d = q.data;
  if (!d) {
    return (
      <SidePanel label="Receipt" width={720} onClose={onClose} head={<b className="text-[15px] text-ink">Receipt</b>}>
        {q.error ? <ErrorNote error={q.error} onRetry={() => void q.refetch()} /> : <Spinner />}
      </SidePanel>
    );
  }
  // Keyed by status: once it posts, the editor starts again as a record.
  return <ReceiptEditor key={`${d.receipt.id}-${d.receipt.status}`} id={id} d={d} currency={currency} onClose={onClose} onOrder={onOrder} onReturn={onReturn ?? null} />;
}

function ReceiptEditor({ id, d, currency, onClose, onOrder, onReturn }: { id: number; d: Awaited<ReturnType<typeof fetchReceipt>>; currency: string | null; onClose: () => void; onOrder: (id: number) => void; onReturn: ((grnId: number) => void) | null }) {
  const qc = useQueryClient();
  const perms = useStore(app, (s) => s.bootstrap?.permissions);
  const g = d.receipt;
  const draft = g.status === 'draft';
  const offline = usePurchaseOffline();
  // Receiving is `purchase.receive` (G-04), or the `inventory.purchase` umbrella; nothing posts from the offline copy.
  const mayPost = purchaseCan(perms).receive && !offline;
  // What the draft says, to correct before posting.
  const [head, setHead] = useState(() => ({ invoice: g.vendor_invoice_no ?? '', delivery: g.delivery_note_no ?? '', charges: num(g.other_charges) ? String(num(g.other_charges)) : '', notes: g.notes ?? '' }));
  const [lines, setLines] = useState<Record<string, ReceiptLineDraft>>(() =>
    Object.fromEntries(
      d.lines.map((l) => [
        String(l.id),
        { accepted: String(num(l.quantity) ?? 0), rejected: num(l.rejected_qty) ? String(num(l.rejected_qty)) : '', reason: l.reject_reason ?? '', batch: l.batch_no ?? '', expiry: l.expiry_date ?? '', serials: l.serials ?? '' },
      ]),
    ),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<'post' | 'discard' | null>(null);
  const seesCost = d.lines.some((l) => l.unit_cost !== null);
  const setLine = (lid: string, patch: Partial<ReceiptLineDraft>) => setLines((x) => ({ ...x, [lid]: { ...x[lid]!, ...patch } }));

  const post = async () => {
    if (!d) return;
    setError(null);
    const { body, error: bad } = receiptBody(
      head,
      d.lines.map((l) => ({ line: l, d: lines[String(l.id)]! })),
    );
    if (bad) {
      setConfirm(null);
      return setError(bad);
    }
    setBusy(true);
    try {
      const r = await postReceipt(id, body);
      toast(r.over_received?.length ? 'warning' : 'success', r.over_received?.length ? `Receipt posted — the stock is in. More arrived than was ordered on ${r.over_received.join('; ')}.` : 'Receipt posted — the stock is in');
      refreshPurchase(qc);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };
  const discard = async () => {
    setBusy(true);
    try {
      await cancelReceipt(id);
      toast('success', 'Receipt discarded');
      refreshPurchase(qc);
      onClose();
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };

  return (
    <>
      <SidePanel
        label={g ? `Receipt ${g.grn_number}` : 'Receipt'}
        width={720}
        onClose={onClose}
        head={
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="flex items-center gap-2">
              <b className="truncate text-[15px] text-ink">{g?.grn_number ?? 'Receipt'}</b>
              {g ? <Pill tone={g.status === 'posted' ? 'green' : g.status === 'draft' ? 'amber' : 'grey'}>{g.status}</Pill> : null}
            </span>
            {g ? (
              <span className="truncate text-[12.5px] text-ink-3">
                {[g.vendor, g.warehouse].filter(Boolean).join(' · ')}
                {g.po_number && g.po_id ? (
                  <>
                    {' · against '}
                    <button type="button" className="text-primary hover:underline" onClick={() => onOrder(Number(g.po_id))}>
                      {g.po_number}
                    </button>
                  </>
                ) : null}
              </span>
            ) : null}
          </span>
        }
      >
        {g ? (
          <>
            {draft && mayPost ? (
              <div className="grid grid-cols-3 gap-2.5">
                <Field label="Their invoice">
                  <input className={input} value={head.invoice} onChange={(e) => setHead({ ...head, invoice: e.target.value })} aria-label="Their invoice" maxLength={60} />
                </Field>
                <Field label="Delivery note">
                  <input className={input} value={head.delivery} onChange={(e) => setHead({ ...head, delivery: e.target.value })} aria-label="Delivery note" maxLength={60} />
                </Field>
                <Field label="Freight and duty on this delivery" hint="Spread across the lines by value">
                  <input className={input + ' text-right tabular-nums'} value={head.charges} onChange={(e) => setHead({ ...head, charges: e.target.value })} aria-label="Freight and duty" inputMode="decimal" />
                </Field>
              </div>
            ) : (
              <span className="text-[12.5px] text-ink-2">
                {[
                  g.vendor_invoice_no ? `their invoice ${g.vendor_invoice_no}` : null,
                  g.delivery_note_no ? `delivery note ${g.delivery_note_no}` : null,
                  num(g.other_charges) ? `freight and duty ${cost(g.other_charges, currency)}` : null,
                  g.posted_at ? `posted ${stampWords(g.posted_at)}` : null,
                ]
                  .filter(Boolean)
                  .join(' · ') || '—'}
              </span>
            )}
            <div className="overflow-hidden rounded-[10px] border border-line">
              <div className="flex gap-2 border-b border-line bg-ground px-3 py-1.5 text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase">
                <span className="min-w-0 flex-1">Product</span>
                <span className="w-[76px] text-right">Accepted</span>
                <span className="w-[76px] text-right">Rejected</span>
                {draft ? <span className="w-[150px]">Why rejected</span> : null}
                {seesCost ? <span className="w-[80px] text-right">{draft ? 'Unit cost' : 'Landed'}</span> : null}
              </div>
              {d.lines.map((l) => (
                <ReceiptRow key={l.id} line={l} draft={draft && mayPost} d={lines[String(l.id)]} onChange={(p) => setLine(String(l.id), p)} seesCost={seesCost} />
              ))}
            </div>
            {draft ? <span className="text-[11.5px] text-ink-3">Landed cost is the unit price plus this line's share of the freight and duty. That is what opens the cost layer.</span> : null}
            {error ? (
              <span role="alert" className="rounded-[8px] bg-danger-bg px-3 py-2 text-[12.5px] font-semibold text-danger">
                {error}
              </span>
            ) : null}
            {g.status === 'posted' && onReturn ? (
              <button type="button" className={btnSmall + ' self-start'} disabled={offline} title={offline ? OFFLINE_WRITE : 'Send something from this receipt back to the vendor'} onClick={() => onReturn(Number(g.id))}>
                Return goods
              </button>
            ) : null}
            {draft && mayPost ? (
              <div className="flex gap-2">
                <button type="button" className={btnPrimary + ' !h-[32px] !text-[12.5px]'} disabled={busy} onClick={() => setConfirm('post')}>
                  Post — put this stock on the shelf
                </button>
                <button type="button" className={btnSmall + ' ml-auto'} disabled={busy} onClick={() => setConfirm('discard')}>
                  Discard
                </button>
              </div>
            ) : null}
          </>
        ) : null}
      </SidePanel>
      {confirm && g ? (
        <Sheet
          title={confirm === 'post' ? `Post ${g.grn_number}?` : `Discard ${g.grn_number}?`}
          width={440}
          onClose={() => setConfirm(null)}
          footer={
            <>
              <button type="button" className={btn} onClick={() => setConfirm(null)}>
                Back
              </button>
              <button type="button" className={btnPrimary} disabled={busy} onClick={() => void (confirm === 'post' ? post() : discard())}>
                {confirm === 'post' ? 'Post' : 'Discard'}
              </button>
            </>
          }
        >
          <span className="text-[13px] text-ink-2">
            {confirm === 'post'
              ? 'What was accepted goes onto the shelf now, at its landed cost, and the order counts it as received. A posted receipt cannot be undone — only written back out by an adjustment.'
              : 'Nothing has moved. The receipt is dropped, and the order still waits for these goods.'}
          </span>
        </Sheet>
      ) : null}
    </>
  );
}

function ReceiptRow({ line, draft, d, onChange, seesCost }: { line: ReceiptLine; draft: boolean; d: ReceiptLineDraft | undefined; onChange: (p: Partial<ReceiptLineDraft>) => void; seesCost: boolean }) {
  const code = line.code ?? String(line.product_id);
  return (
    <div data-grn-line={code} className="flex flex-col gap-1 border-b border-line/60 px-3 py-1.5 text-[12.5px] last:border-b-0">
      <div className="flex items-center gap-2">
        <span className="flex min-w-0 flex-1 flex-col">
          <b className="truncate text-ink">{line.product_name}</b>
          <span className="truncate text-[11px] text-ink-3">{[line.code, !draft && line.batch_no ? `B:${line.batch_no}` : null, line.tracking !== 'none' ? line.tracking : null].filter(Boolean).join(' · ')}</span>
        </span>
        {draft && d ? (
          <>
            <input className={input + ' !h-[28px] !w-[76px] text-right tabular-nums'} value={d.accepted} onChange={(e) => onChange({ accepted: e.target.value })} aria-label={`Accepted ${code}`} />
            <input className={input + ' !h-[28px] !w-[76px] text-right tabular-nums'} value={d.rejected} placeholder="0" onChange={(e) => onChange({ rejected: e.target.value })} aria-label={`Rejected ${code}`} />
            <span className="w-[150px]">
              {Number(d.rejected) > 0 ? (
                <Select aria-label={`Why ${code} was rejected`} value={d.reason || 'other'} onValueChange={(v) => onChange({ reason: v })} options={REJECT_REASONS} className={pick + ' !h-[28px] !text-[12px]'} />
              ) : (
                <span className="text-[11.5px] text-ink-3">Only if rejecting</span>
              )}
            </span>
          </>
        ) : (
          <>
            <span className="w-[76px] text-right text-ink tabular-nums">{qty(line.quantity, line.unit)}</span>
            <span className={cx('w-[76px] text-right tabular-nums', num(line.rejected_qty) ? 'text-danger' : 'text-ink-3')}>{num(line.rejected_qty) ? qty(line.rejected_qty) : '—'}</span>
          </>
        )}
        {seesCost ? <span className="w-[80px] text-right text-ink-2 tabular-nums">{draft ? whole(line.unit_cost) : cost(line.landed_cost)}</span> : null}
      </div>
      {draft && d && line.tracking === 'batch' ? (
        <div className="flex items-center gap-2 pl-1 text-[12px] text-ink-3">
          Batch
          <input className={input + ' !h-[28px] !w-[150px]'} value={d.batch} onChange={(e) => onChange({ batch: e.target.value })} aria-label={`Batch ${code}`} />
          Expires
          <input type="date" className={input + ' !h-[28px] !w-[150px]'} value={d.expiry} onChange={(e) => onChange({ expiry: e.target.value })} aria-label={`Expiry ${code}`} />
        </div>
      ) : null}
      {draft && d && line.tracking === 'serial' ? (
        <label className="flex flex-col gap-1 pl-1 text-[12px] text-ink-3">
          Serial numbers, one per unit
          <textarea className={input + ' !h-[52px] py-1.5 font-mono'} value={d.serials} onChange={(e) => onChange({ serials: e.target.value })} aria-label={`Serials ${code}`} />
        </label>
      ) : null}
    </div>
  );
}

/** The vendor for an order, searched on the server among active vendors. */
export function VendorPick({ value, onChange }: { value: { id: number; name: string } | null; onChange: (v: { id: number; name: string } | null) => void }) {
  const [q, setQ] = useState('');
  const [needle, setNeedle] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setNeedle(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);
  const res = useQuery({ queryKey: KB.vendorSearch(needle), queryFn: ({ signal }) => searchVendors(needle, signal), staleTime: 30_000 });
  const found = res.data ?? [];
  const all = [...(value && !found.some((v) => v.id === value.id) ? [{ id: value.id, name: value.name, code: null, city: null }] : []), ...found];
  return (
    <Select<string>
      aria-label="Vendor"
      value={value ? String(value.id) : ''}
      placeholder="Choose a vendor"
      options={all.map((v) => ({ value: String(v.id), label: v.name, hint: [v.code, v.city].filter(Boolean).join(' · ') || undefined }))}
      onSearch={setQ}
      loading={res.isFetching && !found.length}
      empty={res.error ? errorMessage(res.error) : needle ? 'No active vendor matches.' : 'No vendors yet.'}
      onValueChange={(v) => {
        const hit = all.find((x) => String(x.id) === v);
        onChange(hit ? { id: hit.id, name: hit.name } : null);
      }}
      className={pick}
    />
  );
}

/** A new purchase order, or a change to a draft one (InvTradeSheet). */
export function OrderSheet({
  org,
  warehouses,
  id,
  defaultWarehouse,
  canCost,
  onClose,
  onSaved,
}: {
  org: string;
  warehouses: Warehouse[];
  id: number | null;
  defaultWarehouse?: number | null;
  canCost: boolean;
  onClose: () => void;
  onSaved: (id: number) => void;
}) {
  const existing = useQuery({ queryKey: KB.order(id ?? 0), queryFn: ({ signal }) => fetchOrder(id!, signal), enabled: !!id });
  if (id && existing.isLoading) {
    return (
      <Sheet title="Edit order" width={760} onClose={onClose} footer={null}>
        <Spinner />
      </Sheet>
    );
  }
  const d = existing.data;
  const initial: PODraft = d
    ? {
        vendor: { id: Number(d.order.vendor_id), name: d.order.vendor ?? '' },
        warehouse: Number(d.order.warehouse_id),
        currency: d.order.currency ?? '',
        rate: (() => {
          const r = num((d.order as { exchange_rate?: unknown }).exchange_rate);
          return r ? String(r) : '';
        })(),
        expected: d.order.expected_date ?? '',
        reference: d.order.reference_no ?? '',
        freight: num(d.order.freight_cost) ? String(num(d.order.freight_cost)) : '',
        insurance: num(d.order.insurance_cost) ? String(num(d.order.insurance_cost)) : '',
        duty: num(d.order.duty_cost) ? String(num(d.order.duty_cost)) : '',
        notes: d.order.notes ?? '',
        lines: d.lines.map((l, i) => ({
          key: i,
          id: Number(l.id),
          product: l.product_id ? { id: Number(l.product_id), code: l.code, name: l.product_name ?? l.description } : null,
          qty: String(num(l.quantity) ?? ''),
          cost: l.unit_cost === null ? '' : String(num(l.unit_cost) ?? ''),
        })),
      }
    : { vendor: null, warehouse: defaultWarehouse ?? null, currency: '', rate: '', expected: '', reference: '', freight: '', insurance: '', duty: '', notes: '', lines: [{ key: 0, id: null, product: null, qty: '', cost: '' }] };
  return <OrderForm org={org} warehouses={warehouses} id={id} poNumber={d?.order.po_number ?? null} initial={initial} canCost={canCost} onClose={onClose} onSaved={onSaved} />;
}

function OrderForm({
  org,
  warehouses,
  id,
  poNumber,
  initial,
  canCost,
  onClose,
  onSaved,
}: {
  org: string;
  warehouses: Warehouse[];
  id: number | null;
  poNumber: string | null;
  initial: PODraft;
  canCost: boolean;
  onClose: () => void;
  onSaved: (id: number) => void;
}) {
  const qc = useQueryClient();
  const [d, setD] = useState<PODraft>(initial);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // The server's "this looks like one already raised" (G-13): saving again with confirm_duplicate says it is meant.
  const [dupes, setDupes] = useState<Duplicate[] | null>(null);
  const offline = usePurchaseOffline();
  const setLine = (key: number, patch: Partial<POLineDraft>) => setD((x) => ({ ...x, lines: x.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)) }));
  const goods = d.lines.reduce((s, l) => s + (Number(l.qty.replace(/,/g, '')) || 0) * (Number(l.cost.replace(/,/g, '')) || 0), 0);
  const charges = [d.freight, d.insurance, d.duty].reduce((s, v) => s + (Number(v.replace(/,/g, '')) || 0), 0);

  const save = async () => {
    setError(null);
    const { body, error: bad } = orderBody(d, canCost);
    if (bad) return setError(bad);
    setSaving(true);
    try {
      const r = await saveOrder(org, id, dupes ? { ...body, confirm_duplicate: true } : body);
      refreshPurchase(qc);
      toast('success', id ? 'Order saved' : 'Draft order created');
      onSaved(Number(r.order?.id ?? id));
    } catch (e) {
      if (refusalCode(e) === 'possible_duplicate') {
        const data = (e as { data?: { duplicates?: Duplicate[] } }).data;
        setDupes(Array.isArray(data?.duplicates) ? data.duplicates : []);
        setError(refusalText(e));
      } else setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet
      title={id ? `Edit ${poNumber ?? 'order'}` : 'New purchase order'}
      width={780}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} disabled={saving || offline} title={offline ? OFFLINE_WRITE : undefined} onClick={() => void save()}>
            {saving ? 'Saving…' : dupes ? 'Save anyway' : id ? 'Save' : 'Create'}
          </button>
        </>
      }
    >
      <div role="form" aria-label={id ? 'Edit order' : 'New purchase order'} className="flex flex-col gap-2.5">
        <div className="grid grid-cols-2 gap-2.5">
          <Field label="Vendor">
            <VendorPick value={d.vendor} onChange={(v) => setD({ ...d, vendor: v })} />
          </Field>
          <Field label="Deliver to">
            <WarehousePick warehouses={warehouses} value={d.warehouse} onChange={(w) => setD({ ...d, warehouse: w })} label="Deliver to" />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          <Field label="Currency" hint="Blank: the company's own">
            <input className={input + ' uppercase'} value={d.currency ?? ''} onChange={(e) => setD({ ...d, currency: e.target.value.toUpperCase().slice(0, 3) })} aria-label="Currency" placeholder="LKR" maxLength={3} />
          </Field>
          <Field label="Exchange rate" hint="Blank: Finance's rate for the day">
            <input className={input + ' text-right tabular-nums'} value={d.rate ?? ''} onChange={(e) => setD({ ...d, rate: e.target.value })} aria-label="Exchange rate" inputMode="decimal" disabled={!d.currency} placeholder={d.currency ? 'Finance rate' : '—'} />
          </Field>
        </div>
        <div className="grid grid-cols-5 gap-2.5">
          <Field label="Expected" hint="What the vendor said">
            <input type="date" className={input} value={d.expected} onChange={(e) => setD({ ...d, expected: e.target.value })} aria-label="Expected" />
          </Field>
          <Field label="Our reference">
            <input className={input} value={d.reference} onChange={(e) => setD({ ...d, reference: e.target.value })} aria-label="Our reference" maxLength={60} />
          </Field>
          <Field label="Freight">
            <input className={input + ' text-right tabular-nums'} value={d.freight} onChange={(e) => setD({ ...d, freight: e.target.value })} aria-label="Freight" inputMode="decimal" placeholder="0.00" />
          </Field>
          <Field label="Insurance">
            <input className={input + ' text-right tabular-nums'} value={d.insurance} onChange={(e) => setD({ ...d, insurance: e.target.value })} aria-label="Insurance" inputMode="decimal" placeholder="0.00" />
          </Field>
          <Field label="Duty">
            <input className={input + ' text-right tabular-nums'} value={d.duty} onChange={(e) => setD({ ...d, duty: e.target.value })} aria-label="Duty" inputMode="decimal" placeholder="0.00" />
          </Field>
        </div>
        <b className="mt-1 text-[13px] text-ink">Products</b>
        <div className="flex flex-col gap-2">
          {d.lines.map((l, i) => (
            <div key={l.key} className="flex items-center gap-2">
              <span className="min-w-0 flex-1">
                <ProductPick
                  org={org}
                  warehouse={d.warehouse}
                  value={l.product ? { id: l.product.id, code: l.product.code, barcode: null, name: l.product.name, variant_label: l.product.variant_label ?? null, unit: null, tracking: 'none', is_stocked: 1, on_hand: 0, reserved: 0 } : null}
                  onChange={(p) => setLine(l.key, { product: p ? { id: p.id, code: p.code, name: p.name, variant_label: p.variant_label } : null })}
                  label={`Line ${i + 1} product`}
                />
              </span>
              <input className={input + ' !w-[80px] text-right tabular-nums'} value={l.qty} onChange={(e) => setLine(l.key, { qty: e.target.value })} placeholder="Qty" aria-label={`Line ${i + 1} quantity`} />
              {canCost ? <input className={input + ' !w-[110px] text-right tabular-nums'} value={l.cost} onChange={(e) => setLine(l.key, { cost: e.target.value })} placeholder="Catalogue" aria-label={`Line ${i + 1} unit cost`} /> : null}
              <button
                type="button"
                aria-label={`Remove line ${i + 1}`}
                onClick={() => setD((x) => ({ ...x, lines: x.lines.length > 1 ? x.lines.filter((y) => y.key !== l.key) : [{ key: l.key + 1, id: null, product: null, qty: '', cost: '' }] }))}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] text-ink-3 hover:bg-subtle hover:text-ink"
              >
                <Icon name="x" size={14} />
              </button>
            </div>
          ))}
          <button
            type="button"
            className="self-start text-[12.5px] font-semibold text-primary hover:underline"
            onClick={() => setD((x) => ({ ...x, lines: [...x.lines, { key: Math.max(...x.lines.map((y) => y.key)) + 1, id: null, product: null, qty: '', cost: '' }] }))}
          >
            + Add a line
          </button>
        </div>
        {canCost ? (
          <span className="text-[12.5px] text-ink-2">
            Goods {goods.toLocaleString(undefined, { maximumFractionDigits: 2 })}
            {charges ? ` · freight, insurance and duty ${charges.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : ''} — the server adds tax and works out the total. A blank unit cost takes the catalogue's.
          </span>
        ) : (
          <span className="text-[12.5px] text-ink-3">Unit costs come from the catalogue, and a line you change keeps its own. Only people who can see costs set them.</span>
        )}
        <Field label="Internal notes" hint="Never printed and never shown to the vendor">
          <input className={input} value={d.notes} onChange={(e) => setD({ ...d, notes: e.target.value })} aria-label="Internal notes" />
        </Field>
        {error ? (
          <span role="alert" className="rounded-[8px] bg-danger-bg px-3 py-2 text-[12.5px] font-semibold text-danger">
            {error}
          </span>
        ) : null}
        {dupes?.length ? (
          <div className="flex flex-col rounded-[10px] border border-warning-line bg-warning-bg px-3 py-2 text-[12.5px] dark:border-warning/40 dark:bg-warning-bg" aria-label="Possible duplicates">
            <b className="text-ink">Possible duplicates</b>
            {dupes.map((x) => (
              <span key={x.id} className="flex gap-2 text-ink-2">
                <b className="text-ink">{x.number}</b>
                <span className="min-w-0 flex-1 truncate">{[x.vendor, x.date ? dateLabel(x.date) : null, Array.isArray(x.why) ? x.why.join(', ') : x.why].filter(Boolean).join(' · ')}</span>
                <span className="tabular-nums">{whole(x.total)}</span>
              </span>
            ))}
          </div>
        ) : null}
        {offline ? <span className="text-[12px] text-ink-3">{OFFLINE_WRITE}</span> : null}
      </div>
    </Sheet>
  );
}

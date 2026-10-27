import { keepPreviousData, useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { apiPost } from '../../core/api';
import { errorMessage } from '../../core/bridge';
import { dateLabel, todayInZone } from '../../core/time';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { btn, btnPrimary, Empty, Field, input, Sheet, SidePanel } from '../hr/parts';
import { qty, short, whole } from '../inventory/api';
import { Pill } from '../inventory/parts';
import { pick } from '../inventory/pickers';
import { BILL_LABEL, billTone, fetchBill, fetchBills, fetchPayables, KP, OFFLINE_WRITE, refreshPurchase, usePurchaseCan, usePurchaseOffline, type Bill } from './api';
import { approvalOf } from './chain';
import { fetchOrders } from './buying';
import { Chain, DecisionBar, Frame, Head, rowCls } from './parts';

/**
 * Vendor bills (S-08; the "Vendor bills" design): what is owed by age — per currency, with a total in the company's own
 * where the server gives one (G-02) — and the bills, each with how it matches its order (three-way), its approval
 * chain (submit, approve, or reject as disputed with a reason) and its payments. A bill is entered against an order
 * that has goods received; its lines come from what was received and not yet billed.
 */
const STATUSES = [{ value: '', label: 'Every state' }, ...['draft', 'submitted', 'approved', 'part_paid', 'paid', 'disputed'].map((s) => ({ value: s, label: BILL_LABEL[s] ?? s }))];

export default function Bills({ org, currency, openId, initialStatus, onOpen, onOrder }: { org: string; currency: string | null; openId: number | null; initialStatus?: string | null; onOpen: (id: number | null) => void; onOrder: (id: number) => void }) {
  const c = usePurchaseCan();
  const offline = usePurchaseOffline();
  const [status, setStatus] = useState(initialStatus ?? '');
  const [entering, setEntering] = useState(false);
  const list = useInfiniteQuery({
    queryKey: KP.bills(org, { status }),
    initialPageParam: 1,
    queryFn: ({ pageParam, signal }) => fetchBills(org, { status, page: pageParam }, signal),
    getNextPageParam: (last, pages) => (pages.length * 50 < last.total ? pages.length + 1 : undefined),
    placeholderData: keepPreviousData,
  });
  const ageing = useQuery({ queryKey: KP.payables(org), queryFn: ({ signal }) => fetchPayables(org, signal) });
  const rows = useMemo(() => (list.data?.pages ?? []).flatMap((p) => p.rows), [list.data]);
  const today = todayInZone();
  const a = ageing.data;
  return (
    <div className="flex h-full min-h-0 flex-col gap-3 px-6 py-5">
      <Head title="Vendor bills" sub="What we owe, and the bills behind it">
        {c.bill ? (
          <button type="button" className={btnPrimary} disabled={offline} title={offline ? OFFLINE_WRITE : undefined} onClick={() => setEntering(true)}>
            <Icon name="plus" size={15} /> Enter a vendor bill
          </button>
        ) : null}
      </Head>
      {a ? (
        <section className="flex flex-col gap-2" aria-label="Money owed by age">
          {(a.currencies?.length ? a.currencies : [{ currency: currency ?? '', buckets: a.buckets, total: a.total, base_total: null }]).map((cur) => (
            <div key={cur.currency || 'base'} className="grid grid-cols-2 gap-2 md:grid-cols-6">
              <div className="flex flex-col rounded-[10px] border border-line bg-surface px-3 py-2">
                <span className="text-[11.5px] font-semibold text-ink-3">Owed{cur.currency ? ` · ${cur.currency}` : ''}</span>
                <b className="text-[15px] text-ink tabular-nums">{short(cur.total, cur.currency || null)}</b>
                {cur.base_total !== null && cur.base_total !== undefined && a.base_currency && cur.currency !== a.base_currency ? <span className="text-[11px] text-ink-3">{short(cur.base_total, a.base_currency)}</span> : null}
              </div>
              {Object.entries(cur.buckets).map(([k, b]) => (
                <div key={k} className="flex flex-col rounded-[10px] border border-line bg-surface px-3 py-2">
                  <span className="text-[11.5px] font-semibold text-ink-3">{b.label}</span>
                  <b className={cx('text-[15px] tabular-nums', k === 'current' || !b.amount ? 'text-ink' : 'text-danger')}>{short(b.amount, null)}</b>
                  <span className="text-[11px] text-ink-3">
                    {b.count} {b.count === 1 ? 'bill' : 'bills'}
                  </span>
                </div>
              ))}
            </div>
          ))}
          {a.currencies?.length && a.base_total !== null && a.base_total !== undefined ? <span className="text-[12px] text-ink-2">In all, {whole(a.base_total, a.base_currency ?? currency)} at today's rates.</span> : null}
        </section>
      ) : null}
      <div className="flex items-center gap-2">
        <Select aria-label="Bill status" value={status} onValueChange={setStatus} options={STATUSES} className={pick + ' !w-[180px]'} />
        <span className="ml-auto text-[12.5px] text-ink-3">{list.isLoading ? '' : `${(list.data?.pages[0]?.total ?? 0).toLocaleString()} bills`}</span>
      </div>
      <Frame
        min={900}
        head={
          <>
            <span className="min-w-0 flex-1">Bill</span>
            <span className="w-[170px]">Vendor</span>
            <span className="w-[120px]">Match</span>
            <span className="w-[130px]">Status</span>
            <span className="w-[90px]">Due</span>
            <span className="w-[120px] text-right">Outstanding</span>
          </>
        }
        more={
          list.hasNextPage ? (
            <div className="flex shrink-0 justify-center border-t border-line px-3.5 py-2 text-[12px]">
              <button type="button" className="font-semibold text-primary hover:underline" onClick={() => void list.fetchNextPage()}>
                Load more
              </button>
            </div>
          ) : null
        }
      >
        {list.isLoading ? (
          <Spinner />
        ) : list.error ? (
          <ErrorNote error={list.error} onRetry={() => void list.refetch()} />
        ) : rows.length ? (
          rows.map((b: Bill) => {
            const out = b.outstanding ?? (b.total !== null ? Number(b.total) - Number(b.paid_total ?? 0) : null);
            const overdue = !!b.due_date && b.due_date < today && (out ?? 0) > 0;
            return (
              <button key={b.id} type="button" data-bill={b.id} onClick={() => onOpen(b.id)} className={cx(rowCls, openId === b.id && 'bg-info-soft dark:bg-selection/40')}>
                <span className="flex min-w-0 flex-1 flex-col">
                  <b className="truncate text-ink">{b.bill_number}</b>
                  <span className="truncate text-[11.5px] text-ink-3">{[b.vendor_invoice_no, b.po_number].filter(Boolean).join(' · ') || 'No order'}</span>
                </span>
                <span className="w-[170px] truncate text-ink">{b.vendor ?? '—'}</span>
                <span className="w-[120px] truncate text-ink-2">{b.match_state ?? (b.po_id ? '3-way' : 'No PO')}</span>
                <span className="w-[130px]">
                  <Pill tone={billTone(b.status)}>{BILL_LABEL[b.status] ?? b.status}</Pill>
                </span>
                <span className={cx('w-[90px]', overdue ? 'font-bold text-danger' : 'text-ink-2')}>{b.due_date ? dateLabel(b.due_date) : '—'}</span>
                <b className="w-[120px] text-right text-ink tabular-nums">{whole(out, b.currency !== currency ? b.currency : null)}</b>
              </button>
            );
          })
        ) : (
          <Empty text={status ? 'No bill matches.' : 'No vendor bills yet.'} />
        )}
      </Frame>
      {openId ? <BillPanel key={openId} id={openId} currency={currency} onClose={() => onOpen(null)} onOrder={onOrder} /> : null}
      {entering ? <EnterBill org={org} onClose={() => setEntering(false)} onSaved={(id) => (setEntering(false), onOpen(id))} /> : null}
    </div>
  );
}

function BillPanel({ id, currency, onClose, onOrder }: { id: number; currency: string | null; onClose: () => void; onOrder: (id: number) => void }) {
  const c = usePurchaseCan();
  const offline = usePurchaseOffline();
  const q = useQuery({ queryKey: KP.bill(id), queryFn: ({ signal }) => fetchBill(id, signal) });
  const d = q.data;
  const b = d?.bill;
  const a = approvalOf(d, c.approve || c.pay);
  const cur = b?.currency ?? currency;
  return (
    <SidePanel
      label={b ? `Bill ${b.bill_number}` : 'Bill'}
      width={640}
      onClose={onClose}
      head={
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex items-center gap-2">
            <b className="truncate text-[15px] text-ink">{b?.bill_number ?? 'Bill'}</b>
            {b ? <Pill tone={billTone(b.status)}>{BILL_LABEL[b.status] ?? b.status}</Pill> : null}
          </span>
          {b ? <span className="truncate text-[12.5px] text-ink-3">{[b.vendor, b.vendor_invoice_no ? `their ${b.vendor_invoice_no}` : null].filter(Boolean).join(' · ')}</span> : null}
        </span>
      }
    >
      {q.isLoading ? (
        <Spinner />
      ) : q.error ? (
        <ErrorNote error={q.error} onRetry={() => void q.refetch()} />
      ) : b && d ? (
        <>
          <span className="text-[12.5px] text-ink-2">
            {[b.bill_date ? `dated ${dateLabel(b.bill_date)}` : null, b.due_date ? `due ${dateLabel(b.due_date)}` : null, `total ${whole(b.total, cur)}`, `paid ${whole(b.paid_total ?? 0, cur)}`].filter(Boolean).join(' · ')}
            {b.po_id && b.po_number ? (
              <>
                {' · against '}
                <button type="button" className="text-primary hover:underline" onClick={() => onOrder(b.po_id!)}>
                  {b.po_number}
                </button>
              </>
            ) : null}
          </span>
          {b.dispute_note ? <span className="rounded-[8px] bg-danger-bg px-3 py-2 text-[12.5px] font-semibold text-danger">Disputed: {b.dispute_note}</span> : null}
          <div className="overflow-hidden rounded-[10px] border border-line">
            <div className="flex gap-2 border-b border-line bg-ground px-3 py-1.5 text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase">
              <span className="min-w-0 flex-1">Line</span>
              <span className="w-[56px] text-right">Ord</span>
              <span className="w-[56px] text-right">Rec</span>
              <span className="w-[56px] text-right">Billed</span>
              <span className="w-[96px] text-right">Total</span>
            </div>
            {d.lines.map((l) => (
              <div key={l.id} className="flex items-center gap-2 border-b border-line/60 px-3 py-1.5 text-[12.5px] last:border-b-0">
                <span className="min-w-0 flex-1 truncate text-ink">{l.description}</span>
                <span className="w-[56px] text-right text-ink-2 tabular-nums">{l.ordered_qty !== undefined ? qty(l.ordered_qty) : '—'}</span>
                <span className="w-[56px] text-right text-ink-2 tabular-nums">{l.received_qty !== undefined ? qty(l.received_qty) : '—'}</span>
                <span className={cx('w-[56px] text-right tabular-nums', l.received_qty !== undefined && Number(l.quantity) > Number(l.received_qty) ? 'font-bold text-danger' : 'text-ink')}>{qty(l.quantity)}</span>
                <span className="w-[96px] text-right text-ink tabular-nums">{whole(l.line_total)}</span>
              </div>
            ))}
          </div>
          <section className="flex flex-col gap-1.5">
            <b className="text-[13px] text-ink">Approvals</b>
            <Chain a={a} />
            <DecisionBar doc="bill" id={id} a={a} status={b.status} raise={c.bill} approve={c.approve || c.pay} offline={offline} />
          </section>
          {d.payments?.length ? (
            <section className="flex flex-col gap-1">
              <b className="text-[13px] text-ink">Payments set against it</b>
              {d.payments.map((p) => (
                <span key={p.id} className="flex gap-2 border-b border-line/60 py-1 text-[12.5px] last:border-b-0">
                  <b className="text-ink">{p.reference}</b>
                  <span className="flex-1 text-ink-3">
                    {dateLabel(p.paid_on)} · {p.method}
                  </span>
                  <span className="text-ink tabular-nums">{whole(p.amount, cur)}</span>
                </span>
              ))}
            </section>
          ) : null}
        </>
      ) : null}
    </SidePanel>
  );
}

/** A bill against an order with goods received: its lines are what was received and not billed yet. */
function EnterBill({ org, onClose, onSaved }: { org: string; onClose: () => void; onSaved: (id: number) => void }) {
  const qc = useQueryClient();
  const [poQ, setPoQ] = useState('');
  const [po, setPo] = useState('');
  const [invoice, setInvoice] = useState('');
  const [billDate, setBillDate] = useState(todayInZone());
  const [due, setDue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const orders = useQuery({ queryKey: ['purchase', 'billable', org, poQ], queryFn: ({ signal }) => fetchOrders(org, null, { status: '', q: poQ, page: 1 }, signal).then((r) => r.rows.filter((o) => ['partial', 'received', 'billed', 'closed'].includes(o.status))) });
  const save = async () => {
    setError(null);
    if (!po) return setError('Choose the order the bill is for.');
    if (!invoice.trim()) return setError('Give the vendor’s invoice number.');
    setSaving(true);
    try {
      const r = await apiPost<{ id?: number; bill?: { id: number } }>('/api/inventory/bills', { po_id: Number(po), vendor_invoice_no: invoice.trim(), bill_date: billDate || null, due_date: due || null });
      refreshPurchase(qc);
      toast('success', 'Bill entered — check it, then submit it');
      onSaved(Number(r.bill?.id ?? r.id));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Sheet
      title="Enter a vendor bill"
      width={520}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} disabled={saving} onClick={() => void save()}>
            {saving ? 'Saving…' : 'Enter the bill'}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-2.5">
        <Field label="Against order">
          <Select<string>
            aria-label="Against order"
            value={po}
            placeholder="Choose an order with goods received"
            options={(orders.data ?? []).map((o) => ({ value: String(o.id), label: o.po_number, hint: o.vendor ?? undefined }))}
            onSearch={setPoQ}
            loading={orders.isFetching}
            empty="No order with goods to bill."
            onValueChange={setPo}
            className={pick}
          />
        </Field>
        <div className="grid grid-cols-3 gap-2.5">
          <Field label="Their invoice">
            <input className={input} value={invoice} onChange={(e) => setInvoice(e.target.value)} aria-label="Their invoice" maxLength={60} />
          </Field>
          <Field label="Dated">
            <input type="date" className={input} value={billDate} onChange={(e) => setBillDate(e.target.value)} aria-label="Bill date" />
          </Field>
          <Field label="Due" hint="Blank: from the terms">
            <input type="date" className={input} value={due} onChange={(e) => setDue(e.target.value)} aria-label="Due date" />
          </Field>
        </div>
        {error ? (
          <span role="alert" className="rounded-[8px] bg-danger-bg px-3 py-2 text-[12.5px] font-semibold text-danger">
            {error}
          </span>
        ) : null}
      </div>
    </Sheet>
  );
}

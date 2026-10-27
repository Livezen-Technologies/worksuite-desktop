import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useReducer, useRef, useState } from 'react';
import { toast } from '../../core/toasts';
import { Select } from '../../components/Select';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { btnPrimary, btnSmall, Empty, input } from '../../components/PageKit';
import { num, qty } from '../inventory/api';
import { pick } from '../inventory/pickers';
import { fetchOrderFull, OFFLINE_WRITE, refreshPurchase, usePurchaseCan, usePurchaseOffline } from './api';
import { approvalOf, refusalText } from './chain';
import { fetchOrders, fetchReceipt, KB, orderAct, postReceipt, REJECT_REASONS, type PurchaseOrder } from './buying';
import { Head } from './parts';
import { PoChip } from './Purchasing';
import { EMPTY, isOrderCode, lineDone, postLines, rcvReducer, receiveBody, totals, type RcvLine } from './scan';
import { clickOnKey } from '../../components/press';

/**
 * Receiving by scan (S-06; the "Desktop receiving" design; SRS-PUR-001 G-21, G-07). One box takes every scan — the
 * order's number, each item, each unit's serial — and the lines below count what came. F2 turns the last one counted
 * away as damaged; F3 puts the line on quality hold (into QC until tested). ⌘/Ctrl+Enter posts it to stock; Save draft
 * hands it to the receipt editor to finish later. Scanning another order's number while this one is open is refused.
 */
const RECEIVABLE = ['approved', 'sent', 'acknowledged', 'partial'];
const now = () => new Date().toTimeString().slice(0, 8);

export default function Receive({ org, orderId, onOrder, onReceipt, onOpenOrder }: { org: string; orderId: number | null; onOrder: (id: number | null) => void; onReceipt: (id: number) => void; onOpenOrder: (id: number) => void }) {
  const qc = useQueryClient();
  const c = usePurchaseCan();
  const offline = usePurchaseOffline();
  const [s, dispatch] = useReducer(rcvReducer, EMPTY);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ id: number; number: string | null } | null>(null);
  const scanRef = useRef<HTMLInputElement>(null);
  const order = useQuery({ queryKey: KB.order(orderId ?? 0), queryFn: ({ signal }) => fetchOrderFull(orderId!, signal), enabled: !!orderId });
  const waiting = useQuery({
    queryKey: ['purchase', 'receivable', org],
    enabled: !orderId,
    queryFn: async ({ signal }) => (await Promise.all(RECEIVABLE.map((st) => fetchOrders(org, null, { status: st, q: '', page: 1 }, signal)))).flatMap((r) => r.rows),
  });
  const d = order.data;
  const chain = approvalOf(d, c.approve);
  const drafts = (d?.receipts ?? []).filter((g) => g.status === 'draft');

  // The order arrives: its lines become the checklist — not again on a refetch once something has been counted.
  const counting = s.lines.some((l) => l.accepted > 0 || l.rejected > 0);
  useEffect(() => {
    if (!d || counting) return;
    dispatch({
      type: 'order',
      order: { id: Number(d.order.id), number: d.order.po_number, vendor: d.order.vendor, warehouse: d.order.warehouse },
      lines: d.lines
        .filter((l) => l.product_id)
        .map((l) => ({
          lineId: Number(l.id),
          code: l.code,
          barcode: (l as { barcode?: string | null }).barcode ?? null,
          name: l.product_name ?? l.description,
          unit: l.unit,
          tracking: l.tracking === 'serial' || l.tracking === 'batch' ? l.tracking : 'none',
          bin: (l as { bin?: string | null }).bin ?? null,
          expected: Math.max(0, (num(l.quantity) ?? 0) - (num(l.received_qty) ?? 0)),
        })),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d]);
  useEffect(() => {
    scanRef.current?.focus();
  }, [orderId, d]);

  const scan = async (raw: string) => {
    const text = raw.trim();
    setCode('');
    if (!text) return;
    if (s.order) return dispatch({ type: 'scan', code: text, at: now() });
    // No order open yet: the scan names one.
    const near = (waiting.data ?? []).find((o) => o.po_number.toLowerCase() === text.toLowerCase());
    if (near) return onOrder(Number(near.id));
    try {
      const found = (await fetchOrders(org, null, { status: '', q: text, page: 1 })).rows.find((o) => o.po_number.toLowerCase() === text.toLowerCase());
      if (!found) return dispatch({ type: 'message', ok: false, text: isOrderCode(text) ? `No order ${text} is waiting to be received.` : 'Scan the purchase order first — its number is on the delivery note or the order.' });
      if (!RECEIVABLE.includes(found.status)) return dispatch({ type: 'message', ok: false, text: `${found.po_number} is ${found.status === 'pending' || found.status === 'draft' ? 'not approved yet' : found.status}; nothing can be received against it.` });
      onOrder(Number(found.id));
    } catch (e) {
      dispatch({ type: 'message', ok: false, text: refusalText(e) });
    }
  };

  const mayPost = c.receive && !offline && !!s.order && chain.status !== 'pending';
  const post = async () => {
    if (!s.order || !mayPost || busy) return;
    const b = receiveBody(s);
    if (b.error) return dispatch({ type: 'message', ok: false, text: b.error });
    setBusy(true);
    let gid: number | null = null;
    try {
      const made = await orderAct(s.order.id, 'receive', { delivery_note_no: b.delivery_note_no, lines: b.lines });
      gid = Number(made.id);
      const rec = await fetchReceipt(gid);
      const r = await postReceipt(gid, { delivery_note_no: b.delivery_note_no, lines: postLines(b.lines, rec.lines) });
      const held = totals(s).held;
      toast(r.over_received?.length ? 'warning' : 'success', `${rec.receipt.grn_number} posted — the stock is in${held ? `, ${held} on quality hold` : ''}.`);
      setDone({ id: gid, number: rec.receipt.grn_number });
      dispatch({ type: 'reset' });
    } catch (e) {
      dispatch({ type: 'message', ok: false, text: gid ? `The receipt was saved as a draft but not posted: ${refusalText(e)} Open it from Goods received.` : refusalText(e) });
    } finally {
      setBusy(false);
      refreshPurchase(qc);
    }
  };
  const saveDraft = async () => {
    if (!s.order || !mayPost || busy) return;
    const b = receiveBody(s);
    if (b.error) return dispatch({ type: 'message', ok: false, text: b.error });
    setBusy(true);
    try {
      const made = await orderAct(s.order.id, 'receive', { delivery_note_no: b.delivery_note_no, lines: b.lines });
      toast('success', 'Draft receipt saved — check it, then post it');
      refreshPurchase(qc);
      onReceipt(Number(made.id));
    } catch (e) {
      dispatch({ type: 'message', ok: false, text: refusalText(e) });
    } finally {
      setBusy(false);
    }
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'F2') {
      e.preventDefault();
      dispatch({ type: 'damaged', at: now() });
    } else if (e.key === 'F3') {
      e.preventDefault();
      dispatch({ type: 'hold', at: now() });
    } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void post();
    }
  };
  const t = totals(s);
  const head = s.order ?? (d ? { number: d.order.po_number, vendor: d.order.vendor, warehouse: d.order.warehouse } : null);

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 px-6 py-5" onKeyDown={onKey}>
      <Head
        title={head ? `Receiving ${head.number}` : 'Receive goods'}
        sub={head ? [head.vendor, head.warehouse, s.delivery ? `delivery note ${s.delivery}` : null].filter(Boolean).join(' · ') : 'Scan the purchase order, then each item as it comes off the delivery.'}
      >
        {s.order ? (
          <>
            <button type="button" className={btnSmall} onClick={() => onOpenOrder(s.order!.id)}>
              Open order
            </button>
            <button type="button" className={btnSmall} onClick={() => onOrder(null)}>
              Another order
            </button>
            <button type="button" className={btnSmall} disabled={!mayPost || busy} title={offline ? OFFLINE_WRITE : undefined} onClick={() => void saveDraft()}>
              Save draft
            </button>
            <button type="button" className={btnPrimary} disabled={!mayPost || busy} title={offline ? OFFLINE_WRITE : 'Post to stock (⌘/Ctrl+Enter)'} onClick={() => void post()}>
              {busy ? 'Posting…' : 'Post to stock ⌘↵'}
            </button>
          </>
        ) : null}
      </Head>

      <div className="flex min-h-[64px] items-center gap-3.5 rounded-[10px] bg-navy px-[18px] py-2 text-white">
        <input
          ref={scanRef}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) {
              e.preventDefault();
              void scan(code);
            }
          }}
          placeholder={s.order ? 'Scan an item or a serial' : 'Scan the purchase order'}
          aria-label={s.order ? 'Scan an item or a serial' : 'Scan the purchase order'}
          className="h-9 w-[260px] rounded-[8px] border border-white/20 bg-white/10 px-3 text-[14px] text-white placeholder:text-navy-ink outline-none focus:border-stage-primary-2"
          autoComplete="off"
          spellCheck={false}
        />
        <div className="flex min-w-0 flex-1 flex-col" role="status" aria-live="polite">
          <span className={cx('truncate text-[15px] font-semibold', s.message && !s.message.ok && 'text-stage-danger')}>{s.message?.text ?? (s.order ? 'Ready — scan the first item.' : 'Ready for a scan.')}</span>
          {s.order ? <span className="text-[12px] text-navy-ink">{`${t.accepted + t.rejected} of ${t.expected} counted${t.rejected ? ` · ${t.rejected} turned away` : ''}${t.held ? ` · ${t.held} on hold` : ''}`}</span> : null}
        </div>
        <span className="hidden text-[13px] text-navy-ink md:inline">F2 mark damaged · F3 quality hold</span>
      </div>

      {orderId && order.isLoading ? <Spinner /> : null}
      {orderId && order.error ? <ErrorNote error={order.error} onRetry={() => void order.refetch()} /> : null}
      {d && chain.status === 'pending' ? <span className="rounded-[8px] bg-warning-bg px-3 py-2 text-[12.5px] font-semibold text-warning-ink">{d.order.po_number} is still waiting on approval; it cannot be received yet.</span> : null}
      {drafts.length ? (
        <span className="rounded-[8px] bg-subtle px-3 py-2 text-[12.5px] text-ink-2">
          {drafts.map((g) => g.grn_number).join(', ')} {drafts.length === 1 ? 'is a draft receipt' : 'are draft receipts'} on this order, not yet posted.{' '}
          <button type="button" className="font-semibold text-primary hover:underline" onClick={() => onReceipt(Number(drafts[0]!.id))}>
            Open {drafts.length === 1 ? 'it' : 'the first'}
          </button>{' '}
          rather than counting the goods twice.
        </span>
      ) : null}
      {offline ? <span className="text-[12.5px] text-ink-3">{OFFLINE_WRITE}</span> : null}
      {done ? (
        <span className="rounded-[8px] bg-success-bg px-3 py-2 text-[12.5px] font-semibold text-success-ink">
          {done.number ?? 'The receipt'} is posted.{' '}
          <button type="button" className="text-primary hover:underline" onClick={() => onReceipt(done.id)}>
            Open it
          </button>
        </span>
      ) : null}

      {s.order ? (
        <>
          <label className="flex items-center gap-2 text-[12.5px] text-ink-2">
            Delivery note
            <input className={input + ' !h-[30px] !w-[200px]'} value={s.delivery} onChange={(e) => dispatch({ type: 'delivery', text: e.target.value })} aria-label="Delivery note" maxLength={60} />
          </label>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3" aria-label="Lines to receive">
            {s.lines.map((l) => (
              <LineCard key={l.lineId} l={l} active={s.active === l.lineId} onFocus={() => dispatch({ type: 'focus', lineId: l.lineId })} onSet={(patch) => dispatch({ type: 'set', lineId: l.lineId, patch })} />
            ))}
          </div>
          <section className="flex flex-col gap-1" aria-label="Scan log">
            <b className="text-[13px] text-ink">Scan log</b>
            {s.log.length ? (
              <div className="flex flex-col overflow-hidden rounded-[10px] border border-line bg-surface">
                {s.log.map((x, i) => (
                  <span key={`${x.at}-${i}`} className="flex gap-3 border-b border-line/60 px-3 py-1 text-[12.5px] last:border-b-0">
                    <span className="w-[64px] text-ink-3 tabular-nums">{x.at}</span>
                    <span className="w-[140px] truncate font-mono text-ink">{x.code}</span>
                    <span className="min-w-0 flex-1 truncate text-ink-2">{x.name ?? ''}</span>
                    <span className={cx('shrink-0', x.outcome === 'refused' || x.outcome === 'rejected' ? 'text-danger' : x.outcome === 'held' ? 'text-warning-ink dark:text-warning' : 'text-success-ink dark:text-success')}>{x.outcome === 'refused' ? 'refused' : x.text}</span>
                  </span>
                ))}
              </div>
            ) : (
              <span className="text-[12px] text-ink-3">Nothing scanned yet.</span>
            )}
          </section>
        </>
      ) : !orderId ? (
        <section className="flex flex-col gap-2" aria-label="Waiting to be received">
          <b className="text-[13px] text-ink">Waiting to be received</b>
          {waiting.isLoading ? <Spinner /> : waiting.error ? <ErrorNote error={waiting.error} onRetry={() => void waiting.refetch()} /> : null}
          {!waiting.isLoading && !(waiting.data ?? []).length ? <Empty text="No approved order is waiting for goods." /> : null}
          <div className="flex flex-col overflow-hidden rounded-[10px] border border-line bg-surface">
            {(waiting.data ?? []).map((o: PurchaseOrder) => (
              <button key={o.id} type="button" onClick={() => onOrder(Number(o.id))} className="flex items-center gap-3 border-b border-line/60 px-3.5 py-2 text-left text-[12.5px] last:border-b-0 hover:bg-subtle">
                <b className="w-[120px] text-ink">{o.po_number}</b>
                <span className="min-w-0 flex-1 truncate text-ink">{o.vendor}</span>
                <span className="w-[130px] truncate text-ink-2">{o.warehouse}</span>
                <span className="w-[110px] text-right text-ink-2 tabular-nums">{num(o.outstanding_qty) ? `${qty(o.outstanding_qty)} to come` : ''}</span>
                <PoChip status={o.status} />
              </button>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function LineCard({ l, active, onFocus, onSet }: { l: RcvLine; active: boolean; onFocus: () => void; onSet: (p: Partial<Pick<RcvLine, 'accepted' | 'rejected' | 'reason' | 'hold' | 'batch'>>) => void }) {
  const counted = l.accepted + l.rejected;
  const complete = lineDone(l);
  const pct = l.expected ? Math.min(100, (counted / l.expected) * 100) : 100;
  const state = l.hold ? 'quality hold' : complete ? 'complete' : active ? 'scanning' : '';
  return (
    <div data-line={l.lineId} role="button" tabIndex={0} aria-pressed={active} onKeyDown={clickOnKey} onClick={onFocus} className={cx('flex flex-col gap-1 rounded-[10px] bg-surface p-3.5', active ? 'border-2 border-primary' : 'border border-line')}>
      <div className="flex items-center gap-2">
        <b className="min-w-0 flex-1 truncate text-ink">{l.name}</b>
        <span className={cx('text-[12px]', l.hold ? 'text-warning-ink dark:text-warning' : complete ? 'text-success-ink dark:text-success' : 'text-primary dark:text-primary')}>{state}</span>
      </div>
      <span className="truncate text-[12px] text-ink-3">{[l.code, l.bin ? `bin ${l.bin}` : null, l.tracking !== 'none' ? l.tracking : null].filter(Boolean).join(' · ')}</span>
      <span className="mt-1 text-[28px] font-semibold text-ink tabular-nums">
        {counted} <span className="text-[15px] text-ink-3">/ {qty(l.expected, l.unit)}</span>
      </span>
      <span className="h-2 rounded-full bg-subtle">
        <span className={cx('block h-2 rounded-full', l.hold ? 'bg-badge' : 'bg-stage-primary')} style={{ width: `${pct}%` }} />
      </span>
      {l.rejected ? <span className="text-[12px] text-danger">{l.rejected} rejected · {REJECT_REASONS.find((r) => r.value === l.reason)?.label.toLowerCase() ?? l.reason}</span> : null}
      {l.hold ? <span className="text-[12px] text-warning-ink dark:text-warning">Into QC hold until tested</span> : null}
      {active ? (
        <div role="presentation" className="mt-1 flex flex-wrap items-center gap-1.5 text-[12px] text-ink-2" onClick={(e) => e.stopPropagation()}>
          <label className="flex items-center gap-1">
            Kept
            <input className={input + ' !h-[26px] !w-[56px] text-right tabular-nums'} value={String(l.accepted)} onChange={(e) => onSet({ accepted: Number(e.target.value) || 0 })} aria-label={`Kept ${l.code ?? l.name}`} disabled={l.tracking === 'serial'} />
          </label>
          <label className="flex items-center gap-1">
            Rejected
            <input className={input + ' !h-[26px] !w-[56px] text-right tabular-nums'} value={String(l.rejected)} onChange={(e) => onSet({ rejected: Number(e.target.value) || 0 })} aria-label={`Rejected ${l.code ?? l.name}`} />
          </label>
          {l.rejected > 0 ? <Select aria-label={`Why ${l.code ?? l.name} was rejected`} value={l.reason || 'other'} onValueChange={(v) => onSet({ reason: v })} options={REJECT_REASONS} className={pick + ' !h-[26px] !w-[150px] !text-[12px]'} /> : null}
          {l.tracking === 'batch' ? <input className={input + ' !h-[26px] !w-[120px]'} value={l.batch} placeholder="Batch" onChange={(e) => onSet({ batch: e.target.value })} aria-label={`Batch ${l.code ?? l.name}`} /> : null}
          <button type="button" className={btnSmall + ' !h-[26px]'} aria-pressed={l.hold} onClick={() => onSet({ hold: !l.hold })}>
            {l.hold ? 'Off hold' : 'Quality hold'}
          </button>
        </div>
      ) : null}
      {l.tracking === 'serial' && l.serials.length ? <span className="truncate font-mono text-[11px] text-ink-3">{l.serials.join(' · ')}</span> : null}
    </div>
  );
}

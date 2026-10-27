import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useReducer, useRef, useState } from 'react';
import { call } from '../../core/bridge';
import { useWedge } from '../../core/scanner';
import { toast } from '../../core/toasts';
import { Checkbox } from '../../components/Checkbox';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { btn, btnPrimary, btnSmall, Empty, input, PageHead } from '../hr/parts';
import { fetchOrderFull, OFFLINE_WRITE, refreshPurchase, usePurchaseCan, usePurchaseOffline } from '../purchase/api';
import { fetchOrders, fetchReceipt, orderAct, postReceipt, type PurchaseOrder } from '../purchase/buying';
import { approvalOf, refusalText } from '../purchase/chain';
import { EMPTY, isOrderCode, lineDone, postLines, rcvReducer, receiveBody, totals } from '../purchase/scan';
import { num, qty } from './api';
import { labelsToPrint, leftWords, knownSerialText, knownUnit, progress, serialLineFor } from './receiving';
import { printLabels } from './labels';
import { Pill } from './parts';
import { clickOnKey } from '../../components/press';

/**
 * Receiving with a scanner (the "Desktop receiving" design): scan the purchase order, then each item — or each unit's
 * serial — as it comes off the delivery. Purchasing's scan rules (purchase/scan.ts) decide what counts; this screen is
 * the warehouse desk's: a table with each line's progress, serials WorkSuite already knows refused with the unit they
 * belong to, and unit labels printed as the serials are scanned. F2 turns the last one counted away as damaged, F3
 * puts the line on quality hold, ⌘/Ctrl+Enter posts the receipt. A scanner's keystrokes are taken even when the scan
 * box has lost focus. Posting needs the connection.
 */
const RECEIVABLE = ['approved', 'sent', 'acknowledged', 'partial'];
const LABELS_KEY = 'inventory.receive.labels';
const now = () => new Date().toTimeString().slice(0, 8);

function savedLabels(): boolean {
  try {
    return localStorage.getItem(LABELS_KEY) !== '0';
  } catch {
    return true;
  }
}

export default function Receive({ org, orderId, onOrder, onReceipt, onOpenOrder }: { org: string; orderId: number | null; onOrder: (id: number | null) => void; onReceipt: (id: number) => void; onOpenOrder: (id: number) => void }) {
  const qc = useQueryClient();
  const c = usePurchaseCan();
  const offline = usePurchaseOffline();
  const [s, dispatch] = useReducer(rcvReducer, EMPTY);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [autoLabel, setAutoLabel] = useState(savedLabels);
  const [printed, setPrinted] = useState<Set<string>>(new Set());
  const [printer, setPrinter] = useState<string | null>(null);
  const scanRef = useRef<HTMLInputElement>(null);
  const order = useQuery({ queryKey: ['inventory', 'receive-order', orderId ?? 0], queryFn: ({ signal }) => fetchOrderFull(orderId!, signal), enabled: !!orderId });
  const waiting = useQuery({
    queryKey: ['inventory', 'receivable', org],
    enabled: !orderId,
    queryFn: async ({ signal }) => (await Promise.all(RECEIVABLE.map((st) => fetchOrders(org, null, { status: st, q: '', page: 1 }, signal)))).flatMap((r) => r.rows),
  });
  const d = order.data;
  const chain = approvalOf(d, c.approve);

  useEffect(() => {
    void call('print:printers')
      .then((list) => setPrinter(list.find((p) => p.isDefault)?.displayName ?? list[0]?.displayName ?? null))
      .catch(() => setPrinter(null));
  }, []);

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

  // A scan counted: a serial accepted gets its label, when the box is ticked.
  const count = (text: string) => {
    const ev = { type: 'scan' as const, code: text, at: now() };
    const next = rcvReducer(s, ev);
    dispatch(ev);
    if (!autoLabel) return;
    const fresh = labelsToPrint(next, new Set([...printed, ...s.lines.flatMap((l) => l.serials)]));
    if (!fresh.length) return;
    setPrinted((p) => new Set([...p, ...fresh.map((x) => x.code)]));
    void printLabels(fresh, `Label ${fresh[0]!.code}`);
  };

  const scan = async (raw: string) => {
    const text = raw.trim();
    setCode('');
    if (!text) return;
    if (s.order) {
      // A serial WorkSuite already has is refused with the unit it belongs to, before it is counted.
      if (serialLineFor(s, text) && !offline) {
        try {
          const unit = await knownUnit(text);
          if (unit) return dispatch({ type: 'message', ok: false, text: knownSerialText(text, unit) });
        } catch {
          /* WorkSuite checks again when the receipt is posted */
        }
      }
      return count(text);
    }
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
  useWedge((code) => void scan(code), true);

  const mayPost = c.receive && !offline && !!s.order && chain.status !== 'pending';
  const post = async (draft: boolean) => {
    if (!s.order || !mayPost || busy) return;
    const b = receiveBody(s);
    if (b.error) return dispatch({ type: 'message', ok: false, text: b.error });
    setBusy(true);
    let gid: number | null = null;
    try {
      const made = await orderAct(s.order.id, 'receive', { delivery_note_no: b.delivery_note_no, lines: b.lines });
      gid = Number(made.id);
      if (draft) {
        toast('success', 'Draft receipt saved — check it, then post it');
        onReceipt(gid);
        return;
      }
      const rec = await fetchReceipt(gid);
      const r = await postReceipt(gid, { delivery_note_no: b.delivery_note_no, lines: postLines(b.lines, rec.lines) });
      const held = totals(s).held;
      toast(r.over_received?.length ? 'warning' : 'success', `${rec.receipt.grn_number} posted — the stock is in${held ? `, ${held} on quality hold` : ''}.`);
      dispatch({ type: 'reset' });
      setPrinted(new Set());
      onOrder(null);
    } catch (e) {
      dispatch({ type: 'message', ok: false, text: gid && !draft ? `The receipt was saved as a draft but not posted: ${refusalText(e)}` : refusalText(e) });
    } finally {
      setBusy(false);
      refreshPurchase(qc);
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
      void post(false);
    }
  };
  const toggleLabels = (on: boolean) => {
    setAutoLabel(on);
    try {
      localStorage.setItem(LABELS_KEY, on ? '1' : '0');
    } catch {
      /* a convenience */
    }
  };
  const t = totals(s);
  const active = s.lines.find((l) => l.lineId === s.active) ?? null;
  const serialMode = active?.tracking === 'serial' && !lineDone(active);
  const toPrint = labelsToPrint(s, printed);
  const lastLabel = s.lines.flatMap((l) => l.serials.map((x) => ({ name: l.name, serial: x }))).pop() ?? null;
  const head = s.order ?? (d ? { number: d.order.po_number, vendor: d.order.vendor, warehouse: d.order.warehouse } : null);
  const blocked = offline ? OFFLINE_WRITE : !c.receive ? 'Receiving goods is for those who may receive them.' : undefined;

  return (
    <div className="flex h-full min-h-0" onKeyDown={onKey}>
      <div className="flex min-w-0 flex-1 flex-col gap-3.5 overflow-y-auto px-6 py-5 scroll-thin">
        <PageHead
          title={head ? [head.number, head.vendor].filter(Boolean).join(' · ') : 'Receive goods'}
          sub={head ? [head.warehouse, s.delivery ? `their delivery note ${s.delivery}` : null].filter(Boolean).join(' · ') : 'Scan the purchase order, then each item as it comes off the delivery.'}
        >
          {s.order ? (
            <>
              <button type="button" className={btnSmall} onClick={() => onOpenOrder(s.order!.id)}>
                Open order
              </button>
              <button type="button" className={btnSmall} onClick={() => onOrder(null)}>
                Another order
              </button>
              <button type="button" className={btn} disabled={!mayPost || busy} title={blocked} onClick={() => void post(true)}>
                Save draft
              </button>
              <button type="button" className={btnPrimary} disabled={!mayPost || busy} title={blocked ?? 'Post receipt (⌘/Ctrl+Enter)'} onClick={() => void post(false)}>
                {busy ? 'Posting…' : 'Post receipt'}
              </button>
            </>
          ) : null}
        </PageHead>

        <div className="flex min-h-[60px] items-center gap-3.5 rounded-[12px] bg-primary px-[18px] py-2 text-white dark:bg-ground">
          <label htmlFor="receive-scan" className="shrink-0 text-[14px] font-bold">
            {!s.order ? 'Scan the order' : serialMode ? 'Scan serials' : 'Scan'}
          </label>
          <input
            id="receive-scan"
            ref={scanRef}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) {
                e.preventDefault();
                void scan(code);
              }
            }}
            placeholder={s.order ? 'An item, or a unit’s serial' : 'PO number'}
            autoComplete="off"
            spellCheck={false}
            className="h-9 w-[240px] rounded-[8px] border border-white/20 bg-white/10 px-3 font-mono text-[14px] text-white outline-none placeholder:text-ink-4 focus:border-indigo-bright"
          />
          <div className="flex min-w-0 flex-1 flex-col" role="status" aria-live="polite">
            <span className={cx('truncate text-[14px] font-semibold', s.message && !s.message.ok && 'text-stage-danger')}>{s.message?.text ?? (s.order ? 'Ready — scan the first item.' : 'Ready for a scan.')}</span>
            <span className="truncate text-[12.5px] text-stage-gray-ink">
              {s.order ? [active ? `Line: ${active.name}` : null, `${t.accepted + t.rejected} of ${t.expected} counted`, t.rejected ? `${t.rejected} turned away` : null, t.held ? `${t.held} on hold` : null].filter(Boolean).join(' · ') : 'A scanner works wherever the focus is.'}
            </span>
          </div>
          <span className="hidden shrink-0 text-[12.5px] text-stage-gray-ink xl:inline">F2 damaged · F3 quality hold</span>
        </div>

        {orderId && order.isLoading ? <Spinner /> : null}
        {orderId && order.error ? <ErrorNote error={order.error} onRetry={() => void order.refetch()} /> : null}
        {d && chain.status === 'pending' ? <span className="rounded-[8px] bg-warning-bg px-3 py-2 text-[12.5px] font-semibold text-warning-ink">{d.order.po_number} is still waiting on approval; it cannot be received yet.</span> : null}
        {offline ? <span className="text-[12.5px] text-ink-3">{OFFLINE_WRITE}</span> : null}

        {s.order ? (
          <>
            <label className="flex items-center gap-2 text-[12.5px] text-ink-2">
              Their delivery note
              <input className={input + ' !h-[30px] !w-[200px]'} value={s.delivery} onChange={(e) => dispatch({ type: 'delivery', text: e.target.value })} aria-label="Their delivery note" maxLength={60} />
            </label>
            <div className="overflow-hidden rounded-[12px] border border-line bg-surface">
              <table className="w-full border-collapse text-[13.5px]" aria-label="Lines to receive">
                <thead>
                  <tr className="bg-ground text-left text-[12px] font-semibold text-ink-3">
                    <th className="border-b border-line px-3 py-2">Product</th>
                    <th className="border-b border-line px-3 py-2 text-right">Ordered</th>
                    <th className="border-b border-line px-3 py-2 text-right">Scanned</th>
                    <th className="border-b border-line px-3 py-2">Serials</th>
                    <th className="border-b border-line px-3 py-2">Bin</th>
                  </tr>
                </thead>
                <tbody>
                  {s.lines.map((l) => {
                    const on = s.active === l.lineId;
                    const done = lineDone(l);
                    return (
                      <tr tabIndex={0} onKeyDown={clickOnKey} key={l.lineId} data-line={l.lineId} onClick={() => dispatch({ type: 'focus', lineId: l.lineId })} className={cx('cursor-default border-b border-line/60 last:border-b-0', on && 'bg-info-soft dark:bg-selection/40')}>
                        <td className="px-3 py-2">
                          <span className="flex items-center gap-2">
                            <b className="text-ink">{l.name}</b>
                            {l.hold ? <Pill tone="amber">quality hold</Pill> : done ? <Pill tone="green">complete</Pill> : null}
                            {l.rejected ? <Pill tone="red">{l.rejected} turned away</Pill> : null}
                          </span>
                          <span className="mt-1.5 block h-1.5 w-[160px] overflow-hidden rounded-full bg-subtle" role="progressbar" aria-label={`${l.name} received`} aria-valuenow={progress(l)} aria-valuemin={0} aria-valuemax={100}>
                            <span className={cx('block h-full', l.hold ? 'bg-amber-strong' : done ? 'bg-green' : 'bg-primary')} style={{ width: `${progress(l)}%` }} />
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right text-ink-2 tabular-nums">{qty(l.expected, l.unit)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{on ? <b className="text-ink">{l.accepted + l.rejected}</b> : <span className="text-ink">{l.accepted + l.rejected}</span>}</td>
                        <td className="max-w-[320px] truncate px-3 py-2 font-mono text-[12px] text-ink-3">{l.tracking === 'serial' ? l.serials.join(' · ') || '—' : l.tracking === 'batch' ? l.batch || 'batch to name' : 'serials not tracked'}</td>
                        <td className="px-3 py-2 text-ink-2">{l.bin ?? '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {active?.tracking === 'batch' ? (
              <label className="flex items-center gap-2 text-[12.5px] text-ink-2">
                Batch for {active.name}
                <input className={input + ' !h-[30px] !w-[180px]'} value={active.batch} onChange={(e) => dispatch({ type: 'set', lineId: active.lineId, patch: { batch: e.target.value } })} aria-label={`Batch ${active.name}`} />
              </label>
            ) : null}
            <span className="text-[12.5px] text-ink-3">Duplicate serials are refused with the unit they already belong to. {leftWords(s)}</span>
            {s.log.length ? (
              <section aria-label="Scan log" className="flex flex-col overflow-hidden rounded-[10px] border border-line bg-surface">
                {s.log.slice(0, 8).map((x, i) => (
                  <span key={`${x.at}-${i}`} className="flex gap-3 border-b border-line/60 px-3 py-1 text-[12.5px] last:border-b-0">
                    <span className="w-[64px] text-ink-3 tabular-nums">{x.at}</span>
                    <span className="w-[140px] truncate font-mono text-ink">{x.code}</span>
                    <span className="min-w-0 flex-1 truncate text-ink-2">{x.name ?? ''}</span>
                    <span className={cx('shrink-0', x.outcome === 'refused' || x.outcome === 'rejected' ? 'text-danger' : x.outcome === 'held' ? 'text-warning-ink' : 'text-success-ink dark:text-success')}>{x.outcome === 'refused' ? 'refused' : x.text}</span>
                  </span>
                ))}
              </section>
            ) : null}
          </>
        ) : !orderId ? (
          <section className="flex flex-col gap-2" aria-label="Waiting to be received">
            <b className="text-[13px] text-ink">Waiting to be received</b>
            {waiting.isLoading ? <Spinner /> : waiting.error ? <ErrorNote error={waiting.error} onRetry={() => void waiting.refetch()} /> : null}
            {!waiting.isLoading && !(waiting.data ?? []).length ? <Empty text="No approved order is waiting for goods." /> : null}
            <div className="flex flex-col overflow-hidden rounded-[12px] border border-line bg-surface">
              {(waiting.data ?? []).map((o: PurchaseOrder) => (
                <button key={o.id} type="button" onClick={() => onOrder(Number(o.id))} className="flex items-center gap-3 border-b border-line/60 px-3.5 py-2 text-left text-[13px] last:border-b-0 hover:bg-subtle">
                  <b className="w-[120px] text-ink">{o.po_number}</b>
                  <span className="min-w-0 flex-1 truncate text-ink">{o.vendor}</span>
                  <span className="w-[140px] truncate text-ink-2">{o.warehouse}</span>
                  <span className="w-[110px] text-right text-ink-2 tabular-nums">{num(o.outstanding_qty) ? `${qty(o.outstanding_qty)} to come` : ''}</span>
                </button>
              ))}
            </div>
          </section>
        ) : null}
      </div>
      <aside aria-label="Labels" className="flex w-[300px] shrink-0 flex-col gap-2.5 overflow-y-auto border-l border-line bg-surface px-4 py-5 scroll-thin">
        <b className="text-[14px] text-ink">Unit labels</b>
        {lastLabel ? (
          <div className="flex items-center gap-3 rounded-[10px] border border-line p-3 text-[12.5px]">
            <span aria-hidden className="grid size-[52px] shrink-0 place-items-center rounded-[6px] border border-line bg-subtle text-[10px] text-ink-3">
              QR
            </span>
            <span className="flex min-w-0 flex-col">
              <b className="truncate text-ink">{lastLabel.name}</b>
              <span className="font-mono text-ink-2">{lastLabel.serial}</span>
            </span>
          </div>
        ) : (
          <span className="text-[12.5px] text-ink-3">A label for each unit appears here as its serial is scanned.</span>
        )}
        <span className="text-[12px] text-ink-3">Printer: {printer ?? 'none found on this computer'} · 50 × 25 mm · the QR carries the serial only</span>
        <label className="flex items-center gap-2 text-[13px] text-ink">
          <Checkbox checked={autoLabel} onChange={(e) => toggleLabels(e.target.checked)} />
          Print a label after each scan
        </label>
        <button
          type="button"
          className={btn}
          disabled={!toPrint.length}
          onClick={() =>
            void printLabels(toPrint, 'Unit labels').then((ok) => {
              if (ok) setPrinted((p) => new Set([...p, ...toPrint.map((x) => x.code)]));
            })
          }
        >
          {toPrint.length ? `Print ${toPrint.length} ${toPrint.length === 1 ? 'label' : 'labels'} now` : 'No labels to print'}
        </button>
      </aside>
    </div>
  );
}

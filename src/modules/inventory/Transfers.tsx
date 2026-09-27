import { keepPreviousData, useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { app } from '../../core/app-state';
import { errorMessage } from '../../core/bridge';
import { useStore } from '../../core/store';
import { dateLabel, todayInZone } from '../../core/time';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { btn, btnPrimary, btnSmall, Empty, Field, input, PageHead, Sheet, SidePanel } from '../hr/parts';
import { can, num, qty, stampWords, type Warehouse } from './api';
import { DocChip } from './Adjustments';
import { createTransfer, deleteTransfer, fetchTransfer, fetchTransfers, KC, PER, transferActions, transferAct, transferBody, type Pickable } from './control';
import { minWidth } from './parts';
import { BatchPick, pick, ProductPick, WarehousePick } from './pickers';

/**
 * Transfers (InvTransfers): stock moving between warehouses. Approved (when
 * the installation asks for it), shipped — which takes it out of the source —
 * and received at the far end, where less than was sent can arrive.
 */
const STATUSES = [
  { value: '', label: 'All' },
  { value: 'draft', label: 'Draft' },
  { value: 'approved', label: 'Approved' },
  { value: 'in_transit', label: 'In transit' },
  { value: 'received', label: 'Received' },
  { value: 'cancelled', label: 'Cancelled' },
];

export default function Transfers({
  initialStatus,
  org,
  warehouse,
  openId,
  onOpen,
  onNew,
}: {
  org: string;
  warehouse: number | null;
  /** The status the list opens on (the dashboard's "needs attention" links). */
  initialStatus?: string | null;
  openId: number | null;
  onOpen: (id: number | null) => void;
  onNew: (() => void) | null;
}) {
  const [status, setStatus] = useState(initialStatus ?? '');
  const [q, setQ] = useState('');
  const f = { status, q };
  const list = useInfiniteQuery({
    queryKey: KC.transfers(org, { ...f, warehouse }),
    initialPageParam: 1,
    queryFn: ({ pageParam, signal }) => fetchTransfers(org, warehouse, { ...f, page: pageParam }, signal),
    getNextPageParam: (last, pages) => (pages.length * PER < last.total ? pages.length + 1 : undefined),
    placeholderData: keepPreviousData,
  });
  const rows = useMemo(() => (list.data?.pages ?? []).flatMap((p) => p.rows), [list.data]);
  const total = list.data?.pages[0]?.total ?? 0;
  const W = { from: 150, to: 150, st: 96, lines: 50, units: 60, ship: 84, recv: 84 };
  const min = minWidth(120, Object.values(W));

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 px-6 py-5">
      <PageHead title="Transfers" sub={<span data-doc-count>{list.isLoading ? ' ' : `${total.toLocaleString()} ${total === 1 ? 'transfer' : 'transfers'}`}</span>}>
        {onNew ? (
          <button type="button" className={btnPrimary} onClick={onNew}>
            <Icon name="plus" size={15} /> New transfer
          </button>
        ) : null}
      </PageHead>
      <div className="flex items-center gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Reference, tracking no. or note…" aria-label="Search transfers" className={input + ' !w-[260px]'} />
        <Select aria-label="Status" value={status} onValueChange={setStatus} options={STATUSES} className={pick + ' !w-[160px]'} />
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[12px] border border-line bg-surface">
        <div className="min-h-0 flex-1 overflow-auto scroll-thin">
          <div style={{ minWidth: min }}>
            <div className="sticky top-0 z-10 flex gap-2.5 border-b border-line bg-ground px-3.5 py-2 text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase">
              <span className="min-w-0 flex-1">Reference</span>
              <span style={{ width: W.from }}>From</span>
              <span style={{ width: W.to }}>To</span>
              <span style={{ width: W.st }}>Status</span>
              <span className="text-right" style={{ width: W.lines }}>
                Lines
              </span>
              <span className="text-right" style={{ width: W.units }}>
                Units
              </span>
              <span className="text-right" style={{ width: W.ship }}>
                Shipped
              </span>
              <span className="text-right" style={{ width: W.recv }}>
                Received
              </span>
            </div>
            {list.isLoading ? (
              <Spinner />
            ) : list.error ? (
              <ErrorNote error={list.error} onRetry={() => void list.refetch()} />
            ) : rows.length ? (
              rows.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  data-transfer={t.id}
                  onClick={() => onOpen(t.id)}
                  className={cx('flex w-full items-center gap-2.5 border-b border-line/60 px-3.5 py-2 text-left text-[12.5px] last:border-b-0 hover:bg-subtle/60', openId === t.id && 'bg-[#F4F6FE] dark:bg-selection/40')}
                >
                  <b className="min-w-0 flex-1 truncate text-ink">{t.reference}</b>
                  <span className="shrink-0 truncate text-ink-2" style={{ width: W.from }}>
                    {t.from_warehouse ?? '—'}
                  </span>
                  <span className="shrink-0 truncate text-ink-2" style={{ width: W.to }}>
                    {t.to_warehouse ?? '—'}
                  </span>
                  <span className="shrink-0" style={{ width: W.st }}>
                    <DocChip status={t.status} />
                  </span>
                  <span className="shrink-0 text-right text-ink-2 tabular-nums" style={{ width: W.lines }}>
                    {num(t.line_count) ?? 0}
                  </span>
                  <span className="shrink-0 text-right text-ink tabular-nums" style={{ width: W.units }}>
                    {qty(t.total_qty)}
                  </span>
                  <span className="shrink-0 text-right text-ink-3" style={{ width: W.ship }}>
                    {t.shipped_at ? stampWords(t.shipped_at) : '—'}
                  </span>
                  <span className="shrink-0 text-right text-ink-3" style={{ width: W.recv }}>
                    {t.received_at ? stampWords(t.received_at) : '—'}
                  </span>
                </button>
              ))
            ) : (
              <Empty text={q || status ? 'No transfer matches.' : 'No transfers yet.'} />
            )}
          </div>
        </div>
        {list.hasNextPage ? (
          <div className="flex shrink-0 justify-center border-t border-line px-3.5 py-2 text-[12px]">
            <button type="button" className="font-semibold text-primary hover:underline" onClick={() => void list.fetchNextPage()} disabled={list.isFetchingNextPage}>
              {list.isFetchingNextPage ? 'Loading…' : 'Load more'}
            </button>
          </div>
        ) : null}
      </div>
      {openId ? <TransferPanel key={openId} id={openId} onClose={() => onOpen(null)} /> : null}
    </div>
  );
}

function TransferPanel({ id, onClose }: { id: number; onClose: () => void }) {
  const qc = useQueryClient();
  const perms = useStore(app, (s) => s.bootstrap?.permissions);
  const q = useQuery({ queryKey: KC.transfer(id), queryFn: ({ signal }) => fetchTransfer(id, signal) });
  const [busy, setBusy] = useState(false);
  const [receiving, setReceiving] = useState<Record<number, string>>({});
  const [confirm, setConfirm] = useState<'ship' | 'cancel' | 'remove' | null>(null);
  const d = q.data;
  const t = d?.transfer;
  const acts = t && d ? transferActions(t, { needsApproval: d.needs_approval, canApprove: d.can_approve, canTransfer: can(perms, 'inventory.transfer') }) : null;
  const inTransit = t?.status === 'in_transit';

  const run = async (label: string, fn: () => Promise<{ short?: string[] } | unknown>) => {
    setBusy(true);
    try {
      const r = (await fn()) as { short?: string[] } | undefined;
      toast(r?.short?.length ? 'warning' : 'success', r?.short?.length ? `Received short — ${r.short.join('; ')}. The difference did not arrive and is no longer in stock anywhere.` : label);
      void qc.invalidateQueries({ queryKey: ['inventory'] });
      if (label === 'Transfer deleted') onClose();
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };

  const receive = () => {
    if (!d) return;
    const lines: Array<{ id: number; quantity: number }> = [];
    for (const l of d.lines) {
      const sent = num(l.sent_qty) ?? 0;
      if (sent <= 0) continue;
      const typed = receiving[l.id];
      const got = typed === undefined || typed.trim() === '' ? sent : Number(typed.replace(/,/g, ''));
      if (!Number.isFinite(got) || got < 0 || got > sent) {
        toast('error', `${l.code ?? l.name}: receive between 0 and the ${qty(sent)} sent.`);
        return;
      }
      lines.push({ id: l.id, quantity: got });
    }
    void run('Received', () => transferAct(id, 'receive', { lines }));
  };

  const state = !t
    ? ''
    : t.status === 'received'
      ? `Received ${t.received_at ? stampWords(t.received_at) : ''}.`
      : t.status === 'in_transit'
        ? `In transit since ${t.shipped_at ? stampWords(t.shipped_at) : 'it shipped'}. Receive it at ${t.to_warehouse ?? 'the far end'}.`
        : t.status === 'approved'
          ? 'Approved — ready to ship.'
          : t.status === 'cancelled'
            ? 'Cancelled. Nothing moved.'
            : d?.needs_approval
              ? 'A draft. It has to be approved before it ships.'
              : 'A draft. Ship it when the stock leaves.';

  return (
    <>
      <SidePanel
        label={t ? `Transfer ${t.reference}` : 'Transfer'}
        width={640}
        onClose={onClose}
        head={
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="flex items-center gap-2">
              <b className="truncate text-[15px] text-ink">{t?.reference ?? 'Transfer'}</b>
              {t ? <DocChip status={t.status} /> : null}
            </span>
            {t ? <span className="truncate text-[12.5px] text-ink-3">{`${t.from_warehouse ?? '—'} → ${t.to_warehouse ?? '—'}`}</span> : null}
          </span>
        }
      >
        {q.isLoading ? (
          <Spinner />
        ) : q.error ? (
          <ErrorNote error={q.error} onRetry={() => void q.refetch()} />
        ) : t && d ? (
          <>
            <span className="text-[12.5px] text-ink-2">
              {[
                t.transfer_date ? `dated ${dateLabel(t.transfer_date)}` : null,
                t.expected_date ? `expected ${dateLabel(t.expected_date)}` : null,
                t.carrier,
                t.tracking_no ? `tracking no. ${t.tracking_no}` : null,
                t.created_by_name ? `raised by ${t.created_by_name}` : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </span>
            {t.note ? <p className="m-0 rounded-[10px] bg-subtle px-3 py-2 text-[12.5px] whitespace-pre-line text-ink">“{t.note}”</p> : null}
            <div className="overflow-hidden rounded-[10px] border border-line">
              <div className="flex gap-2 border-b border-line bg-ground px-3 py-1.5 text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase">
                <span className="min-w-0 flex-1">Product</span>
                <span className="w-[56px] text-right">Asked</span>
                <span className="w-[56px] text-right">Sent</span>
                <span className="w-[66px] text-right">Received</span>
                {inTransit ? <span className="w-[80px] text-right">Receiving</span> : null}
              </div>
              {d.lines.map((l) => {
                const sent = num(l.sent_qty) ?? 0;
                return (
                  <div key={l.id} className="flex items-center gap-2 border-b border-line/60 px-3 py-1.5 text-[12.5px] last:border-b-0">
                    <span className="flex min-w-0 flex-1 flex-col">
                      <b className="truncate text-ink">
                        {l.name}
                        {l.variant_label ? ` — ${l.variant_label}` : ''}
                      </b>
                      <span className="truncate text-[11px] text-ink-3">
                        {[l.code, l.batch_no ? `B:${l.batch_no}` : null, !inTransit && t.status !== 'received' && l.source_on_hand !== null ? `${qty(l.source_on_hand)} at ${t.from_warehouse ?? 'the source'}` : null].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                    <span className="w-[56px] text-right text-ink tabular-nums">{qty(l.quantity)}</span>
                    <span className="w-[56px] text-right text-ink-2 tabular-nums">{sent ? qty(sent) : '—'}</span>
                    <span className={cx('w-[66px] text-right tabular-nums', t.status === 'received' && (num(l.received_qty) ?? 0) < sent ? 'font-bold text-danger' : 'text-ink-2')}>{t.status === 'received' ? qty(l.received_qty) : '—'}</span>
                    {inTransit ? (
                      <span className="w-[80px]">
                        {sent > 0 ? (
                          <input className={input + ' !h-[28px] text-right tabular-nums'} value={receiving[l.id] ?? String(sent)} onChange={(e) => setReceiving({ ...receiving, [l.id]: e.target.value })} aria-label={`Receiving ${l.code ?? l.name}`} />
                        ) : null}
                      </span>
                    ) : null}
                  </div>
                );
              })}
            </div>
            {inTransit ? <span className="text-[11.5px] text-ink-3">Receiving less than was sent: the difference left {t.from_warehouse ?? 'the source'} when it shipped and did not arrive, so it is no longer in stock anywhere.</span> : null}
            <span data-transfer-state className="text-[12.5px] font-semibold text-ink-2">
              {state}
            </span>
            {acts ? (
              <div className="flex flex-wrap gap-2">
                {acts.approve ? (
                  <button type="button" className={btnSmall} disabled={busy} onClick={() => void run('Approved', () => transferAct(id, 'approve'))}>
                    Approve
                  </button>
                ) : null}
                {acts.ship ? (
                  <button type="button" className={btnPrimary + ' !h-[30px] !text-[12.5px]'} disabled={busy} onClick={() => setConfirm('ship')}>
                    Ship
                  </button>
                ) : null}
                {acts.receive ? (
                  <button type="button" className={btnPrimary + ' !h-[30px] !text-[12.5px]'} disabled={busy} onClick={receive}>
                    Receive
                  </button>
                ) : null}
                {acts.cancel ? (
                  <button type="button" className={btnSmall} disabled={busy} onClick={() => setConfirm('cancel')}>
                    Cancel transfer
                  </button>
                ) : null}
                {acts.remove ? (
                  <button type="button" className={btnSmall + ' ml-auto text-danger'} disabled={busy} onClick={() => setConfirm('remove')}>
                    Delete
                  </button>
                ) : null}
              </div>
            ) : null}
          </>
        ) : null}
      </SidePanel>
      {confirm && t ? (
        <Sheet
          title={confirm === 'ship' ? `Ship ${t.reference}?` : confirm === 'cancel' ? `Cancel ${t.reference}?` : `Delete ${t.reference}?`}
          width={420}
          onClose={() => setConfirm(null)}
          footer={
            <>
              <button type="button" className={btn} onClick={() => setConfirm(null)}>
                Back
              </button>
              <button
                type="button"
                className={btnPrimary}
                disabled={busy}
                onClick={() =>
                  confirm === 'ship'
                    ? void run('Shipped — the stock is in transit', () => transferAct(id, 'ship'))
                    : confirm === 'cancel'
                      ? void run('Transfer cancelled', () => transferAct(id, 'cancel'))
                      : void run('Transfer deleted', () => deleteTransfer(id))
                }
              >
                {confirm === 'ship' ? 'Ship' : confirm === 'cancel' ? 'Cancel transfer' : 'Delete'}
              </button>
            </>
          }
        >
          <span className="text-[13px] text-ink-2">
            {confirm === 'ship'
              ? `Everything asked for leaves ${t.from_warehouse ?? 'the source'} now, and is in transit until ${t.to_warehouse ?? 'the far end'} receives it.`
              : confirm === 'cancel'
                ? 'Nothing has moved, and nothing will.'
                : 'It is removed from the list.'}
          </span>
        </Sheet>
      ) : null}
    </>
  );
}

interface TLine {
  key: number;
  product: Pickable | null;
  qty: string;
  batchId: number | null;
}

/** A new transfer (InvControlSheet): from, to, when, and what. */
export function TransferSheet({ org, warehouses, defaultFrom, onClose, onSaved }: { org: string; warehouses: Warehouse[]; defaultFrom?: number | null; onClose: () => void; onSaved: (id: number) => void }) {
  const qc = useQueryClient();
  const [from, setFrom] = useState<number | null>(defaultFrom ?? null);
  const [to, setTo] = useState<number | null>(null);
  const [date, setDate] = useState(todayInZone());
  const [expected, setExpected] = useState('');
  const [carrier, setCarrier] = useState('');
  const [tracking, setTracking] = useState('');
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<TLine[]>([{ key: 0, product: null, qty: '', batchId: null }]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const set = (key: number, patch: Partial<TLine>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const save = async () => {
    setError(null);
    const { body, error: bad } = transferBody({ from, to, date, expected, carrier, tracking, note }, lines);
    if (bad) return setError(bad);
    setSaving(true);
    try {
      const r = await createTransfer(org, body);
      void qc.invalidateQueries({ queryKey: ['inventory'] });
      toast('success', 'Transfer created');
      onSaved(r.transfer?.id ?? 0);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet
      title="New transfer"
      width={680}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} disabled={saving} onClick={() => void save()}>
            {saving ? 'Saving…' : 'Create'}
          </button>
        </>
      }
    >
      <div role="form" aria-label="New transfer" className="flex flex-col gap-2.5">
        <div className="grid grid-cols-2 gap-2.5">
          <Field label="From">
            <WarehousePick warehouses={warehouses} value={from} onChange={setFrom} label="From" />
          </Field>
          <Field label="To">
            <WarehousePick warehouses={warehouses.map((w) => ({ ...w, can_act: true }))} value={to} onChange={setTo} label="To" />
          </Field>
        </div>
        <div className="grid grid-cols-4 gap-2.5">
          <Field label="Date">
            <input type="date" className={input} value={date} onChange={(e) => setDate(e.target.value)} aria-label="Date" />
          </Field>
          <Field label="Expected">
            <input type="date" className={input} value={expected} min={date || undefined} onChange={(e) => setExpected(e.target.value)} aria-label="Expected" />
          </Field>
          <Field label="Carrier">
            <input className={input} value={carrier} onChange={(e) => setCarrier(e.target.value)} aria-label="Carrier" maxLength={120} />
          </Field>
          <Field label="Tracking no.">
            <input className={input} value={tracking} onChange={(e) => setTracking(e.target.value)} aria-label="Tracking number" maxLength={80} />
          </Field>
        </div>
        <div className="flex flex-col gap-2">
          {lines.map((l, i) => (
            <div key={l.key} className="flex items-center gap-2">
              <span className="min-w-0 flex-1">
                <ProductPick org={org} warehouse={from} value={l.product} onChange={(p) => set(l.key, { product: p, batchId: null })} label={`Line ${i + 1} product`} noSerial />
              </span>
              {l.product?.tracking === 'batch' ? (
                <span className="w-[190px]">
                  <BatchPick productId={l.product.id} value={l.batchId} onChange={(b) => set(l.key, { batchId: b })} label={`Line ${i + 1} batch`} />
                </span>
              ) : null}
              <input className={input + ' !w-[90px] text-right tabular-nums'} value={l.qty} onChange={(e) => set(l.key, { qty: e.target.value })} placeholder="Qty" aria-label={`Line ${i + 1} quantity`} />
              <button
                type="button"
                aria-label={`Remove line ${i + 1}`}
                onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((x) => x.key !== l.key) : [{ key: l.key + 1, product: null, qty: '', batchId: null }]))}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] text-ink-3 hover:bg-subtle hover:text-ink"
              >
                <Icon name="x" size={14} />
              </button>
            </div>
          ))}
          <button type="button" className="self-start text-[12.5px] font-semibold text-primary hover:underline" onClick={() => setLines((ls) => [...ls, { key: Math.max(...ls.map((x) => x.key)) + 1, product: null, qty: '', batchId: null }])}>
            + Add a line
          </button>
        </div>
        <span className="text-[12px] text-ink-3">Serialised products are not listed: move those with an adjustment at each end, so every unit is named.</span>
        <Field label="Note">
          <input className={input} value={note} onChange={(e) => setNote(e.target.value)} aria-label="Note" maxLength={500} />
        </Field>
        {error ? (
          <span role="alert" className="rounded-[8px] bg-danger-bg px-3 py-2 text-[12.5px] font-semibold text-danger">
            {error}
          </span>
        ) : null}
      </div>
    </Sheet>
  );
}

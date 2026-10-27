import { keepPreviousData, useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState, type ReactNode } from 'react';
import { app } from '../../core/app-state';
import { errorMessage } from '../../core/bridge';
import { useStore } from '../../core/store';
import { dateLabel } from '../../core/time';
import { toast } from '../../core/toasts';
import { Select } from '../../components/Select';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { btn, btnSmall, Empty, Facts, input, PageHead, Seg, SidePanel } from '../../components/PageKit';
import { can, cost, qty, stampFull, whole } from './api';
import { fetchBatches, fetchExpiring, fetchSerials, fetchUnit, KC, scanCode, SERIAL_STATUS, tagsOf, tagUnit } from './control';
import { minWidth, Pill } from '../../components/ListKit';
import { pick } from './pickers';

/**
 * Batches & serials (InvTracked): the batches that hold stock, soonest to
 * expire first; every serial-numbered unit and where it is; and what expires
 * soon. A unit opens with how it is identified, what is known about it and
 * everything it did. The scan box takes a barcode, a QR reference, an NFC
 * tag or a typed serial.
 */
export type TrackTab = 'batches' | 'serials' | 'expiring';

const SERIAL_STATUSES = [{ value: '', label: 'Any status' }, ...['in_stock', 'reserved', 'sold', 'delivered', 'returned', 'in_service', 'scrapped'].map((s) => ({ value: s, label: s.replace(/_/g, ' ') }))];

export default function Tracked({
  org,
  warehouse,
  currency,
  tab,
  onTab,
  unitId,
  onUnit,
  onOpenProduct,
  onWriteOff,
}: {
  org: string;
  warehouse: number | null;
  currency: string | null;
  tab: TrackTab;
  onTab: (t: TrackTab) => void;
  unitId: number | null;
  onUnit: (id: number | null) => void;
  onOpenProduct: (id: number) => void;
  onWriteOff: (() => void) | null;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col gap-3 px-6 py-5">
      <PageHead title="Batches & serials">
        <Seg
          label="Batches and serials"
          value={tab}
          onChange={onTab}
          options={[
            { id: 'batches', label: 'Batches' },
            { id: 'serials', label: 'Serials' },
            { id: 'expiring', label: 'Expiring' },
          ]}
        />
      </PageHead>
      {tab === 'batches' ? <Batches org={org} onOpenProduct={onOpenProduct} /> : null}
      {tab === 'serials' ? <Serials org={org} warehouse={warehouse} onUnit={onUnit} /> : null}
      {tab === 'expiring' ? <ExpiringList org={org} currency={currency} onOpenProduct={onOpenProduct} onWriteOff={onWriteOff} /> : null}
      {unitId ? <UnitPanel key={unitId} id={unitId} onClose={() => onUnit(null)} onOpenProduct={onOpenProduct} /> : null}
    </div>
  );
}

function Frame({ min, head, children }: { min: number; head: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[12px] border border-line bg-surface">
      <div className="min-h-0 flex-1 overflow-auto scroll-thin">
        <div style={{ minWidth: min }}>
          <div className="sticky top-0 z-10 flex gap-2.5 border-b border-line bg-ground px-3.5 py-2 text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase">{head}</div>
          {children}
        </div>
      </div>
    </div>
  );
}

const rowCls = 'flex w-full items-center gap-2.5 border-b border-line/60 px-3.5 py-2 text-left text-[12.5px] last:border-b-0 hover:bg-subtle/60';

function expiry(date: string | null, days: number | null, expired: boolean) {
  if (!date) return <span className="text-ink-3">—</span>;
  return (
    <span className={cx('tabular-nums', expired ? 'font-bold text-danger' : days !== null && days <= 30 ? 'font-semibold text-warning-ink dark:text-warning' : 'text-ink-2')}>
      {dateLabel(date)}
      <span className="ml-1 text-[11px]">{expired ? 'expired' : days !== null ? `${days}d` : ''}</span>
    </span>
  );
}

function Batches({ org, onOpenProduct }: { org: string; onOpenProduct: (id: number) => void }) {
  const [q, setQ] = useState('');
  const list = useQuery({ queryKey: KC.batches(org, { q }), queryFn: ({ signal }) => fetchBatches(org, q, signal), placeholderData: keepPreviousData });
  const rows = list.data ?? [];
  const W = { prod: 200, exp: 120, on: 80, recv: 80, vendor: 140, st: 96 };
  return (
    <>
      <div className="flex items-center gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Batch, product or code…" aria-label="Search batches" className={input + ' !w-[260px]'} />
        <span className="ml-auto text-[12.5px] text-ink-3">{list.isLoading ? '' : `${rows.length} ${rows.length === 1 ? 'batch' : 'batches'} in stock`}</span>
      </div>
      <Frame
        min={minWidth(120, Object.values(W))}
        head={
          <>
            <span className="min-w-0 flex-1">Batch</span>
            <span style={{ width: W.prod }}>Product</span>
            <span style={{ width: W.exp }}>Expires</span>
            <span className="text-right" style={{ width: W.on }}>
              On hand
            </span>
            <span className="text-right" style={{ width: W.recv }}>
              Received
            </span>
            <span style={{ width: W.vendor }}>Vendor</span>
            <span style={{ width: W.st }}>Status</span>
          </>
        }
      >
        {list.isLoading ? (
          <Spinner />
        ) : list.error ? (
          <ErrorNote error={list.error} onRetry={() => void list.refetch()} />
        ) : rows.length ? (
          rows.map((b) => (
            <button key={b.id} type="button" data-batch={b.id} className={rowCls} onClick={() => onOpenProduct(b.product_id)}>
              <b className="min-w-0 flex-1 truncate font-mono text-ink">{b.batch_no}</b>
              <span className="flex shrink-0 flex-col truncate" style={{ width: W.prod }}>
                <span className="truncate text-ink">{b.name}</span>
                <span className="truncate font-mono text-[11px] text-ink-3">{b.code}</span>
              </span>
              <span className="shrink-0" style={{ width: W.exp }}>
                {expiry(b.expiry_date, b.days_to_expiry, b.expired)}
              </span>
              <span className="shrink-0 text-right font-semibold text-ink tabular-nums" style={{ width: W.on }}>
                {qty(b.on_hand, b.unit)}
              </span>
              <span className="shrink-0 text-right text-ink-2 tabular-nums" style={{ width: W.recv }}>
                {qty(b.received_qty)}
              </span>
              <span className="shrink-0 truncate text-ink-2" style={{ width: W.vendor }}>
                {b.vendor ?? '—'}
              </span>
              <span className="shrink-0" style={{ width: W.st }}>
                <Pill tone={b.status === 'active' ? 'green' : b.status === 'expired' ? 'red' : 'amber'}>{b.status}</Pill>
              </span>
            </button>
          ))
        ) : (
          <Empty text={q ? 'No batch matches.' : 'No batch holds stock.'} />
        )}
      </Frame>
    </>
  );
}

function Serials({ org, warehouse, onUnit }: { org: string; warehouse: number | null; onUnit: (id: number) => void }) {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [code, setCode] = useState('');
  const [finding, setFinding] = useState(false);
  const [why, setWhy] = useState<string | null>(null);
  const f = { q, status };
  const list = useInfiniteQuery({
    queryKey: KC.serials(org, { ...f, warehouse }),
    initialPageParam: 1,
    queryFn: ({ pageParam, signal }) => fetchSerials(org, warehouse, { ...f, page: pageParam }, signal),
    getNextPageParam: (last, pages) => (pages.length * 50 < last.total ? pages.length + 1 : undefined),
    placeholderData: keepPreviousData,
  });
  const rows = useMemo(() => (list.data?.pages ?? []).flatMap((p) => p.rows), [list.data]);
  const total = list.data?.pages[0]?.total ?? 0;
  const find = async () => {
    if (!code.trim()) return;
    setFinding(true);
    setWhy(null);
    try {
      const r = await scanCode(org, code.trim());
      if (r.found && r.unit) {
        setCode('');
        onUnit(r.unit.id);
      } else setWhy(r.why ?? 'Nothing here answers to that code.');
    } catch (e) {
      setWhy(errorMessage(e));
    } finally {
      setFinding(false);
    }
  };
  const W = { prod: 190, tags: 110, st: 96, wh: 130, cust: 140, war: 100 };
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" aria-label="Search serials" className={input + ' !w-[200px]'} />
        <Select aria-label="Serial status" value={status} onValueChange={setStatus} options={SERIAL_STATUSES} className={pick + ' !w-[150px]'} />
        <span className="ml-auto flex items-center gap-1.5">
          <input
            value={code}
            onChange={(e) => (setCode(e.target.value), setWhy(null))}
            onKeyDown={(e) => e.key === 'Enter' && void find()}
            placeholder="Scan a barcode, QR or tag"
            aria-label="Scan a barcode, QR or tag"
            className={input + ' !w-[220px] font-mono'}
          />
          <button type="button" className={btn} disabled={finding || !code.trim()} onClick={() => void find()}>
            Find
          </button>
        </span>
      </div>
      {why ? (
        <span role="status" className="rounded-[8px] bg-warning-bg px-3 py-2 text-[12.5px] font-semibold text-warning-ink dark:bg-warning-bg dark:text-warning">
          {why}
        </span>
      ) : null}
      <span className="text-[12.5px] font-semibold text-ink-2" data-serial-count>
        Serial numbers ({total.toLocaleString()})
      </span>
      <Frame
        min={minWidth(130, Object.values(W))}
        head={
          <>
            <span className="min-w-0 flex-1">Serial</span>
            <span style={{ width: W.prod }}>Product</span>
            <span style={{ width: W.tags }}>Tags</span>
            <span style={{ width: W.st }}>Status</span>
            <span style={{ width: W.wh }}>Warehouse</span>
            <span style={{ width: W.cust }}>Customer</span>
            <span style={{ width: W.war }}>Warranty</span>
          </>
        }
      >
        {list.isLoading ? (
          <Spinner />
        ) : list.error ? (
          <ErrorNote error={list.error} onRetry={() => void list.refetch()} />
        ) : rows.length ? (
          rows.map((s) => (
            <button key={s.id} type="button" data-serial={s.id} className={rowCls} onClick={() => onUnit(Number(s.id))}>
              <b className="min-w-0 flex-1 truncate font-mono text-ink">{s.serial_no}</b>
              <span className="shrink-0 truncate text-ink" style={{ width: W.prod }}>
                {s.name}
              </span>
              <span className="shrink-0 truncate text-ink-3" style={{ width: W.tags }}>
                {tagsOf(s)}
              </span>
              <span className="shrink-0" style={{ width: W.st }}>
                <Pill tone={SERIAL_STATUS[s.status] ?? 'grey'}>{s.status.replace(/_/g, ' ')}</Pill>
              </span>
              <span className="shrink-0 truncate text-ink-2" style={{ width: W.wh }}>
                {s.warehouse ?? '—'}
              </span>
              <span className="shrink-0 truncate text-ink-2" style={{ width: W.cust }}>
                {s.client ?? '—'}
              </span>
              <span className="shrink-0 truncate text-ink-3" style={{ width: W.war }}>
                {s.warranty_end ? `to ${dateLabel(s.warranty_end)}` : '—'}
              </span>
            </button>
          ))
        ) : (
          <Empty text={q || status ? 'No unit matches.' : 'No serial-numbered units yet.'} />
        )}
      </Frame>
      {list.hasNextPage ? (
        <button type="button" className="self-center text-[12px] font-semibold text-primary hover:underline" onClick={() => void list.fetchNextPage()} disabled={list.isFetchingNextPage}>
          {list.isFetchingNextPage ? 'Loading…' : 'Load more'}
        </button>
      ) : null}
    </>
  );
}

function ExpiringList({ org, currency, onOpenProduct, onWriteOff }: { org: string; currency: string | null; onOpenProduct: (id: number) => void; onWriteOff: (() => void) | null }) {
  const [days, setDays] = useState(0);
  const q = useQuery({ queryKey: KC.expiring(org, days), queryFn: ({ signal }) => fetchExpiring(org, days, signal) });
  const d = q.data;
  const rows = d?.batches ?? [];
  const seesCost = rows.some((r) => r.value !== null);
  const W = { prod: 200, exp: 120, on: 80, val: 96 };
  return (
    <>
      <div className="flex items-center gap-2">
        <Select
          aria-label="Window"
          value={String(days)}
          onValueChange={(v) => setDays(Number(v))}
          options={[
            { value: '0', label: 'The usual window' },
            { value: '30', label: 'Within 30 days' },
            { value: '60', label: 'Within 60 days' },
            { value: '90', label: 'Within 90 days' },
          ]}
          className={pick + ' !w-[180px]'}
        />
        <span className="text-[12.5px] text-ink-3">{d ? `Expiring within ${d.window_days} days` : ''}</span>
      </div>
      {d && d.expired ? (
        <span className="flex items-center gap-2 rounded-[10px] bg-danger-bg px-3 py-2 text-[12.5px] text-danger-ink dark:bg-danger-bg dark:text-danger">
          <span className="flex-1">
            {d.expired} {d.expired === 1 ? 'batch has' : 'batches have'} expired and still {d.expired === 1 ? 'holds' : 'hold'} stock. Write {d.expired === 1 ? 'it' : 'them'} off with an adjustment reason of “Expired”.
          </span>
          {onWriteOff ? (
            <button type="button" className={btnSmall} onClick={onWriteOff}>
              New adjustment
            </button>
          ) : null}
        </span>
      ) : null}
      <Frame
        min={minWidth(120, [W.prod, W.exp, W.on, ...(seesCost ? [W.val] : [])])}
        head={
          <>
            <span className="min-w-0 flex-1">Batch</span>
            <span style={{ width: W.prod }}>Product</span>
            <span style={{ width: W.exp }}>Expires</span>
            <span className="text-right" style={{ width: W.on }}>
              On hand
            </span>
            {seesCost ? (
              <span className="text-right" style={{ width: W.val }}>
                Value
              </span>
            ) : null}
          </>
        }
      >
        {q.isLoading ? (
          <Spinner />
        ) : q.error ? (
          <ErrorNote error={q.error} onRetry={() => void q.refetch()} />
        ) : rows.length ? (
          rows.map((b) => (
            <button key={b.batch_id} type="button" data-expiring={b.batch_id} className={rowCls} onClick={() => onOpenProduct(b.product_id)}>
              <b className="min-w-0 flex-1 truncate font-mono text-ink">{b.batch_no}</b>
              <span className="shrink-0 truncate text-ink" style={{ width: W.prod }}>
                {b.name}
              </span>
              <span className="shrink-0" style={{ width: W.exp }}>
                {expiry(b.expiry_date, b.days_to_expiry, b.expired)}
              </span>
              <span className="shrink-0 text-right font-semibold text-ink tabular-nums" style={{ width: W.on }}>
                {qty(b.on_hand, b.unit)}
              </span>
              {seesCost ? (
                <span className="shrink-0 text-right text-ink-2 tabular-nums" style={{ width: W.val }}>
                  {whole(b.value, currency)}
                </span>
              ) : null}
            </button>
          ))
        ) : (
          <Empty text="Nothing expires within the window." />
        )}
      </Frame>
    </>
  );
}

function UnitPanel({ id, onClose, onOpenProduct }: { id: number; onClose: () => void; onOpenProduct: (id: number) => void }) {
  const qc = useQueryClient();
  const perms = useStore(app, (s) => s.bootstrap?.permissions);
  const q = useQuery({ queryKey: KC.serial(id), queryFn: ({ signal }) => fetchUnit(id, signal) });
  const [tag, setTag] = useState('');
  const [busy, setBusy] = useState(false);
  const d = q.data;
  const u = d?.unit;
  const manage = can(perms, 'inventory.manage');
  const attach = async (value: string) => {
    setBusy(true);
    try {
      await tagUnit(id, value);
      toast('success', value ? 'Tag attached.' : 'Tag removed.');
      setTag('');
      void qc.invalidateQueries({ queryKey: ['inventory'] });
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <SidePanel
      label={u ? `Unit ${u.serial_no}` : 'Unit'}
      width={520}
      onClose={onClose}
      head={
        <span className="flex min-w-0 flex-col">
          <b className="truncate font-mono text-[15px] text-ink">{u?.serial_no ?? 'Unit'}</b>
          <span className="truncate text-[12px] text-ink-3">{u?.product ?? ''}</span>
        </span>
      }
    >
      {q.isLoading ? (
        <Spinner />
      ) : q.error ? (
        <ErrorNote error={q.error} onRetry={() => void q.refetch()} />
      ) : u && d ? (
        <>
          <span className="flex items-center gap-2 text-[12.5px]">
            <Pill tone={SERIAL_STATUS[u.status] ?? 'grey'}>{u.status.replace(/_/g, ' ')}</Pill>
            <span className={d.sellable ? 'text-success-ink dark:text-success' : 'text-ink-3'}>{d.sellable ? 'can be sold' : 'not available to sell'}</span>
            <span className="text-ink-3">{[u.warehouse, u.bin].filter(Boolean).join(' · ')}</span>
          </span>
          <section className="flex flex-col gap-1">
            <b className="text-[13px] text-ink">How it is identified</b>
            <div className="text-[12.5px]">
              <Facts
                rows={[
                  ['Serial', <span className="font-mono">{u.serial_no}</span>],
                  ['Barcode', u.barcode ? <span className="font-mono">{u.barcode}</span> : '—'],
                  ['QR reference', u.uid ? <span className="font-mono">{u.uid}</span> : '—'],
                  ['NFC tag', u.nfc_uid ? <span className="font-mono">{u.nfc_uid}</span> : '—'],
                ]}
              />
            </div>
            {manage ? (
              <span className="flex items-center gap-1.5">
                <input className={input + ' !h-[30px] font-mono'} value={tag} onChange={(e) => setTag(e.target.value)} placeholder="Read a tag, or type its id" aria-label="Attach an NFC tag" />
                <button type="button" className={btnSmall} disabled={busy || !tag.trim()} onClick={() => void attach(tag.trim())}>
                  Attach
                </button>
                {u.nfc_uid ? (
                  <button type="button" className={btnSmall} disabled={busy} onClick={() => void attach('')}>
                    Remove tag
                  </button>
                ) : null}
              </span>
            ) : null}
            {manage ? <span className="text-[11.5px] text-ink-3">One tag names one unit — attaching a tag already on another unit is refused.</span> : null}
          </section>
          <section className="flex flex-col gap-1">
            <b className="text-[13px] text-ink">What is known</b>
            <div className="text-[12.5px]">
              <Facts
                rows={[
                  [
                    'Product',
                    <button type="button" className="text-left text-primary hover:underline" onClick={() => onOpenProduct(u.product_id)}>
                      {u.product ?? '—'}
                    </button>,
                  ],
                  ['Received', u.received_at ? dateLabel(u.received_at) : '—'],
                  ['Customer', u.client ?? '—'],
                  ['Warranty', u.warranty_end ? `${u.warranty_start ? `${dateLabel(u.warranty_start)} to ` : 'to '}${dateLabel(u.warranty_end)}` : '—'],
                  ...(u.unit_cost !== null ? ([['Unit cost', cost(u.unit_cost)]] as Array<[string, string]>) : []),
                  ['Goods receipt', u.grn_id ? `#${u.grn_id}` : '—'],
                  ['Delivery', u.delivery_id ? `#${u.delivery_id}` : '—'],
                ]}
              />
            </div>
            {u.notes ? <p className="m-0 text-[12.5px] whitespace-pre-line text-ink-2">{u.notes}</p> : null}
          </section>
          <section className="flex flex-col gap-1">
            <b className="text-[13px] text-ink">Everything it did ({d.history.length})</b>
            {d.history.length ? (
              d.history.map((e) => (
                <div key={`${e.type}-${e.id}`} className="flex flex-col border-b border-line/60 py-1.5 text-[12.5px] last:border-b-0">
                  <b className="text-ink">{[e.what, e.ref].filter(Boolean).join(' · ')}</b>
                  <span className="text-[11.5px] text-ink-3">{[stampFull(e.at), e.warehouse, e.user, e.note ? `“${e.note}”` : null].filter(Boolean).join(' · ')}</span>
                </div>
              ))
            ) : (
              <span className="text-[12.5px] text-ink-3">Nothing recorded yet.</span>
            )}
          </section>
        </>
      ) : (
        <Empty text="There is no such unit." />
      )}
    </SidePanel>
  );
}

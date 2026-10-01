import { DescriptionView } from '../../components/DescriptionEditor';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { useCanOpen } from '../../core/access';
import { app } from '../../core/app-state';
import { errorMessage } from '../../core/bridge';
import { useStore } from '../../core/store';
import { useTab } from '../../core/tab-context';
import { dateLabel } from '../../core/time';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { btnSmall, Facts, SidePanel } from '../hr/parts';
import { archiveProduct, cost, costingLabel, fetchProduct, fetchTimeline, fetchTrade, K, kindLabel, moveWhat, num, pictureSrc, qty, restoreProduct, signed, trackingLabel, whole, type ProductDetail, type ProductImage, stampWords } from './api';
import { Pill, Signed } from './parts';
import { openWeb } from './Rail';

/**
 * One product (InvProductDrawer): what it is and where it is — tiles, a row
 * per warehouse, how fast it moves, its specification and details — then
 * what it has been sold and bought on, and everything that happened to it.
 * Figures are across the warehouses of the companies being looked at.
 */
const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'sales', label: 'Sales' },
  { id: 'purchase', label: 'Purchase' },
  { id: 'history', label: 'History' },
] as const;

export default function ProductDrawer({ id, org, tab, onTab, onClose, onEdit, onOpenProduct }: { id: number; org: string; tab: string; onTab: (t: string) => void; onClose: () => void; onEdit?: () => void; onOpenProduct: (id: number) => void }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: K.product(id, org),
    queryFn: ({ signal }) => fetchProduct(id, org, signal),
  });
  const d = q.data;
  const p = d?.product;
  const [busy, setBusy] = useState(false);
  const on = TABS.some((t) => t.id === tab) ? tab : 'overview';

  const archive = async (restore: boolean) => {
    setBusy(true);
    try {
      await (restore ? restoreProduct(id) : archiveProduct(id));
      toast('success', restore ? 'Product restored' : 'Product archived');
      void qc.invalidateQueries({ queryKey: ['inventory'] });
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SidePanel
      label={p ? `Product ${p.name}` : 'Product'}
      width={620}
      onClose={onClose}
      head={
        <>
          <span className="flex min-w-0 flex-1 flex-col">
            <b className="truncate text-[15px] text-ink">
              {p ? `${p.name}${p.variant_label ? ` — ${p.variant_label}` : ''}` : 'Product'}
              {p && !p.active ? <span className="ml-2 text-[12px] font-semibold text-ink-3">archived</span> : null}
            </b>
            <span className="truncate font-mono text-[12px] text-ink-3">{p?.code ?? ''}</span>
          </span>
          {p && onEdit ? (
            <button type="button" className={btnSmall} disabled={busy} onClick={() => void archive(p.active === false)} title={p.active ? 'Hide it from lists and pickers; its history stays' : undefined}>
              {p.active ? 'Archive' : 'Restore'}
            </button>
          ) : null}
          {p && onEdit ? (
            <button type="button" className={btnSmall} onClick={onEdit}>
              Edit
            </button>
          ) : null}
        </>
      }
    >
      <div role="tablist" aria-label="Product" className="-mx-4 -mt-3 flex shrink-0 gap-1 border-b border-line px-4">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={on === t.id}
            onClick={() => onTab(t.id)}
            className={cx('-mb-px border-b-2 px-2.5 py-2 text-[13px] font-semibold', on === t.id ? 'border-primary text-primary' : 'border-transparent text-ink-2 hover:text-ink')}
          >
            {t.label}
          </button>
        ))}
      </div>
      {q.isLoading ? (
        <Spinner />
      ) : q.error ? (
        <ErrorNote error={q.error} onRetry={() => void q.refetch()} />
      ) : d ? (
        on === 'sales' ? (
          <Sales id={id} org={org} />
        ) : on === 'purchase' ? (
          <Purchases id={id} org={org} />
        ) : on === 'history' ? (
          <History id={id} org={org} />
        ) : (
          <Overview d={d} onOpenProduct={onOpenProduct} />
        )
      ) : null}
    </SidePanel>
  );
}

function Block({ title, sub, children }: { title: string; sub?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5">
      <div className="flex items-baseline gap-2">
        <b className="text-[13px] text-ink">{title}</b>
        {sub ? <span className="text-[12px] text-ink-3">{sub}</span> : null}
      </div>
      {children}
    </section>
  );
}

function Tile({ label, value, tone }: { label: string; value: string; tone?: 'red' | 'amber' }) {
  return (
    <div className="flex flex-col rounded-[10px] border border-line px-3 py-2">
      <span className="text-[11.5px] font-semibold text-ink-3">{label}</span>
      <b className={cx('text-[18px] tabular-nums', tone === 'red' ? 'text-danger' : tone === 'amber' ? 'text-[#9A4A06] dark:text-warning' : 'text-ink')}>{value}</b>
    </div>
  );
}

function Overview({ d, onOpenProduct }: { d: ProductDetail; onOpenProduct: (id: number) => void }) {
  const p = d.product;
  const u = p.unit_code;
  const t = d.totals;
  const c = d.consumption;
  const avail = num(t.available) ?? 0;
  const seesCost = p.cost_price !== null || d.levels.some((l) => l.average_cost !== null);
  const reorder = num(p.reorder_point);

  return (
    <>
      {p.images?.length ? <Gallery images={p.images} name={p.name} /> : null}
      {p.is_stocked ? (
        <div className="grid grid-cols-4 gap-2">
          <Tile label="Available" value={qty(t.available)} tone={avail <= 0 ? 'red' : reorder !== null && avail <= reorder ? 'amber' : undefined} />
          <Tile label="On hand" value={qty(t.on_hand)} />
          <Tile label="Reserved" value={qty(t.reserved)} />
          <Tile label="Incoming" value={qty(t.incoming)} />
        </div>
      ) : (
        <span className="rounded-[10px] bg-subtle px-3 py-2 text-[12.5px] text-ink-2">{kindLabel(p.kind)} — not held in stock, so there is nothing on a shelf to count.</span>
      )}
      {p.is_stocked ? (
        <Block title="Where it is">
          <div className="overflow-hidden rounded-[10px] border border-line">
            <div className="flex gap-2 border-b border-line bg-ground px-3 py-1.5 text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase">
              <span className="min-w-0 flex-1">Warehouse</span>
              <span className="w-[70px] text-right">On hand</span>
              <span className="w-[70px] text-right">Reserved</span>
              <span className="w-[70px] text-right">Available</span>
              {seesCost ? <span className="w-[96px] text-right">Avg cost</span> : null}
            </div>
            {d.levels.length ? (
              d.levels.map((l) => (
                <div key={l.warehouse_id} className="flex gap-2 border-b border-line/60 px-3 py-1.5 text-[12.5px] last:border-b-0">
                  <span className="flex min-w-0 flex-1 flex-col">
                    <b className="truncate text-ink">{l.warehouse}</b>
                    {l.last_movement_at ? <span className="text-[11px] text-ink-3">moved {stampWords(l.last_movement_at)}</span> : null}
                  </span>
                  <span className="w-[70px] text-right text-ink tabular-nums">{qty(l.on_hand)}</span>
                  <span className="w-[70px] text-right text-ink-2 tabular-nums">{qty(l.reserved)}</span>
                  <b className={cx('w-[70px] text-right tabular-nums', (num(l.available) ?? 0) <= 0 ? 'text-danger' : 'text-ink')}>{qty(l.available)}</b>
                  {seesCost ? <span className="w-[96px] text-right text-ink-2 tabular-nums">{cost(l.average_cost)}</span> : null}
                </div>
              ))
            ) : (
              <span className="block px-3 py-3 text-[12.5px] text-ink-3">No warehouse has held any yet.</span>
            )}
          </div>
        </Block>
      ) : null}
      {p.is_stocked && c ? (
        <Block title="Consumption" sub={`the last ${c.days} days`}>
          <div className="grid grid-cols-3 gap-2 text-[12.5px]">
            <span className="flex flex-col rounded-[10px] bg-subtle px-3 py-2 text-ink-3">
              Issued <b className="text-[15px] text-ink tabular-nums">{qty(c.issued, u)}</b>
            </span>
            <span className="flex flex-col rounded-[10px] bg-subtle px-3 py-2 text-ink-3">
              Average per day <b className="text-[15px] text-ink tabular-nums">{qty(Math.round((num(c.per_day) ?? 0) * 10) / 10)}</b>
            </span>
            <span className="flex flex-col rounded-[10px] bg-subtle px-3 py-2 text-ink-3">
              Days of cover <b className="text-[15px] text-ink tabular-nums">{c.days_cover === null ? '—' : qty(Math.floor(c.days_cover))}</b>
            </span>
          </div>
        </Block>
      ) : null}
      {d.variants.length ? (
        <Block title="Variants" sub={`${d.variants.length}`}>
          <div className="flex flex-col">
            {d.variants.map((v) => (
              <button key={v.id} type="button" onClick={() => onOpenProduct(Number(v.id))} className="flex items-center gap-2 border-b border-line/60 py-1.5 text-left text-[12.5px] last:border-b-0 hover:bg-subtle">
                <b className="min-w-0 flex-1 truncate text-ink">{v.variant_label ?? v.code}</b>
                <span className="font-mono text-[11px] text-ink-3">{v.code}</span>
                <span className="w-[80px] text-right text-ink-2 tabular-nums">{qty(num(v.on_hand)! - (num(v.reserved) ?? 0))} avail</span>
                <span className="w-[80px] text-right text-ink tabular-nums">{whole(v.unit_price)}</span>
              </button>
            ))}
          </div>
        </Block>
      ) : null}
      {d.bundle.length ? (
        <Block title="What it contains">
          <div className="flex flex-col">
            {d.bundle.map((b) => (
              <button key={b.id} type="button" onClick={() => onOpenProduct(Number(b.component_id))} className="flex items-center gap-2 border-b border-line/60 py-1.5 text-left text-[12.5px] last:border-b-0 hover:bg-subtle">
                <b className="min-w-0 flex-1 truncate text-ink">{b.name}</b>
                <span className="text-ink-2 tabular-nums">× {qty(b.quantity, b.unit)}</span>
              </button>
            ))}
          </div>
        </Block>
      ) : null}
      {d.attributes.length ? (
        <Block title="Specification">
          <div className="flex flex-col gap-0.5 text-[12.5px] text-ink">
            {d.attributes.map((a) => (
              <span key={a.attribute_id}>
                <span className="text-ink-3">{a.attribute}:</span> {[a.value ?? a.text_value, a.unit].filter(Boolean).join(' ') || '—'}
              </span>
            ))}
          </div>
        </Block>
      ) : null}
      <Block title="Details">
        <div className="text-[12.5px]">
          <Facts
            rows={[
              ['Kind', kindLabel(p.kind)],
              ['Tracking', p.is_stocked ? trackingLabel(p.tracking) : 'Not stocked'],
              ['Costing', costingLabel(p.costing_method)],
              ['Unit', p.unit_code ?? p.unit ?? '—'],
              ['Category', p.category ?? '—'],
              ['Brand', p.brand ?? '—'],
              ['Selling price', cost(p.unit_price, p.currency)],
              ...(p.cost_price !== null ? ([['Cost price', cost(p.cost_price, p.currency)]] as Array<[string, string]>) : []),
              ...(p.average_cost !== null && num(p.average_cost) ? ([['Average cost', cost(p.average_cost, p.currency)]] as Array<[string, string]>) : []),
              ['Tax rate', num(p.tax_rate) ? `${qty(p.tax_rate)}%` : '—'],
              ['Reorder point', reorder !== null ? qty(reorder, u) : '—'],
              ['Reorder quantity', num(p.reorder_qty) !== null ? qty(p.reorder_qty, u) : '—'],
              ['Lead time', num(p.lead_time_days) ? `${p.lead_time_days} ${Number(p.lead_time_days) === 1 ? 'day' : 'days'}` : '—'],
              ['Barcode', p.barcode ? <span className="font-mono">{p.barcode}</span> : '—'],
              ['HS code', p.hs_code ?? '—'],
            ]}
          />
        </div>
        {p.description ? <DescriptionView value={p.description} /> : null}
      </Block>
      {d.prices.length ? (
        <Block title="Price lists">
          <div className="flex flex-col text-[12.5px]">
            {d.prices.map((r) => (
              <span key={r.id} className="flex gap-2 border-b border-line/60 py-1 last:border-b-0">
                <span className="min-w-0 flex-1 truncate text-ink">{r.price_list}</span>
                <span className="text-ink-3">{num(r.min_qty) && num(r.min_qty)! > 1 ? `from ${qty(r.min_qty)}` : ''}</span>
                <b className="text-ink tabular-nums">{cost(r.price, r.currency)}</b>
              </span>
            ))}
          </div>
        </Block>
      ) : null}
    </>
  );
}

function Sales({ id, org }: { id: number; org: string }) {
  const { navigate } = useTab();
  const perms = useStore(app, (s) => s.bootstrap?.permissions);
  // An invoice opens in Invoices: only for whoever has that app, and its permission.
  const billing = useCanOpen('billing') && !!perms && (perms.includes('*') || perms.includes('billing.view'));
  const q = useQuery({
    queryKey: K.trade(id, org),
    queryFn: ({ signal }) => fetchTrade(id, org, signal),
  });
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorNote error={q.error} onRetry={() => void q.refetch()} />;
  const t = q.data!;
  const cur = t.sales[0]?.currency ?? null;
  return (
    <Block title="Sold on" sub={t.sales.length ? `${qty(t.sold_qty)} ${num(t.sold_qty) === 1 ? 'unit' : 'units'} · ${whole(t.sold_value, cur)}` : undefined}>
      <Table
        cols={[
          ['Document', null],
          ['Customer', 150],
          ['Qty', 56],
          ['Each', 84],
          ['Total', 96],
        ]}
        empty="Not on any issued invoice yet."
        rows={t.sales.map((s) => ({
          key: `${s.id}-${s.number}-${s.quantity}`,
          onClick: billing ? () => navigate(`/billing?invoice=${s.id}`) : undefined,
          cells: [
            <span key="d" className="flex min-w-0 flex-col">
              <b className="truncate text-ink">
                {s.number ?? 'Invoice'}
                {s.type === 'credit_note' ? <span className="ml-1.5 font-semibold text-ink-3">credit note</span> : null}
              </b>
              <span className="text-[11px] text-ink-3">{s.issue_date ? dateLabel(s.issue_date) : ''}</span>
            </span>,
            <span key="c" className="truncate text-ink-2">
              {s.customer ?? '—'}
            </span>,
            <span key="q" className="text-right tabular-nums">
              {qty(s.quantity)}
            </span>,
            <span key="e" className="text-right text-ink-2 tabular-nums">
              {whole(s.unit_price)}
            </span>,
            <b key="t" className={cx('text-right tabular-nums', (num(s.net_total) ?? 0) < 0 ? 'text-danger' : 'text-ink')}>
              {whole(s.net_total)}
            </b>,
          ],
        }))}
      />
    </Block>
  );
}

function Purchases({ id, org }: { id: number; org: string }) {
  const q = useQuery({
    queryKey: K.trade(id, org),
    queryFn: ({ signal }) => fetchTrade(id, org, signal),
  });
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorNote error={q.error} onRetry={() => void q.refetch()} />;
  const t = q.data!;
  return (
    <Block title="Bought on" sub="orders and supplier bills">
      <Table
        cols={[
          ['Document', null],
          ['Vendor', 150],
          ['Qty', 56],
          ['Each', 84],
          ['Total', 96],
        ]}
        empty="Not on any purchase order or bill yet."
        rows={t.purchases.map((s) => ({
          key: `${s.kind}-${s.id}-${s.quantity}`,
          onClick: s.kind === 'order' ? () => openWeb('purchasing') : undefined,
          cells: [
            <span key="d" className="flex min-w-0 flex-col">
              <b className="truncate text-ink">
                {s.number ?? '—'} <span className="font-semibold text-ink-3">{s.kind === 'bill' ? 'bill' : 'order'}</span>
              </b>
              <span className="text-[11px] text-ink-3">{[s.doc_date ? dateLabel(s.doc_date) : null, s.status?.replace(/_/g, ' ')].filter(Boolean).join(' · ')}</span>
            </span>,
            <span key="v" className="truncate text-ink-2">
              {s.party ?? '—'}
            </span>,
            <span key="q" className="text-right tabular-nums">
              {qty(s.quantity)}
            </span>,
            <span key="e" className="text-right text-ink-2 tabular-nums">
              {whole(s.unit_cost)}
            </span>,
            <b key="t" className="text-right text-ink tabular-nums">
              {whole(s.net_total)}
            </b>,
          ],
        }))}
      />
    </Block>
  );
}

function History({ id, org }: { id: number; org: string }) {
  const q = useQuery({
    queryKey: K.timeline(id, org),
    queryFn: ({ signal }) => fetchTimeline(id, org, signal),
  });
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorNote error={q.error} onRetry={() => void q.refetch()} />;
  const t = q.data!;
  // Movements and catalogue edits on one line of time, newest first.
  const events = [...t.movements.map((m) => ({ at: m.moved_at, key: `m${m.id}`, m })), ...t.activity.map((a) => ({ at: a.created_at, key: `a${a.id}`, a }))].sort((x, y) => (x.at < y.at ? 1 : x.at > y.at ? -1 : 0));
  return (
    <Block title="Everything that happened">
      <Table
        cols={[
          ['When', 92],
          ['What', null],
          ['Where', 110],
          ['Qty', 60],
          ['Balance', 64],
        ]}
        empty="Nothing has happened to it yet."
        rows={events.map((e) => {
          if ('m' in e && e.m) {
            const m = e.m;
            const n = num(m.quantity) ?? 0;
            return {
              key: e.key,
              cells: [
                <span key="w" className="text-ink-2">
                  {stampWords(m.moved_at)}
                </span>,
                <span key="x" className="flex min-w-0 flex-col">
                  <span className="truncate text-ink">{moveWhat(m)}</span>
                  {m.user || m.note ? <span className="truncate text-[11px] text-ink-3">{[m.user, m.note].filter(Boolean).join(' · ')}</span> : null}
                </span>,
                <span key="p" className="truncate text-ink-2">
                  {m.warehouse ?? '—'}
                </span>,
                <span key="q" className="text-right">
                  <Signed value={n} text={signed(n)} />
                </span>,
                <span key="b" className="text-right text-ink-2 tabular-nums">
                  {qty(m.balance_after)}
                </span>,
              ],
            };
          }
          const a = (e as { a: Timeline['activity'][number] }).a;
          return {
            key: e.key,
            cells: [
              <span key="w" className="text-ink-2">
                {stampWords(a.created_at)}
              </span>,
              <span key="x" className="flex min-w-0 flex-col">
                <span className="flex items-center gap-1.5 truncate text-ink">
                  <Pill>{a.action}</Pill> {a.summary ?? ''}
                </span>
                {a.user ? <span className="truncate text-[11px] text-ink-3">{a.user}</span> : null}
              </span>,
              <span key="p" className="text-ink-3">
                Catalogue
              </span>,
              <span key="q" />,
              <span key="b" />,
            ],
          };
        })}
      />
      {t.movements.length >= 60 ? (
        <span className="text-center text-[12px] text-ink-3">
          The latest 60 movements.{' '}
          <button type="button" className="font-semibold text-primary hover:underline" onClick={() => openWeb('movements')}>
            See every one <Icon name="external" size={11} className="inline" />
          </button>
        </span>
      ) : null}
    </Block>
  );
}

type Timeline = Awaited<ReturnType<typeof fetchTimeline>>;

/** A small table: fixed-width columns (null = the flexible one), a row per item. */
function Table({ cols, rows, empty }: { cols: Array<[string, number | null]>; rows: Array<{ key: string; cells: ReactNode[]; onClick?: () => void }>; empty: string }) {
  return (
    <div className="overflow-hidden rounded-[10px] border border-line">
      <div className="flex gap-2 border-b border-line bg-ground px-3 py-1.5 text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase">
        {cols.map(([l, w], i) => (
          <span key={l} className={cx(w == null ? 'min-w-0 flex-1' : 'shrink-0', i >= 3 && 'text-right')} style={w == null ? undefined : { width: w }}>
            {l}
          </span>
        ))}
      </div>
      {rows.length ? (
        rows.map((r) => {
          const Tag = r.onClick ? 'button' : 'div';
          return (
            <Tag
              key={r.key}
              {...(r.onClick ? { type: 'button' as const, onClick: r.onClick } : {})}
              className={cx('flex w-full items-center gap-2 border-b border-line/60 px-3 py-1.5 text-left text-[12.5px] last:border-b-0', r.onClick && 'hover:bg-subtle')}
            >
              {r.cells.map((c, i) => {
                const w = cols[i]?.[1];
                return (
                  <span key={i} className={cx(w == null ? 'flex min-w-0 flex-1' : 'flex shrink-0', i >= 3 && 'justify-end')} style={w == null ? undefined : { width: w }}>
                    {c}
                  </span>
                );
              })}
            </Tag>
          );
        })
      ) : (
        <span className="block px-3 py-3 text-[12.5px] text-ink-3">{empty}</span>
      )}
    </div>
  );
}

/** The product's pictures: the one looked at large, the rest to pick from. */
function Gallery({ images, name }: { images: ProductImage[]; name: string }) {
  const [at, setAt] = useState(0);
  const shown = images[Math.min(at, images.length - 1)]!;
  return (
    <div className="flex gap-2">
      <img src={pictureSrc(shown.url)} alt={shown.caption ?? name} className="h-[180px] min-w-0 flex-1 rounded-[10px] border border-line bg-subtle object-contain" />
      {images.length > 1 ? (
        <div className="flex max-h-[180px] w-[52px] shrink-0 flex-col gap-1.5 overflow-y-auto" aria-label="Pictures">
          {images.map((img, n) => (
            <button
              key={img.id}
              type="button"
              aria-label={`Picture ${n + 1}${img.main ? ' (main)' : ''}`}
              aria-pressed={n === at}
              onClick={() => setAt(n)}
              className={cx('size-[48px] shrink-0 overflow-hidden rounded-[7px] border bg-subtle', n === at ? 'border-primary' : 'border-line')}
            >
              <img src={pictureSrc(img.url)} alt="" className="size-full object-cover" />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

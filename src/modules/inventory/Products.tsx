import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { lazy, Suspense, useMemo, useState } from 'react';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { btn, btnPrimary, Empty, input, PageHead } from '../hr/parts';
import { fetchCategories, fetchProducts, K, num, PER_PAGE, pictureSrc, qty, trackingLabel, treeOf, whole, type Company, type Product, type ProductFilters } from './api';
import { minWidth, Pill } from './parts';
import { Checkbox } from '../../components/Checkbox';
import { ContextMenu } from '../../components/ContextMenu';
import { isMac } from '../../core/bridge';
import { useWedge } from '../../core/scanner';
import { lookupProducts } from './control';
import ProductPane, { labelFor } from './ProductPane';

const NewCategory = lazy(() => import('./Categories').then((m) => ({ default: m.NewCategory })));

/**
 * Products (InvProducts): the category tree beside the catalogue — what is
 * available and on hand, coming in and sold, the price and (for those who
 * may see it) the cost. Choosing a category takes in everything filed under
 * it. The pencil edits a product.
 *
 * On the desktop a product opens in a tab beside a compact list (the
 * "Desktop products" design; tabs.ts): several stay open at once. Right-click
 * a row (or Shift+F10) for its quick actions — open it in a tab or a window
 * of the app's own, print its label, adjust its stock, duplicate it, Product
 * 360. The search box takes a scan: an exact code or barcode opens it.
 */
const mod = isMac ? '⌘' : 'Ctrl+';
const TREE_KEY = 'inventory.tree';

function savedTree(): boolean {
  try {
    return localStorage.getItem(TREE_KEY) !== '0';
  } catch {
    return true;
  }
}

type Filters = Omit<ProductFilters, 'page'>;

export default function Products({
  org,
  companies,
  currency,
  canCost,
  canCatalogue,
  openId,
  onOpen,
  onNew,
  onEdit,
  onManage,
  openIds = [],
  ptab = 'overview',
  onPtab,
  onCloseTab,
  onOpenInTab,
  onOpenInWindow,
  on360,
  onAdjust,
  onDuplicate,
}: {
  org: string;
  companies: Company[];
  currency: string | null;
  canCost: boolean;
  canCatalogue: boolean;
  openId: number | null;
  onOpen: (id: number) => void;
  onNew: () => void;
  onEdit: (id: number) => void;
  onManage: () => void;
  /** The products open in tabs beside the list (tabs.ts). */
  openIds?: number[];
  ptab?: string;
  onPtab?: (t: string) => void;
  onCloseTab?: (id: number) => void;
  onOpenInTab?: (id: number) => void;
  onOpenInWindow?: (id: number) => void;
  on360?: (id: number) => void;
  onAdjust?: (() => void) | null;
  onDuplicate?: ((id: number) => void) | null;
}) {
  const [q, setQ] = useState('');
  const [stock, setStock] = useState<Filters['stock']>('');
  const [archived, setArchived] = useState(false);
  const [category, setCategory] = useState<number | null>(null);
  const [tree, setTree] = useState(savedTree);
  const [adding, setAdding] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number; p: Product } | null>(null);
  const f: Filters = { q, category, stock, archived };
  const split = openId !== null && openIds.includes(openId) && !!onCloseTab;
  const menuFor = (p: Product, x: number, y: number) => setMenu({ x, y, p });
  const list = useInfiniteQuery({
    queryKey: K.products(org, f),
    initialPageParam: 1,
    queryFn: ({ pageParam, signal }) => fetchProducts(org, { ...f, page: pageParam }, signal),
    getNextPageParam: (last, pages) => (pages.length * PER_PAGE < last.total ? pages.length + 1 : undefined),
    placeholderData: keepPreviousData,
  });
  const cats = useQuery({
    queryKey: K.categories(org),
    queryFn: ({ signal }) => fetchCategories(org, signal),
    staleTime: 60_000,
  });
  const nodes = useMemo(() => treeOf(cats.data ?? []), [cats.data]);
  const rows = useMemo(() => (list.data?.pages ?? []).flatMap((p) => p.products), [list.data]);
  const total = list.data?.pages[0]?.total ?? 0;
  // A scan: an exact code or barcode opens the product; anything else stays a search.
  const scanned = async (code: string) => {
    const t = code.trim().toLowerCase();
    if (!t) return;
    const hit = rows.find((p) => [p.code, p.barcode].some((x) => x && x.toLowerCase() === t));
    if (hit) return onOpen(hit.id);
    try {
      const found = (await lookupProducts(org, code.trim(), null)).find((p) => [p.code, p.barcode].some((x) => x && x.toLowerCase() === t));
      if (found) return onOpen(Number(found.id));
    } catch {
      /* the search below says what there is */
    }
    setQ(code.trim());
  };
  useWedge((code) => void scanned(code), !menu && !adding);
  const toggleTree = () => {
    setTree(!tree);
    try {
      localStorage.setItem(TREE_KEY, tree ? '0' : '1');
    } catch {
      /* a convenience */
    }
  };
  const chosen = nodes.find((n) => n.id === category);
  const W = { cat: 130, trk: 84, avail: 92, inc: 60, sold: 52, price: 80, cost: 80, edit: 26 };
  // Beside the tree the category column goes: the tree says it, and so does
  // the line under each product's name.
  const showCat = !tree;
  const min = minWidth(tree ? 150 : 200, [...(showCat ? [W.cat] : []), W.trk, W.avail, W.inc, W.sold, W.price, ...(canCost ? [W.cost] : []), ...(canCatalogue ? [W.edit] : [])]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 px-6 py-5">
      <PageHead title="Products" sub={chosen ? `In ${chosen.name}, and everything under it` : undefined}>
        {canCatalogue ? (
          <button type="button" className={btnPrimary} onClick={onNew}>
            <Icon name="plus" size={15} /> New product
          </button>
        ) : null}
      </PageHead>
      <div className="flex items-center gap-2">
        <button type="button" className={cx(btn, '!px-2.5')} aria-label={tree ? 'Hide categories' : 'Show categories'} aria-pressed={tree} title="Categories" onClick={toggleTree}>
          <Icon name="list" size={15} />
        </button>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void scanned(q);
          }}
          placeholder="Search or scan"
          aria-label="Search products"
          className={input + ' !w-[280px]'}
        />
        <Select
          aria-label="Stock"
          value={stock}
          onValueChange={setStock}
          options={[
            { value: '', label: 'Any stock' },
            { value: 'in', label: 'In stock' },
            { value: 'low', label: 'At or below minimum' },
            { value: 'out', label: 'Out of stock' },
          ]}
          className="h-[34px] w-[190px] rounded-[8px] border border-line bg-surface px-2.5 text-[13px] font-medium text-ink"
        />
        <label className="flex items-center gap-1.5 font-semibold text-ink">
          <Checkbox checked={archived} onChange={(e) => setArchived(e.target.checked)} />
          Archived
        </label>
      </div>
      <div className="flex min-h-0 flex-1 gap-3">
        {tree && !split ? (
          <aside aria-label="Categories" className="flex w-[210px] shrink-0 flex-col overflow-hidden rounded-[12px] border border-line bg-surface">
            <div className="flex items-center gap-1 border-b border-line px-3 py-2.5">
              <b className="flex-1 text-ink">Categories</b>
              {canCatalogue ? (
                <>
                  <button type="button" aria-label="Manage categories" title="Manage categories" onClick={onManage} className="flex h-6 w-6 items-center justify-center rounded-[6px] text-ink-3 hover:bg-subtle hover:text-ink">
                    <Icon name="compose" size={14} />
                  </button>
                  <button type="button" aria-label="Add category" title="Add category" onClick={() => setAdding(true)} className="flex h-6 w-6 items-center justify-center rounded-[6px] text-ink-3 hover:bg-subtle hover:text-ink">
                    <Icon name="plus" size={14} />
                  </button>
                </>
              ) : null}
            </div>
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto py-1 scroll-thin">
              <TreeRow label="All products" on={category === null} level={0} onClick={() => setCategory(null)} />
              {nodes.map((n) => (
                <TreeRow key={n.id} label={n.name} count={n.total} on={category === n.id} level={n.level} onClick={() => setCategory(n.id)} muted={n.status !== 'active'} />
              ))}
              {cats.isLoading ? <Spinner /> : null}
              {!cats.isLoading && !nodes.length ? <span className="px-3 py-2 text-[12px] text-ink-3">No categories yet.</span> : null}
            </div>
          </aside>
        ) : null}
        <div className={cx('flex min-h-0 flex-col overflow-hidden rounded-[12px] border border-line bg-surface', split ? 'w-[400px] shrink-0 2xl:w-[520px]' : 'min-w-0 flex-1')}>
          <div className="min-h-0 flex-1 overflow-auto scroll-thin">
            {split ? (
              <div aria-label="Products">
                {list.isLoading ? <Spinner /> : list.error ? <ErrorNote error={list.error} onRetry={() => void list.refetch()} /> : null}
                {rows.map((p) => (
                  <CompactRow key={p.id} p={p} on={openId === p.id} open={openIds.includes(p.id)} onOpen={onOpen} onMenu={menuFor} onWindow={onOpenInWindow} />
                ))}
                {!list.isLoading && !rows.length ? <Empty text="No product matches." /> : null}
              </div>
            ) : (
            <div style={{ minWidth: min }}>
              <div className="sticky top-0 z-10 flex gap-2.5 border-b border-line bg-ground px-3.5 py-2 text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase">
                <span className="min-w-0 flex-1">Product</span>
                {showCat ? (
                  <span className="shrink-0" style={{ width: W.cat }}>
                    Category
                  </span>
                ) : null}
                <span className="shrink-0" style={{ width: W.trk }}>
                  Tracking
                </span>
                <span className="shrink-0 text-right" style={{ width: W.avail }}>
                  Available
                </span>
                <span className="shrink-0 text-right" style={{ width: W.inc }}>
                  Incoming
                </span>
                <span className="shrink-0 text-right" style={{ width: W.sold }}>
                  Sold
                </span>
                <span className="shrink-0 text-right" style={{ width: W.price }}>
                  Price
                </span>
                {canCost ? (
                  <span className="shrink-0 text-right" style={{ width: W.cost }}>
                    Cost
                  </span>
                ) : null}
                {canCatalogue ? <span className="shrink-0" style={{ width: W.edit }} /> : null}
              </div>
              <div>
                {list.isLoading ? (
                  <Spinner />
                ) : list.error ? (
                  <ErrorNote error={list.error} onRetry={() => void list.refetch()} />
                ) : rows.length ? (
                  rows.map((p) => <Row key={p.id} p={p} on={openId === p.id} w={W} showCat={showCat} currency={currency} canCost={canCost} onOpen={onOpen} onEdit={canCatalogue ? onEdit : undefined} onMenu={menuFor} onWindow={onOpenInWindow} />)
                ) : (
                  <Empty text={q || stock || category !== null ? 'No product matches.' : archived ? 'No products yet.' : 'No products yet. Add the first with New product.'} />
                )}
              </div>
            </div>
            )}
          </div>
          {rows.length ? (
            <div className="flex shrink-0 items-center justify-center gap-3 border-t border-line px-3.5 py-2 text-[12px] text-ink-3">
              <span>
                {rows.length.toLocaleString()} of {total.toLocaleString()}
              </span>
              {list.hasNextPage ? (
                <button type="button" className="font-semibold text-primary hover:underline" onClick={() => void list.fetchNextPage()} disabled={list.isFetchingNextPage}>
                  {list.isFetchingNextPage ? 'Loading…' : 'Load more'}
                </button>
              ) : null}
              {split ? <span className="hidden xl:inline">· right-click a row for quick actions · {mod}↵ opens it in a new window</span> : null}
            </div>
          ) : null}
        </div>
        {split && openId !== null ? (
          <ProductPane
            org={org}
            ids={openIds}
            active={openId}
            ptab={ptab}
            onActivate={onOpen}
            onClose={onCloseTab!}
            onTab={(t) => onPtab?.(t)}
            onOpenProduct={onOpen}
            onEdit={canCatalogue ? onEdit : null}
            on360={(id) => on360?.(id)}
          />
        ) : null}
      </div>
      {menu ? (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          label={`Quick actions for ${menu.p.name}`}
          onClose={() => setMenu(null)}
          width={240}
          sections={[
            {
              id: 'open',
              items: [
                ...(onOpenInTab ? [{ id: 'tab', label: 'Open in new tab', shortcut: `${mod}T`, onSelect: () => onOpenInTab(menu.p.id) }] : []),
                ...(onOpenInWindow ? [{ id: 'win', label: 'Open in new window', shortcut: `${mod}↵`, onSelect: () => onOpenInWindow(menu.p.id) }] : []),
                ...(on360 ? [{ id: '360', label: 'Open Product 360', onSelect: () => on360(menu.p.id) }] : []),
              ],
            },
            {
              id: 'do',
              items: [
                { id: 'label', label: 'Print label', shortcut: `${mod}P`, onSelect: () => void labelFor(org, menu.p.id, menu.p) },
                ...(onAdjust && menu.p.is_stocked ? [{ id: 'adj', label: 'Adjust stock', onSelect: onAdjust }] : []),
                ...(onDuplicate ? [{ id: 'dup', label: 'Duplicate', onSelect: () => onDuplicate(menu.p.id) }] : []),
                ...(canCatalogue ? [{ id: 'edit', label: 'Edit', onSelect: () => onEdit(menu.p.id) }] : []),
              ],
            },
          ]}
        />
      ) : null}
      {adding ? (
        <Suspense fallback={null}>
          <NewCategory org={org} companies={companies} parent={category} tree={nodes} onClose={() => setAdding(false)} />
        </Suspense>
      ) : null}
    </div>
  );
}

function TreeRow({ label, count, on, level, onClick, muted }: { label: string; count?: number; on: boolean; level: number; onClick: () => void; muted?: boolean }) {
  return (
    <button
      type="button"
      aria-current={on ? 'true' : undefined}
      onClick={onClick}
      className={cx('flex shrink-0 items-center gap-2 py-1.5 pr-3 text-left text-[12.5px]', on ? 'bg-selection font-bold text-primary dark:bg-selection dark:text-primary' : 'text-ink hover:bg-subtle', muted && !on && 'text-ink-3')}
      style={{ paddingLeft: 12 + level * 16 }}
    >
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count !== undefined ? <span className="shrink-0 text-[11.5px] font-medium text-ink-3 tabular-nums">{count}</span> : null}
    </button>
  );
}

function Row({
  p,
  on,
  w,
  showCat,
  currency,
  canCost,
  onOpen,
  onEdit,
  onMenu,
  onWindow,
}: {
  p: Product;
  on: boolean;
  w: Record<'cat' | 'trk' | 'avail' | 'inc' | 'sold' | 'price' | 'cost' | 'edit', number>;
  showCat: boolean;
  currency: string | null;
  canCost: boolean;
  onOpen: (id: number) => void;
  onEdit?: (id: number) => void;
  onMenu: (p: Product, x: number, y: number) => void;
  onWindow?: (id: number) => void;
}) {
  const avail = num(p.available);
  const onHand = num(p.on_hand);
  const stocked = p.is_stocked;
  const other = p.currency && currency && p.currency !== currency ? p.currency : null;
  return (
    <div
      data-product={p.id}
      onContextMenu={(e) => {
        e.preventDefault();
        onMenu(p, e.clientX, e.clientY);
      }}
      className={cx('group flex items-center gap-2.5 border-b border-line/60 px-3.5 py-2 text-[12.5px] last:border-b-0 hover:bg-subtle/60', on && 'bg-info-soft dark:bg-selection/40', !p.active && 'opacity-60')}>
      <button type="button" onClick={() => onOpen(p.id)} onKeyDown={(e) => rowKeys(e, p, onMenu, onWindow)} className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
        <Thumb key={p.image_url ?? ''} url={p.image_url ?? null} />
        <span className="flex min-w-0 flex-1 flex-col">
        <b className="truncate text-ink">
          {p.name}
          {p.variant_label ? ` — ${p.variant_label}` : ''}
          {!p.active ? <span className="ml-1.5 text-[11px] font-semibold text-ink-3">archived</span> : null}
        </b>
        <span className="truncate text-[11px] text-ink-3">
          <span className="font-mono">{[p.code, p.barcode].filter(Boolean).join(' · ') || '—'}</span>
          {!showCat && p.category ? ` · ${p.category}` : ''}
        </span>
        </span>
      </button>
      {showCat ? (
        <span className="shrink-0 truncate text-ink-2" style={{ width: w.cat }}>
          {p.category ?? '—'}
        </span>
      ) : null}
      <span className="shrink-0" style={{ width: w.trk }}>
        {stocked ? <Pill tone={p.tracking === 'none' ? 'grey' : 'blue'}>{trackingLabel(p.tracking, true)}</Pill> : <span className="text-[11.5px] text-ink-3">Not stocked</span>}
      </span>
      <span className="flex shrink-0 flex-col items-end" style={{ width: w.avail }}>
        {stocked ? (
          <>
            <b className={cx('tabular-nums', avail !== null && avail <= 0 ? 'text-danger' : p.low ? 'text-warning-ink dark:text-warning' : 'text-ink')}>{qty(avail, p.unit_code)}</b>
            {onHand !== null && onHand !== avail ? <span className="text-[11px] text-ink-3 tabular-nums">{qty(onHand)} on hand</span> : null}
          </>
        ) : (
          <span className="text-ink-3">—</span>
        )}
      </span>
      <span className="shrink-0 text-right text-ink-2 tabular-nums" style={{ width: w.inc }}>
        {stocked && num(p.incoming) ? qty(p.incoming) : '—'}
      </span>
      <span className="shrink-0 text-right text-ink-2 tabular-nums" style={{ width: w.sold }}>
        {num(p.sold_qty) ? qty(p.sold_qty) : '—'}
      </span>
      <span className="shrink-0 text-right text-ink tabular-nums" style={{ width: w.price }} title={p.currency ?? undefined}>
        {whole(p.unit_price, other)}
      </span>
      {canCost ? (
        <span className="shrink-0 text-right text-ink-2 tabular-nums" style={{ width: w.cost }}>
          {num(p.cost_price) ? whole(p.cost_price, other) : '—'}
        </span>
      ) : null}
      {onEdit ? (
        <button
          type="button"
          aria-label={`Edit ${p.name}`}
          title="Edit"
          onClick={() => onEdit(p.id)}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] text-ink-3 opacity-0 group-hover:opacity-100 hover:bg-surface hover:text-ink focus:opacity-100"
          style={{ width: w.edit }}
        >
          <Icon name="compose" size={14} />
        </button>
      ) : null}
    </div>
  );
}

/** The product's main picture, small; an empty tile when it has none or it cannot be read. */
function Thumb({ url, size = 30 }: { url: string | null; size?: number }) {
  const [broken, setBroken] = useState(false);
  return (
    <span className="grid shrink-0 place-items-center overflow-hidden rounded-[6px] border border-line bg-subtle" style={{ width: size, height: size }}>
      {url && !broken ? <img src={pictureSrc(url)} alt="" loading="lazy" className="size-full object-cover" onError={() => setBroken(true)} /> : null}
    </span>
  );
}

/** A row's keys: ⌘/Ctrl+Enter opens it in a window of its own; Shift+F10 or the menu key, its quick actions. */
function rowKeys(e: React.KeyboardEvent<HTMLElement>, p: Product, onMenu: (p: Product, x: number, y: number) => void, onWindow?: (id: number) => void) {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && onWindow) {
    e.preventDefault();
    onWindow(p.id);
  } else if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
    e.preventDefault();
    const r = e.currentTarget.getBoundingClientRect();
    onMenu(p, r.left + 24, r.bottom);
  }
}

/** The list beside the open products: picture, name, code and category, and what is on hand. */
function CompactRow({ p, on, open, onOpen, onMenu, onWindow }: { p: Product; on: boolean; open: boolean; onOpen: (id: number) => void; onMenu: (p: Product, x: number, y: number) => void; onWindow?: (id: number) => void }) {
  const onHand = num(p.on_hand);
  const avail = num(p.available);
  const out = p.is_stocked && avail !== null && avail <= 0;
  return (
    <button
      type="button"
      data-product={p.id}
      aria-current={on ? 'true' : undefined}
      onClick={() => onOpen(p.id)}
      onKeyDown={(e) => rowKeys(e, p, onMenu, onWindow)}
      onContextMenu={(e) => {
        e.preventDefault();
        onMenu(p, e.clientX, e.clientY);
      }}
      className={cx('flex w-full items-center gap-2.5 border-b border-line/60 px-3.5 py-2.5 text-left last:border-b-0', on ? 'bg-info-soft shadow-[inset_3px_0_0_var(--color-primary)] dark:bg-selection/40' : 'hover:bg-subtle/60', !p.active && 'opacity-60')}
    >
      <Thumb key={p.image_url ?? ''} url={p.image_url ?? null} size={40} />
      <span className="flex min-w-0 flex-1 flex-col">
        <b className="truncate text-[13.5px] text-ink">
          {p.name}
          {p.variant_label ? ` — ${p.variant_label}` : ''}
        </b>
        <span className="truncate text-[12px] text-ink-3">{[p.code, p.category].filter(Boolean).join(' · ') || '—'}</span>
      </span>
      {open && !on ? <span className="size-1.5 shrink-0 rounded-full bg-primary" title="Open in a tab" /> : null}
      <span className="flex shrink-0 flex-col items-end text-right tabular-nums">
        {p.is_stocked ? (
          <>
            <b className={cx('text-[13.5px]', out ? 'text-danger' : p.low ? 'text-warning-ink dark:text-warning' : 'text-ink')}>{qty(onHand)}</b>
            <span className="text-[11.5px] text-ink-3">{out ? 'out' : p.low ? 'low' : 'on hand'}</span>
          </>
        ) : (
          <span className="text-ink-3">—</span>
        )}
      </span>
    </button>
  );
}

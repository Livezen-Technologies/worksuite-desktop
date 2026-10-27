import { useRef, useState, type ReactNode, type RefObject } from 'react';
import type { PosProduct } from '@shared/pos';
import { Icon } from '../../components/Icon';
import { cx } from '../../components/ui';
import { useT } from './i18n';
import { imageUrl, thumbUrl } from './catalog';
import { BADGE, OFF, tintOf } from './look';
import { dots, GRID_PAGE, LIST_PAGE, pageCount, pageOf, shown } from './paging';
import { formatMoney } from './pricing';

/**
 * The counter's left side: the search (a scanner types into it too), the category, grid or list, where the grid
 * stands (the category's trail, how many, the categories used lately), fifteen products a page — five by three —
 * paged by the arrows, the dots or a swipe, and the quick actions under them. A product shows its category's tint,
 * its price-list discount (`discount_pct`) and its unit — and, where the catalogue carries them (Phase 2), its picture
 * (`capabilities.product_images`), a promotion's badge ("3 for 1,200") and its stock at the till's warehouse: low or
 * out (a badge, never a refusal — WorkSuite decides). An older catalogue carries none, and none is shown.
 */

/** A product's stock as a badge: low or out; nothing for in stock or untracked. */
export function stockBadge(p: Pick<PosProduct, 'stock_state' | 'stock_available'>): { tone: 'low' | 'out'; n: number | null } | null {
  if (p.stock_state === 'out') return { tone: 'out', n: null };
  if (p.stock_state === 'low') return { tone: 'low', n: typeof p.stock_available === 'number' ? Math.max(0, Math.round(p.stock_available * 1000) / 1000) : null };
  return null;
}

/**
 * The product's picture — the small copy kept on this computer first (offline too, worksuite-desktop#296), then the
 * live one — or the category's tint and a box when it has none (or neither loads).
 */
function Picture({ p, org, size }: { p: PosProduct; org: number | null; size: number }) {
  const [failed, setFailed] = useState(0);
  const sources = [thumbUrl(p), imageUrl(p, org)].filter((x): x is string => !!x);
  const src = sources[failed] ?? null;
  if (!src) return <Icon name="package" size={size} strokeWidth={1.4} />;
  return <img src={src} alt="" loading="lazy" draggable={false} onError={() => setFailed((n) => n + 1)} className="h-full w-full object-cover" />;
}
export type GridView = 'grid' | 'list';

export interface QuickAction {
  id: string;
  label: string;
  icon: string;
  onClick: (anchor: HTMLButtonElement) => void;
  disabled?: boolean;
  title?: string;
}

export default function ProductGrid({
  search,
  q,
  onQ,
  onSearchKey,
  category,
  categoryName,
  recentName,
  org = null,
  onCategory,
  onPickCategory,
  recent,
  view,
  onView,
  products,
  total,
  page,
  onPage,
  onAdd,
  disabled,
  actions,
  empty,
}: {
  search: RefObject<HTMLInputElement | null>;
  q: string;
  onQ: (q: string) => void;
  onSearchKey: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  category: string | null;
  /** What `category` is called (a group of the tree, the favourites): the key itself for a plain category. */
  categoryName?: string | null;
  recentName?: (c: string) => string;
  /** The till's company, for its products' pictures. */
  org?: number | null;
  onCategory: (c: string | null) => void;
  onPickCategory: () => void;
  recent: string[];
  view: GridView;
  onView: (v: GridView) => void;
  products: PosProduct[];
  /** Every product in the catalogue, for "All products". */
  total: number;
  page: number;
  onPage: (p: number) => void;
  onAdd: (p: PosProduct) => void;
  disabled: boolean;
  actions: QuickAction[];
  /** Shown in place of the grid: no catalogue yet, nothing matches. */
  empty: ReactNode;
}) {
  const t = useT();
  const size = view === 'grid' ? GRID_PAGE : LIST_PAGE;
  const pages = pageCount(products.length, size);
  const items = pageOf(products, page, size);
  const at = shown(products.length, page, size);
  const swipe = useRef<number | null>(null);
  const shownName = category ? (categoryName ?? category) : null;

  return (
    <section aria-label={t('pos.products')} className="flex min-w-0 flex-1 flex-col gap-3 py-4 pr-4 pl-5">
      <div className="flex gap-2.5">
        <label className="flex h-touch-md min-w-0 flex-1 items-center gap-2.5 rounded-[12px] border-2 border-primary bg-pos-panel px-4">
          <Icon name="scan" size={22} className="shrink-0 text-primary" />
          <input
            ref={search}
            value={q}
            onChange={(e) => onQ(e.target.value)}
            onKeyDown={onSearchKey}
            placeholder={t('pos.search')}
            aria-label={t('pos.search')}
            className="bare-focus min-w-0 flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-ink-3"
          />
          <kbd className="rounded-[4px] border border-slate-line px-1.5 py-0.5 font-mono text-[11px] text-ink-2">F2</kbd>
        </label>
        <button
          type="button"
          onClick={onPickCategory}
          aria-haspopup="dialog"
          className={cx('flex h-touch-md max-w-[240px] shrink-0 items-center gap-2.5 rounded-[12px] px-3.5', category ? 'bg-pos-bar text-white' : `${OFF} text-ink`)}
        >
          <Icon name="grid" size={20} />
          <span className="flex min-w-0 flex-col items-start leading-[1.15]">
            <span className="text-[11px] font-semibold opacity-75">{t('pos.category')}</span>
            <span className="max-w-[150px] truncate text-[14px] font-extrabold">{shownName ?? t('pos.allProducts')}</span>
          </span>
          <Icon name="chevron-down" size={16} />
        </button>
        <div role="radiogroup" aria-label={t('pos.view')} className={cx('flex shrink-0 gap-1 rounded-[12px] p-1', OFF)}>
          {(['grid', 'list'] as const).map((v) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={view === v}
              aria-label={t(v === 'grid' ? 'pos.viewGrid' : 'pos.viewList')}
              onClick={() => onView(v)}
              className={cx('flex h-touch w-touch items-center justify-center rounded-[9px]', view === v ? 'bg-pos-bar text-white' : 'text-ink-2 hover:bg-pos-key')}
            >
              <Icon name={v === 'grid' ? 'grid' : 'list'} size={20} />
            </button>
          ))}
        </div>
      </div>

      <div className="flex min-h-9 items-center gap-2">
        <span className="truncate text-[13px] font-bold">
          {category ? (
            <>
              <button type="button" className="hover:underline" onClick={() => onCategory(null)}>
                {t('pos.allProducts')}
              </button>
              {` › ${shownName}`}
            </>
          ) : (
            t('pos.allProducts')
          )}
        </span>
        <span className="shrink-0 text-[12px] text-ink-3">{t('pos.nProducts', { n: category || q.trim() ? products.length : total })}</span>
        <span className="flex-1" />
        {recent.length ? <span className="shrink-0 text-[12px] text-ink-3 max-lg:hidden">{t('pos.recent')}</span> : null}
        <div className="flex min-w-0 gap-1.5 overflow-hidden max-lg:hidden">
          {recent.map((c) => (
            <button
              key={c}
              type="button"
              aria-pressed={category === c}
              onClick={() => onCategory(category === c ? null : c)}
              className={cx('h-9 max-w-[140px] shrink-0 truncate rounded-full px-3.5 text-[12px] font-bold', category === c ? 'bg-pos-bar text-white' : `${OFF} text-ink`)}
            >
              {recentName ? recentName(c) : c}
            </button>
          ))}
        </div>
      </div>

      {empty ?? (
        <div
          className={cx('grid min-h-0 flex-1 touch-pan-y gap-2.5', view === 'grid' ? 'grid-cols-5 grid-rows-3' : 'grid-cols-1 grid-rows-8')}
          onPointerDown={(e) => {
            swipe.current = e.clientX;
          }}
          onPointerUp={(e) => {
            const from = swipe.current;
            swipe.current = null;
            if (from == null) return;
            const dx = e.clientX - from;
            if (Math.abs(dx) > 80) onPage(Math.min(pages - 1, Math.max(0, page + (dx < 0 ? 1 : -1))));
          }}
        >
          {items.map((p) => {
            const stock = stockBadge(p);
            const promo = p.promo_label ?? (p.discount_pct > 0 ? `−${p.discount_pct}%` : null);
            return view === 'grid' ? (
              <button
                key={p.id}
                type="button"
                onClick={() => onAdd(p)}
                aria-disabled={disabled || undefined}
                className={cx('flex min-h-0 flex-col items-stretch overflow-hidden rounded-pos text-left transition-transform active:scale-[.98]', OFF, stock?.tone === 'out' && 'opacity-70')}
              >
                <span className={cx('relative flex h-[78px] max-h-[45%] w-full shrink-0 items-center justify-center overflow-hidden rounded-t-pos', tintOf(p.category))}>
                  <Picture p={p} org={org} size={34} />
                  {promo ? <span className={cx('absolute top-2 left-2 max-w-[70%] truncate rounded-[6px] px-[7px] py-0.5 text-[10px] font-extrabold', BADGE.promo)}>{promo}</span> : null}
                  {stock ? (
                    <span className={cx('absolute top-2 right-2 rounded-[6px] px-[7px] py-0.5 text-[10px] font-extrabold', stock.tone === 'out' ? BADGE.stockOut : BADGE.stockLow)}>
                      {stock.tone === 'out' ? t('pos.stock.out') : stock.n !== null ? t('pos.stock.left', { n: stock.n }) : t('pos.stock.low')}
                    </span>
                  ) : null}
                </span>
                <span className="flex min-h-0 w-full flex-1 flex-col gap-1 px-2.5 pt-2 pb-2.5">
                  <span className="line-clamp-2 text-[13px] leading-tight font-bold text-ink">{p.name}</span>
                  <span className="mt-auto flex items-baseline justify-between gap-1">
                    <span className="font-mono text-[14px] font-bold text-primary">{formatMoney(p.price)}</span>
                    <span className="truncate text-[11px] text-ink-3">{p.unit ?? ''}</span>
                  </span>
                </span>
              </button>
            ) : (
              <button key={p.id} type="button" onClick={() => onAdd(p)} aria-disabled={disabled || undefined} className={cx('flex min-h-0 items-center gap-3 rounded-[12px] px-3 text-left', OFF)}>
                <span className={cx('flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-[10px]', tintOf(p.category))}>
                  <Picture p={p} org={org} size={18} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-bold text-ink">{p.name}</span>
                  <span className="block truncate text-[12px] text-ink-3">{[p.code, p.category].filter(Boolean).join(' · ')}</span>
                </span>
                {promo ? <span className={cx('max-w-[140px] truncate rounded-[6px] px-[7px] py-0.5 text-[10px] font-extrabold', BADGE.promo)}>{promo}</span> : null}
                {stock ? <span className={cx('rounded-[6px] px-[7px] py-0.5 text-[10px] font-extrabold', stock.tone === 'out' ? BADGE.stockOut : BADGE.stockLow)}>{stock.tone === 'out' ? t('pos.stock.out') : stock.n !== null ? t('pos.stock.left', { n: stock.n }) : t('pos.stock.low')}</span> : null}
                <span className="text-[11px] text-ink-3">{p.unit ?? ''}</span>
                <span className="w-24 text-right font-mono text-[14px] font-bold text-primary">{formatMoney(p.price)}</span>
              </button>
            );
          })}
        </div>
      )}

      <div className="flex items-center gap-2.5">
        <span className="truncate text-[12px] text-ink-3">{at.of ? t('pos.showing', at) : ''}</span>
        <span className="flex-1" />
        <button type="button" aria-label={t('pos.pagePrev')} disabled={page <= 0} onClick={() => onPage(page - 1)} className={cx('h-10 w-touch shrink-0 rounded-[10px] text-[18px] text-ink disabled:text-ink-3/60', OFF)}>
          ‹
        </button>
        {dots(pages, page).map((i) => (
          <button key={i} type="button" aria-label={t('pos.page', { n: i + 1 })} aria-current={i === page ? 'page' : undefined} onClick={() => onPage(i)} className={cx('h-2 shrink-0 rounded-full', i === page ? 'w-[22px] bg-primary' : 'w-2 bg-primary-soft')} />
        ))}
        <button type="button" aria-label={t('pos.pageNext')} disabled={page >= pages - 1} onClick={() => onPage(page + 1)} className={cx('h-10 w-touch shrink-0 rounded-[10px] text-[18px] text-ink disabled:text-ink-3/60', OFF)}>
          ›
        </button>
      </div>

      <div className="grid grid-cols-8 gap-2">
        {actions.map((a) => (
          <button
            key={a.id}
            type="button"
            disabled={a.disabled}
            title={a.title}
            onClick={(e) => a.onClick(e.currentTarget)}
            className={cx('flex h-touch-lg min-w-0 flex-col items-center justify-center gap-1 rounded-[12px] px-1 text-[12px] font-semibold text-ink disabled:opacity-40', OFF, 'hover:bg-pos-key')}
          >
            <Icon name={a.icon} size={20} strokeWidth={1.7} />
            <span className="max-w-full truncate">{a.label}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

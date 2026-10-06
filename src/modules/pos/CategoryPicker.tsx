import { useMemo, useState } from 'react';
import type { PosCategoryNode, PosProduct, PosSale } from '@shared/pos';
import { Icon } from '../../components/Icon';
import { cx } from '../../components/ui';
import { categoryLabel, FAVOURITES, favouritesOf, findNode, inCategory, nodeKey, trailOf } from './catalog';
import { useT } from './i18n';
import { ON, tintOf } from './look';
import { categoryCounts, topSellers } from './paging';
import { PosDialog } from './parts';
import { formatMoney } from './pricing';

/**
 * Choosing a category for the counter's grid: every category in the till's catalogue with how many products it has,
 * found by typing; the one pointed at shows its count, what sold most in it today, to add with one tap, and "Show all".
 *
 * Phase 2, where the server sends them: the groups of categories (`category_tree` — a group holds everything below it,
 * its sub-groups shown to step into), the company's favourites first, and today's top sellers at the till's branch
 * (`top-sellers`, every till's sales) in place of this till's own record.
 */
export default function CategoryPicker({
  categories,
  products,
  sales,
  current,
  tree,
  favourites,
  serverTop,
  onPick,
  onAdd,
  onClose,
}: {
  categories: string[];
  products: PosProduct[];
  sales: PosSale[];
  current: string | null;
  /** The groups of categories, when the catalogue carries them. */
  tree?: PosCategoryNode[];
  favourites?: number[];
  /** Today's top sellers at the branch, from WorkSuite (by product id and quantity); null: this till's own record. */
  serverTop?: Array<{ product_id: number; quantity: number }> | null;
  onPick: (c: string | null) => void;
  onAdd: (p: PosProduct) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [find, setFind] = useState('');
  const [pointed, setPointed] = useState<string | null>(current);
  const grouped = !!tree?.length;
  const favs = useMemo(() => favouritesOf(products, favourites), [products, favourites]);
  const counts = useMemo(() => categoryCounts(categories, products), [categories, products]);
  const needle = find.trim().toLowerCase();
  const inside = useMemo(() => (pointed === FAVOURITES ? favs : products.filter((p) => inCategory(p, pointed, tree, favourites))), [products, pointed, tree, favourites, favs]);
  const top = useMemo(() => {
    if (serverTop) {
      const here = new Map(inside.map((p) => [p.id, p] as const));
      return serverTop
        .filter((x) => here.has(x.product_id))
        .slice(0, 3)
        .map((x) => ({ product: here.get(x.product_id)!, sold: x.quantity }));
    }
    return topSellers(sales, inside, 3);
  }, [serverTop, sales, inside]);
  const label = categoryLabel(pointed, tree, t('pos.cat.favourites')) ?? t('pos.allProducts');
  const node = pointed?.startsWith('#') ? findNode(tree, pointed.slice(1)) : null;
  const trail = node ? trailOf(tree, node.id) : [];

  // The groups found by typing (any depth), else the top level; or the flat categories of an older catalogue.
  const flatTree = useMemo(() => {
    const out: PosCategoryNode[] = [];
    const walk = (ns: PosCategoryNode[]) => {
      for (const n of ns) {
        out.push(n);
        walk(n.children);
      }
    };
    walk(tree ?? []);
    return out;
  }, [tree]);
  const groups = grouped ? (needle ? flatTree.filter((n) => n.name.toLowerCase().includes(needle)) : tree!) : [];
  const flat = grouped ? [] : counts.filter((c) => !needle || c.name.toLowerCase().includes(needle));

  const row = (key: string | null, name: string, n: number, icon?: string) => {
    const on = pointed === key;
    return (
      <button
        key={key ?? '*'}
        type="button"
        aria-pressed={on}
        onClick={() => setPointed(key)}
        onDoubleClick={() => onPick(key)}
        className={cx('flex h-12 w-full shrink-0 items-center gap-3 rounded-[12px] px-2.5 text-left text-[14px] text-ink', on ? `${ON} font-extrabold` : 'font-semibold hover:bg-pos-key')}
      >
        <span className={cx('flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px]', on ? 'bg-primary text-white' : key && key !== FAVOURITES ? tintOf(name) : 'bg-pos-panel text-ink-2 shadow-[inset_0_0_0_1px_var(--pos-line)]')}>
          <Icon name={icon ?? (key ? 'tag' : 'grid')} size={17} />
        </span>
        <span className="min-w-0 flex-1 truncate">{name}</span>
        <span className={cx('text-[12px] font-bold tabular-nums', on ? 'text-primary' : 'text-ink-3')}>{n}</span>
      </button>
    );
  };

  return (
    <PosDialog label={t('pos.cat.title')} onClose={onClose} width={860} className="h-[min(676px,100%)]">
      <div className="flex items-center gap-3 border-b border-pos-line px-5 py-[18px]">
        <h2 className="flex-1 text-[19px] font-extrabold">{t('pos.cat.title')}</h2>
        <label className="flex h-[46px] w-[360px] max-w-[45%] items-center gap-2 rounded-[12px] bg-pos-key px-3.5 text-[14px] text-ink-3">
          <Icon name="search" size={18} />
          <input autoFocus value={find} onChange={(e) => setFind(e.target.value)} placeholder={t('pos.cat.find')} aria-label={t('pos.cat.find')} className="bare-focus min-w-0 flex-1 bg-transparent text-ink outline-none" />
        </label>
        <button type="button" aria-label={t('pos.close')} onClick={onClose} className="flex h-[46px] w-[46px] items-center justify-center rounded-[12px] bg-pos-key text-ink hover:brightness-95">
          <Icon name="x" size={20} />
        </button>
      </div>
      <div className="flex min-h-0 flex-1">
        <nav aria-label={t('pos.cat.list')} className="flex w-[290px] shrink-0 flex-col gap-[3px] overflow-y-auto border-r border-pos-line bg-pos-ground p-3 scroll-thin">
          {!needle ? row(null, t('pos.allProducts'), products.length) : null}
          {!needle && favs.length ? row(FAVOURITES, t('pos.cat.favourites'), favs.length, 'star') : null}
          {!needle && (groups.length || flat.length) ? <div className="mx-1.5 my-1.5 h-px shrink-0 bg-pos-line" /> : null}
          {grouped ? groups.map((g) => row(nodeKey(g), g.name, g.product_count)) : flat.map((c) => row(c.name, c.name, c.count))}
          {needle && !groups.length && !flat.length ? <p className="px-2 py-3 text-[13px] text-ink-3">{t('pos.cat.none')}</p> : null}
        </nav>
        <section className="flex min-w-0 flex-1 flex-col gap-3.5 px-5 py-[18px]">
          <div className="flex items-center gap-2.5">
            <div className="min-w-0 flex-1">
              <div className="truncate text-[17px] font-extrabold">{trail.length > 1 ? trail.map((x) => x.name).join(' › ') : label}</div>
              <div className="text-[12px] text-ink-3">{node?.children.length ? t('pos.cat.inGroups', { n: inside.length, g: node.children.length }) : t('pos.nProducts', { n: inside.length })}</div>
            </div>
            <button type="button" onClick={() => onPick(pointed)} className="flex h-[46px] items-center rounded-[12px] bg-primary px-[18px] text-[14px] font-bold text-white hover:bg-primary-hover">
              {t('pos.cat.showAll', { n: inside.length })}
            </button>
          </div>
          {node?.children.length ? (
            <div className="flex flex-wrap gap-2" aria-label={t('pos.cat.groups')}>
              {node.children.map((c) => (
                <button key={c.id} type="button" onClick={() => setPointed(nodeKey(c))} onDoubleClick={() => onPick(nodeKey(c))} className="flex h-touch items-center gap-2 rounded-full bg-pos-key px-3.5 text-[13px] font-semibold hover:brightness-95">
                  {c.name}
                  <span className="text-[12px] text-ink-3">{c.product_count}</span>
                </button>
              ))}
            </div>
          ) : null}
          {top.length ? (
            <>
              <div className="text-[13px] font-bold text-ink-2">{t(serverTop ? 'pos.cat.topToday' : 'pos.cat.top', { cat: label })}</div>
              <div className="flex flex-col gap-2">
                {top.map(({ product: p, sold }) => (
                  <button key={p.id} type="button" onClick={() => onAdd(p)} className="flex h-touch-md items-center gap-3 rounded-[12px] bg-pos-panel px-3.5 text-left shadow-[inset_0_0_0_1px_var(--pos-line)] hover:bg-pos-key">
                    <span className="min-w-0 flex-1 truncate text-[14px] font-semibold">{p.name}</span>
                    <span className="text-[12px] text-ink-3">{t('pos.cat.sold', { n: Math.round(sold * 1000) / 1000 })}</span>
                    <span className="w-20 text-right font-mono text-[14px] font-bold text-primary">{formatMoney(p.price)}</span>
                    <span className="flex h-8 w-8 items-center justify-center rounded-[8px] bg-primary text-white">
                      <Icon name="plus" size={18} />
                    </span>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <p className="text-[13px] text-ink-3">{t('pos.cat.noneSold')}</p>
          )}
          <p className="mt-auto text-[12px] text-ink-3">{t('pos.cat.foot')}</p>
        </section>
      </div>
    </PosDialog>
  );
}

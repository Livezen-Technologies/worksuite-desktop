import type { PosProduct, PosSale } from '@shared/pos';

/**
 * The counter's product pages and categories, as rules with no screen in them: fifteen tiles a page (five by three)
 * or eight rows in the list, the dots under them, the categories with how many products each has, and the
 * categories used lately.
 */
export const GRID_PAGE = 15;
export const LIST_PAGE = 8;

export function pageCount(n: number, size: number): number {
  return Math.max(1, Math.ceil(Math.max(0, n) / size));
}

export function clampPage(page: number, n: number, size: number): number {
  return Math.min(Math.max(0, Math.floor(page) || 0), pageCount(n, size) - 1);
}

export function pageOf<T>(items: T[], page: number, size: number): T[] {
  const p = clampPage(page, items.length, size);
  return items.slice(p * size, p * size + size);
}

/** "1–15 of 142": the first and last shown (1-based), and how many there are. */
export function shown(n: number, page: number, size: number): { from: number; to: number; of: number } {
  if (n <= 0) return { from: 0, to: 0, of: 0 };
  const p = clampPage(page, n, size);
  return { from: p * size + 1, to: Math.min(n, p * size + size), of: n };
}

/** Which pages get a dot: all of them up to `max`, else a window of `max` around the page shown. */
export function dots(count: number, page: number, max = 6): number[] {
  if (count <= max) return Array.from({ length: count }, (_, i) => i);
  const start = Math.min(Math.max(0, page - Math.floor(max / 2)), count - max);
  return Array.from({ length: max }, (_, i) => start + i);
}

/** Every category in the catalogue with its count, in the catalogue's order; products with none are left out. */
export function categoryCounts(categories: string[], products: PosProduct[]): Array<{ name: string; count: number }> {
  const counts = new Map<string, number>();
  for (const p of products) if (p.category) counts.set(p.category, (counts.get(p.category) ?? 0) + 1);
  const order = [...categories, ...[...counts.keys()].filter((c) => !categories.includes(c)).sort((a, b) => a.localeCompare(b))];
  return order.map((name) => ({ name, count: counts.get(name) ?? 0 })).filter((c) => c.count > 0);
}

/** The categories used lately, newest first, at most `max`. */
export function pushRecent(list: string[], category: string | null, max = 4): string[] {
  if (!category) return list;
  return [category, ...list.filter((c) => c !== category)].slice(0, max);
}

/** What this till sold most of, by quantity, from its own record of its sales (refused ones not counted). */
export function topSellers(sales: PosSale[], products: PosProduct[], limit = 3): Array<{ product: PosProduct; sold: number }> {
  const byId = new Map(products.map((p) => [p.id, p] as const));
  const sold = new Map<number, number>();
  for (const s of sales) {
    if (s.state === 'refused' || s.voided) continue;
    for (const l of s.lines) if (byId.has(l.product_id)) sold.set(l.product_id, (sold.get(l.product_id) ?? 0) + l.quantity);
  }
  return [...sold]
    .sort((a, b) => b[1] - a[1] || byId.get(a[0])!.name.localeCompare(byId.get(b[0])!.name))
    .slice(0, limit)
    .map(([id, n]) => ({ product: byId.get(id)!, sold: Math.round(n * 1000) / 1000 }));
}

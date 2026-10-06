import type { PosCategoryNode, PosProduct } from '@shared/pos';
import { apiUrl } from '../../core/api';

/**
 * What the counter's grid is narrowed to, with Phase 2's catalogue (`capabilities.category_tree`, `favourites`):
 * a category by name (every server's), a group of the tree by id (`#<id>`, everything below it), or the company's
 * favourites. Pure, so the rules are tested without a screen.
 */
export const FAVOURITES = '*fav';

const key = (id: string) => `#${id}`;

export function nodeKey(n: Pick<PosCategoryNode, 'id'>): string {
  return key(n.id);
}

export function findNode(tree: PosCategoryNode[] | undefined, id: string): PosCategoryNode | null {
  for (const n of tree ?? []) {
    if (n.id === id) return n;
    const below = findNode(n.children, id);
    if (below) return below;
  }
  return null;
}

/** A group and every group below it, by id. */
export function subtreeIds(node: PosCategoryNode): Set<string> {
  const out = new Set<string>([node.id]);
  for (const c of node.children) for (const x of subtreeIds(c)) out.add(x);
  return out;
}

/** The trail to a group, top first ("Stationery › Notebooks"). */
export function trailOf(tree: PosCategoryNode[] | undefined, id: string): PosCategoryNode[] {
  for (const n of tree ?? []) {
    if (n.id === id) return [n];
    const below = trailOf(n.children, id);
    if (below.length) return [n, ...below];
  }
  return [];
}

/** What the grid's narrowed to, in words: the category's name, the group's, or the favourites' label. */
export function categoryLabel(c: string | null, tree: PosCategoryNode[] | undefined, favourites: string): string | null {
  if (!c) return null;
  if (c === FAVOURITES) return favourites;
  if (c.startsWith('#')) return findNode(tree, c.slice(1))?.name ?? null;
  return c;
}

/** Whether a product is in what the grid is narrowed to. */
export function inCategory(p: PosProduct, c: string | null, tree: PosCategoryNode[] | undefined, favourites: number[] | undefined): boolean {
  if (!c) return true;
  if (c === FAVOURITES) return !!p.favourite || !!favourites?.includes(p.id);
  if (c.startsWith('#')) {
    const node = findNode(tree, c.slice(1));
    if (!node) return false;
    return !!p.category_id && subtreeIds(node).has(p.category_id);
  }
  return p.category === c;
}

/** The favourites, in the company's order (`favourites`), then any product marked so. */
export function favouritesOf(products: PosProduct[], favourites: number[] | undefined): PosProduct[] {
  const by = new Map(products.map((p) => [p.id, p] as const));
  const ordered = (favourites ?? []).map((id) => by.get(id)).filter((p): p is PosProduct => !!p);
  const rest = products.filter((p) => p.favourite && !favourites?.includes(p.id));
  return [...ordered, ...rest];
}

/**
 * A product's picture, through the signed-in person's session (`GET api/pos/products/{id}/image`, the same `pos.access`
 * as the counter) — the catalogue's own `image_url` is the till's door, whose credential never reaches this window.
 */
export function imageUrl(p: Pick<PosProduct, 'id' | 'image'>, org: number | null | undefined): string | null {
  return p.image ? apiUrl(`/api/pos/products/${p.id}/image`, org ? { org } : undefined) : null;
}

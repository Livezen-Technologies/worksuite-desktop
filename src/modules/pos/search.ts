import type { PosProduct } from '@shared/pos';

/**
 * The counter's search, on the till's own copy of the catalogue (worksuite-desktop#296): built once per catalogue
 * version, asked on every keystroke (debounced), never a request to WorkSuite. Pure, so it is tested and timed without
 * a screen.
 *
 *  - A barcode or code finds its product exactly, through a map: a scan never searches.
 *  - Every word typed must be found in the product's name, code, barcode or category — at the start of one of their
 *    words, or inside one.
 *  - Ranked: the exact code or barcode first; then a name that starts with what was typed; then every word matching at
 *    the start of a word; then the rest (a match in the middle of a word). Within a rank, by name.
 *  - Accents and case do not matter ("creme" finds "Crème").
 *
 * The products are put in name order once, when the index is built, so a search keeps that order within each rank
 * and never sorts: at 20,000 products a keystroke costs a few milliseconds.
 */
/** How long the search waits for the cashier to stop typing. A scan never waits: it is looked up at once (`exact`). */
export const SEARCH_DEBOUNCE_MS = 150;

export interface SearchIndex {
  /** The catalogue's products, by name. */
  products: PosProduct[];
  byBarcode: Map<string, PosProduct>;
  byCode: Map<string, PosProduct>;
  /** Per product, in the same order: everything searchable (each word after a space), and the name. */
  hay: string[];
  names: string[];
}

const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

/** Lower case, without accents, every run of anything but letters and digits one space. Pure. */
export function normalize(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export function buildIndex(products: PosProduct[]): SearchIndex {
  const sorted = [...products].sort((a, b) => collator.compare(a.name, b.name) || a.id - b.id);
  const byBarcode = new Map<string, PosProduct>();
  const byCode = new Map<string, PosProduct>();
  const byCodeLower = new Map<string, PosProduct>();
  const hay: string[] = [];
  const names: string[] = [];
  for (const p of sorted) {
    if (p.barcode && !byBarcode.has(p.barcode)) byBarcode.set(p.barcode, p);
    if (p.code) {
      if (!byCode.has(p.code)) byCode.set(p.code, p);
      const low = p.code.toLowerCase();
      if (!byCodeLower.has(low)) byCodeLower.set(low, p);
    }
    const name = normalize(p.name);
    const all = [name, normalize(p.code ?? ''), normalize(p.barcode ?? ''), normalize(p.category ?? '')].filter(Boolean).join(' ');
    names.push(name);
    hay.push(` ${all}`);
  }
  // A code typed in another case still finds its product, after the exact ones.
  for (const [k, p] of byCodeLower) if (!byCode.has(k)) byCode.set(k, p);
  return { products: sorted, byBarcode, byCode, hay, names };
}

/** A product by its exact barcode, else its code (then the code in any case). Pure. */
export function exact(index: SearchIndex, code: string): PosProduct | null {
  const c = code.trim();
  if (!c) return null;
  return index.byBarcode.get(c) ?? index.byCode.get(c) ?? index.byCode.get(c.toLowerCase()) ?? null;
}

/**
 * The products matching what was typed, best first. `limit`: at most so many (the grid pages what it gets, so the
 * default is all of them). An empty query is every product, by name.
 */
export function search(index: SearchIndex, query: string, limit = Infinity): PosProduct[] {
  const q = normalize(query);
  if (!q) return limit === Infinity ? index.products : index.products.slice(0, limit);
  const terms = q.split(' ');
  const first = terms[0]!;
  const hit = exact(index, query);
  const ranks: PosProduct[][] = [[], [], [], []];
  const { hay, names, products } = index;
  for (let i = 0; i < products.length; i++) {
    const h = hay[i]!;
    let start = true;
    let all = true;
    for (const t of terms) {
      // ` t` in the padded text: the word starts there.
      if (h.includes(` ${t}`)) continue;
      if (h.includes(t)) start = false;
      else {
        all = false;
        break;
      }
    }
    if (!all) continue;
    const p = products[i]!;
    if (p === hit) continue;
    if (names[i]!.startsWith(first) && start) ranks[1]!.push(p);
    else if (start) ranks[2]!.push(p);
    else ranks[3]!.push(p);
  }
  if (hit) ranks[0]!.push(hit);
  const out = ranks.flat();
  return limit === Infinity ? out : out.slice(0, limit);
}

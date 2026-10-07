import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import type { PosProduct, PosSale, PosTillStatus } from '@shared/pos';
import { buildIndex, exact, normalize, search, SEARCH_DEBOUNCE_MS } from '../../../src/modules/pos/search';
import { closeGuard, filterSales } from '../../../src/modules/pos/shift';
import { tillPill } from '../../../src/modules/pos/syncstate';

/**
 * worksuite-desktop#296: the counter searches the till's own copy — never WorkSuite per keystroke — fast enough at the
 * shop's 538 products and at 20,000: word starts above the middle of a word, the exact code or barcode first, a scan
 * by a map. And what the till bar says, the shift's close, the sales that need review.
 */
const p = (id: number, name: string, over: Partial<PosProduct> = {}): PosProduct => ({ id, code: `C-${id}`, barcode: null, name, unit: null, category: null, price: 100, discount_pct: 0, tax_rate: 0, ...over });

describe('POS search on the till’s copy', () => {
  const products = [
    p(1, 'Brown paper bag', { category: 'Stationery' }),
    p(2, 'Paper clips', { category: 'Stationery' }),
    p(3, 'Notepaper A5', { category: 'Stationery' }),
    p(4, 'Ceylon black tea 400g', { code: 'TEA-1', barcode: '4790001000014', category: 'Tea' }),
    p(5, 'Crème brûlée', { category: 'Desserts' }),
    p(6, 'Green tea', { code: 'PAPER', category: 'Tea' }),
    p(7, 'Teapot', { category: 'Kitchen' }),
  ];
  const index = buildIndex(products);
  const ids = (q: string) => search(index, q).map((x) => x.id);

  it('ranks the exact code first, then a name’s start, a word’s start, the middle of a word', () => {
    expect(ids('paper')).toEqual([6, 2, 1, 3]);
    expect(ids('tea')).toEqual([7, 4, 6]);
  });

  it('needs every word, in name, code, barcode or category; accents and case do not matter', () => {
    expect(ids('bag pap')).toEqual([1]);
    expect(ids('stationery clip')).toEqual([2]);
    expect(ids('creme')).toEqual([5]);
    expect(ids('KITCHEN')).toEqual([7]);
    expect(ids('tea-1')).toEqual([4]);
    expect(ids('zzz')).toEqual([]);
    expect(ids(''), 'nothing typed: every product, by name').toEqual([1, 4, 5, 6, 3, 2, 7]);
    expect(normalize('  Crème-Brûlée  ')).toBe('creme brulee');
  });

  it('finds a scan by its barcode or code through a map, and a code in another case', () => {
    expect(exact(index, '4790001000014')?.id).toBe(4);
    expect(exact(index, ' TEA-1 ')?.id).toBe(4);
    expect(exact(index, 'tea-1')?.id).toBe(4);
    expect(exact(index, '479000')).toBeNull();
    expect(search(index, '4790001000014')[0]!.id).toBe(4);
  });

  it('waits 150 ms for the cashier to stop typing (a scan never waits)', () => {
    expect(SEARCH_DEBOUNCE_MS).toBe(150);
  });

  /** Synthetic products, as a shop's catalogue reads: a few words, a code, a barcode, a category. */
  function synthetic(n: number): PosProduct[] {
    const words = ['tea', 'rice', 'soap', 'paper', 'milk', 'sugar', 'flour', 'oil', 'biscuit', 'noodles', 'coffee', 'salt', 'pepper', 'chilli', 'curry', 'dhal', 'bread', 'butter', 'cheese', 'juice'];
    const brands = ['Lanka', 'Ceylon', 'Island', 'Golden', 'Royal', 'Fresh', 'Pure', 'Happy', 'Kandy', 'Galle'];
    const cats = ['Grocery', 'Beverages', 'Household', 'Dairy', 'Bakery', 'Spices'];
    let seed = 42;
    const rnd = (m: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % m;
    };
    return Array.from({ length: n }, (_, i) => p(i + 1, `${brands[rnd(brands.length)]} ${words[rnd(words.length)]} ${words[rnd(words.length)]} ${100 + rnd(900)}g`, { code: `SKU-${i + 1}`, barcode: String(4790000000000 + i), category: cats[rnd(cats.length)]! }));
  }

  const timed = (fn: () => unknown, runs: number) => {
    const t: number[] = [];
    for (let i = 0; i < runs; i++) {
      const a = performance.now();
      fn();
      t.push(performance.now() - a);
    }
    t.sort((x, y) => x - y);
    return { median: t[Math.floor(t.length / 2)]!, worst: t[t.length - 1]! };
  };

  it('answers within the targets: under 100 ms at the shop’s 538 products, under 200 ms at 20,000', () => {
    const queries = ['t', 'te', 'tea', 'ceylon tea', 'pap', 'sku-1999', '4790000012345', 'golden rice 5', 'xyz'];
    for (const [n, target] of [
      [538, 100],
      [20_000, 200],
    ] as const) {
      const all = synthetic(n);
      const built = timed(() => buildIndex(all), 3);
      const idx = buildIndex(all);
      // A keystroke: the search and the category filter the grid applies after it.
      const per = queries.map((q) => ({ q, ...timed(() => search(idx, q).filter((x) => x.category !== 'none'), 15) }));
      const worst = Math.max(...per.map((x) => x.worst));
      console.info(`[pos search] ${n} products: index ${built.median.toFixed(1)} ms; per keystroke median ${Math.max(...per.map((x) => x.median)).toFixed(2)} ms, worst ${worst.toFixed(2)} ms`);
      // Generous bounds: a shared CI machine is slower than a till.
      expect(worst).toBeLessThan(target);
      expect(built.median).toBeLessThan(n === 538 ? 100 : 1000);
    }
    const big = buildIndex(synthetic(20_000));
    expect(exact(big, '4790000012345')?.id).toBe(12346);
    expect(search(big, 'sku-1999')[0]!.code).toBe('SKU-1999');
  });
});

describe('POS till bar and shift', () => {
  const status = (over: Partial<PosTillStatus> = {}): PosTillStatus => ({
    till: null,
    waiting: 0,
    refused: 0,
    reachable: true,
    last_contact: null,
    last_sync: '2026-10-07T08:00:00Z',
    problem: null,
    can_queue: true,
    can_keep: true,
    catalogue: { version: 'v1', fetched_at: '2026-10-07T08:00:00Z', products: 538, source: 'pos', truncated: false, stale: false },
    ...over,
  });

  it('says “Online · synced” only when the sales and the catalogue both are', () => {
    expect(tillPill(status(), false)).toEqual({ key: 'pos.bar.online', vars: {}, tone: 'online' });
    expect(tillPill(status({ waiting: 2 }), true)).toEqual({ key: 'pos.bar.offline', vars: { n: 2 }, tone: 'offline' });
    expect(tillPill(status({ reachable: false }), false).key).toBe('pos.bar.offline');
    expect(tillPill(status({ waiting: 3 }), false)).toMatchObject({ key: 'pos.bar.sending', vars: { n: 3 } });
    expect(tillPill(status({ syncing: { done: 250, total: 1000, full: true } }), false)).toEqual({ key: 'pos.bar.syncing', vars: { pct: '25%' }, tone: 'busy' });
    expect(tillPill(status({ syncing: { done: 250, total: null, full: true } }), false).vars).toEqual({ pct: '…' });
    expect(tillPill(status({ catalogue: { version: 'v1', fetched_at: 'x', products: 1, source: 'pos', truncated: false, stale: true } }), false).key).toBe('pos.bar.stale');
    expect(tillPill(status({ catalogue: null }), false).key).toBe('pos.bar.stale');
  });

  it('blocks the close while sales wait or were refused — online too — and lets a manager close anyway', () => {
    expect(closeGuard({ waiting: 0, refused: 0 }, { view_all: false })).toEqual({ pending: 0, blocked: false, override: false });
    expect(closeGuard({ waiting: 2, refused: 1 }, { view_all: false })).toEqual({ pending: 3, blocked: true, override: false });
    expect(closeGuard({ waiting: 0, refused: 1 }, { view_all: true })).toEqual({ pending: 1, blocked: true, override: true });
    expect(closeGuard({ waiting: 1, refused: 0 }, null).override).toBe(false);
  });

  it('lists what needs review: a flag WorkSuite set — an archived product, stock below zero — or a refusal', () => {
    const sale = (ref: string, over: Partial<PosSale>) => ({ ref, state: 'sent', flags: [], review: null, ...over }) as unknown as PosSale;
    const sales = [sale('A', {}), sale('B', { flags: ['product_archived'] }), sale('C', { state: 'refused' }), sale('D', { flags: ['negative_stock'] }), sale('E', { review: 'The till charged…' })];
    expect(filterSales(sales, 'needs').map((s) => s.ref)).toEqual(['B', 'C', 'D', 'E']);
    expect(filterSales(sales, 'review').map((s) => s.ref)).toEqual(['B', 'D', 'E']);
    expect(filterSales(sales, 'negative_stock').map((s) => s.ref)).toEqual(['D']);
  });
});

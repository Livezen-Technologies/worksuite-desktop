import type { PosCatalogue, PosProduct } from '@shared/pos';
import type { Database } from './db';
import type { Vault } from './vault';

/**
 * POS: the till's catalogue copy, one product a row (worksuite-desktop#296).
 *
 * The copy's head — version, when it was last brought up to date, the server's cursor for "what changed since", the
 * categories and their tree, the favourites and tenders — is one sealed row of `pos_catalogue`; each product is a
 * sealed row of `pos_products`, with the codes a scan looks up and its category in plain beside it. What changed since
 * the last sync is applied a row at a time; a whole download writes under a new `gen` and, once it has finished, drops
 * the rows of the one before — so a download cut off half way leaves the copy the till was selling from.
 *
 * Where the company's desktop policy keeps nothing on this computer, the same copy lives in memory only, as the single
 * sealed blob used to.
 *
 * The screens are given the whole catalogue (`read`), assembled once and kept in memory until the copy changes, so the
 * counter's search index is built once per version and a status check never decrypts a product (`count`).
 */

export interface PosScope {
  origin: string;
  terminal: number;
}

/** The copy without its products, as `pos_catalogue` keeps it. */
export type CatalogueHead = Omit<PosCatalogue, 'products' | 'categories'> & {
  /** The server's cursor for what changed since (`catalogue/changes`); null: a copy read whole. */
  cursor?: string | null;
  /** The whole download the rows belong to. */
  gen?: number;
  /** How many products WorkSuite said it sells, when this copy was last brought up to date. */
  total?: number | null;
};

interface Mem {
  head: CatalogueHead;
  /** Each product with the whole download it came from. */
  products: Map<number, { p: PosProduct; gen: number }>;
}

const key = (s: PosScope) => `${s.origin}|${s.terminal}`;
const byName = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

/** The categories the products are in, by name. Pure. */
export function categoriesOf(products: PosProduct[]): string[] {
  return [...new Set(products.map((p) => p.category).filter((c): c is string => !!c))].sort((a, b) => a.localeCompare(b));
}

export class PosCatalogueStore {
  private memory = new Map<string, Mem>();
  /** The assembled catalogue, per scope, until the copy changes. */
  private assembled = new Map<string, PosCatalogue>();

  constructor(
    private readonly d: {
      db: Database;
      vault: () => Vault;
      /** May this computer keep the copy on disk (the desktop policy)? */
      keep: () => boolean;
      /** The products with a small picture kept for offline. */
      thumbs?: (s: PosScope) => Set<number>;
    },
  ) {}

  private changed(s: PosScope): void {
    this.assembled.delete(key(s));
  }

  /** The thumbnails changed: the next read marks them. */
  touch(s: PosScope): void {
    this.changed(s);
  }

  /* ── Reading ──────────────────────────────────────────────────────── */

  head(s: PosScope): CatalogueHead | null {
    const mem = this.memory.get(key(s));
    if (mem) return mem.head;
    const row = this.d.db.get<{ payload: string }>('SELECT payload FROM pos_catalogue WHERE origin = ? AND terminal_id = ?', s.origin, s.terminal);
    if (!row) return null;
    const v = this.d.vault().decrypt<PosCatalogue & CatalogueHead>(row.payload);
    if (!v) return null;
    // A copy written whole (by this app before #296, or by an older one after it): split into rows.
    if (Array.isArray(v.products) && v.gen === undefined) return this.migrate(s, v);
    const { products: _p, categories: _c, ...head } = v;
    return head;
  }

  /** How many products the copy holds, without decrypting one. */
  count(s: PosScope): number {
    const mem = this.memory.get(key(s));
    if (mem) return mem.products.size;
    this.head(s); // splits a copy kept the old way first
    return this.d.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM pos_products WHERE origin = ? AND terminal_id = ?', s.origin, s.terminal)?.n ?? 0;
  }

  /** The whole catalogue for the screens: the head with every product, by name. */
  read(s: PosScope): PosCatalogue | null {
    const k = key(s);
    const done = this.assembled.get(k);
    if (done) return done;
    const head = this.head(s);
    if (!head) return null;
    const mem = this.memory.get(k);
    let products: PosProduct[];
    if (mem) products = [...mem.products.values()].map((x) => x.p);
    else {
      const v = this.d.vault();
      products = [];
      for (const r of this.d.db.all<{ payload: string }>('SELECT payload FROM pos_products WHERE origin = ? AND terminal_id = ?', s.origin, s.terminal)) {
        const p = v.decrypt<PosProduct>(r.payload);
        if (p) products.push(p);
      }
    }
    products.sort((a, b) => byName.compare(a.name, b.name) || a.id - b.id);
    const thumbs = this.d.thumbs?.(s);
    if (thumbs?.size) products = products.map((p) => (thumbs.has(p.id) ? { ...p, thumb: true } : p));
    const { cursor: _c, gen: _g, total: _t, ...rest } = head;
    const out: PosCatalogue = { ...rest, categories: categoriesOf(products), products };
    this.assembled.set(k, out);
    return out;
  }

  /** The product ids in the copy, with when each row was last written (for its picture). */
  rows(s: PosScope): Array<{ id: number; updated_at: string; image: boolean }> {
    const c = this.read(s);
    if (!c) return [];
    const at = this.memory.has(key(s))
      ? new Map<number, string>()
      : new Map(this.d.db.all<{ product_id: number; updated_at: string }>('SELECT product_id, updated_at FROM pos_products WHERE origin = ? AND terminal_id = ?', s.origin, s.terminal).map((r) => [r.product_id, r.updated_at] as const));
    return c.products.map((p) => ({ id: p.id, updated_at: at.get(p.id) ?? c.fetched_at, image: !!p.image }));
  }

  /* ── Writing ──────────────────────────────────────────────────────── */

  /** Replace the whole copy (a catalogue read in one answer: an older server's, Inventory's list). */
  replace(s: PosScope, c: PosCatalogue, extra: Pick<CatalogueHead, 'cursor' | 'total'> = {}): void {
    const { products, categories: _cats, ...head } = c;
    const gen = this.begin(s);
    this.upsert(s, gen, products, [], c.fetched_at);
    this.finish(s, { ...head, ...extra }, gen);
  }

  /** Start writing a whole download: the generation its rows carry. */
  begin(s: PosScope): number {
    const head = this.head(s)?.gen ?? 0;
    // Past any rows a download that stopped half way left, so the next one's cleanup takes them too.
    const rows = this.memory.has(key(s))
      ? Math.max(0, ...[...this.memory.get(key(s))!.products.values()].map((x) => x.gen))
      : (this.d.db.get<{ g: number | null }>('SELECT MAX(gen) AS g FROM pos_products WHERE origin = ? AND terminal_id = ?', s.origin, s.terminal)?.g ?? 0);
    return Math.max(head, rows) + 1;
  }

  /** Products added or changed, and ids gone, under a generation (the current one for what changed since). */
  upsert(s: PosScope, gen: number, products: PosProduct[], deleted: number[], at: string): void {
    // The screens keep the copy they have until the sync finishes (`finish`): a page at a time would be read whole
    // again on every page.
    if (!this.d.keep()) {
      const k = key(s);
      const mem = this.memory.get(k) ?? { head: this.head(s) ?? ({ version: '', fetched_at: at, currency: null, source: 'pos', truncated: false } as CatalogueHead), products: new Map() };
      // A whole download in memory: the rows of the one before go when it finishes (`finish`), as on disk.
      for (const p of products) mem.products.set(p.id, { p, gen });
      for (const id of deleted) mem.products.delete(id);
      this.memory.set(k, mem);
      return;
    }
    const v = this.d.vault();
    this.d.db.tx(() => {
      for (const p of products) {
        this.d.db.run(
          'INSERT INTO pos_products (origin, terminal_id, product_id, gen, barcode, code, category_id, payload, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ' +
            'ON CONFLICT(origin, terminal_id, product_id) DO UPDATE SET gen = excluded.gen, barcode = excluded.barcode, code = excluded.code, category_id = excluded.category_id, payload = excluded.payload, updated_at = excluded.updated_at',
          s.origin,
          s.terminal,
          p.id,
          gen,
          p.barcode,
          p.code,
          p.category_id ?? null,
          v.encrypt(p),
          at,
        );
      }
      for (const id of deleted) this.d.db.run('DELETE FROM pos_products WHERE origin = ? AND terminal_id = ? AND product_id = ?', s.origin, s.terminal, id);
    });
  }

  /** The sync finished: the head kept, and — after a whole download — the rows it did not bring dropped. */
  finish(s: PosScope, head: CatalogueHead, gen: number | null): void {
    this.changed(s);
    const k = key(s);
    const keep = this.d.keep();
    const h: CatalogueHead = { ...head, gen: gen ?? head.gen ?? this.head(s)?.gen ?? 1 };
    if (!keep) {
      const mem = this.memory.get(k) ?? { head: h, products: new Map<number, { p: PosProduct; gen: number }>() };
      if (gen !== null) for (const [id, x] of mem.products) if (x.gen !== gen) mem.products.delete(id);
      this.memory.set(k, { head: h, products: mem.products });
      this.d.db.tx(() => {
        this.d.db.run('DELETE FROM pos_catalogue WHERE origin = ? AND terminal_id = ?', s.origin, s.terminal);
        this.d.db.run('DELETE FROM pos_products WHERE origin = ? AND terminal_id = ?', s.origin, s.terminal);
      });
      return;
    }
    this.memory.delete(k);
    this.d.db.tx(() => {
      if (gen !== null) this.d.db.run('DELETE FROM pos_products WHERE origin = ? AND terminal_id = ? AND gen != ?', s.origin, s.terminal, gen);
      this.writeHead(s, h);
    });
  }

  /** The head alone changed (the tenders a heartbeat named, the time of an unchanged sync). */
  setHead(s: PosScope, head: CatalogueHead): void {
    this.changed(s);
    const mem = this.memory.get(key(s));
    if (mem) mem.head = head;
    else if (this.d.keep()) this.writeHead(s, head);
  }

  /**
   * The head is written with empty `products` and `categories`, so an older version of this module reading it (an app
   * rolled back) sees an empty copy and reads the catalogue again whole, rather than failing — and this version splits
   * what that one writes the next time it reads it (no `gen`).
   */
  private writeHead(s: PosScope, h: CatalogueHead): void {
    const kept: PosCatalogue & CatalogueHead = { ...h, products: [], categories: [] };
    this.d.db.run(
      'INSERT INTO pos_catalogue (origin, terminal_id, version, payload, fetched_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(origin, terminal_id) DO UPDATE SET version = excluded.version, payload = excluded.payload, fetched_at = excluded.fetched_at',
      s.origin,
      s.terminal,
      h.version,
      this.d.vault().encrypt(kept),
      h.fetched_at,
    );
  }

  /**
   * A copy kept the old way — the whole catalogue one sealed blob — split into rows the first time it is read: the
   * products under generation 1, the head without them. Where the policy now keeps nothing on disk it moves to memory.
   */
  private migrate(s: PosScope, blob: PosCatalogue & CatalogueHead): CatalogueHead {
    const { products, categories: _cats, ...head } = blob;
    if (!this.d.keep()) {
      this.memory.set(key(s), { head: { ...head, gen: 1 }, products: new Map(products.map((p) => [p.id, { p, gen: 1 }] as const)) });
      this.d.db.run('DELETE FROM pos_catalogue WHERE origin = ? AND terminal_id = ?', s.origin, s.terminal);
      return { ...head, gen: 1 };
    }
    const h: CatalogueHead = { ...head, gen: 1, cursor: null };
    const v = this.d.vault();
    this.d.db.tx(() => {
      this.d.db.run('DELETE FROM pos_products WHERE origin = ? AND terminal_id = ?', s.origin, s.terminal);
      for (const p of products) {
        this.d.db.run(
          'INSERT OR REPLACE INTO pos_products (origin, terminal_id, product_id, gen, barcode, code, category_id, payload, updated_at) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?)',
          s.origin,
          s.terminal,
          p.id,
          p.barcode,
          p.code,
          p.category_id ?? null,
          v.encrypt(p),
          head.fetched_at,
        );
      }
      this.writeHead(s, h);
    });
    this.changed(s);
    return h;
  }

  /* ── Forgetting ───────────────────────────────────────────────────── */

  forget(origin: string, terminal: number): void {
    this.d.db.run('DELETE FROM pos_catalogue WHERE origin = ? AND terminal_id = ?', origin, terminal);
    this.d.db.run('DELETE FROM pos_products WHERE origin = ? AND terminal_id = ?', origin, terminal);
    this.memory.delete(key({ origin, terminal }));
    this.assembled.delete(key({ origin, terminal }));
  }

  forgetAll(): void {
    this.d.db.run('DELETE FROM pos_catalogue');
    this.d.db.run('DELETE FROM pos_products');
    this.memory.clear();
    this.assembled.clear();
  }
}

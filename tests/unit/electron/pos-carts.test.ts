import { describe, expect, it } from 'vitest';
import { POS_HOLD_TTL_MS, posContract, type PosCarts } from '@shared/pos';
import { Database } from '../../../electron/services/db';
import { PosCartsStore } from '../../../electron/services/pos-carts';
import { Vault } from '../../../electron/services/vault';

const T0 = Date.parse('2026-10-06T09:00:00Z');
const at = (ms: number) => new Date(ms).toISOString();
const cart = { lines: [{ product_id: 9, quantity: 2 }], customer: { name: 'Nimal', email: 'nimal@example.com' }, discount: '' };
const kept: PosCarts = {
  sales: [{ id: 'a', cart, started_at: at(T0) }],
  active: 'a',
  held: [
    { id: 'h1', cart, started_at: at(T0), held_at: at(T0), note: 'Back soon' },
    { id: 'h0', cart, started_at: at(T0 - 2 * POS_HOLD_TTL_MS), held_at: at(T0 - POS_HOLD_TTL_MS - 1), note: '' },
  ],
};

function store(o: { keep?: boolean; scope?: string | null; now?: number } = {}) {
  const db = new Database(':memory:');
  const s = new PosCartsStore({ config: db, vault: () => vault, scope: () => (o.scope === undefined ? 'https://ws.example|7' : o.scope), keep: () => o.keep ?? true, now: () => o.now ?? T0 + 1000 });
  return { db, s };
}
const vault = new Vault(Vault.generateKey());

describe('the till’s open and held sales', () => {
  it('keeps them sealed, and drops a held sale past its day', () => {
    const { db, s } = store();
    expect(s.read()).toBeNull();
    expect(s.save(kept)).toBe(true);
    const raw = JSON.stringify(db.getConfig('pos-carts'));
    expect(raw).not.toContain('Nimal');
    const back = s.read()!;
    expect(back.sales).toEqual(kept.sales);
    expect(back.held.map((h) => h.id)).toEqual(['h1']);
  });

  it('keeps them in memory only where the policy says no data on this computer', () => {
    const { db, s } = store({ keep: false });
    s.save(kept);
    expect(db.getConfig('pos-carts')).toBeUndefined();
    expect(s.read()!.sales).toHaveLength(1);
  });

  it('forgets them with the till, and has none without one', () => {
    const { s } = store();
    s.save(kept);
    s.forget('https://ws.example|7');
    expect(s.read()).toBeNull();
    expect(store({ scope: null }).s.save(kept)).toBe(false);
  });

  it('checks what the screens send', () => {
    const schema = posContract['pos:cartsSave'].input;
    expect(schema.safeParse(kept).success).toBe(true);
    expect(schema.safeParse({ ...kept, sales: Array.from({ length: 6 }, (_, i) => ({ id: `s${i}`, cart, started_at: at(T0) })) }).success).toBe(false);
    expect(schema.safeParse({ ...kept, sales: [{ id: 'a', cart: { ...cart, price: 1 }, started_at: at(T0) }] }).success).toBe(false);
  });
});

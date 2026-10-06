import { describe, expect, it } from 'vitest';
import { heldWithin, POS_HOLD_TTL_MS, posCartsSchema } from '@shared/pos';
import { activeSale, addLine, discardHeld, dropSale, EMPTY_CART, expireHeld, holdSale, initialCarts, MAX_OPEN, newSale, openWithLines, recallSale, switchIndex, switchSale, updateActive, type TillCarts } from '../../../src/modules/pos/cart';
import { clean, grouped, press, typedOf } from '../../../src/modules/pos/keypad';
import { tintOf, TINTS } from '../../../src/modules/pos/look';

const typeKeys = (keys: string[], o?: Parameters<typeof press>[2]) => keys.reduce((v, k) => press(v, k, o), '');

describe('the keypad', () => {
  it('types an amount: digits, 00, one point, two places, back and clear', () => {
    expect(typeKeys(['7', '00', '0'])).toBe('7000');
    expect(typeKeys(['0', '0', '5'])).toBe('5');
    expect(typeKeys(['00'])).toBe('0');
    expect(typeKeys(['.', '5'])).toBe('0.5');
    expect(typeKeys(['1', '.', '2', '5', '9'])).toBe('1.25');
    expect(typeKeys(['1', '.', '.', '2'])).toBe('1.2');
    expect(typeKeys(['1', '2', 'back'])).toBe('1');
    expect(typeKeys(['1', '2', 'clear'])).toBe('');
  });

  it('keeps a count whole, and no amount past its digits', () => {
    expect(typeKeys(['1', '.', '5'], { decimals: 0 })).toBe('15');
    expect(typeKeys(['9', '9', '9', '9'], { digits: 3 })).toBe('999');
  });

  it('cleans what a keyboard types and groups it as it is typed', () => {
    expect(clean('7,000.505')).toBe('7000.50');
    expect(clean('12a3')).toBe('123');
    expect(clean('1.5', { decimals: 0 })).toBe('15');
    expect(grouped('1234567.5')).toBe('1,234,567.5');
    expect(grouped('.5')).toBe('0.5');
    expect(grouped('')).toBe('');
    expect(typedOf(900)).toBe('900');
    expect(typedOf(6490.5)).toBe('6490.50');
    expect(typedOf(0)).toBe('');
  });
});

describe('the counter’s look', () => {
  it('gives a category the same tint every time, and none slate', () => {
    expect(tintOf('Stationery')).toBe(tintOf('Stationery'));
    expect(tintOf(null)).toBe(TINTS[5]);
    expect(TINTS.slice(0, 5)).toContain(tintOf('Cables'));
  });
});

describe('open sales and held ones', () => {
  const T0 = Date.parse('2026-10-06T09:00:00Z');
  const withLine = (s: TillCarts, product = 9) => updateActive(s, (c) => addLine(c, product));

  it('opens up to five sales, going to an empty one rather than opening another', () => {
    let s = initialCarts(T0);
    expect(newSale(s, T0)).toBe(s);
    s = withLine(s);
    for (let i = 0; i < 4; i++) s = withLine(newSale(s, T0, `n${i}`), 10 + i);
    expect(s.sales).toHaveLength(MAX_OPEN);
    expect(newSale(s, T0, 'sixth')).toBe(s);
    expect(activeSale(s).id).toBe('n3');
    expect(switchIndex(s, 0).active).toBe(s.sales[0]!.id);
    expect(switchIndex(s, 7)).toBe(s);
    expect(switchSale(s, 'n1').active).toBe('n1');
    expect(openWithLines(s)).toHaveLength(5);
  });

  it('keeps each sale’s cart apart, and drops a paid one for its neighbour', () => {
    let s = withLine(initialCarts(T0), 9);
    const first = s.active;
    s = withLine(newSale(s, T0, 'b'), 3);
    expect(activeSale(s).cart.lines).toEqual([{ product_id: 3, quantity: 1 }]);
    s = switchSale(s, first);
    expect(activeSale(s).cart.lines).toEqual([{ product_id: 9, quantity: 1 }]);
    s = dropSale(s, first, T0);
    expect(s.active).toBe('b');
    s = dropSale(s, 'b', T0);
    expect(s.sales).toHaveLength(1);
    expect(activeSale(s).cart).toEqual(EMPTY_CART);
  });

  it('holds a sale with a note, recalls it into an empty sale, and refuses a sixth', () => {
    let s = withLine(initialCarts(T0), 9);
    const id = s.active;
    expect(holdSale(initialCarts(T0), initialCarts(T0).active, '', T0).held).toEqual([]);
    s = holdSale(s, id, '  Went to fetch his card ', T0);
    expect(s.held).toMatchObject([{ id, note: 'Went to fetch his card', held_at: new Date(T0).toISOString() }]);
    expect(s.sales).toHaveLength(1);
    expect(activeSale(s).cart.lines).toEqual([]);
    const back = recallSale(s, id)!;
    expect(back.sales).toHaveLength(1);
    expect(back.active).toBe(id);
    expect(back.held).toEqual([]);
    let full = s;
    for (let i = 0; i < 5; i++) full = withLine(i ? newSale(full, T0, `f${i}`) : full, 20 + i);
    expect(recallSale(full, id)).toBeNull();
    expect(discardHeld(s, id).held).toEqual([]);
  });

  it('discards a held sale after a day', () => {
    const open = withLine(initialCarts(T0), 9);
    const held = holdSale(open, open.active, '', T0);
    expect(held.held).toHaveLength(1);
    expect(expireHeld(held, T0 + POS_HOLD_TTL_MS - 1)).toBe(held);
    expect(expireHeld(held, T0 + POS_HOLD_TTL_MS).held).toEqual([]);
    expect(heldWithin([{ held_at: 'nonsense' }], T0)).toEqual([]);
  });

  it('is what the main process keeps', () => {
    const s = holdSale(withLine(newSale(withLine(initialCarts(T0), 9), T0, 'b'), 3), 'b', 'back soon', T0);
    expect(posCartsSchema.safeParse(s).success).toBe(true);
    expect(posCartsSchema.safeParse({ ...s, sales: [] }).success).toBe(false);
  });
});

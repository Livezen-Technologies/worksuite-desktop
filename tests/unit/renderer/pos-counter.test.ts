import { describe, expect, it } from 'vitest';
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

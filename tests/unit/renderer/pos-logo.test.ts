import { describe, expect, it } from 'vitest';
import { logoFromPixels, logoSize, toBase64 } from '../../../src/modules/pos/logo';

describe('receipt logo', () => {
  it('makes dark pixels ink and light or transparent ones paper, eight to a byte', () => {
    // 10 × 1: black, white, transparent black, dark grey, then six black
    const px = [0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 0, 90, 90, 90, 255, ...Array(6).fill([0, 0, 0, 255]).flat()];
    const { rows, bytesWide } = logoFromPixels(new Uint8ClampedArray(px), 10, 1);
    expect(bytesWide).toBe(2);
    expect([...rows]).toEqual([0b10011111, 0b11000000]);
    expect(toBase64(new Uint8Array([0xff, 0x00]))).toBe('/wA=');
  });

  it('fits the roll, in whole bytes, and never too tall', () => {
    expect(logoSize(1000, 500, 384)).toEqual({ width: 384, height: 192 });
    expect(logoSize(100, 50, 384)).toEqual({ width: 96, height: 48 });
    expect(logoSize(300, 3000, 384, 200)).toEqual({ width: 16, height: 160 });
  });
});

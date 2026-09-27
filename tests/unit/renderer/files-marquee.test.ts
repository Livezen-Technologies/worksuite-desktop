import { describe, expect, it } from 'vitest';
import { rectOf, within } from '../../../src/modules/files/marquee';

const box = (key: string, left: number, top: number, w = 100, h = 100) => ({ key, left, top, right: left + w, bottom: top + h });

describe('files: drag to select', () => {
  it('makes the same rectangle whichever way it is dragged', () => {
    expect(rectOf({ x: 50, y: 80 }, { x: 10, y: 20 })).toEqual({ left: 10, top: 20, right: 50, bottom: 80 });
    expect(rectOf({ x: 10, y: 20 }, { x: 50, y: 80 })).toEqual({ left: 10, top: 20, right: 50, bottom: 80 });
  });

  it('chooses every tile the rectangle touches, and none it only borders', () => {
    const tiles = [box('f:1', 0, 0), box('f:2', 110, 0), box('f:3', 220, 0), box('f:4', 0, 110)];
    expect(within({ left: 50, top: 50, right: 150, bottom: 60 }, tiles)).toEqual(['f:1', 'f:2']);
    expect(within({ left: 50, top: 50, right: 60, bottom: 150 }, tiles)).toEqual(['f:1', 'f:4']);
    // Touching an edge exactly is not overlapping it.
    expect(within({ left: 100, top: 0, right: 110, bottom: 50 }, tiles)).toEqual([]);
    expect(within({ left: 0, top: 0, right: 400, bottom: 400 }, tiles)).toHaveLength(4);
  });
});

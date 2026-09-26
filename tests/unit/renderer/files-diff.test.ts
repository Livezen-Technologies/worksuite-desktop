import { describe, expect, it } from 'vitest';
import { changedLines, diffLines, hunks } from '../../../src/modules/files/diff';

/** Every line of both sides comes back, in order, from the ops. */
function sides(a: string[], b: string[]) {
  const ops = diffLines(a, b)!;
  return {
    ops,
    fromA: ops.flatMap((o) => (o.kind === 'add' ? [] : [a[o.a]])),
    fromB: ops.flatMap((o) => (o.kind === 'del' ? [] : [b[o.b]])),
  };
}

describe('comparing two versions line by line', () => {
  it('finds the lines taken out and put in', () => {
    const a = ['import x', '', "'files.open'", "'transfers.cancel' old", "'sync.pause'"];
    const b = ['import x', '', "'files.open'", "'transfers.cancel' new", "'sync.resolve'", "'sync.pause'"];
    const c = changedLines(a, b)!;
    expect([...c.removed]).toEqual([3]);
    expect([...c.added].sort()).toEqual([3, 4]);
    expect(c.plus).toBe(2);
    expect(c.minus).toBe(1);
    expect(hunks(diffLines(a, b)!)).toBe(1);
  });

  it('handles empty sides and identical texts', () => {
    expect(diffLines([], ['a', 'b'])).toEqual([{ kind: 'add', b: 0 }, { kind: 'add', b: 1 }]);
    expect(diffLines(['a'], [])).toEqual([{ kind: 'del', a: 0 }]);
    expect(diffLines(['a', 'b'], ['a', 'b'])!.every((o) => o.kind === 'same')).toBe(true);
  });

  it('rebuilds both sides exactly, in order, across many random edits', () => {
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    for (let t = 0; t < 300; t++) {
      const a = Array.from({ length: Math.floor(rnd() * 30) }, () => String(Math.floor(rnd() * 6)));
      const b = a.filter(() => rnd() > 0.2).flatMap((x) => (rnd() > 0.8 ? [x, String(Math.floor(rnd() * 6))] : [x]));
      const { ops, fromA, fromB } = sides(a, b);
      expect(fromA).toEqual(a);
      expect(fromB).toEqual(b);
      const same = ops.filter((o) => o.kind === 'same') as Array<{ a: number; b: number }>;
      for (let i = 1; i < same.length; i++) {
        expect(same[i]!.a).toBeGreaterThan(same[i - 1]!.a);
        expect(same[i]!.b).toBeGreaterThan(same[i - 1]!.b);
      }
    }
  });

  it('gives up on texts too different to compare quickly', () => {
    const a = Array.from({ length: 3000 }, (_, i) => `a${i}`);
    const b = Array.from({ length: 3000 }, (_, i) => `b${i}`);
    expect(diffLines(a, b, 100)).toBeNull();
    expect(diffLines([...a, 'x'], a)!.filter((o) => o.kind !== 'same')).toEqual([{ kind: 'del', a: 3000 }]);
  });
});

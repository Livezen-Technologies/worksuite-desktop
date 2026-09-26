/**
 * A line-by-line diff (Myers' algorithm): the fewest lines taken out and put
 * in to turn `a` into `b`. It costs time and memory in proportion to how
 * different the two are, not to their length, so a small change to a long
 * file is cheap. Past `limit` changes it gives up and returns null.
 */
export type Op = { kind: 'same'; a: number; b: number } | { kind: 'del'; a: number } | { kind: 'add'; b: number };

export function diffLines(a: string[], b: string[], limit = 2000): Op[] | null {
  const n = a.length;
  const m = b.length;
  const max = n + m;
  const off = max + 1;
  const v = new Int32Array(2 * max + 3);
  // What `v` held (for k in -d..d) when step d began: enough to walk back.
  const trace: Int32Array[] = [];
  for (let d = 0; d <= max; d++) {
    if (d > limit) return null;
    trace.push(v.slice(off - d, off + d + 1));
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[off + k - 1]! < v[off + k + 1]!) ? v[off + k + 1]! : v[off + k - 1]! + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[off + k] = x;
      if (x >= n && y >= m) return walkBack(trace, n, m);
    }
  }
  return walkBack(trace, n, m);
}

function walkBack(trace: Int32Array[], n: number, m: number): Op[] {
  const out: Op[] = [];
  let x = n;
  let y = m;
  for (let d = trace.length - 1; d >= 0; d--) {
    const at = (k: number) => trace[d]![k + d]!;
    const k = x - y;
    const prevK = k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1;
    const prevX = d === 0 ? 0 : at(prevK);
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      x--;
      y--;
      out.push({ kind: 'same', a: x, b: y });
    }
    if (d > 0) {
      if (x === prevX) out.push({ kind: 'add', b: y - 1 });
      else out.push({ kind: 'del', a: x - 1 });
    }
    x = prevX;
    y = prevY;
  }
  return out.reverse();
}

/** The lines each side changed, for highlighting, and the counts for the status bar. */
export function changedLines(a: string[], b: string[]): { removed: Set<number>; added: Set<number>; plus: number; minus: number } | null {
  const ops = diffLines(a, b);
  if (!ops) return null;
  const removed = new Set<number>();
  const added = new Set<number>();
  for (const o of ops) {
    if (o.kind === 'del') removed.add(o.a);
    else if (o.kind === 'add') added.add(o.b);
  }
  return { removed, added, plus: added.size, minus: removed.size };
}

/** How many separate places changed: runs of consecutive changed lines. */
export function hunks(ops: Op[]): number {
  let n = 0;
  let inRun = false;
  for (const o of ops) {
    if (o.kind === 'same') inRun = false;
    else if (!inRun) {
      n++;
      inRun = true;
    }
  }
  return n;
}

/**
 * A line diff by longest common subsequence, for comparing two versions of a tender document side by side.
 *
 * The server sends each version's words a paragraph per line (`/tenders/documents/{id}/compare`); this lines them up.
 * Lines both versions share are `same`; the rest are `removed` (only in the older) or `added` (only in the newer).
 * A removed line followed by an added one is paired on one row, so a reworded paragraph reads as a change in place.
 *
 * O(n·m) memory and time, so very long documents fall back to a plain prefix/suffix trim with everything between
 * shown as changed — still correct, just less precise.
 */

export type DiffOp = 'same' | 'added' | 'removed';

export interface DiffLine { op: DiffOp; text: string }

/** One row of the side-by-side view: what the older version has on the left, the newer on the right. */
export interface DiffRow {
  left: string | null;
  right: string | null;
  kind: 'same' | 'changed' | 'added' | 'removed';
}

/** Above this many cells (lines × lines) the full LCS table is not built. */
export const MAX_CELLS = 4_000_000;

export function diffLines(a: readonly string[], b: readonly string[]): DiffLine[] {
  let start = 0;
  while (start < a.length && start < b.length && a[start]! === b[start]!) start++;

  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1]! === b[endB - 1]!) { endA--; endB--; }

  const head: DiffLine[] = a.slice(0, start).map((text) => ({ op: 'same', text }));
  const tail: DiffLine[] = a.slice(endA).map((text) => ({ op: 'same', text }));
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);

  if (midA.length * midB.length > MAX_CELLS) {
    return [
      ...head,
      ...midA.map((text): DiffLine => ({ op: 'removed', text })),
      ...midB.map((text): DiffLine => ({ op: 'added', text })),
      ...tail,
    ];
  }

  const n = midA.length;
  const m = midB.length;
  const w = m + 1;
  const lcs = new Uint32Array((n + 1) * w);

  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i * w + j] = midA[i]! === midB[j]! ? lcs[(i + 1) * w + j + 1]! + 1 : Math.max(lcs[(i + 1) * w + j]!, lcs[i * w + j + 1]!);
    }
  }

  const mid: DiffLine[] = [];
  let i = 0;
  let j = 0;

  while (i < n && j < m) {
    if (midA[i]! === midB[j]!) {
      mid.push({ op: 'same', text: midA[i]! }); i++; j++;
    } else if (lcs[(i + 1) * w + j]! >= lcs[i * w + j + 1]!) {
      mid.push({ op: 'removed', text: midA[i]! }); i++;
    } else {
      mid.push({ op: 'added', text: midB[j]! }); j++;
    }
  }
  while (i < n) mid.push({ op: 'removed', text: midA[i++]! });
  while (j < m) mid.push({ op: 'added', text: midB[j++]! });

  return [...head, ...mid, ...tail];
}

/** The diff as side-by-side rows: a run of removals and the run of additions after it are paired up. */
export function sideBySide(lines: readonly DiffLine[]): DiffRow[] {
  const rows: DiffRow[] = [];
  let k = 0;

  while (k < lines.length) {
    if (lines[k]!.op === 'same') {
      rows.push({ left: lines[k]!.text, right: lines[k]!.text, kind: 'same' });
      k++;
      continue;
    }

    const removed: string[] = [];
    const added: string[] = [];
    while (k < lines.length && lines[k]!.op === 'removed') removed.push(lines[k++]!.text);
    while (k < lines.length && lines[k]!.op === 'added') added.push(lines[k++]!.text);

    for (let r = 0; r < Math.max(removed.length, added.length); r++) {
      const left = removed[r] ?? null;
      const right = added[r] ?? null;
      rows.push({ left, right, kind: left !== null && right !== null ? 'changed' : left !== null ? 'removed' : 'added' });
    }
  }

  return rows;
}

/** How many lines were added and removed. */
export function diffStats(lines: readonly DiffLine[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const l of lines) {
    if (l.op === 'added') added++;
    else if (l.op === 'removed') removed++;
  }

  return { added, removed };
}

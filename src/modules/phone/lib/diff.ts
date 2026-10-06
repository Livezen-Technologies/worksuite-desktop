/**
 * A line diff for the configuration review (VOIP-DP-06, design A09): what the switch has now against what applying
 * would write. Longest common subsequence over lines — the generated files are a few hundred lines, so the
 * quadratic table is small; past `LIMIT` lines a cheaper prefix/suffix comparison is used instead.
 */

export type DiffLine = { kind: 'same' | 'add' | 'del'; text: string };

const LIMIT = 4000;

export function diffLines(before: string, after: string): DiffLine[] {
  const a = before === '' ? [] : before.replace(/\r\n/g, '\n').split('\n');
  const b = after === '' ? [] : after.replace(/\r\n/g, '\n').split('\n');
  if (a.length * b.length > LIMIT * LIMIT) return coarse(a, b);
  const n = a.length;
  const m = b.length;
  // lcs[i][j] = LCS length of a[i..] and b[j..]
  const lcs: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ kind: 'same', text: a[i]! });
      i += 1;
      j += 1;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      out.push({ kind: 'del', text: a[i]! });
      i += 1;
    } else {
      out.push({ kind: 'add', text: b[j]! });
      j += 1;
    }
  }
  while (i < n) out.push({ kind: 'del', text: a[i++]! });
  while (j < m) out.push({ kind: 'add', text: b[j++]! });
  return out;
}

function coarse(a: string[], b: string[]): DiffLine[] {
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p += 1;
  let s = 0;
  while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s += 1;
  return [
    ...a.slice(0, p).map((text) => ({ kind: 'same' as const, text })),
    ...a.slice(p, a.length - s).map((text) => ({ kind: 'del' as const, text })),
    ...b.slice(p, b.length - s).map((text) => ({ kind: 'add' as const, text })),
    ...a.slice(a.length - s).map((text) => ({ kind: 'same' as const, text })),
  ];
}

/** How many lines change: the "5 changes not on the switch yet" counter when the server does not count them. */
export function changeCount(lines: DiffLine[]): number {
  let n = 0;
  let inRun = false;
  for (const l of lines) {
    if (l.kind === 'same') inRun = false;
    else if (!inRun) {
      n += 1;
      inRun = true;
    }
  }
  return n;
}

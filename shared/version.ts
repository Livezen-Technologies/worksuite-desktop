/**
 * Semantic version comparison. Numeric per part, so 2.0.10 is newer than
 * 2.0.9 — string comparison gets that wrong and would let an unsupported
 * client past a minimum-version check (FR-UPD-03).
 */
export interface SemVer {
  major: number;
  minor: number;
  patch: number;
  pre: string[];
}

const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

export function parseVersion(input: string): SemVer | null {
  const m = SEMVER.exec(input.trim());
  if (!m) return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    pre: m[4] ? m[4].split('.') : [],
  };
}

function comparePre(a: string[], b: string[]): number {
  // A release outranks any of its pre-releases.
  if (a.length === 0 && b.length === 0) return 0;
  if (a.length === 0) return 1;
  if (b.length === 0) return -1;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i];
    const y = b[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const xn = /^\d+$/.test(x);
    const yn = /^\d+$/.test(y);
    if (xn && yn) {
      const d = Number(x) - Number(y);
      if (d !== 0) return Math.sign(d);
    } else if (xn !== yn) {
      return xn ? -1 : 1;
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
}

/** Returns -1, 0 or 1. Unparseable versions sort below every valid one. */
export function compareVersions(a: string, b: string): number {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x && !y) return 0;
  if (!x) return -1;
  if (!y) return 1;
  for (const k of ['major', 'minor', 'patch'] as const) {
    if (x[k] !== y[k]) return x[k] > y[k] ? 1 : -1;
  }
  return comparePre(x.pre, y.pre);
}

export function isBelowMinimum(installed: string, minimum: string | null | undefined): boolean {
  if (!minimum) return false;
  if (!parseVersion(minimum)) return false;
  return compareVersions(installed, minimum) < 0;
}

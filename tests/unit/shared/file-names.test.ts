import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * macOS and Windows find files without regard to case. An import that leaves the extension out tries `.ts` before
 * `.tsx`, so with `Tender.tsx` and `tender.ts` side by side, `import Tender from './Tender'` got `tender.ts` there and
 * the build broke — on those two systems only, never on Linux, where the tests run. No two modules in one folder may
 * have names that differ only in case.
 */
const ROOT = join(__dirname, '../../..');
const CODE = /\.(tsx?|mts|cts|mjs|cjs|jsx?)$/;

function clashes(dir: string): string[][] {
  const found: string[][] = [];
  const byName = new Map<string, string[]>();
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      found.push(...clashes(path));
      continue;
    }
    if (!CODE.test(name)) continue;
    const key = name.replace(CODE, '').toLowerCase();
    byName.set(key, [...(byName.get(key) ?? []), relative(ROOT, path)]);
  }
  for (const group of byName.values()) if (group.length > 1 && new Set(group.map((p) => p.replace(CODE, ''))).size > 1) found.push(group);
  return found;
}

describe('file names', () => {
  it.each(['src', 'electron', 'shared'])('in %s, no two modules in a folder differ only in case', (dir) => {
    expect(clashes(join(ROOT, dir))).toEqual([]);
  });
});

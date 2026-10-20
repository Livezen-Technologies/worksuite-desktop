import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { builtinProfiles, VERSION, verifyProfile } from '@worksuite/sinhala-core';

/**
 * The pinned engine (vendor/sinhala-core) is exactly what scripts/sync-sinhala-core.mjs built from the recorded
 * worksuite-office commit: nothing edited by hand, nothing added. `npm run sinhala:check` also compares it with the
 * engine's current sources when that repository is checked out beside this one.
 */
const root = join(__dirname, '../../../vendor/sinhala-core');
const source = JSON.parse(readFileSync(join(root, 'SOURCE.json'), 'utf8')) as { package: string; version: string; commit: string; repository: string; path: string; sources: Record<string, string>; files: Record<string, string> };

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)]));
}

describe('the pinned Sinhala engine', () => {
  it('records where it came from', () => {
    expect(source.package).toBe('@worksuite/sinhala-core');
    expect(source.repository).toBe('Livezen-Technologies/worksuite-office');
    expect(source.path).toBe('sinhala/core');
    expect(source.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(Object.keys(source.sources)).toContain('src/convert.ts');
    expect(Object.keys(source.sources).filter((f) => f.startsWith('profiles/'))).toHaveLength(3);
  });

  it('has not drifted from its build: every file matches its recorded sha256', () => {
    const now: Record<string, string> = {};
    for (const p of walk(root)) {
      const rel = relative(root, p).split('\\').join('/');
      if (rel !== 'SOURCE.json') now[rel] = createHash('sha256').update(readFileSync(p)).digest('hex');
    }
    expect(now).toEqual(source.files);
  });

  it('is the version it says, and its profiles pass their own checks', () => {
    expect(VERSION).toBe(source.version);
    expect(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version).toBe(source.version);
    expect(builtinProfiles.map((p) => p.id).sort()).toEqual(['dl-manel', 'fm-abhaya', 'kaputa']);
    for (const p of builtinProfiles) expect(() => verifyProfile(p)).not.toThrow();
  });
});

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// @ts-expect-error — a plain .mjs script, typed by its tests
import * as mv from '../../../scripts/module.mjs';

/**
 * Each desktop module's own version and changelog (docs/MODULES.md): every module has both and they agree, a
 * release writes both, and a branch that changes a module without a new version is caught.
 */
const ROOT = join(__dirname, '..', '..', '..');

describe('the modules in this repository', () => {
  it('each has a version its changelog agrees with, and only paths that exist', () => {
    for (const m of mv.modules(ROOT) as string[]) {
      const j = mv.read(ROOT, m);
      expect(j, `${m} has no module.json — npm run module -- init`).not.toBeNull();
      expect(j.module).toBe(m);
      expect(j.version).toMatch(mv.SEMVER);
      const log = readFileSync(join(ROOT, mv.changelogPath(m)), 'utf8');
      expect(mv.changelogVersion(log), `${m}: the newest CHANGELOG.md section is not module.json's version`).toBe(j.version);
      for (const p of j.paths as string[]) expect(existsSync(join(ROOT, p)), `${m} claims ${p}`).toBe(true);
    }
  });
});

describe('module versions', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'ws-modver-'));
    for (const m of ['pos', 'chat']) mkdirSync(join(root, 'src/modules', m), { recursive: true });
    mkdirSync(join(root, 'electron/services'), { recursive: true });
    for (const f of ['pos-till.ts', 'pos-print.ts', 'posh.ts', 'webchat-ring.ts']) writeFileSync(join(root, 'electron/services', f), '');
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('rises by level', () => {
    expect(mv.bump('1.4.2', 'patch')).toBe('1.4.3');
    expect(mv.bump('1.4.2', 'minor')).toBe('1.5.0');
    expect(mv.bump('1.4.2', 'major')).toBe('2.0.0');
    expect(mv.compare('1.10.0', '1.9.9')).toBe(1);
    expect(() => mv.bump('1.4', 'patch')).toThrow();
  });

  it('starts every module at 1.0.0 with the main-process files it owns by name', () => {
    expect(mv.init(root, '2026-09-30')).toEqual(['chat', 'pos']);
    expect(mv.read(root, 'pos').paths).toEqual(['electron/services/pos-print.ts', 'electron/services/pos-till.ts']);
    expect(mv.read(root, 'chat').paths).toEqual(['electron/services/webchat-ring.ts']);
    expect(mv.init(root)).toEqual([]);
  });

  it('writes a release: the version, and a grouped section newest first', () => {
    mv.init(root, '2026-09-30');
    expect(mv.release(root, 'pos', 'minor', ['Added: drawer rules', 'Fixed: a receipt', 'A plain note'], '2026-10-01')).toEqual({ from: '1.0.0', to: '1.1.0' });
    const log = readFileSync(join(root, mv.changelogPath('pos')), 'utf8');
    expect(mv.read(root, 'pos').version).toBe('1.1.0');
    expect(log.indexOf('## 1.1.0')).toBeLessThan(log.indexOf('## 1.0.0'));
    expect(log).toContain("## 1.1.0 — 2026-10-01\n\n- A plain note\n\n**Added**\n\n- drawer rules\n\n**Fixed**\n\n- a receipt\n");
    expect(() => mv.release(root, 'pos', 'patch', ['  '])).toThrow(/Say what changed/);
  });

  it('knows which module a changed file belongs to', () => {
    mv.init(root);
    expect(mv.owners(root, ['src/modules/pos/Till.tsx', 'electron/services/pos-till.ts', 'electron/services/posh.ts', 'README.md'])).toEqual({
      pos: ['src/modules/pos/Till.tsx', 'electron/services/pos-till.ts'],
    });
  });

  it('says what a branch owes until the version rises and the section is written', () => {
    mv.init(root);
    const base = (p: string) => (p.endsWith('module.json') ? JSON.stringify({ module: 'x', version: '1.0.0', paths: [] }) : null);
    const files = ['src/modules/pos/Till.tsx', 'src/modules/chat/Room.tsx'];
    const owed = mv.owed(root, files, base);
    expect(Object.keys(owed)).toEqual(['chat', 'pos']);
    expect(owed.pos).toMatch(/^The version is still 1\.0\.0/);
    mv.release(root, 'pos', 'patch', ['Fixed: a receipt']);
    expect(Object.keys(mv.owed(root, files, base))).toEqual(['chat']);
    expect(mv.owed(root, files, base, ['chat'])).toEqual({});
    expect(mv.owed(root, ['src/modules/pos/module.json'], () => null)).toEqual({});
  });

  it('names tags and branches after the module', () => {
    expect(mv.tag('pos', '1.4.0')).toBe('pos/v1.4.0');
    expect(mv.branch('pos', 'Drawer rules!')).toBe('module/pos/drawer-rules');
  });
});

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Linter } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';
import boundaries, { allowedPairs, moduleOf, targetOf } from '../../../build-tools/eslint-boundaries.mjs';
import { MODULE_IMPORTS } from '../../../build-tools/module-boundaries.mjs';

const root = resolve(__dirname, '../../..');
const SPEC = /(?:\bfrom\s*|\bimport\s*\(\s*|^\s*import\s+|\bvi\.(?:do)?[mM]ock\(\s*)(['"])([^'"]+)\1/gm;

/** Every module → module pair the source imports today, with how many imports. */
function usedPairs(): Map<string, number> {
  const used = new Map<string, number>();
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const file = join(dir, name);
      if (statSync(file).isDirectory()) walk(file);
      else if (/\.tsx?$/.test(name)) {
        const from = moduleOf(file);
        if (!from) continue;
        for (const m of readFileSync(file, 'utf8').matchAll(SPEC)) {
          const to = targetOf(file, m[2]);
          if (to && to !== from) used.set(`${from}>${to}`, (used.get(`${from}>${to}`) ?? 0) + 1);
        }
      }
    }
  };
  walk(join(root, 'src/modules'));
  return used;
}

/** build-tools/eslint-boundaries.mjs (audit D-G08): modules do not import modules, outside a reviewed allow-list. */
describe('module boundaries', () => {
  const linter = new Linter({ configType: 'flat' });
  const lint = (file: string, code: string, allow: unknown[] = []) =>
    linter
      .verify(code, [{ files: ['**/*.ts', '**/*.tsx'], languageOptions: { parser: tseslint.parser as never }, plugins: { boundaries }, rules: { 'boundaries/no-module-imports': ['error', { allow }] } }], join(root, file))
      .map((m) => m.ruleId);

  it("refuses a module importing another module's file, in every form", () => {
    for (const code of [
      "import { Panel } from '../hr/api';",
      "export { money } from '../finance/api';",
      "export * from '../inventory/control';",
      "const m = import('../hr/Leave');",
      "import { x } from '@/modules/hr/api';",
      "import type { T } from '../hr';",
    ])
      expect(lint('src/modules/crm/Deal.tsx', code), code).toEqual(['boundaries/no-module-imports']);
    expect(lint('src/modules/crm/deals/Board.tsx', "import { a } from '../../inventory/control';")).toEqual(['boundaries/no-module-imports']);
  });

  it('accepts its own files, shared code, the registry, packages and an allowed pair', () => {
    for (const code of [
      "import { a } from './api';",
      "import { a } from '../crm/api';",
      "import { Panel } from '../../components/PageKit';",
      "import { t } from '../../core/i18n';",
      "import { x } from '@shared/support';",
      "import { modules } from '../registry';",
      "import { useState } from 'react';",
    ])
      expect(lint('src/modules/crm/Deal.tsx', code), code).toEqual([]);
    expect(lint('src/modules/crm/Deal.tsx', "import { a } from '../hr/api';", [{ from: 'crm', to: ['hr'], why: 'test' }])).toEqual([]);
    expect(lint('src/app/App.tsx', "import { a } from '../modules/hr/api';")).toEqual([]);
  });

  it('allows exactly the pairs the source still needs: every import is on the list, and every entry is still used', () => {
    const used = usedPairs();
    const allowed = allowedPairs(MODULE_IMPORTS);
    expect([...used.keys()].filter((p) => !allowed.has(p)).sort()).toEqual([]);
    expect([...allowed].filter((p) => !used.has(p)).sort()).toEqual([]);
  });

  it('gives every allow-list entry a reason', () => {
    for (const entry of MODULE_IMPORTS) expect(entry.why.length, `${entry.to}`).toBeGreaterThan(20);
  });

  it('keeps the shared kits outside the modules', () => {
    for (const kit of ['PageKit', 'ListKit', 'RecordKit', 'FormKit', 'CardKit', 'CallKit', 'ConsoleKit', 'ReportKit']) expect(statSync(join(root, `src/components/${kit}.tsx`)).isFile()).toBe(true);
  });
});

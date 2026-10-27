#!/usr/bin/env node
// The unit tests' line coverage as a Markdown table (audit D-G07): the whole app, the main process, shared/, the shell,
// and each module of src/modules — from coverage/coverage-summary.json, which `npm run test:coverage` writes. CI appends
// it to the job summary; locally it prints.
//
//   node scripts/coverage-summary.mjs [coverage/coverage-summary.json]
import { existsSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const file = resolve(root, process.argv[2] ?? 'coverage/coverage-summary.json');
if (!existsSync(file)) {
  console.log(`No coverage summary at ${relative(root, file)}: the coverage run did not finish.`);
  process.exit(0);
}
const summary = JSON.parse(readFileSync(file, 'utf8'));
const groups = new Map();
const add = (name, s) => {
  const g = groups.get(name) ?? { covered: 0, total: 0, files: 0 };
  g.covered += s.lines.covered;
  g.total += s.lines.total;
  g.files += 1;
  groups.set(name, g);
};
for (const [path, s] of Object.entries(summary)) {
  if (path === 'total') continue;
  const rel = relative(root, path).replaceAll('\\', '/');
  const m = /^src\/modules\/([^/]+)\//.exec(rel);
  if (m) add(`module ${m[1]}`, s);
  else if (rel.startsWith('electron/')) add('electron (main process)', s);
  else if (rel.startsWith('shared/')) add('shared', s);
  else if (rel.startsWith('src/')) add('src (shell, core, components)', s);
}
const pct = (g) => (g.total ? (100 * g.covered) / g.total : 100);
const t = summary.total;
const out = [
  '### Unit test coverage',
  '',
  `Lines **${t.lines.pct}%** · statements ${t.statements.pct}% · functions ${t.functions.pct}% · branches ${t.branches.pct}%`,
  '',
  '| Area | Lines | Covered / total | Files |',
  '|---|---:|---:|---:|',
  ...[...groups]
    .sort(([a, x], [b, y]) => (a.startsWith('module') === b.startsWith('module') ? pct(x) - pct(y) || a.localeCompare(b) : a.startsWith('module') ? 1 : -1))
    .map(([name, g]) => `| ${name} | ${pct(g).toFixed(1)}% | ${g.covered} / ${g.total} | ${g.files} |`),
];
console.log(out.join('\n'));

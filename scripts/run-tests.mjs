// Runs Vitest under Electron's own Node (ELECTRON_RUN_AS_NODE), so the tests
// use the same Node the app ships with — including node:sqlite — on every
// platform and whatever Node the developer happens to have installed.
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const electron = require('electron');
const vitest = join(root, 'node_modules', 'vitest', 'vitest.mjs');
const args = process.argv.slice(2);
const res = spawnSync(electron, [vitest, ...(args.length ? args : ['run'])], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
});
process.exit(res.status ?? 1);

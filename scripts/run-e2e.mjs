// Runs tests/e2e/smoke.mjs under Electron's Node. Needs WS_E2E_SERVER,
// WS_E2E_EMAIL and WS_E2E_PASSWORD for a test account on a WorkSuite server.
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const electron = createRequire(import.meta.url)('electron');
const res = spawnSync(electron, [join(root, 'tests', 'e2e', 'smoke.mjs')], { cwd: root, stdio: 'inherit', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
process.exit(res.status ?? 1);

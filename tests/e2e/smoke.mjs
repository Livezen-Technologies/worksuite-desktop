// End-to-end smoke test: launches the built app with an isolated profile,
// drives it over the Chrome DevTools Protocol against a real WorkSuite
// server, and saves a screenshot of each screen.
//
//   npm run build
//   WS_E2E_SERVER=http://localhost:8920 WS_E2E_EMAIL=… WS_E2E_PASSWORD=… \
//     ELECTRON_RUN_AS_NODE=1 npx electron tests/e2e/smoke.mjs
//
// Runs under Electron's own Node (global fetch and WebSocket).
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const server = process.env.WS_E2E_SERVER;
const email = process.env.WS_E2E_EMAIL;
const password = process.env.WS_E2E_PASSWORD;
if (!server || !email || !password) {
  console.error('Set WS_E2E_SERVER, WS_E2E_EMAIL and WS_E2E_PASSWORD.');
  process.exit(2);
}
const outDir = process.env.WS_E2E_OUT ?? join(root, 'test-results', 'e2e');
mkdirSync(outDir, { recursive: true });
const profile = mkdtempSync(join(tmpdir(), 'ws-e2e-'));
const port = 9300 + Math.floor(Math.random() * 500);

const electronBin = process.execPath;
const env = { ...process.env, WS_USER_DATA_DIR: profile };
delete env.ELECTRON_RUN_AS_NODE;
delete env.ELECTRON_RENDERER_URL;
const child = spawn(electronBin, [root, `--remote-debugging-port=${port}`], { env, stdio: ['ignore', 'pipe', 'pipe'] });
const mainLog = [];
child.stdout.on('data', (d) => mainLog.push(String(d)));
child.stderr.on('data', (d) => mainLog.push(String(d)));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
let failures = 0;
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

async function target() {
  for (let i = 0; i < 100; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = list.find((t) => t.type === 'page' && t.url.startsWith('app://bundle'));
      if (page) return page;
    } catch {
      /* not up yet */
    }
    await sleep(200);
  }
  throw new Error('the app window never appeared');
}

let ws;
let seq = 0;
const pending = new Map();
const consoleErrors = [];
function send(method, params = {}) {
  const id = ++seq;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}
async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
}
async function waitFor(expression, label, timeout = 20_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    try {
      if (await evaluate(expression)) return true;
    } catch {
      /* page reloading */
    }
    await sleep(150);
  }
  throw new Error(`timed out waiting for ${label}`);
}
async function shot(name) {
  await sleep(350);
  const r = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(outDir, `${name}.png`), Buffer.from(r.data, 'base64'));
}
const hasText = (t) => `document.body.innerText.includes(${JSON.stringify(t)})`;
const clickButton = (label) =>
  evaluate(`(() => { const b = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(label)} || b.getAttribute('aria-label') === ${JSON.stringify(label)}); if (!b) return false; b.click(); return true; })()`);
const fill = (labelText, value) =>
  evaluate(`(() => {
    const l = [...document.querySelectorAll('label')].find(l => l.textContent.trim().startsWith(${JSON.stringify(labelText)}));
    const el = l && l.querySelector('input,textarea');
    if (!el) return false;
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set;
    setter.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);

try {
  const page = await target();
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => {
    ws.onopen = r;
    ws.onerror = j;
  });
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message));
      else p.resolve(msg.result);
    } else if (msg.method === 'Runtime.exceptionThrown') {
      consoleErrors.push(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text);
    } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      consoleErrors.push(msg.params.args.map((a) => a.value ?? a.description).join(' '));
    }
  };
  await send('Runtime.enable');
  await send('Page.enable');

  // Security: the renderer has no Node, and only the typed bridge.
  await waitFor('!!window.worksuite', 'the bridge');
  check('renderer has no Node.js (require/process)', await evaluate(`typeof require === 'undefined' && typeof process === 'undefined'`));
  check('bridge exposes no raw ipcRenderer', await evaluate(`!('ipcRenderer' in window.worksuite) && typeof window.worksuite.auth.signIn === 'function'`));
  check('a forged IPC payload is refused', await evaluate(`window.worksuite.auth.signIn({ email: 1 }).then(r => r && r.__wsError && r.code === 'IPC_VALIDATION_FAILED')`));
  check('content security policy is enforced', await evaluate(`fetch('https://example.com').then(() => false, () => true)`));

  await waitFor(hasText('Connect to WorkSuite'), 'the server screen');
  await shot('01-server');
  await fill('Server address', server);
  await clickButton('Continue');
  await waitFor(hasText('Forgot your password?'), 'the sign-in screen');
  await shot('02-sign-in');
  await fill('Email', email);
  await fill('Password', password);
  await evaluate(`document.querySelector('form').requestSubmit()`);
  await waitFor(`${hasText('Set up WorkSuite')} || ${hasText('Good ')}`, 'the setup wizard or the shell', 40_000);
  check('sign-in, device registration and bootstrap complete', true);
  if (await evaluate(hasText('Set up WorkSuite'))) {
    await shot('03-setup');
    for (let i = 0; i < 6 && (await evaluate(hasText('Continue'))); i++) {
      await clickButton('Continue');
      await sleep(200);
    }
    await shot('04-setup-finish');
    await clickButton('Open WorkSuite');
  }
  await waitFor(hasText('Good '), 'the home dashboard', 30_000);
  await sleep(2500);
  await shot('05-home');
  check('home dashboard renders', true);

  const device = await evaluate(`window.worksuite.security.deviceInfo()`);
  check('device registered with the server', !!device?.id, `id ${device?.id}`);

  const apps = await evaluate(`[...document.querySelectorAll('nav[aria-label="Apps"] button')].map(b => b.textContent.trim()).filter(Boolean)`);
  check('sidebar shows the permitted apps', apps.length > 3, apps.join(', '));

  for (const [label, name, marker] of [
    ['Mail', '06-mail', 'Compose'],
    ['Chat', '07-chat', 'Pick a conversation'],
    ['Calendar', '08-calendar', 'Today'],
    ['Tasks', '09-tasks', 'My tasks'],
    ['Files', '10-files', 'My Drive'],
    ['CRM', '11-crm', 'Leads'],
    ['HR', '12-hr', 'My attendance'],
  ]) {
    const present = await evaluate(`[...document.querySelectorAll('nav[aria-label="Apps"] button')].some(b => b.textContent.trim().startsWith(${JSON.stringify(label)}))`);
    if (!present) {
      check(`${label} opens`, true, 'not visible to this user — skipped');
      continue;
    }
    await evaluate(`[...document.querySelectorAll('nav[aria-label="Apps"] button')].find(b => b.textContent.trim().startsWith(${JSON.stringify(label)})).click()`);
    try {
      await waitFor(hasText(marker), `${label} to load`, 20_000);
      await sleep(1800);
      await shot(name);
      const broken = await evaluate(hasText('failed to load'));
      check(`${label} opens`, !broken);
    } catch (e) {
      await shot(`${name}-error`);
      check(`${label} opens`, false, e.message);
    }
  }

  // Global search overlay (Ctrl/Cmd+K).
  await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', code: 'KeyK', metaKey: navigator.platform.startsWith('Mac'), ctrlKey: !navigator.platform.startsWith('Mac'), bubbles: true }))`);
  await waitFor(`!!document.querySelector('[aria-label="Search"][role="combobox"]')`, 'the search overlay');
  await shot('13-search');
  check('search opens with the keyboard shortcut', true);
  await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  await evaluate(`document.querySelector('[aria-label="Search"][role="combobox"]')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);

  await evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Settings').click()`);
  await waitFor(hasText('Language'), 'settings');
  await shot('14-settings');
  check('settings open', true);

  // Light theme (FR-SHL-06): the same home screen in the light palette.
  await evaluate(`window.worksuite.settings.set({ theme: 'light' })`);
  await evaluate(`[...document.querySelectorAll('nav[aria-label="Apps"] button')].find(b => b.textContent.trim().startsWith('Home')).click()`);
  await waitFor(`document.documentElement.dataset.theme === 'light' && ${hasText('Good ')}`, 'the light theme');
  await sleep(1200);
  await shot('14b-home-light');
  check('light theme applies', true);
  await evaluate(`window.worksuite.settings.set({ theme: 'system' })`);
  // Diagnostics
  await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F1', code: 'F1', bubbles: true }))`);
  await waitFor(hasText('Create diagnostic report'), 'diagnostics');
  await sleep(2500);
  await shot('15-diagnostics');
  const diag = await evaluate(`window.worksuite.diagnostics.run()`);
  check('diagnostics: server reachable', diag.find((c) => c.id === 'api')?.status === 'pass', diag.find((c) => c.id === 'api')?.detail);
  check('diagnostics: local database healthy', diag.find((c) => c.id === 'db')?.status === 'pass');
  check('diagnostics: hash helper healthy', /hash-worker: healthy/.test(diag.find((c) => c.id === 'helpers')?.detail ?? ''), diag.find((c) => c.id === 'helpers')?.detail);
  const preview = await evaluate(`window.worksuite.diagnostics.previewBundle()`);
  const bundleText = preview.files.map((f) => f.preview).join('\n');
  check('diagnostic bundle carries no token', !/eyJ[A-Za-z0-9_-]{10,}\./.test(bundleText) && !bundleText.includes(password));

  // Offline queue round trip: a draft survives and reads back.
  await evaluate(`window.worksuite.offline.saveDraft({ module: 'e2e', context: 'probe', content: { text: 'hello' } })`);
  const draft = await evaluate(`window.worksuite.offline.getDraft({ module: 'e2e', context: 'probe' })`);
  check('drafts are saved and restored', draft?.content?.text === 'hello');
  await evaluate(`window.worksuite.offline.deleteDraft({ module: 'e2e', context: 'probe' })`);

  // App lock.
  await evaluate(`window.worksuite.security.lock()`);
  await waitFor(hasText('WorkSuite is locked'), 'the lock screen');
  await shot('16-locked');
  const refused = await evaluate(`window.worksuite.offline.status().then(r => r && r.__wsError && r.code)`);
  check('IPC refuses app data while locked', refused === 'APP_LOCKED', String(refused));
  await fill('WorkSuite password', password);
  await evaluate(`document.querySelector('form').requestSubmit()`);
  await waitFor(`!${hasText('WorkSuite is locked')}`, 'unlock', 20_000);
  check('unlock with the WorkSuite password', true);

  const status = await evaluate(`window.worksuite.status.snapshot()`);
  check('network status is online', status.network === 'ONLINE' || status.network === 'LIMITED', `${status.network} / realtime ${status.realtime}`);

  // Sign out and leave no session behind.
  await evaluate(`window.worksuite.auth.signOut({ wipe: true })`);
  await waitFor(hasText('Forgot your password?'), 'the sign-in screen after sign-out');
  check('sign out returns to sign-in', true);
} catch (e) {
  check('smoke run', false, e.message);
  try {
    await shot('zz-failure');
  } catch {
    /* no page */
  }
} finally {
  const relevant = consoleErrors.filter((e) => !/Autofill|DevTools|favicon/i.test(e));
  check('no renderer errors', relevant.length === 0, relevant.slice(0, 5).join(' | '));
  writeFileSync(join(outDir, 'main.log'), mainLog.join(''));
  writeFileSync(join(outDir, 'results.json'), JSON.stringify({ results, consoleErrors }, null, 2));
  ws?.close();
  child.kill();
  await sleep(500);
  rmSync(profile, { recursive: true, force: true });
  console.log(`\n${results.length - failures}/${results.length} checks passed — screenshots in ${outDir}`);
  process.exit(failures ? 1 : 0);
}

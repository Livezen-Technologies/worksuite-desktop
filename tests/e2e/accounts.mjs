// End-to-end: Connection & Startup in the renderer (WP4) — the startup selector, the enterprise address and the
// server checks, the branded sign-in, the account switcher and Settings › Accounts & Servers, and a link to a server
// that is not added.
//
// Launches the built app with an isolated profile and drives it over the DevTools protocol, like passkey.mjs. Two
// small servers stand in for WorkSuite:
//   - an "enterprise" server on http://127.0.0.1 (unpackaged builds accept http on this computer) serving an unsigned
//     discovery document built from tests/fixtures/discovery/enterprise.json;
//   - tests/e2e/mock-cloud.mjs with a self-signed certificate, which the checks must refuse with TLS_UNTRUSTED and
//     "Details for IT" — and no way to proceed. That part needs `openssl` on the PATH; without it, it is skipped.
//
//   npm run build
//   WS_E2E_ACCOUNTS=1 ELECTRON_RUN_AS_NODE=1 npx electron tests/e2e/accounts.mjs
//
// Skipped (exit 0) unless WS_E2E_ACCOUNTS=1, and when the desktop answers `accounts:state` with UNSUPPORTED (a build
// without the accounts main process, WP1–WP3). CI without TLS tooling can set WS_E2E_ACCOUNTS_NO_TLS=1.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.env.WS_E2E_ACCOUNTS !== '1') {
  console.log('SKIP  accounts e2e — set WS_E2E_ACCOUNTS=1 (needs a build with the accounts main process).');
  process.exit(0);
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const outDir = process.env.WS_E2E_OUT ?? join(root, 'test-results', 'e2e-accounts');
mkdirSync(outDir, { recursive: true });
const profile = mkdtempSync(join(tmpdir(), 'ws-e2e-acc-'));
const port = 9300 + Math.floor(Math.random() * 500);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
function check(name, ok, detail = '') {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

// ── the enterprise stand-in ────────────────────────────────────────────────
const enterpriseRequests = [];
const enterprise = createServer((req, res) => {
  const origin = `http://127.0.0.1:${enterprise.address().port}`;
  enterpriseRequests.push(req.url);
  const json = (status, body) => {
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(body));
  };
  if (req.url === '/.well-known/worksuite') {
    const doc = JSON.parse(readFileSync(join(root, 'tests', 'fixtures', 'discovery', 'enterprise.json'), 'utf8'));
    doc.server_name = 'Livezen Technologies';
    doc.endpoints = { ...doc.endpoints, api: `${origin}/api`, auth: `${origin}/api/auth`, realtime: null, files: null, office: null, ai: null, policy: null, entitlements: null, health: `${origin}/api/health` };
    doc.link_hosts = ['127.0.0.1'];
    doc.keys = { discovery: null, policy: null };
    doc.branding = { logo: null, accent: '#0B5FFF' };
    return json(200, doc);
  }
  if (req.url === '/.well-known/worksuite.jws') return json(404, { message: 'not signed' });
  if (req.url === '/api/health') return json(200, { status: 'ok' });
  if (req.url === '/api/auth/config') return json(200, { data: { name: 'Livezen Technologies', passkey: false } });
  return json(404, { message: 'not here' });
});
await new Promise((r) => enterprise.listen(0, '127.0.0.1', r));
const enterpriseOrigin = `http://127.0.0.1:${enterprise.address().port}`;

let cloud = null;
if (process.env.WS_E2E_ACCOUNTS_NO_TLS !== '1') {
  try {
    const { startMockCloud } = await import('./mock-cloud.mjs');
    cloud = await startMockCloud({ tls: 'self-signed' });
  } catch (e) {
    console.log(`SKIP  the self-signed server checks — ${e.message}`);
  }
}

const electronBin = process.execPath;
const env = { ...process.env, WS_USER_DATA_DIR: profile, WS_E2E_EXTERNAL_LOG: join(profile, 'external.log') };
delete env.ELECTRON_RUN_AS_NODE;
delete env.ELECTRON_RENDERER_URL;
const child = spawn(electronBin, [root, `--remote-debugging-port=${port}`], { env, stdio: ['ignore', 'pipe', 'pipe'] });
const mainLog = [];
child.stdout.on('data', (d) => mainLog.push(String(d)));
child.stderr.on('data', (d) => mainLog.push(String(d)));

// ── DevTools plumbing (as passkey.mjs) ─────────────────────────────────────
let ws;
let seq = 0;
const pending = new Map();
const consoleErrors = [];
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
  evaluate(`(() => { const b = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(label)} || b.getAttribute('aria-label') === ${JSON.stringify(label)}); if (!b || b.disabled) return false; b.click(); return true; })()`);
const fillById = (labelText, value) =>
  evaluate(`(() => {
    const l = [...document.querySelectorAll('label')].find(l => l.textContent.trim().startsWith(${JSON.stringify(labelText)}));
    const el = l && (l.htmlFor ? document.getElementById(l.htmlFor) : l.querySelector('input,textarea'));
    if (!el) return false;
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set;
    setter.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
const key = (k) => evaluate(`document.activeElement && document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(k)}, bubbles: true })), true`);
function deliver(link) {
  const second = spawn(electronBin, [root, link], { env, stdio: 'ignore' });
  setTimeout(() => second.kill(), 30_000).unref();
}

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

  // The page can be listed before the preload has exposed its bridge (as smoke.mjs, wait for it).
  await waitFor('!!window.worksuite', 'the bridge');
  const supported = await evaluate(`window.worksuite.accounts.state().then(r => !(r && r.__wsError))`);
  if (!supported) {
    console.log('SKIP  this build answers accounts:state with UNSUPPORTED (no accounts main process yet).');
    throw Object.assign(new Error('skip'), { skip: true });
  }

  // ── screen 1 ──
  await waitFor(hasText('How would you like to use WorkSuite?'), 'the startup selector');
  await shot('a1-startup');
  check('a fresh install opens on the startup selector', true);
  check('the footer offers guest mode and Join a meeting', (await evaluate(hasText('Use without an account'))) && (await evaluate(hasText('Join a meeting'))));
  await key('ArrowRight');
  check('→ chooses Enterprise', await evaluate(`document.querySelector('[data-testid="startup-enterprise"]').getAttribute('aria-checked') === 'true'`));
  await key('Enter');
  await waitFor(hasText('Connect to your organization'), 'the enterprise address');
  await shot('a2-address');

  // ── screen 6 ──
  await fillById('WorkSuite server', 'http://worksuite.example.com');
  await clickButton('Continue');
  await waitFor(hasText('Only https servers are accepted. Use the https://'), 'the https rule');
  check('a plain http address is refused before anything connects', true);

  // ── screen 7, refused ──
  if (cloud) {
    await fillById('WorkSuite server', cloud.origin);
    await clickButton('Continue');
    await waitFor(hasText('Details for IT'), 'the failure panel', 40_000);
    await shot('a3-untrusted');
    const details = await evaluate(`document.querySelector('[data-testid="details-for-it"]').innerText`);
    check('a self-signed server is refused with Details for IT', /TLS_UNTRUSTED/.test(details) && /spki\s+sha256\//.test(details), details.split('\n')[0]);
    check('there is no way to proceed anyway', !(await evaluate(`[...document.querySelectorAll('button')].some(b => /proceed|anyway/i.test(b.textContent))`)));
    await clickButton('Change address');
    await waitFor(hasText('Connect to your organization'), 'back on the address');
  }

  // ── screen 7, verified → screen 8 ──
  await fillById('WorkSuite server', enterpriseOrigin);
  await clickButton('Continue');
  await waitFor(`[...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Continue' && !b.disabled) && ${hasText('Checking')}`, 'the checks to pass', 40_000);
  await shot('a4-checks-ok');
  check('the checks pass for the enterprise server', await evaluate(hasText('Livezen Technologies')));
  await clickButton('Continue');
  await waitFor(hasText('WorkSuite — Enterprise · Livezen Technologies'), 'the branded sign-in', 20_000);
  await shot('a5-branded');
  check('the branded sign-in carries the accent stripe', await evaluate(`!!document.querySelector('[data-testid="connect-accent"]')`));
  const state = await evaluate(`window.worksuite.accounts.state()`);
  check('the account was added, active and signed out', state.accounts.length === 1 && state.accounts[0].active && state.accounts[0].signInState === 'signed-out');

  // ── screen 16's dialog ──
  const before = enterpriseRequests.length;
  deliver(process.env.WS_E2E_UNKNOWN_LINK ?? 'worksuite://tasks?server=worksuite.unknown.example');
  await waitFor(hasText('This link belongs to a WorkSuite server you haven’t added'), 'the unknown-server dialog', 20_000);
  await shot('a6-unknown-link');
  check('a link to a server not added asks first', await evaluate(hasText('worksuite.unknown.example')));
  check('nothing was fetched for it', enterpriseRequests.length === before);
  await clickButton('Cancel');
} catch (e) {
  if (!e.skip) {
    check('accounts run', false, e.message);
    try {
      await shot('az-failure');
    } catch {
      /* no page */
    }
  }
} finally {
  const relevant = consoleErrors.filter((e) => !/Autofill|DevTools|favicon/i.test(e));
  check('no renderer errors', relevant.length === 0, relevant.slice(0, 3).join(' | '));
  child.kill();
  enterprise.close();
  await cloud?.close?.();
  await sleep(500);
  rmSync(profile, { recursive: true, force: true });
  if (failures) console.log(mainLog.join('').slice(-3000));
  console.log(`\n${failures ? `${failures} failed` : 'all passed'} — screenshots in ${outDir}`);
  process.exit(failures ? 1 : 0);
}

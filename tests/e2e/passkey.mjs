// End-to-end: passkey sign-in through the browser, and the title-bar clock.
//
// Launches the built app with an isolated profile against a real WorkSuite,
// clicks "Sign in with a passkey", and plays the browser's part itself: it asks
// the server for a WebAuthn challenge, signs an assertion with a software
// authenticator (an EC P-256 key filed on the server as the user's passkey),
// proves it at /api/auth/passkeys/desktop/handoff with the app's PKCE
// challenge, and delivers worksuite://auth/callback to the app the way the OS
// does — by starting a second copy with the link, which hands it to the first.
//
//   npm run build
//   WS_E2E_SERVER=http://localhost:8920 WS_E2E_PASSKEY_KEY=key.pem WS_E2E_PASSKEY_ID=<credential id> \
//   WS_E2E_USER_ID=<user id> ELECTRON_RUN_AS_NODE=1 npx electron tests/e2e/passkey.mjs
//
// The app records the page it would open (WS_E2E_EXTERNAL_LOG, unpackaged
// builds only) instead of opening a real browser.
import { spawn } from 'node:child_process';
import { createPrivateKey, createHash, sign } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { URL, fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const server = process.env.WS_E2E_SERVER;
const keyPath = process.env.WS_E2E_PASSKEY_KEY;
const credentialId = process.env.WS_E2E_PASSKEY_ID;
const userId = process.env.WS_E2E_USER_ID;
if (!server || !keyPath || !credentialId || !userId) {
  console.error('Set WS_E2E_SERVER, WS_E2E_PASSKEY_KEY, WS_E2E_PASSKEY_ID and WS_E2E_USER_ID.');
  process.exit(2);
}
const key = createPrivateKey(readFileSync(keyPath));
const outDir = process.env.WS_E2E_OUT ?? join(root, 'test-results', 'e2e-passkey');
mkdirSync(outDir, { recursive: true });
const profile = mkdtempSync(join(tmpdir(), 'ws-e2e-pk-'));
const externalLog = join(profile, 'external.log');
const port = 9300 + Math.floor(Math.random() * 500);

const electronBin = process.execPath;
const env = { ...process.env, WS_USER_DATA_DIR: profile, WS_E2E_EXTERNAL_LOG: externalLog };
delete env.ELECTRON_RUN_AS_NODE;
delete env.ELECTRON_RENDERER_URL;
const child = spawn(electronBin, [root, `--remote-debugging-port=${port}`], { env, stdio: ['ignore', 'pipe', 'pipe'] });
const mainLog = [];
child.stdout.on('data', (d) => mainLog.push(String(d)));
child.stderr.on('data', (d) => mainLog.push(String(d)));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
function check(name, ok, detail = '') {
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
const clickButtonStarting = (label) =>
  evaluate(`(() => { const b = [...document.querySelectorAll('button')].find(b => (b.getAttribute('aria-label') ?? b.textContent.trim()).startsWith(${JSON.stringify(label)})); if (!b) return false; b.click(); return true; })()`);
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

const b64url = (buf) => Buffer.from(buf).toString('base64url');
async function api(path, body) {
  const res = await fetch(`${server}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

/** The browser's part: a WebAuthn assertion from the software authenticator, proved at the handoff. */
// Seconds since 1970: always above what the server stored from an earlier run,
// which it must be — a counter that does not go up is how a cloned
// authenticator shows itself, and the server refuses it.
let counter = Math.floor(Date.now() / 1000);
async function proveInBrowser(challenge) {
  const opts = await api('/api/auth/passkeys/login/options', {});
  const { handle, options } = opts.json.data;
  const origin = new URL(server).origin;
  const rpId = new URL(server).hostname;
  const clientData = JSON.stringify({ type: 'webauthn.get', challenge: options.challenge, origin, crossOrigin: false });
  const count = Buffer.alloc(4);
  count.writeUInt32BE(++counter);
  const authData = Buffer.concat([createHash('sha256').update(rpId).digest(), Buffer.from([0x05]), count]);
  const signature = sign('sha256', Buffer.concat([authData, createHash('sha256').update(clientData).digest()]), key);
  const credential = {
    id: credentialId,
    rawId: credentialId,
    type: 'public-key',
    response: { clientDataJSON: b64url(clientData), authenticatorData: b64url(authData), signature: b64url(signature), userHandle: b64url(String(userId)) },
  };
  return api('/api/auth/passkeys/desktop/handoff', { handle, credential, code_challenge: challenge, code_challenge_method: 'S256' });
}

/** What the OS does with a worksuite:// link while the app runs: a second copy passes it over and exits. */
function deliver(link) {
  // Not awaited: the app reacts while the second copy is still shutting down,
  // and a toast can be gone by the time it has.
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

  await waitFor(hasText('Connect to WorkSuite'), 'the server screen');
  await fill('Server address', server);
  await clickButton('Continue');
  await waitFor(hasText('Sign in with a passkey'), 'the passkey button on the sign-in screen');
  await shot('p1-sign-in');
  check('the sign-in screen offers a passkey on a server that announces it', true);

  // A callback nobody asked for is refused and signs nothing in.
  deliver(`worksuite://auth/callback?code=${'x'.repeat(43)}&state=${'y'.repeat(32)}`);
  await waitFor(hasText('not started from this app'), 'the unsolicited-callback refusal');
  check('an unsolicited callback is refused', await evaluate(hasText('Sign in with a passkey')));

  await clickButton('Sign in with a passkey');
  await waitFor(hasText('Continue in your browser'), 'the waiting screen');
  await shot('p2-waiting');
  for (let i = 0; i < 50 && !existsSync(externalLog); i++) await sleep(100);
  const opened = existsSync(externalLog) ? readFileSync(externalLog, 'utf8').trim().split('\n').pop() : '';
  const url = new URL(opened);
  const challenge = url.searchParams.get('challenge') ?? '';
  const state = url.searchParams.get('state') ?? '';
  check('it opens the server\'s passkey page with a PKCE challenge and a state', url.origin === new URL(server).origin && url.pathname === '/desktop/passkey' && /^[A-Za-z0-9_-]{43}$/.test(challenge) && state.length >= 16, url.pathname);

  const proved = await proveInBrowser(challenge);
  const code = proved.json?.data?.code;
  check('the browser proves the passkey and gets a one-time code, not a session', proved.status === 200 && typeof code === 'string' && !proved.json?.data?.tokens, String(proved.status));

  // A code carried to the app with the wrong state is not used.
  deliver(`worksuite://auth/callback?code=${code}&state=${'z'.repeat(32)}`);
  await sleep(1500);
  check('a callback with another state does not finish the sign-in', await evaluate(hasText('Continue in your browser')));

  const link = `worksuite://auth/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`;
  deliver(link);
  await waitFor(`${hasText('Set up WorkSuite')} || ${hasText('Good ')}`, 'the setup wizard or the shell', 40_000);
  check('the callback signs the app in, registers the device and loads the workspace', true);
  if (await evaluate(hasText('Set up WorkSuite'))) {
    for (let i = 0; i < 6 && (await evaluate(hasText('Continue'))); i++) {
      await clickButton('Continue');
      await sleep(200);
    }
    await clickButton('Open WorkSuite');
  }
  await waitFor(hasText('Good '), 'the home dashboard', 30_000);
  await sleep(2000);
  await shot('p3-signed-in');
  const who = await evaluate(`window.worksuite.auth.state().then(s => s.user && s.user.id)`);
  check('signed in as the passkey\'s owner', String(who) === String(userId), `user ${who}`);

  // Replaying the same link finishes nothing.
  deliver(link);
  await waitFor(hasText('not started from this app'), 'the replay refusal');
  check('replaying the callback is refused', true);

  // ── the title-bar clock ──────────────────────────────────────────────
  await waitFor(`!![...document.querySelectorAll('header button')].find(b => /^Clock in/.test(b.getAttribute('aria-label') ?? ''))`, 'the clock-in button in the title bar', 20_000);
  await shot('p4-clock-in');
  check('the title bar offers Clock in to a person linked to an employee', true);
  await clickButtonStarting('Clock in');
  await waitFor(`!![...document.querySelectorAll('header button')].find(b => (b.getAttribute('aria-label') ?? '').startsWith('Clocked in for'))`, 'the running clock', 20_000);
  await sleep(600);
  await shot('p5-clocked-in');
  check('one click clocks in, and the title bar shows the time running', true);
  const hr = await evaluate(`fetch('app://bundle/__api/api/hr/attendance/me').then(r => r.json()).then(j => !!(j.data.today && j.data.today.check_in && !j.data.today.check_out))`);
  check('the server has the check-in', hr === true);

  await clickButtonStarting('Clocked in for');
  await waitFor(`!!document.querySelector('[role="dialog"][aria-label="Attendance"]')`, 'the attendance popover');
  await shot('p6-clock-popover');
  check('clocking out asks first, in a popover', await evaluate(`!![...document.querySelectorAll('[role="dialog"] button')].find(b => b.textContent.trim() === 'Clock out')`));
  await evaluate(`[...document.querySelectorAll('[role="dialog"] button')].find(b => b.textContent.trim() === 'Clock out').click()`);
  await waitFor(`!![...document.querySelectorAll('header button')].find(b => b.textContent.includes('Clock in again'))`, 'clocked out', 20_000);
  await shot('p7-clocked-out');
  check('clocking out from the popover ends the day, and the title bar offers Clock in again', true);

  await evaluate(`window.worksuite.auth.signOut({ wipe: true })`);
  await waitFor(hasText('Sign in with a passkey'), 'the sign-in screen after sign-out');
  check('sign out returns to sign-in', true);
} catch (e) {
  check('passkey run', false, e.message);
  try {
    await shot('pz-failure');
  } catch {
    /* no page */
  }
} finally {
  const relevant = consoleErrors.filter((e) => !/Autofill|DevTools|favicon/i.test(e));
  check('no renderer errors', relevant.length === 0, relevant.slice(0, 3).join(' | '));
  child.kill();
  await sleep(500);
  rmSync(profile, { recursive: true, force: true });
  if (failures) console.log(mainLog.join('').slice(-3000));
  console.log(`\n${failures ? `${failures} failed` : 'all passed'} — screenshots in ${outDir}`);
  process.exit(failures ? 1 : 0);
}

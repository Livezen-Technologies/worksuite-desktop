// Shared by the end-to-end scripts: launch the built app with a throwaway
// profile, drive its window over the Chrome DevTools Protocol, record checks
// and screenshots. Runs under Electron's own Node (global fetch and WebSocket).
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Pick an option in one of the app's dropdowns (components/Select): open the
 * button `el` evaluates to, then click the option with that value in the
 * floating list. Page code, for t.evaluate; answers whether it was found.
 */
export const chooseIn = (el, value) =>
  `(async () => { const b = ${el}; if (!b) return false; if (b.getAttribute('aria-expanded') !== 'true') b.click(); for (let i = 0; i < 120; i++) { await new Promise((r) => setTimeout(r, 25)); const o = document.querySelector('[role="listbox"] [role="option"][data-value=' + JSON.stringify(${JSON.stringify(String(value))}) + ']'); if (o) { o.click(); return true; } } return false; })()`;
export const choose = (selector, value) => chooseIn(`document.querySelector(${JSON.stringify(selector)})`, value);

export async function launch({ name, env: extra = {}, args = [] }) {
  const outDir = process.env.WS_E2E_OUT ?? join(root, 'test-results', `e2e-${name}`);
  mkdirSync(outDir, { recursive: true });
  const profile = mkdtempSync(join(tmpdir(), `ws-e2e-${name}-`));
  const port = 9300 + Math.floor(Math.random() * 500);
  const env = { ...process.env, WS_USER_DATA_DIR: profile, ...extra };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_RENDERER_URL;
  const child = spawn(process.execPath, [root, `--remote-debugging-port=${port}`, ...args], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  const mainLog = [];
  child.stdout.on('data', (d) => mainLog.push(String(d)));
  child.stderr.on('data', (d) => mainLog.push(String(d)));

  let failures = 0;
  const check = (label, ok, detail = '') => {
    if (!ok) failures++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  };
  /** Something this environment cannot prove: said, and neither passed nor failed. */
  const skip = (label, why) => console.log(`SKIP  ${label} — ${why}`);

  let page = null;
  for (let i = 0; i < 100 && !page; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      page = list.find((t) => t.type === 'page' && t.url.startsWith('app://bundle')) ?? null;
    } catch {
      /* not up yet */
    }
    if (!page) await sleep(200);
  }
  if (!page) throw new Error('the app window never appeared');

  const consoleErrors = [];
  const main = await connect(page, outDir, consoleErrors);
  const { evaluate, waitFor, shot, hasText, clickButton, fill } = main;

  /** Another app window (a call, a ring, a pop-out), once it has opened. */
  const attach = async (match, label, timeout = 20_000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json().catch(() => []);
      const target = list.find((t) => t.type === 'page' && t.url.startsWith('app://bundle') && match(decodeURIComponent(t.url)));
      if (target) return connect(target, outDir, consoleErrors);
      await sleep(200);
    }
    throw new Error(`timed out waiting for ${label}`);
  };
  /** Whether a window whose address matches is open. */
  const windowOpen = async (match) => {
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json().catch(() => []);
    return list.some((t) => t.type === 'page' && match(decodeURIComponent(t.url)));
  };

  /** Server, password sign-in and setup, to the home dashboard. */
  const signIn = async (server, email, password) => {
    await waitFor(hasText('Connect to WorkSuite'), 'the server screen');
    await fill('Server address', server);
    // Choosing a server reloads the window once (its CSP names the server):
    // wait for that reload, not a guessed delay, or the fields are typed into
    // the page that is about to go.
    await evaluate(`(window.__e2eBeforeReload = true)`);
    await clickButton('Continue');
    await waitFor(`!window.__e2eBeforeReload && ${hasText('Forgot your password?')}`, 'the sign-in screen, after the reload', 30_000);
    await fill('Email', email);
    await fill('Password', password);
    await evaluate(`document.querySelector('form').requestSubmit()`);
    await waitFor(`${hasText('Set up WorkSuite')} || ${hasText('Good ')}`, 'the setup wizard or the shell', 40_000);
    if (await evaluate(hasText('Set up WorkSuite'))) {
      for (let i = 0; i < 6 && (await evaluate(hasText('Continue'))); i++) {
        await clickButton('Continue');
        await sleep(200);
      }
      await clickButton('Open WorkSuite');
    }
    await waitFor(hasText('Good '), 'the home dashboard', 30_000);
    // The test machine's screen may lock while a run is going; the app would
    // lock with it (and a locked app rightly never rings). Tests are about the
    // app, not the screen saver.
    await evaluate(`window.worksuite.settings.set({ lockOnSystemLock: false, appLockMinutes: 0 })`).catch(() => undefined);
  };

  const finish = async () => {
    const relevant = consoleErrors.filter((e) => !/Autofill|DevTools|favicon/i.test(e));
    check('no renderer errors', relevant.length === 0, relevant.slice(0, 3).join(' | '));
    child.kill();
    await sleep(500);
    rmSync(profile, { recursive: true, force: true });
    if (failures) console.log(mainLog.join('').slice(-3000));
    console.log(`\n${failures ? `${failures} failed` : 'all passed'} — screenshots in ${outDir}`);
    process.exit(failures ? 1 : 0);
  };

  /** A real mouse drag (DevTools input, so the page can capture the pointer) from one point to another, in steps. */
  const drag = async (x0, y0, x1, y1, steps = 8) => {
    await main.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x0, y: y0 });
    await main.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x0, y: y0, button: 'left', buttons: 1, clickCount: 1 });
    for (let i = 1; i <= steps; i++) {
      await main.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x0 + ((x1 - x0) * i) / steps, y: y0 + ((y1 - y0) * i) / steps, button: 'left', buttons: 1 });
      await sleep(30);
    }
    await main.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x1, y: y1, button: 'left', buttons: 0, clickCount: 1 });
  };
  return { evaluate, waitFor, shot, hasText, clickButton, fill, check, skip, signIn, finish, attach, windowOpen, profile, outDir, send: main.send, drag };
}

/** Drive one page over CDP: evaluate, wait, screenshot, click, fill. */
async function connect(target, outDir, consoleErrors) {
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => {
    ws.onopen = r;
    ws.onerror = j;
  });
  let seq = 0;
  const pending = new Map();
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
  // A window that closes (or a call that never answers) fails the step
  // rather than hanging the run.
  ws.onclose = () => {
    for (const p of pending.values()) p.reject(new Error('the window closed'));
    pending.clear();
  };
  const send = (method, params = {}) => {
    const id = ++seq;
    if (ws.readyState !== WebSocket.OPEN) return Promise.reject(new Error('the window closed'));
    ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, 30_000);
      pending.set(id, { resolve: (v) => (clearTimeout(timer), resolve(v)), reject: (e) => (clearTimeout(timer), reject(e)) });
    });
  };
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  };
  const waitFor = async (expression, label, timeout = 20_000) => {
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
  };
  const shot = async (file) => {
    await sleep(350);
    const r = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(outDir, `${file}.png`), Buffer.from(r.data, 'base64'));
  };
  const hasText = (t) => `document.body.innerText.includes(${JSON.stringify(t)})`;
  const clickButton = (label) =>
    evaluate(`(() => { const b = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(label)} || b.getAttribute('aria-label') === ${JSON.stringify(label)}); if (!b) return false; b.click(); return true; })()`);
  const fill = (labelText, value) =>
    evaluate(`(() => {
      const l = [...document.querySelectorAll('label')].find(l => l.textContent.trim().startsWith(${JSON.stringify(labelText)}));
      const el = (l && l.querySelector('input,textarea')) || document.querySelector(${JSON.stringify(`[aria-label="${labelText}"]`)});
      if (!el) return false;
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set;
      setter.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
  await send('Runtime.enable');
  await send('Page.enable');
  return { send, evaluate, waitFor, shot, hasText, clickButton, fill, close: () => ws.close() };
}

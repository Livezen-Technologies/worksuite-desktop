// End-to-end: multi-window docking against a real WorkSuite — a tab docked
// beside another, the divider dragged, the panes swapped and undocked; a tab
// moved to its own window and docked back, as a tab and beside; a
// torn-off window closed by hand is forgotten.
//
// Dragging a tab out of the window, and a window's handle back onto the
// main one, are drags the operating system carries between windows, which
// DevTools input cannot make: the unit tests cover what the app does with
// them (tests/unit/renderer/docking-ui.test.tsx).
//
//   npm run build
//   WS_E2E_SERVER=http://localhost:8920 WS_E2E_EMAIL=… WS_E2E_PASSWORD=… \
//   ELECTRON_RUN_AS_NODE=1 npx electron tests/e2e/docking.mjs
import { launch, sleep } from './harness.mjs';

const server = process.env.WS_E2E_SERVER;
const email = process.env.WS_E2E_EMAIL;
const password = process.env.WS_E2E_PASSWORD;
if (!server || !email || !password) {
  console.error('Set WS_E2E_SERVER, WS_E2E_EMAIL and WS_E2E_PASSWORD.');
  process.exit(2);
}

const t = await launch({ name: 'docking' });
const tabTitles = () => t.evaluate(`[...document.querySelectorAll('[role="tab"]')].map((e) => e.getAttribute('title') ?? '')`);
const shownPanes = () => t.evaluate(`[...document.querySelectorAll('[role="tabpanel"]')].filter((e) => !e.hidden).length`);
/** Opens a tab's menu and picks an item in it. */
const tabMenu = (title, item) =>
  t.evaluate(`(async () => {
    const tab = [...document.querySelectorAll('[role="tab"]')].find((e) => (e.getAttribute('title') ?? '').startsWith(${JSON.stringify(title)}));
    if (!tab) return 'no tab';
    const r = tab.getBoundingClientRect();
    tab.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: r.x + 12, clientY: r.y + 12 }));
    await new Promise((res) => setTimeout(res, 150));
    const m = [...document.querySelectorAll('[role="menuitem"]')].find((b) => b.textContent.trim() === ${JSON.stringify(item)});
    if (!m) return 'no item';
    m.click();
    return 'ok';
  })()`);
const isRecord = (u) => u.includes('/window/record') && u.includes('/settings');

try {
  await t.signIn(server, email, password);
  await t.clickButton('Settings');
  await t.waitFor(`[...document.querySelectorAll('[role="tab"]')].some((e) => (e.getAttribute('title') ?? '').startsWith('Settings'))`, 'the Settings tab');

  // ── docked beside ─────────────────────────────────────────────────────
  t.check('Dock beside is in the tab menu', (await tabMenu('Home', 'Dock beside')) === 'ok');
  await t.waitFor(`!!document.querySelector('[role="separator"][aria-label="Resize the docked tab"]')`, 'the divider');
  t.check('two tabs side by side', (await shownPanes()) === 2);
  t.check('the docked tab is marked in the strip', (await tabTitles()).some((x) => x === 'Home — docked beside'));
  await t.shot('dk1-beside');

  const at = await t.evaluate(`(() => { const r = document.querySelector('[role="separator"]').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  await t.drag(at.x, at.y, at.x - 160, at.y);
  await sleep(200);
  const now = Number(await t.evaluate(`document.querySelector('[role="separator"]').getAttribute('aria-valuenow')`));
  t.check('dragging the divider gives the docked tab more room', now < 50 && now >= 25, `now ${now}%`);

  await t.clickButton('Swap sides');
  await sleep(150);
  t.check('Swap sides puts Settings beside', (await tabTitles()).some((x) => x.startsWith('Settings — docked beside')));
  await t.shot('dk2-swapped');
  await t.clickButton('Undock');
  await sleep(150);
  t.check('Undock leaves one pane', (await shownPanes()) === 1 && !(await t.evaluate(`!!document.querySelector('[role="separator"]')`)));

  // ── its own window, and back ──────────────────────────────────────────
  t.check('Move to new window is in the tab menu', (await tabMenu('Settings', 'Move to new window')) === 'ok');
  let w = await t.attach(isRecord, 'the torn-off Settings window');
  await w.waitFor(`!!document.querySelector('button[aria-label="Dock to main window"]')`, 'the dock button');
  t.check('the tab left the strip', !(await tabTitles()).some((x) => x.startsWith('Settings')));
  await w.shot('dk3-window');

  await w.evaluate(`document.querySelector('button[aria-label="Dock to main window"]').click()`);
  await t.waitFor(`[...document.querySelectorAll('[role="tab"]')].some((e) => (e.getAttribute('title') ?? '').startsWith('Settings'))`, 'Settings back as a tab');
  await sleep(500);
  t.check('the window closed when it docked', !(await t.windowOpen(isRecord)));
  await t.shot('dk4-docked-back');

  t.check('moved to a window again', (await tabMenu('Settings', 'Move to new window')) === 'ok');
  w = await t.attach(isRecord, 'the torn-off Settings window, again');
  await w.waitFor(`!!document.querySelector('button[aria-label="Dock beside the main window\\'s tab"]')`, 'the dock-beside button');
  await w.evaluate(`document.querySelector('button[aria-label="Dock beside the main window\\'s tab"]').click()`);
  await t.waitFor(`!!document.querySelector('[role="separator"]')`, 'Settings docked beside');
  t.check('docked from its window, it sits beside the open tab', (await tabTitles()).some((x) => x.startsWith('Settings — docked beside')));
  await t.shot('dk5-docked-beside');

  // ── closed for good ────────────────────────────────────────────────────
  await t.clickButton('Move to new window');
  w = await t.attach(isRecord, 'the torn-off window from the docked bar');
  t.check('the docked bar moves it to a window', !(await t.evaluate(`!!document.querySelector('[role="separator"]')`)));
  await w.evaluate(`window.worksuite.windows.close()`).catch(() => undefined);
  await sleep(1200);
  const restored = await t.evaluate(`window.worksuite.windows.restoreDetached()`);
  t.check('a torn-off window closed by hand does not come back', restored === 0 && !(await t.windowOpen(isRecord)), `restored ${restored}`);
  t.skip('dragging a tab out, and a window back in', 'an operating-system drag between windows; see the unit tests');
} catch (e) {
  t.check('docking run', false, e.message);
  try {
    await t.shot('dk-failure');
  } catch {
    /* no page */
  }
} finally {
  await t.finish();
}

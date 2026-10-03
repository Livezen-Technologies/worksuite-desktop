// End-to-end: the shell's own surfaces, to the App Launcher, Global Search and
// ClockIn designs — the launcher's categories, filter, keyboard and Recent row;
// search idle (jump to, create), results grouped with filters and a preview,
// and commands after ">"; and a whole working day from the title-bar clock:
// clock in at a work location, a break, back, and a confirmed clock-out with
// the kind of day, each checked against the server.
//
// The signed-in person must be linked to an employee with no attendance yet
// today (the run script clears it on the local server).
//
//   npm run build
//   WS_E2E_SERVER=http://localhost:8920 WS_E2E_EMAIL=… WS_E2E_PASSWORD=… \
//   ELECTRON_RUN_AS_NODE=1 npx electron tests/e2e/shell.mjs
import { launch, sleep } from './harness.mjs';

const server = process.env.WS_E2E_SERVER;
const email = process.env.WS_E2E_EMAIL;
const password = process.env.WS_E2E_PASSWORD;
if (!server || !email || !password) {
  console.error('Set WS_E2E_SERVER, WS_E2E_EMAIL and WS_E2E_PASSWORD.');
  process.exit(2);
}

let token = '';
async function api(method, path, body) {
  const res = await fetch(`${server}${path}`, {
    method,
    headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}), Authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, data: json.data ?? json };
}
const js = (v) => JSON.stringify(v);
const key = (k, target = '[aria-label="Find an app"]') => `document.querySelector(${js(target)}).dispatchEvent(new KeyboardEvent('keydown', { key: ${js(k)}, bubbles: true, cancelable: true }))`;
const dialog = (label) => `document.querySelector(${js(`[role="dialog"][aria-label="${label}"]`)})`;
const pill = `document.querySelector('header [data-clock-pill]')`;
const inDialog = (label, text) => `(${dialog(label)}?.innerText ?? '').includes(${js(text)})`;
const clickIn = (label, text) => `(() => { const b = [...${dialog(label)}.querySelectorAll('button')].find(b => b.textContent.trim() === ${js(text)} || b.getAttribute('aria-label') === ${js(text)}); if (!b) return false; b.click(); return true; })()`;

const t = await launch({ name: 'shell' });
try {
  await t.signIn(server, email, password);
  const login = await fetch(`${server}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ email, password }) }).then((r) => r.json());
  token = login.data?.tokens?.access_token ?? '';

  // ── the app launcher ───────────────────────────────────────────────────
  await t.evaluate(`[...document.querySelectorAll('nav[aria-label="Apps"] button')].find(b => b.textContent.trim().startsWith('More apps')).click()`);
  await t.waitFor(`!!${dialog('Apps')}`, 'the launcher');
  await sleep(300);
  await t.shot('l1-launcher');
  const cats = await t.evaluate(`[...${dialog('Apps')}.querySelectorAll('[role="tab"]')].map(b => b.textContent.trim())`);
  const tiles = await t.evaluate(`${dialog('Apps')}.querySelectorAll('[role="option"]').length`);
  t.check('the launcher shows every app as a tile, with categories and their counts', tiles >= 6 && cats[0]?.startsWith('All apps') && cats.some((c) => c.startsWith('Communication')), JSON.stringify({ tiles, cats }));
  const web = await t.evaluate(`[...${dialog('Apps')}.querySelectorAll('[role="option"]')].some(b => !!b.querySelector('[title="Opens in your browser"]'))`);
  t.check('apps without a desktop screen carry the browser mark, and no tile says "Desktop app"', web && !(await t.evaluate(`${dialog('Apps')}.innerText.includes('Desktop app')`)));
  const box = await t.evaluate(`(() => { const r = ${dialog('Apps')}.getBoundingClientRect(); return { w: r.width, h: r.height, b: r.bottom, vw: innerWidth, vh: innerHeight }; })()`);
  t.check('the launcher is a popover of at most 760×600, inside the window', box.w <= 760 && box.h <= 600 && box.w <= box.vw * 0.9 + 1 && box.b <= box.vh, JSON.stringify(box));

  await t.evaluate(`[...${dialog('Apps')}.querySelectorAll('[role="tab"]')].find(b => b.textContent.trim().startsWith('Communication')).click()`);
  await sleep(150);
  const comms = await t.evaluate(`[...${dialog('Apps')}.querySelectorAll('[role="option"]')].map(b => b.querySelector('span.truncate')?.textContent)`);
  t.check('a category shows only its apps', comms.includes('Chat') && !comms.includes('Tasks'), JSON.stringify(comms));

  await t.fill('Find an app', 'cont');
  await sleep(150);
  const found = await t.evaluate(`[...${dialog('Apps')}.querySelectorAll('[role="option"]')].map(b => b.querySelector('span.truncate')?.textContent)`);
  t.check('typing finds the app, across categories', found.length === 1 && found[0] === 'Contacts', JSON.stringify(found));
  await t.evaluate(`document.querySelector('[aria-label="Find an app"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`);
  await t.waitFor(`!${dialog('Apps')} && [...document.querySelectorAll('[role="tablist"][aria-label="Open tabs"] [role="tab"][aria-selected="true"]')].some(b => b.textContent.includes('Contacts'))`, 'Contacts, opened with Enter');
  t.check('Enter opens the app', true);

  await t.evaluate(`[...document.querySelectorAll('nav[aria-label="Apps"] button')].find(b => b.textContent.trim().startsWith('More apps')).click()`);
  await t.waitFor(`!!${dialog('Apps')}`, 'the launcher again');
  const recent = await t.evaluate(`(() => { const d = ${dialog('Apps')}; const h = [...d.querySelectorAll('span')].find(s => s.textContent.trim() === 'Recent'); return h ? h.parentElement.innerText : ''; })()`);
  t.check('what was opened lately comes back under Recent', recent.includes('Contacts'), recent);
  await t.evaluate(`document.querySelector('[aria-label="Find an app"]').focus()`);
  const before = await t.evaluate(`[...${dialog('Apps')}.querySelectorAll('[role="option"]')].findIndex(b => b.getAttribute('aria-selected') === 'true')`);
  await t.evaluate(key('ArrowRight'));
  await t.evaluate(key('ArrowDown'));
  const after = await t.evaluate(`[...${dialog('Apps')}.querySelectorAll('[role="option"]')].findIndex(b => b.getAttribute('aria-selected') === 'true')`);
  const perRow = await t.evaluate(`(() => { const o = [...${dialog('Apps')}.querySelectorAll('[role="option"]')]; const top = o[0].getBoundingClientRect().top; return o.filter(b => b.getBoundingClientRect().top === top).length; })()`);
  t.check('the arrow keys move over the grid, a row at a time', before === 0 && after === 1 + perRow, JSON.stringify({ before, after, perRow }));
  await t.evaluate(`[...${dialog('Apps')}.querySelectorAll('[role="option"]')][0].dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 400, clientY: 300 }))`);
  await t.waitFor(`!!document.querySelector('[role="menu"][aria-label$="options"]')`, 'the tile menu');
  await t.shot('l2-launcher-menu');
  t.check('a tile\'s menu opens it in a new tab or window, pins, hides or groups it', await t.evaluate(`(() => { const m = document.querySelector('[role="menu"][aria-label$="options"]').innerText; return m.includes('Open in a new tab') && m.includes('Open in new window') && m.includes('Pin') && m.includes('Hide') && m.toLowerCase().includes('move to group'); })()`));
  await t.evaluate(key('Escape'));
  await t.evaluate(key('Escape'));
  await t.waitFor(`!${dialog('Apps')}`, 'the launcher closed');

  // ── global search ──────────────────────────────────────────────────────
  await t.evaluate(`[...document.querySelectorAll('header button')].find(b => b.textContent.includes('Search people')).click()`);
  await t.waitFor(`!!${dialog('Search')}`, 'the search');
  await sleep(250);
  await t.shot('s1-search-idle');
  t.check('search opens on Jump to and Create', await t.evaluate(`${inDialog('Search', 'JUMP TO')} || ${inDialog('Search', 'Jump to')}`) && (await t.evaluate(`${inDialog('Search', 'New task')}`)));

  // Something that is certainly there: a chat group of the e2e runs, or the person themself.
  const term = 'E2E';
  await t.fill('Search WorkSuite', term);
  await t.waitFor(`${dialog('Search')}.querySelectorAll('[role="option"]').length > 0`, 'results', 20_000);
  await sleep(400);
  await t.shot('s2-search-results');
  const groups = await t.evaluate(`[...${dialog('Search')}.querySelectorAll('[role="tab"]')].map(b => b.textContent.trim())`);
  const marked = await t.evaluate(`!!${dialog('Search')}.querySelector('mark')`);
  const preview = await t.evaluate(`!!${dialog('Search')}.querySelector('aside[aria-label="Preview"]') && [...${dialog('Search')}.querySelectorAll('aside[aria-label="Preview"] button')].some(b => b.textContent.startsWith('Open'))`);
  t.check('results come grouped, with a filter per group, the match marked, and a preview', groups[0]?.startsWith('All') && groups.length >= 2 && marked && preview, JSON.stringify(groups));
  await t.evaluate(`document.querySelector('[aria-label="Search WorkSuite"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))`);
  await sleep(150);
  const scoped = await t.evaluate(`(() => { const on = ${dialog('Search')}.querySelector('[role="tab"][aria-selected="true"]'); const chip = [...${dialog('Search')}.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === 'Remove filter'); return { on: on && on.textContent.trim(), chip: chip && chip.textContent.trim() }; })()`);
  await t.shot('s3-search-filtered');
  t.check('Tab filters by the next group, and says so in the box', !!scoped.on && !scoped.on.startsWith('All') && !!scoped.chip && scoped.chip.startsWith('in '), JSON.stringify(scoped));

  await t.fill('Search WorkSuite', '>new task');
  await t.waitFor(`${inDialog('Command palette', 'Commands')} && [...${dialog('Command palette')}.querySelectorAll('[role="option"]')].some(b => b.textContent.includes('New task'))`, 'the command');
  await t.shot('s4-search-commands');
  await t.evaluate(`document.querySelector('[aria-label="Search WorkSuite"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))`);
  await t.waitFor(`!${dialog('Command palette')} && [...document.querySelectorAll('[role="tablist"][aria-label="Open tabs"] [role="tab"][aria-selected="true"]')].some(b => b.textContent.includes('Tasks'))`, 'New task, run from search', 20_000);
  t.check('">" turns the box into commands, and Enter runs one', true);
  await sleep(600);
  await t.evaluate(`document.activeElement && document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);

  // ── the title-bar clock ────────────────────────────────────────────────
  await t.waitFor(`!!${pill}`, 'the clock in the title bar', 20_000);
  const start = await t.evaluate(`${pill}.getAttribute('aria-label')`);
  t.check('the title bar offers Clock In to a person with no attendance today', start === 'Clock in', start);
  await t.evaluate(`${pill}.click()`);
  await t.waitFor(`!!${dialog("Today's attendance")}`, 'the attendance popover');
  const places = await t.evaluate(`[...${dialog("Today's attendance")}.querySelectorAll('[role="radio"]')].map(b => b.textContent.trim())`);
  await t.shot('h1-before-clock-in');
  t.check('clocking in asks where you are working, from the company\'s list', places.length >= 2 && (await t.evaluate(inDialog("Today's attendance", 'Not clocked in'))), JSON.stringify(places));
  const place = places.includes('Remote') ? 'Remote' : places[1];
  await t.evaluate(clickIn("Today's attendance", place));
  await t.evaluate(clickIn("Today's attendance", 'Clock In'));
  await t.waitFor(`(${pill}.getAttribute('aria-label') ?? '').startsWith('Working')`, 'working', 20_000);
  await t.waitFor(`${inDialog("Today's attendance", 'Working time')}`, 'the working day in the popover', 20_000);
  await t.shot('h2-working');
  let me = (await api('GET', '/api/hr/attendance/me')).data;
  t.check('clocking in records the place, and the title bar runs the time', me.today?.check_in && me.today?.work_location === place, JSON.stringify({ in: me.today?.check_in, where: me.today?.work_location }));

  await t.evaluate(clickIn("Today's attendance", 'Break'));
  await t.waitFor(`(${pill}.getAttribute('aria-label') ?? '').startsWith('On break')`, 'on a break', 20_000);
  await t.waitFor(`${inDialog("Today's attendance", 'Resume')}`, 'Resume', 20_000);
  await t.shot('h3-on-break');
  t.check('a break starts from the popover and the title bar says so', (await t.evaluate(`${pill}.textContent`)).includes('On break'));
  await sleep(1200);
  await t.evaluate(clickIn("Today's attendance", 'Resume'));
  await t.waitFor(`(${pill}.getAttribute('aria-label') ?? '').startsWith('Working')`, 'back at work', 20_000);
  me = (await api('GET', '/api/hr/attendance/me')).data;
  t.check('Resume ends the break on the record', (me.today?.breaks ?? []).length >= 1 && me.today.breaks.every((b) => b.ended_at), JSON.stringify(me.today?.breaks));

  await t.waitFor(`${inDialog("Today's attendance", 'Clock Out')}`, 'Clock Out', 20_000);
  await t.evaluate(clickIn("Today's attendance", 'Clock Out'));
  await t.waitFor(`${inDialog("Today's attendance", 'What kind of day was it?')}`, 'the clock-out step');
  const guarded = await t.evaluate(`[...${dialog("Today's attendance")}.querySelectorAll('button')].filter(b => b.textContent.trim() === 'Clock Out').every(b => b.disabled)`);
  t.check('clocking out waits for the confirmation', guarded);
  await t.evaluate(clickIn("Today's attendance", 'Office work'));
  await t.evaluate(`(() => { const el = ${dialog("Today's attendance")}.querySelector('textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, 'E2E: shell suite'); el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await t.evaluate(`${dialog("Today's attendance")}.querySelector('input[type="checkbox"]').click()`);
  await t.shot('h4-clocking-out');
  await t.evaluate(`[...${dialog("Today's attendance")}.querySelectorAll('button')].find(b => b.textContent.trim() === 'Clock Out' && !b.disabled).click()`);
  await t.waitFor(`(${pill}.getAttribute('aria-label') ?? '').startsWith('Clocked out')`, 'clocked out', 20_000);
  await t.waitFor(`${inDialog("Today's attendance", 'have a good evening')}`, 'the finished day', 20_000);
  await t.shot('h5-done');
  me = (await api('GET', '/api/hr/attendance/me')).data;
  t.check('the confirmed clock-out ends the day with its kind and note', !!me.today?.check_out && me.today?.note_type === 'normal' && me.today?.check_out_note === 'E2E: shell suite', JSON.stringify({ out: me.today?.check_out, type: me.today?.note_type, note: me.today?.check_out_note }));
  t.check('the finished day shows the total in the title bar', /\dh \d\dm/.test(await t.evaluate(`${pill}.textContent`)));
} catch (e) {
  t.check(`no unexpected error (${e.message})`, false);
  await t.shot('hz-failure').catch(() => undefined);
} finally {
  await t.finish();
}

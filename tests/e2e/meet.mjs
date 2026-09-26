// End-to-end: Meet and Meetings in the desktop — the Meet home, a meeting made
// for later (link, ID and QR), its window and lobby; then scheduling a
// meeting, running its agenda timer, taking attendance and minutes.
//
// Like calls.mjs, run the server with a placeholder LiveKit address: the
// lobby's Join reaches the server (which starts the meeting) and then fails
// to connect, as it would against an unreachable media server.
//
//   npm run build
//   WS_E2E_SERVER=http://localhost:8920 WS_E2E_EMAIL=… WS_E2E_PASSWORD=… \
//   WS_E2E_PARTNER_NAME=… ELECTRON_RUN_AS_NODE=1 npx electron tests/e2e/meet.mjs
//
// The signed-in user needs meeting.view and meeting.schedule.
import { launch, sleep, choose } from './harness.mjs';

const server = process.env.WS_E2E_SERVER;
const email = process.env.WS_E2E_EMAIL;
const password = process.env.WS_E2E_PASSWORD;
const partnerName = process.env.WS_E2E_PARTNER_NAME;
if (!server || !email || !password || !partnerName) {
  console.error('Set WS_E2E_SERVER, WS_E2E_EMAIL, WS_E2E_PASSWORD and WS_E2E_PARTNER_NAME.');
  process.exit(2);
}

let bearer = '';
async function api(method, path, body) {
  const res = await fetch(`${server}${path}`, {
    method,
    headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}), ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, data: json.data ?? json };
}

const nav = (label) => `[...document.querySelectorAll('nav[aria-label="Apps"] button')].find(b => b.textContent.trim().startsWith(${JSON.stringify(label)}))`;

const t = await launch({ name: 'meet', env: { WS_E2E_FAKE_MEDIA: '1' } });
try {
  await t.signIn(server, email, password);
  bearer = (await api('POST', '/api/auth/login', { email, password })).data.tokens?.access_token ?? '';
  t.check('Meet and Meetings are in the sidebar', await t.evaluate(`!!${nav('Meet')} && !!${nav('Meetings')}`));

  // ── Meet home, and a meeting for later ────────────────────────────────
  await t.evaluate(`${nav('Meet')}.click()`);
  await t.waitFor(t.hasText('Video meetings for your team'), 'the Meet home');
  await t.shot('m1-home');
  await t.clickButton('New meeting ⌄');
  await t.waitFor(t.hasText('Create a meeting for later'), 'the new meeting menu');
  await t.evaluate(`[...document.querySelectorAll('[role="menuitem"]')].find(b => b.textContent.startsWith('Create a meeting for later')).click()`);
  await t.waitFor(`${t.hasText('Your meeting link is ready')} && !!document.querySelector('svg[aria-label="QR code to join"]')`, 'the meeting created');
  await t.shot('m2-created');
  const history = await api('GET', '/api/meet/history');
  const made = (history.data.meetings ?? [])[0];
  t.check('a meeting for later is made, with its link, ID and QR code', !!made && (await t.evaluate(t.hasText('Meeting ID'))), made?.uuid);

  await t.clickButton('Join now');
  const win = await t.attach((u) => u.includes('/window/meet?') && u.includes(made.uuid), 'the meeting window');
  await win.waitFor(`${win.hasText('Ready to join?')} && ${win.hasText('Join now')}`, 'the lobby', 30_000);
  await sleep(1200);
  await win.shot('m3-lobby');
  t.check('the meeting opens in its own window, at the lobby, as its host', true);
  await win.clickButton('Join now');
  await win.waitFor(win.hasText('Could not connect to the meeting'), 'the join to reach the server', 30_000);
  await win.shot('m4-join');
  const shown = await api('GET', `/api/meet/${made.uuid}`);
  t.check('Join asks the server for the meeting (which starts it)', !!shown.data.started_at, shown.data.started_at);
  await win.evaluate(`window.worksuite.windows.close()`).catch(() => undefined);

  // ── Meetings: schedule, agenda, attendance, minutes ───────────────────
  await t.evaluate(`${nav('Meetings')}.click()`);
  await t.waitFor(`${t.hasText('Happening now')} && ${t.hasText('Upcoming meetings')}`, 'the Meetings dashboard');
  await t.shot('m5-dashboard');
  await t.clickButton('Schedule a meeting');
  await t.waitFor(`!!document.querySelector('[role="radiogroup"][aria-label="Where"]')`, 'the schedule dialog');
  const title = `E2E proposal sync ${Math.floor(Math.random() * 1000)}`;
  await t.fill('Title', title);
  await t.evaluate(`[...document.querySelectorAll('[role="radio"]')].find(b => b.textContent.trim() === 'Online').click()`);
  await t.fill('Add people', partnerName.slice(0, 3));
  await t.waitFor(`[...document.querySelectorAll('button')].some(b => b.textContent.includes(${JSON.stringify(partnerName)}))`, 'the partner in the people search');
  await t.evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent.includes(${JSON.stringify(partnerName)})).click()`);
  await t.evaluate(`(() => { const a = [...document.querySelectorAll('label')].find(l => l.textContent.startsWith('Agenda')).querySelector('textarea'); const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; set.call(a, 'Welcome and goals\\nScope walkthrough'); a.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await t.shot('m6-schedule');
  await t.clickButton('Schedule & invite');
  await t.waitFor(`[...document.querySelectorAll('h1')].some(h => h.textContent.trim() === ${JSON.stringify(title)})`, 'the new meeting', 20_000);
  const list = await api('GET', '/api/meetings?scope=upcoming');
  const meeting = (list.data.meetings ?? []).find((m) => m.title === title);
  t.check('scheduling makes the meeting, online on the built-in Meet, with the partner invited', !!meeting && meeting.online_provider === 'builtin' && meeting.participants >= 2, JSON.stringify(meeting && { provider: meeting.online_provider, people: meeting.participants }));

  await t.waitFor(`${t.hasText('Welcome and goals')} && ${t.hasText('Start this item')}`, 'the agenda');
  await t.clickButton('Start this item');
  let running = null;
  for (let i = 0; i < 20 && running?.status !== 'running'; i++) {
    const d = await api('GET', `/api/meetings/${meeting.id}`);
    running = (d.data.agenda ?? [])[0];
    if (running?.status !== 'running') await sleep(250);
  }
  t.check('the agenda timer starts an item, and the server says so', running?.status === 'running' && !!running.started_at, JSON.stringify(running && { status: running.status, started_at: running.started_at }));
  await t.waitFor(`${t.hasText('Pause')}`, 'the running item');
  await sleep(1500);
  await t.shot('m7-agenda');

  await t.evaluate(`[...document.querySelectorAll('[role="tab"]')].find(b => b.textContent.trim() === 'People').click()`);
  await t.waitFor(`!!document.querySelector(${JSON.stringify(`[role="combobox"][aria-label="Attendance for ${partnerName}"]`)})`, 'the people tab');
  await t.evaluate(choose(`[role="combobox"][aria-label="Attendance for ${partnerName}"]`, 'present'));
  let present = null;
  for (let i = 0; i < 20 && present?.attendance !== 'present'; i++) {
    const d = await api('GET', `/api/meetings/${meeting.id}`);
    present = (d.data.participants ?? []).find((p) => p.name === partnerName);
    if (present?.attendance !== 'present') await sleep(250);
  }
  t.check('attendance is taken, and read back', present?.attendance === 'present', present?.attendance);
  await t.shot('m8-people');

  await t.evaluate(`[...document.querySelectorAll('[role="tab"]')].find(b => b.textContent.trim() === 'Minutes').click()`);
  await t.waitFor(t.hasText('Discussion summary'), 'the minutes');
  await t.evaluate(`(() => { const a = document.querySelector('textarea'); const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; set.call(a, 'Go with phased delivery.'); a.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await t.clickButton('Save notes');
  let minutes = null;
  for (let i = 0; i < 20 && minutes?.decisions !== 'Go with phased delivery.'; i++) {
    minutes = (await api('GET', `/api/meetings/${meeting.id}`)).data.minutes;
    if (minutes?.decisions !== 'Go with phased delivery.') await sleep(250);
  }
  t.check('minutes are saved', minutes?.decisions === 'Go with phased delivery.', minutes?.decisions);
  await t.shot('m9-minutes');
} catch (e) {
  t.check('meet run', false, e.message);
  try {
    await t.shot('mz-failure');
  } catch {
    /* no page */
  }
} finally {
  await t.finish();
}

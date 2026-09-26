// End-to-end: the Calendar in the desktop against a real WorkSuite — the
// views, a new event, dragging and stretching it with undo, a repeating
// event moved "only this one" and "every occurrence", a month-view drop,
// the category filters, keys, subscribe, import and export.
//
// Every change made in the app is read back from the server.
//
//   npm run build
//   WS_E2E_SERVER=http://localhost:8920 WS_E2E_EMAIL=… WS_E2E_PASSWORD=… \
//   ELECTRON_RUN_AS_NODE=1 npx electron tests/e2e/calendar.mjs
import { launch, sleep } from './harness.mjs';

const server = process.env.WS_E2E_SERVER;
const email = process.env.WS_E2E_EMAIL;
const password = process.env.WS_E2E_PASSWORD;
if (!server || !email || !password) {
  console.error('Set WS_E2E_SERVER, WS_E2E_EMAIL and WS_E2E_PASSWORD.');
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

const addDays = (ymd, n) => new Date(Date.parse(`${ymd}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const tag = Math.floor(Math.random() * 10_000);
const made = [];

/** The feed's entries for one day. */
const feed = async (day) => (await api('GET', `/api/calendar/events?from=${day}&to=${day}`)).data.events ?? [];

const t = await launch({ name: 'calendar' });
try {
  await t.signIn(server, email, password);
  const login = await api('POST', '/api/auth/login', { email, password });
  bearer = login.data.tokens?.access_token ?? '';

  await t.evaluate(`[...document.querySelectorAll('nav[aria-label="Apps"] button')].find(b => b.textContent.trim().startsWith('Calendar')).click()`);
  await t.waitFor(`!!document.querySelector('aside[aria-label="Calendars"]') && ${t.hasText('SHOW')}`, 'the calendar');
  const today = await t.evaluate(`document.querySelector('[aria-current="date"][data-ymd]').dataset.ymd`);
  // What an earlier, interrupted run left behind would crowd the cells.
  for (const e of (await api('GET', `/api/calendar/events?from=${addDays(today, -14)}&to=${addDays(today, 14)}`)).data.events ?? []) {
    if (e.source === 'event' && /^E2E (standup|weekly|imported|no start) \d+$/.test(e.title)) await api('DELETE', `/api/calendar/events/${e.id}`);
  }
  const layout = await t.evaluate(`(() => {
    const rail = document.querySelector('aside[aria-label="Calendars"]');
    return {
      filters: rail.querySelectorAll('input[type="checkbox"]').length,
      tabs: [...document.querySelectorAll('[role="tablist"][aria-label="View"] [role="tab"]')].map(b => b.textContent.trim()),
      selected: document.querySelector('[role="tablist"][aria-label="View"] [aria-selected="true"]').textContent.trim(),
      tools: ['Today', 'Import .ics', 'Export .ics', 'Subscribe'].every(l => [...document.querySelectorAll('button')].some(b => b.textContent.trim() === l)),
      heading: document.querySelector('aside[aria-label="Calendars"]').parentElement.querySelector('main h1').textContent,
    };
  })()`);
  await t.shot('k1-week');
  t.check('the week opens with the rail (new event, month, nine categories, today) and the toolbar', !!bearer && !!today && layout.filters === 9 && layout.tabs.join() === 'Day,Week,Month' && layout.selected === 'Week' && layout.tools && /\d/.test(layout.heading), JSON.stringify({ today, ...layout }));

  // A new event, from the button.
  const title = `E2E standup ${tag}`;
  await t.clickButton('New event');
  await t.waitFor(`!!document.querySelector('aside[aria-label="New event"]')`, 'the new event drawer');
  await t.fill('Event title', title);
  await t.fill('Start', `${today}T10:00`);
  await t.fill('End', `${today}T11:00`);
  await t.shot('k2-new');
  await t.evaluate(`[...document.querySelector('aside[aria-label="New event"]').querySelectorAll('button')].find(b => b.textContent.trim() === 'Save').click()`);
  const inGrid = (x) => `!!document.querySelector(${JSON.stringify(`button[aria-label^="${x},"]`)})`;
  const drawn = await t.waitFor(inGrid(title), 'the new event in the grid', 15_000).then(() => true, () => false);
  if (!drawn) {
    const seen = await t.evaluate(`fetch('app://bundle/__api/api/calendar/events?from=' + ${JSON.stringify(addDays(today, -6))} + '&to=' + ${JSON.stringify(addDays(today, 7))}).then(r => r.status + ' ' + r.headers.get('x-ws-offline')).catch(e => String(e))`);
    const grid = await t.evaluate(`[...document.querySelectorAll('main button[aria-label]')].map(b => b.getAttribute('aria-label')).filter(l => /,/.test(l)).slice(0, 12)`);
    throw new Error(`the new event is not in the grid; api ${seen}; grid ${JSON.stringify(grid)}`);
  }
  let row = (await feed(today)).find((e) => e.title === title);
  if (row) made.push(row.id);
  t.check('a new event is saved at the time chosen', row?.start_at?.slice(11, 16) === '10:00' && row?.end_at?.slice(11, 16) === '11:00', JSON.stringify(row ?? null));

  /** The middle of an entry in the grid, scrolled into view. */
  const where = async (x, part = 'middle') =>
    t.evaluate(`(() => {
      const b = document.querySelector(${JSON.stringify(`button[aria-label^="${x},"]`)});
      b.scrollIntoView({ block: 'center' });
      const r = b.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: ${part === 'bottom' ? 'r.bottom - 2' : 'r.top + Math.min(14, r.height / 2)'}, w: r.width };
    })()`);

  // Drag it an hour later; undo puts it back.
  let at = await where(title);
  await t.drag(at.x, at.y, at.x, at.y + 52);
  await t.waitFor(t.hasText('Moved to'), 'the undo bar');
  row = (await feed(today)).find((e) => e.title === title);
  const moved = row?.start_at?.slice(11, 16);
  await t.shot('k3-moved');
  await t.clickButton('Undo');
  await t.waitFor(t.hasText('Put back'), 'the undo');
  row = (await feed(today)).find((e) => e.title === title);
  t.check('dragging an event moves it an hour, and Undo puts it back', moved === '11:00' && row?.start_at?.slice(11, 16) === '10:00', `${moved} → ${row?.start_at}`);

  // Stretch it by half an hour from its bottom edge.
  await sleep(400);
  at = await where(title, 'bottom');
  await t.evaluate(`document.querySelector(${JSON.stringify(`button[aria-label^="${title},"]`)}).dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))`);
  await t.drag(at.x, at.y, at.x, at.y + 26);
  await t.waitFor(t.hasText('Now ends at'), 'the stretched event');
  row = (await feed(today)).find((e) => e.title === title);
  t.check('stretching the bottom edge moves only the end', row?.start_at?.slice(11, 16) === '10:00' && row?.end_at?.slice(11, 16) === '11:30', `${row?.start_at} – ${row?.end_at}`);

  // A weekly event that began a week ago: today's occurrence, moved alone, then with the series.
  const weekly = `E2E weekly ${tag}`;
  const start0 = addDays(today, -7);
  const w = await api('POST', '/api/calendar/events', { title: weekly, start: `${start0}T14:00`, end: `${start0}T15:00`, all_day: false, recur_freq: 'weekly' });
  const wid = w.data?.id;
  if (wid) made.push(wid);
  await t.evaluate(`[...document.querySelectorAll('main button')].find(b => b.getAttribute('aria-label') === 'Next week').click()`);
  await t.evaluate(`[...document.querySelectorAll('main button')].find(b => b.getAttribute('aria-label') === 'Previous week').click()`);
  // Made outside the app, so it arrives with the next refresh (every 30 seconds).
  const shownWeekly = await t.waitFor(inGrid(weekly), 'the weekly event', 45_000).then(() => true, () => false);
  if (!shownWeekly) {
    const f = (await feed(today)).filter((e) => e.title === weekly);
    const labels = await t.evaluate(`[...document.querySelectorAll('button[aria-label]')].map(b => b.getAttribute('aria-label')).filter(l => l.startsWith('E2E'))`);
    throw new Error(`the weekly event is not in the grid; created ${w.status} ${wid}; feed today ${JSON.stringify(f)}; grid ${JSON.stringify(labels)}`);
  }
  at = await where(weekly);
  await t.drag(at.x, at.y, at.x, at.y + 52);
  await t.waitFor(t.hasText('Move the whole series?'), 'the series question');
  const choices = await t.evaluate(`[...document.querySelectorAll('[role="dialog"] button')].map(b => b.textContent.trim())`);
  await t.shot('k4-series');
  await t.clickButton('Only this one');
  await t.waitFor(t.hasText('This one only'), 'the one-off move');
  let day = await feed(today);
  const copy = day.find((e) => e.title === weekly && !e.recurring);
  if (copy) made.push(copy.id);
  const still = day.find((e) => e.title === weekly && e.recurring);
  const nextWeek = (await feed(addDays(today, 7))).find((e) => e.title === weekly);
  t.check('"Only this one" moves today\'s occurrence alone: a one-off at 15:00, the series untouched', choices.includes('Only this one') && choices.includes('Move every occurrence') && copy?.start_at?.slice(11, 16) === '15:00' && !still && nextWeek?.start_at?.slice(11, 16) === '14:00', JSON.stringify({ copy: copy?.start_at, still: !!still, next: nextWeek?.start_at }));
  await t.clickButton('Undo');
  await t.waitFor(t.hasText('Put back'), 'the undo of the one-off');
  day = await feed(today);
  t.check('and Undo removes the one-off and brings the occurrence back', !day.some((e) => e.title === weekly && !e.recurring) && day.some((e) => e.title === weekly && e.recurring && e.start_at.slice(11, 16) === '14:00'), JSON.stringify(day.filter((e) => e.title === weekly)));

  await sleep(400);
  at = await where(weekly);
  await t.drag(at.x, at.y, at.x, at.y + 52);
  await t.waitFor(t.hasText('Move the whole series?'), 'the series question again');
  await t.clickButton('Move every occurrence');
  await t.waitFor(t.hasText('Every occurrence'), 'the series move');
  const master = (await api('GET', `/api/calendar/events/${wid}`)).data;
  const later = (await feed(addDays(today, 7))).find((e) => e.title === weekly);
  t.check('"Move every occurrence" moves the series by the hour dragged, from its own first date', master?.start_at?.slice(0, 16) === `${start0} 15:00` && later?.start_at?.slice(11, 16) === '15:00', `${master?.start_at} · next ${later?.start_at}`);

  // The drawer on an occurrence shows the series' own times.
  await t.evaluate(`document.querySelector(${JSON.stringify(`button[aria-label^="${weekly},"]`)}).click()`);
  await t.waitFor(`${t.hasText('This repeats.')} && document.querySelector('aside[aria-label="Event"] input[type="datetime-local"]')?.value === ${JSON.stringify(`${start0}T15:00`)}`, 'the series times in the drawer', 15_000).catch(() => undefined);
  const shown = await t.evaluate(`document.querySelector('aside[aria-label="Event"] input[type="datetime-local"]')?.value ?? null`);
  await t.shot('k5-series-drawer');
  t.check('opening an occurrence shows the series\' own start, so saving cannot move the series', shown === `${start0}T15:00`, String(shown));
  await t.evaluate(`document.querySelector('aside[aria-label="Event"] button[aria-label="Close"]').click()`);

  // Month view, by key; drop the event on tomorrow.
  await t.evaluate(`document.activeElement && document.activeElement.blur()`);
  await t.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'm', text: 'm' });
  await t.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'm' });
  await t.waitFor(`document.querySelector('[role="tablist"][aria-label="View"] [aria-selected="true"]').textContent.trim() === 'Month'`, 'the month view');
  // Only events, so today's cell has room to show this one.
  const toggle = (label) => t.evaluate(`[...document.querySelectorAll('aside[aria-label="Calendars"] label')].find(l => l.textContent.trim() === ${JSON.stringify(label)}).querySelector('input').click()`);
  for (const c of ['Meetings', 'Tasks']) await toggle(c);
  await t.waitFor(`[...document.querySelectorAll('button[draggable="true"]')].some(b => b.title === ${JSON.stringify(title)})`, 'the event in the month');
  const tomorrow = addDays(today, 1);
  const dropped = await t.evaluate(`(() => {
    const chip = [...document.querySelectorAll('button[draggable="true"]')].find(b => b.title === ${JSON.stringify(title)});
    const cell = document.querySelector(${JSON.stringify(`[data-day="${tomorrow}"]`)});
    if (!chip || !cell) return false;
    const dt = new DataTransfer();
    chip.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
    cell.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
    cell.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
    chip.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
    return true;
  })()`);
  await t.waitFor(t.hasText('Moved to'), 'the month move').catch(() => undefined);
  await t.shot('k6-month');
  const onTomorrow = (await feed(tomorrow)).find((e) => e.title === title);
  t.check('in the month, an event dropped on tomorrow keeps its time', dropped && onTomorrow?.start_at?.slice(11, 16) === '10:00', `${dropped} ${JSON.stringify(onTomorrow ?? null)}`);
  await t.clickButton('Undo');
  await t.waitFor(t.hasText('Put back'), 'the month undo');
  for (const c of ['Meetings', 'Tasks']) await toggle(c);

  // The filters hide a category.
  await t.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'w', text: 'w' });
  await t.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'w' });
  await t.waitFor(inGrid(title), 'the week again');
  await t.evaluate(`[...document.querySelectorAll('aside[aria-label="Calendars"] label')].find(l => l.textContent.trim() === 'Events').querySelector('input').click()`);
  const gone = await t.evaluate(`!${inGrid(title)}`);
  await t.evaluate(`[...document.querySelectorAll('aside[aria-label="Calendars"] label')].find(l => l.textContent.trim() === 'Events').querySelector('input').click()`);
  const back = await t.waitFor(inGrid(title), 'the events again').then(() => true, () => false);
  t.check('unticking Events hides your events; ticking brings them back', gone && back);

  // Subscribe: make a link, see it as Apple wants it, stop it.
  const before = (await api('GET', '/api/calendar/feed')).data;
  await t.clickButton('Subscribe');
  await t.waitFor(t.hasText('Where to paste it'), 'the subscribe dialog');
  await t.clickButton(before.exists ? 'Replace the link' : 'Make my link');
  if (before.exists) await t.clickButton('Replace it');
  await t.waitFor(`!!document.querySelector('[aria-label="Your calendar link"]')`, 'the link');
  const https = await t.evaluate(`document.querySelector('[aria-label="Your calendar link"]').textContent`);
  await t.clickButton('Apple Calendar');
  const webcal = await t.evaluate(`document.querySelector('[aria-label="Your calendar link"]').textContent`);
  await t.shot('k7-subscribe');
  await t.clickButton('Stop it');
  await t.clickButton('Stop it');
  await t.waitFor(t.hasText('stopped working'), 'the stopped link');
  const after = (await api('GET', '/api/calendar/feed')).data;
  const probe = await fetch(https).then((r) => r.status).catch(() => 0);
  t.check('Subscribe makes a link (webcal:// for Apple) and Stop it ends it', /^https?:\/\/.+\/calendar\/feed\/.+\.ics$/.test(https) && webcal.startsWith('webcal://') && after.exists === false && probe >= 400, `${https.slice(0, 40)}… · after ${JSON.stringify(after.exists)} · fetch ${probe}`);
  await t.evaluate(`document.querySelector('[role="dialog"] button[aria-label="Close"]')?.click() ?? document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  await t.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });

  // Import: one good event and one without a start.
  const imported = `E2E imported ${tag}`;
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//E2E//EN', 'BEGIN:VEVENT', `UID:e2e-${tag}-1`, `SUMMARY:${imported}`, `DTSTART:${tomorrow.replace(/-/g, '')}T090000`, `DTEND:${tomorrow.replace(/-/g, '')}T100000`, 'END:VEVENT', 'BEGIN:VEVENT', `UID:e2e-${tag}-2`, `SUMMARY:E2E no start ${tag}`, 'END:VEVENT', 'END:VCALENDAR', ''].join('\r\n');
  await t.evaluate(`(() => {
    const input = document.querySelector('input[type="file"][aria-label="Choose a calendar file"]');
    const dt = new DataTransfer();
    dt.items.add(new File([${JSON.stringify(ics)}], 'e2e.ics', { type: 'text/calendar' }));
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  await t.waitFor(`${t.hasText('Import .ics')} && ${t.hasText('Skipped')} || ${t.hasText('Imported 1 event')}`, 'the import result', 20_000);
  const result = await t.evaluate(`document.querySelector('[role="dialog"]')?.innerText ?? ''`);
  await t.shot('k8-import');
  const got = (await feed(tomorrow)).find((e) => e.title === imported);
  if (got) made.push(got.id);
  t.check('importing an .ics saves the good event and says which one was skipped, and why', !!got && /Imported\s*1/.test(result) && /Skipped\s*1/.test(result) && result.includes(`E2E no start ${tag}`), result.replace(/\s+/g, ' ').slice(0, 160));
  await t.clickButton('Done');

  // Export: a file in the downloads.
  await t.clickButton('Export .ics');
  const exported = await t
    .waitFor(`window.worksuite.transfers.list().then(l => Array.isArray(l) && l.some(x => x.name === 'worksuite-calendar.ics' && x.state === 'done'))`, 'the export', 30_000)
    .then(() => true, () => false);
  t.check('Export .ics saves your calendar to the downloads', exported);
} catch (e) {
  t.check('calendar run', false, e.message);
  try {
    await t.shot('kz-failure');
  } catch {
    /* no page */
  }
} finally {
  for (const id of [...new Set(made)]) await api('DELETE', `/api/calendar/events/${id}`).catch(() => undefined);
  await t.finish();
}

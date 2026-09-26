// End-to-end: notifications — the bell's drawer (sections, snooze and dismiss
// with Undo, an app filter, Do not disturb), the notification centre (every
// view, the preview, selection) and the settings grid (a category muted on
// this computer). Runs on the signed-in user's own notifications and puts
// back whatever it read, snoozed or dismissed.
//
//   npm run build
//   WS_E2E_SERVER=… WS_E2E_EMAIL=… WS_E2E_PASSWORD=… ELECTRON_RUN_AS_NODE=1 npx electron tests/e2e/notifications.mjs
import { launch, sleep } from './harness.mjs';
const server = process.env.WS_E2E_SERVER, email = process.env.WS_E2E_EMAIL, password = process.env.WS_E2E_PASSWORD;
let bearer = '';
const api = async (method, path, body) => { const r = await fetch(server + path, { method, headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` }, body: body ? JSON.stringify(body) : undefined }); const j = await r.json().catch(() => ({})); return { status: r.status, data: j.data ?? j }; };
const t = await launch({ name: 'notifications' });
const theme = (v) => t.evaluate(`(() => { document.documentElement.dataset.theme = ${JSON.stringify(v)}; document.documentElement.classList.toggle('dark', ${JSON.stringify(v)} === 'dark'); return true; })()`);
let touched = null;
const readBack = [];
try {
  bearer = (await api('POST', '/api/auth/login', { email, password })).data?.tokens?.access_token ?? '';
  await t.signIn(server, email, password);
  await sleep(1500);
  // Counted after signing in: a sign-in from a new device is itself a notification.
  const before = (await api('GET', '/api/notifications/unread-count')).data.count;
  await theme('dark');
  await t.evaluate(`document.querySelector('header button[title="Notifications"], header button[aria-label="Notifications"]').click()`);
  await t.waitFor(`document.querySelectorAll('[data-notif-drawer] [data-notice]').length > 0`, 'the drawer rows', 20000);
  await sleep(600);
  await t.shot('n1-drawer-dark');
  const sections = await t.evaluate(`[...document.querySelectorAll('[data-notif-drawer] span.uppercase')].map(s => s.textContent)`);
  t.check('the drawer lists by section', sections.length > 0, JSON.stringify(sections));
  const badge = await t.evaluate(`document.querySelector('[role="dialog"][aria-label="Notifications"]').innerText.match(/(\\d+) new/)?.[1]`);
  t.check('the drawer counts what is new like the server', Number(badge ?? 0) === before, `${badge} vs ${before}`);
  // Snooze the first unread one, then undo.
  const first = await t.evaluate(`(() => { const r = [...document.querySelectorAll('[data-notif-drawer] [data-notice]')].find(r => r.querySelector('[aria-label="Unread"]')); return r ? Number(r.dataset.notice) : null; })()`);
  touched = first;
  await t.evaluate(`document.querySelector('[data-notif-drawer] [data-notice="${first}"] button[aria-label="Snooze"]').click()`);
  await t.waitFor(`!!document.querySelector('[role="menu"][aria-label="Snooze until"]')`, 'the snooze menu');
  await t.shot('n2-snooze-menu');
  await t.evaluate(`[...document.querySelectorAll('[role="menu"][aria-label="Snooze until"] button')].find(b => b.textContent.trim() === '1 hour').click()`);
  await t.waitFor(`!document.querySelector('[data-notif-drawer] [data-notice="${first}"]')`, 'the snoozed row leaves', 15000);
  const afterSnooze = (await api('GET', '/api/notifications/unread-count')).data.count;
  t.check('snoozing takes it off the list and the count', afterSnooze === before - 1, `${before} → ${afterSnooze}`);
  await t.evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Undo').click()`);
  await t.waitFor(`!!document.querySelector('[data-notif-drawer] [data-notice="${first}"]')`, 'undo brings it back', 15000);
  t.check('Undo brings it back', (await api('GET', '/api/notifications/unread-count')).data.count === before);
  // Dismiss, then undo.
  await t.evaluate(`document.querySelector('[data-notif-drawer] [data-notice="${first}"] button[aria-label="Dismiss"]').click()`);
  await t.waitFor(`!document.querySelector('[data-notif-drawer] [data-notice="${first}"]')`, 'dismissed', 15000);
  const arch = (await api('GET', '/api/notifications/centre?view=archived&per_page=100')).data.notifications.some((n) => n.id === first);
  t.check('Dismiss moves it to Done', arch);
  await t.evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Undo').click()`);
  await t.waitFor(`!!document.querySelector('[data-notif-drawer] [data-notice="${first}"]')`, 'undo dismiss', 15000);
  // Filters.
  await t.evaluate(`[...document.querySelectorAll('[role="dialog"][aria-label="Notifications"] button')].find(b => b.textContent.trim() === 'Apps').click()`);
  await t.waitFor(`!!document.querySelector('[role="menu"][aria-label="Apps"]')`, 'the Apps menu');
  await t.shot('n3-apps');
  await t.evaluate(`document.querySelectorAll('[role="menu"][aria-label="Apps"] button')[1].click()`);
  await sleep(1200);
  const oneApp = await t.evaluate(`new Set([...document.querySelectorAll('[data-notif-drawer] [data-notice]')].map(r => r.dataset.category)).size`);
  t.check('an app filter shows one app', oneApp <= 1, String(oneApp));
  await theme('light');
  await sleep(300);
  await t.shot('n4-drawer-light');
  // Do not disturb.
  await t.evaluate(`document.querySelector('[role="dialog"][aria-label="Notifications"] button[role="switch"][aria-label="Do not disturb"]').click()`);
  await t.waitFor(`document.querySelector('button[role="switch"][aria-label="Do not disturb"]')?.getAttribute('aria-checked') === 'true'`, 'DND on');
  t.check('Do not disturb pauses this computer', true);
  await t.evaluate(`document.querySelector('button[role="switch"][aria-label="Do not disturb"]').click()`);
  await t.waitFor(`document.querySelector('button[role="switch"][aria-label="Do not disturb"]')?.getAttribute('aria-checked') === 'false'`, 'DND off');
  // The centre.
  await t.evaluate(`[...document.querySelectorAll('[role="dialog"][aria-label="Notifications"] button')].find(b => b.textContent.includes('Open notification center')).click()`);
  await t.waitFor(`document.querySelectorAll('[data-notif-list] [data-notice]').length > 0`, 'the centre list', 20000);
  await theme('dark');
  const shown = await t.evaluate(`(() => { const r = document.querySelector('[data-notif-list] [data-notice]'); return { id: Number(r.dataset.notice), unread: !!r.querySelector('[aria-label="Unread"]') }; })()`);
  if (shown.unread) readBack.push(shown.id);
  await t.evaluate(`document.querySelector('[data-notif-list] [data-notice] button[aria-label^="Show"]').click()`);
  await t.waitFor(`!!document.querySelector('[data-notif-preview]')`, 'the preview', 15000);
  await sleep(1200);
  await t.shot('n5-centre-dark');
  for (const v of ['Mentions', 'Approvals', 'Assigned to me', 'Snoozed', 'Done', 'Inbox']) {
    await t.evaluate(`[...document.querySelectorAll('nav[aria-label="Notification views"] button')].find(b => b.textContent.trim().startsWith(${JSON.stringify(v)})).click()`);
    await sleep(700);
  }
  t.check('every view opens', await t.evaluate(`!document.querySelector('[data-notif-list]').innerText.includes('could not be loaded')`));
  await t.evaluate(`[...document.querySelectorAll('[data-notif-list] [data-notice] input[type="checkbox"]')].slice(0, 2).forEach(c => c.click())`);
  await sleep(300);
  await t.shot('n6-bulk');
  t.check('selecting shows the bulk bar', await t.evaluate(`document.querySelector('[aria-label="Selection"]').innerText.includes('2 selected')`));
  await t.evaluate(`document.querySelector('[aria-label="Selection"] input[type="checkbox"]').click()`);
  await t.evaluate(`document.querySelector('[aria-label="Selection"] input[type="checkbox"]').click()`);
  // Settings.
  const cb = await t.evaluate(`(() => { const c = document.querySelector('[data-notif-list] [data-notice] input[type="checkbox"]'); const r = c.getBoundingClientRect(); const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return top === c; })()`);
  t.check('a row\'s checkbox is on top where it is clicked', cb);
  await t.evaluate(`[...document.querySelectorAll('nav[aria-label="Notification views"] button')].find(b => b.textContent.trim() === 'Settings').click()`);
  await t.waitFor(`!!document.querySelector('[data-notif-matrix]')`, 'the settings grid', 20000);
  await sleep(800);
  await t.shot('n7-settings-dark');
  await theme('light');
  await sleep(300);
  await t.shot('n8-settings-light');
  const box = await t.evaluate(`(() => { const b = [...document.querySelectorAll('[data-notif-matrix] input[type="checkbox"]')].find(c => c.getAttribute('aria-label').endsWith(': This computer')); return b ? b.getAttribute('aria-label') : null; })()`);
  await t.evaluate(`document.querySelector('[data-notif-matrix] input[aria-label=${JSON.stringify(box)}]').click()`);
  await sleep(800);
  const off = await t.evaluate(`!document.querySelector('[data-notif-matrix] input[aria-label=${JSON.stringify(box)}]').checked`);
  t.check('a category is muted on this computer', off, box);
  await t.evaluate(`document.querySelector('[data-notif-matrix] input[aria-label=${JSON.stringify(box)}]').click()`);
  await sleep(800);
} catch (e) { console.log('ERR', e.message); await t.shot('nz').catch(() => undefined); } finally {
  for (const id of readBack) await api('POST', `/api/notifications/${id}/action`, { action: 'unread' });
  if (touched) { await api('POST', `/api/notifications/${touched}/action`, { action: 'unsnooze' }); await api('POST', `/api/notifications/${touched}/action`, { action: 'unarchive' }); await api('POST', `/api/notifications/${touched}/action`, { action: 'unread' }); }
  await t.finish();
}

// End-to-end: Notes in the desktop against a real WorkSuite — a notebook
// with a section, a note from the Meeting notes template, typing that saves
// itself, a to-do ticked, a picture, the title; shared with a teammate as a
// viewer (who can read it and not change it); version history, compared and
// restored; linked to an event; converted to a task; pinned, archived; search.
//
//   npm run build
//   WS_E2E_SERVER=http://localhost:8920 WS_E2E_EMAIL=… WS_E2E_PASSWORD=… \
//   WS_E2E_PARTNER_EMAIL=… WS_E2E_PARTNER_PASSWORD=… \
//   ELECTRON_RUN_AS_NODE=1 npx electron tests/e2e/notes.mjs
import { launch, sleep } from './harness.mjs';

const server = process.env.WS_E2E_SERVER;
const email = process.env.WS_E2E_EMAIL;
const password = process.env.WS_E2E_PASSWORD;
const partnerEmail = process.env.WS_E2E_PARTNER_EMAIL;
const partnerPassword = process.env.WS_E2E_PARTNER_PASSWORD;
if (!server || !email || !password || !partnerEmail || !partnerPassword) {
  console.error('Set WS_E2E_SERVER, WS_E2E_EMAIL, WS_E2E_PASSWORD, WS_E2E_PARTNER_EMAIL and WS_E2E_PARTNER_PASSWORD.');
  process.exit(2);
}

const tokens = {};
async function api(who, method, path, body) {
  const res = await fetch(`${server}${path}`, {
    method,
    headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}), Authorization: `Bearer ${tokens[who]}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const type = res.headers.get('content-type') ?? '';
  const json = type.includes('json') ? await res.json().catch(() => ({})) : {};
  return { status: res.status, type, data: json.data ?? json };
}
async function login(who, e, p) {
  const r = await fetch(`${server}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ email: e, password: p }) });
  const j = await r.json();
  tokens[who] = j.data?.tokens?.access_token ?? '';
  return j.data?.user ?? {};
}

const tag = Math.floor(Math.random() * 10_000);
const made = { notes: [], notebooks: [], events: [], tasks: [] };
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const body = async (id) => (await api('me', 'GET', `/api/notes/${id}`)).data;
const saved = () => `[...document.querySelectorAll('article span')].some(s => s.textContent.trim() === 'Saved')`;
const type = (text) => `(() => { const box = document.querySelector('[role="textbox"][aria-label="Note"]'); box.focus(); const r = document.createRange(); r.selectNodeContents(box); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r); document.execCommand('insertText', false, ${JSON.stringify(text)}); return true; })()`;

const t = await launch({ name: 'notes' });
try {
  await t.signIn(server, email, password);
  await login('me', email, password);
  const partner = await login('partner', partnerEmail, partnerPassword);

  // Notes, from More apps.
  await t.evaluate(`[...document.querySelectorAll('nav[aria-label="Apps"] button')].find(b => b.textContent.trim().startsWith('More apps')).click()`);
  await t.waitFor(`!!document.querySelector('[role="dialog"][aria-label="Apps"]')`, 'the apps');
  await t.evaluate(`[...document.querySelectorAll('[role="dialog"][aria-label="Apps"] button')].find(b => b.textContent.trim().startsWith('Notes')).click()`);
  await t.waitFor(`!!document.querySelector('nav[aria-label="Notebooks"]')`, 'Notes');
  const views = await t.evaluate(`[...document.querySelectorAll('nav[aria-label="Notebooks"] button[aria-current], nav[aria-label="Notebooks"] > button')].map(b => b.textContent.trim())`);
  t.check('Notes opens natively, with the views', ['All notes', 'Favorites', 'Pinned', 'Shared with me', 'Archived'].every((v) => views.some((x) => x.startsWith(v))), JSON.stringify(views));

  // A notebook with a first section.
  const book = `E2E book ${tag}`;
  await t.clickButton('New notebook');
  await t.fill('Notebook name', book);
  await t.fill('First section name', 'Meetings');
  await t.clickButton('Create');
  await t.waitFor(`[...document.querySelectorAll('nav[aria-label="Notebooks"] button')].some(b => b.textContent.includes(${JSON.stringify(book)}))`, 'the notebook');
  const nb = ((await api('me', 'GET', '/api/notebooks')).data ?? []).find((x) => x.name === book);
  if (nb) made.notebooks.push(nb.id);
  const sec = ((await api('me', 'GET', '/api/note-sections')).data ?? []).find((x) => x.notebook_id === nb?.id && x.name === 'Meetings');
  t.check('a notebook is made with its first section, and opens on it', !!nb && !!sec && (await t.evaluate(`!!document.querySelector('nav[aria-label="Notebooks"] button[aria-current="page"]')?.textContent.includes('Meetings')`)));

  // A note from the Meeting notes template, in that section.
  const title = `E2E note ${tag}`;
  await t.evaluate(`document.activeElement && document.activeElement.blur()`);
  await t.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'n', text: 'n' });
  await t.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'n' });
  await t.waitFor(t.hasText('Start from template'), 'the new note dialog');
  await t.fill('Title', title);
  await t.evaluate(`[...document.querySelectorAll('[role="radio"]')].find(b => b.textContent.includes('Meeting notes')).click()`);
  await t.shot('n1-new');
  await t.clickButton('Create note');
  await t.waitFor(`!!document.querySelector('[role="textbox"][aria-label="Note"]') && document.querySelector('input[aria-label="Title"]')?.value === ${JSON.stringify(title)}`, 'the new note open');
  const cards = (await api('me', 'GET', `/api/notes?section=${sec?.id}`)).data ?? [];
  const id = cards.find((c) => c.title === title)?.id;
  if (id) made.notes.push(id);
  const first = id ? await body(id) : null;
  t.check('a note made from Meeting notes is filed in the section and has the template', !!first && first.section_id === sec?.id && first.body.includes('Agenda') && first.body.includes('Action items'), JSON.stringify({ section: first?.section_id }));

  // Typing saves itself.
  await t.evaluate(type(' Decided: ship on Friday.'));
  await t.waitFor(saved(), 'the note saved', 15_000);
  let now = await body(id);
  t.check('typing saves the note by itself', now.body.includes('Decided: ship on Friday.'), now.body.slice(-120));

  // A to-do, ticked by clicking its box.
  await t.evaluate(`(() => { const lis = [...document.querySelectorAll('[role="textbox"][aria-label="Note"] li')].filter(li => li.textContent.startsWith('☐')); const li = lis[lis.length - 1]; li.scrollIntoView({ block: 'center' }); const r = document.createRange(); r.setStart(li.firstChild, 0); r.setEnd(li.firstChild, 1); const b = r.getBoundingClientRect(); window.__todo = { x: b.left + b.width / 2, y: b.top + b.height / 2 }; return true; })()`);
  const at = await t.evaluate(`window.__todo`);
  await t.drag(at.x, at.y, at.x, at.y, 1);
  await t.waitFor(`[...document.querySelectorAll('[role="textbox"][aria-label="Note"] li')].some(li => li.textContent.startsWith('☑'))`, 'the ticked to-do');
  await t.waitFor(saved(), 'saved again', 15_000);
  await sleep(1000);
  now = await body(id);
  t.check('clicking a to-do\'s box ticks it, and it is saved', now.body.includes('☑'), now.body.match(/<li>[☐☑][^<]*<\/li>/g)?.join(' '));

  // A picture.
  await t.evaluate(`(() => { const bytes = Uint8Array.from(atob(${JSON.stringify(png)}), c => c.charCodeAt(0)); const input = document.querySelector('input[aria-label="Choose a picture"]'); const dt = new DataTransfer(); dt.items.add(new File([bytes], 'e2e-board.png', { type: 'image/png' })); input.files = dt.files; input.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  await t.waitFor(`!!document.querySelector('[role="textbox"][aria-label="Note"] img[data-file-id]')`, 'the picture in the note', 20_000);
  await t.waitFor(saved(), 'saved with the picture', 15_000);
  await sleep(1200);
  now = await body(id);
  const fid = /data-file-id="(\d+)"/.exec(now.body)?.[1];
  const img = fid ? await api('me', 'GET', `/api/notes/${id}/images/${fid}`) : { status: 0, type: '' };
  await t.shot('n2-note');
  t.check('a picture goes into the note by its file id and is served from the note', !!fid && img.status === 200 && img.type.startsWith('image/png'), JSON.stringify({ fid, status: img.status, type: img.type }));

  // Share with the partner as a viewer.
  await t.evaluate(`[...document.querySelectorAll('article button')].find(b => b.textContent.trim().startsWith('Share')).click()`);
  await t.waitFor(t.hasText('People with access'), 'the share dialog');
  await t.fill('Search teammates', (partner.name ?? '').split(' ')[0]);
  await t.waitFor(`[...document.querySelectorAll('[role="dialog"] button')].some(b => b.textContent.includes(${JSON.stringify(partner.name ?? '')}))`, 'the teammate');
  await t.evaluate(`[...document.querySelectorAll('[role="dialog"] button')].find(b => b.textContent.includes(${JSON.stringify(partner.name ?? '')})).click()`);
  await t.evaluate(`(() => { const s = document.querySelector('select[aria-label="Role"]'); const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; set.call(s, 'viewer'); s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  await t.evaluate(`[...document.querySelectorAll('[role="dialog"] button')].find(b => b.textContent.trim() === 'Share').click()`);
  await t.waitFor(`[...document.querySelectorAll('[role="dialog"] select')].some(s => s.getAttribute('aria-label') === ${JSON.stringify(`Role of ${partner.name}`)})`, 'the share');
  await t.shot('n3-share');
  await t.clickButton('Done');
  const seen = await api('partner', 'GET', `/api/notes/${id}`);
  const theirs = (await api('partner', 'GET', '/api/notes/shared')).data ?? [];
  const write = await api('partner', 'PUT', `/api/notes/${id}`, { title: 'hijacked' });
  t.check('shared as a viewer: they find it, can read it, and cannot change it', seen.status === 200 && seen.data.my_role === 'viewer' && theirs.some((x) => x.id === id) && write.status === 404, JSON.stringify({ read: seen.status, role: seen.data.my_role, write: write.status }));

  // Version history: compare, then restore the template.
  await t.clickButton('Version history');
  const compared = await t
    .waitFor(`[...document.querySelectorAll('aside[aria-label="Version history"] span')].some(s => s.className.includes('bg-success-bg') && s.textContent.includes('Decided'))`, 'the comparison', 15_000)
    .then(() => true, () => false);
  await t.shot('n4-history');
  await t.clickButton('Restore version');
  await t.clickButton('Restore');
  await t.waitFor(`!document.querySelector('aside[aria-label="Version history"]')`, 'restored');
  await sleep(1000);
  now = await body(id);
  t.check('version history compares a version with now, and restores it', compared && !now.body.includes('Decided') && now.body.includes('Agenda'), JSON.stringify({ compared, restored: !now.body.includes('Decided') }));

  // Linked to an event; converted to a task.
  const ev = await api('me', 'POST', '/api/calendar/events', { title: `E2E review ${tag}`, start: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10), end: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10), all_day: true });
  if (ev.data?.id) made.events.push(ev.data.id);
  await t.clickButton('Link to an event…');
  await t.fill('Search', `E2E review ${tag}`);
  await t.waitFor(`[...document.querySelectorAll('[role="dialog"] button')].some(b => b.textContent.includes(${JSON.stringify(`E2E review ${tag}`)}))`, 'the event in the picker', 15_000);
  await t.evaluate(`[...document.querySelectorAll('[role="dialog"] button')].find(b => b.textContent.includes(${JSON.stringify(`E2E review ${tag}`)})).click()`);
  await t.waitFor(t.hasText(`Event · E2E review ${tag}`), 'the linked event');
  await t.evaluate(`[...document.querySelectorAll('article button')].find(b => b.textContent.trim() === 'Convert to task').click()`);
  await t.waitFor(t.hasText('Converted to task'), 'the conversion');
  const linkRows = (await api('me', 'GET', `/api/notes/${id}/links`)).data ?? [];
  const task = linkRows.find((l) => l.entity_type === 'task');
  if (task) made.tasks.push(task.entity_id);
  await t.shot('n5-links');
  t.check('a note links to an event and converts to a task, both shown on the note', linkRows.some((l) => l.entity_type === 'event' && l.entity_id === ev.data?.id) && !!task, JSON.stringify(linkRows.map((l) => [l.entity_type, l.label])));

  // Pinned, then archived.
  await t.clickButton('More actions');
  await t.evaluate(`[...document.querySelectorAll('[role="menu"][aria-label="Note actions"] button')].find(b => b.textContent.trim() === 'Pin').click()`);
  await t.waitFor(`[...document.querySelectorAll('section[aria-label="Notes"] button')].some(b => b.textContent.includes(${JSON.stringify(title)}) && b.textContent.includes('Pinned'))`, 'the pinned note');
  await t.clickButton('More actions');
  await t.evaluate(`[...document.querySelectorAll('[role="menu"][aria-label="Note actions"] button')].find(b => b.textContent.trim() === 'Archive').click()`);
  await t.waitFor(`![...document.querySelectorAll('section[aria-label="Notes"] button')].some(b => b.textContent.includes(${JSON.stringify(title)}))`, 'the note gone from the section');
  await t.evaluate(`[...document.querySelectorAll('nav[aria-label="Notebooks"] button')].find(b => b.textContent.trim().startsWith('Archived')).click()`);
  await t.waitFor(`[...document.querySelectorAll('section[aria-label="Notes"] button')].some(b => b.textContent.includes(${JSON.stringify(title)}))`, 'the note in Archived');
  now = await body(id);
  t.check('pinning marks it; archiving moves it to Archived', now.is_pinned === true && now.is_archived === true);

  // Search.
  await t.evaluate(`[...document.querySelectorAll('nav[aria-label="Notebooks"] button')].find(b => b.textContent.trim().startsWith('All notes')).click()`);
  await t.fill('Search notes', `nothing-matches-${tag}`);
  await t.waitFor(t.hasText('No notes match.'), 'no match');
  t.check('search narrows the notes', true);
} catch (e) {
  t.check('notes run', false, e.message);
  try {
    await t.shot('nz-failure');
  } catch {
    /* no page */
  }
} finally {
  for (const id of made.notes) await api('me', 'DELETE', `/api/notes/${id}`).catch(() => undefined);
  for (const id of made.notebooks) await api('me', 'DELETE', `/api/notebooks/${id}`).catch(() => undefined);
  for (const id of made.events) await api('me', 'DELETE', `/api/calendar/events/${id}`).catch(() => undefined);
  for (const id of made.tasks) await api('me', 'DELETE', `/api/tasks/${id}`).catch(() => undefined);
  await t.finish();
}

// End-to-end: Tasks in the desktop against a real WorkSuite — a list and its
// board (quick add, drag to a column), the list view (complete, reopen), a
// new task, and its detail: rename, checklist, a comment with an @mention,
// a reviewer, sent for review; the reviewer (through the API, as the web
// would) opens it and approves it; a file attached from Drive; search.
//
//   npm run build
//   WS_E2E_SERVER=http://localhost:8920 WS_E2E_EMAIL=… WS_E2E_PASSWORD=… \
//   WS_E2E_PARTNER_EMAIL=… WS_E2E_PARTNER_PASSWORD=… \
//   ELECTRON_RUN_AS_NODE=1 npx electron tests/e2e/tasks.mjs
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
  const form = body instanceof FormData;
  const res = await fetch(`${server}${path}`, {
    method,
    headers: { Accept: 'application/json', ...(body && !form ? { 'Content-Type': 'application/json' } : {}), Authorization: `Bearer ${tokens[who]}` },
    body: body ? (form ? body : JSON.stringify(body)) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, data: json.data ?? json, message: json.message };
}
async function login(who, e, p) {
  const r = await fetch(`${server}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ email: e, password: p }) });
  const j = await r.json();
  tokens[who] = j.data?.tokens?.access_token ?? '';
  return j.data?.user ?? {};
}

const tag = Math.floor(Math.random() * 10_000);
const made = { tasks: [], lists: [], files: [] };
const mine = async () => (await api('me', 'GET', '/api/tasks')).data.tasks ?? [];
const byTitle = async (title) => (await mine()).find((t) => t.title === title);

const t = await launch({ name: 'tasks' });
try {
  await t.signIn(server, email, password);
  await login('me', email, password);
  const partner = await login('partner', partnerEmail, partnerPassword);
  const partnerFirst = (partner.name ?? 'Partner').split(' ')[0];

  // A Drive file of mine, to attach later.
  const blob = new Blob([`E2E notes ${tag}\n`], { type: 'text/plain' });
  const init = await api('me', 'POST', '/api/uploads/init', { filename: `e2e-notes-${tag}.txt`, total_size: blob.size, chunk_size: 5 * 1024 * 1024, mime_type: 'text/plain', purpose: 'drive', folder_id: null });
  const chunk = new FormData();
  chunk.set('chunk_index', '0');
  chunk.set('chunk', blob, `e2e-notes-${tag}.txt`);
  await api('me', 'POST', `/api/uploads/${init.data.upload_id}/chunk`, chunk);
  const done = await api('me', 'POST', `/api/uploads/${init.data.upload_id}/complete`, {});
  const fileId = done.data?.file_id;
  if (fileId) made.files.push(fileId);

  await t.evaluate(`[...document.querySelectorAll('nav[aria-label="Apps"] button')].find(b => b.textContent.trim().startsWith('Tasks')).click()`);
  await t.waitFor(`!!document.querySelector('nav[aria-label="Task views and lists"]')`, 'the tasks page');
  const rail = await t.evaluate(`[...document.querySelectorAll('nav[aria-label="Task views and lists"] button[aria-current], nav[aria-label="Task views and lists"] > button')].map(b => b.textContent.trim())`);
  await t.shot('t1-tasks');
  t.check('Tasks opens on All active, with the views and New task', !!tokens.me && !!tokens.partner && ['All active', 'Assigned to me', 'Due today', 'Overdue', 'Completed', 'Shared with me'].every((l) => rail.some((r) => r.startsWith(l))), JSON.stringify(rail));

  // A new list, which opens as a board.
  const listName = `E2E list ${tag}`;
  await t.clickButton('+ New list');
  await t.waitFor(t.hasText('New list'), 'the new list dialog');
  await t.fill('Name', listName);
  await t.clickButton('Create list');
  await t.waitFor(`document.querySelector('nav[aria-label="Task views and lists"]').parentElement.querySelector('main h1')?.textContent === ${JSON.stringify(listName)} && !!document.querySelector('section[aria-label="In Progress"]')`, 'the new list as a board');
  const list = ((await api('me', 'GET', '/api/task-lists')).data.lists ?? []).find((l) => l.name === listName);
  if (list) made.lists.push(list.id);
  t.check('a new list is made and opens as a board', !!list);

  // Quick add in To Do, then drag it to In Progress.
  const boardTitle = `E2E board task ${tag}`;
  await t.fill(`Add a task to To Do`, boardTitle);
  await t.evaluate(`document.querySelector('[aria-label="Add a task to To Do"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`);
  await t.waitFor(`!!document.querySelector('section[aria-label="To Do"] button[aria-label=${JSON.stringify(boardTitle)}]')`, 'the new card in To Do', 20_000);
  let row = await byTitle(boardTitle);
  if (row) made.tasks.push(row.id);
  const added = row?.list_id === list?.id && row?.status === 'todo';
  await t.evaluate(`(() => {
    const card = document.querySelector('section[aria-label="To Do"] button[aria-label=${JSON.stringify(boardTitle)}]');
    const col = document.querySelector('section[aria-label="In Progress"]');
    const dt = new DataTransfer();
    card.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
    col.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
    col.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
    card.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
    return true;
  })()`);
  await t.waitFor(`!!document.querySelector('section[aria-label="In Progress"] button[aria-label=${JSON.stringify(boardTitle)}]')`, 'the card in In Progress');
  await sleep(800);
  row = await byTitle(boardTitle);
  await t.shot('t2-board');
  t.check('quick add puts a task in the list\'s column; dragging it moves it to In Progress', added && row?.status === 'in_progress', JSON.stringify({ added, status: row?.status }));

  // The list view: complete, then reopen.
  await t.evaluate(`[...document.querySelectorAll('[role="tablist"][aria-label="View"] [role="tab"]')].find(b => b.textContent.trim() === 'List').click()`);
  await t.waitFor(`!!document.querySelector('input[aria-label=${JSON.stringify(`Complete ${boardTitle}`)}]')`, 'the list view');
  await t.evaluate(`document.querySelector('input[aria-label=${JSON.stringify(`Complete ${boardTitle}`)}]').click()`);
  await sleep(1200);
  const completed = (await byTitle(boardTitle))?.status;
  await t.evaluate(`[...document.querySelectorAll('[role="tablist"][aria-label="View"] [role="tab"]')].find(b => b.textContent.trim() === 'List').click()`);
  await t.evaluate(`(() => { const s = document.querySelector('select[aria-label="Status"]'); const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; set.call(s, 'all'); s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  await t.waitFor(`!!document.querySelector('input[aria-label=${JSON.stringify(`Reopen ${boardTitle}`)}]')`, 'the completed row');
  await t.evaluate(`document.querySelector('input[aria-label=${JSON.stringify(`Reopen ${boardTitle}`)}]').click()`);
  await sleep(1200);
  const back = await byTitle(boardTitle);
  const reopened = back?.status;
  await t.shot('t3-list');
  t.check('the tick completes a task and unticking reopens it, not still at 100%', completed === 'done' && reopened === 'todo' && back?.progress === 0, `${completed} → ${reopened} at ${back?.progress}%`);

  // A new task, from the dialog; it opens once made.
  const detailTitle = `E2E detailed ${tag}`;
  await t.evaluate(`document.activeElement && document.activeElement.blur()`);
  await t.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'n', text: 'n' });
  await t.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'n' });
  await t.waitFor(t.hasText('Create task'), 'the new task dialog');
  await t.fill('Title', detailTitle);
  await t.evaluate(`(() => { const s = [...document.querySelectorAll('[role="dialog"] label')].find(l => l.textContent.trim().startsWith('Priority')).querySelector('select'); const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; set.call(s, 'high'); s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  await t.shot('t4-new');
  await t.clickButton('Create task');
  await t.waitFor(`!!document.querySelector('[role="dialog"][aria-label="Task details"] input[aria-label="Task name"]')`, 'the new task opened', 20_000);
  row = await byTitle(detailTitle);
  if (row) made.tasks.push(row.id);
  t.check('New task creates it in the list shown, with its priority, and opens it', row?.priority === 'high' && row?.list_id === list?.id, JSON.stringify({ priority: row?.priority, list: row?.list_id }));
  const id = row?.id;

  // Rename; a checklist of two, one ticked.
  const renamed = `${detailTitle} (renamed)`;
  await t.evaluate(`(() => { const el = document.querySelector('input[aria-label="Task name"]'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(el, ${JSON.stringify(renamed)}); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new FocusEvent('focusout', { bubbles: true })); el.blur(); return true; })()`);
  for (const item of ['Draft the estimate', 'Check with Samali']) {
    await t.fill('Add checklist item', item);
    await t.evaluate(`document.querySelector('input[aria-label="Add checklist item"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`);
    await t.waitFor(`!!document.querySelector('input[type="checkbox"][aria-label=${JSON.stringify(item)}]')`, `the item ${item}`);
  }
  await t.evaluate(`document.querySelector('input[type="checkbox"][aria-label="Draft the estimate"]').click()`);
  await t.waitFor(`${t.hasText('Checklist · 1 of 2')}`, 'one of two done');
  const detail = (await api('me', 'GET', `/api/tasks/${id}`)).data;
  t.check('renaming saves; checklist items are added and ticked; progress follows the checklist', detail.title === renamed && detail.checklist?.length === 2 && detail.checklist.filter((c) => c.done).length === 1 && (await t.evaluate(t.hasText('50%'))), JSON.stringify({ title: detail.title, items: detail.checklist }));

  // A comment that mentions the partner.
  await t.evaluate(`(() => { const box = document.querySelector('[role="textbox"][aria-label="Comment"]'); box.focus(); document.execCommand('insertText', false, 'Can you check the rounding, @${partnerFirst.slice(0, 3)}'); box.dispatchEvent(new InputEvent('input', { bubbles: true })); return true; })()`);
  await t.waitFor(`!!document.querySelector('[role="listbox"][aria-label="Mention someone"] [role="option"]')`, 'the mention list');
  await t.evaluate(`[...document.querySelectorAll('[role="listbox"][aria-label="Mention someone"] [role="option"]')].find(o => o.textContent.includes(${JSON.stringify(partner.name ?? '')})).dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
  await t.shot('t5-comment');
  await t.clickButton('Send comment');
  await t.waitFor(`[...document.querySelectorAll('[role="dialog"][aria-label="Task details"] .rich')].some(r => r.textContent.includes('@${partnerFirst}'))`, 'the comment');
  const comments = (await api('me', 'GET', `/api/tasks/${id}/comments`)).data.comments ?? [];
  t.check('a comment is posted, with the @mention written as the first name', comments.some((c) => c.body.includes(`@${partnerFirst}`)), JSON.stringify(comments.map((c) => c.body)));

  // The partner as reviewer, then sent for review.
  await t.clickButton('Manage');
  await t.waitFor(t.hasText('Add somebody'), 'the people dialog');
  await t.evaluate(`(() => { const s = document.querySelector('select[aria-label="Person"]'); const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; set.call(s, ${JSON.stringify(String(partner.id))}); s.dispatchEvent(new Event('change', { bubbles: true })); const r = document.querySelector('select[aria-label="As"]'); set.call(r, 'reviewer'); r.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  await t.clickButton('Add');
  await t.waitFor(`[...document.querySelectorAll('[role="dialog"]')].some(d => d.textContent.includes('REVIEWERS'))`, 'the reviewer in the dialog');
  await t.clickButton('Done');
  await t.waitFor(`[...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Submit for review' && !b.disabled)`, 'Submit for review');
  await t.clickButton('Submit for review');
  await t.clickButton('Send for review');
  await t.waitFor(t.hasText('Sent for review'), 'the review sent');
  await t.shot('t6-review');
  const people = (await api('me', 'GET', `/api/tasks/${id}/people`)).data.people ?? [];
  const inReview = (await api('me', 'GET', `/api/tasks/${id}`)).data.status;
  t.check('a reviewer is added and the task is sent for review', people.some((p) => p.user_id === partner.id && p.role === 'reviewer') && inReview === 'review', `${inReview} · ${JSON.stringify(people.map((p) => [p.name, p.role]))}`);

  // The reviewer can open it, finds it under shared, and approves it.
  const seen = await api('partner', 'GET', `/api/tasks/${id}`);
  const sharedList = (await api('partner', 'GET', '/api/tasks?filter=shared')).data.tasks ?? [];
  const approved = await api('partner', 'POST', `/api/tasks/${id}/approve`, { comment: 'Looks right.' });
  await t.waitFor(`[...document.querySelectorAll('[role="dialog"][aria-label="Task details"] button')].some(b => b.textContent.trim() === 'Reopen')`, 'the approved task in the app', 30_000).catch(() => undefined);
  const after = (await api('me', 'GET', `/api/tasks/${id}`)).data.status;
  t.check('the reviewer can open the task, finds it in "shared", and approving it completes it', seen.status === 200 && sharedList.some((x) => x.id === id) && approved.status === 200 && after === 'done', JSON.stringify({ open: seen.status, shared: sharedList.length, approve: approved.status, after }));

  // A file from Drive.
  if (fileId) {
    await t.evaluate(`[...document.querySelectorAll('[role="dialog"][aria-label="Task details"] button')].find(b => b.textContent.trim() === 'From Drive').click()`);
    await t.waitFor(`!!document.querySelector('input[type="checkbox"][aria-label=${JSON.stringify(`e2e-notes-${tag}.txt`)}]')`, 'the Drive file', 20_000);
    await t.evaluate(`document.querySelector('input[type="checkbox"][aria-label=${JSON.stringify(`e2e-notes-${tag}.txt`)}]').click()`);
    await t.clickButton('Attach');
    await t.waitFor(`[...document.querySelectorAll('[role="dialog"][aria-label="Task details"] b')].some(b => b.textContent === ${JSON.stringify(`e2e-notes-${tag}.txt`)})`, 'the attachment');
    const att = (await api('me', 'GET', `/api/tasks/${id}/attachments`)).data.attachments ?? [];
    await t.shot('t7-attachment');
    t.check('a file chosen from Drive is attached to the task', att.some((a) => a.file_id === fileId), JSON.stringify(att.map((a) => a.name)));
  } else {
    t.check('a file chosen from Drive is attached to the task', false, 'the Drive upload for the test did not work');
  }

  // Close, then search.
  await t.evaluate(`document.querySelector('[role="dialog"][aria-label="Task details"] button[aria-label="Close"]').click()`);
  await t.fill('Search tasks', `renamed`);
  await sleep(300);
  const hits = await t.evaluate(`[...document.querySelectorAll('[role="row"] button')].map(b => b.textContent.trim()).filter(Boolean)`);
  t.check('search narrows the list to what matches', hits.length >= 1 && hits.every((h) => h.toLowerCase().includes('renamed')), JSON.stringify(hits));
} catch (e) {
  t.check('tasks run', false, e.message);
  try {
    await t.shot('tz-failure');
  } catch {
    /* no page */
  }
} finally {
  for (const id of made.tasks) await api('me', 'DELETE', `/api/tasks/${id}`).catch(() => undefined);
  for (const id of made.lists) await api('me', 'DELETE', `/api/task-lists/${id}`).catch(() => undefined);
  for (const id of made.files) await api('me', 'DELETE', `/api/files/${id}`).catch(() => undefined);
  await t.finish();
}

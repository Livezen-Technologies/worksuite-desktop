// End-to-end: Contacts in the desktop against a real WorkSuite — a group, a
// contact made with every section of the form, the drawer (details, a pinned
// note, favorite, the activity), Schedule and Task opening with the name
// filled in, an edit, archive and restore, cards and list, search, a
// colleague saved from the company directory and chatted with, an import
// with one bad row (and that row downloaded), an export, and deletes.
//
//   npm run build
//   WS_E2E_SERVER=http://localhost:8920 WS_E2E_EMAIL=… WS_E2E_PASSWORD=… \
//   WS_E2E_PARTNER_EMAIL=… WS_E2E_PARTNER_PASSWORD=… \
//   ELECTRON_RUN_AS_NODE=1 npx electron tests/e2e/contacts.mjs
import { launch, sleep, chooseIn } from './harness.mjs';

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
const made = { contacts: [], groups: [] };
const js = (v) => JSON.stringify(v);
const mine = async (q) => ((await api('me', 'GET', `/api/contacts?q=${encodeURIComponent(q)}`)).data ?? []).concat(((await api('me', 'GET', `/api/contacts?archived=1&q=${encodeURIComponent(q)}`)).data ?? []));
const detail = async (id) => (await api('me', 'GET', `/api/contacts/${id}`)).data;
const activity = async (id) => (await api('me', 'GET', `/api/contacts/${id}/activities`)).data ?? [];
const railClick = (label) => `[...document.querySelectorAll('nav[aria-label="Contacts"] button')].find(b => b.textContent.trim().startsWith(${js(label)})).click()`;
const drawer = `document.querySelector('aside[role="dialog"][aria-label^="Contact"]')`;
const choose = (label, value) => chooseIn(`[...document.querySelectorAll('label')].find(l => l.textContent.trim().startsWith(${js(label)}))?.querySelector('[role="combobox"]')`, value);
const card = (name) => `[...document.querySelectorAll('main [role="list"][aria-label="Contacts"] button, main [role="table"] button')].find(b => b.getAttribute('aria-label') === ${js(name)})`;

const t = await launch({ name: 'contacts' });
async function openContacts() {
  // Back by its tab, as a person would, so the contact open there stays open.
  const tab = await t.evaluate(`(() => { const b = [...document.querySelectorAll('[role="tablist"][aria-label="Open tabs"] [role="tab"]')].find(b => b.textContent.trim().startsWith('Contacts')); if (!b) return false; b.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 })); return true; })()`);
  const direct = tab || (await t.evaluate(`(() => { const b = [...document.querySelectorAll('nav[aria-label="Apps"] button')].find(b => b.textContent.trim().startsWith('Contacts')); if (!b) return false; b.click(); return true; })()`));
  if (!direct) {
    await t.evaluate(`[...document.querySelectorAll('nav[aria-label="Apps"] button')].find(b => b.textContent.trim().startsWith('More apps')).click()`);
    await t.waitFor(`!!document.querySelector('[role="dialog"][aria-label="Apps"]')`, 'the apps');
    await t.evaluate(`[...document.querySelectorAll('[role="dialog"][aria-label="Apps"] button')].find(b => b.textContent.trim().startsWith('Contacts')).click()`);
  }
  await t.waitFor(`!!document.querySelector('nav[aria-label="Contacts"]') && [...document.querySelectorAll('[role="tablist"][aria-label="Open tabs"] [role="tab"]')].some(b => b.textContent.trim().startsWith('Contacts') && b.getAttribute('aria-selected') === 'true')`, 'Contacts in front');
}

try {
  await t.signIn(server, email, password);
  await login('me', email, password);
  const partner = await login('partner', partnerEmail, partnerPassword);
  // A saved copy of the partner from an earlier run would hide the Add button.
  for (const c of (await api('me', 'GET', '/api/contacts')).data ?? []) if (c.user_id === partner.id) await api('me', 'DELETE', `/api/contacts/${c.id}`);

  await openContacts();
  const views = await t.evaluate(`[...document.querySelectorAll('nav[aria-label="Contacts"] button[aria-current], nav[aria-label="Contacts"] button')].map(b => b.textContent.trim())`);
  const stats = await t.evaluate(`['Total', 'Employees', 'Customers', 'Vendors', 'Favorites', 'Birthdays'].every(l => document.querySelector('main').innerText.includes(l))`);
  t.check('Contacts opens natively, with the views, stat cards and the directory', ['All contacts', 'Favorites', 'Employees', 'Customers', 'Vendors', 'Archived', 'Company directory'].every((v) => views.some((x) => x.startsWith(v))) && stats, JSON.stringify(views));

  // A group, from the + beside Groups.
  const groupName = `E2E group ${tag}`;
  await t.clickButton('New group');
  await t.fill('Group name', groupName);
  await t.clickButton('Add');
  await t.waitFor(`[...document.querySelectorAll('nav[aria-label="Contacts"] button')].some(b => b.textContent.includes(${js(groupName)}))`, 'the group');
  const group = ((await api('me', 'GET', '/api/contact-groups')).data ?? []).find((g) => g.name === groupName);
  if (group) made.groups.push(group.id);
  t.check('a group is made from the rail, and opens', !!group && (await t.evaluate(`!!document.querySelector('nav[aria-label="Contacts"] button[aria-current="page"]')?.textContent.includes(${js(groupName)})`)));

  // A contact, with every section of the form; made in the group, it starts in it.
  const name = `Dinuka E2E${tag}`;
  await t.evaluate(railClick('All contacts'));
  await t.clickButton('New contact');
  await t.waitFor(`!!document.querySelector('aside[aria-label="New contact"]')`, 'the form');
  await t.fill('First name', 'Dinuka');
  await t.fill('Last name', `E2E${tag}`);
  await t.evaluate(choose('Type', 'customer'));
  await t.fill('Birthday', '1988-10-14');
  await t.fill('Job title', 'Procurement lead');
  await t.fill('Company', 'CreativeFX');
  await t.fill('Work email', `dinuka${tag}@example.test`);
  await t.fill('Mobile', '+94 77 234 5678');
  await t.fill('City', 'Colombo 07');
  await t.evaluate(choose('Country', 'Sri Lanka'));
  await t.fill('Customer ID', `CUS-${tag}`);
  await t.fill('LinkedIn', 'in/dinukaf');
  await t.fill('Labels', 'VIP, Prospect');
  await t.fill('Notes', 'Prefers WhatsApp in the mornings.');
  await t.evaluate(`[...document.querySelectorAll('aside[aria-label="New contact"] button[aria-pressed]')].find(b => b.textContent.trim() === ${js(groupName)}).click()`);
  await t.clickButton('Save');
  await t.waitFor(`!!${drawer} && ${drawer}.innerText.includes(${js(name)})`, 'the new contact open');
  const [c0] = (await mine(`E2E${tag}`)).filter((c) => c.display_name === name);
  if (c0) made.contacts.push(c0.id);
  const d0 = c0 ? await detail(c0.id) : null;
  t.check(
    'a contact saves every section: type, birthday, job, company, email, phone, address, business ID, social, labels, notes and group',
    !!d0 && d0.type === 'customer' && d0.birthday?.startsWith('1988-10-14') && d0.job_title === 'Procurement lead' && d0.company === 'CreativeFX' && d0.work_email === `dinuka${tag}@example.test` && d0.city === 'Colombo 07' && d0.country === 'Sri Lanka' && d0.customer_id === `CUS-${tag}` && d0.social?.linkedin === 'in/dinukaf' && d0.labels.join(',') === 'VIP,Prospect' && d0.notes?.includes('WhatsApp') && d0.groups.some((g) => g.id === group?.id),
    JSON.stringify(d0 && { type: d0.type, birthday: d0.birthday, groups: d0.groups, social: d0.social, labels: d0.labels }),
  );
  const head = await t.evaluate(`${drawer}.innerText`);
  t.check('the drawer shows who they are, the type, labels and details', ['Procurement lead · CreativeFX', 'Customer', 'VIP', 'Work email', 'Mobile', 'Customer ID', '14 October', groupName, 'LinkedIn', 'Prefers WhatsApp'].every((x) => head.includes(x)), head.replace(/\s+/g, ' ').slice(0, 300));
  const acts = await t.evaluate(`['Email', 'Chat', 'Meet', 'Schedule', 'Task'].map(l => { const b = ${drawer}.querySelector('button[aria-label="' + l + '"]'); return !!b && !b.className.includes('text-ink-3'); })`);
  t.check('Email, Meet, Schedule and Task are ready; Chat waits for a linked teammate', js(acts) === js([true, false, true, true, true]), js(acts));

  // Favorite from the drawer; it is in Favorites.
  await t.evaluate(`${drawer}.querySelector('button[aria-label="Add to favorites"]').click()`);
  await t.waitFor(`!!${drawer}.querySelector('button[aria-label="Remove from favorites"]')`, 'the favorite');
  t.check('the star in the drawer makes a favorite', (await detail(c0.id)).is_favorite === true);

  // A note, added with Ctrl+Enter and pinned.
  await t.evaluate(`[...${drawer}.querySelectorAll('[role="tab"]')].find(b => b.textContent.startsWith('Notes')).click()`);
  await t.fill('Add a note', 'Approved the phase-1 quote verbally.');
  await t.evaluate(`document.querySelector('textarea[aria-label="Add a note"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }))`);
  await t.waitFor(`${drawer}.innerText.includes('Approved the phase-1 quote')`, 'the note');
  await t.evaluate(`${drawer}.querySelector('button[aria-label="Pin"]').click()`);
  await t.waitFor(`${drawer}.innerText.includes('Pinned')`, 'the pinned note');
  const notes = (await api('me', 'GET', `/api/contacts/${c0.id}/notes`)).data ?? [];
  const tabCount = await t.evaluate(`[...${drawer}.querySelectorAll('[role="tab"]')].find(b => b.textContent.startsWith('Notes')).textContent.trim()`);
  t.check('a note is added with Ctrl+Enter, pinned, and counted on the tab', notes.length === 1 && notes[0].pinned === true && tabCount === 'Notes1', tabCount);

  // Schedule: Calendar opens a new event named for them, and the timeline says so.
  await t.evaluate(`${drawer}.querySelector('button[aria-label="Schedule"]').click()`);
  const eventTitle = await t
    .waitFor(`document.querySelector('input[aria-label="Event title"]')?.value === ${js(`Meeting with ${name}`)}`, 'the new event', 15_000)
    .then(() => true, () => false);
  await t.clickButton('Cancel');
  let log = await activity(c0.id);
  t.check('Schedule opens a new event with their name, and it is on the timeline', eventTitle && log.some((a) => a.type === 'meeting' && a.title.includes('Opened Calendar')), js(log.map((a) => a.title)));

  // Task: a new task titled for them.
  await openContacts();
  await t.waitFor(`!!${drawer}`, 'the contact again');
  await t.evaluate(`${drawer}.querySelector('button[aria-label="Task"]').click()`);
  const taskTitle = await t
    .waitFor(`[...document.querySelectorAll('label')].some(l => l.textContent.trim().startsWith('Title') && l.querySelector('input')?.value === ${js(`Follow up with ${name}`)})`, 'the new task', 15_000)
    .then(() => true, () => false);
  await t.clickButton('Cancel');
  log = await activity(c0.id);
  t.check('Task opens a new task with their name, and it is on the timeline', taskTitle && log.some((a) => a.type === 'task'), js(log.map((a) => a.title)));

  // The Activity tab shows it.
  await openContacts();
  await t.waitFor(`!!${drawer}`, 'the contact again');
  await t.evaluate(`[...${drawer}.querySelectorAll('[role="tab"]')].find(b => b.textContent.startsWith('Activity')).click()`);
  await t.waitFor(`${drawer}.innerText.includes('Opened Tasks for')`, 'the activity');
  t.check('the Activity tab lists what was done', true);

  // Edit: change the job; the rest (social, group) stays.
  await t.evaluate(`${drawer}.querySelector('button[aria-label="Edit"]').click()`);
  await t.waitFor(`!!document.querySelector('aside[aria-label="Edit contact"]')`, 'the edit form');
  await t.fill('Job title', 'Head of procurement');
  await t.clickButton('Save');
  await t.waitFor(`!!${drawer} && ${drawer}.innerText.includes('Head of procurement')`, 'the edited contact');
  const d1 = await detail(c0.id);
  t.check('an edit saves, and keeps the social link and group', d1.job_title === 'Head of procurement' && d1.social?.linkedin === 'in/dinukaf' && d1.groups.some((g) => g.id === group?.id));

  // Archive: the banner, gone from All, in Archived; Restore brings it back.
  await t.evaluate(`${drawer}.querySelector('button[aria-label="Archive"]').click()`);
  await t.waitFor(`${drawer}.innerText.includes('This contact is archived')`, 'the archived banner');
  await t.evaluate(`${drawer}.querySelector('button[aria-label="Close"]').click()`);
  await t.waitFor(`!${card(name)}`, 'the card gone');
  await t.evaluate(railClick('Archived'));
  await t.waitFor(`!!${card(name)}`, 'the card in Archived');
  t.check('archiving hides the contact from All and lists it in Archived', (await detail(c0.id)).is_archived === true);
  await t.evaluate(`${card(name)}.click()`);
  await t.waitFor(`!!${drawer} && ${drawer}.innerText.includes('This contact is archived')`, 'the archived contact');
  await t.evaluate(`[...${drawer}.querySelectorAll('button')].find(b => b.textContent.trim() === 'Restore').click()`);
  await t.waitFor(`!${drawer}.innerText.includes('This contact is archived')`, 'the restored contact');
  t.check('Restore brings it back', (await detail(c0.id)).is_archived === false);
  await t.evaluate(`${drawer}.querySelector('button[aria-label="Close"]').click()`);

  // Cards and list; search.
  await t.evaluate(railClick('All contacts'));
  await t.waitFor(`!!${card(name)}`, 'the card');
  await t.clickButton('List');
  await t.waitFor(`!!document.querySelector('main [role="table"]') && document.querySelector('main [role="table"]').innerText.includes(${js(`dinuka${tag}@example.test`)})`, 'the list');
  t.check('the list shows the email and phone columns', await t.evaluate(`document.querySelector('main [role="table"]').innerText.includes('+94 77 234 5678')`));
  await t.clickButton('Cards');
  await t.fill('Search contacts', `E2E${tag}`);
  await t.waitFor(`document.querySelectorAll('main [role="list"][aria-label="Contacts"] [role="listitem"]').length === 1`, 'one match');
  await t.fill('Search contacts', `nothing-matches-${tag}`);
  await t.waitFor(t.hasText('No contacts match'), 'no match');
  t.check('search narrows the contacts', true);
  await t.fill('Search contacts', '');

  // The directory: save the partner, then chat with them.
  await t.evaluate(railClick('Company directory'));
  await t.waitFor(`!!document.querySelector('button[aria-label=${js(`Add ${partner.name} to contacts`)}]')`, 'the partner in the directory');
  const me = await t.evaluate(`[...document.querySelectorAll('[role="listitem"]')].some(x => x.innerText.includes('(you)'))`);
  await t.clickButton(`Add ${partner.name} to contacts`);
  await t.waitFor(`[...document.querySelectorAll('[role="listitem"]')].some(x => x.getAttribute('aria-label') === ${js(partner.name)} && x.innerText.includes('Saved'))`, 'the partner saved');
  const pc = ((await api('me', 'GET', '/api/contacts')).data ?? []).find((c) => c.user_id === partner.id);
  if (pc) made.contacts.push(pc.id);
  t.check('a colleague is saved from the directory, linked to them; you are marked (you)', !!pc && pc.type === 'employee' && me);
  await t.evaluate(railClick('Employees'));
  await t.waitFor(`!!${card(partner.name)}`, 'the partner card');
  await t.evaluate(`${card(partner.name)}.click()`);
  await t.waitFor(`!!${drawer} && !${drawer}.querySelector('button[aria-label="Chat"]').className.includes('text-ink-3')`, 'chat ready');
  await t.evaluate(`${drawer}.querySelector('button[aria-label="Chat"]').click()`);
  const chatted = await t
    .waitFor(`[...document.querySelectorAll('[role="tablist"][aria-label="Open tabs"] [role="tab"]')].some(b => b.textContent.trim().startsWith('Chat') && b.getAttribute('aria-selected') === 'true')`, 'Chat in front', 15_000)
    .then(() => true, () => false);
  log = await activity(pc.id);
  t.check('Chat opens the conversation with a linked teammate', chatted && log.some((a) => a.type === 'chat'), js(log.map((a) => a.title)));

  // Import: three rows, one without a name or a real email.
  await openContacts();
  if (await t.evaluate(`!!document.querySelector('[role="dialog"][aria-label^="Contact"]')`)) await t.evaluate(`${drawer}.querySelector('button[aria-label="Close"]').click()`);
  await t.evaluate(railClick('All contacts'));
  const canImport = await t.evaluate(`[...document.querySelectorAll('main button')].some(b => b.textContent.trim() === 'Import')`);
  if (!canImport) t.skip('import', 'this account may not import contacts (contacts.manage)');
  else {
    const csv = ['Display Name,First Name,Last Name,Work Email,Company Name,Type,Labels', `E2E Import One ${tag},One,Import,one${tag}@example.test,Acme,customer,E2E`, `E2E Import Two ${tag},Two,Import,two${tag}@example.test,Acme,vendor,E2E`, ',,,not-an-email,Acme,customer,'].join('\n');
    await t.evaluate(`[...document.querySelectorAll('main button')].find(b => b.textContent.trim() === 'Import').click()`);
    await t.waitFor(t.hasText('Drop a file here'), 'the import dialog');
    await t.evaluate(`(() => { const dt = new DataTransfer(); dt.items.add(new File([${js(csv)}], 'e2e-contacts.csv', { type: 'text/csv' })); document.querySelector('[role="dialog"] .border-dashed').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); return true; })()`);
    await t.waitFor(t.hasText('These are matched already'), 'the column match', 20_000);
    const mapped = await t.evaluate(`['Display Name', 'Work Email', 'Company Name'].map(l => document.querySelector('[role="combobox"][aria-label="' + l + '"]')?.textContent)`);
    t.check('the columns are matched from the header', js(mapped) === js(['Display Name', 'Work Email', 'Company Name']), js(mapped));
    await t.clickButton('Check the file');
    await t.waitFor(t.hasText('will not import'), 'the check', 20_000);
    const check = await t.evaluate(`document.querySelector('[role="dialog"]').innerText`);
    t.check('the check counts the good rows and says what is wrong with the bad one', /2\s*ready/.test(check) && /1\s*will not import/.test(check) && check.includes('Import 2 records'), check.replace(/\s+/g, ' ').slice(0, 300));
    await t.clickButton('Import 2 records');
    await t.waitFor(t.hasText('Import history as job'), 'the result', 30_000);
    const done = await t.evaluate(`document.querySelector('[role="dialog"]').innerText`);
    const imported = (await mine(`E2E Import`)).filter((c) => c.display_name.endsWith(String(tag)));
    for (const c of imported) made.contacts.push(c.id);
    t.check('the import creates the good rows', /2\s*created/.test(done) && imported.length === 2, done.replace(/\s+/g, ' ').slice(0, 200));
    const failedLink = await t.evaluate(`[...document.querySelectorAll('[role="dialog"] button')].find(b => b.textContent.startsWith('Download the'))?.textContent.trim() ?? ''`);
    if (failedLink) {
      await t.evaluate(`[...document.querySelectorAll('[role="dialog"] button')].find(b => b.textContent.startsWith('Download the')).click()`);
      const got = await t
        .waitFor(`window.worksuite.transfers.list().then(l => Array.isArray(l) && l.some(x => /contacts-import-\\d+-errors\\.csv/.test(x.name) && x.state === 'done'))`, 'the failed rows', 30_000)
        .then(() => true, () => false);
      t.check('the rows that did not import download as a file', got, failedLink);
    } else t.check('the rows that did not import can be downloaded', false, done.replace(/\s+/g, ' ').slice(0, 200));
    await t.clickButton('Close');
    await t.waitFor(`!!${card(`E2E Import One ${tag}`)}`, 'the imported contacts in the list');
    t.check('the list shows imported contacts at once', true);
  }

  // Export as CSV.
  await t.evaluate(`[...document.querySelectorAll('main button')].find(b => b.textContent.trim().startsWith('Export')).click()`);
  await t.evaluate(`[...document.querySelectorAll('[role="menu"][aria-label="Export"] button')].find(b => b.textContent.includes('CSV')).click()`);
  const exported = await t
    .waitFor(`window.worksuite.transfers.list().then(l => Array.isArray(l) && l.some(x => x.name === 'worksuite-contacts.csv' && x.state === 'done'))`, 'the export', 30_000)
    .then(() => true, () => false);
  t.check('Export saves your contacts as CSV to the downloads', exported);

  // Delete the contact, then the group (its contacts stay).
  await t.evaluate(`${card(name)}.click()`);
  await t.waitFor(`!!${drawer}`, 'the contact');
  await t.evaluate(`${drawer}.querySelector('button[aria-label="Delete"]').click()`);
  await t.waitFor(t.hasText(`Delete ${name}?`), 'the confirmation');
  await t.evaluate(`[...document.querySelectorAll('[role="dialog"][aria-modal="true"] button')].find(b => b.textContent.trim() === 'Delete').click()`);
  await t.waitFor(`!${drawer} && !${card(name)}`, 'the contact gone');
  t.check('Delete removes the contact', (await api('me', 'GET', `/api/contacts/${c0.id}`)).status === 404);
  await t.evaluate(railClick(groupName));
  await t.waitFor(`!!document.querySelector('button[aria-label=${js(`Delete group ${groupName}`)}]')`, 'the group open');
  await t.clickButton(`Delete group ${groupName}`);
  await t.waitFor(t.hasText('Contacts are kept.'), 'the confirmation');
  await t.evaluate(`[...document.querySelectorAll('[role="dialog"][aria-modal="true"] button')].find(b => b.textContent.trim() === 'Delete').click()`);
  await t.waitFor(`![...document.querySelectorAll('nav[aria-label="Contacts"] button')].some(b => b.textContent.includes(${js(groupName)}))`, 'the group gone');
  t.check('a group is deleted from the rail', !((await api('me', 'GET', '/api/contact-groups')).data ?? []).some((g) => g.id === group?.id));
  await sleep(300);
} catch (e) {
  t.check('contacts run', false, e.message);
  try {
    await t.shot('cz-failure');
  } catch {
    /* no page */
  }
} finally {
  for (const id of made.contacts) await api('me', 'DELETE', `/api/contacts/${id}`).catch(() => undefined);
  for (const id of made.groups) await api('me', 'DELETE', `/api/contact-groups/${id}`).catch(() => undefined);
  await t.finish();
}

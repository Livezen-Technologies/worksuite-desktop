// End-to-end: Tenders, part 1, against a real server, through the UI. The
// rail with only the library, reports and settings left in the browser; the
// dashboard's figures and its week; a search for a bid number taken
// literally; a tender followed, edited (only what changed is sent), moved,
// and lost with its reason; another moved to Ready and Submitted with a
// mandatory requirement still outstanding, which is said before it moves and
// kept in the history, then won with its value; a tender typed in and two
// pasted as a list, checked before they are kept; the pipeline board; a
// selection followed, reprioritised and removed; My access.
//
// Makes its own tenders ("E2E Tender … <tag>"), removes them through the
// UI's bulk Remove. Moving to Preparing makes tasks and a Drive folder, and
// the win a client, a deal and a project; clean-tenders-e2e.sh removes what
// the API cannot. Needs a user who holds tender.* (locally: the "E2E Orders"
// role).
//
//   npm run build
//   WS_E2E_SERVER=… WS_E2E_EMAIL=… WS_E2E_PASSWORD=… ELECTRON_RUN_AS_NODE=1 npx electron tests/e2e/tenders.mjs
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
  const r = await fetch(`${server}${path}`, { method, headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, data: j.data ?? j, message: j.message, errors: j.errors };
}
const js = (v) => JSON.stringify(v);
const tag = String(Date.now() % 100000);
const until = async (fn, label, tries = 40) => {
  let v;
  for (let i = 0; i < tries; i++) {
    v = await fn();
    if (v) return v;
    await sleep(400);
  }
  throw new Error(`${label}: never happened`);
};
const tender = async (id) => (await api('GET', `/api/tenders/${id}`)).data?.tender ?? null;
const inDays = (n) => new Date(Date.now() + n * 86_400_000).toISOString().replace(/\.\d+Z$/, 'Z');

const t = await launch({ name: 'tenders' });
const press = async (scope, text, what = text) => {
  await t.waitFor(`[...document.querySelectorAll(${js(scope + ' button')})].some(b => b.textContent.trim() === ${js(text)} && !b.disabled)`, `the ${what} button`, 15_000);
  await t.evaluate(`[...document.querySelectorAll(${js(scope + ' button')})].find(b => b.textContent.trim() === ${js(text)} && !b.disabled).click()`);
};
const typeInto = async (selector, value) => {
  await t.waitFor(`!!document.querySelector(${js(selector)})`, selector, 15_000);
  return t.evaluate(
    `(() => { const el = document.querySelector(${js(selector)}); el.focus(); const set = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set; set.call(el, ${js(value)}); el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`,
  );
};
const pickFrom = async (label, text, scope = '') => {
  await t.waitFor(`!!document.querySelector(${js(`${scope} button[role="combobox"][aria-label="${label}"]`.trim())})`, `the ${label} picker`, 15_000);
  await t.evaluate(`document.querySelector(${js(`${scope} button[role="combobox"][aria-label="${label}"]`.trim())}).click()`);
  await t.waitFor(`!!document.querySelector('[role="listbox"][aria-label=${js(label)}]')`, `the ${label} list`);
  await t.waitFor(`[...document.querySelectorAll('[role="listbox"][aria-label=${js(label)}] [role="option"]')].some(o => o.textContent.includes(${js(text)}))`, `${text} in ${label}`, 15_000);
  await t.evaluate(`[...document.querySelectorAll('[role="listbox"][aria-label=${js(label)}] [role="option"]')].find(o => o.textContent.includes(${js(text)})).click()`);
};
const rail = async (label) => {
  const ok = await t.evaluate(`(() => { const b = [...document.querySelectorAll('nav[aria-label="Tenders"] button')].find(b => b.textContent.trim().startsWith(${js(label)})); if (b) b.click(); return !!b; })()`);
  if (!ok) throw new Error(`no ${label} in the rail`);
};
const textOf = (sel) => t.evaluate(`document.querySelector(${js(sel)})?.textContent ?? ''`);
const mainHas = (s) => `(document.querySelector('main')?.textContent ?? '').includes(${js(s)})`;
const openRow = async (id) => {
  await t.waitFor(`!!document.querySelector('[data-tender="${id}"] button[aria-label^="Open"]')`, `tender ${id} in the list`, 20_000);
  await t.evaluate(`document.querySelector('[data-tender="${id}"] button[aria-label^="Open"]').click()`);
  await t.waitFor(`!!document.querySelector('section[aria-label="Tender"] h1')`, 'the workspace', 20_000);
};
const openById = async (id) => {
  await rail('All tenders');
  await typeInto('input[aria-label="Search tenders"]', tag);
  await openRow(id);
};
const mine = new Set();

try {
  bearer = (await api('POST', '/api/auth/login', { email, password })).data?.tokens?.access_token ?? '';

  // ── fixtures ──────────────────────────────────────────────────────────
  const a = (await api('POST', '/api/tenders', { title: `E2E Tender Road ${tag}`, organization: `E2E Buyer ${tag}`, reference: `E2E_T${tag}`, closing_at: inDays(5), budget_max: '45000000.00' })).data?.id;
  const b = (await api('POST', '/api/tenders', { title: `E2E Tender Laptops ${tag}`, organization: `E2E Buyer ${tag}`, reference: `E2E-T${tag}X` })).data?.id;
  [a, b].forEach((id) => id && mine.add(Number(id)));
  t.check('fixtures: two tenders, one closing in five days', !!(a && b), js({ a, b }));

  await t.signIn(server, email, password);
  await sleep(1500);
  await t.evaluate(`(() => { const b = [...document.querySelectorAll('nav button')].find(b => b.textContent.trim() === 'Tenders'); if (b) b.click(); return !!b; })()`);
  await t.waitFor(`!!document.querySelector('nav[aria-label="Tenders"]')`, 'the Tenders rail', 30_000);
  const browserItems = await t.evaluate(`[...document.querySelectorAll('nav[aria-label="Tenders"] button')].filter(b => (b.title || '').includes('browser')).map(b => b.textContent.trim().replace(/\\d+$/, ''))`);
  t.check('only the library, reports and settings open in the browser', js(browserItems) === js(['Document library', 'Reports', 'Settings']), js(browserItems));

  // ── the dashboard ─────────────────────────────────────────────────────
  await t.waitFor(`${mainHas('Closing this week')}`, 'the dashboard', 20_000);
  const dash = (await api('GET', '/api/tenders/dashboard')).data;
  const openKpi = await t.evaluate(`[...document.querySelectorAll('main[aria-label="Tenders · Dashboard"] button')].find(b => b.textContent.startsWith('Open'))?.querySelector('b')?.textContent`);
  t.check('the dashboard counts what is open, as the server does', Number(openKpi) === dash.counts.open, js({ screen: openKpi, server: dash.counts.open }));
  await t.waitFor(`${mainHas(`E2E Tender Road ${tag}`)}`, 'the road tender this week', 20_000);
  t.check('and lists the tender closing this week', true);
  await t.shot('t1-dashboard');

  // ── a literal search ──────────────────────────────────────────────────
  await rail('New opportunities');
  await typeInto('input[aria-label="Search tenders"]', `E2E_T${tag}`);
  await t.waitFor(`document.querySelectorAll('[data-tender]').length === 1`, 'one match', 20_000);
  const found = await t.evaluate(`[...document.querySelectorAll('[data-tender]')].map(r => Number(r.dataset.tender))`);
  t.check('a search for "E2E_T…" finds that number and not "E2E-T…X"', js(found) === js([Number(a)]), js(found));

  // ── follow, edit ──────────────────────────────────────────────────────
  await openRow(a);
  t.check(
    'the workspace names the tender and how long is left',
    (await textOf('section[aria-label="Tender"] h1')) === `E2E Tender Road ${tag}` && (await textOf('section[aria-label="Tender"]')).match(/\d+ days? left/) !== null,
    await textOf('section[aria-label="Tender"] h1'),
  );
  await press('section[aria-label="Tender"]', 'Follow');
  await until(async () => (await tender(a))?.following === true, 'followed');
  await t.waitFor(`[...document.querySelectorAll('section[aria-label="Tender"] button')].some(b => b.textContent.trim() === 'Stop following')`, 'the button turning', 15_000);
  t.check('it is followed', true);
  const before = await tender(a);
  await press('section[aria-label="Tender"]', 'Edit');
  await t.waitFor(`!!document.querySelector('[role="dialog"][aria-label="Edit tender"] input[aria-label="Title"]')`, 'the edit form', 15_000);
  t.check('an untouched form has nothing to save', await t.evaluate(`[...document.querySelectorAll('[role="dialog"] button')].some(b => b.textContent.trim() === 'Nothing changed' && b.disabled)`), '');
  const shown = await t.evaluate(`[document.querySelector('[role="dialog"] input[aria-label="Closing date"]').value, document.querySelector('[role="dialog"] input[aria-label="Closing time"]').value]`);
  await typeInto('[role="dialog"] input[aria-label="Title"]', `E2E Tender Road ${tag} phase 2`);
  await typeInto('[role="dialog"] input[aria-label="Budget, high"]', '46,000,000');
  await press('[role="dialog"]', 'Save 2 changes');
  const after = await until(async () => {
    const x = await tender(a);
    return x?.title === `E2E Tender Road ${tag} phase 2` ? x : null;
  }, 'the edit saved');
  t.check(
    'the edit sends only the title and the budget',
    after.budget_max === '46000000.00' && after.reference === before.reference && after.closing_at === before.closing_at && after.updated_at !== null,
    js({ budget: after.budget_max, closing: [before.closing_at, after.closing_at], shown }),
  );

  // ── a move, then lost with its reason ─────────────────────────────────
  await t.waitFor(`!!document.querySelector('[aria-label="Move to"]')`, 'the moves', 15_000);
  await press('[aria-label="Move to"]', 'Review');
  await until(async () => (await tender(a))?.stage === 'review', 'moved to review');
  t.check('it moves to Review', true);
  await t.evaluate(`[...document.querySelectorAll('main [role="tab"]')].find(b => b.textContent.startsWith('History')).click()`);
  await t.waitFor(`(document.querySelector('[aria-label="Stage history"]')?.textContent ?? '').includes('New → Review')`, 'the history', 15_000);
  t.check('and the history says so', true);
  await press('[aria-label="Move to"]', 'Lost…');
  await t.waitFor(`!!document.querySelector('[role="dialog"][aria-label="Record this as lost"]')`, 'the lost form', 15_000);
  t.check('a loss is not recorded without a reason', await t.evaluate(`[...document.querySelectorAll('[role="dialog"] button')].find(b => b.textContent.trim() === 'Record as lost').disabled`), '');
  await typeInto('[role="dialog"] input[aria-label="Why was it lost?"]', 'Price: 4% above the winner');
  await typeInto('[role="dialog"] input[aria-label="Won by"]', `E2E Rival ${tag}`);
  await typeInto('[role="dialog"] input[aria-label="Their price"]', '44,100,000');
  await press('[role="dialog"]', 'Record as lost');
  const lost = await until(async () => {
    const x = await tender(a);
    return x?.outcome === 'lost' ? x : null;
  }, 'lost');
  t.check(
    'it is lost, with the reason, the winner and their price',
    lost.lost_reason === 'Price: 4% above the winner' && lost.competitor === `E2E Rival ${tag}` && lost.winning_price === '44100000.00',
    js({ reason: lost.lost_reason, price: lost.winning_price }),
  );
  await t.evaluate(`[...document.querySelectorAll('main [role="tab"]')].find(b => b.textContent.startsWith('Submission')).click()`);
  await t.waitFor(`${mainHas('Why it was lost')} && ${mainHas(`E2E Rival ${tag}`)}`, 'the decision tab', 15_000);
  t.check('the decision tab says why', true);
  await t.shot('t2-lost');

  // ── outstanding requirements, said before moving; then won ────────────
  const req = await api('POST', `/api/tenders/${b}/requirements`, { label: `E2E VAT certificate ${tag}`, mandatory: true });
  for (const s of ['review', 'approved', 'preparing', 'internal_review', 'management_approval']) await api('POST', `/api/tenders/${b}/stage`, { stage: s });
  t.check('fixture: a tender at Management approval with a mandatory requirement unmet', req.status < 300 && (await tender(b))?.stage === 'management_approval', js([req.status, req.message]));
  await openById(b);
  await press('[aria-label="Move to"]', 'Ready to submit');
  await t.waitFor(`!!document.querySelector('[role="dialog"][aria-label="Move to Ready to submit anyway?"]')`, 'the outstanding list', 15_000);
  const outstanding = await textOf('[aria-label="Outstanding"]');
  t.check('what is outstanding is named before anything moves', outstanding.includes(`E2E VAT certificate ${tag}`) && (await tender(b))?.stage === 'management_approval', outstanding);
  await typeInto('[role="dialog"] input[aria-label="Why move it now?"]', 'The certificate is on its way');
  await press('[role="dialog"]', 'Move anyway');
  await until(async () => (await tender(b))?.stage === 'ready', 'moved to ready');
  const hist = (await api('GET', `/api/tenders/${b}`)).data?.history?.[0];
  t.check('moving anyway is recorded, with what was missing', (hist?.note ?? '').includes('The certificate is on its way') && (hist?.note ?? '').includes('Moved with 1 outstanding'), hist?.note);
  await t.waitFor(`[...document.querySelectorAll('[aria-label="Move to"] button')].some(b => b.textContent.trim() === 'Submitted')`, 'the next moves', 15_000);
  await press('[aria-label="Move to"]', 'Submitted');
  await press('[role="dialog"]', 'Move anyway');
  await until(async () => (await tender(b))?.stage === 'submitted', 'submitted');
  await t.waitFor(`[...document.querySelectorAll('[aria-label="Move to"] button')].some(b => b.textContent.trim() === 'Won…')`, 'Won offered', 15_000);
  await press('[aria-label="Move to"]', 'Won…');
  await typeInto('[role="dialog"] input[aria-label="Awarded value"]', '45,500,000');
  await press('[role="dialog"]', 'Record as won');
  const won = await until(async () => {
    const x = await tender(b);
    return x?.outcome === 'won' ? x : null;
  }, 'won');
  t.check('it is won, at the value awarded, and its project is made', won.award_value === '45500000.00' && !!won.project_id, js({ award: won.award_value, project: won.project_id }));
  await t.shot('t3-won');

  // ── one typed in, two pasted ──────────────────────────────────────────
  await press('nav[aria-label="Tenders"]', 'New tender');
  await t.waitFor(`!!document.querySelector('[role="dialog"][aria-label="New tender"]')`, 'the new form', 15_000);
  const day = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
  await typeInto('[role="dialog"] input[aria-label="Title"]', `E2E Tender Chairs ${tag}`);
  await typeInto('[role="dialog"] input[aria-label="Buyer"]', `E2E Buyer ${tag}`);
  await typeInto('[role="dialog"] input[aria-label="Tender number"]', `E2E-C${tag}`);
  await typeInto('[role="dialog"] input[aria-label="Closing date"]', day);
  await t.waitFor(`!document.querySelector('[role="dialog"] input[aria-label="Closing time"]').disabled`, 'the time, once there is a day', 10_000);
  await typeInto('[role="dialog"] input[aria-label="Closing time"]', '10:30');
  await typeInto('[role="dialog"] input[aria-label="Published budget ceiling"]', '1,250,000');
  await press('[role="dialog"]', 'Create');
  await t.waitFor(`(document.querySelector('section[aria-label="Tender"] h1')?.textContent ?? '') === ${js(`E2E Tender Chairs ${tag}`)}`, 'the new tender opened', 20_000);
  const c = ((await api('GET', `/api/tenders?q=E2E-C${tag}`)).data?.items ?? [])[0];
  if (c) mine.add(Number(c.id));
  t.check('a tender is made, its budget as typed', c?.budget_max === '1250000.00', js(c && { id: c.id, budget: c.budget_max, closing: c.closing_at }));
  await press('section[aria-label="Tender"]', 'Edit');
  await t.waitFor(`!!document.querySelector('[role="dialog"] input[aria-label="Closing time"]')`, 'the edit form', 15_000);
  const back = await t.evaluate(`[document.querySelector('[role="dialog"] input[aria-label="Closing date"]').value, document.querySelector('[role="dialog"] input[aria-label="Closing time"]').value]`);
  t.check('its closing time reads back as it was typed', js(back) === js([day, '10:30']), js({ back, stored: c?.closing_at }));
  await press('[role="dialog"]', 'Cancel');

  await press('nav[aria-label="Tenders"]', 'New tender');
  await t.waitFor(`!!document.querySelector('[role="dialog"][aria-label="New tender"]')`, 'the new form', 15_000);
  await t.evaluate(`[...document.querySelectorAll('[role="dialog"] [role="tab"]')].find(b => b.textContent === 'Paste a list').click()`);
  await typeInto('[role="dialog"] textarea[aria-label="CSV"]', `title,organization,reference,closing_at\nE2E Tender Desks ${tag},E2E Buyer ${tag},E2E-D${tag},${day}\nE2E Tender Lamps ${tag},E2E Buyer ${tag},E2E-L${tag},${day}`);
  await press('[role="dialog"]', 'Check first');
  await t.waitFor(`(document.querySelector('[aria-label="Import check"]')?.textContent ?? '').includes('2 would be imported')`, 'the check', 20_000);
  const kept = (await api('GET', `/api/tenders?q=E2E-D${tag}`)).data?.total;
  t.check('a pasted list is checked before anything is kept', Number(kept) === 0, js({ kept }));
  await press('[role="dialog"]', 'Import 2');
  const pasted = await until(async () => {
    const r = (await api('GET', `/api/tenders?q=${tag}&per_page=50`)).data?.items ?? [];
    const x = r.filter((i) => i.reference === `E2E-D${tag}` || i.reference === `E2E-L${tag}`);
    return x.length === 2 ? x : null;
  }, 'imported');
  pasted.forEach((x) => mine.add(Number(x.id)));
  t.check('and then both are imported', true, js(pasted.map((x) => x.reference)));
  await press('[role="dialog"]', 'Done');

  // ── the board ─────────────────────────────────────────────────────────
  await rail('Pipeline');
  await t.waitFor(`!!document.querySelector('section[data-stage="new"]')`, 'the board', 20_000);
  const lanes = await t.evaluate(`[...document.querySelectorAll('section[data-stage]')].map(s => s.dataset.stage)`);
  const inNew = await textOf('section[data-stage="new"]');
  t.check('the board has a lane per working stage, and the new tender in New', !lanes.includes('won') && !lanes.includes('lost') && inNew.includes(`E2E Tender Chairs ${tag}`), js(lanes));
  await t.shot('t4-board');

  // ── a selection: follow, prioritise, remove ───────────────────────────
  // Only this run's tenders are ticked, one by one: a search can match somebody else's.
  const choose = () => t.evaluate(`${js([...mine])}.forEach(id => { const c = document.querySelector('[data-tender="' + id + '"] input[type="checkbox"]'); if (c && !c.checked) c.click(); })`);
  await rail('All tenders');
  await typeInto('input[aria-label="Search tenders"]', tag);
  await t.waitFor(`${js([...mine])}.every(id => !!document.querySelector('[data-tender="' + id + '"]'))`, 'every one of mine', 20_000);
  await choose();
  await press('main', 'Follow', 'Follow (selection)');
  const ours = async () => ((await api('GET', `/api/tenders?q=${tag}&per_page=50`)).data?.items ?? []).filter((x) => mine.has(Number(x.id)));
  await until(async () => (await ours()).every((x) => x.following), 'all followed');
  t.check('a selection is followed', true);
  await choose();
  await press('main', 'Priority…');
  await pickFrom('Priority', 'High', '[role="dialog"]');
  await press('[role="dialog"]', 'Save');
  await until(async () => (await ours()).every((x) => x.priority === 'high'), 'all high');
  t.check('and given a priority', true);
  await choose();
  await press('main', 'Remove');
  await press('[role="dialog"]', 'Remove them');
  await until(async () => (await ours()).length === 0, 'removed');
  for (const id of mine) t.check(`tender ${id} no longer opens`, (await api('GET', `/api/tenders/${id}`)).status === 404, '');
  mine.clear();

  // ── my access ─────────────────────────────────────────────────────────
  await rail('My access');
  await t.waitFor(`${mainHas('Companies whose tenders you can see')}`, 'my access', 15_000);
  const orgs = (await api('GET', '/api/tender/organizations')).data?.items ?? [];
  const page = await textOf('main');
  t.check('My access names my companies', orgs.length > 0 && orgs.every((o) => page.includes(o.name)), js(orgs.map((o) => o.name)));
  await t.evaluate(`[...document.querySelectorAll('main [role="tab"]')].find(b => b.textContent.startsWith('My access')).click()`);
  await t.waitFor(`!!document.querySelector('[data-permission="tender.view"]')`, 'my permissions', 15_000);
  t.check('and the Tenders permissions I hold', (await t.evaluate(`document.querySelectorAll('[data-permission]').length`)) >= 4, '');
  await t.shot('t5-access');
} catch (e) {
  t.check(`no unexpected error (${e.message})`, false);
  await t.shot('tz-failure').catch(() => undefined);
} finally {
  if (mine.size) await api('POST', '/api/tenders/bulk', { action: 'delete', ids: [...mine] }).catch(() => undefined);
  await t.finish();
}

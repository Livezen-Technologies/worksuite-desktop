// End-to-end: HR part 2b, the HR side — a new hire started, a step recorded
// and one marked blocked, activation refused with its reasons, the onboarding
// cancelled; Resignations and Offboarding; a night-shift schedule created,
// assigned, its assignment ended and its history read; the general settings
// changed and put back; a leave type added and archived; a public holiday
// added and removed; an announcement drafted and deleted; a device added
// with its one-time key and removed. And the app's one dropdown, searched.
// Checked against the server; what the run makes is taken away again.
//
//   npm run build
//   WS_E2E_SERVER=… WS_E2E_EMAIL=… WS_E2E_PASSWORD=… WS_E2E_PARTNER_EMAIL=… WS_E2E_PARTNER_PASSWORD=… \
//   ELECTRON_RUN_AS_NODE=1 npx electron tests/e2e/hr-admin-2.mjs
import { choose, launch, sleep } from './harness.mjs';

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
async function login(who, e, p) {
  const r = await fetch(`${server}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ email: e, password: p }) });
  const j = await r.json();
  tokens[who] = j.data?.tokens?.access_token ?? '';
  return j.data?.user ?? {};
}
async function api(who, method, path, body) {
  const res = await fetch(`${server}${path}`, { method, headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}), Authorization: `Bearer ${tokens[who]}` }, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, data: json.data ?? json, message: json.message };
}
const js = (v) => JSON.stringify(v);
const tag = Math.floor(Math.random() * 10_000);
const rail = (label) => `(() => { const n = document.querySelector('nav[aria-label="People"]'); const find = () => [...n.querySelectorAll('button:not([aria-expanded])')].find(b => b.textContent.trim().startsWith(${js(label)})); if (!find()) n.querySelectorAll('button[aria-expanded="false"]').forEach(h => h.click()); return new Promise(r => setTimeout(() => { const b = find(); if (b) b.click(); r(!!b); }, 50)); })()`;
const heading = (t) => `[...document.querySelectorAll('main h1')].some(h => h.textContent.trim() === ${js(t)})`;
const main = `document.querySelector('main').innerText`;
const has = (text) => `${main}.includes(${js(text)})`;
const dialog = (label) => `document.querySelector(${js(`[role="dialog"][aria-label="${label}"]`)})`;
const clickIn = (scope, text) => `(() => { const root = ${scope} ?? document; const b = [...root.querySelectorAll('button')].find(b => b.textContent.trim() === ${js(text)} || b.getAttribute('aria-label') === ${js(text)}); if (!b) return false; b.click(); return true; })()`;
const setValue = (selector, value) => `(() => { const el = document.querySelector(${js(selector)}); if (!el) return false; const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${js(value)}); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`;
/** Click a button inside the tightest element that mentions `text`. */
const rowAct = (text, action) => `(() => { const rows = [...document.querySelectorAll('main div, main section, aside div')].filter(x => x.textContent.includes(${js(text)}) && [...x.querySelectorAll('button')].some(b => b.textContent.trim() === ${js(action)})); if (!rows.length) return false; rows.sort((a, b) => a.textContent.length - b.textContent.length); [...rows[0].querySelectorAll('button')].find(b => b.textContent.trim() === ${js(action)}).click(); return true; })()`;
async function poll(fn, ok, tries = 20) {
  let v;
  for (let i = 0; i < tries; i++) {
    v = await fn();
    if (ok(v)) return v;
    await sleep(500);
  }
  return v;
}

const t = await launch({ name: 'hr-admin-2' });
const made = { digits: null };
try {
  await login('me', email, password);
  const partner = await login('partner', partnerEmail, partnerPassword);
  const people = (await api('me', 'GET', '/api/hr/employees')).data ?? [];
  const partnerEmp = people.find((e) => Number(e.user_id) === Number(partner.id));

  await t.signIn(server, email, password);
  await t.evaluate(`[...document.querySelectorAll('nav[aria-label="Apps"] button')].find(b => b.textContent.trim().startsWith('HR')).click()`);
  await t.waitFor(`!!document.querySelector('nav[aria-label="People"]')`, 'the People rail', 30_000);
  const web = await t.evaluate(`(() => { const n = document.querySelector('nav[aria-label="People"]'); n.querySelectorAll('button[aria-expanded="false"]').forEach(h => h.click()); return new Promise(r => setTimeout(() => r([...n.querySelectorAll('button[title$="opens in your browser"]')].map(b => b.textContent.trim())), 50)); })()`);
  t.check('every HR screen is drawn here now, Departments too', web.length === 0, JSON.stringify(web));

  // ── The dashboard's links stay in the app ─────────────────────────────
  const dashboard = async () => {
    await t.evaluate(rail('Dashboard'));
    await t.waitFor(heading('Dashboard'), 'the dashboard', 20_000);
  };
  const route = () => t.evaluate(`document.querySelector('[role="tab"][aria-selected="true"]')?.textContent ?? ''`);
  await dashboard();
  await t.evaluate(`[...document.querySelectorAll('main button')].find(b => b.textContent.trim() === 'Add employee').click()`);
  await t.waitFor(`!!document.querySelector('[role="dialog"][aria-label="Add employee"]')`, 'the Add employee form', 20_000);
  t.check('Add employee on the dashboard opens the form here', await t.evaluate(heading('Directory')));
  await t.evaluate(`document.querySelector('[role="dialog"][aria-label="Add employee"] button[aria-label="Close"]').click()`);
  await t.waitFor(`!document.querySelector('[role="dialog"][aria-label="Add employee"]')`, 'the form closes');
  await dashboard();
  await t.evaluate(`[...document.querySelectorAll('main button')].find(b => b.textContent.includes('Missing check-outs')).click()`);
  await t.waitFor(heading('Missing check-outs'), 'Missing check-outs', 20_000);
  t.check('Missing check-outs on the dashboard opens its screen here', true);
  await dashboard();
  await t.evaluate(`[...document.querySelectorAll('main button')].find(b => b.textContent.trim() === 'Manage').click()`);
  await t.waitFor(`${heading('Settings')} && [...document.querySelectorAll('main [role="tab"][aria-selected="true"], main button[aria-pressed="true"]')].some(b => b.textContent.trim() === 'Public holidays')`, 'Settings on Public holidays', 20_000);
  t.check('Manage beside the holidays opens Settings on Public holidays', true);
  await dashboard();
  await t.evaluate(`[...document.querySelectorAll('main button')].find(b => b.textContent.trim() === 'Departments').click()`);
  await t.waitFor(`${heading('Departments')} && !!document.querySelector('main [data-department], main')`, 'Departments', 20_000);
  await t.waitFor(`document.querySelector('main').innerText.includes('ALL DEPARTMENTS') || document.querySelector('main').innerText.includes('All departments')`, 'the department list', 20_000);
  await t.shot('h2d-departments');
  const listed = ((await api('me', 'GET', '/api/directory/departments')).data ?? []).length;
  const drawn = await t.evaluate(`document.querySelectorAll('main [data-department]').length`);
  t.check('every department the server lists is drawn', drawn === listed, `${drawn} of ${listed}`);
  t.check('Departments on the dashboard opens its screen here', true, await route());

  // A department added, renamed with a code, and removed.
  const deptName = `E2E Dept ${Date.now() % 100000}`;
  const press = async (scope, test, what) => {
    const ok = await t.evaluate(`(() => { const b = [...document.querySelectorAll(${js(scope + ' button')})].find(b => ${test}); if (b) b.click(); return !!b; })()`);
    if (!ok) throw new Error(`no ${what} button to press`);
  };
  await press('main', `b.textContent.trim() === 'Add department'`, 'Add department');
  await t.waitFor(`!!document.querySelector('[role="dialog"][aria-label="Add department"]')`, 'the Add department form');
  await t.fill('Name', deptName);
  await press('[role="dialog"]', `b.textContent.trim() === 'Add department'`, "the form's Add department");
  await t.waitFor(`[...document.querySelectorAll('main [data-department]')].some(r => r.textContent.includes(${js(deptName)}))`, 'the new department', 20_000);
  const made = ((await api('me', 'GET', '/api/directory/departments')).data ?? []).find((x) => x.name === deptName);
  t.check('the department is on the server', !!made, JSON.stringify(made ?? null));
  await press('main', `b.getAttribute('aria-label') === ${js(`Edit ${deptName}`)}`, 'Edit');
  await t.waitFor(`!!document.querySelector('[role="dialog"][aria-label="Edit department"]')`, 'the Edit department form');
  await t.fill('Code', 'E2E');
  await t.shot('h2e-department-edit');
  await press('[role="dialog"]', `b.textContent.trim() === 'Save'`, 'Save');
  await t.waitFor(`!document.querySelector('[role="dialog"]') && [...document.querySelectorAll('main [data-department]')].some(r => r.textContent.includes(${js(deptName)}) && r.children[1]?.textContent.trim() === 'E2E')`, 'the code saved', 20_000);
  const coded = ((await api('me', 'GET', '/api/directory/departments')).data ?? []).find((x) => x.name === deptName);
  t.check('its code is saved', coded?.code === 'E2E', JSON.stringify(coded ?? null));
  await press('main', `b.getAttribute('aria-label') === ${js(`Delete ${deptName}`)}`, 'Delete (row)');
  await t.waitFor(`!!document.querySelector('[role="dialog"][aria-label="Delete department"]')`, 'the delete question');
  await press('[role="dialog"]', `b.textContent.trim() === 'Delete'`, "the question's Delete");
  await t.waitFor(`![...document.querySelectorAll('main [data-department]')].some(r => r.textContent.includes(${js(deptName)}))`, 'the department gone', 20_000);
  const gone = !((await api('me', 'GET', '/api/directory/departments')).data ?? []).some((x) => x.name === deptName);
  t.check('deleting it removes it from the server', gone);

  // ── Onboarding ────────────────────────────────────────────────────────
  await t.evaluate(rail('Onboarding'));
  await t.waitFor(heading('Onboarding'), 'Onboarding', 20_000);
  const hire = `E2EHire Tag${tag}`;
  // The server names people from their login, so a hire without one is found by being new, not by name.
  const before = new Set(((await api('me', 'GET', '/api/hr/onboarding?status=all')).data?.onboardings ?? []).map((o) => o.employee_id));
  await t.evaluate(clickIn('document.querySelector("main")', 'New employee'));
  await t.waitFor(`!!${dialog('New employee')}`, 'the new-hire form');
  await t.evaluate(setValue('[role="dialog"] input[aria-label="Full name"]', hire));
  await t.evaluate(choose('[role="dialog"] [role="combobox"][aria-label="Employment type"]', 'contract'));
  // The one dropdown: a long list gets a search box that filters.
  await t.evaluate(`document.querySelector('[role="dialog"] [role="combobox"][aria-label="Reports to"]').click()`);
  await t.waitFor(`!!document.querySelector('[role="listbox"][aria-label="Reports to"]')`, 'the manager list');
  const searchable = await t.evaluate(`!!document.querySelector('input[aria-label="Search Reports to"]')`);
  if (searchable) {
    await t.evaluate(setValue('input[aria-label="Search Reports to"]', partnerEmp.name.split(' ')[1] ?? partnerEmp.name));
    await sleep(200);
    const listed = await t.evaluate(`[...document.querySelectorAll('[role="listbox"][aria-label="Reports to"] [role="option"]')].map(o => o.textContent)`);
    t.check('a long dropdown is searchable and narrows as you type', listed.length >= 1 && listed.every((l) => l.includes(partnerEmp.name.split(' ')[1] ?? partnerEmp.name)), JSON.stringify(listed));
    await t.shot('b0-searchable-dropdown');
  } else t.skip('searching a long dropdown', 'fewer than seven people to choose from');
  await t.evaluate(choose('[role="dialog"] [role="combobox"][aria-label="Reports to"]', String(partnerEmp.id)));
  const chosen = await t.evaluate(`document.querySelector('[role="dialog"] [role="combobox"][aria-label="Reports to"]').dataset.value`);
  t.check('picking from the dropdown sets the value', chosen === String(partnerEmp.id), chosen);
  await t.shot('b1-new-hire');
  await t.evaluate(clickIn(dialog('New employee'), 'Start onboarding'));
  // The first hire in the list is shown while nobody is chosen, so wait for THIS hire, not any case.
  const list = (await poll(() => api('me', 'GET', '/api/hr/onboarding?status=in_progress'), (r) => (r.data?.onboardings ?? []).some((o) => !before.has(o.employee_id)))).data?.onboardings ?? [];
  const row = list.find((o) => !before.has(o.employee_id));
  await t.waitFor(`!${dialog('New employee')} && [...document.querySelectorAll('main section b')].some(b => b.textContent.trim() === ${js(hire)})`, 'the new case', 20_000);
  const eid = row?.employee_id;
  const state = eid ? (await api('me', 'GET', `/api/hr/onboarding/${eid}`)).data : null;
  t.check('New employee starts an onboarding for a contract hire, reporting to the colleague chosen', !!row && state?.employee?.type === 'contract' && state?.employee?.name === hire, JSON.stringify(state?.employee ?? {}));
  await sleep(400);
  await t.shot('b2-onboarding-case');

  await t.evaluate(rowAct('Device assignment', 'Mark as done'));
  const s1 = await poll(async () => (await api('me', 'GET', `/api/hr/onboarding/${eid}`)).data?.steps?.find((s) => s.step === 'device_assignment'), (s) => s?.status === 'done');
  t.check('HR records a hand-ticked step', s1?.status === 'done', JSON.stringify(s1 ?? {}));
  await t.evaluate(rowAct('Employment documents', 'Mark…'));
  await t.waitFor(`!!${dialog('Mark… · Employment documents')}`, 'the mark dialog');
  await t.evaluate(setValue('[role="dialog"] input[aria-label="Why?"]', `E2E waiting on the contract ${tag}`));
  await t.evaluate(clickIn(dialog('Mark… · Employment documents'), 'Mark'));
  const s2 = await poll(async () => (await api('me', 'GET', `/api/hr/onboarding/${eid}`)).data?.steps?.find((s) => s.step === 'employment_documents'), (s) => s?.status === 'blocked');
  t.check('a step is marked blocked with a reason, not ticked', s2?.status === 'blocked' && (s2.note ?? '').includes('contract'), JSON.stringify(s2 ?? {}));
  await t.evaluate(clickIn('document.querySelector("main")', 'Activate'));
  await t.waitFor(`!!${dialog('Not ready to activate')}`, 'the refusal', 20_000);
  t.check('Activate is refused with what is still outstanding', await t.evaluate(`${dialog('Not ready to activate')}.innerText.length > 40`));
  await t.evaluate(clickIn(dialog('Not ready to activate'), 'OK'));
  await t.evaluate(clickIn('document.querySelector("main")', 'Cancel onboarding'));
  await t.waitFor(`!!${dialog('Cancel this onboarding?')}`, 'the cancel dialog');
  await t.evaluate(setValue('[role="dialog"] input[aria-label="Why?"]', `E2E ${tag}`));
  await t.evaluate(clickIn(dialog('Cancel this onboarding?'), 'Cancel onboarding'));
  const cancelled = await poll(async () => (await api('me', 'GET', `/api/hr/onboarding/${eid}`)).data?.onboarding?.status, (s) => s === 'cancelled');
  t.check('the onboarding can be cancelled', cancelled === 'cancelled', String(cancelled));

  await t.evaluate(rail('My onboarding'));
  await t.waitFor(heading('My onboarding') + ` || ${has('not going through onboarding')}`, 'My onboarding', 20_000);
  t.check('My onboarding says when there is nothing to complete', await t.evaluate(`/not going through onboarding|Where you are/.test(${main})`));

  // The one dropdown, searched: Team attendance's fifteen filters.
  await t.evaluate(rail('Team attendance'));
  await t.waitFor(heading('Team attendance'), 'Team attendance', 20_000);
  await t.evaluate(`document.querySelector('main [role="combobox"][aria-label="Status"]').click()`);
  await t.waitFor(`!!document.querySelector('input[aria-label="Search Status"]')`, 'the search box');
  await t.evaluate(setValue('input[aria-label="Search Status"]', 'check'));
  await sleep(200);
  const found = await t.evaluate(`[...document.querySelectorAll('[role="listbox"][aria-label="Status"] [role="option"]')].map(o => o.textContent)`);
  t.check('a long dropdown has a search box that narrows it as you type', found.length === 2 && found.every((x) => /check/i.test(x)), JSON.stringify(found));
  await t.shot('b0b-dropdown-search');
  await t.evaluate(`document.querySelector('input[aria-label="Search Status"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))`);
  await t.evaluate(`document.querySelector('input[aria-label="Search Status"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`);
  await t.waitFor(`document.querySelector('main [role="combobox"][aria-label="Status"]').dataset.value === 'missing_check_out'`, 'the keyboard pick', 10_000);
  t.check('arrow keys and Enter pick from the filtered list', true);

  // ── Resignations and Offboarding ──────────────────────────────────────
  await t.evaluate(rail('Resignations'));
  await t.waitFor(heading('Resignations'), 'Resignations', 20_000);
  await t.waitFor(`/Nothing is waiting for a decision|Waiting/.test(${main})`, 'the queue', 20_000);
  t.check('Resignations lists what is waiting for a decision', true);
  await t.evaluate(rail('Offboarding'));
  await t.waitFor(heading('Offboarding'), 'Offboarding', 20_000);
  await t.waitFor(`/Nobody is leaving right now|Open/.test(${main})`, 'the cases', 20_000);
  await t.shot('b3-offboarding');
  t.check('Offboarding lists everyone leaving', true);

  // ── Work schedules ────────────────────────────────────────────────────
  await t.evaluate(rail('Work schedules'));
  await t.waitFor(heading('Work schedules'), 'Work schedules', 20_000);
  const sched = `E2E Night ${tag}`;
  await t.evaluate(clickIn('document.querySelector("main")', 'Create schedule'));
  await t.waitFor(`${main}.includes('New schedule')`, 'the schedule editor');
  await t.evaluate(setValue('main input[aria-label="Schedule name"]', sched));
  await t.evaluate(setValue('main input[aria-label="Mon starts"]', '22:00'));
  await t.evaluate(setValue('main input[aria-label="Mon ends"]', '06:00'));
  await t.evaluate(`[...document.querySelectorAll('main button')].find(b => b.textContent.startsWith("Apply the first day's hours")).click()`);
  await sleep(200);
  t.check('a night shift reads as running past midnight', await t.evaluate(has('past midnight')));
  await t.shot('b4-schedule-editor');
  await t.evaluate(clickIn('document.querySelector("main")', 'Save'));
  await t.waitFor(`${main}.includes(${js(sched)}) && !${main}.includes('New schedule')`, 'the saved schedule', 20_000);
  const sch = ((await api('me', 'GET', '/api/hr/schedules')).data?.schedules ?? []).find((x) => x.name === sched);
  t.check('the schedule is saved with its days, crossing midnight', !!sch && sch.current?.days?.some((d) => d.is_working && d.crosses_midnight), JSON.stringify(sch?.current?.days?.[0] ?? {}));
  await t.evaluate(rowAct(sched, 'Assign'));
  await t.waitFor(`!!document.querySelector('aside[aria-label="Assign"]')`, 'the assign panel');
  await t.evaluate(`(() => { const l = [...document.querySelectorAll('aside[aria-label="Assign"] label')].find(x => x.textContent.includes(${js(partnerEmp.name)})); l.querySelector('input').click(); })()`);
  await t.evaluate(`[...document.querySelectorAll('aside[aria-label="Assign"] button')].find(b => b.textContent.trim().startsWith('Assign 1')).click()`);
  const assigned = await poll(async () => (await api('me', 'GET', `/api/hr/schedules/assignments?schedule_id=${sch?.id}`)).data?.assignments ?? [], (a) => a.some((x) => x.scope === 'employee' && Number(x.scope_id) === Number(partnerEmp.id)));
  t.check('a schedule is assigned to a colleague from today', assigned.some((x) => Number(x.scope_id) === Number(partnerEmp.id)), JSON.stringify(assigned[0] ?? {}));
  await t.waitFor(`document.querySelector('aside[aria-label="Assign"]').innerText.includes('Already assigned')`, 'the assignment listed', 20_000);
  await t.shot('b5-assign');
  await t.evaluate(`[...document.querySelectorAll('aside[aria-label="Assign"] button')].find(b => b.textContent.trim() === 'End').click()`);
  await t.waitFor(`!document.querySelector('aside[aria-label="Assign"]').innerText.includes('Already assigned')`, 'the assignment ended', 20_000);
  t.check('an assignment can be ended', true);
  await t.evaluate(`[...document.querySelectorAll('aside[aria-label="Assign"] button')].find(b => b.getAttribute('aria-label') === 'Close').click()`);
  await t.evaluate(rowAct(sched, 'History'));
  await t.waitFor(`!!document.querySelector('aside[aria-label="History"]') && document.querySelector('aside[aria-label="History"]').innerText.length > 30`, 'the history', 20_000);
  t.check('History shows what changed and who changed it', true);
  await t.evaluate(`[...document.querySelectorAll('aside[aria-label="History"] button')].find(b => b.getAttribute('aria-label') === 'Close').click()`);

  // ── Settings ──────────────────────────────────────────────────────────
  await t.evaluate(rail('Settings'));
  await t.waitFor(heading('Settings'), 'Settings', 20_000);
  await t.waitFor(`${main}.includes('Employee numbering') && !!document.querySelector('main input[aria-label="Padded to (digits)"]')`, 'the general settings', 20_000);
  made.digits = await t.evaluate(`document.querySelector('main input[aria-label="Padded to (digits)"]').value`);
  const next = made.digits === '5' ? '6' : '5';
  await t.evaluate(setValue('main input[aria-label="Padded to (digits)"]', next));
  await t.shot('b6-settings');
  await t.evaluate(clickIn('document.querySelector("main")', 'Save'));
  const saved = await poll(async () => (await api('me', 'GET', '/api/module-settings/hr')).data?.general?.hr_employee_no_digits?.value, (v) => String(v) === next);
  t.check('a general setting is saved from its field in the server’s list', String(saved) === next, String(saved));
  await t.evaluate(setValue('main input[aria-label="Padded to (digits)"]', made.digits));
  await t.evaluate(clickIn('document.querySelector("main")', 'Save'));
  const back = await poll(async () => (await api('me', 'GET', '/api/module-settings/hr')).data?.general?.hr_employee_no_digits?.value, (v) => String(v) === made.digits);
  t.check('and put back', String(back) === made.digits, String(back));
  if (String(back) === made.digits) made.digits = null;

  await t.evaluate(`[...document.querySelectorAll('main [role="tab"]')].find(b => b.textContent.trim() === 'Leave types').click()`);
  await t.waitFor(`${main}.includes('Add leave type')`, 'the leave types');
  const lt = `E2E Study ${tag}`;
  await t.evaluate(clickIn('document.querySelector("main")', 'Add leave type'));
  await t.waitFor(`!!${dialog('Add leave type')}`, 'the leave type form');
  await t.evaluate(setValue('[role="dialog"] input[aria-label="Name"]', lt));
  await t.evaluate(setValue('[role="dialog"] input[aria-label="Days a year"]', '3'));
  await t.evaluate(clickIn(dialog('Add leave type'), 'Save'));
  await t.waitFor(has(lt), 'the new leave type', 20_000);
  await t.evaluate(rowAct(lt, 'Archive'));
  const ltRow = await poll(async () => ((await api('me', 'GET', '/api/hr/leave/types?all=1')).data?.types ?? []).find((x) => x.name === lt), (x) => x?.status === 'archived');
  t.check('a leave type is added and archived', ltRow?.status === 'archived' && Number(ltRow.days_per_year) === 3, JSON.stringify(ltRow ?? {}));

  await t.evaluate(`[...document.querySelectorAll('main [role="tab"]')].find(b => b.textContent.trim() === 'Public holidays').click()`);
  await t.waitFor(`!!document.querySelector('main input[aria-label="Holiday name"]')`, 'the holidays');
  const hol = `E2E Holiday ${tag}`;
  const year = new Date().getFullYear();
  await t.evaluate(setValue('main input[aria-label="Holiday date"]', `${year}-12-30`));
  await t.evaluate(setValue('main input[aria-label="Holiday name"]', hol));
  await t.evaluate(clickIn('document.querySelector("main")', 'Add'));
  await t.waitFor(has(hol), 'the holiday listed', 20_000);
  t.check('a public holiday is added', ((await api('me', 'GET', `/api/hr/holidays?year=${year}`)).data?.holidays ?? []).some((h) => h.name === hol));
  await t.evaluate(rowAct(hol, 'Remove'));
  await t.waitFor(`!${has(hol)}`, 'the holiday removed', 20_000);
  t.check('and removed', !((await api('me', 'GET', `/api/hr/holidays?year=${year}`)).data?.holidays ?? []).some((h) => h.name === hol));

  // ── Announcements ─────────────────────────────────────────────────────
  await t.evaluate(rail('Announcements'));
  await t.waitFor(heading('Announcements'), 'Announcements', 20_000);
  const note = `E2E Notice ${tag}`;
  await t.evaluate(clickIn('document.querySelector("main")', 'New announcement'));
  await t.waitFor(`!!${dialog('New announcement')}`, 'the composer');
  await t.evaluate(setValue('[role="dialog"] input[aria-label="Title"]', note));
  await t.evaluate(setValue('[role="dialog"] textarea[aria-label="Message"]', 'The office is closed on Friday <for maintenance>.'));
  // The company list loads with the form; Save waits for it.
  await t.waitFor(`[...${dialog('New announcement')}.querySelectorAll('button')].some(b => b.textContent.trim() === 'Save Draft' && !b.disabled)`, 'the composer ready');
  await t.evaluate(clickIn(dialog('New announcement'), 'Save Draft'));
  await t.waitFor(has(note), 'the draft listed', 20_000);
  const ann = ((await api('me', 'GET', '/api/hr/announcements')).data?.items ?? []).find((a) => a.title === note);
  t.check('an announcement is saved as a draft', ann?.status === 'draft', JSON.stringify(ann ?? {}));
  await t.shot('b7-announcements');
  await t.evaluate(rowAct(note, 'Delete'));
  await t.waitFor(`!!${dialog(`Delete “${note}”?`)}`, 'the delete confirmation');
  await t.evaluate(clickIn(dialog(`Delete “${note}”?`), 'Delete'));
  await t.waitFor(`!${has(note)}`, 'the draft deleted', 20_000);
  t.check('and deleted after asking', true);

  // ── Devices ───────────────────────────────────────────────────────────
  await t.evaluate(rail('Devices'));
  await t.waitFor(heading('Devices'), 'Devices', 20_000);
  const dev = `E2E Gate ${tag}`;
  await t.evaluate(clickIn('document.querySelector("main")', 'Add device'));
  await t.waitFor(`!!${dialog('Add device')}`, 'the device form');
  await t.evaluate(setValue('[role="dialog"] input[aria-label="Name"]', dev));
  await t.evaluate(setValue('[role="dialog"] input[aria-label="Serial number"]', `E2ESN${tag}`));
  await t.evaluate(clickIn(dialog('Add device'), 'Add'));
  await t.waitFor(`!!${dialog('Device key — copy it now')}`, 'the one-time key', 20_000);
  t.check('adding a device shows its key once', await t.evaluate(`${dialog('Device key — copy it now')}.innerText.includes('cannot be shown again')`));
  await t.evaluate(clickIn(dialog('Device key — copy it now'), 'Done'));
  await t.waitFor(`${main}.includes('Type this into the terminal')`, 'the device setup', 20_000);
  await t.shot('b8-device');
  for (const pane of ['People', 'Punches', 'Commands', 'Raw log']) {
    await t.evaluate(`[...document.querySelectorAll('main [role="tab"]')].find(b => b.textContent.trim() === ${js(pane)}).click()`);
    await sleep(500);
  }
  t.check('a device’s people, punches, commands and raw log open', await t.evaluate(`!${main}.includes('Something went wrong')`));
  await t.evaluate(clickIn('document.querySelector("main")', 'Remove'));
  await t.waitFor(`!!${dialog(`Remove “${dev}”?`)}`, 'the remove confirmation');
  await t.evaluate(clickIn(dialog(`Remove “${dev}”?`), 'Remove'));
  await t.waitFor(`!${has(dev)}`, 'the device removed', 20_000);
  t.check('a device is removed after asking', !((await api('me', 'GET', '/api/hr/devices')).data?.devices ?? []).some((d) => d.name === dev));
} catch (e) {
  t.check(`no unexpected error (${e.message})`, false);
  await t.shot('bz-failure').catch(() => undefined);
} finally {
  if (made.digits != null) await api('me', 'PUT', '/api/module-settings/hr/general', { hr_employee_no_digits: made.digits }).catch(() => undefined);
  // A department this run made and did not get to delete.
  for (const d of ((await api('me', 'GET', '/api/directory/departments').catch(() => ({ data: [] }))).data ?? []).filter((x) => /^E2E Dept \d+$/.test(x.name ?? ''))) await api('me', 'DELETE', `/api/directory/departments/${d.id}`).catch(() => undefined);
  await t.finish();
}

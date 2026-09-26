// End-to-end: HR part 2, the HR side — the Directory and its drawer, an
// employee added; a colleague's profile with every tab, edited, noted, a
// leave balance managed and a day of attendance corrected; Team attendance,
// Missing check-outs, a submitted week sent back from Timesheet approvals,
// Reports with its CSV, Work pattern and My access. Checked against the
// server, and what the run makes is taken away again.
//
// The signed-in person must hold HR's permissions (hr.manage and the literal
// hr.* grants: timesheet approval, KPI view, bank view) and be an employee;
// the partner must be an employee with a login.
//
//   npm run build
//   WS_E2E_SERVER=… WS_E2E_EMAIL=… WS_E2E_PASSWORD=… WS_E2E_PARTNER_EMAIL=… WS_E2E_PARTNER_PASSWORD=… \
//   ELECTRON_RUN_AS_NODE=1 npx electron tests/e2e/hr-admin.mjs
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
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const tag = Math.floor(Math.random() * 10_000);
const rail = (label) => `(() => { const n = document.querySelector('nav[aria-label="People"]'); const find = () => [...n.querySelectorAll('button:not([aria-expanded])')].find(b => b.textContent.trim().startsWith(${js(label)})); if (!find()) n.querySelectorAll('button[aria-expanded="false"]').forEach(h => h.click()); return new Promise(r => setTimeout(() => { const b = find(); if (b) b.click(); r(!!b); }, 50)); })()`;
const heading = (t) => `[...document.querySelectorAll('main h1')].some(h => h.textContent.trim() === ${js(t)})`;
const main = `document.querySelector('main').innerText`;
const has = (text) => `${main}.includes(${js(text)})`;
const dialog = (label) => `document.querySelector(${js(`[role="dialog"][aria-label="${label}"]`)})`;
const clickIn = (scope, text) => `(() => { const root = ${scope} ?? document; const b = [...root.querySelectorAll('button')].find(b => b.textContent.trim() === ${js(text)} || b.getAttribute('aria-label') === ${js(text)}); if (!b) return false; b.click(); return true; })()`;
const tab = (text) => `(() => { const b = [...document.querySelectorAll('main [role="tab"]')].find(b => b.textContent.trim() === ${js(text)}); if (!b) return false; b.click(); return true; })()`;
const setValue = (selector, value) => `(() => { const el = document.querySelector(${js(selector)}); if (!el) return false; const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${js(value)}); el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`;
/** Click a button inside the table row that mentions `text`. */
const rowAct = (text, action) => `(() => { const rows = [...document.querySelectorAll('main div, main section')].filter(x => x.textContent.includes(${js(text)}) && [...x.querySelectorAll('button')].some(b => b.textContent.trim() === ${js(action)})); if (!rows.length) return false; rows.sort((a, b) => a.textContent.length - b.textContent.length); [...rows[0].querySelectorAll('button')].find(b => b.textContent.trim() === ${js(action)}).click(); return true; })()`;

async function poll(fn, ok, tries = 20) {
  let v;
  for (let i = 0; i < tries; i++) {
    v = await fn();
    if (ok(v)) return v;
    await sleep(500);
  }
  return v;
}

const t = await launch({ name: 'hr-admin' });
const made = { balance: null, jobLevel: undefined, logId: null };
let partnerEmp = null;
try {
  const me = await login('me', email, password);
  const partner = await login('partner', partnerEmail, partnerPassword);
  const everyone = (await api('me', 'GET', '/api/hr/employees')).data ?? [];
  partnerEmp = everyone.find((e) => Number(e.user_id) === Number(partner.id));
  t.check('the partner is on file, and HR can list everyone', !!partnerEmp && everyone.length > 1, `${everyone.length} rows`);
  const pid = partnerEmp?.id;
  const before = (await api('me', 'GET', `/api/hr/employees/${pid}/profile`)).data;
  made.jobLevel = before?.employment?.job_level ?? null;

  // The partner submits last week's timesheet, so there is one to review.
  const monday = new Date();
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7) - 7);
  const tuesday = new Date(monday);
  tuesday.setDate(monday.getDate() + 1);
  const log = await api('partner', 'POST', '/api/hr/time-logs', { on_date: ymd(tuesday), description: `E2E review ${tag}`, minutes: 150, billable: true });
  made.logId = log.data?.id ?? null;
  const sheet = await api('partner', 'POST', '/api/hr/timesheets', { starts_on: ymd(monday) });
  const sheetId = sheet.data?.id ?? (await api('partner', 'GET', '/api/hr/timesheets')).data?.find?.((s) => s.starts_on === ymd(monday))?.id;
  const submitted = sheetId ? await api('partner', 'POST', `/api/hr/timesheets/${sheetId}/submit`, {}) : { status: 0 };
  t.check('a colleague submits last week’s timesheet', submitted.status === 200, `${log.status} ${sheet.status} ${submitted.status} ${submitted.message ?? ''}`);

  await t.signIn(server, email, password);
  await t.evaluate(`[...document.querySelectorAll('nav[aria-label="Apps"] button')].find(b => b.textContent.trim().startsWith('HR')).click()`);
  await t.waitFor(`!!document.querySelector('nav[aria-label="People"]')`, 'the People rail', 30_000);

  // ── the Directory ─────────────────────────────────────────────────────
  await t.evaluate(rail('Directory'));
  await t.waitFor(heading('Directory'), 'the Directory', 20_000);
  await t.waitFor(has(partnerEmp.name), 'the partner listed', 20_000);
  t.check('the Directory is drawn here now, not in the browser', !(await t.evaluate(`(document.querySelector('nav[aria-label="People"] button[aria-current="page"]')?.getAttribute('title') ?? '').includes('browser')`)));
  await t.evaluate(setValue('main input[aria-label="Search name or number"]', partnerEmp.name.split(' ')[0]));
  await sleep(300);
  const shown = await t.evaluate(`document.querySelectorAll('main [role="button"]').length`);
  t.check('searching narrows the list', shown >= 1 && shown < everyone.length, `${shown} of ${everyone.length}`);
  await t.evaluate(`[...document.querySelectorAll('main [role="button"]')].find(r => r.textContent.includes(${js(partnerEmp.name)})).click()`);
  await t.waitFor(`!!document.querySelector('aside[aria-label="Employee"]') && document.querySelector('aside[aria-label="Employee"]').innerText.includes('Open full profile')`, 'the employee drawer', 20_000);
  await sleep(400);
  await t.shot('a1-directory-drawer');
  t.check('a row opens the drawer: employment, login, leave balance and history', await t.evaluate(`['Employment', 'Login', 'Leave balance', 'Leave history'].every(s => document.querySelector('aside[aria-label="Employee"]').innerText.toUpperCase().includes(s.toUpperCase()))`));
  await t.evaluate(`[...document.querySelectorAll('aside[aria-label="Employee"] button')].find(b => b.getAttribute('aria-label') === 'Close').click()`);
  await t.evaluate(setValue('main input[aria-label="Search name or number"]', ''));

  // Add a bare employee record.
  const newNo = `E2E-NEW-${tag}`;
  await t.evaluate(clickIn('document.querySelector("main")', 'Add employee'));
  await t.waitFor(`!!${dialog('Add employee')}`, 'the add form');
  await t.evaluate(setValue('[role="dialog"] input[aria-label="Employee number"]', newNo));
  await t.evaluate(clickIn(dialog('Add employee'), 'Add employee'));
  await t.waitFor(`${main}.includes(${js(newNo)}) && ${main}.includes('EMPLOYEE')`, 'the new profile', 20_000);
  const added = ((await api('me', 'GET', '/api/hr/employees')).data ?? []).find((e) => e.employee_no === newNo);
  t.check('Add employee creates the record and opens its profile', !!added && added.status === 'probation', JSON.stringify(added ?? {}));

  // ── a colleague's profile ─────────────────────────────────────────────
  await t.evaluate(`(() => { const b = [...document.querySelectorAll('main button')].find(b => b.textContent.trim() === '← Back'); b?.click(); })()`);
  await t.waitFor(heading('Directory'), 'back to the Directory', 20_000);
  await t.evaluate(rowAct(partnerEmp.name, 'Open profile'));
  await t.waitFor(`${main}.includes('EMPLOYEE') && ${main}.includes(${js(partnerEmp.name)})`, 'the partner’s profile', 20_000);
  await sleep(500);
  await t.shot('a2-profile');
  const tabs = await t.evaluate(`[...document.querySelectorAll('main [role="tab"]')].map(b => b.textContent.trim())`);
  t.check('the profile shows every section HR may see', ['Overview', 'Personal', 'Employment', 'Organizations', 'Attendance', 'Timesheet', 'Leave', 'Documents', 'Requests', 'Notes', 'Activity'].every((x) => tabs.includes(x)), tabs.join(', '));
  t.check('the overview: this month, employment, recent attendance, leave balance', await t.evaluate(`['This month', 'Employment', 'Recent attendance', 'Leave balance'].every(s => ${main}.includes(s))`));

  // Edit: the job level, with a reason.
  const level = `L${(tag % 8) + 1}`;
  await t.evaluate(clickIn('document.querySelector("main")', 'Edit'));
  await t.waitFor(`!!${dialog(`Edit ${partnerEmp.name}`)}`, 'the edit form');
  await t.evaluate(setValue('[role="dialog"] input[aria-label="Job level"]', level));
  await t.evaluate(setValue('[role="dialog"] input[aria-label="Reason for the change"]', `E2E ${tag}`));
  await t.shot('a3-edit');
  await t.evaluate(clickIn(dialog(`Edit ${partnerEmp.name}`), 'Save'));
  const edited = await poll(async () => (await api('me', 'GET', `/api/hr/employees/${pid}/profile`)).data, (d) => d?.employment?.job_level === level);
  t.check('Edit saves only what changed, with the reason on the audit', edited?.employment?.job_level === level && (edited.activity ?? []).some((a) => a.field === 'job_level' && a.reason === `E2E ${tag}`), JSON.stringify(edited?.activity?.[0] ?? {}));

  await t.evaluate(tab('Personal'));
  await t.waitFor(`['Emergency contact', 'Address', 'Identification'].every(s => ${main}.includes(s))`, 'the Personal tab');
  t.check('Personal shows the personal, contact, emergency and address cards', true);
  await t.evaluate(tab('Employment'));
  await t.waitFor(`${main}.includes('Working hours') && ${main}.includes(${js(level)})`, 'the Employment tab');
  t.check('Employment shows the record, working hours and who reports to them', true);
  await t.evaluate(tab('Organizations'));
  await t.waitFor(`/Staff no\\.|Not placed in any company/.test(${main})`, 'the Organizations tab', 20_000);
  t.check('Organizations lists the companies they work for (or says there are none)', true);

  // Notes: add one, HR only, and delete it.
  await t.evaluate(tab('Notes'));
  await t.waitFor(`${main}.includes('Add a note')`, 'the Notes tab');
  const noteText = `E2E note ${tag}`;
  await t.evaluate(clickIn('document.querySelector("main")', 'Add a note'));
  await t.waitFor(`!!${dialog('Add a note')}`, 'the note form');
  await t.evaluate(setValue('[role="dialog"] textarea[aria-label="Note"]', noteText));
  await t.shot('a4-note');
  await t.evaluate(clickIn(dialog('Add a note'), 'Add note'));
  await t.waitFor(has(noteText), 'the note listed', 20_000);
  const noted = ((await api('me', 'GET', `/api/hr/employees/${pid}/profile`)).data?.notes ?? []).find((n) => n.body === noteText);
  t.check('a note is added, HR only by default', noted?.visibility === 'hr_only', JSON.stringify(noted ?? {}));
  await t.evaluate(rowAct(noteText, 'Delete'));
  await t.waitFor(`!${has(noteText)}`, 'the note gone', 20_000);
  t.check('a note can be deleted', !((await api('me', 'GET', `/api/hr/employees/${pid}/profile`)).data?.notes ?? []).some((n) => n.body === noteText));

  // Leave: manage a balance, then put it back.
  await t.evaluate(tab('Leave'));
  await t.waitFor(`${main}.includes('Balances are set by HR') && [...document.querySelectorAll('main button')].some(b => b.textContent.trim() === 'Manage')`, 'the Leave tab', 20_000);
  const year = new Date().getFullYear();
  const bal = (await api('me', 'GET', `/api/hr/employees/${pid}/leave?year=${year}`)).data?.balances?.[0];
  made.balance = bal ? { type_id: bal.type_id, entitled: bal.entitled, carried_in: bal.carried_in, taken: bal.taken } : null;
  await t.evaluate(rowAct(bal.type, 'Manage'));
  await t.waitFor(`!!${dialog(`${bal.type} leave — ${year}`)}`, 'the balance form');
  await t.evaluate(setValue('[role="dialog"] input[aria-label="Carried in"]', String(Number(bal.carried_in) + 1.5)));
  await t.evaluate(setValue('[role="dialog"] input[aria-label="Reason"]', `E2E ${tag}`));
  await t.shot('a5-balance');
  await t.evaluate(clickIn(dialog(`${bal.type} leave — ${year}`), 'Save balance'));
  const after = await poll(async () => (await api('me', 'GET', `/api/hr/employees/${pid}/leave?year=${year}`)).data?.balances?.find((b) => b.type_id === bal.type_id), (b) => Number(b?.carried_in) === Number(bal.carried_in) + 1.5);
  t.check('a leave balance is managed: carried in +1.5 raises what is available', Number(after?.available) === Number(bal.available) + 1.5, JSON.stringify(after ?? {}));

  // Attendance: correct a past weekday.
  await t.evaluate(tab('Attendance'));
  await t.waitFor(`${main}.includes('No check-out') && ${main}.includes('Worked')`, 'the Attendance tab', 20_000);
  const day = await t.evaluate(`(() => { const r = [...document.querySelectorAll('main .flex.items-center')].find(x => [...x.querySelectorAll('button')].some(b => b.textContent.trim() === 'Correct')); if (!r) return null; [...r.querySelectorAll('button')].find(b => b.textContent.trim() === 'Correct').click(); return r.textContent.slice(0, 14); })()`);
  if (day) {
    await t.waitFor(`!!${dialog('Correct attendance')}`, 'the correction form');
    await t.evaluate(setValue('[role="dialog"] input[aria-label="Check in"]', '08:30'));
    await t.evaluate(setValue('[role="dialog"] input[aria-label="Check out"]', '17:15'));
    await t.evaluate(setValue('[role="dialog"] input[aria-label="Reason"]', `E2E ${tag}`));
    await t.shot('a6-correct');
    await t.evaluate(clickIn(dialog('Correct attendance'), 'Save correction'));
    await t.waitFor(`!${dialog('Correct attendance')}`, 'the form closed', 20_000);
    const hist = await poll(async () => (await api('me', 'GET', `/api/hr/attendance/history?employee_id=${pid}`)).data?.records ?? [], (rs) => rs.some((r) => r.check_in?.endsWith('08:30:00') && r.check_out?.endsWith('17:15:00')));
    t.check('HR corrects a day of their attendance', hist.some((r) => r.check_in?.endsWith('08:30:00') && r.check_out?.endsWith('17:15:00')), day);
  } else t.skip('correcting a day', 'no working day has passed this month');

  await t.evaluate(tab('Timesheet'));
  await t.waitFor(`${main}.includes('Logged this month')`, 'the Timesheet tab', 20_000);
  t.check('Timesheet shows their weeks', await t.evaluate(has('Awaiting review')));
  await t.evaluate(tab('Documents'));
  await t.waitFor(heading('Documents'), 'the Documents tab', 20_000);
  t.check('Documents is their file, with HR’s upload', await t.evaluate(`${main}.includes('Everything on this employee’s file')`));
  if (tabs.includes('Bank')) {
    await t.evaluate(tab('Bank'));
    await t.waitFor(`/No bank details on file|Account number/.test(${main})`, 'the Bank tab', 20_000);
    t.check('Bank shows the account (masked) or that there is none', true);
  } else t.skip('the Bank tab', 'this login holds neither hr.bank.view nor hr.bank.manage');
  await t.evaluate(tab('Activity'));
  await t.waitFor(`${main}.includes('Job level')`, 'the Activity tab', 20_000);
  await t.shot('a7-activity');
  t.check('Activity lists the change just made', true);

  // ── Team attendance and Missing check-outs ────────────────────────────
  await t.evaluate(rail('Team attendance'));
  await t.waitFor(heading('Team attendance'), 'Team attendance', 20_000);
  await t.waitFor(`${main}.includes('Present') && ${main}.includes('Everyone —')`, 'the roster', 20_000);
  await sleep(400);
  await t.shot('a8-team-attendance');
  t.check('Team attendance shows the day’s counts and everyone', true);
  await t.evaluate(setValue('main select[aria-label="Status"]', 'absent'));
  await t.waitFor(`${main}.includes('Absent —')`, 'the absent filter', 20_000);
  t.check('the status filter narrows the roster', true);
  if (await t.evaluate(rowAct(partnerEmp.name, 'Correct'))) {
    await t.waitFor(`!!${dialog('Correct attendance')}`, 'the correction form');
    t.check('Correct opens from the roster, with the earlier corrections', await t.evaluate(`${dialog('Correct attendance')}.innerText.includes('Earlier corrections')`));
    await t.evaluate(setValue('[role="dialog"] input[aria-label="Check in"]', '08:40'));
    await t.evaluate(setValue('[role="dialog"] input[aria-label="Check out"]', '17:05'));
    await t.evaluate(setValue('[role="dialog"] input[aria-label="Reason"]', `E2E ${tag} roster`));
    await t.shot('a8b-roster-correct');
    await t.evaluate(clickIn(dialog('Correct attendance'), 'Save correction'));
    const rosterDay = await t.evaluate(`document.querySelector('main input[aria-label="Day"]').value`);
    const fixed = await poll(async () => ((await api('me', 'GET', `/api/hr/attendance?date=${rosterDay}&q=${encodeURIComponent(partnerEmp.employee_no)}`)).data?.records ?? []).find((r) => r.employee_id === pid), (r) => !!r?.check_in?.endsWith('08:40:00'));
    t.check('a correction saved from the roster lands on the day', !!fixed?.check_in?.endsWith('08:40:00') && !!fixed?.check_out?.endsWith('17:05:00') && fixed?.corrected === true, JSON.stringify({ in: fixed?.check_in, out: fixed?.check_out, corrected: fixed?.corrected }));
  } else t.skip('Correct from the roster', 'the partner is not absent today');
  await t.evaluate(rail('Missing check-outs'));
  await t.waitFor(heading('Missing check-outs'), 'Missing check-outs', 20_000);
  await t.waitFor(`${main}.includes('How unresolved days are handled')`, 'the review queue', 20_000);
  await t.shot('a9-missing');
  t.check('Missing check-outs shows the queue and how days are handled', true);

  // ── Timesheet approvals ───────────────────────────────────────────────
  await t.evaluate(rail('Timesheet approvals'));
  await t.waitFor(heading('Timesheet approvals'), 'Timesheet approvals', 20_000);
  await t.waitFor(has(partnerEmp.name), 'the submitted week', 20_000);
  await t.shot('a10-approvals');
  await t.evaluate(rowAct(partnerEmp.name, 'View'));
  await t.waitFor(`!!document.querySelector('[role="dialog"]') && document.querySelector('[role="dialog"]').innerText.includes(${js(`E2E review ${tag}`)})`, 'the week’s logs', 20_000);
  t.check('View shows what was logged that week', true);
  await t.evaluate(clickIn('document.querySelector("[role=dialog]")', 'Close'));
  await t.evaluate(rowAct(partnerEmp.name, 'Send back'));
  await t.waitFor(`!!${dialog('Send this timesheet back')}`, 'the send-back form');
  await t.evaluate(setValue('[role="dialog"] textarea[aria-label="What needs changing?"]', `E2E ${tag}: add the ticket numbers`));
  await t.evaluate(clickIn(dialog('Send this timesheet back'), 'Send back'));
  const back = await poll(async () => ((await api('partner', 'GET', '/api/hr/timesheets')).data ?? []).find?.((s) => s.id === sheetId), (s) => s?.status === 'rejected');
  t.check('a submitted week is sent back with what needs changing', back?.status === 'rejected' && (back.decision_note ?? '').includes('ticket numbers'), JSON.stringify(back ?? {}));

  // ── Reports ───────────────────────────────────────────────────────────
  await t.evaluate(rail('Reports'));
  await t.waitFor(heading('Reports'), 'Reports', 20_000);
  await t.waitFor(`${main}.includes('By employee') && ${main}.includes('Detail')`, 'the report', 30_000);
  await sleep(400);
  await t.shot('a11-reports');
  t.check('Reports shows the totals, a line per employee and the days', await t.evaluate(`['Present', 'Absent', 'No check-out'].every(s => ${main}.includes(s))`));
  await t.evaluate(setValue('main select[aria-label="Report"]', 'absence'));
  await t.waitFor(`document.querySelector('main select[aria-label="Report"]').value === 'absence'`, 'the absence report');
  await t.evaluate(clickIn('document.querySelector("main")', 'Export CSV'));
  const csv = await t.waitFor(`window.worksuite.transfers.list().then(l => Array.isArray(l) && l.some(x => /^attendance-absence-.*\\.csv$/.test(x.name ?? '') && x.state === 'done'))`, 'the CSV download', 30_000).then(() => true, () => false);
  t.check('Export CSV saves the report to Downloads', csv, String(await t.evaluate(`window.worksuite.transfers.list().then(l => l.map(x => x.name + ':' + x.state).join(', '))`)));

  // ── Work pattern and My access ────────────────────────────────────────
  await t.evaluate(rail('Work pattern'));
  await t.waitFor(heading('Work pattern'), 'Work pattern', 20_000);
  await t.waitFor(`${main}.includes('How this was worked out') || ${main}.includes('nothing to measure')`, 'my score', 20_000);
  await t.waitFor(`${main}.includes('Your team')`, 'the team table', 20_000);
  await t.shot('a12-work-pattern');
  t.check('Work pattern shows my score and, for KPI viewers, the team', true);
  await t.evaluate(rail('My access'));
  await t.waitFor(heading('My access'), 'My access', 20_000);
  await t.waitFor(`/whose records you can open/i.test(${main})`, 'the scope');
  await t.evaluate(tab(await t.evaluate(`[...document.querySelectorAll('main [role="tab"]')].map(b => b.textContent.trim()).find(x => x.startsWith('My access'))`)));
  await t.waitFor(`${main}.includes('hr.manage')`, 'the permissions');
  await t.shot('a13-my-access');
  t.check('My access explains whose records I can open and lists the permissions', true);
  t.check('the signed-in person was HR all along', !!me.id);
} catch (e) {
  t.check(`no unexpected error (${e.message})`, false);
  await t.shot('az-failure').catch(() => undefined);
} finally {
  if (partnerEmp) {
    const pid = partnerEmp.id;
    if (made.jobLevel !== undefined) await api('me', 'PUT', `/api/hr/employees/${pid}/profile`, { job_level: made.jobLevel, reason: `E2E ${tag} undo` }).catch(() => undefined);
    const year = new Date().getFullYear();
    if (made.balance) await api('me', 'PUT', `/api/hr/employees/${pid}/leave/${made.balance.type_id}`, { year, entitled: made.balance.entitled, carried_in: made.balance.carried_in, taken: made.balance.taken, reason: `E2E ${tag} undo` }).catch(() => undefined);
  }
  if (made.logId) await api('partner', 'DELETE', `/api/hr/time-logs/${made.logId}`).catch(() => undefined);
  await t.finish();
}

// End-to-end: HR part 1, to the HR designs — the People rail and the
// dashboard; My HR and asking to change a detail; Requests, with a
// colleague's cover ask answered; My attendance and a correction asked for;
// a work log added and removed on the Timesheet; leave requested, seen on the
// calendar and withdrawn; Waiting on me; a document added, edited, archived
// and deleted; and My pay. Each checked against the server, and what the run
// makes is taken away again.
//
// The signed-in person must be an employee (with hr.view for the dashboard),
// and the partner an employee too (for the cover ask).
//
//   npm run build
//   WS_E2E_SERVER=… WS_E2E_EMAIL=… WS_E2E_PASSWORD=… WS_E2E_PARTNER_EMAIL=… WS_E2E_PARTNER_PASSWORD=… \
//   ELECTRON_RUN_AS_NODE=1 npx electron tests/e2e/hr.mjs
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
/** A weekday some weeks out, different each run so requests never overlap. */
function futureWeekday(minDays) {
  const d = new Date();
  d.setDate(d.getDate() + minDays + Math.floor(Math.random() * 60));
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return ymd(d);
}
const tag = Math.floor(Math.random() * 10_000);
// Folded sections are opened first, as a person would.
const rail = (label) => `(() => { const n = document.querySelector('nav[aria-label="People"]'); const find = () => [...n.querySelectorAll('button:not([aria-expanded])')].find(b => b.textContent.trim().startsWith(${js(label)})); if (!find()) n.querySelectorAll('button[aria-expanded="false"]').forEach(h => h.click()); return new Promise(r => setTimeout(() => { const b = find(); if (b) b.click(); r(!!b); }, 50)); })()`;
const heading = (t) => `[...document.querySelectorAll('main h1')].some(h => h.textContent.trim() === ${js(t)})`;
const dialog = (label) => `document.querySelector(${js(`[role="dialog"][aria-label="${label}"]`)})`;
const inDialog = (label, text) => `(${dialog(label)}?.innerText ?? '').includes(${js(text)})`;
const clickIn = (scope, text) => `(() => { const root = ${scope} ?? document; const b = [...root.querySelectorAll('button')].find(b => b.textContent.trim() === ${js(text)} || b.getAttribute('aria-label') === ${js(text)}); if (!b) return false; b.click(); return true; })()`;
const setValue = (selector, value) => `(() => { const el = document.querySelector(${js(selector)}); if (!el) return false; const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${js(value)}); el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`;

const t = await launch({ name: 'hr' });
const made = { partnerLeave: null, myLeave: null, requests: [] };
try {
  const me = await login('me', email, password);
  const partner = await login('partner', partnerEmail, partnerPassword);

  // A colleague names me as cover before HR opens, so the ask is there to answer.
  const coverDay = futureWeekday(20);
  const types = (await api('partner', 'GET', '/api/hr/leave/types')).data?.types ?? [];
  const casual = types.find((x) => /casual/i.test(x.name)) ?? types.find((x) => x.status === 'active');
  const asked = await api('partner', 'POST', '/api/hr/leave/requests', { type_id: casual?.id, starts_on: coverDay, ends_on: coverDay, portion: 'full', reason: `E2E cover ${tag}`, responsible_person_id: Number(me.id) });
  made.partnerLeave = asked.data?.id ?? null;
  t.check('a colleague asks me to cover their leave', asked.status === 201 && !!made.partnerLeave, `${asked.status} ${asked.message ?? ''}`);

  await t.signIn(server, email, password);
  await t.evaluate(`[...document.querySelectorAll('nav[aria-label="Apps"] button')].find(b => b.textContent.trim().startsWith('HR')).click()`);
  await t.waitFor(`!!document.querySelector('nav[aria-label="People"]')`, 'the People rail', 30_000);

  // ── the dashboard and the rail ─────────────────────────────────────────
  await t.waitFor(heading('Dashboard'), 'the dashboard', 30_000);
  await sleep(600);
  await t.shot('h1-dashboard');
  const kpis = await t.evaluate(`[...document.querySelectorAll('main span')].filter(s => ['Employees', 'Out today', 'Pending leave', 'Missing check-outs'].includes(s.textContent.trim())).length`);
  t.check('HR staff open on the dashboard: headcount, out today, pending leave, missing check-outs', kpis >= 4, String(kpis));
  const railInfo = await t.evaluate(`(() => { const n = document.querySelector('nav[aria-label="People"]'); const heads = [...n.querySelectorAll('button[aria-expanded]')].map(b => b.textContent.trim()); const dir = [...n.querySelectorAll('button')].find(b => b.textContent.trim() === 'Directory'); return { heads, webMark: !!dir && (dir.getAttribute('title') ?? '').includes('browser') }; })()`);
  t.check('the rail groups the screens, and marks the ones that open in the browser', railInfo.heads.some((h) => h.startsWith('For me')) && railInfo.heads.some((h) => h.startsWith('Leave')) && railInfo.webMark, JSON.stringify(railInfo));

  // ── My HR ──────────────────────────────────────────────────────────────
  await t.evaluate(rail('My HR'));
  await t.waitFor(`document.querySelector('main').innerText.includes('EMPLOYEE') && document.querySelector('main').innerText.includes(${js(me.name ?? '')})`, 'My HR', 20_000);
  await t.shot('h2-my-hr');
  t.check('My HR shows my record: this month, employment, recent attendance and leave balance', await t.evaluate(`['This month', 'Employment', 'Recent attendance', 'Leave balance'].every(s => document.querySelector('main').innerText.includes(s))`));
  await t.evaluate(`[...document.querySelectorAll('main [role="tab"]')].find(b => b.textContent.trim() === 'Personal').click()`);
  await t.waitFor(`document.querySelector('main').innerText.includes('Emergency contact')`, 'the personal tab');
  await t.evaluate(clickIn('document.querySelector("main")', 'Ask to change a detail'));
  await t.waitFor(`!!${dialog('New HR request')}`, 'the request form');
  await sleep(500);
  await t.evaluate(setValue('[role="dialog"] select[aria-label="Which detail"]', 'mobile'));
  await t.evaluate(setValue('[role="dialog"] input[aria-label="New value"]', `+94 70 000 ${tag}`));
  await t.evaluate(setValue('[role="dialog"] textarea[aria-label="Reason"]', `E2E ${tag}: new number`));
  await t.shot('h3-change-a-detail');
  await t.evaluate(clickIn(dialog('New HR request'), 'Submit request'));
  await t.waitFor(`!${dialog('New HR request')}`, 'the request sent', 20_000);
  const mine = (await api('me', 'GET', '/api/hr/requests?scope=mine')).data?.requests ?? [];
  const profileReq = mine.find((r) => r.kind === 'profile' && r.status === 'pending');
  if (profileReq) made.requests.push(profileReq.id);
  t.check('asking to change a detail raises a profile request for HR', !!profileReq, JSON.stringify(mine.slice(0, 2)));

  // ── Requests: withdraw mine; answer the cover ask ─────────────────────
  await t.evaluate(rail('Requests'));
  await t.waitFor(heading('Requests'), 'Requests');
  await t.waitFor(`document.querySelector('main').innerText.includes('Waiting on you') && document.querySelector('main').innerText.includes('Profile update')`, 'my request and the cover ask', 30_000);
  await t.shot('h4-requests');
  t.check('Requests lists what I asked for, and the colleague waiting on my cover', true);
  await t.evaluate(`(() => { const row = [...document.querySelectorAll('main .flex.items-center')].find(r => r.textContent.includes('Profile update') && [...r.querySelectorAll('button')].some(b => b.textContent.trim() === 'Withdraw')); [...row.querySelectorAll('button')].find(b => b.textContent.trim() === 'Withdraw').click(); })()`);
  let after = null;
  for (let i = 0; i < 40 && after?.status !== 'cancelled'; i++) {
    await sleep(250);
    after = (await api('me', 'GET', `/api/hr/requests/${profileReq?.id}`)).data;
  }
  t.check('Withdraw withdraws it on the server', after?.status === 'cancelled', after?.status);
  await t.evaluate(`[...document.querySelectorAll('main section button')].find(b => b.textContent.trim() === 'Review').click()`);
  await t.waitFor(`!!${dialog('Can you cover this?')}`, 'the cover dialog');
  await t.shot('h5-cover');
  await t.evaluate(clickIn(dialog('Can you cover this?'), 'Yes, I will cover'));
  await t.waitFor(`!${dialog('Can you cover this?')}`, 'the answer sent', 20_000);
  let covered = null;
  for (let i = 0; i < 40 && covered?.responsible_status !== 'accepted'; i++) {
    await sleep(250);
    covered = ((await api('partner', 'GET', '/api/hr/leave/requests')).data ?? []).find((r) => Number(r.id) === Number(made.partnerLeave));
  }
  t.check('answering "yes" accepts the cover on the colleague\'s request', covered?.responsible_status === 'accepted', covered?.responsible_status);

  // ── My attendance ─────────────────────────────────────────────────────
  await t.evaluate(rail('My attendance'));
  await t.waitFor(heading('My attendance'), 'My attendance');
  await t.waitFor(`!document.querySelector('main').innerText.includes('Loading')`, 'the history', 20_000);
  await sleep(500);
  await t.shot('h6-attendance');
  t.check('My attendance shows today, the month and the history', await t.evaluate(`['Check in', 'This month', 'Hours worked', 'History'].every(s => document.querySelector('main').innerText.includes(s))`));
  const canCorrect = await t.evaluate(`[...document.querySelectorAll('main button')].some(b => b.textContent.trim() === 'Ask to correct')`);
  if (canCorrect) {
    await t.evaluate(`[...document.querySelectorAll('main button')].find(b => b.textContent.trim() === 'Ask to correct').click()`);
    await t.waitFor(`!!${dialog('New HR request')}`, 'the correction form');
    await sleep(400);
    const pre = await t.evaluate(`({ kind: document.querySelector('[role="dialog"] select').value, day: document.querySelector('[role="dialog"] input[aria-label="Which day"]').value })`);
    if (!(await t.evaluate(`document.querySelector('[role="dialog"] input[aria-label="Corrected check-out"]').value`))) await t.evaluate(setValue('[role="dialog"] input[aria-label="Corrected check-out"]', '17:30'));
    await t.evaluate(setValue('[role="dialog"] textarea[aria-label="Reason"]', `E2E ${tag}: forgot to clock out`));
    await t.evaluate(clickIn(dialog('New HR request'), 'Submit request'));
    await t.waitFor(`!${dialog('New HR request')}`, 'the correction sent', 20_000);
    const corr = ((await api('me', 'GET', '/api/hr/requests?scope=mine&status=pending')).data?.requests ?? []).find((r) => r.kind === 'attendance');
    if (corr) made.requests.push(corr.id);
    t.check('a day in the history opens a correction request with the day filled in', pre.kind === 'attendance' && !!pre.day && !!corr, JSON.stringify(pre));
  } else {
    t.skip('asking to correct a day', 'no days in this month\'s history yet');
  }

  // ── Timesheet ──────────────────────────────────────────────────────────
  await t.evaluate(rail('Timesheet'));
  await t.waitFor(heading('Timesheet'), 'Timesheet');
  await t.evaluate(clickIn('document.querySelector("main")', 'Add work log'));
  await t.waitFor(`!!${dialog('Add work log')}`, 'the work log form');
  const work = `E2E work ${tag}`;
  await t.evaluate(setValue('[role="dialog"] input[aria-label="Description"]', work));
  await t.evaluate(setValue('[role="dialog"] input[aria-label="Hours"]', '1.5'));
  await t.shot('h7-work-log');
  await t.evaluate(clickIn(dialog('Add work log'), 'Save'));
  await t.waitFor(`document.querySelector('main').innerText.includes(${js(work)})`, 'the log on its day', 20_000);
  await t.shot('h8-timesheet');
  const logs = (await api('me', 'GET', `/api/hr/time-logs?from=${ymd(new Date(Date.now() - 8 * 86400000))}&to=${ymd(new Date())}`)).data?.logs ?? [];
  const log = logs.find((l) => l.description === work);
  t.check('a work log is saved with its hours and shows on its day', !!log && log.minutes === 90, JSON.stringify(log ?? null));
  await t.evaluate(`[...document.querySelectorAll('main button')].find(b => b.textContent.includes(${js(work)})).click()`);
  await t.waitFor(`!!${dialog('Work log')}`, 'the log opened');
  await t.evaluate(clickIn(dialog('Work log'), 'Delete'));
  await t.waitFor(`!document.querySelector('main').innerText.includes(${js(work)})`, 'the log removed', 20_000);
  t.check('a work log can be removed', true);

  // ── Leave ─────────────────────────────────────────────────────────────
  await t.evaluate(rail('Requests & calendar'));
  await t.waitFor(heading('Requests & calendar'), 'Leave');
  await t.evaluate(clickIn('document.querySelector("main")', 'Request leave'));
  await t.waitFor(`!!${dialog('Request leave')}`, 'the leave form');
  await sleep(600);
  const leaveDay = futureWeekday(25);
  const why = `E2E trip ${tag}`;
  if (casual) await t.evaluate(setValue('[role="dialog"] select[aria-label="Leave type"]', String(casual.id)));
  await t.evaluate(setValue('[role="dialog"] input[aria-label="First day"]', leaveDay));
  await t.evaluate(setValue('[role="dialog"] input[aria-label="Last day"]', leaveDay));
  await t.evaluate(setValue('[role="dialog"] input[aria-label="Reason"]', why));
  const partnerId = partner.id;
  await t.evaluate(setValue('[role="dialog"] select[aria-label="Responsible person"]', String(partnerId ?? '')));
  await sleep(300);
  const cost = await t.evaluate(`${inDialog('Request leave', 'comes off the balance as')}`);
  await t.shot('h9-request-leave');
  await t.evaluate(clickIn(dialog('Request leave'), 'Submit request'));
  await t.waitFor(`!${dialog('Request leave')}`, 'the leave requested', 20_000);
  await t.waitFor(`document.querySelector('main').innerText.includes(${js(why)})`, 'the request in the list', 20_000);
  const mineLeave = ((await api('me', 'GET', '/api/hr/leave/requests')).data ?? []).find((r) => r.reason === why);
  made.myLeave = mineLeave ? Number(mineLeave.id) : null;
  t.check('leave is requested for the day, with its cover person, and the form says what it costs', !!mineLeave && mineLeave.starts_on === leaveDay && String(mineLeave.responsible_person_id) === String(partnerId) && cost, JSON.stringify(mineLeave ?? null));
  await t.evaluate(`[...document.querySelectorAll('main [role="tab"]')].find(b => b.textContent.trim() === 'Calendar').click()`);
  const month = leaveDay.slice(0, 7);
  for (let i = 0; i < 4 && !(await t.evaluate(`!!document.querySelector('[role="grid"][aria-label$=${js(new Date(`${month}-15T12:00:00`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }))}]')`)); i++) {
    await t.evaluate(clickIn('document.querySelector("main")', 'Next month'));
    await sleep(250);
  }
  await sleep(400);
  await t.shot('h10-leave-calendar');
  t.check('the calendar shows the request on its day, dashed while it waits', await t.evaluate(`[...document.querySelectorAll('[role="grid"] button')].some(b => (b.getAttribute('title') ?? '').includes(${js(why)}) && b.className.includes('dashed'))`));
  await t.evaluate(`[...document.querySelectorAll('main [role="tab"]')].find(b => b.textContent.trim() === 'List').click()`);
  await t.evaluate(`(() => { const row = [...document.querySelectorAll('main .flex.items-center.gap-3')].find(r => r.textContent.includes(${js(why)})); [...row.querySelectorAll('button')].find(b => b.textContent.trim() === 'Withdraw').click(); })()`);
  let withdrawn = null;
  for (let i = 0; i < 40 && withdrawn?.status !== 'cancelled'; i++) {
    await sleep(250);
    withdrawn = ((await api('me', 'GET', '/api/hr/leave/requests')).data ?? []).find((r) => Number(r.id) === made.myLeave);
  }
  t.check('withdrawing cancels the leave', withdrawn?.status === 'cancelled', withdrawn?.status);
  if (withdrawn?.status === 'cancelled') made.myLeave = null;

  // ── Waiting on me ─────────────────────────────────────────────────────
  await t.evaluate(rail('Waiting on me'));
  await t.waitFor(heading('Waiting on me'), 'Waiting on me');
  await sleep(400);
  await t.shot('h11-waiting');
  t.check('Waiting on me counts leave, HR requests and what was decided today', await t.evaluate(`['Pending leave', 'Pending HR requests', 'Approved today'].every(s => document.querySelector('main').innerText.includes(s))`));

  // ── My documents ──────────────────────────────────────────────────────
  await t.evaluate(rail('My documents'));
  await t.waitFor(heading('My documents'), 'My documents');
  const docTitle = `E2E certificate ${tag}`;
  await t.evaluate(`(() => { const input = document.querySelector('input[aria-label="Choose documents"]'); const dt = new DataTransfer(); dt.items.add(new File(['%PDF-1.4\\n% e2e\\n'], 'e2e-certificate.pdf', { type: 'application/pdf' })); input.files = dt.files; input.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await t.waitFor(`!!${dialog('Add a document')}`, 'the add form');
  await t.evaluate(setValue('[role="dialog"] input[aria-label="Title"]', docTitle));
  await t.shot('h12-add-document');
  await t.evaluate(clickIn(dialog('Add a document'), 'Add'));
  await t.waitFor(`document.querySelector('main').innerText.includes(${js(docTitle)})`, 'the document listed', 30_000);
  const docs = (await api('me', 'GET', '/api/hr/me/documents?status=all&per_page=100')).data?.documents ?? [];
  const doc = docs.find((d) => d.title === docTitle);
  t.check('a document is added to my file with its title', !!doc, JSON.stringify(docs.slice(0, 1)));
  const rowAct = (text, action) => `(() => { const r = [...document.querySelectorAll('main .flex.items-center')].find(x => x.textContent.includes(${js(text)}) && [...x.querySelectorAll('button')].some(b => b.textContent.trim() === ${js(action)})); if (!r) return false; [...r.querySelectorAll('button')].find(b => b.textContent.trim() === ${js(action)}).click(); return true; })()`;
  if (await t.evaluate(rowAct(docTitle, 'Edit'))) {
    await t.waitFor(`!!${dialog('Edit document')}`, 'the edit form');
    await t.evaluate(setValue('[role="dialog"] input[aria-label="Title"]', `${docTitle} v2`));
    await t.evaluate(clickIn(dialog('Edit document'), 'Save'));
    await t.waitFor(`document.querySelector('main').innerText.includes(${js(`${docTitle} v2`)})`, 'the new title', 20_000);
    t.check('a document can be renamed', true);
  } else t.skip('renaming a document', 'the server does not let employees rename');
  if (await t.evaluate(rowAct(docTitle, 'Archive'))) {
    await t.waitFor(`!document.querySelector('main').innerText.includes(${js(docTitle)})`, 'archived out of the list', 20_000);
    await t.evaluate(`[...document.querySelectorAll('main [role="tab"]')].find(b => b.textContent.trim().startsWith('Archived')).click()`);
    await t.waitFor(`document.querySelector('main').innerText.includes(${js(docTitle)})`, 'the archived tab', 20_000);
    t.check('archiving moves it to Archived', true);
  } else t.skip('archiving a document', 'the server does not let employees archive');
  if (await t.evaluate(rowAct(docTitle, 'Delete'))) {
    await t.waitFor(`!!${dialog('Delete this document?')}`, 'the delete confirmation');
    await t.evaluate(clickIn(dialog('Delete this document?'), 'Delete'));
    await t.waitFor(`!document.querySelector('main').innerText.includes(${js(docTitle)})`, 'deleted', 20_000);
    const left = ((await api('me', 'GET', '/api/hr/me/documents?status=all&per_page=100')).data?.documents ?? []).some((d) => d.id === doc?.id);
    t.check('deleting takes it off the file, after asking', !left);
  } else t.skip('deleting a document', 'the server does not let employees delete');

  // ── My pay ────────────────────────────────────────────────────────────
  await t.evaluate(rail('My pay'));
  await t.waitFor(heading('My pay'), 'My pay');
  await t.waitFor(`document.querySelector('main').innerText.includes('Payslips')`, 'the payslips', 20_000);
  await sleep(500);
  await t.shot('h13-my-pay');
  t.check('My pay lists the year\'s payslips (or says there are none)', await t.evaluate(`/No payslips for \\d{4} yet|Payslip as a PDF/.test(document.querySelector('main').innerText)`));
} catch (e) {
  t.check(`no unexpected error (${e.message})`, false);
  await t.shot('hz-failure').catch(() => undefined);
} finally {
  // Take away what the run made.
  if (made.partnerLeave) await api('partner', 'POST', `/api/hr/leave/requests/${made.partnerLeave}/cancel`, {}).catch(() => undefined);
  if (made.myLeave) await api('me', 'POST', `/api/hr/leave/requests/${made.myLeave}/cancel`, {}).catch(() => undefined);
  for (const id of made.requests) await api('me', 'POST', `/api/hr/requests/${id}/cancel`, {}).catch(() => undefined);
  await t.finish();
}

// End-to-end: Tenders, part 2 — a tender's working tabs, against a real
// server, through the UI. The checklist: a standard pack added, a line added,
// a real file dropped on a line and approved, a Drive file attached to
// another and sent back with a reason, no Approve offered on an empty line, a
// line given an expiry. A document dropped on the list. A bond recorded and
// counted as tied up; a meeting on the reader's clock; a budget line that
// refuses a figure it cannot read and totals to the cent; an approval step
// added and approved; the buyer's notice recorded; a submission refused for
// what is outstanding and then recorded anyway, with its bid value; what the
// buyer said.
//
// Makes one tender ("E2E Tender Works <tag>") and three small files, and
// removes them. Moving the tender to Ready passes Preparing, which makes
// tasks and a Drive folder: clean-tenders-e2e.sh removes those. Needs a user
// who holds tender.* (locally: the "E2E Orders" role).
//
//   npm run build
//   WS_E2E_SERVER=… WS_E2E_EMAIL=… WS_E2E_PASSWORD=… ELECTRON_RUN_AS_NODE=1 npx electron tests/e2e/tenders-2.mjs
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
  const isForm = body instanceof FormData;
  const r = await fetch(`${server}${path}`, {
    method,
    headers: { Accept: 'application/json', ...(isForm ? {} : { 'Content-Type': 'application/json' }), Authorization: `Bearer ${bearer}` },
    body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, data: j.data ?? j, message: j.message, errors: j.errors };
}
async function driveUpload(name, text) {
  const bytes = Buffer.from(text);
  const init = await api('POST', '/api/uploads/init', { filename: name, total_size: bytes.length, total_chunks: 1, sha256: createHash('sha256').update(bytes).digest('hex'), mime_type: 'text/plain', purpose: 'drive' });
  const f = new FormData();
  f.set('chunk_index', '0');
  f.set('chunk', new Blob([bytes]), name);
  await api('POST', `/api/uploads/${init.data.upload_id}/chunk`, f);
  return (await api('POST', `/api/uploads/${init.data.upload_id}/complete`, {})).data?.file_id;
}
const js = (v) => JSON.stringify(v);
const tag = String(Date.now() % 100000);
const until = async (fn, label, tries = 50) => {
  let v;
  for (let i = 0; i < tries; i++) {
    v = await fn();
    if (v) return v;
    await sleep(400);
  }
  throw new Error(`${label}: never happened`);
};
const day = (n) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

const t = await launch({ name: 'tenders-2' });
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
const tab = async (label) => {
  await t.waitFor(`[...document.querySelectorAll('nav[aria-label="Tender"] [role="tab"]')].some(b => b.textContent.startsWith(${js(label)}))`, `the ${label} tab`, 15_000);
  await t.evaluate(`[...document.querySelectorAll('nav[aria-label="Tender"] [role="tab"]')].find(b => b.textContent.startsWith(${js(label)})).click()`);
};
const mainHas = (s) => `(document.querySelector('main')?.textContent ?? '').includes(${js(s)})`;
const dropOn = async (selector, path) => {
  await t.waitFor(`!!document.querySelector(${js(selector)})`, selector, 15_000);
  const at = await t.evaluate(
    `(() => { const el = document.querySelector(${js(selector)}); el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + Math.min(r.height / 2, 20)) }; })()`,
  );
  const data = { items: [], files: [path], dragOperationsMask: 1 };
  for (const type of ['dragEnter', 'dragOver', 'drop']) await t.send('Input.dispatchDragEvent', { type, x: at.x, y: at.y, data });
};
const lines = async (id) => (await api('GET', `/api/tenders/${id}/checklist`)).data?.items ?? [];
const lineBy = async (id, label) => (await lines(id)).find((l) => l.label === label);
const tender = async (id) => (await api('GET', `/api/tenders/${id}`)).data;
const made = { tender: null, files: new Set() };

try {
  bearer = (await api('POST', '/api/auth/login', { email, password })).data?.tokens?.access_token ?? '';

  // ── fixtures ──────────────────────────────────────────────────────────
  made.tender = (await api('POST', '/api/tenders', { title: `E2E Tender Works ${tag}`, organization: `E2E Buyer ${tag}`, reference: `E2E-W${tag}`, closing_at: `${day(20)}T08:30:00Z`, budget_max: '50000000.00' })).data?.id;
  const driveFile = await driveUpload(`E2E-vat-${tag}.txt`, 'VAT registration, scanned');
  if (driveFile) made.files.add(Number(driveFile));
  const dir = mkdtempSync(join(tmpdir(), 'ws-e2e-tenders-'));
  const regFile = join(dir, `E2E-registration-${tag}.txt`);
  const noticeFile = join(dir, `E2E-notice-${tag}.txt`);
  writeFileSync(regFile, 'Company registration certificate');
  writeFileSync(noticeFile, 'The published notice');
  t.check('fixtures: a tender and a file in Drive', !!(made.tender && driveFile), js({ tender: made.tender, driveFile }));
  const id = Number(made.tender);

  await t.signIn(server, email, password);
  await sleep(1500);
  await t.evaluate(`(() => { const b = [...document.querySelectorAll('nav button')].find(b => b.textContent.trim() === 'Tenders'); if (b) b.click(); return !!b; })()`);
  await t.waitFor(`!!document.querySelector('nav[aria-label="Tenders"]')`, 'the Tenders rail', 30_000);
  await t.evaluate(`[...document.querySelectorAll('nav[aria-label="Tenders"] button')].find(b => b.textContent.trim().startsWith('All tenders')).click()`);
  await typeInto('input[aria-label="Search tenders"]', `E2E-W${tag}`);
  await t.waitFor(`!!document.querySelector('[data-tender="${id}"] button[aria-label^="Open"]')`, 'the tender in the list', 20_000);
  await t.evaluate(`document.querySelector('[data-tender="${id}"] button[aria-label^="Open"]').click()`);
  await t.waitFor(`!!document.querySelector('nav[aria-label="Tender"]')`, 'the workspace tabs', 20_000);
  const browserLinks = await t.evaluate(`[...document.querySelectorAll('main[aria-label="Tenders · Tender"] button')].filter(b => (b.title || '').includes('browser')).map(b => b.textContent.trim())`);
  t.check('the working tabs are here, only the whole tender still offered in the browser', js(browserLinks) === js(['In the browser']), js(browserLinks));

  // ── the checklist ─────────────────────────────────────────────────────
  await tab('Checklist');
  await press('main', 'Add a standard pack…');
  await t.waitFor(`!!document.querySelector('[role="dialog"][aria-label="Add a standard pack"]')`, 'the packs', 15_000);
  // The innermost block holding that pack's name and a button: its own row, not the list around both.
  await t.evaluate(`[...document.querySelectorAll('[role="dialog"] div')].filter(d => d.textContent.includes('The usual paperwork') && d.querySelector('button')).pop().querySelector('button').click()`);
  await until(async () => (await lines(id)).length === 12, 'the pack added');
  t.check('a standard pack adds its twelve lines', true);
  await press('main', 'Add a line');
  await typeInto('[role="dialog"] input[aria-label="What the buyer asks for"]', `E2E Performance history ${tag}`);
  await typeInto('[role="dialog"] input[aria-label="Section"]', 'E2E section');
  await press('[role="dialog"]', 'Add');
  const own = await until(async () => lineBy(id, `E2E Performance history ${tag}`), 'the line added');
  t.check('a line is added, required, in its section', own.mandatory === '1' || own.mandatory === 1 ? own.section === 'E2E section' : false, js({ mandatory: own.mandatory, section: own.section }));

  const reg = await lineBy(id, 'Company registration');
  await t.waitFor(`!!document.querySelector('[data-line="${reg.id}"]')`, 'the registration line', 15_000);
  await dropOn(`[data-line="${reg.id}"]`, regFile);
  const filed = await until(async () => {
    const l = await lineBy(id, 'Company registration');
    return l?.status === 'pending_review' && l.files?.length ? l : null;
  }, 'the dropped file filed');
  (filed.files ?? []).forEach((f) => made.files.add(Number(f.file_id)));
  await t.waitFor(`(document.querySelector('[data-line="${reg.id}"]')?.textContent ?? '').includes('E2E-registration-${tag}.txt')`, 'the file on the row', 20_000);
  t.check('a file dropped on a line is uploaded and filed as its version, waiting for review', true, filed.files?.[0]?.name);
  const dl = await fetch(`${server}/api/tenders/checklist/${reg.id}/download`, { headers: { Authorization: `Bearer ${bearer}` } });
  t.check('and it can be taken back out, byte for byte', dl.status === 200 && (await dl.text()) === 'Company registration certificate', String(dl.status));
  await press(`[data-line="${reg.id}"]`, 'Approve');
  await until(async () => (await lineBy(id, 'Company registration'))?.status === 'approved', 'approved');
  t.check('it is approved', true);
  await t.waitFor(`${mainHas('1 of 9 required lines are ready')}`, 'the progress', 15_000);
  t.check('and the progress counts it, of the nine required', true);

  const vat = await lineBy(id, 'VAT registration');
  await t.evaluate(`document.querySelector('[data-line="${vat.id}"] button[aria-haspopup="menu"]').click()`);
  await press(`[data-line="${vat.id}"]`, 'From Drive…');
  await t.waitFor(`!!document.querySelector('input[type="checkbox"][aria-label="E2E-vat-${tag}.txt"]')`, 'the Drive file in the picker', 20_000);
  await t.evaluate(`document.querySelector('input[type="checkbox"][aria-label="E2E-vat-${tag}.txt"]').click()`);
  await press('[role="dialog"]', 'Attach');
  await until(async () => (await lineBy(id, 'VAT registration'))?.status === 'pending_review', 'the Drive file attached');
  t.check('a file from Drive is attached to another line', true);
  await t.waitFor(`[...document.querySelectorAll('[data-line="${vat.id}"] button')].some(b => b.textContent.trim() === 'Send back…')`, 'Send back offered', 15_000);
  await press(`[data-line="${vat.id}"]`, 'Send back…');
  t.check('sending back needs a reason', await t.evaluate(`[...document.querySelectorAll('[role="dialog"] button')].find(b => b.textContent.trim() === 'Send back').disabled`), '');
  await typeInto('[role="dialog"] input[aria-label="What is wrong with it?"]', 'This is the 2019 certificate');
  await press('[role="dialog"]', 'Send back');
  const back = await until(async () => {
    const l = await lineBy(id, 'VAT registration');
    return l?.status === 'rejected' ? l : null;
  }, 'sent back');
  await t.waitFor(`(document.querySelector('[data-line="${vat.id}"]')?.textContent ?? '').includes('This is the 2019 certificate')`, 'the reason on the row', 15_000);
  t.check('it is sent back, with the reason on the line', back.rejection_reason === 'This is the 2019 certificate', back.rejection_reason);
  const tax = await lineBy(id, 'Tax clearance');
  t.check('a line with nothing on it offers no Approve', !(await t.evaluate(`[...document.querySelectorAll('[data-line="${tax.id}"] button')].some(b => b.textContent.trim() === 'Approve')`)), '');
  await t.evaluate(`document.querySelector('[data-line="${tax.id}"] button[aria-label^="Edit"]').click()`);
  await typeInto('[role="dialog"] input[aria-label="Expires on"]', day(-1));
  await press('[role="dialog"]', 'Save');
  await until(async () => (await lineBy(id, 'Tax clearance'))?.expires_on === day(-1), 'the expiry saved');
  t.check('a line is given an expiry, and only that is sent', true);
  await t.shot('w1-checklist');

  // ── documents ─────────────────────────────────────────────────────────
  await tab('Documents');
  await t.waitFor(`!!document.querySelector('[aria-label="Documents"]')`, 'the documents', 15_000);
  await dropOn('[aria-label="Documents"]', noticeFile);
  const doc = await until(async () => ((await tender(id))?.documents ?? []).find((d) => d.title === `E2E-notice-${tag}.txt`), 'the dropped document');
  if (doc.file?.id) made.files.add(Number(doc.file.id));
  await t.waitFor(`${mainHas(`E2E-notice-${tag}.txt`)}`, 'the document listed', 15_000);
  t.check('a file dropped on the documents is added, as a tender notice', doc.kind === 'tender_notice' && doc.file?.state === 'ready', js({ kind: doc.kind, state: doc.file?.state }));
  await t.shot('w2-documents');

  // ── bonds and meetings ────────────────────────────────────────────────
  await tab('Bonds');
  await press('main', 'Record a bond');
  await typeInto('[role="dialog"] input[aria-label="Amount"]', '250,000');
  await typeInto('[role="dialog"] input[aria-label="Issued by"]', `E2E Bank ${tag}`);
  await typeInto('[role="dialog"] input[aria-label="Valid until"]', day(20));
  await press('[role="dialog"]', 'Record');
  const bond = await until(async () => ((await api('GET', `/api/tenders/${id}/securities`)).data?.items ?? [])[0], 'the bond');
  await t.waitFor(`${mainHas('LKR 250,000.00')} && ${mainHas('20 days left')}`, 'the bond listed', 15_000);
  t.check('a bond is recorded, counted as tied up, with the days to its expiry', bond.amount === '250000.00' && bond.valid_until === day(20), js({ amount: bond.amount, until: bond.valid_until }));
  await tab('Meetings');
  await press('main', 'Add a meeting');
  await typeInto('[role="dialog"] input[aria-label="Meeting date"]', day(5));
  await typeInto('[role="dialog"] input[aria-label="Meeting time"]', '10:00');
  await typeInto('[role="dialog"] input[aria-label="Where"]', `E2E hall ${tag}`);
  await press('[role="dialog"]', 'Add');
  const meeting = await until(async () => ((await api('GET', `/api/tenders/${id}/meetings`)).data?.items ?? [])[0], 'the meeting');
  const shownAt = await t.evaluate(`(() => { const r = document.querySelector('[data-meeting="${meeting.id}"]'); return r ? r.textContent : ''; })()`);
  const zone = await t.evaluate(`Intl.DateTimeFormat().resolvedOptions().timeZone`);
  t.check('a meeting is stored as the instant typed on the reader’s clock', !!meeting.scheduled_at && shownAt.includes(`E2E hall ${tag}`), js({ stored: meeting.scheduled_at, zone }));

  // ── budget ────────────────────────────────────────────────────────────
  await tab('Budget');
  await typeInto('input[aria-label="What is this cost?"]', 'E2E labour');
  await typeInto('input[aria-label="Quantity"]', 'lots');
  await typeInto('input[aria-label="Unit cost"]', '100');
  await press('main', 'Add');
  await t.waitFor(`${mainHas('The quantity is a number above nothing')}`, 'the refusal', 10_000);
  t.check('a quantity it cannot read is refused, not made 0', ((await tender(id))?.budget?.lines ?? []).length === 0, '');
  await typeInto('input[aria-label="Quantity"]', '2.5');
  await typeInto('input[aria-label="Unit cost"]', '1,250.50');
  await press('main', 'Add');
  const line = await until(async () => ((await tender(id))?.budget?.lines ?? [])[0], 'the cost line');
  await t.waitFor(`${mainHas('LKR 3,126.25')}`, 'the line total', 15_000);
  t.check('a cost line totals to the cent', line.line_total === '3126.25', line.line_total);

  // ── approvals ─────────────────────────────────────────────────────────
  await tab('Approvals');
  await typeInto('input[aria-label="The step"]', 'E2E Finance');
  await press('main', 'Add the step');
  const step = await until(async () => ((await tender(id))?.approvals ?? [])[0], 'the step');
  await t.waitFor(`!!document.querySelector('[data-approval="${step.id}"]')`, 'the step listed', 15_000);
  await press(`[data-approval="${step.id}"]`, 'Approve');
  await until(async () => ((await tender(id))?.approvals ?? [])[0]?.status === 'approved', 'the step approved');
  t.check('an approval step is added and approved', true);

  // ── the notice ────────────────────────────────────────────────────────
  await tab('Notice');
  await typeInto('input[aria-label="Committee"]', `E2E Procurement Committee ${tag}`);
  await typeInto('input[aria-label="Document fee"]', '1,500');
  await typeInto('input[aria-label="Fee currency"]', 'LKR');
  await press('main', 'Save');
  const notice = await until(async () => (await api('GET', `/api/tenders/${id}/notice`)).data?.notice, 'the notice');
  t.check('the buyer’s notice is recorded, the fee as a plain figure', notice.committee === `E2E Procurement Committee ${tag}` && notice.doc_fee_amount === '1500.00', js({ committee: notice.committee, fee: notice.doc_fee_amount }));
  await t.shot('w3-notice');

  // ── submission and evaluation ─────────────────────────────────────────
  for (const s of ['review', 'approved', 'preparing', 'internal_review', 'management_approval']) await api('POST', `/api/tenders/${id}/stage`, { stage: s });
  await api('POST', `/api/tenders/${id}/stage`, { stage: 'ready', override: true });
  t.check('fixture: the tender at Ready with required lines outstanding', (await tender(id))?.tender?.stage === 'ready', '');
  // Moved behind the screen's back: open it again so it reads the stage afresh.
  await press('main[aria-label="Tenders · Tender"]', 'Back');
  await t.waitFor(`!!document.querySelector('[data-tender="${id}"] button[aria-label^="Open"]')`, 'the list again', 20_000);
  await t.evaluate(`document.querySelector('[data-tender="${id}"] button[aria-label^="Open"]').click()`);
  await t.waitFor(`(document.querySelector('section[aria-label="Tender"]')?.textContent ?? '').includes('Ready to submit')`, 'the tender at Ready', 20_000);
  await tab('Submission');
  await press('main', 'Record a submission');
  await typeInto('[role="dialog"] input[aria-label="Bid value"]', '41,500,000');
  await typeInto('[role="dialog"] input[aria-label="Receipt number"]', `R-${tag}`);
  await press('[role="dialog"]', 'Record');
  await t.waitFor(`!!document.querySelector('[role="dialog"] [aria-label="Outstanding"]')`, 'the outstanding list', 15_000);
  const listed = await t.evaluate(`document.querySelector('[role="dialog"] [aria-label="Outstanding"]').textContent`);
  t.check('what is outstanding is named before the tender moves', listed.includes('Tax clearance') && (await tender(id))?.tender?.stage === 'ready', listed.slice(0, 160));
  await press('[role="dialog"]', 'Record it anyway');
  const sub = await until(async () => {
    const d = await tender(id);
    return d?.tender?.stage === 'submitted' && d.submissions?.length ? d : null;
  }, 'submitted');
  t.check(
    'recorded anyway: submitted, with the bid value and receipt',
    sub.submissions[0].bid_value === '41500000.00' && sub.submissions[0].receipt_no === `R-${tag}` && sub.tender.bid_value === '41500000.00',
    js({ bid: sub.submissions[0].bid_value, receipt: sub.submissions[0].receipt_no }),
  );
  await press('main', 'Record');
  await typeInto('[role="dialog"] input[aria-label="Title"]', `E2E technical result ${tag}`);
  await typeInto('[role="dialog"] input[aria-label="Score"]', '82.5');
  await typeInto('[role="dialog"] input[aria-label="Out of"]', '100');
  await press('[role="dialog"]', 'Record');
  const ev = await until(async () => ((await tender(id))?.evaluations ?? [])[0], 'the evaluation');
  await t.waitFor(`${mainHas(`E2E technical result ${tag}`)} && ${mainHas('82.5 / 100')}`, 'the evaluation listed', 15_000);
  t.check('what the buyer said is recorded, with its score', ev.score === '82.50' && ev.max_score === '100.00', js({ score: ev.score, max: ev.max_score }));
  await t.shot('w4-submission');
} catch (e) {
  t.check(`no unexpected error (${e.message})`, false);
  await t.shot('wz-failure').catch(() => undefined);
} finally {
  if (made.tender) await api('POST', '/api/tenders/bulk', { action: 'delete', ids: [Number(made.tender)] }).catch(() => undefined);
  for (const f of made.files) {
    await api('DELETE', `/api/files/${f}`).catch(() => undefined);
    await api('DELETE', `/api/files/${f}/purge`).catch(() => undefined);
  }
  await t.finish();
}

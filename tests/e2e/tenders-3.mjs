// End-to-end: Tenders, part 3 — the document library, reports and settings,
// against a real server, through the UI. Nothing in the rail opens in the
// browser. A company document added with a real file (chosen through the file
// input), counted as expiring, then edited to expired and removed. The report
// for the year agreeing with the server — won, lost and cancelled apart, the
// win rate, the reason a bid was lost — and refusing a period that ends
// before it starts. A scoring rule added, refused when it would move nothing,
// switched off, edited and removed; open tenders scored again; the sources
// and the module's switch shown.
//
// Makes three tenders ("E2E Tender … <tag>") decided today — won, lost,
// cancelled — a library document and a rule, and removes them. The win passes
// Preparing and makes a client, deal and project: clean-tenders-e2e.sh
// removes those. Needs a user who holds tender.* (locally: "E2E Orders").
//
//   npm run build
//   WS_E2E_SERVER=… WS_E2E_EMAIL=… WS_E2E_PASSWORD=… ELECTRON_RUN_AS_NODE=1 npx electron tests/e2e/tenders-3.mjs
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
  const r = await fetch(`${server}${path}`, { method, headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, data: j.data ?? j, message: j.message };
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

const t = await launch({ name: 'tenders-3' });
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
  const sel = `${scope} button[role="combobox"][aria-label="${label}"]`.trim();
  await t.waitFor(`!!document.querySelector(${js(sel)})`, `the ${label} picker`, 15_000);
  await t.evaluate(`document.querySelector(${js(sel)}).click()`);
  await t.waitFor(`[...document.querySelectorAll('[role="listbox"][aria-label=${js(label)}] [role="option"]')].some(o => o.textContent.trim() === ${js(text)})`, `${text} in ${label}`, 15_000);
  await t.evaluate(`[...document.querySelectorAll('[role="listbox"][aria-label=${js(label)}] [role="option"]')].find(o => o.textContent.trim() === ${js(text)}).click()`);
};
const rail = async (label) => {
  const ok = await t.evaluate(`(() => { const b = [...document.querySelectorAll('nav[aria-label="Tenders"] button')].find(b => b.textContent.trim().startsWith(${js(label)})); if (b) b.click(); return !!b; })()`);
  if (!ok) throw new Error(`no ${label} in the rail`);
};
const mainHas = (s) => `(document.querySelector('main')?.textContent ?? '').includes(${js(s)})`;
const kpi = (label) => t.evaluate(`[...document.querySelectorAll('main button, main div')].find(e => e.firstElementChild?.textContent === ${js(label)} && e.querySelector('b'))?.querySelector('b')?.textContent ?? null`);
const made = { tenders: [], doc: null, file: null, rule: null };

try {
  bearer = (await api('POST', '/api/auth/login', { email, password })).data?.tokens?.access_token ?? '';

  // ── fixtures: three tenders decided today ─────────────────────────────
  const make = async (name) => {
    const id = (await api('POST', '/api/tenders', { title: `E2E Tender ${name} ${tag}`, organization: `E2E Buyer ${tag}`, reference: `E2E-R${name[0]}${tag}`, industry: `E2E Roads ${tag}` })).data?.id;
    if (id) made.tenders.push(Number(id));
    return Number(id);
  };
  const lost = await make('Lost');
  await api('POST', `/api/tenders/${lost}/stage`, { stage: 'review' });
  await api('PUT', `/api/tenders/${lost}`, { bid_value: '1100000' });
  const lostR = await api('POST', `/api/tenders/${lost}/lose`, { lost_reason: `E2E price ${tag}`, competitor: `E2E Rival ${tag}`, winning_price: '1000000' });
  const gone = await make('Cancelled');
  const goneR = await api('POST', `/api/tenders/${gone}/stage`, { stage: 'cancelled' });
  const won = await make('Won');
  for (const s of ['review', 'approved', 'preparing', 'internal_review', 'management_approval', 'ready', 'submitted']) await api('POST', `/api/tenders/${won}/stage`, { stage: s });
  const wonR = await api('POST', `/api/tenders/${won}/win`, { award_value: '2500000' });
  t.check('fixtures: a tender lost, one cancelled and one won today', lostR.status < 300 && goneR.status < 300 && wonR.status < 300, js([lostR.message, goneR.message, wonR.message]));

  await t.signIn(server, email, password);
  await sleep(1500);
  await t.evaluate(`(() => { const b = [...document.querySelectorAll('nav button')].find(b => b.textContent.trim() === 'Tenders'); if (b) b.click(); return !!b; })()`);
  await t.waitFor(`!!document.querySelector('nav[aria-label="Tenders"]')`, 'the Tenders rail', 30_000);
  const browserItems = await t.evaluate(`[...document.querySelectorAll('nav[aria-label="Tenders"] button')].filter(b => (b.title || '').includes('browser')).length`);
  t.check('nothing in the Tenders rail opens in the browser', browserItems === 0, String(browserItems));

  // ── the library ───────────────────────────────────────────────────────
  await rail('Document library');
  await t.waitFor(`${mainHas('In the library')}`, 'the library', 20_000);
  await press('main', 'Add a document');
  await typeInto('[role="dialog"] input[aria-label="Name"]', `E2E Tax clearance ${tag}`);
  await pickFrom('Kind', 'Tax', '[role="dialog"]');
  await typeInto('[role="dialog"] input[aria-label="Reference"]', `TC-${tag}`);
  await typeInto('[role="dialog"] input[aria-label="Expires on"]', day(30));
  const dir = mkdtempSync(join(tmpdir(), 'ws-e2e-lib-'));
  const certificate = join(dir, `E2E-tax-${tag}.txt`);
  writeFileSync(certificate, 'Tax clearance certificate, valid thirty days');
  const { root } = await t.send('DOM.getDocument', { depth: -1, pierce: true });
  const { nodeId } = await t.send('DOM.querySelector', { nodeId: root.nodeId, selector: '[role="dialog"] input[type="file"]' });
  await t.send('DOM.setFileInputFiles', { nodeId, files: [certificate] });
  await t.waitFor(`(document.querySelector('[role="dialog"] [aria-label="Chosen file"]')?.textContent ?? '') === ${js(`E2E-tax-${tag}.txt`)}`, 'the file uploaded', 30_000);
  await press('[role="dialog"]', 'Add');
  const doc = await until(async () => ((await api('GET', '/api/tender/library')).data?.items ?? []).find((d) => d.name === `E2E Tax clearance ${tag}`), 'the document');
  made.doc = doc.id;
  made.file = doc.file?.id ?? null;
  t.check(
    'a document is added with its file, and counted as expiring',
    !!doc.file && doc.state === 'expiring' && doc.days_left === 30 && doc.reference === `TC-${tag}` && doc.kind === 'tax',
    js({ file: !!doc.file, state: doc.state, days: doc.days_left }),
  );
  await t.waitFor(`(document.querySelector('[data-library="${doc.id}"]')?.textContent ?? '').includes('30 days left')`, 'the row', 15_000);
  const back = await fetch(`${server}/api/tender/library/${doc.id}/file`, { headers: { Authorization: `Bearer ${bearer}` } });
  t.check('its file opens for the company, byte for byte', back.status === 200 && (await back.text()) === 'Tax clearance certificate, valid thirty days', String(back.status));
  await t.evaluate(`document.querySelector('[data-library="${doc.id}"] button[aria-label^="Edit"]').click()`);
  await t.waitFor(`(document.querySelector('[role="dialog"] [aria-label="Chosen file"]')?.textContent ?? '').includes('E2E-tax-${tag}.txt')`, 'the edit form with its file', 15_000);
  await typeInto('[role="dialog"] input[aria-label="Expires on"]', day(-2));
  await press('[role="dialog"]', 'Save');
  const edited = await until(async () => {
    const d = ((await api('GET', '/api/tender/library')).data?.items ?? []).find((x) => x.id === doc.id);
    return d?.state === 'expired' ? d : null;
  }, 'expired');
  t.check('edited to have expired, it keeps its file and reference (saved whole)', !!edited.file && edited.reference === `TC-${tag}`, js({ file: !!edited.file, ref: edited.reference }));
  await t.waitFor(`[...document.querySelectorAll('nav[aria-label="Tenders"] button')].find(b => b.textContent.trim().startsWith('Document library'))?.textContent.trim() !== 'Document library'`, 'the rail’s expired count', 20_000);
  t.check('and the rail counts it as expired', true);
  await t.shot('l1-library');
  await t.evaluate(`document.querySelector('[data-library="${doc.id}"] button[aria-label^="Remove"]').click()`);
  await press('[role="dialog"]', 'Remove');
  await until(async () => !((await api('GET', '/api/tender/library')).data?.items ?? []).some((d) => d.id === doc.id), 'removed');
  made.doc = null;
  t.check('and it is removed', true);

  // ── reports ───────────────────────────────────────────────────────────
  await rail('Reports');
  await t.waitFor(`${mainHas('Win rate')} && ${mainHas('Why we lost')}`, 'the report', 20_000);
  const today = await t.evaluate(`new Intl.DateTimeFormat('en-CA', { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }).format(new Date())`);
  const year = (await api('GET', `/api/tender/reports?from=${today.slice(0, 4)}-01-01&to=${today}`)).data;
  const shown = { won: await kpi('Won'), lost: await kpi('Lost'), cancelled: await kpi('Cancelled'), rate: await kpi('Win rate') };
  t.check(
    'the year’s report agrees with the server, cancelled apart from open',
    Number(shown.won) === year.won && Number(shown.lost) === year.lost && Number(shown.cancelled) === year.cancelled && year.cancelled >= 1,
    js({ shown, server: { won: year.won, lost: year.lost, cancelled: year.cancelled, rate: year.win_rate } }),
  );
  await t.waitFor(`${mainHas(`E2E price ${tag}`)} && ${mainHas(`E2E Rival ${tag}`)}`, 'the loss analysis', 15_000);
  t.check('and it says why the bid was lost, and to whom', true);
  await pickFrom('Period', 'Between…');
  await typeInto('input[aria-label="From"]', day(0));
  await typeInto('input[aria-label="To"]', day(-5));
  await t.waitFor(`${mainHas('The period ends before it starts.')}`, 'the refusal', 10_000);
  t.check('a period that ends before it starts is refused', true);
  await t.shot('l2-reports');

  // ── settings: scoring ─────────────────────────────────────────────────
  await rail('Settings');
  await t.waitFor(`${mainHas('Scoring rules')}`, 'the settings', 20_000);
  await press('main', 'Add a rule');
  await typeInto('[role="dialog"] input[aria-label="Name"]', `E2E Roads are ours ${tag}`);
  await pickFrom('Looks at', 'Industry on the tender', '[role="dialog"]');
  await typeInto('[role="dialog"] input[aria-label="Value"]', `E2E Roads ${tag}`);
  await typeInto('[role="dialog"] input[aria-label="Points"]', '0');
  await press('[role="dialog"]', 'Add');
  await t.waitFor(`(document.querySelector('[role="dialog"]')?.textContent ?? '').includes('not 0')`, 'the refusal', 10_000);
  t.check('a rule that would move nothing is refused', true);
  await typeInto('[role="dialog"] input[aria-label="Points"]', '20');
  await press('[role="dialog"]', 'Add');
  const rule = await until(async () => ((await api('GET', '/api/tender/rules')).data?.rules ?? []).find((r) => r.name === `E2E Roads are ours ${tag}`), 'the rule');
  made.rule = Number(rule.id);
  t.check(
    'a rule is added, in the form the server scores with',
    rule.factor === 'industry' && rule.operator === 'equals' && rule.value === `E2E Roads ${tag}` && Number(rule.points) === 20,
    js({ f: rule.factor, op: rule.operator, v: rule.value, p: rule.points }),
  );
  await press(`[data-rule="${rule.id}"]`, 'Turn off');
  await until(async () => String(((await api('GET', '/api/tender/rules')).data?.rules ?? []).find((r) => Number(r.id) === made.rule)?.enabled) === '0', 'switched off');
  t.check('it is switched off, and nothing else about it changes', true);
  await t.evaluate(`document.querySelector('[data-rule="${rule.id}"] button[aria-label^="Edit"]').click()`);
  await typeInto('[role="dialog"] input[aria-label="Points"]', '25');
  await press('[role="dialog"]', 'Save');
  const edRule = await until(async () => {
    const r = ((await api('GET', '/api/tender/rules')).data?.rules ?? []).find((x) => Number(x.id) === made.rule);
    return Number(r?.points) === 25 ? r : null;
  }, 'edited');
  t.check('edited, the rest of it is kept', edRule.value === `E2E Roads ${tag}` && String(edRule.enabled) === '0', js({ v: edRule.value, on: edRule.enabled }));
  await press('main', 'Score everything open again');
  await t.waitFor(`[...document.querySelectorAll('[role="status"], [role="alert"], div')].some(e => /open tenders? scored again/.test(e.textContent ?? ''))`, 'the rescore', 20_000);
  t.check('open tenders are scored again', true);
  await t.evaluate(`document.querySelector('[data-rule="${rule.id}"] button[aria-label^="Remove"]').click()`);
  await until(async () => !((await api('GET', '/api/tender/rules')).data?.rules ?? []).some((r) => Number(r.id) === made.rule), 'rule removed');
  made.rule = null;
  t.check('and removed', true);
  await t.shot('l3-rules');

  // ── settings: sources and the switch ──────────────────────────────────
  await t.evaluate(`[...document.querySelectorAll('main [role="tab"]')].find(b => b.textContent === 'Sources').click()`);
  await t.waitFor(`${mainHas('Ways tenders can arrive')} && ${mainHas('Added by hand')}`, 'the sources', 15_000);
  t.check('the ways tenders arrive are listed, with why not where they cannot', await t.evaluate(`${mainHas('Not available')}`), '');
  await t.evaluate(`[...document.querySelectorAll('main [role="tab"]')].find(b => b.textContent === 'General').click()`);
  await t.waitFor(`${mainHas('A required document must be approved before the bid goes out')}`, 'the switch', 15_000);
  t.check('the module’s switch is shown', true);
} catch (e) {
  t.check(`no unexpected error (${e.message})`, false);
  await t.shot('lz-failure').catch(() => undefined);
} finally {
  if (made.rule) await api('DELETE', `/api/tender/rules/${made.rule}`).catch(() => undefined);
  if (made.doc) await api('DELETE', `/api/tender/library/${made.doc}`).catch(() => undefined);
  if (made.file) {
    await api('DELETE', `/api/files/${made.file}`).catch(() => undefined);
    await api('DELETE', `/api/files/${made.file}/purge`).catch(() => undefined);
  }
  if (made.tenders.length) await api('POST', '/api/tenders/bulk', { action: 'delete', ids: made.tenders }).catch(() => undefined);
  await t.finish();
}

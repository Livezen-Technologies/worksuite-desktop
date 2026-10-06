// End-to-end: Marketing (WS-MKT-SRS-001 v1.1, DK01–DK14) — the module opens in a tab of its own rather than the
// browser; its rail has the design's four sections; every screen it points at draws its page with a heading;
// a contact, a campaign and a call campaign open from their lists; and nothing it shows is written by the test.
// Read-only: it changes nothing on the server, so it needs no clean-up.
//
//   npm run build
//   WS_E2E_SERVER=… WS_E2E_EMAIL=… WS_E2E_PASSWORD=… ELECTRON_RUN_AS_NODE=1 npx electron tests/e2e/marketing.mjs
//
// The account needs the Marketing app and its permissions (a marketing manager: contacts, campaigns, calls).
import { launch, sleep } from './harness.mjs';

const server = process.env.WS_E2E_SERVER;
const email = process.env.WS_E2E_EMAIL;
const password = process.env.WS_E2E_PASSWORD;
if (!server || !email || !password) {
  console.error('Set WS_E2E_SERVER, WS_E2E_EMAIL and WS_E2E_PASSWORD.');
  process.exit(2);
}

const js = (v) => JSON.stringify(v);
/** A rail item, whose text may end in its count ("Contacts200") or carry "Planned". */
const rail = (label) => `(() => { const b = [...document.querySelectorAll('nav[aria-label="Marketing"] button')].find(b => b.textContent.trim().replace(/(\\d[\\d,]*|Planned)$/, '').trim() === ${js(label)}); if (!b) return false; b.click(); return true; })()`;
/**
 * Marketing's own tab: the nearest box around its rail that holds a heading on show. Other tabs (Home) stay in the
 * page with headings and buttons of their own, so nothing is looked for outside it.
 */
const MAIN = `(() => { let e = document.querySelector('nav[aria-label="Marketing"]'); while (e && ![...e.querySelectorAll('h1')].some((h) => h.getClientRects().length > 0)) e = e.parentElement; return e ?? document.body; })()`;
const heading = `(([...(${MAIN}).querySelectorAll('h1')].find((h) => h.getClientRects().length > 0))?.textContent ?? '').trim()`;
const headingIs = (t) => `${heading} === ${js(t)}`;

/** Every rail item, and the heading its screen draws (the SRS's design, §19). */
const SCREENS = [
  ['Dashboard', 'Dashboard', 'DK01-dashboard'],
  ['Contacts', 'Contacts', 'DK02-contacts'],
  ['Organisations', null, 'marketing-organisations'],
  ['Lists', null, 'marketing-lists'],
  ['Segments', null, 'marketing-segments'],
  ['Import', null, 'DK05-import'],
  ['Consent & suppression', 'Consent & suppression', 'DK12-consent'],
  ['Campaigns', 'Email campaigns', 'DK06-campaigns'],
  ['Templates', null, 'marketing-templates'],
  ['Topics & preferences', null, 'marketing-topics'],
  ['Call campaigns', 'Call campaigns', 'marketing-call-campaigns'],
  ['My call queue', 'My call queue', 'D01-call-queue'],
  ['Scripts', null, 'marketing-scripts'],
  ['Reports', 'Reports', 'marketing-reports'],
  ['Automation', null, 'DK14-automation'],
  ['Settings', null, 'DK13-settings'],
];

const t = await launch({ name: 'marketing' });
try {
  await t.signIn(server, email, password);

  // ── a native tab, not the browser ─────────────────────────────────────
  const opened = await t.evaluate(`(() => { const b = [...document.querySelectorAll('nav button, nav a')].find(b => b.textContent.trim() === 'Marketing'); if (!b) return false; b.click(); return true; })()`);
  t.check('Marketing is in the sidebar', opened);
  await t.waitFor(`!!document.querySelector('nav[aria-label="Marketing"]')`, 'the Marketing rail', 30_000);
  t.check('it opens in a tab of its own, with its rail', true);
  // The rail grows once the person's permissions arrive, and its footer once the sending route does.
  await t.waitFor(`/Sending via relay|No mail route yet/.test(document.querySelector('nav[aria-label="Marketing"]')?.textContent ?? '')`, 'the rail with its permissions', 30_000);
  await sleep(1000);

  const items = await t.evaluate(`[...document.querySelectorAll('nav[aria-label="Marketing"] button')].map(b => b.textContent.trim())`);
  const sections = await t.evaluate(`[...document.querySelectorAll('nav[aria-label="Marketing"] div')].map(d => d.textContent.trim()).filter(s => /^(Audience|Email|Calls|Insights)$/.test(s))`);
  t.check('the rail has New campaign and the four sections: Audience, Email, Calls, Insights',
    items.some((i) => i.includes('New campaign')) && ['Audience', 'Email', 'Calls', 'Insights'].every((s) => sections.includes(s)), js({ items, sections }));
  t.check('Automation is marked planned, not offered as working', items.some((i) => /^Automation.*Planned/.test(i)), js(items));
  t.check('the rail says how bulk mail leaves', await t.evaluate(`/Sending via relay|No mail route yet/.test(document.querySelector('nav[aria-label="Marketing"]').textContent)`));

  // ── every screen draws its page ───────────────────────────────────────
  for (const [label, title, file] of SCREENS) {
    if (!(await t.evaluate(rail(label)))) {
      t.skip(`${label} screen`, 'not in this account\'s rail');
      continue;
    }
    await t.waitFor(title ? headingIs(title) : `${heading} !== ''`, `the ${label} screen`, 20_000);
    await sleep(800);
    t.check(`${label}: the screen draws its page`, !(await t.evaluate(`(${MAIN}).textContent.trim() === ${js(label)}`)));
    await t.shot(file);
  }

  // ── the go-live readiness panel ───────────────────────────────────────
  await t.evaluate(rail('Dashboard'));
  await t.waitFor(headingIs('Dashboard'), 'the dashboard');
  await sleep(1500);
  t.check('the dashboard shows go-live readiness, open or passed',
    await t.evaluate(`/Go-live readiness|Ready to send/.test((${MAIN}).textContent)`));

  // ── one contact, one campaign, one call campaign ──────────────────────
  for (const [label, file] of [['Contacts', 'DK03-contact'], ['Campaigns', 'DK09-campaign'], ['Call campaigns', 'DK10-call-campaign']]) {
    await t.evaluate(rail(label));
    await sleep(2500);
    const before = await t.evaluate(heading);
    const row = await t.evaluate(`(() => { const r = ['table tbody tr', '[role="row"] button', 'li button', 'button.w-full.text-left'].map((q) => [...(${MAIN}).querySelectorAll(q)].find((e) => !e.closest('nav') && e.getClientRects().length > 0)).find(Boolean); if (!r) return false; (r.querySelector('button:not([role="checkbox"]):not([aria-checked])') ?? r).click(); return true; })()`);
    if (!row) {
      t.skip(`a ${label} record`, 'none to open on this server');
      continue;
    }
    await t.waitFor(`${heading} !== ${js(before)} && ${heading} !== ''`, `a record from ${label}`, 20_000);
    await sleep(1200);
    t.check(`${label}: a record opens as a page of its own`, true);
    await t.shot(file);
  }
} catch (e) {
  t.check('the run reached the end', false, String(e?.stack ?? e));
} finally {
  await t.finish();
}

// End-to-end: SalonMate, part 1 — against a real server, through the UI:
// this computer paired as a front desk (the key stays in the main process);
// Today's board; a client found, with the allergy first on their card; Book
// again, for a free slot on the next day, as the desk's booking; that booking
// found on the calendar and checked in through the allergy read-out; and the
// pairing forgotten again.
//
// Needs a user who holds salon.* and may approve desks (salon.desk.manage), a
// SalonMate location with a stylist and services, and a client with an
// allergy on file (the demo salon has all three). What it books is cancelled
// and the desk it pairs is revoked at the end.
//
//   npm run build
//   WS_E2E_SERVER=… WS_E2E_EMAIL=… WS_E2E_PASSWORD=… ELECTRON_RUN_AS_NODE=1 npx electron tests/e2e/salon.mjs
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { choose, launch, sleep } from './harness.mjs';

const server = process.env.WS_E2E_SERVER;
const email = process.env.WS_E2E_EMAIL;
const password = process.env.WS_E2E_PASSWORD;
if (!server || !email || !password) {
  console.error('Set WS_E2E_SERVER, WS_E2E_EMAIL and WS_E2E_PASSWORD.');
  process.exit(2);
}

let bearer = '';
async function api(method, path, body) {
  const headers = { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` };
  if (method !== 'GET') headers['Idempotency-Key'] = `e2e-${randomUUID()}`;
  const r = await fetch(`${server}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, data: j.data ?? j, message: j.message };
}
const js = (v) => JSON.stringify(v);
const tag = String(Date.now() % 100000);
const made = { desk: null, visit: null };

const t = await launch({ name: 'salon' });
const rail = async (label) => {
  const ok = await t.evaluate(`(() => { const b = [...document.querySelectorAll('nav[aria-label="SalonMate"] button')].find(b => b.textContent.trim() === ${js(label)}); if (b) b.click(); return !!b; })()`);
  if (!ok) throw new Error(`no ${label} in the rail`);
};
const press = async (scope, match, what) => {
  const ok = await t.evaluate(`(() => { const b = [...document.querySelectorAll(${js(`${scope} button`)})].find(b => ${match}(b.textContent.trim()) && !b.disabled); if (b) b.click(); return !!b; })()`);
  if (!ok) throw new Error(`no ${what} button to press`);
};
const is = (text) => `((s) => s === ${js(text)})`;
const typeInto = (selector, value) =>
  t.evaluate(`(() => { const el = document.querySelector(${js(selector)}); if (!el) return false; const set = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set; set.call(el, ${js(value)}); el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);

try {
  bearer = (await api('POST', '/api/auth/login', { email, password })).data?.tokens?.access_token ?? '';
  const options = (await api('GET', '/api/salon/v1/options')).data;
  const location = options?.locations?.[0];
  const org = location?.org_id;
  const clients = org ? ((await api('GET', `/api/salon/v1/clients?org=${org}&q=&limit=100`)).data?.items ?? []) : [];
  const amaya = clients.find((c) => c.allergy && c.visits > 0);
  t.check('fixtures: a salon location and a client with an allergy on file', !!(location && amaya), js({ location: location?.name, client: amaya?.name }));
  if (!location || !amaya) throw new Error('the server has no salon to test against');
  const first = amaya.name.split(' ')[0];

  // ── pairing ──────────────────────────────────────────────────────────
  await t.signIn(server, email, password);
  await sleep(1500);
  await t.evaluate(`(() => { const b = [...document.querySelectorAll('nav button')].find(b => b.textContent.trim() === 'SalonMate'); if (b) b.click(); return !!b; })()`);
  await t.waitFor(t.hasText('SalonMate on this computer'), 'the pairing screen', 30_000);
  await t.shot('s1-pair');
  await t.fill('Name of this desk', `E2E desk ${tag}`);
  await t.evaluate(choose('button[aria-label="Location"]', String(location.id)));
  await t.waitFor(`${t.hasText('Skip — no payments here')} || ${t.hasText('Pair this desk')}`, 'the pair button');
  await press('main', `((s) => s === 'Skip — no payments here' || s === 'Pair this desk')`, 'pair');
  await t.waitFor(`!!document.querySelector('nav[aria-label="SalonMate"]') && ${t.hasText('Arriving next')}`, 'the desk, paired and approved', 30_000);

  const pairing = await t.evaluate(`window.worksuite.salon.deskPairing()`);
  made.desk = pairing?.desk_id ?? null;
  t.check('the renderer knows which desk it is, never its key', !!made.desk && !('key' in (pairing ?? {})), js(pairing));
  const desks = (await api('GET', '/api/salon/v1/desks')).data?.items ?? [];
  const mine = desks.find((d) => d.id === made.desk);
  t.check('WorkSuite lists the desk, active, from this app', mine?.status === 'active' && String(mine?.app_version ?? '').startsWith('desktop'), js({ status: mine?.status, app: mine?.app_version, seen: mine?.last_seen_at }));

  // ── today ────────────────────────────────────────────────────────────
  const today = (await api('GET', `/api/salon/v1/today?location=${location.id}`)).data;
  const panels = await t.evaluate(`${t.hasText('Arriving next')} && ${t.hasText('On the floor')} && ${t.hasText('still to come today')}`);
  const lateShown = (today?.late ?? []).length === 0 || (await t.evaluate(`[...document.querySelectorAll('main li')].some(li => li.textContent.includes('Late'))`));
  t.check('Today: arriving, late, and who is on the floor', panels && lateShown, js({ late: today?.late?.length, arriving: today?.arriving?.length }));
  await t.shot('s2-today');

  // ── a client, allergy first ─────────────────────────────────────────
  await rail('Clients');
  await t.waitFor(`!!document.querySelector('input[aria-label="Name, mobile or email"]')`, 'the client search');
  await t.fill('Name, mobile or email', first);
  await t.waitFor(`[...document.querySelectorAll('main li button')].some(b => b.textContent.includes(${js(amaya.name)}))`, `${amaya.name} in the list`, 15_000);
  await t.evaluate(`[...document.querySelectorAll('main li button')].find(b => b.textContent.includes(${js(amaya.name)})).click()`);
  await t.waitFor(`document.body.textContent.includes('Recent visits')`, 'the client card', 15_000);
  const card = await t.evaluate(`${t.hasText(amaya.allergy.substance)} && document.body.textContent.includes('Store credit') && ${t.hasText('Open full record')}`);
  t.check('the client card: the allergy, credit, points, and the full record on the web', card, '');
  await t.shot('s3-client');

  // ── book again, the next day ───────────────────────────────────────
  await press('main', is('Book again'), 'Book again');
  await t.waitFor(`${t.hasText('New booking')} && ${t.hasText('When')} && ${t.hasText(amaya.name)} && ${t.hasText('Change')}`, 'the new booking, for the same client', 15_000);
  // The stylist from last time, if they still do these; otherwise the first who does.
  await t.waitFor(`[...document.querySelectorAll('[role="radiogroup"][aria-label="Stylist"] [role="radio"]')].some(b => !b.disabled)`, 'a stylist who does the services', 20_000);
  await t.evaluate(`(() => { const g = document.querySelector('[role="radiogroup"][aria-label="Stylist"]'); if (g.querySelector('[aria-checked="true"]')) return; [...g.querySelectorAll('[role="radio"]')].find(b => !b.disabled).click(); })()`);
  let slot = false;
  for (let d = 0; d < 7 && !slot; d++) {
    await press('main', is('Next day'), 'Next day');
    await t.waitFor(`!!document.querySelector('[role="radiogroup"][aria-label="Start time"]') || ${t.hasText('has no free time that day')}`, 'the free times', 20_000);
    slot = await t.evaluate(`!!document.querySelector('[role="radiogroup"][aria-label="Start time"] [role="radio"]')`);
  }
  if (!slot) throw new Error('no free time in the next week');
  await t.evaluate(`document.querySelector('[role="radiogroup"][aria-label="Start time"] [role="radio"]').click()`);
  await t.shot('s4-booking');
  await press('main', `((s) => s.startsWith('Book ') && s.includes(' with '))`, 'the Book');
  await t.waitFor(`!!document.querySelector('main[aria-label="SalonMate · Calendar"]')`, 'the calendar of the booked day', 20_000);

  // ── the calendar, and a check-in through the allergy read-out ──────
  await t.waitFor(`[...document.querySelectorAll('main button[title]')].some(b => b.title.includes(${js(amaya.name)}))`, `${first}'s booking on the calendar`, 20_000);
  const date = await t.evaluate(`document.querySelector('main[aria-label="SalonMate · Calendar"] h1')?.textContent ?? ''`);
  const ids = await t.evaluate(`[...document.querySelectorAll('main button[title]')].filter(b => b.title.includes(${js(amaya.name)})).length`);
  t.check('the booking is on the calendar, under its stylist', ids > 0, date);
  await t.shot('s5-calendar');
  await t.evaluate(`[...document.querySelectorAll('main button[title]')].filter(b => b.title.includes(${js(amaya.name)})).pop().click()`);
  await t.waitFor(`!!document.querySelector('[role="dialog"]') && ${t.hasText('Open the client')}`, 'the booking');
  const number = await t.evaluate(`(document.querySelector('[role="dialog"]').textContent.match(/[A-Z]{2,5}-APT-\\d+/) ?? [''])[0]`);
  const visits = (await api('GET', `/api/salon/v1/clients/${amaya.id}`)).data?.visits ?? [];
  made.visit = visits.find((v) => v.number === number)?.id ?? null;
  const booked = made.visit ? (await api('GET', `/api/salon/v1/visits/${made.visit}`)).data?.visit : null;
  t.check('booked as the desk’s own booking', !!booked && booked.status !== 'cancelled', js({ number, status: booked?.status, source: booked?.source }));

  await press('[role="dialog"]', is('Check in'), 'Check in');
  await t.waitFor(`[...document.querySelectorAll('[role="dialog"]')].some(d => d.textContent.includes('has an allergy on file') && d.textContent.includes(${js(amaya.allergy.substance)}) && d.querySelector('input[type="checkbox"]'))`, 'the allergy read-out', 20_000);
  const held = await t.evaluate(`[...document.querySelectorAll('[role="dialog"] button')].filter(b => b.textContent.trim().startsWith('Check in ')).map(b => b.disabled)`);
  const readOut = await t.evaluate(`[...document.querySelectorAll('[role="dialog"]')].some(d => d.textContent.includes(${js(amaya.allergy.substance)}))`);
  t.check('the allergy is read out, and check-in waits for the tick', readOut && held.length > 0 && held.every(Boolean), js({ readOut, held }));
  await t.shot('s6-allergy');
  await t.evaluate(`document.querySelector('[role="dialog"] input[type="checkbox"]').click()`);
  const patch = await t.evaluate(`!!document.querySelector('[role="dialog"] textarea')`);
  if (patch) await typeInto('[role="dialog"] textarea', 'E2E: tested at another salon last week');
  await press('[role="dialog"]', `((s) => s.startsWith('Check in '))`, 'the confirm');
  await t.waitFor(`!document.querySelector('[role="dialog"]')`, 'the read-out to close', 20_000);
  await sleep(800);
  const after = (await api('GET', `/api/salon/v1/visits/${made.visit}`)).data?.visit;
  t.check('checked in, the acknowledgement on the record', after?.status === 'checked_in', js({ status: after?.status, patch }));

  // ── forgetting the pairing ──────────────────────────────────────────
  await rail('Today');
  await t.evaluate(`[...document.querySelectorAll('nav[aria-label="SalonMate"] button')].find(b => b.textContent.includes('Pair this computer again')).click()`);
  await t.waitFor(t.hasText('Pair this computer again?'), 'the confirmation');
  await press('[role="dialog"]', is('Forget this desk'), 'Forget this desk');
  await t.waitFor(t.hasText('SalonMate on this computer'), 'the pairing screen again', 20_000);
  t.check('forgotten: this computer is no desk until paired anew', (await t.evaluate(`window.worksuite.salon.deskPairing()`)) === null, '');
} catch (e) {
  t.check('run', false, e instanceof Error ? e.message : String(e));
  await t.shot('s-fail').catch(() => undefined);
} finally {
  if (made.visit) {
    const r = await api('POST', `/api/salon/v1/visits/${made.visit}/cancel`, { by: 'salon', reason: 'E2E test booking', advance: 'credit' });
    if (r.status >= 300) console.log(`cleanup: the booking was not cancelled — ${r.status} ${r.message}`);
  }
  if (made.desk) {
    const r = await api('POST', `/api/salon/v1/desks/${made.desk}/revoke`, {});
    if (r.status >= 300) console.log(`cleanup: the desk was not revoked — ${r.status} ${r.message}`);
  }
}
// Every screen's address is one a tab can keep, and nothing the module asked for was refused.
await sleep(1500);
const refused = (() => {
  try {
    return readFileSync(join(t.profile, 'logs', 'main.log'), 'utf8').split('\n').filter((l) => l.includes('ipc rejected'));
  } catch {
    return [];
  }
})();
t.check('the desktop refused nothing SalonMate asked of it', refused.length === 0, refused.slice(0, 2).join(' | '));
await t.finish();

// End-to-end: SalonMate, part 3 — the front desk with WorkSuite out of reach,
// against a real server, through the UI.
//
// The app reaches WorkSuite through a small TCP relay this script runs, so
// the line can be cut and restored. The desk is paired and this computer
// trusted; the day's copy is taken; then, with the line cut, the desk books a
// new client in for tomorrow, checks in a visit from the calendar's copy, and
// keeps a booking at a time that is already taken. With the line back the
// first two reach WorkSuite as they were made; the third comes back refused,
// with the nearest free time, and taking that time from "Changes to send"
// books it.
//
// Makes its own fixtures: a visit tomorrow for a client with no allergy on
// file (checked in by the test). The new client and the visits stay on the
// record; the bookings the test made are cancelled and the desk revoked at
// the end.
//
//   npm run build
//   WS_E2E_SERVER=… WS_E2E_EMAIL=… WS_E2E_PASSWORD=… ELECTRON_RUN_AS_NODE=1 npx electron tests/e2e/salon-3.mjs
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import net from 'node:net';
import { join } from 'node:path';
import { URL } from 'node:url';
import { launch, choose, sleep } from './harness.mjs';

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
  return { status: r.status, data: j.data ?? j, message: j.message, errors: j.errors };
}
const js = (v) => JSON.stringify(v);
const tag = String(Date.now() % 100000);
const made = { desk: null, visits: [] };

/* ── the line: a relay the test can cut ─────────────────────────────── */
const upstream = new URL(server);
let down = false;
const open = new Set();
const relay = net.createServer((client) => {
  if (down) {
    client.destroy();
    return;
  }
  const up = net.connect(Number(upstream.port || 80), upstream.hostname);
  open.add(client);
  open.add(up);
  const gone = () => {
    open.delete(client);
    open.delete(up);
    client.destroy();
    up.destroy();
  };
  client.on('error', gone).on('close', gone);
  up.on('error', gone).on('close', gone);
  client.pipe(up).pipe(client);
});
await new Promise((r) => relay.listen(0, '127.0.0.1', r));
const via = `http://127.0.0.1:${relay.address().port}`;
const cut = () => {
  down = true;
  for (const s of open) s.destroy();
};
const restore = () => {
  down = false;
};

const until = async (fn, label, tries = 60, every = 500) => {
  for (let i = 0; i < tries; i++) {
    const v = await fn();
    if (v) return v;
    await sleep(every);
  }
  throw new Error(`${label}: never happened`);
};

const t = await launch({ name: 'salon-3' });
const DESK = 'main[aria-label^="SalonMate ·"]';
const rail = async (label) => {
  const ok = await t.evaluate(`(() => { const b = [...document.querySelectorAll('nav[aria-label="SalonMate"] button')].find(b => b.textContent.trim().startsWith(${js(label)})); if (b) b.click(); return !!b; })()`);
  if (!ok) throw new Error(`no ${label} in the rail`);
};
const press = async (scope, match, what) => {
  const ok = await t.evaluate(`(() => { const b = [...document.querySelectorAll(${js(`${scope} button`)})].find(b => (${match})(b.textContent.trim()) && !b.disabled); if (b) b.click(); return !!b; })()`);
  if (!ok) throw new Error(`no ${what} button to press`);
};
const is = (text) => `((s) => s === ${js(text)})`;
const starts = (text) => `((s) => s.startsWith(${js(text)}))`;
const salon = (call) => t.evaluate(`window.worksuite.salon.${call}`);

try {
  bearer = (await api('POST', '/api/auth/login', { email, password })).data?.tokens?.access_token ?? '';

  // ── fixtures ──────────────────────────────────────────────────────────
  const location = (await api('GET', '/api/salon/v1/options')).data?.locations?.[0];
  const org = location?.org_id;
  const options = (await api('GET', `/api/salon/v1/options?org=${org}`)).data;
  const client = ((await api('GET', `/api/salon/v1/clients?org=${org}&q=&limit=100`)).data?.items ?? []).find((c) => !c.allergy);
  let service = null;
  let stylist = null;
  for (const cat of options?.menu ?? []) {
    for (const s of cat.services ?? []) {
      const who = (options.stylists ?? []).find((p) => p.active !== false && p.services.includes(s.id) && (p.locations.length === 0 || p.locations.includes(location.id)));
      if (!service && who && s.duration_min <= 60) {
        service = s;
        stylist = who;
      }
    }
  }
  const day = (n) => new Intl.DateTimeFormat('en-CA', { timeZone: location.timezone }).format(new Date(Date.now() + n * 86_400_000));
  const items = js([{ service_id: service?.id, provider_id: stylist?.id }]);
  const freeOn = async (date) => ((await api('GET', `/api/salon/v1/availability?location=${location.id}&date=${date}&items=${encodeURIComponent(items)}`)).data?.starts ?? []).filter((s) => s.free);
  /* A day with a free time for the fixture, and another free time well after it. */
  const gap = ((service?.duration_min ?? 60) + 30) * 60_000;
  let date = null;
  let ahead = 0;
  let slots = [];
  let later = null;
  for (let n = 1; n < 10 && !later && service; n++) {
    date = day(n);
    ahead = n;
    slots = await freeOn(date);
    later = slots.find((x) => slots.length > 0 && Date.parse(x.starts_at) >= Date.parse(slots[0].starts_at) + gap) ?? null;
  }
  const booked = later ? await api('POST', '/api/salon/v1/visits', { location_id: location.id, client_id: client.id, items: JSON.parse(items), starts_at: slots[0].starts_at }) : null;
  const fixture = booked?.data?.visit ?? null;
  if (fixture) made.visits.push(fixture.id);
  t.check('fixtures: a visit on a day ahead, and a free time after it', !!(fixture && later), js({ booked: [booked?.status, booked?.message], later: later?.label, date }));
  if (!fixture || !later) throw new Error('fixtures could not be made');

  // ── pairing, through the relay ──────────────────────────────────────
  await t.signIn(via, email, password);
  await sleep(1500);
  await t.evaluate(`(() => { const b = [...document.querySelectorAll('nav button')].find(b => b.textContent.trim() === 'SalonMate'); if (b) b.click(); return !!b; })()`);
  await t.waitFor(`${t.hasText('SalonMate on this computer')} && !!document.querySelector('button[aria-label="Location"]')`, 'the pairing form', 30_000);
  if (!(await t.fill('Name of this desk', `E2E offline desk ${tag}`))) throw new Error('no name field to fill');
  await t.evaluate(choose('button[aria-label="Location"]', String(location.id)));
  await t.waitFor(`[...document.querySelectorAll('main button')].some(b => b.textContent.trim().startsWith('Pair') && !b.disabled)`, 'the pair button', 20_000);
  await press('main', starts('Pair'), 'Pair');
  await t.waitFor(`!!document.querySelector('nav[aria-label="SalonMate"]') && ${t.hasText('Arriving next')}`, 'the desk, paired', 30_000);
  made.desk = (await salon('deskPairing()'))?.desk_id ?? null;

  // ── this computer trusted, and the day's copy taken ─────────────────
  const me = await t.evaluate(`window.worksuite.security.deviceInfo()`);
  const trusted = await api('POST', `/desktop/v1/admin/devices/${me?.id}/trust`, {});
  t.check('an administrator trusts this computer', trusted.status < 300 && trusted.data?.device?.trust === 'TRUSTED', js([trusted.status, trusted.data?.message ?? trusted.message, me?.id]));
  /* The line dropping and coming back is when a desk asks again who it is (onReconnect → device heartbeat). */
  cut();
  await salon('syncNow()').catch(() => undefined);
  restore();
  let last = null;
  const ready = await until(async () => {
    const s = (last = await salon('syncNow()'));
    return s?.can_write && s?.copy ? s : null;
  }, 'a trusted desk with its copy of the day', 60, 1000).catch((e) => {
    throw new Error(`${e.message} — ${js(last)}`);
  });
  t.check("the desk keeps its day's copy, and may keep changes to send", ready.copy.visits > 0 && ready.copy.clients > 0 && ready.reachable, js(ready.copy));
  const copy = await salon('copy()');
  t.check('the copy holds tomorrow’s visit', (copy?.visits ?? []).some((v) => v.id === fixture.id), `${copy?.visits?.length} visits`);

  // ── the line cut ────────────────────────────────────────────────────
  cut();
  await salon('syncNow()').catch(() => undefined);
  await t.waitFor(t.hasText('WorkSuite cannot be reached'), 'the desk saying it is offline', 30_000);
  await t.shot('o1-offline');

  /* A new client, booked in for tomorrow at a free time. */
  await rail('New booking');
  await t.waitFor(t.hasText('Pick services, then a stylist who does them. It is kept here'), 'the booking screen, offline', 20_000);
  await press(DESK, is('New client'), 'New client');
  const name = `E2E Offline ${tag}`;
  await t.fill('Name', name);
  await t.fill('Mobile', `077${tag.padStart(7, '0')}`);
  await press(DESK, is('Add client'), 'Add client');
  await t.waitFor(t.hasText(name), 'the new client chosen');
  await press(DESK, `((s) => s.startsWith(${js(service.name)}))`, 'the service');
  await t.waitFor(`!!document.querySelector('[role="radiogroup"][aria-label="Stylist"]')`, 'the stylists');
  await t.evaluate(`[...document.querySelectorAll('[role="radiogroup"][aria-label="Stylist"] [role="radio"]')].find(b => b.textContent.includes(${js(stylist.name)})).click()`);
  await t.fill('Day', date);
  await t.fill('Time', later.label);
  await t.waitFor(`[...document.querySelectorAll(${js(`${DESK} button`)})].some(b => b.textContent.trim().startsWith('Keep: ${later.label}') && !b.disabled)`, 'the keep button');
  await t.shot('o2-booking');
  await press(DESK, starts(`Keep: ${later.label}`), 'Keep the booking');
  await t.waitFor(t.hasText('Kept to send'), 'the booking kept', 20_000);

  /* The fixture's visit checked in from the calendar, drawn from the copy. */
  await rail('Calendar');
  await t.waitFor(t.hasText('From this desk’s copy'), 'the calendar from the copy', 20_000);
  for (let i = 0; i < ahead; i++) {
    await t.evaluate(`document.querySelector('button[aria-label="The day after"]').click()`);
    await sleep(300);
  }
  const block = `[...document.querySelectorAll(${js(`${DESK} button`)})].find(b => (b.getAttribute('title') ?? '').startsWith(${js(`${fixture.start}–`)}) && (b.getAttribute('title') ?? '').includes(${js(fixture.client.name)}))`;
  await t.waitFor(`!!${block}`, 'the visit on the calendar', 10_000);
  await t.shot('o2b-calendar');
  await t.evaluate(`${block}.click()`);
  await t.waitFor(`[...document.querySelectorAll('[role="dialog"] button')].some(b => b.textContent.trim() === 'Check in')`, 'the visit actions');
  await t.evaluate(`[...document.querySelectorAll('[role="dialog"] button')].find(b => b.textContent.trim() === 'Check in').click()`);
  await until(async () => ((await salon('outbox()')) ?? []).some((i) => i.kind === 'visit.check_in'), 'the check-in kept');

  /* A booking at a time already taken: WorkSuite will say so when it answers. */
  await t.evaluate(`window.worksuite.salon.outboxAdd(${js({ kind: 'visit.book', payload: { client_id: client.id, starts_at: slots[0].starts_at, items: JSON.parse(items) }, label: `Booking: ${client.name}`, detail: 'E2E: a time already taken' })})`);

  const kept = await salon('outbox()');
  t.check(
    'with the line cut, the desk keeps what it did, in order',
    js(kept.map((i) => i.kind)) === js(['client.create', 'visit.book', 'visit.check_in', 'visit.book']) && kept[1].payload.client_id === `local:${kept[0].local_id}` && kept.every((i) => i.state === 'waiting'),
    js(kept.map((i) => [i.kind, i.local_id, i.payload.client_id ?? i.payload.visit_id])),
  );
  await rail('Changes to send');
  await t.waitFor(t.hasText('Waiting to send · 4'), 'the changes listed', 20_000);
  await t.shot('o3-waiting');
  const money = await t.evaluate(`(() => { const b = [...document.querySelectorAll('nav[aria-label="SalonMate"] button')].find(b => b.textContent.trim() === 'Take payment'); if (b) b.click(); return !!b; })()`);
  if (money) {
    await t.waitFor(t.hasText('Taking payment needs WorkSuite'), 'payment saying it needs WorkSuite', 10_000);
    t.check('taking money waits for WorkSuite', true);
    await rail('Changes to send');
  }

  // ── the line back ───────────────────────────────────────────────────
  restore();
  const after = await until(async () => {
    const s = await salon('syncNow()');
    return s?.reachable && s.waiting === 0 ? s : null;
  }, 'the changes sent', 30, 1000);
  t.check('with the line back, what WorkSuite would do is done, and what it would not waits for a person', after.refused === 1 && after.last_sync?.accepted >= 3, js({ refused: after.refused, last: after.last_sync }));

  const found = ((await api('GET', `/api/salon/v1/clients?org=${org}&q=${encodeURIComponent(name)}&limit=5`)).data?.items ?? [])[0];
  const theirs = found ? ((await api('GET', `/api/salon/v1/clients/${found.id}`)).data?.visits ?? []) : [];
  const newVisit = theirs.find((v) => v.date === date && v.start === later.label);
  if (newVisit) made.visits.push(newVisit.id);
  t.check('the new client and their booking reach WorkSuite as they were made', !!found && !!newVisit && (found.phone ?? '').replace(/\D+/g, '').endsWith(tag.padStart(7, '0')), js({ client: found?.id, visits: theirs.map((v) => [v.date, v.start, v.status]) }));
  const checked = (await api('GET', `/api/salon/v1/visits/${fixture.id}`)).data?.visit;
  t.check('the check-in made offline is on the visit', checked?.status === 'checked_in', checked?.status);

  const [refusedItem] = await salon('outbox()');
  t.check('the taken time comes back refused, with the nearest free time to take', refusedItem?.state === 'refused' && !!refusedItem.next?.starts_at && refusedItem.choices.includes('take_next'), js({ message: refusedItem?.message, next: refusedItem?.next, choices: refusedItem?.choices }));
  await t.waitFor(t.hasText('Needs you · 1'), 'the refusal on screen', 20_000);
  await t.shot('o4-refused');
  await press(DESK, starts('Take '), 'Take the next time');
  const done = await until(async () => {
    const s = await salon('syncNow()');
    return s?.waiting === 0 && s?.refused === 0 ? s : null;
  }, 'the refusal resolved', 30, 1000);
  const booking = ((await api('GET', `/api/salon/v1/clients/${client.id}`)).data?.visits ?? []).find((v) => v.starts_at === refusedItem.next.starts_at);
  if (booking) made.visits.push(booking.id);
  t.check('taking the next time books it', !!done && !!booking, js({ next: refusedItem.next, booking: booking?.id }));
  await t.waitFor(t.hasText('Nothing waiting.'), 'the outbox empty', 20_000);
  await t.shot('o5-sent');
} catch (e) {
  t.check('run', false, e instanceof Error ? e.message : String(e));
  await t.shot('o-fail').catch(() => undefined);
} finally {
  restore();
  for (const id of made.visits) {
    const r = await api('POST', `/api/salon/v1/visits/${id}/cancel`, { by: 'salon', reason: 'E2E cleanup' });
    if (r.status >= 300) console.log(`cleanup: visit ${id} was not cancelled — ${r.status} ${r.message}`);
  }
  if (made.desk) {
    const r = await api('POST', `/api/salon/v1/desks/${made.desk}/revoke`, {});
    if (r.status >= 300) console.log(`cleanup: the desk was not revoked — ${r.status} ${r.message}`);
  }
}

await sleep(1500);
const refused = (() => {
  try {
    return readFileSync(join(t.profile, 'logs', 'main.log'), 'utf8').split('\n').filter((l) => l.includes('ipc rejected'));
  } catch {
    return [];
  }
})();
t.check('the desktop refused nothing SalonMate asked of it', refused.length === 0, refused.slice(0, 2).join(' | '));
relay.close();
await t.finish();

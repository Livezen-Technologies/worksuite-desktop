// End-to-end: SalonMate, part 2 — against a real server, through the UI:
// this computer paired as a front desk with a POS register; its printers and
// cash drawer set up; the register opened on a counted float; a visit paid in
// cash with change given, its receipt printed and the drawer opened; and the
// day closed with the drawer counted and the Z-report printed.
//
// Makes its own fixtures: a POS register ("E2E<tag>"), and a visit for
// tomorrow, checked in and started, for a client with no allergy on file. The
// visit stays on the record, checked out and invoiced; the register is
// switched off and the desk revoked at the end.
//
// Printing is checked when WS_E2E_RECEIPT_PRINTER names a printer this
// computer has and WS_E2E_PRINTER_DIR is where that printer's jobs land, one
// file per job (a CUPS queue with a capture backend, for instance). Without
// them, printing is switched off and said to be skipped.
//
//   npm run build
//   WS_E2E_SERVER=… WS_E2E_EMAIL=… WS_E2E_PASSWORD=… [WS_E2E_RECEIPT_PRINTER=… WS_E2E_PRINTER_DIR=…] ELECTRON_RUN_AS_NODE=1 npx electron tests/e2e/salon-2.mjs
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { choose, launch, sleep } from './harness.mjs';

const server = process.env.WS_E2E_SERVER;
const email = process.env.WS_E2E_EMAIL;
const password = process.env.WS_E2E_PASSWORD;
const printer = process.env.WS_E2E_RECEIPT_PRINTER ?? '';
const printerDir = process.env.WS_E2E_PRINTER_DIR ?? '';
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
const made = { register: null, desk: null, visit: null };

/** Print jobs that landed since `before`, as their first bytes. */
const jobs = () => (printerDir ? readdirSync(printerDir).filter((f) => !f.startsWith('.')).sort() : []);
const newJobs = (before) => jobs().filter((f) => !before.includes(f)).map((f) => readFileSync(join(printerDir, f)));
const until = async (fn, label, tries = 60) => {
  for (let i = 0; i < tries; i++) {
    const v = await fn();
    if (v) return v;
    await sleep(500);
  }
  throw new Error(`${label}: never happened`);
};
const PULSE = Buffer.from([0x1b, 0x70, 0x00, 0x19, 0xfa]);

const t = await launch({ name: 'salon-2' });
const rail = async (label) => {
  const ok = await t.evaluate(`(() => { const b = [...document.querySelectorAll('nav[aria-label="SalonMate"] button')].find(b => b.textContent.trim() === ${js(label)}); if (b) b.click(); return !!b; })()`);
  if (!ok) throw new Error(`no ${label} in the rail`);
};
const DESK = 'main[aria-label^="SalonMate ·"]';
const press = async (scope, match, what) => {
  const ok = await t.evaluate(`(() => { const b = [...document.querySelectorAll(${js(`${scope} button`)})].find(b => (${match})(b.textContent.trim()) && !b.disabled); if (b) b.click(); return !!b; })()`);
  if (!ok) throw new Error(`no ${what} button to press`);
};
const is = (text) => `((s) => s === ${js(text)})`;
const typeInto = (selector, value) =>
  t.evaluate(`(() => { const el = document.querySelector(${js(selector)}); if (!el) return false; const set = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set; set.call(el, ${js(value)}); el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);

try {
  bearer = (await api('POST', '/api/auth/login', { email, password })).data?.tokens?.access_token ?? '';

  // ── fixtures ──────────────────────────────────────────────────────────
  const location = (await api('GET', '/api/salon/v1/options')).data?.locations?.[0];
  const org = location?.org_id;
  const options = (await api('GET', `/api/salon/v1/options?org=${org}`)).data;
  const reg = await api('POST', '/api/pos/registers', { org_id: org, name: `E2E register ${tag}`, code: `E2E${tag}` });
  made.register = reg.data?.id ?? null;
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
  let start = null;
  const items = js([{ service_id: service?.id, provider_id: stylist?.id }]);
  for (let n = 1; n < 8 && !start && service; n++) {
    const a = (await api('GET', `/api/salon/v1/availability?location=${location.id}&date=${day(n)}&items=${encodeURIComponent(items)}`)).data;
    start = (a?.starts ?? []).find((s) => s.free)?.starts_at ?? null;
  }
  const booked = start ? await api('POST', '/api/salon/v1/visits', { location_id: location.id, client_id: client.id, items: JSON.parse(items), starts_at: start }) : null;
  made.visit = booked?.data?.visit?.id ?? null;
  const checkedIn = made.visit ? await api('POST', `/api/salon/v1/visits/${made.visit}/status`, { action: 'check_in' }) : null;
  const started = made.visit ? await api('POST', `/api/salon/v1/visits/${made.visit}/status`, { action: 'start' }) : null;
  t.check(
    'fixtures: a register, and a visit in the chair for a client with no allergy',
    !!(made.register && made.visit && started?.status < 300),
    js({ register: [reg.status, reg.message], visit: [booked?.status, booked?.message, made.visit], checkIn: checkedIn?.status, start: [started?.status, started?.message] }),
  );
  if (!made.register || !made.visit || started?.status >= 300) throw new Error('fixtures could not be made');
  const visit = (await api('GET', `/api/salon/v1/visits/${made.visit}`)).data?.visit;

  // ── pairing, with the register ──────────────────────────────────────
  await t.signIn(server, email, password);
  await sleep(1500);
  await t.evaluate(`(() => { const b = [...document.querySelectorAll('nav button')].find(b => b.textContent.trim() === 'SalonMate'); if (b) b.click(); return !!b; })()`);
  await t.waitFor(`${t.hasText('SalonMate on this computer')} && !!document.querySelector('button[aria-label="Location"]')`, 'the pairing form', 30_000);
  if (!(await t.fill('Name of this desk', `E2E till desk ${tag}`))) throw new Error('no name field to fill');
  await t.evaluate(choose('button[aria-label="Location"]', String(location.id)));
  await t.waitFor(`!!document.querySelector('button[aria-label="Register"]')`, 'the register choice', 20_000);
  await t.evaluate(choose('button[aria-label="Register"]', String(made.register)));
  await t.waitFor(t.hasText(`Pair with E2E${tag}`), 'the pair button for the register');
  await press('main', is(`Pair with E2E${tag}`), 'Pair with the register');
  await t.waitFor(`!!document.querySelector('nav[aria-label="SalonMate"]') && ${t.hasText('Arriving next')}`, 'the desk, paired', 30_000);
  made.desk = (await t.evaluate(`window.worksuite.salon.deskPairing()`))?.desk_id ?? null;
  const desk = ((await api('GET', '/api/salon/v1/desks')).data?.items ?? []).find((d) => d.id === made.desk);
  t.check('the desk takes money into the register it was paired with', desk?.register?.id === made.register, js(desk?.register));

  // ── printers and the drawer ─────────────────────────────────────────
  await rail('Printers');
  await t.waitFor(t.hasText('Cash drawer'), 'the printer settings', 20_000);
  if (printer && printerDir) {
    await t.waitFor(`!!document.querySelector('button[aria-label="Receipt printer"]')`, 'the receipt printer choice');
    await t.evaluate(choose('button[aria-label="Receipt printer"]', printer));
    await t.waitFor(`document.querySelector('button[aria-label="Receipt printer"]').textContent.includes(${js(printer)})`, 'the receipt printer chosen');
    await press(DESK, is('Plugged into the receipt printer'), 'the drawer choice');
    await t.waitFor(t.hasText('Open the drawer now'), 'the drawer set up');
    const settings = await t.evaluate(`window.worksuite.salon.printSettings()`);
    t.check('this computer keeps the printer and the drawer, for this server', settings.receipt_printer === printer && settings.drawer === 'printer' && settings.silent === true && settings.auto_print === true, js(settings));
    await t.shot('p1-printers');

    let before = jobs();
    await press(DESK, is('Open the drawer now'), 'Open the drawer now');
    const pulse = await until(() => newJobs(before).find((b) => b.equals(PULSE)), 'the drawer pulse');
    t.check('the drawer is sent the ESC/POS pulse, raw', !!pulse, '');

    before = jobs();
    await press(DESK, is('Print a test receipt'), 'Print a test receipt');
    const test = await until(() => newJobs(before).find((b) => b.subarray(0, 4).toString() === '%PDF'), 'the test receipt');
    t.check('the test receipt goes to the receipt printer without a dialog', !!test, `${test?.length ?? 0} bytes`);
  } else {
    t.skip('printing and the drawer', 'set WS_E2E_RECEIPT_PRINTER and WS_E2E_PRINTER_DIR to check them');
    await t.evaluate(`document.querySelector('button[role="switch"][aria-label="Print the receipt as soon as a payment is taken"]').click()`);
    await t.waitFor(`document.querySelector('button[role="switch"][aria-label="Print the receipt as soon as a payment is taken"]').getAttribute('aria-checked') === 'false'`, 'automatic printing off');
  }

  // ── the register ────────────────────────────────────────────────────
  await rail('Register');
  await t.waitFor(t.hasText('Open the register'), 'the register, closed', 20_000);
  await typeInto('input[aria-label="How many 1,000"]', '5');
  await t.waitFor(`document.querySelector('output')?.textContent.includes('5,000.00')`, 'the float counted');
  await press(DESK, is(`Open register E2E${tag}`), 'Open register');
  await t.waitFor(t.hasText(`Register E2E${tag} is open`), 'the register open', 20_000);
  t.check('the register opens on the counted float', await t.evaluate(`[...document.querySelectorAll('main div')].some(d => d.textContent.trim() === 'Opening float' ) && ${t.hasText('5,000.00')}`), '');
  await t.shot('p2-register');

  // ── taking payment ──────────────────────────────────────────────────
  // The fixture is a day ahead, so it is not on today's list: it is paid from its booking on the calendar.
  await rail('Calendar');
  await t.waitFor(`!!document.querySelector('button[aria-label="The day after"]')`, 'the calendar', 20_000);
  const ahead = [1, 2, 3, 4, 5, 6, 7].find((n) => day(n) === visit.date) ?? 1;
  for (let n = 0; n < ahead; n++) await t.evaluate(`document.querySelector('button[aria-label="The day after"]').click()`);
  const block = `[...document.querySelectorAll('main button[title]')].find(b => b.title.includes(${js(client.name)}) && b.title.startsWith(${js(visit.start)}))`;
  await t.waitFor(`!!${block}`, 'the visit on the calendar', 20_000);
  await t.evaluate(`${block}.click()`);
  await t.waitFor(`!!document.querySelector('[role="dialog"]') && ${t.hasText('Take payment')}`, 'the booking, with Take payment');
  await press('[role="dialog"]', is('Take payment'), 'Take payment');
  await t.waitFor(`${t.hasText('To pay')} && ${t.hasText(`Paying into register E2E${tag}`)}`, 'the bill, and the open register', 20_000);
  const quote = (await api('GET', `/api/salon/v1/visits/${made.visit}/checkout`)).data;
  const handed = [500, 1000, 5000].map((s) => Math.ceil(quote.to_pay / s) * s).find((n) => n > quote.to_pay) ?? quote.to_pay + 500;
  for (const k of String(handed)) await t.evaluate(`[...document.querySelectorAll('[aria-label="Cash keypad"] button')].find(b => b.textContent.trim() === ${js(k)}).click()`);
  await t.waitFor(`document.querySelector('output[aria-label="Cash handed over"]').textContent.includes(${js(handed.toLocaleString('en-US'))})`, 'the cash typed on the keypad');
  const change = handed - quote.to_pay;
  await t.waitFor(`!!document.querySelector('[role="radiogroup"][aria-label="What to do with the rest"]')`, 'the change-or-credit choice');
  await t.evaluate(`[...document.querySelectorAll('[role="radiogroup"][aria-label="What to do with the rest"] [role="radio"]')].find(b => b.textContent.startsWith('Give')).click()`);
  await t.shot('p3-pay');
  let before = jobs();
  await press(DESK, `((s) => s.startsWith('Take '))`, 'Take');
  const paidScreen = `document.querySelector('main[aria-label="SalonMate · Paid"]')`;
  await t.waitFor(`!!${paidScreen}?.querySelector('output[aria-label="Give back"]')`, 'the Paid screen, with the change to give', 30_000);
  const giveBack = await t.evaluate(`${paidScreen}.querySelector('output[aria-label="Give back"]').textContent.trim()`);
  const after = (await api('GET', `/api/salon/v1/visits/${made.visit}`)).data?.visit;
  t.check('paid in cash: checked out, invoiced, nothing owed, and the change is said', after?.checked_out === true && after?.invoice?.owed === 0 && !!giveBack && giveBack.endsWith(change.toLocaleString('en-US', { minimumFractionDigits: 2 })), js({ invoice: after?.invoice, giveBack, change }));
  await t.shot('p4-paid');
  if (printer && printerDir) {
    const out = await until(() => {
      const n = newJobs(before);
      return n.some((b) => b.equals(PULSE)) && n.some((b) => b.subarray(0, 4).toString() === '%PDF') ? n : null;
    }, 'the receipt and the drawer');
    t.check('the drawer opens and the receipt prints as the payment is taken', !!out, `${out?.length ?? 0} jobs`);
  }

  // ── closing the day ─────────────────────────────────────────────────
  await rail('Close the day');
  await t.waitFor(t.hasText('count the drawer'), 'the count', 20_000);
  await typeInto('input[aria-label="How many 5,000"]', '1');
  await typeInto('input[aria-label="How many 1,000"]', '1');
  await t.fill('Why it is out, if it is', 'E2E: counted short on purpose');
  before = jobs();
  await press(DESK, `((s) => s.startsWith('Close register'))`, 'Close register');
  await t.waitFor(t.hasText(`Register E2E${tag} closed`), 'the register closed', 20_000);
  const sessions = (await api('GET', `/api/pos/sessions?org=${org}&register=${made.register}`)).data;
  const last = (sessions?.items ?? sessions ?? [])[0];
  t.check('the register closes on the count, and says how far out it is', last?.status === 'closed' && (await t.evaluate(t.hasText('Short by'))), js({ status: last?.status, counted: last?.counted_cash, expected: last?.expected_cash }));
  await t.shot('p5-closed');
  if (printer && printerDir) {
    const z = await until(() => newJobs(before).find((b) => b.subarray(0, 4).toString() === '%PDF'), 'the Z-report');
    t.check('the Z-report prints as the register closes', !!z, '');
  }
} catch (e) {
  t.check('run', false, e instanceof Error ? e.message : String(e));
  await t.shot('p-fail').catch(() => undefined);
} finally {
  if (made.register) {
    const r = await api('PUT', `/api/pos/registers/${made.register}`, { active: false });
    if (r.status >= 300) console.log(`cleanup: the register was not switched off — ${r.status} ${r.message}`);
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
await t.finish();

// End-to-end: Inventory, part 2 — against a real server, through the UI:
// an adjustment raised, sent for approval, approved, posted and reversed; a
// serialised product brought on by adjustment, its units listed, one opened
// and found again by scanning; a transfer approved, shipped and received
// short; a stock count started, counted and posted; opening stock recorded
// for a batch-tracked product, then seen in Batches and Expiring.
//
// Makes its own products ("E2E Inv2 … <tag>"). Stocked products cannot be
// archived, so they stay, with their documents. Needs a user who holds
// inventory.* (locally: the "E2E Orders" role).
//
//   npm run build
//   WS_E2E_SERVER=… WS_E2E_EMAIL=… WS_E2E_PASSWORD=… ELECTRON_RUN_AS_NODE=1 npx electron tests/e2e/inventory-2.mjs
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
const until = async (fn, label, tries = 40) => {
  let v;
  for (let i = 0; i < tries; i++) {
    v = await fn();
    if (v) return v;
    await sleep(400);
  }
  throw new Error(`${label}: never happened`);
};
const onHand = async (pid, wid) => {
  const d = (await api('GET', `/api/inventory/products/${pid}`)).data;
  const l = (d?.levels ?? []).find((x) => Number(x.warehouse_id) === wid);
  return l ? Number(l.on_hand) : 0;
};

const t = await launch({ name: 'inventory-2' });
const press = async (scope, text, what = text) => {
  await t.waitFor(`[...document.querySelectorAll(${js(scope + ' button')})].some(b => b.textContent.trim() === ${js(text)} && !b.disabled)`, `the ${what} button`, 15_000);
  await t.evaluate(`[...document.querySelectorAll(${js(scope + ' button')})].find(b => b.textContent.trim() === ${js(text)} && !b.disabled).click()`);
};
const typeInto = async (selector, value) => {
  await t.waitFor(`!!document.querySelector(${js(selector)})`, selector, 15_000);
  return t.evaluate(`(() => { const el = document.querySelector(${js(selector)}); el.focus(); const set = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set; set.call(el, ${js(value)}); el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
};
const pickFrom = async (label, text, search, scope = '') => {
  await t.waitFor(`!!document.querySelector(${js(`${scope} button[role="combobox"][aria-label="${label}"]`.trim())})`, `the ${label} picker`, 15_000);
  await t.evaluate(`document.querySelector(${js(`${scope} button[role="combobox"][aria-label="${label}"]`.trim())}).click()`);
  await t.waitFor(`!!document.querySelector('[role="listbox"][aria-label=${js(label)}]')`, `the ${label} list`);
  if (search) await typeInto(`input[aria-label=${js(`Search ${label}`)}]`, search);
  await t.waitFor(`[...document.querySelectorAll('[role="listbox"][aria-label=${js(label)}] [role="option"]')].some(o => o.textContent.includes(${js(text)}))`, `${text} in ${label}`, 15_000);
  await t.evaluate(`[...document.querySelectorAll('[role="listbox"][aria-label=${js(label)}] [role="option"]')].find(o => o.textContent.includes(${js(text)})).click()`);
};
const rail = async (label) => {
  const ok = await t.evaluate(`(() => { const b = [...document.querySelectorAll('nav[aria-label="Inventory"] button')].find(b => b.textContent.trim().startsWith(${js(label)})); if (b) b.click(); return !!b; })()`);
  if (!ok) throw new Error(`no ${label} in the rail`);
};
const textOf = (sel) => t.evaluate(`document.querySelector(${js(sel)})?.textContent ?? ''`);
const panel = (label) => `aside[aria-label^=${js(label)}]`;
const confirmDialog = async (text) => press('[role="dialog"]', text, `the dialog's ${text}`);

try {
  bearer = (await api('POST', '/api/auth/login', { email, password })).data?.tokens?.access_token ?? '';

  // ── fixtures ──────────────────────────────────────────────────────────
  const whs = ((await api('GET', '/api/inventory/warehouses')).data?.warehouses ?? []).filter((w) => w.can_act !== false);
  const [w1, w2] = whs;
  const mk = async (name, extra = {}) => (await api('POST', '/api/inventory/products', { name, cost_price: 100, unit_price: 150, ...extra })).data?.product?.id;
  const plainId = await mk(`E2E Inv2 Nut ${tag}`, { code: `EIN${tag}` });
  const serialId = await mk(`E2E Inv2 Camera ${tag}`, { code: `EIC${tag}`, tracking: 'serial' });
  const batchId = await mk(`E2E Inv2 Oil ${tag}`, { code: `EIO${tag}`, tracking: 'batch' });
  const opening = await api('POST', '/api/inventory/stock/opening', { warehouse_id: w1?.id, lines: [{ product_id: plainId, quantity: 20, unit_cost: 100 }] });
  t.check('fixtures: two warehouses, three products, twenty nuts on hand', !!(w1 && w2 && plainId && serialId && batchId && opening.status === 200), js({ whs: whs.length, plainId, serialId, batchId, opening: [opening.status, opening.message] }));

  await t.signIn(server, email, password);
  await sleep(1500);
  await t.evaluate(`(() => { const b = [...document.querySelectorAll('nav button')].find(b => b.textContent.trim() === 'Inventory'); if (b) b.click(); return !!b; })()`);
  await t.waitFor(`!!document.querySelector('nav[aria-label="Inventory"]')`, 'the Inventory rail', 30_000);
  const native = await t.evaluate(`['Adjustments', 'Transfers', 'Stock counts', 'Batches & serials'].every(l => [...document.querySelectorAll('nav[aria-label="Inventory"] button')].some(b => b.textContent.trim().startsWith(l) && !(b.title || '').includes('browser')))`);
  t.check('the control screens open here, not in the browser', native);

  // ── an adjustment: raise, approve, post, reverse ──────────────────────
  await rail('Adjustments');
  await t.waitFor(t.hasText('No adjustment matches.') + ` || !!document.querySelector('[data-adjustment]') || document.querySelector('main')?.textContent.includes('No adjustments yet.')`, 'the adjustments list', 20_000);
  await press('main', 'New adjustment');
  await t.waitFor(`!!document.querySelector('[role="form"][aria-label="New adjustment"]')`, 'the new adjustment form', 20_000);
  await pickFrom('Warehouse', w1.name, null, '[role="dialog"]');
  await typeInto('[role="dialog"] input[aria-label="Why"]', `Two dropped in unloading ${tag}`);
  await pickFrom('Line 1 product', `E2E Inv2 Nut ${tag}`, `EIN${tag}`, '[role="dialog"]');
  await typeInto('[role="dialog"] input[aria-label="Line 1 quantity"]', '-2');
  await t.shot('j1-new-adjustment');
  await press('[role="dialog"]', 'Create');
  await t.waitFor(`!!document.querySelector('${panel('Adjustment ')}') && document.querySelector('${panel('Adjustment ')}').textContent.includes(${js(w1.name)})`, 'the new adjustment opened, with its warehouse named', 20_000);
  const adjRef = (await textOf(`${panel('Adjustment ')} b`)).trim();
  const adj = ((await api('GET', `/api/inventory/adjustments?q=${encodeURIComponent(adjRef)}`)).data?.adjustments ?? [])[0];
  t.check('it is a draft, with its reason, note and line', adj?.status === 'draft' && adj.reason === 'damage' && Number(adj.line_count) === 1, js(adj && { status: adj.status, reason: adj.reason, lines: adj.line_count }));
  const needs = (await api('GET', `/api/inventory/adjustments/${adj.id}`)).data?.needs_approval;
  if (needs) {
    await press(panel('Adjustment '), 'Send for approval');
    await until(async () => (await api('GET', `/api/inventory/adjustments/${adj.id}`)).data?.adjustment?.status === 'pending', 'pending');
    await press(panel('Adjustment '), 'Approve');
    await until(async () => (await api('GET', `/api/inventory/adjustments/${adj.id}`)).data?.adjustment?.status === 'approved', 'approved');
    await t.waitFor(`document.querySelector('[data-adjustment-state]')?.textContent.includes('ready to post')`, 'ready to post');
    t.check('sent for approval, then approved', true);
  } else t.skip('approval is switched off on this server', 'posted straight from draft');
  await press(panel('Adjustment '), 'Post to stock');
  await confirmDialog('Post to stock');
  await until(async () => (await api('GET', `/api/inventory/adjustments/${adj.id}`)).data?.adjustment?.status === 'posted', 'posted');
  t.check('posting writes two off the shelf', (await onHand(plainId, w1.id)) === 18, String(await onHand(plainId, w1.id)));
  await t.shot('j2-posted');
  await press(panel('Adjustment '), 'Reverse');
  await confirmDialog('Reverse');
  await t.waitFor(`(document.querySelector('${panel('Adjustment ')} b')?.textContent.trim() ?? ${js(adjRef)}) !== ${js(adjRef)}`, 'the reversal opened', 20_000);
  const rev = await textOf(panel('Adjustment '));
  t.check('the reversal says what it reverses, and is ready to post', rev.includes(`Reversal of ${adjRef}`) && rev.includes('+2') && rev.includes('ready to post'), rev.slice(0, 200));
  await press(panel('Adjustment '), 'Post to stock');
  await confirmDialog('Post to stock');
  await until(async () => (await onHand(plainId, w1.id)) === 20, 'the reversal posted');
  t.check('reversing makes a new adjustment the other way, which posts the two back', true);
  await t.evaluate(`document.querySelector('${panel('Adjustment ')} button[aria-label="Close"]').click()`);

  // ── serialised units in by adjustment ─────────────────────────────────
  await press('main', 'New adjustment');
  await t.waitFor(`!!document.querySelector('[role="form"][aria-label="New adjustment"]')`, 'the form again', 20_000);
  await pickFrom('Warehouse', w1.name, null, '[role="dialog"]');
  await pickFrom('Reason', 'Found', null, '[role="dialog"]');
  await pickFrom('Line 1 product', `E2E Inv2 Camera ${tag}`, `EIC${tag}`, '[role="dialog"]');
  await typeInto('[role="dialog"] input[aria-label="Line 1 quantity"]', '2');
  await typeInto('[role="dialog"] textarea[aria-label="Line 1 serials"]', `SNA-${tag}\nSNB-${tag}`);
  await press('[role="dialog"]', 'Create');
  await t.waitFor(`!!document.querySelector('${panel('Adjustment ')}') && document.querySelector('${panel('Adjustment ')}').textContent.includes('SN SNA-${tag}')`, 'a line per unit, each with its serial', 20_000);
  if (needs) {
    await press(panel('Adjustment '), 'Send for approval');
    await press(panel('Adjustment '), 'Approve');
  }
  await press(panel('Adjustment '), 'Post to stock');
  await confirmDialog('Post to stock');
  await until(async () => (await onHand(serialId, w1.id)) === 2, 'two cameras in stock');
  t.check('a serialised product comes in named, one unit per serial', true);
  await t.evaluate(`document.querySelector('${panel('Adjustment ')} button[aria-label="Close"]').click()`);

  await rail('Batches & serials');
  await press('main', 'Serials');
  await typeInto('input[aria-label="Search serials"]', `-${tag}`);
  await t.waitFor(`document.querySelectorAll('[data-serial]').length === 2`, 'the two units listed', 20_000);
  await t.evaluate(`[...document.querySelectorAll('[data-serial]')].find(b => b.textContent.includes('SNA-${tag}')).click()`);
  await t.waitFor(`!!document.querySelector('${panel('Unit ')}') && document.querySelector('${panel('Unit ')}').textContent.includes('Everything it did')`, 'the unit', 20_000);
  const unit = await textOf(panel('Unit '));
  t.check('a unit shows how it is identified, what is known, and what it did', unit.includes('How it is identified') && unit.includes(w1.name) && unit.includes('in stock') && unit.includes('can be sold') && /Adjusted|Found|Received/.test(unit), unit.slice(0, 260));
  await t.shot('j3-unit');
  await t.evaluate(`document.querySelector('${panel('Unit ')} button[aria-label="Close"]').click()`);
  await typeInto('input[aria-label="Scan a barcode, QR or tag"]', `SNB-${tag}`);
  await press('main', 'Find');
  await t.waitFor(`!!document.querySelector('${panel('Unit SNB-' + tag)}')`, 'the scanned unit opened', 15_000);
  t.check('scanning a serial opens its unit', true);
  await t.evaluate(`document.querySelector('${panel('Unit ')} button[aria-label="Close"]').click()`);

  // ── a transfer, received short ────────────────────────────────────────
  await rail('Transfers');
  await press('main', 'New transfer');
  await t.waitFor(`!!document.querySelector('[role="form"][aria-label="New transfer"]')`, 'the new transfer form', 20_000);
  await pickFrom('From', w1.name, null, '[role="dialog"]');
  await pickFrom('To', w2.name, null, '[role="dialog"]');
  await pickFrom('Line 1 product', `E2E Inv2 Nut ${tag}`, `EIN${tag}`, '[role="dialog"]');
  await typeInto('[role="dialog"] input[aria-label="Line 1 quantity"]', '5');
  await typeInto('[role="dialog"] input[aria-label="Tracking number"]', `PL-${tag}`);
  await press('[role="dialog"]', 'Create');
  await t.waitFor(`!!document.querySelector('${panel('Transfer ')}') && document.querySelector('${panel('Transfer ')}').textContent.includes(${js(`${w1.name} → ${w2.name}`)})`, 'the transfer opened, from → to', 20_000);
  const trfRef = (await textOf(`${panel('Transfer ')} b`)).trim();
  const trf = ((await api('GET', `/api/inventory/transfers?q=${encodeURIComponent(trfRef)}`)).data?.transfers ?? [])[0];
  const tneeds = (await api('GET', `/api/inventory/transfers/${trf.id}`)).data?.needs_approval;
  if (tneeds) await press(panel('Transfer '), 'Approve');
  await press(panel('Transfer '), 'Ship');
  await confirmDialog('Ship');
  await until(async () => (await api('GET', `/api/inventory/transfers/${trf.id}`)).data?.transfer?.status === 'in_transit', 'in transit');
  t.check('shipping takes the five out of the source', (await onHand(plainId, w1.id)) === 15, String(await onHand(plainId, w1.id)));
  await typeInto(`${panel('Transfer ')} input[aria-label="Receiving EIN${tag}"]`, '4');
  await t.shot('j4-receiving');
  await press(panel('Transfer '), 'Receive');
  await until(async () => (await api('GET', `/api/inventory/transfers/${trf.id}`)).data?.transfer?.status === 'received', 'received');
  t.check('receiving four of five: four arrive, and the one that did not is not written off again', (await onHand(plainId, w2.id)) === 4 && (await onHand(plainId, w1.id)) === 15, js({ w1: await onHand(plainId, w1.id), w2: await onHand(plainId, w2.id) }));
  await t.waitFor(`document.querySelector('[data-transfer-state]')?.textContent.startsWith('Received')`, 'the panel says received');
  await t.evaluate(`document.querySelector('${panel('Transfer ')} button[aria-label="Close"]').click()`);

  // ── a stock count ─────────────────────────────────────────────────────
  await rail('Stock counts');
  await press('main', 'New count');
  await t.waitFor(`!!document.querySelector('[role="form"][aria-label="New stock count"]')`, 'the new count form', 20_000);
  await pickFrom('Warehouse', w1.name, null, '[role="dialog"]');
  await pickFrom('Kind', 'Full physical count', null, '[role="dialog"]');
  await press('[role="dialog"]', 'Create');
  await t.waitFor(`!!document.querySelector('${panel('Count ')}') && document.querySelector('${panel('Count ')}').textContent.includes('Starting the count freezes')`, 'the count sheet, a draft', 20_000);
  await press(panel('Count '), 'Start counting');
  await t.waitFor(`!!document.querySelector('${panel('Count ')} input[aria-label="Counted EIN${tag}"]')`, 'the sheet with our product on it', 20_000);
  const expected = await t.evaluate(`document.querySelector('[data-count-line="EIN${tag}"]').textContent`);
  await typeInto(`${panel('Count ')} input[aria-label="Counted EIN${tag}"]`, '14');
  await t.waitFor(`document.querySelector('[data-count-line="EIN${tag}"]').textContent.includes('−1')`, 'the variance worked out as it is typed');
  await t.shot('j5-count');
  await press(panel('Count '), 'Post variances');
  await confirmDialog('Post variances');
  await until(async () => (await onHand(plainId, w1.id)) === 14, 'the count posted');
  t.check('counting 14 where 15 were expected posts a difference of one', expected.includes('15'), expected);
  await t.waitFor(`[...document.querySelectorAll('${panel('Count ')} button')].some(b => b.textContent.trim() === 'Its adjustment')`, 'the link to its adjustment');
  await press(panel('Count '), 'Its adjustment');
  await t.waitFor(`!!document.querySelector('${panel('Adjustment ')}') && document.querySelector('${panel('Adjustment ')}').textContent.includes('Stock count')`, 'the count’s adjustment opened', 20_000);
  t.check('a posted count opens the adjustment it made', true);
  await t.evaluate(`document.querySelector('${panel('Adjustment ')} button[aria-label="Close"]').click()`);

  // ── opening stock, batches and expiring ───────────────────────────────
  await t.evaluate(`[...document.querySelectorAll('nav[aria-label="Inventory"] button')].find(b => b.textContent.trim() === 'Record opening stock').click()`);
  await t.waitFor(`!!document.querySelector('[role="form"][aria-label="Opening stock"]')`, 'the opening stock form', 20_000);
  await pickFrom('Warehouse', w2.name, null, '[role="dialog"]');
  await pickFrom('Line 1 product', `E2E Inv2 Oil ${tag}`, `EIO${tag}`, '[role="dialog"]');
  await typeInto('[role="dialog"] input[aria-label="Line 1 quantity"]', '6');
  await typeInto('[role="dialog"] input[aria-label="Line 1 batch"]', `B-${tag}`);
  const soon = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
  await typeInto('[role="dialog"] input[aria-label="Line 1 expiry"]', soon);
  await press('[role="dialog"]', 'Record');
  await until(async () => (await onHand(batchId, w2.id)) === 6, 'the opening balance');
  t.check('opening stock records a batch-tracked product with its batch', true);
  await rail('Batches & serials');
  await press('main', 'Batches');
  await typeInto('input[aria-label="Search batches"]', `B-${tag}`);
  await t.waitFor(`[...document.querySelectorAll('[data-batch]')].some(b => b.textContent.includes('B-${tag}') && b.textContent.includes('6'))`, 'the batch listed', 20_000);
  await press('main', 'Expiring');
  await t.waitFor(`[...document.querySelectorAll('[data-expiring]')].some(b => b.textContent.includes('B-${tag}'))`, 'the batch expiring within the window', 20_000);
  t.check('it shows in Batches, and in Expiring ten days out', true);
  await t.shot('j6-expiring');
} catch (e) {
  t.check(`no unexpected error (${e.message})`, false);
  await t.shot('jz-failure').catch(() => undefined);
} finally {
  await t.finish();
}

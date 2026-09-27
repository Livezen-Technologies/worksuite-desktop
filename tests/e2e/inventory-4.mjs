// End-to-end: Inventory, part 4 — manufacturing, and sales orders through
// Sales & Orders, against a real server, through the UI: a recipe made,
// costed and made the one used; a job started from it, released (its parts
// reserved, and not reported short of them), and completed in two runs —
// the parts used, the goods on the shelf, and the unit cost every run's, the
// planned labour charged once; two presses of the same completion making the
// goods once; Sales orders opening in Sales & Orders, and an invoice raised
// there for what was delivered, once.
//
// Makes its own products, customer and orders ("E2E Inv4 … <tag>"). Stock
// stays. Needs a user who holds inventory.* and Orders (locally: the "E2E
// Orders" role).
//
//   npm run build
//   WS_E2E_SERVER=… WS_E2E_EMAIL=… WS_E2E_PASSWORD=… ELECTRON_RUN_AS_NODE=1 npx electron tests/e2e/inventory-4.mjs
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
const near = (a, b) => Math.abs(Number(a) - b) < 0.01;

const t = await launch({ name: 'inventory-4' });
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
const job = async (id) => (await api('GET', `/api/inventory/assemblies/${id}`)).data;

try {
  bearer = (await api('POST', '/api/auth/login', { email, password })).data?.tokens?.access_token ?? '';

  // ── fixtures ──────────────────────────────────────────────────────────
  const wh = ((await api('GET', '/api/inventory/warehouses')).data?.warehouses ?? []).find((w) => w.can_act !== false);
  const make = async (name, code, cost) => (await api('POST', '/api/inventory/products', { name, code, cost_price: cost, unit_price: cost * 3 || 500, is_stocked: 1 })).data?.product?.id;
  const nutId = await make(`E2E Inv4 Nut ${tag}`, `E4N${tag}`, 10);
  const plateId = await make(`E2E Inv4 Plate ${tag}`, `E4P${tag}`, 50);
  const widgetId = await make(`E2E Inv4 Widget ${tag}`, `E4W${tag}`, 0);
  const opening = await api('POST', '/api/inventory/stock/opening', {
    warehouse_id: wh?.id,
    lines: [
      { product_id: nutId, quantity: 40, unit_cost: 10 },
      { product_id: plateId, quantity: 10, unit_cost: 50 },
    ],
  });
  t.check('fixtures: a warehouse, two parts in stock and a product to make', !!(wh && nutId && plateId && widgetId && opening.status < 300), js({ wh: wh?.name, nutId, plateId, widgetId, opening: [opening.status, opening.message] }));

  await t.signIn(server, email, password);
  await sleep(1500);
  await t.evaluate(`(() => { const b = [...document.querySelectorAll('nav button')].find(b => b.textContent.trim() === 'Inventory'); if (b) b.click(); return !!b; })()`);
  await t.waitFor(`!!document.querySelector('nav[aria-label="Inventory"]')`, 'the Inventory rail', 30_000);
  const titles = await t.evaluate(`Object.fromEntries(['Manufacturing', 'Sales orders'].map(l => [l, [...document.querySelectorAll('nav[aria-label="Inventory"] button')].find(b => b.textContent.trim().startsWith(l))?.title ?? null]))`);
  t.check('Manufacturing opens here, and Sales orders in Sales & Orders', titles.Manufacturing === 'Manufacturing' && /Sales & Orders/.test(titles['Sales orders'] ?? ''), js(titles));

  // ── a recipe ──────────────────────────────────────────────────────────
  await rail('Manufacturing');
  await press('main', 'Recipes');
  await press('main', 'New recipe');
  await t.waitFor(`!!document.querySelector('[role="form"][aria-label="New recipe"]')`, 'the new recipe form', 20_000);
  await pickFrom('What it makes', `E2E Inv4 Widget ${tag}`, `E4W${tag}`, '[role="dialog"]');
  await typeInto('[role="dialog"] input[aria-label="One run makes"]', '2');
  await typeInto('[role="dialog"] input[aria-label="Recipe name"]', `Standard ${tag}`);
  await typeInto('[role="dialog"] input[aria-label="Labour per run"]', '30');
  await typeInto('[role="dialog"] input[aria-label="Overhead per run"]', '10');
  await pickFrom('Part 1', `E2E Inv4 Nut ${tag}`, `E4N${tag}`, '[role="dialog"]');
  await typeInto('[role="dialog"] input[aria-label="Part 1 quantity"]', '4');
  await press('[role="dialog"]', '+ Add a part');
  await pickFrom('Part 2', `E2E Inv4 Plate ${tag}`, `E4P${tag}`, '[role="dialog"]');
  await typeInto('[role="dialog"] input[aria-label="Part 2 quantity"]', '1');
  await t.shot('m1-new-recipe');
  await press('[role="dialog"]', 'Create');
  await t.waitFor(`!!document.querySelector('${panel('Recipe for ')}')`, 'the recipe opened', 20_000);
  const bom = ((await api('GET', `/api/inventory/boms?q=${encodeURIComponent(`E4W${tag}`)}`)).data?.boms ?? [])[0];
  const bd = (await api('GET', `/api/inventory/boms/${bom?.id}`)).data;
  t.check('the recipe is a draft with its two parts, labour and overhead', bd?.bom?.status === 'draft' && bd.lines.length === 2 && near(bd.bom.labour_cost, 30) && near(bd.bom.overhead_cost, 10), js(bd?.bom && { status: bd.bom.status, parts: bd.lines.length, labour: bd.bom.labour_cost, overhead: bd.bom.overhead_cost }));
  // One run: 4 nuts at 10, a plate at 50, labour 30, overhead 10 = 130 for two.
  await t.waitFor(`!!document.querySelector('[data-bom-estimate]')`, 'the estimate', 15_000);
  t.check('it is costed before it is used: 65 each', (await textOf('[data-bom-estimate]')).includes('65.00'), (await textOf('[data-bom-estimate]')).slice(0, 160));
  await press(panel('Recipe for '), 'Make it the recipe used');
  await until(async () => (await api('GET', `/api/inventory/boms/${bom.id}`)).data?.bom?.status === 'active', 'active');
  t.check('made the recipe used', true);
  await t.shot('m2-recipe');

  // ── a job from it ─────────────────────────────────────────────────────
  await press(panel('Recipe for '), 'Start a job');
  await t.waitFor(`!!document.querySelector('[role="form"][aria-label="New job"]')`, 'the new job form', 20_000);
  await t.waitFor(`document.querySelector('[role="form"][aria-label="New job"]').textContent.includes('One run makes 2')`, 'the recipe chosen for it', 15_000);
  await pickFrom('Made at', wh.name, null, '[role="dialog"]');
  await typeInto('[role="dialog"] input[aria-label="How many"]', '4');
  await press('[role="dialog"]', 'Create');
  await t.waitFor(`!!document.querySelector('${panel('Job ')}')`, 'the job opened', 20_000);
  const jobRef = (await textOf(`${panel('Job ')} b`)).trim();
  const jobRow = ((await api('GET', '/api/inventory/assemblies?status=draft')).data?.assemblies ?? []).find((a) => a.reference === jobRef);
  t.check('the job is a draft for four', jobRow?.status === 'draft' && near(jobRow.quantity, 4), js(jobRow && { status: jobRow.status, qty: jobRow.quantity }));
  await t.waitFor(`document.querySelector('${panel('Job ')}')?.textContent.includes(${js(`E2E Inv4 Widget ${tag}`)})`, 'the job names its product', 15_000);
  const head = await textOf(panel('Job '));
  t.check('the job names what it makes and where, the recipe after it', head.includes(`${wh.name} · `) && head.includes('the recipe'), head.slice(0, 160));

  await press(panel('Job '), 'Release — reserve the parts');
  await until(async () => (await job(jobRow.id))?.assembly?.status === 'released', 'released');
  await t.waitFor(`!!document.querySelector('${panel('Job ')} [data-part]')`, 'the parts list', 15_000);
  const released = await job(jobRow.id);
  const nutLine = released.lines.find((l) => Number(l.component_id) === nutId);
  const panelText = await textOf(panel('Job '));
  t.check('released: eight nuts and two plates reserved, and not reported short of them', near(nutLine?.required_qty, 8) && near(nutLine?.short, 0) && !panelText.includes('Short of'), js({ required: nutLine?.required_qty, available: nutLine?.available, short: nutLine?.short, banner: panelText.includes('Short of') }));
  await t.shot('m3-released');

  // ── two runs ──────────────────────────────────────────────────────────
  await typeInto(`${panel('Job ')} input[aria-label="Good units made"]`, '2');
  await press(panel('Job '), 'Record the run…');
  await confirmDialog('Record the run');
  await until(async () => near((await job(jobRow.id))?.assembly?.produced_qty, 2), 'the first run');
  const mid = (await job(jobRow.id)).assembly;
  t.check('the first run makes two and uses half the parts', mid.status === 'in_progress' && (await onHand(widgetId, wh.id)) === 2 && (await onHand(nutId, wh.id)) === 36, js({ status: mid.status, widgets: await onHand(widgetId, wh.id), nuts: await onHand(nutId, wh.id) }));
  t.check('and leaves the planned labour as it was', near(mid.labour_cost, 60) && near(mid.overhead_cost, 20), js({ labour: mid.labour_cost, overhead: mid.overhead_cost }));
  await t.waitFor(`document.querySelector('${panel('Job ')} [data-job-progress]')?.textContent.startsWith('2 of 4')`, 'the panel says two of four', 15_000);
  await press(panel('Job '), 'Record the run…');
  await confirmDialog('Record the run');
  await until(async () => (await job(jobRow.id))?.assembly?.status === 'completed', 'completed');
  const done = (await job(jobRow.id)).assembly;
  // Parts 8×10 + 2×50 = 180, labour 60, overhead 20: 260 over four.
  t.check('the rest is made, and each costs 65 — every run, the labour charged once', near(done.produced_qty, 4) && near(done.unit_cost, 65) && (await onHand(widgetId, wh.id)) === 4 && (await onHand(nutId, wh.id)) === 32 && (await onHand(plateId, wh.id)) === 8, js({ made: done.produced_qty, unit: done.unit_cost, widgets: await onHand(widgetId, wh.id), nuts: await onHand(nutId, wh.id), plates: await onHand(plateId, wh.id) }));
  await t.waitFor(`document.querySelector('${panel('Job ')}')?.textContent.includes('What it cost')`, 'what it cost', 15_000);
  t.check('the job says what each one cost', (await textOf(panel('Job '))).includes('65.00'), '');
  await t.shot('m4-completed');
  await t.evaluate(`document.querySelector('${panel('Job ')} button[aria-label="Close"]')?.click()`);

  // ── two presses make the goods once ───────────────────────────────────
  const second = (await api('POST', '/api/inventory/assemblies', { bom_id: bom.id, warehouse_id: wh.id, quantity: 2 })).data?.id;
  await api('POST', `/api/inventory/assemblies/${second}/release`, {});
  const beforeTwice = await onHand(widgetId, wh.id);
  const both = await Promise.all([api('POST', `/api/inventory/assemblies/${second}/complete`, {}), api('POST', `/api/inventory/assemblies/${second}/complete`, {})]);
  const twice = (await job(second)).assembly;
  t.check('two presses of Complete make the goods once', both.filter((r) => r.status < 300).length === 1 && near(twice.produced_qty, 2) && (await onHand(widgetId, wh.id)) === beforeTwice + 2, js({ statuses: both.map((r) => r.status), made: twice.produced_qty, widgets: await onHand(widgetId, wh.id) }));

  // ── a draft recipe is not built ───────────────────────────────────────
  const draftBom = (await api('POST', '/api/inventory/boms', { product_id: widgetId, name: `Draft ${tag}`, output_qty: 1, lines: [{ component_id: nutId, quantity: 1 }] })).data?.id;
  const fromDraft = await api('POST', '/api/inventory/assemblies', { bom_id: draftBom, warehouse_id: wh.id, quantity: 1 });
  await api('DELETE', `/api/inventory/boms/${draftBom}`);
  t.check('a draft recipe is not built', fromDraft.status === 422 && /draft/.test(fromDraft.message ?? ''), js([fromDraft.status, fromDraft.message]));

  // ── sales orders, in Sales & Orders ───────────────────────────────────
  const acct = await api('POST', '/api/crm/accounts', { name: `E2E Inv4 Customer ${tag}` });
  const clientId = acct.data?.id ?? acct.data?.account?.id;
  const so = (await api('POST', '/api/inventory/sales-orders', { client_id: clientId, warehouse_id: wh.id, lines: [{ product_id: widgetId, quantity: 2, unit_price: 500 }] })).data?.order;
  const confirmed = await api('POST', `/api/inventory/sales-orders/${so?.id}/confirm`, {});
  const note = await api('POST', `/api/inventory/sales-orders/${so?.id}/deliver`, {});
  const shipped = await api('POST', `/api/inventory/deliveries/${note.data?.id}/dispatch`, {});
  t.check('fixtures: an order for two widgets, confirmed and dispatched', !!so && confirmed.status < 300 && shipped.status < 300, js({ so: so?.so_number, confirm: [confirmed.status, confirmed.message], note: [note.status, note.message], dispatch: [shipped.status, shipped.message] }));

  await rail('Sales orders');
  await t.waitFor(`!!document.querySelector('nav[aria-label="Orders"]')`, 'Sales & Orders', 30_000);
  t.check('Sales orders opens Sales & Orders', true);
  await t.evaluate(`(() => { const b = [...document.querySelectorAll('nav[aria-label="Orders"] button')].find(b => b.textContent.trim().startsWith('All orders')); if (b) b.click(); return !!b; })()`);
  await t.waitFor(`!!document.querySelector('[data-order="${so.id}"]')`, 'the order listed', 20_000);
  await t.evaluate(`document.querySelector('[data-order="${so.id}"] button[aria-label^="Open"]').click()`);
  await t.waitFor(`!!document.querySelector('aside[aria-label^="Order "] [data-order-actions]')`, 'the order drawer', 20_000);
  await press('aside[aria-label^="Order "] [data-order-actions]', 'Raise invoice');
  const inv = await until(async () => {
    const d = (await api('GET', `/api/inventory/sales-orders/${so.id}`)).data;
    return d?.invoices?.length ? d : null;
  }, 'the invoice');
  t.check('an invoice is raised for the two delivered', inv.invoices.length === 1 && near(inv.lines[0]?.invoiced_qty, 2) && inv.invoices[0].status === 'draft', js({ invoices: inv.invoices.map((i) => [i.id, i.status, i.total]), invoiced: inv.lines[0]?.invoiced_qty }));
  await t.waitFor(`![...document.querySelectorAll('aside[aria-label^="Order "] [data-order-actions] button')].some(b => b.textContent.trim() === 'Raise invoice')`, 'Raise invoice gone once all is invoiced', 15_000);
  const again = await api('POST', `/api/inventory/sales-orders/${so.id}/invoice`, {});
  t.check('and not again: nothing is left to bill', again.status >= 400 && ((await api('GET', `/api/inventory/sales-orders/${so.id}`)).data?.invoices?.length ?? 0) === 1, js([again.status, again.message]));
  await t.shot('m5-invoiced');

  const other = (await api('POST', '/api/inventory/sales-orders', { client_id: clientId, warehouse_id: wh.id, lines: [{ product_id: widgetId, quantity: 1, unit_price: 500 }] })).data?.order;
  const unconfirmed = await api('POST', `/api/inventory/sales-orders/${other?.id}/invoice`, {});
  await api('DELETE', `/api/inventory/sales-orders/${other?.id}`);
  t.check('an order not yet confirmed is not invoiced', unconfirmed.status === 409 && /Confirm/.test(unconfirmed.message ?? ''), js([unconfirmed.status, unconfirmed.message]));
} catch (e) {
  t.check(`no unexpected error (${e.message})`, false);
  await t.shot('mz-failure').catch(() => undefined);
} finally {
  await t.finish();
}

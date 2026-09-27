// End-to-end: Inventory, part 1 — against a real server, through the UI: the
// dashboard; the products list, narrowed by a category from the tree and by
// a search; a product's drawer (where it is, consumption, details, its sales,
// purchases and history); a new product made in the form, then edited; a
// stocked product's tracking held fixed; the categories renamed, added and
// deleted; the stock overview and the movements, each found by search; and
// a code scanned into the rail's box opening its product.
//
// Makes its own fixtures (two categories and two products named "E2E Inv …
// <tag>", one with opening stock in the first warehouse). The stocked one
// cannot be archived and stays, filed under no category; the rest is
// archived or deleted. Needs a user who holds inventory.* (locally: the
// "E2E Orders" role).
//
//   npm run build
//   WS_E2E_SERVER=… WS_E2E_EMAIL=… WS_E2E_PASSWORD=… ELECTRON_RUN_AS_NODE=1 npx electron tests/e2e/inventory.mjs
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
const made = { products: [], categories: [] };
const product = async (id) => (await api('GET', `/api/inventory/products/${id}`)).data?.product;
const until = async (fn, label, tries = 40) => {
  let v;
  for (let i = 0; i < tries; i++) {
    v = await fn();
    if (v) return v;
    await sleep(400);
  }
  throw new Error(`${label}: never happened`);
};

const t = await launch({ name: 'inventory' });
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
const pickFrom = async (label, text, search, scope = '') => {
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
const drawer = 'aside[aria-label^="Product "]';
const textIn = (scope, text) => `[...document.querySelectorAll(${js(scope)})].some(el => el.textContent.includes(${js(text)}))`;

try {
  bearer = (await api('POST', '/api/auth/login', { email, password })).data?.tokens?.access_token ?? '';

  // ── fixtures ──────────────────────────────────────────────────────────
  const parent = await api('POST', '/api/inventory/categories', { name: `E2E Inv Parts ${tag}` });
  const parentId = parent.data?.id;
  const child = await api('POST', '/api/inventory/categories', { name: `E2E Inv Bolts ${tag}`, parent_id: parentId });
  const childId = child.data?.id;
  made.categories.push(childId, parentId);
  const stocked = await api('POST', '/api/inventory/products', { name: `E2E Inv Bolt ${tag}`, code: `EIB${tag}`, barcode: `479${tag}01`, unit_price: 125, cost_price: 80, category_id: childId, reorder_point: 5 });
  const stockedId = stocked.data?.product?.id;
  made.products.push(stockedId);
  const warehouses = (await api('GET', '/api/inventory/warehouses')).data?.warehouses ?? [];
  const wh = warehouses[0];
  const opening = await api('POST', '/api/inventory/stock/opening', { warehouse_id: wh?.id, lines: [{ product_id: stockedId, quantity: 12, unit_cost: 80 }] });
  t.check(
    'fixtures: two categories, a product with twelve in stock',
    !!(parentId && childId && stockedId && wh && opening.status === 200),
    js({ parent: [parent.status, parent.message], child: [child.status, child.message], prod: [stocked.status, stocked.message], wh: wh?.name, opening: [opening.status, opening.message] }),
  );

  await t.signIn(server, email, password);
  await sleep(1500);
  await t.evaluate(`(() => { const b = [...document.querySelectorAll('nav button')].find(b => b.textContent.trim() === 'Inventory'); if (b) b.click(); return !!b; })()`);
  await t.waitFor(`!!document.querySelector('nav[aria-label="Inventory"]')`, 'the Inventory rail', 30_000);
  await t.waitFor(t.hasText('Coming in and going out'), 'the dashboard', 20_000);
  const tiles = await t.evaluate(`['Products', 'Categories', 'Vendors', 'Warehouses', 'Stock value', 'Units on hand', 'Low stock', 'Out of stock'].every(l => [...document.querySelectorAll('main span')].some(s => s.textContent.trim() === l))`);
  const panels = await t.evaluate(`['Stock movement, last 14 days', 'Stock health', 'Latest movements', 'Runs out soonest', 'To reorder', 'Checked against the shelves'].every(l => document.querySelector('main').textContent.includes(l))`);
  t.check('the dashboard has its eight figures and panels', tiles && panels, js({ tiles, panels }));
  // Every Inventory screen is on the desktop now (part 5, 0.2.37); none says it opens in the browser.
  const webItems = await t.evaluate(`[...document.querySelectorAll('nav[aria-label="Inventory"] button')].filter(b => (b.title || '').includes('opens in your browser')).map(b => b.textContent.trim())`);
  t.check('no Inventory screen sends you to the browser', webItems.length === 0, JSON.stringify(webItems));
  await t.shot('i1-dashboard');

  // ── products: the tree and a search ───────────────────────────────────
  await rail('Products');
  await t.waitFor(`!!document.querySelector('aside[aria-label="Categories"]')`, 'the category tree', 20_000);
  await t.waitFor(textIn('aside[aria-label="Categories"] button', `E2E Inv Bolts ${tag}`), 'the fixture category in the tree', 15_000);
  const counts = await t.evaluate(
    `(() => { const rows = [...document.querySelectorAll('aside[aria-label="Categories"] button')]; const p = rows.find(b => b.textContent.includes(${js(`E2E Inv Parts ${tag}`)})); const c = rows.find(b => b.textContent.includes(${js(`E2E Inv Bolts ${tag}`)})); return [p?.textContent, c?.textContent, parseInt(c?.style.paddingLeft) > parseInt(p?.style.paddingLeft)]; })()`,
  );
  t.check('the tree nests the child under its parent and counts it in both', counts[0]?.endsWith('1') && counts[1]?.endsWith('1') && counts[2] === true, js(counts));
  await t.evaluate(`[...document.querySelectorAll('aside[aria-label="Categories"] button')].find(b => b.textContent.includes(${js(`E2E Inv Parts ${tag}`)})).click()`);
  await t.waitFor(`document.querySelectorAll('[data-product]').length === 1 && !!document.querySelector('[data-product="${stockedId}"]')`, 'the list narrowed to the parent category', 15_000);
  t.check('choosing a parent category lists what is filed under its children', true);
  await t.evaluate(`[...document.querySelectorAll('aside[aria-label="Categories"] button')].find(b => b.textContent.trim() === 'All products').click()`);
  await typeInto('input[aria-label="Search products"]', `EIB${tag}`);
  await t.waitFor(`document.querySelectorAll('[data-product]').length === 1`, 'the search narrowed to one', 15_000);
  const row = await t.evaluate(`document.querySelector('[data-product="${stockedId}"]')?.textContent`);
  const nameWidth = await t.evaluate(`document.querySelector('[data-product="${stockedId}"] > button').getBoundingClientRect().width`);
  t.check('beside the tree the product name keeps its room', nameWidth >= 140, String(nameWidth));
  t.check('a product row shows its category, tracking, stock and price', /E2E Inv Bolts/.test(row) && /Quantity/.test(row) && /12/.test(row) && /125/.test(row), row);
  await t.shot('i2-products');

  // ── the drawer ────────────────────────────────────────────────────────
  await t.evaluate(`document.querySelector('[data-product="${stockedId}"] button').click()`);
  await t.waitFor(`!!document.querySelector('${drawer}') && document.querySelector('${drawer}').textContent.includes('Where it is')`, 'the product drawer', 20_000);
  const ov = await t.evaluate(`document.querySelector('${drawer}').textContent`);
  t.check(
    'the overview has its tiles, the warehouse, consumption and details',
    ['Available', 'On hand', 'Reserved', 'Incoming', wh.name, 'Consumption', 'Details', `E2E Inv Bolts ${tag}`, 'Plain quantity', 'FIFO'].every((s) => ov.includes(s)),
    ov.slice(0, 400),
  );
  await t.shot('i3-drawer');
  await press(drawer, 'Sales');
  await t.waitFor(textIn(drawer, 'Sold on'), 'the sales tab');
  t.check('the sales tab says it has not been sold', await t.evaluate(textIn(drawer, 'Not on any issued invoice yet.')), '');
  await press(drawer, 'Purchase');
  await t.waitFor(textIn(drawer, 'Bought on'), 'the purchase tab');
  await press(drawer, 'History');
  await t.waitFor(textIn(drawer, 'Everything that happened'), 'the history tab');
  await t.waitFor(textIn(drawer, 'Opening'), 'the opening movement in the history', 15_000);
  const hist = await t.evaluate(`document.querySelector('${drawer}').textContent`);
  t.check('the history lists the opening stock and the product being made', hist.includes('+12') && hist.includes('created'), hist.slice(0, 300));
  await t.shot('i4-history');

  // ── a stocked product's tracking is fixed ─────────────────────────────
  await press(drawer, 'Edit');
  await t.waitFor(`!!document.querySelector('form[aria-label="Edit product"]')`, 'the edit form', 20_000);
  await t.waitFor(`!!document.querySelector('form[aria-label="Edit product"] button[aria-label="Tracking"]')`, 'the tracking field');
  const fixed = await t.evaluate(
    `[document.querySelector('form[aria-label="Edit product"] button[aria-label="Tracking"]').disabled, document.querySelector('form[aria-label="Edit product"] button[aria-label="Costing"]').disabled, document.querySelector('form[aria-label="Edit product"]').textContent.includes('Stock is on hand')]`,
  );
  t.check('with stock on hand, tracking and costing cannot be changed', fixed.every(Boolean), js(fixed));
  await typeInto('form[aria-label="Edit product"] input[aria-label="Selling price"]', '130');
  await press('[role="dialog"]', 'Save');
  const saved = await until(async () => {
    const p = await product(stockedId);
    return Number(p?.unit_price) === 130 ? p : null;
  }, 'the edit saved');
  t.check('an edit saves, and leaves the tracking as it was', saved.tracking === 'none' && Number(saved.cost_price) === 80, js({ tracking: saved.tracking, cost: saved.cost_price }));
  await t.waitFor(`!!document.querySelector('${drawer}')`, 'the drawer back after saving', 15_000);
  await t.evaluate(`document.querySelector('${drawer} button[aria-label="Close"]').click()`);

  // ── a new product ─────────────────────────────────────────────────────
  await press('main', 'New product');
  await t.waitFor(`!!document.querySelector('form[aria-label="New product"]')`, 'the new product form', 20_000);
  if (await t.evaluate(`!!document.querySelector('form[aria-label="New product"] button[aria-label="Company"]')`)) {
    const orgs = (await api('GET', '/api/inventory/companies')).data?.companies ?? [];
    await pickFrom('Company', orgs[0].name, null, 'form[aria-label="New product"]');
  }
  await typeInto('form[aria-label="New product"] input[aria-label="Name"]', `E2E Inv Washer ${tag}`);
  await pickFrom('Category', `E2E Inv Bolts ${tag}`, `E2E Inv Bolts ${tag}`, 'form[aria-label="New product"]');
  await typeInto('form[aria-label="New product"] input[aria-label="Selling price"]', '1,250');
  await typeInto('form[aria-label="New product"] input[aria-label="Reorder point"]', '20');
  await t.shot('i5-new-product');
  await press('[role="dialog"]', 'Save');
  await t.waitFor(textIn(drawer, `E2E Inv Washer ${tag}`), 'the new product opened', 20_000);
  const found = ((await api('GET', `/api/inventory/products?q=${encodeURIComponent(`E2E Inv Washer ${tag}`)}`)).data?.products ?? [])[0];
  if (found) made.products.push(found.id);
  t.check(
    'it is made with its category, price, minimum and a generated code',
    !!found && found.category_id === childId && Number(found.unit_price) === 1250 && Number(found.reorder_point) === 20 && !!found.code,
    js(found && { cat: found.category_id, price: found.unit_price, min: found.reorder_point, code: found.code }),
  );
  await t.evaluate(`document.querySelector('${drawer} button[aria-label="Close"]').click()`);

  // ── categories ────────────────────────────────────────────────────────
  await t.evaluate(`document.querySelector('button[aria-label="Manage categories"]').click()`);
  await t.waitFor(`!!document.querySelector('[role="dialog"][aria-label="Categories"] [data-category="${childId}"]')`, 'the categories dialog', 20_000);
  await typeInto(`[data-category="${childId}"] input`, `E2E Inv Fixings ${tag}`);
  await t.evaluate(`document.querySelector('[data-category="${childId}"] input').blur()`);
  await until(async () => ((await api('GET', '/api/inventory/categories')).data?.categories ?? []).some((c) => c.id === childId && c.name === `E2E Inv Fixings ${tag}`), 'the rename saved');
  t.check('a category renames as the field is left', true);
  await typeInto('input[aria-label="New category name"]', `E2E Inv Spare ${tag}`);
  await press('[role="dialog"][aria-label="Categories"]', 'Add');
  const spare = await until(async () => ((await api('GET', '/api/inventory/categories')).data?.categories ?? []).find((c) => c.name === `E2E Inv Spare ${tag}`), 'the new category');
  made.categories.push(spare.id);
  t.check('a category is added from the dialog, at the top level', spare.parent_id === null, js(spare));
  await t.waitFor(`!!document.querySelector('[data-category="${spare.id}"]')`, 'the new category listed');
  await t.evaluate(`document.querySelector('[data-category="${childId}"] button[aria-label^="Delete"]').click()`);
  await t.waitFor(textIn('[role="dialog"]', 'will have to be refiled first'), 'the warning that it holds products', 10_000);
  t.check('deleting a category with products warns before asking', true);
  await press('[role="dialog"][aria-label^="Delete"]', 'Cancel');
  await t.evaluate(`document.querySelector('[data-category="${spare.id}"] button[aria-label^="Delete"]').click()`);
  await press('[role="dialog"][aria-label^="Delete"]', 'Delete');
  await until(async () => !((await api('GET', '/api/inventory/categories')).data?.categories ?? []).some((c) => c.id === spare.id), 'the empty category deleted');
  made.categories = made.categories.filter((id) => id !== spare.id);
  t.check('an empty category is deleted', true);
  await t.shot('i6-categories');
  await press('[role="dialog"][aria-label="Categories"]', 'Done');

  // ── stock ─────────────────────────────────────────────────────────────
  await rail('Stock');
  await t.waitFor(`!!document.querySelector('input[aria-label="Search stock"]')`, 'the stock overview', 20_000);
  await t.waitFor(`/\\d+ lines?/.test(document.querySelector('[data-stock-summary]')?.textContent || '')`, 'the line count', 20_000);
  await typeInto('input[aria-label="Search stock"]', `EIB${tag}`);
  await t.waitFor(`document.querySelectorAll('[data-stock]').length === 1 && !!document.querySelector('[data-stock="${stockedId}"]')`, 'the stock line found', 15_000);
  const sl = await t.evaluate(`[document.querySelector('[data-stock="${stockedId}"]').textContent, document.querySelector('[data-stock-summary]').textContent]`);
  const stockName = await t.evaluate(`[document.querySelector('[data-stock="${stockedId}"] > span').getBoundingClientRect().width, document.querySelector('[data-stock="${stockedId}"]').textContent.includes(${js(`E2E Inv Bolt ${tag}`)})]`);
  t.check('the stock line keeps the product’s name in view', stockName[0] >= 180 && stockName[1], js(stockName));
  t.check('the stock line has where, what is available and on hand, and its value', sl[0].includes(wh.name) && sl[0].includes('12 on hand') && sl[1].startsWith('1 line'), js(sl));
  await t.shot('i7-stock');

  // ── movements ─────────────────────────────────────────────────────────
  await rail('Movements');
  await t.waitFor(`!!document.querySelector('input[aria-label="Search movements"]')`, 'the movements', 20_000);
  await typeInto('input[aria-label="Search movements"]', `EIB${tag}`);
  await t.waitFor(`document.querySelectorAll('[data-movement]').length === 1`, 'the movement found', 15_000);
  const mv = await t.evaluate(`[document.querySelector('[data-movement]').textContent, document.querySelector('[data-movement-count]').textContent]`);
  t.check('the opening movement shows its reason, quantity and balance', mv[0].includes('Opening') && mv[0].includes('+12') && mv[1].trim() === '1 movement', js(mv));
  t.check('opening stock is dated by its day, not by an hour of UTC midnight', !/\d:\d\d/.test(mv[0].split('E2E Inv Bolt')[0]), mv[0].slice(0, 40));
  await pickFrom('Direction', 'Out only', null, 'main');
  await t.waitFor(`document.querySelectorAll('[data-movement]').length === 0`, 'nothing out', 15_000);
  t.check('narrowed to stock going out, there is none', true);
  await t.shot('i8-movements');
  await t.evaluate(`document.querySelector('[data-movement]')?.click()`);

  // ── scan ──────────────────────────────────────────────────────────────
  await typeInto('input[aria-label="Scan or search"]', `479${tag}01`);
  await t.waitFor(`[...document.querySelectorAll('[role="listbox"][aria-label="Inventory search results"] [role="option"]')].some(o => o.textContent.includes(${js(`E2E Inv Bolt ${tag}`)}))`, 'the barcode found', 15_000);
  await t.evaluate(`document.querySelector('input[aria-label="Scan or search"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`);
  await t.waitFor(textIn(drawer, `E2E Inv Bolt ${tag}`), 'the scanned product opened', 15_000);
  t.check('a barcode scanned into the rail opens its product', true);
} catch (e) {
  t.check(`no unexpected error (${e.message})`, false);
  await t.shot('iz-failure').catch(() => undefined);
} finally {
  // A product with stock cannot be archived; it is filed under nothing so
  // its categories can go. The rest is archived.
  for (const id of made.products.filter(Boolean)) {
    await api('PUT', `/api/inventory/products/${id}`, { category_id: null }).catch(() => undefined);
    await api('DELETE', `/api/inventory/products/${id}`).catch(() => undefined);
  }
  for (const id of made.categories.filter(Boolean)) await api('DELETE', `/api/inventory/categories/${id}`).catch(() => undefined);
  await t.finish();
}

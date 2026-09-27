// End-to-end: Inventory, part 5 — reports, replenishment, brands & units,
// settings and My access, against a real server, through the UI: every
// Inventory screen opening here; reports read, the vendor report counting
// each order once; a product below its minimum raised as a purchase request;
// a brand, a unit and an attribute made, a duplicate refused; a rule changed
// and put back; a warehouse made, given a location and archived; My access
// naming the reader's warehouses and permissions.
//
// Makes its own products, brand, unit, attribute and warehouse ("E2E Inv5 …
// <tag>"), removes the brand, unit and attribute, leaves the warehouse
// archived and the setting as it found it. Needs a user who holds
// inventory.* (locally: the "E2E Orders" role).
//
//   npm run build
//   WS_E2E_SERVER=… WS_E2E_EMAIL=… WS_E2E_PASSWORD=… ELECTRON_RUN_AS_NODE=1 npx electron tests/e2e/inventory-5.mjs
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

const t = await launch({ name: 'inventory-5' });
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
const mainHas = (s) => `document.querySelector('main')?.textContent.includes(${js(s)})`;
const made = { brand: null, base: null, unit: null, attribute: null, selfApproval: null };

try {
  bearer = (await api('POST', '/api/auth/login', { email, password })).data?.tokens?.access_token ?? '';

  // ── fixtures ──────────────────────────────────────────────────────────
  const wh = ((await api('GET', '/api/inventory/warehouses')).data?.warehouses ?? []).find((w) => w.can_act !== false);
  const low = (await api('POST', '/api/inventory/products', { name: `E2E Inv5 Filter ${tag}`, code: `E5F${tag}`, cost_price: 40, reorder_point: 10, reorder_qty: 20, is_stocked: 1 })).data?.product?.id;
  const opening = await api('POST', '/api/inventory/stock/opening', { warehouse_id: wh?.id, lines: [{ product_id: low, quantity: 2, unit_cost: 40 }] });
  t.check('fixtures: a product two short of ten', !!(wh && low && opening.status < 300), js({ wh: wh?.name, low, opening: [opening.status, opening.message] }));

  await t.signIn(server, email, password);
  await sleep(1500);
  await t.evaluate(`(() => { const b = [...document.querySelectorAll('nav button')].find(b => b.textContent.trim() === 'Inventory'); if (b) b.click(); return !!b; })()`);
  await t.waitFor(`!!document.querySelector('nav[aria-label="Inventory"]')`, 'the Inventory rail', 30_000);
  const browserItems = await t.evaluate(`[...document.querySelectorAll('nav[aria-label="Inventory"] button')].filter(b => (b.title || '').includes('browser')).map(b => b.textContent.trim())`);
  t.check('every Inventory screen opens here', browserItems.length === 0, js(browserItems));

  // ── reports ───────────────────────────────────────────────────────────
  await rail('Reports');
  await t.waitFor(`!!document.querySelector('[data-report-body]')`, 'a report', 20_000);
  await t.evaluate(`document.querySelector('[data-report="valuation"]').click()`);
  await t.waitFor(`document.querySelector('[data-report-headline]')?.textContent.includes('on the shelf')`, 'the valuation', 20_000);
  t.check('the valuation says what is on the shelf, row by row', (await t.evaluate(`document.querySelectorAll('[data-report-row]').length`)) > 0, await textOf('[data-report-headline]'));
  await t.shot('r1-valuation');
  await t.evaluate(`document.querySelector('[data-report="movement"]').click()`);
  await t.waitFor(`${mainHas('By reason')}`, 'the movement report', 20_000);
  t.check('the movement report has its days and its reasons', await t.evaluate(`${mainHas('By day')} && ${mainHas('By reason')}`), '');
  await t.evaluate(`document.querySelector('[data-report="vendor"]').click()`);
  await t.waitFor(`${mainHas('By vendor')} && !!document.querySelector('[data-report-body]')`, 'the vendor report', 20_000);
  const vendorRows = (await api('GET', '/api/inventory/reports/vendor')).data?.rows ?? [];
  const busy = vendorRows.find((r) => r.orders > 1 && r.receipts > 1);
  if (busy) {
    const orders = [];
    for (let page = 1; page < 20; page++) {
      const d = (await api('GET', `/api/inventory/purchase-orders?vendor_id=${busy.vendor_id}&page=${page}&per_page=100`)).data;
      orders.push(...(d?.orders ?? []));
      if ((d?.orders ?? []).length < 100) break;
    }
    const from = (await api('GET', '/api/inventory/reports/vendor')).data?.from;
    const live = orders.filter((o) => !['draft', 'cancelled'].includes(o.status) && o.order_date >= from);
    const sum = Math.round(live.reduce((s, o) => s + Number(o.total), 0) * 100) / 100;
    t.check('the vendor report counts each order once, however many receipts', live.length === busy.orders && Math.abs(sum - busy.ordered_value) < 0.01, js({ vendor: busy.name, orders: [busy.orders, live.length], value: [busy.ordered_value, sum], receipts: busy.receipts }));
  } else t.skip('no vendor here has several orders and receipts', 'nothing to multiply');
  await t.evaluate(`document.querySelector('[data-report="serials"]').click()`);
  await t.waitFor(`document.querySelector('[data-report-headline]')?.textContent.match(/unit/)`, 'the serial register', 20_000);
  t.check('the serial register counts its units', true, await textOf('[data-report-headline]'));

  // ── replenishment ─────────────────────────────────────────────────────
  await rail('Replenishment');
  await t.waitFor(`!!document.querySelector('[data-reorder="${low}"]')`, 'the product below its minimum', 20_000);
  const line = await textOf(`[data-reorder="${low}"]`);
  const item = ((await api('GET', `/api/inventory/stock/replenishment?warehouse_id=${wh.id}`)).data?.items ?? []).find((i) => i.product_id === low);
  t.check('the product two short of ten is below its minimum, with what to order', line.includes(`E2E Inv5 Filter ${tag}`) && Number(item?.available) === 2 && Number(item?.minimum) === 10 && Number(item?.suggested) > 0, js(item && { available: item.available, minimum: item.minimum, suggested: item.suggested }));
  await t.evaluate(`document.querySelector('[data-reorder="${low}"] input[type="checkbox"]').click()`);
  await press('main', 'Raise requests for 1');
  const req = await until(async () => ((await api('GET', '/api/inventory/requests')).data?.requests ?? []).find((r) => (r.lines ?? []).some((l) => Number(l.product_id) === low)), 'the request');
  t.check('raising it makes a purchase request for that product only', req.lines.length === 1, js(req.lines.map((l) => [l.product_id, l.quantity])));
  await t.waitFor(`!!document.querySelector('[data-request="${req.id}"]')`, 'Purchasing › Requests with it', 20_000);
  t.check('and opens Purchasing’s requests with it there', true);

  // ── brands, units and attributes ──────────────────────────────────────
  await rail('Brands & units');
  await press('section[aria-label="Brands"]', 'New brand');
  await typeInto('[role="dialog"] input[aria-label="Name"]', `E2E Inv5 Brand ${tag}`);
  await typeInto('[role="dialog"] input[aria-label="Country"]', 'Sri Lanka');
  await press('[role="dialog"]', 'Add');
  const brand = await until(async () => ((await api('GET', '/api/inventory/brands')).data?.brands ?? []).find((b) => b.name === `E2E Inv5 Brand ${tag}`), 'the brand');
  made.brand = brand.id;
  await t.waitFor(`!!document.querySelector('[data-brand="${brand.id}"]')`, 'the brand listed', 15_000);
  await press('section[aria-label="Brands"]', 'New brand');
  await typeInto('[role="dialog"] input[aria-label="Name"]', `e2e inv5 brand ${tag}`);
  await press('[role="dialog"]', 'Add');
  await t.waitFor(`document.querySelector('[role="dialog"] [role="alert"]')?.textContent.includes('already a brand')`, 'the duplicate refused', 15_000);
  t.check('a brand is added, and the same name again is refused', true);
  await press('[role="dialog"]', 'Cancel');

  // A base unit of its own, then one made of it.
  await press('section[aria-label="Units"]', 'New unit');
  await typeInto('[role="dialog"] input[aria-label="Unit name"]', `E2E Inv5 Piece ${tag}`);
  await typeInto('[role="dialog"] input[aria-label="Unit code"]', `p${tag}`);
  await press('[role="dialog"]', 'Add');
  const base = await until(async () => ((await api('GET', '/api/inventory/units')).data?.units ?? []).find((u) => u.code === `p${tag}`), 'the base unit');
  made.base = base.id;
  await t.waitFor(`!document.querySelector('[role="dialog"]')`, 'the sheet closed', 15_000);
  await press('section[aria-label="Units"]', 'New unit');
  await typeInto('[role="dialog"] input[aria-label="Unit name"]', `E2E Inv5 Box ${tag}`);
  await typeInto('[role="dialog"] input[aria-label="Unit code"]', `b${tag}`);
  await pickFrom('Made of', `(${base.code})`, null, '[role="dialog"]');
  await typeInto('[role="dialog"] input[aria-label="Factor"]', '6');
  await press('[role="dialog"]', 'Add');
  const unit = await until(async () => ((await api('GET', '/api/inventory/units')).data?.units ?? []).find((u) => u.code === `b${tag}`), 'the unit');
  made.unit = unit.id;
  await t.waitFor(`document.querySelector('[data-unit="b${tag}"]')?.textContent.includes(${js(`= 6 ${base.code}`)})`, 'the unit listed with its factor', 15_000);
  const again = await api('POST', '/api/inventory/units', { name: 'Dup', code: `b${tag}` });
  t.check('a unit is added against its base, and its code again is refused', again.status === 409, js([again.status, again.message]));

  await press('section[aria-label="Attributes"]', 'New attribute');
  await typeInto('[role="dialog"] input[aria-label="Attribute name"]', `E2E Inv5 Size ${tag}`);
  await typeInto('[role="dialog"] textarea[aria-label="Values"]', 'S, M');
  await press('[role="dialog"]', 'Add');
  await t.waitFor(`!!document.querySelector('[data-attribute="E2E Inv5 Size ${tag}"]')`, 'the attribute listed', 15_000);
  await press(`[data-attribute="E2E Inv5 Size ${tag}"]`, '+ value');
  await typeInto(`input[aria-label="New value for E2E Inv5 Size ${tag}"]`, 'L');
  await t.evaluate(`document.querySelector('input[aria-label="New value for E2E Inv5 Size ${tag}"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`);
  const attr = await until(async () => {
    const a = ((await api('GET', '/api/inventory/attributes')).data?.attributes ?? []).find((x) => x.name === `E2E Inv5 Size ${tag}`);
    return a?.values?.length === 3 ? a : null;
  }, 'the third value');
  made.attribute = attr.id;
  t.check('an attribute is made with its values, and another added in place', attr.values.map((v) => v.value).join(',') === 'S,M,L' && attr.is_variantal, js(attr.values.map((v) => v.value)));
  await t.shot('r2-lookups');

  // ── settings ──────────────────────────────────────────────────────────
  made.selfApproval = ((await api('GET', '/api/inventory/settings')).data?.settings ?? []).find((s) => s.key === 'allow_self_approval')?.value ?? null;
  await rail('Settings');
  await t.waitFor(`!!document.querySelector('[data-setting="allow_self_approval"] input')`, 'the rules', 20_000);
  await t.evaluate(`document.querySelector('[data-setting="allow_self_approval"] input').click()`);
  await press('main', 'Save changes');
  await until(async () => ((await api('GET', '/api/inventory/settings')).data?.settings ?? []).find((s) => s.key === 'allow_self_approval')?.value === !made.selfApproval, 'the rule saved');
  await t.evaluate(`document.querySelector('[data-setting="allow_self_approval"] input').click()`);
  await press('main', 'Save changes');
  await until(async () => ((await api('GET', '/api/inventory/settings')).data?.settings ?? []).find((s) => s.key === 'allow_self_approval')?.value === made.selfApproval, 'the rule put back');
  t.check('a rule is changed, saved, and put back', true);

  await t.evaluate(`[...document.querySelectorAll('nav[aria-label="Settings sections"] button')].find(b => b.textContent.trim() === 'Warehouses').click()`);
  await press('main', 'New warehouse');
  await typeInto('[role="dialog"] input[aria-label="Code"]', `e5${tag}`);
  await typeInto('[role="dialog"] input[aria-label="Name"]', `E2E Inv5 Shed ${tag}`);
  await typeInto('[role="dialog"] input[aria-label="City"]', 'Kandy');
  await press('[role="dialog"]', 'Add');
  await t.waitFor(`!!document.querySelector('aside[aria-label="Warehouse E2E Inv5 Shed ${tag}"]')`, 'the warehouse opened', 20_000);
  const shed = ((await api('GET', '/api/inventory/warehouses?include_archived=1')).data?.warehouses ?? []).find((w) => w.code === `E5${tag}`);
  t.check('a warehouse is made, its code in capitals', !!shed && shed.city === 'Kandy', js(shed && { code: shed.code, city: shed.city }));
  // The detail sends its switches as "0"/"1"; "0" must not read as the default.
  const head = await t.evaluate(`[...document.querySelectorAll('aside[aria-label="Warehouse E2E Inv5 Shed ${tag}"] span')].map(s => s.textContent.trim()).filter(Boolean).slice(0, 6)`);
  t.check('and it is not called the default, which it is not', !head.includes('default') && !shed.is_default, js(head));
  await press(`aside[aria-label="Warehouse E2E Inv5 Shed ${tag}"]`, 'Add a location');
  await typeInto('[role="dialog"] input[aria-label="Location code"]', 'a-01');
  await press('[role="dialog"]', 'Add');
  await t.waitFor(`!!document.querySelector('aside [data-bin="A-01"]')`, 'the location listed', 15_000);
  t.check('it is given a location', true);
  await press(`aside[aria-label="Warehouse E2E Inv5 Shed ${tag}"]`, 'Archive');
  await press('[role="dialog"]', 'Archive', 'the sheet’s Archive');
  await until(async () => ((await api('GET', '/api/inventory/warehouses?include_archived=1')).data?.warehouses ?? []).find((w) => w.id === shed.id)?.status === 'archived', 'archived');
  t.check('and archived, holding no stock', true);
  await t.shot('r3-warehouse');

  // ── my access ─────────────────────────────────────────────────────────
  await rail('My access');
  await t.waitFor(`!!document.querySelector('[data-reach]')`, 'my access', 20_000);
  const explain = (await api('GET', '/api/inventory/access')).data;
  t.check('My access names the warehouses I can act in', (await textOf('[data-reach]')).includes(String(explain.warehouses.total)) && (await textOf('main')).includes(wh.name), await textOf('[data-reach]'));
  await t.evaluate(`[...document.querySelectorAll('main [role="tab"]')].find(b => b.textContent.startsWith('My access')).click()`);
  await t.waitFor(`!!document.querySelector('[data-permission="inventory.view"]')`, 'my permissions', 15_000);
  t.check('and the Inventory permissions I hold', (await t.evaluate(`document.querySelectorAll('[data-permission]').length`)) >= 10, '');
  await t.shot('r4-access');
} catch (e) {
  t.check(`no unexpected error (${e.message})`, false);
  await t.shot('rz-failure').catch(() => undefined);
} finally {
  if (made.brand) await api('DELETE', `/api/inventory/brands/${made.brand}`).catch(() => undefined);
  if (made.unit) await api('DELETE', `/api/inventory/units/${made.unit}`).catch(() => undefined);
  if (made.base) await api('DELETE', `/api/inventory/units/${made.base}`).catch(() => undefined);
  if (made.attribute) await api('DELETE', `/api/inventory/attributes/${made.attribute}`).catch(() => undefined);
  if (made.selfApproval !== null) await api('PUT', '/api/inventory/settings', { allow_self_approval: made.selfApproval }).catch(() => undefined);
  await t.finish();
}

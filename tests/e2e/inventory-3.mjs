// End-to-end: Inventory, part 3 — purchasing and vendors, against a real
// server, through the UI: a vendor made (with its bank details) and edited
// without losing them; a purchase order raised with freight, edited, approved,
// received and posted, the freight landing in the stock's cost; the order and
// receipt reached from the vendor's history; a request approved and turned
// into a draft order. Whoever raised an order or request may not approve it
// (decided 2026-09-27): with purchasing's self-approval setting off the raiser
// is told so and refused; the run then turns it on to approve its own, and
// puts the setting back as it found it.
//
// Makes its own vendor and products ("E2E Inv3 … <tag>"). Stock stays; the
// draft order from the request is deleted. Needs a user who holds
// inventory.* (locally: the "E2E Orders" role).
//
//   npm run build
//   WS_E2E_SERVER=… WS_E2E_EMAIL=… WS_E2E_PASSWORD=… ELECTRON_RUN_AS_NODE=1 npx electron tests/e2e/inventory-3.mjs
import { launch, sleep } from './harness.mjs';

const server = process.env.WS_E2E_SERVER;
const email = process.env.WS_E2E_EMAIL;
const password = process.env.WS_E2E_PASSWORD;
if (!server || !email || !password) {
  console.error('Set WS_E2E_SERVER, WS_E2E_EMAIL and WS_E2E_PASSWORD.');
  process.exit(2);
}

let bearer = '';
let selfApproval = null;
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

const t = await launch({ name: 'inventory-3' });
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
let requestOrderIds = [];

try {
  bearer = (await api('POST', '/api/auth/login', { email, password })).data?.tokens?.access_token ?? '';

  // ── fixtures ──────────────────────────────────────────────────────────
  const wh = ((await api('GET', '/api/inventory/warehouses')).data?.warehouses ?? []).find((w) => w.can_act !== false);
  const nutId = (await api('POST', '/api/inventory/products', { name: `E2E Inv3 Nut ${tag}`, code: `E3N${tag}`, cost_price: 90, unit_price: 150 })).data?.product?.id;
  const washerId = (await api('POST', '/api/inventory/products', { name: `E2E Inv3 Washer ${tag}`, code: `E3W${tag}`, cost_price: 20 })).data?.product?.id;
  t.check('fixtures: a warehouse and two products', !!(wh && nutId && washerId), js({ wh: wh?.name, nutId, washerId }));

  await t.signIn(server, email, password);
  await sleep(1500);
  await t.evaluate(`(() => { const b = [...document.querySelectorAll('nav button')].find(b => b.textContent.trim() === 'Inventory'); if (b) b.click(); return !!b; })()`);
  await t.waitFor(`!!document.querySelector('nav[aria-label="Inventory"]')`, 'the Inventory rail', 30_000);
  const native = await t.evaluate(`['Purchasing', 'Vendors'].every(l => [...document.querySelectorAll('nav[aria-label="Inventory"] button')].some(b => b.textContent.trim().startsWith(l) && !(b.title || '').includes('browser')))`);
  t.check('Purchasing and Vendors open here, not in the browser', native);

  // ── a vendor ──────────────────────────────────────────────────────────
  await rail('Vendors');
  await press('main', 'New vendor');
  await t.waitFor(`!!document.querySelector('[role="form"][aria-label="New vendor"]')`, 'the new vendor form', 20_000);
  await typeInto('[role="dialog"] input[aria-label="Name"]', `E2E Inv3 Supplies ${tag}`);
  await typeInto('[role="dialog"] input[aria-label="Tax number"]', `TX${tag}`);
  await typeInto('[role="dialog"] input[aria-label="Payment terms (days)"]', '30');
  await typeInto('[role="dialog"] input[aria-label="Bank"]', 'HNB');
  await typeInto('[role="dialog"] input[aria-label="Account number"]', `00${tag}`);
  await t.shot('k1-new-vendor');
  await press('[role="dialog"]', 'Create vendor');
  await t.waitFor(`!!document.querySelector('${panel('Vendor ')}') && document.querySelector('${panel('Vendor ')}').textContent.includes(${js(`E2E Inv3 Supplies ${tag}`)})`, 'the vendor opened', 20_000);
  const vendor = ((await api('GET', `/api/inventory/vendors?q=${encodeURIComponent(`E2E Inv3 Supplies ${tag}`)}`)).data?.vendors ?? [])[0];
  const vd = (await api('GET', `/api/inventory/vendors/${vendor?.id}`)).data?.vendor;
  t.check('the vendor is made with its tax number, terms and bank', vd?.tax_number === `TX${tag}` && vd.payment_terms_days === 30 && vd.bank_name === 'HNB' && vd.account_no === `00${tag}`, js(vd && { tax: vd.tax_number, terms: vd.payment_terms_days, bank: vd.bank_name, acct: vd.account_no }));
  await press(panel('Vendor '), 'Edit');
  await t.waitFor(`!!document.querySelector('[role="form"][aria-label="Edit vendor"]')`, 'the edit form', 20_000);
  await typeInto('[role="dialog"] input[aria-label="Primary phone"]', '011 400 2020');
  await press('[role="dialog"]', 'Save');
  const saved = await until(async () => {
    const x = (await api('GET', `/api/inventory/vendors/${vendor.id}`)).data?.vendor;
    return x?.phone === '011 400 2020' ? x : null;
  }, 'the phone saved');
  t.check('editing one field keeps the bank details it did not touch', saved.bank_name === 'HNB' && saved.account_no === `00${tag}`, js({ bank: saved.bank_name, acct: saved.account_no }));
  await t.evaluate(`document.querySelector('${panel('Vendor ')} button[aria-label="Close"]')?.click()`);

  // ── an order, raised, edited, approved ────────────────────────────────
  const settings = (await api('GET', '/api/inventory/settings')).data?.settings ?? [];
  selfApproval = settings.find((x) => x.key === 'allow_self_approval')?.value ?? null;
  t.check('purchasing offers the self-approval switch', selfApproval !== null, js(settings.map((x) => x.key)));
  await api('PUT', '/api/inventory/settings', { allow_self_approval: false });
  await rail('Purchasing');
  await press('main', 'New order');
  await t.waitFor(`!!document.querySelector('[role="form"][aria-label="New purchase order"]')`, 'the new order form', 20_000);
  await pickFrom('Vendor', `E2E Inv3 Supplies ${tag}`, `E2E Inv3 Supplies ${tag}`, '[role="dialog"]');
  await pickFrom('Deliver to', wh.name, null, '[role="dialog"]');
  await typeInto('[role="dialog"] input[aria-label="Freight"]', '200');
  await pickFrom('Line 1 product', `E2E Inv3 Nut ${tag}`, `E3N${tag}`, '[role="dialog"]');
  await typeInto('[role="dialog"] input[aria-label="Line 1 quantity"]', '10');
  await typeInto('[role="dialog"] input[aria-label="Line 1 unit cost"]', '100');
  await t.shot('k2-new-order');
  await press('[role="dialog"]', 'Create');
  await t.waitFor(`!!document.querySelector('${panel('Order ')}') && document.querySelector('${panel('Order ')}').textContent.includes(${js(`E2E Inv3 Supplies ${tag}`)})`, 'the order opened', 20_000);
  const poNumber = (await textOf(`${panel('Order ')} b`)).trim();
  const po = ((await api('GET', `/api/inventory/purchase-orders?q=${encodeURIComponent(poNumber)}`)).data?.orders ?? [])[0];
  t.check('the order is a draft with its freight and line', po?.status === 'draft' && Number(po.freight_cost) === 200 && Number(po.line_count) === 1, js(po && { status: po.status, freight: po.freight_cost, lines: po.line_count }));
  await t.waitFor(`document.querySelector('${panel('Order ')}')?.textContent.includes('You raised this order, so someone else approves it.')`, 'told someone else approves it', 15_000);
  t.check('its raiser is not offered Approve, and is told why', !(await t.evaluate(`[...document.querySelectorAll('${panel('Order ')} button')].some(b => b.textContent.trim() === 'Approve')`)), '');
  const refused = await api('POST', `/api/inventory/purchase-orders/${po.id}/approve`, {});
  // The request turned into an order at the end, raised now so its raiser is refused too.
  const req = await api('POST', '/api/inventory/requests', { warehouse_id: wh.id, reason: `E2E Inv3 ${tag}`, lines: [{ product_id: washerId, quantity: 40, preferred_vendor_id: vendor.id }] });
  const reqId = req.data?.id;
  const reqRow = ((await api('GET', '/api/inventory/requests')).data?.requests ?? []).find((r) => Number(r.id) === Number(reqId));
  const refusedReq = await api('POST', `/api/inventory/requests/${reqId}/approve`, {});
  t.check('the server refuses the raiser too, for an order and a request', refused.status === 403 && /someone else/.test(refused.message ?? '') && reqRow?.may_approve === false && refusedReq.status === 403, js({ order: refused.status, request: refusedReq.status, may: reqRow?.may_approve }));
  await api('PUT', '/api/inventory/settings', { allow_self_approval: true });
  await t.shot('k2b-raiser-waits');
  await press(panel('Order '), 'Edit');
  await t.waitFor(`!!document.querySelector('[role="form"][aria-label="Edit order"]')`, 'the order editor', 20_000);
  await typeInto('[role="dialog"] input[aria-label="Duty"]', '50');
  await typeInto('[role="dialog"] input[aria-label="Our reference"]', `REF${tag}`);
  await press('[role="dialog"]', 'Save');
  const edited = await until(async () => {
    const o = (await api('GET', `/api/inventory/purchase-orders/${po.id}`)).data?.order;
    return Number(o?.duty_cost) === 50 ? o : null;
  }, 'the edit saved');
  t.check('saving keeps the freight and adds the duty and reference', Number(edited.freight_cost) === 200 && edited.reference_no === `REF${tag}`, js({ freight: edited.freight_cost, ref: edited.reference_no }));
  await t.waitFor(`!!document.querySelector('${panel('Order ')}')`, 'the order back', 15_000);
  // Saving refetched it, now with self-approval allowed.
  await t.waitFor(`[...document.querySelectorAll('${panel('Order ')} button')].some(b => b.textContent.trim() === 'Approve')`, 'Approve offered once self-approval is allowed', 15_000);
  await press(panel('Order '), 'Approve');
  await until(async () => (await api('GET', `/api/inventory/purchase-orders/${po.id}`)).data?.order?.status === 'approved', 'approved');
  t.check('approved', true);

  // ── receive and post ──────────────────────────────────────────────────
  const before = await onHand(nutId, wh.id);
  await press(panel('Order '), 'Receive goods');
  await t.waitFor(`!!document.querySelector('${panel('Receipt ')}') && !!document.querySelector('${panel('Receipt ')} input[aria-label="Accepted E3N${tag}"]')`, 'the draft receipt opened', 20_000);
  const charges = await t.evaluate(`document.querySelector('${panel('Receipt ')} input[aria-label="Freight and duty"]').value`);
  t.check('the receipt brings the order’s freight and duty (250)', Number(charges) === 250, charges);
  await typeInto(`${panel('Receipt ')} input[aria-label="Accepted E3N${tag}"]`, '9');
  await typeInto(`${panel('Receipt ')} input[aria-label="Rejected E3N${tag}"]`, '1');
  await pickFrom(`Why E3N${tag} was rejected`, 'Damaged in transit', null, panel('Receipt '));
  await t.shot('k3-receipt');
  await press(panel('Receipt '), 'Post — put this stock on the shelf');
  await confirmDialog('Post');
  await until(async () => (await onHand(nutId, wh.id)) === before + 9, 'nine on the shelf');
  const grn = ((await api('GET', `/api/inventory/purchase-orders/${po.id}`)).data?.receipts ?? [])[0];
  const lines = (await api('GET', `/api/inventory/receipts/${grn.id}`)).data?.lines ?? [];
  // 250 of charges over one line of nine accepted: 100 + 250/9.
  t.check('posting puts nine on the shelf at the price plus the charges', Math.abs(Number(lines[0]?.landed_cost) - (100 + 250 / 9)) < 0.01 && Number(lines[0]?.rejected_qty) === 1 && lines[0]?.reject_reason === 'damaged', js(lines[0] && { landed: lines[0].landed_cost, rejected: lines[0].rejected_qty, why: lines[0].reject_reason }));
  const after = (await api('GET', `/api/inventory/purchase-orders/${po.id}`)).data?.order;
  t.check('the order is part received, one still to come', after?.status === 'partial', after?.status);
  await t.waitFor(`document.querySelector('${panel('Receipt ')}')?.textContent.includes('posted')`, 'the receipt shows posted');
  t.check('the receipt names its vendor and order', (await textOf(panel('Receipt '))).includes(poNumber), '');
  await t.evaluate(`document.querySelector('${panel('Receipt ')} button[aria-label="Close"]').click()`);

  // ── the vendor's history leads back ───────────────────────────────────
  await rail('Vendors');
  await typeInto('input[aria-label="Search vendors"]', `E2E Inv3 Supplies ${tag}`);
  await t.waitFor(`!!document.querySelector('[data-vendor="${vendor.id}"]')`, 'the vendor in the list', 15_000);
  await t.evaluate(`document.querySelector('[data-vendor="${vendor.id}"]').click()`);
  await press(panel('Vendor '), 'Orders & history');
  await t.waitFor(`[...document.querySelectorAll('${panel('Vendor ')} button')].some(b => b.textContent.includes(${js(poNumber)}))`, 'the order in its history', 15_000);
  await t.evaluate(`[...document.querySelectorAll('${panel('Vendor ')} button')].find(b => b.textContent.includes(${js(poNumber)})).click()`);
  await t.waitFor(`!!document.querySelector('${panel('Order ' + poNumber)}')`, 'the order opened from the vendor', 15_000);
  t.check('a vendor’s history opens its orders here', true);
  await t.shot('k4-order-from-vendor');
  await t.evaluate(`document.querySelector('${panel('Order ')} button[aria-label="Close"]').click()`);

  // ── a request becomes an order ────────────────────────────────────────
  await rail('Purchasing');
  await press('main', 'Requests');
  await t.waitFor(`!!document.querySelector('[data-request="${reqId}"]')`, 'the request listed', 20_000);
  await t.evaluate(`[...document.querySelectorAll('[data-request="${reqId}"] button')].find(b => b.textContent.trim() === 'Approve').click()`);
  await t.waitFor(`[...document.querySelectorAll('[data-request="${reqId}"] button')].some(b => b.textContent.trim() === 'Turn into draft orders')`, 'approved, ready to order', 15_000);
  await t.evaluate(`[...document.querySelectorAll('[data-request="${reqId}"] button')].find(b => b.textContent.trim() === 'Turn into draft orders').click()`);
  const drafts = await until(async () => {
    const os = (await api('GET', `/api/inventory/purchase-orders?vendor_id=${vendor.id}&status=draft`)).data?.orders ?? [];
    return os.length ? os : null;
  }, 'the draft order from the request');
  requestOrderIds = drafts.map((o) => o.id);
  const dl = (await api('GET', `/api/inventory/purchase-orders/${drafts[0].id}`)).data?.lines ?? [];
  t.check('an approved request becomes a draft order with the vendor and quantity', Number(dl[0]?.product_id) === washerId && Number(dl[0]?.quantity) === 40, js(dl[0] && { product: dl[0].product_id, qty: dl[0].quantity }));
  t.check('and the list is back on the orders', await t.evaluate(`!!document.querySelector('input[aria-label="Search orders"]')`), '');
} catch (e) {
  t.check(`no unexpected error (${e.message})`, false);
  await t.shot('kz-failure').catch(() => undefined);
} finally {
  for (const id of requestOrderIds) await api('DELETE', `/api/inventory/purchase-orders/${id}`).catch(() => undefined);
  // The setting as the run found it.
  if (selfApproval !== null) await api('PUT', '/api/inventory/settings', { allow_self_approval: selfApproval }).catch(() => undefined);
  await t.finish();
}

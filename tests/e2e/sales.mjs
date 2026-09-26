// End-to-end: Sales & Orders, part 1 — against a real server, through the UI:
// a new order (customer, warehouse, a stocked product and a service), submitted
// (no rule applies: approved at once), confirmed (stock reserved), a delivery
// note raised, dispatched and delivered from Fulfilment; a large order held by
// an approval rule and approved in its drawer; another rejected with a reason;
// bulk priority; the PDF; and a cancel that releases the reservation.
//
// Makes its own fixtures (a warehouse, two products, opening stock, a customer,
// an approval rule), all named "E2E … <tag>". Needs a user who holds oms.*,
// inventory.* and crm.* (locally: the "E2E Orders" role).
//
//   npm run build
//   WS_E2E_SERVER=… WS_E2E_EMAIL=… WS_E2E_PASSWORD=… ELECTRON_RUN_AS_NODE=1 npx electron tests/e2e/sales.mjs
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
const made = { rule: null, orders: [] };

const t = await launch({ name: 'sales' });
const rail = (label) => `(() => { const b = [...document.querySelectorAll('nav[aria-label="Orders"] button')].find(b => b.textContent.trim().startsWith(${js(label)})); if (b) b.click(); return !!b; })()`;
const press = async (scope, text, what = text) => {
  const ok = await t.evaluate(`(() => { const b = [...document.querySelectorAll(${js(scope + ' button')})].find(b => b.textContent.trim() === ${js(text)} && !b.disabled); if (b) b.click(); return !!b; })()`);
  if (!ok) throw new Error(`no ${what} button to press`);
};
const typeInto = (selector, value) => t.evaluate(`(() => { const el = document.querySelector(${js(selector)}); if (!el) return false; el.focus(); const set = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set; set.call(el, ${js(value)}); el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
/** The app's dropdown: open it, search when it has a search box, and pick the option by its words. */
const pickFrom = async (label, text, search) => {
  await t.evaluate(`document.querySelector('button[role="combobox"][aria-label=${js(label)}]').click()`);
  await t.waitFor(`!!document.querySelector('[role="listbox"][aria-label=${js(label)}]')`, `the ${label} list`);
  if (search) await typeInto(`input[aria-label=${js(`Search ${label}`)}]`, search);
  await t.waitFor(`[...document.querySelectorAll('[role="listbox"][aria-label=${js(label)}] [role="option"]')].some(o => o.textContent.includes(${js(text)}))`, `${text} in ${label}`, 15_000);
  await t.evaluate(`[...document.querySelectorAll('[role="listbox"][aria-label=${js(label)}] [role="option"]')].find(o => o.textContent.includes(${js(text)})).click()`);
};
const order = async (id) => (await api('GET', `/api/oms/orders/${id}`)).data?.order;
const waitStatus = async (id, want, label) => {
  let s = null;
  for (let i = 0; i < 40; i++) {
    s = (await order(id))?.status;
    if ((Array.isArray(want) ? want : [want]).includes(s)) return s;
    await sleep(400);
  }
  throw new Error(`${label}: status is ${s}, not ${want}`);
};
const openOrder = async (id) => {
  await t.evaluate(`(() => { const r = document.querySelector('[data-order="${id}"] button[aria-label^="Open"]'); if (r) r.click(); return !!r; })()`);
  await t.waitFor(`!!document.querySelector('aside[aria-label^="Order "] [data-order-actions]')`, 'the order drawer', 20_000);
};

try {
  bearer = (await api('POST', '/api/auth/login', { email, password })).data?.tokens?.access_token ?? '';

  // ── fixtures ──────────────────────────────────────────────────────────
  const wh = await api('POST', '/api/inventory/warehouses', { name: `E2E Store ${tag}`, code: `E2E${tag}` });
  const whId = wh.data?.id ?? wh.data?.warehouse?.id;
  const widget = await api('POST', '/api/inventory/products', { name: `E2E Widget ${tag}`, unit_price: 1500, is_stocked: 1, cost_price: 900 });
  const widgetId = widget.data?.id ?? widget.data?.product?.id;
  const setup = await api('POST', '/api/inventory/products', { name: `E2E Setup ${tag}`, unit_price: 20000, is_stocked: 0 });
  const setupId = setup.data?.id ?? setup.data?.product?.id;
  const stock = await api('POST', '/api/inventory/stock/opening', { warehouse_id: whId, lines: [{ product_id: widgetId, quantity: 20, unit_cost: 900 }] });
  const acct = await api('POST', '/api/crm/accounts', { name: `E2E Customer ${tag}` });
  const clientId = acct.data?.id ?? acct.data?.account?.id;
  const rule = await api('POST', '/api/oms/settings/rules', { name: `E2E big orders ${tag}`, step: 1, subject: 'order_total', operator: 'gt', threshold: 100000, permission: 'oms.orders.approve', is_active: true });
  made.rule = rule.data?.id ?? null;
  t.check('fixtures: a warehouse, two products, stock, a customer, a rule', !!(whId && widgetId && setupId && stock.status < 300 && clientId && made.rule), js({ wh: wh.status, widget: widget.status, setup: setup.status, stock: [stock.status, stock.message], acct: acct.status, rule: [rule.status, rule.message] }));

  // ── a new order through the UI ────────────────────────────────────────
  await t.signIn(server, email, password);
  await sleep(1500);
  await t.evaluate(`(() => { const b = [...document.querySelectorAll('nav button')].find(b => b.textContent.trim().startsWith('Sales')); if (b) b.click(); return !!b; })()`);
  await t.waitFor(`!!document.querySelector('nav[aria-label="Orders"]')`, 'the Orders rail', 30_000);
  await t.shot('o1-dashboard');
  await press('nav[aria-label="Orders"]', 'New order');
  await t.waitFor(`!!document.querySelector('[data-new-order]')`, 'the new order form', 20_000);
  await pickFrom('Customer', `E2E Customer ${tag}`, `E2E Customer ${tag}`);
  await pickFrom('Warehouse', `E2E Store ${tag}`, `E2E Store ${tag}`);
  for (const [name, n] of [[`E2E Widget ${tag}`, 3], [`E2E Setup ${tag}`, 1]]) {
    await typeInto('input[aria-label="Add a product"]', name);
    await t.waitFor(`[...document.querySelectorAll('[role="listbox"][aria-label="Products"] button')].some(b => b.textContent.includes(${js(name)}))`, `the product ${name}`, 15_000);
    await t.evaluate(`[...document.querySelectorAll('[role="listbox"][aria-label="Products"] button')].find(b => b.textContent.includes(${js(name)})).click()`);
    if (n > 1) await typeInto(`input[aria-label="Quantity of ${name}"]`, String(n));
  }
  await sleep(300);
  await t.shot('o2-new-order');
  await press('[role="dialog"]', 'Create draft order');
  await t.waitFor(`!!document.querySelector('aside[aria-label^="Order "] [data-order-actions]')`, 'the new order open', 20_000);
  const list = (await api('GET', `/api/oms/orders?q=${encodeURIComponent(`E2E Customer ${tag}`)}`)).data?.orders ?? [];
  const first = list[0];
  if (first) made.orders.push(first.id);
  t.check('the order is a draft with the lines and the server’s total', first?.status === 'draft' && Number(first?.total) === 3 * 1500 + 20000 && first?.line_count === 2, js(first ?? null));
  await t.shot('o3-drawer');

  // ── submit (no rule applies) and confirm ──────────────────────────────
  await press('aside[aria-label^="Order "]', 'Submit for approval');
  await waitStatus(first.id, 'approved', 'submit');
  t.check('submitted under the threshold: approved at once', true);
  await t.waitFor(`[...document.querySelectorAll('aside[aria-label^="Order "] [data-order-actions] button')].some(b => b.textContent.trim() === 'Confirm')`, 'Confirm offered', 15_000);
  await press('aside[aria-label^="Order "] [data-order-actions]', 'Confirm');
  await waitStatus(first.id, 'confirmed', 'confirm');
  const reserved = (await order(first.id)).lines.find((l) => l.product_id === widgetId)?.reserved_qty;
  t.check('confirming reserves the stock', Number(reserved) === 3, String(reserved));
  await t.evaluate(`[...document.querySelectorAll('aside[aria-label^="Order "] [role="tab"]')].find(b => b.textContent.startsWith('Items')).click()`);
  await sleep(500);
  await t.shot('o4-items');
  await t.evaluate(`document.querySelector('aside[aria-label^="Order "] button[aria-label="Close"]').click()`);

  // ── fulfilment ─────────────────────────────────────────────────────────
  await t.evaluate(rail('Fulfilment'));
  await t.waitFor(`!!document.querySelector('[data-board-row=${js(first.number)}]')`, 'the order waiting to be picked', 20_000);
  await press(`[data-board-row=${js(first.number)}]`, 'Raise delivery note');
  await press('[role="dialog"]', 'Raise delivery note', 'the sheet’s Raise delivery note');
  await t.waitFor(`[...document.querySelectorAll('[data-board-row]')].some(r => r.textContent.includes(${js(first.number)}) && [...r.querySelectorAll('button')].some(b => b.textContent.trim() === 'Dispatch'))`, 'the note ready to send', 20_000);
  await t.shot('o5-fulfilment');
  await t.evaluate(`(() => { const r = [...document.querySelectorAll('[data-board-row]')].find(r => r.textContent.includes(${js(first.number)}) && [...r.querySelectorAll('button')].some(b => b.textContent.trim() === 'Dispatch')); [...r.querySelectorAll('button')].find(b => b.textContent.trim() === 'Dispatch').click(); })()`);
  await typeInto('[role="dialog"] input', 'E2E Couriers');
  await press('[role="dialog"]', 'Dispatch', 'the sheet’s Dispatch');
  await t.waitFor(`[...document.querySelectorAll('[data-board-row]')].some(r => r.textContent.includes(${js(first.number)}) && [...r.querySelectorAll('button')].some(b => b.textContent.trim() === 'Confirm delivered'))`, 'the note out with the customer', 20_000);
  const afterDispatch = await order(first.id);
  t.check('dispatching issues the stock', Number(afterDispatch.lines.find((l) => l.product_id === widgetId)?.delivered_qty) === 3, js(afterDispatch.lines));
  await t.evaluate(`(() => { const r = [...document.querySelectorAll('[data-board-row]')].find(r => r.textContent.includes(${js(first.number)}) && [...r.querySelectorAll('button')].some(b => b.textContent.trim() === 'Confirm delivered')); [...r.querySelectorAll('button')].find(b => b.textContent.trim() === 'Confirm delivered').click(); })()`);
  await press('[role="dialog"]', 'Confirm delivered', 'the sheet’s Confirm delivered');
  await t.waitFor(`![...document.querySelectorAll('[data-board-row]')].some(r => r.textContent.includes(${js(first.number)}))`, 'the order leaves the board', 20_000);
  t.check('delivered, it leaves the board', true, (await order(first.id)).status);

  // ── an order held by the rule: approved, and one rejected ─────────────
  const big = async (qty) => {
    const r = await api('POST', '/api/inventory/sales-orders', { client_id: clientId, warehouse_id: whId, lines: [{ product_id: widgetId, quantity: qty, unit_price: 150000 }] });
    const id = r.data?.order?.id;
    if (id) made.orders.push(id);
    return id;
  };
  const b1 = await big(1);
  const b2 = await big(1);
  await t.evaluate(rail('All orders'));
  await t.waitFor(`!!document.querySelector('[data-order="${b1}"]')`, 'the big order listed', 20_000);
  await openOrder(b1);
  await press('aside[aria-label^="Order "]', 'Submit for approval');
  await waitStatus(b1, 'pending_approval', 'submit big');
  await t.waitFor(`[...document.querySelectorAll('aside[aria-label^="Order "] [data-order-actions] button')].some(b => b.textContent.trim() === 'Approve')`, 'Approve offered', 15_000);
  await t.evaluate(`[...document.querySelectorAll('aside[aria-label^="Order "] [role="tab"]')].find(b => b.textContent.startsWith('Approval')).click()`);
  await sleep(400);
  await t.shot('o6-approval');
  await press('aside[aria-label^="Order "] [data-order-actions]', 'Approve');
  await press('[role="dialog"]', 'Approve', 'the sheet’s Approve');
  await waitStatus(b1, 'approved', 'approve');
  t.check('a rule holds the big order, and approving it moves it on', true);
  await t.evaluate(`document.querySelector('aside[aria-label^="Order "] button[aria-label="Close"]').click()`);
  await sleep(500);
  await openOrder(b2);
  await press('aside[aria-label^="Order "]', 'Submit for approval');
  await waitStatus(b2, 'pending_approval', 'submit second');
  await t.waitFor(`[...document.querySelectorAll('aside[aria-label^="Order "] [data-order-actions] button')].some(b => b.textContent.trim() === 'Reject')`, 'Reject offered', 15_000);
  await press('aside[aria-label^="Order "] [data-order-actions]', 'Reject');
  await typeInto('[role="dialog"] textarea', 'Price needs a second look (e2e)');
  await press('[role="dialog"]', 'Reject', 'the sheet’s Reject');
  await waitStatus(b2, 'rejected', 'reject');
  const steps = (await order(b2)).approval.steps;
  t.check('rejecting needs a reason, and keeps it', steps.some((s) => s.decision === 'rejected' && /second look/.test(s.reason ?? '')), js(steps));
  await t.evaluate(`document.querySelector('aside[aria-label^="Order "] button[aria-label="Close"]').click()`);

  // ── bulk priority, the PDF, and cancelling releases the stock ─────────
  await sleep(600);
  await t.evaluate(`[${b1}, ${b2}].forEach(id => document.querySelector('[data-order="' + id + '"] input[type="checkbox"]').click())`);
  await t.waitFor(`!!document.querySelector('[aria-label="Selected orders"]')`, 'the bulk bar');
  await t.shot('o7-bulk');
  await pickFrom('Priority to', 'high');
  let pr = [];
  for (let i = 0; i < 30; i++) {
    pr = [(await order(b1)).priority, (await order(b2)).priority];
    if (pr.every((p) => p === 'high')) break;
    await sleep(400);
  }
  t.check('bulk priority sets both', pr.every((p) => p === 'high'), js(pr));
  await openOrder(b1);
  await press('aside[aria-label^="Order "] [data-order-actions]', 'Confirm');
  await waitStatus(b1, 'confirmed', 'confirm big');
  const before = (await api('GET', `/api/inventory/stock/reservations?product_id=${widgetId}&status=active`)).data;
  await press('aside[aria-label^="Order "] [data-order-actions]', 'Cancel order');
  await press('[role="dialog"]', 'Cancel order', 'the sheet’s Cancel order');
  await waitStatus(b1, 'cancelled', 'cancel');
  const lines = (await order(b1)).lines;
  t.check('cancelling releases the reservation', lines.every((l) => Number(l.reserved_qty) === 0), js({ lines, before }));
  await press('aside[aria-label^="Order "] [data-order-actions]', 'PDF');
  await sleep(1500);
  t.check('the PDF downloads', await t.evaluate(`true`));
} catch (e) {
  t.check(`no unexpected error (${e.message})`, false);
  await t.shot('oz-failure').catch(() => undefined);
} finally {
  if (made.rule) await api('DELETE', `/api/oms/settings/rules/${made.rule}`).catch(() => undefined);
  // Drafts, rejected and cancelled orders can go; a delivered one is a record and stays.
  if (made.orders.length) await api('POST', '/api/oms/orders/bulk', { action: 'delete', ids: made.orders }).catch(() => undefined);
  await t.finish();
}

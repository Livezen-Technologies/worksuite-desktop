// End-to-end: Billing, part 1 — against a real server, through the UI: the
// dashboard; a new invoice (a customer, a product found by name, a typed line)
// saved as a draft and opened as a tab; the draft edited and saved; issued
// (numbered); recorded as sent; a part payment recorded and then taken off
// again; duplicated and the duplicate's draft deleted; cancelled; the list's
// bulk "mark as sent" and "cancel"; and a general receipt held on account.
//
// Makes its own fixtures (a customer and a product, named "E2E … <tag>").
// Invoices it issues stay on the record, cancelled; drafts and payments are
// removed. Needs a user who holds billing.* (locally: the "E2E Orders" role).
//
//   npm run build
//   WS_E2E_SERVER=… WS_E2E_EMAIL=… WS_E2E_PASSWORD=… ELECTRON_RUN_AS_NODE=1 npx electron tests/e2e/billing.mjs
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
const made = { invoices: [], payments: [] };
const inv = async (id) => (await api('GET', `/api/billing/invoices/${id}`)).data?.invoice;
const until = async (fn, label, tries = 40) => {
  let v;
  for (let i = 0; i < tries; i++) {
    v = await fn();
    if (v) return v;
    await sleep(400);
  }
  throw new Error(`${label}: never happened`);
};

const t = await launch({ name: 'billing' });
const press = async (scope, text, what = text) => {
  const ok = await t.evaluate(`(() => { const b = [...document.querySelectorAll(${js(scope + ' button')})].find(b => b.textContent.trim() === ${js(text)} && !b.disabled); if (b) b.click(); return !!b; })()`);
  if (!ok) throw new Error(`no ${what} button to press`);
};
const typeInto = (selector, value) =>
  t.evaluate(`(() => { const el = document.querySelector(${js(selector)}); if (!el) return false; el.focus(); const set = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set; set.call(el, ${js(value)}); el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
const pickFrom = async (label, text, search, scope = '') => {
  await t.evaluate(`document.querySelector(${js(`${scope} button[role="combobox"][aria-label="${label}"]`.trim())}).click()`);
  await t.waitFor(`!!document.querySelector('[role="listbox"][aria-label=${js(label)}]')`, `the ${label} list`);
  if (search) await typeInto(`input[aria-label=${js(`Search ${label}`)}]`, search);
  await t.waitFor(`[...document.querySelectorAll('[role="listbox"][aria-label=${js(label)}] [role="option"]')].some(o => o.textContent.includes(${js(text)}))`, `${text} in ${label}`, 15_000);
  await t.evaluate(`[...document.querySelectorAll('[role="listbox"][aria-label=${js(label)}] [role="option"]')].find(o => o.textContent.includes(${js(text)})).click()`);
};
const rail = async (label) => {
  const ok = await t.evaluate(`(() => { const b = [...document.querySelectorAll('nav[aria-label="Billing"] button')].find(b => b.textContent.trim().startsWith(${js(label)})); if (b) b.click(); return !!b; })()`);
  if (!ok) throw new Error(`no ${label} in the rail`);
};
const view = '[data-invoice-view]';

try {
  bearer = (await api('POST', '/api/auth/login', { email, password })).data?.tokens?.access_token ?? '';

  // ── fixtures ──────────────────────────────────────────────────────────
  const acct = await api('POST', '/api/crm/accounts', { name: `E2E Billing Customer ${tag}` });
  const clientId = acct.data?.id ?? acct.data?.account?.id;
  const prod = await api('POST', '/api/inventory/products', { name: `E2E Bill Seat ${tag}`, code: `EBS${tag}`, unit_price: 43200, is_stocked: 0 });
  const productId = prod.data?.id ?? prod.data?.product?.id;
  const orgs = (await api('GET', '/api/billing/organizations')).data?.items ?? [];
  t.check('fixtures: a customer and a product', !!(clientId && productId), js({ acct: [acct.status, acct.message], prod: [prod.status, prod.message] }));

  await t.signIn(server, email, password);
  await sleep(1500);
  await t.evaluate(`(() => { const b = [...document.querySelectorAll('nav button')].find(b => b.textContent.trim() === 'Invoices'); if (b) b.click(); return !!b; })()`);
  await t.waitFor(`!!document.querySelector('nav[aria-label="Billing"]')`, 'the Billing rail', 30_000);
  await t.waitFor(t.hasText('How old the money is'), 'the dashboard', 20_000);
  const tiles = await t.evaluate(`['Outstanding', 'Overdue', 'Billed this month', 'Received this month', 'Drafts', 'Unallocated payments', 'Credit balance', 'Recurring due'].every(l => [...document.querySelectorAll('main span')].some(s => s.textContent.trim() === l))`);
  t.check('the dashboard has its eight figures and panels', tiles && (await t.evaluate(t.hasText('Billed and received'))), '');
  await t.shot('b1-dashboard');

  // ── a new invoice ─────────────────────────────────────────────────────
  await press('nav[aria-label="Billing"]', 'New invoice');
  await t.waitFor(`!!document.querySelector('[role="dialog"][aria-label="Create new invoice"]')`, 'the new invoice form', 20_000);
  await pickFrom('Customer', `E2E Billing Customer ${tag}`, `E2E Billing Customer ${tag}`, '[role="dialog"]');
  if (await t.evaluate(`!!document.querySelector('[role="dialog"] button[aria-label="Company"]')`)) await pickFrom('Company', orgs[0].name, null, '[role="dialog"]');
  await typeInto('[role="dialog"] input[aria-label="Add a product"]', `E2E Bill Seat ${tag}`);
  await t.waitFor(`[...document.querySelectorAll('[role="listbox"][aria-label="Products"] [role="option"]')].some(o => o.textContent.includes(${js(`E2E Bill Seat ${tag}`)}))`, 'the product found', 15_000);
  await t.evaluate(`[...document.querySelectorAll('[role="listbox"][aria-label="Products"] [role="option"]')].find(o => o.textContent.includes(${js(`E2E Bill Seat ${tag}`)})).click()`);
  await typeInto('[role="dialog"] input[aria-label="Line 1 quantity"]', '2');
  const taxes = ((await api('GET', '/api/billing/taxes')).data?.taxes ?? []).filter((x) => x.kind === 'sales' && x.active && !x.is_compound);
  if (taxes.length) {
    await t.evaluate(`document.querySelector('[role="dialog"] button[aria-label="Line 1 tax"]').click()`);
    await t.waitFor(`!!document.querySelector('[role="listbox"][aria-label="Line 1 tax"]')`, 'the tax list');
    await t.evaluate(`[...document.querySelectorAll('[role="listbox"][aria-label="Line 1 tax"] label')].find(l => l.textContent.includes(${js(taxes[0].name)})).querySelector('input').click()`);
    await t.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
  }
  await press('[role="dialog"]', '+ Add line');
  await typeInto('[role="dialog"] input[aria-label="Line 2 description"]', `E2E setup ${tag}`);
  await typeInto('[role="dialog"] input[aria-label="Line 2 rate"]', '1000');
  await typeInto('[role="dialog"] input[aria-label="Customer PO number"]', `PO-${tag}`);
  await t.shot('b2-new-invoice');
  await press('[role="dialog"]', 'Save as draft');
  await t.waitFor(`!!document.querySelector('${view}')`, 'the draft opened as a tab', 20_000);
  const draftId = Number(await t.evaluate(`document.querySelector('${view}').dataset.invoiceView`));
  made.invoices.push(draftId);
  let d = await inv(draftId);
  t.check('saved as a draft with both lines, the PO, and the server’s figures', d?.status === 'draft' && d.number === null && d.lines.length === 2 && Number(d.subtotal) === 2 * 43200 + 1000 && d.po_number === `PO-${tag}` && d.lines[0].product_id === productId, js(d && { status: d.status, lines: d.lines.length, subtotal: d.subtotal, po: d.po_number }));
  if (taxes.length) t.check('a tax ticked on a line is charged on it', d.lines[0].tax_rate_ids.includes(taxes[0].id) && Number(d.tax_total) > 0 && d.lines[1].tax_rate_ids.length === 0, js({ taxes: d.lines.map((l) => l.tax_rate_ids), tax_total: d.tax_total }));
  const tabs = await t.evaluate(`[...document.querySelectorAll('[role="tablist"][aria-label="Open invoices"] [role="tab"]')].map(b => b.textContent.trim())`);
  t.check('it opens as a tab beside the list', tabs[0] === 'List' && tabs.includes(`Draft #${draftId}`), js(tabs));

  // ── edit the draft ────────────────────────────────────────────────────
  await typeInto(`${view} input[aria-label="Line 2 rate"]`, '2000');
  await t.waitFor(t.hasText('Unsaved changes'), 'the unsaved note');
  await press(view, 'Save draft');
  d = await until(async () => {
    const x = await inv(draftId);
    return Number(x?.subtotal) === 2 * 43200 + 2000 ? x : null;
  }, 'the draft saved');
  t.check('editing a line and saving the draft recalculates it', true);
  await t.shot('b3-draft');

  // ── issue ─────────────────────────────────────────────────────────────
  await press(view, 'Issue');
  await press('[role="dialog"]', 'Issue', 'the dialog’s Issue');
  d = await until(async () => {
    const x = await inv(draftId);
    return x?.number ? x : null;
  }, 'issued');
  t.check('issuing numbers it and it is owed', !!d.number && ['sent', 'overdue'].includes(d.status) && Number(d.due) === Number(d.total), js({ number: d.number, status: d.status, due: d.due }));
  await t.waitFor(`[...document.querySelectorAll('[role="tablist"][aria-label="Open invoices"] [role="tab"]')].some(b => b.textContent.trim() === ${js(d.number)})`, 'the tab named by its number', 15_000);
  const ro = await t.evaluate(`document.querySelector('${view} input[aria-label="Line 1 rate"]').disabled`);
  t.check('an issued invoice’s lines are read-only', ro === true, String(ro));
  await t.shot('b4-issued');

  // ── record as sent ────────────────────────────────────────────────────
  await press(view, 'Record as sent');
  await typeInto('[role="dialog"] input[aria-label="How was it sent?"]', `Emailed to e2e-${tag}@example.invalid`);
  await press('[role="dialog"]', 'Record');
  await until(async () => !!(await inv(draftId))?.sent_at, 'recorded as sent');
  const said = (await inv(draftId)).timeline.some((h) => h.title.includes(`e2e-${tag}@example.invalid`));
  t.check('recording it as sent keeps how, in its history', said, '');

  // ── a part payment, then taken off again ──────────────────────────────
  await press(view, 'Record payment');
  await t.waitFor(`!!document.querySelector('aside[aria-label="Record a payment"]')`, 'the payment panel');
  const offered = await t.evaluate(`document.querySelector('aside[aria-label="Record a payment"] input[aria-label="Amount"]').value`);
  t.check('the payment starts at what is owed', Number(offered) === Number(d.due), `${offered} vs ${d.due}`);
  await typeInto('aside[aria-label="Record a payment"] input[aria-label="Amount"]', '10000');
  await typeInto('aside[aria-label="Record a payment"] input[aria-label="Bank reference"]', `E2E-${tag}`);
  await t.shot('b5-payment');
  await press('aside[aria-label="Record a payment"]', 'Record payment');
  d = await until(async () => {
    const x = await inv(draftId);
    return Number(x?.paid) === 10000 ? x : null;
  }, 'the payment allocated');
  made.payments.push(d.allocations.payments[0]?.payment_id);
  t.check('a part payment settles part of it: part paid', d.status === 'partial' || (d.status === 'overdue' && Number(d.paid) === 10000), js({ status: d.status, paid: d.paid, due: d.due }));
  await t.evaluate(`[...document.querySelectorAll('${view} [role="tab"]')].find(b => b.textContent.startsWith('Settlement')).click()`);
  await t.waitFor(`${t.hasText(`E2E`)} && [...document.querySelectorAll('${view} b')].some(b => b.textContent.startsWith('RCP-'))`, 'the payment under Settlement', 15_000);
  await t.shot('b6-settlement');
  await press(view, 'Remove');
  await press('[role="dialog"]', 'Remove', 'the dialog’s Remove');
  await until(async () => Number((await inv(draftId))?.paid) === 0, 'the allocation removed');
  t.check('removing the allocation puts the whole amount back owing', true);

  // ── duplicate, and delete the duplicate's draft ───────────────────────
  await t.evaluate(`[...document.querySelectorAll('${view} [role="tab"]')].find(b => b.textContent === 'Lines').click()`);
  await press(view, 'Duplicate');
  await t.waitFor(`document.querySelector('${view}')?.dataset.invoiceView !== ${js(String(draftId))} && ${t.hasText('Draft invoice')}`, 'the duplicate opened', 20_000);
  const dupId = Number(await t.evaluate(`document.querySelector('${view}').dataset.invoiceView`));
  made.invoices.push(dupId);
  const dup = await inv(dupId);
  t.check('duplicating makes a new draft with the same lines', dup?.status === 'draft' && dup.lines.length === 2, js(dup && { status: dup.status, lines: dup.lines.length }));
  await press(view, 'Delete draft');
  await press('[role="dialog"]', 'Delete');
  await until(async () => (await api('GET', `/api/billing/invoices/${dupId}`)).status === 404, 'the duplicate deleted');
  t.check('deleting a draft removes it and closes its tab', !(await t.evaluate(`[...document.querySelectorAll('[role="tablist"][aria-label="Open invoices"] [role="tab"]')].some(b => b.textContent.trim() === ${js(`Draft #${dupId}`)})`)), '');

  // ── cancel ────────────────────────────────────────────────────────────
  await t.evaluate(`[...document.querySelectorAll('[role="tablist"][aria-label="Open invoices"] [role="tab"]')].find(b => b.textContent.trim() === ${js(d.number)}).click()`);
  await t.waitFor(`document.querySelector('${view}')?.dataset.invoiceView === ${js(String(draftId))}`, 'back on the invoice', 15_000);
  await press(view, 'Cancel invoice');
  await typeInto('[role="dialog"] input[aria-label="Why?"]', `E2E ${tag}`);
  await press('[role="dialog"]', 'Cancel invoice', 'the dialog’s Cancel invoice');
  const c = await until(async () => {
    const x = await inv(draftId);
    return x?.status === 'cancelled' ? x : null;
  }, 'cancelled');
  t.check('cancelling keeps its number and says why', c.number === d.number && c.cancel_reason === `E2E ${tag}`, js({ number: c.number, reason: c.cancel_reason }));

  // ── the list: bulk mark as sent, then bulk cancel ─────────────────────
  const two = [];
  for (let i = 0; i < 2; i++) {
    const r = await api('POST', '/api/billing/invoices', { client_id: clientId, ...(orgs[0] ? { org_id: orgs[0].id } : {}), lines: [{ description: `E2E bulk ${tag} ${i}`, quantity: 1, unit_price: 500 }] });
    const id = r.data?.invoice?.id;
    made.invoices.push(id);
    await api('POST', `/api/billing/invoices/${id}/issue`);
    two.push(id);
  }
  await t.evaluate(`[...document.querySelectorAll('[role="tablist"][aria-label="Open invoices"] [role="tab"]')].find(b => b.textContent.trim() === 'List').click()`);
  await t.waitFor(`!!document.querySelector('input[aria-label="Search invoices"]')`, 'the list', 15_000);
  await typeInto('input[aria-label="Search invoices"]', `E2E Billing Customer ${tag}`);
  await t.waitFor(`${two.map((id) => `!!document.querySelector('[data-invoice="${id}"]')`).join(' && ')}`, 'the two invoices listed', 15_000);
  for (const id of two) await t.evaluate(`document.querySelector('[data-invoice="${id}"] input[type="checkbox"]').click()`);
  await t.shot('b7-list');
  await press('main', 'Mark as sent');
  await press('[role="dialog"]', 'Record');
  await until(async () => (await Promise.all(two.map(inv))).every((x) => !!x?.sent_at), 'both marked sent');
  t.check('the list marks several as sent at once', true);
  for (const id of two) await t.evaluate(`document.querySelector('[data-invoice="${id}"] input[type="checkbox"]').click()`);
  await press('main', 'Cancel');
  await press('[role="dialog"]', 'Cancel them');
  await until(async () => (await Promise.all(two.map(inv))).every((x) => x?.status === 'cancelled'), 'both cancelled');
  t.check('and cancels several at once', true);

  // ── a general receipt, on account ─────────────────────────────────────
  await rail('Dashboard');
  await t.waitFor(t.hasText('How old the money is'), 'the dashboard', 20_000);
  await press('main', 'Record payment');
  await t.waitFor(`!!document.querySelector('aside[aria-label="Record a payment"]')`, 'the receipt panel');
  await pickFrom('Customer', `E2E Billing Customer ${tag}`, `E2E Billing Customer ${tag}`, 'aside[aria-label="Record a payment"]');
  if (await t.evaluate(`!!document.querySelector('aside[aria-label="Record a payment"] button[aria-label="Company"]')`)) await pickFrom('Company', orgs[0].name, null, 'aside[aria-label="Record a payment"]');
  await typeInto('aside[aria-label="Record a payment"] input[aria-label="Amount"]', '500');
  await t.evaluate(`document.querySelector('aside[aria-label="Record a payment"] input[type="checkbox"]').click()`);
  await press('aside[aria-label="Record a payment"]', 'Record payment');
  const receipt = await until(async () => ((await api('GET', `/api/billing/payments?client_id=${clientId}`)).data?.payments ?? []).find((p) => Number(p.amount) === 500), 'the receipt recorded');
  made.payments.push(receipt.id);
  t.check('a receipt held on account stays unallocated', Number(receipt.unallocated) === 500, js({ unallocated: receipt.unallocated }));
} catch (e) {
  t.check(`no unexpected error (${e.message})`, false);
  await t.shot('bz-failure').catch(() => undefined);
} finally {
  for (const id of made.payments.filter(Boolean)) await api('DELETE', `/api/billing/payments/${id}`).catch(() => undefined);
  // Drafts can go; an issued invoice is a record and stays, cancelled.
  for (const id of made.invoices.filter(Boolean)) {
    const x = await inv(id).catch(() => null);
    if (x?.status === 'draft') await api('DELETE', `/api/billing/invoices/${id}`).catch(() => undefined);
    else if (x && x.status !== 'cancelled' && Number(x.paid) === 0) await api('POST', `/api/billing/invoices/${id}/cancel`, { reason: 'E2E cleanup' }).catch(() => undefined);
  }
  await t.finish();
}

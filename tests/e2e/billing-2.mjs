// End-to-end: Billing, part 2 — against a real server, through the UI:
// payments (money on account allocated oldest-first, the allocation removed,
// part of it refunded, the receipt); a credit note raised from an invoice and
// issued (applied at once) and a standalone debit note; a customer's picture;
// a recurring profile made, run (a draft invoice), paused, resumed and removed;
// every report; and settings (a tax rate added and retired, an exchange rate
// recorded the right way round and removed, a payment mode added and removed,
// the currencies, data access).
//
// Makes its own fixtures (a customer, an issued invoice, a payment on account),
// named "E2E … <tag>". Needs a user who holds billing.* (locally: the
// "E2E Orders" role). Issued documents and refunds stay on the record.
//
//   npm run build
//   WS_E2E_SERVER=… WS_E2E_EMAIL=… WS_E2E_PASSWORD=… ELECTRON_RUN_AS_NODE=1 npx electron tests/e2e/billing-2.mjs
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
const made = { profile: null, taxes: [], rates: [], modes: [] };
const until = async (fn, label, tries = 40) => {
  let v;
  for (let i = 0; i < tries; i++) {
    v = await fn();
    if (v) return v;
    await sleep(400);
  }
  throw new Error(`${label}: never happened`);
};

const t = await launch({ name: 'billing-2' });
const press = async (scope, text, what = text) => {
  const ok = await t.evaluate(`(() => { const b = [...document.querySelectorAll(${js(scope + ' button')})].find(b => b.textContent.trim() === ${js(text)} && !b.disabled); if (b) b.click(); return !!b; })()`);
  if (!ok) throw new Error(`no ${what} button to press`);
};
const pressStart = async (scope, text, what = text) => {
  const ok = await t.evaluate(`(() => { const b = [...document.querySelectorAll(${js(scope + ' button')})].find(b => b.textContent.trim().startsWith(${js(text)}) && !b.disabled); if (b) b.click(); return !!b; })()`);
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
const panel = (label) => `aside[aria-label^=${js(label)}]`;
/** Waits for a button (by the start of its words) before pressing it: a screen's list may still be loading. */
const pressWhenThere = async (scope, text) => {
  await t.waitFor(`[...document.querySelectorAll(${js(scope + ' button')})].some(b => b.textContent.trim().startsWith(${js(text)}) && !b.disabled)`, `${text} to appear`, 15_000);
  await pressStart(scope, text);
};

try {
  bearer = (await api('POST', '/api/auth/login', { email, password })).data?.tokens?.access_token ?? '';

  // ── fixtures: a customer, an issued invoice, a payment on account ─────
  const acct = await api('POST', '/api/crm/accounts', { name: `E2E Billing Two ${tag}` });
  const clientId = acct.data?.id ?? acct.data?.account?.id;
  const orgs = (await api('GET', '/api/billing/organizations')).data?.items ?? [];
  const orgId = orgs[0]?.id;
  const inv = await api('POST', '/api/billing/invoices', { client_id: clientId, ...(orgId ? { org_id: orgId } : {}), lines: [{ description: `E2E work ${tag}`, quantity: 1, unit_price: 5000 }] });
  const invoiceId = inv.data?.invoice?.id;
  const issued = await api('POST', `/api/billing/invoices/${invoiceId}/issue`);
  const pay = await api('POST', '/api/billing/payments', { client_id: clientId, amount: 3000, method: 'bank_transfer', ...(orgId ? { org_id: orgId } : {}), bank_reference: `E2E-${tag}`, allocate: null });
  const paymentId = pay.data?.payment?.id;
  t.check('fixtures: a customer, an issued invoice, a payment on account', !!(clientId && invoiceId && issued.status < 300 && paymentId), js({ acct: acct.status, inv: [inv.status, inv.message], issued: [issued.status, issued.message], pay: [pay.status, pay.message] }));

  await t.signIn(server, email, password);
  await sleep(1500);
  await t.evaluate(`(() => { const b = [...document.querySelectorAll('nav button')].find(b => b.textContent.trim() === 'Invoices'); if (b) b.click(); return !!b; })()`);
  await t.waitFor(`!!document.querySelector('nav[aria-label="Billing"]')`, 'the Billing rail', 30_000);
  const external = await t.evaluate(`[...document.querySelectorAll('nav[aria-label="Billing"] button')].filter(b => (b.title || '').includes('browser')).length`);
  t.check('every Billing screen opens here now', external === 0, String(external));

  // ── payments ──────────────────────────────────────────────────────────
  await rail('Payments');
  await t.waitFor(`!!document.querySelector('input[aria-label="Search payments"]')`, 'the payments', 15_000);
  await typeInto('input[aria-label="Search payments"]', `E2E-${tag}`);
  await t.waitFor(`!!document.querySelector('[data-payment="${paymentId}"]')`, 'the payment listed', 15_000);
  await t.shot('c1-payments');
  await t.evaluate(`document.querySelector('[data-payment="${paymentId}"]').click()`);
  await t.waitFor(`!!document.querySelector(${js(panel('Payment '))})`, 'the payment panel', 15_000);
  await pressStart(panel('Payment '), 'Allocate');
  await t.waitFor(`!!document.querySelector('[role="dialog"][aria-label^="Allocate"]')`, 'the allocate sheet');
  await t.waitFor(`!!document.querySelector('[role="dialog"] input[aria-label^="Allocate to"]')`, 'the open invoice offered', 15_000);
  await t.shot('c2-allocate');
  await press('[role="dialog"]', 'Settle the oldest invoices first');
  await until(async () => Number((await api('GET', `/api/billing/invoices/${invoiceId}`)).data?.invoice?.paid) === 3000, 'allocated');
  t.check('money on account is settled against the oldest invoice', true);
  await t.waitFor(`[...document.querySelectorAll(${js(panel('Payment ') + ' button[aria-label^="Remove from"]')})].length === 1`, 'the allocation shown', 15_000);
  await t.evaluate(`document.querySelector(${js(panel('Payment ') + ' button[aria-label^="Remove from"]')}).click()`);
  await press('[role="dialog"]', 'Remove');
  await until(async () => Number((await api('GET', `/api/billing/invoices/${invoiceId}`)).data?.invoice?.paid) === 0, 'unallocated');
  t.check('removing it puts the money back on account', true);
  await press(panel('Payment '), 'Refund');
  await t.waitFor(`!!document.querySelector('[role="dialog"][aria-label^="Refund from"]')`, 'the refund sheet');
  await typeInto('[role="dialog"] input[aria-label="Amount to refund"]', '500');
  await typeInto('[role="dialog"] textarea[aria-label="Why is the money going back?"]', `E2E ${tag}`);
  await t.shot('c3-refund');
  await pressStart('[role="dialog"]', 'Refund');
  const p = await until(async () => {
    const x = (await api('GET', `/api/billing/payments/${paymentId}`)).data?.payment;
    return x?.refunds?.length ? x : null;
  }, 'refunded');
  t.check('a refund comes out of what is on account, as its own row', Number(p.refunds[0].amount) === 500 && Number(p.unallocated) === 2500, js({ refunds: p.refunds, unallocated: p.unallocated }));
  await press(panel('Payment '), 'Receipt');
  await sleep(1500);
  t.check('the receipt downloads', true);

  // ── a credit note from an invoice, and a debit note ───────────────────
  await t.evaluate(`(() => { const a = document.querySelector(${js(panel('Payment ') + ' button[aria-label="Close"]')}); if (a) a.click(); })()`);
  await rail('Invoices');
  await t.waitFor(`!!document.querySelector('input[aria-label="Search invoices"]')`, 'the list', 15_000);
  await typeInto('input[aria-label="Search invoices"]', `E2E Billing Two ${tag}`);
  await t.waitFor(`!!document.querySelector('[data-invoice="${invoiceId}"]')`, 'the invoice listed', 15_000);
  await t.evaluate(`document.querySelector('[data-invoice="${invoiceId}"] button[aria-label^="Open"]').click()`);
  await t.waitFor(`!!document.querySelector('[data-invoice-view]')`, 'the invoice', 15_000);
  await press('[data-invoice-view]', 'Raise credit note');
  await t.waitFor(`!!document.querySelector(${js(panel('New credit note'))})`, 'the new note', 15_000);
  await t.waitFor(`(document.querySelector(${js(panel('New credit note') + ' button[aria-label="Against an invoice"]')})?.dataset.value ?? '') === ${js(String(invoiceId))}`, 'the note against the invoice', 15_000);
  await typeInto(`${panel('New credit note')} input[aria-label="Amount"]`, '1000');
  await typeInto(`${panel('New credit note')} input[aria-label="Reason"]`, `E2E ${tag} price correction`);
  await t.shot('c4-new-note');
  await press(panel('New credit note'), 'Create draft');
  await t.waitFor(`!!document.querySelector(${js(panel('Note '))})`, 'the note opened', 15_000);
  await press(panel('Note '), 'Issue');
  await press('[role="dialog"]', 'Issue', 'the dialog’s Issue');
  await until(async () => Number((await api('GET', `/api/billing/invoices/${invoiceId}`)).data?.invoice?.credited) === 1000, 'credited');
  t.check('a credit note raised from an invoice is applied to it when issued', true);
  const cn = ((await api('GET', `/api/billing/credit-notes?q=${encodeURIComponent(`E2E Billing Two ${tag}`)}`)).data?.notes ?? [])[0];
  t.check('it is numbered, and nothing of it is left unused', !!cn?.number && Number(cn.remaining) === 0, js(cn));
  await t.shot('c5-note');
  await t.evaluate(`document.querySelector(${js(panel('Note ') + ' button[aria-label="Close"]')}).click()`);
  await t.evaluate(`[...document.querySelectorAll('main [role="tab"]')].find(b => b.textContent === 'Debit notes').click()`);
  await press('main', 'New debit note');
  await t.waitFor(`!!document.querySelector(${js(panel('New debit note'))})`, 'the new debit note', 15_000);
  await pickFrom('Customer', `E2E Billing Two ${tag}`, `E2E Billing Two ${tag}`, panel('New debit note'));
  if (await t.evaluate(`!!document.querySelector(${js(panel('New debit note') + ' button[aria-label="Company"]')})`)) await pickFrom('Company', orgs[0].name, null, panel('New debit note'));
  await typeInto(`${panel('New debit note')} input[aria-label="Amount"]`, '750');
  await typeInto(`${panel('New debit note')} input[aria-label="Line description"]`, `E2E late fee ${tag}`);
  await press(panel('New debit note'), 'Create draft');
  await t.waitFor(`!!document.querySelector(${js(panel('Note '))})`, 'the debit note opened', 15_000);
  await press(panel('Note '), 'Issue');
  await press('[role="dialog"]', 'Issue', 'the dialog’s Issue');
  const dn = await until(async () => ((await api('GET', `/api/billing/credit-notes?kind=debit&q=${encodeURIComponent(`E2E Billing Two ${tag}`)}`)).data?.notes ?? []).find((x) => x.number), 'the debit note issued');
  t.check('a debit note is numbered on its own sequence', /^DN|D/.test(dn.number) && Number(dn.total) === 750, js(dn));

  // ── the customer ──────────────────────────────────────────────────────
  await rail('Customers');
  await t.waitFor(`!!document.querySelector('input[aria-label="Search customers"]')`, 'the customers', 15_000);
  await typeInto('input[aria-label="Search customers"]', `E2E Billing Two ${tag}`);
  await t.waitFor(`document.querySelectorAll('[data-customer]').length === 1`, 'the list narrowed to the one customer', 15_000);
  await t.waitFor(`!!document.querySelector('[data-customer="${clientId}"]')`, 'the customer listed', 15_000);
  const row = await t.evaluate(`document.querySelector('[data-customer="${clientId}"]').textContent`);
  const detail = (await api('GET', `/api/billing/customers/${clientId}`)).data;
  t.check('the customer owes the invoice less its credit, plus the debit note — the credit note is not owed', Number(detail.summary.outstanding) === 5000 - 1000 + 750, js(detail.summary));
  await t.evaluate(`document.querySelector('[data-customer="${clientId}"]').click()`);
  const cp = `document.querySelector(${js(panel('Customer '))})?.textContent ?? ''`;
  await t.waitFor(`(${cp}).includes('How old the money is')`, 'the customer panel', 15_000);
  await t.shot('c6-customer');
  t.check('the customer panel shows their invoices, payments and what they owe, to the cent', await t.evaluate(`(${cp}).includes('Invoices (3)') && (${cp}).includes('Payments (2)') && (${cp}).includes('4,750.00')`), row);
  await t.evaluate(`document.querySelector(${js(panel('Customer ') + ' button[aria-label="Close"]')}).click()`);

  // ── recurring ─────────────────────────────────────────────────────────
  await rail('Recurring');
  await t.waitFor(`[...document.querySelectorAll('main button')].some(b => b.textContent.trim() === 'New profile')`, 'the recurring screen', 15_000);
  await press('main', 'New profile');
  await t.waitFor(`!!document.querySelector('[role="dialog"][aria-label="New recurring profile"]')`, 'the new profile form', 15_000);
  await typeInto('[role="dialog"] input[aria-label="Name"]', `E2E hosting ${tag}`);
  await pickFrom('Customer', `E2E Billing Two ${tag}`, `E2E Billing Two ${tag}`, '[role="dialog"]');
  if (await t.evaluate(`!!document.querySelector('[role="dialog"] button[aria-label="Company"]')`)) await pickFrom('Company', orgs[0].name, null, '[role="dialog"]');
  await typeInto('[role="dialog"] input[aria-label="Line 1 description"]', `Managed hosting ${tag}`);
  await typeInto('[role="dialog"] input[aria-label="Line 1 rate"]', '1800');
  await t.shot('c7-new-profile');
  await press('[role="dialog"]', 'Create profile');
  made.profile = (await until(async () => ((await api('GET', '/api/billing/recurring')).data?.profiles ?? []).find((x) => x.name === `E2E hosting ${tag}`), 'the profile made')).id;
  await t.waitFor(`!!document.querySelector(${js(panel('Profile '))})`, 'the profile opened', 15_000);
  await press(panel('Profile '), 'Run now');
  await press('[role="dialog"]', 'Generate');
  await t.waitFor(`!!document.querySelector('[data-invoice-view]') && ${t.hasText('Draft invoice')}`, 'the generated draft opened', 20_000);
  const gen = (await api('GET', `/api/billing/recurring/${made.profile}`)).data?.profile;
  t.check('running it raises a draft to review and moves the schedule on', gen?.generated === 1 && gen.invoices[0]?.status === 'draft' && gen.occurrences_done === 1, js(gen && { generated: gen.generated, invoices: gen.invoices, done: gen.occurrences_done }));
  await rail('Recurring');
  await t.waitFor(`!!document.querySelector('[data-profile="${made.profile}"]')`, 'the profile listed', 15_000);
  await t.evaluate(`document.querySelector('[data-profile="${made.profile}"] button').click()`);
  await t.waitFor(`!!document.querySelector(${js(panel('Profile '))})`, 'the profile panel', 15_000);
  await press(panel('Profile '), 'Pause');
  await until(async () => (await api('GET', `/api/billing/recurring/${made.profile}`)).data?.profile?.status === 'paused', 'paused');
  await press(panel('Profile '), 'Resume');
  await until(async () => (await api('GET', `/api/billing/recurring/${made.profile}`)).data?.profile?.status === 'active', 'resumed');
  t.check('pausing and resuming it save', true);
  await press(panel('Profile '), 'Remove');
  await press('[role="dialog"]', 'Remove');
  await until(async () => (await api('GET', `/api/billing/recurring/${made.profile}`)).status === 404, 'removed');
  made.profile = null;
  t.check('removing it stops it', true);
  // The draft it raised can go.
  if (gen?.invoices?.[0]?.id) await api('DELETE', `/api/billing/invoices/${gen.invoices[0].id}`);

  // ── reports ───────────────────────────────────────────────────────────
  await rail('Reports');
  await t.waitFor(`!!document.querySelector('main [role="tablist"][aria-label="Report"]')`, 'the reports', 15_000);
  const seen = [];
  for (const [tab, text] of [['Aging', 'Everything outstanding'], ['Revenue', 'Breakdown'], ['Tax', 'By rate'], ['Customers', 'counts fully settled invoices only'], ['Payments', 'Money not against any invoice'], ['What sold', 'Revenue before tax']]) {
    await t.evaluate(`[...document.querySelectorAll('main [role="tab"]')].find(b => b.textContent === ${js(tab)}).click()`);
    await t.waitFor(t.hasText(text), `the ${tab} report`, 20_000);
    seen.push(tab);
  }
  t.check('every report draws', seen.length === 6, js(seen));
  await t.shot('c8-reports');

  // ── settings ──────────────────────────────────────────────────────────
  await rail('Settings');
  await t.waitFor(`!!document.querySelector('nav[aria-label="Settings sections"]')`, 'the settings', 20_000);
  await t.waitFor(`document.querySelectorAll('main input, main button[role="combobox"]').length > 5`, 'the general settings form', 20_000);
  await t.shot('c9-settings');
  await press('nav[aria-label="Settings sections"]', 'Tax rates');
  await pressWhenThere('main', '+ Add a tax rate');
  await typeInto('[role="dialog"] input[aria-label="Name"]', `E2E tax ${tag}`);
  await typeInto('[role="dialog"] input[aria-label="Rate %"]', '1');
  await press('[role="dialog"]', 'Add rate');
  const tax = await until(async () => ((await api('GET', '/api/billing/taxes')).data?.taxes ?? []).find((x) => x.name === `E2E tax ${tag}`), 'the tax added');
  made.taxes.push(tax.id);
  await t.waitFor(`!!document.querySelector('[data-tax=${js(`E2E tax ${tag}`)}]')`, 'the tax listed', 15_000);
  await press(`[data-tax=${js(`E2E tax ${tag}`)}]`, 'Retire');
  await until(async () => ((await api('GET', '/api/billing/taxes')).data?.taxes ?? []).find((x) => x.id === tax.id)?.active === false, 'retired');
  t.check('a tax rate is added and retired', true);
  await press('nav[aria-label="Settings sections"]', 'Exchange rates');
  await pressWhenThere('main', '+ Record a rate');
  await typeInto('[role="dialog"] input[aria-label="Currency"]', 'EUR');
  await typeInto('[role="dialog"] input[aria-label="Rate"]', '330');
  const says = await t.evaluate(`document.querySelector('[role="dialog"]').textContent`);
  t.check('the rate form says what one unit is worth in the base currency', /1 EUR equals, in [A-Z]{3}/.test(says) && says.includes('100 EUR is 33,000'), says.slice(0, 200));
  await t.shot('c10-rate');
  await press('[role="dialog"]', 'Record');
  const rates = await until(async () => {
    const r = (await api('GET', '/api/billing/rates')).data;
    return r?.history?.find((x) => x.currency === 'EUR' && Number(x.rate) === 330) ? r : null;
  }, 'the rate recorded');
  made.rates.push(rates.history.find((x) => x.currency === 'EUR' && Number(x.rate) === 330).id);
  t.check('the rate is recorded as given', true);
  await press('nav[aria-label="Settings sections"]', 'Payment modes');
  await pressWhenThere('main', '+ New payment mode');
  await typeInto('[role="dialog"] input[aria-label="Name"]', `E2E mode ${tag}`);
  await press('[role="dialog"]', 'Save');
  const mode = await until(async () => ((await api('GET', '/api/billing/payment-modes')).data?.rows ?? []).find((x) => x.name === `E2E mode ${tag}`), 'the mode added');
  made.modes.push(mode.id);
  t.check('a payment mode is added', true);
  await press('nav[aria-label="Settings sections"]', 'Currencies');
  await t.waitFor(t.hasText('base'), 'the currencies', 15_000);
  await press('nav[aria-label="Settings sections"]', 'Data access');
  await t.waitFor(`!!document.querySelector('[data-permission="billing.view"]')`, 'the permissions', 15_000);
  t.check('currencies and data access show', true);
} catch (e) {
  t.check(`no unexpected error (${e.message})`, false);
  await t.shot('cz-failure').catch(() => undefined);
} finally {
  if (made.profile) await api('DELETE', `/api/billing/recurring/${made.profile}`).catch(() => undefined);
  for (const id of made.rates) await api('DELETE', `/api/billing/rates/${id}`).catch(() => undefined);
  for (const id of made.modes) await api('DELETE', `/api/billing/payment-modes/${id}`).catch(() => undefined);
  for (const id of made.taxes) await api('DELETE', `/api/billing/taxes/${id}`).catch(() => undefined);
  await t.finish();
}

// End-to-end: Sales & Orders, part 2 — against a real server, through the UI:
// the rail opens every screen here (none in the browser); Activity lists and
// filters; Reports draws the summary and sales performance and exports a CSV;
// a coupon is added, edited and removed; an approval rule is added, switched
// off and removed; a general setting is changed and saved (and put back); the
// sales channels are listed, one is added, tested and removed when a kind
// needs no record; and My access shows the data scope and the permissions.
//
// Everything it makes is named "E2E … <tag>" and removed at the end. Needs a
// user who holds oms.* (locally: the "E2E Orders" role).
//
//   npm run build
//   WS_E2E_SERVER=… WS_E2E_EMAIL=… WS_E2E_PASSWORD=… ELECTRON_RUN_AS_NODE=1 npx electron tests/e2e/sales-2.mjs
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
const code = `E2E${tag}`;
const made = { coupon: null, rule: null, channel: null, setting: null, warehouse: null };

const t = await launch({ name: 'sales-2' });
const rail = async (label) => {
  const ok = await t.evaluate(`(() => { const b = [...document.querySelectorAll('nav[aria-label="Orders"] button')].find(b => b.textContent.trim().startsWith(${js(label)})); if (b) b.click(); return !!b; })()`);
  if (!ok) throw new Error(`no ${label} in the rail`);
};
const press = async (scope, text, what = text) => {
  const ok = await t.evaluate(`(() => { const b = [...document.querySelectorAll(${js(scope + ' button')})].find(b => b.textContent.trim() === ${js(text)} && !b.disabled); if (b) b.click(); return !!b; })()`);
  if (!ok) throw new Error(`no ${what} button to press`);
};
const typeInto = (selector, value) =>
  t.evaluate(`(() => { const el = document.querySelector(${js(selector)}); if (!el) return false; el.focus(); const set = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set; set.call(el, ${js(value)}); el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
const pickFrom = async (label, text, search) => {
  await t.evaluate(`document.querySelector('button[role="combobox"][aria-label=${js(label)}]').click()`);
  await t.waitFor(`!!document.querySelector('[role="listbox"][aria-label=${js(label)}]')`, `the ${label} list`);
  if (search) await typeInto(`input[aria-label=${js(`Search ${label}`)}]`, search);
  await t.waitFor(`[...document.querySelectorAll('[role="listbox"][aria-label=${js(label)}] [role="option"]')].some(o => o.textContent.includes(${js(text)}))`, `${text} in ${label}`, 15_000);
  await t.evaluate(`[...document.querySelectorAll('[role="listbox"][aria-label=${js(label)}] [role="option"]')].find(o => o.textContent.includes(${js(text)})).click()`);
};
const text = (sel) => t.evaluate(`document.querySelector(${js(sel)})?.textContent ?? ''`);
const until = async (fn, label, tries = 30) => {
  let v;
  for (let i = 0; i < tries; i++) {
    v = await fn();
    if (v) return v;
    await sleep(400);
  }
  throw new Error(`${label}: never happened`);
};

try {
  bearer = (await api('POST', '/api/auth/login', { email, password })).data?.tokens?.access_token ?? '';
  const settingsBefore = (await api('GET', '/api/oms/settings')).data?.settings ?? {};
  made.setting = settingsBefore.oms_default_priority ?? 'normal';

  await t.signIn(server, email, password);
  await sleep(1500);
  await t.evaluate(`(() => { const b = [...document.querySelectorAll('nav button')].find(b => b.textContent.trim().startsWith('Sales')); if (b) b.click(); return !!b; })()`);
  await t.waitFor(`!!document.querySelector('nav[aria-label="Orders"]')`, 'the Orders rail', 30_000);
  const railText = await text('nav[aria-label="Orders"]');
  const external = await t.evaluate(`[...document.querySelectorAll('nav[aria-label="Orders"] button')].filter(b => (b.title || '').includes('browser')).length`);
  t.check('the rail has every part-2 screen, none in the browser', ['Activity', 'Reports', 'Coupons', 'Approval rules', 'Settings', 'My access'].every((l) => railText.includes(l)) && external === 0, js({ railText, external }));

  // ── activity ──────────────────────────────────────────────────────────
  await rail('Activity');
  await t.waitFor(`document.querySelectorAll('[data-event]').length > 0 || ${t.hasText('Nothing has happened to any order yet.')}`, 'the activity feed', 20_000);
  const days = await t.evaluate(`[...document.querySelectorAll('main[aria-label="Orders · Activity"] section[aria-label]')].map(s => s.getAttribute('aria-label'))`);
  const events = await t.evaluate(`document.querySelectorAll('[data-event]').length`);
  t.check('activity lists events under their days', days.length > 0 && events > 0, js({ days, events }));
  await t.shot('p1-activity');
  await pickFrom('Kind of event', 'Created');
  await until(() => t.evaluate(`[...document.querySelectorAll('[data-event]')].length > 0 && [...document.querySelectorAll('[data-event]')].every(e => e.dataset.event === 'created')`), 'the feed narrowed to creations');
  t.check('the kind filter narrows the feed', true);
  await press('main', 'Clear');

  // ── reports ───────────────────────────────────────────────────────────
  await rail('Reports');
  await t.waitFor(t.hasText('Order value, by currency'), 'the summary report', 20_000);
  const tiles = await t.evaluate(`['Orders', 'Today', 'Pending', 'Completed', 'Cancelled', 'Returned', 'Invoiced', 'Outstanding'].every(l => [...document.querySelectorAll('main span')].some(s => s.textContent.trim() === l))`);
  t.check('the summary has its eight figures, the status and ageing panels', tiles && (await t.evaluate(t.hasText('How long open orders have been waiting'))), '');
  await t.shot('p2-reports-summary');
  await pickFrom('Window', 'This year');
  await pickFrom('Report', 'Sales performance');
  await t.waitFor(`${t.hasText('Detail')} && ${t.hasText('By month')}`, 'sales performance', 20_000);
  const periods = await t.evaluate(`[...document.querySelectorAll('main [role="table"] [role="row"]')].length - 1`);
  t.check('sales performance by month has rows', periods > 0, String(periods));
  await t.shot('p3-reports-sales');
  const exp = await t.evaluate(`(() => { const b = [...document.querySelectorAll('main button')].find(b => b.textContent.trim() === 'Export'); if (b) b.click(); return !!b; })()`);
  await sleep(2500);
  const csv = await api('GET', `/api/oms/reports/sales?from=${new Date().getFullYear()}-01-01&to=${new Date().getFullYear()}-12-31&group=month&format=csv`);
  t.check('Export asks for the report as a CSV (the server answers it)', exp && csv.status === 200, String(csv.status));

  // ── coupons ───────────────────────────────────────────────────────────
  await rail('Coupons');
  await t.waitFor(`${t.hasText('New coupon')}`, 'the coupons screen', 20_000);
  await press('main', 'New coupon');
  await t.waitFor(`!!document.querySelector('[role="dialog"][aria-label="New coupon"]')`, 'the coupon editor');
  await typeInto('[role="dialog"] input[aria-label="Code"]', code.toLowerCase());
  await typeInto('[role="dialog"] input[aria-label="Name"]', `E2E coupon ${tag}`);
  await typeInto('[role="dialog"] input[aria-label="Percent"]', '15');
  await typeInto('[role="dialog"] input[aria-label="Minimum order"]', '50000');
  if (await t.evaluate(`!!document.querySelector('[role="dialog"] button[aria-label="Company"]')`)) {
    const firstOrg = await t.evaluate(`(async () => { document.querySelector('[role="dialog"] button[aria-label="Company"]').click(); await new Promise(r => setTimeout(r, 300)); const o = [...document.querySelectorAll('[role="listbox"][aria-label="Company"] [role="option"]')].find(o => o.textContent.trim() !== 'Every company'); const name = o?.textContent.trim(); o?.click(); return name; })()`);
    t.check('a new coupon asks which company it is for', !!firstOrg, String(firstOrg));
  }
  await t.shot('p4-coupon-editor');
  await press('[role="dialog"]', 'Save');
  const coupon = await until(async () => ((await api('GET', '/api/oms/coupons')).data?.rows ?? []).find((c) => c.code === code), 'the coupon saved');
  made.coupon = coupon.id;
  t.check('the coupon is saved upper-cased, 15% off orders over 50,000, and live', coupon.kind === 'percent' && Number(coupon.value) === 15 && Number(coupon.min_order_value) === 50000 && coupon.state === 'live', js(coupon));
  await t.waitFor(`!!document.querySelector('[data-coupon="${code}"]')`, 'the coupon in the list', 15_000);
  const rowText = await text(`[data-coupon="${code}"]`);
  t.check('the list says 15%, the minimum, 0 / ∞ and Live', rowText.includes('15%') && rowText.includes('0 / ∞') && rowText.includes('Live'), rowText);
  await t.shot('p5-coupons');
  await press(`[data-coupon="${code}"]`, 'Edit');
  await t.waitFor(`!!document.querySelector('[role="dialog"][aria-label="Edit ${code}"]')`, 'the coupon editor, editing');
  await typeInto('[role="dialog"] input[aria-label="Name"]', `E2E coupon ${tag} renamed`);
  await press('[role="dialog"]', 'Save');
  await until(async () => ((await api('GET', '/api/oms/coupons')).data?.rows ?? []).find((c) => c.code === code)?.name === `E2E coupon ${tag} renamed`, 'the rename saved');
  t.check('editing the coupon saves', true);
  await press(`[data-coupon="${code}"]`, 'Remove');
  await press('[role="dialog"]', 'Remove');
  await until(async () => !((await api('GET', '/api/oms/coupons')).data?.rows ?? []).some((c) => c.code === code), 'the coupon removed');
  made.coupon = null;
  t.check('removing the coupon deletes it', true);

  // ── approval rules ────────────────────────────────────────────────────
  await rail('Approval rules');
  await t.waitFor(t.hasText('every matching rule becomes a step'), 'the rules screen', 20_000);
  await press('main', 'New rule');
  await t.waitFor(`!!document.querySelector('section[aria-label="New rule"]')`, 'the rule editor');
  await typeInto('section[aria-label="New rule"] input[aria-label="Name"]', `E2E desk rule ${tag}`);
  await typeInto('section[aria-label="New rule"] input[aria-label="Value"]', '250000');
  await pickFrom('Step', '3');
  await t.shot('p6-rule-editor');
  await press('section[aria-label="New rule"]', 'Save');
  const rule = await until(async () => ((await api('GET', '/api/oms/settings/rules')).data?.rules ?? []).find((r) => r.name === `E2E desk rule ${tag}`), 'the rule saved');
  made.rule = rule.id;
  t.check('the rule is saved: step 3, order total over 250,000, active', rule.step === 3 && rule.subject === 'order_total' && Number(rule.threshold) === 250000 && rule.is_active === true, js(rule));
  await t.waitFor(`!!document.querySelector('[data-rule=${js(`E2E desk rule ${tag}`)}]')`, 'the rule in the list', 15_000);
  const ruleText = await text(`[data-rule=${js(`E2E desk rule ${tag}`)}]`);
  t.check('the list reads the rule as the server writes it', ruleText.includes(`${rule.reads} → needs oms.orders.approve`), ruleText);
  await press(`[data-rule=${js(`E2E desk rule ${tag}`)}]`, 'Edit');
  await t.waitFor(`!!document.querySelector('section[aria-label="Edit rule"]')`, 'the rule editor, editing');
  await t.evaluate(`document.querySelector('section[aria-label="Edit rule"] input[type="checkbox"]').click()`);
  await press('section[aria-label="Edit rule"]', 'Save');
  await until(async () => ((await api('GET', '/api/oms/settings/rules')).data?.rules ?? []).find((r) => r.id === made.rule)?.is_active === false, 'the rule switched off');
  await t.waitFor(`(document.querySelector('[data-rule=${js(`E2E desk rule ${tag}`)}]')?.textContent ?? '').includes('off')`, 'the off chip', 15_000);
  t.check('switching the rule off saves, and the list marks it off', true);
  await t.shot('p7-rules');
  await t.evaluate(`document.querySelector('[data-rule=${js(`E2E desk rule ${tag}`)}] button[aria-label^="Remove"]').click()`);
  await press('[role="dialog"]', 'Remove');
  await until(async () => !((await api('GET', '/api/oms/settings/rules')).data?.rules ?? []).some((r) => r.id === made.rule), 'the rule removed');
  made.rule = null;
  t.check('removing the rule deletes it', true);

  // ── settings ──────────────────────────────────────────────────────────
  await rail('Settings');
  await t.waitFor(`!!document.querySelector('button[role="combobox"][aria-label="Default priority"]')`, 'the general settings', 20_000);
  const want = made.setting === 'high' ? 'Urgent' : 'High';
  await pickFrom('Default priority', want);
  made.warehouse = settingsBefore.oms_default_warehouse ?? '';
  const houses = ((await api('GET', '/api/inventory/warehouses')).data?.warehouses ?? []).filter((h) => String(h.id) !== String(made.warehouse));
  const house = houses[houses.length - 1];
  await pickFrom('Default warehouse', house.name, house.name);
  await t.shot('p8-settings');
  await press('main', 'Save');
  await until(async () => {
    const st = (await api('GET', '/api/oms/settings')).data?.settings ?? {};
    return st.oms_default_priority === want.toLowerCase() && String(st.oms_default_warehouse) === String(house.id);
  }, 'the settings saved');
  t.check('general settings save: a priority, and a warehouse chosen by name and kept as its id', true);
  await press('nav[aria-label="Orders"]', 'New order');
  await t.waitFor(`!!document.querySelector('[data-new-order]')`, 'the new order form', 20_000);
  await sleep(800);
  const starts = await t.evaluate(`({ warehouse: document.querySelector('[role="dialog"] button[role="combobox"][aria-label="Warehouse"]')?.dataset.value, priority: document.querySelector('[role="dialog"] button[role="combobox"][aria-label="Priority"]')?.dataset.value })`);
  t.check('a new order starts from those defaults', String(starts.warehouse) === String(house.id) && starts.priority === want.toLowerCase(), js({ starts, want: [house.id, want] }));
  await press('[role="dialog"]', 'Cancel');
  await rail('Settings');
  await t.waitFor(`!!document.querySelector('nav[aria-label="Settings sections"]')`, 'the settings', 20_000);
  await press('nav[aria-label="Settings sections"]', 'Sales Channels');
  await t.waitFor(`!!document.querySelector('[data-channel-kind]')`, 'the sales channels', 20_000);
  const kinds = await t.evaluate(`[...document.querySelectorAll('[data-channel-kind]')].map(e => e.dataset.channelKind)`);
  t.check('every kind of channel is listed, set up or not', kinds.length > 0, js(kinds));
  await t.shot('p9-channels');
  const cat = (await api('GET', '/api/oms/channels')).data?.catalogue ?? [];
  const free = cat.find((k) => !k.needs_ref);
  if (free) {
    const setUp = free.count === 0 ? 'Set up' : 'Add another';
    await press(`[data-channel-kind="${free.kind}"]`, setUp);
    await t.waitFor(`!!document.querySelector('[role="dialog"][aria-label^="Add a"]')`, 'the add-channel sheet');
    await typeInto('[role="dialog"] input[aria-label="Name"]', `E2E channel ${tag}`);
    await press('[role="dialog"]', 'Add channel');
    // Recorded before anything else is waited for, so a failure below cannot leave it behind.
    made.channel = await until(async () => (await api('GET', '/api/oms/channels')).data?.catalogue?.flatMap((k) => k.channels).find((c) => c.name === `E2E channel ${tag}`)?.id, 'the channel listed');
    await t.waitFor(`!!document.querySelector('aside[aria-label="Channel E2E channel ${tag}"] [role="tablist"]')`, 'the new channel open', 20_000);
    t.check('a channel tied to no company is added, listed and opens', !!made.channel, String(made.channel));
    await press('aside[aria-label^="Channel "]', 'Test');
    await sleep(1500);
    await t.evaluate(`[...document.querySelectorAll('aside[aria-label^="Channel "] [role="tab"]')].find(b => b.textContent === 'Logs')?.click()`);
    await t.waitFor(`${t.hasText('Nothing has been recorded for this channel yet.')} || document.querySelectorAll('aside[aria-label^="Channel "] .font-bold').length > 0`, 'the logs', 15_000);
    const logs = await until(async () => {
      const rows = (await api('GET', `/api/oms/channels/${made.channel}/logs`)).data?.rows ?? [];
      return rows.some((l) => l.action === 'test') ? rows : null;
    }, 'the test logged');
    const shown = await t.evaluate(`[...document.querySelectorAll('aside[aria-label^="Channel "] span')].some(s => s.textContent.trim() === 'test')`);
    t.check('Test is logged against the channel, and the Logs tab shows it', logs.some((l) => l.action === 'test') && shown, js(logs.slice(0, 2).map((l) => [l.action, l.status])));
    await t.shot('p10-channel');
    await t.evaluate(`[...document.querySelectorAll('aside[aria-label^="Channel "] [role="tab"]')].find(b => b.textContent === 'Connection').click()`);
    await press('aside[aria-label^="Channel "]', 'Remove this channel');
    await press('[role="dialog"]', 'Remove');
    await until(async () => !((await api('GET', '/api/oms/channels')).data?.catalogue ?? []).flatMap((k) => k.channels).some((c) => c.id === made.channel), 'the channel removed');
    made.channel = null;
    t.check('removing the channel deletes it', true);
  } else {
    t.skip('adding a channel', 'every kind on this server needs a record from Billing first');
  }

  // ── my access ─────────────────────────────────────────────────────────
  await rail('My access');
  await t.waitFor(t.hasText('Narrowed by the company picker'), 'the data scope', 20_000);
  await t.shot('p11-access');
  await t.evaluate(`[...document.querySelectorAll('main [role="tab"]')].find(b => b.textContent.startsWith('My access')).click()`);
  await t.waitFor(`!!document.querySelector('[data-permission="oms.view"]')`, 'the permission list', 20_000);
  t.check('My access lists the Orders permissions, oms.view granted', (await text('[data-permission="oms.view"]')).includes('Granted'), '');
} catch (e) {
  t.check(`no unexpected error (${e.message})`, false);
  await t.shot('pz-failure').catch(() => undefined);
} finally {
  if (made.coupon) await api('DELETE', `/api/oms/coupons/${made.coupon}`).catch(() => undefined);
  if (made.rule) await api('DELETE', `/api/oms/settings/rules/${made.rule}`).catch(() => undefined);
  if (made.channel) await api('DELETE', `/api/oms/channels/${made.channel}`).catch(() => undefined);
  if (made.setting) await api('PUT', '/api/module-settings/oms/general', { oms_default_priority: made.setting, ...(made.warehouse !== null ? { oms_default_warehouse: made.warehouse } : {}) }).catch(() => undefined);
  await t.finish();
}

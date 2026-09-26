// End-to-end: CRM part 1 — the rail and dashboard (mine and the team's);
// a lead created, a duplicate merged in, its status and owner changed, a call
// recorded and a follow-up scheduled; the follow-up moved and closed with
// "How did it go?", another called off; the lead converted into an account,
// a contact and a deal; the deal moved on the board by dragging and from its
// drawer, a note recorded, then lost with a reason; a new deal; and two leads
// reassigned together. Checked against the server; everything it makes is
// named "E2E CRM …" and removed again (scratchpad clean-crm-e2e.sh).
//
//   npm run build
//   WS_E2E_SERVER=… WS_E2E_EMAIL=… WS_E2E_PASSWORD=… ELECTRON_RUN_AS_NODE=1 npx electron tests/e2e/crm.mjs
import { choose, launch, sleep } from './harness.mjs';

const server = process.env.WS_E2E_SERVER;
const email = process.env.WS_E2E_EMAIL;
const password = process.env.WS_E2E_PASSWORD;
if (!server || !email || !password) {
  console.error('Set WS_E2E_SERVER, WS_E2E_EMAIL and WS_E2E_PASSWORD.');
  process.exit(2);
}

let token = '';
async function login() {
  const r = await fetch(`${server}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ email, password }) });
  const j = await r.json();
  token = j.data?.tokens?.access_token ?? '';
  return j.data?.user ?? {};
}
async function api(method, path, body) {
  const res = await fetch(`${server}${path}`, { method, headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}), Authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, data: json.data ?? json, message: json.message };
}
async function poll(fn, ok, tries = 20) {
  let v;
  for (let i = 0; i < tries; i++) {
    v = await fn();
    if (ok(v)) return v;
    await sleep(500);
  }
  return v;
}

const js = (v) => JSON.stringify(v);
const tag = Math.floor(Math.random() * 10_000);
const co = `E2E CRM ${tag}`;
const heading = (t) => `[...document.querySelectorAll('main h1')].some(h => h.textContent.trim() === ${js(t)})`;
const dialog = (label) => `document.querySelector(${js(`[role="dialog"][aria-label="${label}"], aside[aria-label="${label}"]`)})`;
const clickIn = (scope, text) => `(() => { const root = ${scope} ?? document; const b = [...root.querySelectorAll('button')].find(b => !b.disabled && (b.textContent.trim() === ${js(text)} || b.getAttribute('aria-label') === ${js(text)})); if (!b) return false; b.click(); return true; })()`;
const setValue = (selector, value) => `(() => { const el = document.querySelector(${js(selector)}); if (!el) return false; const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${js(value)}); el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`;
/** A rail item, whose text may end in its count ("Leads3"). */
const rail = (label) => `(() => { const b = [...document.querySelectorAll('nav[aria-label="CRM"] button')].find(b => b.textContent.trim().replace(/\\d+$/, '') === ${js(label)}); if (!b) return false; b.click(); return true; })()`;
const inAside = (label) => `document.querySelector(${js(`aside[aria-label="${label}"]`)})`;

const t = await launch({ name: 'crm' });
const made = { leads: [], deals: [] };
try {
  await login();
  await t.signIn(server, email, password);
  await t.evaluate(`[...document.querySelectorAll('nav[aria-label="Apps"] button')].find(b => b.textContent.trim().startsWith('CRM')).click()`);
  await t.waitFor(`!!document.querySelector('nav[aria-label="CRM"]')`, 'the CRM rail', 30_000);

  // ── rail and dashboard ────────────────────────────────────────────────
  const railItems = await t.evaluate(`[...document.querySelectorAll('nav[aria-label="CRM"] button')].map(b => b.textContent.trim())`);
  t.check('the rail has New lead, search, the sales and catalogue sections, and My access', ['Dashboard', 'Leads', 'Follow-ups', 'Accounts', 'Quotes', 'Price list', 'Lead intake', 'Settings', 'My access'].every((l) => railItems.some((x) => x.startsWith(l))) && railItems[0].includes('New lead'), js(railItems));
  await t.waitFor(heading('My pipeline'), 'the dashboard');
  await t.evaluate(`[...document.querySelectorAll('main [role="tab"]')].find(b => b.textContent.trim() === 'Team').click()`);
  await t.waitFor(heading('Team pipeline'), 'the team dashboard');
  t.check('the dashboard switches between mine and the team', true);
  await t.shot('crm-dashboard');

  // ── a new lead ────────────────────────────────────────────────────────
  await t.evaluate(clickIn(`document.querySelector('nav[aria-label="CRM"]')`, 'New lead'));
  await t.waitFor(`!!${dialog('New lead')}`, 'the new lead form');
  await t.evaluate(setValue('aside[aria-label="New lead"] input[aria-label="First name"]', 'Nadeesha'));
  await t.evaluate(setValue('aside[aria-label="New lead"] input[aria-label="Last name"]', `E2ECRM${tag}`));
  await t.evaluate(setValue('aside[aria-label="New lead"] input[aria-label="Company"]', co));
  await t.evaluate(setValue('aside[aria-label="New lead"] input[aria-label="Job title"]', 'Chief Technology Officer'));
  await t.evaluate(setValue('aside[aria-label="New lead"] input[aria-label="Email"]', `nadeesha.${tag}@brightpath.lk`));
  await t.evaluate(setValue('aside[aria-label="New lead"] input[aria-label="Estimated value"]', '400000'));
  await t.evaluate(clickIn(dialog('New lead'), 'Create lead'));
  await t.waitFor(`!!${inAside('Lead')} && ${inAside('Lead')}.innerText.includes(${js(co)})`, 'the new lead in its drawer', 20_000);
  const found = (await poll(() => api('GET', `/api/crm/leads?q=${encodeURIComponent(`E2ECRM${tag}`)}`), (r) => (r.data?.leads ?? []).length === 1)).data?.leads ?? [];
  const lead = found[0];
  made.leads.push(lead?.id);
  t.check('New lead creates it, scored, and opens it', !!lead && lead.company === co && lead.score > 0, js({ id: lead?.id, score: lead?.score }));

  // ── a duplicate merged in ─────────────────────────────────────────────
  const dup = await api('POST', '/api/crm/leads', { first_name: 'N.', last_name: `E2ECRM${tag}b`, company: `${co} Ltd`, email: `nadeesha.${tag}@brightpath.lk` });
  const dupId = dup.data?.lead?.id;
  made.leads.push(dupId);
  await t.evaluate(clickIn(inAside('Lead'), 'Close'));
  await t.evaluate(rail('Dashboard'));
  await t.evaluate(rail('Leads'));
  await t.waitFor(`!!document.querySelector('[data-lead="${lead.id}"]')`, 'the lead in the list', 20_000);
  await t.evaluate(`document.querySelector('[data-lead="${lead.id}"]').click()`);
  await t.waitFor(`${inAside('Lead')}?.innerText.includes('possible duplicate')`, 'the duplicate', 20_000);
  await t.shot('crm-lead-drawer');
  await t.evaluate(clickIn(inAside('Lead'), 'Merge'));
  await t.waitFor(`!!${dialog('Merge this lead in?')}`, 'the merge confirmation');
  await t.evaluate(clickIn(dialog('Merge this lead in?'), 'Merge'));
  t.check('a duplicate is merged in', (await poll(() => api('GET', `/api/crm/leads/${dupId}`), (r) => r.status === 404)).status === 404);

  // ── status, owner, a call, a follow-up ────────────────────────────────
  await t.waitFor(`!!document.querySelector('aside[aria-label="Lead"] [role="combobox"][aria-label="Status"]')`, 'the status control');
  await t.evaluate(choose('aside[aria-label="Lead"] [role="combobox"][aria-label="Status"]', 'contacted'));
  t.check('the status is changed from the drawer', (await poll(() => api('GET', `/api/crm/leads/${lead.id}`), (r) => r.data?.lead?.status === 'contacted')).data?.lead?.status === 'contacted');
  await t.evaluate(`[...document.querySelectorAll('aside[aria-label="Lead"] [role="tab"]')].find(b => b.textContent.startsWith('Timeline')).click()`);
  await t.waitFor(`!!document.querySelector('aside[aria-label="Lead"] input[aria-label="What happened?"]')`, 'the timeline');
  await t.evaluate(setValue('aside[aria-label="Lead"] input[aria-label="What happened?"]', 'Discussed seat count'));
  await t.evaluate(clickIn(inAside('Lead'), 'Record'));
  t.check('a call is recorded on the lead', (await poll(() => api('GET', `/api/crm/leads/${lead.id}`), (r) => (r.data?.timeline ?? []).some((x) => x.title === 'Discussed seat count'))).data?.timeline?.some((x) => x.title === 'Discussed seat count'));
  await t.evaluate(`[...document.querySelectorAll('aside[aria-label="Lead"] [role="tab"]')].find(b => b.textContent === 'Detail').click()`);
  await t.waitFor(`[...document.querySelectorAll('aside[aria-label="Lead"] button')].some(b => b.textContent.trim() === 'Schedule a follow-up')`, 'the schedule button');
  await t.evaluate(clickIn(inAside('Lead'), 'Schedule a follow-up'));
  await t.waitFor(`!!${dialog('Schedule a follow-up')}`, 'the schedule form');
  await t.evaluate(setValue('[role="dialog"][aria-label="Schedule a follow-up"] input[aria-label="What for"]', 'Confirm the seat count'));
  await t.evaluate(clickIn(dialog('Schedule a follow-up'), 'Schedule'));
  const fus = await poll(() => api('GET', `/api/crm/followups?lead=${lead.id}&view=all`), (r) => (r.data?.items ?? []).length > 0);
  const fu = (fus.data?.items ?? [])[0];
  t.check('a follow-up is scheduled from the lead', !!fu && fu.subject === 'Confirm the seat count', js(fu ?? {}));

  // ── follow-ups: move, how it went, call off ───────────────────────────
  await t.evaluate(clickIn(inAside('Lead'), 'Close'));
  await t.evaluate(rail('Follow-ups'));
  await t.waitFor(heading('Follow-ups'), 'Follow-ups');
  // Due within a day counts as due today (the server's rolling 24 hours), which is the view it opens on.
  // Scheduled for tomorrow shortly after midnight, it is more than a day off and To come instead.
  const inToday = await t.waitFor(`!!document.querySelector('[data-followup="${fu.id}"]')`, 'the follow-up card', 6_000).then(() => true, () => false);
  if (!inToday) {
    await t.evaluate(`[...document.querySelectorAll('main [role="tab"]')].find(b => b.textContent.startsWith('To come')).click()`);
    await t.waitFor(`!!document.querySelector('[data-followup="${fu.id}"]')`, 'the follow-up card', 20_000);
  }
  await t.shot('crm-followups');
  await t.evaluate(clickIn(`document.querySelector('[data-followup="${fu.id}"]')`, 'Move'));
  await t.waitFor(`!!${dialog('Move the follow-up')}`, 'the move form');
  const later = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
  await t.evaluate(setValue('[role="dialog"][aria-label="Move the follow-up"] input[aria-label="Date"]', later));
  await t.evaluate(clickIn(dialog('Move the follow-up'), 'Move'));
  t.check('a follow-up is moved', (await poll(() => api('GET', `/api/crm/followups?lead=${lead.id}&view=all`), (r) => (r.data?.items ?? [])[0]?.due_local?.startsWith(later))).data?.items?.[0]?.due_local?.startsWith(later));
  // Moved five days out, it is To come now.
  await t.evaluate(`[...document.querySelectorAll('main [role="tab"]')].find(b => b.textContent.startsWith('To come')).click()`);
  await t.waitFor(`!!document.querySelector('[data-followup="${fu.id}"]')`, 'the card again', 20_000);
  await t.evaluate(clickIn(`document.querySelector('[data-followup="${fu.id}"]')`, 'How it went'));
  await t.waitFor(`!!${dialog('How did it go?')}`, 'How did it go');
  await t.evaluate(setValue('[role="dialog"][aria-label="How did it go?"] textarea', 'Wants the revised quote by Monday.'));
  await t.evaluate(`[...document.querySelectorAll('[role="dialog"][aria-label="How did it go?"] input[type="checkbox"]')].forEach(c => c.checked && c.click())`);
  await t.evaluate(clickIn(dialog('How did it go?'), 'Save'));
  t.check('How did it go? closes the follow-up with its outcome', (await poll(() => api('GET', `/api/crm/followups?lead=${lead.id}&view=completed`), (r) => (r.data?.items ?? []).some((x) => x.id === fu.id))).data?.items?.some((x) => x.id === fu.id && x.result_notes?.includes('revised quote')));
  const second = await api('POST', `/api/crm/leads/${lead.id}/followups`, { kind: 'email', date: later, time: '10:00', subject: 'Send the brochure' });
  await t.evaluate(`[...document.querySelectorAll('main [role="tab"]')].find(b => b.textContent.startsWith('Due today')).click()`);
  await t.evaluate(`[...document.querySelectorAll('main [role="tab"]')].find(b => b.textContent.startsWith('To come')).click()`);
  await t.waitFor(`!!document.querySelector('[data-followup="${second.data?.id}"]')`, 'the second follow-up', 20_000);
  await t.evaluate(clickIn(`document.querySelector('[data-followup="${second.data?.id}"]')`, 'Call it off'));
  await t.waitFor(`!!${dialog('Call it off')}`, 'the call-off form');
  await t.evaluate(setValue('[role="dialog"][aria-label="Call it off"] input', 'They bought elsewhere'));
  await t.evaluate(clickIn(dialog('Call it off'), 'OK'));
  t.check('a follow-up is called off with a reason', (await poll(() => api('GET', `/api/crm/followups?lead=${lead.id}&view=cancelled`), (r) => (r.data?.items ?? []).some((x) => x.id === second.data?.id))).data?.items?.some((x) => x.cancel_reason === 'They bought elsewhere'));

  // ── convert ───────────────────────────────────────────────────────────
  await t.evaluate(rail('Leads'));
  await t.waitFor(`!!document.querySelector('[data-lead="${lead.id}"]')`, 'the lead again', 20_000);
  await t.evaluate(`document.querySelector('[data-lead="${lead.id}"]').click()`);
  await t.waitFor(`[...(${inAside('Lead')}?.querySelectorAll('button') ?? [])].some(b => b.textContent.trim() === 'Convert')`, 'Convert');
  await t.evaluate(clickIn(inAside('Lead'), 'Convert'));
  await t.waitFor(`!!document.querySelector('[role="dialog"][aria-label^="Convert"]')`, 'the convert form');
  await t.evaluate(setValue('[role="dialog"][aria-label^="Convert"] input[aria-label="Deal name"]', `${co} — 25 seats`));
  await t.evaluate(clickIn(`document.querySelector('[role="dialog"][aria-label^="Convert"]')`, 'Convert'));
  const converted = await poll(() => api('GET', `/api/crm/leads/${lead.id}`), (r) => r.data?.lead?.converted === true);
  const dealId = converted.data?.lead?.converted_deal_id;
  made.deals.push(dealId);
  t.check('Convert makes an account, a contact and a deal, and the lead turns read-only', !!converted.data?.lead?.converted_account_id && !!dealId && (await t.evaluate(`${inAside('Lead')}.innerText.includes('This lead was converted')`)), js(converted.data?.lead ?? {}));

  // ── the board ─────────────────────────────────────────────────────────
  await t.evaluate(clickIn(inAside('Lead'), 'Open deal'));
  await t.waitFor(`!!${inAside('Deal')} && ${inAside('Deal')}.innerText.includes(${js(`${co} — 25 seats`)})`, 'the deal drawer', 20_000);
  const board = (await api('GET', '/api/crm/deals/board')).data;
  const stage = (name) => board.columns.find((c) => c.name === name)?.id;
  await t.evaluate(choose('aside[aria-label="Deal"] [role="combobox"][aria-label="Stage"]', String(stage('Proposal'))));
  t.check('a deal moves stage from its drawer', (await poll(() => api('GET', `/api/crm/deals/${dealId}`), (r) => r.data?.deal?.stage_id === stage('Proposal'))).data?.deal?.stage_id === stage('Proposal'));
  await t.evaluate(setValue('aside[aria-label="Deal"] input[aria-label="What happened?"]', 'Sent the proposal'));
  await t.evaluate(clickIn(inAside('Deal'), 'Record'));
  t.check('a note is recorded on the deal', (await poll(() => api('GET', `/api/crm/deals/${dealId}`), (r) => (r.data?.timeline ?? []).some((x) => x.title === 'Sent the proposal'))).data?.timeline?.some((x) => x.title === 'Sent the proposal'));
  await t.evaluate(clickIn(inAside('Deal'), 'Close'));
  await t.waitFor(`!!document.querySelector('[data-deal="${dealId}"]')`, 'the deal on the board', 20_000);
  // Drag it into Negotiation, as a person would.
  await t.evaluate(`(() => {
    const card = document.querySelector('[data-deal="${dealId}"]');
    const col = document.querySelector('[data-stage="${stage('Negotiation')}"]');
    const dt = new DataTransfer();
    card.dispatchEvent(new DragEvent('dragstart', { dataTransfer: dt, bubbles: true }));
    return new Promise((r) => setTimeout(() => {
      col.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
      col.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
      card.dispatchEvent(new DragEvent('dragend', { dataTransfer: dt, bubbles: true }));
      r(true);
    }, 100));
  })()`);
  t.check('a deal is dragged to another stage', (await poll(() => api('GET', `/api/crm/deals/${dealId}`), (r) => r.data?.deal?.stage_id === stage('Negotiation'))).data?.deal?.stage_id === stage('Negotiation'));
  await t.shot('crm-pipeline');
  await t.evaluate(`document.querySelector('[data-deal="${dealId}"]').click()`);
  await t.waitFor(`!!${inAside('Deal')}`, 'the deal drawer again');
  await t.evaluate(choose('aside[aria-label="Deal"] [role="combobox"][aria-label="Stage"]', String(stage('Lost'))));
  await t.waitFor(`!!document.querySelector('[role="dialog"][aria-label^="Why was"]')`, 'the lost reason');
  await t.evaluate(setValue('[role="dialog"][aria-label^="Why was"] input', 'Went with a cheaper local vendor'));
  await t.evaluate(clickIn(`document.querySelector('[role="dialog"][aria-label^="Why was"]')`, 'Mark as lost'));
  const lost = await poll(() => api('GET', `/api/crm/deals/${dealId}`), (r) => r.data?.deal?.lost_reason);
  t.check('a deal is lost with its reason', lost.data?.deal?.lost_reason === 'Went with a cheaper local vendor', js(lost.data?.deal ?? {}));
  await t.evaluate(clickIn(inAside('Deal'), 'Close'));

  // ── a new deal ────────────────────────────────────────────────────────
  await t.evaluate(clickIn(`document.querySelector('main')`, 'New deal'));
  await t.waitFor(`!!${dialog('New deal')}`, 'the new deal form');
  await t.evaluate(setValue('aside[aria-label="New deal"] input[aria-label="Deal name"]', `${co} — fleet tracking`));
  await t.evaluate(setValue('aside[aria-label="New deal"] input[aria-label="Amount"]', '1700000'));
  await t.evaluate(clickIn(dialog('New deal'), 'Create deal'));
  const nd = await poll(() => api('GET', `/api/crm/deals/board?q=${encodeURIComponent('fleet tracking')}`), (r) => (r.data?.columns ?? []).some((c) => c.deals.some((d) => d.name === `${co} — fleet tracking`)));
  const newDeal = (nd.data?.columns ?? []).flatMap((c) => c.deals).find((d) => d.name === `${co} — fleet tracking`);
  made.deals.push(newDeal?.id);
  t.check('New deal starts one in the first stage', !!newDeal && newDeal.amount === 1700000 && newDeal.stage_id === board.columns.find((c) => c.kind === 'open')?.id, js(newDeal ?? {}));

  // ── bulk reassign ─────────────────────────────────────────────────────
  const a = (await api('POST', '/api/crm/leads', { first_name: 'Bulk', last_name: `E2ECRM${tag}x`, company: `${co} Bulk A` })).data?.lead?.id;
  const b = (await api('POST', '/api/crm/leads', { first_name: 'Bulk', last_name: `E2ECRM${tag}y`, company: `${co} Bulk B` })).data?.lead?.id;
  made.leads.push(a, b);
  await t.evaluate(rail('Leads'));
  await t.evaluate(setValue('main input[aria-label="Search leads"]', `${co} Bulk`));
  await t.waitFor(`!!document.querySelector('[data-lead="${a}"]') && !!document.querySelector('[data-lead="${b}"]')`, 'the two leads', 20_000);
  await t.evaluate(`document.querySelector('[data-lead="${a}"] input[type="checkbox"]').click(); document.querySelector('[data-lead="${b}"] input[type="checkbox"]').click();`);
  await t.waitFor(`!!document.querySelector('main [role="combobox"][aria-label="Assign to"]')`, 'Assign to');
  await t.evaluate(choose('main [role="combobox"][aria-label="Assign to"]', 'none'));
  await t.waitFor(`!!${dialog('Reassign 2 leads?')}`, 'the reassign confirmation');
  await t.evaluate(clickIn(dialog('Reassign 2 leads?'), 'Reassign'));
  const both = await poll(async () => [(await api('GET', `/api/crm/leads/${a}`)).data?.lead?.owner_id, (await api('GET', `/api/crm/leads/${b}`)).data?.lead?.owner_id], (v) => v[0] === null && v[1] === null);
  t.check('two leads are reassigned together', both[0] === null && both[1] === null, js(both));
  await t.evaluate(`document.documentElement.dataset.theme = 'dark'`);
  await t.shot('crm-leads-dark');
  await t.evaluate(`document.documentElement.dataset.theme = 'light'`);

  // ── part 2: accounts, the 360, a contact and a note ───────────────────
  await t.evaluate(rail('Accounts'));
  await t.waitFor(heading('Accounts'), 'Accounts');
  await t.evaluate(clickIn(`document.querySelector('main')`, 'New account'));
  await t.waitFor(`!!${dialog('New account')}`, 'the new account form');
  await t.evaluate(setValue('[role="dialog"][aria-label="New account"] input[aria-label="Name"]', `${co} Holdings`));
  await t.evaluate(setValue('[role="dialog"][aria-label="New account"] input[aria-label="Industry"]', 'Hospitality'));
  await t.evaluate(clickIn(dialog('New account'), 'Create account'));
  const acc = await poll(() => api('GET', `/api/crm/accounts?q=${encodeURIComponent(`${co} Holdings`)}`), (r) => (r.data?.accounts ?? []).length === 1);
  const accountId = acc.data?.accounts?.[0]?.id;
  t.check('New account makes one, and opens its 360', !!accountId);
  await t.waitFor(`!!${inAside('Account')} && ${inAside('Account')}.textContent.includes(${js(`${co} Holdings`)})`, 'the account drawer', 20_000);
  await t.evaluate(choose(`aside[aria-label="Account"] [role="combobox"][aria-label="Health"]`, 'watch'));
  const health = await poll(() => api('GET', `/api/crm/accounts/${accountId}`), (r) => r.data?.account?.health === 'watch');
  t.check('health is set by a person', health.data?.account?.health === 'watch');
  await t.evaluate(clickIn(inAside('Account'), 'Add contact'));
  await t.waitFor(`!!${dialog('Add a contact')}`, 'the add contact form');
  await t.evaluate(setValue('[role="dialog"][aria-label="Add a contact"] input[aria-label="Contact name"]', 'Kamal Buyer'));
  await t.evaluate(clickIn(dialog('Add a contact'), 'Add contact'));
  const withContact = await poll(() => api('GET', `/api/crm/accounts/${accountId}`), (r) => (r.data?.contacts ?? []).some((c) => c.name === 'Kamal Buyer'));
  t.check('a contact is added under the account', (withContact.data?.contacts ?? []).some((c) => c.name === 'Kamal Buyer'));
  await t.evaluate(`[...${inAside('Account')}.querySelectorAll('[role="tab"]')].find(b => b.textContent.trim() === 'timeline').click()`);
  await t.waitFor(`!!document.querySelector('aside[aria-label="Account"] input[aria-label="Note"]')`, 'the note box');
  await t.evaluate(setValue('aside[aria-label="Account"] input[aria-label="Note"]', 'Asked for a site visit in October'));
  await t.evaluate(clickIn(inAside('Account'), 'Add'));
  const noted = await poll(() => api('GET', `/api/crm/accounts/${accountId}`), (r) => (r.data?.timeline ?? []).some((e) => (e.title ?? '').includes('site visit')));
  t.check("a note goes on the customer's file", (noted.data?.timeline ?? []).some((e) => (e.title ?? '').includes('site visit')));
  // The drawer reads itself again after each change; wait for the last of them before looking.
  await t.waitFor(`${inAside('Account')}.textContent.includes('site visit') && ${inAside('Account')}.textContent.includes('Watch')`, 'the drawer showing the note and the health', 20_000);
  await t.shot('crm-account-360');
  await t.evaluate(clickIn(inAside('Account'), 'Close'));

  // ── the price list ────────────────────────────────────────────────────
  await t.evaluate(rail('Price list'));
  await t.waitFor(heading('Price list'), 'Price list');
  await t.evaluate(clickIn(`document.querySelector('main')`, 'New product'));
  await t.waitFor(`!!${dialog('New product')}`, 'the product editor');
  await t.evaluate(setValue('[role="dialog"][aria-label="New product"] input[aria-label="Name"]', `${co} Seat`));
  await t.evaluate(setValue('[role="dialog"][aria-label="New product"] input[aria-label="Code"]', `E2E-${tag}`));
  await t.evaluate(setValue('[role="dialog"][aria-label="New product"] input[aria-label="Unit price"]', '1000'));
  await t.evaluate(setValue('[role="dialog"][aria-label="New product"] input[aria-label="Tax rate"]', '18'));
  await t.evaluate(clickIn(dialog('New product'), 'Add'));
  const prod = await poll(() => api('GET', `/api/crm/products?q=${encodeURIComponent(`${co} Seat`)}`), (r) => (r.data?.products ?? []).length === 1);
  const product = prod.data?.products?.[0];
  t.check('a product is added to the price list', !!product && product.unit_price === 1000 && product.tax_rate === 18, js(product ?? {}));

  // ── a quote: lines, totals, sent, revised ─────────────────────────────
  await t.evaluate(rail('Quotes'));
  await t.waitFor(heading('Quotes'), 'Quotes');
  await t.evaluate(clickIn(`document.querySelector('main')`, 'New quote'));
  await t.waitFor(`!!${inAside('Quote')} && !!document.querySelector('aside[aria-label="Quote"] [role="combobox"][aria-label="Account"]')`, 'the quote editor', 20_000);
  await t.evaluate(choose('aside[aria-label="Quote"] [role="combobox"][aria-label="Account"]', String(accountId)));
  await t.evaluate(choose('aside[aria-label="Quote"] [role="combobox"][aria-label="Line 1 from the price list"]', String(product?.id)));
  await t.evaluate(setValue('aside[aria-label="Quote"] input[aria-label="Line 1 quantity"]', '2'));
  await sleep(300);
  const shown = await t.evaluate(`${inAside('Quote')}.textContent`);
  t.check('the editor adds it up as the server will (2 × 1,000 + 18% tax)', shown.includes('2,360.00'), shown.slice(0, 200));
  await t.evaluate(clickIn(inAside('Quote'), 'Create quote'));
  const qs = await poll(() => api('GET', `/api/crm/quotes?q=${encodeURIComponent(`${co} Holdings`)}`), (r) => (r.data?.quotes ?? []).length >= 1);
  const quote = qs.data?.quotes?.[0];
  t.check('the quote is created as a draft with the server\'s totals', !!quote && quote.status === 'draft' && quote.total === 2360, js(quote ?? {}));
  await t.waitFor(`!!${inAside('Quote')} && ${inAside('Quote')}.textContent.includes(${js(quote?.quote_no ?? '?')})`, 'the new quote open', 20_000);
  await t.evaluate(clickIn(inAside('Quote'), 'Mark as sent'));
  await t.waitFor(`!!${dialog('Mark as sent')}`, 'the mark-as-sent dialog');
  await t.evaluate(setValue('[role="dialog"][aria-label="Mark as sent"] input[aria-label="How it was sent"]', 'emailed'));
  await t.evaluate(clickIn(dialog('Mark as sent'), 'Mark as sent'));
  const sent = await poll(() => api('GET', `/api/crm/quotes/${quote?.id}`), (r) => r.data?.quote?.status === 'sent');
  t.check('Mark as sent freezes it', sent.data?.quote?.status === 'sent' && !!sent.data?.quote?.sent_at);
  await t.waitFor(`${inAside('Quote')}.textContent.includes('The figures are fixed')`, 'the read-only quote');
  await t.shot('crm-quote-sent');
  await t.evaluate(clickIn(inAside('Quote'), 'Revise'));
  await t.waitFor(`!!${dialog('Create a revision?')}`, 'the revision dialog');
  await t.evaluate(clickIn(dialog('Create a revision?'), 'Create revision'));
  const revised = await poll(() => api('GET', `/api/crm/quotes?q=${encodeURIComponent(`${co} Holdings`)}`), (r) => (r.data?.quotes ?? []).length >= 2);
  const newest = (revised.data?.quotes ?? [])[0];
  const old = (await api('GET', `/api/crm/quotes/${quote?.id}`)).data?.quote;
  t.check('Revise makes a new draft and expires the old one', newest?.status === 'draft' && newest.id !== quote?.id && old?.status === 'expired', js({ newest: newest?.status, old: old?.status }));

  // Retiring the product now leaves the quote's lines alone.
  await t.evaluate(rail('Price list'));
  await t.waitFor(`!!document.querySelector('[data-product="${product?.id}"]')`, 'the product row', 20_000);
  await t.evaluate(clickIn(`document.querySelector('[data-product="${product?.id}"]')`, 'Retire'));
  await t.waitFor(`!!${dialog(`Retire ${co} Seat?`)}`, 'the retire confirmation');
  await t.evaluate(clickIn(dialog(`Retire ${co} Seat?`), 'Retire'));
  const retired = await poll(() => api('GET', `/api/crm/products?include_inactive=1&q=${encodeURIComponent(`${co} Seat`)}`), (r) => r.data?.products?.[0]?.active === false);
  t.check('a product is retired, not deleted', retired.data?.products?.[0]?.active === false);

  // ── lead intake: a source, a delivery ─────────────────────────────────
  await t.evaluate(rail('Lead intake'));
  await t.waitFor(heading('Lead intake'), 'Lead intake');
  await t.evaluate(clickIn(`document.querySelector('main')`, 'New source'));
  await t.waitFor(`!!${dialog('New intake source')}`, 'the source form');
  await t.evaluate(setValue('[role="dialog"][aria-label="New intake source"] input[aria-label="Source name"]', `${co} web form`));
  await t.evaluate(clickIn(dialog('New intake source'), 'Save'));
  const src = await poll(() => api('GET', '/api/crm/intake-sources'), (r) => (r.data?.sources ?? []).some((x) => x.name === `${co} web form`));
  const source = (src.data?.sources ?? []).find((x) => x.name === `${co} web form`);
  t.check('a web-form source is made, with its own address', !!source && /\/api\/crm\/intake\/[a-f0-9]{40}$/.test(source.url ?? ''), source?.url);
  const posted = await fetch(`${server}/api/crm/intake/${(source?.url ?? '').split('/').pop()}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Webform Lead', email: `webform-${tag}@probe.invalid`, company: `${co} Web` }) }).then((r) => r.json()).catch(() => ({}));
  const ev = await poll(() => api('GET', `/api/crm/intake-sources/${source?.id}/events`), (r) => (r.data?.events ?? []).length >= 1);
  t.check('a form posting to it makes a lead, and the delivery is logged', posted.ok === true && ev.data?.events?.[0]?.outcome === 'created', js({ posted, outcome: ev.data?.events?.[0]?.outcome }));
  await t.waitFor(`!!document.querySelector('[data-source="${source?.id}"]')`, 'the source card', 20_000);
  await t.evaluate(clickIn(`document.querySelector('[data-source="${source?.id}"]')`, 'Deliveries'));
  await t.waitFor(`!!${inAside('Deliveries')} && ${inAside('Deliveries')}.textContent.includes('New lead')`, 'the deliveries log', 20_000);
  await t.shot('crm-intake-deliveries');
  await t.evaluate(clickIn(inAside('Deliveries'), 'Close'));

  // ── settings and my access (looked at, not changed: they are the installation's) ──
  await t.evaluate(rail('Settings'));
  await t.waitFor(`${heading('CRM settings')} && !!document.querySelector('main input[aria-label="Quote prefix"]')`, 'CRM settings');
  t.check('CRM settings open with their values', (await t.evaluate(`document.querySelector('main input[aria-label="Quote prefix"]').value`)) !== '');
} catch (e) {
  t.check('the run finished', false, String(e?.stack ?? e));
} finally {
  for (const id of made.deals.filter(Boolean)) await api('DELETE', `/api/crm/deals/${id}`);
  for (const id of made.leads.filter(Boolean)) await api('DELETE', `/api/crm/leads/${id}`);
}
await t.finish();

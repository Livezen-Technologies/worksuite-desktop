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
  await t.waitFor(`!!document.querySelector('[data-followup="${fu.id}"]')`, 'the follow-up card', 20_000);
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
} catch (e) {
  t.check('the run finished', false, String(e?.stack ?? e));
} finally {
  for (const id of made.deals.filter(Boolean)) await api('DELETE', `/api/crm/deals/${id}`);
  for (const id of made.leads.filter(Boolean)) await api('DELETE', `/api/crm/leads/${id}`);
}
await t.finish();

// End-to-end: website chat, staffed from the desktop.
//
// A visitor opens the website widget and writes (through the public widget
// API, as the site's own script does); the app, signed in as a member of staff,
// finds them in the Website chats workspace (Chat → Website), accepts the
// chat, sets its priority, stars it, replies, and closes it. The visitor's
// poll must then carry the reply.
//
//   npm run build
//   WS_E2E_SERVER=http://localhost:8920 WS_E2E_EMAIL=… WS_E2E_PASSWORD=… \
//   WS_E2E_WIDGET_KEY=… WS_E2E_WIDGET_ORIGIN=https://e2e.example \
//   ELECTRON_RUN_AS_NODE=1 npx electron tests/e2e/website-chat.mjs
//
// Needs a widget whose allowed domains include the origin's host, with
// "require an agent online" off, and a user holding chat.widget.reply (or
// manage) with the chat app.
import { launch, sleep } from './harness.mjs';

const server = process.env.WS_E2E_SERVER;
const email = process.env.WS_E2E_EMAIL;
const password = process.env.WS_E2E_PASSWORD;
const key = process.env.WS_E2E_WIDGET_KEY;
const origin = process.env.WS_E2E_WIDGET_ORIGIN ?? 'https://e2e.example';
if (!server || !email || !password || !key) {
  console.error('Set WS_E2E_SERVER, WS_E2E_EMAIL, WS_E2E_PASSWORD and WS_E2E_WIDGET_KEY.');
  process.exit(2);
}

/** The visitor's browser: the public widget API, with the site's Origin. */
let token = '';
async function widget(method, path, body) {
  const headers = { Origin: origin, Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers['X-Widget-Token'] = token;
  const res = await fetch(`${server}/api/widget/${key}/${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

const visitorName = `Ada Visitor ${Math.floor(Math.random() * 1000)}`;
const question = 'Hello — do you ship to Kandy?';
const answer = 'Yes, we deliver to Kandy within two days.';

const t = await launch({ name: 'website-chat' });
try {
  await t.signIn(server, email, password);

  const s = await widget('POST', 'session', { url: `${origin}/pricing`, device: 'desktop', browser: 'Firefox', os: 'macOS', timezone: 'Asia/Colombo' });
  token = s.json.token ?? '';
  await widget('POST', 'identify', { name: visitorName, email: 'ada@example.com' });
  const sent = await widget('POST', 'message', { message: question });
  t.check('a visitor starts a website chat through the widget', s.status === 200 && !!token && sent.status < 300, `${s.status}/${sent.status}`);

  await t.evaluate(`[...document.querySelectorAll('nav[aria-label="Apps"] button')].find(b => b.textContent.trim().startsWith('Chat')).click()`);
  await t.waitFor(`!![...document.querySelectorAll('[role="tab"]')].find(b => b.textContent.trim().startsWith('Website'))`, 'the Website tab in Chat');
  t.check('Chat offers a Website tab to website staff', true);
  await t.evaluate(`[...document.querySelectorAll('[role="tab"]')].find(b => b.textContent.trim().startsWith('Website')).click()`);
  await t.waitFor(`${t.hasText('Website Chats')} && ${t.hasText(visitorName)}`, 'the visitor in the Website chats inbox', 30_000);
  await t.clickButton('Awaiting reply');
  await t.waitFor(t.hasText(visitorName), 'the visitor under Awaiting reply');
  await t.shot('w1-inbox');
  t.check('the workspace lists the visitor, awaiting a reply', true);

  await t.evaluate(`[...document.querySelectorAll('section[aria-label="Conversations"] button')].find(b => b.textContent.includes(${JSON.stringify(visitorName)})).click()`);
  await t.waitFor(t.hasText(question), 'the visitor\'s message in the thread');
  t.check('opening the chat shows the visitor\'s message and details', await t.evaluate(`${t.hasText('Visitor details')} && ${t.hasText('ada@example.com')} && ${t.hasText('Pages this visit')}`));
  t.check('the "joined the chat" notice is a notice, not an agent\'s message', await t.evaluate(`[...document.querySelectorAll('div')].some(d => d.className.includes('text-center') && d.textContent.includes('joined the chat'))`));
  await t.shot('w2-thread');

  const assignee = `document.querySelector('select[aria-label="Assignee"]').selectedOptions[0]?.textContent`;
  if (await t.evaluate(`!![...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Accept')`)) {
    await t.clickButton('Accept');
    await t.waitFor(`${assignee} === 'Assigned to me'`, 'the chat to become mine');
  }
  t.check('Accept makes the chat mine', (await t.evaluate(assignee)) === 'Assigned to me');

  await t.evaluate(`(() => { const s = document.querySelector('select[aria-label="Priority"]'); const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; set.call(s, 'high'); s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  // The header's controls are disabled while a change saves.
  await t.waitFor(`document.querySelector('select[aria-label="Priority"]').value === 'high' && !document.querySelector('select[aria-label="Priority"]').disabled`, 'the priority saved');
  await t.clickButton('Star');
  await t.waitFor(t.hasText('★ Starred'), 'the star');
  await t.shot('w2b-priority-star');
  t.check('priority and star are set from the thread header', true);

  await t.fill('Message', answer);
  await t.clickButton('Send message');
  await t.waitFor(t.hasText(answer), 'the reply in the thread');
  await t.shot('w3-replied');
  t.check('the reply appears in the thread', true);

  // The live dashboard: the visitor is on the site, reading /pricing.
  await t.evaluate(`[...document.querySelectorAll('nav[aria-label="Website chats"] button')].find(b => b.textContent.startsWith('Live dashboard')).click()`);
  await t.waitFor(`${t.hasText('Visitors online')} && ${t.hasText('Median first reply')} && ${t.hasText(visitorName)}`, 'the live dashboard', 20_000);
  await t.evaluate(`[...document.querySelectorAll('main button')].find(b => b.textContent.includes(${JSON.stringify(visitorName)})).click()`);
  await t.waitFor(`${t.hasText('Pages this visit')} && ${t.hasText('Open the chat')}`, 'the visitor card');
  await t.shot('w3b-live');
  t.check('the live dashboard shows the visitor, what they read, and their open chat', true);
  await t.clickButton('Open the chat');
  await t.waitFor(`!!document.querySelector('select[aria-label="Priority"]')`, 'back in the thread');

  let seen = false;
  for (let i = 0; i < 10 && !seen; i++) {
    const p = await widget('GET', 'poll?after=0');
    seen = (p.json.messages ?? []).some((m) => m.from === 'agent' && m.body === answer);
    if (!seen) await sleep(500);
  }
  t.check('the visitor receives the reply', seen);

  await t.clickButton('Close');
  await t.waitFor(t.hasText('This chat is closed'), 'the closed chat');
  await t.shot('w4-closed');
  t.check('closing the chat closes it for everyone', true);
} catch (e) {
  t.check('website chat run', false, e.message);
  try {
    await t.shot('wz-failure');
  } catch {
    /* no page */
  }
} finally {
  await t.finish();
}

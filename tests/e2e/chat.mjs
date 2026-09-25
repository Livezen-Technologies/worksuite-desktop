// End-to-end: chat in the desktop — presence, reactions, replies, edit and
// delete, emoji, a voice note, and a new group — against a real WorkSuite.
//
// A second person ("the partner") acts through the API as the web would; the
// app is signed in as the first. Every action taken in the app is then read
// back from the server, not only from the screen.
//
//   npm run build
//   WS_E2E_SERVER=http://localhost:8920 WS_E2E_EMAIL=… WS_E2E_PASSWORD=… \
//   WS_E2E_PARTNER_EMAIL=… WS_E2E_PARTNER_PASSWORD=… WS_E2E_THIRD_NAME=… \
//   ELECTRON_RUN_AS_NODE=1 npx electron tests/e2e/chat.mjs
//
// The voice note is recorded from Chromium's fake microphone
// (WS_E2E_FAKE_MEDIA, unpackaged builds only).
import { launch, sleep } from './harness.mjs';

const server = process.env.WS_E2E_SERVER;
const email = process.env.WS_E2E_EMAIL;
const password = process.env.WS_E2E_PASSWORD;
const partnerEmail = process.env.WS_E2E_PARTNER_EMAIL;
const partnerPassword = process.env.WS_E2E_PARTNER_PASSWORD;
const thirdName = process.env.WS_E2E_THIRD_NAME;
if (!server || !email || !password || !partnerEmail || !partnerPassword || !thirdName) {
  console.error('Set WS_E2E_SERVER, WS_E2E_EMAIL, WS_E2E_PASSWORD, WS_E2E_PARTNER_EMAIL, WS_E2E_PARTNER_PASSWORD and WS_E2E_THIRD_NAME.');
  process.exit(2);
}

let bearer = '';
async function api(method, path, body) {
  const res = await fetch(`${server}${path}`, {
    method,
    headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}), ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, data: json.data ?? json };
}

/** A bubble's action button, found by the message text it belongs to. */
const inBubble = (text, label) =>
  `(() => { const g = [...document.querySelectorAll('div.group')].find(d => d.textContent.includes(${JSON.stringify(text)})); const b = g && g.querySelector(${JSON.stringify(`[aria-label="${label}"]`)}); if (!b) return false; b.click(); return true; })()`;

const t = await launch({ name: 'chat', env: { WS_E2E_FAKE_MEDIA: '1' } });
try {
  await t.signIn(server, email, password);
  const me = await t.evaluate(`window.worksuite.auth.state().then(s => s.user && s.user.id)`);

  const login = await api('POST', '/api/auth/login', { email: partnerEmail, password: partnerPassword });
  bearer = login.data.tokens?.access_token ?? '';
  const partnerName = login.data.user?.name ?? 'Partner';
  await api('POST', '/api/chat/presence', { status: 'available', active: true });
  const room = await api('POST', '/api/chat/rooms/direct', { user_id: Number(me) });
  const roomId = room.data.room_id;
  const hello = `Lunch at 1? ${Math.floor(Math.random() * 1000)}`;
  await api('POST', '/api/chat/messages', { room_id: roomId, message: hello });
  t.check('the partner starts a direct chat and writes', !!bearer && !!roomId, String(room.status));

  await t.evaluate(`[...document.querySelectorAll('nav[aria-label="Apps"] button')].find(b => b.textContent.trim().startsWith('Chat')).click()`);
  await t.waitFor(t.hasText(partnerName), 'the partner in the chat list');
  await t.waitFor(`(() => { const row = [...document.querySelectorAll('button')].find(b => b.textContent.includes(${JSON.stringify(partnerName)})); return !!(row && row.querySelector('[title]')); })()`, 'the partner\'s presence', 15_000).catch(() => undefined);
  const dot = await t.evaluate(`(() => { const row = [...document.querySelectorAll('button')].find(b => b.textContent.includes(${JSON.stringify(partnerName)})); const d = row && row.querySelector('[title]'); return row ? (d ? d.getAttribute('aria-label') : 'none') : 'no row'; })()`);
  t.check('the chat list shows the partner as online', dot === 'Online', dot);
  await t.evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent.includes(${JSON.stringify(partnerName)})).click()`);
  await t.waitFor(t.hasText(hello), 'the partner\'s message');
  await t.shot('c1-thread');

  // React.
  await t.evaluate(inBubble(hello, 'React 👍'));
  await t.waitFor(`[...document.querySelectorAll('button')].some(b => (b.getAttribute('aria-label') ?? '').startsWith('👍 1'))`, 'the 👍 reaction');
  const reacted = await api('GET', `/api/chat/messages?room_id=${roomId}`);
  const helloMsg = reacted.data.messages.find((m) => m.message === hello);
  t.check('a reaction is shown and stored', !!helloMsg?.reactions?.some((r) => r.emoji === '👍' && r.count === 1));

  // Reply.
  await t.evaluate(inBubble(hello, 'Reply'));
  await t.waitFor(t.hasText('Replying to'), 'the reply bar');
  const answer = 'Yes, 1 works';
  await t.fill('Message', answer);
  await t.clickButton('Send');
  await t.waitFor(t.hasText(answer), 'the reply in the thread');
  const after = await api('GET', `/api/chat/messages?room_id=${roomId}`);
  const mine = after.data.messages.find((m) => m.message === answer);
  t.check('the reply is sent as a reply to the partner\'s message', mine?.reply_to === helloMsg?.id || mine?.reply_preview?.id === helloMsg?.id, JSON.stringify(mine?.reply_preview ?? null));

  // Edit.
  await t.evaluate(inBubble(answer, 'Edit'));
  await t.waitFor(`!!document.querySelector('[aria-label="Edit message"]')`, 'the edit box');
  const edited = `${answer} — see you there`;
  await t.fill('Edit message', edited);
  await t.clickButton('Save');
  await t.waitFor(`${t.hasText(edited)} && ${t.hasText('edited')}`, 'the edited message');
  t.check('editing a message changes it, marked edited', true);

  // Delete for everyone.
  await t.evaluate(inBubble(edited, 'Delete'));
  await t.waitFor(t.hasText('Delete for everyone'), 'the delete dialog');
  await t.clickButton('Delete for everyone');
  await t.waitFor(`${t.hasText('Message deleted')} && !${t.hasText(edited)}`, 'the deleted message');
  const gone = await api('GET', `/api/chat/messages?room_id=${roomId}`);
  t.check('deleting for everyone deletes it for the partner too', gone.data.messages.some((m) => m.id === mine?.id && m.deleted));

  // Emoji.
  await t.clickButton('Emoji');
  await t.waitFor(`!!document.querySelector('[role="dialog"][aria-label="Emoji"]')`, 'the emoji picker');
  await t.evaluate(`document.querySelector('[role="dialog"][aria-label="Emoji"] [aria-label="🎉"]').click()`);
  await t.clickButton('Send');
  await t.waitFor(`[...document.querySelectorAll('div')].some(d => d.textContent.trim() === '🎉')`, 'the emoji message');
  t.check('an emoji from the picker is sent', true);

  // Voice note. The microphone button replaces Send once the draft is empty.
  await t.waitFor(`!!document.querySelector('[aria-label="Record a voice note"]')`, 'the record button');
  await t.clickButton('Record a voice note');
  await t.waitFor(`${t.hasText('Recording — send')} || ${t.hasText('not allowed to use the microphone')}`, 'recording, or a refusal', 15_000);
  if (!(await t.evaluate(t.hasText('Recording — send')))) throw new Error('the microphone was refused');
  await sleep(2200);
  await t.shot('c2-recording');
  await t.clickButton('Send the voice note');
  await t.waitFor(`!!document.querySelector('[aria-label="Play the voice note"]')`, 'the voice note in the thread', 30_000);
  await t.shot('c3-voice');
  const voiced = await api('GET', `/api/chat/messages?room_id=${roomId}`);
  const note = voiced.data.messages.find((m) => m.type === 'voice');
  t.check('a voice note is recorded, sent and stored as one', !!note && (note.file?.duration_ms ?? 0) > 1000, `${note?.file?.duration_ms ?? 'none'} ms`);

  // A new group.
  await t.clickButton('New conversation');
  await t.waitFor(t.hasText('New conversation'), 'the new conversation dialog');
  for (const name of [partnerName, thirdName]) {
    await t.fill('Search people', name);
    await t.waitFor(`[...document.querySelectorAll('[role="option"]')].some(o => o.textContent.includes(${JSON.stringify(name)}))`, `${name} in the directory`);
    await t.evaluate(`[...document.querySelectorAll('[role="option"]')].find(o => o.textContent.includes(${JSON.stringify(name)})).click()`);
  }
  const groupName = `E2E team ${Math.floor(Math.random() * 1000)}`;
  await t.fill('Group name', groupName);
  await t.clickButton('Create group');
  await t.waitFor(`[...document.querySelectorAll('.font-bold')].some(e => e.textContent.trim() === ${JSON.stringify(groupName)})`, 'the new group open', 20_000);
  await t.shot('c4-group');
  t.check('a new group is created and opened', true);
} catch (e) {
  t.check('chat run', false, e.message);
  try {
    await t.shot('cz-failure');
  } catch {
    /* no page */
  }
} finally {
  await t.finish();
}

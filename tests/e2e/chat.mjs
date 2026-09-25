// End-to-end: chat in the desktop — presence, reactions, replies, edit and
// delete in the composer, emoji search, the attach menu, files in the tray
// with a caption, urgent, typing, a voice message, a new group and an
// @mention — against a real WorkSuite.
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

/** A bubble's action button (by label or text), found by the message text it belongs to. */
const inBubble = (text, label) =>
  `(() => { const g = [...document.querySelectorAll('div.group')].find(d => d.textContent.includes(${JSON.stringify(text)})); const b = g && [...g.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === ${JSON.stringify(label)} || b.textContent.trim() === ${JSON.stringify(label)}); if (!b) return false; b.click(); return true; })()`;

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

  // Star and pin, from the message's toolbar.
  await t.evaluate(inBubble(hello, 'Star'));
  await t.waitFor(t.hasText('★ starred'), 'the starred mark');
  await t.evaluate(inBubble(hello, 'Pin'));
  await t.waitFor(`[...document.querySelectorAll('b')].some(b => b.textContent.trim() === 'Pinned')`, 'the pinned banner');
  const pins = await api('GET', `/api/chat/rooms/${roomId}/pins`);
  t.check('starring marks the message; pinning shows it above the thread for both', (pins.data.messages ?? []).some((m) => m.id === helloMsg?.id));
  await t.shot('c1b-pinned');

  // Edit, from More: the message opens in the composer.
  await t.evaluate(inBubble(answer, 'More ⋯'));
  await t.clickButton('Edit');
  await t.waitFor(t.hasText('Editing message'), 'the editing bar');
  const inComposer = await t.evaluate(`document.querySelector('textarea[aria-label="Message"]').value`);
  const attachHidden = await t.evaluate(`!document.querySelector('[aria-label="Attach"]')`);
  await t.shot('c1d-editing');
  const edited = `${answer} — see you there`;
  await t.fill('Message', edited);
  await t.clickButton('Save the change');
  await t.waitFor(`${t.hasText(edited)} && ${t.hasText('edited')} && !${t.hasText('Editing message')}`, 'the edited message');
  t.check('Edit opens the message in the composer (attach steps aside); saving changes it, marked edited', inComposer === answer && attachHidden, JSON.stringify(inComposer));

  // Delete for everyone (the dialog's default choice).
  await t.evaluate(inBubble(edited, 'More ⋯'));
  await t.clickButton('Delete…');
  await t.waitFor(t.hasText('Delete for everyone'), 'the delete dialog');
  await t.shot('c1c-delete');
  await t.clickButton('Delete');
  await t.waitFor(`${t.hasText('Message deleted')} && !${t.hasText(edited)}`, 'the deleted message');
  const gone = await api('GET', `/api/chat/messages?room_id=${roomId}`);
  t.check('deleting for everyone deletes it for the partner too', gone.data.messages.some((m) => m.id === mine?.id && m.deleted));

  // The send button waits for something to send.
  const idle = await t.evaluate(`document.querySelector('button[aria-label="Send"]').disabled`);
  t.check('with nothing written, Send is disabled', idle === true);

  // Emoji, found by searching.
  await t.clickButton('Emoji');
  await t.waitFor(`!!document.querySelector('[role="dialog"][aria-label="Emoji"]')`, 'the emoji picker');
  const frequent = await t.evaluate(t.hasText('FREQUENTLY USED'));
  await t.fill('Search emoji', 'party');
  await t.waitFor(`!!document.querySelector('[role="dialog"][aria-label="Emoji"] [aria-label="🎉"]') && !document.querySelector('[role="dialog"][aria-label="Emoji"] [aria-label="👍"]')`, 'the search result');
  await t.shot('c1e-emoji');
  await t.evaluate(`document.querySelector('[role="dialog"][aria-label="Emoji"] [aria-label="🎉"]').click()`);
  await t.clickButton('Send');
  await t.waitFor(`[...document.querySelectorAll('div')].some(d => d.textContent.trim() === '🎉')`, 'the emoji message');
  t.check('the emoji picker shows frequently used, searches by name, and the pick is sent', frequent === true);

  // The attach menu's eight choices.
  await t.clickButton('Attach');
  await t.waitFor(`!!document.querySelector('[role="menu"][aria-label="Attach"]')`, 'the attach menu');
  const choices = await t.evaluate(`[...document.querySelectorAll('[role="menu"][aria-label="Attach"] [role="menuitem"] b')].map(b => b.textContent.trim())`);
  await t.shot('c1f-attach');
  t.check('the paperclip offers the eight choices', JSON.stringify(choices) === JSON.stringify(['Document', 'Image', 'Video', 'Audio', 'Any file', 'From Drive', 'Camera / Photo', 'Voice message']), JSON.stringify(choices));
  await t.evaluate(`[...document.querySelectorAll('[role="menuitem"]')].find(b => b.textContent.includes('From Drive')).click()`);
  await t.waitFor(`${t.hasText('Share from Drive')} && ${t.hasText('My Drive')}`, 'the Drive picker');
  await t.shot('c1g-drive');
  await t.clickButton('Cancel');
  t.check('From Drive opens the Drive picker', true);

  // A pasted image waits in the tray, and goes with its caption on Send.
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  await t.evaluate(`(() => {
    const bytes = Uint8Array.from(atob(${JSON.stringify(png)}), c => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], 'e2e-dot.png', { type: 'image/png' }));
    const el = document.querySelector('textarea[aria-label="Message"]');
    el.focus();
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    return true;
  })()`);
  await t.waitFor(`${t.hasText('Ready to send')} && ${t.hasText('e2e-dot.png')}`, 'the file in the tray');
  const placeholder = await t.evaluate(`document.querySelector('textarea[aria-label="Message"]').placeholder`);
  const caption = `The dot ${Math.floor(Math.random() * 1000)}`;
  await t.fill('Message', caption);
  await t.shot('c1h-tray');
  await t.clickButton('Send');
  await t.waitFor(`!${t.hasText('Ready to send')} && ${t.hasText(caption)}`, 'the file sent with its caption', 30_000);
  const filed = await api('GET', `/api/chat/messages?room_id=${roomId}`);
  const withFile = filed.data.messages.find((m) => m.file?.filename === 'e2e-dot.png' && m.message === caption);
  t.check('a pasted image waits in the tray ("Add a caption…") and is sent with its caption', placeholder === 'Add a caption…' && withFile?.message === caption, JSON.stringify({ placeholder, message: withFile?.message ?? null }));

  // Urgent, when this person may send it.
  if (await t.evaluate(`!!document.querySelector('button[aria-label="Urgent"]')`)) {
    await t.clickButton('Urgent');
    await t.waitFor(t.hasText('Urgent: reaches people who only want priority notifications'), 'the urgent hint');
    const loud = `Server down ${Math.floor(Math.random() * 1000)}`;
    await t.fill('Message', loud);
    await t.shot('c1i-urgent');
    await t.clickButton('Send');
    await t.waitFor(t.hasText(loud), 'the urgent message');
    const urgentMsgs = await api('GET', `/api/chat/messages?room_id=${roomId}`);
    const off = await t.evaluate(`document.querySelector('button[aria-label="Urgent"]').getAttribute('aria-pressed')`);
    t.check('an urgent message is stored as urgent, and urgent turns itself off after', urgentMsgs.data.messages.find((m) => m.message === loud)?.urgent === true && off === 'false');
  } else {
    t.check('urgent is offered only with the permission (this account has none)', true);
  }

  // The partner typing shows above the composer. Typing is sent only over
  // realtime, so without it (a local server usually has none) it cannot show.
  if (await t.evaluate(t.hasText('Realtime off'))) {
    t.skip('the partner typing is shown above the composer', 'realtime is off on this server; typing is realtime-only');
  } else {
    await api('POST', '/api/chat/typing', { room_id: roomId, state: 'start' });
    const typed = await t.waitFor(t.hasText(`${partnerName} is typing…`), 'the typing line', 10_000).then(() => true, () => false);
    await t.shot('c1j-typing');
    await api('POST', '/api/chat/typing', { room_id: roomId, state: 'stop' });
    t.check('the partner typing is shown above the composer', typed);
  }

  // Voice message, recorded in place: stop, then send.
  await t.clickButton('Attach');
  await t.evaluate(`[...document.querySelectorAll('[role="menuitem"]')].find(b => b.textContent.includes('Voice message')).click()`);
  await t.waitFor(`!!document.querySelector('[aria-label="Stop recording"]') || ${t.hasText('not allowed to use the microphone')}`, 'recording, or a refusal', 15_000);
  if (!(await t.evaluate(`!!document.querySelector('[aria-label="Stop recording"]')`))) throw new Error('the microphone was refused');
  await sleep(2200);
  await t.shot('c2-recording');
  const loudest = await t.evaluate(`Math.max(0, ...[...document.querySelectorAll('[role="group"][aria-label="Recording a voice message"] [data-level]')].map(b => Number(b.dataset.level)))`);
  t.check('the level meter moves with the microphone while recording', loudest > 0.12, `loudest ${loudest}`);
  await t.clickButton('Stop recording');
  await t.waitFor(`!document.querySelector('[aria-label="Stop recording"]') && !document.querySelector('[aria-label="Send the voice message"]').disabled`, 'the stopped recording');
  await t.clickButton('Send the voice message');
  await t.waitFor(`!!document.querySelector('[aria-label="Play the voice note"]')`, 'the voice note in the thread', 30_000);
  await t.shot('c3-voice');
  const voiced = await api('GET', `/api/chat/messages?room_id=${roomId}`);
  const note = voiced.data.messages.find((m) => m.type === 'voice');
  t.check('a voice note is recorded, sent and stored as one', !!note && (note.file?.duration_ms ?? 0) > 1000, `${note?.file?.duration_ms ?? 'none'} ms`);

  // A new group.
  await t.clickButton('New conversation');
  await t.waitFor(t.hasText('New conversation'), 'the new conversation dialog');
  await t.evaluate(`[...document.querySelectorAll('[role="radio"]')].find(b => b.textContent.trim() === 'Group').click()`);
  await t.waitFor(`!!document.querySelector('[aria-label="Group name"]')`, 'the group form');
  for (const name of [partnerName, thirdName]) {
    await t.fill('Search people', name);
    await t.waitFor(`!!document.querySelector(${JSON.stringify(`input[type="checkbox"][aria-label="${name}"]`)})`, `${name} in the directory`);
    await t.evaluate(`document.querySelector(${JSON.stringify(`input[type="checkbox"][aria-label="${name}"]`)}).click()`);
  }
  await t.shot('c3b-new-group');
  const groupName = `E2E team ${Math.floor(Math.random() * 1000)}`;
  await t.fill('Group name', groupName);
  await t.clickButton('Create group');
  await t.waitFor(`[...document.querySelectorAll('.font-bold')].some(e => e.textContent.trim() === ${JSON.stringify(groupName)})`, 'the new group open', 20_000);
  await t.shot('c4-group');
  t.check('a new group is created and opened', true);

  // An @mention, picked from the list, is sent as a mention.
  await t.fill('Message', `Hi @${partnerName.split(' ')[0].slice(0, 3)}`);
  await t.waitFor(`!!document.querySelector('[role="listbox"][aria-label="Mention someone"] [role="option"]')`, 'the mention list');
  const picker = await t.evaluate(`document.querySelector('[role="listbox"][aria-label="Mention someone"]').textContent`);
  await t.shot('c4b-mention-list');
  t.check('the mention list shows the people in this chat with their presence', picker.includes('PEOPLE IN THIS CHAT') && picker.includes(partnerName) && /online|away|offline|busy/.test(picker) && picker.includes('Enter to pick'), picker.slice(0, 160));
  await t.evaluate(`[...document.querySelectorAll('[role="listbox"] [role="option"]')].find(o => o.textContent.includes(${JSON.stringify(partnerName)})).click()`);
  await t.clickButton('Send');
  await t.waitFor(t.hasText(`Hi @${partnerName}`), 'the mention in the thread');
  const groups = await api('GET', '/api/chat/rooms');
  const g = (groups.data.rooms ?? []).find((r) => r.name === groupName);
  const said = g ? await api('GET', `/api/chat/messages?room_id=${g.id}`) : { data: { messages: [] } };
  const withMention = (said.data.messages ?? []).find((m) => (m.message ?? '').startsWith('Hi @'));
  t.check('the mention is stored with the message', !!withMention?.mentions?.some((x) => x.type === 'user' && x.name === partnerName), JSON.stringify(withMention?.mentions ?? null));
  await t.shot('c5-mention');

  // The drawer's composer: the same controls, compact, over another screen.
  await t.evaluate(`[...document.querySelectorAll('nav[aria-label="Apps"] button')].find(b => b.textContent.trim().startsWith('Home')).click()`);
  await t.evaluate(`document.querySelector('header button[title="Chat"]').click()`);
  await t.waitFor(`!!document.querySelector('aside[aria-label="Chat drawer"]')`, 'the chat drawer');
  await t.waitFor(`[...document.querySelectorAll('aside[aria-label="Chat drawer"] button')].some(b => b.textContent.includes(${JSON.stringify(partnerName)}))`, 'the partner in the drawer');
  await t.evaluate(`[...document.querySelectorAll('aside[aria-label="Chat drawer"] button')].find(b => b.textContent.includes(${JSON.stringify(partnerName)}) && !b.textContent.includes('E2E team')).click()`);
  await t.waitFor(`!!document.querySelector('aside[aria-label="Chat drawer"] textarea[aria-label="Message"]')`, 'the drawer composer', 20_000);
  const drawer = await t.evaluate(`(() => {
    const a = document.querySelector('aside[aria-label="Chat drawer"]');
    const has = (l) => !!a.querySelector('button[aria-label="' + l + '"]');
    return { attach: has('Attach'), emoji: has('Emoji'), send: has('Send'), urgent: has('Urgent'), hint: a.innerText.includes('Enter to send'), height: a.querySelector('button[aria-label="Send"]').getBoundingClientRect().height };
  })()`);
  const fromDrawer = `From the drawer ${Math.floor(Math.random() * 1000)}`;
  await t.evaluate(`(() => { const el = document.querySelector('aside[aria-label="Chat drawer"] textarea[aria-label="Message"]'); const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; set.call(el, ${JSON.stringify(fromDrawer)}); el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  await t.shot('c6-drawer-composer');
  await t.evaluate(`document.querySelector('aside[aria-label="Chat drawer"] button[aria-label="Send"]').click()`);
  await t.waitFor(`document.querySelector('aside[aria-label="Chat drawer"]').innerText.includes(${JSON.stringify(fromDrawer)})`, 'the drawer message', 20_000);
  const drawnSent = await api('GET', `/api/chat/messages?room_id=${roomId}`);
  t.check('the drawer has the same composer, compact (no hints), and sends', drawer.attach && drawer.emoji && drawer.send && drawer.urgent && !drawer.hint && drawer.height <= 30 && drawnSent.data.messages.some((m) => m.message === fromDrawer), JSON.stringify(drawer));
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

// End-to-end: chat calls in the desktop — placing one, an incoming ring with
// Decline and Reply with message, and a voice message when nobody can answer —
// against a real WorkSuite.
//
// Without a media server the call cannot carry sound, so run the server with
// a placeholder LiveKit address: everything up to the media connection is
// real (the ring, the call record, the window, hanging up), and the media
// step fails the way an unreachable media server does.
//
//   env 'livekit.url=wss://lk.invalid' 'livekit.key=…' 'livekit.secret=…' php -S localhost:8920 …
//   npm run build
//   WS_E2E_SERVER=http://localhost:8920 WS_E2E_EMAIL=… WS_E2E_PASSWORD=… \
//   WS_E2E_PARTNER_EMAIL=… WS_E2E_PARTNER_PASSWORD=… \
//   ELECTRON_RUN_AS_NODE=1 npx electron tests/e2e/calls.mjs
import { launch, sleep } from './harness.mjs';

const server = process.env.WS_E2E_SERVER;
const email = process.env.WS_E2E_EMAIL;
const password = process.env.WS_E2E_PASSWORD;
const partnerEmail = process.env.WS_E2E_PARTNER_EMAIL;
const partnerPassword = process.env.WS_E2E_PARTNER_PASSWORD;
if (!server || !email || !password || !partnerEmail || !partnerPassword) {
  console.error('Set WS_E2E_SERVER, WS_E2E_EMAIL, WS_E2E_PASSWORD, WS_E2E_PARTNER_EMAIL and WS_E2E_PARTNER_PASSWORD.');
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

const t = await launch({ name: 'calls', env: { WS_E2E_FAKE_MEDIA: '1' } });
try {
  await t.signIn(server, email, password);
  const me = await t.evaluate(`window.worksuite.auth.state().then(s => s.user && s.user.id)`);
  const boot = await t.evaluate(`window.worksuite.session.bootstrap().then(b => b && b.mediaServers)`);
  t.check('the server announces its media server to the desktop', Array.isArray(boot) && boot.length === 1, JSON.stringify(boot));

  const login = await api('POST', '/api/auth/login', { email: partnerEmail, password: partnerPassword });
  bearer = login.data.tokens?.access_token ?? '';
  const partnerName = login.data.user?.name ?? 'Partner';
  await api('POST', '/api/chat/presence', { status: 'available', active: true });
  const room = await api('POST', '/api/chat/rooms/direct', { user_id: Number(me) });
  const roomId = room.data.room_id;
  t.check('the partner is online, with a direct chat', !!bearer && !!roomId);

  // ── Placing a call ────────────────────────────────────────────────────
  await t.evaluate(`[...document.querySelectorAll('nav[aria-label="Apps"] button')].find(b => b.textContent.trim().startsWith('Chat')).click()`);
  await t.waitFor(t.hasText(partnerName), 'the partner in the chat list');
  await t.evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent.includes(${JSON.stringify(partnerName)})).click()`);
  await t.waitFor(`!!document.querySelector('[aria-label="Start a voice call"]')`, 'the call buttons');
  await t.clickButton('Start a voice call');
  const callWin = await t.attach((u) => u.includes('/window/call?'), 'the call window');
  await callWin.waitFor(`${callWin.hasText('Could not connect the call')} || ${callWin.hasText('Ringing')}`, 'the call to be placed', 30_000);
  await callWin.shot('k1-call-window');
  const history = await api('GET', '/api/chat/calls/history');
  const placed = (history.data ?? []).find((c) => c.room_id === roomId);
  t.check('the call is placed on the server and rings the partner', !!placed && placed.direction === 'incoming', JSON.stringify(placed ?? null));
  t.check('an unreachable media server is said so, with a way out', await callWin.evaluate(`${callWin.hasText('Could not connect the call')} && ${callWin.hasText('End the call')}`));
  let ended = null;
  for (let i = 0; i < 20 && ended?.status !== 'ended'; i++) {
    ended = (await api('GET', `/api/chat/calls/${placed?.uuid}`)).data;
    if (ended?.status !== 'ended') await sleep(250);
  }
  t.check('leaving hangs up on the server', ended?.status === 'ended', `${ended?.status}/${ended?.outcome}`);
  await callWin.clickButton('End the call');
  await sleep(800);
  t.check('the call window closes', !(await t.windowOpen((u) => u.includes('/window/call?'))));

  // ── An incoming call, declined ────────────────────────────────────────
  const rung = await api('POST', '/api/chat/calls', { room_id: roomId, mode: 'video' });
  t.check('the partner calls (video)', rung.status === 200 && !!rung.data.uuid, String(rung.status));
  const ring = await t.attach((u) => u.includes('/window/ring?'), 'the ring window', 20_000);
  await ring.waitFor(`${ring.hasText(partnerName)} && ${ring.hasText('Video call')}`, 'the caller on the ring');
  await ring.shot('k2-ring');
  t.check('the ring shows who is calling, and how', true);
  await ring.clickButton('Decline');
  let declined = null;
  for (let i = 0; i < 20 && declined?.status !== 'ended'; i++) {
    declined = (await api('GET', `/api/chat/calls/${rung.data.uuid}`)).data;
    if (declined?.status !== 'ended') await sleep(250);
  }
  t.check('Decline ends the call as declined', declined?.status === 'ended' && declined?.outcome === 'declined', `${declined?.status}/${declined?.outcome}`);
  await sleep(800);
  t.check('the ring window closes', !(await t.windowOpen((u) => u.includes('/window/ring?'))));

  // ── Another, answered with a message ──────────────────────────────────
  const again = await api('POST', '/api/chat/calls', { room_id: roomId, mode: 'audio' });
  const ring2 = await t.attach((u) => u.includes('/window/ring?') && u.includes(again.data.uuid), 'the second ring', 20_000);
  await ring2.waitFor(ring2.hasText('Voice call'), 'the voice ring');
  await ring2.clickButton('Reply with message…');
  await ring2.waitFor(ring2.hasText("Can't talk now"), 'the quick replies');
  await ring2.shot('k3-reply');
  await ring2.evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent.startsWith("Can't talk now")).click()`);
  let said = false;
  for (let i = 0; i < 20 && !said; i++) {
    const msgs = await api('GET', `/api/chat/messages?room_id=${roomId}`);
    said = (msgs.data.messages ?? []).some((m) => (m.message ?? '').startsWith("Can't talk now"));
    if (!said) await sleep(250);
  }
  const after = (await api('GET', `/api/chat/calls/${again.data.uuid}`)).data;
  t.check('Reply with message sends it to the conversation and declines', said && after?.status === 'ended', `${said}/${after?.status}`);

  // ── Nobody to answer: a voice message ─────────────────────────────────
  await api('POST', '/api/chat/presence', { status: 'offline', active: false });
  await t.clickButton('Start a voice call');
  const vm = await t.attach((u) => u.includes('/window/call?'), 'the call window again');
  await vm.waitFor(`${vm.hasText('Not available right now')} || ${vm.hasText('On another call')} || ${vm.hasText('Could not connect')}`, 'the outcome', 30_000);
  if (await vm.evaluate(vm.hasText('Leave a voice message'))) {
    await vm.shot('k4-unreachable');
    await vm.clickButton('Leave a voice message');
    await vm.waitFor(vm.hasText('Recording — send'), 'recording', 15_000);
    await sleep(2200);
    await vm.clickButton('Send the voice note');
    await vm.waitFor(vm.hasText('Your voice message was sent'), 'the voice message sent', 20_000);
    const msgs = await api('GET', `/api/chat/messages?room_id=${roomId}`);
    const voice = (msgs.data.messages ?? []).filter((m) => m.type === 'voice').pop();
    t.check('nobody can answer, so a voice message is left in the conversation', !!voice && (voice.file?.duration_ms ?? 0) >= 1000, `${voice?.file?.duration_ms ?? 'none'} ms`);
  } else {
    t.check('nobody can answer, so a voice message is offered', false, await vm.evaluate(`document.body.innerText.slice(0, 200)`));
  }
  await vm.clickButton('Close');
  await api('POST', '/api/chat/presence', { status: 'available', active: true });
} catch (e) {
  t.check('calls run', false, e.message);
  try {
    await t.shot('kz-failure');
  } catch {
    /* no page */
  }
} finally {
  await t.finish();
}

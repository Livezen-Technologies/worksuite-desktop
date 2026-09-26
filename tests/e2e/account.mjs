// End-to-end: My account — the account menu from the title bar; My profile;
// Profile settings (the phone saved and put back); a photo cropped and saved,
// an avatar made, the photo used again, the avatar deleted, the picture
// removed and who sees it changed; two-factor turned on with a real code,
// new backup codes, the password changed and this computer kept signed in
// with a code, two-factor off, the password put back; other sessions signed
// out; notification and regional preferences changed and put back; My
// access. Checked against the server; screenshots in light and dark.
//
//   npm run build
//   WS_E2E_SERVER=… WS_E2E_EMAIL=… WS_E2E_PASSWORD=… ELECTRON_RUN_AS_NODE=1 npx electron tests/e2e/account.mjs
import { createHmac } from 'node:crypto';
import { choose, launch, sleep } from './harness.mjs';

const server = process.env.WS_E2E_SERVER;
const email = process.env.WS_E2E_EMAIL;
const original = process.env.WS_E2E_PASSWORD;
if (!server || !email || !original) {
  console.error('Set WS_E2E_SERVER, WS_E2E_EMAIL and WS_E2E_PASSWORD.');
  process.exit(2);
}

let password = original;
let token = '';
async function login() {
  const r = await fetch(`${server}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ email, password }) });
  const j = await r.json();
  token = j.data?.tokens?.access_token ?? '';
  return j.data ?? {};
}
/** The test's own session, signed in again when the app signs it out (Sign out others, a password change). */
async function api(method, path, body, again = true) {
  const res = await fetch(`${server}${path}`, { method, headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}), Authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined });
  if (res.status === 401 && again) {
    const d = await login();
    if (d.mfa_required) return { status: 401, data: null, message: 'two-factor is on' };
    return api(method, path, body, false);
  }
  const json = await res.json().catch(() => ({}));
  return { status: res.status, data: json.data ?? json, message: json.message };
}

// RFC 6238, for the authenticator app this test pretends to be.
function base32(s) {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of s.replace(/[\s=]/g, '').toUpperCase()) bits += A.indexOf(c).toString(2).padStart(5, '0');
  const out = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(out);
}
const step = () => Math.floor(Date.now() / 30_000);
function totp(secret, at = step()) {
  const b = Buffer.alloc(8);
  b.writeBigUInt64BE(BigInt(at));
  const h = createHmac('sha1', base32(secret)).update(b).digest();
  const o = h[h.length - 1] & 15;
  return String((((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1_000_000).padStart(6, '0');
}
let usedStep = 0;
/** A code the server has not seen yet: it refuses one from a step already used. */
async function freshCode(secret) {
  while (step() <= usedStep) await sleep(1000);
  usedStep = step();
  return totp(secret, usedStep);
}

const js = (v) => JSON.stringify(v);
const main = `document.querySelector('main').innerText`;
const has = (text) => `${main}.includes(${js(text)})`;
const heading = (t) => `[...document.querySelectorAll('main h1')].some(h => h.textContent.trim() === ${js(t)})`;
const dialog = (label) => `document.querySelector(${js(`[role="dialog"][aria-label="${label}"]`)})`;
const clickIn = (scope, text) => `(() => { const root = ${scope} ?? document; const b = [...root.querySelectorAll('button')].find(b => !b.disabled && (b.textContent.trim() === ${js(text)} || b.getAttribute('aria-label') === ${js(text)})); if (!b) return false; b.click(); return true; })()`;
const setValue = (selector, value) => `(() => { const el = document.querySelector(${js(selector)}); if (!el) return false; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, ${js(value)}); el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`;
/** A rail item, whose text may carry a count after the label (Security's failed sign-ins). */
const rail = (label) => `(() => { const b = [...document.querySelectorAll('nav[aria-label="My account"] button')].find(b => b.textContent.trim().replace(/\\d+$/, '') === ${js(label)}); if (!b) return false; b.click(); return true; })()`;
const dark = (on) => `(() => { document.documentElement.dataset.theme = ${js(on ? 'dark' : 'light')}; return true; })()`;
async function poll(fn, ok, tries = 20) {
  let v;
  for (let i = 0; i < tries; i++) {
    v = await fn();
    if (ok(v)) return v;
    await sleep(500);
  }
  return v;
}
/** A picture made in the page and dropped on the editor, as a person dragging a file would. */
const dropPhoto = `(async () => {
  const c = document.createElement('canvas'); c.width = 480; c.height = 320;
  const x = c.getContext('2d'); x.fillStyle = '#3B5BDB'; x.fillRect(0, 0, 480, 320); x.fillStyle = '#FFD166'; x.beginPath(); x.arc(240, 150, 90, 0, 7); x.fill();
  const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
  const dt = new DataTransfer(); dt.items.add(new File([blob], 'e2e-photo.png', { type: 'image/png' }));
  const zone = [...document.querySelectorAll('[role="dialog"] b')].find((b) => b.textContent.trim() === 'Drag a photo here')?.parentElement;
  if (!zone) return false;
  zone.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
  zone.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  return true;
})()`;

const t = await launch({ name: 'account' });
try {
  const me = (await login()).user ?? {};
  await t.signIn(server, email, password);

  // ── the account menu ───────────────────────────────────────────────────
  await t.evaluate(`document.querySelector('header button[aria-label^="Account:"]').click()`);
  await t.waitFor(`!!${dialog('Account')}`, 'the account menu');
  const menu = await t.evaluate(`[...${dialog('Account')}.querySelectorAll('button')].map(b => b.textContent.trim())`);
  t.check('the account menu lists My account’s sections, this computer’s settings and Sign out', ['My profile', 'Profile settings', 'Profile pictures', 'My access', 'Settings for this computer', 'Sign out'].every((l) => menu.includes(l)) && menu.some((l) => l.startsWith('Security')), JSON.stringify(menu));
  t.check('the menu says whether two-factor is on', await poll(() => t.evaluate(`${dialog('Account')}.innerText.includes('2FA off')`), Boolean), '');
  await t.shot('account-menu');
  await t.evaluate(dark(true));
  await t.shot('account-menu-dark');
  await t.evaluate(dark(false));
  await t.evaluate(clickIn(dialog('Account'), 'My profile'));
  await t.waitFor(`!!document.querySelector('nav[aria-label="My account"]')`, 'the My account rail', 30_000);

  // ── My profile ────────────────────────────────────────────────────────
  await t.waitFor(`!!document.querySelector('section[aria-label="Profile header"]')`, 'the profile header');
  await t.waitFor(has('Complete your profile'), 'the completeness card');
  t.check('My profile shows who you are and how to reach you', await t.evaluate(`${has(me.name)} && ${has(email)} && ${has('Contact')} && ${has('Organisation')}`), '');
  t.check('the completeness card counts what is left', await t.evaluate(`/\\d of \\d done/.test(${main})`), '');
  t.check('the security card says how many devices you are signed in on', await poll(() => t.evaluate(`/Signed in on\\s*\\d+ device/.test(${main})`), Boolean), '');
  await t.shot('account-profile');
  await t.evaluate(dark(true));
  await t.shot('account-profile-dark');
  await t.evaluate(dark(false));

  // ── Profile settings ──────────────────────────────────────────────────
  await t.evaluate(rail('General'));
  await t.waitFor(heading('Profile settings'), 'Profile settings');
  const phone = `+94 77 000 ${String(Math.floor(Math.random() * 9000) + 1000)}`;
  await t.evaluate(setValue('main input[aria-label="Phone"]', phone));
  await t.evaluate(clickIn('document.querySelector("main")', 'Save'));
  const saved = await poll(() => api('GET', '/api/users/me/profile'), (r) => r.data?.phone === phone);
  t.check('the phone number is saved to the account', saved.data?.phone === phone, String(saved.data?.phone));
  t.check('what the organisation sets is shown with who changes it', await t.evaluate(`${has('Set by your organisation')} && ${has('This is how you sign in')}`), '');
  await t.shot('account-general');
  await t.evaluate(setValue('main input[aria-label="Phone"]', ''));
  await t.evaluate(clickIn('document.querySelector("main")', 'Save'));
  t.check('and put back', (await poll(() => api('GET', '/api/users/me/profile'), (r) => r.data?.phone === null)).data?.phone === null, '');

  // ── a photo ───────────────────────────────────────────────────────────
  await t.evaluate(clickIn('document.querySelector("main")', 'Upload photo'));
  await t.waitFor(`!!${dialog('Edit profile picture')}`, 'the picture editor');
  t.check('a photo dropped on the editor opens in the crop frame', await t.evaluate(dropPhoto), '');
  await t.waitFor(`!!document.querySelector('[role="application"][aria-label^="Crop area"] img')`, 'the crop frame');
  await t.evaluate(`(() => { const r = document.querySelector('input[aria-label="Zoom"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(r, String(Number(r.min) * 1.6)); r.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  await t.evaluate(clickIn(dialog('Edit profile picture'), 'Rotate right'));
  await t.shot('account-photo-editor');
  await t.evaluate(clickIn(dialog('Edit profile picture'), 'Save photo'));
  const withPhoto = await poll(() => api('GET', '/api/users/me/pictures'), (r) => (r.data?.items ?? []).some((i) => i.current && i.type === 'upload'));
  t.check('the cropped photo becomes the current picture', (withPhoto.data?.items ?? []).some((i) => i.current && i.type === 'upload'), JSON.stringify((withPhoto.data?.items ?? []).map((i) => [i.type, i.current])));
  const photoId = (withPhoto.data?.items ?? []).find((i) => i.current)?.id;
  t.check('the title bar shows the picture', await poll(() => t.evaluate(`!!document.querySelector('header button[aria-label^="Account:"] img[src*="/avatars/"]')`), Boolean), '');

  // ── an avatar ─────────────────────────────────────────────────────────
  await t.evaluate(clickIn('document.querySelector("main")', 'Create avatar'));
  await t.waitFor(`!!${dialog('Edit profile picture')}`, 'the avatar editor');
  await t.evaluate(clickIn(dialog('Edit profile picture'), 'Abstract'));
  await t.evaluate(clickIn(dialog('Edit profile picture'), 'Violet'));
  await t.evaluate(clickIn(dialog('Edit profile picture'), 'Bold'));
  await t.shot('account-avatar-editor');
  await t.evaluate(dark(true));
  await t.shot('account-avatar-editor-dark');
  await t.evaluate(dark(false));
  await t.evaluate(clickIn(dialog('Edit profile picture'), 'Use avatar'));
  const withAvatar = await poll(() => api('GET', '/api/users/me/pictures'), (r) => (r.data?.items ?? []).some((i) => i.current && i.type === 'generated_avatar'));
  const avatar = (withAvatar.data?.items ?? []).find((i) => i.current);
  t.check('the avatar is saved with how it was made', avatar?.type === 'generated_avatar' && avatar?.style?.look === 'abstract' && avatar?.style?.background === 'violet' && avatar?.style?.border === 'bold', JSON.stringify(avatar?.style));

  // ── Profile pictures ──────────────────────────────────────────────────
  await t.evaluate(rail('Profile pictures'));
  await t.waitFor(heading('Profile pictures'), 'Profile pictures');
  await t.waitFor(`!!document.querySelector('[data-picture="${photoId}"]')`, 'the earlier photo');
  await t.shot('account-pictures');
  await t.evaluate(`document.querySelector('[data-picture="${photoId}"] button').click()`);
  t.check('an earlier photo can be used again', (await poll(() => api('GET', '/api/users/me/pictures'), (r) => (r.data?.items ?? []).find((i) => i.current)?.id === photoId)).data?.items?.find((i) => i.current)?.id === photoId, '');
  await t.waitFor(`!!document.querySelector('[data-picture="${avatar.id}"]')`, 'the avatar tile');
  await t.evaluate(`document.querySelector('[data-picture="${avatar.id}"] button[aria-label="Delete"]').click()`);
  await t.evaluate(clickIn(`document.querySelector('[data-picture="${avatar.id}"]')`, 'Delete'));
  t.check('an avatar can be deleted', !(await poll(() => api('GET', '/api/users/me/pictures'), (r) => !(r.data?.items ?? []).some((i) => i.id === avatar.id))).data?.items?.some((i) => i.id === avatar.id), '');
  await t.evaluate(`[...document.querySelectorAll('main label')].find(l => l.textContent.includes('Your teams')).querySelector('input').click()`);
  t.check('who sees the picture is saved as soon as it is chosen', (await poll(() => api('GET', '/api/users/me/pictures'), (r) => r.data?.visibility?.mode === 'teams')).data?.visibility?.mode === 'teams', '');
  await t.evaluate(`[...document.querySelectorAll('main label')].find(l => l.textContent.includes('Everyone in your companies')).querySelector('input').click()`);
  await poll(() => api('GET', '/api/users/me/pictures'), (r) => r.data?.visibility?.mode === 'organization');
  await t.evaluate(clickIn('document.querySelector("main")', 'Remove picture'));
  await t.evaluate(clickIn('document.querySelector("main")', 'Remove'));
  t.check('the picture can be removed, and initials show again', (await poll(() => api('GET', '/api/users/me/profile'), (r) => !r.data?.avatar)).data?.avatar == null, '');

  // ── Security: two-factor ──────────────────────────────────────────────
  await t.evaluate(rail('Security'));
  await t.waitFor(heading('Security'), 'Security');
  await t.waitFor(`!!document.querySelector('main [data-session]')`, 'the sessions');
  t.check('exactly one session is marked as this device', (await t.evaluate(`[...document.querySelectorAll('main [data-session]')].filter(r => r.innerText.includes('This device')).length`)) === 1, '');
  t.check('recent sign-ins are listed', await t.evaluate(has('Recent sign-ins')), '');
  await t.shot('account-security');
  await t.evaluate(dark(true));
  await t.shot('account-security-dark');
  await t.evaluate(dark(false));
  await t.evaluate(clickIn('document.querySelector("main")', 'Turn on'));
  await t.waitFor(`!!document.querySelector('[data-testid="mfa-secret"]')`, 'the two-factor key');
  const secret = (await t.evaluate(`document.querySelector('[data-testid="mfa-secret"]').textContent`)).replace(/\s+/g, '');
  await t.shot('account-2fa');
  const code1 = await freshCode(secret);
  await t.evaluate(setValue('[role="dialog"] input[aria-label="Digit 1"]', code1));
  await t.waitFor(`${dialog('Turn on two-factor authentication')}?.innerText.includes('Save your backup codes')`, 'the backup codes');
  t.check('two-factor turns on with a code from the app, and ten backup codes are shown', (await t.evaluate(`${dialog('Turn on two-factor authentication')}.querySelectorAll('.font-mono > span').length`)) === 10, '');
  await t.shot('account-2fa-codes');
  await t.evaluate(clickIn(dialog('Turn on two-factor authentication'), 'Done'));
  t.check('the server has two-factor on', (await poll(() => api('GET', '/api/auth/mfa'), (r) => r.data?.enabled === true)).data?.enabled === true, '');
  await t.evaluate(clickIn('document.querySelector("main")', 'New codes'));
  await t.evaluate(clickIn('document.querySelector("[role=dialog]")', 'Make new codes'));
  await t.waitFor(`document.querySelector('[role="dialog"]')?.innerText.includes('Your old codes no longer work')`, 'the new codes');
  await t.evaluate(clickIn('document.querySelector("[role=dialog]")', 'Done'));

  // ── the password, with two-factor on ─────────────────────────────────
  const temp = `E2e-${Math.random().toString(36).slice(2, 10)}-Pw9!`;
  await t.evaluate(clickIn('document.querySelector("main")', 'Change password'));
  await t.waitFor(`!!${dialog('Change password')}`, 'the password sheet');
  await t.evaluate(setValue('[role="dialog"] input[aria-label="Current password"]', password));
  await t.evaluate(setValue('[role="dialog"] input[aria-label="New password"]', temp));
  await t.evaluate(setValue('[role="dialog"] input[aria-label="New password again"]', temp));
  await t.evaluate(clickIn(dialog('Change password'), 'Change password'));
  await t.waitFor(`!!${dialog('Stay signed in here')}`, 'the code to stay signed in', 30_000);
  password = temp;
  const code2 = await freshCode(secret);
  await t.evaluate(setValue('[role="dialog"] input[aria-label="Digit 1"]', code2));
  await t.waitFor(`!${dialog('Stay signed in here')}`, 'the renewal', 30_000);
  await sleep(800);
  t.check('after the change, this computer is still signed in', await t.evaluate(`!!document.querySelector('nav[aria-label="My account"]') && !document.body.innerText.includes('Sign in to WorkSuite')`), '');
  await t.evaluate(rail('My access'));
  await t.waitFor(heading('My access'), 'My access');
  await t.evaluate(rail('Security'));
  await t.waitFor(`[...document.querySelectorAll('main [data-session]')].some(r => r.innerText.includes('This device'))`, 'this device’s new session', 30_000);
  t.check('and its new session is the one marked as this device', true, '');
  const oldLogin = await fetch(`${server}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ email, password: original }) });
  t.check('the old password no longer signs in', oldLogin.status === 401, String(oldLogin.status));

  // ── two-factor off, the password put back ─────────────────────────────
  await t.evaluate(clickIn('document.querySelector("main")', 'Turn off'));
  await t.waitFor(`!!${dialog('Turn off two-factor?')}`, 'turning off');
  await t.evaluate(setValue('[role="dialog"] input[aria-label="Current password"]', password));
  await t.evaluate(clickIn(dialog('Turn off two-factor?'), 'Turn off'));
  await t.waitFor(`!${dialog('Turn off two-factor?')}`, 'two-factor off');
  t.check('two-factor turns off with the password', (await poll(() => api('GET', '/api/auth/mfa'), (r) => r.data?.enabled === false)).data?.enabled === false, '');
  await t.evaluate(clickIn('document.querySelector("main")', 'Change password'));
  await t.waitFor(`!!${dialog('Change password')}`, 'the password sheet');
  await t.evaluate(setValue('[role="dialog"] input[aria-label="Current password"]', password));
  await t.evaluate(setValue('[role="dialog"] input[aria-label="New password"]', original));
  await t.evaluate(setValue('[role="dialog"] input[aria-label="New password again"]', original));
  await t.evaluate(clickIn(dialog('Change password'), 'Change password'));
  await t.waitFor(`!${dialog('Change password')}`, 'the change', 30_000);
  password = original;
  await sleep(800);
  t.check('without two-factor the change needs nothing more, and this computer stays signed in', await t.evaluate(`!!document.querySelector('nav[aria-label="My account"]')`), '');
  const back = await login();
  t.check('the original password signs in again', !!back.tokens?.access_token, '');

  // ── sessions ──────────────────────────────────────────────────────────
  await login();
  await t.evaluate(rail('Profile pictures'));
  await t.evaluate(rail('Security'));
  await t.waitFor(`[...document.querySelectorAll('main [data-session]')].length >= 2`, 'another session listed', 30_000);
  await t.evaluate(clickIn('document.querySelector("main")', 'Sign out others'));
  await t.waitFor(`[...document.querySelectorAll('main [data-session]')].length === 1`, 'only this device left', 30_000);
  const direct = await fetch(`${server}/api/auth/sessions`, { headers: { Accept: 'application/json', Authorization: `Bearer ${token}` } });
  t.check('Sign out others ends the other sessions at once — their tokens are refused', direct.status === 401, String(direct.status));

  // ── notifications and preferences ─────────────────────────────────────
  const before = (await api('GET', '/api/notifications/preferences')).data?.preferences ?? {};
  await t.evaluate(rail('Notifications'));
  await t.waitFor(heading('Notifications'), 'Notifications');
  await t.waitFor(`!!document.querySelector('main [role="switch"][aria-label="Let urgent ones through"], main button[aria-label="Let urgent ones through"]')`, 'the quiet-hours switches');
  await t.evaluate(`document.querySelector('main [aria-label="Let urgent ones through"]').click()`);
  const after = await poll(() => api('GET', '/api/notifications/preferences'), (r) => String(r.data?.preferences?.quiet_allows_urgent) !== String(before.quiet_allows_urgent));
  const a = after.data?.preferences ?? {};
  t.check('a notification switch is saved, and the rest of the preferences are kept', String(a.quiet_allows_urgent) !== String(before.quiet_allows_urgent) && String(a.email) === String(before.email) && a.timezone === before.timezone && a.quiet_action === before.quiet_action, JSON.stringify({ before, a }));
  await t.shot('account-notifications');
  await t.evaluate(`document.querySelector('main [aria-label="Let urgent ones through"]').click()`);
  await poll(() => api('GET', '/api/notifications/preferences'), (r) => String(r.data?.preferences?.quiet_allows_urgent) === String(before.quiet_allows_urgent));

  const regional = (await api('GET', '/api/me/regional')).data;
  const sunday = regional?.options?.week_starts?.find((w) => /sun/i.test(w.label))?.value;
  await t.evaluate(rail('Preferences'));
  await t.waitFor(heading('Preferences'), 'Preferences');
  await t.waitFor(`!!document.querySelector('main [role="combobox"][aria-label="First day of the week"]')`, 'the regional settings');
  await t.evaluate(choose('main [role="combobox"][aria-label="First day of the week"]', String(sunday)));
  t.check('the first day of the week is saved to the account', (await poll(() => api('GET', '/api/me/regional'), (r) => r.data?.mine?.week_start === sunday)).data?.mine?.week_start === sunday, '');
  await t.shot('account-preferences');
  await t.evaluate(choose('main [role="combobox"][aria-label="First day of the week"]', ''));
  t.check('and put back to the company’s', (await poll(() => api('GET', '/api/me/regional'), (r) => r.data?.mine?.week_start === null)).data?.mine?.week_start === null, '');

  // ── My access ─────────────────────────────────────────────────────────
  await t.evaluate(rail('My access'));
  await t.waitFor(heading('My access'), 'My access');
  // The totals' labels are uppercased by CSS, which innerText reports; textContent does not.
  await t.waitFor(`document.querySelector('main').textContent.includes('You can open')`, 'the totals');
  await t.evaluate(`document.querySelector('main button[aria-expanded="false"]').click()`);
  t.check('a module opens to say why, and which permissions are held', await t.evaluate(`!!document.querySelector('main button[aria-expanded="true"]')`), '');
  await t.shot('account-access');

  // ── a web link lands here ─────────────────────────────────────────────
  await t.evaluate(`document.querySelector('header button[aria-label^="Account:"]').click()`);
  await t.evaluate(clickIn(dialog('Account'), 'Profile pictures'));
  await t.waitFor(heading('Profile pictures'), 'the menu’s Profile pictures');
  t.check('the menu opens each section', true, '');
} catch (e) {
  t.check('the run finished', false, String(e?.stack ?? e));
} finally {
  // Whatever the run left: pictures, two-factor, visibility (the password is put back by the run script from its copy).
  for (const i of (await api('GET', '/api/users/me/pictures')).data?.items ?? []) await api('DELETE', `/api/users/me/pictures/${i.id}`);
  await api('PUT', '/api/users/me/pictures/visibility', { mode: 'organization', orgs: [] });
}
await t.finish();

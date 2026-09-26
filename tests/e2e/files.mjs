// End-to-end: Files in the desktop against a real WorkSuite — a folder made
// from the New menu, a text file, pictures (thumbnails, details, preview),
// rename, star, a comment, a description, versions, sharing with a teammate
// and taking it back, a secure link (made, listed, revoked), copy, move, zip,
// looking inside and extracting, the recycle bin (undo, restore, delete
// forever), a password lock, search, Storage, Duplicates, Shared with me,
// Drive notifications, Send to Chat and a download.
//
//   npm run build
//   WS_E2E_SERVER=http://localhost:8920 WS_E2E_EMAIL=… WS_E2E_PASSWORD=… \
//   WS_E2E_PARTNER_EMAIL=… WS_E2E_PARTNER_PASSWORD=… \
//   ELECTRON_RUN_AS_NODE=1 npx electron tests/e2e/files.mjs
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { launch, sleep, choose } from './harness.mjs';

const server = process.env.WS_E2E_SERVER;
const email = process.env.WS_E2E_EMAIL;
const password = process.env.WS_E2E_PASSWORD;
const partnerEmail = process.env.WS_E2E_PARTNER_EMAIL;
const partnerPassword = process.env.WS_E2E_PARTNER_PASSWORD;
if (!server || !email || !password || !partnerEmail || !partnerPassword) {
  console.error('Set WS_E2E_SERVER, WS_E2E_EMAIL, WS_E2E_PASSWORD, WS_E2E_PARTNER_EMAIL and WS_E2E_PARTNER_PASSWORD.');
  process.exit(2);
}

const tokens = {};
async function api(who, method, path, body) {
  const res = await fetch(`${server}${path}`, {
    method,
    headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}), Authorization: `Bearer ${tokens[who]}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = (res.headers.get('content-type') ?? '').includes('json') ? await res.json().catch(() => ({})) : {};
  return { status: res.status, data: json.data ?? json };
}
async function login(who, e, p) {
  const r = await fetch(`${server}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ email: e, password: p }) });
  const j = await r.json();
  tokens[who] = j.data?.tokens?.access_token ?? '';
  return j.data?.user ?? {};
}
/** A small PNG, so the server makes a thumbnail. */
function png(w, h, rgb) {
  const table = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = table[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const rows = [];
  for (let y = 0; y < h; y++) {
    const row = Buffer.alloc(1 + w * 3);
    for (let x = 0; x < w; x++) row.set([rgb[0], (rgb[1] + x) % 255, rgb[2]], 1 + x * 3);
    rows.push(row);
  }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
}
async function upload(who, name, bytes, folderId) {
  const init = await api(who, 'POST', '/api/uploads/init', { filename: name, total_size: bytes.length, total_chunks: 1, sha256: createHash('sha256').update(bytes).digest('hex'), mime_type: 'image/png', purpose: 'drive', folder_id: folderId ?? undefined });
  const form = new FormData();
  form.append('chunk_index', '0');
  form.append('chunk', new Blob([bytes]), name);
  await fetch(`${server}/api/uploads/${init.data.upload_id}/chunk`, { method: 'POST', headers: { Accept: 'application/json', Authorization: `Bearer ${tokens[who]}` }, body: form });
  return (await api(who, 'POST', `/api/uploads/${init.data.upload_id}/complete`)).data.file_id;
}

const tag = Math.floor(Math.random() * 10_000);
const made = { mine: new Set(), theirs: new Set(), folders: [] };
const js = (v) => JSON.stringify(v);
const rowSel = (name) => `[...document.querySelectorAll('main [role="row"][data-row]')].find(r => r.textContent.includes(${js(name)}))`;
const railClick = (label) => `[...document.querySelectorAll('nav[aria-label="Drive"] button')].find(b => b.textContent.trim().startsWith(${js(label)})).click()`;
const menuItem = (label) => `[...document.querySelectorAll('[role="menu"] [role="menuitem"]')].find(b => (b.querySelector('.flex-1')?.textContent ?? '').trim().startsWith(${js(label)})).click()`;
const modalButton = (label) => `[...document.querySelectorAll('[aria-modal="true"] button')].find(b => b.textContent.trim() === ${js(label)}).click()`;
const files = async (q) => (await api('me', 'GET', `/api/drive/list?per_page=200&counts=0${q}`)).data.files ?? [];
const key = (k, code = k) => [{ type: 'keyDown', key: k, code, windowsVirtualKeyCode: { Delete: 46, F2: 113, Escape: 27, ArrowRight: 39 }[k] ?? 0 }, { type: 'keyUp', key: k, code }];

const t = await launch({ name: 'files' });
async function press(k) {
  await t.evaluate(`document.activeElement && document.activeElement.blur()`);
  for (const e of key(k)) await t.send('Input.dispatchKeyEvent', e);
}
async function clickRow(name, extra = '') {
  await t.waitFor(`!!${rowSel(name)}`, name);
  await t.evaluate(extra ? `${rowSel(name)}.dispatchEvent(new MouseEvent('click', { bubbles: true, ${extra} }))` : `${rowSel(name)}.click()`);
}
async function openMenu(name) {
  await t.waitFor(`!!document.querySelector(${js(`button[aria-label="More actions for ${name}"]`)})`, `the menu button for ${name}`);
  await t.evaluate(`document.querySelector(${js(`button[aria-label="More actions for ${name}"]`)}).click()`);
  await t.waitFor(`!!document.querySelector('[role="menu"]')`, 'the menu');
}
async function nameDialog(value, action) {
  await t.waitFor(`!!document.querySelector('[aria-modal="true"] input[aria-label="Name"]')`, 'the name dialog');
  await t.fill('Name', value);
  await t.evaluate(modalButton(action));
  await t.waitFor(`!document.querySelector('[aria-modal="true"] input[aria-label="Name"]')`, 'the dialog closed');
}

try {
  await t.signIn(server, email, password);
  const me = await login('me', email, password);
  const partner = await login('partner', partnerEmail, partnerPassword);

  await t.evaluate(`[...document.querySelectorAll('nav[aria-label="Apps"] button')].find(b => b.textContent.trim().startsWith('Files')).click()`);
  await t.waitFor(`!!document.querySelector('nav[aria-label="Drive"]') && document.body.innerText.includes('STARRED FOLDERS')`, 'Files');
  const rail = await t.evaluate(`[...document.querySelectorAll('nav[aria-label="Drive"] button')].map(b => b.textContent.trim())`);
  t.check('Files opens natively on Home, with the rail', ['Home', 'My Drive', 'Recent', 'Starred', 'Shared with me', 'Shared by me', 'Images', 'Duplicates', 'Large files', 'Storage', 'Recycle bin'].every((l) => rail.some((x) => x.startsWith(l))), js(rail.slice(0, 16)));

  // A folder from the New menu, at the top of My Drive.
  await t.evaluate(railClick('My Drive'));
  await t.waitFor(`!!document.querySelector('main[aria-label="My Drive"]')`, 'My Drive');
  await t.evaluate(`document.querySelector('button[aria-label="New file, folder or document"]').click()`);
  await t.waitFor(`!!document.querySelector('[role="menu"][aria-label="New"]')`, 'the New menu');
  await t.evaluate(menuItem('New folder'));
  const top = `E2E Drive ${tag}`;
  await nameDialog(top, 'Create');
  await t.waitFor(`[...document.querySelectorAll('nav[aria-label="Drive"] button')].some(b => b.textContent.includes(${js(top)}))`, 'the folder in the tree');
  const folder = ((await api('me', 'GET', '/api/drive/tree')).data.tree ?? []).find((f) => f.name === top);
  if (folder) made.folders.push(folder.id);
  t.check('New folder makes a folder, shown in the tree', !!folder);

  // The keyboard alone: the name is focused on opening, typing goes into it,
  // and Enter creates — even after the screen behind has re-rendered.
  await t.evaluate(`document.querySelector('button[aria-label="New file, folder or document"]').click()`);
  await t.waitFor(`!!document.querySelector('[role="menu"][aria-label="New"]')`, 'the New menu');
  await t.evaluate(menuItem('New folder'));
  await t.waitFor(`!!document.querySelector('[aria-modal="true"] input[aria-label="Name"]')`, 'the name dialog');
  await sleep(2500);
  t.check('the new folder name has focus when the dialog opens', await t.evaluate(`document.activeElement?.getAttribute('aria-label') === 'Name'`));
  const byKey = `E2E Drive Enter ${tag}`;
  await t.send('Input.insertText', { text: byKey });
  await t.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
  await t.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await t.waitFor(`!document.querySelector('[aria-modal="true"] input[aria-label="Name"]')`, 'the dialog closed on Enter');
  const entered = ((await api('me', 'GET', '/api/drive/tree')).data.tree ?? []).find((f) => f.name === byKey);
  if (entered) made.folders.push(entered.id);
  t.check('typing a name and pressing Enter creates the folder', !!entered);

  // Into it, and a text file from the New menu there.
  await t.evaluate(`${rowSel(top)}.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`);
  await t.waitFor(`!!document.querySelector(${js(`main[aria-label="${top}"]`)})`, 'the folder open');
  await t.evaluate(`document.querySelector('button[aria-label="New file, folder or document"]').click()`);
  await t.waitFor(`!!document.querySelector('[role="menu"][aria-label="New"]')`, 'the New menu');
  await t.evaluate(menuItem('Text file'));
  await nameDialog(`notes-${tag}.txt`, 'Create');
  await t.waitFor(`!!${rowSel(`notes-${tag}.txt`)}`, 'the text file');
  let inFolder = await files(`&folder_id=${folder.id}`);
  const txt = inFolder.find((f) => f.name === `notes-${tag}.txt`);
  if (txt) made.mine.add(txt.id);
  t.check('a double click opens the folder; a text file is made in it', !!txt && txt.folder_id === folder.id);

  // Two pictures, uploaded, with thumbnails.
  const p1 = await upload('me', `photo-a-${tag}.png`, png(320, 200, [11, 103, 112]), folder.id);
  const p2 = await upload('me', `photo-b-${tag}.png`, png(320, 200, [107, 63, 181]), folder.id);
  made.mine.add(p1);
  made.mine.add(p2);
  await t.evaluate(`document.querySelector('button[aria-label="Refresh"]').click()`);
  await t.waitFor(`!!${rowSel(`photo-b-${tag}.png`)}`, 'the pictures');
  const thumbs = await t.waitFor(`${rowSel(`photo-a-${tag}.png`)}.querySelector('img')?.naturalWidth > 0`, 'a thumbnail', 15_000).then(() => true, () => false);
  t.check('uploaded pictures show with their thumbnails', thumbs);

  // Details for a picture.
  await clickRow(`photo-a-${tag}.png`);
  await t.waitFor(`!!document.querySelector('aside[aria-label="File details"]')`, 'the details');
  const facts = await t.evaluate(`document.querySelector('aside[aria-label="File details"]').innerText`);
  t.check('choosing a file shows its details', facts.includes('PNG') && facts.includes(top) && facts.includes('Owner'), facts.replace(/\s+/g, ' ').slice(0, 160));

  // A description, saved on leaving the field.
  await t.fill('Description', 'Job card screen, v3');
  await t.evaluate(`document.querySelector('textarea[aria-label="Description"]').dispatchEvent(new FocusEvent('focusout', { bubbles: true }))`);
  const described = await t.waitFor(`document.body.innerText.includes('Description saved')`, 'saved', 10_000).then(() => true, () => false);
  inFolder = await files(`&folder_id=${folder.id}`);
  t.check('the description saves', described && inFolder.find((f) => f.id === p1)?.description === 'Job card screen, v3');

  // Grid view.
  await t.evaluate(`document.querySelector('button[aria-label="Grid view"]').click()`);
  await t.waitFor(`document.querySelectorAll('main button[data-row] img').length >= 2`, 'the grid');
  t.check('the grid shows pictures as tiles', true);
  await t.evaluate(`document.querySelector('button[aria-label="List view"]').click()`);
  await t.waitFor(`!!${rowSel(`photo-a-${tag}.png`)}`, 'the list');

  // Preview: the picture, the next with →, Esc closes.
  await t.evaluate(`${rowSel(`photo-a-${tag}.png`)}.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`);
  const shown = await t.waitFor(`document.querySelector('[role="dialog"][aria-label^="Preview"] img')?.naturalWidth > 0`, 'the preview', 15_000).then(() => true, () => false);
  const firstName = await t.evaluate(`document.querySelector('[role="dialog"][aria-label^="Preview"]').getAttribute('aria-label')`);
  for (const e of key('ArrowRight')) await t.send('Input.dispatchKeyEvent', e);
  await sleep(400);
  const nextName = await t.evaluate(`document.querySelector('[role="dialog"][aria-label^="Preview"]').getAttribute('aria-label')`);
  for (const e of key('Escape')) await t.send('Input.dispatchKeyEvent', e);
  await t.waitFor(`!document.querySelector('[role="dialog"][aria-label^="Preview"]')`, 'the preview closed');
  t.check('a double click previews the picture; → moves on, Esc closes', shown && firstName !== nextName, `${firstName} → ${nextName}`);

  // Rename with F2.
  await clickRow(`notes-${tag}.txt`);
  await press('F2');
  await nameDialog(`renamed-${tag}.txt`, 'Rename');
  await t.waitFor(`!!${rowSel(`renamed-${tag}.txt`)}`, 'the renamed file');
  t.check('F2 renames', (await files(`&folder_id=${folder.id}`)).some((f) => f.id === txt.id && f.name === `renamed-${tag}.txt`));

  // Star from the menu; it is in Starred.
  await openMenu(`photo-a-${tag}.png`);
  await t.evaluate(menuItem('Star'));
  await t.waitFor(`!!${rowSel(`photo-a-${tag}.png`)}?.querySelector('[aria-label="Starred"]')`, 'the star');
  t.check('Star marks the file', (await files('&view=starred')).some((f) => f.id === p1));

  // A comment.
  await clickRow(`photo-a-${tag}.png`);
  await t.evaluate(`[...document.querySelectorAll('aside[aria-label="File details"] [role="tab"]')].find(b => b.textContent === 'Comments').click()`);
  await t.waitFor(`!!document.querySelector('textarea[aria-label="Add a comment"]')`, 'the comments');
  await t.fill('Add a comment', 'Can we keep line-level approval visible?');
  await t.evaluate(`[...document.querySelectorAll('aside[aria-label="File details"] button')].find(b => b.textContent.trim() === 'Comment').click()`);
  await t.waitFor(`document.querySelector('aside[aria-label="File details"]').innerText.includes('line-level approval')`, 'the comment');
  const comments = (await api('me', 'GET', `/api/drive/comments/file/${p1}`)).data.comments ?? [];
  t.check('a comment is added', comments.some((c) => c.body.includes('line-level approval')));

  // Versions.
  await t.evaluate(`[...document.querySelectorAll('aside[aria-label="File details"] [role="tab"]')].find(b => b.textContent === 'Versions').click()`);
  await t.waitFor(`document.querySelector('aside[aria-label="File details"]').innerText.includes('Current')`, 'the versions');
  t.check('Versions shows the current version', true);

  // Share with the partner, then take it back.
  await t.evaluate(`[...document.querySelectorAll('aside[aria-label="File details"] button')].find(b => b.textContent.trim() === 'Share…').click()`);
  await t.waitFor(`!!document.querySelector('[aria-labelledby="shTitle"] input[aria-label="Search people"]')`, 'the share dialog');
  await t.fill('Search people', partner.name.slice(0, 3));
  await t.waitFor(`[...document.querySelectorAll('[aria-labelledby="shTitle"] button')].some(b => b.textContent.includes(${js(partner.name)}))`, 'the partner found');
  await t.evaluate(`[...document.querySelectorAll('[aria-labelledby="shTitle"] button')].find(b => b.textContent.includes(${js(partner.name)})).click()`);
  await t.evaluate(choose('[aria-labelledby="shTitle"] [role="combobox"][aria-label="Access level"]', 'view'));
  await t.evaluate(`[...document.querySelectorAll('[aria-labelledby="shTitle"] button')].find(b => b.textContent.trim() === 'Share').click()`);
  await t.waitFor(`!!document.querySelector(${js(`[aria-labelledby="shTitle"] [role="combobox"][aria-label="Access for ${partner.name}"]`)})`, 'the partner listed');
  let access = (await api('me', 'GET', `/api/drive/access/file/${p1}`)).data;
  const grant = (access.grants ?? []).find((g) => g.principal.id === partner.id);
  const seen = (await api('partner', 'GET', '/api/drive/list?view=shared&per_page=100&counts=0')).data.files ?? [];
  t.check('Share gives a teammate access; they see it in Shared with me', !!grant && grant.level === 'view' && seen.some((f) => f.id === p1), js(grant && { level: grant.level }));
  await t.evaluate(choose(`[aria-labelledby="shTitle"] [role="combobox"][aria-label="Access for ${partner.name}"]`, 'remove'));
  await t.waitFor(`!document.querySelector(${js(`[aria-labelledby="shTitle"] [role="combobox"][aria-label="Access for ${partner.name}"]`)})`, 'the partner removed');
  access = (await api('me', 'GET', `/api/drive/access/file/${p1}`)).data;
  t.check('Remove access takes it back', !(access.grants ?? []).some((g) => g.principal.id === partner.id));

  // A secure link from the Share dialog; it is in Secure links, and revoked there.
  await t.evaluate(`[...document.querySelectorAll('[aria-labelledby="shTitle"] button')].find(b => b.textContent.trim() === 'Create secure link…').click()`);
  await t.waitFor(`document.body.innerText.includes('The link lasts')`, 'the secure link dialog');
  await t.fill('Label', `E2E link ${tag}`);
  await t.evaluate(modalButton('Create link'));
  await t.waitFor(`[...document.querySelectorAll('[aria-modal="true"] span')].some(s => s.textContent.includes('/d/'))`, 'the link made');
  await t.evaluate(modalButton('Done'));
  let grants = (await api('me', 'GET', '/api/downloads/grants?per_page=100')).data.items ?? [];
  const link = grants.find((g) => g.label === `E2E link ${tag}`);
  t.check('a secure link is made, with a 7-day expiry by default', !!link && !!link.expires_at);
  await t.evaluate(railClick('Settings'));
  await t.evaluate(railClick('Secure links'));
  await t.waitFor(t.hasText(`E2E link ${tag}`), 'the link listed');
  await t.evaluate(`[...document.querySelectorAll('main [role="row"]')].find(r => r.textContent.includes(${js(`E2E link ${tag}`)})).querySelector('button.text-danger, button[class*="text-danger"]').click()`);
  await t.waitFor(`[...document.querySelectorAll('main [role="row"]')].find(r => r.textContent.includes(${js(`E2E link ${tag}`)}))?.textContent.includes('Revoked')`, 'the link revoked');
  grants = (await api('me', 'GET', '/api/downloads/grants?per_page=100')).data.items ?? [];
  t.check('Secure links lists it, and Revoke ends it', grants.find((g) => g.id === link?.id)?.status === 'revoked');

  // Back to the folder: copy the text file to My Drive, move a picture into a subfolder.
  await t.evaluate(railClick(top));
  await t.waitFor(`!!${rowSel(`renamed-${tag}.txt`)}`, 'the folder');
  const sub = (await api('me', 'POST', '/api/folders', { name: `Sub ${tag}`, parent_id: folder.id })).data;
  made.folders.push(Number(sub.id));
  await openMenu(`renamed-${tag}.txt`);
  await t.evaluate(menuItem('Copy to'));
  await t.waitFor(`!!document.querySelector('[role="listbox"][aria-label="Folders"]')`, 'the folder picker');
  await t.evaluate(`[...document.querySelectorAll('[role="listbox"] [role="option"]')].find(b => b.textContent.trim() === 'My Drive').click()`);
  await t.evaluate(modalButton('Copy here'));
  await t.waitFor(`document.body.innerText.includes('Copied 1 item')`, 'the copy');
  const rootCopy = (await files('&q=' + encodeURIComponent(`renamed-${tag}`))).find((f) => f.id !== txt.id && f.folder_id === null);
  if (rootCopy) made.mine.add(rootCopy.id);
  t.check('Copy to… puts a copy in My Drive', !!rootCopy);
  await t.evaluate(`document.querySelector('button[aria-label="Refresh"]').click()`);
  await t.waitFor(`!!${rowSel(`Sub ${tag}`)}`, 'the subfolder');
  await openMenu(`photo-b-${tag}.png`);
  await t.evaluate(menuItem('Move'));
  await t.waitFor(`!!document.querySelector('[role="listbox"][aria-label="Folders"]')`, 'the folder picker');
  await t.fill('Find a folder', `Sub ${tag}`);
  await t.evaluate(`[...document.querySelectorAll('[role="listbox"] [role="option"]')].find(b => b.textContent.includes(${js(`Sub ${tag}`)})).click()`);
  await t.evaluate(modalButton('Move here'));
  await t.waitFor(`!${rowSel(`photo-b-${tag}.png`)}`, 'the picture moved');
  t.check('Move… moves a file into another folder', (await files(`&folder_id=${sub.id}`)).some((f) => f.id === p2));

  // Zip two files; look inside; extract.
  await clickRow(`photo-a-${tag}.png`);
  await clickRow(`renamed-${tag}.txt`, 'metaKey: true');
  await t.waitFor(`!!document.querySelector('[role="toolbar"][aria-label="Selection"]')`, 'the selection bar');
  const bar = await t.evaluate(`document.querySelector('[role="toolbar"][aria-label="Selection"]').innerText`);
  await t.evaluate(`[...document.querySelectorAll('[role="toolbar"][aria-label="Selection"] button')].find(b => b.textContent.trim() === 'Zip').click()`);
  await nameDialog(`bundle-${tag}.zip`, 'Make zip');
  await t.waitFor(`!!${rowSel(`bundle-${tag}.zip`)}`, 'the zip');
  const zip = (await files(`&folder_id=${folder.id}`)).find((f) => f.name === `bundle-${tag}.zip`);
  if (zip) made.mine.add(zip.id);
  t.check('two chosen show the selection bar; Zip makes one archive of them', bar.includes('2 selected') && !!zip, bar.replace(/\s+/g, ' '));
  await t.evaluate(`${rowSel(`bundle-${tag}.zip`)}.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`);
  await t.waitFor(`[...document.querySelectorAll('[aria-modal="true"] button')].some(b => b.textContent.trim() === 'Extract here')`, 'the archive dialog');
  await sleep(800);
  const inside = await t.evaluate(`document.querySelector('[aria-modal="true"]').innerText`);
  await t.evaluate(modalButton('Extract here'));
  await t.waitFor(`document.body.innerText.includes('Extracted')`, 'the extract', 20_000);
  const tree = (await api('me', 'GET', '/api/drive/tree')).data.tree ?? [];
  const walk = (n) => n.flatMap((x) => [x, ...walk(x.children ?? [])]);
  const extracted = walk(tree).find((f) => f.name.startsWith(`bundle-${tag}`));
  if (extracted) {
    made.folders.push(extracted.id);
    for (const f of await files(`&folder_id=${extracted.id}`)) made.mine.add(f.id);
  }
  t.check('opening a zip shows it; Extract here unpacks it into a folder', !!extracted, inside.replace(/\s+/g, ' ').slice(0, 160));
  for (const e of key('Escape')) await t.send('Input.dispatchKeyEvent', e);

  // The recycle bin: Del, Undo; Del again, Restore; Delete forever.
  await t.evaluate(railClick(top));
  await t.waitFor(`!!${rowSel(`renamed-${tag}.txt`)}`, 'the folder');
  await clickRow(`renamed-${tag}.txt`);
  await press('Delete');
  await t.waitFor(`document.body.innerText.includes('moved to the recycle bin')`, 'the delete');
  await t.evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Undo').click()`);
  await t.waitFor(`!!${rowSel(`renamed-${tag}.txt`)}`, 'the file back');
  t.check('Del moves a file to the recycle bin; Undo brings it back', !(await files(`&folder_id=${folder.id}`)).every((f) => f.id !== txt.id));
  await clickRow(`renamed-${tag}.txt`);
  await press('Delete');
  await t.waitFor(`!${rowSel(`renamed-${tag}.txt`)}`, 'the file gone');
  await t.evaluate(railClick('Recycle bin'));
  await t.waitFor(`[...document.querySelectorAll('main[aria-label="Recycle bin"] [role="row"]')].some(r => r.textContent.includes(${js(`renamed-${tag}.txt`)}))`, 'the file in the bin');
  await t.evaluate(`[...document.querySelectorAll('main [role="row"]')].find(r => r.textContent.includes(${js(`renamed-${tag}.txt`)})).querySelector('button').click()`);
  await t.waitFor(`document.body.innerText.includes('restored')`, 'restored');
  t.check('the recycle bin lists it, and Restore puts it back', (await files(`&folder_id=${folder.id}`)).some((f) => f.id === txt.id));
  await t.evaluate(railClick(top));
  await clickRow(`renamed-${tag}.txt`);
  await press('Delete');
  await t.waitFor(`!${rowSel(`renamed-${tag}.txt`)}`, 'the file gone again');
  await t.evaluate(railClick('Recycle bin'));
  await t.waitFor(`[...document.querySelectorAll('main[aria-label="Recycle bin"] [role="row"]')].some(r => r.textContent.includes(${js(`renamed-${tag}.txt`)}))`, 'the file in the bin again');
  await t.evaluate(`[...[...document.querySelectorAll('main [role="row"]')].find(r => r.textContent.includes(${js(`renamed-${tag}.txt`)})).querySelectorAll('button')].find(b => b.textContent.trim() === 'Delete forever').click()`);
  await t.evaluate(modalButton('Delete forever'));
  await t.waitFor(`!document.querySelector('main[aria-label="Recycle bin"]').innerText.includes(${js(`renamed-${tag}.txt`)})`, 'gone forever');
  made.mine.delete(txt.id);
  t.check('Delete forever removes it for good', !(await files('&view=trash')).some((f) => f.id === txt.id));

  // A password lock on the subfolder: asked for, refused when wrong, opened when right; then off again.
  await t.evaluate(railClick(top));
  await t.waitFor(`!!${rowSel(`Sub ${tag}`)}`, 'the folder');
  await openMenu(`Sub ${tag}`);
  await t.evaluate(menuItem('Password lock'));
  await t.waitFor(`document.body.innerText.includes('Confirm password')`, 'the lock dialog');
  await t.fill('Password', 'Kandy-Lake-2026');
  await t.fill('Confirm password', 'Kandy-Lake-2026');
  await t.evaluate(modalButton('Lock folder'));
  await t.waitFor(`document.body.innerText.includes('is locked')`, 'locked');
  const locked = walk((await api('me', 'GET', '/api/drive/tree')).data.tree ?? []).find((f) => f.id === Number(sub.id));
  t.check('Password lock locks the folder', !!locked?.is_locked);
  await t.waitFor(`${rowSel(`Sub ${tag}`)}?.textContent.includes('Locked')`, 'the Locked badge');
  await openMenu(`Sub ${tag}`);
  await t.evaluate(menuItem('Remove the password lock'));
  await t.fill('Current password', 'wrong-password');
  await t.evaluate(modalButton('Remove lock'));
  await t.waitFor(`document.body.innerText.includes('not the folder’s password')`, 'refused');
  await t.fill('Current password', 'Kandy-Lake-2026');
  await t.evaluate(modalButton('Remove lock'));
  await t.waitFor(`document.body.innerText.includes('is off')`, 'unlocked');
  const unlocked = walk((await api('me', 'GET', '/api/drive/tree')).data.tree ?? []).find((f) => f.id === Number(sub.id));
  t.check('a wrong password is refused; the right one takes the lock off', !unlocked?.is_locked);

  // A folder locked elsewhere asks for its password here: wrong is refused, right opens it.
  const vault = (await api('me', 'POST', '/api/folders', { name: `Vault ${tag}`, parent_id: folder.id })).data;
  made.folders.push(Number(vault.id));
  made.mine.add(await upload('me', `secret-${tag}.png`, png(64, 40, [30, 30, 30]), Number(vault.id)));
  await api('me', 'POST', `/api/folders/${vault.id}/lock`, { password: 'Galle-Fort-2026' });
  await t.evaluate(`document.querySelector('button[aria-label="Refresh"]').click()`);
  await t.waitFor(`!!${rowSel(`Vault ${tag}`)}`, 'the locked folder');
  await t.evaluate(`${rowSel(`Vault ${tag}`)}.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`);
  await t.waitFor(t.hasText('is password locked'), 'the password prompt');
  const hidden = await t.evaluate(`!document.body.innerText.includes(${js(`secret-${tag}.png`)})`);
  await t.fill('Folder password', 'not-it');
  await t.clickButton('Open folder');
  await t.waitFor(t.hasText('That password is not right.'), 'refused');
  await t.fill('Folder password', 'Galle-Fort-2026');
  await t.clickButton('Open folder');
  await t.waitFor(`!!${rowSel(`secret-${tag}.png`)}`, 'the locked folder open');
  t.check('a locked folder asks first: nothing shows, a wrong password is refused, the right one opens it', hidden);
  await api('me', 'POST', `/api/folders/${vault.id}/unlock`, { password: 'Galle-Fort-2026' });
  await t.evaluate(railClick(top));
  await t.waitFor(`!!${rowSel(`photo-a-${tag}.png`)}`, 'the folder');

  // Search in the folder.
  await t.fill('Search files and folders', `photo-a-${tag}`);
  await t.waitFor(`document.querySelectorAll('main [role="row"][data-row]').length === 1`, 'one match');
  t.check('search narrows the list', true);
  await t.fill('Search files and folders', '');

  // Download from the menu: a file in the downloads.
  await openMenu(`photo-a-${tag}.png`);
  await t.evaluate(menuItem('Download'));
  const downloaded = await t.waitFor(`window.worksuite.transfers.list().then(l => Array.isArray(l) && l.some(x => x.name === ${js(`photo-a-${tag}.png`)} && x.state === 'done'))`, 'the download', 30_000).then(() => true, () => false);
  t.check('Download saves the file to the downloads', downloaded);

  // Send to Chat.
  await openMenu(`photo-a-${tag}.png`);
  await t.evaluate(menuItem('Send to Chat'));
  await t.waitFor(`!!document.querySelector('input[aria-label="Search people"]')`, 'the send dialog');
  await t.fill('Search people', partner.name.slice(0, 3));
  await t.waitFor(`[...document.querySelectorAll('[aria-modal="true"] button')].some(b => b.textContent.includes(${js(partner.name)}))`, 'the partner');
  await t.evaluate(`[...document.querySelectorAll('[aria-modal="true"] button')].find(b => b.textContent.includes(${js(partner.name)})).click()`);
  await t.evaluate(modalButton('Send'));
  const sent = await t.waitFor(`document.body.innerText.includes('Sent to Chat') || document.body.innerText.includes('can’t open this')`, 'sent', 15_000).then(() => t.evaluate(`document.body.innerText.includes('can’t open this') ? 'needs' : 'sent'`), () => 'no');
  if (sent === 'needs') {
    await t.evaluate(modalButton('Grant view'));
    await t.waitFor(`document.body.innerText.includes('Sent to Chat')`, 'sent after the grant', 15_000);
  }
  t.check('Send to Chat sends it to a teammate (giving access when they lack it)', sent !== 'no', sent);

  // Shared with me: the partner shares a file of theirs.
  const theirs = await upload('partner', `from-bea-${tag}.png`, png(64, 40, [200, 80, 40]), null);
  made.theirs.add(theirs);
  const shareBack = await api('partner', 'POST', `/api/drive/access/file/${theirs}/grants`, { principal_type: 'user', principal_id: me.id, level: 'edit' });
  await t.evaluate(railClick('Shared with me'));
  await t.waitFor(t.hasText(`from-bea-${tag}.png`), 'the shared file', 20_000).catch(() => undefined);
  const sharedRow = await t.evaluate(`[...document.querySelectorAll('main [role="row"]')].find(r => r.textContent.includes(${js(`from-bea-${tag}.png`)}))?.innerText ?? ''`);
  t.check('Shared with me lists what a teammate shared, with its owner and your access', shareBack.status === 201 && sharedRow.includes(partner.name) && sharedRow.includes('Can edit'), sharedRow.replace(/\s+/g, ' '));

  // Storage and Duplicates.
  await t.evaluate(railClick('Storage'));
  await t.waitFor(t.hasText('Where the space went'), 'Storage');
  await t.evaluate(railClick('Duplicates'));
  await t.waitFor(`!!document.querySelector('main[aria-label="Duplicates"]')`, 'Duplicates');
  t.check('Storage and Duplicates open', true);

  // Drive notifications: a default changes.
  await t.evaluate(railClick('Drive notifications'));
  await t.waitFor(`!!document.querySelector('main[aria-label="Drive notifications"] input[type="checkbox"]')`, 'the settings');
  const before = (await api('me', 'GET', '/api/drive/notify/defaults')).data.topics;
  await t.evaluate(`[...document.querySelectorAll('main[aria-label="Drive notifications"] label')].find(l => l.textContent.includes('Other changes')).querySelector('input').click()`);
  await t.waitFor(`document.body.innerText.includes('Saved')`, 'saved');
  const after = (await api('me', 'GET', '/api/drive/notify/defaults')).data.topics;
  t.check('Drive notifications change the defaults', (before.changes !== false) !== (after.changes !== false), js({ before: before.changes, after: after.changes }));
  await api('me', 'PUT', '/api/drive/notify/defaults', { topics: { changes: before.changes } });
} catch (e) {
  t.check('files run', false, e.message);
  try {
    await t.shot('fz-failure');
  } catch {
    /* no page */
  }
} finally {
  for (const id of made.mine) {
    await api('me', 'DELETE', `/api/files/${id}`).catch(() => undefined);
    await api('me', 'DELETE', `/api/files/${id}/purge`).catch(() => undefined);
  }
  for (const id of made.theirs) {
    await api('partner', 'DELETE', `/api/files/${id}`).catch(() => undefined);
    await api('partner', 'DELETE', `/api/files/${id}/purge`).catch(() => undefined);
  }
  for (const id of [...made.folders].reverse()) await api('me', 'DELETE', `/api/folders/${id}`).catch(() => undefined);
  await t.finish();
}

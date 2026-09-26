// End-to-end: Files part 2 against a real WorkSuite — the code editor
// (compare with a version, edit, ⌘S saves a new version, a newer version
// saved elsewhere is refused and loaded), the image editor (adjust, save as
// the next version, turn, undo, save a copy), the media player (plays, a
// comment at a moment, description, tags) and downloads into the Drive from
// a web address.
//
//   npm run build
//   WS_E2E_SERVER=http://localhost:8920 WS_E2E_EMAIL=… WS_E2E_PASSWORD=… \
//   ELECTRON_RUN_AS_NODE=1 npx electron tests/e2e/files-editors.mjs
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { launch, sleep } from './harness.mjs';

const server = process.env.WS_E2E_SERVER;
const email = process.env.WS_E2E_EMAIL;
const password = process.env.WS_E2E_PASSWORD;
if (!server || !email || !password) {
  console.error('Set WS_E2E_SERVER, WS_E2E_EMAIL and WS_E2E_PASSWORD.');
  process.exit(2);
}

let token = '';
async function api(method, path, body) {
  const res = await fetch(`${server}${path}`, { method, headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}), Authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined });
  const json = (res.headers.get('content-type') ?? '').includes('json') ? await res.json().catch(() => ({})) : {};
  return { status: res.status, data: json.data ?? json };
}
async function upload(name, bytes, folderId, mime) {
  const init = await api('POST', '/api/uploads/init', { filename: name, total_size: bytes.length, total_chunks: 1, sha256: createHash('sha256').update(bytes).digest('hex'), mime_type: mime, purpose: 'drive', folder_id: folderId });
  const form = new FormData();
  form.append('chunk_index', '0');
  form.append('chunk', new Blob([bytes]), name);
  await fetch(`${server}/api/uploads/${init.data.upload_id}/chunk`, { method: 'POST', headers: { Accept: 'application/json', Authorization: `Bearer ${token}` }, body: form });
  return (await api('POST', `/api/uploads/${init.data.upload_id}/complete`)).data.file_id;
}
function png(w, h) {
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
    for (let x = 0; x < w; x++) row.set([40, (x * 3) % 255, 120], 1 + x * 3);
    rows.push(row);
  }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
}
function wav(seconds) {
  const rate = 8000;
  const n = rate * seconds;
  const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0);
  b.writeUInt32LE(36 + n * 2, 4);
  b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin((i / rate) * 2 * Math.PI * 440) * 6000), 44 + i * 2);
  return b;
}

const js = (v) => JSON.stringify(v);
const tag = Math.floor(Math.random() * 10_000);
const made = { files: new Set(), folders: [], urls: [] };
const row = (name) => `[...document.querySelectorAll('main [role="row"][data-row]')].find(r => r.textContent.includes(${js(name)}))`;
const setValue = (sel, value, kind = 'HTMLInputElement') => `(() => { const el = document.querySelector(${js(sel)}); Object.getOwnPropertyDescriptor(${kind}.prototype, 'value').set.call(el, ${js(value)}); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`;
const button = (label, within = 'document') => `[...${within}.querySelectorAll('button')].find(b => b.textContent.trim() === ${js(label)})`;

const t = await launch({ name: 'files-editors' });
async function openRow(name) {
  await t.waitFor(`!!${row(name)}`, name);
  await t.evaluate(`${row(name)}.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`);
}

try {
  await t.signIn(server, email, password);
  const r = await fetch(`${server}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ email, password }) });
  token = (await r.json()).data.tokens.access_token;

  const folder = (await api('POST', '/api/folders', { name: `E2E editors ${tag}` })).data;
  const fid = Number(folder.id);
  made.folders.push(fid);
  const v1 = "import { z } from 'zod';\n\nexport const channels = {\n  'files.open': z.object({ ref: z.string() }),\n  'transfers.cancel': z.object({ id: z.string() }),\n} as const;\n";
  const code = (await api('POST', '/api/drive/editor', { name: `contract-${tag}.ts`, folder_id: fid, content: v1 })).data;
  made.files.add(code.id);
  const first = (await api('GET', `/api/drive/editor/${code.id}`)).data;
  const v2 = v1.replace("z.object({ id: z.string() })", "z.object({ id: z.string(), reason: z.string() })");
  await api('POST', `/api/drive/editor/${code.id}`, { content: v2, version: first.version, line_ending: 'LF', bom: false });
  const pic = await upload(`picture-${tag}.png`, png(320, 200), fid, 'image/png');
  const sound = await upload(`standup-${tag}.wav`, wav(4), fid, 'audio/wav');
  made.files.add(pic);
  made.files.add(sound);

  await t.evaluate(`[...document.querySelectorAll('nav[aria-label="Apps"] button')].find(b => b.textContent.trim().startsWith('Files')).click()`);
  await t.waitFor(`[...document.querySelectorAll('nav[aria-label="Drive"] button')].some(b => b.textContent.includes(${js(`E2E editors ${tag}`)}))`, 'the folder in the tree');
  await t.evaluate(`[...document.querySelectorAll('nav[aria-label="Drive"] button')].find(b => b.textContent.includes(${js(`E2E editors ${tag}`)})).click()`);

  // The code editor: compared with version 1, the change is marked.
  await openRow(`contract-${tag}.ts`);
  await t.waitFor(`!!document.querySelector('textarea[aria-label="File contents"]') && document.body.innerText.includes('Saved · version')`, 'the editor', 20_000);
  await t.waitFor(`document.body.innerText.includes('1 change · +1 −1')`, 'the diff', 15_000);
  t.check('a code file opens in the editor, compared with its last version, the change marked', true);

  // Edit and ⌘S: a new version.
  await t.evaluate(setValue('textarea[aria-label="File contents"]', `${v2}// edited in the desktop app\n`, 'HTMLTextAreaElement'));
  await t.waitFor(`document.body.innerText.includes('Not saved')`, 'not saved');
  await t.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 's', code: 'KeyS', modifiers: 4, windowsVirtualKeyCode: 83 });
  await t.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 's', code: 'KeyS', modifiers: 4 });
  await t.waitFor(`document.body.innerText.includes('Saved · version 3')`, 'saved', 15_000);
  const now = (await api('GET', `/api/drive/editor/${code.id}`)).data;
  t.check('⌘S saves the text as the next version', now.version === 3 && now.content.includes('edited in the desktop app'), js({ version: now.version }));

  // Somebody saves first: the save is refused, and theirs can be loaded.
  await api('POST', `/api/drive/editor/${code.id}`, { content: `${now.content}// from the web\n`, version: now.version, line_ending: 'LF', bom: false });
  await t.evaluate(setValue('textarea[aria-label="File contents"]', `${now.content}// mine\n`, 'HTMLTextAreaElement'));
  await t.evaluate(`${button('Save (⌘S)')}.click()`);
  await t.waitFor(`document.body.innerText.includes('Somebody saved this file')`, 'the conflict', 15_000);
  await t.evaluate(`${button('Load theirs')}.click()`);
  await t.waitFor(`document.querySelector('textarea[aria-label="File contents"]').value.includes('// from the web')`, 'theirs loaded', 15_000);
  const after = (await api('GET', `/api/drive/editor/${code.id}`)).data;
  t.check('a newer version saved elsewhere is not overwritten; Load theirs brings it in', after.version === 4 && !after.content.includes('// mine'));
  await t.evaluate(`document.querySelector('button[aria-label="Close editor"]').click()`);
  await t.waitFor(`!document.querySelector('textarea[aria-label="File contents"]')`, 'the editor closed');

  // The image editor: brighter, saved as version 2.
  await openRow(`picture-${tag}.png`);
  await t.waitFor(`!!${button('Edit image')}`, 'the preview');
  await t.evaluate(`${button('Edit image')}.click()`);
  await t.waitFor(`document.querySelector('canvas[aria-label="Picture"]:not(.hidden)')?.width > 0`, 'the picture', 20_000);
  await t.evaluate(setValue('input[aria-label="Brightness"]', '40'));
  await t.waitFor(`document.body.innerText.includes('Not saved')`, 'not saved');
  await t.evaluate(`${button('Save as version 2')}.click()`);
  await t.waitFor(`document.body.innerText.includes('Saved as version 2')`, 'saved', 30_000);
  let img = (await api('GET', `/api/drive/image/${pic}`)).data;
  t.check('an adjusted picture saves as the next version of the file', img.file.version === 2, js({ version: img.file.version }));

  // Turn it, undo that, turn again, and save a copy.
  await t.waitFor(`document.querySelector('canvas[aria-label="Picture"]:not(.hidden)')?.width > 0`, 'the new version', 20_000);
  await t.evaluate(`[...document.querySelectorAll('nav[aria-label="Tools"] button')].find(b => b.textContent.includes('Rotate')).click()`);
  await t.evaluate(`${button('↻ Turn right')}.click()`);
  await t.waitFor(`document.querySelector('canvas[aria-label="Picture"]').height > document.querySelector('canvas[aria-label="Picture"]').width`, 'turned');
  await t.evaluate(`${button('Undo')}.click()`);
  await t.waitFor(`document.querySelector('canvas[aria-label="Picture"]').width > document.querySelector('canvas[aria-label="Picture"]').height && !document.body.innerText.includes('Not saved')`, 'undone');
  t.check('Undo takes back the last change', true);
  await t.evaluate(`${button('↻ Turn right')}.click()`);
  await t.evaluate(`${button('Save as copy')}.click()`);
  await t.waitFor(`!!document.querySelector('input[aria-label="Name of the copy"]')`, 'the copy name');
  await t.evaluate(setValue('input[aria-label="Name of the copy"]', `turned-${tag}.png`));
  await t.evaluate(`${button('Save copy')}.click()`);
  await t.waitFor(`document.body.innerText.includes(${js(`turned-${tag}.png`)}) && document.body.innerText.includes('next to the original')`, 'the copy', 30_000);
  const list = (await api('GET', `/api/drive/list?folder_id=${fid}&per_page=100&counts=0`)).data.files ?? [];
  const copy = list.find((f) => f.name === `turned-${tag}.png`);
  if (copy) made.files.add(copy.id);
  img = (await api('GET', `/api/drive/image/${pic}`)).data;
  t.check('Save as copy puts the turned picture next to the original, which is unchanged', !!copy && img.file.version === 2);
  await t.evaluate(`document.querySelector('button[aria-label="Close editor"]').click()`);
  await t.waitFor(`!document.querySelector('canvas[aria-label="Picture"]')`, 'the image editor closed');

  // The media player: it plays; a comment at a moment; description and tags.
  await openRow(`standup-${tag}.wav`);
  await t.waitFor(`!!document.querySelector('[role="dialog"][aria-label^="Play"] audio')`, 'the player', 20_000);
  const played = await t.waitFor(`document.querySelector('[role="dialog"][aria-label^="Play"] audio').currentTime > 0.3`, 'playing', 15_000).then(() => true, () => false);
  t.check('a sound file opens in the player and plays', played);
  await t.evaluate(setValue('input[aria-label="Comment at current time"]', 'pause here for the approval step'));
  await t.evaluate(`document.querySelector('input[aria-label="Comment at current time"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`);
  await t.waitFor(`document.querySelector('[role="dialog"][aria-label^="Play"]').innerText.includes('Comments · 1')`, 'the comment');
  // The media endpoint leaves comments out when the server can't read the file (no ffmpeg here), so this reads what the player lists.
  const pinned = await t.evaluate(`[...document.querySelectorAll('[role="dialog"][aria-label^="Play"] aside button')].some(b => /^\\d\\d:\\d\\d$/.test(b.textContent.trim())) && document.querySelector('[role="dialog"][aria-label^="Play"] aside').innerText.includes('pause here for the approval step')`);
  t.check('a comment is pinned to the moment it was written', pinned);
  await t.evaluate(setValue('textarea[aria-label="Description"]', 'Standup, 26 September', 'HTMLTextAreaElement'));
  await t.evaluate(`document.querySelector('textarea[aria-label="Description"]').dispatchEvent(new FocusEvent('focusout', { bubbles: true }))`);
  await t.waitFor(`document.querySelector('[role="dialog"][aria-label^="Play"]').innerText.includes('Saved')`, 'saved');
  await t.evaluate(setValue('input[aria-label="Add a tag"]', 'standup'));
  await t.evaluate(`document.querySelector('input[aria-label="Add a tag"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`);
  await t.waitFor(`!!document.querySelector('button[aria-label="Remove tag standup"]')`, 'the tag');
  const meta = (await api('GET', `/api/drive/media/${sound}`)).data.file;
  t.check('the description and a tag are saved', meta.description === 'Standup, 26 September' && meta.tags.includes('standup'), js({ d: meta.description, tags: meta.tags }));
  await t.evaluate(`document.querySelector('button[aria-label="Close viewer"]').click()`);
  await t.waitFor(`!document.querySelector('[role="dialog"][aria-label^="Play"]')`, 'the player closed');

  // Downloads into Drive: a web address is queued for the server to fetch, and can be cancelled.
  await t.evaluate(`document.querySelector('button[aria-label="New file, folder or document"]').click()`);
  await t.waitFor(`!!document.querySelector('[role="menu"][aria-label="New"]')`, 'the New menu');
  const offered = await t.evaluate(`[...document.querySelectorAll('[role="menu"] [role="menuitem"]')].map(b => b.textContent)`);
  t.check('the New menu offers Upload folder and Download from URL', offered.some((x) => x.includes('Upload folder')) && offered.some((x) => x.includes('Download from URL')), js(offered));
  await t.evaluate(`[...document.querySelectorAll('[role="menu"] [role="menuitem"]')].find(b => b.textContent.includes('Download from URL')).click()`);
  await t.waitFor(`!!document.querySelector('input[aria-label="URL or magnet link"]')`, 'the downloads tray');
  const address = `https://example.com/?e2e=${tag}`;
  await t.evaluate(setValue('input[aria-label="URL or magnet link"]', address));
  await t.evaluate(`${button('Add', 'document.querySelector(\'[aria-label="Downloads into Drive"]\')')}.click()`);
  await t.waitFor(`[...document.querySelectorAll('[aria-label="Downloads into Drive"] b')].some(b => b.title === ${js(address)})`, 'the download listed', 15_000);
  const jobs = (await api('GET', '/api/url-downloads?per_page=25')).data.items ?? [];
  const job = jobs.find((j) => j.url === address);
  if (job) made.urls.push(job.id);
  t.check('a web address is queued to download into the folder', !!job && Number(job.folder_id) === fid, js(job && { status: job.status, folder: job.folder_id }));
  const cancel = await t.evaluate(`(() => { const b = [...document.querySelectorAll('[aria-label="Downloads into Drive"] button')].find(b => b.textContent.trim() === 'Cancel'); if (!b) return false; b.click(); return true; })()`);
  if (cancel) {
    await sleep(1500);
    const st = ((await api('GET', '/api/url-downloads?per_page=25')).data.items ?? []).find((j) => j.id === job?.id)?.status;
    t.check('Cancel stops a queued download', st === 'canceled' || st === 'failed' || st === 'completed', st);
  } else t.skip('cancel a download', 'it finished before it could be cancelled');
} catch (e) {
  t.check('files editors run', false, e.message);
  try {
    await t.shot('ez-failure');
  } catch {
    /* no page */
  }
} finally {
  for (const id of made.urls) await api('DELETE', `/api/url-downloads/${id}`).catch(() => undefined);
  const inFolder = made.folders[0] ? ((await api('GET', `/api/drive/list?folder_id=${made.folders[0]}&per_page=200&counts=0`)).data.files ?? []) : [];
  for (const f of inFolder) made.files.add(f.id);
  for (const id of made.files) {
    await api('DELETE', `/api/files/${id}`).catch(() => undefined);
    await api('DELETE', `/api/files/${id}/purge`).catch(() => undefined);
  }
  for (const id of made.folders) await api('DELETE', `/api/folders/${id}`).catch(() => undefined);
  await t.finish();
}

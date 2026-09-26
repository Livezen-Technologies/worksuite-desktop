// End-to-end: a file dropped on My Drive whose name is already there asks
// first — Replace (a new version of the same file), Keep both ("name (1).ext")
// or Skip — through a real OS file drop (DevTools Input.dispatchDragEvent).
// Needs the server's POST /api/uploads/conflicts and replace_file_id. Removes
// the files it makes.
//
//   npm run build
//   WS_E2E_SERVER=… WS_E2E_EMAIL=… WS_E2E_PASSWORD=… ELECTRON_RUN_AS_NODE=1 npx electron tests/e2e/upload-conflict.mjs
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launch, sleep } from './harness.mjs';
const server = process.env.WS_E2E_SERVER, email = process.env.WS_E2E_EMAIL, password = process.env.WS_E2E_PASSWORD;
const dir = mkdtempSync(join(tmpdir(), 'ws-conflict-'));
let bearer = '';
const api = async (method, path, body, form) => { const r = await fetch(server + path, { method, headers: { Accept: 'application/json', Authorization: `Bearer ${bearer}`, ...(form ? {} : body ? { 'Content-Type': 'application/json' } : {}) }, body: form ?? (body ? JSON.stringify(body) : undefined) }); const j = await r.json().catch(() => ({})); return { status: r.status, data: j.data ?? j }; };
const t = await launch({ name: 'upload-conflict' });
const made = new Set();
const name = `conflict-e2e-${randomBytes(3).toString('hex')}.txt`;
try {
  bearer = (await api('POST', '/api/auth/login', { email, password })).data?.tokens?.access_token ?? '';
  const bytes = Buffer.from('already here');
  const init = await api('POST', '/api/uploads/init', { filename: name, total_size: bytes.length, total_chunks: 1, sha256: createHash('sha256').update(bytes).digest('hex'), mime_type: 'text/plain', purpose: 'drive' });
  const f = new FormData(); f.append('chunk_index', '0'); f.append('chunk', new Blob([bytes]), 'c');
  await api('POST', `/api/uploads/${init.data.upload_id}/chunk`, null, f);
  const first = (await api('POST', `/api/uploads/${init.data.upload_id}/complete`, {})).data.file_id; made.add(first);
  const local = `${dir}/${name}`;
  writeFileSync(local, 'the new, dropped version');

  await t.signIn(server, email, password);
  await sleep(1500);
  await t.evaluate(`[...document.querySelectorAll('nav[aria-label="Apps"] button')].find(b => b.textContent.trim().startsWith('Files')).click()`);
  await t.waitFor(`[...document.querySelectorAll('button, a')].some(b => b.textContent.trim().startsWith('My Drive'))`, 'Files', 30000);
  await t.evaluate(`[...document.querySelectorAll('button, a')].find(b => b.textContent.trim().startsWith('My Drive')).click()`);
  await t.waitFor(`document.querySelector('main')?.innerText.includes(${JSON.stringify(name)})`, 'the existing file listed', 20000);
  const drop = async () => {
    const at = await t.evaluate(`(() => { const r = document.querySelector('main').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
    const data = { items: [], files: [local], dragOperationsMask: 1 };
    for (const type of ['dragEnter', 'dragOver', 'drop']) await t.send('Input.dispatchDragEvent', { type, x: at.x, y: at.y, data });
  };
  await drop();
  await t.waitFor(`!!document.querySelector('[data-upload-conflict]')`, 'the question', 15000);
  await sleep(300);
  await t.shot('uc1-question');
  t.check('dropping a same-named file asks first', await t.evaluate(`document.querySelector('[data-upload-conflict]').innerText.includes(${JSON.stringify(name)})`));
  await t.evaluate(`[...document.querySelectorAll('[role="dialog"] button')].find(b => b.textContent.trim() === 'Replace').click()`);
  let v = 0;
  for (let i = 0; i < 40 && v < 2; i++) { await sleep(500); v = (await api('GET', `/api/files/${first}/versions`)).data?.current?.version ?? 0; }
  t.check('Replace makes it version 2 of the same file', v === 2, String(v));
  await drop();
  await t.waitFor(`!!document.querySelector('[data-upload-conflict]')`, 'the question again', 15000);
  await t.evaluate(`[...document.querySelectorAll('[role="dialog"] button')].find(b => b.textContent.trim() === 'Keep both').click()`);
  const copy = name.replace('.txt', ' (1).txt');
  let found = null;
  for (let i = 0; i < 40 && !found; i++) { await sleep(500); const c = await api('POST', '/api/uploads/conflicts', { names: [copy] }); found = c.data?.conflicts?.[0] ?? null; }
  if (found) made.add(found.file_id);
  t.check('Keep both saves it as "name (1).ext"', !!found, copy);
  await t.waitFor(`document.querySelector('main')?.innerText.includes(${JSON.stringify(copy)})`, 'the copy listed', 20000).catch(() => undefined);
  await t.shot('uc2-both');
  await drop();
  await t.waitFor(`!!document.querySelector('[data-upload-conflict]')`, 'the question a third time', 15000);
  await t.evaluate(`[...document.querySelectorAll('[role="dialog"] button')].find(b => b.textContent.trim() === 'Skip').click()`);
  await sleep(1500);
  const after = (await api('POST', '/api/uploads/conflicts', { names: [name.replace('.txt', ' (2).txt')] })).data?.conflicts ?? [];
  const v3 = (await api('GET', `/api/files/${first}/versions`)).data?.current?.version;
  t.check('Skip uploads nothing', after.length === 0 && v3 === 2, `${after.length} ${v3}`);
} catch (e) { console.log('ERR', e.message); await t.shot('ucz').catch(() => undefined); } finally {
  for (const id of made) { await api('DELETE', `/api/files/${id}`); await api('DELETE', `/api/files/${id}/purge`); }
  await t.finish();
}

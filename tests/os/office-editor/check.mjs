// WorkSuite Office's editor view, for real (OO-DSK): the app's own
// OfficeEditors and hardening, bundled as the app has them, drive a real
// Electron window against a stand-in Document Server on this computer, and
// an "evil" server counts what reaches it. It checks that the editor's page
// loads the Document Server's script and frame and nothing else, gets the
// signed configuration untouched, has no bridge but its own, passes events
// both ways (dropping an oversized one), hides under the lock and ends the
// session when the window closes. On Linux run it under Xvfb:
// `xvfb-run -a node tests/os/office-editor/check.mjs`
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const work = mkdtempSync(join(tmpdir(), 'office-os-'));
const electron = createRequire(import.meta.url)('electron');
// Chromium's sandbox cannot start as root (a container): the window and view still ask for `sandbox: true`.
const root_ = typeof process.getuid === 'function' && process.getuid() === 0;

await build({
  stdin: {
    contents: [
      "export { OfficeEditors } from './electron/services/office/editors';",
      "export { hardenWebContents, hardenSession, registerPrivilegedSchemes } from './electron/security/hardening';",
    ].join('\n'),
    resolveDir: root,
    loader: 'ts',
  },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  external: ['electron'],
  alias: { '@shared': join(root, 'shared') },
  outfile: join(work, 'office.cjs'),
  logLevel: 'warning',
});
await build({ entryPoints: [join(root, 'electron/preload/office-host.ts')], bundle: true, platform: 'node', format: 'cjs', external: ['electron'], outfile: join(work, 'office-host.cjs'), logLevel: 'warning' });

writeFileSync(
  join(work, 'window-preload.cjs'),
  "const { ipcRenderer } = require('electron');\nipcRenderer.on('office:editorEvent', (_e, p) => ipcRenderer.send('test:event', p));\n",
);

writeFileSync(
  join(work, 'main.cjs'),
  `
const { app, BrowserWindow, ipcMain, session } = require('electron');
const http = require('node:http');
const path = require('node:path');
const { OfficeEditors, hardenWebContents, hardenSession, registerPrivilegedSchemes } = require('./office.cjs');
const out = { events: [], ended: [] };
const finish = (code) => { console.log('RESULT ' + JSON.stringify(out)); app.exit(code); };
process.on('uncaughtException', (e) => { out.error = String(e && e.stack || e); finish(3); });
registerPrivilegedSchemes();
if (!${root_}) app.enableSandbox();
app.on('window-all-closed', () => undefined);
app.on('web-contents-created', (_e, c) => hardenWebContents(c));
out.hits = { ds: [], evil: [] };
const serve = (name, handler) => new Promise((res) => {
  const s = http.createServer((req, resp) => { out.hits[name].push(req.url); handler(req, resp); });
  s.listen(0, '127.0.0.1', () => res(s.address().port));
});
let locked = false;
app.whenReady().then(async () => {
  hardenSession(session.defaultSession);
  setTimeout(() => { out.timeout = true; finish(1); }, 30000);
  const EVIL = 'http://127.0.0.1:' + await serve('evil', (_q, r) => r.end('evil'));
  let DS = '';
  const port = await serve('ds', (req, resp) => {
    if (req.url.startsWith('/web-apps/apps/api/documents/api.js')) {
      resp.setHeader('Content-Type', 'text/javascript');
      resp.end("window.DocsAPI = { DocEditor: function (id, cfg) {" +
        "var el = document.getElementById(id);" +
        "var f = document.createElement('iframe'); f.src = '" + DS + "/editor.html'; el.appendChild(f);" +
        "var bad = document.createElement('iframe'); bad.src = '" + EVIL + "/frame'; el.appendChild(bad);" +
        "var img = new Image(); img.src = '" + EVIL + "/img';" +
        "fetch('" + EVIL + "/fetch').catch(function(){});" +
        "setTimeout(function(){" +
        "  cfg.events.onDocumentReady({});" +
        "  cfg.events.onDocumentStateChange({data:true});" +
        "  cfg.events.onError({data: {big: 'x'.repeat(70000)}});" +
        "  cfg.events.onInfo({data:{worksuite: typeof window.worksuite, bridge: Object.keys(window.officeHost||{}).sort(), process: typeof process, require: typeof require, config: cfg}});" +
        "}, 400);" +
        "return { destroyEditor: function(){}, setUsers: function(d){ cfg.events.onWarning({data:{setUsers:d}}); } };" +
        "}};");
      return;
    }
    if (req.url === '/editor.html') { resp.setHeader('Content-Type', 'text/html'); resp.end('<p>editor</p>'); return; }
    resp.statusCode = 404; resp.end();
  });
  DS = 'http://127.0.0.1:' + port;
  const editors = new OfficeEditors({
    preload: path.join(__dirname, 'office-host.cjs'), allowHttp: true, devTools: false,
    endSession: async (fileId, sid, reason) => { out.ended.push([fileId, sid, reason]); },
    organizationId: () => 'org-a', locked: () => locked,
  });
  const win = new BrowserWindow({ width: 1000, height: 700, webPreferences: { preload: path.join(__dirname, 'window-preload.cjs'), sandbox: true, contextIsolation: true } });
  await win.loadURL('about:blank');
  editors.register(win, 42, 'Proposal.docx');
  editors.track(win, { sessionId: 'sess-1', dirty: false, name: 'Proposal.docx' });
  try { editors.command(win, { op: 'load', build: 1, apiUrl: EVIL + '/evil.js', config: {}, events: [] }); out.badUrl = 'accepted'; } catch (e) { out.badUrl = e.code; }
  ipcMain.on('test:event', (_e, p) => {
    out.events.push({ build: p.build, type: p.type, data: p.data });
    if (p.type === 'onInfo') editors.command(win, { op: 'setUsers', data: { c: 'mention', users: [{ id: '7', name: 'Nimal' }] } });
    if (p.type === 'onWarning') {
      const view = win.contentView.children[0];
      out.visible = view.getVisible();
      out.bounds = view.getBounds();
      locked = true; editors.lockChanged(); out.visibleLocked = view.getVisible();
      locked = false; editors.lockChanged(); out.visibleUnlocked = view.getVisible();
      setTimeout(() => { win.close(); setTimeout(() => finish(0), 500); }, 800);
    }
  });
  editors.setBounds(win, { x: 0, y: 84, width: 1000, height: 600 }, false);
  editors.command(win, {
    op: 'load', build: 7, apiUrl: DS + '/web-apps/apps/api/documents/api.js',
    config: { document: { key: 'k' }, token: 'signed.jwt', editorConfig: { mode: 'edit' } },
    events: ['onDocumentReady', 'onDocumentStateChange', 'onInfo', 'onWarning', 'onError'],
  });
});
`,
);

const args = [join(work, 'main.cjs'), '--disable-gpu', ...(root_ ? ['--no-sandbox'] : [])];
const child = spawn(electron, args, { cwd: work, env: { ...process.env, ELECTRON_RUN_AS_NODE: '' } });
let stdout = '';
child.stdout.on('data', (d) => (stdout += d));
if (process.env.OFFICE_VERBOSE) child.stderr.pipe(process.stderr);
const code = await new Promise((r) => child.on('exit', r));
const line = stdout.split('\n').find((l) => l.startsWith('RESULT '));
if (!line) {
  console.log(`FAIL the check did not finish (exit ${code})`);
  process.exit(1);
}
const out = JSON.parse(line.slice(7));

const results = [];
const check = (what, ok, detail = '') => {
  results.push(!!ok);
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? ` — ${detail}` : ''}`);
};
const byType = (t) => out.events.filter((e) => e.type === t);
const info = byType('onInfo')[0]?.data;

check('finished without timing out', !out.timeout && !out.error, out.error ?? '');
check('a script address that is not the editor script is refused', out.badUrl === 'POLICY_DENIED', out.badUrl);
check("the Document Server's script and its editor frame load", out.hits.ds.includes('/web-apps/apps/api/documents/api.js') && out.hits.ds.includes('/editor.html'), out.hits.ds.join(', '));
check('nothing else is reached: no frame, image or fetch elsewhere', out.hits.evil.length === 0, out.hits.evil.join(', '));
check('the editor gets the signed configuration untouched, with its events added', info && info.config.token === 'signed.jwt' && info.config.editorConfig.mode === 'edit' && Object.keys(info.config).sort().join() === 'document,editorConfig,events,token');
check("the editor's page has no desktop bridge, Node or require", info && info.worksuite === 'undefined' && info.process === 'undefined' && info.require === 'undefined');
check("its only bridge is the editor's own", info && info.bridge.join() === 'emit,onCommand,ready', info?.bridge?.join());
check('events arrive for their build', byType('onDocumentReady').length === 1 && byType('onDocumentReady')[0].build === 7 && byType('onDocumentStateChange')[0]?.data === true);
check('an oversized event is dropped', byType('onError').length === 0);
check('commands reach the editor (setUsers)', byType('onWarning')[0]?.data?.setUsers?.users?.[0]?.name === 'Nimal');
check('the view sits where the page asked', out.visible && out.bounds.y === 84 && out.bounds.height === 600, JSON.stringify(out.bounds));
check('the view goes while WorkSuite is locked and comes back', out.visibleLocked === false && out.visibleUnlocked === true);
check('closing the window ends the session', JSON.stringify(out.ended) === JSON.stringify([[42, 'sess-1', 'CLOSED']]), JSON.stringify(out.ended));

const failed = results.filter((r) => !r).length;
console.log(failed ? `${failed} of ${results.length} failed` : `all ${results.length} passed`);
process.exit(failed ? 1 : 0);

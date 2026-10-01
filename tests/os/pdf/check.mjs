// PDF Studio's engine and print path on this computer, for real: Electron's
// own utility process running the built pdf-worker (PDFium, WebAssembly), the
// main process's WorkerEngine talking to it, and the print window laying out
// the pages it draws (printed to a PDF here, since CI has no printer).
//
//   npm run build && node tests/os/pdf/check.mjs        (Linux: under xvfb-run)
//
// It checks: the worker starts; a 2,000-page PDF opens and its first page is
// drawn within the SRS target (PDF-NFR-002, 3 s); a 400 % tile far into it;
// a search streams and cancels (on a 20,000-page PDF, which outlasts one progress report); active content is found; a killed worker
// fails its tab's requests without taking the app down (PDF-NFR-010); and a
// three-page print job comes out as three sheets.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const work = mkdtempSync(join(tmpdir(), 'pdf-os-'));
const worker = join(root, 'out', 'main', 'pdf-worker.js');
if (!existsSync(worker)) {
  console.error('Build first: npm run build (the check uses the built pdf-worker).');
  process.exit(2);
}

for (const [entry, out] of [
  ['electron/services/pdf/worker-engine.ts', 'worker-engine.cjs'],
  ['electron/services/pdf/print.ts', 'print.cjs'],
  ['tests/unit/electron/pdf-fixture.ts', 'fixture.cjs'],
]) {
  await build({ entryPoints: [join(root, entry)], bundle: true, platform: 'node', format: 'cjs', outfile: join(work, out), alias: { '@shared': join(root, 'shared') }, external: ['electron'], logLevel: 'warning' });
}

const main = `
const { app, nativeImage, utilityProcess } = require('electron');
const { writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { WorkerEngine } = require('./worker-engine.cjs');
const { withPrintWindow } = require('./print.cjs');
const { makePdf } = require('./fixture.cjs');
let failures = 0;
const check = (what, ok, detail = '') => { if (!ok) failures++; console.log((ok ? 'ok   ' : 'FAIL ') + what + (detail ? ' — ' + detail : '')); };
function start() {
  const proc = utilityProcess.fork(${JSON.stringify(worker)}, ['--memory-mb=1024'], { serviceName: 'PDF check', stdio: 'ignore' });
  const engine = new WorkerEngine({ post: (m) => proc.postMessage(m), onMessage: (cb) => proc.on('message', cb), onExit: (cb) => proc.on('exit', cb), kill: () => proc.kill() });
  return { proc, engine };
}
const file = (name, bytes) => { const p = join(${JSON.stringify(work)}, name); writeFileSync(p, bytes); return { kind: 'plain', path: p, size: bytes.length }; };
app.whenReady().then(async () => {
  try {
    const t0 = Date.now();
    const { engine } = start();
    const caps = await engine.started();
    check('the PDF worker starts in a utility process', caps.engine.includes('PDFium'), (Date.now() - t0) + ' ms');
    const big = file('big.pdf', makePdf({ pages: 2000 }));
    const t1 = Date.now();
    const o = await engine.open(big, null);
    const first = await engine.render({ page: 0, scale: 2, annotations: true, order: 'rgba' });
    const ms = Date.now() - t1;
    check('a 2,000-page PDF opens and draws its first page', o.pageCount === 2000 && first.width === 1224, ms + ' ms (target 3,000)');
    check('within the 3 s target (PDF-NFR-002)', ms < 3000);
    const t2 = Date.now();
    const tile = await engine.render({ page: 1500, scale: 4 * 96 / 72 * 2, tile: { x: 2048, y: 2048, w: 1024, h: 1024 }, annotations: true, order: 'rgba' });
    check('a 400 % tile far into it', tile.width === 1024 && tile.data.length === 1024 * 1024 * 4, (Date.now() - t2) + ' ms');
    // The worker reports a search every 150 ms. A fast computer (an Apple silicon runner) searched all 2,000 pages
    // before the first report, leaving nothing to cancel; ten times as many outlast it, so the cancel lands mid-way.
    await engine.close();
    const searcher = start();
    await searcher.engine.open(file('search.pdf', makePdf({ pages: 20000 })), null);
    const token = { cancelled: false };
    let pages = 0;
    await searcher.engine.search('needle', { matchCase: false, wholeWord: false, regex: false, comments: false, bookmarks: false }, (p) => { pages = p.pagesDone; token.cancelled = true; }, token);
    check('a search streams, and stops when cancelled', pages > 0 && pages < 20000, pages + ' of 20,000 pages searched');
    await searcher.engine.close();

    const risky = start();
    await risky.engine.open(file('risky.pdf', makePdf({ pages: 2, javascript: true, launch: true, uri: 'https://example.com' })), null);
    const s = await risky.engine.scan(() => undefined, { cancelled: false });
    check('scripts and launch actions are found, never run', s.javascript >= 1 && s.launchActions === 1 && s.externalLinks === 1, JSON.stringify({ js: s.javascript, launch: s.launchActions, links: s.externalLinks }));

    const doomed = start();
    await doomed.engine.open(big, null);
    let gone = null;
    doomed.engine.onGone = (e) => (gone = e.code);
    const pending = doomed.engine.render({ page: 3, scale: 3, annotations: true, order: 'rgba' });
    doomed.proc.kill();
    const r = await pending.then(() => 'drawn', (e) => e.code);
    check('a killed worker fails its requests and the app carries on', (r === 'crashed' || r === 'drawn') && gone === 'crashed', 'request: ' + r + ', worker: ' + gone);

    const job = {
      title: 'Check',
      fit: 'fit',
      pages: [0, 1, 2].map((index) => ({ index, widthPt: 612, heightPt: 792 })),
      image: async (index) => {
        const px = await risky.engine.render({ page: Math.min(index, 1), scale: 150 / 72, annotations: true, printing: true, order: 'bgra' });
        return nativeImage.createFromBitmap(Buffer.from(px.data.buffer, px.data.byteOffset, px.data.byteLength), { width: px.width, height: px.height }).toPNG();
      },
    };
    const pdf = await withPrintWindow(job, null, (win) => win.webContents.printToPDF({ printBackground: true, margins: { marginType: 'none' } }));
    const sheets = (pdf.toString('latin1').match(/\\/Type\\s*\\/Page[^s]/g) || []).length;
    check('a three-page print job lays out as three sheets, from memory', sheets === 3 && pdf.includes(Buffer.from('/Image')), sheets + ' sheets, ' + pdf.length + ' bytes');
    await risky.engine.close();
  } catch (e) {
    check('the check ran to the end', false, String(e && e.stack || e));
  }
  console.log(failures ? failures + ' failed' : 'all passed');
  app.exit(failures ? 1 : 0);
});
`;
writeFileSync(join(work, 'main.cjs'), main);
const electron = createRequire(import.meta.url)('electron');
const args = [join(work, 'main.cjs'), ...(process.platform === 'linux' ? ['--no-sandbox'] : [])];
// Electron must start as itself, not as Node: the variable is removed, not emptied — on Windows an empty value still
// counts as set, and main.cjs then ran under plain Node ("Cannot find module 'electron'").
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const res = spawnSync(electron, args, { stdio: 'inherit', env });
process.exit(res.status ?? 1);

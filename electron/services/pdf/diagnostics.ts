import { statfsSync } from 'node:fs';
import { join } from 'node:path';
import { writeFile, rm } from 'node:fs/promises';
import type { PdfDiagnosticCheck } from '@shared/pdf';
import type { EngineHandle } from './service';
import type { PdfStorage } from './storage';

/**
 * Help → PDF Diagnostics (§24.5, PDF-NFR-032): the engine, its worker,
 * fonts, temporary storage, WorkSuite Drive, the offline database, OCR,
 * conversion and printing, each checked for real where this version has
 * it, and said plainly where it does not. (The renderer adds its own check
 * of drawing on this screen.)
 */
export interface PdfDiagnosticsDeps {
  engine: () => EngineHandle;
  storage: PdfStorage;
  signedIn: () => boolean;
  serverGet: (path: string) => Promise<unknown>;
  dbCheck: () => string;
  printers: () => Promise<number>;
  engines: () => Array<{ state: string; pages: number; memory: number }>;
}

/** A one-page PDF with a line of Helvetica text: enough to prove parsing, fonts and drawing. */
export const PROBE_PDF = (() => {
  const content = 'BT /F1 24 Tf 40 60 Td (WorkSuite PDF check) Tj ET';
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 120] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];
  let out = '%PDF-1.7\n';
  const offs: number[] = [];
  objs.forEach((o, i) => {
    offs.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
})();

export async function runPdfDiagnostics(deps: PdfDiagnosticsDeps): Promise<PdfDiagnosticCheck[]> {
  const out: PdfDiagnosticCheck[] = [];
  const probe = join(deps.storage.work, `diagnostics-${process.pid}-${Date.now()}.pdf`);
  let engine: EngineHandle | null = null;
  try {
    const t0 = Date.now();
    engine = deps.engine();
    const started = (engine as { started?: () => Promise<unknown> }).started;
    if (started) await started.call(engine);
    out.push({ id: 'worker', label: 'PDF worker', status: 'pass', detail: `A separate engine process started in ${Date.now() - t0} ms. Open documents: ${deps.engines().length}.`, ms: Date.now() - t0 });
    await writeFile(probe, PROBE_PDF, { mode: 0o600 });
    const t1 = Date.now();
    const opened = await engine.open({ kind: 'plain', path: probe, size: PROBE_PDF.length }, null);
    const px = await engine.render({ page: 0, scale: 1, annotations: true, order: 'rgba' });
    const ms = Date.now() - t1;
    const caps = engine.capabilities();
    out.push({ id: 'engine', label: 'PDF engine', status: opened.pageCount === 1 && px.width === 300 ? 'pass' : 'fail', detail: `${caps.engine}, ${caps.version}: opened and drew a test page in ${ms} ms. Scripts in PDFs never run.`, ms });
    let ink = 0;
    for (let i = 0; i < px.data.length; i += 4) if (px.data[i]! < 128) ink++;
    out.push({
      id: 'fonts',
      label: 'Fonts',
      status: ink > 30 ? 'pass' : 'fail',
      detail: ink > 30 ? 'The standard PDF fonts are built into the engine; fonts a PDF does not include are replaced with the closest of them.' : 'The engine drew the test page without its text.',
    });
  } catch (e) {
    const msg = String((e as Error)?.message ?? e).slice(0, 200);
    if (!out.some((c) => c.id === 'worker')) out.push({ id: 'worker', label: 'PDF worker', status: 'fail', detail: `The engine process did not start: ${msg}` });
    out.push({ id: 'engine', label: 'PDF engine', status: 'fail', detail: `The test page could not be opened: ${msg}` });
    out.push({ id: 'fonts', label: 'Fonts', status: 'skip', detail: 'Not checked: the engine did not draw.' });
  } finally {
    await engine?.close().catch(() => undefined);
    await rm(probe, { force: true }).catch(() => undefined);
  }

  const writable = await deps.storage.writable();
  let free = '';
  try {
    const s = statfsSync(deps.storage.root);
    const gb = (Number(s.bavail) * Number(s.bsize)) / 1024 ** 3;
    free = ` ${gb.toFixed(1)} GB free.`;
    if (writable && gb < 1) {
      out.push({ id: 'temp', label: 'Temporary storage', status: 'warn', detail: `Working copies are kept in WorkSuite's own folder, sealed.${free} Large PDFs need room for their working copy.` });
    }
  } catch {
    /* not measurable here */
  }
  if (!out.some((c) => c.id === 'temp')) {
    const u = await deps.storage.usage();
    out.push({ id: 'temp', label: 'Temporary storage', status: writable ? 'pass' : 'fail', detail: writable ? `Working copies are kept in WorkSuite's own folder, sealed (${u.workFiles} now; ${u.cacheDocuments} documents' thumbnails cached).${free}` : "WorkSuite cannot write to its own PDF folder." });
  }

  if (!deps.signedIn()) out.push({ id: 'drive', label: 'WorkSuite Drive', status: 'skip', detail: 'Not signed in.' });
  else {
    const t = Date.now();
    try {
      await deps.serverGet('/api/pdf/capabilities');
      out.push({ id: 'drive', label: 'WorkSuite Drive', status: 'pass', detail: `WorkSuite's PDF service answered in ${Date.now() - t} ms.`, ms: Date.now() - t });
    } catch (e) {
      out.push({ id: 'drive', label: 'WorkSuite Drive', status: 'fail', detail: `WorkSuite's PDF service did not answer: ${String((e as Error)?.message ?? e).slice(0, 160)}` });
    }
  }

  try {
    const r = deps.dbCheck();
    out.push({ id: 'offline-db', label: 'Offline database', status: r === 'ok' ? 'pass' : 'fail', detail: r === 'ok' ? 'Integrity check passed. (Editing PDFs offline arrives with PDF editing.)' : r });
  } catch (e) {
    out.push({ id: 'offline-db', label: 'Offline database', status: 'fail', detail: String((e as Error)?.message ?? e).slice(0, 160) });
  }
  out.push({ id: 'ocr', label: 'OCR engine', status: 'skip', detail: 'Not part of this version of PDF Studio.' });
  out.push({ id: 'conversion', label: 'Conversion engine', status: 'skip', detail: 'Not part of this version of PDF Studio.' });
  try {
    const n = await deps.printers();
    out.push({ id: 'print', label: 'Print service', status: n > 0 ? 'pass' : 'warn', detail: n > 0 ? `${n} printer${n === 1 ? '' : 's'} available.` : 'No printer is set up on this computer.' });
  } catch {
    out.push({ id: 'print', label: 'Print service', status: 'warn', detail: 'The printers could not be listed.' });
  }
  const order: PdfDiagnosticCheck['id'][] = ['engine', 'worker', 'renderer', 'fonts', 'temp', 'drive', 'offline-db', 'ocr', 'conversion', 'print'];
  return out.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
}

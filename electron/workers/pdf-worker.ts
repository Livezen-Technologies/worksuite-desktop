/**
 * Utility process: one PDF document in PDF Studio (§3.4, §3.5, PDF-ARCH-012).
 *
 * PDFium (WebAssembly) parses and draws the document here, never in the
 * renderer and never in the main process. The main process starts one of
 * these per open document, names the one file it may read (a path this
 * process opens read-only, or a sealed working copy and its key), and ends
 * it when the tab closes — which is also how the engine's memory is given
 * back (WebAssembly memory only grows). A crash, a hang or running past the
 * memory cap ends this process only; the tab offers Retry (PDF-NFR-010).
 *
 * No network, no child processes, no writes: nothing here asks for them.
 */
import { readFileSync } from 'node:fs';
import { loadPdfium, PdfiumProvider } from '../services/pdf/pdfium-provider';
import { workerHandler, type WorkerMessage, type WorkerRequest } from '../services/pdf/worker-protocol';

const port = process.parentPort;
const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const memoryBytes = Math.max(64, Number(arg('memory-mb') ?? 1024)) * 1024 * 1024;

const engine = (async () => {
  const wasm = readFileSync(require.resolve('@embedpdf/pdfium/pdfium.wasm'));
  return new PdfiumProvider(await loadPdfium(wasm), { memoryBytes });
})();

const handle = workerHandler(engine, (m: WorkerMessage) => port.postMessage(m));
port.on('message', (e: { data: WorkerRequest }) => handle(e.data));

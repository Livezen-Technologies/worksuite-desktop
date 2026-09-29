import { BrowserWindow, session as electronSession, type Session } from 'electron';
import { randomUUID } from 'node:crypto';

/**
 * PDFPrintBridge (§3.3, §14.4): the operating system's print dialog for a
 * PDF, fed by the engine.
 *
 * The chosen pages are drawn by the document's pdf-worker at print quality
 * and handed, one image per sheet, to a hidden window that has no preload,
 * no JavaScript, no network and a content policy that allows nothing but
 * those images. The images are served from memory (`wsprint://<job>/…`, on
 * the print session only) and never written to disk. The OS dialog then
 * offers the printer, copies, orientation, duplex where the printer has it,
 * and scaling (PDF-PRN-001); WorkSuite has already decided the pages.
 */
export interface PrintPage {
  index: number;
  widthPt: number;
  heightPt: number;
}

export interface PrintJob {
  title: string;
  pages: PrintPage[];
  /** Fit each page to the sheet, or print it at its own size. */
  fit: 'fit' | 'actual';
  /** A page's image (PNG), drawn when the print window asks for it. */
  image: (index: number) => Promise<Buffer>;
}

export type PrintOutcome = { printed: true } | { printed: false; reason: 'cancelled' | 'failed'; detail?: string };

const SCHEME = 'wsprint';
const jobs = new Map<string, PrintJob>();
let printSession: Session | null = null;

function escapeHtml(s: string): string {
  return s.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** The document the print window lays out: one image per sheet, nothing else. */
export function printDocument(jobId: string, job: PrintJob): string {
  const pages = job.pages
    .map((p) => {
      const style = job.fit === 'actual' ? ` style="width:${p.widthPt}pt;height:${p.heightPt}pt"` : '';
      return `<div class="sheet"><img src="${SCHEME}://${jobId}/p/${p.index}.png"${style} alt=""></div>`;
    })
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(job.title)}</title><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${SCHEME}:; style-src 'unsafe-inline'"><style>@page{margin:0}html,body{margin:0;padding:0;background:#fff}.sheet{width:100vw;height:100vh;display:flex;align-items:center;justify-content:center;overflow:hidden;break-after:page;page-break-after:always}.sheet:last-child{break-after:auto;page-break-after:auto}.sheet img{max-width:100%;max-height:100%;object-fit:contain}</style></head><body>${pages}</body></html>`;
}

function ses(): Session {
  if (printSession) return printSession;
  const s = electronSession.fromPartition('ws-pdf-print');
  // Nothing in a printed PDF may reach the network.
  s.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*', 'file://*/*'] }, (_d, cb) => cb({ cancel: true }));
  s.setPermissionRequestHandler((_wc, _p, cb) => cb(false));
  s.protocol.handle(SCHEME, async (req) => {
    const u = new URL(req.url);
    const job = jobs.get(u.hostname);
    if (!job) return new Response('Not found', { status: 404 });
    if (u.pathname === '/doc.html') return new Response(printDocument(u.hostname, job), { headers: { 'content-type': 'text/html; charset=utf-8' } });
    const m = /^\/p\/(\d+)\.png$/.exec(u.pathname);
    const index = m ? Number(m[1]) : -1;
    if (!job.pages.some((p) => p.index === index)) return new Response('Not found', { status: 404 });
    try {
      const png = await job.image(index);
      return new Response(new Uint8Array(png), { headers: { 'content-type': 'image/png' } });
    } catch {
      return new Response('Not available', { status: 500 });
    }
  });
  printSession = s;
  return s;
}

/** The print window with the job's document loaded (its images drawn on demand); closed when `fn` is done. */
export async function withPrintWindow<T>(job: PrintJob, parent: BrowserWindow | null, fn: (win: BrowserWindow) => Promise<T>): Promise<T> {
  const id = randomUUID().replace(/-/g, '');
  jobs.set(id, job);
  const win = new BrowserWindow({
    show: false,
    parent: parent ?? undefined,
    width: 900,
    height: 1200,
    webPreferences: { session: ses(), sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false, webSecurity: true, images: true },
  });
  try {
    await win.loadURL(`${SCHEME}://${id}/doc.html`);
    return await fn(win);
  } finally {
    jobs.delete(id);
    if (!win.isDestroyed()) win.destroy();
  }
}

export async function printPdfPages(job: PrintJob, parent: BrowserWindow | null): Promise<PrintOutcome> {
  try {
    return await withPrintWindow(job, parent, (win) =>
      new Promise<PrintOutcome>((resolve) => {
        win.webContents.print({ silent: false, printBackground: true, margins: { marginType: 'none' } }, (ok, why) => {
          if (ok) resolve({ printed: true });
          else resolve({ printed: false, reason: /cancel/i.test(why ?? '') ? 'cancelled' : 'failed', detail: why });
        });
      }),
    );
  } catch (e) {
    return { printed: false, reason: 'failed', detail: String((e as Error)?.message ?? e) };
  }
}

import { BrowserWindow, dialog } from 'electron';
import { writeFile } from 'node:fs/promises';
import { safeFileName } from '@shared/filename';

/**
 * DesktopPrintService (FR-HW-01). Content is printed from a hidden window
 * that has no preload, no JavaScript and no network: what arrives as HTML is
 * laid out and printed, nothing more. The OS print dialog provides preview
 * and printer choice; silent printing is reserved for kiosk policy.
 */
async function withPrintWindow<T>(html: string, title: string, fn: (win: BrowserWindow) => Promise<T>): Promise<T> {
  const win = new BrowserWindow({
    show: false,
    width: 900,
    height: 1200,
    webPreferences: { partition: 'ws-print', sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false, webSecurity: true, images: true },
  });
  // Nothing in a printed document may reach the network (own in-memory partition).
  win.webContents.session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (_d, cb) => cb({ cancel: true }));
  try {
    const doc = `<!doctype html><html><head><meta charset="utf-8"><title>${title.replace(/[<>&"]/g, '')}</title><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:"></head><body>${html}</body></html>`;
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(doc)}`);
    return await fn(win);
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
}

export async function printHtml(html: string, title: string, opts: { silent?: boolean; deviceName?: string }, allowSilent: boolean): Promise<boolean> {
  return withPrintWindow(html, title, (win) => new Promise<boolean>((resolve) => {
    win.webContents.print({ silent: !!opts.silent && allowSilent, deviceName: opts.deviceName, printBackground: true }, (ok) => resolve(ok));
  }));
}

export async function printToPdf(html: string, title: string, parent: BrowserWindow | null): Promise<string | null> {
  const data = await withPrintWindow(html, title, (win) => win.webContents.printToPDF({ printBackground: true, pageSize: 'A4' }));
  const options = { title: 'Save as PDF', defaultPath: `${safeFileName(title, 'document')}.pdf`, filters: [{ name: 'PDF', extensions: ['pdf'] }] };
  const res = parent ? await dialog.showSaveDialog(parent, options) : await dialog.showSaveDialog(options);
  if (res.canceled || !res.filePath) return null;
  await writeFile(res.filePath, data);
  return res.filePath;
}

export async function listPrinters(win: BrowserWindow | null): Promise<Array<{ name: string; displayName: string; isDefault: boolean }>> {
  if (!win) return [];
  const printers = await win.webContents.getPrintersAsync();
  return printers.map((p) => ({ name: p.name, displayName: p.displayName || p.name, isDefault: !!(p as { isDefault?: boolean }).isDefault }));
}

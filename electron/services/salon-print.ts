import { BrowserWindow } from 'electron';
import { spawn } from 'node:child_process';
import type { SalonPaper, SalonPrintOutcome, SalonPrintPatch, SalonPrintSettings } from '@shared/types';
import { DesktopError } from '../main/errors';
import type { HttpClient } from './http';

/**
 * SalonMate's receipts, and the cash drawer behind the counter (PRN-01…07).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SILENT PRINTING, BUT ONLY TO THE DESK'S OWN PRINTER
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * A counter prints a receipt with every payment, so the OS print dialog is not
 * asked each time: the receipt goes straight to the printer this desk was set
 * up with (print.ts keeps the dialog for everything else). What is printed is
 * the server's own receipt — this process fetches it — or a page SalonMate
 * built from the server's figures (the Z-report, the day's summary).
 *
 * The page is laid out in a hidden window with no preload and no network, and
 * a Content-Security-Policy that allows no script at all: the page's own
 * scripts and handlers never run. JavaScript is on in that window only so this
 * process can measure how long the receipt is — a roll printer is given a page
 * as long as the receipt, not a sheet of A4.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE DRAWER OPENS THROUGH THE RECEIPT PRINTER
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * A cash drawer is wired to the receipt printer's RJ-11 port and opens when
 * the printer is sent the ESC/POS pulse (ESC p m t1 t2). Those five bytes go
 * to the printer raw — through CUPS (`lp -o raw`) on Linux and macOS, and the
 * Windows print spooler (the RAW data type) through PowerShell — with the
 * printer's name passed as an argument or in the environment, never through a
 * shell. No native module is needed.
 *
 * Settings live on this computer, filed under the server: which printers are
 * plugged in is a fact about this computer. A full wipe forgets them.
 */
const KEY = 'salon-print';

export const DEFAULT_PRINT: SalonPrintSettings = {
  receipt_printer: null,
  a4_printer: null,
  paper: '80mm',
  copies: 1,
  auto_print: true,
  silent: true,
  drawer: 'off',
  drawer_pin: 2,
};

/** Laid out at the width the server's receipt is drawn for (Receipt::PAPERS). */
const WIDTH_PX: Record<SalonPaper, number> = { '80mm': 302, '58mm': 219, a4: 794, letter: 816 };
const WIDTH_UM = { '80mm': 80_000, '58mm': 58_000 } as const;
const UM_PER_PX = 25_400 / 96;
/** Paper fed past the last line, so the cutter does not cut through it. */
const FEED_UM = 12_000;
/** A page shorter than it is wide would be printed turned. */
const MIN_HEIGHT_UM = 90_000;
const MAX_HTML = 2_000_000;

const CSP = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:";

/** The page as the print window loads it: our head first, so nothing in the page comes before its policy. */
export function printDocument(html: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${CSP}">${html.replace(/^\s*<!doctype[^>]*>/i, '')}`;
}

/** A full page, not a roll: A4 or Letter. */
export const fullPage = (paper: SalonPaper): paper is 'a4' | 'letter' => paper === 'a4' || paper === 'letter';

/** A roll is as long as what is printed on it; A4 is A4 and Letter is Letter. */
export function pageSize(paper: SalonPaper, heightPx: number): 'A4' | 'Letter' | { width: number; height: number } {
  if (paper === 'a4') return 'A4';
  if (paper === 'letter') return 'Letter';
  return { width: WIDTH_UM[paper], height: Math.max(MIN_HEIGHT_UM, Math.ceil(heightPx * UM_PER_PX) + FEED_UM) };
}

export interface PrintJob {
  html: string;
  paper: SalonPaper;
  deviceName: string | null;
  silent: boolean;
  copies: number;
}

export type PrintResult = { ok: true } | { ok: false; reason: string };

/** Print one job from a hidden window of its own. */
export async function printInWindow(job: PrintJob): Promise<PrintResult> {
  const win = new BrowserWindow({
    show: false,
    width: WIDTH_PX[job.paper],
    // Short, so the page's height is the receipt's: a taller window would make it at least as tall as itself.
    height: 60,
    webPreferences: { partition: 'ws-salon-print', sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: true, webSecurity: true, images: true },
  });
  win.webContents.session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (_d, cb) => cb({ cancel: true }));
  try {
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(printDocument(job.html))}`);
    const height = fullPage(job.paper) ? 0 : Number(await win.webContents.executeJavaScript('Math.ceil(document.documentElement.scrollHeight)')) || 0;
    return await new Promise<PrintResult>((resolve) => {
      win.webContents.print(
        {
          silent: job.silent,
          deviceName: job.deviceName ?? undefined,
          printBackground: true,
          copies: job.copies,
          margins: { marginType: fullPage(job.paper) ? 'default' : 'none' },
          pageSize: pageSize(job.paper, height),
        },
        (ok, reason) => resolve(ok ? { ok: true } : { ok: false, reason: reason || 'cancelled' }),
      );
    });
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
}

/** ESC p m t1 t2: pulse the drawer pin (2 or 5) for 50 ms on, 500 ms off. */
export function drawerPulse(pin: 2 | 5): Buffer {
  return Buffer.from([0x1b, 0x70, pin === 5 ? 0x01 : 0x00, 0x19, 0xfa]);
}

/** Bytes to a Windows printer through the spooler, as the RAW data type. Reads WS_PRINTER and WS_BYTES (base64). */
const WINDOWS_RAW = `$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
public static class WorkSuiteRaw {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public class DocInfo { public string pDocName; public string pOutputFile; public string pDataType; }
  [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool OpenPrinter(string name, out IntPtr h, IntPtr d);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool ClosePrinter(IntPtr h);
  [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)] static extern int StartDocPrinter(IntPtr h, int level, [In] DocInfo di);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool EndDocPrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool StartPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool EndPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool WritePrinter(IntPtr h, byte[] b, int n, out int w);
  public static void Send(string printer, byte[] bytes) {
    IntPtr h;
    if (!OpenPrinter(printer, out h, IntPtr.Zero)) throw new Win32Exception();
    try {
      if (StartDocPrinter(h, 1, new DocInfo { pDocName = "WorkSuite drawer", pDataType = "RAW" }) == 0) throw new Win32Exception();
      try {
        StartPagePrinter(h);
        int written;
        if (!WritePrinter(h, bytes, bytes.Length, out written) || written != bytes.Length) throw new Win32Exception();
        EndPagePrinter(h);
      } finally { EndDocPrinter(h); }
    } finally { ClosePrinter(h); }
  }
}
"@
[WorkSuiteRaw]::Send($env:WS_PRINTER, [Convert]::FromBase64String($env:WS_BYTES))`;

export interface RawCommand {
  cmd: string;
  args: string[];
  env: Record<string, string>;
  stdin: Buffer | null;
}

/** How bytes reach a printer raw on this platform. The printer's name is never part of a command line a shell reads. */
export function rawCommand(platform: NodeJS.Platform, printer: string, bytes: Buffer): RawCommand {
  if (platform === 'win32') {
    return { cmd: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_RAW], env: { WS_PRINTER: printer, WS_BYTES: bytes.toString('base64') }, stdin: null };
  }
  return { cmd: 'lp', args: ['-d', printer, '-o', 'raw', '-t', 'WorkSuite drawer'], env: {}, stdin: bytes };
}

export type SpawnLike = typeof spawn;

/** Send bytes to a printer raw; the answer says why it failed. */
export function sendRaw(printer: string, bytes: Buffer, platform: NodeJS.Platform = process.platform, run: SpawnLike = spawn): Promise<PrintResult> {
  const c = rawCommand(platform, printer, bytes);
  return new Promise((resolve) => {
    let err = '';
    let settled = false;
    const done = (r: PrintResult) => {
      if (!settled) {
        settled = true;
        resolve(r);
      }
    };
    let child: ReturnType<SpawnLike>;
    try {
      child = run(c.cmd, c.args, { env: { ...process.env, ...c.env }, stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true, shell: false });
    } catch (e) {
      done({ ok: false, reason: e instanceof Error ? e.message : String(e) });
      return;
    }
    const timer = setTimeout(() => {
      child.kill();
      done({ ok: false, reason: 'The printer did not answer in time.' });
    }, 20_000);
    child.stderr?.on('data', (d: Buffer) => {
      if (err.length < 2000) err += String(d);
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      done({ ok: false, reason: (e as NodeJS.ErrnoException).code === 'ENOENT' ? `${c.cmd} is not available on this computer.` : e.message });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      done(code === 0 ? { ok: true } : { ok: false, reason: err.trim().split('\n').pop() || `${c.cmd} exited with ${code}` });
    });
    if (c.stdin) child.stdin?.end(c.stdin);
    else child.stdin?.end();
  });
}

export interface SalonPrintDeps {
  config: { getConfig<T>(key: string): T | undefined; setConfig(key: string, value: unknown): void; deleteConfig(key: string): void };
  http: Pick<HttpClient, 'raw' | 'url'>;
  origin: () => string | null;
  /** The desk this computer is paired as: its receipts print with that desk's template (DSK-02). */
  desk?: () => number | null;
  print?: (job: PrintJob) => Promise<PrintResult>;
  raw?: (printer: string, bytes: Buffer) => Promise<PrintResult>;
}

type Stored = Record<string, SalonPrintSettings>;

export class SalonPrint {
  private readonly print: (job: PrintJob) => Promise<PrintResult>;
  private readonly raw: (printer: string, bytes: Buffer) => Promise<PrintResult>;

  constructor(private readonly deps: SalonPrintDeps) {
    this.print = deps.print ?? printInWindow;
    this.raw = deps.raw ?? ((p, b) => sendRaw(p, b));
  }

  private all(): Stored {
    const v = this.deps.config.getConfig<Stored>(KEY);
    return v && typeof v === 'object' ? v : {};
  }

  /** This computer's printers for SalonMate on the server it is signed in to. */
  settings(): SalonPrintSettings {
    const o = this.deps.origin();
    return { ...DEFAULT_PRINT, ...(o ? this.all()[o] : undefined) };
  }

  /** Change them. A printer named must be one this computer has. */
  update(patch: SalonPrintPatch, installed: string[]): SalonPrintSettings {
    const o = this.deps.origin();
    if (!o) throw new DesktopError('NOT_SIGNED_IN', 'No WorkSuite server is configured.');
    for (const k of ['receipt_printer', 'a4_printer'] as const) {
      const name = patch[k];
      if (name && !installed.includes(name)) throw new DesktopError('NOT_FOUND', `There is no printer called “${name}” on this computer.`);
    }
    const next = { ...this.settings(), ...patch };
    this.deps.config.setConfig(KEY, { ...this.all(), [o]: next });
    return next;
  }

  /** Forget every server's printer settings (a full wipe). */
  forgetAll(): void {
    this.deps.config.deleteConfig(KEY);
  }

  private printerFor(paper: SalonPaper, s: SalonPrintSettings): string | null {
    return fullPage(paper) ? (s.a4_printer ?? s.receipt_printer) : s.receipt_printer;
  }

  private async fetchHtml(path: string, query: Record<string, string | number>): Promise<string> {
    const res = await this.deps.http.raw('GET', this.deps.http.url(path, query), { headers: { Accept: 'text/html' } });
    const type = res.headers.get('content-type') ?? '';
    if (!res.ok || !type.includes('text/html')) {
      const body = (await res.json().catch(() => null)) as { message?: string } | null;
      throw new DesktopError('SERVER_ERROR', body?.message ?? 'WorkSuite did not send the receipt.', res.status);
    }
    const html = await res.text();
    if (html.length > MAX_HTML) throw new DesktopError('SERVER_ERROR', 'The receipt WorkSuite sent is too large to print.');
    return html;
  }

  private async run(html: string, paper: SalonPaper, installed: string[], copies?: number): Promise<SalonPrintOutcome> {
    const s = this.settings();
    const printer = this.printerFor(paper, s);
    if (printer && !installed.includes(printer)) {
      return { ok: false, printer, silent: false, message: `The printer “${printer}” is not on this computer any more. Choose another in Printers.` };
    }
    const silent = s.silent && !!printer;
    const r = await this.print({ html, paper, deviceName: printer, silent, copies: Math.min(5, Math.max(1, copies ?? s.copies)) });
    if (r.ok) return { ok: true, printer, silent, message: printer ? `Sent to ${printer}.` : 'Printed.' };
    return { ok: false, printer, silent, message: r.reason === 'cancelled' ? 'Printing was cancelled.' : `It could not be printed: ${r.reason}.` };
  }

  /** A visit's receipt, as WorkSuite renders it (PRN-02). */
  async receipt(visitId: number, paper: SalonPaper | undefined, installed: string[]): Promise<SalonPrintOutcome> {
    const p = paper ?? this.settings().paper;
    const desk = this.deps.desk?.() ?? null;
    return this.run(await this.fetchHtml(`/api/salon/v1/visits/${visitId}/receipt`, desk ? { paper: p, desk } : { paper: p }), p, installed);
  }

  /** WorkSuite's test receipt — English, Sinhala and Tamil (PRN-05). */
  async test(paper: SalonPaper | undefined, installed: string[]): Promise<SalonPrintOutcome> {
    const p = paper ?? this.settings().paper;
    return this.run(await this.fetchHtml('/api/salon/v1/desk/test-receipt', { paper: p }), p, installed, 1);
  }

  /** A page SalonMate built from the server's figures: the Z-report, the day's summary. */
  page(html: string, paper: SalonPaper | undefined, installed: string[]): Promise<SalonPrintOutcome> {
    return this.run(html, paper ?? this.settings().paper, installed, 1);
  }

  /** Open the cash drawer, through the receipt printer (PRN-07). */
  async drawer(installed: string[]): Promise<SalonPrintOutcome> {
    const s = this.settings();
    const printer = s.receipt_printer;
    if (s.drawer !== 'printer') return { ok: false, printer, silent: true, message: 'No cash drawer is set up on this computer.' };
    if (!printer) return { ok: false, printer, silent: true, message: 'Choose the receipt printer the drawer is plugged into.' };
    if (!installed.includes(printer)) return { ok: false, printer, silent: true, message: `The printer “${printer}” is not on this computer any more.` };
    const r = await this.raw(printer, drawerPulse(s.drawer_pin));
    return r.ok ? { ok: true, printer, silent: true, message: 'Drawer opened.' } : { ok: false, printer, silent: true, message: `The drawer did not open: ${r.reason}` };
  }
}

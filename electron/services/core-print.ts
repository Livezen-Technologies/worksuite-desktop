import { createHash, createPublicKey, verify, type KeyObject } from 'node:crypto';
import { BrowserWindow } from 'electron';
import { canonicalJson } from '@shared/canonical-json';
import type { ExactLayout, LayoutBox } from '@shared/cheque';

/**
 * CorePrintService — exact-size printing through the OS spooler (Cheque SRS §2.5 / CHQ-PRT-05, C3).
 *
 * A page is a list of boxes positioned in millimetres. It is laid out here as absolutely positioned elements on a
 * page of exactly that size, in a hidden window with no preload, no script and no network, and printed with no
 * margins, at scale 100, on the page size given in microns — never "fit to page". An offset moves every box at
 * render time (a cheque's model from the server already carries its printer profile's X/Y, CHQ-PRN-01, so it is
 * printed with none; a calibration sheet is moved by the offsets being tried). Rotation 180 turns the whole page for
 * printers that feed the leaf the other way round.
 *
 * Shared by every desktop module that must put ink at an exact position on pre-printed stock: Cheque Manager's
 * leaves and A4 calibration sheets now. Label Studio's print host (electron/services/label/) sends the server's raw
 * printer-language bytes and does not need layout; a label printed through an ordinary OS queue as a page can use
 * this. Nothing module-specific belongs here: the caller fetches and validates what is printed.
 */

export const UM_PER_MM = 1000;

export interface ExactPrintJob {
  layout: ExactLayout;
  /** The OS printer's name; the job is refused rather than sent to the default printer. */
  deviceName: string;
  offset: { x_mm: number; y_mm: number };
  rotation?: 0 | 180;
  /** Silent (no dialog), as certified printing requires; false only for a person-facing preview print. */
  silent: boolean;
  title: string;
}

export type ExactPrintResult = { ok: true } | { ok: false; reason: string };

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const n = (v: number) => Number(v.toFixed(3));

function boxHtml(b: LayoutBox, dx: number, dy: number): string {
  const x = n(b.x_mm + dx);
  const y = n(b.y_mm + dy);
  const pos = `left:${x}mm;top:${y}mm;width:${n(b.width_mm)}mm;height:${n(b.height_mm)}mm`;
  if (b.kind === 'crosshair') {
    const s = Math.max(4, b.width_mm || 8);
    return `<div class="x" style="left:${n(x - s / 2)}mm;top:${n(y - s / 2)}mm;width:${n(s)}mm;height:${n(s)}mm"></div>`;
  }
  if (b.kind === 'ruler') {
    const horizontal = b.width_mm >= b.height_mm;
    const len = Math.floor(horizontal ? b.width_mm : b.height_mm);
    const ticks: string[] = [];
    for (let i = 0; i <= len; i += 1) {
      const long = i % 10 === 0;
      const t = long ? 4 : i % 5 === 0 ? 2.5 : 1.5;
      ticks.push(
        horizontal
          ? `<i style="left:${n(x + i)}mm;top:${y}mm;width:0;height:${t}mm"></i>${long ? `<b style="left:${n(x + i + 0.4)}mm;top:${n(y + 4.2)}mm">${i / 10}</b>` : ''}`
          : `<i style="left:${x}mm;top:${n(y + i)}mm;width:${t}mm;height:0"></i>${long ? `<b style="left:${n(x + 4.2)}mm;top:${n(y + i - 1)}mm">${i / 10}</b>` : ''}`,
      );
    }
    return `<div class="r">${ticks.join('')}</div>`;
  }
  if (b.kind === 'rules') return `<div class="l" style="${pos}"></div>`;
  if (b.kind === 'box' || b.kind === 'zone') {
    return `<div class="${b.kind === 'zone' ? 'z' : 'b'}" style="${pos}"><span>${esc(b.lines[0] ?? b.key)}</span></div>`;
  }
  // Text, line by line as given: whoever made the layout decided the wrapping and the size (the server for a
  // cheque, CHQ-PRT-04). Nothing is shrunk or wrapped here, so print matches the preview.
  const lh = n(b.size_pt * 1.2 * (25.4 / 72));
  const style = [
    pos,
    `font-size:${b.size_pt}pt`,
    `line-height:${lh}mm`,
    `text-align:${b.align}`,
    b.letter_spacing_mm ? `letter-spacing:${n(b.letter_spacing_mm)}mm` : '',
    b.font ? `font-family:'${b.font}',Helvetica,Arial,sans-serif` : '',
  ].filter(Boolean).join(';');
  return `<div class="t" style="${style}">${b.lines.map(esc).join('<br>')}</div>`;
}

/** The page as HTML: exactly width × height mm, nothing outside it, every box moved by the offset. */
export function renderExactHtml(job: Pick<ExactPrintJob, 'layout' | 'offset' | 'rotation' | 'title'>): string {
  const { layout, offset } = job;
  const w = n(layout.width_mm);
  const h = n(layout.height_mm);
  // The offset is measured on the paper; on a page turned 180° it has to move the other way to land there.
  const sign = job.rotation === 180 ? -1 : 1;
  const boxes = layout.boxes.map((b) => boxHtml(b, sign * offset.x_mm, sign * offset.y_mm)).join('');
  const turn = job.rotation === 180 ? 'transform:rotate(180deg);transform-origin:50% 50%;' : '';
  const css = [
    `@page{size:${w}mm ${h}mm;margin:0}`,
    `html,body{margin:0;padding:0;width:${w}mm;height:${h}mm;overflow:hidden;background:#fff}`,
    `.p{position:relative;width:${w}mm;height:${h}mm;overflow:hidden;${turn}font-family:Arial,Helvetica,sans-serif;color:#000}`,
    '.p>div,.r>i,.r>b{position:absolute;box-sizing:border-box}',
    '.t{overflow:hidden;white-space:pre}',
    '.l{border-top:0.25mm solid #000;border-bottom:0.25mm solid #000}',
    '.b{border:0.2mm solid #000}.b span,.z span{position:absolute;left:0.6mm;top:0.4mm;font-size:6pt}',
    '.z{border:0.2mm dashed #000;background:repeating-linear-gradient(45deg,transparent 0 1.5mm,#bbb 1.5mm 1.8mm)}',
    '.x{background:linear-gradient(#000,#000) center/0.2mm 100% no-repeat,linear-gradient(#000,#000) center/100% 0.2mm no-repeat}',
    '.r{position:absolute;left:0;top:0}.r>i{border-left:0.15mm solid #000;border-top:0.15mm solid #000}.r>b{font-size:5pt;font-weight:400}',
  ].join('');
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>${esc(job.title)}</title><style>${css}</style></head><body><div class="p">${boxes}</div></body></html>`;
}

/** The page size Chromium is asked for, in microns. */
export function pageSizeMicrons(layout: ExactLayout): { width: number; height: number } {
  return { width: Math.round(layout.width_mm * UM_PER_MM), height: Math.round(layout.height_mm * UM_PER_MM) };
}

/** Print one exact page from a hidden window of its own: no preload, no network, no script; margins none, scale 100. */
export async function printExactInWindow(job: ExactPrintJob): Promise<ExactPrintResult> {
  const win = new BrowserWindow({
    show: false,
    width: 1000,
    height: 1400,
    webPreferences: { partition: 'ws-core-print', sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false, webSecurity: true, images: false },
  });
  win.webContents.session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*', 'file://*/*'] }, (_d, cb) => cb({ cancel: true }));
  try {
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(renderExactHtml(job))}`);
    return await new Promise<ExactPrintResult>((resolve) => {
      win.webContents.print(
        {
          silent: job.silent,
          deviceName: job.deviceName,
          printBackground: true,
          margins: { marginType: 'none' },
          scaleFactor: 100,
          landscape: false,
          pageSize: pageSizeMicrons(job.layout),
          copies: 1,
        },
        (ok, reason) => resolve(ok ? { ok: true } : { ok: false, reason: reason || 'cancelled' }),
      );
    });
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
}

export class CorePrintService {
  constructor(
    private readonly deps: {
      /** The printers this computer has, by OS name. */
      printers: () => Promise<string[]>;
      print?: (job: ExactPrintJob) => Promise<ExactPrintResult>;
    },
  ) {}

  /** Print at exact size on a named printer that this computer has. Never falls back to another printer. */
  async printExact(job: ExactPrintJob): Promise<ExactPrintResult> {
    const installed = await this.deps.printers();
    if (!installed.includes(job.deviceName)) return { ok: false, reason: `There is no printer called “${job.deviceName}” on this computer.` };
    return (this.deps.print ?? printExactInWindow)(job);
  }
}

// ── signed jobs ──────────────────────────────────────────────────────────

/**
 * A published Ed25519 key — base64 (or base64url) of the 32 raw bytes, or a PEM SPKI block — as a KeyObject, or
 * null. The same forms Label Studio's print host accepts (electron/services/label/envelope.ts).
 */
export function ed25519Key(text: string): KeyObject | null {
  try {
    if (text.includes('BEGIN PUBLIC KEY')) {
      const k = createPublicKey(text);
      return k.asymmetricKeyType === 'ed25519' ? k : null;
    }
    const raw = Buffer.from(text.trim().replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    if (raw.length !== 32) return null;
    return createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: raw.toString('base64url') }, format: 'jwk' });
  } catch {
    return null;
  }
}

/** Does `signature` ("ed25519:<base64>" or bare base64) verify over the canonical JSON of `signed` with `key`? */
export function verifyCanonical(signed: unknown, signature: string, key: KeyObject): boolean {
  try {
    const sig = Buffer.from(signature.replace(/^ed25519:/, ''), 'base64');
    return verify(null, Buffer.from(canonicalJson(signed), 'utf8'), key, sig);
  } catch {
    return false;
  }
}

export const sha256Canonical = (v: unknown): string => createHash('sha256').update(canonicalJson(v), 'utf8').digest('hex');

/**
 * Canonical JSON as PHP writes it with `JSON_PRESERVE_ZERO_FRACTION` (keys sorted, no spaces, `11.0` for a float
 * that is whole). JSON over the wire loses whether a whole number was a float, so the caller says which numbers
 * were integers (`isInt`, given the key path); every other whole number is written with `.0`. Strings are written
 * as JSON.stringify writes them, which matches PHP's `JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES`.
 */
export function canonicalPhp(value: unknown, isInt: (path: readonly string[], v: number) => boolean, path: readonly string[] = []): string {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('non-finite number');
    return Number.isInteger(value) && !isInt(path, value) ? `${value}.0` : JSON.stringify(value);
  }
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v, i) => canonicalPhp(v === undefined ? null : v, isInt, [...path, String(i)])).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalPhp(v, isInt, [...path, k])}`).join(',')}}`;
}

export const sha256Text = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex');

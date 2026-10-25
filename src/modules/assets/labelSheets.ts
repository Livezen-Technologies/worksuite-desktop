import qrcode from 'qrcode-generator';
import { call, errorMessage } from '../../core/bridge';
import { toast } from '../../core/toasts';

/**
 * Asset labels on this computer (D22, T-11): "Property of <company>", the code as a QR, a Code 128 barcode or both,
 * and the asset's name — on a 62 mm label roll, a 1 in thermal label or an A4 sheet of 3 × 8. Printed through the
 * app's own print service (`print:print`) to the printer chosen here, or saved as a PDF (`print:toPdf`).
 *
 * This computer's choices (printer, roll, code) are kept in its own storage: they belong to the machine at the counter,
 * not to the person or the company.
 */
export interface AssetLabel {
  code: string;
  name: string;
  company?: string | null;
}

export type LabelCode = 'qr' | 'code128' | 'both';
export type LabelStock = 'roll62' | 'thermal1in' | 'a4';

export interface LabelPrefs {
  printer: string | null;
  stock: LabelStock;
  code: LabelCode;
}

const KEY = 'assets.labels';
const DEFAULTS: LabelPrefs = { printer: null, stock: 'roll62', code: 'qr' };

export function labelPrefs(): LabelPrefs {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<LabelPrefs> | null;
    return { ...DEFAULTS, ...(v ?? {}) };
  } catch {
    return DEFAULTS;
  }
}

export function saveLabelPrefs(p: LabelPrefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* a private window: the choice lasts this session only */
  }
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function qrSvg(text: string, mm: number): string {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c},${r}h1v1h-1z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" width="${mm}mm" height="${mm}mm" shape-rendering="crispEdges"><path d="${d}" fill="#000"/></svg>`;
}

/** Code 128 bar patterns (module widths, bar first), values 0–106. */
const C128 = '212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 221312 231212 112232 122132 122231 113222 123122 123221 223211 221132 221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 212123 212321 232121 111323 131123 131321 112313 132113 132311 211313 231113 231311 112133 112331 132131 113123 113321 133121 313121 211331 231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 314111 221411 431111 111224 111422 121124 121421 141122 141221 112214 112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 111242 121142 121241 114212 124112 124211 411212 421112 421211 212141 214121 412121 111143 111341 131141 114113 114311 411113 411311 113141 114131 311141 411131 211412 211214 211232 2331112'.split(' ');

/** The Code 128 (set B) modules for printable ASCII text: start, data, check, stop. Null for text set B cannot carry. */
export function code128(text: string): number[] | null {
  if (!text || [...text].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) > 126)) return null;
  const vals = [104, ...[...text].map((c) => c.charCodeAt(0) - 32)];
  const check = vals.reduce((s, v, i) => s + v * Math.max(1, i), 0) % 103;
  return [...vals, check, 106].flatMap((v) => C128[v]!.split('').map(Number));
}

export function code128Svg(text: string, widthMm: number, heightMm: number): string {
  const mods = code128(text);
  if (!mods) return '';
  const total = mods.reduce((s, w) => s + w, 0) + 20;
  let x = 10;
  let d = '';
  mods.forEach((w, i) => {
    if (i % 2 === 0) d += `M${x},0h${w}v1h-${w}z`;
    x += w;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} 1" preserveAspectRatio="none" width="${widthMm}mm" height="${heightMm}mm" shape-rendering="crispEdges"><path d="${d}" fill="#000"/></svg>`;
}

const PAGE: Record<LabelStock, { page: string; w: number; h: number }> = {
  roll62: { page: 'size:62mm 29mm;margin:0', w: 62, h: 29 },
  thermal1in: { page: 'size:51mm 25.4mm;margin:0', w: 51, h: 25.4 },
  a4: { page: 'size:A4;margin:10mm 7mm', w: 64, h: 33.9 },
};

export function labelsHtml(items: readonly AssetLabel[], prefs: Pick<LabelPrefs, 'stock' | 'code'>): string {
  const p = PAGE[prefs.stock];
  const qr = prefs.code !== 'code128';
  const bars = prefs.code !== 'qr';
  const qrMm = Math.min(p.h - 4, 22);
  const one = (i: AssetLabel) =>
    `<section class="l">${qr ? qrSvg(i.code, qrMm) : ''}<div class="t">${i.company ? `<small>Property of ${esc(i.company)}</small>` : ''}<b class="c">${esc(i.code)}</b><span>${esc(i.name)}</span>${bars ? code128Svg(i.code, p.w - (qr ? qrMm : 0) - 8, 6) : ''}</div></section>`;
  const sheet = prefs.stock === 'a4';
  const body = items.map(one).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>@page{${p.page}}body{margin:0;font-family:system-ui,sans-serif}${sheet ? '.g{display:grid;grid-template-columns:repeat(3,64mm);grid-auto-rows:33.9mm}' : ''}.l{width:${p.w}mm;height:${p.h}mm;box-sizing:border-box;padding:2mm;display:flex;gap:2mm;align-items:center;overflow:hidden;${sheet ? '' : 'page-break-after:always;'}}.t{display:flex;flex-direction:column;min-width:0;line-height:1.2;font-size:7pt}.t small{font-size:6pt}.c{font-family:ui-monospace,Menlo,monospace;font-size:10pt}.t span{max-height:2.4em;overflow:hidden}</style></head><body>${sheet ? `<div class="g">${body}</div>` : body}</body></html>`;
}

/** Prints the labels to this computer's chosen printer; false when nothing was printed. */
export async function printLabels(items: readonly AssetLabel[], prefs = labelPrefs(), title = 'Asset labels'): Promise<boolean> {
  if (!items.length) return false;
  try {
    return await call('print:print', { html: labelsHtml(items, prefs), title, ...(prefs.printer ? { deviceName: prefs.printer } : {}) });
  } catch (e) {
    toast('error', errorMessage(e));
    return false;
  }
}

export async function saveLabelsPdf(items: readonly AssetLabel[], prefs = labelPrefs()): Promise<string | null> {
  if (!items.length) return null;
  try {
    return await call('print:toPdf', { html: labelsHtml(items, prefs), title: 'Asset labels' });
  } catch (e) {
    toast('error', errorMessage(e));
    return null;
  }
}

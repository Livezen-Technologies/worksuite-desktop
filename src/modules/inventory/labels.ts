import qrcode from 'qrcode-generator';
import { call, errorMessage } from '../../core/bridge';
import { toast } from '../../core/toasts';

/**
 * Printing from Inventory on this computer: product and unit labels on the label printer (50 × 25 mm), and a count
 * sheet on paper. Through the app's own print service (`print:print`), to the printer the person chose there — the
 * default one unless a label printer is named in this computer's settings.
 */
export interface LabelItem {
  /** The big line: the product. */
  title: string;
  /** The code under it: the product's code or barcode, or a unit's serial. */
  code: string;
  /** A small line: the company, a bin. */
  note?: string | null;
  /** What the QR carries; the code when not given. */
  qr?: string | null;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** A QR code as an inline SVG, square, `size` mm. */
export function qrSvg(text: string, size = 20): string {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c},${r}h1v1h-1z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" width="${size}mm" height="${size}mm" shape-rendering="crispEdges"><path d="${d}" fill="#000"/></svg>`;
}

/** The labels, one per page of 50 × 25 mm. */
export function labelsHtml(items: readonly LabelItem[]): string {
  const pages = items
    .map(
      (i) =>
        `<section class="l">${qrSvg(i.qr || i.code)}<div><b>${esc(i.title)}</b><span class="c">${esc(i.code)}</span>${i.note ? `<span>${esc(i.note)}</span>` : ''}</div></section>`,
    )
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>@page{size:50mm 25mm;margin:0}body{margin:0;font-family:system-ui,sans-serif}.l{width:50mm;height:25mm;box-sizing:border-box;padding:2mm;display:flex;gap:2mm;align-items:center;page-break-after:always;overflow:hidden}.l div{display:flex;flex-direction:column;min-width:0;font-size:7pt;line-height:1.2}.l b{font-size:8pt;max-height:2.4em;overflow:hidden}.c{font-family:ui-monospace,Menlo,monospace;font-size:8pt}</style></head><body>${pages}</body></html>`;
}

/** Prints the labels; false when there was nothing to print or it did not go. */
export async function printLabels(items: readonly LabelItem[], title = 'Labels'): Promise<boolean> {
  if (!items.length) return false;
  try {
    return await call('print:print', { html: labelsHtml(items), title });
  } catch (e) {
    toast('error', errorMessage(e));
    return false;
  }
}

/** A count sheet to count on paper: product, bin, expected (unless the count is blind) and a box to write in. */
export function countSheetHtml(head: { reference: string; warehouse: string | null; note?: string | null }, lines: ReadonlyArray<{ name: string; code: string | null; bin: string | null; expected: string | null }>): string {
  const rows = lines.map((l) => `<tr><td>${esc(l.name)}<br><small>${esc(l.code ?? '')}</small></td><td>${esc(l.bin ?? '')}</td><td class="r">${esc(l.expected ?? '')}</td><td class="box"></td></tr>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>body{font-family:system-ui,sans-serif;font-size:10pt;margin:12mm}h1{font-size:14pt;margin:0 0 2mm}p{margin:0 0 6mm;color:#555}table{width:100%;border-collapse:collapse}th,td{border-bottom:1px solid #ccc;padding:2mm;text-align:left;vertical-align:top}th{font-size:9pt;color:#555}.r{text-align:right}.box{width:30mm;border:1px solid #999}small{color:#666}</style></head><body><h1>${esc(head.reference)}</h1><p>${esc([head.warehouse, head.note].filter(Boolean).join(' · '))}</p><table><thead><tr><th>Product</th><th>Bin</th><th class="r">Expected</th><th>Counted</th></tr></thead><tbody>${rows}</tbody></table></body></html>`;
}

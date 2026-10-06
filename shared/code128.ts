/**
 * Code 128 (set B), for the receipt number printed under a receipt so it can be scanned back at the till (a return).
 * Set B covers printable ASCII, which is what a receipt number is (`T01-7F3A2B-000042`). `code128` answers the
 * bars and spaces as module widths, start, data, check symbol and stop included; a printer that speaks ESC/POS draws
 * its own (`GS k`), the page printed through a driver and the screen draw these.
 */
const PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];
export const CODE128_PATTERNS: readonly string[] = PATTERNS;

const START_B = 104;
const STOP = 106;

/** Whether set B can carry the text: printable ASCII, 1 to 80 characters. */
export function code128Encodable(text: string): boolean {
  return text.length > 0 && text.length <= 80 && /^[\x20-\x7e]+$/.test(text);
}

/** The symbol values: start B, the characters, the check symbol, stop. */
export function code128Values(text: string): number[] {
  if (!code128Encodable(text)) throw new Error('Code 128 B carries printable ASCII only');
  const data = [...text].map((c) => c.charCodeAt(0) - 32);
  const check = data.reduce((sum, v, i) => sum + v * (i + 1), START_B) % 103;
  return [START_B, ...data, check, STOP];
}

/** Bar and space widths, in modules, starting with a bar (11 a symbol, 13 the stop). */
export function code128(text: string): number[] {
  return code128Values(text).flatMap((v) => [...PATTERNS[v]!].map(Number));
}

/** The bars as an SVG (black on white, quiet zones either side), `height` tall, `module` wide each. */
export function code128Svg(text: string, o: { height?: number; module?: number } = {}): string {
  const m = o.module ?? 2;
  const h = o.height ?? 48;
  const widths = code128(text);
  const quiet = 10 * m;
  let x = quiet;
  const rects: string[] = [];
  widths.forEach((w, i) => {
    if (i % 2 === 0) rects.push(`<rect x="${x}" y="0" width="${w * m}" height="${h}"/>`);
    x += w * m;
  });
  const width = x + quiet;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${h}" viewBox="0 0 ${width} ${h}" role="img" aria-label="${text.replace(/[&<>"']/g, '')}"><rect width="${width}" height="${h}" fill="#fff"/><g fill="#000">${rects.join('')}</g></svg>`;
}

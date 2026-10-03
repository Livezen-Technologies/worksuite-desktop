/**
 * Tables in an email (worksuite-desktop#188): made and changed as HTML every
 * mainstream mail client draws the same way — Outlook (Word's renderer),
 * Gmail, Apple Mail.
 *
 * The rules, as for signatures: everything that matters is inline (`style`
 * on the table and on every cell, never a stylesheet or a class), the old
 * table attributes are written as well (`border`, `cellpadding`,
 * `cellspacing`, `width`, `bgcolor`, `align`, `valign`) for the clients that
 * read those and not CSS, borders are on the cells with `border-collapse`,
 * and a background is a cell's own `background-color` (and `bgcolor`) rather
 * than a row's.
 *
 * The operations work on the table in the editor through a grid that knows
 * merged cells (`colspan`/`rowspan`), so rows and columns go in and out
 * around them correctly.
 */

export type TableStyle = 'plain' | 'bordered' | 'striped' | 'header';
export type BorderMode = 'all' | 'outside' | 'none';

export const DEFAULT_BORDER = '#cccccc';
export const STRIPE = '#f6f8fa';
export const HEADER_BG = '#f1f3f4';
export const HEADER_ACCENT = '#1a56db';
const PAD = '6px 10px';

const cellStyle = (border: string | null, extra = '') => `${border ? `border: 1px solid ${border}; ` : ''}padding: ${PAD}; vertical-align: top; text-align: left${extra}`;

/** A new table: rows × columns, optionally a header row, in one of the styles. */
export function tableHtml(opts: { rows: number; cols: number; header?: boolean; style?: TableStyle }): string {
  const rows = Math.max(1, Math.min(50, Math.floor(opts.rows)));
  const cols = Math.max(1, Math.min(20, Math.floor(opts.cols)));
  const style = opts.style ?? 'bordered';
  const header = !!opts.header || style === 'header';
  const border = style === 'plain' ? null : DEFAULT_BORDER;
  const head = (bg: string, colour = '') => `<th bgcolor="${bg}" style="${cellStyle(border, `; background-color: ${bg}; font-weight: bold${colour ? `; color: ${colour}` : ''}`)}"><br></th>`;
  const out: string[] = [];
  for (let r = 0; r < rows; r++) {
    const isHead = header && r === 0;
    const stripe = style === 'striped' && !isHead && (header ? r - 1 : r) % 2 === 1;
    const cell = isHead
      ? head(style === 'header' ? HEADER_ACCENT : HEADER_BG, style === 'header' ? '#ffffff' : '')
      : stripe
        ? `<td bgcolor="${STRIPE}" style="${cellStyle(border, `; background-color: ${STRIPE}`)}"><br></td>`
        : `<td style="${cellStyle(border)}"><br></td>`;
    out.push(`<tr>${cell.repeat(cols)}</tr>`);
  }
  return `<table border="${border ? 1 : 0}" cellpadding="6" cellspacing="0" width="100%" style="border-collapse: collapse; width: 100%${border ? `; border: 1px solid ${border}` : ''}"><tbody>${out.join('')}</tbody></table><div><br></div>`;
}

type Cell = HTMLTableCellElement;

export interface Grid {
  rows: HTMLTableRowElement[];
  /** slots[r][c]: the cell covering that place (a merged cell covers several). */
  slots: Cell[][];
  width: number;
}

/** The table as a grid of places, with merged cells covering all of theirs. */
export function gridOf(table: HTMLTableElement): Grid {
  const rows = [...table.rows];
  const slots: Cell[][] = rows.map(() => []);
  rows.forEach((tr, r) => {
    let c = 0;
    for (const cell of [...tr.cells]) {
      while (slots[r]![c]) c++;
      const rs = Math.max(1, cell.rowSpan || 1);
      const cs = Math.max(1, cell.colSpan || 1);
      for (let dr = 0; dr < rs && r + dr < rows.length; dr++) for (let dc = 0; dc < cs; dc++) slots[r + dr]![c + dc] = cell;
      c += cs;
    }
  });
  return { rows, slots, width: Math.max(0, ...slots.map((s) => s.length)) };
}

/** Where a cell starts: its top row and left column. */
export function placeOf(grid: Grid, cell: Cell): { r: number; c: number } {
  for (let r = 0; r < grid.slots.length; r++) {
    const c = grid.slots[r]!.indexOf(cell);
    if (c >= 0) return { r, c };
  }
  return { r: -1, c: -1 };
}

const tableOf = (cell: Cell) => cell.closest('table') as HTMLTableElement;

/** An empty cell like `like` (its look, not its content or span), of the given kind. */
function blankLike(like: Cell | undefined, tag: 'td' | 'th' = (like?.tagName.toLowerCase() as 'td' | 'th') ?? 'td'): Cell {
  const doc = like?.ownerDocument ?? document;
  const cell = doc.createElement(tag);
  if (like) {
    for (const a of ['style', 'bgcolor', 'align', 'valign']) {
      const v = like.getAttribute(a);
      if (v) cell.setAttribute(a, v);
    }
    // A column's width belongs to the column, not to a new cell beside it.
  }
  if (!cell.getAttribute('style')) cell.setAttribute('style', cellStyle(DEFAULT_BORDER));
  cell.innerHTML = '<br>';
  return cell;
}

/** Put `cell` into `tr` at grid column `c` (before the first of its cells starting further right). */
function insertAtColumn(grid: Grid, r: number, tr: HTMLTableRowElement, cell: Cell, c: number) {
  const after = [...tr.cells].find((x) => placeOf(grid, x).c >= c && placeOf(grid, x).r === r);
  tr.insertBefore(cell, after ?? null);
}

/** A row above or below the caret's row; merged cells that cross the gap grow instead. */
export function insertRow(cell: Cell, where: 'above' | 'below'): HTMLTableRowElement {
  const table = tableOf(cell);
  const grid = gridOf(table);
  const at = placeOf(grid, cell);
  const r = where === 'above' ? at.r : at.r + Math.max(1, cell.rowSpan) - 1;
  const tr = table.ownerDocument.createElement('tr');
  const grown = new Set<Cell>();
  const ref = grid.rows[r]!;
  for (let c = 0; c < grid.width; c++) {
    const x = grid.slots[r]![c];
    if (!x) continue;
    const p = placeOf(grid, x);
    const crosses = where === 'above' ? p.r < r : p.r + Math.max(1, x.rowSpan) - 1 > r;
    if (crosses) {
      if (!grown.has(x)) {
        x.rowSpan = Math.max(1, x.rowSpan) + 1;
        grown.add(x);
      }
      c = p.c + Math.max(1, x.colSpan) - 1;
      continue;
    }
    // A new row under a header is a body row.
    const heading = x.tagName === 'TH' && where === 'below' ? 'td' : undefined;
    const like = heading ? (grid.slots[r + 1]?.[c] ?? x) : x;
    const span = Math.max(1, x.colSpan);
    for (let i = 0; i < span; i++) tr.appendChild(blankLike(like, heading ?? (like.tagName.toLowerCase() as 'td' | 'th')));
    c = p.c + span - 1;
  }
  ref.parentNode!.insertBefore(tr, where === 'above' ? ref : ref.nextSibling);
  restripe(table);
  return tr;
}

/** A column left or right of the caret's; merged cells that cross the gap grow instead. */
export function insertColumn(cell: Cell, where: 'left' | 'right'): void {
  const table = tableOf(cell);
  const grid = gridOf(table);
  const at = placeOf(grid, cell);
  const c = where === 'left' ? at.c : at.c + Math.max(1, cell.colSpan) - 1;
  const grown = new Set<Cell>();
  grid.rows.forEach((tr, r) => {
    const x = grid.slots[r]![c];
    if (!x) return;
    const p = placeOf(grid, x);
    const crosses = where === 'left' ? p.c < c : p.c + Math.max(1, x.colSpan) - 1 > c;
    if (crosses) {
      if (!grown.has(x)) {
        x.colSpan = Math.max(1, x.colSpan) + 1;
        grown.add(x);
      }
      return;
    }
    if (p.r !== r) return; // covered by a merged cell from above, which already had its turn
    const blank = blankLike(x);
    blank.removeAttribute('width');
    if (where === 'left') tr.insertBefore(blank, x);
    else insertAtColumn(grid, r, tr, blank, c + 1);
    for (let dr = 1; dr < Math.max(1, x.rowSpan); dr++) {
      const row = grid.rows[r + dr];
      if (row) {
        const more = blankLike(x);
        if (where === 'left') insertAtColumn(grid, r + dr, row, more, c);
        else insertAtColumn(grid, r + dr, row, more, c + 1);
      }
    }
  });
}

/** The caret's row goes; merged cells across it shrink. The last row takes the table with it. Returns the cell to put the caret in, if any. */
export function deleteRow(cell: Cell): Cell | null {
  const table = tableOf(cell);
  const grid = gridOf(table);
  const { r } = placeOf(grid, cell);
  const tr = grid.rows[r]!;
  const seen = new Set<Cell>();
  for (let c = 0; c < grid.width; c++) {
    const x = grid.slots[r]![c];
    if (!x || seen.has(x)) continue;
    seen.add(x);
    if (Math.max(1, x.rowSpan) <= 1) continue;
    const p = placeOf(grid, x);
    x.rowSpan -= 1;
    // A merged cell that starts here moves down to the next row.
    if (p.r === r && grid.rows[r + 1]) insertAtColumn(grid, r + 1, grid.rows[r + 1]!, x, p.c);
  }
  tr.remove();
  if (!table.rows.length) {
    table.remove();
    return null;
  }
  restripe(table);
  const next = gridOf(table);
  return next.slots[Math.min(r, next.rows.length - 1)]?.[0] ?? null;
}

/** The caret's column goes; merged cells across it shrink. The last column takes the table with it. */
export function deleteColumn(cell: Cell): Cell | null {
  const table = tableOf(cell);
  const grid = gridOf(table);
  const { c } = placeOf(grid, cell);
  const seen = new Set<Cell>();
  for (let r = 0; r < grid.rows.length; r++) {
    const x = grid.slots[r]![c];
    if (!x || seen.has(x)) continue;
    seen.add(x);
    if (Math.max(1, x.colSpan) > 1) x.colSpan -= 1;
    else x.remove();
  }
  for (const tr of [...table.rows]) if (!tr.cells.length) tr.remove();
  if (!table.querySelector('td, th')) {
    table.remove();
    return null;
  }
  const next = gridOf(table);
  const row = next.slots[0] ?? [];
  return row[Math.min(c, row.length - 1)] ?? null;
}

export function deleteTable(cell: Cell): void {
  tableOf(cell).remove();
}

const isEmptyCell = (cell: Cell) => !(cell.textContent ?? '').trim() && !cell.querySelector('img, table, hr, li');

/** The cell to the right (or below) joins this one: same height (width), contents kept. */
export function mergeCells(cell: Cell, direction: 'right' | 'down'): boolean {
  const grid = gridOf(tableOf(cell));
  const p = placeOf(grid, cell);
  const cs = Math.max(1, cell.colSpan);
  const rs = Math.max(1, cell.rowSpan);
  const other = direction === 'right' ? grid.slots[p.r]?.[p.c + cs] : grid.slots[p.r + rs]?.[p.c];
  if (!other || other === cell) return false;
  const q = placeOf(grid, other);
  if (direction === 'right' && (q.r !== p.r || Math.max(1, other.rowSpan) !== rs)) return false;
  if (direction === 'down' && (q.c !== p.c || Math.max(1, other.colSpan) !== cs)) return false;
  if (!isEmptyCell(other)) {
    if (isEmptyCell(cell)) cell.innerHTML = '';
    else cell.appendChild(cell.ownerDocument.createElement('br'));
    while (other.firstChild) cell.appendChild(other.firstChild);
  }
  if (direction === 'right') cell.colSpan = cs + Math.max(1, other.colSpan);
  else cell.rowSpan = rs + Math.max(1, other.rowSpan);
  other.remove();
  for (const tr of [...tableOf(cell).rows]) if (!tr.cells.length) tr.remove();
  return true;
}

/** A merged cell back into single cells (the content stays in the first). */
export function splitCell(cell: Cell): boolean {
  const cs = Math.max(1, cell.colSpan);
  const rs = Math.max(1, cell.rowSpan);
  if (cs === 1 && rs === 1) return false;
  const grid = gridOf(tableOf(cell));
  const p = placeOf(grid, cell);
  cell.colSpan = 1;
  cell.rowSpan = 1;
  cell.removeAttribute('colspan');
  cell.removeAttribute('rowspan');
  let after: Element = cell;
  for (let i = 1; i < cs; i++) {
    const b = blankLike(cell);
    after.after(b);
    after = b;
  }
  for (let dr = 1; dr < rs; dr++) {
    const row = grid.rows[p.r + dr];
    if (!row) continue;
    for (let i = cs - 1; i >= 0; i--) insertAtColumn(grid, p.r + dr, row, blankLike(cell), p.c + i);
  }
  return true;
}

/** A cell as the other kind (td ↔ th), keeping what is in it and its look. */
function retag(cell: Cell, tag: 'td' | 'th'): Cell {
  if (cell.tagName.toLowerCase() === tag) return cell;
  const next = cell.ownerDocument.createElement(tag);
  for (const a of [...cell.attributes]) next.setAttribute(a.name, a.value);
  while (cell.firstChild) next.appendChild(cell.firstChild);
  cell.replaceWith(next);
  return next;
}

export function hasHeader(table: HTMLTableElement): boolean {
  const first = table.rows[0];
  return !!first && first.cells.length > 0 && [...first.cells].every((c) => c.tagName === 'TH');
}

/** The first row as a header row (bold, shaded) — or back to an ordinary row. */
export function toggleHeader(table: HTMLTableElement): boolean {
  const first = table.rows[0];
  if (!first) return false;
  const on = !hasHeader(table);
  for (const c of [...first.cells]) {
    const cell = retag(c, on ? 'th' : 'td');
    if (on) {
      setStyle(cell, { 'background-color': HEADER_BG, 'font-weight': 'bold' });
      cell.setAttribute('bgcolor', HEADER_BG);
    } else {
      setStyle(cell, { 'background-color': null, 'font-weight': null, color: null });
      cell.removeAttribute('bgcolor');
    }
  }
  restripe(table);
  return on;
}

/** Set (or, with null, remove) inline style properties. */
export function setStyle(el: HTMLElement, props: Record<string, string | null>): void {
  for (const [k, v] of Object.entries(props)) {
    if (v === null || v === '') el.style.removeProperty(k);
    else el.style.setProperty(k, v);
  }
  if (!el.getAttribute('style')?.trim()) el.removeAttribute('style');
}

export function cellBackground(cells: Cell[], colour: string | null): void {
  for (const c of cells) {
    setStyle(c, { 'background-color': colour });
    if (colour) c.setAttribute('bgcolor', colour);
    else c.removeAttribute('bgcolor');
  }
}

const borderColourOf = (table: HTMLTableElement) => {
  const any = [table, ...table.querySelectorAll<HTMLElement>('td, th')].map((el) => el.style.borderColor || el.style.borderTopColor).find(Boolean);
  return any || DEFAULT_BORDER;
};

/** Which borders the table draws: every cell's, only around the outside, or none. */
export function setBorders(table: HTMLTableElement, mode: BorderMode, colour: string = borderColourOf(table)): void {
  const line = `1px solid ${colour}`;
  setStyle(table, { 'border-collapse': 'collapse', border: null, 'border-style': null, 'border-width': null, 'border-color': null });
  if (mode !== 'none') setStyle(table, { border: line });
  table.setAttribute('border', mode === 'all' ? '1' : '0');
  table.setAttribute('cellspacing', '0');
  if (!table.getAttribute('cellpadding')) table.setAttribute('cellpadding', '6');
  for (const c of table.querySelectorAll<HTMLElement>('td, th')) {
    if (c.closest('table') !== table) continue;
    setStyle(c, { border: null, 'border-top': null, 'border-bottom': null, 'border-left': null, 'border-right': null, 'border-style': null, 'border-width': null, 'border-color': null });
    if (mode === 'all') setStyle(c, { border: line });
  }
}

export function bordersOf(table: HTMLTableElement): BorderMode {
  const cell = table.querySelector<HTMLElement>('td, th');
  const drawn = (el: HTMLElement | null) => !!el && /solid|dashed|dotted|double/.test(`${el.style.borderStyle} ${el.style.border}`);
  if (drawn(cell)) return 'all';
  if (drawn(table)) return 'outside';
  return 'none';
}

/** The border colour, keeping which borders are drawn. */
export function setBorderColour(table: HTMLTableElement, colour: string): void {
  setBorders(table, bordersOf(table), colour);
}

export function alignCell(cells: Cell[], h?: 'left' | 'center' | 'right' | null, v?: 'top' | 'middle' | 'bottom' | null): void {
  for (const c of cells) {
    if (h !== undefined) {
      setStyle(c, { 'text-align': h });
      if (h) c.setAttribute('align', h);
      else c.removeAttribute('align');
    }
    if (v !== undefined) {
      setStyle(c, { 'vertical-align': v });
      if (v) c.setAttribute('valign', v);
      else c.removeAttribute('valign');
    }
  }
}

/** As wide as the message, or as wide as its content. */
export function setTableWidth(table: HTMLTableElement, width: 'full' | 'fit'): void {
  if (width === 'full') {
    table.setAttribute('width', '100%');
    setStyle(table, { width: '100%' });
  } else {
    table.removeAttribute('width');
    setStyle(table, { width: null });
    for (const c of table.querySelectorAll<HTMLElement>('td, th')) {
      c.removeAttribute('width');
      setStyle(c, { width: null });
    }
  }
}

/** One column's width in pixels: on every cell of it (and as `width`, which Outlook reads). */
export function setColumnWidth(table: HTMLTableElement, column: number, px: number): void {
  const grid = gridOf(table);
  const w = Math.max(24, Math.round(px));
  const seen = new Set<Cell>();
  for (let r = 0; r < grid.rows.length; r++) {
    const x = grid.slots[r]![column];
    if (!x || seen.has(x) || Math.max(1, x.colSpan) > 1) continue;
    seen.add(x);
    x.setAttribute('width', String(w));
    setStyle(x, { width: `${w}px` });
  }
}

/** A look for the whole table: plain, bordered, striped rows or a coloured header. */
export function applyTableStyle(table: HTMLTableElement, style: TableStyle): void {
  const header = hasHeader(table);
  if (style === 'header' && !header) toggleHeader(table);
  setBorders(table, style === 'plain' ? 'none' : 'all', style === 'plain' ? DEFAULT_BORDER : borderColourOf(table));
  const cells = [...table.querySelectorAll<Cell>('td, th')].filter((c) => c.closest('table') === table);
  cellBackground(cells.filter((c) => c.tagName === 'TD'), null);
  for (const th of cells.filter((c) => c.tagName === 'TH')) {
    const accent = style === 'header';
    cellBackground([th], accent ? HEADER_ACCENT : HEADER_BG);
    setStyle(th, { color: accent ? '#ffffff' : null, 'font-weight': 'bold' });
  }
  if (style === 'striped') stripe(table);
}

function stripe(table: HTMLTableElement): void {
  const body = [...table.rows].filter((tr) => ![...tr.cells].every((c) => c.tagName === 'TH'));
  body.forEach((tr, i) => cellBackground([...tr.cells].filter((c) => c.tagName === 'TD'), i % 2 === 1 ? STRIPE : null));
}

const isStriped = (table: HTMLTableElement) => [...table.querySelectorAll<HTMLElement>('td')].some((c) => (c.getAttribute('bgcolor') ?? '').toLowerCase() === STRIPE);

/** Striped rows stay striped as rows come and go. */
export function restripe(table: HTMLTableElement): void {
  if (isStriped(table)) stripe(table);
}

/** The cells in reading order, for Tab and Shift+Tab. */
export function cellsInOrder(table: HTMLTableElement): Cell[] {
  return [...table.querySelectorAll<Cell>('td, th')].filter((c) => c.closest('table') === table);
}

/** The next (or previous) cell; null after the last (or before the first). */
export function nextCell(cell: Cell, back = false): Cell | null {
  const all = cellsInOrder(tableOf(cell));
  const i = all.indexOf(cell);
  return all[i + (back ? -1 : 1)] ?? null;
}

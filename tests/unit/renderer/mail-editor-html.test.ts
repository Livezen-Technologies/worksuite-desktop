// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { cleanComposeHtml, composeText } from '../../../src/modules/mail/composeHtml';
import {
  alignCell,
  applyTableStyle,
  bordersOf,
  cellBackground,
  deleteColumn,
  deleteRow,
  gridOf,
  hasHeader,
  insertColumn,
  insertRow,
  mergeCells,
  nextCell,
  setBorderColour,
  setBorders,
  setColumnWidth,
  setTableWidth,
  splitCell,
  tableHtml,
  toggleHeader,
} from '../../../src/modules/mail/editor/emailHtml';
import { alignImage, cropRect, dataUrlBytes, dataUrlToFile, embeddedBytes, fitImage, imageHtml, sizeImage, type Encoder } from '../../../src/modules/mail/editor/images';
import { buttonHtml, checklistHtml, codeBlockHtml, HR_HTML } from '../../../src/modules/mail/editor/insert';
import { fitCount } from '../../../src/modules/mail/editor/overflow';
import { cleanOfficeHtml, isOfficeHtml, matchStyle, pastedHtml } from '../../../src/modules/mail/editor/paste';

/**
 * The Mail composer's editor (worksuite-desktop#188), its HTML side: tables
 * that are email-safe and can be changed after they go in, pictures made
 * small enough and kept through the allow-list, Word/Excel paste cleaned,
 * and the toolbar's overflow arithmetic.
 *
 * Rendering in Gmail, Outlook and Apple Mail is checked here only by the
 * structure of the HTML (inline styles, table attributes) — not in the
 * clients themselves.
 */

function table(html: string): HTMLTableElement {
  document.body.innerHTML = html;
  return document.querySelector('table')!;
}

/** The table as text: a row per line, cells by their text (or "·" when empty), spans as "a:2x1". */
function shape(t: HTMLTableElement): string {
  return [...t.rows]
    .map((tr) =>
      [...tr.cells]
        .map((c) => `${(c.textContent ?? '').trim() || '·'}${c.colSpan > 1 || c.rowSpan > 1 ? `:${c.colSpan}x${c.rowSpan}` : ''}`)
        .join(' '),
    )
    .join('\n');
}

const named = (rows: string[][]) => `<table><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`;

describe('tables: email-safe HTML', () => {
  it('makes a table with inline styles and the attributes Outlook reads', () => {
    const t = table(tableHtml({ rows: 2, cols: 3, header: true }));
    expect(t.getAttribute('border')).toBe('1');
    expect(t.getAttribute('cellpadding')).toBe('6');
    expect(t.getAttribute('cellspacing')).toBe('0');
    expect(t.getAttribute('width')).toBe('100%');
    expect(t.getAttribute('style')).toContain('border-collapse: collapse');
    expect(t.rows).toHaveLength(2);
    expect([...t.rows[0]!.cells].every((c) => c.tagName === 'TH' && c.getAttribute('bgcolor') && /background-color/.test(c.getAttribute('style')!))).toBe(true);
    for (const c of t.rows[1]!.cells) expect(c.getAttribute('style')).toMatch(/border: 1px solid #cccccc; padding: 6px 10px; vertical-align: top/);
    expect(t.querySelector('[class]')).toBeNull();
  });

  it('survives the composer allow-list with its attributes and styles, and reads as rows in the text alternative', () => {
    const html = tableHtml({ rows: 2, cols: 2, header: true, style: 'striped' }).replace('<br></th>', 'Item</th>').replace(/<td([^>]*)><br><\/td>/, '<td$1>Pen</td>');
    const out = cleanComposeHtml(html);
    expect(out).toContain('<table border="1" cellpadding="6" cellspacing="0" width="100%" style="border-collapse: collapse; width: 100%; border: 1px solid #cccccc">');
    expect(out).toMatch(/<th bgcolor="#f1f3f4" style="border: 1px solid #cccccc; padding: 6px 10px; vertical-align: top; text-align: left; background-color: #f1f3f4; font-weight: bold">Item<\/th>/);
    expect(cleanComposeHtml(out)).toBe(out);
    expect(composeText('<table><tr><td>Item</td><td>Qty</td></tr><tr><td>Pen</td><td>2</td></tr></table>')).toBe('Item | Qty\nPen | 2');
    // Attributes with values a client could misread go.
    expect(cleanComposeHtml('<table border="1 onclick=x" width="expression(1)"><tr><td colspan="2" bgcolor="red;x" onclick="x()">a</td></tr></table>')).toBe('<table><tbody><tr><td colspan="2">a</td></tr></tbody></table>');
  });

  it('inserts rows and columns, growing merged cells that cross the gap', () => {
    const t = table(named([['a', 'b', 'c'], ['d', 'e', 'f']]));
    insertRow(t.rows[0]!.cells[1]!, 'below');
    expect(shape(t)).toBe('a b c\n· · ·\nd e f');
    insertRow(t.rows[0]!.cells[0]!, 'above');
    expect(shape(t)).toBe('· · ·\na b c\n· · ·\nd e f');
    insertColumn(t.rows[1]!.cells[0]!, 'right');
    expect(shape(t)).toBe('· · · ·\na · b c\n· · · ·\nd · e f');
    insertColumn(t.rows[1]!.cells[3]!, 'left');
    expect(gridOf(t).width).toBe(5);
    expect(shape(t).split('\n')[1]).toBe('a · b · c');

    const m = table(named([['a', 'b'], ['c', 'd']]));
    expect(mergeCells(m.rows[0]!.cells[0]!, 'down')).toBe(true);
    expect(shape(m)).toBe('ac:1x2 b\nd');
    // A row added between the two rows of a merged cell makes it taller, not a cell short.
    insertRow(m.rows[0]!.cells[1]!, 'below');
    expect(shape(m)).toBe('ac:1x3 b\n·\nd');
    expect(gridOf(m).slots.every((r) => r.length === 2)).toBe(true);
    // A column beside a cell spanning rows adds a cell to each row it covers.
    insertColumn(m.rows[0]!.cells[0]!, 'right');
    expect(gridOf(m).slots.every((r) => r.length === 3)).toBe(true);
  });

  it('deletes rows, columns and, with the last of them, the table', () => {
    const t = table(named([['a', 'b'], ['c', 'd']]));
    const caret = deleteRow(t.rows[0]!.cells[0]!);
    expect(shape(t)).toBe('c d');
    expect(caret?.textContent).toBe('c');
    deleteColumn(t.rows[0]!.cells[1]!);
    expect(shape(t)).toBe('c');
    expect(deleteRow(t.rows[0]!.cells[0]!)).toBeNull();
    expect(document.querySelector('table')).toBeNull();

    const m = table(named([['a', 'b', 'c'], ['d', 'e', 'f']]));
    mergeCells(m.rows[0]!.cells[0]!, 'right');
    expect(shape(m)).toBe('ab:2x1 c\nd e f');
    // Deleting a column a merged cell spans narrows it.
    deleteColumn(m.rows[1]!.cells[1]!);
    expect(shape(m)).toBe('ab c\nd f');
  });

  it('merges and splits cells, keeping what was written', () => {
    const t = table(named([['a', 'b'], ['c', 'd']]));
    expect(mergeCells(t.rows[0]!.cells[1]!, 'right')).toBe(false);
    mergeCells(t.rows[0]!.cells[0]!, 'right');
    expect(t.rows[0]!.cells[0]!.colSpan).toBe(2);
    expect(t.rows[0]!.cells[0]!.innerHTML).toBe('a<br>b');
    expect(splitCell(t.rows[0]!.cells[0]!)).toBe(true);
    expect(shape(t)).toBe('ab ·\nc d');
    expect(splitCell(t.rows[0]!.cells[0]!)).toBe(false);
    mergeCells(t.rows[0]!.cells[0]!, 'down');
    splitCell(t.rows[0]!.cells[0]!);
    expect(gridOf(t).slots.map((r) => r.length)).toEqual([2, 2]);
  });

  it('toggles the header row, colours cells, sets borders, alignment, width and styles', () => {
    const t = table(tableHtml({ rows: 3, cols: 2 }));
    expect(hasHeader(t)).toBe(false);
    toggleHeader(t);
    expect(hasHeader(t)).toBe(true);
    expect(t.rows[0]!.cells[0]!.getAttribute('bgcolor')).toBe('#f1f3f4');
    toggleHeader(t);
    expect(hasHeader(t)).toBe(false);
    expect(t.rows[0]!.cells[0]!.getAttribute('bgcolor')).toBeNull();

    const cell = t.rows[1]!.cells[1]!;
    cellBackground([cell], '#fef7e0');
    expect(cell.getAttribute('bgcolor')).toBe('#fef7e0');
    expect(cell.style.backgroundColor).toBe('rgb(254, 247, 224)');
    alignCell([cell], 'center', 'middle');
    expect([cell.getAttribute('align'), cell.getAttribute('valign'), cell.style.textAlign, cell.style.verticalAlign]).toEqual(['center', 'middle', 'center', 'middle']);

    expect(bordersOf(t)).toBe('all');
    setBorders(t, 'outside');
    expect(bordersOf(t)).toBe('outside');
    expect(t.getAttribute('border')).toBe('0');
    expect(cell.style.border).toBe('');
    setBorders(t, 'none');
    expect(bordersOf(t)).toBe('none');
    setBorders(t, 'all');
    setBorderColour(t, '#1a56db');
    expect(cell.style.border).toMatch(/^1px solid (#1a56db|rgb\(26, 86, 219\))$/);
    expect(bordersOf(t)).toBe('all');

    setTableWidth(t, 'fit');
    expect(t.getAttribute('width')).toBeNull();
    setColumnWidth(t, 0, 140);
    expect([...t.rows].map((r) => r.cells[0]!.getAttribute('width'))).toEqual(['140', '140', '140']);
    setTableWidth(t, 'full');
    expect(t.getAttribute('width')).toBe('100%');

    applyTableStyle(t, 'striped');
    expect([...t.rows].map((r) => r.cells[0]!.getAttribute('bgcolor'))).toEqual([null, '#f6f8fa', null]);
    // Stripes follow rows as they come and go.
    insertRow(t.rows[0]!.cells[0]!, 'above');
    expect([...t.rows].map((r) => r.cells[0]!.getAttribute('bgcolor'))).toEqual([null, '#f6f8fa', null, '#f6f8fa']);
    applyTableStyle(t, 'header');
    expect(hasHeader(t)).toBe(true);
    expect(t.rows[0]!.cells[0]!.style.color).toBe('rgb(255, 255, 255)');
    applyTableStyle(t, 'plain');
    expect(bordersOf(t)).toBe('none');
  });

  it('moves the caret through the cells in reading order for Tab', () => {
    const t = table(named([['a', 'b'], ['c', 'd']]));
    expect(nextCell(t.rows[0]!.cells[1]!)?.textContent).toBe('c');
    expect(nextCell(t.rows[1]!.cells[0]!, true)?.textContent).toBe('b');
    expect(nextCell(t.rows[1]!.cells[1]!)).toBeNull();
  });
});

describe('pictures', () => {
  const blob = (size: number) => new Blob([new Uint8Array(size)]);

  it('leaves a small, safe picture as it is', async () => {
    const encode = vi_fn();
    const out = await fitImage({ width: 800, height: 600, bytes: 300_000, type: 'image/png' }, encode);
    expect(out).toMatchObject({ blob: null, shrunk: false, width: 800 });
    expect(encode.calls).toHaveLength(0);
  });

  it('makes a big picture no wider than 1600 px and under 1 MB, as JPEG', async () => {
    const encode = vi_fn((w, _h, _t, q) => blob(w * (q > 0.8 ? 1500 : 500)));
    const out = await fitImage({ width: 4000, height: 3000, bytes: 6_000_000, type: 'image/jpeg' }, encode);
    expect(out.shrunk).toBe(true);
    expect(out.width).toBe(1600);
    expect(out.height).toBe(1200);
    expect(out.type).toBe('image/jpeg');
    expect(out.blob!.size).toBeLessThanOrEqual(1_000_000);
    // Quality first, at the same size.
    expect(encode.calls.map((c) => [c[0], c[3]])).toEqual([
      [1600, 0.85],
      [1600, 0.75],
    ]);
  });

  it('keeps transparency as PNG while it fits, then gives way to JPEG; WebP never goes out as WebP', async () => {
    const png = await fitImage({ width: 3000, height: 1000, bytes: 3_000_000, type: 'image/png', transparent: true }, vi_fn((w) => blob(w * 300)));
    expect(png).toMatchObject({ type: 'image/png', width: 1600 });
    const huge = await fitImage({ width: 3000, height: 1000, bytes: 3_000_000, type: 'image/png', transparent: true }, vi_fn((w, _h, t) => blob(t === 'image/png' ? 5_000_000 : w * 100)));
    expect(huge.type).toBe('image/jpeg');
    const webp = await fitImage({ width: 100, height: 100, bytes: 1000, type: 'image/webp' }, vi_fn(() => blob(900)));
    expect(webp.type).toBe('image/jpeg');
    expect(webp.shrunk).toBe(true);
  });

  it('counts the bytes of embedded pictures (a picture used twice once)', () => {
    const a = `data:image/png;base64,${btoa('x'.repeat(300))}`;
    expect(dataUrlBytes(a)).toBe(300);
    expect(embeddedBytes(`<p>${imageHtml({ src: a })}${imageHtml({ src: a })}<img src="https://example.com/a.png"></p>`)).toBe(300);
    const file = dataUrlToFile(a, 'logo');
    expect(file.name).toBe('logo.png');
    expect(file.type).toBe('image/png');
    expect(file.size).toBe(300);
  });

  it('keeps embedded, inline (cid) and remote pictures through the allow-list — and nothing that could run', () => {
    const data = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';
    expect(cleanComposeHtml(`<img src="${data}" alt="Logo" width="200" style="width: 200px; max-width: 100%; height: auto; float: left; margin: 0 12px 8px 0" align="left" onload="x()">`)).toBe(
      `<img src="${data}" alt="Logo" width="200" align="left" style="width: 200px; max-width: 100%; height: auto; float: left; margin: 0 12px 8px 0">`,
    );
    expect(cleanComposeHtml('<img src="cid:img1@worksuite.lk">')).toBe('<img src="cid:img1@worksuite.lk">');
    for (const bad of ['javascript:alert(1)', 'data:image/svg+xml;base64,PHN2Zz4=', 'data:text/html;base64,PGI+', 'file:///C:/x.png', 'x']) expect(cleanComposeHtml(`<img src="${bad}">`)).toBe('');
    expect(composeText('<div>See <img src="cid:a" alt="the chart"></div>')).toBe('See [the chart]');
  });

  it('sizes and places a picture both ways mail clients read it', () => {
    document.body.innerHTML = imageHtml({ src: 'https://example.com/a.png', width: 900 });
    const img = document.querySelector('img')!;
    expect(img.getAttribute('width')).toBe('600');
    sizeImage(img, 'small');
    expect([img.getAttribute('width'), img.style.width, img.style.maxWidth]).toEqual(['200', '200px', '100%']);
    sizeImage(img, 'full');
    expect(img.getAttribute('width')).toBe('100%');
    alignImage(img, 'right');
    expect([img.getAttribute('align'), img.style.cssFloat]).toEqual(['right', 'right']);
    alignImage(img, 'center');
    expect([img.getAttribute('align'), img.style.display, img.style.marginLeft]).toEqual([null, 'block', 'auto']);
    expect(cropRect(1000, 500, { top: 10, right: 20, bottom: 0, left: 10 })).toEqual({ x: 100, y: 50, w: 700, h: 450 });
  });
});

describe('inserting', () => {
  it('writes buttons, lines, code and checklists as email-safe HTML that survives the allow-list', () => {
    const b = buttonHtml('Book a call', 'https://example.com/book?a=1&b=2');
    expect(b).toContain('<td bgcolor="#1a56db" style="background-color: #1a56db; padding: 10px 18px; text-align: center"><a href="https://example.com/book?a=1&amp;b=2" style="color: #ffffff; font-weight: bold; text-decoration: none">Book a call</a>');
    expect(cleanComposeHtml(b)).toContain('href="https://example.com/book?a=1&amp;b=2"');
    expect(cleanComposeHtml(HR_HTML)).toContain('<hr style="border: none; border-top: 1px solid #cccccc; margin: 12px 0">');
    expect(cleanComposeHtml(codeBlockHtml('a < b'))).toContain('<pre style="font-family: Consolas, Menlo, Courier New, monospace; font-size: 13px; background-color: #f6f8fa; border: 1px solid #e1e4e8; padding: 8px 10px; white-space: pre-wrap">a &lt; b</pre>');
    expect(cleanComposeHtml(checklistHtml(['Buy milk']))).toBe('<ul style="list-style-type: none; padding-left: 4px; margin-left: 0"><li>☐ Buy milk</li></ul>');
    // Fonts and sizes from the browser's commands leave as styles.
    expect(cleanComposeHtml('<font face="Georgia, Times New Roman, serif" size="5" color="#c5221f">Hi</font>')).toBe('<span style="color: #c5221f; font-family: Georgia, Times New Roman, serif; font-size: 24px">Hi</span>');
  });
});

describe('pasting from Word and Excel', () => {
  const WORD = `<html xmlns:o="urn:schemas-microsoft-com:office:office"><head><style>p.MsoNormal{margin:0}</style><!--[if gte mso 9]><xml><o:OfficeDocumentSettings/></xml><![endif]--></head><body><!--StartFragment--><p class="MsoNormal" style="margin:0cm;mso-line-height-alt:12pt;font-family:Calibri"><b>Hello</b><o:p></o:p></p><p class=MsoListParagraph style='mso-list:l0 level1 lfo1'><![if !supportLists]>1.<![endif]>First</p><p class="MsoNormal">&nbsp;</p><!--EndFragment--></body></html>`;

  it('takes out Office-only markup and keeps the words and formatting', () => {
    expect(isOfficeHtml(WORD)).toBe(true);
    expect(isOfficeHtml('<p><b>plain</b></p>')).toBe(false);
    const out = cleanOfficeHtml(WORD);
    expect(out).not.toMatch(/mso-|Mso|<o:p|<!--|xml|<style/i);
    expect(out).toContain('<b>Hello</b>');
    expect(out).toContain('font-family:Calibri');
    expect(out).toContain('1.First');
    expect(out).toContain('<p><br></p>');
  });

  it('pastes as kept formatting, plain text or the message’s own style', () => {
    const data = { html: '<p style="color:#ff0000;font-family:Comic Sans MS;font-size:20px;text-align:center"><b>Big</b> <a href="https://x.example">news</a><script>x()</script></p>', text: 'Big news\nsecond' };
    expect(pastedHtml(data, 'keep', cleanComposeHtml)).toBe('<p style="color: #ff0000; font-family: Comic Sans MS; font-size: 20px; text-align: center"><b>Big</b> <a href="https://x.example">news</a></p>');
    expect(pastedHtml(data, 'match', cleanComposeHtml)).toBe('<p style="text-align: center"><b>Big</b> <a href="https://x.example">news</a></p>');
    expect(pastedHtml(data, 'plain', cleanComposeHtml)).toBe('<div>Big news</div><div>second</div>');
    expect(pastedHtml({ html: WORD, text: '' }, 'keep', cleanComposeHtml)).toBe('<p style="margin: 0cm; font-family: Calibri"><b>Hello</b></p><p>1.First</p><p><br></p>');
    expect(matchStyle('<font color="red" face="Arial">x</font><td bgcolor="#000">y</td>')).toBe('xy');
  });
});

describe('toolbar overflow', () => {
  it('shows everything that fits, and leaves room for More when not all does', () => {
    expect(fitCount([32, 32, 32], 100, 36)).toBe(3);
    expect(fitCount([32, 32, 32, 32], 100, 36)).toBe(2);
    expect(fitCount([32, 32, 32, 32], 99, 36)).toBe(1);
    expect(fitCount([32, 32, 32, 32], 140, 36, 2)).toBe(4);
    expect(fitCount([32, 32, 32, 32], 130, 36, 2)).toBe(2);
    // A divider is never left last before More.
    expect(fitCount([32, 9, 32, 32], 100, 36, 0, [false, true, false, false])).toBe(1);
    expect(fitCount([32, 32], 0, 36)).toBe(0);
  });
});

/** A tiny spy that records its calls (vi.fn's generics fight the Encoder type). */
function vi_fn(impl: (...a: Parameters<Encoder>) => Blob | Promise<Blob> = () => new Blob([])): Encoder & { calls: Parameters<Encoder>[] } {
  const calls: Parameters<Encoder>[] = [];
  const f = (async (...a: Parameters<Encoder>) => {
    calls.push(a);
    return impl(...a);
  }) as Encoder & { calls: Parameters<Encoder>[] };
  f.calls = calls;
  return f;
}

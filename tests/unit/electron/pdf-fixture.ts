/**
 * Small PDFs written by hand for the PDF Studio tests: real files a real
 * PDFium opens, with exactly the features a test asks for — so no binary
 * fixture is checked in, and a 2,000-page file costs nothing to make.
 */
export interface FixtureOptions {
  pages?: number;
  /** Text on each page, `{n}` replaced with the page number. */
  text?: string;
  outline?: boolean;
  /** A document-level script and an OpenAction script (never run). */
  javascript?: boolean;
  /** The same script key hidden behind a `#xx` escape (pdfid's trick). */
  hiddenJavascript?: boolean;
  launch?: boolean;
  uri?: string;
  /** A link on page 1 to page 2. */
  internalLink?: boolean;
  /** Page 2 turned 90°. */
  rotate?: boolean;
  attachment?: { name: string; body: string };
  /** A sticky-note comment on page 1 with this text. */
  comment?: string;
  info?: { title?: string; author?: string };
}

export function makePdf(o: FixtureOptions = {}): Buffer {
  const pages = o.pages ?? 3;
  const objs: Array<string | null> = [];
  const add = (s: string | null) => {
    objs.push(s);
    return objs.length;
  };
  const esc = (s: string) => s.replace(/[\\()]/g, (c) => `\\${c}`);
  const catalog = add(null);
  const pagesId = add(null);
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const pageIds: number[] = [];
  const pageAnnots: number[][] = [];
  for (let i = 0; i < pages; i++) {
    const line = esc((o.text ?? 'Page {n} of the fixture. Needle here on page {n}.').replaceAll('{n}', String(i + 1)));
    const content = `BT /F1 18 Tf 72 700 Td (${line}) Tj ET`;
    const c = add(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    pageIds.push(add(null));
    pageAnnots.push([]);
    void c;
  }
  const annot = (page: number, dict: string) => pageAnnots[page]!.push(add(dict));
  if (o.uri) annot(0, `<< /Type /Annot /Subtype /Link /Rect [72 600 300 620] /Border [0 0 0] /A << /S /URI /URI (${esc(o.uri)}) >> >>`);
  if (o.launch) annot(0, '<< /Type /Annot /Subtype /Link /Rect [72 560 300 580] /Border [0 0 0] /A << /S /Launch /F (calc.exe) >> >>');
  if (o.internalLink && pages > 1) annot(0, `<< /Type /Annot /Subtype /Link /Rect [72 520 300 540] /Border [0 0 0] /Dest [PAGE2 0 R /Fit] >>`);
  if (o.comment) annot(0, `<< /Type /Annot /Subtype /Text /Rect [400 700 420 720] /Contents (${esc(o.comment)}) /Name /Comment >>`);
  for (let i = 0; i < pages; i++) {
    const contentId = pageIds[i]! - 1;
    const annots = pageAnnots[i]!.length ? ` /Annots [${pageAnnots[i]!.map((a) => `${a} 0 R`).join(' ')}]` : '';
    const rot = o.rotate && i === 1 ? ' /Rotate 90' : '';
    objs[pageIds[i]! - 1] = `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 792]${rot} /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${contentId} 0 R${annots} >>`;
  }
  // Late-bound references to page 2.
  for (let k = 0; k < objs.length; k++) if (objs[k]?.includes('PAGE2')) objs[k] = objs[k]!.replace('PAGE2', String(pageIds[1]));
  objs[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map((p) => `${p} 0 R`).join(' ')}] /Count ${pages} >>`;
  let extra = '';
  const names: string[] = [];
  if (o.outline) {
    const root = add(null);
    const a = add(null);
    const b = add(null);
    const child = add(null);
    objs[root - 1] = `<< /Type /Outlines /First ${a} 0 R /Last ${b} 0 R /Count 3 >>`;
    objs[a - 1] = `<< /Title (Chapter One) /Parent ${root} 0 R /Next ${b} 0 R /First ${child} 0 R /Last ${child} 0 R /Count 1 /Dest [${pageIds[0]} 0 R /XYZ 0 792 0] >>`;
    objs[child - 1] = `<< /Title (Section 1.1) /Parent ${a} 0 R /Dest [${pageIds[Math.min(1, pages - 1)]} 0 R /Fit] >>`;
    objs[b - 1] = `<< /Title (Chapter Two) /Parent ${root} 0 R /Prev ${a} 0 R /Dest [${pageIds[pages - 1]} 0 R /Fit] >>`;
    extra += ` /Outlines ${root} 0 R /PageMode /UseOutlines`;
  }
  if (o.javascript) {
    const js = add("<< /S /JavaScript /JS (app.alert\\('blocked'\\);) >>");
    names.push(`/JavaScript << /Names [(a) ${js} 0 R] >>`);
    extra += ` /OpenAction ${js} 0 R`;
  }
  if (o.hiddenJavascript) {
    const js = add("<< /S /JavaScript /J#53 (app.alert\\('hidden'\\);) >>");
    extra += ` /AA << /WC ${js} 0 R >>`;
  }
  if (o.attachment) {
    const body = o.attachment.body;
    const file = add(`<< /Type /EmbeddedFile /Length ${body.length} /Params << /Size ${body.length} >> >>\nstream\n${body}\nendstream`);
    const spec = add(`<< /Type /Filespec /F (${esc(o.attachment.name)}) /UF (${esc(o.attachment.name)}) /EF << /F ${file} 0 R >> >>`);
    names.push(`/EmbeddedFiles << /Names [(${esc(o.attachment.name)}) ${spec} 0 R] >>`);
  }
  if (names.length) extra += ` /Names << ${names.join(' ')} >>`;
  objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R${extra} >>`;
  const info = o.info ? add(`<< ${o.info.title ? `/Title (${esc(o.info.title)})` : ''} ${o.info.author ? `/Author (${esc(o.info.author)})` : ''} /CreationDate (D:20260929174200+05'30') >>`) : 0;

  let out = '%PDF-1.7\n%\xE2\xE3\xCF\xD3\n';
  const offsets: number[] = [];
  objs.forEach((obj, i) => {
    offsets.push(Buffer.byteLength(out, 'latin1'));
    out += `${i + 1} 0 obj\n${obj ?? 'null'}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((n) => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R${info ? ` /Info ${info} 0 R` : ''} >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

/**
 * The email as blocks — text, a picture, a button, two columns, a rule — and
 * the HTML each block is saved as.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ONE FORMAT, TWO CLIENTS
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * This is the web client's format (`web/src/pages/marketing/blocks.ts`),
 * mirrored function for function: the same marks, the same markup for every
 * block, the same reading rules. A campaign written here opens as the same
 * blocks on the web, and the other way round, and saving it in either writes
 * the same bytes. Change one, change both.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE HTML IS THE RECORD; THE BLOCKS ARE READ BACK OUT OF IT
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * A campaign stores `body_html` and nothing else, and that HTML is what the
 * server cleans, checks, personalises and sends. Each block is written as one
 * top-level element marked `data-block="…"`, and opening the campaign again
 * reads the blocks back from those marks. `EmailHtml::clean` takes out event
 * handlers, `javascript:` addresses and dangerous styles, and keeps every
 * other attribute — `data-*` among them — so the marks survive the save.
 *
 *   text     <div data-block="text">…paragraphs, headings, lists, links…</div>
 *   image    <div data-block="image" style="margin:0 0 16px"><a href="…" style="display:block"><img src="…" alt="…" width="536" style="…"></a></div>
 *            (no <a> without a link; an empty mark while no picture is chosen)
 *   button   <div data-block="button" style="margin:8px 0 24px"><table role="presentation" …><tr>
 *              <td style="border-radius:6px;background:#2563eb"><a href="…" style="…">Label</a></td></tr></table></div>
 *   columns  <div data-block="columns" style="margin:0 0 16px"><table role="presentation" width="100%" …><tr>
 *              <td data-col="text|image" width="50%" valign="top" style="…">…</td> ×2</tr></table></div>
 *   divider  <div data-block="divider" style="padding:16px 0"><hr style="border:0;border-top:1px solid #e5e7eb;margin:0"></div>
 *
 * What is written is what email needs: tables for the button and the
 * columns, every style inline, no `<button>` (the server drops it), widths in
 * pixels for Outlook. The footer is not a block: the server adds it to every
 * copy, with the company's postal address and the unsubscribe and preferences
 * links, and it cannot be edited out.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * HTML THAT IS NOT A BLOCK IS KEPT AS IT IS
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * A campaign written before the block editor, a pasted newsletter, a starter:
 * none of it carries the marks. It becomes an "HTML" block whose markup is
 * kept exactly as written and written back exactly so — a body with no marks
 * at all comes back byte for byte. Turning it into blocks is the writer's
 * choice (`convertHtml`), never done on opening.
 *
 * Text blocks are edited in the page itself, so their markup goes through
 * `sanitizeText` — an allowlist of the tags and attributes a paragraph needs —
 * before it is ever put into the page, and again before it is saved.
 *
 * (Below the format: what only this client needs — cleaning an HTML block to
 * show it inside the app, and the checks the editor makes as you type.)
 */

export type BlockType = 'text' | 'image' | 'button' | 'columns' | 'divider' | 'html';

export interface TextBlock { id: string; type: 'text'; html: string }
/** `width` null is the full column; otherwise pixels, centred. */
export interface ImageBlock { id: string; type: 'image'; src: string; alt: string; href: string; width: number | null }
export interface ButtonBlock { id: string; type: 'button'; label: string; href: string; color: string }
export type Column = { kind: 'text'; html: string } | { kind: 'image'; src: string; alt: string; href: string };
export interface ColumnsBlock { id: string; type: 'columns'; columns: [Column, Column] }
export interface DividerBlock { id: string; type: 'divider'; spacing: number }
/** Markup kept exactly as written: a campaign from before blocks, or anything the blocks cannot say. */
export interface HtmlBlock { id: string; type: 'html'; html: string }

/**
 * Dynamic content (MKT-EDT-08): a block shown only to a segment's members, or
 * to everybody but them — `data-show-segment` / `data-hide-segment` on its
 * mark, decided per copy by the server (`Content::personalise`).
 */
export interface BlockRule { mode: 'show' | 'hide'; segment: number }

export type Block = (TextBlock | ImageBlock | ButtonBlock | ColumnsBlock | DividerBlock | HtmlBlock) & { rule?: BlockRule };

/** The email's column, inside the 32px padding the server's layout gives it (600 − 2 × 32). */
export const CONTENT_WIDTH = 536;
export const IMAGE_WIDTHS = [400, 300, 200] as const;
export const DIVIDER_SPACING = [8, 16, 24, 32] as const;
/** The email's button colour, as the server's starters and the web editor write it — the email's, not the app's. */
export const BUTTON_COLOR = '#2563eb';
/** Colours a button can take with one click; any other is typed as a hex code. */
export const BUTTON_COLOURS = [BUTTON_COLOR, '#0f766e', '#111827', '#b45309', '#be123c'];

export const TYPE_WORD: Record<BlockType, string> = { text: 'Text', image: 'Image', button: 'Button', columns: 'Columns', divider: 'Divider', html: 'HTML' };

const MARKED = new Set<string>(['text', 'image', 'button', 'columns', 'divider', 'html']);

let seq = 0;

/** An id for a block on screen. Never saved: the HTML is the record. */
export function newId(): string {
  seq += 1;
  return `blk${seq}`;
}

/** A new block of a kind, as the palette adds it. */
export function makeBlock(type: Exclude<BlockType, 'html'>): Block {
  switch (type) {
    case 'text':
      return { id: newId(), type, html: '<p>Write your text here.</p>' };
    case 'image':
      return { id: newId(), type, src: '', alt: '', href: '', width: null };
    case 'button':
      return { id: newId(), type, label: 'Find out more', href: '', color: BUTTON_COLOR };
    case 'columns':
      return { id: newId(), type, columns: [{ kind: 'text', html: '<p>Left column.</p>' }, { kind: 'image', src: '', alt: '', href: '' }] };
    default:
      return { id: newId(), type: 'divider', spacing: 16 };
  }
}

/** A block with some of its settings changed. */
export function changed<B extends Block>(b: B, patch: Partial<Omit<B, 'id' | 'type'>>): B {
  return { ...b, ...patch };
}

/** The same block again, under a new id (Duplicate). */
export function copyOf<B extends Block>(b: B): B {
  return { ...b, id: newId() };
}

/* ------------------------------------------------------------------ *
 * Escaping, and the addresses and styles allowed through
 * ------------------------------------------------------------------ */

function escText(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\u00a0/g, '&nbsp;');
}

function escAttr(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * An address a link or a picture may carry: the web, mail, a phone number, an
 * anchor, or a merge tag (`{{unsubscribe_url}}`). Anything else — `javascript:`
 * first among them — is no address at all.
 */
export function safeUrl(v: string | null | undefined): string {
  const t = (v ?? '').trim();
  return /^(https?:|mailto:|tel:|#)/i.test(t) || /^\{\{\s*[a-z_]+(\.[a-z_]+)?\s*(\|[^}]*)?\}\}/i.test(t) ? t : '';
}

/** A web address as somebody typed it, with the https:// they left off. */
export function withScheme(v: string): string {
  const t = v.trim();
  if (t === '' || safeUrl(t) !== '') return t;
  return /^[\w-]+(\.[\w-]+)+/.test(t) ? `https://${t}` : t;
}

function safeStyle(v: string | null): string {
  const t = (v ?? '').trim();
  return t === '' || /expression\s*\(|javascript:|vbscript:|behavior\s*:|-moz-binding|url\s*\(|@import/i.test(t) ? '' : t;
}

function safeColor(v: string): string {
  return /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(v.trim()) ? v.trim().toLowerCase() : BUTTON_COLOR;
}

/* ------------------------------------------------------------------ *
 * Text: the allowlist
 * ------------------------------------------------------------------ */

/** What a paragraph may be made of. Anything else is unwrapped to its text. */
const TEXT_TAGS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'a', 'ul', 'ol', 'li', 'span', 'blockquote', 'div', 'sub', 'sup', 'small']);

/** What goes with everything inside it: things that run, things that load, things that ask for input. */
const DROP_TAGS = new Set(['script', 'style', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'form', 'input', 'button', 'textarea',
  'select', 'option', 'base', 'meta', 'link', 'noscript', 'template', 'svg', 'math', 'img', 'picture', 'video', 'audio', 'canvas', 'head', 'title']);

function parse(html: string): Document {
  return new DOMParser().parseFromString(`<!doctype html><html><head><meta charset="utf-8"></head><body>${html}</body></html>`, 'text/html');
}

function cleanNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return escText(node.nodeValue ?? '');
  if (node.nodeType !== Node.ELEMENT_NODE) return '';

  const el = node as Element;
  const tag = el.tagName.toLowerCase();

  if (DROP_TAGS.has(tag)) return '';

  const inner = Array.from(el.childNodes).map(cleanNode).join('');

  if (!TEXT_TAGS.has(tag)) return inner;
  if (tag === 'br') return '<br>';

  const attrs: string[] = [];

  if (tag === 'a') {
    const href = safeUrl(el.getAttribute('href'));
    if (href !== '') attrs.push(`href="${escAttr(href)}"`);
  }

  const style = safeStyle(el.getAttribute('style'));
  if (style !== '') attrs.push(`style="${escAttr(style)}"`);

  /* A bare span says nothing; editors leave them everywhere. */
  if (tag === 'span' && attrs.length === 0) return inner;

  return `<${tag}${attrs.length ? ` ${attrs.join(' ')}` : ''}>${inner}</${tag}>`;
}

/**
 * A paragraph's markup with everything a paragraph does not need taken out:
 * no scripts, no event handlers, no pictures, no addresses that run. Safe to
 * put into the page, and the same on the second pass as on the first.
 */
export function sanitizeText(html: string): string {
  return Array.from(parse(html).body.childNodes).map(cleanNode).join('').trim();
}

/** The words of some markup, for a summary or a label. */
export function plainText(html: string): string {
  return (parse(html).body.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/* ------------------------------------------------------------------ *
 * Blocks → HTML
 * ------------------------------------------------------------------ */

function imageTag(src: string, alt: string, width: number, full: boolean): string {
  return `<img src="${escAttr(src)}" alt="${escAttr(alt)}" width="${width}" style="display:block;${full ? 'width:100%;' : 'margin:0 auto;'}max-width:100%;height:auto;border:0">`;
}

function linked(href: string, inner: string): string {
  const h = safeUrl(href);
  return h === '' ? inner : `<a href="${escAttr(h)}" style="display:block">${inner}</a>`;
}

function columnHtml(col: Column, side: 0 | 1): string {
  const pad = side === 0 ? 'padding:0 8px 0 0' : 'padding:0 0 0 8px';
  const inner = col.kind === 'text'
    ? sanitizeText(col.html)
    : safeUrl(col.src) === '' ? '' : linked(col.href, imageTag(col.src, col.alt, CONTENT_WIDTH / 2 - 8, true));

  return `<td data-col="${col.kind}" width="50%" valign="top" style="${pad}">${inner}</td>`;
}

/** One block as the HTML it is saved as, with its show/hide rule on its mark. */
export function blockHtml(b: Block): string {
  const html = bareHtml(b);
  if (!b.rule || b.type === 'html' || !(b.rule.segment > 0)) return html;
  return html.replace(`data-block="${b.type}"`, `data-block="${b.type}" data-${b.rule.mode}-segment="${Math.round(b.rule.segment)}"`);
}

/** The rule a marked element carries, if any. */
export function ruleOf(el: Element): BlockRule | undefined {
  const show = Number(el.getAttribute('data-show-segment'));
  const hide = Number(el.getAttribute('data-hide-segment'));
  if (show > 0) return { mode: 'show', segment: show };
  if (hide > 0) return { mode: 'hide', segment: hide };
  return undefined;
}

function bareHtml(b: Block): string {
  switch (b.type) {
    case 'text':
      return `<div data-block="text">${sanitizeText(b.html)}</div>`;
    case 'image': {
      /* A picture not chosen yet is kept as an empty mark: nothing in the email, the block still there on reopening. */
      if (safeUrl(b.src) === '') return '<div data-block="image" style="margin:0 0 16px"></div>';
      const full = b.width === null || b.width >= CONTENT_WIDTH;
      return `<div data-block="image" style="margin:0 0 16px">${linked(b.href, imageTag(b.src, b.alt, full ? CONTENT_WIDTH : b.width ?? CONTENT_WIDTH, full))}</div>`;
    }
    case 'button':
      return '<div data-block="button" style="margin:8px 0 24px"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>'
        + `<td style="border-radius:6px;background:${safeColor(b.color)}"><a href="${escAttr(safeUrl(b.href))}" style="display:inline-block;padding:12px 24px;font-weight:600;color:#ffffff;text-decoration:none">${escText(b.label)}</a></td>`
        + '</tr></table></div>';
    case 'columns':
      return '<div data-block="columns" style="margin:0 0 16px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>'
        + `${columnHtml(b.columns[0], 0)}${columnHtml(b.columns[1], 1)}</tr></table></div>`;
    case 'divider':
      return `<div data-block="divider" style="padding:${Math.max(0, Math.round(b.spacing))}px 0"><hr style="border:0;border-top:1px solid #e5e7eb;margin:0"></div>`;
    default:
      /* Exactly as written; the server cleans it as it cleans everything. */
      return b.html;
  }
}

/** The blocks as the body the campaign saves. */
export function serializeBlocks(blocks: Block[]): string {
  return blocks.map(blockHtml).join('');
}

/* ------------------------------------------------------------------ *
 * HTML → blocks
 * ------------------------------------------------------------------ */

function imageOf(scope: Element): { src: string; alt: string; href: string; width: number | null } | null {
  const img = scope.querySelector('img');
  if (!img) return null;
  const w = Number(img.getAttribute('width'));
  const a = img.closest('a');
  return {
    src: img.getAttribute('src') ?? '',
    alt: img.getAttribute('alt') ?? '',
    href: a && scope.contains(a) ? a.getAttribute('href') ?? '' : '',
    width: !w || w >= CONTENT_WIDTH ? null : w,
  };
}

function columnOf(td: Element): Column {
  if (td.getAttribute('data-col') === 'image') {
    const img = imageOf(td);
    return { kind: 'image', src: img?.src ?? '', alt: img?.alt ?? '', href: img?.href ?? '' };
  }
  return { kind: 'text', html: sanitizeText(td.innerHTML) };
}

/** A marked element read back as its block, or null when it is not one any more (hand-edited, say). */
function fromMarked(el: Element): Block | null {
  switch (el.getAttribute('data-block') ?? '') {
    case 'text':
      return { id: newId(), type: 'text', html: sanitizeText(el.innerHTML) };
    case 'image': {
      const img = imageOf(el);
      return { id: newId(), type: 'image', src: img?.src ?? '', alt: img?.alt ?? '', href: img?.href ?? '', width: img?.width ?? null };
    }
    case 'button': {
      const a = el.querySelector('a');
      if (!a) return null;
      const td = a.closest('td');
      const bg = /background(?:-color)?\s*:\s*([^;]+)/i.exec(td?.getAttribute('style') ?? '')?.[1] ?? td?.getAttribute('bgcolor') ?? BUTTON_COLOR;
      return { id: newId(), type: 'button', label: (a.textContent ?? '').trim(), href: a.getAttribute('href') ?? '', color: safeColor(bg) };
    }
    case 'columns': {
      const tds = Array.from(el.querySelectorAll('td[data-col]'));
      return tds.length === 2 ? { id: newId(), type: 'columns', columns: [columnOf(tds[0]!), columnOf(tds[1]!)] } : null;
    }
    case 'divider': {
      const pad = /padding\s*:\s*(\d+)px/i.exec(el.getAttribute('style') ?? '');
      return { id: newId(), type: 'divider', spacing: pad ? Number(pad[1]) : 16 };
    }
    default:
      return null;
  }
}

function outer(node: Node): string {
  if (node.nodeType === Node.ELEMENT_NODE) return (node as Element).outerHTML;
  if (node.nodeType === Node.TEXT_NODE) return escText(node.nodeValue ?? '');
  if (node.nodeType === Node.COMMENT_NODE) return `<!--${node.nodeValue ?? ''}-->`;
  return '';
}

function marked(node: Node): node is Element {
  return node.nodeType === Node.ELEMENT_NODE && MARKED.has((node as Element).getAttribute('data-block') ?? '');
}

/**
 * A saved body as blocks. Marked elements become their blocks; whatever lies
 * between them becomes an HTML block. A body with no marks at all is one HTML
 * block holding the body exactly as it was, so opening and saving an old
 * campaign changes nothing in it.
 */
export function parseBlocks(html: string): Block[] {
  if (html.trim() === '') return [];

  const nodes = Array.from(parse(html).body.childNodes);

  if (!nodes.some(marked)) return [{ id: newId(), type: 'html', html }];

  const out: Block[] = [];
  let loose = '';
  const flush = () => {
    if (loose.trim() !== '') out.push({ id: newId(), type: 'html', html: loose });
    loose = '';
  };

  for (const node of nodes) {
    const b = marked(node) ? fromMarked(node) : null;
    const rule = b && marked(node) ? ruleOf(node) : undefined;

    if (b && rule) b.rule = rule;

    if (b) {
      flush();
      out.push(b);
    } else if (marked(node) && node.getAttribute('data-block') === 'html') {
      /* An HTML block somebody wrapped by hand: its inside is the markup. */
      flush();
      out.push({ id: newId(), type: 'html', html: node.innerHTML });
    } else {
      loose += outer(node);
    }
  }

  flush();
  return out;
}

/* ------------------------------------------------------------------ *
 * Turning plain HTML into blocks, when the writer asks
 * ------------------------------------------------------------------ */

const TEXTY = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'ul', 'ol', 'blockquote', 'a', 'strong', 'b', 'em', 'i', 'u', 's', 'span', 'br', 'small', 'sub', 'sup']);

/** True when an element holds nothing but one picture (and the link around it). */
function onlyImage(el: Element): boolean {
  return el.querySelectorAll('img').length === 1 && (el.textContent ?? '').trim() === '' && !el.querySelector('table');
}

/** The button the starters and the old editor wrote: a table holding one link and nothing else. */
function asButton(el: Element): Block | null {
  if (el.tagName.toLowerCase() !== 'table' || el.querySelector('img')) return null;
  const links = el.querySelectorAll('a');
  if (links.length !== 1 || (el.textContent ?? '').trim() !== (links[0]!.textContent ?? '').trim()) return null;
  const td = links[0]!.closest('td');
  const bg = /background(?:-color)?\s*:\s*([^;]+)/i.exec(td?.getAttribute('style') ?? '')?.[1] ?? td?.getAttribute('bgcolor') ?? '';
  return bg ? { id: newId(), type: 'button', label: (links[0]!.textContent ?? '').trim(), href: links[0]!.getAttribute('href') ?? '', color: safeColor(bg) } : null;
}

/**
 * Plain HTML as blocks, as near as they go: paragraphs and headings run
 * together into text blocks, a rule into a divider, a lone picture into an
 * image, a one-link table into a button. Anything else stays an HTML block,
 * as it was.
 */
export function convertHtml(html: string): Block[] {
  const out: Block[] = [];
  let text = '';
  const flush = () => {
    const clean = sanitizeText(text);
    if (plainText(clean) !== '') out.push({ id: newId(), type: 'text', html: clean });
    text = '';
  };

  for (const node of Array.from(parse(html).body.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      text += escText(node.nodeValue ?? '');
      continue;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) continue;

    const el = node as Element;
    const tag = el.tagName.toLowerCase();
    const button = asButton(el);

    if (MARKED.has(el.getAttribute('data-block') ?? '')) {
      flush();
      out.push(...parseBlocks(el.outerHTML));
    } else if (tag === 'hr') {
      flush();
      out.push({ id: newId(), type: 'divider', spacing: 16 });
    } else if (tag === 'img' || onlyImage(el)) {
      flush();
      const w = Number(el.getAttribute('width'));
      const img = tag === 'img'
        ? { src: el.getAttribute('src') ?? '', alt: el.getAttribute('alt') ?? '', href: '', width: !w || w >= CONTENT_WIDTH ? null : w }
        : imageOf(el);
      out.push({ id: newId(), type: 'image', src: img?.src ?? '', alt: img?.alt ?? '', href: img?.href ?? '', width: img?.width ?? null });
    } else if (button) {
      flush();
      out.push(button);
    } else if (TEXTY.has(tag) || (tag === 'div' && !el.querySelector('table, img, hr'))) {
      text += el.outerHTML;
    } else {
      flush();
      out.push({ id: newId(), type: 'html', html: el.outerHTML });
    }
  }

  flush();
  return out;
}

/* ================================================================== *
 * This client only: showing an HTML block inside the app, and the
 * checks the editor makes while the email is written.
 * ================================================================== */

/** Removed with everything inside them (EmailHtml::DROP). */
const DROP = ['script', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'form', 'input', 'button', 'textarea', 'select', 'option', 'base', 'meta', 'link', 'noscript', 'template', 'svg', 'math'];
const URL_ATTRS = new Set(['href', 'src', 'background', 'action', 'formaction', 'poster', 'xlink:href', 'srcset', 'lowsrc', 'dynsrc']);

/** An address that would run something, or load something other than a picture (EmailHtml::dangerousUrl). */
export function dangerousUrl(url: string): boolean {
  // eslint-disable-next-line no-control-regex
  const u = url.replace(/[\u0000-\u0020\u007f]+/g, '').toLowerCase();
  return u.startsWith('javascript:') || u.startsWith('vbscript:') || u.startsWith('livescript:') || (u.startsWith('data:') && !/^data:image\/(png|gif|jpe?g|webp);/.test(u));
}

/** Any HTML as the server would keep it (EmailHtml::clean): nothing that runs, nothing that loads anything but a picture. */
export function cleanHtml(html: string): string {
  if (!html.trim()) return '';
  const b = parse(html).body;
  for (const tag of DROP) b.querySelectorAll(tag).forEach((e) => e.remove());
  b.querySelectorAll('*').forEach((el) => {
    for (const a of Array.from(el.attributes)) {
      const name = a.name.toLowerCase();
      if (name.startsWith('on') || name === 'srcdoc' || name === 'formaction' || (URL_ATTRS.has(name) && dangerousUrl(a.value)) || (name === 'style' && /expression\s*\(|javascript:|vbscript:|behavior\s*:|-moz-binding/i.test(a.value))) {
        el.removeAttribute(a.name);
      }
    }
  });
  return b.innerHTML;
}

/** An HTML block as it can be shown inside the app: cleaned, and without the email's own style sheet, which would restyle WorkSuite. */
export function displayHtml(html: string): string {
  if (!html.trim()) return '';
  const b = parse(cleanHtml(html)).body;
  b.querySelectorAll('style,title').forEach((e) => e.remove());
  return b.innerHTML;
}

/** `{{ tag }}` or `{{ tag | default:"text" }}`, straight or curly quotes (Personalize::PATTERN). */
const TAG = /\{\{\s*([a-z_]+(?:\.[a-z_]+)?)\s*(?:\|\s*default\s*:\s*["\u201C\u201D]([^"\u201C\u201D]*)["\u201C\u201D]\s*)?\}\}/giu;

/** An editor's spelling of a tag, straightened as the server does: an encoded quote or a hard space is still the tag meant. */
const normal = (text: string) =>
  text.replace(/\{\{[\s\S]*?\}\}/g, (m) => m.replace(/&nbsp;|\u00a0/g, ' ').replace(/&quot;|&#34;/g, '"').replace(/&ldquo;/g, '\u201C').replace(/&rdquo;/g, '\u201D'));

/** The tags used, each with whether every use of it has a fallback (Personalize::used). */
export function tagsUsed(...texts: string[]): Map<string, boolean> {
  const out = new Map<string, boolean>();
  for (const text of texts) {
    for (const m of normal(text).matchAll(TAG)) {
      const tag = m[1]!.toLowerCase();
      out.set(tag, (out.get(tag) ?? true) && !!m[2]);
    }
  }
  return out;
}

/** The tags used that are not on the server's list: the check refuses to send while there are any. */
export function unknownTags(known: string[], ...texts: string[]): string[] {
  const list = new Set(known);
  return [...tagsUsed(...texts).keys()].filter((t) => !list.has(t) && t !== '__token');
}

/** How a tag is written: `{{city}}`, or `{{first_name | default:"there"}}` with a fallback. */
export function tagText(tag: string, fallback = ''): string {
  const f = fallback.replace(/["\u201C\u201D<>]/g, '').trim();
  return f ? `{{${tag} | default:"${f}"}}` : `{{${tag}}}`;
}

/** Pictures with no alt text: what a screen reader cannot say, and what shows while pictures are off. */
export function imagesWithoutAlt(blocks: Block[]): number {
  let n = 0;
  for (const b of blocks) {
    if (b.type === 'image') n += safeUrl(b.src) && !b.alt.trim() ? 1 : 0;
    else if (b.type === 'columns') n += b.columns.filter((c) => c.kind === 'image' && safeUrl(c.src) && !c.alt.trim()).length;
    else if (b.type === 'html' && /<img\b/i.test(b.html)) n += Array.from(parse(b.html).body.querySelectorAll('img')).filter((i) => !(i.getAttribute('alt') ?? '').trim()).length;
  }
  return n;
}

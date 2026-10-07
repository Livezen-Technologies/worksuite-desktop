/**
 * The body made comfortable to read (worksuite-desktop#287), after it was sanitised and before it goes into the
 * sandboxed frame: plain text laid out as paragraphs in the app's font, with its web addresses, email addresses and
 * phone numbers made into links; quoted replies folded behind "⋯ Show quoted text" and a long signature faded into
 * "Show more" — both plain <details>, which open and close with no script in the frame; and pictures that open in the
 * image viewer. Every link made here is a safe link, exactly as sanitize.ts makes the sender's own: the window checks
 * it when it is clicked. Nothing here ever adds a script, an event handler or a remote address.
 */
import { safeLinkHref } from '@shared/mail-files';
import { toE164 } from '../../core/phone';
import { text } from '../../core/i18n';
import { escapeHtml } from './sanitize';

// ── links in words ────────────────────────────────────────────────────────────────────────────────────────

export type LinkPart = { kind: 'text'; text: string } | { kind: 'url' | 'email' | 'phone'; text: string; href: string };

/** A web address, an email address, or a run of digits that may be a phone number — the leftmost wins. */
const CANDIDATES = /(?<url>\b(?:https?:\/\/|www\.)[^\s<>"'`]+)|(?<email>\b[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,24}\b)|(?<phone>(?<![\w+@/.:#=-])(?:\+|\()?\d[\d ().-]{6,22}\d(?![\w@]))/g;

/** Said just before a number that is a phone: "Tel:", "Mobile No.", "Call us on". */
const PHONE_CUE = /\b(?:tel|telephone|phone|mobile|mob|call|cell|hotline|whatsapp)\b[^\n]{0,10}$/i;
/** Said just before a number that is not: an account, a reference, an order. */
const NOT_PHONE_CUE = /(?:a\/c|\bacc(?:oun)?t|\bacct|\bref(?:erence)?|\border|\binvoice|\binv|\btxn|\btransaction|\bid|\bno|\bnumber|#)[^\w\n]{0,4}$/i;

/** A web address ends before the full stop, comma or bracket that follows it in a sentence. */
function trimUrl(raw: string): string {
  let url = raw.replace(/[.,;:!?'"*_]+$/, '');
  // A closing bracket belongs to the address only when it opened one.
  while (/[)\]}>]$/.test(url)) {
    const close = url.slice(-1);
    const open = close === ')' ? '(' : close === ']' ? '[' : close === '}' ? '{' : '<';
    if (url.split(open).length >= url.split(close).length) break;
    url = url.slice(0, -1).replace(/[.,;:!?'"]+$/, '');
  }
  return url;
}

/**
 * A phone number as a tel: address in E.164 (core/phone.ts), or null: nine to fifteen digits, written as a phone is
 * (a + or 00, a leading 0 or a bracket) or said to be one ("Tel: …"), and a number libphonenumber can dial — never a
 * date, an amount, an IP address or an account number.
 */
export function phoneHref(raw: string, before = ''): string | null {
  const s = raw.trim();
  const digits = s.replace(/\D/g, '');
  if (digits.length < 9 || digits.length > 15) return null;
  if (/^\d{4}[-./]\d{1,2}[-./]\d{1,2}\b/.test(s) || /^\d{1,2}[-./]\d{1,2}[-./]\d{2,4}$/.test(s)) return null;
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(s)) return null;
  const tail = before.slice(-24);
  const cued = PHONE_CUE.test(tail);
  if (!cued && NOT_PHONE_CUE.test(tail)) return null;
  if (!cued && !/^(?:\+|00|0|\()/.test(s)) return null;
  const e164 = toE164(s);
  return e164 ? `tel:${e164}` : null;
}

/** Words cut into text and links: web addresses, email addresses and phone numbers. */
export function linkParts(input: string): LinkPart[] {
  const out: LinkPart[] = [];
  let at = 0;
  const push = (t: string) => {
    if (!t) return;
    const last = out[out.length - 1];
    if (last?.kind === 'text') last.text += t;
    else out.push({ kind: 'text', text: t });
  };
  for (const m of input.matchAll(CANDIDATES)) {
    const start = m.index ?? 0;
    if (start < at) continue;
    const g = m.groups ?? {};
    let part: LinkPart | null = null;
    if (g.url) {
      const url = trimUrl(g.url);
      if (url.length > 7) part = { kind: 'url', text: url, href: /^www\./i.test(url) ? `https://${url}` : url };
    } else if (g.email) part = { kind: 'email', text: g.email, href: `mailto:${g.email}` };
    else if (g.phone) {
      const href = phoneHref(g.phone, input.slice(Math.max(0, start - 24), start));
      if (href) part = { kind: 'phone', text: g.phone.trim(), href };
    }
    if (!part) continue;
    push(input.slice(at, start));
    out.push(part);
    at = start + part.text.length;
  }
  push(input.slice(at));
  return out;
}

/** What a link made here carries: the safe link, the real address for hovering, and a new window like any other. */
function linkAttrs(href: string, label: string): Array<[string, string]> {
  return [
    ['href', safeLinkHref(href, label)],
    ['title', href.slice(0, 500)],
    ['target', '_blank'],
    ['rel', 'noopener noreferrer'],
    ['class', 'ws-auto'],
  ];
}

/** Plain words as HTML, escaped, with their links. */
export function linkifyText(input: string): string {
  return linkParts(input)
    .map((p) => (p.kind === 'text' ? escapeHtml(p.text) : `<a ${linkAttrs(p.href, p.text).map(([k, v]) => `${k}="${escapeHtml(v)}"`).join(' ')}>${escapeHtml(p.text)}</a>`))
    .join('');
}

/** Links in an HTML body's words, never inside a link, a style or a heading of our own that is already there. */
export function linkifyNodes(root: Element): void {
  const doc = root.ownerDocument;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (/[@.\d]/.test(n.nodeValue ?? '') && !n.parentElement?.closest('a, style, title, summary')) nodes.push(n as Text);
  }
  for (const node of nodes) {
    const parts = linkParts(node.nodeValue ?? '');
    if (!parts.some((p) => p.kind !== 'text')) continue;
    const frag = doc.createDocumentFragment();
    for (const p of parts) {
      if (p.kind === 'text') {
        frag.append(p.text);
        continue;
      }
      const a = doc.createElement('a');
      for (const [k, v] of linkAttrs(p.href, p.text)) a.setAttribute(k, v);
      a.textContent = p.text;
      frag.append(a);
    }
    node.replaceWith(frag);
  }
}

// ── folding ───────────────────────────────────────────────────────────────────────────────────────────────

/** "⋯ Show quoted text" over the quoted reply; open, it says Hide quoted text. Static words, escaped. */
function quoteDetails(inner: string): string {
  return `<details class="ws-quote"><summary><span class="ws-closed"><span aria-hidden="true">⋯ </span>${escapeHtml(text('Show quoted text'))}</span><span class="ws-opened">${escapeHtml(text('Hide quoted text'))}</span></summary>${inner}</details>`;
}

/** A long signature, its first lines fading into "Show more". */
function signatureDetails(inner: string): string {
  return `<details class="ws-sig"><summary><span class="ws-closed">${escapeHtml(text('Show more'))}</span><span class="ws-opened">${escapeHtml(text('Show less'))}</span></summary><div class="ws-sig-body">${inner}</div></details>`;
}

/** "On Mon, 5 Oct 2026 at 10:02, Nimal <nimal@sfcl.lk> wrote:" — Gmail's, Apple Mail's and WorkSuite's own. */
const ATTRIBUTION = /^\s*(?:On\b.{4,240}\bwrote:|.{4,160}\b(?:wrote|writes):)\s*$/i;
/** Outlook's plain-text reply header, and the rule some programs draw over it. */
const OUTLOOK_HEADER = /^\s*(?:-{3,}\s*Original Message\s*-{3,}|_{10,})\s*$/i;
const FORWARDED = /^\s*(?:-{3,}\s*Forwarded message\s*-{3,}|Begin forwarded message:)/i;

const quoted = (line: string) => /^\s*>/.test(line);
const blank = (line: string) => line.trim() === '';

/** A signature folds when it runs past five lines or 320 characters. */
export function isLongSignature(lines: string[] | string): boolean {
  const all = (Array.isArray(lines) ? lines.join('\n') : lines).replace(/[ \t\u00a0]+/g, ' ').replace(/\n\s*\n/g, '\n').trim();
  return all.split('\n').length > 5 || all.length > 320;
}

// ── plain text ────────────────────────────────────────────────────────────────────────────────────────────

export interface PlainParts {
  /** The words, up to the signature or the quoted reply. */
  body: string[];
  /** The signature under its "-- " line, without the line. */
  signature: string[];
  /** The quoted reply at the end, with its "On … wrote:" or Outlook header. */
  quote: string[];
}

/**
 * Where a plain-text email's own words end: the signature starts at a "-- " line; the quoted reply at an
 * "On … wrote:" line followed by "> " lines, at Outlook's "-----Original Message-----" or From:/Sent:/To: block, or
 * at the last run of "> " lines that nothing but blank lines follows. A forwarded message is never folded away, and
 * neither is a quote with nothing of the sender's own above it.
 */
export function splitPlain(textBody: string): PlainParts {
  const lines = textBody.replace(/\r\n?/g, '\n').split('\n');
  const nextWords = (from: number) => lines.slice(from, from + 3).find((l) => !blank(l)) ?? '';
  let quoteAt = -1;
  let forwarded = false;
  for (let i = 0; i < lines.length && quoteAt < 0; i++) {
    const line = lines[i]!;
    if (FORWARDED.test(line)) {
      forwarded = true;
      break;
    }
    if (ATTRIBUTION.test(line) && quoted(nextWords(i + 1))) quoteAt = i;
    // Gmail wraps a long attribution: "On …, Name <a@b>" and "wrote:" on the next line.
    else if (/^\s*On\b/i.test(line) && /^.{0,80}\bwrote:\s*$/i.test(lines[i + 1] ?? '') && quoted(nextWords(i + 2))) quoteAt = i;
    else if (OUTLOOK_HEADER.test(line) && /^\s*From:/i.test(nextWords(i + 1))) quoteAt = i;
    else if (i > 0 && /^\s*From:\s*\S/i.test(line) && /^\s*(Sent|Date):\s*\S/i.test(lines[i + 1] ?? '') && /^\s*(To|Subject):\s*\S/i.test(lines[i + 2] ?? '')) quoteAt = i;
  }
  if (quoteAt < 0 && !forwarded) {
    // The last run of quoted lines, with nothing after it but blank lines: the reply above, the quote below.
    let end = lines.length - 1;
    while (end >= 0 && blank(lines[end]!)) end--;
    let start = end;
    while (start >= 0 && (quoted(lines[start]!) || (blank(lines[start]!) && start > 0 && quoted(lines[start - 1]!)))) start--;
    if (end >= 0 && quoted(lines[end]!) && end - start >= 2) quoteAt = start + 1;
  }
  if (quoteAt >= 0 && !lines.slice(0, quoteAt).some((l) => !blank(l))) quoteAt = -1;
  const own = quoteAt >= 0 ? lines.slice(0, quoteAt) : lines;
  const sigAt = own.findIndex((l, i) => i > 0 && /^--\s?$/.test(l));
  const trimEnd = (xs: string[]) => {
    const ys = [...xs];
    while (ys.length && blank(ys[ys.length - 1]!)) ys.pop();
    while (ys.length && blank(ys[0]!)) ys.shift();
    return ys;
  };
  return { body: trimEnd(sigAt >= 0 ? own.slice(0, sigAt) : own), signature: trimEnd(sigAt >= 0 ? own.slice(sigAt + 1) : []), quote: trimEnd(quoteAt >= 0 ? lines.slice(quoteAt) : []) };
}

/** Lines as paragraphs: blank lines part them, and a paragraph keeps the sender's own line breaks. */
function paragraphs(lines: string[]): string {
  const out: string[] = [];
  let block: string[] = [];
  const flush = () => {
    if (block.length) out.push(`<div style="white-space:pre-wrap">${linkifyText(block.join('\n'))}</div>`);
    block = [];
  };
  for (let i = 0; i < lines.length; ) {
    if (quoted(lines[i]!)) {
      // A short quote between the answers of an inline reply stays in place, drawn as a quote.
      flush();
      const run: string[] = [];
      while (i < lines.length && quoted(lines[i]!)) run.push(lines[i++]!.replace(/^\s*> ?/, ''));
      out.push(`<blockquote class="ws-q">${paragraphs(run)}</blockquote>`);
      continue;
    }
    if (blank(lines[i]!)) flush();
    else block.push(lines[i]!);
    i++;
  }
  flush();
  return out.join('');
}

/**
 * A plain-text email as HTML for the frame: paragraphs with their links, the quoted reply folded behind
 * "⋯ Show quoted text" and a long signature fading into "Show more". Every word is escaped; the only markup is this
 * function's own.
 */
export function renderPlainText(textBody: string): string {
  const { body, signature, quote } = splitPlain(textBody);
  let html = paragraphs(body);
  if (signature.length) {
    const sig = `<div class="ws-sig-line" aria-hidden="true">--</div>${paragraphs(signature)}`;
    html += isLongSignature(signature) ? signatureDetails(sig) : `<div class="ws-sig-short">${sig}</div>`;
  }
  if (quote.length) {
    // "On … wrote:" above "> " lines: the attribution, then the lines without their first ">". Outlook's header and
    // the original under it have no ">": they show as they are, folded.
    const firstQuoted = quote.findIndex(quoted);
    const attributed = firstQuoted > 0 && !OUTLOOK_HEADER.test(quote[0]!) && !/^\s*From:/i.test(quote[0]!) && quote.slice(firstQuoted).every((l) => quoted(l) || blank(l));
    const inner = attributed
      ? `<div class="ws-attr" style="white-space:pre-wrap">${linkifyText(quote.slice(0, firstQuoted).join('\n').trim())}</div><blockquote class="ws-q">${paragraphs(quote.slice(firstQuoted).map((l) => l.replace(/^\s*> ?/, '')))}</blockquote>`
      : firstQuoted === 0
        ? `<blockquote class="ws-q">${paragraphs(quote.map((l) => l.replace(/^\s*> ?/, '')))}</blockquote>`
        : paragraphs(quote);
    html += quoteDetails(inner);
  }
  return `<div class="ws-plain">${html}</div>`;
}

/**
 * The words of a plain-text body as the server sent it — text and line breaks, perhaps in one <pre> or <div>, perhaps
 * with its addresses already made links — or null when it is HTML with structure of its own (paragraphs, tables,
 * styles, pictures), which keeps its markup.
 */
export function plainBodyText(html: string): string | null {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const kids = [...doc.body.children];
  // One wrapper at most: <pre>…</pre> or <div style="white-space:pre-wrap">…</div>, and nothing beside it.
  const only = kids.length === 1 && /^(PRE|DIV)$/.test(kids[0]!.tagName) && [...doc.body.childNodes].every((n) => n === kids[0] || blank(n.textContent ?? ''));
  const root = only ? kids[0]! : doc.body;
  for (const attr of only ? [...root.attributes] : []) {
    if (attr.name === 'dir') continue;
    if (attr.name === 'style' && /^\s*white-space\s*:\s*pre(?:-wrap|-line)?\s*;?\s*$/i.test(attr.value)) continue;
    return null;
  }
  for (const el of root.querySelectorAll('*')) {
    if (el.tagName === 'BR' || el.tagName === 'WBR') continue;
    // A link the server made of an address in the words: the words are the address.
    if (el.tagName === 'A' && !el.children.length) {
      const shown = (el.textContent ?? '').trim();
      const real = (el.getAttribute('title') ?? '').replace(/^(mailto|tel):/i, '');
      if (shown && (shown === real || `https://${shown}` === real || `http://${shown}` === real)) continue;
    }
    return null;
  }
  if (blank(root.textContent ?? '')) return null;
  // Outside <pre>, a line break in the source is a space, as the browser draws it: "line<br />\nline" is two lines.
  const pre = root.tagName === 'PRE' || /white-space\s*:\s*pre/i.test(root.getAttribute('style') ?? '');
  if (!pre) {
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) n.nodeValue = (n.nodeValue ?? '').replace(/[ \t]*\r?\n[ \t]*/g, ' ');
  }
  root.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));
  const words = (root.textContent ?? '').replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '');
  return pre ? words : words.replace(/^ +/gm, '');
}

// ── quoted replies and signatures in HTML ─────────────────────────────────────────────────────────────────

const meaningful = (s: string | null | undefined) => (s ?? '').replace(/[\s\u00a0\u200b]+/g, '') !== '';

/** Does anything before `node` in `root` say something (words or a picture)? */
function saysSomethingBefore(root: Element, node: Node): boolean {
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n === node || node.contains(n)) return false;
    if (n.nodeType === Node.TEXT_NODE && meaningful(n.nodeValue) && !n.parentElement?.closest('style')) return true;
    if (n instanceof Element && n.tagName === 'IMG') return true;
  }
  return false;
}

/** The node and every sibling after it. */
function andAfter(start: Node): Node[] {
  const out: Node[] = [];
  for (let n: Node | null = start; n; n = n.nextSibling) out.push(n);
  return out;
}

/** `from` and its following siblings up to and including `to`. */
function fromTo(from: Element, to: Element): Node[] {
  const out: Node[] = [from];
  for (let n = from.nextSibling; n; n = n.nextSibling) {
    out.push(n);
    if (n === to) break;
  }
  return out;
}

/** Not inside a quote or a fold already. */
const topLevel = (el: Element) => !el.parentElement?.closest('blockquote, .gmail_quote, .yahoo_quoted, details');

/** Where a reply's quoted email starts in HTML, and the nodes it takes, by the marks each mail program leaves. */
export function findHtmlQuote(root: Element): Node[] | null {
  const first = (sel: string) => [...root.querySelectorAll(sel)].find(topLevel) ?? null;
  // Gmail and Yahoo: the quote is one block of its own.
  const block = first('div.gmail_quote_container, div.gmail_quote, div.yahoo_quoted');
  if (block) return [block];
  // Outlook on the web: the reply ends at #appendonsend, or the rule over #divRplyFwdMsg; the rest is the original.
  const owa = first('#appendonsend, #divRplyFwdMsg');
  if (owa) return andAfter(owa.id === 'divRplyFwdMsg' && owa.previousElementSibling?.tagName === 'HR' ? owa.previousElementSibling : owa);
  // Outlook for Windows: a block ruled along its top with "From:" in it, then the original in the same section.
  const outlook = [...root.querySelectorAll('div[style]')].find((el) => topLevel(el) && /border-top\s*:\s*solid/i.test(el.getAttribute('style') ?? '') && /^\s*From:/i.test(el.textContent ?? ''));
  if (outlook) return andAfter(outlook);
  // Apple Mail, Thunderbird and WorkSuite: a blockquote with the attribution line just above it.
  const cite = first('blockquote[type="cite" i]') ?? [...root.querySelectorAll('blockquote')].find((bq) => topLevel(bq) && ATTRIBUTION.test(bq.previousElementSibling?.textContent ?? ''));
  if (cite) {
    const prev = cite.previousElementSibling;
    return prev && (prev.classList.contains('moz-cite-prefix') || ATTRIBUTION.test(prev.textContent ?? '')) ? fromTo(prev, cite) : [cite];
  }
  // Outlook's plain header kept in HTML: "-----Original Message-----".
  const original = [...root.querySelectorAll('p, div')].find((el) => topLevel(el) && !el.children.length && OUTLOOK_HEADER.test(el.textContent ?? ''));
  return original ? andAfter(original) : null;
}

/** A signature in HTML: Gmail's, Thunderbird's, Outlook's, or WorkSuite's own under its "-- " line. */
export function findHtmlSignature(root: Element): Node[] | null {
  const marked = [...root.querySelectorAll('.gmail_signature, [data-smartmail="gmail_signature"], .moz-signature, #Signature, #signature')].find((el) => !el.parentElement?.closest('.gmail_signature, .moz-signature, details, blockquote'));
  if (marked) return [marked];
  // WorkSuite's composer writes "-- " as a block of its own over the signature (composeHtml.splitSignature).
  const kids = [...root.childNodes];
  const at = kids.findIndex((n) => n instanceof Element && (n.textContent ?? '').replace(/\u00a0/g, ' ').trim() === '--' && !n.querySelector('li, img'));
  if (at <= 0) return null;
  const out: Node[] = [];
  for (const n of kids.slice(at)) {
    if (n instanceof Element && (n.matches('details') || n.tagName === 'BLOCKQUOTE' || ATTRIBUTION.test(n.textContent ?? ''))) break;
    out.push(n);
  }
  return out;
}

/** Nodes' words with their line breaks, to measure a signature. */
function linesOf(nodes: Node[]): string {
  const box = nodes[0]!.ownerDocument!.createElement('div');
  for (const n of nodes) box.append(n.cloneNode(true));
  box.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));
  box.querySelectorAll('p, div, li, tr, h1, h2, h3, h4, h5, h6').forEach((el) => el.append('\n'));
  return box.textContent ?? '';
}

/** Moves the nodes, as they are, into a fold of our own static markup — the sender's part is never parsed again. */
function fold(nodes: Node[], html: (inner: string) => string): void {
  const first = nodes[0];
  if (!first?.parentNode) return;
  const doc = first.ownerDocument!;
  const tpl = doc.createElement('template');
  tpl.innerHTML = html('<div data-ws-slot></div>');
  const slot = tpl.content.querySelector('[data-ws-slot]');
  if (!slot) return;
  first.parentNode.insertBefore(tpl.content, first);
  slot.replaceWith(...nodes);
}

/**
 * An HTML body made easier to read: the addresses in its words made links (when it is words, not a designed email),
 * the quoted email of a reply folded behind "⋯ Show quoted text" (never a forwarded message, and never when it is all
 * there is), and a long signature fading into "Show more".
 */
export function structureHtml(html: string, opts: { linkify?: boolean } = {}): string {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const root = doc.body;
  if (opts.linkify) linkifyNodes(root);
  const quote = findHtmlQuote(root);
  if (quote?.length && saysSomethingBefore(root, quote[0]!) && !FORWARDED.test(linesOf(quote).trimStart().slice(0, 200))) fold(quote, quoteDetails);
  const sig = findHtmlSignature(root);
  if (sig?.length && saysSomethingBefore(root, sig[0]!) && isLongSignature(linesOf(sig))) fold(sig, signatureDetails);
  return root.innerHTML;
}

// ── pictures that open in the viewer ──────────────────────────────────────────────────────────────────────

/** What a picture link carries in place of a web address: which reader's frame, which picture. */
export const IMAGE_LINK = 'ws-mail-image:';

/** A picture the viewer may show: a bitmap in the message or the local store, or one through WorkSuite's proxy. */
export function viewableSrc(src: string, origin: string): boolean {
  if (/^data:image\/(png|jpe?g|gif|webp|bmp|avif);base64,[a-z0-9+/=\s]+$/i.test(src)) return true;
  return !!origin && src.startsWith(`${origin}/mail-image?`);
}

export interface FramedPicture {
  src: string;
  alt: string;
}

/**
 * Pictures shown in the body — not placeholders, not icons, not a picture that is already a link — as links that open
 * the image viewer: `ws-mail-image:<frame>/<n>` through the same safe link as any other, so the window hands it to
 * this reader rather than to the browser.
 */
export function linkPictures(html: string, frame: string, origin: string): { html: string; pictures: FramedPicture[] } {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const pictures: FramedPicture[] = [];
  doc.body.querySelectorAll('img').forEach((img) => {
    if (img.hasAttribute('data-ws-ph') || img.closest('a') || pictures.length >= 60) return;
    const src = img.getAttribute('src') ?? '';
    if (!viewableSrc(src, origin)) return;
    const w = Number(img.getAttribute('width')) || 0;
    const h = Number(img.getAttribute('height')) || 0;
    if ((w && w < 48) || (h && h < 48)) return;
    const alt = (img.getAttribute('alt') || img.getAttribute('title') || '').slice(0, 200);
    const a = doc.createElement('a');
    a.setAttribute('href', safeLinkHref(`${IMAGE_LINK}${frame}/${pictures.length}`, alt));
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noopener noreferrer');
    a.setAttribute('class', 'ws-img');
    a.setAttribute('title', text('Open picture'));
    img.replaceWith(a);
    a.append(img);
    pictures.push({ src, alt });
  });
  return { html: doc.body.innerHTML, pictures };
}

/** The frame and picture a picture link names, or null for any other address. */
export function parsePictureLink(url: string): { frame: string; index: number } | null {
  const m = /^ws-mail-image:([a-z0-9]{4,24})\/(\d{1,3})$/i.exec(url);
  return m ? { frame: m[1]!, index: Number(m[2]) } : null;
}

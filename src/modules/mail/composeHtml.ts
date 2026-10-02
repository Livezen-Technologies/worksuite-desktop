import { splitQuote } from './quote';

/**
 * The composer's HTML: what the person wrote, cleaned to a small allow-list
 * before it is saved as a draft or sent, plus the plain-text alternative that
 * goes with it, the quoted email below it, the signature inside it, and old
 * plain-text drafts brought forward.
 *
 * The allow-list is formatting only — no scripts, no styles but colour,
 * highlight, alignment, decoration and a table's borders and padding, no
 * event handlers, and links only to
 * http(s) and mailto. Pictures do not go inline (the send path has no
 * multipart/related part): pasted ones become attachments instead.
 */

const KEEP = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'DEL', 'P', 'DIV', 'BR', 'SPAN', 'UL', 'OL', 'LI', 'A', 'BLOCKQUOTE', 'H1', 'H2', 'H3', 'H4', 'PRE', 'CODE', 'HR', 'SUB', 'SUP', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TD', 'TH']);
/** Removed with what is inside them: their content is not the message's words. */
const DROP = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'FRAME', 'FRAMESET', 'OBJECT', 'EMBED', 'APPLET', 'TEMPLATE', 'NOSCRIPT', 'SVG', 'MATH', 'LINK', 'META', 'BASE', 'FORM', 'INPUT', 'BUTTON', 'TEXTAREA', 'SELECT', 'OPTION', 'IMG', 'PICTURE', 'VIDEO', 'AUDIO', 'SOURCE', 'TITLE', 'HEAD']);
const STYLES = new Set(['color', 'background-color', 'text-align', 'text-decoration', 'text-decoration-line', 'font-weight', 'font-style', 'border', 'border-collapse', 'padding', 'vertical-align', 'width']);

export function safeHref(href: string): string | null {
  const h = href.trim();
  return /^(https?:\/\/[^\s<>"]+|mailto:[^\s<>"]+)$/i.test(h) ? h : null;
}

function safeStyle(style: string): string {
  return style
    .split(';')
    .map((d) => {
      const i = d.indexOf(':');
      return i < 0 ? ['', ''] : [d.slice(0, i).trim().toLowerCase(), d.slice(i + 1).trim()];
    })
    .filter(([k, v]) => k && v && STYLES.has(k) && /^[#(),.%\w\s-]+$/.test(v) && !/url|expression|javascript|var\(/i.test(v))
    .map(([k, v]) => `${k}: ${v}`)
    .join('; ');
}

function cleanInto(from: Node, to: Node, doc: Document): void {
  for (const node of [...from.childNodes]) {
    if (node.nodeType === Node.TEXT_NODE) {
      to.appendChild(doc.createTextNode(node.textContent ?? ''));
      continue;
    }
    if (!(node instanceof Element) || DROP.has(node.tagName)) continue;
    if (node.tagName === 'FONT') {
      // The browser's colour command can write <font color>; it leaves as a span with a colour style.
      const colour = node.getAttribute('color') ?? '';
      const style = safeStyle(`color: ${colour}`);
      const span = doc.createElement('span');
      if (style) span.setAttribute('style', style);
      cleanInto(node, style ? span : to, doc);
      if (style) to.appendChild(span);
      continue;
    }
    if (!KEEP.has(node.tagName)) {
      // Unknown markup loses its behaviour and keeps its words.
      cleanInto(node, to, doc);
      continue;
    }
    const el = doc.createElement(node.tagName === 'STRIKE' ? 's' : node.tagName.toLowerCase());
    if (node.tagName === 'A') {
      const href = safeHref(node.getAttribute('href') ?? '');
      if (!href) {
        cleanInto(node, to, doc);
        continue;
      }
      el.setAttribute('href', href);
    }
    const style = safeStyle(node.getAttribute('style') ?? '');
    if (style) el.setAttribute('style', style);
    cleanInto(node, el, doc);
    if (el.tagName === 'SPAN' && !el.attributes.length) {
      while (el.firstChild) to.appendChild(el.firstChild);
      continue;
    }
    to.appendChild(el);
  }
}

/** The composed HTML through the composer's allow-list. */
export function cleanComposeHtml(html: string | null | undefined): string {
  if (!html) return '';
  const doc = new DOMParser().parseFromString(`<!doctype html><body><div>${html}</div></body>`, 'text/html');
  const out = doc.createElement('div');
  cleanInto(doc.body.firstElementChild ?? doc.body, out, doc);
  return out.innerHTML;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Plain text as the editor writes it: a block per line, an empty line as a blank block. */
export function textToComposeHtml(value: string): string {
  const v = value.replace(/\r\n?/g, '\n');
  if (!v.trim()) return '';
  return v
    .split('\n')
    .map((line) => (line ? `<div>${esc(line)}</div>` : '<div><br></div>'))
    .join('');
}

/**
 * The plain-text alternative: a line per block, "- " and "1. " for list
 * items, "> " for quotes, and a link's address after its words when they
 * differ.
 */
export function composeText(html: string): string {
  if (!html.trim()) return '';
  const doc = new DOMParser().parseFromString(`<div>${cleanComposeHtml(html)}</div>`, 'text/html');
  const lines: string[] = [];
  let line = '';
  const flush = (prefix: string) => {
    if (line || lines.length) lines.push(prefix + line.replace(/[ \t]+/g, ' ').trim());
    line = '';
  };
  const walk = (node: Node, prefix: string, depth: number) => {
    for (const c of [...node.childNodes]) {
      if (c.nodeType === Node.TEXT_NODE) {
        line += (c.textContent ?? '').replace(/\n/g, ' ');
        continue;
      }
      if (!(c instanceof Element)) continue;
      const tag = c.tagName;
      if (tag === 'BR') flush(prefix);
      else if (tag === 'A') {
        const inner = (c.textContent ?? '').trim();
        const href = (c.getAttribute('href') ?? '').replace(/^mailto:/i, '');
        line += inner && inner !== href ? `${inner} <${href}>` : href || inner;
      } else if (tag === 'UL' || tag === 'OL') {
        if (line.trim()) flush(prefix);
        [...c.children].forEach((li, i) => {
          line = `${'  '.repeat(depth)}${tag === 'OL' ? `${i + 1}.` : '-'} `;
          walk(li, prefix, depth + 1);
          if (line.trim()) flush(prefix);
        });
      } else if (tag === 'BLOCKQUOTE') {
        if (line.trim()) flush(prefix);
        walk(c, `${prefix}> `, depth);
        if (line.trim()) flush(`${prefix}> `);
      } else if (tag === 'HR') {
        if (line.trim()) flush(prefix);
        line = '----';
        flush(prefix);
      } else if (['DIV', 'P', 'H1', 'H2', 'H3', 'H4', 'PRE', 'LI'].includes(tag)) {
        if (line.trim()) flush(prefix);
        walk(c, prefix, depth);
        // An empty block (<div><br></div>) is a blank line; its <br> already made it.
        if (line.trim() || !c.querySelector('br')) flush(prefix);
        if (tag === 'P') lines.push('');
      } else walk(c, prefix, depth);
    }
  };
  walk(doc.body.firstElementChild ?? doc.body, '', 0);
  if (line.trim()) flush('');
  return lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** The signature's delimiter ("-- "), as a line of its own. */
const isDelimiter = (el: Element) => /^--\s?$/.test((el.textContent ?? '').replace(/\u00a0/g, ' ').trimStart()) && !el.querySelector('li');

/**
 * The person's own words and the signature below them. The signature starts
 * at the first top-level block that is just "-- " — the line the composer
 * writes above it, and the one plain-text drafts always had.
 */
export function splitSignature(html: string): [string, string] {
  if (!html) return ['', ''];
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  const root = doc.body.firstElementChild!;
  const kids = [...root.childNodes];
  const at = kids.findIndex((n) => n instanceof Element && isDelimiter(n));
  if (at < 0) return [html, ''];
  const part = (nodes: ChildNode[]) => {
    const d = doc.createElement('div');
    d.append(...nodes.map((n) => n.cloneNode(true)));
    return d.innerHTML;
  };
  // Blank blocks just above the delimiter belong to the signature's spacing.
  let end = at;
  while (end > 0 && kids[end - 1] instanceof Element && !(kids[end - 1]!.textContent ?? '').trim() && !(kids[end - 1] as Element).querySelector('li')) end--;
  return [part(kids.slice(0, end)), part(kids.slice(end))];
}

export function joinSignature(mine: string, signature: string): string {
  return signature ? `${mine}${signature}` : mine;
}

/** A signature's HTML, cleaned, under the delimiter and two blank lines. */
export function signatureBlock(signatureHtml: string): string {
  const body = cleanComposeHtml(signatureHtml);
  return body.trim() ? `<div><br></div><div><br></div><div>-- </div>${body}` : '';
}

/** The quoted email ("On … wrote:" and "> " lines) as its attribution and its plain lines. */
export function parseQuote(quote: string): { attribution: string; lines: string[] } {
  const all = quote.replace(/\r\n?/g, '\n').replace(/^\s+/, '').split('\n');
  const attribution = all.length && !/^>/.test(all[0]!) ? all.shift()!.trim() : '';
  return { attribution, lines: all.map((l) => l.replace(/^> ?/, '')) };
}

/** The quoted email as the HTML that goes below the message. */
export function quoteToHtml(quote: string): string {
  if (!quote.trim()) return '';
  const { attribution, lines } = parseQuote(quote);
  const body = lines.map((l) => esc(l)).join('<br>');
  return `<div><br></div>${attribution ? `<div>${esc(attribution)}</div>` : ''}<blockquote style="margin: 0 0 0 0.8ex; border-left: 1px solid #cccccc; padding-left: 1ex">${body}</blockquote>`;
}

/** What is sent: the message and the quote, as HTML and as plain text. */
export function composeBody(html: string, quote: string): { html: string; text: string } {
  const own = cleanComposeHtml(html);
  const q = quote.trim() ? quote.replace(/^\s+/, '') : '';
  return {
    html: `${own}${quoteToHtml(q)}`,
    text: [composeText(own), q].filter(Boolean).join('\n\n'),
  };
}

export interface ComposeDraft {
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  /** What the person wrote (and their signature), as cleaned HTML. */
  html: string;
  /** The email being replied to or forwarded, as "> " lines; '' once removed. */
  quote: string;
  from: string;
  attachments?: Array<{ token: string; name: string; size: number; source?: 'computer' | 'drive' }>;
  /** Display names of chosen recipients, by lower-cased address. */
  names?: Record<string, string>;
  signed?: boolean;
  v: 2;
}

/** A draft as this version keeps it — an older plain-text one (`body`, quote included) brought forward. */
export function migrateDraft(raw: unknown, seedQuote = ''): ComposeDraft {
  const d = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const str = (k: string) => (typeof d[k] === 'string' ? (d[k] as string) : '');
  const base = {
    to: str('to'),
    cc: str('cc'),
    bcc: str('bcc'),
    subject: str('subject'),
    from: str('from'),
    attachments: Array.isArray(d.attachments) ? (d.attachments as ComposeDraft['attachments']) : [],
    names: d.names && typeof d.names === 'object' ? Object.fromEntries(Object.entries(d.names as Record<string, unknown>).filter(([, n]) => typeof n === 'string') as Array<[string, string]>) : {},
    signed: !!d.signed,
    v: 2 as const,
  };
  if (typeof d.html === 'string') return { ...base, html: cleanComposeHtml(d.html), quote: typeof d.quote === 'string' ? d.quote : seedQuote };
  const [own, quoted] = splitQuote(str('body'), seedQuote || undefined);
  return { ...base, html: textToComposeHtml(own.replace(/\s+$/, '')), quote: quoted || (str('body') ? '' : seedQuote) };
}

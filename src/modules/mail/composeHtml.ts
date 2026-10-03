import { splitQuote } from './quote';

/**
 * The composer's HTML: what the person wrote, cleaned to a small allow-list
 * before it is saved as a draft or sent, plus the plain-text alternative that
 * goes with it, the quoted email below it, the signature inside it, and old
 * plain-text drafts brought forward.
 *
 * The allow-list is formatting only — no scripts, no styles but the
 * email-safe ones (colour, highlight, fonts and sizes, alignment, spacing,
 * borders, a picture's size and float), no event handlers, links only to
 * http(s) and mailto, and the table attributes Outlook reads (`border`,
 * `cellpadding`, `width`, `bgcolor`…). Pictures stay: embedded ones (a
 * `data:` PNG, JPEG, GIF or WebP, which the server sends as inline `cid:`
 * parts — worksuite-desktop#188), `cid:` ones and remote http(s) ones; any
 * other source drops the picture.
 */

const KEEP = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'DEL', 'P', 'DIV', 'BR', 'SPAN', 'UL', 'OL', 'LI', 'A', 'BLOCKQUOTE', 'H1', 'H2', 'H3', 'H4', 'PRE', 'CODE', 'HR', 'SUB', 'SUP', 'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'TD', 'TH', 'IMG']);
/** Removed with what is inside them: their content is not the message's words. */
const DROP = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'FRAME', 'FRAMESET', 'OBJECT', 'EMBED', 'APPLET', 'TEMPLATE', 'NOSCRIPT', 'SVG', 'MATH', 'LINK', 'META', 'BASE', 'FORM', 'INPUT', 'BUTTON', 'TEXTAREA', 'SELECT', 'OPTION', 'PICTURE', 'VIDEO', 'AUDIO', 'SOURCE', 'TITLE', 'HEAD']);
const STYLES = new Set([
  'color', 'background-color', 'text-align', 'text-decoration', 'text-decoration-line', 'font-weight', 'font-style', 'font-family', 'font-size', 'line-height',
  'border', 'border-top', 'border-right', 'border-bottom', 'border-left', 'border-color', 'border-style', 'border-width', 'border-radius', 'border-collapse',
  'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'vertical-align', 'width', 'max-width', 'height', 'float', 'display', 'list-style-type', 'white-space',
]);
/** Attributes kept by element, each with the values it may have (everything else is removed). */
const NUM = /^\d{1,4}(%|px)?$/;
const ATTRS: Record<string, Record<string, RegExp>> = {
  IMG: { alt: /^[^<>]{0,300}$/, title: /^[^<>]{0,300}$/, width: NUM, height: NUM, align: /^(left|right|middle|top|bottom)$/i, border: /^\d{1,2}$/ },
  TABLE: { border: /^\d{1,2}$/, cellpadding: /^\d{1,2}$/, cellspacing: /^\d{1,2}$/, width: NUM, align: /^(left|right|center)$/i, bgcolor: /^#[0-9a-f]{3,8}$/i },
  TR: { align: /^(left|right|center)$/i, valign: /^(top|middle|bottom|baseline)$/i, bgcolor: /^#[0-9a-f]{3,8}$/i },
  TD: { colspan: /^\d{1,3}$/, rowspan: /^\d{1,3}$/, width: NUM, height: NUM, align: /^(left|right|center|justify)$/i, valign: /^(top|middle|bottom|baseline)$/i, bgcolor: /^#[0-9a-f]{3,8}$/i },
  P: { align: /^(left|right|center|justify)$/i },
  DIV: { align: /^(left|right|center|justify)$/i },
};
ATTRS.TH = ATTRS.TD!;
/** `<font size>` (the browser's own sizes, 1–7) as the pixels it means. */
const FONT_SIZES: Record<string, string> = { '1': '10px', '2': '13px', '4': '18px', '5': '24px', '6': '32px', '7': '48px' };

/** A picture's source the composer keeps: embedded (sent as an inline part), inline by Content-ID, or remote. */
export function safeImageSrc(src: string): string | null {
  const s = src.trim();
  return /^(https?:\/\/[^\s<>"]+|cid:[^\s<>"]+|data:image\/(png|jpe?g|gif|webp);base64,[a-z0-9+/=]+)$/i.test(s) ? s : null;
}

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
      // The browser's colour, font and size commands can write <font>; it leaves as a span with a style.
      const colour = node.getAttribute('color') ?? '';
      const face = node.getAttribute('face') ?? '';
      const size = FONT_SIZES[node.getAttribute('size') ?? ''] ?? '';
      const style = safeStyle(`${colour ? `color: ${colour};` : ''}${face ? `font-family: ${face};` : ''}${size ? `font-size: ${size}` : ''}`);
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
    if (node.tagName === 'IMG') {
      const src = safeImageSrc(node.getAttribute('src') ?? '');
      // A picture with nowhere safe to come from is nothing.
      if (!src) continue;
      el.setAttribute('src', src);
    }
    for (const [name, ok] of Object.entries(ATTRS[node.tagName] ?? {})) {
      const v = node.getAttribute(name);
      if (v !== null && ok.test(v.trim())) el.setAttribute(name, v.trim());
    }
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
      else if (tag === 'IMG') {
        const alt = (c.getAttribute('alt') ?? '').trim();
        if (alt) line += `[${alt}]`;
      } else if (tag === 'TD' || tag === 'TH') {
        if (line.trim() && !/\|\s*$/.test(line)) line += ' | ';
        walk(c, prefix, depth);
      } else if (tag === 'TR') {
        if (line.trim()) flush(prefix);
        walk(c, prefix, depth);
        if (line.trim()) flush(prefix);
      } else if (tag === 'A') {
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
  /** Importance, sensitivity and receipts (DMO-CMP-11/13). */
  options?: { importance?: 'high' | 'low'; sensitivity?: 'personal' | 'private' | 'confidential'; read_receipt?: boolean; delivery_receipt?: boolean; vote?: string[] };
  v: 2;
}

/** A draft as this version keeps it — an older plain-text one (`body`, quote included) brought forward. */
/** Message options kept with a draft, only the known values (DMO-CMP-10). */
function draftOptions(o: Record<string, unknown>): NonNullable<ComposeDraft['options']> {
  return {
    ...(o.importance === 'high' || o.importance === 'low' ? { importance: o.importance } : {}),
    ...(o.sensitivity === 'personal' || o.sensitivity === 'private' || o.sensitivity === 'confidential' ? { sensitivity: o.sensitivity } : {}),
    ...(o.read_receipt === true ? { read_receipt: true } : {}),
    ...(o.delivery_receipt === true ? { delivery_receipt: true } : {}),
    ...(voteChoices(o.vote).length ? { vote: voteChoices(o.vote) } : {}),
  };
}

/** Voting buttons' choices (DMO-CMP-12): two to six short plain lines, no repeats. */
export function voteChoices(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const c of v) {
    const t = String(c).replace(/[\p{Cc};]+/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
    if (t && !out.some((o) => o.toLowerCase() === t.toLowerCase())) out.push(t);
  }
  return out.length >= 2 ? out.slice(0, 6) : [];
}

/**
 * The line that lets anybody vote, whatever their mail app (DMO-CMP-12): a
 * recipient on this WorkSuite server sees buttons; everybody else replies
 * with a choice.
 */
export function withVotePrompt(body: { html: string; text: string }, choices: string[], prompt: string): { html: string; text: string } {
  if (choices.length < 2) return body;
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return { html: `${body.html}<p style="color:#555">${esc(prompt)}</p>`, text: `${body.text}\n\n${prompt}` };
}

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
    ...(d.options && typeof d.options === 'object' ? { options: draftOptions(d.options as Record<string, unknown>) } : {}),
    v: 2 as const,
  };
  if (typeof d.html === 'string') return { ...base, html: cleanComposeHtml(d.html), quote: typeof d.quote === 'string' ? d.quote : seedQuote };
  const [own, quoted] = splitQuote(str('body'), seedQuote || undefined);
  return { ...base, html: textToComposeHtml(own.replace(/\s+$/, '')), quote: quoted || (str('body') ? '' : seedQuote) };
}

/** Words that say a file is attached, in English, Sinhala and Tamil. */
const ATTACH_WORDS = /\b(attach(ed|ment|ments|ing)?|enclos(ed|ure)|see (the )?attach(ed|ment))\b|ඇමුණුම|අමුණා|இணைப்ப|இணைத்துள்ள/i;

/**
 * Before sending (DMO-CMP-16): a file promised and none attached, or no
 * subject. Only what the person wrote is read — never the quoted email.
 */
export function sendChecks(d: Pick<ComposeDraft, 'subject' | 'attachments'>, ownText: string): Array<'attachment' | 'subject'> {
  const out: Array<'attachment' | 'subject'> = [];
  if (!d.attachments?.length && ATTACH_WORDS.test(ownText)) out.push('attachment');
  if (!d.subject.trim()) out.push('subject');
  return out;
}

/**
 * The signature for this account and this kind of message (DMO-CMP-06): the
 * account's own default for new mail or replies, else the one for every
 * account, else the old single default.
 */
export function pickSignature<S extends { is_default: boolean; mailbox?: number | null; default_new?: boolean; default_reply?: boolean }>(list: S[], mailbox: string | null, mode: 'new' | 'reply' | 'reply_all' | 'forward'): S | null {
  const key = mode === 'new' ? 'default_new' : 'default_reply';
  const box = mailbox ? Number(mailbox) : null;
  return list.find((s) => s[key] && box !== null && s.mailbox === box) ?? list.find((s) => s[key] && (s.mailbox ?? null) === null) ?? list.find((s) => s.is_default) ?? null;
}

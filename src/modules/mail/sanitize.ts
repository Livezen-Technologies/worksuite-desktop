/**
 * Mail bodies are untrusted HTML. They are rendered in a sandboxed iframe
 * with no scripts and no same-origin access, under the shell's CSP; this pass
 * removes what should never reach even that frame, forces links to open in
 * the browser (through the shell's allow-list and confirmation), and blocks
 * remote images, which are how senders learn you opened a message.
 */
import { safeLinkHref } from '@shared/mail-files';

const DROP = ['script', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'form', 'input', 'button', 'textarea', 'select', 'meta', 'link', 'base', 'svg', 'math', 'template', 'noscript', 'audio', 'video'];

export interface SanitizedMail {
  html: string;
  blockedImages: number;
  /** The remote pictures held back, by the number each <img data-ws-img> carries — kept out of the HTML itself. */
  remoteImages: string[];
}

/**
 * `safeLinks` (on for what is shown): links point at the app, which checks
 * each one when it is clicked (ENH-MAIL-03 DMO-SEC-03). Off for a copy kept
 * elsewhere — a note, a print — which keeps the real addresses.
 */
export function sanitizeMailHtml(input: string, { safeLinks = true }: { safeLinks?: boolean } = {}): SanitizedMail {
  const doc = new DOMParser().parseFromString(input || '', 'text/html');
  for (const tag of DROP) doc.querySelectorAll(tag).forEach((el) => el.remove());
  let blockedImages = 0;
  const remoteImages: string[] = [];
  doc.querySelectorAll('*').forEach((el) => {
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase();
      const value = attr.value.trim();
      if (name.startsWith('on') || name === 'srcdoc' || name === 'formaction' || name === 'ping') el.removeAttribute(attr.name);
      else if ((name === 'href' || name === 'src' || name === 'action' || name === 'xlink:href' || name === 'background') && /^\s*(javascript|vbscript|data:text\/html)/i.test(value)) el.removeAttribute(attr.name);
      else if (name === 'style' && /expression\(|url\(\s*['"]?\s*(https?:|\/\/)/i.test(value)) el.setAttribute('style', value.replace(/url\([^)]*\)/gi, 'none'));
    }
  });
  doc.querySelectorAll('img').forEach((img) => {
    const src = img.getAttribute('src') ?? '';
    if (/^(https?:)?\/\//i.test(src)) {
      img.removeAttribute('src');
      img.removeAttribute('srcset');
      // Kept aside to show later through WorkSuite's image proxy, when the reader asks (DMO-SEC-07, DMO-RD-02).
      if (/^https?:\/\//i.test(src) && remoteImages.length < 60) {
        img.setAttribute('data-ws-img', String(remoteImages.length));
        remoteImages.push(src.slice(0, 2000));
      }
      img.setAttribute('alt', img.getAttribute('alt') || '[image blocked]');
      blockedImages++;
    }
  });
  doc.querySelectorAll('a').forEach((a) => {
    const href = (a.getAttribute('href') ?? '').trim();
    if (href.startsWith('#')) return;
    // Safe links (ENH-MAIL-03 DMO-SEC-03): every link is checked when it is clicked, and its real address is what hovering shows.
    if (/^(https?:|mailto:|tel:)/i.test(href)) {
      if (safeLinks) a.setAttribute('href', safeLinkHref(href, a.textContent ?? ''));
      a.setAttribute('title', href.slice(0, 500));
    } else a.removeAttribute('href');
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noopener noreferrer');
  });
  doc.querySelectorAll('style').forEach((s) => {
    s.textContent = (s.textContent ?? '').replace(/@import[^;]+;/gi, '').replace(/url\([^)]*\)/gi, 'none');
  });
  // A sender's own markers mean nothing here.
  doc.querySelectorAll('[data-ws-img]').forEach((el) => {
    if (el.tagName !== 'IMG' || el.hasAttribute('src')) el.removeAttribute('data-ws-img');
  });
  return { html: doc.body.innerHTML, blockedImages, remoteImages };
}

/**
 * An email designed with its own colours — a background, coloured text, a
 * coloured table — rather than plain words. Turning such a message dark would
 * leave dark logos on a dark page, so it keeps a light card (design D10).
 */
export function isDesignedMail(html: string): boolean {
  return /\bbgcolor\s*=|\bbackground(-color)?\s*:|<font[^>]+color\s*=|(^|[\s;"'])color\s*:/i.test(html || '');
}

/**
 * The frame document: readable defaults and the reader's zoom (75–200 %).
 * Light, as mail expects — unless the reader asked for dark email content
 * (Settings › Reading) while the app is dark and the message is plain words;
 * a designed email stays on its light card so it remains readable.
 */
export function mailFrameDoc(bodyHtml: string, zoom = 100, dark = false): string {
  const z = Math.max(50, Math.min(300, Math.round(Number.isFinite(zoom) ? zoom : 100)));
  const c = dark ? { bg: '#171E33', ink: '#E7EAF3', link: '#9DB2FF', quote: '#33405F', quoteInk: '#B4BCD0' } : { bg: '#fff', ink: '#151A2D', link: '#23349E', quote: '#E3E6EE', quoteInk: '#4A5168' };
  return `<!doctype html><html><head><meta charset="utf-8">${dark ? '<meta name="color-scheme" content="dark">' : ''}<style>
    html,body{margin:0;padding:0;background:${c.bg};color:${c.ink};font:14px/1.55 'Plus Jakarta Sans Variable',system-ui,sans-serif;word-wrap:break-word}
    body{zoom:${z}%}
    body{padding:4px 2px 24px}
    img{max-width:100%;height:auto}
    a{color:${c.link}}
    blockquote{margin:8px 0;padding-left:12px;border-left:3px solid ${c.quote};color:${c.quoteInk}}
    table{max-width:100%}
    pre{white-space:pre-wrap}
  </style></head><body>${bodyHtml}</body></html>`;
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Plain text typed in the composer → the HTML body WorkSuite sends. */
export function textToHtml(text: string): string {
  return escapeHtml(text).replace(/\r?\n/g, '<br>');
}

/**
 * Find in message (DMO-SRC-06): the already-sanitised body with each match of
 * the term wrapped in <mark>, case-insensitive, in text only — never inside
 * a tag or an attribute. Under two characters nothing is marked.
 */
export function highlightText(html: string, term: string): { html: string; count: number } {
  const q = term.trim().toLowerCase();
  if (q.length < 2 || !html) return { html, count: 0 };
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) if ((n.nodeValue ?? '').toLowerCase().includes(q)) nodes.push(n as Text);
  let count = 0;
  for (const node of nodes) {
    const value = node.nodeValue ?? '';
    const lower = value.toLowerCase();
    const frag = doc.createDocumentFragment();
    let at = 0;
    for (let i = lower.indexOf(q); i >= 0; i = lower.indexOf(q, at)) {
      if (i > at) frag.append(value.slice(at, i));
      const mark = doc.createElement('mark');
      mark.textContent = value.slice(i, i + q.length);
      frag.append(mark);
      at = i + q.length;
      count++;
    }
    if (at < value.length) frag.append(value.slice(at));
    node.replaceWith(frag);
  }
  return { html: doc.body.innerHTML, count };
}

export function parseAddresses(input: string): string[] {
  return input
    .split(/[,;\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** The remote images a sanitised body held back (DMO-SEC-07), each once. */
export function blockedImageUrls(clean: Pick<SanitizedMail, 'remoteImages'>): string[] {
  return [...new Set(clean.remoteImages)];
}

/**
 * The held-back images shown through WorkSuite's image proxy: each address
 * swapped for its signed proxy link on the WorkSuite server, so the sender
 * sees WorkSuite fetch it, not who opened the message or where.
 */
export function withProxiedImages(html: string, remoteImages: string[], links: Record<string, string>, origin: string): string {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  doc.querySelectorAll('img[data-ws-img]').forEach((img) => {
    const link = links[remoteImages[Number(img.getAttribute('data-ws-img'))] ?? ''];
    if (link && link.startsWith('/mail-image?')) {
      img.setAttribute('src', `${origin}${link}`);
      img.removeAttribute('data-ws-img');
    }
  });
  return doc.body.innerHTML;
}

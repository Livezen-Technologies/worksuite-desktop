/**
 * Mail bodies are untrusted HTML. They are rendered in a sandboxed iframe
 * with no scripts and no same-origin access, under the shell's CSP; this pass
 * removes what should never reach even that frame, forces links to open in
 * the browser (through the shell's allow-list and confirmation), and blocks
 * remote images, which are how senders learn you opened a message.
 */
import { safeLinkHref } from '@shared/mail-files';
import type { BodyKind, FrameColours } from './bodyLook';

const DROP = ['script', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'form', 'input', 'button', 'textarea', 'select', 'meta', 'link', 'base', 'svg', 'math', 'template', 'noscript', 'audio', 'video'];

export interface SanitizedMail {
  html: string;
  blockedImages: number;
  /** The remote pictures held back, by the number each <img data-ws-img> carries — kept out of the HTML itself. */
  remoteImages: string[];
  /** Tracking pixels removed — never loaded, even when pictures are allowed (#163). */
  trackers: number;
  /**
   * The stylesheets the email put in its <head>, cleaned like the rest — left out of `html`, and used only to draw an
   * email that has dark styles of its own (worksuite-desktop#287).
   */
  styles: string;
}

/** An empty picture: what a held-back image shows instead of a broken-picture icon, sized as the email asked. */
export const PLACEHOLDER_SRC = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

/** Senders' open-tracking services, by host (and anything under it). */
const TRACKER_HOSTS = [
  'mailtrack.io', 'mailtrack.com', 'yesware.com', 'bananatag.com', 'sidekickopen01.com', 'sidekickopen02.com', 'sidekickopen03.com', 'sidekickopen04.com',
  'sidekickopen05.com', 'sidekickopen06.com', 'sidekickopen07.com', 'sidekickopen08.com', 'sidekickopen09.com', 'sidekickopen10.com', 'track.hubspot.com',
  't.hubspotemail.net', 't.hubspotfree.net', 'track.mixmax.com', 'email.mixmax.com', 'mailstat.us', 'getnotify.com', 'pixel.watch', 'emltrk.com',
  'trk.klclick.com', 'trk.klclick1.com', 'opens.mailgun.org', 'mailfoogae.appspot.com', 'pixel.mathtag.com', 'pixel.app.returnpath.net', 'ct.sendgrid.net',
  'open.convertkit-mail.com', 'opens.substack.com', 'tracking.tldrnewsletter.com', 'mltrk.io', 'spgo.io', 'mailsuite.com', 'cirrusinsight.com', 'saleshandy.com',
];

/** Open-tracking paths of the big senders (SendGrid, Mailchimp, Mandrill, Salesforce, Mailgun…). */
const TRACKER_PATH = /\/(wf\/open|track\/open(\.php)?|tracking\/open|e\/o\/|trk\/open|o\.gif|open\.(gif|png|php|aspx?)|beacon\.(gif|png)|pixel\.(php|aspx?)|ss\/o\/|t\/o\/|mo\/[^/]+\/o)(\b|$|[?/])/i;

/** A dimension in pixels from an attribute ("1", "1px") or a style ("width:1px"); null when not given. */
function px(value: string | null | undefined): number | null {
  if (value == null) return null;
  const m = /^\s*(\d+(?:\.\d+)?)\s*(px)?\s*$/i.exec(value);
  return m ? Number(m[1]) : null;
}

function styleDim(style: string, prop: 'width' | 'height'): number | null {
  const m = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, 'i').exec(style);
  return m ? px(m[1]) : null;
}

/** The size the email gives a picture, in pixels, by attribute or inline style. */
export function imageSize(img: Element): { width: number | null; height: number | null } {
  const style = img.getAttribute('style') ?? '';
  return { width: px(img.getAttribute('width')) ?? styleDim(style, 'width'), height: px(img.getAttribute('height')) ?? styleDim(style, 'height') };
}

/**
 * A tracking pixel: a 1×1 (or zero-sized, or hidden) picture from the web,
 * or one from a known open-tracking service — the sender's receipt that the
 * message was opened. Removed even when pictures are allowed.
 */
export function isTrackingPixel(img: Element, src: string): boolean {
  const { width, height } = imageSize(img);
  if ((width !== null && width <= 1 && (height === null || height <= 1)) || (height !== null && height <= 1 && (width === null || width <= 1))) return true;
  if (width === 0 || height === 0) return true;
  const style = (img.getAttribute('style') ?? '').toLowerCase().replace(/\s+/g, '');
  if (/display:none|visibility:hidden|opacity:0(;|$)|max-height:0(px)?(;|$)/.test(style)) return true;
  let url: URL;
  try {
    url = new URL(src);
  } catch {
    return false;
  }
  const host = url.hostname.toLowerCase();
  if (TRACKER_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) return true;
  return TRACKER_PATH.test(url.pathname);
}

/** Holds a remote picture back: an empty, neutral box at the size the email asked for. */
function placeholder(img: Element): void {
  const { width, height } = imageSize(img);
  const style = img.getAttribute('style');
  if (style) img.setAttribute('data-ws-style', style.slice(0, 2000));
  const w = width !== null ? Math.min(width, 2000) : null;
  const h = height !== null ? Math.min(height, 2000) : null;
  img.setAttribute('style', `width:${w ?? 48}px;height:${h ?? (w !== null ? Math.min(w, 120) : 48)}px;max-width:100%`);
  img.setAttribute('src', PLACEHOLDER_SRC);
  img.setAttribute('data-ws-ph', '');
  const alt = img.getAttribute('alt');
  if (alt) img.setAttribute('title', alt.slice(0, 300));
  img.setAttribute('alt', '');
}

/**
 * `safeLinks` (on for what is shown): links point at the app, which checks
 * each one when it is clicked (ENH-MAIL-03 DMO-SEC-03). Off for a copy kept
 * elsewhere — a note, a print — which keeps the real addresses.
 */
export function sanitizeMailHtml(input: string, { safeLinks = true }: { safeLinks?: boolean } = {}): SanitizedMail {
  const doc = new DOMParser().parseFromString(input || '', 'text/html');
  for (const tag of DROP) doc.querySelectorAll(tag).forEach((el) => el.remove());
  // A sender's own markers mean nothing here (the reader's own: pictures held back, a logo's plate, a fold).
  doc.querySelectorAll('[data-ws-img],[data-ws-ph],[data-ws-style],[data-ws-plate],[data-ws-slot]').forEach((el) => {
    el.removeAttribute('data-ws-img');
    el.removeAttribute('data-ws-ph');
    el.removeAttribute('data-ws-style');
    el.removeAttribute('data-ws-plate');
    el.removeAttribute('data-ws-slot');
  });
  let blockedImages = 0;
  let trackers = 0;
  const remoteImages: string[] = [];
  doc.querySelectorAll('*').forEach((el) => {
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase();
      const value = attr.value.trim();
      if (name.startsWith('on') || name === 'srcdoc' || name === 'formaction' || name === 'ping') el.removeAttribute(attr.name);
      else if ((name === 'href' || name === 'src' || name === 'action' || name === 'xlink:href' || name === 'background') && /^\s*(javascript|vbscript|data:text\/html)/i.test(value)) el.removeAttribute(attr.name);
      else if (name === 'style' && /expression\(|url\(\s*['"]?\s*(https?:|\/\/)|image-set\(/i.test(value)) el.setAttribute('style', value.replace(/url\([^)]*\)/gi, 'none').replace(/(?:-webkit-)?image-set\([^)]*\)/gi, 'none'));
    }
  });
  doc.querySelectorAll('img').forEach((img) => {
    const src = (img.getAttribute('src') ?? '').trim();
    if (/^(https?:)?\/\//i.test(src)) {
      // A tracking pixel goes altogether: not even "Show images" loads it (#163).
      if (isTrackingPixel(img, /^\/\//.test(src) ? `https:${src}` : src)) {
        img.remove();
        trackers++;
        return;
      }
      img.removeAttribute('srcset');
      // Kept aside to show later through WorkSuite's image proxy, when allowed (DMO-SEC-07, DMO-RD-02, #163).
      if (/^https?:\/\//i.test(src) && remoteImages.length < 60) {
        img.setAttribute('data-ws-img', String(remoteImages.length));
        remoteImages.push(src.slice(0, 2000));
      }
      placeholder(img);
      blockedImages++;
    } else if (/^cid:/i.test(src)) {
      // A picture of the message itself the server could not put in place (too big): an empty box, not a broken one.
      placeholder(img);
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
    s.textContent = (s.textContent ?? '').replace(/@import[^;]+;/gi, '').replace(/url\([^)]*\)/gi, 'none').replace(/(?:-webkit-)?image-set\([^)]*\)/gi, 'none');
  });
  const styles = [...doc.head.querySelectorAll('style')]
    .map((s) => s.textContent ?? '')
    .join('\n')
    .slice(0, 200_000);
  return { html: doc.body.innerHTML, blockedImages, remoteImages, trackers, styles };
}

/**
 * An email designed with its own colours — a background, coloured text, a
 * coloured table — rather than plain words. In the dark theme such a message
 * is darkened element by element, or kept light on a soft card when that
 * would read badly (bodyLook.ts, #287).
 */
export function isDesignedMail(html: string): boolean {
  return /\bbgcolor\s*=|\bbackground(-color)?\s*:|<font[^>]+color\s*=|(^|[\s;"'])color\s*:/i.test(html || '');
}

/** How the frame draws a body (worksuite-desktop#287; bodyLook.ts decides it). */
export interface FrameLook {
  /** light: the email's own colours; dark: the app's (plain words, or darkened); native: its own dark styles. */
  scheme: 'light' | 'dark' | 'native';
  /** The colours the email is drawn in, from the app's tokens. */
  colours: FrameColours;
  /** The reading pane's colour round it: when it is not the email's, the email sits on a rounded card. */
  outer: string;
  /** Plain and simple words read in the app's font at 15px, in a 720px column; a designed email keeps its own width. */
  kind: BodyKind;
  /** A designed email's own fixed width (a 600px newsletter). */
  width?: number | null;
  /** The email's own stylesheets, sanitised, with its colour-scheme media queries switched for `scheme`. */
  css?: string;
}

/** What the frame looked like before #287: white, or dark for plain words; kept for the boolean callers. */
const LEGACY: Record<'light' | 'dark', FrameLook> = {
  light: { scheme: 'light', colours: { surface: '#fff', ink: '#151A2D', ink2: '#4A5168', ink3: '#5B6275', link: '#23349E', line: '#E3E6EE', subtle: '#EEF0F6' }, outer: '#fff', kind: 'designed' },
  dark: { scheme: 'dark', colours: { surface: '#171E33', ink: '#E7EAF3', ink2: '#B4BCD0', ink3: '#9AA3BD', link: '#9DB2FF', line: '#33405F', subtle: '#26304A' }, outer: '#171E33', kind: 'designed' },
};

const APP_FONT = "'Plus Jakarta Sans Variable',system-ui,sans-serif";

/**
 * The frame document: readable defaults, the reader's zoom (75–200 %), and the look bodyLook.ts chose — the app's
 * colours or the email's own, the reading column (about 720px for words, a newsletter's own width), the card when the
 * email is not in the pane's colours, and the folds for quoted text and long signatures. Everything here is static CSS
 * written by the app; the frame runs no script. `look` may still be a boolean: light, or dark for plain words.
 */
export function mailFrameDoc(bodyHtml: string, zoom = 100, look: boolean | FrameLook = false): string {
  const z = Math.max(50, Math.min(300, Math.round(Number.isFinite(zoom) ? zoom : 100)));
  const l = typeof look === 'boolean' ? LEGACY[look ? 'dark' : 'light'] : look;
  const c = l.colours;
  const dark = l.scheme !== 'light';
  const card = l.outer.toLowerCase() !== c.surface.toLowerCase();
  const words = l.kind === 'plain' || l.kind === 'simple';
  const column = (words ? 720 : l.width ? l.width + 32 : 720) + (card ? 48 : 0);
  // The email's own stylesheet can never close the frame's <style>.
  const own = (l.css ?? '').replace(/<\/style/gi, '<\\/style');
  return `<!doctype html><html><head><meta charset="utf-8">${dark ? '<meta name="color-scheme" content="dark">' : ''}<style>
    html{color-scheme:${dark ? 'dark' : 'light'}}
    html,body{margin:0;padding:0;background:${l.outer};color:${c.ink};font:14px/1.55 ${APP_FONT};word-wrap:break-word}
    body{zoom:${z}%}
    body{padding:4px 2px 24px}
    .ws-col{box-sizing:border-box;max-width:min(100%,${column}px);margin:0 auto;color:${c.ink}}
    .ws-card{background:${c.surface};border-radius:12px;padding:20px 24px;margin:6px auto 12px;box-shadow:0 0 0 1px ${c.line}}
    .ws-read{font-size:15px;line-height:1.6}
    .ws-plain>div,.ws-plain>blockquote,.ws-plain>details,.ws-q>div{margin:0 0 .9em}
    .ws-q>div:last-child{margin-bottom:0}
    img{max-width:100%;height:auto}
    img[data-ws-ph]{background:${dark ? c.subtle : '#ECEFF5'};border-radius:4px;vertical-align:middle}
    img[data-ws-plate]:not([data-ws-ph]){background-color:#f3f4f7;border-radius:4px}
    a{color:${c.link}}
    a.ws-img{display:inline-block;max-width:100%;cursor:zoom-in}
    blockquote{margin:8px 0;padding-left:12px;border-left:3px solid ${c.line};color:${c.ink2}}
    table{max-width:100%}
    pre{white-space:pre-wrap}
    details>summary{list-style:none;cursor:pointer;user-select:none}
    details>summary::-webkit-details-marker{display:none}
    details:not([open])>summary .ws-opened,details[open]>summary .ws-closed{display:none}
    summary:focus-visible{outline:2px solid ${c.link};outline-offset:2px}
    details.ws-quote{margin:14px 0}
    details.ws-quote>summary{display:inline-flex;align-items:center;height:24px;padding:0 10px;border:1px solid ${c.line};border-radius:12px;background:${c.subtle};color:${c.ink2};font:600 12.5px/1 ${APP_FONT}}
    details.ws-quote>summary:hover{color:${c.ink}}
    details.ws-quote[open]>summary{margin-bottom:10px}
    .ws-attr{color:${c.ink3};margin:0 0 6px}
    .ws-sig-short,details.ws-sig{margin-top:.9em;color:${c.ink2}}
    .ws-sig-line{color:${c.ink3}}
    details.ws-sig{display:flex;flex-direction:column}
    details.ws-sig>summary{order:2;align-self:flex-start;margin-top:2px;color:${c.link};font:600 13px/1.5 ${APP_FONT}}
    details.ws-sig:not([open])::details-content{content-visibility:visible;display:block;max-height:6.2em;overflow:hidden;-webkit-mask-image:linear-gradient(#000 30%,transparent);mask-image:linear-gradient(#000 30%,transparent)}
  </style>${own ? `<style>${own}</style>` : ''}</head><body><div class="ws-col ws-${l.kind}${words ? ' ws-read' : ''}${card ? ' ws-card' : ''}">${bodyHtml}</div></body></html>`;
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
  return swapImages(html, remoteImages, (url) => {
    const link = links[url];
    return link && link.startsWith('/mail-image?') ? `${origin}${link}` : null;
  });
}

/**
 * The held-back images shown from what was loaded for them — data: URLs from
 * the local mail store, fetched there through WorkSuite's image proxy (#163).
 * Each gets back the style the email gave it.
 */
export function withLoadedImages(html: string, remoteImages: string[], images: Record<string, string>): string {
  return swapImages(html, remoteImages, (url) => {
    const src = images[url];
    return src && /^data:image\/(png|jpeg|gif|webp|bmp|avif);base64,/i.test(src) ? src : null;
  });
}

function swapImages(html: string, remoteImages: string[], srcFor: (url: string) => string | null): string {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  doc.querySelectorAll('img[data-ws-img]').forEach((img) => {
    const src = srcFor(remoteImages[Number(img.getAttribute('data-ws-img'))] ?? '');
    if (!src) return;
    img.setAttribute('src', src);
    const style = img.getAttribute('data-ws-style');
    if (style) img.setAttribute('style', style);
    else img.removeAttribute('style');
    if (!img.getAttribute('alt') && img.getAttribute('title')) img.setAttribute('alt', img.getAttribute('title') ?? '');
    for (const a of ['data-ws-img', 'data-ws-ph', 'data-ws-style']) img.removeAttribute(a);
  });
  return doc.body.innerHTML;
}

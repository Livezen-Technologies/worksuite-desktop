/**
 * Rich text that came from WorkSuite, made safe to put into the page.
 *
 * The server cleans what it stores (RichText::clean); this cleans again
 * because the page can reach the app. `strict` is what tasks and comments
 * allow; `rich` adds what notes do: headings, tables, rules and a handful of
 * inline styles. No attribute survives but a link's address (http, https,
 * mailto, tel), an inline image's file id and alt, table spans and those
 * styles. An image is shown from `imageUrl` when given (for display), or kept
 * as its file id alone (for saving).
 */
const STRICT = ['B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'DEL', 'P', 'BR', 'DIV', 'SPAN', 'UL', 'OL', 'LI', 'A', 'CODE', 'PRE', 'BLOCKQUOTE', 'H3', 'H4', 'IMG'];
const RICH = [...STRICT, 'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'TD', 'TH', 'CAPTION', 'COLGROUP', 'COL', 'H1', 'H2', 'H5', 'H6', 'HR', 'FONT', 'SUB', 'SUP'];
const GONE = ['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'TEMPLATE', 'SVG', 'MATH', 'LINK', 'META', 'BASE', 'FORM', 'INPUT', 'BUTTON', 'TEXTAREA', 'SELECT'];
const STYLES = new Set(['color', 'background-color', 'font-weight', 'font-style', 'text-align', 'text-decoration', 'vertical-align', 'width']);

function safeStyle(style: string): string {
  return style
    .split(';')
    .map((d) => d.split(':'))
    .filter(([k, v]) => k && v && STYLES.has(k.trim().toLowerCase()) && !/url\(|expression|javascript:|data:|@import|[<>\\]/i.test(v))
    .map(([k, v]) => `${k!.trim().toLowerCase()}: ${v!.trim()}`)
    .join('; ');
}

export function sanitizeHtml(html: string | null | undefined, opts: { profile?: 'strict' | 'rich'; imageUrl?: (fileId: string) => string } = {}): string {
  if (!html) return '';
  const allowed = new Set(opts.profile === 'rich' ? RICH : STRICT);
  const rich = opts.profile === 'rich';
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  const walk = (el: Element) => {
    for (const child of [...el.children]) {
      if (!allowed.has(child.tagName)) {
        if (GONE.includes(child.tagName)) child.remove();
        else {
          walk(child);
          child.replaceWith(...child.childNodes);
        }
        continue;
      }
      const keep: Array<[string, string]> = [];
      if (child.tagName === 'A') {
        const href = child.getAttribute('href') ?? '';
        if (/^(https?:|mailto:|tel:)/i.test(href)) keep.push(['href', href], ['target', '_blank'], ['rel', 'noopener noreferrer']);
      }
      if (child.tagName === 'IMG') {
        const id = child.getAttribute('data-file-id') ?? '';
        if (!/^\d{1,10}$/.test(id)) {
          child.remove();
          continue;
        }
        const alt = (child.getAttribute('alt') ?? '').slice(0, 200);
        if (opts.imageUrl) keep.push(['src', opts.imageUrl(id)]);
        keep.push(['alt', alt], ['data-file-id', id]);
      }
      if (rich) {
        const style = safeStyle(child.getAttribute('style') ?? '');
        if (style) keep.push(['style', style]);
        for (const a of ['colspan', 'rowspan', 'span']) {
          const v = child.getAttribute(a);
          if (v && /^\d{1,3}$/.test(v)) keep.push([a, v]);
        }
        const align = child.getAttribute('align');
        if (align && /^(left|right|center|justify)$/.test(align)) keep.push(['align', align]);
      }
      for (const a of [...child.attributes]) child.removeAttribute(a.name);
      for (const [k, v] of keep) child.setAttribute(k, v);
      walk(child);
    }
  };
  const root = doc.body.firstElementChild!;
  walk(root);
  return root.innerHTML;
}

export function plainText(html: string | null | undefined): string {
  if (!html) return '';
  return (new DOMParser().parseFromString(html, 'text/html').body.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/** Text with a line per paragraph, heading, list item and row, for comparing versions. */
export function readableText(html: string | null | undefined): string {
  if (!html) return '';
  const spaced = html.replace(/<\/(p|div|h[1-6]|li|tr|blockquote|pre|th|td)>|<br\s*\/?>/gi, (m) => `${m}\n`);
  const text = new DOMParser().parseFromString(spaced, 'text/html').body.textContent ?? '';
  return text.replace(/[^\S\n]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{2,}/g, '\n').trim();
}


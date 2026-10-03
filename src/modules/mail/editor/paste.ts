/**
 * Pasting into a message (worksuite-desktop#188): Keep formatting, Plain
 * text or Match style, and the clean-up of what Word, Outlook and Excel put
 * on the clipboard — conditional comments, `<o:p>`, `mso-` styles, `Mso*`
 * classes, XML namespaces and the `<style>` block that goes with them —
 * before the composer's own allow-list sees it.
 */

export type PasteMode = 'keep' | 'plain' | 'match';

/** Word/Excel/Outlook markup without the Office-only parts. */
export function cleanOfficeHtml(html: string): string {
  if (!html) return '';
  let out = html
    // Only what is between <!--StartFragment--> and <!--EndFragment--> was copied.
    .replace(/^[\s\S]*<!--StartFragment-->/i, '')
    .replace(/<!--EndFragment-->[\s\S]*$/i, '')
    // Conditional comments: <!--[if gte mso 9]>…<![endif]--> and the downlevel-revealed kind.
    .replace(/<!--\[if[\s\S]*?<!\[endif\]-->/gi, '')
    .replace(/<!\[if[^\]]*\]>|<!\[endif\]>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<xml[\s\S]*?<\/xml>/gi, '')
    .replace(/<meta[^>]*>|<link[^>]*>/gi, '')
    // Namespaced elements: <o:p>, <w:…>, <v:…>, <st1:…> — keep their words.
    .replace(/<\/?[a-z]+:[a-z0-9]+[^>]*>/gi, '');
  // Attributes Office adds: classes, language and Excel's own, and every mso- style.
  out = out.replace(/<([a-z][a-z0-9]*)(\s[^>]*)?>/gi, (_all, tag: string, attrs: string | undefined) => {
    if (!attrs) return `<${tag}>`;
    const kept = attrs
      .replace(/\s(class|lang|x:[a-z]+|v:[a-z]+|o:[a-z]+|xmlns(:[a-z]+)?)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
      .replace(/\sstyle\s*=\s*("([^"]*)"|'([^']*)')/gi, (_s, _q, dq: string | undefined, sq: string | undefined) => {
        const style = (dq ?? sq ?? '')
          .replace(/&quot;/g, '"')
          .split(';')
          .map((d) => d.trim())
          .filter((d) => d && !/^mso-|^tab-stops|^layout-grid|^text-autospace|^punctuation|^font-variant-ligatures|^page:|^page-break/i.test(d))
          .join('; ');
        return style ? ` style="${style.replace(/"/g, "'")}"` : '';
      });
    return `<${tag}${kept}>`;
  });
  // Word's empty paragraphs are a non-breaking space; they stay as blank lines.
  return out.replace(/<p>\s*(&nbsp;|\u00a0)\s*<\/p>/gi, '<p><br></p>').trim();
}

/** Looks like it came from Office. */
export function isOfficeHtml(html: string): boolean {
  return /urn:schemas-microsoft-com|class="?Mso|mso-|<o:p|<!--\[if|ProgId|xmlns:x=/i.test(html);
}

const LOOK = /^(color|background|background-color|font|font-family|font-size|line-height|letter-spacing|text-shadow)$/i;

/**
 * The structure without the look: headings, lists, links, bold and italic,
 * tables stay; colours, fonts, sizes and backgrounds go, so the text takes
 * the message's own style.
 */
export function matchStyle(html: string): string {
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  const root = doc.body.firstElementChild!;
  root.querySelectorAll<HTMLElement>('[style]').forEach((el) => {
    const kept = (el.getAttribute('style') ?? '')
      .split(';')
      .map((d) => d.trim())
      .filter((d) => d && !LOOK.test(d.split(':')[0]!.trim()))
      .join('; ');
    if (kept) el.setAttribute('style', kept);
    else el.removeAttribute('style');
  });
  root.querySelectorAll('font').forEach((f) => f.replaceWith(...f.childNodes));
  root.querySelectorAll('[bgcolor], [color], [face]').forEach((el) => {
    el.removeAttribute('bgcolor');
    el.removeAttribute('color');
    el.removeAttribute('face');
  });
  return root.innerHTML;
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Plain text as editor HTML: a block per line, blank lines kept. */
export function textToBlocks(value: string): string {
  const v = value.replace(/\r\n?/g, '\n');
  if (!v) return '';
  const lines = v.split('\n');
  if (lines.length === 1) return escapeHtml(lines[0]!);
  return lines.map((l) => (l ? `<div>${escapeHtml(l)}</div>` : '<div><br></div>')).join('');
}

/** What a paste puts in the message, for a mode. `clean` is the composer's allow-list. */
export function pastedHtml(data: { html: string; text: string }, mode: PasteMode, clean: (html: string) => string): string {
  if (mode === 'plain' || !data.html.trim()) return textToBlocks(data.text);
  const office = isOfficeHtml(data.html) ? cleanOfficeHtml(data.html) : data.html.replace(/^[\s\S]*<!--StartFragment-->/i, '').replace(/<!--EndFragment-->[\s\S]*$/i, '');
  const safe = clean(office);
  return mode === 'match' ? clean(matchStyle(safe)) : safe;
}

import { readableText, sanitizeHtml } from './rich';

const TAGS = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'P', 'DIV', 'BR', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'A']);

/** Product descriptions use only portable formatting, without styles or media. */
export function cleanDescription(html: string): string {
  const doc = new DOMParser().parseFromString(sanitizeHtml(html, { profile: 'rich' }), 'text/html');
  for (const el of [...doc.body.querySelectorAll('*')].reverse()) {
    if (el.tagName === 'IMG') el.remove();
    else if (!TAGS.has(el.tagName)) el.replaceWith(...el.childNodes);
    else for (const attr of [...el.attributes]) {
      if (el.tagName !== 'A' || !['href', 'target', 'rel'].includes(attr.name)) el.removeAttribute(attr.name);
    }
  }
  return doc.body.innerHTML;
}

/** Legacy text is escaped before converting line breaks; HTML is always cleaned. */
export function descriptionHtml(value: string | null | undefined): string {
  if (!value) return '';
  if (/<\/?(?:p|div|br|h[1-6]|b|strong|i|em|u|ul|ol|li|a|script|style|img)\b/i.test(value)) return cleanDescription(value);
  return textDescriptionHtml(value);
}

export function textDescriptionHtml(value: string): string {
  const el = document.createElement('div');
  el.textContent = value;
  return el.innerHTML.replace(/\r?\n/g, '<br>');
}

/** For integrations that accept text: keep paragraph and list line breaks. */
export function descriptionText(value: string | null | undefined): string {
  return readableText(descriptionHtml(value));
}

import { cleanComposeHtml, composeText, textToComposeHtml } from '../mail/composeHtml';

/** Mail's allow-list, with remote images removed so a ticket cannot track its readers. */
export function cleanReplyHtml(value: string): string {
  const doc = new DOMParser().parseFromString(cleanComposeHtml(value), 'text/html');
  doc.querySelectorAll('img').forEach((img) => {
    if (!/^data:image\/(png|jpe?g|gif|webp);base64,/i.test(img.getAttribute('src') ?? '')) img.remove();
  });
  return doc.body.innerHTML;
}
export const replyText = (html: string): string => composeText(html) || (/<img\b/i.test(html) ? '[Image]' : '');
export const replyHtml = (body: string, html?: string): string => (html === undefined ? textToComposeHtml(body) : cleanReplyHtml(html));

/** The editor's text before its caret, not the position in its markup. */
export function richCaret(box: HTMLElement | null): number {
  const sel = window.getSelection();
  if (!box || !sel?.rangeCount || !box.contains(sel.anchorNode)) return replyText(box?.innerHTML ?? '').length;
  const r = sel.getRangeAt(0).cloneRange();
  r.selectNodeContents(box);
  r.setEnd(sel.anchorNode!, sel.anchorOffset);
  const holder = document.createElement('div');
  holder.append(r.cloneContents());
  return composeText(holder.innerHTML).length;
}
export function placeRichCaret(box: HTMLElement | null, at: number): void {
  if (!box) return;
  box.focus();
  const walk = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
  let remaining = at;
  let point: Text | null = null;
  for (let node = walk.nextNode() as Text | null; node; node = walk.nextNode() as Text | null) {
    point = node;
    if (remaining <= node.length) break;
    remaining -= node.length;
  }
  const r = document.createRange();
  if (point) r.setStart(point, Math.min(remaining, point.length));
  else {
    r.selectNodeContents(box);
    r.collapse(false);
  }
  r.collapse(true);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(r);
}

/** Replace a picker token without flattening the formatting around it. */
export function replacePickerToken(html: string, token: string, insert: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const walk = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  let found: Text | null = null;
  let at = -1;
  for (let node = walk.nextNode() as Text | null; node; node = walk.nextNode() as Text | null) {
    const i = node.data.lastIndexOf(token);
    if (i >= 0) {
      found = node;
      at = i;
    }
  }
  if (found) {
    const r = doc.createRange();
    r.setStart(found, at);
    r.setEnd(found, at + token.length);
    r.deleteContents();
    r.insertNode(r.createContextualFragment(textToComposeHtml(insert).replace(/^<div>/, '').replace(/<\/div>$/, '').replace(/<\/div><div>/g, '<br>')));
  } else doc.body.insertAdjacentHTML('beforeend', textToComposeHtml(insert));
  return cleanReplyHtml(doc.body.innerHTML);
}

/** Link plain pasted URLs; never link inside code or an existing link. */
export function linkReplyUrls(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const walk = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  for (let node = walk.nextNode() as Text | null; node; node = walk.nextNode() as Text | null) if (!node.parentElement?.closest('a, code, pre')) nodes.push(node);
  for (const node of nodes) {
    const re = /https?:\/\/[^\s<>]+/g;
    const value = node.data;
    let offset = 0;
    const fragment = doc.createDocumentFragment();
    let matched = false;
    for (const match of value.matchAll(re)) {
      matched = true;
      const url = match[0].replace(/[.,;!?\])]+$/, '');
      const start = match.index!;
      fragment.append(value.slice(offset, start));
      const a = doc.createElement('a');
      a.href = url;
      a.textContent = url;
      fragment.append(a, match[0].slice(url.length));
      offset = start + match[0].length;
    }
    if (matched) {
      fragment.append(value.slice(offset));
      node.replaceWith(fragment);
    }
  }
  return cleanReplyHtml(doc.body.innerHTML);
}

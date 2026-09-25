const COPIED = [
  'boxSizing', 'width', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'fontFamily', 'fontSize', 'fontWeight',
  'fontStyle', 'letterSpacing', 'lineHeight', 'textTransform', 'wordSpacing', 'tabSize',
] as const;

/**
 * Where a character of a textarea is drawn, relative to the textarea's top
 * left: a hidden copy with the same text wrapping is measured, so the
 * mention list can open above the "@" being typed.
 */
export function caretPoint(el: HTMLTextAreaElement, index: number): { left: number; top: number } {
  const style = window.getComputedStyle(el);
  const mirror = document.createElement('div');
  for (const k of COPIED) mirror.style[k] = style[k];
  mirror.style.position = 'absolute';
  mirror.style.visibility = 'hidden';
  mirror.style.whiteSpace = 'pre-wrap';
  mirror.style.overflowWrap = 'break-word';
  mirror.style.top = '0';
  mirror.style.left = '-9999px';
  mirror.textContent = el.value.slice(0, index);
  const mark = document.createElement('span');
  mark.textContent = el.value.slice(index) || '.';
  mirror.appendChild(mark);
  document.body.appendChild(mirror);
  const at = { left: mark.offsetLeft - el.scrollLeft, top: mark.offsetTop - el.scrollTop };
  mirror.remove();
  return at;
}

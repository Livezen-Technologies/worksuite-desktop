import type { KeyboardEvent } from 'react';

/**
 * For an element that is not a button but is clicked like one — a table row that opens its record, a card — so the
 * keyboard can do what the mouse does (audit D-G21): give it `tabIndex={0}` and `onKeyDown={clickOnKey}`, and a
 * `role` where it has none of its own (`role="button"` on a div or span; a `<tr>` stays a row).
 *
 * Enter or Space on the element itself clicks it, so its `onClick` runs as for the mouse. A key pressed in a control
 * inside it (a checkbox in the row, a menu) is that control's, and a held key does not click again and again.
 */
export function clickOnKey(e: KeyboardEvent<Element>): void {
  if (e.target !== e.currentTarget || e.repeat || e.nativeEvent.isComposing) return;
  if (e.key !== 'Enter' && e.key !== ' ') return;
  e.preventDefault();
  (e.currentTarget as HTMLElement).click();
}

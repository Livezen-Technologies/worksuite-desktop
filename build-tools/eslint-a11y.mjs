/**
 * Two accessibility rules for the renderer's JSX (audit D-G21), the parts of eslint-plugin-jsx-a11y this app needs
 * (click-events-have-key-events, no-static-element-interactions, alt-text) without another dependency:
 *
 *   a11y/click-has-keys   An element that is not interactive by nature (div, span, tr, li, img…) with an onClick must
 *                         be reachable and usable from the keyboard: `tabIndex` and `onKeyDown`/`onKeyUp` (see
 *                         src/components/press.ts `clickOnKey`), and a role on a div or span. Not asked of:
 *                         - an item of a composite widget (role option, menuitem…, treeitem, row, gridcell, radio,
 *                           tab): its container owns the keys (arrows, Enter) and the focus or aria-activedescendant;
 *                         - `role="presentation"`/`"none"` or `aria-hidden`: a click caught only to stop it going
 *                           further, or links in rendered rich text, which are <a> elements Tab reaches and whose
 *                           Enter click bubbles to the same handler;
 *                         - a contentEditable area, which its editing makes focusable.
 *   a11y/img-alt          Every <img> says what it shows: an `alt` (empty only for a picture that is decoration).
 *
 * onMouseDown on a dialog's backdrop is not asked about: the keyboard closes a dialog with Escape.
 */
const INTERACTIVE = new Set(['a', 'button', 'input', 'select', 'textarea', 'option', 'summary', 'details', 'label', 'audio', 'video', 'iframe']);
const COMPOSITE_ITEMS = new Set(['option', 'menuitem', 'menuitemradio', 'menuitemcheckbox', 'treeitem', 'row', 'gridcell', 'radio', 'tab', 'switch', 'checkbox']);
const IMPLICIT_ROLE = new Set(['tr', 'li', 'td', 'th', 'img']);

const attr = (node, name) => node.attributes.find((a) => a.type === 'JSXAttribute' && a.name.name === name);
const hasSpread = (node) => node.attributes.some((a) => a.type === 'JSXSpreadAttribute');
/** A literal role, or null when it is an expression (then it is trusted). */
function roleOf(node) {
  const a = attr(node, 'role');
  if (!a) return undefined;
  const v = a.value;
  if (v?.type === 'Literal') return String(v.value);
  if (v?.type === 'JSXExpressionContainer' && v.expression.type === 'Literal') return String(v.expression.value);
  return null;
}

const clickHasKeys = {
  meta: { type: 'problem', messages: { keys: '<{{tag}} onClick> cannot be used from the keyboard: add tabIndex={0} and onKeyDown={clickOnKey}{{role}} (src/components/press.ts), or use a <button>.' } },
  create(context) {
    return {
      JSXOpeningElement(node) {
        if (node.name.type !== 'JSXIdentifier') return;
        const tag = node.name.name;
        if (!/^[a-z]/.test(tag) || INTERACTIVE.has(tag) || !attr(node, 'onClick') || hasSpread(node)) return;
        // Hidden from assistive technology, or an editable area (focusable by being editable).
        if (attr(node, 'aria-hidden') || attr(node, 'contentEditable')) return;
        const role = roleOf(node);
        if (role === null || role === 'presentation' || role === 'none' || COMPOSITE_ITEMS.has(role ?? '')) return;
        const keys = attr(node, 'onKeyDown') || attr(node, 'onKeyUp');
        const tab = attr(node, 'tabIndex');
        const named = role !== undefined || IMPLICIT_ROLE.has(tag);
        if (keys && tab && named) return;
        context.report({ node, messageId: 'keys', data: { tag, role: named ? '' : ' and role="button"' } });
      },
    };
  },
};

const imgAlt = {
  meta: { type: 'problem', messages: { alt: '<img> needs an alt: what it shows, or alt="" for decoration.' } },
  create(context) {
    return {
      JSXOpeningElement(node) {
        if (node.name.type === 'JSXIdentifier' && node.name.name === 'img' && !attr(node, 'alt') && !hasSpread(node)) context.report({ node, messageId: 'alt' });
      },
    };
  },
};

export default { rules: { 'click-has-keys': clickHasKeys, 'img-alt': imgAlt } };

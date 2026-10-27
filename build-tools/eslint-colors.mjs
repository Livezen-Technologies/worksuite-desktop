/**
 * Colours come from the design tokens (src/styles.css; audit D-G23), never a raw hex written into a class or a style:
 *
 *   colors/no-raw-hex   A Tailwind class with a hex colour in it (`bg-[#EEF1FD]`, `shadow-[0_0_0_1px_#cbd5e1]`,
 *                       `[background:#fff]`) anywhere in a string or template, and a hex literal as a value of a JSX
 *                       `style={{…}}`, are refused. Use the token (`bg-selection`, `text-warning-ink`, `bg-stage-2`…),
 *                       or `var(--ws-…)` inside an arbitrary value.
 *
 * Not refused:
 *   - a hex that is the fallback of a person's own data, `x.color ?? '#3B5BDB'` / `x.color || '#3B5BDB'` (user data:
 *     a calendar's, a folder's or a brand's own colour);
 *   - what the reviewed allow-list in eslint.config.mjs names: the brand colours of other companies' products (the
 *     Google and Microsoft marks), and previews of what customers see (a website widget's or an email's own colours),
 *     which must not follow the app's theme. Each entry says why.
 */
const CLASS_HEX = /(?:^|[\s"'`{(:!])(?:[\w@&:[\]!-]*-)?\[[^\]\s]*#[0-9a-fA-F]{3,8}(?![0-9a-zA-Z])[^\]\s]*\]/;
const HEX = /#[0-9a-fA-F]{3,8}(?![0-9a-zA-Z])/g;
const HEX_ONLY = /^\s*#[0-9a-fA-F]{3,8}\s*$/;

function globRe(glob) {
  return new RegExp('(^|/)' + glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '<<ANY>>').replace(/\*/g, '[^/]*').replace(/<<ANY>>/g, '.*') + '$');
}

function allowed(context, text) {
  const opts = context.options[0] ?? {};
  const file = (context.filename ?? context.getFilename()).replace(/\\/g, '/');
  for (const a of opts.allow ?? []) {
    if (a.files && !a.files.some((g) => globRe(g).test(file))) continue;
    if (!a.colors) return true;
    const found = text.match(HEX) ?? [];
    if (found.every((h) => a.colors.some((c) => c.toLowerCase() === h.toLowerCase()))) return true;
  }
  return false;
}

/** `x ?? '#hex'` / `x || '#hex'`: the default for a colour that is the person's own data. */
function isDataFallback(node) {
  const p = node.parent;
  return p?.type === 'LogicalExpression' && (p.operator === '??' || p.operator === '||') && p.right === node;
}

function inStyle(node) {
  for (let n = node.parent; n; n = n.parent) {
    if (n.type === 'JSXAttribute') return n.name?.name === 'style';
    if (n.type === 'JSXElement' || n.type === 'Program') return false;
  }
  return false;
}

const noRawHex = {
  meta: {
    type: 'problem',
    schema: [{ type: 'object', properties: { allow: { type: 'array' } }, additionalProperties: false }],
    messages: {
      cls: 'A raw hex colour in a class ({{hex}}): use a design token from src/styles.css (bg-…, text-…, border-…, stage-…), or var(--ws-…) in an arbitrary value.',
      style: 'A raw hex colour in a style ({{hex}}): use var(--ws-…) or a token class.',
    },
  },
  create(context) {
    const check = (node, text) => {
      if (typeof text !== 'string' || !text.includes('#')) return;
      if (CLASS_HEX.test(text)) {
        if (!allowed(context, text)) context.report({ node, messageId: 'cls', data: { hex: (text.match(HEX) ?? [''])[0] } });
        return;
      }
      if (HEX_ONLY.test(text) && inStyle(node) && !isDataFallback(node) && !allowed(context, text)) context.report({ node, messageId: 'style', data: { hex: text.trim() } });
    };
    return {
      Literal(node) {
        check(node, node.value);
      },
      TemplateElement(node) {
        check(node, node.value.cooked ?? node.value.raw);
      },
    };
  },
};

export default { rules: { 'no-raw-hex': noRawHex } };

/**
 * Module boundaries (audit D-G08): a module under src/modules/<name>/ never imports another module's files.
 *
 *   boundaries/no-module-imports   An import, `export … from`, `import()` or `vi.mock()` of a path inside another
 *                                  module's folder is refused. Shared UI lives in src/components (the page, list,
 *                                  record, form, card, call, console and report kits), shared logic in src/core and
 *                                  shared/. Opening another module's screen goes through the registry and the router.
 *
 * Not refused:
 *   - src/modules/registry.ts, which is the list of modules rather than one of them;
 *   - a pair on the reviewed allow-list in build-tools/module-boundaries.mjs. Each entry names what the importing
 *     module uses and why it is not shared yet. The list may only shrink: tests/unit/build/module-boundaries.test.ts
 *     fails on an entry no import needs any more, so a pair that is cleaned up comes off the list in the same change.
 */
import { existsSync, statSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';

const MODULES = `${sep}src${sep}modules${sep}`;

/** The module a file belongs to, or null for a file outside every module (or registry.ts beside them). */
export function moduleOf(file) {
  const f = resolve(file);
  const at = f.lastIndexOf(MODULES);
  if (at < 0) return null;
  const rest = f.slice(at + MODULES.length).split(sep);
  return rest.length > 1 ? rest[0] : null;
}

/** The module an import specifier in `file` reaches, or null when it reaches none (a package, shared/, src/core …). */
export function targetOf(file, spec) {
  if (typeof spec !== 'string') return null;
  let abs;
  if (spec.startsWith('.')) abs = resolve(dirname(file), spec);
  else if (spec.startsWith('@/')) {
    const f = resolve(file);
    const at = f.lastIndexOf(`${sep}src${sep}`);
    if (at < 0) return null;
    abs = resolve(f.slice(0, at), 'src', spec.slice(2));
  } else return null;
  const at = abs.lastIndexOf(MODULES);
  if (at < 0) return null;
  const rest = abs.slice(at + MODULES.length).split(sep);
  // `../registry` is src/modules/registry.ts, beside the modules; `../hr` is the hr module's folder (its index).
  if (rest.length === 1 && !(existsSync(abs) && statSync(abs).isDirectory())) return null;
  return rest[0] || null;
}

/** `{ from, to }` pairs from the allow-list's `{ from, to: [...] }` entries. */
export function allowedPairs(allow) {
  const pairs = new Set();
  for (const a of allow ?? []) for (const to of [].concat(a.to)) for (const from of [].concat(a.from)) pairs.add(`${from}>${to}`);
  return pairs;
}

const noModuleImports = {
  meta: {
    type: 'problem',
    schema: [{ type: 'object', properties: { allow: { type: 'array' } }, additionalProperties: false }],
    messages: {
      cross:
        '"{{from}}" imports "{{to}}" ({{spec}}): a module does not import another module. Move what is shared to src/components, src/core or shared/, or open the other module through the registry. A pair that must stay goes on the reviewed allow-list in build-tools/module-boundaries.mjs, with why.',
    },
  },
  create(context) {
    const file = context.filename ?? context.getFilename();
    const from = moduleOf(file);
    if (!from) return {};
    const allowed = allowedPairs(context.options[0]?.allow);
    const check = (node, spec) => {
      const to = targetOf(file, spec);
      if (!to || to === from || allowed.has(`${from}>${to}`)) return;
      context.report({ node, messageId: 'cross', data: { from, to, spec } });
    };
    const fromSource = (node) => node.source && check(node.source, node.source.value);
    return {
      ImportDeclaration: fromSource,
      ExportNamedDeclaration: fromSource,
      ExportAllDeclaration: fromSource,
      ImportExpression(node) {
        if (node.source.type === 'Literal') check(node.source, node.source.value);
      },
      CallExpression(node) {
        const c = node.callee;
        const name = c.type === 'MemberExpression' ? `${c.object.name}.${c.property.name}` : c.name;
        if (['vi.mock', 'vi.doMock', 'require'].includes(name) && node.arguments[0]?.type === 'Literal') check(node.arguments[0], node.arguments[0].value);
      },
    };
  },
};

export default { rules: { 'no-module-imports': noModuleImports } };

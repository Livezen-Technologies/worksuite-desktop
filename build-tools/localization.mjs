import ts from 'typescript';
import MagicString from 'magic-string';
import { dirname, relative, resolve } from 'node:path';

const attributes = new Set([
  'label',
  'title',
  'placeholder',
  'aria-label',
  'alt',
  'description',
  'hint',
  'tooltip',
  'emptyText',
  'confirmLabel',
  'cancelLabel',
  'heading',
  'emptyLabel',
  'loadingLabel',
]);
const fields = new Set(['label', 'title', 'placeholder', 'hint', 'tooltip', 'emptyText', 'confirmLabel', 'cancelLabel', 'heading', 'text', 'description']);
const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' };
const decode = (s) =>
  s.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (m, name) =>
    name[0] === '#' ? String.fromCodePoint(parseInt(name.slice(name[1].toLowerCase() === 'x' ? 2 : 1), name[1].toLowerCase() === 'x' ? 16 : 10)) : (entities[name] ?? m),
  );
const eligible = (s) => /[a-zA-Z]{2}/.test(s) && !/^https?:|^app:\/\//.test(s) && !/^(WorkSuite|PDF|CSV|API|CRM|HR|AI|PIN|Touch ID|HTTPS)$/.test(s);
/** Match JSX whitespace rules: indentation is not interface text; deliberate same-line spaces remain. */
function jsxText(value) {
  const lines = value.replace(/\t/g, ' ').split(/\r\n|\n|\r/);
  let last = -1;
  lines.forEach((line, i) => {
    if (/[^ ]/.test(line)) last = i;
  });
  return lines
    .map((line, i) => {
      if (i > 0) line = line.replace(/^ +/, '');
      if (i < lines.length - 1) line = line.replace(/ +$/, '');
      return line && i < last ? line + ' ' : line;
    })
    .join('');
}
export function localizationEdits(code, id) {
  const source = ts.createSourceFile(id, code, ts.ScriptTarget.Latest, true, id.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const edits = [],
    messages = [];
  const seen = new Set();
  function add(node, text, replacement) {
    if (!eligible(text) || seen.has(node.pos)) return;
    seen.add(node.pos);
    edits.push({ start: ts.isJsxText(node) ? node.pos : node.getStart(source), end: node.end, text: replacement(text) });
    messages.push({ source: text, line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1 });
  }
  const call = (text) => `__wsText(${JSON.stringify(text)})`;
  function expression(node, jsx = false) {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) add(node, node.text, (text) => (jsx ? `{${call(text)}}` : call(text)));
    else if (ts.isConditionalExpression(node)) {
      expression(node.whenTrue);
      expression(node.whenFalse);
    } else if (ts.isTemplateExpression(node)) {
      let template = node.head.text;
      const vars = [];
      node.templateSpans.forEach((span, i) => {
        template += `{v${i}}` + span.literal.text;
        vars.push(`v${i}: ${span.expression.getText(source)}`);
      });
      add(node, template, (text) => `__wsText(${JSON.stringify(text)}, {${vars.join(', ')}})`);
    }
    // Dynamic record fields alone are never catalog lookups.
  }
  function visit(node) {
    if (ts.isJsxText(node)) add(node, decode(jsxText(node.text)), (text) => `{${call(text)}}`);
    else if (ts.isJsxAttribute(node) && attributes.has(node.name.getText(source)) && node.initializer) {
      if (ts.isStringLiteral(node.initializer)) add(node.initializer, decode(node.initializer.text), (text) => `{${call(text)}}`);
      else if (ts.isJsxExpression(node.initializer) && node.initializer.expression) expression(node.initializer.expression);
    } else if (ts.isJsxExpression(node) && !ts.isJsxAttribute(node.parent) && node.expression) expression(node.expression);
    else if (ts.isPropertyAssignment(node) && fields.has(node.name.getText(source).replace(/^['"]|['"]$/g, '')) && ts.isStringLiteral(node.initializer)) {
      // Getters read the current language; module-level options are never frozen in the startup language.
      add(
        node,
        node.initializer.text,
        (text) =>
          `get ${node.name.getText(source)}() { return ${call(text)}; }, set ${node.name.getText(source)}(value) { Object.defineProperty(this, ${JSON.stringify(node.name.getText(source).replace(/^['"]|['"]$/g, ''))}, { value, writable: true, enumerable: true, configurable: true }); }`,
      );
    } else if (ts.isCallExpression(node) && node.expression.getText(source) === 'toast' && node.arguments[1]) expression(node.arguments[1]);
    else if (ts.isNewExpression(node) && node.expression.getText(source) === 'Error' && node.arguments?.[0]) expression(node.arguments[0]);
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      /^toLocale(?:Date|Time)?String$/.test(node.expression.name.text) &&
      (!node.arguments.length || node.arguments[0].getText(source) === 'undefined' || node.arguments[0].getText(source) === '[]')
    ) {
      if (node.arguments.length) edits.push({ start: node.arguments[0].getStart(source), end: node.arguments[0].end, text: '__wsLocale()' });
      else edits.push({ start: node.end - 1, end: node.end - 1, text: '__wsLocale()' });
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return { edits, messages, source };
}
export function transformLocalization(code, id, corePath) {
  const { edits, messages, source } = localizationEdits(code, id);
  if (!edits.length) return null;
  const out = new MagicString(code);
  const outer = edits.filter(
    (edit) => !edits.some((other) => other !== edit && other.start <= edit.start && other.end >= edit.end && (other.start < edit.start || other.end > edit.end)),
  );
  for (const edit of outer) {
    if (edit.start === edit.end) out.appendLeft(edit.start, edit.text);
    else out.overwrite(edit.start, edit.end, edit.text);
  }
  // Component subscriptions rerender memoized views too, without remounting or losing in-progress input.
  function subscribe(node) {
    const name = ts.isFunctionDeclaration(node)
      ? node.name?.text
      : (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) && ts.isVariableDeclaration(node.parent)
        ? node.parent.name.getText(source)
        : null;
    if (name && /^[A-Z]/.test(name) && node.body && ts.isBlock(node.body)) {
      let jsx = false;
      function contains(child) {
        if (child !== node.body && (ts.isFunctionDeclaration(child) || ts.isArrowFunction(child) || ts.isFunctionExpression(child))) return;
        if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child) || ts.isJsxFragment(child)) jsx = true;
        else ts.forEachChild(child, contains);
      }
      contains(node.body);
      if (jsx) out.appendLeft(node.body.getStart(source) + 1, '\n  __wsLanguage();\n');
    }
    ts.forEachChild(node, subscribe);
  }
  subscribe(source);
  let importPath = relative(dirname(id), corePath).replaceAll('\\', '/');
  if (!importPath.startsWith('.')) importPath = './' + importPath;
  out.prepend(`import { text as __wsText, useLanguage as __wsLanguage, currentLocale as __wsLocale } from ${JSON.stringify(importPath)};\n`);
  return { code: out.toString(), map: out.generateMap({ hires: true, source: id, includeContent: true }), messages };
}
/** Explicit source-level UI literals only. Never walk or rewrite the DOM, user input, fetched data or rich text. */
export function localizationPlugin(root) {
  const src = resolve(root, 'src').replaceAll('\\', '/');
  return {
    name: 'worksuite-localization',
    enforce: 'pre',
    transform(code, rawId) {
      const id = rawId.split('?')[0];
      if (!id.startsWith(src + '/') || !/\.tsx?$/.test(id) || id.includes('/core/') || /\/i18n\.ts$/.test(id)) return null;
      return transformLocalization(code, id, resolve(src, 'core/i18n'));
    },
  };
}

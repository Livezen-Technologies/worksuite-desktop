/**
 * The little Markdown an assistant answers in (worksuite-desktop#150): paragraphs, headings, bullet and numbered lists
 * (nested by indent), quotes, code, rules, **bold**, *italic*, ~~struck~~, `code` and [links](https://…).
 *
 * It is parsed to a tree of plain values, never to HTML: what draws it (components/Markdown) makes React elements from
 * the tree, so nothing in an answer can become markup, a script or a style. A link is only ever http(s), and opens the
 * way every other link in WorkSuite does.
 */

export type MdInline =
  | { t: 'text'; v: string }
  | { t: 'code'; v: string }
  | { t: 'strong' | 'em' | 'del'; c: MdInline[] }
  | { t: 'link'; href: string; c: MdInline[] };

export interface MdItem {
  c: MdInline[];
  sub: MdList | null;
}

export interface MdList {
  t: 'list';
  ordered: boolean;
  start: number;
  items: MdItem[];
}

export type MdBlock =
  | { t: 'p'; lines: MdInline[][] }
  | { t: 'h'; level: number; c: MdInline[] }
  | MdList
  | { t: 'code'; v: string }
  | { t: 'quote'; c: MdBlock[] }
  | { t: 'hr' };

const FENCE = /^\s*(```|~~~)/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const RULE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const ITEM = /^(\s*)([-*+•]|\d{1,9}[.)])\s+(.*)$/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;

/** Inline marks, earliest first: code, bold, struck, a link, then italic. Underscores only between words' edges. */
const INLINE = /(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)|\*\*(?=\S)([\s\S]*?\S)\*\*|__(?=\S)([\s\S]*?\S)__(?!\w)|~~(?=\S)([\s\S]*?\S)~~|\[([^\]\n]+)\]\(\s*([^)\s]+)\s*\)|\*(?=[^\s*])([^*\n]*?[^\s*])\*|(?<![\w_])_(?=[^\s_])([^_\n]*?[^\s_])_(?![\w_])/;

/** Only a web address is ever a link. */
export function safeHref(href: string): string | null {
  try {
    const u = new URL(href);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
  } catch {
    return null;
  }
}

export function parseInline(src: string): MdInline[] {
  const out: MdInline[] = [];
  const text = (v: string) => {
    if (!v) return;
    const last = out.at(-1);
    if (last?.t === 'text') last.v += v;
    else out.push({ t: 'text', v });
  };
  let rest = src;
  for (;;) {
    const m = INLINE.exec(rest);
    if (!m) break;
    text(rest.slice(0, m.index));
    if (m[1] !== undefined) out.push({ t: 'code', v: m[2]!.length > 2 && m[2]!.startsWith(' ') && m[2]!.endsWith(' ') ? m[2]!.slice(1, -1) : m[2]! });
    else if (m[3] !== undefined || m[4] !== undefined) out.push({ t: 'strong', c: parseInline((m[3] ?? m[4])!) });
    else if (m[5] !== undefined) out.push({ t: 'del', c: parseInline(m[5]) });
    else if (m[6] !== undefined) {
      const href = safeHref(m[7]!);
      if (href) out.push({ t: 'link', href, c: parseInline(m[6]) });
      else text(m[6]);
    } else out.push({ t: 'em', c: parseInline((m[8] ?? m[9])!) });
    rest = rest.slice(m.index + m[0].length);
  }
  text(rest);
  return out;
}

const indentOf = (s: string) => s.replace(/\t/g, '    ').length;

/** A run of list lines into a list, deeper indents into lists of their own under the item before them. */
function parseList(lines: string[]): MdList {
  const first = ITEM.exec(lines[0]!)!;
  const ordered = /\d/.test(first[2]!);
  const list: MdList = { t: 'list', ordered, start: ordered ? Number.parseInt(first[2]!, 10) : 1, items: [] };
  const base = indentOf(first[1]!);
  let i = 0;
  while (i < lines.length) {
    const m = ITEM.exec(lines[i]!);
    if (!m) {
      // A line carrying on the item before it.
      const last = list.items.at(-1);
      if (last) last.c.push({ t: 'text', v: ' ' }, ...parseInline(lines[i]!.trim()));
      i++;
      continue;
    }
    if (indentOf(m[1]!) > base && list.items.length) {
      const deeper: string[] = [];
      while (i < lines.length) {
        const d = ITEM.exec(lines[i]!);
        if (d && indentOf(d[1]!) <= base) break;
        deeper.push(lines[i]!);
        i++;
      }
      const last = list.items.at(-1)!;
      // Only one list under an item: a second run joins the first.
      const sub = parseList(deeper);
      if (last.sub) last.sub.items.push(...sub.items);
      else last.sub = sub;
      continue;
    }
    list.items.push({ c: parseInline(m[3]!), sub: null });
    i++;
  }
  return list;
}

export function parseMarkdown(src: string): MdBlock[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const blocks: MdBlock[] = [];
  let para: string[] = [];
  const endPara = () => {
    if (para.length) blocks.push({ t: 'p', lines: para.map((l) => parseInline(l.trim())) });
    para = [];
  };
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim()) {
      endPara();
      i++;
      continue;
    }
    const fence = FENCE.exec(line);
    if (fence) {
      endPara();
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.trim().startsWith(fence[1]!)) code.push(lines[i++]!);
      i++;
      blocks.push({ t: 'code', v: code.join('\n') });
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      endPara();
      blocks.push({ t: 'h', level: heading[1]!.length, c: parseInline(heading[2]!) });
      i++;
      continue;
    }
    if (RULE.test(line)) {
      endPara();
      blocks.push({ t: 'hr' });
      i++;
      continue;
    }
    if (ITEM.test(line)) {
      endPara();
      const run: string[] = [];
      const head = ITEM.exec(line)!;
      const base = indentOf(head[1]!);
      const ordered = /\d/.test(head[2]!);
      // Another kind of list at the same depth is a list of its own.
      const sameList = (l: string) => {
        const m = ITEM.exec(l);
        return !!m && (indentOf(m[1]!) > base || /\d/.test(m[2]!) === ordered);
      };
      // The list goes on through its items, the lines carrying them on, and single blank lines between items.
      while (i < lines.length) {
        const l = lines[i]!;
        if (ITEM.test(l) && !sameList(l)) break;
        if (ITEM.test(l) || (l.trim() && /^\s/.test(l) && run.length)) run.push(l);
        else if (!l.trim() && i + 1 < lines.length && sameList(lines[i + 1]!)) {
          /* a blank line between items */
        } else break;
        i++;
      }
      blocks.push(parseList(run));
      continue;
    }
    if (QUOTE.test(line)) {
      endPara();
      const quoted: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i]!)) quoted.push(QUOTE.exec(lines[i++]!)![1]!);
      blocks.push({ t: 'quote', c: parseMarkdown(quoted.join('\n')) });
      continue;
    }
    para.push(line);
    i++;
  }
  endPara();
  return blocks;
}

function inlinePlain(c: MdInline[]): string {
  return c.map((x) => (x.t === 'text' || x.t === 'code' ? x.v : inlinePlain(x.c))).join('');
}

function blockPlain(b: MdBlock): string[] {
  switch (b.t) {
    case 'p':
      return b.lines.map(inlinePlain);
    case 'h':
      return [inlinePlain(b.c)];
    case 'code':
      return b.v.split('\n');
    case 'quote':
      return b.c.flatMap(blockPlain);
    case 'hr':
      return [];
    case 'list':
      return b.items.flatMap((it, n) => [`${b.ordered ? `${b.start + n}.` : '•'} ${inlinePlain(it.c)}`, ...(it.sub ? blockPlain(it.sub) : [])]);
  }
}

/** The words of an answer without its marks, a line per line: for a preview that cannot draw them. */
export function markdownPlain(src: string): string {
  return parseMarkdown(src).flatMap(blockPlain).join('\n');
}

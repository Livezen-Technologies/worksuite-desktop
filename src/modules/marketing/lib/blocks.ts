import type { Block } from '../api';
import { blockTexts, renderMerge } from './merge';

/**
 * The email editor's block model (MKT-EDT-01): text, image, button, columns, divider and footer blocks; the three
 * starter layouts; the plain-text version; and the one HTML sanitiser every preview goes through. Pure functions —
 * no DOM — so they run in the editor, the previews and the node tests alike.
 */

export type BlockType = Block['type'];
export type ImageBlock = Extract<Block, { type: 'image' }>;

let seq = 0;

/** A block id unique within a campaign's content (and in practice everywhere). */
export function blockId(): string {
  seq += 1;
  return `b${Date.now().toString(36)}${seq.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** The footer every starter carries: the postal address, the preference centre and the unsubscribe link. */
export const FOOTER_HTML =
  '<p>{{sender_name}} · {{company_address}}</p><p>You receive this because you subscribed to our updates. <a href="{{preferences_url}}">Manage preferences</a> · <a href="{{unsubscribe_url}}">Unsubscribe</a></p>';

/** A new, empty block of a kind (the palette's click). */
export function newBlock(type: BlockType): Block {
  const id = blockId();
  switch (type) {
    case 'text':
      return { id, type, html: '' };
    case 'image':
      return { id, type, src: null, alt: '', link: null, width: 'full' };
    case 'button':
      return { id, type, label: 'Read more', url: '', align: 'left' };
    case 'columns':
      return { id, type, left: '', right: '' };
    case 'divider':
      return { id, type };
    case 'footer':
      return { id, type, html: FOOTER_HTML };
  }
}

export interface Starter {
  /** What `createCampaign({ starter })` names. */
  id: 'newsletter' | 'announcement' | 'plain';
  label: string;
  description: string;
  blocks: Block[];
}

/** The three starter layouts (MKT-EDT-01, WF-06 step 3). Each ends with the footer and its required tags. */
export const STARTERS: readonly Starter[] = [
  {
    id: 'newsletter',
    label: 'Newsletter',
    description: 'A headline, a picture, the main story with a button, two short ones side by side.',
    blocks: [
      { id: 'nl-head', type: 'text', html: '<h1>{{sender_name}} news</h1><p>Hi {{first_name|there}}, here is what is new this month.</p>' },
      { id: 'nl-hero', type: 'image', src: null, alt: '', link: null, width: 'full' },
      { id: 'nl-story', type: 'text', html: '<h2>The main story</h2><p>Say what happened and why it matters to the reader.</p>' },
      { id: 'nl-cta', type: 'button', label: 'Read more', url: '', align: 'left' },
      { id: 'nl-rule', type: 'divider' },
      { id: 'nl-cols', type: 'columns', left: '<h3>Also new</h3><p>A second, shorter story.</p>', right: '<h3>Coming up</h3><p>A date or an event worth noting.</p>' },
      { id: 'nl-foot', type: 'footer', html: FOOTER_HTML },
    ],
  },
  {
    id: 'announcement',
    label: 'Announcement',
    description: 'One picture, one message, one button.',
    blocks: [
      { id: 'an-hero', type: 'image', src: null, alt: '', link: null, width: 'full' },
      { id: 'an-text', type: 'text', html: '<h1>Your news in one line</h1><p>Hi {{first_name|there}},</p><p>Say what is new, who it is for and what to do next.</p>' },
      { id: 'an-cta', type: 'button', label: 'Find out more', url: '', align: 'center' },
      { id: 'an-foot', type: 'footer', html: FOOTER_HTML },
    ],
  },
  {
    id: 'plain',
    label: 'Plain letter',
    description: 'Text only, like a personal email. Reads well everywhere.',
    blocks: [
      { id: 'pl-text', type: 'text', html: '<p>Hi {{first_name|there}},</p><p>Write your letter here.</p><p>Kind regards,<br>{{sender_name}}</p>' },
      { id: 'pl-foot', type: 'footer', html: FOOTER_HTML },
    ],
  },
];

/** The same blocks with fresh ids, for a new campaign's copy. */
export function cloneBlocks(blocks: readonly Block[]): Block[] {
  return blocks.map((b) => ({ ...b, id: blockId() }));
}

const KINDS: ReadonlySet<string> = new Set<BlockType>(['text', 'image', 'button', 'columns', 'divider', 'footer']);

/** Blocks as the server sent them, keeping only ones this editor knows how to show (a null list is none). */
export function asBlocks(v: unknown): Block[] {
  if (!Array.isArray(v)) return [];
  return v.filter((b): b is Block => !!b && typeof b === 'object' && typeof (b as { id?: unknown }).id === 'string' && KINDS.has(String((b as { type?: unknown }).type)));
}

/* ------------------------------------------------------------------------ *
 * Editing
 * ------------------------------------------------------------------------ */

/** Inserts after the block with `afterId`, or at the end when there is none. */
export function insertBlock(blocks: readonly Block[], afterId: string | null, block: Block): Block[] {
  const at = afterId === null ? -1 : blocks.findIndex((b) => b.id === afterId);
  return at < 0 ? [...blocks, block] : [...blocks.slice(0, at + 1), block, ...blocks.slice(at + 1)];
}

export function moveBlock(blocks: readonly Block[], id: string, dir: 'up' | 'down'): Block[] {
  const i = blocks.findIndex((b) => b.id === id);
  const j = dir === 'up' ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= blocks.length) return [...blocks];
  const out = [...blocks];
  [out[i], out[j]] = [out[j]!, out[i]!];
  return out;
}

export function removeBlock(blocks: readonly Block[], id: string): Block[] {
  return blocks.filter((b) => b.id !== id);
}

type Fields<B> = B extends Block ? Partial<Omit<B, 'id' | 'type'>> : never;
/** The fields of one kind of block, any of them. */
export type BlockPatch = Fields<Block>;

/** Changes some fields of one block; its kind and id stay. */
export function patchBlock(blocks: readonly Block[], id: string, patch: BlockPatch): Block[] {
  return blocks.map((b) => (b.id === id ? ({ ...b, ...patch, id: b.id, type: b.type } as Block) : b));
}

/** Every text a merge tag may live in, across the blocks. */
export function textsOf(blocks: readonly Block[]): string[] {
  return blocks.flatMap(blockTexts);
}

/** Images without alt text (MKT-EDT-05: a warning, for screen readers and blocked images). */
export function imagesWithoutAlt(blocks: readonly Block[]): ImageBlock[] {
  return blocks.filter((b): b is ImageBlock => b.type === 'image' && b.alt.trim() === '');
}

/* ------------------------------------------------------------------------ *
 * HTML: a small tag-whitelist pass, no DOM
 * ------------------------------------------------------------------------ */

type Tok = { t: 'text'; v: string } | { t: 'open'; name: string; attrs: Array<[string, string]>; self: boolean } | { t: 'close'; name: string };

/** Elements whose content is not markup: skipped to their end tag. */
const RAW = new Set(['script', 'style', 'textarea', 'title', 'xmp', 'iframe', 'noembed', 'noframes', 'noscript', 'plaintext']);
/** Elements dropped with everything inside them. */
const DROP = new Set(['template', 'object', 'applet', 'svg', 'math', 'head', 'select', 'frameset', 'audio', 'video', 'canvas', 'map', 'picture']);
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'frame', 'hr', 'img', 'input', 'keygen', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const ALLOWED = new Set(['p', 'br', 'b', 'strong', 'i', 'em', 'u', 'a', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'span']);
const BLOCKS = new Set(['p', 'h1', 'h2', 'h3', 'ul', 'ol', 'li']);

const NAME = /[a-zA-Z][a-zA-Z0-9:-]*/y;
const ATTR = /[^\s/>=]+/y;
const EQ = /\s*=\s*/y;
const UNQUOTED = /[^\s>]+/y;
const SPACE = /\s/;

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  const n = src.length;
  let text = '';
  let i = 0;
  const push = (tok: Tok) => {
    if (text) out.push({ t: 'text', v: text });
    text = '';
    out.push(tok);
  };
  while (i < n) {
    const lt = src.indexOf('<', i);
    if (lt < 0) {
      text += src.slice(i);
      break;
    }
    text += src.slice(i, lt);
    i = lt;
    if (src.startsWith('<!--', i)) {
      const e = src.indexOf('-->', i + 4);
      i = e < 0 ? n : e + 3;
      continue;
    }
    const next = src[i + 1] ?? '';
    if (next === '!' || next === '?') {
      const e = src.indexOf('>', i + 2);
      i = e < 0 ? n : e + 1;
      continue;
    }
    const closing = next === '/';
    NAME.lastIndex = i + (closing ? 2 : 1);
    const m = NAME.exec(src);
    if (!m) {
      if (closing) {
        // `</ …>` that names nothing: a bogus comment to a browser.
        const e = src.indexOf('>', i + 2);
        i = e < 0 ? n : e + 1;
      } else {
        text += '<';
        i += 1;
      }
      continue;
    }
    const name = m[0].toLowerCase();
    let j = i + (closing ? 2 : 1) + m[0].length;
    const attrs: Array<[string, string]> = [];
    let self = false;
    let ended = false;
    while (j < n) {
      const ch = src[j]!;
      if (ch === '>') {
        j += 1;
        ended = true;
        break;
      }
      if (ch === '/') {
        if (src[j + 1] === '>') {
          self = true;
          j += 2;
          ended = true;
          break;
        }
        j += 1;
        continue;
      }
      if (SPACE.test(ch)) {
        j += 1;
        continue;
      }
      ATTR.lastIndex = j;
      const a = ATTR.exec(src);
      if (!a) {
        j += 1;
        continue;
      }
      j += a[0].length;
      let value = '';
      EQ.lastIndex = j;
      const eq = EQ.exec(src);
      if (eq) {
        j += eq[0].length;
        const q = src[j];
        if (q === '"' || q === "'") {
          const e = src.indexOf(q, j + 1);
          if (e < 0) {
            j = n;
            break;
          }
          value = src.slice(j + 1, e);
          j = e + 1;
        } else {
          UNQUOTED.lastIndex = j;
          const u = UNQUOTED.exec(src);
          if (u) {
            value = u[0];
            j += u[0].length;
          }
        }
      }
      attrs.push([a[0].toLowerCase(), value]);
    }
    // A tag the input ends inside is dropped, as a browser drops it.
    if (!ended) break;
    i = j;
    if (closing) {
      push({ t: 'close', name });
      continue;
    }
    push({ t: 'open', name, attrs, self });
    if (RAW.has(name)) {
      const end = new RegExp(`</${name}(?=[\\s/>])`, 'ig');
      end.lastIndex = i;
      const e = end.exec(src);
      if (!e) break;
      i = e.index;
    }
  }
  if (text) out.push({ t: 'text', v: text });
  return out;
}

const NAMED: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** `&amp;`, `&#106;`, `&#x6A;` and the few names that matter here; anything else stays as written. */
export function decodeEntities(s: string): string {
  return s.replace(/&(#[xX][0-9a-fA-F]+|#[0-9]+|[a-zA-Z][a-zA-Z0-9]*);?/g, (m, body: string) => {
    if (body.startsWith('#')) {
      const hex = body[1] === 'x' || body[1] === 'X';
      const cp = parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : '�';
    }
    const key = body.toLowerCase();
    return Object.hasOwn(NAMED, key) ? NAMED[key]! : m;
  });
}

const escapeText = (s: string) => s.replace(/&(?![a-zA-Z][a-zA-Z0-9]{0,31};|#[0-9]{1,7};|#[xX][0-9a-fA-F]{1,6};)/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escapeAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** A link the email may carry: http, https, mailto, or exactly one merge tag (`{{unsubscribe_url}}`). */
const MERGE_ONLY = /^\{\{\s*[A-Za-z0-9_]+\s*(\|[^{}]*)?\}\}$/;

export function safeUrl(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const v = decodeEntities(raw).trim();
  // Control characters and spaces cannot hide a scheme from this test.
  // eslint-disable-next-line no-control-regex
  const bare = v.replace(/[\u0000- \u007f-\u009f]+/g, '');
  if (/^(https?:\/\/|mailto:)/i.test(bare)) return v;
  return MERGE_ONLY.test(v) ? v : null;
}

function clean(src: string, mark?: (escaped: string) => string): string {
  let out = '';
  const open: string[] = [];
  const dropping: string[] = [];
  for (const tok of tokenize(src)) {
    if (dropping.length) {
      if (tok.t === 'open' && DROP.has(tok.name) && !tok.self) dropping.push(tok.name);
      else if (tok.t === 'close' && dropping.includes(tok.name)) dropping.length = dropping.lastIndexOf(tok.name);
      continue;
    }
    if (tok.t === 'text') {
      const e = escapeText(tok.v);
      out += mark ? mark(e) : e;
    } else if (tok.t === 'open') {
      if (DROP.has(tok.name)) {
        if (!tok.self && !VOID.has(tok.name)) dropping.push(tok.name);
      } else if (tok.name === 'br') {
        out += '<br>';
      } else if (ALLOWED.has(tok.name)) {
        // As a browser does: a new item ends the open one, a new block ends an open paragraph.
        const top = open[open.length - 1];
        if ((tok.name === 'li' && top === 'li') || (top === 'p' && BLOCKS.has(tok.name))) out += `</${open.pop()!}>`;
        if (tok.name === 'a') {
          const href = safeUrl(tok.attrs.find(([k]) => k === 'href')?.[1]);
          out += href === null ? '<a>' : `<a href="${escapeAttr(href)}">`;
        } else out += `<${tok.name}>`;
        if (tok.self) out += `</${tok.name}>`;
        else open.push(tok.name);
      }
    } else if (ALLOWED.has(tok.name) && open.includes(tok.name)) {
      // Closes what is still open inside it, so the result always nests.
      while (open.length) {
        const top = open.pop()!;
        out += `</${top}>`;
        if (top === tok.name) break;
      }
    }
  }
  while (open.length) out += `</${open.pop()!}>`;
  return out;
}

/**
 * The only HTML an email block may hold: p, br, b, strong, i, em, u, a, ul, ol, li, h1–h3 and span, with no
 * attribute but a link's `href` (http, https, mailto or a merge tag). Script and style go with their content; every
 * other tag goes and its text stays. Text in any script — Sinhala, Tamil — is kept as written.
 */
export function sanitize(html: string | null | undefined): string {
  return html ? clean(html) : '';
}

/**
 * Sanitised HTML with its merge tags marked for the editor's canvas: known tags in the accent, unknown ones in red.
 * The marks are this function's own spans, added to text only — never inside a link's address.
 */
export function markTags(html: string | null | undefined, known: ReadonlySet<string>): string {
  if (!html) return '';
  return clean(html, (escaped) =>
    escaped.replace(/\{\{([^{}]*)\}\}/g, (m, body: string) => {
      const tag = body.split('|')[0]!.trim();
      return known.has(tag)
        ? `<span class="rounded-[4px] bg-selection px-0.5 font-mono text-[0.92em] text-primary">${m}</span>`
        : `<span class="rounded-[4px] bg-danger-bg px-0.5 font-mono text-[0.92em] text-danger underline decoration-wavy" title="Not in the merge-tag list: blocks sending">${m}</span>`;
    }),
  );
}

/* ------------------------------------------------------------------------ *
 * Plain text
 * ------------------------------------------------------------------------ */

/** One block's HTML as plain text: paragraphs apart, list items on their own lines, a link's address after it. */
export function htmlToText(html: string | null | undefined): string {
  if (!html) return '';
  let out = '';
  const lists: Array<{ ordered: boolean; n: number }> = [];
  let href: string | null = null;
  let linkAt = 0;
  const gap = (lines: number) => {
    if (!out) return;
    out = out.replace(/[ \t]+$/, '');
    const have = /\n*$/.exec(out)?.[0].length ?? 0;
    if (have < lines) out += '\n'.repeat(lines - have);
  };
  for (const tok of tokenize(clean(html))) {
    if (tok.t === 'text') {
      const s = decodeEntities(tok.v).replace(/\s+/g, ' ');
      // A line never starts with the space that followed a tag or a line break in the source.
      out += !out || out.endsWith('\n') || out.endsWith(' ') ? s.replace(/^ /, '') : s;
    } else if (tok.t === 'open') {
      if (tok.name === 'br') out += '\n';
      else if (tok.name === 'p' || tok.name === 'h1' || tok.name === 'h2' || tok.name === 'h3') gap(2);
      else if (tok.name === 'ul' || tok.name === 'ol') {
        gap(lists.length ? 1 : 2);
        lists.push({ ordered: tok.name === 'ol', n: 0 });
      } else if (tok.name === 'li') {
        gap(1);
        const l = lists[lists.length - 1];
        out += '  '.repeat(Math.max(0, lists.length - 1)) + (l?.ordered ? `${(l.n += 1)}. ` : '- ');
      } else if (tok.name === 'a') {
        href = tok.attrs.find(([k]) => k === 'href')?.[1] ?? null;
        href = href === null ? null : decodeEntities(href);
        linkAt = out.length;
      }
    } else if (tok.name === 'p' || tok.name === 'h1' || tok.name === 'h2' || tok.name === 'h3') gap(2);
    else if (tok.name === 'ul' || tok.name === 'ol') {
      lists.pop();
      gap(lists.length ? 1 : 2);
    } else if (tok.name === 'li') gap(1);
    else if (tok.name === 'a' && href !== null) {
      const label = out.slice(linkAt).trim();
      if (!label) out += href;
      else if (label !== href) out += ` (${href})`;
      href = null;
    }
  }
  return out
    .split('\n')
    .map((l) => l.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * The plain-text version sent with the HTML (and the editor's Plain text preview). Without `values` the merge tags
 * stay in it, for the server to fill per recipient; with them it reads as one recipient would.
 */
export function blocksToPlainText(blocks: readonly Block[], values?: Readonly<Record<string, string | null | undefined>>): string {
  const parts = blocks.map((b): string => {
    switch (b.type) {
      case 'text':
      case 'footer':
        return htmlToText(b.html);
      case 'columns':
        return [htmlToText(b.left), htmlToText(b.right)].filter(Boolean).join('\n\n');
      case 'image': {
        const alt = b.alt.trim();
        return alt ? `[${alt}]${b.link ? ` (${b.link})` : ''}` : '';
      }
      case 'button':
        return b.url.trim() ? `${b.label}: ${b.url.trim()}` : b.label;
      case 'divider':
        return '---';
    }
  });
  const text = parts.filter((p) => p.trim() !== '').join('\n\n');
  return values ? renderMerge(text, values) : text;
}

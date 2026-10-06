/**
 * Captions as the networks count and cut them (SMM-CMP-003/004, NFR-12, AC-04, AC-18).
 *
 * Text is normalised to NFC first, as the networks do, so a Sinhala or Tamil word typed with combining marks counts
 * the same however it was entered. Most networks count Unicode code points. X weighs them (its open-source
 * twitter-text rules, v3): a code point in the Latin-to-Indic ranges and the general punctuation it lists weighs 1,
 * anything else 2, an emoji (one whole grapheme, skin tone and ZWJ joins included) 2, and every link 23 however long.
 * Sinhala (U+0D80–0DFF) and Tamil (U+0B80–0BFF) sit inside the weight-1 range.
 */
import type { CountingRule } from './networks';

/** Every link X shortens counts as this many characters. */
export const X_LINK_WEIGHT = 23;

/** twitter-text v3: code point ranges that weigh 1; everything else weighs 2. */
const X_LIGHT_RANGES: Array<[number, number]> = [
  [0, 4351],
  [8192, 8205],
  [8208, 8223],
  [8242, 8247],
];

const EMOJI = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u;

/**
 * Links in a caption: with a scheme, starting `www.`, or a bare domain on a common top-level domain (`wks.lk/32-launch`)
 * — what the networks turn into links. An e-mail address is not one.
 */
const LINK = /(?<![@\w.])(?:https?:\/\/[^\s<>"]+|www\.[^\s<>"]+|(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:com|net|org|io|co|lk|in|uk|us|app|dev|me|ly|gl|gg|info|biz|ai|cloud|link|page|site|online|store|shop|tech|xyz)(?![a-z0-9-])(?:\/[^\s<>"]*)?)/giu;

function trimLinkEnd(url: string): string {
  // Sentence punctuation after a link is not part of it ("…see wks.lk/launch.").
  return url.replace(/[.,;:!?)\]}'"»”’]+$/u, '');
}

export function findLinks(text: string): Array<{ url: string; start: number; end: number }> {
  const out: Array<{ url: string; start: number; end: number }> = [];
  for (const m of text.matchAll(LINK)) {
    const url = trimLinkEnd(m[0]);
    if (!url) continue;
    out.push({ url, start: m.index, end: m.index + url.length });
  }
  return out;
}

let segmenter: Intl.Segmenter | null | undefined;
function graphemes(text: string): string[] {
  if (segmenter === undefined) segmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
  if (!segmenter) return [...text];
  return Array.from(segmenter.segment(text), (s) => s.segment);
}

function codePointWeight(cp: number): number {
  for (const [a, b] of X_LIGHT_RANGES) if (cp >= a && cp <= b) return 1;
  return 2;
}

/** X's weighted length of plain text (no links in it). */
function xPlainWeight(text: string): number {
  let n = 0;
  for (const g of graphemes(text)) {
    if (EMOJI.test(g)) {
      n += 2;
      continue;
    }
    for (const ch of g) n += codePointWeight(ch.codePointAt(0)!);
  }
  return n;
}

/** A caption's length as the network counts it. */
export function countText(text: string, rule: CountingRule): number {
  const t = text.normalize('NFC');
  if (rule === 'code_points') return [...t].length;
  let n = 0;
  let at = 0;
  for (const l of findLinks(t)) {
    n += xPlainWeight(t.slice(at, l.start)) + X_LINK_WEIGHT;
    at = l.end;
  }
  return n + xPlainWeight(t.slice(at));
}

/** The numbering a thread part carries: " (1/3)". */
export function partSuffix(i: number, n: number): string {
  return ` (${i}/${n})`;
}

/** Pieces a caption may be cut at, best first: paragraphs, then sentences, then words. */
function pieces(text: string): string[] {
  const out: string[] = [];
  for (const para of text.split(/(\n{2,})/)) {
    if (/^\n+$/.test(para)) {
      out.push(para);
      continue;
    }
    // Sentence ends: . ! ? and the Sinhala/Tamil full stop forms, followed by space.
    for (const s of para.split(/(?<=[.!?។।])(\s+)/u)) if (s) out.push(s);
  }
  return out;
}

function splitWords(piece: string, limit: number, rule: CountingRule): string[] {
  const words = piece.split(/(\s+)/);
  const out: string[] = [];
  let cur = '';
  for (const w of words) {
    if (!w) continue;
    if (countText(cur + w, rule) <= limit) {
      cur += w;
      continue;
    }
    if (cur.trim()) out.push(cur);
    cur = /^\s+$/.test(w) ? '' : w;
    // A single word longer than a whole part (a long hash or a run of Sinhala without spaces): cut by grapheme.
    while (countText(cur, rule) > limit) {
      const gs = graphemes(cur);
      let head = '';
      for (const g of gs) {
        if (countText(head + g, rule) > limit) break;
        head += g;
      }
      if (!head) break;
      out.push(head);
      cur = cur.slice(head.length);
    }
  }
  if (cur.trim()) out.push(cur);
  return out;
}

function pack(text: string, limit: number, rule: CountingRule): string[] {
  const parts: string[] = [];
  let cur = '';
  for (const p of pieces(text)) {
    if (countText(cur + p, rule) <= limit) {
      cur += p;
      continue;
    }
    if (cur.trim()) parts.push(cur.trim());
    cur = '';
    if (countText(p.trim(), rule) <= limit) {
      cur = /^\s+$/.test(p) ? '' : p;
      continue;
    }
    const words = splitWords(p, limit, rule);
    parts.push(...words.slice(0, -1).map((w) => w.trim()));
    cur = words[words.length - 1] ?? '';
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

/**
 * "Split into thread" (SMM-CMP-004, AC-04): the caption cut into parts that each fit `limit`, at paragraph, sentence
 * or word ends, each numbered " (i/n)" inside the limit. A caption that already fits comes back as one part, unnumbered.
 */
export function splitIntoThread(text: string, limit: number, rule: CountingRule, numbered = true): string[] {
  const t = text.normalize('NFC').trim();
  if (!t) return [];
  if (countText(t, rule) <= limit) return [t];
  if (!numbered) return pack(t, limit, rule);
  // The numbering's own length depends on how many parts there are; settle it in a few rounds.
  let n = 2;
  for (let round = 0; round < 6; round++) {
    const room = limit - countText(partSuffix(n, n), rule);
    const parts = pack(t, Math.max(10, room), rule);
    if (parts.length <= n || round === 5) return parts.map((p, i) => p + partSuffix(i + 1, parts.length));
    n = parts.length;
  }
  return [t];
}

export function findHashtags(text: string): string[] {
  return Array.from(text.matchAll(/(?:^|\s)#([\p{L}\p{M}\p{N}_]+)/gu), (m) => `#${m[1]}`);
}

export function findMentions(text: string): string[] {
  return Array.from(text.matchAll(/(?:^|\s)@([A-Za-z0-9_.]{1,64})/g), (m) => `@${m[1]}`);
}

/** Replaces `{first_name}`, `{brand}`… in a saved reply (SMM-INB-007); unknown names stay as written. */
export function fillVariables(body: string, vars: Record<string, string | null | undefined>): string {
  return body.replace(/\{([a-z_]+)\}/g, (all, k: string) => {
    const v = vars[k];
    return v === undefined || v === null || v === '' ? all : v;
  });
}

export interface Utm {
  source?: string | null;
  medium?: string | null;
  campaign?: string | null;
  content?: string | null;
}

/**
 * A link with the campaign's UTM tags (SMM-CMP-008, WF-13). `{network}` in a value becomes the target's network, so
 * utm_source names where the click came from. Tags already on the link are kept.
 */
export function tagLink(url: string, utm: Utm, network?: string): string {
  let u: URL;
  try {
    u = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
  } catch {
    return url;
  }
  const put = (k: string, v: string | null | undefined) => {
    if (!v || u.searchParams.has(k)) return;
    u.searchParams.set(k, network ? v.replace(/\{network\}/g, network) : v);
  };
  put('utm_source', utm.source);
  put('utm_medium', utm.medium);
  put('utm_campaign', utm.campaign);
  put('utm_content', utm.content);
  return u.toString();
}

/** The first `n` characters of a caption for a list, on one line. */
export function excerpt(text: string | null | undefined, n = 90): string {
  const t = (text ?? '').replace(/\s+/g, ' ').trim();
  if (t.length <= n) return t;
  const cut = t.slice(0, n - 1);
  const sp = cut.lastIndexOf(' ');
  return `${sp > n * 0.6 ? cut.slice(0, sp) : cut}…`;
}

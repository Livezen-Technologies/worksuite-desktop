/**
 * Stickers (CRT-30, CRT-31): WorkSuite's own built-in set, drawn for this editor and owned by WorkSuite, and the
 * checks every SVG from a brand library passes before it is drawn (NFR-08: no script, no foreignObject, nothing
 * fetched from elsewhere).
 *
 * A built-in sticker is a small SVG made from its colour and outline, so it takes any colour and keeps a crisp edge
 * at any size. Credits: docs/image-editor-credits.md.
 */
export type StickerCategory = 'badges' | 'arrows' | 'icons' | 'seasonal';

export interface BuiltinSticker {
  id: string;
  name: string;
  category: StickerCategory;
  /** The colour it is placed in. */
  colour: string;
  /** Searchable words. */
  words: string;
  /** The drawing, in a 100 × 100 box. `c`: its colour; `o`: the outline's colour and width (0 for none). */
  draw: (c: string, o: { colour: string; width: number }) => string;
}

const stroke = (o: { colour: string; width: number }) => (o.width > 0 ? ` stroke="${o.colour}" stroke-width="${o.width}" stroke-linejoin="round" paint-order="stroke"` : '');
const line = (c: string, w = 8) => `fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"`;
const label = (text: string, size: number, colour = '#FFFFFF') =>
  `<text x="50" y="50" dy="0.35em" text-anchor="middle" font-family="Plus Jakarta Sans, Arial, sans-serif" font-weight="800" font-size="${size}" fill="${colour}">${text}</text>`;

export const STICKERS: BuiltinSticker[] = [
  // Badges
  { id: 'badge-sale', name: 'Sale', category: 'badges', colour: '#E5484D', words: 'sale offer discount tag', draw: (c, o) => `<g transform="rotate(-8 50 50)"><rect x="8" y="30" width="84" height="40" rx="8" fill="${c}"${stroke(o)}/>${label('SALE', 22)}</g>` },
  { id: 'badge-new', name: 'New', category: 'badges', colour: '#F59E0B', words: 'new fresh launch', draw: (c, o) => `<circle cx="50" cy="50" r="44" fill="${c}"${stroke(o)}/>${label('NEW', 24, '#1B1F2E')}` },
  { id: 'badge-off', name: 'Percent off', category: 'badges', colour: '#3B5BDB', words: 'percent off discount', draw: (c, o) => `<path d="M50 4 61 17 78 12 81 29 97 36 88 50 97 64 81 71 78 88 61 83 50 96 39 83 22 88 19 71 3 64 12 50 3 36 19 29 22 12 39 17Z" fill="${c}"${stroke(o)}/>${label('% OFF', 17)}` },
  { id: 'badge-free', name: 'Free', category: 'badges', colour: '#12A594', words: 'free gift', draw: (c, o) => `<rect x="6" y="28" width="88" height="44" rx="22" fill="${c}"${stroke(o)}/>${label('FREE', 22)}` },
  { id: 'badge-best', name: 'Best seller', category: 'badges', colour: '#23349E', words: 'best seller ribbon award', draw: (c, o) => `<path d="M30 58 20 96 38 86 50 98 52 60ZM70 58 80 96 62 86 50 98 48 60Z" fill="${c}" opacity=".75"/><circle cx="50" cy="40" r="34" fill="${c}"${stroke(o)}/>${label('BEST', 16).replace('y="50"', 'y="40"')}` },
  { id: 'badge-star', name: 'Star', category: 'badges', colour: '#F5B400', words: 'star favourite rating', draw: (c, o) => `<path d="M50 6 63 36 95 38 70 59 78 92 50 74 22 92 30 59 5 38 37 36Z" fill="${c}"${stroke(o)}/>` },
  { id: 'badge-heart', name: 'Heart', category: 'badges', colour: '#E5484D', words: 'heart love like', draw: (c, o) => `<path d="M50 88C20 66 6 50 6 32 6 18 17 8 30 8c9 0 16 5 20 12 4-7 11-12 20-12 13 0 24 10 24 24 0 18-14 34-44 56Z" fill="${c}"${stroke(o)}/>` },
  { id: 'badge-check', name: 'Check', category: 'badges', colour: '#12A594', words: 'check done tick ok', draw: (c, o) => `<circle cx="50" cy="50" r="44" fill="${c}"${stroke(o)}/><path d="M28 52 44 67 73 36" ${line('#FFFFFF', 10)}/>` },
  // Arrows
  { id: 'arrow-right', name: 'Arrow right', category: 'arrows', colour: '#FFFFFF', words: 'arrow right next', draw: (c, o) => `<path d="M8 40h52V20l34 30-34 30V60H8Z" fill="${c}"${stroke(o)}/>` },
  { id: 'arrow-curve', name: 'Curved arrow', category: 'arrows', colour: '#FFFFFF', words: 'arrow curve point', draw: (c) => `<path d="M14 78C20 40 46 22 76 26" ${line(c, 9)}/><path d="M62 10 84 27 64 44" ${line(c, 9)}/>` },
  { id: 'arrow-down', name: 'Arrow down', category: 'arrows', colour: '#FFFFFF', words: 'arrow down below', draw: (c, o) => `<path d="M40 8h20v52h20L50 94 20 60h20Z" fill="${c}"${stroke(o)}/>` },
  { id: 'arrow-circle', name: 'Arrow in a circle', category: 'arrows', colour: '#3B5BDB', words: 'arrow circle go', draw: (c, o) => `<circle cx="50" cy="50" r="44" fill="${c}"${stroke(o)}/><path d="M30 50h38M54 34l16 16-16 16" ${line('#FFFFFF', 9)}/>` },
  { id: 'arrow-pointer', name: 'Pointer', category: 'arrows', colour: '#FFFFFF', words: 'pointer cursor click', draw: (c, o) => `<path d="M22 8 80 52 54 56 68 86 56 92 42 62 22 80Z" fill="${c}"${stroke(o)}/>` },
  // Icons
  { id: 'icon-pin', name: 'Map pin', category: 'icons', colour: '#5B9BFF', words: 'pin place location map', draw: (c) => `<path d="M50 94C50 94 18 60 18 38a32 32 0 0 1 64 0c0 22-32 56-32 56Z" ${line(c, 7)}/><circle cx="50" cy="38" r="11" ${line(c, 7)}/>` },
  { id: 'icon-chat', name: 'Speech', category: 'icons', colour: '#FFFFFF', words: 'chat speech talk comment', draw: (c) => `<path d="M14 18h72v50H44L24 84V68H14Z" ${line(c, 7)}/>` },
  { id: 'icon-bolt', name: 'Bolt', category: 'icons', colour: '#F5B400', words: 'bolt lightning fast energy', draw: (c, o) => `<path d="M58 4 18 56h28l-6 40 42-56H54Z" fill="${c}"${stroke(o)}/>` },
  { id: 'icon-sun', name: 'Sun', category: 'icons', colour: '#F5B400', words: 'sun summer bright', draw: (c) => `<circle cx="50" cy="50" r="17" ${line(c, 7)}/><path d="M50 8v12M50 80v12M8 50h12M80 50h12M20 20l9 9M71 71l9 9M20 80l9-9M71 29l9-9" ${line(c, 7)}/>` },
  { id: 'icon-sparkle', name: 'Sparkle', category: 'icons', colour: '#9E8CFC', words: 'sparkle magic shine new', draw: (c, o) => `<path d="M42 8c3 20 10 27 30 30-20 3-27 10-30 30-3-20-10-27-30-30 20-3 27-10 30-30Z" fill="${c}"${stroke(o)}/><path d="M76 58c2 10 5 13 16 15-11 2-14 5-16 15-2-10-5-13-16-15 11-2 14-5 16-15Z" fill="${c}"/>` },
  { id: 'icon-bell', name: 'Bell', category: 'icons', colour: '#FF8A8A', words: 'bell alert notice', draw: (c) => `<path d="M24 70V46a26 26 0 0 1 52 0v24l8 10H16Z" ${line(c, 7)}/><path d="M42 88a9 9 0 0 0 16 0" ${line(c, 7)}/>` },
  { id: 'icon-send', name: 'Send', category: 'icons', colour: '#5B9BFF', words: 'send paper plane message', draw: (c) => `<path d="M90 10 8 44l34 12 12 34Z" ${line(c, 7)}/><path d="M42 56 90 10" ${line(c, 7)}/>` },
  { id: 'icon-camera', name: 'Camera', category: 'icons', colour: '#FFFFFF', words: 'camera photo picture', draw: (c) => `<rect x="10" y="28" width="80" height="56" rx="10" ${line(c, 7)}/><path d="M34 28l6-12h20l6 12" ${line(c, 7)}/><circle cx="50" cy="56" r="15" ${line(c, 7)}/>` },
  { id: 'icon-phone', name: 'Phone', category: 'icons', colour: '#12A594', words: 'phone call contact', draw: (c) => `<path d="M30 10 42 34 33 42c6 12 14 20 26 26l8-9 24 12-6 18C46 88 12 54 12 16Z" ${line(c, 7)}/>` },
  // Seasonal
  { id: 'season-snow', name: 'Snowflake', category: 'seasonal', colour: '#BFE3FF', words: 'snow winter christmas cold', draw: (c) => `<path d="M50 8v84M14 29l72 42M14 71l72-42M40 14l10 10 10-10M40 86l10-10 10 10" ${line(c, 6)}/>` },
  { id: 'season-leaf', name: 'Leaf', category: 'seasonal', colour: '#2FA36B', words: 'leaf autumn nature green', draw: (c, o) => `<path d="M12 88C12 40 40 12 90 10c-2 50-30 78-78 78Z" fill="${c}"${stroke(o)}/><path d="M12 88 62 38" ${line('#FFFFFF', 4)}/>` },
  { id: 'season-flower', name: 'Flower', category: 'seasonal', colour: '#F48FB1', words: 'flower spring bloom avurudu', draw: (c, o) => `<g fill="${c}"${stroke(o)}><circle cx="50" cy="26" r="18"/><circle cx="74" cy="44" r="18"/><circle cx="65" cy="72" r="18"/><circle cx="35" cy="72" r="18"/><circle cx="26" cy="44" r="18"/></g><circle cx="50" cy="52" r="12" fill="#F5B400"/>` },
  { id: 'season-gift', name: 'Gift', category: 'seasonal', colour: '#E5484D', words: 'gift present celebration', draw: (c, o) => `<rect x="12" y="40" width="76" height="52" rx="6" fill="${c}"${stroke(o)}/><rect x="8" y="28" width="84" height="16" rx="4" fill="${c}"/><path d="M50 28v64" ${line('#F5B400', 8)}/><path d="M50 28c-8-18-30-18-24-4 4 6 24 4 24 4Zm0 0c8-18 30-18 24-4-4 6-24 4-24 4Z" fill="#F5B400"/>` },
  { id: 'season-lantern', name: 'Lantern', category: 'seasonal', colour: '#F59E0B', words: 'lantern vesak festival light', draw: (c, o) => `<path d="M50 6v10" ${line(c, 5)}/><path d="M50 16 80 46 50 76 20 46Z" fill="${c}"${stroke(o)}/><path d="M36 76h28l-6 16H42Z" fill="${c}" opacity=".8"/>` },
  { id: 'season-balloon', name: 'Balloon', category: 'seasonal', colour: '#9E8CFC', words: 'balloon party birthday', draw: (c, o) => `<ellipse cx="50" cy="38" rx="28" ry="33" fill="${c}"${stroke(o)}/><path d="M50 71c-6 8 6 12 0 26" ${line(c, 4)}/>` },
];

export const STICKER_CATEGORIES: Array<{ id: StickerCategory | 'all' | 'brand'; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'badges', label: 'Badges' },
  { id: 'arrows', label: 'Arrows' },
  { id: 'icons', label: 'Icons' },
  { id: 'seasonal', label: 'Seasonal' },
  { id: 'brand', label: 'Brand' },
];

export function stickerById(id: string | null | undefined): BuiltinSticker | null {
  return STICKERS.find((s) => s.id === id) ?? null;
}

/** A built-in sticker as a standalone SVG document. */
export function stickerSvg(s: BuiltinSticker, colour: string, outline: { on: boolean; width: number; colour: string }): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-6 -6 112 112" width="224" height="224">${s.draw(colour, { colour: outline.colour, width: outline.on ? Math.max(1, outline.width) : 0 })}</svg>`;
}

export function searchStickers(term: string, category: StickerCategory | 'all' | 'brand'): BuiltinSticker[] {
  const t = term.trim().toLowerCase();
  if (category === 'brand') return [];
  return STICKERS.filter((s) => (category === 'all' || s.category === category) && (!t || s.name.toLowerCase().includes(t) || s.words.includes(t)));
}

/* ==================================================================== *
 * SVG from a library: made safe, and recoloured on request
 * ==================================================================== */

const BANNED = new Set(['script', 'foreignobject', 'iframe', 'object', 'embed', 'audio', 'video', 'canvas', 'link', 'meta', 'base']);

/**
 * An SVG from a brand library, with everything that could run or reach out taken away (NFR-08): scripts,
 * foreignObject, event handlers, and any reference that is not to the drawing itself or an embedded picture.
 * Null when it is not an SVG at all.
 */
export function sanitiseSvg(text: string, parser: DOMParser = new DOMParser()): string | null {
  if (text.length > 4 * 1024 * 1024) return null;
  const doc = parser.parseFromString(text, 'image/svg+xml');
  const root = doc.documentElement;
  if (!root || root.nodeName.toLowerCase() !== 'svg' || doc.getElementsByTagName('parsererror').length) return null;
  const walk = (el: Element) => {
    for (const child of Array.from(el.children)) {
      if (BANNED.has(child.nodeName.toLowerCase())) {
        child.remove();
        continue;
      }
      walk(child);
    }
    for (const a of Array.from(el.attributes)) {
      const name = a.name.toLowerCase();
      const value = a.value.trim();
      if (name.startsWith('on')) el.removeAttribute(a.name);
      else if ((name === 'href' || name === 'xlink:href' || name === 'src') && !value.startsWith('#') && !/^data:image\/(png|jpeg|webp|gif);base64,/i.test(value)) el.removeAttribute(a.name);
      else if (/url\(\s*['"]?(?!#)/i.test(value) || /javascript:/i.test(value)) el.removeAttribute(a.name);
    }
    if (el.nodeName.toLowerCase() === 'style') {
      el.textContent = (el.textContent ?? '').replace(/@import[^;]*;?/gi, '').replace(/url\(\s*['"]?(?!#)[^)]*\)/gi, 'none');
    }
  };
  walk(root);
  if (!root.getAttribute('xmlns')) root.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  return new XMLSerializer().serializeToString(root);
}

/** A vector sticker from a library in one colour (CRT-31): every painted fill takes it; "none" stays none. */
export function recolourSvg(svg: string, colour: string, parser: DOMParser = new DOMParser()): string {
  const doc = parser.parseFromString(svg, 'image/svg+xml');
  const root = doc.documentElement;
  if (!root || root.nodeName.toLowerCase() !== 'svg') return svg;
  const all = [root, ...Array.from(root.getElementsByTagName('*'))];
  for (const el of all) {
    const fill = el.getAttribute('fill');
    if (fill && fill !== 'none' && !fill.startsWith('url(')) el.setAttribute('fill', colour);
    const style = el.getAttribute('style');
    if (style) el.setAttribute('style', style.replace(/fill\s*:\s*(?!none)[^;]+/gi, `fill:${colour}`));
  }
  if (!root.getAttribute('fill')) root.setAttribute('fill', colour);
  return new XMLSerializer().serializeToString(root);
}

/**
 * Made avatars, drawn here — no outside service, no AI.
 *
 * A style is a handful of choices — initials, look, background, border, and
 * for an illustrated face a skin tone — kept with the picture so it can be
 * opened and changed later. The drawing is SVG, shown as it is for the
 * preview and turned into a 1024-pixel PNG when saved; the server then
 * redraws that like any upload, so a made avatar is stored exactly as a photo
 * is.
 *
 * Deterministic: the same choices always draw the same picture. The abstract
 * pattern and the face's hair are picked by a number (`seed`), and Shuffle
 * simply picks another.
 */

export type AvatarLook = 'initials' | 'abstract' | 'illustrated';
export type AvatarBorder = 'none' | 'thin' | 'bold';

export interface AvatarStyle {
  look: AvatarLook;
  initials: string;
  background: string;
  border: AvatarBorder;
  /** Illustrated only. */
  tone?: string;
  /** Abstract pattern and illustrated hair. */
  seed?: number;
  /** Abstract only: the initials over the pattern. */
  showInitials?: boolean;
}

/** Backgrounds: a colour, or two for a gradient, and the ink that reads on them. */
export const BACKGROUNDS: Record<string, { label: string; from: string; to: string; ink: string }> = {
  ocean: { label: 'Ocean', from: '#2563eb', to: '#1e40af', ink: '#ffffff' },
  violet: { label: 'Violet', from: '#7c3aed', to: '#5b21b6', ink: '#ffffff' },
  rose: { label: 'Rose', from: '#e11d48', to: '#9f1239', ink: '#ffffff' },
  emerald: { label: 'Emerald', from: '#059669', to: '#065f46', ink: '#ffffff' },
  amber: { label: 'Amber', from: '#f59e0b', to: '#d97706', ink: '#1f2937' },
  slate: { label: 'Slate', from: '#334155', to: '#0f172a', ink: '#ffffff' },
  sunset: { label: 'Sunset', from: '#f97316', to: '#db2777', ink: '#ffffff' },
  aurora: { label: 'Aurora', from: '#06b6d4', to: '#7c3aed', ink: '#ffffff' },
  meadow: { label: 'Meadow', from: '#84cc16', to: '#0d9488', ink: '#ffffff' },
  sand: { label: 'Sand', from: '#f5e6cf', to: '#e7cfa9', ink: '#3f2d1c' },
};

/** Skin tones for an illustrated face. */
export const TONES: Record<string, { label: string; skin: string; shade: string }> = {
  light: { label: 'Light', skin: '#f8d9c0', shade: '#e9bc9c' },
  medium_light: { label: 'Medium light', skin: '#e8b98f', shade: '#d49f74' },
  medium: { label: 'Medium', skin: '#c68a5e', shade: '#ad7247' },
  medium_dark: { label: 'Medium dark', skin: '#8d5a3b', shade: '#74472d' },
  dark: { label: 'Dark', skin: '#5b3a28', shade: '#482d1f' },
};

const HAIR = ['#1f1a17', '#3b2a20', '#6b4423', '#8a3b24', '#9ca3af'];

export const LOOKS: Array<{ id: AvatarLook; label: string }> = [
  { id: 'initials', label: 'Initials' },
  { id: 'abstract', label: 'Abstract' },
  { id: 'illustrated', label: 'Illustrated' },
];

/** "Alex Rico" → "AR". */
export function initialsFrom(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);

  return ((words[0]?.[0] ?? '') + (words.length > 1 ? (words[words.length - 1]?.[0] ?? '') : '')).toUpperCase();
}

/** A style kept inside what can be drawn: known choices only, up to three letters. */
export function normalise(s: Partial<AvatarStyle> | null | undefined, name = ''): AvatarStyle {
  const initials = [...(s?.initials ?? initialsFrom(name)).replace(/\s+/g, '')].slice(0, 3).join('').toUpperCase();

  return {
    look: LOOKS.some((l) => l.id === s?.look) ? (s!.look as AvatarLook) : 'initials',
    initials,
    background: s?.background && BACKGROUNDS[s.background] ? s.background : 'ocean',
    border: s?.border === 'thin' || s?.border === 'bold' ? s.border : 'none',
    tone: s?.tone && TONES[s.tone] ? s.tone : 'medium',
    seed: Number.isInteger(s?.seed) ? Math.abs(s!.seed as number) % 100000 : 1,
    showInitials: s?.showInitials !== false,
  };
}

/** A small repeatable random series: the same seed, the same pattern. */
function series(seed: number) {
  let x = (seed * 9301 + 49297) % 233280 || 1;

  return () => {
    x = (x * 9301 + 49297) % 233280;

    return x / 233280;
  };
}

const esc = (t: string) => t.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

/** The letters, sized to how many there are. */
function letters(text: string, ink: string, size: number) {
  if (!text) return '';

  const font = ([0, 240, 196, 150][Math.min(3, [...text].length)] ?? 150) * (size / 512);

  return `<text x="50%" y="50%" dy="0.35em" text-anchor="middle" font-family="Inter, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" font-weight="600" font-size="${font}" fill="${ink}" letter-spacing="${size / 128}">${esc(text)}</text>`;
}

function pattern(seed: number, ink: string) {
  const r = series(seed);
  const shapes: string[] = [];

  for (let i = 0; i < 7; i++) {
    const x = Math.round(r() * 512);
    const y = Math.round(r() * 512);
    const size = Math.round(60 + r() * 200);
    const opacity = (0.08 + r() * 0.22).toFixed(2);
    const rot = Math.round(r() * 360);

    shapes.push(r() < 0.5
      ? `<circle cx="${x}" cy="${y}" r="${size / 2}" fill="${ink}" opacity="${opacity}"/>`
      : `<rect x="${x - size / 2}" y="${y - size / 2}" width="${size}" height="${size}" rx="${size / 5}" fill="${ink}" opacity="${opacity}" transform="rotate(${rot} ${x} ${y})"/>`);
  }

  return shapes.join('');
}

function face(seed: number, toneKey: string) {
  const tone = TONES[toneKey] ?? TONES.medium!;
  const r = series(seed);
  const hair = HAIR[Math.floor(r() * HAIR.length)];
  const cut = Math.floor(r() * 3);
  const back = cut === 2 ? `<path d="M150 250 Q150 110 256 110 Q362 110 362 250 L372 390 Q256 420 140 390 Z" fill="${hair}"/>` : '';
  const top = [
    `<path d="M168 238 Q162 128 256 124 Q350 128 344 238 Q330 176 256 172 Q182 176 168 238 Z" fill="${hair}"/>`,
    `<path d="M166 240 Q158 120 262 122 Q352 126 346 222 Q300 168 214 190 Q186 204 166 240 Z" fill="${hair}"/>`,
    `<path d="M164 250 Q160 124 256 120 Q352 124 348 250 Q340 180 256 170 Q172 180 164 250 Z" fill="${hair}"/>`,
  ][cut];

  return [
    back,
    `<path d="M96 512 Q106 380 256 372 Q406 380 416 512 Z" fill="#ffffff" opacity="0.92"/>`,
    `<rect x="226" y="316" width="60" height="70" rx="24" fill="${tone.shade}"/>`,
    `<circle cx="256" cy="244" r="92" fill="${tone.skin}"/>`,
    top,
    `<circle cx="222" cy="250" r="9" fill="#1f2937"/><circle cx="290" cy="250" r="9" fill="#1f2937"/>`,
    `<path d="M226 290 Q256 314 286 290" stroke="#1f2937" stroke-width="7" stroke-linecap="round" fill="none"/>`,
    `<circle cx="206" cy="282" r="14" fill="#f43f5e" opacity="0.18"/><circle cx="306" cy="282" r="14" fill="#f43f5e" opacity="0.18"/>`,
  ].join('');
}

/** The avatar as SVG, square, `size` pixels. */
export function avatarSvg(input: Partial<AvatarStyle>, size = 512): string {
  const s = normalise(input);
  const bg = BACKGROUNDS[s.background] ?? BACKGROUNDS.ocean!;
  const k = size / 512;
  let art = '';

  if (s.look === 'abstract') {
    art = `<g transform="scale(${k})">${pattern(s.seed ?? 1, bg.ink)}</g>${s.showInitials ? letters(s.initials, bg.ink, size) : ''}`;
  } else if (s.look === 'illustrated') {
    art = `<g transform="scale(${k})">${face(s.seed ?? 1, s.tone ?? 'medium')}</g>`;
  } else {
    art = letters(s.initials, bg.ink, size);
  }

  const ring = s.border === 'none' ? '' : `<circle cx="${size / 2}" cy="${size / 2}" r="${size / 2 - (s.border === 'thin' ? 8 : 18) * k}" fill="none" stroke="#ffffff" stroke-opacity="0.9" stroke-width="${(s.border === 'thin' ? 16 : 36) * k}"/>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">`
    + `<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${bg.from}"/><stop offset="1" stop-color="${bg.to}"/></linearGradient></defs>`
    + `<rect width="${size}" height="${size}" fill="url(#bg)"/>${art}${ring}</svg>`;
}

export const svgUrl = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

/** Draw the avatar into a PNG for saving. The server redraws it as it does any upload. */
export async function avatarPng(style: Partial<AvatarStyle>, size = 1024): Promise<Blob> {
  const img = new Image();
  img.src = svgUrl(avatarSvg(style, size));
  await img.decode();

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  if (!ctx) throw new Error('no canvas');

  ctx.drawImage(img, 0, 0, size, size);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));

  if (!blob) throw new Error('no image');

  return blob;
}

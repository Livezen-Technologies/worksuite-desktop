/**
 * Fitting a slide into the space it has (worksuite-desktop#321): "Fit slide" — the whole slide, centred, at its own
 * aspect (16:9, 4:3) — "Fit width", or a fixed 50–200%. Pure, so the viewer, the slideshow and the presenter view
 * draw the same box and it can be tested without a screen.
 */
export type SlideZoom = 'fit' | 'width' | number;

export interface Size {
  width: number;
  height: number;
}

/** The fixed zooms the menu and ⌘+ / ⌘− step through. */
export const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;
export const ZOOM_MIN = ZOOM_STEPS[0];
export const ZOOM_MAX = ZOOM_STEPS[ZOOM_STEPS.length - 1]!;
/** Room kept round a fitted slide, in CSS pixels. */
export const FIT_PADDING = 24;

const finite = (n: number, fallback: number) => (Number.isFinite(n) && n > 0 ? n : fallback);

/** How many CSS pixels a slide point is drawn at in `area` for `zoom`. Never zero or negative. */
export function slideScale(area: Size, slide: Size, zoom: SlideZoom, pad = FIT_PADDING): number {
  const sw = finite(slide.width, 1);
  const sh = finite(slide.height, 1);
  const aw = Math.max(1, area.width - pad * 2);
  const ah = Math.max(1, area.height - pad * 2);
  if (zoom === 'fit') return Math.max(0.01, Math.min(aw / sw, ah / sh));
  if (zoom === 'width') return Math.max(0.01, aw / sw);
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, finite(zoom, 1)));
}

export interface SlideBox {
  /** The slide's drawn size, CSS pixels. */
  width: number;
  height: number;
  /** Its top-left inside the scrolling content. */
  left: number;
  top: number;
  /** The scrolling content's size: the area itself, or more when the slide is bigger than it (never cropped). */
  contentWidth: number;
  contentHeight: number;
  scale: number;
}

/**
 * Where the slide goes: centred in the area when it fits, otherwise at the padding with the area scrolling to the
 * rest — the slide is never cut off and never pushed off to one side.
 */
export function slideBox(area: Size, slide: Size, zoom: SlideZoom, pad = FIT_PADDING): SlideBox {
  const scale = slideScale(area, slide, zoom, pad);
  const width = Math.round(finite(slide.width, 1) * scale);
  const height = Math.round(finite(slide.height, 1) * scale);
  const contentWidth = Math.max(area.width, width + pad * 2);
  const contentHeight = Math.max(area.height, height + pad * 2);
  return { width, height, left: Math.round((contentWidth - width) / 2), top: Math.round((contentHeight - height) / 2), contentWidth, contentHeight, scale };
}

/** The slide inside a full screen: as big as it goes at its aspect, centred, black round it (no padding). */
export function screenBox(screen: Size, slide: Size): SlideBox {
  return slideBox(screen, slide, 'fit', 0);
}

/** ⌘+ / ⌘−: the next fixed zoom from what is on screen now (a fitted slide counts at its current scale). */
export function stepZoom(scale: number, dir: 1 | -1): number {
  if (dir > 0) return ZOOM_STEPS.find((s) => s > scale + 0.001) ?? ZOOM_MAX;
  return [...ZOOM_STEPS].reverse().find((s) => s < scale - 0.001) ?? ZOOM_MIN;
}

/** What the zoom menu says. */
export function zoomLabel(zoom: SlideZoom): string {
  if (zoom === 'fit') return 'Fit slide';
  if (zoom === 'width') return 'Fit width';
  return `${Math.round(zoom * 100)}%`;
}

/** The menu's value for a zoom, and back. */
export const zoomValue = (zoom: SlideZoom): string => String(zoom);
export function parseZoom(value: string): SlideZoom {
  if (value === 'fit' || value === 'width') return value;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, n)) : 'fit';
}

/** "16:9", "4:3", "16:10" — or the reduced ratio for anything else. */
export function aspectLabel(slide: Size): string {
  const r = finite(slide.width, 16) / finite(slide.height, 9);
  const known: Array<[string, number]> = [['16:9', 16 / 9], ['4:3', 4 / 3], ['16:10', 16 / 10], ['1:1', 1]];
  const hit = known.find(([, v]) => Math.abs(v - r) < 0.01);
  if (hit) return hit[0];
  return `${Math.round(r * 100) / 100}:1`;
}

/** A canvas's backing size for a CSS size at the screen's pixel ratio (2× on Retina), so it is sharp, capped for memory. */
export function backingSize(css: Size, dpr: number, maxPixels = 4096 * 4096): Size {
  const ratio = finite(dpr, 1);
  let w = Math.max(1, Math.round(css.width * ratio));
  let h = Math.max(1, Math.round(css.height * ratio));
  if (w * h > maxPixels) {
    const k = Math.sqrt(maxPixels / (w * h));
    w = Math.max(1, Math.floor(w * k));
    h = Math.max(1, Math.floor(h * k));
  }
  return { width: w, height: h };
}

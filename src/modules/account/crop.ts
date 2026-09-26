/**
 * The crop editor's geometry, apart from any screen so it can be checked.
 *
 * The picture sits in a square frame of side `stage`: centred, then moved by
 * (x, y), turned by `rotation`, and scaled by `scale`. The circle shown is the
 * frame's inscribed circle, and what is saved is the whole square — the circle
 * is only how the picture will look where it is shown round.
 */
export type Rotation = 0 | 90 | 180 | 270;

export interface Crop {
  scale: number;
  x: number;
  y: number;
  rotation: Rotation;
}

/** How far past the smallest scale the zoom goes. */
export const MAX_ZOOM = 4;

/** The picture's width and height once turned. */
export function turned(w: number, h: number, rotation: Rotation): [number, number] {
  return rotation % 180 === 0 ? [w, h] : [h, w];
}

/** The smallest scale at which the picture still covers the whole frame. */
export function minScale(w: number, h: number, rotation: Rotation, stage: number): number {
  const [tw, th] = turned(w, h, rotation);

  return stage / Math.min(tw, th);
}

/** A crop kept inside what makes sense: never smaller than the frame, never pulled off it. */
export function clamp(c: Crop, w: number, h: number, stage: number): Crop {
  const min = minScale(w, h, c.rotation, stage);
  const scale = Math.min(Math.max(c.scale, min), min * MAX_ZOOM);
  const [tw, th] = turned(w, h, c.rotation);
  const maxX = Math.max(0, (tw * scale - stage) / 2);
  const maxY = Math.max(0, (th * scale - stage) / 2);

  return {
    rotation: c.rotation,
    scale,
    /* `|| 0`: clamped to nothing from below is -0, which CSS would print as "-0px". */
    x: Math.min(maxX, Math.max(-maxX, c.x)) || 0,
    y: Math.min(maxY, Math.max(-maxY, c.y)) || 0,
  };
}

/** Where a new picture starts: filling the frame, centred. */
export function initial(w: number, h: number, stage: number): Crop {
  return { rotation: 0, scale: minScale(w, h, 0, stage), x: 0, y: 0 };
}

/** A quarter turn either way, starting again from filling the frame so nothing is left uncovered. */
export function rotate(c: Crop, dir: 1 | -1, w: number, h: number, stage: number): Crop {
  const rotation = (((c.rotation + dir * 90) % 360) + 360) % 360 as Rotation;

  return clamp({ rotation, scale: minScale(w, h, rotation, stage), x: 0, y: 0 }, w, h, stage);
}

/** The CSS transform that shows a crop in a frame `stage` wide, drawn at `k` times that size. */
export function transform(c: Crop, k = 1): string {
  return `translate(-50%, -50%) translate(${c.x * k}px, ${c.y * k}px) rotate(${c.rotation}deg) scale(${c.scale * k})`;
}

/**
 * Draw the crop into a square canvas `out` pixels wide, exactly as the frame
 * shows it. `background` fills what the photo does not cover — a JPG has no
 * transparency, and would otherwise turn it black.
 */
export function draw(ctx: CanvasRenderingContext2D, img: CanvasImageSource, w: number, h: number, c: Crop, stage: number, out: number, background?: string) {
  const k = out / stage;

  ctx.clearRect(0, 0, out, out);

  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, out, out);
  }

  ctx.save();
  ctx.imageSmoothingQuality = 'high';
  ctx.translate(out / 2 + c.x * k, out / 2 + c.y * k);
  ctx.rotate((c.rotation * Math.PI) / 180);
  ctx.scale(c.scale * k, c.scale * k);
  ctx.drawImage(img, -w / 2, -h / 2, w, h);
  ctx.restore();
}

/**
 * The type a cropped picture goes up as: the same kind as the file chosen, so
 * an installation that allows only some types refuses exactly what it says — a
 * JPG goes up as a JPG, not re-encoded into a type it may not allow. Anything
 * else goes up as WebP, which a browser that cannot write it sends as PNG.
 */
export function exportType(chosen: string): 'image/jpeg' | 'image/png' | 'image/webp' {
  return chosen === 'image/jpeg' || chosen === 'image/png' ? chosen : 'image/webp';
}

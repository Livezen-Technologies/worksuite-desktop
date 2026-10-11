import type { PptxFontFace, SlideDisplayList } from '@betteroffice/pptx';
import { backingSize } from './fit';

/**
 * A deck opened for showing (worksuite-desktop#321): the .pptx laid out and painted by BetterOffice's slide engine —
 * the same Rust/Wasm engine as WorkSuite's built-in Slides editor — straight onto a canvas at the screen's pixel
 * ratio (2× on Retina), so text and shapes are drawn, not a blurry picture scaled up. Nothing leaves the computer and
 * it works offline. Speaker notes come with it, for the presenter view.
 */
export interface Deck {
  count: number;
  /** A slide's size in CSS pixels at 100%. */
  width: number;
  height: number;
  /** Each slide's speaker notes as plain text ('' when it has none). */
  notes: string[];
  /** Paints a slide onto `canvas` at `cssWidth` CSS pixels wide, sharp at `dpr`. */
  paint(canvas: HTMLCanvasElement, index: number, cssWidth: number, dpr: number): Promise<void>;
  dispose(): void;
}

/** 914 400 EMU to the inch, 96 CSS pixels to the inch. */
export const EMU_PER_PX = 9525;

/** Fonts are registered with the page once; the editor does the same, so they are shared. */
const registered = new Set<string>();
async function registerFonts(fonts: readonly PptxFontFace[]): Promise<void> {
  if (typeof FontFace === 'undefined' || typeof document === 'undefined') return;
  await Promise.all(
    fonts.map(async (f) => {
      const key = `${f.family}:${f.bold ? 1 : 0}:${f.italic ? 1 : 0}`;
      if (registered.has(key)) return;
      registered.add(key);
      try {
        const face = await new FontFace(f.family, f.bytes.slice().buffer, { style: f.italic ? 'italic' : 'normal', weight: f.bold ? '700' : '400' }).load();
        document.fonts.add(face);
      } catch {
        registered.delete(key);
      }
    }),
  );
}

export async function openDeck(bytes: Uint8Array): Promise<Deck> {
  const [{ prepareFile }, pptx] = await Promise.all([import('../better/BetterEditor'), import('@betteroffice/pptx')]);
  // Parses once and loads the wasm and the bundled fonts; a file the engine cannot read fails here, with its reason.
  const prepared = await prepareFile(bytes, 'pptx');
  const fonts = prepared.fonts ?? [];
  await registerFonts(fonts);
  const handle = pptx.openPresentation(bytes, { fonts });
  let disposed = false;
  const snap = handle.snapshot();
  const layouts = new Map<number, SlideDisplayList>();
  const layout = (i: number) => {
    let l = layouts.get(i);
    if (!l) {
      l = handle.layoutSlide(i);
      layouts.set(i, l);
    }
    return l;
  };
  const first = snap.slides.length ? layout(0) : null;
  const width = first?.width || snap.widthEmu / EMU_PER_PX || 960;
  const height = first?.height || snap.heightEmu / EMU_PER_PX || 540;
  const images = new Map<string, Promise<CanvasImageSource | null>>();
  const resolveImage = (assetId: string): Promise<CanvasImageSource | null> => {
    let p = images.get(assetId);
    if (!p) {
      p = (async () => {
        try {
          return await pptx.decodePresentationImage(handle.mediaBytes(assetId), 'This picture could not be shown.');
        } catch {
          return null;
        }
      })();
      images.set(assetId, p);
    }
    return p;
  };
  // A canvas painted again before its last paint finished keeps only the newest.
  const turns = new WeakMap<HTMLCanvasElement, number>();

  return {
    count: snap.slides.length,
    width,
    height,
    notes: snap.slides.map((s) => s.notes ?? ''),
    async paint(canvas, index, cssWidth, dpr) {
      if (disposed || index < 0 || index >= snap.slides.length) return;
      const turn = (turns.get(canvas) ?? 0) + 1;
      turns.set(canvas, turn);
      const list = layout(index);
      const scale = Math.max(0.01, cssWidth / Math.max(1, list.width));
      const css = { width: list.width * scale, height: list.height * scale };
      const backing = backingSize(css, dpr);
      const ratio = backing.width / Math.max(1, css.width);
      // Painted off screen first, then copied in one go: no half-drawn slide shows, and a stale paint is dropped.
      const off = document.createElement('canvas');
      off.width = backing.width;
      off.height = backing.height;
      const ctx = off.getContext('2d');
      if (!ctx) return;
      await pptx.paintSlide(ctx, list, ratio, scale, { resolveImage });
      if (disposed || turns.get(canvas) !== turn) return;
      canvas.width = backing.width;
      canvas.height = backing.height;
      canvas.style.width = `${Math.round(css.width)}px`;
      canvas.style.height = `${Math.round(css.height)}px`;
      canvas.getContext('2d')?.drawImage(off, 0, 0);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      layouts.clear();
      images.clear();
      handle.dispose();
    },
  };
}

/** Reads a file through the app (the session's own credentials, the API proxy's rules). */
export async function fetchBytes(url: string, signal?: AbortSignal): Promise<Uint8Array> {
  const res = await fetch(url, { cache: 'no-store', signal });
  if (!res.ok) throw new Error(res.status === 403 ? 'You may not see this file.' : res.status === 404 ? 'The file is not there any more.' : `The server answered ${res.status}.`);
  return new Uint8Array(await res.arrayBuffer());
}

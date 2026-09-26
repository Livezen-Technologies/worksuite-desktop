import type { LayoutMode, PipCorner } from './state';

/**
 * CoreCallLayoutManager: every sizing rule for a call surface in one pure
 * function. The workspace measures itself, says what is going on, and draws
 * what comes back; no component decides for itself how big the stage is or
 * whether the panel fits beside it.
 *
 *   - Something is on stage (a shared screen or the whiteboard): it is the
 *     main view, and people stay visible — in the picture-in-picture box
 *     (Focus), a column beside it (Side by side, when there is room) or a
 *     strip under it (Grid).
 *   - Nothing is: one other person fills the stage with you in the PiP box;
 *     two to nine are a grid; more are the speaker with a strip.
 *   - The side panel sits beside the stage when the stage keeps at least
 *     MIN_STAGE of width; otherwise it lies over the call (a narrow window,
 *     the floating card never has one).
 *   - The controls float over the stage; the PiP box keeps clear of them.
 */
export interface LayoutInput {
  width: number;
  height: number;
  /** Everybody in the call, you included. */
  people: number;
  /** A screen is being shared, or the whiteboard is on stage. */
  primary: boolean;
  panelOpen: boolean;
  panelWidth: number;
  fullscreen: boolean;
  floating: boolean;
  mode: LayoutMode;
}

export type Resolved = 'speaker' | 'grid' | 'screen-focus' | 'screen-side' | 'screen-grid' | 'floating';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LayoutOutput {
  resolved: Resolved;
  stage: Rect;
  panel: { docked: boolean; rect: Rect } | null;
  /** Grid columns (grid), or 0. */
  columns: number;
  /** A row of tiles under the stage. */
  strip: boolean;
  /** A column of tiles beside the shared screen. */
  side: boolean;
  /** The picture-in-picture box over the stage. */
  pip: boolean;
  /** Space the PiP box keeps free at the bottom of the stage, for the controls. */
  controlsInset: number;
  compactControls: boolean;
}

export const HEADER = 44;
export const MIN_STAGE = 560;
export const SIDE_COLUMN = 300;
export const STRIP = 124;
const CONTROLS = 84;

export function gridColumns(n: number): number {
  return n <= 1 ? 1 : n <= 4 ? 2 : n <= 9 ? 3 : 4;
}

export function computeLayout(i: LayoutInput): LayoutOutput {
  const width = Math.max(0, i.width);
  const height = Math.max(0, i.height);

  if (i.floating) {
    return { resolved: 'floating', stage: { x: 0, y: 0, width, height }, panel: null, columns: 0, strip: false, side: false, pip: i.primary && i.people > 1, controlsInset: 0, compactControls: true };
  }

  const top = HEADER;
  const body = Math.max(0, height - top);
  const dockable = i.panelOpen && width - i.panelWidth >= MIN_STAGE;
  const panel = i.panelOpen
    ? dockable
      ? { docked: true, rect: { x: width - i.panelWidth, y: top, width: i.panelWidth, height: body } }
      : { docked: false, rect: { x: Math.max(0, width - Math.min(width, i.panelWidth)), y: top, width: Math.min(width, i.panelWidth), height: body } }
    : null;
  const stageWidth = panel?.docked ? width - i.panelWidth : width;
  const stage = { x: 0, y: top, width: stageWidth, height: body };
  const compactControls = stageWidth < 520;
  const base = { stage, panel, controlsInset: CONTROLS, compactControls };

  if (i.primary) {
    const others = i.people > 1;
    if (i.mode === 'side' && stageWidth - SIDE_COLUMN >= 420) return { ...base, resolved: 'screen-side', columns: 0, strip: false, side: true, pip: false };
    if (i.mode === 'grid' && body - STRIP >= 240) return { ...base, resolved: 'screen-grid', columns: 0, strip: true, side: false, pip: false };
    return { ...base, resolved: 'screen-focus', columns: 0, strip: false, side: false, pip: others || i.people === 1 };
  }

  if (i.mode === 'focus' || (i.mode === 'auto' && i.people <= 2) || i.people > 9) {
    return { ...base, resolved: 'speaker', columns: 0, strip: i.people > 2 && body - STRIP >= 240, side: false, pip: i.people === 2 };
  }
  return { ...base, resolved: 'grid', columns: gridColumns(i.people), strip: false, side: false, pip: false };
}

/** Where the PiP box sits in a stage, docked to a corner, clear of the controls. */
export function pipRect(stage: { width: number; height: number }, corner: PipCorner, width: number, inset: number, margin = 16): Rect {
  const w = Math.max(120, Math.min(width, stage.width - margin * 2));
  const h = Math.round((w * 9) / 16);
  const left = corner === 'tl' || corner === 'bl';
  const upper = corner === 'tl' || corner === 'tr';
  return {
    x: left ? margin : stage.width - w - margin,
    y: upper ? margin : Math.max(margin, stage.height - h - margin - inset),
    width: w,
    height: h,
  };
}

/** The corner nearest a point in the stage: where a dragged PiP box settles. */
export function nearestCorner(stage: { width: number; height: number }, x: number, y: number): PipCorner {
  const left = x < stage.width / 2;
  const upper = y < stage.height / 2;
  return upper ? (left ? 'tl' : 'tr') : left ? 'bl' : 'br';
}

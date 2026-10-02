/**
 * Where a menu goes (menuPlacement): pure geometry, so it can be tested
 * without a browser. A menu opens on the preferred side of its trigger and
 * flips to the other side when that one has less room; it is shifted along
 * the other axis to stay inside the viewport, and its height is capped at the
 * room it has — the menu scrolls inside rather than running off screen.
 *
 * `avoid` is an area the menu must not cover when it opens above or below
 * (the call controls the trigger sits in): the room is measured from its edge
 * rather than the trigger's.
 */
export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export type Side = 'top' | 'bottom' | 'start' | 'end';

export interface PlaceInput {
  trigger: Rect;
  /** The menu's natural size, before it is limited. */
  menu: { width: number; height: number };
  viewport: { width: number; height: number };
  /** Where to open: above (`top`) suits a bottom toolbar; `end` suits a submenu. */
  prefer: Side;
  /** Along the cross axis: centred on the trigger, or lined up with its start or end edge. */
  align?: 'center' | 'start' | 'end';
  /** Right-to-left: `start` and `end` swap sides. */
  rtl?: boolean;
  /** Kept free of the viewport's edges. */
  margin?: number;
  /** Between the trigger and the menu. */
  gap?: number;
  avoid?: Rect | null;
  /** The shortest a menu is allowed to get before flipping is preferred regardless. */
  minHeight?: number;
}

export interface Placement {
  left: number;
  top: number;
  /** The menu scrolls past this. */
  maxHeight: number;
  /** The menu is narrowed to this when the viewport is narrower than it. */
  maxWidth: number;
  side: Side;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, Math.max(lo, hi)));

export function placeMenu(input: PlaceInput): Placement {
  const { trigger, menu, viewport, prefer, align = 'center', rtl = false } = input;
  const margin = input.margin ?? 8;
  const gap = input.gap ?? 8;
  const maxWidth = Math.max(0, viewport.width - margin * 2);
  const width = Math.min(menu.width, maxWidth);
  const maxTall = Math.max(0, viewport.height - margin * 2);

  if (prefer === 'top' || prefer === 'bottom') {
    const upper = Math.min(trigger.top, input.avoid ? input.avoid.top : Infinity);
    const lower = Math.max(trigger.top + trigger.height, input.avoid ? input.avoid.top + input.avoid.height : -Infinity);
    const room = { top: Math.max(0, upper - gap - margin), bottom: Math.max(0, viewport.height - lower - gap - margin) };
    const other: Side = prefer === 'top' ? 'bottom' : 'top';
    // The preferred side while the menu fits there; else whichever side has more room.
    const side: Side = menu.height <= room[prefer] ? prefer : menu.height <= room[other] ? other : room[prefer] >= room[other] ? prefer : other;
    const maxHeight = Math.min(room[side], maxTall);
    const height = Math.min(menu.height, maxHeight);
    const top = side === 'top' ? upper - gap - height : lower + gap;
    const anchorLeft = align === 'center' ? trigger.left + trigger.width / 2 - width / 2 : (align === 'start') !== rtl ? trigger.left : trigger.left + trigger.width - width;
    const left = clamp(anchorLeft, margin, viewport.width - margin - width);
    return { left, top, maxHeight, maxWidth, side };
  }

  // Beside the trigger (a submenu beside its item): `end` is the right in a left-to-right layout.
  const right = (s: Side) => (s === 'end') !== rtl;
  const room = { right: viewport.width - (trigger.left + trigger.width) - gap - margin, left: trigger.left - gap - margin };
  const want = right(prefer) ? 'right' : 'left';
  const flip = want === 'right' ? 'left' : 'right';
  const chosen = width <= room[want] ? want : width <= room[flip] ? flip : room[want] >= room[flip] ? want : flip;
  const side: Side = (chosen === 'right') !== rtl ? 'end' : 'start';
  const rawLeft = chosen === 'right' ? trigger.left + trigger.width + gap : trigger.left - gap - width;
  const left = clamp(rawLeft, margin, viewport.width - margin - width);
  const height = Math.min(menu.height, maxTall);
  const top = clamp(trigger.top, margin, viewport.height - margin - height);
  return { left, top, maxHeight: maxTall, maxWidth, side };
}

/** Narrow windows and phones get a bottom sheet instead of a floating menu. */
export const SHEET_BELOW = 640;
export function sheetMode(width: number, breakpoint = SHEET_BELOW): boolean {
  return width < breakpoint;
}

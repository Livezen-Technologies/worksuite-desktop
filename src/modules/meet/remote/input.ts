import { normalise } from '@shared/remote-control/channel';

/**
 * What the controller's mouse and keyboard become on the wire, as the web
 * client sends them (RC-INP-02, RC-KBD-01..03). Pure, so it is tested alone.
 */

export interface Point {
  x: number;
  y: number;
}

type Box = { left: number; top: number; width: number; height: number };

const BUTTONS = ['left', 'middle', 'right'] as const;
export type ButtonName = (typeof BUTTONS)[number];

export function buttonName(button: number): ButtonName {
  return BUTTONS[button] ?? 'left';
}

/**
 * A point on the shared picture (0–1 from its corner, object-fit contain),
 * or null off the picture. `clamp` pins it to the nearest edge instead, for
 * a button let go outside it — a press must always be released.
 */
export function pointOn(clientX: number, clientY: number, box: Box, videoW: number, videoH: number, clamp = false): Point | null {
  const p = normalise(clientX, clientY, box, videoW, videoH);
  if (p || !clamp || !videoW || !videoH || !box.width || !box.height) return p;
  const scale = Math.min(box.width / videoW, box.height / videoH);
  const w = videoW * scale;
  const h = videoH * scale;
  const left = box.left + (box.width - w) / 2;
  const top = box.top + (box.height - h) / 2;
  return normalise(Math.min(Math.max(clientX, left), left + w), Math.min(Math.max(clientY, top), top + h), box, videoW, videoH);
}

export interface KeyLike {
  code: string;
  key: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

export interface KeyPayload {
  code: string;
  /** Only for keys that are not a character (Enter, ArrowLeft …): the sharer's layout decides what a character key types. */
  key?: string;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
  down: boolean;
}

export type TextPayload = { text: string; down: true };

/** The web's key payload: the physical key, plus its name when it isn't a character. */
export function keyPayload(e: KeyLike, down: boolean): KeyPayload {
  return { code: e.code, key: e.key.length === 1 ? undefined : e.key, ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, meta: e.metaKey, down };
}

/**
 * What one key event sends. In text mode (Sinhala, Tamil, Arabic and other
 * layouts) a plain character goes as text once, on the way down, and its
 * release is not sent; shortcuts and named keys still go as keys. Null: send nothing.
 */
export function keyMessage(e: KeyLike, down: boolean, textMode: boolean): KeyPayload | TextPayload | null {
  const plain = e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey;
  if (textMode && plain) return down ? { text: e.key, down: true } : null;
  return keyPayload(e, down);
}

/** The wheel, in pixels whatever the device reported in (lines, pages). */
export function wheelDelta(e: { deltaX: number; deltaY: number; deltaMode: number }): { dx: number; dy: number } {
  const k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
  return { dx: Math.round(e.deltaX * k), dy: Math.round(e.deltaY * k) };
}

/**
 * Pointer moves, coalesced to at most one per `gap` ms (60 a second): the
 * first goes at once, and in a burst only the latest position is sent when
 * the gap has passed. Moves travel on the lossy topic, so one lost is one
 * stale position, never a stuck one.
 */
export class MoveCoalescer {
  private pending: Point | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private last = -Infinity;

  constructor(
    private readonly send: (p: Point) => void,
    private readonly now: () => number = () => Date.now(),
    readonly gap = 1000 / 60,
  ) {}

  push(p: Point): void {
    this.pending = p;
    if (this.timer) return;
    const wait = this.last + this.gap - this.now();
    if (wait <= 0) this.fire();
    // Rounded up: timers run on whole milliseconds, and 16 ms apart would be 62 a second.
    else this.timer = setTimeout(() => this.fire(), Math.ceil(wait));
  }

  /** Forget a move not yet sent (a click carries its own position; a pause sends nothing). */
  drop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.pending = null;
  }

  private fire(): void {
    this.timer = null;
    const p = this.pending;
    this.pending = null;
    if (!p) return;
    this.last = this.now();
    this.send(p);
  }
}

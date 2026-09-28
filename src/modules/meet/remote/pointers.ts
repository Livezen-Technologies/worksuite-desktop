import { TOPIC_POINTER } from '@shared/remote-control/channel';
import type { Room } from 'livekit-client';
import type { Stroke } from '../session';

/**
 * The named laser pointer and annotations over a shared screen
 * (WS-MEET-ENH-01 §C.5, RC08), as the web client has them: the same
 * messages on the same data topic, so a browser and this app point and draw
 * for each other.
 *
 * AN OVERLAY, NEVER THE DESKTOP (RC-PTR-02). Nothing here reaches the
 * sharer's computer: every participant paints it over the video on their own
 * screen. It needs no grant and no control (RC-PTR-01); control messages
 * never travel on this topic and nothing on it is ever injected. Strokes are
 * the whiteboard's format — points 0–1 of the picture — scoped to one share
 * (RC-PTR-03). Only the person sharing can clear everybody's marks or switch
 * annotation off for their share; everybody can clear their own.
 */

export type AnnotTool = 'pointer' | 'pen' | 'arrow' | 'rect' | 'text' | 'highlight';
export type AnnotKind = Exclude<AnnotTool, 'pointer'>;

export interface AnnotStroke extends Stroke {
  id: string;
  by: string;
  kind: AnnotKind;
  text?: string;
}

export type PointerMsg =
  | { t: 'laser'; share: number; x: number; y: number; name: string }
  | { t: 'stroke'; share: number; stroke: AnnotStroke }
  | { t: 'clear'; share: number; by: string }
  | { t: 'clear_all'; share: number }
  | { t: 'annot'; share: number; on: boolean };

export interface Laser {
  x: number;
  y: number;
  name: string;
  at: number;
}

export interface ShareMarks {
  strokes: AnnotStroke[];
  lasers: Record<string, Laser>;
  annotOn: boolean;
}

export const ANNOT_COLORS = ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#a855f7', '#ffffff'];
const KINDS = new Set<string>(['pen', 'arrow', 'rect', 'text', 'highlight']);
/** A pointer that stops moving fades after this long. */
export const LASER_MS = 2_000;
const MAX_STROKES = 500;
const MAX_POINTS = 2_000;
/** Messages a second from one person: a pointer sends twenty; more is a flood, dropped unread. */
const PER_SECOND = 60;

/** A stable colour for a person, so their pointer is recognisable across the meeting (the web's own rule). */
export function colorFor(identity: string): string {
  let h = 0;
  for (let i = 0; i < identity.length; i++) h = (h * 31 + identity.charCodeAt(i)) >>> 0;
  return ANNOT_COLORS[h % (ANNOT_COLORS.length - 1)]!;
}

/** Where the picture sits inside a letterboxed video (object-fit: contain). */
export function pictureRect(box: { width: number; height: number }, videoW: number, videoH: number): { left: number; top: number; width: number; height: number } {
  if (!videoW || !videoH) return { left: 0, top: 0, width: box.width, height: box.height };
  const scale = Math.min(box.width / videoW, box.height / videoH);
  const width = videoW * scale;
  const height = videoH * scale;
  return { left: (box.width - width) / 2, top: (box.height - height) / 2, width, height };
}

const unit = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;
const text = (v: unknown, max: number): string | null => (typeof v === 'string' && v.length <= max ? v : null);

/** A message from the topic, checked: anything out of shape is dropped, not drawn. */
export function readPointerMsg(raw: unknown): PointerMsg | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Record<string, unknown>;
  const share = m.share;
  if (typeof share !== 'number' || !Number.isSafeInteger(share) || share <= 0) return null;
  if (m.t === 'laser') return unit(m.x) && unit(m.y) ? { t: 'laser', share, x: m.x, y: m.y, name: typeof m.name === 'string' ? m.name.slice(0, 80) : '' } : null;
  if (m.t === 'clear') return text(m.by, 200) !== null ? { t: 'clear', share, by: m.by as string } : null;
  if (m.t === 'clear_all') return { t: 'clear_all', share };
  if (m.t === 'annot') return typeof m.on === 'boolean' ? { t: 'annot', share, on: m.on } : null;
  if (m.t !== 'stroke' || !m.stroke || typeof m.stroke !== 'object') return null;
  const s = m.stroke as Record<string, unknown>;
  const id = text(s.id, 120);
  const by = text(s.by, 200);
  const color = typeof s.color === 'string' && /^#[0-9a-f]{6}$/i.test(s.color) ? s.color : null;
  const width = typeof s.width === 'number' && Number.isFinite(s.width) ? Math.min(20, Math.max(1, s.width)) : null;
  const points = Array.isArray(s.points) && s.points.length > 0 && s.points.length <= MAX_POINTS && s.points.every((p) => Array.isArray(p) && p.length === 2 && unit(p[0]) && unit(p[1])) ? (s.points as Array<[number, number]>) : null;
  if (!id || !by || !color || width === null || !points || typeof s.kind !== 'string' || !KINDS.has(s.kind)) return null;
  const stroke: AnnotStroke = { id, by, kind: s.kind as AnnotKind, color, width, points };
  if (s.kind === 'text') {
    const t = text(s.text, 120);
    if (!t) return null;
    stroke.text = t;
  }
  return { t: 'stroke', share, stroke };
}

class Pointers {
  private marks = new Map<number, ShareMarks>();
  private version = 0;
  private listeners = new Set<() => void>();
  private fade: ReturnType<typeof setInterval> | null = null;
  private counts = new Map<string, { second: number; n: number }>();
  /** Who shares this share — the remote-control state knows; until it does, nobody may clear for everyone. */
  sharerOf: (shareId: number) => string | null = () => null;
  now = (): number => Date.now();

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  snapshot = (): number => this.version;

  private changed(): void {
    this.version += 1;
    for (const fn of this.listeners) fn();
  }

  of(shareId: number): ShareMarks {
    return this.marks.get(shareId) ?? { strokes: [], lasers: {}, annotOn: true };
  }

  private edit(shareId: number, fn: (m: ShareMarks) => ShareMarks): void {
    this.marks.set(shareId, fn(this.of(shareId)));
    this.changed();
  }

  /** Someone else's message on the topic. */
  receive(payload: Uint8Array, from: { identity: string; name?: string }): void {
    if (payload.length > 65_536) return;
    const second = Math.floor(this.now() / 1_000);
    const c = this.counts.get(from.identity);
    if (c && c.second === second) {
      if (++c.n > PER_SECOND) return;
    } else this.counts.set(from.identity, { second, n: 1 });
    let raw: unknown;
    try {
      raw = JSON.parse(new TextDecoder().decode(payload));
    } catch {
      return;
    }
    const m = readPointerMsg(raw);
    if (!m) return;
    if (m.t === 'laser') {
      this.laser(m.share, from.identity, m.x, m.y, m.name || from.name || 'Someone');
    } else if (m.t === 'stroke') {
      // A stroke is its author's own: nobody draws in somebody else's name.
      if (m.stroke.by !== from.identity) return;
      this.edit(m.share, (s) => ({ ...s, strokes: [...s.strokes.filter((x) => x.id !== m.stroke.id), m.stroke].slice(-MAX_STROKES) }));
    } else if (m.t === 'clear') {
      this.edit(m.share, (s) => ({ ...s, strokes: s.strokes.filter((x) => x.by !== from.identity) }));
    } else if (this.sharerOf(m.share) === from.identity) {
      if (m.t === 'clear_all') this.edit(m.share, (s) => ({ ...s, strokes: [] }));
      else this.edit(m.share, (s) => ({ ...s, annotOn: m.on }));
    }
  }

  private laser(shareId: number, who: string, x: number, y: number, name: string): void {
    this.edit(shareId, (s) => ({ ...s, lasers: { ...s.lasers, [who]: { x, y, name, at: this.now() } } }));
    if (!this.fade) this.fade = setInterval(() => this.expire(), 500);
  }

  private expire(): void {
    const now = this.now();
    let any = false;
    let gone = false;
    for (const [id, s] of this.marks) {
      const keep = Object.fromEntries(Object.entries(s.lasers).filter(([, l]) => now - l.at < LASER_MS));
      if (Object.keys(keep).length !== Object.keys(s.lasers).length) {
        this.marks.set(id, { ...s, lasers: keep });
        gone = true;
      }
      if (Object.keys(keep).length) any = true;
    }
    if (!any && this.fade) {
      clearInterval(this.fade);
      this.fade = null;
    }
    if (gone) this.changed();
  }

  private send(room: Room | null, m: PointerMsg, reliable: boolean): void {
    void room?.localParticipant.publishData(new TextEncoder().encode(JSON.stringify(m)), { reliable, topic: TOPIC_POINTER }).catch(() => undefined);
  }

  /** My pointer, shown to me at once and sent at most twenty times a second. */
  private lastLaser = 0;
  point(room: Room | null, shareId: number, me: string, x: number, y: number, name: string): void {
    this.laser(shareId, me, x, y, 'You');
    const now = this.now();
    if (now - this.lastLaser < 50) return;
    this.lastLaser = now;
    this.send(room, { t: 'laser', share: shareId, x, y, name }, false);
  }

  unpoint(shareId: number, me: string): void {
    this.edit(shareId, (s) => ({ ...s, lasers: Object.fromEntries(Object.entries(s.lasers).filter(([k]) => k !== me)) }));
  }

  draw(room: Room | null, shareId: number, stroke: AnnotStroke): void {
    this.edit(shareId, (s) => ({ ...s, strokes: [...s.strokes, stroke].slice(-MAX_STROKES) }));
    this.send(room, { t: 'stroke', share: shareId, stroke }, true);
  }

  clearMine(room: Room | null, shareId: number, me: string): void {
    this.edit(shareId, (s) => ({ ...s, strokes: s.strokes.filter((x) => x.by !== me) }));
    this.send(room, { t: 'clear', share: shareId, by: me }, true);
  }

  /** The person sharing: everybody's marks go. */
  clearAll(room: Room | null, shareId: number): void {
    this.edit(shareId, (s) => ({ ...s, strokes: [] }));
    this.send(room, { t: 'clear_all', share: shareId }, true);
  }

  /** The person sharing: annotation off (or on again) for this share, for everybody. */
  setAnnot(room: Room | null, shareId: number, on: boolean): void {
    this.edit(shareId, (s) => ({ ...s, annotOn: on }));
    this.send(room, { t: 'annot', share: shareId, on }, true);
  }

  /** Who is pointing at, or has drawn on, this share now — for the person sharing. */
  activity(shareId: number, me: string): string[] {
    const s = this.of(shareId);
    const now = this.now();
    const names = new Set<string>();
    for (const [id, l] of Object.entries(s.lasers)) if (id !== me && now - l.at < LASER_MS) names.add(l.name);
    return [...names];
  }

  /** Marks by others on this share, for the person sharing. */
  othersMarks(shareId: number, me: string): number {
    return this.of(shareId).strokes.filter((x) => x.by !== me).length;
  }

  reset(): void {
    this.marks.clear();
    this.counts.clear();
    if (this.fade) clearInterval(this.fade);
    this.fade = null;
    this.changed();
  }
}

export const pointers = new Pointers();

/** One stroke onto a canvas of w × h pixels. */
export function drawStroke(ctx: CanvasRenderingContext2D, s: AnnotStroke, w: number, h: number): void {
  const pts = s.points.map(([x, y]) => [x * w, y * h] as [number, number]);
  if (pts.length === 0) return;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = s.color;
  ctx.fillStyle = s.color;
  ctx.lineWidth = s.width;
  if (s.kind === 'highlight') {
    ctx.globalAlpha = 0.3;
    ctx.lineWidth = s.width * 5;
  }
  const a = pts[0]!;
  const b = pts[pts.length - 1]!;
  if (s.kind === 'rect') {
    ctx.strokeRect(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
  } else if (s.kind === 'arrow') {
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.stroke();
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const head = 10 + s.width * 2;
    ctx.beginPath();
    ctx.moveTo(b[0], b[1]);
    ctx.lineTo(b[0] - head * Math.cos(ang - Math.PI / 7), b[1] - head * Math.sin(ang - Math.PI / 7));
    ctx.lineTo(b[0] - head * Math.cos(ang + Math.PI / 7), b[1] - head * Math.sin(ang + Math.PI / 7));
    ctx.closePath();
    ctx.fill();
  } else if (s.kind === 'text') {
    ctx.font = `600 ${12 + s.width * 2}px ui-sans-serif, system-ui, sans-serif`;
    ctx.textBaseline = 'top';
    ctx.fillText(s.text ?? '', a[0], a[1]);
  } else {
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
    if (pts.length === 1) ctx.lineTo(a[0] + 0.01, a[1]);
    ctx.stroke();
  }
  ctx.restore();
}

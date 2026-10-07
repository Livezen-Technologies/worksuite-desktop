import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Icon } from '../../../../components/Icon';
import { cx } from '../../../../components/ui';
import { text } from '../../../../core/i18n';
import { findCountry } from './countries';
import { clusterPlaces, countriesIn, DETAIL_BELOW, fitBox, MAP_STATE, outsideOf, padded, panned, STATE, STATES, WORLD_BOX, zoomAt, zoomed, type Box, type Place, type VisitorState } from './liveMap';
import { useDetail } from './mapDetail';
import { WORLD_SHAPES } from './worldMap';

/**
 * The live map (worksuite-desktop C-00, ported from the web's LiveMap, WS-WCHAT MAP-UI-01…03): countries shaded by how
 * many visitors are there, a marker with its count in it for each city somebody was located in — its ring split into
 * one arc per state, so a place with somebody waiting shows amber beside the blue of those browsing — a dashed ring on
 * a country for visitors placed only by their browser's timezone, and a red halo with a callout where somebody is at
 * risk. Each place is named, and only named (its count is in its disc), where the name has room. Zooms by a box the
 * caller holds, so its presets and buttons agree; markers and labels keep their size on screen at every zoom.
 *
 * ITS COLOURS ARE THE THEME'S (worksuite-desktop#284). Every fill and stroke is a `--map-*` variable from styles.css,
 * set for light and for dark — the sea, the land, the borders, the scale, the names and their outline, the ring round
 * a marker, the states — so switching theme repaints the map at once, with nothing drawn again. Wall mode, dark on
 * purpose, draws it inside `data-theme="dark"` and so gets the dark map whatever the app's theme.
 *
 * Drawn from pre-projected Natural Earth outlines: nothing fetched, no key, nothing to fail offline.
 */

/**
 * A visited country's fill, few visitors to many (styles.css `--map-shade-1…5`): darker for more on light, brighter for
 * more on dark. A country nobody is in is the land's own colour.
 */
export const SHADE = ['fill-[var(--map-shade-1)]', 'fill-[var(--map-shade-2)]', 'fill-[var(--map-shade-3)]', 'fill-[var(--map-shade-4)]', 'fill-[var(--map-shade-5)]'] as const;
const LAND = 'fill-[var(--map-land)]';
const BORDER = 'stroke-[var(--map-border)]';
/** A name and a marker's count; the outline round a name, the ring round a marker and the disc inside it. */
const INK = 'fill-[var(--map-label)]';
const HALO = 'fill-[var(--map-halo)]';

/**
 * Each visited country's step on the scale, 1 (fewest) to SHADE.length (most), by rank of how many are there — so
 * every visited country reads as visited and the busiest as the most. One count alone is the top step.
 */
export function shadeSteps(places: Place[]): Map<string, number> {
  const per = new Map<string, number>();
  for (const p of places) {
    const code = findCountry(p.country)?.code;
    if (code) per.set(code, (per.get(code) ?? 0) + p.count);
  }
  const counts = [...new Set(per.values())].sort((a, b) => a - b);
  const out = new Map<string, number>();
  for (const [code, n] of per) {
    const rank = counts.indexOf(n);
    out.set(code, counts.length <= 1 ? SHADE.length : 1 + Math.round((rank / (counts.length - 1)) * (SHADE.length - 1)));
  }
  return out;
}

/** The design's artboard: a 732 × 400 frame, so the first paint (and a test, with no layout) matches it. */
const FRAME = { w: 732, h: 400 };

/** A point on a circle, clockwise from the top. */
const at = (cx: number, cy: number, r: number, a: number) => `${(cx + r * Math.sin(a)).toFixed(2)} ${(cy - r * Math.cos(a)).toFixed(2)}`;

/**
 * In pixels, `k` times larger on the wall: a marker's disc grows with its count, its ring of states sits just outside
 * it, and the halo — white on light, dark on dark — rims the whole, so the states stand off whatever land is under them.
 */
const ARC = 3.2;
const RIM = 1.6;
const disc = (n: number, k = 1) => (10 + Math.min(9, (Math.sqrt(n) - 1) * 4.5)) * k;
const ring = (n: number, k = 1) => disc(n, k) + 2.4 * k;
const edge = (n: number, k = 1) => ring(n, k) + (ARC / 2 + RIM) * k;
/** How far a place's marker reaches from its middle: a country-only ring is a little wider than a city's disc. */
const reach = (p: Place, k = 1) => (p.approx ? disc(p.count, k) * 1.05 + 1.6 * k : edge(p.count, k));

/** A marker's ring as one arc per state there, worst first from the top, clockwise, with a hair of a gap between. */
function arcs(p: Place, R: number): Array<{ state: VisitorState; d: string }> {
  const gap = 0.07;
  const out: Array<{ state: VisitorState; d: string }> = [];
  let a = 0;
  for (const s of STATES) {
    const n = p.states[s] ?? 0;
    if (!n) continue;
    const sweep = (n / p.count) * Math.PI * 2;
    const a0 = a + gap / 2, a1 = a + sweep - gap / 2;
    a += sweep;
    out.push({ state: s, d: `M${at(p.x, p.y, R, a0)}A${R} ${R} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${at(p.x, p.y, R, a1)}` });
  }
  return out;
}

interface Rect { x0: number; x1: number; y0: number; y1: number }

export interface MapLabel { x: number; y: number; anchor: 'start' | 'end'; text: string }

/**
 * A place's name beside its marker, and nothing else (#284): "Colombo", "Sri Lanka" — the count is in its disc, and a
 * dashed ring already says the place is a country placed by timezone alone.
 */
export const nameOf = (p: Place): string => p.city ?? p.country;

/** How a label is sized: its font in pixels, and how much larger the markers are (the wall's). */
interface Type { font: number; k: number }

/** Where a name fits beside a marker: right of it, else left, inside the frame and clear of `blocked`; null when neither. */
function spotFor(p: Place, words: string, box: Box, u: number, t: Type, blocked: (b: Rect) => boolean): { rect: Rect; label: MapLabel } | null {
  const w = words.length * t.font * 0.58 * u;
  const h = t.font * 1.3 * u;
  const r = reach(p, t.k) * u + 4 * u;
  for (const side of ['start', 'end'] as const) {
    const x = side === 'start' ? p.x + r : p.x - r;
    const rect = side === 'start' ? { x0: x, x1: x + w, y0: p.y - h / 2, y1: p.y + h / 2 } : { x0: x - w, x1: x, y0: p.y - h / 2, y1: p.y + h / 2 };
    if (rect.x0 < box.x || rect.x1 > box.x + box.w || blocked(rect)) continue;
    return { rect, label: { x, y: p.y + t.font * 0.36 * u, anchor: side, text: words } };
  }
  return null;
}

/**
 * Names for the busiest places first: right of the marker or else left, never over another name or marker and never
 * off the frame (#284). A quieter place whose name would collide goes unnamed, as does one whose name is already on
 * the map beside a busier place (Sri Lanka's cities, merged at world scale, and its country-only ring) — zooming in
 * makes room, and a hover or focus shows the rest (`hoverLabel`).
 */
export function placeLabels(places: Place[], box: Box, u: number, inside: (p: Place) => boolean, t: Type = { font: 11, k: 1 }): Map<string, MapLabel> {
  const busiest = [...places].sort((a, b) => b.count - a.count);
  const taken: Rect[] = busiest.map((p) => {
    const r = reach(p, t.k) * u;
    return { x0: p.x - r, x1: p.x + r, y0: p.y - r, y1: p.y + r };
  });
  const out = new Map<string, MapLabel>();
  const named = new Set<string>();
  busiest.forEach((p, i) => {
    const words = nameOf(p);
    if (!inside(p) || named.has(words)) return;
    const spot = spotFor(p, words, box, u, t, (b) => taken.some((x, j) => j !== i && b.x0 < x.x1 && b.x1 > x.x0 && b.y0 < x.y1 && b.y1 > x.y0));
    if (!spot) return;
    taken.push(spot.rect);
    named.add(words);
    out.set(p.key, spot.label);
  });
  return out;
}

/** The name of a place hovered or focused that had no room of its own: drawn over the rest, inside the frame where it fits. */
export function hoverLabel(p: Place, box: Box, u: number, t: Type = { font: 11, k: 1 }): MapLabel {
  const words = nameOf(p);
  return spotFor(p, words, box, u, t, () => false)?.label ?? { x: p.x + reach(p, t.k) * u + 4 * u, y: p.y + t.font * 0.36 * u, anchor: 'start', text: words };
}

export function LiveMap({ places, box: asked, onBox, selected = null, onSelect, callout, caption, className, label = 'Map of visitors', wall = false, fit = false, edges = true, zoomButtons = true }: {
  places: Place[];
  box: Box;
  /** Zoomed or panned: by the buttons, a scroll, a pinch or a drag (MAP-08). Without it the map stays where it is. */
  onBox?: (b: Box) => void;
  selected?: string | null;
  onSelect?: (p: Place) => void;
  /** The red callout beside an at-risk place ("Anne · at risk 3:12"); none when it returns null. */
  callout?: (p: Place) => string | null;
  /** The note at the bottom left, e.g. "Shaded by visitors now · darker = more". */
  caption?: string;
  className?: string;
  label?: string;
  /** Wall mode's map (MAP-UI-03): markers and names larger, for a screen across a room. */
  wall?: boolean;
  /** A third button under + and −, ⤢, that brings everybody into view (the full map's, MAP-UI-02). */
  fit?: boolean;
  /** Chips for who is outside the view ("↖ India · 3 outside this view"). */
  edges?: boolean;
  /** + and − over the map; off where the region presets sit in their place (the Live map window, MAP-UI-04). */
  zoomButtons?: boolean;
}) {
  // On the wall, markers a fifth larger and names at 14 px (MAP-UI-03); its brighter dots are styles.css's.
  const type: Type = wall ? { font: 14, k: 1.2 } : { font: 11, k: 1 };
  const { k } = type;
  // The place under the pointer or keyboard focus: its name is shown even where it had no room (#284).
  const [hover, setHover] = useState<string | null>(null);
  // The frame's size, so the box fits it and a marker can be sized in pixels.
  const frame = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(FRAME);
  useEffect(() => {
    const el = frame.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(([e]) => {
      const r = e?.contentRect;
      if (r && r.width > 0 && r.height > 0) setSize({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const box = fitBox(asked, size.w / size.h);
  // Map units per screen pixel.
  const u = box.w / size.w;

  // Past a region's zoom, the countries in view are drawn from their detailed outlines as those arrive (MAP-09).
  const detailed = box.w < DETAIL_BELOW;
  const detail = useDetail(detailed ? countriesIn(box) : []);

  // Shaded by rank of how many are there, so every visited country reads as visited and the busiest the most.
  const shade = useMemo(() => shadeSteps(places), [places]);
  const fillOf = (code: string) => {
    const step = shade.get(code);
    return step ? SHADE[step - 1] : LAND;
  };

  const inside = (p: Place) => p.x >= box.x && p.x <= box.x + box.w && p.y >= box.y && p.y <= box.y + box.h;
  const total = places.reduce((n, p) => n + p.count, 0);
  const away = edges ? outsideOf(places, box).slice(0, 3) : [];
  // Markers that would sit on each other at this zoom are one marker; zooming in parts them again. Their rims may touch.
  const marks = clusterPlaces(places, (a, b) => (ring(a.count, k) + ring(b.count, k)) * u * 0.85);
  // Worst state on top: an at-risk marker is never hidden under a browsing one.
  const drawn = [...marks].sort((a, b) => STATES.indexOf(b.state) - STATES.indexOf(a.state));

  const labels = placeLabels(marks, box, u, inside, type);
  // A place hovered or focused whose name had no room: shown over the rest until the pointer or focus leaves.
  const hovered = hover && !labels.has(hover) ? marks.find((p) => p.key === hover && inside(p)) : undefined;
  const extraLabel = hovered ? hoverLabel(hovered, box, u, type) : null;

  // Scroll, pinch and drag (MAP-08). The latest view in a ref, so the listeners need not be added again on each change.
  const view = useRef({ asked, box, u });
  useEffect(() => {
    view.current = { asked, box, u };
  });
  const moved = useRef(false);
  useEffect(() => {
    const el = frame.current;
    if (!el || !onBox) return undefined;
    const pointAt = (clientX: number, clientY: number) => {
      const r = el.getBoundingClientRect();
      const { box: b, u: k } = view.current;
      return { x: b.x + (clientX - r.left) * k, y: b.y + (clientY - r.top) * k };
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      // A trackpad's pinch arrives as a scroll with Ctrl held, and moves in smaller steps.
      const factor = Math.exp(e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));
      onBox(zoomAt(view.current.box, factor, pointAt(e.clientX, e.clientY)));
    };
    const down = new Map<number, { x: number; y: number }>();
    let start: { box: Box; x: number; y: number; dist: number; mid: { x: number; y: number } } | null = null;
    const begin = () => {
      const pts = [...down.values()];
      const [a, b] = pts;
      if (!a) return void (start = null);
      const mid = b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : a;
      start = { box: view.current.box, x: mid.x, y: mid.y, dist: b ? Math.hypot(a.x - b.x, a.y - b.y) : 0, mid: pointAt(mid.x, mid.y) };
    };
    const pointerDown = (e: PointerEvent) => {
      if (e.button !== 0 || (e.target as Element).closest('button')) return;
      down.set(e.pointerId, { x: e.clientX, y: e.clientY });
      moved.current = false;
      begin();
    };
    const pointerMove = (e: PointerEvent) => {
      if (!down.has(e.pointerId) || !start) return;
      down.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const pts = [...down.values()];
      const [a, b] = pts;
      if (!a) return;
      const mid = b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : a;
      if (Math.hypot(mid.x - start.x, mid.y - start.y) > 4 || b) moved.current = true;
      if (!moved.current) return;
      const k = view.current.u;
      let next = start.box;
      if (b && start.dist > 0) next = zoomAt(next, start.dist / Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), start.mid);
      onBox(panned(next, -(mid.x - start.x) * k, -(mid.y - start.y) * k));
    };
    const pointerUp = (e: PointerEvent) => {
      if (!down.delete(e.pointerId)) return;
      begin();
    };
    el.addEventListener('wheel', wheel, { passive: false });
    el.addEventListener('pointerdown', pointerDown);
    window.addEventListener('pointermove', pointerMove);
    window.addEventListener('pointerup', pointerUp);
    window.addEventListener('pointercancel', pointerUp);
    return () => {
      el.removeEventListener('wheel', wheel);
      el.removeEventListener('pointerdown', pointerDown);
      window.removeEventListener('pointermove', pointerMove);
      window.removeEventListener('pointerup', pointerUp);
      window.removeEventListener('pointercancel', pointerUp);
    };
  }, [onBox]);

  const everyone = () => {
    if (!onBox) return;
    if (!places.length) return onBox(WORLD_BOX);
    const x0 = Math.min(...places.map((p) => p.x)), x1 = Math.max(...places.map((p) => p.x));
    const y0 = Math.min(...places.map((p) => p.y)), y1 = Math.max(...places.map((p) => p.y));
    onBox(padded({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, 0.15));
  };

  const shapes = WORLD_SHAPES.filter((s) => s.code !== 'AQ');
  const extra = [...detail.keys()].filter((c) => !shapes.some((s) => s.code === c));

  return (
    <div ref={frame} className={cx('relative touch-none overflow-hidden bg-[var(--map-ocean)] select-none', onBox && 'cursor-grab active:cursor-grabbing', className)}>
      <svg viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`} className="block h-full w-full" role="img" preserveAspectRatio="xMidYMid meet"
        aria-label={`${text(label)}: ${total} ${total === 1 ? text('visitor') : text('visitors')}, ${places.length} ${places.length === 1 ? text('place') : text('places')}`}>
        {/* Antarctica has never had a visitor, and a tall frame would otherwise show it. Borders a hairline, 0.5 px. */}
        {shapes.map((s) => (
          <path key={s.code} d={detail.get(s.code) ?? s.d} data-country={s.code} data-detail={detail.has(s.code) ? s.code : undefined} className={cx(fillOf(s.code), BORDER)} strokeWidth={0.5 * u} />
        ))}
        {extra.map((c) => <path key={c} d={detail.get(c)} data-country={c} data-detail={c} className={cx(fillOf(c), BORDER)} strokeWidth={0.5 * u} />)}
        {drawn.map((p) => {
          const name = `${p.city ?? p.country}${p.approx ? ` (${text('country only')})` : ''}: ${p.count} · ${text(STATE[p.state].label)}`;
          const on = selected === p.key;
          const pick = () => {
            if (!moved.current) onSelect?.(p);
          };
          const act = onSelect
            ? {
                role: 'button',
                tabIndex: 0,
                'aria-label': name,
                'aria-pressed': on,
                onClick: pick,
                onKeyDown: (e: KeyboardEvent) => {
                  if (e.key !== 'Enter' && e.key !== ' ') return;
                  e.preventDefault();
                  onSelect(p);
                },
                className: 'cursor-pointer outline-none',
              }
            : {};
          // Under the pointer or focused, its name shows even where it had no room.
          const shown = {
            onPointerEnter: () => setHover(p.key),
            onPointerLeave: () => setHover((h) => (h === p.key ? null : h)),
            onFocus: () => setHover(p.key),
            onBlur: () => setHover((h) => (h === p.key ? null : h)),
          };
          // The picked place: a dashed ring around it (MAP-UI-02).
          const picked = (r: number) => (on ? <circle cx={p.x} cy={p.y} r={r + 6 * u} fill="none" className="stroke-[var(--map-label)]" strokeWidth={1.4 * u} strokeDasharray={`${3.5 * u} ${2 * u}`} data-picked /> : null);
          if (p.approx) {
            const r = disc(p.count, k) * 1.05 * u;
            return (
              <g key={p.key} {...act} {...shown} data-place={p.key}>
                {/* Under the dashes, the halo's colour: the ring reads as clearly on dark land as on a country shaded bright. */}
                <circle cx={p.x} cy={p.y} r={r} className={cx(HALO, 'stroke-[var(--map-halo)]')} strokeWidth={3.2 * k * u} />
                <circle cx={p.x} cy={p.y} r={r} fill="none" className="stroke-[var(--map-approx)]" strokeWidth={1.4 * k * u} strokeDasharray={`${3 * k * u} ${2.2 * k * u}`} data-approx />
                <text x={p.x} y={p.y + 3.6 * k * u} textAnchor="middle" fontSize={10 * k * u} fontWeight={700} className={INK}>{p.count}</text>
                {picked(r + 1.6 * k * u)}
                <title>{name}</title>
              </g>
            );
          }
          const R = ring(p.count, k) * u;
          const E = edge(p.count, k) * u;
          const parts = STATES.filter((s) => (p.states[s] ?? 0) > 0);
          // A glow where somebody needs us: red when at risk, amber when waiting (MAP-04).
          const glow = p.state === 'at_risk' || p.state === 'waiting' ? MAP_STATE[p.state] : null;
          return (
            <g key={p.key} {...act} {...shown} data-place={p.key}>
              {glow ? (
                <>
                  <circle cx={p.x} cy={p.y} r={E + 12 * u} className={glow.fill} opacity={0.16} />
                  <circle cx={p.x} cy={p.y} r={E + 3.3 * u} fill="none" className={glow.stroke} strokeWidth={1.4 * u} opacity={0.6} />
                </>
              ) : null}
              {/* The halo: the disc the count sits on and the rim round the states, white on light and dark on dark. */}
              <circle cx={p.x} cy={p.y} r={E} className={HALO} data-halo />
              {parts.length <= 1 ? (
                <circle cx={p.x} cy={p.y} r={R} fill="none" className={MAP_STATE[parts[0] ?? p.state].stroke} strokeWidth={ARC * k * u} data-arc={parts[0] ?? p.state} />
              ) : (
                arcs(p, R).map((a) => <path key={a.state} d={a.d} fill="none" className={MAP_STATE[a.state].stroke} strokeWidth={ARC * k * u} strokeLinecap="round" data-arc={a.state} />)
              )}
              <text x={p.x} y={p.y + 3.6 * k * u} textAnchor="middle" fontSize={(p.count >= 5 ? 12 : 10.5) * k * u} fontWeight={700} className={INK}>{p.count}</text>
              {picked(glow ? E + 6 * u : E)}
              <title>{name}</title>
            </g>
          );
        })}
        {[...labels.entries()].map(([key, l]) => (
          <text key={`l-${key}`} x={l.x} y={l.y} textAnchor={l.anchor} fontSize={type.font * u} fontWeight={600} className={cx(INK, 'stroke-[var(--map-halo)]')} paintOrder="stroke" strokeWidth={3 * k * u} strokeLinejoin="round" pointerEvents="none" data-label={key}>
            {l.text}
          </text>
        ))}
        {hovered && extraLabel ? (
          <text x={extraLabel.x} y={extraLabel.y} textAnchor={extraLabel.anchor} fontSize={type.font * u} fontWeight={600} className={cx(INK, 'stroke-[var(--map-halo)]')} paintOrder="stroke" strokeWidth={3 * k * u} strokeLinejoin="round" pointerEvents="none" data-label={hovered.key} data-hover>
            {extraLabel.text}
          </text>
        ) : null}
        {callout
          ? marks.filter((p) => !p.approx && p.state === 'at_risk' && inside(p)).map((p) => {
              const words = callout(p);
              if (!words) return null;
              const w = words.length * 6.6 + 16;
              // Down and to the left of the place, kept inside the frame.
              const x = Math.max(box.x + 8 * u, Math.min(box.x + box.w - (w + 8) * u, p.x - 175 * u));
              const y = Math.max(box.y + 20 * u, Math.min(box.y + box.h - 14 * u, p.y + 62 * u));
              return (
                <g key={`c-${p.key}`} pointerEvents="none" data-callout={p.key}>
                  <line x1={p.x} y1={p.y} x2={x} y2={y} stroke={STATE.at_risk.colour} strokeWidth={1 * u} />
                  <g transform={`translate(${x} ${y}) scale(${u})`}>
                    <rect x={0} y={-13} rx={6} width={w} height={22} fill={STATE.at_risk.colour} />
                    <text x={8} y={2} fontSize={11} fontWeight={700} fill="#ffffff">{words}</text>
                  </g>
                </g>
              );
            })
          : null}
      </svg>

      {onBox && zoomButtons ? (
        <div className="absolute top-2.5 right-2.5 flex flex-col overflow-hidden rounded-[8px] border border-line bg-surface shadow-[0_2px_6px_rgba(17,27,59,0.08)]">
          <button type="button" aria-label={text('Zoom in')} onClick={() => onBox(zoomed(asked, 0.6))} className={cx(ZOOM, 'border-b border-line')}>
            <Icon name="plus" size={14} />
          </button>
          <button type="button" aria-label={text('Zoom out')} onClick={() => onBox(zoomed(asked, 1 / 0.6))} className={cx(ZOOM, fit && 'border-b border-line')}>
            <Icon name="minus" size={14} />
          </button>
          {fit ? (
            <button type="button" aria-label={text('Show everyone')} onClick={everyone} className={cx(ZOOM, 'text-[12px]')}>
              ⤢
            </button>
          ) : null}
        </div>
      ) : null}

      {away.length ? (
        <ul aria-label={text('Outside this view')} className="absolute top-2.5 left-2.5 flex flex-col items-start gap-1.5">
          {away.map((a) => (
            <li key={a.country} className="flex items-center gap-1.5 rounded-[8px] border border-line bg-surface px-2.5 py-1.5 text-[12px] whitespace-nowrap text-ink shadow-[0_2px_6px_rgba(17,27,59,0.08)]">
              {a.arrow} {findCountry(a.country)?.name ?? a.country} · {a.count} <span className="text-ink-3">{text('outside this view')}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {caption ? <p className="absolute bottom-2.5 left-2.5 rounded-[8px] border border-line bg-surface/95 px-2.5 py-[7px] text-[11.5px] text-ink-2">{caption}</p> : null}
    </div>
  );
}

const ZOOM = 'flex h-[30px] w-[30px] items-center justify-center text-ink-2 hover:bg-subtle';

// The legend has no outlines in it and shows before the map loads (worksuite-desktop#248); kept importable from here.
export { MapLegend } from './MapLegend';
